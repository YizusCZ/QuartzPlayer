/**
 * Shared listening rooms ("salas"), over Supabase Realtime broadcast and
 * presence: no tables, nothing stored on the server.
 *
 * The host's phone is the source of truth and plays normally. Two messages
 * describe it:
 *  - `state`: the queue, settings and votes, only when they change (and to
 *    whoever just arrived);
 *  - `clock`: what is playing and where, on the host's clock — tiny, sent
 *    every second and right after any play, pause, seek or song change.
 *
 * Every guest streams the same YouTube song itself and stays on the host's
 * position:
 *  - its clock offset to the host comes from ping/pong round trips (NTP
 *    style: the fastest round trips are the most symmetric);
 *  - a new song starts from where the host is at the moment the stream is
 *    ready, not when loading began;
 *  - positions are read with the exact moment they were read (the midpoint
 *    of the native call), and a guest's gap is the median of its last few
 *    readings, so one late reading never triggers a correction;
 *  - small gaps are closed by playing a few percent faster or slower, pitch
 *    kept, which is seamless; only a big gap seeks (a seek on a stream
 *    rebuffers), landing ahead by a lead this phone learns from its own seeks.
 *    Phones settle within about 15 ms of the host on a steady connection.
 *
 * Android stops JS timers when the app goes to the background, which would
 * freeze heartbeats and get you dropped from the room: a headless task keeps
 * them running while you are in one. A dropped connection reconnects on its
 * own, and someone who vanishes gets a grace period before counting as gone.
 * When the host leaves, the member who joined first carries the room on.
 */
import { AppState } from 'react-native';
import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';
import { AudioRouteModule } from '../../modules/audio-route';
import { direct, Player, playerSettled, playerTime, setController, setSyncRate } from '@/audio/engine';
import type { Track } from '@/library/types';
import { trackById, useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { useUI } from '@/store/ui';
import { radio, toTrack } from '@/youtube/music';
import { useJam, useJamProfile } from './store';
import {
  RADIO_BY,
  type ChatMessage,
  type Clock,
  type Command,
  type Member,
  type Reaction,
  type RoomMode,
  type RoomState,
  type RoomTrack,
} from './types';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const jamAvailable = !!(URL && KEY);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Host: clock every second; the full state now and then, in case one got lost. */
const CLOCK_MS = 1000;
const STATE_REFRESH_MS = 10_000;
/** Guest: how often the gap to the host is checked. */
const CHECK_MS = 250;
/** Past this gap (s) a guest seeks; below it, it only changes speed. */
const SEEK_GAP = 0.7;
/** Gaps this small (s) are left alone: below what anyone can hear. */
const DEAD_BAND = 0.012;
/** Strongest speed change used to catch up (±8 %). */
const MAX_NUDGE = 0.08;
/** Speed change per second of gap: a small gap closes in about two seconds. */
const GAIN = 0.5;
/** Readings the gap is the median of. */
const GAP_SAMPLES = 3;
/** Ping round trips kept, and how many of the fastest are trusted. */
const PING_SAMPLES = 24;
const PING_BEST = 5;
const JOIN_TIMEOUT_MS = 9000;
/** Someone who vanished without saying goodbye still counts as here for this long. */
const GRACE_MS = 25_000;
const RADIO_COLOR = '#9B7BFF';

let client: RealtimeClient | null = null;
let channel: RealtimeChannel | null = null;
let timers: ReturnType<typeof setInterval>[] = [];
let unsubPlayer: (() => void) | null = null;
let joinTimer: ReturnType<typeof setTimeout> | undefined;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
let appStateSub: { remove(): void } | null = null;
let leaving = false;

// host
let version = 0;
let mode: RoomMode = 'dj';
let radioOn = true;
let fairOn = true;
const meta = new Map<string, RoomTrack>();
let skip = new Set<string>();
/** Songs the room already heard, so the radio does not bring them back. */
const heard = new Set<string>();
let radioFor: string | null = null;
let announced: string | null = null;
// guest
let last: RoomState | null = null;
let clock: Clock | null = null;
/** Host clock minus ours (ms). */
let offset = 0;
let samples: { rtt: number; offset: number }[] = [];
/** Recent gaps to the host (s), cleared after every jump. */
let gaps: number[] = [];
let holdUntil = 0;
let seekedAt = 0;
/** How far ahead to seek so the stream lands in time (s); learned per phone. */
let lead = 0.35;
let lastDriftShown = 0;
/** When the host was last heard from (state or clock). */
let heardHostAt = 0;
let helloAt = 0;
/** What you were listening to before the room, given back (paused) when you leave. */
let before: { queue: string[]; index: number; pos: number } | null = null;
// presence
let joinedAt = 0;
/** Members who disconnected without a goodbye, and since when. */
const away = new Map<string, { member: Member; since: number }>();
/** Members who said goodbye (left on purpose): never shown as "away". */
const gone = new Set<string>();

const me = () => useJamProfile.getState();
const toast = (m: string) => useUI.getState().showToast(m);
const isYt = (id: string) => id.startsWith('yt:');
const isHost = () => useJam.getState().isHost;

function getClient() {
  if (!client) {
    client = new RealtimeClient(`${URL.replace(/\/$/, '')}/realtime/v1`, {
      params: { apikey: KEY, eventsPerSecond: 20 },
      accessToken: async () => KEY,
      heartbeatIntervalMs: 15_000,
    });
  }
  return client;
}

function newCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export const normalizeCode = (c: string) =>
  c
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

function send(event: string, payload: object) {
  void channel?.send({ type: 'broadcast', event, payload });
}

/* ───────── tracks ───────── */

function roomTrack(t: Track, by = me().name, byColor = me().color): RoomTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    // Your own cover is a file on your phone: the room gets the original.
    artwork: t.customArtwork ? t.originalArtwork : t.artwork,
    duration: t.duration,
    video: t.video,
    by,
    byColor,
    votes: [],
  };
}

/** Makes room songs playable here (only the ones this phone has not seen). */
function remember(list: RoomTrack[]) {
  const lib = useLibrary.getState();
  const fresh = list.filter((r) => !trackById(lib, r.id));
  if (!fresh.length) return;
  lib.addRemote(
    fresh.map((r) =>
      toTrack({
        videoId: r.id.slice(3),
        title: r.title,
        artist: r.artist,
        album: r.album,
        thumbnail: r.artwork,
        duration: r.duration,
        video: r.video,
      }),
    ),
  );
}

/* ───────── host ───────── */

function metaFor(id: string): RoomTrack | null {
  const hit = meta.get(id);
  if (hit) return hit;
  const t = trackById(useLibrary.getState(), id);
  if (!t || t.source !== 'youtube') return null;
  const r = roomTrack(t);
  meta.set(id, r);
  return r;
}

/**
 * The player's position and the moment it was true (ms): the native call
 * takes a few ms, so the reading is stamped at its midpoint.
 */
function reading() {
  const t0 = Date.now();
  const pos = playerTime();
  return { pos, at: (t0 + Date.now()) / 2 };
}

function hostClock(): Clock {
  const s = usePlayer.getState();
  const { pos, at } = reading();
  return {
    id: s.queue[s.index] ?? null,
    index: s.index,
    playing: s.playing && !s.buffering,
    buffering: s.buffering,
    pos,
    at,
  };
}

function hostState(): RoomState {
  const s = usePlayer.getState();
  const queue = s.queue.map(metaFor).filter((r): r is RoomTrack => !!r);
  return {
    v: ++version,
    hostId: me().id,
    hostName: me().name,
    mode,
    radio: radioOn,
    fair: fairOn,
    queue,
    index: Math.min(s.index, Math.max(0, queue.length - 1)),
    skip: [...skip],
    clock: hostClock(),
  };
}

function sendState() {
  clearTimeout(stateTimer);
  if (!isHost()) return;
  const st = hostState();
  useJam.setState({ room: st });
  send('state', st);
}

/** Coalesces bursts (a vote, a queue edit) into one state message. */
function scheduleState(ms = 80) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(sendState, ms);
}

function sendClock() {
  if (isHost()) send('clock', hostClock());
}

/**
 * Orders what comes next: most votes first; with fair turns on, ties go
 * round-robin between the people who added them, so nobody hogs the queue.
 */
function reorder() {
  const s = usePlayer.getState();
  const upcoming = s.queue.slice(s.index + 1);
  if (upcoming.length < 2) return;
  const turn = new Map<string, number>();
  if (fairOn) {
    // Whoever chose the song playing now goes last in the next round.
    const nowBy = meta.get(s.queue[s.index] ?? '')?.by;
    const seen = new Map<string, number>();
    upcoming.forEach((id, i) => {
      const by = meta.get(id)?.by ?? '';
      const n = seen.get(by) ?? 0;
      seen.set(by, n + 1);
      turn.set(id, n * 1000 + (by === nowBy ? 500 : 0) + i);
    });
  }
  const ranked = upcoming
    .map((id, i) => ({ id, i, votes: meta.get(id)?.votes.length ?? 0, turn: turn.get(id) ?? i }))
    .sort((a, b) => b.votes - a.votes || a.turn - b.turn || a.i - b.i)
    .map((x) => x.id);
  if (ranked.some((id, i) => id !== upcoming[i])) direct(() => Player.setUpcoming(ranked));
}

function chatSystem(text: string) {
  const msg: ChatMessage = {
    id: `${Date.now()}${Math.random()}`,
    from: 'system',
    name: '',
    color: '',
    text,
    at: Date.now(),
  };
  pushChat(msg);
  send('chat', msg);
}

function handleCommand(from: string, c: Command) {
  const can = mode === 'all' || from === me().id;
  const s = usePlayer.getState();
  switch (c.type) {
    case 'toggle':
    case 'next':
    case 'prev':
      if (!can) return;
      direct(() => Player[c.type]());
      break;
    case 'seek':
      if (!can) return;
      direct(() => Player.seek(c.to));
      setTimeout(sendClock, 250);
      break;
    case 'jump':
      if (!can) return;
      direct(() => Player.jumpTo(c.index));
      break;
    case 'remove':
      if (!can || c.index === s.index) return;
      direct(() => Player.removeAt(c.index));
      break;
    case 'add': {
      if (!isYt(c.track.id)) return;
      const upcoming = s.queue.slice(s.index + 1);
      if (upcoming.includes(c.track.id)) return handleCommand(from, { type: 'vote', id: c.track.id });
      meta.set(c.track.id, { ...c.track, votes: [] });
      remember([c.track]);
      // The last song already ended: the new one starts right away (an empty queue does that by itself).
      const ended =
        s.queue.length > 0 &&
        s.index >= s.queue.length - 1 &&
        !s.playing &&
        s.duration > 0 &&
        s.position >= s.duration - 1.5;
      direct(() => (c.next && can ? Player.playNext(c.track.id) : Player.enqueue([c.track.id])));
      if (ended) direct(() => Player.jumpTo(s.queue.length));
      reorder();
      chatSystem(`${c.track.by} añadió “${c.track.title}”`);
      break;
    }
    case 'vote': {
      const r = meta.get(c.id);
      if (!r) return;
      r.votes = r.votes.includes(from) ? r.votes.filter((v) => v !== from) : [...r.votes, from];
      reorder();
      break;
    }
    case 'skip': {
      skip.add(from);
      const needed = Math.max(1, Math.ceil(presentMembers().length / 2));
      if (skip.size >= needed) {
        chatSystem('La sala votó saltar la canción');
        direct(() => Player.next());
      }
      break;
    }
  }
  scheduleState(40);
}

/** Your own taps while hosting: everything goes, except what would split the room. */
function hostController(command: string, args: unknown[]): boolean {
  if (command === 'setRate' || command === 'setNightcore' || command === 'setSlowed') {
    toast('En una sala la velocidad no cambia, para que todos sigan juntos');
    return true;
  }
  if (command === 'playTracks' || command === 'enqueue' || command === 'playNext') {
    const ids = (command === 'playNext' ? [args[0]] : args[0]) as string[];
    const yt = ids.filter(isYt);
    if (!yt.length) {
      toast('En la sala solo se comparten canciones de YouTube');
      return true;
    }
    if (yt.length !== ids.length) {
      toast('Tus archivos no se comparten: solo entran las de YouTube');
      direct(() => {
        if (command === 'playTracks') {
          const start = ids[(args[1] as number) ?? 0];
          Player.playTracks(yt, Math.max(0, yt.indexOf(start)), args[2] as { shuffle?: boolean });
        } else Player.enqueue(yt);
      });
      scheduleState();
      return true;
    }
  }
  if (command === 'seek') setTimeout(sendClock, 250);
  scheduleState(120);
  return false;
}

/** Keeps the room going: when the last song is playing, queue up the radio for it. */
async function topUpRadio() {
  if (!isHost() || !radioOn) return;
  const s = usePlayer.getState();
  const current = s.queue[s.index];
  if (!current || !isYt(current) || s.index < s.queue.length - 1 || radioFor === current) return;
  radioFor = current;
  try {
    const songs = (await radio(current.slice(3))).filter((x) => !heard.has(`yt:${x.videoId}`)).slice(0, 4);
    const now = usePlayer.getState();
    if (!isHost() || !songs.length || now.queue[now.queue.length - 1] !== current) return;
    const tracks = songs.map((x) => toTrack(x));
    useLibrary.getState().addRemote(tracks);
    for (const t of tracks) meta.set(t.id, roomTrack(t, RADIO_BY, RADIO_COLOR));
    direct(() => Player.enqueue(tracks.map((t) => t.id)));
    chatSystem('La radio de la sala añadió canciones parecidas');
    scheduleState(40);
  } catch {
    radioFor = null; // offline: try again on the next change
  }
}

function onHostPlayer(s: ReturnType<typeof usePlayer.getState>, prev: ReturnType<typeof usePlayer.getState>) {
  const id = s.queue[s.index];
  const changed = id !== prev.queue[prev.index];
  if (changed) {
    skip = new Set();
    if (id) heard.add(id);
  }
  // Play, pause, buffering and song changes move the clock: tell the room now.
  if (changed || s.playing !== prev.playing || s.buffering !== prev.buffering) sendClock();
  if (s.queue !== prev.queue || s.index !== prev.index) scheduleState(40);
  if (changed && id && announced !== id) {
    announced = id;
    const r = meta.get(id);
    if (r) chatSystem(r.by === RADIO_BY ? `Suena “${r.title}”` : `Suena “${r.title}”, elegida por ${r.by}`);
  }
  if (s.index >= s.queue.length - 1) void topUpRadio();
}

function becomeHost(from: RoomState | null) {
  useJam.setState({ isHost: true });
  void channel?.track(member(true));
  setSyncRate(1);
  meta.clear();
  skip = new Set();
  radioFor = null;
  if (from) {
    mode = from.mode;
    radioOn = from.radio ?? true;
    fairOn = from.fair ?? true;
    version = from.v;
    for (const r of from.queue) meta.set(r.id, r);
    for (const r of from.queue.slice(0, from.index + 1)) heard.add(r.id);
  } else {
    // A new room starts empty: what you were playing is offered, not imposed.
    heard.clear();
    mode = 'dj';
    radioOn = true;
    fairOn = true;
    version = 0;
    const s = usePlayer.getState();
    const current = s.queue[s.index];
    before = { queue: s.queue, index: s.index, pos: playerTime() };
    useJam.setState({ previous: current && isYt(current) ? current : null });
    direct(() => Player.syncTo([], 0, 0, false));
  }
  setController(hostController);
  unsubPlayer?.();
  let prev = usePlayer.getState();
  announced = prev.queue[prev.index] ?? null;
  unsubPlayer = usePlayer.subscribe((s) => {
    const p = prev;
    prev = s;
    onHostPlayer(s, p);
  });
  clearTimers();
  timers.push(setInterval(sendClock, CLOCK_MS));
  timers.push(setInterval(sendState, STATE_REFRESH_MS));
  timers.push(setInterval(sweepAway, 5000));
  sendState();
}

/* ───────── guest ───────── */

/** Where the host is at `now` (our clock, ms), from its last clock. */
function hostNow(c: Clock, now = Date.now()) {
  if (!c.playing) return c.pos;
  return c.pos + (now + offset - c.at) / 1000;
}

/** Forgets the recent gaps and waits a moment before correcting again. */
function settle(ms: number) {
  gaps = [];
  holdUntil = Date.now() + ms;
}

function applyState(st: RoomState) {
  if (isHost()) {
    // Two hosts after a hand-over race: the one who joined later steps down.
    if (st.hostId === me().id) return;
    const other = useJam.getState().members.find((m) => m.id === st.hostId);
    if (!other || other.joinedAt > joinedAt) return;
    stepDown();
  }
  if (last && st.hostId === last.hostId && st.v < last.v) return;
  clearTimeout(joinTimer);
  heardHostAt = Date.now();
  const first = !last;
  last = st;
  useJam.setState({
    room: st,
    status: 'joined',
    error: null,
    reconnecting: false,
    ...(first ? { welcome: st.hostName || 'tu amigo' } : null),
  });
  remember(st.queue);
  applyClock(st.clock, true);
}

function applyClock(c: Clock, fromState = false) {
  if (isHost()) return;
  // Clocks can overtake the state that lists a new song: wait for that state.
  heardHostAt = Date.now();
  if (!fromState && last && c.id && last.queue[c.index]?.id !== c.id) return hello();
  clock = c;
  const st = last;
  if (!st) return;
  const ids = st.queue.map((r) => r.id);
  const s = usePlayer.getState();
  const changed = s.queue[s.index] !== c.id;
  // The start position is read when the stream is ready, not now.
  direct(() => Player.syncTo(ids, c.index, () => (clock ? hostNow(clock) + lead : 0), c.playing || c.buffering));
  if (changed) {
    setSyncRate(1);
    settle(900);
  }
  correct();
}

/** Closes the gap to the host: speed for small gaps, a seek for big ones. */
function correct() {
  const c = clock;
  if (!c || isHost() || !c.id) return;
  if (!playerSettled(c.id)) return;
  const { pos: local, at } = reading();
  const s = usePlayer.getState();
  if (!c.playing) {
    setSyncRate(1);
    if (c.buffering) return; // the host waits on the network: keep going, it will catch up
    if (s.playing) direct(() => Player.pause());
    if (Math.abs(local - c.pos) > 0.1 && Date.now() >= holdUntil) {
      direct(() => Player.seek(c.pos));
      settle(1000);
    }
    return;
  }
  if (!s.playing) {
    direct(() => Player.toggle());
    settle(600);
  }
  if (Date.now() < holdUntil) return;
  const target = hostNow(c, at);
  const raw = local - target; // > 0: we are ahead
  // First look after our own seek: learn how late seeks land on this phone.
  if (seekedAt) {
    lead = Math.min(1.5, Math.max(0.05, lead - raw * 0.8));
    seekedAt = 0;
  }
  if (Math.abs(raw) > SEEK_GAP) {
    setSyncRate(1);
    direct(() => Player.seek(hostNow(c) + lead));
    seekedAt = Date.now();
    settle(1200);
    return;
  }
  gaps = [...gaps, raw].slice(-GAP_SAMPLES);
  const d = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
  if (Math.abs(d) < DEAD_BAND) {
    setSyncRate(1);
  } else {
    // Proportional: the further off, the faster it closes (0.25 % steps, to avoid churn).
    const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -d * GAIN));
    setSyncRate(1 + Math.round(nudge * 400) / 400);
  }
  const now = Date.now();
  if (now - lastDriftShown > 900) {
    lastDriftShown = now;
    useJam.setState({ drift: Math.round(d * 1000) });
  }
}

/** Asks the host for the full state (at most every 2 s). */
function hello() {
  if (Date.now() - helloAt < 2000) return;
  helloAt = Date.now();
  send('hello', { from: me().id });
}

function ping() {
  send('ping', { from: me().id, t0: Date.now() });
}

/** A quick burst of pings to (re)settle the clock offset. */
function pingBurst() {
  for (let i = 0; i < 5; i++) setTimeout(ping, i * 300);
}

function onPong(p: { to: string; t0: number; th: number }) {
  if (p.to !== me().id) return;
  const t1 = Date.now();
  samples = [...samples, { rtt: t1 - p.t0, offset: p.th - (p.t0 + t1) / 2 }].slice(-PING_SAMPLES);
  // The fastest round trips are the most symmetric: trust those.
  const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, PING_BEST);
  offset = best.reduce((a, b) => a + b.offset, 0) / best.length;
}

function guestController(command: string, args: unknown[]): boolean {
  const can = last?.mode === 'all';
  const add = (ids: string[], next = false) => {
    const lib = useLibrary.getState();
    const tracks = ids
      .filter(isYt)
      .map((id) => trackById(lib, id))
      .filter((t): t is Track => !!t);
    if (!tracks.length) return toast('En la sala solo se comparten canciones de YouTube');
    for (const t of tracks) sendCommand({ type: 'add', track: roomTrack(t), next });
    toast(
      tracks.length === 1 ? `“${tracks[0].title}” añadida a la sala` : `${tracks.length} canciones añadidas a la sala`,
    );
  };
  switch (command) {
    case 'next':
      if (can) sendCommand({ type: 'next' });
      else {
        sendCommand({ type: 'skip' });
        toast('Votaste para saltar esta canción');
      }
      return true;
    case 'toggle':
    case 'prev':
      if (can) sendCommand({ type: command });
      else toast('El anfitrión controla la reproducción');
      return true;
    case 'seek':
      if (can) sendCommand({ type: 'seek', to: args[0] as number });
      else toast('El anfitrión controla la reproducción');
      return true;
    case 'jumpTo':
      if (can) sendCommand({ type: 'jump', index: args[0] as number });
      else toast('El anfitrión controla la reproducción');
      return true;
    case 'removeAt':
      if (can) sendCommand({ type: 'remove', index: args[0] as number });
      else toast('Solo el anfitrión puede quitar canciones');
      return true;
    case 'playTracks': {
      const ids = args[0] as string[];
      add([ids[(args[1] as number) ?? 0]]);
      return true;
    }
    case 'enqueue':
      add(args[0] as string[]);
      return true;
    case 'playNext':
      add([args[0] as string], true);
      return true;
    case 'setRate':
    case 'setNightcore':
    case 'setSlowed':
      toast('En una sala la velocidad no cambia, para que todos sigan juntos');
      return true;
    default:
      toast('Solo el anfitrión puede hacer eso');
      return true;
  }
}

function stepDown() {
  useJam.setState({ isHost: false });
  void channel?.track(member(false));
  unsubPlayer?.();
  unsubPlayer = null;
  setController(guestController);
  startGuestTimers();
}

function startGuestTimers() {
  clearTimers();
  timers.push(setInterval(correct, CHECK_MS));
  // Keep the offset fresh (networks change, clocks drift).
  timers.push(setInterval(ping, 2000));
  timers.push(setInterval(sweepAway, 5000));
  timers.push(setInterval(checkHost, 2000));
  pingBurst();
}

/* ───────── members ───────── */

const member = (host: boolean): Member => {
  const p = me();
  return { id: p.id, name: p.name, color: p.color, joinedAt, host };
};

/** Who is connected right now (not the ones in their grace period). */
const presentMembers = () => useJam.getState().members.filter((m) => !m.away);

function onPresence() {
  if (!channel) return;
  const state = channel.presenceState<Member>();
  const live = Object.values(state)
    .map((list) => list[0])
    .filter((m): m is Member & { presence_ref: string } => !!m?.id)
    .map(({ id, name, color, joinedAt: j, host }) => ({ id, name, color, joinedAt: j, host }));
  const liveIds = new Set(live.map((m) => m.id));
  const prev = useJam.getState().members;
  for (const m of prev) {
    if (liveIds.has(m.id) || m.away) continue;
    // Gone from presence without a goodbye: probably the network or the background. Wait.
    if (!gone.has(m.id) && m.id !== me().id) away.set(m.id, { member: m, since: Date.now() });
  }
  for (const m of live) {
    const back = away.delete(m.id);
    gone.delete(m.id);
    // The host greets arrivals in the chat (only the host, so it is said once).
    if (isHost() && !back && m.id !== me().id && !prev.some((x) => x.id === m.id))
      chatSystem(`${m.name} se unió a la sala`);
  }
  publishMembers(live);
}

function publishMembers(live: Member[]) {
  const ghosts = [...away.values()].map((a) => ({ ...a.member, away: true }));
  const members = [...live, ...ghosts.filter((g) => !live.some((m) => m.id === g.id))].sort(
    (a, b) => a.joinedAt - b.joinedAt,
  );
  useJam.setState({ members });
}

/** Ends the grace period of members who did not come back. */
function sweepAway() {
  const now = Date.now();
  let changed = false;
  for (const [id, a] of away) {
    if (now - a.since < GRACE_MS) continue;
    away.delete(id);
    changed = true;
    if (isHost()) chatSystem(`${a.member.name} salió de la sala`);
  }
  if (changed) publishMembers(useJam.getState().members.filter((m) => !m.away));
}

function onBye(p: { id: string; name: string }) {
  gone.add(p.id);
  away.delete(p.id);
  if (isHost()) chatSystem(`${p.name} salió de la sala`);
  publishMembers(useJam.getState().members.filter((m) => m.id !== p.id && !m.away));
  checkHost();
}

/** No host for a while (it left or lost its connection for good): the longest-standing member takes over. */
function checkHost() {
  const { status, members } = useJam.getState();
  if (isHost() || status !== 'joined') return;
  // A host in its grace period may still be coming back; one still sending its clock is surely here.
  if (members.some((m) => m.host) || Date.now() - heardHostAt < 6000) return;
  const present = members.filter((m) => !m.away);
  if (present[0]?.id !== me().id) return;
  const from = last ? { ...last, clock: clock ? { ...clock, pos: hostNow(clock), at: Date.now() } : last.clock } : null;
  becomeHost(from);
  chatSystem(`${me().name} es ahora el anfitrión`);
}

/* ───────── chat & reactions ───────── */

function pushChat(m: ChatMessage) {
  useJam.setState((s) => ({ chat: [...s.chat, m].slice(-100), unread: s.unread + (m.from === me().id ? 0 : 1) }));
}

function pushReaction(r: Reaction) {
  useJam.setState((s) => ({ reactions: [...s.reactions, r].slice(-24) }));
  setTimeout(() => useJam.setState((s) => ({ reactions: s.reactions.filter((x) => x.id !== r.id) })), 2600);
}

export function sendChat(text: string) {
  const t = text.trim().slice(0, 240);
  if (!t) return;
  const p = me();
  const m: ChatMessage = {
    id: `${p.id}${Date.now()}`,
    from: p.id,
    name: p.name,
    color: p.color,
    text: t,
    at: Date.now(),
  };
  pushChat(m);
  send('chat', m);
}

export function sendReaction(emoji: string) {
  const p = me();
  const r: Reaction = { id: `${p.id}${Date.now()}${Math.random()}`, emoji, color: p.color, name: p.name };
  pushReaction(r);
  send('react', r);
}

/* ───────── room lifecycle ───────── */

function clearTimers() {
  timers.forEach(clearInterval);
  timers = [];
}

function sendCommand(c: Command) {
  if (isHost()) handleCommand(me().id, c);
  else send('cmd', { from: me().id, cmd: c });
}

/** Room actions for the room screen. */
export const Jam = {
  command: sendCommand,
  vote: (id: string) => sendCommand({ type: 'vote', id }),
  voteSkip: () => sendCommand({ type: 'skip' }),
  add(t: Track, next = false) {
    if (t.source !== 'youtube') return toast('En la sala solo se comparten canciones de YouTube');
    useLibrary.getState().addRemote([t]);
    sendCommand({ type: 'add', track: roomTrack(t), next });
  },
  /** Shares the song you were playing before the room. */
  sharePrevious() {
    const id = useJam.getState().previous;
    const t = id ? trackById(useLibrary.getState(), id) : undefined;
    useJam.setState({ previous: null });
    if (t) Jam.add(t);
  },
  setMode(m: RoomMode) {
    if (!isHost()) return;
    mode = m;
    chatSystem(m === 'all' ? 'Ahora todos pueden controlar la música' : 'Ahora solo el anfitrión controla la música');
    sendState();
  },
  setRadio(on: boolean) {
    if (!isHost()) return;
    radioOn = on;
    radioFor = null;
    sendState();
    if (on) void topUpRadio();
  },
  setFair(on: boolean) {
    if (!isHost()) return;
    fairOn = on;
    reorder();
    sendState();
  },
  /** Hands the room to another member. */
  handOver(to: string) {
    if (!isHost()) return;
    const st = hostState();
    send('handover', { to, state: st });
    const name = useJam.getState().members.find((m) => m.id === to)?.name ?? 'otro miembro';
    chatSystem(`${name} es ahora el anfitrión`);
    last = st;
    clock = st.clock;
    stepDown();
  },
};

function onAppState(next: string) {
  if (next !== 'active' || !channel) return;
  // Back to the app: re-sync at once instead of waiting for the next clock.
  if (isHost()) {
    sendState();
  } else {
    pingBurst();
    hello();
  }
}

async function connect(code: string, host: boolean) {
  await leaveRoom(false);
  leaving = false;
  useJam.setState({
    status: 'connecting',
    error: null,
    code,
    isHost: false,
    room: null,
    members: [],
    chat: [],
    unread: 0,
    drift: null,
    welcome: null,
    reconnecting: false,
    previous: null,
  });
  last = null;
  clock = null;
  samples = [];
  gaps = [];
  offset = 0;
  lead = 0.35;
  away.clear();
  gone.clear();
  joinedAt = Date.now();
  // Everyone plays at normal speed, or the room drifts apart.
  const ps = usePlayer.getState();
  if (ps.rate !== 1 || ps.nightcore || ps.slowed) direct(() => Player.setRate(1));
  AudioRouteModule.keepAlive('room', true);
  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', onAppState);

  const ch = getClient().channel(`quartz-jam:${code}`, {
    config: { broadcast: { self: false }, presence: { key: me().id } },
  });
  channel = ch;
  ch.on('broadcast', { event: 'state' }, ({ payload }) => applyState(payload as RoomState))
    .on('broadcast', { event: 'clock' }, ({ payload }) => applyClock(payload as Clock))
    .on('broadcast', { event: 'hello' }, () => isHost() && sendState())
    .on('broadcast', { event: 'cmd' }, ({ payload }) => {
      const p = payload as { from: string; cmd: Command };
      if (isHost()) handleCommand(p.from, p.cmd);
    })
    .on('broadcast', { event: 'ping' }, ({ payload }) => {
      const p = payload as { from: string; t0: number };
      if (isHost()) send('pong', { to: p.from, t0: p.t0, th: Date.now() });
    })
    .on('broadcast', { event: 'pong' }, ({ payload }) => onPong(payload as { to: string; t0: number; th: number }))
    .on('broadcast', { event: 'chat' }, ({ payload }) => pushChat(payload as ChatMessage))
    .on('broadcast', { event: 'react' }, ({ payload }) => pushReaction(payload as Reaction))
    .on('broadcast', { event: 'bye' }, ({ payload }) => onBye(payload as { id: string; name: string }))
    .on('broadcast', { event: 'handover' }, ({ payload }) => {
      const p = payload as { to: string; state: RoomState };
      if (p.to !== me().id) return;
      last = p.state;
      becomeHost({ ...p.state, clock: { ...p.state.clock, pos: hostNow(p.state.clock), at: Date.now() } });
    })
    .on('presence', { event: 'sync' }, onPresence);

  let subscribed = false;
  await new Promise<void>((resolve, reject) => {
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        if (!subscribed) {
          subscribed = true;
          resolve();
          return;
        }
        // Rejoined after a dropped connection: announce ourselves again and catch up.
        useJam.setState({ reconnecting: false });
        void ch.track(member(isHost()));
        if (isHost()) sendState();
        else {
          pingBurst();
          hello();
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (!subscribed) reject(err ?? new Error(status));
        // The client retries on its own; the room stays put meanwhile.
        else if (!leaving) useJam.setState({ reconnecting: true });
      }
    });
  });

  if (host) {
    useJam.setState({ status: 'joined' });
    becomeHost(null);
    return;
  }
  const s = usePlayer.getState();
  before = { queue: s.queue, index: s.index, pos: playerTime() };
  void ch.track(member(false));
  setController(guestController);
  startGuestTimers();
  hello();
  joinTimer = setTimeout(() => {
    if (last) return;
    useJam.setState({ status: 'error', error: 'No hay nadie en esa sala. Revisa el código.' });
    void leaveRoom(false);
  }, JOIN_TIMEOUT_MS);
}

export async function createRoom() {
  if (!jamAvailable) return;
  try {
    await connect(newCode(), true);
  } catch {
    useJam.setState({ status: 'error', error: 'No se pudo crear la sala. Revisa tu conexión.' });
    void leaveRoom(false);
  }
}

export async function joinRoom(raw: string) {
  const code = normalizeCode(raw);
  if (!jamAvailable || code.length !== 6) return;
  try {
    await connect(code, false);
  } catch {
    useJam.setState({ status: 'error', error: 'No se pudo entrar. Revisa tu conexión.' });
    void leaveRoom(false);
  }
}

export async function leaveRoom(restore = true) {
  leaving = true;
  clearTimers();
  clearTimeout(joinTimer);
  clearTimeout(stateTimer);
  unsubPlayer?.();
  unsubPlayer = null;
  setController(null);
  setSyncRate(1);
  appStateSub?.remove();
  appStateSub = null;
  AudioRouteModule.keepAlive('room', false);
  const ch = channel;
  channel = null;
  if (ch) {
    // Say goodbye, so nobody waits for us to come back.
    void ch.send({ type: 'broadcast', event: 'bye', payload: { id: me().id, name: me().name } });
    await ch.untrack().catch(() => {});
    await getClient()
      .removeChannel(ch)
      .catch(() => {});
  }
  // You get back what you were listening to before the room, paused.
  if (restore && before) {
    const b = before;
    direct(() => Player.syncTo(b.queue, b.index, b.pos, false));
  }
  before = null;
  last = null;
  clock = null;
  if (restore || useJam.getState().status !== 'error') {
    useJam.setState({
      status: 'idle',
      code: null,
      isHost: false,
      room: null,
      members: [],
      drift: null,
      reconnecting: false,
      previous: null,
    });
  }
}
