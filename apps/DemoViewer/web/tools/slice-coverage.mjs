import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const UNION = process.argv.includes('--union');
const R = (p) => path.join(ROOT, p);
const bundle = fs.readFileSync(R('decompiled/index.beautified.js'), 'utf8');
const bundleLines = bundle.split(/\r?\n/);

// 复用主工具的骨架扫描
const mod = await import('file:///' + R('tools/compare-deobf-semantics.mjs').replace(/\\/g, '/') + '?x=1').catch(() => null);
// 主工具是脚本不是库，这里直接内联最小版骨架（与主工具同规则）
const CONTROL = new Set(['if','else','for','while','do','switch','case','default','return','break','continue','throw','try','catch','finally']);
function skeleton(src) {
  const out = []; let i = 0; const n = src.length; let prev = ''; let lastWord = '';
  const push = (k, v) => out.push(k + ':' + v);
  while (i < n) {
    const c = src[i], c2 = src[i+1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i+1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") { const q = c; let s = ''; i++; while (i < n) { if (src[i] === '\\') { s += src[i+1] ?? ''; i += 2; continue; } if (src[i] === q) { i++; break; } s += src[i++]; } push('str', s); prev = 'str'; continue; }
    if (c === '`') { i++; let w = ''; let hasI = false; while (i < n) { if (src[i] === '\\') { w += src[i+1] ?? ''; i += 2; continue; } if (src[i] === '$' && src[i+1] === '{') { hasI = true; i += 2; let d = 1; const st = i; while (i < n && d > 0) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; } for (const t of skeleton(src.slice(st, i-1))) out.push(t); continue; } if (src[i] === '`') { i++; break; } w += src[i++]; } if (w || !hasI) push(hasI ? 'tstr' : 'str', w); prev = 'str'; continue; }
    if (/[0-9]/.test(c) && !/[\w$]/.test(prev)) { let j = i; if (c === '0' && /[xX]/.test(c2)) { j += 2; while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++; } else { let dot = false; while (j < n) { const ch = src[j]; if (/[0-9_]/.test(ch)) { j++; continue; } if (ch === '.' && !dot) { dot = true; j++; continue; } if (/[eE]/.test(ch) && /[0-9_.]/.test(src[j-1])) { j++; if (/[+-]/.test(src[j])) j++; continue; } break; } } const raw = src.slice(i, j).replace(/_/g, ''); const nv = String(Number(raw)); if (prev === '!' && (nv === '0' || nv === '1')) push('bool', nv === '0' ? 'false' : 'true'); else if (lastWord === 'void' && nv === '0') push('undef', ''); else push('num', nv); i = j; prev = 'num'; lastWord = ''; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++; const w = src.slice(i, j); if (w === 'true' || w === 'false') push('bool', w); else if (w === 'undefined') push('undef', ''); else if (CONTROL.has(w)) push('kw', w); lastWord = w; i = j; prev = 'id'; continue; }
    if (c === '.' && /[A-Za-z_$]/.test(c2) && src[i-1] !== '.') { let j = i+1; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++; push('mem', src.slice(i+1, j)); i = j; prev = 'id'; continue; }
    prev = c; i++;
  }
  return out;
}

// 按声明的原文范围把改写文件分组到切片
const files = fs.readdirSync(R('src/deobfuscated')).filter((f) => f.endsWith('.deobf.js'));
const bySlice = new Map();
const declared = [];
for (const f of files) {
  const head = fs.readFileSync(R('src/deobfuscated/' + f), 'utf8').split(/\r?\n/).slice(0, 16).join('\n');
  const m = /decompiled\/index\.beautified\.js\s*L(\d+)\s*[–-]\s*L?(\d+)/.exec(head);
  if (!m) continue;
  declared.push({ f, lo: +m[1], hi: +m[2] });
}

const slices = JSON.parse(fs.readFileSync(R('docs/slices.json'), 'utf8')).slices.filter((s) => s.kind === 'app' || !s.kind);
const rows = [];
for (const s of slices) {
  const group = UNION ? declared.map((d) => d.f) : declared.filter((d) => Math.max(d.lo, s.start) <= Math.min(d.hi, s.end)).map((d) => d.f);
  const origText = bundleLines.slice(s.start - 1, s.end).join('\n');
  const a = skeleton(origText);
  const pool = new Map();
  for (const f of group) for (const k of skeleton(fs.readFileSync(R('src/deobfuscated/' + f), 'utf8'))) pool.set(k, (pool.get(k) ?? 0) + 1);
  // 稀有 token（本切片内出现次数少）作为特征
  const freq = new Map();
  for (const k of a) freq.set(k, (freq.get(k) ?? 0) + 1);
  const distinctive = [...new Set(a)].filter((k) => (freq.get(k) ?? 0) <= 3 && !k.startsWith('kw:') && !k.startsWith('cmp:') && !k.startsWith('asg:') && !k.startsWith('logic:') && !k.startsWith('bool:') && !k.startsWith('undef:'));
  let hit = 0;
  for (const k of distinctive) if (pool.has(k)) hit++;
  const cov = distinctive.length ? hit / distinctive.length : 0;
  rows.push({ slice: s.file, range: `${s.start}-${s.end}`, files: group.length, names: group.join(' + ') || '（无改写）', cov, distinct: distinctive.length });
}

rows.sort((x, y) => x.cov - y.cov);
if (process.argv.includes('--csv')) {
  for (const r of rows) console.log([r.slice, r.range, r.files, r.distinct, (r.cov*100).toFixed(0), r.names].join('|'));
  process.exit(0);
}
console.log((UNION ? '【并集口径】' : '【自身口径】'));
console.log('切片'.padEnd(32) + '改写文件数'.padEnd(12) + '稀有token'.padEnd(11) + '覆盖');
console.log('─'.repeat(78));
for (const r of rows) {
  const flag = r.cov < 0.8 ? ' ⚠' : '';
  console.log(r.slice.padEnd(32) + String(r.files).padEnd(12) + String(r.distinct).padEnd(11) + (r.cov * 100).toFixed(0) + '%' + flag);
}
const weak = rows.filter((r) => r.cov < 0.8);
console.log('─'.repeat(78));
console.log(`共 ${rows.length} 个切片；覆盖 <80% 的有 ${weak.length} 个`);
for (const w of weak) console.log(`  ${w.slice.padEnd(38)} ${String((w.cov*100).toFixed(0)+'%').padStart(4)}` + (UNION ? '' : `   ← ${w.names}`));
