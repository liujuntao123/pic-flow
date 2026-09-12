# 古人的夜晚 —— 微信文章转长图（Canvas 排版线实战）

源文章：[《科普丨古代没有电灯，古人晚上都怎么打发时间？》](https://mp.weixin.qq.com/s/nxNt4W5QtTPAyAPR7vrThg)（知乎日报）

成品：`output/古人晚上八点以后_都在干什么_长图.jpg` · 1080 × 14510 · 7 块无缝拼接
预览：`output/古人晚上八点以后_都在干什么_长图_preview.jpg`（550px 宽）

本工程是 **Canvas/Node 排版线**（`pipeline/canvas/`）的实战范例：渲染、机检、拼接全部走
`scripts/canvas/*.mjs`，layout JSON 与 Python 线（`compose.py`）完全兼容——把命令换成
`python3 scripts/compose.py` 就能得到同一份版式。

## 内容结构（7 块）

| 块 | 角色 | 密度 / 焦点 | 内容 |
|---|---|---|---|
| 1 | hook | low / full_bleed | 同一片黑暗里：现代人捧发光板 vs 古人守一盏油灯；睡前故事是 19 世纪末才被包装出来的 |
| 2 | context | medium / left | 法语 veillée 夜间集会、spinning bee、ceilidh、seanchaí；中国自秦汉的「夜绩」 |
| 3 | buildup | medium / right | 阿拉伯咖啡馆的 ḥakawātī 说书人与那把高脚椅；《一千零一夜》的扣子来自它 |
| 4 | **climax** | high / full_bleed | 宵禁：唐长安顺天门四百搥闭门、六百搥闭坊门，犯夜者〖笞二十〗（全图 62% 处） |
| 5 | consequence | high / center | 宋夜市放开（〖三更〗收摊、〖五更〗早市）↔ 元明清夜禁再收紧（〖20:12〗〖4:12〗） |
| 6 | meaning | medium / left | 第二个现实问题：你点不点得起灯；囊萤映雪、凿壁偷光 |
| 7 | ending | low / center | 收束：把夜晚关在门外的从来不是「没有电」，而是点不起灯这件事 |

贯穿机制：章节编号「一~七」（全图唯一）。

## 复现步骤

```bash
cd ~/pic-flow-projects/wx-guren-night

# 1. 素材：一次生图出 4 张插画（7 张 sheet → 28 张素材），断点续跑
python3 scripts/gen_sheets.py
python3 scripts/make_transparent.py assets/*.png   # 白底→透明 + 紧致裁边
python3 scripts/check_edges.py assets/*.png        # 方图感机检（硬边数应趋近 0）

# 2. 排版：写 layout/blockN.json（Canvas 线不需要任何转换）
# 3. 机检链（全绿才出正式稿）
node scripts/canvas/checks/lint.mjs      layout/block*.json   # hard 必须 0
node scripts/canvas/checks/geom.mjs      layout/block*.json   # 折行/行宽/孤字/插图带高 ≥55%
node scripts/canvas/checks/occlusion.mjs layout/block*.json   # 压盖素材墨迹 = 0 px
node scripts/canvas/checks/clearance.mjs layout/block*.json   # 气泡净空 ≥40px

# 4. 渲染 + 逐块复核 + 拼接
node scripts/canvas/render.mjs layout/block1.json -o blocks/final1.png
node scripts/canvas/preview.mjs blocks/final*.png -w 480 -c 4 -o blocks/preview.jpg
node scripts/canvas/stitch.mjs "output/古人晚上八点以后_都在干什么_长图.jpg" blocks/final*.png

# 5. 与 Python 引擎对照（可选，验收用）
node scripts/canvas/parity.mjs examples/jin-six-nobles/layout/block2.json
```

## 本次机检结果

| 检查 | 结果 |
|---|---|
| `lint` | 7 块全部 OK，hard = 0（block5 有 1 条 text/asset 轻微擦边 WARN） |
| `geom` | 问题项 = 0；插图带高占比 67%~88%（红线 55%） |
| `occlusion` | 压盖硬伤 = 0px |
| `clearance` | 净空不足/压盖元素 = 0 |
| `check_edges` | 28 张素材平均硬边数 0.04/4、平均边缘墨迹 2.3%、四边全硬方图 0 张 |
| 语义色 | 全图有色像素仅 1.17%，色相只落在橙/红/蓝三族（无装饰用色） |

## 已知不足（诚实记录）

- **插图底缘裁剪**：切片网格会把内容框紧，约 20 张素材的底部被切平（`b6b_study` 矮几、
  `b6d_sleep_poor` 床板等）。这在本流水线里属系统性现象（认证范例同样存在），
  要彻底消除需在 prompt 里强制"主体完整、底部留白"或改用 `assets.json` 单张全幅路线。
- **跨块角色锚点漂移**：夜读书生在 block1 与 block6/7 不是同一形象（已重绘过两轮）。
  锚点已写进 `sheets.json`，但同一张 2×2 画稿内的形象一致性仍受模型能力限制；
  跨 sheet 时建议改用「同一角色出现在同一 sheet」或走改图（image edit）路线。
- **block5 密度偏高**：插图墨迹占比 43%，仍是本图最满的一块。
- **块内骨架同构**：7 块都是「章节标题 → 顶部正文 → 主图 → 中段文字 → 底部小素材」，
  差异主要靠主图左右移动制造；做过一轮"底部双图不等大/错基线"修正，但骨架层面仍偏同构。

## 独立质检与修订记录

质检代理（逐块 read_image + 像素测量）给出【需修订】与 5 项硬伤，其中 4 项已在本工程内修掉：

| 问题 | 处理 |
|---|---|
| 4 张素材带彩色（首屏 `b1a_hook` 蓝光、`b1c_lamp`/`b6a_lamp_cost`/`b7a_one_lamp` 橙色灯焰），破坏黑白体系并与语义橙/蓝撞色 | 整批重绘为严格纯黑白（带彩墨迹 0.0%）；全图带彩像素从 4.38% 降到 0.46% |
| `b1b_sleep` 自带一个完全空白的思考气泡，像"漏排文案" | 重绘该素材（prompt 显式禁止对话框/思考气泡），现素材无任何空心圈框 |
| `b6c_steal_light` 看不出"凿壁偷光"（没有洞、没有光柱） | 重绘：墙面明确破洞 + 一束光柱照到竹简上 |
| 底部"等大双图 + 相册式排版"在 5 块里重复 | 逐块把右侧素材缩小 26%~30% 并下移，或错开基线 ≥120px |
| block6 气泡 tail 够不着发声者（143px） | 气泡重定位到书生头顶右上方，tail_len 28→150，实测 rect 净空 208px / tail 尖 152px |

顺带修掉两个**引擎级 bug**（两套引擎同源写法，影响所有 pic-flow 项目，已回流到 skill 仓库）：

1. 多行文本被一律右对齐渲染（`blockGeom` 未回传 `align`）；
2. 未显式指定颜色的正文/标题被渲染成气泡暖褐 `#4A2800`，而非 `style.json` 声明的 `#333333`。

