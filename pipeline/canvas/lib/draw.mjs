// 绘图原语：几何口径与 lib/geom.mjs、渲染主循环严格一致。
import { createCanvas, Image } from '@napi-rs/canvas';
import fs from 'node:fs';
import { fontStr, charWidth, MARKERS } from './text.mjs';

// 统一从这里出口：全流水线只允许有一个 canvas 模块实例。
// （两处分别 import '@napi-rs/canvas' 可能解析到不同副本——CJS/ESM 各一份——
//  于是 drawImage 会因为 `img instanceof Image` 跨实例判定失败而报
//  "Value is not one of these types: CanvasElement, SVGCanvas, Image"。）
export { createCanvas, Image };
export const canvasModuleVersion = 'napi-rs/skia';

export const SC = 1; // 坐标口径即输出像素（layout 就是 1080 宽的口径）

export function makeCanvas(w, h, bg = '#FFFFFF') {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
  return c;
}

export function withAlpha(ctx, a, fn) {
  ctx.save();
  ctx.globalAlpha = a;
  fn();
  ctx.restore();
}

/**
 * 语义三色：hl 橙 / quote 蓝 / warn 红；未标记的字用元素色。
 *
 * 兜底顺序必须与 compose.char_color 一致：`el.color → el.box.color → theme.text`。
 * 注意第三级读的是**元素自带的 box**，不是「主题 bubble 默认值合并后」的 box ——
 * 主题 bubble 的 color 是给气泡用的暖褐色(#4A2800)，若让它兜底，正文和标题会被整体
 * 染成暖褐（实测踩过：全图正文渲成 #4A2800，而 style.json 声明的是 #333333）。
 */
export function charColor(el, st, theme, box) {
  if (st === 'hl') return el.hl_color ?? theme.hl_color ?? '#E8842B';
  if (st === 'quote') return el.quote_color ?? theme.quote_color ?? '#2E7CB8';
  if (st === 'warn') return el.warn_color ?? theme.warn_color ?? '#D4483B';
  return el.color ?? el.box?.color ?? theme.text ?? '#333333';
}

export function roundRectPath(ctx, x0, y0, x1, y1, r) {
  ctx.beginPath();
  ctx.roundRect(x0, y0, x1 - x0, y1 - y0, Math.max(0, r));
}

export function polyPath(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

export function drawPoly(ctx, pts, fill, stroke, lineWidth = 3) {
  polyPath(ctx, pts);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * 气泡/标签底板（八种形制）。
 *   fill | pill | outline | sketch | ink | stamp | burst | marker
 * box.tail: bl|bc|br|tl|tc|tr|lc|rc —— 小三角指向发话实体。
 */
export function paintBox(ctx, rect, el, theme) {
  const box = { ...(theme.bubble || {}), ...(el.box || {}) };
  const style = box.style ?? 'fill';
  const [x0, y0, x1, y1] = rect;
  const bg = box.bg ?? '#F6A83C';
  const bc = box.border_color ?? '#1A1A1A';
  const border = box.border ?? 4;
  let radius = box.radius ?? 16;
  if (style === 'pill') radius = (y1 - y0) / 2;
  const solid = ['fill', 'pill', 'marker', 'ink'].includes(style);

  if (solid) {
    roundRectPath(ctx, x0, y0, x1, y1, radius);
    ctx.fillStyle = bg;
    ctx.fill();
  } else if (style === 'outline') {
    roundRectPath(ctx, x0, y0, x1, y1, radius);
    ctx.fillStyle = box.fill ?? '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = bc;
    ctx.lineWidth = border;
    ctx.stroke();
  } else if (style === 'sketch') {
    roundRectPath(ctx, x0, y0, x1, y1, radius);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = bc;
    ctx.lineWidth = 3;
    ctx.stroke();
    roundRectPath(ctx, x0 + 4, y0 + 4, x1 - 4, y1 - 4, Math.max(4, radius - 6));
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (style === 'stamp') {
    roundRectPath(ctx, x0, y0, x1, y1, Math.max(8, radius / 2));
    ctx.strokeStyle = bc;
    ctx.lineWidth = 5;
    ctx.stroke();
  } else if (style === 'burst') {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = ((x1 - x0) / 2) * 1.3;
    const ry = ((y1 - y0) / 2) * 1.45;
    const n = 12;
    const pts = [];
    for (let k = 0; k < n * 2; k += 1) {
      const ang = (Math.PI * k) / n;
      const f = k % 2 === 0 ? 1.0 : 0.73;
      pts.push([cx + rx * f * Math.cos(ang), cy + ry * f * Math.sin(ang)]);
    }
    drawPoly(ctx, pts, bg, null);
  }

  const tail = box.tail;
  if (tail) {
    const th = box.tail_len ?? 26;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    let p = [];
    let bx = 0;
    let by = 0;
    let vertical = true;
    if (['bl', 'bc', 'br'].includes(tail)) {
      by = y1 - 2;
      const tipY = y1 + th;
      if (tail === 'bl') p = [[x0 + 12, by], [x0 + 44, by], [x0 + 2, tipY]];
      else if (tail === 'br') p = [[x1 - 12, by], [x1 - 44, by], [x1 - 2, tipY]];
      else p = [[cx - 16, by], [cx + 16, by], [cx, tipY]];
    } else if (['tl', 'tc', 'tr'].includes(tail)) {
      by = y0 + 2;
      const tipY = y0 - th;
      if (tail === 'tl') p = [[x0 + 12, by], [x0 + 44, by], [x0 + 2, tipY]];
      else if (tail === 'tr') p = [[x1 - 12, by], [x1 - 44, by], [x1 - 2, tipY]];
      else p = [[cx - 16, by], [cx + 16, by], [cx, tipY]];
    } else if (tail === 'lc' || tail === 'rc') {
      vertical = false;
      bx = tail === 'lc' ? x0 + 2 : x1 - 2;
      const tipX = tail === 'lc' ? x0 - th : x1 + th;
      p = [[bx, cy - 16], [bx, cy + 16], [tipX, cy]];
    }
    if (p.length) {
      const tailFill = solid ? bg : (box.fill ?? '#FFFFFF');
      drawPoly(ctx, p, tailFill, solid ? null : bc, 3);
      if (!solid) {
        // 用底色小补丁盖住三角与气泡框共用的那条边，让 tail 与气泡连成一体
        if (vertical) {
          const sx0 = Math.min(p[0][0], p[1][0]);
          const sx1 = Math.max(p[0][0], p[1][0]);
          ctx.fillStyle = tailFill;
          ctx.fillRect(sx0 + 2, by - 5, sx1 - sx0 - 4, 10);
        } else {
          const sy0 = Math.min(p[0][1], p[1][1]);
          const sy1 = Math.max(p[0][1], p[1][1]);
          ctx.fillStyle = tailFill;
          ctx.fillRect(bx - 5, sy0 + 2, 10, sy1 - sy0 - 4);
        }
      }
    }
  }
  return rect;
}

/** 逐字绘制段落（每字单独定位，按累计宽度）。 */
export function paintParagraph(ctx, para, el, theme, box) {
  const sw = el.stroke_width ?? 0;
  const sf = el.stroke_fill ?? '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const row of para.rows) {
    for (const c of row.chars) {
      ctx.font = fontStr(c.sz, c.b, c.f);
      ctx.fillStyle = charColor(el, c.st, theme, box);
      if (sw > 0) {
        ctx.lineWidth = sw * 2;
        ctx.strokeStyle = sf;
        ctx.lineJoin = 'round';
        ctx.strokeText(c.ch, c.x, row.baseline);
      }
      ctx.fillText(c.ch, c.x, row.baseline);
    }
  }
}

export function measureTextWidth(ch, size, bold, family) {
  return charWidth(ch, size, bold, family);
}

/** 从磁盘读 RGBA 图（透明 PNG 直接可用）。
 *
 * 注意：@napi-rs/canvas 里 `img.src = buffer` 只完成解码登记，**像素数据要等 decode()**；
 * 不 await 直接 drawImage 会得到一张全白画布（本项目实测踩坑）。故本函数是 async。 */
export async function loadImageFile(path) {
  const img = new Image();
  img.src = fs.readFileSync(path);
  await img.decode();
  return img;
}

/** 缺失素材占位框：虚线框 + 文件名（口径与真实素材一致，坐标可读）。 */
export function missingPlaceholder(ctx, el) {
  const w = Math.round(el.width ?? 360);
  const h = Math.round(el.height ?? 360);
  const anchor = el.anchor ?? 'cc';
  const { left, top } = anchorPos(el.x, el.y, w, h, anchor);
  ctx.save();
  ctx.setLineDash([9, 9]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(220,60,60,0.67)';
  ctx.strokeRect(left, top, w, h);
  ctx.restore();
  const label = `[缺素材] ${el.file}`;
  ctx.font = fontStr(26, true, 'body');
  const tw = ctx.measureText(label).width;
  const tx = left + Math.max(0, (w - tw) / 2);
  const ty = top + Math.max(0, (h - 40) / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillRect(tx - 8, ty - 4, tw + 16, 40);
  ctx.fillStyle = 'rgb(200,40,40)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, tx, ty + 26);
  return [left, top, left + w, top + h];
}

export function anchorPos(x, y, w, h, anchor = 'cc') {
  const left = anchor[0] === 'c' ? x - w / 2 : anchor[0] === 'r' ? x - w : x;
  const top = anchor[1] === 'c' ? y - h / 2 : anchor[1] === 'b' ? y - h : y;
  return { left, top };
}

export { MARKERS };
