/**
 * Real-time analysis for the visualizers. Uses expo-audio's PCM sample tap
 * when the platform provides it (Android needs RECORD_AUDIO for its Visualizer
 * API); otherwise falls back to a clearly-flagged simulated signal.
 */
import { Platform } from 'react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, type AudioSample } from 'expo-audio';
import { makeMutable } from 'react-native-reanimated';
import { getPlayer, transport } from './engine';
import { useSettings } from '@/store/settings';
import { bandEdges, fft, hann } from './fft';

export const BANDS = 64;
export const WAVE_POINTS = 256;

export type AnalyzerMode = 'off' | 'live' | 'sim';

/** 0..1 per log band (35 Hz → 18 kHz). Visualizers resample to their own bar count. */
export const spectrum = makeMutable<number[]>(new Array(BANDS).fill(0));
/** RMS level per channel in dBFS (−90…0). */
export const levels = makeMutable<[number, number]>([-90, -90]);
/** Downsampled waveform per channel (−1…1). */
export const waveL = makeMutable<number[]>(new Array(WAVE_POINTS).fill(0));
export const waveR = makeMutable<number[]>(new Array(WAVE_POINTS).fill(0));
export const analyzerMode = makeMutable<AnalyzerMode>('off');

const ASSUMED_RATE = 48000;
const MIN_DB = -72;

let users = 0;
let sub: { remove(): void } | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let lastSample = 0;
let edgesCache: { n: number; edges: number[] } | null = null;
const smooth = new Float32Array(BANDS);

function rmsDb(frames: number[]): number {
  let sum = 0;
  for (let i = 0; i < frames.length; i++) sum += frames[i] * frames[i];
  const rms = Math.sqrt(sum / Math.max(1, frames.length));
  return Math.max(-90, 20 * Math.log10(rms + 1e-9));
}

function downsample(frames: number[]): number[] {
  const out = new Array<number>(WAVE_POINTS);
  const step = frames.length / WAVE_POINTS;
  for (let i = 0; i < WAVE_POINTS; i++) out[i] = frames[Math.floor(i * step)] ?? 0;
  return out;
}

const MIN_INTERVAL = 22; // ms — ~45 analyses per second is plenty for the eye

/**
 * Android's Visualizer delivers an auto-gain-normalised waveform, so absolute
 * RMS sits near full scale no matter how loud the music is. There we measure
 * the level relative to a slow running average (≈ 6 s), placing typical
 * programme material around −3 VU and letting dynamics swing the needle.
 * iOS taps real PCM, so its levels pass through untouched.
 */
let avgDb = -18;
const NORMALISED = Platform.OS === 'android';

function calibrate(l: number, r: number): [number, number] {
  if (!Number.isFinite(l)) l = -90;
  if (!Number.isFinite(r)) r = -90;
  if (!NORMALISED) return [l, r];
  const m = (l + r) / 2;
  if (m > -60) avgDb += (m - avgDb) * 0.018;
  const shift = -21 - avgDb; // typical level → −21 dBFS → −3 VU
  return [l + shift, r + shift];
}

function onSample(sample: AudioSample) {
  const now = Date.now();
  if (now - lastSample < MIN_INTERVAL) return;
  const l = sample.channels[0]?.frames;
  if (!l?.length) return;
  const r = sample.channels[1]?.frames ?? l;
  lastSample = now;
  const gainDb = 20 * Math.log10(useSettings.getState().sensitivity || 1);

  let n = 1;
  while (n * 2 <= Math.min(l.length, 2048)) n *= 2;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i++) re[i] = ((l[i] + r[i]) / 2) * w[i];
  fft(re, im);

  if (!edgesCache || edgesCache.n !== n) edgesCache = { n, edges: bandEdges(BANDS, n, ASSUMED_RATE) };
  const edges = edgesCache.edges;
  const out = new Array<number>(BANDS);
  for (let b = 0; b < BANDS; b++) {
    let peak = 0;
    for (let k = edges[b]; k <= Math.max(edges[b], edges[b + 1] - 1); k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (mag > peak) peak = mag;
    }
    // Normalise by window gain; tilt +3 dB/oct so music reads flat.
    const db = 20 * Math.log10((peak * 4) / n + 1e-9) + 3 * Math.log2(b / 10 + 1) + gainDb;
    const v = Math.min(1, Math.max(0, (db - MIN_DB) / -MIN_DB));
    smooth[b] = v > smooth[b] ? v : smooth[b] * 0.82 + v * 0.18;
    out[b] = smooth[b];
  }
  spectrum.value = out;
  levels.value = calibrate(rmsDb(l), rmsDb(r));
  waveL.value = downsample(l);
  waveR.value = downsample(r);
}

/* ───────── simulated signal (no permission / unsupported) ───────── */

let simT = 0;
function simulate() {
  const playing = transport.value.playing;
  simT += 0.033;
  const beat = Math.pow(Math.max(0, Math.sin(simT * Math.PI * 2 * 2)), 8); // ~120 bpm
  const out = new Array<number>(BANDS);
  for (let b = 0; b < BANDS; b++) {
    const base = 0.72 - b * 0.007 + (b < 10 ? beat * 0.25 : 0);
    const wobble = 0.12 * Math.sin(simT * (1.3 + b * 0.37) + b) + 0.08 * Math.sin(simT * 5.1 + b * 1.7);
    const v = playing ? Math.min(1, Math.max(0, base + wobble)) : 0;
    smooth[b] = v > smooth[b] ? v : smooth[b] * 0.86;
    out[b] = smooth[b];
  }
  spectrum.value = out;
  const lv = playing ? -16 + beat * 8 + 3 * Math.sin(simT * 3.1) : -90;
  levels.value = [lv, playing ? lv - 1.5 + 2 * Math.sin(simT * 2.3) : -90];
  const wl = new Array<number>(WAVE_POINTS);
  const wr = new Array<number>(WAVE_POINTS);
  for (let i = 0; i < WAVE_POINTS; i++) {
    const x = (i / WAVE_POINTS) * Math.PI * 2;
    const a = playing ? 0.35 + beat * 0.3 : 0;
    wl[i] = a * (Math.sin(x * 3 + simT * 4) * 0.7 + Math.sin(x * 11 + simT * 9) * 0.3);
    wr[i] = a * (Math.sin(x * 3 + simT * 4 + 0.9) * 0.7 + Math.sin(x * 7 - simT * 6) * 0.3);
  }
  waveL.value = wl;
  waveR.value = wr;
}

function decay() {
  if (Date.now() - lastSample < 120) return;
  const out = spectrum.value.map((v) => v * 0.82);
  spectrum.value = out;
  levels.value = [Math.max(-90, levels.value[0] - 3), Math.max(-90, levels.value[1] - 3)];
  waveL.value = waveL.value.map((v) => v * 0.7);
  waveR.value = waveR.value.map((v) => v * 0.7);
}

async function liveAllowed(): Promise<boolean> {
  const p = getPlayer();
  if (!p?.isAudioSamplingSupported) return false;
  if (Platform.OS !== 'android') return true;
  const cur = await getRecordingPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await requestRecordingPermissionsAsync()).granted;
}

/** Re-arms the PCM tap; the native player drops it when the source changes. */
export function rearmAnalyzer() {
  if (analyzerMode.value === 'live') getPlayer()?.setAudioSamplingEnabled(true);
}

export async function acquireAnalyzer(): Promise<AnalyzerMode> {
  users++;
  if (users > 1) return analyzerMode.value;
  const p = getPlayer();
  let mode: AnalyzerMode = 'sim';
  try {
    if (p && (await liveAllowed())) {
      p.setAudioSamplingEnabled(true);
      sub = p.addListener('audioSampleUpdate', onSample);
      mode = 'live';
    }
  } catch {
    mode = 'sim';
  }
  if (users === 0) {
    // Released while we were awaiting the permission prompt.
    sub?.remove();
    sub = null;
    if (mode === 'live') p?.setAudioSamplingEnabled(false);
    return 'off';
  }
  analyzerMode.value = mode;
  ticker = setInterval(mode === 'live' ? decay : simulate, 33);
  return mode;
}

export function releaseAnalyzer() {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  sub?.remove();
  sub = null;
  if (ticker) clearInterval(ticker);
  ticker = null;
  try {
    getPlayer()?.setAudioSamplingEnabled(false);
  } catch {
    // player already released
  }
  analyzerMode.value = 'off';
  smooth.fill(0);
  spectrum.value = new Array(BANDS).fill(0);
  levels.value = [-90, -90];
}
