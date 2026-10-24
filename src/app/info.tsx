import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatTime } from '@/library/types';
import { QualityPanel } from '@/components/QualityPanel';
import { Artwork } from '@/components/ui/Artwork';
import { FormatBadge } from '@/components/ui/FormatBadge';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';
import { trackById, useLibrary } from '@/store/library';
import { colors, radius, useAccent } from '@/theme';

function Row({ k, v }: { k: string; v?: string | number | null }) {
  if (v == null || v === '') return null;
  return (
    <View style={styles.row}>
      <Txt variant="caption" style={{ width: 130 }}>
        {k}
      </Txt>
      <Txt variant="bodyStrong" style={{ flex: 1 }} selectable>
        {String(v)}
      </Txt>
    </View>
  );
}

export default function Info() {
  useAccent();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const t = useLibrary((s) => trackById(s, id));
  const plays = useLibrary((s) => s.plays[id]);
  if (!t) return null;
  const f = t.format;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top > 30 ? 12 : insets.top + 8 }]}>
        <Txt variant="title" style={{ flex: 1 }}>
          Información
        </Txt>
        <IconButton icon="close" label="Cerrar" onPress={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 20 }}>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Artwork uri={t.artwork} seed={t.album} size={96} radius={radius.md} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="heading">{t.title}</Txt>
            <Txt variant="caption">{t.artist}</Txt>
            <FormatBadge format={f} />
          </View>
        </View>

        <QualityPanel format={f} />

        <View style={styles.card}>
          <Txt variant="label">ETIQUETAS</Txt>
          <Row k="Álbum" v={t.album} />
          <Row k="Artista del álbum" v={t.albumArtist} />
          <Row k="Género" v={t.genre} />
          <Row k="Año" v={t.year} />
          <Row k="Pista" v={t.trackNo ? `${t.trackNo}${t.discNo ? ` · disco ${t.discNo}` : ''}` : undefined} />
          <Row k="Duración" v={t.duration ? formatTime(t.duration) : undefined} />
        </View>

        <View style={styles.card}>
          <Txt variant="label">ARCHIVO</Txt>
          <Row k="Nombre" v={t.filename} />
          <Row k="Carpeta" v={t.folder} />
          <Row k="Tamaño" v={t.size ? `${(t.size / 1048576).toFixed(1)} MB` : undefined} />
          <Row
            k="Origen"
            v={
              t.origin
                ? `Música libre · ${t.origin.service === 'jamendo' ? 'Jamendo' : 'Internet Archive'}`
                : t.source === 'device'
                  ? 'Biblioteca del dispositivo'
                  : 'Importado en Quartz'
            }
          />
          <Row k="Reproducciones" v={plays?.count ?? 0} />
        </View>

        {t.origin ? (
          <View style={styles.card}>
            <Txt variant="label">LICENCIA</Txt>
            <Row k="Licencia" v={t.origin.license} />
            <Row k="Autor" v={t.artist} />
            <Pressable
              onPress={() => void Linking.openURL(t.origin!.pageUrl)}
              style={styles.link}
              accessibilityRole="link"
            >
              <Txt variant="bodyStrong" style={{ color: colors.accent }}>
                Ver la obra y su licencia
              </Txt>
              <Icon name="open-in-new" size={16} color={colors.accent} />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8 },
  card: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: 16, gap: 10 },
  row: { flexDirection: 'row', gap: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
});
