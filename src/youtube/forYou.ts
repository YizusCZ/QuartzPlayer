/**
 * "Para ti": new songs from what you actually listen to. A few of your songs,
 * chosen by weight (plays, favourites, how recent), each bring YouTube Music's
 * radio; the songs several of them agree on rank higher, and whatever you heard
 * in the last days stays out.
 */
import { useLibrary } from '@/store/library';
import { useSongHistory } from '@/store/songHistory';
import { days, isOneSong, mergeRanked, pick, seedScore, weightedSample, type PoolSong } from '@/lib/songPicker';
import { radio, type YtSong } from './music';

const SEEDS = 4;
const SONGS = 24;
const FRESH_FOR_MS = 30 * 60_000;

let cached: { at: number; songs: YtSong[] } | null = null;

const videoIdOf = (id: string, filename: string) =>
  id.startsWith('yt:') ? id.slice(3) : /[[(]([\w-]{11})[\])]/.exec(filename)?.[1];

function seeds(now: number): string[] {
  const { tracks, remote, plays, favorites } = useLibrary.getState();
  const weighted: { item: string; weight: number }[] = [];
  const artists = new Map<string, string>();
  for (const id of new Set([...Object.keys(plays), ...Object.keys(favorites)])) {
    const t = tracks[id] ?? remote[id];
    const videoId = t && videoIdOf(id, t.filename);
    if (!t || !videoId) continue;
    artists.set(videoId, t.artist);
    const p = plays[id];
    weighted.push({ item: videoId, weight: seedScore(p?.count ?? 1, p?.last ?? now - days(14), !!favorites[id], now) });
  }
  // Different artists, so one week of the same album does not take over the shelf.
  const out: string[] = [];
  const used = new Set<string>();
  for (const id of weightedSample(weighted, SEEDS * 4)) {
    const a = artists.get(id) ?? id;
    if (used.has(a)) continue;
    used.add(a);
    out.push(id);
    if (out.length === SEEDS) break;
  }
  return out;
}

export async function forYou(signal?: AbortSignal): Promise<YtSong[]> {
  const now = Date.now();
  if (cached && now - cached.at < FRESH_FOR_MS) return cached.songs;
  const from = seeds(now);
  if (!from.length) return [];
  const lists = await Promise.all(from.map((id) => radio(id, signal).catch(() => [] as YtSong[])));
  const byId = new Map(lists.flat().map((s) => [s.videoId, s]));
  const { plays } = useLibrary.getState();
  const { heard } = useSongHistory.getState();
  const known = new Set(from);
  const pool = mergeRanked(lists as PoolSong[][]).filter((s) => isOneSong(s) && !known.has(s.videoId));
  const chosen = pick(pool, SONGS, {
    lastHeard: (id) => Math.max(plays[`yt:${id}`]?.last ?? 0, heard[id] ?? 0) || undefined,
    now,
    maxPerArtist: 2,
    freshAfterMs: days(14),
    randomness: 0.35,
  });
  const songs = chosen.flatMap((s) => byId.get(s.videoId) ?? []);
  if (songs.length) cached = { at: now, songs };
  return songs;
}
