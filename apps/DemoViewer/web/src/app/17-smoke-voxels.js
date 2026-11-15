// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 39544–39727 行（切片 24/40）
// 角色：烟雾体素解码 tO：dissipationFrame/seedPointsAtTick/occupancy
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var tO = class e {
  tickBegin
  endTick
  frameCount
  color
  detonation
  seedPoints
  frameEndOffsets
  hasRecordedTiming
  frameTicks
  frameUpdates
  phase
  seedUpdates
  cur = new Map()
  curFrame = -1
  constructor(e, t, n, r, i, a, o, s) {
    ;((this.tickBegin = e),
      (this.color = t),
      (this.detonation = n),
      (this.frameUpdates = r),
      (this.phase = i),
      (this.seedUpdates = a),
      (this.seedPoints = a[0] ?? []),
      (this.frameEndOffsets = o),
      (this.frameCount = r.length),
      (this.hasRecordedTiming = s !== void 0),
      (this.frameTicks = s?.slice() ?? Int32Array.from({ length: this.frameCount }, (t, n) => e + n * 7)),
      (this.endTick = this.frameTicks[this.frameCount - 1]))
  }
  get dissipationFrame() {
    for (let e = 0; e < this.phase.length; e++) if (this.phase[e] === 1) return e
    return this.phase.length
  }
  static decode(t, n, r, i, a) {
    let o = [],
      s = 0
    for (; s + 4 <= t.length;) {
      let e = t[s] | (t[s + 1] << 8),
        n = t[s + 2] | (t[s + 3] << 8),
        r = s + 4,
        i = r + n
      if (i > t.length || e !== o.length) return null
      ;(o.push({ payload: t.subarray(r, i), end: i }), (s = i))
    }
    if (o.length === 0 || s !== t.length) return null
    if (a) {
      if (a.length !== o.length) return null
      for (let e = 0; e < a.length; e++) if (e > 0 && a[e] < a[e - 1]) return null
    }
    let c = [],
      l = new Uint8Array(o.length),
      u = [],
      d = new Int32Array(o.length)
    for (let e = 0; e < o.length; e++) {
      let t = o[e].payload
      if (t.length < 3 || t[0] > 1 || t[1] & -4) return null
      let n = t[1],
        r = 2,
        i = null
      if (n & 1) {
        let e = t[r++]
        if (r + e * 8 >= t.length) return null
        let n = new DataView(t.buffer, t.byteOffset, t.byteLength)
        i = []
        for (let a = 0; a < e; a++, r += 8) {
          if (t[r] >= 32 || t[r + 1] >= 32 || t[r + 2] >= 32 || !Number.isFinite(n.getFloat32(r + 4, !0))) return null
          i.push({ x: t[r], y: t[r + 1], z: t[r + 2], flag: t[r + 3], extra: n.getUint32(r + 4, !0) })
        }
      }
      let a = []
      if (n & 2) {
        if (r + 2 > t.length) return null
        let e = t[r] | (t[r + 1] << 8)
        if (!eO(t, r + 2, e, a)) return null
      } else if (r + 1 !== t.length || t[r] !== 0) return null
      ;((l[e] = t[0]), u.push(i), (d[e] = o[e].end), c.push(a))
    }
    return !u[0] && c[0].length === 0
      ? null
      : new e(n, [i[0] / 255, i[1] / 255, i[2] / 255], [r[0], r[1], r[2]], c, l, u, d, a)
  }
  frameForTick(e) {
    let t = 0,
      n = this.frameCount
    for (; t < n;) {
      let r = (t + n) >>> 1
      this.frameTicks[r] <= e ? (t = r + 1) : (n = r)
    }
    return Math.max(0, t - 1)
  }
  tickForFrame(e) {
    if (!Number.isInteger(e) || e < 0 || e >= this.frameCount) throw RangeError(`Invalid smoke frame`)
    return this.frameTicks[e]
  }
  blendForTick(e) {
    let t = Math.fround((e - this.tickForFrame(this.frameForTick(e))) / 64)
    return Math.min(1, Math.max(0, Math.fround(t * 10)))
  }
  seedPointsAtTick(e) {
    return this.seedPointsAtFrame(this.frameForTick(e))
  }
  seedPointsAtFrame(e) {
    if (!Number.isInteger(e) || e < 0 || e >= this.frameCount) throw RangeError(`Invalid smoke frame`)
    for (let t = e; t >= 0; t--) {
      let e = this.seedUpdates[t]
      if (e !== null) return e
    }
    return []
  }
  seekTo(e) {
    e < this.curFrame && (this.cur.clear(), (this.curFrame = -1))
    for (let t = this.curFrame + 1; t <= e; t++)
      for (let e of this.frameUpdates[t])
        e.lo === 0 && e.hi === 0 ? this.cur.delete(e.base) : this.cur.set(e.base, { lo: e.lo, hi: e.hi })
    this.curFrame = e
  }
  occupancyAtTick(e, t) {
    return this.occupancyAtFrame(this.frameForTick(e), t)
  }
  occupancyAtFrame(e, t) {
    if (!Number.isInteger(e) || e < 0 || e >= this.frameCount) throw RangeError(`Invalid smoke frame`)
    ;(t.fill(0), this.seekTo(e))
    let n = 0
    for (let [e, r] of this.cur) {
      let [i, a, o] = QD(e, 4),
        s = i * 4,
        c = a * 4,
        l = o * 4
      for (let e = 0; e < 64; e++) {
        if (!(e < 32 ? (r.lo >>> e) & 1 : (r.hi >>> (e - 32)) & 1)) continue
        let i = s + $D[e * 3],
          a = c + $D[e * 3 + 1],
          o = l + $D[e * 3 + 2]
        ;((t[i + 32 * (a + 32 * o)] = 1), n++)
      }
    }
    return n
  }
}
function nO(e, t) {
  let n = e.buffers.subarray(e.bufferOffsets[t], e.bufferOffsets[t + 1]),
    r = e.frameOffsets?.[t],
    i = e.frameOffsets?.[t + 1],
    a = r !== void 0 && i !== void 0 && i > r ? e.frameTicks?.subarray(r, i) : void 0
  return tO.decode(
    n,
    e.tickBegin[t],
    [e.detonation[t * 3], e.detonation[t * 3 + 1], e.detonation[t * 3 + 2]],
    [e.color[t * 3], e.color[t * 3 + 1], e.color[t * 3 + 2]],
    a,
  )
}
var rO = 32 ** 3,
  Y = Math.fround,
  iO = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
  ],
  aO = new Uint16Array(rO),
  oO = new Uint8Array(rO * 3),
  sO = new Int32Array(rO * 6)
function cO(e, t, n) {
  let r = 0
  for (let i = 0; i < 5; i++)
    ((r |= ((e >> i) & 1) << (i * 3)), (r |= ((t >> i) & 1) << (i * 3 + 1)), (r |= ((n >> i) & 1) << (i * 3 + 2)))
  return r
}
for (let e = 0; e < 32; e++)
  for (let t = 0; t < 32; t++)
    for (let n = 0; n < 32; n++) {
      let r = cO(n, t, e)
      ;((aO[r] = n + 32 * (t + 32 * e)),
        oO.set([n, t, e], r * 3),
        iO.forEach(([i, a, o], s) => {
          let c = n + i,
            l = t + a,
            u = e + o
          sO[r * 6 + s] = Math.min(c, l, u) < 0 || Math.max(c, l, u) >= 32 ? -1 : cO(c, l, u)
        }))
    }
