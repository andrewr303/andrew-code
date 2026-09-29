import { beforeEach, describe, expect, it, vi } from 'vitest';

import { join } from 'node:path';

import { handleSwarmCommand } from '#/tui/commands/index';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { swarmArgumentCompletions } from '#/tui/commands/registry';
import { currentTheme } from '#/tui/theme';
import { getDefaultSwarmSelection, loadLastSwarmSelection, saveSwarmSelection, SWARM_PATTERNS } from '#/tui/utils/fusion-swarm';
import { openFusionDashboard, resolveFusionScriptsRoot, runFusionScript } from '#/tui/utils/fusion-scripts';

vi.mock('#/tui/utils/fusion-swarm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/tui/utils/fusion-swarm')>();
  return {
    ...actual,
    loadLastSwarmSelection: vi.fn(() => actual.getDefaultSwarmSelection()),
    saveSwarmSelection: vi.fn(),
  };
});

vi.mock('#/tui/utils/fusion-scripts', () => ({
  resolveFusionScriptsRoot: vi.fn(() => '/mock/fusion/scripts'),
  runFusionScript: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  openFusionDashboard: vi.fn(async () => 'http://127.0.0.1:8765/'),
}));

beforeEach(() => {
  vi.mocked(loadLastSwarmSelection).mockReset().mockImplementation(getDefaultSwarmSelection);
  vi.mocked(saveSwarmSelection).mockClear();
  vi.mocked(resolveFusionScriptsRoot).mockReset().mockReturnValue('/mock/fusion/scripts');
  vi.mocked(runFusionScript).mockReset().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  vi.mocked(openFusionDashboard).mockReset().mockResolvedValue('http://127.0.0.1:8765/');
});

const ENTER = '\r';
const ESCAPE = '\u001B';
const DOWN = '\u001B[B';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

interface TestComponent {
  render(width: number): string[];
}

function makeHost(
  overrides: {
    model?: string;
    hasSession?: boolean;
    permissionMode?: 'manual' | 'auto' | 'yolo';
    swarmMode?: boolean;
    nativeFusion?: boolean;
  } = {},
) {
  const session = {
    setPermission: vi.fn(async () => {}),
    setSwarmMode: vi.fn(async () => {}),
    listCommands: vi.fn(async () => overrides.nativeFusion ? [{ name: 'fusion' }] : []),
    runCommand: vi.fn(async (_name: string, _args: string) => {}),
  };
  const hasSession = overrides.hasSession ?? true;
  const host = {
    state: {
      appState: {
        model: overrides.model ?? 'kimi-model',
        permissionMode: overrides.permissionMode ?? 'auto',
        swarmMode: overrides.swarmMode ?? false,
      },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
    },
    session: hasSession ? session : undefined,
    requireSession: () => session,
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    sendNormalUserInput: vi.fn(),
  } as unknown as SlashCommandHost;
  host.state.appState.availableModels = {};
  host.state.appState.availableProviders = {};
  return { host, session };
}

interface TestPicker {
  handleInput(data: string): void;
  render(width: number): string[];
}

function mountedPicker(host: SlashCommandHost): TestPicker {
  const mock = host.mountEditorReplacement as ReturnType<typeof vi.fn>;
  return mock.mock.calls[0]?.[0] as TestPicker;
}

function markerAddChild(host: SlashCommandHost): ReturnType<typeof vi.fn> {
  return host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>;
}

function expectSwarmMarker(host: SlashCommandHost, text: string): void {
  const components = markerAddChild(host).mock.calls.map(([component]) => component as TestComponent);
  const rendered = stripAnsi(components.at(-1)?.render(80).join('\n') ?? '');
  expect(rendered).toContain(text);
}

describe('handleSwarmCommand', () => {
  it('sends the swarm prompt as a normal prompt after enabling swarm mode', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });

    await handleSwarmCommand(host, 'Ship feature X');

    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.state.swarmModeEntry).toBe('task');
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
  });

  it('sends the swarm prompt without re-entering swarm mode when already on', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto', swarmMode: true });

    await handleSwarmCommand(host, 'Ship feature X');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(host.state.swarmModeEntry).toBeUndefined();
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
  });

  it('turns swarm mode on without sending a prompt', async () => {
    const { host, session } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'on');

    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('manual');
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('asks before turning swarm mode on in Manual mode', async () => {
    const { host, session } = makeHost({ model: '', permissionMode: 'manual' });

    await handleSwarmCommand(host, 'on');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('Manual mode can block swarm work');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'manual');
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setSwarmMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'auto' });
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('manual');
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('opens the visual swarm config dialog when called without args while swarm mode is off', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: false });

    await handleSwarmCommand(host, '');

    expect(host.mountEditorReplacement).toHaveBeenCalledTimes(1);
    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalledWith({ swarmMode: true });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not call the session when swarm mode is already on', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: true });

    await handleSwarmCommand(host, 'on');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalledWith({ swarmMode: true });
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith('Swarm mode is already on.');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('turns swarm mode off without sending a prompt', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: true });

    await handleSwarmCommand(host, 'off');

    expect(session.setSwarmMode).toHaveBeenCalledWith(false, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: false });
    expect(host.state.swarmModeEntry).toBeUndefined();
    expectSwarmMarker(host, 'Swarm deactivated');
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('opens the visual swarm config dialog when called without args while swarm mode is on', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: true });

    await handleSwarmCommand(host, '');

    expect(host.mountEditorReplacement).toHaveBeenCalledTimes(1);
    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalledWith({ swarmMode: false });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not call the session when swarm mode is already off', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: false });

    await handleSwarmCommand(host, 'off');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalledWith({ swarmMode: false });
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith('Swarm mode is already off.');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('asks before starting a swarm task in Manual mode', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('Manual mode can block swarm work');
    expect(text).toContain('Switch to YOLO and start');
    expect(text).not.toContain('Do not start');
  });

  it('defaults to Auto when confirming a Manual-mode swarm start', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setSwarmMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'auto' });
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('task');
    expectSwarmMarker(host, 'Swarm activated');
  });

  it('can start a Manual-mode swarm task without changing permission', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');
    const picker = mountedPicker(host);
    picker.handleInput(DOWN);
    picker.handleInput(DOWN);
    picker.handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setSwarmMode).toHaveBeenCalledTimes(1);
    expect(host.state.swarmModeEntry).toBe('task');
    expectSwarmMarker(host, 'Swarm activated');
  });

  it('can start a Manual-mode swarm task after switching to YOLO', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');
    const picker = mountedPicker(host);
    picker.handleInput(DOWN);
    picker.handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).toHaveBeenCalledWith('yolo');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setSwarmMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'yolo' });
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('task');
    expectSwarmMarker(host, 'Swarm activated');
  });

  it('returns the command to the input box when a Manual-mode swarm start is cancelled', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ESCAPE);

    expect(host.restoreInputText).toHaveBeenCalledWith('/swarm Ship feature X');
    expect(host.showStatus).toHaveBeenCalledWith('Swarm task not started.');
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not start when permission update fails', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });
    session.setPermission.mockRejectedValueOnce(new Error('denied'));

    await handleSwarmCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to set permission mode'),
      );
    });
    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not send from Manual mode when enabling swarm mode fails after confirmation', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });
    session.setSwarmMode.mockRejectedValueOnce(new Error('denied'));

    await handleSwarmCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to enable swarm mode'),
      );
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not send a prompt when enabling swarm mode fails', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });
    session.setSwarmMode.mockRejectedValueOnce(new Error('denied'));

    await handleSwarmCommand(host, 'Ship feature X');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to enable swarm mode'),
    );
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  describe('native Fusion', () => {
    it.each([
      ['fusion', 'on', ''],
      ['fusion on', 'on', ''],
      ['fusion dual', 'dual', ''],
      ['fusion Build  the\nteam', 'on', 'Build  the\nteam'],
      ['FUSION\tDUAL\tBuild  the team', 'dual', 'Build  the team'],
      ['fusion on Build the team', 'on', 'Build the team'],
      ['fusion genius-boss', 'genius-boss', ''],
      ['fusion idiot-boss', 'idiot-boss', ''],
      ['fusion genius-boss dual', 'genius-boss dual', ''],
      ['fusion idiot-boss dual', 'idiot-boss dual', ''],
      ['fusion genius-boss Build  the team', 'genius-boss', 'Build  the team'],
      ['fusion idiot-boss Build  the team', 'idiot-boss', 'Build  the team'],
      ['fusion genius-boss dual Build  the team', 'genius-boss dual', 'Build  the team'],
      ['fusion idiot-boss dual Build  the team', 'idiot-boss dual', 'Build  the team'],
      ['FUSION\tGENIUS-BOSS\nDUAL\tBuild  the\nteam', 'genius-boss dual', 'Build  the\nteam'],
      ['FUSION\tIDIOT-BOSS\nDUAL\tBuild  the\nteam', 'idiot-boss dual', 'Build  the\nteam'],
      ['fusion idiot boss review', 'on', 'idiot boss review'],
      ['fusion genius boss review', 'on', 'genius boss review'],
      ['fusion idiot-bosses review', 'on', 'idiot-bosses review'],
      ['fusion genius-bosses review', 'on', 'genius-bosses review'],
      ['fusion idiot-boss duality review', 'idiot-boss', 'duality review'],
      ['fusion on idiot-boss dual review', 'on', 'idiot-boss dual review'],
      ['fusion ceo=FableAlias@max', 'on ceo=FableAlias@max', ''],
      ['fusion genius-boss coo=AstraAlias@high worker=GeminiAlias', 'genius-boss coo=AstraAlias@high worker=GeminiAlias', ''],
      ['fusion idiot-boss dual worker=Cheap muse=MuseAlias@max Build  a\nteam', 'idiot-boss dual worker=Cheap muse=MuseAlias@max', 'Build  a\nteam'],
      ['FUSION\tDUAL\tceo=CaseSensitive@high\ncoo=Other\tShip  it', 'dual ceo=CaseSensitive@high coo=Other', 'Ship  it'],
      ['fusion on ceo=One ceo=Two task', 'on ceo=One ceo=Two', 'task'],
      ['fusion on ceo=One task worker=Two', 'on ceo=One', 'task worker=Two'],
      ['fusion on unknown=One ceo=Two', 'on', 'unknown=One ceo=Two'],
      ['fusion on ceo= task', 'on', 'ceo= task'],
    ])('routes %s to the engine without legacy persistence', async (input, mode, task) => {
      const { host, session } = makeHost({ nativeFusion: true, model: '' });
      const env = { ...process.env };
      await handleSwarmCommand(host, input);
      expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', mode);
      expect(session.setSwarmMode).not.toHaveBeenCalled();
      expect(session.setPermission).not.toHaveBeenCalled();
      expect(host.state.appState.swarmMode).toBe(true);
      expect(host.state.swarmModeEntry).toBe(task ? 'task' : 'manual');
      expectSwarmMarker(host, 'Swarm activated');
      if (task) {
        expect(host.sendNormalUserInput).toHaveBeenCalledExactlyOnceWith(task);
        expect(session.runCommand.mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(host.sendNormalUserInput).mock.invocationCallOrder[0]!,
        );
      } else {
        expect(host.sendNormalUserInput).not.toHaveBeenCalled();
      }
      expect(loadLastSwarmSelection).not.toHaveBeenCalled();
      expect(saveSwarmSelection).not.toHaveBeenCalled();
      expect(process.env).toEqual(env);
    });

    it.each(['auto', 'yolo'] as const)('keeps current %s permissions', async (permissionMode) => {
      const { host, session } = makeHost({ nativeFusion: true, permissionMode });
      await handleSwarmCommand(host, 'fusion task');
      expect(session.setPermission).not.toHaveBeenCalled();
      expect(host.mountEditorReplacement).not.toHaveBeenCalled();
      expect(host.state.appState.permissionMode).toBe(permissionMode);
    });

    it.each([['auto', 0], ['yolo', 1], ['manual', 2]] as const)(
      'starts after explicit %s selection', async (choice, downCount) => {
        const { host, session } = makeHost({ nativeFusion: true, permissionMode: 'manual' });
        await handleSwarmCommand(host, 'fusion dual original task');
        expect(session.runCommand).not.toHaveBeenCalled();
        expect(markerAddChild(host)).not.toHaveBeenCalled();
        for (let i = 0; i < downCount; i++) mountedPicker(host).handleInput(DOWN);
        mountedPicker(host).handleInput(ENTER);
        await vi.waitFor(() => {
          expect(host.sendNormalUserInput).toHaveBeenCalledWith('original task');
        });
        expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', 'dual');
        expect(session.setSwarmMode).not.toHaveBeenCalled();
        if (choice === 'manual') {
          expect(session.setPermission).not.toHaveBeenCalled();
        } else {
          expect(session.setPermission).toHaveBeenCalledExactlyOnceWith(choice);
          expect(session.setPermission.mock.invocationCallOrder[0]).toBeLessThan(
            session.runCommand.mock.invocationCallOrder[0]!,
          );
        }
        expect(host.state.appState.permissionMode).toBe(choice);
      },
    );

    it.each(['genius-boss', 'idiot-boss'])('requires permission before starting explicit %s', async (strategy) => {
      const { host, session } = makeHost({ nativeFusion: true, permissionMode: 'manual' });
      await handleSwarmCommand(host, `fusion ${strategy} dual original  task`);
      expect(session.runCommand).not.toHaveBeenCalled();
      expect(markerAddChild(host)).not.toHaveBeenCalled();
      mountedPicker(host).handleInput(ENTER);
      await vi.waitFor(() => {
        expect(host.sendNormalUserInput).toHaveBeenCalledWith('original  task');
      });
      expect(session.setPermission).toHaveBeenCalledExactlyOnceWith('auto');
      expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', `${strategy} dual`);
      expect(session.setPermission.mock.invocationCallOrder[0]).toBeLessThan(
        session.runCommand.mock.invocationCallOrder[0]!,
      );
    });

    it.each(['off', 'status'])('forwards %s overrides to engine validation without activating or sending a task', async (mode) => {
      const { host, session } = makeHost({ nativeFusion: true, swarmMode: true });
      session.runCommand.mockRejectedValueOnce(new Error('Role overrides are not allowed here'));
      await handleSwarmCommand(host, `fusion ${mode} ceo=Alias@high`);
      expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', `${mode} ceo=Alias@high`);
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Role overrides are not allowed'));
      expect(host.setAppState).not.toHaveBeenCalled();
      expect(session.setSwarmMode).not.toHaveBeenCalled();
      expect(markerAddChild(host)).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it.each(['off', 'status'])('rejects %s task text even after overrides', async (mode) => {
      const { host, session } = makeHost({ nativeFusion: true });
      await handleSwarmCommand(host, `fusion ${mode} ceo=Alias task`);
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('does not accept a task'));
      expect(session.runCommand).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it('surfaces missing-model errors without activating or submitting work', async () => {
      const { host, session } = makeHost({ nativeFusion: true });
      session.runCommand.mockRejectedValueOnce(new Error('Unknown model alias Missing; configure a model first'));
      await handleSwarmCommand(host, 'fusion genius-boss ceo=Missing task');
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Unknown model alias Missing'));
      expect(host.setAppState).not.toHaveBeenCalled();
      expect(markerAddChild(host)).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it('composes dialog overrides in deterministic engine role order', async () => {
      const { host, session } = makeHost({ nativeFusion: true });
      host.state.appState.availableModels = {
        Alias: { provider: 'example', model: 'example-model', maxContextSize: 10000, supportEfforts: ['high'] },
      };
      await handleSwarmCommand(host, '');
      const dialog = mountedPicker(host);
      dialog.handleInput('\t');
      const index = SWARM_PATTERNS.findIndex((pattern) => pattern.id === 'fusion-idiot-boss');
      for (let i = 0; i < index; i++) dialog.handleInput(DOWN);
      dialog.handleInput(ENTER);
      dialog.handleInput('\u001B[Z');
      dialog.handleInput('\u001B[C'); // coordinator worker=Alias
      dialog.handleInput(DOWN);
      dialog.handleInput('\u001B[C'); // implementer coo=Alias
      dialog.handleInput(DOWN);
      dialog.handleInput(ENTER); // CEO nested picker
      dialog.handleInput(DOWN);
      dialog.handleInput('\u001B[C'); // high effort
      dialog.handleInput(ENTER);
      dialog.handleInput(DOWN);
      dialog.handleInput(' '); // dual
      dialog.handleInput(DOWN);
      dialog.handleInput('\u001B[C'); // consultant muse=Alias
      dialog.handleInput('\t');
      dialog.handleInput('\t');
      dialog.handleInput(ENTER);
      await vi.waitFor(() => {
        expect(session.runCommand).toHaveBeenCalledExactlyOnceWith(
          'fusion', 'idiot-boss dual ceo=Alias@high coo=Alias worker=Alias muse=Alias',
        );
      });
      expect(saveSwarmSelection).not.toHaveBeenCalled();
      expect(session.setSwarmMode).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it.each(['genius-boss', 'idiot-boss'])('preserves active state when engine rejects a change to %s', async (strategy) => {
      const { host, session } = makeHost({ nativeFusion: true, swarmMode: true });
      host.state.swarmModeEntry = 'manual';
      const appState = { ...host.state.appState };
      session.runCommand.mockRejectedValueOnce(new Error('Strategy is fixed for this team lifetime'));
      await handleSwarmCommand(host, `fusion ${strategy} replacement task`);
      expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', strategy);
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Strategy is fixed'));
      expect(host.setAppState).not.toHaveBeenCalled();
      expect(host.state.appState).toEqual(appState);
      expect(host.state.swarmModeEntry).toBe('manual');
      expect(session.setSwarmMode).not.toHaveBeenCalled();
      expect(markerAddChild(host)).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
      expect(saveSwarmSelection).not.toHaveBeenCalled();
    });

    it('cancels without starting, mutating permissions, or showing an active marker', async () => {
      const { host, session } = makeHost({ nativeFusion: true, permissionMode: 'manual' });
      await handleSwarmCommand(host, 'fusion task');
      mountedPicker(host).handleInput(ESCAPE);
      expect(host.restoreInputText).toHaveBeenCalledWith('/swarm fusion task');
      expect(session.runCommand).not.toHaveBeenCalled();
      expect(session.setPermission).not.toHaveBeenCalled();
      expect(host.state.appState.swarmMode).toBe(false);
      expect(markerAddChild(host)).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it('does not start after a permission failure', async () => {
      const { host, session } = makeHost({ nativeFusion: true, permissionMode: 'manual' });
      session.setPermission.mockRejectedValueOnce(new Error('permission failed'));
      await handleSwarmCommand(host, 'fusion task');
      mountedPicker(host).handleInput(ENTER);
      await vi.waitFor(() => {
        expect(host.showError).toHaveBeenCalled();
      });
      expect(session.runCommand).not.toHaveBeenCalled();
      expect(host.state.appState.swarmMode).toBe(false);
      expect(markerAddChild(host)).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it.each(['fusion', 'fusion task', 'fusion dual task', 'fusion status', 'fusion off', 'off'])(
      'fails closed when %s rejects', async (input) => {
        const { host, session } = makeHost({ nativeFusion: true });
        session.runCommand.mockRejectedValueOnce(new Error('engine rejected'));
        await handleSwarmCommand(host, input);
        expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('engine rejected'));
        expect(host.setAppState).not.toHaveBeenCalled();
        expect(session.setSwarmMode).not.toHaveBeenCalled();
        expect(markerAddChild(host)).not.toHaveBeenCalled();
        expect(host.sendNormalUserInput).not.toHaveBeenCalled();
      },
    );

    it('shows engine status without local state or success narration', async () => {
      const { host, session } = makeHost({ nativeFusion: true, permissionMode: 'manual' });
      await handleSwarmCommand(host, 'fusion status');
      expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', 'status');
      expect(session.setSwarmMode).not.toHaveBeenCalled();
      expect(host.setAppState).not.toHaveBeenCalled();
      expect(host.mountEditorReplacement).not.toHaveBeenCalled();
      expect(host.showStatus).not.toHaveBeenCalled();
      expect(markerAddChild(host)).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it.each(['fusion off task', 'fusion status task'])('rejects trailing control text: %s', async (input) => {
      const { host, session } = makeHost({ nativeFusion: true });
      await handleSwarmCommand(host, input);
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('does not accept a task'));
      expect(session.runCommand).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it.each(['fusion', 'fusion off', 'fusion status'])('rejects %s on a legacy engine', async (input) => {
      const { host, session } = makeHost();
      await handleSwarmCommand(host, input);
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('native engine'));
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('experimental fusion flag'));
      expect(session.runCommand).not.toHaveBeenCalled();
      expect(session.setSwarmMode).not.toHaveBeenCalled();
    });

    it.each(['fusion task', 'fusion off', 'off'])('fails closed when command discovery fails for %s', async (input) => {
      const { host, session } = makeHost({ swarmMode: true });
      session.listCommands.mockRejectedValueOnce(new Error('disconnected'));
      await handleSwarmCommand(host, input);
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
      expect(host.state.appState.swarmMode).toBe(true);
      expect(session.runCommand).not.toHaveBeenCalled();
      expect(session.setSwarmMode).not.toHaveBeenCalled();
      expect(markerAddChild(host)).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it.each([
      ['off', true], ['off', false], ['fusion off', true], ['fusion off', false],
    ] as const)('stops engine before generic %s with local mode %s', async (input, swarmMode) => {
      const { host, session } = makeHost({ nativeFusion: true, swarmMode });
      await handleSwarmCommand(host, input);
      expect(session.listCommands).toHaveBeenCalledOnce();
      expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', 'off');
      expect(session.setSwarmMode).toHaveBeenCalledExactlyOnceWith(false, 'manual');
      expect(session.runCommand.mock.invocationCallOrder[0]).toBeLessThan(
        session.setSwarmMode.mock.invocationCallOrder[0]!,
      );
      expect(host.state.appState.swarmMode).toBe(false);
      expectSwarmMarker(host, 'Swarm deactivated');
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it.each(['off', 'fusion off'])('does not mark %s successful when generic disable fails', async (input) => {
      const { host, session } = makeHost({ nativeFusion: true, swarmMode: true });
      session.setSwarmMode.mockRejectedValueOnce(new Error('disable failed'));
      await handleSwarmCommand(host, input);
      expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', 'off');
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('disable failed'));
      expect(host.state.appState.swarmMode).toBe(true);
      expect(markerAddChild(host)).not.toHaveBeenCalled();
    });

    it('does not reserve similar words', async () => {
      const { host, session } = makeHost({ nativeFusion: true });
      await handleSwarmCommand(host, 'fusionist task');
      expect(session.runCommand).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('fusionist task');
    });

    it.each([
      ['fusion', 'genius-boss', true], ['fusion', 'genius-boss', false],
      ['fusion-idiot-boss', 'idiot-boss', true], ['fusion-idiot-boss', 'idiot-boss', false],
    ] as const)('routes %s dialog confirmation through permission flow (%s, cancel=%s)', async (patternId, strategy, cancel) => {
      const { host, session } = makeHost({ nativeFusion: true, permissionMode: 'manual', model: '' });
      await handleSwarmCommand(host, '');
      const dialog = mountedPicker(host);
      dialog.handleInput('\t');
      const patternIndex = SWARM_PATTERNS.findIndex((pattern) => pattern.id === patternId);
      for (let i = 0; i < patternIndex; i++) dialog.handleInput(DOWN);
      dialog.handleInput(ENTER);
      dialog.handleInput('\t');
      dialog.handleInput(ENTER);
      await vi.waitFor(() => {
        expect(host.mountEditorReplacement).toHaveBeenCalledTimes(2);
      });
      const permission = vi.mocked(host.mountEditorReplacement).mock.calls[1]![0] as TestPicker;
      expect(session.runCommand).not.toHaveBeenCalled();
      permission.handleInput(cancel ? ESCAPE : ENTER);
      if (cancel) {
        expect(host.restoreInputText).toHaveBeenCalledWith('/swarm');
        expect(session.runCommand).not.toHaveBeenCalled();
        expect(markerAddChild(host)).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => {
          expect(host.state.appState.swarmMode).toBe(true);
        });
        expect(session.runCommand).toHaveBeenCalledExactlyOnceWith('fusion', strategy);
        expectSwarmMarker(host, 'Swarm activated');
      }
      expect(saveSwarmSelection).not.toHaveBeenCalled();
      expect(loadLastSwarmSelection).not.toHaveBeenCalled();
      expect(session.setSwarmMode).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    });

    it('retains legacy configuration persistence for nonnative patterns', async () => {
      const { host, session } = makeHost();
      await handleSwarmCommand(host, '');
      const dialog = mountedPicker(host);
      dialog.handleInput('\t');
      dialog.handleInput('\t');
      dialog.handleInput(ENTER);
      await vi.waitFor(() => {
        expect(host.state.appState.swarmMode).toBe(true);
      });
      expect(saveSwarmSelection).toHaveBeenCalledWith(expect.objectContaining({ pattern: 'moa', sessionModels: ['kimi-model'] }));
      expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'manual');
      expect(session.runCommand).not.toHaveBeenCalled();
    });

    it.each(['fusion', 'fusion-idiot-boss'] as const)('keeps %s out of the custom dialog, including loaded preferences', async (pattern) => {
      vi.mocked(loadLastSwarmSelection).mockReturnValueOnce({ ...getDefaultSwarmSelection(), pattern });
      const { host } = makeHost();
      await handleSwarmCommand(host, 'custom');
      const dialog = mountedPicker(host);
      expect(stripAnsi(dialog.render(120).join('\n'))).toContain(SWARM_PATTERNS[0]!.label);
      for (let i = 0; i < SWARM_PATTERNS.length; i++) {
        dialog.handleInput('\u001B[C');
        expect(stripAnsi(dialog.render(120).join('\n'))).not.toContain('Native Fusion');
      }
      expect(saveSwarmSelection).not.toHaveBeenCalled();
    });

    it('completes native Fusion and its controls without consuming tasks', () => {
      expect(swarmArgumentCompletions('f')?.map((item) => item.value)).toContain('fusion');
      expect(swarmArgumentCompletions('fusion ')?.map((item) => item.value)).toEqual([
        'fusion on', 'fusion dual', 'fusion off', 'fusion status',
        'fusion genius-boss', 'fusion idiot-boss',
      ]);
      expect(swarmArgumentCompletions('FUSION d')?.map((item) => item.value)).toEqual(['fusion dual']);
      expect(swarmArgumentCompletions('fusion dual task')).toBeNull();
    });
  });

  it('mounts the custom swarm dialog on /swarm custom', async () => {
    const { host } = makeHost({ permissionMode: 'auto' });

    await handleSwarmCommand(host, 'custom build user auth module');

    expect(host.mountEditorReplacement).toHaveBeenCalled();
    const picker = mountedPicker(host);
    const rendered = stripAnsi(picker.render(80).join('\n'));
    expect(rendered).toContain('Custom Multi-Model Agent Swarm');
    expect(rendered).toContain('build user auth module');
  });

  it('shows both custom buttons and selects Cancel without persistence', async () => {
    const { host, session } = makeHost();
    await handleSwarmCommand(host, 'custom');
    const dialog = mountedPicker(host);
    const initial = stripAnsi(dialog.render(100).join('\n'));
    expect(initial).toContain('[ Start Custom Swarm ]');
    expect(initial).toContain('[ Cancel ]');
    expect(initial).toContain('No session models configured');
    dialog.handleInput('\u001B[A');
    expect(stripAnsi(dialog.render(100).join('\n'))).toContain('❯ [ Cancel ]');
    dialog.handleInput(ENTER);
    expect(host.showStatus).toHaveBeenCalledWith('Custom swarm configuration cancelled.');
    expect(saveSwarmSelection).not.toHaveBeenCalled();
    expect(session.setSwarmMode).not.toHaveBeenCalled();
  });

  it('pages the entire custom session catalog, persists selections, and preserves override-like task text', async () => {
    const { host } = makeHost();
    host.state.appState.availableModels = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [
      `CatalogAlias${i}`, { provider: 'example', model: `model-${i}`, displayName: `Catalog Model ${i}`, maxContextSize: 10000 },
    ]));
    await handleSwarmCommand(host, 'custom ceo=KeepThis  original\nworker=AlsoTask');
    const dialog = mountedPicker(host);
    dialog.handleInput('\u001B[6~'); // lands on the last provider row
    dialog.handleInput(DOWN); // thinking row (pattern + moa layers + seven providers)
    dialog.handleInput(DOWN); // first session alias
    for (let i = 0; i < 25; i++) {
      const output = stripAnsi(dialog.render(120).join('\n'));
      expect(output).toContain(`[CatalogAlias${i}]`);
      expect(output).toContain('Session models (AndrewCode)');
      expect(output).toContain('example');
      expect(output.split('\n').length).toBeLessThan(42);
      if (i === 0) {
        dialog.handleInput(' ');
        dialog.handleInput(ENTER); // Enter also toggles, leaving first alias unselected
      }
      if (i === 24) dialog.handleInput(ENTER);
      dialog.handleInput(DOWN);
    }
    const lastPage = stripAnsi(dialog.render(120).join('\n'));
    expect(lastPage).toContain('Page 4 / 4');
    expect(lastPage).toContain('[x] Catalog Model 24 [CatalogAlias24]');
    expect(lastPage).toContain('❯ [ Start Custom Swarm ]');
    for (const line of dialog.render(20)) expect(stripAnsi(line).length).toBeLessThanOrEqual(20);
    dialog.handleInput(ENTER);
    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalled();
    });
    expect(saveSwarmSelection).toHaveBeenCalledWith(expect.objectContaining({
      sessionModels: ['CatalogAlias24'], task: 'ceo=KeepThis  original\nworker=AlsoTask',
    }));
    const prompt = vi.mocked(host.sendNormalUserInput).mock.calls[0]![0];
    expect(prompt).toContain('AndrewCode session models: CatalogAlias24');
    expect(prompt).toContain('Task: ceo=KeepThis  original\nworker=AlsoTask');
  });

  it('mounts the custom swarm dialog on /swarm select without initial task', async () => {
    const { host } = makeHost({ permissionMode: 'auto' });

    await handleSwarmCommand(host, 'select');

    expect(host.mountEditorReplacement).toHaveBeenCalled();
    const picker = mountedPicker(host);
    const rendered = stripAnsi(picker.render(80).join('\n'));
    expect(rendered).toContain('Custom Multi-Model Agent Swarm');
  });
});

describe('Fusion script subcommands', () => {
  it('starts the dashboard on the default port and shows the URL', async () => {
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'dashboard');

    expect(resolveFusionScriptsRoot).toHaveBeenCalled();
    expect(openFusionDashboard).toHaveBeenCalledWith(8765);
    expect(host.showStatus).toHaveBeenCalledWith('Fusion dashboard: http://127.0.0.1:8765/');
  });

  it('passes an explicit dashboard port through', async () => {
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'dashboard --port 9000');

    expect(openFusionDashboard).toHaveBeenCalledWith(9000);
  });

  it('honors FUSION_DASHBOARD_PORT for the default dashboard port', async () => {
    const previous = process.env['FUSION_DASHBOARD_PORT'];
    process.env['FUSION_DASHBOARD_PORT'] = '8123';
    try {
      const { host } = makeHost({ model: '' });
      await handleSwarmCommand(host, 'dashboard');
      expect(openFusionDashboard).toHaveBeenCalledWith(8123);
    } finally {
      if (previous === undefined) delete process.env['FUSION_DASHBOARD_PORT'];
      else process.env['FUSION_DASHBOARD_PORT'] = previous;
    }
  });

  it('prefers --port over FUSION_DASHBOARD_PORT', async () => {
    const previous = process.env['FUSION_DASHBOARD_PORT'];
    process.env['FUSION_DASHBOARD_PORT'] = '8123';
    try {
      const { host } = makeHost({ model: '' });
      await handleSwarmCommand(host, 'dashboard --port 9000');
      expect(openFusionDashboard).toHaveBeenCalledWith(9000);
    } finally {
      if (previous === undefined) delete process.env['FUSION_DASHBOARD_PORT'];
      else process.env['FUSION_DASHBOARD_PORT'] = previous;
    }
  });

  it('shows a manual-open fallback when the dashboard URL is unknown', async () => {
    vi.mocked(openFusionDashboard).mockResolvedValue(undefined);
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'dashboard');

    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('http://127.0.0.1:8765/ — open it manually'),
    );
  });

  it('errors when the Fusion scripts root cannot be resolved', async () => {
    vi.mocked(resolveFusionScriptsRoot).mockReturnValue(undefined);
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'dashboard');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Fusion scripts not found'));
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('FUSION_PLUGIN_ROOT'));
    expect(openFusionDashboard).not.toHaveBeenCalled();
  });

  it.each(['dashboard --port abc', 'dashboard --port', 'dashboard --port 99999'] as const)(
    'rejects invalid dashboard port input: %s',
    async (input) => {
      const { host } = makeHost({ model: '' });
      await handleSwarmCommand(host, input);
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('port'));
      expect(openFusionDashboard).not.toHaveBeenCalled();
    },
  );

  it('leaves task-like dashboard text to the plain task path', async () => {
    const { host, session } = makeHost({});

    await handleSwarmCommand(host, 'dashboard build me a view');

    expect(openFusionDashboard).not.toHaveBeenCalled();
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('dashboard build me a view');
  });

  it('summarizes fusion detect output', async () => {
    vi.mocked(runFusionScript).mockResolvedValue({
      stdout: JSON.stringify({
        providers: {
          claude: 'host-native',
          codex: 'available',
          copilot: 'missing',
          opencode: 'available',
          grok: 'degraded',
          kimi: 'available',
          andrewcode: 'missing',
        },
        metaloop: { agy: 'available', fable: 'missing', andrewcode: 'missing' },
      }),
      stderr: '',
      exitCode: 0,
    });
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'detect');

    expect(runFusionScript).toHaveBeenCalledWith(
      join('/mock/fusion/scripts', 'fusion.sh'),
      ['detect', '--json'],
      { cwd: '/mock/fusion/scripts', timeoutMs: 30000 },
    );
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Fusion detect (scripts: /mock/fusion/scripts)'),
    );
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('codex: available'));
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('grok: degraded'));
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('metaloop — agy: available, fable: missing, andrewcode: missing'),
    );
  });

  it('errors when fusion detect exits nonzero', async () => {
    vi.mocked(runFusionScript).mockResolvedValue({ stdout: '', stderr: 'bash: boom', exitCode: 1 });
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'detect');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Fusion detect failed'));
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('bash: boom'));
  });

  it('errors when fusion detect output is not parseable', async () => {
    vi.mocked(runFusionScript).mockResolvedValue({ stdout: 'not json', stderr: '', exitCode: 0 });
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'detect');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Fusion detect produced unexpected output'),
    );
  });

  it('errors when the fusion detect script cannot be spawned', async () => {
    vi.mocked(runFusionScript).mockRejectedValueOnce(new Error('spawn failed'));
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'detect');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Failed to run Fusion detect'));
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('spawn failed'));
  });

  it('errors on detect when the scripts root is missing', async () => {
    vi.mocked(resolveFusionScriptsRoot).mockReturnValue(undefined);
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'detect');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Fusion scripts not found'));
    expect(runFusionScript).not.toHaveBeenCalled();
  });

  it.each([
    ['doctor', 120000],
    ['test', 120000],
    ['launch', 60000],
    ['status', 60000],
    ['install', 60000],
  ] as const)('runs ultracode %s with its timeout budget', async (verb, timeoutMs) => {
    vi.mocked(runFusionScript).mockResolvedValue({ stdout: `${verb} ok`, stderr: '', exitCode: 0 });
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, `ultracode ${verb}`);

    expect(runFusionScript).toHaveBeenCalledWith(
      join('/mock/fusion/scripts', 'ultracode.sh'),
      [verb],
      { cwd: '/mock/fusion/scripts', timeoutMs },
    );
    expect(host.showStatus).toHaveBeenCalledWith(`${verb} ok`);
  });

  it('errors on a missing ultracode verb', async () => {
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'ultracode');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('UltraCode expects a verb'));
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('doctor, test, launch, status, install'));
    expect(runFusionScript).not.toHaveBeenCalled();
  });

  it('errors on an unknown ultracode verb', async () => {
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'ultracode frobnicate');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining("Unknown UltraCode verb 'frobnicate'"));
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('doctor, test, launch, status, install'));
    expect(runFusionScript).not.toHaveBeenCalled();
  });

  it('errors on extra ultracode arguments', async () => {
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'ultracode doctor --force');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('UltraCode doctor does not accept extra arguments'),
    );
    expect(runFusionScript).not.toHaveBeenCalled();
  });

  it('trims long ultracode output to twenty lines', async () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
    vi.mocked(runFusionScript).mockResolvedValue({ stdout: lines.join('\n'), stderr: '', exitCode: 0 });
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'ultracode status');

    const status = vi.mocked(host.showStatus).mock.calls[0]![0];
    expect(status).toContain('line 20');
    expect(status).not.toContain('line 21');
  });

  it('errors when an ultracode verb fails', async () => {
    vi.mocked(runFusionScript).mockResolvedValue({ stdout: '', stderr: 'ultracode exploded', exitCode: 2 });
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'ultracode install');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('UltraCode install failed'));
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('ultracode exploded'));
  });

  it('errors on ultracode when the scripts root is missing', async () => {
    vi.mocked(resolveFusionScriptsRoot).mockReturnValue(undefined);
    const { host } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'ultracode status');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Fusion scripts not found'));
    expect(runFusionScript).not.toHaveBeenCalled();
  });
});

describe('script-form swarm tasks', () => {
  it('persists hive flags and sends a Fusion-tool brief', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'hive --dry-run --captains codex,grok --children-per-captain 8 Build the CLI');

    expect(loadLastSwarmSelection).toHaveBeenCalled();
    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'hive',
        task: 'Build the CLI',
        formOptions: expect.objectContaining({
          captains: ['codex', 'grok'],
          childrenPerCaptain: 8,
          dryRun: true,
        }),
      }),
    );
    const prompt = vi.mocked(host.sendNormalUserInput).mock.calls[0]![0];
    expect(prompt).toContain('Form: hive');
    expect(prompt).toContain('Captains: codex, grok');
    expect(prompt).toContain('Children per captain: 8');
    expect(prompt).toContain('Dry run: on');
    expect(prompt).toContain('mode=hive');
    expect(prompt).toContain('captains=codex,grok');
    expect(prompt).toContain('children_per_captain=8');
    expect(prompt).toContain('dry_run=true');
    expect(prompt).toContain('Task: Build the CLI');
  });

  it('runs graph tasks with default form options', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'graph Analyze the flow');

    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'graph',
        formOptions: expect.objectContaining({
          captains: ['kimi', 'opencode', 'grok', 'copilot'],
          childrenPerCaptain: 4,
          dryRun: false,
        }),
      }),
    );
    const prompt = vi.mocked(host.sendNormalUserInput).mock.calls[0]![0];
    expect(prompt).toContain('mode=graph');
    expect(prompt).toContain('dry_run=false');
    expect(prompt).toContain('Dry run: off');
  });

  it('runs designer and metaloop tasks', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'designer Design a swarm');
    expect(saveSwarmSelection).toHaveBeenCalledWith(expect.objectContaining({ pattern: 'designer' }));
    expect(vi.mocked(host.sendNormalUserInput).mock.calls[0]![0]).toContain('mode=designer');

    await handleSwarmCommand(host, 'metaloop Plan this');
    expect(saveSwarmSelection).toHaveBeenCalledWith(expect.objectContaining({ pattern: 'metaloop' }));
    expect(vi.mocked(host.sendNormalUserInput).mock.calls[1]![0]).toContain('mode=metaloop');
  });

  it('persists ultraswarm tasks and thinking effort', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'ultraswarm --thinking-effort high Review the design');

    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'ultraswarm',
        task: 'Review the design',
        formOptions: expect.objectContaining({ thinkingEffort: 'high' }),
      }),
    );
    expect(runFusionScript).not.toHaveBeenCalled();
    const prompt = vi.mocked(host.sendNormalUserInput).mock.calls[0]![0];
    expect(prompt).toContain('ultraswarm');
    expect(prompt).toContain('Task: Review the design');
  });

  it('defaults /swarm board to the agents verb', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'board');

    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'board',
        formOptions: expect.objectContaining({ boardVerb: 'agents' }),
      }),
    );
    expect(runFusionScript).not.toHaveBeenCalled();
    expect(vi.mocked(host.sendNormalUserInput).mock.calls[0]![0]).toContain('board');
  });

  it.each(['init', 'agents', 'poll', 'channels', 'tree', 'mentions'] as const)(
    'routes /swarm board %s through the form brief',
    async (verb) => {
      const { host } = makeHost({});

      await handleSwarmCommand(host, `board ${verb}`);

      expect(saveSwarmSelection).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'board',
          formOptions: expect.objectContaining({ boardVerb: verb }),
        }),
      );
    },
  );

  it('parses board --db and leftover task text', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'board --db /tmp/hive.sqlite poll Inspect captains');

    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'board',
        task: 'Inspect captains',
        formOptions: expect.objectContaining({
          boardVerb: 'poll',
          boardDb: '/tmp/hive.sqlite',
        }),
      }),
    );
  });

  it('defaults /swarm context to list', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'context');

    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'context',
        formOptions: expect.objectContaining({ contextAction: 'list' }),
      }),
    );
    expect(runFusionScript).not.toHaveBeenCalled();
  });

  it('parses context get/set/clear keys', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'context get roster');
    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'context',
        task: 'roster',
        formOptions: expect.objectContaining({ contextAction: 'get', contextKey: 'roster' }),
      }),
    );

    await handleSwarmCommand(host, 'context set roster five captains');
    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'context',
        task: 'roster five captains',
        formOptions: expect.objectContaining({
          contextAction: 'set',
          contextKey: 'roster',
          contextValue: 'five captains',
        }),
      }),
    );

    await handleSwarmCommand(host, 'context clear roster');
    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'context',
        formOptions: expect.objectContaining({ contextAction: 'clear', contextKey: 'roster' }),
      }),
    );

    await handleSwarmCommand(host, 'context snapshot');
    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'context',
        formOptions: expect.objectContaining({ contextAction: 'snapshot' }),
      }),
    );
  });

  it('rejects an unknown context action', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'context frobnicate');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining("Unknown context action 'frobnicate'"));
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('list, get, set, clear, snapshot'));
    expect(saveSwarmSelection).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('rejects context get/set without the required arguments', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'context get');
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('context get expects a key'));

    await handleSwarmCommand(host, 'context set roster');
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('context set expects a value'));

    expect(saveSwarmSelection).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('rejects --db on non-board forms', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'hive --db /tmp/hive.sqlite task');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Unknown or incomplete swarm flag: --db'),
    );
    expect(saveSwarmSelection).not.toHaveBeenCalled();
  });

  it('uses the default task when a form task has no task text', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'hive --dry-run');

    const prompt = vi.mocked(host.sendNormalUserInput).mock.calls[0]![0];
    expect(prompt).toContain('Task: Execute collaborative swarm analysis and solution');
  });

  it('keeps council output on the panel brief format', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'council Vote on the approach');

    expect(saveSwarmSelection).toHaveBeenCalledWith(expect.objectContaining({ pattern: 'council' }));
    const prompt = vi.mocked(host.sendNormalUserInput).mock.calls[0]![0];
    expect(prompt).toContain('Consensus Council & Ballot');
    expect(prompt).not.toContain('Form:');
  });

  it('treats council flag-like text as task text', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'council --dry-run review');

    expect(saveSwarmSelection).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'council', task: '--dry-run review' }),
    );
  });

  it('rejects unknown captains', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'hive --captains codex,nope task');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining("Unknown captain 'nope'"));
    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('codex, claude, grok, copilot, opencode, kimi, agy'),
    );
    expect(saveSwarmSelection).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('rejects a missing --captains value', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'hive --captains --dry-run task');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('--captains expects'));
    expect(saveSwarmSelection).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it.each([
    'hive --children-per-captain 0 task',
    'hive --children-per-captain 99 task',
    'hive --children-per-captain abc task',
    'hive --children-per-captain --dry-run task',
  ] as const)('rejects invalid --children-per-captain input: %s', async (input) => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, input);

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('between 1 and 32'));
    expect(saveSwarmSelection).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('errors on unknown form flags', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'hive --layers 3 task');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Unknown or incomplete swarm flag: --layers'),
    );
    expect(saveSwarmSelection).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('routes form tasks through the Manual-mode permission flow', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'hive task');

    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(session.setSwarmMode).not.toHaveBeenCalled();
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalled();
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(vi.mocked(host.sendNormalUserInput).mock.calls[0]![0]).toContain('mode=hive');
  });

  it('restores the command text when a Manual-mode form task is cancelled', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'hive task');
    mountedPicker(host).handleInput(ESCAPE);

    expect(host.restoreInputText).toHaveBeenCalledWith('/swarm hive task');
    expect(host.showStatus).toHaveBeenCalledWith('Swarm task not started.');
    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('opens the agent communications board for /swarm comms', async () => {
    const { host } = makeHost({});
    host.state.appState.workDir = '/tmp/workspace';

    await handleSwarmCommand(host, 'comms');

    expect(host.mountEditorReplacement).toHaveBeenCalledTimes(1);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(saveSwarmSelection).not.toHaveBeenCalled();
  });

  it('rejects extra arguments on /swarm comms', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'comms hive');

    expect(host.showError).toHaveBeenCalledWith('/swarm comms does not accept extra arguments.');
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
  });

  it('does not reserve similar form words', async () => {
    const { host } = makeHost({});

    await handleSwarmCommand(host, 'graphite engine task');

    expect(saveSwarmSelection).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('graphite engine task');
  });

  it.each(['ultraswarming the plan', 'boardroom notes', 'contextual rewrite'] as const)(
    'leaves lookalike %s on the plain task path',
    async (input) => {
      const { host } = makeHost({});

      await handleSwarmCommand(host, input);

      expect(saveSwarmSelection).not.toHaveBeenCalled();
      expect(host.sendNormalUserInput).toHaveBeenCalledWith(input);
    },
  );
});
