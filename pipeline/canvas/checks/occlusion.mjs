// 像素级遮挡机检：
// 每个带 box 的文字元素（含 tail 三角）投到**画布墨迹蒙版**上，统计
//   · 压盖素材墨迹面积 px（>120 判为硬伤）
//   · 到最近墨迹的净空 px（<40 提示）
//   node pipeline/canvas/checks/occlusion.mjs layout/block1.json [...]
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  bubbleQuad, polyInkCount, polyGap, inkMask, distanceField, parseArgs, requireFiles,
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


const BLOCK_MIN_GAP = 40;

export async function occlusion(file) {
  const root = findRoot(file);
  const data = readJson(file);
  const theme = readTheme(root, data);
  setFonts(root, theme.fonts);
  // 与 clearance 共用同一张画布墨迹蒙版（渲染器同一条变换路径 + 同一墨迹判据）
  const mask = await inkMask(root, data);
  const field = distanceField(mask);
  console.log(`\n=== ${file} ===`);
  let bad = 0;
  const anyAsset = (data.elements || []).some((el) => el.type === 'asset');
  for (const [i, el] of (data.elements || []).entries()) {
    if (el.type !== 'text' || !el.box) continue;
    const { quad, tail } = bubbleQuad(el, data.width, theme);
    const label = (el.content || '').replace(/\n/g, ' ').slice(0, 14);
    let over = polyInkCount(mask, quad);
    let gap = polyGap(field, mask, quad);
    if (tail) {
      over += polyInkCount(mask, tail);
      gap = Math.min(gap, polyGap(field, mask, tail));
    }
    const flags = [];
    if (over > 120) {
      flags.push(`压盖 ${over}px !!`);
      bad += 1;
    } else if (over > 0) flags.push(`擦到墨迹 ${over}px`);
    if (gap < BLOCK_MIN_GAP) flags.push(`净空 ${Number.isFinite(gap) ? Math.round(gap) : '∞'}px (<${BLOCK_MIN_GAP})`);
    if (!anyAsset) {
      console.log(`  [${i}] 「${label}」 未与素材相交`);
      continue;
    }
    console.log(`  [${i}] 「${label}」 压盖=${over}px 净空=${Number.isFinite(gap) ? Math.round(gap) : '∞'}px  ${flags.join(' ')}`);
  }
  console.log(`\n[occlusion] 压盖硬伤 = ${bad}`);
  return bad;
}

if (isMain(import.meta.url)) {
  const { files, errors } = parseArgs(process.argv.slice(2));
  requireFiles(files, errors, '用法：node pipeline/canvas/checks/occlusion.mjs layout/block1.json [...]');
  let bad = 0;
  for (const f of files) bad += await occlusion(f);
  process.exit(bad ? 1 : 0);
}
