/**
 * Character-state tools (D&D 5e): a compact status sheet, damage and healing,
 * conditions, rests, and XP/currency awards.
 */

import { ToolInputError, resolveActor, toList } from './resolve.js';
import {
  actorConditions,
  describeHp,
  findStatusEffect,
  hpOf,
  isDnd5e,
  requireDnd5e,
} from './system.js';

const signed = n => (Number(n) >= 0 ? `+${Number(n)}` : `${Number(n)}`);

function levelLabel(details = {}) {
  if (details.level) return `level ${details.level}`;
  return details.cr !== undefined && details.cr !== null ? `CR ${details.cr}` : '';
}

function speedLabel(move = {}) {
  const speeds = ['walk', 'fly', 'swim', 'climb', 'burrow']
    .filter(k => move[k])
    .map(k => `${k} ${move[k]}`);
  return `${speeds.join(', ') || 'none'} ${move.units ?? 'ft'}`;
}

function coreLines(actor) {
  const s = actor.system ?? {};
  const a = s.attributes ?? {};
  const level = levelLabel(s.details);
  const passive = s.skills?.prc?.passive ?? '?';
  return [
    `${actor.name} (${actor.type}${level ? `, ${level}` : ''}) - ${actor.uuid}`,
    `${describeHp(actor)} | AC ${a.ac?.value ?? '?'} | initiative ${signed(a.init?.total ?? 0)} | proficiency ${signed(a.prof ?? 0)}`,
    `Speed: ${speedLabel(a.movement)} | Passive Perception ${passive}`,
  ];
}

function abilityLine(actor) {
  const abilities = actor.system?.abilities ?? {};
  const parts = Object.entries(abilities).map(([key, ab]) => {
    const prof = ab.proficient ? '*' : '';
    return `${key.toUpperCase()} ${ab.value} (${signed(ab.mod)}, save ${signed(ab.save ?? ab.mod)}${prof})`;
  });
  return `Abilities: ${parts.join(' | ')}  (* = proficient save)`;
}

function spellLines(actor) {
  const spells = actor.system?.spells ?? {};
  const slots = Object.entries(spells)
    .filter(([, slot]) => slot?.max)
    .map(
      ([key, slot]) =>
        `${key === 'pact' ? `pact (level ${slot.level})` : key.replace('spell', 'L')}: ${slot.value}/${slot.max}`
    );
  const dc = actor.system?.attributes?.spelldc;
  return slots.length
    ? [`Spell slots: ${slots.join(', ')}${dc ? ` | spell save DC ${dc}` : ''}`]
    : [];
}

function stateLines(actor) {
  const lines = [];
  const conditions = actorConditions(actor);
  lines.push(`Conditions: ${conditions.length ? conditions.join(', ') : 'none'}`);
  const death = actor.system?.attributes?.death;
  if (death && (death.success || death.failure || hpOf(actor)?.value === 0)) {
    lines.push(`Death saves: ${death.success} successes, ${death.failure} failures`);
  }
  const resources = Object.values(actor.system?.resources ?? {}).filter(r => r?.label && r?.max);
  if (resources.length)
    lines.push(`Resources: ${resources.map(r => `${r.label} ${r.value}/${r.max}`).join(', ')}`);
  return lines;
}

function itemSummary(item) {
  const uses = item.system?.uses;
  const bits = [item.name];
  if (item.labels?.toHit) bits.push(`to hit ${item.labels.toHit}`);
  if (item.labels?.damage) bits.push(item.labels.damage);
  if (uses?.max) bits.push(`${uses.value}/${uses.max} uses`);
  if (item.type === 'spell') bits.push(item.system.level ? `L${item.system.level}` : 'cantrip');
  if (item.system?.quantity > 1) bits.push(`x${item.system.quantity}`);
  return bits.join(' ');
}

function itemLines(actor) {
  const groups = {
    weapon: 'Weapons',
    spell: 'Spells',
    feat: 'Features',
    consumable: 'Consumables',
  };
  const lines = [];
  for (const [type, label] of Object.entries(groups)) {
    const items = actor.items.filter(i => i.type === type);
    if (!items.length) continue;
    const shown = items.slice(0, 40).map(itemSummary);
    lines.push(
      `${label}: ${shown.join('; ')}${items.length > 40 ? `; ...${items.length - 40} more` : ''}`
    );
  }
  return lines;
}

function wealthLines(actor) {
  const currency = actor.system?.currency;
  const xp = actor.system?.details?.xp;
  const lines = [];
  if (currency)
    lines.push(
      `Currency: ${Object.entries(currency)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')}`
    );
  if (xp?.max) lines.push(`XP: ${xp.value}/${xp.max}`);
  return lines;
}

function actorStatus({ actor: ref, actors }) {
  const refs = toList(actors ?? ref);
  if (!refs.length) throw new ToolInputError('actor is required.');
  return refs
    .map(r => {
      const actor = resolveActor(r);
      if (!isDnd5e())
        return `${actor.name} (${actor.type}) - conditions: ${actorConditions(actor).join(', ') || 'none'}`;
      return [
        ...coreLines(actor),
        abilityLine(actor),
        ...spellLines(actor),
        ...stateLines(actor),
        ...itemLines(actor),
        ...wealthLines(actor),
      ].join('\n');
    })
    .join('\n\n');
}

async function defeatIfDown(actor) {
  if (actor.type === 'character' || hpOf(actor)?.value > 0) return '';
  const combatant = game.combat?.combatants?.find(c => c.actor === actor || c.actorId === actor.id);
  if (combatant && !combatant.defeated) await combatant.update({ defeated: true });
  const dead = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  await actor.toggleStatusEffect?.(dead, { active: true, overlay: true });
  return ' - DEFEATED';
}

function damageOptions(args) {
  const options = {};
  if (args.half) options.multiplier = 0.5;
  if (args.ignore_resistances) options.ignore = true;
  return options;
}

function damageHeading(amount, type, half) {
  const labels = { healing: 'Healed', temphp: 'Temp HP' };
  const what = labels[type] ?? `${amount}${type ? ` ${type}` : ''} damage`;
  return `${what}${half ? ' (halved)' : ''}`;
}

async function damageOne(actor, amount, type, args) {
  const before = describeHp(actor);
  if (type === 'temphp') await actor.applyTempHP(amount);
  else await actor.applyDamage([{ value: amount, type }], damageOptions(args));
  const checkDefeat = args.defeat_at_zero !== false && type !== 'healing';
  const defeated = checkDefeat ? await defeatIfDown(actor) : '';
  return `${actor.name}: ${before} -> ${describeHp(actor)}${defeated}`;
}

async function applyDamage(args) {
  requireDnd5e('apply_damage');
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ToolInputError('amount must be a positive number.');
  }
  const type = args.type ?? (args.healing ? 'healing' : undefined);
  const lines = [];
  for (const ref of toList(args.targets ?? args.target)) {
    lines.push(await damageOne(resolveActor(ref), amount, type, args));
  }
  if (!lines.length) throw new ToolInputError('targets is required.');
  return `${damageHeading(amount, type, args.half)}:\n${lines.join('\n')}`;
}

async function setExhaustion(actor, level) {
  const value = Math.min(Math.max(Number(level) || 0, 0), 6);
  await actor.update({ 'system.attributes.exhaustion': value });
  return `${actor.name}: exhaustion ${value}`;
}

async function setCondition(args) {
  const active = args.active !== false;
  const isExhaustion = String(args.condition).toLowerCase() === 'exhaustion';
  const effect = isExhaustion ? null : findStatusEffect(args.condition);
  const lines = [];
  for (const ref of toList(args.actors ?? args.actor)) {
    const actor = resolveActor(ref);
    if (isExhaustion) {
      lines.push(await setExhaustion(actor, active ? (args.level ?? 1) : 0));
      continue;
    }
    if (typeof actor.toggleStatusEffect !== 'function')
      throw new ToolInputError('This Foundry version cannot toggle conditions from tools.');
    await actor.toggleStatusEffect(effect.id, { active, overlay: args.overlay === true });
    lines.push(`${actor.name}: ${active ? 'now' : 'no longer'} ${effect.name}`);
  }
  if (!lines.length) throw new ToolInputError('actor is required.');
  return lines.join('\n');
}

async function rest(args) {
  requireDnd5e('rest');
  const long = args.type === 'long';
  const lines = [];
  for (const ref of toList(args.actors ?? args.actor)) {
    const actor = resolveActor(ref);
    const before = describeHp(actor);
    const config = { dialog: false, chat: true };
    const result = long
      ? await actor.longRest({ ...config, newDay: args.new_day !== false })
      : await actor.shortRest({ ...config, autoHD: args.spend_hit_dice !== false });
    const hd = result?.dhd ? `, hit dice ${signed(result.dhd)}` : '';
    lines.push(`${actor.name}: ${before} -> ${describeHp(actor)}${hd}`);
  }
  if (!lines.length) throw new ToolInputError('actor is required.');
  return `${long ? 'Long' : 'Short'} rest:\n${lines.join('\n')}`;
}

function awardActors(args) {
  const refs = toList(args.actors);
  if (refs.length) return refs.map(r => resolveActor(r));
  const party = game.actors.filter(a => a.type === 'character' && a.hasPlayerOwner);
  if (!party.length) throw new ToolInputError('No player characters found; pass actors.');
  return party;
}

function awardUpdate(actor, xp, coins, share) {
  const update = {};
  const currentXp = actor.system?.details?.xp;
  if (xp && currentXp) update['system.details.xp.value'] = (currentXp.value ?? 0) + xp;
  for (const [coin, value] of coins) {
    update[`system.currency.${coin}`] = (actor.system?.currency?.[coin] ?? 0) + share(value);
  }
  return update;
}

async function announce(lines) {
  await ChatMessage.create({
    content: `<p><strong>Rewards</strong></p><p>${lines.join('<br>')}</p>`,
    speaker: { alias: 'Narrator' },
  });
}

async function award(args) {
  requireDnd5e('award');
  const actors = awardActors(args);
  const share = value => (args.split ? Math.floor(Number(value) / actors.length) : Number(value));
  const xp = args.xp ? share(args.xp) : 0;
  const coins = Object.entries(args.currency ?? {}).filter(([, v]) => Number(v) > 0);
  const gained = [xp ? `${xp} XP` : '', ...coins.map(([c, v]) => `${share(v)} ${c}`)].filter(
    Boolean
  );
  const lines = [];
  for (const actor of actors) {
    const update = awardUpdate(actor, xp, coins, share);
    if (Object.keys(update).length) await actor.update(update);
    lines.push(`${actor.name}: +${gained.join(', +') || 'nothing'}`);
  }
  if (args.announce !== false && lines.length) await announce(lines);
  return lines.join('\n');
}

const ACTORS_PARAM = {
  type: 'array',
  items: { type: 'string' },
  description: 'Actors or tokens (names, ids or UUIDs)',
};

export const ACTOR_TOOLS = [
  {
    name: 'get_actor_status',
    readOnly: true,
    description:
      'Compact character sheet: HP, AC, speed, initiative, abilities and saves, passive Perception, conditions, death saves, spell slots, resources, weapons/spells/features with uses, currency and XP.',
    parameters: {
      properties: {
        actor: { type: 'string', description: 'Actor or token' },
        actors: ACTORS_PARAM,
      },
    },
    run: actorStatus,
  },
  {
    name: 'apply_damage',
    description:
      'D&D 5e: deal damage (typed, so resistances/immunities/vulnerabilities apply), heal (type "healing"), or grant temporary HP (type "temphp") to one or more actors. NPCs at 0 HP are marked defeated.',
    parameters: {
      properties: {
        targets: ACTORS_PARAM,
        amount: { type: 'number' },
        type: {
          type: 'string',
          description:
            'Damage type: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder; or "healing" / "temphp"',
        },
        half: { type: 'boolean', description: 'Halve it (successful save for half)' },
        ignore_resistances: { type: 'boolean' },
        defeat_at_zero: {
          type: 'boolean',
          description: 'Mark NPCs defeated at 0 HP (default true)',
        },
      },
      required: ['targets', 'amount'],
    },
    run: applyDamage,
  },
  {
    name: 'set_condition',
    description:
      'Add or remove a condition (prone, poisoned, frightened, unconscious, ...) on actors/tokens, or set exhaustion level with condition "exhaustion" and level.',
    parameters: {
      properties: {
        actors: ACTORS_PARAM,
        condition: { type: 'string', description: 'Condition id or name' },
        active: { type: 'boolean', description: 'true to add (default), false to remove' },
        level: { type: 'integer', description: 'Exhaustion level 0-6' },
        overlay: { type: 'boolean', description: 'Show as a large overlay icon' },
      },
      required: ['actors', 'condition'],
    },
    run: setCondition,
  },
  {
    name: 'rest',
    description:
      'D&D 5e: take a short rest (spending hit dice automatically by default) or a long rest for actors, posting the results to chat.',
    parameters: {
      properties: {
        actors: ACTORS_PARAM,
        type: { type: 'string', enum: ['short', 'long'] },
        spend_hit_dice: {
          type: 'boolean',
          description: 'Short rest: spend hit dice to recover HP (default true)',
        },
        new_day: { type: 'boolean', description: 'Long rest: recover per-day uses (default true)' },
      },
      required: ['actors', 'type'],
    },
    run: rest,
  },
  {
    name: 'award',
    description:
      'D&D 5e: give XP and/or currency to characters (default: all player characters), each or split evenly, and announce it in chat.',
    parameters: {
      properties: {
        actors: ACTORS_PARAM,
        xp: { type: 'integer' },
        currency: {
          type: 'object',
          properties: {
            pp: { type: 'integer' },
            gp: { type: 'integer' },
            ep: { type: 'integer' },
            sp: { type: 'integer' },
            cp: { type: 'integer' },
          },
        },
        split: { type: 'boolean', description: 'Divide the totals among the actors' },
        announce: { type: 'boolean', description: 'Post to chat (default true)' },
      },
    },
    run: award,
  },
];
