// 跨语言验证：读 C++ 侧 writeSharedBuffer() 写出的共享内存，用 JS 的
// buildDataFromSharedBuffer() 读回来，逐字段比对。
//
// 这一步证明「C++ 的写」和「JS 的读」用的是同一套布局与协议 —— 是整个对接里最关键的一环。
//
// 前置：
//   node tools/test-shared-buffer-from-cpp.mjs 之前先跑 cpp/writer_test
//   （它会把镜像写到 tmp/shared-from-cpp.bin）
//
// 期望值必须与 cpp/writer_test.cpp 的 makeSample() 完全一致。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
import {
  REPO_ROOT as P_ROOT, demoPath, tmpDir, tmpFile, imagePath, sidecarPath,
  goldenPath, needFile, opt, hasFlag, wantsHelp, printUsage, COMMON_OPTIONS,
} from './paths.mjs';

if (wantsHelp()) {
  printUsage('tools/test-shared-buffer-from-cpp.mjs',
    'C++ 写共享内存 -> JS 读回，逐字段比对',
    [COMMON_OPTIONS.image, COMMON_OPTIONS.tmp, COMMON_OPTIONS.help],
    ['node tools/test-shared-buffer-from-cpp.mjs',
     'node tools/test-shared-buffer-from-cpp.mjs --image D:\\out\\x.bin']);
  process.exit(0);
}

const BIN = needFile(imagePath('shared-from-cpp.bin'), '共享内存镜像', '--image', 'CSDEMO_IMAGE',
  '先跑 C++ 侧的 writer_test 生成它（例：cpp\\out\\build\\bin\\release\\writer_test.exe）');

if (!fs.existsSync(BIN)) {
  console.error(`找不到 ${BIN}`);
  console.error('请先编译并运行 cpp/writer_test（它会写出这个文件）');
  process.exit(2);
}

const SB = await import('file:///' + R('src/deobfuscated/shared-buffer.js').replace(/\\/g, '/'));

const raw = fs.readFileSync(BIN);
const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

const out = [];
const PASS = (l, d = '') => out.push(['PASS', l, d]);
const FAIL = (l, d = '') => out.push(['FAIL', l, d]);
const INFO = (l, d = '') => out.push(['INFO', l, d]);

const NEAR = 1e-6;
const near = (a, b) => Math.abs(a - b) <= NEAR;

function eqArr(label, got, want) {
  if (!got) return FAIL(label, '值缺失');
  if (got.length !== want.length) return FAIL(label, `长度 ${got.length} vs ${want.length}`);
  for (let i = 0; i < want.length; i++) {
    if (!near(got[i], want[i])) return FAIL(label, `[${i}] ${got[i]} vs ${want[i]}`);
  }
  return PASS(label, `${want.length} 元素`);
}
function eqSet(label, got, want) {
  if (!got) return FAIL(label, '值缺失');
  if (got.length !== want.length) return FAIL(label, `长度 ${got.length} vs ${want.length}`);
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) return FAIL(label, `[${i}] ${got[i]} vs ${want[i]}`);
  return PASS(label, `${want.length} 元素`);
}
function eqVal(label, got, want) {
  if (got === want) return PASS(label, String(want));
  if (typeof got === 'number' && typeof want === 'number' && near(got, want)) return PASS(label, `${got} ≈ ${want}`);
  return FAIL(label, `${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
}

// ═══ 0. 自检输出 ═══
{
  const desc = SB.describeSharedBuffer(ab);
  INFO('describeSharedBuffer', desc.split('\n')[0]);
  desc.includes('CSDF v1') ? PASS('C++ 写出的 header 可被 JS 自检函数读取', '') : FAIL('自检失败', desc.slice(0, 120));
  desc.includes('元数据区 A: mapName=de_dust2') ? PASS('元数据区 A 可解析（version=2 偶数 → A）', '') : INFO('元数据区 A 内容', desc.split('\n').find((l) => l.includes('元数据区 A')) ?? '无');
}

// ═══ 1. 读回 ═══
const visible = {
  version: 2,
  loadedRounds: 1,
  visibleFrames: 3,
  panelVisibleFrames: 2,
  durationSeconds: 2 / 64,
};
let data;
try {
  data = SB.buildDataFromSharedBuffer(ab, visible);
  PASS('buildDataFromSharedBuffer 成功（C++ → JS 全链路打通）', `${raw.length} 字节`);
} catch (e) {
  FAIL('buildDataFromSharedBuffer 抛异常', e.message);
  const w = Math.max(...out.map((o) => o[1].length));
  for (const [s, l, d] of out) console.log(`[${s}] ${l.padEnd(w)}  ${d}`);
  process.exit(1);
}

// ═══ 2. meta ═══
eqVal('meta.mapName', data.meta.mapName, 'de_dust2');
eqVal('meta.tickRate', data.meta.tickRate, 64);
eqVal('meta.sampleRate', data.meta.sampleRate, 64);
eqVal('meta.numPlayers', data.meta.numPlayers, 2);
eqVal('meta.numFrames', data.meta.numFrames, 3);
eqVal('meta.startTick', data.meta.startTick, 1000);
eqVal('meta.endTick', data.meta.endTick, 1002);

// ═══ 3. players（含 optional 省略语义）═══
eqVal('players.length', data.players.length, 2);
eqVal('players[0].steamId', data.players[0].steamId, '76561197962984717');
eqVal('players[0].clanName', data.players[0].clanName, 'TEAM A');
eqVal('players[0].color', data.players[0].color, 'blue');
eqVal('players[1].name（含中文）', data.players[1].name, ' 山月');
eqVal('players[1].clanName 缺失 → undefined', data.players[1].clanName, undefined);
eqVal('players[1].color', data.players[1].color, 'purple');

// ═══ 4. frames ═══
eqSet('frames.frameTick', data.frames.frameTick, [1000, 1001, 1002]);
eqArr('frames.posX', data.frames.posX, [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]);
eqArr('frames.posY', data.frames.posY, [-1.5, -2.5, -3.5, -4.5, -5.5, -6.5]);
eqArr('frames.posZ', data.frames.posZ, [10, 20, 30, 40, 50, 60]);
eqArr('frames.yaw', data.frames.yaw, [-179.5, 0, 45.25, 120, -90, 179.75]);
eqArr('frames.pitch', data.frames.pitch, [-30, 10, 45, 88.5, -63.5, 0]);
eqSet('frames.health', data.frames.health, [100, 87, 55, 12, 0, 100]);
eqSet('frames.alive', data.frames.alive, [1, 1, 1, 0, 1, 1]);
eqSet('frames.team（含 0 = 未参与）', data.frames.team, [2, 2, 3, 3, 0, 2]);
eqSet('frames.score', data.frames.score, [0, 1, 2, 3, 4, 5]);
eqArr('frames.duck', data.frames.duck, [0, 0.25, 0.5, 0.75, 1, 0]);
eqArr('frames.flash', data.frames.flash, [0.5, 0, 1.25, 2, 0, 0.75]);
eqArr('frames.flashAlpha', data.frames.flashAlpha, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
eqSet('frames.zoom', data.frames.zoom, [0, 1, 2, 0, 1, 2]);
eqArr('frames.accuracyPenalty', data.frames.accuracyPenalty, [-1, 0.5, 0.75, -1, 1.25, 0]);
eqSet('frames.reloading', data.frames.reloading, [0, 1, 0, 0, 1, 0]);
eqSet('frames.playerFlags', data.frames.playerFlags, [0, 4, 0, 0, 4, 0]);
eqArr('frames.speed', data.frames.speed, [0, 166.5, 240.25, 310.75, 0, 120.5]);
eqArr('frames.smoothSpeed', data.frames.smoothSpeed, [0, 150.25, 220, 286.5, 0, 100.75]);

// 视图类型必须是 TypedArray（零拷贝的前提）
data.frames.posX instanceof Float32Array ? PASS('frames.posX 是 Float32Array 视图', '') : FAIL('frames.posX 类型不对', data.frames.posX?.constructor?.name);
data.frames.team instanceof Uint8Array ? PASS('frames.team 是 Uint8Array 视图', '') : FAIL('frames.team 类型不对', data.frames.team?.constructor?.name);

// ═══ 5. panelFrames（另一套 tick 网格）═══
eqVal('panelFrames.numFrames', data.panelFrames.numFrames, 2);
eqSet('panelFrames.frameTick', data.panelFrames.frameTick, [1000, 1001]);
eqSet('panelFrames.health', data.panelFrames.health, [100, 87, 55, 12]);
eqSet('panelFrames.alive', data.panelFrames.alive, [1, 1, 1, 0]);
eqSet('panelFrames.team', data.panelFrames.team, [2, 2, 3, 3]);
eqSet('panelFrames.armor', data.panelFrames.armor, [100, 50, 0, 0]);
eqSet('panelFrames.flags', data.panelFrames.flags, [3, 1, 2, 0]);
eqSet('panelFrames.money', data.panelFrames.money, [800, 4700, 250, 3200]);
eqSet('panelFrames.clipAmmo', data.panelFrames.clipAmmo, [30, 12, 0, 7]);
eqSet('panelFrames.reserveAmmo', data.panelFrames.reserveAmmo, [12, 36, 0, 21].map((v, i) => [90, 36, 0, 21][i]));
eqSet('panelFrames.activeWeapon', data.panelFrames.activeWeapon, [0, 1, 2, 0]);
eqSet('panelFrames.utilCounts', data.panelFrames.utilCounts, [0, 3, 1, 0]);
data.panelFrames.money instanceof Uint16Array ? PASS('panelFrames.money 是 Uint16Array 视图', '') : FAIL('panelFrames.money 类型不对', '');
eqVal('panelFrames.equipValue 已不存在（契约移除）', 'equipValue' in data.panelFrames, false);

// ═══ 6. weaponNames / rounds ═══
eqVal('weaponNames.length', data.weaponNames.length, 3);
eqVal('weaponNames[0] 是空字符串', data.weaponNames[0], '');
eqVal('weaponNames[1]', data.weaponNames[1], 'AK-47');
eqVal('rounds.length', data.rounds.length, 1);
eqVal('rounds[0].index', data.rounds[0].index, 0);
eqVal('rounds[0].startTick', data.rounds[0].startTick, 1000);
eqVal('rounds[0].liveStartTick', data.rounds[0].liveStartTick, 1000);

// ═══ 7. events（optional 语义）═══
eqVal('events.length', data.events.length, 2);
eqVal('events[0].type', data.events[0].type, 'kill');
eqVal('events[0].tick', data.events[0].tick, 1001);
eqVal('events[0].headshot', data.events[0].headshot, true);
eqVal('events[0].weapon', data.events[0].weapon, 'ak47');
eqVal('events[0].assisterSlot 缺失 → undefined', data.events[0].assisterSlot, undefined);
eqVal('events[0].victimSlot', data.events[0].victimSlot, 1);
eqVal('events[1].type', data.events[1].type, 'round_end');
eqVal('events[1].roundWinner', data.events[1].roundWinner, 2);
eqVal('events[1].roundReason', data.events[1].roundReason, 7);

// ═══ 8. grenades（变长数组走 blob）═══
eqVal('grenades.trajectories.length', data.grenades.trajectories.length, 1);
{
  const t = data.grenades.trajectories[0];
  eqVal('trajectory.kind', t.kind, 'smoke');
  eqArr('trajectory.posXYZ', t.posXYZ, [1, 2, 3, 4, 5, 6]);
  eqSet('trajectory.ticks', t.ticks, [1000, 1002]);
  eqArr('trajectory.angles', t.angles, [0, 0, 0, 10, 20, 30]);
  eqVal('trajectory.detonationTick', t.detonationTick, 1002);
  t.posXYZ instanceof Float32Array ? PASS('trajectory.posXYZ 是 blob 视图（零拷贝）', '') : FAIL('posXYZ 不是视图', t.posXYZ?.constructor?.name);
}
eqVal('grenades.effects.length', data.grenades.effects.length, 1);
eqVal('grenades.effects[0].endTick', data.grenades.effects[0].endTick, 1002 + 960);
eqVal('grenades.infernos.length', data.grenades.infernos.length, 1);
{
  const n = data.grenades.infernos[0];
  eqVal('inferno.entityId', n.entityId, 639);
  eqVal('inferno.frames.length', n.frames.length, 1);
  eqArr('inferno.frames[0].positions', n.frames[0].positions, [7, 8, 9]);
  eqSet('inferno.frames[0].burning', n.frames[0].burning, [1]);
  eqArr('inferno.frames[0].origin', n.frames[0].origin, [7.5, 8.5, 9.5]);
}

// ═══ 9. 区间数据 ═══
eqVal('tracers.count', data.tracers.count, 1);
eqArr('tracers.origin', data.tracers.origin, [1, 2, 3]);
eqArr('tracers.end', data.tracers.end, [11, 12, 13]);
eqSet('tracers.tick', data.tracers.tick, [1001]);
eqVal('damage.count', data.damage.count, 1);
eqVal('damage.dmg[0]', data.damage.dmg[0], 100);
eqSet('weaponFires.ticks', data.weaponFires.ticks, [1001, 1002]);
eqSet('weaponFires.slots', data.weaponFires.slots, [0, 1]);
eqVal('smokeVoxels.count', data.smokeVoxels.count, 1);
eqSet('smokeVoxels.bufferOffsets（前缀和）', data.smokeVoxels.bufferOffsets, [0, 4]);
eqSet('smokeVoxels.buffers', data.smokeVoxels.buffers, [1, 2, 3, 4]);

// ═══ 10. 其余元数据 ═══
eqVal('bomb.segments.length', data.bomb.segments.length, 1);
eqVal('bomb.segments[0].kind', data.bomb.segments[0].kind, 'dropped');
eqVal('bomb.defuses[0].hasKit', data.bomb.defuses[0].hasKit, true);
eqVal('deathMarkers.length', data.deathMarkers.length, 1);
eqVal('deathMarkers[0].name（含中文）', data.deathMarkers[0].name, ' 山月');
eqVal('timeouts.maxTacticalTimeouts', data.timeouts.maxTacticalTimeouts, 2);
eqVal('timeouts.intervals[0].side', data.timeouts.intervals[0].side, 't');
eqVal('deathRagdolls[0].headshot', data.deathRagdolls[0].headshot, true);
eqArr('deathRagdolls[0].eyeAngles', data.deathRagdolls[0].eyeAngles, [2.375, 106.8125]);
eqVal('droppedWeapons.length', data.droppedWeapons.length, 1);
{
  const w = data.droppedWeapons[0];
  eqVal('droppedWeapon.weapon', w.weapon, 'Nomad Knife');
  eqSet('droppedWeapon.ticks', w.ticks, [1000, 1001]);
  eqArr('droppedWeapon.positions', w.positions, [1, 2, 3, 4, 5, 6]);
  w.ticks instanceof Int32Array ? PASS('droppedWeapon.ticks 是 blob 视图', '') : FAIL('ticks 不是视图', w.ticks?.constructor?.name);
}
eqVal('mapEntities.length', data.mapEntities.length, 1);
{
  const m = data.mapEntities[0];
  eqVal('mapEntity.className', m.className, 'CFuncBrush');
  eqArr('mapEntity.origin', m.origin, [-1320, 2619, 160]);
  eqSet('mapEntity.ticks', m.ticks, [1000, 1001]);
  eqSet('mapEntity.hidden', m.hidden, [0, 0]);
}

// ── 输出 ──
const width = Math.max(...out.map((o) => o[1].length));
for (const [s, l, d] of out) console.log(`[${s}] ${l.padEnd(width)}  ${d}`);
const fails = out.filter((o) => o[0] === 'FAIL');
const passes = out.filter((o) => o[0] === 'PASS');
console.log(`\n${'─'.repeat(74)}`);
console.log(`PASS ${passes.length}  FAIL ${fails.length}  INFO ${out.length - passes.length - fails.length}`);
if (fails.length) {
  console.log('\n失败项：');
  for (const f of fails) console.log(`  ${f[1]}: ${f[2]}`);
}
process.exitCode = fails.length ? 1 : 0;
