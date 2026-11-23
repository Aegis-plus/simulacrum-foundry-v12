/**
 * MCP side of the Foundry MCP server: exposes the tools offered by the
 * connected Foundry world (via FoundryBridge) to an MCP client such as
 * Claude Code, plus a `foundry_status` tool that always works.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const SERVER_NAME = 'foundry-vtt';
export const SERVER_VERSION = '1.0.0';

/** Brief grace period in tools/list for a Foundry that is reconnecting right now. Must stay
 * well under MCP clients' request timeouts; later connections are announced with
 * notifications/tools/list_changed instead. */
const LIST_WAIT_MS = 1500;
/** How long tools/call waits for Foundry before giving up. */
const CALL_WAIT_MS = 5000;

export const INSTRUCTIONS = `Tools for a live Foundry Virtual Tabletop world, provided by the Simulacrum module running in the Game Master's browser.

- Call get_world_context first: it reports the game system, document types, and available macros.
- Read before you write: use read_document or search_documents before update_document or delete_document, and read a document back after changing it.
- Use inspect_document_schema to learn a document type's fields before creating one (system data differs per game system, e.g. dnd5e).
- Refer to documents by UUID (e.g. Actor.abc123, Compendium.pack.Item.xyz). In text fields, link with @UUID[Actor.abc123]{Name}.
- Large results are stored and summarized; fetch the rest with read_tool_output.
- If tools are missing or calls fail with "Foundry is not connected", call foundry_status for what to do.`;

const STATUS_TOOL = {
  name: 'foundry_status',
  description:
    'Report whether a Foundry VTT world is connected to this MCP server, which world it is, and how to connect one if not.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { title: 'Foundry connection status', readOnlyHint: true, openWorldHint: false },
};

export function describeStatus(status) {
  const lines = [];
  if (status.connected) {
    const w = status.world ?? {};
    lines.push(`Connected to Foundry VTT ${w.foundryVersion ?? ''}`.trim() + '.');
    if (w.title) lines.push(`World: ${w.title}${w.id ? ` (${w.id})` : ''}`);
    if (w.system) lines.push(`System: ${w.system}${w.systemVersion ? ` ${w.systemVersion}` : ''}`);
    if (w.user) lines.push(`Acting as: ${w.user}`);
    return lines.join('\n');
  }
  lines.push('No Foundry world is connected.');
  if (!status.listening) {
    lines.push(
      `This server could not listen on ${status.address}: ${status.listenError ?? 'unknown error'}.`,
      'If another Claude Code session is already connected to Foundry, close it (only one session can be connected at a time), or set FOUNDRY_MCP_PORT to another port in both places.'
    );
  } else {
    lines.push(
      `Waiting for Foundry on ${status.address}. To connect:`,
      '1. Open the world in Foundry as a Game Master, on this same computer.',
      '2. Game Settings > Configure Settings > Simulacrum > "Claude Code (MCP)" and turn the bridge on.',
      '3. Make sure the token there matches FOUNDRY_MCP_TOKEN for this server.'
    );
  }
  if (!status.tokenConfigured) {
    lines.push(
      'FOUNDRY_MCP_TOKEN is not set for this server, so Foundry cannot connect. Copy the setup command from the Simulacrum "Claude Code (MCP)" settings in Foundry.'
    );
  }
  return lines.join('\n');
}

/**
 * @param {import('./bridge.mjs').FoundryBridge} bridge
 * @returns {Server}
 */
export function createMcpServer(bridge) {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: true } }, instructions: INSTRUCTIONS }
  );

  const status = () => ({ ...bridge.status(), tokenConfigured: Boolean(bridge.token) });
  const notifyChanged = () => {
    server.sendToolListChanged().catch(() => {});
  };
  bridge.on('connected', notifyChanged);
  bridge.on('disconnected', notifyChanged);
  bridge.on('toolsChanged', notifyChanged);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!bridge.connected) await bridge.waitForConnection(LIST_WAIT_MS);
    if (!bridge.connected) return { tools: [STATUS_TOOL] };
    try {
      const tools = await bridge.listTools();
      return { tools: [STATUS_TOOL, ...(Array.isArray(tools) ? tools : [])] };
    } catch {
      return { tools: [STATUS_TOOL] };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    if (name === STATUS_TOOL.name) {
      // Right after startup Foundry may still be reconnecting; give it a moment.
      if (!bridge.connected && bridge.wss) await bridge.waitForConnection(CALL_WAIT_MS);
      return { content: [{ type: 'text', text: describeStatus(status()) }] };
    }
    if (!bridge.connected) await bridge.waitForConnection(CALL_WAIT_MS);
    if (!bridge.connected) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Foundry is not connected.\n\n${describeStatus(status())}` },
        ],
      };
    }
    try {
      const result = await bridge.callTool(name, args ?? {});
      return {
        isError: Boolean(result?.isError),
        content: [{ type: 'text', text: String(result?.text ?? '') }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool ${name} failed: ${error.message}` }],
      };
    }
  });

  return server;
}
