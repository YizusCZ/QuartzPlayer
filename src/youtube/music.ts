/**
 * YouTube Music browse (home, new releases, charts, moods & genres, playlist,
 * album, artist pages) through the public web client API. Audio streams are
 * resolved separately, natively (modules/youtube). Streaming only.
 */
import { YouTubeModule } from '../../modules/youtube';
import type { Track } from '@/library/types';

const ENDPOINT = 'https://music.youtube.com/youtubei/v1';
const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20260101.01.00', hl: 'es', gl: 'CO' };
const HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'https://music.youtube.com',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
};

export type YtSong = {
  kind: 'song';
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail?: string;
  duration?: number;
  /** Has an official / uploaded music video (not just the album art). */
  video?: boolean;
};
export type YtCollection = {
  kind: 'collection';
  browseId: string;
  params?: string;
  page: 'playlist' | 'album' | 'artist' | 'other';
  title: string;
  subtitle: string;
  thumbnail?: string;
};
export type YtVideo = { kind: 'video'; videoId: string; title: string; subtitle: string; thumbnail?: string };
export type YtNav = { kind: 'nav'; title: string; browseId: string; params?: string; color: string };
export type YtItem = YtSong | YtCollection | YtVideo | YtNav;

export type YtSection = { title: string; strapline?: string; items: YtItem[] };
export type YtChip = { title: string; browseId: string; params?: string };
export type YtPage = {
  header?: { title: string; subtitle?: string; thumbnail?: string };
  chips: YtChip[];
  sections: YtSection[];
  continuation?: string;
};

/** YouTube's JSON is deep and untyped. */
type Json = Record<string, any>;

/** Anonymous visitor id from the first answer; continuation tokens only work with it. */
let visitor: string | undefined;

async function post(path: string, body: object, signal?: AbortSignal): Promise<Json> {
  const res = await fetch(`${ENDPOINT}/${path}?prettyPrint=false`, {
    method: 'POST',
    headers: visitor ? { ...HEADERS, 'X-Goog-Visitor-Id': visitor } : HEADERS,
    body: JSON.stringify({ context: { client: { ...CLIENT, ...(visitor ? { visitorData: visitor } : {}) } }, ...body }),
    signal,
  });
  if (!res.ok) throw new Error(`YouTube Music respondió ${res.status}`);
  const json = (await res.json()) as Json;
  visitor ??= json.responseContext?.visitorData as string | undefined;
  return json;
}

/* ───────── parsing ───────── */

const text = (t: Json | undefined): string =>
  (t?.runs as Json[] | undefined)?.map((r) => r.text).join('') ?? (t?.simpleText as string | undefined) ?? '';

/** Largest thumbnail, re-requested at 544 px (YouTube serves any size). */
/**
 * Google's image hosts serve any size: ask for a sharp one instead of the
 * 60–120 px thumbnail search results come with. Video stills get their
 * highest-resolution frame.
 */
export function hiRes(url: string | undefined, px = 720): string | undefined {
  if (!url) return undefined;
  if (/googleusercontent\.com|ggpht\.com/.test(url))
    return url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`).replace(/=s\d+/, `=s${px}`);
  const vid = /i\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//.exec(url);
  if (vid) return `https://i.ytimg.com/vi/${vid[1]}/hqdefault.jpg`;
  return url;
}

/** Largest thumbnail, re-requested sharp. */
function thumb(node: Json | undefined): string | undefined {
  const list = findKey(node, 'thumbnails') as Json[] | undefined;
  // Shelves draw 150–260 dp: 400 px stays sharp and decodes far lighter than 720.
  return hiRes(list?.[list.length - 1]?.url as string | undefined, 400);
}

function findKey(node: unknown, key: string, depth = 0): unknown {
  if (!node || typeof node !== 'object' || depth > 12) return undefined;
  if (key in (node as Json)) return (node as Json)[key];
  for (const v of Object.values(node as Json)) {
    const hit = findKey(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const seconds = (s: string) => s.split(':').reduce((a, p) => a * 60 + (Number(p) || 0), 0);

const PAGE: Record<string, YtCollection['page']> = {
  MUSIC_PAGE_TYPE_PLAYLIST: 'playlist',
  MUSIC_PAGE_TYPE_ALBUM: 'album',
  MUSIC_PAGE_TYPE_AUDIOBOOK: 'album',
  MUSIC_PAGE_TYPE_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_USER_CHANNEL: 'artist',
};
const pageOf = (endpoint: Json | undefined): YtCollection['page'] =>
  PAGE[endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType as string] ??
  'other';

function responsive(r: Json): YtItem | null {
  const cols = (r.flexColumns as Json[] | undefined)?.map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text);
  const title = text(cols?.[0]);
  if (!title) return null;
  const runs = ((cols?.[1]?.runs as Json[] | undefined) ?? []).filter((x) => x.text !== ' • ' && x.text !== ' & ');
  const videoId =
    (r.playlistItemData?.videoId as string | undefined) ??
    (findKey(r.overlay, 'watchEndpoint') as Json | undefined)?.videoId ??
    (cols?.[0]?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId as string | undefined);
  if (videoId) {
    const type = (findKey(r.overlay, 'watchEndpointMusicConfig') as Json | undefined)?.musicVideoType as
      string | undefined;
    const artistRun = runs.find((x) => pageOf(x.navigationEndpoint?.browseEndpoint) === 'artist') ?? runs[0];
    const albumRun = runs.find((x) => pageOf(x.navigationEndpoint?.browseEndpoint) === 'album');
    const fixed = text((r.fixedColumns as Json[] | undefined)?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
    const isTime = (x: string) => /^\d+:\d{2}(:\d{2})?$/.test(x);
    // Lists carry the length in a fixed column; search results at the end of the subtitle.
    const timeRun = runs.findLast((x) => isTime(x.text as string))?.text as string | undefined;
    const dur = isTime(fixed) ? seconds(fixed) : timeRun ? seconds(timeRun) : undefined;
    return {
      kind: 'song',
      videoId,
      title,
      artist: (artistRun?.text as string | undefined) ?? '',
      album: albumRun?.text as string | undefined,
      thumbnail: thumb(r.thumbnail),
      duration: dur,
      video: !!type && type !== 'MUSIC_VIDEO_TYPE_ATV',
    };
  }
  const browse = r.navigationEndpoint?.browseEndpoint as Json | undefined;
  if (!browse?.browseId) return null;
  return {
    kind: 'collection',
    browseId: browse.browseId as string,
    params: browse.params as string | undefined,
    page: pageOf(browse),
    title,
    subtitle: text(cols?.[1]),
    thumbnail: thumb(r.thumbnail),
  };
}

function twoRow(r: Json): YtItem | null {
  const title = text(r.title);
  const subtitle = text(r.subtitle);
  const nav = r.navigationEndpoint as Json | undefined;
  if (nav?.watchEndpoint?.videoId)
    return {
      kind: 'video',
      videoId: nav.watchEndpoint.videoId as string,
      title,
      subtitle,
      thumbnail: thumb(r.thumbnailRenderer),
    };
  const browse = nav?.browseEndpoint as Json | undefined;
  if (!browse?.browseId) return null;
  return {
    kind: 'collection',
    browseId: browse.browseId as string,
    params: browse.params as string | undefined,
    page: pageOf(browse),
    title,
    subtitle,
    thumbnail: thumb(r.thumbnailRenderer),
  };
}

const argb = (n: number | undefined) => {
  if (n == null) return '#7B5CFF';
  const v = n >>> 0;
  return `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;
};

function navButton(r: Json): YtNav | null {
  const browse = r.clickCommand?.browseEndpoint as Json | undefined;
  if (!browse?.browseId) return null;
  return {
    kind: 'nav',
    title: text(r.buttonText),
    browseId: browse.browseId as string,
    params: browse.params as string | undefined,
    color: argb(r.solid?.leftStripeColor as number | undefined),
  };
}

function item(node: Json): YtItem | null {
  if (node.musicResponsiveListItemRenderer) return responsive(node.musicResponsiveListItemRenderer);
  if (node.musicTwoRowItemRenderer) return twoRow(node.musicTwoRowItemRenderer);
  if (node.musicNavigationButtonRenderer) return navButton(node.musicNavigationButtonRenderer);
  return null;
}

const SHELVES = [
  'musicCarouselShelfRenderer',
  'musicShelfRenderer',
  'musicPlaylistShelfRenderer',
  'gridRenderer',
  'musicImmersiveCarouselShelfRenderer',
];
const HEADERS_R = [
  'musicDetailHeaderRenderer',
  'musicResponsiveHeaderRenderer',
  'musicImmersiveHeaderRenderer',
  'musicVisualHeaderRenderer',
];

function shelfTitle(r: Json): { title: string; strapline?: string } {
  const h =
    r.header?.musicCarouselShelfBasicHeaderRenderer ??
    r.header?.gridHeaderRenderer ??
    r.header?.musicImmersiveCarouselShelfBasicHeaderRenderer;
  return { title: text(h?.title) || text(r.title), strapline: text(h?.strapline) || undefined };
}

/** Walks any browse response and collects its shelves, header, chips and continuation. */
function parse(root: Json): YtPage {
  const page: YtPage = { chips: [], sections: [] };
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const obj = node as Json;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (SHELVES.includes(key)) {
        const items = ((v.contents ?? v.items) as Json[] | undefined)?.map(item).filter(Boolean) as YtItem[];
        if (items?.length) page.sections.push({ ...shelfTitle(v), items });
        continue;
      }
      if (HEADERS_R.includes(key) && !page.header) {
        page.header = {
          title: text(v.title),
          subtitle: [text(v.subtitle), text(v.secondSubtitle), text(v.straplineTextOne)].filter(Boolean).join(' · '),
          thumbnail: thumb(v.thumbnail ?? v.foregroundThumbnail),
        };
      }
      if (key === 'chipCloudChipRenderer') {
        const browse = v.navigationEndpoint?.browseEndpoint as Json | undefined;
        if (browse?.browseId)
          page.chips.push({ title: text(v.text), browseId: browse.browseId, params: browse.params });
        continue;
      }
      if (key === 'nextContinuationData' && !page.continuation) page.continuation = v.continuation as string;
      walk(v, depth + 1);
    }
  };
  walk(root, 0);
  return page;
}

/* ───────── API ───────── */

export async function browse(browseId: string, params?: string, signal?: AbortSignal): Promise<YtPage> {
  return parse(await post('browse', { browseId, ...(params ? { params } : {}) }, signal));
}

async function more(token: string, signal?: AbortSignal): Promise<YtPage> {
  return parse(await post('browse', { continuation: token }, signal));
}

/** Home (optionally filtered by a mood chip), with a few continuation pages. */
export async function home(chip?: YtChip, signal?: AbortSignal): Promise<YtPage> {
  const page = await browse(chip?.browseId ?? 'FEmusic_home', chip?.params, signal);
  let token = page.continuation;
  for (let i = 0; i < 3 && token; i++) {
    const next = await more(token, signal).catch(() => null);
    if (!next) break;
    page.sections.push(...next.sections);
    token = next.continuation;
  }
  return page;
}

/**
 * Search filters, as YouTube Music's own chips send them: each returns up to
 * 20 results of one kind in a single request.
 */
const SEARCH_PARAMS = {
  songs: 'EgWKAQIIAWoSEAUQAxAJEBAQBBAKEBUQDhAR',
  videos: 'EgWKAQIQAWoSEAUQAxAJEBAQBBAKEBUQDhAR',
  albums: 'EgWKAQIYAWoSEAUQAxAJEBAQBBAKEBUQDhAR',
  artists: 'EgWKAQIgAWoSEAUQAxAJEBAQBBAKEBUQDhAR',
  playlists: 'EgeKAQQoADgBahIQBRADEAkQEBAEEAoQFRAOEBE=',
};
export type SearchKind = keyof typeof SEARCH_PARAMS;

/** One kind of search results (songs, videos, albums, artists or playlists). */
export async function search(query: string, kind: SearchKind, signal?: AbortSignal): Promise<YtItem[]> {
  const page = parse(await post('search', { query, params: SEARCH_PARAMS[kind] }, signal));
  return page.sections.flatMap((x) => x.items);
}

/**
 * Songs only, the fast way (one web request), falling back to the native
 * NewPipe search if the web API fails.
 */
export async function searchSongs(query: string, signal?: AbortSignal): Promise<YtSong[]> {
  try {
    return (await search(query, 'songs', signal)).filter((x): x is YtSong => x.kind === 'song');
  } catch (e) {
    if (signal?.aborted) throw e;
    const found = await YouTubeModule.search(query, 'music_songs');
    return found.flatMap((s) =>
      s.type === 'song'
        ? [
            {
              kind: 'song' as const,
              videoId: s.videoId,
              title: s.title,
              artist: s.artist ?? '',
              thumbnail: hiRes(s.thumbnail),
              duration: s.duration || undefined,
            },
          ]
        : [],
    );
  }
}

/** What YouTube Music suggests for what you've typed so far (fast: one small request). */
export async function suggestions(input: string, signal?: AbortSignal): Promise<string[]> {
  const json = await post('music/get_search_suggestions', { input }, signal);
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const r = (node as Json).searchSuggestionRenderer as Json | undefined;
    if (r) {
      const q = (r.navigationEndpoint?.searchEndpoint?.query as string | undefined) ?? text(r.suggestion);
      if (q) out.push(q);
      return;
    }
    Object.values(node as Json).forEach(walk);
  };
  walk(json.contents);
  return out;
}

export function cleanSongTitle(raw: string): string {
  return raw
    .replace(/\s*[\(\[](Official\s*)?(Music\s*)?Video[\)\]]/gi, '')
    .replace(/\s*[\(\[](Video\s*)?Oficial[\)\]]/gi, '')
    .replace(/\s*[\(\[]Audio(\s*Oficial)?[\)\]]/gi, '')
    .replace(/\s*[\(\[](Lyric\s*Video|Video\s*con\s*letra|Letra)[\)\]]/gi, '')
    .replace(/\s*[\(\[]Visualizer[\)\]]/gi, '')
    .replace(/\s*[\(\[]HD[\)\]]/gi, '')
    .replace(/\s*[\(\[]4K[\)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanArtistName(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The token for the next page of a long list, wherever this response keeps it. */
function nextToken(node: unknown, depth = 0): string | undefined {
  if (!node || typeof node !== 'object' || depth > 40) return undefined;
  const obj = node as Json;
  if (typeof obj.continuationCommand?.token === 'string') return obj.continuationCommand.token as string;
  if (typeof obj.nextContinuationData?.continuation === 'string')
    return obj.nextContinuationData.continuation as string;
  for (const v of Object.values(obj)) {
    const hit = nextToken(v, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

/** Every song of a YouTube / YouTube Music playlist or album list (list=…), following its pages. */
export async function playlistSongs(
  listId: string,
  signal?: AbortSignal,
  /** Stops reading further pages once this many songs are in. */
  max = Infinity,
): Promise<{ title?: string; cover?: string; songs: YtSong[] }> {
  let json = await post('browse', { browseId: listId.startsWith('VL') ? listId : `VL${listId}` }, signal);
  const first = parse(json);
  const seen = new Set<string>();
  const songs: YtSong[] = [];
  const take = (p: YtPage) => {
    for (const x of p.sections.flatMap((sec) => sec.items))
      if (x.kind === 'song' && !seen.has(x.videoId)) {
        seen.add(x.videoId);
        songs.push(x);
      }
  };
  take(first);
  for (let i = 0; i < 30 && songs.length < max; i++) {
    const token = nextToken(json);
    if (!token) break;
    json = await post('browse', { continuation: token }, signal);
    const before = songs.length;
    take(parse(json));
    if (songs.length === before) break;
  }
  return { title: first.header?.title, cover: first.header?.thumbnail, songs };
}

function findDeep(node: unknown, test: (n: Json) => unknown, depth = 0): unknown {
  if (!node || typeof node !== 'object' || depth > 60) return undefined;
  const hit = test(node as Json);
  if (hit) return hit;
  for (const v of Object.values(node as Json)) {
    const found = findDeep(v, test, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * A song's words on YouTube Music. Local files have no video id: the song is
 * found by name first, and only one by the same artist and of about the same
 * length counts.
 */
export async function songLyrics(
  videoId: string | undefined,
  track: { title: string; artist: string; duration: number },
  signal?: AbortSignal,
): Promise<string | undefined> {
  let id = videoId;
  if (!id) {
    const loose = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const found = await search(`${track.artist} ${track.title}`, 'songs', signal);
    const same = found.find(
      (x): x is YtSong =>
        x.kind === 'song' &&
        loose(x.artist).includes(loose(track.artist)) &&
        (!track.duration || !x.duration || Math.abs(x.duration - track.duration) < 8),
    );
    id = same?.videoId;
  }
  if (!id) return undefined;
  const next = await post('next', { videoId: id, isAudioOnly: true }, signal);
  const browseId = findDeep(next, (n) =>
    n.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ===
    'MUSIC_PAGE_TYPE_TRACK_LYRICS'
      ? n.browseEndpoint.browseId
      : undefined,
  ) as string | undefined;
  if (!browseId) return undefined;
  const page = await post('browse', { browseId }, signal);
  const shelf = findDeep(page, (n) => n.musicDescriptionShelfRenderer) as Json | undefined;
  return text(shelf?.description).trim() || undefined;
}

/** Turns a YouTube song into a Quartz track (streamed, id "yt:<videoId>"). */
export function toTrack(s: {
  video?: boolean;
  videoId: string;
  title: string;
  artist?: string;
  album?: string;
  thumbnail?: string;
  duration?: number;
}): Track {
  const title = cleanSongTitle(s.title) || s.title;
  const artist = cleanArtistName(s.artist || 'YouTube') || 'YouTube';
  const album = s.album || (artist !== 'YouTube' ? `${artist} - Single` : 'Sencillo');
  return {
    id: `yt:${s.videoId}`,
    uri: `yt:${s.videoId}`,
    filename: title,
    folder: 'YouTube Music',
    title,
    artist,
    album,
    duration: s.duration ?? 0,
    format: { codec: 'OPUS', channels: 2, sampleRate: 48000 },
    artwork: hiRes(s.thumbnail),
    addedAt: Date.now(),
    mtime: 0,
    source: 'youtube',
    video: s.video,
  };
}

/**
 * Look up accurate metadata (artist, album, high-res artwork, duration)
 * for a YouTube video using YouTube Music's 'next' endpoint.
 */
export async function fetchSongDetails(
  videoId: string,
  signal?: AbortSignal,
): Promise<{ title?: string; artist?: string; album?: string; thumbnail?: string; duration?: number } | null> {
  try {
    const json = await post('next', { videoId, isAudioOnly: true }, signal);
    const panel = findKey(json, 'playlistPanelRenderer') as Json | undefined;
    const contents = (panel?.contents as Json[] | undefined) ?? [];
    const current = contents[0]?.playlistPanelVideoRenderer as Json | undefined;
    if (!current) return null;

    const title = cleanSongTitle(text(current.title));
    const runs = (current.longBylineText?.runs as Json[] | undefined) ?? [];
    const meaningfulRuns = runs.filter((r) => r.text && r.text.trim() !== '•' && r.text.trim() !== '&');

    const artistRun = runs.find((r) => pageOf(r.navigationEndpoint?.browseEndpoint) === 'artist') ?? meaningfulRuns[0];
    const albumRun = runs.find((r) => pageOf(r.navigationEndpoint?.browseEndpoint) === 'album') ?? meaningfulRuns[1];

    const len = text(current.lengthText);
    const duration = len ? seconds(len) : undefined;
    const thumbnail = thumb(current.thumbnail);

    const artist = cleanArtistName((artistRun?.text as string | undefined) ?? '');
    const album = (albumRun?.text as string | undefined)?.trim();

    return {
      title: title || undefined,
      artist: artist || undefined,
      album: album && album !== title ? album : undefined,
      thumbnail: hiRes(thumbnail),
      duration,
    };
  } catch {
    return null;
  }
}

/**
 * What YouTube Music would play after this song (its "radio"): used to keep
 * a listening room going when its queue runs out.
 */
export async function radio(videoId: string, signal?: AbortSignal): Promise<YtSong[]> {
  const json = await post('next', { videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true }, signal);
  const items = ((findKey(json, 'playlistPanelRenderer') as Json | undefined)?.contents as Json[] | undefined) ?? [];
  return items
    .map((it) => it.playlistPanelVideoRenderer as Json | undefined)
    .filter((r): r is Json => !!r?.videoId && r.videoId !== videoId)
    .map((r) => {
      const byline = text(r.longBylineText).split(' • ');
      const len = text(r.lengthText);
      return {
        kind: 'song' as const,
        videoId: r.videoId as string,
        title: cleanSongTitle(text(r.title)),
        artist: cleanArtistName(byline[0] ?? ''),
        thumbnail: thumb(r.thumbnail),
        duration: len ? seconds(len) : undefined,
      };
    });
}
