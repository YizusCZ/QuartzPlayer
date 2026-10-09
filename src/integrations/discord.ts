/**
 * Discord Rich Presence: "Escuchando <canción> · <artista>" with cover art and a
 * progress bar, set through the Discord app installed on the phone (Discord
 * Social SDK over RPC, no login inside Quartz).
 *
 * Presence follows the player but only pushes real changes (track, play/pause,
 * speed, seeks), debounced: Discord rate-limits presence updates.
 */
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { DiscordPresenceModule, type DiscordPresence } from '../../modules/discord-presence';
import { NIGHTCORE_RATE, SLOWED_RATE } from '@/audio/engine';
import { FX, FX_EMOJI } from '@/audio/fx';
import type { Track } from '@/library/types';
import { useLibrary } from '@/store/library';
import { effectiveRate, usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';

/** Discord Developer Portal application id, from `.env` (see `.env.example`). */
const APPLICATION_ID = process.env.EXPO_PUBLIC_DISCORD_APP_ID ?? '';
const ACTIVITY_NAME = 'Quartz';
/** Asset key uploaded in the Developer Portal (Rich Presence → Art Assets). */
const FALLBACK_IMAGE = 'quartz';
const twemoji = (code: string) => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${code}.png`;
const DEBOUNCE_MS = 800;
/** Presence never waits longer than this for the cover. */
const COVER_TIMEOUT_MS = 4000;
/** A position jump beyond this (s) counts as a seek and refreshes the progress bar. */
const SEEK_SLACK = 3;

export type DiscordStatus = 'off' | 'unavailable' | 'no-discord' | 'connecting' | 'ok' | 'error';

export const useDiscordStatus = create<{ status: DiscordStatus; message?: string }>()(() => ({ status: 'off' }));

const setStatus = (status: DiscordStatus, message?: string) => useDiscordStatus.setState({ status, message });

/* ───────── cover art ─────────
 * Discord needs an image URL; local files can't be shown. Covers are looked up
 * once per album on the iTunes Search API (artist + album only) and cached. */
const covers = new Map<string, Promise<string | null>>();

function coverUrl(t: Track): Promise<string | null> {
  const term = [t.artist, t.album].filter(Boolean).join(' ').trim();
  if (!term) return Promise.resolve(null);
  const key = term.toLowerCase();
  let hit = covers.get(key);
  if (!hit) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), COVER_TIMEOUT_MS);
    hit = fetch(`https://itunes.apple.com/search?entity=album&limit=1&term=${encodeURIComponent(term)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { results?: { artworkUrl100?: string }[] } | null) => {
        const url = j?.results?.[0]?.artworkUrl100;
        return url ? url.replace(/\d+x\d+bb/, '512x512bb') : null;
      })
      .catch(() => {
        covers.delete(key); // retry next time
        return null;
      })
      .finally(() => clearTimeout(timeout));
    covers.set(key, hit);
  }
  return hit;
}

/* ───────── presence ───────── */

type Snapshot = { id: string; playing: boolean; rate: number; fx: string; startMs: number };

/**
 * Badge over the cover for the sound effects in use: the pitch mode's icon
 * (or the first effect's), and every active effect in the tooltip.
 */
function effectBadge(s: ReturnType<typeof usePlayer.getState>): { smallImage: string; smallText: string } | null {
  const pitch = s.nightcore ? 'nightcore' : s.slowed ? 'slowed' : null;
  const names = [
    ...(s.nightcore ? [`Nightcore ${NIGHTCORE_RATE}×`] : s.slowed ? [`Slowed ${SLOWED_RATE}×`] : []),
    ...s.fx.map((id) => FX.find((f) => f.id === id)?.name ?? id),
  ];
  const icon = pitch ?? s.fx[0];
  return icon ? { smallImage: twemoji(FX_EMOJI[icon]), smallText: names.join(' + ') } : null;
}
const fxKey = (s: ReturnType<typeof usePlayer.getState>) => [s.nightcore, s.slowed, ...s.fx].join('|');

let last: Snapshot | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function currentTrack(): Track | undefined {
  const s = usePlayer.getState();
  const id = s.queue[s.index];
  return id ? useLibrary.getState().tracks[id] : undefined;
}

const background = () => AppState.currentState === 'background';

/**
 * Playback position (s). In the background the engine stops refreshing
 * `position`, but `resumeAt` stays exact across pauses and track changes.
 */
function positionNow() {
  const s = usePlayer.getState();
  return background() ? s.resumeAt : s.position;
}

/** Wall-clock time at which the song would have started, at the current rate. */
function songStartMs(position: number, rate: number) {
  return Date.now() - (position * 1000) / rate;
}

function changed(): boolean {
  const s = usePlayer.getState();
  const t = currentTrack();
  const rate = effectiveRate(s);
  if (!t || !s.playing) return last?.playing !== false || last.id !== (t?.id ?? '');
  if (!last || last.id !== t.id || !last.playing || last.rate !== rate || last.fx !== fxKey(s)) return true;
  // Seek detection needs a live position, which only exists in the foreground.
  if (background()) return false;
  return Math.abs(songStartMs(s.position, rate) - last.startMs) > SEEK_SLACK * 1000;
}

async function push() {
  const run = ++generation;
  const s = usePlayer.getState();
  const t = currentTrack();
  const rate = effectiveRate(s);

  if (!t || !s.playing) {
    last = { id: t?.id ?? '', playing: false, rate, fx: fxKey(s), startMs: 0 };
    DiscordPresenceModule.clear();
    return;
  }

  const startMs = songStartMs(positionNow(), rate);
  last = { id: t.id, playing: true, rate, fx: fxKey(s), startMs };
  const duration = t.duration || s.duration;
  const image = (await coverUrl(t)) ?? FALLBACK_IMAGE;
  if (run !== generation) return; // superseded while fetching the cover

  const presence: DiscordPresence = {
    name: ACTIVITY_NAME,
    details: t.title,
    state: t.artist || 'Artista desconocido',
    largeImage: image,
    largeText: t.album || t.title,
    ...(effectBadge(s) ?? {}),
    startMs: Math.round(startMs),
    endMs: duration > 0 ? Math.round(startMs + (duration * 1000) / rate) : undefined,
  };
  DiscordPresenceModule.update(presence);
}

function schedule() {
  // The player store updates 4×/s while playing: a pending push must not be
  // re-armed, or it would be postponed forever. push() reads the latest state.
  if (timer || !changed()) return;
  timer = setTimeout(() => {
    timer = undefined;
    void push();
  }, DEBOUNCE_MS);
}

/* ───────── lifecycle ───────── */

let running = false;
let unsubPlayer: (() => void) | undefined;
let resultSub: { remove(): void } | null = null;

function enable() {
  if (running) return;
  if (Platform.OS !== 'android' || !DiscordPresenceModule.available || !APPLICATION_ID) return setStatus('unavailable');
  if (!DiscordPresenceModule.isDiscordInstalled()) return setStatus('no-discord');
  running = true;
  setStatus('connecting');
  resultSub = DiscordPresenceModule.addListener(({ ok, message }) =>
    ok ? setStatus('ok') : setStatus('error', message),
  );
  DiscordPresenceModule.start(APPLICATION_ID);
  last = null;
  unsubPlayer = usePlayer.subscribe(schedule);
  schedule();
}

function disable() {
  if (!running) return;
  running = false;
  clearTimeout(timer);
  timer = undefined;
  generation++;
  unsubPlayer?.();
  resultSub?.remove();
  resultSub = null;
  DiscordPresenceModule.stop();
  last = null;
  setStatus('off');
}

let started = false;

export function startDiscordPresence() {
  if (started) return;
  started = true;
  const apply = (on: boolean) => (on ? enable() : disable());
  apply(useSettings.getState().discordPresence);
  useSettings.subscribe((s, prev) => {
    if (s.discordPresence !== prev.discordPresence) apply(s.discordPresence);
  });
}
