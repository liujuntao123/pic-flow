// 同构 Token 解析与样式规则（Node 与浏览器完全共享）
export const MARKERS = { '【': ['】', 'hl'], '『': ['』', 'quote'], '〖': ['〗', 'warn'] };
export const KINSOKU = '，。！？；：、）】》%”…—』〗';

export const DEFAULT_SIZE = 40;
export const DEFAULT_MAX_WIDTH = 940;
export const DEFAULT_LINE_HEIGHT = 1.5;

/** 去掉 【】『』〖〗 标记，返回 [char, style|null] 序列。 */
export function parseContent(s) {
  const out = [];
  let style = null;
  let close = null;
  for (const ch of (s || '')) {
    if (style === null) {
      if (MARKERS[ch]) [close, style] = MARKERS[ch];
      else out.push([ch, null]);
    } else if (ch === close) {
      style = null;
      close = null;
    } else {
      out.push([ch, style]);
    }
  }
  return out;
}

/** 每个字按语义样式换算 (family, bold, size)。 */
export function charMetrics(family, bold, size, st) {
  if (st === 'hl' || st === 'quote') return [family, true, size];
  if (st === 'warn') return ['brush', true, Math.round(size * 1.08)];
  return [family, bold, size];
}

export function padPair(box) {
  const pad = (box || {}).pad ?? 0;
  return Array.isArray(pad) ? [pad[1], pad[0]] : [pad, pad];
}

/**
 * 语义三色：hl 橙 / quote 蓝 / warn 红；未标记的字用元素色。
 * 兜底顺序：el.color → el.box.color → theme.text。
 */
export function charColor(el, st, theme, box) {
  if (st === 'hl') return el.hl_color ?? theme?.hl_color ?? '#E8842B';
  if (st === 'quote') return el.quote_color ?? theme?.quote_color ?? '#2E7CB8';
  if (st === 'warn') return el.warn_color ?? theme?.warn_color ?? '#D4483B';
  return el.color ?? el.box?.color ?? theme?.text ?? '#333333';
}
