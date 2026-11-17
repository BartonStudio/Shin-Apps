// 在压缩后的单行 bundle 里按符号名查定义/引用上下文（避免被超长行坑）。
//
// 用法：
//   node tools/find-bundle-symbol.mjs Xe Ye              # 默认查 raw/assets/index-E0opA-yG.js
//   node tools/find-bundle-symbol.mjs --file some.js A B
import { readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
let file = path.join(import.meta.dirname, '..', 'raw', 'assets', 'index-E0opA-yG.js');
if (argv[0] === '--file') { file = path.resolve(argv[1]); argv.splice(0, 2); }

const src = readFileSync(file, 'utf8');
for (const sym of argv) {
  console.log(`\n=== ${sym} ===`);
  const esc = sym.replace(/\$/g, '\\$');
  // 定义形态：`X=`、`X =`、`function X(`、`class X `
  const patterns = [
    new RegExp(`(?:var|let|const)\\s+[^;]{0,80}?\\b${esc}\\s*=\\s*[^=]`, 'g'),
    new RegExp(`function\\s+${esc}\\s*\\(`, 'g'),
    new RegExp(`class\\s+${esc}\\s`, 'g'),
  ];
  let shown = 0;
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) && shown < 6) {
      const start = Math.max(0, m.index - 60);
      console.log(`@${m.index}: …${src.slice(start, m.index + 160).replace(/\n/g, ' ⏎ ')}…`);
      shown++;
    }
  }
  if (!shown) {
    const hits = [...src.matchAll(new RegExp(`\\b${esc}\\b`, 'g'))];
    console.log(`（未找到定义形态，共 ${hits.length} 处；前 4 处上下文：）`);
    for (const h of hits.slice(0, 4)) {
      const start = Math.max(0, h.index - 90);
      console.log(`  @${h.index}: …${src.slice(start, h.index + 120).replace(/\n/g, ' ⏎ ')}…`);
    }
  }
}
