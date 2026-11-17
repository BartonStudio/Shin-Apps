// 把原版播放器 CSS（web/styles/*.css）作用域化后合并成 webapp/src/player/ui.css。
//
// 目的：测试页要用原版 UI 骨架（hud/controls/radar/scoreboard/feed/panels/FAB），
// 但这些 CSS 里有 html/body/#app 全局规则，直接 import 会污染 webapp 落地页样式。
// 处理方式（tools 级，供 M3 全量接 UI 复用）：
//   选择器映射：:root → #ui-skel；#viewport → #ui-skel；* → #ui-skel, #ui-skel *
//   丢弃：html/body/#app 裸选择器
//   其余：一律加 "#ui-skel " 后代前缀；@keyframes/@font-face 原样；@media 递归。
//
// 用法：node tools/make-ui-css.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const stylesDir = path.join(import.meta.dirname, '..', 'styles');
const dstFile = path.join(import.meta.dirname, '..', '..', 'webapp', 'src', 'player', 'ui.css');

// 与播放器 UI 骨架相关的样式文件（02-theme 是主题切换组件，测试页用不到）
const SOURCES = [
  '01-misc.css',        // 变量 / 字体
  '10-hud.css',         // 顶部比分条 + 两侧 player-panels
  '12-transport.css',   // 底部传输条 + pov-picker + FAB 变量
  '13-scoreboard.css',  // 计分板
  '14-feed.css',        // 事件流
  '15-radar.css',       // 雷达 + radar-ctrls 按钮
  '16-settings.css',    // 设置面板 + 三个悬浮按钮（FAB）的定位与外观
  '17-overlays.css',    // 覆盖层
  '18-performance.css', // 性能面板
];

const SCOPE = '#ui-skel';
const DROP = new Set(['html', 'body', '#app']);       // 整条丢弃
const MAP = { ':root': SCOPE, '#viewport': SCOPE };   // 整体改写

/** 把一组选择器（已按逗号拆开）映射为作用域化选择器；返回 null = 整条丢弃 */
function mapSelectorList(list) {
  const mapped = [];
  for (let sel of list) {
    sel = sel.trim();
    if (!sel) continue;
    if (DROP.has(sel)) continue;
    if (MAP[sel]) { mapped.push(MAP[sel]); continue; }
    // :root[data-theme="dark"] / #viewport[data-...] 这类带修饰的：替换头部再保留修饰
    if (sel.startsWith(':root')) { mapped.push(sel.replace(':root', SCOPE)); continue; }
    if (sel.startsWith('#viewport')) { mapped.push(sel.replace('#viewport', SCOPE)); continue; }
    if (sel === '*') { mapped.push(SCOPE, SCOPE + ' *'); continue; }
    // @keyframes 内部的百分比帧，不动
    if (/^(\d+%|from|to)$/.test(sel)) { mapped.push(sel); continue; }
    mapped.push(SCOPE + ' ' + sel);
  }
  return mapped.length ? mapped.join(', ') : null;
}

/** 解析一段 CSS 为顶层块数组 {prelude, body, at} */
function parseBlocks(css) {
  const blocks = [];
  let depth = 0, start = 0, preludeStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') { if (depth === 0) { blocks.push({ prelude: css.slice(preludeStart, i).trim(), bodyStart: i + 1 }); } depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0) { const b = blocks[blocks.length - 1]; b.body = css.slice(b.bodyStart, i); b.end = i + 1; }
      if (depth === 0) preludeStart = i + 1;
    } else if (depth === 0 && ch === ';' && css.slice(preludeStart, i).includes('@import')) {
      blocks.push({ prelude: css.slice(preludeStart, i).trim() + ';', end: i + 1, body: null });
      preludeStart = i + 1;
    }
  }
  return blocks;
}

/** 递归作用域化一段 CSS */
function scope(css) {
  let out = '';
  for (const b of parseBlocks(css)) {
    if (b.body == null) { out += (b.prelude ?? '') + '\n'; continue; } // @import
    const prelude = b.prelude;
    if (prelude.startsWith('@keyframes') || prelude.startsWith('@font-face') || prelude.startsWith('@property')) {
      out += prelude + ' {' + b.body + '}\n';
      continue;
    }
    if (prelude.startsWith('@media') || prelude.startsWith('@supports') || prelude.startsWith('@container')) {
      out += prelude + ' {\n' + scope(b.body) + '}\n';
      continue;
    }
    const mapped = mapSelectorList(prelude.split(','));
    if (mapped) out += mapped + ' {' + b.body + '}\n';
  }
  return out;
}

let merged = `/* ⚠️ 生成文件，勿手改：node web/tools/make-ui-css.mjs
 * 来源：web/styles/{${SOURCES.join(', ')}}（原站播放器样式，逐文件切分）
 * 作用域：所有规则限定在 #ui-skel 下，不污染页面其它样式。
 * :root → #ui-skel（CSS 变量跟着骨架根走）；#viewport → #ui-skel。
 */
`;
for (const f of SOURCES) {
  merged += `\n/* ==== ${f} ==== */\n`;
  merged += scope(readFileSync(path.join(stylesDir, f), 'utf8').trim()) + '\n';
}
writeFileSync(dstFile, merged);
console.log('ui.css 已生成:', path.relative(import.meta.dirname, dstFile), `(${(merged.length / 1024).toFixed(0)}KB)`);
