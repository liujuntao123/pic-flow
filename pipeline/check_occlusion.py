#!/usr/bin/env python3
"""气泡/文字与素材墨迹的遮挡与净空机检（像素级）。

用法：python3 check_occlusion.py layout/block1.json [...]

对每个带 box 的文字元素（气泡/印章/横幅），把它（含 tail 三角）投到素材像素坐标，
统计与素材墨迹（alpha>0 且亮度<235）的：
  · 压盖面积 px
  · 到最近墨迹的净空距离 px（用形态学膨胀二分求最小净空）
"""
import json
import math
import sys
from pathlib import Path

try:
    from roots import find_root
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from roots import find_root
from PIL import Image, ImageDraw, ImageFilter

ROOT = None   # 每个 layout 各自用 find_root() 推断项目根
BLOCK_MIN_GAP = 40      # 气泡与墨迹的最小净空
TAIL_LEN = 26


def text_box(el, draw_mod):
    content = el["content"]
    size = el.get("size", 40)
    family = el.get("font", "body")
    bold = el.get("bold", False)
    # 用近似度量：中文全角 ≈ size，ASCII ≈ size*0.55
    lines = content.split("\n")
    widths = []
    for ln in lines:
        w = 0.0
        for ch in ln:
            if ch in "【】〖〗『』":
                continue
            w += size * (0.55 if ord(ch) < 128 else 1.0)
        widths.append(w)
    w = max(widths) if widths else 0
    lh = size * el.get("line_height", 1.5)
    h = lh * len(lines)
    pad = el.get("box", {}).get("pad", [0, 0])
    px, py = (pad[1], pad[0]) if isinstance(pad, list) else (pad, pad)
    align = el.get("align", "center")
    x, y = el.get("x", 0), el.get("y", 0)
    left = x - w / 2 - px if align == "center" else (x - px if align == "left" else x - w - px)
    return left, y - py, left + w + 2 * px, y + h + py


def tail_tri(el, box):
    tail = el.get("box", {}).get("tail")
    if not tail:
        return None
    x0, y0, x1, y1 = box
    cx = (x0 + x1) / 2
    th = el["box"].get("tail_len", TAIL_LEN)
    if tail == "bc":
        return [(cx - 16, y1), (cx + 16, y1), (cx, y1 + th)]
    if tail == "tc":
        return [(cx - 16, y0), (cx + 16, y0), (cx, y0 - th)]
    if tail == "bl":
        return [(x0 + 12, y1), (x0 + 44, y1), (x0 + 2, y1 + th)]
    if tail == "br":
        return [(x1 - 12, y1), (x1 - 44, y1), (x1 - 2, y1 + th)]
    if tail == "tl":
        return [(x0 + 12, y0), (x0 + 44, y0), (x0 + 2, y0 - th)]
    if tail == "tr":
        return [(x1 - 12, y0), (x1 - 44, y0), (x1 - 2, y0 - th)]
    if tail == "lc":
        cy = (y0 + y1) / 2
        return [(x0, cy - 16), (x0, cy + 16), (x0 - th, cy)]
    return [(x1, (y0 + y1) / 2 - 16), (x1, (y0 + y1) / 2 + 16), (x1 + th, (y0 + y1) / 2)]


def ink_mask(img):
    rgba = img.convert("RGBA")
    a = rgba.getchannel("A")
    lum = rgba.convert("L")
    ink = Image.new("L", img.size, 0)
    ip, ap, lp = ink.load(), a.load(), lum.load()
    for y in range(img.height):
        for x in range(img.width):
            if ap[x, y] > 40 and lp[x, y] < 235:
                ip[x, y] = 255
    return ink


def min_gap(mask, region, limit=90):
    """返回 region 与墨迹的最小净空（px）；重叠返回 -1。"""
    x0, y0, x1, y1 = [int(v) for v in region]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(mask.width, x1), min(mask.height, y1)
    if x1 <= x0 or y1 <= y0:
        return 999
    crop = mask.crop((x0 - limit, y0 - limit, x1 + limit, y1 + limit))
    box = (limit, limit, limit + (x1 - x0), limit + (y1 - y0))
    for r in range(1, limit, 2):
        d = crop.filter(ImageFilter.MaxFilter(2 * r + 1))
        if d.crop(box).getextrema()[1] > 0:
            return max(0, r - 1)
    return 999


def main(paths):
    global ROOT
    bad = 0
    for path in paths:
        ROOT = find_root(path)          # 项目根从被操作的 layout 上溯推断
        d = json.loads(Path(path).read_text())
        W, H = d["width"], d["height"]
        assets = []
        for el in d["elements"]:
            if el["type"] != "asset":
                continue
            p = ROOT / "assets" / el["file"]
            img = Image.open(p).convert("RGBA")
            if "height" in el:
                s = el["height"] / img.height
            else:
                s = el["width"] / img.width
            img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
            if el.get("flip"):
                img = img.transpose(Image.FLIP_LEFT_RIGHT)
            px = round(el["x"] - img.width / 2)
            py = round(el["y"] - img.height / 2)
            assets.append((img, px, py, ink_mask(img)))
        print(f"\n=== {path} ===")
        for i, el in enumerate(d["elements"]):
            if el["type"] != "text" or not el.get("box"):
                continue
            box = text_box(el, None)
            polys = [box]
            t = tail_tri(el, box)
            if t:
                polys.append((min(p[0] for p in t), min(p[1] for p in t),
                              max(p[0] for p in t), max(p[1] for p in t)))
            label = el["content"].replace("\n", " ")[:14]
            hits = []
            for img, px, py, mask in assets:
                for bx in polys:
                    lx0, ly0, lx1, ly1 = bx[0] - px, bx[1] - py, bx[2] - px, bx[3] - py
                    gx0, gy0 = max(0, int(lx0)), max(0, int(ly0))
                    gx1, gy1 = min(mask.width, int(math.ceil(lx1))), min(mask.height, int(math.ceil(ly1)))
                    if gx1 <= gx0 or gy1 <= gy0:
                        continue
                    sub = mask.crop((gx0, gy0, gx1, gy1))
                    over = sum(1 for v in sub.getdata() if v)
                    gap = min_gap(mask, (lx0, ly0, lx1, ly1))
                    hits.append((over, gap))
            if not hits:
                print(f"  [{i}] 「{label}」 未与素材相交")
                continue
            over = max(h[0] for h in hits)
            gap = min(h[1] for h in hits)
            flags = []
            if over > 120:
                flags.append(f"压盖 {over}px !!")
                bad += 1
            elif over > 0:
                flags.append(f"擦到墨迹 {over}px")
            if gap < BLOCK_MIN_GAP:
                flags.append(f"净空 {gap}px (<{BLOCK_MIN_GAP})")
            print(f"  [{i}] 「{label}」 压盖={over}px 净空={gap}px  {' '.join(flags)}")
    print(f"\n[occlusion] 压盖硬伤 = {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
