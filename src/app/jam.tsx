/**
 * Salas: listen together. The lobby creates or joins a room; inside, the
 * current song, the shared queue (vote songs up), YouTube search to add more,
 * a chat, and reactions that float over everyone's screen. Games
 * (src/components/jam/RoomGames.tsx) take the room over while they last.
 */
import { memo, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Player } from '@/audio/engine';
import { startTour, TourTarget } from '@/components/tour/Tour';
import { Artwork } from '@/components/ui/Artwork';
import { Gem } from '@/components/ui/Gem';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Marquee } from '@/components/ui/Marquee';
import { SeekBar } from '@/components/ui/SeekBar';
import { Sheet, SheetItem, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { friendlyError } from '@/lib/net';
import {
  createRoom,
  Jam,
  jamAvailable,
  joinRoom,
  leaveRoom,
  normalizeCode,
  sendChat,
  sendReaction,
} from '@/jam/session';
import { GamesTab, GameStage } from '@/components/jam/RoomGames';
import { gemFor, JAM_GEMS, songHidden, useGame, useJam, useJamProfile } from '@/jam/store';
import type { Member, Reaction, RoomTrack } from '@/jam/types';
import { formatTime } from '@/library/types';
import { usePlayer } from '@/store/player';
import { colors, fonts, radius, useAccent, withAlpha } from '@/theme';
import { searchSongs, toTrack, type YtSong } from '@/youtube/music';

const LOBBY_ART = require('../../assets/images/jam-lobby.png');
const WELCOME_ART = require('../../assets/images/jam-welcome.png');

const EMOJIS = ['🔥', '❤️', '😂', '🙌', '🕺', '😮', '🎶'];
const GLASS = 'rgba(20,20,22,0.78)';

export default function JamScreen() {
  useAccent();
  const status = useJam((s) => s.status);
  const { code } = useLocalSearchParams<{ code?: string }>();
  // Opened from an invite link: straight into that room.
  useEffect(() => {
    if (code && useJam.getState().status === 'idle') void joinRoom(code);
  }, [code]);
  return status === 'joined' ? <Room /> : <Lobby initialCode={code} />;
}

/* ───────── lobby ───────── */

function Lobby({ initialCode }: { initialCode?: string }) {
  const insets = useSafeAreaInsets();
  const profile = useJamProfile();
  const status = useJam((s) => s.status);
  const error = useJam((s) => s.error);
  const [code, setCode] = useState(initialCode ? normalizeCode(initialCode) : '');
  const busy = status === 'connecting';
  const off = !jamAvailable || busy;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 32, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <IconButton icon="chevron-left" size={28} label="Atrás" onPress={() => router.back()} />
          <Txt variant="title" style={{ flex: 1 }}>
            Salas
          </Txt>
        </View>

        <View style={styles.hero}>
          <View pointerEvents="none" style={styles.heroArt}>
            <View style={[styles.heroGlow, { backgroundColor: withAlpha(colors.accent, 0.1) }]} />
            <View style={[styles.heroGlowInner, { backgroundColor: withAlpha(colors.accent, 0.14) }]} />
            <Image source={LOBBY_ART} style={styles.heroImage} contentFit="contain" />
          </View>
          <View style={[styles.heroTag, { backgroundColor: withAlpha(colors.accent, 0.14) }]}>
            <View style={styles.liveDot} />
            <Txt style={[styles.heroTagText, { color: colors.accent }]}>SALAS EN VIVO</Txt>
          </View>
          <Txt variant="display" style={{ textAlign: 'center' }}>
            No hay como compartir la música
          </Txt>
          <Txt variant="body" style={{ color: colors.textDim, textAlign: 'center' }}>
            Escucha con más personas sus canciones dentro de una sala: añade, vota, reacciona y chatea.
          </Txt>
        </View>

        {!jamAvailable ? (
          <View style={styles.card}>
            <Txt variant="bodyStrong">Las salas no están configuradas</Txt>
            <Txt variant="caption">
              Falta el servidor en tiempo real: añade EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY al
              archivo .env y vuelve a compilar.
            </Txt>
          </View>
        ) : null}

        {/* who you are */}
        <View style={styles.card}>
          <View style={styles.profile}>
            <Avatar name={profile.name} color={profile.color} size={60} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="label">TU NOMBRE EN LA SALA</Txt>
              <TextInput
                value={profile.name}
                onChangeText={(name) => profile.set({ name: name.slice(0, 24) })}
                placeholder="Tu nombre"
                placeholderTextColor={colors.textMute}
                style={styles.nameInput}
              />
            </View>
          </View>
          <View style={{ gap: 2 }}>
            <Txt variant="label">TU MINERAL</Txt>
            <Txt variant="caption" style={{ fontSize: 12 }}>
              Así te reconocen en el chat, la cola y la lista de personas.
            </Txt>
          </View>
          <View style={styles.gems}>
            {JAM_GEMS.map((g) => {
              const on = gemFor(profile.color) === g;
              return (
                <Pressable
                  key={g.name}
                  onPress={() => (tap('select'), profile.set({ color: g.color }))}
                  style={({ pressed }) => [
                    styles.gemChip,
                    on && { borderColor: g.color, backgroundColor: withAlpha(g.color, 0.14) },
                    pressed && { transform: [{ scale: 0.95 }] },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={g.name}
                >
                  <Gem color={g.color} size={30} />
                  <Txt
                    variant="caption"
                    numberOfLines={1}
                    style={[{ fontSize: 11 }, on && { color: g.color, fontFamily: fonts.semibold }]}
                  >
                    {g.name}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* create */}
        <Pressable
          disabled={off}
          onPress={() => (tap('medium'), void createRoom())}
          style={({ pressed }) => [styles.action, off && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
          accessibilityRole="button"
        >
          <View style={[styles.actionIcon, { backgroundColor: colors.accent }]}>
            <Icon name="plus" size={26} color={colors.onAccent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="heading">Crear una sala</Txt>
            <Txt variant="caption">Tú pones la música; invita con un código.</Txt>
          </View>
          <Icon name="chevron-right" color={colors.textMute} />
        </Pressable>

        {/* join */}
        <View style={styles.card}>
          <View style={{ gap: 2 }}>
            <Txt variant="heading">Entrar a una sala</Txt>
            <Txt variant="caption">Escribe el código de 6 caracteres que te compartieron.</Txt>
          </View>
          <CodeBoxes value={code} onChange={setCode} onSubmit={() => void joinRoom(code)} />
          <Pressable
            disabled={off || code.length !== 6}
            onPress={() => (tap('medium'), void joinRoom(code))}
            style={[styles.joinBtn, (off || code.length !== 6) && { opacity: 0.4 }]}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color={colors.onAccent} size="small" /> : null}
            <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
              {busy ? 'Conectando…' : 'Entrar'}
            </Txt>
          </Pressable>
          {status === 'error' && error ? (
            <View style={styles.errorRow}>
              <Icon name="alert-circle-outline" size={18} color={colors.danger} />
              <Txt variant="caption" style={{ color: colors.danger, flex: 1 }}>
                {error}
              </Txt>
            </View>
          ) : null}
        </View>

        <View style={styles.features}>
          {(
            [
              ['sync', 'Al mismo segundo en todos los teléfonos'],
              ['arrow-up-bold-outline', 'Voten qué suena antes'],
              ['emoticon-outline', 'Reacciones flotantes y chat'],
              ['shield-lock-outline', 'Solo YouTube: tus archivos no salen de tu teléfono'],
            ] as [IconName, string][]
          ).map(([icon, text]) => (
            <View key={text} style={styles.feature}>
              <Icon name={icon} size={18} color={colors.accent} />
              <Txt variant="caption" style={{ flex: 1 }}>
                {text}
              </Txt>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Six boxes over one hidden input: the code reads like a code. */
function CodeBoxes({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable onPress={() => input.current?.focus()} style={styles.codeRow} accessibilityLabel="Código de la sala">
      {Array.from({ length: 6 }, (_, i) => {
        const on = focused && (i === value.length || (i === 5 && value.length === 6));
        return (
          <View key={i} style={[styles.codeBox, on && { borderColor: colors.accent }]}>
            <Txt style={styles.codeChar}>{value[i] ?? ''}</Txt>
          </View>
        );
      })}
      <TextInput
        ref={input}
        value={value}
        onChangeText={(t) => onChange(normalizeCode(t))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        style={styles.hiddenInput}
        caretHidden
      />
    </Pressable>
  );
}

/* ───────── room ───────── */

type Tab = 'chat' | 'queue' | 'games';

function Room() {
  const insets = useSafeAreaInsets();
  const code = useJam((s) => s.code);
  const isHost = useJam((s) => s.isHost);
  const members = useJam((s) => s.members);
  const unread = useJam((s) => s.unread);
  const reconnecting = useJam((s) => s.reconnecting);
  const roomArtwork = useJam((s) => s.room?.queue[s.room.index]?.artwork);
  const gameOn = useGame((s) => !!s.game);
  // Guess the song: not even the blurred cover behind the room.
  const artwork = useGame((s) => songHidden(s.game)) ? undefined : roomArtwork;
  const upcoming = useJam((s) => (s.room ? s.room.queue.length - s.room.index - 1 : 0));
  const [tab, setTab] = useState<Tab>('chat');
  const [sheet, setSheet] = useState<'none' | 'menu' | 'people' | 'leave'>('none');
  const [searchOpen, setSearchOpen] = useState(false);
  const keyboard = useKeyboardHeight();

  // Drag the top of the room down to close it, like the player.
  const drag = useSharedValue(0);
  const closeRoom = () => router.back();
  const pull = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (drag.value > 140 || (drag.value > 40 && e.velocityY > 900)) {
        drag.value = withTiming(1400, { duration: 220 });
        scheduleOnRN(closeRoom);
      } else drag.value = withTiming(0, { duration: 200 });
    });
  const dropStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: drag.value }],
    borderRadius: drag.value > 0 ? 24 : 0,
  }));

  const share = () =>
    void Share.share({ message: `Escucha conmigo en Quartz. Código de la sala: ${code}\nquartz://jam?code=${code}` });

  const openTab = (t: Tab) => {
    tap('select');
    setTab(t);
    if (t === 'chat') useJam.setState({ unread: 0 });
  };

  return (
    <Animated.View style={[styles.room, dropStyle, { paddingBottom: keyboard || insets.bottom }]}>
      <RoomBackdrop uri={artwork} />

      <GestureDetector gesture={pull}>
        <View>
          {/* header: the code sits on the true centre, whatever the sides hold */}
          <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
            <View pointerEvents="box-none" style={[styles.headerCenter, { top: insets.top + 4 }]}>
              <TourTarget id="jam.code">
                <Pressable
                  onPress={share}
                  style={styles.codeChip}
                  accessibilityRole="button"
                  accessibilityLabel="Invitar"
                >
                  <View style={[styles.liveDot, reconnecting && { backgroundColor: colors.hires }]} />
                  <Txt style={styles.code}>{code}</Txt>
                  <Icon name="share-variant" size={16} color={colors.accent} />
                </Pressable>
              </TourTarget>
            </View>
            <IconButton icon="chevron-down" size={28} label="Cerrar" onPress={() => router.back()} />
            <View style={{ flex: 1 }} />
            <TourTarget id="jam.members">
              <Pressable
                onPress={() => (tap('select'), setSheet('people'))}
                style={styles.stack}
                accessibilityRole="button"
                accessibilityLabel={`${members.length} en la sala`}
              >
                {members.slice(0, 3).map((m, i) => (
                  <View key={m.id} style={{ marginLeft: i ? -12 : 0, zIndex: 3 - i, opacity: m.away ? 0.45 : 1 }}>
                    <Avatar name={m.name} color={m.color} size={32} ring />
                  </View>
                ))}
                {members.length > 3 ? (
                  <View style={[styles.more, { marginLeft: -12 }]}>
                    <Txt style={styles.moreText}>+{members.length - 3}</Txt>
                  </View>
                ) : null}
              </Pressable>
            </TourTarget>
            <IconButton icon="dots-vertical" label="Opciones de la sala" onPress={() => setSheet('menu')} />
          </View>

          {reconnecting ? (
            <View style={styles.banner}>
              <ActivityIndicator size="small" color={colors.hires} />
              <Txt variant="caption" style={{ color: colors.hires, flex: 1 }}>
                Reconectando… la música sigue sonando.
              </Txt>
            </View>
          ) : null}

          {gameOn ? null : <NowPlaying onAdd={() => setSearchOpen(true)} />}

          {/* tabs + add */}
          {gameOn ? null : (
            <TourTarget id="jam.tabs" style={styles.tabsRow}>
              <View style={styles.tabs}>
                {(
                  [
                    ['chat', 'Chat', 'chat-processing-outline'],
                    ['queue', upcoming > 0 ? `Cola · ${upcoming}` : 'Cola', 'playlist-music'],
                    ['games', 'Juegos', 'gamepad-variant'],
                  ] as [Tab, string, IconName][]
                ).map(([id, label, icon]) => (
                  <Pressable
                    key={id}
                    onPress={() => openTab(id)}
                    style={[styles.tab, tab === id && { backgroundColor: colors.surface3 }]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tab === id }}
                  >
                    <Icon name={icon} size={18} color={tab === id ? colors.accent : colors.textDim} />
                    <Txt variant="bodyStrong" style={[{ fontSize: 14 }, tab !== id && { color: colors.textDim }]}>
                      {label}
                    </Txt>
                    {id === 'chat' && unread > 0 && tab !== 'chat' ? (
                      <View style={styles.badge}>
                        <Txt style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Txt>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => (tap('select'), setSearchOpen(true))}
                style={[styles.addFab, { backgroundColor: colors.accent }]}
                accessibilityRole="button"
                accessibilityLabel="Añadir canciones"
              >
                <Icon name="plus" size={22} color={colors.onAccent} />
              </Pressable>
            </TourTarget>
          )}
        </View>
      </GestureDetector>

      <View style={{ flex: 1 }}>
        {gameOn ? (
          <GameStage />
        ) : tab === 'chat' ? (
          <ChatPanel />
        ) : tab === 'queue' ? (
          <QueueList onAdd={() => setSearchOpen(true)} />
        ) : (
          <GamesTab />
        )}
      </View>

      <Reactions />
      <SearchScreen visible={searchOpen} onClose={() => setSearchOpen(false)} />
      <Welcome />

      <Sheet visible={sheet === 'menu'} onClose={() => setSheet('none')}>
        <SheetTitle sub={`${members.length} ${members.length === 1 ? 'persona' : 'personas'} en la sala`}>
          Sala {code}
        </SheetTitle>
        <SheetItem
          icon="account-plus-outline"
          label="Invitar"
          detail="Comparte el código"
          onPress={() => (setSheet('none'), share())}
        />
        <SheetItem
          icon="tune-variant"
          label={isHost ? 'Personas y ajustes' : 'Personas'}
          onPress={() => setSheet('people')}
        />
        <SheetItem
          icon="cassette"
          label="Letras y visualizadores"
          onPress={() => (setSheet('none'), router.push('/player'))}
        />
        <SheetItem
          icon="help-circle-outline"
          label="Cómo funciona"
          onPress={() => {
            setSheet('none');
            setTimeout(() => startTour('jam'), 350);
          }}
        />
        <SheetItem icon="exit-run" label="Salir de la sala" danger onPress={() => setSheet('leave')} />
      </Sheet>

      <PeopleSheet visible={sheet === 'people'} onClose={() => setSheet('none')} />
      <LeaveSheet visible={sheet === 'leave'} onClose={() => setSheet('none')} />
    </Animated.View>
  );
}

/** The current cover, blurred and dimmed: as moody as the animated backdrop, at no cost per frame. */
const RoomBackdrop = memo(function RoomBackdrop({ uri }: { uri?: string }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={500} />
      ) : null}
      <LinearGradient
        colors={['rgba(11,11,12,0.55)', 'rgba(11,11,12,0.82)', colors.bg]}
        locations={[0, 0.45, 0.85]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
});

/** Keyboard height while it is open (0 when closed), so content can stay above it. */
function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}

function PeopleSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const members = useJam((s) => s.members);
  const isHost = useJam((s) => s.isHost);
  const mode = useJam((s) => s.room?.mode ?? 'dj');
  const radioOn = useJam((s) => s.room?.radio ?? true);
  const fairOn = useJam((s) => s.room?.fair ?? true);
  const myId = useJamProfile((s) => s.id);
  const [chosen, setChosen] = useState<Member | null>(null);
  return (
    <Sheet visible={visible} onClose={() => (setChosen(null), onClose())}>
      <SheetTitle sub={isHost ? 'Toca a alguien para pasarle la sala' : 'El anfitrión lleva la música'}>
        En la sala
      </SheetTitle>
      <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
        {members.map((m) => (
          <Pressable
            key={m.id}
            disabled={!isHost || m.id === myId || m.away}
            onPress={() => (tap('select'), setChosen(chosen?.id === m.id ? null : m))}
            style={[styles.person, chosen?.id === m.id && { borderColor: colors.accent }, m.away && { opacity: 0.55 }]}
          >
            <Avatar name={m.name} color={m.color} size={38} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {m.id === myId ? `${m.name} (tú)` : m.name}
              </Txt>
              {m.away ? (
                <Txt variant="caption" style={{ fontSize: 12 }}>
                  Reconectando…
                </Txt>
              ) : null}
            </View>
            {m.host ? (
              <View style={styles.hostPill}>
                <Icon name="broadcast" size={14} color={colors.onAccent} />
                <Txt style={styles.hostText}>Anfitrión</Txt>
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
      {chosen ? (
        <SheetItem
          icon="account-switch-outline"
          label={`Pasarle la sala a ${chosen.name}`}
          onPress={() => {
            Jam.handOver(chosen.id);
            setChosen(null);
            onClose();
          }}
        />
      ) : null}
      {isHost ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 10 }}>
          <Txt variant="label">QUIÉN CONTROLA LA MÚSICA</Txt>
          <View style={styles.segment}>
            {(
              [
                ['dj', 'Solo yo', 'account-outline'],
                ['all', 'Todos', 'account-group-outline'],
              ] as const
            ).map(([m, label, icon]) => (
              <Pressable
                key={m}
                onPress={() => (tap('select'), Jam.setMode(m))}
                style={[styles.segItem, mode === m && { backgroundColor: colors.accentSoft }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: mode === m }}
              >
                <Icon name={icon} size={18} color={mode === m ? colors.accent : colors.textDim} />
                <Txt variant="bodyStrong" style={mode === m && { color: colors.accent }}>
                  {label}
                </Txt>
              </Pressable>
            ))}
          </View>
          <SettingRow
            icon="radio"
            label="Radio de la sala"
            detail="Si la cola se acaba, sigue con canciones parecidas a la última."
            value={radioOn}
            onChange={(v) => Jam.setRadio(v)}
          />
          <SettingRow
            icon="account-convert-outline"
            label="Turnos justos"
            detail="Las canciones de cada persona se alternan, para que nadie acapare la cola."
            value={fairOn}
            onChange={(v) => Jam.setFair(v)}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

function SettingRow({
  icon,
  label,
  detail,
  value,
  onChange,
}: {
  icon: IconName;
  label: string;
  detail: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.setting}>
      <Icon name={icon} size={22} color={colors.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        <Txt variant="caption" style={{ fontSize: 12 }}>
          {detail}
        </Txt>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => (tap('select'), onChange(v))}
        trackColor={{ true: colors.accent, false: colors.surface3 }}
        thumbColor={colors.text}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** The song playing, compact so the chat gets the room it deserves. */
function NowPlaying({ onAdd }: { onAdd: () => void }) {
  const track = useJam((s) => s.room?.queue[s.room.index]);
  const isHost = useJam((s) => s.isHost);
  const canControl = useJam((s) => s.isHost || s.room?.mode === 'all');
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const skip = useJam((s) => s.room?.skip.length ?? 0);
  const present = useJam((s) => s.members.filter((m) => !m.away).length);
  const previous = useJam((s) => s.previous);

  if (!track) {
    return (
      <View style={[styles.card, styles.empty]}>
        <View style={styles.emptyIcon}>
          <Icon name="music-note-plus" size={30} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading">La sala está en silencio</Txt>
          <Txt variant="caption">Añade la primera canción y empieza la fiesta.</Txt>
        </View>
        {isHost && previous ? (
          <Pressable
            onPress={() => (tap('medium'), Jam.sharePrevious())}
            style={styles.pill}
            accessibilityRole="button"
            accessibilityLabel="Compartir lo que sonaba"
          >
            <Icon name="play" size={16} color={colors.onAccent} />
            <Txt variant="bodyStrong" style={{ color: colors.onAccent, fontSize: 13 }}>
              Lo que sonaba
            </Txt>
          </Pressable>
        ) : (
          <IconButton icon="magnify" label="Buscar canciones" color={colors.accent} onPress={onAdd} />
        )}
      </View>
    );
  }
  const needed = Math.max(1, Math.ceil(present / 2));
  return (
    <View style={styles.card}>
      <View style={styles.nowRow}>
        <View>
          <Artwork uri={track.artwork} seed={track.album ?? track.title} size={92} radius={14} />
          {buffering ? (
            <View style={[StyleSheet.absoluteFill, styles.center, styles.buffering]}>
              <ActivityIndicator color="#fff" size="small" />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
          <Marquee variant="heading" text={track.title} />
          <Txt variant="caption" numberOfLines={1}>
            {track.artist}
          </Txt>
          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <View style={[styles.byDot, { backgroundColor: track.byColor }]} />
              <Txt variant="caption" numberOfLines={1} style={{ fontSize: 11, flexShrink: 1 }}>
                {track.by}
              </Txt>
            </View>
            <SyncPill />
          </View>
        </View>
      </View>
      <SeekBar />
      <View style={styles.controls}>
        <IconButton
          icon="skip-previous"
          size={30}
          label="Anterior"
          onPress={Player.prev}
          disabled={!canControl}
          style={!canControl && { opacity: 0.3 }}
        />
        <IconButton
          icon={playing ? 'pause' : 'play'}
          size={34}
          filled
          label={playing ? 'Pausar' : 'Reproducir'}
          onPress={Player.toggle}
          disabled={!canControl}
          style={!canControl && { opacity: 0.3 }}
        />
        {canControl ? (
          <IconButton icon="skip-next" size={30} label="Siguiente" onPress={Player.next} />
        ) : (
          <Pressable
            onPress={() => (tap('medium'), Jam.voteSkip())}
            style={styles.skipBtn}
            accessibilityRole="button"
            accessibilityLabel="Votar para saltar"
          >
            <Icon name="skip-next" size={18} color={colors.text} />
            <View style={styles.skipMeter}>
              <View
                style={[
                  styles.skipFill,
                  { width: `${Math.min(1, skip / needed) * 100}%`, backgroundColor: colors.accent },
                ]}
              />
            </View>
            <Txt variant="mono" style={{ fontSize: 11 }}>
              {skip}/{needed}
            </Txt>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Its own component: the gap to the host changes every second, nothing else needs to redraw. */
function SyncPill() {
  const isHost = useJam((s) => s.isHost);
  const drift = useJam((s) => s.drift);
  const reconnecting = useJam((s) => s.reconnecting);
  const synced = drift != null && Math.abs(drift) < 40;
  const label = reconnecting
    ? 'Reconectando'
    : isHost
      ? 'Anfitrión'
      : drift == null
        ? 'Sincronizando'
        : synced
          ? `En sync · ${Math.abs(drift)} ms`
          : `Ajustando · ${Math.abs(drift)} ms`;
  const color = reconnecting ? colors.hires : isHost ? colors.accent : synced ? colors.ok : colors.textDim;
  return (
    <TourTarget id="jam.sync" style={styles.metaPill}>
      <Icon name={isHost ? 'broadcast' : 'sync'} size={13} color={color} />
      <Txt variant="caption" numberOfLines={1} style={{ fontSize: 11, color }}>
        {label}
      </Txt>
    </TourTarget>
  );
}

function QueueList({ onAdd }: { onAdd: () => void }) {
  const room = useJam((s) => s.room);
  const isHost = useJam((s) => s.isHost);
  const myId = useJamProfile((s) => s.id);
  const upcoming = room ? room.queue.slice(room.index + 1) : [];
  const remove = (t: RoomTrack, index: number) => {
    tap('medium');
    Alert.alert('Quitar de la cola', `¿Quitar “${t.title}”?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Quitar', style: 'destructive', onPress: () => Jam.command({ type: 'remove', index }) },
    ]);
  };
  return (
    <FlatList
      data={upcoming}
      keyExtractor={(t, i) => `${t.id}:${i}`}
      contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 8 }}
      ListEmptyComponent={
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 28 }}>
          <Icon name="playlist-plus" size={34} color={colors.textMute} />
          <Txt variant="caption" style={{ textAlign: 'center', maxWidth: 260 }}>
            {room?.radio
              ? 'No hay nada en cola. Añade canciones; si se acaba, la radio de la sala sigue sola.'
              : 'No hay nada en cola. Añade canciones y vótalas para que suenen antes.'}
          </Txt>
          <Pressable onPress={onAdd} style={styles.pill} accessibilityRole="button">
            <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
              Añadir canciones
            </Txt>
          </Pressable>
        </View>
      }
      ListFooterComponent={
        upcoming.length ? (
          <Txt variant="caption" style={{ textAlign: 'center', marginTop: 4, fontSize: 12 }}>
            {isHost ? 'Las más votadas suben. Mantén pulsada una para quitarla.' : 'Las más votadas suben en la cola.'}
          </Txt>
        ) : null
      }
      renderItem={({ item: t, index: i }) => {
        const voted = t.votes.includes(myId);
        return (
          <Pressable
            onLongPress={isHost && room ? () => remove(t, room.index + 1 + i) : undefined}
            style={[styles.row, i === 0 && styles.nextRow]}
          >
            <View>
              <Artwork uri={t.artwork} seed={t.album ?? t.title} size={48} radius={10} />
              <View style={[styles.byBadge, { backgroundColor: t.byColor }]}>
                <Txt style={styles.byBadgeText}>{(t.by.trim()[0] ?? '?').toUpperCase()}</Txt>
              </View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              {i === 0 ? (
                <Txt variant="label" style={{ color: colors.accent, fontSize: 10 }}>
                  SIGUE
                </Txt>
              ) : null}
              <Txt variant="bodyStrong" numberOfLines={1}>
                {t.title}
              </Txt>
              <Txt variant="caption" numberOfLines={1}>
                {t.artist} · {t.by}
              </Txt>
            </View>
            <Pressable
              onPress={() => (tap('select'), Jam.vote(t.id))}
              style={[styles.vote, voted && { backgroundColor: colors.accent }]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={voted ? 'Quitar voto' : 'Votar para que suene antes'}
            >
              <Icon name="arrow-up-bold" size={16} color={voted ? colors.onAccent : colors.textDim} />
              <Txt variant="mono" style={[{ fontSize: 12 }, voted && { color: colors.onAccent }]}>
                {t.votes.length}
              </Txt>
            </Pressable>
          </Pressable>
        );
      }}
    />
  );
}

/** Full screen, so the keyboard never hides the results: field on top, songs below. */
function SearchScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ q: string; songs: YtSong[]; error?: string } | null>(null);
  const [added, setAdded] = useState(0);
  const room = useJam((s) => s.room);
  const query = q.trim();

  useEffect(() => {
    if (!query) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchSongs(query, ctrl.signal)
        .then((songs) => setFound({ q: query, songs }))
        .catch((e: Error) => !ctrl.signal.aborted && setFound({ q: query, songs: [], error: friendlyError(e) }));
    }, 300);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query]);

  // The last results stay while the next ones load.
  const loading = !!query && found?.q !== query;
  const songs = query && found ? found.songs : [];
  const inQueue = new Set((room?.queue.slice(room.index) ?? []).map((t) => t.id));
  const close = () => {
    Keyboard.dismiss();
    setAdded(0);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 6 }}>
        <View style={styles.searchHead}>
          <IconButton icon="arrow-left" size={26} label="Volver a la sala" onPress={close} />
          <View style={[styles.field, { flex: 1 }]}>
            <Icon name="magnify" size={20} color={colors.textDim} />
            <TextInput
              value={q}
              onChangeText={setQ}
              autoFocus
              placeholder="Busca en YouTube Music"
              placeholderTextColor={colors.textMute}
              style={styles.fieldInput}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={Keyboard.dismiss}
            />
            {q ? <IconButton icon="close" size={18} label="Borrar" onPress={() => setQ('')} /> : null}
          </View>
        </View>
        {added > 0 ? (
          <View style={styles.addedBar}>
            <Icon name="check-circle" size={16} color={colors.ok} />
            <Txt variant="caption" style={{ flex: 1 }}>
              {added === 1 ? '1 canción añadida a la sala' : `${added} canciones añadidas a la sala`}
            </Txt>
            <Pressable onPress={close} hitSlop={8} accessibilityRole="button">
              <Txt variant="bodyStrong" style={{ color: colors.accent, fontSize: 14 }}>
                Listo
              </Txt>
            </Pressable>
          </View>
        ) : null}
        <FlatList
          data={songs}
          keyExtractor={(s) => s.videoId}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: (keyboard || insets.bottom) + 24 }}
          ListHeaderComponent={
            loading ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: songs.length ? 4 : 24 }} />
            ) : found?.error && found.q === query ? (
              <Txt variant="caption" style={{ color: colors.danger }}>
                {found.error}
              </Txt>
            ) : null
          }
          ListEmptyComponent={
            loading ? null : (
              <View style={{ alignItems: 'center', gap: 10, paddingTop: 48 }}>
                <Icon name="music-note-plus" size={40} color={colors.textMute} />
                <Txt variant="caption" style={{ textAlign: 'center' }}>
                  {query
                    ? 'Sin resultados.'
                    : 'Busca una canción o un artista. Lo que añadas entra en la cola de todos.'}
                </Txt>
              </View>
            )
          }
          renderItem={({ item: s }) => {
            const done = inQueue.has(`yt:${s.videoId}`);
            return (
              <Pressable
                onPress={() => {
                  if (done) return;
                  tap('select');
                  Jam.add(toTrack({ ...s, duration: s.duration }));
                  setAdded((n) => n + 1);
                }}
                style={styles.row}
                accessibilityRole="button"
                accessibilityLabel={done ? `${s.title}, ya en la cola` : `Añadir ${s.title}`}
              >
                <Artwork uri={s.thumbnail} seed={s.title} size={50} radius={10} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {s.title}
                  </Txt>
                  <Txt variant="caption" numberOfLines={1}>
                    {s.artist ?? 'YouTube'}
                    {s.duration ? ` · ${formatTime(s.duration)}` : ''}
                  </Txt>
                </View>
                {done ? (
                  <View style={styles.queuedPill}>
                    <Icon name="check" size={14} color={colors.ok} />
                    <Txt variant="caption" style={{ fontSize: 12, color: colors.ok }}>
                      En la cola
                    </Txt>
                  </View>
                ) : (
                  <View style={[styles.addBtn, { backgroundColor: colors.accent }]}>
                    <Icon name="plus" size={20} color={colors.onAccent} />
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

/** The chat is the heart of the room: newest at the bottom, composer and reactions right under it. */
function ChatPanel() {
  const chat = useJam((s) => s.chat);
  const myId = useJamProfile((s) => s.id);
  const [text, setText] = useState('');
  const [tray, setTray] = useState(false);
  useEffect(() => {
    useJam.setState({ unread: 0 });
  }, [chat.length]);
  const send = () => {
    if (!text.trim()) return;
    tap('select');
    sendChat(text);
    setText('');
  };
  // Inverted list: index 0 is the newest message, drawn at the bottom.
  const items = chat.slice(-100).reverse();
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        inverted
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}
        ListEmptyComponent={
          <View style={styles.chatEmpty}>
            <Icon name="chat-outline" size={30} color={colors.textMute} />
            <Txt variant="caption" style={{ textAlign: 'center' }}>
              Di hola a la sala. Los mensajes y reacciones los ven todos al instante.
            </Txt>
          </View>
        }
        renderItem={({ item: m, index: i }) => {
          if (m.from === 'system') {
            return (
              <View style={styles.systemRow}>
                <Txt variant="caption" style={{ fontSize: 12, textAlign: 'center' }}>
                  {m.text}
                </Txt>
              </View>
            );
          }
          const mine = m.from === myId;
          // Older neighbour is the next item in the inverted list.
          const first = items[i + 1]?.from !== m.from;
          return (
            <View style={[styles.bubbleRow, mine && { flexDirection: 'row-reverse' }]}>
              {first ? <Avatar name={m.name} color={m.color} size={28} /> : <View style={{ width: 28 }} />}
              <View style={[styles.bubble, mine && { backgroundColor: withAlpha(colors.accent, 0.24) }]}>
                {!mine && first ? (
                  <Txt variant="caption" style={{ color: m.color, fontSize: 12, fontFamily: fonts.medium }}>
                    {m.name}
                  </Txt>
                ) : null}
                <Txt variant="body">{m.text}</Txt>
              </View>
            </View>
          );
        }}
      />
      {tray ? (
        <TourTarget id="jam.react" style={styles.tray}>
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => (tap('select'), sendReaction(e))}
              style={({ pressed }) => [styles.emojiBtn, pressed && { transform: [{ scale: 1.25 }] }]}
              accessibilityRole="button"
              accessibilityLabel={`Reaccionar ${e}`}
            >
              <Txt style={styles.emoji}>{e}</Txt>
            </Pressable>
          ))}
        </TourTarget>
      ) : null}
      <View style={styles.composer}>
        <TourTarget id={tray ? 'jam.react.off' : 'jam.react'}>
          <Pressable
            onPress={() => (tap('select'), setTray((v) => !v))}
            style={[styles.trayBtn, tray && { backgroundColor: colors.accentSoft }]}
            accessibilityRole="button"
            accessibilityLabel={tray ? 'Ocultar reacciones' : 'Reacciones'}
          >
            <Icon
              name={tray ? 'close' : 'emoticon-happy-outline'}
              size={22}
              color={tray ? colors.accent : colors.text}
            />
          </Pressable>
        </TourTarget>
        <View style={styles.inputWrap}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Escribe a la sala"
            placeholderTextColor={colors.textMute}
            style={styles.fieldInput}
            returnKeyType="send"
            onSubmitEditing={send}
            submitBehavior="submit"
            maxLength={240}
          />
        </View>
        <Pressable
          onPress={send}
          disabled={!text.trim()}
          style={[styles.sendBtn, { backgroundColor: colors.accent }, !text.trim() && { opacity: 0.35 }]}
          accessibilityRole="button"
          accessibilityLabel="Enviar"
        >
          <Icon name="send" size={18} color={colors.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}

function Avatar({ name, color, size, ring }: { name: string; color: string; size: number; ring?: boolean }) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: ring ? colors.surface2 : withAlpha(color, 0.16),
          borderColor: ring ? colors.bg : withAlpha(color, 0.7),
        },
      ]}
      accessible
      accessibilityLabel={`${name}, ${gemFor(color).name}`}
    >
      <Gem color={color} size={size * 0.64} />
    </View>
  );
}

/** Leaving, with what happens next: who carries the room on, and that your music comes back. */
function LeaveSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const isHost = useJam((s) => s.isHost);
  const members = useJam((s) => s.members);
  const myId = useJamProfile((s) => s.id);
  const others = members.filter((m) => m.id !== myId && !m.away);
  const heir = isHost ? others[0] : undefined;
  const leave = () => {
    tap('medium');
    onClose();
    // Hand over first, so the music never stops for the others.
    if (heir) Jam.handOver(heir.id);
    setTimeout(() => void leaveRoom(), heir ? 300 : 0);
  };
  const detail = heir
    ? 'La música sigue para los demás. La sala queda en manos de:'
    : isHost
      ? 'Eres la única persona aquí: la sala se cerrará.'
      : 'Puedes volver cuando quieras con el mismo código.';
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.leave}>
        <View style={styles.leaveIcon}>
          <Icon name="exit-run" size={30} color={colors.danger} />
        </View>
        <Txt variant="heading" style={{ textAlign: 'center' }}>
          ¿Salir de la sala?
        </Txt>
        <Txt variant="caption" style={{ textAlign: 'center' }}>
          {detail}
        </Txt>
        {heir ? (
          <View style={styles.heir}>
            <Avatar name={heir.name} color={heir.color} size={36} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {heir.name}
              </Txt>
              <Txt variant="caption" style={{ fontSize: 12 }}>
                Nuevo anfitrión
              </Txt>
            </View>
            <Icon name="crown-outline" size={20} color={colors.hires} />
          </View>
        ) : null}
        <View style={styles.leaveNote}>
          <Icon name="history" size={16} color={colors.textMute} />
          <Txt variant="caption" style={{ flex: 1, fontSize: 12 }}>
            Al salir vuelve lo que escuchabas antes de entrar, en pausa.
          </Txt>
        </View>
        <View style={styles.leaveBtns}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.leaveBtn, styles.stayBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <Txt variant="bodyStrong">Quedarme</Txt>
          </Pressable>
          <Pressable
            onPress={leave}
            style={({ pressed }) => [styles.leaveBtn, { backgroundColor: colors.danger }, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
          >
            <Icon name="logout" size={18} color="#fff" />
            <Txt variant="bodyStrong" style={{ color: '#fff' }}>
              Salir
            </Txt>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

/** Shown once to whoever just joined: the waving cat and whose room this is. */
function Welcome() {
  const host = useJam((s) => s.welcome);
  const k = useSharedValue(0);
  const close = () => useJam.setState({ welcome: null });
  useEffect(() => {
    if (!host) return;
    k.set(0);
    k.set(withTiming(1, { duration: 520, easing: Easing.out(Easing.back(1.6)) }));
    const t = setTimeout(close, 4200);
    return () => clearTimeout(t);
  }, [host, k]);
  const card = useAnimatedStyle(() => ({
    opacity: Math.min(1, k.value * 1.6),
    transform: [{ scale: 0.7 + k.value * 0.3 }],
  }));
  const wave = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - k.value) * 60 }, { rotate: `${(1 - k.value) * -12}deg` }],
  }));
  if (!host) return null;
  return (
    <Pressable
      style={[StyleSheet.absoluteFill, styles.welcomeBack]}
      onPress={close}
      accessibilityLabel="Cerrar bienvenida"
    >
      <Animated.View style={[styles.welcomeCard, card]}>
        <Animated.View style={wave}>
          <Image source={WELCOME_ART} style={styles.welcomeCat} contentFit="contain" />
        </Animated.View>
        <Txt variant="label" style={{ color: colors.accent }}>
          BIENVENIDO A LA SALA DE
        </Txt>
        <Txt variant="display" style={{ textAlign: 'center' }} numberOfLines={2}>
          {host}
        </Txt>
        <Txt variant="caption" style={{ textAlign: 'center' }}>
          Ya estás sincronizado con la música. Añade canciones, vota y reacciona.
        </Txt>
      </Animated.View>
    </Pressable>
  );
}

/* ───────── reactions ───────── */

function Reactions() {
  const list = useJam((s) => s.reactions);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {list.map((r) => (
        <Burst key={r.id} reaction={r} />
      ))}
    </View>
  );
}

/** A stable 0..1 from the reaction id, to spread them across the screen. */
const spread = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
};

const Burst = memo(function Burst({ reaction }: { reaction: Reaction }) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0);
  const k = spread(reaction.id);
  useEffect(() => {
    t.set(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }));
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.75 ? 1 : 1 - (t.value - 0.75) * 4,
    transform: [
      { translateY: -t.value * height * 0.55 },
      { translateX: Math.sin(t.value * 6 + k * 6) * 18 },
      { scale: 0.6 + Math.min(1, t.value * 4) * 0.6 },
    ],
  }));
  return (
    <Animated.View style={[styles.burst, { left: 24 + k * (width - 96), top: height * 0.78 }, style]}>
      <Txt style={styles.burstEmoji}>{reaction.emoji}</Txt>
      <View style={[styles.burstTag, { backgroundColor: withAlpha(reaction.color, 0.9) }]}>
        <Txt style={styles.burstName} numberOfLines={1}>
          {reaction.name}
        </Txt>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  room: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.hires, 0.14),
  },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  addFab: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  chatEmpty: { alignItems: 'center', gap: 8, paddingTop: 28, paddingHorizontal: 32 },
  tray: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginHorizontal: 12,
    marginBottom: 6,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  trayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  inputWrap: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.surface2,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  hero: { marginHorizontal: 24, alignItems: 'center', gap: 10, paddingBottom: 6 },
  heroArt: { alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  heroGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 130 },
  heroGlowInner: { position: 'absolute', width: 180, height: 180, borderRadius: 90 },
  heroImage: { width: 240, height: 228 },
  heroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  heroTagText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.4 },
  heroBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  card: { marginHorizontal: 16, padding: 16, gap: 12, borderRadius: radius.lg, backgroundColor: GLASS },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  gems: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  gemChip: {
    width: '23.5%',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
  },
  leave: { paddingHorizontal: 20, paddingTop: 4, gap: 12, alignItems: 'stretch' },
  leaveIcon: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.danger, 0.14),
  },
  heir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  leaveNote: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  leaveBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  leaveBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 999,
  },
  stayBtn: { backgroundColor: colors.surface3 },
  nameInput: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 18,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  action: {
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: GLASS,
  },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  codeRow: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  codeBox: {
    flex: 1,
    aspectRatio: 0.82,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: { fontFamily: fonts.bold, fontSize: 24, color: colors.text },
  hiddenInput: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.01, color: 'transparent' },
  joinBtn: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  features: { marginHorizontal: 16, gap: 10, paddingHorizontal: 4 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6, gap: 4, minHeight: 56 },
  headerCenter: { position: 'absolute', left: 0, right: 0, height: 48, alignItems: 'center', justifyContent: 'center' },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: GLASS,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  code: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: 3, color: colors.text },
  stack: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  more: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  moreText: { fontFamily: fonts.bold, fontSize: 11, color: colors.text },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, overflow: 'hidden' },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
  },
  hostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  hostText: { fontFamily: fonts.bold, fontSize: 11, color: colors.onAccent },
  coverShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
    borderRadius: radius.lg,
  },
  buffering: { borderRadius: radius.lg, backgroundColor: 'rgba(0,0,0,0.35)' },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: GLASS,
    maxWidth: 220,
  },
  byDot: { width: 8, height: 8, borderRadius: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, marginTop: -6 },
  playBtn: { shadowOpacity: 0.5, shadowRadius: 16, elevation: 8 },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: GLASS,
  },
  skipMeter: { width: 34, height: 4, borderRadius: 2, backgroundColor: colors.surface3, overflow: 'hidden' },
  skipFill: { height: 4 },
  openPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: GLASS,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  tabsWrap: { paddingVertical: 6, paddingHorizontal: 16 },
  tabs: { flex: 1, flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, backgroundColor: colors.surface },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 999,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, color: '#fff' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: GLASS,
  },
  nextRow: { borderWidth: 1, borderColor: withAlpha(colors.accent, 0.5) },
  byBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  byBadgeText: { fontFamily: fonts.bold, fontSize: 10, color: '#1A1206' },
  vote: {
    alignItems: 'center',
    minWidth: 40,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface3,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 6,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: GLASS,
  },
  fieldInput: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 10 },
  welcomeBack: { backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  welcomeCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingBottom: 26,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  welcomeCat: { width: 190, height: 220, marginTop: -90 },
  searchHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingRight: 16 },
  addedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.ok, 0.14),
  },
  queuedPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  systemRow: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: GLASS,
    gap: 2,
  },
  segment: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: radius.md, backgroundColor: colors.surface3 },
  segItem: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  reactWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  reactBar: {
    flexDirection: 'row',
    gap: 2,
    padding: 6,
    borderRadius: 999,
    backgroundColor: GLASS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  emojiBtn: { width: 44, height: 46, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // Emoji glyphs are taller than text: give them room or Android clips the top.
  emoji: { fontSize: 25, lineHeight: 34, textAlign: 'center', includeFontPadding: false },
  burstEmoji: { fontSize: 36, lineHeight: 48, textAlign: 'center', includeFontPadding: false },
  burst: { position: 'absolute', alignItems: 'center', gap: 2 },
  burstTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, maxWidth: 90 },
  burstName: { fontFamily: fonts.bold, fontSize: 10, color: '#1A1206' },
});
