import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from './storage';

export type EqPreset = { id: string; name: string; gains: number[]; preamp?: number };

/** 10 bands: 31 62 125 250 500 1k 2k 4k 8k 16k (dB). */
export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Plano', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', name: 'Graves+', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preamp: -4 },
  { id: 'treble', name: 'Agudos+', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6], preamp: -4 },
  { id: 'vshape', name: 'V (Loudness)', gains: [5, 4, 2, 0, -2, -2, 0, 2, 4, 5], preamp: -3 },
  { id: 'rock', name: 'Rock', gains: [4, 3, 2, 0, -1, -1, 1, 3, 4, 4], preamp: -3 },
  { id: 'pop', name: 'Pop', gains: [-1, 1, 3, 4, 3, 1, 0, 1, 2, 2], preamp: -3 },
  { id: 'hiphop', name: 'Hip-Hop', gains: [6, 5, 2, 3, -1, -1, 1, 0, 2, 3], preamp: -4 },
  { id: 'electronic', name: 'Electrónica', gains: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5], preamp: -4 },
  { id: 'jazz', name: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], preamp: -2 },
  { id: 'classical', name: 'Clásica', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4], preamp: -3 },
  { id: 'acoustic', name: 'Acústica', gains: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1], preamp: -2 },
  { id: 'vocal', name: 'Voces', gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1], preamp: -3 },
  { id: 'night', name: 'Noche (suave)', gains: [-3, -2, -1, 0, 1, 1, 0, -1, -2, -3] },
];

type Eq = {
  enabled: boolean;
  preamp: number;
  gains: number[];
  preset: string | null;
  set: (patch: Partial<Omit<Eq, 'set'>>) => void;
};

export const useEq = create<Eq>()(
  persist(
    (set) => ({
      enabled: false,
      preamp: 0,
      gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preset: 'flat',
      set: (patch) => set(patch),
    }),
    { name: 'quartz.eq', storage: persistStorage() },
  ),
);
