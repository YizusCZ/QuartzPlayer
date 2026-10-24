/**
 * Dev-only headless renderer: draws the cassette and visualizers to PNG with
 * CanvasKit so the artwork can be reviewed without a device.
 *   npm run preview   →  tools/preview-out/*.png
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createElement as h } from 'react';

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LoadSkiaWeb } = require('@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb');
  await LoadSkiaWeb();
  const SkMod = await import('@shopify/react-native-skia');
  const Sk = ((SkMod as unknown as { default?: typeof SkMod }).default ?? SkMod) as typeof SkMod & {
    makeOffscreenSurface: (w: number, h: number) => import('@shopify/react-native-skia').SkSurface;
    drawOffscreen: (
      s: import('@shopify/react-native-skia').SkSurface,
      el: React.ReactNode,
    ) => Promise<import('@shopify/react-native-skia').SkImage>;
  };
  const { CassetteBase, CassetteReels, CASSETTE_W, CASSETTE_H, PACK_MIN, PACK_MAX } =
    await import('../src/components/cassette/CassetteArt');
  const { SKINS, modelCode } = await import('../src/components/cassette/skins');
  const { CassetteCoverArt } = await import('../src/components/cassette/CassetteCoverArt');
  const Skia = Sk.Skia;

  const tf = (pkg: string, file: string) =>
    Skia.Typeface.MakeFreeTypeFaceFromData(
      Skia.Data.fromBytes(readFileSync(`node_modules/@expo-google-fonts/${pkg}/${file}`)),
    )!;
  const michroma = tf('michroma', '400Regular/Michroma_400Regular.ttf');
  const regular = tf('barlow', '400Regular/Barlow_400Regular.ttf');
  const medium = tf('barlow', '500Medium/Barlow_500Medium.ttf');
  const semi = tf('barlow', '600SemiBold/Barlow_600SemiBold.ttf');
  const hand = tf('caveat', '600SemiBold/Caveat_600SemiBold.ttf');
  const fonts = {
    brand: Skia.Font(michroma, 28),
    emboss: Skia.Font(michroma, 11),
    model: Skia.Font(semi, 44),
    side: Skia.Font(regular, 56),
    label: Skia.Font(regular, 25),
    labelSmall: Skia.Font(regular, 17),
    tiny: Skia.Font(medium, 12),
    hand: Skia.Font(hand, 34),
    handSmall: Skia.Font(hand, 24),
  };

  mkdirSync('tools/preview-out', { recursive: true });
  const pack = (p: number) => Math.sqrt(PACK_MIN ** 2 + p * (PACK_MAX ** 2 - PACK_MIN ** 2));

  const shots: [string, keyof typeof SKINS, number, boolean, boolean][] = [
    ['portrait-magenta', 'magenta', 0.3, false, true],
    ['landscape-sunset', 'sunset', 0.7, false, false],
    ['landscape-metal', 'metal', 0.5, true, false],
    ['landscape-crystal', 'crystal', 0.05, false, false],
  ];
  for (const [name, skin, progress, handwritten, portrait] of shots) {
    const W = portrait ? 720 : 1280;
    const H = portrait ? 1400 : 760;
    const surface = Sk.makeOffscreenSurface(W, H);
    const scale = portrait
      ? Math.min((W - 60) / CASSETTE_H, (H - 60) / CASSETTE_W)
      : Math.min((W - 80) / CASSETTE_W, (H - 80) / CASSETTE_H);
    const px = scale;
    const text = {
      title: 'Zoom',
      artist: 'Last Dinosaurs',
      album: 'In a Million Years · 2012',
      caption: 'FLAC · 24bit · 96kHz',
      side: 'A' as const,
      model: modelCode(skin, 250),
      handwritten,
    };
    const art = h(
      Sk.Group,
      null,
      h(CassetteReels, {
        skin: SKINS[skin],
        px,
        hubL: [{ rotate: 0.4 }],
        hubR: [{ rotate: 1.1 }],
        packL: pack(1 - progress),
        packR: pack(progress),
      }),
      h(CassetteBase, { skin: SKINS[skin], fonts, px, ...text }),
    );
    const tree = h(
      Sk.Group,
      null,
      h(Sk.Rect, { x: 0, y: 0, width: W, height: H, color: '#0B0B0C' }),
      h(Sk.RoundedRect, { x: 18, y: 18, width: W - 36, height: H - 36, r: 34, color: '#1A1B1F' }),
      h(
        Sk.Group,
        {
          transform: portrait
            ? [
                { translateX: W / 2 },
                { translateY: H / 2 },
                { rotate: -Math.PI / 2 },
                { scale },
                { translateX: -CASSETTE_W / 2 },
                { translateY: -CASSETTE_H / 2 },
              ]
            : [
                { translateX: W / 2 },
                { translateY: H / 2 },
                { scale },
                { translateX: -CASSETTE_W / 2 },
                { translateY: -CASSETTE_H / 2 },
              ],
        },
        art,
      ),
    );
    const image = await Sk.drawOffscreen(surface, tree);
    writeFileSync(`tools/preview-out/${name}.png`, image.encodeToBytes());
    console.log('wrote', name);
  }

  // Stickers on a custom shell (what "Crea tu cassette" produces).
  {
    const W = 1280;
    const H = 760;
    const surface = Sk.makeOffscreenSurface(W, H);
    const scale = Math.min((W - 80) / CASSETTE_W, (H - 80) / CASSETTE_H);
    const kinds = ['star', 'heart', 'bolt', 'note', 'sparkle', 'flower', 'smile', 'moon', 'flame', 'crown', 'cherry', 'peace'] as const;
    const skin = {
      ...SKINS.vapor,
      stickers: kinds.map((kind, i) => ({
        id: kind,
        kind,
        x: 110 + (i % 6) * 156,
        y: i < 6 ? 515 : 590,
        size: 62,
        rotate: (i % 3) * 0.25 - 0.25,
        color: ['#FF5A8A', '#FFD23F', '#3FE0D0', '#9B7BFF', '#FF8A3D', '#7CFFB2'][i % 6],
      })),
    };
    const tree = h(
      Sk.Group,
      null,
      h(Sk.Rect, { x: 0, y: 0, width: W, height: H, color: '#0B0B0C' }),
      h(
        Sk.Group,
        { transform: [{ translateX: W / 2 }, { translateY: H / 2 }, { scale }, { translateX: -CASSETTE_W / 2 }, { translateY: -CASSETTE_H / 2 }] },
        h(CassetteReels, { skin, px: scale, hubL: [{ rotate: 0.4 }], hubR: [{ rotate: 1.1 }], packL: pack(0.5), packR: pack(0.5) }),
        h(CassetteBase, { skin, fonts, px: scale, title: 'Mi cassette', artist: 'YizusTC', album: '', caption: '', side: 'A' as const, model: 'QZ 90' }),
      ),
    );
    const image = await Sk.drawOffscreen(surface, tree);
    writeFileSync('tools/preview-out/landscape-stickers.png', image.encodeToBytes());
    console.log('wrote landscape-stickers');
  }

  // Playlist covers: every skin, as a contact sheet.
  const ids = Object.keys(SKINS) as (keyof typeof SKINS)[];
  const C = 360;
  const cols = 4;
  const sheet = Sk.makeOffscreenSurface(cols * C, Math.ceil(ids.length / cols) * C);
  const covers = ids.map((id, i) =>
    h(
      Sk.Group,
      { key: id, transform: [{ translateX: (i % cols) * C }, { translateY: Math.floor(i / cols) * C }] },
      h(CassetteCoverArt, {
        skin: SKINS[id],
        fonts,
        size: C,
        title: ['Para el camino', 'Noches de verano', 'Lo-fi para estudiar', 'Clásicos 80s'][i % 4],
        subtitle: `${12 + i} canciones`,
        model: modelCode(id, 1800),
      }),
    ),
  );
  const img = await Sk.drawOffscreen(sheet, h(Sk.Group, null, ...covers));
  writeFileSync('tools/preview-out/playlist-covers.png', img.encodeToBytes());
  console.log('wrote playlist-covers');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
