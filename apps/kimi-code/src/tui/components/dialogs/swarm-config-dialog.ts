/**
 * SwarmConfigDialogComponent — visual swarm configuration entered by running
 * `/swarm` without arguments: pick model preferences and a swarm pattern,
 * then confirm from the summary panel instead of a bare toggle.
 *
 * Three panels cycle with Tab / Shift+Tab through the shared tab strip
 * (utils/tab-strip.ts): 'Models' (searchable multi-select over the session's
 * configured models — Enter toggles a ✓ membership marker, ←→ cycles thinking
 * effort like `/model`, and the footer lists the chosen aliases), 'Pattern'
 * (single-select over the fusion swarm patterns, grouped Native / Panel /
 * Script), and 'Start' (selection summary plus script-form Options and the
 * final 'Enter swarm mode' action). Native Fusion replaces Models with Fusion
 * roles: per-role catalog aliases and supported efforts override engine
 * defaults for this team only. Other patterns reuse `/swarm on` and record
 * chosen models as a client-side preference through the fusion-swarm
 * selection store.
 *
 * Layout, key map, and copy follow .agents/skills/write-tui/DESIGN.md.
 */

import { effectiveModelAlias, type ModelAlias } from '@moonshot-ai/kimi-code-sdk';
import {
  Container,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@moonshot-ai/pi-tui';

import { CURRENT_MARK, SELECT_POINTER, SUCCESS_MARK } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { SearchableList } from '#/tui/utils/searchable-list';
import { renderTabStrip } from '#/tui/utils/tab-strip';
import {
  BOARD_VERBS,
  CONTEXT_ACTIONS,
  FUSION_PROVIDERS,
  SWARM_PATTERNS,
  ULTRACODE_VERBS,
  getDefaultSwarmFormOptions,
  nativeFusionStrategy,
  type FusionProviderId,
  type SwarmFormOptions,
  type SwarmPattern,
  type SwarmPatternOption,
} from '../../utils/fusion-swarm';
import {
  defaultThinkingEffortFor,
  effortLabel,
  effortsOf,
  modelDisplayName,
  providerDisplayName,
  segmentsFor,
} from './model-selector';

const PANELS = ['models', 'pattern', 'start'] as const;
type SwarmConfigPanelId = (typeof PANELS)[number];

const PANEL_LABELS: Record<SwarmConfigPanelId, string> = {
  models: 'Models',
  pattern: 'Pattern',
  start: 'Start',
};

const START_ACTION = '[ Enter swarm mode ]';

type PatternGroup = 'Native' | 'Panel' | 'Script';

type StartFocus =
  | 'captains'
  | 'children'
  | 'layers'
  | 'dry_run'
  | 'ultracode_verb'
  | 'board_verb'
  | 'context_action'
  | 'context_key'
  | 'context_value'
  | 'start_btn';

export type FusionRole = 'ceo' | 'coo' | 'worker' | 'muse';

export interface FusionRoleAssignment {
  readonly model: string;
  readonly effort?: string;
}

export interface SwarmConfigSelection {
  /** Legacy client-side preferences; native Fusion uses per-role overrides. */
  readonly models: readonly string[];
  readonly pattern: SwarmPattern;
  readonly roles?: Partial<Record<FusionRole, FusionRoleAssignment>>;
  readonly dual?: boolean;
  readonly formOptions?: SwarmFormOptions;
  /** Per-session-model thinking effort, keyed by catalog alias. */
  readonly modelThinking?: Record<string, string>;
  /** Last session-model effort cycled with ←→ (also persisted as thinking_effort). */
  readonly thinkingEffort?: string;
}

interface FusionRoleRow {
  readonly id: FusionRole | 'dual';
  readonly label: string;
}

interface FusionRolePicker {
  readonly role: FusionRole;
  readonly list: SearchableList<ModelRow>;
  effort: string | undefined;
}

export interface SwarmConfigDialogOptions {
  /** Session models offered for multi-select (already filtered like the
   * /model picker — see pickerModelsForHost in commands/config.ts). */
  readonly models: Record<string, ModelAlias>;
  /** Alias of the session's currently active model (summary fallback). */
  readonly currentValue: string;
  readonly onConfirm: (selection: SwarmConfigSelection) => void;
  readonly onCancel: () => void;
}

interface ModelRow {
  readonly alias: string;
  readonly name: string;
  readonly provider: string;
  readonly model?: ModelAlias;
}

function createModelRows(models: Record<string, ModelAlias>): readonly ModelRow[] {
  return Object.entries(models).map(([alias, cfg]) => {
    const effective = effectiveModelAlias(cfg);
    return {
      alias,
      name: modelDisplayName(alias, effective),
      provider: providerDisplayName(effective.provider),
      model: effective,
    };
  });
}

function patternGroup(pattern: SwarmPatternOption): PatternGroup {
  if (pattern.form === 'script') return 'Script';
  if (nativeFusionStrategy(pattern.id) !== undefined) return 'Native';
  return 'Panel';
}

function cycleItem<T>(items: readonly T[], current: T | undefined, delta: number): T {
  const fallback = items[0]!;
  const found = current === undefined ? -1 : items.indexOf(current);
  const index = found < 0 ? 0 : found;
  return items[(index + delta + items.length) % items.length] ?? fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class SwarmConfigDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: SwarmConfigDialogOptions;
  private readonly modelList: SearchableList<ModelRow>;
  private readonly patternList: SearchableList<SwarmPatternOption>;
  private readonly modelCount: number;
  /** Picked model aliases in picking order. */
  private readonly selectedModels: string[] = [];
  private pattern: SwarmPattern = SWARM_PATTERNS[0]!.id;
  private activePanel: SwarmConfigPanelId = 'models';
  private readonly roles: Partial<Record<FusionRole, FusionRoleAssignment>> = {};
  private dual = false;
  private roleList = new SearchableList<FusionRoleRow>({ items: [], toSearchText: (row) => row.label });
  private rolePicker: FusionRolePicker | undefined;
  private readonly formOptions: SwarmFormOptions = getDefaultSwarmFormOptions();
  private readonly captainsInput = new Input();
  private readonly contextKeyInput = new Input();
  private readonly contextValueInput = new Input();
  private startFocus: StartFocus = 'start_btn';
  private readonly modelThinking: Record<string, string> = {};
  private thinkingEffort: string | undefined;

  constructor(opts: SwarmConfigDialogOptions) {
    super();
    this.opts = opts;
    this.modelCount = Object.keys(opts.models).length;
    this.modelList = new SearchableList({
      items: createModelRows(opts.models),
      toSearchText: (row) => `${row.name} (${row.provider})`,
      searchable: true,
    });
    this.captainsInput.setValue(this.formOptions.captains.join(','));
    this.patternList = new SearchableList({
      items: [...SWARM_PATTERNS],
      toSearchText: (pattern) => `${pattern.label} ${pattern.description} ${patternGroup(pattern)}`,
      pageSize: 20,
    });
  }

  handleInput(data: string): void {
    if (this.rolePicker !== undefined) {
      this.handleRolePickerInput(data);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      // Two-stage Esc on the searchable panel: clear the query first, leave
      // the dialog only on the second press.
      if (this.activePanel === 'models' && nativeFusionStrategy(this.pattern) === undefined && this.modelList.clearQuery()) return;
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.switchPanel(1);
      return;
    }
    if (matchesKey(data, Key.shift('tab'))) {
      this.switchPanel(-1);
      return;
    }
    if (this.activePanel === 'models') {
      this.handleModelsInput(data);
    } else if (this.activePanel === 'pattern') {
      this.handlePatternInput(data);
    } else {
      this.handleStartInput(data);
    }
  }

  override render(width: number): string[] {
    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', this.renderTitle()),
      currentTheme.fg('textMuted', ` ${this.renderHint()}`),
      '',
    ];
    if (PANELS.length > 1) {
      lines.push(
        renderTabStrip({
          labels: PANELS.map((panel) => panel === 'models' && nativeFusionStrategy(this.pattern) !== undefined ? 'Fusion roles' : PANEL_LABELS[panel]),
          activeIndex: PANELS.indexOf(this.activePanel),
          width,
          colors: currentTheme.palette,
        }),
        '',
      );
    }
    if (this.activePanel === 'models') {
      lines.push(...this.renderModelsPanel(width));
    } else if (this.activePanel === 'pattern') {
      lines.push(...this.renderPatternPanel());
    } else {
      lines.push(...this.renderStartPanel());
    }
    lines.push('', currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width));
  }

  private switchPanel(delta: number): void {
    const index = PANELS.indexOf(this.activePanel);
    this.activePanel = PANELS[(index + delta + PANELS.length) % PANELS.length]!;
    this.clampStartFocus();
  }

  private handleModelsInput(data: string): void {
    if (nativeFusionStrategy(this.pattern) !== undefined) {
      this.handleRolesInput(data);
      return;
    }
    // ↑/↓, PgUp/PgDn, and search typing.
    if (this.modelList.handleKey(data)) return;
    if (matchesKey(data, Key.enter)) {
      const row = this.modelList.selected();
      if (row === undefined) return;
      const index = this.selectedModels.indexOf(row.alias);
      if (index >= 0) {
        this.selectedModels.splice(index, 1);
      } else {
        this.selectedModels.push(row.alias);
      }
      return;
    }
    if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      this.cycleHighlightedModelEffort(matchesKey(data, Key.left) ? -1 : 1);
    }
  }

  private cycleHighlightedModelEffort(delta: number): void {
    const row = this.modelList.selected();
    if (row === undefined) return;
    if (this.selectedModels.length > 0 && !this.selectedModels.includes(row.alias)) return;
    if (row.model === undefined) return;
    const segments = segmentsFor(row.model);
    if (segments.length <= 1) return;
    const current = this.effectiveModelEffort(row);
    const index = segments.indexOf(current);
    let next: number;
    if (segments.length === 2) {
      next = index === 0 ? 1 : 0;
    } else {
      next = clampInt(index + delta, 0, segments.length - 1);
    }
    if (next === index) return;
    const effort = segments[next]!;
    this.modelThinking[row.alias] = effort;
    this.thinkingEffort = effort;
  }

  private effectiveModelEffort(row: ModelRow): string {
    const override = this.modelThinking[row.alias];
    if (override !== undefined) return override;
    if (row.model === undefined) return 'off';
    return defaultThinkingEffortFor(row.model);
  }

  private handlePatternInput(data: string): void {
    // ↑/↓ and PgUp/PgDn.
    if (this.patternList.handleKey(data)) return;
    if (matchesKey(data, Key.enter)) {
      const pattern = this.patternList.selected();
      if (pattern !== undefined) {
        this.pattern = pattern.id;
        this.refreshRoleList();
        this.startFocus = 'start_btn';
      }
    }
  }

  private roleRows(): FusionRoleRow[] {
    const rows: FusionRoleRow[] = nativeFusionStrategy(this.pattern) === 'idiot-boss'
      ? [{ id: 'worker', label: 'Coordinator' }, { id: 'coo', label: 'Implementer' }, { id: 'ceo', label: 'CEO on demand' }]
      : [{ id: 'ceo', label: 'CEO' }, { id: 'coo', label: 'COO' }, { id: 'worker', label: 'Worker' }];
    rows.push({ id: 'dual', label: 'Dual mode' });
    if (this.dual) rows.push({ id: 'muse', label: 'Consultant' });
    return rows;
  }

  private refreshRoleList(initialIndex = 0): void {
    this.roleList = new SearchableList({
      items: this.roleRows(),
      toSearchText: (row) => row.label,
      initialIndex,
    });
  }

  private handleRolesInput(data: string): void {
    if (this.roleList.handleKey(data)) return;
    const row = this.roleList.selected();
    if (row === undefined) return;
    if (row.id === 'dual') {
      if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
        this.dual = !this.dual;
        this.refreshRoleList(this.roleList.view().selectedIndex);
      }
      return;
    }
    if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      const aliases = ['', ...Object.keys(this.opts.models)];
      const index = aliases.indexOf(this.roles[row.id]?.model ?? '');
      const delta = matchesKey(data, Key.left) ? -1 : 1;
      const alias = aliases[(index + delta + aliases.length) % aliases.length]!;
      if (alias.length === 0) delete this.roles[row.id];
      else this.roles[row.id] = { model: alias };
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const assignment = this.roles[row.id];
      const models: ModelRow[] = [{ alias: '', name: '(config default)', provider: '' }, ...createModelRows(this.opts.models)];
      this.rolePicker = {
        role: row.id,
        list: new SearchableList({
          items: models,
          toSearchText: (model) => `${model.alias} ${model.name} ${model.provider}`,
          searchable: true,
          initialIndex: Math.max(0, models.findIndex((model) => model.alias === assignment?.model)),
        }),
        effort: assignment?.effort,
      };
    }
  }

  private roleEfforts(alias: string): readonly (string | undefined)[] {
    const model = this.opts.models[alias];
    return model === undefined ? [undefined] : [undefined, ...effortsOf(effectiveModelAlias(model)).filter((effort) => effort !== 'off')];
  }

  private handleRolePickerInput(data: string): void {
    const picker = this.rolePicker!;
    if (matchesKey(data, Key.escape)) {
      if (picker.list.clearQuery()) {
        picker.effort = undefined;
        return;
      }
      this.rolePicker = undefined;
      return;
    }
    const previousAlias = picker.list.selected()?.alias;
    if (picker.list.handleKey(data)) {
      if (picker.list.selected()?.alias !== previousAlias) picker.effort = undefined;
      return;
    }
    const model = picker.list.selected();
    if (model === undefined) return;
    if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      const efforts = this.roleEfforts(model.alias);
      const index = Math.max(0, efforts.indexOf(picker.effort));
      const delta = matchesKey(data, Key.left) ? -1 : 1;
      picker.effort = efforts[(index + delta + efforts.length) % efforts.length];
    } else if (matchesKey(data, Key.enter)) {
      if (model.alias.length === 0) delete this.roles[picker.role];
      else this.roles[picker.role] = { model: model.alias, effort: picker.effort };
      this.rolePicker = undefined;
    }
  }

  private renderRolesPanel(): string[] {
    if (this.rolePicker !== undefined) return this.renderRolePicker();
    const view = this.roleList.view();
    const lines = view.items.map((row, index) => {
      const selected = index === view.selectedIndex;
      const prefix = selected ? SELECT_POINTER : ' ';
      const label = `${prefix} ${row.label}`;
      const styledLabel = selected ? currentTheme.boldFg('primary', label) : currentTheme.fg('text', label);
      if (row.id === 'dual') {
        return `${styledLabel}  ${currentTheme.fg(this.dual ? 'success' : 'textDim', this.dual ? 'enabled' : 'disabled')}`;
      }
      return `${styledLabel}: ${currentTheme.fg('text', this.roleAssignmentLabel(row.id))}`;
    });
    if (this.modelCount === 0) lines.push(currentTheme.fg('textMuted', ' No models configured; engine defaults remain available.'));
    const focused = this.roleList.selected();
    if (focused !== undefined && focused.id !== 'dual') {
      const assignment = this.roles[focused.id];
      if (assignment !== undefined) {
        lines.push('', currentTheme.fg('textMuted', ' Effort  (Enter to pick · ←→ model)'));
        lines.push(currentTheme.fg('text', `  ${this.roleEffortChip(assignment.effort)}`));
      }
    }
    lines.push('', currentTheme.fg('textMuted', ' Legacy session model picks are ignored.'));
    return lines;
  }

  private roleEffortChip(effort: string | undefined): string {
    if (effort === undefined) return currentTheme.fg('textMuted', '[ default ]');
    return currentTheme.boldFg('primary', `[ ${effort} ]`);
  }

  private roleAssignmentLabel(role: FusionRole): string {
    const assignment = this.roles[role];
    if (assignment === undefined) return '(config default)';
    return assignment.model + (assignment.effort ? `@${assignment.effort}` : ' (default effort)');
  }

  private renderRolePicker(): string[] {
    const picker = this.rolePicker!;
    const view = picker.list.view();
    const lines: string[] = [];
    if (view.query.length > 0) lines.push(currentTheme.fg('primary', ' Search: ') + currentTheme.fg('text', view.query));
    for (let i = view.page.start; i < view.page.end; i++) {
      const row = view.items[i]!;
      const selected = i === view.selectedIndex;
      const label = `${selected ? SELECT_POINTER : ' '} ${row.name}${row.alias ? ` [${row.alias}]` : ''}`;
      lines.push(
        (selected ? currentTheme.boldFg('primary', label) : currentTheme.fg('text', label)) +
        currentTheme.fg('textMuted', row.provider ? `  ${row.provider}` : ''),
      );
    }
    if (view.items.length === 0) lines.push(currentTheme.fg('textMuted', ' No matches'));
    lines.push(currentTheme.fg('textMuted', ` Page ${view.page.page + 1} / ${view.page.pageCount} · ${view.items.length} / ${this.modelCount + 1}`));
    const model = picker.list.selected();
    if (model !== undefined) {
      lines.push('', currentTheme.fg('text', ' Effort: ') + this.roleEfforts(model.alias).map((effort) => {
        const label = effort ?? '(config default)';
        return effort === picker.effort ? currentTheme.boldFg('primary', `[${label}]`) : currentTheme.fg('textMuted', label);
      }).join('  '));
    }
    return lines;
  }

  private hasStartOptions(): boolean {
    return this.isCurrentPatternScriptForm() || this.pattern === 'moa';
  }

  private startRows(): StartFocus[] {
    if (this.pattern === 'moa') return ['layers', 'start_btn'];
    if (!this.isCurrentPatternScriptForm()) return ['start_btn'];
    const rows: StartFocus[] = ['captains'];
    if (this.pattern === 'hive') rows.push('children');
    if (this.pattern === 'metaloop') rows.push('layers');
    if (this.pattern === 'ultracode') rows.push('ultracode_verb');
    if (this.pattern === 'board') rows.push('board_verb');
    if (this.pattern === 'context') {
      rows.push('context_action');
      const action = this.formOptions.contextAction ?? 'list';
      if (action === 'get' || action === 'set' || action === 'clear') rows.push('context_key');
      if (action === 'set') rows.push('context_value');
    }
    rows.push('dry_run', 'start_btn');
    return rows;
  }

  private clampStartFocus(): void {
    const rows = this.startRows();
    if (!rows.includes(this.startFocus)) this.startFocus = 'start_btn';
  }

  private isTextStartFocus(): boolean {
    return this.startFocus === 'captains' || this.startFocus === 'context_key' || this.startFocus === 'context_value';
  }

  private activeStartInput(): Input | undefined {
    if (this.startFocus === 'captains') return this.captainsInput;
    if (this.startFocus === 'context_key') return this.contextKeyInput;
    if (this.startFocus === 'context_value') return this.contextValueInput;
    return undefined;
  }

  private moveInputCursorToEnd(input: Input): void {
    const len = input.getValue().length;
    for (let i = 0; i < len; i++) {
      input.handleInput(Key.right);
    }
  }

  private handleStartInput(data: string): void {
    const rows = this.startRows();
    const index = Math.max(0, rows.indexOf(this.startFocus));

    if (matchesKey(data, Key.up)) {
      this.startFocus = rows[Math.max(0, index - 1)]!;
      const input = this.activeStartInput();
      if (input !== undefined) this.moveInputCursorToEnd(input);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.startFocus = rows[Math.min(rows.length - 1, index + 1)]!;
      return;
    }

    if (this.hasStartOptions() && this.isTextStartFocus()) {
      if (matchesKey(data, Key.enter)) {
        this.startFocus = rows[Math.min(rows.length - 1, index + 1)]!;
        return;
      }
      this.activeStartInput()?.handleInput(data);
      return;
    }

    if (this.hasStartOptions()) {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
        this.cycleFocusedStartOption(matchesKey(data, Key.left) ? -1 : 1);
        return;
      }

      const char = printableChar(data)?.toLowerCase();
      if (char === 'd') {
        this.formOptions.dryRun = !this.formOptions.dryRun;
        return;
      }
      if (char === 'v' && this.pattern === 'ultracode') {
        this.formOptions.ultracodeVerb = cycleItem(ULTRACODE_VERBS, this.formOptions.ultracodeVerb, 1);
        return;
      }
      if (char === 'b' && this.pattern === 'board') {
        this.formOptions.boardVerb = cycleItem(BOARD_VERBS, this.formOptions.boardVerb ?? 'agents', 1);
        return;
      }
      if (char === 'a' && this.pattern === 'context') {
        this.formOptions.contextAction = cycleItem(CONTEXT_ACTIONS, this.formOptions.contextAction ?? 'list', 1);
        this.clampStartFocus();
        return;
      }
      if (this.pattern === 'hive') {
        const raw = printableChar(data);
        if (raw === '+' || raw === '=') {
          this.formOptions.childrenPerCaptain = clampInt(this.formOptions.childrenPerCaptain + 1, 1, 8);
          return;
        }
        if (raw === '-' || raw === '_') {
          this.formOptions.childrenPerCaptain = clampInt(this.formOptions.childrenPerCaptain - 1, 1, 8);
          return;
        }
        if (raw && raw >= '1' && raw <= '8') {
          this.formOptions.childrenPerCaptain = Number(raw);
          return;
        }
      }
      if (this.pattern === 'metaloop' || this.pattern === 'moa') {
        const raw = printableChar(data);
        if (raw === '+' || raw === '=') {
          this.formOptions.layers = clampInt(this.formOptions.layers + 1, 1, 4);
          return;
        }
        if (raw === '-' || raw === '_') {
          this.formOptions.layers = clampInt(this.formOptions.layers - 1, 1, 4);
          return;
        }
        if (raw && raw >= '1' && raw <= '4') {
          this.formOptions.layers = Number(raw);
          return;
        }
      }

      if (matchesKey(data, Key.space)) {
        if (this.startFocus === 'dry_run') {
          this.formOptions.dryRun = !this.formOptions.dryRun;
          return;
        }
        if (this.startFocus === 'ultracode_verb' || this.startFocus === 'board_verb' || this.startFocus === 'context_action') {
          this.cycleFocusedStartOption(1);
          return;
        }
      }
    }

    if (matchesKey(data, Key.enter)) {
      this.opts.onConfirm(this.selection());
    }
  }

  private cycleFocusedStartOption(delta: number): void {
    const target: StartFocus = this.startFocus === 'start_btn' ? this.primaryCycleRow() : this.startFocus;
    if (target === 'children') {
      this.formOptions.childrenPerCaptain = clampInt(this.formOptions.childrenPerCaptain + delta, 1, 8);
      return;
    }
    if (target === 'layers') {
      this.formOptions.layers = clampInt(this.formOptions.layers + delta, 1, 4);
      return;
    }
    if (target === 'dry_run') {
      this.formOptions.dryRun = !this.formOptions.dryRun;
      return;
    }
    if (target === 'ultracode_verb') {
      this.formOptions.ultracodeVerb = cycleItem(ULTRACODE_VERBS, this.formOptions.ultracodeVerb, delta);
      return;
    }
    if (target === 'board_verb') {
      this.formOptions.boardVerb = cycleItem(BOARD_VERBS, this.formOptions.boardVerb ?? 'agents', delta);
      return;
    }
    if (target === 'context_action') {
      this.formOptions.contextAction = cycleItem(CONTEXT_ACTIONS, this.formOptions.contextAction ?? 'list', delta);
      this.clampStartFocus();
    }
  }

  private primaryCycleRow(): StartFocus {
    if (this.pattern === 'hive') return 'children';
    if (this.pattern === 'metaloop' || this.pattern === 'moa') return 'layers';
    if (this.pattern === 'ultracode') return 'ultracode_verb';
    if (this.pattern === 'board') return 'board_verb';
    if (this.pattern === 'context') return 'context_action';
    return 'dry_run';
  }

  private selection(): SwarmConfigSelection {
    if (nativeFusionStrategy(this.pattern) !== undefined) {
      const roles = { ...this.roles };
      if (!this.dual) delete roles.muse;
      return { models: [], pattern: this.pattern, roles, dual: this.dual };
    }
    const fallback = this.opts.currentValue.trim().length > 0 ? [this.opts.currentValue] : [];
    const models = this.selectedModels.length > 0 ? [...this.selectedModels] : fallback;
    const modelThinking = this.chosenModelThinking(models);
    const thinkingEffort = this.thinkingEffort;
    if (this.hasStartOptions()) {
      if (modelThinking !== undefined) {
        return {
          models,
          pattern: this.pattern,
          formOptions: this.getEffectiveFormOptions(),
          modelThinking,
          thinkingEffort,
        };
      }
      return {
        models,
        pattern: this.pattern,
        formOptions: this.getEffectiveFormOptions(),
      };
    }
    if (modelThinking !== undefined) {
      return {
        models,
        pattern: this.pattern,
        modelThinking,
        thinkingEffort,
      };
    }
    return {
      models,
      pattern: this.pattern,
    };
  }

  private chosenModelThinking(models: readonly string[]): Record<string, string> | undefined {
    const next: Record<string, string> = {};
    for (const alias of models) {
      const effort = this.modelThinking[alias];
      if (effort !== undefined) next[alias] = effort;
    }
    return Object.keys(next).length > 0 ? next : undefined;
  }

  setCaptains(captains: string): void {
    this.captainsInput.setValue(captains);
  }

  private getEffectiveFormOptions(): SwarmFormOptions {
    const raw = this.captainsInput.getValue().trim();
    const parsed = raw.length > 0
      ? raw
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is FusionProviderId => FUSION_PROVIDERS.some((p) => p.id === s))
      : [];
    const captains = parsed.length > 0 ? parsed : this.formOptions.captains;
    const contextKey = this.contextKeyInput.getValue().trim();
    const contextValue = this.contextValueInput.getValue().trim();
    return {
      captains,
      childrenPerCaptain: this.formOptions.childrenPerCaptain,
      layers: this.formOptions.layers,
      dryRun: this.formOptions.dryRun,
      ultracodeVerb: this.formOptions.ultracodeVerb,
      thinkingEffort: this.thinkingEffort,
      boardVerb: this.pattern === 'board' ? this.formOptions.boardVerb ?? 'agents' : undefined,
      boardDb: this.formOptions.boardDb,
      contextAction: this.pattern === 'context' ? this.formOptions.contextAction ?? 'list' : undefined,
      contextKey: contextKey.length > 0 ? contextKey : undefined,
      contextValue: contextValue.length > 0 ? contextValue : undefined,
    };
  }

  private isCurrentPatternScriptForm(): boolean {
    return SWARM_PATTERNS.find((p) => p.id === this.pattern)?.form === 'script';
  }

  private renderTitle(): string {
    if (this.rolePicker !== undefined) {
      const role = this.roleRows().find((row) => row.id === this.rolePicker!.role)!;
      const suffix = this.rolePicker.list.view().query ? '' : currentTheme.fg('textMuted', '  (type to search)');
      return ` Fusion roles — ${role.label}` + suffix;
    }
    if (this.activePanel === 'models' && nativeFusionStrategy(this.pattern) !== undefined) return ' Fusion roles';
    const title = ' Swarm configuration';
    const query = this.activePanel === 'models' ? this.modelList.view().query : '';
    if (this.activePanel !== 'models' || query.length > 0) return title;
    return title + currentTheme.fg('textMuted', '  (type to search)');
  }

  private renderHint(): string {
    if (this.rolePicker !== undefined) {
      return '↑↓ navigate · PgUp/PgDn page · ←→ effort · Enter select · Esc cancel';
    }
    if (this.activePanel === 'models' && nativeFusionStrategy(this.pattern) !== undefined) {
      return 'Tab switch panel · ↑↓ navigate · ←→ effort · Enter select · Space toggle dual · Esc cancel';
    }
    const parts: string[] = ['Tab switch panel', '↑↓ navigate', '←→ effort'];
    if (this.activePanel === 'models') {
      if (this.modelList.view().query.length > 0) parts.push('Backspace clear');
      parts.push('Enter toggle', 'Esc cancel');
    } else if (this.activePanel === 'pattern') {
      parts.push('Enter select', 'Esc cancel');
    } else {
      parts.push('Enter start', 'Esc cancel');
    }
    return parts.join(' · ');
  }

  private renderModelsPanel(width: number): string[] {
    if (nativeFusionStrategy(this.pattern) !== undefined) return this.renderRolesPanel();
    const view = this.modelList.view();
    const lines: string[] = [];
    if (view.query.length > 0) {
      lines.push(currentTheme.fg('primary', ' Search: ') + currentTheme.fg('text', view.query));
    }

    if (view.items.length === 0) {
      lines.push(
        currentTheme.fg(
          'textMuted',
          view.query.length > 0 ? '   No matches' : '   No models configured',
        ),
      );
    } else {
      // Column width for model names so the provider column lines up, capped
      // so the provider + current marker still fit (mirrors model-selector).
      const nameCap = Math.max(8, Math.floor(width * 0.5));
      let nameWidth = 0;
      for (let i = view.page.start; i < view.page.end; i++) {
        const row = view.items[i];
        if (row !== undefined) nameWidth = Math.max(nameWidth, visibleWidth(row.name));
      }
      nameWidth = Math.min(nameWidth, nameCap);

      for (let i = view.page.start; i < view.page.end; i++) {
        const row = view.items[i];
        if (row === undefined) continue;
        const isSelected = i === view.selectedIndex;
        const isChosen = this.selectedModels.includes(row.alias);
        const isCurrent = row.alias === this.opts.currentValue;
        const pointer = isSelected ? SELECT_POINTER : ' ';
        const check = isChosen ? currentTheme.fg('success', SUCCESS_MARK) : '  ';
        const truncatedName = truncateToWidth(row.name, nameWidth, '…');
        const namePad = ' '.repeat(Math.max(0, nameWidth - visibleWidth(truncatedName)));
        let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
        line += check;
        line +=
          (isSelected
            ? currentTheme.boldFg('primary', truncatedName)
            : currentTheme.fg('text', truncatedName)) + namePad;
        line += '  ' + currentTheme.fg('textMuted', row.provider);
        if (isCurrent) {
          line += ' ' + currentTheme.fg('success', CURRENT_MARK);
        }
        lines.push(line);
      }

      // Scroll / match indicator.
      if (view.query.length > 0) {
        lines.push('');
        lines.push(
          currentTheme.fg('textMuted', ` ${String(view.items.length)} / ${String(this.modelCount)}`),
        );
      } else {
        const below = view.items.length - view.page.end;
        if (below > 0) {
          lines.push('');
          lines.push(currentTheme.fg('textMuted', ` ▼ ${String(below)} more`));
        }
      }
    }

    const highlighted = this.modelList.selected();
    if (highlighted !== undefined) {
      lines.push('');
      const canSwitch = highlighted.model !== undefined && segmentsFor(highlighted.model).length > 1;
      const thinkingHeader = canSwitch ? ' Thinking  (←→ to switch)' : ' Thinking';
      lines.push(currentTheme.fg('textMuted', thinkingHeader));
      lines.push(this.renderThinkingControl(highlighted));
    }

    lines.push('');
    lines.push(this.renderSelectionFooter(width));
    return lines;
  }

  private renderThinkingControl(row: ModelRow): string {
    if (row.model === undefined) return currentTheme.fg('textMuted', '  unsupported');
    const segment = (label: string, active: boolean): string =>
      active
        ? currentTheme.boldFg('primary', `[ ${label} ]`)
        : currentTheme.fg('text', `  ${label}  `);
    const segments = segmentsFor(row.model);
    const active = this.effectiveModelEffort(row);
    const rendered = segments.map((effort) => segment(effortLabel(effort), effort === active));
    return `  ${rendered.join('  ')}`;
  }

  private renderSelectionFooter(width: number): string {
    if (nativeFusionStrategy(this.pattern) !== undefined) {
      return currentTheme.fg('textMuted', ' Native role preset — session model picks are ignored.');
    }
    if (this.selectedModels.length === 0) {
      const current = modelDisplayName(
        this.opts.currentValue,
        this.opts.models[this.opts.currentValue],
      );
      const text =
        current.length > 0
          ? ` Selected: none — the current model (${current}) will be used`
          : ' Selected: none — no model configured';
      return currentTheme.fg('textMuted', truncateToWidth(text, width));
    }
    return currentTheme.fg(
      'success',
      truncateToWidth(` ${SUCCESS_MARK}Selected: ${this.selectedModels.join(', ')}`, width),
    );
  }

  private renderPatternPanel(): string[] {
    const view = this.patternList.view();
    const lines: string[] = [];
    let lastGroup: PatternGroup | undefined;
    if (view.page.start > 0) {
      const previous = view.items[view.page.start - 1];
      if (previous !== undefined) lastGroup = patternGroup(previous);
    }
    for (let i = view.page.start; i < view.page.end; i++) {
      const pattern = view.items[i];
      if (pattern === undefined) continue;
      const group = patternGroup(pattern);
      if (group !== lastGroup) {
        lines.push(currentTheme.boldFg('text', ` ${group}`));
        lastGroup = group;
      }
      const isSelected = i === view.selectedIndex;
      const isChosen = pattern.id === this.pattern;
      const pointer = isSelected ? SELECT_POINTER : ' ';
      let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
      line += isSelected
        ? currentTheme.boldFg('primary', pattern.label)
        : currentTheme.fg('text', pattern.label);
      line += ' ' + this.renderFormBadge(group);
      if (pattern.badge !== group) {
        line += ' ' + currentTheme.fg('textMuted', pattern.badge);
      }
      if (isChosen) {
        line += ' ' + currentTheme.fg('success', CURRENT_MARK);
      }
      lines.push(line);
      if (isSelected) {
        lines.push(currentTheme.fg('textMuted', `    ${pattern.description}`));
      }
    }
    const below = view.items.length - view.page.end;
    if (below > 0) {
      lines.push('');
      lines.push(currentTheme.fg('textMuted', ` ▼ ${String(below)} more`));
    }
    const activePatternId = view.items[view.selectedIndex]?.id ?? this.pattern;
    if (SWARM_PATTERNS.find((p) => p.id === activePatternId)?.form === 'script' || activePatternId === 'moa') {
      lines.push('');
      lines.push(...this.renderCompactOptionsRow(activePatternId));
    }
    return lines;
  }

  private renderFormBadge(group: PatternGroup): string {
    const token = group === 'Native' ? 'success' : group === 'Script' ? 'warning' : 'textMuted';
    return currentTheme.fg(token, `[${group}]`);
  }

  private renderCompactOptionsRow(patternId: SwarmPattern = this.pattern): string[] {
    const parts: string[] = [];
    if (SWARM_PATTERNS.find((p) => p.id === patternId)?.form === 'script') {
      const isCaptainsFocused = this.activePanel === 'start' && this.startFocus === 'captains';
      const captainsVal = this.captainsInput.getValue().trim() || this.formOptions.captains.join(',');
      const captainsDisplay = isCaptainsFocused
        ? currentTheme.boldFg('primary', `[${captainsVal}]`)
        : currentTheme.fg('text', `[${captainsVal}]`);
      parts.push(
        currentTheme.fg('textMuted', 'Captains:') + ' ' + captainsDisplay,
      );
    }

    if (patternId === 'hive') {
      parts.push(
        currentTheme.fg('textMuted', 'Children:') +
          ' ' +
          currentTheme.fg('text', String(this.formOptions.childrenPerCaptain)),
      );
    }

    if (patternId === 'metaloop' || patternId === 'moa') {
      parts.push(
        currentTheme.fg('textMuted', 'Layers:') +
          ' ' +
          currentTheme.fg('text', String(this.formOptions.layers)),
      );
    }

    if (patternId === 'ultracode') {
      parts.push(
        currentTheme.fg('textMuted', 'Verb:') +
          ' ' +
          currentTheme.fg('text', this.formOptions.ultracodeVerb),
      );
    }

    if (patternId === 'ultraswarm') {
      parts.push(currentTheme.fg('textMuted', 'Five-agent council'));
    }

    if (patternId === 'board') {
      parts.push(
        currentTheme.fg('textMuted', 'Board:') +
          ' ' +
          currentTheme.fg('text', this.formOptions.boardVerb ?? 'agents'),
      );
    }

    if (patternId === 'context') {
      parts.push(
        currentTheme.fg('textMuted', 'Context:') +
          ' ' +
          currentTheme.fg('text', this.formOptions.contextAction ?? 'list'),
      );
    }

    if (SWARM_PATTERNS.find((p) => p.id === patternId)?.form === 'script') {
      const dryRunLabel = this.formOptions.dryRun
        ? currentTheme.fg('success', 'enabled')
        : currentTheme.fg('textDim', 'disabled');
      parts.push(
        currentTheme.fg('textMuted', 'Dry run:') + ' ' + dryRunLabel,
      );
    }

    return [
      currentTheme.boldFg('text', ' Options:') + ' ' + parts.join(currentTheme.fg('textMuted', ' · ')),
    ];
  }

  private renderStartOptionRow(id: StartFocus, label: string, value: string): string {
    const selected = this.startFocus === id;
    const pointer = selected ? SELECT_POINTER : ' ';
    const prefix = currentTheme.fg(selected ? 'primary' : 'textDim', `  ${pointer} `);
    const name = selected ? currentTheme.boldFg('primary', label) : currentTheme.fg('text', label);
    return `${prefix}${name} ${value}`;
  }

  private renderStartPanel(): string[] {
    const allPatterns = SWARM_PATTERNS;
    const pattern = allPatterns.find((p) => p.id === this.pattern) ?? allPatterns[0]!;
    const aliases =
      this.selectedModels.length > 0 ? [...this.selectedModels] : [this.opts.currentValue];
    const names = aliases
      .filter((alias) => alias.trim().length > 0)
      .map((alias) => modelDisplayName(alias, this.opts.models[alias]));

    const lines: string[] = [
      currentTheme.fg('textMuted', ' Pattern:') + ' ' + currentTheme.boldFg('text', pattern.label) +
        ' ' + this.renderFormBadge(patternGroup(pattern)),
    ];
    const strategy = nativeFusionStrategy(this.pattern);
    if (strategy !== undefined) {
      lines.push(currentTheme.fg('text', ' Models: Native role preset (engine-owned)'));
      for (const row of this.roleRows()) {
        if (row.id === 'dual') lines.push(currentTheme.fg('text', ` Dual mode: ${this.dual ? 'enabled' : 'disabled'}`));
        else lines.push(currentTheme.fg('text', ` ${row.label}: ${this.roleAssignmentLabel(row.id)}`));
      }
      lines.push('', currentTheme.fg('textMuted', ' Default preset (unless overridden above):'));
      if (strategy === 'genius-boss') {
        lines.push(
          currentTheme.fg('text', ' Astra CEO / Opus 5.5 COO; bounded delegation.'),
          currentTheme.fg('text', ' Opus owns design, implementation and review.'),
        );
      } else {
        lines.push(
          currentTheme.fg('text', ' Coordinator: GPT-6 Luna high'),
          currentTheme.fg('textMuted', ' Coordinator fallback: Flash / Muse / Terra'),
          currentTheme.fg('text', ' Persistent Opus 5.5 implements continuously.'),
          currentTheme.fg('text', ' Astra on demand for consequential review.'),
        );
      }
      lines.push(
        currentTheme.fg('textMuted', ' Session model picks are ignored.'),
        currentTheme.fg('textMuted', ' Strategy fixed for team lifetime; changes are rejected.'),
        currentTheme.fg('textMuted', ' Role assignments are fixed for team lifetime.'),
      );
    } else if (names.length === 0) {
      lines.push(
        currentTheme.fg('textMuted', ' Models:') + ' ' + currentTheme.fg('textMuted', '(none)'),
      );
    } else {
      const suffix =
        this.selectedModels.length === 0 ? ' ' + currentTheme.fg('success', CURRENT_MARK) : '';
      lines.push(
        currentTheme.fg('textMuted', ' Models:') +
          ' ' +
          currentTheme.fg('text', names.join(', ')) +
          suffix,
      );
      if (this.thinkingEffort !== undefined) {
        lines.push(currentTheme.fg('textMuted', ' Effort:') + ' ' + currentTheme.fg('text', this.thinkingEffort));
      }
    }
    if (strategy === undefined && this.hasStartOptions()) {
      lines.push('', ...this.renderCompactOptionsRow());
      if (this.pattern === 'ultraswarm') {
        lines.push(currentTheme.fg('textMuted', '  Five-agent council via ultraswarm.sh — discover roster or run a task.'));
      }
      if (this.pattern === 'moa') {
        const layersDisplay = this.startFocus === 'layers'
          ? currentTheme.boldFg('primary', String(this.formOptions.layers))
          : currentTheme.fg('text', String(this.formOptions.layers));
        lines.push(this.renderStartOptionRow('layers', 'Layers:', layersDisplay));
      }
      if (this.pattern === 'context') {
        const action = this.formOptions.contextAction ?? 'list';
        if (action === 'get' || action === 'set' || action === 'clear') {
          const key = this.contextKeyInput.getValue().trim() || '(none)';
          lines.push(this.renderStartOptionRow('context_key', 'Key:', currentTheme.fg('text', key)));
        }
        if (action === 'set') {
          const value = this.contextValueInput.getValue().trim() || '(none)';
          lines.push(this.renderStartOptionRow('context_value', 'Value:', currentTheme.fg('text', value)));
        }
      }
    }
    const startSelected = this.startFocus === 'start_btn';
    lines.push(
      '',
      (startSelected
        ? currentTheme.fg('primary', `  ${SELECT_POINTER} `) + currentTheme.boldFg('primary', START_ACTION)
        : currentTheme.fg('textDim', `    ${START_ACTION}`)),
    );
    return lines;
  }
}
