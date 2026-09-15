// 文字度量与排版（Canvas 版）：与 Python `compose.py` 同一套几何口径。
//
// 关键：折行、行宽、基线全部用**逐字累计宽度**算出来，不依赖 Canvas 的
// ctx.fillText 自动排版。所以同一份 layout JSON 在两个引擎下：
//   · 元素落点（x/y/anchor）由 layout 决定 —— 逐像素一致
//   · 折行结果由「逐字宽度和 ≤ max_width」决定 —— 同一套贪心算法
//   · 只有字形栅格化（Skia vs FreeType）会有亚像素差异
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

export const MARKERS = { '【': ['】', 'hl'], '『': ['』', 'quote'], '〖': ['〗', 'warn'] };
export const KINSOKU = '，。！？；：、）】》%”…—』〗';

// 与 compose.py 的 fallback 保持同一口径（Noto CJK），保证两引擎字形族一致
const FONT_REG = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
const FONT_BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc';

const state = { root: null, families: {}, registered: new Map() };
let measureCtx = null;

function ctx2d() {
  if (!measureCtx) measureCtx = createCanvas(8, 8).getContext('2d');
  return measureCtx;
}

// 内置字体预设表
const DEFAULT_FONTS = {
  body: ['fonts/LXGWWenKai-Regular.ttf', 'fonts/LXGWWenKai-Medium.ttf'],
  title: ['fonts/ZCOOLKuaiLe-Regular.ttf', 'fonts/ZCOOLKuaiLe-Regular.ttf'],
  brush: ['fonts/MaShanZheng-Regular.ttf', 'fonts/MaShanZheng-Regular.ttf'],
  butter: ['fonts/ZCOOLQingKeHuangYou-Regular.ttf', 'fonts/ZCOOLQingKeHuangYou-Regular.ttf'],
  xiaowei: ['fonts/ZCOOLXiaoWei-Regular.ttf', 'fonts/ZCOOLXiaoWei-Regular.ttf'],
  handwriting: ['fonts/Xiaolai-Regular.ttf', 'fonts/Xiaolai-Regular.ttf'],
  running: ['fonts/ZhiMangXing-Regular.ttf', 'fonts/ZhiMangXing-Regular.ttf'],
  cursive: ['fonts/LongCang-Regular.ttf', 'fonts/LongCang-Regular.ttf'],
  sans: [FONT_REG, FONT_BOLD],
  serif: ['/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'],
};

/** 解析字体族：{body:[reg,bold]}，相对路径按项目根解析。 */
export function setFonts(root, fonts) {
  state.root = root;
  state.families = {};
  const merged = { ...DEFAULT_FONTS, ...(fonts || {}) };
  for (const [fam, pair] of Object.entries(merged)) {
    const [reg, bold] = Array.isArray(pair) ? pair : [pair, pair];
    state.families[fam] = [resolve(reg), resolve(bold)];
  }
  state.families.noto = [FONT_REG, FONT_BOLD];
}

function resolve(p) {
  return p && !p.startsWith('/') && state.root ? `${state.root}/${p}` : p;
}

/** 字体文件 -> 已注册的 CSS family 名（每个文件只注册一次）。 */
function familyOf(fam, bold) {
  const pair = state.families[fam] || state.families.body || [FONT_REG, FONT_BOLD];
  let path = bold ? pair[1] : pair[0];
  if (!path || !fs.existsSync(path)) path = path && bold ? pair[0] : FONT_REG;
  if (!path || !fs.existsSync(path)) path = FONT_REG;
  const key = `${path}`;
  if (!state.registered.has(key)) {
    // .ttc 需要指定 face index（与 Pillow 的 index=SC 对齐：简中面）
    const kw = path.endsWith('.ttc') ? { index: 2 } : undefined;
    const alias = `picflow-${state.registered.size}`;
    try {
      GlobalFonts.registerFromPath(path, alias, kw);
    } catch {
      GlobalFonts.registerFromPath(path, alias);
    }
    state.registered.set(key, alias);
  }
  return state.registered.get(key);
}

export function fontStr(size, bold, family = 'body') {
  return `${size}px "${familyOf(family, bold)}"`;
}

/** 每个字按语义样式换算 (family, bold, size)。 */
export function charMetrics(family, bold, size, st) {
  if (st === 'hl' || st === 'quote') return [family, true, size];
  if (st === 'warn') return ['brush', true, Math.round(size * 1.08)];
  return [family, bold, size];
}

export function charWidth(ch, size, bold, family = 'body') {
  const c = ctx2d();
  c.font = fontStr(size, bold, family);
  return c.measureText(ch).width;
}

export function lineWidth(line, size, bold, family = 'body', offset = 0) {
  const c = ctx2d();
  let w = 0;
  for (const [ch, st] of line) {
    const [f, b, sz] = charMetrics(family, bold, size, st);
    c.font = fontStr(sz, b, f);
    w += c.measureText(ch).width;
  }
  return w + offset;
}

/** 去掉 【】『』〖〗 标记，返回 [char, style|null] 序列。 */
export function parseContent(s) {
  const out = [];
  let style = null;
  let close = null;
  for (const ch of s) {
    if (style === null) {
      if (MARKERS[ch]) [close, style] = MARKERS[ch];
      else out.push([ch, null]);
    } else if (ch === close) {
      style = null;
      close = null;
    } else out.push([ch, style]);
  }
  return out;
}

/**
 * 贪心逐字折行 + 避头点 + ASCII 整词不拆。
 * 与 compose.py 的 wrap_lines 逐行等价（含把行尾 ASCII 词整体挪到下一行的分支）。
 */
export function wrapLines(chars, size, bold, maxW, family = 'body') {
  const lines = [];
  let cur = [];
  let curW = 0;
  const isAsciiWord = (ch) => ch.codePointAt(0) < 128 && /[A-Za-z0-9]/.test(ch);

  let i = 0;
  while (i < chars.length) {
    const [ch, st] = chars[i];
    if (ch === '\n') {
      lines.push(cur);
      cur = [];
      curW = 0;
      i += 1;
      continue;
    }
    const [f, b, sz] = charMetrics(family, bold, size, st);
    const w = charWidth(ch, sz, b, f);
    if (cur.length && curW + w > maxW && !KINSOKU.includes(ch)) {
      if (isAsciiWord(ch)) {
        let j = cur.length;
        while (j > 0 && isAsciiWord(cur[j - 1][0])) j -= 1;
        if (j < cur.length) {
          const moved = cur.slice(j);
          lines.push(cur.slice(0, j));
          cur = moved;
          curW = lineWidth(moved, size, bold, family);
          cur.push([ch, st]);
          curW += w;
          i += 1;
          continue;
        }
      }
      lines.push(cur);
      cur = [];
      curW = 0;
    }
    cur.push([ch, st]);
    curW += w;
    i += 1;
  }
  if (cur.length || !lines.length) lines.push(cur);
  return lines;
}

/** 文本块几何：折行 + 行宽 + 左上锚点（与 compose.block_geom 同口径）。 */
export function blockGeom(el, W, families) {
  const chars = parseContent(el.content || '');
  const size = el.size ?? 40;
  const bold = el.bold ?? false;
  const family = el.font ?? 'body';
  const maxW = el.max_width ?? 940;
  const lines = wrapLines(chars, size, bold, maxW, family);
  const lh = size * (el.line_height ?? 1.4); // 与 compose.py 一致
  const widths = lines.map((ln) => lineWidth(ln, size, bold, family));
  const w = widths.length ? Math.max(...widths) : 0;
  const x = el.x ?? Math.floor(W / 2);
  const align = el.align ?? 'center';
  const left = align === 'center' ? x - w / 2 : align === 'left' ? x : x - w;
  const [px, py] = padPair(families);
  const height = lines.length * lh;
  return { lines, widths, lh, w, height, size, bold, family, align, left, top: el.y ?? 0, px, py };
}

export function padPair(box) {
  const pad = (box || {}).pad ?? 0;
  return Array.isArray(pad) ? [pad[1], pad[0]] : [pad, pad];
}

/** 单行字体基线高度（Skia：emHeightAscent ≈ 字体 ascent）。 */
export function ascent(size, bold, family = 'body') {
  const c = ctx2d();
  c.font = fontStr(size, bold, family);
  const m = c.measureText('汉Ag');
  return m.emHeightAscent ?? m.actualBoundingBoxAscent ?? size * 0.88;
}

/** 按行折好、可直接 ctx.fillText 的段落（每行给出起点 x 与各字样式）。 */
export function layoutParagraph(el, W, families) {
  const geo = blockGeom(el, W, families);
  const align = el.align ?? 'center';
  const asc = ascent(geo.size, geo.bold, geo.family);
  const rows = geo.lines.map((ln, i) => {
    const lw = geo.widths[i];
    let cx =
      align === 'center'
        ? geo.left + (geo.w - lw) / 2
        : align === 'left'
          ? geo.left
          : geo.left + geo.w - lw;
    const chars = ln.map(([ch, st]) => {
      const [f, b, sz] = charMetrics(geo.family, geo.bold, geo.size, st);
      const wch = charWidth(ch, sz, b, f);
      const item = { ch, st, f, b, sz, x: cx, w: wch };
      cx += wch;
      return item;
    });
    return { chars, baseline: geo.top + i * geo.lh + asc, lw };
  });
  return { ...geo, asc, rows, height: geo.lines.length * geo.lh };
}
