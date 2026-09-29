/**
 * Scenario: tool-free Claude CEO transport with persistent official CLI sessions.
 * Responsibilities: trusted discovery, invocation isolation, bounded failures,
 * session identity, and usage accounting. No real CLI or credentials are used.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasClaudeApiKeyCredential, readClaudeSubscriptionAuth, resolveClaudeExecutable, runClaudeDecision, type ClaudeDecisionRequest } from '#/features/fusion/claudeTransport';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  realpathSync: vi.fn(),
  statSync: vi.fn(),
  accessSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFile: mocks.execFile }));
vi.mock('node:fs', async (original) => ({
  ...await original<typeof import('node:fs')>(),
  realpathSync: mocks.realpathSync,
  statSync: mocks.statSync,
  accessSync: mocks.accessSync,
}));

const SESSION_ID = 'bf1d6936-845a-42ba-b4d4-3acb8d1dd310';
const SUCCESS_RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Approve the bounded plan.',
  session_id: SESSION_ID,
};
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 12345;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  input = '';
  readonly kill = vi.fn(() => {
    this.signalCode = 'SIGKILL';
    this.emit('close', null, 'SIGKILL');
    return true;
  });

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => { this.input += chunk.toString(); });
  }

  complete(output?: unknown, code = 0): void {
    const value = output === undefined ? SUCCESS_RESULT : output;
    this.stdout.emit('data', Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
    this.exitCode = code;
    this.emit('close', code, null);
  }
}

let child: FakeChild;
let cwd: string;
let executable: string;
let request: ClaudeDecisionRequest;
let files: Set<string>;

function usePlatform(platform: 'win32' | 'linux'): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  cwd = platform === 'win32' ? 'C:\\workspace' : '/workspace';
  executable = platform === 'win32' ? 'C:\\trusted\\claude.exe' : '/trusted/claude';
  files = new Set([cwd, executable]);
  vi.stubEnv('PATH', platform === 'win32' ? 'C:\\trusted' : '/trusted');
  request = {
    executable,
    model: 'claude-fable-5-1',
    sessionId: SESSION_ID,
    resume: false,
    prompt: 'Review this design packet; do not execute it.\n$(echo unsafe)',
    cwd,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  usePlatform('win32');
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
  mocks.realpathSync.mockImplementation((path: string) => {
    if (!files.has(path)) throw new Error('ENOENT');
    return path;
  });
  mocks.statSync.mockReturnValue({ isFile: () => true });
  mocks.accessSync.mockReturnValue(undefined);
  child = new FakeChild();
  mocks.spawn.mockReturnValue(child);
  mocks.execFile.mockImplementation((_path, _args, _options, callback) => {
    child.kill();
    callback(null);
  });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Claude executable trust', () => {
  it('skips empty, relative, workspace, and descendant PATH entries', () => {
    files.add('C:\\workspace\\claude.exe');
    files.add('C:\\workspace\\bin\\claude.exe');
    vi.stubEnv('PATH', ';.;bin;C:\\workspace;C:\\workspace\\bin;"C:\\trusted"');
    expect(resolveClaudeExecutable(cwd)).toBe(executable);
    expect(mocks.realpathSync).not.toHaveBeenCalledWith('C:\\workspace\\bin\\claude.exe');
  });

  it('does not mistake a sibling with the workspace prefix for a descendant', () => {
    const sibling = 'C:\\workspace-tools\\claude.exe';
    files.add(sibling);
    vi.stubEnv('PATH', 'C:\\workspace-tools');
    expect(resolveClaudeExecutable(cwd)).toBe(sibling);
  });

  it('rejects a trusted PATH symlink resolving into the workspace', () => {
    mocks.realpathSync.mockImplementation((path) => path === executable ? 'C:\\workspace\\planted.exe' : path);
    expect(resolveClaudeExecutable(cwd)).toBeUndefined();
  });

  it('rejects executables inside the canonical workspace reached through an alias', () => {
    mocks.realpathSync.mockImplementation((path) => path === cwd ? 'C:\\trusted' : path);
    expect(resolveClaudeExecutable(cwd)).toBeUndefined();
  });

  it.each(['C:\\workspace\\claude.exe', 'C:\\workspace\\bin\\claude.exe', 'C:\\trusted\\claude.cmd', 'claude.exe'])(
    'refuses unsafe explicit executable %s before spawning', async (unsafe) => {
      await expect(runClaudeDecision({ ...request, executable: unsafe })).rejects.toThrow('trusted native');
      expect(mocks.spawn).not.toHaveBeenCalled();
    },
  );

  it('never searches Windows cmd shims', () => {
    files.delete(executable);
    files.add('C:\\trusted\\claude.cmd');
    expect(resolveClaudeExecutable(cwd)).toBeUndefined();
  });

  it('ignores non-files and non-executable POSIX paths', () => {
    usePlatform('linux');
    mocks.statSync.mockReturnValueOnce({ isFile: () => false });
    expect(resolveClaudeExecutable(cwd)).toBeUndefined();
    mocks.accessSync.mockImplementationOnce(() => { throw new Error('EACCES'); });
    expect(resolveClaudeExecutable(cwd)).toBeUndefined();
  });

  it('resolves an executable on POSIX without searching relative entries', () => {
    usePlatform('linux');
    vi.stubEnv('PATH', ':.:/workspace:/workspace/bin:/trusted');
    expect(resolveClaudeExecutable(cwd)).toBe(executable);
  });
});

describe('Claude persistent decisions', () => {
  it('starts the exact model and UUID with stdin, no shell, no tools, and isolated customizations', async () => {
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://example.test');
    const pending = runClaudeDecision(request);
    const [binary, args, options] = mocks.spawn.mock.calls[0]!;
    expect(binary).toBe(executable);
    expect(args).toEqual([
      '--print', '--input-format', 'text', '--output-format', 'json',
      '--model', 'claude-fable-5-1', '--session-id', SESSION_ID,
      '--tools', '', '--permission-mode', 'dontAsk', '--safe-mode',
      '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--no-chrome', '--system-prompt', expect.stringContaining('Never claim to have executed'),
    ]);
    expect(args.join(' ')).not.toMatch(/bypass|dangerously|--bare|--fork-session|--no-session-persistence/);
    expect(args).not.toContain(request.prompt);
    expect(child.input).toBe(request.prompt);
    expect(options).toMatchObject({ cwd, shell: false, windowsHide: true, detached: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(options.env).toEqual(Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CLAUDECODE')));
    child.complete();
    await expect(pending).resolves.toEqual({ text: 'Approve the bounded plan.', sessionId: SESSION_ID });
    expect(vi.getTimerCount()).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(child.stdout.listenerCount('data')).toBe(0);
  });

  it('resumes the same UUID without forking or restarting', async () => {
    const pending = runClaudeDecision({ ...request, executable: undefined, resume: true });
    const args = mocks.spawn.mock.calls[0]![1] as string[];
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual(['--resume', SESSION_ID]);
    expect(args).not.toContain('--session-id');
    child.complete();
    await pending;
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('returns the CLI token counters without conflating cached input with input', async () => {
    const pending = runClaudeDecision(request);
    child.complete({ ...SUCCESS_RESULT, result: 'Decision', usage: {
      input_tokens: 12, output_tokens: 23, cache_read_input_tokens: 45, cache_creation_input_tokens: 67,
    } });
    await expect(pending).resolves.toEqual({ text: 'Decision', sessionId: SESSION_ID, usage: {
      inputTokens: 12, outputTokens: 23, cacheReadTokens: 45, cacheWriteTokens: 67,
    } });
  });

  it('accepts usage without cache counters and does not fabricate absent usage', async () => {
    const pending = runClaudeDecision(request);
    child.complete({ ...SUCCESS_RESULT, usage: { input_tokens: 2, output_tokens: 3 } });
    await expect(pending).resolves.toMatchObject({ usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  });

  it.each([
    ['malformed JSON', 'not json', 'malformed JSON'],
    ['empty text', { ...SUCCESS_RESULT, result: '  ' }, 'empty decision'],
    ['missing text', { ...SUCCESS_RESULT, result: undefined }, 'empty decision'],
    ['non-string text', { ...SUCCESS_RESULT, result: 42 }, 'empty decision'],
    ['CLI error', { ...SUCCESS_RESULT, is_error: true, result: 'Failed' }, 'failed decision'],
    ['error subtype', { ...SUCCESS_RESULT, subtype: 'error_max_turns', result: 'Partial' }, 'failed decision'],
    ['session mismatch', { ...SUCCESS_RESULT, session_id: 'other-session' }, 'mismatching session'],
    ['missing session', { ...SUCCESS_RESULT, session_id: undefined }, 'mismatching session'],
    ['non-string session', { ...SUCCESS_RESULT, session_id: 42 }, 'mismatching session'],
    ['array JSON', [], 'invalid result'],
    ['invalid usage', { ...SUCCESS_RESULT, usage: { input_tokens: -1, output_tokens: 1 } }, 'invalid token usage'],
    ['wrong result type', { ...SUCCESS_RESULT, type: 'not-result' }, 'invalid result'],
    ['missing result type', { ...SUCCESS_RESULT, type: undefined }, 'invalid result'],
    ['missing subtype', { ...SUCCESS_RESULT, subtype: undefined }, 'invalid result'],
    ['null subtype', { ...SUCCESS_RESULT, subtype: null }, 'invalid result'],
    ['missing error status', { ...SUCCESS_RESULT, is_error: undefined }, 'invalid result'],
    ['string error status', { ...SUCCESS_RESULT, is_error: 'true' }, 'invalid result'],
    ['null error status', { ...SUCCESS_RESULT, is_error: null }, 'invalid result'],
    ['malformed success envelope', { ...SUCCESS_RESULT, type: 'not-result', is_error: 'true', subtype: null, result: 'Partial failure text' }, 'invalid result'],
  ])('rejects %s without a retry', async (_name, output, message) => {
    const pending = runClaudeDecision(request);
    child.complete(output);
    await expect(pending).rejects.toThrow(message);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects nonzero exit even with otherwise valid JSON', async () => {
    const pending = runClaudeDecision(request);
    child.stderr.emit('data', Buffer.from('private diagnostic that must not be included in errors'));
    child.complete(undefined, 7);
    await expect(pending).rejects.toThrow('exited unsuccessfully (7)');
  });

  it('handles JSON split across multibyte boundaries', async () => {
    const pending = runClaudeDecision(request);
    const output = Buffer.from(JSON.stringify({ ...SUCCESS_RESULT, result: 'Decision: ✓' }));
    for (const byte of output) child.stdout.emit('data', Buffer.from([byte]));
    child.emit('close', 0, null);
    await expect(pending).resolves.toMatchObject({ text: 'Decision: ✓' });
  });
});

describe('Claude process bounds', () => {
  it('does not spawn for a pre-aborted signal', async () => {
    await expect(runClaudeDecision({ ...request, signal: AbortSignal.abort() })).rejects.toThrow('aborted');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('kills its own child on abort and removes the listener', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = runClaudeDecision({ ...request, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
  });

  it('kills its own Windows process tree through a trusted native taskkill', async () => {
    files.add('C:\\Windows\\System32\\taskkill.exe');
    const pending = runClaudeDecision({ ...request, timeoutMs: 10 });
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(mocks.execFile).toHaveBeenCalledWith('C:\\Windows\\System32\\taskkill.exe', ['/PID', '12345', '/T', '/F'],
      { windowsHide: true, shell: false, timeout: 5_000 }, expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a detached process group and kills only that group on POSIX', async () => {
    usePlatform('linux');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { child.emit('close', null, 'SIGKILL'); return true; });
    const pending = runClaudeDecision({ ...request, timeoutMs: 10 });
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(mocks.spawn.mock.calls[0]![2]).toMatchObject({ detached: true });
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
  });

  it.each([
    ['normal exit', 'abort'],
    ['normal exit', 'timeout'],
    ['signal exit', 'abort'],
    ['signal exit', 'timeout'],
  ])('kills the POSIX group after %s with open pipes on %s', async (exit, cancellation) => {
    usePlatform('linux');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { child.emit('close', 0, null); return true; });
    const controller = new AbortController();
    const pending = runClaudeDecision({ ...request, signal: controller.signal, timeoutMs: 10 });
    const assertion = expect(pending).rejects.toThrow(cancellation === 'abort' ? 'aborted' : 'timed out');
    if (exit === 'normal exit') child.exitCode = 0;
    else child.signalCode = 'SIGTERM';
    if (cancellation === 'abort') controller.abort();
    else await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(kill).toHaveBeenCalledExactlyOnceWith(-12345, 'SIGKILL');
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not target a potentially reused Windows PID after the parent exits', async () => {
    files.add('C:\\Windows\\System32\\taskkill.exe');
    const controller = new AbortController();
    const pending = runClaudeDecision({ ...request, signal: controller.signal });
    child.exitCode = 0;
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    child.emit('close', 0, null);
    expect(child.listenerCount('error')).toBe(0);
  });

  it.each(['stdout', 'stderr'] as const)('rejects excessive %s and kills the child', async (stream) => {
    const pending = runClaudeDecision(request);
    child[stream].emit('data', Buffer.alloc(1024 * 1024 + 1));
    await expect(pending).rejects.toThrow('size limit');
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('enforces one combined stdout and stderr budget', async () => {
    const pending = runClaudeDecision(request);
    child.stdout.emit('data', Buffer.alloc(600_000));
    child.stderr.emit('data', Buffer.alloc(600_000));
    await expect(pending).rejects.toThrow('size limit');
  });

  it.each(['process', 'stdin', 'stdout', 'stderr'] as const)('rejects %s errors without leaking diagnostics', async (target) => {
    const pending = runClaudeDecision(request);
    (target === 'process' ? child : child[target]).emit('error', new Error('private detail'));
    await expect(pending).rejects.toThrow('process or stream failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills the process and clears the timeout when stdin throws synchronously', async () => {
    vi.spyOn(child.stdin, 'end').mockImplementationOnce(() => { throw new Error('EPIPE'); });
    await expect(runClaudeDecision(request)).rejects.toThrow('process or stream failed');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to killing its own child if native Windows tree termination fails', async () => {
    files.add('C:\\Windows\\System32\\taskkill.exe');
    mocks.execFile.mockImplementationOnce((_path, _args, _options, callback) => callback(new Error('taskkill failed')));
    const controller = new AbortController();
    const pending = runClaudeDecision({ ...request, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it.each([0, -1, NaN, Infinity, 600_001])('rejects invalid timeout %s before spawning', async (timeoutMs) => {
    await expect(runClaudeDecision({ ...request, timeoutMs })).rejects.toThrow('timeout');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID session before spawning', async () => {
    await expect(runClaudeDecision({ ...request, sessionId: 'not-a-session' })).rejects.toThrow('UUID');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('reads sanitized subscription auth when authenticated with both tokens set', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-auth-'));
    try {
      vi.stubEnv('CLAUDE_CONFIG_DIR', fixtureDir);
      const fixtureData = {
        claudeAiOauth: {
          accessToken: 'sk-ant-test-access-token-present',
          refreshToken: 'sk-ant-test-refresh-token-present',
          subscriptionType: 'pro',
          rateLimitTier: 'tier-4',
          expiresAt: Date.now() + 3_600_000,
        },
      };
      writeFileSync(join(fixtureDir, '.credentials.json'), JSON.stringify(fixtureData), 'utf8');
      const auth = readClaudeSubscriptionAuth();
      expect(auth).toEqual({
        fileFound: true,
        fileState: 'parsed',
        authenticated: true,
        subscriptionType: 'pro',
        rateLimitTier: 'tier-4',
        expiresAt: fixtureData.claudeAiOauth.expiresAt,
        expired: false,
      });
      expect(auth).not.toHaveProperty('accessToken');
      expect(auth).not.toHaveProperty('refreshToken');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('detects expired tokens while retaining authentication state', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-auth-'));
    try {
      vi.stubEnv('CLAUDE_CONFIG_DIR', fixtureDir);
      const past = Date.now() - 10_000;
      writeFileSync(
        join(fixtureDir, '.credentials.json'),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'token-a',
            refreshToken: 'token-b',
            subscriptionType: 'team',
            rateLimitTier: 'tier-5',
            expiresAt: past,
          },
        }),
        'utf8',
      );
      const auth = readClaudeSubscriptionAuth();
      expect(auth).toEqual({
        fileFound: true,
        fileState: 'parsed',
        authenticated: true,
        subscriptionType: 'team',
        rateLimitTier: 'tier-5',
        expiresAt: past,
        expired: true,
      });
      expect(auth).not.toHaveProperty('accessToken');
      expect(auth).not.toHaveProperty('refreshToken');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('returns unauthenticated when tokens are empty or whitespace-only', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-auth-'));
    try {
      vi.stubEnv('CLAUDE_CONFIG_DIR', fixtureDir);
      writeFileSync(
        join(fixtureDir, '.credentials.json'),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: '   ',
            refreshToken: '',
            subscriptionType: 'pro',
            rateLimitTier: 'tier-4',
          },
        }),
        'utf8',
      );
      const auth = readClaudeSubscriptionAuth();
      expect(auth).toEqual({
        fileFound: true,
        fileState: 'parsed',
        authenticated: false,
        expired: false,
      });
      expect(auth).not.toHaveProperty('subscriptionType');
      expect(auth).not.toHaveProperty('rateLimitTier');
      expect(auth).not.toHaveProperty('accessToken');
      expect(auth).not.toHaveProperty('refreshToken');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('returns fileFound false and unauthenticated when credentials file does not exist', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-auth-'));
    try {
      vi.stubEnv('CLAUDE_CONFIG_DIR', fixtureDir);
      const auth = readClaudeSubscriptionAuth();
      expect(auth).toEqual({
        fileFound: false,
        fileState: 'missing',
        authenticated: false,
        expired: false,
      });
      expect(auth).not.toHaveProperty('accessToken');
      expect(auth).not.toHaveProperty('refreshToken');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('returns fileFound false and unauthenticated without throwing when credentials file is malformed JSON', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-auth-'));
    try {
      vi.stubEnv('CLAUDE_CONFIG_DIR', fixtureDir);
      writeFileSync(join(fixtureDir, '.credentials.json'), '{ not-valid-json: true, }', 'utf8');
      const auth = readClaudeSubscriptionAuth();
      expect(auth).toEqual({
        fileFound: false,
        fileState: 'unreadable',
        authenticated: false,
        expired: false,
      });
      expect(auth).not.toHaveProperty('accessToken');
      expect(auth).not.toHaveProperty('refreshToken');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('returns fileFound false and unreadable when credentials file is non-record shape', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-auth-'));
    try {
      vi.stubEnv('CLAUDE_CONFIG_DIR', fixtureDir);
      writeFileSync(join(fixtureDir, '.credentials.json'), JSON.stringify('a-raw-string'), 'utf8');
      const auth = readClaudeSubscriptionAuth();
      expect(auth).toEqual({
        fileFound: false,
        fileState: 'unreadable',
        authenticated: false,
        expired: false,
      });
      expect(auth).not.toHaveProperty('accessToken');
      expect(auth).not.toHaveProperty('refreshToken');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('returns fileFound true and unauthenticated when claudeAiOauth is missing', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claude-auth-'));
    try {
      vi.stubEnv('CLAUDE_CONFIG_DIR', fixtureDir);
      writeFileSync(join(fixtureDir, '.credentials.json'), JSON.stringify({ other: true }), 'utf8');
      const auth = readClaudeSubscriptionAuth();
      expect(auth).toEqual({
        fileFound: true,
        fileState: 'parsed',
        authenticated: false,
        expired: false,
      });
      expect(auth).not.toHaveProperty('accessToken');
      expect(auth).not.toHaveProperty('refreshToken');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['ANTHROPIC_API_KEY', 'sk-ant-test-key-12345'],
    ['ANTHROPIC_AUTH_TOKEN', 'session-token-xyz'],
  ])('detects credential when %s is set and non-empty', (envName, envVal) => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    vi.stubEnv(envName, envVal);
    expect(hasClaudeApiKeyCredential()).toBe(true);
  });

  it.each([
    ['unset', undefined, undefined],
    ['empty string', '', ''],
    ['whitespace only', '   ', ' \t\n '],
  ])('returns false when API keys are %s', (_label, keyVal, tokenVal) => {
    vi.stubEnv('ANTHROPIC_API_KEY', keyVal);
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', tokenVal);
    expect(hasClaudeApiKeyCredential()).toBe(false);
  });
});
