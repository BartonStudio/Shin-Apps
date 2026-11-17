// 契约交叉校验：用前端的 shared-buffer.js 读取 C++ ContractFeed 产出的共享内存块。
// 用法：node tools/validate-contract.mjs [contract_segment.bin]
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const binPath = process.argv[2] ?? join(here, 'cs2ffi', 'contract_segment.bin');
const { buildDataFromSharedBuffer, readSharedHeader, describeSharedBuffer } =
  await import(pathToFileURL(join(here, '..', 'web', 'src', 'deobfuscated', 'shared-buffer.js')).href);

const ab = readFileSync(binPath).buffer.slice(
  readFileSync(binPath).byteOffset,
  readFileSync(binPath).byteOffset + readFileSync(binPath).byteLength);

console.log('== describeSharedBuffer ==');
console.log(describeSharedBuffer(ab));

const hdr = readSharedHeader(ab);
const msg = {
  version: 0,
  loadedRounds: 22,
  visibleFrames: hdr.numFramesCapacity,
  panelVisibleFrames: hdr.panelCapacity,
  durationSeconds: (hdr.endTick - hdr.startTick) / 64,
};
const data = buildDataFromSharedBuffer(ab, msg);

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  [OK]' : '  [FAIL]'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fail++;
};

console.log('== 契约检查 ==');
check('meta', data.meta.mapName === 'de_dust2' && data.meta.numPlayers === 10,
  `map=${data.meta.mapName} P=${data.meta.numPlayers}`);
check('players', data.players.length === 10 && typeof data.players[0].steamId === 'string',
  `name=${data.players[0]?.name}`);
check('rounds', data.rounds.length === 22, `rounds=${data.rounds.length}`);
check('frameTick 首尾/升序', data.frames.frameTick.length === hdr.numFramesCapacity &&
  data.frames.frameTick[0] === 0 && data.frames.frameTick.at(-1) === hdr.endTick,
  `N=${data.frames.frameTick.length}`);
let mono = true;
for (let i = 1; i < data.frames.frameTick.length; i++)
  if (data.frames.frameTick[i] <= data.frames.frameTick[i - 1]) { mono = false; break; }
check('frameTick 严格升序', mono);

const mid = 50000 * 10;
check('pos 有值', Math.abs(data.frames.posX[mid]) > 0 || Math.abs(data.frames.posY[mid]) > 0,
  `pos=(${data.frames.posX[mid].toFixed(1)},${data.frames.posY[mid].toFixed(1)},${data.frames.posZ[mid].toFixed(1)})`);
check('yaw 角度制 (-180,180]', data.frames.yaw[mid] > -180 && data.frames.yaw[mid] <= 180,
  `yaw=${data.frames.yaw[mid].toFixed(1)}`);
check('health 值域', data.frames.health[mid] <= 100, `health=${data.frames.health[mid]}`);
check('team 值域', [0, 2, 3].includes(data.frames.team[mid]), `team=${data.frames.team[mid]}`);
check('duck 值域', data.frames.duck[mid] >= 0 && data.frames.duck[mid] <= 1,
  `duck=${data.frames.duck[mid].toFixed(2)}`);
check('speed 非负', data.frames.speed[mid] >= 0, `speed=${data.frames.speed[mid].toFixed(1)}`);
check('smoothSpeed 非负', data.frames.smoothSpeed[mid] >= 0,
  `smooth=${data.frames.smoothSpeed[mid].toFixed(1)}`);

// speed 真实性：找一帧活人，speed 应 > 0（大部分时刻）
let moving = 0, samples = 0;
for (let i = 40000; i < 60000; i += 100) {
  const idx = i * 10 + 0;
  if (data.frames.alive[idx]) { samples++; if (data.frames.speed[idx] > 0) moving++; }
}
check('speed 有非零样本', moving > 0, `${moving}/${samples} 样本在动`);

check('panelFrames', data.panelFrames.frameTick.length === hdr.panelCapacity &&
  data.panelFrames.frameTick[1] - data.panelFrames.frameTick[0] === 8,
  `M=${data.panelFrames.frameTick.length}`);
check('panelMoney', data.panelFrames.money[mid >> 3] >= 0);
check('weaponNames[0] 空串', data.weaponNames[0] === '' && data.weaponNames.length > 1,
  `${data.weaponNames.length} 个（含 ${data.weaponNames[1]}）`);

const kills = data.events.filter((e) => e.type === 'kill');
const roundEnds = data.events.filter((e) => e.type === 'round_end');
check('events kill', kills.length === 158, `kills=${kills.length}`);
check('kill 字段', kills[0] && typeof kills[0].victimSlot === 'number' &&
  typeof kills[0].weapon === 'string' && typeof kills[0].headshot === 'boolean',
  `victim=${kills[0]?.victimSlot} weapon=${kills[0]?.weapon} hs=${kills[0]?.headshot}`);
check('round_end 胜方', roundEnds.length === 22 && [2, 3].includes(roundEnds[0].roundWinner),
  `winner=${roundEnds[0]?.roundWinner}`);

const planted = data.bomb.segments.filter((s) => s.kind === 'planted');
const carried = data.bomb.segments.filter((s) => s.kind === 'carried');
check('bomb.segments', planted.length >= 10 && carried.length > 0,
  `planted=${planted.length} carried=${carried.length} all=${data.bomb.segments.length}`);
check('planted 位置非零', planted[0] && Math.abs(planted[0].x) + Math.abs(planted[0].y) > 0,
  `pos=(${planted[0]?.x.toFixed(0)},${planted[0]?.y.toFixed(0)})`);

check('grenades.trajectories', data.grenades.trajectories.length >= 250,
  `n=${data.grenades.trajectories.length}`);
const tr0 = data.grenades.trajectories[0];
check('trajectory blob 视图', tr0.posXYZ instanceof Float32Array && tr0.ticks instanceof Int32Array &&
  tr0.posXYZ.length === tr0.ticks.length * 3,
  `points=${tr0.ticks.length} kind=${tr0.kind} thrower=${tr0.throwerSlot}`);
check('trajectory kind 字符串', ['he', 'flash', 'smoke', 'molotov', 'decoy'].includes(tr0.kind));
const smokeTrajs = data.grenades.trajectories.filter((t) => t.kind === 'smoke').length;
const smokes = data.grenades.effects.filter((e) => e.kind === 'smoke');
check('smoke effects 与烟雾轨迹数一致', smokes.length === smokeTrajs,
  `smoke 轨迹=${smokeTrajs} effects=${smokes.length}（本 demo 可能没烟雾弹）`);
check('droppedWeapons', data.droppedWeapons.length > 0,
  `n=${data.droppedWeapons.length} first=${data.droppedWeapons[0]?.weapon}`);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
