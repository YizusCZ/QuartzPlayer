/**
 * Minimal, dependency-free tag + stream-info reader for the formats a Hi-Res
 * library actually contains: FLAC, ALAC/AAC (MP4), WAV, AIFF and MP3.
 *
 * It reads only headers and tag blocks (never the audio payload), so it is
 * cheap enough to run over a whole library on the JS thread in small batches.
 */
import type { AudioFormat, Codec } from './types';
import {
  type ByteSource,
  ascii,
  clean,
  float80,
  latin1,
  syncsafe,
  u16be,
  u16le,
  u24be,
  u32be,
  u32le,
  utf16,
  utf8,
  utf8OrLatin1,
} from './bytes';

export type Picture = { mime: string; data: Uint8Array };

export type ParsedMeta = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration?: number;
  format: AudioFormat;
  picture?: Picture;
  /** Embedded lyrics (plain or LRC-formatted). */
  lyrics?: string;
};

const MAX_BLOCK = 16 * 1024 * 1024;

export function codecFromExt(name: string): Codec {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'flac':
      return 'FLAC';
    case 'wav':
    case 'wave':
      return 'WAV';
    case 'aif':
    case 'aiff':
    case 'aifc':
      return 'AIFF';
    case 'mp3':
      return 'MP3';
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'AAC';
    case 'alac':
      return 'ALAC';
    case 'ogg':
      return 'OGG';
    case 'opus':
      return 'OPUS';
    default:
      return 'UNKNOWN';
  }
}

export function parseMetadata(src: ByteSource, filename: string): ParsedMeta {
  const out: ParsedMeta = { format: { codec: codecFromExt(filename) } };
  if (src.size < 16) return out;
  try {
    const head = src.read(0, 12);
    const magic4 = ascii(head, 0, 4);
    if (magic4 === 'fLaC' || (ascii(head, 0, 3) === 'ID3' && out.format.codec === 'FLAC')) {
      parseFlac(src, out);
    } else if (magic4 === 'RIFF' && ascii(head, 8, 4) === 'WAVE') {
      parseWav(src, out);
    } else if (magic4 === 'FORM' && ascii(head, 8, 3) === 'AIF') {
      parseAiff(src, out);
    } else if (ascii(head, 4, 4) === 'ftyp') {
      parseMp4(src, out);
    } else if (ascii(head, 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
      parseMp3(src, out);
    }
  } catch {
    // Corrupt or truncated file: keep whatever we already gathered.
  }
  if (!out.duration && out.format.bitrate && out.format.codec !== 'MP3') {
    out.duration = (src.size * 8) / (out.format.bitrate * 1000);
  }
  if (out.duration && !out.format.bitrate) {
    out.format.bitrate = (src.size * 8) / out.duration / 1000;
  }
  return out;
}

/* ───────────────────────────── ID3v2 ───────────────────────────── */

function desync(b: Uint8Array): Uint8Array {
  const r = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    r[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return r.subarray(0, j);
}

function decodeText(b: Uint8Array, enc: number): string {
  switch (enc) {
    case 1:
      return clean(utf16(b, false));
    case 2:
      return clean(utf16(b, true));
    case 3:
      return clean(utf8(b));
    default:
      return clean(latin1(b));
  }
}

/** Returns index just after a terminated string starting at `pos`. */
function skipTerminated(b: Uint8Array, pos: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = pos; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i + 2;
  } else {
    for (let i = pos; i < b.length; i++) if (b[i] === 0) return i + 1;
  }
  return b.length;
}

function setNumPair(v: string, out: ParsedMeta, key: 'trackNo' | 'discNo') {
  const n = parseInt(v, 10);
  if (Number.isFinite(n) && n > 0) out[key] = n;
}

function setYear(v: string, out: ParsedMeta) {
  const m = /(\d{4})/.exec(v);
  if (m) out.year = parseInt(m[1], 10);
}

function applyTag(key: string, v: string, out: ParsedMeta) {
  if (!v) return;
  switch (key) {
    case 'TITLE':
      out.title ??= v;
      break;
    case 'ARTIST':
      out.artist ??= v;
      break;
    case 'ALBUM':
      out.album ??= v;
      break;
    case 'ALBUMARTIST':
    case 'ALBUM ARTIST':
      out.albumArtist ??= v;
      break;
    case 'GENRE':
      out.genre ??= v.replace(/^\(\d+\)/, '').trim() || undefined;
      break;
    case 'DATE':
    case 'YEAR':
      if (!out.year) setYear(v, out);
      break;
    case 'TRACKNUMBER':
      if (!out.trackNo) setNumPair(v, out, 'trackNo');
      break;
    case 'DISCNUMBER':
      if (!out.discNo) setNumPair(v, out, 'discNo');
      break;
    case 'LYRICS':
    case 'UNSYNCEDLYRICS':
      out.lyrics ??= v;
      break;
  }
}

const ID3_MAP: Record<string, string> = {
  TIT2: 'TITLE',
  TT2: 'TITLE',
  TPE1: 'ARTIST',
  TP1: 'ARTIST',
  TALB: 'ALBUM',
  TAL: 'ALBUM',
  TPE2: 'ALBUMARTIST',
  TP2: 'ALBUMARTIST',
  TCON: 'GENRE',
  TCO: 'GENRE',
  TYER: 'YEAR',
  TYE: 'YEAR',
  TDRC: 'DATE',
  TDRL: 'DATE',
  TRCK: 'TRACKNUMBER',
  TRK: 'TRACKNUMBER',
  TPOS: 'DISCNUMBER',
  TPA: 'DISCNUMBER',
};

function takePicture(out: ParsedMeta, pic: Picture, isFront: boolean) {
  if (!pic.data.length) return;
  if (!out.picture || isFront) out.picture = { mime: pic.mime, data: pic.data.slice() };
}

/** Parses an ID3v2 tag at `offset`; returns total tag length (0 if none). */
function parseId3(src: ByteSource, offset: number, out: ParsedMeta): number {
  const hdr = src.read(offset, 10);
  if (ascii(hdr, 0, 3) !== 'ID3') return 0;
  const ver = hdr[3];
  const flags = hdr[5];
  const size = syncsafe(hdr, 6);
  const total = 10 + size + (flags & 0x10 ? 10 : 0);
  let body = src.read(offset + 10, Math.min(size, MAX_BLOCK));
  if (flags & 0x80 && ver < 4) body = desync(body);

  let pos = 0;
  if (flags & 0x40 && ver >= 3) pos += ver === 3 ? u32be(body, 0) + 4 : syncsafe(body, 0);

  const idLen = ver === 2 ? 3 : 4;
  const hLen = ver === 2 ? 6 : 10;
  let tlenMs = 0;

  while (pos + hLen <= body.length) {
    const id = ascii(body, pos, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const fsize = ver === 2 ? u24be(body, pos + 3) : ver === 4 ? syncsafe(body, pos + 4) : u32be(body, pos + 4);
    const fflags = ver === 2 ? 0 : u16be(body, pos + 8);
    let data = body.subarray(pos + hLen, pos + hLen + fsize);
    pos += hLen + fsize;
    if (fsize <= 0) continue;
    if (ver === 4) {
      if (fflags & 0x0001) data = data.subarray(4);
      if (fflags & 0x0002) data = desync(data);
    }

    const mapped = ID3_MAP[id];
    if (mapped) {
      applyTag(mapped, decodeText(data.subarray(1), data[0]), out);
    } else if (id === 'USLT' || id === 'ULT') {
      const enc = data[0];
      const textStart = skipTerminated(data, 4, enc); // enc(1) + language(3) + description
      applyTag('LYRICS', decodeText(data.subarray(textStart), enc), out);
    } else if (id === 'TXXX') {
      const enc = data[0];
      const descEnd = skipTerminated(data, 1, enc);
      const desc = decodeText(data.subarray(1, descEnd), enc).toUpperCase();
      if (desc === 'LYRICS' || desc === 'USLT' || desc === 'UNSYNCEDLYRICS')
        applyTag('LYRICS', decodeText(data.subarray(descEnd), enc), out);
    } else if (id === 'TLEN') {
      tlenMs = parseInt(decodeText(data.subarray(1), data[0]), 10) || 0;
    } else if (id === 'APIC') {
      const enc = data[0];
      const mimeEnd = skipTerminated(data, 1, 0);
      const mime = latin1(data.subarray(1, mimeEnd - 1)) || 'image/jpeg';
      const picType = data[mimeEnd];
      const dataStart = skipTerminated(data, mimeEnd + 1, enc);
      takePicture(out, { mime, data: data.subarray(dataStart) }, picType === 3);
    } else if (id === 'PIC') {
      const enc = data[0];
      const fmt = ascii(data, 1, 3).toLowerCase();
      const picType = data[4];
      const dataStart = skipTerminated(data, 5, enc);
      takePicture(
        out,
        { mime: fmt === 'png' ? 'image/png' : 'image/jpeg', data: data.subarray(dataStart) },
        picType === 3,
      );
    }
  }
  if (tlenMs && !out.duration) out.duration = tlenMs / 1000;
  return total;
}

/* ───────────────────────────── MP3 ───────────────────────────── */

const MP3_BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_SR: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

function parseMp3(src: ByteSource, out: ParsedMeta) {
  out.format.codec = 'MP3';
  let start = 0;
  // Some files carry more than one tag; skip them all.
  for (let guard = 0; guard < 3; guard++) {
    const len = parseId3(src, start, out);
    if (!len) break;
    start += len;
  }
  const win = src.read(start, 64 * 1024);
  for (let i = 0; i + 4 < win.length; i++) {
    if (win[i] !== 0xff || (win[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (win[i + 1] >> 3) & 3;
    const layer = (win[i + 1] >> 1) & 3;
    const brIdx = win[i + 2] >> 4;
    const srIdx = (win[i + 2] >> 2) & 3;
    if (verBits === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const v1 = verBits === 3;
    const sampleRate = MP3_SR[verBits][srIdx];
    const mono = win[i + 3] >> 6 === 3;
    const spf = v1 ? 1152 : 576;
    out.format.sampleRate = sampleRate;
    out.format.channels = mono ? 1 : 2;

    const xingOff = i + (v1 ? (mono ? 21 : 36) : mono ? 13 : 21);
    const tag = ascii(win, xingOff, 4);
    let frames = 0;
    if ((tag === 'Xing' || tag === 'Info') && u32be(win, xingOff + 4) & 1) frames = u32be(win, xingOff + 8);
    else if (ascii(win, i + 36, 4) === 'VBRI') frames = u32be(win, i + 36 + 14);

    const audioBytes = src.size - start - i;
    if (frames > 0) {
      out.duration = (frames * spf) / sampleRate;
      out.format.bitrate = (audioBytes * 8) / out.duration / 1000;
    } else {
      out.format.bitrate = (v1 ? MP3_BR_V1 : MP3_BR_V2)[brIdx];
      out.duration ??= (audioBytes * 8) / (out.format.bitrate * 1000);
    }
    return;
  }
}

/* ───────────────────────────── FLAC ───────────────────────────── */

function parseFlac(src: ByteSource, out: ParsedMeta) {
  out.format.codec = 'FLAC';
  let pos = 0;
  const id3 = parseId3(src, 0, out);
  pos += id3;
  if (ascii(src.read(pos, 4), 0, 4) !== 'fLaC') return;
  pos += 4;
  for (let guard = 0; guard < 128 && pos + 4 <= src.size; guard++) {
    const h = src.read(pos, 4);
    const last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const len = u24be(h, 1);
    pos += 4;
    if (type === 0) {
      const b = src.read(pos, 34);
      const sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      const channels = ((b[12] >> 1) & 7) + 1;
      const bps = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
      const totalSamples = (b[13] & 0x0f) * 2 ** 32 + u32be(b, 14);
      Object.assign(out.format, { sampleRate, channels, bitDepth: bps });
      if (sampleRate && totalSamples) out.duration = totalSamples / sampleRate;
    } else if (type === 4 && len < MAX_BLOCK) {
      parseVorbisComments(src.read(pos, len), out);
    } else if (type === 6 && len < MAX_BLOCK) {
      const b = src.read(pos, len);
      const picType = u32be(b, 0);
      const mimeLen = u32be(b, 4);
      const mime = ascii(b, 8, mimeLen);
      let p = 8 + mimeLen;
      p += 4 + u32be(b, p); // description
      p += 16; // width, height, depth, colors
      const dataLen = u32be(b, p);
      takePicture(out, { mime, data: b.subarray(p + 4, p + 4 + dataLen) }, picType === 3);
    }
    pos += len;
    if (last) break;
  }
}

function parseVorbisComments(b: Uint8Array, out: ParsedMeta) {
  let p = 4 + u32le(b, 0);
  const count = u32le(b, p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = u32le(b, p);
    p += 4;
    const s = utf8(b.subarray(p, p + len));
    p += len;
    const eq = s.indexOf('=');
    if (eq > 0) applyTag(s.slice(0, eq).toUpperCase(), s.slice(eq + 1).trim(), out);
  }
}

/* ───────────────────────────── WAV / AIFF ───────────────────────────── */

const RIFF_INFO: Record<string, string> = {
  INAM: 'TITLE',
  IART: 'ARTIST',
  IPRD: 'ALBUM',
  IGNR: 'GENRE',
  ICRD: 'DATE',
  ITRK: 'TRACKNUMBER',
  IPRT: 'TRACKNUMBER',
};

function parseWav(src: ByteSource, out: ParsedMeta) {
  out.format.codec = 'WAV';
  let pos = 12;
  let byteRate = 0;
  let dataSize = 0;
  for (let guard = 0; guard < 64 && pos + 8 <= src.size; guard++) {
    const h = src.read(pos, 8);
    const id = ascii(h, 0, 4);
    const size = u32le(h, 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      const f = src.read(body, Math.min(size, 40));
      out.format.channels = u16le(f, 2);
      out.format.sampleRate = u32le(f, 4);
      byteRate = u32le(f, 8);
      out.format.bitDepth = u16le(f, 14);
    } else if (id === 'data') {
      dataSize = Math.min(size, src.size - body);
    } else if (id === 'LIST' && size < MAX_BLOCK) {
      const b = src.read(body, size);
      if (ascii(b, 0, 4) === 'INFO') {
        let p = 4;
        while (p + 8 <= b.length) {
          const sid = ascii(b, p, 4);
          const slen = u32le(b, p + 4);
          const key = RIFF_INFO[sid];
          if (key) applyTag(key, clean(utf8OrLatin1(b.subarray(p + 8, p + 8 + slen))), out);
          p += 8 + slen + (slen & 1);
        }
      }
    } else if (id === 'id3 ' || id === 'ID3 ') {
      parseId3(src, body, out);
    }
    pos = body + size + (size & 1);
  }
  if (byteRate && dataSize) out.duration = dataSize / byteRate;
}

function parseAiff(src: ByteSource, out: ParsedMeta) {
  out.format.codec = 'AIFF';
  let pos = 12;
  for (let guard = 0; guard < 64 && pos + 8 <= src.size; guard++) {
    const h = src.read(pos, 8);
    const id = ascii(h, 0, 4);
    const size = u32be(h, 4);
    const body = pos + 8;
    if (id === 'COMM') {
      const c = src.read(body, 18);
      const frames = u32be(c, 2);
      out.format.channels = u16be(c, 0);
      out.format.bitDepth = u16be(c, 6);
      out.format.sampleRate = Math.round(float80(c, 8));
      if (out.format.sampleRate) out.duration = frames / out.format.sampleRate;
    } else if (id === 'ID3 ' || id === 'id3 ') {
      parseId3(src, body, out);
    } else if ((id === 'NAME' || id === 'AUTH') && size < 4096) {
      applyTag(id === 'NAME' ? 'TITLE' : 'ARTIST', clean(utf8OrLatin1(src.read(body, size))), out);
    }
    pos = body + size + (size & 1);
  }
}

/* ───────────────────────────── MP4 / M4A ───────────────────────────── */

type Atom = { type: string; start: number; end: number }; // start = payload start

function atoms(b: Uint8Array, from: number, to: number): Atom[] {
  const list: Atom[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = u32be(b, p);
    const type = ascii(b, p + 4, 4);
    let hdr = 8;
    if (size === 1) {
      size = u32be(b, p + 8) * 2 ** 32 + u32be(b, p + 12);
      hdr = 16;
    } else if (size === 0) size = to - p;
    if (size < hdr) break;
    list.push({ type, start: p + hdr, end: Math.min(p + size, to) });
    p += size;
  }
  return list;
}

const child = (b: Uint8Array, a: Atom | undefined, type: string, skip = 0) =>
  a ? atoms(b, a.start + skip, a.end).find((x) => x.type === type) : undefined;

function parseMp4(src: ByteSource, out: ParsedMeta) {
  out.format.codec = 'AAC';
  // Locate top-level moov (may sit after mdat).
  let pos = 0;
  let moov: Uint8Array | null = null;
  for (let guard = 0; guard < 64 && pos + 8 <= src.size; guard++) {
    const h = src.read(pos, 16);
    let size = u32be(h, 0);
    const type = ascii(h, 4, 4);
    let hdr = 8;
    if (size === 1) {
      size = u32be(h, 8) * 2 ** 32 + u32be(h, 12);
      hdr = 16;
    } else if (size === 0) size = src.size - pos;
    if (size < 8) return;
    if (type === 'moov') {
      moov = src.read(pos + hdr, Math.min(size - hdr, 32 * 1024 * 1024));
      break;
    }
    pos += size;
  }
  if (!moov) return;
  const b = moov;
  const root: Atom = { type: 'moov', start: 0, end: b.length };
  const top = atoms(b, 0, b.length);

  const mvhd = top.find((a) => a.type === 'mvhd');
  if (mvhd) {
    const v = b[mvhd.start];
    const ts = v === 1 ? u32be(b, mvhd.start + 20) : u32be(b, mvhd.start + 12);
    const dur = v === 1 ? u32be(b, mvhd.start + 24) * 2 ** 32 + u32be(b, mvhd.start + 28) : u32be(b, mvhd.start + 16);
    if (ts) out.duration = dur / ts;
  }

  for (const trak of top.filter((a) => a.type === 'trak')) {
    const stbl = child(b, child(b, child(b, trak, 'mdia'), 'minf'), 'stbl');
    const stsd = child(b, stbl, 'stsd');
    if (!stsd) continue;
    const e = stsd.start + 8; // fullbox + entry count
    const fmt = ascii(b, e + 4, 4);
    if (!['alac', 'mp4a', 'fLaC', 'Opus'].includes(fmt)) continue;
    out.format.channels = u16be(b, e + 24);
    out.format.bitDepth = u16be(b, e + 26);
    out.format.sampleRate = u16be(b, e + 32);
    if (fmt === 'alac') {
      out.format.codec = 'ALAC';
      const cfg = atoms(b, e + 36, e + u32be(b, e)).find((a) => a.type === 'alac');
      if (cfg) {
        const c = cfg.start + 4;
        out.format.bitDepth = b[c + 5];
        out.format.channels = b[c + 9];
        out.format.sampleRate = u32be(b, c + 20);
      }
    } else if (fmt === 'fLaC') {
      out.format.codec = 'FLAC';
    } else if (fmt === 'Opus') {
      out.format.codec = 'OPUS';
    } else {
      out.format.bitDepth = undefined; // not meaningful for lossy AAC
    }
    break;
  }

  const ilst =
    child(b, child(b, child(b, root, 'udta'), 'meta'), 'ilst', 4) ?? child(b, child(b, root, 'meta'), 'ilst', 4);
  if (!ilst) return;
  for (const item of atoms(b, ilst.start, ilst.end)) {
    const data = atoms(b, item.start, item.end).find((a) => a.type === 'data');
    if (!data) continue;
    const kind = u32be(b, data.start) & 0xffffff;
    const payload = b.subarray(data.start + 8, data.end);
    const text = () => clean(utf8(payload));
    switch (item.type) {
      case '©nam':
        applyTag('TITLE', text(), out);
        break;
      case '©ART':
        applyTag('ARTIST', text(), out);
        break;
      case '©alb':
        applyTag('ALBUM', text(), out);
        break;
      case 'aART':
        applyTag('ALBUMARTIST', text(), out);
        break;
      case '©gen':
        applyTag('GENRE', text(), out);
        break;
      case '©day':
        applyTag('DATE', text(), out);
        break;
      case 'trkn':
        if (payload.length >= 4 && u16be(payload, 2)) out.trackNo = u16be(payload, 2);
        break;
      case 'disk':
        if (payload.length >= 4 && u16be(payload, 2)) out.discNo = u16be(payload, 2);
        break;
      case '\u00a9lyr':
        applyTag('LYRICS', text(), out);
        break;
      case 'covr':
        takePicture(out, { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: payload }, true);
        break;
    }
  }
}
