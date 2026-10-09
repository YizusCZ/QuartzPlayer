import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { transport } from './engine';

/** Current playback time (s), extrapolated every frame on the UI thread. */
export function playbackTime(): number {
  'worklet';
  const t = transport.value;
  if (!t.playing) return t.position;
  const ahead = Math.min(1, Math.max(0, (Date.now() - t.at) / 1000));
  return t.position + ahead * t.rate;
}

/** Past this much drift the clock jumps instead of easing (seek, track change). */
const SNAP = 0.35;
/** Share of the remaining drift corrected per frame. */
const EASE = 0.08;

/**
 * Smooth playback clock for karaoke-style views. It advances by frame time ×
 * playback rate and eases towards the reported position, so late or bunched
 * status updates never make it stutter or step backwards, at any speed.
 */
export function usePlaybackClock() {
  const time = useSharedValue(0);
  const primed = useSharedValue(false);
  useFrameCallback((frame) => {
    'worklet';
    const target = playbackTime();
    const t = transport.value;
    if (!primed.value || !t.playing) {
      primed.value = true;
      time.value = target;
      return;
    }
    const cur = time.value;
    const dt = Math.min(0.1, (frame.timeSincePreviousFrame ?? 16) / 1000);
    let next = cur + dt * t.rate;
    const drift = target - next;
    if (Math.abs(drift) > SNAP) next = target;
    else next += drift * EASE;
    // Small corrections never run the clock backwards.
    time.value = next < cur && cur - next < SNAP ? cur : next;
  });
  return time;
}
