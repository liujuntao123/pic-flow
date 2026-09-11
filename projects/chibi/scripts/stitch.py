#!/usr/bin/env python3
"""Vertically stitch block images: stitch.py OUT.jpg in1.png [in2.png ...]"""
import sys
from pathlib import Path

from PIL import Image

out = Path(sys.argv[1])
ins = [Path(p) for p in sys.argv[2:]]
imgs = [Image.open(p).convert("RGB") for p in ins]
w = max(i.width for i in imgs)
h = sum(i.height for i in imgs)
canvas = Image.new("RGB", (w, h), "#FFFFFF")
y = 0
for i in imgs:
    canvas.paste(i, ((w - i.width) // 2, y))
    y += i.height
out.parent.mkdir(parents=True, exist_ok=True)
canvas.save(out, quality=92)
canvas.resize((550, round(canvas.height * 550 / w)), Image.LANCZOS).save(
    out.with_name(out.stem + "_preview.jpg"), quality=85)
print(f"[stitch] {out} {w}x{h} from {len(ins)} blocks")
