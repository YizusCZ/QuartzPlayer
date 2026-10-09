/**
 * AmbientShare: a living colour field made from the cover's dominant colours,
 * in the spirit of Apple Music's animated backgrounds.
 *
 * One SkSL shader paints the whole screen: four soft colour fields drift on
 * slow, domain-warped paths and blend by weight, so there are no edges, no
 * rotating images and no banding (a tiny dither is added). Colours cross-fade
 * when the track changes.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { LinearGradient } from 'expo-linear-gradient';
import { useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { extractPalette, fallbackPalette, type RGB } from '@/lib/palette';

export const AMBIENT_SKSL = `
uniform float2 res;
uniform float t;
uniform float3 c0;
uniform float3 c1;
uniform float3 c2;
uniform float3 c3;

float hash(float2 p) {
  p = fract(p * float2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float field(float2 p, float2 c, float r) {
  float2 d = p - c;
  return exp(-dot(d, d) / (r * r));
}

half4 main(float2 fc) {
  float aspect = res.x / res.y;
  float2 p = float2(fc.x / res.y, fc.y / res.y);

  // Gentle domain warp gives the liquid, folding motion.
  float2 q = p;
  q += 0.10 * float2(sin(q.y * 2.3 + t * 0.23), cos(q.x * 2.1 - t * 0.19));
  q += 0.06 * float2(sin(q.y * 4.1 - t * 0.31), cos(q.x * 3.7 + t * 0.27));

  float2 a = float2(aspect * (0.25 + 0.22 * sin(t * 0.13)), 0.20 + 0.16 * cos(t * 0.11));
  float2 b = float2(aspect * (0.78 + 0.16 * cos(t * 0.09)), 0.35 + 0.18 * sin(t * 0.15 + 1.7));
  float2 c = float2(aspect * (0.35 + 0.20 * cos(t * 0.12 + 2.4)), 0.72 + 0.16 * sin(t * 0.10));
  float2 d = float2(aspect * (0.72 + 0.18 * sin(t * 0.14 + 4.1)), 0.88 + 0.12 * cos(t * 0.13 + 0.6));

  float w0 = field(q, a, 0.30);
  float w1 = field(q, b, 0.28);
  float w2 = field(q, c, 0.33);
  float w3 = field(q, d, 0.30);
  float3 base = (c0 + c1 + c2 + c3) * 0.25;
  float wb = 0.015;
  float3 col = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + base * wb) / (w0 + w1 + w2 + w3 + wb);

  // Soft vignette and dither (kills 8-bit banding in smooth gradients).
  float2 uv = fc / res;
  col *= 0.86 + 0.14 * smoothstep(1.1, 0.2, length(uv - float2(0.5, 0.42)));
  col += (hash(fc) - 0.5) / 128.0;
  return half4(half3(col), 1.0);
}
`;

/**
 * The field is nothing but soft blobs, so it is shaded at 1/SCALE resolution
 * and stretched up (bilinear): 16× fewer pixels per frame, visually identical.
 */
const SCALE = 4;
/**
 * The drift is a few pixels per second, so 30 redraws/s look identical to the
 * display's 90–120 Hz while costing a third to a quarter of the GPU time.
 */
const FRAME_MS = 1000 / 30;

let effect: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
const getEffect = () => (effect ??= Skia.RuntimeEffect.Make(AMBIENT_SKSL));

type Props = {
  uri?: string;
  /** 0..1 darkness of the legibility scrim. */
  dim?: number;
  /** Freeze motion (e.g. during the open transition). */
  still?: boolean;
};

export function AmbientBackdrop({ uri, dim = 0.28, still }: Props) {
  const { width, height } = useWindowDimensions();
  const w = Math.ceil(width / SCALE);
  const h = Math.ceil(height / SCALE);
  const [loaded, setLoaded] = useState<{ uri: string; palette: RGB[] } | null>(null);
  const palette = uri && loaded?.uri === uri ? loaded.palette : fallbackPalette;
  // Shader time (ms), advanced at FRAME_MS steps; the Canvas only redraws when it changes.
  const time = useSharedValue(0);
  const acc = useSharedValue(0);
  const tick = useFrameCallback((f) => {
    'worklet';
    acc.value += f.timeSincePreviousFrame ?? 0;
    if (acc.value < FRAME_MS) return;
    time.value += acc.value;
    acc.value = 0;
  }, !still);

  // Cross-fade between palettes.
  const from = useSharedValue<number[]>(fallbackPalette.flat());
  const to = useSharedValue<number[]>(fallbackPalette.flat());
  const mix = useSharedValue(1);

  useEffect(() => {
    if (!uri) return;
    let alive = true;
    void extractPalette(uri).then((p) => alive && setLoaded({ uri, palette: p }));
    return () => {
      alive = false;
    };
  }, [uri]);

  useEffect(() => {
    const cur = from.value.map((v, i) => v + (to.value[i] - v) * mix.value);
    from.set(cur);
    to.set(palette.flat());
    mix.set(0);
    mix.set(withTiming(1, { duration: 900 }));
  }, [palette, from, to, mix]);

  // Frozen means no frame callback and no redraws at all.
  useEffect(() => {
    tick.setActive(!still);
  }, [still, tick]);

  const uniforms = useDerivedValue(() => {
    const f = from.value;
    const g = to.value;
    const m = mix.value;
    const c = (i: number) => [
      f[i] + (g[i] - f[i]) * m,
      f[i + 1] + (g[i + 1] - f[i + 1]) * m,
      f[i + 2] + (g[i + 2] - f[i + 2]) * m,
    ];
    // ×1.6: a touch livelier than a screensaver, still calm.
    const t = (time.value / 1000) * 1.6;
    return { res: [w, h], t, c0: c(0), c1: c(3), c2: c(6), c3: c(9) };
  });

  const fx = useMemo(() => getEffect(), []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {fx ? (
        <Canvas
          style={{
            position: 'absolute',
            width: w,
            height: h,
            left: (width - w) / 2,
            top: (height - h) / 2,
            transform: [{ scale: SCALE }],
          }}
        >
          <Fill>
            <Shader source={fx} uniforms={uniforms} />
          </Fill>
        </Canvas>
      ) : null}
      <LinearGradient
        colors={[`rgba(0,0,0,${dim + 0.1})`, `rgba(0,0,0,${dim})`, `rgba(0,0,0,${dim + 0.35})`]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
