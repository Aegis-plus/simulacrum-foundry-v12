/**
 * World tools: the in-game clock and ambient audio.
 */

import { ToolInputError, resolveWorldDocument } from './resolve.js';

const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400, rounds: 6 };

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return `day ${days + 1}, ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

async function advanceTime(args) {
  let seconds = 0;
  for (const [unit, factor] of Object.entries(UNIT_SECONDS))
    seconds += (Number(args[unit]) || 0) * factor;
  if (seconds === 0) {
    return `World time: ${formatDuration(game.time.worldTime)} (${game.time.worldTime} seconds since the start).`;
  }
  if (seconds < 0) throw new ToolInputError('Time can only move forward.');
  await game.time.advance(seconds);
  return `Advanced ${seconds} seconds. World time: ${formatDuration(game.time.worldTime)}.`;
}

function describePlaylists() {
  const lists = game.playlists?.contents ?? [];
  if (!lists.length) return 'No playlists.';
  return lists
    .map(p => {
      const sounds = p.sounds.contents.map(s => `${s.name}${s.playing ? ' (playing)' : ''}`);
      return `${p.name}${p.playing ? ' (playing)' : ''} [${p.id}]: ${sounds.join(', ') || 'empty'}`;
    })
    .join('\n');
}

function findSound(playlist, ref) {
  const key = String(ref).toLowerCase();
  const sound = playlist.sounds.get(ref) ?? playlist.sounds.find(s => s.name.toLowerCase() === key);
  if (!sound) throw new ToolInputError(`"${playlist.name}" has no sound "${ref}".`);
  return sound;
}

async function playFile(file, volume) {
  const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
  if (!helper?.play) throw new ToolInputError('Audio playback is not available.');
  await helper.play({ src: file, volume: volume ?? 0.8, loop: false }, true);
  return `Playing ${file} for everyone.`;
}

async function stopAll() {
  const playing = game.playlists.filter(p => p.playing);
  for (const playlist of playing) await playlist.stopAll();
  return `Stopped ${playing.length} playlist(s).`;
}

async function playFromPlaylist(playlist, args) {
  if (args.stop_others) await stopAll();
  if (args.sound) {
    const sound = findSound(playlist, args.sound);
    await playlist.playSound(sound);
    return `Playing "${sound.name}" from "${playlist.name}".`;
  }
  await playlist.playAll();
  return `Playing playlist "${playlist.name}".`;
}

async function stopInPlaylist(playlist, args) {
  if (args.sound) {
    const sound = findSound(playlist, args.sound);
    await playlist.stopSound(sound);
    return `Stopped "${sound.name}".`;
  }
  await playlist.stopAll();
  return `Stopped playlist "${playlist.name}".`;
}

async function playAudio(args) {
  const action = args.action ?? 'list';
  if (action === 'list') return describePlaylists();
  if (action === 'stop_all') return stopAll();
  if (action === 'play' && args.file) return playFile(args.file, args.volume);
  if (action !== 'play' && action !== 'stop') {
    throw new ToolInputError('action must be list, play, stop or stop_all.');
  }
  const playlist = resolveWorldDocument(game.playlists, args.playlist, 'Playlist');
  return action === 'play' ? playFromPlaylist(playlist, args) : stopInPlaylist(playlist, args);
}

export const WORLD_TOOLS = [
  {
    name: 'advance_time',
    description:
      'Move the in-game clock forward (rounds, minutes, hours, days), or report the current world time when called with nothing. Modules that track time (calendars, effect durations) follow it.',
    parameters: {
      properties: {
        rounds: { type: 'number', description: '6 seconds each' },
        seconds: { type: 'number' },
        minutes: { type: 'number' },
        hours: { type: 'number' },
        days: { type: 'number' },
      },
    },
    run: advanceTime,
  },
  {
    name: 'play_audio',
    description:
      'Ambient audio for everyone: list playlists and sounds, play a playlist or one of its sounds, play an audio file once, stop a playlist or sound, or stop everything.',
    parameters: {
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'play', 'stop', 'stop_all'],
          description: 'Default list',
        },
        playlist: { type: 'string', description: 'Playlist id or name' },
        sound: { type: 'string', description: 'Sound name in the playlist' },
        file: { type: 'string', description: 'Audio file path to play once (action play)' },
        volume: { type: 'number', description: '0-1, for a file' },
        stop_others: { type: 'boolean', description: 'Stop other playlists first' },
      },
    },
    run: playAudio,
  },
];
