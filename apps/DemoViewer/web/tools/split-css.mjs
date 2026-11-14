// 把 csdemo.tv 的 index-*.css 按 UI 组件拆分成多个文件，便于逐组件阅读。
// 规则级拆分：普通规则按选择器前缀归类；@media/@container/@supports 内的规则单独归类后重新包裹。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'decompiled', 'index.beautified.css'), 'utf8').replace(/^\uFEFF/, '');
const OUT = path.join(ROOT, 'styles');
fs.mkdirSync(OUT, { recursive: true });

// 顺序敏感：越具体的放前面
const MAP = [
  ['landing-mode', 'landing'],
  ['landing-view', 'landing'],
  ['landing-workspace', 'landing'],
  ['landing-header', 'landing'],
  ['landing-disclaimer', 'landing'],
  ['landing-backdrop', 'landing'],
  ['landing-theme', 'landing'],
  ['phone-wizard', 'landing'],
  ['drop-zone', 'import'],
  ['drop-hint', 'import'],
  ['drop-browse', 'import'],
  ['drop-overlay', 'import'],
  ['drop-screen', 'import'],
  ['drop-content', 'import'],
  ['import-panel', 'import'],
  ['brand', 'landing'],
  ['quality', 'quality'],
  ['recents', 'recents'],
  ['recent-', 'recents'],
  ['hosted', 'hosted'],
  ['loading', 'loading'],
  ['leave-confirm', 'leave-confirm'],
  ['theme-switch', 'theme'],
  ['timeline', 'transport'],
  ['time-elapsed', 'transport'],
  ['time-total', 'transport'],
  ['scrubber', 'transport'],
  ['scrub', 'transport'],
  ['transport', 'transport'],
  ['ctrl', 'transport'],
  ['controls', 'transport'],
  ['segmented', 'transport'],
  ['speed', 'transport'],
  ['pov', 'transport'],
  ['skip', 'transport'],
  ['mobile', 'transport'],
  ['sb-', 'hud'],
  ['sbmap', 'hud'],
  ['scorebar', 'hud'],
  ['hud', 'hud'],
  ['defuse-cue', 'hud'],
  ['nametag', 'hud'],
  ['player-panels', 'panels'],
  ['pp-', 'panels'],
  ['player', 'panels'],
  ['sbd', 'scoreboard'],
  ['scoreboard', 'scoreboard'],
  ['feed', 'feed'],
  ['kl-', 'feed'],
  ['nl-', 'feed'],
  ['kill', 'feed'],
  ['kf', 'feed'],
  ['radar', 'radar'],
  ['settings', 'settings'],
  ['scope', 'overlays'],
  ['blind', 'overlays'],
  ['damage', 'overlays'],
  ['death', 'overlays'],
  ['crosshair', 'overlays'],
  ['performance', 'performance'],
  ['stats', 'performance'],
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

// --- 解析顶层块 ---
const buckets = new Map();
function push(cat, text, media) {
  if (!buckets.has(cat)) buckets.set(cat, []);
  buckets.get(cat).push({ text, media });
}

function splitTop(css) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  const rest = css.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

function splitInner(css) {
  // 去掉最外层花括号内容后按规则切分
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  const rest = css.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

const blocks = splitTop(CSS);
for (const block of blocks) {
  const head = block.slice(0, block.indexOf('{')).trim();
  if (/^@(media|container|supports)/.test(head)) {
    const inner = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
    for (const rule of splitInner(inner)) {
      const selector = rule.slice(0, rule.indexOf('{'));
      push(categorize(selector), rule, head);
    }
  } else if (/^@keyframes/.test(head)) {
    const name = head.replace(/^@keyframes\s+/, '').trim();
    const cat = /^loading/.test(name) ? 'loading' : /logo/.test(name) ? 'landing' : 'misc';
    push(cat, block, null);
  } else if (/^@font-face/.test(head)) {
    push('misc', block, null);
  } else {
    push(categorize(block.slice(0, block.indexOf('{'))), block, null);
  }
}

const ORDER = ['misc', 'theme', 'landing', 'import', 'quality', 'recents', 'hosted', 'loading', 'leave-confirm', 'hud', 'panels', 'transport', 'scoreboard', 'feed', 'radar', 'settings', 'overlays', 'performance'];
let n = 0;
for (const cat of ORDER) {
  const items = buckets.get(cat) ?? [];
  if (!items.length) continue;
  n++;
  const header = [
    '/* ───────────────────────────────────────────────────────────────────────────',
    ` * 组件样式区：${cat} — ${DESC[cat] ?? ''}`,
    ' * 来源：https://csdemo.tv/assets/index-CKB5zRpH.css（按选择器前缀机械拆分，无改写）',
    ' * ─────────────────────────────────────────────────────────────────────────── */',
    '',
  ].join('\n');
  const body = items.map((i) => (i.media ? `${i.media} {\n${i.text}\n}` : i.text)).join('\n');
  fs.writeFileSync(path.join(OUT, `${String(n).padStart(2, '0')}-${cat}.css`), header + body + '\n', 'utf8');
}
console.log('buckets:', [...buckets].map(([k, v]) => `${k}=${v.length}`).join(' '));
