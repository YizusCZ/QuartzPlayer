/**
 * Plain-language sound-quality analysis: where a file sits on the ladder from
 * studio master down to low-bitrate streaming, and what that means.
 */
import { LOSSLESS, khz, type AudioFormat } from './types';

export type TierId = 'master' | 'studio' | 'hires' | 'cd' | 'lossless' | 'high' | 'standard' | 'low' | 'unknown';

export type Tier = {
  id: TierId;
  name: string;
  /** What it is comparable to. */
  equivalent: string;
  description: string;
  color: string;
};

export const TIERS: Record<TierId, Tier> = {
  master: {
    id: 'master',
    name: 'Máster de estudio',
    equivalent: 'Calidad de sonido de estudio profesional · 24-bit, 176 kHz o más',
    description: 'La resolución con la que se graban y mezclan los discos.',
    color: '#E9C46A',
  },
  studio: {
    id: 'studio',
    name: 'Calidad de estudio',
    equivalent: 'Calidad de sonido de máster Hi-Res · 24-bit, 88.2–96 kHz',
    description: 'Más detalle y espacio que un CD.',
    color: '#D9B45A',
  },
  hires: {
    id: 'hires',
    name: 'Alta resolución',
    equivalent: 'Calidad de sonido superior a CD · 24-bit',
    description: 'Silencios más limpios y más matices en pasajes suaves.',
    color: '#C9A55A',
  },
  cd: {
    id: 'cd',
    name: 'Calidad CD',
    equivalent: 'Calidad de sonido de CD · 16-bit, 44.1 kHz',
    description: 'Sin pérdida, como un disco compacto.',
    color: '#8FB3C9',
  },
  lossless: {
    id: 'lossless',
    name: 'Sin pérdida',
    equivalent: 'Calidad de sonido sin compresión con pérdida',
    description: 'Resolución algo menor que la de un CD.',
    color: '#8FA3AE',
  },
  high: {
    id: 'high',
    name: 'Alta (comprimido)',
    equivalent: 'Calidad de sonido de streaming alto · 256–320 kbps',
    description: 'Muy buena para audífonos y bocinas comunes.',
    color: '#9DBF8A',
  },
  standard: {
    id: 'standard',
    name: 'Estándar (comprimido)',
    equivalent: 'Calidad de sonido de streaming normal · 128–192 kbps',
    description: 'Buena para escucha casual.',
    color: '#B6A28A',
  },
  low: {
    id: 'low',
    name: 'Básica',
    equivalent: 'Calidad de sonido de radio por internet · menos de 128 kbps',
    description: 'Compresión alta; se pierden agudos y detalle.',
    color: '#A88A8A',
  },
  unknown: {
    id: 'unknown',
    name: 'Desconocida',
    equivalent: 'Calidad de sonido no disponible',
    description: '',
    color: '#777',
  },
};

/** Order used for the quality ladder, best first. */
export const LADDER: TierId[] = ['master', 'studio', 'hires', 'cd', 'high', 'standard', 'low'];

export type QualityReport = {
  tier: Tier;
  lossless: boolean;
  /** Theoretical dynamic range in dB (6.02·bits + 1.76). */
  dynamicRange?: number;
  /** Highest reproducible frequency (Nyquist), Hz. */
  bandwidth?: number;
  /** Uncompressed PCM data rate, kbps. */
  pcmRate?: number;
  /** Actual file bitrate, kbps. */
  fileRate?: number;
  /** PCM data compared with a CD (1411 kbps). */
  vsCD?: number;
  /** 0..1 for gauges. */
  score: number;
  facts: { label: string; value: string; hint?: string }[];
};

const CD_RATE = 1411.2;

export function tierOf(f: AudioFormat): Tier {
  if (f.codec === 'UNKNOWN') return TIERS.unknown;
  const sr = f.sampleRate ?? 0;
  const bits = f.bitDepth ?? 0;
  if (LOSSLESS.includes(f.codec)) {
    if (bits >= 24 && sr >= 176400) return TIERS.master;
    if (bits >= 24 && sr >= 88200) return TIERS.studio;
    if (bits > 16 || sr > 48000) return TIERS.hires;
    if (bits === 16 && sr >= 44100) return TIERS.cd;
    return sr || bits ? TIERS.lossless : TIERS.cd;
  }
  const br = f.bitrate ?? 0;
  // Opus/AAC are more efficient than MP3 at the same bitrate.
  const eff = f.codec === 'OPUS' ? 1.6 : f.codec === 'AAC' || f.codec === 'OGG' ? 1.2 : 1;
  const eq = br * eff;
  if (eq >= 250) return TIERS.high;
  if (eq >= 125) return TIERS.standard;
  if (br > 0) return TIERS.low;
  return TIERS.standard;
}

export function analyzeQuality(f: AudioFormat): QualityReport {
  const tier = tierOf(f);
  const lossless = LOSSLESS.includes(f.codec);
  const sr = f.sampleRate;
  const bits = lossless ? f.bitDepth : undefined;
  const ch = f.channels ?? 2;
  const dynamicRange = bits ? 6.02 * bits + 1.76 : undefined;
  const bandwidth = sr ? sr / 2 : undefined;
  const pcmRate = sr && bits ? (sr * bits * ch) / 1000 : undefined;
  const fileRate = f.bitrate;
  const vsCD = lossless ? (pcmRate ? pcmRate / CD_RATE : undefined) : fileRate ? fileRate / CD_RATE : undefined;

  const idx = LADDER.indexOf(tier.id);
  const score = idx < 0 ? 0.3 : 1 - idx / (LADDER.length - 1);

  const facts: QualityReport['facts'] = [];
  facts.push({
    label: 'Formato',
    value: `${f.codec}${lossless ? ' · sin pérdida' : ' · con pérdida'}`,
    hint: lossless ? 'Conserva todo el audio original.' : 'Reduce tamaño quitando detalle poco audible.',
  });
  if (bits)
    facts.push({
      label: 'Profundidad',
      value: `${bits} bit`,
      hint: `${Math.pow(2, bits).toLocaleString()} niveles de amplitud`,
    });
  if (sr)
    facts.push({
      label: 'Frecuencia de muestreo',
      value: khz(sr),
      hint: `${sr.toLocaleString()} muestras por segundo`,
    });
  if (dynamicRange)
    facts.push({
      label: 'Rango dinámico',
      value: `${dynamicRange.toFixed(0)} dB`,
      hint: 'Del silencio al pico máximo (CD: 98 dB)',
    });
  if (bandwidth)
    facts.push({
      label: 'Ancho de banda',
      value: `hasta ${(bandwidth / 1000).toFixed(1)} kHz`,
      hint: bandwidth > 22050 ? 'Por encima del límite del CD (22 kHz)' : 'Cubre el oído humano (≈ 20 kHz)',
    });
  if (pcmRate && lossless)
    facts.push({ label: 'Datos PCM', value: `${Math.round(pcmRate)} kbps`, hint: 'Flujo sin comprimir equivalente' });
  if (fileRate)
    facts.push({
      label: lossless ? 'Tasa del archivo' : 'Tasa de bits',
      value: `${Math.round(fileRate)} kbps`,
      hint: lossless && pcmRate ? `Compresión sin pérdida al ${Math.round((fileRate / pcmRate) * 100)} %` : undefined,
    });
  if (vsCD)
    facts.push({
      label: 'Frente a un CD',
      value: `${vsCD >= 1 ? vsCD.toFixed(1) + '×' : Math.round(vsCD * 100) + ' %'} de datos`,
    });
  if (f.channels) facts.push({ label: 'Canales', value: ch === 1 ? 'Mono' : ch === 2 ? 'Estéreo' : `${ch} canales` });

  return { tier, lossless, dynamicRange, bandwidth, pcmRate, fileRate, vsCD, score, facts };
}
