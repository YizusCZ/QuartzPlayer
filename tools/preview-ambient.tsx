// Dev-only: renders a few frames of the AmbientShare shader to PNG.
import { writeFileSync } from 'node:fs';

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LoadSkiaWeb } = require('@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb');
  await LoadSkiaWeb();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSkiaExports } = require('@shopify/react-native-skia/lib/commonjs/headless');
  const Skia = getSkiaExports().Skia;
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/components/AmbientBackdrop.tsx', 'utf8');
  const sksl = /AMBIENT_SKSL = `([\s\S]*?)`;/.exec(src)![1];
  const fx = Skia.RuntimeEffect.Make(sksl);
  if (!fx) throw new Error('shader failed to compile');
  const W = 390;
  const H = 844;
  const palettes: Record<string, number[][]> = {
    warm: [[0.62, 0.22, 0.14], [0.55, 0.38, 0.12], [0.3, 0.12, 0.35], [0.58, 0.3, 0.42]],
    cool: [[0.1, 0.3, 0.55], [0.15, 0.48, 0.5], [0.35, 0.2, 0.55], [0.2, 0.25, 0.4]],
  };
  for (const [name, p] of Object.entries(palettes)) {
    for (const t of [0, 20]) {
      const surface = Skia.Surface.Make(W, H)!;
      const paint = Skia.Paint();
      paint.setShader(fx.makeShader([W, H, t, ...p[0], ...p[1], ...p[2], ...p[3]]));
      surface.getCanvas().drawPaint(paint);
      surface.flush();
      writeFileSync(`tools/preview-out/ambient-${name}-${t}.png`, surface.makeImageSnapshot().encodeToBytes());
    }
  }
  console.log('ok');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
