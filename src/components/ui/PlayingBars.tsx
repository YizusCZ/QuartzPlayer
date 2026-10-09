import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, useAccent } from '@/theme';

function Bar({ playing, delay }: { playing: boolean; delay: number }) {
  const h = useSharedValue(0.3);
  useEffect(() => {
    if (playing) {
      h.value = withRepeat(
        withSequence(withTiming(1, { duration: 320 + delay }), withTiming(0.25, { duration: 280 + delay })),
        -1,
        true,
      );
    } else {
      cancelAnimation(h);
      h.value = withTiming(0.3, { duration: 200 });
    }
  }, [playing, delay, h]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: h.value }] }));
  return <Animated.View style={[styles.bar, { backgroundColor: colors.accent }, style]} />;
}

/** Tiny animated equalizer marking the current track. */
export function PlayingBars({ playing }: { playing: boolean }) {
  useAccent();
  return (
    <View style={styles.row} accessibilityLabel={playing ? 'Reproduciendo' : 'En pausa'}>
      <Bar playing={playing} delay={0} />
      <Bar playing={playing} delay={90} />
      <Bar playing={playing} delay={40} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 },
  bar: { width: 3, height: 14, borderRadius: 1.5, transformOrigin: 'bottom' },
});
