/**
 * Finds lyrics for a track, in order of preference:
 *   1. lyrics embedded in the file's tags
 *   2. a sidecar .lrc next to the audio file
 *   3. LRCLIB (lrclib.net, free and keyless) when online lookup is enabled
 * Results — including "not found" — are cached on disk so each track is
 * looked up once.
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { hash } from '@/library/bytes';
import { parseMetadata } from '@/library/metadata';
import type { Track } from '@/library/types';
import { useSettings } from '@/store/settings';
import { isLrc, parseLrc, type Lyrics, type LyricsSource } from './lrc';

type Cached = { at: number; synced?: string; plain?: string; instrumental?: boolean; source?: LyricsSource };

const RETRY_MISS_MS = 7 * 24 * 3600 * 1000;
const memory = new Map<string, Lyrics>();

function cacheFile(track: Track): File {
  const dir = new Directory(Paths.cache, 'lyrics');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${hash(`${track.artist}|${track.title}|${track.album}`)}.json`);
}

function toLyrics(c: Cached, duration: number): Lyrics {
  if (c.instrumental) return { kind: 'instrumental', source: c.source ?? 'lrclib' };
  if (c.synced) {
    const lines = parseLrc(c.synced, duration);
    if (lines.length) return { kind: 'synced', lines, source: c.source ?? 'lrclib' };
  }
  if (c.plain?.trim()) return { kind: 'plain', text: c.plain.trim(), source: c.source ?? 'lrclib' };
  return { kind: 'none' };
}

function fromText(text: string, source: LyricsSource): Cached {
  return isLrc(text) ? { at: Date.now(), synced: text, source } : { at: Date.now(), plain: text, source };
}

function readEmbedded(track: Track): string | undefined {
  try {
    const file = new File(track.uri);
    const h = file.open(FileMode.ReadOnly);
    const size = h.size ?? file.size;
    try {
      const meta = parseMetadata(
        {
          size,
          read(offset, length) {
            const len = Math.max(0, Math.min(length, size - offset));
            if (!len) return new Uint8Array(0);
            h.offset = offset;
            return h.readBytes(len);
          },
        },
        track.filename,
      );
      return meta.lyrics?.trim() || undefined;
    } finally {
      h.close();
    }
  } catch {
    return undefined;
  }
}

function readSidecar(track: Track): string | undefined {
  try {
    const lrc = new File(track.uri.replace(/\.[^./]+$/, '.lrc'));
    return lrc.exists ? lrc.textSync() : undefined;
  } catch {
    return undefined;
  }
}

type LrclibHit = {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  duration?: number;
};

async function fetchLrclib(track: Track, signal: AbortSignal): Promise<Cached | null> {
  const headers = { 'User-Agent': 'Quartz Player (https://github.com/)' };
  const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  if (track.album) params.set('album_name', track.album);
  if (track.duration) params.set('duration', String(Math.round(track.duration)));
  const pick = (h: LrclibHit): Cached => ({
    at: Date.now(),
    synced: h.syncedLyrics ?? undefined,
    plain: h.plainLyrics ?? undefined,
    instrumental: !!h.instrumental,
    source: 'lrclib',
  });

  const exact = await fetch(`https://lrclib.net/api/get?${params}`, { headers, signal });
  if (exact.ok) return pick((await exact.json()) as LrclibHit);
  if (exact.status !== 404) return null; // server trouble: do not cache a miss

  // Fuzzy fallback: best-matching result by duration.
  const q = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  const res = await fetch(`https://lrclib.net/api/search?${q}`, { headers, signal });
  if (!res.ok) return null;
  const hits = (await res.json()) as LrclibHit[];
  const scored = hits
    .filter((h) => h.syncedLyrics || h.plainLyrics || h.instrumental)
    .sort(
      (a, b) =>
        Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) ||
        Math.abs((a.duration ?? 0) - track.duration) - Math.abs((b.duration ?? 0) - track.duration),
    );
  const best = scored[0];
  if (best && (!track.duration || !best.duration || Math.abs(best.duration - track.duration) < 8)) return pick(best);
  return { at: Date.now() };
}

export async function loadLyrics(track: Track, signal: AbortSignal): Promise<Lyrics> {
  const mem = memory.get(track.id);
  if (mem) return mem;

  const done = (l: Lyrics) => {
    memory.set(track.id, l);
    return l;
  };

  const embedded = readEmbedded(track);
  if (embedded) return done(toLyrics(fromText(embedded, 'embedded'), track.duration));
  const sidecar = readSidecar(track);
  if (sidecar) return done(toLyrics(fromText(sidecar, 'file'), track.duration));

  const file = cacheFile(track);
  let cached: Cached | null = null;
  try {
    if (file.exists) cached = JSON.parse(file.textSync()) as Cached;
  } catch {
    cached = null;
  }
  const isMiss = cached && !cached.synced && !cached.plain && !cached.instrumental;
  if (cached && !(isMiss && Date.now() - cached.at > RETRY_MISS_MS)) return done(toLyrics(cached, track.duration));

  if (!useSettings.getState().onlineLyrics) return { kind: 'none' };
  try {
    const fetched = await fetchLrclib(track, signal);
    if (!fetched) return cached ? toLyrics(cached, track.duration) : { kind: 'none' };
    try {
      if (!file.exists) file.create({ overwrite: true });
      file.write(JSON.stringify(fetched));
    } catch {
      // cache is best-effort
    }
    return done(toLyrics(fetched, track.duration));
  } catch {
    return { kind: 'none' }; // offline or aborted
  }
}
