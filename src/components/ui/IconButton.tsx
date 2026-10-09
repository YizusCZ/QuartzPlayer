import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { tap } from '@/lib/haptics';
import { colors } from '@/theme';
import { Icon, type IconName } from './Icon';

type Props = {
  icon: IconName;
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  color?: string;
  active?: boolean;
  label: string;
  style?: StyleProp<ViewStyle>;
  filled?: boolean;
  disabled?: boolean;
};

export function IconButton({
  icon,
  onPress,
  onLongPress,
  size = 24,
  color,
  active,
  label,
  style,
  filled,
  disabled,
}: Props) {
  const box = size + 20;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress?.();
      }}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.base,
        { width: box, height: box, borderRadius: box / 2 },
        filled && { backgroundColor: colors.accent },
        pressed && { opacity: 0.6, transform: [{ scale: 0.94 }] },
        disabled && { opacity: 0.35 },
        style,
      ]}
    >
      <Icon
        name={icon}
        size={size}
        color={color ?? (filled ? colors.onAccent : active ? colors.accent : colors.text)}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
