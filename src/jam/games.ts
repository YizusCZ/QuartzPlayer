/**
 * Games in a room. The host runs them; everyone else sees the host's game
 * state and sends their moves.
 *
 *  - Tops: five songs from a category play one after another, and nobody
 *    knows which comes next. While each one plays, every player puts it in
 *    one of the five places of their own top, for good. At the end everyone
 *    votes for the best top (not their own), and a top can be shared as an
 *    image.
 *  - Adivina la canción: ten clips, three choices each; one point per right
 *    answer. A tie for first adds tie-break rounds that only the tied players
 *    answer; if they are still tied after three, the fastest total answer
 *    time wins.
 *
 * Clips last at most 25 s (less when everyone already chose), with 3 s in
 * between. They play on the host's player like any room song, so every phone
 * stays in sync on its own; the room's own music is put aside and given back
 * when the game ends.
 */
import { direct, Player, playerSettled, playerTime, setClipMode, setLockScreenMask } from '@/audio/engine';
import { days, dedupe, isOneSong, normTitle, pick, weightedSample } from '@/lib/songPicker';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { useSongHistory } from '@/store/songHistory';
import { useUI } from '@/store/ui';
import {
  playlistSongs,
  search,
  searchSongs,
  toTrack,
  type YtCollection,
  type YtItem,
  type YtSong,
} from '@/youtube/music';
import type { GameCategory } from './gameCategories';
import { presentMembers, roomAnnounce, roomNow, roomSend, setRoomExtension } from './session';
import { songHidden, useGame, useJam, useJamProfile } from './store';
import type { GameCommand, GameKind, GameOption, GamePlayer, GameSong, GameState } from './types';

/** Longest clip (s), and the pause between clips. */
export const CLIP_S = 25;
export const GAP_MS = 3000;
export const COUNTDOWN_MS = 3000;
export const TOP_SIZE = 5;
const GUESS_ROUNDS = 10;
const MAX_TIEBREAKS = 3;
export const VOTE_MS = 45_000;
/** A song that has not started after this long is swapped for another. */
const START_TIMEOUT_MS = 12_000;
/** Spare songs, for the ones that fail to load. */
const SPARES = 4;
const TICK_MS = 200;
/** The full state again now and then, in case a message got lost. */
const RESEND_MS = 3000;

export const GAME_NAMES: Record<GameKind, string> = { tops: 'Tops', guess: 'Adivina la canción' };

const me = () => useJamProfile.getState();
const isHost = () => useJam.getState().isHost;
const toast = (m: string) => useUI.getState().showToast(m);
const randomId = () => Math.random().toString(36).slice(2, 10);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ───────── songs ───────── */

/** Playlists read per search: picked at random, so each game draws from different ones. */
const LISTS_PER_QUERY = 3;
const SONGS_PER_LIST = 200;
/** Remixes and live takes are not the song people know. */
const NOT_THE_ORIGINAL = /\b(remix|live|en vivo|extended|acoustic|ac[uú]stico|karaoke|instrumental ver)\b/i;
const ARTISTS_PER_GAME = 12;
const SONGS_PER_ARTIST = 6;
/** Variety even in a small category: no artist more than this in one game. */
const MAX_PER_ARTIST = 2;
/** After this long, a song played in a game counts as fairly new again. */
const FRESH_AFTER_MS = days(45);

/**
 * Songs for a category: several public playlists its searches find (not always
 * the top ones), read at once, plus plain song search for the rarest categories.
 * The ones you have heard least recently come first, in `need`; the rest follow
 * for spares and wrong answers.
 */
async function gather(cat: GameCategory, need: number, signal: AbortSignal): Promise<YtSong[]> {
  const pool = await (cat.artists?.length ? artistSongs(cat, signal) : searchedSongs(cat, need, signal));
  const { heard } = useSongHistory.getState();
  const chosen = pick(pool, need, {
    lastHeard: (id) => heard[id],
    now: Date.now(),
    maxPerArtist: MAX_PER_ARTIST,
    freshAfterMs: FRESH_AFTER_MS,
    randomness: 1,
  });
  const inGame = new Set(chosen.map((s) => s.videoId));
  const byId = new Map(pool.map((s) => [s.videoId, s]));
  const rest = shuffle(dedupe(pool).filter((s) => !inGame.has(s.videoId))).slice(0, 40);
  return [...chosen, ...rest].flatMap((s) => byId.get(s.videoId) ?? []);
}

const looseName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

/** The popular songs of some of the category's artists, only those really theirs. */
async function artistSongs(cat: GameCategory, signal: AbortSignal): Promise<YtSong[]> {
  const artists = shuffle(cat.artists ?? []).slice(0, ARTISTS_PER_GAME);
  const found = await Promise.all(
    artists.map(async (artist) => {
      const q = cat.suffix ? `${artist} ${cat.suffix}` : artist;
      const songs = await searchSongs(q, signal).catch(() => [] as YtSong[]);
      const name = looseName(artist);
      return songs
        .filter((s) => looseName(s.artist).includes(name) && !NOT_THE_ORIGINAL.test(s.title))
        .slice(0, SONGS_PER_ARTIST);
    }),
  );
  return found.flat().filter(isOneSong);
}

/** Your own words: public playlists that talk about them, and plain song search. */
async function searchedSongs(cat: GameCategory, need: number, signal: AbortSignal): Promise<YtSong[]> {
  const pages = await Promise.all(
    cat.queries.map(async (q) => {
      const found: YtItem[] = await search(q, 'playlists', signal).catch(() => []);
      const lists = found.filter((x): x is YtCollection => x.kind === 'collection' && x.page === 'playlist');
      // The top results fit best, but all of them get a chance.
      const chosen = weightedSample(
        lists.map((item, i) => ({ item, weight: 1 / (1 + i * 0.25) })),
        LISTS_PER_QUERY,
      );
      return Promise.all(
        chosen.map((l) =>
          playlistSongs(l.browseId, signal, SONGS_PER_LIST)
            .then((p) => p.songs)
            .catch(() => [] as YtSong[]),
        ),
      );
    }),
  );
  let pool: YtSong[] = pages.flat(2).filter(isOneSong);
  if (dedupe(pool).length < need * 2) {
    const more = await Promise.all(cat.queries.map((q) => searchSongs(q, signal).catch(() => [] as YtSong[])));
    pool = [...pool, ...more.flat().filter(isOneSong)];
  }
  return pool;
}

/** Where a clip starts: about a third in, where the chorus usually is by then. */
function clipStart(duration: number) {
  if (!duration) return 40;
  if (duration < CLIP_S + 20) return 0;
  return Math.round(Math.min(Math.max(duration * 0.33, 20), duration - CLIP_S - 10));
}

/* ───────── host ───────── */

let g: GameState | null = null;
/** The songs in play order; the spares are at the end. */
let plan: GameSong[] = [];
/** Index in `plan` of the song of this round. */
let cursor = 0;
/** Guess the song: wrong choices to pick from. */
let decoys: GameOption[] = [];
/** Guess the song: this round's answers, kept secret until the reveal. */
let answers: Record<string, { option: number; ms: number }> = {};
/** Guess the song: the right choice of this round. */
let answer = 0;
let tiebreaks = 0;
let phaseSince = 0;
let sentAt = 0;
let ticker: ReturnType<typeof setInterval> | undefined;
let loading: AbortController | null = null;
/** The room's music while the game plays, given back at the end. */
let saved: { queue: string[]; index: number; pos: number } | null = null;
let lastCategory: { kind: GameKind; cat: GameCategory } | null = null;

function publish(patch: Partial<GameState> | null) {
  if (patch === null) {
    g = null;
    useGame.setState({ game: null });
    roomSend('game', { game: null });
    return;
  }
  if (!g) return;
  g = { ...g, ...patch, v: g.v + 1 };
  sentAt = Date.now();
  useGame.setState({ game: g });
  roomSend('game', { game: g });
}

const playersOf = (): GamePlayer[] => presentMembers().map((m) => ({ id: m.id, name: m.name, color: m.color }));

/** Starts a game with whoever is in the room now (host only). */
export async function startGame(kind: GameKind, cat: GameCategory) {
  if (!isHost() || g) return;
  const players = playersOf();
  if (!players.some((p) => p.id === me().id)) players.unshift({ id: me().id, name: me().name, color: me().color });
  lastCategory = { kind, cat };
  tiebreaks = 0;
  answers = {};
  g = {
    v: 0,
    id: randomId(),
    kind,
    categoryId: cat.id,
    category: cat.name,
    phase: 'loading',
    round: 0,
    rounds: kind === 'tops' ? TOP_SIZE : GUESS_ROUNDS,
    endsAt: 0,
    startedAt: 0,
    players,
    song: null,
    done: [],
    ...(kind === 'tops'
      ? { tops: Object.fromEntries(players.map((p) => [p.id, Array<GameSong | null>(TOP_SIZE).fill(null)])) }
      : {
          scores: Object.fromEntries(players.map((p) => [p.id, 0])),
          times: Object.fromEntries(players.map((p) => [p.id, 0])),
        }),
  };
  publish({});
  startTicker();
  roomAnnounce(`Empieza ${GAME_NAMES[kind]} · ${cat.name}`);
  // The room's music waits while the songs are found.
  const s = usePlayer.getState();
  saved = { queue: s.queue, index: s.index, pos: playerTime() };
  direct(() => Player.pause());

  loading?.abort();
  const ctrl = new AbortController();
  loading = ctrl;
  const playable = (kind === 'tops' ? TOP_SIZE : GUESS_ROUNDS + MAX_TIEBREAKS) + SPARES;
  let songs: YtSong[];
  try {
    songs = await gather(cat, playable, ctrl.signal);
  } catch {
    songs = [];
  }
  if (ctrl.signal.aborted || !g) return;
  loading = null;
  const enough = kind === 'tops' ? TOP_SIZE + 1 : GUESS_ROUNDS + 4;
  if (songs.length < enough) {
    toast('No encontré suficientes canciones de esa categoría. Prueba otra.');
    roomAnnounce('El juego no pudo empezar: faltaron canciones');
    return endGame();
  }

  const tracks = songs.map((s) => toTrack(s));
  const inPlay = tracks.slice(0, Math.min(playable, tracks.length - (kind === 'guess' ? 4 : 0)));
  useLibrary.getState().addRemote(inPlay);
  plan = inPlay.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    artwork: t.artwork,
    duration: t.duration,
    start: clipStart(t.duration),
  }));
  // The songs not in play make the wrong choices, so a choice never gives away a later round.
  decoys = tracks.slice(inPlay.length).map((t) => ({ title: t.title, artist: t.artist }));
  if (decoys.length < 4)
    decoys = [...decoys, ...plan.slice(-SPARES).map((s) => ({ title: s.title, artist: s.artist }))];

  cursor = 0;
  // The first clip loads on every phone during the countdown.
  cue(false);
  publish({ phase: 'countdown', endsAt: roomNow() + COUNTDOWN_MS, ...roundData(1) });
}

/** Ends the game for everyone and gives the room its music back (host only). */
export function endGame() {
  if (!isHost()) return;
  loading?.abort();
  loading = null;
  stopTicker();
  restoreMusic();
  publish(null);
}

/** The same game again, with new songs (host only). */
export function playAgain() {
  const again = lastCategory;
  if (!isHost() || !again) return;
  endGame();
  void startGame(again.kind, again.cat);
}

function restoreMusic() {
  const b = saved;
  saved = null;
  if (b) direct(() => Player.syncTo(b.queue, b.index, b.pos, false));
}

function cue(play: boolean) {
  const song = plan[cursor];
  if (!song) return;
  // Heard from here on: the next game prefers others (a song that fails to load is noted too; harmless).
  if (play) useSongHistory.getState().note(song.id.replace(/^yt:/, ''));
  direct(() =>
    Player.syncTo(
      plan.map((s) => s.id),
      cursor,
      song.start,
      play,
    ),
  );
}

/** Three choices: the right one and two others, in random order. */
function optionsFor(song: GameSong): { options: GameOption[]; answer: number } {
  const right = { title: song.title, artist: song.artist };
  const wrong: GameOption[] = [];
  const pool = shuffle(decoys.filter((d) => normTitle(d.title) !== normTitle(song.title)));
  // Prefer other artists: two songs by the same artist are a coin toss, not a guess.
  for (const d of [...pool.filter((d) => d.artist !== song.artist), ...pool]) {
    if (wrong.length === 2) break;
    if (!wrong.some((w) => normTitle(w.title) === normTitle(d.title))) wrong.push(d);
  }
  const options = shuffle([right, ...wrong]);
  return { options, answer: options.indexOf(right) };
}

function roundData(round: number): Partial<GameState> {
  const song = plan[cursor];
  answers = {};
  const base: Partial<GameState> = { round, done: [], picks: undefined, answer: undefined, startedAt: 0 };
  if (!g || g.kind === 'tops') return { ...base, song: null };
  const o = optionsFor(song);
  answer = o.answer;
  return { ...base, song: null, options: o.options };
}

function startClip() {
  if (!g) return;
  phaseSince = Date.now();
  cue(true);
  // Tops shows the song as soon as it plays; guess the song keeps it for the reveal.
  publish({ phase: 'playing', endsAt: 0, startedAt: 0, song: g.kind === 'tops' ? plan[cursor] : null });
}

/** Who answers this round (a tie-break: only the tied players). */
const eligible = (st: GameState) => st.tiebreak ?? st.players.map((p) => p.id);

function everyoneDone(st: GameState) {
  const here = new Set(presentMembers().map((m) => m.id));
  const need = eligible(st).filter((id) => here.has(id));
  return need.length > 0 && need.every((id) => st.done.includes(id));
}

function tick() {
  const st = g;
  if (!st || !isHost()) return;
  const now = roomNow();
  switch (st.phase) {
    case 'countdown':
      if (now >= st.endsAt) startClip();
      break;
    case 'playing': {
      const song = plan[cursor];
      if (!st.startedAt) {
        const p = usePlayer.getState();
        if (song && playerSettled(song.id) && p.playing) {
          const left = Math.max(3, Math.min(CLIP_S, song.start + CLIP_S - playerTime()));
          publish({ startedAt: now, endsAt: now + left * 1000 });
        } else if (Date.now() - phaseSince > START_TIMEOUT_MS) swapSong();
        break;
      }
      if (now >= st.endsAt || everyoneDone(st)) endClip();
      break;
    }
    case 'reveal':
      if (now >= st.endsAt) nextRound();
      break;
    case 'voting': {
      const voters = st.players.filter((p) => presentMembers().some((m) => m.id === p.id));
      if (now >= st.endsAt || voters.every((p) => st.votes?.[p.id])) showResults();
      break;
    }
  }
  if (g && Date.now() - sentAt > RESEND_MS) roomSend('game', { game: g });
}

/** The song would not load: another one takes its place in the same round. */
function swapSong() {
  if (!g) return;
  plan.splice(cursor, 1);
  if (cursor >= plan.length) {
    roomAnnounce('Se acabaron las canciones que cargaban: el juego termina aquí');
    return finish();
  }
  phaseSince = Date.now();
  const data = roundData(g.round);
  cue(true);
  publish({ ...data, phase: 'playing', endsAt: 0, song: g.kind === 'tops' ? plan[cursor] : null });
}

function endClip() {
  const st = g;
  if (!st) return;
  direct(() => Player.pause());
  const song = plan[cursor];
  const reveal: Partial<GameState> = { phase: 'reveal', endsAt: roomNow() + GAP_MS, song };
  if (st.kind === 'tops') {
    // Nobody stays without a place for this song: it goes to a free one.
    const tops = { ...st.tops };
    for (const p of st.players) {
      const top = [...(tops[p.id] ?? Array<GameSong | null>(TOP_SIZE).fill(null))];
      if (top.some((x) => x?.id === song.id)) continue;
      const free = top.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
      if (free.length) top[free[Math.floor(Math.random() * free.length)]] = song;
      tops[p.id] = top;
    }
    publish({ ...reveal, tops });
    return;
  }
  const scores = { ...st.scores };
  const times = { ...st.times };
  const picks: Record<string, number> = {};
  for (const id of eligible(st)) {
    const a = answers[id];
    if (!a) continue;
    picks[id] = a.option;
    if (a.option === answer) {
      scores[id] = (scores[id] ?? 0) + 1;
      times[id] = (times[id] ?? 0) + a.ms;
    }
  }
  publish({ ...reveal, answer, picks, scores, times });
}

/** Players with the most points (guess the song). */
function leaders(st: GameState) {
  const best = Math.max(...st.players.map((p) => st.scores?.[p.id] ?? 0));
  return st.players.filter((p) => (st.scores?.[p.id] ?? 0) === best).map((p) => p.id);
}

function nextRound() {
  const st = g;
  if (!st) return;
  if (st.round < st.rounds && cursor + 1 < plan.length) {
    cursor++;
    publish(roundData(st.round + 1));
    return startClip();
  }
  if (st.kind === 'tops') {
    if (st.players.length < 2) return finish();
    return publish({ phase: 'voting', endsAt: roomNow() + VOTE_MS, votes: {}, song: null, done: [] });
  }
  const tied = leaders(st);
  if (tied.length > 1 && tiebreaks < MAX_TIEBREAKS && cursor + 1 < plan.length) {
    tiebreaks++;
    cursor++;
    const names = tied.map((id) => st.players.find((p) => p.id === id)?.name ?? '').join(', ');
    roomAnnounce(`¡Empate! Desempate ${tiebreaks}: ${names}`);
    publish({ ...roundData(st.round + 1), rounds: st.rounds + 1, tiebreak: tied });
    return startClip();
  }
  finish();
}

function showResults() {
  const st = g;
  if (!st) return;
  const count = new Map<string, number>();
  for (const to of Object.values(st.votes ?? {})) count.set(to, (count.get(to) ?? 0) + 1);
  const best = Math.max(0, ...count.values());
  finish(best > 0 ? [...count].filter(([, n]) => n === best).map(([id]) => id) : []);
}

function finish(winners?: string[]) {
  const st = g;
  if (!st) return;
  let w = winners;
  if (!w && st.kind === 'guess') {
    w = leaders(st);
    // Still tied after the tie-breaks: the fastest total answer time.
    if (w.length > 1) {
      const fastest = Math.min(...w.map((id) => st.times?.[id] ?? Infinity));
      w = w.filter((id) => (st.times?.[id] ?? Infinity) === fastest);
    }
  }
  w ??= [];
  stopTicker();
  restoreMusic();
  publish({ phase: 'results', endsAt: 0, song: null, winners: w });
  const names = w.map((id) => st.players.find((p) => p.id === id)?.name).filter(Boolean);
  roomAnnounce(
    names.length
      ? `${names.join(' y ')} ${names.length > 1 ? 'ganaron' : 'ganó'} ${GAME_NAMES[st.kind]}`
      : 'Terminó el juego',
  );
}

function onCommand(from: string, c: GameCommand) {
  const st = g;
  if (!st || !st.players.some((p) => p.id === from)) return;
  switch (c.type) {
    case 'place': {
      const song = plan[cursor];
      if (st.kind !== 'tops' || st.phase !== 'playing' || c.round !== st.round || st.done.includes(from)) return;
      const top = [...(st.tops?.[from] ?? Array<GameSong | null>(TOP_SIZE).fill(null))];
      if (c.slot < 0 || c.slot >= TOP_SIZE || top[c.slot]) return;
      top[c.slot] = song;
      publish({ tops: { ...st.tops, [from]: top }, done: [...st.done, from] });
      break;
    }
    case 'answer':
      if (st.kind !== 'guess' || st.phase !== 'playing' || c.round !== st.round || st.done.includes(from)) return;
      if (!eligible(st).includes(from) || c.option < 0 || c.option > 2) return;
      answers[from] = { option: c.option, ms: Math.max(0, Math.min(CLIP_S * 1000, c.ms)) };
      publish({ done: [...st.done, from] });
      break;
    case 'vote':
      if (st.phase !== 'voting' || c.for === from || !st.players.some((p) => p.id === c.for)) return;
      publish({ votes: { ...st.votes, [from]: c.for } });
      break;
  }
}

function startTicker() {
  stopTicker();
  ticker = setInterval(tick, TICK_MS);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = undefined;
}

/* ───────── everyone ───────── */

function command(c: GameCommand) {
  if (isHost()) onCommand(me().id, c);
  else roomSend('gcmd', { from: me().id, cmd: c });
}

/** Your moves (they go to the host). */
export const Game = {
  place(slot: number) {
    const st = useGame.getState().game;
    if (st) command({ type: 'place', round: st.round, slot });
  },
  answer(option: number) {
    const st = useGame.getState().game;
    if (!st) return;
    const ms = st.startedAt ? roomNow() - st.startedAt : CLIP_S * 1000;
    command({ type: 'answer', round: st.round, option, ms });
  },
  vote(player: string) {
    command({ type: 'vote', for: player });
  },
};

/** Time left in the current phase (ms), on this phone's clock. */
export const gameTimeLeft = (st: GameState) => (st.endsAt ? Math.max(0, st.endsAt - roomNow()) : null);

function reset() {
  loading?.abort();
  loading = null;
  stopTicker();
  g = null;
  plan = [];
  decoys = [];
  answers = {};
  saved = null;
  useGame.setState({ game: null });
}

setRoomExtension({
  onMessage(event, payload) {
    if (event === 'gcmd') {
      const p = payload as { from: string; cmd: GameCommand };
      if (isHost()) onCommand(p.from, p.cmd);
      return;
    }
    if (event !== 'game' || isHost()) return;
    const next = (payload as { game: GameState | null }).game;
    const cur = useGame.getState().game;
    if (next && cur && cur.id === next.id && next.v <= cur.v) return;
    useGame.setState({ game: next });
  },
  onHello() {
    if (g) roomSend('game', { game: g });
  },
  onBecomeHost() {
    // The game lived on the old host's phone: it cannot go on without it.
    if (g || !useGame.getState().game) return;
    useGame.setState({ game: null });
    roomSend('game', { game: null });
    roomAnnounce('El juego terminó porque el anfitrión salió');
  },
  onLeave: reset,
});

// Guess the song keeps the song off the notification until it is revealed.
useGame.subscribe((s, prev) => {
  // Clips start in the middle of a song, so warming up its beginning would be wasted.
  if (!!s.game !== !!prev.game) setClipMode(!!s.game);
  const hide = songHidden(s.game);
  if (hide !== songHidden(prev.game))
    setLockScreenMask(hide ? { title: 'Canción misteriosa', artist: 'Adivina la canción' } : null);
});
