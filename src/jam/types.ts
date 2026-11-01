/** What travels between phones in a room. Only YouTube songs: nobody's files leave their phone. */

export type RoomTrack = {
  id: string; // "yt:<videoId>"
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  duration: number;
  video?: boolean;
  /** Who added it. */
  by: string;
  byColor: string;
  /** Member ids that want it sooner. */
  votes: string[];
};

export type RoomMode = 'dj' | 'all';

/**
 * Where the host's music is, on the host's clock. Sent every second and on
 * every play, pause, seek or song change: small, so it can be sent often.
 */
export type Clock = {
  /** Song playing (its id) and its place in the queue. */
  id: string | null;
  index: number;
  /** Moving forward right now (playing and not buffering). */
  playing: boolean;
  /** The host is waiting on the network: guests hold their corrections. */
  buffering: boolean;
  /** Position (s) at `at`, a timestamp on the host's clock (ms). */
  pos: number;
  at: number;
};

/** The room itself: queue, settings, skip votes. Sent when it changes (and to newcomers). */
export type RoomState = {
  v: number;
  hostId: string;
  /** For the guests' welcome ("Bienvenido a la sala de …"). */
  hostName: string;
  mode: RoomMode;
  /** When the queue runs out, YouTube Music's radio for the last song keeps it going. */
  radio: boolean;
  /** Fair turns: upcoming songs alternate between the people who added them. */
  fair: boolean;
  queue: RoomTrack[];
  index: number;
  /** Members asking to skip the current song. */
  skip: string[];
  /** A game is on (src/jam/games.ts). */
  gameOn?: boolean;
  clock: Clock;
};

export type Member = {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  host: boolean;
  /** Lost connection a moment ago (app in the background, network change): kept for a grace period. */
  away?: boolean;
};

export type Command =
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; to: number }
  | { type: 'jump'; index: number }
  | { type: 'add'; track: RoomTrack; next?: boolean }
  | { type: 'vote'; id: string }
  | { type: 'skip' }
  | { type: 'remove'; index: number };

/** Short label for who added a song, when it came from the room's radio. */
export const RADIO_BY = 'Radio de la sala';

export type ChatMessage = { id: string; from: string; name: string; color: string; text: string; at: number };

export type Reaction = { id: string; emoji: string; color: string; name: string };

/* ───────── games ───────── */

export type GameKind = 'tops' | 'guess';

/**
 *  - loading: the host is gathering the songs;
 *  - countdown: the first clip is loading on every phone;
 *  - playing: a clip plays (at most 25 s);
 *  - reveal: the 3 s between clips (the answer, or where everyone placed it);
 *  - voting: Tops only, everyone picks the best top;
 *  - results: the end.
 */
export type GamePhase = 'loading' | 'countdown' | 'playing' | 'reveal' | 'voting' | 'results';

export type GameSong = {
  id: string; // "yt:<videoId>"
  title: string;
  artist: string;
  artwork?: string;
  duration: number;
  /** Where the clip starts (s). */
  start: number;
};

export type GameOption = { title: string; artist: string };

export type GamePlayer = { id: string; name: string; color: string };

/** A game in a room, as the host runs it. Sent on every change. */
export type GameState = {
  v: number;
  id: string;
  kind: GameKind;
  categoryId: string;
  category: string;
  phase: GamePhase;
  /** Current round (1-based) and how many there are (tie-breaks add more). */
  round: number;
  rounds: number;
  /** A tie-break round: only these players answer. */
  tiebreak?: string[];
  /** When the current phase ends, on the host's clock (ms); 0 while waiting on the song. */
  endsAt: number;
  /** When the current clip started, on the host's clock (ms); 0 until it does. */
  startedAt: number;
  players: GamePlayer[];
  /** The song of this round. Guess the song: only once it is revealed. */
  song: GameSong | null;
  /** Guess the song: the three choices, and the right one once revealed. */
  options?: GameOption[];
  answer?: number;
  /** Players who already answered or placed the song this round. */
  done: string[];
  /** Guess the song: what each player chose, once revealed. */
  picks?: Record<string, number>;
  scores?: Record<string, number>;
  /** Guess the song: total time to answer right (ms), the last tie-break. */
  times?: Record<string, number>;
  /** Tops: each player's five places. */
  tops?: Record<string, (GameSong | null)[]>;
  /** Tops: voter → whose top they picked. */
  votes?: Record<string, string>;
  winners?: string[];
};

export type GameCommand =
  | { type: 'place'; round: number; slot: number }
  | { type: 'answer'; round: number; option: number; ms: number }
  | { type: 'vote'; for: string };
