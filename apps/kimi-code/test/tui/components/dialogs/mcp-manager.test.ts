import type { McpServerConfig } from '@moonshot-ai/kimi-code-sdk';
import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { McpManagerComponent, type McpManagerCallbacks } from '#/tui/components/dialogs/mcp-manager';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';

const ESC = String.fromCodePoint(27);
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replaceAll(SGR, '');
const ENTER = '\r';
const RIGHT = `${ESC}[C`;
const TAB = '\t';

function stdioServer(name: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', `${name}-server`],
    ...overrides,
  } as McpServerConfig;
}

function httpServer(name: string): McpServerConfig {
  return {
    name,
    transport: 'http',
    url: `https://${name}.example.com/mcp`,
  } as McpServerConfig;
}

function makeCallbacks() {
  const callbacks: McpManagerCallbacks = {
    list: vi.fn(async () => []),
    add: vi.fn(async (server: McpServerConfig) => [server]),
    update: vi.fn(async (server: McpServerConfig) => [server]),
    remove: vi.fn(async () => []),
  };
  return callbacks;
}

function makeComponent(
  servers: readonly McpServerConfig[],
  callbacks = makeCallbacks(),
) {
  const onClose = vi.fn();
  const onShowStatus = vi.fn();
  const component = new McpManagerComponent({
    servers,
    callbacks,
    onShowStatus,
    onClose,
  });
  component.focused = true;
  return { component, callbacks, onClose, onShowStatus };
}

function type(component: McpManagerComponent, text: string): void {
  for (const ch of text) component.handleInput(ch);
}

describe('McpManagerComponent', () => {
  let previousLevel: typeof chalk.level;
  const previousPalette = currentTheme.palette;
  beforeAll(() => {
    previousLevel = chalk.level;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
  });
  afterAll(() => {
    chalk.level = previousLevel;
    currentTheme.setPalette(previousPalette);
  });

  it('renders server rows with transport and target', () => {
    const { component } = makeComponent([stdioServer('search'), httpServer('docs')]);
    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('search');
    expect(out).toContain('stdio');
    expect(out).toContain('npx -y search-server');
    expect(out).toContain('docs');
    expect(out).toContain('https://docs.example.com/mcp');
  });

  it('marks disabled servers and the empty state', () => {
    const disabled = makeComponent([stdioServer('off', { enabled: false })]);
    expect(strip(disabled.component.render(100).join('\n'))).toContain('(disabled)');
    const empty = makeComponent([]);
    const out = strip(empty.component.render(100).join('\n'));
    expect(out).toContain('No MCP servers configured');
    expect(out).toContain('Press a to add one');
  });

  it('toggles enabled through update', async () => {
    const { component, callbacks } = makeComponent([stdioServer('search')]);
    component.handleInput('t');
    await vi.waitFor(() => expect(callbacks.update).toHaveBeenCalled());
    const server = (callbacks.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as McpServerConfig;
    expect(server).toMatchObject({ name: 'search', enabled: true });
  });

  it('removes only after a confirming second d', async () => {
    const { component, callbacks } = makeComponent([stdioServer('search')]);
    component.handleInput('d');
    expect(strip(component.render(100).join('\n'))).toContain('press d again');
    expect(callbacks.remove).not.toHaveBeenCalled();
    component.handleInput('d');
    await vi.waitFor(() => expect(callbacks.remove).toHaveBeenCalledWith('search'));
  });

  it('edits through the form without changing the name', async () => {
    const { component, callbacks } = makeComponent([stdioServer('search')]);
    component.handleInput('e');
    let out = strip(component.render(100).join('\n'));
    expect(out).toContain('identity, immutable');
    // First field is transport; Tab to the command field and append a flag.
    component.handleInput(TAB); // name (immutable, skipped on render only)
    component.handleInput(TAB); // target
    type(component, '-y');
    component.handleInput(ENTER); // args field
    component.handleInput(ENTER); // env field
    component.handleInput(ENTER); // last field → submit
    await vi.waitFor(() => expect(callbacks.update).toHaveBeenCalled());
    const server = (callbacks.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as McpServerConfig;
    expect(server).toMatchObject({ name: 'search', transport: 'stdio', command: 'npx-y' });
  });

  it('adds an http server with url validation', async () => {
    const { component, callbacks } = makeComponent([]);
    component.handleInput('a');
    component.handleInput(RIGHT); // transport: stdio → http
    component.handleInput(TAB); // name
    type(component, 'docs');
    component.handleInput(TAB); // url
    type(component, 'https://docs.example.com/mcp');
    component.handleInput(TAB); // bearer
    component.handleInput(ENTER); // submit
    await vi.waitFor(() => expect(callbacks.add).toHaveBeenCalled());
    const server = (callbacks.add as ReturnType<typeof vi.fn>).mock.calls[0]![0] as McpServerConfig;
    expect(server).toMatchObject({
      name: 'docs',
      transport: 'http',
      url: 'https://docs.example.com/mcp',
    });
  });

  it('rejects an invalid url inline without calling add', () => {
    const { component, callbacks } = makeComponent([]);
    component.handleInput('a');
    component.handleInput(RIGHT); // http
    component.handleInput(TAB); // name
    type(component, 'docs');
    component.handleInput(TAB); // url
    type(component, 'not-a-url');
    component.handleInput(ENTER); // bearer
    component.handleInput(ENTER); // submit
    expect(callbacks.add).not.toHaveBeenCalled();
    expect(strip(component.render(100).join('\n'))).toContain('valid http(s) URL');
  });

  it('Esc from the list closes, Esc from the form goes back', () => {
    const { component, onClose } = makeComponent([stdioServer('search')]);
    component.handleInput('a');
    component.handleInput(ESC);
    expect(onClose).not.toHaveBeenCalled();
    expect(strip(component.render(100).join('\n'))).toContain('search');
    component.handleInput(ESC);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('s key surfaces the legacy status report', () => {
    const { component, onShowStatus } = makeComponent([stdioServer('search')]);
    component.handleInput('s');
    expect(onShowStatus).toHaveBeenCalledTimes(1);
  });
});
