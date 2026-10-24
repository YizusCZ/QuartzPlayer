import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Txt } from './Txt';

const GAP = 48;
/** Scroll speed, px per second. */
const SPEED = 36;
const PAUSE_MS = 1800;

type Props = {
  text: string;
  variant?: Parameters<typeof Txt>[0]['variant'];
  style?: StyleProp<TextStyle>;
  /** Centred when it fits. */
  center?: boolean;
};

/** One line of text that scrolls sideways when it does not fit, pausing at the start. */
export function Marquee({ text, variant, style, center }: Props) {
  const [box, setBox] = useState(0);
  const [full, setFull] = useState(0);
  const x = useSharedValue(0);
  const over = box > 0 && full > box + 1;

  useEffect(() => {
    cancelAnimation(x);
    x.set(0);
    if (!over) return;
    const dist = full + GAP;
    x.set(
      withRepeat(
        withSequence(
          withDelay(PAUSE_MS, withTiming(-dist, { duration: (dist / SPEED) * 1000, easing: Easing.linear })),
          withTiming(0, { duration: 0 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(x);
  }, [over, full, text, x]);

  const move = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.box} onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      {/* The text at its natural width, only to measure it. */}
      <View style={styles.measure} pointerEvents="none">
        <Txt variant={variant} style={[style, styles.natural]} onLayout={(e) => setFull(e.nativeEvent.layout.width)}>
          {text}
        </Txt>
      </View>
      {over ? (
        <Animated.View style={[styles.row, move]}>
          <Txt variant={variant} style={[style, styles.natural, { width: full, textAlign: 'left' }]}>
            {text}
          </Txt>
          <View style={{ width: GAP }} />
          <Txt variant={variant} style={[style, styles.natural, { width: full, textAlign: 'left' }]}>
            {text}
          </Txt>
        </Animated.View>
      ) : (
        <Txt variant={variant} numberOfLines={1} style={[style, center && { textAlign: 'center' }]}>
          {text}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', overflow: 'hidden' },
  measure: { position: 'absolute', left: 0, top: 0, width: 4000, opacity: 0, flexDirection: 'row' },
  natural: { flexShrink: 0 },
  row: { flexDirection: 'row', width: 8000 },
});
