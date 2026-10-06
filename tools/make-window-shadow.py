#!/usr/bin/python3
"""Build assets/window-shadow.png: Windows 11's window shadow as a nine-slice image.

Measured on the reference machine (a Settings window over a plain desktop,
alpha = 1 - shot / desktop):

  beside the window  0.161 at the edge, 0.129 at 4px, 0.098 at 8, 0.074 at 12,
                     0.050 at 16, 0.025 at 24, 0.008 at 32, 0.004 at 40, 0 at 48
  above it           about 0.62 of that: 0.10 at the edge, 0.06 at 7px
  below it           0.298 at the edge, 0.276 at 4, 0.260 at 8, 0.232 at 12,
                     0.212 at 16, 0.200 at 18 — the measurement ends there, at
                     the taskbar; past it the long part fades out by about 80px

The shadow starts under the window's outermost pixel, which is its
translucent edge (lib/windowFrames.js), as on Windows. Corners are rounded
at 8px and blend the two sides that meet there by angle.

lib/windowFrames.js slices it with the margins printed at the end (spec.js,
WINDOW_FRAME.shadowSlices); rerun this after changing a profile.
"""
import math
from pathlib import Path

from PIL import Image

SIDE = [(0, 0.161), (4, 0.129), (8, 0.098), (12, 0.074), (16, 0.050), (24, 0.025),
        (32, 0.008), (40, 0.004), (48, 0.0)]
TOP_RATIO = 0.62
BOTTOM = [(0, 0.298), (4, 0.276), (8, 0.260), (12, 0.232), (16, 0.212), (18, 0.200)]
BOTTOM_FADE = 30.0   # Gaussian width of the unmeasured tail past 18px
RADIUS = 8
MARGIN = {'left': 48, 'right': 48, 'top': 32, 'bottom': 80}
HOLE = 22            # the window's own square in the image


def interpolate(points, d):
    if d <= points[0][0]:
        return points[0][1]
    for (d0, a0), (d1, a1) in zip(points, points[1:]):
        if d <= d1:
            return a0 + (a1 - a0) * (d - d0) / (d1 - d0)
    return points[-1][1]


def side(d):
    return interpolate(SIDE, d)


def top(d):
    return TOP_RATIO * side(d)


def bottom(d):
    if d <= BOTTOM[-1][0]:
        return interpolate(BOTTOM, d)
    # The ambient part goes as the sides do; the long part fades out.
    long_part = BOTTOM[-1][1] - side(BOTTOM[-1][0])
    return side(d) + long_part * math.exp(-((d - BOTTOM[-1][0]) / BOTTOM_FADE) ** 2)


def main():
    width = MARGIN['left'] + HOLE + MARGIN['right']
    height = MARGIN['top'] + HOLE + MARGIN['bottom']
    # The window, one pixel in: the shadow runs under its edge.
    x0, y0 = MARGIN['left'] + 1, MARGIN['top'] + 1
    x1, y1 = MARGIN['left'] + HOLE - 1, MARGIN['top'] + HOLE - 1
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    pixels = image.load()
    r = RADIUS - 1
    for y in range(height):
        for x in range(width):
            px, py = x + 0.5, y + 0.5
            # Distance outside the rounded rectangle, and which way.
            cx = min(max(px, x0 + r), x1 - r)
            cy = min(max(py, y0 + r), y1 - r)
            dx, dy = px - cx, py - cy
            d = math.hypot(dx, dy) - r
            if d <= 0:
                continue
            # Blend the sides meeting at a corner by the angle round it.
            horizontal = abs(dx) / (abs(dx) + abs(dy)) if dx or dy else 0
            vertical = 1 - horizontal
            along_y = bottom(d) if dy > 0 else top(d)
            alpha = horizontal * side(d) + vertical * along_y
            pixels[x, y] = (0, 0, 0, round(max(0.0, min(1.0, alpha)) * 255))
    out = Path(__file__).resolve().parent.parent / 'assets' / 'window-shadow.png'
    image.save(out)
    # Each corner slice holds the whole rounded corner; the middle is 2px.
    inner = HOLE // 2 - 1
    slices = (MARGIN['top'] + inner, MARGIN['right'] + inner,
              MARGIN['bottom'] + inner, MARGIN['left'] + inner)
    print(f'{out}: {width}x{height}; border-image slices (top right bottom left): {slices}; '
          f'margins {MARGIN}')


if __name__ == '__main__':
    main()
