/**
 * Settings window for the Claude Code (MCP) bridge: on/off, status, token, and
 * the command that registers the MCP server with Claude Code.
 */

import { mcpBridge, generateToken, MCP_DEFAULT_PORT } from './mcp-bridge.js';

const MODULE_ID = 'simulacrum';
const { ApplicationV2 } = foundry.applications.api;

const STATUS_TEXT = {
  disabled: ['Off', 'fa-solid fa-power-off', '#9f8475'],
  connecting: ['Connecting...', 'fa-solid fa-circle-notch fa-spin', '#daa520'],
  waiting: [
    'Waiting for Claude Code (start a Claude Code session with the server added)',
    'fa-solid fa-hourglass-half',
    '#daa520',
  ],
  connected: ['Connected to Claude Code', 'fa-solid fa-circle-check', '#26b231'],
  rejected: ['Rejected by the MCP server', 'fa-solid fa-triangle-exclamation', '#ce0707'],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Best guess at the MCP server's path, based on Foundry's default data folder per OS. */
export function defaultServerPath() {
  const platform =
    `${globalThis.navigator?.userAgentData?.platform ?? ''} ${globalThis.navigator?.platform ?? ''} ${globalThis.navigator?.userAgent ?? ''}`.toLowerCase();
  const rel = 'Data/modules/simulacrum/mcp/foundry-mcp.mjs';
  if (platform.includes('win')) return `%LOCALAPPDATA%\\FoundryVTT\\${rel.replaceAll('/', '\\')}`;
  if (platform.includes('mac')) return `$HOME/Library/Application Support/FoundryVTT/${rel}`;
  return `$HOME/.local/share/FoundryVTT/${rel}`;
}

export function buildSetupCommand({ token, port, path }) {
  const portArg = port && port !== MCP_DEFAULT_PORT ? ` -e FOUNDRY_MCP_PORT=${port}` : '';
  return `claude mcp add foundry -s user -e FOUNDRY_MCP_TOKEN=${token}${portArg} -- node "${path}"`;
}

export class McpBridgeConfig extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'simulacrum-mcp-bridge',
    tag: 'div',
    classes: ['simulacrum-mcp-bridge'],
    window: { title: 'Simulacrum: Claude Code (MCP)', icon: 'fa-solid fa-plug', resizable: true },
    position: { width: 560, height: 'auto' },
  };

  constructor(options) {
    super(options);
    this._unsubscribe = mcpBridge.onChange(() => {
      if (this.rendered) this.render();
    });
  }

  async _prepareContext() {
    const enabled = game.settings.get(MODULE_ID, 'mcpBridgeEnabled');
    const port = Number(game.settings.get(MODULE_ID, 'mcpBridgePort')) || MCP_DEFAULT_PORT;
    const token = game.settings.get(MODULE_ID, 'mcpBridgeToken') || '';
    const path = defaultServerPath();
    return {
      enabled,
      port,
      token,
      path,
      command: token ? buildSetupCommand({ token, port, path }) : '',
      state: mcpBridge.state,
      error: mcpBridge.lastError,
    };
  }

  async _renderHTML(context) {
    const [label, icon, color] = STATUS_TEXT[context.state] ?? STATUS_TEXT.disabled;
    const error =
      context.error && context.state === 'rejected'
        ? `<p class="hint" style="color:#ce0707">${escapeHtml(context.error)}</p>`
        : '';
    const setup = context.token
      ? `<section class="setup">
          <h4>1. Add the server to Claude Code</h4>
          <p class="hint">Run this once in a terminal on <strong>this computer</strong>. Requires Node.js 18 or newer. If your Foundry data folder is not in the default place, change the path to
          <code>&lt;your Foundry data folder&gt;/Data/modules/simulacrum/mcp/foundry-mcp.mjs</code>.</p>
          <div class="command" style="padding:0.5rem;background:rgba(0,0,0,0.35);border:1px solid #4b4a45;border-radius:4px;margin:0.25rem 0 0.5rem;user-select:text;-webkit-user-select:text"><code style="display:block;white-space:pre-wrap;word-break:break-all;background:none;border:none;padding:0;user-select:text;-webkit-user-select:text">${escapeHtml(context.command)}</code></div>
          <button type="button" data-action="copy"><i class="fa-solid fa-copy"></i> Copy command</button>
          <h4>2. Start Claude Code</h4>
          <p class="hint">Start (or restart) Claude Code. It launches the server, and this browser connects to it within a few seconds; the status above turns green. Ask Claude to call <code>get_world_context</code> to check.</p>
        </section>`
      : '';
    return `
      <style>
        #simulacrum-mcp-bridge h4 { margin: 0.75rem 0 0.25rem; font-size: var(--font-size-16, 16px); font-weight: bold; border: none; }
        #simulacrum-mcp-bridge .hint code { display: inline; padding: 0 0.2em; white-space: normal; word-break: break-all; }
        #simulacrum-mcp-bridge .status { margin: 0; }
      </style>
      <div class="standard-form" style="display:flex;flex-direction:column;gap:0.75rem;padding:0.5rem 0.75rem 0.75rem">
        <p>Lets <strong>Claude Code</strong> (or another MCP client) on this computer read and change this world using Simulacrum's tools, while this browser has the world open as Game Master.</p>
        <p class="status" style="color:${color};font-weight:bold"><i class="${icon}"></i> ${escapeHtml(label)}</p>
        ${error}
        <div class="form-group">
          <label>Enable bridge</label>
          <div class="form-fields"><input type="checkbox" name="enabled" ${context.enabled ? 'checked' : ''}></div>
        </div>
        <div class="form-group">
          <label>Port</label>
          <div class="form-fields"><input type="number" name="port" min="1024" max="65535" value="${context.port}"></div>
        </div>
        <div class="form-group">
          <label>Token</label>
          <div class="form-fields">
            <input type="text" name="token" value="${escapeHtml(context.token)}" readonly placeholder="Generated when you enable the bridge">
            <button type="button" data-action="newToken" title="Generate a new token" style="flex:0 0 auto;width:auto"><i class="fa-solid fa-rotate"></i></button>
          </div>
        </div>
        ${setup}
        <p class="hint">Claude Code asks before running tools that change the world. Tools blocked in Simulacrum's Tool Permissions are not offered to Claude Code. Only one Claude Code session can be connected at a time.</p>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector('input[name="enabled"]')?.addEventListener('change', event => {
      game.settings.set(MODULE_ID, 'mcpBridgeEnabled', event.currentTarget.checked);
    });
    content.querySelector('input[name="port"]')?.addEventListener('change', event => {
      const port = Number.parseInt(event.currentTarget.value, 10);
      if (port >= 1024 && port <= 65535) game.settings.set(MODULE_ID, 'mcpBridgePort', port);
    });
    content.querySelector('[data-action="newToken"]')?.addEventListener('click', async () => {
      await game.settings.set(MODULE_ID, 'mcpBridgeToken', generateToken());
      ui.notifications.warn(
        'Simulacrum: new token generated. Run the updated command so Claude Code uses it.'
      );
      this.render();
    });
    content.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
      const text = content.querySelector('.command code')?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(text);
        ui.notifications.info('Command copied.');
      } catch {
        ui.notifications.warn('Could not copy automatically; select the command and copy it.');
      }
    });
    setTimeout(() => this.setPosition?.({ height: 'auto' }), 0);
  }

  async close(options) {
    this._unsubscribe?.();
    return super.close(options);
  }
}
