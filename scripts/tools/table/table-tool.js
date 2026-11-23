/**
 * Table tools: tools for running a game at the table (dice, chat, combat,
 * tokens, character state, time and audio), as opposed to Simulacrum's
 * document-editing tools. Each tool is a small spec:
 *
 *   { name, description, parameters, readOnly?, destructive?, run(args) }
 *
 * `run` returns a string (shown to the agent and in the chat card) or
 * `{ content, display?, data? }`, and throws ToolInputError for bad input.
 */

import { BaseTool } from '../base-tool.js';
import { ToolInputError } from './resolve.js';

export class TableTool extends BaseTool {
  constructor(spec) {
    super(spec.name, spec.description, null, false, false);
    this.spec = spec;
    /** Only reads state; MCP clients may auto-approve it. */
    this.readOnly = spec.readOnly === true;
    /** Removes or overwrites something that cannot be recovered from the chat log. */
    this.destructive = spec.destructive === true;
  }

  getParameterSchema() {
    const params = this.spec.parameters ?? {};
    return this._addResponseParam({
      type: 'object',
      properties: params.properties ?? {},
      required: params.required ?? [],
    });
  }

  async execute(params = {}) {
    try {
      const out = await this.spec.run(params ?? {});
      if (typeof out === 'string') return { content: out, display: out };
      return { display: out.content, ...out };
    } catch (error) {
      const message =
        error instanceof ToolInputError
          ? error.message
          : `${this.name} failed: ${error?.message ?? error}`;
      return this.handleError(message, error?.name ?? 'Error');
    }
  }
}

/**
 * Register every table tool with the registry (skipping names already taken).
 * @param {import('../../core/tool-registry.js').ToolRegistry} registry
 * @param {object[]} specs
 */
export function registerTableTools(registry, specs) {
  let added = 0;
  for (const spec of specs) {
    if (registry.getTool(spec.name)) continue;
    registry.registerTool(new TableTool(spec), { category: 'table' });
    added++;
  }
  return added;
}
