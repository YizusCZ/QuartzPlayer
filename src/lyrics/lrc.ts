/**
 * LRC parsing, including the "enhanced" variant with per-word <mm:ss.xx> stamps.
 */
export type LyricWord = { text: string; start: number; end: number };
export type LyricLine = { start: number; end: number; text: string; words: LyricWord[] };
export type Lyrics =
  | { kind: 'synced'; lines: LyricLine[]; source: LyricsSource }
  | { kind: 'plain'; text: string; source: LyricsSource }
  | { kind: 'instrumental'; source: LyricsSource }
  /** `failed`: the lookup could not be done (no network, service overloaded), not "this song has none". */
  | { kind: 'none'; failed?: boolean };
export type LyricsSource = 'embedded' | 'file' | 'lrclib' | 'youtube';

const LINE_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

const toSec = (m: string, s: string, f?: string) =>
  parseInt(m, 10) * 60 + parseInt(s, 10) + (f ? parseInt(f, 10) / Math.pow(10, f.length) : 0);

export function isLrc(text: string): boolean {
  return /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(text);
}

/** Splits a line into words with estimated timings weighted by length. */
function estimateWords(text: string, start: number, end: number): LyricWord[] {
  const parts = text.split(/(\s+)/).filter((p) => p.trim());
  const total = parts.reduce((a, p) => a + p.length + 1, 0) || 1;
  const span = Math.max(0.3, Math.min(end - start, 12));
  let t = start;
  return parts.map((p) => {
    const d = (span * (p.length + 1)) / total;
    const w = { text: p, start: t, end: t + d };
    t += d;
    return w;
  });
}

export function parseLrc(raw: string, duration = 0): LyricLine[] {
  let offset = 0;
  const off = /\[offset:\s*([+-]?\d+)\]/i.exec(raw);
  if (off) offset = parseInt(off[1], 10) / 1000;

  const lines: { start: number; body: string }[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const stamps: number[] = [];
    let last = 0;
    LINE_TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINE_TAG.exec(rawLine)) && m.index === last) {
      stamps.push(toSec(m[1], m[2], m[3]) - offset);
      last = LINE_TAG.lastIndex;
    }
    if (!stamps.length) continue;
    const body = rawLine.slice(last).trim();
    for (const st of stamps) lines.push({ start: Math.max(0, st), body });
  }
  lines.sort((a, b) => a.start - b.start);

  return lines.map((l, i) => {
    const end = lines[i + 1]?.start ?? (duration > l.start ? duration : l.start + 5);
    // Enhanced LRC: per-word timestamps.
    const words: LyricWord[] = [];
    WORD_TAG.lastIndex = 0;
    const tagged = [...l.body.matchAll(WORD_TAG)];
    if (tagged.length) {
      for (let k = 0; k < tagged.length; k++) {
        const t = tagged[k];
        const from = t.index! + t[0].length;
        const to = tagged[k + 1]?.index ?? l.body.length;
        const text = l.body.slice(from, to).trim();
        if (!text) continue;
        const start = toSec(t[1], t[2], t[3]) - offset;
        const next = tagged[k + 1];
        words.push({ text, start, end: next ? toSec(next[1], next[2], next[3]) - offset : end });
      }
    }
    const text = l.body.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    return { start: l.start, end, text, words: words.length ? words : estimateWords(text, l.start, end) };
  });
}

/** Index of the line active at time t (−1 before the first line). */
export function lineAt(lines: LyricLine[], t: number): number {
  'worklet';
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
