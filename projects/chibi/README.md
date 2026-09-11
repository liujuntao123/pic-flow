# 赤壁之战

pic-flow 的第一个实战项目：一张"半小时漫画"风格的赤壁之战科普长图。
story × story-flow × 定稿黑白漫画风格包，8 块、1080 × 12970 px。

成品见 `examples/chibi/赤壁之战_长图.jpg`（1080 × 12970）与 `_preview.jpg`（550px 宽）。

## 目录内容

**源文件（入 git，共约 90KB）**

| 路径 | 内容 |
|---|---|
| `storyboard.json` | 整图分镜：8 块的 role / density / focal / composition |
| `style.json` | 定稿风格包（主题色 / 字体映射 / 生图画风后缀） |
| `assets.json` | 素材清单 14 条，与 `assets/`、`layout/` 一一对应 |
| `layout/block1..8.json` | 每块排版描述，内嵌定稿主题 |
| `DESIGN_NOTES.md` | 定稿设计系统与各块构图意图 |
| `scripts/` | 流水线脚本**软链**到仓库 `pipeline/`（不复制，永远指向当前版本） |
| `fonts` | 软链到仓库 `fonts/`（OFL 开源中文字体） |

**产物（不入 git，仅本地保留）**

| 路径 | 说明 |
|---|---|
| `assets/` | 14 张 AI 生成素材（透明背景、已裁边），`gen_all.py` 可断点续跑再生 |
| `blocks/final1..8.png` | 8 个 block 的正式渲染块 |
| `output/` | 拼接成品长图 JPG + 550px 宽预览 |

产物可由脚本再生，故不入仓库（与 `projects/water-cycle/` 及仓库既定策略一致）；
本地若重新生成，已被 `projects/chibi/.gitignore` 排除，不会误提交。

## 如何复现

```bash
cd projects/chibi
python3 scripts/layout_lint.py layout/block1.json      # 渲染前机检
python3 scripts/compose.py layout/block1.json -o blocks/final1.png
python3 scripts/stitch.py "output/赤壁之战_长图.jpg" blocks/final*.png
```

重跑生成素材（需自配生图 Provider，见仓库 README）：

```bash
python3 scripts/gen_all.py
python3 scripts/make_transparent.py assets/*.png
```

**复现已校验**：用上述脚本重跑排版与拼接，8 个 block 与成品长图均与
`blocks/`、`output/` 现存文件**逐字节一致**（md5 相同）。即
`assets.json` + `layout/` + `style.json` 可完全再生成品。

## 迭代归档

本项目经四轮视觉迭代，定稿为末轮（本目录现存版本）。各轮定位：

| 轮次 | 高度 | 定位 |
|---|---|---|
| v1 | 13340px | 初版，居中构图偏多、版式趋同 |
| v2 | 13450px | 杂志感加强，但留白过度、画面割裂 |
| v3 | 12450px | 尝试紧凑，偏模板化卡片 |
| **定稿** | **12970px** | 战局全景连续漫画（Sequential Battle Manga） |

前三轮产物已清除——源文件足以再生成品，迭代稿无额外信息。定稿的设计意图、
各块构图、机检与识图校准记录见 `DESIGN_NOTES.md`。
