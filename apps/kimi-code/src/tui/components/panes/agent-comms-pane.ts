/**
 * AgentCommsPaneComponent — compact last-N view of the agent communications bus.
 *
 * Reads `{workspace}/.andrewcode/comms/board.jsonl` (or `ANDREWCODE_COMMS_DIR`)
 * unless messages are injected. Missing store renders a muted empty state.
 */

import { Container, truncateToWidth } from '@moonshot-ai/pi-tui';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  formatCommsRelativeTime,
  loadSwarmBoardMessages,
  type SwarmBoardMessage,
} from '../dialogs/swarm-board-dialog';

const ELLIPSIS = '…';
const DEFAULT_LIMIT = 6;

export interface AgentCommsPaneOptions {
  readonly cwd?: string;
  readonly commsDir?: string;
  readonly messages?: readonly SwarmBoardMessage[];
  readonly channel?: string;
  readonly limit?: number;
}

export class AgentCommsPaneComponent extends Container {
  private readonly messages: readonly SwarmBoardMessage[];
  private readonly limit: number;

  constructor(options: AgentCommsPaneOptions) {
    super();
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    const loaded =
      options.messages !== undefined
        ? options.messages
        : loadSwarmBoardMessages({
            cwd: options.cwd,
            commsDir: options.commsDir,
          });
    const channel = options.channel;
    const filtered =
      channel !== undefined && channel.length > 0 && channel !== 'all'
        ? loaded.filter((message) => message.channel === channel)
        : loaded;
    this.messages = [...filtered]
      .toSorted((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      .slice(-this.limit);
  }

  override render(width: number): string[] {
    const lines: string[] = [currentTheme.fg('border', '─'.repeat(width))];
    if (this.messages.length === 0) {
      lines.push(
        currentTheme.fg('textMuted', truncateToWidth('  no agent comms', width, ELLIPSIS)),
      );
      return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
    }

    for (const message of this.messages) {
      const when = formatCommsRelativeTime(message.ts);
      const who =
        message.to !== undefined && message.to.length > 0
          ? `${message.from} → ${message.to}`
          : message.from;
      const meta = [who, message.channel, when].filter((part) => part.length > 0).join(' · ');
      const prefix = `  ${STATUS_BULLET}`;
      lines.push(currentTheme.fg('text', truncateToWidth(prefix + meta, width, ELLIPSIS)));
      const body = message.body.replaceAll(/\s+/g, ' ').trim();
      if (body.length > 0) {
        lines.push(
          currentTheme.fg('textMuted', truncateToWidth(`    ${body}`, width, ELLIPSIS)),
        );
      }
    }
    return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
  }
}
