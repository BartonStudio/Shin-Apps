// ─────────────────────────────────────────────────────────────────────────────
// 31-hosted-demo.deobf.js — CSDA 容器格式的完整二进制解码器 + 托管 demo 下载
//
// 来源：src/app/31-hosted-demo.js（Vite 生产构建，prettier 展开版）
// 原文范围：decompiled/index.beautified.js L49470–50816（切片 31-hosted-demo）
// 原始压缩名：CF = ByteReader，Z = DecodeError，Q = TypedArrayTag，等
//
// 本文件是 csdemo.tv 的核心数据层。它负责：
//   1. ByteReader（CF）—— 一个带严格边界检查、varint 解码、错误定位的二进制读取器。
//   2. 21 个 section 的逐字段解码函数（core / frames / events / rounds / grenades /
//      infernos / droppedWeapons / weaponFires / mapEntities / playerColors /
//      deathRagdolls / smokeVoxels / tracers / panels / deathMarkers / damage /
//      bomb / timeouts / derivationInputs）。
//   3. Manifest（清单）的严格 JSON 校验，以及 artifact 头部（CSDA 魔数 + manifest
//      长度 + sha256）的完整性校验。
//   4. decodeArtifact（qI）—— 把所有 section 串起来解码，并做大量跨 section 的
//      一致性交叉校验（numPlayers、tickRate、durationSeconds 等）。
//   5. gzip 解压（DecompressionStream）、sha256 校验（Web Crypto）。
//
// 说明：标识符已重命名成语义化名字，局部单字母变量展开，关键逻辑补注释。
//       未改任何语义。
// ─────────────────────────────────────────────────────────────────────────────

// ── 常量（这些在压缩版里是模块级 const，此处集中定义） ────────────────────────

// TypedArray 的类型标签（序列化时用 1 字节标识数组元素类型）
const TypedArrayTag = {
  None: 0,
  Float32: 1,
  Int32: 2,
  Uint8: 3,
  Uint16: 4,
  Float64: 5,
};

// 合法类型标签集合（用于校验 readTypedArray 读到的标签）
const VALID_TYPEDARRAY_TAGS = new Set([
  TypedArrayTag.None,
  TypedArrayTag.Float32,
  TypedArrayTag.Int32,
  TypedArrayTag.Uint8,
  TypedArrayTag.Uint16,
  TypedArrayTag.Float64,
]);

// 各类型标签对应的字节宽度
function typedArrayByteWidth(tag) {
  switch (tag) {
    case TypedArrayTag.Float32:
      return 4;
    case TypedArrayTag.Int32:
      return 4;
    case TypedArrayTag.Uint16:
      return 2;
    case TypedArrayTag.Float64:
      return 8;
    case TypedArrayTag.Uint8:
      return 1;
    default:
      return 1;
  }
}

// 各种上限常量
const MAX_ARRAY_COUNT = 1 << 20; // xF —— 单个数组元素数量上限
const MAX_BYTE_BLOCK = 1073741824; // yF —— 1 GiB，字节块长度上限
const MAX_STRING_BYTES = 1 << 20; // bF —— 字符串字节长度上限
const MAX_MANIFEST_BYTES = 8388608; // gF —— manifest 长度上限（8 MiB）
const CONTAINER_FORMAT = 'csdemo-artifact'; // uF —— 容器格式标识
const MAGIC_BYTES = 'csdemo-artifact'; // lF —— 魔数字符串（与格式一致）
const SUPPORTED_CONTAINER_VERSIONS = new Set([1]); // hF
const TICK_RATE = 64; // dF —— CS2 固定 64 tick 假设
const SUPPORTED_CODECS = ['raw', 'gzip']; // fF

// 死亡布娃娃每 tick 的最小记录字节数（用于 readArrayLength 的预检）
const RAGDOLL_STRIDE = 30; // cI

// 已知的 section 定义表（pF）—— id + kind（canonical / derived）
// 用于解码时校验 manifest 中声明的 kind 是否与解码器已知的一致。
const KNOWN_SECTIONS = [
  { id: 'core', kind: 'canonical' },
  { id: 'frames', kind: 'canonical' },
  { id: 'events', kind: 'canonical' },
  { id: 'rounds', kind: 'canonical' },
  { id: 'grenades', kind: 'canonical' },
  { id: 'infernos', kind: 'canonical' },
  { id: 'droppedWeapons', kind: 'canonical' },
  { id: 'weaponFires', kind: 'canonical' },
  { id: 'mapEntities', kind: 'canonical' },
  { id: 'playerColors', kind: 'canonical' },
  { id: 'deathRagdolls', kind: 'canonical' },
  { id: 'smokeVoxels', kind: 'canonical' },
  { id: 'tracers', kind: 'canonical' },
  { id: 'panels', kind: 'canonical' },
  { id: 'deathMarkers', kind: 'canonical' },
  { id: 'damage', kind: 'canonical' },
  { id: 'bomb', kind: 'canonical' },
  { id: 'timeouts', kind: 'canonical' },
  { id: 'derivationInputs', kind: 'derived' },
];

// 必需的 section（mF）—— 解码时必须存在
const REQUIRED_SECTIONS = [
  'core',
  'frames',
  'events',
  'rounds',
  'grenades',
  'infernos',
  'smokeVoxels',
  'tracers',
  'panels',
  'deathMarkers',
  'damage',
  'bomb',
  'timeouts',
];

// 玩家颜色表（Fg）—— playerColors section 用 1 字节索引引用
// 原件形如：var Fg = [`blue`, `green`, `yellow`, `orange`, `purple`]
// three.js 的 Color 构造器同时接受 hex 数字与 CSS 颜色名，这里保留原件的字符串形式。
const PLAYER_COLORS = [`blue`, `green`, `yellow`, `orange`, `purple`];

// playerColors 里的空值标记（255 表示该玩家无指定颜色）
const NO_COLOR_TAG = 255; // aI

// ── 解码错误类型（Z） ─────────────────────────────────────────────────────────

class DecodeError extends Error {
  /**
   * @param {string} message 错误信息
   * @param {number} byteOffset 出错处的字节偏移（基于 artifact 起始，用于定位）
   */
  constructor(message, byteOffset) {
    super(message);
    this.name = 'DecodeError';
    this.byteOffset = byteOffset;
  }
}

// ── ByteReader（CF） ─────────────────────────────────────────────────────────
//
// 一个基于 DataView 的小端（little-endian）二进制读取器。
// 所有读取方法都做边界检查，出错时抛出带字节偏移的 DecodeError，
// 使损坏文件能被精确定位到具体字段。

class ByteReader {
  constructor(bytes, baseOffset = 0) {
    this.bytes = bytes; // Uint8Array
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.base = baseOffset; // 该 reader 在完整 artifact 中的起始字节偏移
    this.cursor = 0; // 当前读取位置（相对 bytes 起点）
  }

  /** 当前读取位置 */
  get position() {
    return this.cursor;
  }

  /** 剩余未读字节数 */
  get remaining() {
    return this.bytes.length - this.cursor;
  }

  /** 是否已读到末尾 */
  get isAtEnd() {
    return this.cursor >= this.bytes.length;
  }

  /**
   * 确保还有至少 n 个字节可读，否则抛出 DecodeError。
   */
  need(n) {
    if (!Number.isInteger(n) || n < 0 || this.cursor + n > this.bytes.length) {
      throw new DecodeError(
        `Unexpected end of data: need ${n} more byte(s), have ${Math.max(0, this.remaining)}`,
        this.base + this.cursor,
      );
    }
  }

  /** 读取 1 个无符号字节 */
  readU8() {
    this.need(1);
    return this.bytes[this.cursor++];
  }

  /** 读取 1 个布尔值（必须是 0 或 1） */
  readBool() {
    const pos = this.base + this.cursor;
    const v = this.readU8();
    if (v !== 0 && v !== 1) throw new DecodeError(`Boolean byte must be 0 or 1, got ${v}`, pos);
    return v === 1;
  }

  /** 读取 1 个无符号 16 位整数（小端） */
  readU16() {
    this.need(2);
    const v = this.view.getUint16(this.cursor, true);
    this.cursor += 2;
    return v;
  }

  /** 读取 1 个有符号 32 位整数（小端） */
  readI32() {
    this.need(4);
    const v = this.view.getInt32(this.cursor, true);
    this.cursor += 4;
    return v;
  }

  /** 读取 1 个无符号 32 位整数（小端） */
  readU32() {
    this.need(4);
    const v = this.view.getUint32(this.cursor, true);
    this.cursor += 4;
    return v;
  }

  /**
   * 读取一个非负 32 位整数，并用字段名做错误信息。
   */
  readNonNegativeI32(fieldName) {
    const pos = this.base + this.cursor;
    const v = this.readI32();
    if (!Number.isInteger(v) || v < 0) {
      throw new DecodeError(`Field '${fieldName}' must be a nonnegative integer, got ${v}`, pos);
    }
    return v;
  }

  /** 读取 1 个 32 位浮点数（小端） */
  readF32() {
    this.need(4);
    const v = this.view.getFloat32(this.cursor, true);
    this.cursor += 4;
    return v;
  }

  /** 读取 1 个 64 位浮点数（小端） */
  readF64() {
    this.need(8);
    const v = this.view.getFloat64(this.cursor, true);
    this.cursor += 8;
    return v;
  }

  /**
   * 读取一个 varint（无符号 LEB128 变体，低位 7 bit 一组，高位是延续位）。
   * 要求是「规范（最小）编码」—— 即不会用多余的字节表示同一个数。
   */
  readVarUint() {
    const pos = this.base + this.cursor;
    let value = 0;
    let shift = 0;
    let bytesRead = 0;
    let byte;
    do {
      byte = this.readU8();
      bytesRead++;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (shift > 49) throw new DecodeError(`Varuint exceeds supported range`, pos);
    } while (byte & 0x80);
    if (!Number.isSafeInteger(value)) throw new DecodeError(`Varuint exceeds the safe integer range`, pos);
    // 规范编码检查：读取的字节数应等于最小表示所需的字节数
    if (bytesRead !== varuintCanonicalLength(value)) {
      throw new DecodeError(`Varuint is not in canonical (minimal) encoding`, pos);
    }
    return value;
  }

  /**
   * 读取一个数组长度（varint），并做上限与剩余字节的合理性预检。
   * @param {string} fieldName 字段名（用于错误信息）
   * @param {number} minBytesPerElement 每个元素至少占用的字节数（用于预检）
   */
  readArrayLength(fieldName, minBytesPerElement = 1) {
    const pos = this.base + this.cursor;
    const count = this.readVarUint();
    if (count > MAX_ARRAY_COUNT) {
      throw new DecodeError(`Field '${fieldName}' has count ${count} exceeding max ${MAX_ARRAY_COUNT}`, pos);
    }
    if (count > (minBytesPerElement > 0 ? Math.floor(this.remaining / minBytesPerElement) : this.remaining)) {
      throw new DecodeError(
        `Field '${fieldName}' declares ${count} element(s) but only ${this.remaining} byte(s) remain (each needs >= ${minBytesPerElement} byte(s))`,
        pos,
      );
    }
    return count;
  }

  /** 读取一个字节块（varint 长度 + 原始字节） */
  readBytes() {
    const len = this.readVarUint();
    if (len > MAX_BYTE_BLOCK) {
      throw new DecodeError(`Byte block length ${len} exceeds max ${MAX_BYTE_BLOCK}`, this.base + this.cursor);
    }
    this.need(len);
    const bytes = this.bytes.slice(this.cursor, this.cursor + len);
    this.cursor += len;
    return bytes;
  }

  /** 读取一个 UTF-8 字符串（varint 长度 + 字节，严格校验编码） */
  readString() {
    const len = this.readVarUint();
    if (len > MAX_STRING_BYTES) {
      throw new DecodeError(`String length ${len} exceeds max ${MAX_STRING_BYTES}`, this.base + this.cursor);
    }
    this.need(len);
    const bytes = this.bytes.subarray(this.cursor, this.cursor + len);
    this.cursor += len;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (err) {
      throw new DecodeError(`Invalid UTF-8 string: ${err.message}`, this.base + this.cursor);
    }
  }

  /** 读取一个可选字符串（先读 bool 标记，true 则读字符串） */
  readOptionalString() {
    return this.readBool() ? this.readString() : undefined;
  }

  /** 读取一个字符串数组 */
  readStringArray(fieldName = 'stringArray') {
    const count = this.readArrayLength(fieldName, 1);
    const result = new Array(count);
    for (let i = 0; i < count; i++) result[i] = this.readString();
    return result;
  }

  /**
   * 读取一个类型化数组：先读 1 字节类型标签，再读 varint 元素个数，
   * 然后按元素类型逐项解码。
   */
  readTypedArray() {
    const pos = this.base + this.cursor;
    const tag = this.readU8();
    if (tag === TypedArrayTag.None) return undefined; // 空标记
    if (!VALID_TYPEDARRAY_TAGS.has(tag)) throw new DecodeError(`Unknown typed array tag ${tag}`, pos);

    const length = this.readVarUint();
    if (length > MAX_ARRAY_COUNT) {
      throw new DecodeError(`Typed array length ${length} exceeds max ${MAX_ARRAY_COUNT}`, this.base + this.cursor);
    }
    const width = typedArrayByteWidth(tag);
    const totalBytes = length * width;
    this.need(totalBytes);

    let arr;
    if (tag === TypedArrayTag.Float32) arr = new Float32Array(length);
    else if (tag === TypedArrayTag.Int32) arr = new Int32Array(length);
    else if (tag === TypedArrayTag.Uint16) arr = new Uint16Array(length);
    else if (tag === TypedArrayTag.Float64) arr = new Float64Array(length);
    else arr = new Uint8Array(length);

    for (let i = 0; i < length; i++) {
      const offset = this.cursor + i * width;
      switch (tag) {
        case TypedArrayTag.Float32:
          arr[i] = this.view.getFloat32(offset, true);
          break;
        case TypedArrayTag.Int32:
          arr[i] = this.view.getInt32(offset, true);
          break;
        case TypedArrayTag.Uint16:
          arr[i] = this.view.getUint16(offset, true);
          break;
        case TypedArrayTag.Float64:
          arr[i] = this.view.getFloat64(offset, true);
          break;
        default:
          arr[i] = this.bytes[offset];
          break;
      }
    }
    this.cursor += totalBytes;
    return arr;
  }

  /**
   * 读取一个可选类型化数组，并校验其类型标签等于期望值。
   * 若读到的标签是 None（返回 undefined）则不校验。
   */
  readOptionalTypedArray(expectedTag, fieldName) {
    const pos = this.base + this.cursor;
    const actualTag = this.bytes[this.cursor];
    const arr = this.readTypedArray();
    if (arr !== undefined) {
      if (actualTag !== expectedTag) {
        throw new DecodeError(`Field '${fieldName}' has dtype tag ${actualTag}, expected ${expectedTag}`, pos);
      }
      return arr;
    }
    return undefined;
  }

  /** 读取一个必需的类型化数组（缺失则抛错） */
  readRequiredTypedArray(expectedTag, fieldName) {
    const pos = this.base + this.cursor;
    const arr = this.readOptionalTypedArray(expectedTag, fieldName);
    if (arr === undefined) throw new DecodeError(`Field '${fieldName}' is required but was absent`, pos);
    return arr;
  }
}

/** 计算一个非负整数的 varint 规范（最小）编码所需的字节数 */
function varuintCanonicalLength(value) {
  let length = 0;
  do {
    length++;
    value = Math.floor(value / 128);
  } while (value > 0);
  return length;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 把一个字节数组包成 ReadableStream（供 DecompressionStream 消费） */
function bytesToStream(bytes) {
  const data = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes.slice();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

/**
 * 对 gzip 压缩的 section 做流式解压，并校验解压后的字节数等于声明的长度。
 * @param {Uint8Array} bytes 压缩后的字节
 * @param {string} codec 压缩方式（'none' 或 'gzip'）
 * @param {number} uncompressedByteLength 声明的解压后字节数
 * @param {string} sectionId section 名（用于错误信息）
 */
async function decompressSection(bytes, codec, uncompressedByteLength, sectionId) {
  if (codec === 'none') return bytes;
  if (uncompressedByteLength === undefined) {
    throw new DecodeError(`Gzip section '${sectionId}' is missing uncompressedByteLength`);
  }
  if (uncompressedByteLength > MAX_BYTE_BLOCK) {
    throw new DecodeError(
      `Section '${sectionId}' uncompressedByteLength ${uncompressedByteLength} exceeds max ${MAX_BYTE_BLOCK}`,
    );
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new DecodeError(`Gzip section '${sectionId}' cannot be decoded because DecompressionStream is unavailable`);
  }
  try {
    const reader = bytesToStream(bytes).pipeThrough(new DecompressionStream('gzip')).getReader();
    const out = new Uint8Array(uncompressedByteLength);
    let written = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (written + value.length > out.length) {
          throw new DecodeError(
            `Gzip section '${sectionId}' exceeds declared uncompressedByteLength ${uncompressedByteLength}`,
          );
        }
        out.set(value, written);
        written += value.length;
      }
    } finally {
      reader.releaseLock();
    }
    if (written !== out.length) {
      throw new DecodeError(`Gzip section '${sectionId}' decoded to ${written} byte(s), expected ${uncompressedByteLength}`);
    }
    return out;
  } catch (err) {
    if (err instanceof DecodeError) throw err;
    throw new DecodeError(
      `Gzip section '${sectionId}' could not be decompressed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** 把字节数组转成十六进制字符串 */
function bytesToHex(bytes) {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// sha256 十六进制正则
const SHA256_REGEX = /^[0-9a-f]{64}$/;

/** 获取 Web Crypto 的 subtle 接口（不存在则抛错） */
function getSubtle() {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw Error(`Web Crypto (globalThis.crypto.subtle) is unavailable in this runtime; cannot hash artifact contents.`);
  }
  return cryptoObj.subtle;
}

/** 计算字节数组的 SHA-256，返回 Uint8Array（32 字节） */
async function sha256Bytes(bytes) {
  const data = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes.slice();
  const digest = await getSubtle().digest('SHA-256', data);
  return new Uint8Array(digest);
}

/** 计算字节数组的 SHA-256 十六进制字符串 */
async function sha256Hex(bytes) {
  return bytesToHex(await sha256Bytes(bytes));
}

/** 抛出「不支持的 schemaVersion」错误 */
function unsupportedVersion(sectionId, version) {
  throw new DecodeError(`Section '${sectionId}' has unsupported schemaVersion ${version}`);
}

/** 校验长度相等，否则抛错 */
function assertLength(actual, expected, fieldName) {
  if (actual !== expected) throw new DecodeError(`Field '${fieldName}' has length ${actual}, expected ${expected}`);
}

/** 安全的乘法并检查是否超过上限 */
function safeMul(a, b, fieldName) {
  const result = a * b;
  if (!Number.isSafeInteger(result) || result > MAX_ARRAY_COUNT) {
    throw new DecodeError(`Field '${fieldName}' = ${a} * ${b} exceeds max ${MAX_ARRAY_COUNT}`);
  }
  return result;
}

/** 校验一个数组严格递增 */
function assertStrictlyIncreasing(arr, fieldName) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] <= arr[i - 1]) {
      throw new DecodeError(`Field '${fieldName}' is not strictly increasing at index ${i} (${arr[i - 1]} -> ${arr[i]})`);
    }
  }
}

/** 校验一个数组非递减 */
function assertNondecreasing(arr, fieldName) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) {
      throw new DecodeError(`Field '${fieldName}' is not nondecreasing at index ${i} (${arr[i - 1]} -> ${arr[i]})`);
    }
  }
}

// ── Section 解码函数（每个 section 都有 schemaVersion 分派） ──────────────────

// 事件类型表（events section 用 1 字节索引引用）
const EVENT_TYPES = ['kill', 'round_start', 'round_end', 'bomb_planted', 'bomb_defused', 'bomb_exploded'];

// 事件字段的位掩码定义（两个 16 位位图：c 决定是否「存在」，l 决定布尔字段取值）
const EVENT_FIELD_BITS = {
  AttackerSlot: 0,
  VictimSlot: 1,
  AssisterSlot: 2,
  AttackerName: 3,
  VictimName: 4,
  AttackerTeam: 5,
  VictimTeam: 6,
  Weapon: 7,
  Headshot: 8,
  Noscope: 9,
  Thrusmoke: 10,
  Attackerblind: 11,
  Wallbang: 12,
  RoundWinner: 13,
  RoundReason: 14,
};

// 手榴弹种类表
const GRENADE_KINDS = ['smoke', 'he', 'flash', 'molotov', 'decoy'];

// 炸弹状态种类表
const BOMB_STATES = ['carried', 'dropped', 'planted'];

/** core section —— 元信息 + 玩家列表 + 武器名列表 */
function decodeCore(reader, version) {
  if (version !== 1) return unsupportedVersion('core', version);
  const meta = {
    mapName: reader.readString(),
    tickRate: reader.readNonNegativeI32('core.meta.tickRate'),
    sampleRate: reader.readNonNegativeI32('core.meta.sampleRate'),
    numPlayers: reader.readNonNegativeI32('core.meta.numPlayers'),
    numFrames: reader.readNonNegativeI32('core.meta.numFrames'),
    startTick: reader.readI32(),
    endTick: reader.readI32(),
    durationSeconds: reader.readF64(),
  };

  const playerCount = reader.readArrayLength('core.players', 8);
  const players = new Array(playerCount);
  for (let i = 0; i < playerCount; i++) {
    const slot = reader.readI32();
    const steamId = reader.readString();
    const name = reader.readString();
    const crosshairCode = reader.readOptionalString();
    const clanName = reader.readOptionalString();
    players[i] = {
      slot,
      steamId,
      name,
      ...(crosshairCode === undefined ? {} : { crosshairCode }),
      ...(clanName === undefined ? {} : { clanName }),
    };
  }

  const weaponNames = reader.readStringArray('core.weaponNames');

  if (players.length !== meta.numPlayers) {
    throw new DecodeError(`core.players has ${players.length} entrie(s), but core.meta.numPlayers is ${meta.numPlayers}`);
  }

  // 校验 slot 唯一且在 [0, numPlayers) 范围内
  const seenSlots = new Set();
  for (const p of players) {
    if (p.slot < 0 || p.slot >= meta.numPlayers || !Number.isInteger(p.slot)) {
      throw new DecodeError(`core.players[].slot ${p.slot} is out of range [0, ${meta.numPlayers})`);
    }
    if (seenSlots.has(p.slot)) throw new DecodeError(`core.players has duplicate slot ${p.slot}`);
    seenSlots.add(p.slot);
  }

  return { meta, players, weaponNames };
}

/** frames 基础层 —— 每帧每玩家的位置/朝向/状态（SoA 布局） */
function decodeFramesBase(reader) {
  const numFrames = reader.readNonNegativeI32('frames.numFrames');
  const numPlayers = reader.readNonNegativeI32('frames.numPlayers');
  const total = safeMul(numFrames, numPlayers, 'frames.numFrames * frames.numPlayers');

  const posX = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'frames.posX');
  const posY = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'frames.posY');
  const posZ = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'frames.posZ');
  const yaw = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'frames.yaw');
  const pitch = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'frames.pitch');
  const health = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'frames.health');
  const alive = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'frames.alive');
  const team = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'frames.team');
  const score = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'frames.score');
  const duck = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'frames.duck');
  const flash = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'frames.flash');
  const flashAlpha = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'frames.flashAlpha');
  const zoom = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'frames.zoom');
  const frameTick = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'frames.frameTick');

  for (const [arr, name] of [
    [posX, 'posX'],
    [posY, 'posY'],
    [posZ, 'posZ'],
    [yaw, 'yaw'],
    [pitch, 'pitch'],
    [health, 'health'],
    [alive, 'alive'],
    [team, 'team'],
    [score, 'score'],
    [duck, 'duck'],
    [flash, 'flash'],
    [flashAlpha, 'flashAlpha'],
    [zoom, 'zoom'],
  ]) {
    assertLength(arr.length, total, `frames.${name}`);
  }
  assertLength(frameTick.length, numFrames, 'frames.frameTick');
  assertStrictlyIncreasing(frameTick, 'frames.frameTick');

  return {
    numPlayers,
    frames: {
      posX, posY, posZ, yaw, pitch, health, alive, team, score,
      duck, flash, flashAlpha, zoom, frameTick,
    },
  };
}

// frames schemaVersion 1 —— 基础层
function decodeFramesV1(reader) {
  return decodeFramesBase(reader);
}

// frames schemaVersion 2 —— 增加 accuracyPenalty
function decodeFramesV2(reader) {
  const result = decodeFramesBase(reader);
  const accuracyPenalty = reader.readOptionalTypedArray(TypedArrayTag.Float32, 'frames.accuracyPenalty');
  if (accuracyPenalty) {
    assertLength(accuracyPenalty.length, result.frames.frameTick.length * result.numPlayers, 'frames.accuracyPenalty');
    for (const v of accuracyPenalty) {
      if (!Number.isFinite(v) || (v < 0 && v !== -1)) {
        throw new DecodeError('frames.accuracyPenalty must contain nonnegative finite values or -1');
      }
    }
    result.frames.accuracyPenalty = accuracyPenalty;
  }
  return result;
}

// frames schemaVersion 3 —— 增加 reloading
function decodeFramesV3(reader) {
  const result = decodeFramesV2(reader);
  const reloading = reader.readOptionalTypedArray(TypedArrayTag.Uint8, 'frames.reloading');
  if (reloading) {
    assertLength(reloading.length, result.frames.frameTick.length * result.numPlayers, 'frames.reloading');
    if (reloading.some((v) => v > 1)) {
      throw new DecodeError('frames.reloading must contain only 0 or 1');
    }
    result.frames.reloading = reloading;
  }
  return result;
}

/** frames section 分派 */
function decodeFrames(reader, version) {
  switch (version) {
    case 1:
      return decodeFramesV1(reader);
    case 2:
      return decodeFramesV2(reader);
    case 3:
      return decodeFramesV3(reader);
    case 4: {
      const result = decodeFramesV3(reader);
      const playerFlags = reader.readOptionalTypedArray(TypedArrayTag.Uint8, 'frames.playerFlags');
      if (playerFlags) {
        assertLength(
          playerFlags.length,
          result.frames.frameTick.length * result.numPlayers,
          'frames.playerFlags',
        );
        if (playerFlags.some((v) => (v & ~0x7) !== 0)) {
          throw new DecodeError('frames.playerFlags contains unknown bits');
        }
        result.frames.playerFlags = playerFlags;
      }
      return result;
    }
    default:
      return unsupportedVersion('frames', version);
  }
}

/** events section —— 击杀/回合事件，字段用位图标识存在性 */
function decodeEvents(reader, version) {
  if (version !== 1) return unsupportedVersion('events', version);
  const count = reader.readArrayLength('events', 13);
  const events = new Array(count);
  let prevTick = -Infinity;

  for (let i = 0; i < count; i++) {
    const tick = reader.readI32();
    if (tick < prevTick) {
      throw new DecodeError(`events[${i}].tick ${tick} precedes events[${i - 1}].tick ${prevTick}`);
    }
    prevTick = tick;

    const time = reader.readF32();
    const typeIndex = reader.readU8();
    const type = EVENT_TYPES[typeIndex];
    if (type === undefined) throw new DecodeError(`Unknown event type index ${typeIndex}`);

    // 两个 16 位位图：presenceBits 决定哪些字段「存在」，boolBits 决定布尔字段取值
    const presenceBits = reader.readU16();
    const boolBits = reader.readU16();
    const has = (bit) => (presenceBits & (1 << bit)) !== 0;
    const boolVal = (bit) => (boolBits & (1 << bit)) !== 0;

    const event = { tick, time, type };

    if (has(EVENT_FIELD_BITS.AttackerSlot)) event.attackerSlot = reader.readI32();
    if (has(EVENT_FIELD_BITS.VictimSlot)) event.victimSlot = reader.readI32();
    if (has(EVENT_FIELD_BITS.AssisterSlot)) event.assisterSlot = reader.readI32();
    if (has(EVENT_FIELD_BITS.AttackerName)) event.attackerName = reader.readString();
    if (has(EVENT_FIELD_BITS.VictimName)) event.victimName = reader.readString();
    if (has(EVENT_FIELD_BITS.AttackerTeam)) event.attackerTeam = reader.readI32();
    if (has(EVENT_FIELD_BITS.VictimTeam)) event.victimTeam = reader.readI32();
    if (has(EVENT_FIELD_BITS.Weapon)) event.weapon = reader.readString();
    if (has(EVENT_FIELD_BITS.Headshot)) event.headshot = boolVal(EVENT_FIELD_BITS.Headshot);
    if (has(EVENT_FIELD_BITS.Noscope)) event.noscope = boolVal(EVENT_FIELD_BITS.Noscope);
    if (has(EVENT_FIELD_BITS.Thrusmoke)) event.thrusmoke = boolVal(EVENT_FIELD_BITS.Thrusmoke);
    if (has(EVENT_FIELD_BITS.Attackerblind)) event.attackerblind = boolVal(EVENT_FIELD_BITS.Attackerblind);
    if (has(EVENT_FIELD_BITS.Wallbang)) event.wallbang = boolVal(EVENT_FIELD_BITS.Wallbang);
    if (has(EVENT_FIELD_BITS.RoundWinner)) event.roundWinner = reader.readI32();
    if (has(EVENT_FIELD_BITS.RoundReason)) event.roundReason = reader.readI32();

    events[i] = event;
  }
  return events;
}

/** rounds section —— 回合起止 tick 列表 */
function decodeRounds(reader, version) {
  if (version !== 1) return unsupportedVersion('rounds', version);
  const count = reader.readArrayLength('rounds', 16);
  const rounds = new Array(count);
  for (let i = 0; i < count; i++) {
    const round = {
      index: reader.readI32(),
      startTick: reader.readI32(),
      endTick: reader.readI32(),
      liveStartTick: reader.readI32(),
    };
    if (round.index !== i) throw new DecodeError(`rounds[${i}].index is ${round.index}, expected ${i}`);
    if (round.endTick < round.startTick) {
      throw new DecodeError(`rounds[${i}].endTick ${round.endTick} precedes startTick ${round.startTick}`);
    }
    if (i > 0 && round.startTick < rounds[i - 1].endTick) {
      throw new DecodeError(
        `rounds[${i}].startTick ${round.startTick} overlaps rounds[${i - 1}].endTick ${rounds[i - 1].endTick}`,
      );
    }
    rounds[i] = round;
  }
  return rounds;
}

/** 读取手榴弹种类（1 字节索引） */
function readGrenadeKind(reader) {
  const index = reader.readU8();
  const kind = GRENADE_KINDS[index];
  if (kind === undefined) throw new DecodeError(`Unknown grenade kind index ${index}`);
  return kind;
}

/** grenades section —— 手榴弹轨迹 + 爆炸效果 */
function decodeGrenades(reader, version, hasAngles) {
  const trajectoryCount = reader.readArrayLength('grenades.trajectories', hasAngles ? 12 : 10);
  const trajectories = new Array(trajectoryCount);
  for (let i = 0; i < trajectoryCount; i++) {
    const kind = readGrenadeKind(reader);
    const throwerSlot = reader.readI32();
    const posXYZ = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'grenades.trajectories[].posXYZ');
    const ticks = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'grenades.trajectories[].ticks');
    const startTick = reader.readI32();
    const endTick = reader.readI32();
    const detonationTick = reader.readBool() ? reader.readI32() : undefined;
    const angles = hasAngles
      ? reader.readOptionalTypedArray(TypedArrayTag.Float32, 'grenades.trajectories[].angles')
      : undefined;
    const incendiaryFlag = hasAngles ? reader.readU8() : 0;

    if (incendiaryFlag > 2) throw new DecodeError(`Invalid grenade incendiary flag ${incendiaryFlag}`);
    assertLength(posXYZ.length, ticks.length * 3, `grenades.trajectories[${i}].posXYZ`);
    if (angles) assertLength(angles.length, ticks.length * 3, `grenades.trajectories[${i}].angles`);

    trajectories[i] = {
      kind,
      throwerSlot,
      posXYZ,
      ticks,
      startTick,
      endTick,
      ...(detonationTick === undefined ? {} : { detonationTick }),
      ...(angles ? { angles } : {}),
      ...(incendiaryFlag === 0 ? {} : { incendiary: incendiaryFlag === 2 }),
    };
  }

  const effectCount = reader.readArrayLength('grenades.effects', 17);
  const effects = new Array(effectCount);
  for (let i = 0; i < effectCount; i++) {
    effects[i] = {
      kind: readGrenadeKind(reader),
      x: reader.readF32(),
      y: reader.readF32(),
      z: reader.readF32(),
      startTick: reader.readI32(),
      endTick: reader.readI32(),
    };
  }
  return { trajectories, effects };
}

function decodeGrenadesDispatch(reader, version) {
  switch (version) {
    case 1:
      return decodeGrenades(reader, version, false);
    case 2:
      return decodeGrenades(reader, version, true);
    default:
      return unsupportedVersion('grenades', version);
  }
}

/** infernos section —— 燃烧弹的逐帧燃烧体素/补丁数据 */
function decodeInfernos(reader, version) {
  if (version !== 1) return unsupportedVersion('infernos', version);
  const count = reader.readArrayLength('infernos', 10);
  const infernos = new Array(count);
  for (let i = 0; i < count; i++) {
    const entityId = reader.readI32();
    const startTick = reader.readI32();
    const endTick = reader.readI32();
    const effectTick = reader.readBool() ? reader.readI32() : undefined;
    const flagPos = reader.position;
    const infernoTypeRaw = reader.readBool() ? reader.readU8() : undefined;
    if (infernoTypeRaw !== undefined && infernoTypeRaw !== 0 && infernoTypeRaw !== 1) {
      throw new DecodeError(`infernos[${i}].infernoType has invalid value ${infernoTypeRaw} (expected 0 or 1)`, flagPos);
    }
    const infernoType = infernoTypeRaw;
    const lifetime = reader.readBool() ? reader.readF32() : undefined;

    const frameCount = reader.readArrayLength('infernos[].frames', 5);
    const frames = new Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      const tick = reader.readI32();
      const positions = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'infernos[].frames[].positions');
      const burning = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'infernos[].frames[].burning');
      const origin = reader.readOptionalTypedArray(TypedArrayTag.Float32, 'infernos[].frames[].origin');
      const parentPositions = reader.readOptionalTypedArray(TypedArrayTag.Float32, 'infernos[].frames[].parentPositions');
      const normals = reader.readOptionalTypedArray(TypedArrayTag.Float32, 'infernos[].frames[].normals');
      frames[f] = {
        tick,
        positions,
        burning,
        ...(origin === undefined ? {} : { origin }),
        ...(parentPositions === undefined ? {} : { parentPositions }),
        ...(normals === undefined ? {} : { normals }),
      };
    }

    infernos[i] = {
      entityId,
      startTick,
      endTick,
      ...(effectTick === undefined ? {} : { effectTick }),
      ...(infernoType === undefined ? {} : { infernoType }),
      ...(lifetime === undefined ? {} : { lifetime }),
      frames,
    };
  }
  return infernos;
}

/** droppedWeapons section —— 掉落武器的逐 tick 位置 */
function decodeDroppedWeapons(reader, version) {
  if (version !== 1) return unsupportedVersion('droppedWeapons', version);
  const count = reader.readArrayLength('droppedWeapons', 20);
  const weapons = new Array(count);
  for (let i = 0; i < count; i++) {
    const entityId = reader.readI32();
    const weapon = reader.readString();
    const itemDef = reader.readI32();
    const startTick = reader.readI32();
    const endTick = reader.readI32();
    const ticks = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'droppedWeapons[].ticks');
    const positions = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'droppedWeapons[].positions');
    const angles = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'droppedWeapons[].angles');
    assertLength(positions.length, ticks.length * 3, 'droppedWeapons[].positions');
    assertLength(angles.length, ticks.length * 3, 'droppedWeapons[].angles');
    weapons[i] = { entityId, weapon, itemDef, startTick, endTick, ticks, positions, angles };
  }
  return weapons;
}

/** weaponFires section —— 开火事件（tick + 玩家 slot） */
function decodeWeaponFires(reader, version) {
  switch (version) {
    case 1: {
      const ticks = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'weaponFires.ticks');
      const slots = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'weaponFires.slots');
      assertLength(slots.length, ticks.length, 'weaponFires.slots');
      for (let i = 1; i < ticks.length; i++) {
        if (ticks[i] < ticks[i - 1]) throw new DecodeError('weaponFires.ticks must be ascending');
      }
      return { ticks, slots };
    }
    default:
      return unsupportedVersion('weaponFires', version);
  }
}

/** mapEntities section —— 地图实体（门、可交互物等）的逐 tick 状态 */
function decodeMapEntities(reader, version) {
  if (version !== 1) return unsupportedVersion('mapEntities', version);
  const classNames = reader.readStringArray('mapEntities.classNames');
  const count = reader.readArrayLength('mapEntities', 21);
  const entities = new Array(count);
  for (let i = 0; i < count; i++) {
    const classNameIndex = reader.readVarUint();
    if (classNameIndex >= classNames.length) {
      throw new DecodeError(`mapEntities[${i}].className index ${classNameIndex} out of range`);
    }
    const origin = [reader.readF32(), reader.readF32(), reader.readF32()];
    const startTick = reader.readI32();
    const endTick = reader.readI32();
    const ticks = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'mapEntities[].ticks');
    const angles = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'mapEntities[].angles');
    const hidden = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'mapEntities[].hidden');
    assertLength(angles.length, ticks.length * 3, 'mapEntities[].angles');
    assertLength(hidden.length, ticks.length, 'mapEntities[].hidden');
    entities[i] = { className: classNames[classNameIndex], origin, startTick, endTick, ticks, angles, hidden };
  }
  return entities;
}

/** playerColors section —— 每玩家的颜色（1 字节索引进 PLAYER_COLORS） */
function decodePlayerColors(reader, version) {
  if (version !== 1) return unsupportedVersion('playerColors', version);
  const count = reader.readArrayLength('playerColors', 1);
  const colors = new Array(count);
  for (let i = 0; i < count; i++) {
    const idx = reader.readU8();
    if (idx === NO_COLOR_TAG) colors[i] = undefined;
    else if (idx < PLAYER_COLORS.length) colors[i] = PLAYER_COLORS[idx];
    else throw new DecodeError(`playerColors[${i}] (${idx}) is not a known player colour`);
  }
  return colors;
}

/** deathRagdolls section —— 死亡布娃娃（每 tick 一个记录） */
function decodeDeathRagdolls(reader, version) {
  if (version !== 1) return unsupportedVersion('deathRagdolls', version);
  const count = reader.readArrayLength('deathRagdolls', RAGDOLL_STRIDE);
  const ragdolls = new Array(count);
  for (let i = 0; i < count; i++) {
    ragdolls[i] = {
      tick: reader.readI32(),
      slot: reader.readU8(),
      force: [reader.readF32(), reader.readF32(), reader.readF32()],
      bone: reader.readI32(),
      headshot: reader.readBool(),
      eyeAngles: [reader.readF32(), reader.readF32()],
    };
  }
  return ragdolls;
}

/** smokeVoxels section —— 烟雾体素数据（32³ 网格，Morton 编码，64bit 位图） */
function decodeSmokeVoxels(reader, version) {
  if (version !== 1) return unsupportedVersion('smokeVoxels', version);
  const count = reader.readNonNegativeI32('smokeVoxels.count');
  const tickBegin = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'smokeVoxels.tickBegin');
  const detonation = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'smokeVoxels.detonation');
  const color = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'smokeVoxels.color');
  const bufferOffsets = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'smokeVoxels.bufferOffsets');
  const buffers = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'smokeVoxels.buffers');
  const frameOffsets = reader.readOptionalTypedArray(TypedArrayTag.Int32, 'smokeVoxels.frameOffsets');
  const frameTicks = reader.readOptionalTypedArray(TypedArrayTag.Int32, 'smokeVoxels.frameTicks');

  assertLength(tickBegin.length, count, 'smokeVoxels.tickBegin');
  assertLength(detonation.length, safeMul(count, 3, 'smokeVoxels.count * 3'), 'smokeVoxels.detonation');
  assertLength(color.length, safeMul(count, 3, 'smokeVoxels.count * 3'), 'smokeVoxels.color');
  assertLength(bufferOffsets.length, count + 1, 'smokeVoxels.bufferOffsets');
  assertNondecreasing(bufferOffsets, 'smokeVoxels.bufferOffsets');

  if (bufferOffsets.length > 0) {
    if (bufferOffsets[0] !== 0) throw new DecodeError(`smokeVoxels.bufferOffsets[0] must be 0, got ${bufferOffsets[0]}`);
    const finalOffset = bufferOffsets[bufferOffsets.length - 1];
    if (finalOffset !== buffers.length) {
      throw new DecodeError(
        `smokeVoxels.bufferOffsets final value ${finalOffset} does not match smokeVoxels.buffers length ${buffers.length}`,
      );
    }
  }

  // frameOffsets 与 frameTicks 必须同时存在或同时缺失
  if ((frameOffsets === undefined) !== (frameTicks === undefined)) {
    throw new DecodeError('smokeVoxels.frameOffsets and smokeVoxels.frameTicks must both be present or both absent');
  }
  if (frameOffsets !== undefined && frameTicks !== undefined) {
    assertLength(frameOffsets.length, count + 1, 'smokeVoxels.frameOffsets');
    assertNondecreasing(frameOffsets, 'smokeVoxels.frameOffsets');
    if (frameOffsets.length > 0) {
      if (frameOffsets[0] !== 0) throw new DecodeError(`smokeVoxels.frameOffsets[0] must be 0, got ${frameOffsets[0]}`);
      const finalOffset = frameOffsets[frameOffsets.length - 1];
      if (finalOffset !== frameTicks.length) {
        throw new DecodeError(
          `smokeVoxels.frameOffsets final value ${finalOffset} does not match smokeVoxels.frameTicks length ${frameTicks.length}`,
        );
      }
    }
  }

  return {
    count,
    tickBegin,
    detonation,
    color,
    bufferOffsets,
    buffers,
    ...(frameOffsets === undefined ? {} : { frameOffsets }),
    ...(frameTicks === undefined ? {} : { frameTicks }),
  };
}

/** tracers section —— 弹道（起点/终点/命中类型） */
function decodeTracers(reader, version) {
  if (version !== 1) return unsupportedVersion('tracers', version);
  const count = reader.readNonNegativeI32('tracers.count');
  const origin = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'tracers.origin');
  const end = reader.readRequiredTypedArray(TypedArrayTag.Float32, 'tracers.end');
  const tick = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'tracers.tick');
  const team = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'tracers.team');
  const hitKind = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'tracers.hitKind');

  assertLength(origin.length, safeMul(count, 3, 'tracers.count * 3'), 'tracers.origin');
  assertLength(end.length, safeMul(count, 3, 'tracers.count * 3'), 'tracers.end');
  assertLength(tick.length, count, 'tracers.tick');
  assertLength(team.length, count, 'tracers.team');
  assertLength(hitKind.length, count, 'tracers.hitKind');
  assertNondecreasing(tick, 'tracers.tick');

  return { origin, end, tick, team, hitKind, count };
}

/** panels section —— 玩家面板数据（血/甲/钱/弹药等，SoA） */
function decodePanels(reader, version) {
  if (version !== 1) return unsupportedVersion('panels', version);
  const numFrames = reader.readNonNegativeI32('panels.numFrames');
  const numPlayers = reader.readNonNegativeI32('panels.numPlayers');
  const total = safeMul(numFrames, numPlayers, 'panels.numFrames * panels.numPlayers');

  const frameTick = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'panels.frameTick');
  const health = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'panels.health');
  const alive = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'panels.alive');
  const team = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'panels.team');
  const armor = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'panels.armor');
  const flags = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'panels.flags');
  const money = reader.readRequiredTypedArray(TypedArrayTag.Uint16, 'panels.money');
  const equipValue = reader.readRequiredTypedArray(TypedArrayTag.Uint16, 'panels.equipValue');
  const clipAmmo = reader.readRequiredTypedArray(TypedArrayTag.Uint16, 'panels.clipAmmo');
  const reserveAmmo = reader.readRequiredTypedArray(TypedArrayTag.Uint16, 'panels.reserveAmmo');
  const activeWeapon = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'panels.activeWeapon');
  const utilCounts = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'panels.utilCounts');

  assertLength(frameTick.length, numFrames, 'panels.frameTick');
  assertNondecreasing(frameTick, 'panels.frameTick');
  for (const [arr, name] of [
    [health, 'health'],
    [alive, 'alive'],
    [team, 'team'],
    [armor, 'armor'],
    [flags, 'flags'],
    [money, 'money'],
    [equipValue, 'equipValue'],
    [clipAmmo, 'clipAmmo'],
    [reserveAmmo, 'reserveAmmo'],
    [activeWeapon, 'activeWeapon'],
    [utilCounts, 'utilCounts'],
  ]) {
    assertLength(arr.length, total, `panels.${name}`);
  }

  return {
    numPlayers,
    panelFrames: {
      numFrames,
      frameTick,
      health, alive, team, armor, flags,
      money, equipValue, clipAmmo, reserveAmmo, activeWeapon, utilCounts,
    },
  };
}

/** deathMarkers section —— 死亡标记（位置 + 受害者信息） */
function decodeDeathMarkers(reader, version) {
  if (version !== 1) return unsupportedVersion('deathMarkers', version);
  const count = reader.readArrayLength('deathMarkers', 20);
  const markers = new Array(count);
  for (let i = 0; i < count; i++) {
    markers[i] = {
      x: reader.readF32(),
      y: reader.readF32(),
      z: reader.readF32(),
      startTick: reader.readI32(),
      endTick: reader.readI32(),
      victimSlot: reader.readI32(),
      team: reader.readI32(),
      name: reader.readString(),
    };
  }
  return markers;
}

/** damage section —— 伤害事件（攻击者/受害者/伤害值） */
function decodeDamage(reader, version) {
  if (version !== 1) return unsupportedVersion('damage', version);
  const count = reader.readNonNegativeI32('damage.count');
  const attackerSlot = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'damage.attackerSlot');
  const victimSlot = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'damage.victimSlot');
  const tick = reader.readRequiredTypedArray(TypedArrayTag.Int32, 'damage.tick');
  const dmg = reader.readRequiredTypedArray(TypedArrayTag.Uint8, 'damage.dmg');

  assertLength(attackerSlot.length, count, 'damage.attackerSlot');
  assertLength(victimSlot.length, count, 'damage.victimSlot');
  assertLength(tick.length, count, 'damage.tick');
  assertLength(dmg.length, count, 'damage.dmg');
  assertNondecreasing(tick, 'damage.tick');

  return { attackerSlot, victimSlot, tick, dmg, count };
}

/** bomb section —— 炸弹状态段 + 拆弹段 */
function decodeBomb(reader, version) {
  if (version !== 1) return unsupportedVersion('bomb', version);
  const segmentCount = reader.readArrayLength('bomb.segments', 15);
  const segments = new Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    const stateIndex = reader.readU8();
    const kind = BOMB_STATES[stateIndex];
    if (kind === undefined) throw new DecodeError(`Unknown bomb state kind index ${stateIndex}`);

    const segment = {
      kind,
      startTick: reader.readI32(),
      endTick: reader.readI32(),
      x: reader.readF32(),
      y: reader.readF32(),
      z: reader.readF32(),
      carrierSlot: reader.readI32(),
      site: reader.readString(),
    };
    if (segment.endTick < segment.startTick) {
      throw new DecodeError(`bomb.segments[${i}].endTick ${segment.endTick} precedes startTick ${segment.startTick}`);
    }
    if (i > 0 && segment.startTick < segments[i - 1].startTick) {
      throw new DecodeError(
        `bomb.segments[${i}].startTick ${segment.startTick} precedes bomb.segments[${i - 1}].startTick ${segments[i - 1].startTick}`,
      );
    }
    segments[i] = segment;
  }

  const defuseCount = reader.readArrayLength('bomb.defuses', 10);
  const defuses = new Array(defuseCount);
  for (let i = 0; i < defuseCount; i++) {
    const defuse = {
      startTick: reader.readI32(),
      endTick: reader.readI32(),
      hasKit: reader.readBool(),
      defuserSlot: reader.readI32(),
    };
    if (defuse.endTick < defuse.startTick) {
      throw new DecodeError(`bomb.defuses[${i}].endTick ${defuse.endTick} precedes startTick ${defuse.startTick}`);
    }
    defuses[i] = defuse;
  }
  return { segments, defuses };
}

/** 读取暂停方标记（0=无，1=T，2=CT） */
function readTimeoutSide(reader) {
  const tag = reader.readU8();
  if (tag === 1) return 't';
  if (tag === 2) return 'ct';
  if (tag !== 0) throw new DecodeError(`Unknown timeout side tag ${tag}`);
  return undefined;
}

/** timeouts section —— 战术暂停区间 + 计数器 */
function decodeTimeouts(reader, version) {
  if (version !== 1) return unsupportedVersion('timeouts', version);
  const maxTacticalTimeouts = reader.readNonNegativeI32('timeouts.maxTacticalTimeouts');

  const intervalCount = reader.readArrayLength('timeouts.intervals', 6);
  const intervals = new Array(intervalCount);
  for (let i = 0; i < intervalCount; i++) {
    const startTick = reader.readI32();
    const endTick = reader.readI32();
    const side = readTimeoutSide(reader);
    const technical = reader.readBool();
    if (endTick < startTick) {
      throw new DecodeError(`timeouts.intervals[${i}].endTick ${endTick} precedes startTick ${startTick}`);
    }
    intervals[i] = { startTick, endTick, technical, ...(side === undefined ? {} : { side }) };
  }

  const counterCount = reader.readArrayLength('timeouts.counters', 8);
  const counters = new Array(counterCount);
  for (let i = 0; i < counterCount; i++) {
    counters[i] = {
      tick: reader.readI32(),
      tRemaining: reader.readNonNegativeI32('timeouts.counters[].tRemaining'),
      ctRemaining: reader.readNonNegativeI32('timeouts.counters[].ctRemaining'),
    };
  }
  return { maxTacticalTimeouts, intervals, counters };
}

/** derivationInputs section —— 派生输入（用于重建统计信息的原始事件流） */
function decodeDerivationInputs(reader, version, includeSites = false) {
  const versionPos = reader.position;
  const derivationVersion = reader.readVarUint();
  if (derivationVersion !== 1) {
    throw new DecodeError(
      `derivationInputs.derivationVersion ${derivationVersion} is not supported by this decoder (supported: 1)`,
      versionPos,
    );
  }

  const roundTimingCount = reader.readArrayLength('derivationInputs.roundTiming', 10);
  const roundTiming = new Array(roundTimingCount);
  for (let i = 0; i < roundTimingCount; i++) {
    const tick = reader.readI32();
    const gameTime = reader.readBool() ? reader.readF64() : undefined;
    const roundStartTime = reader.readBool() ? reader.readF64() : undefined;
    const tActive = reader.readBool();
    const ctActive = reader.readBool();
    const technicalActive = reader.readBool();
    const tRemaining = reader.readBool() ? reader.readF64() : undefined;
    const ctRemaining = reader.readBool() ? reader.readF64() : undefined;
    roundTiming[i] = {
      tick,
      tActive,
      ctActive,
      technicalActive,
      ...(gameTime === undefined ? {} : { gameTime }),
      ...(roundStartTime === undefined ? {} : { roundStartTime }),
      ...(tRemaining === undefined ? {} : { tRemaining }),
      ...(ctRemaining === undefined ? {} : { ctRemaining }),
    };
  }

  const fireBulletsCount = reader.readArrayLength('derivationInputs.fireBullets', 30);
  const fireBullets = new Array(fireBulletsCount);
  for (let i = 0; i < fireBulletsCount; i++) {
    fireBullets[i] = {
      tick: reader.readI32(),
      attackerSteamId: reader.readString(),
      originX: reader.readF64(),
      originY: reader.readF64(),
      originZ: reader.readF64(),
      pitchDeg: reader.readF64(),
      yawDeg: reader.readF64(),
    };
  }

  const playerHurtsCount = reader.readArrayLength('derivationInputs.playerHurts', 25);
  const playerHurts = new Array(playerHurtsCount);
  for (let i = 0; i < playerHurtsCount; i++) {
    playerHurts[i] = {
      tick: reader.readI32(),
      attackerSteamId: reader.readString(),
      victimSteamId: reader.readString(),
      x: reader.readF64(),
      y: reader.readF64(),
      z: reader.readF64(),
      hitgroup: reader.readString(),
      dmgHealth: reader.readF32(),
    };
  }

  const bombEventsCount = reader.readArrayLength('derivationInputs.bombEvents', 20);
  const bombEvents = new Array(bombEventsCount);
  for (let i = 0; i < bombEventsCount; i++) {
    bombEvents[i] = {
      tick: reader.readI32(),
      eventName: reader.readString(),
      actorSteamId: reader.readString(),
      x: reader.readF64(),
      y: reader.readF64(),
      z: reader.readF64(),
      hasKit: reader.readBool(),
    };
    if (includeSites && reader.readBool()) {
      const site = reader.readString();
      if (site !== 'A' && site !== 'B') {
        throw new DecodeError(`Invalid recorded bomb site "${site}"`, reader.position);
      }
      bombEvents[i].site = site;
    }
  }

  return { derivationVersion, roundTiming, fireBullets, playerHurts, bombEvents };
}

function decodeDerivationInputsDispatch(reader, version) {
  switch (version) {
    case 1:
      return decodeDerivationInputs(reader, version, false);
    case 2:
      return decodeDerivationInputs(reader, version, true);
    default:
      return unsupportedVersion('derivationInputs', version);
  }
}

// ── Manifest 校验 ─────────────────────────────────────────────────────────────

const MAGIC_ENCODED = new TextEncoder().encode(MAGIC_BYTES);
const SHA256_BYTES = 32;
const HEADER_SIZE = MAGIC_ENCODED.length + 4 + SHA256_BYTES; // 魔数 + manifest 长度(4) + manifest sha256(32)

/** 计算聚合 section 摘要（用于与 artifactSha256 比对） */
async function computeAggregateDigest(sections) {
  const lines = sections.map(
    (s) => `${s.id}:${s.schemaVersion}:${s.codec}:${s.byteLength}:${s.sha256}`,
  );
  return sha256Hex(new TextEncoder().encode(lines.join('\n')));
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function requireString(value, fieldName) {
  if (typeof value !== 'string') throw new DecodeError(`Manifest field '${fieldName}' must be a string`);
  return value;
}

function requireOptionalString(value, fieldName) {
  if (value !== undefined) return requireString(value, fieldName);
  return undefined;
}

function requireNumber(value, fieldName) {
  if (!isFiniteNumber(value)) throw new DecodeError(`Manifest field '${fieldName}' must be a finite number`);
  return value;
}

function requireNonnegative(value, fieldName) {
  const v = requireNumber(value, fieldName);
  if (v < 0) throw new DecodeError(`Manifest field '${fieldName}' must be nonnegative, got ${v}`);
  return v;
}

function requireInteger(value, fieldName) {
  const v = requireNumber(value, fieldName);
  if (!Number.isSafeInteger(v)) throw new DecodeError(`Manifest field '${fieldName}' must be an integer, got ${v}`);
  return v;
}

function requirePositiveInt(value, fieldName) {
  const v = requireInteger(value, fieldName);
  if (v <= 0) throw new DecodeError(`Manifest field '${fieldName}' must be a positive integer, got ${v}`);
  return v;
}

function requireNonnegativeInt(value, fieldName) {
  const v = requireInteger(value, fieldName);
  if (v < 0) throw new DecodeError(`Manifest field '${fieldName}' must be a nonnegative integer, got ${v}`);
  return v;
}

function requireIntInRange(value, fieldName, min, max) {
  const v = requireInteger(value, fieldName);
  if (v < min || v > max) {
    throw new DecodeError(`Manifest field '${fieldName}' must be an integer in [${min}, ${max}], got ${v}`);
  }
  return v;
}

function requireExact(value, fieldName, expected) {
  const v = requireNumber(value, fieldName);
  if (v !== expected) throw new DecodeError(`Manifest field '${fieldName}' must be exactly ${expected}, got ${v}`);
  return v;
}

const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function requireTimestamp(value, fieldName) {
  const v = requireString(value, fieldName);
  if (!ISO_TIMESTAMP_REGEX.test(v)) {
    throw new DecodeError(`Manifest field '${fieldName}' must be an ISO-8601 timestamp (e.g. 2024-01-01T00:00:00.000Z)`);
  }
  return v;
}

/**
 * 严格校验整个 manifest 对象的结构和字段类型/取值。
 * 返回原对象（校验通过后），或抛出 DecodeError。
 */
function validateManifest(manifest) {
  if (typeof manifest !== 'object' || !manifest) throw new DecodeError('Manifest is not a JSON object');

  // container
  const container = manifest.container;
  if (typeof container !== 'object' || !container) throw new DecodeError(`Manifest field 'container' is missing`);
  requireString(container.format, 'container.format');
  requirePositiveInt(container.version, 'container.version');

  // producer
  const producer = manifest.producer;
  if (typeof producer !== 'object' || !producer) throw new DecodeError(`Manifest field 'producer' is missing`);
  requireString(producer.packageName, 'producer.packageName');
  requireString(producer.packageVersion, 'producer.packageVersion');
  requireOptionalString(producer.buildRevision, 'producer.buildRevision');
  requireOptionalString(producer.upstreamParserRevision, 'producer.upstreamParserRevision');

  // source
  const source = manifest.source;
  if (typeof source !== 'object' || !source) throw new DecodeError(`Manifest field 'source' is missing`);
  const sourceSha = requireString(source.sha256, 'source.sha256');
  if (!SHA256_REGEX.test(sourceSha)) {
    throw new DecodeError(`Manifest field 'source.sha256' is not a lowercase hex SHA-256 digest`);
  }
  requireNonnegativeInt(source.byteLength, 'source.byteLength');

  // parseOptions
  const parseOptions = manifest.parseOptions;
  if (typeof parseOptions !== 'object' || !parseOptions) throw new DecodeError(`Manifest field 'parseOptions' is missing`);
  requireIntInRange(parseOptions.sampleRate, 'parseOptions.sampleRate', 1, TICK_RATE);
  requireExact(parseOptions.tickRateAssumed, 'parseOptions.tickRateAssumed', TICK_RATE);
  const tickRateProvenance = requireString(parseOptions.tickRateProvenance, 'parseOptions.tickRateProvenance');
  if (tickRateProvenance !== 'assumed-cs2-64tick') {
    throw new DecodeError(`Manifest field 'parseOptions.tickRateProvenance' has unknown value '${tickRateProvenance}'`);
  }

  // timing
  const timing = manifest.timing;
  if (typeof timing !== 'object' || !timing) throw new DecodeError(`Manifest field 'timing' is missing`);
  requireTimestamp(timing.createdAt, 'timing.createdAt');
  requireNonnegative(timing.encodeDurationMs, 'timing.encodeDurationMs');
  if (timing.parseDurationMs !== undefined) {
    requireNonnegative(timing.parseDurationMs, 'timing.parseDurationMs');
  }

  // identity
  const identity = manifest.identity;
  if (typeof identity !== 'object' || !identity) throw new DecodeError(`Manifest field 'identity' is missing`);
  requireString(identity.mapName, 'identity.mapName');
  const numPlayers = requireNonnegativeInt(identity.numPlayers, 'identity.numPlayers');
  if (!Array.isArray(identity.players)) throw new DecodeError(`Manifest field 'identity.players' must be an array`);
  if (identity.players.length !== numPlayers) {
    throw new DecodeError(
      `Manifest field 'identity.players' has ${identity.players.length} entrie(s), but identity.numPlayers is ${numPlayers}`,
    );
  }
  const seenSlots = new Set();
  for (const [i, player] of identity.players.entries()) {
    if (typeof player !== 'object' || !player) {
      throw new DecodeError(`Manifest field 'identity.players[${i}]' must be an object`);
    }
    const slot = requireIntInRange(player.slot, `identity.players[${i}].slot`, 0, Math.max(0, numPlayers - 1));
    if (seenSlots.has(slot)) throw new DecodeError(`Manifest field 'identity.players' has duplicate slot ${slot}`);
    seenSlots.add(slot);
    requireString(player.steamId, `identity.players[${i}].steamId`);
    requireString(player.name, `identity.players[${i}].name`);
  }

  requireNonnegativeInt(identity.bombSiteClassifierVersion, 'identity.bombSiteClassifierVersion');

  // sections
  if (!Array.isArray(manifest.sections)) throw new DecodeError(`Manifest field 'sections' must be an array`);
  const seenSectionIds = new Set();
  for (const [i, section] of manifest.sections.entries()) {
    if (typeof section !== 'object' || !section) {
      throw new DecodeError(`Manifest field 'sections[${i}]' must be an object`);
    }
    const id = requireString(section.id, `sections[${i}].id`);
    if (seenSectionIds.has(id)) throw new DecodeError(`Manifest has duplicate section id '${id}'`);
    seenSectionIds.add(id);
    requirePositiveInt(section.schemaVersion, `sections[${i}].schemaVersion`);

    const kind = requireString(section.kind, `sections[${i}].kind`);
    if (kind !== 'canonical' && kind !== 'derived') {
      throw new DecodeError(`Manifest field 'sections[${i}].kind' has unknown value '${kind}'`);
    }
    const known = KNOWN_SECTIONS.find((s) => s.id === id);
    if (known && known.kind !== kind) {
      throw new DecodeError(`Section '${id}' has kind '${kind}', but this decoder knows '${id}' as kind '${known.kind}'`);
    }

    const codec = requireString(section.codec, `sections[${i}].codec`);
    if (!SUPPORTED_CODECS.includes(codec)) {
      throw new DecodeError(`Section '${id}' has unsupported codec '${codec}'`);
    }

    requireNonnegativeInt(section.byteOffset, `sections[${i}].byteOffset`);
    requireNonnegativeInt(section.byteLength, `sections[${i}].byteLength`);

    if (codec === 'gzip') {
      const uncompressed = requireNonnegativeInt(section.uncompressedByteLength, `sections[${i}].uncompressedByteLength`);
      if (uncompressed > MAX_BYTE_BLOCK) {
        throw new DecodeError(`Manifest field 'sections[${i}].uncompressedByteLength' exceeds max ${MAX_BYTE_BLOCK}`);
      }
    } else if (section.uncompressedByteLength !== undefined) {
      throw new DecodeError(`Manifest field 'sections[${i}].uncompressedByteLength' is only valid for compressed sections`);
    }

    const sectionSha = requireString(section.sha256, `sections[${i}].sha256`);
    if (!SHA256_REGEX.test(sectionSha)) {
      throw new DecodeError(`Manifest field 'sections[${i}].sha256' is not a lowercase hex SHA-256 digest`);
    }
  }

  const artifactSha = requireString(manifest.artifactSha256, 'artifactSha256');
  if (!SHA256_REGEX.test(artifactSha)) {
    throw new DecodeError(`Manifest field 'artifactSha256' is not a lowercase hex SHA-256 digest`);
  }

  return manifest;
}

/**
 * 解析 artifact 头部：魔数 + manifest 长度 + manifest sha256 + manifest JSON。
 * 返回校验后的 manifest 对象。
 */
async function parseArtifactHeader(bytes) {
  if (bytes.length < HEADER_SIZE) {
    throw new DecodeError(`Artifact is too short to contain a header (${bytes.length} bytes)`, 0);
  }
  for (let i = 0; i < MAGIC_ENCODED.length; i++) {
    if (bytes[i] !== MAGIC_ENCODED[i]) {
      throw new DecodeError(`Bad magic bytes: expected '${MAGIC_BYTES}'`, i);
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const manifestLength = view.getUint32(MAGIC_ENCODED.length, true);
  if (manifestLength > MAX_MANIFEST_BYTES) {
    throw new DecodeError(`Manifest length ${manifestLength} exceeds max ${MAX_MANIFEST_BYTES}`, MAGIC_ENCODED.length);
  }

  const manifestShaOffset = MAGIC_ENCODED.length + 4;
  const manifestShaBytes = bytes.subarray(manifestShaOffset, manifestShaOffset + SHA256_BYTES);
  const manifestStart = HEADER_SIZE;

  if (manifestLength > bytes.length - manifestStart) {
    throw new DecodeError(
      `Manifest length ${manifestLength} exceeds remaining bytes ${bytes.length - manifestStart}`,
      manifestStart,
    );
  }

  const manifestBytes = bytes.subarray(manifestStart, manifestStart + manifestLength);
  const manifestDigest = await sha256Bytes(manifestBytes);
  if (manifestShaBytes.length !== SHA256_BYTES || !manifestDigest.every((b, i) => b === manifestShaBytes[i])) {
    throw new DecodeError(
      `Manifest failed integrity check (sha256 mismatch) — the manifest bytes are corrupt`,
      manifestStart,
    );
  }

  let manifestJson;
  try {
    manifestJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch (err) {
    throw new DecodeError(`Manifest is not valid JSON: ${err.message}`, manifestStart);
  }

  const manifest = validateManifest(manifestJson);
  if (manifest.container.format !== CONTAINER_FORMAT) {
    throw new DecodeError(`Unknown container format '${manifest.container.format}', expected '${CONTAINER_FORMAT}'`);
  }
  if (!SUPPORTED_CONTAINER_VERSIONS.has(manifest.container.version)) {
    throw new DecodeError(
      `Artifact container version ${manifest.container.version} is not supported by this decoder (supported: ${[...SUPPORTED_CONTAINER_VERSIONS].join(', ')}). Upgrade @csdemo/parser or check for a corrupt file.`,
    );
  }
  return manifest;
}

/**
 * 完整解码一个 CSDA artifact。
 *
 * 流程：
 *  1. 解析并校验头部 manifest。
 *  2. 按 manifest 中声明的字节偏移，逐个 section 做 sha256 校验 + 解压（如需）。
 *  3. 对每个 section 用对应的解码函数解码。
 *  4. 做大量跨 section 一致性校验（numPlayers、tickRate、durationSeconds 等）。
 *
 * @param {Uint8Array} bytes artifact 完整字节
 * @param {{verifyChecksums?: boolean}} options
 */
async function decodeArtifact(bytes, options = {}) {
  const verifyChecksums = options.verifyChecksums ?? true;

  const manifest = await parseArtifactHeader(bytes);
  const payloadStart = HEADER_SIZE + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    MAGIC_ENCODED.length,
    true,
  );
  const payloadArea = bytes.length - payloadStart;

  let consumed = 0;
  const decodedSections = new Map();

  for (const section of manifest.sections) {
    if (section.byteOffset !== consumed) {
      throw new DecodeError(
        `Section '${section.id}' byteOffset ${section.byteOffset} is not contiguous (expected ${consumed})`,
      );
    }
    if (section.byteLength < 0 || section.byteOffset + section.byteLength > payloadArea) {
      throw new DecodeError(
        `Section '${section.id}' [${section.byteOffset}, ${section.byteOffset + section.byteLength}) exceeds payload area of ${payloadArea} byte(s)`,
      );
    }

    const sectionBytes = bytes.subarray(
      payloadStart + section.byteOffset,
      payloadStart + section.byteOffset + section.byteLength,
    );

    if (verifyChecksums && (await sha256Hex(sectionBytes)) !== section.sha256) {
      throw new DecodeError(`Section '${section.id}' failed checksum verification (sha256 mismatch)`);
    }

    // 只解压解码器认识的 section（KNOWN_SECTIONS 里有定义的）
    if (KNOWN_SECTIONS.some((s) => s.id === section.id)) {
      decodedSections.set(
        section.id,
        await decompressSection(sectionBytes, section.codec, section.uncompressedByteLength, section.id),
      );
    }
    consumed += section.byteLength;
  }

  if (consumed !== payloadArea) {
    throw new DecodeError(
      `Section payloads (${consumed} byte(s)) do not fill the declared payload area (${payloadArea} byte(s))`,
    );
  }

  if (verifyChecksums && (await computeAggregateDigest(manifest.sections)) !== manifest.artifactSha256) {
    throw new DecodeError(`Artifact failed aggregate section-digest verification (sha256 mismatch)`);
  }

  for (const required of REQUIRED_SECTIONS) {
    if (!decodedSections.has(required)) throw new DecodeError(`Artifact is missing required section '${required}'`);
  }

  const getSection = (id) => manifest.sections.find((s) => s.id === id);

  // 解码必需 section，并校验无残留字节
  function decodeRequired(id, decoder) {
    const section = getSection(id);
    const bytes = decodedSections.get(id);
    if (!section || !bytes) throw new DecodeError(`Artifact is missing required section '${id}'`);
    const reader = new ByteReader(bytes, payloadStart + section.byteOffset);
    const result = decoder(reader, section.schemaVersion);
    if (!reader.isAtEnd) {
      throw new DecodeError(`Section '${id}' has ${reader.remaining} unconsumed trailing byte(s) after decoding`);
    }
    return result;
  }

  // 解码可选 section（不存在则返回 undefined）
  function decodeOptional(id, decoder) {
    const section = getSection(id);
    const bytes = decodedSections.get(id);
    if (!section || !bytes) return undefined;
    const reader = new ByteReader(bytes, payloadStart + section.byteOffset);
    const result = decoder(reader, section.schemaVersion);
    if (!reader.isAtEnd) {
      throw new DecodeError(`Section '${id}' has ${reader.remaining} unconsumed trailing byte(s) after decoding`);
    }
    return result;
  }

  const core = decodeRequired('core', decodeCore);
  const frames = decodeRequired('frames', decodeFrames);
  const events = decodeRequired('events', decodeEvents);
  const rounds = decodeRequired('rounds', decodeRounds);
  const grenades = decodeRequired('grenades', decodeGrenadesDispatch);
  const infernos = decodeRequired('infernos', decodeInfernos);
  const smokeVoxels = decodeRequired('smokeVoxels', decodeSmokeVoxels);
  const tracers = decodeRequired('tracers', decodeTracers);
  const panels = decodeRequired('panels', decodePanels);
  const deathMarkers = decodeRequired('deathMarkers', decodeDeathMarkers);
  const damage = decodeRequired('damage', decodeDamage);
  const bomb = decodeRequired('bomb', decodeBomb);
  const timeouts = decodeRequired('timeouts', decodeTimeouts);

  const droppedWeapons = decodeOptional('droppedWeapons', decodeDroppedWeapons);
  const weaponFires = decodeOptional('weaponFires', decodeWeaponFires);
  const mapEntities = decodeOptional('mapEntities', decodeMapEntities);
  const deathRagdolls = decodeOptional('deathRagdolls', decodeDeathRagdolls);
  const playerColors = decodeOptional('playerColors', decodePlayerColors);
  const derivationInputs = decodeOptional('derivationInputs', decodeDerivationInputsDispatch);

  // ── 跨 section 一致性校验 ──

  if (core.meta.numPlayers !== panels.numPlayers) {
    throw new DecodeError(
      `core.meta.numPlayers (${core.meta.numPlayers}) does not match panels.numPlayers (${panels.numPlayers})`,
    );
  }
  if (core.meta.numPlayers !== frames.numPlayers) {
    throw new DecodeError(
      `core.meta.numPlayers (${core.meta.numPlayers}) does not match frames.numPlayers (${frames.numPlayers})`,
    );
  }
  if (core.meta.numPlayers !== manifest.identity.numPlayers) {
    throw new DecodeError(
      `core.meta.numPlayers (${core.meta.numPlayers}) does not match manifest.identity.numPlayers (${manifest.identity.numPlayers})`,
    );
  }
  if (manifest.identity.players.length !== core.players.length) {
    throw new DecodeError(
      `manifest.identity.players has ${manifest.identity.players.length} entrie(s), but core.players has ${core.players.length}`,
    );
  }

  // 校验 identity.players 与 core.players 逐 slot 一致
  const corePlayersBySlot = new Map(core.players.map((p) => [p.slot, p]));
  for (const [i, idPlayer] of manifest.identity.players.entries()) {
    const corePlayer = corePlayersBySlot.get(idPlayer.slot);
    if (!corePlayer || corePlayer.steamId !== idPlayer.steamId || corePlayer.name !== idPlayer.name) {
      throw new DecodeError(
        `manifest.identity.players[${i}] (slot=${idPlayer.slot}, steamId=${idPlayer.steamId}, name=${idPlayer.name}) does not match the corresponding core.players entry`,
      );
    }
  }

  if (frames.frames.frameTick.length !== core.meta.numFrames) {
    throw new DecodeError(
      `frames section has ${frames.frames.frameTick.length} frame(s), but core.meta.numFrames is ${core.meta.numFrames}`,
    );
  }

  if (core.meta.tickRate !== TICK_RATE) {
    throw new DecodeError(
      `core.meta.tickRate is ${core.meta.tickRate}, but this decoder only trusts the fixed ${TICK_RATE}-tick CS2 assumption (see docs/artifact.md#tick-rate); refusing to decode a tick rate this package cannot back up with real provenance.`,
    );
  }
  if (manifest.parseOptions.tickRateAssumed !== core.meta.tickRate) {
    throw new DecodeError(
      `manifest.parseOptions.tickRateAssumed (${manifest.parseOptions.tickRateAssumed}) does not match core.meta.tickRate (${core.meta.tickRate})`,
    );
  }
  if (manifest.parseOptions.sampleRate !== core.meta.sampleRate) {
    throw new DecodeError(
      `manifest.parseOptions.sampleRate (${manifest.parseOptions.sampleRate}) does not match core.meta.sampleRate (${core.meta.sampleRate})`,
    );
  }
  if (core.meta.endTick < core.meta.startTick) {
    throw new DecodeError(`core.meta.endTick (${core.meta.endTick}) precedes core.meta.startTick (${core.meta.startTick})`);
  }
  if (!Number.isFinite(core.meta.durationSeconds) || core.meta.durationSeconds < 0) {
    throw new DecodeError(`core.meta.durationSeconds (${core.meta.durationSeconds}) must be a nonnegative finite number`);
  }
  const derivedDuration = (core.meta.endTick - core.meta.startTick) / core.meta.tickRate;
  if (Math.abs(core.meta.durationSeconds - derivedDuration) > 1e-6) {
    throw new DecodeError(
      `core.meta.durationSeconds (${core.meta.durationSeconds}) is inconsistent with (endTick - startTick) / tickRate (${derivedDuration})`,
    );
  }

  // 校验 deathRagdolls 的 slot 合法
  for (const [i, ragdoll] of (deathRagdolls ?? []).entries()) {
    if (ragdoll.slot >= core.meta.numPlayers) {
      throw new DecodeError(`deathRagdolls[${i}].slot (${ragdoll.slot}) is not a player slot`);
    }
  }

  // 把 playerColors 合并进玩家列表
  if (playerColors !== undefined) {
    if (playerColors.length !== core.players.length) {
      throw new DecodeError(`playerColors has ${playerColors.length} entrie(s), but core.players has ${core.players.length}`);
    }
    for (const [i, color] of playerColors.entries()) {
      if (color !== undefined) core.players[i].color = color;
    }
  }

  // grenades + infernos 合并（infernos 作为 grenades 的补充）
  const grenadesWithInfernos = { ...grenades, infernos };

  return {
    manifest,
    data: {
      meta: core.meta,
      players: core.players,
      frames: frames.frames,
      events,
      rounds,
      grenades: grenadesWithInfernos,
      tracers,
      smokeVoxels,
      panelFrames: panels.panelFrames,
      weaponNames: core.weaponNames,
      deathMarkers,
      damage,
      bomb,
      timeouts,
      ...(droppedWeapons === undefined ? {} : { droppedWeapons }),
      ...(weaponFires === undefined ? {} : { weaponFires }),
      ...(mapEntities === undefined ? {} : { mapEntities }),
      ...(deathRagdolls === undefined ? {} : { deathRagdolls }),
    },
    ...(derivationInputs === undefined ? {} : { derivationInputs }),
  };
}

/** 计算字节数组的 SHA-256 十六进制（供下载校验复用） */
async function hashBytesToHex(bytes) {
  const data = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
