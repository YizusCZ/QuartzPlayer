import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type DiscordPresence = {
  /** Activity name: "Escuchando <name>". */
  name?: string;
  /** First line, e.g. the song title. */
  details?: string;
  /** Second line, e.g. the artist. */
  state?: string;
  /** Image URL or an asset key uploaded in the Developer Portal. */
  largeImage?: string;
  largeText?: string;
  /** Badge drawn over the large image. */
  smallImage?: string;
  smallText?: string;
  /** Unix epoch, ms. Start + end draw a progress bar. */
  startMs?: number;
  endMs?: number;
  /** A link button others see under your status (Discord allows two). */
  buttonLabel?: string;
  buttonUrl?: string;
};

export type DiscordResult = { ok: boolean; message: string };

type Native = {
  isDiscordInstalled(): boolean;
  start(applicationId: string): void;
  update(presence: DiscordPresence): void;
  clear(): void;
  stop(): void;
  addListener(event: 'onResult', cb: (r: DiscordResult) => void): EventSubscription;
};

// Optional: Android only, and absent from builds that predate the module.
const native = requireOptionalNativeModule<Native>('DiscordPresence');

export const DiscordPresenceModule = {
  available: !!native,
  isDiscordInstalled: (): boolean => native?.isDiscordInstalled() ?? false,
  start: (applicationId: string) => native?.start(applicationId),
  update: (presence: DiscordPresence) => native?.update(presence),
  clear: () => native?.clear(),
  stop: () => native?.stop(),
  addListener: (cb: (r: DiscordResult) => void): EventSubscription | null =>
    native?.addListener('onResult', cb) ?? null,
};
