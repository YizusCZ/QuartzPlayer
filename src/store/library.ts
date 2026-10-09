import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from './storage';
import type { Track } from '@/library/types';
import type { CassetteSkinId } from '@/components/cassette/skins';

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  /** Your own image (file in Documents/covers). Without one, the playlist shows a cassette. */
  cover?: string;
  /** Cassette style for the default cover; picked from the id when unset. */
  skin?: CassetteSkinId;
};
export type PlayStat = { count: number; last: number };

type Library = {
  tracks: Record<string, Track>;
  favorites: Record<string, true>;
  plays: Record<string, PlayStat>;
  playlists: Playlist[];
  /** Files seen but not kept (short clips, ignored folders), by id → mtime, so they are not re-read. */
  skipped: Record<string, number>;
  lastScan: number | null;

  setLibrary: (tracks: Record<string, Track>, skipped: Record<string, number>) => void;
  upsertTracks: (tracks: Track[]) => void;
  removeTrack: (id: string) => void;
  patchTrack: (id: string, patch: Partial<Track>) => void;
  toggleFavorite: (id: string) => void;
  recordPlay: (id: string) => void;
  createPlaylist: (name: string, trackIds?: string[]) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, trackIds: string[]) => void;
  removeFromPlaylist: (id: string, index: number) => void;
  updatePlaylist: (id: string, patch: Partial<Pick<Playlist, 'cover' | 'skin'>>) => void;
};

export const useLibrary = create<Library>()(
  persist(
    (set) => ({
      tracks: {},
      favorites: {},
      plays: {},
      playlists: [],
      skipped: {},
      lastScan: null,

      setLibrary: (tracks, skipped) => set({ tracks, skipped, lastScan: Date.now() }),
      upsertTracks: (list) =>
        set((s) => ({ tracks: { ...s.tracks, ...Object.fromEntries(list.map((t) => [t.id, t])) } })),
      removeTrack: (id) =>
        set((s) => {
          const tracks = { ...s.tracks };
          delete tracks[id];
          const favorites = { ...s.favorites };
          delete favorites[id];
          return {
            tracks,
            favorites,
            playlists: s.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((t) => t !== id) })),
          };
        }),
      patchTrack: (id, patch) =>
        set((s) => (s.tracks[id] ? { tracks: { ...s.tracks, [id]: { ...s.tracks[id], ...patch } } } : s)),
      toggleFavorite: (id) =>
        set((s) => {
          const favorites = { ...s.favorites };
          if (favorites[id]) delete favorites[id];
          else favorites[id] = true;
          return { favorites };
        }),
      recordPlay: (id) =>
        set((s) => ({
          plays: { ...s.plays, [id]: { count: (s.plays[id]?.count ?? 0) + 1, last: Date.now() } },
        })),
      createPlaylist: (name, trackIds = []) => {
        const id = `pl_${Date.now().toString(36)}`;
        set((s) => ({ playlists: [...s.playlists, { id, name, trackIds, createdAt: Date.now() }] }));
        return id;
      },
      renamePlaylist: (id, name) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)) })),
      deletePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),
      addToPlaylist: (id, trackIds) =>
        set((s) => ({
          playlists: s.playlists.map((p) => (p.id === id ? { ...p, trackIds: [...p.trackIds, ...trackIds] } : p)),
        })),
      removeFromPlaylist: (id, index) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, trackIds: p.trackIds.filter((_, i) => i !== index) } : p,
          ),
        })),
      updatePlaylist: (id, patch) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
    }),
    {
      name: 'quartz.library',
      storage: persistStorage(),
    },
  ),
);
