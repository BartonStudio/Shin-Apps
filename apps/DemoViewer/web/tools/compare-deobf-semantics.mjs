// 语义骨架比对：把「原件切片」和「反混淆改写」各抽成一条骨架序列，用 Myers diff 找差异。
//
// 为什么可行：反混淆只做了三件事——重命名局部变量、重命名/提取类成员、补注释与空行。
// 这三件事都不改变下面的「骨架」：
//   · 数值字面量（按值）
//   · 字符串字面量（按内容，模板串按静态片段）
//   · 成员访问名（.posX / .startTick …）——改写者基本保留
//   · 控制流关键字（if / else / for / while / do / switch / return / break / continue）
//   · 比较运算符（< / <= / > / >= / == / === / != / !==）
//   · 算术赋值（+= / -= / *= / /= / ++ / --，以及 ?? / || / &&）
//
// 所以骨架序列出现差异 = 该处逻辑可能被改动（改错了运算符、漏了分支、调整了顺序）。
// **注意**：骨架相同 ≠ 语义必然等价（改写者可能还做了三元式展开、常量提取等合法重构），
// 因此本工具的定位是「缩小人工复核范围」，不是「证明等价」。
//
// 用法：node tools/compare-deobf-semantics.mjs [--file <name>] [--verbose] [--json]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
const args = process.argv.slice(2);
const ONLY = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const BY_UNIT = args.includes('--by-unit');
const VERBOSE = args.includes('--verbose');
const AS_JSON = args.includes('--json');

// ── 词法扫描：只保留骨架 token ───────────────────────────────────────────────
const CONTROL = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'return', 'break', 'continue', 'throw', 'try', 'catch', 'finally']);
const CMP = ['===', '!==', '==', '!=', '<=', '>=', '<', '>'];
const ASSIGN = ['>>>=', '<<=', '>>=', '>>>=', '**=', '??=', '||=', '&&=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '++', '--'];

function skeleton(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let prevSignificant = '';
  let lastWord = '';

  const push = (kind, val) => out.push({ kind, val });

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // 空白
    if (/\s/.test(c)) { i++; continue; }

    // 行注释
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    // 块注释
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }

    // 字符串
    if (c === '"' || c === "'") {
      const q = c;
      let s = '';
      i++;
      while (i < n) {
        if (src[i] === '\\') { s += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === q) { i++; break; }
        s += src[i++];
      }
      push('str', s.replace(/\\(.)/g, '$1'));
      prevSignificant = 'str';
      continue;
    }

    // 模板字面量：静态文本整段拼接后作为**一个** str token 记录。
    // 不按 ${} 切段 —— 否则改写只要调整插值位置就会产生一堆假差异
    // （如原件 `<span class="pp-ic` + `">` 与改写的不同切分）。
    // ${} 里的表达式照旧递归扫描，其中的代码仍然参与骨架。
    if (c === '`') {
      i++;
      let whole = '';
      let hasInterp = false;
      while (i < n) {
        if (src[i] === '\\') { whole += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          hasInterp = true;
          i += 2;
          let depth = 1;
          const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            else if (src[i] === '`') { // 嵌套模板，简单跳过
              i++;
              while (i < n && src[i] !== '`') { if (src[i] === '\\') i++; i++; }
            }
            i++;
          }
          const inner = src.slice(start, i - 1);
          for (const t of skeleton(inner)) out.push(t);
          continue;
        }
        if (src[i] === '`') { i++; break; }
        whole += src[i++];
      }
      // 无插值的模板与普通字符串等价（原件几乎全用反引号，改写多用引号），按 str 处理；
      // 有插值的模板受分段方式影响，单独记为 tstr 并排除出严格比对。
      if (whole || !hasInterp) push(hasInterp ? 'tstr' : 'str', whole.replace(/\\`/g, '`').replace(/\\(.)/g, '$1'));
      prevSignificant = 'str';
      continue;
    }

    // 正则字面量（启发式：前一个有意义字符不是标识符/闭括号/数字）
    if (c === '/' && !/[\w$)\]]/.test(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { j++; break; }
        else if (ch === '\n') break;
        j++;
      }
      const body = src.slice(i, j);
      if (body.length > 1) { push('re', body); i = j; prevSignificant = 're'; continue; }
    }

    // 数字
    if (/[0-9]/.test(c) && !/[\w$]/.test(prevSignificant)) {
      let j = i;
      if (c === '0' && /[xXoObB]/.test(c2)) {
        j += 2;
        const re = /[xX]/.test(c2) ? /[0-9a-fA-F_]/ : /[0-9_]/;
        while (j < n && re.test(src[j])) j++;
      } else {
        let dot = false;
        while (j < n) {
          const ch = src[j];
          if (/[0-9_]/.test(ch)) { j++; continue; }
          if (ch === '.' && !dot) { dot = true; j++; continue; }
          if (/[eE]/.test(ch) && /[0-9_.]/.test(src[j - 1])) { j++; if (/[+-]/.test(src[j])) j++; continue; }
          break;
        }
      }
      const raw = src.slice(i, j).replace(/_/g, '');
      const numVal = String(Number(raw));

      // ── 压缩器惯用写法的归一化 ──
      //   `!0` / `!1`  是 minifier 写的 true / false
      //   `void 0`     是 minifier 写的 undefined
      // 反混淆版会写回 true/false/undefined，语义相同，不能算差异。
      if (prevSignificant === '!' && (numVal === '0' || numVal === '1')) {
        out.pop(); // 去掉刚才 push 的那个 '!' 之外无副作用；'!' 本身不进骨架
        push('bool', numVal === '0' ? 'false' : 'true');
      } else if (lastWord === 'void' && numVal === '0') {
        push('undef', '');
      } else {
        push('num', numVal);
      }
      i = j;
      prevSignificant = 'num';
      lastWord = '';
      continue;
    }

    // 标识符 / 关键字
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === 'true' || word === 'false') push('bool', word);
      else if (word === 'undefined') push('undef', '');
      else if (CONTROL.has(word)) push('kw', word);
      lastWord = word;
      i = j;
      prevSignificant = 'id';
      continue;
    }

    // 成员访问：.name（排除 ...spread 与数字小数点）
    if (c === '.' && /[A-Za-z_$]/.test(c2) && !/[.]/.test(prevSignificant === 'dot' ? '.' : '')) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const prop = src.slice(i + 1, j);
      // 若前一个字符也是 '.'，说明是 spread，不记
      if (src[i - 1] !== '.') push('mem', prop);
      i = j;
      prevSignificant = 'id';
      continue;
    }

    // 比较运算符（最长匹配）
    let matched = null;
    for (const op of CMP) if (src.startsWith(op, i)) { matched = op; break; }
    if (matched) {
      // 排除箭头函数 =>、>= 后接 =、以及 << / >>
      if (src[i + matched.length] === '=' && matched.length === 1) { /* >= / <= 已在列表 */ }
      if (matched === '>' && src[i + 1] === '=' && src[i + 2] === '>') { /* >>> */ }
      if (!(src[i + matched.length] === '>' && matched === '>')) {
        push('cmp', matched);
        i += matched.length;
        prevSignificant = 'op';
        continue;
      }
    }

    // 赋值 / 自增
    let am = null;
    for (const op of ASSIGN) if (src.startsWith(op, i)) { am = op; break; }
    if (am) { push('asg', am); i += am.length; prevSignificant = 'op'; continue; }

    // 逻辑运算符
    if (src.startsWith('&&', i) || src.startsWith('||', i) || src.startsWith('??', i)) {
      push('logic', src.slice(i, i + 2)); i += 2; prevSignificant = 'op'; continue;
    }

    if (c === '.') { prevSignificant = 'dot'; i++; continue; }
    prevSignificant = c;
    i++;
  }
  return out;
}

// ── Myers diff（O(ND)，D 有上限）──────────────────────────────────────────────
function myersDiff(a, b, maxD = 4000) {
  const N = a.length, M = b.length;
  const MAX = Math.min(N + M, maxD);
  const offset = MAX;
  let v = new Int32Array(2 * MAX + 2).fill(-1);
  const trace = [];
  v[offset + 1] = 0;
  for (let d = 0; d <= MAX; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const kk = offset + k;
      let x;
      if (k === -d || (k !== d && v[kk - 1] < v[kk + 1])) x = v[kk + 1];
      else x = v[kk - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v[kk] = x;
      if (x >= N && y >= M) {
        // 回溯
        const ops = [];
        let cx = N, cy = M;
        for (let dd = d; dd >= 0; dd--) {
          const vv = trace[dd];
          const k2 = cx - cy;
          const kk2 = offset + k2;
          let px, py;
          if (k2 === -dd || (k2 !== dd && vv[kk2 - 1] < vv[kk2 + 1])) { px = vv[kk2 + 1]; py = px - (k2 + 1); }
          else { px = vv[kk2 - 1]; py = px - (k2 - 1); }
          while (cx > px && cy > py) { ops.push({ t: '=', a: a[cx - 1], b: b[cy - 1] }); cx--; cy--; }
          if (dd > 0) {
            if (cx === px) { ops.push({ t: '+', b: b[cy - 1] }); cy--; }
            else { ops.push({ t: '-', a: a[cx - 1] }); cx--; }
          }
        }
        return ops.reverse();
      }
    }
  }
  return null; // 超出上限
}

// 归一化：`str` 与 `tmpl` 都是字符串字面量，改写时常在反引号与引号之间互换，
// 这不构成语义差异，合并成同一个 kind 再比。
const key = (t) => `${t.kind === 'tmpl' ? 'str' : t.kind}:${t.kind === 'tmpl' ? t.val : t.val}`;

// ── 把原文按顶层声明切成「单元」（function X(...) / X = class / var X = ...）──
// 用途：--by-unit 模式下逐单元报覆盖率，把「总覆盖率 28%」变成
//       「具体哪些函数没被改写」的可执行清单。
function splitUnits(src) {
  const units = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    // 跳到 depth-0 且是声明起始的位置
    const declRe = /(?:^|\n)(\s*)(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:var|let|const)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*=\s*class)/g;
    declRe.lastIndex = i;
    const m = declRe.exec(src);
    if (!m) break;
    const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const name = m[2] ?? m[3] ?? m[4] ?? '?';
    // 找这个声明的结束：从声明的第一个 '{' 开始配平；没有 '{' 则到行尾
    let j = declRe.lastIndex;
    while (j < n && src[j] !== '{' && src[j] !== '\n') j++;
    let end;
    if (src[j] === '{') {
      let depth = 0;
      for (; j < n; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
      }
      end = j;
    } else {
      end = j;
    }
    const ln = (src.slice(0, start).match(/\n/g) || []).length + 1;
    units.push({ name, start, end, line: ln, text: src.slice(start, end) });
    i = Math.max(end, start + 1);
  }
  return units;
}

// ── 定位原文范围 ─────────────────────────────────────────────────────────────
const bundleLines = fs.readFileSync(R('decompiled/index.beautified.js'), 'utf8').split(/\r?\n/);

function originalTextFor(file) {
  const head = fs.readFileSync(R(`src/deobfuscated/${file}`), 'utf8').split(/\r?\n/).slice(0, 16).join('\n');
  const m = /原文范围：([^\n]+)/.exec(head);
  if (!m) return { err: '头部缺「原文范围」' };
  const line = m[1];
  const rng = /decompiled\/index\.beautified\.js\s*L(\d+)\s*[–-]\s*L?(\d+)/.exec(line);
  if (rng) {
    const a = Number(rng[1]), b = Number(rng[2]);
    return { text: bundleLines.slice(a - 1, b).join('\n'), src: `bundle L${a}-${b}` };
  }
  const w = /(parser\.worker|mapGeometry\.worker)/.exec(line);
  if (w) {
    const f = w[1] === 'parser.worker' ? 'src/workers/parser.worker.js' : 'src/workers/mapGeometry.worker.js';
    return { text: fs.readFileSync(R(f), 'utf8'), src: f };
  }
  return { text: fs.readFileSync(R('decompiled/index.beautified.js'), 'utf8'), src: 'bundle 全文', whole: true };
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
const files = fs.readdirSync(R('src/deobfuscated')).filter((f) => f.endsWith('.deobf.js')).sort()
  .filter((f) => !ONLY || f.includes(ONLY));

const rows = [];
const details = [];

for (const file of files) {
  const deobfSrc = fs.readFileSync(R(`src/deobfuscated/${file}`), 'utf8');
  const orig = originalTextFor(file);
  if (orig.err) { rows.push({ file, err: orig.err }); continue; }

  const a = skeleton(orig.text).map(key);
  const b = skeleton(deobfSrc).map(key);
  const ops = myersDiff(a, b);

  // ── --by-unit：把覆盖率拆到「原文每个顶层声明」上 ──
  // 难点：直接看「单元 token 在改写里出现过吗」会被通用 token 带偏
  // （num:0 / kw:return / mem:length 这种任何函数里都有，未改写的函数也会显得"覆盖了"）。
  // 做法：只统计**稀有 token** —— 在原件里只出现于 ≤2 个单元的 token，
  //       它们足以指认「这段逻辑有没有被搬过去」。
  if (BY_UNIT) {
    if (!ops) { rows.push({ file, src: orig.src, byUnit: [], totalTokens: a.length, coverage: 0 }); continue; }
    const pool = new Map();
    for (const k of b) pool.set(k, (pool.get(k) ?? 0) + 1);
    const units = splitUnits(orig.text).map((u) => ({ ...u, tok: skeleton(u.text).map(key) })).filter((u) => u.tok.length);

    // 统计每个 token 出现在多少个单元里
    const spread = new Map();
    for (const u of units) {
      for (const k of new Set(u.tok)) spread.set(k, (spread.get(k) ?? 0) + 1);
    }
    const DISTINCTIVE_MAX_SPREAD = 2;

    const unitRows = [];
    // 消耗式匹配：一个改写版里的 token 只能满足有限次命中，
    // 否则 deobf 越大、池子越全，所有函数都会被误判为「已覆盖」。
    const budget = new Map(pool);
    for (const u of units) {
      const distinct = [...new Set(u.tok)].filter((k) => (spread.get(k) ?? 0) <= DISTINCTIVE_MAX_SPREAD);
      const use = distinct.length ? distinct : [...new Set(u.tok)];
      let hit = 0;
      for (const k of use) {
        const left = budget.get(k) ?? 0;
        if (left > 0) { hit++; budget.set(k, left - 1); }
      }
      unitRows.push({
        name: u.name, line: u.line, tokens: u.tok.length,
        distinctive: use.length, hit, cov: use.length ? hit / use.length : 0,
      });
    }
    rows.push({
      file, src: orig.src, byUnit: unitRows, totalTokens: a.length,
      coverage: a.length ? ops.filter((o) => o.t === '=').length / a.length : 0,
    });
    continue;
  }

  // diff 可能因规模过大返回 null —— 此时仍然可以做名字集合比对（不需要 diff），
  // 只是拿不到逐位置的差异分组。
  const matched = ops ? ops.filter((o) => o.t === '=').length : 0;
  const del = ops ? ops.filter((o) => o.t === '-').length : -1;
  const ins = ops ? ops.filter((o) => o.t === '+').length : -1;

  // 覆盖率 = 命中 token / 原件 token。低覆盖率说明该改写文件只覆盖了切片的一部分。
  const coverage = a.length && ops ? matched / a.length : null;

  // ── 第二层判定：名字级集合比对（比逐位置 diff 可靠得多）──
  // 逐位置 diff 会被「三元展开 / 拆行 / for→while」搅出大量噪声。
  // 换成比**名字集合**：只有「原件有、改写完全没有」或「改写凭空多出」的名字才是真信号。
  //   mem: 成员名 —— 凭空多/少 → 读错字段或漏读字段
  //   num/str/re: 字面量 —— 凭空多/少 → 值被改、或漏掉分支
  // 注意：位置挪动、重复次数变化都**不算**（那是重构的正常结果）。
  const namesOf = (arr, kind) => new Set(arr.filter((k) => k.startsWith(kind + ':')));
  const memA = namesOf(a, 'mem');
  const memB = namesOf(b, 'mem');
  const memMissing = [...memA].filter((k) => !memB.has(k));
  const memExtra = [...memB].filter((k) => !memA.has(k));
  // 模板字面量(tstr)不参与：改写只要拆/合插值就会变，机械比对必然假报。
  const litA = new Set([...namesOf(a, 'num'), ...namesOf(a, 'str'), ...namesOf(a, 're')]);
  const litB = new Set([...namesOf(b, 'num'), ...namesOf(b, 'str'), ...namesOf(b, 're')]);
  const litMissing = [...litA].filter((k) => !litB.has(k));
  const litExtra = [...litB].filter((k) => !litA.has(k));
  const nameClean = !memMissing.length && !memExtra.length && !litMissing.length && !litExtra.length;

  // ── 按 token 种类统计差异 ──
  // 反混淆的正常重构（三元展开、for→while、提取常量）只会动控制流/逻辑/比较这几类，
  // 且通常成对出现（条件取反 + 多一个 if/return）。
  // 而「成员名变了」「字面量变了」没有合法的重构理由 —— 那才是真错误信号。
  const kindOf = (k) => k.slice(0, k.indexOf(':'));
  const stat = { memDel: 0, memIns: 0, litDel: 0, litIns: 0, ctrlDel: 0, ctrlIns: 0, asgDel: 0, asgIns: 0 };
  const memChanges = [];
  const litChanges = [];
  const cmpChanges = [];
  for (const o of ops ?? []) {
    if (o.t === '=') continue;
    const k = o.t === '-' ? o.a : o.b;
    const kind = kindOf(k);
    if (kind === 'mem') {
      if (o.t === '-') stat.memDel++; else stat.memIns++;
      if (memChanges.length < 12) memChanges.push(`${o.t}${k.slice(4)}`);
    } else if (kind === 'num' || kind === 'str' || kind === 'tmpl' || kind === 're') {
      if (o.t === '-') stat.litDel++; else stat.litIns++;
      if (litChanges.length < 12) litChanges.push(`${o.t}${k}`);
    } else if (kind === 'cmp') {
      if (o.t === '-') stat.ctrlDel++; else stat.ctrlIns++;
      if (cmpChanges.length < 12) cmpChanges.push(`${o.t}${k.slice(4)}`);
    } else if (kind === 'asg') {
      if (o.t === '-') stat.asgDel++; else stat.asgIns++;
    } else {
      if (o.t === '-') stat.ctrlDel++; else stat.ctrlIns++;
    }
  }

  // 把改动分组：连续的非 '=' 操作算一组，便于定位「整段被省略」还是「零星改了几处」
  const groups = [];
  let cur = null;
  for (const o of ops ?? []) {
    if (o.t === '=') { if (cur) { groups.push(cur); cur = null; } continue; }
    if (!cur) cur = { size: 0, del: 0, ins: 0, sample: [] };
    cur.size++;
    if (o.t === '-') cur.del++; else cur.ins++;
    if (cur.sample.length < 6) cur.sample.push(o.t === '-' ? `-${o.a}` : `+${o.b}`);
  }
  if (cur) groups.push(cur);
  groups.sort((x, y) => y.size - x.size);

  // ── 判定（三层）──
  // PARTIAL  : 覆盖率 < 50%，先谈「改写了多少」再谈等价
  // SUSPECT  : 名字集合有差异（凭空多/少成员或字面量）→ 必须人工看
  // REFACTOR : 名字集合完全一致，差异只来自控制流重构 → 高置信度
  let verdict;
  if (coverage === null) verdict = nameClean ? 'NO_DIFF_CLEAN' : 'SUSPECT';
  else if (coverage < 0.5) verdict = 'PARTIAL';
  else if (!nameClean) verdict = 'SUSPECT';
  else if (del === 0 && ins === 0) verdict = 'IDENTICAL';
  else verdict = 'REFACTOR';

  rows.push({
    file, src: orig.src, origTokens: a.length, deobfTokens: b.length, matched, del, ins,
    coverage, verdict, stat, memChanges, litChanges, cmpChanges, groupCount: groups.length, largest: groups[0] ?? null,
    memMissing, memExtra, litMissing, litExtra,
  });

  if (VERBOSE || verdict === 'SUSPECT' || verdict === 'PARTIAL') {
    details.push({ file, src: orig.src, coverage, groups: groups.slice(0, 6), groupCount: groups.length, del, ins, stat, memChanges, litChanges, cmpChanges, memMissing, memExtra, litMissing, litExtra });
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ rows, details }, null, 2));
} else if (BY_UNIT) {
  const pad = (s, w) => String(s).padEnd(w);
  const padS = (s, w) => String(s).padStart(w);
  for (const r of rows) {
    if (r.err) { console.log(`${r.file}: ⚠ ${r.err}`); continue; }
    console.log(`\n══ ${r.file}  (${r.src})  原件共 ${r.totalTokens} 个骨架 token ══`);
    const sorted = [...r.byUnit].sort((x, y) => x.cov - y.cov);
    const zero = sorted.filter((u) => u.hit === 0);
    const partial = sorted.filter((u) => u.hit > 0 && u.cov < 0.9);
    const full = sorted.filter((u) => u.cov >= 0.9);
    console.log(`  完全没改写 ${zero.length} 个 / 部分改写 ${partial.length} 个 / 基本完整 ${full.length} 个\n`);
    console.log(`  ${pad('原件函数（压缩名）', 22)} ${padS('行号', 7)} ${padS('token', 6)} ${padS('特征', 6)} ${padS('命中', 6)} ${padS('覆盖', 6)}`);
    console.log('  ' + '─'.repeat(56));
    for (const u of sorted) {
      if (u.cov >= 0.9) continue;
      console.log(`  ${pad(u.name, 22)} ${padS(u.line, 7)} ${padS(u.tokens, 6)} ${padS(u.distinctive, 6)} ${padS(u.hit, 6)} ${padS((u.cov * 100).toFixed(0) + '%', 6)}`);
    }
    if (sorted.every((u) => u.cov >= 0.9)) console.log('  （所有单元覆盖均 ≥90%）');
  }
} else {
  const pad = (s, w) => String(s).padEnd(w);
  const padS = (s, w) => String(s).padStart(w);
  console.log(`${pad('文件', 40)} ${padS('原件', 6)} ${padS('改写', 6)} ${padS('覆盖', 6)} ${padS('成员Δ', 6)} ${padS('字面Δ', 6)}  判定`);
  console.log('─'.repeat(94));
  const cnt = { IDENTICAL: 0, REFACTOR: 0, SUSPECT: 0, PARTIAL: 0 };
  for (const r of rows) {
    if (r.err) { console.log(`${pad(r.file, 40)}  ⚠ ${r.err}`); continue; }
    cnt[r.verdict]++;
    const mark = { IDENTICAL: '✅', REFACTOR: '≈', SUSPECT: '⚠', PARTIAL: '◐' }[r.verdict];
    const cov = r.coverage === undefined ? '—' : `${(r.coverage * 100).toFixed(0)}%`;
    const md = r.memMissing ? r.memMissing.length + r.memExtra.length : '—';
    const ld = r.litMissing ? r.litMissing.length + r.litExtra.length : '—';
    console.log(`${pad(r.file, 40)} ${padS(r.origTokens, 6)} ${padS(r.deobfTokens, 6)} ${padS(cov, 6)} ${padS(md, 6)} ${padS(ld, 6)}  ${mark} ${r.verdict}`);
  }
  console.log('─'.repeat(94));
  console.log(`合计 ${rows.length} 个文件：骨架一致 ${cnt.IDENTICAL}，仅合法重构 ${cnt.REFACTOR}，**名字集合有差异 ${cnt.SUSPECT}**，部分覆盖 ${cnt.PARTIAL}`);
  console.log('  ✅ 骨架完全一致   ≈ 差异只来自三元展开/for→while 等合法重构');
  console.log('  ⚠ 动了成员名或字面量（无合法重构理由）→ 必须逐处看   ◐ 覆盖率<50%（只改写了一部分）');

  if (details.length) {
    console.log('\n═══ 需人工看的明细 ═══');
    for (const d of details) {
      console.log(`\n── ${d.file}  (${d.src})`);
      console.log(`   覆盖 ${(d.coverage * 100).toFixed(0)}%；删 ${d.del} 增 ${d.ins}；${d.groupCount} 处差异组`);
      if (d.memMissing?.length) console.log(`   ⚠ 原件有、改写没有的成员: ${d.memMissing.join('  ')}`);
      if (d.memExtra?.length) console.log(`   ⚠ 改写多出的成员: ${d.memExtra.join('  ')}`);
      if (d.litMissing?.length) console.log(`   ⚠ 原件有、改写没有的字面量: ${d.litMissing.join('  ')}`);
      if (d.litExtra?.length) console.log(`   ⚠ 改写多出的字面量: ${d.litExtra.join('  ')}`);
      if (!d.memChanges.length && !d.litChanges.length) {
        for (const g of d.groups.slice(0, 2)) console.log(`   · 最大改动组 ${g.size} token：${g.sample.join('  ')}`);
      }
    }
  }
}
