#!/usr/bin/env python3
"""机检共用的真实几何：气泡 rect / tail 三角 / 画布墨迹蒙版 / 距离量算。

**存在的理由**：`check_clearance.py` 与 `check_occlusion.py` 曾经各自用
「字数 × 字号 × 0.62」的粗估框 + `line_height` 默认 1.05 自己算气泡矩形，
与 `compose.py` 真正画出来的矩形对不上 —— 渲染器用真实字体度量、真实折行、
真实 pad（主题 bubble.pad）与 tail 几何。于是机检既会漏报真实压盖，也会误报
不存在的问题（实测：官方范例里 890px 的真实压盖被报成 458px，且 tail 三角
的横坐标口径与渲染器不一致）。

本模块把口径收敛到一处：
  · 气泡 rect = `compose.block_geom()`（渲染器同一函数）
  · tail 三角 = 与 `compose.paint_box()` 逐点一致
  · 墨迹蒙版 = 让 `compose.draw_asset()` 自己画一遍（同一套缩放/flip/透明度/旋转）

这样 Python 线与 Canvas 线（`pipeline/canvas/lib/geom.mjs`）判定同一份 layout 时
得到同一批结论。
"""
import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

PIPE = Path(__file__).resolve().parent

# 墨迹判据（与 pipeline/canvas/lib/geom.mjs 的 INK_ALPHA / INK_LUMA 一致）
INK_ALPHA = 40
INK_LUMA = 235

TAIL_LEN = 26
TAIL_HALF = 16


def load_compose(root, hint_path):
    """把 compose.py 当模块加载，并把项目根指向 root。"""
    old = sys.argv[:]
    sys.argv = ["compose.py", str(hint_path)]
    spec = importlib.util.spec_from_file_location("compose_mod", PIPE / "compose.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.argv = old
    mod.ROOT = Path(root)
    mod.apply_theme(_read_theme(mod.ROOT))
    return mod


def _read_theme(root):
    import json
    p = Path(root) / "style.json"
    if p.is_file():
        try:
            return json.loads(p.read_text())
        except Exception:
            return {}
    return {}


def apply_theme(compose, layout):
    """layout 自带 theme 时优先（与 render.mjs / compose.render 同一优先级）。"""
    if layout.get("theme"):
        compose.apply_theme(layout["theme"])
    else:
        compose.apply_theme(_read_theme(compose.ROOT))


def measure_draw():
    """与 compose.render 一样，用一张 8x8 的假画布做度量。"""
    return ImageDraw.Draw(Image.new("RGB", (8, 8)))


def bubble_rect(compose, draw, el, W):
    """气泡/标签矩形（含 pad），与渲染器逐像素同口径。"""
    geo = compose.block_geom(draw, el, W)
    bh = len(geo["lines"]) * geo["lh"]
    return (geo["left"] - geo["px"], geo["top"] - geo["py"],
            geo["left"] + geo["w"] + geo["px"], geo["top"] + bh + geo["py"])


def _rotate(p, cx, cy, a):
    import math
    dx, dy = p[0] - cx, p[1] - cy
    ca, sa = math.cos(a), math.sin(a)
    return (cx + dx * ca - dy * sa, cy + dx * sa + dy * ca)


def bubble_quad(compose, draw, el, W):
    """气泡 + tail 的**真实**多边形（斜置元素按渲染器的方式绕文本中心旋转）。

    返回 (quad[4], tail[3]|None, center[2])。像素级机检必须用这个而不是旋转外接框：
    外接框的四角是气泡之外的空白，会把压盖面积与净空都算错。
    """
    geo = compose.block_geom(draw, el, W)
    bh = len(geo["lines"]) * geo["lh"]
    rect = (geo["left"] - geo["px"], geo["top"] - geo["py"],
            geo["left"] + geo["w"] + geo["px"], geo["top"] + bh + geo["py"])
    x0, y0, x1, y1 = rect
    quad = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    tail = tail_poly(compose, el, rect)
    cx, cy = geo["left"] + geo["w"] / 2, geo["top"] + bh / 2
    rot = el.get("rotate")
    if rot:
        import math
        a = math.radians(rot)
        quad = [_rotate(p, cx, cy, a) for p in quad]
        tail = [_rotate(p, cx, cy, a) for p in tail] if tail else None
    return quad, tail, (cx, cy)


def tail_poly(compose, el, rect):
    """tail 三角顶点（与 compose.paint_box 的几何逐点一致）；无 tail 返回 None。"""
    box = compose.el_box(el)
    tail = box.get("tail")
    if not tail:
        return None
    x0, y0, x1, y1 = rect
    th = box.get("tail_len", TAIL_LEN)
    cx = (x0 + x1) / 2
    if tail in ("bl", "bc", "br"):
        by, tip_y = y1 - 2, y1 + th
        if tail == "bl":
            return [(x0 + 12, by), (x0 + 44, by), (x0 + 2, tip_y)]
        if tail == "br":
            return [(x1 - 12, by), (x1 - 44, by), (x1 - 2, tip_y)]
        return [(cx - TAIL_HALF, by), (cx + TAIL_HALF, by), (cx, tip_y)]
    if tail in ("tl", "tc", "tr"):
        by, tip_y = y0 + 2, y0 - th
        if tail == "tl":
            return [(x0 + 12, by), (x0 + 44, by), (x0 + 2, tip_y)]
        if tail == "tr":
            return [(x1 - 12, by), (x1 - 44, by), (x1 - 2, tip_y)]
        return [(cx - TAIL_HALF, by), (cx + TAIL_HALF, by), (cx, tip_y)]
    if tail == "lc":
        cy = (y0 + y1) / 2
        return [(x0 + 2, cy - TAIL_HALF), (x0 + 2, cy + TAIL_HALF), (x0 - th, cy)]
    if tail == "rc":
        cy = (y0 + y1) / 2
        return [(x1 - 2, cy - TAIL_HALF), (x1 - 2, cy + TAIL_HALF), (x1 + th, cy)]
    return None


def canvas_ink_mask(compose, layout):
    """把 layout 里所有 asset 用**渲染器自己**画到一张透明画布上，取出墨迹蒙版。

    走 compose.draw_asset 的意义：缩放、flip、opacity、rotate、越界裁剪全部与
    最终成品像素一致；机检因此不会与渲染口径漂移。
    """
    W, H = layout["width"], layout["height"]
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for el in layout.get("elements", []):
        if el.get("type") != "asset":
            continue
        p = Path(compose.ROOT) / "assets" / el.get("file", "")
        if not p.is_file():
            continue
        compose.draw_asset(canvas, el, allow_missing=True)
    a = np.array(canvas)
    alpha = a[..., 3]
    lum = a[..., :3].astype(np.float32).mean(axis=2)
    return (alpha > INK_ALPHA) & (lum < INK_LUMA)


def poly_mask(poly, W, H):
    m = Image.new("1", (W, H), 0)
    ImageDraw.Draw(m).polygon([tuple(map(float, p)) for p in poly], fill=1)
    return np.array(m, dtype=bool)


def poly_ink_count(mask, poly):
    """多边形覆盖到的墨迹像素数。"""
    H, W = mask.shape
    return int((poly_mask(poly, W, H) & mask).sum())


def poly_gap(mask, ys, xs, poly):
    """多边形到最近墨迹的距离：先判相交（0），再沿边按 1px 采样取最小。"""
    if len(xs) == 0:
        return float("inf")
    if poly_ink_count(mask, poly) > 0:
        return 0.0
    n = len(poly)
    best = float("inf")
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        steps = max(1, int(np.ceil(np.hypot(bx - ax, by - ay))))
        t = np.linspace(0.0, 1.0, steps + 1)
        px = ax + (bx - ax) * t
        py = ay + (by - ay) * t
        d = np.sqrt((xs[None, :] - px[:, None]) ** 2 + (ys[None, :] - py[:, None]) ** 2).min()
        best = min(best, float(d))
        if best == 0:
            return 0.0
    return best


def rect_slice(mask, rect):
    """rect 覆盖的墨迹像素数（自动裁到画布内）。"""
    H, W = mask.shape
    x0 = max(0, int(np.floor(rect[0])))
    y0 = max(0, int(np.floor(rect[1])))
    x1 = min(W, int(np.ceil(rect[2])))
    y1 = min(H, int(np.ceil(rect[3])))
    if x1 <= x0 or y1 <= y0:
        return 0
    return int(mask[y0:y1, x0:x1].sum())


def ink_points(mask):
    """墨迹像素坐标（ys, xs），供距离量算复用。"""
    ys, xs = np.where(mask)
    return ys, xs


def dist_to_points(ys, xs, px, py):
    """点 (px,py) 到最近墨迹的距离；没有墨迹时返回 inf。"""
    if len(xs) == 0:
        return float("inf")
    d = np.sqrt((xs - px) ** 2 + (ys - py) ** 2)
    return float(d.min())


def rect_gap(ys, xs, rect):
    """矩形到最近墨迹的欧氏距离（矩形内无墨迹时 > 0）。"""
    if len(xs) == 0:
        return float("inf")
    x0, y0, x1, y1 = rect
    dx = np.maximum(np.maximum(x0 - xs, xs - x1), 0)
    dy = np.maximum(np.maximum(y0 - ys, ys - y1), 0)
    return float(np.sqrt(dx * dx + dy * dy).min())
