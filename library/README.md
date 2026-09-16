# pic-flow 通用手绘气泡与爆炸框素材库（16 宫格手绘精选）

本素材库由 `pipeline/generate_bubble_sheet.py` 通过 16 宫格（4×4 网格 @2048²）生图生成，经过精准网格吸附切分与透明通道修整，专供长图排版时直接复用。

## 分类目录

- `bubbles_light/`（**主线推荐**）：日系清新手绘细黑钢笔描边 + 内部填充暖黄（实测主色 `#FCB744`，标注口径 `#F6A83C` 同为暖黄），视觉轻盈优雅，文字搭配深棕色（`#4A2800`）。
- `bubbles_yellow/`：浓郁粗黑手绘钢笔描边 + 内部填充亮黄（实测主色 `#FCB022`），适合极度张扬的高冲突场景。
- `bubbles/`：与 `bubbles_light/` 同源的暖黄填充版本（实测主色同样是 `#FCB744`，**不是**纯黑白）；需要纯白内胆时请用 `box.style: outline` 程序化气泡。

## 16 宫格素材清单

| 编号与文件名 | 适用场景与语义职能 |
|---|---|
| `bubble_01_burst_star.png` | 锐利八角多芒星手绘爆炸框（情绪爆发、反常识爆点、震惊呼喊） |
| `bubble_02_burst_jagged.png` | 锯齿强力闪电冲击波对话框（当头棒喝、争论对抗、突发变故） |
| `bubble_03_oval_tail_left.png` | 圆润手绘椭圆对话框（尖尾巴偏左下，左侧角色发言） |
| `bubble_04_oval_tail_right.png` | 圆润手绘椭圆对话框（尖尾巴偏右下，右侧角色发言） |
| `bubble_05_cloud_thought.png` | 蓬松云朵手绘思考泡泡（内心独白、走神、回忆、未说出口的心声） |
| `bubble_06_dashed_whisper.png` | 虚线断点手绘气泡（轻声低语、心虚、窃窃私语） |
| `bubble_07_sketch_rect.png` | 随性双线手绘矩形框（概念定义、角色交代、日常陈述） |
| `bubble_08_marker_banner.png` | 粗马克笔涂鸦横幅框（核心标语、横幅强调底框） |
| `bubble_09_sparkle_splash.png` | 墨滴飞溅水花放射框（灵光一闪、关键顿悟） |
| `bubble_10_wavy_tremble.png` | 颤抖波浪线气泡（委屈、情绪破防、无声抗议） |
| `bubble_11_stamp_badge.png` | 锯齿边缘印章方框（权威背书、结论盖章、标志性符号） |
| `bubble_12_double_outline.png` | 双层加粗对话框（郑重声明、严肃反驳、重要提示） |
| `bubble_13_speed_focus.png` | 中心聚焦速度线框（戏剧性高潮瞬间、视线汇聚） |
| `bubble_14_droplet_tail.png` | 水滴形圆润下垂气泡（温柔安抚、暖心回应） |
| `bubble_15_brush_rect.png` | 苍劲干笔毛笔飞白长方框（哲理格言底框） |
| `bubble_16_electric_zap.png` | 尖锐电光折线框（神经电信号、紧张博弈、强烈冲击） |

## 在项目中使用

**先把精灵图复制进项目的 `assets/`**（三个引擎都只从 `<项目>/assets/` 取素材；Web 编辑器的预览另支持 `file` 以 `library/` 开头的写法），再在 `layout/blockN.json` 中作为 `asset` 元素引用（支持宽高自由缩放）：

```json
{
  "type": "asset",
  "file": "bubble_04_oval_tail_right.png",
  "x": 260,
  "y": 680,
  "width": 460,
  "height": 270
},
{
  "type": "text",
  "content": "爸爸你看我今天……\n你怎么都不理我呀？",
  "x": 240,
  "y": 640,
  "size": 28,
  "bold": true,
  "color": "#4A2800",
  "align": "center",
  "font": "title",
  "max_width": 340
}
```
