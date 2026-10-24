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
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
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

const PARALLEL = 2;

export type YtDownloadState =
  | { status: 'queued' }
  | { status: 'resolving' }
  | { status: 'downloading'; progress: number }
  | { status: 'done'; trackId: string }
  | { status: 'error'; message: string };

type YtDownloadStore = {
  /** In-memory state of active and recent download attempts. */
  items: Record<string, YtDownloadState>;
  /** Persisted map of downloaded videoId -> trackId. */
  downloaded: Record<string, string>;
  setItem: (key: string, state: YtDownloadState | null) => void;
  markDownloaded: (videoId: string, trackId: string) => void;
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
      markDownloaded: (videoId, trackId) =>
        set((s) => ({
          downloaded: { ...s.downloaded, [videoId]: trackId },
          items: { ...s.items, [videoId]: { status: 'done', trackId } },
        })),
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

const safe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Canción';

function target(title: string, artist: string, videoId: string, ext: string): File {
  const base = `${safe(artist)} - ${safe(title)} [${videoId}]`;
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
  if (/opus/i.test(info.codec ?? '') || info.mimeType?.includes('webm') || [774, 251, 250, 249].includes(info.itag ?? 0))
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
let running = 0;

async function run(item: YtDownloadItem) {
  running++;
  const key = item.videoId;
  setItem(key, { status: 'resolving' });

  try {
    // 1. Resolve the audio stream URL with preferred quality
    const quality = streamQuality();
    const info = await YouTubeModule.resolve(key, quality);
    const ext = extFromStream(info);

    // 2. Fetch rich metadata (accurate album, clean artist, cover) if missing
    let details: { title?: string; artist?: string; album?: string; thumbnail?: string; duration?: number } | null = null;
    if (!item.album || item.album === item.title || item.album === 'YouTube Music' || !item.artist) {
      details = await fetchSongDetails(key);
    }

    const title = cleanSongTitle(details?.title || item.title || info.title) || item.title;
    const artist = cleanArtistName(item.artist || details?.artist || info.artist || 'Artista desconocido') || 'Artista desconocido';
    const album =
      (item.album && item.album !== item.title && item.album !== 'YouTube Music' ? item.album : details?.album) ||
      `${artist} - Single`;

    const file = target(title, artist, key, ext);

    // 3. Download the audio file
    setItem(key, { status: 'downloading', progress: 0 });
    const task = new DownloadTask(info.url, file, {
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : 0;
        if (total > 0) setItem(key, { status: 'downloading', progress: Math.min(1, bytesWritten / total) });
      },
    });
    const saved = await task.downloadAsync();
    if (!saved) throw new Error('Guardado cancelado');

    // 4. Download the high-res cover
    const coverUrl = hiRes(details?.thumbnail || item.thumbnail || info.thumbnail);
    const artwork = await downloadCover(key, coverUrl);

    // 5. Build the track
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
    useYtDownloads.getState().markDownloaded(key, track.id);

    // Update active stream track in memory if it was playing
    useLibrary.getState().patchTrack(`yt:${key}`, {
      title,
      artist,
      album,
      artwork: artwork || coverUrl,
    });
  } catch (e) {
    setItem(key, { status: 'error', message: (e as Error).message ?? 'Error de red' });
  } finally {
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
    setItem(item.videoId, { status: 'queued' });
    queue.push(item);
    added++;
  }
  pump();
  return added;
}

/** Check if a YouTube video has already been saved to the library. */
export function ytInLibrary(videoId: string): string | undefined {
  const { downloaded } = useYtDownloads.getState();
  const trackId = downloaded[videoId];
  const { tracks } = useLibrary.getState();
  if (trackId && tracks[trackId]) return trackId;

  // Check if any track has videoId in URI or filename
  for (const t of Object.values(tracks)) {
    if (t.uri.includes(videoId) || t.filename.includes(videoId)) return t.id;
  }
  return undefined;
}
