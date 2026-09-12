// Canvas vs Python 双引擎对照（Canvas 方案可行性验收工具）。
//   node pipeline/canvas/parity.mjs examples/jin-six-nobles/layout/block2.json [...]
// 对同一份 layout：Python 引擎（pipeline/compose.py）与 Canvas 引擎（render.mjs）各渲一次，
// 报告墨迹像素比、重合度 IoU 与平均像素差，并落一张左右对照图 + 差异热力图到 blocks/parity/。
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createCanvas, loadImageFile } from './lib/draw.mjs';
import { render } from './render.mjs';
import { findRoot } from './lib/paths.mjs';

/** 入口守卫：项目里 scripts/canvas 是软链，import.meta.url 与 argv[1] 不同名，
 *  必须用 realpath 比较，否则 `node scripts/canvas/render.mjs ...` 会静默什么都不做。 */
function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}


const SKILL = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

function inkStats(img) {
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const n = img.width * img.height;
  const ink = new Uint8Array(n);
  let sum = 0;
  let inkCount = 0;
  for (let i = 0; i < n; i += 1) {
    const v = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
    sum += v;
    if (v < 240) {
      ink[i] = 1;
      inkCount += 1;
    }
  }
  return { ink, inkCount, mean: sum / n, w: img.width, h: img.height };
}

export async function parity(layoutPath, { keep = true } = {}) {
  const root = findRoot(layoutPath);
  const name = path.basename(layoutPath, '.json');
  const dir = path.join(root, 'blocks', 'parity');
  fs.mkdirSync(dir, { recursive: true });
  const pyOut = path.join(dir, `${name}_py.png`);
  const cvOut = path.join(dir, `${name}_canvas.png`);
  execFileSync('python3', [path.join(SKILL, 'pipeline', 'compose.py'), layoutPath, '-o', pyOut], { stdio: 'inherit' });
  await render(JSON.parse(fs.readFileSync(layoutPath, 'utf8')), cvOut, false, root);
  const a = inkStats(await loadImageFile(pyOut));
  const b = inkStats(await loadImageFile(cvOut));
  let inter = 0;
  let union = 0;
  let diffSum = 0;
  const heat = createCanvas(a.w, a.h);
  const hc = heat.getContext('2d');
  const hd = hc.createImageData(a.w, a.h);
  for (let i = 0; i < a.ink.length; i += 1) {
    if (a.ink[i] && b.ink[i]) inter += 1;
    if (a.ink[i] || b.ink[i]) union += 1;
    const d = Math.abs(a.ink[i] - b.ink[i]) ? 255 : 0;
    diffSum += d;
    hd.data[i * 4] = d;
    hd.data[i * 4 + 1] = 0;
    hd.data[i * 4 + 2] = 0;
    hd.data[i * 4 + 3] = d ? 200 : 0;
  }
  hc.putImageData(hd, 0, 0);
  fs.writeFileSync(path.join(dir, `${name}_diff.png`), heat.toBuffer('image/png'));
  const sbs = createCanvas(a.w * 2 + 20, a.h);
  const sc = sbs.getContext('2d');
  sc.fillStyle = '#888888';
  sc.fillRect(0, 0, sbs.width, sbs.height);
  sc.drawImage(await loadImageFile(pyOut), 0, 0);
  sc.drawImage(await loadImageFile(cvOut), a.w + 20, 0);
  fs.writeFileSync(path.join(dir, `${name}_sbs.png`), sbs.toBuffer('image/png'));
  const iou = inter / Math.max(1, union);
  const res = {
    layout: layoutPath,
    size: `${a.w}x${a.h}`,
    pyInk: a.inkCount,
    cvInk: b.inkCount,
    inkRatio: +(b.inkCount / Math.max(1, a.inkCount)).toFixed(3),
    inkIoU: +iou.toFixed(3),
    XorPixelPct: +((1 - iou) * 100).toFixed(2),
    meanLumaPy: +a.mean.toFixed(1),
    meanLumaCv: +b.mean.toFixed(1),
  };
  console.log(`[parity] ${name}: ${JSON.stringify(res)}`);
  if (!keep) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return res;
}

if (isMain(import.meta.url)) {
  const files = process.argv.slice(2);
  const results = [];
  for (const f of files) results.push(await parity(f));
  const avg = results.reduce((s, r) => s + r.inkIoU, 0) / Math.max(1, results.length);
  console.log(`\n[parity] ${results.length} 块，平均墨迹 IoU = ${avg.toFixed(3)}`);
}
