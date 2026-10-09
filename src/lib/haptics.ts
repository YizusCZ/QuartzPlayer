import * as Haptics from 'expo-haptics';
import { useSettings } from '@/store/settings';

export function tap(kind: 'light' | 'medium' | 'select' = 'light') {
  if (!useSettings.getState().haptics) return;
  if (kind === 'select') void Haptics.selectionAsync();
  else
    void Haptics.impactAsync(
      kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
}
