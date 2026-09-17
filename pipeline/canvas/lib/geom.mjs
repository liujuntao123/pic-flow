// 几何口径：渲染（render.mjs）与机检共用同一套（元素包围盒、气泡 rect、tail 三角、墨迹蒙版）。
// 机检全部建立在这里的几何上，保证「渲染什么就检查什么」。
import path from 'node:path';
import fs from 'node:fs';
import { createCanvas, drawAsset } from './draw.mjs';
import { blockGeom, charWidth } from './text.mjs';
import { parseCli, parseArgs, requireFiles } from './cli.mjs';

export { parseArgs, requireFiles };

/**
 * 全局统一的「墨迹」判据：像素不透明（alpha > 40）且不是近白的浅色（亮度 < 235）。
 * `clearance`（净空）与 `occlusion`（压盖）必须用同一判据，否则同一份 layout
 * 会在两条机检里得出不同结论（曾经一条用 alpha>24、另一条用 alpha>40 && 亮度<235）。
 */
export const INK_ALPHA = 40;
export const INK_LUMA = 235;

export function isInk(r, g, b, a) {
  return a > INK_ALPHA && (0.299 * r + 0.587 * g + 0.114 * b) < INK_LUMA;
}

export function padPair(pad) {
  return Array.isArray(pad) ? [pad[1], pad[0]] : [pad, pad];
}

/**
 * 气泡样式解析：主题默认气泡 + 元素自带 box。
 * 注意：把主题默认值套到每个文本元素上，
 * 包括主题的 `pad`。要「不要内边距」就在元素上写 `"box": {"pad": 0}`。
 */
export function boxOf(el, theme) {
  return { ...(theme?.bubble || {}), ...(el.box || {}) };
}

/** 元素画布包围盒（与 checks/lint.mjs 同一口径）。 */
export function elemBox(el, root, W, theme) {
  const t = el.type;
  if (t === 'text') {
    // 宽高用**粗估口径**（宽 = min(max_width, max(size*1.2, 字数*size*0.62))、
    // 高 = 行数 * size * line_height，line_height 默认 1.05），且**只有元素自带 box 时才计 pad**。
    // 这是刻意的：lint 的定位是「快检 + 预先暴露潜在重叠」，
    // 而真折行后的实际行高大于 1.05×size —— 用真实度量去判，会让上下相邻但视觉并不重叠的
    // 文本块大面积误报（实测认证范例 7 块里 6 块误报）。
    // 真实字体度量与折行交给 checks/geom.mjs，像素级压盖/净空交给 checks/clearance.mjs。
    const [px, py] = el.box ? padPair(el.box.pad ?? 0) : [0, 0];
    const size = el.size ?? 40;
    const content = el.content || '';
    const lines = Math.max(1, content.split('\n').length);
    const width = Math.min(el.max_width ?? 940,
      Math.max(size * 1.2, [...content].length * size * 0.62));
    const height = lines * size * (el.line_height ?? 1.05);
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const align = el.align ?? 'center';
    const left = align === 'center' ? x - width / 2 : align === 'left' ? x : x - width;
    const x0 = left - px;
    const y0 = y - py;
    const x1 = left + width + px;
    const y1 = y + height + py;
    if (el.rotate) {
      // 旋转元素按真实外接矩形算（用未旋转框会漏判斜置气泡的对角侵入）
      const a = (el.rotate * Math.PI) / 180;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const bw = x1 - x0;
      const bh = y1 - y0;
      const rw = Math.abs(bw * Math.cos(a)) + Math.abs(bh * Math.sin(a));
      const rh = Math.abs(bw * Math.sin(a)) + Math.abs(bh * Math.cos(a));
      return [cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2];
    }
    return [x0, y0, x1, y1];
  }
  if (t === 'asset') {
    const p = path.join(root, 'assets', el.file || '');
    let w = el.width;
    let h = el.height;
    if (fs.existsSync(p)) {
      const sz = pngSize(p);
      if (sz) {
        if (h != null) w = (sz.w * h) / sz.h;
        else if (w != null) h = (sz.h * w) / sz.w;
        else [w, h] = [sz.w, sz.h];
      }
    }
    w = w ?? 360;
    h = h ?? 360;
    const a = el.anchor ?? 'cc';
    const left = a[0] === 'c' ? el.x - w / 2 : a[0] === 'r' ? el.x - w : el.x;
    const top = a[1] === 'c' ? el.y - h / 2 : a[1] === 'b' ? el.y - h : el.y;
    if (el.rotate) {
      // 斜置素材按旋转外接框判定（与 render 的 rotateLayer 同一圆心：锚点）
      const rad = (el.rotate * Math.PI) / 180;
      const cx = left + w / 2;
      const cy = top + h / 2;
      const rw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
      const rh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      return [cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2];
    }
    return [left, top, left + w, top + h];
  }
  if (t === 'card') return [el.x, el.y, el.x + el.width, el.y + el.height];
  if (t === 'rule') {
    return el.vertical ? [el.x - 3, el.y1, el.x + 3, el.y2] : [el.x1, el.y - 3, el.x2, el.y + 3];
  }
  if (t === 'barchart') {
    const n = el.items.length;
    const h = n * ((el.bar_height ?? 56) + (el.gap ?? 36));
    return [el.x, el.y, el.x + el.width, el.y + h];
  }
  if (t === 'table') {
    const rows = (el.header ? 1 : 0) + (el.rows?.length || 0);
    const w = el.col_widths.reduce((a, b) => a + b, 0);
    return [el.x, el.y, el.x + w, el.y + rows * (el.row_height ?? 72)];
  }
  if (t === 'piechart') {
    const legend = Math.max(0, ...(el.items || []).map((i) => String(i.label || '').length * (el.label_size ?? 30) + 150));
    return [el.cx - el.r, el.cy - el.r, el.cx + el.r + 40 + legend, el.cy + el.r];
  }
  if (t === 'arrow') {
    // 与 checks/lint.mjs 同口径：按 direction 决定箭头朝哪边长，不能一律当右下
    const l = el.length;
    const down = (el.direction ?? 'down') === 'down' || el.direction === 'right';
    return down
      ? [el.x - 12, el.y - 12, el.x + l + 12, el.y + l + 12]
      : [el.x - l - 12, el.y - l - 12, el.x + 12, el.y + 12];
  }
  return null;
}

/**
 * 只读文件头拿图片尺寸（不解码像素，快）。
 *
 * 以前这里无条件按 PNG 解析（读 offset 16/20）——素材换成 JPEG 时会读出一对
 * 垃圾数字，机检与 lint 的包围盒随之全错，且不报错。现在按魔数分派，
 * 认不出来就返回 null，由调用方回落到默认值并告警。
 */
export function pngSize(p) {
  const b = fs.readFileSync(p);
  // PNG: \x89PNG\r\n\x1a\n + IHDR
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  // JPEG: FFD8 ... 逐段找 SOF
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      const isSOF = (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

export function overlapArea(a, b) {
  const dx = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const dy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return dx * dy;
}

/** tail 三角（与 render.mjs 的 paintBox 同一几何）。 */
export function tailTri(el, rect, theme) {
  const box = boxOf(el, theme);
  if (!box.tail) return null;
  const [x0, y0, x1, y1] = rect;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const th = box.tail_len ?? 26;
  const t = box.tail;
  if (t === 'bc') return [[cx - 16, y1], [cx + 16, y1], [cx, y1 + th]];
  if (t === 'tc') return [[cx - 16, y0], [cx + 16, y0], [cx, y0 - th]];
  if (t === 'bl') return [[x0 + 12, y1], [x0 + 44, y1], [x0 + 2, y1 + th]];
  if (t === 'br') return [[x1 - 12, y1], [x1 - 44, y1], [x1 - 2, y1 + th]];
  if (t === 'tl') return [[x0 + 12, y0], [x0 + 44, y0], [x0 + 2, y0 - th]];
  if (t === 'tr') return [[x1 - 12, y0], [x1 - 44, y0], [x1 - 2, y0 - th]];
  if (t === 'lc') return [[x0, cy - 16], [x0, cy + 16], [x0 - th, cy]];
  return [[x1, cy - 16], [x1, cy + 16], [x1 + th, cy]];
}

/** 气泡 rect（含 pad），与 drawText 里 paintBox 的入参一致（未旋转的轴对齐框）。 */
export function bubbleRect(el, W, theme) {
  const box = boxOf(el, theme);
  const geo = blockGeom(el, W, box);
  const [px, py] = padPair(box.pad ?? 0);
  const x0 = geo.left - px;
  const y0 = geo.top - py;
  const x1 = geo.left + geo.w + px;
  const y1 = geo.top + geo.height + py;
  if (el.rotate) {
    const a = (el.rotate * Math.PI) / 180;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const bw = x1 - x0;
    const bh = y1 - y0;
    const rw = Math.abs(bw * Math.cos(a)) + Math.abs(bh * Math.sin(a));
    const rh = Math.abs(bw * Math.sin(a)) + Math.abs(bh * Math.cos(a));
    return [cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2];
  }
  return [x0, y0, x1, y1];
}

function rotateAbout([x, y], cx, cy, a) {
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

/**
 * 气泡的**真实**多边形（含 tail 三角），像素级机检用这个而不是旋转外接框。
 *
 * 为什么：render 的旋转是「把整层绕文本中心转」，所以气泡与 tail 都跟着转。
 * 用旋转外接矩形去数压盖，会把四角多出来的空白也算成气泡 —— 实测官方范例里
 * 同一个斜置气泡，外接框报 890px 压盖，真实四边形只有 480px（差近一倍）。
 *
 * @returns {{quad: number[][], tail: number[][]|null, center: number[]}}
 */
export function bubbleQuad(el, W, theme) {
  const box = boxOf(el, theme);
  const geo = blockGeom(el, W, box);
  const [px, py] = padPair(box.pad ?? 0);
  const rect = [geo.left - px, geo.top - py,
    geo.left + geo.w + px, geo.top + geo.height + py];
  // 旋转中心 = 文本块中心（不含 pad），与 render.mjs 的 rotateLayer 一致
  const cx = geo.left + geo.w / 2;
  const cy = geo.top + geo.height / 2;
  const a = ((el.rotate ?? 0) * Math.PI) / 180;
  const corners = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];
  const tail = tailTri(el, rect, theme);
  if (!a) return { quad: corners, tail, center: [cx, cy] };
  return {
    quad: corners.map((p) => rotateAbout(p, cx, cy, a)),
    tail: tail ? tail.map((p) => rotateAbout(p, cx, cy, a)) : null,
    center: [cx, cy],
  };
}

/** 多边形外接矩形。 */
export function polyAABB(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** 多边形覆盖到的墨迹像素数（把多边形栅格化成蒙版再与墨迹蒙版求交）。 */
export function polyInkCount(mask, poly) {
  const [x0, y0, x1, y1] = polyAABB(poly).map((v) => Math.round(v));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x - x0, y - y0) : ctx.moveTo(x - x0, y - y0)));
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();
  const d = ctx.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    const gy = y0 + y;
    if (gy < 0 || gy >= mask.H) continue;
    for (let x = 0; x < w; x += 1) {
      if (d[(y * w + x) * 4 + 3] < 128) continue;
      const gx = x0 + x;
      if (gx < 0 || gx >= mask.W) continue;
      if (mask.data[gy * mask.W + gx]) n += 1;
    }
  }
  return n;
}

/** 多边形到最近墨迹的距离：先判相交，再沿边按 1px 采样查距离场。 */
export function polyGap(field, mask, poly) {
  if (polyInkCount(mask, poly) > 0) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      best = Math.min(best, fieldAt(field, ax + (bx - ax) * t, ay + (by - ay) * t));
      if (best === 0) return 0;
    }
  }
  return best;
}

/**
 * 素材墨迹蒙版（画布分辨率）。
 * 返回 { W, H, data: Uint8Array }，data[i] = 1 表示该画布像素上有素材墨迹。
 *
 * 关键：这里**复用渲染器的 drawAsset**（同一个缩放 / flip / opacity / rotate 路径），
 * 而不是自己再实现一遍变换 —— 否则 `flip: true` 或 `rotate` 的素材会出现
 * 「渲染在左边、机检在右边」的口径漂移（蒙版与像素对不上，净空检查全失真）。
 */
export async function inkMask(root, layout) {
  const W = layout.width;
  const H = layout.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const el of layout.elements || []) {
    if (el.type !== 'asset') continue;
    const p = path.join(root, 'assets', el.file || '');
    if (!fs.existsSync(p)) continue;
    await drawAsset(canvas, ctx, root, el, true);   // 缺失素材画占位框（与 render 同口径）
  }
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    if (isInk(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3])) mask[i] = 1;
  }
  return { W, H, data: mask };
}

export function inkCount(mask, rect) {
  const [x0, y0, x1, y1] = rect.map((v) => Math.round(v));
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(mask.H, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(mask.W, x1); x += 1) {
      if (mask.data[y * mask.W + x]) n += 1;
    }
  }
  return n;
}

/** 到最近墨迹的距离场（Chamfer 两遍扫描，O(W*H)，比逐点暴力快几个数量级）。 */
export function distanceField(mask) {
  const { W, H, data } = mask;
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) d[i] = data[i] ? 0 : INF;
  const D1 = 1.0;
  const D2 = Math.SQRT2;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? INF : d[y * W + x]);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + D1, at(x, y - 1) + D1,
        at(x - 1, y - 1) + D2, at(x + 1, y - 1) + D2);
    }
  }
  for (let y = H - 1; y >= 0; y -= 1) {
    for (let x = W - 1; x >= 0; x -= 1) {
      const i = y * W + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + D1, at(x, y + 1) + D1,
        at(x + 1, y + 1) + D2, at(x - 1, y + 1) + D2);
    }
  }
  return { W, H, d };
}

export function fieldAt(field, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= field.W || yi >= field.H) return Infinity;
  return field.d[yi * field.W + xi];
}

/** rect 到最近墨迹的距离：先快速判相交，再用距离场查四角/边中点的最小值下界。 */
export function rectGapFast(field, mask, rect) {
  const [x0, y0, x1, y1] = rect;
  if (inkCount(mask, rect) > 0) return 0;
  let best = Infinity;
  const xs = [];
  const ys = [];
  const step = Math.max(1, Math.round(Math.min(x1 - x0, y1 - y0) / 8) || 1);
  for (let x = Math.round(x0); x <= Math.round(x1); x += step) xs.push(x);
  for (let y = Math.round(y0); y <= Math.round(y1); y += step) ys.push(y);
  for (const x of xs) {
    for (const y of [Math.round(y0) - 1, Math.round(y1) + 1]) best = Math.min(best, fieldAt(field, x, y));
  }
  for (const y of ys) {
    for (const x of [Math.round(x0) - 1, Math.round(x1) + 1]) best = Math.min(best, fieldAt(field, x, y));
  }
  // 边界采样是下界近似：再对四个角取精确值补充
  for (const x of [Math.round(x0), Math.round(x1)]) {
    for (const y of [Math.round(y0), Math.round(y1)]) best = Math.min(best, fieldAt(field, x, y));
  }
  return best;
}

export function textWidth(line, el, theme) {
  const size = el.size ?? 40;
  const family = el.font ?? 'body';
  const bold = el.bold ?? false;
  let w = 0;
  for (const [ch, st] of line) {
    const f = st === 'warn' ? 'brush' : family;
    const b = st === 'hl' || st === 'quote' || st === 'warn' ? true : bold;
    const sz = st === 'warn' ? Math.round(size * 1.08) : size;
    w += charWidth(ch, sz, b, f);
  }
  return w;
}
