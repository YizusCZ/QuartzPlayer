import { isHiRes, type Track } from './types';

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
export const byText = (a: string, b: string) => collator.compare(a, b);

export type SortKey = 'title' | 'artist' | 'album' | 'added' | 'quality';

export function sortTracks(list: Track[], key: SortKey): Track[] {
  const arr = [...list];
  switch (key) {
    case 'artist':
      return arr.sort((a, b) => byText(a.artist, b.artist) || byText(a.album, b.album) || albumOrder(a, b));
    case 'album':
      return arr.sort((a, b) => byText(a.album, b.album) || albumOrder(a, b));
    case 'added':
      return arr.sort((a, b) => b.addedAt - a.addedAt);
    case 'quality':
      return arr.sort(
        (a, b) =>
          (b.format.sampleRate ?? 0) * (b.format.bitDepth ?? 1) -
            (a.format.sampleRate ?? 0) * (a.format.bitDepth ?? 1) || byText(a.title, b.title),
      );
    default:
      return arr.sort((a, b) => byText(a.title, b.title));
  }
}

export function albumOrder(a: Track, b: Track): number {
  return (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 999) - (b.trackNo ?? 999) || byText(a.title, b.title);
}

export type Group = {
  key: string;
  title: string;
  subtitle: string;
  artwork?: string;
  tracks: Track[];
  hiRes: boolean;
};

export type GroupKind = 'albums' | 'artists' | 'genres' | 'folders';

export function groupTracks(list: Track[], kind: GroupKind): Group[] {
  const map = new Map<string, Track[]>();
  for (const t of list) {
    const key =
      kind === 'albums'
        ? `${t.albumArtist ?? t.artist}\u0000${t.album}`
        : kind === 'artists'
          ? (t.albumArtist ?? t.artist)
          : kind === 'genres'
            ? t.genre || 'Sin género'
            : t.folder;
    const bucket = map.get(key);
    if (bucket) bucket.push(t);
    else map.set(key, [t]);
  }
  const groups: Group[] = [];
  for (const [key, tracks] of map) {
    tracks.sort(kind === 'artists' ? (a, b) => byText(a.album, b.album) || albumOrder(a, b) : albumOrder);
    const first = tracks[0];
    const albums = new Set(tracks.map((t) => t.album)).size;
    const n = `${tracks.length} ${tracks.length === 1 ? 'canción' : 'canciones'}`;
    groups.push({
      key,
      title: kind === 'albums' ? first.album : kind === 'folders' ? key.split('/').filter(Boolean).pop() || key : key,
      subtitle:
        kind === 'albums'
          ? [first.albumArtist ?? first.artist, first.year].filter(Boolean).join(' · ')
          : kind === 'artists'
            ? `${albums} ${albums === 1 ? 'álbum' : 'álbumes'} · ${n}`
            : n,
      artwork: tracks.find((t) => t.artwork)?.artwork,
      tracks,
      hiRes: tracks.some((t) => isHiRes(t.format)),
    });
  }
  return groups.sort((a, b) => byText(a.title, b.title));
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function searchTracks(list: Track[], query: string): Track[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return list.filter((t) => {
    const hay = fold(`${t.title} ${t.artist} ${t.album} ${t.albumArtist ?? ''} ${t.genre ?? ''}`);
    return terms.every((q) => hay.includes(q));
  });
}

export function totalDuration(list: Track[]): number {
  return list.reduce((a, t) => a + (t.duration || 0), 0);
}
