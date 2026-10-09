/**
 * Play queue: the current track, then "Up next" with drag-to-reorder (grab the
 * handle), per-row removal, and the already-played history folded away.
 * Dragging runs on the UI thread; rows make room with spring animations.
 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { FlatList, Pressable, StyleSheet, View, type ViewProps } from 'react-native';
import { router } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Player } from '@/audio/engine';
import { formatTime, type Track } from '@/library/types';
import { tap } from '@/lib/haptics';
import { Artwork } from '@/components/ui/Artwork';
import { FormatBadge } from '@/components/ui/FormatBadge';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { PlayingBars } from '@/components/ui/PlayingBars';
import { Txt } from '@/components/ui/Txt';
import { useLibrary } from '@/store/library';
import { usePlayer } from '@/store/player';
import { useUI } from '@/store/ui';
import { colors, radius, useAccent } from '@/theme';

const ROW = 66;
const SPRING = { damping: 22, stiffness: 260, mass: 0.7 };

type Drag = { from: SharedValue<number>; y: SharedValue<number>; count: number };

export default function Queue() {
  useAccent();
  const insets = useSafeAreaInsets();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const tracks = useLibrary((s) => s.tracks);
  const [showHistory, setShowHistory] = useState(false);

  const current = tracks[queue[index]];
  const upcoming = useMemo(
    () =>
      queue
        .slice(index + 1)
        .map((id, k) => ({ track: tracks[id], at: index + 1 + k }))
        .filter((x): x is { track: Track; at: number } => !!x.track),
    [queue, index, tracks],
  );
  const history = useMemo(
    () =>
      queue
        .slice(0, index)
        .map((id, k) => ({ track: tracks[id], at: k }))
        .filter((x): x is { track: Track; at: number } => !!x.track),
    [queue, index, tracks],
  );
  const remaining = upcoming.reduce((a, x) => a + (x.track.duration || 0), 0);

  // Drag state (indices are within `upcoming`).
  const from = useSharedValue(-1);
  const y = useSharedValue(0);
  const drag: Drag = { from, y, count: upcoming.length };

  // Reset only after the reordered list has rendered, so rows never flash.
  useEffect(() => {
    from.set(-1);
    y.set(0);
  }, [queue, from, y]);

  const commit = useCallback(
    (a: number, b: number) => {
      tap('medium');
      if (a === b) {
        from.set(-1);
        y.set(0);
        return;
      }
      Player.move(index + 1 + a, index + 1 + b);
    },
    [index, from, y],
  );

  const clearUpcoming = () => {
    for (let i = queue.length - 1; i > index; i--) Player.removeAt(i);
  };

  const header = (
    <View>
      {current ? (
        <View style={styles.nowCard}>
          <Artwork uri={current.artwork} seed={current.album} size={64} radius={10} />
          <View style={{ flex: 1, gap: 3 }}>
            <Txt variant="label" style={{ color: colors.accent }}>
              {playing ? 'REPRODUCIENDO' : 'EN PAUSA'}
            </Txt>
            <Txt variant="heading" numberOfLines={1}>
              {current.title}
            </Txt>
            <View style={styles.meta}>
              <FormatBadge format={current.format} compact />
              <Txt variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                {current.artist}
              </Txt>
            </View>
          </View>
          <PlayingBars playing={playing} />
        </View>
      ) : null}

      <View style={styles.repeatRow} accessibilityRole="radiogroup">
        {(
          [
            ['off', 'repeat-off', 'Sin repetir'],
            ['all', 'repeat', 'Repetir todo'],
            ['one', 'repeat-once', 'Repetir una'],
          ] as const
        ).map(([mode, icon, label]) => {
          const on = repeat === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => {
                tap('select');
                Player.setRepeat(mode);
              }}
              style={[styles.repeatBtn, on && { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Icon name={icon} size={18} color={on ? colors.accent : colors.textDim} />
              <Txt variant="caption" style={on && { color: colors.accent }}>
                {label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Txt variant="heading">A continuación</Txt>
          <Txt variant="caption">
            {upcoming.length} {upcoming.length === 1 ? 'canción' : 'canciones'} · {formatTime(remaining)}
          </Txt>
        </View>
        <Pressable
          onPress={Player.toggleShuffle}
          style={[styles.pill, shuffle && { backgroundColor: colors.accentSoft }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: shuffle }}
        >
          <Icon name="shuffle-variant" size={16} color={shuffle ? colors.accent : colors.textDim} />
          <Txt variant="caption" style={shuffle && { color: colors.accent }}>
            Aleatorio
          </Txt>
        </Pressable>
        <Pressable
          onPress={() => {
            const d = new Date();
            const name = `Cola ${d.toLocaleDateString()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
            useLibrary.getState().createPlaylist(
              name,
              queue.filter((id) => tracks[id]),
            );
            useUI.getState().showToast(`Guardada como “${name}”`);
          }}
          style={styles.pill}
          accessibilityRole="button"
          accessibilityLabel="Guardar la cola como lista"
        >
          <Icon name="playlist-plus" size={16} color={colors.textDim} />
        </Pressable>
        {upcoming.length ? (
          <Pressable onPress={clearUpcoming} style={styles.pill} accessibilityRole="button">
            <Icon name="playlist-remove" size={16} color={colors.textDim} />
            <Txt variant="caption">Limpiar</Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const footer = history.length ? (
    <View style={{ paddingBottom: insets.bottom + 24 }}>
      <Pressable
        onPress={() => setShowHistory((v) => !v)}
        style={styles.historyToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: showHistory }}
      >
        <Icon name="history" size={18} color={colors.textDim} />
        <Txt variant="caption" style={{ flex: 1 }}>
          Ya reproducidas ({history.length})
        </Txt>
        <Icon name={showHistory ? 'chevron-down' : 'chevron-right'} size={18} color={colors.textMute} />
      </Pressable>
      {showHistory
        ? history.map(({ track, at }) => (
            <Pressable
              key={`${track.id}:${at}`}
              onPress={() => Player.jumpTo(at)}
              style={[styles.row, { opacity: 0.55 }]}
              accessibilityRole="button"
            >
              <Artwork uri={track.artwork} seed={track.album} size={44} radius={6} />
              <RowText track={track} />
            </Pressable>
          ))
        : null}
    </View>
  ) : (
    <View style={{ height: insets.bottom + 24 }} />
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top > 30 ? 10 : insets.top + 6 }]}>
      <View style={styles.grip} />
      <View style={styles.header}>
        <Txt variant="title" style={{ flex: 1 }}>
          Cola
        </Txt>
        <IconButton icon="close" label="Cerrar" onPress={() => router.back()} />
      </View>
      <DragContext.Provider value={from}>
        <FlatList
          data={upcoming}
          keyExtractor={(x) => `${x.track.id}:${x.at}`}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={
            <Txt variant="caption" style={styles.empty}>
              No hay más canciones en la cola.
            </Txt>
          }
          getItemLayout={(_, i) => ({ length: ROW, offset: ROW * i, index: i })}
          CellRendererComponent={DragCell}
          renderItem={({ item, index: i }) => (
            <QueueRow track={item.track} i={i} at={item.at} drag={drag} onCommit={commit} />
          )}
          removeClippedSubviews={false}
          windowSize={9}
        />
      </DragContext.Provider>
    </View>
  );
}

const DragContext = createContext<SharedValue<number> | null>(null);

/** Lets the dragged row paint above its neighbours: zIndex must live on the cell. */
const DragCell = forwardRef<View, ViewProps & { index: number; children?: ReactNode }>(function DragCell(
  { style, index, ...rest },
  _ref,
) {
  const from = useContext(DragContext);
  const lift = useAnimatedStyle(() => ({ zIndex: from && from.value === index ? 10 : 0 }));
  return <Animated.View style={[style, lift]} {...rest} />;
});

function RowText({ track }: { track: Track }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Txt variant="bodyStrong" numberOfLines={1}>
        {track.title}
      </Txt>
      <View style={styles.meta}>
        <FormatBadge format={track.format} compact />
        <Txt variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
          {track.artist}
        </Txt>
      </View>
    </View>
  );
}

function QueueRow({
  track,
  i,
  at,
  drag,
  onCommit,
}: {
  track: Track;
  i: number;
  at: number;
  drag: Drag;
  onCommit: (from: number, to: number) => void;
}) {
  const { from, y, count } = drag;
  const lifted = useSharedValue(0);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      from.set(i);
      y.set(0);
      lifted.set(withTiming(1, { duration: 120 }));
    })
    .onUpdate((e) => {
      y.set(e.translationY);
    })
    .onFinalize(() => {
      const to = Math.max(0, Math.min(count - 1, i + Math.round(y.value / ROW)));
      lifted.set(withTiming(0, { duration: 160 }));
      // Settle visually on the target slot, then commit the new order.
      y.set(withSpring((to - i) * ROW, SPRING));
      scheduleOnRN(onCommit, i, to);
    });

  const style = useAnimatedStyle(() => {
    const f = from.value;
    if (f < 0) return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, shadowOpacity: 0, elevation: 0 };
    if (f === i) {
      return {
        transform: [{ translateY: y.value }, { scale: 1 + lifted.value * 0.03 }],
        zIndex: 10,
        shadowOpacity: 0.4 * lifted.value,
        elevation: 12 * lifted.value,
      };
    }
    const to = Math.max(0, Math.min(count - 1, f + Math.round(y.value / ROW)));
    let shift = 0;
    if (f < i && i <= to) shift = -ROW;
    else if (to <= i && i < f) shift = ROW;
    return {
      transform: [{ translateY: withSpring(shift, SPRING) }, { scale: 1 }],
      zIndex: 0,
      shadowOpacity: 0,
      elevation: 0,
    };
  });

  return (
    <Animated.View style={[styles.rowWrap, style]}>
      <Pressable
        onPress={() => Player.jumpTo(at)}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
        accessibilityRole="button"
        accessibilityLabel={`${track.title}, ${track.artist}`}
      >
        <Artwork uri={track.artwork} seed={track.album} size={44} radius={6} />
        <RowText track={track} />
        <Txt variant="mono">{track.duration ? formatTime(track.duration) : ''}</Txt>
        <IconButton
          icon="close"
          size={18}
          color={colors.textMute}
          label="Quitar de la cola"
          onPress={() => Player.removeAt(at)}
        />
        <GestureDetector gesture={pan}>
          <View style={styles.handle} accessibilityLabel="Arrastrar para reordenar" accessibilityRole="adjustable">
            <Icon name="drag-horizontal-variant" size={22} color={colors.textDim} />
          </View>
        </GestureDetector>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface3,
    marginBottom: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8 },
  nowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 16,
    marginTop: 4,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  repeatRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  repeatBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: colors.surface2,
  },
  rowWrap: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  row: { height: ROW, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 20, paddingRight: 4 },
  handle: { width: 44, height: ROW, alignItems: 'center', justifyContent: 'center' },
  historyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surface2,
  },
  empty: { textAlign: 'center', paddingVertical: 28 },
});
