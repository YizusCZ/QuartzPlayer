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
  // Streamed songs use the improved lookup: their old "not found" entries are skipped.
  const v = track.source === 'youtube' ? 'yt2|' : '';
  return new File(dir, `${hash(`${v}${track.artist}|${track.title}|${track.album}`)}.json`);
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

/* ───────── cleaning YouTube-style titles ───────── */

const NOISE =
  /\s*[([]\s*(?:official|oficial|video|vídeo|videoclip|audio|lyrics?|letra|visuali[sz]er|music video|mv|hd|4k|hq|remaster(?:ed)?(?:\s*\d{4})?|explicit|clean|en vivo|ao vivo|live(?:\s+[^)\]]*)?|en directo|acústico|acoustic|session)[^)\]]*[)\]]/gi;
const LIVE = /\b(en vivo|ao vivo|live|en directo|concierto|unplugged|session)\b/i;
const FEAT = /\s+(?:ft\.?|feat\.?|featuring|con|with|x)\s+.+$/i;

function cleanArtist(a: string): string {
  return a
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s*(official|oficial)(\s+(music|channel|canal))?$/i, '')
    .split(/\s*[,&]\s*|\s+x\s+/)[0]
    .trim();
}

/** "Artist - Song (Official Video) ft. X" → { artist, title }. */
function cleanTitle(title: string, artist: string): { title: string; artist: string } {
  let t = title
    .replace(NOISE, '')
    .replace(/\s*\|\s*.*$/, '')
    .trim();
  let a = cleanArtist(artist);
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (dash) {
    // "Artist - Song": keep the song, and the artist when ours is a channel name.
    const [, left, right] = dash;
    if (!a || left.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(left.toLowerCase())) {
      a = a || left;
      t = right;
    } else if (/vevo|topic|records|music|tv/i.test(artist)) {
      a = left;
      t = right;
    }
  }
  t = t.replace(FEAT, '').replace(/["“”]/g, '').trim();
  return { title: t || title, artist: a || artist };
}

type LrclibHit = {
  trackName?: string;
  artistName?: string;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  duration?: number;
};

async function fetchLrclib(track: Track, signal: AbortSignal): Promise<Cached | null> {
  const headers = { 'User-Agent': 'Quartz Player (https://github.com/)' };
  const streamed = track.source === 'youtube';
  const live = LIVE.test(track.title);
  const clean = cleanTitle(track.title, track.artist);
  // Music videos run longer than the song (intros, outros): be lenient there.
  const slack = streamed ? 30 : 8;

  const pick = (h: LrclibHit, approx: boolean): Cached => {
    // A different take (live, or a far-off duration) keeps the words but drops
    // the timings, which would drift.
    const offTime = !!track.duration && !!h.duration && Math.abs(h.duration - track.duration) > 8;
    const keepSynced = !(live || (approx && offTime));
    return {
      at: Date.now(),
      synced: keepSynced ? (h.syncedLyrics ?? undefined) : undefined,
      plain: h.plainLyrics ?? (keepSynced ? undefined : stripTimes(h.syncedLyrics)),
      instrumental: !!h.instrumental,
      source: 'lrclib',
    };
  };

  const attempts: { title: string; artist: string; album?: string; duration?: number }[] = [];
  const seen = new Set<string>();
  const add = (title: string, artist: string, album?: string, duration?: number) => {
    const k = `${title}|${artist}|${album ?? ''}|${duration ?? ''}`.toLowerCase();
    if (!title || seen.has(k)) return;
    seen.add(k);
    attempts.push({ title, artist, album, duration });
  };
  const realAlbum = !streamed && track.album && track.album !== track.title ? track.album : undefined;
  if (!live) add(track.title, track.artist, realAlbum, track.duration || undefined);
  if (!live) add(clean.title, clean.artist, undefined, track.duration || undefined);

  // 1. Exact lookups (artist + title [+ album] [+ duration]).
  for (const at of attempts) {
    const params = new URLSearchParams({ track_name: at.title, artist_name: at.artist });
    if (at.album) params.set('album_name', at.album);
    if (at.duration) params.set('duration', String(Math.round(at.duration)));
    const res = await fetch(`https://lrclib.net/api/get?${params}`, { headers, signal });
    if (res.ok) return pick((await res.json()) as LrclibHit, false);
    if (res.status !== 404) return null; // server trouble: do not cache a miss
  }

  // 2. Fuzzy search: cleaned title + artist, then a free-text query.
  const queries = [
    new URLSearchParams({ track_name: clean.title, artist_name: clean.artist }),
    new URLSearchParams({ q: `${clean.artist} ${clean.title}` }),
    new URLSearchParams({ track_name: track.title, artist_name: track.artist }),
  ];
  for (const q of queries) {
    const res = await fetch(`https://lrclib.net/api/search?${q}`, { headers, signal });
    if (!res.ok) continue;
    const hits = ((await res.json()) as LrclibHit[]).filter((h) => h.syncedLyrics || h.plainLyrics || h.instrumental);
    // The studio version for live takes; otherwise the closest duration, synced first.
    const scored = hits
      .filter((h) => !LIVE.test(h.trackName ?? '') || live)
      .sort(
        (x, y) =>
          Number(!!y.syncedLyrics) - Number(!!x.syncedLyrics) ||
          Math.abs((x.duration ?? 0) - track.duration) - Math.abs((y.duration ?? 0) - track.duration),
      );
    const best = scored[0];
    if (!best) continue;
    const close = !track.duration || !best.duration || Math.abs(best.duration - track.duration) < slack;
    if (close || live) return pick(best, true);
  }
  return { at: Date.now() };
}

/** "[00:12.34] words" → "words". */
function stripTimes(lrc: string | null | undefined): string | undefined {
  if (!lrc) return undefined;
  return lrc
    .split('\n')
    .map((l) => l.replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

export async function loadLyrics(track: Track, signal: AbortSignal): Promise<Lyrics> {
  const mem = memory.get(track.id);
  if (mem) return mem;

  const done = (l: Lyrics) => {
    memory.set(track.id, l);
    return l;
  };

  if (track.source !== 'youtube') {
    const embedded = readEmbedded(track);
    if (embedded) return done(toLyrics(fromText(embedded, 'embedded'), track.duration));
    const sidecar = readSidecar(track);
    if (sidecar) return done(toLyrics(fromText(sidecar, 'file'), track.duration));
  }

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
