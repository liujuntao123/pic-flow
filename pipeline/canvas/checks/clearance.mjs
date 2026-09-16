// 严格净空机检（画布像素口径）：
// 气泡多边形（含 tail 三角，斜置时按真实旋转四边形）vs 素材墨迹。
// 红线：压盖 0 px、净空 ≥40 px。
//   node pipeline/canvas/checks/clearance.mjs layout/block1.json [...]
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  bubbleQuad, polyInkCount, polyGap, inkMask, distanceField, fieldAt, parseArgs, requireFiles,
} from '../lib/geom.mjs';
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
    // 斜置气泡按**真实旋转四边形**（含 tail）判定，不用旋转外接框：
    // 外接框的四角是气泡外的空白，会把压盖与净空都算错（实测差近一倍）。
    const { quad, tail } = bubbleQuad(el, data.width, theme);
    const cover = polyInkCount(mask, quad);
    let tailCover = 0;
    let tipGap = null;
    if (tail) {
      tailCover = polyInkCount(mask, tail);
      tipGap = fieldAt(field, tail[2][0], tail[2][1]);
    }
    const rectGap = polyGap(field, mask, quad);
    const label = (el.content || '').replace(/\n/g, ' ').slice(0, 16);
    const flags = [];
    if (cover || tailCover) flags.push(`压盖 rect=${cover}px tail=${tailCover}px`);
    if (tipGap !== null && tipGap < MIN_GAP) flags.push(`tail尖净空=${Math.round(tipGap)}px`);
    if (rectGap < MIN_GAP) flags.push(`净空=${Math.round(rectGap)}px`);
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
  const { files, errors } = parseArgs(process.argv.slice(2));
  requireFiles(files, errors, '用法：node pipeline/canvas/checks/clearance.mjs layout/block1.json [...]');
  let bad = 0;
  for (const f of files) bad += await clearance(f);
  process.exit(bad ? 1 : 0);
}
