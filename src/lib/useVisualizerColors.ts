import { useEffect, useState } from 'react';
import { useLibrary } from '@/store/library';
import { currentTrackId, usePlayer } from '@/store/player';
import { PALETTES, useSettings } from '@/store/settings';
import { extractPalette, type RGB } from './palette';

const hex = ([r, g, b]: RGB) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const lift = (c: RGB, k: number): RGB => [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k];

/** AmbientShare's cover colours as a [base, mid, tip] bar palette, dark → bright. */
function toBars(p: RGB[]): [string, string, string] {
  const sorted = [...p].sort((a, b) => lum(a) - lum(b));
  const base = sorted[1] ?? sorted[0];
  const mid = sorted[sorted.length - 1];
  // Peaks and tips need to read on black: push the brightest colour toward white.
  return [hex(lift(base, 0.15)), hex(lift(mid, 0.25)), hex(lift(mid, 0.65))];
}

/**
 * The three colours bar visualizers paint with: a fixed palette, or — with
 * "Portada · AmbientShare" — the playing cover's colours.
 */
export function useVisualizerColors(): [string, string, string] {
  const palette = useSettings((s) => s.palette);
  const id = usePlayer(currentTrackId);
  const uri = useLibrary((s) => (id ? s.tracks[id]?.artwork : undefined));
  const [cover, setCover] = useState<{ uri: string; colors: [string, string, string] } | null>(null);

  useEffect(() => {
    if (palette !== 'cover' || !uri) return;
    let alive = true;
    void extractPalette(uri).then((p) => alive && setCover({ uri, colors: toBars(p) }));
    return () => {
      alive = false;
    };
  }, [palette, uri]);

  if (palette !== 'cover') return PALETTES[palette].colors;
  // Keep the previous cover's colours until the new ones are ready (no amber flash between tracks).
  return cover && uri ? cover.colors : PALETTES.amber.colors;
}
