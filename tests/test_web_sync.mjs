import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const BASE_URL = 'http://127.0.0.1:3100';

async function runTests() {
  console.log('=== 开始测试 pic-flow Canvas Web 与数据双向同步 ===\n');

  // 1. 获取项目列表
  const listRes = await fetch(`${BASE_URL}/api/projects`).then((r) => r.json());
  if (!listRes.ok || listRes.data.length === 0) {
    throw new Error('获取项目列表失败或列表为空');
  }
  console.log(`[PASS] 成功获取项目列表，共 ${listRes.data.length} 个项目`);

  // 找一个测试项目：比如 huangchao-tang-collapse 或 alchemy-mercury
  const targetProject = listRes.data.find((p) => p.name === 'alchemy-mercury');
  if (!targetProject) throw new Error('未找到 alchemy-mercury 范例项目');
  console.log(`[INFO] 选定测试工程: ${targetProject.name} (${targetProject.path})`);

  // 2. 获取工程详情
  const detailRes = await fetch(`${BASE_URL}/api/projects/${targetProject.id}`).then((r) => r.json());
  if (!detailRes.ok) throw new Error('获取工程详情失败');
  console.log(`[PASS] 成功读取工程详情: 分块数=${detailRes.data.blocks.length}, 素材数=${detailRes.data.assets.length}`);

  // 3. 读取 block1.json
  const block1Res = await fetch(`${BASE_URL}/api/projects/${targetProject.id}/layout/block1`).then((r) => r.json());
  if (!block1Res.ok || !block1Res.data.layout) throw new Error('读取 block1 失败');
  const originalLayout = block1Res.data.layout;
  const originalElements = [...originalLayout.elements];
  console.log(`[PASS] 成功读取 block1 布局，原始元素数量: ${originalElements.length}`);

  // 4. 用户在 Web 界面修改：修改第一个文字的 content 和坐标
  const modifiedLayout = JSON.parse(JSON.stringify(originalLayout));
  const testMarkerText = `【测试标题】用户在 Web 页面可视化修改 - ${Date.now()}`;
  modifiedLayout.elements[0].content = testMarkerText;
  modifiedLayout.elements[0].x = 555;
  modifiedLayout.elements[0].y = 123;

  console.log('[INFO] 用户执行保存操作，保存到磁盘文件...');
  const saveRes = await fetch(`${BASE_URL}/api/projects/${targetProject.id}/layout/block1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout: modifiedLayout, autoRender: true }),
  }).then((r) => r.json());

  if (!saveRes.ok) throw new Error(`保存失败: ${saveRes.error}`);
  console.log(`[PASS] Web 保存成功，返回 updatedAt: ${saveRes.data.updatedAt}`);

  // 5. 验证磁盘文件内容是否真实更新
  const diskPath = path.join(targetProject.path, 'layout', 'block1.json');
  const diskContent = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
  if (diskContent.elements[0].content !== testMarkerText) {
    throw new Error('磁盘文件未更新为用户的修改！');
  }
  if (diskContent.elements[0].x !== 555 || diskContent.elements[0].y !== 123) {
    throw new Error('磁盘文件坐标未更新！');
  }
  console.log('[PASS] 验证磁盘文件已写入最新修改！内容与坐标完全一致');

  // 验证 blocks/final1.png 是否生成
  const renderedPng = path.join(targetProject.path, 'blocks', 'final1.png');
  if (fs.existsSync(renderedPng)) {
    const stat = fs.statSync(renderedPng);
    console.log(`[PASS] 自动 Canvas 渲染成功，产物 final1.png 大小: ${stat.size} 字节`);
  }

  // 6. 模拟 Agent 在后台/终端修改了文件
  console.log('[INFO] 模拟 Agent 修改磁盘文件...');
  const agentMarkerText = `〖Agent修改〗Agent 后台修改内容 - ${Date.now()}`;
  diskContent.elements[0].content = agentMarkerText;
  diskContent.elements[0].x = 540;
  diskContent.elements[0].y = 90;
  fs.writeFileSync(diskPath, JSON.stringify(diskContent, null, 2), 'utf8');

  // 7. 用户在 Web 页面刷新/重载，验证是否能读出 Agent 的最新数据
  console.log('[INFO] 用户刷新 Web 页面，向 API 请求最新数据...');
  const reloadRes = await fetch(`${BASE_URL}/api/projects/${targetProject.id}/layout/block1?t=${Date.now()}`).then((r) => r.json());
  if (!reloadRes.ok) throw new Error('重新读取失败');
  if (reloadRes.data.layout.elements[0].content !== agentMarkerText) {
    throw new Error(`页面未读取到 Agent 的最新修改: ${reloadRes.data.layout.elements[0].content}`);
  }
  console.log(`[PASS] 页面成功加载 Agent 的最新效果: "${reloadRes.data.layout.elements[0].content}"`);

  // 8. 还原原始内容，保持代码干净
  console.log('[INFO] 恢复 block1 原始文件内容...');
  fs.writeFileSync(diskPath, JSON.stringify(originalLayout, null, 2), 'utf8');
  await fetch(`${BASE_URL}/api/projects/${targetProject.id}/render/block1`, { method: 'POST' });
  console.log('[PASS] 原始数据已复原');

  // 9. 测试机检 API
  console.log('[INFO] 测试分块机检 API...');
  const lintRes = await fetch(`${BASE_URL}/api/projects/${targetProject.id}/lint/block1`).then((r) => r.json());
  if (!lintRes.ok) throw new Error('机检 API 失败');
  console.log(`[PASS] 机检 API 执行成功: hard=${lintRes.data.lint.hard}, warn=${lintRes.data.lint.warn}`);

  console.log('\n🎉 所有端到端测试与双向同步测试全部通过！');
}

runTests().catch((err) => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
