/**
 * Choosing songs from a pool so they do not keep coming back: for the room
 * games, the room radio and "Para ti". No app imports here, so
 * scripts/song-picker-sim.ts can measure it on the PC.
 */

export type PoolSong = {
  videoId: string;
  title: string;
  artist: string;
  duration?: number;
  /** How well it fits, 0…1 (1 = what the source would play first). */
  fit?: number;
};

export type PickOptions = {
  /** When each song was last heard (ms), if ever. */
  lastHeard: (videoId: string) => number | undefined;
  now: number;
  /** Most songs by one artist; relaxed only if there are not enough otherwise. */
  maxPerArtist: number;
  /** A song heard this long ago counts as fairly new again. */
  freshAfterMs: number;
  /** 0: the best fit always wins. 1: fit hardly matters (games want variety). */
  randomness: number;
  random?: () => number;
};

const DAY = 86_400_000;
export const days = (n: number) => n * DAY;

export function normTitle(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      // "(Remastered 2011)", "[Official Video]", "- Live at…": the same song for a listener.
      .replace(/[([].*?[)\]]/g, ' ')
      .replace(/\s-\s.*$/, ' ')
      .replace(/\b(feat|ft)\b.*$/, ' ')
      .replace(/[^a-z0-9Ѐ-ӿ぀-ヿ一-鿿가-힯]+/g, ' ')
      .trim()
  );
}

/** The main artist: "A & B", "A, B" and "A feat. B" all count as A. */
export function mainArtist(s: string) {
  return (
    s
      .toLowerCase()
      .split(/\s*(?:,|&|\bfeat\b\.?|\bft\b\.?|\bx\b|\by\b|\band\b)\s*/)[0]
      ?.trim() ?? ''
  );
}

/** Not one song: mixes, full albums, hour-long compilations. */
const NOT_A_SONG =
  /\b(mix|full album|album completo|compilation|recopilaci|megamix|mashup|1 hour|1 hora|medley|playlist|top \d+)\b/i;

export function isOneSong(s: PoolSong) {
  if (NOT_A_SONG.test(s.title)) return false;
  return !s.duration || (s.duration >= 60 && s.duration <= 600);
}

/** One copy of each song: the same title by the same artist, whatever the upload. */
export function dedupe(pool: PoolSong[]): PoolSong[] {
  const best = new Map<string, PoolSong>();
  const ids = new Set<string>();
  for (const s of pool) {
    if (ids.has(s.videoId)) continue;
    ids.add(s.videoId);
    const key = `${mainArtist(s.artist)}|${normTitle(s.title) || s.videoId}`;
    const cur = best.get(key);
    if (!cur || (s.fit ?? 0) > (cur.fit ?? 0)) best.set(key, s);
  }
  return [...best.values()];
}

/** 0 just heard … 1 never heard (or long ago). */
function freshness(last: number | undefined, o: PickOptions) {
  if (last == null) return 1;
  return Math.min(1, Math.max(0, (o.now - last) / o.freshAfterMs)) ** 2 * 0.95;
}

/**
 * `need` songs, freshest first: anything not heard lately beats anything heard
 * lately, whatever its fit; within that, fit and chance decide. Then the order
 * keeps the same artist from playing twice in a row.
 */
export function pick(pool: PoolSong[], need: number, o: PickOptions): PoolSong[] {
  const rnd = o.random ?? Math.random;
  const ranked = dedupe(pool)
    .map((song) => {
      const fresh = freshness(o.lastHeard(song.videoId), o);
      const taste = (song.fit ?? 0.5) * (1 - o.randomness) + rnd() * o.randomness;
      return { song, score: fresh * 3 + taste };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.song);

  const chosen: PoolSong[] = [];
  const left: PoolSong[] = [];
  const perArtist = new Map<string, number>();
  for (const song of ranked) {
    const a = mainArtist(song.artist);
    const n = perArtist.get(a) ?? 0;
    if (chosen.length < need && n < o.maxPerArtist) {
      perArtist.set(a, n + 1);
      chosen.push(song);
    } else left.push(song);
  }
  // A pool from very few artists: better repeating them than coming up short.
  for (const song of left) {
    if (chosen.length >= need) break;
    chosen.push(song);
  }
  return spreadArtists(chosen);
}

/** Reorders so no artist plays twice in a row, when that is possible. */
export function spreadArtists(list: PoolSong[]): PoolSong[] {
  const rest = [...list];
  const out: PoolSong[] = [];
  while (rest.length) {
    const prev = out.length ? mainArtist(out[out.length - 1].artist) : null;
    const i = rest.findIndex((s) => mainArtist(s.artist) !== prev);
    out.push(rest.splice(Math.max(0, i), 1)[0]);
  }
  return out;
}

/** Your most-liked songs weigh more, and fade if you have not played them in weeks. */
export function seedScore(count: number, lastMs: number, favourite: boolean, now: number) {
  const age = Math.max(0, now - lastMs) / DAY;
  return (Math.log2(1 + count) + (favourite ? 1.5 : 0)) * Math.exp(-age / 30);
}

/** `n` items without repeats, each with a chance proportional to its weight. */
export function weightedSample<T>(items: { item: T; weight: number }[], n: number, random = Math.random): T[] {
  const keyed = items
    .filter((x) => x.weight > 0)
    .map((x) => ({ item: x.item, key: random() ** (1 / x.weight) }))
    .sort((a, b) => b.key - a.key);
  return keyed.slice(0, n).map((x) => x.item);
}

/** Songs from several ranked lists: what several lists agree on fits best. */
export function mergeRanked(lists: PoolSong[][]): PoolSong[] {
  const seen = new Map<string, PoolSong>();
  for (const list of lists) {
    list.forEach((s, i) => {
      const fit = 1 - i / Math.max(1, list.length);
      const cur = seen.get(s.videoId);
      if (cur) cur.fit = Math.min(1, (cur.fit ?? 0) + 0.5);
      else seen.set(s.videoId, { ...s, fit });
    });
  }
  return [...seen.values()];
}
