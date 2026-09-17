#!/usr/bin/env python3
"""Batch-generate all assets in assets.json (parallel, resumable).

Usage: gen_all.py [--force] [--par N]

并发安全：每个素材生图前原子认领 assets/<name>.png.lock（O_CREAT|O_EXCL），
多进程同时跑同一份 assets.json 也只会生成一份；后来者打 [busy] 跳过。
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from genlib import STYLE_SUFFIX, claim, generate, release  # noqa: E402
from roots import find_root  # noqa: E402

# 项目根从当前工作目录推断（在项目里运行即为项目根）；
# 与旧版「脚本必须被复制进项目的 scripts/」不同，脚本可原地运行。
# 显式覆盖：环境变量 PICFLOW_ROOT。
ROOT = find_root(Path.cwd())


def worker(it, path, suffix, force):
    """claim → 双检 → generate → release；返回 (ok, note)。"""
    lock = path.with_name(path.name + ".lock")
    if not claim(lock):
        return False, "busy"
    try:
        if not force and path.exists() and path.stat().st_size > 2000:
            return True, "have"  # 等锁期间另一进程刚完成
        ok = generate(it["prompt"] + suffix, it["size"], path)
        return ok, "ok" if ok else "gen-fail"
    finally:
        release(lock)


def main():
    force = "--force" in sys.argv
    try:
        par = max(1, int(os.environ.get("GEN_PAR", "4")))
    except ValueError:
        print("[error] GEN_PAR 必须是正整数", file=sys.stderr)
        return 2
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
    # 重名防护：同名素材会指向同一路径，并发线程互相覆盖并重复生图
    names = [it["name"] for it in items]
    dups = {n for n in names if names.count(n) > 1}
    if dups:
        print(f"[error] assets.json 存在重名素材: {sorted(dups)}", file=sys.stderr, flush=True)
        return 2
    todo = []
    for it in items:
        p = ROOT / "assets" / f"{it['name']}.png"
        if force or not p.exists() or p.stat().st_size < 2000:
            todo.append((it, p))
        else:
            print(f"[have] {it['name']}", flush=True)
    print(f"[gen_all] {len(todo)} to generate, par={par}", flush=True)
    ok = busy = 0
    with ThreadPoolExecutor(max_workers=par) as ex:
        futs = {ex.submit(worker, it, p, suffix, force): it["name"]
                for it, p in todo}
        for f in as_completed(futs):
            name = futs[f]
            try:
                good, note = f.result()
                ok += 1 if good else 0
                busy += 1 if note == "busy" else 0
            except Exception as e:
                print(f"[fail] {name}: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
    tail = f", {busy} busy（其他进程处理中，重跑即可收敛）" if busy else ""
    print(f"[gen_all] done: {ok}/{len(todo)} ok{tail}", flush=True)
    return 0 if ok == len(todo) else 1


if __name__ == "__main__":
    sys.exit(main())
