import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { groupTracks, type Group, type GroupKind } from '@/library/selectors';
import { MiniPlayer, MINI_PLAYER_HEIGHT } from '@/components/MiniPlayer';
import { Artwork } from '@/components/ui/Artwork';
import { HiResMark } from '@/components/ui/FormatBadge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Txt } from '@/components/ui/Txt';
import { useLibrary } from '@/store/library';
import { colors, useAccent } from '@/theme';

const META: Record<GroupKind, { title: string; filter: string; icon: IconName }> = {
  albums: { title: 'Álbumes', filter: 'album', icon: 'album' },
  artists: { title: 'Artistas', filter: 'artist', icon: 'account-music' },
  genres: { title: 'Géneros', filter: 'genre', icon: 'tag-outline' },
  folders: { title: 'Carpetas', filter: 'folder', icon: 'folder-music' },
};

export default function Groups() {
  useAccent();
  const { kind = 'albums' } = useLocalSearchParams<{ kind: GroupKind }>();
  const meta = META[kind] ?? META.albums;
  const tracksMap = useLibrary((s) => s.tracks);
  const groups = useMemo(() => groupTracks(Object.values(tracksMap), kind), [tracksMap, kind]);
  const { width } = useWindowDimensions();

  const open = (g: Group) =>
    router.push({ pathname: '/songs', params: { filter: meta.filter, value: g.key, title: g.title } });

  if (kind === 'albums') {
    const cols = Math.max(2, Math.floor(width / 180));
    const size = (width - 16 * 2 - 12 * (cols - 1)) / cols;
    return (
      <View style={styles.screen}>
        <ScreenHeader title={meta.title} subtitle={`${groups.length}`} />
        <FlatList
          key={cols}
          data={groups}
          numColumns={cols}
          keyExtractor={(g) => g.key}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 18, paddingTop: 16, paddingBottom: MINI_PLAYER_HEIGHT + 60 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item)}
              style={{ width: size }}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${item.subtitle}`}
            >
              <View>
                <Artwork uri={item.artwork} seed={item.title} size={size} radius={10} />
                {item.hiRes ? (
                  <View style={styles.hr}>
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
        <MiniPlayer />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={meta.title} subtitle={`${groups.length}`} />
      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        contentContainerStyle={{ paddingBottom: MINI_PLAYER_HEIGHT + 60 }}
        getItemLayout={(_, i) => ({ length: 68, offset: 68 * i, index: i })}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
            accessibilityRole="button"
          >
            {kind === 'artists' ? (
              <Artwork uri={item.artwork} seed={item.title} size={48} radius={24} />
            ) : (
              <View style={styles.iconBox}>
                <Icon name={meta.icon} size={24} color={colors.accent} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {item.title}
              </Txt>
              <Txt variant="caption" numberOfLines={1}>
                {kind === 'folders' ? item.key : item.subtitle}
              </Txt>
            </View>
            {item.hiRes ? <HiResMark size="sm" /> : null}
            <Icon name="chevron-right" color={colors.textMute} />
          </Pressable>
        )}
      />
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hr: { position: 'absolute', right: 6, bottom: 6 },
  row: { height: 68, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
