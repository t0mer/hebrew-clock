#!/usr/bin/env python3
"""Bake sleeping.png into worker/assets/sleeping-night.png (380x280, RGBA).

Reproduces what clock.py:_generate_night_image does with the picture: black lines
become white, the mask is resized with LANCZOS and pasted through itself. Pasting
`result` through `mask` equals alpha-compositing a pixel with RGB = A = mask, so the
Worker can draw it as an ordinary <image> over the stars. Needs Pillow (dev only).
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sleeping.png"
OUT = ROOT / "worker" / "assets" / "sleeping-night.png"
SIZE = (380, 280)

sleeping = Image.open(SRC).convert("L")
mask = sleeping.point(lambda p: 255 if p < 128 else 0)
m = mask.resize(SIZE, Image.LANCZOS)
rgba = Image.merge("RGBA", (m, m, m, m))
OUT.parent.mkdir(parents=True, exist_ok=True)
rgba.save(OUT, optimize=True)
print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
