#!/usr/bin/env python3
"""把「精灵图（sprite sheet）」按格切分成一张张独立素材。

一次生图产出 N 张配图：模型被要求把 N 个互不相干的插图排在 cols×rows 的网格里，
格与格之间留出宽阔纯白间隙。本脚本负责把它切回 N 张独立 PNG。

切分算法（不依赖模型严格居中）：
1. 算全图 ink mask（非白像素）。单元格边界不再用「宽/cols」硬切，
   而是**吸附到最近的整条纯白行/列带**（允许 ±SEARCH 像素漂移），
   保证任何墨迹都不会被一刀两断。
2. 每格内再按 ink bbox 收紧裁边（外扩 PAD），得到干净素材。
3. 若某格 bbox 贴到该格边界，判定为「溢格/串格」并告警——该 sheet 需要重生成。

用法：
    python3 scripts/slice_sheet.py sheets/sheetA.png --cols 2 --rows 2 \
        --names a1_shangyang,a2_xiaogong,a3_gongshu,a4_weihui --outdir assets [--debug]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

WHITE = 246.0      # >= 视为纯白
INK = 225.0        # <= 视为有墨/内容
SEARCH = 90        # 边界吸附搜索半径（px）
PAD = 12           # 裁边外扩


def ink_mask(arr: np.ndarray) -> np.ndarray:
    """True = 有内容。同时考虑 alpha（上游直出透明底的情况）。"""
    if arr.shape[2] == 4 and arr[..., 3].min() < 250:
        return arr[..., 3] > 24
    lum = arr[..., :3].astype(np.float32).mean(axis=2)
    return lum < INK


def snap_boundaries(white_lines: np.ndarray, expected: int, lo: int, hi: int) -> int:
    """把理论边界 expected 吸附到最近的「全白带」中心；找不到就退回 expected。"""
    win_lo, win_hi = max(lo, expected - SEARCH), min(hi, expected + SEARCH)
    band = white_lines[win_lo:win_hi]
    if not band.any():
        return expected
    # 找包含/最接近 expected 的那一段连续白带
    idx = np.where(band)[0] + win_lo
    # 按连续段分组
    groups, cur = [], [idx[0]]
    for v in idx[1:]:
        if v == cur[-1] + 1:
            cur.append(v)
        else:
            groups.append(cur)
            cur = [v]
    groups.append(cur)
    best = min(groups, key=lambda g: 0 if g[0] <= expected <= g[-1] else min(abs(g[0] - expected), abs(g[-1] - expected)))
    return int(round((best[0] + best[-1]) / 2))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--cols", type=int, required=True)
    ap.add_argument("--rows", type=int, required=True)
    ap.add_argument("--names", required=True, help="逗号分隔，按行优先顺序")
    ap.add_argument("--outdir", default="assets")
    ap.add_argument("--debug", action="store_true", help="输出带切割线的调试图")
    a = ap.parse_args()

    names = [n.strip() for n in a.names.split(",") if n.strip()]
    if len(names) != a.cols * a.rows:
        print(f"[error] names={len(names)} 与 {a.cols}x{a.rows}={a.cols * a.rows} 不符", file=sys.stderr)
        return 2

    sheet_path = Path(a.sheet)
    img = Image.open(sheet_path).convert("RGBA")
    arr = np.array(img)
    W, H = img.size
    ink = ink_mask(arr)

    # 整条全白行/列（横切要找全白行，纵切要找全白列）
    white_rows = ~ink.any(axis=1)
    white_cols = ~ink.any(axis=0)

    xs = [0]
    for i in range(1, a.cols):
        xs.append(snap_boundaries(white_cols, int(W * i / a.cols), xs[-1] + 20, W))
    xs.append(W)
    ys = [0]
    for i in range(1, a.rows):
        ys.append(snap_boundaries(white_rows, int(H * i / a.rows), ys[-1] + 20, H))
    ys.append(H)

    outdir = Path(a.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    report, problems = [], []
    dbg = img.copy()
    dr = ImageDraw.Draw(dbg)

    k = 0
    for r in range(a.rows):
        for c in range(a.cols):
            name = names[k]
            k += 1
            y0, y1, x0, x1 = ys[r], ys[r + 1], xs[c], xs[c + 1]
            sub = ink[y0:y1, x0:x1]
            dr.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 0, 0), width=3)
            if not sub.any():
                problems.append(f"{name}: 该格完全空白")
                report.append({"name": name, "status": "empty"})
                continue
            yy, xx = np.where(sub)
            by0, by1, bx0, bx1 = int(yy.min()), int(yy.max()), int(xx.min()), int(xx.max())
            cw, ch = x1 - x0, y1 - y0
            # 溢格判定：内容贴到格子边界（留 4px 容差）
            touch = []
            if bx0 <= 3:
                touch.append("left")
            if bx1 >= cw - 4:
                touch.append("right")
            if by0 <= 3:
                touch.append("top")
            if by1 >= ch - 4:
                touch.append("bottom")
            if touch:
                problems.append(f"{name}: 内容贴边({','.join(touch)})，疑似串格/溢格")

            gx0, gx1 = x0 + bx0, x0 + bx1
            gy0, gy1 = y0 + by0, y0 + by1
            gx0, gy0 = max(gx0 - PAD, 0), max(gy0 - PAD, 0)
            gx1, gy1 = min(gx1 + PAD, W - 1), min(gy1 + PAD, H - 1)
            crop = img.crop((gx0, gy0, gx1 + 1, gy1 + 1))
            out = outdir / f"{name}.png"
            crop.save(out)
            dr.rectangle([gx0, gy0, gx1, gy1], outline=(0, 140, 255), width=2)
            dr.text((x0 + 8, y0 + 6), name, fill=(200, 0, 0))
            report.append({"name": name, "status": "ok", "size": [crop.width, crop.height],
                           "cell": [cw, ch], "fill": round(float(sub.sum()) / (cw * ch), 3),
                           "touch": touch})
            print(f"[ok] {name}: {crop.width}x{crop.height} (格子 {cw}x{ch}, 墨迹占比 {report[-1]['fill']})")

    if a.debug:
        dpath = sheet_path.with_name(sheet_path.stem + "_slice_debug.png")
        dbg.save(dpath)
        print(f"[debug] {dpath}")

    (outdir / "_slice_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    if problems:
        print("[warn] " + "；".join(problems), file=sys.stderr)
        return 1
    print(f"[slice] {len(names)} 张全部干净切出 → {outdir}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
