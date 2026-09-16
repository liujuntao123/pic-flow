# pic-flow · Canvas 排版线（Node + Skia）

唯一的官方排版线：`@napi-rs/canvas`（预编译 Skia 绑定，无需系统库）驱动，
读写 `layout/blockN.json`，渲染、机检、预览、拼接共用同一套几何口径。

```
pipeline/canvas/
├── render.mjs            # 渲染引擎
├── stitch.mjs            # 纵向拼接 + 550px 预览
├── preview.mjs           # 逐块便携预览（缩到指定宽度横向并排，供视觉复核）
├── SCHEMA.md             # schema 速查
├── lib/
│   ├── text.mjs          # 字体注册、逐字度量、贪心折行（避头点/ASCII 不拆词）
│   ├── draw.mjs          # 画布与绘图原语：八种气泡、tail 三角、逐字绘制
│   ├── geom.mjs          # 机检共用几何：包围盒、气泡多边形、墨迹蒙版、距离场
│   ├── cli.mjs           # 统一命令行解析（顺序无关、非法参数报错）
│   └── paths.mjs         # 项目根推断
└── checks/
    ├── lint.mjs          # 碰撞 / 越界 / 居中滥用      → hard 必须 0
    ├── geom.mjs          # 真实字体折行 / 行宽 / 孤字 / 插图带高 ≥55%
    ├── occlusion.mjs     # 气泡与素材墨迹压盖（>120px 硬伤）
    ├── clearance.mjs     # 画布口径净空 ≥40px、压盖 0px
    └── all.mjs           # 四条机检的统一闸门（任一不过即非 0 退出）
```

## 依赖

```bash
cd <skill 根> && npm install     # 主依赖只装 @napi-rs/canvas（预编译 Skia 绑定，无需系统库）；
                                 # devDependencies 里的 playwright-core 供 Playwright 端到端测试使用
```

## 用法

```bash
node pipeline/canvas/render.mjs layout/block1.json -o blocks/final1.png [--debug] [--scale 2]
node pipeline/canvas/checks/all.mjs      layout/block1.json   # 四条机检一次跑完
node pipeline/canvas/checks/lint.mjs      layout/block1.json
node pipeline/canvas/checks/geom.mjs      layout/block1.json
node pipeline/canvas/checks/occlusion.mjs layout/block1.json
node pipeline/canvas/checks/clearance.mjs layout/block1.json
node pipeline/canvas/preview.mjs blocks/final*.png -o /tmp/preview.jpg -c 4
node pipeline/canvas/stitch.mjs output/标题_长图.jpg blocks/final1.png blocks/final2.png …
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

## 关键排版口径（改代码别踩回去）

- **折行与行宽**：由逐字累计宽度 + 同一套贪心折行决定；行尾的避头标点允许
  「悬挂」溢出 `max_width` 一个字宽（这正是避头点的本意）。
- **行距默认值**：`1.5`（`text.mjs` 与 `SCHEMA.md` 同口径）。曾误写成 1.4，
  未显式写 `line_height` 的元素行距会悄悄差 7%，已修正。
- **pad 口径**：`pad: [纵向, 横向]`，与 `style.json`、四条机检保持一致。
- **字体解析**：先找 `<项目>/fonts/<名字>`，找不到再退回 **skill 自带的 `fonts/`**。
  没有这层兜底时（例如仓库自带的 `examples/` 没有 `fonts/` 软链），声明为文楷/快乐体的文字
  会**静默**渲染成 Noto。
- **机检判据**：`lint`（含「每边 <8px 的擦边只算 WARN」这条）快检粗估，真实折行交给
  `geom`，像素级压盖/净空交给 `clearance` / `occlusion`（共用同一张画布墨迹蒙版，
  判据：alpha > 40 且亮度 < 235）。
- **斜置气泡按真实几何参与判定**：按**真实旋转四边形**（含 tail 三角）参与压盖/净空判定 ——
  用旋转外接框会把气泡四角的空白也算进去（实测同一气泡：外接框 890px vs 真实 710px）。

## 测试

```bash
npm test          # 渲染冒烟 + 全字体 + 预览↔渲染折行一致性
                  # 需要 Web 服务在线的那一项在服务未启动时会 SKIP（不会假装通过）
```
