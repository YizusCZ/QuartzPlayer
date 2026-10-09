/**
 * Procedural materials for the cassette, evaluated per pixel in SkSL.
 * All coordinates are in cassette design units (1000 × 636); `px` is the
 * number of device pixels per unit so edges stay anti-aliased at any size.
 */
import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

const NOISE = `
float hash(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/**
 * Moulded shell: a fine grid of square pads separated by grooves, each pad
 * with a lit top-left bevel and shaded bottom-right bevel, over a slightly
 * mottled plastic with a broad light falloff.
 */
const SHELL = `
uniform float cell;
uniform float px;
uniform float3 base;
uniform float3 light;
uniform float2 size;
${NOISE}
half4 main(float2 p) {
  float2 q = p / cell;
  float2 f = fract(q) - 0.5;
  float2 d = 0.5 - abs(f);
  float aa = 1.0 / (cell * px);
  float gw = max(0.06, 0.75 * aa);
  float bw = gw + max(0.12, 1.4 * aa);
  float groove = smoothstep(gw - aa, gw + aa, d.x) * smoothstep(gw - aa, gw + aa, d.y);
  float bx = 1.0 - smoothstep(gw, bw, d.x);
  float by = 1.0 - smoothstep(gw, bw, d.y);
  float shade = (f.x < 0.0 ? bx : -bx) * 0.55 + (f.y < 0.0 ? by : -by) * 0.75;

  float grain = vnoise(p * 1.7) * 0.5 + vnoise(p * 0.21) * 0.35 + vnoise(p * 0.03) * 0.15;
  float2 uv = p / size;
  float fall = 1.0 - 0.28 * length(uv - float2(0.3, 0.2));
  float3 col = mix(base, light, 0.35 * fall);
  col *= 0.93 + 0.12 * grain;
  col *= 0.975 + 0.05 * hash(floor(q));
  col += shade * 0.07;
  col *= mix(0.62, 1.0, groove);
  return half4(half3(col), 1.0);
}
`;

/** Brushed foil for the label stripe and the lower band: long horizontal streaks. */
const BRUSHED = `
uniform float3 c0;
uniform float3 c1;
uniform float2 origin;
uniform float2 size;
uniform float amount;
${NOISE}
half4 main(float2 p) {
  float2 uv = (p - origin) / size;
  float s = vnoise(float2(p.x * 0.006, p.y * 0.85)) * 0.55
          + vnoise(float2(p.x * 0.03, p.y * 2.6)) * 0.30
          + vnoise(float2(p.x * 0.2, p.y * 7.0)) * 0.15;
  float3 col = mix(c0, c1, smoothstep(0.0, 1.0, uv.x * 0.8 + uv.y * 0.35));
  // Soft specular band across the foil.
  col *= 1.04 - 0.08 * uv.x;
  col *= 1.0 - amount * 0.5 + amount * s;
  return half4(half3(col), 1.0);
}
`;

/** Label paper: off-white with faint fibres. */
const PAPER = `
uniform float3 tint;
${NOISE}
half4 main(float2 p) {
  float n = vnoise(p * 0.6) * 0.6 + vnoise(float2(p.x * 2.5, p.y * 0.4)) * 0.4;
  return half4(half3(tint * (0.975 + 0.045 * n)), 1.0);
}
`;

/** Wound tape: dark oxide with fine concentric winding lines and a satin sheen. */
const TAPE = `
uniform float2 c;
uniform float r;
${NOISE}
half4 main(float2 p) {
  float2 v = p - c;
  float d = length(v);
  float wind = hash(float2(floor(d * 1.3), 7.0));
  float3 col = float3(0.20, 0.145, 0.105) * (0.86 + 0.2 * wind);
  float a = atan(v.y, v.x);
  col += 0.05 * pow(max(0.0, cos(a - 2.3)), 6.0) * smoothstep(0.0, r, d);
  float rim = smoothstep(r - 3.0, r - 0.5, d);
  col = mix(col, float3(0.46, 0.36, 0.27), rim * 0.8);
  return half4(half3(col), 1.0);
}
`;

let cache: Record<string, SkRuntimeEffect> | null = null;

export function effects() {
  if (!cache) {
    const make = (src: string, name: string) => {
      const e = Skia.RuntimeEffect.Make(src);
      if (!e) throw new Error(`SkSL ${name} failed to compile`);
      return e;
    };
    cache = {
      shell: make(SHELL, 'shell'),
      brushed: make(BRUSHED, 'brushed'),
      paper: make(PAPER, 'paper'),
      tape: make(TAPE, 'tape'),
    };
  }
  return cache;
}

export const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
