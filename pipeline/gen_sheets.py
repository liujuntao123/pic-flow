#!/usr/bin/env python3
"""精灵图（sprite sheet）批量生图 + 自动切分：一次生图产出 N 张配图。

和 gen_all.py 的区别：gen_all 是「一条 prompt 一张图」，本脚本把 N 个互不相干的
插图写进同一张画稿的 N 个格子里，一次调用拿回 N 张素材 —— 省生图次数，且同一张
sheet 内所有配图天然共享同一套线条／墨色／比例，风格一致性比逐张生成好得多。

配制：`sheets.json`（见同目录 README「精灵图方案」）
    [{"sheet": "sheetA", "size": "2048x2048", "cols": 2, "rows": 2,
      "cells": [{"name": "a1_xxx", "prompt": "…"}, …]}]

产物：`sheets/<sheet>.png`（原图，留档复查）+ `assets/<name>.png`（切好的单张素材）

用法：
    python3 scripts/gen_sheets.py            # 断点续跑：已有素材的 sheet 直接跳过
    python3 scripts/gen_sheets.py --force    # 全部重来
    python3 scripts/gen_sheets.py --only sheetA
    GEN_PAR=2 python3 scripts/gen_sheets.py
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from genlib import STYLE_SUFFIX, generate  # noqa: E402
from roots import find_root  # noqa: E402

ROOT = find_root(Path.cwd())


def pos_label(i: int, cols: int, rows: int) -> str:
    """行优先第 i 格的中文方位名（左上／中上／右下…），写进 prompt 里定位。"""
    r, c = divmod(i, cols)
    col_lab = {1: [""], 2: ["左", "右"], 3: ["左", "中", "右"]}.get(cols, [str(k + 1) for k in range(cols)])[c]
    row_lab = {1: [""], 2: ["上", "下"], 3: ["上", "中", "下"]}.get(rows, [str(k + 1) for k in range(rows)])[r]
    return f"{row_lab}{col_lab}" or f"{i + 1}"


def expand(text: str, anchors: dict) -> str:
    """把 {SY} 这类锚点占位符替换成完整的特征描述。

    关键：同一个锚点在每个格子里被**逐字**展开。跨格/跨 sheet 的角色形象漂移，
    主要靠这种「一字不差的重复」压住 —— 模型看到的是同一段特征字符串。
    """
    for k, v in anchors.items():
        text = text.replace("{" + k + "}", v)
    return text


def build_prompt(sheet: dict, suffix: str, anchors: dict) -> str:
    cols, rows = sheet["cols"], sheet["rows"]
    n = cols * rows
    gut = "间隙宽度不小于半格宽度" if n > 2 else "间距宽阔"
    head = (
        f"一张包含 {n} 幅互不相干的插画的画稿，按 {cols} 列 {rows} 行排布。"
        f"{n} 幅插画大小相等，彼此之间留出宽阔的连续纯白间隙（{gut}），"
        f"绝对不接触、不重叠；画幅之间不画任何分割线、边框、网格线、文字或标号。\n"
        f"【每幅插画的画法（极其重要）】要像在速写本的空白页上随手画的一幅小画：\n"
        f"· 背景全部留白，只画人物与必不可少的少量道具，绝对不要画完整的房间、墙壁、墙角、"
        f"天花板、帷帐、屏风、柱子等包围式布景；\n"
        f"· 绝对不要画贯穿画面的地面线、地平线、地脚线、桌沿线——人物的脚与器物直接落在空白上；\n"
        f"· 画面四周的墨迹必须由密到疏自然消散：边缘只剩零星的线头、排线渐稀、留白渐多；"
        f"绝对不要出现连续的平直收口线、矩形边界、整块背景填充或边框；\n"
        f"· 构图要开放、不闭合，某一侧墨迹稀疏到几乎没有也可以，四边不必都有内容。"
    )
    body = [
        f"第{i + 1}格（{pos_label(i, cols, rows)}）：{expand(c['prompt'], anchors)}"
        for i, c in enumerate(sheet["cells"])
    ]
    return "\n".join([head, *body, suffix])


def load_suffix(override: str | None = None) -> str:
    if override:
        return override
    p = ROOT / "style.json"
    if p.exists():
        try:
            return json.loads(p.read_text()).get("asset_suffix") or STYLE_SUFFIX
        except Exception as e:
            print(f"[warn] style.json ignored: {e}", flush=True)
    return STYLE_SUFFIX


def run_sheet(sheet: dict, suffix: str, anchors: dict, force: bool) -> tuple[str, bool, str]:
    name = sheet["sheet"]
    cols, rows = sheet["cols"], sheet["rows"]
    cells = sheet["cells"]
    if len(cells) != cols * rows:
        return name, False, f"cells={len(cells)} 与 {cols}x{rows} 不符"
    names = [c["name"] for c in cells]
    assets = [ROOT / "assets" / f"{n}.png" for n in names]
    sheet_png = ROOT / "sheets" / f"{name}.png"

    if not force and all(p.exists() and p.stat().st_size > 2000 for p in assets):
        print(f"[have] {name}: {len(names)} 张素材已在，跳过", flush=True)
        return name, True, "skipped"

    if force or not sheet_png.exists() or sheet_png.stat().st_size < 2000:
        ok = generate(build_prompt(sheet, suffix, anchors), sheet["size"], sheet_png,
                      transparent=False, log=lambda m: print(f"  {m}", flush=True))
        if not ok:
            return name, False, "生图失败"
    else:
        print(f"[have] {name}: sheet 已在，只重切", flush=True)

    r = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "slice_sheet.py"), str(sheet_png),
         "--cols", str(cols), "--rows", str(rows), "--names", ",".join(names),
         "--outdir", str(ROOT / "assets"), "--debug"],
        capture_output=True, text=True,
    )
    sys.stdout.write(r.stdout)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        return name, False, f"切分告警/失败（exit {r.returncode}）"
    return name, True, "ok"


def main() -> int:
    force = "--force" in sys.argv
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
    par = max(1, int(os.environ.get("GEN_PAR", "2")))
    spec_path = ROOT / "sheets.json"
    if "--spec" in sys.argv:
        spec_path = Path(sys.argv[sys.argv.index("--spec") + 1])
    spec = json.loads(spec_path.read_text())
    suffix = load_suffix(spec.get("suffix") if isinstance(spec, dict) else None)
    if isinstance(spec, list):
        anchors, sheets = {}, spec
    else:
        anchors, sheets = spec.get("anchors", {}), spec["sheets"]
    if only:
        sheets = [s for s in sheets if s["sheet"] == only]
    (ROOT / "sheets").mkdir(exist_ok=True)
    print(f"[gen_sheets] spec={spec_path.name}  {len(sheets)} 张 sheet, par={par}", flush=True)

    results = []
    with ThreadPoolExecutor(max_workers=par) as ex:
        futs = {ex.submit(run_sheet, s, suffix, anchors, force): s["sheet"] for s in sheets}
        for f in as_completed(futs):
            try:
                results.append(f.result())
            except Exception as e:
                results.append((futs[f], False, f"{type(e).__name__}: {e}"))
    bad = [r for r in results if not r[1]]
    for n, ok, msg in sorted(results):
        print(f"[{'ok' if ok else 'FAIL'}] {n}: {msg}", flush=True)
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
