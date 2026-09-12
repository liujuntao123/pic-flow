# pic-flow 官方示例库（Examples）

本目录收录基于 **story × story-flow × bw-sketch** 黄金流水线打造的工业级实战长图范例。

---

## 标杆案例一：《分家前夜：晋国六卿的大逃杀》

* **案例目录**：`examples/jin-six-nobles/`
* **成品长图**：`examples/jin-six-nobles/分家前夜_晋国六卿_长图.jpg`（1080 × 14540 px）
* **缩略预览**：`examples/jin-six-nobles/分家前夜_晋国六卿_长图_preview.jpg`（540 × 7270 px）
* **题材来源**：渤海小吏作品《秦汉奠基》第一卷·三家分晋前夜的六卿权力博弈
* **技术体系**：
  * **画风**：`bw-sketch`（白底黑线、粗黑钢笔勾边、灰色排线、橙蓝红语义三色文字系统）
  * **分镜结构**：7 个 block 垂直无缝拼接，叙事高潮（Climax）精准落在 65%（Block 5）
  * **视觉面积**：插图与视觉图形面积占比 $\ge 60\%$，大场景 1000px 满幅铺设，立绘 480~560px
  * **排版哲学**：去卡片化画卷感（文字直排底色，由快乐体/文楷/毛笔字自然分层）、绝对零遮挡（气泡与素材墨迹保留 $\ge 40\text{px}$ 纯净负空间）
  * **质检标准**：双代理对抗闭环质检，获得【PERFECT PASS】工业级定稿裁决

### 目录结构一览

```
examples/jin-six-nobles/
├── 分家前夜_晋国六卿_长图.jpg       # 1080x14540px 高清无缝长图成品
├── 分家前夜_晋国六卿_长图_preview.jpg # 540x7270px 移动端全景缩略图
├── storyboard.json                 # 7 块分镜规划（role / density / focal / 视觉任务）
├── style.json                      # 风格与字体配置文件
├── assets.json                     # AI 生图素材清单与防御性 Prompt
├── layout/                         # block1.json ~ block7.json 声明式排版源码
├── assets/                         # 13 张标准化透明 PNG 手绘插图
└── blocks/                         # final1.png ~ final7.png 各块独立渲染稿
```

---

## 标杆案例二：《古人晚上八点以后，都在干什么》（微信科普转长图）

* **案例目录**：`examples/guren-night/`
* **成品长图**：
  * Canvas 版：`examples/guren-night/古人晚上八点以后_都在干什么_长图.jpg`（1080 × 14510 px）
  * HTML 版：`examples/guren-night/古人晚上八点以后_都在干什么_长图_html.jpg`（1080 × 14510 px）
* **缩略预览**：`examples/guren-night/古人晚上八点以后_都在干什么_长图_preview.jpg`（550 × 7389 px）
* **题材来源**：知乎日报科普文章《古代没有电灯，古人晚上都怎么打发时间？》
* **技术体系**：
  * **画风**：`bw-sketch`（黑白手绘幽默历史漫画，纯白底、粗黑墨线、橙蓝红语义三色文字系统）
  * **分镜结构**：7 个 block 垂直无缝拼接（跨时空设问 → 夜间集会 → 咖啡馆说书人 → 宵禁高潮 → 宋夜市/清夜禁 → 照明成本 → 收束）
  * **全栈打通**：同时支持 **Canvas 渲染线**（`scripts/canvas/render.mjs`）与 **HTML 排版线**（`pipeline/html/render.mjs`），读同一套 layout JSON，墨迹比 1.003
  * **素材规格**：逐块四图（`sheets.json` 28 张素材全部标准化与机检过关）

### 目录结构一览

```
examples/guren-night/
├── 古人晚上八点以后_都在干什么_长图.jpg       # Canvas 版 1080x14510px 成品
├── 古人晚上八点以后_都在干什么_长图_html.jpg  # HTML 版 1080x14510px 成品
├── 古人晚上八点以后_都在干什么_长图_preview.jpg # 550x7389px 移动端预览图
├── CONTENT.md                              # 事实/出处与叙事大纲
├── storyboard.json                         # 7 块分镜规划
├── style.json                              # 风格与三色语义配置
├── sheets.json                             # 逐块四图生图规格与防漂移锚点
├── layout/                                 # block1.json ~ block7.json 声明式排版
├── assets/                                 # 28 张标准化透明 PNG 插图
└── blocks/                                 # final*.png 与 html*.png 各块独立渲染稿
```
