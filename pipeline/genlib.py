#!/usr/bin/env python3
"""Image-generation provider chain (per global AGENTS.md convention).

All providers are OpenAI-Images-compatible. Try in order until one returns
an image. Downloads url responses immediately (links expire).
"""
import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROVIDERS = [
    {"name": "upstream2", "base": "https://image.REDACTED_HOST/v1",
     "key": "REDACTED_KEY", "fmt": "url"},
    {"name": "upstream3", "base": "https://REDACTED_HOST/v1",
     "key": "REDACTED_KEY", "fmt": "b64_json"},
    {"name": "upstream1", "base": "https://chat2api.REDACTED_HOST/v1",
     "key": "REDACTED_KEY", "fmt": "b64_json"},
]
MODEL = "gpt-image-2"
FALLBACK_SIZE = "1024x1024"


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
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    last_err = None
    for p in PROVIDERS:
        bg_modes = ["transparent", None] if transparent else [None]
        for bg in bg_modes:
            for sz in dict.fromkeys([size, FALLBACK_SIZE]):
                payload = {"model": MODEL, "prompt": prompt, "n": 1,
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
