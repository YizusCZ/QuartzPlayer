/** Random-access byte source. Implemented over expo-file-system on device and over fs in tooling. */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Uint8Array;
}

export const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
export const u24be = (b: Uint8Array, o: number) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
export const u32be = (b: Uint8Array, o: number) =>
  ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
export const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
export const u32le = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);
export const syncsafe = (b: Uint8Array, o: number) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

export function ascii(b: Uint8Array, o: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

export function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function utf8(b: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xc0) cp = 0xfffd;
    else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (b[i++] & 0x3f);
    else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    else cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd';
  }
  return out;
}

/** UTF-8 when it decodes cleanly, Latin-1 otherwise (legacy RIFF/AIFF text). */
export function utf8OrLatin1(b: Uint8Array): string {
  const s = utf8(b);
  return s.includes('\ufffd') || /[\u0080-\u009f]/.test(s) ? latin1(b) : s;
}

export function utf16(b: Uint8Array, bigEndian: boolean): string {
  let o = 0;
  if (b.length >= 2) {
    if (b[0] === 0xff && b[1] === 0xfe) {
      bigEndian = false;
      o = 2;
    } else if (b[0] === 0xfe && b[1] === 0xff) {
      bigEndian = true;
      o = 2;
    }
  }
  const units: number[] = [];
  for (; o + 1 < b.length; o += 2) units.push(bigEndian ? (b[o] << 8) | b[o + 1] : b[o] | (b[o + 1] << 8));
  let s = '';
  for (let i = 0; i < units.length; i += 4096) s += String.fromCharCode(...units.slice(i, i + 4096));
  return s;
}

export const clean = (s: string) => s.replace(/\0+$/g, '').replace(/\0/g, ' / ').trim();

/** 80-bit IEEE 754 extended (AIFF sample rate). */
export function float80(b: Uint8Array, o: number): number {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  const hi = u32be(b, o + 2);
  const lo = u32be(b, o + 6);
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  const sign = b[o] & 0x80 ? -1 : 1;
  return sign * (hi * 2 ** (exp - 16383 - 31) + lo * 2 ** (exp - 16383 - 63));
}

/** FNV-1a — stable short ids for cache filenames. */
export function hash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
