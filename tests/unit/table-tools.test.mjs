/**
 * Table tools (scripts/tools/table) against a fake Foundry v12 + dnd5e 3.x
 * world. Each test checks the system/core calls a tool makes and what it
 * reports back to the agent.
 */

import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

import { installFakeFoundry } from './helpers/fake-foundry.mjs';

installFakeFoundry();
const { TABLE_TOOL_SPECS } = await import('../../scripts/tools/table/index.js');
const { TableTool } = await import('../../scripts/tools/table/table-tool.js');

let world;
const tools = new Map(TABLE_TOOL_SPECS.map(spec => [spec.name, new TableTool(spec)]));
const called = what => world.calls.filter(c => c[0] === what);

async function run(name, args = {}) {
  const result = await tools.get(name).execute(args);
  return { text: result.content, error: result.error };
}

async function ok(name, args) {
  const { text, error } = await run(name, args);
  assert.equal(error, undefined, `${name} failed: ${text}`);
  return text;
}

beforeEach(() => {
  world = installFakeFoundry();
});

test('all 27 table tools exist with provider-safe schemas', () => {
  assert.equal(TABLE_TOOL_SPECS.length, 27);
  assert.equal(new Set(TABLE_TOOL_SPECS.map(s => s.name)).size, 27);
  for (const tool of tools.values()) {
    const schema = tool.getParameterSchema();
    assert.equal(schema.type, 'object', tool.name);
    for (const [key, prop] of Object.entries(schema.properties)) {
      assert.equal(typeof prop.type, 'string', `${tool.name}.${key} must have a single type`);
    }
    assert.ok(tool.description.length > 20, tool.name);
  }
  const readOnly = TABLE_TOOL_SPECS.filter(s => s.readOnly)
    .map(s => s.name)
    .sort();
  assert.deepEqual(readOnly, [
    'combat_status',
    'get_actor_status',
    'get_distance',
    'list_tokens',
    'read_chat',
  ]);
});

test('roll_dice rolls in Foundry and posts with the chosen visibility', async () => {
  const text = await ok('roll_dice', { formula: '2d6', label: 'Falling rocks', visibility: 'gm' });
  assert.match(text, /Falling rocks: 2d6 = 7 \[2d6: 3, 4\]/);
  const [, formula, data, opts] = called('roll.toMessage')[0];
  assert.equal(formula, '2d6');
  assert.equal(data.flavor, 'Falling rocks');
  assert.equal(opts.rollMode, 'gmroll');
});

test('roll_check uses the dnd5e roll with advantage, DC and fast-forward', async () => {
  const text = await ok('roll_check', {
    actor: 'Brenna',
    type: 'skill',
    name: 'stealth',
    dc: 15,
    advantage: true,
  });
  const [, who, skill, opts] = called('rollSkill')[0];
  assert.equal(who, 'Brenna');
  assert.equal(skill, 'ste');
  assert.equal(opts.advantage, true);
  assert.equal(opts.fastForward, true);
  assert.equal(opts.targetValue, 15);
  assert.match(text, /Brenna Stealth check: 14 .*FAILURE vs DC 15/);
});

test('roll_check rolls a group save and reports unknown skills helpfully', async () => {
  const text = await ok('roll_check', {
    actors: ['Brenna', 'tG1'],
    type: 'save',
    name: 'dexterity',
    dc: 12,
  });
  assert.equal(called('rollAbilitySave').length, 2);
  assert.match(text, /Brenna Dexterity save: 9 .*FAILURE/);
  const bad = await run('roll_check', { actor: 'Brenna', type: 'skill', name: 'juggling' });
  assert.ok(bad.error);
  assert.match(bad.text, /Unknown skill "juggling".*ste \(Stealth\)/);
});

test('ambiguous names fail with the candidates instead of guessing', async () => {
  const { text, error } = await run('roll_check', { actor: 'Goblin', type: 'save', name: 'dex' });
  assert.ok(error);
  assert.match(
    text,
    /"Goblin" matches 2 documents: Goblin \(token tG1 at col 3, row 2\); Goblin \(token tG2/
  );
});

test('use_item attack_and_damage hits by AC, rolls damage and applies it', async () => {
  const text = await ok('use_item', {
    actor: 'Brenna',
    item: 'Longsword',
    mode: 'attack_and_damage',
    targets: ['tG1'],
    apply_damage: true,
  });
  assert.deepEqual(called('targets')[0][1], ['tG1']);
  assert.equal(called('rollAttack')[0][2].fastForward, true);
  assert.match(text, /Goblin \(AC 15\): HIT/);
  assert.match(text, /Damage from Longsword: 6 damage \(6 slashing\)/);
  assert.deepEqual(called('applyDamage')[0][2], [{ value: 6, type: 'slashing' }]);
  assert.match(text, /Goblin: HP 7 -> 1/);
});

test('use_item "use" posts the item card without a dialog', async () => {
  const text = await ok('use_item', { actor: 'Brenna', item: 'longsword' });
  const [, name, , options] = called('use')[0];
  assert.equal(name, 'Longsword');
  assert.equal(options.configureDialog, false);
  assert.match(text, /Brenna used Longsword/);
});

test('roll_table draws and shows the result', async () => {
  const text = await ok('roll_table', { table: 'Cave Encounters' });
  assert.equal(called('table.draw')[0][1].displayChat, true);
  assert.match(text, /rolled 4 -> 1d4 giant rats/);
});

test('post_message narrates, speaks in character, and whispers', async () => {
  await ok('post_message', { text: 'The cave is dark.\n\nWater drips.' });
  let data = called('ChatMessage.create')[0][1];
  assert.equal(data.speaker.alias, 'Narrator');
  assert.equal(data.style, 0);
  assert.equal(data.content, '<p>The cave is dark.</p><p>Water drips.</p>');

  await ok('post_message', { text: 'Who goes there?', speaker: 'tG1', whisper_to: ['gm'] });
  data = called('ChatMessage.create')[1][1];
  assert.equal(data.style, 2);
  assert.equal(data.speaker.token, 'tG1');
  assert.deepEqual(data.whisper, ['gm']);
});

test('read_chat returns readable messages with roll totals', async () => {
  const text = await ok('read_chat', { limit: 5 });
  assert.match(text, /Alice\n {2}I sneak to the cave\./);
  assert.match(text, /Brenna \(skill\) - Stealth Check\n {2}rolls: 1d20 \+ 4 = 17/);
});

test('show_handout shows a journal to players', async () => {
  await ok('show_handout', { journal: 'Cave Map Handout' });
  assert.equal(called('Journal.show')[0][2].force, true);
});

test('combat: start, status, next turn, defeat, initiative, end', async () => {
  let text = await ok('combat_start', {});
  assert.equal(called('combat.create')[0][2].length, 3);
  assert.equal(called('rollNPC').length, 1);
  assert.match(text, /Round 1, turn 1\. Current: Goblin/);
  assert.match(text, /> 1\. Goblin \| init 20/);

  text = await ok('combat_control', { action: 'next_turn' });
  assert.match(text, /Current: Goblin/);
  text = await ok('combat_control', { action: 'defeated', tokens: ['tG1'] });
  assert.match(text, /DEFEATED/);
  assert.deepEqual(called('toggleStatusEffect')[0].slice(2), [
    'dead',
    { active: true, overlay: true },
  ]);
  text = await ok('combat_control', {
    action: 'set_initiative',
    tokens: ['Brenna'],
    initiative: 25,
  });
  assert.match(text, /1\. Brenna \| init 25/);
  assert.match(await ok('combat_status', {}), /Brenna \| init 25/);
  assert.match(await ok('combat_control', { action: 'end' }), /ended/);
  assert.equal(world.game.combats.size, 0);
});

test('list_tokens shows positions, disposition, HP and hidden state', async () => {
  const text = await ok('list_tokens', {});
  assert.match(text, /one square = 5 ft/);
  assert.match(text, /Brenna \(token tPC\) \| col 2, row 2 \| friendly \| HP 20\/28 \| player/);
  assert.match(text, /Goblin \(token tG2\) \| col 8, row 6 \| hostile \| HP 7\/7 \| HIDDEN/);
});

test('move_token moves to a square, next to a token, or by direction', async () => {
  let text = await ok('move_token', { token: 'tG1', col: 5, row: 5 });
  assert.deepEqual(called('token.update')[0].slice(2), [{ x: 600, y: 600 }, { animate: true }]);
  assert.match(text, /from col 3, row 2 to col 5, row 5 \(15 ft\)/);

  text = await ok('move_token', { token: 'tG1', direction: 'east', feet: 10 });
  assert.match(text, /to col 7, row 5 \(10 ft\)/);

  text = await ok('move_token', { token: 'Brenna', near: 'tG2' });
  const to = /to col (\d+), row (\d+)/.exec(text).slice(1).map(Number);
  assert.equal(Math.max(Math.abs(to[0] - 8), Math.abs(to[1] - 6)), 1, 'adjacent to the goblin');
});

test('place_token spawns several monsters in free squares', async () => {
  const text = await ok('place_token', { actor: 'gob1', near: 'tPC', count: 3, hidden: true });
  const [, type, data] = called('scene.create')[0];
  assert.equal(type, 'Token');
  assert.equal(data.length, 3);
  const cells = data.map(d => `${d.x},${d.y}`);
  assert.equal(new Set(cells).size, 3, 'distinct squares');
  assert.ok(!cells.includes('300,300') && !cells.includes('400,300'), 'not on existing tokens');
  assert.ok(data.every(d => d.hidden === true));
  assert.match(text, /Placed 3 x Goblin/);
  const ambiguous = await run('place_token', { actor: 'Goblin', col: 1, row: 1 });
  assert.ok(ambiguous.error);
});

test('remove_token, set_token_hidden and get_distance', async () => {
  assert.match(
    await ok('get_distance', { from: 'tPC', to: ['tG1', 'tG2'] }),
    /Goblin: 5 ft \(1 square\)\nBrenna -> Goblin: 30 ft \(6 squares\)/
  );
  await ok('set_token_hidden', { tokens: ['tG2'], hidden: false });
  assert.deepEqual(called('scene.update')[0][2], [{ _id: 'tG2', hidden: false }]);
  await ok('remove_token', { tokens: ['tG2'] });
  assert.deepEqual(called('scene.delete')[0][2], ['tG2']);
});

test('activate_scene, pan_to and toggle_door', async () => {
  await ok('activate_scene', { scene: 'Cragmaw Cave' });
  assert.equal(called('scene.activate').length, 1);
  await ok('pan_to', { token: 'tG1' });
  assert.deepEqual(called('canvas.ping')[0].slice(1), [{ x: 450, y: 350 }, { pull: true }]);
  assert.match(await ok('toggle_door', {}), /door door1 at col 4, row 1: closed/);
  assert.match(await ok('toggle_door', { action: 'open', near: 'tPC' }), /now open/);
  assert.deepEqual(called('wall.update')[0][2], { ds: 1 });
});

test('get_actor_status gives a compact 5e sheet', async () => {
  const text = await ok('get_actor_status', { actor: 'Brenna' });
  assert.match(text, /Brenna \(character, level 3\)/);
  assert.match(text, /HP 20\/28 \| AC 16 \| initiative \+2 \| proficiency \+2/);
  assert.match(text, /STR 16 \(\+3, save \+5\*\)/);
  assert.match(text, /Weapons: Longsword to hit \+5 1d8\+3/);
  assert.match(text, /Currency: 10 gp, 0 sp/);
  assert.match(text, /XP: 900\/2700/);
});

test('apply_damage handles typed damage, halving, healing, temp HP and defeat', async () => {
  let text = await ok('apply_damage', { targets: ['tG1'], amount: 7, type: 'fire' });
  assert.deepEqual(called('applyDamage')[0][2], [{ value: 7, type: 'fire' }]);
  assert.match(text, /Goblin: HP 7\/7 -> HP 0\/7 - DEFEATED/);
  text = await ok('apply_damage', { targets: ['Brenna'], amount: 10, half: true });
  assert.equal(called('applyDamage')[1][3].multiplier, 0.5);
  assert.match(text, /HP 20\/28 -> HP 15\/28/);
  text = await ok('apply_damage', { targets: ['Brenna'], amount: 5, type: 'healing' });
  assert.match(text, /Healed:\nBrenna: HP 15\/28 -> HP 20\/28/);
  await ok('apply_damage', { targets: ['Brenna'], amount: 4, type: 'temphp' });
  assert.equal(called('applyTempHP')[0][2], 4);
});

test('set_condition toggles conditions and sets exhaustion', async () => {
  assert.match(await ok('set_condition', { actors: ['tPC'], condition: 'Prone' }), /now Prone/);
  assert.deepEqual(called('toggleStatusEffect')[0].slice(2), [
    'prone',
    { active: true, overlay: false },
  ]);
  await ok('set_condition', { actors: ['tPC'], condition: 'prone', active: false });
  assert.match(
    await ok('set_condition', { actors: ['Brenna'], condition: 'exhaustion', level: 2 }),
    /exhaustion 2/
  );
  assert.ok((await run('set_condition', { actors: ['Brenna'], condition: 'sparkly' })).error);
});

test('rest runs 5e short and long rests without dialogs', async () => {
  assert.match(
    await ok('rest', { actors: ['Brenna'], type: 'short' }),
    /Short rest:\nBrenna: HP 20\/28 -> HP 25\/28, hit dice -1/
  );
  assert.deepEqual(called('shortRest')[0][2], { dialog: false, chat: true, autoHD: true });
  await ok('rest', { actors: ['Brenna'], type: 'long' });
  assert.deepEqual(called('longRest')[0][2], { dialog: false, chat: true, newDay: true });
});

test('award gives XP and coin to the party and announces it', async () => {
  const text = await ok('award', { xp: 300, currency: { gp: 50 } });
  assert.deepEqual(called('actor.update')[0][2], {
    'system.details.xp.value': 1200,
    'system.currency.gp': 60,
  });
  assert.match(text, /Brenna: \+300 XP, \+50 gp/);
  assert.equal(called('ChatMessage.create').length, 1);
});

test('advance_time and play_audio', async () => {
  assert.match(
    await ok('advance_time', { minutes: 10 }),
    /Advanced 600 seconds\. World time: day 1, 01:10/
  );
  assert.match(await ok('advance_time', {}), /day 1, 01:10/);
  assert.match(await ok('play_audio', {}), /Dungeon Ambience \[pl1\]: Cave Drips/);
  await ok('play_audio', { action: 'play', playlist: 'Dungeon Ambience' });
  await ok('play_audio', { action: 'play', playlist: 'pl1', sound: 'cave drips' });
  assert.equal(called('playlist.playAll').length, 1);
  assert.equal(called('playlist.playSound')[0][1], 'Cave Drips');
  assert.match(await ok('play_audio', { action: 'stop_all' }), /Stopped 1 playlist/);
});
