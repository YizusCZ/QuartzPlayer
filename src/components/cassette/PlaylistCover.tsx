import { useEffect, useMemo, useState } from 'react';
import { PixelRatio, View } from 'react-native';
import { Canvas, Image as SkImageView, drawAsImage, type SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { hash } from '@/library/bytes';
import type { Playlist } from '@/store/library';
import { cassetteFonts, useSkiaFaces } from '../skiaFonts';
import { CassetteCoverArt } from './CassetteCoverArt';
import { SKINS, modelCode, type CassetteSkinId } from './skins';

const SKIN_IDS = Object.keys(SKINS) as CassetteSkinId[];

/** The cassette a playlist wears when it has no picture of its own. */
export function playlistSkin(p: Pick<Playlist, 'id' | 'skin'>): CassetteSkinId {
  return p.skin ?? SKIN_IDS[parseInt(hash(p.id), 36) % SKIN_IDS.length];
}

// Rasterised covers, shared by every list row and header that shows them.
const cache = new Map<string, SkImage>();
const MAX_CACHED = 48;

type Props = {
  playlist: Pick<Playlist, 'id' | 'name' | 'cover' | 'skin'>;
  count: number;
  /** Total length in seconds, printed as the tape's model number. */
  duration?: number;
  size: number;
  radius?: number;
};

export function PlaylistCover({ playlist, count, duration = 0, size, radius = 8 }: Props) {
  const faces = useSkiaFaces();
  const fonts = useMemo(() => (faces ? cassetteFonts(faces) : null), [faces]);
  const skin = playlistSkin(playlist);
  const ratio = PixelRatio.get();
  const px = Math.round(size * ratio);
  const subtitle = `${count} ${count === 1 ? 'canción' : 'canciones'}`;
  // A C90 holds 45 min a side; the printed length follows the playlist's.
  const model = modelCode(skin, duration / 2);
  const key = `${skin}|${playlist.name}|${subtitle}|${model}|${px}`;
  const [drawn, setDrawn] = useState<{ key: string; image: SkImage } | null>(null);
  const image = cache.get(key) ?? (drawn?.key === key ? drawn.image : null);

  useEffect(() => {
    if (playlist.cover || !fonts || cache.has(key)) return;
    let alive = true;
    const el = (
      <CassetteCoverArt
        skin={SKINS[skin]}
        fonts={fonts}
        size={px}
        title={playlist.name}
        subtitle={subtitle}
        model={model}
      />
    );
    void drawAsImage(el, { width: px, height: px }).then((img) => {
      if (!img) return;
      cache.set(key, img);
      // Typing a name in "Nueva lista" draws one per keystroke: keep the newest only.
      if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
      if (alive) setDrawn({ key, image: img });
    });
    return () => {
      alive = false;
    };
  }, [key, fonts, playlist.cover, playlist.name, skin, px, subtitle, model]);

  const box = { width: size, height: size, borderRadius: radius, overflow: 'hidden' as const };
  if (playlist.cover) {
    return <Image source={{ uri: playlist.cover }} style={box} contentFit="cover" transition={150} />;
  }
  return (
    <View style={[box, { backgroundColor: SKINS[skin].shell }]}>
      {image ? (
        <Canvas style={{ width: size, height: size }}>
          <SkImageView image={image} x={0} y={0} width={size} height={size} fit="fill" />
        </Canvas>
      ) : null}
    </View>
  );
}
