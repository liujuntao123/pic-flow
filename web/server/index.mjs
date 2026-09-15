#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listProjects,
  decodeProjectId,
  getProjectDetail,
  getBlockLayout,
  saveBlockLayout,
  renderBlock,
  stitchProject,
  lintBlock,
  createProject,
} from './projects.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, '../client');
const REPO_ROOT = path.resolve(__dirname, '../..');

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '0.0.0.0';

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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  try {
    if (!fs.existsSync(filePath)) {
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
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ext === '.ttf' ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Internal Server Error: ${err.message}`);
  }
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 50 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ raw });
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    // 1. API 路由
    if (pathname.startsWith('/api/')) {
      // GET /api/projects
      if (pathname === '/api/projects' && req.method === 'GET') {
        const list = await listProjects();
        return sendJson(res, 200, { ok: true, data: list });
      }

      // POST /api/projects
      if (pathname === '/api/projects' && req.method === 'POST') {
        const body = await parseBody(req);
        const project = await createProject(body);
        return sendJson(res, 201, { ok: true, data: project });
      }

      // 匹配 /api/projects/:id/...
      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(.*)$/);
      if (projectMatch) {
        const projectId = projectMatch[1];
        const subPath = projectMatch[2];
        let projectPath;
        try {
          projectPath = decodeProjectId(projectId);
        } catch {
          return sendJson(res, 400, { ok: false, error: '无效的项目 ID' });
        }

        if (!fs.existsSync(projectPath)) {
          return sendJson(res, 404, { ok: false, error: '项目路径不存在' });
        }

        // GET /api/projects/:id
        if (subPath === '' || subPath === '/') {
          if (req.method === 'GET') {
            const detail = getProjectDetail(projectPath);
            return sendJson(res, 200, { ok: true, data: detail });
          }
        }

        // GET /api/projects/:id/layout/:blockId
        // POST /api/projects/:id/layout/:blockId
        const layoutMatch = subPath.match(/^\/layout\/([^/]+)$/);
        if (layoutMatch) {
          const blockId = layoutMatch[1];
          if (req.method === 'GET') {
            const result = getBlockLayout(projectPath, blockId);
            return sendJson(res, 200, { ok: true, data: result });
          }
          if (req.method === 'POST') {
            const body = await parseBody(req);
            const autoRender = body.autoRender !== false;
            const result = await saveBlockLayout(projectPath, blockId, body.layout, autoRender);
            return sendJson(res, 200, { ok: true, data: result });
          }
        }

        // GET /api/projects/:id/mtime/:blockId (轻量级轮询检查 Agent 是否在外部修改了文件)
        const mtimeMatch = subPath.match(/^\/mtime\/([^/]+)$/);
        if (mtimeMatch && req.method === 'GET') {
          const blockId = mtimeMatch[1];
          const norm = blockId.endsWith('.json') ? blockId : `${blockId}.json`;
          const filePath = path.join(projectPath, 'layout', norm);
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            return sendJson(res, 200, { ok: true, data: { mtime: stat.mtime.toISOString(), size: stat.size } });
          }
          return sendJson(res, 404, { ok: false, error: '文件不存在' });
        }

        // POST /api/projects/:id/render/:blockId
        const renderMatch = subPath.match(/^\/render\/([^/]+)$/);
        if (renderMatch && req.method === 'POST') {
          const blockId = renderMatch[1];
          const debug = parsedUrl.searchParams.get('debug') === 'true';
          const scale = Number(parsedUrl.searchParams.get('scale')) || 1;
          const result = await renderBlock(projectPath, blockId, debug, scale);
          return sendJson(res, 200, { ok: true, data: result });
        }

        // POST /api/projects/:id/stitch
        if (subPath === '/stitch' && req.method === 'POST') {
          const result = await stitchProject(projectPath);
          return sendJson(res, 200, { ok: true, data: result });
        }

        // GET /api/projects/:id/lint/:blockId
        const lintMatch = subPath.match(/^\/lint\/([^/]+)$/);
        if (lintMatch && req.method === 'GET') {
          const blockId = lintMatch[1];
          const result = await lintBlock(projectPath, blockId);
          return sendJson(res, 200, { ok: true, data: result });
        }

        // POST /api/projects/:id/blocks (新建一个分块)
        if (subPath === '/blocks' && req.method === 'POST') {
          const body = await parseBody(req);
          const layoutDir = path.join(projectPath, 'layout');
          fs.mkdirSync(layoutDir, { recursive: true });
          const existing = fs.readdirSync(layoutDir).filter((f) => f.startsWith('block') && f.endsWith('.json'));
          const nextIndex = existing.length + 1;
          const newBlockId = body.blockId || `block${nextIndex}`;
          const normId = newBlockId.endsWith('.json') ? newBlockId : `${newBlockId}.json`;
          const filePath = path.join(layoutDir, normId);
          const defaultLayout = body.layout || {
            width: 1080,
            height: 2500,
            elements: [
              {
                type: 'text',
                content: `分块 ${nextIndex} 标题`,
                x: 540,
                y: 120,
                size: 48,
                bold: true,
                align: 'center',
                font: 'title',
              },
            ],
          };
          fs.writeFileSync(filePath, JSON.stringify(defaultLayout, null, 2), 'utf8');
          return sendJson(res, 201, { ok: true, data: { blockId: normId.replace('.json', '') } });
        }

        // 静态资源代理：assets/*
        if (subPath.startsWith('/assets/')) {
          const assetName = subPath.replace('/assets/', '');
          const filePath = path.join(projectPath, 'assets', assetName);
          return sendFile(res, filePath);
        }

        // 静态资源代理：blocks/*
        if (subPath.startsWith('/blocks/')) {
          const blockImgName = subPath.replace('/blocks/', '');
          const filePath = path.join(projectPath, 'blocks', blockImgName);
          return sendFile(res, filePath);
        }

        // 静态资源代理：output/*
        if (subPath.startsWith('/output/')) {
          const outputName = subPath.replace('/output/', '');
          const filePath = path.join(projectPath, 'output', outputName);
          return sendFile(res, filePath);
        }
      }

      return sendJson(res, 404, { ok: false, error: 'API 未找到' });
    }

    // 2. 全局字体代理 /fonts/*
    if (pathname.startsWith('/fonts/')) {
      const fontName = pathname.replace('/fonts/', '');
      const filePath = path.join(REPO_ROOT, 'fonts', fontName);
      return sendFile(res, filePath);
    }

    // 3. 全局素材库代理 /library/*
    if (pathname.startsWith('/library/')) {
      const libPath = pathname.replace('/library/', '');
      const filePath = path.join(REPO_ROOT, 'library', libPath);
      return sendFile(res, filePath);
    }

    // 4. 前端静态文件服务 (web/client/*)
    let clientPath = pathname;
    if (clientPath === '/' || clientPath === '') {
      clientPath = '/index.html';
    }
    const fullClientPath = path.join(CLIENT_DIR, clientPath);
    if (fs.existsSync(fullClientPath) && fs.statSync(fullClientPath).isFile()) {
      return sendFile(res, fullClientPath);
    }

    // SPA fallback: index.html
    const indexPath = path.join(CLIENT_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return sendFile(res, indexPath, 'text/html; charset=utf-8');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    console.error('[server error]', err);
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`  🎨 pic-flow Canvas 可视化控制台服务已启动`);
  console.log(`  本地地址:   http://127.0.0.1:${PORT}`);
  console.log(`  网络地址:   http://${HOST}:${PORT}`);
  console.log(`======================================================\n`);
});
