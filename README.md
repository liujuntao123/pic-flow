# pic-flow

半小时漫画 / 信息图风格长图流水线（DeepSeek Harness skill）。
AI 生图素材 → 程序排版 → LLM 识图校准 → 填字 → 拼接。

**8 内容模板**（故事/教育/操作指引/资讯/数据报告/测评对比/盘点清单/人物志）
× **9 布局**（故事流/时间线/卡片流/看板/指标看板/对比/排行榜/流程图/金句卡）
× **8 画风**（黑白手绘/彩色手绘/矢量扁平/杂志/国潮/深色科技/手账可爱/简报纸质）。

## 安装为 skill

```bash
mkdir -p ~/.dsh/skills
git clone git@github.com:liujuntao123/pic-flow.git ~/.dsh/skills/pic-flow
```

之后对 agent 说"用 pic-flow 做一张 XX 长图"即可。

## 手动跑一个项目

```bash
python3 pipeline/new_project.py ~/workspace/my-topic --title "主题" \
    --template edu --style vector-flat --layout flow-steps
cd ~/workspace/my-topic
python3 scripts/gen_all.py                       # AI 生图（需按 ~/.dsh/AGENTS.md 配置上游）
python3 scripts/make_transparent.py assets/*.png  # 白底转透明
python3 scripts/compose.py layout/block1.json -o blocks/stage1.png --debug  # 排版校准
python3 scripts/compose.py layout/block1.json -o blocks/final1.png          # 正式渲染
python3 scripts/stitch.py output/out.jpg blocks/final*.png                  # 拼接
```

## 目录

| 目录 | 内容 |
|---|---|
| `pipeline/` | 排版引擎、生图链、脚手架、合规校验 |
| `templates/` | 8 种内容模板（block 骨架表 + 口吻 + 高度预算） |
| `layouts/` | 9 种布局骨架（可直接拷进项目改） |
| `styles/` | 8 种风格包（生图画风后缀 + 排版主题） |
| `references/` | 设计系统详解、素材 prompt 指南 |
| `examples/` | 赤壁之战示例 + 成品图 |
| `projects/` | 完整实战项目（水循环） |

字体（霞鹜文楷 / 站酷快乐体 / 马善政毛笔楷书，均 OFL 开源）位于 `fonts/`。
