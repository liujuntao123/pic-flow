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

// 避头标点（行尾悬挂）——必须与 pipeline/canvas/lib/text.mjs 的 KINSOKU 逐字一致，
// 否则同一份 layout 在预览与真正渲染里折行结果不同（预览会骗人）。
const KINSOKU = '，。！？；：、）】》%”…—』〗';

// 与渲染引擎同一套默认值（pipeline/canvas/lib/text.mjs；SCHEMA.md 也是这么写的）。
// 曾经这里写 32 / 9999 / 1.45，而引擎是 40 / 940 / 1.5：
// 新建的文本元素（不带 max_width）在预览里排成一行，一渲染就折行/换字号。
const DEFAULT_SIZE = 40;
const DEFAULT_MAX_WIDTH = 940;
const DEFAULT_LINE_HEIGHT = 1.5;

// 拥有真实粗体字面的字体族：'bold ' 前缀会选中 700 字面（真字形，锐利）。
// 引擎侧（text.mjs DEFAULT_FONTS）bold=换用独立粗体文件，没有粗体文件的字体
// 一律回退常规体；浏览器若对这些字体仍发 'bold ' 前缀，会触发**合成粗体**
// （把字形轮廓描边加粗）——低倍率缩放下发糊，且与最终 PNG 不一致。
// 这就是「画布上加粗的字看起来很模糊」的根源。
const HAS_REAL_BOLD = {
  body: true,      // LXGWWenKai-Medium 注册为 700 字面
  sans: true,      // Noto Sans CJK 自带 Bold
  serif: true,     // Noto Serif CJK 自带 Bold
};

export class CanvasRenderer {
  constructor() {
    this.imageCache = new Map();
    this.fontsLoaded = false;
    this.ensureFontsLoaded();
  }

  async ensureFontsLoaded() {
    if (!document.fonts) return;
    // canvas 不会自动触发 @font-face 下载，必须显式 load 每个族（含 bold 变体），
    // 否则首次渲染会用回退字体度量排版，字体到位后画面也不重绘。
    try {
      const probes = [];
      for (const stack of Object.values(FONT_MAP)) {
        probes.push(document.fonts.load(`40px ${stack}`, '常'));
        probes.push(document.fonts.load(`bold 40px ${stack}`, '常'));
      }
      await Promise.all(probes);
      await document.fonts.ready;
    } catch {}
    this.fontsLoaded = true;
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
   * 字体字符串构造。
   * bold 只对有真实 700 字面的字体族生效（选中真字形）；其余族省略前缀回退常规体，
   * 与引擎「无粗体文件回退常规」的口径一致，同时避免合成粗体的发糊描边。
   */
  getFontString(size, bold, fontType = 'body') {
    const family = FONT_MAP[fontType] || FONT_MAP.body;
    const realBold = Boolean(bold) && Boolean(HAS_REAL_BOLD[fontType]);
    return `${realBold ? 'bold ' : ''}${Math.round(size)}px ${family}`;
  }

  /** 字体族 CSS 栈（画布内联编辑器的覆盖层 textarea 与画布字形保持一致） */
  getFontFamily(fontType = 'body') {
    return FONT_MAP[fontType] || FONT_MAP.body;
  }

  /** 该字体族是否有真实粗体字面（决定 bold 是否生效，与引擎口径一致） */
  isRealBoldFont(fontType = 'body') {
    return Boolean(HAS_REAL_BOLD[fontType]);
  }

  /**
   * 排版多行文本（带避头点与换行）
   */
  layoutTextLines(ctx, el, theme) {
    const content = el.content || '';
    const rawLines = content.split('\n');
    const maxWidth = el.max_width ?? DEFAULT_MAX_WIDTH;
    const baseSize = el.size ?? DEFAULT_SIZE;
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

      // 贪心折行：与 pipeline/canvas/lib/text.mjs 的 wrapLines 逐分支对齐
      //  · 行尾避头标点**悬挂**（允许溢出 max_width 一个字宽），不是把上一字拉下来
      //  · ASCII 单词整体下移，绝不拦腰拆词
      const isAsciiWord = (ch) => ch.codePointAt(0) < 128 && /[A-Za-z0-9]/.test(ch);
      let curLine = [];
      let curLineWidth = 0;
      const widthOf = (arr) => arr.reduce((s, c) => s + c.width, 0);

      for (let ci = 0; ci < chars.length; ci += 1) {
        const item = chars[ci];
        if (curLine.length > 0 && curLineWidth + item.width > maxWidth && !KINSOKU.includes(item.char)) {
          if (isAsciiWord(item.char)) {
            let j = curLine.length;
            while (j > 0 && isAsciiWord(curLine[j - 1].char)) j -= 1;
            if (j < curLine.length) {
              const moved = curLine.slice(j);
              laidOutLines.push({ width: curLineWidth - widthOf(moved), runs: curLine.slice(0, j) });
              curLine = moved.concat([item]);
              curLineWidth = widthOf(curLine);
              continue;
            }
          }
          laidOutLines.push({ width: curLineWidth, runs: curLine });
          curLine = [item];
          curLineWidth = item.width;
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
        // 素材的 rotate 是绕锚点 (x, y) 旋转（与上方 ctx.translate(x,y)→rotate 的口径一致）
        rot: el.rotate ? { cx: x, cy: y, deg: el.rotate } : null,
        center: [x, y],
        width: w,
        height: h,
      };
    }

    if (type === 'text') {
      const x = el.x || 0;
      const y = el.y || 0;
      const align = el.align || 'center';
      const baseSize = el.size ?? DEFAULT_SIZE;
      const lineHeight = baseSize * (el.line_height ?? DEFAULT_LINE_HEIGHT);
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
        // pad 口径 [纵向, 横向]，元素未给时沿用主题 bubble.pad（与引擎 boxOf 一致）
        const pad = el.box.pad ?? theme?.bubble?.pad ?? 0;
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

      // 命中数据：无气泡的文本按「实际每一行的行框」命中，而不是整个包围盒。
      // 多行段落行长参差（尤其居中对齐）：按包围盒命中时，短行两侧的大量空白
      // 会拦截视觉上不重叠的下方元素，表现为「元素点了选不中」。
      let hitLines = null;
      if (!boxRect) {
        hitLines = [];
        lines.forEach((line, li) => {
          if (line.width <= 0) return;
          let lx = textLeft;
          if (align === 'center') lx = x - line.width / 2;
          else if (align === 'right') lx = x - line.width;
          hitLines.push({ x: lx, y: textTop + li * lineHeight, w: line.width, h: lineHeight });
        });
      }

      // 行宽框架：宽度 = max_width（折行宽度），高度 = 内容自适应高度。
      // 选中框与缩放手柄画在框架上 —— 拖手柄即改行宽且精确跟手；
      // 命中热区仍按实际行框（hitLines），两者职责分离。
      const wrapWidth = el.max_width ?? DEFAULT_MAX_WIDTH;
      let frameLeft = x;
      if (align === 'center') frameLeft = x - wrapWidth / 2;
      else if (align === 'right') frameLeft = x - wrapWidth;
      const frame = [frameLeft, textTop, frameLeft + wrapWidth, textTop + totalHeight];

      return {
        index,
        element: el,
        box: finalBox,
        frame,
        hitLines,
        // 旋转信息：命中检测需把屏幕点逆旋转回元素坐标再比对包围盒
        rot: el.rotate ? { cx: textLeft + maxLineWidth / 2, cy: textTop + totalHeight / 2, deg: el.rotate } : null,
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
    // CSS 显示尺寸必须显式锁为 W×H 的缩放尺寸：只改 width/height 属性时，
    // HiDPI 屏（dpr>1）会把画布按属性像素再放大 dpr 倍显示，鼠标坐标换算
    // 全部偏移 dpr 倍 —— 表现为「画布热区错位，元素点了选不中」。
    canvas.style.width = `${Math.round(W * scale)}px`;
    canvas.style.height = `${Math.round(H * scale)}px`;

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
    // 选中参数兼容单个索引与索引数组（多选）；最后一个为主选中（唯一显示变换手柄）
    const selArr = Array.isArray(selectedIndex)
      ? selectedIndex.filter((i) => Number.isInteger(i) && i >= 0 && i < elements.length)
      : (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < elements.length
        ? [selectedIndex] : []);
    const primary = selArr.length > 0 ? selArr[selArr.length - 1] : -1;
    const hiddenIndex = options.hiddenIndex ?? -1;

    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i];
      if (i === hiddenIndex) {
        // 画布内编辑中：元素本体不可见（透明绘制保持几何与命中数据），
        // 文字由覆盖层 textarea 实时呈现
        ctx.save();
        ctx.globalAlpha = 0;
        hitBoxes.push(await this.drawElement(ctx, el, i, projectUrlBase, theme, false));
        ctx.restore();
        continue;
      }
      const isSelected = i === primary;
      const res = await this.drawElement(ctx, el, i, projectUrlBase, theme, isSelected);
      hitBoxes.push(res);
    }

    // 多选时非主选元素画轻量轮廓，主选中画变换框与手柄；
    // 画布内编辑中的主选只留轻量轮廓（文字本体由编辑框呈现，手柄反而是干扰）
    for (const i of selArr) {
      if (i === primary) continue;
      if (hitBoxes[i]) this.drawSelectionOutline(ctx, hitBoxes[i], scale);
    }
    if (primary >= 0 && hitBoxes[primary]) {
      if (primary === hiddenIndex) this.drawSelectionOutline(ctx, hitBoxes[primary], scale);
      else this.drawTransformHandles(ctx, hitBoxes[primary]);
    }

    // 拖拽对齐参考线（元素边缘/中线 + 画布边/居中线），随移动实时显示
    const guides = options.guides;
    if (guides && ((guides.v && guides.v.length) || (guides.h && guides.h.length))) {
      ctx.save();
      ctx.strokeStyle = '#F43F5E';
      ctx.lineWidth = Math.max(1, 1 / scale);
      ctx.setLineDash([5 / scale, 5 / scale]);
      ctx.beginPath();
      for (const gx of guides.v || []) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
      }
      for (const gy of guides.h || []) {
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
    return hitBoxes;
  }

  /**
   * 多选中非主选元素的轻量选中轮廓（区分于主选的蓝框+手柄）
   */
  drawSelectionOutline(ctx, target, scale = 1) {
    const [x0, y0, x1, y1] = target.frame || target.box;
    ctx.save();
    if (target.rot && target.rot.deg) {
      ctx.translate(target.rot.cx, target.rot.cy);
      ctx.rotate((target.rot.deg * Math.PI) / 180);
      ctx.translate(-target.rot.cx, -target.rot.cy);
    }
    ctx.strokeStyle = '#60A5FA';
    ctx.lineWidth = Math.max(1, 1.5 / scale);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }

  /**
   * 各元素类型可用的缩放手柄（绘制与命中共用同一份口径）：
   *  · text: 行宽框架上的手柄 —— 拖拽改折行宽度 max_width，高度随内容自适应。
   *    居中对齐两侧对称生长用左右两个；左对齐只有右缘是行宽边界；右对齐反之。
   *  · rule: 沿线方向两个 —— 拉长/缩短线段端点
   *  · asset / card: 全部 8 个 —— 角手柄等比缩放，边手柄单轴伸缩
   */
  handlesFor(el) {
    if (el.type === 'text') {
      const align = el.align || 'center';
      if (align === 'center') return ['e', 'w'];
      return [align === 'left' ? 'e' : 'w'];
    }
    if (el.type === 'rule') return el.vertical ? ['n', 's'] : ['e', 'w'];
    return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  }

  /** 8 向手柄在包围盒（文本优先用行宽框架）上的位置 */
  handlePositions(target) {
    const [x0, y0, x1, y1] = target.frame || target.box;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    return {
      nw: [x0, y0], n: [mx, y0], ne: [x1, y0], e: [x1, my],
      se: [x1, y1], s: [mx, y1], sw: [x0, y1], w: [x0, my],
    };
  }

  /**
   * 命中一个变换手柄（须先排除拖拽移动），返回手柄 id 或 null。
   * 旋转元素的包围盒/手柄是跟着元素转的：先把命中点逆旋转回元素坐标系再比对。
   */
  findHandle(target, canvasX, canvasY, zoom = 1) {
    if (!target) return null;
    const [px, py] = this.toElementPoint(target, canvasX, canvasY);
    const radius = Math.min(24, 10 / Math.max(0.01, zoom));
    const positions = this.handlePositions(target);
    let best = null;
    let bestD = Infinity;
    for (const id of this.handlesFor(target.element)) {
      const [hx, hy] = positions[id];
      const d = Math.hypot(px - hx, py - hy);
      if (d <= radius && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * 绘制变换框与手柄（按元素类型过滤；旋转元素的手柄跟随旋转）
   */
  drawTransformHandles(ctx, target) {
    const el = target.element;
    // 文本用行宽框架做选中框（拖手柄改行宽），其余元素用实际包围盒
    const [x0, y0, x1, y1] = target.frame || target.box;
    const w = x1 - x0;
    const h = y1 - y0;

    ctx.save();
    if (target.rot && target.rot.deg) {
      ctx.translate(target.rot.cx, target.rot.cy);
      ctx.rotate((target.rot.deg * Math.PI) / 180);
      ctx.translate(-target.rot.cx, -target.rot.cy);
    }

    // 选中蓝框
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x0, y0, w, h);

    // 绘制该类型可用的手柄
    const handleSize = 8;
    const positions = this.handlePositions(target);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 2;
    for (const id of this.handlesFor(el)) {
      const [hx, hy] = positions[id];
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    }
    ctx.restore();

    // 标签：显示类型与坐标（不随元素旋转，保持可读）
    const info = `${el.type} (${Math.round(el.x ?? x0)}, ${Math.round(el.y ?? y0)}) ${Math.round(w)}×${Math.round(h)}`;
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    const tagW = ctx.measureText(info).width + 12;
    ctx.fillStyle = '#2563EB';
    ctx.fillRect(x0, y0 - 22, tagW, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(info, x0 + 6, y0 - 7);
    ctx.restore();
  }

  /**
   * 把屏幕命中点逆旋转回元素自身坐标系（元素 rotate 时包围盒是未旋转矩形）
   */
  toElementPoint(item, px, py) {
    if (!item.rot || !item.rot.deg) return [px, py];
    const rad = (-item.rot.deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = px - item.rot.cx;
    const dy = py - item.rot.cy;
    return [item.rot.cx + dx * cos - dy * sin, item.rot.cy + dx * sin + dy * cos];
  }

  /**
   * 单点命中一个 hitBox：无气泡文本按行框，其余按包围盒
   */
  hitOne(item, canvasX, canvasY, pad) {
    const [px, py] = this.toElementPoint(item, canvasX, canvasY);
    if (item.hitLines && item.hitLines.length > 0) {
      return item.hitLines.some(
        (r) => px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad,
      );
    }
    const [x0, y0, x1, y1] = item.box;
    return px >= x0 - pad && px <= x1 + pad && py >= y0 - pad && py <= y1 + pad;
  }

  /**
   * 命中检测（从上往下点选）。
   * @param {number} [zoom=1] 当前视图缩放：命中容差按屏幕像素恒定（低倍率下窄元素才点得中）
   */
  hitTest(hitBoxes, canvasX, canvasY, zoom = 1) {
    const hits = this.hitTestAll(hitBoxes, canvasX, canvasY, zoom);
    return hits.length > 0 ? hits[0] : -1;
  }

  /**
   * 命中检测全量版：返回该点从顶到底命中的所有元素（供 Alt+点击轮换穿透选择）
   */
  hitTestAll(hitBoxes, canvasX, canvasY, zoom = 1) {
    // 容差 ≈ 屏幕上 6px，换算回画布坐标；钳制避免高倍率下容差膨胀
    const pad = Math.min(12, 6 / Math.max(0.01, zoom));
    const hits = [];
    for (let i = hitBoxes.length - 1; i >= 0; i -= 1) {
      const item = hitBoxes[i];
      if (this.hitOne(item, canvasX, canvasY, pad)) hits.push(item.index);
    }
    return hits;
  }
}
