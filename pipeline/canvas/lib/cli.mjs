// 统一的命令行解析：`--flag value` / `-o value` / 位置参数。
//
// 为什么需要它：各脚本原先各自 `args.indexOf('--scale')` + `args.filter(...)`
// 地解析，遇到「`--debug` 写在 `--scale` 前面」这类顺序差异就会**丢掉位置参数**
// （实测：`render.mjs --debug --scale 2 layout.json -o out.png` 会把 `--scale`
// 当成 layout 路径去 JSON.parse，直接崩）。

/**
 * @param {string[]} argv process.argv.slice(2)
 * @param {{valueFlags?: string[], boolFlags?: string[]}} [opts]
 * @returns {{files: string[], flags: Record<string, string|boolean>, errors: string[]}}
 */
export function parseCli(argv, { valueFlags = [], boolFlags = [] } = {}) {
  const valueSet = new Set(valueFlags);
  const boolSet = new Set(boolFlags);
  const files = [];
  const flags = {};
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (valueSet.has(a)) {
      const v = argv[i + 1];
      // 允许负数当取值（`--scale -1` 由调用方 clamp），但下一个 token 是已知开关时报错
      if (v === undefined || valueSet.has(v) || boolSet.has(v)) {
        errors.push(`${a} 缺少取值`);
        continue;
      }
      flags[a.replace(/^--?/, '')] = v;
      i += 1;
    } else if (boolSet.has(a)) {
      flags[a.replace(/^--?/, '')] = true;
    } else if (a.startsWith('-') && a !== '-') {
      errors.push(`未知参数 ${a}`);
    } else {
      files.push(a);
    }
  }
  return { files, flags, errors };
}

/** 数值参数：非法值一律回落到默认值（`scale=-1`、`scale=abc` 不该产出垃圾图）。 */
export function numFlag(flags, name, dflt, { min = -Infinity, max = Infinity } = {}) {
  if (flags[name] === undefined) return dflt;
  const n = Number(flags[name]);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/**
 * 机检脚本的通用参数解析（走统一 cli.mjs，顺序无关、未知参数会报错）。
 * 无位置参数时返回空 files —— 调用方必须报用法并以非 0 退出，
 * 否则 `node checks/lint.mjs`（漏了文件参数）会「静默通过」，把机检链变成摆设。
 */
export function parseArgs(argv, { allowMany = true } = {}) {
  const { files, flags, errors } = parseCli(argv, { boolFlags: ['--debug'] });
  return {
    debug: Boolean(flags.debug),
    files: allowMany ? files : files.slice(0, 1),
    errors,
    rest: files,
  };
}

/** 机检脚本的统一入口守卫：参数不合法就打用法并非 0 退出。 */
export function requireFiles(files, errors, usage) {
  if (errors.length || !files.length) {
    console.error(usage);
    if (errors.length) console.error(`  ${errors.join('；')}`);
    process.exit(2);
  }
}

