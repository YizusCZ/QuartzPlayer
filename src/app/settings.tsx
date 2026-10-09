import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SKINS, type CassetteSkinId } from '@/components/cassette/skins';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Txt } from '@/components/ui/Txt';
import { useDiscordStatus, type DiscordStatus } from '@/integrations/discord';
import { scanLibrary } from '@/library/scanner';
import { useLibrary } from '@/store/library';
import { PALETTES, useSettings, type PaletteId } from '@/store/settings';
import { ACCENTS, colors, radius, useAccent } from '@/theme';
import { MODES } from '@/lib/modes';

const DISCORD_STATUS: Record<DiscordStatus, string> = {
  off: 'Desactivado',
  unavailable: 'No disponible en esta versión',
  'no-discord': 'Instala Discord e inicia sesión',
  connecting: 'Esperando a que suene algo',
  ok: 'Conectado con Discord',
  error: 'Discord rechazó la actualización',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt variant="label" style={{ paddingHorizontal: 4 }}>
        {title}
      </Txt>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        {detail ? <Txt variant="caption">{detail}</Txt> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.surface3 }}
        thumbColor={colors.text}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Choice({
  label,
  detail,
  selected,
  onPress,
  swatch,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  swatch?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.row}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
    >
      {swatch ? <View style={[styles.swatch, { backgroundColor: swatch }]} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" style={selected && { color: colors.accent }}>
          {label}
        </Txt>
        {detail ? <Txt variant="caption">{detail}</Txt> : null}
      </View>
      <Icon
        name={selected ? 'check-circle' : 'music-circle-outline'}
        color={selected ? colors.accent : colors.surface3}
      />
    </Pressable>
  );
}

function Segment<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
      <Txt variant="bodyStrong">{label}</Txt>
      <View style={styles.segment} accessibilityRole="radiogroup">
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, value === o.value && { backgroundColor: colors.accentSoft }]}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === o.value }}
          >
            <Txt variant="caption" style={value === o.value && { color: colors.accent }}>
              {o.label}
            </Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function hslHex(h: number, sat = 0.78, l = 0.58): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (
    '#' +
    [f(0), f(8), f(4)]
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

const HUES = Array.from({ length: 13 }, (_, i) => hslHex(i * 30));

/** Tap or drag along the strip to pick any hue for the accent. */
function HuePicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [w, setW] = useState(1);
  const pick = (x: number) => onChange(hslHex(Math.max(0, Math.min(359, (x / w) * 360))));
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
      onResponderMove={(e) => pick(e.nativeEvent.locationX)}
      accessibilityRole="adjustable"
      accessibilityLabel="Color personalizado"
      style={styles.hueWrap}
    >
      <LinearGradient
        colors={HUES as [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.hue}
      />
      <View pointerEvents="none" style={[styles.hueValue, { backgroundColor: value }]} />
    </View>
  );
}

export default function Settings() {
  useAccent();
  const s = useSettings();
  const discord = useDiscordStatus();
  const lastScan = useLibrary((x) => x.lastScan);
  const count = useLibrary((x) => Object.keys(x.tracks).length);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Ajustes" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 }}>
        <Section title="PERSONALIZACIÓN">
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 12 }]}>
            <View style={{ gap: 2 }}>
              <Txt variant="bodyStrong">Color principal</Txt>
              <Txt variant="caption">Botones, barras de progreso y detalles de toda la app.</Txt>
            </View>
            <View style={styles.swatches}>
              {ACCENTS.map((a) => (
                <Pressable
                  key={a.hex}
                  onPress={() => s.set({ accent: a.hex })}
                  style={[styles.accentDot, { backgroundColor: a.hex }, s.accent === a.hex && styles.accentDotOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: s.accent === a.hex }}
                  accessibilityLabel={a.name}
                >
                  {s.accent === a.hex ? <Icon name="check" size={18} color={colors.onAccent} /> : null}
                </Pressable>
              ))}
            </View>
            <HuePicker value={s.accent} onChange={(hex) => s.set({ accent: hex })} />
          </View>
          <Toggle
            label="AmbientShare"
            detail="El reproductor toma los colores de la portada y los muestra como un fondo translúcido en movimiento."
            value={s.ambientShare}
            onChange={(v) => s.set({ ambientShare: v })}
          />
        </Section>

        <Section title="ACCESO RÁPIDO DEL REPRODUCTOR">
          {MODES.map((m) => (
            <Toggle
              key={m.id}
              label={m.label}
              value={s.quickModes.includes(m.id)}
              onChange={(on) => {
                const next = on ? [...s.quickModes, m.id] : s.quickModes.filter((q) => q !== m.id);
                s.set({ quickModes: MODES.map((x) => x.id).filter((id) => next.includes(id)) });
              }}
            />
          ))}
        </Section>

        <Section title="SONIDO">
          <Pressable style={styles.row} onPress={() => router.push('/equalizer')} accessibilityRole="button">
            <Icon name="tune-vertical" color={colors.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Ecualizador</Txt>
              <Txt variant="caption">10 bandas, preamplificador y presets</Txt>
            </View>
            <Icon name="chevron-right" color={colors.textMute} />
          </Pressable>
        </Section>

        <Section title="REPRODUCTOR">
          <Toggle
            label="Cambiar al visualizador al reproducir"
            detail="Al empezar una canción, el reproductor abre el último visualizador que usaste."
            value={s.autoVisualizer}
            onChange={(v) => s.set({ autoVisualizer: v })}
          />
          <Toggle
            label="Mantener pantalla encendida"
            detail="Solo mientras un visualizador está a la vista."
            value={s.keepAwake}
            onChange={(v) => s.set({ keepAwake: v })}
          />
        </Section>

        <Section title="BARRAS Y MEDIDORES">
          <Segment
            label="Número de barras"
            options={[24, 32, 48, 64].map((n) => ({ value: n, label: String(n) }))}
            value={s.barCount}
            onChange={(n) => s.set({ barCount: n as 24 | 32 | 48 | 64 })}
          />
          <Segment
            label="Sensibilidad"
            options={[
              { value: 0.7, label: 'Baja' },
              { value: 1, label: 'Normal' },
              { value: 1.3, label: 'Alta' },
              { value: 1.6, label: 'Máx.' },
            ]}
            value={s.sensitivity}
            onChange={(n) => s.set({ sensitivity: n })}
          />
          <View style={styles.row}>
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              Colores
            </Txt>
          </View>
          <View style={styles.palettes}>
            {(Object.keys(PALETTES) as PaletteId[]).map((id) => (
              <Pressable
                key={id}
                onPress={() => s.set({ palette: id })}
                style={[styles.palette, s.palette === id && { borderColor: colors.accent }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: s.palette === id }}
                accessibilityLabel={PALETTES[id].name}
              >
                <LinearGradient
                  colors={PALETTES[id].colors}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 0, y: 0 }}
                  style={styles.paletteSwatch}
                />
                <Txt variant="caption" numberOfLines={1}>
                  {PALETTES[id].name}
                </Txt>
              </Pressable>
            ))}
          </View>
          <Toggle
            label="Mantener picos"
            detail="Marcas que caen despacio sobre cada barra."
            value={s.peakHold}
            onChange={(v) => s.set({ peakHold: v })}
          />
        </Section>

        <Section title="LETRAS">
          <Toggle
            label="Buscar letras en internet"
            detail="Si el archivo no trae letra, se busca en internet."
            value={s.onlineLyrics}
            onChange={(v) => s.set({ onlineLyrics: v })}
          />
        </Section>

        <Section title="PORTADAS ANIMADAS">
          <Toggle
            label="Buscar portadas animadas"
            detail="En la carátula y en el visualizador Vídeo, cuando el álbum tiene una."
            value={s.motionArt}
            onChange={(v) => s.set({ motionArt: v })}
          />
        </Section>

        <Section title="DISCORD">
          <Toggle
            label="Mostrar lo que escuchas"
            detail={`${DISCORD_STATUS[discord.status]}${discord.status === 'error' && discord.message ? ` (${discord.message})` : ''}`}
            value={s.discordPresence}
            onChange={(v) => s.set({ discordPresence: v })}
          />
        </Section>

        <Section title="CASSETTE">
          <Choice
            label="Según la calidad del archivo"
            detail="Hi-Res → Type IV · Sin pérdida → Type II · Comprimido → Type I"
            selected={s.cassetteSkinMode === 'auto'}
            onPress={() => s.set({ cassetteSkinMode: 'auto' })}
          />
          <View style={styles.skins}>
            {(Object.keys(SKINS) as CassetteSkinId[]).map((id) => {
              const on = s.cassetteSkinMode === 'fixed' && s.cassetteSkin === id;
              const [name, type] = SKINS[id].name.split(' · ');
              return (
                <Pressable
                  key={id}
                  onPress={() => s.set({ cassetteSkinMode: 'fixed', cassetteSkin: id })}
                  style={[styles.skin, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={SKINS[id].name}
                >
                  <LinearGradient
                    colors={[SKINS[id].shellLight, SKINS[id].shell]}
                    style={styles.skinShell}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <View style={[styles.skinLabel, { backgroundColor: SKINS[id].paper }]}>
                      <LinearGradient
                        colors={SKINS[id].stripe}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.skinStripe}
                      />
                    </View>
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong" numberOfLines={1} style={on && { color: colors.accent }}>
                      {name}
                    </Txt>
                    <Txt variant="caption" numberOfLines={1} style={{ fontSize: 11 }}>
                      {type}
                    </Txt>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Toggle
            label="Etiqueta escrita a mano"
            value={s.handwrittenLabel}
            onChange={(v) => s.set({ handwrittenLabel: v })}
          />
          <Toggle
            label="Pantalla siempre activa"
            detail="Tras un rato sin tocar la pantalla, el cassette pasa a un modo atenuado sobre negro con la hora, como un always on display. Mantiene la pantalla encendida y mueve el contenido cada minuto para no marcar el panel. Toca para salir."
            value={s.cassetteAod}
            onChange={(v) => s.set({ cassetteAod: v })}
          />
          {s.cassetteAod ? (
            <Segment
              label="Activar tras"
              options={[
                { value: 10, label: '10 s' },
                { value: 30, label: '30 s' },
                { value: 60, label: '1 min' },
              ]}
              value={s.cassetteAodDelay}
              onChange={(n) => s.set({ cassetteAodDelay: n as 10 | 30 | 60 })}
            />
          ) : null}
        </Section>

        <Section title="BIBLIOTECA">
          <Toggle
            label="Buscar música nueva al abrir"
            detail="Comprobación rápida y silenciosa; solo se leen los archivos nuevos. En Android también detecta cambios en segundo plano."
            value={s.scanOnLaunch}
            onChange={(v) => s.set({ scanOnLaunch: v })}
          />
          <Toggle
            label="Ignorar audios cortos"
            detail="Oculta clips de menos de 30 s (tonos, notas de voz)."
            value={s.skipShortClips}
            onChange={(v) => s.set({ skipShortClips: v })}
          />
          <Pressable style={styles.row} onPress={() => void scanLibrary({ manual: true })} accessibilityRole="button">
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Volver a escanear</Txt>
              <Txt variant="caption">
                {count} canciones{lastScan ? ` · último escaneo ${new Date(lastScan).toLocaleString()}` : ''}
              </Txt>
            </View>
            <Icon name="refresh" color={colors.accent} />
          </Pressable>
        </Section>

        <Section title="GENERAL">
          <Toggle label="Respuesta háptica" value={s.haptics} onChange={(v) => s.set({ haptics: v })} />
          <Pressable style={styles.row} onPress={() => router.push('/about')} accessibilityRole="button">
            <Icon name="shield-lock-outline" color={colors.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Privacidad, usos y créditos</Txt>
              <Txt variant="caption">Cómo funcionan las funciones en línea y condiciones</Txt>
            </View>
            <Icon name="chevron-right" color={colors.textMute} />
          </Pressable>
        </Section>

        <View style={styles.thanks}>
          <Image source={require('../../assets/images/thanks-cat.png')} style={styles.cat} contentFit="contain" />
          <Txt variant="title" style={{ textAlign: 'center' }}>
            Gracias por utilizar Quartz
          </Txt>
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/images/logo-mark.png')}
              style={{ width: 16, height: 19 }}
              tintColor={colors.accent}
              contentFit="contain"
            />
            <Txt variant="label">QUARTZ {Constants.expoConfig?.version ?? ''}</Txt>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  swatch: { width: 18, height: 18, borderRadius: 4 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  accentDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  accentDotOn: { borderWidth: 3, borderColor: colors.text },
  hueWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hue: { flex: 1, height: 28, borderRadius: 14 },
  hueValue: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.text },
  thanks: { alignItems: 'center', gap: 10, paddingTop: 16, paddingBottom: 24 },
  cat: { width: 220, height: 216 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skins: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  skin: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
  },
  skinShell: { width: 44, height: 28, borderRadius: 4, padding: 3 },
  skinLabel: { flex: 1, borderRadius: 2, justifyContent: 'center', paddingHorizontal: 2 },
  skinStripe: { height: 6, borderRadius: 1 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: 10, padding: 3 },
  segItem: { flex: 1, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  palettes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  palette: {
    width: '31%',
    flexGrow: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
    padding: 8,
    gap: 6,
  },
  paletteSwatch: { height: 26, borderRadius: 6 },
});
