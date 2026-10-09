import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from './storage';

/** Apple Music motion artwork: square cover loop and the tall, full-screen one. */
export type MotionArt = { square?: string; tall?: string };

type Media = {
  /** Your own video per track id, shown by the "Vídeo" visualizer. */
  trackVideos: Record<string, string>;
  /** Your own video for every track that has none of its own. */
  globalVideo: string | null;
  /** Motion artwork lookups by album key; null means "looked, nothing found". */
  motion: Record<string, { art: MotionArt | null; at: number }>;
  setTrackVideo: (id: string, uri: string | null) => void;
  setGlobalVideo: (uri: string | null) => void;
  setMotion: (key: string, art: MotionArt | null) => void;
  clearMotion: () => void;
};

export const useMedia = create<Media>()(
  persist(
    (set) => ({
      trackVideos: {},
      globalVideo: null,
      motion: {},
      setTrackVideo: (id, uri) =>
        set((s) => {
          const trackVideos = { ...s.trackVideos };
          if (uri) trackVideos[id] = uri;
          else delete trackVideos[id];
          return { trackVideos };
        }),
      setGlobalVideo: (globalVideo) => set({ globalVideo }),
      setMotion: (key, art) => set((s) => ({ motion: { ...s.motion, [key]: { art, at: Date.now() } } })),
      clearMotion: () => set({ motion: {} }),
    }),
    { name: 'quartz.media', storage: persistStorage() },
  ),
);
