import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'pathe';

import type { AutocompleteItem } from '@moonshot-ai/pi-tui';

import { completeLeadingArg, type ArgCompletionSpec } from './complete-args';
import type { KimiSlashCommand, SlashCommandAvailability } from './types';

/** Subcommands offered when autocompleting `/goal <…>`. */
const GOAL_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'status', description: 'Show the current goal' },
  { value: 'pause', description: 'Pause the active goal' },
  { value: 'resume', description: 'Resume a paused goal' },
  { value: 'cancel', description: 'Cancel and remove the current goal' },
  { value: 'replace', description: 'Replace the current goal with a new objective' },
  { value: 'next', description: 'Queue an upcoming goal' },
];

const GOAL_NEXT_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'manage', description: 'Manage upcoming goals' },
];

const FUSION_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Enable native Fusion (genius-boss default)' },
  { value: 'dual', description: 'Enable native dual-lead Fusion (genius-boss default)' },
  { value: 'off', description: 'Disable native Fusion and swarm mode' },
  { value: 'status', description: 'Show native Fusion status' },
  { value: 'genius-boss', description: 'Astra CEO / Opus 5.5 COO; Opus designs, implements and reviews' },
  { value: 'idiot-boss', description: 'Luna coordinator, persistent Opus 5.5 implementation, Astra review on demand' },
];

const FUSION_STRATEGY_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'dual', description: 'Enable dual-lead mode with this strategy' },
];

const SWARM_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'fusion', description: 'Start or control the native Fusion team' },
  { value: 'custom', description: 'Configure custom multi-model multi-provider agent swarm (Fusion)' },
  { value: 'select', description: 'Select models per provider and swarm pattern' },
  { value: 'on', description: 'Turn swarm mode on' },
  { value: 'off', description: 'Turn swarm mode off' },
  { value: 'hive', description: 'Nested hive swarm with captains and workers' },
  { value: 'graph', description: 'Task-graph DAG swarm' },
  { value: 'designer', description: 'Design a custom SwarmSpec from the live roster' },
  { value: 'metaloop', description: 'MetaLoop strategic planner + operator + workers' },
  { value: 'ultraswarm', description: 'Five-agent UltraSwarm council' },
  { value: 'board', description: 'Inspect or post on the Hive Board' },
  { value: 'context', description: 'Get, set, list, clear, or snapshot agency context' },
  { value: 'council', description: 'Consensus council swarm task' },
  { value: 'dashboard', description: 'Open the localhost Fusion dashboard' },
  { value: 'detect', description: 'Report which Fusion CLI panelists are installed' },
  { value: 'ultracode', description: 'Run a local UltraCode verb (doctor, test, launch, status, install)' },
  { value: 'comms', description: 'Open the local agent communications board' },
];

const ULTRACODE_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'doctor', description: 'Run UltraCode doctor' },
  { value: 'test', description: 'Run UltraCode tests' },
  { value: 'launch', description: 'Launch UltraCode' },
  { value: 'status', description: 'Show UltraCode status' },
  { value: 'install', description: 'Install UltraCode' },
];

const BOARD_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'init', description: 'Initialize the Hive Board' },
  { value: 'agents', description: 'List board agents (default)' },
  { value: 'poll', description: 'Poll the board for new messages' },
  { value: 'channels', description: 'List board channels' },
  { value: 'tree', description: 'Show the board tree' },
  { value: 'mentions', description: 'List board mentions' },
];

const CONTEXT_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'List agency-context keys (default)' },
  { value: 'get', description: 'Get an agency-context value' },
  { value: 'set', description: 'Set an agency-context key' },
  { value: 'clear', description: 'Clear agency context' },
  { value: 'snapshot', description: 'Snapshot agency context' },
];

const DASHBOARD_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: '--port', description: 'Bind the dashboard to an explicit port' },
];

const ADD_DIR_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'Show configured additional workspace directories' },
];

const LOGIN_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'andrewcode', description: 'Kimi Code membership OAuth (default)' },
  { value: 'kimi-code', description: 'Kimi Code membership OAuth' },
  { value: 'codex', description: 'ChatGPT Codex native OAuth' },
  { value: 'xai', description: 'xAI Grok API key' },
  { value: 'claude', description: 'Claude Code OAuth via claude CLI' },
  { value: 'perplexity', description: 'Perplexity session login via pwm sidecar' },
];

/** Argument autocompletion for the `/goal` command (subcommands). */
export function goalArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const nextMatch = argumentPrefix.match(/^next\s+(\S*)$/i);
  if (nextMatch !== null) {
    return (
      completeLeadingArg(GOAL_NEXT_ARG_COMPLETIONS, nextMatch[1] ?? '')?.map((item) => ({
        ...item,
        value: `next ${item.value}`,
      })) ?? null
    );
  }
  return completeLeadingArg(GOAL_ARG_COMPLETIONS, argumentPrefix);
}

function prefixNestedCompletions(
  prefix: string,
  rest: string,
  specs: readonly ArgCompletionSpec[],
): AutocompleteItem[] | null {
  return (
    completeLeadingArg(specs, rest)?.map((item) => ({
      ...item,
      value: `${prefix} ${item.value}`,
    })) ?? null
  );
}

/** Argument autocompletion for the `/swarm` command (subcommands). */
export function swarmArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const strategyMatch = argumentPrefix.match(/^fusion\s+(genius-boss|idiot-boss)\s+(\S*)$/i);
  if (strategyMatch !== null) {
    return prefixNestedCompletions(
      `fusion ${strategyMatch[1]!.toLowerCase()}`,
      strategyMatch[2] ?? '',
      FUSION_STRATEGY_ARG_COMPLETIONS,
    );
  }
  const fusionMatch = argumentPrefix.match(/^fusion\s+(\S*)$/i);
  if (fusionMatch !== null) {
    return prefixNestedCompletions('fusion', fusionMatch[1] ?? '', FUSION_ARG_COMPLETIONS);
  }
  const ultracodeMatch = argumentPrefix.match(/^ultracode\s+(\S*)$/i);
  if (ultracodeMatch !== null) {
    return prefixNestedCompletions('ultracode', ultracodeMatch[1] ?? '', ULTRACODE_ARG_COMPLETIONS);
  }
  const boardMatch = argumentPrefix.match(/^board\s+(\S*)$/i);
  if (boardMatch !== null) {
    return prefixNestedCompletions('board', boardMatch[1] ?? '', BOARD_ARG_COMPLETIONS);
  }
  const contextMatch = argumentPrefix.match(/^context\s+(\S*)$/i);
  if (contextMatch !== null) {
    return prefixNestedCompletions('context', contextMatch[1] ?? '', CONTEXT_ARG_COMPLETIONS);
  }
  const dashboardMatch = argumentPrefix.match(/^dashboard\s+(\S*)$/i);
  if (dashboardMatch !== null) {
    return prefixNestedCompletions('dashboard', dashboardMatch[1] ?? '', DASHBOARD_ARG_COMPLETIONS);
  }
  return completeLeadingArg(SWARM_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/add-dir` command. */
export function addDirArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  if (isPathLikeAddDirArgument(argumentPrefix)) {
    return completeAddDirPath(argumentPrefix);
  }
  return completeLeadingArg(ADD_DIR_ARG_COMPLETIONS, argumentPrefix);
}

export function loginArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(LOGIN_ARG_COMPLETIONS, argumentPrefix);
}

function isPathLikeAddDirArgument(argumentPrefix: string): boolean {
  return argumentPrefix === '.' || argumentPrefix === '..' || argumentPrefix.startsWith('./') || argumentPrefix.startsWith('../') || argumentPrefix.startsWith('/') || argumentPrefix.startsWith('~');
}

function completeAddDirPath(argumentPrefix: string): AutocompleteItem[] | null {
  const normalizedPrefix = argumentPrefix === '~' ? '~/' : argumentPrefix;
  const expandedPrefix = expandHomePrefix(normalizedPrefix);
  const parentInput = getDirectoryCompletionParentInput(normalizedPrefix, expandedPrefix);
  const partialName = normalizedPrefix.endsWith('/') ? '' : basename(expandedPrefix);
  const parentDir = resolveDirectoryCompletionParent(parentInput);
  let entries;
  try {
    entries = readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const items: AutocompleteItem[] = [];
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..' || entry.name.startsWith('.')) continue;
    if (partialName.length > 0 && !entry.name.toLowerCase().startsWith(partialName.toLowerCase())) continue;
    const absolutePath = join(parentDir, entry.name);
    if (!isDirectoryPath(absolutePath, entry.isDirectory(), entry.isSymbolicLink())) continue;
    const value = formatDirectoryCompletionValue(normalizedPrefix, parentInput, entry.name);
    items.push({
      value,
      label: `${entry.name}/`,
      description: absolutePath,
    });
  }

  return items.length > 0 ? items : null;
}

function expandHomePrefix(argumentPrefix: string): string {
  if (argumentPrefix === '~') return homedir();
  if (argumentPrefix.startsWith('~/')) return join(homedir(), argumentPrefix.slice(2));
  return argumentPrefix;
}

function getDirectoryCompletionParentInput(argumentPrefix: string, expandedPrefix: string): string {
  if (argumentPrefix === '/') return '/';
  if (argumentPrefix === '~/') return homedir();
  if (argumentPrefix.endsWith('/')) return expandedPrefix.slice(0, -1);
  return dirname(expandedPrefix);
}

function resolveDirectoryCompletionParent(parentInput: string): string {
  if (parentInput === '~') return homedir();
  if (parentInput.startsWith('~/')) return join(homedir(), parentInput.slice(2));
  return resolve(parentInput);
}

function isDirectoryPath(path: string, isDirectory: boolean, isSymlink: boolean): boolean {
  if (isDirectory) return true;
  if (!isSymlink) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function formatDirectoryCompletionValue(argumentPrefix: string, parentInput: string, entryName: string): string {
  if (argumentPrefix.startsWith('~/')) {
    const home = homedir();
    const homeRelative = relative(home, parentInput);
    return `~${homeRelative.length > 0 ? `/${homeRelative}` : ''}/${entryName}/`;
  }
  if (argumentPrefix.startsWith('/')) {
    return `${join(parentInput, entryName)}/`;
  }
  return `${join(parentInput, entryName)}/`;
}

export const BUILTIN_SLASH_COMMANDS = [
  {
    name: 'yolo',
    aliases: ['yes'],
    description: 'Toggle YOLO mode: auto-approve tool actions, but the agent may still ask questions.',
    priority: 101,
    availability: 'always',
  },
  {
    name: 'auto',
    aliases: [],
    description: 'Toggle Auto mode: fully autonomous, agent decides everything without asking.',
    priority: 99,
    availability: 'always',
  },
  {
    name: 'permission',
    aliases: [],
    description: 'Select permission mode',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'settings',
    aliases: ['config'],
    description: 'Open TUI settings',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'plan',
    aliases: [],
    description: 'Toggle plan mode',
    priority: 100,
    availability: (args) => (args.trim().toLowerCase() === 'clear' ? 'idle-only' : 'always'),
  },
  {
    name: 'swarm',
    aliases: [],
    description: 'Configure a swarm, choose a native Fusion boss strategy, or run a swarm task',
    priority: 100,
    argumentHint:
      '[on|off|custom|select] | fusion [...] | hive|graph|designer|metaloop|ultraswarm|board|context|council [task] | dashboard|detect|ultracode <verb> | comms | <task>',
    completeArgs: swarmArgumentCompletions,
    availability: 'idle-only',
  },
  {
    name: 'model',
    aliases: [],
    description: 'Switch LLM model',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'secondary_model',
    aliases: [],
    description: 'Configure the secondary model for subagents',
    priority: 90,
    availability: 'always',
    experimentalFlag: 'secondary-model',
  },
  {
    name: 'effort',
    aliases: ['thinking'],
    description: 'Switch thinking effort',
    priority: 95,
    availability: 'always',
  },
  {
    name: 'provider',
    aliases: ['providers'],
    description: 'Manage AI providers (add / delete / refresh)',
    priority: 95,
    availability: 'always',
  },
  {
    name: 'btw',
    aliases: [],
    description: 'Ask a forked side agent a question',
    priority: 90,
    availability: 'always',
  },
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands and shortcuts',
    priority: 80,
    availability: 'always',
  },
  {
    name: 'new',
    aliases: ['clear'],
    description: 'Start a fresh session in the current workspace',
    priority: 80,
  },
  {
    name: 'sessions',
    aliases: ['resume'],
    description: 'Browse and resume sessions',
    priority: 80,
  },
  {
    name: 'tasks',
    aliases: ['task'],
    description: 'Browse background tasks',
    priority: 80,
    availability: 'always',
  },
  {
    name: 'mcp',
    aliases: [],
    description: 'Manage MCP servers',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'plugins',
    aliases: [],
    description: 'Manage plugins',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'add-dir',
    aliases: [],
    description: 'Add or list an additional workspace directory',
    priority: 60,
    availability: 'idle-only',
    argumentHint: '[list] | <path>',
    completeArgs: addDirArgumentCompletions,
  },
  {
    name: 'experiments',
    aliases: ['experimental'],
    description: 'Manage experimental features',
    priority: 60,
    availability: 'idle-only',
  },
  {
    name: 'reload',
    aliases: [],
    description: 'Reload session and apply config.toml settings plus tui.toml UI preferences',
    priority: 60,
    availability: 'idle-only',
  },
  {
    name: 'reload-tui',
    aliases: [],
    description: 'Reload only tui.toml UI preferences',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'compact',
    aliases: [],
    description: 'Compact the conversation context',
    priority: 80,
    argumentHint: '<instruction>',
  },
  {
    name: 'goal',
    aliases: [],
    description: 'Start or manage an autonomous goal',
    priority: 80,
    argumentHint: '[status|pause|resume|cancel|replace|next] | <objective>',
    completeArgs: goalArgumentCompletions,
    // status / pause / cancel are always available; creation, replacement, and
    // resume start (or restart) a turn and so are idle-only.
    availability: (args) => {
      const trimmed = args.trim();
      if (trimmed === 'next' || trimmed.startsWith('next ')) return 'always';
      return trimmed === '' || trimmed === 'status' || trimmed === 'pause' || trimmed === 'cancel'
        ? 'always'
        : 'idle-only';
    },
  },
  {
    name: 'init',
    aliases: [],
    description: 'Analyze the codebase and generate AGENTS.md',
  },
  {
    name: 'fork',
    aliases: [],
    description: 'Fork the current session into a copy without switching to it',
    priority: 80,
  },
  {
    name: 'title',
    aliases: ['rename'],
    description: 'Set or show session title',
    priority: 60,
    argumentHint: '<title>',
    availability: 'always',
  },
  {
    name: 'usage',
    aliases: [],
    description: 'Show session tokens + context window + plan quotas',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'status',
    aliases: [],
    description: 'Show current session and runtime status',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'feedback',
    aliases: ['bug'],
    description: 'Send feedback to make AndrewCode better',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'undo',
    aliases: [],
    description: 'Withdraw the last prompt from the transcript',
    priority: 80,
    availability: 'idle-only',
  },
  {
    name: 'editor',
    aliases: [],
    description: 'Set the external editor for Ctrl-G',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'theme',
    aliases: [],
    description: 'Set the terminal UI theme',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'logout',
    aliases: ['disconnect'],
    description: 'Log out of a configured provider',
    priority: 40,
  },
  {
    name: 'login',
    aliases: [],
    description: 'Authenticate: AndrewCode/Kimi, Claude Code, Codex, or Perplexity — /login [andrewcode|claude|codex|perplexity]',
    priority: 40,
    argumentHint: '[andrewcode|claude|codex|perplexity]',
    completeArgs: loginArgumentCompletions,
  },
  {
    name: 'export-md',
    aliases: ['export'],
    description: 'Export current session as a Markdown file',
    priority: 40,
  },
  {
    name: 'export-debug-zip',
    aliases: [],
    description: 'Export current session as a debug ZIP archive',
    priority: 40,
  },
  {
    name: 'copy',
    aliases: [],
    description: 'Copy the last assistant message to the clipboard',
    priority: 40,
  },
  {
    name: 'web',
    aliases: [],
    description: 'Open the current session in the Web UI by starting a new server',
    priority: 40,
    availability: 'always',
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit the application',
    priority: 20,
  },
  {
    name: 'version',
    aliases: [],
    description: 'Show version information',
    priority: 20,
    availability: 'always',
  },
] as const satisfies readonly KimiSlashCommand[];

export type BuiltinSlashCommand = (typeof BUILTIN_SLASH_COMMANDS)[number];
export type BuiltinSlashCommandName = BuiltinSlashCommand['name'];

export function findBuiltInSlashCommand(commandName: string): BuiltinSlashCommand | undefined {
  const commands = BUILTIN_SLASH_COMMANDS as readonly KimiSlashCommand<BuiltinSlashCommandName>[];
  return commands.find(
    (command) => command.name === commandName || command.aliases.includes(commandName),
  ) as BuiltinSlashCommand | undefined;
}

export function resolveSlashCommandAvailability(
  command: KimiSlashCommand,
  args: string,
): SlashCommandAvailability {
  const availability = command.availability ?? 'idle-only';
  return typeof availability === 'function' ? availability(args) : availability;
}

export function sortSlashCommands(commands: readonly KimiSlashCommand[]): KimiSlashCommand[] {
  return [...commands].toSorted(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
  );
}
