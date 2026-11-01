import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { detectLink, PLATFORM_NAMES, type ImportPlatform } from '@/catalog/importSources';
import { cancelImport, clearImport, importPlaylist, useImport, type ImportJob } from '@/catalog/playlistImport';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Sheet, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { useUI } from '@/store/ui';
import { colors, fonts, radius, withAlpha } from '@/theme';

/** Each service's own colour, so a link is recognised at a glance. */
const BRANDS: { id: Exclude<ImportPlatform, 'text'>; icon: IconName; color: string }[] = [
  { id: 'spotify', icon: 'spotify', color: '#1DB954' },
  { id: 'apple', icon: 'apple', color: '#FA2D48' },
  { id: 'youtube', icon: 'youtube', color: '#FF0033' },
  { id: 'deezer', icon: 'equalizer', color: '#A238FF' },
];
const brandOf = (p?: ImportPlatform) => BRANDS.find((b) => b.id === p);

type Mode = 'link' | 'text';

/** The way in, where it can be seen: a card that opens the import (and shows one running). */
export function ImportBanner({ style }: { style?: object }) {
  const job = useImport((s) => s.job);
  const running = job?.status === 'reading' || job?.status === 'matching';
  return (
    <Pressable
      onPress={() => (tap('select'), useUI.getState().openImport())}
      style={({ pressed }) => [bannerStyles.card, pressed && { opacity: 0.85 }, style]}
      accessibilityRole="button"
      accessibilityLabel="Importar listas de otras apps"
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Txt variant="heading">{running ? `Importando “${job.name}”` : 'Trae tus listas'}</Txt>
        <Txt variant="caption" numberOfLines={2}>
          {running
            ? `${job.done} de ${job.total || '…'} canciones`
            : job?.status === 'done'
              ? `“${job.name}” ya está en tus listas`
              : 'Pega el enlace de una lista de Spotify, Apple Music, YouTube o Deezer.'}
        </Txt>
        <View style={bannerStyles.brands}>
          {BRANDS.map((b) => (
            <View key={b.id} style={[bannerStyles.brand, { backgroundColor: withAlpha(b.color, 0.16) }]}>
              <Icon name={b.icon} size={16} color={b.color} />
            </View>
          ))}
        </View>
      </View>
      <View style={[bannerStyles.cta, { backgroundColor: colors.accent }]}>
        {running ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <Icon name="playlist-plus" size={20} color={colors.onAccent} />
        )}
        <Txt variant="bodyStrong" style={{ color: colors.onAccent, fontSize: 14 }}>
          {running ? 'Ver' : 'Importar'}
        </Txt>
      </View>
    </Pressable>
  );
}

const bannerStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  brands: { flexDirection: 'row', gap: 6, marginTop: 4 },
  brand: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 40, borderRadius: 20 },
});

/** Mounted once for the whole app: any screen opens it with `useUI.getState().openImport()`. */
export function GlobalImportSheet() {
  const open = useUI((s) => s.importOpen);
  return <ImportPlaylistSheet visible={open} onClose={() => useUI.getState().openImport(false)} />;
}

/** Paste a link from Spotify, Apple Music, YouTube or Deezer (or a list of songs) and get a Quartz list. */
export function ImportPlaylistSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const job = useImport((s) => s.job);
  return (
    <Sheet visible={visible} onClose={onClose}>
      {job ? <Progress job={job} onClose={onClose} /> : <Form />}
    </Sheet>
  );
}

function Form() {
  const [mode, setMode] = useState<Mode>('link');
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const detected = detectLink(link);
  const platform = detected && detected.platform !== 'short' ? detected.platform : undefined;
  const kind = detected && 'kind' in detected && detected.kind === 'album' ? 'álbum' : 'lista';
  const lines = text.split('\n').filter((l) => l.trim()).length;
  const canGo = mode === 'link' ? !!detected : lines > 0;

  const go = () => {
    if (!canGo) return;
    tap('medium');
    void importPlaylist(mode === 'link' ? { link } : { text, name: name.trim() || 'Lista importada' });
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
      <SheetTitle sub="Tus listas de otras apps, en Quartz">Importar una lista</SheetTitle>
      <View style={styles.body}>
        <View style={styles.brands}>
          {BRANDS.map((b) => {
            const on = platform === b.id;
            return (
              <View
                key={b.id}
                style={[styles.brand, on && { borderColor: b.color, backgroundColor: withAlpha(b.color, 0.14) }]}
              >
                <Icon name={b.icon} size={22} color={b.color} />
                <Txt variant="caption" style={[{ fontSize: 11 }, on && { color: colors.text }]}>
                  {PLATFORM_NAMES[b.id]}
                </Txt>
              </View>
            );
          })}
        </View>

        <View style={styles.segment}>
          {(
            [
              ['link', 'Enlace', 'link-variant'],
              ['text', 'Pegar canciones', 'text-box-outline'],
            ] as [Mode, string, IconName][]
          ).map(([id, label, icon]) => {
            const on = mode === id;
            return (
              <Pressable
                key={id}
                onPress={() => (tap('select'), setMode(id))}
                style={[styles.segmentItem, on && { backgroundColor: colors.accent }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Icon name={icon} size={16} color={on ? colors.onAccent : colors.textDim} />
                <Txt variant="bodyStrong" style={[{ fontSize: 13 }, on && { color: colors.onAccent }]}>
                  {label}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        {mode === 'link' ? (
          <>
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="Pega aquí el enlace de la lista o el álbum"
              placeholderTextColor={colors.textMute}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={go}
            />
            <Txt variant="caption" style={{ fontSize: 12 }}>
              {platform
                ? `${PLATFORM_NAMES[platform]} · ${kind} reconocida`
                : detected
                  ? 'Enlace corto: se abrirá para encontrar la lista'
                  : link.trim()
                    ? 'No reconozco ese enlace todavía'
                    : 'En la app de origen: Compartir → Copiar enlace. La lista debe ser pública.'}
            </Txt>
          </>
        ) : (
          <>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Nombre de la lista"
              placeholderTextColor={colors.textMute}
              style={styles.input}
              maxLength={40}
            />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={'Una canción por línea:\nBad Bunny - Tití Me Preguntó\nQueen - Bohemian Rhapsody'}
              placeholderTextColor={colors.textMute}
              style={[styles.input, styles.area]}
              multiline
              textAlignVertical="top"
              autoCorrect={false}
            />
            <Txt variant="caption" style={{ fontSize: 12 }}>
              {lines
                ? `${lines} ${lines === 1 ? 'canción' : 'canciones'}`
                : 'Sirve para Tidal, SoundCloud o cualquier otra app.'}
            </Txt>
          </>
        )}

        <Pressable
          disabled={!canGo}
          onPress={go}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: colors.accent },
            !canGo && { opacity: 0.4 },
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
          accessibilityRole="button"
        >
          <Icon name="playlist-plus" size={20} color={colors.onAccent} />
          <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
            Importar
          </Txt>
        </Pressable>
        <View style={styles.note}>
          <Icon name="shield-check-outline" size={16} color={colors.textMute} />
          <Txt variant="caption" style={{ flex: 1, fontSize: 12 }}>
            Cada canción se busca primero en tus archivos y si no en YouTube Music, para escucharla en streaming. No se
            descarga nada ni hace falta iniciar sesión.
          </Txt>
        </View>
      </View>
    </ScrollView>
  );
}

function Progress({ job, onClose }: { job: ImportJob; onClose: () => void }) {
  const brand = brandOf(job.platform);
  const frac = job.total ? job.done / job.total : 0;
  const busy = job.status === 'reading' || job.status === 'matching';
  const found = job.local + job.online;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
      <View style={styles.body}>
        <View style={styles.head}>
          <View style={styles.cover}>
            {job.cover ? (
              <Image source={{ uri: job.cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            ) : (
              <Icon name="playlist-music" size={30} color={colors.textMute} />
            )}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="heading" numberOfLines={2}>
              {job.name}
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {brand ? <Icon name={brand.icon} size={14} color={brand.color} /> : null}
              <Txt variant="caption" numberOfLines={1}>
                {job.status === 'reading'
                  ? 'Leyendo la lista…'
                  : job.status === 'matching'
                    ? `Buscando ${job.done} de ${job.total}`
                    : job.status === 'done'
                      ? `Lista creada · ${found} ${found === 1 ? 'canción' : 'canciones'}`
                      : 'No se pudo importar'}
              </Txt>
            </View>
          </View>
          {busy ? <ActivityIndicator color={colors.accent} /> : null}
        </View>

        {job.status === 'error' ? (
          <View style={[styles.note, styles.errorBox]}>
            <Icon name="alert-circle-outline" size={18} color={colors.danger} />
            <Txt variant="caption" style={{ flex: 1, color: colors.danger }}>
              {job.error}
            </Txt>
          </View>
        ) : (
          <>
            <View style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  { width: `${(job.status === 'done' ? 1 : frac) * 100}%`, backgroundColor: colors.accent },
                ]}
              />
            </View>
            <View style={styles.stats}>
              <Stat icon="folder-music-outline" value={job.local} label="De tus archivos" />
              <Stat icon="youtube" value={job.online} label="De YouTube Music" />
              <Stat icon="help-circle-outline" value={job.missing.length} label="Sin encontrar" dim />
            </View>
          </>
        )}

        {job.capped ? (
          <View style={styles.note}>
            <Icon name="information-outline" size={16} color={colors.textMute} />
            <Txt variant="caption" style={{ flex: 1, fontSize: 12 }}>
              {PLATFORM_NAMES[job.platform ?? 'text']} solo muestra las primeras 100 canciones de las listas largas sin
              iniciar sesión. Para el resto, pégalas en “Pegar canciones”.
            </Txt>
          </View>
        ) : null}

        {job.status === 'done' && job.missing.length ? (
          <View style={{ gap: 6 }}>
            <Txt variant="label">NO ENCONTRADAS</Txt>
            {job.missing.slice(0, 30).map((t, i) => (
              <Txt key={`${t.title}${i}`} variant="caption" numberOfLines={1}>
                {t.artist ? `${t.artist} – ${t.title}` : t.title}
              </Txt>
            ))}
            {job.missing.length > 30 ? <Txt variant="caption">y {job.missing.length - 30} más</Txt> : null}
          </View>
        ) : null}

        {busy ? (
          <View style={styles.row}>
            <Pressable
              onPress={() => (tap('select'), cancelImport())}
              style={[styles.secondary, { flex: 1 }]}
              accessibilityRole="button"
            >
              <Txt variant="bodyStrong">Cancelar</Txt>
            </Pressable>
            <Pressable
              onPress={onClose}
              style={[styles.primary, { flex: 1, backgroundColor: colors.accent }]}
              accessibilityRole="button"
            >
              <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
                Seguir de fondo
              </Txt>
            </Pressable>
          </View>
        ) : (
          <View style={styles.row}>
            <Pressable
              onPress={() => (tap('select'), clearImport())}
              style={[styles.secondary, { flex: 1 }]}
              accessibilityRole="button"
            >
              <Txt variant="bodyStrong">{job.status === 'error' ? 'Intentar otra vez' : 'Importar otra'}</Txt>
            </Pressable>
            {job.status === 'done' && job.playlistId ? (
              <Pressable
                onPress={() => {
                  tap('medium');
                  const id = job.playlistId as string;
                  onClose();
                  clearImport();
                  router.push({ pathname: '/songs', params: { filter: 'playlist', value: id, title: job.name } });
                }}
                style={[styles.primary, { flex: 1, backgroundColor: colors.accent }]}
                accessibilityRole="button"
              >
                <Icon name="play" size={18} color={colors.onAccent} />
                <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
                  Abrir lista
                </Txt>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Stat({ icon, value, label, dim }: { icon: IconName; value: number; label: string; dim?: boolean }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={18} color={dim ? colors.textMute : colors.accent} />
      <Txt style={[styles.statValue, dim && { color: colors.textDim }]}>{value}</Txt>
      <Txt variant="caption" style={{ fontSize: 11, textAlign: 'center' }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 12 },
  brands: { flexDirection: 'row', gap: 8 },
  brand: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
  },
  segment: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 999, backgroundColor: colors.surface2 },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 999,
  },
  input: {
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 15,
    backgroundColor: colors.surface3,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  area: { minHeight: 140, maxHeight: 220 },
  primary: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 999,
  },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: colors.surface3,
  },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorBox: { padding: 12, borderRadius: radius.md, backgroundColor: withAlpha(colors.danger, 0.12) },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 8 },
  cover: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surface3 },
  barFill: { height: 6, borderRadius: 3 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  statValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
