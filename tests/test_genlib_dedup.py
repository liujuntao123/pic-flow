#!/usr/bin/env python3
"""生图链去重回归：failover 重试不得把同一 prompt 的生图次数放大。

背景 bug：genlib.generate() 曾对任何失败都整矩阵重走
（providers × background × size），一次瞬时 500 / url 链接过期 / 客户端超时
会把同一 prompt 送去上游真实生成 2~8 次（用户侧表现为「同一个提示词
重复生成好多张图片」）。

修复后的策略（本文件锁定的契约）：
  · 请求成功但链接下载失败 → 先重试下载（有界），不立即重新生图；
  · 非分类错误（5xx/超时/网络）→ 换下一个 provider，不在同一 provider 上
    用改参数的方式变相重试；
  · 仅 400 且错误信息明确指向 size / background 才解锁对应降级变体；
  · 同一 provider 的「重新生图」仅剩一种：url 链接彻底失效后的
    last-chance 换新链接（有界，至多 1 次）；
  · 落盘走临时文件 + 原子替换，不残留 .tmp。

运行：python3 tests/test_genlib_dedup.py（自进程内起 mock 上游，无需网络）
"""
import base64
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PIPE = Path(__file__).resolve().parent.parent / "pipeline"
sys.path.insert(0, str(PIPE))
os.environ["PICFLOW_IMAGE_KEY"] = "sk-test"
os.environ["PICFLOW_IMAGE_BASE"] = "http://127.0.0.1:1"  # 占位，随后注入链
import genlib  # noqa: E402

BLOB = b"\x89PNG" + os.urandom(3000)  # > 2000B 即被接受


class Mock(BaseHTTPRequestHandler):
    mode = "ok"
    fail_n = 0
    delay = 0.0
    posts = []          # 每次 /images/generations 的 payload
    downloads = {}      # path -> GET 次数

    def log_message(self, *a):
        pass

    @classmethod
    def reset(cls, mode="ok", fail_n=0, delay=0.0):
        cls.mode, cls.fail_n, cls.delay = mode, fail_n, delay
        cls.posts, cls.downloads = [], {}

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        Mock.downloads[self.path] = Mock.downloads.get(self.path, 0) + 1
        if self.path.startswith("/dead/"):
            return self._send(410, {"error": "link expired"})
        if self.path.startswith("/img/"):
            return self._send(200, BLOB, "image/png")
        self._send(404, {})

    def do_POST(self):
        if self.path != "/images/generations":
            return self._send(404, {})
        n = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(n) or b"{}")
        Mock.posts.append(payload)
        if Mock.delay:
            time.sleep(Mock.delay)
        hit = len(Mock.posts)
        if Mock.mode == "gen500" and hit <= Mock.fail_n:
            return self._send(500, {"error": "relay hiccup"})
        if Mock.mode == "size400" and hit <= Mock.fail_n:
            return self._send(400, {"error": "invalid size for this model"})
        if Mock.mode == "url_dead" and payload.get("response_format") == "url":
            # 仅 url 型上游回死链；b64 型上游照常回内嵌数据（贴近真实备胎）
            return self._send(200, {"data": [{"url": f"http://127.0.0.1:{PORT}/dead/{hit}.png"}]})
        return self._send(200, {"data": [{"b64_json": base64.b64encode(BLOB).decode()}]})


server = ThreadingHTTPServer(("127.0.0.1", 0), Mock)
PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

OUT = Path("/tmp/picflow-genlib-dedup")
FAILURES = []


def use_chain(providers, fmts):
    genlib._providers = None
    genlib._model = None
    genlib._load_config()
    genlib._providers = [
        {"name": f"p{i+1}", "base": f"http://127.0.0.1:{PORT}", "key": "sk", "fmt": fmts[i]}
        for i in range(providers)]


def run_generate(prompt, out, transparent=False, timeout=None):
    real_http = genlib._http_json
    if timeout is not None:
        def short(*args, **kw):          # 强制覆盖 timeout，避免参数遮蔽
            kw["timeout"] = timeout
            return real_http(*args, **kw)
        genlib._http_json = short
    try:
        return genlib.generate(prompt, "2048x2048", out,
                               transparent=transparent, log=lambda m: None)
    finally:
        genlib._http_json = real_http


def check(name, ok_expected, posts_expected, *, mode="ok", fail_n=0,
          providers=1, fmts=None, transparent=False):
    """跑一次 generate()，断言 (成功与否, 上游生图 POST 次数)。"""
    Mock.reset(mode, fail_n)
    use_chain(providers, fmts or ["b64_json"] * providers)
    out = OUT / f"{name}.png"
    out.parent.mkdir(exist_ok=True)
    for p in OUT.glob("*"):
        p.unlink()
    ok = run_generate(f"prompt-{name}", out, transparent)
    posts = len(Mock.posts)
    tmp_leftovers = list(OUT.glob("*.tmp*"))
    problems = []
    if ok != ok_expected:
        problems.append(f"ok={ok} 期望 {ok_expected}")
    if posts != posts_expected:
        problems.append(f"生图 POST={posts} 期望 {posts_expected}（同 prompt 重复生图）")
    if tmp_leftovers:
        problems.append(f"残留临时文件 {[p.name for p in tmp_leftovers]}")
    if problems:
        FAILURES.append(name)
        print(f"[FAIL] {name}: {'; '.join(problems)}")
    else:
        print(f"[PASS] {name}: ok={ok} posts={posts}")


print("=== 生图链去重回归 ===")
# 1. 快路径：一张图恰好一次生图
check("ok_fastpath", True, 1)
# 2. 瞬时 500：不换参数重打（单 provider → 干净失败交给断点续跑）
check("gen500_1prov", False, 1, mode="gen500", fail_n=1, providers=1)
# 3. 瞬时 500 + 双 provider：恰好每个 provider 一次
check("gen500_2prov", True, 2, mode="gen500", fail_n=1, providers=2)
# 4. url 链接失效（单 provider）：先重试下载；重新生图只剩有界 last-chance 一次
check("url_dead_1prov", False, 2, mode="url_dead", providers=1, fmts=["url"])
if sum(Mock.downloads.values()) < 3:
    FAILURES.append("url_dead_download_retry")
    print(f"[FAIL] url_dead_download_retry: 死链 GET 重试不足（{Mock.downloads}）")
else:
    print(f"[PASS] url_dead_download_retry: 死链 GET 重试 {sum(Mock.downloads.values())} 次")
# 5. url 链接失效 + b64 备胎：恰好两次生图并成功（用户真实链路形态）
check("url_dead_2prov", True, 2, mode="url_dead", providers=2, fmts=["url", "b64_json"])
# 6. gen_all 形态（transparent=True）同样不放大
check("url_dead_2prov_t", True, 2, mode="url_dead", providers=2,
      fmts=["url", "b64_json"], transparent=True)
# 7. 分类 400（size）仍保留尺寸降级（文档化行为）
check("size_400_fallback", True, 2, mode="size400", fail_n=1, providers=1)
# 8. 慢上游 + 客户端短超时：单 provider 一次即止
Mock.reset("ok", 0, delay=1.5)
use_chain(1, ["b64_json"])
OUT.mkdir(exist_ok=True)
for p in OUT.glob("slow*"):
    p.unlink()
ok = run_generate("prompt-slow", OUT / "slow.png", timeout=0.4)
if ok or len(Mock.posts) != 1:
    FAILURES.append("slow_timeout")
    print(f"[FAIL] slow_timeout: ok={ok} posts={len(Mock.posts)} 期望 ok=False posts=1")
else:
    print("[PASS] slow_timeout: ok=False posts=1")

print()
if FAILURES:
    print(f"=== {len(FAILURES)} 项失败: {FAILURES} ===")
    sys.exit(1)
print("=== 全部通过 ===")
