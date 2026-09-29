import { visibleWidth } from '@moonshot-ai/pi-tui';
import { describe, expect, it, vi } from 'vitest';

import {
  CustomEndpointImportDialogComponent,
  type CustomEndpointImportResult,
} from '#/tui/components/dialogs/custom-endpoint-import';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (s: string): string => s.replaceAll(ANSI, '');
const ESC = String.fromCodePoint(27);
const DOWN = `${ESC}[B`;

function plain(component: CustomEndpointImportDialogComponent, width = 80): string {
  return component.render(width).map(strip).join('\n');
}

function makeDialog(): {
  dialog: CustomEndpointImportDialogComponent;
  onDone: ReturnType<typeof vi.fn>;
} {
  const onDone = vi.fn();
  const dialog = new CustomEndpointImportDialogComponent(
    onDone as unknown as (r: CustomEndpointImportResult) => void,
    {
      title: 'Add OpenAI-compatible provider',
      subtitle: 'Name, endpoint, and API key.',
    },
  );
  dialog.focused = true;
  return { dialog, onDone };
}

describe('CustomEndpointImportDialogComponent', () => {
  it('advances through name and endpoint before submitting the API key', () => {
    const { dialog, onDone } = makeDialog();
    expect(plain(dialog)).toContain('next field');

    for (const ch of 'Local') dialog.handleInput(ch);
    dialog.handleInput('\r');
    expect(onDone).not.toHaveBeenCalled();

    for (const ch of 'https://llm.example.test/v1') dialog.handleInput(ch);
    dialog.handleInput('\r');
    expect(onDone).not.toHaveBeenCalled();
    expect(plain(dialog)).toContain('Enter to submit');

    for (const ch of 'sk-test') dialog.handleInput(ch);
    dialog.handleInput('\r');
    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: {
        name: 'Local',
        endpoint: 'https://llm.example.test/v1',
        apiKey: 'sk-test',
      },
    });
  });

  it('requires every field before submit', () => {
    const { dialog, onDone } = makeDialog();
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput('\r');
    expect(onDone).not.toHaveBeenCalled();
    expect(plain(dialog)).toContain('Provider name cannot be empty');
  });

  it('keeps every line within narrow widths', () => {
    const { dialog } = makeDialog();
    for (const width of [39, 35, 20, 10]) {
      for (const line of dialog.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
