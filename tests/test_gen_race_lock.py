#!/usr/bin/env python3
"""断点续跑并发锁回归：两个 gen_sheets.py 进程并发，同一 sheet 只能生图一次。

背景 bug（TOCTOU）：run_sheet / gen_all 先检查「素材文件是否存在」再决定
是否生图，检查与落盘之间没有任何互斥。两个并发进程（agent + 用户终端、
或重复触发的自动化）都会看到「素材不存在」，于是同一 prompt 被上游生成
两份。修复后每个生成单元在生图前先原子 claim 一个 .lock（O_CREAT|O_EXCL），
持锁者生成，后来者跳过，锁随结束释放，崩溃残留的锁按 pid 存活/年龄击破。

运行：python3 tests/test_gen_race_lock.py
  --serve PORT   （内部用途：以 mock 上游身份运行，供 e2e 子进程打点）
"""
import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "pipeline"
sys.path.insert(0, str(PIPE))

FAILURES = []


def report(name, ok, detail=""):
    print(("[PASS] " if ok else "[FAIL] ") + name + (f": {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


# ---------- --serve：mock 上游（真实可切分的 2×2 sheet，慢速模式） ----------
if "--serve" in sys.argv:
    from PIL import Image, ImageDraw

    PORT = int(sys.argv[sys.argv.index("--serve") + 1])
    DELAY = float(os.environ.get("MOCK_DELAY", "4"))
    STATE = {"posts": []}
    LOCK = threading.Lock()

    def sheet_png():
        img = Image.new("RGB", (1024, 1024), "white")
        d = ImageDraw.Draw(img)
        for r in range(2):
            for c in range(2):
                cx, cy = c * 512 + 256, r * 512 + 256
                d.rectangle([cx - 100, cy - 100, cx + 100, cy + 100], fill="black")
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/log":
                with LOCK:
                    return self._send(200, STATE["posts"])
            if self.path.startswith("/img/"):
                return self._send(200, sheet_png(), "image/png")
            self._send(404, {})

        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(n) or b"{}")
            with LOCK:
                STATE["posts"].append(payload.get("prompt", ""))
            time.sleep(DELAY)  # 模拟慢速上游，放大竞态窗口
            self._send(200, {"data": [
                {"url": f"http://127.0.0.1:{PORT}/img/x.png"}]})

    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
    sys.exit(0)


# ---------- 单元：claim/release 语义 ----------
from genlib import claim, release  # noqa: E402


def unit_claim():
    with tempfile.TemporaryDirectory() as td:
        lock = Path(td) / "unit.lock"
        if not claim(lock):
            report("claim 首次获取", False, "应成功")
            return
        second = claim(lock)
        release(lock)
        third = claim(lock)
        release(lock)
        report("claim 互斥与释放", second is False and third is True,
               f"second={second} third={third}")


def unit_stale():
    with tempfile.TemporaryDirectory() as td:
        lock = Path(td) / "stale.lock"
        lock.write_text("999999 0\n")            # 已消失的 pid
        os.utime(lock, (time.time() - 7200, time.time() - 7200))
        ok = claim(lock)
        if ok:
            release(lock)
        report("击破陈旧锁（死 pid + 超龄）", ok)
        lock2 = Path(td) / "live.lock"
        lock2.write_text(f"{os.getpid()} {int(time.time())}\n")
        report("活着 pid 的新锁不被误破", claim(lock2) is False)


def unit_alive_pid_lock_not_broken():
    """同龄但 pid 存活：即便到达 stale 年龄阈值内也不误判（靠 pid 判定）。"""
    with tempfile.TemporaryDirectory() as td:
        lock = Path(td) / "alive2.lock"
        lock.write_text(f"{os.getpid()}\n")
        report("存活 pid 锁拒绝第二个 claim", claim(lock) is False)
        release(lock)


# ---------- e2e：双进程并发 gen_sheets ----------
def e2e_race():
    port = 18790
    env = {**os.environ, "MOCK_DELAY": "4"}
    mock = subprocess.Popen(
        [sys.executable, __file__, "--serve", str(port)], env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/log", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        with tempfile.TemporaryDirectory() as td:
            fixture = Path(td)
            (fixture / "assets").mkdir()
            (fixture / "sheets").mkdir()
            (fixture / "sheets.json").write_text(json.dumps([{
                "sheet": "sheetX", "size": "1024x1024", "cols": 2, "rows": 2,
                "cells": [{"name": f"c{i}", "prompt": f"marker-cell-{i}"} for i in range(4)],
            }]))
            run_env = {**os.environ,
                       "PICFLOW_ROOT": str(fixture),
                       "PICFLOW_IMAGE_BASE": f"http://127.0.0.1:{port}",
                       "PICFLOW_IMAGE_KEY": "sk-test",
                       "GEN_PAR": "1"}
            procs = []
            for tag in ("A", "B"):
                log = open(fixture / f"run_{tag}.log", "w")
                procs.append((tag, log, subprocess.Popen(
                    [sys.executable, str(PIPE / "gen_sheets.py")],
                    cwd=fixture, env=run_env, stdout=log, stderr=subprocess.STDOUT)))
            # B 紧随 A 启动：Python 导入耗时已足够让 A 先通过「素材存在」检查
            for _, log, p in procs:
                p.wait()
                log.close()
            posts = json.loads(urllib.request.urlopen(
                f"http://127.0.0.1:{port}/log", timeout=5).read())
            sheet_posts = [p for p in posts if "marker-cell-0" in p]
            assets = sorted(p.name for p in (fixture / "assets").glob("*.png"))
            locks = list((fixture / "sheets").glob("*.lock"))
            report("并发双进程同一 sheet 只生图一次", len(sheet_posts) == 1,
                   f"生图 POST={len(sheet_posts)}")
            report("素材切分齐全", len(assets) == 4, f"{assets}")
            report("锁已释放", not locks, f"{[l.name for l in locks]}")
    finally:
        mock.terminate()
        mock.wait(timeout=10)


if __name__ == "__main__":
    print("=== 生图断点续跑并发锁回归 ===")
    unit_claim()
    unit_stale()
    unit_alive_pid_lock_not_broken()
    e2e_race()
    print()
    if FAILURES:
        print(f"=== {len(FAILURES)} 项失败: {FAILURES} ===")
        sys.exit(1)
    print("=== 全部通过 ===")
