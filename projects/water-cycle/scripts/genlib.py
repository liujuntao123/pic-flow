#!/usr/bin/env python3
"""Image-generation provider chain, user-configured (no keys ship with the skill).

All providers must be OpenAI-Images-compatible: POST {base}/images/generations.
Providers are tried in order until one returns an image; url responses are
downloaded immediately (links expire).

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
import sys
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


def _http_json(url, payload, key, timeout=300):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _fetch_bytes(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


STYLE_SUFFIX = (
    "。风格：黑白幽默历史漫画，粗黑钢笔线条勾边，Q版夸张比例，简洁白色填充，"
    "少量灰色排线阴影，类似《半小时漫画中国史》的画风。纯白色背景，无投影，"
    "画面中绝对不要出现任何文字、字幕、对话框、边框、水印。"
)


def generate(prompt, size, out_path, transparent=True, log=print):
    """Generate one image; write bytes to out_path. Returns True on success."""
    _load_config()
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    last_err = None
    for p in _providers:
        bg_modes = ["transparent", None] if transparent else [None]
        for bg in bg_modes:
            for sz in dict.fromkeys([size, FALLBACK_SIZE]):
                payload = {"model": _model, "prompt": prompt, "n": 1,
                           "size": sz, "response_format": p["fmt"]}
                if bg:
                    payload["background"] = bg
                    payload["output_format"] = "png"
                try:
                    resp = _http_json(p["base"] + "/images/generations", payload, p["key"])
                    d = resp["data"][0]
                    if d.get("b64_json"):
                        raw = base64.b64decode(d["b64_json"])
                    elif d.get("url"):
                        raw = _fetch_bytes(d["url"])
                    else:
                        raise RuntimeError("response has neither b64_json nor url")
                    if len(raw) < 2000:
                        raise RuntimeError(f"response too small ({len(raw)}B)")
                    out_path.write_bytes(raw)
                    log(f"[ok] {out_path.name} via {p['name']} size={sz} bg={bg or 'default'} "
                        f"bytes={len(raw)}")
                    return True
                except urllib.error.HTTPError as e:
                    body = ""
                    try:
                        body = e.read().decode(errors="replace")[:400]
                    except Exception:
                        pass
                    last_err = f"{p['name']} bg={bg or 'd'} size={sz}: HTTP {e.code} {body}"
                    log(f"[fail] {out_path.name} {last_err}")
                    # bad size -> smaller fallback already queued; bad bg param -> next bg
                except Exception as e:
                    last_err = f"{p['name']} bg={bg or 'd'} size={sz}: {type(e).__name__} {e}"
                    log(f"[fail] {out_path.name} {last_err}")
    log(f"[error] {out_path.name}: all providers failed; last: {last_err}")
    return False


if __name__ == "__main__":
    name, size = sys.argv[1], sys.argv[2]
    prompt = " ".join(sys.argv[3:]) + STYLE_SUFFIX
    ok = generate(prompt, size, Path("assets") / f"{name}.png")
    sys.exit(0 if ok else 1)
