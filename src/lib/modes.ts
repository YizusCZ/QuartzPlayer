import type { IconName } from '@/components/ui/Icon';
import { VISUALIZERS, type PlayerMode } from '@/store/settings';

const ICONS: Record<PlayerMode, IconName> = {
  cover: 'image-outline',
  cassette: 'cassette',
  lyrics: 'text-box-outline',
  video: 'movie-open-play-outline',
  spectrum: 'chart-bar',
  led: 'led-strip-variant',
  mirror: 'equalizer',
  radial: 'circle-slice-8',
  vu: 'gauge',
  scope: 'sine-wave',
};

/** Every stage mode the player offers, in display order. */
export const MODES: { id: PlayerMode; icon: IconName; label: string; detail: string }[] = [
  { id: 'cover', icon: ICONS.cover, label: 'Carátula', detail: 'Portada del álbum' },
  ...VISUALIZERS.map((v) => ({ id: v.id, icon: ICONS[v.id], label: v.name, detail: v.detail })),
];

export const modeInfo = (id: PlayerMode) => MODES.find((m) => m.id === id) ?? MODES[0];
