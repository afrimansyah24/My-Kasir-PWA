#!/usr/bin/env python3
"""Render My Kasir demo product art.

Flat illustrated cut-outs with a soft gradient body, a specular sweep and a
contact shadow. Exported as transparent WebP so one asset works on the product
card, the promo ribbon and the receipt.

Usage:  python3 tools/gen-products.py
Requires: pillow
"""
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "assets", "products")
os.makedirs(OUT, exist_ok=True)

S = 900
FINAL = 600

INK = (16, 22, 43)


# --------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------
def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def lighten(c, t):
    return mix(c, (255, 255, 255), t)


def darken(c, t):
    return mix(c, INK, t)


def arc_pts(cx, cy, r, a0, a1, steps=48):
    """Angles in degrees, 0 = east, growing clockwise on screen."""
    return [
        (
            cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
            cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps)),
        )
        for i in range(steps + 1)
    ]


# --------------------------------------------------------------------------
# draw ops
#   ("poly", points, colour)
#   ("ell",  bbox, colour)
#   ("rrect", bbox, radius, colour)
#   ("line", points, width, colour)
#   ("arc",  cx, cy, r, a0, a1, width, colour)
# --------------------------------------------------------------------------

def op_goggles(c):
    strap, frame, lens, hi, shadow = c
    return [
        # strap band arcing over the lenses
        ("arc", 450, 380, 205, 186, 354, 30, strap),
        ("ell", 232, 330, 668, 470, shadow),
        # lenses
        ("ell", 262, 336, 448, 470, lens),
        ("ell", 452, 336, 638, 470, lens),
        # frame ring
        ("ell", 250, 324, 460, 482, frame),
        ("ell", 440, 324, 650, 482, frame),
        ("ell", 276, 350, 434, 456, lens),
        ("ell", 466, 350, 624, 456, lens),
        # bridge
        ("rrect", 418, 366, 482, 412, 20, frame),
        # highlights
        ("ell", 300, 366, 360, 404, hi),
        ("ell", 490, 366, 550, 404, hi),
    ]


def op_sunglasses(c):
    frame, lens, hi, shadow, _ = c
    return [
        ("line", [(268, 344), (120, 292)], 22, frame),
        ("line", [(632, 344), (780, 292)], 22, frame),
        ("ell", 236, 330, 664, 466, shadow),
        ("ell", 244, 322, 456, 468, frame),
        ("ell", 444, 322, 656, 468, frame),
        ("ell", 262, 342, 438, 448, lens),
        ("ell", 462, 342, 638, 448, lens),
        ("ell", 292, 356, 356, 396, hi),
    ]


def op_tshirt(c):
    body, sleeve, seam, mark, _ = c
    return [
        # sleeves + body as one silhouette
        ("poly", [
            (338, 236), (262, 262), (176, 384), (258, 424), (296, 372),
            (296, 664), (604, 664), (604, 372), (642, 424), (724, 384),
            (638, 262), (562, 236), (508, 288), (392, 288),
        ], body),
        # collar
        ("poly", [
            (338, 236), (392, 288), (450, 252), (508, 288), (562, 236),
            (528, 214), (372, 214),
        ], sleeve),
        # shoulder seams
        ("line", [(296, 372), (296, 656)], 7, seam),
        ("line", [(604, 372), (604, 656)], 7, seam),
        # hem
        ("line", [(300, 646), (600, 646)], 8, seam),
        ("ell", 428, 396, 472, 440, mark),
    ]


def op_shorts(c):
    body, waist, seam, mark, _ = c
    return [
        ("poly", [
            (286, 300), (614, 300), (640, 372), (616, 626), (486, 626),
            (450, 486), (414, 626), (284, 626), (260, 372),
        ], body),
        ("rrect", 258, 274, 642, 324, 18, waist),
        ("line", [(450, 324), (450, 486)], 8, seam),
        ("line", [(288, 606), (416, 606)], 7, seam),
        ("line", [(484, 606), (612, 606)], 7, seam),
        ("ell", 428, 344, 472, 388, mark),
    ]


def op_bag(c):
    body, panel, strap, mark, _ = c
    return [
        # handle behind the body
        ("arc", 450, 352, 118, 180, 360, 24, strap),
        ("rrect", 226, 322, 674, 648, 46, body),
        ("rrect", 226, 428, 674, 512, 22, panel),
        ("rrect", 226, 322, 674, 360, 18, darken(body, 0.16)),
        ("ell", 424, 462, 476, 514, mark),
    ]


def op_cap(c):
    body, brim, seam, mark, _ = c
    return [
        # brim sweeping out to the right, sitting under the crown
        ("poly", [
            (430, 468), (560, 470), (700, 500), (780, 546), (742, 588),
            (600, 578), (452, 546),
        ], brim),
        # crown dome
        ("poly", [
            (282, 486), (282, 396), (318, 310), (382, 254), (450, 240),
            (520, 252), (582, 300), (618, 372), (618, 486),
        ], body),
        # front panel seam
        ("arc", 450, 252, 168, 196, 344, 12, seam),
        ("line", [(450, 252), (450, 484)], 10, seam),
        # button on top
        ("ell", 428, 230, 472, 274, mark),
    ]


def op_shoe(c):
    body, sole, lace, mark, _ = c
    return [
        ("poly", [
            (168, 566), (176, 486), (250, 424), (322, 392), (392, 404),
            (452, 462), (566, 486), (700, 502), (748, 536), (748, 568),
            (168, 568),
        ], body),
        ("rrect", 160, 548, 756, 590, 16, sole),
        ("poly", [(250, 424), (322, 392), (392, 404), (352, 442), (274, 462)], darken(body, 0.14)),
        ("line", [(286, 446), (340, 428)], 11, lace),
        ("line", [(312, 472), (368, 452)], 11, lace),
        ("ell", 556, 492, 608, 532, mark),
    ]


def op_jacket(c):
    body, sleeve, zip, mark, _ = c
    return [
        ("poly", [
            (306, 244), (206, 296), (166, 520), (252, 546), (282, 438),
            (282, 668), (618, 668), (618, 438), (648, 546), (734, 520),
            (694, 296), (594, 244), (556, 318), (450, 280), (344, 318),
        ], body),
        ("poly", [(306, 244), (344, 318), (450, 280), (556, 318), (594, 244),
                  (556, 222), (344, 222)], sleeve),
        ("line", [(450, 288), (450, 664)], 11, zip),
        ("line", [(296, 452), (404, 452)], 8, zip),
        ("line", [(496, 452), (604, 452)], 8, zip),
        ("ell", 414, 356, 486, 428, mark),
    ]


def op_watch(c):
    strap, case_c, dial, mark, _ = c
    return [
        ("rrect", 398, 148, 502, 392, 24, strap),
        ("rrect", 398, 508, 502, 752, 24, strap),
        ("ell", 336, 336, 564, 564, case_c),
        ("ell", 366, 366, 534, 534, dial),
        ("line", [(450, 450), (450, 394)], 12, mark),
        ("line", [(450, 450), (494, 470)], 10, mark),
        ("ell", 442, 442, 458, 458, mark),
    ]


def op_bottle(c):
    body, cap_c, band, mark, _ = c
    return [
        ("rrect", 348, 258, 552, 702, 74, body),
        ("rrect", 402, 186, 498, 272, 28, cap_c),
        ("rrect", 348, 396, 552, 466, 12, band),
        ("ell", 424, 516, 476, 568, mark),
        ("rrect", 372, 280, 412, 660, 20, lighten(body, 0.16)),
    ]


def op_towel(c):
    body, fold, stripe, mark, _ = c
    return [
        ("rrect", 244, 272, 656, 646, 42, body),
        ("rrect", 244, 396, 656, 466, 20, fold),
        ("rrect", 292, 326, 608, 348, 9, stripe),
        ("rrect", 292, 500, 608, 522, 9, stripe),
        ("rrect", 244, 272, 656, 300, 14, lighten(body, 0.12)),
        ("ell", 424, 546, 476, 598, mark),
    ]


def op_ball(c):
    body, seam, mark, _spare, _ = c
    return [
        ("ell", 276, 276, 624, 624, body),
        ("arc", 450, 450, 174, 196, 344, 11, seam),
        ("arc", 450, 450, 174, 16, 164, 11, seam),
        ("line", [(450, 276), (450, 624)], 11, seam),
        ("ell", 424, 424, 476, 476, mark),
    ]


OPS = {
    "goggles": op_goggles,
    "sunglasses": op_sunglasses,
    "tshirt": op_tshirt,
    "shorts": op_shorts,
    "bag": op_bag,
    "cap": op_cap,
    "shoe": op_shoe,
    "jacket": op_jacket,
    "watch": op_watch,
    "bottle": op_bottle,
    "towel": op_towel,
    "ball": op_ball,
}


def draw_shape(d, op):
    kind = op[0]
    if kind == "poly":
        d.polygon(op[1], fill=op[2])
    elif kind == "ell":
        # bbox may be packed as a tuple or as four loose numbers
        if isinstance(op[1], (tuple, list)):
            geom, col = op[1], op[2]
        else:
            geom, col = tuple(op[1:5]), op[5]
        d.ellipse(geom, fill=col)
    elif kind == "rrect":
        if isinstance(op[1], (tuple, list)):
            geom, radius, col = op[1], op[2], op[3]
        else:
            geom, radius, col = tuple(op[1:5]), op[5], op[6]
        d.rounded_rectangle(geom, radius=radius, fill=col)
    elif kind == "line":
        d.line(op[1], fill=op[3], width=op[2], joint="curve")
    elif kind == "arc":
        _, cx, cy, r, a0, a1, w, col = op
        d.line(arc_pts(cx, cy, r, a0, a1), fill=col, width=w, joint="curve")
        # round the caps
        for a in (a0, a1):
            px = cx + r * math.cos(math.radians(a))
            py = cy + r * math.sin(math.radians(a))
            d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=col)


def render(kind, palette):
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # body: flat silhouette in its own colours
    flat = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(flat)
    for op in OPS[kind](palette):
        draw_shape(fd, op)

    # contact shadow on the floor, anchored to the product's own footprint so it
    # reads as the item resting on a surface instead of a detached blob.
    bbox = flat.getchannel("A").getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        cx = (x0 + x1) / 2
        half = max(80, (x1 - x0) * 0.42)
        top = y1 - 24
        shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).ellipse(
            [cx - half, top, cx + half, top + 76], fill=(16, 22, 43, 66)
        )
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(26)))

    # Multiply a vertical light ramp over the silhouette. Multiplying keeps the
    # hue; compositing would replace it.
    ramp = Image.new("L", (S, S))
    rp = ramp.load()
    for y in range(S):
        t = y / (S - 1)
        v = int(255 * (1.0 - 0.26 * t))
        for x in range(S):
            rp[x, y] = v
    # per-pixel multiply of the ramp over the silhouette
    flat_rgb = flat.convert("RGB")
    fpx = flat_rgb.load()
    rpx = ramp.load()
    for y in range(S):
        for x in range(S):
            v = rpx[x, y]
            r, g, b = fpx[x, y]
            fpx[x, y] = (
                min(255, (r * v) // 255),
                min(255, (g * v) // 255),
                min(255, (b * v) // 255),
            )
    body = flat_rgb.convert("RGBA")
    body.putalpha(flat.getchannel("A"))
    canvas.alpha_composite(body)

    # specular sweep across the upper-left.
    #
    # The mask must be applied to the ALPHA channel only. paste(white, mask)
    # multiplies the source RGB by the mask too, which turns the highlight into
    # mid-gray (44,44,44) instead of white, and — because the sweep was
    # composited over the whole canvas rather than the silhouette — it painted a
    # grey haze across the empty upper-left of every product.
    sweep_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(sweep_mask).ellipse([-180, -340, 620, 250], fill=44)
    sweep_mask = sweep_mask.filter(ImageFilter.GaussianBlur(95))
    # keep the highlight on the product itself
    sweep_mask = ImageChops.multiply(sweep_mask, flat.getchannel("A"))

    sweep = Image.new("RGBA", (S, S), (255, 255, 255, 0))
    sweep.putalpha(sweep_mask)
    canvas.alpha_composite(sweep)

    return canvas


PRODUCTS = [
    ("goggles-attack", "goggles", "#2F4BFF", "#1B2559", "#38BAFF", "#9FE9FF", "#0E1430"),
    ("goggles-bigframe", "goggles", "#0FBFA8", "#06303B", "#7BE8D5", "#DFFFF7", "#06303B"),
    ("sunglasses-nova", "sunglasses", "#7C5CFF", "#241347", "#FF9BC2", "#FFE0EC", "#241347"),
    ("tshirt-coral", "tshirt", "#FF5C7A", "#5A1226", "#FFFFFF", "#FFD9E1", "#8E2440"),
    ("tshirt-mint", "tshirt", "#0FBFA8", "#06303B", "#FFFFFF", "#D6FFF6", "#0A5A50"),
    ("tshirt-cobalt", "tshirt", "#2F4BFF", "#101A55", "#FFFFFF", "#DCE3FF", "#1A2A8E"),
    ("shorts-ember", "shorts", "#FF8A3D", "#5A2A08", "#FFFFFF", "#FFE7D2", "#B4531A"),
    ("shorts-navy", "shorts", "#1B2559", "#0A0F2E", "#FFB020", "#FFEFCF", "#0A0F2E"),
    ("bag-swim", "bag", "#38BAFF", "#0A3350", "#FFFFFF", "#DCF2FF", "#0A3350"),
    ("bag-daily", "bag", "#3A4270", "#171C3A", "#0FBFA8", "#D5FFF6", "#171C3A"),
    ("cap-ember", "cap", "#FF5C7A", "#5A1226", "#FFFFFF", "#FFDAE2", "#8E2440"),
    ("shoe-drift", "shoe", "#EEF2FC", "#3A4270", "#2F4BFF", "#C9D4FF", "#3A4270"),
    ("jacket-storm", "jacket", "#3A4270", "#12172F", "#0FBFA8", "#CFF7EF", "#12172F"),
    ("watch-pulse", "watch", "#1B2559", "#080C20", "#0FBFA8", "#B6FFF0", "#080C20"),
    ("bottle-steel", "bottle", "#38BAFF", "#0A3350", "#FFFFFF", "#DCF2FF", "#0A3350"),
    ("towel-sand", "towel", "#FFB020", "#5C3A00", "#FFFFFF", "#FFF0D0", "#B47A12"),
    ("ball-pro", "ball", "#FFFFFF", "#B9C2DE", "#2F4BFF", "#DCE3FF", "#B9C2DE"),
]


def main():
    for slug, kind, a, b, c, d, e in PRODUCTS:
        palette = [hex2rgb(x) for x in (a, b, c, d, e)]
        img = render(kind, palette).resize((FINAL, FINAL), Image.LANCZOS)
        path = os.path.join(OUT, f"{slug}.webp")
        img.save(path, "WEBP", quality=88, method=6)
        print(f"{slug:22s} {os.path.getsize(path) // 1024:4d} KB")


if __name__ == "__main__":
    main()
