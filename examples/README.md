# pic-flow 官方示例库（Examples）

本目录收录基于 **story × story-flow × bw-sketch** 黄金流水线打造的工业级实战长图范例。

---

## 标杆案例：《分家前夜：晋国六卿的大逃杀》

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
