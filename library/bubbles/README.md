# pic-flow 通用手绘气泡与爆炸框素材库（16 宫格手绘精选）

本素材库由 `pipeline/generate_bubble_sheet.py` 通过 16 宫格（4×4 网格 @2048²）生图生成，经过精准网格吸附切分与透明通道修整，专供长图排版时直接复用。

## 素材清单

| 文件名 | 尺寸 | 视觉特征 | 适用场景 |
|---|---|---|---|
| `bubble_01_burst_star.png` | 268×261 | 锐利多芒星爆炸框 | 震惊、呼喊、情绪爆发、反常识结论 |
| `bubble_02_burst_jagged.png` | 260×244 | 锯齿状强力冲击波框 | 争吵、当头棒喝、剧烈冲击 |
| `bubble_03_oval_tail_left.png` | 253×204 | 圆润手绘椭圆（尾巴偏左下） | 左侧角色日常对话、提问 |
| `bubble_04_oval_tail_right.png` | 265×216 | 圆润手绘椭圆（尾巴偏右下） | 右侧角色日常对话、回应 |
| `bubble_05_cloud_thought.png` | 255×243 | 蓬松云朵手绘思考泡泡 | 内心独白、心声、幻想、神游 |
| `bubble_06_dashed_whisper.png` | 245×193 | 细腻虚线断点手绘框 | 悄悄话、自言自语、心虚、窃窃私语 |
| `bubble_07_sketch_rect.png` | 260×196 | 微颤随性双线手绘矩形框 | 关键概念定义、小节标签、知识点 |
| `bubble_08_marker_banner.png` | 276×120 | 粗马克笔涂鸦横幅横条 | 核心标语、横幅强调底框 |
| `bubble_09_sparkle_splash.png` | 266×244 | 墨滴飞溅水花放射灵感框 | 灵光一闪、点子迸发、恍然大悟 |
| `bubble_10_wavy_tremble.png` | 292×206 | 颤抖波浪线手绘框 | 委屈、恐惧、情绪破防、无力吐槽 |
| `bubble_11_stamp_badge.png` | 225×215 | 锯齿边缘手绘印章方框 | 权威机构背书、结论盖章、标志性符号 |
| `bubble_12_double_outline.png` | 275×236 | 双层加粗手绘对话框 | 郑重声明、严肃反驳、重要提示 |
| `bubble_13_speed_focus.png` | 267×210 | 四周向内聚焦的速度线框 | 视线聚焦点、戏剧性高潮瞬间 |
| `bubble_14_droplet_tail.png` | 272×233 | 水滴圆润下垂手绘框 | 温柔安抚、轻声劝导、暖心回应 |
| `bubble_15_brush_rect.png` | 307×134 | 苍劲干笔毛笔飞白长方框 | 哲理格言、古典典籍引用、核心金句底框 |
| `bubble_16_electric_zap.png` | 265×237 | 尖锐电光折线对话框 | 激烈博弈、神经电信号、对抗冲突 |

## 在项目中使用

可在项目目录下直接软链或复制至 `assets/` 目录：

```bash
# 软链所有通用气泡到当前长图项目的 assets/
ln -s ~/.dsh/skills/pic-flow/library/bubbles/*.png ~/pic-flow-projects/<项目名>/assets/
```

在 `layout/blockN.json` 中作为 `asset` 元素放置，上方叠放 `text` 元素即可。
