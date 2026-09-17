import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { render } from '../../pipeline/canvas/render.mjs';
import { stitch } from '../../pipeline/canvas/stitch.mjs';
import { inspectLayout } from '../../pipeline/canvas/checks/inspect.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

/** 带 HTTP 状态码的错误：路由层据此回 4xx/5xx，而不是一律 500。 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 只允许 blockN / 自定的安全块名（禁止 ../、/ 与绝对路径）。 */
const BLOCK_ID_RE = /^[A-Za-z0-9_-]+$/;
/** 只匹配 block<数字>.json：草稿文件（block1_bind.json、block_bind.json）不是分块。 */
export const BLOCK_FILE_RE = /^block(\d+)\.json$/;

export function blockNumber(name) {
  const m = BLOCK_FILE_RE.exec(name);
  return m ? Number(m[1]) : null;
}

function assertBlockId(blockId) {
  const raw = String(blockId ?? '').replace(/\.json$/, '');
  if (!BLOCK_ID_RE.test(raw)) {
    throw new HttpError(400, `非法分块名：${blockId}（只允许字母数字、_ 和 -）`);
  }
  return raw;
}

/** 列表里所有分块文件（只认 block<数字>.json，按数字排序）。 */
export function listBlockFiles(layoutDir) {
  if (!fs.existsSync(layoutDir)) return [];
  return fs.readdirSync(layoutDir)
    .filter((f) => BLOCK_FILE_RE.test(f))
    .sort((a, b) => blockNumber(a) - blockNumber(b));
}

/** 原子写：先写临时文件再 rename，避免 Agent / 渲染引擎读到半截文件。 */
function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

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
 * 项目 ID 白名单校验：解码后的路径必须**真的是一个 pic-flow 项目**。
 * 否则 `Lw`（base64url 的 "/"）之类可以指向任意目录，配合 assets/blocks 静态代理
 * 就能读任意文件。
 */
export function assertProjectPath(projectId) {
  let projectPath;
  try {
    projectPath = decodeProjectId(projectId);
  } catch {
    throw new HttpError(400, '无效的项目 ID');
  }
  if (!projectPath || !path.isAbsolute(projectPath)) {
    throw new HttpError(400, '无效的项目 ID');
  }
  if (!fs.existsSync(projectPath) || !isPicFlowProject(projectPath)) {
    throw new HttpError(404, '项目不存在或不是 pic-flow 工程');
  }
  return path.resolve(projectPath);
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
      blocks = listBlockFiles(layoutDir);
      blockCount = blocks.length;
    } catch {}
  }

  // 读取预览图：优先项目根的长图（成品的真实位置）、再 output/*preview*、
  // 再 output/*.jpg、最后 blocks/final1.png。
  let previewUrl = null;
  const rootImgs = fs.existsSync(projectPath) ? fs.readdirSync(projectPath) : [];
  const longImg = rootImgs.find((f) => /长图.*_preview\.(jpe?g|png)$/i.test(f))
    || rootImgs.find((f) => /长图.*\.(jpe?g|png)$/i.test(f));
  if (longImg) {
    previewUrl = `/api/projects/${id}/root/${encodeURIComponent(longImg)}`;
  }
  const outputDir = path.join(projectPath, 'output');
  if (!previewUrl && fs.existsSync(outputDir)) {
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
    const files = listBlockFiles(layoutDir);

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
      const blockNum = blockNumber(f);
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
 * 校验 layout 结构：至少要是「带数字 width/height 与 elements 数组」的对象。
 * 不校验的话 `{"layout": null}` 会把 block 文件写成字面量 null（实测被这样毁过一块）。
 */
export function validateLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new HttpError(400, 'layout 必须是对象');
  }
  if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)) {
    throw new HttpError(400, 'layout.width / layout.height 必须是数字');
  }
  if (!Array.isArray(layout.elements)) {
    throw new HttpError(400, 'layout.elements 必须是数组');
  }
  for (const [i, el] of layout.elements.entries()) {
    if (!el || typeof el !== 'object' || typeof el.type !== 'string') {
      throw new HttpError(400, `layout.elements[${i}] 缺少 type`);
    }
  }
  return layout;
}

/**
 * 读取某个 block 的 raw layout
 */
export function getBlockLayout(projectPath, blockId) {
  const normBlockId = `${assertBlockId(blockId)}.json`;
  const filePath = path.join(projectPath, 'layout', normBlockId);
  if (!fs.existsSync(filePath)) {
    throw new HttpError(404, `分块文件不存在: ${normBlockId}`);
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
 *
 * @param {string} [expectedUpdatedAt] 客户端读到的文件版本（ISO 时间）。
 *   与磁盘当前 mtime 不一致 = 磁盘已被 Agent / 别的窗口改过，返回 409 让用户裁决，
 *   否则「人机双向同步」会变成「后写的人无声覆盖前一个人」。
 */
export async function saveBlockLayout(projectPath, blockId, layout, autoRender = true, expectedUpdatedAt = null) {
  const normBlockId = `${assertBlockId(blockId)}.json`;
  const layoutDir = path.join(projectPath, 'layout');
  fs.mkdirSync(layoutDir, { recursive: true });
  const filePath = path.join(layoutDir, normBlockId);
  validateLayout(layout);

  if (expectedUpdatedAt && fs.existsSync(filePath)) {
    const diskStat = fs.statSync(filePath);
    if (Math.abs(diskStat.mtimeMs - new Date(expectedUpdatedAt).getTime()) > 1000) {
      throw new HttpError(409, '磁盘上的 layout 已被外部修改（Agent / 另一个窗口），请先重载再保存');
    }
  }

  // 格式化为与原有一致的 2 格缩进 JSON；原子落盘避免读到半截文件
  const jsonStr = `${JSON.stringify(layout, null, 2)}\n`;
  if (typeof jsonStr !== 'string') throw new HttpError(400, 'layout 无法序列化');
  writeFileAtomic(filePath, jsonStr);
  const stat = fs.statSync(filePath);

  let renderedFile = null;
  let renderedUrl = null;
  let renderError = null;
  if (autoRender) {
    const blockNum = blockNumber(normBlockId) ?? 1;
    const outPng = path.join(projectPath, 'blocks', `final${blockNum}.png`);
    try {
      await render(layout, outPng, false, projectPath, 1);
      renderedFile = `final${blockNum}.png`;
      const id = encodeProjectId(projectPath);
      renderedUrl = `/api/projects/${id}/blocks/${encodeURIComponent(renderedFile)}?t=${Date.now()}`;
    } catch (err) {
      // 不能静默吞掉：否则 UI 报「已保存并渲染完成」，而 blocks/ 里还是上一版，
      // 拼接出来的长图会悄悄用旧的切片。
      renderError = err.message;
      console.error(`[saveBlockLayout] 自动渲染失败:`, err);
    }
  }

  return {
    ok: true,
    blockId: normBlockId.replace('.json', ''),
    updatedAt: stat.mtime.toISOString(),
    renderedFile,
    renderedUrl,
    renderError,
  };
}

/** 渲染倍率只允许 1~4（负数/超大值会产出垃圾图或直接崩 Skia）。 */
function clampScale(scale) {
  const n = Number(scale);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(4, Math.round(n * 100) / 100);
}

/**
 * 触发指定分块渲染
 */
export async function renderBlock(projectPath, blockId, debug = false, scale = 1) {
  const { layout } = getBlockLayout(projectPath, blockId);
  const normBlockId = `${assertBlockId(blockId)}.json`;
  const blockNum = blockNumber(normBlockId) ?? 1;
  const outPngName = debug ? `stage${blockNum}.png` : `final${blockNum}.png`;
  const outPng = path.join(projectPath, 'blocks', outPngName);

  await render(layout, outPng, debug, projectPath, clampScale(scale));
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

  // 获取所有分块并排序（只认 block<数字>.json：block1_bind.json 这类草稿不是分块，
  // 否则它们会被当成数字块，拼出一张长度翻倍还夹着草稿的长图）
  const blockFiles = listBlockFiles(layoutDir);

  const inputPngs = [];
  for (const bf of blockFiles) {
    const num = blockNumber(bf);
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
    throw new HttpError(400, '未找到可供拼接的分块渲染图');
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

/** 运行某个分块的机检（直接调用深模块，返回结构化诊断与格式化日志） */
export async function lintBlock(projectPath, blockId) {
  const normBlockId = `${assertBlockId(blockId)}.json`;
  const filePath = path.join(projectPath, 'layout', normBlockId);
  if (!fs.existsSync(filePath)) {
    throw new HttpError(404, `分块文件不存在: ${normBlockId}`);
  }

  const report = await inspectLayout(filePath, { verbose: true, root: projectPath });
  return {
    blockId: normBlockId.replace('.json', ''),
    ok: report.ok,
    hard: report.hard,
    warn: report.warn,
    lint: report.summary.lint,
    geom: report.summary.geom.problems,
    occlusion: report.summary.occlusion.bad,
    clearance: report.summary.clearance.bad,
    summary: report.summary,
    diagnostics: report.diagnostics,
    logs: report.logs,
  };
}

/**
 * 新建项目
 */
export async function createProject({ dirName, title, template = 'story', style = 'bw-sketch', layout = 'story-flow' }) {
  const name = String(dirName ?? '').trim();
  if (!name) throw new HttpError(400, '目录名不能为空');
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new HttpError(400, '目录名只允许中划线、下划线、点与字母数字（且不能是 . / ..）');
  }
  const safeDirName = name.replace(/[\\/:*?"<>|]/g, '_');
  const targetDir = path.resolve(process.env.HOME || '/home/box', 'pic-flow-projects', safeDirName);
  const projectsRoot = path.resolve(process.env.HOME || '/home/box', 'pic-flow-projects');
  if (path.relative(projectsRoot, targetDir).startsWith('..')) {
    throw new HttpError(400, '目标目录必须位于 ~/pic-flow-projects/ 内');
  }

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new HttpError(409, `目标目录已存在且非空: ${targetDir}`);
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
