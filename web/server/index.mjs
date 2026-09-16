#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listProjects,
  assertProjectPath,
  getProjectDetail,
  getBlockLayout,
  saveBlockLayout,
  renderBlock,
  stitchProject,
  lintBlock,
  createProject,
  listBlockFiles,
  blockNumber,
  HttpError,
} from './projects.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, '../client');
const REPO_ROOT = path.resolve(__dirname, '../..');

const PORT = Number(process.env.PORT) || 3100;
// 默认只监听本机：这是个「能写磁盘」的本地工作台，公网/局域网暴露要靠 tunnel 或显式 HOST。
// 需要局域网访问时：HOST=0.0.0.0 npm run web
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * 目录内安全拼接：解析后必须仍在 base 之内。
 *
 * 必须做这一步：`new URL()` 只把 `..` 段规范化掉，`%2e%2e%2f` 这类**编码过的斜杠**
 * 会原样留下，随后 `decodeURIComponent` 又把它还原成 `/` —— 于是
 * `/fonts/..%2f..%2fetc%2fpasswd` 曾经能直接读出 /etc/passwd。
 */
function safeJoin(base, rel) {
  const root = path.resolve(base);
  // 前导斜杠要先剥掉：path.resolve 会把 '/x' 当绝对路径，直接跳到根目录
  const cleaned = String(rel ?? '').replace(/^[/\\]+/, '');
  const target = path.resolve(root, cleaned);
  const r = path.relative(root, target);
  if (r === '' || (!r.startsWith('..') && !path.isAbsolute(r))) return target;
  return null;
}

function corsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    // 只回同源：本地工作台不需要跨源访问，通配 ACAO 会让任意网页驱动本机的写文件接口
    return new URL(origin).host === req.headers.host ? origin : null;
  } catch {
    return null;
  }
}

function sendJson(req, res, statusCode, data) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  };
  const origin = corsOrigin(req);
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

function sendFile(req, res, filePath, contentType) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('File not found');
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = contentType || MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.ttf' ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Internal Server Error: ${err.message}`);
  }
}

/** 请求体解析：超限直接断流（否则 reject 之后还在往内存里堆）。 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      raw += chunk;
      if (raw.length > 50 * 1024 * 1024) {
        settled = true;
        req.destroy();
        reject(new HttpError(413, '请求体过大（>50MB）'));
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 写操作的同源校验：浏览器跨站请求（CSRF / DNS rebinding）一律拒绝。
 * 没有 Origin / Sec-Fetch-* 的请求视为本机工具调用（curl、测试脚本），放行。
 */
function assertTrustedMutation(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none' && site !== 'same-site') {
    throw new HttpError(403, `拒绝跨站写请求（Sec-Fetch-Site: ${site}）`);
  }
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Origin 头不合法');
    }
    if (host !== req.headers.host) throw new HttpError(403, '拒绝跨站写请求（Origin 与 Host 不一致）');
  }
}

const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try {
    // 1. 解析 URL（放在 try 里：`/%` 这类畸形转义曾经直接让进程退出）
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      pathname = decodeURIComponent(parsedUrl.pathname);
    } catch {
      return sendJson(req, res, 400, { ok: false, error: '非法的请求路径' });
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      const origin = corsOrigin(req);
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      res.writeHead(204, headers);
      return res.end();
    }

    // 2. API 路由
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/projects' && req.method === 'GET') {
        const list = await listProjects();
        return sendJson(req, res, 200, { ok: true, data: list });
      }

      if (pathname === '/api/projects' && req.method === 'POST') {
        assertTrustedMutation(req);
        const body = await parseBody(req);
        const project = await createProject(body);
        return sendJson(req, res, 201, { ok: true, data: project });
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(.*)$/);
      if (projectMatch) {
        const projectId = projectMatch[1];
        const subPath = projectMatch[2];
        // 白名单：ID 解出来必须真的是一个 pic-flow 工程
        const projectPath = assertProjectPath(projectId);

        if (subPath === '' || subPath === '/') {
          if (req.method === 'GET') {
            const detail = getProjectDetail(projectPath);
            return sendJson(req, res, 200, { ok: true, data: detail });
          }
        }

        // GET/POST /api/projects/:id/layout/:blockId
        const layoutMatch = subPath.match(/^\/layout\/([^/]+)$/);
        if (layoutMatch) {
          const blockId = layoutMatch[1];
          if (req.method === 'GET') {
            const result = getBlockLayout(projectPath, blockId);
            return sendJson(req, res, 200, { ok: true, data: result });
          }
          if (req.method === 'POST') {
            assertTrustedMutation(req);
            const body = await parseBody(req);
            const autoRender = body.autoRender !== false;
            const result = await saveBlockLayout(
              projectPath, blockId, body.layout, autoRender, body.expectedUpdatedAt || null,
            );
            return sendJson(req, res, 200, { ok: true, data: result });
          }
        }

        // GET /api/projects/:id/mtime/:blockId（轮询 Agent 是否在外部改了文件）
        const mtimeMatch = subPath.match(/^\/mtime\/([^/]+)$/);
        if (mtimeMatch && req.method === 'GET') {
          const norm = `${mtimeMatch[1].replace(/\.json$/, '')}.json`;
          if (!/^[A-Za-z0-9_-]+\.json$/.test(norm)) {
            return sendJson(req, res, 400, { ok: false, error: '非法分块名' });
          }
          const filePath = path.join(projectPath, 'layout', norm);
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            return sendJson(req, res, 200, { ok: true, data: { mtime: stat.mtime.toISOString(), size: stat.size } });
          }
          return sendJson(req, res, 404, { ok: false, error: '文件不存在' });
        }

        // POST /api/projects/:id/render/:blockId
        const renderMatch = subPath.match(/^\/render\/([^/]+)$/);
        if (renderMatch && req.method === 'POST') {
          assertTrustedMutation(req);
          const blockId = renderMatch[1];
          const debug = parsedUrl.searchParams.get('debug') === 'true';
          const scale = Number(parsedUrl.searchParams.get('scale')) || 1;
          const result = await renderBlock(projectPath, blockId, debug, scale);
          return sendJson(req, res, 200, { ok: true, data: result });
        }

        // POST /api/projects/:id/stitch
        if (subPath === '/stitch' && req.method === 'POST') {
          assertTrustedMutation(req);
          const result = await stitchProject(projectPath);
          return sendJson(req, res, 200, { ok: true, data: result });
        }

        // GET /api/projects/:id/lint/:blockId
        const lintMatch = subPath.match(/^\/lint\/([^/]+)$/);
        if (lintMatch && req.method === 'GET') {
          const blockId = lintMatch[1];
          const result = await lintBlock(projectPath, blockId);
          return sendJson(req, res, 200, { ok: true, data: result });
        }

        // POST /api/projects/:id/blocks（新建一个分块）
        if (subPath === '/blocks' && req.method === 'POST') {
          assertTrustedMutation(req);
          const body = await parseBody(req);
          const layoutDir = path.join(projectPath, 'layout');
          fs.mkdirSync(layoutDir, { recursive: true });
          const existing = listBlockFiles(layoutDir);
          // 用「最大编号 + 1」而不是「数量 + 1」：block1+block3 时数量法会撞上 block3 并覆盖它
          const nextIndex = existing.reduce((m, f) => Math.max(m, blockNumber(f) ?? 0), 0) + 1;
          const rawId = body.blockId ? String(body.blockId).replace(/\.json$/, '') : `block${nextIndex}`;
          if (!/^[A-Za-z0-9_-]+$/.test(rawId)) {
            return sendJson(req, res, 400, { ok: false, error: '非法分块名（只允许字母数字、_ 和 -）' });
          }
          const normId = `${rawId}.json`;
          const filePath = path.join(layoutDir, normId);
          if (fs.existsSync(filePath)) {
            return sendJson(req, res, 409, { ok: false, error: `分块已存在：${rawId}` });
          }
          const defaultLayout = body.layout || {
            width: 1080,
            height: 2500,
            elements: [
              {
                type: 'text',
                content: `分块 ${blockNumber(normId) ?? nextIndex} 标题`,
                x: 540,
                y: 120,
                size: 48,
                bold: true,
                align: 'center',
                font: 'title',
              },
            ],
          };
          if (!body.layout) {
            fs.writeFileSync(filePath, `${JSON.stringify(defaultLayout, null, 2)}\n`, 'utf8');
          } else {
            // 客户端自带 layout 时走同一套校验/原子落盘（不校验会把块文件写成任意内容）
            await saveBlockLayout(projectPath, rawId, body.layout, false);
          }
          return sendJson(req, res, 201, { ok: true, data: { blockId: rawId } });
        }

        // 静态资源代理：assets/* · blocks/* · output/* · root/*（项目根的长图）
        for (const sub of ['assets', 'blocks', 'output', 'root']) {
          const prefix = `/${sub}/`;
          if (!subPath.startsWith(prefix)) continue;
          const name = subPath.slice(prefix.length);
          const filePath = safeJoin(path.join(projectPath, sub === 'root' ? '.' : sub), name);
          if (!filePath) return sendJson(req, res, 403, { ok: false, error: '非法路径' });
          return sendFile(req, res, filePath);
        }
      }

      return sendJson(req, res, 404, { ok: false, error: 'API 未找到' });
    }

    // 3. 全局字体代理 /fonts/*
    if (pathname.startsWith('/fonts/')) {
      const filePath = safeJoin(path.join(REPO_ROOT, 'fonts'), pathname.slice('/fonts/'.length));
      if (!filePath) return sendJson(req, res, 403, { ok: false, error: '非法路径' });
      return sendFile(req, res, filePath);
    }

    // 4. 前端静态文件服务 (web/client/*)
    const clientPath = pathname === '/' || pathname === '' ? '/index.html' : pathname;
    const fullClientPath = safeJoin(CLIENT_DIR, clientPath);
    if (fullClientPath && fs.existsSync(fullClientPath) && fs.statSync(fullClientPath).isFile()) {
      return sendFile(req, res, fullClientPath);
    }

    // SPA fallback: index.html
    const indexPath = path.join(CLIENT_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return sendFile(req, res, indexPath, 'text/html; charset=utf-8');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[server error]', err);
    sendJson(req, res, status, { ok: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`  🎨 pic-flow Canvas 可视化控制台服务已启动`);
  console.log(`  本地地址:   http://127.0.0.1:${PORT}`);
  if (HOST === '0.0.0.0') console.log(`  网络地址:   http://${HOST}:${PORT}  （注意：写接口对本机以外开放）`);
  console.log(`======================================================\n`);
});
