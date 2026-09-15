import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

async function testInteractive() {
  console.log('启动交互式 UI 测试...');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. 进入首页并打开 alchemy-mercury
  await page.goto('http://127.0.0.1:3100/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.project-card');
  await page.click('.project-card:first-child');
  await page.waitForSelector('#canvas-board');
  await page.waitForTimeout(600);

  // 2. 选中第一个文本图层
  console.log('选中第一图层...');
  await page.click('.layer-item:first-child');
  await page.waitForSelector('#prop-content');

  // 3. 修改文字
  const testText = '一、丹炉之谜：【现代科学】与长生幻象';
  console.log('修改文本内容为:', testText);
  await page.fill('#prop-content', testText);
  await page.dispatchEvent('#prop-content', 'input');
  await page.dispatchEvent('#prop-content', 'change');

  // 验证未保存状态
  const statusUnsaved = await page.$eval('#status-text', (el) => el.textContent);
  console.log('当前状态标识:', statusUnsaved);
  if (!statusUnsaved.includes('未保存')) {
    throw new Error('修改后未变为未保存状态');
  }

  // 4. 点击保存到文件
  console.log('点击保存到文件...');
  await page.click('#btn-save-layout');
  await page.waitForTimeout(1000);

  const statusSynced = await page.$eval('#status-text', (el) => el.textContent);
  console.log('保存后状态标识:', statusSynced);
  if (!statusSynced.includes('已同步')) {
    throw new Error('保存后未恢复为已同步状态');
  }

  // 5. 检查磁盘文件
  const blockFile = '/home/box/workspace/pic-flow/examples/alchemy-mercury/layout/block1.json';
  const diskData = JSON.parse(fs.readFileSync(blockFile, 'utf8'));
  console.log('磁盘文件当前内容:', diskData.elements[0].content);
  if (diskData.elements[0].content !== testText) {
    throw new Error('磁盘文件未被正确保存！');
  }

  // 6. 模拟 Agent 外部修改
  console.log('模拟 Agent 在外部修改文件...');
  const agentText = '一、丹炉之谜：古人真的只是盲目迷信？'; // 还原为原版
  diskData.elements[0].content = agentText;
  fs.writeFileSync(blockFile, JSON.stringify(diskData, null, 2), 'utf8');

  // 7. 用户在 Web 界面点击“重载”
  console.log('用户点击重载按钮...');
  page.on('dialog', (dialog) => dialog.accept());
  await page.click('#btn-reload-block');
  await page.waitForTimeout(1000);

  // 选中查看
  await page.click('.layer-item:first-child');
  const reloadedText = await page.$eval('#prop-content', (el) => el.value);
  console.log('重载后 UI 属性检查器文本:', reloadedText);
  if (reloadedText !== agentText) {
    throw new Error('重载后未能反映 Agent 的最新修改！');
  }

  // 截图留存
  await page.screenshot({ path: '/tmp/ui_interactive_verified.png' });
  await browser.close();

  console.log('\n✔ 交互式双向同步测试成功！');
}

testInteractive().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
