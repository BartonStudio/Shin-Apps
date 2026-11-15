// 检查 src/deobfuscated/ 里「十六进制字面量 + 尾随十进制注释」的一致性。
//
// 触发原因：2026-11-09 复核发现 02-map-assets.deobf.js L227 写成
//      floorColor: 0xa39e44, // 10721924
//   而 0xa39e44 = 10722884 ≠ 10721924（= 0xa39a84）。
//   其中注释里的十进制 10721924 在 bundle 里真实存在，说明：
//     · 原件的值是十进制（正确）
//     · 改写者手算 hex 时算错了（错误）
//   → 这类错误会让代码用错颜色值，且肉眼很难发现。
//
// 用法：node tools/check-hex-consistency.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), 'utf8');

const bundle = read('decompiled/index.beautified.js');
// 数值集合（用于判断注释里的十进制是否真的来自原件）
const bundleNums = new Set(
  (bundle.match(/(?<![\w$.])\d+(?:\.\d+)?(?![\w$])/g) ?? []).map((s) => String(Number(s))),
);

const dir = 'src/deobfuscated';
const files = fs.readdirSync(R(dir)).filter((f) => f.endsWith('.deobf.js')).sort();

// 形如： 0xAABBCC , // 12345678     或   0xAABBCC // 12345678
const RE = /0x([0-9a-fA-F]{3,8})\s*,?\s*\/\/\s*(\d{4,9})\b/g;

const problems = [];
let checked = 0;

for (const f of files) {
  const lines = read(`${dir}/${f}`).split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const L = lines[ln];
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(L))) {
      checked++;
      const hexVal = parseInt(m[1], 16);
      const decVal = Number(m[2]);
      if (hexVal === decVal) continue; // 一致
      const inBundle = bundleNums.has(String(decVal));
      const hexInBundle = bundle.toLowerCase().includes(m[1].toLowerCase());
      problems.push({
        file: f,
        line: ln + 1,
        hex: '0x' + m[1],
        hexVal,
        decVal,
        correctHex: '0x' + decVal.toString(16),
        decInBundle: inBundle,
        hexInBundle,
        text: L.trim().slice(0, 90),
      });
    }
  }
}

console.log(`扫描 ${files.length} 个 deobf 文件，检出 ${checked} 处「hex + 十进制注释」配对`);

const realBug = problems.filter((p) => p.decInBundle && !p.hexInBundle);
const suspicious = problems.filter((p) => !(p.decInBundle && !p.hexInBundle));

console.log(`\n=== 确认为错误（注释里的十进制在 bundle 中存在，而 hex 字面量不存在）: ${realBug.length} 处 ===`);
for (const p of realBug) {
  console.log(`  ${p.file}:L${p.line}`);
  console.log(`    代码写的   ${p.hex} = ${p.hexVal}   ← bundle 中找不到`);
  console.log(`    注释说的   ${p.decVal} = ${p.correctHex}   ← bundle 中存在（正确值）`);
  console.log(`    原文: ${p.text}`);
}

if (suspicious.length) {
  console.log(`\n=== 其他不一致（需人工判断）: ${suspicious.length} 处 ===`);
  for (const p of suspicious.slice(0, 20)) {
    console.log(`  ${p.file}:L${p.line}  ${p.hex}(${p.hexVal}) vs 注释 ${p.decVal}   dec在bundle=${p.decInBundle} hex在bundle=${p.hexInBundle}`);
  }
  if (suspicious.length > 20) console.log(`  … 另有 ${suspicious.length - 20} 处`);
}

// 一致性无问题的也报告一个数字
const okCount = checked - problems.length;
console.log(`\n一致（无需处理）: ${okCount} 处`);

const out = {
  generatedAt: new Date().toISOString(),
  checkedPairs: checked,
  consistent: okCount,
  confirmedBugs: realBug.length,
  otherMismatches: suspicious.length,
  confirmedBugsDetail: realBug,
  otherMismatchesDetail: suspicious,
};
process.exitCode = realBug.length ? 1 : 0;
