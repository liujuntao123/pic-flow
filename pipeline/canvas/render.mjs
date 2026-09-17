// Canvas 渲染引擎（唯一官方排版线）。
//
// 支持的元素类型：asset / card / text / rule /
// barchart / piechart / table / arrow，--debug 输出网格与元素包围盒。
//
//   node pipeline/canvas/render.mjs layout/block1.json -o blocks/final1.png [--debug]
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createCanvas } from './lib/draw.mjs';
import {
  makeCanvas, paintBox, paintParagraph, anchorPos, missingPlaceholder,
  polyPath, roundRectPath, loadImageFile, drawAsset, rotateLayer,
} from './lib/draw.mjs';
import {
  drawBarChart as coreDrawBarChart,
  drawPieChart as coreDrawPieChart,
  drawTable as coreDrawTable,
  drawArrow,
} from './lib/core/shapes.mjs';

const drawBarChart = (ctx, el, theme) => coreDrawBarChart(ctx, el, theme, fontStr);
const drawPieChart = (ctx, el, theme) => coreDrawPieChart(ctx, el, theme, fontStr);
const drawTable = (ctx, el, theme) => coreDrawTable(ctx, el, theme, fontStr);

export { drawAsset, drawBarChart, drawPieChart, drawTable, drawArrow };
import { setFonts, layoutParagraph, fontStr, blockGeom } from './lib/text.mjs';
import { findRoot, readJson, readTheme } from './lib/paths.mjs';
import { parseCli, numFlag } from './lib/cli.mjs';

/** 入口守卫：项目里 scripts/canvas 是软链，import.meta.url 与 argv[1] 不同名，
 *  必须用 realpath 比较，否则 `node scripts/canvas/render.mjs ...` 会静默什么都不做。 */
function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}


const PAD_MARGIN = 60;      // 旋转文本层的安全边距（burst 用 100）
const BURST_MARGIN = 100;

function drawText(canvas, ctx, el, W, theme, opts = {}) {
  const box = { ...(theme.bubble || {}), ...(el.box || {}) };
  const para = layoutParagraph(el, W, box);
  const bh = para.height;
  if (el.rotate) {
    const m = box.style === 'burst' ? BURST_MARGIN : PAD_MARGIN;
    const tw = Math.round(para.w + 2 * para.px + 2 * m);
    const th = Math.round(bh + 2 * para.py + 2 * m);
    const layer = createCanvas(tw, th);
    const lc = layer.getContext('2d');
    lc.imageSmoothingEnabled = true;
    if (el.box) paintBox(lc, [m, m, tw - m, th - m], el, theme);
    const shifted = {
      ...para,
      rows: para.rows.map((r) => ({
        ...r,
        chars: r.chars.map((c) => ({ ...c, x: c.x + para.px + m - para.left })),
        baseline: r.baseline + para.py + m - para.top,
      })),
    };
    if (!opts.boxOnly) paintParagraph(lc, shifted, el, theme, el.box);
    const cx = para.left + para.w / 2;
    const cy = para.top + bh / 2;
    rotateLayer(layer, el.rotate, Math.round(cx), Math.round(cy), canvas, ctx);
    const a = (el.rotate * Math.PI) / 180;
    const bbw = para.w + 2 * para.px;
    const bbh = bh + 2 * para.py;
    const rw = Math.abs(bbw * Math.cos(a)) + Math.abs(bbh * Math.sin(a));
    const rh = Math.abs(bbw * Math.sin(a)) + Math.abs(bbh * Math.cos(a));
    return [cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2];
  }
  if (el.box) {
    paintBox(ctx, [para.left - para.px, para.top - para.py,
      para.left + para.w + para.px, para.top + bh + para.py], el, theme);
  }
  if (!opts.boxOnly) paintParagraph(ctx, para, el, theme, el.box);
  return [para.left - para.px, para.top - para.py,
    para.left + para.w + para.px, para.top + bh + para.py];
}

/**
 * @param {object} layout  layout JSON
 * @param {string} outPath 输出路径（.jpg 走 JPEG，其余走 PNG）
 * @param {boolean} debug  画网格与元素包围盒
 * @param {string} rootOverride 项目根
 * @param {number} scale   输出倍率：1 = layout 坐标口径（默认）；2 = 超采样 2 倍出图
 */
/**
 * @param {object} opts.paint 只画某类图层的过滤：元素类型或 'text'/其它，缺省 = 全画。
 */
export async function render(layout, outPath, debug = false, rootOverride, scale = 1, opts = {}) {
  const root = rootOverride || findRoot(outPath || process.cwd());
  const theme = readTheme(root, layout);
  setFonts(root, theme.fonts);
  const W = layout.width;
  const H = layout.height;
  const canvas = makeCanvas(W * scale, H * scale, layout.bg ?? theme.bg ?? '#FFFFFF');
  const ctx = canvas.getContext('2d');
  if (scale !== 1) ctx.scale(scale, scale);
  const boxes = [];

  for (const el of layout.elements || []) {
    const t = el.type;
    if (opts.backgroundOnly) {
      // HTML 背景层模式：只画插图/线条/图表/气泡底板，不画字形
      if (t === 'text') {
        if (el.box) drawText(canvas, ctx, el, W, theme, { boxOnly: true });
        continue;
      }
    } else if (opts.paint && !opts.paint(t, el)) {
      continue;
    }
    if (t === 'asset') {
      boxes.push([`asset:${el.file}`, await drawAsset(canvas, ctx, root, el, debug)]);
    } else if (t === 'card') {
      const { x, y, width: w, height: h } = el;
      const borderC = el.border_color ?? theme.card_border;
      roundRectPath(ctx, x, y, x + w, y + h, el.radius ?? 16);
      ctx.fillStyle = el.fill ?? theme.card_fill ?? '#FFFFFF';
      ctx.fill();
      if (borderC) {
        ctx.strokeStyle = borderC;
        ctx.lineWidth = el.border ?? 1;
        ctx.stroke();
      }
      boxes.push([`card:${el.label ?? ''}`, [x, y, x + w, y + h]]);
    } else if (t === 'barchart') {
      boxes.push(['barchart', drawBarChart(ctx, el, theme)]);
    } else if (t === 'piechart') {
      boxes.push(['piechart', drawPieChart(ctx, el, theme)]);
    } else if (t === 'table') {
      boxes.push(['table', drawTable(ctx, el, theme)]);
    } else if (t === 'arrow') {
      drawArrow(ctx, el);
    } else if (t === 'text') {
      if (debug) {
        const box = { ...(theme.bubble || {}), ...(el.box || {}) };
        const geo = blockGeom(el, W, box);
        const bh = geo.lines.length * geo.lh;
        const a = ((el.rotate ?? 0) * Math.PI) / 180;
        const bbw = geo.w + 2 * geo.px;
        const bbh = bh + 2 * geo.py;
        const rw = a ? Math.abs(bbw * Math.cos(a)) + Math.abs(bbh * Math.sin(a)) : bbw;
        const rh = a ? Math.abs(bbw * Math.sin(a)) + Math.abs(bbh * Math.cos(a)) : bbh;
        const cx = geo.left + geo.w / 2;
        const cy = geo.top + bh / 2;
        boxes.push([`text:${(el.content || '').replace(/[【】]/g, '').slice(0, 8)}`,
          [cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2]]);
      } else {
        drawText(canvas, ctx, el, W, theme, opts);
      }
    } else if (t === 'rule') {
      ctx.strokeStyle = el.color ?? '#222222';
      ctx.lineWidth = el.thickness ?? 4;
      ctx.beginPath();
      if (el.vertical) {
        ctx.moveTo(el.x, el.y1);
        ctx.lineTo(el.x, el.y2);
      } else {
        ctx.moveTo(el.x1, el.y);
        ctx.lineTo(el.x2, el.y);
      }
      ctx.stroke();
    } else {
      throw new Error(`unknown element type: ${t}`);
    }
  }

  if (debug) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,0,0,0.18)';
    for (let gx = 0; gx < W; gx += 100) ctx.fillRect(gx, 0, 1, H);
    for (let gy = 0; gy < H; gy += 100) ctx.fillRect(0, gy, W, 1);
    ctx.font = fontStr(24, true, 'noto');
    ctx.fillStyle = 'rgba(220,0,0,0.92)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let gx = 0; gx < W; gx += 200) ctx.fillText(String(gx), gx + 3, 3);
    for (let gy = 0; gy < H; gy += 200) ctx.fillText(String(gy), 3, gy + 2);
    for (const [label, [x0, y0, x1, y1]] of boxes) {
      ctx.strokeStyle = 'rgba(30,80,255,0.78)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.font = fontStr(24, true, 'noto');
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x0 + 2, y0 + 2, tw + 8, 30);
      ctx.fillStyle = 'rgb(200,30,30)';
      ctx.fillText(label, x0 + 6, y0 + 5);
    }
    ctx.restore();
  }

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const buf = outPath.endsWith('.jpg') || outPath.endsWith('.jpeg')
    ? canvas.toBuffer('image/jpeg', 92)
    : canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`[compose-canvas] ${outPath} (${debug ? 'debug' : 'final'}) ${W * scale}x${H * scale}${scale !== 1 ? ` @${scale}x` : ''}`);
  return outPath;
}

async function main() {
  const { files, flags, errors } = parseCli(process.argv.slice(2), {
    valueFlags: ['-o', '--out', '--scale'], boolFlags: ['--debug'],
  });
  if (errors.length || !files.length) {
    console.error(`用法：node pipeline/canvas/render.mjs layout/block1.json -o blocks/final1.png [--debug] [--scale 2]`);
    if (errors.length) console.error(`  ${errors.join('；')}`);
    process.exit(2);
  }
  const debug = Boolean(flags.debug);
  const scale = numFlag(flags, 'scale', 1, { min: 1, max: 4 });
  const layout = readJson(files[0]);
  const out = flags.out ?? flags.o ?? 'blocks/out.png';
  await render(layout, out, debug, findRoot(files[0]), scale);
}

if (isMain(import.meta.url)) await main();
