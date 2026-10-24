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
  /** Streamed songs (YouTube) you played, queued, liked or listed: kept apart from your files. */
  remote: Record<string, Track>;
  favorites: Record<string, true>;
  plays: Record<string, PlayStat>;
  playlists: Playlist[];
  /** Files seen but not kept (short clips, ignored folders), by id → mtime, so they are not re-read. */
  skipped: Record<string, number>;
  lastScan: number | null;

  setLibrary: (tracks: Record<string, Track>, skipped: Record<string, number>) => void;
  upsertTracks: (tracks: Track[]) => void;
  addRemote: (tracks: Track[]) => void;
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
  /** Your own cover for some songs (an album, say); null restores the original. */
  setCustomArtwork: (ids: string[], uri: string | null) => void;
};

/** A track from your files or a streamed one, by id. */
export const trackById = (s: Pick<Library, 'tracks' | 'remote'>, id: string | undefined): Track | undefined =>
  id ? (s.tracks[id] ?? s.remote?.[id]) : undefined;

const REMOTE_MAX = 1500;

/** Keeps the streamed-song cache bounded, never dropping ones you liked or listed. */
function pruneRemote(remote: Record<string, Track>, s: Pick<Library, 'favorites' | 'playlists'>) {
  const ids = Object.keys(remote);
  if (ids.length <= REMOTE_MAX) return remote;
  const keep = new Set([...Object.keys(s.favorites), ...s.playlists.flatMap((p) => p.trackIds)]);
  const drop = ids
    .filter((id) => !keep.has(id))
    .sort((a, b) => remote[a].addedAt - remote[b].addedAt)
    .slice(0, ids.length - REMOTE_MAX);
  const next = { ...remote };
  for (const id of drop) delete next[id];
  return next;
}

export const useLibrary = create<Library>()(
  persist(
    (set) => ({
      tracks: {},
      remote: {},
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
      addRemote: (list) =>
        set((s) => {
          const remote = { ...s.remote };
          for (const t of list) remote[t.id] = { ...remote[t.id], ...t };
          return { remote: pruneRemote(remote, s) };
        }),
      patchTrack: (id, patch) =>
        set((s) =>
          s.tracks[id]
            ? { tracks: { ...s.tracks, [id]: { ...s.tracks[id], ...patch } } }
            : s.remote[id]
              ? { remote: { ...s.remote, [id]: { ...s.remote[id], ...patch } } }
              : s,
        ),
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
      setCustomArtwork: (ids, uri) =>
        set((s) => {
          const tracks = { ...s.tracks };
          const remote = { ...s.remote };
          for (const id of ids) {
            const map = tracks[id] ? tracks : remote[id] ? remote : null;
            const t = map?.[id];
            if (!map || !t) continue;
            const original = t.customArtwork ? t.originalArtwork : t.artwork;
            map[id] = uri
              ? { ...t, customArtwork: uri, originalArtwork: original, artwork: uri }
              : { ...t, customArtwork: undefined, originalArtwork: undefined, artwork: original };
          }
          return { tracks, remote };
        }),
    }),
    {
      name: 'quartz.library',
      storage: persistStorage(),
    },
  ),
);
