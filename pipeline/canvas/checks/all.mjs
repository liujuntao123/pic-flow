// 四条机检的统一闸门：一次跑完 lint / geom / occlusion / clearance，任一不过即非 0 退出。
//
//   node pipeline/canvas/checks/all.mjs layout/block1.json [layout/block2.json ...]
//
// 为什么要有它：SKILL.md 要求「素材侧与排版侧两组机检全绿才进审查」，
// 而四条检查是四个独立命令 —— 用 `&&` 串起来一旦有人漏写一条（或某条被改成
// 永远 exit 0），机检链就静默失效。这里把四条绑在同一个退出码上。
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

/** @returns {Promise<{lint:number, geom:number, occlusion:number, clearance:number, ok:boolean}>} */
export async function checkAll(files) {
  const totals = { lint: 0, geom: 0, occlusion: 0, clearance: 0 };
  for (const f of files) {
    const report = await inspectLayout(f, { verbose: true });
    if (report.logs.length) console.log(report.logs.join('\n'));
    totals.lint += report.summary.lint.hard;
    totals.geom += report.summary.geom.problems;
    totals.occlusion += report.summary.occlusion.bad;
    totals.clearance += report.summary.clearance.bad;
  }
  const ok = Object.values(totals).every((v) => v === 0);
  console.log(`\n[checks] ${files.length} 块 · lint=${totals.lint} geom=${totals.geom} `
    + `occlusion=${totals.occlusion} clearance=${totals.clearance} → ${ok ? 'PASS' : 'FAIL'}`);
  return { ...totals, ok };
}

if (isMain(import.meta.url)) {
  const { files, errors } = parseArgs(process.argv.slice(2));
  requireFiles(files, errors, '用法：node pipeline/canvas/checks/all.mjs layout/block1.json [...]');
  const res = await checkAll(files);
  process.exit(res.ok ? 0 : 1);
}
