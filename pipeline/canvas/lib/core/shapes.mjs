// 同构矢量绘制与气泡图表原语（Node 与浏览器完全共享）
import { charColor } from './tokens.mjs';

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
 * 气泡/标签底板（八种形制 + 8 向 tail）。
 *   fill | pill | outline | sketch | ink | stamp | burst | marker
 */
export function paintBox(ctx, rect, el, theme) {
  const box = { ...(theme?.bubble || {}), ...(el.box || {}) };
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
export function paintParagraph(ctx, para, el, theme, box, fontStrFn) {
  const sw = el.stroke_width ?? 0;
  const sf = el.stroke_fill ?? '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const row of para.rows) {
    for (const c of row.chars) {
      ctx.font = fontStrFn(c.sz, c.b, c.f);
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

export function drawBarChart(ctx, el, theme, fontStrFn) {
  const x = el.x;
  const y = el.y;
  const bw = el.width;
  const bh = el.bar_height ?? 56;
  const gap = el.gap ?? 36;
  const lw = el.label_width ?? 200;
  const mx = el.max ?? Math.max(...(el.items || []).map((i) => i.value));
  const barC = el.bar_color ?? '#3182CE';
  const track = el.track;
  const fL = el.label_size ?? 30;
  const fV = el.value_size ?? 30;
  ctx.textBaseline = 'middle';
  (el.items || []).forEach((it, i) => {
    const ry = y + i * (bh + gap);
    ctx.font = fontStrFn(fL, true, el.font ?? 'body');
    ctx.fillStyle = el.label_color ?? theme?.text ?? '#333333';
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
    ctx.font = fontStrFn(fV, true, el.font ?? 'body');
    ctx.fillStyle = it.color ?? barC;
    ctx.fillText(String(it.text ?? it.value), bx0 + fillW + 14, ry + bh / 2);
  });
  return [x, y, x + bw, y + (el.items || []).length * (bh + gap)];
}

export function drawPieChart(ctx, el, theme, fontStrFn) {
  const { cx, cy, r } = el;
  const items = el.items || [];
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
    ctx.fillStyle = el.hole_color ?? theme?.bg ?? '#FFFFFF';
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
    ctx.font = fontStrFn(lsz, true, el.font ?? 'body');
    ctx.fillStyle = el.label_color ?? theme?.text ?? '#333333';
    ctx.fillText(`${it.label}  ${it.text ?? it.value}`, lx + 38, ly + 2);
  });
  return [cx - r, cy - r, cx + r + 40 + 420, cy + r];
}

export function drawTable(ctx, el, theme, fontStrFn) {
  const { x, y } = el;
  const cw = el.col_widths || [100];
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
      const ccol = isH ? el.header_color ?? '#FFFFFF' : el.cell_color ?? theme?.text ?? '#333333';
      const al = aligns ? aligns[ci] : 'center';
      const fam = isH ? 'title' : 'body';
      ctx.font = fontStrFn(size, isH, fam);
      ctx.fillStyle = ccol;
      ctx.textAlign = al === 'center' ? 'center' : 'left';
      ctx.fillText(String(cell), al === 'center' ? cxCell + cw[ci] / 2 : cxCell + 18, ry + rh / 2);
      cxCell += cw[ci];
    });
  });
  return [x, y, x + totalW, y + rows.length * rh];
}

export function drawArrow(ctx, el) {
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
