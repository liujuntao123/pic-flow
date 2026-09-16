// 便携预览：把若干块缩到指定宽度后横向并排，用于逐块视觉复核（默认 4 块一行）。
//   node pipeline/canvas/preview.mjs blocks/stage1.png blocks/stage2.png ... [-w 500] [-c 4] [-o out.jpg]
import path from 'node:path';
import fs from 'node:fs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImageFile } from './lib/draw.mjs';
import { parseCli, numFlag } from './lib/cli.mjs';

function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export async function preview(files, out, { width = 500, cols = 4, gap = 12, label = true } = {}) {
  const imgs = [];
  for (const f of files) imgs.push(await loadImageFile(f));
  const scaled = imgs.map((im) => ({ im, w: width, h: Math.round((im.height * width) / im.width) }));
  const rows = Math.ceil(scaled.length / cols);
  const rowH = [];
  for (let r = 0; r < rows; r += 1) {
    rowH.push(Math.max(...scaled.slice(r * cols, (r + 1) * cols).map((s) => s.h)));
  }
  const W = cols * width + (cols + 1) * gap;
  const H = rowH.reduce((a, b) => a + b, 0) + (rows + 1) * gap;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#CCCCCC';
  ctx.fillRect(0, 0, W, H);
  let y = gap;
  scaled.forEach((s, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = gap + c * (width + gap);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, width, rowH[r]);
    ctx.drawImage(s.im, x, y, s.w, s.h);
    if (label) {
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#111111';
      ctx.fillText(path.basename(files[i]), x + 6, y + 22);
    }
    if (c === cols - 1) y += rowH[r] + gap;
  });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, canvas.toBuffer('image/jpeg', 88));
  console.log(`[preview] ${out} ${W}x${H} from ${files.length} blocks`);
  return out;
}

if (isMain(import.meta.url)) {
  const { files, flags, errors } = parseCli(process.argv.slice(2), {
    valueFlags: ['-w', '-c', '-o'],
  });
  if (errors.length || !files.length) {
    console.error('用法：node pipeline/canvas/preview.mjs blocks/stage1.png ... [-w 500] [-c 4] [-o out.jpg]');
    if (errors.length) console.error(`  ${errors.join('；')}`);
    process.exit(2);
  }
  const out = flags.o ?? 'blocks/preview.jpg';
  const width = numFlag(flags, 'w', 500, { min: 50, max: 4000 });
  const cols = numFlag(flags, 'c', 4, { min: 1, max: 12 });
  await preview(files, out, { width, cols });
}
