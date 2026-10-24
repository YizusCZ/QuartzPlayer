/**
 * Playback engine: one long-lived expo-audio player driven by the queue in
 * `usePlayer`. Native decoding (ExoPlayer / AVPlayer) handles FLAC, ALAC and
 * PCM at the file's native resolution; we never transcode.
 */
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  createAudioPlayer,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { makeMutable } from 'react-native-reanimated';
import { AudioRouteModule } from '../../modules/audio-route';
import { YouTubeModule } from '../../modules/youtube';
import { trackById, useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { isOffline } from '@/lib/net';
import { hiRes } from '@/youtube/music';
import { effectiveRate, NIGHTCORE_RATE, SLOWED_RATE, usePlayer, type RepeatMode } from '@/store/player';
import type { Track } from '@/library/types';

/** Mirrors playback for UI-thread animations (cassette reels, visualizers). */
/** `at` is the Date.now() when `position` was sampled, so the UI thread can extrapolate exactly. */
export const transport = makeMutable({ playing: false, position: 0, duration: 0, rate: 1, at: 0 });
/** Tape-motion impulses: positive = fast-forward whirr, negative = rewind. */
export const spinKick = makeMutable(0);

let player: AudioPlayer | null = null;
let loadedId: string | null = null;
/** Where to start once the stream is loaded; a function is read at that moment (rooms: "where the host is now"). */
type StartAt = number | (() => number);
let pendingSeek: StartAt | null = null;
const startSec = (a: StartAt) => (typeof a === 'function' ? a() : a);
let notifAsked = false;

/** Hook for modules that must re-attach to the player after a source change (EQ). */
let onLoaded: (() => void) | undefined;
export function setOnLoaded(fn: () => void) {
  onLoaded = fn;
}

export function getPlayer(): AudioPlayer | null {
  return player;
}

const state = () => usePlayer.getState();
const set = usePlayer.setState;
const trackOf = (id: string | undefined): Track | undefined => trackById(useLibrary.getState(), id);

function waitHydrated(): Promise<void> {
  return new Promise((resolve) => {
    if (usePlayer.persist.hasHydrated() && useLibrary.persist.hasHydrated()) return resolve();
    const check = () => usePlayer.persist.hasHydrated() && useLibrary.persist.hasHydrated() && resolve();
    usePlayer.persist.onFinishHydration(check);
    useLibrary.persist.onFinishHydration(check);
  });
}

export async function initEngine() {
  if (player) return;
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
  // Fast Refresh re-runs this module with `player` reset to null; release the
  // previous native player or it keeps playing and feeding stale status.
  const g = globalThis as { __quartzPlayer?: AudioPlayer };
  g.__quartzPlayer?.remove();
  player = createAudioPlayer(null, { updateInterval: 250 });
  g.__quartzPlayer = player;
  player.addListener('playbackStatusUpdate', onStatus);
  // Emitted by our expo-audio patch; not in its published event map.
  (player.addListener as (event: string, listener: typeof onRemoteCommand) => void)('remoteCommand', onRemoteCommand);
  lockScreenOn = false;

  await waitHydrated();
  // Streamed songs saved before covers were fetched sharp: upgrade them once.
  const lib = useLibrary.getState();
  const blurry = Object.values(lib.remote).filter((t) => t.artwork && hiRes(t.artwork) !== t.artwork);
  if (blurry.length) lib.addRemote(blurry.map((t) => ({ ...t, artwork: hiRes(t.artwork) })));
  const s = state();
  set({ playing: false, buffering: false, sleepAt: null, sleepEndOfTrack: false, abA: null, abB: null });
  const id = s.queue[s.index];
  if (trackOf(id)) load(id, false, s.resumeAt);
  else set({ queue: [], baseQueue: [], index: 0, position: 0, resumeAt: 0 });
}

/**
 * Applies speed and pitch. Android's native setPlaybackRate takes a single
 * argument (iOS also accepts a pitch-correction quality). Nightcore and Slowed
 * turn pitch correction off so pitch follows the speed, like a record.
 */
function applyRate() {
  if (!player) return;
  const s = state();
  const effective = effectiveRate(s) * syncRate;
  try {
    player.shouldCorrectPitch = !(s.nightcore || s.slowed);
    if (Platform.OS === 'android') (player.setPlaybackRate as (r: number) => void)(effective);
    else player.setPlaybackRate(effective, 'high');
  } catch {
    // player not ready yet; applied again on load
  }
  // Re-anchor at the current extrapolated position so the new rate applies
  // from now on instead of retroactively (which made lyrics jump).
  const t = transport.value;
  const now = Date.now();
  const position = t.playing ? t.position + Math.min(1, (now - t.at) / 1000) * t.rate : t.position;
  transport.value = { ...t, position, at: now, rate: effective };
}

export { NIGHTCORE_RATE, SLOWED_RATE };

/* ───────── sleep timer ─────────
 * JS timers can stall while the screen is off, so Android also schedules the
 * pause natively (a media-key PAUSE sent to our own session). */
let sleepTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSleep(at: number | null) {
  clearTimeout(sleepTimer);
  AudioRouteModule.cancelSleep();
  if (!at) return;
  const ms = Math.max(0, at - Date.now());
  AudioRouteModule.scheduleSleep(ms);
  sleepTimer = setTimeout(() => {
    player?.pause();
    set({ sleepAt: null });
  }, ms);
}

/**
 * Previous/next replace the ±10 s buttons in the notification. They come from
 * our expo-audio patch (patches/expo-audio+*.patch), which also routes headset,
 * lock screen and Android Auto track buttons back here as "remoteCommand".
 */
const LOCK_SCREEN_OPTIONS = {
  showSeekForward: false,
  showSeekBackward: false,
  showSkipPrevious: true,
  showSkipNext: true,
} as Parameters<AudioPlayer['setActiveForLockScreen']>[2];
let lockScreenOn = false;

function onRemoteCommand({ command }: { command: 'previous' | 'next' | 'favorite' }) {
  if (command === 'next') Player.next();
  else if (command === 'previous') Player.prev();
  else if (loadedId) useLibrary.getState().toggleFavorite(loadedId);
}

/** `isFavorite` drives the heart button our expo-audio patch adds to the notification. */
/** Length last sent to the notification (its seek bar needs one). */
let metaDuration = 0;

/**
 * `isFavorite` drives the heart button our expo-audio patch adds to the
 * notification; `durationMs` its seek bar.
 */
function lockScreenMeta(t: Track, duration = t.duration): AudioMetadata {
  const isFavorite = !!useLibrary.getState().favorites[t.id];
  metaDuration = duration;
  return {
    title: t.title,
    artist: t.artist,
    albumTitle: t.album,
    artworkUrl: t.artwork,
    isFavorite,
    durationMs: duration > 0 ? Math.round(duration * 1000) : undefined,
  } as AudioMetadata;
}

// Keep the notification's heart in step when favourites change anywhere.
useLibrary.subscribe((s, prev) => {
  if (!player || !lockScreenOn || !loadedId || s.favorites === prev.favorites) return;
  if (!!s.favorites[loadedId] === !!prev.favorites[loadedId]) return;
  const t = trackOf(loadedId);
  if (!t) return;
  try {
    player.updateLockScreenMetadata(lockScreenMeta(t));
  } catch {
    // best-effort
  }
});

/* ───────── streamed songs (YouTube) ─────────
 * The audio URL is resolved when the song loads. YouTube's URLs expire after
 * about six hours, so a resolved one is reused for four. */
const STREAM_TTL = 4 * 3600_000;
const streams = new Map<string, { url: string; at: number }>();
/** Bumped on every load, so a late stream answer never replaces a newer song. */
let loadToken = 0;

/** Nominal bitrate (kbps) per YouTube audio format; the reported one is often missing. */
const ITAG_KBPS: Record<number, number> = { 774: 256, 251: 160, 141: 256, 140: 128, 250: 70, 249: 50 };

function streamFormat(codec: string | undefined, bitrate: number, itag?: number): Track['format'] {
  const opus = /opus/i.test(codec ?? '') || itag === 251 || itag === 250 || itag === 249 || itag === 774;
  const kbps = (itag && ITAG_KBPS[itag]) || (bitrate > 0 ? Math.round(bitrate / 1000) : undefined);
  return {
    codec: opus ? 'OPUS' : 'AAC',
    bitrate: kbps,
    sampleRate: opus ? 48000 : 44100,
    channels: 2,
  };
}

/**
 * Saves what the stream told us about a song, only when it changed: every
 * library write re-serialises thousands of tracks, which stalls the JS thread
 * right when the song is starting.
 */
function noteStream(id: string, info: { codec?: string; bitrate: number; itag?: number; duration?: number }) {
  const t = trackOf(id);
  if (!t) return;
  const format = streamFormat(info.codec, info.bitrate, info.itag);
  const f = t.format;
  const patch: Partial<Track> = {};
  if (f.codec !== format.codec || f.bitrate !== format.bitrate || f.sampleRate !== format.sampleRate)
    patch.format = format;
  if (!t.duration && info.duration) patch.duration = info.duration;
  if (Object.keys(patch).length) useLibrary.getState().patchTrack(id, patch);
}

// Our expo-audio patch adds `precacheStream` (QuartzCache.kt); absent, nothing is warmed.
const nativeAudio = requireOptionalNativeModule<{ precacheStream?(url: string): void }>('ExpoAudio');

/**
 * Gets the next song ready so it starts without a wait: its stream URL, and
 * its first seconds in the disk cache.
 */
export function prefetchStream(t: Track | undefined) {
  if (!t || t.source !== 'youtube') return;
  const id = t.uri.slice(3);
  const hit = streams.get(id);
  if (hit && Date.now() - hit.at < STREAM_TTL) return nativeAudio?.precacheStream?.(hit.url);
  YouTubeModule.resolve(id)
    .then((info) => {
      streams.set(id, { url: info.url, at: Date.now() });
      nativeAudio?.precacheStream?.(info.url);
      noteStream(t.id, info);
    })
    .catch(() => {});
}

function load(id: string, autoplay: boolean, startAt: StartAt = 0): boolean {
  const t = trackOf(id);
  if (!player || !t) return false;
  const token = ++loadToken;
  if (t.source !== 'youtube') return (start(t, t.uri, autoplay, startAt), true);

  const videoId = t.uri.slice(3);
  const hit = streams.get(videoId);
  if (hit && Date.now() - hit.at < STREAM_TTL) return (start(t, hit.url, autoplay, startAt), true);

  // Show the song right away; it starts as soon as its stream is resolved.
  player.pause();
  loadedId = id;
  const at0 = startSec(startAt);
  set((s) => ({
    duration: t.duration,
    position: at0,
    resumeAt: at0,
    playing: false,
    buffering: true,
    loadSeq: s.loadSeq + 1,
  }));
  transport.value = { playing: false, position: at0, duration: t.duration, rate: 1, at: Date.now() };
  YouTubeModule.resolve(videoId)
    .then((info) => {
      streams.set(videoId, { url: info.url, at: Date.now() });
      // Start first, write to the library after: the sound should not wait for it.
      if (token === loadToken) start(trackOf(id) ?? t, info.url, autoplay, startAt);
      noteStream(id, info);
    })
    .catch((e: Error) => {
      if (token !== loadToken) return;
      set({ buffering: false });
      if (isOffline(e)) {
        // No internet: one notice, no chain of failures through the queue.
        streamFailures = 0;
        notifyOnce('offline', 'Sin conexión: las canciones de YouTube necesitan internet');
        return;
      }
      streamFailures += 1;
      notifyOnce(`fail:${t.id}`, `“${t.title}” no está disponible`);
      // Skip on, but stop after a few in a row (something is broken, not just one song).
      if (autoplay && streamFailures < 3) setTimeout(() => token === loadToken && Player.next(), 800);
    });
  return true;
}

/** Consecutive streamed songs that failed; reset by any song that starts. */
let streamFailures = 0;
const lastNotice = new Map<string, number>();
/** A toast at most every 20 s per kind, so failures never pile up on screen. */
function notifyOnce(kind: string, message: string) {
  const now = Date.now();
  if (now - (lastNotice.get(kind) ?? 0) < 20_000) return;
  lastNotice.set(kind, now);
  useUI.getState().showToast(message);
}

function start(t: Track, uri: string, autoplay: boolean, startAt: StartAt) {
  if (!player) return;
  streamFailures = 0;
  const id = t.id;
  player.replace({ uri });
  loadedId = id;
  pendingSeek = typeof startAt === 'function' ? startAt : startAt > 1 ? startAt : null;
  const at0 = startSec(startAt);
  applyRate();
  const rate = effectiveRate(state()) * syncRate;
  if (autoplay) {
    player.play();
    useLibrary.getState().recordPlay(id);
  }
  // Warm up the next streamed song while this one plays.
  const s0 = state();
  prefetchStream(trackOf(s0.queue[s0.index + 1]));
  try {
    // Activating rebuilds the whole native media session, so it happens once;
    // later tracks only swap the metadata.
    if (lockScreenOn) player.updateLockScreenMetadata(lockScreenMeta(t));
    else {
      player.setActiveForLockScreen(true, lockScreenMeta(t), LOCK_SCREEN_OPTIONS);
      lockScreenOn = true;
    }
  } catch {
    // lock screen controls are best-effort
  }
  onLoaded?.();
  set((s) => ({
    duration: t.duration,
    position: at0,
    resumeAt: at0,
    playing: autoplay,
    abA: null,
    abB: null,
    loadSeq: s.loadSeq + 1,
  }));
  transport.value = { playing: autoplay, position: at0, duration: t.duration, rate, at: Date.now() };
}

function onStatus(st: AudioStatus) {
  if (!player) return;
  const s = state();
  if (pendingSeek != null && st.isLoaded) {
    // Read now, not when loading began: a room's target moved on meanwhile.
    const at = startSec(pendingSeek);
    if (at > 0.3) void player.seekTo(at);
    pendingSeek = null;
  }
  if (s.abA != null && s.abB != null && st.currentTime >= s.abB) void player.seekTo(s.abA);
  if (s.sleepAt && Date.now() >= s.sleepAt) {
    player.pause();
    scheduleSleep(null);
    set({ sleepAt: null });
  }

  const duration = st.duration > 0 ? st.duration : s.duration;
  // Persist the resume point sparingly (every ~5 s of play, and on pause).
  const resumeAt =
    Math.abs(st.currentTime - s.resumeAt) > 5 || (!st.playing && s.playing) ? st.currentTime : s.resumeAt;
  if (AppState.currentState === 'background') {
    // Nobody is looking: skip the 4×/s UI churn (store + UI-thread transport)
    // and only keep what outlives the screen. The next status after
    // returning to the app repaints everything.
    if (resumeAt !== s.resumeAt || st.playing !== s.playing) set({ playing: st.playing, resumeAt });
  } else {
    // Only the seek bar reads the position, and only in whole seconds: skip
    // status ticks that would change nothing on screen.
    if (
      st.playing !== s.playing ||
      st.isBuffering !== s.buffering ||
      Math.floor(st.currentTime) !== Math.floor(s.position) ||
      duration !== s.duration ||
      resumeAt !== s.resumeAt
    ) {
      set({ playing: st.playing, buffering: st.isBuffering, position: st.currentTime, duration, resumeAt });
    }
    // Trust the rate the player reports; fall back to the requested one.
    const rate = st.playbackRate > 0 ? st.playbackRate : effectiveRate(s);
    transport.value = { playing: st.playing, position: st.currentTime, duration, rate, at: Date.now() };
  }

  const id = s.queue[s.index];
  const t = trackOf(id);
  if (t && !t.duration && st.duration > 0) useLibrary.getState().patchTrack(t.id, { duration: st.duration });
  // The player now knows the real length: give it to the notification's seek bar.
  if (t && lockScreenOn && st.duration > 0 && Math.abs(st.duration - metaDuration) > 1) {
    try {
      player.updateLockScreenMetadata(lockScreenMeta(t, st.duration));
    } catch {
      // best-effort
    }
  }

  if (st.didJustFinish) onTrackEnd();
}

function onTrackEnd() {
  const s = state();
  if (!player) return;
  if (s.sleepEndOfTrack) {
    set({ sleepEndOfTrack: false });
    if (s.index < s.queue.length - 1) go(s.index + 1, false);
    return;
  }
  if (s.repeat === 'one') {
    void player.seekTo(0);
    player.play();
    useLibrary.getState().recordPlay(s.queue[s.index]);
  } else if (s.index < s.queue.length - 1) {
    go(s.index + 1, true);
  } else if (s.repeat === 'all' && s.queue.length) {
    go(0, true);
  } else {
    player.pause();
    void player.seekTo(0);
    set({ playing: false, position: 0, resumeAt: 0 });
  }
}

function go(index: number, autoplay: boolean) {
  const s = state();
  if (index < 0 || index >= s.queue.length) return;
  set({ index });
  if (!load(s.queue[index], autoplay)) {
    // File vanished: drop it and try the next one.
    removeAt(index);
  }
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function askNotifications() {
  if (notifAsked || Platform.OS !== 'android') return;
  notifAsked = true;
  try {
    await requestNotificationPermissionsAsync();
  } catch {
    // older Android: not needed
  }
}

/* ───────── shared rooms ───────── */

/**
 * A room nudges the speed a few percent (pitch kept) to close small gaps
 * with the host, instead of seeking: a seek on a stream rebuffers, a speed
 * change is seamless.
 */
let syncRate = 1;
export function setSyncRate(r: number) {
  if (Math.abs(r - syncRate) < 0.001) return;
  syncRate = r;
  applyRate();
}

/**
 * While you are in a room (src/jam) its session sees every command first: a
 * guest's taps go to the host, and nothing that would split the room (your
 * own files, speed changes) gets through. Returns true when it handled it.
 */
type Controller = (command: string, args: unknown[]) => boolean;
let controller: Controller | null = null;

export function setController(fn: Controller | null) {
  controller = fn;
}

/** Runs player commands without the room seeing them (the room applying its own state). */
export function direct<T>(fn: () => T): T {
  const c = controller;
  controller = null;
  try {
    return fn();
  } finally {
    controller = c;
  }
}

const intercept = (command: string, ...args: unknown[]) => !!controller && controller(command, args);

/** Where the player really is, straight from the native side (s). */
export function playerTime(): number {
  return player?.currentTime ?? state().position;
}

/** True once the current song is loaded and not waiting on the network. */
export function playerSettled(id: string | undefined): boolean {
  return !!player && !!id && loadedId === id && player.isLoaded && !player.isBuffering;
}

/* ───────── public API ───────── */

export const Player = {
  playTracks(ids: string[], start = 0, opts: { shuffle?: boolean } = {}) {
    if (intercept('playTracks', ids, start, opts)) return;
    if (!ids.length) return;
    void askNotifications();
    const shuffle = opts.shuffle ?? state().shuffle;
    const first = ids[Math.min(start, ids.length - 1)];
    const queue = shuffle ? [first, ...shuffled(ids.filter((_, i) => i !== start))] : ids;
    set({ queue, baseQueue: ids, shuffle, index: shuffle ? 0 : start });
    load(queue[shuffle ? 0 : start], true);
  },

  toggle() {
    if (intercept('toggle')) return;
    if (!player) return;
    const s = state();
    const id = s.queue[s.index];
    if (!id) return;
    if (loadedId !== id) {
      load(id, true, s.position);
      return;
    }
    if (player.playing) player.pause();
    else {
      if (s.duration > 0 && s.position >= s.duration - 0.3) void player.seekTo(0);
      player.play();
    }
  },

  pause() {
    player?.pause();
  },

  next() {
    if (intercept('next')) return;
    const s = state();
    spinKick.value += 1;
    if (s.index < s.queue.length - 1) go(s.index + 1, true);
    else if (s.repeat === 'all' && s.queue.length) go(0, true);
  },

  prev() {
    if (intercept('prev')) return;
    const s = state();
    spinKick.value -= 1;
    if (s.position > 3 || s.index === 0) Player.seek(0);
    else go(s.index - 1, true);
  },

  seek(sec: number) {
    if (intercept('seek', sec)) return;
    if (!player) return;
    const s = state();
    const to = Math.max(0, Math.min(sec, s.duration || sec));
    spinKick.value += Math.sign(to - s.position) * Math.min(1, Math.abs(to - s.position) / 60);
    void player.seekTo(to);
    set({ position: to, resumeAt: to });
    transport.value = { ...transport.value, position: to, at: Date.now() };
  },

  seekBy(delta: number) {
    Player.seek(state().position + delta);
  },

  jumpTo(index: number) {
    if (intercept('jumpTo', index)) return;
    go(index, true);
  },

  toggleShuffle() {
    if (intercept('toggleShuffle')) return;
    const s = state();
    const current = s.queue[s.index];
    if (s.shuffle) {
      const index = Math.max(0, s.baseQueue.indexOf(current));
      set({ shuffle: false, queue: s.baseQueue, index });
    } else {
      const rest = shuffled(s.queue.filter((_, i) => i !== s.index));
      set({ shuffle: true, queue: current ? [current, ...rest] : rest, index: 0 });
    }
  },

  setRepeat(repeat: RepeatMode) {
    if (intercept('setRepeat', repeat)) return;
    set({ repeat });
  },

  cycleRepeat() {
    if (intercept('cycleRepeat')) return;
    const order: RepeatMode[] = ['off', 'all', 'one'];
    set((s) => ({ repeat: order[(order.indexOf(s.repeat) + 1) % order.length] }));
  },

  setRate(rate: number) {
    if (intercept('setRate', rate)) return;
    set({ rate, nightcore: false, slowed: false });
    applyRate();
  },

  /** Nightcore and Slowed are opposite ends of the same knob: turning one on turns the other off. */
  setNightcore(on: boolean) {
    if (intercept('setNightcore', on)) return;
    set(on ? { nightcore: true, slowed: false } : { nightcore: false });
    applyRate();
  },

  setSlowed(on: boolean) {
    if (intercept('setSlowed', on)) return;
    set(on ? { slowed: true, nightcore: false } : { slowed: false });
    applyRate();
  },

  setSleepTimer(minutes: number | null) {
    const sleepAt = minutes ? Date.now() + minutes * 60_000 : null;
    set({ sleepAt, sleepEndOfTrack: false });
    scheduleSleep(sleepAt);
  },

  setSleepEndOfTrack(on: boolean) {
    set({ sleepEndOfTrack: on, sleepAt: null });
    scheduleSleep(null);
  },

  /** Moves a queue entry (drag to reorder); the playing track keeps playing. */
  move(from: number, to: number) {
    if (intercept('move', from, to)) return;
    const s = state();
    if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return;
    const queue = [...s.queue];
    const [item] = queue.splice(from, 1);
    queue.splice(to, 0, item);
    let index = s.index;
    if (from === s.index) index = to;
    else if (from < s.index && to >= s.index) index -= 1;
    else if (from > s.index && to <= s.index) index += 1;
    // Keep the un-shuffled order in step when shuffle is off.
    set(s.shuffle ? { queue, index } : { queue, baseQueue: queue, index });
  },

  /** Cycles A → B → off. */
  markAB() {
    const s = state();
    if (s.abA == null) set({ abA: s.position });
    else if (s.abB == null && s.position > s.abA + 0.5) set({ abB: s.position });
    else set({ abA: null, abB: null });
  },

  playNext(id: string) {
    if (intercept('playNext', id)) return;
    const s = state();
    if (!s.queue.length) return Player.playTracks([id]);
    const current = s.queue[s.index];
    const queue = [...s.queue];
    queue.splice(s.index + 1, 0, id);
    const baseQueue = [...s.baseQueue];
    baseQueue.splice(baseQueue.indexOf(current) + 1, 0, id);
    set({ queue, baseQueue });
  },

  enqueue(ids: string[]) {
    if (intercept('enqueue', ids)) return;
    const s = state();
    if (!s.queue.length) return Player.playTracks(ids);
    set({ queue: [...s.queue, ...ids], baseQueue: [...s.baseQueue, ...ids] });
  },

  removeAt,

  /**
   * Puts the player on a room's queue: same songs, same one playing. Only
   * reloads when the song changed; the room's drift check does the rest.
   */
  syncTo(ids: string[], index: number, startAt: StartAt, playing: boolean) {
    const s = state();
    const same = s.queue.length === ids.length && s.queue.every((x, i) => x === ids[i]);
    if (!same || s.index !== index) set({ queue: ids, baseQueue: ids, index, shuffle: false, repeat: 'off' });
    const id = ids[index];
    if (!player) return;
    if (!id) {
      player.pause();
      loadedId = null;
      set({ playing: false, position: 0, resumeAt: 0, duration: 0 });
      return;
    }
    if (loadedId !== id) {
      load(id, playing, startAt);
      return;
    }
    if (playing && !player.playing) player.play();
    else if (!playing && player.playing) player.pause();
  },

  /** Replaces what comes after the current song (a room re-ordering by votes). */
  setUpcoming(ids: string[]) {
    const s = state();
    const queue = [...s.queue.slice(0, s.index + 1), ...ids];
    set({ queue, baseQueue: queue });
  },
};

function removeAt(i: number) {
  if (intercept('removeAt', i)) return;
  const s = state();
  const id = s.queue[i];
  if (id === undefined) return;
  const queue = s.queue.filter((_, k) => k !== i);
  const bi = s.baseQueue.indexOf(id);
  const baseQueue = s.baseQueue.filter((_, k) => k !== bi);
  if (!queue.length) {
    player?.pause();
    player?.clearLockScreenControls();
    loadedId = null;
    set({ queue, baseQueue, index: 0, playing: false, position: 0, resumeAt: 0, duration: 0 });
    return;
  }
  if (i < s.index) set({ queue, baseQueue, index: s.index - 1 });
  else if (i > s.index) set({ queue, baseQueue });
  else {
    const index = Math.min(i, queue.length - 1);
    set({ queue, baseQueue, index });
    load(queue[index], s.playing);
  }
}
