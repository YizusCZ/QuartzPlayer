/**
 * Guided help tours: a dimmed screen with a hole over one element at a time
 * and a card explaining it. Screens mark their elements with `useTourRef` /
 * `TourTarget`; a `HelpButton` starts the tour written for that screen.
 * Steps whose element is not on screen right now are skipped.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { create } from 'zustand';
import { tap } from '@/lib/haptics';
import { colors, radius } from '@/theme';
import { IconButton } from '../ui/IconButton';
import { Txt } from '../ui/Txt';
import { TOURS, type TourId, type TourStep } from './tours';

// Every mounted view per id; the newest one wins (the screen on top of the stack).
const targets = new Map<string, View[]>();

function register(id: string, view: View) {
  targets.set(id, [...(targets.get(id) ?? []).filter((v) => v !== view), view]);
  return () => {
    const rest = (targets.get(id) ?? []).filter((v) => v !== view);
    if (rest.length) targets.set(id, rest);
    else targets.delete(id);
  };
}

/** Ref that marks a view as the element `id` of a tour. */
export function useTourRef(id: string) {
  return useCallback((view: View | null) => (view ? register(id, view) : undefined), [id]);
}

/** Wraps an element that has no view of its own to hang a tour ref on. */
export function TourTarget({ id, style, children }: { id: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const ref = useTourRef(id);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}

type ScrollLike = { scrollTo: (o: { y: number; animated?: boolean }) => void };
type Scroller = { view: ScrollLike | null; y: number };
// Scrollable screens, newest last, so a step can bring its element into view.
let scrollers: Scroller[] = [];

function createScroller() {
  const entry: Scroller = { view: null, y: 0 };
  return {
    ref: (view: ScrollLike | null) => {
      if (!view) return;
      entry.view = view;
      scrollers = [...scrollers, entry];
      return () => {
        scrollers = scrollers.filter((x) => x !== entry);
      };
    },
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      entry.y = e.nativeEvent.contentOffset.y;
    },
  };
}

/** Props for a screen's ScrollView, so tours can scroll down to what they explain. */
export function useTourScroll() {
  const [scroller] = useState(createScroller);
  return { ref: scroller.ref, onScroll: scroller.onScroll, scrollEventThrottle: 32 };
}

const useTour = create<{ steps: TourStep[] | null; index: number }>()(() => ({ steps: null, index: 0 }));

/** True while a tour is on screen (the player keeps its controls up meanwhile). */
export const useTourActive = () => useTour((s) => !!s.steps);

export function startTour(id: TourId) {
  const steps = TOURS[id].filter((s) => !s.target || targets.has(s.target));
  if (steps.length) useTour.setState({ steps, index: 0 });
}

/** The "?" button that explains the screen it sits on. */
export function HelpButton({ tour, size }: { tour: TourId; size?: number }) {
  return <IconButton icon="help-circle-outline" label="Ayuda" size={size} onPress={() => startTour(tour)} />;
}

type Rect = { x: number; y: number; w: number; h: number };
const PAD = 6;

function measure(id: string | undefined): Promise<Rect | null> {
  const view = id ? targets.get(id)?.at(-1) : undefined;
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) =>
    view.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x, y, w, h } : null)),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Measures a step's element, first scrolling it into view when it is off screen. */
async function locate(id: string | undefined, H: number): Promise<Rect | null> {
  const r = await measure(id);
  if (!r || (r.y >= 72 && r.y + r.h <= H - 150)) return r;
  const sc = scrollers.at(-1);
  if (!sc?.view) return r;
  sc.view.scrollTo({ y: Math.max(0, sc.y + r.y - H * 0.28), animated: true });
  await sleep(450);
  return measure(id);
}

/** Mounted once at the root; shows whichever tour is running. */
export function TourOverlay() {
  const steps = useTour((s) => s.steps);
  const index = useTour((s) => s.index);
  const setIndex = (i: number) => useTour.setState({ index: i });
  const [shown, setShown] = useState<{ step: TourStep; rect: Rect | null } | null>(null);
  const { width: W, height: H } = useWindowDimensions();
  const step = steps?.[index];

  useEffect(() => {
    if (!step) return;
    let alive = true;
    void locate(step.target, H).then((rect) => alive && setShown({ step, rect }));
    return () => {
      alive = false;
    };
  }, [step, H]);

  const stop = () => {
    useTour.setState({ steps: null, index: 0 });
    setShown(null);
  };
  const next = () => {
    tap('select');
    if (!steps || index >= steps.length - 1) stop();
    else setIndex(index + 1);
  };
  const back = () => {
    tap('select');
    setIndex(Math.max(0, index - 1));
  };

  useEffect(() => {
    if (!steps) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (useTour.setState({ steps: null }), true));
    return () => sub.remove();
  }, [steps]);

  if (!steps || !step) return null;
  const ready = shown?.step === step;
  const rect = ready ? shown.rect : null;
  const hole = rect
    ? {
        x: Math.max(0, rect.x - PAD),
        y: Math.max(0, rect.y - PAD),
        w: Math.min(W, rect.w + PAD * 2),
        h: rect.h + PAD * 2,
      }
    : null;
  // The card goes on whichever side of the element has more room.
  const below = hole ? hole.y + hole.h / 2 < H / 2 : false;
  const cardPos: ViewStyle = !hole
    ? { top: H * 0.32 }
    : below
      ? { top: Math.min(hole.y + hole.h + 14, H - 220) }
      : { bottom: Math.min(H - hole.y + 14, H - 220) };
  const last = index === steps.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={stop} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={next} accessibilityLabel="Siguiente">
        {hole ? (
          <>
            <View style={[styles.dim, { left: 0, top: 0, width: W, height: hole.y }]} />
            <View style={[styles.dim, { left: 0, top: hole.y + hole.h, width: W, bottom: 0 }]} />
            <View style={[styles.dim, { left: 0, top: hole.y, width: hole.x, height: hole.h }]} />
            <View style={[styles.dim, { left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h }]} />
            <View
              pointerEvents="none"
              style={[
                styles.ring,
                { left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderColor: colors.accent },
              ]}
            />
          </>
        ) : (
          <View style={[styles.dim, StyleSheet.absoluteFill]} />
        )}
      </Pressable>
      {ready ? (
        <View style={[styles.card, cardPos]}>
          <Txt variant="label" style={{ color: colors.accent }}>
            {index + 1} DE {steps.length}
          </Txt>
          <Txt variant="heading">{step.title}</Txt>
          <Txt variant="body" style={{ color: colors.textDim }}>
            {step.body}
          </Txt>
          <View style={styles.actions}>
            <Pressable onPress={stop} hitSlop={8} accessibilityRole="button">
              <Txt variant="bodyStrong" style={{ color: colors.textMute }}>
                Saltar
              </Txt>
            </Pressable>
            <View style={{ flex: 1 }} />
            {index > 0 ? (
              <Pressable onPress={back} style={styles.btn} accessibilityRole="button">
                <Txt variant="bodyStrong">Atrás</Txt>
              </Pressable>
            ) : null}
            <Pressable
              onPress={next}
              style={[styles.btn, { backgroundColor: colors.accent }]}
              accessibilityRole="button"
            >
              <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
                {last ? 'Entendido' : 'Siguiente'}
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)' },
  ring: { position: 'absolute', borderWidth: 2, borderRadius: 14 },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 8,
    padding: 18,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surface3,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.surface3 },
});
