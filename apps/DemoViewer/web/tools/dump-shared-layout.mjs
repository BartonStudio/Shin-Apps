// 生成「共享内存布局」的金标准基准（golden），供 C++ 侧对齐用。
//
// 这是你要写 C++ 版 computeSharedLayout 时的**标准答案**：
// 你的实现算出同样的 offset/length，diff 一下就能确认布局正确，
// 不用等"跑起来看画面乱不乱"。
//
// 用法：
//   node tools/dump-shared-layout.mjs                  # 解析 test.dem 生成
//   node tools/dump-shared-layout.mjs --demo other.dem
//   node tools/dump-shared-layout.mjs --from-fixture   # 不解析 demo，用 fixtures 里的真实窗口
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);

const SB = await import('file:///' + R('src/deobfuscated/shared-buffer.js').replace(/\\/g, '/'));

import {
  REPO_ROOT as P_ROOT, needDemo, tmpDir, tmpFile, imagePath, sidecarPath,
  goldenPath, needFile, opt, hasFlag, wantsHelp, printUsage, COMMON_OPTIONS,
} from './paths.mjs';

if (wantsHelp()) {
  printUsage('tools/dump-shared-layout.mjs',
    '生成「共享内存布局」金标准（C++ 侧实现对齐用）',
    [COMMON_OPTIONS.demo, ['--from-fixture', '不解析 demo，改用 fixtures/segment-000.bin'], COMMON_OPTIONS.golden, COMMON_OPTIONS.help],
    ['node tools/dump-shared-layout.mjs',
     'node tools/dump-shared-layout.mjs --from-fixture',
     'node tools/dump-shared-layout.mjs --demo D:\\demos\\match.dem']);
  process.exit(0);
}

const FROM_FIXTURE = hasFlag('from-fixture');
const DEMO = FROM_FIXTURE ? null : needFile(needDemo(), 'demo 文件', '--demo', 'CSDEMO_DEM');

let data;
let sourceLabel;

if (FROM_FIXTURE) {
  // 用 fixtures/segment-000.bin（真实 demo 的前 30 秒）反推 counts。
  // 好处：不需要 87 MB 的 test.dem，也不需要 15 秒解析。
  const CSDF = await import('file:///' + R('tools/csdf-format.mjs').replace(/\\/g, '/'));
  const buf = fs.readFileSync(R('fixtures/segment-000.bin'));
  const h = {
    version: buf.readUInt32LE(4),
    startTick: buf.readInt32LE(8),
    endTick: buf.readInt32LE(12),
    numFrames: buf.readInt32LE(16),
    numPlayers: buf.readInt32LE(20),
    panelNumFrames: buf.readInt32LE(24),
    flags: buf.readInt32LE(28),
  };
  const layout = CSDF.computeLayout(h);
  const readCol = (name) => {
    const b = layout.blocks.find((x) => x.name === name);
    if (!b) return null;
    const Ctor = { i32: Int32Array, f32: Float32Array, u8: Uint8Array, u16: Uint16Array }[b.type];
    return new Ctor(buf.buffer, buf.byteOffset + b.offset, b.length / Ctor.BYTES_PER_ELEMENT);
  };
  const tickBegin = readCol('panelFrameTick');
  // 可选列必须也读出来，否则 deriveFlags 会漏掉 FLAG_ACCURACY/SPEED 等，flags 就不对了
  const frames = {
    frameTick: readCol('frameTick'),
    accuracyPenalty: readCol('accuracyPenalty'),
    reloading: readCol('reloading'),
    playerFlags: readCol('playerFlags'),
    speed: readCol('speed'),
    smoothSpeed: readCol('smoothSpeed'),
  };
  for (const k of Object.keys(frames)) if (frames[k] === null) delete frames[k];
  // fixture 里没有 tracers/damage/smokeVoxels（CSDF v1 不含这些块），给 0
  data = {
    meta: {
      mapName: 'de_dust2', tickRate: 64, sampleRate: 64,
      numPlayers: h.numPlayers, numFrames: h.numFrames,
      startTick: h.startTick, endTick: h.endTick, durationSeconds: (h.endTick - h.startTick) / 64,
    },
    frames,
    panelFrames: { frameTick: tickBegin },
    players: [], rounds: [], weaponNames: [], events: [],
    grenades: { trajectories: [], effects: [], infernos: [] },
    bomb: { segments: [], defuses: [] },
    deathMarkers: [], timeouts: { maxTacticalTimeouts: 0, intervals: [], counters: [] },
    deathRagdolls: [], droppedWeapons: [], mapEntities: [],
    tracers: { count: 0 }, damage: { count: 0 }, weaponFires: { ticks: [] },
    smokeVoxels: { count: 0, buffers: [], frameTicks: [] },
  };
  sourceLabel = 'fixtures/segment-000.bin（真实 demo 前 30 秒窗口；tracers/damage/smokeVoxels 计 0）';
} else {
  globalThis.self = { onmessage: null, postMessage: () => {}, close: () => {} };
  let src = fs.readFileSync(R('src/workers/parser.worker.js'), 'utf8');
  src = src.replace(/At\.onmessage = async \(e\) => \{[\s\S]*?\n\}\n?$/, '\n');
  src += `\nexport { lt as initParser, gt as parseDemoCore };\n`;
  fs.mkdirSync(R('tmp'), { recursive: true });
  fs.writeFileSync(tmpFile('worker-runnable.mjs'), src, 'utf8');

  const { computeSpeedColumns } = await import('file:///' + R('src/deobfuscated/speed-columns.js').replace(/\\/g, '/'));
  const w = await import('file:///' + tmpFile('worker-runnable.mjs').replace(/\\/g, '/'));
  const wasm = fs.readFileSync(R('raw/assets/csplayer_parser_bg-qigVgicw.wasm'));
  const quiet = console.warn; console.warn = () => {};
  await w.initParser({ module_or_path: new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } }) });
  console.warn = quiet;

  console.log(`解析 ${DEMO} …`);
  const t0 = Date.now();
  ({ data } = w.parseDemoCore(new Uint8Array(fs.readFileSync(DEMO)), { sampleRate: 64 }, {}));
  computeSpeedColumns(data);
  console.log(`解析完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  sourceLabel = `${DEMO}（完整 demo）`;
}

const plan = SB.planSharedBuffer(data);
const { layout, counts, flags, bytes, N, P, M } = plan;

// ── 生成 golden ──
const golden = {
  _note: '共享内存布局金标准。C++ 侧的 computeSharedLayout 必须算出完全相同的 offset/length。',
  _how: 'node tools/dump-shared-layout.mjs',
  source: sourceLabel,
  constants: {
    CSDF_MAGIC: '0x' + SB.CSDF_MAGIC.toString(16),
    CSDF_VERSION: SB.CSDF_VERSION,
    CSDF_HEADER_BYTES: SB.CSDF_HEADER_BYTES,
    CSDF_ALIGN: SB.CSDF_ALIGN,
    META_REGION_BYTES: SB.META_REGION_BYTES,
    META_A_OFFSET: SB.META_A_OFFSET,
    META_B_OFFSET: SB.META_B_OFFSET,
    DATA_OFFSET: SB.DATA_OFFSET,
    BLOB_ALIGN: 8,
  },
  inputs: { numFrames: N, numPlayers: P, panelNumFrames: M, flags, counts },
  outputs: {
    totalBytes: bytes,
    metadataJsonBytes: JSON.stringify(plan.meta).length,
    blocks: layout.blocks.map((b) => ({
      name: b.name, type: b.type, offset: b.offset, length: b.length, padded: b.padded, count: b.count,
    })),
  },
};

// ⚠️ --from-fixture 产出的是**降级版**（fixtures 里没有 tracers/damage/smokeVoxels，
//    所以只有 48 块、这些 counts 全 0）。它绝不能覆盖用真实 demo 算出的权威金标准（49 块）。
//    两种模式用不同文件名 —— 防止「顺手跑一下就把标准答案弄坏了」。
const suffix = FROM_FIXTURE ? '.fixture.golden' : '.golden';
const goldenJson = goldenPath(`shared-layout${suffix}.json`);
fs.writeFileSync(goldenJson, JSON.stringify(golden, null, 2), 'utf8');

// 同时输出 TSV：给 C++ 测试用（避免在 C++ 里写一个 JSON 解析器）
{
  const lines = [
    '# 共享内存布局金标准（TSV）',
    '# 由 tools/dump-shared-layout.mjs 生成，勿手改',
    ['totalBytes', bytes].join('\t'),
    ...Object.entries(counts).map(([k, v]) => ['count', k, v].join('\t')),
    ['flags', flags].join('\t'),
    ['numFrames', N].join('\t'),
    ['numPlayers', P].join('\t'),
    ['panelNumFrames', M].join('\t'),
    '# name\ttype\toffset\tlength\tpadded\tcount',
    ...layout.blocks.map((b) => [b.name, b.type, b.offset, b.length, b.padded, b.count].join('\t')),
  ];
  const goldenTsv = goldenPath(`shared-layout${suffix}.tsv`);
  fs.writeFileSync(goldenTsv, lines.join('\n') + '\n', 'utf8');
  console.log(`✅ 已写出 ${goldenTsv}（供 C++ 测试读取）`);
}

// ── 控制台输出：人类可读的表 ──
console.log(`\n来源：${sourceLabel}`);
console.log(`输入：N=${N}  P=${P}  M=${M}  flags=0x${flags.toString(16)}`);
console.log(`counts：${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`\n总字节 ${bytes}（${(bytes / 1048576).toFixed(2)} MB）  元数据 JSON ${(JSON.stringify(plan.meta).length / 1024).toFixed(0)} KB`);
console.log(`块数 ${layout.blocks.length}\n`);
console.log('  序号  块名                        类型   偏移        长度        元素数');
console.log('  ' + '─'.repeat(76));
layout.blocks.forEach((b, i) => {
  console.log(`  ${String(i).padStart(4)}  ${b.name.padEnd(26)}  ${b.type.padEnd(4)}  ${String(b.offset).padStart(10)}  ${String(b.length).padStart(10)}  ${String(b.count).padStart(9)}`);
});
console.log('  ' + '─'.repeat(76));

// ── 关键偏移单独列出来（C++ 里要硬编码的就是这几个）──
console.log('\n关键偏移（C++ 侧直接对照）：');
for (const k of ['META_A_OFFSET', 'META_B_OFFSET', 'DATA_OFFSET']) {
  console.log(`  ${k.padEnd(18)} = ${golden.constants[k]}`);
}
for (const n of ['frameTick', 'posX', 'speed', 'smoothSpeed', 'panelFrameTick', 'blob']) {
  const b = layout.blocks.find((x) => x.name === n);
  if (b) console.log(`  ${n.padEnd(18)} = ${b.offset}`);
}

console.log(`\n✅ 已写出 ${goldenJson}`);
console.log('   C++ 实现对齐后，用 diff 比对 outputs.blocks 即可。');
