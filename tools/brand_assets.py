"""Dev-only: builds the app icon set and the UI logo mark from assets/brand/logo-source.png.

    npm run brand      (requires Pillow)
"""
from PIL import Image, ImageDraw, ImageFilter

SRC = 'assets/brand/logo-source.png'
S = 1024

im = Image.open(SRC).convert('L')
# White-on-black artwork → white glyph with luminance as alpha.
alpha = im.point(lambda v: 0 if v < 40 else (255 if v > 200 else int((v - 40) * 255 / 160)))
glyph = Image.new('RGBA', im.size, (255, 255, 255, 0))
glyph.putalpha(alpha)
glyph = glyph.crop(glyph.getbbox())


def fit(g, box):
    g = g.copy()
    g.thumbnail((box, box), Image.LANCZOS)
    return g


def place(canvas, g):
    canvas.alpha_composite(g, ((canvas.width - g.width) // 2, (canvas.height - g.height) // 2))
    return canvas


fit(glyph, 512).save('assets/images/logo-mark.png', optimize=True)

bg = Image.new('RGBA', (S, S), (10, 10, 11, 255))
glow = Image.new('L', (S, S), 0)
ImageDraw.Draw(glow).ellipse((S * 0.18, S * 0.14, S * 0.82, S * 0.86), fill=70)
glow = glow.filter(ImageFilter.GaussianBlur(140))
bg = Image.composite(Image.new('RGBA', (S, S), (60, 48, 36, 255)), bg, glow)
place(bg, fit(glyph, int(S * 0.62))).convert('RGB').save('assets/icon.png')

Image.new('RGBA', (S, S), (10, 10, 11, 255)).save('assets/android-icon-background.png')
for name in ('android-icon-foreground', 'android-icon-monochrome'):
    place(Image.new('RGBA', (S, S)), fit(glyph, int(S * 0.46))).save(f'assets/{name}.png')
place(Image.new('RGBA', (S, S)), fit(glyph, int(S * 0.7))).save('assets/splash-icon.png')
place(Image.new('RGBA', (48, 48), (10, 10, 11, 255)), fit(glyph, 40)).save('assets/favicon.png')
print('brand assets written')
