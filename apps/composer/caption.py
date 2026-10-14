"""The end title card (spec §5.1 shot 5): the line in a serif italic, names and date beneath."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from grade import HEIGHT, WIDTH

FONTS = Path(__file__).parent / "fonts"
BG = (8, 6, 4)
WARM = (255, 224, 178)
DIM = (200, 170, 130)


def _fit(draw: ImageDraw.ImageDraw, text: str, font_path: Path, size: int, max_width: int) -> ImageFont.FreeTypeFont:
    while size > 18:
        font = ImageFont.truetype(str(font_path), size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 2
    return ImageFont.truetype(str(font_path), size)


def render_caption(line1: str, line2: str | None, out: str) -> str:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)
    serif = FONTS / "CormorantGaramond-Italic.ttf"
    f1 = _fit(draw, line1, serif, 58, WIDTH - 96)
    y = HEIGHT // 2 - (40 if line2 else 0)
    draw.text((WIDTH / 2, y), line1, font=f1, fill=WARM, anchor="mm")
    if line2:
        f2 = _fit(draw, line2, serif, 40, WIDTH - 120)
        draw.text((WIDTH / 2, y + 78), line2, font=f2, fill=DIM, anchor="mm")
    img.save(out, "PNG")
    return out


def render_mark(out: str) -> str:
    """The small corner mark (spec §4.2 S5): the site's name, quiet enough not to spoil the film."""
    font = ImageFont.truetype(str(FONTS / "CourierPrime-Regular.ttf"), 18)
    text = "videozombiecouple.com"
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    w = int(probe.textlength(text, font=font)) + 4
    img = Image.new("RGBA", (w, 26), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((2, 2), text, font=font, fill=(255, 255, 255, 120))
    img.save(out, "PNG")
    return out
