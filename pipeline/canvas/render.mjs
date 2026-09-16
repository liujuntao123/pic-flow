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
  polyPath, roundRectPath, loadImageFile,
} from './lib/draw.mjs';
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

/** 等比缩放（多次折半逼近 Lanczos 质量，Skia 单次大比例降采样会糊）。 */
function scaleImage(img, tw, th) {
  if (Math.abs(tw - img.width) < 1 && Math.abs(th - img.height) < 1) return img;
  let src = img;
  let w = img.width;
  let h = img.height;
  while (w / 2 >= tw && h / 2 >= th) {
    const half = createCanvas(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    const hc = half.getContext('2d');
    hc.imageSmoothingEnabled = true;
    hc.imageSmoothingQuality = 'high';
    hc.drawImage(src, 0, 0, half.width, half.height);
    src = half;
    w = half.width;
    h = half.height;
  }
  const out = createCanvas(Math.max(1, Math.round(tw)), Math.max(1, Math.round(th)));
  const oc = out.getContext('2d');
  oc.imageSmoothingEnabled = true;
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

async function loadAsset(root, el) {
  const p = path.join(root, 'assets', el.file);
  if (!fs.existsSync(p)) return null;
  let img = await loadImageFile(p);
  let tw = img.width;
  let th = img.height;
  if (el.width !== undefined && el.height !== undefined) {
    tw = el.width;
    th = el.height;
  } else if (el.height !== undefined) {
    const s = el.height / img.height;
    tw = img.width * s;
    th = el.height;
  } else if (el.width !== undefined) {
    const s = el.width / img.width;
    tw = el.width;
    th = img.height * s;
  }
  img = scaleImage(img, tw, th);
  if (el.flip) {
    const f = createCanvas(img.width, img.height);
    const fc = f.getContext('2d');
    fc.translate(img.width, 0);
    fc.scale(-1, 1);
    fc.drawImage(img, 0, 0);
    img = f;
  }
  if ((el.opacity ?? 1) < 1) {
    const o = createCanvas(img.width, img.height);
    const oc = o.getContext('2d');
    oc.globalAlpha = el.opacity;
    oc.drawImage(img, 0, 0);
    img = o;
  }
  return img;
}

function rotateLayer(layer, deg, cx, cy, canvas, ctx) {
  const a = (deg * Math.PI) / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer, -layer.width / 2, -layer.height / 2);
  ctx.restore();
}

/** 画一张素材（含 scale / flip / opacity / rotate），返回其画布包围盒。
 *  导出给机检复用：净空/压盖蒙版必须与渲染走同一条变换路径。 */
export async function drawAsset(canvas, ctx, root, el, allowMissing) {
  const img = await loadAsset(root, el);
  if (!img) {
    if (!allowMissing) throw new Error(`素材缺失：assets/${el.file}`);
    return missingPlaceholder(ctx, el);
  }
  const anchor = el.anchor ?? 'cc';
  const { left, top } = anchorPos(el.x, el.y, img.width, img.height, anchor);
  if (el.rotate) {
    const m = 80;
    const layer = createCanvas(img.width + 2 * m, img.height + 2 * m);
    const lc = layer.getContext('2d');
    lc.drawImage(img, m, m);
    const cx = el.x + (anchor[0] === 'c' ? 0 : anchor[0] === 'r' ? -img.width / 2 : img.width / 2);
    const cy = el.y + (anchor[1] === 'c' ? 0 : anchor[1] === 'b' ? -img.height / 2 : img.height / 2);
    rotateLayer(layer, el.rotate, Math.round(cx), Math.round(cy), canvas, ctx);
  } else {
    ctx.drawImage(img, Math.round(left), Math.round(top));
  }
  return [left, top, left + img.width, top + img.height];
}

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

function drawBarChart(ctx, el, theme) {
  const x = el.x;
  const y = el.y;
  const bw = el.width;
  const bh = el.bar_height ?? 56;
  const gap = el.gap ?? 36;
  const lw = el.label_width ?? 200;
  const mx = el.max ?? Math.max(...el.items.map((i) => i.value));
  const barC = el.bar_color ?? '#3182CE';
  const track = el.track;
  const fL = el.label_size ?? 30;
  const fV = el.value_size ?? 30;
  ctx.textBaseline = 'middle';
  el.items.forEach((it, i) => {
    const ry = y + i * (bh + gap);
    ctx.font = fontStr(fL, true, el.font ?? 'body');
    ctx.fillStyle = el.label_color ?? theme.text ?? '#333333';
    ctx.textAlign = 'right';
    ctx.fillText(String(it.label), x + lw - 12, ry + bh / 2);
    const bx0 = x + lw;
    const bx1 = x + bw;
    if (track) {
      roundRectPath(ctx, bx0, ry, bx1, ry + bh, bh / 2);
      ctx.fillStyle = track;
      ctx.fill();
    }
    const frac = Math.max(it.value / mx, 0.02);
    const fillW = Math.max((bx1 - bx0) * frac, bh);
    roundRectPath(ctx, bx0, ry, bx0 + fillW, ry + bh, bh / 2);
    ctx.fillStyle = it.color ?? barC;
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = fontStr(fV, true, el.font ?? 'body');
    ctx.fillStyle = it.color ?? barC;
    ctx.fillText(String(it.text ?? it.value), bx0 + fillW + 14, ry + bh / 2);
  });
  return [x, y, x + bw, y + el.items.length * (bh + gap)];
}

function drawPieChart(ctx, el, theme) {
  const { cx, cy, r } = el;
  const items = el.items;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let start = -Math.PI / 2;
  for (const it of items) {
    const sweep = (it.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + sweep);
    ctx.closePath();
    ctx.fillStyle = it.color ?? '#3182CE';
    ctx.fill();
    start += sweep;
  }
  const hole = el.hole ?? 0;
  if (hole) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * hole, 0, Math.PI * 2);
    ctx.fillStyle = el.hole_color ?? theme.bg ?? '#FFFFFF';
    ctx.fill();
  }
  const lsz = el.label_size ?? 30;
  const lx = cx + r + 40;
  ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    const ly = cy - (items.length - 1) * 24 + i * 48;
    roundRectPath(ctx, lx, ly - 10, lx + 26, ly + 16, 6);
    ctx.fillStyle = it.color ?? '#3182CE';
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = fontStr(lsz, true, el.font ?? 'body');
    ctx.fillStyle = el.label_color ?? theme.text ?? '#333333';
    ctx.fillText(`${it.label}  ${it.text ?? it.value}`, lx + 38, ly + 2);
  });
  return [cx - r, cy - r, cx + r + 40 + 420, cy + r];
}

function drawTable(ctx, el, theme) {
  const { x, y } = el;
  const cw = el.col_widths;
  const rh = el.row_height ?? 72;
  const size = el.size ?? 32;
  const bc = el.border_color ?? '#E0DAD0';
  const aligns = el.aligns;
  const header = el.header;
  const rows = header ? [header, ...(el.rows || [])] : el.rows || [];
  const totalW = cw.reduce((a, b) => a + b, 0);
  ctx.textBaseline = 'middle';
  rows.forEach((row, ri) => {
    const ry = y + ri * rh;
    const isH = header !== undefined && ri === 0;
    const fill = isH
      ? el.header_fill ?? '#2F2A26'
      : ri % 2
        ? el.row_fill ?? '#FFFFFF'
        : el.alt_fill ?? el.row_fill ?? '#FFFFFF';
    ctx.fillStyle = fill;
    ctx.fillRect(x, ry, totalW, rh);
    if (el.border ?? 1) {
      ctx.strokeStyle = bc;
      ctx.lineWidth = el.border ?? 1;
      ctx.strokeRect(x, ry, totalW, rh);
    }
    let cxCell = x;
    row.forEach((cell, ci) => {
      const ccol = isH ? el.header_color ?? '#FFFFFF' : el.cell_color ?? theme.text ?? '#333333';
      const al = aligns ? aligns[ci] : 'center';
      const fam = isH ? 'title' : 'body';
      ctx.font = fontStr(size, isH, fam);
      ctx.fillStyle = ccol;
      ctx.textAlign = al === 'center' ? 'center' : 'left';
      ctx.fillText(String(cell), al === 'center' ? cxCell + cw[ci] / 2 : cxCell + 18, ry + rh / 2);
      cxCell += cw[ci];
    });
  });
  return [x, y, x + totalW, y + rows.length * rh];
}

function drawArrow(ctx, el) {
  const { x, y } = el;
  const ln = el.length;
  const dr = el.direction ?? 'down';
  const c = el.color ?? '#3182CE';
  const w = el.width ?? 8;
  const head = el.head ?? w * 3.2;
  let seg;
  let tip;
  if (dr === 'down') {
    seg = [[x, y], [x, y + ln - head]];
    tip = [x, y + ln];
  } else if (dr === 'up') {
    seg = [[x, y + head], [x, y + ln]];
    tip = [x, y];
  } else if (dr === 'right') {
    seg = [[x, y], [x + ln - head, y]];
    tip = [x + ln, y];
  } else {
    seg = [[x + head, y], [x + ln, y]];
    tip = [x, y];
  }
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(seg[0][0], seg[0][1]);
  ctx.lineTo(seg[1][0], seg[1][1]);
  ctx.stroke();
  if (dr === 'down' || dr === 'up') {
    const by = dr === 'down' ? tip[1] - head : tip[1] + head;
    polyPath(ctx, [tip, [x - head * 0.9, by], [x + head * 0.9, by]]);
  } else {
    const bx = dr === 'right' ? tip[0] - head : tip[0] + head;
    polyPath(ctx, [tip, [bx, y - head * 0.9], [bx, y + head * 0.9]]);
  }
  ctx.fillStyle = c;
  ctx.fill();
}

/**
 * @param {object} layout  layout JSON
 * @param {string} outPath 输出路径（.jpg 走 JPEG，其余走 PNG）
 * @param {boolean} debug  画网格与元素包围盒
 * @param {string} rootOverride 项目根
 * @param {number} scale   输出倍率：1 = layout 坐标口径（默认）；2 = 超采样 2 倍出图
 */
/**
 * @param {object} opts.paint 只画某类图层的过滤：元素类型或 'text'/其它。
 *   缺省 = 全画。HTML 排版线用 `paint: (t) => t !== 'text'` 只出背景层（插图/气泡/线条），
 *   文字交给浏览器渲染 —— 这就是「背景图 + 绝对定位文本块」里的背景图。
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
