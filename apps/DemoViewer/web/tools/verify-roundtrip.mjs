// 往返验证的最后一环：让 JS 读 **C++ 写出**的镜像，与原始指纹比对。
//
// 链路完整闭环：
//   ① JS 解析 → 镜像              tools/gen-js-image.mjs
//   ② C++ 读镜像 → DemoData → 再写   cpp/roundtrip_test
//   ③ JS 读 C++ 镜像 → 比对指纹    ← 本文件
//
// 指纹由 **同一段 JS 代码**在两次都计算，所以浮点格式化差异不影响判定。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);

import {
  REPO_ROOT as P_ROOT, demoPath, tmpDir, tmpFile, imagePath, sidecarPath,
  goldenPath, needFile, opt, hasFlag, wantsHelp, printUsage, COMMON_OPTIONS,
} from './paths.mjs';

if (wantsHelp()) {
  printUsage('tools/verify-roundtrip.mjs',
    'JS 读 C++ 往返后的镜像，与原始指纹比对',
    [COMMON_OPTIONS.image, COMMON_OPTIONS.sidecar, COMMON_OPTIONS.tmp, COMMON_OPTIONS.help],
    ['node tools/verify-roundtrip.mjs',
     'node tools/verify-roundtrip.mjs --image D:\\out\\rt.bin --sidecar D:\\out\\side.json']);
  process.exit(0);
}

const CppImage = needFile(imagePath('shared-from-cpp-rt.bin'), '往返后的镜像', '--image', 'CSDEMO_IMAGE',
  '先跑：node tools/gen-js-image.mjs + cpp/roundtrip_test');
const Sidecar = needFile(sidecarPath(), '旁挂水位/指纹文件', '--sidecar', 'CSDEMO_SIDECAR',
  '先跑：node tools/gen-js-image.mjs');

for (const f of [CppImage, Sidecar]) {
  if (!fs.existsSync(f)) {
    console.error(`missing ${f}`);
    console.error('先跑: node tools/gen-js-image.mjs && cpp/roundtrip_test');
    process.exit(2);
  }
}

const SB = await import('file:///' + R('src/deobfuscated/shared-buffer.js').replace(/\\/g, '/'));
const sidecar = JSON.parse(fs.readFileSync(Sidecar, 'utf8'));

const raw = fs.readFileSync(CppImage);
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

const out = [];
const PASS = (l, d = '') => out.push(['PASS', l, d]);
const FAIL = (l, d = '') => out.push(['FAIL', l, d]);
const INFO = (l, d = '') => out.push(['INFO', l, d]);

// ── 读 C++ 镜像 ──
let data;
try {
  data = SB.buildDataFromSharedBuffer(ab, sidecar.visible);
  PASS('JS 读取 C++ 写出的镜像成功', `${raw.length} 字节`);
} catch (e) {
  FAIL('JS 读取 C++ 镜像失败', e.message);
  const w = Math.max(...out.map((o) => o[1].length));
  for (const [s, l, d] of out) console.log(`[${s}] ${l.padEnd(w)}  ${d}`);
  process.exit(1);
}

const desc = SB.describeSharedBuffer(ab);
INFO('C++ 镜像自检', desc.split('\n')[0]);

// ── 重新计算指纹（与 gen-js-image.mjs 完全相同的算法）──
const sumInt32 = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const sumF32 = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const sumU8 = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const round6 = (x) => Math.round(x * 1e6) / 1e6;

const got = {
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
};
const want = sidecar.fingerprints;

let bad = 0;
for (const k of Object.keys(want)) {
  const a = got[k];
  const b = want[k];
  const ok = typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= Math.abs(b) * 1e-9 + 1e-6
    : a === b;
  if (ok) PASS(`fingerprint ${k}`, String(b));
  else { FAIL(`fingerprint ${k}`, `${a} vs ${b}`); bad++; }
}

// ── 关键结构再抽查（不只看指纹）──
const eq = (l, a, b) => (a === b ? PASS(l, String(b)) : (FAIL(l, `${a} vs ${b}`), bad++));
eq('meta.mapName', data.meta.mapName, sidecar.meta.mapName);
eq('meta.numFrames', data.meta.numFrames, sidecar.meta.numFrames);
eq('meta.startTick', data.meta.startTick, sidecar.meta.startTick);
eq('meta.endTick', data.meta.endTick, sidecar.meta.endTick);
eq('panelFrames.numFrames', data.panelFrames.numFrames, sidecar.meta.panelNumFrames);
eq('players.length', data.players.length, data.meta.numPlayers);
eq('rounds.length', data.rounds.length, 22);
eq('weaponNames.length', data.weaponNames.length > 0, true);
eq('weaponNames[0] 是空字符串', data.weaponNames[0], '');

// 视图类型（零拷贝的前提）
data.frames.posX instanceof Float32Array ? PASS('frames.posX 是 Float32Array 视图', '') : (FAIL('frames.posX 类型', ''), bad++);
data.frames.speed instanceof Float32Array ? PASS('frames.speed 是 Float32Array 视图', '') : (FAIL('frames.speed 类型', ''), bad++);
data.grenades.trajectories[0].posXYZ instanceof Float32Array
  ? PASS('trajectory.posXYZ 是 blob 视图（零拷贝）', '')
  : (FAIL('trajectory.posXYZ 类型', ''), bad++);

// 抽样：挑一帧看数值是否合理（人不是全在 0,0,0）
{
  const P = data.meta.numPlayers;
  const mid = Math.floor(data.meta.numFrames / 2);
  let nonZero = 0;
  for (let p = 0; p < P; p++) {
    const i = mid * P + p;
    if (Math.abs(data.frames.posX[i]) > 1 || Math.abs(data.frames.posY[i]) > 1) nonZero++;
  }
  nonZero > 0 ? PASS('中段帧的玩家坐标非全零（数据是真的）', `${nonZero}/${P} 名玩家有位置`) : FAIL('中段帧坐标全零', '');
}

// ── 输出 ──
const width = Math.max(...out.map((o) => o[1].length));
for (const [s, l, d] of out) console.log(`[${s}] ${l.padEnd(width)}  ${d}`);
const fails = out.filter((o) => o[0] === 'FAIL');
const passes = out.filter((o) => o[0] === 'PASS');
console.log(`\n${'─'.repeat(72)}`);
console.log(`PASS ${passes.length}  FAIL ${fails.length}  INFO ${out.length - passes.length - fails.length}`);
console.log(fails.length ? '\nROUNDTRIP MISMATCH' : '\nROUNDTRIP OK: JS -> C++ -> JS 数据完全一致');
process.exitCode = fails.length ? 1 : 0;
