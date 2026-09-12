// 静态布局质量检查（layout_lint.py 的 Canvas 对应实现）。
//   node pipeline/canvas/checks/lint.mjs layout/block1.json [...]
// hard 必须为 0，warnings 供视觉复核。
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blockGeom } from '../lib/text.mjs';
import { elemBox, overlapArea, textWidth, parseArgs } from '../lib/geom.mjs';
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


export function lint(path) {
  const root = findRoot(path);
  const data = readJson(path);
  const theme = readTheme(root, data);
  setFonts(root, theme.fonts);
  const W = data.width;
  const H = data.height;
  const els = data.elements || [];
  let hard = 0;
  let warn = 0;
  const boxes = [];
  els.forEach((e, i) => {
    const b = elemBox(e, root, W, theme);
    if (!b) return;
    boxes.push([i, e, b]);
    if (b[0] < -40 || b[1] < -40 || b[2] > W + 40 || b[3] > H + 40) {
      console.log(`WARN ${path} [${i}] ${e.type}: 越出画布边界 [${b.map((v) => Math.round(v)).join(',')}]`);
      warn += 1;
    }
  });
  for (let ai = 0; ai < boxes.length; ai += 1) {
    for (let bi = ai + 1; bi < boxes.length; bi += 1) {
      const [i, a, ba] = boxes[ai];
      const [j, b, bb] = boxes[bi];
      if (a.type === 'rule' || b.type === 'rule' || a.type === 'arrow' || b.type === 'arrow') continue;
      const area = overlapArea(ba, bb);
      if (area <= 0) continue;
      if (a.type === 'asset' && b.type === 'asset') continue;
      if (a.type === 'card' || b.type === 'card') continue;
      const ratio = area / Math.max(1, Math.min((ba[2] - ba[0]) * (ba[3] - ba[1]), (bb[2] - bb[0]) * (bb[3] - bb[1])));
      const assetText = new Set([a.type, b.type]).size === 2
        && [a.type, b.type].includes('asset') && [a.type, b.type].includes('text');
      // 真实几何下的轻微擦边（每边 <8px）只预警：视觉上不可见，不必打断流水线
      const dx = Math.min(ba[2], bb[2]) - Math.max(ba[0], bb[0]);
      const dy = Math.min(ba[3], bb[3]) - Math.max(ba[1], bb[1]);
      const graze = dx < 8 || dy < 8;
      const level = assetText || ratio < 0.12 || graze ? 'WARN' : 'ERROR';
      console.log(`${level} ${path} [${i},${j}]: ${a.type} 与 ${b.type} 重叠 ${(ratio * 100).toFixed(0)}%`);
      if (level === 'ERROR') hard += 1;
      else warn += 1;
    }
  }
  const centered = els.filter((e) => e.type === 'text' && (e.align ?? 'center') === 'center').length;
  const texts = els.filter((e) => e.type === 'text').length;
  if (texts && centered / texts > 0.8) {
    console.log(`WARN ${path}: ${centered}/${texts} 个文本居中，缺少对齐对比`);
    warn += 1;
  }
  console.log(`[lint] ${path}: ${hard ? 'FAIL' : 'OK'}, hard=${hard}, warnings=${warn}`);
  return hard ? 1 : 0;
}

export { blockGeom, textWidth };

if (isMain(import.meta.url)) {
  const { files } = parseArgs(process.argv.slice(2));
  let rc = 0;
  for (const f of files) rc = Math.max(rc, lint(f));
  process.exit(rc);
}
