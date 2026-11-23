/**
 * Combat tools: start an encounter from tokens on the map, read the turn order,
 * and drive it (turns, rounds, adding/removing combatants, defeat, ending).
 */

import { ToolInputError, resolveCombat, resolveScene, resolveToken, toList } from './resolve.js';
import { actorConditions, describeHp } from './system.js';

const DISPOSITIONS = () => CONST.TOKEN_DISPOSITIONS ?? { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };

/** Tokens selected by a filter keyword or an explicit list. */
export function selectTokens(scene, selection = 'all', includeHidden = true) {
  const tokens = (scene.tokens?.contents ?? []).filter(
    t => t.actor && (includeHidden || !t.hidden)
  );
  const d = DISPOSITIONS();
  const filters = {
    all: () => true,
    hostile: t => t.disposition === d.HOSTILE,
    friendly: t => t.disposition === d.FRIENDLY,
    neutral: t => t.disposition === d.NEUTRAL,
    pcs: t => t.actor?.type === 'character' || t.actor?.hasPlayerOwner,
    npcs: t => t.actor?.type !== 'character' && !t.actor?.hasPlayerOwner,
  };
  const list = toList(selection);
  const keyword = list.length === 1 ? list[0].toLowerCase() : null;
  if (keyword && filters[keyword]) return tokens.filter(filters[keyword]);
  return list.map(ref => resolveToken(ref, scene));
}

function combatantLine(combat, combatant, index) {
  const current = combat.combatant?.id === combatant.id;
  const actor = combatant.actor;
  const bits = [
    `${current ? '>' : ' '} ${index + 1}. ${combatant.name}`,
    `init ${combatant.initiative ?? '-'}`,
    describeHp(actor),
  ];
  const conditions = actorConditions(actor);
  if (conditions.length) bits.push(`[${conditions.join(', ')}]`);
  if (combatant.defeated) bits.push('DEFEATED');
  if (combatant.hidden) bits.push('hidden');
  if (actor?.hasPlayerOwner) bits.push('player');
  bits.push(`token ${combatant.tokenId}`);
  return bits.join(' | ');
}

export function describeCombat(combat) {
  const turns = combat.turns ?? [];
  const status = combat.started ? `Round ${combat.round}, turn ${combat.turn + 1}` : 'Not started';
  const current = combat.combatant ? `Current: ${combat.combatant.name}` : '';
  const header =
    `Combat ${combat.id} on "${combat.scene?.name ?? 'no scene'}": ${status}. ${current}`.trim();
  return [header, ...turns.map((c, i) => combatantLine(combat, c, i))].join('\n');
}

async function addCombatants(combat, scene, tokens) {
  const existing = new Set(combat.combatants.map(c => c.tokenId));
  const data = tokens
    .filter(t => !existing.has(t.id))
    .map(t => ({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId, hidden: t.hidden }));
  if (data.length) await combat.createEmbeddedDocuments('Combatant', data);
  return data.length;
}

async function combatStart(args) {
  const scene = resolveScene(args.scene);
  const existing = game.combats?.find(c => c.scene?.id === scene.id);
  if (existing && args.new_combat !== true) {
    throw new ToolInputError(
      `Scene already has combat ${existing.id}. Use combat_control (add/end) or set new_combat.`
    );
  }
  const tokens = selectTokens(scene, args.tokens ?? 'all', args.include_hidden !== false);
  if (!tokens.length) throw new ToolInputError('No tokens to add to combat.');
  const CombatClass = globalThis.getDocumentClass?.('Combat') ?? CONFIG.Combat.documentClass;
  const combat = await CombatClass.create({ scene: scene.id, active: true });
  await addCombatants(combat, scene, tokens);
  if (args.roll_npc_initiative !== false) await combat.rollNPC();
  if (args.start !== false) await combat.startCombat();
  return describeCombat(combat);
}

function findCombatants(combat, refs) {
  const wanted = toList(refs);
  if (!wanted.length)
    throw new ToolInputError('Name the combatants (names, token ids or combatant ids).');
  return wanted.map(ref => {
    const key = ref.toLowerCase();
    const matches = combat.combatants.filter(
      c => c.id === ref || c.tokenId === ref || c.name?.toLowerCase() === key
    );
    if (matches.length !== 1) {
      throw new ToolInputError(
        matches.length
          ? `"${ref}" matches several combatants; use a token id.`
          : `No combatant "${ref}".`
      );
    }
    return matches[0];
  });
}

async function markDefeated(combat, refs) {
  const combatants = findCombatants(combat, refs);
  const dead = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  for (const combatant of combatants) {
    await combatant.update({ defeated: true });
    await combatant.actor?.toggleStatusEffect?.(dead, { active: true, overlay: true });
  }
}

const ACTIONS = {
  start: combat => combat.startCombat(),
  next_turn: combat => combat.nextTurn(),
  previous_turn: combat => combat.previousTurn(),
  next_round: combat => combat.nextRound(),
  previous_round: combat => combat.previousRound(),
  end: combat => combat.delete(),
  add: (combat, args) =>
    addCombatants(combat, combat.scene, selectTokens(combat.scene, args.tokens)),
  remove: (combat, args) =>
    combat.deleteEmbeddedDocuments(
      'Combatant',
      findCombatants(combat, args.tokens).map(c => c.id)
    ),
  set_initiative: (combat, args) => {
    if (!Number.isFinite(Number(args.initiative)))
      throw new ToolInputError('initiative (a number) is required.');
    return combat.setInitiative(findCombatants(combat, args.tokens)[0].id, Number(args.initiative));
  },
  defeated: (combat, args) => markDefeated(combat, args.tokens),
};

async function combatControl(args) {
  const run = ACTIONS[args.action];
  if (!run) throw new ToolInputError(`action must be one of: ${Object.keys(ACTIONS).join(', ')}`);
  const combat = resolveCombat(args.combat);
  await run(combat, args);
  if (args.action === 'end') return `Combat ${combat.id} ended.`;
  return describeCombat(combat);
}

const COMBAT_PARAM = { type: 'string', description: 'Combat id (default: the active combat)' };

export const COMBAT_TOOLS = [
  {
    name: 'combat_start',
    description:
      'Start an encounter on a scene: add tokens to the combat tracker (all, by disposition, or a list), roll initiative for NPCs, and begin round 1. Returns the turn order.',
    parameters: {
      properties: {
        scene: { type: 'string', description: 'Scene id or name (default: the viewed scene)' },
        tokens: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Token names/ids, or one keyword: ["all"] (default), ["hostile"], ["friendly"], ["neutral"], ["pcs"], ["npcs"]',
        },
        include_hidden: { type: 'boolean', description: 'Include hidden tokens (default true)' },
        roll_npc_initiative: { type: 'boolean', description: 'Default true' },
        start: { type: 'boolean', description: 'Begin round 1 (default true)' },
        new_combat: { type: 'boolean', description: 'Allow a second combat on the same scene' },
      },
    },
    run: combatStart,
  },
  {
    name: 'combat_status',
    readOnly: true,
    description:
      'The current combat: round, whose turn it is, and the turn order with initiative, HP, conditions and defeated/hidden state.',
    parameters: { properties: { combat: COMBAT_PARAM } },
    run: args => describeCombat(resolveCombat(args.combat)),
  },
  {
    name: 'combat_control',
    description:
      'Drive the combat tracker: next_turn, previous_turn, next_round, previous_round, start, end, add or remove combatants, set_initiative, or mark combatants defeated.',
    parameters: {
      properties: {
        action: { type: 'string', enum: Object.keys(ACTIONS) },
        tokens: {
          type: 'array',
          items: { type: 'string' },
          description:
            'For add/remove/set_initiative/defeated: combatant or token names/ids (add also accepts ["hostile"] etc.)',
        },
        initiative: { type: 'number', description: 'For set_initiative' },
        combat: COMBAT_PARAM,
      },
      required: ['action'],
    },
    run: combatControl,
  },
];
