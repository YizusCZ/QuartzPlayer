/**
 * Imports a playlist from another service into a Quartz list.
 *
 * The song list is read from the link (src/catalog/importSources.ts); then
 * each song is looked for first among your own files (same title and artist)
 * and otherwise on YouTube Music, picking the result whose title, artist and
 * length agree best. Songs with no good match are listed, never guessed.
 *
 * One import runs at a time and keeps going if you leave the screen.
 */
import { File } from 'expo-file-system';
import { create } from 'zustand';
import type { Track } from '@/library/types';
import { coversDir } from '@/lib/userMedia';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { playlistSongs, searchSongs, toTrack, type YtSong } from '@/youtube/music';
import {
  detectLink,
  fromApple,
  fromDeezer,
  fromSpotify,
  fromText,
  resolveShort,
  type ImportPlatform,
  type SourceList,
  type SourceTrack,
} from './importSources';

export type ImportJob = {
  status: 'reading' | 'matching' | 'done' | 'error';
  platform?: ImportPlatform;
  name: string;
  cover?: string;
  total: number;
  done: number;
  /** Found among your files. */
  local: number;
  /** Found on YouTube Music. */
  online: number;
  missing: SourceTrack[];
  capped?: boolean;
  playlistId?: string;
  error?: string;
};

export const useImport = create<{ job: ImportJob | null }>()(() => ({ job: null }));

const patch = (p: Partial<ImportJob>) => useImport.setState((s) => (s.job ? { job: { ...s.job, ...p } } : s));

/** Songs looked up at the same time. */
const PARALLEL = 4;
/** Below this a YouTube result is not the same song. */
const MIN_SCORE = 0.5;

let ctrl: AbortController | null = null;

/* ───────── matching ───────── */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // "(feat. X)", "[Remastered 2011]", "- Live", "- Radio Edit"…
    .replace(/[([][^)\]]*(feat|ft\.|with|con |remaster|version|versión|live|en vivo|edit|mix|from)[^)\]]*[)\]]/g, ' ')
    .replace(/\s-\s[^-]*(remaster|version|live|edit|mix|en vivo)[^-]*$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const words = (s: string) => norm(s).split(' ').filter(Boolean);

/** Dice similarity of the two strings' words (0…1). */
function similar(a: string, b: string) {
  const A = words(a);
  const B = new Set(words(b));
  if (!A.length || !B.size) return 0;
  const hits = A.filter((w) => B.has(w)).length;
  return (2 * hits) / (A.length + B.size);
}

/** "Bad Bunny, Chencho Corleone" / "A & B" / "A feat. B" → "Bad Bunny". */
const mainArtist = (s: string) => s.split(/,|&|\s+(?:feat\.?|ft\.?|x|y|and|with)\s+/i)[0]?.trim() ?? s;

function artistScore(source: string, candidate: string) {
  if (!source) return 0.5;
  const main = mainArtist(source);
  if (norm(candidate).includes(norm(main))) return 1;
  return Math.max(similar(main, candidate), similar(source, candidate));
}

function lengthScore(a?: number, b?: number) {
  if (!a || !b) return 0.5;
  const d = Math.abs(a - b);
  return d <= 3 ? 1 : d <= 10 ? 0.7 : d <= 30 ? 0.2 : 0;
}

const score = (t: SourceTrack, c: { title: string; artist: string; duration?: number }) =>
  0.55 * similar(t.title, c.title) + 0.3 * artistScore(t.artist, c.artist) + 0.15 * lengthScore(t.duration, c.duration);

/** Your own files by normalised title, built once per import. */
function localIndex() {
  const index = new Map<string, Track[]>();
  for (const t of Object.values(useLibrary.getState().tracks)) {
    const k = norm(t.title);
    if (!k) continue;
    index.set(k, [...(index.get(k) ?? []), t]);
  }
  return index;
}

function findLocal(index: Map<string, Track[]>, t: SourceTrack): Track | undefined {
  const same = index.get(norm(t.title));
  if (!same) return undefined;
  return same.find((x) => artistScore(t.artist, x.artist) >= 0.6);
}

async function findOnline(t: SourceTrack, signal: AbortSignal): Promise<YtSong | undefined> {
  const query = [mainArtist(t.artist), t.title].filter(Boolean).join(' ');
  const results = (await searchSongs(query, signal)).slice(0, 6);
  let best: YtSong | undefined;
  let bestScore = 0;
  for (const r of results) {
    const s = score(t, r);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return bestScore >= MIN_SCORE ? best : undefined;
}

/* ───────── import ───────── */

async function read(input: string, signal: AbortSignal): Promise<SourceList | { youtube: string }> {
  let link = detectLink(input);
  if (link?.platform === 'short') link = await resolveShort(link.url, signal);
  if (!link) throw new Error('No reconozco ese enlace. Usa el de “Compartir → Copiar enlace” de la lista.');
  switch (link.platform) {
    case 'spotify':
      return fromSpotify(link.kind, link.id, signal);
    case 'apple':
      return fromApple(link.url, signal);
    case 'deezer':
      return fromDeezer(link.kind, link.id, signal);
    case 'youtube':
      return { youtube: link.listId };
    default:
      throw new Error('No reconozco ese enlace');
  }
}

/** Keeps the service's cover as the list's own image (a copy in Documents/covers). */
async function saveCover(url: string | undefined): Promise<string | undefined> {
  if (!url || !/^https:\/\//.test(url)) return undefined;
  try {
    const file = new File(coversDir(), `import_${Date.now().toString(36)}.jpg`);
    return (await File.downloadFileAsync(url, file)).uri;
  } catch {
    return undefined;
  }
}

function finish(name: string, ids: string[], online: Track[], cover: string | undefined) {
  const lib = useLibrary.getState();
  if (online.length) lib.addRemote(online);
  const id = lib.createPlaylist(name, ids);
  void saveCover(cover).then((uri) => uri && useLibrary.getState().updatePlaylist(id, { cover: uri }));
  patch({ status: 'done', playlistId: id });
  useUI.getState().showToast(`Lista “${name}” importada · ${ids.length} canciones`);
}

/** Starts importing a link (Spotify, Apple Music, Deezer, YouTube) or, with `text`, a pasted song list. */
export async function importPlaylist(input: { link: string } | { text: string; name: string }) {
  ctrl?.abort();
  const c = new AbortController();
  ctrl = c;
  const signal = c.signal;
  useImport.setState({
    job: {
      status: 'reading',
      name: 'name' in input ? input.name : 'Leyendo la lista…',
      total: 0,
      done: 0,
      local: 0,
      online: 0,
      missing: [],
    },
  });
  try {
    const source = 'text' in input ? fromText(input.text, input.name) : await read(input.link, signal);
    if (signal.aborted) return;

    // YouTube lists are already YouTube songs: nothing to match.
    if ('youtube' in source) {
      const list = await playlistSongs(source.youtube, signal);
      if (signal.aborted) return;
      if (!list.songs.length) throw new Error('Esta lista de YouTube está vacía o es privada');
      const name = list.title || 'Lista de YouTube';
      const tracks = list.songs.map(toTrack);
      patch({
        platform: 'youtube',
        name,
        cover: list.cover,
        total: tracks.length,
        done: tracks.length,
        online: tracks.length,
        status: 'matching',
      });
      return finish(
        name,
        tracks.map((t) => t.id),
        tracks,
        list.cover,
      );
    }

    if (!source.tracks.length) throw new Error('No encontré canciones en esa lista');
    patch({
      status: 'matching',
      platform: source.platform,
      name: source.name,
      cover: source.cover,
      total: source.tracks.length,
      capped: source.capped,
    });

    const index = localIndex();
    const found: (string | null)[] = new Array(source.tracks.length).fill(null);
    const online = new Map<string, Track>();
    const missing: SourceTrack[] = [];
    let local = 0;
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < source.tracks.length && !signal.aborted) {
        const i = next++;
        const t = source.tracks[i];
        const mine = findLocal(index, t);
        if (mine) {
          found[i] = mine.id;
          local++;
        } else {
          const song = await findOnline(t, signal).catch(() => undefined);
          if (song) {
            const track = toTrack({ ...song, album: song.album ?? t.album });
            online.set(track.id, track);
            found[i] = track.id;
          } else missing.push(t);
        }
        done++;
        patch({ done, local, online: online.size, missing: [...missing] });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (signal.aborted) return;
    // The same song twice in the source stays twice; songs not found are left out.
    const ids = found.filter((x): x is string => !!x);
    if (!ids.length) throw new Error('No encontré ninguna de estas canciones');
    finish(source.name, ids, [...online.values()], source.cover);
  } catch (e) {
    if (signal.aborted) return;
    patch({ status: 'error', error: (e as Error).message || 'No se pudo importar la lista' });
  } finally {
    if (ctrl === c) ctrl = null;
  }
}

export function cancelImport() {
  ctrl?.abort();
  ctrl = null;
  useImport.setState({ job: null });
}

/** Forgets a finished (or failed) import. */
export function clearImport() {
  if (!ctrl) useImport.setState({ job: null });
}
