import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Sheet, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { downloadUpdate, installedVersion, postponeUpdate, useAppUpdate } from '@/lib/appUpdate';
import { colors, radius } from '@/theme';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

/** Release notes as plain text: GitHub's Markdown marks would only be noise here. */
const plain = (md: string) =>
  md
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .trim();

/** "Nueva versión de Quartz": mounted once for the whole app (src/lib/appUpdate.ts). */
export function UpdateSheet() {
  const open = useAppUpdate((s) => s.open);
  const info = useAppUpdate((s) => s.info);
  const status = useAppUpdate((s) => s.status);
  const progress = useAppUpdate((s) => s.progress);
  const error = useAppUpdate((s) => s.error);
  if (!info) return null;

  const busy = status === 'downloading';
  const close = () => (busy ? useAppUpdate.setState({ open: false }) : postponeUpdate());

  return (
    <Sheet visible={open} onClose={close}>
      <SheetTitle sub={`Tienes la ${installedVersion() || 'anterior'} · ${mb(info.size)}`}>
        Quartz {info.version} está disponible
      </SheetTitle>
      <View style={styles.body}>
        {info.notes ? (
          <ScrollView style={styles.notes} contentContainerStyle={{ padding: 14 }}>
            <Txt variant="body" style={{ color: colors.textDim }}>
              {plain(info.notes)}
            </Txt>
          </ScrollView>
        ) : null}

        {busy || status === 'ready' ? (
          <View style={{ gap: 6 }}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]} />
            </View>
            <Txt variant="caption">
              {status === 'ready'
                ? 'Descargada. Confirma en el instalador de Android.'
                : `Descargando… ${Math.round(progress * 100)} %`}
            </Txt>
          </View>
        ) : null}

        {status === 'error' && error ? (
          <Txt variant="caption" style={{ color: colors.danger }}>
            {error}
          </Txt>
        ) : null}

        <Txt variant="caption">
          Tus canciones, listas y ajustes se quedan como están. Android te pedirá confirmar la instalación.
        </Txt>

        <View style={styles.actions}>
          <Pressable onPress={close} style={[styles.btn, styles.ghost]} accessibilityRole="button">
            <Txt variant="bodyStrong">{busy ? 'Seguir de fondo' : 'Más tarde'}</Txt>
          </Pressable>
          <Pressable
            onPress={() => void downloadUpdate()}
            disabled={busy}
            style={[styles.btn, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} size="small" />
            ) : (
              <Icon name={status === 'ready' ? 'package-down' : 'download'} size={20} color={colors.onAccent} />
            )}
            <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
              {status === 'ready' ? 'Instalar' : status === 'error' ? 'Reintentar' : 'Actualizar'}
            </Txt>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 8, gap: 14 },
  notes: { maxHeight: 220, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.04)' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { backgroundColor: colors.surface2 },
});
