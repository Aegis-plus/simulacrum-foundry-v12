/**
 * Chat tools: narrate or speak in character, read what happened in chat
 * (including roll results), and show handouts to players.
 */

import { ToolInputError, resolveActor, resolveToken, toList } from './resolve.js';

const STYLE = () => CONST.CHAT_MESSAGE_STYLES ?? { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 };

function escapeHtml(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Plain text (blank-line separated paragraphs) to HTML; HTML is passed through. */
export function toChatHtml(text) {
  const value = String(text ?? '').trim();
  if (/^<[a-z][\s\S]*>$/i.test(value)) return value;
  return value
    .split(/\n\s*\n/)
    .map(p => `<p>${escapeHtml(p).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

/** HTML to readable plain text. */
export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function whisperRecipients(whisperTo) {
  const ids = new Set();
  for (const ref of toList(whisperTo)) {
    const key = ref.toLowerCase();
    if (key === 'gm') game.users.filter(u => u.isGM).forEach(u => ids.add(u.id));
    else if (key === 'players') game.users.filter(u => !u.isGM).forEach(u => ids.add(u.id));
    else {
      const user = game.users.get(ref) ?? game.users.find(u => u.name.toLowerCase() === key);
      if (!user) throw new ToolInputError(`No user named "${ref}" to whisper to.`);
      ids.add(user.id);
    }
  }
  return [...ids];
}

function tokenOrNull(ref) {
  try {
    return resolveToken(ref);
  } catch {
    return null;
  }
}

function inCharacterSpeaker(speaker, alias) {
  if (!speaker) {
    throw new ToolInputError('speaker (an actor or token) is required to speak in character.');
  }
  const token = tokenOrNull(speaker);
  const actor = token?.actor ?? resolveActor(speaker);
  const data = ChatMessage.getSpeaker({ token, actor });
  return alias ? { ...data, alias } : data;
}

function speakerFor({ as, speaker, speaker_name: alias }) {
  if (as === 'actor' || as === 'emote') return inCharacterSpeaker(speaker, alias);
  if (as === 'ooc') return { alias: alias ?? game.user?.name ?? 'GM' };
  return { alias: alias ?? 'Narrator' };
}

function messageStyle(as) {
  const styles = STYLE();
  return { actor: styles.IC, emote: styles.EMOTE, ooc: styles.OOC }[as] ?? styles.OTHER;
}

async function postMessage(args) {
  const text = args.text ?? args.message;
  if (!text) throw new ToolInputError('text is required.');
  const as = args.as ?? (args.speaker ? 'actor' : 'narrator');
  const data = {
    content: toChatHtml(text),
    speaker: speakerFor({ ...args, as }),
    style: messageStyle(as),
  };
  if (args.flavor) data.flavor = args.flavor;
  const whisper = whisperRecipients(args.whisper_to);
  if (whisper.length) data.whisper = whisper;
  await ChatMessage.create(data);
  const kind = as === 'narrator' ? 'narration' : `${as} message`;
  const whispered = whisper.length ? ` (whispered to ${whisper.length} user(s))` : '';
  return `Posted ${kind} as ${data.speaker.alias ?? 'the speaker'}${whispered}.`;
}

function describeRolls(message) {
  return (message.rolls ?? []).map(roll => `${roll.formula} = ${roll.total}`);
}

function speakerName(message) {
  return (
    message.speaker?.alias ?? message.alias ?? message.author?.name ?? message.user?.name ?? '?'
  );
}

function messageHeader(message) {
  const time = new Date(message.timestamp ?? Date.now()).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const speaker = speakerName(message);
  const tags = [
    message.whisper?.length ? 'whisper' : null,
    message.blind ? 'blind' : null,
    message.flags?.dnd5e?.roll?.type ?? null,
  ].filter(Boolean);
  const flavor = message.flavor ? ` - ${stripHtml(message.flavor)}` : '';
  return `[${time}] ${speaker}${tags.length ? ` (${tags.join(', ')})` : ''}${flavor}`;
}

function describeMessage(message) {
  const rolls = describeRolls(message);
  const lines = [messageHeader(message)];
  if (rolls.length) {
    lines.push(`  rolls: ${rolls.join('; ')}`);
  } else {
    const body = stripHtml(message.content);
    if (body) lines.push(`  ${body.replaceAll('\n', '\n  ').slice(0, 1500)}`);
  }
  return lines.join('\n');
}

function readChat({ limit = 20, include_whispers: whispers = true, speaker }) {
  const count = Math.min(Math.max(Number(limit) || 20, 1), 100);
  let messages = game.messages?.contents ?? [];
  if (whispers === false) messages = messages.filter(m => !m.whisper?.length);
  if (speaker) {
    const wanted = speaker.toLowerCase();
    messages = messages.filter(m =>
      (m.speaker?.alias ?? m.alias ?? '').toLowerCase().includes(wanted)
    );
  }
  const recent = messages.slice(-count);
  if (!recent.length) return 'No chat messages.';
  return `Last ${recent.length} chat message(s), oldest first:\n${recent.map(describeMessage).join('\n')}`;
}

async function showJournal(ref, users) {
  const doc =
    globalThis.fromUuidSync?.(ref) ?? game.journal.get(ref) ?? game.journal.getName?.(ref);
  if (!doc) return null;
  const Journal = globalThis.Journal;
  if (typeof Journal?.show !== 'function')
    throw new ToolInputError('This Foundry version cannot show journals from tools.');
  await Journal.show(doc, { force: true, users });
  return `Showed "${doc.name}" to ${users?.length ? `${users.length} user(s)` : 'all players'}.`;
}

async function showImage(src, title) {
  const Popout = globalThis.ImagePopout;
  if (!Popout) throw new ToolInputError('ImagePopout is not available.');
  const popout = new Popout(src, { title: title ?? '', shareable: true });
  popout.render(true);
  await popout.shareImage();
  return `Showed image ${src} to all players.`;
}

async function showHandout({ journal, image, title, whisper_to: to }) {
  const users = toList(to).length ? whisperRecipients(to) : undefined;
  if (journal) {
    const shown = await showJournal(journal, users);
    if (shown) return shown;
    throw new ToolInputError(`Journal entry or page not found: ${journal}`);
  }
  if (image) return showImage(image, title);
  throw new ToolInputError('Pass a journal (entry/page id, UUID or name) or an image path.');
}

export const CHAT_TOOLS = [
  {
    name: 'post_message',
    description:
      'Post to the Foundry chat: narration (default, as "Narrator"), in-character speech as an actor or token, an emote, or an out-of-character note; optionally whispered. Plain text paragraphs are fine; HTML is passed through.',
    parameters: {
      properties: {
        text: { type: 'string', description: 'What to post' },
        as: {
          type: 'string',
          enum: ['narrator', 'actor', 'emote', 'ooc'],
          description: 'Default: narrator, or actor when a speaker is given',
        },
        speaker: { type: 'string', description: 'Actor or token speaking (for actor/emote)' },
        speaker_name: {
          type: 'string',
          description: 'Override the displayed name (e.g. "Mysterious Voice")',
        },
        flavor: { type: 'string', description: 'Small heading shown above the message' },
        whisper_to: {
          type: 'array',
          items: { type: 'string' },
          description: 'User names, "gm" or "players"',
        },
      },
      required: ['text'],
    },
    run: postMessage,
  },
  {
    name: 'read_chat',
    readOnly: true,
    description:
      'Read recent chat messages, oldest first, including who spoke, roll formulas and totals, and whispers. Use it to see what players said or rolled.',
    parameters: {
      properties: {
        limit: { type: 'integer', description: 'How many messages (default 20, max 100)' },
        include_whispers: { type: 'boolean', description: 'Default true' },
        speaker: { type: 'string', description: 'Only messages whose speaker name contains this' },
      },
    },
    run: readChat,
  },
  {
    name: 'show_handout',
    description:
      'Show a journal entry or page, or an image, to the players (pops up on their screens).',
    parameters: {
      properties: {
        journal: { type: 'string', description: 'Journal entry or page: id, UUID or name' },
        image: { type: 'string', description: 'Image path or URL' },
        title: { type: 'string', description: 'Title for an image' },
        whisper_to: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only these users (journals only)',
        },
      },
    },
    run: showHandout,
  },
];
