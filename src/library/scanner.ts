/**
 * Library discovery.
 *  - Android: every audio file indexed by MediaStore (READ_MEDIA_AUDIO).
 *  - Both platforms: files inside the app's Documents folder — imported from
 *    the Files picker, or copied over USB/Finder on iOS (UIFileSharingEnabled).
 * Tags and stream info are read by our own parser; covers are cached on disk.
 */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import {
  addListener,
  Asset,
  AssetField,
  getPermissionsAsync,
  MediaType,
  Query,
  requestPermissionsAsync,
} from 'expo-media-library';
import { useLibrary } from '@/store/library';
import { useScan, type ScanState } from '@/store/scan';
import { useSettings } from '@/store/settings';
import { hash, type ByteSource } from './bytes';
import { parseMetadata, type Picture } from './metadata';
import type { Track } from './types';

export const AUDIO_EXT = [
  'flac',
  'wav',
  'wave',
  'aif',
  'aiff',
  'aifc',
  'm4a',
  'mp4',
  'aac',
  'alac',
  'mp3',
  'ogg',
  'opus',
];
const IGNORED_DIRS = /\/(notifications|ringtones|alarms|voice notes|recordings|call ?rec\w*|whatsapp audio)\//i;
const SHORT_CLIP = 30;

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
export const isAudioFile = (name: string) => AUDIO_EXT.includes(ext(name));
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

/* ───────── files ───────── */

function fileSource(uri: string): ByteSource & { close(): void } {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  const size = handle.size ?? file.size;
  return {
    size,
    read(offset, length) {
      const len = Math.max(0, Math.min(length, size - offset));
      if (!len) return new Uint8Array(0);
      handle.offset = offset;
      return handle.readBytes(len);
    },
    close: () => handle.close(),
  };
}

function artworkDir(): Directory {
  const dir = new Directory(Paths.cache, 'artwork');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function cacheArtwork(key: string, pic: Picture): string | undefined {
  try {
    const file = new File(artworkDir(), `${hash(key)}.${pic.mime.includes('png') ? 'png' : 'jpg'}`);
    if (!file.exists) {
      file.create({ overwrite: true });
      file.write(pic.data);
    }
    return file.uri;
  } catch {
    return undefined;
  }
}

function prettyName(filename: string): { title: string; artist?: string } {
  const base = filename
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .trim();
  const clean = base
    .replace(/^\d{1,3}[\s.\-_]+/, '')
    .replace(/\s*\[[\w-]+\]$/, '')
    .trim();
  const m = /^(.+?)\s+-\s+(.+)$/.exec(clean);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: clean };
}

type Candidate = {
  id: string;
  filename: string;
  source: Track['source'];
  modified: number;
  duration?: number;
  uri?: string;
  assetId?: string;
};

function decodePath(uri: string): string {
  const path = uri.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function readTrack(c: Candidate & { uri: string }): Track {
  const folder = decodePath(c.uri).replace(/\/[^/]*$/, '') || 'Música';
  const isYt = folder === 'YouTube' || folder.endsWith('/YouTube');
  const src = fileSource(c.uri);
  let meta;
  try {
    meta = parseMetadata(src, c.filename);
  } finally {
    src.close();
  }
  const guess = prettyName(c.filename);
  const artist = meta.artist || guess.artist || 'Artista desconocido';
  const rawAlbum = meta.album;
  const album =
    rawAlbum && rawAlbum !== 'YouTube'
      ? rawAlbum
      : isYt
        ? (artist !== 'Artista desconocido' ? `${artist} - Single` : 'Sencillo')
        : folder.split('/').pop() || 'Álbum desconocido';

  let artwork = meta.picture
    ? cacheArtwork(`${meta.albumArtist ?? artist}|${album}|${meta.picture.data.length}`, meta.picture)
    : undefined;

  if (!artwork && isYt) {
    const vidMatch = /\[([\w-]+)\]/.exec(c.filename);
    if (vidMatch?.[1]) {
      const cached = new File(artworkDir(), `${hash(vidMatch[1])}.jpg`);
      if (cached.exists) artwork = cached.uri;
    }
  }
  return {
    id: c.id,
    uri: c.uri,
    filename: c.filename,
    folder,
    title: meta.title || guess.title,
    artist,
    album,
    albumArtist: meta.albumArtist,
    genre: meta.genre,
    year: meta.year,
    trackNo: meta.trackNo,
    discNo: meta.discNo,
    duration: meta.duration || c.duration || 0,
    size: src.size,
    format: meta.format,
    artwork,
    addedAt: c.modified || Date.now(),
    mtime: c.modified,
    source: c.source,
  };
}

/* ───────── discovery ───────── */

export function musicDir(): Directory {
  const dir = new Directory(Paths.document, 'Music');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Quartz's own folders in Documents: video backgrounds (an .mp4 would pass as
 * audio), covers and stickers. They are never music.
 */
const APP_DIRS = new Set(['videos', 'covers', 'stickers', 'artwork']);

function walk(dir: Directory, out: Candidate[], depth = 0) {
  if (depth > 6) return;
  for (const entry of dir.list()) {
    if (entry instanceof Directory) {
      if (depth === 0 && APP_DIRS.has(entry.name.toLowerCase())) continue;
      if (!entry.name.startsWith('.')) walk(entry, out, depth + 1);
    } else if (isAudioFile(entry.name)) {
      out.push({
        id: `f:${hash(entry.uri)}`,
        uri: entry.uri,
        filename: entry.name,
        source: 'imported',
        modified: entry.modificationTime ?? 0,
      });
    }
  }
}

async function deviceCandidates(prompt: boolean): Promise<Candidate[]> {
  if (Platform.OS !== 'android') return [];
  const perm = prompt ? await requestPermissionsAsync(false, ['audio']) : await getPermissionsAsync(false, ['audio']);
  if (!perm.granted) {
    if (prompt) throw new Error('Quartz necesita permiso para leer tu música.');
    return [];
  }
  const metas = await new Query().eq(AssetField.MEDIA_TYPE, MediaType.AUDIO).exeForMetadata();
  return metas
    .filter((m) => m.filename && isAudioFile(m.filename))
    .map((m) => ({
      id: `ml:${m.id}`,
      assetId: m.id,
      filename: m.filename!,
      source: 'device' as const,
      modified: m.modificationTime ?? 0,
      // MediaStore reports milliseconds on some OEM builds.
      duration: m.duration ? (m.duration > 36000 ? m.duration / 1000 : m.duration) : undefined,
    }));
}

let running: Promise<void> | null = null;
let queued = false;

/**
 * Incremental scan. Only files that are new or changed since the last scan are
 * opened; everything else is a cheap id/mtime comparison. When nothing changed
 * the library store is not touched at all (no re-render, no disk write).
 *
 * `manual` shows progress from the start and may show the permission prompt;
 * background scans stay invisible unless there are new files to read.
 */
export function scanLibrary(opts: { manual?: boolean } = {}): Promise<void> {
  if (running) {
    queued = true;
    return running;
  }
  running = doScan(!!opts.manual).finally(() => {
    running = null;
    if (queued) {
      queued = false;
      void scanLibrary();
    }
  });
  return running;
}

async function doScan(manual: boolean) {
  const setScan = (patch: Partial<ScanState>) => useScan.setState(patch);
  if (manual) setScan({ running: true, done: 0, total: 0, message: 'Buscando música…' });
  try {
    const candidates: Candidate[] = [];
    walk(Paths.document, candidates);
    try {
      candidates.push(...(await deviceCandidates(manual || useLibrary.getState().lastScan == null)));
    } catch (e) {
      setScan({ message: (e as Error).message });
    }

    const { tracks: known, skipped: knownSkipped } = useLibrary.getState();
    const skipShort = useSettings.getState().skipShortClips;
    const tracks: Record<string, Track> = {};
    const skipped: Record<string, number> = {};
    const fresh: Candidate[] = [];
    for (const c of candidates) {
      const prev = known[c.id];
      if (prev && prev.mtime === c.modified) tracks[c.id] = prev;
      else if (knownSkipped[c.id] === c.modified) skipped[c.id] = c.modified;
      else fresh.push(c);
    }
    const removed = Object.keys(known).some((id) => !tracks[id]) && fresh.length === 0;

    if (fresh.length) setScan({ running: true, done: 0, total: fresh.length, message: 'Leyendo etiquetas…' });
    for (let i = 0; i < fresh.length; i++) {
      const c = fresh[i];
      try {
        const uri = c.uri ?? (await new Asset(c.assetId!).getUri());
        if (IGNORED_DIRS.test(decodePath(uri))) {
          skipped[c.id] = c.modified;
          continue;
        }
        const read = readTrack({ ...c, uri });
        // A cover you chose survives the file being read again.
        const prevCustom = known[c.id]?.customArtwork;
        const track = prevCustom
          ? { ...read, customArtwork: prevCustom, originalArtwork: read.artwork, artwork: prevCustom }
          : read;
        if (skipShort && track.source === 'device' && track.duration > 0 && track.duration < SHORT_CLIP) {
          skipped[c.id] = c.modified;
          continue;
        }
        tracks[c.id] = track;
      } catch {
        // Unreadable (DRM, cloud placeholder, permissions): remember it so we do not retry every launch.
        skipped[c.id] = c.modified;
      }
      if (i % 8 === 7) {
        setScan({ done: i + 1 });
        await yieldToUI();
      }
    }

    const changed =
      fresh.length > 0 ||
      removed ||
      Object.keys(known).length !== Object.keys(tracks).length ||
      !useLibrary.getState().lastScan;
    // A download may have finished while we were scanning: keep songs from
    // Música libre (their metadata and licence come from the service, not the file).
    const latest = useLibrary.getState().tracks;
    for (const t of Object.values(latest)) {
      const isYt = t.folder === 'YouTube' || t.folder.endsWith('/YouTube');
      if (!t.origin && !isYt) continue;
      if (tracks[t.id] || new File(t.uri).exists) tracks[t.id] = t;
    }
    if (changed) useLibrary.getState().setLibrary(tracks, skipped);
    setScan({ running: false, done: fresh.length, total: fresh.length, message: undefined });
  } catch (e) {
    setScan({ running: false, message: (e as Error).message });
  }
}

let watching = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

/**
 * Called once at launch: scans on first run, otherwise runs a quiet diff a few
 * seconds after start-up and then only when Android reports media changes.
 */
export function startLibraryWatch() {
  if (watching) return;
  watching = true;
  const first = useLibrary.getState().lastScan == null;
  if (first) void scanLibrary({ manual: true });
  else if (useSettings.getState().scanOnLaunch) setTimeout(() => void scanLibrary(), 4000);
  if (Platform.OS === 'android') {
    try {
      addListener(() => {
        clearTimeout(debounce);
        debounce = setTimeout(() => void scanLibrary(), 5000);
      });
    } catch {
      // media library events unavailable
    }
  }
}

/** Opens the system file picker and copies the chosen files into Documents/Music. */
export async function importFiles(): Promise<number> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return 0;
  const dest = musicDir();
  const added: Track[] = [];
  for (const a of res.assets) {
    if (!isAudioFile(a.name)) continue;
    try {
      let target = new File(dest, a.name);
      for (let n = 2; target.exists; n++) target = new File(dest, a.name.replace(/(\.[^.]+)$/, ` (${n})$1`));
      new File(a.uri).moveSync(target);
      added.push(
        readTrack({
          id: `f:${hash(target.uri)}`,
          uri: target.uri,
          filename: target.name,
          source: 'imported',
          modified: target.modificationTime ?? Date.now(),
        }),
      );
    } catch {
      // ignore the single failing file
    }
  }
  useLibrary.getState().upsertTracks(added);
  return added.length;
}

/** Deletes an imported file from Documents (device files are left untouched). */
export function deleteImported(track: Track) {
  if (track.source !== 'imported') return;
  try {
    new File(track.uri).delete();
  } catch {
    // already gone
  }
  useLibrary.getState().removeTrack(track.id);
}
