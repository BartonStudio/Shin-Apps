// 把原版 GLTFLoader chunk 改造成可在 webapp 里用的模块。
//
// 背景：GLTFLoader 不在 vendor 主 bundle 段（L1-27990）里，而是独立的 ESM chunk
// （raw/assets/GLTFLoader-maChTRxv.js，43KB，含 meshopt 扩展）。它 import 的是
// 入口文件的「字母导出表」（`Gi as $` 这种），所以需要两步：
//   1. 把入口的 export{...} 表复制到我们的 three-bundle.js（仅保留 vendor 段里有
//      定义的符号；作者代码的符号 GLTFLoader 用不到）
//   2. 拷贝 chunk 到 webapp/src/player/vendor/GLTFLoader.js，把 import 路径指到
//      ./three-bundle.js
//
// 用法：node tools/gen-gltf-loader.mjs
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.join(import.meta.dirname, '..');
const entryFile = path.join(webRoot, 'raw', 'assets', 'index-E0opA-yG.js');
const gltfSrc = path.join(webRoot, 'raw', 'assets', 'GLTFLoader-maChTRxv.js');
const vendorFile = path.join(webRoot, '..', 'webapp', 'src', 'player', 'vendor', 'three-bundle.js');
const gltfDst = path.join(webRoot, '..', 'webapp', 'src', 'player', 'vendor', 'GLTFLoader.js');

/** 解析 export{...}：支持 `a as b` 与裸 `a` 两种形态 */
function parseExportTable(src) {
  const start = src.lastIndexOf('export{');
  if (start < 0) throw Error('找不到 export{} 语句');
  const end = src.indexOf('}', start);
  return src
    .slice(start + 'export{'.length, end)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(item);
      if (!m) throw Error('无法解析导出条目: ' + item);
      return { internal: m[1], exported: m[2] ?? m[1] };
    });
}

/** vendor 文件里是否有该顶层标识符 */
function isDeclared(vendorSrc, name) {
  const esc = name.replace(/\$/g, '\\$');
  const patterns = [
    new RegExp(`^\\s*function\\s+${esc}\\s*\\(`, 'm'),
    new RegExp(`^\\s*class\\s+${esc}\\s`, 'm'),
    // var/let/const 声明（含多变量声明 a = 1, b = 2 里的位置）
    new RegExp(`(?:^|[,{;]\\s*)(?:var|let|const)\\s+[^;\\n]*?\\b${esc}\\s*(?:=|,|;|\\n)`, 'm'),
    new RegExp(`\\b${esc}\\s*=\\s*class\\b`),
  ];
  return patterns.some((re) => re.test(vendorSrc));
}

const table = parseExportTable(readFileSync(entryFile, 'utf8'));
let vendor = readFileSync(vendorFile, 'utf8');

if (vendor.includes('// ── GLTFLoader 用字母导出表')) {
  console.log('three-bundle.js 已包含字母导出表，跳过第 1 步');
} else {
  const kept = [];
  const missing = [];
  for (const { internal, exported } of table) {
    (isDeclared(vendor, internal) ? kept : missing).push({ internal, exported });
  }
  const block =
    '\n// ── GLTFLoader 用字母导出表（与原入口 index-E0opA-yG.js 的 export{} 一致）──\n' +
    '// 只保留 vendor 段里真实存在的符号；原表里属于作者代码的符号 GLTFLoader 不引用。\n' +
    'export {\n' +
    kept.map(({ internal, exported }) => `  ${internal} as ${exported},`).join('\n') +
    '\n};\n';
  writeFileSync(vendorFile, vendor + block);
  console.log(`字母导出表已写入：${kept.length} 个符号` + (missing.length ? `；跳过（vendor 段无定义）：${missing.map((x) => x.internal).join(', ')}` : ''));
}

// 第 2 步：拷贝 GLTFLoader，改写 import 路径
if (!existsSync(gltfSrc)) throw Error('GLTFLoader chunk 不存在: ' + gltfSrc);
let gltf = readFileSync(gltfSrc, 'utf8');
if (!gltf.includes('from"./index-E0opA-yG.js"')) throw Error('GLTFLoader chunk 的 import 形态变了，请检查');
gltf = gltf.replaceAll('from"./index-E0opA-yG.js"', 'from"./three-bundle.js"');
gltf =
  '// 来源：raw/assets/GLTFLoader-maChTRxv.js（原站 GLTFLoader chunk，含 meshopt 扩展）。\n' +
  '// 改动：import 从入口 bundle 改为本地 three-bundle.js（字母导出表已对齐）。\n' +
  gltf;
writeFileSync(gltfDst, gltf);
console.log('GLTFLoader.js 已生成:', path.relative(webRoot, gltfDst), `(${(gltf.length / 1024).toFixed(0)}KB)`);

// 自检：GLTFLoader 的 import 必须全部能在 three-bundle 的导出表里找到
const importLine = gltf.split('\n').find((l) => l.startsWith('import') && l.includes('from"./three-bundle.js"'));
// `$ as e` → 导入的导出名是 `$`（前半段）；裸名取自身
const letters = /import\{([^}]*)\}/.exec(importLine)[1]
  .split(',')
  .map((s) => s.trim().split(' as ')[0].trim());
const vendorAfter = readFileSync(vendorFile, 'utf8');
const exported = new Set([...vendorAfter.matchAll(/as ([A-Za-z_$][\w$]*),/g)].map((m) => m[1]));
const lost = letters.filter((l) => !exported.has(l));
console.log(`自检：GLTFLoader 需要 ${letters.length} 个符号，缺失 ${lost.length ? lost.join(', ') : '无'}`);
if (lost.length) process.exitCode = 1;
