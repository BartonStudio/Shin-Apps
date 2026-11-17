/* 自动生成：node tools/gen-cs2-inject.mjs —— 不要手改本文件（改 gen 脚本或 shared-buffer.js） */
(function () {
// ============================================================================
// shared-buffer.js —— WebView2 共享内存 ↔ 渲染层 data 的桥
// ============================================================================
//
// 这是「原生 C++ 产出数据 / JS 只读渲染」这条链路的 JS 端全部代码。
// 设计说明见 docs/08-cpp-integration.md（§3.4 布局 / §3.5 发布协议 / §3.6 接法）。
//
// ── 内存布局（在 CSDF v1 之上扩展）─────────────────────────────────────────
//
//   [0, 64)                       CSDF header（沿用 tools/csdf-format.mjs 的定义）
//   [64, 64+1MB)                  元数据区 A：u32 len + utf8 JSON + 补 0
//   [64+1MB, 64+2MB)              元数据区 B：同上
//   [64+2MB, …)                   列块数据区（每块起点 64 字节对齐）
//
// 为什么要 A/B 两份元数据：bomb.segments / deathMarkers / rounds.liveStartTick
// 这三类数据在回合粒度下仍会「回头改已发布区域」；双份按 version 奇偶交替写，
// JS 读当前版本那份，彻底避免撕裂。代价 2 MB 常驻，对比 61 MB 数据可忽略。
//
// ── 两类数据走不同通道 ─────────────────────────────────────────────────────
//
//   大块 TypedArray 列（frames / panelFrames / tracers / damage / weaponFires /
//   smokeVoxels 的数据体）→ 列块区，JS 建 TypedArray **视图**，零拷贝。
//
//   结构复杂的少量对象（rounds / players / weaponNames / events / grenades /
//   bomb / deathMarkers / timeouts / droppedWeapons / mapEntities /
//   deathRagdolls）→ 元数据区 JSON，JS 每回合 JSON.parse 一次
//   （约 100 KB/回合，代价可忽略；换来 C++ 侧不用自己设计二进制编码）。
//
// ── 水位从消息来，不从内存读 ────────────────────────────────────────────────
//
//   跨进程的普通内存读没有内存序保证，而 WebView2 给的是普通 ArrayBuffer
//   （不是 SharedArrayBuffer，Atomics 不可用），补不了内存序。
//   所以可见帧数/回合数/时长一律由 postMessage 携带 —— 消息投递本身就是
//   happens-before 边界。见 docs/08 §3.5。
//
// ============================================================================

// ── 与 CSDF v1 一致的常量（改动时须与 tools/csdf-format.mjs 同步，测试会交叉校验）
const CSDF_MAGIC = 0x46445343; // 'CSDF'
const CSDF_VERSION = 1;
const CSDF_HEADER_BYTES = 64;
const CSDF_ALIGN = 64;

const FLAG_ACCURACY = 1 << 0;
const FLAG_RELOADING = 1 << 1;
const FLAG_PLAYER_FLAGS = 1 << 2;
const FLAG_PANELS = 1 << 3;
const FLAG_SPEED = 1 << 4;
const FLAG_SMOOTH_SPEED = 1 << 5;

// ── 共享内存专属常量 ───────────────────────────────────────────────────────
/** 单个元数据区容量（A、B 各一份）。实测真实 demo 的元数据 JSON 约 300 KB，1 MB 绰绰有余 */
const META_REGION_BYTES = 1 << 20;
const META_A_OFFSET = CSDF_HEADER_BYTES;
const META_B_OFFSET = META_A_OFFSET + META_REGION_BYTES;
/** 列块数据区起点（= 64 + 2 MB） */
const DATA_OFFSET = META_B_OFFSET + META_REGION_BYTES;

const TYPE_SIZE = { i32: 4, f32: 4, u8: 1, u16: 2 };
const TYPE_CTOR = { i32: Int32Array, f32: Float32Array, u8: Uint8Array, u16: Uint16Array };

// ═══════════════════════════════════════════════════════════════════════════
// 列定义
// ═══════════════════════════════════════════════════════════════════════════
// basis 含义：
//   TICK  → 长度 = visibleFrames
//   NP    → 长度 = visibleFrames * numPlayers
//   PTICK → 长度 = panelVisibleFrames
//   MP    → 长度 = panelVisibleFrames * numPlayers
//   C     → 长度 = counts[countKey] * mult   （区间数据，条目数由元数据区给出）

const FRAME_COLS = [
  ['frameTick', 'i32', 'TICK'],
  ['posX', 'f32', 'NP'], ['posY', 'f32', 'NP'], ['posZ', 'f32', 'NP'],
  ['yaw', 'f32', 'NP'], ['pitch', 'f32', 'NP'],
  ['health', 'u8', 'NP'], ['alive', 'u8', 'NP'], ['team', 'u8', 'NP'], ['score', 'u8', 'NP'],
  ['duck', 'f32', 'NP'], ['flash', 'f32', 'NP'], ['flashAlpha', 'f32', 'NP'],
  ['zoom', 'u8', 'NP'],
];

const FRAME_OPT_COLS = [
  ['accuracyPenalty', 'f32', 'NP', FLAG_ACCURACY],
  ['reloading', 'u8', 'NP', FLAG_RELOADING],
  ['playerFlags', 'u8', 'NP', FLAG_PLAYER_FLAGS],
  ['speed', 'f32', 'NP', FLAG_SPEED],
  ['smoothSpeed', 'f32', 'NP', FLAG_SMOOTH_SPEED],
];

const PANEL_COLS = [
  ['panelFrameTick', 'i32', 'PTICK'],
  ['panelHealth', 'u8', 'MP'], ['panelAlive', 'u8', 'MP'], ['panelTeam', 'u8', 'MP'],
  ['panelArmor', 'u8', 'MP'], ['panelFlags', 'u8', 'MP'],
  ['panelMoney', 'u16', 'MP'], ['panelClipAmmo', 'u16', 'MP'], ['panelReserveAmmo', 'u16', 'MP'],
  ['panelActiveWeapon', 'u8', 'MP'], ['panelUtilCounts', 'u8', 'MP'],
];

// 区间数据：条目数由元数据区的 counts 决定
const EXTRA_COLS = [
  // name,             type,  countKey,          mult
  ['tracers.origin', 'f32', 'tracers', 3],
  ['tracers.end', 'f32', 'tracers', 3],
  ['tracers.tick', 'i32', 'tracers', 1],
  ['tracers.team', 'u8', 'tracers', 1],
  ['tracers.hitKind', 'u8', 'tracers', 1],

  ['damage.attackerSlot', 'u8', 'damage', 1],
  ['damage.victimSlot', 'u8', 'damage', 1],
  ['damage.tick', 'i32', 'damage', 1],
  ['damage.dmg', 'u8', 'damage', 1],

  ['weaponFires.ticks', 'i32', 'weaponFires', 1],
  ['weaponFires.slots', 'u8', 'weaponFires', 1],

  ['smokeVoxels.tickBegin', 'i32', 'smokeCount', 1],
  ['smokeVoxels.detonation', 'f32', 'smokeCount', 3],
  ['smokeVoxels.color', 'f32', 'smokeCount', 3],
  ['smokeVoxels.bufferOffsets', 'i32', 'smokeCountPlus1', 1],
  ['smokeVoxels.frameOffsets', 'i32', 'smokeCountPlus1', 1],
  ['smokeVoxels.buffers', 'u8', 'smokeBufferBytes', 1],
  ['smokeVoxels.frameTicks', 'i32', 'smokeFrameTicks', 1],
];

/** counts 里必须有这些键（值为 0 也要给） */
const REQUIRED_COUNTS = [
  'tracers', 'damage', 'weaponFires',
  'smokeCount', 'smokeCountPlus1', 'smokeBufferBytes', 'smokeFrameTicks',
  'blobBytes',
];

const alignUp = (n) => Math.ceil(n / CSDF_ALIGN) * CSDF_ALIGN;

// ═══════════════════════════════════════════════════════════════════════════
// blob 区：变长 TypedArray 的容器
// ═══════════════════════════════════════════════════════════════════════════
// 为什么需要它：grenades.trajectories（17.6 万个点）、grenades.infernos（带嵌套帧）、
// droppedWeapons（3.8 万个 tick）、mapEntities 这些结构里都嵌着变长数组。
// 直接 JSON 化实测会膨胀到 28.9 MB（真实 demo），每回合 parse 一次不可接受。
//
// 做法：JSON 里只存引用 { o: 字节偏移, n: 元素个数, t: 类型 }，数组本体按 8 字节对齐
// 顺序拼进一块连续 blob。JS 读取时 new Float32Array(ab, BLOB 起点 + o, n) —— 零拷贝。
const BLOB_ALIGN = 8;

const toF32 = (x) => (x instanceof Float32Array ? x : Float32Array.from(x ?? []));
const toI32 = (x) => (x instanceof Int32Array ? x : Int32Array.from(x ?? []));
const toU8 = (x) => (x instanceof Uint8Array ? x : Uint8Array.from(x ?? []));

function makeBlob() {
  const parts = [];
  let bytes = 0;
  const ref = (typed) => {
    if (!typed || typed.length === 0) return null;
    const t = typed instanceof Float32Array ? 'f32'
      : typed instanceof Int32Array ? 'i32'
        : typed instanceof Uint16Array ? 'u16'
          : typed instanceof Uint8Array ? 'u8' : null;
    if (!t) throw new Error(`blob: 不支持 ${typed.constructor?.name}`);
    const o = bytes;
    parts.push({ o, typed });
    bytes = Math.ceil((bytes + typed.length * typed.BYTES_PER_ELEMENT) / BLOB_ALIGN) * BLOB_ALIGN;
    return { o, n: typed.length, t };
  };
  return { parts, ref, get bytes() { return bytes; } };
}

/** 把 blob 里的引用解析成视图（零拷贝）；ref 为 null 时返回 undefined */
function resolveBlobRef(ab, blobOffset, ref) {
  if (!ref) return undefined;
  const Ctor = TYPE_CTOR[ref.t];
  if (!Ctor) throw new Error(`blob: 未知类型 ${ref.t}`);
  return new Ctor(ab, blobOffset + ref.o, ref.n);
}


// ═══════════════════════════════════════════════════════════════════════════
// 布局计算 —— C++ 侧照这个实现（写一次，读多次）
// ═══════════════════════════════════════════════════════════════════════════
/**
 * 计算整块共享内存的布局。
 * @param {object} p
 * @param {number} p.numFrames        帧容量 N（整段 demo 的总帧数，不是可见数）
 * @param {number} p.numPlayers       P
 * @param {number} p.panelNumFrames   面板帧容量 M
 * @param {number} p.flags
 * @param {object} p.counts           区间数据条目数（见 REQUIRED_COUNTS）
 * @returns {{blocks: Array, totalBytes: number}}
 */
function computeSharedLayout({ numFrames, numPlayers, panelNumFrames, flags, counts }) {
  const blocks = [];
  let off = DATA_OFFSET;

  const len = (type, count) => count * TYPE_SIZE[type];
  const push = (name, type, count) => {
    const bytes = len(type, count);
    const padded = alignUp(bytes);
    blocks.push({ name, type, offset: off, length: bytes, padded, count });
    off += padded;
  };

  const N = numFrames;
  const P = numPlayers;
  const M = panelNumFrames;

  for (const [name, type, basis] of FRAME_COLS) {
    push(name, type, basis === 'TICK' ? N : N * P);
  }
  for (const [name, type, basis, flag] of FRAME_OPT_COLS) {
    if (flags & flag) push(name, type, basis === 'TICK' ? N : N * P);
  }
  if (flags & FLAG_PANELS) {
    for (const [name, type, basis] of PANEL_COLS) {
      push(name, type, basis === 'PTICK' ? M : M * P);
    }
  }
  for (const [name, type, countKey, mult] of EXTRA_COLS) {
    const c = counts[countKey];
    if (c === undefined) throw new Error(`computeSharedLayout: counts 缺少 ${countKey}`);
    push(name, type, c * mult);
  }

  // blob 区：变长 TypedArray 的容器（见 makeBlob 的说明）
  const blobBytes = counts.blobBytes ?? 0;
  if (blobBytes > 0) {
    const padded = Math.ceil(blobBytes / BLOB_ALIGN) * BLOB_ALIGN;
    blocks.push({ name: 'blob', type: 'u8', offset: off, length: blobBytes, padded, count: blobBytes });
    off += padded;
  }
  return { blocks, totalBytes: off };
}

/** 整块共享内存应该申请多少字节 */
function sharedBufferBytes(layout) {
  return alignUp(layout.totalBytes);
}

// ═══════════════════════════════════════════════════════════════════════════
// 写入（参考实现；C++ 照这个顺序写。也用于生成测试镜像）
// ═══════════════════════════════════════════════════════════════════════════

/** 从 data 里推出 flags（可选列是否存在） */
function deriveFlags(F) {
  return (F.accuracyPenalty ? FLAG_ACCURACY : 0)
    | (F.reloading ? FLAG_RELOADING : 0)
    | (F.playerFlags ? FLAG_PLAYER_FLAGS : 0)
    | FLAG_PANELS
    | (F.speed ? FLAG_SPEED : 0)
    | (F.smoothSpeed ? FLAG_SMOOTH_SPEED : 0);
}

/** 从 data 里推出各区间数据的条目数 */
function deriveCounts(data) {
  const sv = data.smokeVoxels ?? {};
  return {
    tracers: data.tracers?.count ?? 0,
    damage: data.damage?.count ?? 0,
    weaponFires: data.weaponFires?.ticks?.length ?? 0,
    smokeCount: sv.count ?? 0,
    smokeCountPlus1: (sv.count ?? 0) + 1,
    smokeBufferBytes: sv.buffers?.length ?? 0,
    smokeFrameTicks: sv.frameTicks?.length ?? 0,
    blobBytes: 0,          // 由 planSharedBuffer 填
  };
}

/**
 * 规划一块共享内存：算出 JSON 元数据、blob 内容、布局和总字节数。
 *
 * 顺序很重要 —— blob 的大小取决于元数据里引用了哪些数组，
 * 所以必须先建 JSON 再算布局。
 *
 * @returns {{meta, blob, layout, bytes, flags, counts}}
 */
function planSharedBuffer(data) {
  const F = data.frames, PF = data.panelFrames, META = data.meta;
  const N = F.frameTick.length;
  const P = META.numPlayers;
  const M = PF.frameTick.length;

  const counts = deriveCounts(data);
  const flags = deriveFlags(F);

  const blob = makeBlob();
  const meta = buildMetaJson(data, counts, blob);
  counts.blobBytes = blob.bytes;

  const layout = computeSharedLayout({ numFrames: N, numPlayers: P, panelNumFrames: M, flags, counts });
  return { meta, blob, layout, bytes: sharedBufferBytes(layout), flags, counts, N, P, M };
}

/** 便捷：这块 data 需要多大的共享内存 */
function sharedBufferBytesFor(data) {
  return planSharedBuffer(data).bytes;
}

/**
 * 把一份完整 data 写进共享内存镜像。
 *
 * ⚠️ 真实场景下 C++ 是**边解析边追加**，不会一次性写完。
 *    这个函数是"全量写一遍"的参考实现 —— 写入顺序与增量写入完全一致：
 *    列块 → blob → 元数据区（A/B）→ header（相当于"提交"）。
 *
 * @param {ArrayBuffer} ab
 * @param {object} data
 * @param {object} opts
 * @param {number} [opts.version]      版本号（奇偶决定写 A 还是 B 元数据区）
 * @param {string} [opts.altRegion]    'A' | 'B' 强制指定（测试用）
 */
function writeSharedBuffer(ab, data, { version, altRegion } = {}) {
  const plan = planSharedBuffer(data);
  const { layout, blob, meta, bytes } = plan;
  if (ab.byteLength < bytes) throw new Error(`缓冲不足：需要 ${bytes}，实际 ${ab.byteLength}`);

  const dv = new DataView(ab);
  const blockOf = (n) => layout.blocks.find((b) => b.name === n);
  const put = (blockName, src) => {
    const b = blockOf(blockName);
    if (!b || !src) return;
    new Uint8Array(ab, b.offset, b.length).set(new Uint8Array(src.buffer, src.byteOffset, src.length * src.BYTES_PER_ELEMENT));
  };

  // ── ① 列块数据区 ──
  const F = data.frames, PF = data.panelFrames;
  for (const [name, , basis] of FRAME_COLS) put(name, basis === 'TICK' ? F.frameTick : F[name]);
  for (const [name, , , flag] of FRAME_OPT_COLS) if (plan.flags & flag) put(name, F[name]);

  // panelFrames 的列名在 data 里去掉 `panel` 前缀并首字母小写
  //   panelHealth → health / panelFrameTick → frameTick / panelClipAmmo → clipAmmo
  const panelField = (n) => (n === 'panelFrameTick' ? 'frameTick' : n[5].toLowerCase() + n.slice(6));
  for (const [name, , basis] of PANEL_COLS) put(name, basis === 'PTICK' ? PF.frameTick : PF[panelField(name)]);

  put('tracers.origin', data.tracers.origin);
  put('tracers.end', data.tracers.end);
  put('tracers.tick', data.tracers.tick);
  put('tracers.team', data.tracers.team);
  put('tracers.hitKind', data.tracers.hitKind);
  put('damage.attackerSlot', data.damage.attackerSlot);
  put('damage.victimSlot', data.damage.victimSlot);
  put('damage.tick', data.damage.tick);
  put('damage.dmg', data.damage.dmg);
  put('weaponFires.ticks', data.weaponFires.ticks);
  put('weaponFires.slots', data.weaponFires.slots);
  const sv = data.smokeVoxels;
  for (const k of ['tickBegin', 'detonation', 'color', 'bufferOffsets', 'frameOffsets', 'buffers', 'frameTicks']) put(`smokeVoxels.${k}`, sv[k]);

  // ── ② blob 区（变长 TypedArray）──
  const blobBlock = blockOf('blob');
  if (blobBlock) {
    for (const { o, typed } of blob.parts) {
      new Uint8Array(ab, blobBlock.offset + o, typed.length * typed.BYTES_PER_ELEMENT)
        .set(new Uint8Array(typed.buffer, typed.byteOffset, typed.length * typed.BYTES_PER_ELEMENT));
    }
  }

  // ── ③ 元数据区（JSON，A/B 按 version 奇偶交替）──
  const useA = altRegion ? altRegion === 'A' : (version ?? 0) % 2 === 0;
  writeMetaRegion(ab, useA ? META_A_OFFSET : META_B_OFFSET, meta);

  // ── ④ header（最后写，相当于"提交"）──
  dv.setUint32(0, CSDF_MAGIC, true);
  dv.setUint32(4, CSDF_VERSION, true);
  dv.setInt32(8, meta.startTick, true);
  dv.setInt32(12, F.frameTick[plan.N - 1] ?? meta.startTick, true);
  dv.setInt32(16, plan.N, true);
  dv.setInt32(20, plan.P, true);
  dv.setInt32(24, plan.M, true);
  dv.setInt32(28, plan.flags, true);
  dv.setUint32(32, 0, true);                 // crc32：共享内存场景不做全量校验
  dv.setUint32(36, 0, true);
  dv.setBigUint64(40, BigInt(layout.totalBytes - CSDF_HEADER_BYTES), true);
  dv.setBigUint64(48, BigInt(bytes), true);
  dv.setBigUint64(56, 0n, true);

  return { layout, bytes, useA, plan };
}

function writeMetaRegion(ab, offset, meta) {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  if (json.length + 4 > META_REGION_BYTES) {
    throw new Error(`元数据超出单区容量：${json.length}B > ${META_REGION_BYTES - 4}B`);
  }
  new DataView(ab).setUint32(offset, json.length, true);
  new Uint8Array(ab, offset + 4, json.length).set(json);
}

// ── 元数据 JSON 的构造（供 planSharedBuffer 调用）──
function buildMetaJson(data, counts, blob) {
  const G = data.grenades ?? {};
  return {
    mapName: data.meta.mapName,
    tickRate: data.meta.tickRate,
    sampleRate: data.meta.sampleRate,
    startTick: data.meta.startTick,
    durationSeconds: data.meta.durationSeconds,
    rounds: data.rounds ?? [],
    players: data.players ?? [],
    weaponNames: data.weaponNames ?? [],
    events: data.events ?? [],
    bomb: data.bomb ?? { segments: [], defuses: [] },
    deathMarkers: data.deathMarkers ?? [],
    timeouts: data.timeouts ?? { maxTacticalTimeouts: 0, intervals: [], counters: [] },
    deathRagdolls: data.deathRagdolls ?? [],
    droppedWeapons: (data.droppedWeapons ?? []).map((w) => flattenDroppedWeapon(w, blob)),
    mapEntities: (data.mapEntities ?? []).map((m) => flattenMapEntity(m, blob)),
    grenades: {
      // 变长数组走 blob 引用；标量留在 JSON 里
      trajectories: (G.trajectories ?? []).map((tr) => ({
        kind: tr.kind, throwerSlot: tr.throwerSlot,
        startTick: tr.startTick, endTick: tr.endTick, detonationTick: tr.detonationTick,
        posXYZ: blob.ref(toF32(tr.posXYZ)),
        ticks: blob.ref(toI32(tr.ticks)),
        angles: blob.ref(tr.angles ? toF32(tr.angles) : null),
        incendiary: tr.incendiary,
      })),
      effects: G.effects ?? [],
      infernos: (G.infernos ?? []).map((n) => ({
        entityId: n.entityId, startTick: n.startTick, endTick: n.endTick,
        effectTick: n.effectTick, infernoType: n.infernoType, lifetime: n.lifetime,
        frames: (n.frames ?? []).map((f) => ({
          tick: f.tick,
          positions: blob.ref(toF32(f.positions)),
          burning: blob.ref(toU8(f.burning)),
          origin: blob.ref(toF32(f.origin)),
          parentPositions: blob.ref(toF32(f.parentPositions)),
          normals: blob.ref(toF32(f.normals)),
        })),
      })),
    },
    counts,
  };
}

function flattenDroppedWeapon(w, blob) {
  return {
    entityId: w.entityId, weapon: w.weapon, itemDef: w.itemDef,
    startTick: w.startTick, endTick: w.endTick,
    ticks: blob.ref(toI32(w.ticks)),
    positions: blob.ref(w.positions ? toF32(w.positions) : null),
    angles: blob.ref(w.angles ? toF32(w.angles) : null),
  };
}

function flattenMapEntity(m, blob) {
  return {
    className: m.className,
    origin: blob.ref(toF32(m.origin)),
    startTick: m.startTick, endTick: m.endTick,
    ticks: blob.ref(toI32(m.ticks)),
    angles: blob.ref(toF32(m.angles)),
    hidden: blob.ref(toU8(m.hidden)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 读取 —— JS 侧主路径
// ═══════════════════════════════════════════════════════════════════════════
function readSharedHeader(ab) {
  const dv = new DataView(ab);
  const magic = dv.getUint32(0, true);
  if (magic !== CSDF_MAGIC) throw new Error(`shared-buffer: magic 不符（0x${magic.toString(16)}）`);
  return {
    version: dv.getUint32(4, true),
    startTick: dv.getInt32(8, true),
    endTick: dv.getInt32(12, true),
    numFramesCapacity: dv.getInt32(16, true),
    numPlayers: dv.getInt32(20, true),
    panelCapacity: dv.getInt32(24, true),
    flags: dv.getInt32(28, true),
    totalBytes: Number(dv.getBigUint64(48, true)),
  };
}

function readMetaRegionAt(ab, offset) {
  const dv = new DataView(ab);
  const len = dv.getUint32(offset, true);
  if (len === 0 || len > META_REGION_BYTES - 4) throw new Error(`shared-buffer: 元数据区长度异常 ${len}`);
  const bytes = new Uint8Array(ab, offset + 4, len);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** 按 version 奇偶挑元数据区，复制出独立副本（避免与 C++ 原地重写别名） */
function readMetaRegion(ab, version, which) {
  const pick = which ?? ((version ?? 0) % 2 === 0 ? 'A' : 'B');
  return readMetaRegionAt(ab, pick === 'A' ? META_A_OFFSET : META_B_OFFSET);
}

/**
 * 共享内存 → 渲染层 data。
 *
 * 关键：所有视图的 length 都按 **visible** 里的可见长度构造（不是容量），
 * 于是 frameTick.length == visibleFrames，`numFrames` getter / `findFrame()` 二分 /
 * 采样器 `duration` 全部自动正确 —— 现有代码一行都不用改。
 *
 * @param {ArrayBuffer} ab
 * @param {object} visible  { version, loadedRounds, visibleFrames, panelVisibleFrames, durationSeconds }
 * @param {object} [opts]   { metaRegion: 'A'|'B' } 强制指定（测试用）
 */
function buildDataFromSharedBuffer(ab, visible, opts = {}) {
  const hdr = readSharedHeader(ab);
  const meta = readMetaRegion(ab, visible.version, opts.metaRegion);

  const P = hdr.numPlayers;
  const N = visible.visibleFrames;
  const M = visible.panelVisibleFrames;
  if (!(N >= 0) || N > hdr.numFramesCapacity) throw new Error(`visibleFrames ${N} 超出容量 ${hdr.numFramesCapacity}`);
  if (!(M >= 0) || M > hdr.panelCapacity) throw new Error(`panelVisibleFrames ${M} 超出容量 ${hdr.panelCapacity}`);

  const counts = meta.counts;
  const layout = computeSharedLayout({
    numFrames: hdr.numFramesCapacity,
    numPlayers: P,
    panelNumFrames: hdr.panelCapacity,
    flags: hdr.flags,
    counts,
  });

  // blob 块偏移（变长 TypedArray 都从这里切）
  const blobBlock = layout.blocks.find((b) => b.name === 'blob');
  const blobOffset = blobBlock ? blobBlock.offset : 0;
  const deref = (ref) => resolveBlobRef(ab, blobOffset, ref);

  // ── 建视图（零拷贝）：length 一律用可见数 ──
  const frames = {};
  const panelFrames = { numFrames: M };
  const extra = {};
  const visibleCount = (basis, countKey, mult) => {
    switch (basis) {
      case 'TICK': return N;
      case 'NP': return N * P;
      case 'PTICK': return M;
      case 'MP': return M * P;
      default: return counts[countKey] * mult;
    }
  };

  for (const b of layout.blocks) {
    const Ctor = TYPE_CTOR[b.type];
    let n;
    const fc = FRAME_COLS.find((c) => c[0] === b.name);
    const fo = FRAME_OPT_COLS.find((c) => c[0] === b.name);
    const pc = PANEL_COLS.find((c) => c[0] === b.name);
    const ex = EXTRA_COLS.find((c) => c[0] === b.name);
    if (fc) n = visibleCount(fc[2]);
    else if (fo) n = visibleCount(fo[2]);
    else if (pc) n = visibleCount(pc[2]);
    else if (ex) n = visibleCount('C', ex[2], ex[3]);
    else continue;

    const view = new Ctor(ab, b.offset, n);
    if (fc) frames[b.name] = view;
    else if (pc) panelFrames[b.name === 'panelFrameTick' ? 'frameTick' : b.name[5].toLowerCase() + b.name.slice(6)] = view;
    else if (ex) {
      const [group, field] = b.name.split('.');
      (extra[group] ??= {})[field] = view;
    }
    // FRAME_OPT_COLS 也是 frames 的列
    if (fo) frames[b.name] = view;
  }

  // ── 组装 data（元数据区里的对象数组每回合 JSON.parse 一次，独立副本）──
  const data = {
    meta: {
      mapName: meta.mapName,
      tickRate: meta.tickRate,
      sampleRate: meta.sampleRate,
      numPlayers: P,
      numFrames: N,
      startTick: meta.startTick,                                   // ★ 恒为 manifest.startTick
      endTick: N > 0 ? frames.frameTick[N - 1] : meta.startTick,
      durationSeconds: visible.durationSeconds ?? meta.durationSeconds,
    },
    players: meta.players,
    rounds: meta.rounds,
    weaponNames: meta.weaponNames,
    frames,
    panelFrames,
    events: meta.events,
    bomb: meta.bomb,
    deathMarkers: meta.deathMarkers,
    timeouts: meta.timeouts,
    // 下面三组里的变长数组是从 blob 切出来的视图（零拷贝）
    droppedWeapons: meta.droppedWeapons.map((w) => ({
      entityId: w.entityId, weapon: w.weapon, itemDef: w.itemDef,
      startTick: w.startTick, endTick: w.endTick,
      ticks: deref(w.ticks),
      positions: deref(w.positions),
      angles: deref(w.angles),
    })),
    // ⚠️ 注意：这里 origin / ticks / angles / hidden 读回来都是 **TypedArray 视图**，
    //    而本地解析路径里 mapEntities[].origin 是普通数组（其余三个本来就是 TypedArray）。
    //    下游只做下标访问与迭代（origin[0..2]、angles[0..2]、for...of），功能无差；
    //    如果将来有人对它用 Array.isArray() 判断，需要留意这一点。
    mapEntities: meta.mapEntities.map((m) => ({
      className: m.className,
      origin: deref(m.origin),
      startTick: m.startTick, endTick: m.endTick,
      ticks: deref(m.ticks),
      angles: deref(m.angles),
      hidden: deref(m.hidden),
    })),
    deathRagdolls: meta.deathRagdolls,
    grenades: {
      trajectories: meta.grenades.trajectories.map((tr) => ({
        kind: tr.kind, throwerSlot: tr.throwerSlot,
        startTick: tr.startTick, endTick: tr.endTick, detonationTick: tr.detonationTick,
        posXYZ: deref(tr.posXYZ),
        ticks: deref(tr.ticks),
        angles: deref(tr.angles),
        incendiary: tr.incendiary,
      })),
      effects: meta.grenades.effects,
      infernos: meta.grenades.infernos.map((n) => ({
        entityId: n.entityId, startTick: n.startTick, endTick: n.endTick,
        effectTick: n.effectTick, infernoType: n.infernoType, lifetime: n.lifetime,
        frames: n.frames.map((f) => ({
          tick: f.tick,
          positions: deref(f.positions),
          burning: deref(f.burning),
          origin: deref(f.origin),
          parentPositions: deref(f.parentPositions),
          normals: deref(f.normals),
        })),
      })),
    },
    tracers: {
      origin: extra.tracers.origin, end: extra.tracers.end,
      tick: extra.tracers.tick, team: extra.tracers.team, hitKind: extra.tracers.hitKind,
      count: counts.tracers,
    },
    damage: {
      attackerSlot: extra.damage.attackerSlot, victimSlot: extra.damage.victimSlot,
      tick: extra.damage.tick, dmg: extra.damage.dmg, count: counts.damage,
    },
    weaponFires: { ticks: extra.weaponFires.ticks, slots: extra.weaponFires.slots },
    smokeVoxels: {
      count: counts.smokeCount,
      tickBegin: extra.smokeVoxels.tickBegin,
      detonation: extra.smokeVoxels.detonation,
      color: extra.smokeVoxels.color,
      bufferOffsets: extra.smokeVoxels.bufferOffsets,
      buffers: extra.smokeVoxels.buffers,
      frameOffsets: extra.smokeVoxels.frameOffsets,
      frameTicks: extra.smokeVoxels.frameTicks,
    },
  };
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// 自检：只在开发期调一次，把读到的布局全打印出来
// ═══════════════════════════════════════════════════════════════════════════
// 为什么要它：C++ 侧布局算错一个 offset，现象是"画面全乱"或"人瞬移"，很难反推。
// 有这份清单，一眼就能看出是偏移错了还是数据错了。
function describeSharedBuffer(ab) {
  const hdr = readSharedHeader(ab);
  const lines = [];
  lines.push(`CSDF v${hdr.version}  P=${hdr.numPlayers}  N(容量)=${hdr.numFramesCapacity}  M(容量)=${hdr.panelCapacity}`);
  lines.push(`flags=0x${hdr.flags.toString(16)}  startTick=${hdr.startTick}  endTick=${hdr.endTick}  总字节=${hdr.totalBytes}`);
  for (const which of ['A', 'B']) {
    try {
      const m = readMetaRegionAt(ab, which === 'A' ? META_A_OFFSET : META_B_OFFSET);
      lines.push(`元数据区 ${which}: mapName=${m.mapName} rounds=${m.rounds.length} players=${m.players.length} ` +
        `weaponNames=${m.weaponNames.length} events=${m.events.length} ` +
        `trajectories=${m.grenades.trajectories.length} infernos=${m.grenades.infernos.length}`);
      lines.push(`  counts: ${JSON.stringify(m.counts)}`);
    } catch (e) {
      lines.push(`元数据区 ${which}: 不可读（${e.message}）`);
    }
  }
  const blobIdx = ['A', 'B'].map((w) => {
    try {
      const m = readMetaRegionAt(ab, w === 'A' ? META_A_OFFSET : META_B_OFFSET);
      const layout = computeSharedLayout({
        numFrames: hdr.numFramesCapacity, numPlayers: hdr.numPlayers,
        panelNumFrames: hdr.panelCapacity, flags: hdr.flags, counts: m.counts,
      });
      const b = layout.blocks.find((x) => x.name === 'blob');
      return `${w}: blob ${b ? (b.length / 1048576).toFixed(2) + ' MB' : '无'}（${m.counts.blobBytes} B）`;
    } catch { return `${w}: 不可读`; }
  });
  lines.push(`blob 区: ${blobIdx.join('   ')}`);
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 接入 WebView2
// ═══════════════════════════════════════════════════════════════════════════
/**
 * 绑定 WebView2 的共享 buffer 与回合消息。
 *
 * 依赖外部注入的两个工厂函数（避免本模块硬依赖被裁减的 app 文件）：
 *   createApp(data, options, manifest, loadedRounds) → app 实例
 *
 * @param {object} deps
 * @param {Function} deps.createApp
 * @param {Function} [deps.onError]
 */
function bindSharedBuffer({ createApp, onError } = {}) {
  if (!globalThis.chrome?.webview) throw new Error('bindSharedBuffer: 不在 WebView2 环境');

  const state = { ab: null, app: null, version: 0, pendingMsg: null, lifecycle: [] };

  const makeManifest = (data) => ({
    mapName: data.meta.mapName,
    tickRate: data.meta.tickRate,
    startTick: data.meta.startTick,
    endTick: data.meta.endTick,
    durationSeconds: data.meta.durationSeconds,
    rounds: data.rounds,
  });

  const applyMessage = (msg) => {
    const data = buildDataFromSharedBuffer(state.ab, msg);

    if (!state.app) {
      // 首次：创建（构造末尾会立刻 sampleAndRender(0) + clock.play() + rAF）
      state.app = createApp(data, { source: 'native', parseMs: 0 }, makeManifest(data), msg.loadedRounds);
      lifecycle(state, 'created', msg);
      return;
    }

    // 后续：热替换。返回 false 说明不能复用（players 顺序变了等），必须重建
    if (!state.app.replaceRoundData(data, msg.loadedRounds)) {
      const playback = state.app.getPlaybackState();
      state.app.dispose();
      state.app = createApp(data, { source: 'native', parseMs: 0 }, makeManifest(data), msg.loadedRounds);
      state.app.restorePlaybackState(playback);
      lifecycle(state, 'rebuilt', msg);
    } else {
      lifecycle(state, 'replaced', msg);
    }
  };

  const lifecycle = (s, kind, msg) => {
    s.lifecycle.push({ kind, version: msg.version, loadedRounds: msg.loadedRounds, visibleFrames: msg.visibleFrames });
    if (s.lifecycle.length > 64) s.lifecycle.shift();
  };

  // ① buffer：整个生命周期只来一次（换 demo 时再来）
  chrome.webview.addEventListener('sharedbufferreceived', (e) => {
    state.ab = e.getBuffer();
    if (state.pendingMsg) {
      const m = state.pendingMsg;
      state.pendingMsg = null;
      try { applyMessage(m); } catch (err) { onError?.(err); }
    }
  });

  // ② 水位：每回合一条，水位以消息为准（不从共享内存读 —— 见文件头说明）
  chrome.webview.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (typeof msg?.version !== 'number') return;
    if (msg.version <= state.version) return;      // 去重 + 防乱序
    state.version = msg.version;
    if (!state.ab) { state.pendingMsg = msg; return; }   // buffer 还没到
    try { applyMessage(msg); } catch (err) { onError?.(err); }
  });

  return {
    state,
    get app() { return state.app },
    /** 主动停止监听（换 demo / 卸载时用） */
    dispose() { state.app?.dispose?.(); state.app = null; state.ab = null; },
  };
}

/** 回合消息的形状（C++ 侧照这个发） */
const ROUND_MESSAGE_FIELDS = Object.freeze([
  'version',              // 单调递增
  'loadedRounds',         // 已发布到第几个回合（1 起）
  'visibleFrames',        // frames 可见帧数（= N）
  'panelVisibleFrames',   // panelFrames 可见帧数（= M）
  'durationSeconds',      // 已可播时长
]);


(() => {
  const log = (s) => { try { window.__playbackLog.push(s); console.log('[cs2-native] ' + s); } catch (e) {} };
  window.__playbackLog = [];

  // ── 宿主数据通道 ──
  let csdfBuffer = null;   // ArrayBuffer（宿主 SendBinaryWithType("csdf") 推来）
  let readyMsg = null;     // 水位消息（csdf-ready：version/loadedRounds/visibleFrames/…）

  try {
    const wv = window.chrome && window.chrome.webview;
    if (!wv) throw new Error('chrome.webview 不可用（不在 WebView2 宿主里？）');
    wv.addEventListener('sharedbufferreceived', (e) => {
      try {
        // WebView2 各版本 additionalData 形态不一：可能是对象 / JSON 字符串 / 挂在
        // e.additionalData / 干脆为 null。本应用只推一种二进制（csdf），null 时直接认。
        let meta = e.data ?? e.additionalData ?? null;
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
        const type = meta && meta.type;
        log('SB event: type=' + (type ?? '(null)'));
        if (!type || type === 'csdf') {
          csdfBuffer = e.getBuffer();
          log('契约数据块已收到: ' + (csdfBuffer.byteLength / 1048576).toFixed(1) + ' MB');
          tryStart();
        }
      } catch (err) { log('sharedbufferreceived error: ' + err.message); }
    });
    wv.addEventListener('message', (e) => {
      try {
        const d = e.data;
        log('msg event: typeof=' + typeof d + ' ' + (d && typeof d === 'object' ? 'type=' + d.type : String(d).slice(0, 80)));
        if (d && typeof d === 'object' && d.type === 'csdf-ready') {
          readyMsg = d;
          log('csdf-ready: version=' + d.version + ' visible=' + d.visibleFrames);
          tryStart();
        }
      } catch (err) { log('message error: ' + err.message); }
    });
    log('宿主通道已挂接');
  } catch (e) {
    log('宿主通道不可用: ' + e.message);
  }

  function buildPayload() {
    if (!csdfBuffer) throw new Error('契约数据块尚未就绪');
    if (!readyMsg) throw new Error('水位消息尚未就绪');
    const data = buildDataFromSharedBuffer(csdfBuffer, readyMsg);
    const manifest = {
      mapName: data.meta.mapName,
      tickRate: data.meta.tickRate,
      startTick: data.meta.startTick,
      endTick: data.meta.endTick,
      durationSeconds: data.meta.durationSeconds,
      rounds: data.rounds,
    };
    return { data, manifest };
  }

  // ── worker 替身（同 tools/inject.mjs）──
  function makeShim(url) {
    const msgHandlers = [];
    const errHandlers = [];
    const self = {
      _onmessage: null,
      set onmessage(fn) { self._onmessage = fn; },
      get onmessage() { return self._onmessage; },
      set onerror(fn) { errHandlers.push(fn); },
      addEventListener(t, fn) { if (t === 'message') msgHandlers.push(fn); else if (t === 'error') errHandlers.push(fn); },
      removeEventListener() {},
      terminate() {},
      postMessage(msg) { handle(msg); },
    };
    const emit = (obj) => {
      const ev = { data: obj };
      try { self._onmessage && self._onmessage(ev); } catch (e) { log('onmessage threw: ' + e.message); }
      for (const h of msgHandlers) { try { h(ev); } catch (e) { log('listener threw: ' + e.message); } }
    };
    async function handle(msg) {
      log('worker<- ' + (msg && msg.type));
      if (!msg || msg.type !== 'parse') return;
      try {
        emit({ type: 'progress', phase: 'Loading from native host…', value: 0.04 });
        const t0 = performance.now();
        const { data, manifest } = buildPayload();
        log('data built in ' + Math.round(performance.now() - t0) + 'ms; N=' + data.meta.numFrames);
        emit({ type: 'manifest', manifest });
        emit({ type: 'progress', phase: 'Loaded from native host', value: 1 });
        emit({ type: 'ready', data, manifest, loadedRounds: data.rounds.length });
        emit({ type: 'done', data });
        log('emitted ready+done');
      } catch (e) {
        log('shim error: ' + ((e && e.stack) || e));
        emit({ type: 'error', message: String((e && e.message) || e) });
      }
    }
    return self;
  }

  const RealWorker = window.Worker;
  function PatchedWorker(url, opts) {
    const u = String(url);
    if (u.includes('parser.worker')) {
      log('intercepted parser worker: ' + u.split('/').pop());
      return makeShim(u);
    }
    return new RealWorker(url, opts);
  }
  PatchedWorker.prototype = RealWorker.prototype;
  window.Worker = PatchedWorker;
  log('Worker patched');

  // ── 自动触发：csdf-ready 后塞假 File 启动应用的解析流程 ──
  let triggered = false;
  function tryStart(attempt) {
    if (triggered || !csdfBuffer || !readyMsg) return;
    const input = document.getElementById('fileInput');
    if (!input) {
      if (attempt < 300) setTimeout(() => tryStart(attempt === undefined ? 0 : attempt + 1), 100);
      else log('auto-trigger gave up: #fileInput not found');
      return;
    }
    try {
      triggered = true;
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(16)], 'native.dem', { type: 'application/octet-stream' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      log('auto-triggered #fileInput');
    } catch (e) {
      triggered = false;
      log('auto-trigger failed: ' + e.message);
    }
  }
})();
})();
