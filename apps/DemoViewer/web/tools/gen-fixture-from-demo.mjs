// 从真实 .dem 生成 CSDF v1 参照数据（替换掉早期的合成假数据）。
//
// 为什么重要：合成的 fixture 只能验证「我的理解和我的实现是否自洽」，
// 不能验证「我的理解对不对」。用真实 demo 解析出来的数据，C++ 侧对照实现才有意义。
//
// 做法：在 Node 里驱动 raw/assets 里的 wasm（复用 worker 的胶水），
// 解析 demo → 截取一个时间窗 → 按 docs/07 附录 A 的 CSDF v1 格式写出。
//
// 用法：
//   node tools/gen-fixture-from-demo.mjs                     # 默认窗口：前 30 秒
//   node tools/gen-fixture-from-demo.mjs --start 200 --seconds 30
//   node tools/gen-fixture-from-demo.mjs --verify            # 只校验不改盘
import fs from 'node:fs';
import path from 'node:path';
import { MAGIC, VERSION, HEADER_BYTES, FLAG_ACCURACY, FLAG_RELOADING, FLAG_PLAYER_FLAGS, FLAG_PANELS, FLAG_SPEED, FLAG_SMOOTH_SPEED, FRAME_COLS, FRAME_OPT_COLS, PANEL_COLS, computeLayout, crc32 } from './csdf-format.mjs';
import { computeSpeedColumns } from '../src/deobfuscated/speed-columns.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);

import {
  REPO_ROOT as P_ROOT, needDemo, tmpDir, tmpFile, imagePath, sidecarPath,
  goldenPath, needFile, opt, hasFlag, wantsHelp, printUsage, COMMON_OPTIONS,
} from './paths.mjs';

if (wantsHelp()) {
  printUsage('tools/gen-fixture-from-demo.mjs',
    '从真实 demo 生成 fixtures/ 下的 CSDF 参照数据',
    [COMMON_OPTIONS.demo, ['--out <dir>', '输出目录（默认 <repo>/fixtures）'],
     ['--start <秒>', '起始位置（默认 0）'], ['--seconds <n>', '截取时长（默认 30）'],
     ['--rate <16|32|64>', '采样率（默认 64）'], COMMON_OPTIONS.help],
    ['node tools/gen-fixture-from-demo.mjs',
     'node tools/gen-fixture-from-demo.mjs --demo D:\\demos\\match.dem --out D:\\out --seconds 60']);
  process.exit(0);
}

// demo 路径：--demo > $CSDEMO_DEM > <repo>/test.dem
const DEMO = needFile(needDemo(), 'demo 文件', '--demo', 'CSDEMO_DEM');
const OUT_DIR = opt('out') ? path.resolve(opt('out')) : path.join(REPO_ROOT, 'fixtures');
const START_SEC = Number(opt('start') ?? 0);
const SECONDS = Number(opt('seconds') ?? 30);
const SAMPLE_RATE = Number(opt('rate') ?? 64);

// ── 1. 准备可在 Node 运行的 worker ──
function buildRunnableWorker() {
  let src = fs.readFileSync(R('src/workers/parser.worker.js'), 'utf8');
  src = src.replace(/At\.onmessage = async \(e\) => \{[\s\S]*?\n\}\n?$/, '\n');
  src += `\nexport { lt as initParser, Ue as parseHeaderRaw, gt as parseDemoCore, kt as WASM_URL };\n`;
  fs.mkdirSync(R('tmp'), { recursive: true });
  fs.writeFileSync(tmpFile('worker-runnable.mjs'), src, 'utf8');
  return 'file:///' + R('tmp/worker-runnable.mjs').replace(/\\/g, '/');
}

globalThis.self = { onmessage: null, postMessage: () => {}, close: () => {} };
const modUrl = buildRunnableWorker();
const w = await import(modUrl);

const wasmBytes = fs.readFileSync(R('raw/assets/csplayer_parser_bg-qigVgicw.wasm'));
const quiet = console.warn;
console.warn = () => {};
await w.initParser({ module_or_path: new Response(wasmBytes, { headers: { 'Content-Type': 'application/wasm' } }) });
console.warn = quiet;
console.log(`wasm 已实例化；开始解析 ${DEMO}（采样率 ${SAMPLE_RATE} Hz）…`);

// ── 2. 解析 ──
const demoBytes = new Uint8Array(fs.readFileSync(DEMO));
const t0 = Date.now();
let manifest = null;
const { data } = w.parseDemoCore(demoBytes, { sampleRate: SAMPLE_RATE }, { onManifest: (mf) => { manifest = mf; } });
// 计算速度两列（生产者层，不在渲染层算）。原 worker 不产这两列，所以在这里补。
const tSpeed = Date.now();
computeSpeedColumns(data);
console.log(`解析完成：${((Date.now() - t0) / 1000).toFixed(1)}s（其中速度列 ${Date.now() - tSpeed}ms）；${manifest.mapName}，${manifest.rounds.length} 个回合`);

// ── 3. 截取窗口 ──
const F = data.frames, P = data.panelFrames, NPLAYERS = data.meta.numPlayers;
const baseTick = data.meta.startTick;
const winStart = baseTick + Math.round(START_SEC * data.meta.tickRate);
const winEnd = winStart + Math.round(SECONDS * data.meta.tickRate);

const frameIdx = [];
for (let i = 0; i < F.frameTick.length; i++) if (F.frameTick[i] >= winStart && F.frameTick[i] <= winEnd) frameIdx.push(i);
const panelIdx = [];
for (let i = 0; i < P.frameTick.length; i++) if (P.frameTick[i] >= winStart && P.frameTick[i] <= winEnd) panelIdx.push(i);

const n = frameIdx.length, m = panelIdx.length;
if (n < 2) { console.error(`窗口内只有 ${n} 帧，请换 --start`); process.exit(1); }

// ── 4. 按 CSDF 提取列 ──
const sliceNP = (arr, idx) => {
  const out = new (arr.constructor)(idx.length * NPLAYERS);
  idx.forEach((fi, k) => { for (let p = 0; p < NPLAYERS; p++) out[k * NPLAYERS + p] = arr[fi * NPLAYERS + p]; });
  return out;
};
const flags = FLAG_ACCURACY | FLAG_RELOADING | FLAG_PLAYER_FLAGS | FLAG_PANELS | FLAG_SPEED | FLAG_SMOOTH_SPEED;

const Fcols = {
  frameTick: Int32Array.from(frameIdx, (i) => F.frameTick[i]),
  posX: sliceNP(F.posX, frameIdx), posY: sliceNP(F.posY, frameIdx), posZ: sliceNP(F.posZ, frameIdx),
  yaw: sliceNP(F.yaw, frameIdx), pitch: sliceNP(F.pitch, frameIdx),
  health: sliceNP(F.health, frameIdx), alive: sliceNP(F.alive, frameIdx), team: sliceNP(F.team, frameIdx), score: sliceNP(F.score, frameIdx),
  duck: sliceNP(F.duck, frameIdx), flash: sliceNP(F.flash, frameIdx), flashAlpha: sliceNP(F.flashAlpha, frameIdx),
  zoom: sliceNP(F.zoom, frameIdx),
  accuracyPenalty: sliceNP(F.accuracyPenalty, frameIdx),
  reloading: sliceNP(F.reloading, frameIdx),
  playerFlags: sliceNP(F.playerFlags, frameIdx),
  speed: sliceNP(F.speed, frameIdx),
  smoothSpeed: sliceNP(F.smoothSpeed, frameIdx),
};
const Pcols = {
  panelFrameTick: Int32Array.from(panelIdx, (i) => P.frameTick[i]),
  panelHealth: sliceNP(P.health, panelIdx), panelAlive: sliceNP(P.alive, panelIdx), panelTeam: sliceNP(P.team, panelIdx),
  panelArmor: sliceNP(P.armor, panelIdx), panelFlags: sliceNP(P.flags, panelIdx),
  panelMoney: sliceNP(P.money, panelIdx), panelEquipValue: sliceNP(P.equipValue, panelIdx),
  panelClipAmmo: sliceNP(P.clipAmmo, panelIdx), panelReserveAmmo: sliceNP(P.reserveAmmo, panelIdx),
  panelActiveWeapon: sliceNP(P.activeWeapon, panelIdx), panelUtilCounts: sliceNP(P.utilCounts, panelIdx),
};

// ── 5. 写 CSDF ──
const layout = computeLayout({ numFrames: n, numPlayers: NPLAYERS, panelNumFrames: m, flags });
const buf = Buffer.alloc(layout.totalBytes);
buf.writeUInt32LE(MAGIC, 0);
buf.writeUInt32LE(VERSION, 4);
buf.writeInt32LE(Fcols.frameTick[0], 8);
buf.writeInt32LE(Fcols.frameTick[n - 1], 12);
buf.writeInt32LE(n, 16);
buf.writeInt32LE(NPLAYERS, 20);
buf.writeInt32LE(m, 24);
buf.writeInt32LE(flags, 28);
buf.writeUInt32LE(0, 32);
buf.writeUInt32LE(0, 36);
buf.writeBigUInt64LE(BigInt(layout.totalBytes - HEADER_BYTES), 40);
buf.writeBigUInt64LE(BigInt(layout.totalBytes), 48);
buf.writeBigUInt64LE(0n, 56);
for (const blk of layout.blocks) {
  const arr = Fcols[blk.name] ?? Pcols[blk.name];
  if (!arr) throw new Error(`缺少列 ${blk.name}`);
  Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(buf, blk.offset);
}
const crc = crc32(buf.subarray(HEADER_BYTES));
buf.writeUInt32LE(crc, 32);

// ── 6. manifest（真实数据）──
const roundsInWindow = manifest.rounds.filter((r) => r.endTick >= winStart && r.startTick <= winEnd);
const realManifest = {
  _note: '由 tools/gen-fixture-from-demo.mjs 从真实 demo 解析生成，不是合成数据',
  source: { demo: DEMO, demoBytes: demoBytes.length, sampleRate: SAMPLE_RATE, parsedAt: new Date().toISOString() },
  mapName: data.meta.mapName,
  tickRate: data.meta.tickRate,
  startTick: data.meta.startTick,       // ⚠️ tick 换算基准，分段时**不得**改成窗口起点
  endTick: data.meta.endTick,
  durationSeconds: data.meta.durationSeconds,
  rounds: data.rounds.map((r) => ({ index: r.index, startTick: r.startTick, endTick: r.endTick, liveStartTick: r.liveStartTick })),
  roundsInWindow,
  players: data.players.map((p) => ({ slot: p.slot, steamId: p.steamId, name: p.name, clanName: p.clanName ?? null, color: p.color ?? null, crosshairCode: p.crosshairCode ?? null })),
  weaponNames: data.weaponNames,
  window: { startTick: Fcols.frameTick[0], endTick: Fcols.frameTick[n - 1], numFrames: n, panelNumFrames: m, startSeconds: START_SEC, durationSeconds: SECONDS },
};

const outDir = OUT_DIR;
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(realManifest, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, 'segment-000.bin'), buf);

const sidecar = {
  format: 'CSDF v1',
  generatedFrom: 'real demo (test.dem)',
  header: { startTick: Fcols.frameTick[0], endTick: Fcols.frameTick[n - 1], numFrames: n, numPlayers: NPLAYERS, panelNumFrames: m, flags, crc32: '0x' + crc.toString(16), totalBytes: layout.totalBytes },
  layout: layout.blocks,
  sampleFrame: Object.fromEntries(FRAME_COLS.map(([name]) => [name, name === 'frameTick' ? Fcols.frameTick[0] : Array.from(Fcols[name].slice(0, NPLAYERS))])),
  note: 'sampleFrame = 窗口第 0 帧的逐玩家原始值，便于 C++ 侧对齐校验',
};
fs.writeFileSync(path.join(outDir, 'segment-000.json'), JSON.stringify(sidecar, null, 2), 'utf8');

console.log(`\n已写出真实 fixture：`);
console.log(`  fixtures/manifest.json`);
console.log(`  fixtures/segment-000.bin   ${layout.totalBytes} 字节`);
console.log(`  fixtures/segment-000.json`);
console.log(`  窗口 ticks ${Fcols.frameTick[0]}..${Fcols.frameTick[n - 1]}（${n} 帧 × ${NPLAYERS} 人）+ panelFrames ${m} 帧`);
console.log(`  crc32 = 0x${crc.toString(16)}`);
