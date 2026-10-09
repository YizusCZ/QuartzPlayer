// Dev-only: maps '@shopify/react-native-skia' to the headless (CanvasKit) build for tools/preview.tsx.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const headless = require('@shopify/react-native-skia/lib/commonjs/headless');
// Loaded after LoadSkiaWeb(); core helpers expect the JSI-style global.
(globalThis as Record<string, unknown>).SkiaApi = headless.getSkiaExports().Skia;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = {
  ...require('@shopify/react-native-skia/lib/commonjs/skia/core/Rect'),
  ...require('@shopify/react-native-skia/lib/commonjs/skia/core/RRect'),
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vector = require('@shopify/react-native-skia/lib/commonjs/skia/core/Vector');
module.exports = {
  ...headless,
  ...core,
  ...vector,
  get Skia() {
    return headless.getSkiaExports().Skia;
  },
};
