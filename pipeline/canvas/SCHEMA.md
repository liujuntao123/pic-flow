# Canvas 排版 schema 速查

`pipeline/canvas/render.mjs` 读写 `layout/blockN.json`，下述字段名与语义即完整契约。

## 元素类型

```json
{"type":"text",  "content":"…", "x":540,"y":150, "size":54, "bold":true,
 "align":"center|left|right", "font":"body|title|brush", "max_width":900,
 "line_height":1.5, "rotate":-4, "stroke_width":0, "stroke_fill":"#FFFFFF",
 "hl_color":"#E8842B","quote_color":"#2E7CB8","warn_color":"#D4483B",
 "color":"#333333", "box":{…}}

{"type":"asset", "file":"b1c_lamp.png", "x":300,"y":900,
 "height":500,            // 或 "width"；只给一个，另一边等比
 "anchor":"cc|ct|cb|lc|rc|lt|rt|lb|rb", "rotate":-3, "flip":false, "opacity":1}

{"type":"rule",  "x1":160,"x2":920,"y":980,"thickness":2,"color":"#EFECE6"}
{"type":"rule",  "vertical":true,"x":540,"y1":1000,"y2":1300}
{"type":"card",  "x":80,"y":200,"width":920,"height":400,"label":"…"}
{"type":"barchart","x":120,"y":300,"width":840,"bar_height":56,"gap":36,
 "label_width":200,"max":100,"track":"#EEE","bar_color":"#3182CE",
 "items":[{"label":"唐","value":20,"text":"笞二十","color":"#D4483B"}]}
{"type":"piechart","cx":360,"cy":500,"r":220,"hole":0.55,
 "items":[{"label":"夜禁","value":60,"color":"#D4483B"}]}
{"type":"table","x":90,"y":300,"col_widths":[240,300,340],"row_height":72,
 "header":["朝代","宵禁","夜市"],"rows":[["唐","严","无"]],"aligns":["center","center","center"]}
{"type":"arrow", "x":540,"y":600,"length":180,"direction":"down|up|left|right","color":"#3182CE"}
```

## 语义高亮（写在 `content` 里）

| 写法 | 效果 |
|---|---|
| `【关键词】` | 橙色 + 正文粗体 —— 术语、人名、地名、制度名 |
| `『引语』` | 蓝色 + 正文粗体 —— 引用原话、典籍原文 |
| `〖强信息〗` | 红色 + 毛笔字（放大 8%）—— 数字、年代、刑罚、结局 |

## 气泡 / 标签（`box`）

`style`：`fill`(实底橙) · `pill`(胶囊) · `outline`(白底描边) · `sketch`(双线手绘框) ·
`ink`(深墨底白字) · `stamp`(印章空心) · `burst`(爆炸齿) · `marker`(荧光横幅)

`tail`：`bl|bc|br` 下缘左侧/中/右，`tl|tc|tr` 上缘，`lc|rc` 左/右腰 —— 指向发话实体。

其他字段：`bg` `color` `pad:[纵向,横向]` `radius` `border` `border_color` `tail_len`。

## 渲染与机检

```bash
node scripts/canvas/render.mjs layout/block1.json -o blocks/final1.png [--debug]
node scripts/canvas/checks/lint.mjs      layout/block*.json   # 碰撞/越界/居中滥用，hard 必须 0
node scripts/canvas/checks/geom.mjs      layout/block*.json   # 真实字体折行/行宽/孤字/插图带高 ≥55%
node scripts/canvas/checks/occlusion.mjs layout/block*.json   # 气泡压盖素材墨迹 >120px 判硬伤
node scripts/canvas/checks/clearance.mjs layout/block*.json   # 红线口径：压盖必须 0px、净空 ≥40px
node scripts/canvas/checks/all.mjs        layout/block*.json   # 四条机检一次跑完（统一闸门）
node scripts/canvas/stitch.mjs output/标题_长图.jpg blocks/final*.png
```

## 正文兜底色

未显式指定 `color` 的文字元素，颜色兜底顺序是
`el.color → el.box.color → style.json 的 text`。

第二级读的是**元素自带的 `box`**，不是「主题 bubble 默认值合并后」的 box ——
主题 `bubble.color` 是气泡的暖褐色（`#4A2800`），若让它兜底，全图正文与标题都会被染成暖褐。
这个坑曾经踩过，已修正。

## 机检口径说明（都是收紧，不是放宽）

1. **斜置元素按真实几何参与判定**：`bubbleQuad` 把气泡（含 tail 三角）按渲染器的旋转方式
   转成真实四边形，压盖/净空都在这个多边形上量。
   曾经拿**旋转外接框**去量，把气泡四角的空白也算成气泡（同一气泡：890px vs 真实 710px）。
2. **`lint` 保持粗估口径**：宽高用
   `width = min(max_width, max(size*1.2, 字数*size*0.62))`、`height = 行数*size*line_height`
   （`line_height` 默认 1.05；只有元素自带 `box` 时才计 `pad`）——这是刻意的：lint 的定位是
   「快检 + 预先暴露潜在重叠」，用真实字体度量去判会让上下相邻、视觉上并不重叠的文本大面积误报。
   **真实折行与行宽**交给 `checks/geom.mjs`，**像素级压盖/净空**交给 `clearance` / `occlusion`。
3. **`geom` 的行宽判定认「悬挂标点」**：行尾的 `，。！？` 允许溢出 `max_width` 一个字宽
   （避头点的本意），扣掉它们之后仍超宽才算越界；空行不算孤字行。
4. **四条机检都以非 0 退出表示不通过**：`lint`（hard>0）、`geom`（问题项>0）、
   `occlusion`（压盖>120px）、`clearance`（压盖>0 或净空<40px）。
   `checks/all.mjs` 把它们绑成同一个闸门；漏写文件参数会打用法并以 exit 2 退出，
   不再「静默通过」。
