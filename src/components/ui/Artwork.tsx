import { StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { hash } from '@/library/bytes';
import { colors, withAlpha } from '@/theme';
import { Icon } from './Icon';

const PALETTES: [string, string][] = [
  ['#3A2A1C', '#1B1511'],
  ['#2A2F3A', '#14161B'],
  ['#3A1F2C', '#1A1116'],
  ['#1F3330', '#111A18'],
  ['#35301C', '#19170F'],
];

type Props = {
  uri?: string;
  seed?: string;
  size: number;
  radius?: number;
  style?: StyleProp<ImageStyle>;
  /** Fade-in duration (ms); 0 where the cover must never blink. */
  transition?: number;
};

/** Cover art with a deterministic, quiet fallback when a file has none. */
export function Artwork({ uri, seed = '', size, radius = 8, style, transition = 150 }: Props) {
  const box = { width: size, height: size, borderRadius: radius };
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[box, styles.base, style]}
        contentFit="cover"
        transition={transition}
        recyclingKey={uri}
      />
    );
  }
  const pal = PALETTES[parseInt(hash(seed), 36) % PALETTES.length];
  return (
    <View style={[box, styles.base, style as object]}>
      <LinearGradient colors={pal} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <Icon name="cassette" size={size * 0.42} color={withAlpha(colors.accent, 0.55)} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
});
