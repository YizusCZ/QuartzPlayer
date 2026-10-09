import { useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Player } from '@/audio/engine';
import { MiniPlayer, MINI_PLAYER_HEIGHT } from '@/components/MiniPlayer';
import { PlaylistCover, playlistSkin } from '@/components/cassette/PlaylistCover';
import { SKINS, type CassetteSkinId } from '@/components/cassette/skins';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet, SheetItem, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { formatTime } from '@/library/types';
import { forgetUserFile, pick } from '@/lib/userMedia';
import { useLibrary, type Playlist } from '@/store/library';
import { useUI } from '@/store/ui';
import { colors, fonts, radius, useAccent } from '@/theme';

const songs = (n: number) => `${n} ${n === 1 ? 'canción' : 'canciones'}`;

function startList(list: string[], shuffle: boolean) {
  Player.playTracks(list, shuffle ? Math.floor(Math.random() * list.length) : 0, { shuffle });
}

export default function Playlists() {
  useAccent();
  const playlists = useLibrary((s) => s.playlists);
  const tracks = useLibrary((s) => s.tracks);
  const showToast = useUI((s) => s.showToast);
  const [menu, setMenu] = useState<Playlist | null>(null);
  const [renaming, setRenaming] = useState<Playlist | null>(null);
  const [rename, setRename] = useState('');
  const [styling, setStyling] = useState<Playlist | null>(null);

  const ids = (p: Playlist) => p.trackIds.filter((id) => tracks[id]);

  const play = (p: Playlist, shuffle = false) => {
    const list = ids(p);
    if (!list.length) {
      showToast('La lista está vacía');
      return;
    }
    startList(list, shuffle);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Listas" subtitle={`${playlists.length}`} />
      <Pressable
        onPress={() => useUI.getState().openNewPlaylist()}
        style={({ pressed }) => [styles.newRow, pressed && { backgroundColor: colors.surface2 }]}
        accessibilityRole="button"
      >
        <View style={[styles.add, { backgroundColor: colors.accent }]}>
          <Icon name="plus" color={colors.onAccent} />
        </View>
        <Txt variant="bodyStrong">Nueva lista</Txt>
      </Pressable>
      <FlatList
        data={playlists}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: MINI_PLAYER_HEIGHT + 60 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="playlist-music" size={48} color={colors.textMute} />
            <Txt variant="body" style={{ color: colors.textDim, textAlign: 'center' }}>
              Crea una lista arriba y añade canciones desde el menú ⋮ de cualquier pista o desde el reproductor.
            </Txt>
          </View>
        }
        renderItem={({ item }) => {
          const list = ids(item);
          const dur = list.reduce((a, id) => a + (tracks[id]?.duration ?? 0), 0);
          return (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/songs', params: { filter: 'playlist', value: item.id, title: item.name } })
              }
              onLongPress={() => setMenu(item)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${songs(list.length)}`}
            >
              <PlaylistCover playlist={item} count={list.length} duration={dur} size={56} radius={8} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {item.name}
                </Txt>
                <Txt variant="caption">
                  {songs(list.length)}
                  {dur ? ` · ${formatTime(dur)}` : ''}
                </Txt>
              </View>
              <IconButton
                icon="dots-vertical"
                size={20}
                color={colors.textDim}
                label="Opciones de la lista"
                onPress={() => setMenu(item)}
              />
              <IconButton icon="play" size={24} filled label={`Reproducir ${item.name}`} onPress={() => play(item)} />
            </Pressable>
          );
        }}
      />
      <MiniPlayer />

      <Sheet visible={!!menu} onClose={() => setMenu(null)}>
        {menu ? (
          <>
            <SheetTitle sub={songs(ids(menu).length)}>{menu.name}</SheetTitle>
            <SheetItem icon="play" label="Reproducir" onPress={() => (setMenu(null), play(menu))} />
            <SheetItem
              icon="playlist-plus"
              label="Añadir canciones…"
              onPress={() => {
                setMenu(null);
                router.push({ pathname: '/pick-songs', params: { playlist: menu.id } });
              }}
            />
            <SheetItem icon="shuffle-variant" label="Aleatorio" onPress={() => (setMenu(null), play(menu, true))} />
            <SheetItem
              icon="playlist-play"
              label="Añadir a la cola"
              onPress={() => {
                setMenu(null);
                Player.enqueue(ids(menu));
                showToast('Añadida a la cola');
              }}
            />
            <SheetItem
              icon="image-edit-outline"
              label={menu.cover ? 'Cambiar imagen…' : 'Poner una imagen…'}
              onPress={() => {
                setMenu(null);
                pick({ kind: 'playlistCover', id: menu.id });
              }}
            />
            {menu.cover ? (
              <SheetItem
                icon="cassette"
                label="Volver al cassette"
                onPress={() => {
                  forgetUserFile(menu.cover);
                  useLibrary.getState().updatePlaylist(menu.id, { cover: undefined });
                  setMenu(null);
                }}
              />
            ) : (
              <SheetItem
                icon="palette-outline"
                label="Estilo del cassette…"
                detail={SKINS[playlistSkin(menu)].name.split(' · ')[0]}
                onPress={() => {
                  setStyling(menu);
                  setMenu(null);
                }}
              />
            )}
            <SheetItem
              icon="pencil-outline"
              label="Renombrar"
              onPress={() => {
                setRename(menu.name);
                setRenaming(menu);
                setMenu(null);
              }}
            />
            <SheetItem
              icon="delete-outline"
              label="Eliminar lista"
              danger
              onPress={() => {
                const p = menu;
                setMenu(null);
                Alert.alert('Eliminar lista', `¿Eliminar “${p.name}”? Las canciones no se borran.`, [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: () => {
                      forgetUserFile(p.cover);
                      useLibrary.getState().deletePlaylist(p.id);
                    },
                  },
                ]);
              }}
            />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!styling} onClose={() => setStyling(null)}>
        {styling ? (
          <>
            <SheetTitle sub="La carátula de la lista">Estilo del cassette</SheetTitle>
            <ScrollView contentContainerStyle={styles.skinGrid}>
              {(Object.keys(SKINS) as CassetteSkinId[]).map((id) => {
                const on = playlistSkin(styling) === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => {
                      useLibrary.getState().updatePlaylist(styling.id, { skin: id });
                      setStyling(null);
                    }}
                    style={[styles.skinCell, on && { borderColor: colors.accent }]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={SKINS[id].name}
                  >
                    <PlaylistCover
                      playlist={{ ...styling, cover: undefined, skin: id }}
                      count={ids(styling).length}
                      size={96}
                      radius={10}
                    />
                    <Txt variant="caption" numberOfLines={1} style={on && { color: colors.accent }}>
                      {SKINS[id].name.split(' · ')[0]}
                    </Txt>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!renaming} onClose={() => setRenaming(null)}>
        <SheetTitle>Renombrar lista</SheetTitle>
        <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 12 }}>
          <TextInput
            value={rename}
            onChangeText={setRename}
            autoFocus
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (renaming && rename.trim()) useLibrary.getState().renamePlaylist(renaming.id, rename.trim());
              setRenaming(null);
            }}
          />
          <Pressable
            onPress={() => {
              if (renaming && rename.trim()) useLibrary.getState().renamePlaylist(renaming.id, rename.trim());
              setRenaming(null);
            }}
            style={[styles.save, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
          >
            <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
              Guardar
            </Txt>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  input: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    color: colors.text,
    paddingHorizontal: 14,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  add: { width: 56, height: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  row: { height: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8 },
  empty: { alignItems: 'center', gap: 12, padding: 32 },
  skinGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, padding: 16, paddingTop: 4 },
  skinCell: { alignItems: 'center', gap: 6, padding: 6, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  save: { height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
