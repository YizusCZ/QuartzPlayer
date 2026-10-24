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
    const { enabled, preamp, gains, balance, leveling, autoGain } = useEq.getState();
    const gain = autoGain ? Math.min(preamp, -Math.max(0, ...gains)) : preamp;
    void AudioDsp.setEqualizer(player, enabled, gain, gains, balance, leveling);
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
