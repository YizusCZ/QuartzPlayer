/**
 * Twin analog VU meters. The scale follows the standard VU law (deflection
 * proportional to voltage, 0 VU ≙ −18 dBFS) and the needles use a damped
 * spring tuned to roughly the 300 ms VU integration time.
 */
import { useMemo } from 'react';
import {
  Canvas,
  Circle,
  Group,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  RoundedRect,
  Skia,
  Text,
  vec,
  type SkFont,
} from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { levels } from '@/audio/analyzer';
import { textWidth } from '../cassette/CassetteArt';
import { useSkiaFaces } from '../skiaFonts';

const MIN_VU = -20;
const MAX_VU = 3;
const SWEEP = (50 * Math.PI) / 180;
const MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];

function vuPos(db: number): number {
  'worklet';
  const lo = Math.pow(10, MIN_VU / 20);
  const hi = Math.pow(10, MAX_VU / 20);
  const v = Math.pow(10, Math.min(MAX_VU + 1, db) / 20);
  return Math.max(0, Math.min(1.04, (v - lo) / (hi - lo)));
}
const angleOf = (pos: number) => {
  'worklet';
  return -SWEEP + pos * SWEEP * 2;
};

type MeterProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  needle: SharedValue<number>;
  peak: SharedValue<number>;
  font: SkFont;
  small: SkFont;
};

function Meter({ x, y, w, h, label, needle, peak, font, small }: MeterProps) {
  const cx = x + w / 2;
  const py = y + h * 1.02;
  const R = h * 0.86;

  const scale = useMemo(() => {
    const ticks = Skia.PathBuilder.Make();
    const red = Skia.PathBuilder.Make();
    const arcR = R * 0.8;
    const oval = { x: cx - arcR, y: py - arcR, width: arcR * 2, height: arcR * 2 };
    const deg = (a: number) => (a * 180) / Math.PI - 90;
    ticks.addArc(oval, deg(angleOf(0)), deg(angleOf(vuPos(0))) - deg(angleOf(0)));
    red.addArc(oval, deg(angleOf(vuPos(0))), deg(angleOf(1)) - deg(angleOf(vuPos(0))));
    const labels: { t: string; x: number; y: number; red: boolean }[] = [];
    for (const m of MARKS) {
      const a = angleOf(vuPos(m));
      const s = Math.sin(a);
      const c = -Math.cos(a);
      const len = m === 0 || m === -20 || m === 3 ? 12 : 8;
      const target = m > 0 ? red : ticks;
      target.moveTo(cx + s * arcR, py + c * arcR);
      target.lineTo(cx + s * (arcR + len), py + c * (arcR + len));
      const t = m > 0 ? `+${m}` : `${m}`;
      const lr = arcR + 26;
      labels.push({ t, x: cx + s * lr - textWidth(small, t) / 2, y: py + c * lr + 5, red: m > 0 });
    }
    for (let k = 0; k <= 10; k++) {
      const a = angleOf(k / 10);
      const s = Math.sin(a);
      const c = -Math.cos(a);
      ticks.moveTo(cx + s * (arcR - 10), py + c * (arcR - 10));
      ticks.lineTo(cx + s * (arcR - 4), py + c * (arcR - 4));
    }
    return { ticks: ticks.build(), red: red.build(), labels };
  }, [R, cx, py, small]);

  const rot = useDerivedValue(() => [{ rotate: angleOf(needle.value) }]);
  const ledOpacity = useDerivedValue(() => 0.15 + 0.85 * peak.value);

  return (
    <Group>
      <RoundedRect x={x - 6} y={y - 6} width={w + 12} height={h + 12} r={16} color="#0E0E0F" />
      <Group clip={{ rect: { x, y, width: w, height: h }, rx: 10, ry: 10 }}>
        <RoundedRect x={x} y={y} width={w} height={h} r={10}>
          <RadialGradient c={vec(cx, y + h * 0.75)} r={w * 0.75} colors={['#FFF1CF', '#F2D9A2', '#C9A767']} />
        </RoundedRect>
        <Path path={scale.ticks} style="stroke" strokeWidth={2} color="#2B2419" />
        <Path path={scale.red} style="stroke" strokeWidth={4} color="#C8322B" />
        {scale.labels.map((l) => (
          <Text key={l.t} x={l.x} y={l.y} text={l.t} font={small} color={l.red ? '#C8322B' : '#2B2419'} />
        ))}
        <Text x={cx - textWidth(font, 'VU') / 2} y={y + h * 0.7} text="VU" font={font} color="#2B2419" />
        <Text x={x + 14} y={y + h - 14} text={label} font={small} color="#2B2419" />
        <Group transform={rot} origin={vec(cx, py)}>
          <Line p1={vec(cx, py)} p2={vec(cx, py - R * 0.98)} strokeWidth={2.2} color="#1A1612" />
        </Group>
        <Circle cx={cx} cy={py} r={h * 0.2} color="#1E1C19" />
        <RoundedRect x={x} y={y} width={w} height={h * 0.22} r={10}>
          <LinearGradient
            start={vec(0, y)}
            end={vec(0, y + h * 0.22)}
            colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']}
          />
        </RoundedRect>
      </Group>
      <Circle cx={x + w - 18} cy={y + h - 18} r={5} color="#FF3B30" opacity={ledOpacity} />
      <Text x={x + w - 58} y={y + h - 13} text="PEAK" font={small} color="#2B2419" />
    </Group>
  );
}

type Props = { width: number; height: number };

export function VUMeterView({ width, height }: Props) {
  const faces = useSkiaFaces();
  const fonts = useMemo(
    () => (faces ? { font: Skia.Font(faces.cond, 30), small: Skia.Font(faces.medium, 13) } : null),
    [faces],
  );
  const nL = useSharedValue(0);
  const nR = useSharedValue(0);
  const vL = useSharedValue(0);
  const vR = useSharedValue(0);
  const peakL = useSharedValue(0);
  const peakR = useSharedValue(0);

  useFrameCallback((f) => {
    'worklet';
    const dt = Math.min(0.033, (f.timeSincePreviousFrame ?? 16) / 1000);
    let [l, r] = levels.value;
    if (!Number.isFinite(l)) l = -90;
    if (!Number.isFinite(r)) r = -90;
    const tl = vuPos(l + 18);
    const tr = vuPos(r + 18);
    // Damped spring ≈ 300 ms rise, slight overshoot like a real movement.
    vL.value += ((tl - nL.value) * 110 - vL.value * 17) * dt;
    vR.value += ((tr - nR.value) * 110 - vR.value * 17) * dt;
    if (!Number.isFinite(vL.value) || !Number.isFinite(nL.value)) {
      vL.value = 0;
      nL.value = 0;
    }
    if (!Number.isFinite(vR.value) || !Number.isFinite(nR.value)) {
      vR.value = 0;
      nR.value = 0;
    }
    nL.value = Math.max(-0.02, Math.min(1.06, nL.value + vL.value * dt));
    nR.value = Math.max(-0.02, Math.min(1.06, nR.value + vR.value * dt));
    peakL.value = l + 18 > 1 ? 1 : Math.max(0, peakL.value - dt * 2.5);
    peakR.value = r + 18 > 1 ? 1 : Math.max(0, peakR.value - dt * 2.5);
  });

  if (!fonts) return null;
  const portrait = height > width;
  const pad = 20;
  const mw = portrait ? Math.min(width - pad * 2, 520) : Math.min((width - pad * 3) / 2, 520);
  const mh = Math.min(mw * 0.62, portrait ? (height - pad * 3) / 2 : height - pad * 2);
  const x1 = portrait ? (width - mw) / 2 : (width - mw * 2 - pad) / 2;
  const y1 = portrait ? (height - mh * 2 - pad) / 2 : (height - mh) / 2;
  const x2 = portrait ? x1 : x1 + mw + pad;
  const y2 = portrait ? y1 + mh + pad : y1;

  return (
    <Canvas style={{ width, height }}>
      <Meter x={x1} y={y1} w={mw} h={mh} label="L" needle={nL} peak={peakL} {...fonts} />
      <Meter x={x2} y={y2} w={mw} h={mh} label="R" needle={nR} peak={peakR} {...fonts} />
    </Canvas>
  );
}
