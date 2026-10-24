/**
 * Dominant-colour extraction from cover art, for AmbientShare.
 * The image is scaled to 24×24 on a CPU surface, then pixels are bucketed by
 * hue/lightness and scored by frequency × saturation.
 */
import { Skia } from '@shopify/react-native-skia';

export type RGB = [number, number, number]; // 0..1

const cache = new Map<string, RGB[]>();
const FALLBACK: RGB[] = [
  [0.55, 0.3, 0.12],
  [0.35, 0.16, 0.3],
  [0.12, 0.22, 0.4],
  [0.4, 0.28, 0.2],
];

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Makes a colour backdrop-friendly: vivid but never neon, never near-black or near-white. */
function tune([h, s, l]: [number, number, number]): RGB {
  return hslToRgb(h, Math.min(0.85, s * 1.2 + 0.05), Math.min(0.58, Math.max(0.24, l)));
}

export async function extractPalette(uri: string): Promise<RGB[]> {
  const hit = cache.get(uri);
  if (hit) return hit;
  try {
    const data = await Skia.Data.fromURI(uri);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) return FALLBACK;
    const N = 24;
    const surface = Skia.Surface.Make(N, N);
    if (!surface) return FALLBACK;
    const canvas = surface.getCanvas();
    canvas.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, N, N), Skia.Paint());
    surface.flush();
    const px = surface.makeImageSnapshot().readPixels();
    if (!px) return FALLBACK;

    type Bucket = { r: number; g: number; b: number; n: number; score: number; h: number; s: number; l: number };
    const buckets = new Map<string, Bucket>();
    for (let i = 0; i + 3 < px.length; i += 4) {
      const r = px[i] / 255;
      const g = px[i + 1] / 255;
      const b = px[i + 2] / 255;
      const [h, s, l] = rgbToHsl(r, g, b);
      const key = s < 0.12 ? `g${Math.round(l * 4)}` : `${Math.round(h / 30) % 12}:${Math.round(l * 3)}`;
      const k = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, score: 0, h, s, l };
      k.r += r;
      k.g += g;
      k.b += b;
      k.n += 1;
      k.score += 0.25 + s * (1 - Math.abs(l - 0.5));
      buckets.set(key, k);
    }
    const ranked = [...buckets.values()]
      .map((k) => {
        const [h, s, l] = rgbToHsl(k.r / k.n, k.g / k.n, k.b / k.n);
        return { h, s, l, score: k.score };
      })
      .sort((a, b) => b.score - a.score);

    const picked: { h: number; s: number; l: number }[] = [];
    for (const c of ranked) {
      const distinct = picked.every((p) => {
        const dh = Math.min(Math.abs(p.h - c.h), 360 - Math.abs(p.h - c.h));
        return dh > 22 || Math.abs(p.l - c.l) > 0.18 || p.s < 0.15 !== c.s < 0.15;
      });
      if (distinct) picked.push(c);
      if (picked.length === 4) break;
    }
    // Monochrome covers: spread the one colour across lightness levels.
    while (picked.length < 4) {
      const base = picked[0] ?? { h: 30, s: 0.3, l: 0.4 };
      picked.push({ ...base, l: Math.min(0.7, Math.max(0.2, base.l + (picked.length % 2 ? 0.16 : -0.14))) });
    }
    const palette = picked.map((c) => tune([c.h, c.s, c.l]));
    cache.set(uri, palette);
    return palette;
  } catch {
    return FALLBACK;
  }
}

export const fallbackPalette = FALLBACK;

/** The palette if it was already extracted (no await, no flash of default colours). */
export const cachedPalette = (uri: string | undefined): RGB[] | undefined => (uri ? cache.get(uri) : undefined);
