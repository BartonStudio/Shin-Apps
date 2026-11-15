// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 33719–34297 行（切片 16/40）
// 角色：ragdoll 轨迹录制器 Kx：advanceTo（前向模拟）/ record（录帧）/ sample（O(1) lerp+slerp 采样）/ collidersOf
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var Kx = class {
  sim
  bodies
  frames
  recorded = 0
  posScratch
  rotScratch
  constructor(e, t, n) {
    ;((this.sim = new Ex(e, t, n)),
      (this.bodies = e.count),
      (this.frames = new Float32Array(this.bodies * Vx * 64)),
      (this.posScratch = new Float64Array(this.bodies * 3)),
      (this.rotScratch = new Float64Array(this.bodies * 4)),
      this.record())
  }
  get done() {
    return this.sim === null
  }
  get duration() {
    return (this.recorded - 1) * ux
  }
  advanceTo(e, t = 1 / 0) {
    let n = this.sim
    if (!n) return 0
    let r = Math.min(e, Rx),
      i = 0
    for (; this.duration < r && !n.settled && i < t;) if ((n.step(), i++, !this.record())) return ((this.sim = null), i)
    return ((n.settled || this.duration >= Rx) && (this.sim = null), i)
  }
  sample(e, t, n) {
    let r = Math.max(0, Math.min(e / ux, this.recorded - 1)),
      i = Math.floor(r),
      a = Math.min(i + 1, this.recorded - 1),
      o = r - i,
      s = this.bodies * Vx,
      c = this.frames
    for (let e = 0; e < this.bodies; e++) {
      let r = i * s + e * Vx,
        l = a * s + e * Vx
      for (let n = 0; n < 3; n++) t[e * 3 + n] = c[r + n] + (c[l + n] - c[r + n]) * o
      let u = c[r + 3] * c[l + 3] + c[r + 4] * c[l + 4] + c[r + 5] * c[l + 5] + c[r + 6] * c[l + 6] < 0 ? -1 : 1,
        d = 0
      for (let t = 0; t < 4; t++) {
        let i = c[r + 3 + t] + (c[l + 3 + t] * u - c[r + 3 + t]) * o
        ;((n[e * 4 + t] = i), (d += i * i))
      }
      d = Math.sqrt(d) || 1
      for (let t = 0; t < 4; t++) n[e * 4 + t] /= d
    }
  }
  record() {
    let e = this.sim,
      t = this.bodies * Vx
    if ((this.recorded + 1) * t > this.frames.length) {
      let e = new Float32Array(this.frames.length * 2)
      ;(e.set(this.frames), (this.frames = e))
    }
    e.boneTransforms(this.posScratch, this.rotScratch)
    for (let e of this.posScratch) if (!Number.isFinite(e)) return !1
    for (let e of this.rotScratch) if (!Number.isFinite(e)) return !1
    let n = this.recorded * t
    for (let e = 0; e < this.bodies; e++) {
      let t = n + e * Vx
      ;((this.frames[t] = this.posScratch[e * 3]),
        (this.frames[t + 1] = this.posScratch[e * 3 + 1]),
        (this.frames[t + 2] = this.posScratch[e * 3 + 2]))
      for (let n = 0; n < 4; n++) this.frames[t + 3 + n] = this.rotScratch[e * 4 + n]
    }
    return (this.recorded++, !0)
  }
}
function qx(e, t, n, r, i, a) {
  let o = e[t],
    s = e[t + 1],
    c = e[t + 2],
    l = e[t + 3],
    u = n[r],
    d = n[r + 1],
    f = n[r + 2],
    p = n[r + 3]
  ;((i[a] = l * u + o * p + s * f - c * d),
    (i[a + 1] = l * d - o * f + s * p + c * u),
    (i[a + 2] = l * f + o * d - s * u + c * p),
    (i[a + 3] = l * p - o * u - s * d - c * f))
}
function Jx(e, t, n, r, i, a, o) {
  let s = e[t] * a,
    c = e[t + 1] * a,
    l = e[t + 2] * a,
    u = e[t + 3],
    d = 2 * (c * i - l * r),
    f = 2 * (l * n - s * i),
    p = 2 * (s * r - c * n)
  ;((o[0] = n + u * d + c * p - l * f), (o[1] = r + u * f + l * d - s * p), (o[2] = i + u * p + s * f - c * d))
}
var Yx = new H(),
  Xx = class {
    object = null
    colliders = null
    localBox = new lr()
    inverse = new H()
    v = new B()
    setObject(e) {
      return e === this.object ? !1 : ((this.object = e), (this.colliders = null), !0)
    }
    gather(e, t) {
      for (let { mesh: n, tree: r, bounds: i } of this.collidersOf()) {
        if (!i.intersectsBox(e)) continue
        let a = n.matrixWorld,
          o = a.equals(Yx),
          s = this.localBox.copy(e).applyMatrix4(this.inverse.copy(a).invert()),
          { min: c, max: l } = s,
          u = n.geometry,
          d = u.getAttribute(`position`),
          f = u.index,
          p = (e) => {
            let n = this.v.fromBufferAttribute(d, e)
            ;(o || n.applyMatrix4(a), t.push(n.x, n.y, n.z))
          }
        r.shapecast({
          intersectsBounds: (e) => (s.containsBox(e) ? 2 : +!!e.intersectsBox(s)),
          intersectsRange: (e, t, n) => {
            for (let i = e; i < e + t; i++) {
              let e = r.resolveTriangleIndex(i) * 3,
                t = f ? f.getX(e) : e,
                a = f ? f.getX(e + 1) : e + 1,
                o = f ? f.getX(e + 2) : e + 2
              if (!n) {
                let e = d.getX(t),
                  n = d.getX(a),
                  r = d.getX(o)
                if (Math.max(e, n, r) < c.x || Math.min(e, n, r) > l.x) continue
                let i = d.getY(t),
                  s = d.getY(a),
                  u = d.getY(o)
                if (Math.max(i, s, u) < c.y || Math.min(i, s, u) > l.y) continue
                let f = d.getZ(t),
                  p = d.getZ(a),
                  m = d.getZ(o)
                if (Math.max(f, p, m) < c.z || Math.min(f, p, m) > l.z) continue
              }
              ;(p(t), p(a), p(o))
            }
            return !1
          },
        })
      }
    }
    floorBelow(e, t, n, r, i = new gi()) {
      ;(i.origin.set(e, t, n), i.direction.set(0, 0, -1))
      let a = null
      for (let { mesh: o, tree: s, bounds: c } of this.collidersOf()) {
        if (e < c.min.x || e > c.max.x || t < c.min.y || t > c.max.y) continue
        let l = o.matrixWorld,
          u = i.clone()
        l.equals(Yx) || u.applyMatrix4(this.inverse.copy(l).invert())
        let d = s.raycastFirst(u, 2)
        if (!d) continue
        let f = d.point.applyMatrix4(l).z
        f >= r && f <= n && (a === null || f > a) && (a = f)
      }
      return a
    }
    collidersOf() {
      let e = this.object
      if (!e) return []
      if (this.colliders) return this.colliders
      e.updateWorldMatrix(!0, !0)
      let t = []
      return (
        e.traverse((e) => {
          if (!(e instanceof G)) return
          let n = e.geometry.boundsTree
          if (!(n instanceof Ih)) return
          let r = new lr()
          ;(n.getBoundingBox(r), t.push({ mesh: e, tree: n, bounds: r.applyMatrix4(e.matrixWorld) }))
        }),
        (this.colliders = t),
        t
      )
    }
  },
  Zx = 4,
  Qx = 1,
  $x = 2.5,
  eS = 0.8,
  tS = 3,
  nS = 24,
  rS = 10,
  iS = 2,
  aS = 4,
  oS = 8,
  sS = 350,
  cS = 40,
  lS = 160,
  uS = 256,
  dS = 64,
  fS = 800,
  pS = Math.PI / 180,
  mS = class {
    group = new zn()
    lighting
    solid
    glass
    shardGeometry = _S()
    hull = new Xx()
    map = null
    objects = null
    timeline = null
    entries = []
    pieceFiles = new Map()
    loaded = new Map()
    bursts = new Map()
    causes = { tracers: null, effects: [], frames: null, numPlayers: 0, tickRate: 64 }
    enabled = !1
    generation = 0
    frame = 0
    deadline = 0
    pose = { visible: !0, pitch: 0, yaw: 0, roll: 0 }
    euler = new xn()
    ray = new gi()
    v = new B()
    w = new B()
    scratchBox = new lr()
    prototypes = new zn()
    constructor(e, t) {
      ;((this.lighting = t),
        (this.solid = t.createMaterial({ surface: `vertex`, fade: !0, tint: !0 })),
        (this.glass = t.createMaterial({ surface: `vertex`, glass: !0, fade: !0 })),
        (this.group.name = `MapBreaks`),
        (this.group.visible = !1),
        e.add(this.group),
        this.prototypes.add(new G(this.shardGeometry, this.solid), new G(this.shardGeometry, this.glass)),
        this.prototypes.add(new ea(this.shardGeometry, this.glass, 1)))
    }
    get shaderPrototypes() {
      return this.prototypes
    }
    setMap(e) {
      ;((this.map = e), this.reset())
    }
    setCollisionObject(e) {
      this.hull.setObject(e) && this.clearBursts()
    }
    setEnabled(e) {
      ;((this.enabled = e), e || (this.group.visible = !1))
    }
    setCauses(e) {
      this.causes = e
    }
    update(e) {
      let t = this.map
      if (!this.enabled || !t) {
        this.group.visible = !1
        return
      }
      t.mapObjects !== this.objects && this.reset()
      let n = t.objectState
      if (!n) {
        this.group.visible = !1
        return
      }
      ;(n !== this.timeline && this.setTimeline(n),
        (this.group.visible = !0),
        this.frame++,
        (this.deadline = performance.now() + tS))
      let r = this.causes.tickRate || 64
      for (let t of this.entries) {
        let n = null
        for (let r of t.breaks) {
          if (r.tick > e) break
          e < r.respawnTick && (n = r)
        }
        if (!n) continue
        let i = this.burstOf(t, n)
        i && this.poseBurst(i, (e - n.tick) / r)
      }
      for (let e of this.bursts.values()) e.group.visible = e.used === this.frame
      this.evict()
    }
    dispose() {
      ;(this.reset(),
        this.group.removeFromParent(),
        this.solid.dispose(),
        this.glass.dispose(),
        this.shardGeometry.dispose())
    }
    breaksBetween(e, t, n) {
      if (this.enabled)
        for (let r of this.entries)
          for (let i of r.breaks) {
            if (i.tick > t) break
            i.tick > e && n(r.glass, r.object.model, r.box.getCenter(this.v))
          }
    }
    reset() {
      ;(this.generation++, this.clearBursts())
      for (let e of this.pieceFiles.values()) e.then((e) => yS(e))
      ;(this.pieceFiles.clear(),
        this.loaded.clear(),
        (this.objects = this.map?.mapObjects ?? null),
        (this.timeline = null),
        (this.entries = []))
    }
    clearBursts() {
      for (let e of this.bursts.values()) bS(e)
      this.bursts.clear()
    }
    setTimeline(e) {
      this.timeline = e
      let t = this.map,
        n = this.generation
      ;((this.entries = []),
        (this.objects ?? []).forEach((r, i) => {
          let a = t.objectBox(i),
            o = e.breaks(i)
          if (!r.breaks || !a || o.length === 0) return
          let s = {
            index: i,
            object: r,
            box: a,
            glass: r.breaks.glass === !0,
            breaks: o,
            pieces: null,
            loading: r.breaks.file !== void 0,
            light: Rv(),
            litVersion: -1,
          }
          this.entries.push(s)
          let c = r.breaks.file
          if (!c) return
          if (this.loaded.has(c)) {
            ;((s.pieces = this.loaded.get(c) ?? null), (s.loading = !1))
            return
          }
          let l = this.pieceFiles.get(c)
          ;(l || ((l = vS(t.fileUrl(c))), this.pieceFiles.set(c, l)),
            l.then((e) => {
              n === this.generation && (this.loaded.set(c, e), (s.pieces = e), (s.loading = !1))
            }))
        }))
      let r = new Map(this.entries.map((e) => [e.index, e]))
      for (let [e, t] of this.bursts) {
        let n = r.get(t.entry.index)
        n && !n.loading && n.breaks.some((e) => e.tick === t.tick)
          ? ((n.light = t.entry.light), (n.litVersion = t.entry.litVersion), (t.entry = n))
          : (bS(t), this.bursts.delete(e))
      }
    }
    burstOf(e, t) {
      if (e.loading) return null
      let n = `${e.index}:${t.tick}`,
        r = this.bursts.get(n)
      if (
        (r || ((r = this.createBurst(e, t.tick)), this.bursts.set(n, r)),
        (r.used = this.frame),
        e.litVersion !== this.lighting.version)
      ) {
        e.litVersion = this.lighting.version
        let t = e.box.getCenter(this.v)
        this.lighting.sample(t.x, t.y, t.z, e.light)
      }
      return r
    }
    createBurst(e, t) {
      let n = this.timeline.poseAt(e.index, t - 1, this.pose),
        [r, i, a] = e.object.origin
      this.euler.set(n.roll * pS, n.pitch * pS, n.yaw * pS, `ZYX`)
      let o = new Ht().setFromEuler(this.euler),
        s = new H().makeRotationFromQuaternion(o).setPosition(r, i, a),
        c = SS(e.index * 7919 + t),
        l = {
          entry: e,
          tick: t,
          group: new zn(),
          matrix: s,
          quaternion: o,
          impact: this.impactOf(e.box, t, c),
          seed: c,
          debris: [],
          track: null,
          positions: new Float64Array(),
          rotations: new Float64Array(),
          shards: null,
          debrisFade: 1,
          shardFade: 1,
          used: this.frame,
        },
        u = e.pieces
      for (let e of u?.statics ?? []) {
        let t = this.pieceMesh(e, l, `solid`)
        ;((t.matrixAutoUpdate = !1), t.matrix.copy(s), (t.matrixWorldNeedsUpdate = !0), l.group.add(t))
      }
      for (let e of u?.debris ?? []) {
        let t = this.pieceMesh(e, l, `debris`)
        ;((t.visible = !1), l.debris.push(t), l.group.add(t))
      }
      return (
        e.glass &&
          ((l.shards = new gS(this.shardGeometry, this.glass, e.box, l.impact, c, this.hull)),
          this.bindDraw(l.shards.mesh, l, `shards`),
          l.group.add(l.shards.mesh)),
        this.group.add(l.group),
        l
      )
    }
    pieceMesh(e, t, n) {
      let r = new G(e.geometry, e.glass ? this.glass : this.solid)
      return ((r.frustumCulled = n === `solid`), e.glass && (r.renderOrder = 1), this.bindDraw(r, t, n), r)
    }
    bindDraw(e, t, n) {
      e.onBeforeRender = (e, r, i, a, o) => {
        if (o !== this.solid && o !== this.glass) return
        let s = o
        ;(Iy(s.uniforms, t.entry.light),
          (s.uniforms.uFade.value = n === `debris` ? t.debrisFade : n === `shards` ? t.shardFade : 1))
        let c = t.entry.object.breaks?.tint
        ;(o === this.solid && s.uniforms.uTint.value.set(c?.[0] ?? 1, c?.[1] ?? 1, c?.[2] ?? 1),
          (s.uniformsNeedUpdate = !0))
      }
    }
    poseBurst(e, t) {
      let n = e.entry.pieces?.model ?? null
      if (n !== null && t < Zx) {
        let r = e.track ?? this.startTrack(e, n)
        for (; !r.done && r.duration < t && performance.now() < this.deadline;) r.advanceTo(t, 1)
        ;(r.sample(t, e.positions, e.rotations),
          e.debris.forEach((t, n) => {
            ;((t.visible = !0),
              t.position.set(e.positions[n * 3], e.positions[n * 3 + 1], e.positions[n * 3 + 2]),
              t.quaternion.set(
                e.rotations[n * 4],
                e.rotations[n * 4 + 1],
                e.rotations[n * 4 + 2],
                e.rotations[n * 4 + 3],
              ))
          }),
          (e.debrisFade = Math.min(1, (Zx - t) / Qx)))
      } else for (let t of e.debris) t.visible = !1
      let r = e.shards
      if (r) {
        let n = t < $x
        ;((r.mesh.visible = n), n && r.pose(t), (e.shardFade = Math.min(1, ($x - t) / eS)))
      }
    }
    startTrack(e, t) {
      let n = t.count,
        [r, i, a] = e.entry.object.origin,
        o = e.quaternion,
        s = new Float64Array(n * 3),
        c = new Float64Array(n * 4),
        l = new Float64Array(n * 3),
        u = new Float64Array(n * 3),
        d = CS(e.seed),
        { impact: f } = e,
        p = e.entry.pieces?.debris ?? []
      for (let t = 0; t < n; t++) {
        ;(s.set([r, i, a], t * 3), c.set([o.x, o.y, o.z, o.w], t * 4))
        let n = hS(f, this.v.copy(p[t].center).applyMatrix4(e.matrix), this.w)
        ;((l[t * 3] = n.x + (d() - 0.5) * 60),
          (l[t * 3 + 1] = n.y + (d() - 0.5) * 60),
          (l[t * 3 + 2] = n.z + 30 + d() * 40))
        for (let e = 0; e < 3; e++) u[t * 3 + e] = (d() - 0.5) * 12
      }
      let m = {
        bonePositions: s,
        boneRotations: c,
        velocity: [0, 0, 0],
        kickBody: -1,
        kick: [0, 0, 0],
        velocities: l,
        angularVelocities: u,
      }
      return (
        (e.positions = new Float64Array(n * 3)),
        (e.rotations = new Float64Array(n * 4)),
        (e.track = new Kx(t, this.gridAround(e.entry.box), m)),
        e.track
      )
    }
    gridAround(e) {
      let t = this.scratchBox.set(
          this.v.set(e.min.x - lS, e.min.y - lS, e.min.z - uS),
          this.w.set(e.max.x + lS, e.max.y + lS, e.max.z + dS),
        ),
        n = []
      this.hull.gather(t, n)
      let r = e.clone().expandByScalar(0.5),
        i = []
      for (let e = 0; e < n.length; e += 9) {
        let t = !0
        for (let i = 0; i < 9 && t; i += 3) t = r.containsPoint(this.v.fromArray(n, e + i))
        if (!t) for (let t = 0; t < 9; t++) i.push(n[e + t])
      }
      if (i.length === 0) {
        let n = e.min.z,
          r = t.min.x,
          a = t.min.y,
          o = t.max.x,
          s = t.max.y
        i.push(r, a, n, o, a, n, o, s, n, r, a, n, o, s, n, r, s, n)
      }
      return new wx(new Float32Array(i))
    }
    impactOf(e, t, n) {
      let { tracers: r, effects: i, frames: a, numPlayers: o } = this.causes,
        s = e.getCenter(new B())
      if (r && r.count > 0) {
        let n = this.scratchBox.copy(e).expandByScalar(aS),
          i = null
        for (let e = xS(r.tick, r.count, t - rS); e < r.count && !(r.tick[e] > t + iS); e++) {
          let a = e * 3
          this.ray.origin.set(r.origin[a], r.origin[a + 1], r.origin[a + 2])
          let o = this.w
            .set(r.end[a], r.end[a + 1], r.end[a + 2])
            .sub(this.ray.origin)
            .length()
          if (o < 0.001) continue
          this.ray.direction.copy(this.w).divideScalar(o)
          let s = this.ray.intersectBox(n, this.v)
          !s ||
            s.distanceTo(this.ray.origin) > o ||
            ((!i || r.tick[e] <= t) &&
              (i = { point: s.clone(), direction: this.ray.direction.clone(), speed: 170, radial: !1 }))
        }
        if (i) return i
      }
      let c = null,
        l = sS
      for (let n of i) {
        if (n.kind !== `he` || Math.abs(n.startTick - t) > oS) continue
        let r = e.distanceToPoint(this.v.set(n.x, n.y, n.z))
        r < l && ((c = n), (l = r))
      }
      if (c) {
        let e = new B(c.x, c.y, c.z)
        return { point: e, direction: s.clone().sub(e).normalize(), speed: 420 * (1 - l / sS) + 80, radial: !0 }
      }
      if (a && o > 0 && a.frameTick.length > 0) {
        let n = Math.max(0, Math.min(a.frameTick.length - 1, xS(a.frameTick, a.frameTick.length, t) - 1)),
          r = cS,
          i = null
        for (let t = 0; t < o; t++) {
          let s = n * o + t
          if (!a.alive[s]) continue
          let c = this.v.set(a.posX[s], a.posY[s], a.posZ[s]),
            l = Math.min(e.distanceToPoint(c), e.distanceToPoint(this.w.copy(c).setZ(c.z + 64)))
          l < r && ((r = l), (i = c.clone().setZ(c.z + 40)))
        }
        if (i) {
          let e = s.clone().sub(i).setZ(0)
          if (e.lengthSq() > 1e-6) return { point: i, direction: e.normalize(), speed: 130, radial: !1 }
        }
      }
      let u = e.getSize(new B()),
        d = new B(),
        f = u.x <= u.y && u.x <= u.z ? 0 : u.y <= u.z ? 1 : 2
      return (
        d.setComponent(f, n & 1 ? -1 : 1),
        { point: s.clone().addScaledVector(d, -32), direction: d, speed: 70, radial: !1 }
      )
    }
    evict() {
      if (this.bursts.size <= nS) return
      let e = [...this.bursts.entries()].filter(([, e]) => e.used !== this.frame).sort((e, t) => e[1].used - t[1].used)
      for (let [t, n] of e.slice(0, this.bursts.size - nS)) (bS(n), this.bursts.delete(t))
    }
  }
function hS(e, t, n) {
  if (e.radial) {
    n.copy(t).sub(e.point)
    let r = n.length() || 1
    return n.multiplyScalar((e.speed * Math.min(1, 96 / r)) / r)
  }
  let r = n.copy(t).sub(e.point),
    i = r.dot(e.direction),
    a = 0.45 + 0.55 / (1 + Math.sqrt(Math.max(0, r.lengthSq() - i * i)) / 24)
  return n.copy(e.direction).multiplyScalar(e.speed * a)
}
