// 从 beautified bundle 里机械提取 meshoptimizer 官方解码器（第三方库，MIT）。
//
// 原件位置：decompiled/index.beautified.js L29448–29580
//   var Q_ = t({ MeshoptDecoder: () => $_ }),
//     $_ = (function () { ... })(),
// 它不属于作者代码（是 zeux/meshoptimizer 的 meshopt_decoder.js 内联），
// 所以不做反混淆，只做「去掉 bundle 包装 → 变成标准 ESM 导出」。
//
// 产物：webapp/src/player/vendor/meshopt-decoder.js
// 用法：node tools/extract-meshopt.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.join(import.meta.dirname, '..');
const srcFile = path.join(webRoot, 'decompiled', 'index.beautified.js');
const dstFile = path.join(webRoot, '..', 'webapp', 'src', 'player', 'vendor', 'meshopt-decoder.js');

const lines = readFileSync(srcFile, 'utf8').split('\n');

const startIdx = lines.findIndex((l) => l.startsWith('var Q_ = t({ MeshoptDecoder: () => $_ }),'));
if (startIdx < 0) throw Error('找不到解码器起始行（var Q_ = t({ MeshoptDecoder: () => $_ }),）');
const bodyStart = startIdx + 1;
if (!lines[bodyStart].includes('$_ = (function () {')) throw Error('起始行下一行不是 $_ = (function () {');

let endIdx = -1;
for (let i = bodyStart; i < lines.length; i++) {
  if (lines[i].trim() === '})(),') { endIdx = i; break; }
}
if (endIdx < 0) throw Error('找不到解码器结束行（})(),）');

const body = lines.slice(bodyStart + 1, endIdx); // (function(){ 内部
const out = [
  '// 来源：decompiled/index.beautified.js L29448–29580（bundle 内联的',
  '// zeux/meshoptimizer 官方 meshopt_decoder.js，MIT 许可）。',
  '// 改动：只去掉 bundle 的模块包装（var Q_ = t({...})），改为 ESM 导出；逻辑零改动。',
  '// 用途：GLTFLoader 解码 EXT_meshopt_compression 压缩的地图/角色 GLB。',
  '',
  'export const MeshoptDecoder = (function () {',
  ...body,
  '})();',
  '',
].join('\n');

writeFileSync(dstFile, out);
console.log('meshopt-decoder.js 已生成:', path.relative(webRoot, dstFile), `(${(out.length / 1024).toFixed(0)}KB, ${body.length} 行)`);
