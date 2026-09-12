// 像素级遮挡机检（check_occlusion.py 的 Canvas 对应实现）：
// 每个带 box 的文字元素（含 tail 三角）落在素材像素坐标里，统计
//   · 压盖素材墨迹面积 px（>120 判为硬伤）
//   · 到最近墨迹的净空 px（<40 提示）
//   node pipeline/canvas/checks/occlusion.mjs layout/block1.json [...]
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { Image } from '@napi-rs/canvas';
import { bubbleRect, tailTri, inkCount, rectGapFast, distanceField, fieldAt, parseArgs } from '../lib/geom.mjs';
import { findRoot, readJson, readTheme } from '../lib/paths.mjs';
import { setFonts } from '../lib/text.mjs';

/** 入口守卫：项目里 scripts/canvas 是软链，import.meta.url 与 argv[1] 不同名，
 *  必须用 realpath 比较，否则 `node scripts/canvas/render.mjs ...` 会静默什么都不做。 */
function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}


const BLOCK_MIN_GAP = 40;

async function loadMasks(root, layout) {
  const out = [];
  for (const el of layout.elements || []) {
    if (el.type !== 'asset') continue;
    const p = path.join(root, 'assets', el.file);
    if (!fs.existsSync(p)) continue;
    const img = new Image();
    img.src = fs.readFileSync(p);
    await img.decode();
    let w = el.width;
    let h = el.height;
    if (h != null) w = (img.width * h) / img.height;
    else if (w != null) h = (img.height * w) / img.width;
    else {
      w = img.width;
      h = img.height;
    }
    const { createCanvas } = await import('../lib/draw.mjs');
    const cw = Math.max(1, Math.round(w));
    const ch = Math.max(1, Math.round(h));
    const c = createCanvas(cw, ch);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    const rgba = ctx.getImageData(0, 0, cw, ch).data;
    const data = new Uint8Array(cw * ch);
    for (let i = 0; i < cw * ch; i += 1) {
      const a = rgba[i * 4 + 3];
      const lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
      data[i] = a > 40 && lum < 235 ? 1 : 0;
    }
    const a = el.anchor ?? 'cc';
    const left = a[0] === 'c' ? el.x - w / 2 : a[0] === 'r' ? el.x - w : el.x;
    const top = a[1] === 'c' ? el.y - h / 2 : a[1] === 'b' ? el.y - h : el.y;
    out.push({ file: el.file, mask: { W: cw, H: ch, data }, left, top, field: distanceField({ W: cw, H: ch, data }) });
  }
  return out;
}

export async function occlusion(file) {
  const root = findRoot(file);
  const data = readJson(file);
  const theme = readTheme(root, data);
  setFonts(root, theme.fonts);
  const assets = await loadMasks(root, data);
  console.log(`\n=== ${file} ===`);
  let bad = 0;
  for (const [i, el] of (data.elements || []).entries()) {
    if (el.type !== 'text' || !el.box) continue;
    const rect = bubbleRect(el, data.width, theme);
    const tri = tailTri(el, rect, theme);
    const label = (el.content || '').replace(/\n/g, ' ').slice(0, 14);
    let over = 0;
    let gap = Infinity;
    for (const a of assets) {
      const lx = [rect[0] - a.left, rect[1] - a.top, rect[2] - a.left, rect[3] - a.top];
      over = Math.max(over, inkCount(a.mask, lx));
      gap = Math.min(gap, rectGapFast(a.field, a.mask, lx));
      if (tri) {
        const tb = [Math.min(...tri.map((p) => p[0])), Math.min(...tri.map((p) => p[1])),
          Math.max(...tri.map((p) => p[0])), Math.max(...tri.map((p) => p[1]))];
        const tx = [tb[0] - a.left, tb[1] - a.top, tb[2] - a.left, tb[3] - a.top];
        over = Math.max(over, inkCount(a.mask, tx));
        gap = Math.min(gap, rectGapFast(a.field, a.mask, tx));
      }
    }
    const flags = [];
    if (over > 120) {
      flags.push(`压盖 ${over}px !!`);
      bad += 1;
    } else if (over > 0) flags.push(`擦到墨迹 ${over}px`);
    if (gap < BLOCK_MIN_GAP) flags.push(`净空 ${Number.isFinite(gap) ? Math.round(gap) : '∞'}px (<${BLOCK_MIN_GAP})`);
    if (!assets.length) {
      console.log(`  [${i}] 「${label}」 未与素材相交`);
      continue;
    }
    console.log(`  [${i}] 「${label}」 压盖=${over}px 净空=${Number.isFinite(gap) ? Math.round(gap) : '∞'}px  ${flags.join(' ')}`);
  }
  console.log(`\n[occlusion] 压盖硬伤 = ${bad}`);
  return bad;
}

if (isMain(import.meta.url)) {
  const { files } = parseArgs(process.argv.slice(2));
  let bad = 0;
  for (const f of files) bad += await occlusion(f);
  process.exit(bad ? 1 : 0);
}
