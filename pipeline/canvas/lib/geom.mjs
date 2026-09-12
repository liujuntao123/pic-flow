// 几何口径：与 compose.py / render.mjs 共用同一套（元素包围盒、气泡 rect、tail 三角、墨迹蒙版）。
// 机检全部建立在这里的几何上，保证「渲染什么就检查什么」。
import path from 'node:path';
import fs from 'node:fs';
import { Image } from '@napi-rs/canvas';
import { blockGeom, charWidth } from './text.mjs';

export function padPair(pad) {
  return Array.isArray(pad) ? [pad[1], pad[0]] : [pad, pad];
}

/**
 * 气泡样式解析（对应 compose.py 的 el_box）：主题默认气泡 + 元素自带 box。
 * 注意：与 Python 版**完全一致**地把主题默认值套到每个文本元素上，
 * 包括主题的 `pad`。要「不要内边距」就在元素上写 `"box": {"pad": 0}`。
 */
export function boxOf(el, theme) {
  return { ...(theme?.bubble || {}), ...(el.box || {}) };
}

/** 元素画布包围盒（与 Python layout_lint.box 同一口径）。 */
export function elemBox(el, root, W, theme) {
  const t = el.type;
  if (t === 'text') {
    // 宽高沿用 layout_lint.py 的**粗估口径**（宽 = min(max_width, max(size*1.2, 字数*size*0.62))、
    // 高 = 行数 * size * line_height，line_height 默认 1.05），且**只有元素自带 box 时才计 pad**，
    // 与 layout_lint.py 逐字一致。这是刻意的：lint 的定位是「快检 + 预先暴露潜在重叠」，
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
      // 旋转元素按真实外接矩形算（Python 版用未旋转框，会漏判斜置气泡的对角侵入）
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
      if (h != null) w = (sz.w * h) / sz.h;
      else if (w != null) h = (sz.h * w) / sz.w;
      else [w, h] = [sz.w, sz.h];
    }
    w = w ?? 360;
    h = h ?? 360;
    const a = el.anchor ?? 'cc';
    const left = a[0] === 'c' ? el.x - w / 2 : a[0] === 'r' ? el.x - w : el.x;
    const top = a[1] === 'c' ? el.y - h / 2 : a[1] === 'b' ? el.y - h : el.y;
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
    const l = el.length;
    return [el.x - 12, el.y - 12, el.x + l + 12, el.y + l + 12];
  }
  return null;
}

/** 只读 PNG 头部拿尺寸（不解码像素，快）。 */
export function pngSize(p) {
  const b = fs.readFileSync(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
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

/** 气泡 rect（含 pad），与 drawText 里 paintBox 的入参一致。 */
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

/**
 * 素材墨迹蒙版（画布分辨率，Float32 便于下采样）。
 * 返回 { W, H, data: Uint8Array }，data[i] = 1 表示该画布像素上有素材墨迹。
 */
export async function inkMask(root, layout) {
  const W = layout.width;
  const H = layout.height;
  const mask = new Uint8Array(W * H);
  for (const el of layout.elements || []) {
    if (el.type !== 'asset') continue;
    const p = path.join(root, 'assets', el.file);
    if (!fs.existsSync(p)) continue;
    const img = new Image();
    img.src = fs.readFileSync(p);
    await img.decode();
    const src = img.width && img.height ? img : null;
    if (!src) continue;
    let w = el.width;
    let h = el.height;
    if (h != null) w = (img.width * h) / img.height;
    else if (w != null) h = (img.height * w) / img.width;
    else {
      w = img.width;
      h = img.height;
    }
    const a = el.anchor ?? 'cc';
    const left = Math.round(a[0] === 'c' ? el.x - w / 2 : a[0] === 'r' ? el.x - w : el.x);
    const top = Math.round(a[1] === 'c' ? el.y - h / 2 : a[1] === 'b' ? el.y - h : el.y);
    // 用离屏画布按目标尺寸重采样一次，再读 alpha（与渲染同一采样路径）
    const { createCanvas } = await import('./draw.mjs');
    const cw = Math.max(1, Math.round(w));
    const ch = Math.max(1, Math.round(h));
    const c = createCanvas(cw, ch);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    for (let y = 0; y < ch; y += 1) {
      const gy = top + y;
      if (gy < 0 || gy >= H) continue;
      for (let x = 0; x < cw; x += 1) {
        const gx = left + x;
        if (gx < 0 || gx >= W) continue;
        if (data[(y * cw + x) * 4 + 3] > 24) mask[gy * W + gx] = 1;
      }
    }
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

export function parseArgs(argv, { allowMany = true } = {}) {
  const debug = argv.includes('--debug');
  const rest = argv.filter((a) => !a.startsWith('--'));
  return { debug, files: allowMany ? rest : rest.slice(0, 1), rest };
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
