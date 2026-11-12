/**
 * Detect `end_loop` calls that would hand control back to the user without
 * anything to read.
 *
 * Models sometimes call `end_loop` with reason "need_clarification" or
 * "question" but put their questions nowhere: no message content and no
 * `response` argument. The UI then shows an empty assistant bubble. The tool
 * loop uses these helpers to send the model back once to write the message.
 */

/** Tools whose calls render nothing in the chat log. */
const HIDDEN_TOOLS = new Set(['end_loop', 'manage_task']);

/** end_loop reasons that only make sense with a message for the user. */
const ASKING_REASONS = new Set(['need_clarification', 'question']);

/** How many times one loop may send the model back for a missing message. */
export const SILENT_END_LOOP_RETRY_LIMIT = 2;

export const SILENT_END_LOOP_CORRECTION =
  'Your end_loop call returned control to the user without any message, so the user saw an empty reply. ' +
  'The user cannot see your justification or tool arguments other than `response`. ' +
  'Call end_loop again and put the complete message for the user (for example your clarifying questions, ' +
  'or a summary of what you did) in its `response` parameter.';

/** Shown in the chat if the model still sends nothing after the retries. */
export const SILENT_END_LOOP_FALLBACK_NOTICE =
  '*The model ended its turn without a reply. Try asking again, or rephrase the request.*';

function toolName(toolCall) {
  return toolCall?.function?.name || toolCall?.name || '';
}

function toolArgs(toolCall) {
  const args = toolCall?.function?.arguments ?? toolCall?.arguments;
  if (!args) return {};
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args) ?? {};
  } catch {
    return {};
  }
}

/** True if any tool call renders a visible card (anything but end_loop/manage_task). */
export function hasVisibleToolCalls(toolCalls) {
  return Array.isArray(toolCalls) && toolCalls.some(tc => !HIDDEN_TOOLS.has(toolName(tc)));
}

/**
 * The `reason` of the end_loop call in this response, `null` if end_loop was
 * called without one, or `undefined` if end_loop was not called.
 */
export function getEndLoopReason(toolCalls) {
  if (!Array.isArray(toolCalls)) return undefined;
  const call = toolCalls.find(tc => toolName(tc) === 'end_loop');
  if (!call) return undefined;
  return toolArgs(call).reason ?? null;
}

/**
 * Would this response end the loop leaving the user nothing to read?
 * @param {object} params
 * @param {string} [params.content] - Assistant text for this turn (including any `response` argument)
 * @param {Array} [params.toolCalls] - Tool calls in this turn
 * @param {boolean} [params.visibleOutputEmitted] - Whether earlier turns of this loop showed anything
 * @returns {boolean}
 */
export function isSilentEndLoop({ content, toolCalls, visibleOutputEmitted = false }) {
  if (typeof content === 'string' && content.trim().length > 0) return false;
  const reason = getEndLoopReason(toolCalls);
  if (reason === undefined) return false;
  if (hasVisibleToolCalls(toolCalls)) return false;
  return ASKING_REASONS.has(reason) || !visibleOutputEmitted;
}
