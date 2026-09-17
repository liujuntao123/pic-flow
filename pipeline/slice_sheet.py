#!/usr/bin/env python3
"""把「精灵图（sprite sheet）」按格切分成一张张独立素材。

一次生图产出 N 张配图：模型被要求把 N 个互不相干的插图排在 cols×rows 的网格里，
格与格之间留出宽阔纯白间隙。本模块负责把它切回 N 张独立 PNG。

切分算法（不依赖模型严格居中）：
1. 算全图 ink mask（非白像素）。单元格边界不再用「宽/cols」硬切，
   而是吸附到最近的整条纯白行/列带（允许 ±SEARCH 像素漂移），
   保证任何墨迹都不会被一刀两断。
2. 每格内再按 ink bbox 收紧裁边（外扩 PAD），得到干净素材。
3. 若某格 bbox 贴到该格边界，判定为「溢格/串格」并告警——该 sheet 需要重生成。

提供深模块接口 `slice_sheet(...)` 与独立 CLI 适配器。
"""
import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional, Union

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


def snap_boundaries(white_lines: np.ndarray, expected: int, lo: int, hi: int, search: int = SEARCH) -> int:
    """把理论边界 expected 吸附到最近的「全白带」中心；找不到就退回 expected。"""
    win_lo, win_hi = max(lo, expected - search), min(hi, expected + search)
    band = white_lines[win_lo:win_hi]
    if not band.any():
        return expected
    idx = np.where(band)[0] + win_lo
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


def slice_sheet(
    sheet_input: Union[str, Path, Image.Image],
    cols: int,
    rows: int,
    names: List[str],
    outdir: Union[str, Path] = "assets",
    debug: bool = False,
    pad: int = PAD,
    search: int = SEARCH,
) -> dict:
    """进程内深模块：把精灵图按网格切分为独立素材 PNG，返回结构化切分报告。

    :param sheet_input: 图像文件路径或已载入的 PIL Image
    :param cols: 列数
    :param rows: 行数
    :param names: 行优先素材名称列表
    :param outdir: 输出目标目录
    :param debug: 是否输出带切割线的调试图
    :param pad: 裁边外扩像素
    :param search: 边界吸附搜索半径
    :returns: {
        "ok": bool,
        "report": list[dict],
        "problems": list[str],
        "debug_path": Optional[Path],
    }
    """
    if len(names) != cols * rows:
        raise ValueError(f"names 数量 ({len(names)}) 与网格 {cols}x{rows}={cols * rows} 不符")

    sheet_path: Optional[Path] = None
    if isinstance(sheet_input, (str, Path)):
        sheet_path = Path(sheet_input).resolve()
        img = Image.open(sheet_path).convert("RGBA")
    elif isinstance(sheet_input, Image.Image):
        img = sheet_input.convert("RGBA")
    else:
        raise TypeError(f"不支持的 sheet_input 类型: {type(sheet_input)}")

    arr = np.array(img)
    W, H = img.size
    ink = ink_mask(arr)

    # 整条全白行/列（横切找全白行，纵切找全白列）
    white_rows = ~ink.any(axis=1)
    white_cols = ~ink.any(axis=0)

    xs = [0]
    for i in range(1, cols):
        xs.append(snap_boundaries(white_cols, int(W * i / cols), xs[-1] + 20, W, search=search))
    xs.append(W)

    ys = [0]
    for i in range(1, rows):
        ys.append(snap_boundaries(white_rows, int(H * i / rows), ys[-1] + 20, H, search=search))
    ys.append(H)

    out_path = Path(outdir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)

    report = []
    problems = []
    dbg = img.copy() if debug else None
    dr = ImageDraw.Draw(dbg) if dbg else None

    k = 0
    for r in range(rows):
        for c in range(cols):
            name = names[k]
            k += 1
            y0, y1, x0, x1 = ys[r], ys[r + 1], xs[c], xs[c + 1]
            sub = ink[y0:y1, x0:x1]
            if dr:
                dr.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 0, 0), width=3)
            if not sub.any():
                problems.append(f"{name}: 该格完全空白")
                report.append({"name": name, "status": "empty"})
                continue

            yy, xx = np.where(sub)
            by0, by1, bx0, bx1 = int(yy.min()), int(yy.max()), int(xx.min()), int(xx.max())
            cw, ch = x1 - x0, y1 - y0

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
            gx0, gy0 = max(gx0 - pad, 0), max(gy0 - pad, 0)
            gx1, gy1 = min(gx1 + pad, W - 1), min(gy1 + pad, H - 1)
            crop = img.crop((gx0, gy0, gx1 + 1, gy1 + 1))
            dest = out_path / f"{name}.png"
            crop.save(dest)

            if dr:
                dr.rectangle([gx0, gy0, gx1, gy1], outline=(0, 140, 255), width=2)
                dr.text((x0 + 8, y0 + 6), name, fill=(200, 0, 0))

            report.append({
                "name": name,
                "status": "ok",
                "size": [crop.width, crop.height],
                "cell": [cw, ch],
                "fill": round(float(sub.sum()) / (cw * ch), 3),
                "touch": touch,
            })

    debug_path = None
    if debug and dbg and sheet_path:
        debug_path = sheet_path.with_name(sheet_path.stem + "_slice_debug.png")
        dbg.save(debug_path)

    (out_path / "_slice_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    return {
        "ok": len(problems) == 0,
        "report": report,
        "problems": problems,
        "debug_path": debug_path,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="把精灵图切分为独立素材 PNG")
    ap.add_argument("sheet", help="精灵图路径")
    ap.add_argument("--cols", type=int, required=True, help="列数")
    ap.add_argument("--rows", type=int, required=True, help="行数")
    ap.add_argument("--names", required=True, help="逗号分隔，按行优先顺序")
    ap.add_argument("--outdir", default="assets", help="输出目录")
    ap.add_argument("--debug", action="store_true", help="输出带切割线的调试图")
    a = ap.parse_args()

    names = [n.strip() for n in a.names.split(",") if n.strip()]
    try:
        res = slice_sheet(a.sheet, a.cols, a.rows, names, a.outdir, debug=a.debug)
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr)
        return 2

    for item in res["report"]:
        if item.get("status") == "ok":
            print(f"[ok] {item['name']}: {item['size'][0]}x{item['size'][1]} (格子 {item['cell'][0]}x{item['cell'][1]}, 墨迹占比 {item['fill']})")

    if res["debug_path"]:
        print(f"[debug] {res['debug_path']}")

    if res["problems"]:
        print("[warn] " + "；".join(res["problems"]), file=sys.stderr)
        return 1

    print(f"[slice] {len(names)} 张全部干净切出 → {a.outdir}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
