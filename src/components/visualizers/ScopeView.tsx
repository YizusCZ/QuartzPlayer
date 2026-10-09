/**
 * Phosphor-style scope: a stereo goniometer (M/S Lissajous, the classic
 * studio phase meter) above a time-domain trace, with short persistence.
 */
import { BlurMask, Canvas, Circle, Group, Path, RoundedRect, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { WAVE_POINTS, waveL, waveR } from '@/audio/analyzer';
import { useVisualizerColors } from '@/lib/useVisualizerColors';
import { useSettings } from '@/store/settings';

/** Classic green phosphor, unless the bars follow the cover. */
const GREEN = '#7CFFB2';

type Props = { width: number; height: number };

export function ScopeView({ width, height }: Props) {
  const fromCover = useSettings((s) => s.palette === 'cover');
  const tip = useVisualizerColors()[2];
  const PHOSPHOR = fromCover ? tip : GREEN;
  const pad = 20;
  const portrait = height > width;
  const size = Math.min(width - pad * 2, (portrait ? height * 0.62 : height) - pad * 2);
  const gx = portrait ? width / 2 : pad + size / 2;
  const gy = pad + size / 2;
  const tx = portrait ? pad : pad * 2 + size;
  const ty = portrait ? pad * 2 + size : pad;
  const tw = portrait ? width - pad * 2 : width - tx - pad;
  const th = portrait ? height - ty - pad : height - pad * 2;

  // Previous frames for phosphor persistence: [latest, 1 ago, 2 ago] as (L, R) pairs.
  const frames = useSharedValue<[number[], number[]][]>([]);
  useFrameCallback(() => {
    'worklet';
    const l = waveL.value;
    const f = frames.value;
    if (f[0]?.[0] !== l) frames.value = [[l, waveR.value] as [number[], number[]], ...f].slice(0, 3);
  });

  const lissajous = (l: number[], r: number[]) => {
    'worklet';
    const b = Skia.PathBuilder.Make();
    const k = size * 0.42;
    for (let i = 0; i < WAVE_POINTS; i++) {
      // Mid on the vertical axis, side on the horizontal one.
      const x = gx + ((l[i] - r[i]) / Math.SQRT2) * k;
      const y = gy - ((l[i] + r[i]) / Math.SQRT2) * k;
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
    return b.build();
  };
  const gonio = useDerivedValue(() => lissajous(waveL.value, waveR.value));
  const trail1 = useDerivedValue(() => {
    const f = frames.value[1];
    return f ? lissajous(f[0], f[1]) : Skia.Path.Make();
  });
  const trail2 = useDerivedValue(() => {
    const f = frames.value[2];
    return f ? lissajous(f[0], f[1]) : Skia.Path.Make();
  });

  const trace = useDerivedValue(() => {
    const l = waveL.value;
    const b = Skia.PathBuilder.Make();
    const mid = ty + th / 2;
    for (let i = 0; i < WAVE_POINTS; i++) {
      const x = tx + (i / (WAVE_POINTS - 1)) * tw;
      const y = mid - l[i] * th * 0.45;
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
    return b.build();
  });

  const graticule = (() => {
    const b = Skia.PathBuilder.Make();
    const r = size / 2;
    b.moveTo(gx - r, gy);
    b.lineTo(gx + r, gy);
    b.moveTo(gx, gy - r);
    b.lineTo(gx, gy + r);
    b.moveTo(gx - r * 0.7, gy - r * 0.7);
    b.lineTo(gx + r * 0.7, gy + r * 0.7);
    b.moveTo(gx + r * 0.7, gy - r * 0.7);
    b.lineTo(gx - r * 0.7, gy + r * 0.7);
    for (let k = 1; k < 8; k++) {
      const x = tx + (tw * k) / 8;
      b.moveTo(x, ty);
      b.lineTo(x, ty + th);
    }
    for (let k = 1; k < 4; k++) {
      const y = ty + (th * k) / 4;
      b.moveTo(tx, y);
      b.lineTo(tx + tw, y);
    }
    return b.build();
  })();

  return (
    <Canvas style={{ width, height }}>
      <RoundedRect x={gx - size / 2} y={gy - size / 2} width={size} height={size} r={size / 2} color="#06140D" />
      <RoundedRect x={tx} y={ty} width={tw} height={th} r={12} color="#06140D" />
      <Path path={graticule} style="stroke" strokeWidth={1} color="rgba(124,255,178,0.12)" />
      <Circle cx={gx} cy={gy} r={size / 2} style="stroke" strokeWidth={1.5} color="rgba(124,255,178,0.25)" />
      <Group opacity={0.18}>
        <Path path={trail2} style="stroke" strokeWidth={1.4} color={PHOSPHOR} />
      </Group>
      <Group opacity={0.35}>
        <Path path={trail1} style="stroke" strokeWidth={1.4} color={PHOSPHOR} />
      </Group>
      <Path path={gonio} style="stroke" strokeWidth={1.6} color={PHOSPHOR}>
        <BlurMask blur={2} style="solid" />
      </Path>
      <Path path={trace} style="stroke" strokeWidth={1.8} color={PHOSPHOR}>
        <BlurMask blur={2.5} style="solid" />
      </Path>
    </Canvas>
  );
}
