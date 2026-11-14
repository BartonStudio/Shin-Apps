// 分析 csplayer_parser wasm：提取自有源码路径、依赖 crate、rustc 版本
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const buf = fs.readFileSync(path.join(ROOT, 'raw/assets/csplayer_parser_bg-qigVgicw.wasm'));

// 提取所有可打印字符串
const strs = [];
let cur = '';
for (let i = 0; i < buf.length; i++) {
  const b = buf[i];
  if (b >= 32 && b < 127) cur += String.fromCharCode(b);
  else {
    if (cur.length >= 6) strs.push(cur);
    cur = '';
  }
}
if (cur.length >= 6) strs.push(cur);

// 1. 自有源码文件 vendor/parser/src/...
const own = new Set();
for (const s of strs) {
  const k = 'vendor\\parser\\src\\';
  const i = s.indexOf(k);
  if (i >= 0) own.add(s.slice(i + k.length));
}

// 2. 依赖 crate（registry 路径 xxx-x.y.z\src\）
const registry = new Set();
for (const s of strs) {
  if (s.includes('index.crates.io') && s.includes('\\src\\')) {
    // 取 registry\src\index.crates.io-xxx\ 后面的 crate-version
    const after = s.split('index.crates.io-1949cf8c6b5b557f\\')[1];
    if (after) {
      const crateVer = after.split('\\src\\')[0];
      registry.add(crateVer);
    }
  }
}

// 3. rustc 版本 commit
const rustc = new Set();
for (const s of strs) {
  const k = '/rustc/';
  const i = s.indexOf(k);
  if (i >= 0) rustc.add(s.slice(i + k.length, i + k.length + 40));
}

// 4. wasm-bindgen 版本
const wb = new Set();
for (const s of strs) {
  const k = 'wasm_bindgen[';
  const i = s.indexOf(k);
  if (i >= 0) wb.add(s.slice(i + k.length, i + k.length + 16));
}

const report = {
  file: 'csplayer_parser_bg-qigVgicw.wasm',
  bytes: buf.length,
  ownSources: [...own].sort(),
  registryDeps: [...registry].sort(),
  rustcCommits: [...rustc],
  wasmBindgenHash: [...wb],
};

fs.mkdirSync(path.join(ROOT, 'wasm'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'wasm/report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
