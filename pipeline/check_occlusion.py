#!/usr/bin/env python3
"""气泡/文字与素材墨迹的遮挡与净空机检（像素级）。

用法：python3 check_occlusion.py layout/block1.json [...]

对每个带 box 的文字元素（气泡/印章/横幅），把它（含 tail 三角，斜置时按真实
旋转四边形）投到画布墨迹蒙版上，统计：
  · 压盖面积 px（>120 判为硬伤）
  · 到最近墨迹的净空距离 px（<40 提示）

与 check_clearance.py 共用 `inkgeom`（= compose.py 渲染器的真实几何）：
气泡矩形来自真实字体度量与真实 pad，tail 与 paint_box 逐点一致，
墨迹蒙版由 compose.draw_asset 亲自画一遍（缩放/flip/透明度/旋转同口径）。
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

BLOCK_MIN_GAP = 40      # 气泡与墨迹的最小净空
HARD_OVERLAP = 120      # 压盖面积超过这个像素数判为硬伤


def main(paths):
    if not paths:
        print(__doc__)
        return 2
    bad = 0
    for path in paths:
        root = find_root(path)
        data = json.loads(Path(path).read_text())
        compose = inkgeom.load_compose(root, path)
        inkgeom.apply_theme(compose, data)
        mask = inkgeom.canvas_ink_mask(compose, data)
        ys, xs = inkgeom.ink_points(mask)
        draw = inkgeom.measure_draw()
        W = data["width"]
        any_asset = any(e.get("type") == "asset" for e in data.get("elements", []))
        print(f"\n=== {path} ===")
        for i, el in enumerate(data.get("elements", [])):
            if el.get("type") != "text" or not el.get("box"):
                continue
            quad, tri, _ = inkgeom.bubble_quad(compose, draw, el, W)
            over = inkgeom.poly_ink_count(mask, quad)
            gap = inkgeom.poly_gap(mask, ys, xs, quad)
            if tri:
                over += inkgeom.poly_ink_count(mask, tri)
                gap = min(gap, inkgeom.poly_gap(mask, ys, xs, tri))
            label = el.get("content", "").replace("\n", " ")[:14]
            if not any_asset:
                print(f"  [{i}] 「{label}」 未与素材相交")
                continue
            flags = []
            if over > HARD_OVERLAP:
                flags.append(f"压盖 {over}px !!")
                bad += 1
            elif over > 0:
                flags.append(f"擦到墨迹 {over}px")
            if gap < BLOCK_MIN_GAP:
                flags.append(f"净空 {gap:.0f}px (<{BLOCK_MIN_GAP})")
            print(f"  [{i}] 「{label}」 压盖={over}px 净空={gap:.0f}px  {' '.join(flags)}")
    print(f"\n[occlusion] 压盖硬伤 = {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
