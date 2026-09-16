#!/usr/bin/env python3
"""Scaffold a new pic-flow long-image project (story × story-flow × bw-sketch).

Usage: new_project.py <project_dir> [--title "主题名"]

Creates: assets/ blocks/ layout/ output/ scripts/(软链) + fonts(软链)
         + CONTENT.md (内容模板) + style.json (风格包) + storyboard.json (整图分镜)
         + layout/block1.json (布局骨架) + sheets.json (逐块四图规格) + assets.json (单张全幅用)。
标准项目位置：~/pic-flow-projects/<项目名>/；最终交付目录固定为该项目下的 output/。
assets/ 与 blocks/ 是可再生中间产物；layout/、style.json、storyboard.json、
sheets.json、assets.json、CONTENT.md 是源文件。
脚手架会写 .gitignore，默认不把生图素材、渲染块和成品提交进源代码仓库。
scripts/ 与 fonts/ 均软链到 skill 本体（不复制），故项目内脚本恒为当前版本。
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
    ap = argparse.ArgumentParser(description="Scaffold a new pic-flow project (story × story-flow × bw-sketch)")
    ap.add_argument("project_dir")
    ap.add_argument("--title", default="新主题")
    ap.add_argument("--template", default="story", choices=["story"])
    ap.add_argument("--style", default="bw-sketch", choices=["bw-sketch"])
    ap.add_argument("--layout", default="story-flow", choices=["story-flow"])
    args = ap.parse_args()

    root = Path(args.project_dir).resolve()
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        sys.exit(f"error: {root} 已存在且非空（或不是目录）")

    for d in ("assets", "blocks", "layout", "output", "scripts"):
        (root / d).mkdir(parents=True, exist_ok=True)

    # 流水线脚本用**软链**共享，不复制：副本会随时间漂移（项目里的 compose.py
    # 与 skill 版本各自演化、修复无法互相回流），软链永远指向当前 skill。
    # 脚本已改为从被操作文件推断项目根，因此原地运行也成立：
    #   python3 <skill>/pipeline/compose.py <项目>/layout/block1.json
    # 不支持软链的文件系统（如部分 Windows 环境）回退为复制。
    for f in sorted((SKILL_DIR / "pipeline").glob("*")):
        if f.name in ("new_project.py", "__pycache__"):
            continue
        dst = root / "scripts" / f.name
        try:
            dst.symlink_to(f)
        except OSError:
            shutil.copy2(f, dst)
    canvas_dst = root / "scripts" / "canvas"
    if not canvas_dst.exists():
        try:
            canvas_dst.symlink_to(SKILL_DIR / "pipeline" / "canvas", target_is_directory=True)
        except OSError:
            pass
    # 默认以 Canvas 排版方案为一等公民
    for name, target in [
        ("render.mjs", SKILL_DIR / "pipeline" / "canvas" / "render.mjs"),
        ("compose.mjs", SKILL_DIR / "pipeline" / "canvas" / "render.mjs"),
        ("stitch.mjs", SKILL_DIR / "pipeline" / "canvas" / "stitch.mjs"),
        ("checks", SKILL_DIR / "pipeline" / "canvas" / "checks"),
    ]:
        link_dst = root / "scripts" / name
        if not link_dst.exists():
            try:
                link_dst.symlink_to(target, target_is_directory=target.is_dir())
            except OSError:
                pass
    fonts_dst = root / "fonts"
    try:
        fonts_dst.symlink_to(SKILL_DIR / "fonts", target_is_directory=True)
    except OSError:
        shutil.copytree(SKILL_DIR / "fonts", fonts_dst)
    library_dst = root / "library"
    if (SKILL_DIR / "library").exists() and not library_dst.exists():
        try:
            library_dst.symlink_to(SKILL_DIR / "library", target_is_directory=True)
        except OSError:
            pass

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
    sheets_tpl = LIB / "templates" / "sheets.json"
    if sheets_tpl.exists():
        shutil.copy2(sheets_tpl, root / "sheets.json")
    (root / ".gitignore").write_text(
        "assets/*.png\nblocks/*.png\noutput/*.jpg\noutput/*.jpeg\noutput/*.png\n",
        encoding="utf-8")
    (root / "README.md").write_text(
        f"# {args.title}\n\n模板 {args.template} × 风格 {args.style} × 布局 {args.layout}\n"
        f"流程详见 CONTENT.md 与 skill「pic-flow」（{SKILL_DIR}/SKILL.md）。\n",
        encoding="utf-8")
    print(f"[new_project] 已创建 {root}")
    print(f"  内容模板={args.template}  风格={args.style}  布局={args.layout}")
    print("  产物位置：assets/ 生成素材 · blocks/ 渲染块 · output/ 成品长图"
          "（是否入 git 由你的项目仓库决定）")
    print("下一步：1) 按 CONTENT.md 写 sheets.json（逐块四图）与 layout/*.json")
    print("        2) python3 scripts/gen_sheets.py      # 每块一次生图出 4 张插画，自动切开")
    print("           python3 scripts/gen_all.py         # 仅全幅大场景走单张（assets.json）")
    print("        3) python3 scripts/make_transparent.py assets/*.png")
    print("        4) python3 scripts/check_edges.py assets/*.png   # 查方图感（硬边数应趋近 0）")
    print("  排版/机检（Canvas 官方默认方案）：")
    print("        （首次先在 skill 根目录 npm install，装 @napi-rs/canvas）")
    print("        node scripts/render.mjs layout/block1.json -o blocks/final1.png [--debug]")
    print("        node scripts/checks/lint.mjs  layout/block1.json")
    print("        node scripts/checks/geom.mjs  layout/block1.json")
    print("        node scripts/checks/occlusion.mjs layout/block1.json")
    print("        node scripts/checks/clearance.mjs layout/block1.json")
    print("        node scripts/stitch.mjs output/标题_长图.jpg blocks/final*.png")
    print("  可视化修改与项目管理 Web 控制台：")
    print("        cd " + str(SKILL_DIR) + " && npm run web   # Web 控制台属于 skill 本体，须在 skill 根目录启动")


if __name__ == "__main__":
    main()
