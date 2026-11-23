/**
 * Scene tools: switch scenes, draw everyone's attention to a spot, and work
 * doors.
 */

import { ToolInputError, resolveScene, resolveToken } from './resolve.js';
import { cellToPoint, gridInfo, pointToCell, tokenCenter } from './grid.js';

async function activateScene({ scene: ref, mode = 'activate' }) {
  const scene = resolveScene(ref);
  if (mode === 'view') {
    await scene.view();
    return `Now viewing "${scene.name}" (players stay where they are).`;
  }
  await scene.activate();
  return `Activated "${scene.name}": all players now see it.`;
}

function targetPoint(scene, args) {
  if (args.token) return tokenCenter(resolveToken(args.token, scene), scene);
  if (Number.isFinite(Number(args.col)) && Number.isFinite(Number(args.row))) {
    const { size } = gridInfo(scene);
    const corner = cellToPoint(scene, { col: Number(args.col), row: Number(args.row) });
    return { x: corner.x + size / 2, y: corner.y + size / 2 };
  }
  throw new ToolInputError('Give a token, or col and row.');
}

async function panTo(args) {
  const scene = resolveScene(args.scene);
  const canvas = globalThis.canvas;
  if (!canvas?.ready || canvas.scene?.id !== scene.id) {
    throw new ToolInputError(`The GM is not viewing "${scene.name}"; use activate_scene first.`);
  }
  const point = targetPoint(scene, args);
  const everyone = args.everyone !== false;
  if (args.ping !== false || everyone) {
    await canvas.ping(point, { pull: everyone });
  } else {
    await canvas.animatePan({ x: point.x, y: point.y });
  }
  const { col, row } = pointToCell(scene, point);
  return `${everyone ? "Pulled everyone's view" : 'Pinged'} to col ${col}, row ${row}.`;
}

const DOOR_STATES = () => CONST.WALL_DOOR_STATES ?? { CLOSED: 0, OPEN: 1, LOCKED: 2 };
const STATE_NAMES = { 0: 'closed', 1: 'open', 2: 'locked' };

function doorCenter(wall) {
  const [x0, y0, x1, y1] = wall.c;
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

function doorsOf(scene) {
  return (scene.walls?.contents ?? []).filter(w => w.door > 0);
}

function describeDoor(scene, wall) {
  const { col, row } = pointToCell(scene, doorCenter(wall));
  const secret = wall.door === (CONST.WALL_DOOR_TYPES?.SECRET ?? 2) ? ', secret' : '';
  return `door ${wall.id} at col ${col}, row ${row}: ${STATE_NAMES[wall.ds] ?? wall.ds}${secret}`;
}

function findDoor(scene, args) {
  const doors = doorsOf(scene);
  if (args.door) {
    const door = doors.find(d => d.id === args.door);
    if (!door) throw new ToolInputError(`No door ${args.door} on "${scene.name}".`);
    return door;
  }
  if (!args.near)
    throw new ToolInputError('Give a door id, or near (a token) to use the closest door.');
  const center = tokenCenter(resolveToken(args.near, scene), scene);
  const dist = d => Math.hypot(doorCenter(d).x - center.x, doorCenter(d).y - center.y);
  const door = [...doors].sort((a, b) => dist(a) - dist(b))[0];
  if (!door) throw new ToolInputError(`"${scene.name}" has no doors.`);
  return door;
}

async function toggleDoor(args) {
  const scene = resolveScene(args.scene);
  const action = args.action ?? 'list';
  if (action === 'list') {
    const doors = doorsOf(scene);
    if (!doors.length) return `"${scene.name}" has no doors.`;
    return [`Doors on "${scene.name}":`, ...doors.map(d => describeDoor(scene, d))].join('\n');
  }
  const states = DOOR_STATES();
  const target = {
    open: states.OPEN,
    close: states.CLOSED,
    lock: states.LOCKED,
    unlock: states.CLOSED,
  }[action];
  if (target === undefined)
    throw new ToolInputError('action must be list, open, close, lock or unlock.');
  const door = findDoor(scene, args);
  await door.update({ ds: target });
  return `Door ${door.id} is now ${STATE_NAMES[target]} (${describeDoor(scene, door)}).`;
}

const SCENE_PARAM = { type: 'string', description: 'Scene id or name (default: the viewed scene)' };

export const SCENE_TOOLS = [
  {
    name: 'activate_scene',
    description:
      'Switch to a scene: "activate" moves every player to it; "view" only changes what the GM sees.',
    parameters: {
      properties: {
        scene: { type: 'string', description: 'Scene id, UUID or name' },
        mode: { type: 'string', enum: ['activate', 'view'], description: 'Default activate' },
      },
      required: ['scene'],
    },
    run: activateScene,
  },
  {
    name: 'pan_to',
    description:
      "Ping a token or grid square on the scene the GM is viewing and, by default, pull every player's view there.",
    parameters: {
      properties: {
        token: { type: 'string', description: 'Token name or id' },
        col: { type: 'integer' },
        row: { type: 'integer' },
        everyone: { type: 'boolean', description: "Move every player's view (default true)" },
        ping: { type: 'boolean', description: 'Show a ping (default true)' },
        scene: SCENE_PARAM,
      },
    },
    run: panTo,
  },
  {
    name: 'toggle_door',
    description:
      'List doors on a scene, or open, close, lock or unlock one (by door id, or the door closest to a token).',
    parameters: {
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'open', 'close', 'lock', 'unlock'],
          description: 'Default list',
        },
        door: { type: 'string', description: 'Wall id of the door (from list)' },
        near: { type: 'string', description: 'Use the door closest to this token' },
        scene: SCENE_PARAM,
      },
    },
    run: toggleDoor,
  },
];
