/**
 * Quartz design tokens.
 * Dark, low-glare surfaces with a user-selectable accent (amber by default).
 * `colors` is mutated in place by `applyAccent`; components that paint the
 * accent subscribe with `useAccent()` so they re-render when it changes.
 */
import { useSettings } from '@/store/settings';

export const colors = {
  bg: '#0B0B0C',
  surface: '#151517',
  surface2: '#1D1D20',
  surface3: '#26262A',
  line: '#2C2C31',
  text: '#F2F0EC',
  textDim: '#A19D96',
  textMute: '#6B6863',
  accent: '#F08A24',
  accentSoft: 'rgba(240,138,36,0.14)',
  /** Text/icon colour on top of an accent fill. */
  onAccent: '#1A1206',
  hires: '#D9B45A',
  hiresDeep: '#8A6A22',
  danger: '#E5484D',
  ok: '#46A758',
};

export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Ámbar', hex: '#F08A24' },
  { name: 'Coral', hex: '#FF6B5B' },
  { name: 'Rosa', hex: '#F25CA2' },
  { name: 'Magenta', hex: '#D94BD1' },
  { name: 'Violeta', hex: '#9B7BFF' },
  { name: 'Azul', hex: '#4E9BFF' },
  { name: 'Turquesa', hex: '#2EC4B6' },
  { name: 'Menta', hex: '#5DD39E' },
  { name: 'Lima', hex: '#B5E655' },
  { name: 'Oro', hex: '#D9B45A' },
  { name: 'Plata', hex: '#C9CDD2' },
  { name: 'Rojo', hex: '#E5484D' },
];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function applyAccent(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex) || colors.accent === hex) return;
  const [r, g, b] = rgb(hex);
  colors.accent = hex;
  colors.accentSoft = `rgba(${r},${g},${b},0.16)`;
  // Relative luminance → dark or light ink on accent fills.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  colors.onAccent = lum > 0.45 ? '#15120E' : '#FFFFFF';
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Subscribe a component to accent changes (returns the current accent). */
export function useAccent(): string {
  const accent = useSettings((s) => s.accent);
  applyAccent(accent);
  return accent;
}

export const fonts = {
  regular: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semibold: 'Barlow_600SemiBold',
  bold: 'Barlow_700Bold',
  condensed: 'BarlowCondensed_600SemiBold',
  condensedBold: 'BarlowCondensed_700Bold',
  brand: 'Michroma_400Regular',
  hand: 'Caveat_600SemiBold',
} as const;

export const radius = { sm: 8, md: 14, lg: 20, xl: 28 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
