import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/ui/Artwork';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { searchTracks } from '@/library/selectors';
import type { Track } from '@/library/types';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { colors, fonts, useAccent } from '@/theme';

const ROW = 60;

const Row = memo(function Row({
  track,
  selected,
  inList,
  onToggle,
}: {
  track: Track;
  selected: boolean;
  inList: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onToggle(track.id)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${track.title}, ${track.artist}`}
    >
      <Artwork uri={track.artwork} seed={track.album} size={42} radius={6} />
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {track.title}
        </Txt>
        <Txt variant="caption" numberOfLines={1}>
          {inList ? 'Ya está en la lista · ' : ''}
          {track.artist}
        </Txt>
      </View>
      <Icon
        name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
        size={24}
        color={selected ? colors.accent : colors.textMute}
      />
    </Pressable>
  );
});

/** Pick several songs at once for a playlist. */
export default function PickSongs() {
  useAccent();
  const insets = useSafeAreaInsets();
  const { playlist: playlistId } = useLocalSearchParams<{ playlist: string }>();
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === playlistId));
  const tracksMap = useLibrary((s) => s.tracks);
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const all = useMemo(
    () => Object.values(tracksMap).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [tracksMap],
  );
  const list = useMemo(() => (query.trim() ? searchTracks(all, query) : all), [all, query]);
  const inList = useMemo(() => new Set(playlist?.trackIds ?? []), [playlist]);

  const toggle = useCallback((id: string) => {
    tap('select');
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const save = () => {
    if (!playlist || !selected.size) return;
    // Keep the library order the user saw, not the tap order.
    const ids = all.filter((t) => selected.has(t.id)).map((t) => t.id);
    useLibrary.getState().addToPlaylist(playlist.id, ids);
    useUI.getState().showToast(`${ids.length} ${ids.length === 1 ? 'canción añadida' : 'canciones añadidas'}`);
    router.back();
  };

  if (!playlist) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Añadir canciones" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Añadir canciones" subtitle={playlist.name} />
      <View style={styles.search}>
        <Icon name="magnify" size={20} color={colors.textDim} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Buscar en tu biblioteca"
          placeholderTextColor={colors.textMute}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        getItemLayout={(_, i) => ({ length: ROW, offset: ROW * i, index: i })}
        initialNumToRender={16}
        windowSize={11}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        extraData={selected}
        renderItem={({ item }) => (
          <Row track={item} selected={selected.has(item.id)} inList={inList.has(item.id)} onToggle={toggle} />
        )}
        ListEmptyComponent={
          <Txt variant="body" style={{ color: colors.textDim, textAlign: 'center', padding: 32 }}>
            {q ? `Sin resultados para “${q}”.` : 'Tu biblioteca está vacía.'}
          </Txt>
        }
      />
      <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={save}
          disabled={!selected.size}
          style={[styles.save, { backgroundColor: colors.accent }, !selected.size && { opacity: 0.4 }]}
          accessibilityRole="button"
        >
          <Icon name="playlist-plus" size={22} color={colors.onAccent} />
          <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
            {selected.size
              ? `Añadir ${selected.size} ${selected.size === 1 ? 'canción' : 'canciones'}`
              : 'Elige canciones'}
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surface2,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
  row: { height: ROW, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.bg,
  },
  save: {
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
