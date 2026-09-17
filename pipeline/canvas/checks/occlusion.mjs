// 像素级遮挡机检适配器：
// 每个带 box 的文字元素（含 tail 三角）投到画布墨迹蒙版上，统计
//   · 压盖素材墨迹面积 px（>120 判为硬伤）
//   · 到最近墨迹的净空 px（<40 提示）
//   node pipeline/canvas/checks/occlusion.mjs layout/block1.json [...]
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspectLayout } from './inspect.mjs';
import { parseArgs, requireFiles } from '../lib/cli.mjs';

function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export async function occlusion(file) {
  const rep = await inspectLayout(file, { rules: ['occlusion'], verbose: true });
  if (rep.logs.length) console.log(rep.logs.join('\n'));
  return rep.summary.occlusion.bad;
}

if (isMain(import.meta.url)) {
  const { files, errors } = parseArgs(process.argv.slice(2));
  requireFiles(files, errors, '用法：node pipeline/canvas/checks/occlusion.mjs layout/block1.json [...]');
  let bad = 0;
  for (const f of files) bad += await occlusion(f);
  process.exit(bad ? 1 : 0);
}
