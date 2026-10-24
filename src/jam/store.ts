import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/store/storage';
import type { ChatMessage, Member, Reaction, RoomState } from './types';

/** Who you are in a room: a mineral, with its own colour and cut. */
export type JamGem = { name: string; color: string; light: string; dark: string; cut: string };

export const JAM_GEMS: JamGem[] = [
  { name: 'Ámbar', color: '#F08A24', light: '#FFD39A', dark: '#9A4A06', cut: 'oval' },
  { name: 'Turmalina', color: '#F107A3', light: '#FF9AD9', dark: '#8A0060', cut: 'pear' },
  { name: 'Amatista', color: '#7B2FF7', light: '#C9A8FF', dark: '#3E0FA0', cut: 'crystal' },
  { name: 'Zafiro', color: '#4FB3E8', light: '#BDE8FF', dark: '#1B5F9E', cut: 'brilliant' },
  { name: 'Aguamarina', color: '#2EC4B6', light: '#A8F5EC', dark: '#0F6D65', cut: 'marquise' },
  { name: 'Citrino', color: '#FFBF69', light: '#FFF0C2', dark: '#B57A12', cut: 'cushion' },
  { name: 'Rubí', color: '#FF5A5F', light: '#FFB3B5', dark: '#A3121B', cut: 'trillion' },
  { name: 'Esmeralda', color: '#9BE15D', light: '#DDFBB8', dark: '#3E8A12', cut: 'emerald' },
];

export const JAM_COLORS = JAM_GEMS.map((g) => g.color);

/** The mineral for a member's colour (older or unknown colours get a stable one). */
export function gemFor(color: string): JamGem {
  const hit = JAM_GEMS.find((g) => g.color.toLowerCase() === color.toLowerCase());
  if (hit) return hit;
  let h = 0;
  for (const ch of color) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return JAM_GEMS[Math.abs(h) % JAM_GEMS.length];
}

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Who you are in rooms: kept between sessions. */
export const useJamProfile = create<{
  id: string;
  name: string;
  color: string;
  set: (p: { name?: string; color?: string }) => void;
}>()(
  persist(
    (set) => ({
      id: randomId(),
      name: `Oyente ${Math.floor(1000 + Math.random() * 9000)}`,
      color: JAM_COLORS[Math.floor(Math.random() * JAM_COLORS.length)],
      set: (p) => set(p),
    }),
    { name: 'quartz.jam', storage: persistStorage() },
  ),
);

export type JamStatus = 'idle' | 'connecting' | 'joined' | 'error';

type Jam = {
  status: JamStatus;
  error: string | null;
  code: string | null;
  isHost: boolean;
  room: RoomState | null;
  members: Member[];
  chat: ChatMessage[];
  reactions: Reaction[];
  /** Last measured gap to the host (ms, signed), for the sync badge. */
  drift: number | null;
  /** Chat messages arrived while the chat tab was closed. */
  unread: number;
  /** Host's name, shown once on the welcome card right after joining. */
  welcome: string | null;
  /** The connection dropped and is being restored (the room stays). */
  reconnecting: boolean;
  /** The YouTube song you were playing before opening the room, to share it in one tap. */
  previous: string | null;
};

export const useJam = create<Jam>()(() => ({
  status: 'idle',
  error: null,
  code: null,
  isHost: false,
  room: null,
  members: [],
  chat: [],
  reactions: [],
  drift: null,
  unread: 0,
  welcome: null,
  reconnecting: false,
  previous: null,
}));

export const inRoom = () => useJam.getState().status === 'joined';
