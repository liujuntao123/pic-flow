# pic-flow 官方示例库（Examples）

本目录收录基于 **story × story-flow × bw-sketch** 黄金流水线打造的工业级实战长图范例，涵盖**历史讲述**与**知识科普**两大核心领域。

---

## 标杆案例一（历史讲述）：《血菊残，大唐笑容已泛黄：黄巢起义始末》

* **案例目录**：`examples/huangchao-tang-collapse/`
* **成品长图**：`examples/huangchao-tang-collapse/血菊残_大唐笑容已泛黄_长图.jpg`（**1080 × 18780 px**）
* **缩略预览**：`examples/huangchao-tang-collapse/血菊残_大唐笑容已泛黄_长图_preview.jpg`（**540 × 9390 px**）
* **题材来源**：微信公众号“渤海小吏”文章《黄巢起义（全）血菊残，满地伤，大唐笑容已泛黄》
* **技术体系**：
  * **画风**：`bw-sketch`（白底黑线、粗黑钢笔勾边、少量排线阴影、橙蓝红三色语义系统）
  * **分镜结构**：7 个 Block 递进闭环（晚唐脓疮与荒诞朝堂 → 私盐巨鳄与落榜狂生 → 绝不渡北与官军放水 → 仙霞开山与万筏下湘江 → 淮南让道与决战潼关【高潮 71%】 → 满城尽带黄金甲与含元登基 → 恶龙降生与体制死结）
  * **视觉面积**：插图与视觉图形带高占比达 $56\% \sim 60\%$，大场景与人物立绘错落穿插，文字精炼克制
  * **排版哲学**：去卡片化画卷感（文字直排底色，快乐体/文楷/毛笔字三级字阶自然分层）、绝对零遮挡（气泡与素材墨迹保留 $\ge 40\text{px}$ 纯净负空间）
  * **质检标准**：机检链（`lint` hard=0、`geom` 无折行/孤字、`occlusion` 0px、`clearance` ≥40px）全部一次性全绿通过

### 目录结构一览

```
examples/huangchao-tang-collapse/
├── 血菊残_大唐笑容已泛黄_长图.jpg        # 1080x18780px 高清成品长图
├── 血菊残_大唐笑容已泛黄_长图_preview.jpg  # 540x9390px 移动端预览
├── README.md                              # 案例详细说明
├── CONTENT.md                             # 历史考据、引用出处与叙事剧本
├── storyboard.json                        # 7 块分镜规划（role / density / focal / 视觉任务）
├── style.json                             # 风格与三色语义配置
├── sheets.json                            # 逐块四图（2×2）生图规格与防漂移锚点
├── layout/                                # block1.json ~ block7.json 声明式排版源码
├── assets/                                # 28 张标准化透明 PNG 手绘插图
└── blocks/                                # final1.png ~ final7.png 各块渲染稿
```

---

## 标杆案例二（知识科普）：《为什么古人相信水银能炼出长生不老药？》

* **案例目录**：`examples/alchemy-mercury/`
* **成品长图**：`examples/alchemy-mercury/水银与长生_古人为何迷信金石炼丹_长图.jpg`（**1080 × 18760 px**）
* **缩略预览**：`examples/alchemy-mercury/水银与长生_古人为何迷信金石炼丹_长图_preview.jpg`（**540 × 9380 px**）
* **题材来源**：知乎科普长文《科普丨为什么古人相信水银等物质可以炼出长生不老药？》
* **技术体系**：
  * **画风**：`bw-sketch`（白底黑线、严谨与幽默兼具的科学史手绘图解、橙蓝红语义系统）
  * **分镜结构**：7 个 Block 深度层层递进（迷信之惑与历史设问 → 假求外物：草木皆腐与金石不朽 → 惊天化育：丹砂化汞的化学奇迹 → 明知有毒：以猛攻猛与微毒陷阱 → 密闭宇宙：永不犯错的逻辑闭环【高潮 71%】 → 认知错觉：后见之明与集体大脑 → 科学真谛：承认错误的制度）
  * **科普深度**：还原真实化学机理（$HgS \leftrightarrow Hg$ 氧化还原、汞齐）、现代毒理学吸收率对比与社会认识论（认识劳动分工与集体大脑）
  * **质检标准**：全图 7 块机检全绿（`lint` hard=0、`occlusion` 0px、气泡安全净空 $\ge 40\text{px}$）

### 目录结构一览

```
examples/alchemy-mercury/
├── 水银与长生_古人为何迷信金石炼丹_长图.jpg        # 1080x18760px 高清成品长图
├── 水银与长生_古人为何迷信金石炼丹_长图_preview.jpg  # 540x9380px 移动端预览
├── README.md                                      # 案例详细说明
├── CONTENT.md                                     # 科学事实、毒理学依据与论证剧本
├── storyboard.json                                # 7 块分镜规划
├── style.json                                     # 风格与三色语义配置
├── sheets.json                                    # 逐块四图生图规格与防漂移锚点
├── layout/                                        # block1.json ~ block7.json
├── assets/                                        # 28 张标准化透明 PNG 插图
└── blocks/                                        # final1.png ~ final7.png
```
