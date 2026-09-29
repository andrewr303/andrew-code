import type { PermissionMode } from '@moonshot-ai/kimi-code-sdk';

import { join } from 'node:path';

import {
  CustomSwarmDialogComponent,
} from '../components/dialogs/custom-swarm-dialog';
import {
  SwarmConfigDialogComponent,
  type SwarmConfigSelection,
} from '../components/dialogs/swarm-config-dialog';
import {
  SwarmBoardDialogComponent,
} from '../components/dialogs/swarm-board-dialog';
import {
  SwarmStartPermissionPromptComponent,
  type SwarmStartPermissionChoice,
} from '../components/dialogs/swarm-start-permission-prompt';
import {
  SwarmModeMarkerComponent,
  type SwarmModeMarkerState,
} from '../components/messages/swarm-markers';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/kimi-tui';
import { formatErrorMessage } from '../utils/event-payload';
import {
  formatSwarmBrief,
  FUSION_PROVIDERS,
  loadLastSwarmSelection,
  nativeFusionStrategy,
  saveSwarmSelection,
  type FusionProviderId,
  type SwarmFormOptions,
  type SwarmPattern,
  type SwarmSelectionState,
  type UltracodeVerb,
} from '../utils/fusion-swarm';
import {
  openFusionDashboard,
  resolveFusionScriptsRoot,
  runFusionScript,
} from '../utils/fusion-scripts';
import { pickerModelsForHost } from './config';
import type { SlashCommandHost } from './dispatch';

export async function handleSwarmCommand(host: SlashCommandHost, args: string): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const prompt = args.trim();

  if (/^fusion(?:\s|$)/i.test(prompt)) {
    await handleNativeFusion(host, prompt.replace(/^fusion\s*/i, ''), `/swarm ${prompt}`);
    return;
  }

  // Legacy custom multi-provider swarm dialog.
  if (
    prompt === 'custom' ||
    prompt === 'select' ||
    prompt.startsWith('custom ') ||
    prompt.startsWith('select ')
  ) {
    const taskBrief = prompt.replace(/^(custom|select)\s*/i, '').trim();
    showCustomSwarmDialog(host, taskBrief);
    return;
  }

  const mode = swarmModeSubcommand(prompt);
  if (mode !== undefined) {
    await applySwarmMode(host, mode, `/swarm ${prompt}`);
    return;
  }

  // Local Fusion plugin script subcommands (no model or swarm mode required).
  const dashboard = parseDashboardSubcommand(prompt);
  if (dashboard !== undefined) {
    if (dashboard.kind === 'error') {
      host.showError(dashboard.message);
    } else {
      await handleSwarmDashboard(host, dashboard.port);
    }
    return;
  }

  if (/^detect$/i.test(prompt)) {
    await handleSwarmDetect(host);
    return;
  }

  const comms = parseCommsSubcommand(prompt);
  if (comms !== undefined) {
    if (comms.kind === 'error') {
      host.showError(comms.message);
    } else {
      showSwarmCommsDialog(host);
    }
    return;
  }

  const ultracode = parseUltracodeSubcommand(prompt);
  if (ultracode !== undefined) {
    if (ultracode.kind === 'error') {
      host.showError(ultracode.message);
    } else {
      await handleSwarmUltracode(host, ultracode.verb);
    }
    return;
  }

  if (prompt.length === 0) {
    showSwarmConfigDialog(host);
    return;
  }

  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  // Script-form swarm tasks: /swarm hive|graph|designer|metaloop|ultraswarm|
  // board|context <task...> (with optional flags) and /swarm council <task...>.
  const formTask = parseFormTaskCommand(prompt);
  if (formTask !== undefined) {
    if (formTask.kind === 'error') {
      host.showError(formTask.message);
    } else {
      await startFormSwarmTask(
        host,
        formTask.pattern,
        formTask.task,
        formTask.options,
        `/swarm ${prompt}`,
      );
    }
    return;
  }

  if (host.state.appState.permissionMode === 'manual') {
    showSwarmStartPermissionPrompt(host, `/swarm ${prompt}`, 'Swarm task not started.', (choice) =>
      startSwarmWithPermission(host, prompt, choice),
    );
    return;
  }

  await startSwarmTask(host, prompt);
}

function showCustomSwarmDialog(host: SlashCommandHost, initialTask: string): void {
  host.mountEditorReplacement(
    new CustomSwarmDialogComponent({
      initialTask,
      models: pickerModelsForHost(host),
      onStart: (selection: SwarmSelectionState) => {
        host.restoreEditor();
        const brief = formatSwarmBrief(selection);
        const taskText = selection.task.trim() || 'Execute collaborative swarm analysis and solution';
        const fullPrompt = `${brief}\n\nTask: ${taskText}`;

        if (host.state.appState.permissionMode === 'manual') {
          showSwarmStartPermissionPrompt(host, `/swarm custom ${selection.task}`, 'Swarm task not started.', (choice) =>
            startSwarmWithPermission(host, fullPrompt, choice),
          );
        } else {
          void startSwarmTask(host, fullPrompt);
        }
      },
      onCancel: () => {
        host.restoreEditor();
        host.showStatus('Custom swarm configuration cancelled.');
      },
    }),
  );
}

function showSwarmConfigDialog(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new SwarmConfigDialogComponent({
      models: pickerModelsForHost(host),
      currentValue: host.state.appState.model,
      onConfirm: (selection) => {
        host.restoreEditor();
        void confirmSwarmConfig(host, selection);
      },
      onCancel: () => {
        host.restoreEditor();
        host.showStatus('Swarm configuration cancelled.');
      },
    }),
  );
}

/** Native Fusion owns its role preset; other patterns retain client-side preferences. */
async function confirmSwarmConfig(
  host: SlashCommandHost,
  selection: SwarmConfigSelection,
): Promise<void> {
  const strategy = nativeFusionStrategy(selection.pattern);
  if (strategy !== undefined) {
    const args: string[] = [strategy];
    if (selection.dual) args.push('dual');
    for (const role of ['ceo', 'coo', 'worker', 'muse'] as const) {
      const assignment = selection.roles?.[role];
      if (assignment === undefined || (role === 'muse' && !selection.dual)) continue;
      args.push(`${role}=${assignment.model}${assignment.effort ? `@${assignment.effort}` : ''}`);
    }
    await handleNativeFusion(host, args.join(' '), '/swarm');
    return;
  }
  const state = loadLastSwarmSelection();
  state.pattern = selection.pattern;
  state.sessionModels = [...selection.models];
  if (selection.formOptions !== undefined) {
    state.formOptions = { ...selection.formOptions };
  }
  const thinkingEffort = selection.thinkingEffort?.trim();
  if (thinkingEffort !== undefined && thinkingEffort.length > 0) {
    state.formOptions.thinkingEffort = thinkingEffort;
  }
  saveSwarmSelection(state);
  await applySwarmMode(host, true, '/swarm');
}

function showSwarmStartPermissionPrompt(
  host: SlashCommandHost,
  commandText: string,
  cancelStatus: string,
  onSelect: (choice: SwarmStartPermissionChoice) => Promise<void>,
): void {
  const cancelStart = (): void => {
    host.restoreInputText(commandText);
    host.showStatus(cancelStatus);
  };
  host.mountEditorReplacement(
    new SwarmStartPermissionPromptComponent({
      onSelect: (choice) => {
        host.restoreEditor();
        void onSelect(choice);
      },
      onCancel: cancelStart,
    }),
  );
}

async function startSwarmWithPermission(
  host: SlashCommandHost,
  prompt: string,
  choice: SwarmStartPermissionChoice,
): Promise<void> {
  if (choice === 'auto' || choice === 'yolo') {
    if (!(await setPermissionForSwarm(host, choice))) return;
  }
  await startSwarmTask(host, prompt);
}

async function setPermissionForSwarm(host: SlashCommandHost, mode: PermissionMode): Promise<boolean> {
  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
    return false;
  }
  host.setAppState({ permissionMode: mode });
  return true;
}

async function startSwarmTask(host: SlashCommandHost, prompt: string): Promise<void> {
  if (!host.state.appState.swarmMode && !(await setSwarmMode(host, true, 'task'))) {
    return;
  }
  renderSwarmModeMarker(host, 'active');
  host.sendNormalUserInput(prompt);
}

async function handleNativeFusion(
  host: SlashCommandHost,
  args: string,
  commandText: string,
): Promise<void> {
  const control = args.match(/^(on|dual|off|status|genius-boss|idiot-boss)(?:\s|$)/i);
  const baseMode = control?.[1]?.toLowerCase() ?? 'on';
  let mode = baseMode;
  let task = (control === null ? args : args.slice(control[0].length)).trim();
  if (baseMode === 'genius-boss' || baseMode === 'idiot-boss') {
    const dual = task.match(/^dual(?:\s|$)/i);
    if (dual !== null) {
      mode += ' dual';
      task = task.slice(dual[0].length).trim();
    }
  }
  let override = task.match(/^(ceo|coo|worker|muse)=\S+(?=\s|$)/);
  while (override !== null) {
    mode += ` ${override[0]}`;
    task = task.slice(override[0].length).trimStart();
    override = task.match(/^(ceo|coo|worker|muse)=\S+(?=\s|$)/);
  }
  if ((baseMode === 'off' || baseMode === 'status') && task.length > 0) {
    host.showError(`/swarm fusion ${baseMode} does not accept a task.`);
    return;
  }
  if (mode === 'off') {
    await disableSwarm(host, true);
    return;
  }
  try {
    const commands = await host.requireSession().listCommands();
    if (!commands.some((command) => command.name === 'fusion')) {
      host.showError('Native Fusion requires the native engine and its experimental fusion flag.');
      return;
    }
  } catch (error) {
    host.showError(`Failed to query native Fusion: ${formatErrorMessage(error)}`);
    return;
  }
  if (baseMode === 'off' || baseMode === 'status') {
    await runNativeFusion(host, mode);
    return;
  }
  const start = async (choice?: SwarmStartPermissionChoice): Promise<void> => {
    if ((choice === 'auto' || choice === 'yolo') && !(await setPermissionForSwarm(host, choice))) {
      return;
    }
    if (!(await runNativeFusion(host, mode))) return;
    host.setAppState({ swarmMode: true });
    host.state.swarmModeEntry = task.length > 0 ? 'task' : 'manual';
    renderSwarmModeMarker(host, 'active');
    if (task.length > 0) host.sendNormalUserInput(task);
  };
  if (host.state.appState.permissionMode === 'manual') {
    showSwarmStartPermissionPrompt(host, commandText, 'Swarm task not started.', start);
    return;
  }
  await start();
}

async function runNativeFusion(host: SlashCommandHost, mode: string): Promise<boolean> {
  try {
    await host.requireSession().runCommand('fusion', mode);
    return true;
  } catch (error) {
    host.showError(`Failed to run native Fusion ${mode}: ${formatErrorMessage(error)}`);
    return false;
  }
}

async function disableSwarm(host: SlashCommandHost, requireNative = false): Promise<void> {
  let hasNative: boolean;
  try {
    const commands = await host.requireSession().listCommands();
    hasNative = commands.some((command) => command.name === 'fusion');
  } catch (error) {
    host.showError(`Failed to query native Fusion: ${formatErrorMessage(error)}`);
    return;
  }
  if (requireNative && !hasNative) {
    host.showError('Native Fusion requires the native engine and its experimental fusion flag.');
    return;
  }
  if (hasNative && !(await runNativeFusion(host, 'off'))) return;
  if (!hasNative && !host.state.appState.swarmMode) {
    host.showStatus('Swarm mode is already off.');
    return;
  }
  if (!(await setSwarmMode(host, false, 'manual'))) return;
  renderSwarmModeMarker(host, 'inactive');
}

/** Legacy enable path; disabling also stops any engine-owned Fusion team. */
export async function applySwarmMode(
  host: SlashCommandHost,
  enabled: boolean,
  commandText: string,
): Promise<void> {
  if (enabled && host.state.appState.swarmMode) {
    host.showStatus('Swarm mode is already on.');
    return;
  }
  if (!enabled) {
    await disableSwarm(host);
    return;
  }
  if (enabled && host.state.appState.permissionMode === 'manual') {
    showSwarmStartPermissionPrompt(host, commandText, 'Swarm mode not enabled.', async (choice) => {
      if ((choice === 'auto' || choice === 'yolo') && !(await setPermissionForSwarm(host, choice))) {
        return;
      }
      if (!(await setSwarmMode(host, true, 'manual'))) return;
      renderSwarmModeMarker(host, 'active');
    });
    return;
  }
  if (!(await setSwarmMode(host, enabled, 'manual'))) return;
  renderSwarmModeMarker(host, enabled ? 'active' : 'inactive');
}

async function setSwarmMode(
  host: SlashCommandHost,
  enabled: boolean,
  trigger: 'manual' | 'task',
): Promise<boolean> {
  try {
    await host.requireSession().setSwarmMode(enabled, trigger);
  } catch (error) {
    host.showError(
      `Failed to ${enabled ? 'enable' : 'disable'} swarm mode: ${formatErrorMessage(error)}`,
    );
    return false;
  }
  host.setAppState({ swarmMode: enabled });
  host.state.swarmModeEntry = enabled ? trigger : undefined;
  return true;
}

function swarmModeSubcommand(input: string): boolean | undefined {
  const command = input.toLowerCase();
  if (command === 'on') return true;
  if (command === 'off') return false;
  return undefined;
}

function renderSwarmModeMarker(host: SlashCommandHost, state: SwarmModeMarkerState): void {
  host.state.transcriptContainer.addChild(
    new SwarmModeMarkerComponent(state),
  );
  host.state.ui.requestRender();
}

// ---------------------------------------------------------------------------
// Fusion plugin script subcommands
// ---------------------------------------------------------------------------

const ULTRACODE_VERBS: readonly UltracodeVerb[] = ['doctor', 'test', 'launch', 'status', 'install'];
const ULTRACODE_VERBS_TEXT = ULTRACODE_VERBS.join(', ');
const BOARD_VERBS = ['init', 'agents', 'poll', 'channels', 'tree', 'mentions'] as const;
type BoardVerb = (typeof BOARD_VERBS)[number];
const DEFAULT_BOARD_VERB: BoardVerb = 'agents';
const CONTEXT_ACTIONS = ['list', 'get', 'set', 'clear', 'snapshot'] as const;
type ContextAction = (typeof CONTEXT_ACTIONS)[number];
const CONTEXT_ACTIONS_TEXT = CONTEXT_ACTIONS.join(', ');
const DEFAULT_CONTEXT_ACTION: ContextAction = 'list';
/** Script-backed `/swarm <form> <task>` tokens, including new first-class forms. */
const FORM_TASK_PATTERNS: readonly string[] = [
  'hive',
  'graph',
  'designer',
  'metaloop',
  'ultraswarm',
  'board',
  'context',
];
const DEFAULT_FORM_TASK = 'Execute collaborative swarm analysis and solution';
const DEFAULT_DASHBOARD_PORT = 8765;
const DETECT_TIMEOUT_MS = 30000;
const ULTRACODE_VERB_TIMEOUT_MS = 60000;
const ULTRACODE_CHECK_TIMEOUT_MS = 120000;
const CHILDREN_PER_CAPTAIN_MAX = 32;

function missingFusionScriptsError(): string {
  return 'Fusion scripts not found. Install the Fusion plugin or set FUSION_PLUGIN_ROOT to its root directory.';
}

function firstLines(text: string, maxLines: number): string {
  return text
    .split('\n')
    .slice(0, maxLines)
    .map((line) => line.trimEnd())
    .join('\n');
}

type DashboardSubcommand = { kind: 'run'; port: number | undefined } | { kind: 'error'; message: string };

function parseDashboardSubcommand(prompt: string): DashboardSubcommand | undefined {
  const match = prompt.match(/^dashboard(?:\s+(.*))?$/i);
  if (match === null) return undefined;
  const rest = (match[1] ?? '').trim();
  if (rest.length === 0) return { kind: 'run', port: undefined };
  if (rest.toLowerCase().startsWith('--port')) {
    const portMatch = rest.match(/^--port(?:\s+(\d+))?$/i);
    if (portMatch === null || portMatch[1] === undefined) {
      return { kind: 'error', message: '--port expects a port number, e.g. /swarm dashboard --port 8765.' };
    }
    const port = Number(portMatch[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { kind: 'error', message: `Invalid port '${portMatch[1]}'. Use a number between 1 and 65535.` };
    }
    return { kind: 'run', port };
  }
  // Task-like trailing text — leave it to the plain task fallthrough.
  return undefined;
}

async function handleSwarmDashboard(
  host: SlashCommandHost,
  explicitPort: number | undefined,
): Promise<void> {
  const scriptsRoot = resolveFusionScriptsRoot();
  if (scriptsRoot === undefined) {
    host.showError(missingFusionScriptsError());
    return;
  }
  const envPort = Number(process.env['FUSION_DASHBOARD_PORT']);
  const port =
    explicitPort ?? (Number.isInteger(envPort) && envPort > 0 ? envPort : DEFAULT_DASHBOARD_PORT);
  const url = await openFusionDashboard(port);
  if (url !== undefined) {
    host.showStatus(`Fusion dashboard: ${url}`);
    return;
  }
  host.showStatus(
    `Fusion dashboard starting at http://127.0.0.1:${port}/ — open it manually in your browser if it does not appear.`,
  );
}

async function handleSwarmDetect(host: SlashCommandHost): Promise<void> {
  const scriptsRoot = resolveFusionScriptsRoot();
  if (scriptsRoot === undefined) {
    host.showError(missingFusionScriptsError());
    return;
  }
  let result;
  try {
    result = await runFusionScript(join(scriptsRoot, 'fusion.sh'), ['detect', '--json'], {
      cwd: scriptsRoot,
      timeoutMs: DETECT_TIMEOUT_MS,
    });
  } catch (error) {
    host.showError(`Failed to run Fusion detect: ${formatErrorMessage(error)}`);
    return;
  }
  if (result.exitCode !== 0) {
    const detail = firstLines(result.stderr || result.stdout, 3);
    host.showError(`Fusion detect failed${detail.length > 0 ? `: ${detail}` : ''}.`);
    return;
  }
  let summary: string;
  try {
    summary = formatDetectSummary(scriptsRoot, result.stdout);
  } catch {
    host.showError('Fusion detect produced unexpected output.');
    return;
  }
  host.showStatus(summary);
}

function formatDetectSummary(scriptsRoot: string, stdout: string): string {
  const data = JSON.parse(stdout) as {
    providers?: Record<string, string>;
    metaloop?: Record<string, string>;
  };
  const lines: string[] = [];
  if (data.providers !== undefined && typeof data.providers === 'object') {
    for (const [id, status] of Object.entries(data.providers)) {
      lines.push(`${id}: ${typeof status === 'string' ? status : 'unknown'}`);
    }
  }
  if (data.metaloop !== undefined && typeof data.metaloop === 'object') {
    const entries = Object.entries(data.metaloop)
      .filter((entry) => typeof entry[1] === 'string')
      .map(([id, status]) => `${id}: ${status}`);
    if (entries.length > 0) lines.push(`metaloop — ${entries.join(', ')}`);
  }
  if (lines.length === 0) throw new Error('no providers in detect output');
  return `Fusion detect (scripts: ${scriptsRoot})\n${lines.join('\n')}`;
}

type UltracodeSubcommand = { kind: 'run'; verb: UltracodeVerb } | { kind: 'error'; message: string };

type CommsSubcommand = { kind: 'run' } | { kind: 'error'; message: string };

function parseCommsSubcommand(prompt: string): CommsSubcommand | undefined {
  const match = prompt.match(/^comms(?:\s+(.*))?$/i);
  if (match === null) return undefined;
  const rest = (match[1] ?? '').trim();
  if (rest.length > 0) {
    return { kind: 'error', message: '/swarm comms does not accept extra arguments.' };
  }
  return { kind: 'run' };
}

function showSwarmCommsDialog(host: SlashCommandHost): void {
  const cwd = host.state.appState.workDir?.trim();
  host.mountEditorReplacement(
    new SwarmBoardDialogComponent({
      cwd: cwd !== undefined && cwd.length > 0 ? cwd : undefined,
      onCancel: () => {
        host.restoreEditor();
        host.showStatus('Agent communications board closed.');
      },
    }),
  );
}

function parseUltracodeSubcommand(prompt: string): UltracodeSubcommand | undefined {
  const match = prompt.match(/^ultracode(?:\s+(.*))?$/i);
  if (match === null) return undefined;
  const rest = (match[1] ?? '').trim();
  const verbMatch = rest.match(/^(\S+)(?:\s+(.*))?$/);
  const verb = verbMatch?.[1];
  if (verb === undefined || verb.length === 0) {
    return { kind: 'error', message: `UltraCode expects a verb: ${ULTRACODE_VERBS_TEXT}.` };
  }
  if (!(ULTRACODE_VERBS as readonly string[]).includes(verb)) {
    return { kind: 'error', message: `Unknown UltraCode verb '${verb}'. Expected one of: ${ULTRACODE_VERBS_TEXT}.` };
  }
  const extra = verbMatch?.[2] ?? '';
  if (extra.trim().length > 0) {
    return { kind: 'error', message: `UltraCode ${verb} does not accept extra arguments.` };
  }
  return { kind: 'run', verb: verb as UltracodeVerb };
}

async function handleSwarmUltracode(host: SlashCommandHost, verb: UltracodeVerb): Promise<void> {
  const scriptsRoot = resolveFusionScriptsRoot();
  if (scriptsRoot === undefined) {
    host.showError(missingFusionScriptsError());
    return;
  }
  const timeoutMs = verb === 'doctor' || verb === 'test' ? ULTRACODE_CHECK_TIMEOUT_MS : ULTRACODE_VERB_TIMEOUT_MS;
  let result;
  try {
    result = await runFusionScript(join(scriptsRoot, 'ultracode.sh'), [verb], {
      cwd: scriptsRoot,
      timeoutMs,
    });
  } catch (error) {
    host.showError(`Failed to run UltraCode ${verb}: ${formatErrorMessage(error)}`);
    return;
  }
  if (result.exitCode !== 0) {
    const detail = firstLines(result.stderr || result.stdout, 3);
    host.showError(`UltraCode ${verb} failed${detail.length > 0 ? `: ${detail}` : ''}.`);
    return;
  }
  const output = firstLines(result.stdout.trim(), 20);
  host.showStatus(output.length > 0 ? output : `UltraCode ${verb} completed.`);
}

// ---------------------------------------------------------------------------
// Script-form swarm tasks
// ---------------------------------------------------------------------------

/** Script-form extras from the shared SwarmFormOptions contract, plus the
 * board/context/thinking fields that form tasks persist alongside captains. */
type FormTaskOptions = Partial<SwarmFormOptions> & {
  thinkingEffort?: string;
  boardVerb?: BoardVerb;
  boardDb?: string;
  contextAction?: ContextAction;
  contextKey?: string;
  contextValue?: string;
};

type FormTaskCommand =
  | {
      kind: 'run';
      pattern: SwarmPattern;
      task: string;
      options: FormTaskOptions;
    }
  | { kind: 'error'; message: string };

function parseFormTaskCommand(prompt: string): FormTaskCommand | undefined {
  const match = prompt.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (match === null) return undefined;
  const token = match[1]!.toLowerCase();
  const rest = match[2] ?? '';
  if (token === 'council') {
    return { kind: 'run', pattern: 'council', task: rest.trim(), options: {} };
  }
  if (token === 'board') return parseBoardForm(rest);
  if (token === 'context') return parseContextForm(rest);
  if (!FORM_TASK_PATTERNS.includes(token)) return undefined;
  const parsed = parseFormFlags(rest);
  if (parsed.kind === 'error') return { kind: 'error', message: parsed.message };
  return { kind: 'run', pattern: token as SwarmPattern, task: parsed.task, options: parsed.options };
}

function parseBoardForm(input: string): FormTaskCommand {
  const parsed = parseFormFlags(input, true);
  if (parsed.kind === 'error') return { kind: 'error', message: parsed.message };
  const options: FormTaskOptions = { ...parsed.options };
  const match = parsed.task.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (match !== null && (BOARD_VERBS as readonly string[]).includes(match[1]!.toLowerCase())) {
    options.boardVerb = match[1]!.toLowerCase() as BoardVerb;
    return { kind: 'run', pattern: 'board' as SwarmPattern, task: (match[2] ?? '').trim(), options };
  }
  options.boardVerb = DEFAULT_BOARD_VERB;
  return { kind: 'run', pattern: 'board' as SwarmPattern, task: parsed.task, options };
}

function parseContextForm(input: string): FormTaskCommand {
  const parsed = parseFormFlags(input);
  if (parsed.kind === 'error') return { kind: 'error', message: parsed.message };
  const options: FormTaskOptions = { ...parsed.options };
  const match = parsed.task.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (match === null) {
    options.contextAction = DEFAULT_CONTEXT_ACTION;
    return { kind: 'run', pattern: 'context' as SwarmPattern, task: '', options };
  }
  const actionToken = match[1]!;
  const action = actionToken.toLowerCase();
  if (!(CONTEXT_ACTIONS as readonly string[]).includes(action)) {
    return {
      kind: 'error',
      message: `Unknown context action '${actionToken}'. Expected one of: ${CONTEXT_ACTIONS_TEXT}.`,
    };
  }
  options.contextAction = action as ContextAction;
  const rest = (match[2] ?? '').trim();
  if (action === 'get') {
    if (rest.length === 0) {
      return { kind: 'error', message: 'context get expects a key, e.g. /swarm context get <key>.' };
    }
    options.contextKey = rest.split(/\s+/, 1)[0];
    return { kind: 'run', pattern: 'context' as SwarmPattern, task: rest, options };
  }
  if (action === 'set') {
    const keyMatch = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    if (keyMatch === null) {
      return {
        kind: 'error',
        message: 'context set expects a key and value, e.g. /swarm context set <key> <value>.',
      };
    }
    const value = (keyMatch[2] ?? '').trim();
    if (value.length === 0) {
      return {
        kind: 'error',
        message: 'context set expects a value, e.g. /swarm context set <key> <value>.',
      };
    }
    options.contextKey = keyMatch[1];
    options.contextValue = value;
    return { kind: 'run', pattern: 'context' as SwarmPattern, task: rest, options };
  }
  if (action === 'clear' && rest.length > 0) {
    options.contextKey = rest.split(/\s+/, 1)[0];
  }
  return { kind: 'run', pattern: 'context' as SwarmPattern, task: rest, options };
}

/** Leading flags of a script-form task: --dry-run, --captains a,b,
 * --children-per-captain N, --thinking-effort LEVEL, and (board only) --db PATH.
 * Everything after the flags is the task text. */
function parseFormFlags(
  input: string,
  allowDb = false,
): { kind: 'ok'; task: string; options: FormTaskOptions } | { kind: 'error'; message: string } {
  const options: FormTaskOptions = {};
  let rest = input;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, '');
    const dryRun = trimmed.match(/^--dry-run(?=\s|$)/);
    if (dryRun !== null) {
      options.dryRun = true;
      rest = trimmed.slice(dryRun[0].length);
      continue;
    }
    const captains = trimmed.match(/^--captains\s+(\S+)(?=\s|$)/);
    if (captains !== null) {
      const value = captains[1]!;
      if (value.startsWith('--')) {
        return { kind: 'error', message: '--captains expects a comma-separated provider list, e.g. --captains codex,grok.' };
      }
      const ids = value.split(',').map((entry) => entry.trim());
      for (const id of ids) {
        if (!FUSION_PROVIDERS.some((provider) => provider.id === id)) {
          return {
            kind: 'error',
            message:
              `Unknown captain '${id}' in --captains. ` +
              `Known providers: ${FUSION_PROVIDERS.map((provider) => provider.id).join(', ')}.`,
          };
        }
      }
      options.captains = ids as FusionProviderId[];
      rest = trimmed.slice(captains[0].length);
      continue;
    }
    const children = trimmed.match(/^--children-per-captain\s+(\S+)(?=\s|$)/);
    if (children !== null) {
      const value = children[1]!;
      const count = Number(value);
      if (value.startsWith('--') || !Number.isInteger(count) || count < 1 || count > CHILDREN_PER_CAPTAIN_MAX) {
        return {
          kind: 'error',
          message: `--children-per-captain expects an integer between 1 and ${CHILDREN_PER_CAPTAIN_MAX}.`,
        };
      }
      options.childrenPerCaptain = count;
      rest = trimmed.slice(children[0].length);
      continue;
    }
    const thinking = trimmed.match(/^--thinking-effort\s+(\S+)(?=\s|$)/);
    if (thinking !== null) {
      const value = thinking[1]!;
      if (value.startsWith('--')) {
        return {
          kind: 'error',
          message: '--thinking-effort expects a value, e.g. --thinking-effort high.',
        };
      }
      options.thinkingEffort = value;
      rest = trimmed.slice(thinking[0].length);
      continue;
    }
    if (allowDb) {
      const db = trimmed.match(/^--db\s+(\S+)(?=\s|$)/);
      if (db !== null) {
        const value = db[1]!;
        if (value.startsWith('--')) {
          return { kind: 'error', message: '--db expects a path, e.g. --db /tmp/hive.sqlite.' };
        }
        options.boardDb = value;
        rest = trimmed.slice(db[0].length);
        continue;
      }
    }
    if (trimmed.startsWith('--')) {
      return { kind: 'error', message: `Unknown or incomplete swarm flag: ${trimmed.split(/\s+/)[0]}.` };
    }
    break;
  }
  return { kind: 'ok', task: rest.trim(), options };
}

async function startFormSwarmTask(
  host: SlashCommandHost,
  pattern: SwarmPattern,
  task: string,
  options: FormTaskOptions,
  commandText: string,
): Promise<void> {
  const state = loadLastSwarmSelection();
  state.pattern = pattern;
  state.formOptions = { ...state.formOptions, ...options };
  state.task = task.length > 0 ? task : DEFAULT_FORM_TASK;
  saveSwarmSelection(state);
  const fullPrompt = `${formatSwarmBrief(state)}\n\nTask: ${state.task}`;
  if (host.state.appState.permissionMode === 'manual') {
    showSwarmStartPermissionPrompt(host, commandText, 'Swarm task not started.', (choice) =>
      startSwarmWithPermission(host, fullPrompt, choice),
    );
    return;
  }
  await startSwarmTask(host, fullPrompt);
}
