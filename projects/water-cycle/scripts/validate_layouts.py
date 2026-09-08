#!/usr/bin/env python3
"""Validate gemini's layout edits: only positional keys may change.

Compares layout/ vs layout_backup_preclean/ per block.
Allowed changed keys: x, y, width, height, max_width, size, anchor, rotate,
cx, cy, r (chart), and canvas-level height. Everything else must be identical.
"""
import json
import sys
from pathlib import Path

ALLOWED = {"x", "y", "width", "height", "max_width", "size", "anchor",
           "rotate", "cx", "cy", "r", "opacity"}
ROOT = Path(__file__).resolve().parent.parent
BACKUP = ROOT / "layout_backup_preclean"


def check_element(el_a, el_b, path, issues):
    if el_a["type"] != el_b["type"]:
        issues.append(f"{path}: 类型改变 {el_a['type']} -> {el_b['type']}")
        return
    for key in set(el_a) | set(el_b):
        va, vb = el_a.get(key), el_b.get(key)
        if va == vb:
            continue
        if key in ("box",):
            # box 内部只允许 padding/尺寸类字段变化，样式与配色不允许
            ba, bb = dict(va or {}), dict(vb or {})
            for k in set(ba) | set(bb):
                if ba.get(k) != bb.get(k) and k not in ("pad",):
                    issues.append(f"{path}.box.{k}: 被改动 {ba.get(k)} -> {bb.get(k)}")
            continue
        if key in ALLOWED:
            continue
        if key == "content":
            issues.append(f"{path}.content: 文案被改动！")
        else:
            issues.append(f"{path}.{key}: 被改动 {va} -> {vb}")


def main():
    all_ok = True
    for i in range(1, 8):
        pa = BACKUP / f"block{i}.json"
        pb = ROOT / "layout" / f"block{i}.json"
        a, b = json.loads(pa.read_text()), json.loads(pb.read_text())
        issues = []
        ea, eb = a["elements"], b["elements"]
        if len(ea) != len(eb):
            issues.append(f"元素数量改变 {len(ea)} -> {len(eb)}")
        else:
            for idx, (x, y) in enumerate(zip(ea, eb)):
                check_element(x, y, f"block{i}.elements[{idx}]", issues)
        if a["width"] != b["width"]:
            issues.append(f"画布宽度被改动 {a['width']} -> {b['width']}")
        state = "OK" if not issues else "FAIL"
        if issues:
            all_ok = False
        print(f"[{state}] block{i}")
        for msg in issues:
            print("   -", msg)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys_exit = main()
    sys.exit(sys_exit)
