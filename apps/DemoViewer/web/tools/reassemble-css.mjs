// 从 styles/ + styles/_manifest.json 逐字节拼回 decompiled/index.beautified.css。
//
// 这是「styles/ 拆分无损」的证明：拼回结果与原文逐字节相同，
// 就说明按组件拆分只改变了组织方式，没有丢规则、没有改声明、没有动空白。
//
// 用法：
//   node tools/reassemble-css.mjs           # 校验（不写文件）
//   node tools/reassemble-css.mjs --write   # 同时写出 styles/_reassembled.css
import fs from 'node:fs';
import path from 'node:path';
import { rebuildCss, topRanges, stripHeader } from './css-toplevel.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);

const manifest = JSON.parse(fs.readFileSync(R('styles/_manifest.json'), 'utf8'));
const original = fs.readFileSync(R(manifest.source), 'utf8').replace(/^\uFEFF/, '');

// ── 从每个样式文件里取出「顶层块」原文（复用 css-toplevel 的解析，避免两份实现漂移）──
const cache = new Map();
function blocksOf(file) {
  if (!cache.has(file)) {
    const raw = stripHeader(fs.readFileSync(R(file), 'utf8'));
    cache.set(file, topRanges(raw).map(([a, b]) => raw.slice(a, b).trim()));
  }
  return cache.get(file);
}

// 把文件里被 media 包裹的块剥出内层
function unwrap(block, atPrelude) {
  const head = block.slice(0, block.indexOf('{')).trim();
  if (head !== atPrelude) return { ok: false, body: block };
  const inner = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
  return { ok: true, body: inner.trim() };
}

// ── 按 order 组装节点序列，供 rebuildCss 使用 ──
const sorted = manifest.items.slice().sort((a, b) => a.order - b.order);
const nodes = [];
const problems = [];
let curAt = null;

for (const it of sorted) {
  const blocks = blocksOf(it.file);
  const blk = blocks[it.ordinal];
  if (blk === undefined) {
    problems.push(`order=${it.order} 在 ${it.file} 找不到第 ${it.ordinal} 个顶层块（共 ${blocks.length}）`);
    continue;
  }

  let body = blk;
  if (it.atId) {
    const r = unwrap(blk, it.atHead);
    if (!r.ok) {
      problems.push(`order=${it.order} 的 at-rule prelude 不匹配：期望 ${JSON.stringify(it.atPrelude)}`);
      continue;
    }
    body = r.body;
  }

  if (!it.atId) {
    curAt = null;
    nodes.push({ kind: 'rule', lead: it.lead, body });
    continue;
  }

  // 进入 / 延续同一个 at-rule 实例
  if (curAt !== it.atId) {
    curAt = it.atId;
    nodes.push({
      kind: 'atrule',
      lead: it.atLead,
      prelude: it.atPrelude,
      tail: it.atTail,
      inner: [{ lead: it.lead, body }],
    });
  } else {
    nodes[nodes.length - 1].inner.push({ lead: it.lead, body });
  }
}

const rebuilt = rebuildCss(nodes) + (manifest.trailingWs ?? '');

// ── 校验 ──
const exact = rebuilt === original;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

console.log(`manifest：${manifest.items.length} 条规则 / ${manifest.files.length} 个文件`);
console.log(`原文 ${original.length} 字符；拼回 ${rebuilt.length} 字符`);
console.log(`逐字节一致: ${exact ? '✅ 是' : '❌ 否'}`);
if (!exact) {
  console.log(`忽略空白后一致: ${norm(rebuilt) === norm(original) ? '是（仅空白差异）' : '否'}`);
  let i = 0;
  while (i < Math.min(rebuilt.length, original.length) && rebuilt[i] === original[i]) i++;
  console.log(`  首个差异 @${i}`);
  console.log(`    原文: ${JSON.stringify(original.slice(Math.max(0, i - 60), i + 60))}`);
  console.log(`    拼回: ${JSON.stringify(rebuilt.slice(Math.max(0, i - 60), i + 60))}`);
}
if (problems.length) {
  console.log(`\n❌ ${problems.length} 处结构问题：`);
  for (const p of problems.slice(0, 10)) console.log(`   · ${p}`);
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(R('styles/_reassembled.css'), rebuilt, 'utf8');
  console.log('\n已写出 styles/_reassembled.css');
}
process.exitCode = exact ? 0 : 1;
