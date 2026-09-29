/**
 * SwarmBoardDialogComponent — recent agent-communications board.
 *
 * Lists messages from `{workspace}/.andrewcode/comms/board.jsonl` (or
 * `ANDREWCODE_COMMS_DIR`). Channel tabs filter the hive rooms; Esc cancels.
 * When the store is missing the dialog stays open with a muted empty state.
 *
 * Layout, key map, and copy follow .agents/skills/write-tui/DESIGN.md.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@moonshot-ai/pi-tui';

import {
  commsDirExists,
  commsPaths,
  readJsonlFile,
} from '#/tui/agent-comms/paths';
import { listBoard } from '#/tui/agent-comms/store';
import {
  type CommsMessage,
  DEFAULT_COMMS_CHANNELS,
  parseCommsMessage,
} from '#/tui/agent-comms/types';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { SearchableList } from '#/tui/utils/searchable-list';
import { renderTabStrip } from '#/tui/utils/tab-strip';

const ELLIPSIS = '…';
const DEFAULT_PAGE_SIZE = 8;
const DEFAULT_BOARD_LIMIT = 200;

export type SwarmBoardMessage = CommsMessage;

export interface SwarmBoardDialogOptions {
  readonly cwd?: string;
  readonly commsDir?: string;
  readonly messages?: readonly SwarmBoardMessage[];
  readonly initialChannel?: string;
  readonly pageSize?: number;
  readonly onSelect?: (message: SwarmBoardMessage) => void;
  readonly onCancel: () => void;
}

export interface LoadSwarmBoardMessagesOptions {
  readonly cwd?: string;
  readonly commsDir?: string;
}

export function loadSwarmBoardMessages(
  opts: LoadSwarmBoardMessagesOptions = {},
): SwarmBoardMessage[] {
  try {
    const commsDir = opts.commsDir;
    if (typeof commsDir === 'string' && commsDir.length > 0) {
      if (!commsDirExists(commsDir)) return [];
      return newestFirst(readJsonlFile(commsPaths(commsDir).board, parseCommsMessage));
    }
    const cwd = typeof opts.cwd === 'string' && opts.cwd.length > 0 ? opts.cwd : process.cwd();
    return newestFirst(listBoard(cwd, DEFAULT_BOARD_LIMIT));
  } catch {
    return [];
  }
}

export function formatCommsRelativeTime(ts: string | number, now = Date.now()): string {
  const millis = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(millis) || millis <= 0) return '';
  const diffSec = Math.floor(Math.max(0, now - millis) / 1000);
  if (diffSec < 60) return 'just now';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

function newestFirst(messages: readonly SwarmBoardMessage[]): SwarmBoardMessage[] {
  return [...messages].toSorted((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function channelTabs(messages: readonly SwarmBoardMessage[]): readonly string[] {
  const extra: string[] = [];
  const seen = new Set<string>(DEFAULT_COMMS_CHANNELS);
  for (const message of messages) {
    if (seen.has(message.channel)) continue;
    seen.add(message.channel);
    extra.push(message.channel);
  }
  extra.sort((a, b) => a.localeCompare(b));
  return ['all', ...DEFAULT_COMMS_CHANNELS, ...extra];
}

function channelTabLabel(channel: string): string {
  if (channel === 'all') return 'All';
  return channel;
}

function messageSearchText(message: SwarmBoardMessage): string {
  return `${message.from} ${message.to ?? ''} ${message.channel} ${message.kind} ${message.body}`;
}

export class SwarmBoardDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: SwarmBoardDialogOptions;
  private readonly messages: readonly SwarmBoardMessage[];
  private readonly channels: readonly string[];
  private readonly pageSize: number;
  private channelIndex: number;
  private list: SearchableList<SwarmBoardMessage>;

  constructor(opts: SwarmBoardDialogOptions) {
    super();
    this.opts = opts;
    this.pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    this.messages =
      opts.messages !== undefined
        ? newestFirst(opts.messages)
        : loadSwarmBoardMessages({
            cwd: opts.cwd,
            commsDir: opts.commsDir,
          });
    this.channels = channelTabs(this.messages);
    const initial = opts.initialChannel ?? 'all';
    const initialIndex = this.channels.indexOf(initial);
    this.channelIndex = initialIndex >= 0 ? initialIndex : 0;
    this.list = this.createList();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.list.clearQuery()) return;
      this.opts.onCancel();
      return;
    }
    if (this.channels.length > 1) {
      if (matchesKey(data, Key.tab)) {
        this.channelIndex = (this.channelIndex + 1) % this.channels.length;
        this.list = this.createList();
        return;
      }
      if (matchesKey(data, Key.shift('tab'))) {
        this.channelIndex =
          (this.channelIndex - 1 + this.channels.length) % this.channels.length;
        this.list = this.createList();
        return;
      }
    }
    if (matchesKey(data, Key.left)) {
      this.list.pageUp();
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.list.pageDown();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const chosen = this.list.selected();
      if (chosen !== undefined && this.opts.onSelect !== undefined) {
        this.opts.onSelect(chosen);
      }
      return;
    }
    this.list.handleKey(data);
  }

  override render(width: number): string[] {
    const view = this.list.view();
    const titleSuffix =
      view.query.length === 0 ? currentTheme.fg('textMuted', '  (type to search)') : '';
    const hintParts = ['Tab toggle channel', '↑↓ navigate'];
    if (view.page.pageCount > 1) hintParts.push('←→ page');
    if (view.query.length > 0) hintParts.push('Backspace clear');
    if (this.opts.onSelect !== undefined) hintParts.push('Enter select');
    hintParts.push('Esc cancel');

    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ' Agent comms') + titleSuffix,
      currentTheme.fg('textMuted', ` ${hintParts.join(' · ')}`),
      '',
      renderTabStrip({
        labels: this.channels.map(channelTabLabel),
        activeIndex: this.channelIndex,
        width,
        colors: currentTheme.palette,
      }),
      '',
    ];

    if (view.query.length > 0) {
      lines.push(currentTheme.fg('primary', ' Search: ') + currentTheme.fg('text', view.query));
    }

    if (this.messages.length === 0) {
      lines.push(currentTheme.fg('textMuted', '   No agent communications yet'));
    } else if (view.items.length === 0) {
      lines.push(
        currentTheme.fg(
          'textMuted',
          view.query.length > 0 ? '   No matches' : '   No messages in this channel',
        ),
      );
    } else {
      for (let i = view.page.start; i < view.page.end; i++) {
        const message = view.items[i];
        if (message === undefined) continue;
        const selected = i === view.selectedIndex;
        lines.push(...this.renderMessage(message, selected, width));
      }
    }

    lines.push('');
    if (view.query.length > 0) {
      lines.push(
        currentTheme.fg(
          'textMuted',
          ` ${String(view.items.length)} / ${String(this.visibleMessages().length)}`,
        ),
      );
    } else {
      const below = view.items.length - view.page.end;
      if (below > 0) {
        lines.push(currentTheme.fg('textMuted', ` ▼ ${String(below)} more`));
      }
    }

    lines.push(currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  private createList(): SearchableList<SwarmBoardMessage> {
    return new SearchableList({
      items: this.visibleMessages(),
      toSearchText: messageSearchText,
      pageSize: this.pageSize,
      searchable: true,
    });
  }

  private visibleMessages(): readonly SwarmBoardMessage[] {
    const channel = this.channels[this.channelIndex] ?? 'all';
    if (channel === 'all') return this.messages;
    return this.messages.filter((message) => message.channel === channel);
  }

  private renderMessage(
    message: SwarmBoardMessage,
    selected: boolean,
    width: number,
  ): string[] {
    const pointer = selected ? SELECT_POINTER : ' ';
    const who =
      message.to !== undefined && message.to.length > 0
        ? `${message.from} → ${message.to}`
        : message.from;
    const when = formatCommsRelativeTime(message.ts);
    const meta = [message.channel, message.kind, when]
      .filter((part) => part.length > 0)
      .join('  ');
    const pointerPrefix = `  ${pointer} `;
    const nameWidth = Math.max(8, Math.min(visibleWidth(who), Math.floor(width * 0.4)));
    const truncatedWho = truncateToWidth(who, nameWidth, ELLIPSIS);
    const namePad = ' '.repeat(Math.max(0, nameWidth - visibleWidth(truncatedWho)));
    let header = currentTheme.fg(selected ? 'primary' : 'textDim', pointerPrefix);
    header += selected
      ? currentTheme.boldFg('primary', truncatedWho)
      : currentTheme.fg('text', truncatedWho);
    header += namePad;
    header += '  ' + currentTheme.fg('textMuted', meta);
    const body = singleLine(message.body);
    const out = [header];
    if (body.length > 0) {
      const bodyWidth = Math.max(1, width - 4);
      out.push(currentTheme.fg('textMuted', `    ${truncateToWidth(body, bodyWidth, ELLIPSIS)}`));
    }
    return out;
  }
}
