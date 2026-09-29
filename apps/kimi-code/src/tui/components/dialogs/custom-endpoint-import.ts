/**
 * CustomEndpointImportDialog — collects a provider name, OpenAI- or
 * Anthropic-compatible endpoint URL, and API key, then returns them to the
 * host. Geometry matches CustomRegistryImportDialogComponent.
 */

import {
  Container,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@moonshot-ai/pi-tui';

import { currentTheme } from '#/tui/theme';

export interface CustomEndpointImportValue {
  readonly name: string;
  readonly endpoint: string;
  readonly apiKey: string;
}

export type CustomEndpointImportResult =
  | { readonly kind: 'ok'; readonly value: CustomEndpointImportValue }
  | { readonly kind: 'cancel' };

type FieldId = 'name' | 'endpoint' | 'token';
type HintId = 'none' | 'name-empty' | 'endpoint-empty' | 'token-empty';

const FOOTER_NOT_LAST = 'Tab / ↑↓ to switch  ·  Enter for next field  ·  Esc to cancel';
const FOOTER_LAST = 'Tab / ↑↓ to switch  ·  Enter to submit  ·  Esc to cancel';

function maskInputLine(raw: string): string {
  const prefix = '> ';
  if (!raw.startsWith(prefix)) return raw;

  let end = raw.length;
  while (end > prefix.length && raw[end - 1] === ' ') {
    end--;
  }
  const padding = raw.slice(end);
  const content = raw.slice(prefix.length, end);

  const parts = content.split(/(\u001B(?:\[[0-9;]*m|_pi:c\u0007))/);
  const maskedContent = parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replaceAll(/[^ ]/g, '•');
    })
    .join('');

  return prefix + maskedContent + padding;
}

export class CustomEndpointImportDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly nameInput = new Input();
  private readonly endpointInput = new Input();
  private readonly tokenInput = new Input();
  private readonly onDone: (result: CustomEndpointImportResult) => void;
  private readonly title: string;
  private readonly subtitleDefault: string;
  private activeField: FieldId = 'name';
  private done = false;
  private hint: HintId = 'none';

  constructor(
    onDone: (result: CustomEndpointImportResult) => void,
    options: {
      readonly title: string;
      readonly subtitle: string;
      readonly defaultEndpoint?: string;
    },
  ) {
    super();
    this.onDone = onDone;
    this.title = options.title;
    this.subtitleDefault = options.subtitle;
    if (options.defaultEndpoint !== undefined && options.defaultEndpoint.length > 0) {
      this.endpointInput.setValue(options.defaultEndpoint);
    }
    this.nameInput.onSubmit = () => {
      this.focusField('endpoint');
    };
    this.endpointInput.onSubmit = () => {
      this.focusField('token');
    };
    this.tokenInput.onSubmit = () => {
      this.handleSubmit();
    };
  }

  handleInput(data: string): void {
    if (this.done) return;
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c')) ||
      matchesKey(data, Key.ctrl('d'))
    ) {
      this.cancel();
      return;
    }

    if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift('tab'))) {
      this.cycleField(matchesKey(data, Key.shift('tab')) ? -1 : 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.cycleField(1);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.cycleField(-1);
      return;
    }

    if (this.hint !== 'none') {
      this.hint = 'none';
    }

    this.activeInput().handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    this.nameInput.invalidate();
    this.endpointInput.invalidate();
    this.tokenInput.invalidate();
  }

  override render(width: number): string[] {
    const dialogActive = this.focused && !this.done;
    this.nameInput.focused = dialogActive && this.activeField === 'name';
    this.endpointInput.focused = dialogActive && this.activeField === 'endpoint';
    this.tokenInput.focused = dialogActive && this.activeField === 'token';

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);
    const pad = '  ';

    const border = (s: string): string => currentTheme.fg('primary', s);
    const titleStyled = currentTheme.boldFg('textStrong', this.title);
    const subtitleText =
      this.hint === 'name-empty'
        ? 'Provider name cannot be empty.'
        : this.hint === 'endpoint-empty'
          ? 'Endpoint URL cannot be empty.'
          : this.hint === 'token-empty'
            ? 'API key cannot be empty.'
            : this.subtitleDefault;
    const subtitleStyled = currentTheme.fg('textDim', subtitleText);
    const footerStyled = currentTheme.fg(
      'textDim',
      this.activeField === 'token' ? FOOTER_LAST : FOOTER_NOT_LAST,
    );

    const nameLabel = this.fieldLabel('Provider name', 'name');
    const endpointLabel = this.fieldLabel('Endpoint URL', 'endpoint');
    const tokenLabel = this.fieldLabel('API key', 'token');

    const titleLine = truncateToWidth(titleStyled, innerWidth, '…');
    const subtitleLine = truncateToWidth(subtitleStyled, innerWidth, '…');
    const footerLine = truncateToWidth(footerStyled, innerWidth, '…');
    const nameLabelLine = truncateToWidth(nameLabel, innerWidth, '…');
    const endpointLabelLine = truncateToWidth(endpointLabel, innerWidth, '…');
    const tokenLabelLine = truncateToWidth(tokenLabel, innerWidth, '…');
    const nameInputLine = this.nameInput.render(innerWidth)[0] ?? '> ';
    const endpointInputLine = this.endpointInput.render(innerWidth)[0] ?? '> ';
    const tokenInputLine = maskInputLine(this.tokenInput.render(innerWidth)[0] ?? '> ');

    const contentLines: string[] = [
      titleLine,
      '',
      subtitleLine,
      '',
      nameLabelLine,
      nameInputLine,
      '',
      endpointLabelLine,
      endpointInputLine,
      '',
      tokenLabelLine,
      tokenInputLine,
      '',
      footerLine,
    ];

    if (safeWidth < 4) {
      return ['', ...contentLines.map((line) => truncateToWidth(line, safeWidth, '…'))];
    }

    const lines: string[] = [
      '',
      border('╭' + '─'.repeat(safeWidth - 2) + '╮'),
      border('│') + ' '.repeat(safeWidth - 2) + border('│'),
    ];

    for (const content of contentLines) {
      const vis = visibleWidth(content);
      const rightPad = Math.max(0, innerWidth - vis);
      lines.push(border('│') + pad + content + ' '.repeat(rightPad) + border('│'));
    }

    lines.push(border('│') + ' '.repeat(safeWidth - 2) + border('│'));
    lines.push(border('╰' + '─'.repeat(safeWidth - 2) + '╯'));
    lines.push('');

    return lines.map((line) => truncateToWidth(line, safeWidth, '…'));
  }

  private fieldLabel(text: string, field: FieldId): string {
    return this.activeField === field
      ? currentTheme.boldFg('accent', text)
      : currentTheme.fg('textDim', text);
  }

  private activeInput(): Input {
    if (this.activeField === 'name') return this.nameInput;
    if (this.activeField === 'endpoint') return this.endpointInput;
    return this.tokenInput;
  }

  private cycleField(delta: 1 | -1): void {
    const order: readonly FieldId[] = ['name', 'endpoint', 'token'];
    const idx = order.indexOf(this.activeField);
    const next = order[(idx + delta + order.length) % order.length];
    if (next !== undefined) this.focusField(next);
  }

  private focusField(field: FieldId): void {
    this.hint = 'none';
    this.activeField = field;
  }

  private handleSubmit(): void {
    if (this.done) return;

    const nameValue = this.nameInput.getValue().trim();
    const endpointValue = this.endpointInput.getValue().trim();
    const tokenValue = this.tokenInput.getValue().trim();

    if (nameValue.length === 0) {
      this.hint = 'name-empty';
      this.activeField = 'name';
      return;
    }
    if (endpointValue.length === 0) {
      this.hint = 'endpoint-empty';
      this.activeField = 'endpoint';
      return;
    }
    if (tokenValue.length === 0) {
      this.hint = 'token-empty';
      this.activeField = 'token';
      return;
    }

    this.done = true;
    this.onDone({
      kind: 'ok',
      value: { name: nameValue, endpoint: endpointValue, apiKey: tokenValue },
    });
  }

  private cancel(): void {
    if (this.done) return;
    this.done = true;
    this.onDone({ kind: 'cancel' });
  }
}
