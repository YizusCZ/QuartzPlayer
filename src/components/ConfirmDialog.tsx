import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { tap } from '@/lib/haptics';
import { useUI, type ConfirmRequest } from '@/store/ui';
import { colors, radius, useAccent, withAlpha } from '@/theme';
import { Artwork } from './ui/Artwork';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Txt';

/**
 * Global confirmation dialog driven by `useUI().askConfirm`: a centred card in
 * Quartz's style instead of the system alert.
 */
export function ConfirmDialog() {
  useAccent();
  const req = useUI((s) => s.confirm);
  const closeConfirm = useUI((s) => s.closeConfirm);
  // The last question stays drawn while the Modal fades out.
  const [last, setLast] = useState<ConfirmRequest | null>(req);
  if (req && req !== last) setLast(req);
  const r = req ?? last;
  const tint = r?.destructive ? colors.danger : colors.accent;

  const confirm = () => {
    if (!r) return;
    tap('medium');
    closeConfirm();
    r.onConfirm();
  };

  return (
    <Modal
      visible={!!req}
      transparent
      animationType="fade"
      onRequestClose={closeConfirm}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={closeConfirm} accessibilityLabel="Cancelar" />
      {r ? (
        <View style={styles.center} pointerEvents="box-none">
          <View style={styles.card} accessibilityViewIsModal>
            <View style={styles.hero}>
              {r.artwork ? (
                <>
                  <Artwork uri={r.artwork} seed={r.title} size={76} radius={radius.md} />
                  <View style={[styles.pin, { backgroundColor: tint }]}>
                    <Icon name={r.icon ?? 'help-circle-outline'} size={16} color="#fff" />
                  </View>
                </>
              ) : (
                <View style={[styles.halo, { backgroundColor: withAlpha(tint, 0.16) }]}>
                  <Icon name={r.icon ?? 'help-circle-outline'} size={28} color={tint} />
                </View>
              )}
            </View>
            <Txt variant="heading" style={styles.title}>
              {r.title}
            </Txt>
            {r.message ? (
              <Txt variant="body" style={styles.message}>
                {r.message}
              </Txt>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                onPress={closeConfirm}
                style={({ pressed }) => [styles.btn, styles.cancel, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Txt variant="bodyStrong">Cancelar</Txt>
              </Pressable>
              <Pressable
                onPress={confirm}
                style={({ pressed }) => [styles.btn, { backgroundColor: tint }, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {r.destructive ? <Icon name="trash-can-outline" size={18} color="#fff" /> : null}
                <Txt variant="bodyStrong" style={{ color: r.destructive ? '#fff' : colors.onAccent }}>
                  {r.confirmLabel ?? 'Aceptar'}
                </Txt>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' },
  center: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 20,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  hero: { marginBottom: 16 },
  pin: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  halo: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center' },
  message: { marginTop: 6, textAlign: 'center', color: colors.textDim },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22, alignSelf: 'stretch' },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: { backgroundColor: colors.surface3 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
