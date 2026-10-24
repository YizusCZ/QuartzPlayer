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
  showOutputSwitcher?(): boolean;
  setKeepAlive?(on: boolean): boolean;
  addListener(event: 'onChange', cb: (r: AudioRoute) => void): EventSubscription;
};

// Optional so the JS keeps working in builds that predate the module.
const native = requireOptionalNativeModule<Native>('AudioRoute');

/** Who needs JS timers alive in the background (a room, Discord): held while any does. */
const keepAliveHolders = new Set<string>();

export const AudioRouteModule = {
  available: !!native,
  getCurrent: (): AudioRoute | null => native?.getCurrent() ?? null,
  refresh: (): AudioRoute | null => native?.refresh() ?? null,
  /** Android: pauses the active media session after `ms`, even with the screen off. */
  scheduleSleep: (ms: number) => native?.scheduleSleep?.(ms),
  cancelSleep: () => native?.cancelSleep?.(),
  /** Android: keeps JS timers alive in the background while any `holder` asks for it. */
  keepAlive: (holder: string, on: boolean) => {
    const had = keepAliveHolders.size > 0;
    if (on) keepAliveHolders.add(holder);
    else keepAliveHolders.delete(holder);
    const has = keepAliveHolders.size > 0;
    if (has !== had) native?.setKeepAlive?.(has);
  },
  /** Android: the system "play on" panel to switch speaker / headphones / Bluetooth. */
  showOutputSwitcher: (): boolean => native?.showOutputSwitcher?.() ?? false,
  addListener: (cb: (r: AudioRoute) => void): EventSubscription | null => native?.addListener('onChange', cb) ?? null,
};
