// 静态布局质量检查适配器
//   node pipeline/canvas/checks/lint.mjs layout/block1.json [...]
// hard 必须为 0，warnings 供视觉复核。
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspectLayout } from './inspect.mjs';
import { blockGeom } from '../lib/text.mjs';
import { textWidth } from '../lib/geom.mjs';
import { parseArgs, requireFiles } from '../lib/cli.mjs';

function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export async function lint(path) {
  const rep = await inspectLayout(path, { rules: ['lint'], verbose: true });
  if (rep.logs.length) console.log(rep.logs.join('\n'));
  return {
    hard: rep.summary.lint.hard,
    warn: rep.summary.lint.warn,
    code: rep.summary.lint.hard ? 1 : 0,
  };
}

export { blockGeom, textWidth };

if (isMain(import.meta.url)) {
  const { files, errors } = parseArgs(process.argv.slice(2));
  requireFiles(files, errors, '用法：node pipeline/canvas/checks/lint.mjs layout/block1.json [...]');
  let rc = 0;
  for (const f of files) {
    const res = await lint(f);
    rc = Math.max(rc, typeof res === 'object' ? res.code : res);
  }
  process.exit(rc);
}
