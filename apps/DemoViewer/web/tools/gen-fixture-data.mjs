// 生成 CSDF 假数据：让 C++ 侧有一个「格式绝对正确」的参照物，也让你能立刻验证
// 播放器是否吃得下这种数据。
//
// 输出：
//   fixtures/manifest.json          会话级数据（只发一次）
//   fixtures/segment-000.bin        第一段二进制（CSDF v1）
//   fixtures/segment-000.json       同一段的 JSON 形式（便于肉眼核对）
//   fixtures/README.md              怎么用
//
// 用法：node tools/gen-fixture-data.mjs [--seconds 30] [--players 10] [--rate 64]
import fs from 'node:fs';
import path from 'node:path';
import {
  MAGIC, VERSION, HEADER_BYTES, ALIGN,
  FLAG_ACCURACY, FLAG_RELOADING, FLAG_PLAYER_FLAGS, FLAG_PANELS,
  FRAME_COLS, FRAME_OPT_COLS, PANEL_COLS,
  computeLayout, crc32,
} from './csdf-format.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);

// ── 参数 ──
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const TICK_RATE = 64;
const SECONDS = arg('seconds', 30);
const NUM_PLAYERS = arg('players', 10);
const SAMPLE_RATE = arg('rate', 64);
const PANEL_EVERY = 8; // panelFrames 的采样间隔（故意与 frames 不同！）

const numFrames = SECONDS * SAMPLE_RATE;
const numPlayers = NUM_PLAYERS;
const frameTicks = Array.from({ length: numFrames }, (_, i) => 1000 + Math.round((i * TICK_RATE) / SAMPLE_RATE));
// panelFrames 用另一套 tick（每 8 tick 一个）—— 演示「两套 tick 可以不同」
const panelTicks = [];
for (let t = frameTicks[0]; t <= frameTicks[frameTicks.length - 1]; t += PANEL_EVERY) panelTicks.push(t);
const panelNumFrames = panelTicks.length;

const flags = FLAG_ACCURACY | FLAG_RELOADING | FLAG_PLAYER_FLAGS | FLAG_PANELS;

// ── 造数据 ──
const F = {
  frameTick: Int32Array.from(frameTicks),
  posX: new Float32Array(numFrames * numPlayers),
  posY: new Float32Array(numFrames * numPlayers),
  posZ: new Float32Array(numFrames * numPlayers),
  yaw: new Float32Array(numFrames * numPlayers),
  pitch: new Float32Array(numFrames * numPlayers),
  health: new Uint8Array(numFrames * numPlayers),
  alive: new Uint8Array(numFrames * numPlayers),
  team: new Uint8Array(numFrames * numPlayers),
  score: new Uint8Array(numFrames * numPlayers),
  duck: new Float32Array(numFrames * numPlayers),
  flash: new Float32Array(numFrames * numPlayers),
  flashAlpha: new Float32Array(numFrames * numPlayers),
  zoom: new Uint8Array(numFrames * numPlayers),
  accuracyPenalty: new Float32Array(numFrames * numPlayers).fill(-1),
  reloading: new Uint8Array(numFrames * numPlayers),
  playerFlags: new Uint8Array(numFrames * numPlayers),
};

// de_mirage 大致中心，10 人绕圈走、T/CT 分两侧
const CENTER = { x: -300, y: -500, z: 0 };
for (let f = 0; f < numFrames; f++) {
  const t = f / SAMPLE_RATE;
  const tick = F.frameTick[f];
  for (let p = 0; p < numPlayers; p++) {
    const i = f * numPlayers + p;
    const isT = p < numPlayers / 2;
    const slotInTeam = isT ? p : p - numPlayers / 2;
    const side = isT ? -1 : 1;
    const radius = 320 + slotInTeam * 36;
    const phase = (slotInTeam * 2 * Math.PI) / (numPlayers / 2) + t * 0.22;
    // 绕圈：位置
    F.posX[i] = CENTER.x + side * 260 + Math.cos(phase) * radius;
    F.posY[i] = CENTER.y + side * 180 + Math.sin(phase) * radius;
    F.posZ[i] = CENTER.z + Math.sin(t * 0.9 + p) * 8;
    // 朝向：切线方向。单位是「度」，归一化到 (-180, 180]
    const yawDeg = ((phase * 180) / Math.PI + 90) % 360;
    F.yaw[i] = yawDeg > 180 ? yawDeg - 360 : yawDeg;
    F.pitch[i] = Math.sin(t * 1.7 + p) * 6; // 度，±6°
    // 状态：每 5 秒一次「阵亡→复活」演示
    const cycle = Math.floor(t / 5);
    const died = ((p + cycle) % 7 === 0) && t % 5 > 3.2;
    F.alive[i] = died ? 0 : 1;
    F.health[i] = died ? 0 : Math.max(1, 100 - Math.floor(t * 2 + p * 3) % 100);
    F.team[i] = isT ? 2 : 3;
    F.score[i] = Math.floor((t / 5) * 2) % 16; // 双方比分随时间涨
    F.duck[i] = Math.sin(t * 0.6 + p) > 0.85 ? 0.8 : 0;
    F.flash[i] = p === 3 && t > 10 && t < 11.5 ? 1.5 - (t - 10) : 0;
    F.flashAlpha[i] = F.flash[i] > 0 ? 0.8 : 0;
    F.zoom[i] = p === 1 && t > 6 && t < 9 ? 2 : 0;
    F.accuracyPenalty[i] = F.zoom[i] ? 0.02 : -1;
    F.reloading[i] = p % 3 === 0 && t % 3 < 0.4 ? 1 : 0;
    F.playerFlags[i] = p === 0 && isT ? 4 : 0; // bit2 = 携带 C4
    void tick;
  }
}

const P = {
  panelFrameTick: Int32Array.from(panelTicks),
  panelHealth: new Uint8Array(panelNumFrames * numPlayers),
  panelAlive: new Uint8Array(panelNumFrames * numPlayers),
  panelTeam: new Uint8Array(panelNumFrames * numPlayers),
  panelArmor: new Uint8Array(panelNumFrames * numPlayers),
  panelFlags: new Uint8Array(panelNumFrames * numPlayers),
  panelMoney: new Uint16Array(panelNumFrames * numPlayers),
  panelEquipValue: new Uint16Array(panelNumFrames * numPlayers),
  panelClipAmmo: new Uint16Array(panelNumFrames * numPlayers),
  panelReserveAmmo: new Uint16Array(panelNumFrames * numPlayers),
  panelActiveWeapon: new Uint8Array(panelNumFrames * numPlayers),
  panelUtilCounts: new Uint8Array(panelNumFrames * numPlayers),
};
for (let m = 0; m < panelNumFrames; m++) {
  const t = m * PANEL_EVERY / TICK_RATE;
  for (let p = 0; p < numPlayers; p++) {
    const i = m * numPlayers + p;
    P.panelHealth[i] = Math.max(1, 100 - Math.floor(t * 2 + p * 3) % 100);
    P.panelAlive[i] = 1;
    P.panelTeam[i] = p < numPlayers / 2 ? 2 : 3;
    P.panelArmor[i] = p % 2 ? 100 : 0;
    P.panelFlags[i] = (p % 2 ? 1 : 0) | (p % 3 === 0 ? 2 : 0); // bit0 头盔, bit1 拆弹器
    P.panelMoney[i] = 800 + ((p * 137 + m * 7) % 4200);
    P.panelEquipValue[i] = 1000 + ((p * 311) % 4000);
    P.panelClipAmmo[i] = 30;
    P.panelReserveAmmo[i] = 90;
    P.panelActiveWeapon[i] = p % 3; // 索引进 weaponNames
    P.panelUtilCounts[i] = (p & 3) | (((p + 1) & 3) << 2) | (((p + 2) & 3) << 4) | (((p + 3) & 3) << 6);
  }
}

// ── 序列化 ──
const layout = computeLayout({ numFrames, numPlayers, panelNumFrames, flags });
const buf = Buffer.alloc(layout.totalBytes);

// Header
buf.writeUInt32LE(MAGIC, 0);
buf.writeUInt32LE(VERSION, 4);
buf.writeInt32LE(frameTicks[0], 8);
buf.writeInt32LE(frameTicks[frameTicks.length - 1], 12);
buf.writeInt32LE(numFrames, 16);
buf.writeInt32LE(numPlayers, 20);
buf.writeInt32LE(panelNumFrames, 24);
buf.writeInt32LE(flags, 28);
buf.writeUInt32LE(0, 32); // crc 稍后回填
buf.writeUInt32LE(0, 36);
buf.writeBigUInt64LE(BigInt(layout.totalBytes - HEADER_BYTES), 40);
buf.writeBigUInt64LE(BigInt(layout.totalBytes), 48);
buf.writeBigUInt64LE(0n, 56);

const writeCol = (name, offset) => {
  const arr = F[name] ?? P[name];
  if (!arr) throw new Error(`缺少列 ${name}`);
  const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  b.copy(buf, offset);
};
for (const blk of layout.blocks) writeCol(blk.name, blk.offset);

// 回填 CRC
const payload = buf.subarray(HEADER_BYTES);
const crc = crc32(payload);
buf.writeUInt32LE(crc, 32);

// ── manifest ──
const rounds = [];
const roundSeconds = 5;
for (let r = 0; r < SECONDS / roundSeconds; r++) {
  const s = frameTicks[0] + r * roundSeconds * TICK_RATE;
  rounds.push({ startTick: s, endTick: s + roundSeconds * TICK_RATE - 1, liveStartTick: s + 3 * TICK_RATE });
}
const manifest = {
  mapName: 'de_mirage',
  tickRate: TICK_RATE,
  startTick: frameTicks[0],
  endTick: frameTicks[frameTicks.length - 1],
  durationSeconds: (frameTicks[frameTicks.length - 1] - frameTicks[0]) / TICK_RATE,
  rounds,
  players: Array.from({ length: numPlayers }, (_, p) => ({
    slot: p,
    steamId: String(76561198000000000n + BigInt(p)), // 必须是字符串！
    name: `${p < numPlayers / 2 ? 'T' : 'CT'}-Player-${p}`,
    crosshairCode: p % 2 ? 'CSGO-abcde-fghij-klmno-pqrst-uvwxy' : undefined,
    clanName: p < numPlayers / 2 ? 'TeamAlpha' : 'TeamBravo',
    color: p % 5,
  })),
  weaponNames: ['ak47', 'm4a1', 'awp', 'deagle', 'knife'],
  // 提示：manifest 里用「players/weaponNames」，data 里用「players」——见 docs/07
};

// ── JSON 侧车（便于肉眼核对首尾各 2 帧）──
const sample = (f) => {
  const o = {};
  for (const [name] of FRAME_COLS) {
    o[name] = name === 'frameTick' ? F.frameTick[f] : F[name].slice(f * numPlayers, (f + 1) * numPlayers).join(',');
  }
  for (const [name, , , fl] of FRAME_OPT_COLS) if (flags & fl) o[name] = F[name].slice(f * numPlayers, (f + 1) * numPlayers).join(',');
  return o;
};
const sidecar = {
  format: 'CSDF v1',
  header: { startTick: frameTicks[0], endTick: frameTicks[frameTicks.length - 1], numFrames, numPlayers, panelNumFrames, flags, crc32: '0x' + crc.toString(16) },
  layout: layout.blocks,
  totalBytes: layout.totalBytes,
  frameSample: { frame0: sample(0), frameLast: sample(numFrames - 1) },
  panelFrameTicks: panelTicks.slice(0, 8),
  note: 'panelFrames 的 tick 与 frames 的 tick 是两套独立集合（本文件故意设成 8 tick 一个）',
};

// ── 落盘 ──
const outDir = R('fixtures');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, 'segment-000.bin'), buf);
fs.writeFileSync(path.join(outDir, 'segment-000.json'), JSON.stringify(sidecar, null, 2), 'utf8');
fs.writeFileSync(
  path.join(outDir, 'README.md'),
  `# fixtures — CSDF v1 参照数据

由 \`node tools/gen-fixture-data.mjs\` 生成，**格式绝对正确**，可直接作为 C++ 侧的输出对照物。

| 文件 | 内容 |
| --- | --- |
| \`manifest.json\` | 会话级数据（只发一次）：地图、tick 率、整场起止、回合表、玩家表、武器名表 |
| \`segment-000.bin\` | 一段的二进制正文（CSDF v1，小端，每块 64 字节对齐） |
| \`segment-000.json\` | 同一段的 JSON 侧车：header 字段、各块偏移/长度、首末帧抽样值 |

## 本次生成参数

- 时长 ${SECONDS} 秒 @ 采样率 ${SAMPLE_RATE} Hz → **${numFrames} 帧**
- 玩家 ${numPlayers} 人（${numPlayers / 2} T + ${numPlayers / 2} CT）
- panelFrames 每 ${PANEL_EVERY} tick 一帧 → **${panelNumFrames} 帧**（故意与 frames 的 tick 集合不同）
- 总大小 ${layout.totalBytes} 字节

## 怎么用

1. **C++ 侧**：照 \`tools/csdf-format.mjs\` 里的 header 定义和各列顺序实现写出，然后用
   \`node tools/validate-fixture-data.mjs fixtures/segment-000.bin\` 自检——校验通过说明格式对齐了。
2. **JS 侧**：\`segment-000.json\` 里有首末帧的抽样值，可直接与播放器实际渲染的值对比。
3. 改参数重生成：\`node tools/gen-fixture-data.mjs --seconds 60 --players 10\`

## 格式要点（完整定义见 \`tools/csdf-format.mjs\` 与 \`docs/07\` 附录 A）

- 索引公式：\`值 = 数组[帧序号 * numPlayers + 玩家序号]\`
- \`frameTick\` 必须是**严格升序的绝对 tick 号**
- \`yaw\`/\`pitch\` 单位是**度**，不是弧度
- \`steamId\` 必须是**字符串**
- \`team\` 是数值 2(T) / 3(CT)
- 每块起点 64 字节对齐
`,
  'utf8',
);

console.log('生成完成：');
console.log(`  fixtures/manifest.json`);
console.log(`  fixtures/segment-000.bin      ${layout.totalBytes} 字节`);
console.log(`  fixtures/segment-000.json`);
console.log(`  fixtures/README.md`);
console.log(`  ${numFrames} 帧 × ${numPlayers} 人；panelFrames ${panelNumFrames} 帧；flags=0x${flags.toString(16)}；crc32=0x${crc.toString(16)}`);
