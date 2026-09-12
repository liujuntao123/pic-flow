# pic-flow · Canvas 排版线（Node + Skia）

**一句话结论**：可行，且与 Python 线等价 —— 在认证范例 7 块上，两引擎的机检判据逐块一致、
墨迹像素比 0.996~1.032、平均亮度差 ≤0.9/255；实战范例（微信文章转 1080×14510 长图）
全程只用 Canvas 线跑通。不需要迁移任何 layout 文件，切换只是换一条命令。

与 Python 排版线（`pipeline/compose.py` + `checks/*.py`）**并存**的第二套引擎。
两套引擎读**同一份 `layout/blockN.json`**、遵守**同一套机检判据**、产出**同一批中间产物**
（`blocks/*.png` → `output/*.jpg`），可以逐块互换，也可以对照验收。

```
pipeline/canvas/
├── render.mjs            # 渲染引擎（对应 compose.py）
├── stitch.mjs            # 纵向拼接 + 550px 预览（对应 stitch.py）
├── parity.mjs            # 双引擎逐像素对照（Python vs Canvas，Canvas 方案验收工具）
├── preview.mjs           # 逐块便携预览（缩到指定宽度横向并排，供视觉复核）
├── SCHEMA.md             # schema 速查 + 两引擎差异
├── lib/
│   ├── text.mjs          # 字体注册、逐字度量、贪心折行（避头点/ASCII 不拆词）
│   ├── draw.mjs          # 画布与绘图原语：八种气泡、tail 三角、逐字绘制
│   ├── geom.mjs          # 机检共用几何：包围盒、气泡 rect、tail、墨迹蒙版、距离场
│   └── paths.mjs         # 项目根推断（对应 roots.py）
└── checks/
    ├── lint.mjs          # 碰撞 / 越界 / 居中滥用      → hard 必须 0
    ├── geom.mjs          # 真实字体折行 / 行宽 / 孤字 / 插图带高 ≥55%
    ├── occlusion.mjs     # 气泡与素材墨迹压盖（>120px 硬伤）
    └── clearance.mjs     # 画布口径净空 ≥40px、压盖 0px
```

## 依赖

```bash
cd <skill 根> && npm install     # 只装 @napi-rs/canvas（预编译 Skia 绑定，无需系统库）
```

## 用法

```bash
node pipeline/canvas/render.mjs layout/block1.json -o blocks/final1.png [--debug] [--scale 2]
node pipeline/canvas/checks/lint.mjs      layout/block1.json
node pipeline/canvas/checks/geom.mjs      layout/block1.json
node pipeline/canvas/checks/occlusion.mjs layout/block1.json
node pipeline/canvas/checks/clearance.mjs layout/block1.json
node pipeline/canvas/stitch.mjs output/标题_长图.jpg blocks/final1.png blocks/final2.png …
node pipeline/canvas/parity.mjs examples/jin-six-nobles/layout/block2.json
```

项目里的 `scripts/canvas` 是指向本目录的软链（`new_project.py` 自动创建），
所以项目内写 `node scripts/canvas/render.mjs …` 即可，脚本永远是最新版。

`--scale 2` 出 2 倍图（2160 宽），给需要更锐利文字的场合用；默认 1 倍即 layout 坐标口径。

## 五个坑（都已在代码里处理，改代码时别踩回去）

1. **`img.src = buffer` 不解码像素**：`@napi-rs/canvas` 里必须 `await img.decode()`
   之后 `drawImage` 才有内容，否则得到一张全白画布（静默失败，不报错）。
   所以 `loadImageFile()` 是 async，渲染主循环顺序 await。
2. **全流水线只能有一个 canvas 模块实例**：分别在两处 `import '@napi-rs/canvas'`
   可能解析到 CJS / ESM 两份不同实例，`drawImage` 会因 `img instanceof Image`
   跨实例判定失败而抛 `Value is not one of these types`。
   统一从 `lib/draw.mjs` 出口 `createCanvas` / `Image`。
3. **`createCanvas(w, h, bg)` 的第三参是 SVG 导出标志**，传背景色字符串会报
   `SvgExportFlag` 转换错误。背景要用 `fillRect` 自己铺。
4. **坐标口径必须是 layout 坐标**：机检读 layout 里的 `x/y`，渲染也必须在同一坐标系里画。
   用 `ctx.scale(scale, scale)` 做倍率，不要改 layout 数值。
5. **入口守卫要用 realpath 比较**：项目里 `scripts/canvas` 是软链，
   `import.meta.url === file://${process.argv[1]}` 这种写法会判 false，
   于是 `node scripts/canvas/render.mjs …` **静默什么都不做、退出码还是 0**。
   统一用 `isMain()`（`realpathSync` 双端比较）—— 这个坑实测吃过一次。

## 两引擎差异（已验证：判据一致，Canvas 侧仅一处收紧）

在官方标杆范例 `examples/jin-six-nobles` 的 7 块上跑同一份 layout 对照：

- **折行、行宽、基线**：由**逐字累计宽度 + 同一套贪心折行**决定 → 两引擎折行结果一致。
- **行距默认值**：`1.4`（与 `compose.py` 的 `el.line_height ?? 1.4` 对齐；曾误用 1.5，导致同块行距差 7%）。
- **`lint`**：宽高沿用 Python 的粗估口径（`width = min(max_width, max(size*1.2, 字数*size*0.62))`、
  `height = 行数*size*line_height`，`line_height` 默认 1.05），且只有元素自带 `box` 时才计 `pad` →
  两引擎 hard/warn **逐块一致**（Canvas 仅多出斜置元素带来的 1 条 WARN）。
- **唯一的收紧**：旋转元素按**真实旋转外接框**参与碰撞/净空判定，Python 版用未旋转框、
  会漏判斜置气泡的对角侵入素材。
