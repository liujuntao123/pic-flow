#!/usr/bin/env python3
"""严格净空机检（画布像素口径）：气泡 rect + tail 三角 vs 素材墨迹。

与 check_occlusion.py 的区别：本脚本按**红线**口径逐项判定（压盖必须 0 px、
气泡与主体轮廓净空 ≥40px），任一不满足即非 0 退出。

几何全部来自 `inkgeom`（= compose.py 渲染器的真实几何），不再自己估算：
  · 气泡 rect —— compose.block_geom（真实字体折行 / 真实 pad / 真实行高）
  · tail 三角 —— 与 compose.paint_box 逐点一致
  · 墨迹蒙版 —— compose.draw_asset 亲自画一遍（缩放/flip/透明度/旋转同口径）

用法：python3 check_clearance.py layout/block1.json [...]
"""
import json
import sys
from pathlib import Path

try:
    from roots import find_root
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from roots import find_root

import inkgeom

MIN_GAP = 40


def check(path):
    root = find_root(path)
    data = json.loads(Path(path).read_text())
    compose = inkgeom.load_compose(root, path)
    inkgeom.apply_theme(compose, data)
    mask = inkgeom.canvas_ink_mask(compose, data)
    ys, xs = inkgeom.ink_points(mask)
    draw = inkgeom.measure_draw()
    W = data["width"]
    print(f"\n=== {path} ===")
    bad = 0
    for i, el in enumerate(data.get("elements", [])):
        if el.get("type") != "text" or not el.get("box"):
            continue
        # 真实旋转四边形 + 真实 tail（斜置气泡的外接框会把压盖/净空算错近一倍）
        quad, tri, _ = inkgeom.bubble_quad(compose, draw, el, W)
        cover = inkgeom.poly_ink_count(mask, quad)
        tail_cover = 0
        tip_gap = None
        if tri:
            tail_cover = inkgeom.poly_ink_count(mask, tri)
            tip_gap = inkgeom.dist_to_points(ys, xs, tri[2][0], tri[2][1])
        gap = inkgeom.poly_gap(mask, ys, xs, quad)
        if cover:
            gap = 0.0
        label = el.get("content", "").replace("\n", " ")[:16]
        flags = []
        if cover or tail_cover:
            flags.append(f"压盖 rect={cover}px tail={tail_cover}px")
        if tip_gap is not None and tip_gap < MIN_GAP:
            flags.append(f"tail尖净空={tip_gap:.0f}px")
        if gap < MIN_GAP:
            flags.append(f"rect净空={gap:.0f}px")
        if flags:
            print(f"  [{i}] 「{label}」 " + "  ".join(flags))
            bad += 1
        else:
            tail_txt = f", tail尖 {tip_gap:.0f}px" if tip_gap is not None else ""
            print(f"  [{i}] 「{label}」 净空 OK (rect {gap:.0f}px{tail_txt})")
    print(f"\n[clearance] 净空不足/压盖的元素 = {bad} 个")
    return bad


def main():
    paths = sys.argv[1:]
    if not paths:
        print(__doc__)
        return 2
    bad = sum(check(p) for p in paths)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
