/**
 * Your own cassettes from "Crea tu cassette", stored next to the built-in ones.
 * Kept out of skins.ts so that file stays pure (tools/preview.tsx imports it).
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/store/storage';
import { isBuiltinSkin, SKINS, type BuiltinSkinId, type CassetteSkin, type CassetteSkinId } from './skins';

type Store = {
  skins: Record<string, CassetteSkin>;
  save: (skin: CassetteSkin) => void;
  remove: (id: string) => void;
};

export const useCassettes = create<Store>()(
  persist(
    (set) => ({
      skins: {},
      save: (skin) => set((s) => ({ skins: { ...s.skins, [skin.id]: skin } })),
      remove: (id) =>
        set((s) => {
          const skins = { ...s.skins };
          delete skins[id];
          return { skins };
        }),
    }),
    { name: 'quartz.cassettes', storage: persistStorage() },
  ),
);

/** Any style by id; a deleted custom one falls back to Magenta. */
export function getSkin(id: CassetteSkinId | undefined): CassetteSkin {
  if (id && isBuiltinSkin(id)) return SKINS[id];
  return (id && useCassettes.getState().skins[id]) || SKINS.magenta;
}

/** Same as getSkin, re-rendering when that custom style is edited. */
export function useSkin(id: CassetteSkinId | undefined): CassetteSkin {
  const custom = useCassettes((s) => (id && !isBuiltinSkin(id) ? s.skins[id] : undefined));
  return id && isBuiltinSkin(id) ? SKINS[id] : (custom ?? SKINS.magenta);
}

export const BUILTIN_IDS = Object.keys(SKINS) as BuiltinSkinId[];

/** Your styles first, then the built-in ones. */
export function useSkinList(): CassetteSkin[] {
  const custom = useCassettes((s) => s.skins);
  return useMemo(() => [...Object.values(custom), ...BUILTIN_IDS.map((id) => SKINS[id])], [custom]);
}
