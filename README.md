# pic-flow：黑白手绘叙事与科普长图流水线

pic-flow 是一个专为长篇叙事与深度科普打造的 AI Agent 技能（Skill）。
通过 **AI 生图素材 → 声明式程序排版 → 双代理对抗质检 → 无缝拼接** 全流程，
稳定产出 1080px 宽、10000~15000px 高的高张力黑白漫画长图。

成品参考（仓库自带官方标杆范例 `examples/jin-six-nobles/分家前夜_晋国六卿_长图.jpg`）：

<p align="center">
  <img src="examples/jin-six-nobles/分家前夜_晋国六卿_长图_preview.jpg" width="260" alt="官方长图示例预览">
</p>

## 为什么需要它

直接让 AI 生成长图存在三大痛点：单次分辨率受限、无法承受万像素纵深、文字渲染必崩。
pic-flow 将流水线严格解耦为可控节点：

1. **AI 专注生成无文字透明背景素材**：严格执行防御性 Prompt 约束，主体辨识度高、画风高度统一；
2. **声明式排版引擎像素级排版**：自研文本换行、避头尾、字阶混排与带角度定向气泡几何算法；
3. **双代理对抗闭环质检**：生成代理与独立挑剔评审代理对抗，执行中心压缩打分与像素级穿刺排查，彻底解决遮挡与贴脸。

## 核心特性

- **聚焦王牌体系**：专注于最具感染力与传播度的 **story（故事叙事） × story-flow（情节流动） × bw-sketch（黑白手绘）** 黄金组合，专攻事件叙事、逻辑博弈、科学原理、商业案例复盘与深度科普长图。
- **双代理对抗质检闭环**：排版代理与独立挑剔评审代理（Review Agent）协同，执行中心压缩打分与像素级穿刺排查，实现绝对零遮挡、主体锚定与跨领域道具防错置。
- **高审美画卷排版**：严格落实去容器化（彻底摒弃生硬卡片）、图片视觉面积占比 ≥60%、60~90px 负空间通风口，保证长图如流水画卷般舒展透气。
- **中文排版讲究**：自动换行（避头点、英文不拆词）、三种语义高亮（关键词橙 / 引语蓝 / 强信息红）、八种气泡形态、语义化配色；内置 OFL 开源中文字体（霞鹜文楷 / 站酷快乐体 / 马善政毛笔楷书）。
- **生图可靠与断点续跑**：多上游自动切换、失败降级、断点续跑；生图自带透明背景与防御性 Prompt 约束。

## 安装

把它克隆进你正在用的 agent 的技能目录（任选其一）。运行环境需要
Python 3.8+、Pillow、numpy；**生图功能需配置你自己的 OpenAI Images 兼容
Provider**（见下文「生图 Provider 配置」，skill 不内置任何 Key），不生图可跳过。

**Claude Code**（个人技能装到 `~/.claude/skills/`，或放项目的 `.claude/skills/` 仅对该项目生效）

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/liujuntao123/pic-flow.git ~/.claude/skills/pic-flow
```

**Codex CLI**（技能目录为 `$CODEX_HOME/skills/`，默认 `~/.codex/skills/`）

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/liujuntao123/pic-flow.git ~/.codex/skills/pic-flow
```

**workbuddy（DeepSeek Harness）**（技能目录为 `~/.dsh/skills/`）

```bash
mkdir -p ~/.dsh/skills
git clone https://github.com/liujuntao123/pic-flow.git ~/.dsh/skills/pic-flow
```

装完新开一个会话即可被自动发现。

## 如何使用

### 方式一：一句话交给 agent（推荐）

对 agent 描述需求主题即可（涵盖历史事件、科学原理解析、商业案例复盘或重大议题深度科普）。

agent 会快速提炼核心冲突与演进脉络、梳理主角特征，确认篇幅后直接开工，产出分镜、素材、逐块排版与双代理闭环校准，成品输出到项目目录 `output/`。

### 方式二：手动命令行（不经过 agent 也能跑）

```bash
# 1) 脚手架：生成项目目录（脚本与字体软链 + 默认 story × story-flow × bw-sketch 骨架）
python3 pipeline/new_project.py ~/pic-flow-projects/my-topic --title "主题"
cd ~/pic-flow-projects/my-topic

# 2) 生图：防御性 Prompt 约束、多上游容错、断点续跑
python3 scripts/gen_all.py

# 3) 素材标准化：自动裁边与透明通道校准（白底→alpha 兜底转换）
python3 scripts/make_transparent.py assets/*.png

# 4) 排版：编辑 layout/blockN.json，机检 → 双代理对抗审查 → 正式渲染
python3 scripts/layout_lint.py layout/block1.json                           # 渲染前机检
python3 scripts/compose.py layout/block1.json -o blocks/stage1.png --debug  # 调试画布
python3 scripts/compose.py layout/block1.json -o blocks/final1.png          # 正式渲染

# 5) 拼接成品长图
python3 scripts/stitch.py output/out.jpg blocks/final*.png
```

校准循环：看 `stage1.png`（自带 100px 网格坐标与元素包围盒）→ 改 `layout/block1.json`
→ 复渲，直到无碰撞、不断行、关系正确。

**项目目录与产物位置**：项目统一创建在 `~/pic-flow-projects/<项目名>/`；用户不需要预先创建 `pic-flow-projects/`，`new_project.py` 会自动创建父目录。每个项目自包含，最终交付只认该项目下的 `output/`：

| 路径 | 性质 | 内容 |
|---|---|---|
| `output/` | **产物（成品）** | 拼接后的长图 JPG + 550px 宽预览，唯一需要交付与发布的产物 |
| `blocks/` | 产物（中间） | 每块渲染图：`stage*` 调试画布、`final*` 正式块 |
| `assets/` | 产物（中间） | AI 生成的透明背景素材，`gen_all.py` 可断点续跑再生 |
| `storyboard.json`、`assets.json`、`layout/blockN.json`、`style.json`、`CONTENT.md` | **源文件** | 分镜、素材清单、排版描述、风格包、内容骨架——真正值得入 git 的工程源文件 |

产物均可由脚本再生，是否入 git 由你自己的项目仓库决定；仓库自带标杆范例工程在 `examples/` 目录下。

**脚本与字体都是软链，不是副本**：脚手架把 `scripts/` 与 `fonts/` 软链到 skill
本体，因此项目里的脚本永远等于 skill 当前版本，不会各自漂移。副作用是脚本也能
原地运行——项目里不必有副本：

```bash
python3 <skill>/pipeline/compose.py <项目>/layout/block1.json -o out.png
PICFLOW_ROOT=<项目> python3 <skill>/pipeline/compose.py layout/block1.json -o out.png
```

项目根由「被操作的 layout 文件」逐级上溯自动推断（找 `assets.json` / `style.json` /
`layout/` 等标志），无需把脚本复制进项目；个别场景可用 `PICFLOW_ROOT` 显式指定。

### 生图 Provider 配置（用户自备）

skill **不内置任何 API Key**。生图需要一个 OpenAI Images 兼容接口
（`POST {base}/images/generations`，官方 API 或任意中转均可），两种配法任选其一。
配置只存在你机器上，不会进仓库：

**方式一：环境变量（单个上游）**

```bash
export PICFLOW_IMAGE_BASE="https://api.openai.com/v1"
export PICFLOW_IMAGE_KEY="sk-..."
# 可选：export PICFLOW_IMAGE_MODEL="gpt-image-2"
```

**方式二：配置文件（推荐，多个上游按序容错）**

```bash
mkdir -p ~/.config/pic-flow
cp pipeline/providers.example.json ~/.config/pic-flow/providers.json
$EDITOR ~/.config/pic-flow/providers.json   # 填入你自己的 base 与 key
```

```json
{
  "model": "gpt-image-2",
  "providers": [
    { "name": "main",   "base": "https://api.openai.com/v1",       "key": "sk-...", "fmt": "b64_json" },
    { "name": "backup", "base": "https://你的中转.example.com/v1", "key": "sk-...", "fmt": "url" }
  ]
}
```

`fmt` 可省略（默认 `b64_json`）；部分中转只认 `"url"` 回包时改为 `"url"`。
模型默认 `gpt-image-2`，可用 `PICFLOW_IMAGE_MODEL` 或配置里的 `"model"` 覆盖。
未配置就跑生图脚本时，会打印上述配置引导。不生图也能用——排版、图表、
拼接全部离线可用，素材自备。

## 官方标杆案例

| 示例 | 选型体系 | 位置与工程 |
|---|---|---|
| 《分家前夜：晋国六卿的大逃杀》（定稿 1080 × 14540px） | story × story-flow × bw-sketch | 全套工程源码与成品：`examples/jin-six-nobles/` |

《分家前夜：晋国六卿的大逃杀》是遵循去卡片化画卷感、零遮挡排版、双代理对抗质检（PERFECT PASS 裁决）打造的官方标杆范例。其 `examples/jin-six-nobles/` 完整保留了分镜规划（`storyboard.json`）、13 张防御性 Prompt 生成的高质手绘素材（`assets/`）、声明式排版布局（`layout/`）以及高清成品长图与缩略图，可逐字节高精复现。

## 目录结构

| 目录 | 内容 |
|---|---|
| `pipeline/` | 声明式排版引擎、生图链、脚手架、机检与拼接脚本 |
| `templates/` | 核心叙事模板（`story.md` 骨架表 + `storyboard.json` 分镜定义） |
| `layouts/` | 核心故事流布局骨架（`story-flow.json`） |
| `styles/` | 官方黑白手绘风格包（`bw-sketch.json` 粗黑钢笔墨线 + 橙蓝红文字系统） |
| `references/` | 设计系统详解（`style-guide.md`）、设计方法（`design-principles.md`）、内容质量（`content-quality.md`）、Prompt 指南（`asset-prompts.md`） |
| `examples/` | 官方实战工程与高清长图成品库（`jin-six-nobles/`） |
| `fonts/` | OFL 开源中文字体（霞鹜文楷 / 站酷快乐体 / 马善政毛笔楷书） |

skill 的完整工作指引见 [SKILL.md](SKILL.md)。
