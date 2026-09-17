/**
   * pic-flow Canvas Studio 图标库 (Canva 风格矢量图标)
   * 采用 1.5px / 2px 优雅线框与微几何形制，杜绝粗糙 Emoji
   */

function svg(paths, { size = 16, stroke = 'currentColor', fill = 'none', strokeWidth = 1.75, viewBox = '0 0 24 24', extraClass = '' } = {}) {
  return `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="${viewBox}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const ICONS = {
  // 品牌与通用
  logo: (size = 20) => svg(`
    <path d="M12 2L2 7l10 5 10-5-10-5z" fill="rgba(255,255,255,0.3)" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  `, { size, stroke: '#ffffff', strokeWidth: 2 }),

  home: (size = 16) => svg(`
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  `, { size }),

  search: (size = 16) => svg(`
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  `, { size }),

  plus: (size = 16) => svg(`
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  `, { size }),

  plusCircle: (size = 16) => svg(`
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  `, { size }),

  close: (size = 16) => svg(`
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  `, { size }),

  trash: (size = 16) => svg(`
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  `, { size }),

  duplicate: (size = 16) => svg(`
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  `, { size }),

  // 侧边栏导航 Rail
  blocks: (size = 20) => svg(`
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
  `, { size }),

  script: (size = 20) => svg(`
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  `, { size }),

  layers: (size = 20) => svg(`
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  `, { size }),

  assets: (size = 20) => svg(`
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  `, { size }),

  addMenu: (size = 20) => svg(`
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  `, { size }),

  // 元素种类
  text: (size = 16) => svg(`
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  `, { size }),

  bubble: (size = 16) => svg(`
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  `, { size }),

  rule: (size = 16) => svg(`
    <line x1="5" y1="12" x2="19" y2="12" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" />
  `, { size }),

  card: (size = 16) => svg(`
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
  `, { size }),

  // 操作与控制
  undo: (size = 16) => svg(`
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  `, { size }),

  redo: (size = 16) => svg(`
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
  `, { size }),

  zoomIn: (size = 16) => svg(`
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  `, { size }),

  zoomOut: (size = 16) => svg(`
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  `, { size }),

  zoomFit: (size = 16) => svg(`
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  `, { size }),

  grid: (size = 16) => svg(`
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <line x1="15" y1="3" x2="15" y2="21" />
  `, { size }),

  refresh: (size = 16) => svg(`
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  `, { size }),

  lint: (size = 16) => svg(`
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="5" y1="7" x2="19" y2="7" />
    <polyline points="5 7 2 13 8 13 5 7" />
    <polyline points="19 7 16 13 22 13 19 7" />
  `, { size }),

  sparkles: (size = 16) => svg(`
    <path d="M12 2l2.4 5.2L20 8l-4 4.2.9 5.8-4.9-2.8-4.9 2.8.9-5.8L4 8l5.6-.8L12 2z" />
  `, { size }),

  save: (size = 16) => svg(`
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  `, { size }),

  download: (size = 16) => svg(`
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  `, { size }),

  help: (size = 16) => svg(`
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  `, { size }),

  chevronLeft: (size = 16) => svg(`
    <polyline points="15 18 9 12 15 6" />
  `, { size }),

  chevronRight: (size = 16) => svg(`
    <polyline points="9 18 15 12 9 6" />
  `, { size }),

  arrowUp: (size = 14) => svg(`
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  `, { size }),

  arrowDown: (size = 14) => svg(`
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  `, { size }),

  flip: (size = 16) => svg(`
    <line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="2 2" />
    <polyline points="4 8 8 12 4 16" />
    <polyline points="20 8 16 12 20 16" />
  `, { size }),

  alignLeft: (size = 16) => svg(`
    <line x1="21" y1="6" x2="3" y2="6" />
    <line x1="15" y1="12" x2="3" y2="12" />
    <line x1="17" y1="18" x2="3" y2="18" />
  `, { size }),

  alignCenter: (size = 16) => svg(`
    <line x1="18" y1="6" x2="6" y2="6" />
    <line x1="21" y1="12" x2="3" y2="12" />
    <line x1="18" y1="18" x2="6" y2="18" />
  `, { size }),

  alignRight: (size = 16) => svg(`
    <line x1="21" y1="6" x2="3" y2="6" />
    <line x1="21" y1="12" x2="9" y2="12" />
    <line x1="21" y1="18" x2="7" y2="18" />
  `, { size }),

  bold: (size = 14) => svg(`
    <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
  `, { size, strokeWidth: 2.5 }),
};
