#!/usr/bin/env python3
"""Scaffold a new pic-flow long-image project.

Usage: new_project.py <project_dir> [--title "主题名"]
                       [--template story|edu|howto|news]
                       [--style bw-sketch|color-sketch|vector-flat|magazine]
                       [--layout story-flow|event-flow|info-feed|kanban]

Creates: assets/ blocks/ layout/ output/ scripts/ + fonts symlink
         + CONTENT.md (内容模板) + style.json (风格包) + storyboard.json (整图分镜)
         + layout/block1.json (布局骨架) + assets.json 模板。
产物位置固定：assets/ 生成素材、blocks/ 渲染块、output/ 成品长图；
源文件：storyboard.json、assets.json、layout/、style.json、CONTENT.md。
产物是否入 git 由项目自己的仓库决定，脚手架不写 .gitignore。
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
LIB = SKILL_DIR if (SKILL_DIR / "templates").exists() else SKILL_DIR.parent.parent

ASSETS_TEMPLATE = [
    {"name": "hero_scene", "size": "1792x1024",
     "prompt": "（封面大场面，横向满铺，写清主体+动作+氛围）"},
    {"name": "char_a", "size": "1024x1024",
     "prompt": "Q版人物A半身像，身份特征（帽冠/服饰/兵器），单一动作，情绪表情"},
    {"name": "char_b", "size": "1024x1024", "prompt": "Q版人物B，……"},
    {"name": "event_wide", "size": "1792x1024", "prompt": "某事件大场面：主体+动作+环境氛围"},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project_dir")
    ap.add_argument("--title", default="新主题")
    ap.add_argument("--template", default="story",
                    choices=["story", "edu", "howto", "news", "data", "review", "list", "profile"])
    ap.add_argument("--style", default="bw-sketch",
                    choices=["bw-sketch", "color-sketch", "vector-flat", "magazine",
                             "guochao", "dark", "pastel-cute", "paper-news"])
    ap.add_argument("--layout", default="story-flow",
                    choices=["story-flow", "event-flow", "info-feed", "kanban",
                             "dashboard", "versus", "ranked-list", "flow-steps", "big-quote"])
    args = ap.parse_args()

    root = Path(args.project_dir).resolve()
    if root.exists() and any(root.iterdir()):
        sys.exit(f"error: {root} 已存在且非空")

    for d in ("assets", "blocks", "layout", "output", "scripts"):
        (root / d).mkdir(parents=True, exist_ok=True)
    for f in (SKILL_DIR / "pipeline").glob("*.py"):
        if f.name != "new_project.py":
            shutil.copy2(f, root / "scripts" / f.name)
    fonts_dst = root / "fonts"
    try:
        fonts_dst.symlink_to(SKILL_DIR / "fonts", target_is_directory=True)
    except OSError:
        shutil.copytree(SKILL_DIR / "fonts", fonts_dst)

    shutil.copy2(LIB / "templates" / f"{args.template}.md", root / "CONTENT.md")
    storyboard = LIB / "templates" / "storyboard.json"
    if storyboard.exists():
        shutil.copy2(storyboard, root / "storyboard.json")
    shutil.copy2(LIB / "styles" / f"{args.style}.json", root / "style.json")
    skeleton = json.loads((LIB / "layouts" / f"{args.layout}.json").read_text())
    skeleton.pop("_doc", None)
    (root / "layout" / "block1.json").write_text(
        json.dumps(skeleton, ensure_ascii=False, indent=2), encoding="utf-8")
    (root / "assets.json").write_text(
        json.dumps(ASSETS_TEMPLATE, ensure_ascii=False, indent=2), encoding="utf-8")
    (root / "README.md").write_text(
        f"# {args.title}\n\n模板 {args.template} × 风格 {args.style} × 布局 {args.layout}\n"
        "流程详见 CONTENT.md 与 skill「pic-flow」（~/.dsh/skills/pic-flow/SKILL.md）。\n",
        encoding="utf-8")
    print(f"[new_project] 已创建 {root}")
    print(f"  内容模板={args.template}  风格={args.style}  布局={args.layout}")
    print("  产物位置：assets/ 生成素材 · blocks/ 渲染块 · output/ 成品长图"
          "（是否入 git 由你的项目仓库决定）")
    print("下一步：1) 按 CONTENT.md 写 assets.json 与 layout/*.json")
    print("        2) python3 scripts/gen_all.py  3) 按 skill 流程识图校准")


if __name__ == "__main__":
    main()
