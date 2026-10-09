import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { playbackTime } from '@/audio/clock';
import { Player, transport } from '@/audio/engine';
import { formatTime } from '@/library/types';
import { usePlayer } from '@/store/player';
import { tap } from '@/lib/haptics';
import { colors } from '@/theme';
import { Txt } from './Txt';

/**
 * The fill and thumb move on the UI thread from the playback clock; React only
 * re-renders for the time labels, once a second.
 */
export function SeekBar() {
  const position = usePlayer((s) => Math.floor(s.position));
  const duration = usePlayer((s) => s.duration);
  const abA = usePlayer((s) => s.abA);
  const abB = usePlayer((s) => s.abB);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? position;
  const dragFrac = useSharedValue(-1);
  const w = useSharedValue(0);

  const toTime = (x: number) => Math.max(0, Math.min(1, x / Math.max(1, width))) * duration;
  const onDrag = (x: number) => {
    const t = toTime(x);
    dragFrac.value = duration > 0 ? t / duration : 0;
    setDrag(t);
  };
  const release = () => {
    dragFrac.value = -1;
    setDrag(null);
  };
  const onEnd = (x: number) => {
    Player.seek(toTime(x));
    release();
    tap('select');
  };

  const frac = () => {
    'worklet';
    if (dragFrac.value >= 0) return dragFrac.value;
    const t = transport.value;
    return t.duration > 0 ? Math.min(1, Math.max(0, playbackTime() / t.duration)) : 0;
  };
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: frac() }] }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: frac() * w.value }] }));

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(2)
    .onBegin((e) => onDrag(e.x))
    .onUpdate((e) => onDrag(e.x))
    .onEnd((e) => onEnd(e.x))
    .onFinalize((_e, ok) => {
      if (!ok) release();
    });
  const tapG = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => onEnd(e.x));

  const pct = (t: number | null) => (t != null && duration > 0 ? `${(t / duration) * 100}%` : undefined);

  return (
    <View>
      <GestureDetector gesture={Gesture.Exclusive(pan, tapG)}>
        <View
          style={styles.hit}
          onLayout={(e: LayoutChangeEvent) => {
            setWidth(e.nativeEvent.layout.width);
            w.value = e.nativeEvent.layout.width;
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Posición"
          accessibilityValue={{ text: `${formatTime(shown)} de ${formatTime(duration)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => Player.seekBy(e.nativeEvent.actionName === 'increment' ? 10 : -10)}
        >
          <View style={styles.track}>
            {abA != null ? (
              <View
                style={[
                  styles.ab,
                  {
                    left: pct(abA) as `${number}%`,
                    width: abB != null ? (`${((abB - abA) / duration) * 100}%` as `${number}%`) : 2,
                  },
                ]}
              />
            ) : null}
            <Animated.View style={[styles.fill, { backgroundColor: colors.accent }, fillStyle]} />
          </View>
          <Animated.View
            style={[styles.thumb, drag != null && [styles.thumbActive, { backgroundColor: colors.accent }], thumbStyle]}
          />
        </View>
      </GestureDetector>
      <View style={styles.times}>
        <Txt variant="mono">{formatTime(shown)}</Txt>
        <Txt variant="mono">-{formatTime(Math.max(0, duration - shown))}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 28, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surface3, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', transformOrigin: 'left' },
  ab: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(217,180,90,0.45)' },
  thumb: {
    position: 'absolute',
    left: 0,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.text,
  },
  thumbActive: { width: 20, height: 20, marginLeft: -10, borderRadius: 10 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
});
