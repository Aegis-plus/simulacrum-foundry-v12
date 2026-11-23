/**
 * End-to-end: the real browser-side bridge (scripts/mcp/mcp-bridge.js, running
 * on a minimal fake Foundry `game`) connects to the bundled MCP server
 * (foundry-mcp.mjs, started over stdio exactly as Claude Code starts it),
 * and an MCP client drives tools through both.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

const SERVER = fileURLToPath(new URL('../foundry-mcp.mjs', import.meta.url));
const PORT = 47000 + Math.floor(Math.random() * 900);
const TOKEN = 'test-token-0123456789abcdef';

// ---- Minimal Foundry shims for the browser-side code --------------------
const settings = new Map([
  ['simulacrum.mcpBridgeEnabled', true],
  ['simulacrum.mcpBridgePort', PORT],
  ['simulacrum.mcpBridgeToken', TOKEN],
  ['simulacrum.toolPermissions', {}],
  ['simulacrum.trustAllTools', false],
  ['simulacrum.customSystemPrompt', 'Use British spelling.'],
]);
const notifications = [];
const actors = new Map([['a1', { id: 'a1', name: 'Grunk' }]]);
globalThis.game = {
  version: '12.331',
  user: { id: 'gm', name: 'Gamemaster', isGM: true },
  world: { id: 'cragmaw', title: 'Cragmaw Hideout' },
  system: { id: 'dnd5e', title: 'Dungeons & Dragons Fifth Edition', version: '3.3.1' },
  modules: new Map([['simulacrum', { version: '1.1.4' }]]),
  documentTypes: { Actor: ['character', 'npc'], Item: ['weapon', 'spell'], JournalEntry: [] },
  collections: new Map([
    ['Actor', actors],
    ['Item', new Map()],
    ['JournalEntry', new Map()],
  ]),
  scenes: { active: { name: 'Goblin Ambush', uuid: 'Scene.s1' } },
  packs: Object.assign(
    [
      {
        collection: 'dnd5e.monsters',
        metadata: { label: 'Monsters', type: 'Actor' },
        documentName: 'Actor',
        locked: true,
      },
    ],
    {
      get: () => undefined,
    }
  ),
  macros: [],
  i18n: { localize: key => key, format: key => key },
  settings: {
    get: (scope, key) => settings.get(`${scope}.${key}`),
    set: async (scope, key, value) => settings.set(`${scope}.${key}`, value),
    register: () => {},
  },
};
game.macros.forEach = Array.prototype.forEach.bind([]);
globalThis.ui = {
  notifications: {
    info: msg => notifications.push(['info', msg]),
    warn: msg => notifications.push(['warn', msg]),
    error: msg => notifications.push(['error', msg]),
  },
};
globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 18) } };
globalThis.Hooks = { callAll: () => {}, call: () => true, on: () => 0, once: () => 0 };
globalThis.CONFIG = { debug: {} };
globalThis.FormApplication = class {};

const { toolRegistry } = await import('../../scripts/core/tool-registry.js');
const { toolPermissionManager } = await import('../../scripts/core/tool-permission-manager.js');
const { mcpBridge } = await import('../../scripts/mcp/mcp-bridge.js');
toolRegistry.registerDefaults();
const { registerAllTableTools } = await import('../../scripts/tools/table/index.js');
registerAllTableTools(toolRegistry);

let client;
let listChanged = 0;

async function until(predicate, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

before(async () => {
  client = new Client({ name: 'test', version: '1.0.0' });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChanged++;
  });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: { ...process.env, FOUNDRY_MCP_TOKEN: TOKEN, FOUNDRY_MCP_PORT: String(PORT) },
      stderr: 'ignore',
    })
  );
  mcpBridge.start();
  assert.ok(await until(() => mcpBridge.state === 'connected'), `bridge state: ${mcpBridge.state}`);
});

after(async () => {
  mcpBridge.stop();
  await client?.close();
});

test('the server announces itself with usage instructions', () => {
  assert.equal(client.getServerVersion().name, 'foundry-vtt');
  assert.match(client.getInstructions(), /get_world_context/);
});

test('Foundry tools are listed with UI-only parameters removed', async () => {
  assert.ok(await until(() => listChanged > 0), 'tools/list_changed sent when Foundry connected');
  const { tools } = await client.listTools();
  const names = tools.map(t => t.name);
  for (const expected of [
    'foundry_status',
    'get_world_context',
    'read_tool_output',
    'read_document',
    'create_document',
    'run_javascript',
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  for (const hidden of ['end_loop', 'manage_task'])
    assert.ok(!names.includes(hidden), `${hidden} must not be exposed`);
  assert.equal(names.filter(n => n === 'read_tool_output').length, 1);

  const create = tools.find(t => t.name === 'create_document');
  assert.equal(create.inputSchema.type, 'object');
  assert.ok(!('justification' in create.inputSchema.properties));
  assert.ok(!('response' in create.inputSchema.properties));
  assert.ok(!(create.inputSchema.required ?? []).includes('justification'));
  assert.equal(create.annotations.destructiveHint, true);
  assert.equal(tools.find(t => t.name === 'read_document').annotations.readOnlyHint, true);
});

test('table tools are offered with read-only and destructive hints', async () => {
  const { tools } = await client.listTools();
  const byName = new Map(tools.map(t => [t.name, t]));
  for (const name of [
    'roll_dice',
    'roll_check',
    'use_item',
    'combat_start',
    'move_token',
    'apply_damage',
    'play_audio',
  ]) {
    assert.ok(byName.has(name), `missing ${name}`);
  }
  assert.equal(byName.get('list_tokens').annotations.readOnlyHint, true);
  assert.equal(byName.get('read_chat').annotations.readOnlyHint, true);
  assert.equal(byName.get('remove_token').annotations.destructiveHint, true);
  assert.equal(byName.get('roll_dice').annotations.readOnlyHint, undefined);
  assert.ok(!('justification' in byName.get('roll_check').inputSchema.properties));
});

test('foundry_status and get_world_context describe the connected world', async () => {
  const status = await client.callTool({ name: 'foundry_status', arguments: {} });
  assert.match(status.content[0].text, /World: Cragmaw Hideout/);
  assert.match(status.content[0].text, /System: dnd5e 3\.3\.1/);

  const context = await client.callTool({ name: 'get_world_context', arguments: {} });
  const text = context.content[0].text;
  assert.ok(!context.isError);
  assert.match(text, /Foundry VTT: 12\.331/);
  assert.match(text, /Actor: \[character, npc\]/);
  assert.match(text, /- Actor: 1/);
  assert.match(text, /Active scene: Goblin Ambush/);
  assert.match(text, /dnd5e\.monsters: Monsters \[Actor\] \(locked\)/);
  assert.match(text, /Use British spelling\./);
});

test('a real Simulacrum tool runs in the browser and returns its text', async () => {
  const result = await client.callTool({ name: 'list_document_schemas', arguments: {} });
  assert.ok(!result.isError, result.content[0].text);
  assert.match(result.content[0].text, /Actor/);
});

test('tool failures come back as MCP errors', async () => {
  const result = await client.callTool({
    name: 'read_document',
    arguments: { documentType: 'Nope', documentId: 'x' },
  });
  assert.equal(result.isError, true);
  assert.ok(result.content[0].text.length > 0);
});

test('large results are stored and readable with read_tool_output', async () => {
  const huge = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}: ${'x'.repeat(20)}`).join(
    '\n'
  );
  toolRegistry.tools.get('list_document_schemas').tool.execute = async () => ({ content: huge });
  try {
    const first = await client.callTool({ name: 'list_document_schemas', arguments: {} });
    const text = first.content[0].text;
    assert.ok(text.length < 10000, 'returned a preview, not everything');
    const id = /output_id "([^"]+)"/.exec(text)?.[1];
    assert.ok(id, text.slice(-300));
    const more = await client.callTool({
      name: 'read_tool_output',
      arguments: { output_id: id, start_line: 4999, end_line: 5000 },
    });
    assert.match(more.content[0].text, /Lines 4999-5000 of 5000/);
    assert.match(more.content[0].text, /line 5000: x+/);
  } finally {
    toolRegistry.tools.get('list_document_schemas').tool.execute = Object.getPrototypeOf(
      toolRegistry.tools.get('list_document_schemas').tool
    ).execute;
  }
});

test('tools blocked in Simulacrum permissions are hidden and refused', async () => {
  await toolPermissionManager.setPermission('run_javascript', 'deny');
  try {
    const { tools } = await client.listTools();
    assert.ok(!tools.some(t => t.name === 'run_javascript'));
    const result = await client.callTool({
      name: 'run_javascript',
      arguments: { script: 'return 1' },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /blocked/);
  } finally {
    await toolPermissionManager.setPermission('run_javascript', 'ask');
  }
});

test('a wrong token is rejected and nothing is exposed', async () => {
  mcpBridge.stop();
  settings.set('simulacrum.mcpBridgeToken', 'wrong-token');
  mcpBridge.restart();
  assert.ok(await until(() => mcpBridge.state === 'rejected'), `state: ${mcpBridge.state}`);
  assert.match(mcpBridge.lastError, /Token mismatch/);
  const result = await client.callTool({
    name: 'read_document',
    arguments: { documentType: 'Actor', documentId: 'a1' },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not connected/);

  settings.set('simulacrum.mcpBridgeToken', TOKEN);
  mcpBridge.restart();
  assert.ok(await until(() => mcpBridge.state === 'connected'), `state: ${mcpBridge.state}`);
});

test('Foundry opened before Claude Code connects once the server starts', async () => {
  const port = PORT + 1;
  mcpBridge.stop();
  settings.set('simulacrum.mcpBridgePort', port);
  mcpBridge.restart();
  assert.ok(await until(() => mcpBridge.state === 'waiting', 4000), `state: ${mcpBridge.state}`);
  await new Promise(r => setTimeout(r, 1500)); // a few failed attempts while no server exists

  const late = new Client({ name: 'late', version: '1.0.0' });
  await late.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: { ...process.env, FOUNDRY_MCP_TOKEN: TOKEN, FOUNDRY_MCP_PORT: String(port) },
      stderr: 'ignore',
    })
  );
  try {
    assert.ok(
      await until(() => mcpBridge.state === 'connected', 6000),
      `state: ${mcpBridge.state}`
    );
    const status = await late.callTool({ name: 'foundry_status', arguments: {} });
    assert.match(status.content[0].text, /World: Cragmaw Hideout/);
  } finally {
    await late.close();
    mcpBridge.stop();
    settings.set('simulacrum.mcpBridgePort', PORT);
    mcpBridge.restart();
    await until(() => mcpBridge.state === 'connected');
  }
});
