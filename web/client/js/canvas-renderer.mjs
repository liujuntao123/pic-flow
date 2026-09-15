/**
 * pic-flow 浏览器端 Canvas 渲染与几何计算引擎
 * 与 Node/Skia 后端 (pipeline/canvas/lib) 口径完全一致
 */

const FONT_MAP = {
  body: 'LXGWWenKai, "Noto Sans CJK SC", sans-serif',
  title: 'ZCOOLKuaiLe, "Noto Sans CJK SC", sans-serif',
  brush: 'MaShanZheng, "Noto Serif CJK SC", serif',
  butter: 'ZCOOLQingKeHuangYou, sans-serif',
  xiaowei: 'ZCOOLXiaoWei, serif',
  handwriting: 'Xiaolai, "LXGWWenKai", sans-serif',
  running: 'ZhiMangXing, "MaShanZheng", cursive',
  cursive: 'LongCang, "MaShanZheng", cursive',
  sans: '"Noto Sans CJK SC", sans-serif',
  serif: '"Noto Serif CJK SC", serif',
};

// 避头标点（不能出现在行首）
const NO_HEAD = new Set([
  '，', '。', '、', '；', '：', '？', '！', '）', '》', '」', '』', '】', '〗', '”', '’', '…', '—',
  ',', '.', ';', ':', '?', '!', ')', '>', ']', '}',
]);

// 避尾标点（不能出现在行尾）
const NO_TAIL = new Set([
  '（', '《', '「', '『', '【', '〖', '“', '‘',
  '(', '<', '[', '{',
]);

export class CanvasRenderer {
  constructor() {
    this.imageCache = new Map();
    this.fontsLoaded = false;
    this.ensureFontsLoaded();
  }

  async ensureFontsLoaded() {
    if (document.fonts) {
      await document.fonts.ready;
      this.fontsLoaded = true;
    }
  }

  /**
   * 加载并缓存图片
   */
  async loadImage(url) {
    if (!url) return null;
    if (this.imageCache.has(url)) {
      const entry = this.imageCache.get(url);
      if (entry.status === 'loaded') return entry.img;
      if (entry.status === 'loading') return entry.promise;
      return null;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    const promise = new Promise((resolve) => {
      img.onload = () => {
        this.imageCache.set(url, { status: 'loaded', img });
        resolve(img);
      };
      img.onerror = () => {
        this.imageCache.set(url, { status: 'error', img: null });
        resolve(null);
      };
    });

    this.imageCache.set(url, { status: 'loading', promise });
    img.src = url;
    return promise;
  }

  /**
   * 解析带语义高亮的文本串
   * 【关键词】橙 / 『引语』蓝 / 〖强信息〗红毛笔
   */
  parseTokens(text) {
    const tokens = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
      if (text.slice(i, i + 1) === '【') {
        const end = text.indexOf('】', i + 1);
        if (end !== -1) {
          tokens.push({ type: 'hl', text: text.slice(i + 1, end) });
          i = end + 1;
          continue;
        }
      }
      if (text.slice(i, i + 1) === '『') {
        const end = text.indexOf('』', i + 1);
        if (end !== -1) {
          tokens.push({ type: 'quote', text: text.slice(i + 1, end) });
          i = end + 1;
          continue;
        }
      }
      if (text.slice(i, i + 1) === '〖') {
        const end = text.indexOf('〗', i + 1);
        if (end !== -1) {
          tokens.push({ type: 'warn', text: text.slice(i + 1, end) });
          i = end + 1;
          continue;
        }
      }

      // 普通字符
      let nextSpecial = n;
      for (const m of ['【', '『', '〖', '\n']) {
        const idx = text.indexOf(m, i);
        if (idx !== -1 && idx < nextSpecial) nextSpecial = idx;
      }

      if (nextSpecial === i) {
        if (text[i] === '\n') {
          tokens.push({ type: 'newline', text: '\n' });
          i += 1;
          continue;
        }
        tokens.push({ type: 'normal', text: text[i] });
        i += 1;
      } else {
        tokens.push({ type: 'normal', text: text.slice(i, nextSpecial) });
        i = nextSpecial;
      }
    }
    return tokens;
  }

  /**
   * 字体字符串构造
   */
  getFontString(size, bold, fontType = 'body') {
    const family = FONT_MAP[fontType] || FONT_MAP.body;
    return `${bold ? 'bold ' : ''}${Math.round(size)}px ${family}`;
  }

  /**
   * 排版多行文本（带避头点与换行）
   */
  layoutTextLines(ctx, el, theme) {
    const content = el.content || '';
    const rawLines = content.split('\n');
    const maxWidth = el.max_width || 9999;
    const baseSize = el.size || 32;
    const baseFont = el.font || 'body';
    const isBold = Boolean(el.bold);

    const laidOutLines = [];

    for (const rawLine of rawLines) {
      if (!rawLine) {
        laidOutLines.push({ width: 0, runs: [] });
        continue;
      }

      const tokens = this.parseTokens(rawLine);
      // 展平成单个有样式的字块
      const chars = [];
      for (const tok of tokens) {
        const tokType = tok.type;
        const text = tok.text;
        for (let c = 0; c < text.length; c += 1) {
          const char = text[c];
          let cSize = baseSize;
          let cFont = baseFont;
          let cBold = isBold;
          let cColor = el.color || el.box?.color || theme?.text || '#333333';

          if (tokType === 'hl') {
            cColor = el.hl_color || theme?.hl_color || '#E8842B';
            cBold = true;
          } else if (tokType === 'quote') {
            cColor = el.quote_color || theme?.quote_color || '#2E7CB8';
            cBold = true;
          } else if (tokType === 'warn') {
            cColor = el.warn_color || theme?.warn_color || '#D4483B';
            cFont = 'brush';
            cSize = Math.round(baseSize * 1.08);
          }

          ctx.font = this.getFontString(cSize, cBold, cFont);
          const w = ctx.measureText(char).width;
          chars.push({ char, width: w, size: cSize, font: cFont, bold: cBold, color: cColor });
        }
      }

      // 贪心折行
      let curLine = [];
      let curLineWidth = 0;

      for (let ci = 0; ci < chars.length; ci += 1) {
        const item = chars[ci];
        // 判断如果加入是否超宽
        if (curLine.length > 0 && curLineWidth + item.width > maxWidth) {
          // 避头点处理：如果当前字是避头标点，把前一个字也拉下来
          if (NO_HEAD.has(item.char) && curLine.length > 1) {
            const last = curLine.pop();
            curLineWidth -= last.width;
            laidOutLines.push({ width: curLineWidth, runs: curLine });
            curLine = [last, item];
            curLineWidth = last.width + item.width;
          } else {
            laidOutLines.push({ width: curLineWidth, runs: curLine });
            curLine = [item];
            curLineWidth = item.width;
          }
        } else {
          curLine.push(item);
          curLineWidth += item.width;
        }
      }

      if (curLine.length > 0) {
        laidOutLines.push({ width: curLineWidth, runs: curLine });
      }
    }

    return laidOutLines;
  }

  /**
   * 绘制气泡底板 (八种 style + 8 向 tail)
   */
  drawBox(ctx, rect, box, theme) {
    const { x, y, width: w, height: h } = rect;
    const style = box.style || 'fill';
    const bg = box.bg || theme?.bubble?.bg || '#F6A83C';
    const borderColor = box.border_color || theme?.bubble?.border_color || '#333333';
    const borderWidth = box.border ?? (style === 'outline' || style === 'sketch' ? 3 : 2);
    const radius = box.radius ?? 16;

    ctx.save();

    if (style === 'fill' || style === 'pill') {
      const r = style === 'pill' ? h / 2 : radius;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = bg;
      ctx.fill();
    } else if (style === 'outline') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = bg || '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderWidth;
      ctx.stroke();
    } else if (style === 'sketch') {
      // 双线手绘框
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = bg || '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.roundRect(x - 3, y - 3, w + 6, h + 6, radius + 2);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (style === 'ink') {
      // 墨底白字
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = bg || '#262626';
      ctx.fill();
    } else if (style === 'stamp') {
      // 印章
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = bg || 'rgba(212, 72, 59, 0.08)';
      ctx.fill();
      ctx.strokeStyle = borderColor || '#D4483B';
      ctx.lineWidth = borderWidth || 3;
      ctx.stroke();
    } else if (style === 'marker') {
      // 荧光马克笔底色
      ctx.fillStyle = bg || 'rgba(246, 168, 60, 0.35)';
      ctx.fillRect(x, y + h * 0.45, w, h * 0.55);
    } else if (style === 'burst') {
      // 爆炸齿
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = w / 2 + 18;
      const ry = h / 2 + 14;
      const points = 16;
      ctx.beginPath();
      for (let i = 0; i < points * 2; i += 1) {
        const ang = (i * Math.PI) / points;
        const rad = i % 2 === 0 ? 1 : 0.82;
        const px = cx + Math.cos(ang) * rx * rad;
        const py = cy + Math.sin(ang) * ry * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderWidth;
      ctx.stroke();
    }

    // 绘制气泡 tail 小三角
    if (box.tail && box.tail !== 'none') {
      const tailLen = box.tail_len || 20;
      const t = box.tail;
      ctx.beginPath();

      if (t === 'bl') {
        ctx.moveTo(x + 24, y + h);
        ctx.lineTo(x + 12, y + h + tailLen);
        ctx.lineTo(x + 44, y + h);
      } else if (t === 'bc') {
        ctx.moveTo(x + w / 2 - 12, y + h);
        ctx.lineTo(x + w / 2, y + h + tailLen);
        ctx.lineTo(x + w / 2 + 12, y + h);
      } else if (t === 'br') {
        ctx.moveTo(x + w - 44, y + h);
        ctx.lineTo(x + w - 12, y + h + tailLen);
        ctx.lineTo(x + w - 24, y + h);
      } else if (t === 'tl') {
        ctx.moveTo(x + 24, y);
        ctx.lineTo(x + 12, y - tailLen);
        ctx.lineTo(x + 44, y);
      } else if (t === 'tc') {
        ctx.moveTo(x + w / 2 - 12, y);
        ctx.lineTo(x + w / 2, y - tailLen);
        ctx.lineTo(x + w / 2 + 12, y);
      } else if (t === 'tr') {
        ctx.moveTo(x + w - 44, y);
        ctx.lineTo(x + w - 12, y - tailLen);
        ctx.lineTo(x + w - 24, y);
      } else if (t === 'lc') {
        ctx.moveTo(x, y + h / 2 - 12);
        ctx.lineTo(x - tailLen, y + h / 2);
        ctx.lineTo(x, y + h / 2 + 12);
      } else if (t === 'rc') {
        ctx.moveTo(x + w, y + h / 2 - 12);
        ctx.lineTo(x + w + tailLen, y + h / 2);
        ctx.lineTo(x + w, y + h / 2 + 12);
      }

      ctx.closePath();
      ctx.fillStyle = bg;
      ctx.fill();
      if (style === 'outline' || style === 'sketch' || style === 'stamp') {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * 绘制单元素并计算包围盒 [minX, minY, maxX, maxY]
   */
  async drawElement(ctx, el, index, projectUrlBase, theme, isSelected = false) {
    const type = el.type;

    if (type === 'asset') {
      const assetUrl = el.file?.startsWith('/')
        ? el.file
        : el.file?.startsWith('library/')
          ? `/${el.file}`
          : `${projectUrlBase}/assets/${encodeURIComponent(el.file)}`;

      const img = await this.loadImage(assetUrl);
      const x = el.x || 0;
      const y = el.y || 0;
      let w = el.width;
      let h = el.height;

      if (img) {
        if (w !== undefined && h !== undefined) {
          // 指定双边
        } else if (h !== undefined) {
          w = (img.width * h) / img.height;
        } else if (w !== undefined) {
          h = (img.height * w) / img.width;
        } else {
          w = img.width;
          h = img.height;
        }
      } else {
        w = el.width || 300;
        h = el.height || 300;
      }

      // 计算 anchor 偏移
      const anchor = el.anchor || 'cc';
      let ox = 0;
      let oy = 0;
      if (anchor === 'cc') { ox = -w / 2; oy = -h / 2; }
      else if (anchor === 'ct') { ox = -w / 2; oy = 0; }
      else if (anchor === 'cb') { ox = -w / 2; oy = -h; }
      else if (anchor === 'lc') { ox = 0; oy = -h / 2; }
      else if (anchor === 'rc') { ox = -w; oy = -h / 2; }
      else if (anchor === 'lt') { ox = 0; oy = 0; }
      else if (anchor === 'rt') { ox = -w; oy = 0; }
      else if (anchor === 'lb') { ox = 0; oy = -h; }
      else if (anchor === 'rb') { ox = -w; oy = -h; }

      const drawX = x + ox;
      const drawY = y + oy;

      ctx.save();
      if (el.rotate) {
        ctx.translate(x, y);
        ctx.rotate((el.rotate * Math.PI) / 180);
        ctx.translate(-x, -y);
      }

      if (el.flip) {
        ctx.translate(drawX + w, drawY);
        ctx.scale(-1, 1);
        ctx.translate(-drawX, -drawY);
      }

      if (el.opacity !== undefined && el.opacity < 1) {
        ctx.globalAlpha = el.opacity;
      }

      if (img) {
        ctx.drawImage(img, drawX, drawY, w, h);
      } else {
        // 占位图
        ctx.fillStyle = '#F3F4F6';
        ctx.fillRect(drawX, drawY, w, h);
        ctx.strokeStyle = '#D1D5DB';
        ctx.lineWidth = 2;
        ctx.strokeRect(drawX, drawY, w, h);
        ctx.fillStyle = '#6B7280';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`素材缺失: ${el.file}`, drawX + w / 2, drawY + h / 2);
      }

      ctx.restore();

      return {
        index,
        element: el,
        box: [drawX, drawY, drawX + w, drawY + h],
        center: [x, y],
        width: w,
        height: h,
      };
    }

    if (type === 'text') {
      const x = el.x || 0;
      const y = el.y || 0;
      const align = el.align || 'center';
      const baseSize = el.size || 32;
      const lineHeight = baseSize * (el.line_height || 1.45);
      const lines = this.layoutTextLines(ctx, el, theme);

      // 计算文本总包围盒
      const maxLineWidth = Math.max(1, ...lines.map((l) => l.width));
      const totalHeight = Math.max(1, lines.length * lineHeight);

      let textLeft = x;
      if (align === 'center') textLeft = x - maxLineWidth / 2;
      else if (align === 'right') textLeft = x - maxLineWidth;

      const textTop = y;

      // 气泡 / 边框
      let boxRect = null;
      if (el.box) {
        const pad = el.box.pad || [12, 20]; // [padY, padX]
        const padY = Array.isArray(pad) ? pad[0] : pad;
        const padX = Array.isArray(pad) ? pad[1] : pad;
        boxRect = {
          x: textLeft - padX,
          y: textTop - padY,
          width: maxLineWidth + padX * 2,
          height: totalHeight + padY * 2,
        };
      }

      ctx.save();
      if (el.rotate) {
        const cx = textLeft + maxLineWidth / 2;
        const cy = textTop + totalHeight / 2;
        ctx.translate(cx, cy);
        ctx.rotate((el.rotate * Math.PI) / 180);
        ctx.translate(-cx, -cy);
      }

      if (boxRect) {
        this.drawBox(ctx, boxRect, el.box, theme);
      }

      // 逐行逐字绘制
      lines.forEach((line, li) => {
        const lineY = textTop + li * lineHeight + baseSize * 0.85;
        let lineX = textLeft;
        if (align === 'center') lineX = x - line.width / 2;
        else if (align === 'right') lineX = x - line.width;

        let charX = lineX;
        for (const c of line.runs) {
          ctx.font = this.getFontString(c.size, c.bold, c.font);
          ctx.fillStyle = c.color;
          ctx.fillText(c.char, charX, lineY);
          charX += c.width;
        }
      });

      ctx.restore();

      const finalBox = boxRect
        ? [boxRect.x, boxRect.y, boxRect.x + boxRect.width, boxRect.y + boxRect.height]
        : [textLeft, textTop, textLeft + maxLineWidth, textTop + totalHeight];

      return {
        index,
        element: el,
        box: finalBox,
        center: [textLeft + maxLineWidth / 2, textTop + totalHeight / 2],
        width: finalBox[2] - finalBox[0],
        height: finalBox[3] - finalBox[1],
      };
    }

    if (type === 'rule') {
      ctx.save();
      const color = el.color || theme?.rule_color || '#EFECE6';
      const thickness = el.thickness || 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = thickness;
      ctx.beginPath();

      let box = [0, 0, 0, 0];
      if (el.vertical) {
        ctx.moveTo(el.x, el.y1);
        ctx.lineTo(el.x, el.y2);
        box = [el.x - 4, Math.min(el.y1, el.y2), el.x + 4, Math.max(el.y1, el.y2)];
      } else {
        ctx.moveTo(el.x1, el.y);
        ctx.lineTo(el.x2, el.y);
        box = [Math.min(el.x1, el.x2), el.y - 4, Math.max(el.x1, el.x2), el.y + 4];
      }
      ctx.stroke();
      ctx.restore();

      return {
        index,
        element: el,
        box,
        center: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2],
        width: box[2] - box[0],
        height: box[3] - box[1],
      };
    }

    if (type === 'card') {
      const { x = 0, y = 0, width = 400, height = 200 } = el;
      const radius = el.radius || 16;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      ctx.fillStyle = el.fill || theme?.card_fill || '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = el.border_color || theme?.card_border || '#E5E7EB';
      ctx.lineWidth = el.border_width || 2;
      ctx.stroke();

      if (el.label) {
        ctx.fillStyle = '#374151';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(el.label, x + 20, y + 36);
      }
      ctx.restore();

      return {
        index,
        element: el,
        box: [x, y, x + width, y + height],
        center: [x + width / 2, y + height / 2],
        width,
        height,
      };
    }

    // 默认回退
    return {
      index,
      element: el,
      box: [el.x || 0, el.y || 0, (el.x || 0) + 100, (el.y || 0) + 40],
      center: [el.x || 0, el.y || 0],
      width: 100,
      height: 40,
    };
  }

  /**
   * 完整渲染整块布局
   */
  async renderBlock(canvas, layout, projectUrlBase, selectedIndex = -1, options = {}) {
    const W = layout.width || 1080;
    const H = layout.height || 2500;
    const theme = layout.theme || {};
    const ctx = canvas.getContext('2d');

    // 适配 high-dpi
    const dpr = options.dpr || window.devicePixelRatio || 1;
    const scale = options.zoom || 1;

    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);

    ctx.save();
    ctx.scale(scale * dpr, scale * dpr);

    // 铺底色
    ctx.fillStyle = layout.bg || theme.bg || '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // 绘制辅助参考线网格 (若启用)
    if (options.showGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.04)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 100) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
        ctx.stroke();
      }
      for (let gy = 0; gy < H; gy += 100) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
        ctx.stroke();
      }
      // 中轴线
      ctx.strokeStyle = 'rgba(232, 132, 43, 0.35)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
      ctx.restore();
    }

    const hitBoxes = [];
    const elements = layout.elements || [];

    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i];
      const isSelected = i === selectedIndex;
      const res = await this.drawElement(ctx, el, i, projectUrlBase, theme, isSelected);
      hitBoxes.push(res);
    }

    // 绘制选中元素的包围盒与交互手柄
    if (selectedIndex >= 0 && selectedIndex < hitBoxes.length) {
      const target = hitBoxes[selectedIndex];
      this.drawTransformHandles(ctx, target);
    }

    ctx.restore();
    return hitBoxes;
  }

  /**
   * 绘制变换框与手柄
   */
  drawTransformHandles(ctx, target) {
    const [x0, y0, x1, y1] = target.box;
    const w = x1 - x0;
    const h = y1 - y0;

    ctx.save();
    // 选中蓝框
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x0, y0, w, h);

    // 绘制手柄
    const handleSize = 8;
    const handles = [
      [x0, y0, 'nw'],
      [x0 + w / 2, y0, 'n'],
      [x1, y0, 'ne'],
      [x1, y0 + h / 2, 'e'],
      [x1, y1, 'se'],
      [x0 + w / 2, y1, 's'],
      [x0, y1, 'sw'],
      [x0, y0 + h / 2, 'w'],
    ];

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 2;

    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    }

    // 标签：显示类型与坐标
    const el = target.element;
    const info = `${el.type} (${Math.round(el.x ?? x0)}, ${Math.round(el.y ?? y0)}) ${Math.round(w)}×${Math.round(h)}`;
    ctx.font = 'bold 12px sans-serif';
    const tagW = ctx.measureText(info).width + 12;
    ctx.fillStyle = '#2563EB';
    ctx.fillRect(x0, y0 - 22, tagW, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(info, x0 + 6, y0 - 7);

    ctx.restore();
  }

  /**
   * 命中检测（从上往下点选）
   */
  hitTest(hitBoxes, canvasX, canvasY) {
    // 优先反序遍历（最顶层元素优先命中）
    for (let i = hitBoxes.length - 1; i >= 0; i -= 1) {
      const item = hitBoxes[i];
      const [x0, y0, x1, y1] = item.box;
      const pad = 6;
      if (canvasX >= x0 - pad && canvasX <= x1 + pad && canvasY >= y0 - pad && canvasY <= y1 + pad) {
        return item.index;
      }
    }
    return -1;
  }
}
