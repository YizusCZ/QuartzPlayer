/**
 * Live audio output route (headphones, AirPods, Bluetooth, USB DAC, speaker).
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import { AudioRouteModule, type AudioRoute } from '../../modules/audio-route';
import type { IconName } from '@/components/ui/Icon';
import { khz } from '@/library/types';

export type { AudioRoute };

export const useAudioRoute = create<{ route: AudioRoute | null }>()(() => ({ route: null }));

let started = false;
let askedBt = false;

async function maybeAskBluetooth(r: AudioRoute) {
  if (Platform.OS !== 'android' || !r.needsPermission || askedBt) return;
  askedBt = true;
  try {
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, {
      title: 'Detalles de tus audífonos',
      message: 'Quartz puede mostrar el códec y la frecuencia de tus audífonos Bluetooth.',
      buttonPositive: 'Permitir',
      buttonNegative: 'Ahora no',
    });
    if (res === PermissionsAndroid.RESULTS.GRANTED) {
      const fresh = AudioRouteModule.refresh();
      if (fresh) useAudioRoute.setState({ route: fresh });
    }
  } catch {
    // ignore
  }
}

export function startAudioRoute() {
  if (started || !AudioRouteModule.available) return;
  started = true;
  const update = (r: AudioRoute | null) => {
    if (!r) return;
    useAudioRoute.setState({ route: r });
    void maybeAskBluetooth(r);
  };
  AudioRouteModule.addListener(update);
  update(AudioRouteModule.getCurrent());
}

const EARBUDS = /airpods(?! max)|buds|pods|earbud|tws|wf-|free ?buds|in-?ear|nothing ear|pixel buds/i;
const OVER_EAR = /airpods max|wh-|headphone|momentum|bose|quietcomfort|studio/i;

export function routeIcon(r: AudioRoute | null): IconName {
  if (!r) return 'cellphone-sound';
  const name = r.name ?? '';
  switch (r.kind) {
    case 'bluetooth':
    case 'ble':
      if (EARBUDS.test(name)) return 'earbuds';
      if (OVER_EAR.test(name)) return 'headphones-bluetooth';
      return /speaker|bocina|jbl|soundlink|boom/i.test(name) ? 'speaker-wireless' : 'headphones-bluetooth';
    case 'wired':
      return 'headphones';
    case 'usb':
      return 'usb-port';
    case 'airplay':
      return 'cast-audio';
    case 'hdmi':
      return 'television';
    case 'car':
      return 'car';
    case 'hearing':
      return 'ear-hearing';
    default:
      return 'cellphone-sound';
  }
}

export function routeKindLabel(r: AudioRoute): string {
  switch (r.kind) {
    case 'wired':
      return 'Audífonos con cable';
    case 'bluetooth':
      return 'Bluetooth';
    case 'ble':
      return 'Bluetooth LE Audio';
    case 'usb':
      return 'DAC / audífonos USB';
    case 'airplay':
      return 'AirPlay';
    case 'hdmi':
      return 'HDMI';
    case 'car':
      return 'Auto';
    case 'hearing':
      return 'Audífono auditivo';
    case 'speaker':
      return 'Altavoz del teléfono';
    default:
      return 'Salida de audio';
  }
}

export function routeName(r: AudioRoute): string {
  return r.name?.trim() || routeKindLabel(r);
}

/** e.g. "AAC · 44.1 kHz" or "24-bit · 96 kHz". */
export function routeFormat(r: AudioRoute): string {
  const parts: string[] = [];
  if (r.codec) parts.push(r.codec);
  if (r.codecBitDepth) parts.push(`${r.codecBitDepth}-bit`);
  const rate = r.codecSampleRate ?? r.sampleRate;
  if (rate) parts.push(khz(rate));
  return parts.join(' · ');
}
