import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
// 这个测试会真的改一块示例工程的 layout（并触发一次自动渲染），
// 所以：路径从仓库根推断（可在任何 checkout 下运行），并且**先备份原始字节**，
// 无论成功失败都按原样写回 —— 否则仓库里会留下脏文件。
const BLOCK_FILE = path.join(REPO_ROOT, 'examples', 'alchemy-mercury', 'layout', 'block1.json');
const PNG_FILE = path.join(REPO_ROOT, 'examples', 'alchemy-mercury', 'blocks', 'final1.png');
let originalRaw = null;
let originalPng = null;

/** 保存会触发自动渲染，blocks/final1.png（git 跟踪的示例产物）也会被覆盖，一起还原。 */
function restoreBlockFile() {
  if (originalRaw === null) return;
  try {
    fs.writeFileSync(BLOCK_FILE, originalRaw, 'utf8');
    console.log('[cleanup] 已还原', path.relative(REPO_ROOT, BLOCK_FILE));
    if (originalPng !== null) {
      fs.writeFileSync(PNG_FILE, originalPng);
      console.log('[cleanup] 已还原', path.relative(REPO_ROOT, PNG_FILE));
    }
  } catch (err) {
    console.error('[cleanup] 还原失败:', err.message);
  }
}

async function testInteractive() {
  console.log('启动交互式 UI 测试...');
  originalRaw = fs.readFileSync(BLOCK_FILE, 'utf8');
  originalPng = fs.existsSync(PNG_FILE) ? fs.readFileSync(PNG_FILE) : null;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. 进入首页并打开 alchemy-mercury
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
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
  const blockFile = BLOCK_FILE;
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
  restoreBlockFile();

  console.log('\n✔ 交互式双向同步测试成功！');
}

testInteractive().catch((err) => {
  console.error('测试失败:', err);
  restoreBlockFile();
  process.exit(1);
});
