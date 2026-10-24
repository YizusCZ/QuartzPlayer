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
