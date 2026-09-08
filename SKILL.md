---
name: pic-flow
description: 半小时漫画/信息图长图流水线：AI生图素材→程序排版→LLM识图校准→填字→拼接。8 种内容模板（故事/教育/操作指引/资讯/数据报告/测评对比/盘点清单/人物志）× 9 种布局（故事流/时间线/信息流/看板/指标看板/对比/排行榜/流程图/金句卡）× 8 种画风（黑白手绘/彩色手绘/矢量扁平/杂志/国潮/深色科技/手账可爱/简报纸质）。
whenToUse: 用户想制作"长图 / 科普长图 / 漫画长图 / 一图读懂 / 数据报告图 / 测评横评 / 盘点清单 / 教程步骤图 / 人物志 / 公众号与小红书图文"，或提到"再做一张像赤壁之战那样的长图"时使用。
---

# pic-flow：漫画科普长图流水线

用「AI 生图素材 + 程序排版 + LLM 识图闭环校准」稳定产出高质量长图。
成品规格：1080px 宽单栏、白底或主题底色、6~9 个 block 垂直拼接、总高 7000~14000px。
参考成品：`~/workspace/pic-flow/output/赤壁之战_长图.jpg`（story × bw-sketch × story-flow）。

## 第零步：三维选型（从需求推断，或直接问用户）

### 内容模板（决定 block 骨架与口吻，详见 templates/<名>.md）

| 模板 | 适用 | 读者带走什么 |
|---|---|---|
| `story` 故事感 | 历史/事件/人物命运/品牌故事 | 情绪与记忆点（赤壁模式） |
| `edu` 教育讲解 | 概念/原理/知识点 | "是什么·为什么·怎么运作" |
| `howto` 操作指引 | 教程/攻略/食谱/办事 | 照做就能成的步骤 |
| `news` 资讯速看 | 新闻/公告/政策快读 | 60 秒了解来龙去脉 |
| `data` 数据报告 | 财报/调研/行业报告/年度盘点/"一图读懂" | 2~3 个数字结论 |
| `review` 测评对比 | 产品横评/方案二选一 | 有依据的选择建议 |
| `list` 盘点清单 | Top N/冷知识/好物/金句 | 可跳读的条目集 |
| `profile` 人物志 | 人物/品牌拟人/角色介绍 | 立体的人设与命运线 |

### 布局（决定每块的视觉结构，可混用；骨架见 layouts/<名>.json）

| 布局 | 结构 | 典型用途 |
|---|---|---|
| `story-flow` | 标题+段落+人物+对话气泡 | 叙事块（默认） |
| `event-flow` | 中轴竖线+节点圆点+年代胶囊+左右卡片 | 生平/历程/里程碑 |
| `info-feed` | 编号徽章+卡片+标题+两行说明 | 要点/清单/FAQ |
| `kanban` | 栏头胶囊+分栏对照卡片 | 优劣对比/分类归纳 |
| `dashboard` | 大数字卡+barchart+piechart+结论 | 数据报告 |
| `versus` | 双方胶囊+对比表+制胜点卡+判定条 | 二选一横评 |
| `ranked-list` | 名次徽章+得分条（第 1 名放大） | Top N 榜单 |
| `flow-steps` | 步骤卡+箭头+✅❌分支 | 流程/决策树/排查 |
| `big-quote` | 大号引文+出处小字 | 金句卡/收尾点睛 |

### 画风（styles/<名>.json：同时控制生图画风后缀与排版主题）

| 风格 | 视觉 | 搭配 |
|---|---|---|
| `bw-sketch` 黑白手绘 | 白底+粗黑线稿+橙蓝红 | story/edu 历史科普（默认） |
| `color-sketch` 彩色手绘 | 水彩明快+暖底 | 亲子/绘本/生活方式 |
| `vector-flat` 矢量扁平 | 浅灰蓝底+几何+思源黑体 | edu 科技/产品/方法论 |
| `magazine` 杂志 | 奶油底+宋体大标题+莫兰迪 | 深度专题/书摘/特稿 |
| `guochao` 国潮古风 | 宣纸米底+朱砂黛蓝+毛笔标题 | 历史/非遗/节日（配 story/profile） |
| `dark` 深色科技 | 深夜蓝底+亮字+霓虹 | data/news 科技话题（少插画或无插画） |
| `pastel-cute` 手账可爱 | 马卡龙粉+圆角卡片 | list/生活记录（小红书风） |
| `paper-news` 简报纸质 | 米白+黑细框+宋体分栏 | news/一周汇总 |

dark 风格注意：白底线稿与其冲突，素材用深底插画整图贴用，或干脆纯图表无插画。

## 快速开始（六步）

```bash
# 0. 脚手架：按选型生成项目（流水线+字体软链+CONTENT.md+style.json+布局骨架）
python3 <本skill目录>/pipeline/new_project.py ~/workspace/<主题名> \
    --title "主题名" --template story --style bw-sketch --layout story-flow
cd ~/workspace/<主题名>

# 1. 写分镜：按 CONTENT.md 骨架表写 assets.json 与 layout/blockN.json
#    （不同块可从 layouts/ 拷不同骨架；chart 类块直接内嵌 barchart/piechart/table）

# 2. 生图（画风由 style.json 的 asset_suffix 控制；上游链见 ~/.dsh/AGENTS.md）
python3 scripts/gen_all.py            # 断点续跑；单个: python3 scripts/genlib.py <name> <size> <prompt>

# 3. 白底→透明+裁边（dark 风格深底素材跳过此步，整图贴用）
python3 scripts/make_transparent.py assets/*.png

# 4. 排版 + LLM 识图校准（核心循环，每块至少一轮）
python3 scripts/compose.py layout/block1.json -o blocks/stage1.png --debug
#   → read_image 看网格坐标 → 改 layout → 复渲 → 通过后：
python3 scripts/compose.py layout/block1.json -o blocks/final1.png
#   → read_image 终验

#   4.5 可选但推荐：派一个子代理（如 gemini-3.8-flash-high）做交叉审查
#       —— 按 block 并行，任务=渲染 --debug → 识图找碰撞/越界/出卡 → 只改坐标字段修复 →
#          复渲确认 → 出正式稿。先备份 layout/（cp -r layout layout_backup_preclean），
#          完工后用 pipeline/validate_layouts.py --backup layout_backup_preclean 校验
#          其只动了坐标字段（文案/样式被改即 FAIL）。实测能抓出人工单轮校准的漏检。

# 5. 拼接
python3 scripts/stitch.py "output/标题_长图.jpg" blocks/final*.png 按序
```

## 识图校准 SOP

1. `--debug` 画布：100px 红网格坐标、素材蓝框、文字幽灵框、卡片蓝框。
2. `read_image` 检查：碰撞（气泡 pad 外扩、图表与文字间距）、断行孤字/拆词、
   构图多样性、对齐（卡片/表格/看板类块尤其查列对齐）。
3. 修复→复渲复查→正式渲染→`read_image` 终验。每轮通常修 1~3 处，不要跳过。

## 排版 schema 速查（完整设计系统见 references/style-guide.md）

- `text`：`x/y` 锚点、`align`、`max_width` 自动换行（避头点/ASCII 不拆词/`\n`）、
  `font: body|title|brush`（或 style.json 自定义族）。
- 三种语义高亮：`【关键词】`橙 ｜ `『引语』`蓝 ｜ `〖强信息〗`红毛笔+8%
  （data/review/news 模板中红=关键数字/截止时间）。
- `box` 气泡/标签 `style` 八种：`fill`｜`outline`｜`sketch`｜`burst`｜`ink`｜`pill`｜
  `stamp`（印章标签）｜`marker`（荧光笔横幅）；`tail` 指向说话人。
- `asset`：单边缩放、`anchor`、`rotate`、`flip`、`opacity`、越界出血。
- `card`：卡片面板（信息流/看板/时间线圆点的底板）。
- `rule`：横线；`{vertical:true,x,y1,y2}` 竖线（时间线中轴/分栏隔断）。
- `barchart`：横向条形 `{x,y,width,items:[{label,value,text,color}],max,bar_height,track,
  label_width}`——排名/对比/指标。
- `piechart`：环形图 `{cx,cy,r,hole,items,label_size}`——占比构成。
- `table`：表格 `{x,y,col_widths,header,rows,row_height,header_fill,alt_fill,aligns}`——
  横评打分/参数对照。单元格文本不解析高亮标记。
- `arrow`：`{x,y,length,direction:down|up|left|right,color,width}`——流程串联与分支。
- 元素按数组顺序层叠；文字/气泡可 `rotate`。

## 风格包机制

style.json 同时控制：`asset_suffix`（生图画风）+ 主题（bg/text/hl/quote/warn/
bubble 默认/fonts 字体映射）。compose.py 渲染时自动加载项目根目录 style.json；
layout 内写 `"theme"` 可覆盖。新增风格 = 新增一个 styles/*.json，零代码。

## 构图多样性 checklist（叙事类每块至少 2 条；图表类查对齐与留白）

- 大小悬殊主从、基线错落；元素搭接（气泡压帽檐 20~80px）
- 场景出血（width 1080~1160 或角色切出画布边）
- 气泡 ±3~6° 歪贴、高度错开、全图形态 ≥2 种
- 居中与左对齐窄栏混排；标签 rotate ±3°；标题字号随内容变化
- 卡片/表格块：列对齐、行高一致、内外边距 ≥20
- 反面模式：对称等大双图、同款气泡、图表裸奔无解读、相册式排版

## 常见坑

- 上游切换自动处理；白底 RGB 产物正常，make_transparent 统一转透明（dark 深底素材除外）。
- piechart 图例在圆右侧 cx+r+40 起，注意与相邻元素留距。
- table 单元格不放长句（拆两行请加行）；barchart 的 max 不给会自动取最大值。
- 素材裁边后比例变了：单边约束 + anchor；拼接前逐块终验、拼接后看 550px 预览。
- debug 幽灵框会统一外扩主题 bubble pad（约 20/28px），目测比实际墨迹大一圈；
  判断真实碰撞以正式渲染或 ink bbox 为准。
- 交叉审查代理的产出必须过 `pipeline/validate_layouts.py`：只允许坐标类字段变化，
  文案/字体/颜色/box 样式/元素数量被改动即打回。

## 文件指针

- `templates/`（8）· `layouts/`（9）· `styles/`（8）· `references/` 设计系统与素材指南
- `examples/` 赤壁之战实例；完整实战项目：`~/workspace/water-cycle`（edu × vector-flat）
- `pipeline/` 全部脚本；`new_project.py` 脚手架；`validate_layouts.py` 排版修改合规校验
  （字体软链共享，勿删 skill 目录）
