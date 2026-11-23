/**
 * Dice tools: free rolls, 5e checks and saves, initiative, item use (attacks,
 * damage, spells), and roll tables. Every roll is made by Foundry and posted to
 * chat, so the table can see it.
 */

import {
  ToolInputError,
  resolveActor,
  resolveCombat,
  resolveItem,
  resolveToken,
  resolveWorldDocument,
  toList,
} from './resolve.js';
import {
  VISIBILITY_PARAM,
  describeD20,
  findAbility,
  findSkill,
  findToolKey,
  labelFor,
  requireDnd5e,
  rollModeFor,
} from './system.js';
import { describeCombat } from './combat-tools.js';

const speakerFor = actor =>
  actor ? ChatMessage.getSpeaker({ actor }) : { alias: game.user?.name ?? 'GM' };

async function rollDice({ formula, label, actor, visibility }) {
  if (!formula) throw new ToolInputError('formula is required, e.g. "2d6+3".');
  const source = actor ? resolveActor(actor) : null;
  const roll = await new globalThis.Roll(formula, source?.getRollData?.() ?? {}).evaluate();
  await roll.toMessage(
    { speaker: speakerFor(source), flavor: label ?? '' },
    { rollMode: rollModeFor(visibility) }
  );
  const dice = (roll.dice ?? []).map(
    d => `${d.formula}: ${d.results.map(r => r.result).join(', ')}`
  );
  return `${label ? `${label}: ` : ''}${formula} = ${roll.total}${dice.length ? ` [${dice.join('; ')}]` : ''}`;
}

const CHECKS = {
  skill: (actor, name, opts) => actor.rollSkill(findSkill(name), opts),
  ability: (actor, name, opts) => actor.rollAbilityTest(findAbility(name), opts),
  save: (actor, name, opts) => actor.rollAbilitySave(findAbility(name), opts),
  tool: (actor, name, opts) => actor.rollToolCheck(findToolKey(actor, name), opts),
  death: (actor, _name, opts) => actor.rollDeathSave(opts),
  concentration: (actor, _name, opts) => actor.rollConcentration(opts),
};

function checkLabel(type, name) {
  if (type === 'skill') return `${labelFor(CONFIG.DND5E.skills, findSkill(name))} check`;
  if (type === 'ability') return `${labelFor(CONFIG.DND5E.abilities, findAbility(name))} check`;
  if (type === 'save') return `${labelFor(CONFIG.DND5E.abilities, findAbility(name))} save`;
  if (type === 'tool') return `${name} check`;
  return type === 'death' ? 'death save' : 'concentration save';
}

function checkOptions(args) {
  const dc = args.dc;
  const target = dc !== null && dc !== '' && Number.isFinite(Number(dc)) ? Number(dc) : undefined;
  return {
    advantage: args.advantage === true,
    disadvantage: args.disadvantage === true,
    fastForward: true,
    chooseModifier: false,
    targetValue: target,
    rollMode: rollModeFor(args.visibility),
    parts: args.bonus ? [String(args.bonus)] : [],
  };
}

function validateCheck({ type, name }) {
  if (!CHECKS[type]) {
    throw new ToolInputError(`type must be one of: ${Object.keys(CHECKS).join(', ')}`);
  }
  if (['skill', 'ability', 'save', 'tool'].includes(type) && !name) {
    throw new ToolInputError(`name is required for a ${type} roll (e.g. "stealth", "dex").`);
  }
}

async function rollCheck(args) {
  requireDnd5e('roll_check');
  validateCheck(args);
  const { type, name } = args;
  const options = checkOptions(args);
  const results = [];
  for (const ref of toList(args.actors ?? args.actor)) {
    const actor = resolveActor(ref);
    const roll = await CHECKS[type](actor, name, { ...options });
    const label = `${actor.name} ${checkLabel(type, name)}`;
    results.push(`${label}: ${describeD20(roll, options.targetValue)}`);
  }
  if (!results.length) throw new ToolInputError('actor is required.');
  return results.join('\n');
}

async function rollInitiative({ which = 'npcs', combat: combatRef }) {
  const combat = resolveCombat(combatRef);
  if (which === 'npcs') await combat.rollNPC();
  else if (which === 'all') await combat.rollAll();
  else if (which === 'unrolled') {
    const ids = combat.combatants.filter(c => c.initiative === null).map(c => c.id);
    if (ids.length) await combat.rollInitiative(ids);
  } else {
    const names = toList(which).map(n => n.toLowerCase());
    const ids = combat.combatants
      .filter(
        c =>
          names.includes(c.name?.toLowerCase()) || names.includes(c.tokenId) || names.includes(c.id)
      )
      .map(c => c.id);
    if (!ids.length) throw new ToolInputError(`No combatants match: ${which}`);
    await combat.rollInitiative(ids);
  }
  return describeCombat(combat);
}

async function targetTokens(refs) {
  const tokens = toList(refs).map(ref => resolveToken(ref));
  if (tokens.length && game.user?.updateTokenTargets) {
    await game.user.updateTokenTargets(tokens.map(t => t.id));
  }
  return tokens;
}

function damageParts(rolls) {
  return (rolls ?? []).map(r => ({
    value: r.total,
    type: r.options?.type ?? r.options?.types?.[0],
  }));
}

function describeDamage(rolls) {
  if (!rolls?.length) return 'no damage rolled';
  const parts = damageParts(rolls).map(p => `${p.value}${p.type ? ` ${p.type}` : ''}`);
  const total = damageParts(rolls).reduce((sum, p) => sum + p.value, 0);
  return `${total} damage (${parts.join(' + ')})`;
}

function attackVersus(roll, tokens) {
  return tokens.map(t => {
    const ac = t.actor?.system?.attributes?.ac?.value;
    if (!Number.isFinite(ac)) return `${t.name}: AC unknown`;
    const hit = roll.isCritical || (!roll.isFumble && roll.total >= ac);
    return `${t.name} (AC ${ac}): ${hit ? (roll.isCritical ? 'CRITICAL HIT' : 'HIT') : 'MISS'}`;
  });
}

async function doAttack(item, args, tokens) {
  if (!item.hasAttack)
    throw new ToolInputError(`${item.name} has no attack roll; use mode "use" or "damage".`);
  const roll = await item.rollAttack({
    fastForward: true,
    advantage: args.advantage === true,
    disadvantage: args.disadvantage === true,
    rollMode: rollModeFor(args.visibility),
    spellLevel: args.spell_level,
  });
  if (!roll) return { roll: null, lines: ['Attack cancelled.'] };
  const lines = [`Attack with ${item.name}: ${describeD20(roll)}`, ...attackVersus(roll, tokens)];
  return { roll, lines };
}

async function doDamage(item, args, critical) {
  if (!item.hasDamage) throw new ToolInputError(`${item.name} deals no damage.`);
  const rolls = await item.rollDamage({
    critical,
    versatile: args.versatile === true,
    spellLevel: args.spell_level ?? null,
    options: { fastForward: true, rollMode: rollModeFor(args.visibility) },
  });
  return {
    rolls,
    line: `Damage from ${item.name}${critical ? ' (critical)' : ''}: ${describeDamage(rolls)}`,
  };
}

async function applyToTargets(rolls, tokens) {
  const lines = [];
  for (const token of tokens) {
    const actor = token.actor;
    if (!actor?.applyDamage) continue;
    const before = actor.system?.attributes?.hp?.value;
    await actor.applyDamage(damageParts(rolls));
    lines.push(`${token.name}: HP ${before} -> ${actor.system?.attributes?.hp?.value}`);
  }
  return lines;
}

async function useItemFull(item, args, tokens) {
  const attack = await doAttack(item, args, tokens);
  const lines = [...attack.lines];
  const hitAny = attack.roll && attackVersus(attack.roll, tokens).some(l => /HIT/.test(l));
  if (!attack.roll || (tokens.length && !hitAny)) return lines.join('\n');
  const damage = await doDamage(item, args, attack.roll.isCritical === true);
  lines.push(damage.line);
  if (args.apply_damage === true && tokens.length)
    lines.push(...(await applyToTargets(damage.rolls, tokens)));
  return lines.join('\n');
}

async function useItemCard(actor, item, args) {
  const config = args.spell_level ? { slotLevel: args.spell_level } : {};
  const message = await item.use(config, {
    configureDialog: false,
    rollMode: rollModeFor(args.visibility),
  });
  if (!message) {
    return `${item.name} was not used (no uses or spell slots left, or it was cancelled).`;
  }
  const followUp = [item.hasAttack ? 'attack' : null, item.hasDamage ? 'damage' : null];
  const rolls = followUp.filter(Boolean).join(' and ');
  const hint = rolls
    ? ` Roll its ${rolls} with mode "attack", "damage" or "attack_and_damage".`
    : '';
  return `${actor.name} used ${item.name}; its card is in chat.${hint}`;
}

async function damageOnly(item, args, tokens) {
  const damage = await doDamage(item, args, args.critical === true);
  const applied = args.apply_damage === true ? await applyToTargets(damage.rolls, tokens) : [];
  return [damage.line, ...applied].join('\n');
}

async function useItem(args) {
  requireDnd5e('use_item');
  const actor = resolveActor(args.actor);
  const item = resolveItem(actor, args.item);
  const tokens = await targetTokens(args.targets);
  const mode = args.mode ?? 'use';
  if (mode === 'attack') return (await doAttack(item, args, tokens)).lines.join('\n');
  if (mode === 'damage') return damageOnly(item, args, tokens);
  if (mode === 'attack_and_damage') return useItemFull(item, args, tokens);
  return useItemCard(actor, item, args);
}

async function rollTable({ table: ref, visibility }) {
  const table = resolveWorldDocument(game.tables, ref, 'Roll table');
  const draw = await table.draw({ displayChat: true, rollMode: rollModeFor(visibility) });
  const results = (draw?.results ?? []).map(
    r => r.getChatText?.() ?? r.text ?? r.description ?? ''
  );
  return `${table.name}: rolled ${draw?.roll?.total ?? '?'} -> ${results.join(' | ') || 'no result'}`;
}

const ACTOR_PARAM = {
  type: 'string',
  description: 'Actor or token: id, UUID or name. Tokens on the current scene are matched first.',
};

export const DICE_TOOLS = [
  {
    name: 'roll_dice',
    description:
      'Roll any dice formula in Foundry and post it to chat (e.g. "1d20+5", "4d6kh3", "2d6+@abilities.str.mod" with an actor). Use this for every random result so the roll is visible and fair.',
    parameters: {
      properties: {
        formula: { type: 'string', description: 'Dice formula' },
        label: { type: 'string', description: 'What the roll is for, shown in chat' },
        actor: { ...ACTOR_PARAM, description: 'Optional roller; enables @ references to its data' },
        visibility: VISIBILITY_PARAM,
      },
      required: ['formula'],
    },
    run: rollDice,
  },
  {
    name: 'roll_check',
    description:
      "D&D 5e: roll a skill check, ability check, saving throw, tool check, death save or concentration save for one or more actors, with the system's bonuses, proficiency and advantage. Reports totals and success against an optional DC.",
    parameters: {
      properties: {
        actor: ACTOR_PARAM,
        actors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Several actors/tokens rolling the same check (group checks, mass saves)',
        },
        type: { type: 'string', enum: Object.keys(CHECKS), description: 'Kind of roll' },
        name: {
          type: 'string',
          description:
            'Skill, ability or tool: key or name, e.g. "ste" or "stealth", "dex" or "dexterity"',
        },
        dc: { type: 'number', description: 'Difficulty class to report success against' },
        advantage: { type: 'boolean' },
        disadvantage: { type: 'boolean' },
        bonus: { type: 'string', description: 'Situational bonus, e.g. "1d4" for guidance' },
        visibility: VISIBILITY_PARAM,
      },
      required: ['type'],
    },
    run: rollCheck,
  },
  {
    name: 'roll_initiative',
    description:
      'Roll initiative in the current combat: for NPCs only (default), everyone, everyone without initiative yet, or listed combatants. Returns the turn order.',
    parameters: {
      properties: {
        which: {
          type: 'string',
          description: '"npcs", "all", "unrolled", or comma-separated combatant names',
        },
        combat: { type: 'string', description: 'Combat id (default: the active combat)' },
      },
    },
    run: rollInitiative,
  },
  {
    name: 'use_item',
    description:
      'D&D 5e: use an actor\'s weapon, spell, feature or consumable. mode "use" posts its card and spends uses/spell slots; "attack" rolls to hit (reports hit/miss against target AC); "damage" rolls damage; "attack_and_damage" attacks and rolls damage on a hit (critical on a natural 20). Optionally applies the damage to the targets.',
    parameters: {
      properties: {
        actor: ACTOR_PARAM,
        item: {
          type: 'string',
          description: 'Item id or name on that actor, e.g. "Scimitar", "Fire Bolt"',
        },
        mode: {
          type: 'string',
          enum: ['use', 'attack', 'damage', 'attack_and_damage'],
          description: 'Default "use"',
        },
        targets: {
          type: 'array',
          items: { type: 'string' },
          description: "Target tokens (names or ids); also set as the GM's targets",
        },
        apply_damage: {
          type: 'boolean',
          description: 'Apply rolled damage to the targets (resistances count)',
        },
        advantage: { type: 'boolean' },
        disadvantage: { type: 'boolean' },
        critical: { type: 'boolean', description: 'For mode "damage": roll critical damage' },
        versatile: { type: 'boolean', description: 'Use the versatile damage formula' },
        spell_level: { type: 'integer', description: 'Cast a spell at this slot level' },
        visibility: VISIBILITY_PARAM,
      },
      required: ['actor', 'item'],
    },
    run: useItem,
  },
  {
    name: 'roll_table',
    description:
      'Draw from a roll table (random encounters, loot, weather, names) and post the result to chat.',
    parameters: {
      properties: {
        table: { type: 'string', description: 'Roll table id, UUID or name' },
        visibility: VISIBILITY_PARAM,
      },
      required: ['table'],
    },
    run: rollTable,
  },
];
