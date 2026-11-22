/**
 * Claude Code (MCP) bridge - browser side.
 *
 * Connects the Game Master's Foundry client to the local MCP server
 * (mcp/foundry-mcp.mjs, started by Claude Code) and runs Simulacrum's tools on
 * its behalf. The browser connects out to ws://127.0.0.1:<port> because a web
 * page cannot accept incoming connections. See mcp/README.md.
 */

import { createLogger } from '../utils/logger.js';
import { toolRegistry } from '../core/tool-registry.js';
import { toolPermissionManager, PermissionState } from '../core/tool-permission-manager.js';
import { getAvailableMacrosList, getDocumentTypesInfo } from '../core/system-prompt-builder.js';
import { SequentialQueue } from '../utils/sequential-queue.js';

const MODULE_ID = 'simulacrum';
export const MCP_PROTOCOL_VERSION = 1;
export const MCP_DEFAULT_PORT = 47391;

/** Simulacrum loop/UI tools that make no sense for an external agent. */
const EXCLUDED_TOOLS = new Set(['end_loop', 'manage_task', 'read_tool_output']);
/** Tools that only read; flagged to the MCP client so it can auto-approve them. */
const READ_ONLY_TOOLS = new Set([
  'read_document',
  'search_documents',
  'list_documents',
  'list_document_schemas',
  'inspect_document_schema',
  'search_assets',
  'browse_folders',
]);
/** Schema properties that only drive Simulacrum's own chat UI. */
const UI_ONLY_PARAMS = ['justification', 'response'];
/** Results longer than this are stored and returned as a preview (~10k tokens). */
const OUTPUT_LIMIT_CHARS = 40000;
const PREVIEW_LINES = 60;
const MAX_STORED_OUTPUTS = 20;
const RETRY_DELAYS_MS = [1000, 2000, 3000, 5000];

const logger = createLogger('McpBridge');

export function registerMcpBridgeSettings() {
  game.settings.register(MODULE_ID, 'mcpBridgeEnabled', {
    scope: 'client',
    config: false,
    type: Boolean,
    default: false,
    onChange: () => mcpBridge.restart(),
  });
  game.settings.register(MODULE_ID, 'mcpBridgePort', {
    scope: 'client',
    config: false,
    type: Number,
    default: MCP_DEFAULT_PORT,
    onChange: () => mcpBridge.restart(),
  });
  game.settings.register(MODULE_ID, 'mcpBridgeToken', {
    scope: 'client',
    config: false,
    type: String,
    default: '',
    onChange: () => mcpBridge.restart(),
  });
}

/** A random token for pairing Foundry with the MCP server. */
export function generateToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Drop the parameters that only drive Simulacrum's own chat UI. */
function stripUiParams(params) {
  const properties = { ...(params.properties ?? {}) };
  for (const key of UI_ONLY_PARAMS) delete properties[key];
  const required = (params.required ?? []).filter(key => !UI_ONLY_PARAMS.includes(key));
  const inputSchema = { ...params, type: 'object', properties };
  if (required.length) inputSchema.required = required;
  else delete inputSchema.required;
  return inputSchema;
}

function annotationsFor(name, destructive) {
  if (READ_ONLY_TOOLS.has(name)) return { openWorldHint: false, readOnlyHint: true };
  if (destructive) return { openWorldHint: false, readOnlyHint: false, destructiveHint: true };
  return { openWorldHint: false };
}

/** Turn a Simulacrum (OpenAI-style) tool schema into an MCP tool definition. */
export function toMcpTool(schema, { destructive = false } = {}) {
  const fn = schema.function ?? schema;
  const params = fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : {};
  return {
    name: fn.name,
    description: fn.description ?? '',
    inputSchema: stripUiParams(params),
    annotations: annotationsFor(fn.name, destructive),
  };
}

function resultBody(result) {
  if (typeof result.content === 'string' && result.content.length > 0) return result.content;
  const rest = { ...result };
  delete rest.display; // HTML for Simulacrum's chat log
  return JSON.stringify(rest, null, 2);
}

function errorMessage(error) {
  if (!error) return '';
  return typeof error === 'string' ? error : (error.message ?? '');
}

/** Turn a Simulacrum tool result into the {text, isError} the MCP server expects. */
export function formatToolResult(result) {
  if (result === null || result === undefined) return { text: 'No output', isError: false };
  if (typeof result === 'string') return { text: result, isError: false };
  const isError = Boolean(result.error) || result.success === false;
  let text = resultBody(result);
  const message = errorMessage(result.error);
  if (isError && message && !text.includes(message)) text = `${text}\n\nError: ${message}`;
  return { text, isError };
}

const BRIDGE_TOOLS = [
  {
    name: 'get_world_context',
    description:
      'Summarize the connected Foundry world: game system and versions, document types and subtypes, document counts, compendium packs, the active scene, available macros, and any custom instructions the GM set for Simulacrum. Call this first.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Foundry world context', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_tool_output',
    description:
      'Read part of a large tool result that was stored instead of returned in full. Use the output_id from the stored-output notice; request up to about 300 lines at a time.',
    inputSchema: {
      type: 'object',
      properties: {
        output_id: { type: 'string', description: 'The output_id from the stored-output notice' },
        start_line: { type: 'integer', minimum: 1, description: 'First line to read (1-based)' },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to read (inclusive)' },
      },
      required: ['output_id', 'start_line', 'end_line'],
    },
    annotations: { title: 'Read stored tool output', readOnlyHint: true, openWorldHint: false },
  },
];

class McpBridge {
  constructor() {
    this.socket = null;
    this.state = 'disabled'; // disabled | connecting | connected | rejected | waiting
    this.lastError = null;
    this.retryIndex = 0;
    this.retryTimer = null;
    this.queue = new SequentialQueue();
    this.outputs = new Map();
    this.outputCounter = 0;
    this.listeners = new Set();
  }

  get settings() {
    return {
      enabled: game.settings.get(MODULE_ID, 'mcpBridgeEnabled'),
      port: Number(game.settings.get(MODULE_ID, 'mcpBridgePort')) || MCP_DEFAULT_PORT,
      token: game.settings.get(MODULE_ID, 'mcpBridgeToken'),
    };
  }

  /** Subscribe to state changes (used by the settings window). */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    if (!game.user?.isGM) return;
    const { enabled, token } = this.settings;
    if (!enabled) return this._setState('disabled');
    if (!token) {
      game.settings.set(MODULE_ID, 'mcpBridgeToken', generateToken());
      return; // the setting's onChange restarts the bridge
    }
    this._connect();
  }

  stop() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this._setState('disabled');
  }

  restart() {
    this.stop();
    this.retryIndex = 0;
    this.start();
  }

  _setState(state, error = null) {
    const changed = this.state !== state || this.lastError !== error;
    this.state = state;
    this.lastError = error;
    if (changed) for (const listener of this.listeners) listener(this);
  }

  _connect() {
    const { port } = this.settings;
    if (this.state !== 'waiting') this._setState('connecting');
    let socket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch (error) {
      this._setState('waiting', error.message);
      this._scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify(this._hello()));
    socket.onmessage = event => this._onMessage(socket, event.data);
    socket.onerror = () => {};
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.state === 'connected') {
        ui.notifications?.info('Simulacrum: Claude Code disconnected.');
      }
      if (this.state !== 'rejected') {
        this._setState('waiting', this.lastError);
        this._scheduleRetry();
      }
    };
  }

  _scheduleRetry() {
    clearTimeout(this.retryTimer);
    const delay = RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)];
    this.retryIndex++;
    this.retryTimer = setTimeout(() => {
      if (this.settings.enabled && !this.socket) this._connect();
    }, delay);
  }

  _hello() {
    return {
      type: 'hello',
      protocol: MCP_PROTOCOL_VERSION,
      token: this.settings.token,
      module: game.modules.get(MODULE_ID)?.version ?? null,
      world: {
        id: game.world?.id,
        title: game.world?.title,
        system: game.system?.id,
        systemTitle: game.system?.title,
        systemVersion: game.system?.version,
        foundryVersion: game.version,
        user: game.user?.name,
      },
    };
  }

  _onMessage(socket, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message?.type) {
      case 'welcome':
        this.retryIndex = 0;
        this._setState('connected');
        ui.notifications?.info('Simulacrum: connected to Claude Code.');
        break;
      case 'rejected':
        this._setState('rejected', message.reason || 'Connection rejected');
        ui.notifications?.error(
          `Simulacrum: Claude Code refused the connection. ${message.reason ?? ''}`
        );
        break;
      case 'list_tools':
        this._respond(socket, message.id, () => this.listTools());
        break;
      case 'call_tool':
        this._respond(socket, message.id, () =>
          this.queue.add(() => this.callTool(message.name, message.arguments ?? {}))
        );
        break;
      default:
        break;
    }
  }

  async _respond(socket, id, work) {
    try {
      const result = await work();
      socket.send(JSON.stringify({ type: 'response', id, ok: true, result }));
    } catch (error) {
      logger.warn('MCP request failed', error);
      socket.send(
        JSON.stringify({ type: 'response', id, ok: false, error: error?.message ?? String(error) })
      );
    }
  }

  /** MCP tool definitions for everything the GM allows. */
  listTools() {
    const tools = [];
    for (const schema of toolRegistry.getToolSchemas()) {
      const name = schema.function?.name;
      if (!name || EXCLUDED_TOOLS.has(name)) continue;
      const destructive = toolPermissionManager.isDestructive(name);
      if (destructive && toolPermissionManager.getPermission(name) === PermissionState.DENY)
        continue;
      tools.push(toMcpTool(schema, { destructive }));
    }
    return [...BRIDGE_TOOLS, ...tools];
  }

  /** Why a tool cannot be run from Claude Code, or null if it can. */
  _blockedReason(name) {
    if (EXCLUDED_TOOLS.has(name) || !toolRegistry.getTool(name)) return `Unknown tool: ${name}`;
    const denied =
      toolPermissionManager.isDestructive(name) &&
      toolPermissionManager.getPermission(name) === PermissionState.DENY;
    return denied ? `${name} is blocked in Simulacrum's tool permissions in Foundry.` : null;
  }

  async callTool(name, args) {
    if (name === 'get_world_context') return { text: await this._worldContext(), isError: false };
    if (name === 'read_tool_output') return this._readOutput(args);
    const blocked = this._blockedReason(name);
    if (blocked) return { text: blocked, isError: true };

    logger.info(`Claude Code is running ${name}`);
    let formatted;
    try {
      const execution = await toolRegistry.executeTool(name, { ...args });
      formatted = formatToolResult(execution?.result);
    } catch (error) {
      const cause = error?.data?.cause?.message ?? error?.cause?.message;
      formatted = { text: cause ?? error?.message ?? String(error), isError: true };
    }
    return this._limitOutput(name, formatted);
  }

  _limitOutput(name, formatted) {
    if (formatted.text.length <= OUTPUT_LIMIT_CHARS) return formatted;
    const id = `${name}-${++this.outputCounter}`;
    this.outputs.set(id, formatted.text);
    while (this.outputs.size > MAX_STORED_OUTPUTS)
      this.outputs.delete(this.outputs.keys().next().value);
    const lines = formatted.text.split('\n');
    const preview = lines.slice(0, PREVIEW_LINES).join('\n').slice(0, 8000);
    return {
      isError: formatted.isError,
      text:
        `${preview}\n\n[Output truncated: ${lines.length} lines, ${formatted.text.length} characters in total. ` +
        `The full result is stored as output_id "${id}". Use read_tool_output to read more, ` +
        `e.g. start_line ${PREVIEW_LINES + 1}, end_line ${PREVIEW_LINES + 300}.]`,
    };
  }

  _readOutput({ output_id: id, start_line: start, end_line: end }) {
    const stored = this.outputs.get(id);
    if (!stored) return { text: `No stored output "${id}". It may have expired.`, isError: true };
    const lines = stored.split('\n');
    const from = Math.max(1, Number(start) || 1);
    const to = Math.min(lines.length, Math.max(from, Number(end) || from));
    let text = lines.slice(from - 1, to).join('\n');
    if (text.length > OUTPUT_LIMIT_CHARS)
      text = `${text.slice(0, OUTPUT_LIMIT_CHARS)}\n[...cut; request fewer lines]`;
    return { text: `Lines ${from}-${to} of ${lines.length}:\n${text}`, isError: false };
  }

  async _worldContext() {
    const world = game.world ?? {};
    const system = game.system ?? {};
    const scene = game.scenes?.active;
    const lines = [
      `World: ${world.title} (${world.id})`,
      `System: ${system.title} (${system.id} ${system.version})`,
      `Foundry VTT: ${game.version}`,
      `Acting as: ${game.user?.name} (Game Master)`,
      '',
      getDocumentTypesInfo(),
      '',
      'World document counts:',
      ...Array.from(
        game.collections ?? [],
        ([name, collection]) => `- ${name}: ${collection.size}`
      ),
      '',
      `Active scene: ${scene ? `${scene.name} (${scene.uuid})` : 'none'}`,
      '',
      ...this._packLines(),
      '',
      'Macros:',
      await getAvailableMacrosList().catch(() => 'Unavailable.'),
    ];
    const custom = game.settings.get(MODULE_ID, 'customSystemPrompt')?.trim();
    if (custom) lines.push('', 'Custom instructions from the GM:', custom);
    return lines.join('\n');
  }

  _packLines(limit = 80) {
    const packs = Array.from(game.packs ?? []);
    const lines = [`Compendium packs (${packs.length}):`];
    for (const pack of packs.slice(0, limit)) {
      const meta = pack.metadata ?? {};
      const locked = pack.locked ? ' (locked)' : '';
      lines.push(
        `- ${pack.collection}: ${meta.label} [${meta.type ?? pack.documentName}]${locked}`
      );
    }
    if (packs.length > limit)
      lines.push(`- ...and ${packs.length - limit} more (use list_documents).`);
    return lines;
  }
}

export const mcpBridge = new McpBridge();
