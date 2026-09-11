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
    # 上游直出透明 PNG 时也常带一层极低 alpha 的"背景灰雾"（模型给主体铺的浅色
    # 底/地面wash）。它在线稿上肉眼几乎看不见，但排版时整块拼到纯白画布上就会
    # 显出一片灰色矩形，破坏"纯白底 + 素色线稿"的画卷感。这里统一把低 alpha
    # 的雾按阈值清掉，只保留真正的墨迹（暗色排线与墨块）。
    HAZE_LO, HAZE_HI = 100.0, 170.0
    al = a[..., 3].astype(np.float32)
    haze = (al > HAZE_LO) & (al < HAZE_HI)
    al[haze] = (al[haze] - HAZE_LO) / (HAZE_HI - HAZE_LO) * 255.0
    al[al <= HAZE_LO] = 0.0
    a[..., 3] = np.clip(al, 0, 255).astype(np.uint8)
    ys, xs = np.where(a[..., 3] > 8)
    if len(xs) == 0:
        print(f"[warn] {path.name}: fully empty?")
        return
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, a.shape[1] - 1)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, a.shape[0] - 1)
    a = a[y0:y1 + 1, x0:x1 + 1]
    a = _strip_light_edges(a)
    Image.fromarray(a).save(path)
    print(f"[ok] {path.name} -> {a.shape[1]}x{a.shape[0]} transparent")


def _strip_light_edges(a, lum_thr=205.0, max_strip=60):
    """剥掉紧贴内容外框的浅色残留带（模型给地面/水面的浅灰 wash）。

    这类像素 alpha 已经是不透明的 255，alpha 阈值清不掉，拼进白底画布后会在
    素材下缘露出一道灰条。安全前提：真正的墨迹是暗的，所以只从外向内收缩，
    一旦碰到有实际墨色的行/列就停——主体内部的浅灰填充（素色深衣之类）不受影响。
    """
    lum = a[..., :3].mean(axis=2)
    ink = (a[..., 3] > 8) & (lum < lum_thr)

    def trim(lo, hi, axis):
        for _ in range(max_strip):
            if hi - lo < 8:
                break
            edge = ink[lo, :] if axis == 0 else ink[:, lo]
            if edge.mean() > 0.02:  # 这一行/列已经有墨迹，停止
                break
            lo += 1
        for _ in range(max_strip):
            if hi - lo < 8:
                break
            edge = ink[hi, :] if axis == 0 else ink[:, hi]
            if edge.mean() > 0.02:
                break
            hi -= 1
        return lo, hi

    y0, y1 = trim(0, a.shape[0] - 1, 0)
    x0, x1 = trim(0, a.shape[1] - 1, 1)
    return a[y0:y1 + 1, x0:x1 + 1]


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        p = Path(arg)
        if p.exists():
            process(p)
        else:
            print(f"[miss] {arg}")
