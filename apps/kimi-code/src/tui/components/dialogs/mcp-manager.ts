/**
 * McpManagerComponent — interactive manager for the user's global MCP
 * servers (Claude-Code-style `/mcp`): a list of `~/.kimi-code/mcp.json`
 * entries with per-row actions — add (`a`), edit (`e`), remove (`d`, press
 * twice to confirm), toggle enabled (`t`), and the read-only status report
 * (`s`). The component owns no RPC: every mutation goes through the
 * `McpManagerCallbacks`, and the returned server list replaces the rows.
 * Add/edit switches the same component into a small form (transport cycles
 * with ←/→; text fields use pi-tui `Input`; Enter advances, submits on the
 * last field) matching the custom-registry dialog's geometry. The server
 * name is the entry's identity — created on add, immutable on edit.
 */

import type { McpServerConfig } from '@moonshot-ai/kimi-code-sdk';
import {
  Container,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '@moonshot-ai/pi-tui';

import { currentTheme } from '#/tui/theme';

export interface McpManagerCallbacks {
  list(): Promise<readonly McpServerConfig[]>;
  add(server: McpServerConfig): Promise<readonly McpServerConfig[]>;
  update(server: McpServerConfig): Promise<readonly McpServerConfig[]>;
  remove(name: string): Promise<readonly McpServerConfig[]>;
}

export interface McpManagerOptions {
  readonly servers: readonly McpServerConfig[];
  readonly callbacks: McpManagerCallbacks;
  /** `s` key: surface the read-only status report the old /mcp showed. */
  readonly onShowStatus?: () => void;
  readonly onClose: () => void;
}

type Mode = 'list' | 'form' | 'removing';
type Transport = 'stdio' | 'http' | 'sse';

type FormFieldId = 'transport' | 'name' | 'target' | 'args' | 'env' | 'bearer';

const FORM_FIELDS: Record<Transport, readonly FormFieldId[]> = {
  stdio: ['transport', 'name', 'target', 'args', 'env'],
  http: ['transport', 'name', 'target', 'bearer'],
  sse: ['transport', 'name', 'target', 'bearer'],
};

const FIELD_LABELS: Record<FormFieldId, string> = {
  transport: 'Transport',
  name: 'Name',
  target: 'Command (stdio)',
  args: 'Args (space-separated)',
  env: 'Env (KEY=VALUE pairs)',
  bearer: 'Bearer token env var (optional)',
};

const TRANSPORTS: readonly Transport[] = ['stdio', 'http', 'sse'];

/** Terminal End key — moves a seeded Input's cursor to the line end. */
const END_KEY = '\u001B[F';

function serverTarget(server: McpServerConfig): string {
  if (server.transport === 'stdio') {
    const args = server.args ?? [];
    return [server.command, ...args].join(' ');
  }
  return server.url;
}

function serverTransport(server: McpServerConfig): Transport {
  return server.transport;
}

function envText(record: Record<string, string> | undefined): string {
  if (record === undefined) return '';
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

function parseKeyValuePairs(text: string): Record<string, string> | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const pair of trimmed.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export class McpManagerComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: McpManagerOptions;
  private servers: readonly McpServerConfig[];
  private mode: Mode = 'list';
  private selectedIndex = 0;
  private error: string | undefined;
  private busy = false;

  // Form state.
  private editingName: string | undefined;
  private formTransport: Transport = 'stdio';
  private formIndex = 0;
  private readonly nameInput = new Input();
  private readonly targetInput = new Input();
  private readonly argsInput = new Input();
  private readonly envInput = new Input();
  private readonly bearerInput = new Input();

  constructor(opts: McpManagerOptions) {
    super();
    this.opts = opts;
    this.servers = [...opts.servers];
  }

  /** Replace the server list (host pushes the first loaded snapshot). */
  setServers(servers: readonly McpServerConfig[]): void {
    this.servers = [...servers];
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.servers.length - 1));
  }

  handleInput(data: string): void {
    if (this.busy) return;
    if (matchesKey(data, Key.escape)) {
      if (this.mode === 'form') {
        this.mode = 'list';
        return;
      }
      if (this.mode === 'removing') {
        this.mode = 'list';
        return;
      }
      this.opts.onClose();
      return;
    }
    if (this.mode === 'form') {
      this.handleFormInput(data);
      return;
    }
    this.handleListInput(data);
  }

  override render(width: number): string[] {
    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ' Manage MCP servers'),
      currentTheme.fg(
        'textMuted',
        this.mode === 'form'
          ? ' Tab/↑↓ fields · ←→ change transport · Enter next/submit · Esc back'
          : ' ↑↓ navigate · a add · e edit · d remove · t toggle · s status · Esc close',
      ),
      '',
    ];
    if (this.error !== undefined) {
      lines.push(currentTheme.fg('warning', ` ${this.error}`), '');
    }
    if (this.mode === 'form') {
      lines.push(...this.renderForm(width));
    } else {
      lines.push(...this.renderList(width));
    }
    lines.push('', currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width));
  }

  // ---- list mode ----------------------------------------------------------

  private handleListInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(Math.max(0, this.servers.length - 1), this.selectedIndex + 1);
      return;
    }
    if (data === 'a') {
      this.startAdd();
      return;
    }
    if (this.servers.length === 0) return;
    const server = this.servers[Math.min(this.selectedIndex, this.servers.length - 1)];
    if (server === undefined) return;
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      this.startEdit(server);
      return;
    }
    if (data === 'e') {
      this.startEdit(server);
      return;
    }
    if (data === 'd') {
      if (this.mode === 'removing') {
        void this.mutate(async () => this.opts.callbacks.remove(server.name));
      } else {
        this.mode = 'removing';
      }
      return;
    }
    if (data === 't') {
      void this.mutate(async () =>
        this.opts.callbacks.update({ ...server, enabled: server.enabled !== true }),
      );
      return;
    }
    if (data === 's') {
      this.opts.onShowStatus?.();
    }
  }

  private renderList(width: number): string[] {
    if (this.servers.length === 0) {
      return [
        currentTheme.fg('textMuted', '  No MCP servers configured.'),
        currentTheme.fg('textMuted', '  Press a to add one.'),
      ];
    }
    const lines: string[] = [];
    for (let i = 0; i < this.servers.length; i++) {
      const server = this.servers[i]!;
      const selected = i === this.selectedIndex;
      const disabled = server.enabled === false;
      const removing = this.mode === 'removing' && selected;
      const pointer = selected ? '›' : ' ';
      const dim = disabled || removing;
      let line = currentTheme.fg(selected ? 'primary' : 'textDim', `  ${pointer} `);
      const label = `${server.name}  ${serverTransport(server)}  ${serverTarget(server)}${disabled ? '  (disabled)' : ''}${removing ? '  — press d again to remove' : ''}`;
      line += dim
        ? currentTheme.fg('textMuted', truncateToWidth(label, Math.max(0, width - 4), '…'))
        : currentTheme.fg('text', truncateToWidth(label, Math.max(0, width - 4), '…'));
      lines.push(line);
    }
    return lines;
  }

  // ---- form mode ----------------------------------------------------------

  private startAdd(): void {
    this.editingName = undefined;
    this.formTransport = 'stdio';
    this.formIndex = 0;
    for (const input of [this.nameInput, this.targetInput, this.argsInput, this.envInput, this.bearerInput]) {
      input.setValue('');
    }
    this.mode = 'form';
  }

  private startEdit(server: McpServerConfig): void {
    this.editingName = server.name;
    this.formTransport = serverTransport(server);
    this.formIndex = 0;
    this.nameInput.setValue(server.name);
    this.targetInput.setValue(server.transport === 'stdio' ? server.command : server.url);
    this.argsInput.setValue(server.transport === 'stdio' ? (server.args ?? []).join(' ') : '');
    this.envInput.setValue(server.transport === 'stdio' ? envText(server.env) : '');
    this.bearerInput.setValue(
      server.transport !== 'stdio' && server.bearerTokenEnvVar !== undefined
        ? server.bearerTokenEnvVar
        : '',
    );
    // setValue keeps the cursor at 0; move it to the line end so typing
    // appends instead of prefixing.
    for (const input of [this.nameInput, this.targetInput, this.argsInput, this.envInput, this.bearerInput]) {
      input.handleInput(END_KEY);
    }
    this.mode = 'form';
  }

  private fields(): readonly FormFieldId[] {
    return FORM_FIELDS[this.formTransport];
  }

  private handleFormInput(data: string): void {
    const fields = this.fields();
    const field = fields[this.formIndex]!;
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) {
      this.formIndex = (this.formIndex + 1) % fields.length;
      return;
    }
    if (matchesKey(data, Key.shift('tab')) || matchesKey(data, Key.up)) {
      this.formIndex = (this.formIndex - 1 + fields.length) % fields.length;
      return;
    }
    if (field === 'transport') {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
        const delta = matchesKey(data, Key.right) ? 1 : -1;
        const index = TRANSPORTS.indexOf(this.formTransport);
        this.formTransport = TRANSPORTS[(index + delta + TRANSPORTS.length) % TRANSPORTS.length]!;
        this.formIndex = 0;
      }
      return;
    }
    const input = this.inputFor(field);
    if (input === undefined) return;
    input.onSubmit = () => {
      if (this.formIndex === fields.length - 1) this.submitForm();
      else this.formIndex += 1;
    };
    input.handleInput(data);
  }

  private inputFor(field: FormFieldId): Input | undefined {
    switch (field) {
      case 'transport':
        return undefined;
      case 'name':
        return this.editingName === undefined ? this.nameInput : undefined;
      case 'target':
        return this.targetInput;
      case 'args':
        return this.argsInput;
      case 'env':
        return this.envInput;
      case 'bearer':
        return this.bearerInput;
      default:
        return undefined;
    }
  }

  private submitForm(): void {
    const transport = this.formTransport;
    const target = this.targetInput.getValue().trim();
    if (transport === 'stdio' && target.length === 0) {
      this.error = 'Command is required for stdio servers.';
      return;
    }
    if (transport !== 'stdio' && !isHttpUrl(target)) {
      this.error = 'http/sse servers need a valid http(s) URL.';
      return;
    }
    const name = this.editingName ?? this.nameInput.getValue().trim();
    if (name.length === 0) {
      this.error = 'Name is required.';
      return;
    }
    const isEdit = this.editingName !== undefined;
    const conflicting = this.servers.some((server) => server.name === name);
    if (!isEdit && conflicting) {
      this.error = `A server named "${name}" already exists.`;
      return;
    }
    const base =
      transport === 'stdio'
        ? {
            transport,
            command: target,
            ...(this.argsInput.getValue().trim().length > 0
              ? { args: this.argsInput.getValue().trim().split(/\s+/) }
              : {}),
            ...(parseKeyValuePairs(this.envInput.getValue()) !== undefined
              ? { env: parseKeyValuePairs(this.envInput.getValue()) }
              : {}),
          }
        : {
            transport,
            url: target,
            ...(this.bearerInput.getValue().trim().length > 0
              ? { bearerTokenEnvVar: this.bearerInput.getValue().trim() }
              : {}),
          };
    const preserved = isEdit
      ? (() => {
          const previous = this.servers.find((server) => server.name === this.editingName);
          if (previous === undefined || previous.enabled === undefined) return {};
          return { enabled: previous.enabled };
        })()
      : {};
    const server = { name, ...preserved, ...base } as McpServerConfig;
    void this.mutate(async () => (isEdit ? this.opts.callbacks.update(server) : this.opts.callbacks.add(server)));
    this.mode = 'list';
  }

  private renderForm(width: number): string[] {
    const lines: string[] = [];
    const fields = this.fields();
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!;
      const active = i === this.formIndex;
      const marker = active ? '› ' : '  ';
      if (field === 'name' && this.editingName !== undefined) {
        lines.push(
          currentTheme.fg('textMuted', `${marker}${FIELD_LABELS[field]}  ${this.editingName} (identity, immutable)`),
        );
        continue;
      }
      if (field === 'transport') {
        const rendered = TRANSPORTS.map((transport) =>
          transport === this.formTransport
            ? currentTheme.boldFg('primary', `[ ${transport} ]`)
            : currentTheme.fg('text', `  ${transport}  `),
        ).join('');
        lines.push(
          currentTheme.fg(active ? 'primary' : 'textDim', `${marker}${FIELD_LABELS[field]}`),
          `  ${rendered}`,
        );
        continue;
      }
      const input = this.inputFor(field);
      lines.push(currentTheme.fg(active ? 'primary' : 'textDim', `${marker}${FIELD_LABELS[field]}`));
      if (input !== undefined) {
        const fieldLines = input.render(Math.max(10, width - 8));
        lines.push(`  ${currentTheme.fg('text', fieldLines.join(''))}`);
      }
    }
    return lines;
  }

  // ---- shared -------------------------------------------------------------

  private async mutate(action: () => Promise<readonly McpServerConfig[]>): Promise<void> {
    this.busy = true;
    this.error = undefined;
    try {
      const servers = await action();
      this.servers = [...servers];
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.servers.length - 1));
      this.mode = 'list';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.mode = 'list';
    } finally {
      this.busy = false;
    }
  }

  override invalidate(): void {
    super.invalidate();
  }
}
