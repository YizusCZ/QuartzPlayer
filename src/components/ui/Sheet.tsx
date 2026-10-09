import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />
      {/* No Reanimated slide-in here: on Android a layout animation inside a
          Modal leaves the sheet drawn away from where touches are hit-tested,
          so any finger movement cancels presses. The Modal fade is enough. */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.grip} />
        {children}
      </View>
    </Modal>
  );
}

export function SheetItem({
  icon,
  label,
  detail,
  onPress,
  danger,
  selected,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surface3 }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Icon name={icon} size={22} color={danger ? colors.danger : selected ? colors.accent : colors.textDim} />
      <Txt
        variant="bodyStrong"
        style={[{ flex: 1 }, danger && { color: colors.danger }, selected && { color: colors.accent }]}
      >
        {label}
      </Txt>
      {detail ? <Txt variant="caption">{detail}</Txt> : null}
      {selected ? <Icon name="check" size={20} color={colors.accent} /> : null}
    </Pressable>
  );
}

export function SheetTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <Animated.View entering={FadeIn} style={styles.titleBox}>
      <Txt variant="heading" numberOfLines={1}>
        {children}
      </Txt>
      {sub ? (
        <Txt variant="caption" numberOfLines={1}>
          {sub}
        </Txt>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 8,
    maxHeight: '85%',
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface3,
    marginBottom: 8,
  },
  titleBox: { paddingHorizontal: 20, paddingVertical: 10, gap: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, height: 52 },
});
