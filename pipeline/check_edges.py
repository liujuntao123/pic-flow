#!/usr/bin/env python3
"""「边界感」机检：量化插图是不是一块贴上去的方图。

思路：把素材裁到内容 bbox，然后看**四条边各自最外侧一条窄带**里有没有连续墨迹。
- 真正的"方图"：边缘有平直的收口线（背景墙、地面线、帷帐边），四边覆盖率都高；
- 融进白底的插画：墨迹在边缘稀疏、断续、由密到疏自然消散，覆盖率低。

指标：
  cov_*        每条边外侧窄带里"有墨的位置"占该边长度的比例（1.0 = 一整条平直边）
  hard_edges   覆盖率 > 0.65 的边数（0~4，越低越没有方框感）
  edge_ink     四条外侧窄带内的墨迹占全部墨迹的比例（越低说明墨越往中间聚）
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

BAND = 0.04       # 外侧窄带 = bbox 短边的 4%
MIN_BAND = 6
HARD = 0.65


def measure(path: Path):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    ink = a[..., 3] > 24
    ys, xs = np.where(ink)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = x1 - x0 + 1, y1 - y0 + 1
    k = max(MIN_BAND, int(round(min(w, h) * BAND)))
    k = min(k, max(1, h // 3), max(1, w // 3))
    sub = ink[y0:y1 + 1, x0:x1 + 1]
    total = sub.sum()

    def cov(band, axis):
        # band: 2D；axis=0 表示沿列看（上下边），axis=1 表示沿行看（左右边）
        return float(band.any(axis=axis).mean())

    top = cov(sub[:k, :], 0)
    bot = cov(sub[-k:, :], 0)
    left = cov(sub[:, :k], 1)
    right = cov(sub[:, -k:], 1)
    ring = int(sub[:k, :].sum() + sub[-k:, :].sum() + sub[:, :k].sum() + sub[:, -k:].sum())
    hard = sum(1 for c in (top, bot, left, right) if c > HARD)
    return dict(name=path.stem, size=(w, h), cov_top=top, cov_bottom=bot,
                cov_left=left, cov_right=right, hard_edges=hard,
                edge_ink=ring / max(1, total * 2))


def main():
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        print(__doc__)
        return 2
    rows = [r for r in (measure(p) for p in paths) if r]
    if not rows:
        print("[error] 没有可测量的素材（文件不存在或全透明）", file=sys.stderr)
        return 2
    rows.sort(key=lambda r: -r["hard_edges"])
    print(f"{'素材':26s} {'尺寸':>10s} {'上':>5s} {'下':>5s} {'左':>5s} {'右':>5s} {'硬边':>4s} {'边缘墨':>6s}")
    for r in rows:
        print(f"{r['name']:26s} {r['size'][0]:4d}x{r['size'][1]:<5d} "
              f"{r['cov_top']:5.2f} {r['cov_bottom']:5.2f} {r['cov_left']:5.2f} {r['cov_right']:5.2f} "
              f"{r['hard_edges']:4d} {r['edge_ink']:6.1%}")
    n = len(rows)
    print(f"\n[{n} 张] 平均硬边数 {sum(r['hard_edges'] for r in rows)/n:.2f} / 4   "
          f"平均边缘墨迹占比 {sum(r['edge_ink'] for r in rows)/n:.1%}   "
          f"四边全硬的方图 {sum(1 for r in rows if r['hard_edges'] >= 3)} 张")
    return 0


if __name__ == "__main__":
    sys.exit(main())
