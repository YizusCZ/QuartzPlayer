import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type RouteKind =
  'wired' | 'bluetooth' | 'ble' | 'usb' | 'hdmi' | 'airplay' | 'car' | 'speaker' | 'hearing' | 'other';

export type AudioRoute = {
  kind: RouteKind;
  name: string | null;
  /** Mixer / hardware output rate, Hz. */
  sampleRate: number | null;
  supportedRates: number[];
  encodings: string[];
  channels: number | null;
  /** Bluetooth only, when the OS exposes it. */
  codec: string | null;
  codecSampleRate: number | null;
  codecBitDepth: number | null;
  needsPermission: boolean;
};

type Native = {
  getCurrent(): AudioRoute;
  refresh(): AudioRoute;
  scheduleSleep?(ms: number): void;
  cancelSleep?(): void;
  addListener(event: 'onChange', cb: (r: AudioRoute) => void): EventSubscription;
};

// Optional so the JS keeps working in builds that predate the module.
const native = requireOptionalNativeModule<Native>('AudioRoute');

export const AudioRouteModule = {
  available: !!native,
  getCurrent: (): AudioRoute | null => native?.getCurrent() ?? null,
  refresh: (): AudioRoute | null => native?.refresh() ?? null,
  /** Android: pauses the active media session after `ms`, even with the screen off. */
  scheduleSleep: (ms: number) => native?.scheduleSleep?.(ms),
  cancelSleep: () => native?.cancelSleep?.(),
  addListener: (cb: (r: AudioRoute) => void): EventSubscription | null => native?.addListener('onChange', cb) ?? null,
};
