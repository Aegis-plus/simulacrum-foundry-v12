/**
 * Find Foundry documents from the loose references an agent passes: an id, a
 * UUID, or a name. Ambiguous names fail with the candidates listed, so the
 * agent can retry with an id instead of acting on the wrong token.
 */

import { describeCell } from './grid.js';

export class ToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolInputError';
  }
}

const norm = value =>
  String(value ?? '')
    .trim()
    .toLowerCase();

function fromUuidSafe(ref) {
  if (typeof ref !== 'string' || !ref.includes('.')) return null;
  try {
    return globalThis.fromUuidSync?.(ref) ?? null;
  } catch {
    return null;
  }
}

/** Exactly one match, or null when there is none. Throws when ambiguous. */
function uniqueMatch(docs, name, describe, key = doc => doc.name) {
  const matches = docs.filter(doc => norm(key(doc)) === norm(name));
  if (matches.length <= 1) return matches[0] ?? null;
  const list = matches.map(describe).join('; ');
  throw new ToolInputError(`"${name}" matches ${matches.length} documents: ${list}. Use an id.`);
}

const uniqueByName = (docs, name, describe) => uniqueMatch(docs, name, describe);

/** The scene by reference, or the scene the GM is viewing (then the active scene). */
export function resolveScene(ref) {
  const scenes = game.scenes;
  if (!ref) {
    const scene = scenes?.viewed ?? scenes?.active;
    if (!scene) throw new ToolInputError('No scene is being viewed or active; pass a scene.');
    return scene;
  }
  const scene =
    scenes?.get(ref) ??
    fromUuidSafe(ref) ??
    uniqueByName(scenes?.contents ?? [], ref, s => `${s.name} (${s.id})`);
  if (!scene || scene.documentName !== 'Scene') throw new ToolInputError(`Scene not found: ${ref}`);
  return scene;
}

export function describeToken(token) {
  return `${token.name} (token ${token.id} at ${describeCell(token.parent, token)})`;
}

/** A token in the scene by token id/UUID, token name, or the id/name of its actor. */
export function resolveToken(ref, scene = resolveScene()) {
  if (!ref) throw new ToolInputError('A token is required.');
  const byUuid = fromUuidSafe(ref);
  if (byUuid?.documentName === 'Token') return byUuid;
  const tokens = scene.tokens?.contents ?? [];
  const token =
    scene.tokens?.get(ref) ??
    uniqueByName(tokens, ref, describeToken) ??
    tokens.find(t => t.actorId === ref) ??
    uniqueMatch(tokens, ref, describeToken, t => t.actor?.name);
  if (!token) throw new ToolInputError(`No token "${ref}" in scene "${scene.name}".`);
  return token;
}

function tokenInScene(ref, scene) {
  if (!scene) return null;
  try {
    return resolveToken(ref, scene);
  } catch (error) {
    if (/matches \d+ documents/.test(error.message)) throw error;
    return null;
  }
}

/**
 * An actor by UUID (including token actors), a token in the viewed scene, or a
 * world actor by id or name. Tokens win so unlinked monsters resolve to the
 * creature on the map rather than the sidebar template.
 */
export function resolveActor(ref, scene = game.scenes?.viewed ?? game.scenes?.active) {
  if (!ref) throw new ToolInputError('An actor or token is required.');
  const byUuid = fromUuidSafe(ref);
  if (byUuid?.documentName === 'Actor') return byUuid;
  if (byUuid?.documentName === 'Token' && byUuid.actor) return byUuid.actor;
  const token = tokenInScene(ref, scene);
  if (token?.actor) return token.actor;
  const actors = game.actors;
  const actor =
    actors?.get(ref) ?? uniqueByName(actors?.contents ?? [], ref, a => `${a.name} (${a.id})`);
  if (!actor) throw new ToolInputError(`Actor not found: ${ref}`);
  return actor;
}

/** An item owned by the actor, by id or name. */
export function resolveItem(actor, ref) {
  if (!ref) throw new ToolInputError('An item is required.');
  const items = actor.items;
  const item =
    items?.get(ref) ?? uniqueByName(items?.contents ?? [], ref, i => `${i.name} (${i.id})`);
  if (!item) {
    const names = (items?.contents ?? []).map(i => i.name).slice(0, 40);
    throw new ToolInputError(`${actor.name} has no item "${ref}". Items: ${names.join(', ')}`);
  }
  return item;
}

/** A world document of the given collection by id, UUID, or name. */
export function resolveWorldDocument(collection, ref, label) {
  if (!ref) throw new ToolInputError(`A ${label} is required.`);
  const doc =
    collection?.get(ref) ??
    fromUuidSafe(ref) ??
    uniqueByName(collection?.contents ?? [], ref, d => `${d.name} (${d.id})`);
  if (!doc) throw new ToolInputError(`${label} not found: ${ref}`);
  return doc;
}

/** The combat to act on: by id, or the active combat (falling back to the viewed scene's). */
export function resolveCombat(ref) {
  const combats = game.combats;
  const combat = ref
    ? combats?.get(ref)
    : (combats?.active ?? combats?.contents?.find(c => c.scene?.id === game.scenes?.viewed?.id));
  if (!combat)
    throw new ToolInputError(ref ? `Combat not found: ${ref}` : 'There is no active combat.');
  return combat;
}

/** Turn a string or array argument into a list of strings. */
export function toList(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map(v => String(v).trim())
    .filter(Boolean);
}
