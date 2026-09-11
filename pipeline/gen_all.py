#!/usr/bin/env python3
"""Batch-generate all assets in assets.json (parallel, resumable).

Usage: gen_all.py [--force] [--par N]
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from genlib import STYLE_SUFFIX, generate  # noqa: E402
from roots import find_root  # noqa: E402

# 项目根从当前工作目录推断（在项目里运行即为项目根）；
# 与旧版「脚本必须被复制进项目的 scripts/」不同，脚本可原地运行。
# 显式覆盖：环境变量 PICFLOW_ROOT。
ROOT = find_root(Path.cwd())


def main():
    force = "--force" in sys.argv
    par = int(os.environ.get("GEN_PAR", "4"))
    suffix = STYLE_SUFFIX
    style_path = ROOT / "style.json"
    if style_path.exists():
        try:
            sfx = json.loads(style_path.read_text()).get("asset_suffix")
            if sfx:
                suffix = sfx
        except Exception as e:
            print(f"[warn] style.json ignored: {e}", flush=True)
    items = json.loads((ROOT / "assets.json").read_text())
    todo = []
    for it in items:
        p = ROOT / "assets" / f"{it['name']}.png"
        if force or not p.exists() or p.stat().st_size < 2000:
            todo.append((it, p))
        else:
            print(f"[have] {it['name']}", flush=True)
    print(f"[gen_all] {len(todo)} to generate, par={par}", flush=True)
    ok = 0
    with ThreadPoolExecutor(max_workers=par) as ex:
        futs = {ex.submit(generate, it["prompt"] + suffix, it["size"], p): it["name"]
                for it, p in todo}
        for f in as_completed(futs):
            ok += 1 if f.result() else 0
    print(f"[gen_all] done: {ok}/{len(todo)} ok", flush=True)
    sys.exit(0 if ok == len(todo) else 1)


if __name__ == "__main__":
    main()
