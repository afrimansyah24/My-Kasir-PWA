#!/usr/bin/env python3
"""Generate My Kasir PWA icons.

Source of truth for the app icon: an aurora field (cobalt -> mint with a lilac
blob) carrying a white receipt with a torn zigzag edge and a barcode. Drawn at
4x and downsampled so the 48px rendition stays crisp.

Usage:  python3 tools/gen-icons.py
Requires: pillow
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

COBALT = (47, 75, 255)
LILAC = (139, 123, 255)
MINT = (15, 191, 168)
SKY = (56, 186, 255)
INK = (16, 22, 43)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def aurora(size):
    """Multi-stop aurora field built small then upscaled (smooth, fast)."""
    n = 128
    img = Image.new("RGB", (n, n))
    d = ImageDraw.Draw(img)
    for y in range(n):
        d.line([(0, y), (n, y)], fill=lerp(COBALT, MINT, y / (n - 1)))

    for cx, cy, r, col, alpha in (
        (0.80, 0.14, 0.58, LILAC, 225),
        (0.12, 0.78, 0.50, SKY, 165),
        (0.46, 0.44, 0.34, (255, 255, 255), 62),
        (0.92, 0.88, 0.34, MINT, 150),
    ):
        layer = Image.new("RGB", (n, n), col)
        mask = Image.new("L", (n, n), 0)
        md = ImageDraw.Draw(mask)
        px, py, pr = cx * n, cy * n, r * n
        md.ellipse([px - pr, py - pr, px + pr, py + pr], fill=alpha)
        mask = mask.filter(ImageFilter.GaussianBlur(pr * 0.34))
        img = Image.composite(layer, img, mask)

    return img.resize((size, size), Image.LANCZOS)


def _arc(cx, cy, r, a0, a1, steps=10):
    return [
        (cx + r * math.cos(a0 + (a1 - a0) * i / steps),
         cy + r * math.sin(a0 + (a1 - a0) * i / steps))
        for i in range(steps + 1)
    ]


def receipt_glyph(size, scale=0.60):
    """White receipt with torn zigzag bottom and a barcode, centred on canvas."""
    S = size
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    w = S * scale
    h = w * 1.22
    x0 = (S - w) / 2
    y0 = (S - h) / 2
    r = w * 0.17
    bottom = y0 + h * 0.74
    tooth = h * 0.13

    pts = []
    pts += _arc(x0 + w - r, y0 + r, r, -math.pi / 2, 0)          # top-right
    pts += [(x0 + w, bottom)]                                     # right edge
    teeth = 5
    tw = w / teeth
    for i in range(teeth):                                        # zigzag, right to left
        xa = x0 + w - i * tw
        pts += [(xa, bottom), (xa - tw / 2, bottom + tooth)]
    pts += [(x0, bottom)]                                         # left edge
    pts += _arc(x0 + r, y0 + r, r, math.pi, math.pi * 1.5)        # top-left
    d.polygon(pts, fill=(255, 255, 255, 255))

    # barcode
    bar_top = y0 + h * 0.26
    bar_h = h * 0.28
    widths = [0.030, 0.017, 0.030, 0.012, 0.024, 0.012, 0.030, 0.017]
    bx = x0 + w * 0.20
    total = sum(widths)
    avail = w * 0.60
    for bw in widths:
        px = bw / total * avail
        d.rectangle([bx, bar_top, bx + px, bar_top + bar_h], fill=INK + (232,))
        bx += px + w * 0.012

    # amount rule
    d.rounded_rectangle(
        [x0 + w * 0.20, y0 + h * 0.60, x0 + w * 0.50, y0 + h * 0.645],
        radius=h * 0.022, fill=INK + (150,),
    )
    return layer


def build(size, maskable=False, bleed=False):
    S = size * 4
    base = aurora(S).convert("RGBA")

    glyph_scale = 0.44 if maskable else 0.60
    g = receipt_glyph(S, glyph_scale)
    base.alpha_composite(g)

    if not bleed:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255
        )
        base.putalpha(mask)

    return base.resize((size, size), Image.LANCZOS)


def main():
    jobs = [
        ("icon-192.png", 192, False, False),
        ("icon-512.png", 512, False, False),
        ("maskable-512.png", 512, True, False),
        ("apple-touch-icon.png", 180, False, True),
    ]
    for name, size, maskable, bleed in jobs:
        img = build(size, maskable=maskable, bleed=bleed)
        path = os.path.join(OUT, name)
        img.save(path, "PNG", optimize=True)
        print(f"{name}  {size}x{size}  {os.path.getsize(path) // 1024} KB")

    # favicon.svg — vector twin of the mark, used as the browser tab icon
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2F4BFF"/>
      <stop offset="0.55" stop-color="#8B7BFF"/>
      <stop offset="1" stop-color="#0FBFA8"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path d="M20 14h24a4 4 0 0 1 4 4v24l-5.3-3.4-5.4 3.4-5.3-3.4-5.4 3.4L21 39l-5 3.4V18a4 4 0 0 1 4-4z" fill="#fff"/>
  <g fill="#10162B" opacity="0.82">
    <rect x="21" y="22" width="3" height="13" rx="1"/>
    <rect x="26" y="22" width="1.8" height="13" rx="0.9"/>
    <rect x="30" y="22" width="3" height="13" rx="1"/>
    <rect x="35" y="22" width="1.8" height="13" rx="0.9"/>
    <rect x="39" y="22" width="3" height="13" rx="1"/>
  </g>
</svg>
"""
    with open(os.path.join(OUT, "favicon.svg"), "w") as f:
        f.write(svg)
    print("favicon.svg")


if __name__ == "__main__":
    main()
