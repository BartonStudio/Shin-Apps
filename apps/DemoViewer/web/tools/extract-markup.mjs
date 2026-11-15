// 从主 bundle 里把 `innerHTML = `...`` 的大 HTML 模板抠成独立文件，放进 src/markup/。
//
// 为什么需要：完整 DOM 结构都写在切片里的模板字符串中（210 处 createElement + 177 处 className
// 赋值是命令式构建，12 处大 innerHTML 是声明式模板）。切片是逐字完整的，但要在 53 504 行里
// 翻 innerHTML 不方便；抠成独立文件后改 UI 时可直接对照。
//
// 命名规则：取模板之前最近的 class / function 声明名，加上在 bundle 中的行号。
// 已存在的文件（按内容指纹）会被跳过，不会覆盖手改过的版本。
//
// 用法：node tools/extract-markup.mjs [--dry] [--min 150]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
const DRY = process.argv.includes('--dry');
const MIN = Number(process.argv.includes('--min') ? process.argv[process.argv.indexOf('--min') + 1] : 150);

const bundle = fs.readFileSync(R('decompiled/index.beautified.js'), 'utf8');
const lines = bundle.split(/\r?\n/);
const lineOf = (idx) => (bundle.slice(0, idx).match(/\n/g) || []).length + 1;

// ── 抽出所有 `innerHTML = `...`` 模板（正确处理转义、${} 嵌套、嵌套模板）──
function extractTemplates(src) {
  const out = [];
  const re = /\.innerHTML\s*=\s*`/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let buf = '';
    const start = i;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') { buf += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
      if (ch === '$' && src[i + 1] === '{') { depth++; buf += '${'; i += 2; continue; }
      if (ch === '}' && depth > 0) { depth--; buf += '}'; i++; continue; }
      if (ch === '`' && depth === 0) break;
      buf += ch;
      i++;
    }
    out.push({ start, end: i, text: buf, line: lineOf(m.index) });
  }
  return out;
}

// ── 找模板所在的作用域名（最近的 class / function / var X = class）──
function scopeNameAt(src, idx) {
  const before = src.slice(0, idx);
  const pats = [
    /var\s+([A-Za-z_$][\w$]*)\s*=\s*class\s*[{]/g,
    /([A-Za-z_$][\w$]*)\s*=\s*class\s*[{]/g,
    /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
  ];
  for (const p of pats) {
    let m;
    let last = null;
    p.lastIndex = 0;
    while ((m = p.exec(before))) last = m[1];
    if (last && last.length > 1 && !/^(if|for|while|switch|catch|return)$/.test(last)) return last;
  }
  return 'anonymous';
}

// ── 推断文件名：优先用模板里出现的 landmark class 名 ──
const LANDMARKS = [
  ['sb-', 'scorebar'],
  ['sbd', 'scoreboard'],
  ['pp-', 'player-panels'],
  ['feed', 'event-feed'],
  ['radar', 'radar'],
  ['hosted', 'hosted-picker'],
  ['recents', 'recents'],
  ['settings', 'settings-panel'],
  ['performance', 'performance-panel'],
  ['leave-confirm', 'leave-confirm'],
  ['landing', 'landing'],
  ['drop-', 'drop-zone'],
  ['loading', 'loading-card'],
  ['controls', 'transport-controls'],
  ['pov', 'pov-picker'],
  ['nametag', 'nametags'],
  ['scope', 'scope-overlay'],
  ['timeline', 'timeline'],
];
// 按 bundle 行号手工修正的名字（自动推断对下列情况不适用）
const NAME_OVERRIDES = {
  51186: 'page-shell',        // 整页骨架：viewport + drop-screen + landing + 各 overlay，不只是 hosted 选择器
  45996: 'event-feed-row',    // .kl-time / .nl-badge —— 事件面板的一行
  45522: 'player-panel-outer', // 玩家面板外层壳（内层是 L45496 的 g 模板）
};

function guessName(text, scope, line) {
  if (NAME_OVERRIDES[line]) return NAME_OVERRIDES[line];
  const lower = text.toLowerCase();
  // 1) 优先用模板里最外层元素的 class（这才是组件的真实身份）
  const outer = /^\s*<([a-z][\w-]*)\b[^>]*\bclass\s*=\s*["'`]([^"'`]+)/i.exec(text);
  if (outer) {
    const firstClass = outer[2].trim().split(/\s+/)[0];
    if (firstClass && firstClass.length >= 3 && !/^[a-z]{1,2}$/.test(firstClass)) {
      return firstClass.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    }
  }
  // 2) 退到 landmark 关键字
  for (const [needle, name] of LANDMARKS) if (lower.includes(needle)) return name;
  // 3) 退到作用域名（要求够长、不是压缩噪声）
  const cleaned = scope.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (cleaned.length >= 4) return cleaned;
  // 4) 最后用行号，保证可追溯
  return `template-l${line}`;
}

const tpls = extractTemplates(bundle).filter((t) => t.text.length >= MIN);
tpls.sort((a, b) => b.text.length - a.text.length);

const dir = R('src/markup/templates'); // 逐字模板；src/markup/ 根下是人工组装的「带上下文」版本
fs.mkdirSync(dir, { recursive: true });

// 已存在文件的指纹（用于跳过已抠过的）。注意要剥掉我们自己加的头部注释，
// 否则同一个模板会被再抠一次、生成重复文件。
const stripHeaderComment = (t) => t.replace(/^<!--[\s\S]*?-->\s*/, '');
const existing = new Map();
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.html')) continue;
  const t = stripHeaderComment(fs.readFileSync(path.join(dir, f), 'utf8'));
  existing.set(t.replace(/\s+/g, ' ').trim(), f);
}

const used = new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.html')));
const results = [];

for (const t of tpls) {
  const norm = t.text.replace(/\s+/g, ' ').trim();
  if (existing.has(norm)) { results.push({ line: t.line, len: t.text.length, file: existing.get(norm), action: 'skip(已存在)' }); continue; }
  const scope = scopeNameAt(bundle, t.start);
  let base = guessName(t.text, scope, t.line);
  // 去重
  let name = `${base}.html`;
  let k = 2;
  while (used.has(name)) name = `${base}-${k++}.html`;
  used.add(name);

  const header = `<!-- 来源：${'decompiled/index.beautified.js'} 第 ${t.line} 行（innerHTML 模板，${t.text.length} 字符）
     所在作用域：${scope}
     说明：原文逐字抠出，仅去掉外层反引号；\${...} 表达式保持原样，未求值。 -->\n`;
  const content = header + t.text + '\n';
  if (!DRY) fs.writeFileSync(path.join(dir, name), content, 'utf8');
  results.push({ line: t.line, len: t.text.length, file: name, action: DRY ? 'dry' : 'wrote' });
}

console.log(`bundle 中 innerHTML 模板（≥${MIN} 字符）：${tpls.length} 个\n`);
console.log('行号      字符数  动作          文件');
console.log('─'.repeat(72));
for (const r of results) {
  console.log(`${String(r.line).padEnd(9)} ${String(r.len).padStart(6)}  ${r.action.padEnd(12)} ${r.file}`);
}
const wrote = results.filter((r) => r.action === 'wrote').length;
console.log('─'.repeat(72));
console.log(`新抠出 ${wrote} 个；src/markup 现有 ${fs.readdirSync(dir).filter((f) => f.endsWith('.html')).length} 个 HTML 文件`);
