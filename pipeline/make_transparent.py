#!/usr/bin/env python3
"""White -> transparent for line-art assets; also trims outer margins.

Usage: make_transparent.py assets/a.png assets/b.png ...
Skips files that already have real alpha. Crops to content bbox + pad.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def process(path: Path, pad=14) -> None:
    img = Image.open(path)
    img = img.convert("RGBA")
    a = np.array(img)
    if a[..., 3].min() < 250:
        print(f"[skip] {path.name}: already has alpha")
    else:
        lum = a[..., :3].mean(axis=2)
        # lum>=248 -> alpha 0 ; lum<=100 -> alpha 255 ; linear between
        alpha = np.clip((248.0 - lum) / (248.0 - 100.0) * 255.0, 0, 255)
        a[..., 3] = alpha.astype(np.uint8)
    ys, xs = np.where(a[..., 3] > 8)
    if len(xs) == 0:
        print(f"[warn] {path.name}: fully empty?")
        return
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, a.shape[1] - 1)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, a.shape[0] - 1)
    a = a[y0:y1 + 1, x0:x1 + 1]
    Image.fromarray(a).save(path)
    print(f"[ok] {path.name} -> {a.shape[1]}x{a.shape[0]} transparent")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        p = Path(arg)
        if p.exists():
            process(p)
        else:
            print(f"[miss] {arg}")
