/**
 * Scenario: persistent Fusion membership, model policy, mailbox and guarded delegation.
 * Wiring: real Session coordinator and Agent facade resolved through DI;
 * lifecycle/model/store/runner and official Claude transport are deterministic fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { createDecorator } from '#/_base/di/instantiation';
import { CommandContribution } from '#/agent/command/commandContribution';
import { FusionFeature } from '#/features/fusion/fusionFeature';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import { IAgentContextInjectorService, type ContextInjectionProvider } from '#/agent/contextInjector/contextInjector';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { IAgentPermissionRulesService } from '#/agent/permissionRules/permissionRules';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import type { BeforeToolExecuteEvent, ToolDidExecuteContext } from '#/agent/toolExecutor/toolHooks';
import { IAgentUserToolService } from '#/agent/userTool/userTool';
import { IConfigService } from '#/app/config/config';
import { IFlagService } from '#/app/flag/flag';
import { IAgentPlanService } from '#/features/plan/plan';
import { IModelCatalog, type Model } from '#/kosong/model/catalog';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionSubagentService } from '#/session/subagent/subagent';
import { DEFAULT_FUSION_CONFIG } from '#/features/fusion/configSection';
import { IAgentFusionTeamService, ISessionFusionTeamService, roleGuidance, type FusionMember, type FusionMail, type FusionTeamState } from '#/features/fusion/fusionTeam';
import { SessionFusionTeamService } from '#/features/fusion/fusionTeamService';
import { AgentFusionTeamService } from '#/features/fusion/fusionTeamActorService';
import { resolveFusionModel } from '#/features/fusion/modelPolicy';
import { hasClaudeApiKeyCredential, readClaudeSubscriptionAuth, resolveClaudeExecutable, runClaudeDecision } from '#/features/fusion/claudeTransport';
import { IEventBus, type DomainEvent } from '#/app/event/eventBus';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IAgentTokenCountingService } from '#/agent/tokenCounting/tokenCounting';
import type { TurnStartedEvent } from '#/agent/loop/turnEvents';
import { FusionTeamTool } from '#/features/fusion/tools/fusionTeamTool';
import { IWireService } from '#/wire/wire';
import { stubAgentWire } from '../wire/stubs';
import { agentService, createTestAgent, InMemoryWireRecordPersistence } from '../harness';

vi.mock('#/features/fusion/claudeTransport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/features/fusion/claudeTransport')>();
  return {
    ...actual,
    readClaudeSubscriptionAuth: vi.fn(),
    resolveClaudeExecutable: vi.fn(),
    runClaudeDecision: vi.fn(),
  };
});

let containers: TestInstantiationService[];
let document: FusionTeamState | undefined;
let models: Map<string, Model>;
let scopes: Map<string, IAgentScopeHandle>;
let running: Set<string>;
let plans: Set<string>;
let selectedModels: Map<string, string>;
let modes: Map<string, string>;
let flag: boolean;
let created: string[];
let injected: { id: string; text: string }[];
let run: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<{ completion: Promise<{ summary: string }> }>>>;
let team: ISessionFusionTeamService;
let events: DomainEvent[];
const startHook = vi.fn(async () => {});
const stopHook = vi.fn();

function scope(id: string): IAgentScopeHandle {
  return { id, accessor: { get(token: unknown) {
    if (token === IEventBus) return { publish: (event: DomainEvent) => events.push(event) };
    if (token === ITelemetryService) return { track2: vi.fn() };
    if (token === IAgentLifecycleService) return { get: (target: string) => scopes.get(target) };
    if (token === IAgentTokenCountingService) return { statusSize: () => 42 };
    if (token === ISessionSubagentService) return { hooks: { onWillStartAgentTask: { run: startHook } }, notifyAgentTaskStopped: stopHook };
    if (token === IAgentLoopService) return {
      status: () => ({ state: running.has(id) ? 'running' : 'idle' }),
      tryAcquireQuiescence: () => running.has(id) ? undefined : { dispose() {} },
    };
    if (token === IAgentPlanService) return { status: async () => plans.has(id) ? { id: 'plan', path: 'plan.md', content: '' } : null };
    if (token === IAgentPermissionModeService) return { mode: modes.get(id) ?? 'manual', setMode: (mode: string) => modes.set(id, mode) };
    if (token === IAgentPermissionRulesService) return { rules: [], addRules: vi.fn() };
    if (token === IAgentUserToolService) return { inheritUserTools: vi.fn() };
    if (token === IAgentPromptService) return { inject: async (message: { content: { text: string }[] }) => { injected.push({ id, text: message.content[0]!.text }); } };
    if (token === IAgentProfileService) return {
      data: () => ({ profileName: 'coder', modelAlias: selectedModels.get(id) ?? 'original', thinkingLevel: 'low', systemPrompt: 'Original prompt', activeToolNames: ['Read'] }),
      applyBindingSnapshot: (snapshot: { modelAlias: string }) => selectedModels.set(id, snapshot.modelAlias),
      republishStatus: vi.fn(),
      addActiveTool: vi.fn(),
      bind: async (binding: { model: string; strictThinking: boolean }) => {
        expect(binding.strictThinking).toBe(true);
        selectedModels.set(id, binding.model);
      },
      getModel: () => selectedModels.get(id),
      getEffectiveThinkingLevel: () => models.get(selectedModels.get(id) ?? '')?.supportEfforts?.[0],
      update: vi.fn(),
    };
    throw new Error(`Unexpected service ${String(token)}`);
  } } } as unknown as IAgentScopeHandle;
}
function catalog() {
  return {
    get: (id: string) => { const model = models.get(id); if (model === undefined) throw new Error(`missing ${id}`); return model; },
    findByName: (name: string) => [...models.values()].filter((model) => model.name === name).map((model) => model.id),
    listModels: async () => [...models.values()].map((model) => ({ model: model.id, display_name: model.displayName })),
  } as unknown as IModelCatalog;
}
function host(): TestInstantiationService {
  const ix = new TestInstantiationService();
  containers.push(ix);
  ix.stub(IAtomicDocumentStore, {
    get: async () => document === undefined ? undefined : structuredClone(document),
    set: async (_scope: string, _key: string, value: unknown) => { document = structuredClone(value) as FusionTeamState; },
  } as unknown as IAtomicDocumentStore);
  ix.stub(ISessionContext, { cwd: 'C:/example/project', scope: (sub?: string) => `session/${sub ?? ''}` });
  ix.stub(IConfigService, { get: () => DEFAULT_FUSION_CONFIG } as unknown as IConfigService);
  ix.stub(IFlagService, { enabled: () => flag });
  ix.stub(IModelCatalog, catalog());
  ix.stub(IAgentLifecycleService, {
    get: (id: string) => scopes.get(id),
    create: async (options: { agentId: string; binding: { model: string; strictThinking: boolean } }) => {
      expect(options.binding.strictThinking).toBe(true);
      created.push(options.agentId);
      const handle = scope(options.agentId);
      scopes.set(options.agentId, handle);
      selectedModels.set(options.agentId, options.binding.model);
      return handle;
    },
  } as unknown as IAgentLifecycleService);
  ix.stub(ISessionSubagentService, { run: (...args: unknown[]) => run(...args) } as unknown as ISessionSubagentService);
  ix.set(ISessionFusionTeamService, new SyncDescriptor(SessionFusionTeamService));
  return ix;
}
async function member(name: string): Promise<FusionMember> {
  const id = (await team.status()).team!.members.find((entry) => entry.name === name)!.id;
  return (await team.member(id))!;
}

beforeEach(() => {
  containers = [];
  document = undefined;
  models = new Map();
  for (const [name, effort] of [[DEFAULT_FUSION_CONFIG.ceoModel, 'xhigh'], [DEFAULT_FUSION_CONFIG.cooModel, 'xhigh'], [DEFAULT_FUSION_CONFIG.workerModel, 'high'], [DEFAULT_FUSION_CONFIG.coordinatorModel, 'high'], [DEFAULT_FUSION_CONFIG.museModel, 'max'], [DEFAULT_FUSION_CONFIG.terraModel, 'xhigh']]) {
    models.set(name!, { id: name, name, aliases: [], supportEfforts: [effort] } as unknown as Model);
  }
  scopes = new Map([['main', scope('main')]]);
  running = new Set();
  plans = new Set();
  selectedModels = new Map();
  modes = new Map([['main', 'auto']]);
  flag = true;
  created = [];
  injected = [];
  events = [];
  startHook.mockClear();
  stopHook.mockClear();
  run = vi.fn(async (agentId) => ({ agentId, completion: Promise.resolve({ summary: 'Verified: test passed.' }) }));
  vi.mocked(resolveClaudeExecutable).mockReset().mockReturnValue(undefined);
  vi.mocked(readClaudeSubscriptionAuth).mockReset().mockReturnValue({ fileFound: true, fileState: 'parsed', authenticated: true, subscriptionType: 'pro', rateLimitTier: 'tier-4', expired: false });
  vi.mocked(runClaudeDecision).mockReset().mockImplementation(async (request) => ({ text: 'CEO decision with evidence.', sessionId: request.sessionId }));
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
  team = host().get(ISessionFusionTeamService);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const ix of containers) ix.dispose();
});

describe('Fusion team', () => {
  it.each(['genius-boss', 'idiot-boss'])('applies all activation overrides with stable %s role mappings', async (strategy) => {
    for (const name of ['custom-ceo', 'custom-coo', 'custom-worker', 'custom-muse']) {
      models.set(name, { id: name, name, aliases: [], supportEfforts: ['low'] } as unknown as Model);
    }
    const command = `${strategy}\tdual  ceo=custom-ceo@low coo=custom-coo@low worker=custom-worker@low muse=custom-muse@low`;
    await team.command('main', command);
    const workerName = strategy === 'idiot-boss' ? 'coordinator' : 'worker';
    for (const [name, model] of [['ceo', 'custom-ceo'], ['coo', 'custom-coo'], [workerName, 'custom-worker'], ['consultant', 'custom-muse']]) {
      expect(await member(name!)).toMatchObject({ model, effort: 'low' });
    }
    expect(document!.routing.map((route) => route.reason)).toEqual(['Override: custom-worker', 'Override: custom-ceo', 'Override: custom-coo', 'Override: custom-muse']);
    const ids = document!.members.map((entry) => entry.id);
    const createdCount = created.length;
    await team.command('main', command);
    expect(document!.members.map((entry) => entry.id)).toEqual(ids);
    expect(created).toHaveLength(createdCount);
    await team.command('main', 'off');
    team = host().get(ISessionFusionTeamService);
    await team.command('main', command);
    expect(document!.members.map((entry) => entry.id)).toEqual(ids);
    expect(document!.enabled).toBe(true);
    for (const role of ['ceo', 'coo', 'worker', 'muse']) {
      const changed = 'replacement';
      models.set(changed, { id: changed, name: changed, aliases: [], supportEfforts: ['low'] } as unknown as Model);
      await expect(team.command('main', `${strategy} dual ${role}=${changed}@low`)).rejects.toThrow('fixed');
    }
    expect(document!.members.map((entry) => entry.id)).toEqual(ids);
  });

  it('uses configured role efforts when activation aliases omit effort', async () => {
    for (const name of ['custom-ceo', 'custom-coo', 'custom-worker', 'custom-muse']) {
      models.set(name, { id: name, name, aliases: [], supportEfforts: ['low'] } as unknown as Model);
    }
    const ix = host();
    ix.stub(IConfigService, { get: () => ({ ...DEFAULT_FUSION_CONFIG, ceoEffort: 'low', cooEffort: 'low', workerEffort: 'low', museEffort: 'low' }) } as unknown as IConfigService);
    team = ix.get(ISessionFusionTeamService);
    await team.command('main', 'on dual ceo=custom-ceo coo=custom-coo worker=custom-worker muse=custom-muse');
    expect(document!.members.map((entry) => entry.effort)).toEqual(['low', 'low', 'low', 'low']);
    await team.command('main', 'on ceo=custom-ceo coo=custom-coo worker=custom-worker muse=custom-muse');
    expect(created).toHaveLength(3);
    document = undefined;
    const idiot = host();
    idiot.stub(IConfigService, { get: () => ({ ...DEFAULT_FUSION_CONFIG, workerEffort: 'high', coordinatorEffort: 'low' }) } as unknown as IConfigService);
    team = idiot.get(ISessionFusionTeamService);
    await team.command('main', 'idiot-boss worker=custom-worker');
    expect(await member('coordinator')).toMatchObject({ model: 'custom-worker', effort: 'low' });
    await expect(team.command('main', 'idiot-boss worker=custom-worker')).resolves.toMatchObject({ enabled: true });
  });

  it('keeps configured worker fallbacks independent of the Muse consultant override', async () => {
    const name = 'consultant-only';
    models.set(name, { id: name, name, aliases: [], supportEfforts: ['low'] } as unknown as Model);
    models.delete(DEFAULT_FUSION_CONFIG.workerModel);
    await team.command('main', 'dual muse=consultant-only@low');
    expect(await member('worker')).toMatchObject({ model: DEFAULT_FUSION_CONFIG.museModel, effort: DEFAULT_FUSION_CONFIG.museEffort });
    expect(await member('consultant')).toMatchObject({ model: name, effort: 'low' });
    expect(document!.routing[0]!.reason).toMatch(/Catalog fallback:/);
  });

  it.each(['genius-boss', 'idiot-boss'])('rejects missing, ambiguous and unsupported explicit workers before %s state changes', async (strategy) => {
    for (const id of ['first-worker', 'second-worker']) {
      models.set(id, { id, name: 'ambiguous-worker', aliases: [], supportEfforts: ['high'] } as unknown as Model);
    }
    for (const [override, reason] of [['missing-worker', 'not configured'], ['ambiguous-worker', 'ambiguous'], [`${DEFAULT_FUSION_CONFIG.workerModel}@low`, 'does not declare support']]) {
      const result = team.command('main', `${strategy} worker=${override}`);
      await expect(result).rejects.toThrow(reason);
      await expect(result).rejects.toThrow(/worker_model.*worker=<alias>.*\/model/);
      expect(document).toBeUndefined();
      expect(created).toHaveLength(0);
      expect(selectedModels.size).toBe(0);
      expect([...scopes.keys()]).toEqual(['main']);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('runs an explicit worker exactly without consulting configured worker fallbacks', async () => {
    const name = 'assigned-worker';
    models.set(name, { id: name, name, aliases: [], supportEfforts: ['low'] } as unknown as Model);
    const modelCatalog = catalog();
    const get = vi.spyOn(modelCatalog, 'get');
    const ix = host();
    ix.stub(IModelCatalog, modelCatalog);
    team = ix.get(ISessionFusionTeamService);
    await team.command('main', `on worker=${name}@low`);
    const worker = await member('worker');
    expect(worker).toMatchObject({ model: name, effort: 'low' });
    expect(document!.routing[0]!.reason).toBe(`Override: ${name}`);
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Run assigned work.' });
    expect(run.mock.calls.map((call) => call[0])).toEqual([worker.id]);
    expect(selectedModels.get(worker.id)).toBe(name);
    expect(get.mock.calls.map((call) => call[0])).toEqual([DEFAULT_FUSION_CONFIG.cooModel, name, DEFAULT_FUSION_CONFIG.ceoModel]);
  });

  it.each(['on unknown=x', 'on ceo=', 'on ceo=a@', 'on ceo=a@high@extra', 'on --ceo=a', 'on ceo=a ceo=b', 'on ceo=a dual', 'off worker=a', 'status muse=a', 'status dual'])('rejects invalid override syntax: %s', async (command) => {
    await expect(team.command('main', command)).rejects.toThrow('expected on');
    expect(document).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it('requires an effective dual consultant for a Muse override', async () => {
    await expect(team.command('main', `on muse=${DEFAULT_FUSION_CONFIG.museModel}`)).rejects.toThrow('requires the dual consultant');
    expect(document).toBeUndefined();
    await team.command('main', 'dual');
    await expect(team.command('main', `on muse=${DEFAULT_FUSION_CONFIG.museModel}`)).resolves.toMatchObject({ enabled: true });
  });

  it('compares resolved aliases and efforts instead of raw override strings', async () => {
    const model = models.get(DEFAULT_FUSION_CONFIG.ceoModel)!;
    models.set(model.id, { ...model, name: 'friendly-ceo', supportEfforts: [DEFAULT_FUSION_CONFIG.ceoEffort, 'low'] });
    await team.command('main', 'on ceo=friendly-ceo');
    await expect(team.command('main', `on ceo=${model.id}@${DEFAULT_FUSION_CONFIG.ceoEffort}`)).resolves.toMatchObject({ enabled: true });
    await expect(team.command('main', 'on ceo=friendly-ceo@low')).rejects.toThrow('start a new session');
    expect((await member('ceo')).effort).toBe(DEFAULT_FUSION_CONFIG.ceoEffort);
  });

  it.each(['ceo', 'coo', 'muse'])('returns actionable %s resolution errors without creating a team', async (role) => {
    await expect(team.command('main', `dual ${role}=unconfigured`)).rejects.toThrow(new RegExp(`${role}_model.*${role}=<alias>.*\\/model`));
    expect(document).toBeUndefined();
    if (role === 'ceo') {
      await expect(team.command('main', 'on ceo=unconfigured')).rejects.toThrow('official Claude Code CLI on PATH and run andrewcode login claude');
    }
  });

  it('does not use Claude CLI for explicitly overridden CEO aliases or unsupported efforts', async () => {
    vi.mocked(resolveClaudeExecutable).mockReturnValue('claude');
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    await expect(team.command('main', `on ceo=${DEFAULT_FUSION_CONFIG.ceoModel}`)).rejects.toThrow('ceo_model');
    await expect(team.command('main', 'on ceo=custom-missing')).rejects.toThrow('ceo_model');
    models.set(DEFAULT_FUSION_CONFIG.ceoModel, { id: DEFAULT_FUSION_CONFIG.ceoModel, name: DEFAULT_FUSION_CONFIG.ceoModel, aliases: [], supportEfforts: ['low'] } as unknown as Model);
    await expect(team.command('main', 'on')).rejects.toThrow('does not declare support');
    expect(document).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it('mentions subscription tier in remedy when Claude CLI is absent but subscription is authenticated', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue(undefined);
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({
      fileFound: true,
      fileState: 'parsed',
      authenticated: true,
      subscriptionType: 'Pro',
      rateLimitTier: 'tier-4',
      expired: false,
    });
    await expect(team.command('main', 'on')).rejects.toThrow(/tier-4/);
    await expect(team.command('main', 'on')).rejects.toThrow(/authenticated as Pro \(tier-4\)/);
    expect(document).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it('mentions login in remedy when Claude CLI is absent and subscription is unauthenticated or missing', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue(undefined);
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({ fileFound: true, fileState: 'parsed', authenticated: false, expired: false });
    await expect(team.command('main', 'on')).rejects.toThrow(/andrewcode login claude/);
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({ fileFound: false, fileState: 'missing', authenticated: false, expired: false });
    await expect(team.command('main', 'on')).rejects.toThrow(/credentials file not found — install Claude Code and run `andrewcode login claude`/);
    expect(document).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it('rejects before team persistence when Claude CLI is present but unauthenticated', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({ fileFound: true, fileState: 'parsed', authenticated: false, expired: false });
    await expect(team.command('main', 'on')).rejects.toThrow('Claude Code CLI is installed but its subscription is not authenticated; run `andrewcode login claude`.');
    expect(document).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it.each(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])('proceeds with claude CEO member when Claude CLI is present, unauthenticated, but %s is set', async (envKey) => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({ fileFound: true, fileState: 'parsed', authenticated: false, expired: false });
    vi.stubEnv(envKey, 'test-credential-value');
    await team.command('main', 'on');
    const ceo = await member('ceo');
    expect(ceo.transport).toBe('claude');
    expect(document).toBeDefined();
    expect(document!.members.find((entry) => entry.role === 'ceo')?.transport).toBe('claude');
  });

  it('still rejects before team persistence when Claude CLI is present, unauthenticated, and API keys are empty or whitespace', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({ fileFound: true, fileState: 'parsed', authenticated: false, expired: false });
    vi.stubEnv('ANTHROPIC_API_KEY', '   ');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    await expect(team.command('main', 'on')).rejects.toThrow('Claude Code CLI is installed but its subscription is not authenticated; run `andrewcode login claude`.');
    expect(document).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it('proceeds with claude CEO member when Claude CLI is present and authenticated', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({
      fileFound: true,
      fileState: 'parsed',
      authenticated: true,
      subscriptionType: 'Pro',
      rateLimitTier: 'tier-4',
      expired: false,
    });
    await team.command('main', 'on');
    const ceo = await member('ceo');
    expect(ceo.transport).toBe('claude');
    expect(document).toBeDefined();
    expect(document!.members.find((entry) => entry.role === 'ceo')?.transport).toBe('claude');
  });

  it('rejects missing custom ceo_model alias even when subscription is authenticated', async () => {
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({
      fileFound: true,
      fileState: 'parsed',
      authenticated: true,
      subscriptionType: 'Pro',
      rateLimitTier: 'tier-4',
      expired: false,
    });
    await expect(team.command('main', 'on ceo=custom-missing')).rejects.toThrow('ceo_model');
    expect(document).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it('reports bounded claudeSubscription in status view when a claude member exists', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({
      fileFound: true,
      fileState: 'parsed',
      authenticated: true,
      subscriptionType: 'Pro',
      rateLimitTier: 'tier-4',
      expired: false,
    });
    await team.command('main', 'on');
    let status = await team.status();
    expect(status.team!.claudeSubscription).toBe('authenticated');

    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({ fileFound: true, fileState: 'parsed', authenticated: false, expired: false });
    status = await team.status();
    expect(status.team!.claudeSubscription).toBe('unauthenticated');

    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({ fileFound: false, fileState: 'missing', authenticated: false, expired: false });
    status = await team.status();
    expect(status.team!.claudeSubscription).toBe('unavailable');

    vi.mocked(resolveClaudeExecutable).mockReturnValue(undefined);
    status = await team.status();
    expect(status.team!.claudeSubscription).toBe('unavailable');
  });

  it('omits claudeSubscription from status view when no claude member exists', async () => {
    await team.command('main', 'on');
    const status = await team.status();
    expect(status.team!.claudeSubscription).toBeUndefined();
  });

  it('reports claudeSubscriptionExpired in status view when subscription is authenticated and expired', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({
      fileFound: true,
      fileState: 'parsed',
      authenticated: true,
      subscriptionType: 'Pro',
      rateLimitTier: 'tier-4',
      expiresAt: Date.now() - 10_000,
      expired: true,
    });
    await team.command('main', 'on');
    const status = await team.status();
    expect(status.team!.claudeSubscription).toBe('authenticated');
    expect(status.team!.claudeSubscriptionExpired).toBe(true);
  });

  it('appends expired note to remedy text when subscription is authenticated but expired', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue(undefined);
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({
      fileFound: true,
      fileState: 'parsed',
      authenticated: true,
      subscriptionType: 'Pro',
      rateLimitTier: 'tier-4',
      expiresAt: Date.now() - 10_000,
      expired: true,
    });
    await expect(team.command('main', 'on')).rejects.toThrow('access token expired; the CLI will refresh it — re-run `andrewcode login claude` if that fails.');
  });

  it('reports unreadable-file remedy wording when credentials file is corrupt or unreadable', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue(undefined);
    vi.mocked(readClaudeSubscriptionAuth).mockReturnValue({
      fileFound: false,
      fileState: 'unreadable',
      authenticated: false,
      expired: false,
    });
    await expect(team.command('main', 'on')).rejects.toThrow('Claude Code credentials file exists but could not be read (corrupt or unreadable); run `andrewcode login claude` to rewrite it.');
    expect(document).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it('starts despite global enabled=false, creates one worker and persists stable IDs', async () => {
    await Promise.all([team.command('main', 'on'), team.command('main', 'on')]);
    expect(created).toHaveLength(2);
    expect((await team.status()).team!.members.map((entry) => entry.role)).toEqual(['ceo', 'coo', 'worker']);
    expect(selectedModels.get('main')).toBe(DEFAULT_FUSION_CONFIG.ceoModel);
    const worker = await member('worker');
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Implement and verify.' });
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Add another regression.' });
    expect(run.mock.calls.map((call) => call[0])).toEqual([worker.id, worker.id]);
    scopes.delete(worker.id);
    team = host().get(ISessionFusionTeamService);
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Continue after reload.' });
    expect(run.mock.calls[2]![0]).toBe(worker.id);
    expect((await member('worker')).runs).toBe(3);
    expect(modes.get(worker.id)).toBe('auto');
  });

  it('falls through unavailable workers in order and never retries primary every handoff', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.workerModel);
    await team.command('main', 'on');
    expect((await member('worker')).model).toBe(DEFAULT_FUSION_CONFIG.museModel);
    expect((await member('worker')).effort).toBe('max');
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Work.' });
    expect((await team.status()).team!.routing[0]!.reason).toContain('Catalog fallback');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('uses Terra only after Gemini and Muse are unavailable', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.workerModel);
    models.delete(DEFAULT_FUSION_CONFIG.museModel);
    await team.command('main', 'on');
    expect((await member('worker')).model).toBe(DEFAULT_FUSION_CONFIG.terraModel);
  });

  it('rejects missing frontier models and unsupported explicit efforts before activation', async () => {
    models.set(DEFAULT_FUSION_CONFIG.cooModel, { ...models.get(DEFAULT_FUSION_CONFIG.cooModel)!, supportEfforts: ['low'] });
    await expect(team.command('main', 'on')).rejects.toThrow('does not declare support');
    expect((await team.status()).enabled).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('requires the experimental flag and rejects unknown commands', async () => {
    flag = false;
    await expect(team.command('main', 'on')).rejects.toThrow('experimental flag');
    await expect(team.command('main', 'restart')).rejects.toThrow('expected on');
    expect(await team.command('main', 'status')).toEqual({ enabled: false, team: undefined });
  });

  it('delivers three-way broadcasts independently and acknowledgments affect only recipient', async () => {
    await team.command('main', 'on');
    const coo = await member('coo');
    const worker = await member('worker');
    await team.execute('main', { action: 'broadcast', text: 'Acceptance changed.' });
    const cooMail = await team.execute(coo.id, { action: 'inbox' }) as FusionMail[];
    const workerMail = await team.execute(worker.id, { action: 'inbox' }) as FusionMail[];
    expect(cooMail[0]!.from).toBe('main');
    expect(workerMail[0]!.text).toBe('Acceptance changed.');
    await team.execute(coo.id, { action: 'ack', ids: [cooMail[0]!.id, workerMail[0]!.id] });
    expect(await team.execute(worker.id, { action: 'inbox' })).toHaveLength(1);
    team = host().get(ISessionFusionTeamService);
    expect(await team.execute(coo.id, { action: 'inbox' })).toEqual([]);
    expect(await team.execute(worker.id, { action: 'inbox' })).toHaveLength(1);
    await team.execute(worker.id, { action: 'message', target: 'ceo', text: 'Blocked: please decide.' });
    expect(await team.execute('main', { action: 'inbox' })).toMatchObject([{ from: worker.id }]);
  });

  it('injects running recipients, queues idle recipients, and never starts a duplicate run', async () => {
    await team.command('main', 'on');
    const worker = await member('worker');
    running.add(worker.id);
    expect(await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Also fix the edge.' })).toMatchObject({ status: 'injected' });
    expect(injected[0]).toMatchObject({ id: worker.id });
    expect(run).not.toHaveBeenCalled();
    running.clear();
    await team.execute('main', { action: 'message', target: 'worker', text: 'Queued detail.' });
    expect(await team.execute(worker.id, { action: 'inbox' })).toHaveLength(2);
  });

  it('bounds packets, queues and worker spawning and rejects role spoofing', async () => {
    await team.command('main', 'on');
    const worker = await member('worker');
    await expect(team.execute(worker.id, { action: 'spawn', name: 'rogue', reason: 'More.' })).rejects.toThrow('only CEO/COO');
    await expect(team.execute(worker.id, { action: 'route', target: 'worker', model: DEFAULT_FUSION_CONFIG.terraModel, effort: 'xhigh', reason: 'More.' })).rejects.toThrow('only CEO/COO');
    await expect(team.execute('outsider', { action: 'inbox' })).rejects.toThrow('sender');
    await expect(team.execute('main', { action: 'message', target: 'worker', text: 'a'.repeat(12_001) })).rejects.toThrow();
    for (let i = 0; i < 100; i++) await team.execute('main', { action: 'message', target: 'worker', text: 'x' });
    await expect(team.execute('main', { action: 'message', target: 'worker', text: 'overflow' })).rejects.toThrow('full');
    for (const name of ['one', 'two', 'three']) await team.execute('main', { action: 'spawn', name, reason: 'Independent task.' });
    await expect(team.execute('main', { action: 'spawn', name: 'four', reason: 'Too many.' })).rejects.toThrow('worker limit');
  });

  it('prevents self and synchronous cycles while allowing messages to waiting leaders', async () => {
    await team.command('main', 'on');
    await expect(team.execute('main', { action: 'handoff', target: 'ceo', brief: 'Self.' })).rejects.toThrow('cycle');
    const coo = await member('coo');
    let finish!: (value: { summary: string }) => void;
    run.mockImplementation(async () => ({ completion: new Promise((resolve) => { finish = resolve; }) }));
    const pending = team.execute('main', { action: 'handoff', target: 'coo', brief: 'Coordinate.' });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await expect(team.execute(coo.id, { action: 'handoff', target: 'ceo', brief: 'Cycle.' })).rejects.toThrow('cycle');
    await team.execute(coo.id, { action: 'message', target: 'ceo', text: 'Question, asynchronously.' });
    await expect(team.command('main', 'off')).rejects.toThrow('busy');
    finish({ summary: 'Done.' });
    await pending;
    await team.command('main', 'off');
    expect((await team.status()).enabled).toBe(false);
  });

  it('reroutes only idle workers, persists reason and never downgrades leaders', async () => {
    await team.command('main', 'on');
    const worker = await member('worker');
    const route = { action: 'route' as const, target: 'worker', model: DEFAULT_FUSION_CONFIG.terraModel, effort: 'xhigh', reason: 'Needs deeper diagnosis.' };
    running.add(worker.id);
    await expect(team.execute('main', route)).rejects.toThrow('idle');
    running.clear();
    await expect(team.execute('main', { ...route, target: 'ceo' })).rejects.toThrow('never leaders');
    await team.execute('main', route);
    expect((await member('worker')).model).toBe(DEFAULT_FUSION_CONFIG.terraModel);
    expect((await team.status()).team!.routing.at(-1)!.reason).toBe(route.reason);
  });

  it('preserves cancellation and failures without replaying potentially executed edits', async () => {
    await team.command('main', 'on');
    run.mockRejectedValueOnce(new Error('provider unavailable after editing'));
    expect(await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Edit.' })).toMatchObject({ status: 'failed' });
    expect(run).toHaveBeenCalledTimes(1);
    run.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
    expect(await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Edit.' })).toMatchObject({ status: 'cancelled' });
    expect((await member('worker'))).toMatchObject({ failures: 1, cancellations: 1 });
  });

  it('uses stable official Claude CEO sessions only when the default native CEO is missing', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    await team.command('main', 'on');
    expect(selectedModels.get('main')).toBe(DEFAULT_FUSION_CONFIG.cooModel);
    const ceo = await member('ceo');
    expect(ceo.transport).toBe('claude');
    await team.execute('main', { action: 'handoff', target: 'ceo', brief: 'Decide the plan.' });
    team = host().get(ISessionFusionTeamService);
    await team.execute('main', { action: 'handoff', target: 'ceo', brief: 'Review evidence.' });
    expect(vi.mocked(runClaudeDecision).mock.calls.map(([request]) => [request.sessionId, request.resume, request.model])).toEqual([[ceo.sessionId, false, DEFAULT_FUSION_CONFIG.claudeModel], [ceo.sessionId, true, DEFAULT_FUSION_CONFIG.claudeModel]]);
    vi.mocked(runClaudeDecision).mockRejectedValueOnce(new Error('CLI auth failed'));
    expect(await team.execute('main', { action: 'handoff', target: 'ceo', brief: 'Review.' })).toMatchObject({ status: 'failed' });
  });

  it('adds an optional persistent consultant and propagates inherited plan restrictions', async () => {
    await team.command('main', 'dual');
    const consultant = await member('consultant');
    expect(consultant).toMatchObject({ model: DEFAULT_FUSION_CONFIG.museModel, effort: 'max' });
    expect(await team.restricted(consultant.id)).toBe(true);
    plans.add('main');
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Inspect only.' });
    expect(await team.restricted((await member('worker')).id)).toBe(true);
  });

  it('matches exact versions and rejects ambiguous aliases rather than fuzzy substitution', async () => {
    const original = models.get(DEFAULT_FUSION_CONFIG.workerModel)!;
    models.delete(original.id);
    models.set('configured-flash', { ...original, id: 'configured-flash', name: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' });
    expect((await resolveFusionModel(catalog(), 'Gemini 3.8 Flash', 'high')).id).toBe('configured-flash');
    await expect(resolveFusionModel(catalog(), 'Gemini 3.7 Flash', 'high')).rejects.toThrow('not configured');
    models.set('second-flash', { ...original, id: 'second-flash', displayName: 'Gemini 3.8 Flash' });
    await expect(resolveFusionModel(catalog(), 'Gemini 3.8 Flash', 'high')).rejects.toThrow('ambiguous');
  });

  it('enforces consultant read-only at tool execution and contributes only its role guidance', async () => {
    await team.command('main', 'dual');
    const consultant = await member('consultant');
    let guard!: (event: BeforeToolExecuteEvent) => Promise<void>;
    let guidance!: ContextInjectionProvider;
    const ix = new TestInstantiationService();
    containers.push(ix);
    ix.stub(ISessionFusionTeamService, team);
    ix.stub(IWireService, stubAgentWire());
    ix.stub(IEventBus, { subscribe: () => ({ dispose() {} }), publish: (event) => events.push(event) });
    ix.stub(IAgentScopeContext, { agentId: consultant.id });
    ix.stub(IAgentContextMemoryService, { append: vi.fn() });
    ix.stub(IAgentContextInjectorService, { register: (_name: string, provider: ContextInjectionProvider) => { guidance = provider; return { dispose() {} }; } });
    ix.stub(IAgentToolExecutorService, { hooks: { onDidExecuteTool: { register: () => ({ dispose() {} }) } }, onBeforeExecuteTool: (handler: unknown) => { guard = handler as typeof guard; return { dispose() {} }; } } as unknown as IAgentToolExecutorService);
    ix.set(IAgentFusionTeamService, new SyncDescriptor(AgentFusionTeamService));
    ix.get(IAgentFusionTeamService);
    const veto = vi.fn();
    for (const name of ['Bash', 'Edit', 'Write', 'Agent', 'Sidekick']) {
      await guard({ toolCall: { name }, args: {}, veto } as unknown as BeforeToolExecuteEvent);
    }
    expect(veto).toHaveBeenCalledTimes(5);
    veto.mockClear();
    await guard({ toolCall: { name: 'Read' }, args: {}, veto } as unknown as BeforeToolExecuteEvent);
    expect(veto).not.toHaveBeenCalled();
    const text = await guidance({ isNewTurn: true, injectedPositions: [], lastInjectedAt: null });
    expect(text).toContain('independent read-only analysis');
    expect(text).not.toContain('You own requirements');
  });

  it('does not let a parent plan guard trap the session owner in plan mode', async () => {
    await team.command('main', 'on');
    plans.add('main');
    expect(await team.restricted('main')).toBe(true);
    expect(await team.restricted('main', true)).toBe(false);
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Inspect.' });
    const worker = await member('worker');
    team = host().get(ISessionFusionTeamService);
    expect(await team.restricted(worker.id, true)).toBe(true);
    plans.clear();
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Implement after approval.' });
    expect(await team.restricted(worker.id, true)).toBe(false);
  });

  it('never replaces an unsupported or ambiguous native default CEO with the CLI', async () => {
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    const nativeCeo = models.get(DEFAULT_FUSION_CONFIG.ceoModel)!;
    models.delete(nativeCeo.id);
    models.set('native-ceo', { ...nativeCeo, id: 'native-ceo', name: 'GPT-6 Astra', supportEfforts: ['low'] });
    await expect(team.command('main', 'on')).rejects.toThrow('support');
    expect(runClaudeDecision).not.toHaveBeenCalled();
    expect((await team.status()).enabled).toBe(false);
  });

  it('delivers external CEO mail in decision packets and acknowledges only successful delivery', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    await team.command('main', 'on');
    await team.execute('main', { action: 'message', target: 'ceo', text: 'Critical evidence for CEO.' });
    vi.mocked(runClaudeDecision).mockRejectedValueOnce(new Error('timeout'));
    expect(await team.execute('main', { action: 'handoff', target: 'ceo', brief: 'Review.' })).toMatchObject({ status: 'failed', failureKind: 'transport' });
    expect(document!.mail).toHaveLength(1);
    await team.execute('main', { action: 'handoff', target: 'ceo', brief: 'Inspect previous decision; do not replay effects.' });
    expect(vi.mocked(runClaudeDecision).mock.calls[1]![0].prompt).toContain('Critical evidence for CEO.');
    expect(vi.mocked(runClaudeDecision).mock.calls[1]![0].resume).toBe(true);
    expect(document!.mail).toEqual([]);
  });

  it('records interrupted runs on reload without replaying them', async () => {
    await team.command('main', 'on');
    const worker = await member('worker');
    document!.running = [worker.id];
    team = host().get(ISessionFusionTeamService);
    expect((await member('worker')).lastOutcome).toBe('interrupted');
    expect(document!.running).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects enabling while the initial owner runs and reports actual model drift', async () => {
    running.add('main');
    await expect(team.command('main', 'on')).rejects.toThrow('busy');
    running.clear();
    await team.command('main', 'on');
    selectedModels.set('main', DEFAULT_FUSION_CONFIG.cooModel);
    const status = await team.status();
    expect(status.team!.members.find((entry) => entry.id === 'main')).toMatchObject({ model: DEFAULT_FUSION_CONFIG.ceoModel, actualModel: DEFAULT_FUSION_CONFIG.cooModel, actualEffort: 'xhigh' });
  });

  it('returns bounded inbox pages without discarding unread messages', async () => {
    await team.command('main', 'on');
    const worker = await member('worker');
    for (let i = 0; i < 3; i++) await team.execute('main', { action: 'message', target: 'worker', text: 'a'.repeat(8000) });
    const page = await team.execute(worker.id, { action: 'inbox' }) as FusionMail[];
    expect(page).toHaveLength(1);
    await team.execute(worker.id, { action: 'ack', ids: page.map((mail) => mail.id) });
    expect(document!.mail).toHaveLength(2);
  });

  it('contributes the exact fusion engine command and resolves the actor synchronously', async () => {
    const ix = new TestInstantiationService();
    containers.push(ix);
    const token = createDecorator<FusionFeature>('fusionFeatureTest');
    ix.set(token, new SyncDescriptor(FusionFeature));
    ix.get(token);
    const command = ix.fiberHost.collectionView(CommandContribution).items.find((entry) => entry.name === 'fusion');
    expect(command).toBeDefined();
    const execute = vi.fn(async () => {});
    for (const args of ['on', 'dual', 'off', 'status']) {
      await command!.run({ args, get: (id) => {
        expect(id).toBe(IAgentFusionTeamService);
        return { command: execute } as never;
      } });
    }
    expect(execute.mock.calls).toEqual([['on'], ['dual'], ['off'], ['status']]);
  });

  it('publishes command status directly without starting any model run', async () => {
    const ix = new TestInstantiationService();
    containers.push(ix);
    const append = vi.fn();
    ix.stub(ISessionFusionTeamService, team);
    ix.stub(IWireService, stubAgentWire());
    ix.stub(IEventBus, { subscribe: () => ({ dispose() {} }), publish: (event) => events.push(event) });
    ix.stub(IAgentScopeContext, { agentId: 'main' });
    ix.stub(IAgentContextMemoryService, { append });
    ix.stub(IAgentContextInjectorService, { register: () => ({ dispose() {} }) });
    ix.stub(IAgentToolExecutorService, { hooks: { onDidExecuteTool: { register: () => ({ dispose() {} }) } }, onBeforeExecuteTool: () => ({ dispose() {} }) } as unknown as IAgentToolExecutorService);
    ix.set(IAgentFusionTeamService, new SyncDescriptor(AgentFusionTeamService));
    await ix.get(IAgentFusionTeamService).command('on');
    await ix.get(IAgentFusionTeamService).command('status');
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[1]![0].content[0].text).toContain('Fusion on');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'warning', code: 'fusion.status', message: append.mock.calls[1]![0].content[0].text });
    expect(run).not.toHaveBeenCalled();
    expect(runClaudeDecision).not.toHaveBeenCalled();
  });

  it('creates idiot-boss with a cheap owner and separate persistent frontier contexts', async () => {
    await team.command('main', 'idiot-boss dual');
    expect((await member('coordinator'))).toMatchObject({ id: 'main', role: 'coordinator', model: DEFAULT_FUSION_CONFIG.coordinatorModel, effort: DEFAULT_FUSION_CONFIG.coordinatorEffort });
    expect(document!.routing[0]!.reason).toBe('Configured primary coordinator is available.');
    expect((await member('ceo')).id).not.toBe('main');
    expect((await member('coo')).id).not.toBe('main');
    expect((await member('consultant')).effort).toBe('max');
    expect(created).toHaveLength(3);
    expect(document!.strategy).toBe('idiot-boss');
    expect(document!.members.some((entry) => entry.role === 'worker')).toBe(false);
    const ids = document!.members.map((entry) => entry.id);
    team = host().get(ISessionFusionTeamService);
    await team.command('main', 'idiot-boss');
    expect(document!.members.map((entry) => entry.id)).toEqual(ids);
    await expect(team.command('main', 'genius-boss')).rejects.toThrow('new session');
    await expect(team.command('main', 'on')).rejects.toThrow('new session');
    expect(run).not.toHaveBeenCalled();
  });

  it('falls back only the coordinator through the worker chain, including with an external CEO', async () => {
    models.delete(DEFAULT_FUSION_CONFIG.coordinatorModel);
    models.delete(DEFAULT_FUSION_CONFIG.ceoModel);
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    await team.command('main', 'idiot-boss');
    expect((await member('coordinator'))).toMatchObject({ id: 'main', model: DEFAULT_FUSION_CONFIG.workerModel, effort: DEFAULT_FUSION_CONFIG.workerEffort });
    expect(document!.routing[0]!.reason).toMatch(/Catalog fallback:/);
    expect((await member('ceo')).transport).toBe('claude');
    expect((await member('coo')).id).not.toBe('main');
    expect(created).toHaveLength(1);
  });

  it('restores the original binding on repeated off/on cycles and off ignores disabled flags', async () => {
    flag = false;
    expect((await team.command('main', 'off')).enabled).toBe(false);
    flag = true;
    await team.command('main', 'idiot-boss');
    const original = structuredClone(document!.originalBinding);
    expect(original).toMatchObject({ modelAlias: 'original', thinkingLevel: 'low', activeToolNames: ['Read'] });
    flag = false;
    await team.command('main', 'off');
    expect(selectedModels.get('main')).toBe('original');
    running.add('main');
    await team.command('main', 'off');
    running.clear();
    flag = true;
    await team.command('main', 'idiot-boss');
    await team.command('main', 'off');
    expect(selectedModels.get('main')).toBe('original');
    expect(document!.originalBinding).toEqual(original);
  });

  it('migrates old strategy-less documents to genius-boss without inventing an original model', async () => {
    await team.command('main', 'on');
    Reflect.deleteProperty(document!, 'strategy');
    Reflect.deleteProperty(document!, 'originalBinding');
    team = host().get(ISessionFusionTeamService);
    expect((await team.status()).team!.strategy).toBe('genius-boss');
    expect(document!.originalBinding).toBeUndefined();
    await expect(team.command('main', 'idiot-boss')).rejects.toThrow('new session');
  });

  it('rejects an explicit custom CEO typo even when the CLI is available', async () => {
    vi.mocked(resolveClaudeExecutable).mockReturnValue('C:/trusted/claude.exe');
    const ix = host();
    ix.stub(IConfigService, { get: () => ({ ...DEFAULT_FUSION_CONFIG, ceoModel: 'fable-typo' }) } as unknown as IConfigService);
    const custom = ix.get(ISessionFusionTeamService);
    await expect(custom.command('main', 'on')).rejects.toThrow('not configured');
    expect(document).toBeUndefined();
    expect(created).toEqual([]);
  });

  it('caps actual Astra packets at three, including concurrent running injections and queued delivery', async () => {
    await team.command('main', 'idiot-boss');
    const coo = await member('coo');
    expect(await team.execute('main', { action: 'handoff', target: 'coo', brief: 'No task.' })).toMatchObject({ status: 'needs-user' });
    await team.beginTask('main', { type: 'turn.started', turnId: 1, origin: { kind: 'user' } });
    running.add(coo.id);
    const results = await Promise.all(Array.from({ length: 4 }, () => team.execute('main', { action: 'handoff', target: 'coo', brief: 'One concrete finding.' })));
    expect(results.slice(0, 3)).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'injected' })]));
    expect(results[3]).toMatchObject({ status: 'needs-user' });
    expect(injected).toHaveLength(3);
    expect(document!.task!.handoffs).toBe(3);
    expect(await team.execute('main', { action: 'message', target: 'coo', text: 'Informational finding.' })).toMatchObject({ delivery: [expect.stringContaining('informational')] });
    expect(await team.execute('main', { action: 'broadcast', text: 'Informational finding.' })).toMatchObject({ delivery: [expect.stringContaining('informational'), expect.stringContaining('informational')] });
    expect(injected).toHaveLength(3);
    expect(document!.task!.handoffs).toBe(3);
    team = host().get(ISessionFusionTeamService);
    await team.beginTask('main', { type: 'turn.started', turnId: 2, origin: { kind: 'system_trigger', name: 'fusion-team' } });
    await team.beginTask(coo.id, { type: 'turn.started', turnId: 2, origin: { kind: 'user' } });
    expect((await team.status()).team!.task!.handoffs).toBe(3);
    await team.beginTask('main', { type: 'turn.started', turnId: 1, origin: { kind: 'user' } });
    expect(await team.execute('main', { action: 'handoff', target: 'coo', brief: 'Same task.' })).toMatchObject({ status: 'needs-user' });
    await team.beginTask('main', { type: 'turn.started', turnId: 3, origin: { kind: 'user' } });
    expect(await team.execute('main', { action: 'handoff', target: 'coo', brief: 'New task.' })).toMatchObject({ status: 'injected' });
    expect(document!.task!.handoffs).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('charges failed and cancelled implementation runs and prohibits cheap spawning and leader routing', async () => {
    await team.command('main', 'idiot-boss');
    await team.beginTask('main', { type: 'turn.started', turnId: 10, origin: { kind: 'user' } });
    run.mockRejectedValue(new Error('failed after side effects'));
    for (let i = 0; i < 3; i++) expect(await team.execute('main', { action: 'handoff', target: 'coo', brief: 'Investigate.' })).toMatchObject({ status: 'failed' });
    expect(await team.execute('main', { action: 'handoff', target: 'coo', brief: 'Fourth.' })).toMatchObject({ status: 'needs-user' });
    expect(run).toHaveBeenCalledTimes(3);
    await expect(team.execute('main', { action: 'spawn', name: 'cheap', reason: 'Bypass.' })).rejects.toThrow('only CEO/COO');
    await expect(team.execute((await member('coo')).id, { action: 'spawn', name: 'cheap', reason: 'Bypass.' })).rejects.toThrow('coherently');
    await expect(team.execute('main', { action: 'route', target: 'ceo', model: DEFAULT_FUSION_CONFIG.workerModel, effort: 'high', reason: 'Replace.' })).rejects.toThrow('only CEO/COO');
    await expect(team.execute((await member('ceo')).id, { action: 'route', target: 'coordinator', model: DEFAULT_FUSION_CONFIG.terraModel, effort: 'xhigh', reason: 'Replace.' })).rejects.toThrow('only change workers');
  });

  it('never treats done as validation and requires actual independent evidence after the latest handoff', async () => {
    await team.command('main', 'idiot-boss');
    await team.beginTask('main', { type: 'turn.started', turnId: 12, origin: { kind: 'user' } });
    run.mockImplementation(async (agentId) => ({ agentId, completion: Promise.resolve({ summary: 'done' }) }));
    expect(await team.execute('main', { action: 'handoff', target: 'coo', brief: 'Implement.' })).toMatchObject({ status: 'completed', validation: 'unverified' });
    const finish = { action: 'finish', evidenceToolCallIds: ['check-1'], summary: 'Verified the original requirement.' } as const;
    const finishInput = { ...finish, evidenceToolCallIds: [...finish.evidenceToolCallIds] };
    expect(await team.execute('main', finishInput)).toMatchObject({ status: 'needs-user' });
    const receipt = { turnId: 12, outcome: 'executed', toolCall: { id: 'check-1', name: 'Bash' }, result: { output: '3 tests passed', isError: false } } as ToolDidExecuteContext;
    await team.recordEvidence((await member('coo')).id, receipt);
    expect(await team.execute('main', finishInput)).toMatchObject({ status: 'needs-user' });
    await team.recordEvidence('main', { ...receipt, outcome: 'vetoed' });
    await team.recordEvidence('main', { ...receipt, result: { output: 'failed', isError: true } });
    expect(document!.task!.evidence).toHaveLength(0);
    await team.recordEvidence('main', receipt);
    expect(await team.execute('main', finishInput)).toMatchObject({ status: 'evidence-recorded' });
    expect(document!.task!.validated).toBe(true);
    await team.execute('main', { action: 'handoff', target: 'coo', brief: 'New finding.' });
    expect(document!.task!.evidence).toEqual([]);
    expect(document!.task!.validated).toBe(false);
    expect(await team.execute('main', finishInput)).toMatchObject({ status: 'needs-user' });
  });

  it('mirrors native runs and hooks under the initiating tool call without copying transcripts', async () => {
    await team.command('main', 'on');
    const worker = await member('worker');
    await team.execute('main', { action: 'handoff', target: 'worker', brief: 'Verify artifact.' }, undefined, 'parent-call');
    expect(events.map((event) => event.type)).toEqual(['subagent.spawned', 'subagent.started', 'subagent.completed']);
    expect(events[0]).toMatchObject({ parentToolCallId: 'parent-call', subagentId: worker.id, model: worker.model });
    expect(startHook).toHaveBeenCalledTimes(1);
    expect(stopHook).toHaveBeenCalledWith({ agentName: 'worker', response: 'Verified: test passed.' });
    expect(injected).toEqual([]);
  });

  it('wires authentic user task boundaries through the actor and stops the tool at the cap', async () => {
    await team.command('main', 'idiot-boss');
    const ix = new TestInstantiationService();
    containers.push(ix);
    let start!: (event: TurnStartedEvent) => void;
    ix.stub(ISessionFusionTeamService, team);
    ix.stub(IWireService, stubAgentWire());
    ix.stub(IEventBus, { subscribe: (_type: string, handler: typeof start) => { start = handler; return { dispose() {} }; } } as unknown as IEventBus);
    ix.stub(IAgentScopeContext, { agentId: 'main' });
    ix.stub(IAgentContextMemoryService, { append: vi.fn() });
    ix.stub(IAgentContextInjectorService, { register: () => ({ dispose() {} }) });
    ix.stub(IAgentToolExecutorService, { hooks: { onDidExecuteTool: { register: () => ({ dispose() {} }) } }, onBeforeExecuteTool: () => ({ dispose() {} }) } as unknown as IAgentToolExecutorService);
    ix.set(IAgentFusionTeamService, new SyncDescriptor(AgentFusionTeamService));
    const actor = ix.get(IAgentFusionTeamService);
    const tool = new FusionTeamTool(actor);
    start({ type: 'turn.started', turnId: 100, origin: { kind: 'user' } });
    for (let i = 0; i < 3; i++) await actor.execute({ action: 'handoff', target: 'coo', brief: 'Original goal + artifact.' });
    const execution = tool.resolveExecution({ action: 'handoff', target: 'coo', brief: 'Fourth.' });
    expect('execute' in execution).toBe(true);
    if (!('execute' in execution)) throw new Error('Expected runnable tool');
    const result = await execution.execute({ signal: new AbortController().signal, turnId: 100, toolCallId: 'fourth' });
    expect(result).toMatchObject({ isError: true, stopTurn: true });
    expect(result.output).toContain('needs-user');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('guides direct frontier implementation and narrow cheap verification without automatic panels', async () => {
    await team.command('main', 'on');
    const coo = await member('coo');
    expect(roleGuidance(coo)).toContain('take the work back');
    expect(roleGuidance(coo)).toContain('one batch dispatch/review');
    expect(roleGuidance(coo)).toContain('do not guarantee provider cache hits');
    expect(roleGuidance(coo, 'idiot-boss')).toContain('end-to-end implementer');
    expect(roleGuidance(coo, 'idiot-boss')).toContain('not an automatic panel');
    expect(roleGuidance(coo)).toContain('principal engineer');
    const ceo = await member('ceo');
    expect(roleGuidance(ceo)).toContain('hand it technical design, substantive implementation');
    expect(roleGuidance(ceo)).toContain('technical review of the finished result');
    expect(roleGuidance(ceo, 'idiot-boss')).toContain('Do not take over implementation');
  });

  it('restores real profile tool overlays after wire replay without rebinding or replacing history', async () => {
    await team.command('main', 'idiot-boss dual');
    for (const name of ['coordinator', 'coo', 'consultant']) {
      const participant = await member(name);
      const persistence = new InMemoryWireRecordPersistence();
      const overrides = [
        agentService(IAgentScopeContext, { _serviceBrand: undefined, agentId: participant.id, scope: (sub?: string) => `fusion-test/${participant.id}/${sub ?? ''}` }),
      ];
      let ctx = createTestAgent({ persistence }, ...overrides);
      try {
        ctx.get(IAgentFusionTeamService);
        const profile = ctx.get(IAgentProfileService);
        profile.applyBindingSnapshot({ profileName: 'test-profile', modelAlias: 'mock-model', thinkingLevel: 'off', systemPrompt: 'Persistent original prompt', activeToolNames: ['Read', 'Edit', 'Bash'] });
        profile.addActiveTool('FusionTeam');
        ctx.context.append({ role: 'user', content: [{ type: 'text', text: 'Persistent task history' }], toolCalls: [], origin: { kind: 'user' } });
        await ctx.wire.flush();
        const binds = persistence.records.filter((record) => record.type === 'profile.bind').length;
        await ctx.dispose();
        ctx = createTestAgent({ agentId: participant.id, persistence, autoConfigure: false }, ...overrides);
        ctx.get(IAgentFusionTeamService);
        scopes.set(participant.id, { id: participant.id, accessor: { get: (token: Parameters<typeof ctx.get>[0]) => ctx.get(token) } } as unknown as IAgentScopeHandle);
        const resumedProfile = ctx.get(IAgentProfileService);
        const bind = vi.spyOn(resumedProfile, 'bind');
        const restore = vi.spyOn(ctx.get(ISessionFusionTeamService), 'restoreTools').mockImplementation(team.restoreTools.bind(team));
        expect(ctx.get(IAgentScopeContext).agentId).toBe(participant.id);
        await ctx.restorePersisted();
        expect(restore).toHaveBeenCalledWith(participant.id);
        expect(resumedProfile.getActiveToolNames(), name).toEqual(name === 'consultant'
          ? ['Read', 'ReadMediaFile', 'Glob', 'Grep', 'WebSearch', 'FetchURL', 'FusionTeam']
          : ['Read', 'Edit', 'Bash', 'FusionTeam']);
        expect(resumedProfile.data()).toMatchObject({ modelAlias: 'mock-model', thinkingLevel: 'off', systemPrompt: 'Persistent original prompt' });
        expect(ctx.context.get()).toEqual(expect.arrayContaining([expect.objectContaining({ content: [{ type: 'text', text: 'Persistent task history' }] })]));
        expect(bind).not.toHaveBeenCalled();
        await ctx.wire.flush();
        expect(persistence.records.filter((record) => record.type === 'profile.bind')).toHaveLength(binds);
        if (name === 'coordinator') {
          resumedProfile.removeActiveTool('FusionTeam');
          await team.command('main', 'idiot-boss');
          expect(resumedProfile.getActiveToolNames()).toContain('FusionTeam');
          expect(bind).not.toHaveBeenCalled();
        }
      } finally {
        await ctx.dispose();
        scopes.set(participant.id, scope(participant.id));
      }
    }
  });

  it('queues attributed CEO and consultant replies while Astra awaits consultation, without executable injection', async () => {
    await team.command('main', 'idiot-boss dual');
    await team.beginTask('main', { type: 'turn.started', turnId: 200, origin: { kind: 'user' } });
    const coo = await member('coo');
    const ceo = await member('ceo');
    const consultant = await member('consultant');
    run.mockImplementation(async (agentId) => {
      if (agentId === coo.id) {
        await team.execute(coo.id, { action: 'handoff', target: 'ceo', brief: 'Choose between these observed outcomes.' });
        await team.execute(coo.id, { action: 'handoff', target: 'consultant', brief: 'Read-only critique.' });
      } else {
        const receipt = await team.execute(String(agentId), { action: 'message', target: 'coo', text: 'Evidence-based consultation answer.' });
        expect(receipt).toMatchObject({ delivery: [expect.stringContaining('informational')] });
      }
      return { agentId, completion: Promise.resolve({ summary: 'Consultation completed.' }) };
    });
    expect(await team.execute('main', { action: 'handoff', target: 'coo', brief: 'Original goal.' })).toMatchObject({ status: 'completed' });
    expect(run).toHaveBeenCalledTimes(3);
    expect(injected).toEqual([]);
    expect(await team.execute(coo.id, { action: 'inbox' })).toMatchObject([{ from: ceo.id, informational: true }, { from: consultant.id, informational: true }]);
    expect(document!.task!.handoffs).toBe(1);
    const runCount = run.mock.calls.length;
    for (const sender of [coo, ceo, consultant, await member('coordinator')]) {
      for (const recipient of document!.members) running.add(recipient.id);
      await team.execute(sender.id, { action: 'broadcast', text: `Information from ${sender.name}.` });
    }
    expect(injected).toEqual([]);
    expect(run).toHaveBeenCalledTimes(runCount);
    expect(document!.task!.handoffs).toBe(1);
    for (const recipient of document!.members) {
      const mail = await team.execute(recipient.id, { action: 'inbox' }) as FusionMail[];
      expect(mail.filter((entry) => entry.text.startsWith('Information from'))).toHaveLength(3);
    }
  });

  it('bounds public status and excludes original prompts, mail bodies and evidence result bodies', async () => {
    await team.command('main', 'idiot-boss dual');
    const consultant = await member('consultant');
    document!.originalBinding = { ...document!.originalBinding!, systemPrompt: 'PRIVATE-ORIGINAL-PROMPT'.repeat(60_000) };
    document!.mail = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, from: 'main', to: consultant.id, text: 'PRIVATE-MAIL'.repeat(1000), createdAt: i }));
    document!.task = { turnId: 200, handoffs: 2, evidence: Array.from({ length: 20 }, (_, i) => ({ toolCallId: `evidence-${i}`, tool: 'Bash', result: 'PRIVATE-EVIDENCE'.repeat(2000) })) };
    document!.routing = Array.from({ length: 100 }, (_, i) => ({ memberId: 'main', to: 'model', reason: `route-${i}:` + 'Long reason '.repeat(1000), at: i }));
    team = host().get(ISessionFusionTeamService);
    const status = await team.execute(consultant.id, { action: 'status' });
    const serialized = JSON.stringify(status);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(12_000);
    expect(serialized).not.toMatch(/PRIVATE-(ORIGINAL-PROMPT|MAIL|EVIDENCE)/);
    expect(status).toMatchObject({ team: { hasOriginalBinding: true, mail: expect.arrayContaining([{ to: consultant.id, count: 100 }]), task: { evidence: expect.arrayContaining([{ toolCallId: 'evidence-19', tool: 'Bash' }]) } } });
    expect(status).not.toHaveProperty('team.originalBinding');
    expect(status).not.toHaveProperty('team.task.evidence.0.result');
    expect((await team.status()).team!.routing).toHaveLength(3);
    expect(document!.originalBinding.systemPrompt).toContain('PRIVATE-ORIGINAL-PROMPT');
    expect(document!.mail[0]!.text).toContain('PRIVATE-MAIL');
    document!.members.forEach((entry) => { entry.model = '\\"漢字'.repeat(1000); entry.effort = 'x'.repeat(1000); });
    team = host().get(ISessionFusionTeamService);
    expect(Buffer.byteLength(JSON.stringify(await team.status()), 'utf8')).toBeLessThanOrEqual(12_000);
  });
});
