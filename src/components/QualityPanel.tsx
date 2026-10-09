import { StyleSheet, View } from 'react-native';
import { analyzeQuality, LADDER } from '@/library/quality';
import { khz, LOSSLESS, type AudioFormat } from '@/library/types';
import { colors, fonts, radius } from '@/theme';
import { Txt } from './ui/Txt';

/** Worst → best, the way a level meter fills. */
const SCALE = [...LADDER].reverse();
const SHORT: Partial<Record<(typeof LADDER)[number], string>> = {
  low: '<128k',
  standard: '128k',
  high: '320k',
  cd: 'CD',
  hires: 'Hi-Res',
  studio: '96k',
  master: '192k',
};

function Readout({ value, unit }: { value: string; unit: string }) {
  return (
    <View style={styles.cell}>
      <Txt style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
      <Txt style={styles.unit}>{unit}</Txt>
    </View>
  );
}

/** A file's sound quality, laid out like the display of a hi-fi DAC. */
export function QualityPanel({ format }: { format: AudioFormat }) {
  const q = analyzeQuality(format);
  const lossless = LOSSLESS.includes(format.codec);
  const level = SCALE.indexOf(q.tier.id);
  const tint = q.tier.color;

  const readouts: { value: string; unit: string }[] = [
    { value: format.codec === 'UNKNOWN' ? '—' : format.codec, unit: lossless ? 'SIN PÉRDIDA' : 'COMPRIMIDO' },
  ];
  if (lossless && format.bitDepth) readouts.push({ value: String(format.bitDepth), unit: 'BIT' });
  if (!lossless && format.bitrate) readouts.push({ value: String(Math.round(format.bitrate)), unit: 'KBPS' });
  if (format.sampleRate) readouts.push({ value: khz(format.sampleRate).replace('kHz', ''), unit: 'KHZ' });

  const rows: [string, string][] = [];
  if (q.dynamicRange) rows.push(['Rango dinámico', `${q.dynamicRange.toFixed(0)} dB`]);
  if (q.bandwidth) rows.push(['Respuesta hasta', `${(q.bandwidth / 1000).toFixed(1)} kHz`]);
  if (q.pcmRate && lossless) rows.push(['Flujo PCM', `${Math.round(q.pcmRate)} kbps`]);
  if (q.fileRate)
    rows.push([
      lossless ? 'Archivo' : 'Tasa de bits',
      lossless && q.pcmRate
        ? `${Math.round(q.fileRate)} kbps · ${Math.round((q.fileRate / q.pcmRate) * 100)} %`
        : `${Math.round(q.fileRate)} kbps`,
    ]);
  if (q.vsCD) rows.push(['Datos frente a CD', q.vsCD >= 1 ? `${q.vsCD.toFixed(1)}×` : `${Math.round(q.vsCD * 100)} %`]);
  if (format.channels)
    rows.push(['Canales', format.channels === 1 ? 'Mono' : format.channels === 2 ? 'Estéreo' : `${format.channels}`]);

  return (
    <View style={{ gap: 18 }}>
      <View style={styles.display} accessibilityLabel={`${q.tier.name}. ${q.tier.equivalent}`}>
        <View style={styles.readouts}>
          {readouts.map((r, i) => (
            <View key={r.unit} style={[styles.readoutWrap, i > 0 && styles.divider]}>
              <Readout {...r} />
            </View>
          ))}
        </View>
        <View style={styles.meter}>
          {SCALE.map((id, i) => (
            <View key={id} style={{ flex: 1, gap: 5 }}>
              <View
                style={[
                  styles.seg,
                  {
                    backgroundColor: i <= level ? tint : 'rgba(255,255,255,0.07)',
                    opacity: i <= level ? 0.45 + (0.55 * (i + 1)) / (level + 1) : 1,
                  },
                ]}
              />
              <Txt style={[styles.tick, i === level && { color: tint }]} numberOfLines={1}>
                {SHORT[id]}
              </Txt>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: 2, paddingHorizontal: 2 }}>
        <Txt variant="heading" style={{ color: tint }}>
          {q.tier.name}
        </Txt>
        {q.tier.description ? <Txt variant="caption">{q.tier.description}</Txt> : null}
      </View>

      {rows.length ? (
        <View>
          {rows.map(([k, v], i) => (
            <View key={k} style={[styles.row, i === 0 && { borderTopWidth: 0 }]}>
              <Txt variant="caption" style={{ flex: 1 }}>
                {k}
              </Txt>
              <Txt variant="mono" style={{ color: colors.text, fontSize: 13 }}>
                {v}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  display: {
    backgroundColor: '#070708',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 16,
  },
  readouts: { flexDirection: 'row' },
  readoutWrap: { flex: 1, paddingHorizontal: 8 },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.12)' },
  cell: { alignItems: 'center', gap: 2 },
  value: { fontFamily: fonts.condensedBold, fontSize: 34, lineHeight: 38, color: colors.text, letterSpacing: 0.5 },
  unit: { fontFamily: fonts.condensed, fontSize: 10, letterSpacing: 1.6, color: colors.textMute },
  meter: { flexDirection: 'row', gap: 4 },
  seg: { height: 6, borderRadius: 1.5 },
  tick: { fontFamily: fonts.condensed, fontSize: 10, color: colors.textMute, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
});
