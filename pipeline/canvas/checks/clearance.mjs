// 严格净空机检适配器（画布像素口径）：
// 气泡多边形（含 tail 三角，斜置时按真实旋转四边形）vs 素材墨迹。
// 红线：压盖 0 px、净空 ≥40 px。
//   node pipeline/canvas/checks/clearance.mjs layout/block1.json [...]
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

export async function clearance(file) {
  const rep = await inspectLayout(file, { rules: ['clearance'], verbose: true });
  if (rep.logs.length) console.log(rep.logs.join('\n'));
  return rep.summary.clearance.bad;
}

if (isMain(import.meta.url)) {
  const { files, errors } = parseArgs(process.argv.slice(2));
  requireFiles(files, errors, '用法：node pipeline/canvas/checks/clearance.mjs layout/block1.json [...]');
  let bad = 0;
  for (const f of files) bad += await clearance(f);
  process.exit(bad ? 1 : 0);
}
