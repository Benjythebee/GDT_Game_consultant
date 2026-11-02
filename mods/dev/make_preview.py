"""Builds the mod's preview image (mods/game-consultant/image.png, 512x512) from the Workshop screenshots.

It is shown in the game's Mods list and used as the Steam Workshop preview. Run after mods/dev/screenshots.mjs:

    python mods/dev/make_preview.py
"""
import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOT = ROOT / 'workshop' / 'screenshots' / '02-perfect-combo.png'
OUT = ROOT / 'game-consultant' / 'image.png'
CARD = (1117, 183, 1425, 503)  # the Consultant card in the 1600x900 screenshot
SIZE = 512
FONTS = pathlib.Path('C:/Windows/Fonts')


def font(name, size):
    try:
        return ImageFont.truetype(str(FONTS / name), size)
    except OSError:
        return ImageFont.load_default()


def centered(draw, y, text, fnt, fill, shadow=None):
    w = draw.textlength(text, font=fnt)
    x = (SIZE - w) / 2
    if shadow:
        draw.text((x + 2, y + 3), text, font=fnt, fill=shadow)
    draw.text((x, y), text, font=fnt, fill=fill)


def main():
    img = Image.new('RGB', (SIZE, SIZE))
    top, bottom = (255, 186, 64), (232, 110, 0)
    draw = ImageDraw.Draw(img)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        draw.line([(0, y), (SIZE, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))

    card = Image.open(SHOT).convert('RGB').crop(CARD)
    scale = 312 / card.width
    card = card.resize((round(card.width * scale), round(card.height * scale)), Image.LANCZOS)
    x, y = (SIZE - card.width) // 2, 128
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x + 6, y + 10, x + card.width + 6, y + card.height + 10], 14, fill=(80, 30, 0, 120))
    img.paste(shadow.filter(ImageFilter.GaussianBlur(8)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(8)))
    img.paste(card, (x, y))

    draw = ImageDraw.Draw(img)
    centered(draw, 22, 'Game Consultant', font('segoeuib.ttf', 54), (255, 255, 255), shadow=(150, 60, 0))
    centered(draw, 86, 'your advisor for Game Dev Tycoon', font('segoeui.ttf', 22), (255, 248, 235))
    centered(draw, SIZE - 50, 'Combos \u00b7 Sliders & staff \u00b7 Sequels \u00b7 Deals', font('segoeuib.ttf', 21), (255, 255, 255), shadow=(150, 60, 0))
    img.save(OUT, optimize=True)
    print('Wrote', OUT, OUT.stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
