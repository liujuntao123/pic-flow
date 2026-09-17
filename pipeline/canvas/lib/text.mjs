// 文字度量与排版：Node/Skia 环境适配器，底层委托给同构排版核心 (lib/core)
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARKERS,
  KINSOKU,
  DEFAULT_SIZE,
  DEFAULT_MAX_WIDTH,
  DEFAULT_LINE_HEIGHT,
  parseContent,
  charMetrics,
  padPair,
  charColor,
} from './core/tokens.mjs';
import {
  wrapLines as coreWrapLines,
  computeBlockGeom,
  computeParagraphLayout,
} from './core/layout.mjs';

export {
  MARKERS,
  KINSOKU,
  DEFAULT_SIZE,
  DEFAULT_MAX_WIDTH,
  DEFAULT_LINE_HEIGHT,
  parseContent,
  charMetrics,
  padPair,
  charColor,
};

// 字体兜底族固定为 Noto CJK，跨环境字形族不漂移
const FONT_REG = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
const FONT_BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
  if (!p || p.startsWith('/')) return p;
  const local = state.root ? `${state.root}/${p}` : p;
  if (fs.existsSync(local)) return local;
  const fallback = path.join(SKILL_ROOT, p);
  if (fs.existsSync(fallback)) return fallback;
  return local;
}

function familyOf(fam, bold) {
  const pair = state.families[fam] || state.families.body || [FONT_REG, FONT_BOLD];
  let fontPath = bold ? pair[1] : pair[0];
  if (!fontPath || !fs.existsSync(fontPath)) fontPath = fontPath && bold ? pair[0] : FONT_REG;
  if (!fontPath || !fs.existsSync(fontPath)) fontPath = FONT_REG;
  const key = `${fontPath}`;
  if (!state.registered.has(key)) {
    const kw = fontPath.endsWith('.ttc') ? { index: 2 } : undefined;
    const alias = `picflow-${state.registered.size}`;
    try {
      GlobalFonts.registerFromPath(fontPath, alias, kw);
    } catch {
      GlobalFonts.registerFromPath(fontPath, alias);
    }
    state.registered.set(key, alias);
  }
  return state.registered.get(key);
}

export function fontStr(size, bold, family = 'body') {
  return `${size}px "${familyOf(family, bold)}"`;
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

/** 委托同构核心的贪心逐字折行 */
export function wrapLines(chars, size, bold, maxW, family = 'body') {
  return coreWrapLines(chars, size, bold, maxW, family, charWidth);
}

/** 文本块几何：折行 + 行宽 + 左上锚点 */
export function blockGeom(el, W, families) {
  return computeBlockGeom(el, W, families, charWidth);
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
  return computeParagraphLayout(el, W, families, charWidth, ascent);
}
