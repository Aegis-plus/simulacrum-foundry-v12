/**
 * Token tools: see who is on the map and where, move, place, hide and remove
 * tokens, and measure distances. Positions are map grid squares (col/row from
 * the map's top-left square); see grid.js.
 */

import { ToolInputError, resolveActor, resolveScene, resolveToken, toList } from './resolve.js';
import { cellToPoint, gridInfo, tokenCell, tokenDistance } from './grid.js';
import { actorConditions, describeHp } from './system.js';
import { selectTokens } from './combat-tools.js';

const DISPOSITION_NAMES = { '-2': 'secret', '-1': 'hostile', 0: 'neutral', 1: 'friendly' };

function tokenLine(token) {
  const { col, row } = tokenCell(token);
  const bits = [
    `${token.name} (token ${token.id})`,
    `col ${col}, row ${row}`,
    DISPOSITION_NAMES[token.disposition] ?? 'unknown',
  ];
  if (token.actor) bits.push(describeHp(token.actor));
  const size = token.width > 1 || token.height > 1 ? `${token.width}x${token.height}` : null;
  if (size) bits.push(`size ${size}`);
  const conditions = actorConditions(token.actor);
  if (conditions.length) bits.push(`[${conditions.join(', ')}]`);
  if (token.hidden) bits.push('HIDDEN');
  if (token.actor?.hasPlayerOwner) bits.push('player');
  if (token.inCombat) bits.push('in combat');
  return bits.join(' | ');
}

function listTokens({ scene: sceneRef, filter = 'all' }) {
  const scene = resolveScene(sceneRef);
  const tokens = selectTokens(scene, filter);
  const { distance, units } = gridInfo(scene);
  const header = `Scene "${scene.name}" (${scene.id}): ${tokens.length} token(s); one square = ${distance} ${units}.`;
  return [header, ...tokens.map(tokenLine)].join('\n');
}

function occupiedCells(scene, ignoreIds = []) {
  const cells = new Set();
  for (const token of scene.tokens?.contents ?? []) {
    if (ignoreIds.includes(token.id)) continue;
    const { col, row } = tokenCell(token, scene);
    for (let dx = 0; dx < Math.max(1, Math.round(token.width ?? 1)); dx++) {
      for (let dy = 0; dy < Math.max(1, Math.round(token.height ?? 1)); dy++)
        cells.add(`${col + dx},${row + dy}`);
    }
  }
  return cells;
}

function inBounds(scene, { col, row }) {
  const dims = scene.dimensions;
  if (!dims?.sceneWidth) return col >= 0 && row >= 0;
  const { size } = gridInfo(scene);
  return (
    col >= 0 &&
    row >= 0 &&
    col < Math.ceil(dims.sceneWidth / size) &&
    row < Math.ceil(dims.sceneHeight / size)
  );
}

/** Nearest free square to `center` (spiralling outward), preferring ones close to `prefer`. */
function freeCellNear(scene, center, { occupied, prefer = center, maxRadius = 12 }) {
  for (let radius = 1; radius <= maxRadius; radius++) {
    const ring = [];
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        const cell = { col: center.col + dc, row: center.row + dr };
        if (inBounds(scene, cell) && !occupied.has(`${cell.col},${cell.row}`)) ring.push(cell);
      }
    }
    if (ring.length) {
      const score = c => Math.max(Math.abs(c.col - prefer.col), Math.abs(c.row - prefer.row));
      return ring.sort((a, b) => score(a) - score(b))[0];
    }
  }
  throw new ToolInputError('No free square found nearby.');
}

const DIRECTIONS = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, -1],
  northwest: [-1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1],
};

function destinationCell(token, scene, args) {
  if (Number.isFinite(Number(args.col)) && Number.isFinite(Number(args.row))) {
    return { col: Number(args.col), row: Number(args.row) };
  }
  if (args.near) {
    const target = resolveToken(args.near, scene);
    const occupied = occupiedCells(scene, [token.id]);
    return freeCellNear(scene, tokenCell(target, scene), {
      occupied,
      prefer: tokenCell(token, scene),
    });
  }
  const dir = DIRECTIONS[String(args.direction ?? '').toLowerCase()];
  if (dir && Number(args.feet) > 0) {
    const steps = Math.round(Number(args.feet) / gridInfo(scene).distance);
    const from = tokenCell(token, scene);
    return { col: from.col + dir[0] * steps, row: from.row + dir[1] * steps };
  }
  throw new ToolInputError('Give col and row, near (a token), or direction plus feet.');
}

async function moveToken(args) {
  const scene = resolveScene(args.scene);
  const token = resolveToken(args.token, scene);
  const from = tokenCell(token, scene);
  const to = destinationCell(token, scene, args);
  if (!inBounds(scene, to))
    throw new ToolInputError(`col ${to.col}, row ${to.row} is outside the map.`);
  const point = cellToPoint(scene, to);
  await token.update({ x: point.x, y: point.y }, { animate: args.animate !== false });
  const squares = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
  const { distance, units } = gridInfo(scene);
  return `Moved ${token.name} from col ${from.col}, row ${from.row} to col ${to.col}, row ${to.row} (${squares * distance} ${units}).`;
}

async function actorForPlacement(ref) {
  if (typeof ref === 'string' && ref.startsWith('Compendium.')) {
    const source = await globalThis.fromUuid(ref);
    if (!source) throw new ToolInputError(`Not found: ${ref}`);
    const existing = game.actors.find(
      a => a.getFlag?.('core', 'sourceId') === ref || a._stats?.compendiumSource === ref
    );
    return existing ?? game.actors.importFromCompendium(game.packs.get(source.pack), source.id);
  }
  return resolveActor(ref, null);
}

function placementCells(scene, args, count) {
  const occupied = occupiedCells(scene);
  let start;
  if (args.near) start = tokenCell(resolveToken(args.near, scene), scene);
  else if (Number.isFinite(Number(args.col)) && Number.isFinite(Number(args.row))) {
    start = { col: Number(args.col), row: Number(args.row) };
  } else throw new ToolInputError('Give col and row, or near (a token).');
  const cells = [];
  if (!args.near && !occupied.has(`${start.col},${start.row}`) && inBounds(scene, start))
    cells.push(start);
  while (cells.length < count) {
    cells.forEach(c => occupied.add(`${c.col},${c.row}`));
    cells.push(freeCellNear(scene, start, { occupied }));
  }
  return cells;
}

async function placeToken(args) {
  const scene = resolveScene(args.scene);
  const actor = await actorForPlacement(args.actor);
  const count = Math.min(Math.max(Number(args.count) || 1, 1), 20);
  const cells = placementCells(scene, args, count);
  const data = [];
  for (const cell of cells) {
    const point = cellToPoint(scene, cell);
    const overrides = { x: point.x, y: point.y, hidden: args.hidden === true };
    if (args.name) overrides.name = args.name;
    if (args.disposition)
      overrides.disposition = { hostile: -1, neutral: 0, friendly: 1 }[args.disposition];
    const doc = await actor.getTokenDocument(overrides);
    data.push(doc.toObject());
  }
  const created = await scene.createEmbeddedDocuments('Token', data);
  return `Placed ${created.length} x ${actor.name} on "${scene.name}":\n${created.map(tokenLine).join('\n')}`;
}

async function removeTokens(args) {
  const scene = resolveScene(args.scene);
  const tokens = toList(args.tokens ?? args.token).map(ref => resolveToken(ref, scene));
  if (!tokens.length) throw new ToolInputError('tokens is required.');
  await scene.deleteEmbeddedDocuments(
    'Token',
    tokens.map(t => t.id)
  );
  return `Removed ${tokens.map(t => t.name).join(', ')} from "${scene.name}".`;
}

async function setHidden(args) {
  const scene = resolveScene(args.scene);
  const tokens = toList(args.tokens ?? args.token).map(ref => resolveToken(ref, scene));
  if (!tokens.length) throw new ToolInputError('tokens is required.');
  const hidden = args.hidden !== false;
  await scene.updateEmbeddedDocuments(
    'Token',
    tokens.map(t => ({ _id: t.id, hidden }))
  );
  return `${hidden ? 'Hid' : 'Revealed'} ${tokens.map(t => t.name).join(', ')}.`;
}

function getDistance(args) {
  const scene = resolveScene(args.scene);
  const from = resolveToken(args.from, scene);
  const { distance, units } = gridInfo(scene);
  const targets = toList(args.to);
  if (!targets.length) throw new ToolInputError('to is required.');
  return targets
    .map(ref => {
      const to = resolveToken(ref, scene);
      const feet = tokenDistance(from, to, scene);
      const squares = feet / distance;
      return `${from.name} -> ${to.name}: ${feet} ${units} (${squares} square${squares === 1 ? '' : 's'})`;
    })
    .join('\n');
}

const SCENE_PARAM = { type: 'string', description: 'Scene id or name (default: the viewed scene)' };
const TOKENS_PARAM = {
  type: 'array',
  items: { type: 'string' },
  description: 'Token names or ids',
};

export const TOKEN_TOOLS = [
  {
    name: 'list_tokens',
    readOnly: true,
    description:
      'List tokens on a scene with grid position (col/row), friendly/hostile, HP, size, conditions, hidden state and token ids.',
    parameters: {
      properties: {
        scene: SCENE_PARAM,
        filter: { type: 'string', enum: ['all', 'hostile', 'friendly', 'neutral', 'pcs', 'npcs'] },
      },
    },
    run: listTokens,
  },
  {
    name: 'move_token',
    description:
      'Move a token to a grid square (col/row), next to another token (nearest free square), or a number of feet in a direction. GM moves ignore walls.',
    parameters: {
      properties: {
        token: { type: 'string', description: 'Token name or id' },
        col: { type: 'integer' },
        row: { type: 'integer' },
        near: { type: 'string', description: 'Move adjacent to this token' },
        direction: { type: 'string', enum: Object.keys(DIRECTIONS).filter(d => d.length > 2) },
        feet: { type: 'number', description: 'With direction' },
        animate: { type: 'boolean', description: 'Default true' },
        scene: SCENE_PARAM,
      },
      required: ['token'],
    },
    run: moveToken,
  },
  {
    name: 'place_token',
    description:
      'Put an actor on the map as a token (e.g. spawn monsters): at col/row or near a token, optionally several at once in free squares, hidden, renamed, or with a disposition. Compendium actors are imported first.',
    parameters: {
      properties: {
        actor: {
          type: 'string',
          description: 'Actor id, name or UUID (Compendium.* UUIDs are imported)',
        },
        col: { type: 'integer' },
        row: { type: 'integer' },
        near: { type: 'string', description: 'Place around this token' },
        count: { type: 'integer', description: 'How many (1-20)' },
        hidden: { type: 'boolean', description: 'Place hidden from players' },
        name: { type: 'string' },
        disposition: { type: 'string', enum: ['hostile', 'neutral', 'friendly'] },
        scene: SCENE_PARAM,
      },
      required: ['actor'],
    },
    run: placeToken,
  },
  {
    name: 'remove_token',
    destructive: true,
    description: 'Delete tokens from a scene (the actors stay in the world).',
    parameters: { properties: { tokens: TOKENS_PARAM, scene: SCENE_PARAM }, required: ['tokens'] },
    run: removeTokens,
  },
  {
    name: 'set_token_hidden',
    description: 'Hide tokens from players (ambushes, secret doors) or reveal them.',
    parameters: {
      properties: {
        tokens: TOKENS_PARAM,
        hidden: { type: 'boolean', description: 'true to hide (default), false to reveal' },
        scene: SCENE_PARAM,
      },
      required: ['tokens'],
    },
    run: setHidden,
  },
  {
    name: 'get_distance',
    readOnly: true,
    description:
      'Distance between tokens in feet, counted the 5e way (edge to edge, diagonals as one square). Use it for reach, ranges and movement.',
    parameters: {
      properties: {
        from: { type: 'string', description: 'Token name or id' },
        to: TOKENS_PARAM,
        scene: SCENE_PARAM,
      },
      required: ['from', 'to'],
    },
    run: getDistance,
  },
];
