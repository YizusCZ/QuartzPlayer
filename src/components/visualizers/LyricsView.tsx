/**
 * Lyrics visualizer: karaoke-style synced lines over a drifting, blurred
 * cover. The active line lights up word by word (true word timings with
 * enhanced LRC, length-weighted estimates otherwise); the view follows the
 * song on the UI thread and pauses following while you scroll by hand.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { usePlaybackClock } from '@/audio/clock';
import { Player, transport } from '@/audio/engine';
import type { Track } from '@/library/types';
import { loadLyrics } from '@/lyrics/loader';
import type { LyricLine, LyricWord, Lyrics } from '@/lyrics/lrc';
import { tap } from '@/lib/haptics';
import { useSettings } from '@/store/settings';
import { colors, fonts } from '@/theme';
import { AmbientBackdrop } from '../AmbientBackdrop';
import { Icon } from '../ui/Icon';
import { Txt } from '../ui/Txt';

/** Index of the last line starting at or before `t` (-1 before the first). */
function indexAt(starts: number[], t: number): number {
  'worklet';
  let lo = 0;
  let hi = starts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Lines light up slightly early: reading leads singing. */
const LEAD = 0.18;
const FOLLOW_PAUSE_MS = 4000;

type Props = { track: Track; width: number; height: number };

export function LyricsView({ track, width, height }: Props) {
  const [loaded, setLoaded] = useState<{ id: string; lyrics: Lyrics } | null>(null);
  const online = useSettings((s) => s.onlineLyrics);
  // With AmbientShare the player already paints the same backdrop behind us.
  const ambient = useSettings((s) => s.ambientShare);
  const lyrics = loaded?.id === track.id ? loaded.lyrics : null;

  useEffect(() => {
    const ctrl = new AbortController();
    void loadLyrics(track, ctrl.signal).then((l) => {
      if (!ctrl.signal.aborted) setLoaded({ id: track.id, lyrics: l });
    });
    return () => ctrl.abort();
  }, [track, online]);

  const big = Math.min(width, height) > 500;

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      {ambient ? null : <AmbientBackdrop uri={track.artwork} dim={0.6} />}
      {lyrics == null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Txt variant="caption">Buscando la letra…</Txt>
        </View>
      ) : lyrics.kind === 'synced' ? (
        <Synced key={track.id} lines={lyrics.lines} height={height} big={big} />
      ) : lyrics.kind === 'plain' ? (
        <Plain key={track.id} text={lyrics.text} height={height} big={big} />
      ) : lyrics.kind === 'instrumental' ? (
        <View style={styles.center}>
          <Icon name="music-note" size={48} color={colors.accent} />
          <Txt variant="title">Instrumental</Txt>
        </View>
      ) : (
        <View style={styles.center}>
          <Icon name="music-box-multiple-outline" size={48} color={colors.textMute} />
          <Txt variant="heading">Sin letra para esta canción</Txt>
          <Txt variant="caption" style={{ textAlign: 'center', maxWidth: 280 }}>
            {online
              ? 'No está incrustada en el archivo ni disponible en LRCLIB. También puedes poner un .lrc con el mismo nombre junto al archivo.'
              : 'Activa “Buscar letras en internet” en Ajustes o añade un archivo .lrc junto a la canción.'}
          </Txt>
        </View>
      )}
      {lyrics && lyrics.kind !== 'none' && 'source' in lyrics ? (
        <Txt variant="mono" style={styles.source}>
          {lyrics.source === 'lrclib'
            ? 'LETRA · LRCLIB'
            : lyrics.source === 'file'
              ? 'LETRA · ARCHIVO .LRC'
              : 'LETRA · INCRUSTADA'}
        </Txt>
      ) : null}
    </View>
  );
}

/* ───────── synced ───────── */

function Synced({ lines, height, big }: { lines: LyricLine[]; height: number; big: boolean }) {
  const clock = usePlaybackClock();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const activeSV = useSharedValue(-1);
  const holdUntil = useSharedValue(0);
  const tops = useSharedValue<number[]>([]);
  const measured = useRef<number[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [active, setActive] = useState(-1);
  // Just below the floating top bar; the active line sits in the upper third.
  const anchor = Math.max(112, height * 0.2);
  // Worklets only see the start times: capturing `lines` (with every word)
  // would re-copy the whole song to the UI thread on each render.
  const starts = useMemo(() => lines.map((l) => l.start), [lines]);
  const count = lines.length;

  useAnimatedReaction(
    () => indexAt(starts, clock.value + LEAD),
    (idx, prev) => {
      if (idx === prev) return;
      activeSV.set(idx);
      scheduleOnRN(setActive, idx);
      const y = tops.value[Math.max(0, idx)];
      if (y != null && Date.now() > holdUntil.value) scrollTo(scrollRef, 0, Math.max(0, y - anchor), true);
    },
  );

  // When the view (re)appears, jump straight to where the song is once lines are measured.
  const synced = useSharedValue(false);
  useAnimatedReaction(
    () => tops.value.length,
    (n) => {
      if (n < count || synced.value) return;
      synced.set(true);
      const idx = indexAt(starts, clock.value + LEAD);
      activeSV.set(idx);
      scheduleOnRN(setActive, idx);
      const y = tops.value[Math.max(0, idx)] ?? 0;
      scrollTo(scrollRef, 0, Math.max(0, y - anchor), false);
    },
  );

  // Stable so memoised rows skip re-rendering when the active line moves.
  const onLineLayout = useCallback(
    (i: number, y: number) => {
      measured.current[i] = y;
      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => tops.set(measured.current.slice()), 30);
    },
    [tops],
  );

  const firstStart = lines[0]?.start ?? 0;

  return (
    <Animated.ScrollView
      ref={scrollRef}
      showsVerticalScrollIndicator={false}
      onScrollBeginDrag={() => holdUntil.set(Date.now() + FOLLOW_PAUSE_MS)}
      onMomentumScrollEnd={() => holdUntil.set(Date.now() + FOLLOW_PAUSE_MS)}
      contentContainerStyle={{ paddingTop: anchor, paddingBottom: height * 0.65, paddingHorizontal: 28 }}
    >
      {firstStart > 4 ? <Dots active={active < 0} clock={clock} from={0} to={firstStart} /> : null}
      {lines.map((l, i) => (
        <LineRow
          key={i}
          line={l}
          index={i}
          isActive={i === active}
          activeSV={activeSV}
          clock={clock}
          big={big}
          onLayout={onLineLayout}
        />
      ))}
    </Animated.ScrollView>
  );
}

type RowProps = {
  line: LyricLine;
  index: number;
  isActive: boolean;
  activeSV: SharedValue<number>;
  clock: SharedValue<number>;
  big: boolean;
  onLayout: (i: number, y: number) => void;
};

const LineRow = memo(function LineRow({ line, index, isActive, activeSV, clock, big, onLayout }: RowProps) {
  // Animate only when this row's own target changes: a line change then
  // touches a handful of rows instead of restarting animations on all of them.
  const opacity = useSharedValue(0.4);
  const scale = useSharedValue(0.94);
  useAnimatedReaction(
    () => {
      const d = Math.abs(index - activeSV.value);
      if (d === 0) return 1;
      return index < activeSV.value ? 0.28 : Math.max(0.22, 0.55 - d * 0.08);
    },
    (target, prev) => {
      if (target === prev) return;
      opacity.value = withTiming(target, { duration: 380 });
      scale.value = withTiming(target === 1 ? 1 : 0.94, { duration: 380, easing: Easing.out(Easing.cubic) });
    },
  );
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  const fontSize = big ? 34 : 28;

  return (
    <Pressable
      onLayout={(e: LayoutChangeEvent) => onLayout(index, e.nativeEvent.layout.y)}
      onPress={() => {
        tap('select');
        Player.seek(line.start);
      }}
      accessibilityRole="button"
      accessibilityLabel={line.text || 'Pausa instrumental'}
    >
      <Animated.View style={[styles.line, { transformOrigin: 'left center' }, style]}>
        {!line.text ? (
          <Dots active={isActive} clock={clock} from={line.start} to={line.end} />
        ) : isActive ? (
          <ActiveWords words={line.words} clock={clock} size={fontSize} />
        ) : (
          <Txt style={[styles.text, { fontSize, lineHeight: fontSize * 1.22 }]}>{line.text}</Txt>
        )}
      </Animated.View>
    </Pressable>
  );
});

/**
 * Word-by-word karaoke without per-frame work per word: one reaction tracks
 * which word is current (and whether we are playing); each word animates
 * itself with a timing sized to its remaining length at the current playback
 * rate. Per frame only the word being sung is animating.
 */
function ActiveWords({ words, clock, size }: { words: LyricWord[]; clock: SharedValue<number>; size: number }) {
  const starts = useMemo(() => words.map((w) => w.start), [words]);
  // >= -1: index of the current word while playing; <= -9: paused at index (-10 - code).
  const cursor = useSharedValue(-1);
  useAnimatedReaction(
    () => {
      const i = indexAt(starts, clock.value + LEAD);
      return transport.value.playing ? i : -10 - i;
    },
    (code, prev) => {
      if (code !== prev) cursor.set(code);
    },
  );
  return (
    <View style={styles.words}>
      {words.map((w, k) => (
        <Word key={k} k={k} word={w} cursor={cursor} clock={clock} size={size} />
      ))}
    </View>
  );
}

type WordProps = { k: number; word: LyricWord; cursor: SharedValue<number>; clock: SharedValue<number>; size: number };

function Word({ k, word, cursor, clock, size }: WordProps) {
  const p = useSharedValue(0);
  useAnimatedReaction(
    () => cursor.value,
    (code, prev) => {
      if (code === prev) return;
      const playing = code >= -1;
      const i = playing ? code : -10 - code;
      if (k < i) {
        p.value = withTiming(1, { duration: 120 });
        return;
      }
      if (k > i) {
        p.value = withTiming(0, { duration: 120 });
        return;
      }
      const span = Math.max(0.08, word.end - word.start);
      const done = Math.min(1, Math.max(0, (clock.value + LEAD - word.start) / span));
      cancelAnimation(p);
      p.value = done;
      if (!playing) return;
      const rate = transport.value.rate > 0 ? transport.value.rate : 1;
      p.value = withTiming(1, { duration: ((1 - done) * span * 1000) / rate, easing: Easing.linear });
    },
  );
  const style = useAnimatedStyle(() => {
    const v = p.value;
    const lift = v > 0 && v < 1 ? Math.sin(v * Math.PI) : 0;
    return { opacity: 0.34 + 0.66 * v, transform: [{ translateY: -2.5 * lift }] };
  });
  return (
    <Animated.Text
      style={[styles.text, styles.glow, { fontSize: size, lineHeight: size * 1.22, marginRight: size * 0.26 }, style]}
    >
      {word.text}
    </Animated.Text>
  );
}

/** Instrumental gap marker. Idle ones are plain views: only the live gap follows the clock. */
function Dots({ active, clock, from, to }: { active: boolean; clock: SharedValue<number>; from: number; to: number }) {
  if (!active) {
    return (
      <View style={styles.dots}>
        {[0, 1, 2].map((k) => (
          <View key={k} style={[styles.dot, styles.dotIdle]} />
        ))}
      </View>
    );
  }
  return <LiveDots clock={clock} from={from} to={to} />;
}

function LiveDots({ clock, from, to }: { clock: SharedValue<number>; from: number; to: number }) {
  const breathe = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 700 })), -1);
    return () => cancelAnimation(breathe);
  }, [breathe]);
  // How many of the three dots are lit across the gap (0..3); changes 3 times per gap.
  const lit = useSharedValue(0);
  useAnimatedReaction(
    () => Math.ceil(Math.min(1, Math.max(0, (clock.value - from) / Math.max(0.5, to - from))) * 3),
    (n, prev) => {
      if (n !== prev) lit.set(n);
    },
  );
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((k) => (
        <Dot key={k} k={k} lit={lit} breathe={breathe} />
      ))}
    </View>
  );
}

function Dot({ k, lit, breathe }: { k: number; lit: SharedValue<number>; breathe: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: lit.value > k ? 1 : 0.3,
    transform: [{ scale: 1 + breathe.value * 0.25 }],
  }));
  return <Animated.View style={[styles.dot, style]} />;
}

/* ───────── plain (unsynced) ───────── */

function Plain({ text, height, big }: { text: string; height: number; big: boolean }) {
  const clock = usePlaybackClock();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const holdUntil = useSharedValue(0);
  const contentH = useSharedValue(0);

  useAnimatedReaction(
    () => Math.floor(clock.value * 2),
    () => {
      if (Date.now() < holdUntil.value || contentH.value <= height) return;
      const d = transport.value.duration;
      const p = d > 0 ? Math.min(1, clock.value / d) : 0;
      scrollTo(scrollRef, 0, p * (contentH.value - height * 0.6), true);
    },
  );

  return (
    <Animated.ScrollView
      ref={scrollRef}
      onScrollBeginDrag={() => holdUntil.set(Date.now() + FOLLOW_PAUSE_MS * 2)}
      onContentSizeChange={(_w, h) => contentH.set(h)}
      contentContainerStyle={{ padding: 28, paddingTop: 112, paddingBottom: height * 0.4 }}
      showsVerticalScrollIndicator={false}
    >
      <Txt style={[styles.text, { fontSize: big ? 26 : 22, lineHeight: big ? 38 : 32, opacity: 0.9 }]}>{text}</Txt>
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  line: { paddingVertical: 10 },
  words: { flexDirection: 'row', flexWrap: 'wrap' },
  text: { fontFamily: fonts.bold, color: '#FFFFFF', letterSpacing: -0.3 },
  glow: { textShadowColor: 'rgba(255,255,255,0.45)', textShadowRadius: 14, textShadowOffset: { width: 0, height: 0 } },
  dots: { flexDirection: 'row', gap: 10, paddingVertical: 18, paddingLeft: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF' },
  dotIdle: { opacity: 0.2, transform: [{ scale: 0.85 }] },
  source: { position: 'absolute', right: 16, bottom: 12, fontSize: 10, opacity: 0.6 },
});
