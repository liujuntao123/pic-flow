// 项目根推断：与 Python roots.py 同一套规则（含项目标志的那一层）。
import fs from 'node:fs';
import path from 'node:path';

const MARKERS = ['assets.json', 'storyboard.json', 'style.json', 'layout'];

export function findRoot(hint) {
  if (process.env.PICFLOW_ROOT) return path.resolve(process.env.PICFLOW_ROOT);
  let start = null;
  if (hint) {
    const h = path.resolve(hint);
    try {
      start = fs.statSync(h).isDirectory() ? h : path.dirname(h);
    } catch {
      start = path.dirname(h);
    }
  }
  if (!start) start = process.cwd();
  let cur = start;
  while (true) {
    if (MARKERS.some((m) => fs.existsSync(path.join(cur, m)))) return cur;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function readTheme(root, layout) {
  if (layout.theme) return layout.theme;
  const p = path.join(root, 'style.json');
  if (fs.existsSync(p)) {
    try {
      return readJson(p);
    } catch {
      return {};
    }
  }
  return {};
}
