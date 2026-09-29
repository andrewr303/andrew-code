/**
 * The `/mcp` command surface: opens the interactive MCP manager over the
 * user's global servers (`~/.kimi-code/mcp.json`), with the read-only
 * status report one keypress away. Manager mutations run on the harness
 * MCP CRUD RPCs; the legacy `showMcpServers` panel stays reachable from
 * inside the dialog (`s`).
 */

import { McpManagerComponent } from '../components/dialogs/mcp-manager';
import type { SlashCommandHost } from './dispatch';
import { formatErrorMessage } from '../utils/event-payload';
import { showMcpServers } from './info';

export function showMcpManager(host: SlashCommandHost): void {
  const harness = host.harness;
  if (harness === undefined) {
    void showMcpServers(host);
    return;
  }
  const component = new McpManagerComponent({
    servers: [],
    callbacks: {
      list: () => harness.listMcpServers(),
      add: (server) => harness.addMcpServer(server),
      update: (server) => harness.updateMcpServer(server),
      remove: (name) => harness.removeMcpServer(name),
    },
    onShowStatus: () => {
      void showMcpServers(host);
    },
    onClose: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(component);
  void harness
    .listMcpServers()
    .then((servers) => {
      component.setServers(servers);
    })
    .catch((error: unknown) => {
      host.restoreEditor();
      host.showError(`Failed to load MCP servers: ${formatErrorMessage(error)}`);
    });
}
