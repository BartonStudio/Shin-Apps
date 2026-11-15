// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 49470–50816 行（切片 38/40）
// 角色：托管 demo 下载（sha256/gunzip）+ **CSDA 二进制解码器（21 section）** + parser worker 桥接 + IndexedDB + 队伍识别（YI）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var CF = class {
  bytes
  view
  base
  cursor = 0
  constructor(e, t = 0) {
    ;((this.bytes = e), (this.view = new DataView(e.buffer, e.byteOffset, e.byteLength)), (this.base = t))
  }
  get position() {
    return this.cursor
  }
  get remaining() {
    return this.bytes.length - this.cursor
  }
  get isAtEnd() {
    return this.cursor >= this.bytes.length
  }
  need(e) {
    if (!Number.isInteger(e) || e < 0 || this.cursor + e > this.bytes.length)
      throw new Z(
        `Unexpected end of data: need ${e} more byte(s), have ${Math.max(0, this.remaining)}`,
        this.base + this.cursor,
      )
  }
  readU8() {
    return (this.need(1), this.bytes[this.cursor++])
  }
  readBool() {
    let e = this.base + this.cursor,
      t = this.readU8()
    if (t !== 0 && t !== 1) throw new Z(`Boolean byte must be 0 or 1, got ${t}`, e)
    return t === 1
  }
  readU16() {
    this.need(2)
    let e = this.view.getUint16(this.cursor, !0)
    return ((this.cursor += 2), e)
  }
  readI32() {
    this.need(4)
    let e = this.view.getInt32(this.cursor, !0)
    return ((this.cursor += 4), e)
  }
  readU32() {
    this.need(4)
    let e = this.view.getUint32(this.cursor, !0)
    return ((this.cursor += 4), e)
  }
  readNonNegativeI32(e) {
    let t = this.base + this.cursor,
      n = this.readI32()
    if (!Number.isInteger(n) || n < 0) throw new Z(`Field '${e}' must be a nonnegative integer, got ${n}`, t)
    return n
  }
  readF32() {
    this.need(4)
    let e = this.view.getFloat32(this.cursor, !0)
    return ((this.cursor += 4), e)
  }
  readF64() {
    this.need(8)
    let e = this.view.getFloat64(this.cursor, !0)
    return ((this.cursor += 8), e)
  }
  readVarUint() {
    let e = this.base + this.cursor,
      t = 0,
      n = 0,
      r = 0,
      i
    do
      if (((i = this.readU8()), r++, (t += (i & 127) * 2 ** n), (n += 7), n > 49))
        throw new Z(`Varuint exceeds supported range`, e)
    while (i & 128)
    if (!Number.isSafeInteger(t)) throw new Z(`Varuint exceeds the safe integer range`, e)
    if (r !== SF(t)) throw new Z(`Varuint is not in canonical (minimal) encoding`, e)
    return t
  }
  readArrayLength(e, t = 1) {
    let n = this.base + this.cursor,
      r = this.readVarUint()
    if (r > xF) throw new Z(`Field '${e}' has count ${r} exceeding max ${xF}`, n)
    if (r > (t > 0 ? Math.floor(this.remaining / t) : this.remaining))
      throw new Z(
        `Field '${e}' declares ${r} element(s) but only ${this.remaining} byte(s) remain (each needs >= ${t} byte(s))`,
        n,
      )
    return r
  }
  readBytes() {
    let e = this.readVarUint()
    if (e > 1073741824) throw new Z(`Byte block length ${e} exceeds max ${yF}`, this.base + this.cursor)
    this.need(e)
    let t = this.bytes.slice(this.cursor, this.cursor + e)
    return ((this.cursor += e), t)
  }
  readString() {
    let e = this.readVarUint()
    if (e > bF) throw new Z(`String length ${e} exceeds max ${bF}`, this.base + this.cursor)
    this.need(e)
    let t = this.bytes.subarray(this.cursor, this.cursor + e)
    this.cursor += e
    try {
      return new TextDecoder(`utf-8`, { fatal: !0 }).decode(t)
    } catch (e) {
      throw new Z(`Invalid UTF-8 string: ${e.message}`, this.base + this.cursor)
    }
  }
  readOptionalString() {
    return this.readBool() ? this.readString() : void 0
  }
  readStringArray(e = `stringArray`) {
    let t = this.readArrayLength(e, 1),
      n = Array(t)
    for (let e = 0; e < t; e++) n[e] = this.readString()
    return n
  }
  readTypedArray() {
    let e = this.base + this.cursor,
      t = this.readU8()
    if (t === Q.None) return
    if (!_F.has(t)) throw new Z(`Unknown typed array tag ${t}`, e)
    let n = this.readVarUint()
    if (n > xF) throw new Z(`Typed array length ${n} exceeds max ${xF}`, this.base + this.cursor)
    let r = vF(t),
      i = n * r
    this.need(i)
    let a =
      t === Q.Float32
        ? new Float32Array(n)
        : t === Q.Int32
          ? new Int32Array(n)
          : t === Q.Uint16
            ? new Uint16Array(n)
            : t === Q.Float64
              ? new Float64Array(n)
              : new Uint8Array(n)
    for (let e = 0; e < n; e++) {
      let n = this.cursor + e * r
      switch (t) {
        case Q.Float32:
          a[e] = this.view.getFloat32(n, !0)
          break
        case Q.Int32:
          a[e] = this.view.getInt32(n, !0)
          break
        case Q.Uint16:
          a[e] = this.view.getUint16(n, !0)
          break
        case Q.Float64:
          a[e] = this.view.getFloat64(n, !0)
          break
        default:
          a[e] = this.bytes[n]
          break
      }
    }
    return ((this.cursor += i), a)
  }
  readOptionalTypedArray(e, t) {
    let n = this.base + this.cursor,
      r = this.bytes[this.cursor],
      i = this.readTypedArray()
    if (i !== void 0) {
      if (r !== e) throw new Z(`Field '${t}' has dtype tag ${r}, expected ${e}`, n)
      return i
    }
  }
  readRequiredTypedArray(e, t) {
    let n = this.base + this.cursor,
      r = this.readOptionalTypedArray(e, t)
    if (r === void 0) throw new Z(`Field '${t}' is required but was absent`, n)
    return r
  }
}
function wF(e) {
  let t = e.buffer instanceof ArrayBuffer ? new Uint8Array(e.buffer, e.byteOffset, e.byteLength) : e.slice()
  return new ReadableStream({
    start(e) {
      ;(e.enqueue(t), e.close())
    },
  })
}
async function TF(e, t, n, r) {
  if (t === `none`) return e
  if (n === void 0) throw new Z(`Gzip section '${r}' is missing uncompressedByteLength`)
  if (n > 1073741824) throw new Z(`Section '${r}' uncompressedByteLength ${n} exceeds max ${yF}`)
  if (typeof DecompressionStream > `u`)
    throw new Z(`Gzip section '${r}' cannot be decoded because DecompressionStream is unavailable`)
  try {
    let t = wF(e).pipeThrough(new DecompressionStream(`gzip`)).getReader(),
      i = new Uint8Array(n),
      a = 0
    try {
      for (;;) {
        let { done: e, value: o } = await t.read()
        if (e) break
        if (a + o.length > i.length) throw new Z(`Gzip section '${r}' exceeds declared uncompressedByteLength ${n}`)
        ;(i.set(o, a), (a += o.length))
      }
    } finally {
      t.releaseLock()
    }
    if (a !== i.length) throw new Z(`Gzip section '${r}' decoded to ${a} byte(s), expected ${n}`)
    return i
  } catch (e) {
    throw e instanceof Z
      ? e
      : new Z(`Gzip section '${r}' could not be decompressed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
function EF(e) {
  let t = ``
  for (let n of e) t += n.toString(16).padStart(2, `0`)
  return t
}
var DF = /^[0-9a-f]{64}$/
function OF() {
  let e = globalThis.crypto
  if (!e?.subtle)
    throw Error(`Web Crypto (globalThis.crypto.subtle) is unavailable in this runtime; cannot hash artifact contents.`)
  return e.subtle
}
async function kF(e) {
  let t = e.buffer instanceof ArrayBuffer ? new Uint8Array(e.buffer, e.byteOffset, e.byteLength) : e.slice(),
    n = await OF().digest(`SHA-256`, t)
  return new Uint8Array(n)
}
async function AF(e) {
  return EF(await kF(e))
}
function jF(e, t) {
  throw new Z(`Section '${e}' has unsupported schemaVersion ${t}`)
}
function MF(e, t, n) {
  if (e !== t) throw new Z(`Field '${n}' has length ${e}, expected ${t}`)
}
function NF(e, t, n) {
  let r = e * t
  if (!Number.isSafeInteger(r) || r > xF) throw new Z(`Field '${n}' = ${e} * ${t} exceeds max ${xF}`)
  return r
}
function PF(e, t) {
  for (let n = 1; n < e.length; n++)
    if (e[n] <= e[n - 1]) throw new Z(`Field '${t}' is not strictly increasing at index ${n} (${e[n - 1]} -> ${e[n]})`)
}
function FF(e, t) {
  for (let n = 1; n < e.length; n++)
    if (e[n] < e[n - 1]) throw new Z(`Field '${t}' is not nondecreasing at index ${n} (${e[n - 1]} -> ${e[n]})`)
}
function IF(e, t) {
  switch (t) {
    case 1:
      return LF(e)
    default:
      return jF(`core`, t)
  }
}
function LF(e) {
  let t = {
      mapName: e.readString(),
      tickRate: e.readNonNegativeI32(`core.meta.tickRate`),
      sampleRate: e.readNonNegativeI32(`core.meta.sampleRate`),
      numPlayers: e.readNonNegativeI32(`core.meta.numPlayers`),
      numFrames: e.readNonNegativeI32(`core.meta.numFrames`),
      startTick: e.readI32(),
      endTick: e.readI32(),
      durationSeconds: e.readF64(),
    },
    n = e.readArrayLength(`core.players`, 8),
    r = Array(n)
  for (let t = 0; t < n; t++) {
    let n = e.readI32(),
      i = e.readString(),
      a = e.readString(),
      o = e.readOptionalString(),
      s = e.readOptionalString()
    r[t] = {
      slot: n,
      steamId: i,
      name: a,
      ...(o === void 0 ? {} : { crosshairCode: o }),
      ...(s === void 0 ? {} : { clanName: s }),
    }
  }
  let i = e.readStringArray(`core.weaponNames`)
  if (r.length !== t.numPlayers)
    throw new Z(`core.players has ${r.length} entrie(s), but core.meta.numPlayers is ${t.numPlayers}`)
  let a = new Set()
  for (let e of r) {
    if (e.slot < 0 || e.slot >= t.numPlayers || !Number.isInteger(e.slot))
      throw new Z(`core.players[].slot ${e.slot} is out of range [0, ${t.numPlayers})`)
    if (a.has(e.slot)) throw new Z(`core.players has duplicate slot ${e.slot}`)
    a.add(e.slot)
  }
  return { meta: t, players: r, weaponNames: i }
}
function RF(e, t) {
  switch (t) {
    case 1:
      return VF(e)
    case 2:
      return BF(e)
    case 3:
      return zF(e)
    case 4: {
      let t = zF(e),
        n = e.readOptionalTypedArray(Q.Uint8, `frames.playerFlags`)
      if (n) {
        if (
          (MF(n.length, t.frames.frameTick.length * t.numPlayers, `frames.playerFlags`), n.some((e) => (e & -8) != 0))
        )
          throw new Z(`frames.playerFlags contains unknown bits`)
        t.frames.playerFlags = n
      }
      return t
    }
    default:
      return jF(`frames`, t)
  }
}
function zF(e) {
  let t = BF(e),
    n = e.readOptionalTypedArray(Q.Uint8, `frames.reloading`)
  if (n) {
    if ((MF(n.length, t.frames.frameTick.length * t.numPlayers, `frames.reloading`), n.some((e) => e > 1)))
      throw new Z(`frames.reloading must contain only 0 or 1`)
    t.frames.reloading = n
  }
  return t
}
function BF(e) {
  let t = VF(e),
    n = e.readOptionalTypedArray(Q.Float32, `frames.accuracyPenalty`)
  if (n) {
    MF(n.length, t.frames.frameTick.length * t.numPlayers, `frames.accuracyPenalty`)
    for (let e of n)
      if (!Number.isFinite(e) || (e < 0 && e !== -1))
        throw new Z(`frames.accuracyPenalty must contain nonnegative finite values or -1`)
    t.frames.accuracyPenalty = n
  }
  return t
}
function VF(e) {
  let t = e.readNonNegativeI32(`frames.numFrames`),
    n = e.readNonNegativeI32(`frames.numPlayers`),
    r = NF(t, n, `frames.numFrames * frames.numPlayers`),
    i = e.readRequiredTypedArray(Q.Float32, `frames.posX`),
    a = e.readRequiredTypedArray(Q.Float32, `frames.posY`),
    o = e.readRequiredTypedArray(Q.Float32, `frames.posZ`),
    s = e.readRequiredTypedArray(Q.Float32, `frames.yaw`),
    c = e.readRequiredTypedArray(Q.Float32, `frames.pitch`),
    l = e.readRequiredTypedArray(Q.Uint8, `frames.health`),
    u = e.readRequiredTypedArray(Q.Uint8, `frames.alive`),
    d = e.readRequiredTypedArray(Q.Uint8, `frames.team`),
    f = e.readRequiredTypedArray(Q.Uint8, `frames.score`),
    p = e.readRequiredTypedArray(Q.Float32, `frames.duck`),
    m = e.readRequiredTypedArray(Q.Float32, `frames.flash`),
    h = e.readRequiredTypedArray(Q.Float32, `frames.flashAlpha`),
    g = e.readRequiredTypedArray(Q.Uint8, `frames.zoom`),
    _ = e.readRequiredTypedArray(Q.Int32, `frames.frameTick`)
  for (let [e, t] of [
    [i, `posX`],
    [a, `posY`],
    [o, `posZ`],
    [s, `yaw`],
    [c, `pitch`],
    [l, `health`],
    [u, `alive`],
    [d, `team`],
    [f, `score`],
    [p, `duck`],
    [m, `flash`],
    [h, `flashAlpha`],
    [g, `zoom`],
  ])
    MF(e.length, r, `frames.${t}`)
  return (
    MF(_.length, t, `frames.frameTick`),
    PF(_, `frames.frameTick`),
    {
      numPlayers: n,
      frames: {
        posX: i,
        posY: a,
        posZ: o,
        yaw: s,
        pitch: c,
        health: l,
        alive: u,
        team: d,
        score: f,
        duck: p,
        flash: m,
        flashAlpha: h,
        zoom: g,
        frameTick: _,
      },
    }
  )
}
var HF = [`kill`, `round_start`, `round_end`, `bomb_planted`, `bomb_defused`, `bomb_exploded`],
  UF = {
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
  }
function WF(e, t) {
  switch (t) {
    case 1:
      return GF(e)
    default:
      return jF(`events`, t)
  }
}
function GF(e) {
  let t = e.readArrayLength(`events`, 13),
    n = Array(t),
    r = -1 / 0
  for (let i = 0; i < t; i++) {
    let t = e.readI32()
    if (t < r) throw new Z(`events[${i}].tick ${t} precedes events[${i - 1}].tick ${r}`)
    r = t
    let a = e.readF32(),
      o = e.readU8(),
      s = HF[o]
    if (s === void 0) throw new Z(`Unknown event type index ${o}`)
    let c = e.readU16(),
      l = e.readU16(),
      u = (e) => (c & (1 << e)) != 0,
      d = (e) => (l & (1 << e)) != 0,
      f = { tick: t, time: a, type: s }
    ;(u(UF.AttackerSlot) && (f.attackerSlot = e.readI32()),
      u(UF.VictimSlot) && (f.victimSlot = e.readI32()),
      u(UF.AssisterSlot) && (f.assisterSlot = e.readI32()),
      u(UF.AttackerName) && (f.attackerName = e.readString()),
      u(UF.VictimName) && (f.victimName = e.readString()),
      u(UF.AttackerTeam) && (f.attackerTeam = e.readI32()),
      u(UF.VictimTeam) && (f.victimTeam = e.readI32()),
      u(UF.Weapon) && (f.weapon = e.readString()),
      u(UF.Headshot) && (f.headshot = d(UF.Headshot)),
      u(UF.Noscope) && (f.noscope = d(UF.Noscope)),
      u(UF.Thrusmoke) && (f.thrusmoke = d(UF.Thrusmoke)),
      u(UF.Attackerblind) && (f.attackerblind = d(UF.Attackerblind)),
      u(UF.Wallbang) && (f.wallbang = d(UF.Wallbang)),
      u(UF.RoundWinner) && (f.roundWinner = e.readI32()),
      u(UF.RoundReason) && (f.roundReason = e.readI32()),
      (n[i] = f))
  }
  return n
}
function KF(e, t) {
  switch (t) {
    case 1:
      return qF(e)
    default:
      return jF(`rounds`, t)
  }
}
function qF(e) {
  let t = e.readArrayLength(`rounds`, 16),
    n = Array(t)
  for (let r = 0; r < t; r++) {
    let t = { index: e.readI32(), startTick: e.readI32(), endTick: e.readI32(), liveStartTick: e.readI32() }
    if (t.index !== r) throw new Z(`rounds[${r}].index is ${t.index}, expected ${r}`)
    if (t.endTick < t.startTick) throw new Z(`rounds[${r}].endTick ${t.endTick} precedes startTick ${t.startTick}`)
    if (r > 0 && t.startTick < n[r - 1].endTick)
      throw new Z(`rounds[${r}].startTick ${t.startTick} overlaps rounds[${r - 1}].endTick ${n[r - 1].endTick}`)
    n[r] = t
  }
  return n
}
var JF = [`smoke`, `he`, `flash`, `molotov`, `decoy`]
function YF(e) {
  let t = e.readU8(),
    n = JF[t]
  if (n === void 0) throw new Z(`Unknown grenade kind index ${t}`)
  return n
}
function XF(e, t) {
  switch (t) {
    case 1:
      return ZF(e, !1)
    case 2:
      return ZF(e, !0)
    default:
      return jF(`grenades`, t)
  }
}
function ZF(e, t) {
  let n = e.readArrayLength(`grenades.trajectories`, t ? 12 : 10),
    r = Array(n)
  for (let i = 0; i < n; i++) {
    let n = YF(e),
      a = e.readI32(),
      o = e.readRequiredTypedArray(Q.Float32, `grenades.trajectories[].posXYZ`),
      s = e.readRequiredTypedArray(Q.Int32, `grenades.trajectories[].ticks`),
      c = e.readI32(),
      l = e.readI32(),
      u = e.readBool() ? e.readI32() : void 0,
      d = t ? e.readOptionalTypedArray(Q.Float32, `grenades.trajectories[].angles`) : void 0,
      f = t ? e.readU8() : 0
    if (f > 2) throw new Z(`Invalid grenade incendiary flag ${f}`)
    ;(MF(o.length, s.length * 3, `grenades.trajectories[${i}].posXYZ`),
      d && MF(d.length, s.length * 3, `grenades.trajectories[${i}].angles`),
      (r[i] = {
        kind: n,
        throwerSlot: a,
        posXYZ: o,
        ticks: s,
        startTick: c,
        endTick: l,
        ...(u === void 0 ? {} : { detonationTick: u }),
        ...(d ? { angles: d } : {}),
        ...(f === 0 ? {} : { incendiary: f === 2 }),
      }))
  }
  let i = e.readArrayLength(`grenades.effects`, 17),
    a = Array(i)
  for (let t = 0; t < i; t++)
    a[t] = { kind: YF(e), x: e.readF32(), y: e.readF32(), z: e.readF32(), startTick: e.readI32(), endTick: e.readI32() }
  return { trajectories: r, effects: a }
}
function QF(e, t) {
  switch (t) {
    case 1:
      return $F(e)
    default:
      return jF(`infernos`, t)
  }
}
function $F(e) {
  let t = e.readArrayLength(`infernos`, 10),
    n = Array(t)
  for (let r = 0; r < t; r++) {
    let t = e.readI32(),
      i = e.readI32(),
      a = e.readI32(),
      o = e.readBool() ? e.readI32() : void 0,
      s = e.position,
      c = e.readBool() ? e.readU8() : void 0
    if (c !== void 0 && c !== 0 && c !== 1)
      throw new Z(`infernos[${r}].infernoType has invalid value ${c} (expected 0 or 1)`, s)
    let l = c,
      u = e.readBool() ? e.readF32() : void 0,
      d = e.readArrayLength(`infernos[].frames`, 5),
      f = Array(d)
    for (let t = 0; t < d; t++) {
      let n = e.readI32(),
        r = e.readRequiredTypedArray(Q.Float32, `infernos[].frames[].positions`),
        i = e.readRequiredTypedArray(Q.Uint8, `infernos[].frames[].burning`),
        a = e.readOptionalTypedArray(Q.Float32, `infernos[].frames[].origin`),
        o = e.readOptionalTypedArray(Q.Float32, `infernos[].frames[].parentPositions`),
        s = e.readOptionalTypedArray(Q.Float32, `infernos[].frames[].normals`)
      f[t] = {
        tick: n,
        positions: r,
        burning: i,
        ...(a === void 0 ? {} : { origin: a }),
        ...(o === void 0 ? {} : { parentPositions: o }),
        ...(s === void 0 ? {} : { normals: s }),
      }
    }
    n[r] = {
      entityId: t,
      startTick: i,
      endTick: a,
      ...(o === void 0 ? {} : { effectTick: o }),
      ...(l === void 0 ? {} : { infernoType: l }),
      ...(u === void 0 ? {} : { lifetime: u }),
      frames: f,
    }
  }
  return n
}
function eI(e, t) {
  switch (t) {
    case 1:
      return tI(e)
    default:
      return jF(`droppedWeapons`, t)
  }
}
function tI(e) {
  let t = e.readArrayLength(`droppedWeapons`, 20),
    n = Array(t)
  for (let r = 0; r < t; r++) {
    let t = e.readI32(),
      i = e.readString(),
      a = e.readI32(),
      o = e.readI32(),
      s = e.readI32(),
      c = e.readRequiredTypedArray(Q.Int32, `droppedWeapons[].ticks`),
      l = e.readRequiredTypedArray(Q.Float32, `droppedWeapons[].positions`),
      u = e.readRequiredTypedArray(Q.Float32, `droppedWeapons[].angles`)
    ;(MF(l.length, c.length * 3, `droppedWeapons[].positions`),
      MF(u.length, c.length * 3, `droppedWeapons[].angles`),
      (n[r] = { entityId: t, weapon: i, itemDef: a, startTick: o, endTick: s, ticks: c, positions: l, angles: u }))
  }
  return n
}
function nI(e, t) {
  switch (t) {
    case 1: {
      let t = e.readRequiredTypedArray(Q.Int32, `weaponFires.ticks`),
        n = e.readRequiredTypedArray(Q.Uint8, `weaponFires.slots`)
      MF(n.length, t.length, `weaponFires.slots`)
      for (let e = 1; e < t.length; e++) if (t[e] < t[e - 1]) throw new Z(`weaponFires.ticks must be ascending`)
      return { ticks: t, slots: n }
    }
    default:
      return jF(`weaponFires`, t)
  }
}
function rI(e, t) {
  switch (t) {
    case 1:
      return iI(e)
    default:
      return jF(`mapEntities`, t)
  }
}
function iI(e) {
  let t = e.readStringArray(`mapEntities.classNames`),
    n = e.readArrayLength(`mapEntities`, 21),
    r = Array(n)
  for (let i = 0; i < n; i++) {
    let n = e.readVarUint()
    if (n >= t.length) throw new Z(`mapEntities[${i}].className index ${n} out of range`)
    let a = [e.readF32(), e.readF32(), e.readF32()],
      o = e.readI32(),
      s = e.readI32(),
      c = e.readRequiredTypedArray(Q.Int32, `mapEntities[].ticks`),
      l = e.readRequiredTypedArray(Q.Float32, `mapEntities[].angles`),
      u = e.readRequiredTypedArray(Q.Uint8, `mapEntities[].hidden`)
    ;(MF(l.length, c.length * 3, `mapEntities[].angles`),
      MF(u.length, c.length, `mapEntities[].hidden`),
      (r[i] = { className: t[n], origin: a, startTick: o, endTick: s, ticks: c, angles: l, hidden: u }))
  }
  return r
}
var aI = 255
function oI(e, t) {
  switch (t) {
    case 1:
      return sI(e)
    default:
      return jF(`playerColors`, t)
  }
}
function sI(e) {
  let t = e.readArrayLength(`playerColors`, 1),
    n = Array(t)
  for (let r = 0; r < t; r++) {
    let t = e.readU8()
    if (t === aI) n[r] = void 0
    else if (t < Fg.length) n[r] = Fg[t]
    else throw new Z(`playerColors[${r}] (${t}) is not a known player colour`)
  }
  return n
}
var cI = 30
function lI(e, t) {
  switch (t) {
    case 1:
      return uI(e)
    default:
      return jF(`deathRagdolls`, t)
  }
}
function uI(e) {
  let t = e.readArrayLength(`deathRagdolls`, cI),
    n = Array(t)
  for (let r = 0; r < t; r++)
    n[r] = {
      tick: e.readI32(),
      slot: e.readU8(),
      force: [e.readF32(), e.readF32(), e.readF32()],
      bone: e.readI32(),
      headshot: e.readBool(),
      eyeAngles: [e.readF32(), e.readF32()],
    }
  return n
}
function dI(e, t) {
  switch (t) {
    case 1:
      return fI(e)
    default:
      return jF(`smokeVoxels`, t)
  }
}
function fI(e) {
  let t = e.readNonNegativeI32(`smokeVoxels.count`),
    n = e.readRequiredTypedArray(Q.Int32, `smokeVoxels.tickBegin`),
    r = e.readRequiredTypedArray(Q.Float32, `smokeVoxels.detonation`),
    i = e.readRequiredTypedArray(Q.Float32, `smokeVoxels.color`),
    a = e.readRequiredTypedArray(Q.Int32, `smokeVoxels.bufferOffsets`),
    o = e.readRequiredTypedArray(Q.Uint8, `smokeVoxels.buffers`),
    s = e.readOptionalTypedArray(Q.Int32, `smokeVoxels.frameOffsets`),
    c = e.readOptionalTypedArray(Q.Int32, `smokeVoxels.frameTicks`)
  if (
    (MF(n.length, t, `smokeVoxels.tickBegin`),
    MF(r.length, NF(t, 3, `smokeVoxels.count * 3`), `smokeVoxels.detonation`),
    MF(i.length, NF(t, 3, `smokeVoxels.count * 3`), `smokeVoxels.color`),
    MF(a.length, t + 1, `smokeVoxels.bufferOffsets`),
    FF(a, `smokeVoxels.bufferOffsets`),
    a.length > 0)
  ) {
    if (a[0] !== 0) throw new Z(`smokeVoxels.bufferOffsets[0] must be 0, got ${a[0]}`)
    let e = a[a.length - 1]
    if (e !== o.length)
      throw new Z(`smokeVoxels.bufferOffsets final value ${e} does not match smokeVoxels.buffers length ${o.length}`)
  }
  if ((s === void 0) != (c === void 0))
    throw new Z(`smokeVoxels.frameOffsets and smokeVoxels.frameTicks must both be present or both absent`)
  if (
    s !== void 0 &&
    c !== void 0 &&
    (MF(s.length, t + 1, `smokeVoxels.frameOffsets`), FF(s, `smokeVoxels.frameOffsets`), s.length > 0)
  ) {
    if (s[0] !== 0) throw new Z(`smokeVoxels.frameOffsets[0] must be 0, got ${s[0]}`)
    let e = s[s.length - 1]
    if (e !== c.length)
      throw new Z(`smokeVoxels.frameOffsets final value ${e} does not match smokeVoxels.frameTicks length ${c.length}`)
  }
  return {
    count: t,
    tickBegin: n,
    detonation: r,
    color: i,
    bufferOffsets: a,
    buffers: o,
    ...(s === void 0 ? {} : { frameOffsets: s }),
    ...(c === void 0 ? {} : { frameTicks: c }),
  }
}
function pI(e, t) {
  switch (t) {
    case 1:
      return mI(e)
    default:
      return jF(`tracers`, t)
  }
}
function mI(e) {
  let t = e.readNonNegativeI32(`tracers.count`),
    n = e.readRequiredTypedArray(Q.Float32, `tracers.origin`),
    r = e.readRequiredTypedArray(Q.Float32, `tracers.end`),
    i = e.readRequiredTypedArray(Q.Int32, `tracers.tick`),
    a = e.readRequiredTypedArray(Q.Uint8, `tracers.team`),
    o = e.readRequiredTypedArray(Q.Uint8, `tracers.hitKind`)
  return (
    MF(n.length, NF(t, 3, `tracers.count * 3`), `tracers.origin`),
    MF(r.length, NF(t, 3, `tracers.count * 3`), `tracers.end`),
    MF(i.length, t, `tracers.tick`),
    MF(a.length, t, `tracers.team`),
    MF(o.length, t, `tracers.hitKind`),
    FF(i, `tracers.tick`),
    { origin: n, end: r, tick: i, team: a, hitKind: o, count: t }
  )
}
function hI(e, t) {
  switch (t) {
    case 1:
      return gI(e)
    default:
      return jF(`panels`, t)
  }
}
function gI(e) {
  let t = e.readNonNegativeI32(`panels.numFrames`),
    n = e.readNonNegativeI32(`panels.numPlayers`),
    r = NF(t, n, `panels.numFrames * panels.numPlayers`),
    i = e.readRequiredTypedArray(Q.Int32, `panels.frameTick`),
    a = e.readRequiredTypedArray(Q.Uint8, `panels.health`),
    o = e.readRequiredTypedArray(Q.Uint8, `panels.alive`),
    s = e.readRequiredTypedArray(Q.Uint8, `panels.team`),
    c = e.readRequiredTypedArray(Q.Uint8, `panels.armor`),
    l = e.readRequiredTypedArray(Q.Uint8, `panels.flags`),
    u = e.readRequiredTypedArray(Q.Uint16, `panels.money`),
    d = e.readRequiredTypedArray(Q.Uint16, `panels.equipValue`),
    f = e.readRequiredTypedArray(Q.Uint16, `panels.clipAmmo`),
    p = e.readRequiredTypedArray(Q.Uint16, `panels.reserveAmmo`),
    m = e.readRequiredTypedArray(Q.Uint8, `panels.activeWeapon`),
    h = e.readRequiredTypedArray(Q.Uint8, `panels.utilCounts`)
  ;(MF(i.length, t, `panels.frameTick`), FF(i, `panels.frameTick`))
  for (let [e, t] of [
    [a, `health`],
    [o, `alive`],
    [s, `team`],
    [c, `armor`],
    [l, `flags`],
    [u, `money`],
    [d, `equipValue`],
    [f, `clipAmmo`],
    [p, `reserveAmmo`],
    [m, `activeWeapon`],
    [h, `utilCounts`],
  ])
    MF(e.length, r, `panels.${t}`)
  return {
    numPlayers: n,
    panelFrames: {
      numFrames: t,
      frameTick: i,
      health: a,
      alive: o,
      team: s,
      armor: c,
      flags: l,
      money: u,
      equipValue: d,
      clipAmmo: f,
      reserveAmmo: p,
      activeWeapon: m,
      utilCounts: h,
    },
  }
}
function _I(e, t) {
  switch (t) {
    case 1:
      return vI(e)
    default:
      return jF(`deathMarkers`, t)
  }
}
function vI(e) {
  let t = e.readArrayLength(`deathMarkers`, 20),
    n = Array(t)
  for (let r = 0; r < t; r++)
    n[r] = {
      x: e.readF32(),
      y: e.readF32(),
      z: e.readF32(),
      startTick: e.readI32(),
      endTick: e.readI32(),
      victimSlot: e.readI32(),
      team: e.readI32(),
      name: e.readString(),
    }
  return n
}
function yI(e, t) {
  switch (t) {
    case 1:
      return bI(e)
    default:
      return jF(`damage`, t)
  }
}
function bI(e) {
  let t = e.readNonNegativeI32(`damage.count`),
    n = e.readRequiredTypedArray(Q.Uint8, `damage.attackerSlot`),
    r = e.readRequiredTypedArray(Q.Uint8, `damage.victimSlot`),
    i = e.readRequiredTypedArray(Q.Int32, `damage.tick`),
    a = e.readRequiredTypedArray(Q.Uint8, `damage.dmg`)
  return (
    MF(n.length, t, `damage.attackerSlot`),
    MF(r.length, t, `damage.victimSlot`),
    MF(i.length, t, `damage.tick`),
    MF(a.length, t, `damage.dmg`),
    FF(i, `damage.tick`),
    { attackerSlot: n, victimSlot: r, tick: i, dmg: a, count: t }
  )
}
var xI = [`carried`, `dropped`, `planted`]
function SI(e, t) {
  switch (t) {
    case 1:
      return CI(e)
    default:
      return jF(`bomb`, t)
  }
}
function CI(e) {
  let t = e.readArrayLength(`bomb.segments`, 15),
    n = Array(t)
  for (let r = 0; r < t; r++) {
    let t = e.readU8(),
      i = xI[t]
    if (i === void 0) throw new Z(`Unknown bomb state kind index ${t}`)
    let a = {
      kind: i,
      startTick: e.readI32(),
      endTick: e.readI32(),
      x: e.readF32(),
      y: e.readF32(),
      z: e.readF32(),
      carrierSlot: e.readI32(),
      site: e.readString(),
    }
    if (a.endTick < a.startTick)
      throw new Z(`bomb.segments[${r}].endTick ${a.endTick} precedes startTick ${a.startTick}`)
    if (r > 0 && a.startTick < n[r - 1].startTick)
      throw new Z(
        `bomb.segments[${r}].startTick ${a.startTick} precedes bomb.segments[${r - 1}].startTick ${n[r - 1].startTick}`,
      )
    n[r] = a
  }
  let r = e.readArrayLength(`bomb.defuses`, 10),
    i = Array(r)
  for (let t = 0; t < r; t++) {
    let n = { startTick: e.readI32(), endTick: e.readI32(), hasKit: e.readBool(), defuserSlot: e.readI32() }
    if (n.endTick < n.startTick)
      throw new Z(`bomb.defuses[${t}].endTick ${n.endTick} precedes startTick ${n.startTick}`)
    i[t] = n
  }
  return { segments: n, defuses: i }
}
function wI(e) {
  let t = e.readU8()
  if (t === 1) return `t`
  if (t === 2) return `ct`
  if (t !== 0) throw new Z(`Unknown timeout side tag ${t}`)
}
function TI(e, t) {
  switch (t) {
    case 1:
      return EI(e)
    default:
      return jF(`timeouts`, t)
  }
}
function EI(e) {
  let t = e.readNonNegativeI32(`timeouts.maxTacticalTimeouts`),
    n = e.readArrayLength(`timeouts.intervals`, 6),
    r = Array(n)
  for (let t = 0; t < n; t++) {
    let n = e.readI32(),
      i = e.readI32(),
      a = wI(e),
      o = e.readBool()
    if (i < n) throw new Z(`timeouts.intervals[${t}].endTick ${i} precedes startTick ${n}`)
    r[t] = { startTick: n, endTick: i, technical: o, ...(a === void 0 ? {} : { side: a }) }
  }
  let i = e.readArrayLength(`timeouts.counters`, 8),
    a = Array(i)
  for (let t = 0; t < i; t++)
    a[t] = {
      tick: e.readI32(),
      tRemaining: e.readNonNegativeI32(`timeouts.counters[].tRemaining`),
      ctRemaining: e.readNonNegativeI32(`timeouts.counters[].ctRemaining`),
    }
  return { maxTacticalTimeouts: t, intervals: r, counters: a }
}
function DI(e, t) {
  switch (t) {
    case 1:
      return OI(e)
    case 2:
      return OI(e, !0)
    default:
      return jF(`derivationInputs`, t)
  }
}
function OI(e, t = !1) {
  let n = e.position,
    r = e.readVarUint()
  if (r !== 1) throw new Z(`derivationInputs.derivationVersion ${r} is not supported by this decoder (supported: 1)`, n)
  let i = e.readArrayLength(`derivationInputs.roundTiming`, 10),
    a = Array(i)
  for (let t = 0; t < i; t++) {
    let n = e.readI32(),
      r = e.readBool() ? e.readF64() : void 0,
      i = e.readBool() ? e.readF64() : void 0,
      o = e.readBool(),
      s = e.readBool(),
      c = e.readBool(),
      l = e.readBool() ? e.readF64() : void 0,
      u = e.readBool() ? e.readF64() : void 0
    a[t] = {
      tick: n,
      tActive: o,
      ctActive: s,
      technicalActive: c,
      ...(r === void 0 ? {} : { gameTime: r }),
      ...(i === void 0 ? {} : { roundStartTime: i }),
      ...(l === void 0 ? {} : { tRemaining: l }),
      ...(u === void 0 ? {} : { ctRemaining: u }),
    }
  }
  let o = e.readArrayLength(`derivationInputs.fireBullets`, 30),
    s = Array(o)
  for (let t = 0; t < o; t++)
    s[t] = {
      tick: e.readI32(),
      attackerSteamId: e.readString(),
      originX: e.readF64(),
      originY: e.readF64(),
      originZ: e.readF64(),
      pitchDeg: e.readF64(),
      yawDeg: e.readF64(),
    }
  let c = e.readArrayLength(`derivationInputs.playerHurts`, 25),
    l = Array(c)
  for (let t = 0; t < c; t++)
    l[t] = {
      tick: e.readI32(),
      attackerSteamId: e.readString(),
      victimSteamId: e.readString(),
      x: e.readF64(),
      y: e.readF64(),
      z: e.readF64(),
      hitgroup: e.readString(),
      dmgHealth: e.readF32(),
    }
  let u = e.readArrayLength(`derivationInputs.bombEvents`, 20),
    d = Array(u)
  for (let n = 0; n < u; n++)
    if (
      ((d[n] = {
        tick: e.readI32(),
        eventName: e.readString(),
        actorSteamId: e.readString(),
        x: e.readF64(),
        y: e.readF64(),
        z: e.readF64(),
        hasKit: e.readBool(),
      }),
      t && e.readBool())
    ) {
      let t = e.readString()
      if (t !== `A` && t !== `B`) throw new Z(`Invalid recorded bomb site "${t}"`, e.position)
      d[n].site = t
    }
  return { derivationVersion: r, roundTiming: a, fireBullets: s, playerHurts: l, bombEvents: d }
}
var kI = new TextEncoder().encode(lF),
  AI = 32,
  jI = kI.length + 4 + AI
async function MI(e) {
  let t = e.map((e) => `${e.id}:${e.schemaVersion}:${e.codec}:${e.byteLength}:${e.sha256}`)
  return AF(
    new TextEncoder().encode(
      t.join(`
`),
    ),
  )
}
function NI(e) {
  return typeof e == `number` && Number.isFinite(e)
}
function PI(e, t) {
  if (typeof e != `string`) throw new Z(`Manifest field '${t}' must be a string`)
  return e
}
function FI(e, t) {
  if (e !== void 0) return PI(e, t)
}
function II(e, t) {
  if (!NI(e)) throw new Z(`Manifest field '${t}' must be a finite number`)
  return e
}
function LI(e, t) {
  let n = II(e, t)
  if (n < 0) throw new Z(`Manifest field '${t}' must be nonnegative, got ${n}`)
  return n
}
function RI(e, t) {
  let n = II(e, t)
  if (!Number.isSafeInteger(n)) throw new Z(`Manifest field '${t}' must be an integer, got ${n}`)
  return n
}
function zI(e, t) {
  let n = RI(e, t)
  if (n <= 0) throw new Z(`Manifest field '${t}' must be a positive integer, got ${n}`)
  return n
}
function BI(e, t) {
  let n = RI(e, t)
  if (n < 0) throw new Z(`Manifest field '${t}' must be a nonnegative integer, got ${n}`)
  return n
}
function VI(e, t, n, r) {
  let i = RI(e, t)
  if (i < n || i > r) throw new Z(`Manifest field '${t}' must be an integer in [${n}, ${r}], got ${i}`)
  return i
}
function HI(e, t, n) {
  let r = II(e, t)
  if (r !== n) throw new Z(`Manifest field '${t}' must be exactly ${n}, got ${r}`)
  return r
}
var UI = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
function WI(e, t) {
  let n = PI(e, t)
  if (!UI.test(n)) throw new Z(`Manifest field '${t}' must be an ISO-8601 timestamp (e.g. 2024-01-01T00:00:00.000Z)`)
  return n
}
function GI(e) {
  if (typeof e != `object` || !e) throw new Z(`Manifest is not a JSON object`)
  let t = e,
    n = t.container
  if (typeof n != `object` || !n) throw new Z(`Manifest field 'container' is missing`)
  ;(PI(n.format, `container.format`), zI(n.version, `container.version`))
  let r = t.producer
  if (typeof r != `object` || !r) throw new Z(`Manifest field 'producer' is missing`)
  ;(PI(r.packageName, `producer.packageName`),
    PI(r.packageVersion, `producer.packageVersion`),
    FI(r.buildRevision, `producer.buildRevision`),
    FI(r.upstreamParserRevision, `producer.upstreamParserRevision`))
  let i = t.source
  if (typeof i != `object` || !i) throw new Z(`Manifest field 'source' is missing`)
  let a = PI(i.sha256, `source.sha256`)
  if (!DF.test(a)) throw new Z(`Manifest field 'source.sha256' is not a lowercase hex SHA-256 digest`)
  BI(i.byteLength, `source.byteLength`)
  let o = t.parseOptions
  if (typeof o != `object` || !o) throw new Z(`Manifest field 'parseOptions' is missing`)
  ;(VI(o.sampleRate, `parseOptions.sampleRate`, 1, dF), HI(o.tickRateAssumed, `parseOptions.tickRateAssumed`, dF))
  let s = PI(o.tickRateProvenance, `parseOptions.tickRateProvenance`)
  if (s !== `assumed-cs2-64tick`)
    throw new Z(`Manifest field 'parseOptions.tickRateProvenance' has unknown value '${s}'`)
  let c = t.timing
  if (typeof c != `object` || !c) throw new Z(`Manifest field 'timing' is missing`)
  ;(WI(c.createdAt, `timing.createdAt`),
    LI(c.encodeDurationMs, `timing.encodeDurationMs`),
    c.parseDurationMs !== void 0 && LI(c.parseDurationMs, `timing.parseDurationMs`))
  let l = t.identity
  if (typeof l != `object` || !l) throw new Z(`Manifest field 'identity' is missing`)
  PI(l.mapName, `identity.mapName`)
  let u = BI(l.numPlayers, `identity.numPlayers`)
  if (!Array.isArray(l.players)) throw new Z(`Manifest field 'identity.players' must be an array`)
  if (l.players.length !== u)
    throw new Z(`Manifest field 'identity.players' has ${l.players.length} entrie(s), but identity.numPlayers is ${u}`)
  let d = new Set()
  for (let [e, t] of l.players.entries()) {
    if (typeof t != `object` || !t) throw new Z(`Manifest field 'identity.players[${e}]' must be an object`)
    let n = t,
      r = VI(n.slot, `identity.players[${e}].slot`, 0, Math.max(0, u - 1))
    if (d.has(r)) throw new Z(`Manifest field 'identity.players' has duplicate slot ${r}`)
    ;(d.add(r), PI(n.steamId, `identity.players[${e}].steamId`), PI(n.name, `identity.players[${e}].name`))
  }
  if ((BI(l.bombSiteClassifierVersion, `identity.bombSiteClassifierVersion`), !Array.isArray(t.sections)))
    throw new Z(`Manifest field 'sections' must be an array`)
  let f = new Set()
  for (let [e, n] of t.sections.entries()) {
    if (typeof n != `object` || !n) throw new Z(`Manifest field 'sections[${e}]' must be an object`)
    let t = n,
      r = PI(t.id, `sections[${e}].id`)
    if (f.has(r)) throw new Z(`Manifest has duplicate section id '${r}'`)
    ;(f.add(r), zI(t.schemaVersion, `sections[${e}].schemaVersion`))
    let i = PI(t.kind, `sections[${e}].kind`)
    if (i !== `canonical` && i !== `derived`)
      throw new Z(`Manifest field 'sections[${e}].kind' has unknown value '${i}'`)
    let a = pF.find((e) => e.id === r)
    if (a && a.kind !== i)
      throw new Z(`Section '${r}' has kind '${i}', but this decoder knows '${r}' as kind '${a.kind}'`)
    let o = PI(t.codec, `sections[${e}].codec`)
    if (!fF.includes(o)) throw new Z(`Section '${r}' has unsupported codec '${o}'`)
    if ((BI(t.byteOffset, `sections[${e}].byteOffset`), BI(t.byteLength, `sections[${e}].byteLength`), o === `gzip`)) {
      if (BI(t.uncompressedByteLength, `sections[${e}].uncompressedByteLength`) > 1073741824)
        throw new Z(`Manifest field 'sections[${e}].uncompressedByteLength' exceeds max ${yF}`)
    } else if (t.uncompressedByteLength !== void 0)
      throw new Z(`Manifest field 'sections[${e}].uncompressedByteLength' is only valid for compressed sections`)
    let s = PI(t.sha256, `sections[${e}].sha256`)
    if (!DF.test(s)) throw new Z(`Manifest field 'sections[${e}].sha256' is not a lowercase hex SHA-256 digest`)
  }
  let p = PI(t.artifactSha256, `artifactSha256`)
  if (!DF.test(p)) throw new Z(`Manifest field 'artifactSha256' is not a lowercase hex SHA-256 digest`)
  return e
}
async function KI(e) {
  if (e.length < jI) throw new Z(`Artifact is too short to contain a header (${e.length} bytes)`, 0)
  for (let t = 0; t < kI.length; t++) if (e[t] !== kI[t]) throw new Z(`Bad magic bytes: expected '${lF}'`, t)
  let t = new DataView(e.buffer, e.byteOffset, e.byteLength).getUint32(kI.length, !0)
  if (t > 8388608) throw new Z(`Manifest length ${t} exceeds max ${gF}`, kI.length)
  let n = kI.length + 4,
    r = e.subarray(n, n + AI),
    i = jI
  if (t > e.length - i) throw new Z(`Manifest length ${t} exceeds remaining bytes ${e.length - i}`, i)
  let a = e.subarray(i, i + t),
    o = await kF(a)
  if (r.length !== AI || !o.every((e, t) => e === r[t]))
    throw new Z(`Manifest failed integrity check (sha256 mismatch) — the manifest bytes are corrupt`, i)
  let s
  try {
    s = JSON.parse(new TextDecoder(`utf-8`, { fatal: !0 }).decode(a))
  } catch (e) {
    throw new Z(`Manifest is not valid JSON: ${e.message}`, i)
  }
  let c = GI(s)
  if (c.container.format !== `csdemo-artifact`)
    throw new Z(`Unknown container format '${c.container.format}', expected '${uF}'`)
  if (!hF.has(c.container.version))
    throw new Z(
      `Artifact container version ${c.container.version} is not supported by this decoder (supported: ${[...hF].join(`, `)}). Upgrade @csdemo/parser or check for a corrupt file.`,
    )
  return c
}
async function qI(e, t = {}) {
  let n = t.verifyChecksums ?? !0,
    r = await KI(e),
    i = jI + new DataView(e.buffer, e.byteOffset, e.byteLength).getUint32(kI.length, !0),
    a = e.length - i,
    o = 0,
    s = new Map()
  for (let t of r.sections) {
    if (t.byteOffset !== o)
      throw new Z(`Section '${t.id}' byteOffset ${t.byteOffset} is not contiguous (expected ${o})`)
    if (t.byteLength < 0 || t.byteOffset + t.byteLength > a)
      throw new Z(
        `Section '${t.id}' [${t.byteOffset}, ${t.byteOffset + t.byteLength}) exceeds payload area of ${a} byte(s)`,
      )
    let r = e.subarray(i + t.byteOffset, i + t.byteOffset + t.byteLength)
    if (n && (await AF(r)) !== t.sha256) throw new Z(`Section '${t.id}' failed checksum verification (sha256 mismatch)`)
    ;(pF.some((e) => e.id === t.id) && s.set(t.id, await TF(r, t.codec, t.uncompressedByteLength, t.id)),
      (o += t.byteLength))
  }
  if (o !== a) throw new Z(`Section payloads (${o} byte(s)) do not fill the declared payload area (${a} byte(s))`)
  if (n && (await MI(r.sections)) !== r.artifactSha256)
    throw new Z(`Artifact failed aggregate section-digest verification (sha256 mismatch)`)
  for (let e of mF) if (!s.has(e)) throw new Z(`Artifact is missing required section '${e}'`)
  let c = (e) => r.sections.find((t) => t.id === e)
  function l(e, t) {
    let n = c(e),
      r = s.get(e)
    if (!n || !r) throw new Z(`Artifact is missing required section '${e}'`)
    let a = new CF(r, i + n.byteOffset),
      o = t(a, n.schemaVersion)
    if (!a.isAtEnd) throw new Z(`Section '${e}' has ${a.remaining} unconsumed trailing byte(s) after decoding`)
    return o
  }
  function u(e, t) {
    let n = c(e),
      r = s.get(e)
    if (!n || !r) return
    let a = new CF(r, i + n.byteOffset),
      o = t(a, n.schemaVersion)
    if (!a.isAtEnd) throw new Z(`Section '${e}' has ${a.remaining} unconsumed trailing byte(s) after decoding`)
    return o
  }
  let d = l(`core`, IF),
    f = l(`frames`, RF),
    p = l(`events`, WF),
    m = l(`rounds`, KF),
    h = l(`grenades`, XF),
    g = l(`infernos`, QF),
    _ = l(`smokeVoxels`, dI),
    v = l(`tracers`, pI),
    y = l(`panels`, hI),
    b = l(`deathMarkers`, _I),
    x = l(`damage`, yI),
    S = l(`bomb`, SI),
    C = l(`timeouts`, TI),
    w = u(`droppedWeapons`, eI),
    T = u(`weaponFires`, nI),
    E = u(`mapEntities`, rI),
    D = u(`deathRagdolls`, lI),
    O = u(`playerColors`, oI),
    k = u(`derivationInputs`, DI)
  if (d.meta.numPlayers !== y.numPlayers)
    throw new Z(`core.meta.numPlayers (${d.meta.numPlayers}) does not match panels.numPlayers (${y.numPlayers})`)
  if (d.meta.numPlayers !== f.numPlayers)
    throw new Z(`core.meta.numPlayers (${d.meta.numPlayers}) does not match frames.numPlayers (${f.numPlayers})`)
  if (d.meta.numPlayers !== r.identity.numPlayers)
    throw new Z(
      `core.meta.numPlayers (${d.meta.numPlayers}) does not match manifest.identity.numPlayers (${r.identity.numPlayers})`,
    )
  if (r.identity.players.length !== d.players.length)
    throw new Z(
      `manifest.identity.players has ${r.identity.players.length} entrie(s), but core.players has ${d.players.length}`,
    )
  let A = new Map(d.players.map((e) => [e.slot, e]))
  for (let [e, t] of r.identity.players.entries()) {
    let n = A.get(t.slot)
    if (!n || n.steamId !== t.steamId || n.name !== t.name)
      throw new Z(
        `manifest.identity.players[${e}] (slot=${t.slot}, steamId=${t.steamId}, name=${t.name}) does not match the corresponding core.players entry`,
      )
  }
  if (f.frames.frameTick.length !== d.meta.numFrames)
    throw new Z(
      `frames section has ${f.frames.frameTick.length} frame(s), but core.meta.numFrames is ${d.meta.numFrames}`,
    )
  if (d.meta.tickRate !== dF)
    throw new Z(
      `core.meta.tickRate is ${d.meta.tickRate}, but this decoder only trusts the fixed ${dF}-tick CS2 assumption (see docs/artifact.md#tick-rate); refusing to decode a tick rate this package cannot back up with real provenance.`,
    )
  if (r.parseOptions.tickRateAssumed !== d.meta.tickRate)
    throw new Z(
      `manifest.parseOptions.tickRateAssumed (${r.parseOptions.tickRateAssumed}) does not match core.meta.tickRate (${d.meta.tickRate})`,
    )
  if (r.parseOptions.sampleRate !== d.meta.sampleRate)
    throw new Z(
      `manifest.parseOptions.sampleRate (${r.parseOptions.sampleRate}) does not match core.meta.sampleRate (${d.meta.sampleRate})`,
    )
  if (d.meta.endTick < d.meta.startTick)
    throw new Z(`core.meta.endTick (${d.meta.endTick}) precedes core.meta.startTick (${d.meta.startTick})`)
  if (!Number.isFinite(d.meta.durationSeconds) || d.meta.durationSeconds < 0)
    throw new Z(`core.meta.durationSeconds (${d.meta.durationSeconds}) must be a nonnegative finite number`)
  let ee = (d.meta.endTick - d.meta.startTick) / d.meta.tickRate
  if (Math.abs(d.meta.durationSeconds - ee) > 1e-6)
    throw new Z(
      `core.meta.durationSeconds (${d.meta.durationSeconds}) is inconsistent with (endTick - startTick) / tickRate (${ee})`,
    )
  for (let [e, t] of (D ?? []).entries())
    if (t.slot >= d.meta.numPlayers) throw new Z(`deathRagdolls[${e}].slot (${t.slot}) is not a player slot`)
  if (O !== void 0) {
    if (O.length !== d.players.length)
      throw new Z(`playerColors has ${O.length} entrie(s), but core.players has ${d.players.length}`)
    for (let [e, t] of O.entries()) t !== void 0 && (d.players[e].color = t)
  }
  let te = { ...h, infernos: g }
  return {
    manifest: r,
    data: {
      meta: d.meta,
      players: d.players,
      frames: f.frames,
      events: p,
      rounds: m,
      grenades: te,
      tracers: v,
      smokeVoxels: _,
      panelFrames: y.panelFrames,
      weaponNames: d.weaponNames,
      deathMarkers: b,
      damage: x,
      bomb: S,
      timeouts: C,
      ...(w === void 0 ? {} : { droppedWeapons: w }),
      ...(T === void 0 ? {} : { weaponFires: T }),
      ...(E === void 0 ? {} : { mapEntities: E }),
      ...(D === void 0 ? {} : { deathRagdolls: D }),
    },
    ...(k === void 0 ? {} : { derivationInputs: k }),
  }
}
async function JI(e) {
  let t = e.buffer instanceof ArrayBuffer ? new Uint8Array(e.buffer, e.byteOffset, e.byteLength) : e.slice(),
    n = await crypto.subtle.digest(`SHA-256`, t)
  return Array.from(new Uint8Array(n), (e) => e.toString(16).padStart(2, `0`)).join(``)
}
