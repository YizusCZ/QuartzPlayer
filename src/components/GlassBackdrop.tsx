import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { cachedPalette, extractPalette, fallbackPalette, type RGB } from '@/lib/palette';
import { trackById, useLibrary } from '@/store/library';
import { currentTrackId, usePlayer } from '@/store/player';
import { colors } from '@/theme';

const css = ([r, g, b]: RGB, light: number, alpha = 1) =>
  `rgba(${Math.round(r * 255 * light)},${Math.round(g * 255 * light)},${Math.round(b * 255 * light)},${alpha})`;

/**
 * What the Liquid Glass theme (src/theme.ts) looks through: deep gradients in
 * the colours of the current cover, always opaque, so one screen never shows
 * through another. Plain gradients cost nothing per frame, however many
 * screens are open.
 */
export function GlassBackdrop() {
  const id = usePlayer(currentTrackId);
  const artwork = useLibrary((s) => trackById(s, id)?.artwork);
  const [read, setRead] = useState<{ uri: string; palette: RGB[] } | null>(null);
  const known = cachedPalette(artwork) ?? (read?.uri === artwork ? read?.palette : undefined);

  useEffect(() => {
    if (!artwork || cachedPalette(artwork)) return;
    let live = true;
    void extractPalette(artwork).then((palette) => {
      if (live) setRead({ uri: artwork, palette });
    });
    return () => {
      live = false;
    };
  }, [artwork]);

  const p = known ?? fallbackPalette;
  const c = (i: number) => p[i % p.length];
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.base }]}>
      <LinearGradient
        colors={[css(c(0), 0.62), css(c(1), 0.34), css(c(2), 0.2)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[css(c(3), 0.7, 0), css(c(3), 0.7, 0.34)]}
        start={{ x: 0.2, y: 0.35 }}
        end={{ x: 1, y: 0.95 }}
        style={StyleSheet.absoluteFill}
      />
      {/* the light falling on the glass from above */}
      <LinearGradient
        colors={['rgba(255,255,255,0.1)', 'rgba(255,255,255,0)']}
        locations={[0, 0.32]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
