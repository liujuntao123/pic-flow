#!/usr/bin/env python3
"""排版几何机检：真实字体度量下的折行行数 / 行宽 / 孤字 / 越界 + 插图带高占比。

用法：python3 check_geom.py layout/block1.json [layout/block2.json ...]

`layout_lint.py` 用的是**估算框**（按字数 × 字号 × 0.62 估宽），够快但会在窄栏上漏判；
本脚本把 compose 的真实字体度量搬进来，逐行量出：
  · 实际折行行数（与显式 \\n 不一致 = 自动折行，要改文案或加宽栏）
  · 每行真实像素宽度是否超过 max_width
  · 是否出现孤字行（行尾只剩 1~2 个字）
  · 文字块底边是否越出画布
  · 每块插图带高占比（红线：≥55%）

这两道互补：`layout_lint` 快（碰撞/越界/居中滥用），`check_geom` 准（文字排版本身）。
"""
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

try:
    from roots import find_root
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from roots import find_root

PIPE = Path(__file__).resolve().parent      # skill 的 pipeline 目录（compose.py 就在旁边）

_compose = None
ROOT = None


def _init(paths):
    """用第一个 layout 推断项目根，并把 compose 当模块加载（它 import 时会读 style）。"""
    global _compose, ROOT
    ROOT = find_root(paths[0] if paths else None)
    old = sys.argv[:]
    sys.argv = ["compose.py", str(paths[0])]
    spec = importlib.util.spec_from_file_location("compose_mod", PIPE / "compose.py")
    _compose = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(_compose)
    sys.argv = old
    _compose.ROOT = ROOT
    theme = ROOT / "style.json"
    if theme.is_file():
        _compose.apply_theme(json.loads(theme.read_text()))


def width_of(ln, size, bold, family):
    d = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    w = 0
    for c, st in ln:
        fam, b, sz = _compose.char_metrics(family, bold, size, st)
        w += _compose.char_w(d, c, sz, b, fam)
    return w


def check(path):
    data = json.loads(Path(path).read_text())
    W, H = data["width"], data["height"]
    print(f"\n=== {path}  {W}x{H} ===")
    img_band = img_area = text_lines = 0
    problems = 0
    for i, el in enumerate(data["elements"]):
        if el["type"] == "asset":
            p = ROOT / "assets" / el["file"]
            if p.exists():
                iw, ih = Image.open(p).size
            else:
                iw, ih = 1024, 1024
                print(f"  [asset {i}] {el['file']} 缺失，按 1024x1024 估")
            w = el.get("width") or iw * el["height"] / ih
            h = el.get("height") or ih * w / iw
            img_band += h
            img_area += w * h
            print(f"  [asset {i}] {el['file']}  {w:.0f}x{h:.0f}  bands={h / H:.0%}")
        elif el["type"] == "text":
            d = ImageDraw.Draw(Image.new("RGB", (10, 10)))
            geo = _compose.block_geom(d, el, W)
            size, family = el.get("size", 40), el.get("font", "body")
            bold = el.get("bold", False)
            explicit = el["content"].count("\n") + 1
            lines = geo["lines"]
            text_lines += len(lines)
            widths = [width_of(ln, size, bold, family) for ln in lines]
            lh = geo["lh"]                     # 与渲染同一口径
            bottom = el["y"] + lh * len(lines)
            pad = _compose.el_box(el).get("pad", 0)
            py = pad if isinstance(pad, (int, float)) else pad[0]
            px = pad if isinstance(pad, (int, float)) else pad[1]
            flag = ""
            if len(lines) != explicit:
                flag += f"  << 自动折行 {explicit}->{len(lines)}（改文案或加宽 max_width）"
                problems += 1
            # 空行不算孤字行（显式 \n 留下的空行是作者有意为之）
            orph = ["".join(c for c, _ in ln) for ln in lines if 0 < len(ln) <= 2]
            if orph:
                flag += f"  孤字行:{orph}"
                problems += 1
            print(f"  [text {i}] size={size} lines={len(lines)} "
                  f"y {el['y']}->{bottom:.0f} maxw={max(widths):.0f} panew={max(widths) + 2 * px:.0f}{flag}")
            if bottom + py > H:
                print(f"      !! 越界 bottom={bottom + py:.0f} > {H}")
                problems += 1
            limit = el.get("max_width", 940)
            for k, (w_, ln) in enumerate(zip(widths, lines)):
                # 行尾悬挂标点（避头点）允许溢出一个字宽：只有扣掉它仍然超宽才算越界
                text = "".join(c for c, _ in ln)
                tail = len(text)
                while tail > 0 and text[tail - 1] in _compose.KINSOKU:
                    tail -= 1
                core = width_of(ln[:tail], size, bold, family) if tail else 0.0
                if core > limit + 1:
                    print(f"      !! line{k}: {w_:.0f}px > max_width {limit}  「{text}」")
                    problems += 1
    print(f"  插图带高占比 = {img_band / H:.0%}   插图墨迹面积占比 = {img_area / (W * H):.0%}   "
          f"文字总行数 = {text_lines}")
    if img_band / H < 0.55:
        print("  >> 插图带高不足 55%，考虑放大插图或压缩文字")
        problems += 1
    return problems


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    _init(args)
    total = sum(check(a) for a in args)
    print(f"\n[geom] 问题项 = {total}")
    # 与 lint / occlusion / clearance 同一口径：有问题就以非 0 退出
    sys.exit(1 if total else 0)
