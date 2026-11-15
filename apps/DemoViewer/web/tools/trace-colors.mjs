// 追查 src/deobfuscated/ 里那些「原件中不存在」的整型颜色值的来源。
//
// 假设：原件把颜色存成浮点 RGB 三元组（如 raw/maps/de_mirage_lights.json 的
//   "color": [1, 0.63529414, 0.4509804]），改写者把它们打包成了 0xRRGGBB 整数。
//
// 方法：
//   1. 从 deobf 文件里抽取「全库不存在的整数」，筛出能解释为颜色的（0 < v <= 0xFFFFFF）
//   2. 把它们拆成 R/G/B 并归一化
//   3. 在 bundle + raw 数据文件里寻找近似匹配的浮点三元组 / 十六进制 / 其他整数表示
//   4. 输出匹配结论：有源可溯（并给出源坐标）或 无源（判定为改写者选取）
//
// 用法：node tools/trace-colors.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), 'utf8');

// ── 复用简化扫描：只要数字与注释剥离 ──
function stripComments(t) {
  let out = '';
  let i = 0;
  const n = t.length;
  while (i < n) {
    const c = t[i];
    const c2 = t[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && t[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(t[i] === '*' && t[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c; i++;
      while (i < n) {
        if (t[i] === '\\') { out += t[i] + (t[i + 1] ?? ''); i += 2; continue; }
        out += t[i];
        if (t[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}
function numbers(t) {
  const s = stripComments(t);
  const out = [];
  const re = /(?<![\w$])(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w$])/g;
  let m;
  while ((m = re.exec(s))) out.push(Number(m[1]));
  return out;
}

// ── 基线 ──
const baseFiles = [
  'decompiled/index.beautified.js',
  'src/workers/parser.worker.js',
  'src/workers/mapGeometry.worker.js',
  'raw/data/catalogue.json',
  'raw/data/maps-manifest.json',
  'raw/data/maps-index.json',
  'raw/data/catalogue-pointer.json',
  'raw/maps/de_mirage_lights.json',
  'raw/index.html',
  'decompiled/index.beautified.css',
];
const baseText = baseFiles.filter((f) => fs.existsSync(R(f))).map(read).join('\n');
const baseNums = new Set(numbers(baseText));

// 额外收集 SVG 里的 hex 颜色
const svgColors = new Set();
for (const f of fs.readdirSync(R('raw/icons/weapons'))) {
  const t = read(`raw/icons/weapons/${f}`);
  for (const m of t.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) svgColors.add(m[1].toLowerCase());
}

// ── 抽 deobf 里的新颜色 ──
const deobfDir = 'src/deobfuscated';
const deobfFiles = fs.readdirSync(R(deobfDir)).filter((f) => f.endsWith('.deobf.js'));

const novel = new Map(); // value -> Set(file)
for (const f of deobfFiles) {
  for (const v of new Set(numbers(read(`${deobfDir}/${f}`)))) {
    if (!Number.isInteger(v)) continue;
    if (v <= 0 || v > 0xffffff) continue;
    if (baseNums.has(v)) continue;
    if (!novel.has(v)) novel.set(v, new Set());
    novel.get(v).add(f);
  }
}

// ── 找浮点三元组作为候选源 ──
// 从 baseText 里抓 [a, b, c] / (a, b, c) / a, b, c 形式的三元组，且三值都在 [0,1]
const triples = [];
{
  const s = baseText;
  const re = /\[\s*(0?\.\d+|\d+(?:\.\d+)?)\s*,\s*(0?\.\d+|\d+(?:\.\d+)?)\s*,\s*(0?\.\d+|\d+(?:\.\d+)?)\s*\]/g;
  let m;
  while ((m = re.exec(s))) {
    const a = +m[1], b = +m[2], c = +m[3];
    if (a >= 0 && a <= 1 && b >= 0 && b <= 1 && c >= 0 && c <= 1) {
      triples.push({ rgb: [a, b, c], idx: m.index });
    }
  }
}

const hexOf = (v) => '0x' + v.toString(16).padStart(6, '0');
const rgbOf = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];

// 判定：某整数 v 是否可由某个浮点三元组打包得到（容差 ±2/255）
function findSource(v) {
  const [r, g, b] = rgbOf(v);
  const hitTriple = triples.find((t) => {
    const dr = Math.abs(t.rgb[0] * 255 - r);
    const dg = Math.abs(t.rgb[1] * 255 - g);
    const db = Math.abs(t.rgb[2] * 255 - b);
    return dr <= 2 && dg <= 2 && db <= 2;
  });
  if (hitTriple) return { kind: 'float-triple', detail: `[${hitTriple.rgb.join(', ')}]` };
  const hex = hexOf(v).slice(2);
  if (baseText.toLowerCase().includes(hex)) return { kind: 'hex-in-source', detail: '#' + hex };
  if (svgColors.has(hex)) return { kind: 'svg-hex', detail: '#' + hex };
  // 反向：0xBBGGRR（BGR 顺序）
  const bgr = ((b << 16) | (g << 8) | r).toString(16).padStart(6, '0');
  if (baseText.toLowerCase().includes(bgr)) return { kind: 'bgr-in-source', detail: '#' + bgr };
  return null;
}

const rows = [];
for (const [v, files] of [...novel.entries()].sort((a, b) => a[0] - b[0])) {
  const src = findSource(v);
  rows.push({ v, hex: hexOf(v), rgb: rgbOf(v), src, files: [...files] });
}

const traced = rows.filter((r) => r.src);
const untraced = rows.filter((r) => !r.src);

console.log(`扫描 ${deobfFiles.length} 个 deobf 文件；基线含 ${baseNums.size} 种数值、${triples.length} 个 [0,1] 浮点三元组、${svgColors.size} 个 SVG 颜色`);
console.log(`\n发现「全库不存在的整型候选色值」${rows.length} 个：`);
console.log(`  可溯源: ${traced.length}`);
console.log(`  不可溯源: ${untraced.length}`);

if (traced.length) {
  console.log('\n=== 可溯源 ===');
  for (const r of traced.slice(0, 30)) {
    console.log(`  ${String(r.v).padStart(9)}  ${r.hex}  rgb(${r.rgb.join(',')})  ← ${r.src.kind}: ${r.src.detail}`);
  }
  if (traced.length > 30) console.log(`  … 另有 ${traced.length - 30} 个`);
}

if (untraced.length) {
  console.log('\n=== 不可溯源（改写者引入，原件中无任何对应表示）===');
  for (const r of untraced.slice(0, 40)) {
    console.log(`  ${String(r.v).padStart(9)}  ${r.hex}  rgb(${r.rgb.join(',')})  ${r.files.join(',')}`);
  }
  if (untraced.length > 40) console.log(`  … 另有 ${untraced.length - 40} 个`);
}

const out = {
  generatedAt: new Date().toISOString(),
  baseline: { numbers: baseNums.size, floatTriples: triples.length, svgColors: svgColors.size },
  novelColorCount: rows.length,
  tracedCount: traced.length,
  untracedCount: untraced.length,
  traced: traced.map((r) => ({ value: r.v, hex: r.hex, rgb: r.rgb, source: r.src, files: r.files })),
  untraced: untraced.map((r) => ({ value: r.v, hex: r.hex, rgb: r.rgb, files: r.files })),
};
console.log('\n明细已写入 docs/10-color-trace.json');
