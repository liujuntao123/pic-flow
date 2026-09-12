// 排版几何机检（check_geom.py 的 Canvas 对应实现）：真实字体度量下的
// 折行行数 / 行宽越界 / 孤字行 / 越界 + 插图带高占比。
//   node pipeline/canvas/checks/geom.mjs layout/block1.json [...]
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { blockGeom, setFonts } from '../lib/text.mjs';
import { pngSize, parseArgs } from '../lib/geom.mjs';
import { findRoot, readJson, readTheme } from '../lib/paths.mjs';

/** 入口守卫：项目里 scripts/canvas 是软链，import.meta.url 与 argv[1] 不同名，
 *  必须用 realpath 比较，否则 `node scripts/canvas/render.mjs ...` 会静默什么都不做。 */
function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}


export function checkGeom(file) {
  const root = findRoot(file);
  const data = readJson(file);
  const theme = readTheme(root, data);
  setFonts(root, theme.fonts);
  const W = data.width;
  const H = data.height;
  console.log(`\n=== ${file}  ${W}x${H} ===`);
  let imgBand = 0;
  let imgArea = 0;
  let textLines = 0;
  let problems = 0;
  data.elements.forEach((el, i) => {
    if (el.type === 'asset') {
      const p = path.join(root, 'assets', el.file);
      let iw = 1024;
      let ih = 1024;
      if (fs.existsSync(p)) {
        const s = pngSize(p);
        iw = s.w;
        ih = s.h;
      } else {
        console.log(`  [asset ${i}] ${el.file} 缺失，按 1024x1024 估`);
      }
      const w = el.width ?? (iw * el.height) / ih;
      const h = el.height ?? (ih * w) / iw;
      imgBand += h;
      imgArea += w * h;
      console.log(`  [asset ${i}] ${el.file}  ${Math.round(w)}x${Math.round(h)}  bands=${Math.round((h / H) * 100)}%`);
    } else if (el.type === 'text') {
      const geo = blockGeom(el, W, theme);
      const explicit = (el.content || '').split('\n').length;
      textLines += geo.lines.length;
      const lh = (el.size ?? 40) * (el.line_height ?? 1.5);
      const bottom = (el.y ?? 0) + lh * geo.lines.length;
      const pad = el.box?.pad ?? theme.bubble?.pad ?? 0;
      const py = Array.isArray(pad) ? pad[0] : pad;
      let flag = '';
      if (geo.lines.length !== explicit) {
        flag += `  << 自动折行 ${explicit}->${geo.lines.length}（改文案或加宽 max_width）`;
        problems += 1;
      }
      const orphans = geo.lines
        .map((r) => r.map((c) => c[0]).join(''))
        .filter((s) => [...s].length <= 2);
      if (orphans.length) {
        flag += `  孤字行:${JSON.stringify(orphans)}`;
        problems += 1;
      }
      const maxw = Math.max(0, ...geo.widths);
      console.log(`  [text ${i}] size=${el.size ?? 40} lines=${geo.lines.length} y ${el.y ?? 0}->${Math.round(bottom)} maxw=${Math.round(maxw)} panew=${Math.round(maxw + 2 * geo.px)}${flag}`);
      if (bottom + py > H) {
        console.log(`      !! 越界 bottom=${Math.round(bottom + py)} > ${H}`);
        problems += 1;
      }
      geo.widths.forEach((wv, k) => {
        if (wv > (el.max_width ?? 940) + 1) {
          console.log(`      !! line${k}: ${Math.round(wv)}px > max_width ${el.max_width} 「${geo.lines[k].map((c) => c[0]).join('')}」`);
          problems += 1;
        }
      });
    }
  });
  console.log(`  插图带高占比 = ${Math.round((imgBand / H) * 100)}%   插图墨迹面积占比 = ${Math.round((imgArea / (W * H)) * 100)}%   文字总行数 = ${textLines}`);
  if (imgBand / H < 0.55) {
    console.log('  >> 插图带高不足 55%，考虑放大插图或压缩文字');
    problems += 1;
  }
  return problems;
}

if (isMain(import.meta.url)) {
  const { files } = parseArgs(process.argv.slice(2));
  let n = 0;
  for (const f of files) n += checkGeom(f);
  console.log(`\n[geom] 问题项 = ${n}`);
  process.exit(0);
}
