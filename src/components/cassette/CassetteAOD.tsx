/**
 * Always-on display for the cassette: pure black (OLED pixels off), a dimmed
 * cassette, the clock and what's playing. The whole block drifts a few pixels
 * every minute so nothing burns into the panel. Any touch (or Back) wakes it.
 */
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '@/components/ui/Txt';
import type { Track } from '@/library/types';
import { usePlayer } from '@/store/player';
import { CASSETTE_H, CASSETTE_W } from './CassetteArt';
import { CassetteView } from './CassetteView';

/** How far (px) the content may wander from the centre to spare the panel. */
const DRIFT = 14;
const DRIFT_EVERY = 60_000;
const DIM = 0.55;

const clock = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (d: Date) => d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

type Props = {
  track: Track;
  side: 'A' | 'B';
  onWake: () => void;
};

export function CassetteAOD({ track, side, onWake }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const playing = usePlayer((s) => s.playing);
  const [now, setNow] = useState(() => new Date());
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [hint, setHint] = useState(true);

  useEffect(() => {
    // Tick on the minute boundary so the clock never lags.
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      t = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    tick();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setShift({ x: (Math.random() * 2 - 1) * DRIFT, y: (Math.random() * 2 - 1) * DRIFT });
    }, DRIFT_EVERY);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onWake();
      return true;
    });
    return () => sub.remove();
  }, [onWake]);

  // Always lay the cassette flat (wider than tall) so it never rotates.
  const landscape = width > height;
  const w = Math.min(width * (landscape ? 0.5 : 0.78), 440);
  const h = Math.round((w * CASSETTE_H) / CASSETTE_W) + 32;

  return (
    <Animated.View entering={FadeIn.duration(600)} exiting={FadeOut.duration(200)} style={styles.screen}>
      <StatusBar hidden />
      <Pressable
        style={[
          StyleSheet.absoluteFill,
          styles.center,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
          landscape && { flexDirection: 'row', gap: 32 },
        ]}
        onPress={onWake}
        accessibilityRole="button"
        accessibilityLabel={`Pantalla siempre activa. ${clock(now)}. ${track.title}, ${track.artist}. Toca para salir`}
      >
        <View style={[styles.center, { transform: [{ translateX: shift.x }, { translateY: shift.y }], gap: 18 }]}>
          <View style={{ alignItems: 'center' }}>
            <Txt variant="display" style={styles.clock}>
              {clock(now)}
            </Txt>
            <Txt variant="caption" style={[styles.dim, { textTransform: 'capitalize' }]}>
              {day(now)}
            </Txt>
          </View>
          <View style={{ opacity: DIM }} pointerEvents="none">
            <CassetteView track={track} width={w} height={h} side={side} />
          </View>
          <View style={{ alignItems: 'center', maxWidth: w, gap: 2 }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={styles.dim}>
              {playing ? '' : '❚❚  '}
              {track.title}
            </Txt>
            <Txt variant="caption" numberOfLines={1} style={styles.faint}>
              {track.artist}
            </Txt>
          </View>
        </View>
      </Pressable>
      {hint ? (
        <Animated.View
          exiting={FadeOut.duration(800)}
          style={[styles.hint, { bottom: insets.bottom + 24 }]}
          pointerEvents="none"
        >
          <Txt variant="label" style={styles.faint}>
            TOCA PARA SALIR
          </Txt>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  clock: { fontSize: 64, lineHeight: 72, color: 'rgba(242,240,236,0.72)', letterSpacing: 1 },
  dim: { color: 'rgba(242,240,236,0.55)' },
  faint: { color: 'rgba(242,240,236,0.38)' },
  hint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
