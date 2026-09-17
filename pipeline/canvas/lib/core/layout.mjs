// 同构文本排版与折行核心（Node 与浏览器完全共享）
import {
  KINSOKU,
  DEFAULT_SIZE,
  DEFAULT_MAX_WIDTH,
  DEFAULT_LINE_HEIGHT,
  parseContent,
  charMetrics,
  padPair,
} from './tokens.mjs';

/**
 * 贪心逐字折行 + 避头点 + ASCII 整词不拆。
 *
 * @param {Array<[string, string|null]>} chars 待排字符与语义样式元组
 * @param {number} size 基准字号
 * @param {boolean} bold 是否加粗
 * @param {number} maxW 最大宽度
 * @param {string} family 字体族类型名
 * @param {Function} measureChar (ch, size, bold, family) => number
 */
export function wrapLines(chars, size, bold, maxW, family = 'body', measureChar) {
  const lines = [];
  let cur = [];
  let curW = 0;
  const isAsciiWord = (ch) => ch.codePointAt(0) < 128 && /[A-Za-z0-9]/.test(ch);

  const getLineWidth = (arr) => {
    let sum = 0;
    for (const [c, s] of arr) {
      const [f, b, sz] = charMetrics(family, bold, size, s);
      sum += measureChar(c, sz, b, f);
    }
    return sum;
  };

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
    const w = measureChar(ch, sz, b, f);
    if (cur.length && curW + w > maxW && !KINSOKU.includes(ch)) {
      if (isAsciiWord(ch)) {
        let j = cur.length;
        while (j > 0 && isAsciiWord(cur[j - 1][0])) j -= 1;
        if (j < cur.length) {
          const moved = cur.slice(j);
          lines.push(cur.slice(0, j));
          cur = moved;
          curW = getLineWidth(moved);
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

/** 文本块几何计算：折行 + 行宽 + 左上锚点。 */
export function computeBlockGeom(el, W, themeOrBox, measureChar) {
  const chars = parseContent(el.content || '');
  const size = el.size ?? DEFAULT_SIZE;
  const bold = el.bold ?? false;
  const family = el.font ?? 'body';
  const maxW = el.max_width ?? DEFAULT_MAX_WIDTH;
  const lines = wrapLines(chars, size, bold, maxW, family, measureChar);
  const lh = size * (el.line_height ?? DEFAULT_LINE_HEIGHT);
  const widths = lines.map((ln) => {
    let w = 0;
    for (const [ch, st] of ln) {
      const [f, b, sz] = charMetrics(family, bold, size, st);
      w += measureChar(ch, sz, b, f);
    }
    return w;
  });
  const w = widths.length ? Math.max(...widths) : 0;
  const x = el.x ?? Math.floor(W / 2);
  const align = el.align ?? 'center';
  const left = align === 'center' ? x - w / 2 : align === 'left' ? x : x - w;
  const [px, py] = padPair(themeOrBox);
  const height = lines.length * lh;
  return { lines, widths, lh, w, height, size, bold, family, align, left, top: el.y ?? 0, px, py };
}

/** 段落布局结果（带各字物理坐标与基线）。 */
export function computeParagraphLayout(el, W, themeOrBox, measureChar, getAscent) {
  const geo = computeBlockGeom(el, W, themeOrBox, measureChar);
  const align = el.align ?? 'center';
  const asc = getAscent ? getAscent(geo.size, geo.bold, geo.family) : geo.size * 0.88;
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
      const wch = measureChar(ch, sz, b, f);
      const item = { ch, st, f, b, sz, x: cx, w: wch };
      cx += wch;
      return item;
    });
    return { chars, baseline: geo.top + i * geo.lh + asc, lw };
  });
  return { ...geo, asc, rows, height: geo.lines.length * geo.lh };
}
