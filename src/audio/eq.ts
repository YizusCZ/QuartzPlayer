import { AudioDsp } from '../../modules/audio-dsp';
import { useEq } from '@/store/eq';
import { getPlayer, setOnLoaded } from './engine';

export const eqSupported = AudioDsp.supported;

let pending: ReturnType<typeof setTimeout> | undefined;

/** Pushes the current EQ to the native processor (coalesced while dragging). */
export function applyEq(immediate = false) {
  clearTimeout(pending);
  const run = () => {
    const player = getPlayer();
    if (!player || !eqSupported) return;
    const { enabled, preamp, gains } = useEq.getState();
    void AudioDsp.setEqualizer(player, enabled, preamp, gains);
  };
  if (immediate) run();
  else pending = setTimeout(run, 40);
}

let started = false;
export function startEq() {
  if (started) return;
  started = true;
  useEq.subscribe(() => applyEq());
  setOnLoaded(() => setTimeout(() => applyEq(true), 300));
  applyEq(true);
}
