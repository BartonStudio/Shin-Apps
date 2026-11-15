// 校验一个 CSDF v1 二进制分段是否符合 docs/07 数据契约。
// 这是给 C++ 侧用的自检工具：输出通过 = 格式对得上播放器要求。
//
// 用法：
//   node tools/validate-fixture-data.mjs fixtures/segment-000.bin
//   node tools/validate-fixture-data.mjs <任意 .bin>
//   node tools/validate-fixture-data.mjs <file> --json     # 机器可读
import fs from 'node:fs';
import path from 'node:path';
import {
  MAGIC, VERSION, HEADER_BYTES, ALIGN,
  FLAG_ACCURACY, FLAG_RELOADING, FLAG_PLAYER_FLAGS, FLAG_PANELS, FLAG_SPEED, FLAG_SMOOTH_SPEED,
  FRAME_COLS, FRAME_OPT_COLS, PANEL_COLS,
  computeLayout, crc32, CONSTRAINTS,
} from './csdf-format.mjs';

const file = process.argv[2];
const asJson = process.argv.includes('--json');
if (!file) {
  console.error('用法: node tools/validate-fixture-data.mjs <file.bin> [--json]');
  process.exit(2);
}

const problems = [];
const warns = [];
const fail = (m) => problems.push(m);
const warn = (m) => warns.push(m);

const buf = fs.readFileSync(path.resolve(file));

// ── Header ──
if (buf.length < HEADER_BYTES) {
  console.log(`FAIL 文件不足 ${HEADER_BYTES} 字节（${buf.length}）`);
  process.exit(1);
}
const h = {
  magic: buf.readUInt32LE(0),
  version: buf.readUInt32LE(4),
  startTick: buf.readInt32LE(8),
  endTick: buf.readInt32LE(12),
  numFrames: buf.readInt32LE(16),
  numPlayers: buf.readInt32LE(20),
  panelNumFrames: buf.readInt32LE(24),
  flags: buf.readInt32LE(28),
  crc32: buf.readUInt32LE(32),
  payloadBytes: Number(buf.readBigUInt64LE(40)),
  totalBytes: Number(buf.readBigUInt64LE(48)),
};

if (h.magic !== MAGIC) fail(`magic 错误：0x${h.magic.toString(16)}（应为 0x${MAGIC.toString(16)} "CSDF"）`);
if (h.version !== VERSION) fail(`version ${h.version} 不受支持（应为 ${VERSION}）`);
if (h.numFrames <= 0) fail(`numFrames=${h.numFrames} 必须 > 0`);
if (h.numPlayers <= 0) fail(`numPlayers=${h.numPlayers} 必须 > 0`);
if (h.endTick <= h.startTick) fail(`endTick(${h.endTick}) 必须大于 startTick(${h.startTick})`);
if (h.totalBytes !== buf.length) fail(`header.totalBytes=${h.totalBytes} 与实际文件长 ${buf.length} 不符`);
if (h.payloadBytes !== buf.length - HEADER_BYTES) fail(`header.payloadBytes=${h.payloadBytes} 应为 ${buf.length - HEADER_BYTES}`);
if (h.flags & FLAG_PANELS) {
  if (h.panelNumFrames <= 0) fail(`flags 声明含 panelFrames，但 panelNumFrames=${h.panelNumFrames}`);
} else if (h.panelNumFrames !== 0) {
  warn(`flags 未声明 panelFrames，但 panelNumFrames=${h.panelNumFrames}（将被忽略）`);
}

// ── 布局 ──
const layout = computeLayout(h);
if (layout.totalBytes !== buf.length) {
  fail(`按 numFrames/numPlayers/flags 推算的文件长 ${layout.totalBytes} 与实际 ${buf.length} 不符（列顺序或对齐有误）`);
}

// ── CRC ──
if (buf.length > HEADER_BYTES) {
  const actual = crc32(buf.subarray(HEADER_BYTES));
  if (actual !== h.crc32) fail(`payloadCrc32 不匹配：文件内 0x${h.crc32.toString(16)}，实算 0x${actual.toString(16)}`);
}

// ── 逐列读值 ──
const N = h.numFrames;
const P = h.numPlayers;
const M = h.flags & FLAG_PANELS ? h.panelNumFrames : 0;
const colData = new Map();
const blockByName = new Map(layout.blocks.map((b) => [b.name, b]));

function readCol(name, type, count) {
  const blk = blockByName.get(name);
  if (!blk) return null;
  const base = blk.offset;
  let arr;
  if (type === 'f32') {
    arr = new Float32Array(buf.buffer, buf.byteOffset + base, count);
  } else if (type === 'i32') {
    arr = new Int32Array(buf.buffer, buf.byteOffset + base, count);
  } else if (type === 'u16') {
    arr = new Uint16Array(buf.buffer, buf.byteOffset + base, count);
  } else {
    arr = new Uint8Array(buf.buffer, buf.byteOffset + base, count);
  }
  colData.set(name, arr);
  return arr;
}

const readAll = () => {
  for (const [n, t, b] of FRAME_COLS) readCol(n, t, b === 'TICK' ? N : N * P);
  for (const [n, t, b, f] of FRAME_OPT_COLS) if (h.flags & f) readCol(n, t, b === 'TICK' ? N : N * P);
  if (h.flags & FLAG_PANELS) for (const [n, t, b] of PANEL_COLS) readCol(n, t, b === 'PTICK' ? M : M * P);
};

if (problems.length === 0) readAll();

// ── 值域与单调性 ──
const inSet = (v, set) => set.includes(v);
const inRange = (v, [lo, hi]) => v >= lo && v <= hi;

if (colData.size) {
  // frameTick 严格升序
  const ft = colData.get('frameTick');
  if (!(ft instanceof Int32Array)) fail('frameTick 缺失或类型错误');
  else {
    for (let i = 1; i < ft.length; i++) {
      if (ft[i] <= ft[i - 1]) { fail(`frameTick 非严格升序：索引 ${i} 处 ${ft[i - 1]} → ${ft[i]}`); break; }
    }
    if (ft[0] !== h.startTick) fail(`frameTick[0]=${ft[0]} 应等于 startTick=${h.startTick}`);
    if (ft[ft.length - 1] !== h.endTick) fail(`frameTick[末]=${ft[ft.length - 1]} 应等于 endTick=${h.endTick}`);
    // 与采样率相关的间隔检查
    const gaps = new Set();
    for (let i = 1; i < Math.min(ft.length, 200); i++) gaps.add(ft[i] - ft[i - 1]);
    const bad = [...gaps].filter((g) => g <= 0 || g > 64);
    if (bad.length) warn(`frameTick 间隔异常：${bad.slice(0, 5).join(',')}（6~64 tick 为正常采样间隔）`);
  }

  // 逐列统计
  const checkSet = (name, set) => {
    const a = colData.get(name);
    if (!a) return;
    const bad = new Map();
    for (let i = 0; i < a.length; i++) if (!inSet(a[i], set)) bad.set(a[i], (bad.get(a[i]) ?? 0) + 1);
    if (bad.size) fail(`${name} 含非法值：${[...bad.entries()].slice(0, 5).map(([v, c]) => `${v}(${c}处)`).join(', ')}（允许 ${set.join('/')}）`);
  };
  const checkRange = (name, range) => {
    const a = colData.get(name);
    if (!a) return;
    let lo = Infinity, hi = -Infinity, nonFinite = 0;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) { nonFinite++; continue; }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (nonFinite) fail(`${name} 含 ${nonFinite} 个非有限值（NaN/Inf）`);
    if (lo < range[0] || hi > range[1]) fail(`${name} 值域 [${lo}, ${hi}] 超出允许 [${range[0]}, ${range[1]}]`);
  };

  checkSet('team', CONSTRAINTS.team);
  checkSet('alive', CONSTRAINTS.alive);
  checkSet('zoom', CONSTRAINTS.zoom);
  checkRange('health', CONSTRAINTS.health);
  checkRange('duck', CONSTRAINTS.duck);
  checkRange('yaw', CONSTRAINTS.yawDeg);
  checkRange('pitch', CONSTRAINTS.pitchDeg);
  checkRange('posX', [-1e6, 1e6]);
  checkRange('posY', [-1e6, 1e6]);
  checkRange('posZ', [-1e6, 1e6]);

  // 可选列
  if (h.flags & FLAG_ACCURACY) {
    const a = colData.get('accuracyPenalty');
    let noData = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === -1) noData++;
    if (noData === 0) warn('accuracyPenalty 全不为 -1：若无数据应填 -1（docs/07 陷阱 8）');
    for (let i = 0; i < a.length; i++) if (a[i] !== -1 && !(a[i] >= 0)) { fail(`accuracyPenalty[${i}]=${a[i]} 非法（应 ≥0 或 = -1）`); break; }
  }
  if (h.flags & FLAG_RELOADING) checkSet('reloading', [0, 1]);
  if (h.flags & FLAG_PLAYER_FLAGS) checkRange('playerFlags', [0, 255]);
  if (h.flags & FLAG_SPEED) checkRange('speed', CONSTRAINTS.speed);
  if (h.flags & FLAG_SMOOTH_SPEED) checkRange('smoothSpeed', CONSTRAINTS.smoothSpeed);

  // panelFrames
  if (h.flags & FLAG_PANELS) {
    const pt = colData.get('panelFrameTick');
    for (let i = 1; i < pt.length; i++) {
      if (pt[i] <= pt[i - 1]) { fail(`panelFrameTick 非严格升序：索引 ${i}`); break; }
    }
    checkSet('panelAlive', [0, 1]);
    checkSet('panelTeam', CONSTRAINTS.team);
    checkRange('panelHealth', [0, 100]);
    checkRange('panelArmor', [0, 255]);
    // 与 frames 的 tick 集合是否相同（不同是合法的，但值得报告）
    const fSet = new Set(ft);
    const sameTicks = pt.every((t) => fSet.has(t));
    if (!sameTicks) {
      warn(`panelFrames 的 tick 集合与 frames 不同 —— 这是**合法**的（两者独立构建），播放器用两套查找分别处理`);
    }
  }
}

// ── 输出 ──
const report = {
  file: path.basename(file),
  bytes: buf.length,
  header: h,
  layout: layout.blocks.map((b) => ({ ...b })),
  problems,
  warns,
  ok: problems.length === 0,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`校验 ${path.basename(file)}（${buf.length} 字节）`);
  console.log(`  header: magic=CSDF v${h.version} ticks ${h.startTick}..${h.endTick} N=${h.numFrames} P=${h.numPlayers} M=${h.panelNumFrames} flags=0x${h.flags.toString(16)}`);
  console.log(`  列块: ${layout.blocks.length} 个`);
  if (problems.length === 0) console.log(`\n  ✅ 全部 ${problems.length === 0 ? '通过' : ''}——格式符合 docs/07 数据契约`);
  if (warns.length) {
    console.log(`\n  ⚠ ${warns.length} 条提示：`);
    for (const w of warns) console.log(`     · ${w}`);
  }
  if (problems.length) {
    console.log(`\n  ❌ ${problems.length} 处违反契约：`);
    for (const p of problems) console.log(`     · ${p}`);
  }
}
process.exitCode = problems.length ? 1 : 0;
