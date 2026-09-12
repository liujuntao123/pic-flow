// HTML 排版线渲染器：背景图（插图/气泡/线条）+ 绝对定位文本块。
//
//   node pipeline/html/render.mjs layout/block1.json -o blocks/html1.png [--html out.html] [--scale 2]
//
// 背景层由 Canvas 引擎绘制（只画非 text 元素），文字层交给浏览器排版：
// 每个文本元素 = 一个绝对定位的 <div>，左/上/宽/行高与 layout 计算值一致，
// 浏览器按该宽度折行，语义标记变成 <span class="hl|quote|warn">。
//
// 与另两条引擎输出同一批产物（blocks/*.png → output/*.jpg），可逐块互换、可逐像素对照。
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { render as renderCanvas } from '../canvas/render.mjs';
import { findRoot, readJson, readTheme } from '../canvas/lib/paths.mjs';
import { setFonts } from '../canvas/lib/text.mjs';
import { fontFaceCss, textLayer, measureDom, withPage } from './lib/dom.mjs';

function isMain(metaUrl) {
  try {
    return fs.realpathSync(fileURLToPath(metaUrl)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

/** 背景 PNG：只画非 text 元素（插图 / 气泡 / 卡片 / 线条 / 图表）。 */
async function paintBackground(layout, bgPath, root, scale) {
  // backgroundOnly: 绘制所有非文字元素 + 气泡底板/装饰框（不绘制文字字形）
  await renderCanvas(layout, bgPath, false, root, scale, { backgroundOnly: true });
  return bgPath;
}

export function buildHtml(layout, theme, root, { bgRel, bgAbs, width, height, scale = 1, dy = 0, dx = 0 }) {
  const layer = textLayer(layout, theme, { dx, dy });
  const bgUrl = bgRel || pathToFileURL(bgAbs).href;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>pic-flow · html</title>
<style>
${fontFaceCss(theme, root)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;background:#FFFFFF;overflow:hidden}
#stage{position:relative;width:${width}px;height:${height}px;background:#FFFFFF}
#bg{position:absolute;left:0;top:0;width:${width}px;height:${height}px;
   background-image:url('${bgUrl}');background-size:${width}px ${height}px;background-repeat:no-repeat}
.para{position:absolute}
${layer.css}
</style></head>
<body><div id="stage"><div id="bg"></div>
${layer.html}
</div></body></html>
`;
}

/**
 * 渲染一块：
 *  1) Canvas 引擎出背景层 PNG
 *  2) 生成 HTML（绝对定位文本块）
 *  3) 浏览器打开 → DOM 实测每行矩形 → 整页截图
 * 返回实测几何，供机检与对照使用。
 */
export async function renderHtml(layoutPath, outPng, opts = {}) {
  const { htmlOut, scale = 1, keepBg = true, chromePath, style = 'hybrid' } = opts;
  const root = opts.root || findRoot(layoutPath);
  const layout = readJson(layoutPath);
  const theme = readTheme(root, layout);
  setFonts(root, theme.fonts);
  const W = layout.width;
  const H = layout.height;
  const base = outPng.replace(/\.(png|jpe?g)$/i, '');
  const bgAbs = `${base}.bg.png`;
  const htmlPath = htmlOut || `${base}.html`;

  if (style !== 'hybrid') throw new Error(`未知 style：${style}（当前支持 hybrid）`);
  await paintBackground(layout, bgAbs, root, scale);

  const html = buildHtml(layout, theme, root, {
    bgAbs, width: W, height: H, scale, dy: opts.dy ?? 0, dx: opts.dx ?? 0,
  });
  fs.mkdirSync(path.dirname(path.resolve(htmlPath)), { recursive: true });
  fs.writeFileSync(htmlPath, html, 'utf8');

  const result = await withPage(htmlPath, { width: W, height: H, scale, chromePath }, async (page) => {
    const measured = await measureDom(page);
    await page.screenshot({ path: outPng, clip: { x: 0, y: 0, width: W, height: H } });
    return measured;
  });

  if (!keepBg) fs.rmSync(bgAbs, { force: true });
  console.log(`[compose-html] ${outPng} ${W * scale}x${H * scale}${scale !== 1 ? ` @${scale}x` : ''} · html=${path.relative(process.cwd(), htmlPath)} · 段落=${result.paras.length}`);
  return { out: outPng, htmlPath, bgPath: keepBg ? bgAbs : null, measured: result.paras, layout, theme, root };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const files = args.filter((a, i) => !a.startsWith('-') && !['-o', '--html', '--scale'].includes(args[i - 1]));
  const out = opt('-o', 'blocks/out.png');
  const scale = Number(opt('--scale', 1)) || 1;
  for (const f of files) {
    const target = files.length > 1
      ? path.join(path.dirname(out), `${path.basename(f, '.json')}${path.extname(out) || '.png'}`)
      : out;
    await renderHtml(f, target, { htmlOut: opt('--html', undefined), scale });
  }
}

if (isMain(import.meta.url)) await main();
