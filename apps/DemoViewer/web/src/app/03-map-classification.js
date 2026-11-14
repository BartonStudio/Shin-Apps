// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 29747–29970 行（切片 4/34）
// 角色：地图分类/破坏删除（Av：classifyDeletions/breaks/matched）+ 视锥剔除（Fv：setView/cull/sphereVisible）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var Av = class {
  records
  objects
  broken = new Set()
  leaders
  constructor(e, t) {
    ;((this.objects = e), (this.records = e.map(() => [])))
    let n = new Map(e.map((e, t) => [e.id, t]))
    this.leaders = e.map((e) => (e.follows === void 0 ? -1 : (n.get(e.follows) ?? -1)))
    let r = Cv * Cv
    for (let n of t ?? []) {
      if (n.ticks.length === 0) continue
      let t = n.hidden[0] !== 0,
        i = -1,
        a = 1 / 0
      ;(e.forEach((e, o) => {
        let s = Ov(e.origin, n.origin)
        if (s > r) return
        let c = s + (e.hidden === t ? 0 : r * 2) + (jv(e, n) ? 0 : r * 4)
        c < a && ((a = c), (i = o))
      }),
        i >= 0 && this.records[i].push(n))
    }
    for (let e of this.records) e.sort((e, t) => e.startTick - t.startTick)
    this.classifyDeletions(t ?? [])
  }
  classifyDeletions(e) {
    let t = -1 / 0
    for (let n of e) t = Math.max(t, n.endTick)
    for (let n of this.records)
      for (let r of n) {
        let n = r.endTick
        if (n >= t) continue
        let i = 0,
          a = 0
        for (let t of e) t.startTick >= n || t.endTick <= n - Tv || (i++, Math.abs(t.endTick - n) <= Tv && a++)
        ;(a < Dv || a < i * Ev) && this.broken.add(r)
      }
  }
  breaks(e) {
    if (this.leaders[e] >= 0) return []
    let t = this.records[e],
      n = []
    return (
      t.forEach((e, r) => {
        this.broken.has(e) && n.push({ tick: e.endTick, respawnTick: t[r + 1]?.startTick ?? 1 / 0 })
      }),
      n
    )
  }
  get matched() {
    return this.records.some((e) => e.length > 0)
  }
  poseAt(e, t, n) {
    let r = this.objects[e],
      i = this.leaders[e]
    if (i >= 0)
      return (
        (n.visible = this.poseAt(i, t, n).visible && !r.hidden),
        (n.pitch = r.angles[0]),
        (n.yaw = r.angles[1]),
        (n.roll = r.angles[2]),
        n
      )
    ;((n.visible = !r.hidden), (n.pitch = r.angles[0]), (n.yaw = r.angles[1]), (n.roll = r.angles[2]))
    let a = this.records[e],
      o = null
    for (let e of a) {
      if (e.startTick > t) break
      o = e
    }
    if (!o) return n
    if (t >= o.endTick) {
      if (this.broken.has(o)) return ((n.visible = !1), n)
      t = o.endTick - 1
    }
    let { ticks: s, angles: c, hidden: l } = o,
      u = 0,
      d = s.length - 1
    for (; u < d;) {
      let e = (u + d + 1) >> 1
      s[e] <= t ? (u = e) : (d = e - 1)
    }
    let f = u
    ;((n.visible = l[f] === 0), (n.pitch = c[f * 3]), (n.yaw = c[f * 3 + 1]), (n.roll = c[f * 3 + 2]))
    let p = f + 1
    if (p < s.length && s[p] - s[f] <= wv && t > s[f]) {
      let e = (t - s[f]) / (s[p] - s[f])
      ;((n.pitch = kv(n.pitch, c[p * 3], e)),
        (n.yaw = kv(n.yaw, c[p * 3 + 1], e)),
        (n.roll = kv(n.roll, c[p * 3 + 2], e)))
    }
    return n
  }
}
function jv(e, t) {
  let n = /door/i.test(t.className)
  return e.kind === `door` ? n : !n
}
var Mv = 65535,
  Nv = 2,
  Pv = 0.85,
  Fv = class extends G {
    isBatchedMesh = !0
    _multiDrawStarts
    _multiDrawCounts
    _multiDrawCount = 0
    _matricesTexture = null
    _indirectTexture = null
    _colorsTexture = null
    colorTexture = null
    nearParts
    triangles
    usingLod = !1
    partStart
    partCount
    partCell
    partSphere
    sphere
    detail
    visibleTriangles = 0
    objectId = 0
    objectHidden = !1
    movable = !1
    constructor(e, t, n, r, i, a, o, s) {
      ;(super(e, t), (this.detail = s), (this.triangles = n), (this.nearParts = r.count))
      let c = r.count + (i?.count ?? 0)
      ;((this._multiDrawStarts = new Int32Array(Math.max(r.count, i?.count ?? 0))),
        (this._multiDrawCounts = new Int32Array(this._multiDrawStarts.length)),
        (this.partStart = new Int32Array(c)),
        (this.partCount = new Int32Array(c)),
        (this.partCell = new Uint32Array(c)),
        (this.partSphere = new Float32Array(c * 4)))
      let l = new B()
          .subVectors(o, a)
          .max(new B(0.001, 0.001, 0.001))
          .divideScalar(Mv),
        u = 0
      for (let e of i ? [r, i] : [r])
        for (let t = 0; t < e.count; t++, u++) {
          let n = t * 24,
            r = e.view
          ;((this.partStart[u] = (e.firstIndex + r.getUint32(n, !0)) * Nv),
            (this.partCount[u] = r.getUint32(n + 4, !0)),
            (this.partCell[u] = r.getUint32(n + 8, !0)))
          let i = 0
          for (let e = 0; e < 3; e++) {
            let t = r.getUint16(n + 12 + e * 2, !0),
              o = r.getUint16(n + 18 + e * 2, !0),
              s = l.getComponent(e),
              c = (o - t) * 0.5 * s
            ;((this.partSphere[u * 4 + e] = a.getComponent(e) + (t + o) * 0.5 * s), (i += c * c))
          }
          this.partSphere[u * 4 + 3] = Math.sqrt(i)
        }
      this.sphere = new lr(a, o).getBoundingSphere(new Nr())
      for (let e = 0; e < r.count; e++)
        ((this._multiDrawStarts[e] = this.partStart[e]), (this._multiDrawCounts[e] = this.partCount[e]))
      this._multiDrawCount = r.count
    }
  },
  Iv = class {
    planes = new Float32Array(24)
    camera = new B()
    cells = null
    detailDistance = 1 / 0
    lodDistance = 1 / 0
    frustum = new ca()
    matrix = new H()
    inverse = new H()
    setView(e, t) {
      ;(this.matrix.multiplyMatrices(e.projectionMatrix, e.matrixWorldInverse).multiply(t.matrixWorld),
        this.frustum.setFromProjectionMatrix(this.matrix, e.coordinateSystem),
        this.frustum.planes.forEach((e, t) => {
          ;((this.planes[t * 4] = e.normal.x),
            (this.planes[t * 4 + 1] = e.normal.y),
            (this.planes[t * 4 + 2] = e.normal.z),
            (this.planes[t * 4 + 3] = e.constant))
        }),
        this.camera.setFromMatrixPosition(e.matrixWorld).applyMatrix4(this.inverse.copy(t.matrixWorld).invert()))
    }
    cull(e) {
      let t = e.sphere.center,
        n = e.sphere.radius
      if (e.objectHidden || !this.sphereVisible(t.x, t.y, t.z, n)) {
        ;((e.visible = !1), (e.visibleTriangles = 0))
        return
      }
      let { cells: r, camera: i, detailDistance: a } = this,
        { partStart: o, partCount: s, partCell: c, partSphere: l, _multiDrawStarts: u, _multiDrawCounts: d } = e
      e.nearParts < o.length &&
        (e.usingLod = Math.hypot(t.x - i.x, t.y - i.y, t.z - i.z) - n > this.lodDistance * (e.usingLod ? Pv : 1))
      let f = e.usingLod ? e.nearParts : 0,
        p = e.usingLod ? o.length : e.nearParts,
        m = 0,
        h = 0,
        g = -1
      for (let t = f; t < p; t++) {
        let n = c[t]
        if (r && !((r[n >>> 3] >>> (n & 7)) & 1)) continue
        if (!e.movable) {
          let n = t * 4,
            r = l[n],
            o = l[n + 1],
            s = l[n + 2],
            c = l[n + 3]
          if ((e.detail && Math.hypot(r - i.x, o - i.y, s - i.z) - c > a) || !this.sphereVisible(r, o, s, c)) continue
        }
        let f = o[t],
          p = s[t]
        ;(f === g ? (d[m - 1] += p) : ((u[m] = f), (d[m] = p), m++), (g = f + p * Nv), (h += p))
      }
      ;((e._multiDrawCount = m), (e.visible = m > 0), (e.visibleTriangles = h / 3))
    }
    sphereVisible(e, t, n, r) {
      let i = this.planes
      for (let a = 0; a < 24; a += 4) if (i[a] * e + i[a + 1] * t + i[a + 2] * n + i[a + 3] < -r) return !1
      return !0
    }
  },
  Lv = [0.2125, 0.7154, 0.0721]
function Rv() {
  return { ambient: new Float32Array(18), sunVisibility: 1, probeRow: 0 }
}
