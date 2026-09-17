// 绘图原语：几何口径与 lib/geom.mjs、渲染主循环严格一致。
import { createCanvas, Image } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fontStr, charWidth, MARKERS } from './text.mjs';
import { charColor } from './core/tokens.mjs';
import {
  roundRectPath,
  polyPath,
  drawPoly,
  paintBox,
  paintParagraph as corePaintParagraph,
} from './core/shapes.mjs';

export {
  charColor,
  roundRectPath,
  polyPath,
  drawPoly,
  paintBox,
};

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

/** 逐字绘制段落（委托同构绘制核心，注入 Skia 字体解析器）。 */
export function paintParagraph(ctx, para, el, theme, box) {
  return corePaintParagraph(ctx, para, el, theme, box, fontStr);
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

/** 等比缩放（多次折半逼近 Lanczos 质量，Skia 单次大比例降采样会糊）。 */
export function scaleImage(img, tw, th) {
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

export async function loadAsset(root, el) {
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

export function rotateLayer(layer, deg, cx, cy, canvas, ctx) {
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

export { MARKERS };
