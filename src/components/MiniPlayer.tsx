import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown, useAnimatedStyle } from 'react-native-reanimated';
import { playbackTime } from '@/audio/clock';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Player, transport } from '@/audio/engine';
import { useLibrary } from '@/store/library';
import { currentTrackId, usePlayer } from '@/store/player';
import { colors, useAccent } from '@/theme';
import { Artwork } from './ui/Artwork';
import { FormatBadge } from './ui/FormatBadge';
import { IconButton } from './ui/IconButton';
import { Txt } from './ui/Txt';

export const MINI_PLAYER_HEIGHT = 68;

export function MiniPlayer() {
  useAccent();
  const insets = useSafeAreaInsets();
  const id = usePlayer(currentTrackId);
  const playing = usePlayer((s) => s.playing);
  // Progress runs on the UI thread: no re-render of the bar 4×/s on every screen.
  const progress = useAnimatedStyle(() => {
    const t = transport.value;
    return { transform: [{ scaleX: t.duration > 0 ? Math.min(1, playbackTime() / t.duration) : 0 }] };
  });
  const track = useLibrary((s) => (id ? s.tracks[id] : undefined));
  if (!track) return null;

  return (
    <Animated.View entering={FadeInDown} style={[styles.wrap, { paddingBottom: insets.bottom + 8 }]}>
      <Pressable
        style={styles.bar}
        onPress={() => router.push('/player')}
        accessibilityRole="button"
        accessibilityLabel={`Abrir reproductor: ${track.title}`}
      >
        <Animated.View style={[styles.progress, { backgroundColor: colors.accent }, progress]} />
        <Artwork uri={track.artwork} seed={track.album} size={44} radius={6} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {track.title}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <FormatBadge format={track.format} compact />
            <Txt variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
              {track.artist}
            </Txt>
          </View>
        </View>
        <IconButton
          icon={playing ? 'pause' : 'play'}
          size={28}
          label={playing ? 'Pausar' : 'Reproducir'}
          onPress={Player.toggle}
        />
        <IconButton icon="skip-next" size={26} label="Siguiente" onPress={Player.next} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  bar: {
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2, width: '100%', transformOrigin: 'left' },
});
