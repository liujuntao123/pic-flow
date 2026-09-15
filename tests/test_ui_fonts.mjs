import { chromium } from 'playwright-core';

async function testUiFonts() {
  console.log('测试 Web 页面中的新字体实时切换...');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://127.0.0.1:3100/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.project-card');
  await page.click('.project-card:first-child');
  await page.waitForSelector('#canvas-board');
  await page.waitForTimeout(600);

  // 选中气泡元素并切换为小徕手写体
  console.log('查找气泡图层并测试切换字体...');
  // 点击气泡图层（如第3个）
  await page.click('.layer-item:nth-child(3)');
  await page.waitForSelector('#prop-font');

  console.log('切换字体为小徕手写体 (handwriting)...');
  await page.selectOption('#prop-font', 'handwriting');
  await page.waitForTimeout(600);

  await page.screenshot({ path: '/tmp/ui_font_handwriting.png' });
  console.log('截图已保存至 /tmp/ui_font_handwriting.png');

  await browser.close();
}

testUiFonts().catch((err) => {
  console.error(err);
  process.exit(1);
});
