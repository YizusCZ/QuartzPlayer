/**
 * Discord Rich Presence: "Escuchando <canción> · <artista>" with cover art and a
 * progress bar, set through the Discord app installed on the phone (Discord
 * Social SDK over RPC, no login inside Quartz).
 *
 * Presence follows the player but only pushes real changes (track, play/pause,
 * speed, seeks), debounced: Discord rate-limits presence updates.
 *
 * Android freezes JS timers in the background, which held every update back
 * until you came back to Quartz: while music plays (and until a pause is
 * published) the shared keep-alive task keeps them running.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import { AudioRouteModule } from '../../modules/audio-route';
import { DiscordPresenceModule, type DiscordPresence } from '../../modules/discord-presence';
import { NIGHTCORE_RATE, playerTime, SLOWED_RATE } from '@/audio/engine';
import { FX, FX_EMOJI } from '@/audio/fx';
import { useJam } from '@/jam/store';
import type { Track } from '@/library/types';
import { trackById, useLibrary } from '@/store/library';
import { effectiveRate, usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';

/** Discord Developer Portal application id, from `.env` (see `.env.example`). */
const APPLICATION_ID = process.env.EXPO_PUBLIC_DISCORD_APP_ID ?? '';
const ACTIVITY_NAME = 'Quartz';
/** Asset key uploaded in the Developer Portal (Rich Presence → Art Assets). */
const FALLBACK_IMAGE = 'quartz';
const twemoji = (code: string) => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${code}.png`;
const DEBOUNCE_MS = 400;
/** Presence never waits longer than this for the cover. */
const COVER_TIMEOUT_MS = 4000;
/** A position jump beyond this (s) counts as a seek and refreshes the progress bar. */
const SEEK_SLACK = 3;
/**
 * Invite page behind the "join" button: opens the room in Quartz, or offers
 * the download when Quartz isn't installed (docs/jam/index.html in the repo).
 */
const JAM_LINK = process.env.EXPO_PUBLIC_JAM_LINK || 'https://yizuscz.github.io/QuartzPlayer/jam/';

export type DiscordStatus = 'off' | 'unavailable' | 'no-discord' | 'connecting' | 'ok' | 'error';

export const useDiscordStatus = create<{ status: DiscordStatus; message?: string }>()(() => ({ status: 'off' }));

const setStatus = (status: DiscordStatus, message?: string) => useDiscordStatus.setState({ status, message });

/* ───────── cover art ─────────
 * Discord needs an image URL; local files can't be shown. Covers are looked up
 * once per album on the iTunes Search API (artist + album only) and cached. */
const covers = new Map<string, Promise<string | null>>();
/** Covers already looked up (null: none found), for an instant first publish. */
const resolvedCovers = new Map<string, string | null>();
const coverKey = (t: Track) =>
  `${t.id}|${t.customArtwork ? t.originalArtwork : t.artwork}|${t.albumArtist ?? t.artist}|${t.album}`;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[([].*?[)\]]\s*/g, ' ') // "(Deluxe)", "[Remastered]"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const same = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};

/**
 * The cover Discord shows. Streamed songs already have a web image: the same
 * one as in the player. Local files carry theirs inside the file, which Discord
 * cannot receive, so the album is looked up on iTunes — only an exact album and
 * artist match is used, never a guess that would show a different cover.
 */
function coverUrl(t: Track): Promise<string | null> {
  const key = coverKey(t);
  return lookupCover(t).then((url) => {
    resolvedCovers.set(key, url);
    return url;
  });
}

function lookupCover(t: Track): Promise<string | null> {
  // Your own covers stay on the phone: Discord gets the original one.
  const own = t.customArtwork ? t.originalArtwork : t.artwork;
  if (own && /^https:\/\//.test(own)) return Promise.resolve(own);
  const term = [t.albumArtist ?? t.artist, t.album].filter(Boolean).join(' ').trim();
  if (!term) return Promise.resolve(null);
  const key = term.toLowerCase();
  let hit = covers.get(key);
  if (!hit) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), COVER_TIMEOUT_MS);
    hit = fetch(`https://itunes.apple.com/search?entity=album&limit=10&term=${encodeURIComponent(term)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { results?: { artworkUrl100?: string; collectionName?: string; artistName?: string }[] } | null) => {
        const artist = t.albumArtist ?? t.artist;
        const match = j?.results?.find(
          (r) => same(r.collectionName ?? '', t.album) && same(r.artistName ?? '', artist),
        );
        const url = match?.artworkUrl100;
        return url ? url.replace(/\d+x\d+bb/, '600x600bb') : null;
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

type Snapshot = { id: string; playing: boolean; rate: number; fx: string; startMs: number; room: string };

/** The open room you're in, if you share it on Discord (its code and how many are in it). */
function openRoom(): { code: string; people: number } | null {
  const j = useJam.getState();
  if (!useSettings.getState().discordRoomInvite || j.status !== 'joined' || !j.code) return null;
  return { code: j.code, people: j.members.filter((m) => !m.away).length };
}
const roomKey = () => {
  const r = openRoom();
  return r ? `${r.code}|${r.people}` : '';
};

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
  return trackById(useLibrary.getState(), id);
}

/** Holds the background keep-alive while there is something to publish. */
const hold = (on: boolean) => AudioRouteModule.keepAlive('discord', on);

/** Wall-clock time at which the song would have started, at the current rate. */
function songStartMs(position: number, rate: number) {
  return Date.now() - (position * 1000) / rate;
}

function changed(): boolean {
  const s = usePlayer.getState();
  const t = currentTrack();
  const rate = effectiveRate(s);
  // A streamed song is still loading: keep the current status instead of
  // clearing it for a second (that made Discord flicker on every change).
  if (t && !s.playing && s.buffering) return false;
  if (!t || !s.playing) return last?.playing !== false || last.id !== (t?.id ?? '');
  if (
    !last ||
    last.id !== t.id ||
    !last.playing ||
    last.rate !== rate ||
    last.fx !== fxKey(s) ||
    last.room !== roomKey()
  )
    return true;
  // The store's position stops refreshing in the background: ask the player.
  return Math.abs(songStartMs(playerTime(), rate) - last.startMs) > SEEK_SLACK * 1000;
}

async function push() {
  const run = ++generation;
  const s = usePlayer.getState();
  const t = currentTrack();
  const rate = effectiveRate(s);

  if (!t || !s.playing) {
    last = { id: t?.id ?? '', playing: false, rate, fx: fxKey(s), startMs: 0, room: roomKey() };
    DiscordPresenceModule.clear();
    hold(false);
    return;
  }

  hold(true);
  const startMs = songStartMs(playerTime(), rate);
  last = { id: t.id, playing: true, rate, fx: fxKey(s), startMs, room: roomKey() };
  const duration = t.duration || s.duration;
  const room = openRoom();
  const presence = (image: string): DiscordPresence => ({
    name: ACTIVITY_NAME,
    details: t.title,
    state: t.artist || 'Artista desconocido',
    largeImage: image,
    largeText: room
      ? `En una sala de Quartz · ${room.people} ${room.people === 1 ? 'persona' : 'personas'}`
      : t.album || t.title,
    ...(effectBadge(s) ?? {}),
    startMs: Math.round(startMs),
    endMs: duration > 0 ? Math.round(startMs + (duration * 1000) / rate) : undefined,
    ...(room
      ? { buttonLabel: 'Unirse a escuchar juntos', buttonUrl: `${JAM_LINK}?code=${encodeURIComponent(room.code)}` }
      : null),
  });

  // Publish right away (with the cover if it is already known), then again
  // once the cover arrives: the status never waits on a lookup.
  const key = coverKey(t);
  const known = resolvedCovers.get(key);
  DiscordPresenceModule.update(presence(known ?? FALLBACK_IMAGE));
  if (known !== undefined) return;
  const image = await coverUrl(t);
  if (run !== generation || !image) return; // superseded, or nothing better than the logo
  DiscordPresenceModule.update(presence(image));
}

function schedule() {
  // The player store updates 4×/s while playing: a pending push must not be
  // re-armed, or it would be postponed forever. push() reads the latest state.
  if (timer || !changed()) return;
  hold(true); // so the timer below fires even in the background
  timer = setTimeout(() => {
    timer = undefined;
    void push();
  }, DEBOUNCE_MS);
}

/* ───────── lifecycle ───────── */

let running = false;
let unsubPlayer: (() => void) | undefined;
let unsubRoom: (() => void) | undefined;
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
  unsubRoom = useJam.subscribe((j, p) => {
    if (j.status !== p.status || j.code !== p.code || j.members !== p.members) schedule();
  });
  schedule();
}

function disable() {
  if (!running) return;
  running = false;
  clearTimeout(timer);
  timer = undefined;
  generation++;
  unsubPlayer?.();
  unsubRoom?.();
  resultSub?.remove();
  resultSub = null;
  DiscordPresenceModule.stop();
  hold(false);
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
    else if (running && s.discordRoomInvite !== prev.discordRoomInvite) schedule();
  });
}
