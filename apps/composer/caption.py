"""The end title (spec §5.1): the line in a serif italic, names and date beneath, laid over the
last frames of the dawn shot on a soft dark veil so the picture still shows through."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from grade import HEIGHT, WIDTH

FONTS = Path(__file__).parent / "fonts"
# The veil: darkest across the middle where the words sit, lighter toward the edges.
VEIL = (8, 6, 4)
VEIL_EDGE, VEIL_MIDDLE = 110, 185
WARM = (255, 224, 178)
DIM = (200, 170, 130)


def _fit(draw: ImageDraw.ImageDraw, text: str, font_path: Path, size: int, max_width: int) -> ImageFont.FreeTypeFont:
    while size > 18:
        font = ImageFont.truetype(str(font_path), size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 2
    return ImageFont.truetype(str(font_path), size)


def render_caption(line1: str, line2: str | None, out: str, line3: str | None = None) -> str:
    img = Image.new("RGBA", (WIDTH, HEIGHT), (*VEIL, VEIL_EDGE))
    veil = ImageDraw.Draw(img)
    band = HEIGHT // 3
    for i in range(band):
        # A smooth band around the middle third, so the title reads over any picture.
        a = VEIL_EDGE + (VEIL_MIDDLE - VEIL_EDGE) * (1 - abs(i - band / 2) / (band / 2))
        veil.line([(0, band + i), (WIDTH, band + i)], fill=(*VEIL, int(a)))
    draw = ImageDraw.Draw(img)
    serif = FONTS / "CormorantGaramond-Italic.ttf"
    f1 = _fit(draw, line1, serif, 58, WIDTH - 96)
    y = HEIGHT // 2 - (40 if line2 else 0)
    draw.text((WIDTH / 2, y), line1, font=f1, fill=WARM, anchor="mm")
    if line2:
        f2 = _fit(draw, line2, serif, 40, WIDTH - 120)
        draw.text((WIDTH / 2, y + 78), line2, font=f2, fill=DIM, anchor="mm")
    if line3:
        f3 = _fit(draw, line3, serif, 34, WIDTH - 140)
        draw.text((WIDTH / 2, y + 140), line3, font=f3, fill=DIM, anchor="mm")
    img.save(out, "PNG")
    return out


def render_overlay(text: str, out: str) -> str:
    """A line of the film's own words (christmas spec §2.2): serif, upper third, on a soft dark band."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    serif = FONTS / "CormorantGaramond-Italic.ttf"
    font = ImageFont.truetype(str(serif), 46)
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if draw.textlength(trial, font=font) <= WIDTH - 120:
            line = trial
        else:
            lines.append(line)
            line = w
    lines.append(line)
    top = HEIGHT // 6
    band_h = 60 * len(lines) + 60
    for i in range(band_h):
        a = int(150 * (1 - abs(i - band_h / 2) / (band_h / 2)))
        draw.line([(0, top - 30 + i), (WIDTH, top - 30 + i)], fill=(*VEIL, a))
    for n, ln in enumerate(lines):
        draw.text((WIDTH / 2, top + 30 + n * 60), ln, font=font, fill=(255, 255, 255), anchor="mm")
    img.save(out, "PNG")
    return out


# Says the film is AI-made (EU AI Act art. 50, platform AI labels) and where it came from.
MARK_TEXT = "AI · videozombiecouple.com"


def render_mark(out: str, scale: float = 1.0) -> str:
    """The small corner mark (spec §4.2 S5): AI and the site's name, quiet enough not to spoil the film.
    On a photo it is scaled with the image and drawn a little stronger, over a soft shadow."""
    size = round(18 * scale)
    font = ImageFont.truetype(str(FONTS / "CourierPrime-Regular.ttf"), size)
    text = MARK_TEXT
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    w = int(probe.textlength(text, font=font)) + 4
    img = Image.new("RGBA", (w, size + 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if scale > 1.0:
        draw.text((3, 3), text, font=font, fill=(0, 0, 0, 140))
    draw.text((2, 2), text, font=font, fill=(255, 255, 255, 120 if scale == 1.0 else 200))
    img.save(out, "PNG")
    return out
