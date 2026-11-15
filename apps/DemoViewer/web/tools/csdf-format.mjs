// CSDF（CSDemo Segment Fixture）二进制分段格式定义 —— 唯一真源。
// 生成器 gen-fixture-data.mjs 与校验器 validate-fixture-data.mjs 共用本文件。
//
// 设计目标：让 C++ 侧能逐字节对照实现，让 JS 侧能机械校验。
//
// ┌── 文件整体 ────────────────────────────────────────────────────────────┐
// │  Header  64 字节（小端）                                                │
// │  Block 1 .. Block N，每块起点按 64 字节对齐（不足补 0）                  │
// └────────────────────────────────────────────────────────────────────────┘
//
// Header（64 字节，全部小端）
//   偏移  类型      字段              说明
//   ----  --------  ----------------  ------------------------------------
//   0     u32       magic             0x46445343 = "CSDF"
//   4     u32       version           1
//   8     i32       startTick         本段首 tick（含）
//   12    i32       endTick           本段末 tick（含）
//   16    i32       numFrames         N = frames.frameTick.length
//   20    i32       numPlayers        P
//   24    i32       panelNumFrames    M = panelFrames.frameTick.length（无面板时为 0）
//   28    i32       flags             bit0=accuracyPenalty bit1=reloading
//                                     bit2=playerFlags     bit3=含 panelFrames
//   32    u32       payloadCrc32      对 [HEADER_BYTES, totalBytes) 求 CRC-32
//   36    u32       reserved          0
//   40    u64       payloadBytes      totalBytes - HEADER_BYTES
//   48    u64       totalBytes        文件总长
//   56    u64       reserved2         0
//
// 说明：
//   · 所有数组为「列存 SoA」，索引公式 值 = 数组[帧序号 * P + 玩家序号]
//   · 每块起点 64 字节对齐，块间补 0
//   · frameTick 必须是严格升序的绝对 tick 号
//   · yaw / pitch 单位是「度」（不是弧度）

export const MAGIC = 0x46445343; // 'CSDF'
export const VERSION = 1;
export const HEADER_BYTES = 64;
export const ALIGN = 64;

export const FLAG_ACCURACY = 1 << 0;
export const FLAG_RELOADING = 1 << 1;
export const FLAG_PLAYER_FLAGS = 1 << 2;
export const FLAG_PANELS = 1 << 3;
// 速度两列（见 src/deobfuscated/speed-columns.js）。语义不同，必须分开存：
//   speed       瞬时水平速度（相邻采样帧差分，含 alive/team/回合边界守卫）
//   smoothSpeed 1 秒指数加权平均速度（时间常数 0.1s），驱动角色动画混合
export const FLAG_SPEED = 1 << 4;
export const FLAG_SMOOTH_SPEED = 1 << 5;

// 类型 → 单元素字节数
export const TYPE_SIZE = { i32: 4, f32: 4, u8: 1, u16: 2 };

// frames 列（顺序即文件中的写入顺序，不可调换）
// [字段名, 类型, 长度基准] ：'TICK' = N，'NP' = N*P
export const FRAME_COLS = [
  ['frameTick', 'i32', 'TICK'],
  ['posX', 'f32', 'NP'],
  ['posY', 'f32', 'NP'],
  ['posZ', 'f32', 'NP'],
  ['yaw', 'f32', 'NP'],
  ['pitch', 'f32', 'NP'],
  ['health', 'u8', 'NP'],
  ['alive', 'u8', 'NP'],
  ['team', 'u8', 'NP'],
  ['score', 'u8', 'NP'],
  ['duck', 'f32', 'NP'],
  ['flash', 'f32', 'NP'],
  ['flashAlpha', 'f32', 'NP'],
  ['zoom', 'u8', 'NP'],
];

// 可选 frames 列（由 flags 决定是否出现）
export const FRAME_OPT_COLS = [
  ['accuracyPenalty', 'f32', 'NP', FLAG_ACCURACY],
  ['reloading', 'u8', 'NP', FLAG_RELOADING],
  ['playerFlags', 'u8', 'NP', FLAG_PLAYER_FLAGS],
  ['speed', 'f32', 'NP', FLAG_SPEED],
  ['smoothSpeed', 'f32', 'NP', FLAG_SMOOTH_SPEED],
];

// panelFrames 列（M*P 长度；frameTick 为 M）
export const PANEL_COLS = [
  ['panelFrameTick', 'i32', 'PTICK'],
  ['panelHealth', 'u8', 'MP'],
  ['panelAlive', 'u8', 'MP'],
  ['panelTeam', 'u8', 'MP'],
  ['panelArmor', 'u8', 'MP'],
  ['panelFlags', 'u8', 'MP'],
  ['panelMoney', 'u16', 'MP'],
  ['panelClipAmmo', 'u16', 'MP'],
  ['panelReserveAmmo', 'u16', 'MP'],
  ['panelActiveWeapon', 'u8', 'MP'],
  ['panelUtilCounts', 'u8', 'MP'],
];

export function blockLength(col, N, P, M) {
  const [, type, basis] = col;
  const n = basis === 'TICK' ? N : basis === 'PTICK' ? M : basis === 'NP' ? N * P : M * P;
  return n * TYPE_SIZE[type];
}

// 把长度向上取整到 ALIGN 的倍数
export const alignUp = (n) => Math.ceil(n / ALIGN) * ALIGN;

// CRC-32（Node >= 22.2 的 zlib.crc32）
import zlib from 'node:zlib';
export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  // 兜底实现（表驱动）
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 布局计算：返回每个块的 {name,type,offset,length,padded}
export function computeLayout({ numFrames: N, numPlayers: P, panelNumFrames: M, flags }) {
  const blocks = [];
  let off = HEADER_BYTES;
  const push = (col) => {
    const len = blockLength(col, N, P, M);
    const padded = alignUp(len);
    blocks.push({ name: col[0], type: col[1], offset: off, length: len, padded });
    off += padded;
  };
  for (const c of FRAME_COLS) push(c);
  for (const c of FRAME_OPT_COLS) if (flags & c[3]) push(c);
  if (flags & FLAG_PANELS) for (const c of PANEL_COLS) push(c);
  return { blocks, totalBytes: off };
}

// 契约约束（校验器与文档共用）
export const CONSTRAINTS = {
  team: [0, 2, 3],
  alive: [0, 1],
  zoom: [0, 1, 2],
  health: [0, 100],
  duck: [0, 1],
  yawDeg: [-360, 360],
  pitchDeg: [-90, 90],
  // 上限取宽一点：瞬时速度没有硬钳制（600 的钳制只作用于 EMA 内部），
  // 极端情况下相邻帧位移可能偏大。实测最大值 310.79。
  speed: [0, 5000],
  smoothSpeed: [0, 5000],
};
