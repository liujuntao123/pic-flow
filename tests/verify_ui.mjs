import { chromium } from 'playwright-core';
import path from 'node:path';

async function verify() {
  console.log('启动 Chrome 浏览器进行 UI 验证...');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.error('[Browser Console Error]', msg.text());
    } else {
      console.log('[Browser Console]', msg.text());
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
    console.error('[Page Error]', err.message);
  });

  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. 访问首页（项目管理）
  console.log('访问 http://127.0.0.1:3100/ ...');
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:3100'}/`, { waitUntil: 'networkidle' });

  await page.waitForSelector('.project-card');
  console.log('项目列表已加载！');
  await page.screenshot({ path: '/tmp/ui_project_list.png' });

  // 2. 点击进入第一个项目
  console.log('点击进入项目详情...');
  await page.click('.project-card:first-child');

  await page.waitForSelector('#canvas-board');
  await page.waitForTimeout(1000);
  console.log('Canvas 详情与编辑器已加载！');
  await page.screenshot({ path: '/tmp/ui_editor.png' });

  // 3. 点击图层列表选中一个元素
  console.log('点击选中一个图层...');
  await page.click('.layer-item:first-child');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/ui_editor_selected.png' });

  await browser.close();

  if (consoleErrors.length > 0) {
    console.error('检测到控制台报错:', consoleErrors);
    process.exit(1);
  }

  console.log('UI 验证成功，无控制台错误，截图已保存至 /tmp/');
}

verify().catch((err) => {
  console.error('验证失败:', err);
  process.exit(1);
});
