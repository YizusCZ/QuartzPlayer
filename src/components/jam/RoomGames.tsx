/**
 * Room games on screen (src/jam/games.ts): the game picker in the room's
 * "Juegos" tab, and the game itself, which takes over the room while it lasts.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { makeImageFromView } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Artwork } from '@/components/ui/Artwork';
import { Gem } from '@/components/ui/Gem';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Sheet, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { customCategory, GAME_CATEGORIES, type GameCategory } from '@/jam/gameCategories';
import {
  CLIP_S,
  COUNTDOWN_MS,
  endGame,
  Game,
  GAME_NAMES,
  gameTimeLeft,
  GAP_MS,
  playAgain,
  startGame,
  TOP_SIZE,
  VOTE_MS,
} from '@/jam/games';
import { useGame, useJam, useJamProfile } from '@/jam/store';
import type { GameKind, GamePlayer, GameSong, GameState } from '@/jam/types';
import { useUI } from '@/store/ui';
import { colors, fonts, radius, withAlpha } from '@/theme';

const GLASS = 'rgba(20,20,22,0.78)';

const GAMES: { kind: GameKind; icon: IconName; color: string; blurb: string; how: string }[] = [
  {
    kind: 'tops',
    icon: 'podium',
    color: '#F08A24',
    blurb: 'Arma tu top 5 a ciegas',
    how: `Suenan ${TOP_SIZE} canciones, una a la vez, sin saber cuál viene. Coloca cada una en tu top para siempre. Al final todos votan el mejor top.`,
  },
  {
    kind: 'guess',
    icon: 'help-circle',
    color: '#4FB3E8',
    blurb: '10 rondas, 3 opciones',
    how: 'Escucha un fragmento y elige la canción correcta entre tres. Gana quien más acierte; los empates se definen con rondas extra.',
  },
];

/* ───────── picker (the "Juegos" tab) ───────── */

export function GamesTab() {
  const isHost = useJam((s) => s.isHost);
  const hostName = useJam((s) => s.room?.hostName);
  const people = useJam((s) => s.members.filter((m) => !m.away).length);
  const [pick, setPick] = useState<GameKind | null>(null);

  return (
    <ScrollView contentContainerStyle={styles.tab} keyboardShouldPersistTaps="handled">
      {GAMES.map((game) => (
        <Pressable
          key={game.kind}
          onPress={() => {
            if (!isHost) return useUI.getState().showToast(`${hostName ?? 'El anfitrión'} elige el juego`);
            tap('select');
            setPick(game.kind);
          }}
          style={({ pressed }) => [styles.gameCard, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={`Jugar ${GAME_NAMES[game.kind]}`}
        >
          <View style={[styles.gameIcon, { backgroundColor: withAlpha(game.color, 0.16) }]}>
            <Icon name={game.icon} size={30} color={game.color} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={styles.row}>
              <Txt variant="heading" style={{ flex: 1 }}>
                {GAME_NAMES[game.kind]}
              </Txt>
              <Txt variant="label" style={{ color: game.color }}>
                {game.blurb.toUpperCase()}
              </Txt>
            </View>
            <Txt variant="caption">{game.how}</Txt>
          </View>
        </Pressable>
      ))}
      <View style={styles.note}>
        <Icon name={isHost ? 'account-group' : 'crown'} size={16} color={colors.textDim} />
        <Txt variant="caption" style={{ flex: 1 }}>
          {isHost
            ? `Juegan las ${people} ${people === 1 ? 'persona' : 'personas'} de la sala. La música de la sala se pausa y vuelve al terminar.`
            : `${hostName ?? 'El anfitrión'} inicia los juegos; tú solo espera y juega.`}
        </Txt>
      </View>
      <CategorySheet kind={pick} onClose={() => setPick(null)} />
    </ScrollView>
  );
}

function CategorySheet({ kind, onClose }: { kind: GameKind | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const start = (cat: GameCategory) => {
    if (!kind) return;
    tap('medium');
    onClose();
    setText('');
    void startGame(kind, cat);
  };
  return (
    <Sheet visible={!!kind} onClose={onClose}>
      <SheetTitle sub="Las canciones salen de listas públicas de YouTube Music">
        {kind ? `${GAME_NAMES[kind]} · elige la categoría` : ''}
      </SheetTitle>
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={styles.cats} keyboardShouldPersistTaps="handled">
        <View style={styles.custom}>
          <Icon name="pencil" size={18} color={colors.textDim} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Otra: un artista, género o época"
            placeholderTextColor={colors.textMute}
            style={styles.customInput}
            returnKeyType="go"
            onSubmitEditing={() => text.trim() && start(customCategory(text.trim()))}
          />
          {text.trim() ? (
            <Pressable
              onPress={() => start(customCategory(text.trim()))}
              style={[styles.go, { backgroundColor: colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel="Empezar"
            >
              <Icon name="play" size={18} color={colors.onAccent} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.catGrid}>
          {GAME_CATEGORIES.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => start(c)}
              style={({ pressed }) => [styles.cat, pressed && { backgroundColor: colors.surface3 }]}
              accessibilityRole="button"
            >
              <Icon name={c.icon} size={22} color={c.color} />
              <Txt variant="bodyStrong" numberOfLines={2} style={styles.catName}>
                {c.name}
              </Txt>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

/* ───────── shared bits ───────── */

/** Re-renders a few times a second while a deadline runs. */
function useTimeLeft(st: GameState) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!st.endsAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [st.endsAt]);
  return gameTimeLeft(st);
}

function TimeBar({ st, color = colors.accent }: { st: GameState; color?: string }) {
  const left = useTimeLeft(st);
  const total =
    st.phase === 'playing'
      ? st.startedAt
        ? st.endsAt - st.startedAt
        : CLIP_S * 1000
      : st.phase === 'reveal'
        ? GAP_MS
        : st.phase === 'voting'
          ? VOTE_MS
          : COUNTDOWN_MS;
  const frac = left == null ? 1 : Math.max(0, Math.min(1, left / total));
  return (
    <View style={styles.timeRow}>
      <View style={styles.timeTrack}>
        <View style={[styles.timeFill, { width: `${frac * 100}%`, backgroundColor: color }]} />
      </View>
      <Txt variant="mono" style={{ width: 28, textAlign: 'right' }}>
        {left == null ? '…' : Math.ceil(left / 1000)}
      </Txt>
    </View>
  );
}

const playerOf = (st: GameState, id: string): GamePlayer | undefined => st.players.find((p) => p.id === id);

function Chip({ player, dim }: { player: GamePlayer; dim?: boolean }) {
  return (
    <View style={[styles.chip, dim && { opacity: 0.4 }]}>
      <Gem color={player.color} size={14} />
      <Txt variant="caption" numberOfLines={1} style={{ fontSize: 12, color: colors.text, maxWidth: 110 }}>
        {player.name}
      </Txt>
    </View>
  );
}

/* ───────── the game ───────── */

export function GameStage() {
  const st = useGame((s) => s.game);
  const isHost = useJam((s) => s.isHost);
  const [confirm, setConfirm] = useState(false);
  if (!st) return null;

  const stage =
    st.phase === 'loading'
      ? 'Preparando'
      : st.phase === 'voting'
        ? 'Votación'
        : st.phase === 'results'
          ? 'Resultados'
          : st.tiebreak
            ? `Desempate · ronda ${st.round}`
            : `Ronda ${Math.max(1, st.round)} de ${st.rounds}`;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.gameHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="label" style={{ color: colors.accent }}>
            {GAME_NAMES[st.kind].toUpperCase()} · {st.category.toUpperCase()}
          </Txt>
          <Txt variant="title" numberOfLines={1}>
            {stage}
          </Txt>
        </View>
        {isHost && st.phase !== 'results' ? (
          <Pressable
            onPress={() => setConfirm(true)}
            style={styles.endBtn}
            accessibilityRole="button"
            accessibilityLabel="Terminar el juego"
          >
            <Icon name="close" size={18} color={colors.text} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        {st.phase === 'loading' ? (
          <Center>
            <ActivityIndicator color={colors.accent} size="large" />
            <Txt variant="heading">Buscando canciones de {st.category}…</Txt>
            <Txt variant="caption">Un momento, se eligen al azar.</Txt>
          </Center>
        ) : st.phase === 'countdown' ? (
          <Countdown st={st} />
        ) : st.phase === 'results' ? (
          <Results st={st} />
        ) : st.kind === 'tops' ? (
          st.phase === 'voting' ? (
            <Voting st={st} />
          ) : (
            <TopsRound st={st} />
          )
        ) : (
          <GuessRound st={st} />
        )}
      </View>

      <Sheet visible={confirm} onClose={() => setConfirm(false)}>
        <SheetTitle sub="Se pierde la partida para todos y vuelve la música de la sala">¿Terminar el juego?</SheetTitle>
        <View style={styles.confirm}>
          <Pressable onPress={() => setConfirm(false)} style={[styles.btn, styles.btnGhost]} accessibilityRole="button">
            <Txt variant="bodyStrong">Seguir jugando</Txt>
          </Pressable>
          <Pressable
            onPress={() => (setConfirm(false), endGame())}
            style={[styles.btn, { backgroundColor: colors.danger }]}
            accessibilityRole="button"
          >
            <Txt variant="bodyStrong" style={{ color: '#fff' }}>
              Terminar
            </Txt>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

function Countdown({ st }: { st: GameState }) {
  const left = useTimeLeft(st) ?? 0;
  return (
    <Center>
      <Txt variant="caption">Prepárense…</Txt>
      <Txt style={styles.bigNumber}>{Math.max(1, Math.ceil(left / 1000))}</Txt>
      <Txt variant="caption" style={{ textAlign: 'center', paddingHorizontal: 32 }}>
        {st.kind === 'tops'
          ? `Coloca cada canción en tu top ${TOP_SIZE}. No podrás moverla después.`
          : 'Elige la canción correcta antes de que acabe el fragmento.'}
      </Txt>
    </Center>
  );
}

/* ───────── Tops ───────── */

function TopsRound({ st }: { st: GameState }) {
  const myId = useJamProfile((s) => s.id);
  const playing = st.phase === 'playing';
  const song = st.song;
  const playingMe = st.players.some((p) => p.id === myId);
  const [optimistic, setOptimistic] = useState<{ round: number; slot: number } | null>(null);
  const top = [...(st.tops?.[myId] ?? Array<GameSong | null>(TOP_SIZE).fill(null))];
  if (song && optimistic?.round === st.round && !top[optimistic.slot] && !top.some((x) => x?.id === song.id))
    top[optimistic.slot] = song;
  const placed = !!song && top.some((x) => x?.id === song.id);
  const canPlace = playing && playingMe && !placed && !!song;

  return (
    <ScrollView contentContainerStyle={styles.stageBody}>
      <View style={styles.card}>
        {song ? (
          <View style={styles.songRow}>
            <Artwork uri={song.artwork} seed={song.title} size={72} radius={12} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt variant="label">SUENA AHORA</Txt>
              <Txt variant="heading" numberOfLines={2}>
                {song.title}
              </Txt>
              <Txt variant="caption" numberOfLines={1}>
                {song.artist}
              </Txt>
            </View>
          </View>
        ) : (
          <View style={styles.songRow}>
            <ActivityIndicator color={colors.accent} />
            <Txt variant="caption">Cargando la canción…</Txt>
          </View>
        )}
        <TimeBar st={st} />
        <Txt variant="caption" style={{ color: canPlace ? colors.accent : colors.textDim }}>
          {!playingMe
            ? 'Estás viendo: entras en la próxima partida.'
            : st.phase === 'reveal'
              ? 'Siguiente canción en un momento…'
              : canPlace
                ? 'Toca un lugar libre para colocarla.'
                : 'Colocada. Escucha mientras los demás eligen.'}
        </Txt>
      </View>

      {playingMe ? (
        <View style={styles.card}>
          <Txt variant="label">TU TOP {TOP_SIZE}</Txt>
          {top.map((x, i) => {
            const free = !x;
            const isNow = !!x && x.id === song?.id;
            return (
              <Pressable
                key={i}
                disabled={!canPlace || !free}
                onPress={() => {
                  tap('medium');
                  setOptimistic({ round: st.round, slot: i });
                  Game.place(i);
                }}
                style={[
                  styles.slot,
                  canPlace && free && { borderColor: withAlpha(colors.accent, 0.6), borderStyle: 'dashed' },
                  isNow && { backgroundColor: withAlpha(colors.accent, 0.14) },
                ]}
                accessibilityRole="button"
                accessibilityLabel={x ? `Lugar ${i + 1}: ${x.title}` : `Colocar en el lugar ${i + 1}`}
              >
                <Txt style={[styles.rank, isNow && { color: colors.accent }]}>{i + 1}</Txt>
                {x ? (
                  <>
                    <Artwork uri={x.artwork} seed={x.title} size={40} radius={8} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {x.title}
                      </Txt>
                      <Txt variant="caption" numberOfLines={1}>
                        {x.artist}
                      </Txt>
                    </View>
                  </>
                ) : (
                  <Txt variant="caption" style={{ flex: 1, color: canPlace ? colors.accent : colors.textMute }}>
                    {canPlace ? 'Colocar aquí' : 'Libre'}
                  </Txt>
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {st.phase === 'reveal' && song ? <WherePlaced st={st} song={song} /> : <Waiting st={st} />}
    </ScrollView>
  );
}

/** After each song: the place everyone gave it. */
function WherePlaced({ st, song }: { st: GameState; song: GameSong }) {
  return (
    <View style={styles.card}>
      <Txt variant="label">ASÍ LA COLOCARON</Txt>
      <View style={styles.chips}>
        {st.players.map((p) => {
          const place = (st.tops?.[p.id] ?? []).findIndex((x) => x?.id === song.id);
          return (
            <View key={p.id} style={styles.placeChip}>
              <Chip player={p} />
              <Txt style={[styles.rankSmall, { color: p.color }]}>{place >= 0 ? `#${place + 1}` : '—'}</Txt>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Who already chose this round. */
function Waiting({ st }: { st: GameState }) {
  const players = st.tiebreak ? st.players.filter((p) => st.tiebreak?.includes(p.id)) : st.players;
  if (players.length < 2) return null;
  return (
    <View style={styles.card}>
      <Txt variant="label">
        {st.done.length}/{players.length} YA {st.kind === 'tops' ? 'COLOCARON' : 'RESPONDIERON'}
      </Txt>
      <View style={styles.chips}>
        {players.map((p) => (
          <Chip key={p.id} player={p} dim={!st.done.includes(p.id)} />
        ))}
      </View>
    </View>
  );
}

function Voting({ st }: { st: GameState }) {
  const myId = useJamProfile((s) => s.id);
  const mine = st.votes?.[myId];
  const voted = Object.keys(st.votes ?? {}).length;
  return (
    <ScrollView contentContainerStyle={styles.stageBody}>
      <View style={styles.card}>
        <Txt variant="heading">¿Quién armó el mejor top?</Txt>
        <Txt variant="caption">
          Vota por un top que no sea el tuyo · {voted}/{st.players.length} votos
        </Txt>
        <TimeBar st={st} />
      </View>
      {st.players.map((p) => (
        <View key={p.id} style={[styles.card, mine === p.id && { borderColor: colors.accent, borderWidth: 1.5 }]}>
          <View style={styles.row}>
            <Chip player={p} />
            <View style={{ flex: 1 }} />
            {p.id === myId ? (
              <Txt variant="caption">Tu top</Txt>
            ) : (
              <Pressable
                onPress={() => (tap('medium'), Game.vote(p.id))}
                style={[styles.voteBtn, mine === p.id && { backgroundColor: colors.accent }]}
                accessibilityRole="button"
                accessibilityLabel={`Votar por el top de ${p.name}`}
              >
                <Icon name="vote" size={16} color={mine === p.id ? colors.onAccent : colors.text} />
                <Txt
                  variant="bodyStrong"
                  style={{ fontSize: 13, color: mine === p.id ? colors.onAccent : colors.text }}
                >
                  {mine === p.id ? 'Tu voto' : 'Votar'}
                </Txt>
              </Pressable>
            )}
          </View>
          <TopList top={st.tops?.[p.id] ?? []} />
        </View>
      ))}
    </ScrollView>
  );
}

function TopList({ top, compact }: { top: (GameSong | null)[]; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? 6 : 8 }}>
      {Array.from({ length: TOP_SIZE }, (_, i) => top[i] ?? null).map((x, i) => (
        <View key={i} style={styles.topRow}>
          <Txt style={styles.rankSmall}>{i + 1}</Txt>
          <Artwork uri={x?.artwork} seed={x?.title ?? String(i)} size={compact ? 34 : 38} radius={7} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
              {x?.title ?? '—'}
            </Txt>
            <Txt variant="caption" numberOfLines={1} style={{ fontSize: 12 }}>
              {x?.artist ?? ''}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

/* ───────── Guess the song ───────── */

function GuessRound({ st }: { st: GameState }) {
  const myId = useJamProfile((s) => s.id);
  const [mine, setMine] = useState<{ round: number; option: number } | null>(null);
  const reveal = st.phase === 'reveal';
  const answersMe = (st.tiebreak ?? st.players.map((p) => p.id)).includes(myId);
  const picked = reveal ? st.picks?.[myId] : mine?.round === st.round ? mine.option : undefined;
  const answered = picked !== undefined || st.done.includes(myId);
  const song = reveal ? st.song : null;
  const right = reveal && picked !== undefined && picked === st.answer;

  return (
    <ScrollView contentContainerStyle={styles.stageBody}>
      <View style={[styles.card, styles.mystery]}>
        {song ? (
          <Artwork uri={song.artwork} seed={song.title} size={112} radius={18} />
        ) : (
          <View style={styles.disc}>
            <Icon name="music-circle" size={64} color={colors.accent} />
            <Txt style={styles.discMark}>?</Txt>
          </View>
        )}
        <Txt variant="heading" style={{ textAlign: 'center' }}>
          {reveal
            ? !answersMe
              ? 'Era esta'
              : picked === undefined
                ? 'Se acabó el tiempo'
                : right
                  ? '¡Correcto! +1'
                  : 'Casi… era otra'
            : !answersMe
              ? st.tiebreak
                ? 'Desempate: solo responden los empatados'
                : 'Estás viendo esta partida'
              : answered
                ? 'Respuesta enviada'
                : '¿Qué canción es?'}
        </Txt>
        <TimeBar st={st} color={reveal ? (right ? colors.ok : colors.textDim) : colors.accent} />
      </View>

      <View style={{ gap: 10 }}>
        {(st.options ?? []).map((o, i) => {
          const isAnswer = reveal && st.answer === i;
          const isMine = picked === i;
          const who = reveal ? st.players.filter((p) => st.picks?.[p.id] === i) : [];
          return (
            <Pressable
              key={i}
              disabled={reveal || answered || !answersMe}
              onPress={() => {
                tap('medium');
                setMine({ round: st.round, option: i });
                Game.answer(i);
              }}
              style={[
                styles.option,
                isMine && !reveal && { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.14) },
                isAnswer && { borderColor: colors.ok, backgroundColor: withAlpha(colors.ok, 0.18) },
                reveal &&
                  isMine &&
                  !isAnswer && { borderColor: colors.danger, backgroundColor: withAlpha(colors.danger, 0.14) },
                reveal && !isAnswer && !isMine && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${o.title} de ${o.artist}`}
            >
              <View style={[styles.letter, isAnswer && { backgroundColor: colors.ok }]}>
                <Txt style={[styles.letterText, isAnswer && { color: '#fff' }]}>{'ABC'[i]}</Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="bodyStrong" numberOfLines={2}>
                  {o.title}
                </Txt>
                <Txt variant="caption" numberOfLines={1}>
                  {o.artist}
                </Txt>
                {who.length ? (
                  <View style={[styles.chips, { marginTop: 6 }]}>
                    {who.map((p) => (
                      <Gem key={p.id} color={p.color} size={14} />
                    ))}
                  </View>
                ) : null}
              </View>
              {isAnswer ? <Icon name="check-circle" size={22} color={colors.ok} /> : null}
            </Pressable>
          );
        })}
      </View>

      {reveal ? null : <Waiting st={st} />}
      <Scoreboard st={st} />
    </ScrollView>
  );
}

function ranking(st: GameState) {
  return [...st.players].sort(
    (a, b) =>
      (st.scores?.[b.id] ?? 0) - (st.scores?.[a.id] ?? 0) ||
      (st.times?.[a.id] ?? Infinity) - (st.times?.[b.id] ?? Infinity),
  );
}

function Scoreboard({ st, big }: { st: GameState; big?: boolean }) {
  const myId = useJamProfile((s) => s.id);
  if (st.players.length < 2 && !big) return null;
  return (
    <View style={styles.card}>
      <Txt variant="label">MARCADOR</Txt>
      {ranking(st).map((p, i) => {
        const win = st.winners?.includes(p.id);
        return (
          <View key={p.id} style={styles.scoreRow}>
            <Txt style={[styles.rankSmall, win && { color: colors.hires }]}>{i + 1}</Txt>
            <Gem color={p.color} size={big ? 22 : 16} />
            <Txt
              variant={big ? 'heading' : 'bodyStrong'}
              numberOfLines={1}
              style={[{ flex: 1 }, p.id === myId && { color: colors.accent }]}
            >
              {p.name}
            </Txt>
            {win ? <Icon name="crown" size={18} color={colors.hires} /> : null}
            <Txt variant="mono" style={{ fontSize: big ? 16 : 13, color: colors.text }}>
              {st.scores?.[p.id] ?? 0}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

/* ───────── results ───────── */

function Results({ st }: { st: GameState }) {
  const isHost = useJam((s) => s.isHost);
  const hostName = useJam((s) => s.room?.hostName);
  const myId = useJamProfile((s) => s.id);
  const winners = (st.winners ?? []).map((id) => playerOf(st, id)).filter((p): p is GamePlayer => !!p);
  const iWon = st.winners?.includes(myId);
  const votesFor = (id: string) => Object.values(st.votes ?? {}).filter((v) => v === id).length;
  const [shown, setShown] = useState(
    st.players.some((p) => p.id === myId) ? myId : (st.winners?.[0] ?? st.players[0]?.id),
  );

  return (
    <ScrollView contentContainerStyle={styles.stageBody}>
      <View style={[styles.card, { alignItems: 'center' }]}>
        <Icon name="trophy" size={44} color={colors.hires} />
        <Txt variant="title" style={{ textAlign: 'center' }}>
          {iWon
            ? '¡Ganaste!'
            : winners.length
              ? `${winners.map((w) => w.name).join(' y ')} ${winners.length > 1 ? 'ganaron' : 'ganó'}`
              : 'Terminó el juego'}
        </Txt>
        <Txt variant="caption" style={{ textAlign: 'center' }}>
          {st.kind === 'tops'
            ? winners.length
              ? `El mejor top según la sala · ${votesFor(winners[0].id)} ${votesFor(winners[0].id) === 1 ? 'voto' : 'votos'}`
              : st.players.length < 2
                ? 'Este es tu top'
                : 'Nadie votó esta vez'
            : `${st.category} · ${st.rounds} rondas`}
        </Txt>
      </View>

      {st.kind === 'guess' ? (
        <Scoreboard st={st} big />
      ) : (
        <>
          {st.players.length > 1 ? (
            <View style={styles.chips}>
              {st.players.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setShown(p.id)}
                  style={[styles.tabChip, shown === p.id && { backgroundColor: colors.surface3, borderColor: p.color }]}
                  accessibilityRole="tab"
                >
                  <Gem color={p.color} size={14} />
                  <Txt variant="caption" style={{ color: colors.text }}>
                    {p.id === myId ? 'Tú' : p.name} · {votesFor(p.id)}
                  </Txt>
                </Pressable>
              ))}
            </View>
          ) : null}
          {shown ? <ShareableTop st={st} playerId={shown} won={!!st.winners?.includes(shown)} /> : null}
        </>
      )}

      {isHost ? (
        <View style={styles.confirm}>
          <Pressable onPress={endGame} style={[styles.btn, styles.btnGhost]} accessibilityRole="button">
            <Txt variant="bodyStrong">Volver a la música</Txt>
          </Pressable>
          <Pressable
            onPress={() => (tap('medium'), playAgain())}
            style={[styles.btn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
          >
            <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
              Otra partida
            </Txt>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={() => useGame.setState({ game: null })}
            style={[styles.btn, styles.btnGhost, { flex: 0 }]}
            accessibilityRole="button"
          >
            <Txt variant="bodyStrong">Volver a la sala</Txt>
          </Pressable>
          <Txt variant="caption" style={{ textAlign: 'center' }}>
            {hostName ?? 'El anfitrión'} decide si juegan otra.
          </Txt>
        </View>
      )}
    </ScrollView>
  );
}

/** A top as a card, and its "share as image" button. */
function ShareableTop({ st, playerId, won }: { st: GameState; playerId: string; won: boolean }) {
  const ref = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const player = playerOf(st, playerId);
  if (!player) return null;

  const share = async () => {
    setBusy(true);
    try {
      const image = await makeImageFromView(ref);
      if (!image) throw new Error('sin imagen');
      const file = new File(Paths.cache, `quartz-top-${Date.now().toString(36)}.png`);
      file.write(image.encodeToBytes());
      await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: 'Compartir top' });
    } catch {
      useUI.getState().showToast('No se pudo crear la imagen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View ref={ref} collapsable={false} style={styles.shareCard}>
        <View style={[styles.shareGlow, { backgroundColor: withAlpha(player.color, 0.22) }]} />
        <View style={styles.row}>
          <Gem color={player.color} size={30} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="label" style={{ color: player.color }}>
              TOP {TOP_SIZE} · {st.category.toUpperCase()}
            </Txt>
            <Txt variant="title" numberOfLines={1}>
              {player.name}
            </Txt>
          </View>
          {won ? <Icon name="crown" size={26} color={colors.hires} /> : null}
        </View>
        <TopList top={st.tops?.[playerId] ?? []} />
        <View style={styles.shareFoot}>
          <Txt style={styles.brand}>QUARTZ</Txt>
          <Txt variant="caption" style={{ fontSize: 12 }}>
            {won ? 'El mejor top de la sala' : 'Tops a ciegas en una sala de Quartz'}
          </Txt>
        </View>
      </View>
      <Pressable
        onPress={share}
        disabled={busy}
        style={[styles.btn, styles.btnGhost, { flexDirection: 'row', gap: 8 }]}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <Icon name="share-variant" size={18} color={colors.text} />
        )}
        <Txt variant="bodyStrong">Compartir como imagen</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { padding: 16, gap: 12, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gameCard: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: GLASS,
  },
  gameIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, alignItems: 'flex-start' },
  cats: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  custom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 4,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: colors.surface2,
  },
  customInput: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 8 },
  go: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  cat: {
    width: '32%',
    minHeight: 84,
    padding: 10,
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    justifyContent: 'center',
  },
  catName: { fontSize: 13, lineHeight: 16 },
  gameHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 },
  endBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60 },
  bigNumber: { fontFamily: fonts.bold, fontSize: 120, lineHeight: 130, color: colors.accent },
  stageBody: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: { padding: 16, gap: 12, borderRadius: radius.lg, backgroundColor: GLASS },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: 'hidden' },
  timeFill: { height: 6, borderRadius: 3 },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
  },
  rank: { width: 26, fontFamily: fonts.condensedBold, fontSize: 26, color: colors.textDim, textAlign: 'center' },
  rankSmall: { width: 22, fontFamily: fonts.condensedBold, fontSize: 18, color: colors.textDim, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.surface2,
  },
  placeChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface3,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mystery: { alignItems: 'center' },
  disc: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  discMark: { position: 'absolute', fontFamily: fonts.bold, fontSize: 30, color: colors.bg },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: GLASS,
  },
  letter: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
  },
  letterText: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirm: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  btn: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: colors.surface2 },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
  },
  shareCard: {
    padding: 20,
    gap: 16,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  shareGlow: { position: 'absolute', top: -80, right: -60, width: 240, height: 240, borderRadius: 120 },
  shareFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  brand: { fontFamily: fonts.brand, fontSize: 13, letterSpacing: 2, color: colors.text },
});
