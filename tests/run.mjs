/**
 * pic-flow 测试总入口：`npm test`
 *
 * 设计原则：
 *  · 不依赖网络与外部服务；需要 Web 服务 / Playwright 的项在不可用时 **SKIP** 并给出提示，
 *    不会把「环境没起」伪装成「通过」。
 *  · 快：只跑一份范例块做引擎冒烟，全量对照交给 `npm run parity`。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXAMPLE = 'examples/huangchao-tang-collapse/layout/block1.json';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const results = [];

function run(name, cmd, args, { skipIf } = {}) {
  if (skipIf) {
    results.push({ name, status: 'SKIP', note: skipIf });
    console.log(`[SKIP] ${name} — ${skipIf}`);
    return;
  }
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  const ok = r.status === 0;
  results.push({ name, status: ok ? 'PASS' : 'FAIL', note: ok ? '' : `exit ${r.status}` });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}`);
  if (!ok) {
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-12).join('\n');
    if (out) console.log(out.replace(/^/gm, '    '));
  }
}

/** 生图/排版引擎冒烟：不写仓库任何文件，产物落 /tmp。 */
function smokeRender() {
  const out = '/tmp/picflow-test-smoke.png';
  const r = spawnSync(process.execPath, [
    'pipeline/canvas/render.mjs', EXAMPLE, '-o', out,
  ], { cwd: ROOT, encoding: 'utf8' });
  const ok = r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 10_000;
  results.push({ name: 'Canvas 渲染冒烟', status: ok ? 'PASS' : 'FAIL', note: ok ? '' : `exit ${r.status}` });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} Canvas 渲染冒烟 (${EXAMPLE})`);
  if (!ok) console.log(`${r.stdout || ''}${r.stderr || ''}`.replace(/^/gm, '    '));
}

/** 双引擎逐像素对照（需要 python3 + Pillow）。 */
function engineParity() {
  const py = spawnSync('python3', ['-c', 'import PIL'], { encoding: 'utf8' });
  run('双引擎逐像素对照 (parity)', process.execPath, ['pipeline/canvas/parity.mjs', EXAMPLE],
    { skipIf: py.status === 0 ? null : '未安装 python3/Pillow' });
}

/** 预览↔渲染折行一致性（需要 Web 服务在线）。 */
function previewParity(online) {
  run('预览↔渲染 折行一致性', process.execPath, ['tests/test_preview_parity.mjs'],
    { skipIf: online ? null : `Web 服务未启动（${BASE_URL}），先跑 npm run web` });
}

/** 编辑器行为回归（需要 Web 服务在线）：置脏 / 机检四检 / 快捷键不泄漏。 */
function editorBehaviors(online) {
  run('编辑器行为回归（置脏·机检四检·快捷键）', process.execPath, ['tests/test_editor_behaviors.mjs'],
    { skipIf: online ? null : `Web 服务未启动（${BASE_URL}），先跑 npm run web` });
}

/** 编辑器交互回归（需要 Web 服务在线）：HiDPI 热区 / 快捷键 / 剧本 markdown。 */
function editorUx(online) {
  run('编辑器交互回归（热区·快捷键·markdown）', process.execPath, ['tests/test_editor_ux.mjs'],
    { skipIf: online ? null : `Web 服务未启动（${BASE_URL}），先跑 npm run web` });
}

function serverOnline() {
  try {
    const r = spawnSync(process.execPath, ['-e', `
      fetch('${BASE_URL}/api/projects').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));
    `], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** 全字体预览（不需要服务）。 */
function fontPreview() {
  run('全字体渲染预览', process.execPath, ['tests/test_fonts.mjs']);
}

console.log('=== pic-flow 测试 ===\n');
smokeRender();
fontPreview();
engineParity();
const online = serverOnline();
if (!online) console.log(`[INFO] 未检测到 Web 服务（${BASE_URL}），跳过依赖它的两项\n`);
previewParity(online);
editorBehaviors(online);
editorUx(online);

const failed = results.filter((r) => r.status === 'FAIL');
const skipped = results.filter((r) => r.status === 'SKIP');
console.log(`\n=== 汇总：${results.length - failed.length - skipped.length} 通过 · `
  + `${failed.length} 失败 · ${skipped.length} 跳过 ===`);
process.exit(failed.length ? 1 : 0);
