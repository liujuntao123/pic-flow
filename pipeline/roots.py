#!/usr/bin/env python3
"""定位 pic-flow 项目根目录（含 assets/ layout/ style.json 的那一层）。

流水线脚本原先用 `Path(__file__).parent.parent` 推断项目根，导致脚本必须被
复制进每个项目才能找到 assets/ 与 fonts/。副本会随时间漂移：项目的 compose.py
与 skill 的版本各自演化、修复无法互相回流。改为从**被操作的文件**推断项目根后，
脚本可原地运行（`python3 <skill>/pipeline/compose.py <项目>/layout/block1.json`），
项目里不再需要脚本副本。

解析优先级：
  1. 环境变量 PICFLOW_ROOT（显式指定，最高优先级）
  2. 从 hint（layout 文件路径 / 当前工作目录）逐级上溯，找到含项目标志的目录
  3. 兜底：脚本自身所在目录的上一级（兼容脚本被复制进 <项目>/scripts/ 的老项目）
"""
import os
from pathlib import Path

MARKERS = ("assets.json", "storyboard.json", "style.json", "layout")


def _looks_like_project(p: Path) -> bool:
    return any((p / m).exists() for m in MARKERS)


def find_root(hint=None) -> Path:
    """返回项目根目录 Path。找不到时返回兜底路径（可能是 skill 根，调用方各自报错）。"""
    env = os.environ.get("PICFLOW_ROOT")
    if env:
        return Path(env).expanduser().resolve()

    start = None
    if hint is not None:
        h = Path(hint).expanduser()
        try:
            start = h.resolve() if h.is_dir() else h.resolve().parent
        except OSError:
            start = None
    if start is None:
        start = Path.cwd().resolve()

    for cand in (start, *start.parents):
        if _looks_like_project(cand):
            return cand

    return Path(__file__).resolve().parent.parent
