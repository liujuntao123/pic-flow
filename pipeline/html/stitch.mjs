// HTML 排版线拼接：复用 canvas/stitch.mjs 的逻辑
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stitch } from '../canvas/stitch.mjs';

function isMain(metaUrl) {
  try {
    return fs.realpathSync(fileURLToPath(metaUrl)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export { stitch };

if (isMain(import.meta.url)) {
  const [out, ...ins] = process.argv.slice(2);
  if (!out || !ins.length) {
    console.error('用法：node pipeline/html/stitch.mjs OUT.jpg in1.png in2.png ...');
    process.exit(2);
  }
  await stitch(out, ins);
}
