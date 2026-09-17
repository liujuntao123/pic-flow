#!/usr/bin/env python3
"""Image-generation provider chain, user-configured (no keys ship with the skill).

All providers must be OpenAI-Images-compatible: POST {base}/images/generations.
Providers are tried in order until one returns an image; url responses are
downloaded immediately (links expire).

重试策略（防「同一 prompt 重复生成多张图」的关键约束）：

  · 生图 POST 成功但 url 取不回字节 → 先退避重试下载（生图已经发生，
    救链接不产生新的生图）；只有链接彻底失效才允许重取一次新链接；
  · provider 级失败（5xx / 超时 / 网络 / 响应异常）→ 顺序切换下一个
    provider，绝不在同一 provider 上靠改 size / background 变相重试
    （旧版整矩阵重走曾把一次瞬时故障放大成 2~8 次重复生图）；
  · 仅当 400 且错误信息明确指向 size / background 时，才解锁对应的
    降级变体（尺寸降到 1024 / 去掉透明底），每个 provider 至多各一次；
  · 落盘走临时文件 + os.replace 原子替换。

Configure via (first match wins):

1. Environment variables (single provider):
   PICFLOW_IMAGE_BASE   e.g. https://api.openai.com/v1
   PICFLOW_IMAGE_KEY    your API key
   PICFLOW_IMAGE_MODEL  optional, default gpt-image-2
   PICFLOW_IMAGE_FMT    optional, "b64_json" (default) or "url"

2. Config file ~/.config/pic-flow/providers.json (failover chain):
   {
     "model": "gpt-image-2",
     "providers": [
       {"name": "main",   "base": "https://api.openai.com/v1",
        "key": "sk-...", "fmt": "b64_json"},
       {"name": "backup", "base": "https://relay.example.com/v1",
        "key": "sk-...", "fmt": "url"}
     ]
   }
   "fmt" may be omitted (defaults to "b64_json"). See
   pipeline/providers.example.json for a starting point.

If neither is configured, scripts exit with setup instructions.
"""
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "gpt-image-2"
FALLBACK_SIZE = "1024x1024"
CONFIG_PATHS = tuple(p for p in (
    Path(os.environ["PICFLOW_CONFIG"]) if os.environ.get("PICFLOW_CONFIG") else None,
    Path.home() / ".config" / "pic-flow" / "providers.json",
    Path.home() / ".pic-flow" / "providers.json",
) if p)

SETUP_HINT = """\
[error] pic-flow 生图 Provider 未配置。任选一种方式配置（配置在你机器上，不会进仓库）：

1) 环境变量（单个上游）：
   export PICFLOW_IMAGE_BASE="https://api.openai.com/v1"
   export PICFLOW_IMAGE_KEY="sk-..."
   # 可选：export PICFLOW_IMAGE_MODEL="gpt-image-2"

2) 配置文件（推荐，可配多个上游按序容错）：
   mkdir -p ~/.config/pic-flow
   cp pipeline/providers.example.json ~/.config/pic-flow/providers.json
   # 然后编辑，填入你自己的 base（OpenAI Images 兼容接口）与 key

配置好重跑即可；不生图（素材自备）可跳过生图步骤。
详见 README「生图 Provider 配置」。
"""

_providers = None
_model = None


def _load_config():
    """Resolve providers + model once; exit with instructions if unconfigured."""
    global _providers, _model
    if _providers is not None:
        return
    providers, model = [], None
    base, key = os.environ.get("PICFLOW_IMAGE_BASE"), os.environ.get("PICFLOW_IMAGE_KEY")
    if base and key:
        providers = [{"name": "env", "base": base.rstrip("/"), "key": key,
                      "fmt": os.environ.get("PICFLOW_IMAGE_FMT", "b64_json")}]
    else:
        for path in CONFIG_PATHS:
            if not path.is_file():
                continue
            cfg = json.loads(path.read_text())
            if isinstance(cfg, list):
                providers, model = cfg, None
            else:
                providers, model = cfg.get("providers", []), cfg.get("model")
            break
    providers = [dict(p, name=p.get("name") or f"upstream{i + 1}",
                      fmt=p.get("fmt", "b64_json"))
                 for i, p in enumerate(providers) if p.get("base") and p.get("key")]
    if not providers:
        sys.exit(SETUP_HINT)
    _providers = providers
    _model = os.environ.get("PICFLOW_IMAGE_MODEL") or model or DEFAULT_MODEL


# 部分上游（image.mlgb7.com 等）挂在 Cloudflare 后面，会按浏览器指纹拦截请求：
# urllib 默认的 "Python-urllib/3.x" 会被判为机器人，直接回 HTTP 403 + "error code: 1010"
# （表现为整条上游链里好几个节点同时"坏死"，实际只是缺一个正常的 User-Agent）。
# 这里统一带浏览器 UA；可用 PICFLOW_UA 覆盖。
BROWSER_UA = os.environ.get(
    "PICFLOW_UA",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36",
)


def _http_json(url, payload, key, timeout=300):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": BROWSER_UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _fetch_bytes(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


STYLE_SUFFIX = (
    "。风格：黑白幽默历史漫画，粗黑钢笔线条勾边，Q版夸张比例，简洁白色填充，"
    "少量灰色排线阴影，类似《半小时漫画中国史》的画风。纯白色背景，无投影，"
    "画面中绝对不要出现任何文字、字幕、对话框、边框、水印。"
)


class _DownloadError(Exception):
    """生图 POST 已成功（上游已产图），但返回的字节取不回来。"""


_SIZE_HINT = re.compile(r"size|dimension|aspect", re.I)
_BG_HINT = re.compile(r"background", re.I)
# 死链退避重试间隔：救链接不产生新的生图，值得多等几秒
DOWNLOAD_BACKOFF = (0.5, 1.5, 3.0)
# 断点续跑锁的击破阈值：2048 sheet 走完整条 provider 链也在分钟级，1h 很宽松
LOCK_STALE_S = 3600


def _fetch_with_retries(url, tag, log):
    """下载 url 返回字节；退避重试全部失败时抛 _DownloadError。"""
    last = None
    for delay in (0, *DOWNLOAD_BACKOFF):
        if delay:
            time.sleep(delay)
        try:
            return _fetch_bytes(url)
        except Exception as e:
            last = e
            log(f"[dl-retry] {tag}: {type(e).__name__} {e}")
    raise _DownloadError(f"链接下载失败（已重试 {len(DOWNLOAD_BACKOFF)} 次）: {last}")


def _request_image(p, prompt, bg, sz, log):
    """一次生图 POST 并取回字节；生图成功但取不回 → _DownloadError。"""
    payload = {"model": _model, "prompt": prompt, "n": 1,
               "size": sz, "response_format": p["fmt"]}
    if bg:
        payload["background"] = bg
        payload["output_format"] = "png"
    resp = _http_json(p["base"] + "/images/generations", payload, p["key"])
    d = resp["data"][0]
    if d.get("b64_json"):
        raw = base64.b64decode(d["b64_json"])
    elif d.get("url"):
        raw = _fetch_with_retries(d["url"], p["name"], log)
    else:
        raise RuntimeError("response has neither b64_json nor url")
    if len(raw) < 2000:
        raise RuntimeError(f"response too small ({len(raw)}B)")
    return raw


def _atomic_write(out_path, raw):
    """临时文件 + os.replace：磁盘上任何时刻要么没有该文件、要么是完整文件。"""
    tmp = out_path.with_name(f"{out_path.name}.tmp{os.getpid()}")
    try:
        tmp.write_bytes(raw)
        os.replace(tmp, out_path)
    finally:
        tmp.unlink(missing_ok=True)


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # 权限受限的他人进程：保守视为存活
    except (TypeError, ValueError):
        return False
    return True


def claim(lock_path, stale_s=LOCK_STALE_S):
    """原子认领一个生成单元（跨进程互斥，防断点续跑 TOCTOU 重复生图）。

    O_CREAT|O_EXCL 保证同一时刻只有一个进程持锁；崩溃残留的锁由后来者按
    「锁内 pid 已不存活」或「锁龄超限」击破。返回 True 表示当前进程持有，
    用完必须调用 release()。
    """
    p = Path(lock_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            try:
                txt = p.read_text().split()
                pid = int(txt[0]) if txt else 0
                stale = time.time() - p.stat().st_mtime > stale_s
                if (pid and not _pid_alive(pid)) or stale:
                    p.unlink()  # 陈旧锁：击破后回到 O_EXCL 重试一次
                    continue
            except (FileNotFoundError, ValueError, OSError):
                return False  # 竞争窗口：锁刚被他人取走/释放
            return False
        os.write(fd, f"{os.getpid()} {int(time.time())}\n".encode())
        os.close(fd)
        return True


def release(lock_path):
    """释放 claim() 拿到的锁。幂等。"""
    try:
        Path(lock_path).unlink()
    except FileNotFoundError:
        pass


def generate(prompt, size, out_path, transparent=True, log=print):
    """Generate one image; write bytes to out_path. Returns True on success.

    同一 prompt 的生图请求次数受策略约束（见模块 docstring）：
    典型故障至多 len(providers) 次，url 死链场景至多多一次换链接重取。
    """
    _load_config()
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    last_err = None
    url_starved = None  # (provider, bg, size)：生图成功但链接死了的最后一次

    for p in _providers:
        bg = "transparent" if transparent else None
        sz = size
        tried = set()
        while (bg, sz) not in tried:
            tried.add((bg, sz))
            tag = f"{p['name']} bg={bg or 'd'} size={sz}"
            try:
                raw = _request_image(p, prompt, bg, sz, log)
            except _DownloadError as e:
                last_err = f"{tag}: {e}"
                log(f"[fail] {out_path.name} {last_err}")
                url_starved = (p, bg, sz)  # 生图没问题，问题在取字节 → 换 provider
                break
            except urllib.error.HTTPError as e:
                body = ""
                try:
                    body = e.read().decode(errors="replace")[:400]
                except Exception:
                    pass
                last_err = f"{tag}: HTTP {e.code} {body}"
                log(f"[fail] {out_path.name} {last_err}")
                # 仅当 400 明确指向 size / background 才解锁对应降级变体（各至多一次）
                if e.code == 400 and sz != FALLBACK_SIZE and _SIZE_HINT.search(body):
                    sz = FALLBACK_SIZE
                    continue
                if e.code == 400 and bg and _BG_HINT.search(body):
                    bg = None
                    continue
                break  # 其余错误 → 下一个 provider，不在同一 provider 上变相重试
            except Exception as e:
                last_err = f"{tag}: {type(e).__name__} {e}"
                log(f"[fail] {out_path.name} {last_err}")
                break  # 超时/网络/响应异常 → 下一个 provider
            _atomic_write(out_path, raw)
            log(f"[ok] {out_path.name} via {p['name']} size={sz} bg={bg or 'default'} "
                f"bytes={len(raw)}")
            return True

    # last chance：唯一允许的同 provider 重新生图 —— url 链接彻底失效时换新链接。
    # 第一张图已经在上游生成过，重新 POST 有明确收益（新链接大概率可取）。
    if url_starved is not None:
        p, bg, sz = url_starved
        log(f"[retry] {out_path.name}: {p['name']} 链接失效，换新链接重取一次")
        try:
            raw = _request_image(p, prompt, bg, sz, log)
            _atomic_write(out_path, raw)
            log(f"[ok] {out_path.name} via {p['name']} size={sz} bg={bg or 'default'} "
                f"bytes={len(raw)} (fresh link)")
            return True
        except Exception as e:
            last_err = f"last-chance {p['name']}: {type(e).__name__} {e}"
            log(f"[fail] {out_path.name} {last_err}")

    log(f"[error] {out_path.name}: all providers failed; last: {last_err}")
    return False


if __name__ == "__main__":
    name, size = sys.argv[1], sys.argv[2]
    prompt = " ".join(sys.argv[3:]) + STYLE_SUFFIX
    ok = generate(prompt, size, Path("assets") / f"{name}.png")
    sys.exit(0 if ok else 1)
