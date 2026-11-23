/**
 * Game-system helpers. The table tools speak D&D 5e (dnd5e 3.x) natively and
 * fall back to core Foundry behaviour where a system-neutral version exists.
 */

import { ToolInputError } from './resolve.js';

const norm = value =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export const isDnd5e = () => game.system?.id === 'dnd5e';

export function requireDnd5e(feature) {
  if (!isDnd5e()) {
    throw new ToolInputError(
      `${feature} needs the D&D 5e system (this world uses ${game.system?.id}).`
    );
  }
}

const localize = key => game.i18n?.localize?.(key) ?? key;

/** Find a key in a dnd5e config table by key, fullKey, or (localized) label. */
function findConfigKey(table, ref, what) {
  const wanted = norm(ref);
  for (const [key, entry] of Object.entries(table ?? {})) {
    const label = typeof entry === 'string' ? entry : entry?.label;
    const names = [key, entry?.fullKey, entry?.abbreviation, label, label && localize(label)];
    if (names.some(name => norm(name) === wanted)) return key;
  }
  const options = Object.entries(table ?? {})
    .map(([key, entry]) => `${key} (${localize(typeof entry === 'string' ? entry : entry?.label)})`)
    .join(', ');
  throw new ToolInputError(`Unknown ${what} "${ref}". Options: ${options}`);
}

export const findSkill = ref => findConfigKey(CONFIG.DND5E?.skills, ref, 'skill');
export const findAbility = ref => findConfigKey(CONFIG.DND5E?.abilities, ref, 'ability');

export function findToolKey(actor, ref) {
  const tools = { ...(CONFIG.DND5E?.toolIds ?? {}), ...(actor.system?.tools ?? {}) };
  const wanted = norm(ref);
  const key = Object.keys(tools).find(k => norm(k) === wanted);
  if (key) return key;
  return findConfigKey(CONFIG.DND5E?.toolIds, ref, 'tool');
}

export function labelFor(table, key) {
  const entry = table?.[key];
  return localize(typeof entry === 'string' ? entry : (entry?.label ?? key));
}

/** Map an agent-friendly visibility to a Foundry roll mode. */
export function rollModeFor(visibility) {
  const modes = { public: 'publicroll', gm: 'gmroll', blind: 'blindroll', self: 'selfroll' };
  return modes[visibility] ?? modes.public;
}

export const VISIBILITY_PARAM = {
  type: 'string',
  enum: ['public', 'gm', 'blind', 'self'],
  description:
    'Who sees the roll in chat: public (everyone, default), gm (players see that a roll happened), blind (only the GM, not even the roller), self (only you).',
};

function diceFaces(roll) {
  return (roll.dice ?? []).flatMap(die =>
    (die.results ?? []).map(r => (r.active === false ? `(${r.result})` : `${r.result}`))
  );
}

/** One line describing a d20 roll: total, dice, crit/fumble, and success against a DC. */
export function describeD20(roll, dc) {
  if (!roll) return 'The roll was cancelled.';
  const faces = diceFaces(roll);
  const parts = [
    `${roll.total} (${roll.formula}${faces.length ? `; d20: ${faces.join(', ')}` : ''})`,
  ];
  if (roll.isCritical) parts.push('natural 20');
  if (roll.isFumble) parts.push('natural 1');
  if (Number.isFinite(dc))
    parts.push(roll.total >= dc ? `SUCCESS vs DC ${dc}` : `FAILURE vs DC ${dc}`);
  return parts.join(', ');
}

/** Condition ids the world knows (CONFIG.statusEffects), with display names. */
export function statusEffectChoices() {
  return (CONFIG.statusEffects ?? []).map(effect => ({
    id: effect.id,
    name: localize(effect.name ?? effect.label ?? effect.id),
  }));
}

export function findStatusEffect(ref) {
  const wanted = norm(ref);
  const choices = statusEffectChoices();
  const match = choices.find(c => norm(c.id) === wanted || norm(c.name) === wanted);
  if (match) return match;
  const list = choices.map(c => c.id).join(', ');
  throw new ToolInputError(`Unknown condition "${ref}". Options: ${list}`);
}

export function actorConditions(actor) {
  const names = new Map(statusEffectChoices().map(c => [c.id, c.name]));
  const list = Array.from(actor?.statuses ?? []).map(id => names.get(id) ?? id);
  const exhaustion = actor?.system?.attributes?.exhaustion;
  if (exhaustion) list.push(`exhaustion ${exhaustion}`);
  return list;
}

export function hpOf(actor) {
  const hp = actor?.system?.attributes?.hp;
  if (!hp) return null;
  return { value: hp.value ?? 0, max: hp.max ?? 0, temp: hp.temp ?? 0 };
}

export function describeHp(actor) {
  const hp = hpOf(actor);
  if (!hp) return 'HP n/a';
  return `HP ${hp.value}/${hp.max}${hp.temp ? ` (+${hp.temp} temp)` : ''}`;
}
