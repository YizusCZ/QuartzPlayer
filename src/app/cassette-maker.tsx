/**
 * "Crea tu cassette": colours, gradients and stickers for your own cassette.
 * The result is a regular style: it plays in the visualizer, the always-on
 * display and as a playlist cover.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Canvas, Group, Image as SkImageView, drawAsImage, type SkImage } from '@shopify/react-native-skia';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  CassetteBase,
  CassetteReels,
  CASSETTE_H,
  CASSETTE_W,
  PACK_MAX,
  PACK_MIN,
  StickerShape,
  loadStickerImages,
} from '@/components/cassette/CassetteArt';
import { getSkin, useCassettes } from '@/components/cassette/customSkins';
import { STICKER_PATHS, type CassetteSkin, type Sticker, type StickerKind } from '@/components/cassette/skins';
import { cassetteFonts, useSkiaFaces } from '@/components/skiaFonts';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Txt } from '@/components/ui/Txt';
import { hexToHsl, hslToHex, mix } from '@/lib/color';
import { pickStickerImage } from '@/lib/userMedia';
import { tap } from '@/lib/haptics';
import { HelpButton, TourTarget, useTourRef, useTourScroll } from '@/components/tour/Tour';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';
import { colors, fonts, radius, useAccent } from '@/theme';

const pack = (p: number) => Math.sqrt(PACK_MIN ** 2 + p * (PACK_MAX ** 2 - PACK_MIN ** 2));

const SWATCHES = [
  '#F2F1ED',
  '#1E1E21',
  '#5F5A50',
  '#9EA2A8',
  '#E5383B',
  '#FF6A2E',
  '#F2A33A',
  '#FFD23F',
  '#C6FF3D',
  '#5DD39E',
  '#2EC4B6',
  '#33D1FF',
  '#3E8FE0',
  '#7B2FF7',
  '#9B7BFF',
  '#D94BD1',
  '#FF71CE',
  '#FF8FB1',
  '#8C7AA8',
  '#2F5A4C',
];

type Field = {
  key: string;
  label: string;
  get: (s: CassetteSkin) => string;
  set: (s: CassetteSkin, c: string) => CassetteSkin;
};

const FIELDS: Record<'shell' | 'label' | 'stripe', Field[]> = {
  shell: [
    { key: 'shellLight', label: 'Brillo', get: (s) => s.shellLight, set: (s, c) => ({ ...s, shellLight: c }) },
    { key: 'shell', label: 'Base', get: (s) => s.shell, set: (s, c) => ({ ...s, shell: c }) },
    {
      key: 'window',
      label: 'Ventana',
      get: (s) => s.window[0],
      set: (s, c) => ({ ...s, window: [c, mix(c, '#000000', 0.4)], pane: mix(c, '#FFFFFF', 0.55) }),
    },
  ],
  label: [
    { key: 'paper', label: 'Papel', get: (s) => s.paper, set: (s, c) => ({ ...s, paper: c }) },
    {
      key: 'ink',
      label: 'Texto',
      get: (s) => s.ink,
      set: (s, c) => ({ ...s, ink: c, brandInk: c, inkSoft: mix(c, s.paper, 0.45) }),
    },
    {
      key: 'arrow',
      label: 'Acento',
      get: (s) => s.arrow,
      set: (s, c) => ({ ...s, arrow: c, modelInk: c, sideInk: mix(c, s.ink, 0.35) }),
    },
  ],
  stripe: [
    { key: 'stripe0', label: 'Franja 1', get: (s) => s.stripe[0], set: (s, c) => ({ ...s, stripe: [c, s.stripe[1]] }) },
    { key: 'stripe1', label: 'Franja 2', get: (s) => s.stripe[1], set: (s, c) => ({ ...s, stripe: [s.stripe[0], c] }) },
    { key: 'band0', label: 'Banda 1', get: (s) => s.band[0], set: (s, c) => ({ ...s, band: [c, s.band[1]] }) },
    { key: 'band1', label: 'Banda 2', get: (s) => s.band[1], set: (s, c) => ({ ...s, band: [s.band[0], c] }) },
  ],
};

type Tab = 'shell' | 'label' | 'stripe' | 'stickers';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'shell', label: 'Carcasa', icon: 'cassette' },
  { id: 'label', label: 'Etiqueta', icon: 'label-outline' },
  { id: 'stripe', label: 'Degradados', icon: 'gradient-horizontal' },
  { id: 'stickers', label: 'Stickers', icon: 'sticker-emoji' },
];

/** Swatches, then hue and lightness strips for any colour. */
function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [h, sat, l] = hexToHsl(value);
  const [w, setW] = useState(1);
  const strip = (pick: (t: number) => void) => ({
    onLayout: (e: { nativeEvent: { layout: { width: number } } }) => setW(e.nativeEvent.layout.width),
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: (e: { nativeEvent: { locationX: number } }) =>
      pick(Math.max(0, Math.min(1, e.nativeEvent.locationX / w))),
    onResponderMove: (e: { nativeEvent: { locationX: number } }) =>
      pick(Math.max(0, Math.min(1, e.nativeEvent.locationX / w))),
  });
  const hues = Array.from({ length: 13 }, (_, i) => hslToHex(i * 30, 0.8, 0.55));
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.swatches}>
        {SWATCHES.map((c) => (
          <Pressable
            key={c}
            onPress={() => (tap('select'), onChange(c))}
            style={[styles.swatch, { backgroundColor: c }, c === value.toUpperCase() && styles.swatchOn]}
            accessibilityRole="button"
            accessibilityLabel={c}
          />
        ))}
      </View>
      <View {...strip((t) => onChange(hslToHex(t * 359, Math.max(0.45, sat), l > 0.92 || l < 0.08 ? 0.55 : l)))}>
        <LinearGradient
          colors={hues as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.strip}
        />
        <View pointerEvents="none" style={[styles.knob, { left: `${(h / 360) * 100}%` }]} />
      </View>
      <View {...strip((t) => onChange(hslToHex(h, sat, t)))}>
        <LinearGradient
          colors={['#000000', hslToHex(h, sat, 0.5), '#FFFFFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.strip}
        />
        <View pointerEvents="none" style={[styles.knob, { left: `${l * 100}%` }]} />
      </View>
    </View>
  );
}

const STICKER_COLORS = ['#FF5A8A', '#FFD23F', '#3FE0D0', '#9B7BFF', '#FF8A3D', '#7CFFB2', '#FFFFFF', '#1E1E21'];

/** A new sticker near the bottom of the shell, slightly tilted, in a random bright colour. */
function newSticker(kind: StickerKind): Sticker {
  return {
    id: `${kind}_${Date.now().toString(36)}`,
    kind,
    x: 500 + (Math.random() - 0.5) * 300,
    y: 540,
    size: 90,
    rotate: (Math.random() - 0.5) * 0.5,
    color: STICKER_COLORS[Math.floor(Math.random() * 6)],
  };
}

/** The sticker being dragged (one editor is open at a time). */
const grab = { id: null as string | null, dx: 0, dy: 0 };
/** Sticker drags are applied at most once per frame. */
let pendingMove: (() => void) | null = null;
let moveFrame: number | null = null;
function scheduleMove(apply: () => void) {
  pendingMove = apply;
  if (moveFrame != null) return;
  moveFrame = requestAnimationFrame(() => {
    moveFrame = null;
    const run = pendingMove;
    pendingMove = null;
    run?.();
  });
}

function setGrab(g: { id: string; dx: number; dy: number } | null) {
  grab.id = g?.id ?? null;
  grab.dx = g?.dx ?? 0;
  grab.dy = g?.dy ?? 0;
}

function duplicate(st: Sticker): Sticker {
  return { ...st, id: `${st.kind}_${Date.now().toString(36)}`, x: st.x + 40, y: st.y - 20 };
}

export default function CassetteMaker() {
  useAccent();
  // `playlist`: made from a playlist's cover, so it dresses that playlist instead of the player.
  const { id: editId, playlist: forPlaylist } = useLocalSearchParams<{ id?: string; playlist?: string }>();
  const { width } = useWindowDimensions();
  const faces = useSkiaFaces();
  const cassetteFontsMemo = useMemo(() => (faces ? cassetteFonts(faces) : null), [faces]);

  const [draft, setDraft] = useState<CassetteSkin>(() => {
    const editing = editId ? useCassettes.getState().skins[editId] : undefined;
    if (editing) return { ...editing, stickers: [...(editing.stickers ?? [])] };
    const base = getSkin(useSettings.getState().cassetteSkin);
    return {
      ...base,
      id: `custom_${Date.now().toString(36)}`,
      name: 'Mi cassette',
      prefix: 'QZ',
      stickers: [...(base.stickers ?? [])],
    };
  });
  const [tab, setTab] = useState<Tab>('shell');
  const previewRef = useTourRef('maker.preview');
  const nameRef = useTourRef('maker.name');
  const panelRef = useTourRef('maker.panel');
  const tourScroll = useTourScroll();
  const [fieldKey, setFieldKey] = useState('shellLight');
  const [selected, setSelected] = useState<string | null>(null);

  const previewW = width - 32;
  const previewH = (previewW * CASSETTE_H) / CASSETTE_W;
  const k = previewW / CASSETTE_W;

  const fields = tab === 'stickers' ? [] : FIELDS[tab];
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0];
  const stickers = draft.stickers ?? [];
  const sel = stickers.find((s) => s.id === selected);

  const updateSticker = (patch: Partial<Sticker>) =>
    setDraft((d) => ({ ...d, stickers: (d.stickers ?? []).map((s) => (s.id === selected ? { ...s, ...patch } : s)) }));

  const addSticker = (kind: StickerKind) => {
    tap('select');
    const st = newSticker(kind);
    setDraft((d) => ({ ...d, stickers: [...(d.stickers ?? []), st] }));
    setSelected(st.id);
    setTab('stickers');
  };

  // Drag stickers around the shell (touch → design units).
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      const x = e.x / k;
      const y = e.y / k;
      const hit = [...stickers].reverse().find((s) => Math.hypot(s.x - x, s.y - y) < s.size * 0.6 + 12);
      setGrab(hit ? { id: hit.id, dx: hit.x - x, dy: hit.y - y } : null);
      if (hit) {
        setSelected(hit.id);
        setTab('stickers');
      }
    })
    .onUpdate((e) => {
      if (!grab.id) return;
      const x = Math.max(0, Math.min(CASSETTE_W, e.x / k + grab.dx));
      const y = Math.max(0, Math.min(CASSETTE_H, e.y / k + grab.dy));
      const id = grab.id;
      scheduleMove(() =>
        setDraft((d) => ({ ...d, stickers: (d.stickers ?? []).map((s) => (s.id === id ? { ...s, x, y } : s)) })),
      );
    });

  // The cassette itself (shaders and all) is drawn once into an image and only
  // redrawn when its colours or name change; stickers move on top of it.
  const ratio = PixelRatio.get();
  const noStickersSkin = useMemo(() => ({ ...draft, stickers: [] }), [draft]);
  const baseKey = JSON.stringify({ ...noStickersSkin, w: previewW });
  const [baseImg, setBaseImg] = useState<SkImage | null>(null);
  useEffect(() => {
    if (!cassetteFontsMemo) return;
    let alive = true;
    const el = (
      <Group transform={[{ scale: k * ratio }]}>
        <CassetteReels
          skin={noStickersSkin}
          px={k * ratio}
          hubL={[{ rotate: 0.3 }]}
          hubR={[{ rotate: 1.1 }]}
          packL={pack(0.55)}
          packR={pack(0.45)}
        />
        <CassetteBase
          skin={noStickersSkin}
          fonts={cassetteFontsMemo}
          px={k * ratio}
          title={noStickersSkin.name || 'Mi cassette'}
          artist="Quartz"
          album=""
          caption=""
          side="A"
          model="QZ 90"
        />
      </Group>
    );
    void drawAsImage(el, { width: Math.round(previewW * ratio), height: Math.round(previewH * ratio) }).then(
      (img) => alive && img && setBaseImg(img),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseKey covers the skin's drawn fields
  }, [baseKey, cassetteFontsMemo]);

  // Image stickers need their pictures decoded before they can be drawn.
  const [, setImagesReady] = useState(0);
  const imageKey = stickers.map((s) => s.uri ?? '').join('|');
  useEffect(() => {
    let alive = true;
    void loadStickerImages(stickers).then(() => alive && setImagesReady((n) => n + 1));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the set of pictures changes
  }, [imageKey]);

  const addImageSticker = async () => {
    const uri = await pickStickerImage().catch(() => null);
    if (!uri) return;
    const st: Sticker = { ...newSticker('star'), kind: 'image', uri, size: 170, color: '#FFFFFF' };
    await loadStickerImages([st]);
    setDraft((d) => ({ ...d, stickers: [...(d.stickers ?? []), st] }));
    setSelected(st.id);
    setTab('stickers');
  };

  const save = () => {
    tap('medium');
    const name = draft.name.trim() || 'Mi cassette';
    useCassettes.getState().save({ ...draft, name });
    if (forPlaylist) useLibrary.getState().updatePlaylist(forPlaylist, { skin: draft.id, cover: undefined });
    else if (!editId) useSettings.getState().set({ cassetteSkinMode: 'fixed', cassetteSkin: draft.id });
    useUI.getState().showToast(editId ? `“${name}” actualizado` : `“${name}” guardado y en uso`);
    router.back();
  };

  const remove = () =>
    Alert.alert('Eliminar cassette', `¿Eliminar “${draft.name}”?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          useCassettes.getState().remove(draft.id);
          if (useSettings.getState().cassetteSkin === draft.id) useSettings.getState().set({ cassetteSkin: 'magenta' });
          router.back();
        },
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={editId ? 'Editar cassette' : 'Crea tu cassette'}
        right={
          <View style={{ flexDirection: 'row' }}>
            {editId ? (
              <IconButton icon="delete-outline" label="Eliminar" onPress={remove} color={colors.danger} />
            ) : null}
            <HelpButton tour="maker" />
            <TourTarget id="maker.save">
              <IconButton icon="check" label="Guardar" onPress={save} color={colors.accent} />
            </TourTarget>
          </View>
        }
      />
      <ScrollView {...tourScroll} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <GestureDetector gesture={pan}>
          <View ref={previewRef} collapsable={false} style={[styles.preview, { width: previewW, height: previewH }]}>
            {cassetteFontsMemo ? (
              <Canvas style={{ width: previewW, height: previewH }}>
                {baseImg ? (
                  <SkImageView image={baseImg} x={0} y={0} width={previewW} height={previewH} fit="fill" />
                ) : null}
                <Group transform={[{ scale: k }]}>
                  {stickers.map((st) => (
                    <StickerShape key={st.id} sticker={st} selected={st.id === selected} />
                  ))}
                </Group>
              </Canvas>
            ) : null}
          </View>
        </GestureDetector>

        <View ref={nameRef} collapsable={false} style={styles.nameRow}>
          <TextInput
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            placeholder="Nombre del cassette"
            placeholderTextColor={colors.textMute}
            style={styles.name}
            maxLength={28}
          />
        </View>

        <TourTarget id="maker.tabs">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  tap('select');
                  setTab(t.id);
                  if (t.id !== 'stickers') setFieldKey(FIELDS[t.id][0].key);
                }}
                style={[styles.tab, tab === t.id && { backgroundColor: colors.accent }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.id }}
              >
                <Icon name={t.icon} size={18} color={tab === t.id ? colors.onAccent : colors.text} />
                <Txt variant="bodyStrong" style={[{ fontSize: 14 }, tab === t.id && { color: colors.onAccent }]}>
                  {t.label}
                </Txt>
              </Pressable>
            ))}
          </ScrollView>
        </TourTarget>

        <View ref={panelRef} collapsable={false} style={styles.panel}>
          {tab !== 'stickers' && field ? (
            <>
              <View style={styles.fields}>
                {fields.map((f) => (
                  <Pressable
                    key={f.key}
                    onPress={() => (tap('select'), setFieldKey(f.key))}
                    style={[styles.field, f.key === field.key && { borderColor: colors.accent }]}
                  >
                    <View style={[styles.fieldDot, { backgroundColor: f.get(draft) }]} />
                    <Txt variant="caption" style={f.key === field.key && { color: colors.accent }}>
                      {f.label}
                    </Txt>
                  </Pressable>
                ))}
              </View>
              {tab === 'stripe' ? (
                <View style={styles.gradPreview}>
                  <LinearGradient
                    colors={draft.stripe}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.gradBar}
                  />
                  <LinearGradient
                    colors={draft.band}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.gradBar}
                  />
                </View>
              ) : null}
              <ColorPicker value={field.get(draft)} onChange={(c) => setDraft((d) => field.set(d, c))} />
              {tab === 'shell' ? (
                <View style={styles.toggle}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">Carcasa translúcida</Txt>
                    <Txt variant="caption">Deja ver los rodillos, como un Type I transparente.</Txt>
                  </View>
                  <Switch
                    value={draft.rollers}
                    onValueChange={(rollers) => setDraft((d) => ({ ...d, rollers }))}
                    trackColor={{ true: colors.accent, false: colors.surface3 }}
                    thumbColor={colors.text}
                  />
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Txt variant="caption">
                Toca para añadir (o elige una imagen tuya) y arrastra en el cassette para colocarlos.
              </Txt>
              <View style={styles.tray}>
                <Pressable
                  onPress={() => void addImageSticker()}
                  style={[styles.trayItem, { backgroundColor: colors.accentSoft }]}
                  accessibilityLabel="Usar una imagen como sticker"
                >
                  <Icon name="image-plus" size={24} color={colors.accent} />
                </Pressable>
                {(Object.keys(STICKER_PATHS) as StickerKind[]).map((kind) => (
                  <Pressable
                    key={kind}
                    onPress={() => addSticker(kind)}
                    style={styles.trayItem}
                    accessibilityLabel={kind}
                  >
                    <Canvas style={{ width: 40, height: 40 }}>
                      <StickerShape
                        sticker={{ id: kind, kind, x: 20, y: 20, size: 30, rotate: 0, color: colors.accent }}
                      />
                    </Canvas>
                  </Pressable>
                ))}
              </View>
              {sel ? (
                <View style={{ gap: 12 }}>
                  <View style={styles.stickerTools}>
                    <IconButton
                      icon="minus"
                      label="Más pequeño"
                      onPress={() => updateSticker({ size: Math.max(30, sel.size - 12) })}
                    />
                    <IconButton
                      icon="plus"
                      label="Más grande"
                      onPress={() => updateSticker({ size: Math.min(260, sel.size + 12) })}
                    />
                    <IconButton
                      icon="rotate-left"
                      label="Girar a la izquierda"
                      onPress={() => updateSticker({ rotate: sel.rotate - 0.26 })}
                    />
                    <IconButton
                      icon="rotate-right"
                      label="Girar a la derecha"
                      onPress={() => updateSticker({ rotate: sel.rotate + 0.26 })}
                    />
                    <IconButton
                      icon="content-copy"
                      label="Duplicar"
                      onPress={() => {
                        const copy = duplicate(sel);
                        setDraft((d) => ({ ...d, stickers: [...(d.stickers ?? []), copy] }));
                        setSelected(copy.id);
                      }}
                    />
                    <IconButton
                      icon="delete-outline"
                      color={colors.danger}
                      label="Quitar sticker"
                      onPress={() => {
                        setDraft((d) => ({ ...d, stickers: (d.stickers ?? []).filter((s) => s.id !== sel.id) }));
                        setSelected(null);
                      }}
                    />
                  </View>
                  {sel.kind === 'image' ? null : (
                    <ColorPicker value={sel.color} onChange={(color) => updateSticker({ color })} />
                  )}
                </View>
              ) : stickers.length ? (
                <Txt variant="caption">Toca un sticker en el cassette para editarlo.</Txt>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { alignSelf: 'center', marginTop: 8 },
  nameRow: { paddingHorizontal: 16, paddingTop: 14 },
  name: {
    height: 46,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 16,
  },
  tabs: { gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: colors.surface2,
  },
  panel: { marginHorizontal: 16, padding: 14, gap: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  fieldDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  swatchOn: { borderWidth: 3, borderColor: colors.text },
  strip: { height: 26, borderRadius: 13 },
  knob: {
    position: 'absolute',
    top: -3,
    width: 14,
    height: 32,
    marginLeft: -7,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  gradPreview: { gap: 6 },
  gradBar: { height: 14, borderRadius: 7 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tray: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trayItem: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  stickerTools: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
});
