// 用原来的 JS 解析真实 .dem，产出一份**完整的共享内存镜像文件**。
//
// 这份文件是「JS → C++」的交换格式：C++ 侧用 shared_reader 读它、构造 DemoData、
// 再写回来，从而验证 C++ 的 DemoData 映射是双向正确的。
//
// 用法：
//   node tools/gen-js-image.mjs [--demo test.dem] [--out tmp/shared-from-js.bin]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
import {
  REPO_ROOT as P_ROOT, needDemo, tmpDir, tmpFile, imagePath, sidecarPath,
  goldenPath, needFile, opt, hasFlag, wantsHelp, printUsage, COMMON_OPTIONS,
} from './paths.mjs';

if (wantsHelp()) {
  printUsage('tools/gen-js-image.mjs',
    '用原 JS 解析 demo，产出一份共享内存镜像（JS -> C++ 的交换格式）',
    [COMMON_OPTIONS.demo, COMMON_OPTIONS.image, COMMON_OPTIONS.sidecar, COMMON_OPTIONS.tmp, COMMON_OPTIONS.help],
    ['node tools/gen-js-image.mjs',
     'node tools/gen-js-image.mjs --demo D:\\demos\\match.dem --image out/x.bin']);
  process.exit(0);
}

const DEMO = needFile(needDemo(), 'demo 文件', '--demo', 'CSDEMO_DEM');
const OUT = imagePath('shared-from-js.bin');


globalThis.self = { onmessage: null, postMessage: () => {}, close: () => {} };
{
  let src = fs.readFileSync(R('src/workers/parser.worker.js'), 'utf8');
  src = src.replace(/At\.onmessage = async \(e\) => \{[\s\S]*?\n\}\n?$/, '\n');
  src += `\nexport { lt as initParser, gt as parseDemoCore };\n`;
  // tmp 目录由 paths.mjs 的 tmpDir() 按需创建
  fs.writeFileSync(tmpFile('worker-runnable.mjs'), src, 'utf8');
}

const SB = await import('file:///' + R('src/deobfuscated/shared-buffer.js').replace(/\\/g, '/'));
const { computeSpeedColumns } = await import('file:///' + R('src/deobfuscated/speed-columns.js').replace(/\\/g, '/'));
const w = await import('file:///' + tmpFile('worker-runnable.mjs').replace(/\\/g, '/'));
{
  const wasm = fs.readFileSync(R('raw/assets/csplayer_parser_bg-qigVgicw.wasm'));
  const quiet = console.warn; console.warn = () => {};
  await w.initParser({ module_or_path: new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } }) });
  console.warn = quiet;
}

console.log(`① 用原 JS 解析 ${DEMO} …`);
const t0 = Date.now();
const { data } = w.parseDemoCore(new Uint8Array(fs.readFileSync(DEMO)), { sampleRate: 64 }, {});
computeSpeedColumns(data);
const N = data.frames.frameTick.length, P = data.meta.numPlayers, M = data.panelFrames.frameTick.length;
console.log(`   ${(Date.now() - t0) / 1000}s  N=${N} P=${P} M=${M}`);

console.log(`② 写成共享内存镜像 …`);
const t1 = Date.now();
const plan = SB.planSharedBuffer(data);
const ab = new ArrayBuffer(plan.bytes);
const wr = SB.writeSharedBuffer(ab, data, { version: 2 });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(ab));
console.log(`   ${Date.now() - t1}ms  ${plan.bytes} 字节（${(plan.bytes / 1048576).toFixed(2)} MB）→ ${OUT}`);
const metaJsonBytes = new TextEncoder().encode(JSON.stringify(plan.meta)).length;
console.log(`   元数据 JSON ${(metaJsonBytes / 1024).toFixed(0)} KB（区 ${wr.useA ? 'A' : 'B'}）  块数 ${plan.layout.blocks.length}  blob ${(plan.blob.bytes / 1048576).toFixed(2)} MB`);

// 顺带把「可见水位」写进一个旁挂小文件，方便后续步骤知道该怎么填 visible
const sidecar = {
  note: '由 tools/gen-js-image.mjs 生成；供 cpp/roundtrip_test 读取',
  source: DEMO,
  bytes: plan.bytes,
  version: 2,
  visible: {
    version: 2,
    loadedRounds: data.rounds.length,
    visibleFrames: N,
    panelVisibleFrames: M,
    durationSeconds: data.meta.durationSeconds,
  },
  counts: plan.counts,
  flags: plan.flags,
  meta: {
    mapName: data.meta.mapName, tickRate: data.meta.tickRate, numPlayers: P,
    numFrames: N, panelNumFrames: M, startTick: data.meta.startTick,
    endTick: data.meta.endTick, durationSeconds: data.meta.durationSeconds,
  },
  // 供 JS 侧事后比对：关键标量的摘要（不存全文，太大）
  fingerprints: {
    framesFrameTickSum: sumInt32(data.frames.frameTick),
    posXSum: round6(sumF32(data.frames.posX)),
    posYSum: round6(sumF32(data.frames.posY)),
    speedSum: round6(sumF32(data.frames.speed)),
    smoothSpeedSum: round6(sumF32(data.frames.smoothSpeed)),
    panelFrameTickSum: sumInt32(data.panelFrames.frameTick),
    tracersOriginSum: round6(sumF32(data.tracers.origin)),
    damageDmgSum: sumU8(data.damage.dmg),
    smokeBufferBytes: data.smokeVoxels.buffers.length,
    trajectoryPoints: data.grenades.trajectories.reduce((s, t) => s + t.posXYZ.length, 0),
    infernoFrames: data.grenades.infernos.reduce((s, n) => s + n.frames.length, 0),
    eventsCount: data.events.length,
    droppedWeaponsCount: data.droppedWeapons.length,
    deathMarkersCount: data.deathMarkers.length,
  },
};
{
  const sc = sidecarPath();
  fs.mkdirSync(path.dirname(sc), { recursive: true });
  fs.writeFileSync(sc, JSON.stringify(sidecar, null, 2), 'utf8');
  console.log(`   旁挂水位/指纹 → ${sc}`);
}


function sumInt32(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function sumF32(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function sumU8(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function round6(x) { return Math.round(x * 1e6) / 1e6; }
