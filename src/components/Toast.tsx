import { StyleSheet } from 'react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '@/store/ui';
import { colors } from '@/theme';
import { Txt } from './ui/Txt';

export function Toast() {
  const msg = useUI((s) => s.toast);
  const insets = useSafeAreaInsets();
  if (!msg) return null;
  return (
    <Animated.View
      entering={FadeInUp}
      exiting={FadeOutDown}
      style={[styles.toast, { bottom: insets.bottom + 96 }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <Txt variant="bodyStrong">{msg}</Txt>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.surface3,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
});
