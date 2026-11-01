import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type YtStream = {
  url: string;
  mimeType?: string;
  codec?: string;
  bitrate: number;
  /** YouTube format id (251 = Opus ~160 kbps, 140 = AAC 128 kbps, 774 = Opus ~256 kbps). */
  itag?: number;
  title: string;
  artist?: string;
  duration: number;
  thumbnail?: string;
};

export type YtSong = {
  type: 'song';
  videoId: string;
  title: string;
  artist?: string;
  duration: number;
  thumbnail?: string;
};

export type YtPlaylistItem = {
  type: 'playlist';
  url: string;
  title: string;
  artist?: string;
  count: number;
  thumbnail?: string;
};

export type YtVideoStream = { url: string; width: number; height: number; duration: number };

type Native = {
  resolve(videoId: string): Promise<YtStream>;
  resolveAudio?(videoId: string, quality?: string): Promise<YtStream>;
  resolveVideo(videoId: string): Promise<YtVideoStream>;
  search(
    query: string,
    filter: 'music_songs' | 'music_playlists' | 'music_albums' | 'music_videos',
  ): Promise<(YtSong | YtPlaylistItem)[]>;
  playlist(url: string): Promise<{ title: string; artist?: string; thumbnail?: string; items: YtSong[] }>;
  download(id: string, url: string, uri: string): Promise<{ size: number; ms: number }>;
  cancelDownload(id: string): void;
  addListener(event: 'downloadProgress', fn: (e: DownloadProgress) => void): EventSubscription;
};

type DownloadProgress = { id: string; written: number; total: number };

const native = requireOptionalNativeModule<Native>('QuartzYouTube');

const progressFns = new Map<string, (written: number, total: number) => void>();
let progressSub: EventSubscription | undefined;

/** YouTube (NewPipeExtractor, Android). Streaming and caching/downloading. */
export const YouTubeModule = {
  available: !!native,
  resolve: (id: string, quality?: string) => {
    if (!native) return Promise.reject(new Error('YouTube no disponible'));
    if (quality && typeof native.resolveAudio === 'function') {
      return native.resolveAudio(id, quality);
    }
    return native.resolve(id);
  },
  resolveVideo: (id: string) => (native ? native.resolveVideo(id) : Promise.reject(new Error('YouTube no disponible'))),
  search: (q: string, filter: 'music_songs' | 'music_playlists' | 'music_albums' | 'music_videos' = 'music_songs') =>
    native ? native.search(q, filter) : Promise.resolve([]),
  playlist: (url: string) => (native ? native.playlist(url) : Promise.reject(new Error('YouTube no disponible'))),
  /** Saves a stream to `uri` in parallel byte ranges (see YouTubeModule.kt). */
  download: async (id: string, url: string, uri: string, onProgress: (written: number, total: number) => void) => {
    if (!native) throw new Error('YouTube no disponible');
    progressSub ??= native.addListener('downloadProgress', (e) => progressFns.get(e.id)?.(e.written, e.total));
    progressFns.set(id, onProgress);
    try {
      return await native.download(id, url, uri);
    } finally {
      progressFns.delete(id);
    }
  },
  cancelDownload: (id: string) => native?.cancelDownload(id),
};
