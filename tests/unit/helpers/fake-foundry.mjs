/**
 * A small fake Foundry VTT v12 + dnd5e 3.x world for testing the table tools
 * in Node. It models only what the tools touch, and records every call so
 * tests can assert on the exact system API usage.
 */

export class FakeCollection extends Map {
  constructor(docs = []) {
    super(docs.map(d => [d.id, d]));
  }
  get contents() {
    return [...this.values()];
  }
  find(fn) {
    return this.contents.find(fn);
  }
  filter(fn) {
    return this.contents.filter(fn);
  }
  some(fn) {
    return this.contents.some(fn);
  }
  map(fn) {
    return this.contents.map(fn);
  }
  getName(name) {
    return this.contents.find(d => d.name === name);
  }
}

export const calls = [];
const record = (what, ...args) => calls.push([what, ...args]);

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (const key of keys.slice(0, -1)) cur = cur[key] ??= {};
  cur[keys.at(-1)] = value;
}

export function fakeD20(total, natural = 10) {
  return {
    total,
    formula: '1d20 + 5',
    dice: [{ formula: '1d20', results: [{ result: natural, active: true }] }],
    isCritical: natural === 20,
    isFumble: natural === 1,
  };
}

class FakeItem {
  constructor(data) {
    Object.assign(this, { system: {}, labels: {}, hasAttack: false, hasDamage: false }, data);
  }
  async rollAttack(opts) {
    record('rollAttack', this.name, opts);
    return fakeD20(this.attackTotal ?? 15, this.attackNatural ?? 10);
  }
  async rollDamage(cfg) {
    record('rollDamage', this.name, cfg);
    return [{ total: cfg.critical ? 12 : 6, options: { type: 'slashing' } }];
  }
  async use(config, options) {
    record('use', this.name, config, options);
    return { id: 'msg-use' };
  }
}

export class FakeActor {
  constructor(data) {
    Object.assign(this, { type: 'npc', hasPlayerOwner: false, documentName: 'Actor' }, data);
    this.uuid = `Actor.${this.id}`;
    this.statuses = new Set(data.statuses ?? []);
    this.items = new FakeCollection(
      (data.items ?? []).map(i => new FakeItem({ ...i, actor: this }))
    );
  }
  getRollData() {
    return { abilities: this.system.abilities };
  }
  getFlag() {
    return undefined;
  }
  async update(data) {
    record('actor.update', this.name, data);
    for (const [path, value] of Object.entries(data)) setPath(this, path, value);
  }
  async rollSkill(id, opts) {
    record('rollSkill', this.name, id, opts);
    return fakeD20(this.nextRoll ?? 14);
  }
  async rollAbilityTest(id, opts) {
    record('rollAbilityTest', this.name, id, opts);
    return fakeD20(this.nextRoll ?? 14);
  }
  async rollAbilitySave(id, opts) {
    record('rollAbilitySave', this.name, id, opts);
    return fakeD20(this.nextRoll ?? 9);
  }
  async rollDeathSave(opts) {
    record('rollDeathSave', this.name, opts);
    return fakeD20(12);
  }
  async applyDamage(damages, opts) {
    record('applyDamage', this.name, damages, opts);
    const hp = this.system.attributes.hp;
    for (const d of damages) {
      const value = Math.floor(d.value * (opts?.multiplier ?? 1));
      if (d.type === 'healing') hp.value = Math.min(hp.max, hp.value + value);
      else hp.value = Math.max(0, hp.value - value);
    }
  }
  async applyTempHP(amount) {
    record('applyTempHP', this.name, amount);
    this.system.attributes.hp.temp = amount;
  }
  async toggleStatusEffect(id, opts) {
    record('toggleStatusEffect', this.name, id, opts);
    if (opts.active) this.statuses.add(id);
    else this.statuses.delete(id);
  }
  async shortRest(config) {
    record('shortRest', this.name, config);
    this.system.attributes.hp.value = Math.min(
      this.system.attributes.hp.max,
      this.system.attributes.hp.value + 5
    );
    return { dhd: -1 };
  }
  async longRest(config) {
    record('longRest', this.name, config);
    this.system.attributes.hp.value = this.system.attributes.hp.max;
    return { dhd: 2 };
  }
  async getTokenDocument(overrides) {
    const data = {
      name: this.name,
      actorId: this.id,
      width: 1,
      height: 1,
      disposition: -1,
      ...overrides,
    };
    return { toObject: () => data };
  }
}

export class FakeToken {
  constructor(scene, data) {
    Object.assign(
      this,
      { width: 1, height: 1, hidden: false, disposition: -1, documentName: 'Token' },
      data
    );
    this.parent = scene;
    this.uuid = `Scene.${scene.id}.Token.${this.id}`;
  }
  get actor() {
    return globalThis.game.actors.get(this.actorId);
  }
  get inCombat() {
    return globalThis.game.combats.some(c => c.combatants.some(x => x.tokenId === this.id));
  }
  async update(data, opts) {
    record('token.update', this.name, data, opts);
    Object.assign(this, data);
  }
}

class FakeWall {
  constructor(data) {
    Object.assign(this, data);
  }
  async update(data) {
    record('wall.update', this.id, data);
    Object.assign(this, data);
  }
}

let nextId = 100;
export class FakeScene {
  constructor(data) {
    Object.assign(this, { documentName: 'Scene' }, data);
    this.grid = { size: 100, distance: 5, units: 'ft', type: 1 };
    this.dimensions = { sceneX: 100, sceneY: 100, sceneWidth: 2000, sceneHeight: 1500 };
    this.tokens = new FakeCollection((data.tokens ?? []).map(t => new FakeToken(this, t)));
    this.walls = new FakeCollection((data.walls ?? []).map(w => new FakeWall(w)));
  }
  async createEmbeddedDocuments(type, data) {
    record('scene.create', type, data);
    const created = data.map(d => new FakeToken(this, { ...d, id: `new${nextId++}` }));
    created.forEach(t => this.tokens.set(t.id, t));
    return created;
  }
  async deleteEmbeddedDocuments(type, ids) {
    record('scene.delete', type, ids);
    ids.forEach(id => this.tokens.delete(id));
  }
  async updateEmbeddedDocuments(type, updates) {
    record('scene.update', type, updates);
    updates.forEach(u => Object.assign(this.tokens.get(u._id), u));
  }
  async activate() {
    record('scene.activate', this.name);
  }
  async view() {
    record('scene.view', this.name);
  }
}

class FakeCombatant {
  constructor(combat, data) {
    Object.assign(this, { initiative: null, defeated: false, hidden: false }, data);
    this.combat = combat;
    this.id = `c-${data.tokenId}`;
  }
  get token() {
    return this.combat.scene.tokens.get(this.tokenId);
  }
  get name() {
    return this.token?.name;
  }
  get actor() {
    return this.token?.actor;
  }
  async update(data) {
    record('combatant.update', this.name, data);
    Object.assign(this, data);
  }
}

export class FakeCombat {
  constructor(data) {
    this.id = `combat${nextId++}`;
    this.scene = globalThis.game.scenes.get(data.scene);
    this.round = 0;
    this.turn = 0;
    this.started = false;
    this.combatants = new FakeCollection();
  }
  static async create(data) {
    record('Combat.create', data);
    const combat = new FakeCombat(data);
    globalThis.game.combats.set(combat.id, combat);
    return combat;
  }
  get turns() {
    return [...this.combatants.contents].sort(
      (a, b) => (b.initiative ?? -99) - (a.initiative ?? -99)
    );
  }
  get combatant() {
    return this.started ? this.turns[this.turn] : null;
  }
  async createEmbeddedDocuments(type, data) {
    record('combat.create', type, data);
    data.forEach(d => {
      const c = new FakeCombatant(this, d);
      this.combatants.set(c.id, c);
    });
  }
  async deleteEmbeddedDocuments(type, ids) {
    record('combat.delete', type, ids);
    ids.forEach(id => this.combatants.delete(id));
  }
  async rollNPC() {
    record('rollNPC');
    let init = 20;
    this.combatants.filter(c => !c.actor?.hasPlayerOwner).forEach(c => (c.initiative = init--));
  }
  async rollAll() {
    record('rollAll');
    this.combatants.contents.forEach((c, i) => (c.initiative ??= 5 + i));
  }
  async rollInitiative(ids) {
    record('rollInitiative', ids);
    ids.forEach(id => (this.combatants.get(id).initiative = 11));
  }
  async setInitiative(id, value) {
    record('setInitiative', id, value);
    this.combatants.get(id).initiative = value;
  }
  async startCombat() {
    record('startCombat');
    Object.assign(this, { started: true, round: 1, turn: 0 });
  }
  async nextTurn() {
    record('nextTurn');
    this.turn = (this.turn + 1) % this.turns.length;
  }
  async previousTurn() {
    this.turn = Math.max(0, this.turn - 1);
  }
  async nextRound() {
    this.round++;
    this.turn = 0;
  }
  async previousRound() {
    this.round = Math.max(1, this.round - 1);
  }
  async delete() {
    record('combat.deleteCombat', this.id);
    globalThis.game.combats.delete(this.id);
  }
}

export class FakeRoll {
  constructor(formula, data) {
    this.formula = formula;
    this.data = data;
  }
  async evaluate() {
    this.total = 7;
    this.dice = [{ formula: '2d6', results: [{ result: 3 }, { result: 4 }] }];
    return this;
  }
  async toMessage(data, opts) {
    record('roll.toMessage', this.formula, data, opts);
  }
}

function makePlaylist() {
  const sounds = new FakeCollection([{ id: 'snd1', name: 'Cave Drips', playing: false }]);
  return {
    id: 'pl1',
    name: 'Dungeon Ambience',
    playing: false,
    sounds,
    async playAll() {
      record('playlist.playAll', this.name);
      this.playing = true;
    },
    async stopAll() {
      record('playlist.stopAll', this.name);
      this.playing = false;
    },
    async playSound(sound) {
      record('playlist.playSound', sound.name);
    },
    async stopSound(sound) {
      record('playlist.stopSound', sound.name);
    },
  };
}

const LABELS = {
  'DND5E.SkillSte': 'Stealth',
  'DND5E.SkillPrc': 'Perception',
  'DND5E.AbilityDex': 'Dexterity',
  'DND5E.AbilityWis': 'Wisdom',
  'DND5E.AbilityStr': 'Strength',
  'EFFECT.DND5E.StatusProne': 'Prone',
  'EFFECT.DND5E.StatusPoisoned': 'Poisoned',
  'EFFECT.DND5E.StatusDead': 'Dead',
};

function makeActors() {
  const fighter = new FakeActor({
    id: 'pc1',
    name: 'Brenna',
    type: 'character',
    hasPlayerOwner: true,
    system: {
      attributes: {
        hp: { value: 20, max: 28, temp: 0 },
        ac: { value: 16 },
        init: { total: 2 },
        prof: 2,
        movement: { walk: 30, units: 'ft' },
        death: { success: 0, failure: 0 },
        exhaustion: 0,
      },
      abilities: {
        str: { value: 16, mod: 3, save: 5, proficient: 1 },
        dex: { value: 14, mod: 2, save: 2 },
      },
      skills: { prc: { passive: 12 } },
      details: { level: 3, xp: { value: 900, max: 2700 } },
      currency: { gp: 10, sp: 0 },
    },
    items: [
      {
        id: 'it1',
        name: 'Longsword',
        type: 'weapon',
        hasAttack: true,
        hasDamage: true,
        labels: { toHit: '+5', damage: '1d8+3' },
      },
    ],
  });
  const goblin = i =>
    new FakeActor({
      id: `gob${i}`,
      name: 'Goblin',
      system: {
        attributes: {
          hp: { value: 7, max: 7, temp: 0 },
          ac: { value: 15 },
          movement: { walk: 30 },
        },
        abilities: { dex: { value: 14, mod: 2, save: 2 } },
        details: { cr: 0.25 },
      },
      items: [{ id: 'sc', name: 'Scimitar', type: 'weapon', hasAttack: true, hasDamage: true }],
    });
  return [fighter, goblin(1), goblin(2)];
}

/** Install the fake world on globalThis and return handles to it. */
export function installFakeFoundry() {
  calls.length = 0;
  const actors = makeActors();
  const g = {
    system: { id: 'dnd5e', version: '3.3.1' },
    i18n: { localize: k => LABELS[k] ?? k, format: k => k },
    actors: new FakeCollection(actors),
    users: new FakeCollection([
      { id: 'gm', name: 'Gamemaster', isGM: true },
      { id: 'p1', name: 'Alice', isGM: false },
    ]),
    combats: new FakeCollection(),
    messages: new FakeCollection(),
    tables: new FakeCollection([
      {
        id: 'tb1',
        name: 'Cave Encounters',
        async draw(opts) {
          record('table.draw', opts);
          return { roll: { total: 4 }, results: [{ text: '1d4 giant rats' }] };
        },
      },
    ]),
    playlists: new FakeCollection([makePlaylist()]),
    time: {
      worldTime: 3600,
      async advance(s) {
        record('time.advance', s);
        this.worldTime += s;
      },
    },
    journal: new FakeCollection([
      { id: 'j1', name: 'Cave Map Handout', documentName: 'JournalEntry' },
    ]),
  };
  g.combats.active = undefined;
  Object.defineProperty(g.combats, 'active', { get: () => g.combats.contents[0] });
  g.user = {
    ...g.users.get('gm'),
    async updateTokenTargets(ids) {
      record('targets', ids);
    },
  };
  globalThis.game = g;
  const scene = new FakeScene({
    id: 'sc1',
    name: 'Cragmaw Cave',
    tokens: [
      { id: 'tPC', name: 'Brenna', actorId: 'pc1', disposition: 1, x: 300, y: 300 },
      { id: 'tG1', name: 'Goblin', actorId: 'gob1', x: 400, y: 300 },
      { id: 'tG2', name: 'Goblin', actorId: 'gob2', x: 900, y: 700, hidden: true },
    ],
    walls: [{ id: 'door1', door: 1, ds: 0, c: [500, 200, 500, 300] }],
  });
  g.scenes = new FakeCollection([scene]);
  g.scenes.viewed = scene;
  g.scenes.active = scene;
  g.messages.set('m1', {
    id: 'm1',
    timestamp: Date.now(),
    speaker: { alias: 'Alice' },
    content: '<p>I sneak to the <strong>cave</strong>.</p>',
    rolls: [],
  });
  g.messages.set('m2', {
    id: 'm2',
    timestamp: Date.now(),
    speaker: { alias: 'Brenna' },
    flavor: 'Stealth Check',
    content: '17',
    rolls: [{ formula: '1d20 + 4', total: 17 }],
    flags: { dnd5e: { roll: { type: 'skill' } } },
  });

  globalThis.CONST = {
    TOKEN_DISPOSITIONS: { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 },
    CHAT_MESSAGE_STYLES: { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 },
    WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
  };
  globalThis.CONFIG = {
    debug: {},
    DND5E: {
      skills: {
        ste: { label: 'DND5E.SkillSte', fullKey: 'stealth', ability: 'dex' },
        prc: { label: 'DND5E.SkillPrc', fullKey: 'perception', ability: 'wis' },
      },
      abilities: {
        str: { label: 'DND5E.AbilityStr', fullKey: 'strength', abbreviation: 'str' },
        dex: { label: 'DND5E.AbilityDex', fullKey: 'dexterity', abbreviation: 'dex' },
        wis: { label: 'DND5E.AbilityWis', fullKey: 'wisdom', abbreviation: 'wis' },
      },
      toolIds: { thief: 'Thieves Tools' },
    },
    statusEffects: [
      { id: 'prone', name: 'EFFECT.DND5E.StatusProne' },
      { id: 'poisoned', name: 'EFFECT.DND5E.StatusPoisoned' },
      { id: 'dead', name: 'EFFECT.DND5E.StatusDead' },
    ],
    specialStatusEffects: { DEFEATED: 'dead' },
    Combat: { documentClass: FakeCombat },
  };
  globalThis.ChatMessage = {
    async create(data) {
      record('ChatMessage.create', data);
      const msg = { id: `m${nextId++}`, timestamp: Date.now(), rolls: [], ...data };
      g.messages.set(msg.id, msg);
      return msg;
    },
    getSpeaker({ actor, token }) {
      return { alias: token?.name ?? actor?.name, actor: actor?.id, token: token?.id };
    },
  };
  globalThis.Roll = FakeRoll;
  globalThis.fromUuidSync = uuid => {
    const [, sceneId, , tokenId] = uuid.split('.');
    if (uuid.startsWith('Scene.') && tokenId)
      return g.scenes.get(sceneId)?.tokens.get(tokenId) ?? null;
    if (uuid.startsWith('Actor.')) return g.actors.get(uuid.slice(6)) ?? null;
    return null;
  };
  globalThis.canvas = {
    ready: true,
    scene,
    async ping(point, opts) {
      record('canvas.ping', point, opts);
    },
    async animatePan(point) {
      record('canvas.animatePan', point);
    },
  };
  globalThis.Journal = {
    async show(doc, opts) {
      record('Journal.show', doc.name, opts);
    },
  };
  globalThis.Hooks = { callAll() {}, call: () => true, on: () => 0, once: () => 0 };
  globalThis.FormApplication = class {};
  globalThis.foundry = { utils: { randomID: () => `r${nextId++}` } };
  return { game: g, scene, calls };
}
