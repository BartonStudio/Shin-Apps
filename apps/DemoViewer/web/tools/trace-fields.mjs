// 字段证据链：对 docs/07 数据契约里的每个字段，找出「谁读它、怎么用」。
//
// 目的：docs/07 的字段类型与语义是「读代码得出的规范」，但没有证据链时无法回答
//   「这个字段真的被用到吗」「它的取值范围由谁保证」「换个类型会不会炸」。
// 本工具把每个字段的消费点抓出来，形成可追溯的证据。
//
// 用法：node tools/trace-fields.mjs            # 人读表格
//      node tools/trace-fields.mjs --markdown   # 直接产出 docs/07 附录用的 markdown
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
const MARKDOWN = process.argv.includes('--markdown');

// 扫描范围：应用层切片 + worker（不含 vendor 的 three.js）
const SCAN_DIRS = ['src/app', 'src/workers'];
const files = [];
for (const d of SCAN_DIRS) {
  for (const f of fs.readdirSync(R(d))) {
    if (f.endsWith('.js')) files.push(`${d}/${f}`);
  }
}
const sources = files.map((f) => ({ file: f, lines: fs.readFileSync(R(f), 'utf8').split(/\r?\n/) }));

// ── 契约字段清单（与 docs/07 §1/§2/§3.2/§4 一一对应）──
const GROUPS = [
  {
    name: 'manifest（会话级，只发一次）',
    hint: 'manifest',
    fields: ['mapName', 'tickRate', 'startTick', 'endTick', 'durationSeconds', 'rounds', 'players', 'weaponNames'],
  },
  {
    name: 'data.meta（每段）',
    hint: 'meta',
    fields: ['startTick', 'tickRate', 'numPlayers', 'sampleRate', 'durationSeconds', 'mapName'],
  },
  {
    name: 'data.frames（逐帧 SoA）',
    hint: 'frames',
    fields: ['frameTick', 'posX', 'posY', 'posZ', 'yaw', 'pitch', 'health', 'alive', 'team', 'score', 'duck', 'flash', 'flashAlpha', 'zoom', 'accuracyPenalty', 'reloading', 'playerFlags'],
  },
  {
    name: 'data.panelFrames（回合级 SoA）',
    hint: 'panelFrames',
    qualifier: 'panelFrames',
    fields: ['frameTick', 'health', 'alive', 'team', 'armor', 'flags', 'money', 'equipValue', 'clipAmmo', 'reserveAmmo', 'activeWeapon', 'utilCounts'],
  },
  {
    name: 'data.players / events / bomb / deathRagdolls',
    hint: 'data',
    fields: ['steamId', 'name', 'clanName', 'color', 'slot', 'crosshairCode', 'tick', 'type', 'attackerSlot', 'victimSlot', 'weapon', 'segments', 'defuses', 'deathRagdolls'],
  },
];

// 找到某字段的所有「成员访问」与「解构」出现点
function findUses(field) {
  const hits = [];
  const memberRe = new RegExp(`\\.${field}\\b`, 'g');
  const destructureRe = new RegExp(`[{,]\\s*${field}\\s*(?::|,|})`, 'g');
  for (const { file, lines } of sources) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      let kind = null;
      memberRe.lastIndex = 0;
      destructureRe.lastIndex = 0;
      if (memberRe.test(line)) kind = 'member';
      else if (destructureRe.test(line)) kind = 'destructure';
      else {
        // 解构跨行（如 `let { a, b, c } = e.frames` 的续行）
        const ctx = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
        if (new RegExp(`=\\s*\\w+\\.frames\\b`).test(ctx) && new RegExp(`\\b${field}\\b`).test(line)) kind = 'destructure';
      }
      if (kind) hits.push({ file, line: i + 1, kind, text: line.trim().slice(0, 130), context: lines.slice(Math.max(0, i - 3), i + 4).join(' ') });
    }
  }
  return hits;
}

// 为每个字段挑最有代表性的 3 处（优先非 worker 的应用层）
function pick(hits, n = 3) {
  const app = hits.filter((h) => h.file.startsWith('src/app'));
  const ordered = [...app, ...hits.filter((h) => !h.file.startsWith('src/app'))];
  return ordered.slice(0, n);
}

// ── 解构别名解析 ──
// `let { panelFrames: o } = e` 之后代码里写的是 `o.health[i]`，纯文本抓不到。
// 先把每个文件里的「panelFrames → 别名」找出来，后面把别名访问也算作命中。
const panelAliases = new Map(); // file -> Set<alias>
for (const { file, lines } of sources) {
  const set = new Set();
  for (const line of lines) {
    for (const m of line.matchAll(/panelFrames\s*:\s*([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  }
  if (set.size) panelAliases.set(file, set);
}

// 「真正的消费者」= 不是产出/解码路径的文件。
//   parser.worker.js  是产出方（malloc/解码/transfer）
//   31-hosted-demo.js 是 CSDA 解码方（readRequiredTypedArray）
// 一个字段若只在这两处出现，说明它被「分配 + 解码 + 传输」但从未被读 —— 即死字段。
const PRODUCER_FILES = new Set(['src/workers/parser.worker.js', 'src/app/31-hosted-demo.js']);
const isConsumer = (h) => !PRODUCER_FILES.has(h.file);

// 通过 panelFrames 别名访问某字段的所有位置
function findViaAlias(field) {
  const hits = [];
  for (const { file, lines } of sources) {
    const aliases = panelAliases.get(file);
    if (!aliases) continue;
    for (let i = 0; i < lines.length; i++) {
      for (const a of aliases) {
        if (new RegExp(`\\b${a}\\.${field}\\b`).test(lines[i])) {
          hits.push({ file, line: i + 1, kind: 'alias', text: lines[i].trim().slice(0, 130), context: lines.slice(Math.max(0, i - 3), i + 4).join(' ') });
        }
      }
    }
  }
  return hits;
}

const rows = [];
for (const g of GROUPS) {
  for (const f of g.fields) {
    const hits = findUses(f);
    // panelFrames 的字段把「经别名访问」的位置也纳入
    if (g.qualifier) hits.push(...findViaAlias(f));
    const consumers = hits.filter(isConsumer);
    // 上下文偏置：panelFrames 的字段优先取上下文里出现 panelFrames 的那几处，
    // 否则 `health` 这类同名字段会错抓成 frames.health，证据链就误导了。
    const hint = g.hint;
    const score = (h) => (h.context?.includes(hint) ? 2 : 0) + (h.file.startsWith('src/app') ? 1 : 0);
    // 显式限定符优先：panelFrames 的字段先找 `panelFrames.<字段>` / `panels.<字段>` 的字面写法，
    // 找到就把它放在主证据位；否则退回通用匹配并标记「同名字段，可能混淆」。
    let explicit = null;
    if (g.qualifier) {
      explicit = (consumers.length ? consumers : hits).find((h) => h.text.includes(`${g.qualifier}.${f}`) || h.context?.includes(`${g.qualifier}.${f}`));
    }
    const ranked = [...(consumers.length ? consumers : hits)].sort((a, b) => score(b) - score(a));
    if (explicit && ranked[0] !== explicit) ranked.unshift(explicit);
    rows.push({
      group: g.name,
      field: f,
      count: hits.length,
      consumerCount: consumers.length,
      dead: hits.length > 0 && consumers.length === 0,
      ambiguous: !!g.qualifier && !explicit,
      samples: ranked,
      producers: pick(hits.filter((h) => !isConsumer(h)), 2),
    });
  }
}

const deadFields = rows.filter((r) => r.dead);
const missing = rows.filter((r) => r.count === 0);

if (MARKDOWN) {
  // 紧凑模式：每字段 1 条最佳证据；完整明细用 --markdown-full
  const FULL = process.argv.includes('--markdown-full');
  const nSamples = FULL ? 3 : 1;
  const ctxLen = FULL ? 76 : 62;
  const out = [];
  let lastGroup = '';
  for (const r of rows) {
    if (r.group !== lastGroup) {
      if (lastGroup) out.push('');
      out.push(`**${r.group}**`);
      out.push('');
      out.push('| 字段 | 结论 | 消费者 | 证据（第一处） |');
      out.push('| --- | --- | ---: | --- |');
      lastGroup = r.group;
    }
    const verdict = r.count === 0
      ? '**❌ 全库无引用**'
      : r.dead
        ? '**⚠️ 只写不读（死字段）**'
        : `读取 ${r.consumerCount} 处`;
    const s = r.samples[0];
    const ev = s ? `\`${s.file}:${s.line}\`<br>\`${s.text.replace(/\|/g, '\\|').slice(0, ctxLen)}\`` : '—';
    out.push(`| \`${r.field}\` | ${verdict} | ${r.count} | ${ev} |`);
    void nSamples;
  }
  console.log(out.join('\n'));
} else {
  for (const r of rows) {
    const mark = r.count === 0 ? '❌' : r.dead ? '⚠️' : '✅';
    console.log(`${mark} ${r.field.padEnd(18)} 共 ${String(r.count).padStart(3)} 处，其中消费者 ${String(r.consumerCount).padStart(2)}`);
    for (const s of r.samples.slice(0, 2)) console.log(`     读 ${s.file}:${s.line}  ${s.text.slice(0, 96)}`);
    if (r.dead) for (const s of r.producers) console.log(`     写 ${s.file}:${s.line}  ${s.text.slice(0, 96)}`);
  }
  console.log(`\n合计 ${rows.length} 个字段`);
  if (deadFields.length) {
    console.log(`\n⚠️ ${deadFields.length} 个字段「只写不读」（被分配/解码/传输，但无人读取）：`);
    for (const r of deadFields) console.log(`   · ${r.group} / ${r.field}`);
  }
  if (missing.length) {
    console.log(`\n❌ ${missing.length} 个字段全库无引用：`);
    for (const r of missing) console.log(`   · ${r.group} / ${r.field}`);
  }
  if (!deadFields.length && !missing.length) console.log('\n✅ 所有字段都有真实消费者');
}
