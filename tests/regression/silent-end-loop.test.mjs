/**
 * Regression: a model that calls end_loop with reason "need_clarification" but
 * writes no message (no content, no `response` argument) left an empty reply
 * bubble and the user never saw the questions. The loop must send the model
 * back to write the message, and fall back to a visible notice if it never does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal Foundry shims BEFORE importing the modules under test.
let idCounter = 0;
globalThis.game = {
  settings: { get: (_scope, key) => (key === 'toolLoopLimit' ? 100 : 0) },
  user: { id: 'user1', isGM: true },
  i18n: { localize: key => key },
};
globalThis.foundry = {
  utils: { randomID: () => `id${++idCounter}`.padEnd(16, '0') },
};
globalThis.Hooks = { callAll: () => {}, call: () => true, on: () => 0, once: () => 0 };
globalThis.FormApplication = class {};
globalThis.CONFIG = { debug: {} };

const { isSilentEndLoop, getEndLoopReason, SILENT_END_LOOP_CORRECTION } =
  await import('../../scripts/core/silent-end-loop.js');

const endLoop = (args, id = 'call_end') => ({
  id,
  function: { name: 'end_loop', arguments: JSON.stringify(args) },
});

test('isSilentEndLoop flags end_loop that leaves the user nothing to read', () => {
  const clarify = [endLoop({ justification: 'asking questions', reason: 'need_clarification' })];
  assert.equal(getEndLoopReason(clarify), 'need_clarification');
  assert.equal(isSilentEndLoop({ content: '', toolCalls: clarify }), true);
  // Even after earlier visible output, a question with no text is still silent.
  assert.equal(
    isSilentEndLoop({ content: '', toolCalls: clarify, visibleOutputEmitted: true }),
    true
  );
  // With the questions as content (or the `response` argument, which the loop copies into content) it is fine.
  assert.equal(isSilentEndLoop({ content: 'What CR?', toolCalls: clarify }), false);
});

test('isSilentEndLoop allows a bare task_complete after visible work', () => {
  const done = [endLoop({ reason: 'task_complete' })];
  assert.equal(
    isSilentEndLoop({ content: '', toolCalls: done, visibleOutputEmitted: true }),
    false
  );
  assert.equal(
    isSilentEndLoop({ content: '', toolCalls: done, visibleOutputEmitted: false }),
    true
  );
  // Other tools in the same turn render cards, so the turn is not silent.
  const withCreate = [
    { id: 'c1', function: { name: 'create_document', arguments: '{}' } },
    endLoop({ reason: 'task_complete' }),
  ];
  assert.equal(isSilentEndLoop({ content: '', toolCalls: withCreate }), false);
  // No end_loop at all: not this helper's concern.
  assert.equal(isSilentEndLoop({ content: '', toolCalls: [] }), false);
});

function makeConversation() {
  const messages = [{ role: 'user', content: 'help me make new monster for lv 2 party' }];
  return {
    messages,
    addMessage(role, content, ...rest) {
      const [toolCalls = null, toolCallId = null, metadata = null] = rest;
      const msg = { role, content };
      if (toolCalls) msg.tool_calls = toolCalls;
      if (toolCallId) msg.tool_call_id = toolCallId;
      if (metadata) Object.assign(msg, metadata);
      messages.push(msg);
    },
    getMessages: () => messages,
    save: async () => {},
    estimatePromptOverhead: () => 0,
    compactHistory: async () => 'within_budget',
  };
}

async function runLoop(aiReplies) {
  const { processToolCallLoop } = await import('../../scripts/core/tool-loop-handler.js');
  const { toolRegistry } = await import('../../scripts/core/tool-registry.js');
  toolRegistry.registerDefaults();
  const conversation = makeConversation();
  const shown = [];
  const requests = [];
  const queue = [...aiReplies];
  const aiClient = {
    chatWithSystem: async messages => {
      requests.push(messages.map(m => m.role));
      const next = queue.shift();
      if (!next) throw new Error('unexpected extra AI request');
      return { choices: [{ message: next }] };
    },
    chat: async () => {
      throw new Error('fallback chat should not be used');
    },
  };
  const [first, ...rest] = aiReplies;
  queue.splice(0, queue.length, ...rest);
  const result = await processToolCallLoop({
    initialResponse: { content: first.content ?? '', toolCalls: first.tool_calls ?? [] },
    conversationManager: conversation,
    aiClient,
    getSystemPrompt: async () => 'system',
    currentToolSupport: true,
    onToolResult: async msg => {
      if (msg.role === 'assistant') shown.push(msg.content ?? '');
    },
    onToolPending: () => {},
  });
  return { result, shown, conversation, requests };
}

test('an end_loop with no message sends the model back for the questions', async () => {
  const { shown, conversation } = await runLoop([
    // Turn 1: exactly what the interaction log showed - questions announced but never written.
    {
      content: '',
      tool_calls: [
        endLoop({
          justification: "I'm asking a few short questions",
          reason: 'need_clarification',
        }),
      ],
    },
    // Turn 2: after the correction the model puts its questions in `response`.
    {
      content: '',
      tool_calls: [
        endLoop(
          { justification: 'asking', reason: 'need_clarification', response: 'What theme and CR?' },
          'call_end2'
        ),
      ],
    },
  ]);

  assert.deepEqual(
    shown,
    ['What theme and CR?'],
    'only the real questions are shown, no empty bubble'
  );
  assert.ok(
    conversation.messages.some(
      m => m.role === 'developer' && m.content === SILENT_END_LOOP_CORRECTION
    ),
    'the model is told its reply was empty'
  );
});

test('a model that never writes a message ends with a visible notice, not an empty reply', async () => {
  const silent = id => ({
    content: '',
    tool_calls: [endLoop({ reason: 'need_clarification' }, id)],
  });
  const { shown, requests } = await runLoop([silent('a'), silent('b'), silent('c')]);

  assert.equal(requests.length, 2, 'retries are bounded');
  assert.equal(shown.length, 1);
  assert.match(shown[0], /ended its turn without a reply/);
});
