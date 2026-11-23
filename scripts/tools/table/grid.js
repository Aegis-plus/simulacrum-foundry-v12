/**
 * Grid helpers. Positions are given to the agent as map-relative grid squares
 * (col 0, row 0 = the top-left square of the map, ignoring the scene's padding),
 * alongside the raw canvas pixels Foundry stores.
 */

function sceneOrigin(scene) {
  const dims = scene.dimensions ?? {};
  return { x: dims.sceneX ?? 0, y: dims.sceneY ?? 0 };
}

export function gridInfo(scene) {
  const grid = scene.grid ?? {};
  return {
    size: grid.size || 100,
    distance: grid.distance || 5,
    units: grid.units || 'ft',
    type: grid.type ?? 1,
  };
}

/** The square (col/row) holding a canvas point. */
export function pointToCell(scene, point) {
  const { size } = gridInfo(scene);
  const origin = sceneOrigin(scene);
  return {
    col: Math.floor((point.x - origin.x) / size),
    row: Math.floor((point.y - origin.y) / size),
  };
}

/** Top-left canvas point of a square. */
export function cellToPoint(scene, { col, row }) {
  const { size } = gridInfo(scene);
  const origin = sceneOrigin(scene);
  return { x: origin.x + col * size, y: origin.y + row * size };
}

/** The square under a token's top-left corner. */
export function tokenCell(token, scene = token.parent) {
  return pointToCell(scene, { x: token.x + 1, y: token.y + 1 });
}

export function tokenCenter(token, scene = token.parent) {
  const { size } = gridInfo(scene);
  return {
    x: token.x + ((token.width ?? 1) * size) / 2,
    y: token.y + ((token.height ?? 1) * size) / 2,
  };
}

/**
 * Distance between two canvas points in scene units. Uses the scene grid's own
 * measurement (v12 BaseGrid#measurePath, respecting the diagonal rule) when
 * available, else counts squares with 5e's default 5-5-5 diagonals.
 */
export function measureDistance(scene, a, b) {
  const grid = scene.grid;
  if (typeof grid?.measurePath === 'function') {
    const result = grid.measurePath([a, b]);
    if (Number.isFinite(result?.distance)) return result.distance;
  }
  const { size, distance } = gridInfo(scene);
  const dx = Math.abs(Math.round((b.x - a.x) / size));
  const dy = Math.abs(Math.round((b.y - a.y) / size));
  return Math.max(dx, dy) * distance;
}

function footprint(token, scene) {
  const { col, row } = tokenCell(token, scene);
  const w = Math.max(1, Math.round(token.width ?? 1));
  const h = Math.max(1, Math.round(token.height ?? 1));
  return { c0: col, c1: col + w - 1, r0: row, r1: row + h - 1 };
}

/**
 * Distance between two tokens the way 5e counts it: squares between their
 * nearest edges (so a Large creature is adjacent to everything around it),
 * diagonals counting as one square. Adjacent tokens are one square (5 ft) apart.
 */
export function tokenDistance(a, b, scene = a.parent) {
  const { distance } = gridInfo(scene);
  const fa = footprint(a, scene);
  const fb = footprint(b, scene);
  const gapX = Math.max(0, fb.c0 - fa.c1, fa.c0 - fb.c1);
  const gapY = Math.max(0, fb.r0 - fa.r1, fa.r0 - fb.r1);
  return Math.max(gapX, gapY) * distance;
}

export function describeCell(scene, token) {
  const { col, row } = tokenCell(token, scene);
  return `col ${col}, row ${row}`;
}
