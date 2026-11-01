/**
 * Downloads from Música libre into Documents/Music/Descargas. Two at a time;
 * each finished file is read like an imported one and enters the library
 * with the service's title, artist, album, cover and licence.
 */
import { Directory, File } from 'expo-file-system';
import { createDownloadResumable } from 'expo-file-system/legacy';
import { create } from 'zustand';
import { hash } from '@/library/bytes';
import { musicDir, readTrack } from '@/library/scanner';
import type { Track } from '@/library/types';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import type { CatalogTrack } from './sources';

const PARALLEL = 2;

export type DownloadState =
  | { status: 'queued' }
  | { status: 'downloading'; progress: number }
  | { status: 'done'; trackId: string }
  | { status: 'error'; message: string };

export const useDownloads = create<{ items: Record<string, DownloadState> }>()(() => ({ items: {} }));

const setItem = (key: string, state: DownloadState | null) =>
  useDownloads.setState((s) => {
    const items = { ...s.items };
    if (state) items[key] = state;
    else delete items[key];
    return { items };
  });

function downloadsDir(): Directory {
  const dir = new Directory(musicDir(), 'Descargas');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const safe = (s: string) =>
  s
    // Strips URI-path-illegal chars too (see note in ytDownloads.ts safe()).
    .replace(/[\\/:*?"<>|[\]{}#%^`\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Canción';

function target(t: CatalogTrack): File {
  const base = `${safe(t.artist)} - ${safe(t.title)}`;
  let file = new File(downloadsDir(), `${base}.${t.ext}`);
  for (let n = 2; file.exists; n++) file = new File(downloadsDir(), `${base} (${n}).${t.ext}`);
  return file;
}

/** Downloads the cover once per album, for files that carry no picture of their own. */
async function coverFor(t: CatalogTrack): Promise<string | undefined> {
  if (!t.artwork) return undefined;
  try {
    const dir = new Directory(downloadsDir(), '.covers');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${hash(`${t.origin.service}|${t.artist}|${t.album}`)}.jpg`);
    if (file.exists) return file.uri;
    return (await File.downloadFileAsync(t.artwork, file)).uri;
  } catch {
    return undefined;
  }
}

const queue: CatalogTrack[] = [];
let running = 0;

async function run(t: CatalogTrack) {
  running++;
  setItem(t.key, { status: 'downloading', progress: 0 });
  const file = target(t);
  try {
    // Legacy downloader: hands the URL straight to OkHttp instead of the strict
    // java.net.URI the current API uses (which throws on some download links),
    // while still reporting byte progress.
    const task = createDownloadResumable(
      t.downloadUrl,
      file.uri,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : (t.size ?? 0);
        if (total > 0) setItem(t.key, { status: 'downloading', progress: Math.min(1, totalBytesWritten / total) });
      },
    );
    const result = await task.downloadAsync();
    if (!result) throw new Error('Descarga cancelada');
    const saved = new File(result.uri);
    const read = readTrack({
      id: `f:${hash(saved.uri)}`,
      uri: saved.uri,
      filename: saved.name,
      source: 'imported',
      // Same value the library scan reads, so a later scan sees the file as unchanged.
      modified: saved.modificationTime ?? 0,
    });
    // The service's metadata is cleaner than most files' tags.
    const track: Track = {
      ...read,
      title: t.title,
      artist: t.artist,
      album: t.album,
      year: read.year ?? t.year,
      trackNo: read.trackNo ?? t.trackNo,
      duration: read.duration || t.duration,
      artwork: read.artwork ?? (await coverFor(t)),
      origin: { ...t.origin, key: t.key },
    };
    useLibrary.getState().upsertTracks([track]);
    setItem(t.key, { status: 'done', trackId: track.id });
  } catch (e) {
    try {
      if (file.exists) file.delete();
    } catch {
      // nothing to clean up
    }
    setItem(t.key, { status: 'error', message: (e as Error).message ?? 'Error de red' });
  } finally {
    running--;
    pump();
  }
}

function pump() {
  while (running < PARALLEL && queue.length) void run(queue.shift()!);
  if (!running && !queue.length) {
    const done = Object.values(useDownloads.getState().items).filter((s) => s.status === 'done').length;
    if (done) useUI.getState().showToast('Descargas listas en tu biblioteca');
  }
}

/** Queues songs for download; ones already queued, running or done are skipped. */
export function download(tracks: CatalogTrack[]) {
  const items = useDownloads.getState().items;
  for (const t of tracks) {
    const cur = items[t.key];
    if (cur && cur.status !== 'error') continue;
    setItem(t.key, { status: 'queued' });
    queue.push(t);
  }
  pump();
}
