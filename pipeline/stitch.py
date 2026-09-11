#!/usr/bin/env python3
"""Vertically stitch block images: stitch.py OUT.jpg in1.png [in2.png ...]"""
import argparse
import sys
from pathlib import Path

from PIL import Image


def main(argv=None):
    ap = argparse.ArgumentParser(description="Vertically stitch rendered pic-flow blocks")
    ap.add_argument("out", help="output JPG path")
    ap.add_argument("inputs", nargs="+", help="block PNG files in display order")
    args = ap.parse_args(argv)
    out = Path(args.out)
    ins = [Path(p) for p in args.inputs]
    missing = [str(p) for p in ins if not p.is_file()]
    if missing:
        ap.error("input file(s) not found: " + ", ".join(missing))
    try:
        imgs = [Image.open(p).convert("RGB") for p in ins]
    except Exception as e:
        ap.error(f"cannot read input image: {e}")
    widths = {i.width for i in imgs}
    if len(widths) > 1:
        print(f"[stitch][warn] block widths differ: {sorted(widths)}; centering narrower blocks", file=sys.stderr)
    w = max(i.width for i in imgs)
    h = sum(i.height for i in imgs)
    canvas = Image.new("RGB", (w, h), "#FFFFFF")
    y = 0
    for i in imgs:
        canvas.paste(i, ((w - i.width) // 2, y))
        y += i.height
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, quality=92)
    canvas.resize((550, round(canvas.height * 550 / w)), Image.LANCZOS).save(
        out.with_name(out.stem + "_preview.jpg"), quality=85)
    print(f"[stitch] {out} {w}x{h} from {len(ins)} blocks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
