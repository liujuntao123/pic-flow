#!/usr/bin/env python3
"""Validate that layout edits only touched positional fields.

用法：子代理/人工修改排版后，对比修改前备份与当前 layout：
  python3 validate_layouts.py --backup layout_backup_preclean
只允许 x/y/width/height/max_width/size/anchor/rotate/cx/cy/r/opacity 及画布
height 变化；文案、字体、颜色、box 样式、元素数量、画布宽度变化都会报 FAIL。
"""
import argparse
import json
import sys
from pathlib import Path

ALLOWED = {"x", "y", "width", "height", "max_width", "size", "anchor",
           "rotate", "cx", "cy", "r", "opacity"}


def check_element(el_a, el_b, path, issues):
    if el_a["type"] != el_b["type"]:
        issues.append(f"{path}: 类型改变 {el_a['type']} -> {el_b['type']}")
        return
    for key in set(el_a) | set(el_b):
        va, vb = el_a.get(key), el_b.get(key)
        if va == vb:
            continue
        if key == "box":
            ba, bb = dict(va or {}), dict(vb or {})
            for k in set(ba) | set(bb):
                if ba.get(k) != bb.get(k) and k != "pad":
                    issues.append(f"{path}.box.{k}: 样式被改动 {ba.get(k)} -> {bb.get(k)}")
            continue
        if key in ALLOWED:
            continue
        if key == "content":
            issues.append(f"{path}.content: 文案被改动！")
        else:
            issues.append(f"{path}.{key}: 被改动 {va} -> {vb}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backup", default="layout_backup_preclean",
                    help="修改前备份目录")
    ap.add_argument("--layout", default="layout", help="当前排版目录")
    args = ap.parse_args()
    backup = Path(args.backup)
    all_ok = True
    for pb in sorted(Path(args.layout).glob("block*.json")):
        pa = backup / pb.name
        if not pa.exists():
            print(f"[skip] {pb.name}: 备份中不存在")
            continue
        a, b = json.loads(pa.read_text()), json.loads(pb.read_text())
        issues = []
        ea, eb = a["elements"], b["elements"]
        if len(ea) != len(eb):
            issues.append(f"元素数量改变 {len(ea)} -> {len(eb)}")
        else:
            for idx, (x, y) in enumerate(zip(ea, eb)):
                check_element(x, y, f"{pb.name}.elements[{idx}]", issues)
        if a["width"] != b["width"]:
            issues.append(f"画布宽度被改动 {a['width']} -> {b['width']}")
        print(f"[{'OK' if not issues else 'FAIL'}] {pb.name}")
        for msg in issues:
            print("   -", msg)
            all_ok = False
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
