# 《血菊残，大唐笑容已泛黄：黄巢起义始末》（历史讲述长图）

* **题材类型**：历史讲述（史实深度叙事 × 制度解构）
* **题材来源**：微信公众号“渤海小吏”长文《黄巢起义（全）血菊残，满地伤，大唐笑容已泛黄》
* **成品长图**：`output/血菊残_大唐笑容已泛黄_长图.jpg`（**1080 × 18780 px**）
* **全景预览**：`output/血菊残_大唐笑容已泛黄_长图_preview.jpg`（**540 × 9390 px**）

---

## 核心设计与技术亮点

1. **叙事结构与情绪曲线**：
   - 严格遵循 **7 Block 叙事闭环**：`hook`（晚唐脓疮与荒诞朝堂）→ `context`（盐帮巨鳄与落榜狂生）→ `buildup`（绝不渡北与官僚大放水）→ `buildup`（仙霞开山与万筏下湘江）→ `climax`（淮南让道与决战潼关，**落在 71% 进度**）→ `consequence`（满城尽带黄金甲与含元登基）→ `ending`（体制死结与五代序幕）。
2. **去容器化画卷哲学**：
   - 全篇拒绝卡片框（Card）囚笼，文字直接通透落于纯白底色，依靠快乐体（标题）、文楷（正文）、毛笔字（金句）三级字阶自然分层。
   - 所有插图墨迹四周自然消散，杜绝包围式布景与横贯画面的平直线，达到真正的无缝画卷感。
3. **逐块四图（2×2 Sprite Sheet）生产**：
   - 7 个 Block 共计 7 张 Sprite Sheet，一次生图切出 28 张透明 PNG 手绘素材。
   - 全套素材通过 `make_transparent.py` 标准化处理与 `check_edges.py` 边缘墨迹机检（平均硬边数仅 0.11 / 4，边缘墨迹占比 2.0%）。
4. **机检与双代理对抗闭环质检**：
   - 全图 7 个 Block 均通过 `layout_lint.py`（hard=0）、`check_geom.py`（真实字体度量、无折行/孤字）、`check_occlusion.py`（墨迹压盖 0px）与 `check_clearance.py`（安全净空 ≥40px）。

---

## 目录结构

```
huangchao-tang-collapse/
├── output/
│   ├── 血菊残_大唐笑容已泛黄_长图.jpg        # 1080x18780px 高清成品长图
│   └── 血菊残_大唐笑容已泛黄_长图_preview.jpg  # 540x9390px 移动端预览
├── storyboard.json                         # 7 块分镜规划
├── style.json                              # 风格与三色语义配置
├── sheets.json                             # 逐块四图生图规格与防漂移锚点
├── CONTENT.md                              # 事实出处与叙事剧本
├── layout/                                 # block1.json ~ block7.json
├── assets/                                 # 28 张标准化透明 PNG 插图
└── blocks/                                 # final1.png ~ final7.png
```
