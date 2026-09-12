// 严格净空机检（check_clearance.py 的 Canvas 对应实现，画布像素口径）：
// 气泡 rect + tail 三角 vs 素材墨迹。红线：压盖 0 px、净空 ≥40 px。
//   node pipeline/canvas/checks/clearance.mjs layout/block1.json [...]
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bubbleRect, tailTri, inkMask, inkCount, distanceField, fieldAt, parseArgs } from '../lib/geom.mjs';
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


const MIN_GAP = 40;

export async function clearance(file) {
  const root = findRoot(file);
  const data = readJson(file);
  const theme = readTheme(root, data);
  setFonts(root, theme.fonts);
  const mask = await inkMask(root, data);
  const field = distanceField(mask);
  console.log(`\n=== ${file} ===`);
  let bad = 0;
  for (const [i, el] of (data.elements || []).entries()) {
    if (el.type !== 'text' || !el.box) continue;
    const rect = bubbleRect(el, data.width, theme);
    const cover = inkCount(mask, rect);
    const tri = tailTri(el, rect, theme);
    let tailCover = 0;
    let tipGap = null;
    if (tri) {
      const tb = [Math.min(...tri.map((p) => p[0])), Math.min(...tri.map((p) => p[1])),
        Math.max(...tri.map((p) => p[0])), Math.max(...tri.map((p) => p[1]))];
      tailCover = inkCount(mask, tb);
      tipGap = fieldAt(field, tri[2][0], tri[2][1]);
    }
    // rect 到墨迹的最近距离（边缘采样 + 四角）
    let rectGap = Infinity;
    const xs = [rect[0], rect[2]];
    const ys = [rect[1], rect[3]];
    for (const x of xs) for (const y of ys) rectGap = Math.min(rectGap, fieldAt(field, x, y));
    const stepX = Math.max(1, Math.round((rect[2] - rect[0]) / 24));
    const stepY = Math.max(1, Math.round((rect[3] - rect[1]) / 24));
    for (let x = rect[0]; x <= rect[2]; x += stepX) {
      rectGap = Math.min(rectGap, fieldAt(field, x, rect[1]), fieldAt(field, x, rect[3]));
    }
    for (let y = rect[1]; y <= rect[3]; y += stepY) {
      rectGap = Math.min(rectGap, fieldAt(field, rect[0], y), fieldAt(field, rect[2], y));
    }
    if (cover > 0) rectGap = 0;
    const label = (el.content || '').replace(/\n/g, ' ').slice(0, 16);
    const flags = [];
    if (cover || tailCover) flags.push(`压盖 rect=${cover}px tail=${tailCover}px`);
    if (tipGap !== null && tipGap < MIN_GAP) flags.push(`tail尖净空=${Math.round(tipGap)}px`);
    if (rectGap < MIN_GAP) flags.push(`rect净空=${Math.round(rectGap)}px`);
    if (flags.length) {
      console.log(`  [${i}] 「${label}」 ${flags.join('  ')}`);
      bad += 1;
    } else {
      console.log(`  [${i}] 「${label}」 净空 OK (rect ${Math.round(rectGap)}px${tipGap !== null ? `, tail尖 ${Math.round(tipGap)}px` : ''})`);
    }
  }
  console.log(`\n[clearance] 净空不足/压盖的元素 = ${bad} 个`);
  return bad;
}

if (isMain(import.meta.url)) {
  const { files } = parseArgs(process.argv.slice(2));
  let bad = 0;
  for (const f of files) bad += await clearance(f);
  process.exit(bad ? 1 : 0);
}
