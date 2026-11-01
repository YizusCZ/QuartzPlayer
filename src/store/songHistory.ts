import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from './storage';

/** Most songs remembered; the oldest are forgotten first. */
const MAX = 2500;

type SongHistory = {
  /** When each YouTube song last played in a game or a room (video id → ms). */
  heard: Record<string, number>;
  note: (videoId: string) => void;
};

export const useSongHistory = create<SongHistory>()(
  persist(
    (set) => ({
      heard: {},
      note: (videoId) =>
        set((s) => {
          const heard = { ...s.heard, [videoId]: Date.now() };
          const ids = Object.keys(heard);
          if (ids.length > MAX) {
            ids.sort((a, b) => heard[a] - heard[b]);
            for (const id of ids.slice(0, ids.length - MAX)) delete heard[id];
          }
          return { heard };
        }),
    }),
    { name: 'quartz.song-history', storage: persistStorage() },
  ),
);
