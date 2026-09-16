/**
 * 预览↔渲染 折行口径一致性测试。
 *
 * 背景：Web 编辑器用的是浏览器端 Canvas 预览（web/client/js/canvas-renderer.mjs），
 * 真正出图用的是 Node/Skia 引擎（pipeline/canvas/lib/text.mjs）。两边各写了一套
 * 折行与默认值，一旦漂移，用户在页面上看到的排版就不是渲染出来的排版
 * （曾经：预览用 max_width=9999 / size=32 / line_height=1.45，引擎用 940/40/1.5，
 *  新建文本在预览里是一整行，一渲染就折行）。
 *
 * 本测试对同一批 layout 元素，分别取两边的「行数 + 每行字数」，要求逐条一致。
 *
 * 用法（需要先起服务，默认 3100；可用 BASE_URL 覆盖）：
 *   npm run web &            # 或 node web/server/index.mjs
 *   node tests/test_preview_parity.mjs
 */
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { blockGeom, setFonts } from '../pipeline/canvas/lib/text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const CASES = [
  { name: '无 max_width（默认 940）', el: { type: 'text', content: '古人炼丹，最让现代人困惑甚至感到啼笑皆非的，是他们偏偏盯上了水银、丹砂、硫黄这些剧毒之物！', x: 540, y: 0, size: 40 } },
  { name: '无 size（默认 40）', el: { type: 'text', content: '『水银不仅流动聚散由心，更能钻入金铜之中，形成神奇【汞齐】！』', x: 540, y: 0, max_width: 340 } },
  { name: '无 line_height（默认 1.5）', el: { type: 'text', content: '一、丹炉之谜：古人真的只是盲目迷信？\n第二行文本用于验证行距', x: 540, y: 0, size: 32 } },
  { name: 'ASCII 单词不拆', el: { type: 'text', content: 'hello world foobar Canvas renderer parity test', x: 540, y: 0, size: 32, max_width: 300 } },
  { name: '行尾避头标点悬挂', el: { type: 'text', content: '黄巢顺仙霞古道直扑福州、席卷闽粤，', x: 540, y: 0, size: 30, max_width: 480 } },
  { name: '语义标记混排', el: { type: 'text', content: '他们把〖水银〗当成仙药，【丹砂】烧之成『变化愈妙』。', x: 540, y: 0, size: 34, max_width: 400 } },
  { name: '左对齐窄栏', el: { type: 'text', content: '两税法之后，盐铁专营层层加码，私盐贩子反而成了地方豪强。', x: 120, y: 0, size: 30, align: 'left', max_width: 260 } },
];

/** 引擎侧：Node/Skia 的真实折行。 */
function engineLines(el) {
  setFonts(REPO_ROOT, {});
  const geo = blockGeom(el, 1080, { pad: 0 });
  return geo.lines.map((ln) => ln.map((c) => c[0]).join(''));
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  let failures = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    const browserLines = await page.evaluate(async (cases) => {
      const { CanvasRenderer } = await import('/js/canvas-renderer.mjs');
      const renderer = new CanvasRenderer();
      await renderer.ensureFontsLoaded();
      const ctx = document.createElement('canvas').getContext('2d');
      return cases.map((c) => renderer.layoutTextLines(ctx, c.el, {})
        .map((l) => l.runs.map((r) => r.char).join('')));
    }, CASES);

    for (const [i, c] of CASES.entries()) {
      const a = engineLines(c.el);
      const b = browserLines[i];
      const same = a.length === b.length && a.every((ln, k) => ln === b[k]);
      if (!same) failures += 1;
      console.log(`${same ? '[PASS]' : '[FAIL]'} ${c.name}`);
      if (!same) {
        console.log(`   引擎 : ${JSON.stringify(a)}`);
        console.log(`   预览 : ${JSON.stringify(b)}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n[preview-parity] ${CASES.length - failures}/${CASES.length} 一致`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('[preview-parity] 运行失败:', err.message);
  console.error('（需要先启动 Web 服务：npm run web）');
  process.exit(1);
});
