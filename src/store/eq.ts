import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from './storage';

export type EqGroup = 'genre' | 'mood' | 'device';
export type EqPreset = { id: string; name: string; gains: number[]; preamp?: number; group?: EqGroup };

export const EQ_GROUPS: { id: EqGroup; name: string }[] = [
  { id: 'genre', name: 'Géneros' },
  { id: 'mood', name: 'Momentos y estilos' },
  { id: 'device', name: 'Para tu equipo' },
];

/** 10 bands: 31 62 125 250 500 1k 2k 4k 8k 16k (dB). */
export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Plano', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], group: 'mood' },
  // genres
  { id: 'rock', name: 'Rock', gains: [4, 3, 2, 0, -1, -1, 1, 3, 4, 4], preamp: -3, group: 'genre' },
  { id: 'pop', name: 'Pop', gains: [-1, 1, 3, 4, 3, 1, 0, 1, 2, 2], preamp: -3, group: 'genre' },
  { id: 'hiphop', name: 'Hip-Hop', gains: [6, 5, 2, 3, -1, -1, 1, 0, 2, 3], preamp: -4, group: 'genre' },
  { id: 'reggaeton', name: 'Reggaetón', gains: [6, 5, 3, 0, -1, 0, 1, 2, 3, 3], preamp: -4, group: 'genre' },
  { id: 'electronic', name: 'Electrónica', gains: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5], preamp: -4, group: 'genre' },
  { id: 'rnb', name: 'R&B', gains: [3, 6, 4, 1, -2, -1, 1, 2, 2, 3], preamp: -4, group: 'genre' },
  { id: 'jazz', name: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], preamp: -2, group: 'genre' },
  { id: 'classical', name: 'Clásica', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4], preamp: -3, group: 'genre' },
  { id: 'metal', name: 'Metal', gains: [5, 4, 1, -1, -2, 0, 2, 4, 5, 4], preamp: -4, group: 'genre' },
  { id: 'latin', name: 'Latina', gains: [3, 2, 0, 0, -1, 1, 3, 3, 3, 2], preamp: -3, group: 'genre' },
  { id: 'kpop', name: 'K-Pop', gains: [3, 3, 1, 1, 2, 3, 2, 2, 3, 4], preamp: -3, group: 'genre' },
  { id: 'acoustic', name: 'Acústica', gains: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1], preamp: -2, group: 'genre' },
  // moods and styles
  { id: 'bass', name: 'Graves+', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preamp: -4, group: 'mood' },
  { id: 'deepbass', name: 'Sub graves', gains: [8, 6, 3, 0, -1, 0, 0, 0, 0, 0], preamp: -6, group: 'mood' },
  { id: 'treble', name: 'Agudos+', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6], preamp: -4, group: 'mood' },
  { id: 'vshape', name: 'V (Loudness)', gains: [5, 4, 2, 0, -2, -2, 0, 2, 4, 5], preamp: -3, group: 'mood' },
  { id: 'vocal', name: 'Voces', gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1], preamp: -3, group: 'mood' },
  { id: 'podcast', name: 'Podcast', gains: [-4, -3, -1, 1, 3, 4, 3, 1, -1, -3], preamp: -3, group: 'mood' },
  { id: 'warm', name: 'Cálido', gains: [3, 3, 2, 1, 0, 0, -1, -2, -2, -3], preamp: -2, group: 'mood' },
  { id: 'bright', name: 'Brillante', gains: [-1, -1, 0, 0, 0, 1, 3, 4, 4, 5], preamp: -4, group: 'mood' },
  { id: 'party', name: 'Fiesta', gains: [6, 5, 2, 0, 0, 1, 2, 3, 4, 4], preamp: -5, group: 'mood' },
  { id: 'night', name: 'Noche (suave)', gains: [-3, -2, -1, 0, 1, 1, 0, -1, -2, -3], group: 'mood' },
  // gear
  { id: 'headphones', name: 'Audífonos', gains: [3, 2, 0, -1, 0, 1, 2, 2, 1, 2], preamp: -3, group: 'device' },
  { id: 'earbuds', name: 'In-ear', gains: [4, 3, 1, 0, -1, 0, 1, 1, 0, 1], preamp: -3, group: 'device' },
  { id: 'phone', name: 'Bocina del teléfono', gains: [-6, -4, -1, 2, 3, 3, 2, 1, 1, 0], preamp: -3, group: 'device' },
  { id: 'speaker', name: 'Bocina Bluetooth', gains: [2, 2, 1, 0, -1, 0, 1, 2, 2, 1], preamp: -2, group: 'device' },
  { id: 'car', name: 'Auto', gains: [4, 3, 1, 0, -1, 0, 2, 3, 3, 2], preamp: -3, group: 'device' },
];

type Eq = {
  enabled: boolean;
  preamp: number;
  gains: number[];
  preset: string | null;
  /** Left/right balance: −1 left only … 0 centre … 1 right only. */
  balance: number;
  /** Evens out loud and quiet passages: 0 off … 1 strong. */
  leveling: number;
  /** Lowers the preamp by the highest boost, so the curve never eats the headroom. */
  autoGain: boolean;
  /** Your own presets, saved from the current curve. */
  custom: EqPreset[];
  set: (patch: Partial<Omit<Eq, 'set' | 'saveCustom' | 'removeCustom'>>) => void;
  saveCustom: (name: string) => void;
  removeCustom: (id: string) => void;
};

export const useEq = create<Eq>()(
  persist(
    (set) => ({
      enabled: false,
      preamp: 0,
      gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preset: 'flat',
      balance: 0,
      leveling: 0,
      autoGain: false,
      custom: [],
      set: (patch) => set(patch),
      saveCustom: (name) =>
        set((s) => {
          const id = `user_${Date.now().toString(36)}`;
          return { custom: [...s.custom, { id, name, gains: s.gains.slice(), preamp: s.preamp }], preset: id };
        }),
      removeCustom: (id) =>
        set((s) => ({ custom: s.custom.filter((p) => p.id !== id), preset: s.preset === id ? null : s.preset })),
    }),
    { name: 'quartz.eq', storage: persistStorage() },
  ),
);
