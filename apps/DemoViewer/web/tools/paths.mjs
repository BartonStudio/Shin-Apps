// ============================================================================
// paths.mjs —— 全工程的路径解析（唯一入口）
// ============================================================================
//
// 为什么有这个文件：这些脚本最初把 `test.dem`、`tmp/...` 之类的路径写死了。
// 别人换个 demo 就得改代码，很不合理。
//
// 现在统一成三级优先级：
//
//     ① 命令行参数    --demo <路径>  --tmp <目录>  --image <路径>  --golden <路径>
//     ② 环境变量      CSDEMO_DEM     CSDEMO_TMP    CSDEMO_IMAGE   CSDEMO_GOLDEN
//     ③ 仓库默认值    <repo>/test.dem  <repo>/tmp/  ...
//
// 而且第 ③ 级找不到文件时**不会只丢一个 ENOENT** —— 会打出一段明确的
// 「怎么指定」提示，并把退出码设成 2（ctest 会把它标成 SKIPPED 而不是 FAILED）。
//
// 用法：
//   import { demoPath, tmpFile, goldenPath, needFile, opt, hasFlag } from './paths.mjs';
//   const demo = needFile(demoPath(), 'demo 文件', '--demo');
//
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

/** 仓库根目录（本文件在 tools/ 下） */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const ARGV = process.argv.slice(2);

// ── 命令行参数 ──────────────────────────────────────────────────────────────

/** 取 `--name value` 的值；没有则返回 undefined */
export function opt(name) {
  const i = ARGV.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = ARGV[i + 1];
  return v === undefined || v.startsWith('--') ? undefined : v;
}

/** `--name` 是否存在（布尔开关） */
export function hasFlag(name) {
  return ARGV.includes(`--${name}`);
}

/** `--name value` 必填；缺失时报错退出 */
export function requireOpt(name, hint) {
  const v = opt(name);
  if (v === undefined) {
    console.error(`✗ 缺少必需参数 --${name}${hint ? '\n  ' + hint : ''}`);
    process.exit(2);
  }
  return v;
}

// ── 三级解析 ────────────────────────────────────────────────────────────────

/**
 * demo 文件路径 —— **没有默认值**，必须显式指定。
 *   ① --demo <path>   ② $CSDEMO_DEM
 * @returns {string|null} 绝对路径；未指定时返回 null（用 needDemo() 拿到报错行为）
 */
export function demoPath() {
  const cli = opt('demo');
  if (cli) return path.resolve(cli);
  const env = process.env.CSDEMO_DEM;
  if (env) return path.resolve(env);
  return null;
}

/**
 * demo 文件路径（必须显式指定，否则打印指引并以退出码 2 结束）。
 * 为什么不给默认值：曾经默认 <repo>/test.dem，结果换个环境它就成了
 * 一个「指向不存在文件的死路径」—— 与其默认错，不如要求明确。
 */
export function needDemo() {
  const p = demoPath();
  if (p === null) {
    console.error(`
✗ 没有指定 demo 文件（没有默认值，必须显式给出）

请用以下任一方式指定：
    1) 命令行参数   --demo <路径>
    2) 环境变量     CSDEMO_DEM=<路径>

示例：
    node ${path.relative(REPO_ROOT, process.argv[1] ?? 'script').replace(/\\/g, '/')} --demo D:/demos/match.dem
`);
    process.exit(2);
  }
  return p;
}

/**
 * 中间产物目录（自动创建）
 *   ① --tmp <dir>   ② $CSDEMO_TMP   ③ <repo>/tmp
 */
export function tmpDir() {
  const cli = opt('tmp');
  const dir = cli ? path.resolve(cli) : process.env.CSDEMO_TMP ? path.resolve(process.env.CSDEMO_TMP) : path.join(REPO_ROOT, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 中间产物文件：tmpDir()/<name> */
export function tmpFile(name) {
  return path.join(tmpDir(), name);
}

/**
 * 文档/金标准路径
 *   ① --golden <path>  ② $CSDEMO_GOLDEN  ③ <repo>/docs/<name>
 */
export function goldenPath(name = 'shared-layout.golden.tsv') {
  const cli = opt('golden');
  if (cli) return path.resolve(cli);
  const env = process.env.CSDEMO_GOLDEN;
  if (env) return path.resolve(env);
  return path.join(REPO_ROOT, 'docs', name);
}

/**
 * 共享内存镜像路径
 *   ① --image <path>   ② $CSDEMO_IMAGE   ③ <repo>/tmp/<fallbackName>
 */
export function imagePath(fallbackName) {
  const cli = opt('image');
  if (cli) return path.resolve(cli);
  const env = process.env.CSDEMO_IMAGE;
  if (env) return path.resolve(env);
  return tmpFile(fallbackName);
}

/** 旁挂水位/指纹文件路径：默认与镜像同目录的 shared-from-js.json */
export function sidecarPath(fallbackName = 'shared-from-js.json') {
  const cli = opt('sidecar');
  if (cli) return path.resolve(cli);
  const env = process.env.CSDEMO_SIDECAR;
  if (env) return path.resolve(env);
  return tmpFile(fallbackName);
}

// ── 检查与报错 ──────────────────────────────────────────────────────────────

/**
 * 确认文件存在；不存在就打印「怎么指定」并 exit 2（ctest 会标 SKIP）。
 *
 * @param {string} file    绝对路径
 * @param {string} label   人类可读的名字，如「demo 文件」
 * @param {string} optName 对应的命令行参数名，如 '--demo'
 * @param {string} envName 对应的环境变量名，如 'CSDEMO_DEM'
 * @param {string} [howto] 额外提示（比如「用 xxx 生成」）
 * @returns {string} 原样返回 file，便于链式使用
 */
export function needFile(file, label, optName, envName, howto) {
  if (fs.existsSync(file)) return file;

  const lines = [
    ``,
    `✗ 找不到${label}：`,
    `    ${file}`,
    ``,
    `请用以下任一方式指定：`,
    `    1) 命令行参数   ${optName} <路径>`,
    `    2) 环境变量     ${envName}=<路径>`,
  ];
  if (howto) lines.push(``, `   ${howto}`);
  lines.push(``, `示例：`, `    node ${path.relative(REPO_ROOT, process.argv[1] ?? 'script').replace(/\\/g, '/')} ${optName} <路径>`, ``);
  console.error(lines.join('\n'));
  process.exit(2);
}

/** 目录版本 */
export function needDir(dir, label, optName, envName, howto) {
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  console.error(`\n✗ 找不到${label}目录：\n    ${dir}\n\n用 ${optName} <目录> 或 ${envName}=<目录> 指定${howto ? '\n' + howto : ''}\n`);
  process.exit(2);
}

// ── 统一的 --help ───────────────────────────────────────────────────────────

/**
 * 打印用法并退出。
 * @param {string[]} examples 示例命令行（不含 `node tools/xxx.mjs` 前缀）
 * @param {[string,string][]} options [参数, 说明] 列表
 */
export function printUsage(scriptName, title, options, examples) {
  const out = [`\n${title}`, ``, `用法：node ${scriptName} [选项]`, ``];
  if (options.length) {
    out.push('选项：');
    const w = Math.max(...options.map(([k]) => k.length));
    for (const [k, d] of options) out.push(`  ${k.padEnd(w)}  ${d}`);
    out.push('');
  }
  out.push('通用环境变量（命令行参数优先于它）：');
  out.push('  CSDEMO_DEM       demo 文件路径（等同 --demo）');
  out.push('  CSDEMO_TMP       中间产物目录（等同 --tmp）');
  out.push('  CSDEMO_IMAGE     共享内存镜像路径（等同 --image）');
  out.push('  CSDEMO_GOLDEN    布局金标准路径（等同 --golden）');
  if (examples.length) {
    out.push('', '示例：');
    for (const e of examples) out.push(`  ${e}`);
  }
  out.push('');
  console.log(out.join('\n'));
}

/** 几个脚本共用的选项定义，避免措辞不一致 */
export const COMMON_OPTIONS = {
  demo: ['--demo <path>', 'demo 文件（必填，或设 $CSDEMO_DEM；没有默认值）'],
  tmp: ['--tmp <dir>', '中间产物目录（默认 $CSDEMO_TMP 或 <repo>/tmp）'],
  image: ['--image <path>', '共享内存镜像（默认 $CSDEMO_IMAGE 或 <repo>/tmp/...）'],
  sidecar: ['--sidecar <path>', '旁挂水位/指纹 json'],
  golden: ['--golden <path>', '布局金标准（默认 $CSDEMO_GOLDEN 或 <repo>/docs/...）'],
  help: ['--help, -h', '打印本帮助'],
};

/** 是否请求了帮助 */
export function wantsHelp() {
  return hasFlag('help') || hasFlag('h');
}
