// 排版几何机检适配器：真实字体度量下的
// 折行行数 / 行宽越界 / 孤字行 / 越界 + 插图带高占比。
//   node pipeline/canvas/checks/geom.mjs layout/block1.json [...]
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspectLayout } from './inspect.mjs';
import { blockGeom, setFonts, KINSOKU, lineWidth } from '../lib/text.mjs';
import { pngSize } from '../lib/geom.mjs';
import { parseArgs, requireFiles } from '../lib/cli.mjs';

function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export async function checkGeom(file) {
  const rep = await inspectLayout(file, { rules: ['geom'], verbose: true });
  if (rep.logs.length) console.log(rep.logs.join('\n'));
  return rep.summary.geom.problems;
}

export { blockGeom, setFonts, KINSOKU, lineWidth, pngSize };

if (isMain(import.meta.url)) {
  const { files, errors } = parseArgs(process.argv.slice(2));
  requireFiles(files, errors, '用法：node pipeline/canvas/checks/geom.mjs layout/block1.json [...]');
  let bad = 0;
  for (const f of files) bad += await checkGeom(f);
  process.exit(bad ? 1 : 0);
}
