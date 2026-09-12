#!/usr/bin/env python3
"""严格净空机检（画布像素口径）：气泡 rect + tail 三角 vs 素材墨迹。

与 check_occlusion.py 的区别：本脚本在**画布坐标系**里算真实距离，并把
tail 三角按 compose 的真实几何投出来，报告每个气泡的
  · 压盖画布像素数（应为 0）
  · tail 尖端到最近墨迹的画布像素距离
  · 气泡 rect 底/顶到最近墨迹的画布像素距离
凡 <40px 一律列出（红线：气泡与主体轮廓保留 ≥40px 纯净负空间）。
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
try:
    from roots import find_root
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from roots import find_root
from PIL import Image

MIN_GAP = 40
TAIL_LEN = 26
TAIL_HALF = 16


def load_ink(block_path: Path) -> np.ndarray:
    """把所有 asset 的墨迹按 layout 坐标投到一张画布同尺寸的 bool 蒙版上。"""
    root = find_root(block_path)        # 项目根从被操作的 layout 上溯推断
    data = json.loads(block_path.read_text())
    W, H = data["width"], data["height"]
    mask = np.zeros((H, W), dtype=bool)
    for el in data["elements"]:
        if el.get("type") != "asset":
            continue
        p = root / "assets" / el["file"]
        if not p.is_file():
            continue
        im = Image.open(p).convert("RGBA")
        a = np.array(im)
        ink = a[..., 3] > 24
        ih, iw = ink.shape
        w = el.get("width")
        h = el.get("height")
        if h is not None:
            w = iw * h / ih
        elif w is not None:
            h = ih * w / iw
        else:
            w, h = iw, ih
        x, y = el.get("x", 0), el.get("y", 0)
        anchor = el.get("anchor", "cc")
        left = x - w / 2 if anchor[0] == "c" else (x - w if anchor[0] == "r" else x)
        top = y - h / 2 if anchor[1] == "c" else (y - h if anchor[1] == "b" else y)
        # 缩放到画布尺寸
        yi = np.clip((np.arange(int(round(h))) * ih / h).astype(int), 0, ih - 1)
        xi = np.clip((np.arange(int(round(w))) * iw / w).astype(int), 0, iw - 1)
        small = ink[np.ix_(yi, xi)]
        y0, x0 = int(round(top)), int(round(left))
        ys, xs = np.where(small)
        ys = np.clip(ys + y0, 0, H - 1)
        xs = np.clip(xs + x0, 0, W - 1)
        mask[ys, xs] = True
    return mask


def tail_poly(el):
    box = el.get("box") or {}
    style = box.get("style")
    if style not in ("fill", "outline", "sketch", "burst", "ink"):
        return None
    d = box.get("tail")
    if not d:
        return None
    lines = el["content"].count("\n") + 1
    size = el.get("size", 40)
    lh = el.get("line_height", 1.05)
    width = min(el.get("max_width", 940), max(size * 1.2, len(el["content"]) * size * 0.62))
    pad = box.get("pad", [0, 0])
    py, px = (pad[0], pad[1]) if isinstance(pad, list) else (pad, pad)
    x, y = el.get("x", 0), el.get("y", 0)
    align = el.get("align", "center")
    left = x - width / 2 if align == "center" else (x if align == "left" else x - width)
    L, T = left - px, y - py
    R, B = left + width + px, y + lines * size * lh + py
    cx = {"l": L + (R - L) * 0.25, "c": (L + R) / 2, "r": L + (R - L) * 0.75}[d[1]]
    if d[0] == "b":
        return [(cx - TAIL_HALF, B), (cx + TAIL_HALF, B), (cx, B + TAIL_LEN)]
    return [(cx - TAIL_HALF, T), (cx + TAIL_HALF, T), (cx, T - TAIL_LEN)]


def poly_mask(poly, W, H):
    m = Image.new("1", (W, H), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(m).polygon([tuple(map(float, p)) for p in poly], fill=1)
    return np.array(m, dtype=bool)


def rect_of(el):
    box = el.get("box") or {}
    lines = el["content"].count("\n") + 1
    size = el.get("size", 40)
    lh = el.get("line_height", 1.05)
    width = min(el.get("max_width", 940), max(size * 1.2, len(el["content"]) * size * 0.62))
    pad = box.get("pad", [0, 0])
    py, px = (pad[0], pad[1]) if isinstance(pad, list) else (pad, pad)
    x, y = el.get("x", 0), el.get("y", 0)
    align = el.get("align", "center")
    left = x - width / 2 if align == "center" else (x if align == "left" else x - width)
    return left - px, y - py, left + width + px, y + lines * size * lh + py


def main():
    bad = 0
    for path in sys.argv[1:]:
        p = Path(path)
        data = json.loads(p.read_text())
        W, H = data["width"], data["height"]
        ink = load_ink(p)
        print(f"\n=== {p} ===")
        for i, el in enumerate(data["elements"]):
            if el.get("type") != "text" or not el.get("box"):
                continue
            L, T, R, B = rect_of(el)
            L2, T2 = max(0, int(L)), max(0, int(T))
            R2, B2 = min(W, int(math.ceil(R))), min(H, int(math.ceil(B)))
            sub = ink[T2:B2, L2:R2]
            cover = int(sub.sum())
            tp = tail_poly(el)
            tcover = 0
            tip_gap = None
            if tp:
                tm = poly_mask(tp, W, H)
                tcover = int((tm & ink).sum())
                tipx, tipy = tp[2]
                ys, xs = np.where(ink)
                if len(xs):
                    d = np.sqrt((xs - tipx) ** 2 + (ys - tipy) ** 2)
                    tip_gap = float(d.min())
            # rect 到墨迹的最近距离
            ys, xs = np.where(ink)
            rect_gap = None
            if len(xs):
                dx = np.maximum(np.maximum(L - xs, xs - R), 0)
                dy = np.maximum(np.maximum(T - ys, ys - B), 0)
                rect_gap = float(np.sqrt(dx * dx + dy * dy).min())
            label = el["content"].replace("\n", " ")[:16]
            flags = []
            if cover or tcover:
                flags.append(f"压盖 rect={cover}px tail={tcover}px")
            if tip_gap is not None and tip_gap < MIN_GAP:
                flags.append(f"tail尖净空={tip_gap:.0f}px")
            if rect_gap is not None and rect_gap < MIN_GAP:
                flags.append(f"rect净空={rect_gap:.0f}px")
            if flags:
                print(f"  [{i}] 「{label}」 " + "  ".join(flags))
                bad += 1
            else:
                print(f"  [{i}] 「{label}」 净空 OK (rect {rect_gap:.0f}px"
                      + (f", tail尖 {tip_gap:.0f}px)" if tip_gap is not None else ")"))
    print(f"\n[clearance] 净空不足/压盖的元素 = {bad} 个")
    return 0


if __name__ == "__main__":
    sys.exit(main())
