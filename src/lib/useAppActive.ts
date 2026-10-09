import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

const subscribe = (onChange: () => void) => {
  const sub = AppState.addEventListener('change', onChange);
  return () => sub.remove();
};
// 'unknown' (before the first event) counts as active.
const isActive = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

/**
 * False while the app is backgrounded or the screen is off. Animated Skia
 * canvases keep drawing into a detached surface otherwise, burning CPU/GPU.
 */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribe, isActive);
}
