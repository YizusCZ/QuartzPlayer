import { memo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Player } from '@/audio/engine';
import { cancelYtDownload, confirmDeleteDownloads, useYtDownloads, useYtInLibrary } from '@/catalog/ytDownloads';
import { Artwork } from '@/components/ui/Artwork';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { formatTime } from '@/library/types';
import { useLibrary } from '@/store/library';
import { currentTrackId, usePlayer } from '@/store/player';
import { useUI } from '@/store/ui';
import { colors, radius } from '@/theme';
import {
  toTrack,
  type YtCollection,
  type YtItem,
  type YtNav,
  type YtSection,
  type YtSong,
  type YtVideo,
} from './music';

type Playable = YtSong | YtVideo;

const asSong = (i: Playable): YtSong =>
  i.kind === 'song'
    ? i
    : {
        kind: 'song',
        videoId: i.videoId,
        title: i.title,
        artist: i.subtitle.split(' • ')[0],
        thumbnail: i.thumbnail,
        video: true,
      };

/** Plays YouTube songs as a queue (they are kept apart from your files). */
export function playYt(items: Playable[], index = 0, shuffle = false) {
  const tracks = items.map((i) => toTrack(asSong(i)));
  useLibrary.getState().addRemote(tracks);
  tap('select');
  Player.playTracks(
    tracks.map((t) => t.id),
    index,
    { shuffle },
  );
}

/** Long press: the usual song menu (queue, playlists, favourites). */
function openMenu(s: Playable) {
  const t = toTrack(asSong(s));
  useLibrary.getState().addRemote([t]);
  useUI.getState().openActions(t.id);
}

export function openCollection(c: YtCollection | YtNav) {
  tap('select');
  router.push({ pathname: '/yt-browse', params: { browseId: c.browseId, params: c.params ?? '', title: c.title } });
}

export const SongRow = memo(function SongRow({
  song,
  onPress,
  index,
  onWatch,
}: {
  song: YtSong;
  onPress: () => void;
  index?: number;
  /** Plays it and opens the player on its music video. */
  onWatch?: () => void;
}) {
  const playing = usePlayer((s) => currentTrackId(s) === `yt:${song.videoId}`);
  const dlState = useYtDownloads((s) => s.items[song.videoId]);
  const inLib = useYtInLibrary(song.videoId);
  const isDone = inLib || dlState?.status === 'done';
  const isBusy =
    !inLib && (dlState?.status === 'downloading' || dlState?.status === 'resolving' || dlState?.status === 'queued');
  const pct = dlState?.status === 'downloading' && dlState.progress != null ? Math.round(dlState.progress * 100) : null;

  const onStatusPress = () => {
    tap('select');
    if (isBusy) {
      cancelYtDownload(song.videoId);
      return;
    }
    if (isDone) confirmDeleteDownloads([song.videoId], { title: song.title, artwork: song.thumbnail });
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => openMenu(song)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
      accessibilityRole="button"
      accessibilityLabel={`${song.title}, ${song.artist}`}
    >
      {index != null ? (
        <Txt variant="mono" style={styles.index}>
          {index + 1}
        </Txt>
      ) : null}
      <Artwork uri={song.thumbnail} seed={song.title} size={48} radius={6} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1} style={playing && { color: colors.accent }}>
          {song.title}
        </Txt>
        <Txt variant="caption" numberOfLines={1}>
          {song.artist}
          {song.album && song.album !== song.title ? ` · ${song.album}` : ''}
        </Txt>
      </View>
      <View style={styles.rightCluster}>
        {isBusy || isDone ? (
          <Pressable
            onPress={onStatusPress}
            hitSlop={8}
            style={styles.status}
            accessibilityRole="button"
            accessibilityLabel={isBusy ? 'Cancelar descarga' : 'Eliminar de la biblioteca local'}
          >
            {isBusy ? (
              pct != null ? (
                <Txt variant="mono" style={{ fontSize: 11, color: colors.accent }}>
                  {pct}%
                </Txt>
              ) : (
                <ActivityIndicator size={13} color={colors.accent} />
              )
            ) : (
              <Icon name="check-circle" size={16} color={colors.accent} />
            )}
          </Pressable>
        ) : null}
        {song.duration ? <Txt variant="mono">{formatTime(song.duration)}</Txt> : null}
      </View>
      {onWatch ? (
        <Pressable
          onPress={onWatch}
          hitSlop={8}
          style={styles.watch}
          accessibilityRole="button"
          accessibilityLabel="Ver el vídeo"
        >
          <Icon name="play-box-outline" size={22} color={colors.accent} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => openMenu(song)}
        hitSlop={10}
        style={styles.more}
        accessibilityRole="button"
        accessibilityLabel="Más opciones"
      >
        <Icon name="dots-vertical" size={20} color={colors.textMute} />
      </Pressable>
    </Pressable>
  );
});

/** "Selecciones rápidas": columns of four songs, paged sideways. */
function QuickPicks({ songs }: { songs: YtSong[] }) {
  const { width } = useWindowDimensions();
  const colW = Math.round(width * 0.86);
  const columns: YtSong[][] = [];
  for (let i = 0; i < songs.length; i += 4) columns.push(songs.slice(i, i + 4));
  return (
    <FlatList
      horizontal
      data={columns}
      keyExtractor={(_, i) => `c${i}`}
      showsHorizontalScrollIndicator={false}
      snapToInterval={colW}
      decelerationRate="fast"
      contentContainerStyle={{ paddingRight: width - colW }}
      renderItem={({ item, index: c }) => (
        <View style={{ width: colW }}>
          {item.map((s, r) => (
            <SongRow key={s.videoId} song={s} onPress={() => playYt(songs, c * 4 + r)} />
          ))}
        </View>
      )}
    />
  );
}

const Card = memo(function Card({ item, wide }: { item: YtCollection | YtVideo; wide?: boolean }) {
  const w = wide ? 260 : 150;
  const h = wide ? 146 : 150;
  const round = item.kind === 'collection' && item.page === 'artist';
  return (
    <Pressable
      style={{ width: w }}
      onPress={() => (item.kind === 'video' ? playYt([item]) : openCollection(item))}
      onLongPress={() => item.kind === 'video' && openMenu(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.subtitle}`}
    >
      <View style={{ width: w, height: h, borderRadius: round ? h / 2 : radius.md, overflow: 'hidden' }}>
        <Artwork
          uri={item.thumbnail}
          seed={item.title}
          size={Math.max(w, h)}
          radius={0}
          style={{ width: w, height: h }}
        />
        {item.kind === 'video' ? (
          <View style={styles.playBadge}>
            <Icon name="play" size={18} color="#fff" />
          </View>
        ) : null}
      </View>
      <Txt variant="bodyStrong" numberOfLines={1} style={{ marginTop: 8, textAlign: round ? 'center' : 'left' }}>
        {item.title}
      </Txt>
      <Txt variant="caption" numberOfLines={2} style={{ textAlign: round ? 'center' : 'left' }}>
        {item.subtitle}
      </Txt>
    </Pressable>
  );
});

/** A playlist, album or artist as a row: how filtered search results read best. */
const CollectionRow = memo(function CollectionRow({ item }: { item: YtCollection | YtVideo }) {
  const round = item.kind === 'collection' && item.page === 'artist';
  return (
    <Pressable
      onPress={() => (item.kind === 'video' ? playYt([item]) : openCollection(item))}
      onLongPress={() => item.kind === 'video' && openMenu(item)}
      style={({ pressed }) => [styles.row, styles.tallRow, pressed && { backgroundColor: colors.surface2 }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.subtitle}`}
    >
      <Artwork uri={item.thumbnail} seed={item.title} size={56} radius={round ? 28 : 6} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {item.title}
        </Txt>
        <Txt variant="caption" numberOfLines={1}>
          {item.subtitle}
        </Txt>
      </View>
      <Icon name={item.kind === 'video' ? 'play-circle-outline' : 'chevron-right'} size={22} color={colors.textMute} />
    </Pressable>
  );
});

function NavGrid({ items }: { items: YtNav[] }) {
  // Three rows, scrolling sideways, like YouTube Music's mood grid.
  const columns: YtNav[][] = [];
  for (let i = 0; i < items.length; i += 3) columns.push(items.slice(i, i + 3));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navGrid}>
      {columns.map((col, c) => (
        <View key={c} style={{ gap: 10 }}>
          {col.map((n) => (
            <Pressable
              key={n.browseId + (n.params ?? '') + n.title}
              onPress={() => openCollection(n)}
              style={({ pressed }) => [styles.nav, pressed && { backgroundColor: colors.surface3 }]}
              accessibilityRole="button"
            >
              <View style={[styles.navStripe, { backgroundColor: n.color }]} />
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
                {n.title}
              </Txt>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

/** One shelf, laid out according to what it holds. */
export function SectionView({ section, list }: { section: YtSection; list?: boolean }) {
  const items = section.items;
  const songs = items.filter((i): i is YtSong => i.kind === 'song');
  const navs = items.filter((i): i is YtNav => i.kind === 'nav');
  const cards = items.filter((i): i is YtCollection | YtVideo => i.kind === 'collection' || i.kind === 'video');
  const wide = cards.length > 0 && cards.every((c) => c.kind === 'video');
  return (
    <View style={{ gap: 10, marginTop: 18 }}>
      {section.title ? (
        <View style={styles.head}>
          {section.strapline ? (
            <Txt style={[styles.strap, { color: colors.accent }]}>{section.strapline.toUpperCase()}</Txt>
          ) : null}
          <Txt variant="title" style={{ fontSize: 21 }}>
            {section.title}
          </Txt>
        </View>
      ) : null}
      {songs.length >= cards.length && songs.length >= navs.length ? (
        list ? (
          <View>
            {songs.map((s, i) => (
              <SongRow
                key={s.videoId + i}
                song={s}
                index={i}
                onPress={() => playYt(songs, i)}
                onWatch={
                  s.video
                    ? () => {
                        playYt(songs, i);
                        router.push({ pathname: '/player', params: { mode: 'video' } });
                      }
                    : undefined
                }
              />
            ))}
          </View>
        ) : (
          <QuickPicks songs={songs} />
        )
      ) : navs.length > cards.length ? (
        <NavGrid items={navs} />
      ) : list ? (
        <View>
          {cards.map((c, i) => (
            <CollectionRow key={`${c.kind === 'video' ? c.videoId : c.browseId}${i}`} item={c} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={cards}
          keyExtractor={(c, i) => `${c.kind === 'video' ? c.videoId : c.browseId}${i}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carousel}
          renderItem={({ item }) => <Card item={item} wide={wide} />}
        />
      )}
    </View>
  );
}

export const isSong = (i: YtItem): i is YtSong => i.kind === 'song';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 64 },
  tallRow: { height: 74 },
  index: { width: 22, textAlign: 'right', color: colors.textMute },
  rightCluster: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { minWidth: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  watch: { padding: 6, borderRadius: 999, backgroundColor: colors.accentSoft },
  more: { padding: 4, marginLeft: 2 },
  head: { paddingHorizontal: 16, gap: 2 },
  strap: { fontSize: 12, letterSpacing: 1.2, fontWeight: '600' },
  carousel: { gap: 12, paddingHorizontal: 16 },
  playBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  navGrid: { gap: 10, paddingHorizontal: 16 },
  nav: {
    width: 170,
    height: 50,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    paddingRight: 10,
  },
  navStripe: { width: 8, alignSelf: 'stretch', marginRight: 8 },
});
