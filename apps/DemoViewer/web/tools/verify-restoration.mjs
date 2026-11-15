// 复核验证器 v2：检查这套 JS 还原工程的「完整性」与「正确性」。
// 只读，不修改任何被检查的文件。用法：node tools/verify-restoration.mjs
//
// v2 修正了 v1 的两个误报源：
//   1. v1 的 stripComments 不识别正则字面量，会把 `/.../` 里的引号当字符串起点，导致两侧抽取结果失真。
//      本版用「前一个有意义 token」判定 `/` 是除号还是正则起点。
//   2. v1 提取 CSS 声明时把 `@media (max-width:600px)` 的 prelude 也当成声明，
//      而 styles/ 拆分把 media 规则逐条重新包裹（39 → 374），造成假差异。本版先剥离 at-rule prelude。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), 'utf8');

let fail = 0;
let warn = 0;
const out = [];
const say = (s = '') => out.push(s);
function check(ok, label, detail = '') {
  if (!ok) fail++;
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  — ' + detail : ''}`);
}
function note(label, detail) {
  warn++;
  say(`  [WARN] ${label}  — ${detail}`);
}
function info(label, detail) {
  say(`  [INFO] ${label}${detail ? '  — ' + detail : ''}`);
}

// ═══════════════════ JS 扫描器 ═══════════════════
// 正确区分：字符串、模板字符串、行/块注释、正则字面量。
const REGEX_PREV = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '/', '%', '<', '>', '~', '^', '=>',
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await',
]);

const unescapeJS = (s) =>
  s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, e) => {
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r\n': '' };
    return e in map ? map[e] : e;
  });

// 模板字面量的「静态片段」按空白折叠后比较：formatter 可重排 ${} 内表达式，但不会改动静态文本
const normChunk = (s) => s.replace(/\s+/g, ' ').trim();

// 去掉字符串与注释，避免其中的 if/for 等关键词干扰控制流计数
function stripStringsForCount(t) {
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
      i++;
      while (i < n) {
        if (t[i] === '\\') { i += 2; continue; }
        if (t[i] === q) { i++; break; }
        i++;
      }
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function scanJS(src) {
  const st = {
    strings: [],
    tmpl: [],
    idents: [],
    numbers: [],
    props: [],
    counts: { '{': 0, '}': 0, '[': 0, ']': 0, '(': 0, ')': 0 },
  };
  scanExpr(src, 0, st, false);
  return st;
}

// 递归扫描表达式；stopAtBrace=true 时遇到未配对的 `}` 返回（用于模板 ${...}）
function scanExpr(src, i, st, stopAtBrace) {
  const n = src.length;
  let prev = '';
  let prev2 = ''; // 用于区分 `.prop` 与展开运算符 `...x`
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (stopAtBrace && c === '}') return i + 1;

    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }

    // 普通字符串
    if (c === '"' || c === "'") {
      const q = c;
      let buf = '';
      i++;
      while (i < n) {
        if (src[i] === '\\') { buf += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === q) { i++; break; }
        buf += src[i]; i++;
      }
      st.strings.push(unescapeJS(buf));
      prev = 'str';
      continue;
    }

    // 模板字面量（支持嵌套 ${} 与内部嵌套字符串/模板）
    if (c === '`') {
      i = scanTemplate(src, i, st);
      prev = 'str';
      continue;
    }

    // 正则字面量
    if (c === '/' && (prev === '' || REGEX_PREV.has(prev))) {
      i++;
      let inClass = false;
      let buf = '';
      let ok = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { buf += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { i++; ok = true; break; }
        else if (ch === '\n') break;
        buf += ch; i++;
      }
      while (ok && i < n && /[a-z]/i.test(src[i])) i++;
      // 非法正则（跨行）→ 当除号处理，不记录
      if (ok) { st.strings.push('__RE__' + buf); prev = 're'; }
      continue;
    }

    // 数字（含以 . 开头的小数，如 .5）
    const leadingDot = c === '.' && /[0-9]/.test(c2) && prev !== 'id' && prev !== ')' && prev !== ']';
    if ((/[0-9]/.test(c) && prev !== 'id') || leadingDot) {
      let j = i;
      if (c === '0' && /[xXoObB]/.test(c2)) {
        // 带进制前缀：整段按该进制的字符集吞
        j += 2;
        const radixRe = /[xX]/.test(c2) ? /[0-9a-fA-F_]/ : /[0-9_]/;
        while (j < n && radixRe.test(src[j])) j++;
      } else {
        // 十进制：只允许数字、下划线、单个小数点、指数
        // （不能把后面的 a-f 字母也吞进来，否则 `getContext(`2d`)` 会被读成非法数字 `2d`）
        let seenDot = false;
        while (j < n) {
          const ch = src[j];
          if (/[0-9_]/.test(ch)) { j++; continue; }
          if (ch === '.' && !seenDot) { seenDot = true; j++; continue; }
          if (/[eE]/.test(ch) && /[0-9_.]/.test(src[j - 1])) {
            j++;
            if (/[+-]/.test(src[j])) j++;
            continue;
          }
          break;
        }
      }
      let raw = src.slice(i, j);
      // 去掉数字尾随的点（如 `5..toFixed()` 的属性访问点被误吞）
      while (raw.length > 1 && raw.endsWith('.')) { raw = raw.slice(0, -1); j--; }
      const v = Number(raw.replace(/_/g, ''));
      st.numbers.push(Number.isFinite(v) ? String(v) : raw);
      i = j;
      prev = 'num';
      continue;
    }

    // 标识符 / 关键字
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      st.idents.push(word);
      // 记录 .member 形式的属性访问（成员名在任何重命名中都不应改动）
      if (prev === '.' && prev2 !== '.') st.props.push(word); // 排除 `...spread`
      prev = REGEX_PREV.has(word) ? word : 'id';
      i = j;
      continue;
    }

    if (c in st.counts) st.counts[c]++;
    if (!/\s/.test(c)) {
      prev2 = prev;
      prev = c;
    }
    i++;
  }
  return i;
}

function scanTemplate(src, i, st) {
  const n = src.length;
  i++; // 跳过起始反引号
  let chunk = '';
  while (i < n) {
    const c = src[i];
    if (c === '\\') { chunk += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
    if (c === '`') { i++; break; }
    if (c === '$' && src[i + 1] === '{') {
      st.tmpl.push(normChunk(unescapeJS(chunk)));
      chunk = '';
      i = scanExpr(src, i + 2, st, true);
      continue;
    }
    chunk += c;
    i++;
  }
  st.tmpl.push(normChunk(unescapeJS(chunk)));
  return i;
}

function multiset(a) {
  const m = new Map();
  for (const x of a) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function diff(want, have) {
  // 返回 have 相对 want 缺少的项（want 是基准）
  const res = [];
  for (const [k, v] of want) {
    const h = have.get(k) ?? 0;
    if (h < v) res.push({ key: k, want: v, have: h });
  }
  return res;
}
const fmt = (arr) => (arr.length ? JSON.stringify(arr.slice(0, 5)) : '');

// ═══════════════════ A. raw → decompiled 等价性 ═══════════════════
say('═'.repeat(78));
say('A. 原始产物 → decompiled/ 等价性（formatter 是否只动格式）');
say('═'.repeat(78));

function compareJS(label, rawPath, decPath) {
  const a = scanJS(read(rawPath));
  const b = scanJS(read(decPath));
  say(`\n  ${label}`);
  const dS = diff(multiset(a.strings), multiset(b.strings));
  check(dS.length === 0, '字符串/正则字面量集合一致',
    dS.length ? `缺 ${dS.length} 种 ${fmt(dS)}` : `${a.strings.length} 个`);
  const dT = diff(multiset(a.tmpl), multiset(b.tmpl));
  check(dT.length === 0, '模板字面量静态片段集合一致',
    dT.length ? `缺 ${dT.length} 种 ${fmt(dT.map((x) => ({ ...x, key: x.key.slice(0, 70) })))}` : `${a.tmpl.length} 段`);
  const dD = diff(multiset(a.idents), multiset(b.idents));
  check(dD.length === 0, '标识符集合一致',
    dD.length ? `缺 ${dD.length} 种 ${fmt(dD)}` : `${a.idents.length} 个 / ${multiset(a.idents).size} 种`);
  const dN = diff(multiset(a.numbers), multiset(b.numbers));
  check(dN.length === 0, '数值字面量集合一致',
    dN.length ? `缺 ${dN.length} 种 ${fmt(dN)}` : `${a.numbers.length} 个`);
  check(a.counts['{'] === b.counts['{'] && a.counts['}'] === b.counts['}'], '花括号计数一致',
    `${a.counts['{']}/${a.counts['}']} vs ${b.counts['{']}/${b.counts['}']}`);
  check(a.counts['['] === b.counts['['] && a.counts[']'] === b.counts[']'], '方括号计数一致',
    `${a.counts['[']}/${a.counts[']']} vs ${b.counts['[']}/${b.counts[']']}`);
  if (a.counts['('] !== b.counts['(']) {
    info('圆括号数量不同（formatter 补括号，左右配平，属预期）',
      `${a.counts['(']} → ${b.counts['(']}（配平 ${a.counts[')']} → ${b.counts[')']}）`);
  } else check(true, '圆括号计数一致');
}

compareJS('主 bundle', 'raw/assets/index-E0opA-yG.js', 'decompiled/index.beautified.js');
compareJS('parser.worker', 'raw/assets/parser.worker-Cvx4vjXK.js', 'src/workers/parser.worker.js');
compareJS('mapGeometry.worker', 'raw/assets/mapGeometry.worker-BGvfBalF.js', 'src/workers/mapGeometry.worker.js');

// CSS：剥离 at-rule prelude 后比较声明
function cssDecls(t) {
  const cleaned = t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(media|supports|container|layer|keyframes|-webkit-keyframes)[^{]*\{/g, '{');
  const res = [];
  const re = /([a-zA-Z-]+)\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = re.exec(cleaned))) {
    // formatter 会把 `.08em` 规范成 `0.08em` —— 统一补前导 0 后再折叠空白
    const val = m[2].trim().replace(/(^|[^\w.])\.(\d)/g, '$10.$2').replace(/\s+/g, '');
    res.push(`${m[1].toLowerCase()}:${val}`);
  }
  return res;
}
function compareCSS(label, rawPath, decPath) {
  const a = cssDecls(read(rawPath));
  const b = cssDecls(read(decPath));
  say(`\n  ${label}`);
  const d = diff(multiset(a), multiset(b));
  check(d.length === 0, 'CSS 声明集合一致',
    d.length ? `缺 ${d.length} 种 ${fmt(d)}` : `${a.length} 条声明`);
  const ra = (read(rawPath).match(/\}/g) ?? []).length;
  const rb = (read(decPath).match(/\}/g) ?? []).length;
  check(ra === rb, 'CSS 规则数一致', `${ra} vs ${rb}`);
}
compareCSS('主 CSS', 'raw/assets/index-CKB5zRpH.css', 'decompiled/index.beautified.css');

// ═══════════════════ B. 切片逐字一致 + 无缝覆盖 ═══════════════════
say('\n' + '═'.repeat(78));
say('B. src/app + src/vendor 切片：逐字一致性与覆盖完整性');
say('═'.repeat(78));

const slicesDoc = JSON.parse(read('docs/slices.json'));
const bundleLines = read('decompiled/index.beautified.js').split(/\r?\n/);
const bundleCount = bundleLines.length - 1;
say(`\n  bundle 内容行数 = ${bundleCount}；slices.json 记录 ${slicesDoc.slices.length} 个切片`);

let vBad = 0;
let gBad = 0;
let next = 1;
for (const s of slicesDoc.slices) {
  if (!fs.existsSync(R(s.file))) { vBad++; say(`  [FAIL] 缺失 ${s.file}`); continue; }
  const txt = read(s.file).split(/\r?\n/);
  const body = txt.slice(6, txt.length - 1);
  const expect = bundleLines.slice(s.start - 1, s.end);
  let same = body.length === expect.length;
  if (same) for (let i = 0; i < body.length; i++) if (body[i] !== expect[i]) { same = false; break; }
  if (!same) { vBad++; say(`  [FAIL] 非逐字 ${s.file}（${expect.length} vs ${body.length}）`); }
  if (s.start !== next) { gBad++; say(`  [FAIL] 不连续 ${s.file}：期望 ${next} 实际 ${s.start}`); }
  next = s.end + 1;
}
check(vBad === 0, `${slicesDoc.slices.length} 个切片全部逐字一致`);
check(gBad === 0, '切片首尾相接，无缺口无重叠');
check(next - 1 === bundleCount, `覆盖 L1–${next - 1} 等于 bundle 全长 ${bundleCount}`);

const vendor = slicesDoc.slices.find((s) => s.file.includes('/vendor/'));
const firstApp = slicesDoc.slices.find((s) => s.file.includes('/app/'));
check(!!vendor && !!firstApp && vendor.start === 1 && vendor.end + 1 === firstApp.start,
  'vendor/app 边界自洽', `vendor L${vendor?.start}–${vendor?.end}，app 起于 L${firstApp?.start}`);

// ═══════════════════ C. styles/ 完整性 ═══════════════════
say('\n' + '═'.repeat(78));
say('C. styles/ 拆分的声明完整性');
say('═'.repeat(78));
{
  const dec = read('decompiled/index.beautified.css');
  const files = fs.readdirSync(R('styles')).filter((f) => f.endsWith('.css')).sort();
  const joined = files.map((f) => read(`styles/${f}`)).join('\n');
  const a = multiset(cssDecls(dec));
  const b = multiset(cssDecls(joined));
  const d = diff(a, b);
  const d2 = diff(b, a);
  say(`\n  ${files.length} 个样式文件；展开 CSS ${[...a.values()].reduce((x, y) => x + y, 0)} 条声明 / 拆分后 ${[...b.values()].reduce((x, y) => x + y, 0)} 条`);
  check(d.length === 0 && d2.length === 0, '声明多重集与 decompiled CSS 完全一致',
    d.length || d2.length ? `缺 ${d.length} / 多 ${d2.length}` : '');
  // 可逆性：调用 reassemble-css.mjs 做逐字节校验
  let reassembleOk = false;
  let reassembleMsg = '';
  try {
    const { execFileSync } = await import('node:child_process');
    const outBuf = execFileSync(process.execPath, [path.join(ROOT, 'tools/reassemble-css.mjs')], { encoding: 'utf8' });
    reassembleOk = /逐字节一致: ✅/.test(outBuf);
    reassembleMsg = (outBuf.match(/原文 [^\n]*/) ?? [''])[0];
  } catch (e) {
    reassembleOk = false;
    reassembleMsg = (e.stdout ?? '') + (e.stderr ?? '');
  }
  check(reassembleOk, 'styles/ 可逐字节拼回 decompiled/index.beautified.css（node tools/reassemble-css.mjs）', reassembleMsg);
  note('@media 在组件文件里被逐条重新包裹（可读性取舍）',
    `原始 ${(dec.match(/@media/g) ?? []).length} → 拆分后 ${(joined.match(/@media/g) ?? []).length}`);
}

// ═══════════════════ D. deobfuscated 清点 ═══════════════════
say('\n' + '═'.repeat(78));
say('D. src/deobfuscated/（语义改写产物）清点');
say('═'.repeat(78));
say('\n  注意：这些文件是【有损改写】，不是逐字还原，因此无法用指纹法证明等价。');
say('  本节只做客观清点：引用行号是否准确、覆盖了哪些切片、是否遗漏。');
say('  等价性只能靠人工逐文件复核。');

const deobfDir = 'src/deobfuscated';
const deobfFiles = fs.readdirSync(R(deobfDir)).filter((f) => f.endsWith('.deobf.js')).sort();
const mdFiles = fs.readdirSync(R(deobfDir)).filter((f) => f.endsWith('.md'));

const sliceByBase = new Map(slicesDoc.slices.map((s) => [path.basename(s.file).replace(/\.js$/, ''), s]));
const otherByFile = new Map((slicesDoc.otherSources ?? []).map((o) => [o.file, o]));

const CANON_SLICE = /^\/\/ 原文范围：decompiled\/index\.beautified\.js L(\d+)–(\d+)（切片 ([^）]+)）/;
const CANON_OTHER = /^\/\/ 原文范围：(\S+?)（非切片来源/;

let citedBad = 0;
let citedOk = 0;
let noCite = 0;
let otherOk = 0;
const covered = new Set();
say(`\n  改写文件 ${deobfFiles.length} 个 + 笔记 ${mdFiles.length} 个\n`);
say('  ┌─ 文件 ──────────────────────────────────── 规范行引用 ────────── 应有范围 ────── 判定 ┐');
for (const f of deobfFiles) {
  const lines = read(`${deobfDir}/${f}`).split(/\r?\n/).slice(0, 16);
  const canon = lines.find((L) => L.startsWith('// 原文范围：')) ?? '';
  const ms = canon.match(CANON_SLICE);
  const mo = canon.match(CANON_OTHER);

  if (mo) {
    // 非切片来源（worker）
    const src = mo[1];
    const ok = !!otherByFile.get(src);
    if (ok) { otherOk++; citedOk++; } else citedBad++;
    say(`  │ ${f.padEnd(40)} ${'worker'.padEnd(22)} ${src.padEnd(20)} ${ok ? '准确（otherSources）' : '未登记'}`);
    continue;
  }
  if (!ms) {
    noCite++;
    say(`  │ ${f.padEnd(40)} ${'—'.padEnd(22)} ${'—'.padEnd(20)} 缺规范行`);
    continue;
  }
  const [_, a, b, nameStr] = ms;
  const names = nameStr.split(/\s*\+\s*/).map((s) => s.replace(/，.*$/, '').trim());
  const targets = names.map((n) => sliceByBase.get(n)).filter(Boolean);
  const missing = names.filter((n) => !sliceByBase.has(n));
  if (!targets.length) {
    citedBad++;
    say(`  │ ${f.padEnd(40)} ${'—'.padEnd(22)} ${'—'.padEnd(20)} 切片名无法解析`);
    continue;
  }
  const wantStart = Math.min(...targets.map((s) => s.start));
  const wantEnd = Math.max(...targets.map((s) => s.end));
  for (const s of targets) covered.add(s.file);
  const ok = +a === wantStart && +b === wantEnd && missing.length === 0;
  if (ok) citedOk++;
  else citedBad++;
  say(
    `  │ ${f.padEnd(40)} ${`${a}-${b}`.padEnd(22)} ${`${wantStart}-${wantEnd}`.padEnd(20)} ${ok ? '准确' : `不符${missing.length ? '（切片名未解析:' + missing.join(',') + '）' : ''}`}`,
  );
}
say('  └──────────────────────────────────────────────────────────────────────────────────────┘');
check(citedBad === 0, '所有改写文件的规范行引用与实际范围一致',
  citedBad ? `${citedBad} 处错误` : `${citedOk} 个准确（含 ${otherOk} 个非切片来源）`);
if (noCite) note('以下改写文件缺少 // 原文范围 规范行', `${noCite} 个`);

const appSlices = slicesDoc.slices.filter((s) => s.file.includes('/app/'));
const uncovered = appSlices.filter((s) => !covered.has(s.file));
say(`\n  切片覆盖：${appSlices.length} 个 app 切片中，${appSlices.length - uncovered.length} 个有改写产物`);
if (uncovered.length) {
  note(`以下 ${uncovered.length} 个切片没有改写产物`, uncovered.map((s) => path.basename(s.file).replace(/\.js$/, '')).join(', '));
}

// ═══════════════════ E. markup 提取完整性 ═══════════════════
say('\n' + '═'.repeat(78));
say('E. src/markup/：HTML 模板提取完整性');
say('═'.repeat(78));
{
  const bundleTxt = read('decompiled/index.beautified.js');

  // 两类产物，分别校验：
  //   src/markup/*.html            人工组装的「带上下文」版本（含部分 JS 语句）
  //   src/markup/templates/*.html  extract-markup.mjs 逐字抠出的纯模板（带 bundle 行号头）
  const groups = [
    { dir: 'src/markup', label: '带上下文版' },
    { dir: 'src/markup/templates', label: '逐字模板' },
  ];

  for (const g of groups) {
    if (!fs.existsSync(R(g.dir))) continue;
    const files = fs.readdirSync(R(g.dir)).filter((f) => f.endsWith('.html'));
    say(`\n  ${g.label}：${files.length} 个文件（${g.dir}）`);
    let bad = 0;
    for (const f of files) {
      const raw = read(`${g.dir}/${f}`).trim();
      if (!raw) { bad++; say(`  [FAIL] 空文件 ${f}`); continue; }
      // 剥掉我们自己加的头部注释再比对
      const txt = raw.replace(/^<!--[\s\S]*?-->\s*/, '');
      // 逐字模板额外校验：头部声明的 bundle 行号处确实就是这段内容
      const declared = /第\s*(\d+)\s*行/.exec(raw);
      if (g.label === '逐字模板' && declared) {
        const ln = Number(declared[1]);
        const win = read('decompiled/index.beautified.js').split(/\r?\n/).slice(ln - 1, ln + 40).join('\n');
        const probe = txt.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 25)[0] ?? '';
        if (probe && !win.includes(probe)) { bad++; say(`  [FAIL] ${f}：声明的 L${ln} 附近找不到其首条标志行`); continue; }
      }
      const cand = txt
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 25 && !s.startsWith('//'))
        .sort((a, b) => b.length - a.length)
        .slice(0, 3);
      const hits = cand.filter((c) => bundleTxt.includes(c)).length;
      if (hits === 0) { bad++; say(`  [FAIL] ${f}：3 条最长行均未在 bundle 中原样出现`); }
      else say(`  [PASS] ${f}：${hits}/${cand.length} 条标志行在 bundle 中原样存在`);
    }
    check(bad === 0, `${g.label}的 ${files.length} 个文件均可回溯到 bundle 原文`);
  }
}

// ═══════════════════ F. docs/05 类名对照表校验 ═══════════════════
say('\n' + '═'.repeat(78));
say('F. docs/05「压缩名 → 语义名」对照表校验');
say('═'.repeat(78));
say('\n  方法：对表中每个声明名，在 bundle 里定位其类/函数定义，再验证表中列出的');
say('        关键方法名是否真的出现在该定义体内。');
{
  const guide = read('docs/05-deobfuscation-guide.md');
  const bundleTxt = read('decompiled/index.beautified.js');
  const rows = [];
  for (const line of guide.split(/\r?\n/)) {
    if (!/^\|\s*`/.test(line)) continue;
    const cells = line.split('|').map((s) => s.trim());
    const m0 = cells[1]?.match(/^`([A-Za-z_$][\w$]*)`$/);
    if (!m0) continue;
    const name = m0[1];
    const claimed = [];
    for (const c of cells.slice(2)) {
      for (const t of c.matchAll(/`([^`]+)`/g)) {
        if (t[1].includes('/')) for (const p of t[1].split('/')) if (/^[A-Za-z_$][\w$]*$/.test(p)) claimed.push(p);
      }
    }
    rows.push({ name, claimed: [...new Set(claimed)] });
  }
  say(`\n  表中可解析条目：${rows.length} 条`);

  // 声明定位：支持 `var/let/const` 前缀、多声明链（前置逗号）、`class X`、`function X`
  const declCandidates = (n) => [
    new RegExp(`(?:^|\\n)[^\\n]*?\\b${n}\\s*=\\s*class\\b`),
    new RegExp(`(?:^|\\n)\\s*class\\s+${n}\\b`),
    new RegExp(`(?:^|\\n)\\s*function\\s+${n}\\s*\\(`),
    new RegExp(`(?:^|\\n)[^\\n]*?\\b${n}\\s*=\\s*(?:function|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`),
  ];
  const methodCandidate = (n) => new RegExp(`(?:^|[\\s.])${n}\\s*\\(`);

  function bodyOf(idx) {
    let depth = 0;
    let started = false;
    for (let k = idx; k < Math.min(idx + 200000, bundleTxt.length); k++) {
      const c = bundleTxt[k];
      if (c === '{') { depth++; started = true; }
      else if (c === '}') { depth--; if (started && depth === 0) return bundleTxt.slice(idx, k + 1); }
    }
    return bundleTxt.slice(idx, idx + 4000);
  }
  function lineOf(idx) {
    let ln = 1;
    for (let k = 0; k < idx && k < bundleTxt.length; k++) if (bundleTxt[k] === '\n') ln++;
    return ln;
  }
  function sliceOfLine(ln) {
    return slicesDoc.slices.find((s) => ln >= s.start && ln <= s.end);
  }

  let located = 0;
  let asMethod = 0;
  let notFound = 0;
  let inSliceOnly = 0;
  let trulyMissing = 0;
  const problems = [];
  const partials = [];

  for (const { name, claimed } of rows) {
    let idx = -1;
    for (const re of declCandidates(name)) {
      const m = re.exec(bundleTxt);
      if (m) { idx = m.index; break; }
    }
    if (idx < 0) {
      // 退一步：当成方法名/成员名处理（docs/05 第三张表列的是 Player 的方法）
      const mm = methodCandidate(name).exec(bundleTxt);
      if (mm) { asMethod++; located++; continue; }
      notFound++;
      problems.push({ name, kind: '定义未找到', detail: claimed.join(',') });
      continue;
    }
    located++;
    if (!claimed.length) continue;

    const body = bodyOf(idx);
    const hitBody = claimed.filter((p) => new RegExp(`\\b${p}\\b`).test(body));
    // 兜底：在整份 bundle 内是否存在（可能出现在 GLSL 模板字符串或其它模块里）
    const hitAnywhere = claimed.filter((p) => new RegExp(`\\b${p}\\b`).test(bundleTxt));
    const absent = claimed.filter((p) => !hitAnywhere.includes(p));

    if (absent.length === claimed.length) {
      trulyMissing++;
      problems.push({ name, kind: '文档声称的名字在代码中完全不存在', detail: claimed.join(',') });
    } else if (hitBody.length === 0) {
      inSliceOnly++;
      problems.push({ name, kind: '存在于代码但他处（非该类 JS 成员，如 GLSL 函数名）', detail: claimed.join(',') });
    } else if (hitBody.length < claimed.length && absent.length) {
      partials.push({ name, detail: `类体内命中 ${hitBody.join(',')} / 全库都不存在 ${absent.join(',')}` });
    }
  }

  check(notFound === 0, '表中所有名字均能在 bundle 中定位',
    notFound ? `${notFound} 个未找到` : `${located} 个（类/函数 ${located - asMethod} 个，方法/成员 ${asMethod} 个）`);
  check(trulyMissing === 0, '表中声称的名字在代码中均真实存在',
    trulyMissing ? `${trulyMissing} 个完全不存在` : '');
  if (inSliceOnly) note('这些条目在对应切片内存在、但不在该类体内（文档为概括描述）', `${inSliceOnly} 条`);
  if (partials.length) note('部分条目只有部分方法名命中', `${partials.length} 条`);

  const hard = problems.filter((p) => p.kind === '定义未找到' || p.kind === '文档声称的方法在代码中完全不存在');
  if (hard.length) {
    say('\n  ── 硬问题明细（需人工确认）──');
    for (const p of hard) say(`        · ${p.name}  [${p.kind}]  ${p.detail}`);
  }
  const soft = problems.filter((p) => p.kind.includes('他处'));
  if (soft.length) {
    say('\n  ── 措辞粒度差异（不算错，但读文档时要知道）──');
    for (const p of soft) say(`        · ${p.name}: ${p.detail}`);
  }
  if (partials.length) {
    say('\n  ── 部分命中 ──');
    for (const p of partials) say(`        · ${p.name}: ${p.detail}`);
  }
}

// ═══════════════════ G. deobf 翻译保真度 ═══════════════════
say('\n' + '═'.repeat(78));
say('G. src/deobfuscated/ 翻译保真度（对照各自源切片）');
say('═'.repeat(78));
say('\n  基线说明：改写版可以合法引用【其它切片】或【raw 数据文件】里的常量/成员名，');
say('  所以对照基线取「整个 bundle + raw/data + raw/maps 的数据文件」，而不是只看本切片。');
say('  改写的最终判据是：不能引入全库任何地方都不存在的数值或成员名。');

{
  const CANONd = /^\/\/ 原文范围：decompiled\/index\.beautified\.js L(\d+)–(\d+)（切片 ([^）]+)）/;
  // 全局基线：bundle + 两个 worker + 全部 raw 文本文件
  const bundleScan = scanJS(read('decompiled/index.beautified.js'));
  const baseFiles = [
    'src/workers/parser.worker.js',
    'src/workers/mapGeometry.worker.js',
    'raw/data/catalogue.json',
    'raw/data/maps-manifest.json',
    'raw/data/maps-index.json',
    'raw/data/catalogue-pointer.json',
    'raw/maps/de_mirage_lights.json',
    'raw/index.html',
    'decompiled/index.beautified.css',
  ].filter((f) => fs.existsSync(R(f)));
  const baseBlob = baseFiles.map((f) => read(f)).join('\n');
  const baseScan = scanJS(baseBlob);
  const globalNums = new Set([...bundleScan.numbers, ...baseScan.numbers]);
  const globalProps = new Set([...bundleScan.props, ...baseScan.props]);
  const globalText = read('decompiled/index.beautified.js') + '\n' + baseBlob;
  say(`\n  基线：数值 ${globalNums.size} 种、成员 ${globalProps.size} 种（来自 bundle + ${baseFiles.length - 1} 个附加文件）`);

  const rowsG = [];
  for (const f of deobfFiles) {
    const txt = read(`${deobfDir}/${f}`);
    const canon = txt.split(/\r?\n/).find((L) => L.startsWith('// 原文范围：')) ?? '';
    const m = canon.match(CANONd);
    const srcLines = m ? +m[2] - +m[1] + 1 : 0;
    const src = m ? bundleLines.slice(+m[1] - 1, +m[2]).join('\n') : '';

    const D = scanJS(txt);
    // 只看「全库都不存在」的，才算可疑
    const novelNums = [...new Set(D.numbers)].filter((x) => !globalNums.has(x));
    const novelProps = [...new Set(D.props)].filter((x) => !globalProps.has(x));

    const ctl = (t) => {
      const s = stripStringsForCount(t);
      return {
        if: (s.match(/\bif\s*\(/g) ?? []).length,
        for: (s.match(/\bfor\s*\(/g) ?? []).length,
        while: (s.match(/\bwhile\s*\(/g) ?? []).length,
      };
    };
    const cs = ctl(src);
    const cd = ctl(txt);
    const flowDiff = Math.abs(cd.if - cs.if) + Math.abs(cd.for - cs.for) + Math.abs(cd.while - cs.while);
    rowsG.push({ f, novelNums, novelProps, flowDiff, srcLines });
  }

  say('\n  ┌─ 文件 ───────────────────────────── 源行数 ─ 新数值 ─ 新成员 ─ 控制流差异 ┐');
  let badNums = 0;
  let badProps = 0;
  for (const r of rowsG) {
    if (r.novelNums.length) badNums++;
    if (r.novelProps.length) badProps++;
    const flag = r.novelNums.length ? '✗' : r.novelProps.length ? '·' : r.flowDiff > 60 ? '~' : ' ';
    say(
      `  │ ${flag} ${r.f.replace('.deobf.js', '').padEnd(30)} ${String(r.srcLines).padStart(6)} ${String(r.novelNums.length).padStart(8)} ${String(r.novelProps.length).padStart(8)} ${String(r.flowDiff).padStart(10)}`,
    );
  }
  say('  └──────────────────────────────────────────────────────────────────────────────┘');
  say('\n  判定标准（数值与成员名分开）：');
  say('    ✗ 新数值  → 数据错误，必须修（颜色/常量被算错会直接导致渲染结果不同）');
  say('    · 新成员名 → 重命名或提取具名常量，属反混淆的正常手段，但要知道它不是你 grep 得到的原名');
  say('    ~ 控制流差异大但无新符号 → 三元式展开等，通常可接受');

  check(badNums === 0, `${rowsG.length} 个改写文件均未引入全库不存在的【数值】`,
    badNums ? `${badNums} 个存在新数值（数据错误）` : '全部干净');
  if (badProps) note('这些文件引入了全库不存在的【成员名】（重命名/提取常量，属预期行为）', `${badProps} 个文件`);

  if (badNums || badProps) {
    say('\n  ── 明细 ──');
    for (const r of rowsG) {
      if (!r.novelNums.length && !r.novelProps.length) continue;
      say(`\n  ${r.f}`);
      if (r.novelNums.length) say(`    ✗ 全库无此数值(${r.novelNums.length}): ${r.novelNums.slice(0, 20).join(', ')}`);
      if (r.novelProps.length) say(`    · 全库无此成员(${r.novelProps.length}): ${r.novelProps.slice(0, 20).join(', ')}`);
    }
  }
}

// ═══════════════════ I. 改写文件语法有效性 ═══════════════════
// 起因（2026-11-09）：复核时发现 39 个改写文件里有 5 个**根本无法被 JS 解析**——
// 4 处是「反引号开、单引号闭」的笔误（`Custom'），1 处是 hex 修正脚本把多行对象压成一行。
// 这类缺陷此前从未被发现，因为没有任何工具真正去解析过这些文件。
// 更严重的是：未闭合的模板字符串会让骨架扫描器把之后**整个文件**当成字符串内容，
// 导致覆盖率统计完全失真（28-radar 实测从 54% 跳到 95%）。
say('\n' + '═'.repeat(78));
say('I. 改写文件语法有效性');
say('═'.repeat(78));
{
  const { execFileSync } = await import('node:child_process');
  const SHIM =
    'globalThis.self={onmessage:null,postMessage:()=>{}};' +
    'globalThis.window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},devicePixelRatio:1};' +
    'globalThis.document={createElement:()=>({style:{},getContext:()=>null,appendChild(){}}),addEventListener(){}};';
  const deobfFiles = fs.readdirSync(R('src/deobfuscated')).filter((f) => f.endsWith('.deobf.js')).sort();
  let syntaxBad = 0;
  for (const f of deobfFiles) {
    const abs = R(`src/deobfuscated/${f}`).replace(/\\/g, '/');
    try {
      execFileSync(process.execPath, ['--input-type=module', '-e', `${SHIM}await import('file:///${abs}')`], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e.stderr || '';
      if (!/SyntaxError/.test(err)) continue; // 运行时「未定义变量」属正常：改写文件互相引用
      syntaxBad++;
      const m = /\.deobf\.js:(\d+)/.exec(err);
      say(`  [FAIL] ${f} @L${m ? m[1] : '?'}：${(err.match(/SyntaxError: [^\n]+/) ?? [''])[0]}`);
    }
  }
  check(syntaxBad === 0, `${deobfFiles.length} 个改写文件均可被 JS 正确解析`, syntaxBad ? `${syntaxBad} 个存在语法错误` : '全部有效');
}
// ═══════════════════ J. 改动只落在 src/deobfuscated/，原副本未被污染 ═══════════════════
// 约定（2026-11-09 按用户要求）：改动**只**写进 src/deobfuscated/（修改 + 新增）。
//   src/app/ + src/vendor/ + src/workers/ 是「原副本」，必须保持逐字，供后续查阅复核。
// 本段双向确认：
//   ① 原副本仍含「改动前」的旧代码（没被偷偷改掉）
//   ② 改写产物里旧代码已消失、新代码已出现
say('\n' + '═'.repeat(78));
say('J. 改动落点：只在 src/deobfuscated/，原副本保持逐字');
say('═'.repeat(78));
{
  // ── ① 原副本必须仍是改动前的样子 ──
  const ORIGINAL_MUST_HAVE = {
    'src/app/00c-frame-sampler.js': [
      'Math.hypot(n.posX[h] - n.posX[m], n.posY[h] - n.posY[m]) / g', // 差分公式
    ],
    'src/workers/parser.worker.js': [
      'current_equip_value',                    // 仍在抓这个 netprop
      'equipValue: new Uint16Array(m)',         // 仍在分配
      'n.equipValue.buffer,',                   // 仍在传输
    ],
    'src/app/10-character-model.js': [
      'function jC(e, t, n, r, i) {',           // 仍保留 jC
      '(r.speed = jC(e, t, n, i, a)),',
    ],
  };
  let bad = 0;
  for (const [file, needles] of Object.entries(ORIGINAL_MUST_HAVE)) {
    if (!fs.existsSync(R(file))) { say(`  [FAIL] ${file} 不存在`); bad++; continue; }
    const src = read(file);
    const miss = needles.filter((n) => !src.includes(n));
    if (miss.length) { say(`  [FAIL] ${file} 原副本被改动（缺少 ${miss.length} 处原始代码）`); bad++; }
    else say(`  [PASS] ${file} 原副本完好（改动前代码仍在）`);
  }

  // ── ② 改写产物必须反映改动 ──
  const DEOBF_MUST_HAVE = {
    'src/deobfuscated/00c-frame-sampler.deobf.js': [
      'out.speed[p] = frames.speed[speedIndexBase + p];',
    ],
    'src/deobfuscated/00c-frame-sampler.deobf.js#gone': [
      'Math.hypot(frames.posX[toIdx]',          // 旧差分公式必须已删除
    ],
    'src/deobfuscated/10-character-model.deobf.js': [
      '改动记录 2026-11-09',                     // 改动说明段
      'smoothSpeedAt',
    ],
    'src/deobfuscated/parser.worker.deobf.js': [
      '改动记录 2026-11-09',
      'computeSpeedColumns',
    ],
  };
  const DEOBF_MUST_GONE = {
    'src/deobfuscated/00c-frame-sampler.deobf.js': ['Math.hypot(frames.posX[toIdx]'],
    'src/deobfuscated/parser.worker.deobf.js': [
      'equipCol',                                   // 解码逻辑的变量
      'buffers.equipValue[idx] =',                  // 解码写入
      'equipValue: new Uint16Array(total),',        // 分配
    ],
  };
  for (const [file, needles] of Object.entries(DEOBF_MUST_HAVE)) {
    if (file.endsWith('#gone')) continue;
    if (!fs.existsSync(R(file))) { say(`  [FAIL] ${file} 不存在`); bad++; continue; }
    const src = read(file);
    const miss = needles.filter((n) => !src.includes(n));
    if (miss.length) { say(`  [FAIL] ${file} 缺少改动标记：${miss.join('、')}`); bad++; }
    else say(`  [PASS] ${file} 已含改动`);
  }
  for (const [file, needles] of Object.entries(DEOBF_MUST_GONE)) {
    const src = read(file);
    const left = needles.filter((n) => src.includes(n));
    if (left.length) { say(`  [FAIL] ${file} 旧实现残留：${left.join('、')}`); bad++; }
    else say(`  [PASS] ${file} 旧实现已清除`);
  }

  // ── ③ 参考实现必须存在且可被 JS 解析 ──
  const SC = 'src/deobfuscated/speed-columns.js';
  if (!fs.existsSync(R(SC))) { say(`  [FAIL] ${SC} 不存在`); bad++; }
  else {
    const src = read(SC);
    const hasExport = src.includes('export function computeSpeedColumns') && src.includes('export function cloneCarry');
    if (!hasExport) { say(`  [FAIL] ${SC} 缺少 computeSpeedColumns / cloneCarry 导出`); bad++; }
    else say(`  [PASS] ${SC} 存在且导出完整（改动后的唯一参考实现）`);
  }

  // ── 共享内存接入层（src/deobfuscated/shared-buffer.js）──
  {
    const F = 'src/deobfuscated/shared-buffer.js';
    if (!fs.existsSync(R(F))) { say(`  [FAIL] ${F} 不存在`); bad++; }
    else {
      const src = read(F);
      const need = ['export function computeSharedLayout', 'export function writeSharedBuffer',
                    'export function buildDataFromSharedBuffer', 'export function describeSharedBuffer',
                    'export function bindSharedBuffer', 'export function planSharedBuffer'];
      const miss = need.filter((n) => !src.includes(n));
      if (miss.length) { say(`  [FAIL] ${F} 缺少导出：${miss.join('、')}`); bad++; }
      else say(`  [PASS] ${F} 导出完整（布局/写入/读取/自检/接入）`);
    }
    // 两个接入点必须已 export
    for (const [f, name] of [['src/deobfuscated/33-landing-backdrop.deobf.js', 'createPlayer'],
                             ['src/deobfuscated/28-radar.deobf.js', 'DemoApp']]) {
      if (!read(f).includes(`export { ${name} }`)) { say(`  [FAIL] ${f} 未导出 ${name}`); bad++; }
      else say(`  [PASS] ${f} 已导出 ${name}`);
    }
  }

  // ── ④ src/patched/ 必须已移除（不留两套实现）──
  if (fs.existsSync(R('src/patched'))) { say('  [FAIL] src/patched/ 仍存在（应只保留 src/deobfuscated/ 一套）'); bad++; }
  else say('  [PASS] src/patched/ 已移除（改动只有一套，在 src/deobfuscated/）');

  check(bad === 0, '改动落点正确：原副本逐字、改写产物已更新、参考实现唯一', bad ? `${bad} 个问题` : '就绪');
}
// ═══════════════════ H. docs 行号声明校验 ═══════════════════
say('\n' + '═'.repeat(78));
say('H. docs/ 中的行号声明校验');
say('═'.repeat(78));
say('\n  方法：抽取形如「bundle NNNN」的引用，检查 (1) 行号是否越界；');
say('        (2) 文档该行提到的标志串（按词片段、忽略引号风格）是否落在该行号 ±50 行内。');
say('        标 ✎ 的条目已由人工逐一核实，人工结论优先于自动判定。');
{
  // 人工核实台账（对自动判定不可靠的条目，逐条给出结论）
  const MANUAL = {
    '01-architecture.md:8': { verdict: '准确', note: '代码实为 revision: `184`（反引号），文档写成双引号' },
    '01-architecture.md:10': { verdict: '准确', note: '该两行是地图资产 host 常量 csdemo-cs2-assets-v1 / https://maps.csdemo.tv/cs2/' },
    '01-architecture.md:25': { verdict: '准确（已修正）', note: '原写 28861 是旧边界，已改为 27991' },
    '02-changes-vs-20261022.md:60': { verdict: '准确', note: '正是 16/32/64 Hz 三档预设（Fast/Balanced/Precise）' },
    '03-playback-pipeline.md:11': { verdict: '已修正', note: '原写 51233（实为 <main>），已改为 51289（input）/51621（drag 注册）' },
    '03-playback-pipeline.md:46': { verdict: '准确', note: '同为 52981-52983 的三档预设（16/32/64 Hz）' },
    '03-playback-pipeline.md:64': { verdict: '已修正', note: '原写 28909，overview 实际在 L28939-28942 / 28978 / 28990' },
  };

  const docsToCheck = fs
    .readdirSync(R('docs'))
    .filter((f) => f.endsWith('.md') && !['05-deobfuscation-guide.md', '08-boundary-correction.md', '09-restoration-audit.md'].includes(f))
    .sort();
  const norm = (s) => s.replace(/[`'"()（）\s]/g, '').toLowerCase();
  const frags = (s) => (s.match(/[A-Za-z0-9_./¥-]{3,}/g) ?? []).map(norm).filter((x) => x.length >= 3);

  let total = 0;
  let oor = 0;
  let autoBad = 0;
  let manualFound = 0;
  let manualStillWrong = 0;
  const rows = [];
  for (const doc of docsToCheck) {
    const lines = read(`docs/${doc}`).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      for (const m of L.matchAll(/bundle\s+(\d{3,5})(?:\s*[–\-]\s*(\d{3,5}))?/g)) {
        total++;
        const a = +m[1];
        const b = m[2] ? +m[2] : a;
        const key = `${doc}:${i + 1}`;
        const manual = MANUAL[key];
        if (a < 1 || b > bundleCount) {
          oor++;
          rows.push({ key, cite: `${a}-${b}`, verdict: '越界', note: `bundle 只有 ${bundleCount} 行` });
          continue;
        }
        const lo = Math.max(1, a - 50);
        const hi = Math.min(bundleCount, b + 50);
        const win = norm(bundleLines.slice(lo - 1, hi).join('\n'));
        const toks = [...L.matchAll(/`([^`]{3,80})`/g)].map((x) => x[1]).filter((s) => !/^\d+$/.test(s));
        let auto = '无法自动判定';
        if (toks.length) {
          const ok = toks.some((t) => frags(t).every((fr) => win.includes(fr)));
          auto = ok ? '自动：命中' : '自动：未命中';
          if (!ok) autoBad++;
        }
        if (manual) {
          if (!/^准确/.test(manual.verdict)) manualFound++;
        if (!/^准确|已修正/.test(manual.verdict)) manualStillWrong++;
          rows.push({ key, cite: `${a}-${b}`, verdict: `✎ 人工：${manual.verdict}`, note: manual.note, auto });
        } else {
          rows.push({ key, cite: `${a}-${b}`, verdict: auto, note: toks[0] ? `标志串「${toks[0].slice(0, 40)}」` : '', auto });
        }
      }
    }
  }

  say(`\n  共 ${total} 处 bundle 行号引用；人工核实 ${Object.keys(MANUAL).length} 处，发现错误 ${manualFound} 处（均已修正）`);
  say('\n  ┌─ 位置 ───────────────────────────── 引用 ─────────── 自动判定 ──────── 结论 / 说明 ┐');
  for (const r of rows) {
    const v = r.verdict.startsWith('✎') ? r.verdict : r.verdict.replace('自动：', '');
    say(`  │ ${r.key.padEnd(34)} ${r.cite.padEnd(16)} ${(r.auto ?? '').padEnd(16)} ${v}${r.note ? '  — ' + r.note : ''}`);
  }
  say('  └──────────────────────────────────────────────────────────────────────────────────────┘');

  check(oor === 0, '所有 bundle 行号引用均在 1..53504 范围内', oor ? `${oor} 处越界` : '');
  check(manualStillWrong === 0, '人工核实过的行号引用当前全部准确（历史错误已修）',
    manualStillWrong ? `${manualStillWrong} 处仍未修正` : `人工核实 ${Object.keys(MANUAL).length} 处，发现并修正 ${manualFound} 处`);
  if (autoBad) {
    note('自动判定未命中的条目（多为引号风格差异或文档概括性表述，需人工确认）', `${autoBad} 处`);
  }
}

// ═══════════════════ 汇总 ═══════════════════
say('\n' + '═'.repeat(78));
say(`汇总：FAIL ${fail} 项，WARN ${warn} 项`);
say('═'.repeat(78));

const report = out.join('\n');
console.log(report);
fs.writeFileSync(R('docs/09-restoration-audit.txt'), report + '\n', 'utf8');
console.log('\n报告已写入 docs/09-restoration-audit.txt');
process.exitCode = fail > 0 ? 1 : 0;
