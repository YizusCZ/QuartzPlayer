import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { BANDS, spectrum } from '@/audio/analyzer';

/**
 * Resamples the analyzer's 64 log bands to `count` bars and tracks falling
 * peak caps (hold 350 ms, then fall), all on the UI thread.
 */
export function useBars(count: number) {
  const peaks = useSharedValue<number[]>(new Array(count).fill(0));
  const hold = useSharedValue<number[]>(new Array(count).fill(0));

  const bars = useDerivedValue(() => {
    const s = spectrum.value;
    const out = new Array<number>(count);
    const step = BANDS / count;
    for (let i = 0; i < count; i++) {
      const a = Math.floor(i * step);
      const b = Math.max(a + 1, Math.floor((i + 1) * step));
      let v = 0;
      for (let k = a; k < b; k++) v = Math.max(v, s[k] ?? 0);
      out[i] = v;
    }
    return out;
  });

  useFrameCallback((f) => {
    'worklet';
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    const s = bars.value;
    const p = peaks.value.length === count ? peaks.value.slice() : new Array(count).fill(0);
    const h = hold.value.length === count ? hold.value.slice() : new Array(count).fill(0);
    for (let i = 0; i < count; i++) {
      if (s[i] >= p[i]) {
        p[i] = s[i];
        h[i] = 0.35;
      } else if (h[i] > 0) h[i] -= dt;
      else p[i] = Math.max(0, p[i] - dt * 0.6);
    }
    peaks.value = p;
    hold.value = h;
  });

  /** Low-band energy 0..1, for pulsing effects. */
  const bass = useDerivedValue(() => {
    const s = spectrum.value;
    return (s[2] + s[4] + s[6] + s[8]) / 4;
  });

  return { bars, peaks, bass };
}
