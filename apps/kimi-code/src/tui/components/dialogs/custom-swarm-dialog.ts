import { effectiveModelAlias, type ModelAlias } from '@moonshot-ai/kimi-code-sdk';
import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '@moonshot-ai/pi-tui';

import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { pageView } from '#/tui/utils/paging';
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';
import {
  BOARD_VERBS,
  CONTEXT_ACTIONS,
  FUSION_PROVIDERS,
  SWARM_PATTERNS,
  ULTRACODE_VERBS,
  getDefaultSwarmFormOptions,
  loadLastSwarmSelection,
  nativeFusionStrategy,
  saveSwarmSelection,
  type FusionProviderId,
  type SwarmFormOptions,
  type SwarmPattern,
  type SwarmSelectionState,
} from '#/tui/utils/fusion-swarm';
import { effortLabel, modelDisplayName, providerDisplayName } from './model-selector';

const ELLIPSIS = '…';
const CUSTOM_SWARM_PATTERNS = SWARM_PATTERNS.filter(
  (pattern) => nativeFusionStrategy(pattern.id) === undefined,
);

const PROVIDER_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'] as const;
type ProviderEffort = (typeof PROVIDER_EFFORTS)[number];

const HINT =
  '↑↓ navigate · PgUp/PgDn page · Space toggle · ←→ effort · Enter select/start · Esc cancel';

export interface CustomSwarmDialogOptions {
  readonly initialTask?: string;
  readonly initialPattern?: SwarmPattern;
  readonly models: Record<string, ModelAlias>;
  readonly onStart: (selection: SwarmSelectionState) => void;
  readonly onCancel: () => void;
}

type DialogRow =
  | { readonly kind: 'pattern' }
  | { readonly kind: 'form_captain'; readonly providerId: FusionProviderId }
  | { readonly kind: 'form_children' }
  | { readonly kind: 'form_layers' }
  | { readonly kind: 'form_dry_run' }
  | { readonly kind: 'form_ultracode_verb' }
  | { readonly kind: 'form_ultraswarm_note' }
  | { readonly kind: 'form_board_verb' }
  | { readonly kind: 'form_board_db' }
  | { readonly kind: 'form_context_action' }
  | { readonly kind: 'form_context_key' }
  | { readonly kind: 'form_context_value' }
  | { readonly kind: 'form_thinking' }
  | { readonly kind: 'provider'; readonly providerId: FusionProviderId }
  | { readonly kind: 'sessionModel'; readonly alias: string }
  | { readonly kind: 'start_btn' }
  | { readonly kind: 'cancel_btn' };

function cycleIndex<T>(items: readonly T[], current: T | undefined, delta: number): T {
  const idx = current === undefined ? -1 : items.indexOf(current);
  const from = idx < 0 ? 0 : idx;
  return items[(from + delta + items.length) % items.length]!;
}

function appendChar(value: string, data: string): string | undefined {
  if (matchesKey(data, Key.backspace)) {
    return value.slice(0, -1);
  }
  const ch = printableChar(data);
  if (!isPrintableChar(ch)) return undefined;
  return value + ch;
}

export class CustomSwarmDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: CustomSwarmDialogOptions;
  private readonly state: SwarmSelectionState;
  private readonly formOptions: SwarmFormOptions = getDefaultSwarmFormOptions();
  private readonly providerEffort: Partial<Record<FusionProviderId, string>> = {};
  private rows: readonly DialogRow[] = [];
  private selectedIndex = 0;

  constructor(opts: CustomSwarmDialogOptions) {
    super();
    this.opts = opts;
    this.state = loadLastSwarmSelection();
    if (opts.initialPattern) {
      this.state.pattern = opts.initialPattern;
    } else if (nativeFusionStrategy(this.state.pattern) !== undefined) {
      this.state.pattern = 'moa';
    }
    if (opts.initialTask && opts.initialTask.trim().length > 0) {
      this.state.task = opts.initialTask.trim();
    }

    this.rebuildRows();
  }

  private rebuildRows(): void {
    const rows: DialogRow[] = [{ kind: 'pattern' }];
    const pattern = this.state.pattern as string;

    if (pattern === 'hive' || pattern === 'designer') {
      for (const prov of FUSION_PROVIDERS) {
        rows.push({ kind: 'form_captain', providerId: prov.id });
      }
    }
    if (pattern === 'hive') {
      rows.push({ kind: 'form_children' });
    }
    if (pattern === 'moa' || pattern === 'metaloop') {
      rows.push({ kind: 'form_layers' });
    }
    if (pattern === 'graph' || pattern === 'hive' || pattern === 'ultraswarm') {
      rows.push({ kind: 'form_dry_run' });
    }
    if (pattern === 'ultracode') {
      rows.push({ kind: 'form_ultracode_verb' });
    }
    if (pattern === 'ultraswarm') {
      rows.push({ kind: 'form_ultraswarm_note' });
    }
    if (pattern === 'board') {
      rows.push({ kind: 'form_board_verb' }, { kind: 'form_board_db' });
    }
    if (pattern === 'context') {
      rows.push({ kind: 'form_context_action' });
      const action = this.formOptions.contextAction ?? 'list';
      if (action === 'get' || action === 'set' || action === 'clear') {
        rows.push({ kind: 'form_context_key' });
      }
      if (action === 'set') {
        rows.push({ kind: 'form_context_value' });
      }
    }
    rows.push({ kind: 'form_thinking' });

    for (const prov of FUSION_PROVIDERS) {
      rows.push({ kind: 'provider', providerId: prov.id });
    }
    for (const alias of Object.keys(this.opts.models)) {
      rows.push({ kind: 'sessionModel', alias });
    }
    rows.push({ kind: 'start_btn' }, { kind: 'cancel_btn' });
    this.rows = rows;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.selectedIndex = (this.selectedIndex - 1 + this.rows.length) % this.rows.length;
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.selectedIndex = (this.selectedIndex + 1) % this.rows.length;
      return;
    }

    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
      const delta = matchesKey(data, Key.pageUp) ? -8 : 8;
      this.selectedIndex = Math.max(0, Math.min(this.rows.length - 1, this.selectedIndex + delta));
      return;
    }

    const currentRow = this.rows[this.selectedIndex];
    if (!currentRow) return;

    if (currentRow.kind === 'sessionModel' && (matchesKey(data, Key.space) || matchesKey(data, Key.enter))) {
      const models = new Set(this.state.sessionModels);
      if (models.has(currentRow.alias)) models.delete(currentRow.alias);
      else models.add(currentRow.alias);
      this.state.sessionModels = [...models];
      return;
    }

    if (currentRow.kind === 'form_captain') {
      const decoded = printableChar(data);
      if (matchesKey(data, Key.space) || decoded === ' ' || matchesKey(data, Key.enter)) {
        const current = [...this.formOptions.captains];
        const provId = currentRow.providerId;
        const idx = current.indexOf(provId);
        if (idx >= 0) {
          if (current.length > 1) current.splice(idx, 1);
        } else {
          current.push(provId);
        }
        this.formOptions.captains = current;
        return;
      }
    }

    if (currentRow.kind === 'form_children') {
      if (matchesKey(data, Key.left)) {
        this.formOptions.childrenPerCaptain = Math.max(1, this.formOptions.childrenPerCaptain - 1);
        return;
      }
      if (matchesKey(data, Key.right)) {
        this.formOptions.childrenPerCaptain = Math.min(8, this.formOptions.childrenPerCaptain + 1);
        return;
      }
      const char = printableChar(data);
      if (char && char >= '1' && char <= '8') {
        this.formOptions.childrenPerCaptain = Number(char);
        return;
      }
    }

    if (currentRow.kind === 'form_layers') {
      if (matchesKey(data, Key.left)) {
        this.formOptions.layers = Math.max(1, this.formOptions.layers - 1);
        return;
      }
      if (matchesKey(data, Key.right)) {
        this.formOptions.layers = Math.min(4, this.formOptions.layers + 1);
        return;
      }
      const char = printableChar(data);
      if (char && char >= '1' && char <= '4') {
        this.formOptions.layers = Number(char);
        return;
      }
    }

    if (currentRow.kind === 'form_dry_run') {
      const decoded = printableChar(data);
      if (
        matchesKey(data, Key.space) ||
        decoded === ' ' ||
        matchesKey(data, Key.enter) ||
        matchesKey(data, Key.left) ||
        matchesKey(data, Key.right)
      ) {
        this.formOptions.dryRun = !this.formOptions.dryRun;
        return;
      }
    }

    if (currentRow.kind === 'form_ultracode_verb') {
      if (matchesKey(data, Key.left)) {
        this.formOptions.ultracodeVerb = cycleIndex(ULTRACODE_VERBS, this.formOptions.ultracodeVerb, -1);
        return;
      }
      const decoded = printableChar(data);
      if (matchesKey(data, Key.right) || matchesKey(data, Key.space) || decoded === ' ' || matchesKey(data, Key.enter)) {
        this.formOptions.ultracodeVerb = cycleIndex(ULTRACODE_VERBS, this.formOptions.ultracodeVerb, 1);
        return;
      }
    }

    if (currentRow.kind === 'form_board_verb') {
      const current = this.formOptions.boardVerb ?? 'agents';
      if (matchesKey(data, Key.left)) {
        this.formOptions.boardVerb = cycleIndex(BOARD_VERBS, current, -1);
        return;
      }
      const decoded = printableChar(data);
      if (matchesKey(data, Key.right) || matchesKey(data, Key.space) || decoded === ' ' || matchesKey(data, Key.enter)) {
        this.formOptions.boardVerb = cycleIndex(BOARD_VERBS, current, 1);
        return;
      }
    }

    if (currentRow.kind === 'form_board_db') {
      const next = appendChar(this.formOptions.boardDb ?? '', data);
      if (next !== undefined) {
        this.formOptions.boardDb = next.length > 0 ? next : undefined;
        return;
      }
    }

    if (currentRow.kind === 'form_context_action') {
      const current = this.formOptions.contextAction ?? 'list';
      if (matchesKey(data, Key.left)) {
        this.formOptions.contextAction = cycleIndex(CONTEXT_ACTIONS, current, -1);
        this.rebuildRows();
        this.clampSelection();
        return;
      }
      const decoded = printableChar(data);
      if (matchesKey(data, Key.right) || matchesKey(data, Key.space) || decoded === ' ' || matchesKey(data, Key.enter)) {
        this.formOptions.contextAction = cycleIndex(CONTEXT_ACTIONS, current, 1);
        this.rebuildRows();
        this.clampSelection();
        return;
      }
    }

    if (currentRow.kind === 'form_context_key') {
      const next = appendChar(this.formOptions.contextKey ?? '', data);
      if (next !== undefined) {
        this.formOptions.contextKey = next.length > 0 ? next : undefined;
        return;
      }
    }

    if (currentRow.kind === 'form_context_value') {
      const next = appendChar(this.formOptions.contextValue ?? '', data);
      if (next !== undefined) {
        this.formOptions.contextValue = next.length > 0 ? next : undefined;
        return;
      }
    }

    if (currentRow.kind === 'form_thinking') {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
        const delta = matchesKey(data, Key.left) ? -1 : 1;
        const next = cycleIndex(PROVIDER_EFFORTS, this.currentThinking(), delta);
        this.formOptions.thinkingEffort = next === 'default' ? undefined : next;
        return;
      }
    }

    if (matchesKey(data, Key.left)) {
      if (currentRow.kind === 'pattern') {
        this.cyclePattern(-1);
      } else if (currentRow.kind === 'provider') {
        this.cycleProviderValue(currentRow.providerId, -1);
      }
      return;
    }

    if (matchesKey(data, Key.right)) {
      if (currentRow.kind === 'pattern') {
        this.cyclePattern(1);
      } else if (currentRow.kind === 'provider') {
        this.cycleProviderValue(currentRow.providerId, 1);
      }
      return;
    }

    const decoded = printableChar(data);
    if (matchesKey(data, Key.space) || decoded === ' ') {
      if (currentRow.kind === 'provider') {
        this.toggleProvider(currentRow.providerId);
      } else if (currentRow.kind === 'pattern') {
        this.cyclePattern(1);
      }
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (currentRow.kind === 'start_btn') {
        this.startSwarm();
      } else if (currentRow.kind === 'cancel_btn') {
        this.opts.onCancel();
      } else if (currentRow.kind === 'pattern') {
        this.cyclePattern(1);
      } else if (currentRow.kind === 'provider') {
        this.cycleModel(currentRow.providerId, 1);
      }
      return;
    }
  }

  private clampSelection(): void {
    this.selectedIndex = Math.min(this.selectedIndex, this.rows.length - 1);
  }

  private currentThinking(): ProviderEffort {
    const effort = this.formOptions.thinkingEffort;
    if (effort !== undefined && (PROVIDER_EFFORTS as readonly string[]).includes(effort)) {
      return effort as ProviderEffort;
    }
    return 'default';
  }

  private cyclePattern(delta: number): void {
    const currentIdx = CUSTOM_SWARM_PATTERNS.findIndex((p) => p.id === this.state.pattern);
    const nextIdx = (currentIdx + delta + CUSTOM_SWARM_PATTERNS.length) % CUSTOM_SWARM_PATTERNS.length;
    this.state.pattern = CUSTOM_SWARM_PATTERNS[nextIdx]!.id;
    this.rebuildRows();
    this.clampSelection();
  }

  private toggleProvider(provId: FusionProviderId): void {
    if (this.state.selectedProviders.has(provId)) {
      if (this.state.selectedProviders.size > 1) {
        this.state.selectedProviders.delete(provId);
      }
    } else {
      this.state.selectedProviders.add(provId);
    }
  }

  private cycleModel(provId: FusionProviderId, delta: number): void {
    const provConfig = FUSION_PROVIDERS.find((p) => p.id === provId);
    if (!provConfig) return;
    const currentModel = this.state.providerModels[provId] || provConfig.defaultModel;
    const currentIdx = provConfig.models.indexOf(currentModel);
    const nextIdx = (currentIdx + delta + provConfig.models.length) % provConfig.models.length;
    this.state.providerModels[provId] = provConfig.models[nextIdx]!;
    this.state.selectedProviders.add(provId);
  }

  private cycleProviderValue(provId: FusionProviderId, delta: number): void {
    const current = this.providerEffort[provId] ?? this.currentThinking();
    const next = cycleIndex(PROVIDER_EFFORTS, current, delta);
    this.providerEffort[provId] = next;
    this.state.selectedProviders.add(provId);
  }

  private startSwarm(): void {
    const selectedEffort = [...this.state.selectedProviders]
      .map((id) => this.providerEffort[id])
      .find((effort) => effort !== undefined && effort !== 'default');
    if (this.formOptions.thinkingEffort === undefined && selectedEffort !== undefined) {
      this.formOptions.thinkingEffort = selectedEffort;
    }
    this.state.formOptions = {
      ...this.formOptions,
      captains: [...this.formOptions.captains],
    };
    saveSwarmSelection(this.state);
    this.opts.onStart({
      ...this.state,
      formOptions: {
        ...this.formOptions,
        captains: [...this.formOptions.captains],
      },
    });
  }

  override render(width: number): string[] {
    const lines: string[] = [];

    lines.push(
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ' Custom Multi-Model Agent Swarm (Fusion Engine)'),
      currentTheme.fg('textMuted', ` ${HINT}`),
      '',
    );

    const patternRowSelected = this.selectedIndex === 0;
    const patternInfo =
      CUSTOM_SWARM_PATTERNS.find((p) => p.id === this.state.pattern) ?? CUSTOM_SWARM_PATTERNS[0]!;
    const patternPrefix = patternRowSelected ? currentTheme.fg('primary', `${SELECT_POINTER} `) : '  ';
    const patternLabel = patternRowSelected
      ? currentTheme.boldFg('primary', patternInfo.label)
      : currentTheme.bold(patternInfo.label);
    const patternBadge = currentTheme.fg('warning', `[${patternInfo.badge}]`);
    lines.push(
      `${patternPrefix}${currentTheme.fg('textMuted', 'Architecture:')} ${patternLabel} ${patternBadge}`,
      `     ${currentTheme.fg('textMuted', patternInfo.description)}`,
    );

    const pattern = this.state.pattern as string;

    if (pattern === 'hive' || pattern === 'designer') {
      lines.push('', currentTheme.boldFg('text', ' Captain Providers (Hive/Designer):'));
      for (const prov of FUSION_PROVIDERS) {
        const rowIndex = this.rows.findIndex(
          (r) => r.kind === 'form_captain' && r.providerId === prov.id,
        );
        const isRowSelected = this.selectedIndex === rowIndex;
        const isCaptain = this.formOptions.captains.includes(prov.id);
        const prefix = isRowSelected ? currentTheme.fg('primary', `${SELECT_POINTER} `) : '  ';
        const checkbox = isCaptain
          ? currentTheme.fg('success', '[x]')
          : currentTheme.fg('textMuted', '[ ]');
        const label = isCaptain
          ? isRowSelected
            ? currentTheme.boldFg('primary', prov.label)
            : currentTheme.boldFg('text', prov.label)
          : currentTheme.fg('textMuted', prov.label);
        lines.push(`${prefix}${checkbox} ${label}  ${currentTheme.fg('textDim', `(${prov.id})`)}`);
      }
    }

    if (pattern === 'hive') {
      lines.push(this.renderCycleRow('form_children', 'Children per captain:', String(this.formOptions.childrenPerCaptain), '(1–8, default 4)'));
    }

    if (pattern === 'moa' || pattern === 'metaloop') {
      lines.push(this.renderCycleRow('form_layers', 'Layers:', String(this.formOptions.layers), '(1–4, default 2)'));
    }

    if (pattern === 'graph' || pattern === 'hive' || pattern === 'ultraswarm') {
      const rowIndex = this.rows.findIndex((r) => r.kind === 'form_dry_run');
      const isRowSelected = this.selectedIndex === rowIndex;
      const prefix = isRowSelected ? currentTheme.fg('primary', `${SELECT_POINTER} `) : '  ';
      const status = this.formOptions.dryRun
        ? currentTheme.fg('success', 'enabled')
        : currentTheme.fg('textDim', 'disabled');
      const box = this.formOptions.dryRun
        ? currentTheme.fg('success', '[x]')
        : currentTheme.fg('textMuted', '[ ]');
      const name = isRowSelected
        ? currentTheme.boldFg('primary', 'Dry run:')
        : currentTheme.fg('text', 'Dry run:');
      lines.push(`${prefix}${box} ${name}  ${status}  ${currentTheme.fg('textMuted', '(Space to toggle)')}`);
    }

    if (pattern === 'ultracode') {
      lines.push(this.renderCycleRow('form_ultracode_verb', 'Ultracode verb:', this.formOptions.ultracodeVerb, '(doctor/test/launch/status/install)'));
    }

    if (pattern === 'ultraswarm') {
      const rowIndex = this.rows.findIndex((r) => r.kind === 'form_ultraswarm_note');
      const isRowSelected = this.selectedIndex === rowIndex;
      const prefix = isRowSelected ? currentTheme.fg('primary', `${SELECT_POINTER} `) : '  ';
      lines.push(`${prefix}${currentTheme.fg('textMuted', 'Five-agent council via ultraswarm.sh (discover roster or run a council task).')}`);
    }

    if (pattern === 'board') {
      const verb = this.formOptions.boardVerb ?? 'agents';
      lines.push(this.renderCycleRow('form_board_verb', 'Board verb:', verb, '(init/agents/poll/channels/tree/mentions)'));
      lines.push(this.renderTextRow('form_board_db', 'Board db:', this.formOptions.boardDb ?? '', '(optional path)'));
    }

    if (pattern === 'context') {
      const action = this.formOptions.contextAction ?? 'list';
      lines.push(this.renderCycleRow('form_context_action', 'Context action:', action, '(list/get/set/clear/snapshot)'));
      if (action === 'get' || action === 'set' || action === 'clear') {
        lines.push(this.renderTextRow('form_context_key', 'Context key:', this.formOptions.contextKey ?? '', ''));
      }
      if (action === 'set') {
        lines.push(this.renderTextRow('form_context_value', 'Context value:', this.formOptions.contextValue ?? '', ''));
      }
    }

    lines.push(this.renderThinkingRow());

    lines.push('', currentTheme.boldFg('text', ' Participating Model Providers:'));
    for (const prov of FUSION_PROVIDERS) {
      const rowIndex = this.rows.findIndex(
        (r) => r.kind === 'provider' && r.providerId === prov.id,
      );
      const isRowSelected = this.selectedIndex === rowIndex;
      const isEnabled = this.state.selectedProviders.has(prov.id);
      const currentModel = this.state.providerModels[prov.id] || prov.defaultModel;
      const effort = this.providerEffort[prov.id] ?? this.currentThinking();

      const prefix = isRowSelected ? currentTheme.fg('primary', `${SELECT_POINTER} `) : '  ';
      const checkbox = isEnabled
        ? currentTheme.fg('success', '[x]')
        : currentTheme.fg('textMuted', '[ ]');
      const provName = isEnabled
        ? isRowSelected
          ? currentTheme.boldFg('primary', prov.label)
          : currentTheme.boldFg('text', prov.label)
        : currentTheme.fg('textMuted', prov.label);
      const modelTag = isEnabled
        ? currentTheme.fg('primary', currentModel)
        : currentTheme.fg('textMuted', `(${currentModel})`);
      const effortTag = isEnabled
        ? currentTheme.fg('primary', `← ${effortLabel(effort)} →`)
        : currentTheme.fg('textMuted', `(${effortLabel(effort)})`);

      lines.push(`${prefix}${checkbox} ${provName}  ${modelTag}  ${effortTag}`);
      if (isRowSelected) {
        lines.push(`     ${currentTheme.fg('textMuted', prov.description)}`);
      }
    }

    lines.push('', currentTheme.boldFg('text', ' Session models (AndrewCode)'));
    const aliases = Object.keys(this.opts.models);
    const sessionStart = this.rows.findIndex((r) => r.kind === 'sessionModel');
    const page = pageView(aliases.length, sessionStart >= 0 ? this.selectedIndex - sessionStart : 0, 8);
    if (aliases.length === 0) {
      lines.push(currentTheme.fg('textMuted', '   No session models configured'));
    }
    for (let i = page.start; i < page.end; i++) {
      const alias = aliases[i]!;
      const model = effectiveModelAlias(this.opts.models[alias]!);
      const selected = sessionStart >= 0 && this.selectedIndex === sessionStart + i;
      const pointer = selected ? SELECT_POINTER : ' ';
      const checkbox = this.state.sessionModels.includes(alias) ? '[x]' : '[ ]';
      const label = `${pointer} ${checkbox} ${modelDisplayName(alias, model)} [${alias}]`;
      lines.push(
        (selected ? currentTheme.boldFg('primary', label) : currentTheme.fg('text', label)) +
          currentTheme.fg('textMuted', `  ${providerDisplayName(model.provider)}`),
      );
    }
    if (page.pageCount > 1) {
      lines.push(
        currentTheme.fg('textMuted', ` Page ${String(page.page + 1)} / ${String(page.pageCount)}`),
      );
      const below = aliases.length - page.end;
      if (below > 0) {
        lines.push(currentTheme.fg('textMuted', ` ▼ ${String(below)} more`));
      }
    }
    lines.push('');

    if (this.state.task.trim().length > 0) {
      lines.push(
        currentTheme.fg('textMuted', ' Task Brief: ') +
          currentTheme.fg('text', truncateToWidth(this.state.task, Math.max(0, width - 15), ELLIPSIS)),
      );
    } else {
      lines.push(currentTheme.fg('textMuted', ' Task Brief: (Using active conversation context / prompt)'));
    }

    lines.push('');

    const startIdx = this.rows.findIndex((r) => r.kind === 'start_btn');
    const cancelIdx = this.rows.findIndex((r) => r.kind === 'cancel_btn');
    const startSelected = this.selectedIndex === startIdx;
    const cancelSelected = this.selectedIndex === cancelIdx;

    const startBtn = startSelected
      ? currentTheme.boldFg('primary', `${SELECT_POINTER} [ Start Custom Swarm ]`)
      : currentTheme.fg('text', '  [ Start Custom Swarm ]');

    const cancelBtn = cancelSelected
      ? currentTheme.boldFg('primary', `${SELECT_POINTER} [ Cancel ]`)
      : currentTheme.fg('textMuted', '  [ Cancel ]');

    lines.push(startBtn, cancelBtn);
    lines.push('', currentTheme.fg('primary', '─'.repeat(width)));

    return lines.map((line) => truncateToWidth(line, width));
  }

  private renderCycleRow(kind: DialogRow['kind'], label: string, value: string, hint: string): string {
    const rowIndex = this.rows.findIndex((r) => r.kind === kind);
    const isRowSelected = this.selectedIndex === rowIndex;
    const prefix = isRowSelected ? currentTheme.fg('primary', `${SELECT_POINTER} `) : '  ';
    const name = isRowSelected ? currentTheme.boldFg('primary', label) : currentTheme.fg('text', label);
    const val = currentTheme.fg('primary', `← ${value} →`);
    const suffix = hint.length > 0 ? `  ${currentTheme.fg('textMuted', hint)}` : '';
    return `${prefix}${name}  ${val}${suffix}`;
  }

  private renderTextRow(kind: DialogRow['kind'], label: string, value: string, hint: string): string {
    const rowIndex = this.rows.findIndex((r) => r.kind === kind);
    const isRowSelected = this.selectedIndex === rowIndex;
    const prefix = isRowSelected ? currentTheme.fg('primary', `${SELECT_POINTER} `) : '  ';
    const name = isRowSelected ? currentTheme.boldFg('primary', label) : currentTheme.fg('text', label);
    const shown = value.length > 0 ? value : '(empty)';
    const val = isRowSelected
      ? currentTheme.boldFg('primary', shown)
      : currentTheme.fg('textMuted', shown);
    const suffix = hint.length > 0 ? `  ${currentTheme.fg('textMuted', hint)}` : '';
    return `${prefix}${name}  ${val}${suffix}`;
  }

  private renderThinkingRow(): string {
    const rowIndex = this.rows.findIndex((r) => r.kind === 'form_thinking');
    const isRowSelected = this.selectedIndex === rowIndex;
    const prefix = isRowSelected ? currentTheme.fg('primary', `${SELECT_POINTER} `) : '  ';
    const current = this.currentThinking();
    const segments = PROVIDER_EFFORTS.map((effort) => {
      const label = effortLabel(effort);
      return effort === current
        ? currentTheme.boldFg('primary', `[ ${label} ]`)
        : currentTheme.fg('textMuted', `  ${label}  `);
    }).join('  ');
    const title = isRowSelected
      ? currentTheme.boldFg('primary', 'Thinking')
      : currentTheme.fg('text', 'Thinking');
    return `${prefix}${title}  (←→ to switch)  ${segments}`;
  }
}
