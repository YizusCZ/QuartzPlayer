/**
 * The playlist page's big cover, with a little camera button to change it:
 * your own picture, another cassette style, or back to the cassette.
 */
import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Sheet, SheetItem, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { forgetUserFile, pick } from '@/lib/userMedia';
import { useLibrary, type Playlist } from '@/store/library';
import { colors } from '@/theme';
import { useSkinList } from './customSkins';
import { isBuiltinSkin } from './skins';
import { PlaylistCover, playlistSkin } from './PlaylistCover';

type Props = { playlist: Playlist; count: number; duration: number; size: number; radius: number };

export function PlaylistCoverEditor({ playlist, count, duration, size, radius }: Props) {
  const [sheet, setSheet] = useState<'none' | 'menu' | 'styles'>('none');
  const skins = useSkinList();
  const close = () => setSheet('none');

  return (
    <>
      <Pressable
        onPress={() => (tap('select'), setSheet('menu'))}
        accessibilityRole="button"
        accessibilityLabel="Cambiar la imagen de la lista"
      >
        <PlaylistCover playlist={playlist} count={count} duration={duration} size={size} radius={radius} />
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Icon name="camera-plus" size={20} color={colors.onAccent} />
        </View>
      </Pressable>

      <Sheet visible={sheet === 'menu'} onClose={close}>
        <SheetTitle sub={playlist.name}>Imagen de la lista</SheetTitle>
        <SheetItem
          icon="image-plus"
          label={playlist.cover ? 'Cambiar imagen' : 'Poner una imagen'}
          onPress={() => {
            close();
            pick({ kind: 'playlistCover', id: playlist.id });
          }}
        />
        <SheetItem icon="palette-outline" label="Estilo del cassette" onPress={() => setSheet('styles')} />
        {playlist.cover ? (
          <SheetItem
            icon="cassette"
            label="Volver al cassette"
            onPress={() => {
              forgetUserFile(playlist.cover);
              useLibrary.getState().updatePlaylist(playlist.id, { cover: undefined });
              close();
            }}
          />
        ) : null}
      </Sheet>

      <Sheet visible={sheet === 'styles'} onClose={close}>
        <SheetTitle sub="La carátula de la lista">Estilo del cassette</SheetTitle>
        <ScrollView contentContainerStyle={styles.grid}>
          {skins.map((sk) => {
            const on = !playlist.cover && playlistSkin(playlist) === sk.id;
            return (
              <Pressable
                key={sk.id}
                onPress={() => {
                  tap('select');
                  // Picking a style also brings the cassette back over a picture.
                  if (playlist.cover) forgetUserFile(playlist.cover);
                  useLibrary.getState().updatePlaylist(playlist.id, { skin: sk.id, cover: undefined });
                  close();
                }}
                style={[styles.cell, on && { borderColor: colors.accent }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={sk.name}
              >
                <PlaylistCover
                  playlist={{ ...playlist, cover: undefined, skin: sk.id }}
                  count={count}
                  size={96}
                  radius={10}
                />
                <Txt variant="caption" numberOfLines={1} style={on && { color: colors.accent }}>
                  {sk.name.split(' · ')[0]}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
        {!playlist.cover && !isBuiltinSkin(playlistSkin(playlist)) ? (
          <SheetItem
            icon="pencil-outline"
            label="Editar este cassette"
            onPress={() => {
              close();
              router.push({
                pathname: '/cassette-maker',
                params: { id: playlistSkin(playlist), playlist: playlist.id },
              });
            }}
          />
        ) : null}
        <SheetItem
          icon="palette-outline"
          label="Crear un cassette para esta lista"
          detail="Colores, degradados y stickers"
          onPress={() => {
            close();
            router.push({ pathname: '/cassette-maker', params: { playlist: playlist.id } });
          }}
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, padding: 16, paddingTop: 4 },
  cell: { alignItems: 'center', gap: 6, padding: 6, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
});
