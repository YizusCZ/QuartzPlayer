/**
 * Compares the Rust tag reader (native/quartz-core) with the TypeScript one on
 * generated files of every format, plus truncated and corrupted copies.
 *
 *   npx tsx scripts/rust-parity.ts      (needs cargo and ffmpeg)
 */
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMetadata } from '../src/library/metadata';

const crate = join(__dirname, '../native/quartz-core');
const cargo = `${process.env.HOME}/.cargo/bin/cargo`;
execFileSync(cargo, ['build', '--release', '--quiet'], { cwd: crate, stdio: 'inherit' });
const bin = join(crate, 'target/release/parse');

const dir = mkdtempSync(join(tmpdir(), 'quartz-parity-'));
const ff = (...a: string[]) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100'];
const cover = join(dir, 'cover.png');
ff('-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', cover);
const tags = (title: string) =>
  [
    'title',
    title,
    'artist',
    'Sigur Rós & 宇多田ヒカル',
    'album',
    'Ágætis "byrjun"',
    'album_artist',
    'Varios',
    'genre',
    '(17)Rock',
    'date',
    '1999-06-12',
    'track',
    '3/12',
    'disc',
    '2/2',
    'lyrics',
    'línea uno\nlínea dos',
  ].flatMap((v, i, a) => (i % 2 ? [] : ['-metadata', `${v}=${a[i + 1]}`]));
const withCover = ['-i', cover, '-map', '0:a', '-map', '1:v', '-disposition:v', 'attached_pic'];

ff(
  ...tone,
  ...withCover,
  '-c:a',
  'libmp3lame',
  '-b:a',
  '128k',
  '-c:v',
  'copy',
  '-id3v2_version',
  '3',
  ...tags('Canción v2.3 ñ'),
  join(dir, 'a23.mp3'),
);
ff(
  ...tone,
  ...withCover,
  '-c:a',
  'libmp3lame',
  '-q:a',
  '4',
  '-c:v',
  'copy',
  '-id3v2_version',
  '4',
  ...tags('Canción v2.4 ñ'),
  join(dir, 'a24.mp3'),
);
ff(...tone, '-c:a', 'libmp3lame', '-b:a', '96k', '-id3v2_version', '0', '-write_xing', '0', join(dir, 'plain.mp3'));
ff(...tone, ...withCover, '-c:a', 'flac', '-c:v', 'copy', ...tags('Flac'), join(dir, 'a.flac'));
ff(...tone, '-c:a', 'flac', '-sample_fmt', 's32', '-ar', '96000', join(dir, 'hires.flac'));
ff(
  ...tone,
  ...withCover,
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-c:v',
  'copy',
  '-movflags',
  '+faststart',
  ...tags('M4A'),
  join(dir, 'a.m4a'),
);
ff(...tone, '-c:a', 'aac', '-b:a', '128k', ...tags('moov al final'), join(dir, 'tail.m4a'));
ff(...tone, '-c:a', 'alac', ...tags('ALAC'), join(dir, 'b.m4a'));
ff(...tone, '-c:a', 'pcm_s24le', ...tags('Wav'), join(dir, 'a.wav'));
ff(...tone, '-c:a', 'pcm_s16be', '-write_id3v2', '1', ...tags('Aiff'), join(dir, 'a.aiff'));
ff(...tone, '-c:a', 'libopus', ...tags('Opus'), join(dir, 'a.opus'));
ff(...tone, '-c:a', 'libopus', '-f', 'webm', join(dir, 'yt.opus'));
writeFileSync(join(dir, 'empty.mp3'), Buffer.alloc(0));
writeFileSync(join(dir, 'tiny.flac'), Buffer.from('fLaC'));

// Damaged copies: cut short, and with bytes flipped (a fixed sequence, so failures repeat).
let seed = 1234;
const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
for (const name of readdirSync(dir).filter(
  (f) => /\.(mp3|flac|m4a|wav|aiff)$/.test(f) && statSync(join(dir, f)).size > 64,
)) {
  const b = readFileSync(join(dir, name));
  const ext = name.split('.').pop();
  for (const frac of [0.02, 0.1, 0.5])
    writeFileSync(join(dir, `cut${frac}_${name}`), b.subarray(0, Math.floor(b.length * frac)));
  for (let k = 0; k < 12; k++) {
    const c = Buffer.from(b);
    const span = Math.min(c.length, 4096);
    for (let i = 0; i < 24; i++) c[Math.floor(rand() * span)] = Math.floor(rand() * 256);
    writeFileSync(join(dir, `fuzz${k}_${name.replace(/\.[^.]+$/, '')}.${ext}`), c);
  }
}

const audio = readdirSync(dir).filter((f) => f !== 'cover.png');
const paths = audio.map((f) => join(dir, f));

const readTs = (path: string, name: string) => {
  const fd = openSync(path, 'r');
  const size = statSync(path).size;
  try {
    const m = parseMetadata(
      {
        size,
        read: (o, l) => {
          const n = Math.max(0, Math.min(l, size - o));
          const b = new Uint8Array(n);
          if (n) readSync(fd, b, 0, n, o);
          return b;
        },
      },
      name,
    );
    return { size, ...m, picture: undefined, pictureSize: m.picture?.data.length };
  } finally {
    closeSync(fd);
  }
};

const rustAll = JSON.parse(
  execFileSync(bin, paths, { maxBuffer: 1 << 28, env: { ...process.env, ART_DIR: dir } }).toString(),
) as Record<string, unknown>[];

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => same((a as never)[k], (b as never)[k]));
  }
  return (
    (a ?? undefined) === (b ?? undefined) ||
    ((a === 0 || a === undefined || Number.isNaN(a)) && (b === 0 || b === undefined))
  );
};

let bad = 0;
paths.forEach((p, i) => {
  const { picture: _p, ...r } = rustAll[i] as Record<string, unknown>;
  const { picture: _q, ...t } = readTs(p, audio[i]) as unknown as Record<string, unknown>;
  if (!same(r, t)) {
    bad++;
    if (bad <= 12)
      console.log(
        `DIFERENTE ${audio[i]}\n  rust ${JSON.stringify(r).slice(0, 400)}\n  ts   ${JSON.stringify(t).slice(0, 400)}`,
      );
  }
});
const clean = audio.filter((f) => !/^(cut|fuzz)/.test(f));
console.log('muestra', JSON.stringify(rustAll[audio.indexOf('a24.mp3')]));
console.log(
  `\n${audio.length} archivos (${clean.length} sanos, ${audio.length - clean.length} dañados): ${bad} diferencias`,
);

const time = (f: () => void) => {
  const t = process.hrtime.bigint();
  f();
  return Number(process.hrtime.bigint() - t) / 1e6;
};
const rounds = 5;
const tsMs =
  time(() => {
    for (let r = 0; r < rounds; r++) clean.forEach((f) => readTs(join(dir, f), f));
  }) / rounds;
const list = clean.map((f) => join(dir, f));
const rsMs =
  time(() => {
    for (let r = 0; r < rounds; r++) execFileSync(bin, list, { env: { ...process.env, ART_DIR: dir } });
  }) / rounds;
console.log(
  `Tiempo en PC (${clean.length} archivos): TS en Node ${tsMs.toFixed(1)} ms · Rust ${rsMs.toFixed(1)} ms, proceso incluido`,
);
rmSync(dir, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
