/**
 * 编辑器行为回归测试（需要 Web 服务在线）：
 *
 *  1. 打字即置脏 —— 在属性检查器里输入时状态徽标变「有未保存修改」，
 *     否则 2.5s 的轮询会把正在输入的草稿当「无改动」覆盖掉（实测踩过）。
 *  2. 机检闸门看四条 —— 弹窗必须同时报 lint/geom/occlusion/clearance，
 *     不能只看 lint.hard 就弹「机检通过」。
 *  3. 离开编辑器后 Ctrl+S 不再写盘 —— 全局快捷键必须在 destroy() 里摘掉，
 *     否则在项目列表页按 Ctrl+S 会用过期 buffer 覆盖磁盘。
 *
 * 用法：npm run web & 然后 node tests/test_editor_behaviors.mjs
 * 环境变量：BASE_URL（默认 127.0.0.1:3100）、CHROME_PATH
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BLOCK_FILE = path.join(REPO_ROOT, 'examples', 'huangchao-tang-collapse', 'layout', 'block1.json');

let originalRaw = null;
let originalPng = null;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function restore() {
  if (originalRaw !== null) fs.writeFileSync(BLOCK_FILE, originalRaw, 'utf8');
  const png = path.join(path.dirname(BLOCK_FILE), '..', 'blocks', 'final1.png');
  if (originalPng !== null && fs.existsSync(png)) fs.writeFileSync(png, originalPng);
}

async function main() {
  originalRaw = fs.readFileSync(BLOCK_FILE, 'utf8');
  const png = path.join(path.dirname(BLOCK_FILE), '..', 'blocks', 'final1.png');
  originalPng = fs.existsSync(png) ? fs.readFileSync(png) : null;

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.project-card');
    // 打开黄巢工程（按标题定位，不依赖卡片顺序）
    await page.click('.project-card:has-text("黄巢")');
    await page.waitForSelector('#canvas-board');
    await page.waitForTimeout(500);

    // ---- 1. 打字即置脏 ----
    await page.click('.layer-item:first-child');
    await page.waitForSelector('#prop-content');
    const before = await page.$eval('#status-text', (el) => el.textContent.trim());
    await page.click('#prop-content');
    await page.keyboard.type('测试草稿');
    await page.waitForTimeout(200);
    const during = await page.$eval('#status-text', (el) => el.textContent.trim());
    check('打字后状态变为「未保存」', during.includes('未保存') && !before.includes('未保存'),
      `before="${before}" during="${during}"`);

    // ---- 2. 机检弹窗报四条 ----
    await page.click('#btn-lint-block');
    await page.waitForSelector('.modal-card');
    await page.waitForFunction(() => {
      const t = document.querySelector('.modal-card')?.textContent || '';
      return t.includes('硬伤') || t.includes('机检失败');
    }, { timeout: 60000 });
    const lintText = await page.$eval('.modal-card', (el) => el.textContent);
    check('机检弹窗同时报 geom/遮挡/净空',
      /硬伤 Hard \d+ · 几何 \d+ · 遮挡 \d+ · 净空 \d+/.test(lintText.replace(/\s+/g, ' ')),
      lintText.replace(/\s+/g, ' ').slice(0, 90));
    await page.click('#modal-close, #lint-modal-close').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});

    // 丢弃草稿（重载），避免污染后续断言
    page.on('dialog', (d) => d.accept());
    await page.click('#btn-reload-block');
    await page.waitForTimeout(800);

    // ---- 3. 离开编辑器后 Ctrl+S 不写盘 ----
    await page.click('#btn-back-to-list');
    await page.waitForSelector('.project-card');
    const diskBefore = fs.readFileSync(BLOCK_FILE, 'utf8');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(1200);
    const diskAfter = fs.readFileSync(BLOCK_FILE, 'utf8');
    check('项目列表页 Ctrl+S 不改动磁盘', diskBefore === diskAfter);
  } finally {
    await browser.close();
    restore();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[editor-behaviors] ${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('[editor-behaviors] 运行失败:', err.message);
  restore();
  process.exit(1);
});
