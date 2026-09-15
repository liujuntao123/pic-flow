import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { render } from '../../pipeline/canvas/render.mjs';
import { stitch } from '../../pipeline/canvas/stitch.mjs';
import { lint } from '../../pipeline/canvas/checks/lint.mjs';
import { checkGeom } from '../../pipeline/canvas/checks/geom.mjs';
import { occlusion } from '../../pipeline/canvas/checks/occlusion.mjs';
import { clearance } from '../../pipeline/canvas/checks/clearance.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * 默认扫描的项目目录列表
 */
const DEFAULT_SEARCH_DIRS = [
  path.resolve(process.env.HOME || '/home/box', 'pic-flow-projects'),
  path.resolve(REPO_ROOT, 'examples'),
];

export function isPicFlowProject(dirPath) {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return false;
    const hasLayout = fs.existsSync(path.join(dirPath, 'layout'));
    const hasAssets = fs.existsSync(path.join(dirPath, 'assets.json'));
    const hasSheets = fs.existsSync(path.join(dirPath, 'sheets.json'));
    const hasStoryboard = fs.existsSync(path.join(dirPath, 'storyboard.json'));
    const hasStyle = fs.existsSync(path.join(dirPath, 'style.json'));
    return hasLayout || hasAssets || hasSheets || hasStoryboard || hasStyle;
  } catch {
    return false;
  }
}

/**
 * 编码项目 ID (使用 base64url 或相对安全 slug)
 */
export function encodeProjectId(fullPath) {
  return Buffer.from(fullPath, 'utf8').toString('base64url');
}

export function decodeProjectId(projectId) {
  return Buffer.from(projectId, 'base64url').toString('utf8');
}

/**
 * 扫描所有 pic-flow 项目
 */
export async function listProjects() {
  const projects = [];
  const seenPaths = new Set();

  for (const baseDir of DEFAULT_SEARCH_DIRS) {
    if (!fs.existsSync(baseDir)) continue;
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        const projectPath = path.join(baseDir, entry.name);
        if (seenPaths.has(projectPath)) continue;
        if (isPicFlowProject(projectPath)) {
          seenPaths.add(projectPath);
          const meta = getProjectSummary(projectPath);
          projects.push(meta);
        }
      }
    } catch (err) {
      console.error(`[projects] 扫描目录失败: ${baseDir}`, err.message);
    }
  }

  // 检查当前工作区是否也是一个独立项目
  if (!seenPaths.has(REPO_ROOT) && isPicFlowProject(REPO_ROOT)) {
    // 仓库自身有 layout 吗？如果没独立 layout 就不加入，以免混淆
    if (fs.existsSync(path.join(REPO_ROOT, 'layout'))) {
      projects.push(getProjectSummary(REPO_ROOT));
    }
  }

  // 按最近修改时间倒序排列
  projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return projects;
}

/**
 * 提取单个项目摘要
 */
export function getProjectSummary(projectPath) {
  const id = encodeProjectId(projectPath);
  const name = path.basename(projectPath);
  let title = name;
  let description = '';

  // 读取 CONTENT.md
  const contentMdPath = path.join(projectPath, 'CONTENT.md');
  if (fs.existsSync(contentMdPath)) {
    try {
      const content = fs.readFileSync(contentMdPath, 'utf8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      if (titleMatch) title = titleMatch[1].trim();
      const descMatch = content.match(/^(?:## 故事核心|## 核心叙事|## 概述)\s*\n+([^\n#]+)/m);
      if (descMatch) description = descMatch[1].trim();
    } catch {}
  } else {
    // 尝试从 README.md 读标题
    const readmePath = path.join(projectPath, 'README.md');
    if (fs.existsSync(readmePath)) {
      try {
        const readme = fs.readFileSync(readmePath, 'utf8');
        const m = readme.match(/^#\s+(.+)$/m);
        if (m) title = m[1].trim();
      } catch {}
    }
  }

  // 读取分块
  const layoutDir = path.join(projectPath, 'layout');
  let blockCount = 0;
  let blocks = [];
  if (fs.existsSync(layoutDir)) {
    try {
      const files = fs.readdirSync(layoutDir);
      blocks = files
        .filter((f) => f.startsWith('block') && f.endsWith('.json'))
        .sort((a, b) => {
          const numA = parseInt(a.replace(/[^0-9]/g, '') || '0', 10);
          const numB = parseInt(b.replace(/[^0-9]/g, '') || '0', 10);
          return numA - numB;
        });
      blockCount = blocks.length;
    } catch {}
  }

  // 读取预览图：优先 output/*preview*.jpg，再找 output/*.jpg，再找 blocks/final1.png
  let previewUrl = null;
  const outputDir = path.join(projectPath, 'output');
  if (fs.existsSync(outputDir)) {
    try {
      const outs = fs.readdirSync(outputDir);
      const prevFile = outs.find((f) => f.includes('preview') && /\.(jpe?g|png)$/i.test(f));
      if (prevFile) {
        previewUrl = `/api/projects/${id}/output/${encodeURIComponent(prevFile)}`;
      } else {
        const anyImg = outs.find((f) => /\.(jpe?g|png)$/i.test(f));
        if (anyImg) {
          previewUrl = `/api/projects/${id}/output/${encodeURIComponent(anyImg)}`;
        }
      }
    } catch {}
  }

  if (!previewUrl) {
    // 查找 blocks/*.png
    const blocksDir = path.join(projectPath, 'blocks');
    if (fs.existsSync(blocksDir)) {
      try {
        const blks = fs.readdirSync(blocksDir);
        const b1 = blks.find((f) => (f.includes('final1') || f.includes('block1') || f === '1.png') && f.endsWith('.png'));
        if (b1) {
          previewUrl = `/api/projects/${id}/blocks/${encodeURIComponent(b1)}`;
        } else if (blks.length > 0) {
          const firstPng = blks.find((f) => f.endsWith('.png'));
          if (firstPng) previewUrl = `/api/projects/${id}/blocks/${encodeURIComponent(firstPng)}`;
        }
      } catch {}
    }
  }

  // 项目最近更新时间
  let updatedAt = new Date(0).toISOString();
  try {
    const stat = fs.statSync(projectPath);
    updatedAt = stat.mtime.toISOString();
  } catch {}

  return {
    id,
    name,
    title,
    description,
    path: projectPath,
    blockCount,
    blocks,
    previewUrl,
    updatedAt,
  };
}

/**
 * 获取完整项目详情
 */
export function getProjectDetail(projectPath) {
  const summary = getProjectSummary(projectPath);
  const layoutDir = path.join(projectPath, 'layout');
  const blocks = [];

  if (fs.existsSync(layoutDir)) {
    const files = fs.readdirSync(layoutDir)
      .filter((f) => f.startsWith('block') && f.endsWith('.json'))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/[^0-9]/g, '') || '0', 10);
        const numB = parseInt(b.replace(/[^0-9]/g, '') || '0', 10);
        return numA - numB;
      });

    for (const f of files) {
      const blockId = f.replace('.json', '');
      const filePath = path.join(layoutDir, f);
      const stat = fs.statSync(filePath);
      let elementCount = 0;
      let width = 1080;
      let height = 2500;
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        width = data.width || 1080;
        height = data.height || 2500;
        elementCount = (data.elements || []).length;
      } catch {}

      // 检查渲染块是否存在
      const blockNum = blockId.replace(/[^0-9]/g, '');
      const finalPng = `final${blockNum}.png`;
      const stagePng = `stage${blockNum}.png`;
      const blocksDir = path.join(projectPath, 'blocks');
      let renderedFile = null;
      if (fs.existsSync(path.join(blocksDir, finalPng))) {
        renderedFile = finalPng;
      } else if (fs.existsSync(path.join(blocksDir, stagePng))) {
        renderedFile = stagePng;
      } else if (fs.existsSync(path.join(blocksDir, `${blockId}.png`))) {
        renderedFile = `${blockId}.png`;
      }

      blocks.push({
        id: blockId,
        file: f,
        width,
        height,
        elementCount,
        renderedFile,
        renderedUrl: renderedFile ? `/api/projects/${summary.id}/blocks/${encodeURIComponent(renderedFile)}` : null,
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }

  // 素材列表
  const assetsDir = path.join(projectPath, 'assets');
  const assets = [];
  if (fs.existsSync(assetsDir)) {
    try {
      const files = fs.readdirSync(assetsDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      for (const f of files) {
        const p = path.join(assetsDir, f);
        const stat = fs.statSync(p);
        assets.push({
          name: f,
          size: stat.size,
          url: `/api/projects/${summary.id}/assets/${encodeURIComponent(f)}`,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    } catch {}
  }

  // 产物长图
  const outputDir = path.join(projectPath, 'output');
  const outputs = [];
  if (fs.existsSync(outputDir)) {
    try {
      const files = fs.readdirSync(outputDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      for (const f of files) {
        const p = path.join(outputDir, f);
        const stat = fs.statSync(p);
        outputs.push({
          name: f,
          size: stat.size,
          isPreview: f.includes('preview'),
          url: `/api/projects/${summary.id}/output/${encodeURIComponent(f)}`,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    } catch {}
  }

  // 风格配置
  let style = null;
  const stylePath = path.join(projectPath, 'style.json');
  if (fs.existsSync(stylePath)) {
    try {
      style = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
    } catch {}
  }

  // 分镜配置
  let storyboard = null;
  const sbPath = path.join(projectPath, 'storyboard.json');
  if (fs.existsSync(sbPath)) {
    try {
      storyboard = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
    } catch {}
  }

  // 四图规格
  let sheets = null;
  const sheetsPath = path.join(projectPath, 'sheets.json');
  if (fs.existsSync(sheetsPath)) {
    try {
      sheets = JSON.parse(fs.readFileSync(sheetsPath, 'utf8'));
    } catch {}
  }

  // 文案剧本
  let contentMd = '';
  const contentMdPath = path.join(projectPath, 'CONTENT.md');
  if (fs.existsSync(contentMdPath)) {
    try {
      contentMd = fs.readFileSync(contentMdPath, 'utf8');
    } catch {}
  }

  return {
    ...summary,
    blocks,
    assets,
    outputs,
    style,
    storyboard,
    sheets,
    contentMd,
  };
}

/**
 * 读取某个 block 的 raw layout
 */
export function getBlockLayout(projectPath, blockId) {
  const normBlockId = blockId.endsWith('.json') ? blockId : `${blockId}.json`;
  const filePath = path.join(projectPath, 'layout', normBlockId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`分块文件不存在: ${normBlockId}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const data = JSON.parse(raw);
  return {
    blockId: normBlockId.replace('.json', ''),
    layout: data,
    updatedAt: stat.mtime.toISOString(),
  };
}

/**
 * 保存某个 block 的 raw layout 并可选自动重绘
 */
export async function saveBlockLayout(projectPath, blockId, layout, autoRender = true) {
  const normBlockId = blockId.endsWith('.json') ? blockId : `${blockId}.json`;
  const layoutDir = path.join(projectPath, 'layout');
  fs.mkdirSync(layoutDir, { recursive: true });
  const filePath = path.join(layoutDir, normBlockId);

  // 格式化为与原有一致的 2 格缩进 JSON
  const jsonStr = JSON.stringify(layout, null, 2);
  fs.writeFileSync(filePath, jsonStr, 'utf8');
  const stat = fs.statSync(filePath);

  let renderedFile = null;
  let renderedUrl = null;
  if (autoRender) {
    const blockNum = normBlockId.replace(/[^0-9]/g, '') || '1';
    const outPng = path.join(projectPath, 'blocks', `final${blockNum}.png`);
    try {
      await render(layout, outPng, false, projectPath, 1);
      renderedFile = `final${blockNum}.png`;
      const id = encodeProjectId(projectPath);
      renderedUrl = `/api/projects/${id}/blocks/${encodeURIComponent(renderedFile)}?t=${Date.now()}`;
    } catch (err) {
      console.error(`[saveBlockLayout] 自动渲染失败:`, err);
    }
  }

  return {
    ok: true,
    blockId: normBlockId.replace('.json', ''),
    updatedAt: stat.mtime.toISOString(),
    renderedFile,
    renderedUrl,
  };
}

/**
 * 触发指定分块渲染
 */
export async function renderBlock(projectPath, blockId, debug = false, scale = 1) {
  const { layout } = getBlockLayout(projectPath, blockId);
  const normBlockId = blockId.endsWith('.json') ? blockId : `${blockId}.json`;
  const blockNum = normBlockId.replace(/[^0-9]/g, '') || '1';
  const outPngName = debug ? `stage${blockNum}.png` : `final${blockNum}.png`;
  const outPng = path.join(projectPath, 'blocks', outPngName);

  await render(layout, outPng, debug, projectPath, scale);
  const id = encodeProjectId(projectPath);
  return {
    ok: true,
    outPngName,
    url: `/api/projects/${id}/blocks/${encodeURIComponent(outPngName)}?t=${Date.now()}`,
  };
}

/**
 * 触发所有分块拼接
 */
export async function stitchProject(projectPath) {
  const summary = getProjectSummary(projectPath);
  const blocksDir = path.join(projectPath, 'blocks');
  const layoutDir = path.join(projectPath, 'layout');
  const outputDir = path.join(projectPath, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  // 获取所有分块并排序
  const blockFiles = fs.readdirSync(layoutDir)
    .filter((f) => f.startsWith('block') && f.endsWith('.json'))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, '') || '0', 10);
      const numB = parseInt(b.replace(/[^0-9]/g, '') || '0', 10);
      return numA - numB;
    });

  const inputPngs = [];
  for (const bf of blockFiles) {
    const num = bf.replace(/[^0-9]/g, '');
    const finalPng = path.join(blocksDir, `final${num}.png`);
    const stagePng = path.join(blocksDir, `stage${num}.png`);
    if (fs.existsSync(finalPng)) {
      inputPngs.push(finalPng);
    } else if (fs.existsSync(stagePng)) {
      inputPngs.push(stagePng);
    } else {
      // 临时为缺失的块渲染一次
      const { layout } = getBlockLayout(projectPath, bf);
      await render(layout, finalPng, false, projectPath, 1);
      inputPngs.push(finalPng);
    }
  }

  if (inputPngs.length === 0) {
    throw new Error('未找到可供拼接的分块渲染图');
  }

  const safeTitle = summary.title.replace(/[\\/:*?"<>|]/g, '_');
  const outJpgName = `${safeTitle}_长图.jpg`;
  const outJpg = path.join(outputDir, outJpgName);
  const res = await stitch(outJpg, inputPngs);

  const id = summary.id;
  return {
    ok: true,
    outName: path.basename(res.out),
    prevName: path.basename(res.prev),
    outUrl: `/api/projects/${id}/output/${encodeURIComponent(path.basename(res.out))}?t=${Date.now()}`,
    prevUrl: `/api/projects/${id}/output/${encodeURIComponent(path.basename(res.prev))}?t=${Date.now()}`,
    width: res.w,
    height: res.h,
  };
}

/**
 * 运行某个分块的机检
 */
export async function lintBlock(projectPath, blockId) {
  const normBlockId = blockId.endsWith('.json') ? blockId : `${blockId}.json`;
  const filePath = path.join(projectPath, 'layout', normBlockId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`分块文件不存在: ${normBlockId}`);
  }

  // 捕获机检日志
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    origLog(...args);
  };

  // 1. 静态布局 Lint
  let lintRes = { hard: 0, warn: 0 };
  try {
    lintRes = lint(filePath);
  } catch (err) {
    lintRes = { hard: 1, warn: 0, error: err.message };
  }

  // 2. 排版几何机检 Geom
  let geomRes = null;
  try {
    geomRes = checkGeom(filePath);
  } catch (err) {
    geomRes = { error: err.message };
  }

  // 3. 遮挡与净空检查
  let occlusionRes = null;
  try {
    occlusionRes = await occlusion(filePath);
  } catch (err) {
    occlusionRes = { error: err.message };
  }

  let clearanceRes = null;
  try {
    clearanceRes = await clearance(filePath);
  } catch (err) {
    clearanceRes = { error: err.message };
  } finally {
    console.log = origLog;
  }

  return {
    blockId: normBlockId.replace('.json', ''),
    lint: lintRes,
    geom: geomRes,
    occlusion: occlusionRes,
    clearance: clearanceRes,
    logs,
  };
}

/**
 * 新建项目
 */
export async function createProject({ dirName, title, template = 'story', style = 'bw-sketch', layout = 'story-flow' }) {
  if (!dirName) throw new Error('目录名不能为空');
  const safeDirName = dirName.replace(/[\\/:*?"<>|]/g, '_');
  const targetDir = path.resolve(process.env.HOME || '/home/box', 'pic-flow-projects', safeDirName);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`目标目录已存在且非空: ${targetDir}`);
  }

  const scriptPath = path.resolve(REPO_ROOT, 'pipeline', 'new_project.py');
  await execFileAsync('python3', [
    scriptPath,
    targetDir,
    '--title', title || safeDirName,
    '--template', template,
    '--style', style,
    '--layout', layout,
  ]);

  return getProjectSummary(targetDir);
}
