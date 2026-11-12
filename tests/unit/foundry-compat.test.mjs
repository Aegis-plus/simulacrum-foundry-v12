import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';

import {
  buildUuid,
  getActiveSidebarTab,
  hasApplicationV2Sidebar,
  loadTemplates,
  renderTemplate,
} from '../../scripts/utils/foundry-compat.js';

const GLOBALS = ['foundry', 'ui', 'renderTemplate', 'loadTemplates'];
const saved = Object.fromEntries(GLOBALS.map(name => [name, globalThis[name]]));

afterEach(() => {
  for (const name of GLOBALS) {
    if (saved[name] === undefined) delete globalThis[name];
    else globalThis[name] = saved[name];
  }
});

test('detects the v13+ ApplicationV2 sidebar and the v12 v1 sidebar', () => {
  globalThis.foundry = { applications: { sidebar: { AbstractSidebarTab: class {} } } };
  assert.equal(hasApplicationV2Sidebar(), true);
  globalThis.foundry = { applications: { api: {} } };
  assert.equal(hasApplicationV2Sidebar(), false);
});

test('renderTemplate/loadTemplates prefer the v13 namespace and fall back to v12 globals', async () => {
  globalThis.foundry = {
    applications: {
      handlebars: {
        renderTemplate: async path => `v13:${path}`,
        loadTemplates: async paths => `v13:${paths.length}`,
      },
    },
  };
  assert.equal(await renderTemplate('a.hbs', {}), 'v13:a.hbs');
  assert.equal(await loadTemplates(['a', 'b']), 'v13:2');

  globalThis.foundry = { applications: {} };
  globalThis.renderTemplate = async path => `v12:${path}`;
  globalThis.loadTemplates = async paths => `v12:${paths.length}`;
  assert.equal(await renderTemplate('a.hbs', {}), 'v12:a.hbs');
  assert.equal(await loadTemplates(['a']), 'v12:1');

  delete globalThis.loadTemplates;
  assert.equal(loadTemplates(['a']), undefined);
});

test('buildUuid uses core when available and otherwise builds v12-style UUIDs', () => {
  globalThis.foundry = { utils: { buildUuid: ({ id }) => `core:${id}` } };
  assert.equal(buildUuid({ documentName: 'Actor', id: 'abc' }), 'core:abc');

  globalThis.foundry = { utils: {} };
  assert.equal(buildUuid({ documentName: 'Actor', id: 'abc' }), 'Actor.abc');
  assert.equal(
    buildUuid({ documentName: 'Item', id: 'xyz', pack: 'world.items' }),
    'Compendium.world.items.Item.xyz'
  );
  assert.throws(() => buildUuid({ documentName: 'Item' }));
});

test('getActiveSidebarTab reads v13 tabGroups or the v12 activeTab', () => {
  globalThis.ui = { sidebar: { tabGroups: { primary: 'simulacrum' } } };
  assert.equal(getActiveSidebarTab(), 'simulacrum');
  globalThis.ui = { sidebar: { activeTab: 'chat' } };
  assert.equal(getActiveSidebarTab(), 'chat');
  globalThis.ui = {};
  assert.equal(getActiveSidebarTab(), undefined);
});
