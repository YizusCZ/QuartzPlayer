import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import { Skia, type SkTypeface } from '@shopify/react-native-skia';
import type { CassetteFonts } from './cassette/CassetteArt';

export type SkiaFaces = {
  regular: SkTypeface;
  medium: SkTypeface;
  semibold: SkTypeface;
  bold: SkTypeface;
  cond: SkTypeface;
  brand: SkTypeface;
  hand: SkTypeface;
};

const SOURCES: Record<keyof SkiaFaces, number> = {
  regular: require('@expo-google-fonts/barlow/400Regular/Barlow_400Regular.ttf'),
  medium: require('@expo-google-fonts/barlow/500Medium/Barlow_500Medium.ttf'),
  semibold: require('@expo-google-fonts/barlow/600SemiBold/Barlow_600SemiBold.ttf'),
  bold: require('@expo-google-fonts/barlow/700Bold/Barlow_700Bold.ttf'),
  cond: require('@expo-google-fonts/barlow-condensed/700Bold/BarlowCondensed_700Bold.ttf'),
  brand: require('@expo-google-fonts/michroma/400Regular/Michroma_400Regular.ttf'),
  hand: require('@expo-google-fonts/caveat/600SemiBold/Caveat_600SemiBold.ttf'),
};

let loaded: SkiaFaces | null = null;
let loading: Promise<SkiaFaces> | null = null;

async function loadFace(mod: number): Promise<SkTypeface> {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const data = await Skia.Data.fromURI(asset.localUri ?? asset.uri);
  const face = Skia.Typeface.MakeFreeTypeFaceFromData(data);
  if (!face) throw new Error('No se pudo cargar una fuente');
  return face;
}

/** Loads every Skia typeface once per process; later calls resolve instantly. */
export function loadSkiaFaces(): Promise<SkiaFaces> {
  loading ??= (async () => {
    const keys = Object.keys(SOURCES) as (keyof SkiaFaces)[];
    const faces = await Promise.all(keys.map((k) => loadFace(SOURCES[k])));
    loaded = Object.fromEntries(keys.map((k, i) => [k, faces[i]])) as SkiaFaces;
    return loaded;
  })();
  return loading;
}

export function useSkiaFaces(): SkiaFaces | null {
  const [faces, setFaces] = useState<SkiaFaces | null>(loaded);
  useEffect(() => {
    if (faces) return;
    let alive = true;
    void loadSkiaFaces().then((f) => alive && setFaces(f));
    return () => {
      alive = false;
    };
  }, [faces]);
  return faces;
}

export function cassetteFonts(f: SkiaFaces): CassetteFonts {
  return {
    brand: Skia.Font(f.brand, 28),
    emboss: Skia.Font(f.brand, 11),
    model: Skia.Font(f.semibold, 44),
    side: Skia.Font(f.regular, 56),
    label: Skia.Font(f.regular, 25),
    labelSmall: Skia.Font(f.regular, 17),
    tiny: Skia.Font(f.medium, 12),
    hand: Skia.Font(f.hand, 34),
    handSmall: Skia.Font(f.hand, 24),
  };
}
