from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'public' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)

# HermesDeck icon generator.
# Concept: winged Hermes messenger + AI command deck + hidden H monogram.
# The production icon is deliberately simpler than the AI concept image so it stays legible in the sidebar and PWA launcher.


def rounded_mask(size: int, radius_ratio: float = 0.225) -> Image.Image:
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    return mask


def make_icon(size: int, safe_pad: int = 0) -> Image.Image:
    scale = 4
    S = size * scale
    q = S / 1024
    pad = safe_pad * q

    img = Image.new('RGBA', (S, S), '#07090f')
    px = img.load()
    for y in range(S):
        for x in range(S):
            nx = x / (S - 1)
            ny = y / (S - 1)
            cyan = max(0, 1 - (((nx - 0.22) ** 2 + (ny - 0.70) ** 2) ** 0.5) / 0.68)
            violet = max(0, 1 - (((nx - 0.77) ** 2 + (ny - 0.30) ** 2) ** 0.5) / 0.70)
            v = int(8 + 13 * ny)
            px[x, y] = (
                min(255, v + int(14 * violet)),
                min(255, v + int(34 * cyan)),
                min(255, v + int(56 * violet + 40 * cyan)),
                255,
            )

    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow, 'RGBA')
    cx = S / 2
    gd.ellipse([cx - 260 * q, 236 * q, cx + 260 * q, 756 * q], fill=(78, 218, 255, 42))
    gd.ellipse([cx - 210 * q, 252 * q, cx + 210 * q, 730 * q], fill=(130, 105, 255, 52))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(int(34 * q))))
    d = ImageDraw.Draw(img, 'RGBA')

    # Thick orbital arcs: visible at 32px, but not noisy.
    for bbox, start, end, color, width in [
        ([174, 182, 850, 858], 205, 334, (91, 232, 255, 100), 18),
        ([224, 222, 800, 798], 30, 158, (142, 118, 255, 105), 16),
    ]:
        d.arc([v * q for v in bbox], start, end, fill=color, width=max(2, int(width * q)))

    # Three-piece wings: broad, iconic, asymmetric color = cyan/violet Hermes motion.
    left = [
        [(492, 338), (230, 274), (340, 392), (500, 422)],
        [(472, 440), (186, 444), (328, 548), (488, 536)],
        [(474, 552), (246, 636), (398, 682), (506, 612)],
    ]
    for pts in left:
        l = [(x * q, y * q) for x, y in pts]
        r = [((1024 - x) * q, y * q) for x, y in pts]
        d.polygon(l, fill=(75, 224, 255, 232), outline=(210, 252, 255, 118))
        d.polygon(r, fill=(133, 112, 255, 234), outline=(236, 230, 255, 116))

    # Monogram H: white command core, slightly faceted so it does not read as just pause bars.
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow, 'RGBA')
    for rect in [(418, 254, 492, 690), (532, 254, 606, 690), (418, 440, 606, 518)]:
        sd.rounded_rectangle([v * q for v in rect], radius=int(28 * q), fill=(0, 0, 0, 200))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(int(10 * q))))
    d = ImageDraw.Draw(img, 'RGBA')
    white = (240, 248, 255, 244)
    for rect in [(418, 246, 492, 684), (532, 246, 606, 684)]:
        d.rounded_rectangle([v * q for v in rect], radius=int(28 * q), fill=white, outline=(255, 255, 255, 130), width=max(1, int(3 * q)))
    d.rounded_rectangle([418 * q, 438 * q, 606 * q, 520 * q], radius=int(30 * q), fill=white, outline=(255, 255, 255, 120), width=max(1, int(3 * q)))
    # Negative cockpit notch at top and deck notch at bottom make the mark custom.
    d.polygon([(512 * q, 214 * q), (472 * q, 260 * q), (552 * q, 260 * q)], fill=(7, 9, 15, 245))
    d.polygon([(512 * q, 726 * q), (472 * q, 674 * q), (552 * q, 674 * q)], fill=(7, 9, 15, 235))

    # Command deck base: one strong console silhouette plus three status nodes.
    deck = [(284, 734), (740, 734), (824, 852), (200, 852)]
    d.polygon([(x * q, y * q) for x, y in deck], fill=(8, 12, 24, 235), outline=(112, 235, 255, 142))
    for x, col in [(360, (82, 232, 255, 245)), (512, (242, 248, 255, 245)), (664, (147, 120, 255, 245))]:
        d.ellipse([(x - 28) * q, 774 * q, (x + 28) * q, 830 * q], fill=col, outline=(255, 255, 255, 150), width=max(1, int(4 * q)))

    # Sparse deck grooves only; avoid grid noise at small size.
    for y in [760, 848]:
        d.line([(274 * q, y * q), (750 * q, y * q)], fill=(255, 255, 255, 34), width=max(1, int(3 * q)))

    # Maskable padding support: inset rounded frame when safe_pad > 0.
    if safe_pad:
        veil = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        vd = ImageDraw.Draw(veil, 'RGBA')
        vd.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int((S - 2 * pad) * 0.22), outline=(255, 255, 255, 58), width=max(2, int(5 * q)))
        img = Image.alpha_composite(img, veil)

    final = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    final.paste(img, (0, 0), rounded_mask(S))
    d = ImageDraw.Draw(final, 'RGBA')
    d.rounded_rectangle([10 * q, 10 * q, S - 10 * q, S - 10 * q], radius=int(S * 0.22), outline=(255, 255, 255, 52), width=max(1, int(4 * q)))
    return final.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == '__main__':
    make_icon(512, 0).save(OUT / 'icon-512.png', optimize=True)
    make_icon(192, 0).save(OUT / 'icon-192.png', optimize=True)
    make_icon(180, 0).save(OUT / 'apple-touch-icon.png', optimize=True)
    make_icon(512, 72).save(OUT / 'maskable-512.png', optimize=True)
    for name in ['icon-512.png', 'icon-192.png', 'apple-touch-icon.png', 'maskable-512.png']:
        print(OUT / name)
