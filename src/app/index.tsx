import { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Player } from '@/audio/engine';
import { importFiles, scanLibrary } from '@/library/scanner';
import { groupTracks, totalDuration } from '@/library/selectors';
import type { Track } from '@/library/types';
import { DownloadsButton } from '@/components/DownloadsSheet';
import { MiniPlayer, MINI_PLAYER_HEIGHT } from '@/components/MiniPlayer';
import { HelpButton, TourTarget, useTourRef, useTourScroll } from '@/components/tour/Tour';
import { Artwork } from '@/components/ui/Artwork';
import { PlaylistCover } from '@/components/cassette/PlaylistCover';
import { HiResMark } from '@/components/ui/FormatBadge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';
import { useLibrary } from '@/store/library';
import { useScan } from '@/store/scan';
import { useUI } from '@/store/ui';
import { useSettings } from '@/store/settings';
import { tap } from '@/lib/haptics';
import { YouTubeHome } from '@/youtube/YouTubeHome';
import { colors, fonts, radius, useAccent, withAlpha } from '@/theme';

const LOGO = require('../../assets/images/logo-mark.png');

export default function Home() {
  useAccent();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tracksMap = useLibrary((s) => s.tracks);
  const remote = useLibrary((s) => s.remote);
  const favorites = useLibrary((s) => s.favorites);
  const plays = useLibrary((s) => s.plays);
  const playlists = useLibrary((s) => s.playlists);
  const tab = useSettings((s) => s.homeTab);
  const homePlaylists = useSettings((s) => s.homePlaylists);
  const homeRecent = useSettings((s) => s.homeRecent);
  const tabsRef = useTourRef('home.tabs');
  const tourScroll = useTourScroll();
  const libraryRef = useTourRef('home.library');
  const scan = useScan();
  const showToast = useUI((s) => s.showToast);

  const tracks = useMemo(() => Object.values(tracksMap), [tracksMap]);
  // Grouping the whole library is the expensive part: only when the songs change, not on every play.
  const groups = useMemo(() => {
    const albums = groupTracks(tracks, 'albums');
    const newest = (g: { tracks: Track[] }) => g.tracks.reduce((m, t) => Math.max(m, t.addedAt), 0);
    return {
      hours: totalDuration(tracks) / 3600,
      albums: albums.length,
      artists: groupTracks(tracks, 'artists').length,
      genres: groupTracks(tracks, 'genres').length,
      folders: groupTracks(tracks, 'folders').length,
      recentAlbums: [...albums].sort((a, b) => newest(b) - newest(a)).slice(0, 12),
    };
  }, [tracks]);
  const recent = useMemo(
    () =>
      // Both libraries: your files and the YouTube songs you played.
      [...tracks, ...Object.values(remote)]
        .filter((t) => plays[t.id])
        .sort((a, b) => plays[b.id].last - plays[a.id].last)
        .slice(0, 12),
    [tracks, remote, plays],
  );
  const data = { ...groups, recent };

  const onImport = async () => {
    const n = await importFiles();
    if (n) showToast(`${n} ${n === 1 ? 'archivo importado' : 'archivos importados'}`);
  };
  const shuffleAll = () => {
    const ids = tracks.map((t) => t.id);
    if (ids.length) Player.playTracks(ids, Math.floor(Math.random() * ids.length), { shuffle: true });
  };

  const maxW = Math.min(width, 760);
  const library: { icon: IconName; label: string; count: number; href: Href }[] = [
    {
      icon: 'music-note',
      label: 'Canciones',
      count: tracks.length,
      href: { pathname: '/songs', params: { filter: 'all', title: 'Canciones' } },
    },
    { icon: 'album', label: 'Álbumes', count: data.albums, href: '/groups/albums' },
    { icon: 'account-music', label: 'Artistas', count: data.artists, href: '/groups/artists' },
    { icon: 'playlist-music', label: 'Listas', count: playlists.length, href: '/playlists' },
    { icon: 'tag-outline', label: 'Géneros', count: data.genres, href: '/groups/genres' },
    { icon: 'folder-music', label: 'Carpetas', count: data.folders, href: '/groups/folders' },
  ];

  const recentShelf = data.recent.length ? (
    <>
      <SectionHead
        title="Escuchado recientemente"
        action="Ver todo"
        onAction={() => router.push({ pathname: '/songs', params: { filter: 'recent', title: 'Recientes' } })}
      />
      <FlatList
        horizontal
        data={data.recent}
        keyExtractor={(t) => t.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
        renderItem={({ item, index }) => (
          <RecentCard
            track={item}
            onPress={() =>
              Player.playTracks(
                data.recent.map((t) => t.id),
                index,
              )
            }
          />
        )}
      />
    </>
  ) : null;
  const headerBar = (
    <View style={styles.header}>
      <Image source={LOGO} style={styles.logo} tintColor={colors.accent} contentFit="contain" />
      {/* One line that shrinks to fit: the download button comes and goes beside it. */}
      <Txt style={styles.wordmark} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        QUARTZ
      </Txt>
      <View style={styles.headerIcons}>
        {/* Library search only; YouTube Music has its own search in its tab. */}
        {tab === 'local' ? (
          <TourTarget id="home.search">
            <IconButton icon="magnify" label="Buscar" onPress={() => router.push('/search')} />
          </TourTarget>
        ) : null}
        <DownloadsButton />
        <IconButton icon="account-group-outline" label="Salas" onPress={() => router.push('/jam')} />
        <HelpButton tour={tab === 'local' ? 'home' : 'youtube'} />
        <TourTarget id="home.settings">
          <IconButton icon="cog-outline" label="Ajustes" onPress={() => router.push('/settings')} />
        </TourTarget>
      </View>
    </View>
  );
  const tabsBar = (
    <View ref={tabsRef} collapsable={false} style={styles.tabs} accessibilityRole="tablist">
      {(
        [
          ['local', 'Biblioteca local', 'folder-music-outline'],
          ['youtube', 'YouTube Music', 'youtube'],
        ] as const
      ).map(([id, label, icon]) => {
        const on = tab === id;
        return (
          <Pressable
            key={id}
            onPress={() => {
              tap('select');
              useSettings.getState().set({ homeTab: id });
            }}
            style={[styles.tab, on && { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Icon name={icon} size={18} color={on ? colors.accent : colors.textDim} />
            <Txt variant="bodyStrong" style={[{ fontSize: 14 }, on && { color: colors.accent }]}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );

  if (tab === 'youtube') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 6 }}>
        <View style={{ width: maxW, alignSelf: 'center' }}>
          {headerBar}
          {tabsBar}
        </View>
        <YouTubeHome
          embedded
          listHeader={recentShelf && homeRecent ? <View style={{ paddingBottom: 4 }}>{recentShelf}</View> : null}
        />
        <MiniPlayer />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        {...tourScroll}
        contentContainerStyle={{
          paddingTop: insets.top + 6,
          paddingBottom: insets.bottom + MINI_PLAYER_HEIGHT + 40,
          alignItems: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: maxW }}>
          {headerBar}
          {tabsBar}

          {tracks.length ? (
            <>
              {/* ── quick filters ── */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Chip icon="shuffle-variant" label="Aleatorio" onPress={shuffleAll} strong />
                <Chip icon="download-circle-outline" label="Música libre" onPress={() => router.push('/discover')} />
                <Chip
                  icon="heart"
                  label={`Favoritas · ${Object.keys(favorites).length}`}
                  onPress={() =>
                    router.push({ pathname: '/songs', params: { filter: 'favorites', title: 'Favoritas' } })
                  }
                />
                <Chip
                  icon="history"
                  label="Recientes"
                  onPress={() => router.push({ pathname: '/songs', params: { filter: 'recent', title: 'Recientes' } })}
                />
                <Chip
                  icon="fire"
                  label="Más escuchadas"
                  onPress={() =>
                    router.push({ pathname: '/songs', params: { filter: 'top', title: 'Más escuchadas' } })
                  }
                />
              </ScrollView>

              {/* ── albums carousel ── */}
              <SectionHead title="Álbumes" action="Ver todos" onAction={() => router.push('/groups/albums')} />
              <FlatList
                horizontal
                data={data.recentAlbums}
                keyExtractor={(g) => g.key}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carousel}
                renderItem={({ item }) => (
                  <Pressable
                    style={{ width: 138 }}
                    onPress={() =>
                      router.push({
                        pathname: '/songs',
                        params: { filter: 'album', value: item.key, title: item.title },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}, ${item.subtitle}`}
                  >
                    <View>
                      <Artwork uri={item.artwork} seed={item.title} size={138} radius={radius.md} />
                      {item.hiRes ? (
                        <View style={styles.hrPin}>
                          <HiResMark size="sm" />
                        </View>
                      ) : null}
                    </View>
                    <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: 8 }}>
                      {item.title}
                    </Txt>
                    <Txt variant="caption" numberOfLines={1}>
                      {item.subtitle}
                    </Txt>
                  </Pressable>
                )}
              />

              {homePlaylists ? (
                <TourTarget id="home.playlists">
                  {/* ── playlists carousel ── */}
                  <SectionHead
                    title="Listas"
                    action={playlists.length ? 'Ver todas' : undefined}
                    onAction={() => router.push('/playlists')}
                  />
                  <FlatList
                    horizontal
                    data={playlists}
                    keyExtractor={(p) => p.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.carousel}
                    ListHeaderComponent={
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <Pressable
                          style={{ width: 138 }}
                          onPress={() => useUI.getState().openNewPlaylist()}
                          accessibilityRole="button"
                          accessibilityLabel="Nueva lista"
                        >
                          <View style={styles.newList}>
                            <Icon name="plus" size={40} color={colors.accent} />
                          </View>
                          <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: 8 }}>
                            Nueva lista
                          </Txt>
                        </Pressable>
                        <Pressable
                          style={{ width: 138 }}
                          onPress={() => useUI.getState().openImport()}
                          accessibilityRole="button"
                          accessibilityLabel="Importar lista de otra app"
                        >
                          <View style={styles.newList}>
                            <Icon name="playlist-plus" size={40} color={colors.accent} />
                          </View>
                          <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: 8 }}>
                            Importar lista
                          </Txt>
                          <Txt variant="caption" numberOfLines={1}>
                            Spotify, Apple Music…
                          </Txt>
                        </Pressable>
                      </View>
                    }
                    renderItem={({ item }) => {
                      const count = item.trackIds.filter((id) => tracksMap[id] ?? remote[id]).length;
                      return (
                        <Pressable
                          style={{ width: 138 }}
                          onPress={() =>
                            router.push({
                              pathname: '/songs',
                              params: { filter: 'playlist', value: item.id, title: item.name },
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`${item.name}, ${count} canciones`}
                        >
                          <PlaylistCover playlist={item} count={count} size={138} radius={radius.md} />
                          <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: 8 }}>
                            {item.name}
                          </Txt>
                          <Txt variant="caption" numberOfLines={1}>
                            {count} {count === 1 ? 'canción' : 'canciones'}
                          </Txt>
                        </Pressable>
                      );
                    }}
                  />
                </TourTarget>
              ) : null}

              {homeRecent && recentShelf ? <TourTarget id="home.recent">{recentShelf}</TourTarget> : null}

              {/* ── library ── */}
              <SectionHead title="Biblioteca" />
              <View ref={libraryRef} collapsable={false} style={styles.listCard}>
                {library.map((row, i) => (
                  <Pressable
                    key={row.label}
                    onPress={() => router.push(row.href)}
                    style={({ pressed }) => [
                      styles.listRow,
                      i < library.length - 1 && styles.listDivider,
                      pressed && { backgroundColor: colors.surface2 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.label}, ${row.count}`}
                  >
                    <Icon name={row.icon} size={22} color={colors.accent} />
                    <Txt variant="bodyStrong" style={{ flex: 1 }}>
                      {row.label}
                    </Txt>
                    <Txt variant="mono">{row.count}</Txt>
                    <Icon name="chevron-right" size={20} color={colors.textMute} />
                  </Pressable>
                ))}
              </View>

              {scan.running ? (
                <View style={styles.scanRow}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Txt variant="caption">
                    {scan.message ?? 'Actualizando'} {scan.total ? `${scan.done}/${scan.total}` : ''}
                  </Txt>
                </View>
              ) : null}

              <View style={styles.footer}>
                <Txt variant="mono" style={{ textAlign: 'center' }}>
                  {tracks.length} canciones · {data.hours.toFixed(1)} h
                </Txt>
                <View style={styles.footerActions}>
                  <FooterButton icon="tray-arrow-down" label="Importar" onPress={onImport} />
                  <FooterButton
                    icon="refresh"
                    label="Buscar música"
                    onPress={() => void scanLibrary({ manual: true })}
                  />
                </View>
              </View>
            </>
          ) : (
            <EmptyLibrary scanning={scan.running} message={scan.message} onImport={onImport} />
          )}
        </View>
      </ScrollView>
      <MiniPlayer />
    </View>
  );
}

/* ───────── pieces ───────── */

function RecentCard({ track, onPress }: { track: Track; onPress: () => void }) {
  return (
    <Pressable style={{ width: 112 }} onPress={onPress} accessibilityRole="button" accessibilityLabel={track.title}>
      <Artwork uri={track.artwork} seed={track.album} size={112} radius={radius.sm + 2} />
      <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: 6, fontSize: 14 }}>
        {track.title}
      </Txt>
      <Txt variant="caption" numberOfLines={1} style={{ fontSize: 12 }}>
        {track.artist}
      </Txt>
    </Pressable>
  );
}

function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <Txt variant="title" style={{ fontSize: 20 }}>
        {title}
      </Txt>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Txt variant="caption" style={{ color: colors.accent }}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

function Chip({
  icon,
  label,
  onPress,
  tint,
  strong,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tint?: string;
  strong?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        strong && { backgroundColor: colors.accent, borderColor: colors.accent },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
    >
      <Icon name={icon} size={17} color={strong ? colors.onAccent : (tint ?? colors.accent)} />
      <Txt variant="bodyStrong" style={[{ fontSize: 14 }, strong && { color: colors.onAccent }]}>
        {label}
      </Txt>
    </Pressable>
  );
}

function FooterButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.footerBtn, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
    >
      <Icon name={icon} size={18} color={colors.textDim} />
      <Txt variant="caption">{label}</Txt>
    </Pressable>
  );
}

function EmptyLibrary({ scanning, message, onImport }: { scanning: boolean; message?: string; onImport: () => void }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyLogo, { backgroundColor: withAlpha(colors.accent, 0.1) }]}>
        <Image source={LOGO} style={{ width: 64, height: 76 }} tintColor={colors.accent} contentFit="contain" />
      </View>
      <Txt variant="title" style={{ textAlign: 'center' }}>
        {scanning ? 'Buscando tu música…' : 'Tu biblioteca está vacía'}
      </Txt>
      <Txt variant="body" style={{ color: colors.textDim, textAlign: 'center' }}>
        {message ??
          (Platform.OS === 'ios'
            ? 'Importa archivos FLAC, ALAC, WAV, AIFF o MP3 desde Archivos, o cópialos a Quartz desde el Finder.'
            : 'Quartz lee la música de tu dispositivo. También puedes importar archivos FLAC, WAV, ALAC o MP3.')}
      </Txt>
      {scanning ? <ActivityIndicator color={colors.accent} /> : null}
      <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 8 }}>
        <Pressable
          onPress={onImport}
          style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
          accessibilityRole="button"
        >
          <Icon name="tray-arrow-down" size={20} color={colors.onAccent} />
          <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
            Importar archivos
          </Txt>
        </Pressable>
        <Pressable
          onPress={() => void scanLibrary({ manual: true })}
          style={[styles.emptyBtn, { borderWidth: 1, borderColor: colors.line }]}
          accessibilityRole="button"
        >
          <Icon name="refresh" size={20} />
          <Txt variant="bodyStrong">{Platform.OS === 'ios' ? 'Buscar de nuevo' : 'Escanear dispositivo'}</Txt>
        </Pressable>
        <Pressable
          onPress={() => router.push('/discover')}
          style={[styles.emptyBtn, { borderWidth: 1, borderColor: colors.line }]}
          accessibilityRole="button"
        >
          <Icon name="download-circle-outline" size={20} />
          <Txt variant="bodyStrong">Descargar música libre</Txt>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 14 },
  logo: { width: 30, height: 36, flexShrink: 0 },
  wordmark: { flex: 1, minWidth: 0, fontFamily: fonts.brand, fontSize: 19, color: colors.text, letterSpacing: 2 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, marginRight: -6 },

  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
  },
  carousel: { gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  tab: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
  },
  newList: {
    width: 138,
    height: 138,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  hrPin: { position: 'absolute', right: 6, bottom: 6 },
  listCard: {
    marginHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 54, paddingHorizontal: 16 },
  listDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, paddingHorizontal: 16 },
  footer: { marginTop: 24, gap: 12, alignItems: 'center' },
  footerActions: { flexDirection: 'row', gap: 10 },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 28 },
  emptyLogo: {
    width: 120,
    height: 120,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyBtn: {
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
