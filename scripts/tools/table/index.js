/**
 * All table tools (dice, chat, combat, tokens, scenes, characters, world),
 * registered alongside Simulacrum's document tools. See table-tool.js.
 */

import { registerTableTools } from './table-tool.js';
import { DICE_TOOLS } from './dice-tools.js';
import { CHAT_TOOLS } from './chat-tools.js';
import { COMBAT_TOOLS } from './combat-tools.js';
import { TOKEN_TOOLS } from './token-tools.js';
import { SCENE_TOOLS } from './scene-tools.js';
import { ACTOR_TOOLS } from './actor-tools.js';
import { WORLD_TOOLS } from './world-tools.js';

export const TABLE_TOOL_SPECS = [
  ...DICE_TOOLS,
  ...CHAT_TOOLS,
  ...COMBAT_TOOLS,
  ...TOKEN_TOOLS,
  ...SCENE_TOOLS,
  ...ACTOR_TOOLS,
  ...WORLD_TOOLS,
];

/** @param {import('../../core/tool-registry.js').ToolRegistry} registry */
export function registerAllTableTools(registry) {
  return registerTableTools(registry, TABLE_TOOL_SPECS);
}
