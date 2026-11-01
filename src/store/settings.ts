import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from './storage';
import type { CassetteSkinId } from '@/components/cassette/skins';

export type VisualizerId = 'cassette' | 'lyrics' | 'video' | 'spectrum' | 'led' | 'mirror' | 'radial' | 'vu' | 'scope';

/** Audio quality for YouTube downloads. */
export type YtDownloadQuality = 'best' | 'high' | 'normal';

export const VISUALIZERS: { id: VisualizerId; name: string; detail: string; needsAnalyzer: boolean }[] = [
  { id: 'cassette', name: 'Cassette', detail: 'Carretes animados según el progreso', needsAnalyzer: false },
  { id: 'lyrics', name: 'Letras', detail: 'Karaoke sincronizado palabra por palabra', needsAnalyzer: false },
  {
    id: 'video',
    name: 'Vídeo',
    detail: 'Tus vídeos, GIF o la portada animada a pantalla completa',
    needsAnalyzer: false,
  },
  { id: 'spectrum', name: 'Barras', detail: 'Espectro de barras con picos', needsAnalyzer: true },
  { id: 'led', name: 'LED Hi-Fi', detail: 'Segmentos estilo ecualizador de equipo', needsAnalyzer: true },
  { id: 'mirror', name: 'Espejo', detail: 'Barras simétricas desde el centro', needsAnalyzer: true },
  { id: 'radial', name: 'Radial', detail: 'Barras alrededor de la carátula', needsAnalyzer: true },
  { id: 'vu', name: 'VU analógico', detail: 'Agujas L/R con balística real', needsAnalyzer: true },
  { id: 'scope', name: 'Osciloscopio', detail: 'Goniómetro estéreo y forma de onda', needsAnalyzer: true },
];

/** Everything the player can show on its stage. */
export type PlayerMode = 'cover' | VisualizerId;

export type PaletteId = 'cover' | 'amber' | 'gold' | 'neon' | 'ice' | 'spectrum' | 'mono';

export const PALETTES: Record<PaletteId, { name: string; colors: [string, string, string] }> = {
  // Colours come from the playing cover (see useVisualizerColors); these only paint the swatch.
  cover: { name: 'Portada', colors: ['#7B2FF7', '#F6B35B', '#4FB3E8'] },
  amber: { name: 'Ámbar', colors: ['#F08A24', '#F6B35B', '#FFE3B0'] },
  gold: { name: 'Hi-Res dorado', colors: ['#8A6A22', '#D9B45A', '#FFF1C4'] },
  neon: { name: 'Neón', colors: ['#7B2FF7', '#F107A3', '#FF8BD0'] },
  ice: { name: 'Hielo', colors: ['#1D5C96', '#4FB3E8', '#D8F3FF'] },
  spectrum: { name: 'Arcoíris', colors: ['#2EC4B6', '#FFBF69', '#FF5A5F'] },
  mono: { name: 'Blanco', colors: ['#6E6E73', '#C7C7CC', '#FFFFFF'] },
};

type Settings = {
  /** Jump into the visualizer as soon as playback starts. */
  autoVisualizer: boolean;
  cassetteSkin: CassetteSkinId;
  /** 'auto' picks the skin from the file quality. */
  cassetteSkinMode: 'auto' | 'fixed';
  handwrittenLabel: boolean;
  /** Dim, black "always on display" cassette after a while without touches. */
  cassetteAod: boolean;
  /** Seconds without touches before the cassette drops into always-on display. */
  cassetteAodDelay: 10 | 30 | 60;
  keepAwake: boolean;
  haptics: boolean;
  skipShortClips: boolean;
  /** Quiet check for new files a few seconds after launch. */
  scanOnLaunch: boolean;
  /** Look lyrics up on LRCLIB when the file has none. */
  onlineLyrics: boolean;
  /** Home screen tab: your files or YouTube Music. */
  homeTab: 'local' | 'youtube';
  /** Look up Apple Music motion artwork (animated covers and full-screen loops). */
  motionArt: boolean;
  /** Show what's playing as Discord Rich Presence (Android, Discord app installed). */
  discordPresence: boolean;
  /** While you are in a room, Discord shows a "join" button so friends can come in. */
  discordRoomInvite: boolean;
  /** Bar visualizers. */
  barCount: 24 | 32 | 48 | 64;
  palette: PaletteId;
  peakHold: boolean;
  /** Analyzer gain, 0.6 – 1.6. */
  sensitivity: number;
  /** Accent colour for the whole UI. */
  accent: string;
  /** Apple Music–style translucent backdrop tinted by the cover art. */
  ambientShare: boolean;
  /** Modes pinned to the player's quick-access bar (the rest live under "Más"). */
  quickModes: PlayerMode[];
  /** Shape of the cover in the player. */
  coverShape: 'square' | 'rounded' | 'round';
  /** Lyrics text size. */
  lyricsSize: 'small' | 'normal' | 'large';
  /** Home sections (local tab). */
  homePlaylists: boolean;
  homeRecent: boolean;
  /** Last visualizer used; the player reopens in it. */
  lastVisualizer: VisualizerId;
  /** YouTube download quality: 'best' (Opus ~256k), 'high' (Opus ~160k), 'normal' (AAC 128k). */
  ytDownloadQuality: YtDownloadQuality;
  set: (patch: Partial<Omit<Settings, 'set'>>) => void;
};

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      autoVisualizer: false,
      cassetteSkin: 'magenta',
      cassetteSkinMode: 'auto',
      handwrittenLabel: false,
      cassetteAod: false,
      cassetteAodDelay: 30,
      keepAwake: true,
      haptics: true,
      skipShortClips: true,
      scanOnLaunch: true,
      onlineLyrics: true,
      discordPresence: false,
      discordRoomInvite: true,
      motionArt: true,
      homeTab: 'local',
      barCount: 48,
      palette: 'amber',
      peakHold: true,
      sensitivity: 1,
      accent: '#F08A24',
      ambientShare: true,
      quickModes: ['cover', 'cassette', 'lyrics', 'spectrum'],
      lastVisualizer: 'cassette',
      coverShape: 'rounded',
      lyricsSize: 'normal',
      homePlaylists: true,
      homeRecent: true,
      ytDownloadQuality: 'best',
      set: (patch) => set(patch),
    }),
    {
      name: 'quartz.settings',
      storage: persistStorage(),
      version: 1,
      // v1: new defaults, once, for phones that already had the app.
      migrate: (saved, version) => {
        const s = saved as Settings;
        return version < 1 ? { ...s, autoVisualizer: false, ambientShare: true } : s;
      },
    },
  ),
);
