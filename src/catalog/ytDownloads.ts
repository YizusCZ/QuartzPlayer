/**
 * Downloads YouTube songs into Documents/Music/YouTube.
 *
 * Flow:
 *  1. Resolve the audio stream URL through the native YouTube module (with quality preference).
 *  2. Resolve rich metadata (accurate album, clean artist, clean title, high-res cover).
 *  3. Download the audio file (Opus in .opus or AAC in .m4a).
 *  4. Read the file as an imported track and enter it into the library
 *     with accurate metadata and artwork.
 *
 * Quality preference is read from `useSettings().ytDownloadQuality`:
 *  - 'best'   → highest bitrate available (typically Opus ~256 kbps, itag 774)
 *  - 'high'   → Opus ~160 kbps (itag 251)
 *  - 'normal' → AAC 128 kbps  (itag 140) — smallest file size
 */
import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { hash } from '@/library/bytes';
import { musicDir } from '@/library/scanner';
import type { Track } from '@/library/types';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { persistStorage } from '@/store/storage';
import { useUI } from '@/store/ui';
import { YouTubeModule, type YtStream } from '../../modules/youtube';
import { cleanArtistName, cleanSongTitle, fetchSongDetails, hiRes } from '@/youtube/music';

/* ───────── state ───────── */

const PARALLEL = 3;

export type YtDownloadState = {
  status: 'queued' | 'resolving' | 'downloading' | 'done' | 'error';
  progress?: number;
  trackId?: string;
  message?: string;
  title: string;
  artist: string;
  thumbnail?: string;
  startedAt?: number;
};

type YtDownloadStore = {
  /** In-memory state of active and recent download attempts. */
  items: Record<string, YtDownloadState>;
  /** Persisted map of downloaded videoId -> trackId. */
  downloaded: Record<string, string>;
  setItem: (key: string, state: YtDownloadState | null) => void;
  markDownloaded: (
    videoId: string,
    trackId: string,
    meta: { title: string; artist: string; thumbnail?: string },
  ) => void;
  removeDownloaded: (videoId: string) => void;
  clearCompleted: () => void;
};

export const useYtDownloads = create<YtDownloadStore>()(
  persist(
    (set) => ({
      items: {},
      downloaded: {},
      setItem: (key, state) =>
        set((s) => {
          const items = { ...s.items };
          if (state) items[key] = state;
          else delete items[key];
          return { items };
        }),
      markDownloaded: (videoId, trackId, meta) =>
        set((s) => ({
          downloaded: { ...s.downloaded, [videoId]: trackId },
          items: {
            ...s.items,
            [videoId]: {
              status: 'done',
              trackId,
              title: meta.title,
              artist: meta.artist,
              thumbnail: meta.thumbnail,
              progress: 1,
            },
          },
        })),
      removeDownloaded: (videoId) =>
        set((s) => {
          const downloaded = { ...s.downloaded };
          delete downloaded[videoId];
          const items = { ...s.items };
          delete items[videoId];
          return { downloaded, items };
        }),
      clearCompleted: () =>
        set((s) => {
          const items: Record<string, YtDownloadState> = {};
          for (const [k, v] of Object.entries(s.items)) {
            if (v.status !== 'done' && v.status !== 'error') items[k] = v;
          }
          return { items };
        }),
    }),
    {
      name: 'quartz.yt-downloads',
      storage: persistStorage(),
      partialize: (s) => ({ downloaded: s.downloaded }) as YtDownloadStore,
    },
  ),
);

const setItem = (key: string, state: YtDownloadState | null) => useYtDownloads.getState().setItem(key, state);

/* ───────── helpers ───────── */

function ytDir(): Directory {
  const dir = new Directory(musicDir(), 'YouTube');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

// Also strips []{}#%^` and friends: expo-file-system parses a file's URI with
// the strict java.net.URI, which throws on those ("Illegal character in path").
const safe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|[\]{}#%^`\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Canción';

function target(title: string, artist: string, videoId: string, ext: string): File {
  // Parentheses (not brackets) around the id: java.net.URI allows ( ) in a path.
  const base = `${safe(artist)} - ${safe(title)} (${videoId})`;
  let file = new File(ytDir(), `${base}.${ext}`);
  for (let n = 2; file.exists; n++) file = new File(ytDir(), `${base} (${n}).${ext}`);
  return file;
}

/** Download and cache the thumbnail into the standard artwork cache. */
async function downloadCover(videoId: string, thumbnail?: string): Promise<string | undefined> {
  if (!thumbnail) return undefined;
  try {
    const dir = new Directory(Paths.cache, 'artwork');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${hash(videoId)}.jpg`);
    if (file.exists) return file.uri;
    const res = await File.downloadFileAsync(thumbnail, file);
    return res.uri;
  } catch {
    return thumbnail;
  }
}

/** Pick file extension from the resolved stream. */
function extFromStream(info: YtStream): string {
  if (
    /opus/i.test(info.codec ?? '') ||
    info.mimeType?.includes('webm') ||
    [774, 251, 250, 249].includes(info.itag ?? 0)
  )
    return 'opus';
  return 'm4a';
}

/** Pick the right stream quality based on user settings. */
function streamQuality(): 'best' | 'high' | 'normal' {
  return useSettings.getState().ytDownloadQuality ?? 'best';
}

/* ───────── queue ───────── */

export type YtDownloadItem = {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail?: string;
  duration?: number;
};

const queue: YtDownloadItem[] = [];
const CANCELLED = 'cancelled';
const cancelled = new Set<string>();
let running = 0;
let leftoversCleared = false;

/** Half-saved files from a run the app did not get to finish. */
function clearLeftovers() {
  if (leftoversCleared) return;
  leftoversCleared = true;
  try {
    for (const entry of ytDir().list()) if (entry.name.endsWith('.part')) entry.delete();
  } catch {
    // nothing to clean up
  }
}

async function run(item: YtDownloadItem) {
  running++;
  const key = item.videoId;
  setItem(key, {
    status: 'resolving',
    title: item.title,
    artist: item.artist,
    thumbnail: item.thumbnail,
    startedAt: Date.now(),
  });

  try {
    // 1. Stream URL, metadata and cover at once: none needs the others to start.
    const startedAt = Date.now();
    const needsDetails = !item.album || item.album === item.title || item.album === 'YouTube Music' || !item.artist;
    const detailsP = needsDetails ? fetchSongDetails(key) : Promise.resolve(null);
    const coverP = detailsP.then((d) => {
      const url = hiRes(d?.thumbnail || item.thumbnail);
      return url ? downloadCover(key, url).then((uri) => ({ url, uri })) : undefined;
    });
    const info = await YouTubeModule.resolve(key, streamQuality());
    const details = await detailsP;
    const resolvedMs = Date.now() - startedAt;
    if (cancelled.has(key)) throw new Error(CANCELLED);
    const ext = extFromStream(info);

    const title = cleanSongTitle(details?.title || item.title || info.title) || item.title;
    const artist =
      cleanArtistName(item.artist || details?.artist || info.artist || 'Artista desconocido') || 'Artista desconocido';
    const album =
      (item.album && item.album !== item.title && item.album !== 'YouTube Music' ? item.album : details?.album) ||
      `${artist} - Single`;

    clearLeftovers();
    const file = target(title, artist, key, ext);

    // 2. The audio file
    const base = { status: 'downloading' as const, title, artist, thumbnail: item.thumbnail, startedAt };
    setItem(key, { ...base, progress: 0 });
    let shown = 0;
    const transfer = await YouTubeModule.download(key, info.url, file.uri, (written, total) => {
      const progress = total > 0 ? Math.min(1, written / total) : 0;
      // Every row and badge listening re-renders on a change: whole percents are enough.
      if (progress - shown < 0.01 || cancelled.has(key)) return;
      shown = progress;
      setItem(key, { ...base, progress });
    });
    const saved = new File(file.uri);
    console.log(`[yt-download] ${key}: url ${resolvedMs} ms, archivo ${transfer.size} B en ${transfer.ms} ms`);

    // 3. The cover (usually in already; only a missing one falls back to the stream's)
    const cover = await coverP;
    const coverUrl = cover?.url ?? hiRes(info.thumbnail);
    const artwork = cover?.uri ?? (await downloadCover(key, coverUrl));

    // 4. Build the track
    const codec = ext === 'opus' ? 'OPUS' : 'AAC';
    const kbps = info.bitrate > 0 ? Math.round(info.bitrate / 1000) : undefined;
    const track: Track = {
      id: `f:${hash(saved.uri)}`,
      uri: saved.uri,
      filename: saved.name,
      folder: ytDir().uri.replace(/^file:\/\//, ''),
      title,
      artist,
      album,
      duration: details?.duration || info.duration || item.duration || 0,
      size: saved.size,
      format: {
        codec,
        bitrate: kbps,
        sampleRate: codec === 'OPUS' ? 48000 : 44100,
        channels: 2,
      },
      artwork: artwork || coverUrl,
      addedAt: Date.now(),
      mtime: saved.modificationTime ?? Date.now(),
      source: 'imported',
    };

    useLibrary.getState().upsertTracks([track]);
    useLibrary.setState({ lastScan: Date.now() });
    useYtDownloads.getState().markDownloaded(key, track.id, { title, artist, thumbnail: artwork || coverUrl });

    // Update active stream track in memory if it was playing
    useLibrary.getState().patchTrack(`yt:${key}`, {
      title,
      artist,
      album,
      artwork: artwork || coverUrl,
    });
  } catch (e) {
    if (cancelled.has(key) || (e as Error)?.message?.includes(CANCELLED)) return;
    // Surfaced to logcat so a failed save can be diagnosed over adb.
    console.warn('[yt-download] fallo al guardar', key, (e as Error)?.message, e);
    setItem(key, {
      status: 'error',
      message: (e as Error).message ?? 'Error de red',
      title: item.title,
      artist: item.artist,
      thumbnail: item.thumbnail,
    });
  } finally {
    cancelled.delete(key);
    running--;
    pump();
  }
}

function pump() {
  while (running < PARALLEL && queue.length) void run(queue.shift()!);
  if (!running && !queue.length) {
    const done = Object.values(useYtDownloads.getState().items).filter((s) => s.status === 'done').length;
    if (done) {
      useUI
        .getState()
        .showToast(done === 1 ? 'Guardado en tu biblioteca local' : 'Canciones guardadas en tu biblioteca local');
    }
  }
}

/** Queues songs for saving to local library; ones already queued, running or done are skipped. */
export function downloadYt(items: YtDownloadItem[]) {
  const existing = useYtDownloads.getState().items;
  let added = 0;
  for (const item of items) {
    if (ytInLibrary(item.videoId)) continue;
    const cur = existing[item.videoId];
    if (cur && cur.status !== 'error') continue;
    setItem(item.videoId, {
      status: 'queued',
      title: item.title,
      artist: item.artist,
      thumbnail: item.thumbnail,
    });
    queue.push(item);
    added++;
  }
  pump();
  return added;
}

/** Saved songs by video id, read from the file names: rebuilt only when the library changes. */
let index: { tracks: Record<string, Track>; ids: Map<string, string> } | null = null;
function savedIds(tracks: Record<string, Track>) {
  if (index?.tracks === tracks) return index.ids;
  const ids = new Map<string, string>();
  for (const t of Object.values(tracks)) {
    // "Artist - Title (id).opus", or […] in older files.
    for (const m of t.filename.matchAll(/[[(]([\w-]{11})[\])]/g)) ids.set(m[1], t.id);
  }
  index = { tracks, ids };
  return ids;
}

const lookup = (tracks: Record<string, Track>, downloaded: Record<string, string>, videoId: string) => {
  const trackId = downloaded[videoId];
  return trackId && tracks[trackId] ? trackId : savedIds(tracks).get(videoId);
};

/** Check if a YouTube video has already been saved to the library. */
export function ytInLibrary(videoId: string): string | undefined {
  return lookup(useLibrary.getState().tracks, useYtDownloads.getState().downloaded, videoId);
}

/** The same, for a component: re-renders only when this one song's answer changes. */
export function useYtInLibrary(videoId: string): boolean {
  const downloaded = useYtDownloads((s) => s.downloaded);
  return useLibrary((s) => !!lookup(s.tracks, downloaded, videoId));
}

/** Cancels a queued or active download. */
export function cancelYtDownload(videoId: string) {
  // If in queue, remove it
  const idx = queue.findIndex((i) => i.videoId === videoId);
  if (idx !== -1) queue.splice(idx, 1);

  // If running, stop it where it is; run() cleans up without reporting an error.
  else if (useYtDownloads.getState().items[videoId]) {
    cancelled.add(videoId);
    YouTubeModule.cancelDownload(videoId);
  }

  setItem(videoId, null);
}

/** Deletes a downloaded YouTube song from the device and library. */
export function deleteDownloadedTrack(videoId: string): boolean {
  const trackId = ytInLibrary(videoId);
  const { tracks, removeTrack } = useLibrary.getState();
  const track = trackId ? tracks[trackId] : undefined;

  if (track) {
    try {
      new File(track.uri).delete();
    } catch {
      // already gone
    }
    removeTrack(track.id);
  }

  // Also clean up any file in YouTube directory matching this videoId
  try {
    const dir = new Directory(musicDir(), 'YouTube');
    if (dir.exists) {
      for (const entry of dir.list()) {
        if (entry.name.includes(videoId)) {
          entry.delete();
        }
      }
    }
  } catch {}

  useYtDownloads.getState().removeDownloaded(videoId);
  useLibrary.setState({ lastScan: Date.now() });
  return true;
}

/** Deletes multiple downloaded YouTube songs from the device and library. */
export function deleteDownloadedTracks(videoIds: string[]): number {
  let count = 0;
  for (const id of videoIds) {
    if (deleteDownloadedTrack(id)) count++;
  }
  return count;
}

/**
 * Asks in the app's confirmation dialog, then removes saved songs from the
 * device and the library. `title` names the song (or the album/list for several).
 */
export function confirmDeleteDownloads(videoIds: string[], { title, artwork }: { title: string; artwork?: string }) {
  const one = videoIds.length === 1;
  useUI.getState().askConfirm({
    icon: 'trash-can-outline',
    artwork,
    destructive: true,
    confirmLabel: 'Eliminar',
    title: one ? 'Quitar de tu biblioteca' : `Quitar ${videoIds.length} canciones`,
    message: one
      ? `Se borrará el archivo de “${title}” de este teléfono. Podrás seguir escuchándola en streaming.`
      : `Se borrarán de este teléfono las canciones guardadas de “${title}”. Podrás seguir escuchándolas en streaming.`,
    onConfirm: () => {
      const n = deleteDownloadedTracks(videoIds);
      useUI.getState().showToast(n === 1 ? 'Quitada de tu biblioteca' : `${n} canciones quitadas de tu biblioteca`);
    },
  });
}
