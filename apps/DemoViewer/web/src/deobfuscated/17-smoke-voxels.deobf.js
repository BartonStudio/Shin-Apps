// ============================================================================
// 反混淆版本：烟雾体素解码（SmokeVoxelTrack）
// 原始压缩文件：src/app/17-smoke-voxels.js
// 原文范围：decompiled/index.beautified.js L39544–39727（切片 17-smoke-voxels）
// 压缩类名：tO
// 说明：CS2 烟雾弹的"体素化"烟雾数据解码器。demo 里的烟雾不是粒子，而是
//   一个 32×32×32 的体素网格（occupancy grid），每帧记录哪些体素被烟雾占据。
//   数据以紧凑的二进制格式存储（种子点 + 增量更新），这里负责解码 + 查询：
//     - decode()：从 ArrayBuffer 解析出帧序列（种子点、逐帧增量）
//     - occupancyAtFrame()：重建某帧的完整体素占用图
//     - seedPointsAtFrame()：取某帧的"种子点"（烟雾的离散采样点）
//  体素坐标 0..31 存 5 bit，用 Morton/位交错编码压缩进整数。
// ============================================================================

// 体素网格边长 32，总体素 32³
const VOXEL_SIZE = 32;
const VOXEL_COUNT = VOXEL_SIZE ** 3; // rO = 32768

// 6 个面邻接方向
const FACE_NEIGHBORS = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
];

// 预计算表（Morton 编码 ↔ 体素索引 ↔ 坐标 ↔ 邻居）
const mortonToIndex = new Uint16Array(VOXEL_COUNT);      // aO
const mortonToCoord = new Uint8Array(VOXEL_COUNT * 3);   // oO
const mortonToNeighbors = new Int32Array(VOXEL_COUNT * 6); // sO

/**
 * 位交错（Morton 编码）：把 x/y/z 各 5 bit 交错成一个 15 bit 整数
 * 原函数：cO(e, t, n)
 */
function mortonEncode(x, y, z) {
  let r = 0;
  for (let i = 0; i < 5; i++) {
    r |= ((x >> i) & 1) << (i * 3);
    r |= ((y >> i) & 1) << (i * 3 + 1);
    r |= ((z >> i) & 1) << (i * 3 + 2);
  }
  return r;
}

/**
 * Morton 反解码：把交错整数拆成 n 位三元组 [x,y,z]
 * 原函数：QD(e, t)，t 为每个坐标占用的 bit 数
 */
function mortonDecode(m, bits) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < bits; i++) {
    x |= ((m >> (3 * i)) & 1) << i;
    y |= ((m >> (3 * i + 1)) & 1) << i;
    z |= ((m >> (3 * i + 2)) & 1) << i;
  }
  return [x, y, z];
}

// 64bit 位图里每个 bit 在 4×4×4 块内的坐标偏移（原 $D，预计算 64×3）
const DECODE_TABLE = (() => {
  const table = new Int8Array(192);
  for (let bit = 0; bit < 64; bit++) {
    const [x, y, z] = mortonDecode(bit, 2);
    table[bit * 3] = x;
    table[bit * 3 + 1] = y;
    table[bit * 3 + 2] = z;
  }
  return table;
})();

// 单帧最大增量更新数（原 ZD）
const MAX_UPDATES = 512;

/**
 * 解码体素增量更新列表（原 eO）：每项 10 字节 = base(2B) + lo(4B) + hi(4B)
 * @param {Uint8Array} buf
 * @param {number} offset 起始
 * @param {number} count 更新数
 * @param {Array} out 输出 {base, lo, hi} 列表
 */
function decodeUpdates(buf, offset, count, out) {
  if (count > MAX_UPDATES || offset + count * 10 + 1 !== buf.length || buf[buf.length - 1] !== 0) return false;
  let i = offset;
  for (let k = 0; k < count; k++) {
    const base = buf[i] | (buf[i + 1] << 8);
    if (base >= MAX_UPDATES) return false;
    const lo = (buf[i + 2] | (buf[i + 3] << 8) | (buf[i + 4] << 16) | (buf[i + 5] << 24)) >>> 0;
    const hi = (buf[i + 6] | (buf[i + 7] << 8) | (buf[i + 8] << 16) | (buf[i + 9] << 24)) >>> 0;
    out.push({ base, lo, hi });
    i += 10;
  }
  return true;
}

// 初始化预计算表
for (let x = 0; x < 32; x++)
  for (let y = 0; y < 32; y++)
    for (let z = 0; z < 32; z++) {
      const m = mortonEncode(x, y, z);
      mortonToIndex[m] = x + 32 * (y + 32 * z);
      mortonToCoord.set([x, y, z], m * 3);
      FACE_NEIGHBORS.forEach(([dx, dy, dz], face) => {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        mortonToNeighbors[m * 6 + face] =
          Math.min(nx, ny, nz) < 0 || Math.max(nx, ny, nz) >= 32 ? -1 : mortonEncode(nx, ny, nz);
      });
    }

class SmokeVoxelTrack {
  tickBegin;         // 起始 tick
  endTick;           // 结束 tick
  frameCount;        // 帧数
  color;             // 烟雾颜色（RGB 0..1）
  detonation;        // 起爆位置
  seedPoints;        // 初始种子点
  frameEndOffsets;   // 每帧在原始缓冲中的结束偏移
  hasRecordedTiming; // 是否有显式记录的时间戳
  frameTicks;        // 每帧对应的 tick
  frameUpdates;      // 每帧的增量更新（体素 set/delete 操作）
  phase;             // 每帧的相位（0=扩散，1=消散）
  seedUpdates;       // 每帧的种子点更新

  cur = new Map();   // 当前体素占用缓存：morton → {lo, hi}（64bit 位图）
  curFrame = -1;     // 缓存对应的帧号

  constructor(tickBegin, color, detonation, frameUpdates, phase, seedUpdates, frameEndOffsets, frameTicks) {
    this.tickBegin = tickBegin;
    this.color = color;
    this.detonation = detonation;
    this.frameUpdates = frameUpdates;
    this.phase = phase;
    this.seedUpdates = seedUpdates;
    this.seedPoints = seedUpdates[0] ?? [];
    this.frameEndOffsets = frameEndOffsets;
    this.frameCount = frameUpdates.length;
    this.hasRecordedTiming = frameTicks !== undefined;
    // 无显式时间戳时，按每帧 7 tick 推算
    this.frameTicks = frameTicks?.slice() ?? Int32Array.from({ length: this.frameCount }, (_, i) => tickBegin + i * 7);
    this.endTick = this.frameTicks[this.frameCount - 1];
  }

  /** 消散帧：phase 数组中第一个值为 1 的帧索引（烟雾开始消散的时刻） */
  get dissipationFrame() {
    for (let i = 0; i < this.phase.length; i++) if (this.phase[i] === 1) return i;
    return this.phase.length;
  }

  /**
   * 从原始字节流解码烟雾体素轨道
   * @param {Uint8Array} buf 二进制数据
   * @param {number} tickBegin 起始 tick
   * @param {number[]} color 烟雾颜色 [r,g,b]（0..255）
   * @param {number[]} detonation 起爆位置 [x,y,z]
   * @param {Int32Array=} frameTicks 显式帧时间戳（可选）
   * @returns {SmokeVoxelTrack|null}
   */
  static decode(buf, tickBegin, color, detonation, frameTicks) {
    // 解析成"帧"列表：每帧 = 2 字节长度 + payload
    const frames = [];
    let offset = 0;
    while (offset + 4 <= buf.length) {
      const frameIndex = buf[offset] | (buf[offset + 1] << 8);
      const payloadLen = buf[offset + 2] | (buf[offset + 3] << 8);
      const start = offset + 4;
      const end = start + payloadLen;
      if (end > buf.length || frameIndex !== frames.length) return null;
      frames.push({ payload: buf.subarray(start, end), end });
      offset = end;
    }
    if (frames.length === 0 || offset !== buf.length) return null;
    // 校验显式时间戳单调递增
    if (frameTicks) {
      if (frameTicks.length !== frames.length) return null;
      for (let i = 0; i < frameTicks.length; i++)
        if (i > 0 && frameTicks[i] < frameTicks[i - 1]) return null;
    }

    // 逐帧解码
    const phase = [];
    const seedUpdates = [];
    const frameUpdates = [];
    const frameEndOffsets = new Int32Array(frames.length);

    for (let f = 0; f < frames.length; f++) {
      const payload = frames[f].payload;
      if (payload.length < 3 || payload[0] > 1 || payload[1] & -4) return null;

      const flags = payload[1]; // bit0=有种子点，bit1=有增量
      let r = 2;
      let seeds = null;

      // 解码种子点（bit0）
      if (flags & 1) {
        const count = payload[r++];
        if (r + count * 8 >= payload.length) return null;
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        seeds = [];
        for (let i = 0; i < count; i++, r += 8) {
          if (payload[r] >= 32 || payload[r + 1] >= 32 || payload[r + 2] >= 32 || !Number.isFinite(view.getFloat32(r + 4, true))) return null;
          seeds.push({
            x: payload[r], y: payload[r + 1], z: payload[r + 2],
            flag: payload[r + 3],
            extra: view.getUint32(r + 4, true),
          });
        }
      }

      // 解码体素增量更新（bit1）
      const updates = [];
      if (flags & 2) {
        if (r + 2 > payload.length) return null;
        const count = payload[r] | (payload[r + 1] << 8);
        if (!decodeUpdates(payload, r + 2, count, updates)) return null;
      } else if (r + 1 !== payload.length || payload[r] !== 0) {
        return null; // 无增量时必须是单个 0 字节
      }

      phase.push(payload[0]);
      seedUpdates.push(seeds);
      frameUpdates.push(updates);
      frameEndOffsets[f] = frames[f].end;
    }

    // 首帧必须有种子点
    if (!seedUpdates[0] || frameUpdates[0].length === 0) return null;

    return new SmokeVoxelTrack(
      tickBegin,
      [color[0] / 255, color[1] / 255, color[2] / 255],
      [detonation[0], detonation[1], detonation[2]],
      frameUpdates, phase, seedUpdates, frameEndOffsets, frameTicks,
    );
  }

  /** 二分查找：tick → 帧索引（最后满足 frameTicks[i] <= tick 的帧） */
  frameForTick(tick) {
    let lo = 0, hi = this.frameCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      this.frameTicks[mid] <= tick ? (lo = mid + 1) : (hi = mid);
    }
    return Math.max(0, lo - 1);
  }

  /** 帧索引 → tick */
  tickForFrame(frame) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.frameCount)
      throw new RangeError(`Invalid smoke frame`);
    return this.frameTicks[frame];
  }

  /** tick → 混合系数（0..1，用于帧间淡入淡出） */
  blendForTick(tick) {
    const f = Math.fround((tick - this.tickForFrame(this.frameForTick(tick))) / 64);
    return Math.min(1, Math.max(0, Math.fround(f * 10)));
  }

  seedPointsAtTick(tick) { return this.seedPointsAtFrame(this.frameForTick(tick)); }

  /** 取某帧的种子点（向前回溯最近的非空种子更新） */
  seedPointsAtFrame(frame) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.frameCount)
      throw new RangeError(`Invalid smoke frame`);
    for (let i = frame; i >= 0; i--) {
      const s = this.seedUpdates[i];
      if (s !== null) return s;
    }
    return [];
  }

  /** 把体素占用缓存推进到指定帧 */
  seekTo(frame) {
    if (frame < this.curFrame) { this.cur.clear(); this.curFrame = -1; }
    for (let f = this.curFrame + 1; f <= frame; f++)
      for (const upd of this.frameUpdates[f])
        // lo=0 && hi=0 表示删除该体素，否则写入 64bit 位图
        upd.lo === 0 && upd.hi === 0 ? this.cur.delete(upd.base) : this.cur.set(upd.base, { lo: upd.lo, hi: upd.hi });
    this.curFrame = frame;
  }

  occupancyAtTick(tick, out) { return this.occupancyAtFrame(this.frameForTick(tick), out); }

  /**
   * 重建某帧的完整体素占用图
   * @param {number} frame 帧索引
   * @param {Uint8Array} out 输出占用图（长度 VOXEL_COUNT）
   * @returns {number} 被占据的体素数量
   */
  occupancyAtFrame(frame, out) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.frameCount)
      throw new RangeError(`Invalid smoke frame`);
    out.fill(0);
    this.seekTo(frame);
    let count = 0;
    for (const [morton, bits] of this.cur) {
      // Morton 反解出体素块基坐标（×4 因为 64bit 位图存的是 4×4×4 块）
      const [bx, by, bz] = mortonDecode(morton, 4);
      const baseX = bx * 4, baseY = by * 4, baseZ = bz * 4;
      for (let bit = 0; bit < 64; bit++) {
        // 位图：低 32 位在 lo，高 32 位在 hi
        if (!(bit < 32 ? (bits.lo >>> bit) & 1 : (bits.hi >>> (bit - 32)) & 1)) continue;
        const lx = baseX + DECODE_TABLE[bit * 3];
        const ly = baseY + DECODE_TABLE[bit * 3 + 1];
        const lz = baseZ + DECODE_TABLE[bit * 3 + 2];
        out[lx + 32 * (ly + 32 * lz)] = 1;
        count++;
      }
    }
    return count;
  }
}
