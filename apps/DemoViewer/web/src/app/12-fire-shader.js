// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 37126–37844 行（切片 19/40）
// 角色：燃烧瓶/火墙 shader uE：activeAt/footprintShape/noise/tracePatches
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var uE = class {
    data
    tickRate
    spans = []
    origin
    radiusRange
    trace
    shapes = new Map()
    constructor(e, t, n = 64, r) {
      ;((this.data = e),
        (this.trace = t),
        (this.tickRate = n),
        (this.radiusRange = e.infernoType === 0 || e.infernoType === 1 ? aE(e.infernoType) : null),
        (this.origin = lE(e.frames[0]?.origin) ?? lE(e.frames[0]?.positions) ?? [0, 0, 0]))
      let i = new Map()
      for (let t of e.frames) {
        let n = new Map()
        for (let [e, r] of i) {
          let a = lE(t.positions, e * 3)
          ;(!t.burning[e] || !a || a.some((e, t) => e !== r.position[t])) &&
            ((r.endTick = t.tick), i.delete(e), t.burning[e] && a && n.set(e, r))
        }
        for (let a = 0; a < t.burning.length; a++) {
          if (t.burning[a] !== 1 || i.has(a)) continue
          let o = lE(t.positions, a * 3)
          if (!o) continue
          let s = lE(t.origin),
            c = lE(t.parentPositions, a * 3),
            l = lE(t.normals, a * 3),
            u = n.get(a),
            d = u && Math.hypot(...o.map((e, t) => e - u.position[t])) < 12,
            f = {
              index: this.spans.length,
              patchId: a,
              position: o,
              origin: s ?? [...this.origin],
              parent: s && c ? c.map((e, t) => rE(e + s[t])) : [...o],
              normal: l ?? [0, 0, 1],
              startTick: t.tick,
              birthTick: d ? u.birthTick : t.tick,
              endTick: e.endTick,
              spatial: !!(s && c && l && this.radiusRange),
              targetRadius: this.radiusRange ? (this.radiusRange[0] + this.radiusRange[1]) / 2 : 0,
            }
          if (
            (r && (f.targetRadius = r(f)),
            f.spatial &&
              (!Number.isFinite(f.targetRadius) ||
                f.targetRadius < this.radiusRange[0] ||
                f.targetRadius > this.radiusRange[1]))
          )
            throw Error(`Fire target radius is outside the native type range`)
          ;(i.set(a, f), this.spans.push(f))
        }
      }
    }
    activeAt(e) {
      return !Number.isFinite(e) || e < this.data.startTick || e >= this.data.endTick
        ? []
        : this.spans.filter((t) => t.startTick <= e && e < t.endTick)
    }
    shapeAt(e, t = !0) {
      let n = Math.floor(e),
        r = this.activeAt(n).filter((e) => e.spatial)
      if (!this.trace || r.length === 0) return { tick: n, patches: [], sources: [], rejectedGround: 0 }
      let i = r.some((e) => n < e.birthTick + this.tickRate * 2),
        a = `${r.map((e) => e.index).join(`,`)}:${i ? n : `mature`}:${t ? `sources` : `patches`}`,
        o = this.shapes.get(a)
      if (o) return o
      let s = this.tracePatches(r, () => n)
      if (!t) {
        let e = { tick: n, patches: s, sources: [], rejectedGround: 0 }
        return (this.shapes.set(a, e), e)
      }
      let c = tE(this.origin, s),
        l = nE(this.origin, s),
        u = new Map(s.map((e) => [e.index, e])),
        d = [],
        f = 0,
        p = (e, t, n) => {
          if (!e) return
          let r = u.get(e.patchIndex),
            i = e.position.map((e, t) => rE(e + this.origin[t]))
          t === `edge` && (i[2] -= 40)
          let a = i.map((e, t) => e - this.origin[t])
          if (r.planes.some((e) => a.reduce((t, n, r) => t + n * e[r], e[3]) < -0.01)) return
          let o = cE(i, this.trace)
          if (!o) {
            f++
            return
          }
          d.push({
            id: r.index * 128 + n,
            family: t,
            patchId: r.span.patchId,
            span: r.span,
            position: [i[0], i[1], o.position[2] + (t === `edge` ? 40 : 0)],
            direction: e.direction,
            radius: e.radius,
            clearance: e.clearance,
            planes: r.planes,
          })
        }
      ;(c.interior.forEach((e) => p(e, `interior`, e?.spoke ?? 0)),
        c.base.forEach((e) => p(e, `base`, 32 + (e?.spoke ?? 0))),
        l.forEach((e) => p(e, `edge`, 64 + e.spoke * 2 + e.part)))
      let m = { tick: n, patches: s, sources: d, rejectedGround: f }
      return (this.shapes.set(a, m), m)
    }
    footprintShape() {
      let e = `footprint`,
        t = this.shapes.get(e)
      if (t) return t
      let n = new Map()
      for (let e of this.spans) e.spatial && n.set(`${e.patchId}:${e.birthTick}`, e)
      let r = [...n.values()],
        i = {
          tick: this.data.endTick,
          sources: [],
          rejectedGround: 0,
          patches: this.trace && r.length ? this.tracePatches(r, (e) => Math.min(e.endTick, this.data.endTick)) : [],
        }
      return (this.shapes.set(e, i), i)
    }
    tracePatches(e, t) {
      let n = !1
      return QT(
        e.map((e) => {
          let r = rE((t(e) - e.birthTick) / this.tickRate),
            i = Math.min(e.targetRadius, rE(rE(r * e.targetRadius) * 0.5)),
            a = {
              index: e.index,
              position: e.position,
              parent: e.parent,
              radius: i,
              targetRadius: e.targetRadius,
              state: +(r >= 2),
              edgeMask: 0,
              traceFractions: [],
              fillerFractions: [],
              planes: [],
            },
            o = sE(this.origin, a, this.trace, n)
          return ((n = o.raised), { ...o.patch, span: e })
        }),
      )
    }
    clearCache() {
      this.shapes.clear()
    }
    get cachedShapes() {
      return this.shapes.size
    }
  },
  dE = 22,
  fE = 0.55,
  pE = 26,
  mE = 0.75,
  hE = 0.25,
  gE = 1.1,
  _E = 3.5,
  vE = 0.6,
  yE = 64,
  bE = 5.5,
  xE = hE,
  SE = 6,
  CE = 1048576,
  wE = class {
    probes = new Map()
    offLattice = new Map()
    footprints = new Map()
    get(e, t, n) {
      return Number.isInteger(t) && Number.isInteger(n) && Math.abs(t) < CE && Math.abs(n) < CE
        ? this.probes.get(e)?.get((t + CE) * CE * 2 + n + CE)
        : this.offLattice.get(`${e}:${t}:${n}`)
    }
    set(e, t, n, r) {
      if (Number.isInteger(t) && Number.isInteger(n) && Math.abs(t) < CE && Math.abs(n) < CE) {
        let i = this.probes.get(e)
        ;(i || ((i = new Map()), this.probes.set(e, i)), i.set((t + CE) * CE * 2 + n + CE, r))
      } else this.offLattice.set(`${e}:${t}:${n}`, r)
    }
  }
function TE(e, t, n) {
  let r = !1,
    i = 1 / 0,
    [a, o] = n
  for (let { start: t, end: n, deltaX: s, deltaY: c, squaredLength: l } of e.edges) {
    let e = Math.max(0, Math.min(1, ((a - t[0]) * s + (o - t[1]) * c) / l))
    ;((i = Math.min(i, (a - t[0] - s * e) ** 2 + (o - t[1] - c * e) ** 2)),
      t[1] > o != n[1] > o && a < t[0] + ((o - t[1]) * s) / c && (r = !r))
  }
  let s = Math.sqrt(i) * (r ? 1 : -1)
  for (let { plane: r, length: i } of e.planes) {
    let e = r[3] + (n[0] - t[0]) * r[0] + (n[1] - t[1]) * r[1] + (n[2] - t[2]) * r[2]
    s = Math.min(s, e / i)
  }
  return s
}
function EE(e) {
  let t = Math.max(60, e.radius)
  return e.traceFractions.map((n) => Math.min(t, Math.fround(n * e.targetRadius)))
}
function DE(e, t) {
  let n = t.map((t, n) => {
      let r = ZT(n * 24)
      return [e.position[0] + r[0] * t, e.position[1] + r[1] * t]
    }),
    r = n.map((e, t) => {
      let r = n[(t + 1) % n.length],
        i = r[0] - e[0],
        a = r[1] - e[1]
      return { start: e, end: r, deltaX: i, deltaY: a, squaredLength: Math.max(1e-9, i * i + a * a) }
    }),
    i = 0
  if (t.length * 24 == 360 && t.every((e) => e > 0)) {
    i = 1 / 0
    let [t, n] = e.position
    for (let { start: e, deltaX: a, deltaY: o, squaredLength: s } of r) {
      let r = Math.max(0, Math.min(1, ((t - e[0]) * a + (n - e[1]) * o) / s))
      i = Math.min(i, Math.hypot(t - e[0] - a * r, n - e[1] - o * r))
    }
  }
  return {
    contour: {
      patch: e,
      reach: Math.max(...n.map(([t, n]) => Math.hypot(t - e.position[0], n - e.position[1]))),
      inner: i,
      edges: r,
      planes: e.planes.map((e) => ({ plane: e, length: Math.hypot(e[0], e[1]) })).filter(({ length: e }) => e >= 0.01),
    },
    points: n,
  }
}
function OE(e, t, n) {
  return e.reach - Math.hypot(t - e.patch.position[0], n - e.patch.position[1])
}
function kE(e, t, n, r) {
  let i = n[0] - e.patch.position[0],
    a = n[1] - e.patch.position[1],
    o = i * i + a * a,
    s = e.reach - r + 0.001
  if (o > s * s) return !0
  if (e.inner > 0.001 && o < (e.inner - 0.001) ** 2) {
    for (let { plane: i, length: a } of e.planes)
      if ((i[3] + (n[0] - t[0]) * i[0] + (n[1] - t[1]) * i[1] + (n[2] - t[2]) * i[2]) / a < r) return !0
    return !1
  }
  return TE(e, t, n) < r
}
function AE(e, t, n, r = 1 / 0) {
  let i = -1 / 0
  for (let a of e) if (!(OE(a, n[0], n[1]) <= i) && ((i = Math.max(i, TE(a, t, n))), i > r)) break
  return i
}
var jE = (e, t) => (e + 32768) * 65536 + (t + 32768),
  ME = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
function NE(e, t, n, r = new wE(), i = 12) {
  let a = (e, t, i) => {
      let a = e.position[2],
        o = r.get(a, t, i)
      if (o) return o
      let s = cE([t, i, a], n),
        c = s && s.normal[2] >= 0.5 ? s : null,
        l = c ? n([t, i, c.position[2] + 0.1], [t, i, c.position[2] + 64]) : null,
        u = { hit: c, ceiling: c && l ? Math.max(0, l.position[2] - c.position[2] - 1.5) : 64 }
      return (r.set(a, t, i, u), u)
    },
    o = (e) => {
      let n = EE(e),
        o = [i, ...t, ...e.position, ...n, ...e.planes.flat()],
        s = r.footprints.get(e.index)
      if (s && s.inputs.length === o.length && s.inputs.every((e, t) => e === o[t])) return s
      let { contour: c, points: l } = DE(e, n),
        u = { inputs: o, contour: c, columns: [], rows: [], probes: [] },
        d = Math.floor(Math.min(...l.map((e) => e[0])) / i) - 1,
        f = Math.ceil(Math.max(...l.map((e) => e[0])) / i) + 1,
        p = Math.floor(Math.min(...l.map((e) => e[1])) / i) - 1,
        m = Math.ceil(Math.max(...l.map((e) => e[1])) / i) + 1
      for (let n = p; n <= m; n++)
        for (let r = d; r <= f; r++) {
          let o = r * i,
            s = n * i
          if (kE(c, t, [o, s, e.position[2]], -2 * i)) continue
          let l = a(e, o, s)
          l.hit && (u.columns.push(r), u.rows.push(n), u.probes.push(l))
        }
      return (r.footprints.set(e.index, u), u)
    },
    s = Math.round(i * 0.75) + 6,
    c = i * 2 + 8,
    l = new Map(),
    u = []
  for (let t of e.patches) {
    let { contour: e, columns: n, rows: r, probes: i } = o(t)
    for (let a = 0; a < n.length; a++) {
      let o = n[a],
        c = r[a],
        d = i[a],
        f = d.hit.position[2],
        p = jE(o, c),
        m = l.get(p)
      m || ((m = []), l.set(p, m))
      let h = m.find((e) => Math.abs(e.ground - f) <= s)
      ;(h
        ? f > h.ground &&
          ((h.ground = f), (h.ceiling = d.ceiling), (h.probePatch = t), m.sort((e, t) => e.ground - t.ground))
        : ((h = {
            id: u.length,
            column: o,
            row: c,
            ground: f,
            ceiling: d.ceiling,
            contours: [],
            probePatch: t,
            distance: -1 / 0,
          }),
          m.push(h),
          m.sort((e, t) => e.ground - t.ground),
          u.push(h)),
        h.contours.includes(e) || h.contours.push(e))
    }
  }
  for (let e of u) e.distance = AE(e.contours, t, [e.column * i, e.row * i, e.ground])
  let d = (e, t, n) => {
      let r = null,
        i = 1 / 0
      for (let a of l.get(jE(t, n)) ?? []) {
        let t = Math.abs(a.ground - e.ground)
        t < i && ((i = t), (r = a))
      }
      return i <= c ? r : null
    },
    f = (e, t) => {
      let [n, r] = e.ground <= t.ground ? [e, t] : [t, e],
        o = r.ground - n.ground,
        c = n.ground,
        l = !1
      for (let e of [0.25, 0.5, 0.75]) {
        let t = a(n.probePatch, (n.column + (r.column - n.column) * e) * i, (n.row + (r.row - n.row) * e) * i).hit
          ?.position[2]
        if (t === void 0 || t < c - 1 || t > r.ground + 1 || t - c > Math.max(s, o * 0.75)) return !1
        ;(t - n.ground > 2 && r.ground - t > 2 && (l = !0), (c = t))
      }
      return l && r.ground - c <= Math.max(s, o * 0.75)
    },
    p = new Map(),
    m = (e, t) => {
      let n = e.id < t.id ? e.id * u.length + t.id : t.id * u.length + e.id,
        r = p.get(n)
      return (
        r === void 0 &&
          ((r =
            d(e, t.column, t.row) === t &&
            d(t, e.column, e.row) === e &&
            (Math.abs(e.ground - t.ground) <= s || f(e, t))),
          p.set(n, r)),
        r
      )
    },
    h = [],
    g = [],
    _ = [],
    v = [],
    y = new Int32Array(u.length).fill(-1),
    b = new Map(),
    x = (e, t, n, r, i) => (h.push(e, t, n), g.push(r), _.push(Math.max(0, i)), g.length - 1),
    S = (e) => (y[e.id] < 0 && (y[e.id] = x(e.column * i, e.row * i, e.ground, e.ceiling, e.distance)), y[e.id]),
    C = (e, t) => {
      let [n, r] = e.id < t.id ? [e, t] : [t, e],
        a = (n.id * u.length + r.id) * 2,
        o = b.get(a)
      if (o === void 0) {
        let e = Math.max(0, Math.min(1, n.distance / (n.distance - r.distance))),
          t = (t, n) => t + (n - t) * e
        ;((o = x(t(n.column, r.column) * i, t(n.row, r.row) * i, t(n.ground, r.ground), t(n.ceiling, r.ceiling), 0)),
          b.set(a, o))
      }
      return o
    },
    w = (e, n, r) => {
      let o = (e.id * 9 + (n - e.column + 1) * 3 + (r - e.row + 1)) * 2 + 1,
        c = b.get(o)
      if (c !== void 0) return c
      let l = e.column * i,
        u = e.row * i,
        d = (n - e.column) * i,
        f = (r - e.row) * i,
        p = 0,
        m = 1,
        h = e.ground,
        g = e.ceiling
      for (let n = 0; n < SE; n++) {
        let n = (p + m) / 2,
          r = l + d * n,
          i = u + f * n,
          o = a(e.probePatch, r, i),
          c = o.hit
        c !== null && Math.abs(c.position[2] - e.ground) <= s * n + 1 && AE(e.contours, t, [r, i, c.position[2]], 0) > 0
          ? ((p = n), (h = c.position[2]), (g = o.ceiling))
          : (m = n)
      }
      return ((c = p === 0 ? S(e) : x(l + d * p, u + f * p, h, g, 0)), b.set(o, c), c)
    },
    T = new Map()
  for (let e of u)
    if (!(e.distance <= 0))
      for (let [t, n] of ME) {
        let r = e.column - t,
          i = e.row - n
        T.set(jE(r, i), [r, i])
      }
  let E = 0,
    D = 0,
    O = (e, t, n) => {
      if (!n.some((e) => e && e.distance > 0)) return
      let r = [],
        i = (e) => {
          r[r.length - 1] !== e && r.push(e)
        },
        a = !0
      for (let r = 0; r < 4; r++) {
        let o = (r + 1) % 4,
          s = n[r],
          c = n[o]
        if ((s && s.distance > 0 ? i(S(s)) : (a = !1), s && c && m(s, c))) {
          s.distance > 0 != c.distance > 0 && i(C(s, c))
          continue
        }
        ;((a = !1),
          s && s.distance > 0 && i(w(s, e + ME[o][0], t + ME[o][1])),
          c && c.distance > 0 && i(w(c, e + ME[r][0], t + ME[r][1])))
      }
      if ((r.length > 1 && r[0] === r[r.length - 1] && r.pop(), r.length < 3)) return
      let o = 0
      for (let e = 0; e < r.length; e++) {
        let t = r[e] * 3,
          n = r[(e + 1) % r.length] * 3
        o += h[t] * h[n + 1] - h[n] * h[t + 1]
      }
      if (((o /= 2), o < 0.001)) return
      if ((D++, (E += o), a)) {
        let [e, t, n, i] = r
        Math.abs(h[e * 3 + 2] - h[n * 3 + 2]) <= Math.abs(h[t * 3 + 2] - h[i * 3 + 2])
          ? v.push(e, t, n, e, n, i)
          : v.push(e, t, i, t, n, i)
        return
      }
      if (r.length === 3) {
        v.push(...r)
        return
      }
      let s = 0,
        c = 0,
        l = 0,
        u = 1 / 0,
        d = 0
      for (let e of r) ((s += h[e * 3]), (c += h[e * 3 + 1]), (l += h[e * 3 + 2]), (u = Math.min(u, g[e])), (d += _[e]))
      let f = x(s / r.length, c / r.length, l / r.length, u, d / r.length)
      for (let e = 0; e < r.length; e++) v.push(f, r[e], r[(e + 1) % r.length])
    }
  for (let [e, t] of T.values()) {
    let n = ME.map(([n, r]) => l.get(jE(e + n, t + r)) ?? []),
      r = new Set()
    for (let i = 0; i < 4; i++)
      for (let a of n[i]) {
        if (r.has(a)) continue
        let n = [null, null, null, null]
        ;((n[i] = a), r.add(a))
        let o = [i]
        for (; o.length;) {
          let i = o.pop()
          for (let a of [(i + 1) % 4, (i + 3) % 4]) {
            if (n[a]) continue
            let s = d(n[i], e + ME[a][0], t + ME[a][1])
            !s || r.has(s) || !m(n[i], s) || ((n[a] = s), r.add(s), o.push(a))
          }
        }
        O(e, t, n)
      }
  }
  return {
    step: i,
    positions: Float32Array.from(h),
    limits: Float32Array.from(g),
    distances: Float32Array.from(_),
    indices: Uint32Array.from(v),
    cells: D,
    area: E,
  }
}
function PE(e, t) {
  let n = Math.max(0, Math.min(1, t / pE)),
    r = fE + (1 - fE) * n * n * (3 - 2 * n)
  return Math.max(0, Math.min(e, dE * r))
}
function FE(e, t = 0) {
  let { positions: n, limits: r, distances: i, indices: a } = e,
    o = r.length,
    s = new Float64Array(o)
  for (let e = 0; e < o; e++) s[e] = PE(r[e], i[e])
  let c = new Map(),
    l = [],
    u = [],
    d = [],
    f = a.length - (a.length % 3)
  for (let e = 0; e < f; e += 3)
    for (let t = 0; t < 3; t++) {
      let n = a[e + t],
        r = a[e + ((t + 1) % 3)]
      if (n === r) continue
      let i = n < r ? n * o + r : r * o + n,
        s = c.get(i)
      s === void 0 ? (c.set(i, l.length), l.push(n), u.push(r), d.push(1)) : d[s]++
    }
  let p = []
  for (let e = 0; e < l.length; e++) {
    if (d[e] !== 1) continue
    let t = l[e],
      r = u[e]
    Math.hypot(n[r * 3] - n[t * 3], n[r * 3 + 1] - n[t * 3 + 1], n[r * 3 + 2] - n[t * 3 + 2]) < 0.001 || p.push(t, r)
  }
  let m = p.length / 2,
    h = f + m * 6,
    g = new Float32Array(h * 3),
    _ = new Float32Array(h),
    v = new Float32Array(h),
    y = new Float32Array(h),
    b = new Float32Array(h).fill(t)
  for (let e = 0; e < f; e++) {
    let t = a[e],
      r = n[t * 3 + 2]
    ;((g[e * 3] = n[t * 3]),
      (g[e * 3 + 1] = n[t * 3 + 1]),
      (g[e * 3 + 2] = r + s[t]),
      (_[e] = 1),
      (v[e] = 1),
      (y[e] = r))
  }
  for (let e = 0; e < m; e++)
    for (let t = 0; t < 6; t++) {
      let r = p[e * 2 + IE[t]],
        i = f + e * 6 + t,
        a = n[r * 3 + 2]
      ;((g[i * 3] = n[r * 3]),
        (g[i * 3 + 1] = n[r * 3 + 1]),
        (g[i * 3 + 2] = LE[t] ? a + s[r] : a + 0.2),
        (v[i] = LE[t]),
        (y[i] = a))
    }
  let x = new Vr()
  return (
    x.setAttribute(`position`, new W(g, 3)),
    x.setAttribute(`aTop`, new W(_, 1)),
    x.setAttribute(`aHeightFraction`, new W(v, 1)),
    x.setAttribute(`aBaseHeight`, new W(y, 1)),
    x.setAttribute(`aStartTime`, new W(b, 1)),
    { geometry: x, boundarySegments: m }
  )
}
var IE = [0, 1, 1, 0, 1, 0],
  LE = [0, 0, 1, 0, 1, 1],
  RE = `
uniform float uTime;
uniform float uEndTime;
attribute float aTop;
attribute float aHeightFraction;
attribute float aBaseHeight;
attribute float aStartTime;
varying float vTop;
varying float vHeightFraction;
varying float vGrowth;
varying float vFlame;
varying float vAlive;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
	float growth = smoothstep(0.0, ${mE.toFixed(2)}, max(0.0, uTime - aStartTime));
	vec3 point = position;
	// Burning out: flames sink and thin unevenly instead of the whole fire vanishing on one tick.
	float dying = clamp((uTime - uEndTime + ${hE.toFixed(2)}) / ${gE.toFixed(2)}, 0.0, 1.0);
	float stagger = noise(point.xy / 55.0) * 0.7 + noise(point.xy / 19.0) * 0.3;
	float alive = 1.0 - clamp(dying * 1.6 - stagger * 0.6, 0.0, 1.0);
	float flame = sin(point.x * 0.075 + point.y * 0.052 + uTime * 3.1)
		+ 0.5 * sin(point.x * -0.041 + point.y * 0.083 - uTime * 4.3);
	float height = clamp(aHeightFraction, 0.0, 1.0);
	point.xy += vec2(sin(flame + uTime * 2.4), cos(flame * 1.3 - uTime * 1.9)) * height * 0.75;
	point.z = aBaseHeight + 0.2 + (point.z - aBaseHeight) * growth * alive * (0.94 + flame * 0.04);
	vTop = aTop;
	vHeightFraction = aHeightFraction;
	vGrowth = growth;
	vFlame = flame;
	vAlive = alive;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
}`,
  zE = `
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uEmber;
uniform vec3 uHot;
varying float vTop;
varying float vHeightFraction;
varying float vGrowth;
varying float vFlame;
varying float vAlive;
void main() {
	float tongue = 0.5 + 0.5 * sin(vHeightFraction * 10.0 - uTime * 4.2 + vFlame * 1.7);
	float heat = smoothstep(0.05, 0.80, vHeightFraction + (tongue - 0.5) * 0.16) * mix(0.55, 1.0, vAlive);
	vec3 color = mix(uBase, uEmber, heat);
	color = mix(color, uHot, smoothstep(0.68, 1.0, heat) * (0.45 + tongue * 0.35));
	color *= 0.95 + 0.05 * sin(uTime * 3.0 + vFlame);
	float alpha = 0.65 * smoothstep(0.0, 0.18, vGrowth) * smoothstep(0.0, 0.6, vAlive);
	if (alpha <= 0.002) discard;
	gl_FragColor = vec4(color, alpha);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,
  BE = `
attribute float aEdge;
varying float vEdge;
varying vec2 vGround;
void main() {
	vEdge = aEdge;
	vGround = position.xy;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  VE = `
uniform float uTime;
uniform float uEndTime;
uniform vec3 uPatches[${yE}];
uniform int uPatchCount;
varying float vEdge;
varying vec2 vGround;
void main() {
	float since = uTime - uEndTime;
	float formed = smoothstep(-${hE.toFixed(2)}, ${(gE * 0.7).toFixed(2)}, since);
	float fading = smoothstep(${_E.toFixed(2)}, ${(5.5).toFixed(2)}, since);
	// Per-pixel depth inside the union of burned discs: smooth, unlike the coarse mesh's interpolated edge distance.
	float inside = -1e4;
	for (int index = 0; index < ${yE}; index++) {
		if (index >= uPatchCount) break;
		vec3 disc = uPatches[index];
		float depth = disc.z - distance(vGround, disc.xy);
		float blend = clamp(0.5 + 0.5 * (depth - inside) / 24.0, 0.0, 1.0);
		inside = mix(inside, depth, blend) + 24.0 * blend * (1.0 - blend);
	}
	// The mesh boundary already lies on walls, ledges and the fire contour, so the mark stays solid right
	// up to it and only antialiases a few units; the disc field rounds the outline where it is tighter.
	float edge = min(inside, vEdge);
	float rim = smoothstep(0.0, 3.0, edge);
	float alpha = formed * (1.0 - fading) * rim * 0.85;
	if (alpha <= 0.002) discard;
	vec3 color = vec3(0.04);
	gl_FragColor = vec4(color, alpha);
	#include <colorspace_fragment>
}`
function HE(e) {
  let { positions: t, distances: n, indices: r } = e,
    i = Float32Array.from(t)
  for (let e = 2; e < i.length; e += 3) i[e] += vE
  let a = new Vr()
  return (
    a.setAttribute(`position`, new W(i, 3)),
    a.setAttribute(`aEdge`, new W(Float32Array.from(n), 1)),
    a.setIndex(new W(r.slice(0, r.length - (r.length % 3)), 1)),
    a
  )
}
var UE = 1,
  WE = { base: [0.2, 0.035, 0.38], ember: [1, 0.24, 0.015], hot: [1, 0.52, 0.055] },
  GE = { base: [0.02, 0.24, 0.3], ember: WE.ember, hot: WE.hot }
function KE(e, t, n) {
  let r = (e) => ({ value: new B(e[0], e[1], e[2]) })
  return new To({
    uniforms: { uTime: e, uEndTime: { value: n }, uBase: r(t.base), uEmber: r(t.ember), uHot: r(t.hot) },
    vertexShader: RE,
    fragmentShader: zE,
    transparent: !0,
    depthWrite: !1,
    side: 2,
  })
}
function qE(e, t, n) {
  let r = n.patches
      .map((e) => new B(e.position[0], e.position[1], Math.min(Math.max(60, e.radius), e.targetRadius || 60)))
      .sort((e, t) => t.z - e.z)
      .slice(0, yE),
    i = Array.from({ length: yE }, (e, t) => r[t] ?? new B())
  return new To({
    uniforms: { uTime: e, uEndTime: { value: t }, uPatches: { value: i }, uPatchCount: { value: r.length } },
    vertexShader: BE,
    fragmentShader: VE,
    transparent: !0,
    depthWrite: !1,
    side: 2,
    polygonOffset: !0,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}
function JE() {
  let e = { value: 0 },
    t = new Vr(),
    n = new zn()
  return (
    n.add(new G(t, KE(e, WE, 0))),
    n.add(new G(t, qE(e, 0, { tick: 0, patches: [], sources: [], rejectedGround: 0 }))),
    n
  )
}
