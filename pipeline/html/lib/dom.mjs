// HTML 排版线的共享工具：字体 @font-face、段落 HTML、DOM 度量、栅格化。
//
// 与 Canvas 线的关系：读**同一份 layout JSON**。区别只在文字怎么落地 ——
//   · Canvas 线：Skia 逐字定位
//   · HTML 线：浏览器排版引擎排版，文字用绝对定位的 DOM 块承载
//     （= 背景图（插图/气泡/线条）+ 绝对定位文本块）
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blockGeom, setFonts, fontStr } from '../../canvas/lib/text.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** @font-face 声明：把项目里的字体文件喂给浏览器，family 名与 layout 的 font 字段同名。 */
export function fontFaceCss(theme, root) {
  const fams = theme.fonts || {};
  const out = [];
  for (const [fam, pair] of Object.entries(fams)) {
    const [reg, bold] = Array.isArray(pair) ? pair : [pair, pair];
    for (const [file, weight] of [[reg, 400], [bold, 700]]) {
      let p = file && !file.startsWith('/') ? path.join(root, file) : file;
      if (!p || !fs.existsSync(p)) {
        // 兜底：从 skill 根目录的 fonts/ 找（兼容 examples/ 这种未软链 fonts 的目录）
        const fallback = path.join(SKILL_ROOT, file);
        if (fs.existsSync(fallback)) p = fallback;
      }
      if (!p || !fs.existsSync(p)) continue;
      out.push(`@font-face{font-family:'${fam}';src:url('file://${p}');font-weight:${weight};font-display:block}`);
    }
  }
  return out.join('\n');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MARKERS = { '【': ['】', 'hl'], '『': ['』', 'quote'], '〖': ['〗', 'warn'] };

/** 语义标记 → <span> 序列（浏览器负责折行，标记只决定颜色与字体）。 */
export function contentToHtml(content) {
  let out = '';
  let buf = '';
  let style = null;
  let close = null;
  const flush = () => {
    if (!buf) return;
    out += style ? `<span class="${style}">${esc(buf)}</span>` : esc(buf);
    buf = '';
  };
  for (const ch of String(content)) {
    if (style === null) {
      if (MARKERS[ch]) {
        flush();
        [close, style] = MARKERS[ch];
      } else buf += ch;
    } else if (ch === close) {
      flush();
      style = null;
      close = null;
    } else buf += ch;
  }
  flush();
  return out;
}

/** 语义类的样式（色 + 字重 + 毛笔体放大 8%，与另两条引擎同口径）。 */
export function semanticCss(size, el, theme) {
  const hl = el.hl_color ?? theme.hl_color ?? '#E8842B';
  const quote = el.quote_color ?? theme.quote_color ?? '#2E7CB8';
  const warn = el.warn_color ?? theme.warn_color ?? '#D4483B';
  const warnSize = Math.round(size * 1.08);
  return `.hl{color:${hl};font-weight:700}`
    + `.quote{color:${quote};font-weight:700}`
    + `.warn{color:${warn};font-family:'brush';font-weight:700;font-size:${warnSize}px}`;
}

/**
 * 一个文本元素 → 一个绝对定位的 DOM 块。
 *
 * 垂直口径：块顶 = 段首行顶（y）；`line-height` 直接用引擎的行高（size×line_height）。
 * Chrome 把文字在行盒里按字体度量安置，与 Skia 的 `top + ascent` 会有几像素差 ——
 * 该差值由 `pipeline/html/vs-canvas.mjs` 实测给出，需要时用 dy 补偿。
 */
export function textElementHtml(el, W, theme, { dx = 0, dy = 0, idx = 0 } = {}) {
  const box = { ...(theme.bubble || {}), ...(el.box || {}) };
  const geo = blockGeom(el, W, box);
  const w = Math.max(1, Math.round(geo.w + 2 * geo.px));
  const x = Math.round(geo.left - geo.px + dx);
  const y = Math.round(geo.top - geo.py + dy);
  const lh = Math.round(geo.lh * 100) / 100;
  const size = el.size ?? 40;
  const family = el.font ?? 'body';
  const bold = el.bold ? 700 : 400;
  const color = el.color ?? el.box?.color ?? theme.text ?? '#333333';
  const align = el.align ?? 'center';
  const stroke = el.stroke_width
    ? `-webkit-text-stroke:${el.stroke_width}px ${el.stroke_fill ?? '#FFFFFF'};paint-order:stroke fill;`
    : '';
  const rot = el.rotate ? `transform:rotate(${el.rotate}deg);` : '';
  const cls = `para p${idx}`;
  const html = `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;`
    + `font-family:'${family}';font-size:${size}px;font-weight:${bold};`
    + `line-height:${lh}px;color:${color};`
    + `text-align:${align};white-space:pre-wrap;word-break:normal;overflow-wrap:break-word;`
    + `${stroke}${rot}">${contentToHtml(el.content)}</div>`;
  return { html, css: semanticCss(size, el, theme), cls, geo, box, w, x, y, lh, size, align, el };
}

/** 收集所有文本元素，产出 HTML 片段与需要的 CSS。 */
export function textLayer(layout, theme, { dx = 0, dy = 0 } = {}) {
  const parts = [];
  const css = [];
  layout.elements.forEach((el, idx) => {
    if (el.type !== 'text') return;
    const r = textElementHtml(el, layout.width, theme, { dx, dy, idx });
    parts.push(r.html);
    css.push(r.css);
  });
  return { html: parts.join('\n'), css: [...new Set(css)].join('\n') };
}

/**
 * 浏览器里的实测（DOM 度量 = HTML 方案的排版真值）：
 * 逐段拿到每一行的真实矩形，用于「行宽越界 / 孤字行 / 实际折行数」机检。
 */
export async function measureDom(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.para').forEach((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const raw = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      const host = el.getBoundingClientRect();
      const lines = raw.map((r) => ({
        x: +(r.left - host.left).toFixed(1),
        y: +(r.top - host.top).toFixed(1),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
      })).sort((a, b) => a.y - b.y || a.x - b.x);
      const merged = [];
      for (const l of lines) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.y - l.y) < 2) {
          last.w = Math.max(last.x + last.w, l.x + l.w) - Math.min(last.x, l.x);
          last.x = Math.min(last.x, l.x);
        } else merged.push({ ...l });
      }
      out.push({
        cls: el.className.split(' ').pop(),
        left: +host.left.toFixed(1),
        top: +host.top.toFixed(1),
        width: +host.width.toFixed(1),
        height: +host.height.toFixed(1),
        lineCount: merged.length,
        lines: merged,
        text: el.textContent,
      });
    });
    return { paras: out };
  });
}

/** 用 Playwright 打开文件并交给回调（截图 / 度量）；浏览器用本机已有的 Chrome。 */
export async function withPage(htmlPath, { width, height, scale = 1, chromePath }, fn) {
  const { chromium } = await import('playwright-core');
  const exe = chromePath || process.env.CHROME_PATH
    || '/home/box/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files',
      '--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.goto(`file://${path.resolve(htmlPath)}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export { setFonts, fontStr, blockGeom };
