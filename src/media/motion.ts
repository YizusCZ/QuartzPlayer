/**
 * Motion artwork ("portadas animadas"). Apple Music publishes looping cover
 * videos for many albums: a square one (the animated cover) and a tall one
 * (a full-screen loop, like Spotify's Canvas). We find the album with the
 * public iTunes Search API and read the video addresses from the album's
 * public web page — no account or key involved. Only artist, album and
 * title are sent, and only while the setting is on.
 */
import { useEffect } from 'react';
import type { Track } from '@/library/types';
import { useMedia, type MotionArt } from '@/store/media';
import { useSettings } from '@/store/settings';

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36';
/** "Nothing found" is retried after a week; hits are kept for a month (the URLs are stable). */
const MISS_TTL = 7 * 86_400_000;
const HIT_TTL = 30 * 86_400_000;

export function motionKey(t: Pick<Track, 'artist' | 'albumArtist' | 'album' | 'title'>): string {
  const artist = (t.albumArtist ?? t.artist ?? '').toLowerCase().trim();
  const album = (t.album ?? '').toLowerCase().trim();
  return album ? `${artist}\u0000${album}` : `${artist}\u0000\u0000${t.title.toLowerCase().trim()}`;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*?[)\]]\s*/g, ' ') // "(Deluxe Edition)", "[Remastered]"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function similar(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

type ItunesHit = { collectionId: number; collectionName: string; artistName: string };

async function findCollection(t: Track, signal: AbortSignal): Promise<number | null> {
  const artist = t.albumArtist ?? t.artist ?? '';
  const hasAlbum = !!t.album && !/^(unknown|desconocido)/i.test(t.album);
  const term = encodeURIComponent(`${artist} ${hasAlbum ? t.album : t.title}`.trim());
  const entity = hasAlbum ? 'album' : 'song';
  const { results } = await getJson<{ results: ItunesHit[] }>(
    `https://itunes.apple.com/search?entity=${entity}&limit=8&term=${term}`,
    signal,
  );
  const want = hasAlbum ? t.album : t.title;
  const pick =
    results.find((r) => similar(r.artistName, artist) && similar(r.collectionName, want)) ??
    results.find((r) => similar(r.collectionName, want)) ??
    (hasAlbum ? undefined : results.find((r) => similar(r.artistName, artist)));
  return pick?.collectionId ?? null;
}

function videoOf(html: string, kind: 'motionDetailSquare' | 'motionDetailTall'): string | undefined {
  const at = html.indexOf(`"${kind}"`);
  if (at < 0) return undefined;
  // The preview frame comes first; the first "video" after the key is ours.
  const m = /"video":"(https:[^"]+?\.m3u8)"/.exec(html.slice(at, at + 4000));
  return m?.[1].replace(/\\u002F/g, '/');
}

async function lookup(t: Track, signal: AbortSignal): Promise<MotionArt | null> {
  const id = await findCollection(t, signal);
  if (!id) return null;
  const res = await fetch(`https://music.apple.com/us/album/${id}`, { headers: { 'User-Agent': UA }, signal });
  if (!res.ok) return null;
  const html = await res.text();
  const art = { square: videoOf(html, 'motionDetailSquare'), tall: videoOf(html, 'motionDetailTall') };
  return art.square || art.tall ? art : null;
}

const inflight = new Set<string>();

/** Looks the track's motion artwork up once (cached), if the setting allows it. */
export async function ensureMotion(t: Track): Promise<void> {
  if (!useSettings.getState().motionArt) return;
  const key = motionKey(t);
  const hit = useMedia.getState().motion[key];
  if (hit && Date.now() - hit.at < (hit.art ? HIT_TTL : MISS_TTL)) return;
  if (inflight.has(key)) return;
  inflight.add(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    useMedia.getState().setMotion(key, await lookup(t, ctrl.signal));
  } catch {
    // offline or blocked: try again next time the track plays
  } finally {
    clearTimeout(timer);
    inflight.delete(key);
  }
}

/** The track's motion artwork, fetching it in the background when missing. Your own cover wins over it. */
export function useMotionArt(t: Track | undefined): MotionArt | null {
  const enabled = useSettings((s) => s.motionArt) && !t?.customArtwork;
  const key = t ? motionKey(t) : '';
  const art = useMedia((s) => (key ? (s.motion[key]?.art ?? null) : null));
  useEffect(() => {
    if (enabled && t) void ensureMotion(t);
  }, [enabled, t]);
  return enabled ? art : null;
}
