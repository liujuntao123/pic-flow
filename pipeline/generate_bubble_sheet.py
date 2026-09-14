#!/usr/bin/env python3
"""Generate a 4x4 sprite sheet containing 16 hand-drawn manga dialogue bubbles and burst frames.
Slices them into clean transparent PNGs and saves them into the pic-flow library.
"""
import json
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path.home() / ".dsh" / "skills" / "pic-flow" / "pipeline"))
from genlib import generate

PROMPT = (
    "一张包含 16 幅互不相干的漫画手绘对话框与爆炸气泡素材的画稿，按 4 列 4 行严格对称网格排布。"
    "16 幅插图大小均等，彼此之间留出宽阔的纯白色间隙，绝对不接触、不重叠；"
    "画幅之间绝对不画任何分割线、网格线、边框、十字线；"
    "画面中绝对不要出现任何文字、字母、数字、标点符号、假字、水印。\n"
    "第1行（从左到右）：1) 锐利八角多芒星手绘爆炸气泡；2) 锯齿状强力闪电冲击波对话框；3) 椭圆形圆润手绘对话气泡（左下小尖尾巴）；4) 椭圆形手绘对话气泡（右下小尖尾巴）。\n"
    "第2行（从左到右）：5) 蓬松云朵手绘思考泡泡（带三个由小变大的小圆球尾巴）；6) 细腻虚线断点手绘对话气泡；7) 随性微颤双线手绘矩形标签框；8) 粗马克笔手绘涂鸦横幅横条框。\n"
    "第3行（从左到右）：9) 墨滴飞溅水花放射状灵感气泡；10) 颤抖波浪线委屈手绘对话框；11) 锯齿边缘手绘印章方块框；12) 双层黑线手绘对话气泡。\n"
    "第4行（从左到右）：13) 四周向中心聚焦的手绘速度线框；14) 水滴形圆润手绘气泡；15) 苍劲干笔毛笔飞白手绘长方框；16) 尖锐电弧折线对话气泡。\n"
    "风格：黑白极简手绘线稿，粗黑钢笔墨线勾勒，内部纯白镂空留白，纯白底色，线条干净有呼吸感，极具表现力与设计感。"
)

BUBBLE_NAMES = [
    "bubble_01_burst_star",
    "bubble_02_burst_jagged",
    "bubble_03_oval_tail_left",
    "bubble_04_oval_tail_right",
    "bubble_05_cloud_thought",
    "bubble_06_dashed_whisper",
    "bubble_07_sketch_rect",
    "bubble_08_marker_banner",
    "bubble_09_sparkle_splash",
    "bubble_10_wavy_tremble",
    "bubble_11_stamp_badge",
    "bubble_12_double_outline",
    "bubble_13_speed_focus",
    "bubble_14_droplet_tail",
    "bubble_15_brush_rect",
    "bubble_16_electric_zap",
]

def slice_and_save(sheet_path: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    img = Image.open(sheet_path).convert("RGBA")
    arr = np.array(img)
    W, H = img.size
    
    # 4 cols x 4 rows
    cols, rows = 4, 4
    cw = W / cols
    ch = H / rows
    
    # Luminance mask
    lum = arr[..., :3].astype(np.float32).mean(axis=2)
    ink = (lum < 235.0) | (arr[..., 3] < 250)
    
    for r in range(rows):
        for c in range(cols):
            idx = r * cols + c
            name = BUBBLE_NAMES[idx]
            
            x0 = int(c * cw)
            x1 = int((c + 1) * cw)
            y0 = int(r * ch)
            y1 = int((r + 1) * ch)
            
            sub = ink[y0:y1, x0:x1]
            if not sub.any():
                print(f"[warn] {name} is empty")
                continue
                
            yy, xx = np.where(sub)
            by0, by1 = int(yy.min()), int(yy.max())
            bx0, bx1 = int(xx.min()), int(xx.max())
            
            pad = 8
            gx0 = max(x0 + bx0 - pad, 0)
            gy0 = max(y0 + by0 - pad, 0)
            gx1 = min(x0 + bx1 + pad, W - 1)
            gy1 = min(y0 + by1 + pad, H - 1)
            
            crop = img.crop((gx0, gy0, gx1 + 1, gy1 + 1))
            
            # Make transparent
            carr = np.array(crop).copy()
            clum = carr[..., :3].astype(np.float32).mean(axis=2)
            alpha = np.clip((245.0 - clum) * 255.0 / 30.0, 0, 255).astype(np.uint8)
            # If line is dark, keep alpha high
            carr[..., 3] = alpha
            
            # tight bbox on alpha
            alpha_mask = carr[..., 3] > 20
            if alpha_mask.any():
                ayy, axx = np.where(alpha_mask)
                ay0, ay1 = int(ayy.min()), int(ayy.max())
                ax0, ax1 = int(axx.min()), int(axx.max())
                carr = carr[ay0:ay1+1, ax0:ax1+1]
            
            out_img = Image.fromarray(carr, mode="RGBA")
            out_path = out_dir / f"{name}.png"
            out_img.save(out_path)
            print(f"[ok] Saved {name}: {out_img.width}x{out_img.height} -> {out_path}")

def main():
    sheet_file = Path("/tmp/bubbles_16_sheet.png")
    if not sheet_file.exists():
        print(f"[gen] Generating 16-bubble sprite sheet via genlib...")
        ok = generate(PROMPT, size="2048x2048", out_path=sheet_file, transparent=False)
        if not ok or not sheet_file.exists():
            print("[error] Failed to generate bubble sheet")
            sys.exit(1)
        print(f"[ok] Saved sheet to {sheet_file}")
    
    lib_dir = Path.home() / ".dsh" / "skills" / "pic-flow" / "library" / "bubbles"
    slice_and_save(sheet_file, lib_dir)
    print(f"[success] All 16 bubbles processed into {lib_dir}")

if __name__ == "__main__":
    main()
