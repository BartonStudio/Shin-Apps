// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 49254–49469 行（切片 37/40）
// 角色：CSDA 容器校验/解码（CF + Z 错误，含作者英文 schema notes）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var lF = `CSDA`,
  uF = `csdemo-artifact`,
  dF = 64,
  fF = [`none`, `gzip`],
  pF = [
    {
      id: `core`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !0,
      notes: `Match meta, player identity/slot table, and the weapon-name lookup table.`,
    },
    {
      id: `frames`,
      schemaVersion: 4,
      kind: `canonical`,
      recomputable: !0,
      required: !0,
      notes: `Sampled per-tick, per-player movement/status columns, with optional recorded weapon accuracy penalty (v2+), reload state (v3+) and player flags: on ground, grenade pin pulled, C4 arming (v4). Versions 1-3 remain decodable without those columns.`,
    },
    {
      id: `events`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !0,
      notes: `Kill/round/bomb timeline events with resolved player identity.`,
    },
    {
      id: `rounds`,
      schemaVersion: 1,
      kind: `derived`,
      recomputable: !1,
      required: !0,
      notes:
        "Round segmentation and live-start normalization. `liveStartTick` is recomputable via ./derive.ts::recomputeRoundLiveStarts when `derivationInputs.roundTiming` is present.",
    },
    {
      id: `grenades`,
      schemaVersion: 2,
      kind: `derived`,
      recomputable: !1,
      required: !0,
      notes:
        "Grenade trajectories (near-raw capture) plus heuristic effect-radius/duration windows, with optional per-sample projectile rotation and molotov incendiary flag (v2; v1 remains decodable without them). Baked as one unit; raw per-tick projectile/detonation columns are not retained, so this remains baked-only even with `derivationInputs` present.",
    },
    {
      id: `infernos`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !0,
      notes: `Raw per-frame fire voxel/position capture from the native inferno snapshot pass.`,
    },
    {
      id: `smokeVoxels`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !0,
      notes: `Raw CS2 volumetric-smoke voxel journal, byte-for-byte as captured.`,
    },
    {
      id: `tracers`,
      schemaVersion: 1,
      kind: `derived`,
      recomputable: !1,
      required: !0,
      notes:
        "Bullet tracer endpoints; a miss is baked to a fixed-length heuristic ray, not the true trajectory. Fully recomputable via ./derive.ts::recomputeTracers when `derivationInputs.fireBullets`/`playerHurts` are present.",
    },
    {
      id: `panels`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !0,
      notes: `Sampled per-player economy/equipment columns for the side panels.`,
    },
    {
      id: `deathMarkers`,
      schemaVersion: 1,
      kind: `derived`,
      recomputable: !0,
      required: !0,
      notes: `Computed from events + rounds + frames, all of which are canonical and already retained — fully recomputable via ./derive.ts::recomputeDeathMarkers with no extra facts needed.`,
    },
    {
      id: `damage`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !0,
      notes:
        "Per-hit damage repackaged directly from player_hurt facts. Also recomputable via ./derive.ts::recomputeDamage when `derivationInputs.playerHurts` is present.",
    },
    {
      id: `bomb`,
      schemaVersion: 1,
      kind: `derived`,
      recomputable: !0,
      required: !0,
      notes:
        "Segments/defuses are baked from bomb events, BUT each planted segment retains its raw x/y and its site LETTER is a versioned map classification recomputable via ./derive.ts::recomputeBombSiteLabels without the source .dem. The full segment/defuse lifecycle is ALSO recomputable via ./derive.ts::recomputeBomb when `derivationInputs.bombEvents` is present.",
    },
    {
      id: `timeouts`,
      schemaVersion: 1,
      kind: `derived`,
      recomputable: !1,
      required: !0,
      notes:
        "Baked from native timeout counters plus heuristic technical-pause inference. Fully recomputable via ./derive.ts::recomputeTimeouts when `derivationInputs.roundTiming` is present.",
    },
    {
      id: `droppedWeapons`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !1,
      notes:
        "Unowned weapon spans (dropped, thrown, or left by dead players) with per-change position and QAngle samples, captured from weapon entity state. Excludes the C4 (see `bomb`) and grenades in flight (see `grenades`). Optional: absent on artifacts that predate drop capture.",
    },
    {
      id: `weaponFires`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !1,
      notes: `Every weapon_fire event (shots, knife swings, grenade throws) as ascending tick + firing player slot. Optional: absent on artifacts that predate fire capture.`,
    },
    {
      id: `mapEntities`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !1,
      notes: `Map-placed doors, func_breakable, func_brush and prop_dynamic lifetimes (class, origin, start/end tick) with per-change QAngle and hidden samples. Breaking deletes the entity, so breaks appear as mid-round end ticks. Optional: absent on artifacts that predate map-entity capture.`,
    },
    {
      id: `deathRagdolls`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !1,
      notes: `Per player death, the networked CCSPlayerPawn ragdoll seed read on the tick m_flDeathTime changes: tick, victim slot, m_vRagdollDamageForce, m_nRagdollDamageBone, m_bRagdollDamageHeadshot and m_qDeathEyeAngles pitch/yaw, ascending tick. Optional: absent on artifacts that predate ragdoll capture.`,
    },
    {
      id: `playerColors`,
      schemaVersion: 1,
      kind: `canonical`,
      recomputable: !0,
      required: !1,
      notes: `Per core.players entry, the CS2 competitive player colour (m_iCompTeammateColor: blue, green, yellow, orange, purple) as one byte, 255 when unassigned. Written only when at least one player has a colour. Optional: absent on artifacts that predate player-colour capture.`,
    },
    {
      id: `derivationInputs`,
      schemaVersion: 2,
      kind: `canonical`,
      recomputable: !1,
      required: !1,
      notes: `Small, bounded, near-raw facts (round/timeout timing samples, fire_bullets/player_hurt facts, raw bomb events) retained so a subset of derived sections above can be recomputed without the source .dem. Optional: absent on any artifact produced without them (e.g. an older producer); decoders must default it to undefined, never error. See docs/artifact.md#derivation-inputs.`,
    },
  ],
  mF = [
    `core`,
    `frames`,
    `events`,
    `rounds`,
    `grenades`,
    `infernos`,
    `smokeVoxels`,
    `tracers`,
    `panels`,
    `deathMarkers`,
    `damage`,
    `bomb`,
    `timeouts`,
  ],
  hF = new Set([1]),
  gF = 8 * 1024 * 1024,
  Z = class extends Error {
    offset
    constructor(e, t) {
      ;(super(t === void 0 ? e : `${e} (at byte offset ${t})`), (this.name = `ArtifactDecodeError`), (this.offset = t))
    }
  },
  Q = { None: 0, Float32: 1, Int32: 2, Uint8: 3, Uint16: 4, Float64: 5 },
  _F = new Set(Object.values(Q))
function vF(e) {
  switch (e) {
    case Q.Uint8:
      return 1
    case Q.Uint16:
      return 2
    case Q.Float32:
      return 4
    case Q.Int32:
      return 4
    case Q.Float64:
      return 8
    default:
      throw TypeError(`Unknown typed array tag ${e}.`)
  }
}
var yF = 1024 * 1024 * 1024,
  bF = 16 * 1024 * 1024,
  xF = 64 * 1024 * 1024
function SF(e) {
  let t = e,
    n = 0
  do (n++, (t = Math.floor(t / 128)))
  while (t !== 0)
  return n
}
