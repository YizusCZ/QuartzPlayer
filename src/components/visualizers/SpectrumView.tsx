/**
 * Bar visualizers, all fed by the same analyzer bands:
 *  - SpectrumView: rounded bars with peak caps and a floor reflection
 *  - LedView: segmented hi-fi deck meter (green → amber → red style zones)
 *  - MirrorView: symmetric bars from a centre line with a soft glow
 *  - RadialView: bars around the cover art, pulsing with the bass
 * Paths are rebuilt on the UI thread from shared values; nothing crosses to JS.
 */
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image,
  LinearGradient,
  Path,
  Rect,
  Skia,
  SweepGradient,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useVisualizerColors } from '@/lib/useVisualizerColors';
import { useSettings } from '@/store/settings';
import { useBars } from './useBars';

type Props = { width: number; height: number };

const usePalette = useVisualizerColors;

/* ───────── classic bars ───────── */

export function SpectrumView({ width, height }: Props) {
  const count = useSettings((s) => s.barCount);
  const peakHold = useSettings((s) => s.peakHold);
  const colors = usePalette();
  const { bars, peaks } = useBars(count);

  const padX = 20;
  const floorY = height * 0.74;
  const maxH = floorY - 30;
  const gap = count > 48 ? 2 : 4;
  const barW = (width - padX * 2 - gap * (count - 1)) / count;

  const body = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const s = bars.value;
    for (let i = 0; i < count; i++) {
      const bh = Math.max(2, s[i] * maxH);
      b.addRRect({ rect: { x: padX + i * (barW + gap), y: floorY - bh, width: barW, height: bh }, rx: 2, ry: 2 });
    }
    return b.build();
  });
  const reflection = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const s = bars.value;
    for (let i = 0; i < count; i++) {
      b.addRect({ x: padX + i * (barW + gap), y: floorY + 6, width: barW, height: Math.max(1, s[i] * maxH * 0.3) });
    }
    return b.build();
  });
  const caps = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const p = peaks.value;
    for (let i = 0; i < count; i++) {
      b.addRect({ x: padX + i * (barW + gap), y: floorY - (p[i] ?? 0) * maxH - 6, width: barW, height: 2.5 });
    }
    return b.build();
  });

  return (
    <Canvas style={{ width, height }}>
      <Path path={body}>
        <LinearGradient start={vec(0, floorY)} end={vec(0, floorY - maxH)} colors={colors} positions={[0, 0.6, 1]} />
      </Path>
      {peakHold ? <Path path={caps} color={colors[2]} /> : null}
      <Group opacity={0.16}>
        <Path path={reflection}>
          <LinearGradient
            start={vec(0, floorY)}
            end={vec(0, floorY + maxH * 0.3)}
            colors={[colors[0], 'transparent']}
          />
        </Path>
      </Group>
      <Rect x={padX} y={floorY + 2} width={width - padX * 2} height={1} color="rgba(255,255,255,0.12)" />
    </Canvas>
  );
}

/* ───────── LED hi-fi meter ───────── */

const SEGMENTS = 22;

export function LedView({ width, height }: Props) {
  const count = Math.min(
    32,
    useSettings((s) => s.barCount),
  );
  const peakHold = useSettings((s) => s.peakHold);
  const colors = usePalette();
  const { bars, peaks } = useBars(count);

  const padX = 24;
  const top = height * 0.12;
  const bottom = height * 0.82;
  const gapX = 5;
  const gapY = 3;
  const colW = (width - padX * 2 - gapX * (count - 1)) / count;
  const segH = (bottom - top - gapY * (SEGMENTS - 1)) / SEGMENTS;
  const zone1 = Math.round(SEGMENTS * 0.6);
  const zone2 = Math.round(SEGMENTS * 0.85);

  const segRect = (i: number, k: number) => {
    'worklet';
    return { x: padX + i * (colW + gapX), y: bottom - (k + 1) * segH - k * gapY, width: colW, height: segH };
  };

  const unlit = (() => {
    const b = Skia.PathBuilder.Make();
    for (let i = 0; i < count; i++) for (let k = 0; k < SEGMENTS; k++) b.addRect(segRect(i, k));
    return b.build();
  })();

  const lit = (from: number, to: number) => {
    'worklet';
    const b = Skia.PathBuilder.Make();
    const s = bars.value;
    for (let i = 0; i < count; i++) {
      const n = Math.round(s[i] * SEGMENTS);
      for (let k = from; k < Math.min(n, to); k++) b.addRect(segRect(i, k));
    }
    return b.build();
  };
  const low = useDerivedValue(() => lit(0, zone1));
  const mid = useDerivedValue(() => lit(zone1, zone2));
  const high = useDerivedValue(() => lit(zone2, SEGMENTS));
  const peak = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const p = peaks.value;
    for (let i = 0; i < count; i++) {
      const k = Math.min(SEGMENTS - 1, Math.round((p[i] ?? 0) * SEGMENTS));
      if (k > 0) b.addRect(segRect(i, k));
    }
    return b.build();
  });

  return (
    <Canvas style={{ width, height }}>
      <Path path={unlit} color="rgba(255,255,255,0.05)" />
      <Group>
        <Path path={low} color={colors[0]} />
        <Path path={mid} color={colors[1]} />
        <Path path={high} color="#FF4B3E" />
        {peakHold ? <Path path={peak} color={colors[2]} /> : null}
      </Group>
      <Group opacity={0.5}>
        <Path path={low} color={colors[0]}>
          <BlurMask blur={8} style="normal" />
        </Path>
      </Group>
    </Canvas>
  );
}

/* ───────── mirrored ───────── */

export function MirrorView({ width, height }: Props) {
  const count = useSettings((s) => s.barCount);
  const colors = usePalette();
  const { bars } = useBars(count);
  const padX = 18;
  const cy = height / 2;
  const maxH = height * 0.36;
  const gap = count > 48 ? 2 : 3;
  const barW = (width - padX * 2 - gap * (count - 1)) / count;

  const body = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const s = bars.value;
    // Bass in the middle, treble toward both edges.
    for (let i = 0; i < count; i++) {
      const band = Math.abs(i - (count - 1) / 2) * 2;
      const v = s[Math.min(count - 1, Math.floor(band))] ?? 0;
      const h = Math.max(1.5, v * maxH);
      b.addRRect({
        rect: { x: padX + i * (barW + gap), y: cy - h, width: barW, height: h * 2 },
        rx: barW / 2,
        ry: barW / 2,
      });
    }
    return b.build();
  });

  return (
    <Canvas style={{ width, height }}>
      <Group opacity={0.55}>
        <Path path={body}>
          <LinearGradient
            start={vec(0, cy - maxH)}
            end={vec(0, cy + maxH)}
            colors={[colors[2], colors[0], colors[2]]}
          />
          <BlurMask blur={14} style="normal" />
        </Path>
      </Group>
      <Path path={body}>
        <LinearGradient start={vec(0, cy - maxH)} end={vec(0, cy + maxH)} colors={[colors[2], colors[1], colors[2]]} />
      </Path>
      <Rect x={padX} y={cy - 0.5} width={width - padX * 2} height={1} color="rgba(255,255,255,0.25)" />
    </Canvas>
  );
}

/* ───────── radial ───────── */

export function RadialView({ width, height, artwork }: Props & { artwork?: string }) {
  const count = Math.max(
    48,
    useSettings((s) => s.barCount),
  );
  const colors = usePalette();
  const { bars, bass } = useBars(count);
  const image = useImage(artwork ?? null);
  const cx = width / 2;
  const cy = height / 2;
  const r0 = Math.min(width, height) * 0.24;
  const maxL = Math.min(width, height) * 0.2;

  const rays = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const s = bars.value;
    const total = count * 2; // mirror left/right for symmetry
    for (let j = 0; j < total; j++) {
      const i = j < count ? j : total - 1 - j;
      const a = (j / total) * Math.PI * 2 - Math.PI / 2;
      const len = 3 + (s[i] ?? 0) * maxL;
      const c = Math.cos(a);
      const n = Math.sin(a);
      b.moveTo(cx + c * (r0 + 6), cy + n * (r0 + 6));
      b.lineTo(cx + c * (r0 + 6 + len), cy + n * (r0 + 6 + len));
    }
    return b.build();
  });
  const pulse = useDerivedValue(() => [{ scale: 1 + bass.value * 0.06 }]);
  const clip = Skia.PathBuilder.Make().addCircle(cx, cy, r0).build();

  return (
    <Canvas style={{ width, height }}>
      <Group opacity={0.45}>
        <Path path={rays} style="stroke" strokeWidth={4} strokeCap="round">
          <SweepGradient c={vec(cx, cy)} colors={[colors[0], colors[1], colors[2], colors[1], colors[0]]} />
          <BlurMask blur={10} style="normal" />
        </Path>
      </Group>
      <Path
        path={rays}
        style="stroke"
        strokeWidth={Math.max(2, (Math.PI * 2 * r0) / (count * 2) - 2)}
        strokeCap="round"
      >
        <SweepGradient c={vec(cx, cy)} colors={[colors[0], colors[1], colors[2], colors[1], colors[0]]} />
      </Path>
      <Group transform={pulse} origin={vec(cx, cy)}>
        <Circle cx={cx} cy={cy} r={r0 + 2} color="rgba(0,0,0,0.6)" />
        {image ? (
          <Group clip={clip}>
            <Image image={image} x={cx - r0} y={cy - r0} width={r0 * 2} height={r0 * 2} fit="cover" />
          </Group>
        ) : (
          <Circle cx={cx} cy={cy} r={r0} color="#1D1D20" />
        )}
        <Circle cx={cx} cy={cy} r={r0} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.18)" />
      </Group>
    </Canvas>
  );
}
