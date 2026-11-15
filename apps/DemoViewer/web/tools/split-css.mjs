// 把 csdemo.tv 的 index-*.css 按 UI 组件拆分成多个文件，便于逐组件阅读。
//
// 规则级拆分：普通规则按选择器前缀归类；@media/@container/@supports 内的规则单独归类后重新包裹，
// 使其在每个组件文件里都是合法 CSS。
//
// ★ 无损可逆：同时产出 styles/_manifest.json，逐条记录「原始顺序 order / 所在文件 file /
//   文件内顶层块序号 ordinal / 原始前导空白 lead / 所属 at-rule 实例 atId」，
//   以及每个 at-rule 实例的 prelude 与收尾空白 tail。
//   配合 tools/reassemble-css.mjs 可**逐字节**拼回 decompiled/index.beautified.css。
import fs from 'node:fs';
import path from 'node:path';
import { parseCss } from './css-toplevel.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = 'decompiled/index.beautified.css';
const CSS = fs.readFileSync(path.join(ROOT, SRC), 'utf8').replace(/^\uFEFF/, '');
const OUT = path.join(ROOT, 'styles');
fs.mkdirSync(OUT, { recursive: true });

// 顺序敏感：越具体的放前面
const MAP = [
  ['landing-mode', 'landing'], ['landing-view', 'landing'], ['landing-workspace', 'landing'],
  ['landing-header', 'landing'], ['landing-disclaimer', 'landing'], ['landing-backdrop', 'landing'],
  ['landing-theme', 'landing'], ['phone-wizard', 'landing'],
  ['drop-zone', 'import'], ['drop-hint', 'import'], ['drop-browse', 'import'], ['drop-overlay', 'import'],
  ['drop-screen', 'import'], ['drop-content', 'import'], ['import-panel', 'import'],
  ['brand', 'landing'], ['quality', 'quality'], ['recents', 'recents'], ['recent-', 'recents'],
  ['hosted', 'hosted'], ['loading', 'loading'], ['leave-confirm', 'leave-confirm'], ['theme-switch', 'theme'],
  ['timeline', 'transport'], ['time-elapsed', 'transport'], ['time-total', 'transport'],
  ['scrubber', 'transport'], ['scrub', 'transport'], ['transport', 'transport'], ['ctrl', 'transport'],
  ['controls', 'transport'], ['segmented', 'transport'], ['speed', 'transport'], ['pov', 'transport'],
  ['skip', 'transport'], ['mobile', 'transport'],
  ['sb-', 'hud'], ['sbmap', 'hud'], ['scorebar', 'hud'], ['hud', 'hud'], ['defuse-cue', 'hud'], ['nametag', 'hud'],
  ['player-panels', 'panels'], ['pp-', 'panels'], ['player', 'panels'],
  ['sbd', 'scoreboard'], ['scoreboard', 'scoreboard'],
  ['feed', 'feed'], ['kl-', 'feed'], ['nl-', 'feed'], ['kill', 'feed'], ['kf', 'feed'],
  ['radar', 'radar'], ['settings', 'settings'],
  ['scope', 'overlays'], ['blind', 'overlays'], ['damage', 'overlays'], ['death', 'overlays'], ['crosshair', 'overlays'],
  ['performance', 'performance'], ['stats', 'performance'],
];

const DESC = {
  landing: '落地页骨架 / 品牌 / 模式切换 / 3D 背景层',
  import: '上传区（拖拽投放 / Release to load demo / 文件选择）',
  quality: 'Playback detail（16/32/64 Hz）',
  recents: 'On this device 最近场次卡片',
  hosted: '职业比赛三段式选择器',
  loading: 'Opening demo 加载卡与进度条',
  'leave-confirm': 'Leave demo? 解析中离开确认',
  theme: '明暗主题按钮',
  transport: '播放控制条：进度、章节、倍速、POV、跳转',
  hud: '玩家 HUD：比分条、拆包提示、nametag',
  panels: '左右玩家面板',
  scoreboard: '计分板',
  feed: '回合事件面板（击杀/道具）',
  radar: '2D 雷达',
  settings: '设置面板',
  overlays: '全屏叠加层：开镜/致盲/受击/死亡回放/准星',
  performance: '性能面板',
  misc: '全局变量、基础排版、滚动条、杂项',
};

function categorize(selector) {
  const s = selector.toLowerCase();
  for (const [needle, cat] of MAP) if (s.includes(needle)) return cat;
  return 'misc';
}

const nodes = parseCss(CSS);

// ── 展开成「可归类的最小单元」 ──
// item = { order, cat, kind:'rule'|'at-inner', lead, body, atId?, atLead?, atPrelude?, atTail?, media? }
const items = [];
let order = 0;
const atRules = new Map(); // atId -> { lead, prelude, tail }

for (const n of nodes) {
  if (n.kind === 'ws') continue; // 纯空白尾巴不参与归类（还原由 tail/末尾 ws 处理）
  if (n.kind === 'rule') {
    const head = n.body.slice(0, n.body.indexOf('{'));
    let cat;
    if (/^@keyframes/.test(n.body.trim())) {
      const name = head.replace(/^@keyframes\s+/, '').trim();
      cat = /^loading/.test(name) ? 'loading' : /logo/.test(name) ? 'landing' : 'misc';
    } else if (/^@font-face/.test(n.body.trim())) {
      cat = 'misc';
    } else {
      cat = categorize(head);
    }
    items.push({ order: order++, cat, kind: 'rule', lead: n.lead, body: n.body });
  } else {
    const atId = `at${atRules.size}`;
    atRules.set(atId, { lead: n.lead, head: n.prelude.trimEnd().replace(/\s*\{$/, ''), prelude: n.prelude, tail: n.tail });
    for (const i of n.inner) {
      if (!i.body) continue;
      const sel = i.body.slice(0, i.body.indexOf('{'));
      items.push({
        order: order++, cat: categorize(sel), kind: 'at-inner',
        lead: i.lead, body: i.body, atId, media: n.prelude.trimEnd().replace(/\s*\{$/, ''),
      });
    }
  }
}

// ── 分桶 & 写文件 ──
const ORDER = ['misc', 'theme', 'landing', 'import', 'quality', 'recents', 'hosted', 'loading', 'leave-confirm', 'hud', 'panels', 'transport', 'scoreboard', 'feed', 'radar', 'settings', 'overlays', 'performance'];
const buckets = new Map();
for (const it of items) {
  if (!buckets.has(it.cat)) buckets.set(it.cat, []);
  buckets.get(it.cat).push(it);
}

let n = 0;
const fileOfCat = new Map();
const manifestItems = [];
const sorted = items.slice().sort((a, b) => a.order - b.order);
const ordinalCursor = new Map();

for (const cat of ORDER) {
  const list = buckets.get(cat) ?? [];
  if (!list.length) continue;
  n++;
  const fileName = `styles/${String(n).padStart(2, '0')}-${cat}.css`;
  fileOfCat.set(cat, fileName);
  const header = [
    '/* ───────────────────────────────────────────────────────────────────────────',
    ` * 组件样式区：${cat} — ${DESC[cat] ?? ''}`,
    ` * 来源：${SRC}（按选择器前缀机械拆分，未改任何声明）`,
    ' * ★ 可逆：node tools/reassemble-css.mjs 会依 styles/_manifest.json 逐字节拼回原文',
    ' * ─────────────────────────────────────────────────────────────────────────── */',
    '',
  ].join('\n');
  const body = list.map((i) => (i.kind === 'at-inner' ? `${i.media} {\n${i.body}\n}` : i.body)).join('\n');
  fs.writeFileSync(path.join(OUT, fileName.replace('styles/', '')), header + body + '\n', 'utf8');
}

// ── manifest ──
for (const it of sorted) {
  const file = fileOfCat.get(it.cat);
  const ord = ordinalCursor.get(it.cat) ?? 0;
  ordinalCursor.set(it.cat, ord + 1);
  const rec = { order: it.order, file, ordinal: ord, lead: it.lead };
  if (it.kind === 'at-inner') {
    const at = atRules.get(it.atId);
    rec.atId = it.atId;
    rec.atHead = at.head;
    rec.atPrelude = at.prelude;
    rec.atLead = at.lead;
    rec.atTail = at.tail;
  }
  manifestItems.push(rec);
}

// 末尾若存在纯空白 ws 节点，单独记下来
const trailingWs = nodes.filter((x) => x.kind === 'ws').map((x) => x.lead).join('');

fs.writeFileSync(
  path.join(OUT, '_manifest.json'),
  JSON.stringify(
    {
      source: SRC,
      generatedAt: new Date().toISOString(),
      ruleCount: manifestItems.length,
      trailingWs,
      files: ORDER.filter((c) => buckets.has(c)).map((c) => `styles/${fileOfCat.get(c)}`),
      note:
        '每条记录：order=在原文中的先后；file/ordinal=落在哪个文件的第几个顶层块；lead=该块之前的原始空白；' +
        'atId/atPrelude/atLead/atTail 仅对原本在 @media 等 at-rule 内的规则存在。' +
        'reassemble-css.mjs 依此逐字节还原，可用 node tools/reassemble-css.mjs 自证。',
      items: manifestItems,
    },
    null,
    2,
  ),
  'utf8',
);

console.log('buckets:', [...buckets].map(([k, v]) => `${k}=${v.length}`).join(' '));
console.log(`写出 ${n} 个样式文件 + _manifest.json（${manifestItems.length} 条规则，${atRules.size} 个 at-rule 实例）`);
