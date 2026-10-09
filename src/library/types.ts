export type Codec = 'FLAC' | 'ALAC' | 'WAV' | 'AIFF' | 'MP3' | 'AAC' | 'OGG' | 'OPUS' | 'UNKNOWN';

export type AudioFormat = {
  codec: Codec;
  sampleRate?: number; // Hz
  bitDepth?: number; // bits per sample (lossless only)
  channels?: number;
  bitrate?: number; // kbps (lossy, or average for lossless)
};

export type Track = {
  id: string;
  uri: string;
  filename: string;
  folder: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration: number; // seconds, 0 if unknown
  size?: number;
  format: AudioFormat;
  artwork?: string; // file:// uri of cached cover
  addedAt: number;
  /** File modification time used to skip re-parsing unchanged files. */
  mtime: number;
  source: 'device' | 'imported';
};

export const LOSSLESS: Codec[] = ['FLAC', 'ALAC', 'WAV', 'AIFF'];

/** Hi-Res: lossless and beyond CD quality (>16 bit or >48 kHz). */
export function isHiRes(f: AudioFormat): boolean {
  if (!LOSSLESS.includes(f.codec)) return false;
  return (f.bitDepth ?? 0) > 16 || (f.sampleRate ?? 0) > 48000;
}

export function formatLabel(f: AudioFormat): string {
  const parts: string[] = [f.codec === 'UNKNOWN' ? '—' : f.codec];
  if (LOSSLESS.includes(f.codec)) {
    if (f.bitDepth) parts.push(`${f.bitDepth}bit`);
    if (f.sampleRate) parts.push(khz(f.sampleRate));
  } else {
    if (f.bitrate) parts.push(`${Math.round(f.bitrate)}kbps`);
    if (f.sampleRate) parts.push(khz(f.sampleRate));
  }
  return parts.join(' · ');
}

export function khz(hz: number): string {
  const k = hz / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}kHz`;
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
