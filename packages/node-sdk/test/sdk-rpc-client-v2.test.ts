/**
 * Scenario: v2 wiring MVP — the harness talks to the in-process agent-core-v2
 * engine (klient memory transport) instead of the v1 KimiCore RPC pair.
 * Responsibilities: `getExperimentalFeatures` is migrated end-to-end; every
 * not-yet-migrated method fails loudly with `not_implemented` instead of
 * silently hitting a v1 core.
 * Wiring: real v2 engine bootstrapped on a temp KIMI_CODE_HOME; no provider calls.
 * Run: pnpm exec vitest run test/sdk-rpc-client-v2.test.ts
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createKimiHarnessV2,
  ErrorCodes,
  KimiError,
  KimiHarness,
  removeProviderFromConfig,
  SDKRpcClientV2,
  type KimiConfig,
} from '#/index';
import { foldAgentWireReplay } from '#/v2/resume-replay';
import {
  drainQueryStoreDisposals,
  drainSessionIndexMirror,
  HostProcessError,
  IHostRequestHeaders,
  OsProcessErrors,
} from '@moonshot-ai/agent-core-v2';

import { McpOAuthService } from '../../agent-core/src/mcp/oauth/service';

import { TEST_IDENTITY } from './test-identity';
import { startMcpAuthStatusServer } from './mcp-auth-status-server';
import { recordingTelemetry, type TelemetryRecord } from './telemetry';

const hostEnvProbe = vi.hoisted(() => ({ failWithMissingShell: false }));

vi.mock('@moonshot-ai/agent-core-v2/_base/execEnv/environmentProbe', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@moonshot-ai/agent-core-v2/_base/execEnv/environmentProbe')
  >();
  return {
    ...actual,
    probeHostEnvironmentFromNode: () =>
      hostEnvProbe.failWithMissingShell
        ? Promise.reject(
            new actual.ProbeShellNotFoundError('Git Bash missing (stubbed)', [
              'C:\\Program Files\\Git\\bin\\bash.exe',
            ]),
          )
        : actual.probeHostEnvironmentFromNode(),
  };
});

const tempDirs: string[] = [];

afterEach(async () => {
  // The read-model mirror/query-store close asynchronously on dispose; await
  // the drains so the rm below never races their final flush (ENOTEMPTY).
  await drainSessionIndexMirror();
  await drainQueryStoreDisposals();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function stubProcessPlatform(platform: NodeJS.Platform): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => {
    if (descriptor !== undefined) {
      Object.defineProperty(process, 'platform', descriptor);
    }
  };
}

async function makeHarness(): Promise<{ harness: KimiHarness; homeDir: string }> {
  const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-'));
  tempDirs.push(homeDir);
  return { harness: createKimiHarnessV2({ homeDir, identity: TEST_IDENTITY }), homeDir };
}

describe('SDKRpcClientV2 (agent-core-v2 wiring MVP)', () => {
  it('reports global MCP authorization from the persisted v2 credential store', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-'));
    tempDirs.push(homeDir);
    const statusServer = await startMcpAuthStatusServer();
    const authorizedUrl = 'https://authorized.example.test/mcp';
    const requiredUrl = 'https://required.example.test/mcp';
    const externalOAuth = new McpOAuthService({ kimiHomeDir: homeDir });
    externalOAuth
      .getProvider('oauth-authorized', authorizedUrl)
      .saveTokens({ access_token: 'test-access-token', token_type: 'Bearer' });
    externalOAuth
      .getProvider('sse', statusServer.oauthUrl)
      .saveTokens({ access_token: 'stale-sse-token', token_type: 'Bearer' });
    await writeFile(
      join(homeDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          stdio: { command: 'local-command' },
          plain: { transport: 'http', url: statusServer.plainUrl },
          detected: { transport: 'http', url: statusServer.oauthUrl },
          sse: { transport: 'sse', url: statusServer.oauthUrl },
          'sse-oauth': { transport: 'sse', url: statusServer.oauthUrl, auth: 'oauth' },
          bearer: {
            transport: 'http',
            url: 'https://bearer.example.test/mcp',
            bearerTokenEnvVar: 'EXAMPLE_MCP_TOKEN',
          },
          'oauth-required': {
            transport: 'http',
            url: requiredUrl,
            auth: 'oauth',
          },
          'oauth-authorized': {
            transport: 'http',
            url: authorizedUrl,
            auth: 'oauth',
          },
        },
      }),
      'utf-8',
    );
    const harness = createKimiHarnessV2({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(harness.listMcpServerAuthStatuses()).resolves.toEqual([
        { name: 'stdio', authStatus: 'not-applicable' },
        { name: 'plain', authStatus: 'not-applicable' },
        { name: 'detected', authStatus: 'oauth-required' },
        { name: 'sse', authStatus: 'not-applicable' },
        { name: 'sse-oauth', authStatus: 'oauth-required' },
        { name: 'bearer', authStatus: 'bearer-token' },
        { name: 'oauth-required', authStatus: 'oauth-required' },
        { name: 'oauth-authorized', authStatus: 'oauth-authorized' },
      ]);

      externalOAuth
        .getProvider('oauth-required', requiredUrl)
        .saveTokens({ access_token: 'new-test-access-token', token_type: 'Bearer' });
      externalOAuth.invalidate('oauth-authorized', authorizedUrl, 'tokens');

      await expect(harness.listMcpServerAuthStatuses()).resolves.toEqual([
        { name: 'stdio', authStatus: 'not-applicable' },
        { name: 'plain', authStatus: 'not-applicable' },
        { name: 'detected', authStatus: 'oauth-required' },
        { name: 'sse', authStatus: 'not-applicable' },
        { name: 'sse-oauth', authStatus: 'oauth-required' },
        { name: 'bearer', authStatus: 'bearer-token' },
        { name: 'oauth-required', authStatus: 'oauth-authorized' },
        { name: 'oauth-authorized', authStatus: 'oauth-required' },
      ]);
    } finally {
      await harness.close();
      await statusServer.close();
    }
  }, 15_000);

  it('seeds the host request headers (User-Agent + X-Msh-*) into the engine', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-'));
    tempDirs.push(homeDir);
    const client = new SDKRpcClientV2({ homeDir, identity: TEST_IDENTITY });
    try {
      // Without this seed the managed vendors go out with the SDK's default
      // User-Agent and no X-Msh-* — the interactive-v2 path's identity bug.
      const headers = client.engineAccessor.get(IHostRequestHeaders).headers;
      expect(headers['User-Agent']).toBe(`kimi-code-cli/${TEST_IDENTITY.version}`);
      expect(headers['X-Msh-Platform']).toBe('kimi_code_cli');
      expect(headers['X-Msh-Version']).toBe(TEST_IDENTITY.version);
      expect(headers['X-Msh-Device-Id']).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  it('surfaces a missing Git Bash probe failure during ensureConfigFile on Windows', async () => {
    hostEnvProbe.failWithMissingShell = true;
    const restorePlatform = stubProcessPlatform('win32');
    try {
      const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-'));
      tempDirs.push(homeDir);
      const harness = createKimiHarnessV2({ homeDir, identity: TEST_IDENTITY });
      try {
        await expect(harness.ensureConfigFile()).rejects.toBeInstanceOf(HostProcessError);
        await expect(harness.ensureConfigFile()).rejects.toMatchObject({
          code: OsProcessErrors.codes.SHELL_GIT_BASH_NOT_FOUND,
        });
      } finally {
        await harness.close();
      }
    } finally {
      hostEnvProbe.failWithMissingShell = false;
      restorePlatform();
    }
  });

  it('does not block ensureConfigFile on the host environment probe on POSIX', async () => {
    hostEnvProbe.failWithMissingShell = true;
    const restorePlatform = stubProcessPlatform('darwin');
    try {
      const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-'));
      tempDirs.push(homeDir);
      const harness = createKimiHarnessV2({ homeDir, identity: TEST_IDENTITY });
      try {
        await expect(harness.ensureConfigFile()).resolves.toBeUndefined();
      } finally {
        await harness.close();
      }
    } finally {
      hostEnvProbe.failWithMissingShell = false;
      restorePlatform();
    }
  });

  it('serves getExperimentalFeatures from the v2 engine', async () => {
    const { harness } = await makeHarness();
    try {
      const features = await harness.getExperimentalFeatures();
      expect(Array.isArray(features)).toBe(true);
      expect(features.length).toBeGreaterThan(0);
      for (const feature of features) {
        expect(typeof feature.id).toBe('string');
        expect(typeof feature.title).toBe('string');
        expect(typeof feature.env).toBe('string');
        expect(typeof feature.enabled).toBe('boolean');
        expect(typeof feature.defaultEnabled).toBe('boolean');
      }
    } finally {
      await harness.close();
    }
  });

  it('serves listWorkspaceSkills through the engineAccessor escape hatch', async () => {
    const { harness, homeDir } = await makeHarness();
    const workDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-work-'));
    tempDirs.push(workDir);
    await writeSkill(join(homeDir, 'skills', 'demo-user-skill'), 'demo-user-skill');
    await writeSkill(join(workDir, '.kimi-code', 'skills', 'demo-project-skill'), 'demo-project-skill');
    try {
      const skills = await harness.listWorkspaceSkills(workDir);
      const byName = new Map(skills.map((skill) => [skill.name, skill]));
      expect(byName.get('demo-user-skill')).toMatchObject({
        description: 'Skill demo-user-skill for the escape-hatch test',
        source: 'user',
      });
      expect(byName.get('demo-project-skill')).toMatchObject({
        description: 'Skill demo-project-skill for the escape-hatch test',
        source: 'project',
      });
    } finally {
      await harness.close();
    }
  });

  it('honors skillDirs (explicit dirs) over default user / project discovery', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-'));
    tempDirs.push(homeDir);
    const workDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-work-'));
    tempDirs.push(workDir);
    const explicitBase = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-explicit-'));
    tempDirs.push(explicitBase);
    const explicitDir = join(explicitBase, 'skills');
    await writeSkill(join(homeDir, 'skills', 'demo-user-skill'), 'demo-user-skill');
    await writeSkill(join(workDir, '.kimi-code', 'skills', 'demo-project-skill'), 'demo-project-skill');
    await writeSkill(join(explicitDir, 'demo-explicit-skill'), 'demo-explicit-skill');
    const harness = createKimiHarnessV2({
      homeDir,
      identity: TEST_IDENTITY,
      skillDirs: [explicitDir],
    });
    try {
      const skills = await harness.listWorkspaceSkills(workDir);
      const byName = new Map(skills.map((skill) => [skill.name, skill]));
      expect(byName.get('demo-explicit-skill')).toMatchObject({
        description: 'Skill demo-explicit-skill for the escape-hatch test',
        source: 'user',
      });
      expect(byName.has('demo-user-skill')).toBe(false);
      expect(byName.has('demo-project-skill')).toBe(false);

      // The session skill catalog (the Skill tool's listing) goes through the
      // seeded engine runtime options, so it sees the same explicit source.
      const session = await harness.createSession({ workDir });
      const sessionNames = new Set((await session.listSkills()).map((skill) => skill.name));
      expect(sessionNames.has('demo-explicit-skill')).toBe(true);
      expect(sessionNames.has('demo-user-skill')).toBe(false);
      expect(sessionNames.has('demo-project-skill')).toBe(false);
      await session.close();
    } finally {
      await harness.close();
    }
  });

  it('serves the plugin catalog from the v2 engine on an empty home', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-'));
    tempDirs.push(homeDir);
    const rpc = new SDKRpcClientV2({ homeDir, identity: TEST_IDENTITY });
    try {
      expect(await rpc.listPlugins()).toEqual([]);
      expect(await rpc.reloadPlugins()).toEqual({ added: [], removed: [], errors: [] });
      await expect(rpc.getPluginInfo('missing-plugin')).rejects.toThrow();
    } finally {
      await rpc.close();
    }
  });

  it('persists removeProvider as one atomic cascade (providers, models, defaults)', async () => {
    const { harness } = await makeHarness();
    try {
      await harness.setConfig({
        providers: {
          a: { type: 'openai', baseUrl: 'https://a.example.test/v1', apiKey: 'sk-a' },
          b: { type: 'openai', baseUrl: 'https://b.example.test/v1', apiKey: 'sk-b' },
        },
        models: {
          'a/m1': { provider: 'a', model: 'm1', maxContextSize: 100 },
          'b/m1': { provider: 'b', model: 'm1', maxContextSize: 100 },
        },
        defaultModel: 'b/m1',
        defaultProvider: 'b',
      });
      const next = await harness.removeProvider('b');
      expect(next.providers['b']).toBeUndefined();
      expect(next.providers['a']).toBeDefined();
      expect(next.models?.['b/m1']).toBeUndefined();
      expect(next.models?.['a/m1']).toBeDefined();
      expect(next.defaultModel).toBeUndefined();
      expect(next.defaultProvider).toBeUndefined();
      // A fresh read from disk sees the same state — the cascade landed as a
      // single atomic write, never a halfway-removed intermediate.
      const reread = await harness.getConfig({ reload: true });
      expect(reread.providers['b']).toBeUndefined();
      expect(reread.models?.['b/m1']).toBeUndefined();
      expect(reread.defaultModel).toBeUndefined();
      expect(reread.defaultProvider).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it('replaces config sections atomically and clears undefined sections', async () => {
    const { harness } = await makeHarness();
    try {
      expect(harness.supportsAtomicSectionReplace()).toBe(true);
      await harness.setConfig({
        providers: { a: { type: 'openai', baseUrl: 'https://a.example.test/v1', apiKey: 'sk-a' } },
        models: { 'a/m1': { provider: 'a', model: 'm1', maxContextSize: 100 } },
        defaultModel: 'a/m1',
      });
      await harness.replaceConfigSections({ defaultModel: undefined });
      const next = await harness.getConfig({ reload: true });
      expect(next.defaultModel).toBeUndefined();
      // Sections absent from the write stay untouched.
      expect(next.providers['a']).toBeDefined();
      expect(next.models?.['a/m1']).toBeDefined();
    } finally {
      await harness.close();
    }
  });

  it('runs native Fusion commands through the real engine without provider requests', async () => {
    const scratchDir = new URL('../../../.tmp/', import.meta.url);
    await mkdir(scratchDir, { recursive: true });
    const root = await mkdtemp(fileURLToPath(new URL('sdk-fusion-', scratchDir)));
    tempDirs.push(root);
    const skillDir = join(root, 'skills');
    await mkdir(skillDir);
    const fetchGuard = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Fusion command smoke test must not make network requests');
    });
    vi.stubEnv('KIMI_CODE_EXPERIMENTAL_FLAG', '0');
    vi.stubEnv('KIMI_CODE_EXPERIMENTAL_FUSION', undefined);

    try {
      for (const scenario of [
        'on',
        'genius-boss',
        'idiot-boss',
        'dual',
        'genius-boss dual',
        'idiot-boss dual',
        'genius-overrides',
        'idiot-overrides',
        'default-effort-override',
        'dual-muse-override',
        'invalid-overrides',
        'disabled',
        'missing-leader',
      ] as const) {
        const activation = {
          'genius-overrides': 'genius-boss ceo=fixture-worker@high coo=fixture-fable@high worker=fixture-astra@xhigh',
          'idiot-overrides': 'idiot-boss worker=fixture-muse@max',
          'default-effort-override': 'genius-boss ceo=fixture-worker',
          'dual-muse-override': 'genius-boss dual muse=fixture-worker',
        };
        const command = scenario in activation ? activation[scenario as keyof typeof activation] : scenario;
        const homeDir = join(root, scenario, 'home');
        const workDir = join(root, scenario, 'work');
        await mkdir(homeDir, { recursive: true });
        await mkdir(workDir, { recursive: true });
        await writeFile(
          join(homeDir, 'config.toml'),
          `telemetry = false
default_model = "fixture-original"

[experimental]
fusion = ${scenario !== 'disabled'}

[thinking]
enabled = true
effort = "low"

[fusion]
ceo_model = "${scenario === 'missing-leader' ? 'fixture-missing-fable' : 'fixture-fable'}"
coo_model = "fixture-astra"
worker_model = "fixture-worker"
coordinator_model = "fixture-worker"
muse_model = "fixture-muse"
terra_model = "fixture-terra"
ceo_effort = "high"
coo_effort = "xhigh"
worker_effort = "high"
coordinator_effort = "high"
muse_effort = "max"
terra_effort = "xhigh"

[providers.fixture]
type = "openai"
base_url = "https://example.test/v1"
api_key = "dummy-api-key"

${Object.entries({
  'fixture-original': 'original-model',
  'fixture-fable': 'claude-fable-5.1',
  'fixture-astra': 'gpt-6-astra',
  'fixture-worker': 'gemini-3.8-flash',
  'fixture-muse': 'muse-spark-1.3',
  'fixture-terra': 'gpt-5.6-terra',
}).map(([alias, model]) => `[models.${alias}]
provider = "fixture"
model = "${model}"
max_context_size = 128000
capabilities = ["thinking", "tool_use"]
support_efforts = ["low", "high", "xhigh", "max"]
`).join('\n')}`,
          'utf-8',
        );
        let harness = createKimiHarnessV2({ homeDir, identity: TEST_IDENTITY, skillDirs: [skillDir] });
        try {
          let session = await harness.createSession({ workDir });
          try {
            expect(await session.listCommands()).toContainEqual(
              expect.objectContaining({ name: 'fusion' }),
            );
            const original = await session.getStatus();
            expect(original).toMatchObject({ model: 'fixture-original', thinkingEffort: 'low' });
            // Commands may append feedback to context without changing the configuration.
            const unchanged = {
              model: original.model,
              thinkingEffort: original.thinkingEffort,
              permission: original.permission,
              planMode: original.planMode,
              swarmMode: original.swarmMode,
              usage: original.usage,
            };
            const agentsDir = join(session.summary!.sessionDir, 'agents');
            const agentIds = async () =>
              (await readdir(agentsDir, { withFileTypes: true }))
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort();
            const originalIds = await agentIds();

            const profileHistory = async (ids: readonly string[]) => Promise.all(
              ids.map(async (id) => {
                const binding = await harness.withInteractiveAgent(id, () => session.getStatus());
                // Journal writes drain asynchronously; do not snapshot before the current binding lands.
                return vi.waitFor(async () => {
                  const entries = (await readFile(join(agentsDir, id, 'wire.jsonl'), 'utf-8'))
                    .split('\n')
                    .filter((line) => /"type"\s*:\s*"profile\./.test(line))
                    .map((line) => {
                      const op: { type: string; modelAlias?: string; thinkingEffort?: string } = JSON.parse(line);
                      return { type: op.type, modelAlias: op.modelAlias, thinkingEffort: op.thinkingEffort };
                    });
                  expect(entries.findLast((op) => op.type === 'profile.bind')).toMatchObject({
                    modelAlias: binding.model,
                    thinkingEffort: binding.thinkingEffort,
                  });
                  return { id, entries };
                }, { interval: 10, timeout: 5_000 });
              }),
            );
            const originalHistory = await profileHistory(originalIds);

            if (scenario === 'disabled' || scenario === 'missing-leader') {
              for (const failedCommand of ['on', 'genius-boss', 'idiot-boss']) {
                const result = session.runCommand('fusion', failedCommand);
                await expect(result, `${scenario}: ${failedCommand}`).rejects.toThrow(
                  scenario === 'disabled'
                    ? /experimental|disabled|flag|enable/i
                    : /model|configured|fable|ceo/i,
                );
                if (scenario === 'missing-leader') {
                  await expect(result, 'missing leader provides a configuration remedy').rejects.toThrow(
                    /\[fusion\]|\/model|override|configure\b|claude.*cli/i,
                  );
                }
                expect(await session.getStatus(), scenario).toMatchObject(unchanged);
                expect(await agentIds(), scenario).toEqual(originalIds);
                expect(await profileHistory(originalIds), scenario).toEqual(originalHistory);
                expect(fetchGuard, scenario).not.toHaveBeenCalled();
              }
              continue;
            }

            if (scenario === 'invalid-overrides') {
              for (const [failedCommand, reason] of [
                ['genius-boss muse=fixture-muse@max', /muse|dual/i],
                ['genius-boss bogus=foo', /unknown|unexpected|role|override|bogus|usage|followed only by/i],
                ['genius-boss worker=fixture-missing', /model|configured|alias/i],
              ] as const) {
                const rejection = await session.runCommand('fusion', failedCommand).catch((error: unknown) => error);
                expect(rejection, `${failedCommand}: must reject before team creation`).toBeInstanceOf(Error);
                expect(rejection, failedCommand).toHaveProperty('message', expect.stringMatching(reason));
                expect(await session.getStatus(), failedCommand).toMatchObject(unchanged);
                expect(await agentIds(), failedCommand).toEqual(originalIds);
                expect(await profileHistory(originalIds), failedCommand).toEqual(originalHistory);
                expect(fetchGuard, failedCommand).not.toHaveBeenCalled();
              }
              continue;
            }

            const expectStatusFeedback = async (expected: string) => {
              const messages: string[] = [];
              const unsubscribe = session.onEvent((event) => {
                if (event.type === 'warning' && event.code === 'fusion.status') messages.push(event.message);
              });
              try {
                await session.runCommand('fusion', 'status');
              } finally {
                unsubscribe();
              }
              expect(messages, `${scenario}: visible status feedback`).toHaveLength(1);
              expect(messages[0], scenario).toContain(expected);
            };
            await expectStatusFeedback('Fusion off:');
            expect(await session.getStatus(), scenario).toMatchObject(unchanged);
            expect(await agentIds(), scenario).toEqual(originalIds);
            expect(fetchGuard, scenario).not.toHaveBeenCalled();
            await expect(session.runCommand('fusion', command), scenario).resolves.toBeUndefined();
            const idiotBoss = command.startsWith('idiot-boss');
            const activeModel = scenario === 'idiot-overrides'
              ? 'fixture-muse'
              : idiotBoss || scenario === 'genius-overrides' || scenario === 'default-effort-override'
                ? 'fixture-worker'
                : 'fixture-fable';
            const activeEffort = scenario === 'idiot-overrides' ? 'max' : 'high';
            expect(await session.getStatus(), scenario).toMatchObject({
              model: activeModel,
              thinkingEffort: activeEffort,
            });
            const activeIds = await agentIds();
            const memberBindings = async () => Promise.all(activeIds.map(async (id) => {
              const status = await harness.withInteractiveAgent(id, () => session.getStatus());
              return { id, model: status.model, thinkingEffort: status.thinkingEffort };
            }));
            const members = await memberBindings();
            const subagents = members.filter(({ id }) => id !== harness.interactiveAgentId);
            const expectedSubagents = scenario === 'genius-overrides'
              ? [
                  { model: 'fixture-fable', thinkingEffort: 'high' },
                  { model: 'fixture-astra', thinkingEffort: 'xhigh' },
                ]
              : [
                  { model: 'fixture-astra', thinkingEffort: 'xhigh' },
                  { model: idiotBoss ? 'fixture-fable' : 'fixture-worker', thinkingEffort: 'high' },
                ];
            expect(subagents, scenario).toEqual(expect.arrayContaining(
              expectedSubagents.map((binding) => expect.objectContaining(binding)),
            ));
            if (scenario === 'dual-muse-override') {
              expect(subagents).toContainEqual(expect.objectContaining({
                model: 'fixture-worker',
                thinkingEffort: 'max',
              }));
            }
            const activeHistory = await profileHistory(activeIds);
            for (const history of activeHistory) {
              expect(history.entries.length, `${scenario}: ${history.id} profile history`).toBeGreaterThan(0);
            }
            expect(fetchGuard, scenario).not.toHaveBeenCalled();

            // Repeated activation and status must not recreate agents or rebind their models.
            await session.runCommand('fusion', 'status');
            await expect(session.runCommand('fusion', command), scenario).resolves.toBeUndefined();
            expect(await agentIds(), scenario).toEqual(activeIds);
            expect(await memberBindings(), scenario).toEqual(members);
            expect(await profileHistory(activeIds), scenario).toEqual(activeHistory);
            expect(fetchGuard, scenario).not.toHaveBeenCalled();

            if (scenario === 'genius-boss' || scenario === 'idiot-boss') {
              const conversations = await Promise.all(activeIds.map(async (id) => {
                const sentinel = `fusion-resume-sentinel-${scenario}-${id}`;
                await harness.withInteractiveAgent(id, () =>
                  session.importContext(sentinel, 'example.test/fusion-resume'),
                );
                const { history } = await harness.withInteractiveAgent(id, () => session.getContext());
                expect(JSON.stringify(history), `${scenario}: ${id}`).toContain(sentinel);
                return { id, sentinel, history };
              }));
              const closedSession = session;
              const ownerId = harness.interactiveAgentId;
              await session.close();
              expect(harness.sessions.has(closedSession.id)).toBe(false);
              await harness.close();
              await drainSessionIndexMirror();
              await drainQueryStoreDisposals();
              harness = createKimiHarnessV2({ homeDir, identity: TEST_IDENTITY, skillDirs: [skillDir] });
              const resumedSession = await harness.resumeSession({ id: closedSession.id, includeSubagents: true });
              session = resumedSession;
              expect(session).not.toBe(closedSession);
              expect(session.id).toBe(closedSession.id);

              // The SDK snapshot reads the restored engine's actual tool registry.
              // Assert before any command can lazily recreate the active-tool overlay.
              const restored = session.getResumeState();
              expect(Object.keys(restored?.agents ?? {}).toSorted(), scenario).toEqual(activeIds);
              const ownerTools = restored?.agents[ownerId]?.tools.map(({ name, active }) => ({ name, active }));
              expect(ownerTools, `${scenario}: restored owner tools`).toContainEqual({ name: 'FusionTeam', active: true });
              expect(await agentIds(), scenario).toEqual(activeIds);
              expect(await memberBindings(), scenario).toEqual(members);
              expect(await profileHistory(activeIds), scenario).toEqual(activeHistory);
              for (const { id, sentinel, history } of conversations) {
                const resumedHistory = restored?.agents[id]?.context.history;
                expect(resumedHistory?.slice(0, history.length), `${scenario}: ${id}`).toEqual(history);
                expect(JSON.stringify(resumedHistory), `${scenario}: ${id}`).toContain(sentinel);
                const live = await harness.withInteractiveAgent(id, () => resumedSession.getContext());
                expect(live.history.slice(0, history.length), `${scenario}: ${id}`).toEqual(history);
              }

              await expectStatusFeedback(`Fusion on: ${scenario}`);
              await expect(session.runCommand('fusion', command), `${scenario}: after resume`).resolves.toBeUndefined();
              expect(await agentIds(), scenario).toEqual(activeIds);
              expect(await memberBindings(), scenario).toEqual(members);
              expect(await profileHistory(activeIds), scenario).toEqual(activeHistory);
              expect(fetchGuard, `${scenario}: after resume`).not.toHaveBeenCalled();
            }

            if (scenario in activation) {
              const differentOverride = idiotBoss
                ? 'idiot-boss worker=fixture-worker@high'
                : `genius-boss${command.includes(' dual') ? ' dual' : ''} ceo=fixture-muse@max`;
              await expect(session.runCommand('fusion', differentOverride), scenario).rejects.toThrow(
                /fixed|lifetime|session/i,
              );
              expect(await session.getStatus(), scenario).toMatchObject({
                model: activeModel,
                thinkingEffort: activeEffort,
              });
              expect(await agentIds(), scenario).toEqual(activeIds);
              expect(await memberBindings(), scenario).toEqual(members);
              expect(await profileHistory(activeIds), scenario).toEqual(activeHistory);
              expect(fetchGuard, scenario).not.toHaveBeenCalled();
            }

            const otherStrategy = idiotBoss ? 'genius-boss' : 'idiot-boss';
            await expect(session.runCommand('fusion', otherStrategy), scenario).rejects.toThrow(
              /strategy|already|off|active/i,
            );
            expect(await session.getStatus(), scenario).toMatchObject({
              model: activeModel,
              thinkingEffort: activeEffort,
            });
            expect(await agentIds(), scenario).toEqual(activeIds);
            expect(await memberBindings(), scenario).toEqual(members);
            expect(await profileHistory(activeIds), scenario).toEqual(activeHistory);

            await expect(session.runCommand('fusion', 'off'), scenario).resolves.toBeUndefined();
            expect(await session.getStatus(), scenario).toMatchObject(unchanged);
            await session.runCommand('fusion', 'status');
            expect(await session.getStatus(), scenario).toMatchObject(unchanged);
            expect(fetchGuard, scenario).not.toHaveBeenCalled();
          } finally {
            await session.close();
          }
        } finally {
          await harness.close();
        }
      }
    } finally {
      try {
        expect(fetchGuard).not.toHaveBeenCalled();
      } finally {
        fetchGuard.mockRestore();
        vi.unstubAllEnvs();
      }
    }
  }, 30_000);

  it('fails loudly with not_implemented for methods not yet migrated', async () => {
    const { harness } = await makeHarness();
    try {
      // `deleteSession` is the permanent case: the v2 engine has no
      // session-deletion capability, so it stays not_implemented by design
      // (tracked in `.tmp/v2-migration-tracker.md`).
      await expect(harness.deleteSession('session_missing')).rejects.toThrowError(KimiError);
      await expect(harness.deleteSession('session_missing')).rejects.toMatchObject({
        code: ErrorCodes.NOT_IMPLEMENTED,
      });
    } finally {
      await harness.close();
    }
  });
});

describe('SDKRpcClientV2 workspace trust', () => {
  it('reports an untrusted workspace with the project MCP servers it gates', async () => {
    const { harness } = await makeHarness();
    const workDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-work-'));
    tempDirs.push(workDir);
    await writeFile(
      join(workDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'root-server': { command: 'root-cmd' } } }),
      'utf-8',
    );
    await mkdir(join(workDir, '.kimi-code'), { recursive: true });
    await writeFile(
      join(workDir, '.kimi-code', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'nested-server': { command: 'nested-cmd' } } }),
      'utf-8',
    );
    try {
      const info = await harness.getWorkspaceTrustInfo(workDir);
      expect(info.trusted).toBe(false);
      expect(info.gatedMcpServers).toEqual(['nested-server', 'root-server']);
    } finally {
      await harness.close();
    }
  });

  it('degrades the gated-server list to empty on an invalid project mcp.json', async () => {
    const { harness } = await makeHarness();
    const workDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-work-'));
    tempDirs.push(workDir);
    await writeFile(join(workDir, '.mcp.json'), '{not json', 'utf-8');
    try {
      const info = await harness.getWorkspaceTrustInfo(workDir);
      expect(info).toEqual({ trusted: false, gatedMcpServers: [] });
    } finally {
      await harness.close();
    }
  });

  it('trustWorkspace flips the state and persists the marker in the kimi home', async () => {
    const { harness, homeDir } = await makeHarness();
    const workDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-work-'));
    tempDirs.push(workDir);
    try {
      await harness.trustWorkspace(workDir);
      expect(await harness.getWorkspaceTrustInfo(workDir)).toEqual({
        trusted: true,
        gatedMcpServers: [],
      });
      // The trust marker lives in the kimi home, never in the checkout.
      const markers = await readdir(join(homeDir, 'workspace-trust'));
      expect(markers.length).toBe(1);
      expect(await readdir(workDir)).not.toContain('workspace-trust');
    } finally {
      await harness.close();
    }
  });
});

describe('foldAgentWireReplay', () => {
  it('folds a journal into v1 replay records and the tool store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-fold-'));
    tempDirs.push(dir);
    const wirePath = join(dir, 'wire.jsonl');
    const records = [
      { type: 'metadata', protocol_version: '1.5', created_at: 1000 },
      {
        type: 'context.append_message',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] },
        time: 1001,
      },
      { type: 'permission.set_mode', mode: 'auto', time: 1002 },
      {
        type: 'tools.update_store',
        key: 'todo',
        value: [{ title: 'old', status: 'done' }],
        time: 1003,
      },
      {
        type: 'tools.update_store',
        key: 'todo',
        value: [{ title: 'new', status: 'pending' }],
        time: 1004,
      },
      // A v2-only op the v1 restore switch does not know: ignored.
      { type: 'profile.bind', profileName: 'agent', systemPrompt: 'x', thinkingEffort: 'off', disallowedTools: [], time: 1005 },
    ];
    await writeFile(wirePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf-8');
    const folded = await foldAgentWireReplay(wirePath);
    expect(folded.replay).toEqual([
      {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] },
        time: 1001,
      },
      { type: 'permission_updated', mode: 'auto', time: 1002 },
    ]);
    // Last write wins per store key.
    expect(folded.toolStore).toEqual({ todo: [{ title: 'new', status: 'pending' }] });
  });

  it('degrades to an empty fold on a missing or corrupt journal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-fold-'));
    tempDirs.push(dir);
    const empty = { replay: [], toolStore: {} };
    await expect(foldAgentWireReplay(join(dir, 'missing.jsonl'))).resolves.toEqual(empty);
    const emptyFile = join(dir, 'empty.jsonl');
    await writeFile(emptyFile, '', 'utf-8');
    await expect(foldAgentWireReplay(emptyFile)).resolves.toEqual(empty);
    const corrupt = join(dir, 'corrupt.jsonl');
    await writeFile(
      corrupt,
      '{"type":"metadata","protocol_version":"1.5","created_at":1}\n{not json\n{"type":"permission.set_mode","mode":"auto"}\n',
      'utf-8',
    );
    await expect(foldAgentWireReplay(corrupt)).resolves.toEqual(empty);
    // A truncated TAIL line is tolerated: everything before it still folds.
    const truncatedTail = join(dir, 'truncated.jsonl');
    await writeFile(
      truncatedTail,
      '{"type":"metadata","protocol_version":"1.5","created_at":1}\n{"type":"permission.set_mode","mode":"auto","time":2}\n{"type":"context.append_messa',
      'utf-8',
    );
    const folded = await foldAgentWireReplay(truncatedTail);
    expect(folded.replay).toEqual([{ type: 'permission_updated', mode: 'auto', time: 2 }]);
  });
});

describe('SDKRpcClientV2 engine telemetry', () => {
  it('forwards engine-side events to the host-supplied telemetry client', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-tel-'));
    tempDirs.push(homeDir);
    const workDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-tel-work-'));
    tempDirs.push(workDir);
    const records: TelemetryRecord[] = [];
    const harness = createKimiHarnessV2({
      homeDir,
      identity: TEST_IDENTITY,
      telemetry: recordingTelemetry(records),
    });
    try {
      const session = await harness.createSession({ workDir });
      await session.setPermission('yolo');
      expect(records.some((record) => record.event === 'yolo_toggle')).toBe(true);
      await session.close();
    } finally {
      await harness.close();
    }
  });

  it('honors telemetry = false for engine-side events', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-tel-off-'));
    tempDirs.push(homeDir);
    const workDir = await mkdtemp(join(tmpdir(), 'kimi-sdk-v2-tel-off-work-'));
    tempDirs.push(workDir);
    await writeFile(join(homeDir, 'config.toml'), 'telemetry = false\n', 'utf-8');
    const records: TelemetryRecord[] = [];
    const harness = createKimiHarnessV2({
      homeDir,
      identity: TEST_IDENTITY,
      telemetry: recordingTelemetry(records),
    });
    try {
      const session = await harness.createSession({ workDir });
      await session.setPermission('yolo');
      expect(records.some((record) => record.event === 'yolo_toggle')).toBe(false);
      await session.close();
    } finally {
      await harness.close();
    }
  });
});

describe('removeProviderFromConfig', () => {
  it('drops the provider, its models and dangling default pointers without mutating the input', () => {
    const config = {
      providers: {
        a: { type: 'openai', baseUrl: 'https://a.example.test/v1' },
        b: { type: 'openai', baseUrl: 'https://b.example.test/v1' },
      },
      models: {
        'a/m1': { provider: 'a', model: 'm1', maxContextSize: 100 },
        'b/m1': { provider: 'b', model: 'm1', maxContextSize: 100 },
        'my-b': { provider: 'b', model: 'm1', maxContextSize: 100 },
      },
      defaultModel: 'my-b',
      defaultProvider: 'b',
    } as unknown as KimiConfig;

    const next = removeProviderFromConfig(config, 'b');

    expect(Object.keys(next.providers)).toEqual(['a']);
    expect(Object.keys(next.models ?? {})).toEqual(['a/m1']);
    expect(next.defaultModel).toBeUndefined();
    expect(next.defaultProvider).toBeUndefined();
    // The input config is left untouched (the staging host threads the copy).
    expect(config.providers['b']).toBeDefined();
    expect(config.models?.['b/m1']).toBeDefined();
    expect(config.defaultModel).toBe('my-b');
  });

  it('keeps the default pointers when they do not dangle', () => {
    const config = {
      providers: {
        a: { type: 'openai' },
        b: { type: 'openai' },
      },
      models: {
        'a/m1': { provider: 'a', model: 'm1', maxContextSize: 100 },
        'b/m1': { provider: 'b', model: 'm1', maxContextSize: 100 },
      },
      defaultModel: 'a/m1',
      defaultProvider: 'a',
    } as unknown as KimiConfig;

    const next = removeProviderFromConfig(config, 'b');

    expect(Object.keys(next.providers)).toEqual(['a']);
    expect(Object.keys(next.models ?? {})).toEqual(['a/m1']);
    expect(next.defaultModel).toBe('a/m1');
    expect(next.defaultProvider).toBe('a');
  });
});

async function writeSkill(dir: string, name: string): Promise<void> {  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Skill ${name} for the escape-hatch test\n---\n\nBody of ${name}.\n`,
    'utf-8',
  );
}
