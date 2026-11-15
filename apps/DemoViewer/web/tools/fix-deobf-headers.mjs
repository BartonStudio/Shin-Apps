// 规范化 src/deobfuscated/*.deobf.js 的「原文范围」引用。
// 幂等：可重复运行；已存在规范行则覆盖更新，不存在则插入。
//
// 约定：每个改写文件头部必须有且仅有一行
//   // 原文范围：decompiled/index.beautified.js L<start>–<end>（切片 <file>）
// 这样校验器 tools/verify-restoration.mjs 可以机器解析。
//
// 用法：node tools/fix-deobf-headers.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), 'utf8');
const write = (p, s) => fs.writeFileSync(R(p), s, 'utf8');
const DRY = process.argv.includes('--dry');

const slicesDoc = JSON.parse(read('docs/slices.json'));
const slices = slicesDoc.slices;

// 已知的多切片改写（文件头自述 + 内容已核实）
const MULTI = {
  '07-physics-engine': ['07-physics-engine.js', '08-physics-model.js', '09-trajectory-recorder.js'],
};

// 非切片来源（不在 slices.json 的切片体系里）
const OTHER = {
  'parser.worker': {
    source: 'src/workers/parser.worker.js',
    raw: 'raw/assets/parser.worker-Cvx4vjXK.js',
    note: '非切片来源（worker 文件），与 src/workers/mapGeometry.worker.js 并列',
  },
};

const CANON = /^\/\/ 原文范围：/;

function findSlices(deobfBase) {
  if (MULTI[deobfBase]) return slices.filter((s) => MULTI[deobfBase].some((f) => s.file.endsWith('/' + f)));
  // 文件名前缀：01-/02-/03-/.../33- 或 04-light-probe-grid 这类子集
  const num = deobfBase.match(/^(\d+)/)?.[1];
  if (!num) return [];
  const exact = deobfBase; // 如 13-fire-manager
  let hit = slices.filter((s) => path.basename(s.file).replace(/\.js$/, '') === exact);
  if (hit.length) return hit;
  // 子集（如 04-light-probe-grid 属于 04-lighting-shader）
  hit = slices.filter((s) => path.basename(s.file).startsWith(num + '-'));
  return hit;
}

function buildLine(deobfBase) {
  if (OTHER[deobfBase]) {
    const o = OTHER[deobfBase];
    return `// 原文范围：${o.source}（非切片来源；原始产物 ${o.raw}）`;
  }
  const hit = findSlices(deobfBase);
  if (!hit.length) return null;
  const start = Math.min(...hit.map((s) => s.start));
  const end = Math.max(...hit.map((s) => s.end));
  const names = hit.map((s) => path.basename(s.file).replace(/\.js$/, '')).join(' + ');
  const subset = hit.length === 1 && path.basename(hit[0].file).replace(/\.js$/, '') !== deobfBase;
  return `// 原文范围：decompiled/index.beautified.js L${start}–${end}（切片 ${names}${subset ? '，本文件为其子集' : ''}）`;
}

const files = fs.readdirSync(R('src/deobfuscated')).filter((f) => f.endsWith('.deobf.js')).sort();
let changed = 0;
let skipped = 0;
const log = [];

for (const f of files) {
  const base = f.replace(/\.deobf\.js$/, '');
  const want = buildLine(base);
  if (!want) { skipped++; log.push(`  [SKIP] ${f}：找不到对应切片`); continue; }

  const p = `src/deobfuscated/${f}`;
  const lines = read(p).split('\n');

  // 修正已知的错误范围（prose 行里的旧数字）
  let touched = false;
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const L = lines[i];
    if (CANON.test(L)) {
      if (L !== want) { lines[i] = want; touched = true; }
      break;
    }
  }

  // 把「来源/原始压缩文件」散文行里残留的旧行号替换成正确范围
  const hitForRange = findSlices(base);
  if (hitForRange.length) {
    const start = Math.min(...hitForRange.map((s) => s.start));
    const end = Math.max(...hitForRange.map((s) => s.end));
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      if (!/^\/\/\s*(来源|原始压缩文件|原始文件)：/.test(lines[i])) continue;
      const fixed = lines[i].replace(/(\d{4,5})\s*[–\-]\s*(\d{4,5})/g, (m0, a, b) =>
        +a === start && +b === end ? m0 : `${start}–${end}`,
      );
      if (fixed !== lines[i]) { lines[i] = fixed; touched = true; }
      break;
    }
  }

  const hasCanon = lines.slice(0, 14).some((L) => CANON.test(L));
  if (!hasCanon) {
    // 插到「来源/原始压缩文件/原始文件」行之后；找不到就插在第一行之后
    let at = -1;
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      if (/^\/\/\s*(来源|原始压缩文件|原始文件)：/.test(lines[i])) { at = i + 1; break; }
    }
    if (at < 0) at = 1;
    lines.splice(at, 0, want);
    touched = true;
  }

  if (touched) {
    if (!DRY) write(p, lines.join('\n'));
    changed++;
    log.push(`  [UPD ] ${f}\n         ${want}`);
  } else {
    log.push(`  [OK  ] ${f}`);
  }
}

console.log(log.join('\n'));
console.log(`\n更新 ${changed} 个，跳过 ${skipped} 个${DRY ? '（--dry 未写盘）' : ''}`);
