// 纵向拼接（stitch.py 的 Canvas 对应实现）：
//   node pipeline/canvas/stitch.mjs output/标题_长图.jpg blocks/final1.png blocks/final2.png ...
// 产物：成品长图 + 550px 宽预览图（同类名 _preview.jpg）。
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createCanvas, loadImageFile } from './lib/draw.mjs';

/** 入口守卫：项目里 scripts/canvas 是软链，import.meta.url 与 argv[1] 不同名，
 *  必须用 realpath 比较，否则 `node scripts/canvas/render.mjs ...` 会静默什么都不做。 */
function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}


export async function stitch(out, inputs) {
  const imgs = [];
  for (const p of inputs) {
    if (!fs.existsSync(p)) throw new Error(`输入文件不存在：${p}`);
    imgs.push(await loadImageFile(p));
  }
  const widths = new Set(imgs.map((i) => i.width));
  if (widths.size > 1) console.warn(`[stitch][warn] 各块宽度不一致：${[...widths].sort().join('/')}，窄块居中`);
  const w = Math.max(...imgs.map((i) => i.width));
  const h = imgs.reduce((s, i) => s + i.height, 0);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  let y = 0;
  for (const img of imgs) {
    ctx.drawImage(img, Math.round((w - img.width) / 2), y);
    y += img.height;
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const jpg = out.endsWith('.jpg') || out.endsWith('.jpeg');
  fs.writeFileSync(out, jpg ? canvas.toBuffer('image/jpeg', 92) : canvas.toBuffer('image/png'));
  // 550px 预览
  const pw = 550;
  const ph = Math.round((h * pw) / w);
  const pv = createCanvas(pw, ph);
  const pc = pv.getContext('2d');
  pc.imageSmoothingEnabled = true;
  pc.imageSmoothingQuality = 'high';
  pc.fillStyle = '#FFFFFF';
  pc.fillRect(0, 0, pw, ph);
  pc.drawImage(canvas, 0, 0, pw, ph);
  const prev = out.replace(/\.(jpe?g|png)$/i, '') + '_preview.jpg';
  fs.writeFileSync(prev, pv.toBuffer('image/jpeg', 85));
  console.log(`[stitch] ${out} ${w}x${h} from ${inputs.length} blocks`);
  console.log(`[stitch] 预览 ${prev} ${pw}x${ph}`);
  return { out, w, h, prev };
}

if (isMain(import.meta.url)) {
  const [out, ...ins] = process.argv.slice(2);
  if (!out || !ins.length) {
    console.error('用法：node pipeline/canvas/stitch.mjs OUT.jpg in1.png in2.png ...');
    process.exit(2);
  }
  await stitch(out, ins);
}
