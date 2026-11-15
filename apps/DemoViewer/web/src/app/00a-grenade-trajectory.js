// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 27991–28268 行（切片 2/40）
// 角色：投掷物轨迹重采样 Uh/Kh + 落点视角 lg（用 three-mesh-bvh 对地图做碰撞射线，含 "Landing view needs loaded map geometry." 等 UX 文案）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var Hh = new B(0, 0, 1)
function Uh(e, t) {
  let { ticks: n, posXYZ: r } = e,
    i = e.detonationTick ?? e.endTick
  if (!n.length || r.length !== n.length * 3 || !Number.isFinite(i) || i < e.startTick)
    return { ok: !1, reason: `This grenade has no valid recorded landing position.` }
  let a = 0
  for (; a + 1 < n.length && n[a + 1] <= i;) a++
  let o = new B().fromArray(r, a * 3)
  if (a + 1 < n.length) {
    let e = n[a + 1] - n[a]
    e > 0 && o.lerp(new B().fromArray(r, (a + 1) * 3), Vt.clamp((i - n[a]) / e, 0, 1))
  }
  if (![o.x, o.y, o.z].every(Number.isFinite))
    return { ok: !1, reason: `This grenade has no valid recorded landing position.` }
  let s,
    c = 4096
  for (let n of t) {
    if (n.kind !== e.kind || n.startTick !== i) continue
    let t = o.distanceToSquared(new B(n.x, n.y, n.z))
    t <= c && ((c = t), (s = n))
  }
  s && o.set(s.x, s.y, s.z)
  let l = new B(1, 0, 0)
  for (let e = a; e >= 0; e--) {
    let t = new B(r[e * 3] - o.x, r[e * 3 + 1] - o.y, 0)
    if (t.lengthSq() >= 1024) {
      l.copy(t).normalize()
      break
    }
  }
  return { ok: !0, landing: { tick: i, target: o, approach: l } }
}
var Wh = 0.3,
  Gh = 1500
function Kh(e, t, n, r) {
  if (t.kind !== `flash`) return []
  let { frames: i } = e,
    a = e.meta.numPlayers,
    o = i.frameTick
  if (!a || !o.length || i.flash.length < o.length * a) return []
  let s = 0,
    c = o.length
  for (; s < c;) {
    let e = (s + c) >> 1
    o[e] < n ? (s = e + 1) : (c = e)
  }
  let l = s - 1
  if (l < 0 || s >= o.length) return []
  let u = t.throwerSlot,
    d = u >= 0 && u < a ? i.team[l * a + u] : 0,
    f = []
  for (let e = 0; e < a; e++) {
    let t = l * a + e
    if (!i.alive[t]) continue
    let c = 0,
      p = s
    for (let r = s; r < o.length && (r === s || o[r] <= n + 2); r++) {
      let n = i.flash[r * a + e] - i.flash[t]
      n > c && ((c = n), (p = r))
    }
    let m = p * a + e,
      h = new B(i.posX[m], i.posY[m], i.posZ[m])
    if (![h.x, h.y, h.z].every(Number.isFinite)) continue
    let g = !d || i.team[t] !== d
    c > Wh
      ? f.push({ position: h, weight: e === u ? 1 : g ? 3 : 1.5 })
      : g && h.distanceTo(r) <= Gh && f.push({ position: h, weight: 0.75 })
  }
  return f
}
var qh = 48,
  Jh = Vt.degToRad(28),
  Yh = 2200,
  Xh = 260,
  Zh = 160,
  Qh = Vt.degToRad(22),
  $h = Vt.degToRad(30),
  eg = [96, 160, 240, 320, 420],
  tg = [96, 160, 240],
  ng = [32, 64, 96, 160],
  rg = [48, 96],
  ig = 16,
  ag = 320,
  og = 16,
  sg = 4,
  cg = 256
function lg(e, t, n, r = []) {
  let i = Uh(e, t)
  if (!i.ok) return i
  if (!n) return { ok: !1, reason: `Landing view needs loaded map geometry. Try again once the map loads.` }
  n.updateWorldMatrix(!0, !0)
  let a = new lr().setFromObject(n),
    o = []
  if (
    (n.traverse((e) => {
      if (!(e instanceof G) || !e.geometry.getAttribute(`position`)) return
      let t = e.geometry
      ;(t.boundsTree instanceof Ih || (t.boundsTree = new Ih(t, { indirect: !0 })),
        o.push({ tree: t.boundsTree, inverse: e.matrixWorld.clone().invert(), world: e.matrixWorld.clone() }))
    }),
    !o.length)
  )
    return { ok: !1, reason: `Landing view needs map collision geometry.` }
  let s = a.clone().expandByScalar(-12),
    { target: c, approach: l, tick: u } = i.landing
  if (c.x < a.min.x || c.x > a.max.x || c.y < a.min.y || c.y > a.max.y || c.z < a.min.z)
    return { ok: !1, reason: `The recorded landing is outside the loaded map.` }
  let d = new gi(),
    f = new B(),
    p = new Nr(),
    m = new V()
  function h(e, t) {
    let n = null,
      r = e.distanceTo(t)
    for (let i of o) {
      ;(d.origin.copy(e).applyMatrix4(i.inverse), d.direction.copy(f.copy(t).applyMatrix4(i.inverse)).sub(d.origin))
      let a = d.direction.length()
      if (a < 1e-6) continue
      d.direction.multiplyScalar(1 / a)
      let o = i.tree.raycastFirst(d, 2, 0.01, a)
      if (!o?.face) continue
      let s = o.point.clone().applyMatrix4(i.world),
        c = e.distanceTo(s)
      c >= r ||
        ((r = c),
        (n = { point: s, normal: o.face.normal.clone().applyMatrix3(m.getNormalMatrix(i.world)).normalize() }))
    }
    return n
  }
  function g(e) {
    return o.every((t) => (p.set(e, 12).applyMatrix4(t.inverse), !t.tree.intersectsSphere(p)))
  }
  let _ = r
    .filter((e) => e.weight > 0 && [e.position.x, e.position.y, e.position.z].every(Number.isFinite))
    .map((e) => {
      let t = e.position.clone().setZ(e.position.z + qh)
      return { chest: t, feet: e.position, weight: h(c, t) ? e.weight * 0.25 : e.weight }
    })
  _.sort((e, t) => t.weight - e.weight)
  let v = _.reduce((e, t) => e + t.weight, 0),
    y = Math.min(a.max.z + 1, Math.max(c.z, ..._.map((e) => e.chest.z)) + cg),
    b = Math.max(a.min.z - 1, Math.min(c.z, ..._.map((e) => e.feet.z)) - 1024)
  function x(e, t) {
    let n = [],
      r = new B(e, t, y),
      i = new B(e, t, b)
    for (let e = 0; e < 10 && n.length < sg && r.z > i.z; e++) {
      let e = h(r, i)
      if (!e) break
      ;(e.normal.z >= 0.5 && n.push(e.point.z), (r.z = e.point.z - 1))
    }
    return n
  }
  let S = c.z
  if (v > 0) S = _.reduce((e, t) => e + t.feet.z * t.weight, 0) / v
  else {
    let e = h(c, new B(c.x, c.y, b))
    e && (S = e.point.z)
  }
  let C = c.z - S,
    w = Math.max(Xh, C * 1.1),
    T = C > Zh ? new B(c.x, c.y, S + qh) : null,
    E = T ? [...eg, 560, 720] : eg,
    D = Math.atan2(l.y, l.x) + Math.PI,
    O = []
  for (let e = 0; e < og; e++) {
    let t = D + (e * Math.PI * 2) / og
    for (let e of E) O.push({ x: c.x + Math.cos(t) * e, y: c.y + Math.sin(t) * e, azimuth: t, radius: e })
  }
  if (v > 0) {
    let e = _.reduce((e, t) => e.addScaledVector(t.feet, t.weight), new B()).multiplyScalar(1 / v)
    for (let t = 0; t < og; t++) {
      let n = D + (t * Math.PI * 2) / og
      for (let t of tg) {
        let r = e.x + Math.cos(n) * t,
          i = e.y + Math.sin(n) * t
        O.push({ x: r, y: i, azimuth: Math.atan2(i - c.y, r - c.x), radius: Math.hypot(r - c.x, i - c.y) })
      }
    }
  }
  let k = [],
    A = v > 0 ? 1.5 : 4,
    ee = (e, t) => (t > Yh ? 0 : e.weight * Vt.clamp(1.4 - t / 1500, 0.35, 1))
  for (let e of O)
    if (!(e.x < s.min.x || e.x > s.max.x || e.y < s.min.y || e.y > s.max.y))
      for (let t of x(e.x, e.y)) {
        let n = Math.max(0, t - S - 150) / 24 + Math.max(0, S - t - 200) / 32,
          r = [...ng]
        for (let e of rg) {
          let n = c.z + e - t
          n > ng[ng.length - 1] && n <= ag && r.push(n)
        }
        for (let i of r) {
          let r = new B(e.x, e.y, t + i)
          if (!s.containsPoint(r)) continue
          let a = Math.cos(e.azimuth - D) * A + Math.min(i, 160) / 48 - Math.abs(r.distanceTo(c) - w) / 80 - n,
            o = 0
          for (let e of _) o += ee(e, r.distanceTo(e.chest))
          k.push({ position: r, base: a, bound: a + o * 6 + 3 + 9 })
        }
      }
  k.sort((e, t) => t.bound - e.bound)
  let te = new B(),
    j = new B(),
    M = new B(),
    ne = new B(),
    re = new B(),
    ie = [],
    ae = null,
    oe = -1 / 0
  function se(e) {
    for (let { position: t, base: n, bound: r } of k) {
      if (r <= oe) break
      if (!g(t)) continue
      let i = !h(t, e)
      if (!i && !_.length) continue
      ie.length = 0
      let a = 0,
        o = (r - n - 12) / 6,
        s = n + (i ? 3 : 0) + 9
      for (let e of _) {
        let n = ee(e, t.distanceTo(e.chest))
        if (n) {
          if (((o -= n), h(t, e.chest))) {
            if (s + (a + o) * 6 <= oe) break
            continue
          }
          ;(ie.push({ direction: e.chest.clone().sub(t).normalize(), weight: n }), (a += n))
        }
      }
      if ((!i && !ie.length) || s + a * 6 <= oe) continue
      if ((te.copy(e).sub(t).normalize(), j.copy(te), ie.length)) {
        j.multiplyScalar(i ? 2 : 0)
        for (let e of ie) j.addScaledVector(e.direction, e.weight)
        for (let e = 0; e < 2; e++) {
          ;(j.lengthSq() < 1e-6 && j.copy(te), j.normalize())
          let e = new B()
          i && j.angleTo(te) <= Jh && e.addScaledVector(te, 2)
          for (let t of ie) j.angleTo(t.direction) <= Jh && e.addScaledVector(t.direction, t.weight)
          e.lengthSq() > 1e-6 && j.copy(e)
        }
        j.normalize()
      }
      if (T && !ie.length) {
        ne.copy(T).sub(t).normalize()
        let e = i ? Qh - j.angleTo(te) : Jh,
          n = Math.min(j.angleTo(ne), Math.max(0, e))
        ;(re.crossVectors(j, ne), n > 1e-4 && re.lengthSq() > 1e-8 && j.applyAxisAngle(re.normalize(), n))
      }
      let c = 0
      for (let e of ie) j.angleTo(e.direction) <= Jh && (c += e.weight)
      let l = i && j.angleTo(te) <= Jh,
        u = Math.asin(Vt.clamp(Math.abs(j.z), 0, 1)),
        d = n + c * 6 + (l ? 3 : 0) - Math.max(0, u - $h) * 8
      if (d + 9 <= oe) continue
      let f = 0
      if ((M.set(j.x, j.y, 0), M.lengthSq() > 1e-6)) {
        M.normalize()
        for (let e of [-Math.PI / 6, 0, Math.PI / 6]) {
          let n = M.clone().applyAxisAngle(Hh, e)
          h(t, t.clone().addScaledVector(n, 96)) || f++
        }
      }
      let p = d + f * 3
      p > oe && ((oe = p), (ae = { position: t, aim: j.clone(), look: e }))
    }
  }
  se(c)
  let ce = c.clone().setZ(c.z + ig)
  if ((!ae && !h(c, ce) && se(ce), !ae))
    return { ok: !1, reason: `No clear, in-bounds landing view was found here. Use the thrower replay instead.` }
  let le =
    ae.aim.angleTo(ae.look.clone().sub(ae.position)) < 1e-4
      ? ae.look
      : ae.position.clone().addScaledVector(ae.aim, Math.max(64, ae.position.distanceTo(ae.look)))
  return { ok: !0, position: ae.position, target: le, tick: u }
}
