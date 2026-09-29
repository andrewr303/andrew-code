/**
 * Fusion Multi-Model Multi-Provider Agent Swarm Utilities.
 *
 * Integrates with the Fusion plugin at ~/.claude/plugins/fusion (or configured location)
 * allowing users to select multiple models across multiple providers (Claude, Codex,
 * Copilot, Grok, OpenCode, Kimi/AndrewCode, Antigravity) and launch custom swarms.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type FusionProviderId =
  | 'codex'
  | 'claude'
  | 'copilot'
  | 'grok'
  | 'opencode'
  | 'kimi'
  | 'agy';

export type SwarmPattern =
  | 'moa'
  | 'heavy'
  | 'discuss'
  | 'hierarchy'
  | 'breaker'
  | 'council'
  | 'flow'
  | 'fusion'
  | 'fusion-idiot-boss'
  | 'graph'
  | 'hive'
  | 'designer'
  | 'metaloop'
  | 'ultracode'
  | 'ultraswarm'
  | 'board'
  | 'context';

export function nativeFusionStrategy(
  pattern: SwarmPattern,
): 'genius-boss' | 'idiot-boss' | undefined {
  if (pattern === 'fusion') return 'genius-boss';
  if (pattern === 'fusion-idiot-boss') return 'idiot-boss';
  return undefined;
}

export interface ProviderModelConfig {
  readonly id: FusionProviderId;
  readonly label: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly description: string;
}

export const FUSION_PROVIDERS: readonly ProviderModelConfig[] = [
  {
    id: 'codex',
    label: 'Codex (OpenAI)',
    defaultModel: 'gpt-5.6-sol',
    models: [
      'gpt-5.6-sol',
      'gpt-5.5',
      'o3-mini',
      'o1',
      'gpt-4o',
      'gpt-4.5-preview',
    ],
    description: 'Lead orchestrator, precision coding, critical path implementation',
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    defaultModel: 'claude-3-7-sonnet',
    models: [
      'claude-3-7-sonnet',
      'claude-3-5-sonnet',
      'claude-3-5-haiku',
      'claude-opus-4-8',
      'claude-fable-5',
    ],
    description: 'Deep reasoning, architecture design, holistic evaluation',
  },
  {
    id: 'grok',
    label: 'Grok (xAI)',
    defaultModel: 'grok-4.5',
    models: [
      'grok-4.5',
      'grok-3',
      'grok-beta',
      'grok-2',
    ],
    description: 'Adversarial edge cases, novel diagnosis, realtime facts',
  },
  {
    id: 'copilot',
    label: 'Copilot (GitHub / Google)',
    defaultModel: 'gemini-3.5-flash',
    models: [
      'gemini-3.5-flash',
      'gemini-2.5-pro',
      'gpt-4o',
      'claude-3.5-sonnet',
    ],
    description: 'Breadth, long-context analysis, synthesis',
  },
  {
    id: 'opencode',
    label: 'OpenCode (GLM / DeepSeek)',
    defaultModel: 'opencode-go/glm-5.2',
    models: [
      'opencode-go/glm-5.2',
      'opencode-go/deepseek-v4-pro',
      'opencode-go/deepseek-v4-flash',
      'opencode-go/kimi-k2.6',
      'opencode-go/minimax-m3',
    ],
    description: 'High-volume draft generation, complex refactorings, boilerplate',
  },
  {
    id: 'kimi',
    label: 'AndrewCode / Kimi (Moonshot)',
    defaultModel: 'kimi-k2.6',
    models: [
      'kimi-k2.6',
      'kimi-k2-chat',
      'kimi-k2.5',
      'moonshot-v1-auto',
    ],
    description: 'Local workspace context, frontend/UI, fast iteration',
  },
  {
    id: 'agy',
    label: 'Antigravity (Google)',
    defaultModel: 'Gemini 3.5 Flash (High)',
    models: [
      'Gemini 3.5 Flash (High)',
      'Gemini 3.1 Pro (High)',
      'Gemini 3.0 Flash',
    ],
    description: 'Fast mechanical edits, scaffolding, batch processing',
  },
];

export interface SwarmPatternOption {
  readonly id: SwarmPattern;
  readonly label: string;
  readonly badge: string;
  readonly description: string;
  /**
   * Where the pattern is executed: `panel` (multi-provider prompt swarm),
   * `script` (local Fusion plugin script bridge — graph/hive/designer/
   * metaloop/ultracode/ultraswarm/board/context), or `native` (engine-owned Fusion team).
   */
  readonly form?: 'panel' | 'script' | 'native';
}

export const SWARM_PATTERNS: readonly SwarmPatternOption[] = [
  {
    id: 'moa',
    label: 'UltraSwarm / Mixture-of-Agents (MoA)',
    badge: 'Layered',
    description: 'Multi-layer swarm where panelists produce drafts and synthesize outputs into a unified solution.',
  },
  {
    id: 'heavy',
    label: 'Deep 4-Role Council Swarm',
    badge: '4-Role',
    description: 'Specialized 4-role swarm: Architect, Critic, Implementer, and Tester across selected providers.',
  },
  {
    id: 'discuss',
    label: 'Roundtable Discussion & Debate',
    badge: 'Debate',
    description: 'Multi-round collaborative discussion between models to debate trade-offs and reach consensus.',
  },
  {
    id: 'hierarchy',
    label: 'Hierarchical Director & Workers',
    badge: 'Director',
    description: 'Director agent analyzes the problem, decomposes it into subtasks, and delegates to workers.',
  },
  {
    id: 'breaker',
    label: 'Builder vs Breaker (Adversarial)',
    badge: 'Red Team',
    description: 'Builder designs the solution while Breaker relentlessly hunts bugs and edge cases.',
  },
  {
    id: 'council',
    label: 'Consensus Council & Ballot',
    badge: 'Voting',
    description: 'Independent voting and confidence scoring across diverse model families.',
  },
  {
    id: 'flow',
    label: 'Pipeline Flow (DAG)',
    badge: 'Pipeline',
    description: 'Sequential pipeline passing structured outputs through each selected model stage.',
  },
  {
    id: 'fusion',
    label: 'Native Fusion team — genius boss',
    badge: 'Native',
    description: 'Astra CEO / Opus 5.5 COO; Opus owns design, implementation and technical review.',
  },
  {
    id: 'fusion-idiot-boss',
    label: 'Native Fusion team — idiot boss',
    badge: 'Native',
    description: 'Luna coordinator; persistent Opus 5.5 implementation, Astra review on demand.',
  },
  {
    id: 'graph',
    label: 'Task Graph (DAG)',
    badge: 'DAG',
    form: 'script',
    description: 'Graph dataflow scheduling with typed nodes and adversarial verification.',
  },
  {
    id: 'hive',
    label: 'Nested Swarm Hive',
    badge: 'Hive',
    form: 'script',
    description: 'Nested hive with captains and workers communicating on a shared board.',
  },
  {
    id: 'designer',
    label: 'Swarm Designer (Architect)',
    badge: 'Spec',
    form: 'script',
    description: 'Top-tier model designs a custom SwarmSpec from the live roster.',
  },
  {
    id: 'metaloop',
    label: 'MetaLoop Strategic Swarm',
    badge: 'MetaLoop',
    form: 'script',
    description: 'Strategic planner + active GPT operator + AndrewCode workers.',
  },
  {
    id: 'ultracode',
    label: 'UltraCode Shim Engine',
    badge: 'UltraCode',
    form: 'script',
    description: 'Local verb action: doctor, test, launch, status, or install through the bundled UltraCode-Shim.',
  },
  {
    id: 'ultraswarm',
    label: 'UltraSwarm Five-Agent Council',
    badge: 'UltraSwarm',
    form: 'script',
    description: 'Five-agent council via ultraswarm.sh: discover roster or run a council task.',
  },
  {
    id: 'board',
    label: 'Hive Board',
    badge: 'Board',
    form: 'script',
    description: 'Inspect, post, and poll the Hive Board (agents, channels, mentions, tree).',
  },
  {
    id: 'context',
    label: 'Agency Context',
    badge: 'Context',
    form: 'script',
    description: 'Shared agency context store: list, get, set, clear, or snapshot key/value state.',
  },
];

export type UltracodeVerb = 'doctor' | 'test' | 'launch' | 'status' | 'install';

export const ULTRACODE_VERBS: readonly UltracodeVerb[] = [
  'doctor',
  'test',
  'launch',
  'status',
  'install',
];

const ULTRACODE_VERB_VALUES: ReadonlySet<string> = new Set(ULTRACODE_VERBS);

export type BoardVerb = 'init' | 'agents' | 'poll' | 'channels' | 'tree' | 'mentions';

export const BOARD_VERBS: readonly BoardVerb[] = [
  'init',
  'agents',
  'poll',
  'channels',
  'tree',
  'mentions',
];

const BOARD_VERB_VALUES: ReadonlySet<string> = new Set(BOARD_VERBS);

export type ContextAction = 'list' | 'get' | 'set' | 'clear' | 'snapshot';

export const CONTEXT_ACTIONS: readonly ContextAction[] = [
  'list',
  'get',
  'set',
  'clear',
  'snapshot',
];

const CONTEXT_ACTION_VALUES: ReadonlySet<string> = new Set(CONTEXT_ACTIONS);

/** Options for the script-backed swarm forms (graph / hive / designer /
 * metaloop / ultracode / ultraswarm / board / context). Persisted in the
 * fusion selection store alongside the provider picks so form tasks and
 * dialogs share one customization state. */
export interface SwarmFormOptions {
  captains: readonly FusionProviderId[];
  childrenPerCaptain: number;
  layers: number;
  dryRun: boolean;
  ultracodeVerb: UltracodeVerb;
  thinkingEffort?: string;
  boardVerb?: BoardVerb;
  boardDb?: string;
  contextAction?: ContextAction;
  contextKey?: string;
  contextValue?: string;
}

export function getDefaultSwarmFormOptions(): SwarmFormOptions {
  return {
    captains: ['kimi', 'opencode', 'grok', 'copilot'],
    childrenPerCaptain: 4,
    layers: 2,
    dryRun: false,
    ultracodeVerb: 'doctor',
    boardVerb: 'agents',
    contextAction: 'list',
  };
}

export interface SwarmSelectionState {
  pattern: SwarmPattern;
  selectedProviders: Set<FusionProviderId>;
  providerModels: Record<FusionProviderId, string>;
  /** Session-model preference picked in the `/swarm` configuration dialog
   * (aliases from the TUI's model catalog). The session RPC has no model-set
   * parameter, so this stays a client-side record in the fusion selection
   * store, persisted and exported alongside the provider picks. */
  sessionModels: readonly string[];
  task: string;
  /** Script-form customization state (captains, children, layers, dry run,
   * UltraCode verb, thinking effort, board/context options). */
  formOptions: SwarmFormOptions;
}

export function getDefaultSwarmSelection(): SwarmSelectionState {
  const providerModels: Record<FusionProviderId, string> = {
    codex: 'gpt-5.6-sol',
    claude: 'claude-3-7-sonnet',
    grok: 'grok-4.5',
    copilot: 'gemini-3.5-flash',
    opencode: 'opencode-go/glm-5.2',
    kimi: 'kimi-k2.6',
    agy: 'Gemini 3.5 Flash (High)',
  };

  const selectedProviders = new Set<FusionProviderId>(['codex', 'claude', 'copilot', 'opencode']);

  return {
    pattern: 'moa',
    selectedProviders,
    providerModels,
    sessionModels: [],
    task: '',
    formOptions: getDefaultSwarmFormOptions(),
  };
}

export function getFusionStateDir(): string {
  return process.env['FUSION_STATE_DIR'] || join(homedir(), '.fusion');
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function loadLastSwarmSelection(): SwarmSelectionState {
  const defaults = getDefaultSwarmSelection();
  const stateDir = getFusionStateDir();
  const file = join(stateDir, 'ultraswarm', 'last_selection.json');

  if (!existsSync(file)) {
    return defaults;
  }

  try {
    const raw = readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    const selectedProviders = new Set<FusionProviderId>();
    const providerModels = { ...defaults.providerModels };

    if (data.agents && typeof data.agents === 'object') {
      for (const [key, agent] of Object.entries(data.agents)) {
        const id = (key === 'codex_cli' || key === 'codex_host' ? 'codex' : key) as FusionProviderId;
        if (typeof agent === 'object' && agent !== null) {
          const model = (agent as { model?: string }).model;
          if (model) {
            providerModels[id] = model;
            selectedProviders.add(id);
          }
        }
      }
    }

    if (data.pattern && SWARM_PATTERNS.some((p) => p.id === data.pattern)) {
      defaults.pattern = data.pattern;
    }

    if (typeof data.task === 'string') {
      defaults.task = data.task;
    }

    if (Array.isArray(data.session_models)) {
      defaults.sessionModels = data.session_models.filter(
        (entry: unknown): entry is string => typeof entry === 'string',
      );
    }

    if (data.form_options && typeof data.form_options === 'object') {
      const formOptions = data.form_options as Record<string, unknown>;
      const captains = Array.isArray(formOptions['captains'])
        ? formOptions['captains'].filter(
            (entry): entry is FusionProviderId =>
              typeof entry === 'string' && FUSION_PROVIDERS.some((provider) => provider.id === entry),
          )
        : undefined;
      if (captains !== undefined && captains.length > 0) {
        defaults.formOptions.captains = captains;
      }
      if (isPositiveInteger(formOptions['children_per_captain'])) {
        defaults.formOptions.childrenPerCaptain = formOptions['children_per_captain'];
      }
      if (isPositiveInteger(formOptions['layers'])) {
        defaults.formOptions.layers = formOptions['layers'];
      }
      if (typeof formOptions['dry_run'] === 'boolean') {
        defaults.formOptions.dryRun = formOptions['dry_run'];
      }
      if (
        typeof formOptions['ultracode_verb'] === 'string' &&
        ULTRACODE_VERB_VALUES.has(formOptions['ultracode_verb'])
      ) {
        defaults.formOptions.ultracodeVerb = formOptions['ultracode_verb'] as UltracodeVerb;
      }
      if (typeof formOptions['thinking_effort'] === 'string' && formOptions['thinking_effort'].length > 0) {
        defaults.formOptions.thinkingEffort = formOptions['thinking_effort'];
      }
      if (
        typeof formOptions['board_verb'] === 'string' &&
        BOARD_VERB_VALUES.has(formOptions['board_verb'])
      ) {
        defaults.formOptions.boardVerb = formOptions['board_verb'] as BoardVerb;
      }
      if (typeof formOptions['board_db'] === 'string' && formOptions['board_db'].length > 0) {
        defaults.formOptions.boardDb = formOptions['board_db'];
      }
      if (
        typeof formOptions['context_action'] === 'string' &&
        CONTEXT_ACTION_VALUES.has(formOptions['context_action'])
      ) {
        defaults.formOptions.contextAction = formOptions['context_action'] as ContextAction;
      }
      if (typeof formOptions['context_key'] === 'string' && formOptions['context_key'].length > 0) {
        defaults.formOptions.contextKey = formOptions['context_key'];
      }
      if (typeof formOptions['context_value'] === 'string') {
        defaults.formOptions.contextValue = formOptions['context_value'];
      }
    }

    if (selectedProviders.size > 0) {
      defaults.selectedProviders = selectedProviders;
    }
    defaults.providerModels = providerModels;
  } catch {
    // ignore parse errors and use defaults
  }

  return defaults;
}

export function saveSwarmSelection(state: SwarmSelectionState): void {
  const stateDir = getFusionStateDir();
  const ultraDir = join(stateDir, 'ultraswarm');
  mkdirSync(ultraDir, { recursive: true });

  const agents: Record<string, { model: string; role?: string; optional?: boolean }> = {};
  for (const prov of state.selectedProviders) {
    const model = state.providerModels[prov] || 'default';
    agents[prov] = { model, role: prov === 'codex' ? 'orchestrator' : 'specialist' };
  }

  const payload = {
    created_at: Math.floor(Date.now() / 1000),
    pattern: state.pattern,
    agents,
    session_models: [...state.sessionModels],
    task: state.task,
    form_options: {
      captains: [...state.formOptions.captains],
      children_per_captain: state.formOptions.childrenPerCaptain,
      layers: state.formOptions.layers,
      dry_run: state.formOptions.dryRun,
      ultracode_verb: state.formOptions.ultracodeVerb,
      thinking_effort: state.formOptions.thinkingEffort,
      board_verb: state.formOptions.boardVerb,
      board_db: state.formOptions.boardDb,
      context_action: state.formOptions.contextAction,
      context_key: state.formOptions.contextKey,
      context_value: state.formOptions.contextValue,
    },
  };

  const selFile = join(ultraDir, 'last_selection.json');
  const taskFile = join(ultraDir, 'last_task.txt');
  const envFile = join(ultraDir, 'last_selection.env');

  writeFileSync(selFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  writeFileSync(taskFile, (state.task || '') + '\n', 'utf8');

  const envLines: string[] = [
    `FUSION_CODEX_MODEL=${state.providerModels['codex']}`,
    `FUSION_CLAUDE_MODEL=${state.providerModels['claude']}`,
    `FUSION_GROK_MODEL=${state.providerModels['grok']}`,
    `FUSION_COPILOT_MODEL=${state.providerModels['copilot']}`,
    `FUSION_OPENCODE_MODEL=${state.providerModels['opencode']}`,
    `FUSION_KIMI_MODEL=${state.providerModels['kimi']}`,
    `FUSION_AGY_MODEL=${state.providerModels['agy']}`,
    `FUSION_SESSION_MODELS=${state.sessionModels.join(',')}`,
    `FUSION_PATTERN=${state.pattern}`,
  ];
  writeFileSync(envFile, envLines.join('\n') + '\n', 'utf8');

  // Apply to current process.env
  process.env['FUSION_CODEX_MODEL'] = state.providerModels['codex'];
  process.env['FUSION_CLAUDE_MODEL'] = state.providerModels['claude'];
  process.env['FUSION_GROK_MODEL'] = state.providerModels['grok'];
  process.env['FUSION_COPILOT_MODEL'] = state.providerModels['copilot'];
  process.env['FUSION_OPENCODE_MODEL'] = state.providerModels['opencode'];
  process.env['FUSION_KIMI_MODEL'] = state.providerModels['kimi'];
  process.env['FUSION_AGY_MODEL'] = state.providerModels['agy'];
  process.env['FUSION_SESSION_MODELS'] = state.sessionModels.join(',');
  process.env['FUSION_PATTERN'] = state.pattern;
}

export function formatSwarmBrief(state: SwarmSelectionState): string {
  const provNames = Array.from(state.selectedProviders)
    .map((p) => {
      const info = FUSION_PROVIDERS.find((x) => x.id === p);
      const model = state.providerModels[p];
      return `${info?.label ?? p} [${model}]`;
    })
    .join(', ');

  const patternInfo = SWARM_PATTERNS.find((p) => p.id === state.pattern);

  const brief =
    `[Custom Agent Swarm]\n` +
    `Pattern: ${patternInfo?.label ?? state.pattern}\n` +
    `Providers & Models: ${provNames}\n` +
    `AndrewCode session models: ${state.sessionModels.join(', ') || '(none selected)'}\n` +
    `Task: ${state.task || '(in-conversation context)'}\n`;

  if (patternInfo?.form === 'script') {
    return `${brief}\n${formatScriptFormBrief(state)}`;
  }
  return brief;
}

/** Form/options/instruction block appended to the brief for script-backed
 * forms. Tells the agent to run the task through the Fusion tool with the
 * matching mode and parameters, then synthesize the panelists' output. */
export function formatScriptFormBrief(state: SwarmSelectionState): string {
  const { formOptions, pattern } = state;
  const lines: string[] = [`Form: ${pattern}`];
  let optionLine: string;
  let parameters: string[];
  if (pattern === 'hive') {
    optionLine =
      `Captains: ${formOptions.captains.join(', ')} | ` +
      `Children per captain: ${formOptions.childrenPerCaptain} | ` +
      `Dry run: ${formOptions.dryRun ? 'on' : 'off'}`;
    parameters = [
      `captains=${formOptions.captains.join(',')}`,
      `children_per_captain=${formOptions.childrenPerCaptain}`,
      `dry_run=${formOptions.dryRun}`,
    ];
  } else if (pattern === 'ultracode') {
    optionLine = `UltraCode verb: ${formOptions.ultracodeVerb}`;
    parameters = [`verb=${formOptions.ultracodeVerb}`];
  } else if (pattern === 'ultraswarm') {
    optionLine = `Five-agent council${formOptions.dryRun ? ' | Dry run: on' : ''}`;
    parameters = formOptions.dryRun ? ['dry_run=true'] : [];
  } else if (pattern === 'board') {
    const verb = formOptions.boardVerb ?? 'agents';
    optionLine = `Board verb: ${verb}${formOptions.boardDb ? ` | db: ${formOptions.boardDb}` : ''}`;
    parameters = [`board_verb=${verb}`];
    if (formOptions.boardDb !== undefined && formOptions.boardDb.length > 0) {
      parameters.push(`board_db=${formOptions.boardDb}`);
    }
  } else if (pattern === 'context') {
    const action = formOptions.contextAction ?? 'list';
    const optionParts = [`Context action: ${action}`];
    parameters = [`context_action=${action}`];
    if (formOptions.contextKey !== undefined && formOptions.contextKey.length > 0) {
      optionParts.push(`key: ${formOptions.contextKey}`);
      parameters.push(`context_key=${formOptions.contextKey}`);
    }
    if (formOptions.contextValue !== undefined) {
      optionParts.push(`value: ${formOptions.contextValue}`);
      parameters.push(`context_value=${formOptions.contextValue}`);
    }
    optionLine = optionParts.join(' | ');
  } else {
    optionLine = `Dry run: ${formOptions.dryRun ? 'on' : 'off'}`;
    parameters = [`dry_run=${formOptions.dryRun}`];
  }
  if (formOptions.thinkingEffort !== undefined && formOptions.thinkingEffort.length > 0) {
    optionLine += ` | Thinking: ${formOptions.thinkingEffort}`;
    parameters.push(`thinking_effort=${formOptions.thinkingEffort}`);
  }
  lines.push(`Form options: ${optionLine}`);
  const parameterClause =
    parameters.length > 0 ? ` and parameters ${parameters.join(', ')}` : '';
  lines.push(
    `Execution: run the task through the Fusion tool with mode=${pattern}${parameterClause}, then synthesize the panelists' output.`,
  );
  return lines.join('\n');
}