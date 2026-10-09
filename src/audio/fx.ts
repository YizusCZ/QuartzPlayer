/**
 * Sound effects. Nightcore / Slowed change speed and pitch (engine.ts); the
 * rest run in the native QuartzFx processor inside ExoPlayer (Android) and
 * combine freely, except where two effects fight over the same thing.
 */
import { Platform } from 'react-native';
import { AudioDsp } from '../../modules/audio-dsp';
import type { IconName } from '@/components/ui/Icon';
import { usePlayer } from '@/store/player';

export type FxId = 'reverb' | 'echo' | 'eightD' | 'bass' | 'lofi' | 'radio' | 'karaoke';

export const FX: { id: FxId; name: string; detail: string; icon: IconName; excludes?: FxId[] }[] = [
  { id: 'reverb', name: 'Reverb', detail: 'Sala amplia, ideal con Slowed', icon: 'waves' },
  { id: 'echo', name: 'Eco', detail: 'Repeticiones a izquierda y derecha', icon: 'surround-sound' },
  { id: 'eightD', name: 'Audio 8D', detail: 'El sonido gira a tu alrededor · usa audífonos', icon: 'rotate-orbit' },
  { id: 'bass', name: 'Bass boost', detail: 'Graves profundos', icon: 'speaker' },
  {
    id: 'lofi',
    name: 'Lo-fi',
    detail: 'Cálido y apagado, con crujido de vinilo',
    icon: 'record-player',
    excludes: ['radio'],
  },
  { id: 'radio', name: 'Radio', detail: 'Como una radio vieja o un teléfono', icon: 'radio', excludes: ['lofi'] },
  { id: 'karaoke', name: 'Karaoke', detail: 'Atenúa la voz principal (pistas estéreo)', icon: 'microphone-off' },
];

/** Twemoji code point per effect, used as the Discord badge (CC-BY 4.0). */
export const FX_EMOJI: Record<FxId | 'nightcore' | 'slowed', string> = {
  nightcore: '1f319', // 🌙
  slowed: '1f40c', // 🐌
  reverb: '1f30a', // 🌊
  echo: '1f501', // 🔁
  eightD: '1f3a7', // 🎧
  bass: '1f50a', // 🔊
  lofi: '1f4fc', // 📼
  radio: '1f4fb', // 📻
  karaoke: '1f3a4', // 🎤
};

export const fxSupported = Platform.OS === 'android' && AudioDsp.supported;

/** Ready-made mixes. `pitch` picks Nightcore / Slowed / neither. */
export const FX_PRESETS: { id: string; name: string; pitch: 'nightcore' | 'slowed' | null; fx: FxId[] }[] = [
  { id: 'slowed-reverb', name: 'Slowed + Reverb', pitch: 'slowed', fx: ['reverb'] },
  { id: 'lofi-chill', name: 'Lo-fi chill', pitch: 'slowed', fx: ['lofi', 'reverb'] },
  { id: 'nightcore-8d', name: 'Nightcore 8D', pitch: 'nightcore', fx: ['eightD'] },
  { id: 'concert', name: 'En vivo', pitch: null, fx: ['reverb', 'echo'] },
];

/** Turns an effect on or off, dropping whatever it can't be combined with. */
export function toggleFx(id: FxId) {
  const cur = usePlayer.getState().fx;
  if (cur.includes(id)) {
    usePlayer.setState({ fx: cur.filter((f) => f !== id) });
    return;
  }
  const excludes = FX.find((f) => f.id === id)?.excludes ?? [];
  usePlayer.setState({ fx: [...cur.filter((f) => !excludes.includes(f)), id] });
}

export function clearFx() {
  usePlayer.setState({ fx: [] });
}

/** Pushes the current effects to the native processor. */
export function applyFx() {
  if (!fxSupported) return;
  const { fx, slowed } = usePlayer.getState();
  const on = (id: FxId) => (fx.includes(id) ? 1 : 0);
  AudioDsp.setEffects([
    on('reverb') * (slowed ? 0.7 : 0.5),
    // Slowed + reverb wants the long, washed-out tail.
    slowed ? 0.9 : 0.82,
    on('echo') * 0.7,
    on('eightD'),
    on('bass'),
    fx.includes('lofi') ? 1 : fx.includes('radio') ? 2 : 0,
    on('karaoke'),
  ]);
}

let started = false;
export function startFx() {
  if (started) return;
  started = true;
  usePlayer.subscribe((s, prev) => {
    if (s.fx !== prev.fx || s.slowed !== prev.slowed) applyFx();
  });
  applyFx();
}
