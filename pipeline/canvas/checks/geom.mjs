// 排版几何机检（check_geom.py 的 Canvas 对应实现）：真实字体度量下的
// 折行行数 / 行宽越界 / 孤字行 / 越界 + 插图带高占比。
//   node pipeline/canvas/checks/geom.mjs layout/block1.json [...]
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { blockGeom, setFonts, KINSOKU, lineWidth } from '../lib/text.mjs';
import { pngSize, parseArgs, requireFiles } from '../lib/geom.mjs';
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
      const sz = fs.existsSync(p) ? pngSize(p) : null;
      if (sz) {
        iw = sz.w;
        ih = sz.h;
      } else if (fs.existsSync(p)) {
        console.log(`  [asset ${i}] ${el.file} 非 PNG/JPEG，尺寸按 1024x1024 估`);
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
      const lh = geo.lh;                       // 与渲染同一口径（blockGeom 的 lh）
      const bottom = (el.y ?? 0) + lh * geo.lines.length;
      const pad = el.box?.pad ?? theme.bubble?.pad ?? 0;
      const py = Array.isArray(pad) ? pad[0] : pad;
      let flag = '';
      if (geo.lines.length !== explicit) {
        flag += `  << 自动折行 ${explicit}->${geo.lines.length}（改文案或加宽 max_width）`;
        problems += 1;
      }
      // 空行不是孤字行（显式 \n 留下的空行由作者有意为之，只提示折行行数差）
      const orphans = geo.lines
        .map((r) => r.map((c) => c[0]).join(''))
        .filter((s) => s.length > 0 && [...s].length <= 2);
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
        const limit = el.max_width ?? 940;
        // 避头点是有意的「悬挂标点」：行尾的 ，。！？ 允许溢出 max_width 一个字宽。
        // 只有扣掉行尾悬挂标点后仍然超宽，才算真正的行宽越界。
        const line = geo.lines[k].map((c) => c[0]).join('');
        let tail = line.length;
        while (tail > 0 && KINSOKU.includes(line[tail - 1])) tail -= 1;
        const core = tail === 0
          ? 0
          : lineWidth(geo.lines[k].slice(0, tail), geo.size, geo.bold, geo.family);
        if (core > limit + 1) {
          console.log(`      !! line${k}: ${Math.round(wv)}px > max_width ${limit} 「${line}」`);
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
  const { files, errors } = parseArgs(process.argv.slice(2));
  requireFiles(files, errors, '用法：node pipeline/canvas/checks/geom.mjs layout/block1.json [...]');
  let n = 0;
  for (const f of files) n += checkGeom(f);
  console.log(`\n[geom] 问题项 = ${n}`);
  // 与 lint / occlusion / clearance 同一口径：有问题就以非 0 退出，机检链才拦得住
  process.exit(n ? 1 : 0);
}
