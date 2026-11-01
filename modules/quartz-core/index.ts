import { requireOptionalNativeModule } from 'expo-modules-core';

type Native = {
  available: boolean;
  parseBatch(items: string, artDir: string): Promise<string>;
};

const native = requireOptionalNativeModule<Native>('QuartzCore');

/** What the Rust reader finds in a file; `picture` is a file name inside the artwork folder. */
export type NativeMeta = {
  size: number;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration?: number;
  format: { codec: string; bitrate?: number; sampleRate?: number; channels?: number; bitDepth?: number };
  picture?: string;
};

/** Rust where the phone's architecture has the library; the JS reader takes over otherwise. */
export const QuartzCore = {
  available: !!native?.available,
  /** One result per file, in order; null for those the native reader could not open. */
  async readTags(files: { path: string; name: string }[], artDir: string): Promise<(NativeMeta | null)[]> {
    if (!native?.available) return files.map(() => null);
    const items = files.flatMap((f) => [f.path, f.name]).join('\u001f');
    return JSON.parse(await native.parseBatch(items, artDir)) as (NativeMeta | null)[];
  },
};
