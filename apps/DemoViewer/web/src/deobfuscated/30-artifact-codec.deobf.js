// ============================================================================
// 30-artifact-codec.deobf.js —— CSDA 容器格式定义（头部结构）
// 来源：src/app/30-artifact-codec.js（Vite 生产构建，prettier 展开版）
// 原始标识符已语义化重命名 + 补充中文注释。
//
// CSDA = "CS Demo Artifact"，是 csdemo.tv 自研的 demo 数据序列化格式。
// 本切片定义了容器的"目录"部分：每个 section（数据段）的元数据描述，
// 以及解码所需的类型枚举、错误类和 varint 编码基础。
// 实际二进制解码逻辑（varint 读写 + 各 section 解码器）位于后续切片。
// ============================================================================

// 文件魔数（4 字节，用于识别 CSDA 容器）
const MAGIC = `CSDA`
// MIME 类型
const MIME_TYPE = `csdemo-artifact`
// SHA-256 摘要长度（字节）
const SHA256_LEN = 64
// 支持的压缩方式
const COMPRESSION_MODES = [`none`, `gzip`]

// ────────────────────────────────────────────────────────────────────────────
// Section 清单：CSDA 容器的 21 个数据段
//   每个 section 有：
//   - id            唯一标识
//   - schemaVersion 该 section 的 schema 版本号
//   - kind          canonical（原始事实，可直接从 .dem 重算）/ derived（派生数据，需烘焙）
//   - recomputable  是否可在有 derivationInputs 时从源 .dem 重新计算
//   - required      是否必需（缺失则容器不完整）
//   - notes         语义说明
// ────────────────────────────────────────────────────────────────────────────
const SECTIONS = [
  {
    id: `core`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: true,
    notes: `Match meta, player identity/slot table, and the weapon-name lookup table.`,
  },
  {
    id: `frames`, schemaVersion: 4, kind: `canonical`, recomputable: true, required: true,
    notes: `Sampled per-tick, per-player movement/status columns, with optional recorded weapon accuracy penalty (v2+), reload state (v3+) and player flags: on ground, grenade pin pulled, C4 arming (v4). Versions 1-3 remain decodable without those columns.`,
  },
  {
    id: `events`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: true,
    notes: `Kill/round/bomb timeline events with resolved player identity.`,
  },
  {
    id: `rounds`, schemaVersion: 1, kind: `derived`, recomputable: false, required: true,
    notes: `Round segmentation and live-start normalization. \`liveStartTick\` is recomputable via ./derive.ts::recomputeRoundLiveStarts when \`derivationInputs.roundTiming\` is present.`,
  },
  {
    id: `grenades`, schemaVersion: 2, kind: `derived`, recomputable: false, required: true,
    notes: `Grenade trajectories (near-raw capture) plus heuristic effect-radius/duration windows, with optional per-sample projectile rotation and molotov incendiary flag (v2; v1 remains decodable without them). Baked as one unit; raw per-tick projectile/detonation columns are not retained, so this remains baked-only even with \`derivationInputs\` present.`,
  },
  {
    id: `infernos`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: true,
    notes: `Raw per-frame fire voxel/position capture from the native inferno snapshot pass.`,
  },
  {
    id: `smokeVoxels`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: true,
    notes: `Raw CS2 volumetric-smoke voxel journal, byte-for-byte as captured.`,
  },
  {
    id: `tracers`, schemaVersion: 1, kind: `derived`, recomputable: false, required: true,
    notes: `Bullet tracer endpoints; a miss is baked to a fixed-length heuristic ray, not the true trajectory. Fully recomputable via ./derive.ts::recomputeTracers when \`derivationInputs.fireBullets\`/\`playerHurts\` are present.`,
  },
  {
    id: `panels`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: true,
    notes: `Sampled per-player economy/equipment columns for the side panels.`,
  },
  {
    id: `deathMarkers`, schemaVersion: 1, kind: `derived`, recomputable: true, required: true,
    notes: `Computed from events + rounds + frames, all of which are canonical and already retained — fully recomputable via ./derive.ts::recomputeDeathMarkers with no extra facts needed.`,
  },
  {
    id: `damage`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: true,
    notes: `Per-hit damage repackaged directly from player_hurt facts. Also recomputable via ./derive.ts::recomputeDamage when \`derivationInputs.playerHurts\` is present.`,
  },
  {
    id: `bomb`, schemaVersion: 1, kind: `derived`, recomputable: true, required: true,
    notes: `Segments/defuses are baked from bomb events, BUT each planted segment retains its raw x/y and its site LETTER is a versioned map classification recomputable via ./derive.ts::recomputeBombSiteLabels without the source .dem. The full segment/defuse lifecycle is ALSO recomputable via ./derive.ts::recomputeBomb when \`derivationInputs.bombEvents\` is present.`,
  },
  {
    id: `timeouts`, schemaVersion: 1, kind: `derived`, recomputable: false, required: true,
    notes: `Baked from native timeout counters plus heuristic technical-pause inference. Fully recomputable via ./derive.ts::recomputeTimeouts when \`derivationInputs.roundTiming\` is present.`,
  },
  {
    id: `droppedWeapons`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: false,
    notes: `Unowned weapon spans (dropped, thrown, or left by dead players) with per-change position and QAngle samples, captured from weapon entity state. Excludes the C4 (see \`bomb\`) and grenades in flight (see \`grenades\`). Optional: absent on artifacts that predate drop capture.`,
  },
  {
    id: `weaponFires`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: false,
    notes: `Every weapon_fire event (shots, knife swings, grenade throws) as ascending tick + firing player slot. Optional: absent on artifacts that predate fire capture.`,
  },
  {
    id: `mapEntities`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: false,
    notes: `Map-placed doors, func_breakable, func_brush and prop_dynamic lifetimes (class, origin, start/end tick) with per-change QAngle and hidden samples. Breaking deletes the entity, so breaks appear as mid-round end ticks. Optional: absent on artifacts that predate map-entity capture.`,
  },
  {
    id: `deathRagdolls`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: false,
    notes: `Per player death, the networked CCSPlayerPawn ragdoll seed read on the tick m_flDeathTime changes: tick, victim slot, m_vRagdollDamageForce, m_nRagdollDamageBone, m_bRagdollDamageHeadshot and m_qDeathEyeAngles pitch/yaw, ascending tick. Optional: absent on artifacts that predate ragdoll capture.`,
  },
  {
    id: `playerColors`, schemaVersion: 1, kind: `canonical`, recomputable: true, required: false,
    notes: `Per core.players entry, the CS2 competitive player colour (m_iCompTeammateColor: blue, green, yellow, orange, purple) as one byte, 255 when unassigned. Written only when at least one player has a colour. Optional: absent on artifacts that predate player-colour capture.`,
  },
  {
    id: `derivationInputs`, schemaVersion: 2, kind: `canonical`, recomputable: false, required: false,
    notes: `Small, bounded, near-raw facts (round/timeout timing samples, fire_bullets/player_hurt facts, raw bomb events) retained so a subset of derived sections above can be recomputed without the source .dem. Optional: absent on any artifact produced without them (e.g. an older producer); decoders must default it to undefined, never error. See docs/artifact.md#derivation-inputs.`,
  },
]

// 必需的 section 顺序（解码时按此顺序读取）
const REQUIRED_SECTION_ORDER = [
  `core`, `frames`, `events`, `rounds`, `grenades`, `infernos`, `smokeVoxels`,
  `tracers`, `panels`, `deathMarkers`, `damage`, `bomb`, `timeouts`,
]

// 支持的容器 schema 版本（当前仅 v1）
const SUPPORTED_CONTAINER_VERSIONS = new Set([1])
// 单个 section 最大字节数（防御性上限）
const MAX_SECTION_BYTES = 8 * 1024 * 1024

// ────────────────────────────────────────────────────────────────────────────
// 解码错误（带字节偏移，便于定位损坏位置）
// ────────────────────────────────────────────────────────────────────────────
class ArtifactDecodeError extends Error {
  offset
  constructor(message, offset) {
    super(offset === undefined ? message : `${message} (at byte offset ${offset})`)
    this.name = `ArtifactDecodeError`
    this.offset = offset
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 标量类型枚举（section 内每列的基础类型 tag）
// ────────────────────────────────────────────────────────────────────────────
const ScalarType = {
  None: 0,
  Float32: 1,
  Int32: 2,
  Uint8: 3,
  Uint16: 4,
  Float64: 5,
}
const VALID_SCALAR_TYPES = new Set(Object.values(ScalarType))

// 每种标量类型的字节宽度
function scalarByteWidth(tag) {
  switch (tag) {
    case ScalarType.Uint8: return 1
    case ScalarType.Uint16: return 2
    case ScalarType.Float32: return 4
    case ScalarType.Int32: return 4
    case ScalarType.Float64: return 8
    default: throw TypeError(`Unknown typed array tag ${tag}.`)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 尺寸上限（解码时的内存保护）
// ────────────────────────────────────────────────────────────────────────────
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024      // 1 GiB 总上限
const MAX_SECTION_DECODED = 16 * 1024 * 1024    // 16 MiB 单 section 解码后上限
const MAX_ARRAY_LENGTH = 64 * 1024 * 1024       // 64M 元素数上限

// 计算 varint 编码一个非负整数所需的字节数
function varintByteLength(value) {
  let v = value
  let len = 0
  do { len++; v = Math.floor(v / 128) } while (v !== 0)
  return len
}
