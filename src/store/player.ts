import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from './storage';
import type { FxId } from '@/audio/fx';

export type RepeatMode = 'off' | 'all' | 'one';

export type PlayerState = {
  /** Play order (shuffled when shuffle is on). */
  queue: string[];
  /** Original order, restored when shuffle is turned off. */
  baseQueue: string[];
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playing: boolean;
  buffering: boolean;
  position: number;
  /** Throttled copy of `position` that is persisted for resume-on-launch. */
  resumeAt: number;
  duration: number;
  rate: number;
  /** Sped-up playback with pitch following the speed. */
  nightcore: boolean;
  /** Slowed-down playback with pitch following the speed (never with nightcore). */
  slowed: boolean;
  /** Combinable sound effects (see src/audio/fx.ts). */
  fx: FxId[];
  sleepAt: number | null;
  sleepEndOfTrack: boolean;
  abA: number | null;
  abB: number | null;
  /** Bumped on every track change so views can react (e.g. cassette rewind). */
  loadSeq: number;
};

export const usePlayer = create<PlayerState>()(
  persist(
    (): PlayerState => ({
      queue: [],
      baseQueue: [],
      index: 0,
      shuffle: false,
      repeat: 'off',
      playing: false,
      buffering: false,
      position: 0,
      resumeAt: 0,
      duration: 0,
      rate: 1,
      nightcore: false,
      slowed: false,
      fx: [],
      sleepAt: null,
      sleepEndOfTrack: false,
      abA: null,
      abB: null,
      loadSeq: 0,
    }),
    {
      name: 'quartz.player',
      storage: persistStorage(),
      partialize: (s) => ({
        queue: s.queue,
        baseQueue: s.baseQueue,
        index: s.index,
        shuffle: s.shuffle,
        repeat: s.repeat,
        resumeAt: s.resumeAt,
        rate: s.rate,
        nightcore: s.nightcore,
        slowed: s.slowed,
        fx: s.fx,
      }),
    },
  ),
);

/** Playback rate actually applied: the pitch modes override the speed picker. */
export const NIGHTCORE_RATE = 1.25;
export const SLOWED_RATE = 0.8;
export const effectiveRate = (s: Pick<PlayerState, 'rate' | 'nightcore' | 'slowed'>) =>
  s.nightcore ? NIGHTCORE_RATE : s.slowed ? SLOWED_RATE : s.rate || 1;

export const currentTrackId = (s: PlayerState) => s.queue[s.index] as string | undefined;
