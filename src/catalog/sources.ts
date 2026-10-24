/**
 * "Música libre": legal sources of free music.
 *  - Jamendo: independent artists under Creative Commons, FLAC downloads
 *    through the official API (client id in .env).
 *  - Internet Archive: the Live Music Archive (concerts the artists allow to
 *    share) plus Creative Commons and public-domain audio. Files the archive
 *    marks private (stream-only) are never offered.
 */
import type { TrackOrigin } from '@/library/types';

export type CatalogTrack = {
  /** Unique across sources, e.g. "jamendo:1916608". */
  key: string;
  title: string;
  artist: string;
  album: string;
  year?: number;
  trackNo?: number;
  duration: number;
  artwork?: string;
  downloadUrl: string;
  /** File extension of the download, without the dot. */
  ext: 'flac' | 'mp3';
  /** Size in bytes when the service reports it. */
  size?: number;
  origin: TrackOrigin;
};

export type CatalogAlbum = {
  key: string;
  identifier: string;
  title: string;
  artist: string;
  year?: number;
  artwork: string;
  origin: TrackOrigin;
};

const JAMENDO_ID = process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID ?? '';
export const jamendoAvailable = !!JAMENDO_ID;

/** "http://creativecommons.org/licenses/by-sa/3.0/" → "CC BY-SA 3.0". */
export function licenseName(url: string | undefined): string {
  if (!url) return 'Licencia libre';
  if (/publicdomain\/zero/.test(url)) return 'CC0 · Dominio público';
  if (/publicdomain\/mark/.test(url)) return 'Dominio público';
  const m = /licenses\/([a-z-]+)\/([\d.]+)/i.exec(url);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : 'Licencia libre';
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/* ───────── Jamendo ───────── */

type JamendoTrack = {
  id: string;
  name: string;
  artist_name: string;
  album_name: string;
  position?: number;
  duration: number;
  image: string;
  audiodownload: string;
  audiodownload_allowed: boolean;
  license_ccurl: string;
  releasedate?: string;
  shareurl: string;
};

/** Songs matching `query`; with an empty query, this week's most popular. */
export async function searchJamendo(query: string, signal?: AbortSignal): Promise<CatalogTrack[]> {
  if (!JAMENDO_ID) return [];
  const params = new URLSearchParams({
    client_id: JAMENDO_ID,
    format: 'json',
    limit: '40',
    audiodlformat: 'flac',
    imagesize: '300',
    include: 'licenses',
  });
  if (query.trim()) params.set('search', query.trim());
  // Only the monthly ranking reliably returns downloadable tracks.
  else params.set('order', 'popularity_month');
  const { results } = await getJson<{ results: JamendoTrack[] }>(
    `https://api.jamendo.com/v3.0/tracks/?${params}`,
    signal,
  );
  return results
    .filter((t) => t.audiodownload_allowed && t.audiodownload)
    .map((t) => ({
      key: `jamendo:${t.id}`,
      title: t.name,
      artist: t.artist_name,
      album: t.album_name || t.name,
      year: t.releasedate ? Number(t.releasedate.slice(0, 4)) || undefined : undefined,
      trackNo: t.position,
      duration: t.duration,
      artwork: t.image || undefined,
      downloadUrl: t.audiodownload,
      ext: /\/flac\/?$/.test(t.audiodownload) ? 'flac' : 'mp3',
      origin: {
        service: 'jamendo',
        license: licenseName(t.license_ccurl),
        licenseUrl: t.license_ccurl,
        pageUrl: t.shareurl,
      },
    }));
}

/* ───────── Internet Archive ───────── */

type ArchiveDoc = {
  identifier: string;
  title?: string;
  creator?: string | string[];
  year?: number;
  licenseurl?: string;
};

/** Only what the archive says may be shared: the Live Music Archive, CC and public domain. */
const SHAREABLE = '(collection:etree OR licenseurl:*creativecommons* OR licenseurl:*publicdomain*)';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const escape = (q: string) => q.replace(/[\\()":^~*?[\]{}!]/g, ' ').trim();

/** Albums and concerts matching `query`. */
export async function searchArchive(query: string, signal?: AbortSignal): Promise<CatalogAlbum[]> {
  const q = escape(query);
  const what = q ? `(title:(${q}) OR creator:(${q}))` : 'collection:etree';
  const params = new URLSearchParams({
    // Live Music Archive concerts are mediatype "etree", everything else "audio".
    q: `${what} AND (mediatype:audio OR mediatype:etree) AND -collection:podcasts AND ${SHAREABLE}`,
    rows: '30',
    output: 'json',
  });
  for (const f of ['identifier', 'title', 'creator', 'year', 'licenseurl']) params.append('fl[]', f);
  params.append('sort[]', 'downloads desc');
  const { response } = await getJson<{ response: { docs: ArchiveDoc[] } }>(
    `https://archive.org/advancedsearch.php?${params}`,
    signal,
  );
  return response.docs.map((d) => ({
    key: `archive:${d.identifier}`,
    identifier: d.identifier,
    title: d.title ?? d.identifier,
    artist: one(d.creator) || 'Artista desconocido',
    year: d.year,
    artwork: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
    origin: {
      service: 'archive',
      license: d.licenseurl ? licenseName(d.licenseurl) : 'Live Music Archive',
      licenseUrl: d.licenseurl,
      pageUrl: `https://archive.org/details/${d.identifier}`,
    },
  }));
}

type ArchiveFile = {
  name: string;
  format?: string;
  title?: string;
  creator?: string;
  album?: string;
  track?: string;
  length?: string;
  size?: string;
  private?: string;
  source?: string;
};

const seconds = (len?: string) => {
  if (!len) return 0;
  if (/^\d+(\.\d+)?$/.test(len)) return Math.round(Number(len));
  const parts = len.split(':').map(Number);
  return parts.reduce((a, p) => a * 60 + (p || 0), 0);
};

/** The songs of an archive item, in FLAC when the item has it, otherwise MP3. */
export async function archiveTracks(album: CatalogAlbum, signal?: AbortSignal): Promise<CatalogTrack[]> {
  const { files = [] } = await getJson<{ files?: ArchiveFile[] }>(
    `https://archive.org/metadata/${encodeURIComponent(album.identifier)}`,
    signal,
  );
  // Stream-only (private) files are never offered for download.
  const open = files.filter((f) => f.private !== 'true');
  // Items often hold the same songs in several formats: keep only the best one.
  const byFormat = (re: RegExp) => open.filter((f) => re.test(f.format ?? ''));
  const hires = byFormat(/^24bit flac$/i);
  const flac = byFormat(/^flac$/i);
  const mp3 = byFormat(/mp3/i);
  const chosen = hires.length ? hires : flac.length ? flac : mp3;
  const ext: CatalogTrack['ext'] = chosen === mp3 ? 'mp3' : 'flac';
  return chosen
    .map((f) => ({
      key: `archive:${album.identifier}/${f.name}`,
      // Some tapers prefix every title with the resolution ("24-bit / 96 Khz - …").
      title: (f.title || f.name.replace(/\.[^.]+$/, '')).replace(/^\s*\d+-bit\s*\/\s*[\d.]+\s*khz\s*-\s*/i, ''),
      artist: f.creator || album.artist,
      album: f.album || album.title,
      year: album.year,
      trackNo: f.track ? parseInt(f.track, 10) || undefined : undefined,
      duration: seconds(f.length),
      artwork: album.artwork,
      downloadUrl: `https://archive.org/download/${encodeURIComponent(album.identifier)}/${f.name
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      ext,
      size: f.size ? Number(f.size) : undefined,
      origin: album.origin,
    }))
    .sort((a, b) => (a.trackNo ?? 999) - (b.trackNo ?? 999) || a.title.localeCompare(b.title));
}
