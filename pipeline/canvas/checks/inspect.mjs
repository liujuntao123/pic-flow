// 统一布局机检深模块（Inspection Module）
// 一次性完成资源准备、共享几何与单次距离场计算，执行多规则检查，返回结构化诊断报告。
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, readJson, readTheme } from '../lib/paths.mjs';
import { setFonts, blockGeom } from '../lib/text.mjs';
import {
  elemBox, overlapArea, pngSize,
  bubbleQuad, polyInkCount, polyGap, inkMask, distanceField, fieldAt,
} from '../lib/geom.mjs';

const BLOCK_MIN_GAP = 40;

/**
 * 执行分块布局的全面机检或指定规则检查。
 *
 * @param {string|object} layoutOrPath 布局文件路径或已解析的 layout 对象
 * @param {object} [opts]
 * @param {string[]} [opts.rules=['lint','geom','occlusion','clearance']] 要运行的规则列表
 * @param {string} [opts.root] 项目根目录覆盖
 * @param {boolean} [opts.verbose=false] 是否在 logs 中包含详细格式化日志
 * @returns {Promise<InspectionReport>}
 */
export async function inspectLayout(layoutOrPath, opts = {}) {
  const isPath = typeof layoutOrPath === 'string';
  const filePath = isPath ? path.resolve(layoutOrPath) : null;
  const root = opts.root || findRoot(filePath || process.cwd());
  const data = isPath ? readJson(filePath) : layoutOrPath;
  const theme = readTheme(root, data);
  setFonts(root, theme.fonts);

  const W = data.width || 1080;
  const H = data.height || 2500;
  const els = data.elements || [];
  const rules = new Set(opts.rules || ['lint', 'geom', 'occlusion', 'clearance']);

  const logs = [];
  const log = (msg) => logs.push(msg);

  const diagnostics = [];
  const addDiag = (rule, level, message, details = {}) => {
    diagnostics.push({ rule, level, message, details });
    if (opts.verbose || rule === 'lint') {
      log(`${level} ${filePath ? path.basename(filePath) : ''}: ${message}`);
    }
  };

  const summary = {
    lint: { hard: 0, warn: 0 },
    geom: { problems: 0, textLines: 0, imgBandPct: 0, imgAreaPct: 0 },
    occlusion: { bad: 0 },
    clearance: { bad: 0 },
  };

  // 1. Lint: 边界越界与元素重叠检查
  if (rules.has('lint')) {
    const boxes = [];
    els.forEach((e, i) => {
      const b = elemBox(e, root, W, theme);
      if (!b) return;
      boxes.push([i, e, b]);
      if (b[0] < -40 || b[1] < -40 || b[2] > W + 40 || b[3] > H + 40) {
        summary.lint.warn += 1;
        addDiag('lint', 'WARN', `[${i}] ${e.type}: 越出画布边界 [${b.map((v) => Math.round(v)).join(',')}]`, {
          elementIndex: i, box: b,
        });
      }
    });

    for (let ai = 0; ai < boxes.length; ai += 1) {
      for (let bi = ai + 1; bi < boxes.length; bi += 1) {
        const [i, a, ba] = boxes[ai];
        const [j, b, bb] = boxes[bi];
        if (a.type === 'rule' || b.type === 'rule' || a.type === 'arrow' || b.type === 'arrow') continue;
        const area = overlapArea(ba, bb);
        if (area <= 0) continue;
        if (a.type === 'asset' && b.type === 'asset') continue;
        if (a.type === 'card' || b.type === 'card') continue;
        const ratio = area / Math.max(1, Math.min((ba[2] - ba[0]) * (ba[3] - ba[1]), (bb[2] - bb[0]) * (bb[3] - bb[1])));
        const assetText = new Set([a.type, b.type]).size === 2
          && [a.type, b.type].includes('asset') && [a.type, b.type].includes('text');
        const dx = Math.min(ba[2], bb[2]) - Math.max(ba[0], bb[0]);
        const dy = Math.min(ba[3], bb[3]) - Math.max(ba[1], bb[1]);
        const graze = dx < 8 || dy < 8;
        const level = assetText || ratio < 0.12 || graze ? 'WARN' : 'ERROR';
        const msg = `[${i},${j}]: ${a.type} 与 ${b.type} 重叠 ${(ratio * 100).toFixed(0)}%`;
        if (level === 'ERROR') {
          summary.lint.hard += 1;
          addDiag('lint', 'ERROR', msg, { elements: [i, j], ratio });
        } else {
          summary.lint.warn += 1;
          addDiag('lint', 'WARN', msg, { elements: [i, j], ratio });
        }
      }
    }

    const centered = els.filter((e) => e.type === 'text' && (e.align ?? 'center') === 'center').length;
    const texts = els.filter((e) => e.type === 'text').length;
    if (texts && centered / texts > 0.8) {
      summary.lint.warn += 1;
      addDiag('lint', 'WARN', `${centered}/${texts} 个文本居中，缺少对齐对比`, { centered, texts });
    }
    log(`[lint] ${filePath || 'layout'}: ${summary.lint.hard ? 'FAIL' : 'OK'}, hard=${summary.lint.hard}, warnings=${summary.lint.warn}`);
  }

  // 2. Geom: 真实字体度量、折行行数、孤字行与插图带高
  if (rules.has('geom')) {
    log(`\n=== ${filePath || 'layout'}  ${W}x${H} ===`);
    let imgBand = 0;
    let imgArea = 0;
    let textLines = 0;

    els.forEach((el, i) => {
      if (el.type === 'asset') {
        const p = path.join(root, 'assets', el.file || '');
        let iw = 1024;
        let ih = 1024;
        const sz = fs.existsSync(p) ? pngSize(p) : null;
        if (sz) {
          iw = sz.w;
          ih = sz.h;
        } else if (fs.existsSync(p)) {
          log(`  [asset ${i}] ${el.file} 非 PNG/JPEG，尺寸按 1024x1024 估`);
        } else {
          log(`  [asset ${i}] ${el.file} 缺失，按 1024x1024 估`);
        }
        const w = el.width ?? (iw * el.height) / ih;
        const h = el.height ?? (ih * w) / iw;
        imgBand += h;
        imgArea += w * h;
        log(`  [asset ${i}] ${el.file}  ${Math.round(w)}x${Math.round(h)}  bands=${Math.round((h / H) * 100)}%`);
      } else if (el.type === 'text') {
        const geo = blockGeom(el, W, theme);
        const explicit = (el.content || '').split('\n').length;
        textLines += geo.lines.length;
        const lh = geo.lh;
        const bottom = (el.y ?? 0) + lh * geo.lines.length;
        const pad = el.box?.pad ?? theme.bubble?.pad ?? 0;
        const py = Array.isArray(pad) ? pad[0] : pad;
        let flag = '';

        if (geo.lines.length !== explicit) {
          flag += `  << 自动折行 ${explicit}->${geo.lines.length}（改文案或加宽 max_width）`;
          summary.geom.problems += 1;
          addDiag('geom', 'WARN', `[text ${i}] 自动折行 ${explicit}->${geo.lines.length}`, {
            elementIndex: i, explicit, actual: geo.lines.length,
          });
        }

        const orphans = geo.lines
          .map((r) => r.map((c) => c[0]).join(''))
          .filter((s) => s.length > 0 && [...s].length <= 2);
        if (orphans.length) {
          flag += `  孤字行:${JSON.stringify(orphans)}`;
          summary.geom.problems += 1;
          addDiag('geom', 'WARN', `[text ${i}] 孤字行: ${JSON.stringify(orphans)}`, {
            elementIndex: i, orphans,
          });
        }

        const maxw = Math.max(0, ...geo.widths);
        log(`  [text ${i}] size=${el.size ?? 40} lines=${geo.lines.length} y ${el.y ?? 0}->${Math.round(bottom)} maxw=${Math.round(maxw)} panew=${Math.round(maxw + 2 * geo.px)}${flag}`);

        if (bottom + py > H) {
          log(`      !! 越界 bottom=${Math.round(bottom + py)} > ${H}`);
          summary.geom.problems += 1;
          addDiag('geom', 'ERROR', `[text ${i}] 文本越界 bottom=${Math.round(bottom + py)} > ${H}`, {
            elementIndex: i, bottom: bottom + py, height: H,
          });
        }
      }
    });

    const bandPct = Math.round((imgBand / H) * 100);
    const areaPct = Math.round((imgArea / (W * H)) * 100);
    summary.geom.imgBandPct = bandPct;
    summary.geom.imgAreaPct = areaPct;
    summary.geom.textLines = textLines;

    log(`  插图带高占比 = ${bandPct}%   插图墨迹面积占比 = ${areaPct}%   文字总行数 = ${textLines}`);
    if (bandPct < 55) {
      log(`  !! 插图带高仅 ${bandPct}%（建议 >= 55% 保证视觉丰富度）`);
      addDiag('geom', 'WARN', `插图带高仅 ${bandPct}%（建议 >= 55% 保证视觉丰富度）`, { bandPct });
    }
  }

  // 3 & 4. Occlusion & Clearance: 像素级墨迹蒙版与距离场计算（共享一次计算）
  const needsRaster = rules.has('occlusion') || rules.has('clearance');
  if (needsRaster) {
    const mask = await inkMask(root, data);
    const field = distanceField(mask);
    const anyAsset = els.some((el) => el.type === 'asset');

    if (rules.has('occlusion')) {
      log(`\n=== ${filePath || 'layout'} (occlusion) ===`);
      for (const [i, el] of els.entries()) {
        if (el.type !== 'text' || !el.box) continue;
        const { quad, tail } = bubbleQuad(el, W, theme);
        const label = (el.content || '').replace(/\n/g, ' ').slice(0, 14);
        let over = polyInkCount(mask, quad);
        let gap = polyGap(field, mask, quad);
        if (tail) {
          over += polyInkCount(mask, tail);
          gap = Math.min(gap, polyGap(field, mask, tail));
        }
        const flags = [];
        if (over > 120) {
          flags.push(`压盖 ${over}px !!`);
          summary.occlusion.bad += 1;
          addDiag('occlusion', 'ERROR', `[${i}] 「${label}」 压盖素材墨迹 ${over}px`, {
            elementIndex: i, over,
          });
        } else if (over > 0) {
          flags.push(`擦到墨迹 ${over}px`);
          addDiag('occlusion', 'WARN', `[${i}] 「${label}」 擦到素材墨迹 ${over}px`, {
            elementIndex: i, over,
          });
        }
        if (gap < BLOCK_MIN_GAP) {
          flags.push(`净空 ${Number.isFinite(gap) ? Math.round(gap) : '∞'}px (<${BLOCK_MIN_GAP})`);
          addDiag('occlusion', 'WARN', `[${i}] 「${label}」 净空不足 ${Number.isFinite(gap) ? Math.round(gap) : '∞'}px`, {
            elementIndex: i, gap,
          });
        }
        if (!anyAsset) {
          log(`  [${i}] 「${label}」 未与素材相交`);
          continue;
        }
        log(`  [${i}] 「${label}」 压盖=${over}px 净空=${Number.isFinite(gap) ? Math.round(gap) : '∞'}px  ${flags.join(' ')}`);
      }
      log(`\n[occlusion] 压盖硬伤 = ${summary.occlusion.bad}`);
    }

    if (rules.has('clearance')) {
      log(`\n=== ${filePath || 'layout'} (clearance) ===`);
      for (const [i, el] of els.entries()) {
        if (el.type !== 'text' || !el.box) continue;
        const { quad, tail } = bubbleQuad(el, W, theme);
        const cover = polyInkCount(mask, quad);
        let tailCover = 0;
        let tipGap = null;
        if (tail) {
          tailCover = polyInkCount(mask, tail);
          tipGap = fieldAt(field, tail[2][0], tail[2][1]);
        }
        const rectGap = polyGap(field, mask, quad);
        const label = (el.content || '').replace(/\n/g, ' ').slice(0, 16);
        const flags = [];
        if (cover || tailCover) flags.push(`压盖 rect=${cover}px tail=${tailCover}px`);
        if (tipGap !== null && tipGap < BLOCK_MIN_GAP) flags.push(`tail尖净空=${Math.round(tipGap)}px`);
        if (rectGap < BLOCK_MIN_GAP) flags.push(`净空=${Math.round(rectGap)}px`);

        if (flags.length) {
          log(`  [${i}] 「${label}」 ${flags.join('  ')}`);
          summary.clearance.bad += 1;
          addDiag('clearance', 'ERROR', `[${i}] 「${label}」 ${flags.join('  ')}`, {
            elementIndex: i, cover, tailCover, tipGap, rectGap,
          });
        } else {
          log(`  [${i}] 「${label}」 净空 OK (rect ${Math.round(rectGap)}px${tipGap !== null ? `, tail尖 ${Math.round(tipGap)}px` : ''})`);
        }
      }
      log(`\n[clearance] 净空不足/压盖的元素 = ${summary.clearance.bad} 个`);
    }
  }

  const hard = summary.lint.hard + summary.occlusion.bad + summary.clearance.bad;
  const warn = summary.lint.warn + summary.geom.problems;
  const ok = hard === 0;

  return {
    ok,
    hard,
    warn,
    summary,
    diagnostics,
    logs,
  };
}
