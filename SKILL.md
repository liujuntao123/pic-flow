---
name: pic-flow
description: 半小时漫画/信息图长图流水线：AI生图素材→程序排版→LLM识图校准→填字→拼接。8 种内容模板（故事/教育/操作指引/资讯/数据报告/测评对比/盘点清单/人物志）× 9 种布局（故事流/时间线/信息流/看板/指标看板/对比/排行榜/流程图/金句卡）× 8 种画风（黑白手绘/彩色手绘/矢量扁平/杂志/国潮/深色科技/手账可爱/简报纸质）。
whenToUse: 用户想制作"长图 / 科普长图 / 漫画长图 / 一图读懂 / 数据报告图 / 测评横评 / 盘点清单 / 教程步骤图 / 人物志 / 公众号与小红书图文"，或提到"再做一张像赤壁之战那样的长图"时使用。
---

# pic-flow：漫画科普长图流水线

用「AI 生图素材 + 程序排版 + LLM 识图闭环校准」稳定产出高质量长图。
成品规格：1080px 宽单栏、白底或主题底色、6~9 个 block 垂直拼接、总高 7000~14000px。
参考成品：`examples/chibi/赤壁之战_长图.jpg`
（story × story-flow × 项目自带黑白漫画风格包 `style.json`，定稿 1080 × 12970px；
源文件与渲染脚本见 `projects/chibi/`，可逐字节复现）。

## 第零步：需求引导 + 三维选型（先推荐，再确认，后开工）

用户丢来一句需求（"帮我做一张 XX 长图"）时，不要直接开跑，也不要把 8×9×8 的组合全抛给用户。
按下面三步引导，通常一轮对话即可锁定选型：

### 0.1 先从需求读信号（能推断的不问）

| 信号 | 怎么读 | 决定什么 |
|---|---|---|
| 内容形态 | 讲故事？讲原理？给步骤？摆数据？做对比？列清单？写人物？ | 内容模板 |
| 目标平台 | 小红书（短平快、可爱系吃香）/ 公众号（7000px+ 长图无压力）/ 抖音配图（首屏要炸） | 画风、篇幅 |
| 受众 | 亲子学生→彩色可爱；科技从业者→扁平/深色；大众科普→手绘漫画感 | 画风、口吻 |
| 素材底子 | 有无真实数据/事实来源 | data/review 是否成立（无数据不编数） |

### 0.2 给出推荐组合（1 个推荐 + 最多 2 个备选，各附一句理由）

对照下表取组合，做成"选择卡"给用户：有交互提问工具（如 ask_user_question）就用工具
列选项并把推荐项放第一位；没有交互工具就按下面格式用文字问。

> **推荐**：`story` 故事 × `story-flow` × `bw-sketch` 黑白手绘 —— 历史叙事成熟组合（参考成品：赤壁之战）
> 备选 A：`guochao` 国潮古风 —— 传统题材想要更浓的东方视觉
> 备选 B：`magazine` 杂志 —— 文字量大、走深度专题
>
> 回复"好 / 1"按推荐开跑；回编号换整组；也可只改一项（如"画风换 dark"）。

| 需求关键词 | 推荐组合（模板 × 主布局 × 画风） | 调整建议 |
|---|---|---|
| 历史/事件/人物命运/品牌故事 | story × story-flow × bw-sketch | 传统题材换 guochao |
| 概念/原理/知识点科普 | edu × info-feed × vector-flat | 少儿亲子换 color-sketch |
| 教程/攻略/办事流程 | howto × flow-steps × vector-flat | 菜谱/手账类换 pastel-cute |
| 新闻/政策/一周汇总 | news × info-feed × paper-news | 科技快讯换 dark |
| 财报/调研/"一图读懂" | data × dashboard × dark | 浅色需求换 vector-flat |
| 产品横评/方案二选一 | review × versus × vector-flat | 可加 big-quote 收尾点睛 |
| Top N/好物/冷知识 | list × ranked-list × pastel-cute | 小红书首选；条目零散换 info-feed |
| 人物介绍/品牌拟人 | profile × event-flow × guochao | 现代人物换 vector-flat |
| 科技话题数据速览 | data × dashboard × dark | 少插画或干脆纯图表 |

没匹配上就按内容形态就近选：叙事→story、教学→edu、步骤→howto、榜单→list，其余类推。

### 0.3 需要用户拍板的三个问题（一轮问完，不挤牙膏）

只问 0.1 推断不出来的，且一轮问全：

1. **用在哪、给谁看？** —— 决定画风与口吻。
2. **有真实数据/事实来源吗？** —— 决定 data/review 是否可行；没有就改走叙事或清单路线。
3. **篇幅预期？** —— 默认 6~9 块、总高 7000~14000px；小红书建议 6~8 块短平快。

用户答"你定/随便"：按 0.2 推荐直接开跑，但分镜、素材清单、首块渲染三个节点仍给用户过目。
选型一经确认即锁定，中途不再反复追问；确认后进入「快速开始」第 0 步脚手架。

### 三维完整清单（用户想自选或换选时再展示）

#### 内容模板（决定 block 骨架与口吻，详见 templates/<名>.md）

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

#### 布局（决定每块的视觉结构，可混用；骨架见 layouts/<名>.json）

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

#### 画风（styles/<名>.json：同时控制生图画风后缀与排版主题）

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
# 0. 脚手架：按选型生成项目（脚本与字体软链+CONTENT.md+storyboard.json+style.json+布局骨架）
#    项目自包含，产物位置固定（全部在项目目录内）：
#      assets/  AI 生成素材      blocks/  渲染块（stage*=调试、final*=正式）
#      output/  拼接成品长图     ← 唯一需要保留/发布的产物
#    源文件：storyboard.json、assets.json、layout/、style.json、CONTENT.md；
#    产物（assets/ blocks/ output/）均可由脚本再生，是否入 git 由项目自己的仓库决定
#    注：scripts/ 与 fonts/ 是软链而非副本 —— 项目里的脚本永远等于 skill 当前版本，
#    不会各自漂移；因此也可原地运行，项目不必有副本：
#      python3 <本skill目录>/pipeline/compose.py <项目>/layout/block1.json -o out.png
python3 <本skill目录>/pipeline/new_project.py ~/workspace/<主题名> \
    --title "主题名" --template story --style bw-sketch --layout story-flow
cd ~/workspace/<主题名>

# 1. 写分镜：先填 storyboard.json（每块的叙事角色/密度/焦点/视觉任务，见下方「设计方法」），
#    再按 CONTENT.md 骨架表写 assets.json 与 layout/blockN.json
#    （不同块可从 layouts/ 拷不同骨架；chart 类块直接内嵌 barchart/piechart/table）

# 2. 生图（画风由 style.json 的 asset_suffix 控制；上游=用户自配 Provider，
#    见 README「生图 Provider 配置」：~/.config/pic-flow/providers.json 或 PICFLOW_IMAGE_* 环境变量）
python3 scripts/gen_all.py            # 断点续跑；单个: python3 scripts/genlib.py <name> <size> <prompt>

# 3. 素材标准化（兜底，非必做转换）：生图请求本就带 background=transparent，
#    正规上游直接回透明 PNG（此步自动跳过转换、只做裁边）；仅当上游不认该参数
#    回了白底图，才在这里做 白底→alpha 兜底转换。
#    dark 风格深底素材整个跳过此步，整图贴用
python3 scripts/make_transparent.py assets/*.png

# 4. 排版 + LLM 识图校准（核心循环，每块至少一轮）
python3 scripts/layout_lint.py layout/block1.json   # 渲染前机检：碰撞/越界/居中滥用
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

## 设计方法（先 storyboard，后 layout；完整版见 references/design-principles.md）

- **块是叙事单元，不是排版格子**：每块先定四元组——叙事角色（hook 钩子/context 铺垫/
  buildup 蓄力/climax 高潮/consequence 余波/meaning 定型/ending 收束）、密度、焦点方位、
  视觉任务（读者这一眼记住什么）。答不出来先改内容，不是改坐标。
- **主视觉动作**：每个叙事块有且只有一个主视觉，且它在"做"一件由内容推导出的关键行为
  （故事=关键行为瞬间、教程=关键操作、数据=趋势异动、对比=最大差异处）；
  主视觉静止的块只允许出现在钩子与收束。
- **关系优先于摆放**：气泡必须指向说话者、解读文字贴着它解读的对象、
  关键数字/引语作视觉锚点；两个元素只有坐标相邻而无语义关系即返工。
- **节奏由差异制造**：相邻块的主角方位/图文方向/密度至少一项不同；块高随剧情张弛浮动，
  不等高均分；全图连续居中构图 ≤2 块；张力峰值落在 55%~70% 进度。
- **密度分层而非留白**：三层信息（章节标签/动作结论/解释正文）权重递减；
  留白必须服务强调或转场，否则补内容。
- **颜色是语法**：沿用 style.json 语义色，全图色相 ≤4，色温跟随叙事张力，禁止装饰用色。
- **连续性系统**：块间用一种贯穿机制缝合（进度提示行/章节编号/贯穿元素三选一，全图唯一）。
- **质检顺序**：机检（layout_lint.py）→ debug 识图查关系与节奏 → 正式渲染终验。
  机器管碰撞越界，人与识图模型管关系、节奏、审美。

## 构图多样性 checklist（叙事类每块至少 2 条；图表类查对齐与留白）

- 大小悬殊主从、基线错落；元素搭接（气泡压帽檐 20~80px）
- 场景出血（width 1080~1160 或角色切出画布边）
- 气泡 ±3~6° 歪贴、高度错开、全图形态 ≥2 种
- 居中与左对齐窄栏混排；标签 rotate ±3°；标题字号随内容变化
- 卡片/表格块：列对齐、行高一致、内外边距 ≥20
- 反面模式：对称等大双图、同款气泡、图表裸奔无解读、相册式排版

## 常见坑

- **透明背景是生图时直接要的，不是事后抠图**：generate() 请求自带
  `background=transparent + output_format=png`，正规上游直接回透明 PNG；
  部分中转忽略该参数回白底 RGB——`make_transparent.py` 只为这种情况兜底
  （文件已有 alpha 会自动 `[skip]`，仅统一裁边）。dark 深底素材整步跳过、整图贴用。
- 生图上游是**用户自配的**（skill 不内置 Key）：未配置时 gen 脚本会打印配置引导。
  帮用户配置 = 把 `pipeline/providers.example.json` 拷到
  `~/.config/pic-flow/providers.json` 填入用户自己的 base/key，或设
  `PICFLOW_IMAGE_BASE`/`PICFLOW_IMAGE_KEY` 环境变量。多上游按序容错、断点续跑。
- piechart 图例在圆右侧 cx+r+40 起，注意与相邻元素留距。
- table 单元格不放长句（拆两行请加行）；barchart 的 max 不给会自动取最大值。
- 素材裁边后比例变了：单边约束 + anchor；拼接前逐块终验、拼接后看 550px 预览。
- debug 幽灵框会统一外扩主题 bubble pad（约 20/28px），目测比实际墨迹大一圈；
  判断真实碰撞以正式渲染或 ink bbox 为准。
- 交叉审查代理的产出必须过 `pipeline/validate_layouts.py`：只允许坐标类字段变化，
  文案/字体/颜色/box 样式/元素数量被改动即打回。

## 文件指针

- `templates/`（8）· `layouts/`（9）· `styles/`（8）· `references/` 设计系统（style-guide.md）、
  设计方法（design-principles.md）与素材指南
- `examples/` 成品示例图；`projects/` 完整实战项目源文件：
  `projects/chibi/`（赤壁之战，story × story-flow，含可复现脚本）、
  `projects/water-cycle/`（水循环，edu × vector-flat）
- `pipeline/` 全部脚本；`new_project.py` 脚手架；`layout_lint.py` 渲染前机检；
  `validate_layouts.py` 排版修改合规校验
  （字体软链共享，勿删 skill 目录）
