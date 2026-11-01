/**
 * Reads a public playlist or album from another service: only its song list
 * (title, artist, length), the same thing anyone sees on the web page. No
 * login, no audio: the songs are then matched to your library or YouTube
 * Music (src/catalog/playlistImport.ts).
 *
 *  - Spotify: the public embed page (up to 100 songs, Spotify's own limit there).
 *  - Apple Music: the public web page.
 *  - Deezer: its public API.
 *  - A pasted list, one "Artista - Canción" per line, for anything else.
 *
 * YouTube and YouTube Music links don't need matching: they are read straight
 * through src/youtube/music.ts.
 */

export type ImportPlatform = 'spotify' | 'apple' | 'deezer' | 'youtube' | 'text';

export type SourceTrack = { title: string; artist: string; album?: string; duration?: number; videoId?: string };

export type SourceList = {
  platform: ImportPlatform;
  name: string;
  cover?: string;
  tracks: SourceTrack[];
  /** The service only shows the first part of a longer list. */
  capped?: boolean;
};

export type ImportLink =
  | { platform: 'spotify' | 'deezer'; kind: 'playlist' | 'album'; id: string }
  | { platform: 'apple'; kind: 'playlist' | 'album'; url: string }
  | { platform: 'youtube'; listId: string }
  | { platform: 'short'; url: string };

export const PLATFORM_NAMES: Record<ImportPlatform, string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
  deezer: 'Deezer',
  youtube: 'YouTube',
  text: 'Lista pegada',
};

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36',
  'Accept-Language': 'es',
};

/** Recognises a share link from any supported service (with or without tracking parameters). */
export function detectLink(input: string): ImportLink | null {
  const raw = input.trim();
  const uri = /^spotify:(playlist|album):([A-Za-z0-9]+)/.exec(raw);
  if (uri) return { platform: 'spotify', kind: uri[1] as 'playlist' | 'album', id: uri[2] };
  const urlText = /https?:\/\/\S+/.exec(raw)?.[0];
  if (!urlText) return null;
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const path = url.pathname;
  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const m = /\/(playlist|album)\/([A-Za-z0-9]+)/.exec(path);
    return m ? { platform: 'spotify', kind: m[1] as 'playlist' | 'album', id: m[2] } : null;
  }
  if (host === 'deezer.com') {
    const m = /\/(playlist|album)\/(\d+)/.exec(path);
    return m ? { platform: 'deezer', kind: m[1] as 'playlist' | 'album', id: m[2] } : null;
  }
  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    const m = /\/(playlist|album)\//.exec(path);
    return m ? { platform: 'apple', kind: m[1] as 'playlist' | 'album', url: `https://music.apple.com${path}` } : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
    const list = url.searchParams.get('list');
    return list ? { platform: 'youtube', listId: list } : null;
  }
  if (host === 'spotify.link' || host === 'link.deezer.com' || host === 'deezer.page.link')
    return { platform: 'short', url: urlText };
  return null;
}

/** Short share links (spotify.link, link.deezer.com) point to the full one. */
export async function resolveShort(url: string, signal?: AbortSignal): Promise<ImportLink | null> {
  let html = '';
  try {
    const res = await fetch(url, { headers: UA, signal });
    const direct = detectLink(res.url);
    if (direct && direct.platform !== 'short') return direct;
    html = await res.text();
  } catch {
    if (signal?.aborted) throw new Error('cancelado');
    return null;
  }
  for (const m of html.matchAll(/https?:\/\/(?:open\.spotify\.com|(?:www\.)?deezer\.com)\/[^"'\s<>]+/g)) {
    const link = detectLink(m[0]);
    if (link && link.platform !== 'short') return link;
  }
  return null;
}

async function page(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { headers: UA, signal });
  if (res.status === 404) throw new Error('No se encontró la lista. ¿Es pública?');
  if (!res.ok) throw new Error(`El servicio respondió ${res.status}`);
  return res.text();
}

/* ───────── Spotify ───────── */

export async function fromSpotify(kind: 'playlist' | 'album', id: string, signal?: AbortSignal): Promise<SourceList> {
  const html = await page(`https://open.spotify.com/embed/${kind}/${id}`, signal);
  const data = /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s.exec(html)?.[1];
  const entity = data ? JSON.parse(data)?.props?.pageProps?.state?.data?.entity : null;
  if (!entity?.trackList) throw new Error('Spotify no mostró esta lista. ¿Es pública?');
  const tracks: SourceTrack[] = (entity.trackList as { title?: string; subtitle?: string; duration?: number }[])
    .filter((t) => t.title)
    .map((t) => ({
      title: t.title as string,
      artist: (t.subtitle ?? '').replace(/ /g, ' '),
      duration: t.duration ? Math.round(t.duration / 1000) : undefined,
    }));
  const sources = (entity.coverArt?.sources ?? entity.visualIdentity?.image ?? []) as {
    url?: string;
    width?: number;
  }[];
  const cover = [...sources].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
  return {
    platform: 'spotify',
    name: entity.name ?? entity.title ?? 'Lista de Spotify',
    cover,
    tracks,
    capped: kind === 'playlist' && tracks.length >= 100,
  };
}

/* ───────── Apple Music ───────── */

type Json = Record<string, any>;

function findFirst(node: unknown, test: (n: Json) => boolean, depth = 0): Json | undefined {
  if (!node || typeof node !== 'object' || depth > 30) return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findFirst(n, test, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (test(node as Json)) return node as Json;
  for (const v of Object.values(node as Json)) {
    const hit = findFirst(v, test, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

const appleArt = (a: Json | undefined) =>
  (a?.dictionary?.url as string | undefined)?.replace('{w}', '600').replace('{h}', '600').replace('{f}', 'jpg');

export async function fromApple(url: string, signal?: AbortSignal): Promise<SourceList> {
  const html = await page(url, signal);
  const data = /<script type="application\/json" id="serialized-server-data">(.+?)<\/script>/s.exec(html)?.[1];
  if (!data) throw new Error('Apple Music no mostró esta lista. ¿Es pública?');
  const json = JSON.parse(data) as Json;
  const list = findFirst(json, (n) => n.itemKind === 'trackLockup' && Array.isArray(n.items));
  const header = findFirst(json, (n) => n.itemKind === 'containerDetailHeaderLockup')?.items?.[0] as Json | undefined;
  const tracks: SourceTrack[] = ((list?.items ?? []) as Json[])
    .filter((t) => t.title)
    .map((t) => ({
      title: t.title as string,
      artist:
        (t.artistName as string | undefined) ??
        ((t.subtitleLinks as Json[] | undefined)?.map((l) => l.title).join(', ') || ''),
      album: (t.tertiaryLinks as Json[] | undefined)?.[0]?.title as string | undefined,
      duration: t.duration ? Math.round((t.duration as number) / 1000) : undefined,
    }));
  if (!tracks.length) throw new Error('Esta lista de Apple Music está vacía o no es pública');
  const albumArtist = (header?.subtitleLinks as Json[] | undefined)?.[0]?.title as string | undefined;
  return {
    platform: 'apple',
    name: (header?.title as string | undefined) ?? 'Lista de Apple Music',
    cover: appleArt(header?.artwork),
    // Album pages repeat the album's artist on every song; keep it if a song lacks one.
    tracks: albumArtist ? tracks.map((t) => ({ ...t, artist: t.artist || albumArtist })) : tracks,
    capped: tracks.length >= 100 && /\/playlist\//.test(url),
  };
}

/* ───────── Deezer ───────── */

type DeezerTrack = { title?: string; duration?: number; artist?: { name?: string }; album?: { title?: string } };

export async function fromDeezer(kind: 'playlist' | 'album', id: string, signal?: AbortSignal): Promise<SourceList> {
  const info = (await (await fetch(`https://api.deezer.com/${kind}/${id}`, { signal })).json()) as Json;
  if (info.error) throw new Error('Deezer no encontró esta lista. ¿Es pública?');
  const tracks: SourceTrack[] = [];
  let next: string | undefined = `https://api.deezer.com/${kind}/${id}/tracks?limit=500`;
  for (let i = 0; next && i < 10; i++) {
    const res = (await (await fetch(next, { signal })).json()) as { data?: DeezerTrack[]; next?: string };
    for (const t of res.data ?? [])
      if (t.title)
        tracks.push({
          title: t.title,
          artist: t.artist?.name ?? '',
          album: t.album?.title ?? (kind === 'album' ? (info.title as string) : undefined),
          duration: t.duration,
        });
    next = res.next;
  }
  return {
    platform: 'deezer',
    name: (info.title as string | undefined) ?? 'Lista de Deezer',
    cover: (info.picture_xl ?? info.cover_xl) as string | undefined,
    tracks,
  };
}

/* ───────── pasted text ───────── */

/** One song per line: "Artista - Canción" (also "–", "—" or "by"); numbering and durations are ignored. */
export function fromText(text: string, name: string): SourceList {
  const tracks: SourceTrack[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(\d+[.)-]?|[-*•])\s+/, '')
      .replace(/\s+\(?\d{1,2}:\d{2}\)?\s*$/, '')
      .trim();
    if (!line) continue;
    const by = /^(.+?)\s+by\s+(.+)$/i.exec(line);
    if (by) {
      tracks.push({ title: by[1], artist: by[2] });
      continue;
    }
    const parts = line.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) tracks.push({ artist: parts[0], title: parts.slice(1).join(' - ') });
    else tracks.push({ title: line, artist: '' });
  }
  return { platform: 'text', name, tracks };
}
