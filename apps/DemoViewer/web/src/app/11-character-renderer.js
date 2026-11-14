// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 35810–37125 行（切片 12/34）
// 角色：角色渲染 zw：characters 贴图/胶囊兜底
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var zw = class {
  group = new zn()
  lighting
  numPlayers
  bodies
  weapons = new Map()
  weaponMaterials = []
  templates = null
  gait = null
  loading = null
  enabled = !1
  disposed = !1
  frame = 0
  inputs = GS()
  motion = bC()
  air = { weight: 0, age: 0 }
  frustum = new ca()
  projScreen = new H()
  sphere = new Nr()
  cameraPos = new B()
  corpseIndex = null
  falls = new _w()
  drawnAlive
  xrayOnly
  constructor(e, t, n) {
    ;((this.lighting = n),
      (this.numPlayers = t),
      (this.drawnAlive = new Uint8Array(t)),
      (this.xrayOnly = new Uint8Array(t)),
      (this.bodies = Array.from({ length: t }, () => [null, null])),
      (this.group.name = `characters`),
      (this.group.visible = !1),
      e.add(this.group))
  }
  get active() {
    return this.enabled && this.templates !== null
  }
  setEnabled(e) {
    ;((this.enabled = e),
      (this.group.visible = this.active),
      this.enabled &&
        !this.loading &&
        (this.loading = this.load().catch((e) => {
          console.warn(`[csplayer] character models failed to load; keeping capsules`, e)
        })))
  }
  setCollisionObject(e) {
    this.falls.setCollisionObject(e)
    for (let e of this.bodies) for (let t of e) t && (t.stale = !0)
  }
  update(e, t, n, r, i = -1, a, o = !1) {
    let s = this.templates
    if (((this.group.visible = this.active), this.drawnAlive.fill(0), this.xrayOnly.fill(0), !this.active || !s)) return
    ;(this.frame++,
      r.updateMatrixWorld(),
      this.projScreen.multiplyMatrices(r.projectionMatrix, r.matrixWorldInverse),
      this.frustum.setFromProjectionMatrix(this.projScreen),
      this.cameraPos.setFromMatrixPosition(r.matrixWorld))
    let c = Tg(e, n),
      l = c ? c.defuserSlot : -1,
      u = c ? Math.max(0, c.durationSeconds - c.remainingSeconds) : 1 / 0,
      { tickRate: d } = e.meta,
      f = Math.min(this.numPlayers, t.alive.length)
    this.falls.beginFrame()
    for (let r = 0; r < f; r++) {
      let c = t.alive[r] === 1,
        f = c ? null : this.corpseAt(e, r, n),
        p = c ? t.team[r] : f ? f.team : 0,
        m = p === 2 ? 0 : p === 3 ? 1 : -1,
        h = c && a?.[r] === 1,
        g = m >= 0 && r !== i && (c ? !h || o : f !== null),
        _ = c ? t.x[r] : (f?.x ?? 0),
        v = c ? t.y[r] : (f?.y ?? 0),
        y = c ? t.z[r] : (f?.z ?? 0)
      g &&=
        (this.sphere.center.set(_, v, y + (c ? bw : Sw)),
        (this.sphere.radius = c ? xw : Cw),
        this.frustum.intersectsSphere(this.sphere))
      let b = this.bodies[r]
      for (let e = 0; e < 2; e++) {
        let t = b[e]
        t && (!g || e !== m) && Yw(t)
      }
      if (!g) continue
      c && (this.drawnAlive[r] = 1)
      let x = m,
        S = s[x],
        C = b[x]
      C ||= b[x] = this.createBody(S)
      let w = f ? this.fallOf(e, f, S.animator) : null
      if (
        (w ? Kw(C.root.matrix, w.root.x, w.root.y, w.root.z, w.root.yaw) : Kw(C.root.matrix, _, v, y, t.yaw[r] * yw),
        (C.root.matrixWorldNeedsUpdate = !0),
        C.shown || ((C.shown = !0), (C.stale = !0), (C.root.matrixWorldAutoUpdate = !0)),
        (C.root.visible = !h),
        h && (this.xrayOnly[r] = 1),
        this.needsPose(C, n, f, _, v, y, r))
      ) {
        if (f) {
          this.setWeapon(C, ``)
          let e = Math.max(0, (n - f.startTick) / d)
          w
            ? (C.corpsePhase = this.falls.pose(w, e, C.pose, C.corpseCenter))
            : ((this.inputs.death = S.animator.deathClips[0] ?? ``),
              (this.inputs.deathAge = e),
              this.inputs.death ? S.animator.pose(this.inputs, C.pose) : OS(S.animator.rig.rest, C.pose),
              (C.corpsePhase = e > jw ? `rest` : `falling`))
        } else {
          let i = this.inputs,
            a = t.pitch[r]
          ;(a > 180 && (a -= 360),
            this.aliveInputs(e, r, n, t.yaw[r], a, t.duck[r], l === r ? u : 1 / 0),
            this.setWeapon(
              C,
              i.kind === `knife`
                ? Zy(this.motion.weapon, p)
                : i.kind === `gun` || i.kind === `grenade` || i.kind === `c4`
                  ? i.weapon
                  : ``,
            ),
            S.animator.pose(i, C.pose))
        }
        ;(qw(C), (C.posedTick = n), (C.posedCorpse = f), (C.stale = !1))
      }
      if (h) continue
      let T =
          f && w
            ? this.sphere.center.copy(C.corpseCenter).setZ(C.corpseCenter.z + Ow)
            : this.sphere.center.set(_, v, y + Dw),
        E = this.lighting.version
      ;(C.litVersion !== E || C.litAt.distanceToSquared(T) > Ew ** 2) &&
        ((C.litVersion = E), C.litAt.copy(T), this.lighting.sample(T.x, T.y, T.z, C.light), Iy(C.uniforms, C.light))
    }
  }
  dispose() {
    ;((this.disposed = !0), this.group.removeFromParent())
    for (let e of this.bodies) for (let t of e) t && Xw(t)
    for (let e of this.weaponMaterials) e.dispose()
    for (let e of this.weapons.values()) e.geometry?.dispose()
    if ((this.weapons.clear(), this.templates)) for (let e of this.templates) Zw(e.scene)
    this.templates = null
  }
  renderXrayMask(e, t, n) {
    if (!this.active) return
    let r = [],
      i = []
    for (let e = 0; e < this.bodies.length; e++)
      for (let t of this.bodies[e])
        if (t?.shown) {
          if (this.drawnAlive[e] !== 1) {
            ;((t.root.visible = !1), i.push(t))
            continue
          }
          ;(t.xrayMask.uniforms.uColor.value.copy(n(e)),
            (t.xrayMask.uniforms.uAlpha.value = this.xrayOnly[e] === 1 ? 1 : 0.5))
          for (let e of t.parts) e.material = t.xrayMask
          ;(this.xrayOnly[e] === 1 && (t.root.visible = !0), r.push(t))
        }
    let a = this.group.matrixWorldAutoUpdate
    this.group.matrixWorldAutoUpdate = !1
    try {
      r.length > 0 && e.render(this.group, t)
    } finally {
      this.group.matrixWorldAutoUpdate = a
      for (let e of r)
        e.parts.forEach((t, n) => {
          t.material = e.partMaterials[n]
        })
      for (let e of i) e.root.visible = !0
      for (let e = 0; e < this.bodies.length; e++)
        if (this.xrayOnly[e] === 1) for (let t of this.bodies[e]) t?.shown && (t.root.visible = !1)
    }
  }
  async load() {
    let [e, t, n] = await Promise.all([rb(`characters/t.glb`), rb(`characters/ct.glb`), Bw(`characters/anims.bin`)])
    if (this.disposed) {
      ;(Zw(e.scene), Zw(t.scene))
      return
    }
    let r = [Vw(e.scene, n), Vw(t.scene, n)]
    ;((this.gait = new GC(r[1].animator.gait)), (this.templates = r), (this.group.visible = this.active))
  }
  needsPose(e, t, n, r, i, a, o) {
    if (e.stale || e.posedCorpse !== n || (n && e.corpsePhase === `behind`)) return !0
    if (e.posedTick === t) return !1
    if (n) return !(e.corpsePhase === `rest` && t >= e.posedTick)
    let s = this.cameraPos.distanceTo(this.sphere.center.set(r, i, a)),
      c = s > Tw ? 3 : s > ww ? 2 : 1
    return c === 1 || (this.frame + o) % c === 0
  }
  aliveInputs(e, t, n, r, i, a, o) {
    let s = this.inputs,
      c = SC(e, t, n, this.motion),
      l = Yy(c.weapon) ?? ``,
      u = US(l, Xy(c.weapon)),
      d = r * yw,
      f = KC(e, t, n)
    ;(XC(e, t, n, this.air),
      (s.time = n / e.meta.tickRate),
      (s.weapon = l),
      (s.kind = u),
      (s.speed = c.speed),
      (s.moveAngle = Number.isNaN(f) ? 0 : f - d),
      (s.phase = this.gait?.at(e, t, n) ?? 0),
      (s.duck = a),
      (s.air = this.air.weight),
      (s.airAge = this.air.age),
      (s.pitch = i),
      (s.equipAge = c.equipAge),
      (s.fireAge = c.fireAge),
      (s.reloadAge = c.reloadAge),
      (s.reloading = c.reloading),
      (s.pinPulled = c.pinPulled),
      (s.pinAge = c.pinAge),
      (s.plantAge = c.planting ? c.plantAge : 1 / 0),
      (s.defuseAge = o),
      (s.death = ``),
      (s.deathAge = 0))
  }
  corpseAt(e, t, n) {
    let r = this.corpseIndex
    if (!r || r.markers !== e.deathMarkers) {
      let t = Array.from({ length: this.numPlayers }, () => [])
      for (let n of e.deathMarkers) t[n.victimSlot]?.push(n)
      for (let e of t) e.sort((e, t) => e.startTick - t.startTick)
      r = this.corpseIndex = { markers: e.deathMarkers, bySlot: t }
    }
    let i = r.bySlot[t]
    if (!i) return null
    for (let e = i.length - 1; e >= 0; e--) {
      let t = i[e]
      if (!(t.startTick > n)) return n < t.endTick ? t : null
    }
    return null
  }
  fallOf(e, t, n) {
    return this.falls.fallOf(t, n.rig, () => this.fallStart(e, t, n))
  }
  fallStart(e, t, n) {
    let { frameTick: r, yaw: i, pitch: a, duck: o, alive: s, posX: c, posY: l, posZ: u } = e.frames,
      { numPlayers: d, tickRate: f } = e.meta,
      p = t.victimSlot,
      m = xC(r, t.startTick)
    for (let e = 0; e < Aw && m > 0 && s[m * d + p] !== 1; e++) m--
    let h = m * d + p,
      g = DS(n.rig.count)
    if (r.length === 0)
      return (
        OS(n.rig.rest, g),
        { pose: g, root: { x: t.x, y: t.y, z: t.z, yaw: 0 }, velocity: [0, 0, 0], force: [0, 0, 0], hitBone: -1 }
      )
    let _ = a[h]
    ;(_ > 180 && (_ -= 360), this.aliveInputs(e, p, r[m], i[h], _, o[h], 1 / 0), n.pose(this.inputs, g))
    let v = [0, 0, 0],
      y = (m - 1) * d + p,
      b = m > 0 ? (r[m] - r[m - 1]) / f : 0
    b > 0 &&
      b < 0.5 &&
      s[y] === 1 &&
      ((v[0] = (c[h] - c[y]) / b), (v[1] = (l[h] - l[y]) / b), (v[2] = (u[h] - u[y]) / b))
    let x = { x: t.x, y: t.y, z: t.z, yaw: i[h] * yw },
      S = e.deathRagdolls?.find((e) => e.slot === p && Math.abs(e.tick - t.startTick) <= kw)
    return S
      ? { pose: g, root: x, velocity: v, force: S.force, hitBone: S.bone }
      : { pose: g, root: x, velocity: v, ...Gw(e, t, n.rig.names, m) }
  }
  createBody(e) {
    let t = new zn()
    t.matrixAutoUpdate = !1
    let n = Hw(e.scene)
    t.add(n)
    let r = new Map(),
      i = []
    n.traverse((e) => {
      ;(e instanceof Vi && r.set(e.name, e), e instanceof Bi && i.push(e), (e.frustumCulled = !1))
    })
    let a = e.animator.rig,
      o = a.names.map((e) => r.get(e) ?? null)
    for (let e of o) e && (e.matrixAutoUpdate = !1)
    let s = i[0].skeleton
    for (let e of i)
      if (e.skeleton !== s) {
        let t = e.skeleton
        ;(e.bind(s, e.bindMatrix), t.dispose())
      }
    let c = Fy(),
      l = new Map(),
      u = (e) => {
        let t = l.get(e)
        return (t || ((t = this.lighting.createMaterial(Uw(e, c))), (t.name = e.name), l.set(e, t)), t)
      }
    for (let e of i) e.material = Array.isArray(e.material) ? e.material.map(u) : u(e.material)
    let d = this.lighting.createMaterial({ surface: `vertex`, object: c })
    this.weaponMaterials.push(d)
    let f = () => {
        let e = new G(void 0, d)
        return ((e.frustumCulled = !1), (e.visible = !1), (e.matrixAutoUpdate = !1), e)
      },
      p = (e) => {
        let t = new Rn()
        return ((t.matrixAutoUpdate = !1), t.matrix.copy(Iw), r.get(e)?.add(t), t)
      },
      m = f(),
      h = f(),
      g = { wpn: p(`wpn`), handR: p(`hand_R`) }
    ;(g.wpn.add(m), p(`hand_L`).add(h), (t.visible = !1), (t.matrixWorldAutoUpdate = !1), this.group.add(t))
    let _ = [...i, m, h]
    return {
      root: t,
      bones: o,
      skeleton: s,
      uniforms: c,
      materials: [...l.values()],
      weapon: m,
      weaponLeft: h,
      mounts: g,
      weaponFile: ``,
      parts: _,
      partMaterials: _.map((e) => e.material),
      xrayMask: Jw(),
      pose: DS(a.count),
      light: Rv(),
      litAt: new B(),
      litVersion: -1,
      shown: !1,
      posedTick: NaN,
      posedCorpse: null,
      corpsePhase: `falling`,
      corpseCenter: new B(),
      stale: !0,
    }
  }
  setWeapon(e, t) {
    let n
    t &&
      ((n = this.weapons.get(t)),
      n || ((n = { requested: !1, geometry: null, attach: new H() }), this.weapons.set(t, n)),
      n.requested || this.requestWeapon(t, n))
    let r = n?.geometry ?? null,
      i = Lw.get(t)
    if (
      ((e.weaponFile = t),
      (e.weapon.visible = r !== null),
      (e.weaponLeft.visible = r !== null && i !== void 0),
      n && r && e.weapon.geometry !== r)
    ) {
      ;((i ? e.mounts.handR : e.mounts.wpn).add(e.weapon),
        e.weapon.matrix.copy(i ? i[0] : n.attach),
        e.weaponLeft.matrix.copy(i ? i[1] : n.attach))
      for (let t of [e.weapon, e.weaponLeft]) ((t.geometry = r), (t.matrixWorldNeedsUpdate = !0))
    }
  }
  requestWeapon(e, t) {
    ;((t.requested = !0),
      tb($y(`world`, e))
        .then((n) => {
          if (this.disposed) n.dispose()
          else {
            ;((t.geometry = n), (t.attach = Rw(n)))
            for (let t of this.bodies) for (let n of t) n?.weaponFile === e && (n.stale = !0)
          }
        })
        .catch((t) => console.warn(`[csplayer] held weapon model ${e} failed to load`, t)))
  }
}
async function Bw(e) {
  let [t, { MeshoptDecoder: n }] = await Promise.all([
    mv(`weapons`, e),
    Ky(() => Promise.resolve().then(() => Q_), void 0),
  ])
  if (!t.ok) throw Error(`weapons/${e}: HTTP ${t.status}`)
  let r = await t.arrayBuffer()
  return (await n.ready, ES(r, n))
}
function Vw(e, t) {
  e.updateMatrixWorld(!0)
  let n = new Map()
  return (
    e.traverse((e) => {
      e instanceof Vi && n.set(e.name, e)
    }),
    {
      scene: e,
      animator: new eC(
        t,
        kS(t.bones, (e) => {
          let t = n.get(e)
          return t
            ? {
                parent: t.parent instanceof Vi && n.has(t.parent.name) ? t.parent.name : null,
                quaternion: t.quaternion.toArray(),
                position: t.position.toArray(),
              }
            : null
        }),
      ),
    }
  )
}
function Hw(e) {
  let t = e.clone(!0),
    n = [],
    r = []
  ;(e.traverse((e) => n.push(e)), t.traverse((e) => r.push(e)))
  let i = new Map()
  for (let e = 0; e < n.length; e++) i.set(n[e], r[e])
  for (let e = 0; e < n.length; e++) {
    let t = n[e],
      a = r[e]
    if (!(t instanceof Bi) || !(a instanceof Bi)) continue
    let o = t.skeleton,
      s = o.bones.map((e) => i.get(e))
    a.bind(new Gi(s, o.boneInverses), t.bindMatrix)
  }
  return t
}
function Uw(e, t) {
  return e instanceof Do
    ? {
        surface: `textured`,
        map: e.map ?? Ww(e.color),
        ormMap: e.aoMap ?? e.roughnessMap ?? e.metalnessMap,
        ormFactors: [1, e.roughness, e.metalness],
        normalMap: e.normalMap,
        alphaTest: e.alphaTest,
        side: e.side,
        object: t,
      }
    : { surface: `textured`, map: Ww(new U(0.5, 0.5, 0.5)), ormFactors: [1, 0.8, 0], object: t }
}
function Ww(e) {
  let t = (e) => Math.round(Math.min(1, Math.max(0, e)) * 255),
    n = new Hi(new Uint8Array([t(e.r), t(e.g), t(e.b), 255]), 1, 1)
  return ((n.needsUpdate = !0), n)
}
function Gw(e, t, n, r) {
  let i = { force: [0, 0, 0], hitBone: -1 },
    a = null
  for (let n of e.events) {
    if (n.tick > t.startTick + kw) break
    n.type === `kill` && n.victimSlot === t.victimSlot && t.startTick - n.tick <= kw && (a = n)
  }
  let o = a?.attackerSlot
  if (!a || o === void 0 || o === t.victimSlot || o < 0 || o >= e.meta.numPlayers) return i
  let s = (a.weapon ?? ``).toLowerCase(),
    c = /inferno|molotov|incgrenade|world|c4|hurt|fall/.test(s)
      ? 0
      : s.includes(`hegrenade`)
        ? Pw
        : /knife|bayonet|taser/.test(s)
          ? Nw
          : Mw,
    l = r * e.meta.numPlayers + o,
    u = t.x - e.frames.posX[l],
    d = t.y - e.frames.posY[l],
    f = Math.hypot(u, d)
  if (c === 0 || f < 1) return i
  let p = c / Math.hypot(1, Fw),
    m = n.indexOf(a.headshot ? `head_0` : `spine_2`)
  return { force: [(u / f) * p, (d / f) * p, Fw * p], hitBone: m }
}
function Kw(e, t, n, r, i) {
  let a = vw,
    o = Math.cos(i) * a,
    s = Math.sin(i) * a
  e.set(-s, 0, o, t, o, 0, s, n, 0, a, 0, r, 0, 0, 0, 1)
}
function qw(e) {
  let { q: t, t: n } = e.pose,
    r = e.bones
  for (let e = 0; e < r.length; e++) {
    let i = r[e]
    if (!i) continue
    let a = i.matrix.elements,
      o = t[e * 4],
      s = t[e * 4 + 1],
      c = t[e * 4 + 2],
      l = t[e * 4 + 3],
      u = o + o,
      d = s + s,
      f = c + c,
      p = o * u,
      m = o * d,
      h = o * f,
      g = s * d,
      _ = s * f,
      v = c * f,
      y = l * u,
      b = l * d,
      x = l * f
    ;((a[0] = 1 - (g + v)),
      (a[1] = m + x),
      (a[2] = h - b),
      (a[3] = 0),
      (a[4] = m - x),
      (a[5] = 1 - (p + v)),
      (a[6] = _ + y),
      (a[7] = 0),
      (a[8] = h + b),
      (a[9] = _ - y),
      (a[10] = 1 - (p + g)),
      (a[11] = 0),
      (a[12] = n[e * 3]),
      (a[13] = n[e * 3 + 1]),
      (a[14] = n[e * 3 + 2]),
      (a[15] = 1))
  }
}
function Jw() {
  return new To({
    uniforms: { uColor: { value: new U() }, uAlpha: { value: 0.5 } },
    toneMapped: !1,
    vertexShader: `
      #include <skinning_pars_vertex>
      void main() {
        vec3 transformed = position;
        #include <skinbase_vertex>
        #include <skinning_vertex>
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      void main() {
        gl_FragColor = vec4(uColor, uAlpha);
      }
    `,
  })
}
function Yw(e) {
  e.shown && ((e.shown = !1), (e.root.visible = !1), (e.root.matrixWorldAutoUpdate = !1))
}
function Xw(e) {
  for (let t of e.materials) {
    let e = t.uniforms.uColorMap?.value
    ;(e instanceof Hi && e.dispose(), t.dispose())
  }
  ;(e.xrayMask.dispose(), e.skeleton.dispose(), e.root.removeFromParent())
}
function Zw(e) {
  e.traverse((e) => {
    if (e instanceof G) {
      e.geometry.dispose()
      for (let t of Array.isArray(e.material) ? e.material : [e.material]) {
        if (t instanceof Do) for (let e of [t.map, t.aoMap, t.roughnessMap, t.metalnessMap, t.normalMap]) e?.dispose()
        t.dispose()
      }
    }
  })
}
var Qw = 0.1,
  $w = 1,
  eT = 1e-4
function tT() {
  return { current: { role: null, time: 0 }, previous: { role: null, time: 0 }, weight: 1 }
}
function nT(e, t, n, r) {
  let i = aT(e, t),
    a = t.idle ?? 0,
    o = (e, t) => {
      ;((e.role = a > 0 ? `idle` : null), (e.time = a > 0 ? sT(t, a) : 0))
    }
  ;((r.weight = 1), o(r.previous, n))
  let s = i[0]
  if (!s) return (o(r.current, n), r)
  let c = t[s.role],
    l = s.role === `reload` && e.reloading && c < $w
  if (s.age < c || l) {
    if ((oT(r.current, s, s.age, c, l), s.role === `draw` || s.age >= 0.1)) return r
    r.weight = cT(s.age / Qw)
    let e = i[1],
      a = e ? e.age - s.age : 1 / 0
    return (
      e && a < t[e.role]
        ? oT(r.previous, e, a, t[e.role], !1)
        : e?.role === `pullpin`
          ? iT(r.previous, a - t.pullpin, t)
          : o(r.previous, n - s.age),
      r
    )
  }
  let u = s.age - c
  return s.role === `plant`
    ? (oT(r.current, s, c, c, !1), r)
    : rT(s, e, t)
      ? (iT(r.current, u, t), t.hold !== void 0 && u < 0.1 && ((r.weight = cT(u / Qw)), oT(r.previous, s, c, c, !1)), r)
      : (o(r.current, n),
        u < 0.1 && !(s.role === `reload` && c < $w) && ((r.weight = cT(u / Qw)), oT(r.previous, s, c, c, !1)),
        r)
}
function rT(e, t, n) {
  return e.role === `pullpin` && t.pinPulled && e.age >= n.pullpin
}
function iT(e, t, n) {
  let r = n.hold
  if (r === void 0) {
    ;((e.role = `pullpin`), (e.time = n.pullpin - eT))
    return
  }
  ;((e.role = `hold`), (e.time = r > 0 ? sT(t, r) : 0))
}
function aT(e, t) {
  let n = (e) => (e === 1 && t.shoot2 ? `shoot2` : `shoot`)
  return [
    { role: `draw`, age: e.equipAge },
    { role: n(e.fireVariant), age: e.fireAge },
    { role: n(1 - e.fireVariant), age: e.prevFireAge },
    { role: `reload`, age: e.reloadAge },
    { role: `pullpin`, age: e.pinAge },
    { role: `plant`, age: e.plantAge },
  ]
    .filter((n) => Number.isFinite(n.age) && n.age >= 0 && n.age <= e.equipAge && (t[n.role] ?? 0) > 0)
    .sort((e, t) => e.age - t.age)
}
function oT(e, t, n, r, i) {
  ;((e.role = t.role), (e.time = i ? sT(n, r) : Math.min(n, r - eT)))
}
function sT(e, t) {
  return ((e % t) + t) % t
}
function cT(e) {
  let t = Math.min(1, Math.max(0, e))
  return t * t * (3 - 2 * t)
}
var lT = 0.05,
  uT = 0.25,
  dT = 2.5,
  fT = class {
    object = new zn()
    light = new Ts(16752704, 0, 1.5, 2)
    core
    flames = new zn()
    burst
    materials = []
    textures = []
    scale = new B()
    constructor() {
      let e = this.texture(yT()),
        t = this.texture(bT()),
        n = this.texture(xT()),
        r = new qr({ map: e, ...pT })
      ;(this.materials.push([r, 1]), (this.core = new si(r)), (this.core.position.x = 0.1))
      let i = this.material(t, 0.5),
        a = new po(1, 1).translate(0.5, 0, 0)
      for (let e of [0, Math.PI / 2]) {
        let t = new G(a, i)
        ;((t.rotation.x = e), this.flames.add(t))
      }
      ;((this.burst = new G(new po(1, 1).rotateY(Math.PI / 2), this.material(n, 1))),
        (this.burst.position.x = 0.08),
        this.object.add(this.flames, this.burst, this.core))
      for (let e of [this.core, ...this.flames.children, this.burst]) ((e.renderOrder = 10), (e.frustumCulled = !1))
      this.hide()
    }
    show(e, t, n, r) {
      let i = Math.min(1, Math.max(0, n / lT))
      if (i >= 1) {
        this.hide()
        return
      }
      let a = i < uT ? 1 : (1 - (i - uT) / (1 - uT)) ** 2,
        o = mT(Math.floor(r * 1e3) >>> 0),
        s = 0.85 + 0.35 * i
      ;(e.matrixWorld.decompose(this.object.position, this.object.quaternion, this.scale),
        this.object.scale.setScalar(t * s),
        (this.object.visible = !0),
        this.core.scale.setScalar(0.75 + 0.2 * o()),
        (this.flames.rotation.x = (o() * Math.PI) / 2),
        this.flames.scale.set(0.9 + 0.5 * o(), 0.45, 0.45),
        (this.burst.rotation.x = o() * Math.PI * 2),
        this.burst.scale.setScalar(0.9 + 0.3 * o()))
      for (let [e, t] of this.materials) e.opacity = t * a
      ;(this.light.position.copy(this.object.position), (this.light.intensity = dT * a))
    }
    hide() {
      ;((this.object.visible = !1), (this.light.intensity = 0))
    }
    dispose() {
      for (let [e] of this.materials) e.dispose()
      for (let e of this.textures) e.dispose()
      ;(this.flames.children.forEach((e) => e.geometry.dispose()), this.burst.geometry.dispose())
    }
    texture(e) {
      let t = new no(e)
      return ((t.colorSpace = Ye), this.textures.push(t), t)
    }
    material(e, t) {
      let n = new _i({ map: e, side: 2, ...pT })
      return (this.materials.push([n, t]), n)
    }
  },
  pT = { blending: 2, transparent: !0, depthTest: !1, depthWrite: !1, toneMapped: !1 }
function mT(e) {
  let t = e
  return () => {
    t = (t + 1831565813) | 0
    let e = Math.imul(t ^ (t >>> 15), 1 | t)
    return ((e = (e + Math.imul(e ^ (e >>> 7), 61 | e)) ^ e), ((e ^ (e >>> 14)) >>> 0) / 4294967296)
  }
}
function hT(e, t) {
  let n = document.createElement(`canvas`)
  ;((n.width = e), (n.height = t))
  let r = n.getContext(`2d`)
  return ((r.globalCompositeOperation = `lighter`), [n, r])
}
function gT(e, t, n, r, i, a, o) {
  ;(e.save(), e.translate(t, n), e.rotate(a), e.scale(r, i))
  let s = e.createRadialGradient(0, 0, 0, 0, 0, 1)
  for (let [e, t] of o) s.addColorStop(e, t)
  ;((e.fillStyle = s), e.beginPath(), e.arc(0, 0, 1, 0, Math.PI * 2), e.fill(), e.restore())
}
var _T = [
    [0, `rgba(255,250,235,0.9)`],
    [0.35, `rgba(255,200,110,0.55)`],
    [1, `rgba(255,110,20,0)`],
  ],
  vT = [
    [0, `rgba(255,190,90,0.6)`],
    [0.5, `rgba(255,130,40,0.25)`],
    [1, `rgba(255,80,10,0)`],
  ]
function yT() {
  let [e, t] = hT(64, 64)
  return (
    gT(t, 32, 32, 32, 32, 0, [
      [0, `rgba(255,255,255,1)`],
      [0.15, `rgba(255,246,215,0.9)`],
      [0.4, `rgba(255,190,90,0.35)`],
      [1, `rgba(255,120,30,0)`],
    ]),
    e
  )
}
function bT() {
  let [e, t] = hT(128, 64)
  for (let [e, n, r, i] of [
    [14, 0, 26, 22],
    [40, -3, 28, 16],
    [66, 4, 26, 12],
    [90, -2, 22, 8],
    [110, 1, 16, 5],
  ])
    gT(t, e, 32 + n, r, i, 0, e < 50 ? _T : vT)
  return e
}
function xT() {
  let [e, t] = hT(128, 128),
    n = [1, 0.75, 0.9, 0.65, 0.85]
  return (
    n.forEach((e, r) => {
      let i = (r / n.length) * Math.PI * 2 + (r % 2) * 0.2,
        a = 30 * e
      gT(t, 64 + Math.cos(i) * a, 64 + Math.sin(i) * a, 34 * e, 9, i, vT)
    }),
    gT(t, 64, 64, 30, 30, 0, _T),
    e
  )
}
var ST = Math.tan((34 * Math.PI) / 180)
function CT(e) {
  return (2 * Math.atan(ST / Math.min(e, 4 / 3)) * 180) / Math.PI
}
var wT = Math.PI / 180,
  TT = 0.0254,
  ET = [2.5, 0, -1.5],
  DT = 250,
  OT = 147,
  kT = new H().makeRotationFromQuaternion(new Ht(-0.5, -0.5, -0.5, 0.5)).invert(),
  AT = [`draw`, `idle`, `shoot`, `shoot2`, `reload`, `pullpin`, `hold`, `plant`],
  jT = 400,
  MT = 1.4,
  NT = 0.09,
  PT = 120,
  FT = 520,
  IT = 0.16,
  LT = new Set([
    `cz75a`,
    `deagle`,
    `elite`,
    `fiveseven`,
    `glock`,
    `hkp2000`,
    `p250`,
    `revolver`,
    `tec9`,
    `usp_silencer`,
  ]),
  RT = new Set([`awp`, `ssg08`, `g3sg1`, `scar20`, `nova`, `xm1014`, `sawedoff`, `mag7`]),
  zT = /^(knife|taser$|c4$|decoy$|flashbang$|hegrenade$|incgrenade$|molotov$|smokegrenade$)/,
  BT = new Set([`m4a1_silencer`, `usp_silencer`, `mp5sd`]),
  VT = 60,
  HT = 1.5,
  UT = class {
    scene = new Jn()
    camera = new xs(CT(4 / 3), 4 / 3, 0.01, 10)
    root = new zn()
    container = new zn()
    flash = new fT()
    rigs = new Map()
    arms = null
    shown = null
    motion = bC()
    anim = tT()
    matrix = new H()
    quaternion = new Ht()
    identity = new Ht()
    disposed = !1
    lighting
    objectUniforms = Fy()
    light = Rv()
    flashColor = new U()
    flashOffset = new B()
    foleyPose = null
    constructor(e) {
      ;((this.lighting = e),
        (this.container.rotation.y = Math.PI),
        this.container.position.set(ET[0] * TT, ET[2] * TT, -ET[1] * TT),
        this.root.add(this.container),
        (this.root.visible = !1),
        this.scene.add(this.root, this.flash.object, this.camera))
    }
    update(e) {
      let { data: t } = e,
        n = SC(t, e.slot, e.tick, this.motion),
        r = t.panelFrames.team.length ? t.panelFrames.team[this.panelFrame(e) * t.meta.numPlayers + e.slot] : 0,
        i = n.weapon ? Qy(n.weapon, r) : void 0,
        a = i ? this.rigFor(i).value : null,
        o = this.armsRig().value
      if (!i || !a || !o) return (this.hide(), !1)
      ;(this.shown !== a &&
        (this.shown && this.container.remove(this.shown.scene), this.container.add(a.scene, o.scene), (this.shown = a)),
        this.camera.aspect !== e.aspect &&
          ((this.camera.aspect = e.aspect), (this.camera.fov = CT(e.aspect)), this.camera.updateProjectionMatrix()))
      let s = e.tick / t.meta.tickRate
      this.poseRoot(n, e)
      let c = nT(n, a.clips, s, this.anim)
      this.animate(a, c)
      let l = c.current.role
      return (
        (this.foleyPose = l ? { file: i, role: l, time: c.current.time, duration: a.clips[l] ?? 0 } : null),
        this.poseArms(a, o),
        this.poseFlash(n, i, a, e.tick / t.meta.tickRate - n.fireAge),
        this.applyLighting(e.camera),
        (this.root.visible = !0),
        !0
      )
    }
    applyLighting(e) {
      let t = this.lighting
      t.setView(e)
      let n = t.view.uViewOrigin.value
      Iy(this.objectUniforms, t.sample(n.x, n.y, n.z, this.light))
      let r = this.flash.light,
        i = this.objectUniforms.uFlashPos.value
      if (r.intensity <= 0) {
        i.w = 0
        return
      }
      let a = this.flashColor.copy(r.color).multiplyScalar(r.intensity * HT)
      this.objectUniforms.uFlashColor.value.set(a.r, a.g, a.b)
      let o = this.flashOffset
        .copy(r.position)
        .multiplyScalar(t.view.uViewScale.value)
        .applyMatrix3(t.view.uViewToWorld.value)
      i.set(n.x + o.x, n.y + o.y, n.z + o.z, VT)
    }
    hide() {
      ;((this.root.visible = !1), (this.foleyPose = null), this.flash.hide())
    }
    render(e) {
      if (!this.root.visible) return
      let t = e.autoClear
      e.autoClear = !1
      try {
        ;(e.clearDepth(), e.render(this.scene, this.camera))
      } finally {
        e.autoClear = t
      }
    }
    dispose() {
      ;((this.disposed = !0), this.flash.dispose())
      for (let { value: e } of this.rigs.values()) e && (e.mixer.stopAllAction(), JT(e.scene))
      ;(this.arms?.value && JT(this.arms.value.scene), this.rigs.clear())
    }
    panelFrame(e) {
      let t = e.data.panelFrames.frameTick,
        n = 0,
        r = t.length - 1
      if (r < 0 || e.tick <= t[0]) return 0
      for (; n < r;) {
        let i = (n + r + 1) >> 1
        t[i] <= e.tick ? (n = i) : (r = i - 1)
      }
      return n
    }
    poseRoot(e, t) {
      let n = Math.min(1, e.speed / DT) * (1 - 0.5 * t.duck),
        r = (e.distance / OT) * Math.PI * 2,
        i = Math.tanh(e.yawRate / 360),
        a = -0.9 * Math.tanh(e.verticalSpeed / jT),
        o = Math.min(1, Math.max(0, (e.landSpeed - PT) / (FT - PT))),
        s = e.landAge / NT,
        c = Number.isFinite(s) ? MT * o * s * Math.exp(1 - s) : 0
      ;(this.root.position.set(
        (0.45 * n * Math.sin(r) + 1.2 * i) * TT,
        (-0.35 * n * Math.abs(Math.cos(r)) + a - c) * TT,
        0,
      ),
        this.root.rotation.set((0.6 * a - 0.8 * c) * wT, -3 * i * wT, 0))
    }
    animate(e, t) {
      for (let [n, [r, i]] of e.actions)
        (KT(r, n === t.current.role ? t.weight : 0, t.current.time),
          KT(i, n === t.previous.role ? 1 - t.weight : 0, t.previous.time))
      ;(e.mixer.update(0),
        this.root.updateMatrixWorld(!0),
        this.matrix.copy(e.scene.matrixWorld).invert().multiply(e.wpn.matrixWorld).multiply(kT),
        e.weaponRig.matrix.copy(this.matrix),
        e.weaponRig.updateMatrixWorld(!0))
    }
    poseArms(e, t) {
      for (let [n, r] of e.driven) {
        let e = t.bones.get(n)
        e && (e.position.copy(r.position), e.quaternion.copy(r.quaternion), e.scale.copy(r.scale))
      }
      for (let e of t.twists) {
        let t = this.quaternion.copy(e.hand.quaternion).multiply(e.handRestInverse)
        ;(t.set(t.x, 0, 0, t.w).normalize(), e.bone.quaternion.copy(this.identity).slerp(t, e.amount).multiply(e.rest))
      }
    }
    poseFlash(e, t, n, r) {
      let i = e.fireVariant === 1 && n.clips.shoot2 !== void 0,
        a = n.muzzles[+!!i]
      if (!a || zT.test(t) || BT.has(t) || !(e.fireAge < 0.05)) {
        this.flash.hide()
        return
      }
      let o = IT * (LT.has(t) ? 0.75 : RT.has(t) ? 1.25 : 1)
      this.flash.show(a, o, e.fireAge, r)
    }
    rigFor(e) {
      let t = this.rigs.get(e)
      if (t) return t
      let n = { value: null }
      return (
        this.rigs.set(e, n),
        this.load(e, (e) => {
          n.value = WT(e)
        }),
        n
      )
    }
    armsRig() {
      if (this.arms) return this.arms
      let e = { value: null }
      return (
        (this.arms = e),
        this.load(`arms`, (t) => {
          e.value = GT(t)
        }),
        e
      )
    }
    load(e, t) {
      rb($y(`fp`, e))
        .then((e) => {
          ;(this.useWeaponMaterials(e.scene), this.disposed ? JT(e.scene) : t(e))
        })
        .catch((t) => console.warn(`[csplayer] viewmodel ${e} failed to load`, t))
    }
    useWeaponMaterials(e) {
      let t = new Map(),
        n = (e) => {
          if (!(e instanceof Do)) return e
          let n = t.get(e)
          if (!n) {
            let r = e.aoMap ?? e.roughnessMap ?? e.metalnessMap
            ;((n = this.lighting.createMaterial({
              surface: `textured`,
              viewSpace: !0,
              map: e.map,
              ormMap: r,
              ormFactors: [1, e.roughness, e.metalness],
              normalMap: e.normalMap,
              alphaTest: e.alphaTest,
              side: e.side,
              object: this.objectUniforms,
            })),
              (n.name = e.name),
              t.set(e, n),
              e.dispose())
          }
          return n
        }
      e.traverse((e) => {
        e instanceof G && (e.material = Array.isArray(e.material) ? e.material.map(n) : n(e.material))
      })
    }
  }
function WT(e) {
  let { scene: t } = e
  qT(t)
  let n = YT(t, `viewmodel`),
    r = YT(t, `weapon_rig`)
  r.matrixAutoUpdate = !1
  let i = new $s(t),
    a = new Map(),
    o = {}
  for (let t of e.animations) {
    let e = t.name
    !AT.includes(e) ||
      (t.duration <= 0 && e !== `hold`) ||
      ((o[e] = t.duration), a.set(e, [i.clipAction(t), i.clipAction(t.clone())]))
  }
  let s = new Map()
  n.traverse((e) => {
    e !== n && s.set(e.name, e)
  })
  let c = (e) => r.getObjectByName(e) ?? null
  return {
    scene: t,
    mixer: i,
    actions: a,
    clips: o,
    weaponRig: r,
    wpn: YT(n, `wpn`),
    muzzles: [c(`muzzle`) ?? c(`muzzle_l`), c(`muzzle_r`)],
    driven: s,
  }
}
function GT(e) {
  qT(e.scene)
  let t = new Map()
  e.scene.traverse((e) => t.set(e.name, e))
  let n = []
  for (let e of [`L`, `R`]) {
    let r = t.get(`hand_${e}`)
    if (r)
      for (let [i, a] of [
        [`arm_lower_${e}_TWIST1`, 0.5],
        [`arm_lower_${e}_TWIST`, 0.25],
      ]) {
        let e = t.get(i)
        e &&
          n.push({
            bone: e,
            rest: e.quaternion.clone(),
            hand: r,
            handRestInverse: r.quaternion.clone().invert(),
            amount: a,
          })
      }
  }
  return { scene: e.scene, bones: t, twists: n }
}
function KT(e, t, n) {
  if (t <= 0) {
    e.isRunning() && e.stop()
    return
  }
  ;((e.enabled = !0), e.setEffectiveWeight(t), e.isRunning() || e.play(), (e.time = n))
}
function qT(e) {
  e.traverse((e) => {
    e instanceof G && (e.frustumCulled = !1)
  })
}
function JT(e) {
  e.traverse((e) => {
    if (e instanceof G) {
      e.geometry.dispose()
      for (let t of Array.isArray(e.material) ? e.material : [e.material]) {
        if (t instanceof To) for (let e of [`uColorMap`, `uOrmMap`, `uNormalMap`]) t.uniforms[e]?.value?.dispose()
        t.dispose()
      }
    }
  })
}
function YT(e, t) {
  let n = e.getObjectByName(t)
  if (!n) throw Error(`viewmodel rig has no ${t}`)
  return n
}
var J = Math.fround,
  XT = J(Math.PI / 180)
function ZT(e) {
  let t = J(J(e) * XT)
  return [J(Math.cos(t)), J(Math.sin(t)), 0]
}
function QT(e) {
  return e.map((t, n) => {
    if (t.state === 3) return { ...t, edgeMask: 0 }
    let r = Math.max(60, t.radius),
      i = 0
    for (let a = 0; a < 15; a++) {
      let o = ZT(a * 24),
        s = [J(t.position[0] + J(r * o[0])), J(t.position[1] + J(r * o[1])), t.position[2]],
        c = -1,
        l = 1 / 0
      for (let t = 0; t < e.length; t++) {
        let n = e[t]
        if (n.state === 3) continue
        let r = s.map((e, t) => J(e - n.position[t])),
          i = J(J(J(r[0] * r[0]) + J(r[1] * r[1])) + J(r[2] * r[2]))
        i < l && ((l = i), (c = t))
      }
      c === n && (i |= 1 << a)
    }
    return { ...t, edgeMask: i }
  })
}
function $T(e) {
  let t = Math.max(1, Math.abs(e)),
    n = new Int32Array(32),
    r = () => ((t = (t * 16807) % 2147483647), t)
  for (let e = 39; e >= 0; e--) (r(), e < 32 && (n[e] = t))
  let i = n[0]
  return () => {
    r()
    let e = i >>> 26
    ;((i = n[e]), (n[e] = t))
    let a = Math.min(1 - 2 ** -23, J(J(i) * J(2 ** -31)))
    return J(J(J(J(0.65) - J(0.1)) * J(a ** J(0.9))) + J(0.1))
  }
}
function eE(e, t) {
  let n = t.map((e) => Math.floor(J(e * J(1 / 30)))),
    r = (n[0] & 31) + (n[1] & 31) * 32 + (n[2] & 3) * 1024
  return e.has(r) ? !1 : (e.add(r), !0)
}
function tE(e, t) {
  let n = [],
    r = [],
    i = new Set(),
    a = new Set()
  for (let o = t.length - 1; o >= 0; o--) {
    let s = t[o],
      c = s.position.map((t, n) => J(t - e[n])),
      l = s.parent.map((t, n) => J(t - e[n])),
      u = c.map((e, t) => J(e - l[t])),
      d = Math.hypot(...u),
      f = d > 0 ? u.map((e) => J(e / d)) : [0, 0, 0],
      p = Math.max(60, s.radius),
      m = $T(s.index),
      h = s.state !== 3 && s.traceFractions.every((e) => e >= 1)
    for (let e = 0; e < 15; e++) {
      let t = Math.min(p, J(s.fillerFractions[e] * s.targetRadius)),
        o = J(J(Math.sqrt(m())) * t),
        l = ZT(e * 24),
        u = [J(c[0] + J(l[0] * o)), J(c[1] + J(l[1] * o)), c[2]],
        d = 1e30
      for (let e of s.planes) {
        let t = u.map((t, n) => J(t * e[n]))
        d = Math.min(d, J(J(t[0] + t[1]) + J(t[2] + e[3])))
      }
      let g = !1
      s.state !== 3 &&
        d > 10 &&
        (g =
          eE(i, u) ||
          eE(a, [J(J(u[1] * J(0.71)) - J(u[0] * J(0.7))), J(J(u[1] * J(0.72)) + J(u[0] * J(0.715))), J(u[2] + 35)]))
      let _ = g
        ? {
            patchIndex: s.index,
            spoke: e,
            part: 0,
            position: u,
            direction: f,
            radius: p,
            fraction: s.fillerFractions[e],
            clearance: Math.min(d, J(t - o)),
          }
        : null
      ;(n.push(_),
        r.push(
          h
            ? e === 0
              ? {
                  patchIndex: s.index,
                  spoke: e,
                  part: 0,
                  position: c,
                  direction: f,
                  radius: p,
                  fraction: 1,
                  clearance: p,
                }
              : null
            : _,
        ))
    }
  }
  return { interior: n, base: r }
}
function nE(e, t) {
  let n = []
  for (let r of t) {
    if (r.state === 3) continue
    let t = r.position.map((t, n) => J(t - e[n])),
      i = Math.max(60, r.radius)
    for (let e = 0; e < 15; e++) {
      if (!(r.edgeMask & (1 << e))) continue
      let a = Math.min(i, J(r.traceFractions[e] * r.targetRadius))
      for (let o = 0; o < 2; o++) {
        let s = ZT(o === 0 ? e * 24 : (e * 2 - 1) * 12)
        n.push({
          patchIndex: r.index,
          spoke: e,
          part: o,
          radius: i,
          direction: s,
          fraction: r.traceFractions[e],
          clearance: a,
          position: [J(t[0] + J(s[0] * a)), J(t[1] + J(s[1] * a)), J(t[2] + 40)],
        })
      }
    }
  }
  return n
}
var rE = Math.fround,
  iE = 70
function aE(e) {
  if (e !== 0 && e !== 1) throw Error(`Unsupported inferno type`)
  return e === 0 ? [70, 90] : [50, 70]
}
function oE(e) {
  let t = new gi(),
    n = new gi(),
    r = new B(),
    i = new B(),
    a = new B(),
    o = e.map(({ tree: e, matrixWorld: t }) => ({
      tree: e,
      matrixWorld: t,
      inverse: t.equals(new H()) ? null : t.clone().invert(),
      normalMatrix: new V().getNormalMatrix(t),
    }))
  return (e, s) => {
    ;(t.origin.fromArray(e), t.direction.copy(r.fromArray(s)).sub(t.origin))
    let c = t.direction.length()
    if (c < 1e-6) return null
    t.direction.multiplyScalar(1 / c)
    let l = c,
      u = !1
    for (let e of o) {
      if (!e.inverse) {
        let n = e.tree.raycastFirst(t, 2, 0.001, l)
        if (!n?.face || n.distance >= l) continue
        ;((l = n.distance), i.copy(n.point), a.copy(n.face.normal), (u = !0))
        continue
      }
      n.copy(t).applyMatrix4(e.inverse)
      let r = n.direction.length()
      n.direction.multiplyScalar(1 / r)
      let o = e.tree.raycastFirst(n, 2, 0.001 * r, l * r)
      if (!o?.face) continue
      let s = o.point.clone().applyMatrix4(e.matrixWorld),
        c = s.distanceTo(t.origin)
      c >= l || ((l = c), i.copy(s), a.copy(o.face.normal).applyMatrix3(e.normalMatrix).normalize(), (u = !0))
    }
    if (!u) return null
    let d = a.clone()
    return (
      d.dot(t.direction) > 0 && d.negate(),
      { fraction: rE(l / c), position: i.toArray().map(rE), normal: d.toArray().map(rE) }
    )
  }
}
function sE(e, t, n, r = !1) {
  let i = Math.max(60, t.radius),
    a = t.targetRadius,
    o = t.position,
    s = n([o[0], o[1], o[2] + 0.01], [o[0], o[1], o[2] + 60]),
    c = s?.fraction ?? 1,
    l = [],
    u = [],
    d = []
  for (let t = 0; t < 15; t++) {
    let f = ZT(t * 24),
      p = [o[0], o[1], rE(o[2] + 30 + (r && s ? c * 30 : 0))],
      m = n(p, [rE(p[0] + rE(f[0] * a)), rE(p[1] + rE(f[1] * a)), rE(p[2] + (r ? Math.max(0.5, c) * 30 : 0))])
    if (!m) {
      ;(l.push(1), u.push(rE(1 - rE(10 / i))))
      continue
    }
    r = !0
    let h = m.normal,
      g = rE(-rE(rE(h[0] * f[0]) + rE(h[1] * f[1])) * a),
      _ = (e) => (g > 0 ? rE(Math.max(0, rE(m.fraction - rE(e / g)))) : 0)
    ;(l.push(_(5)), u.push(_(10)))
    let v = rE(m.fraction * a),
      y = [rE(rE(o[0] - e[0]) + rE(f[0] * v)), rE(rE(o[1] - e[1]) + rE(f[1] * v)), rE(o[2] - e[2])],
      b = -rE(rE(rE(y[0] * h[0]) + rE(y[1] * h[1])) + rE(y[2] * h[2]))
    !d.some((e) => h.every((t, n) => Math.abs(t - e[n]) < 1e-5) && Math.abs(b - e[3]) < 0.01) &&
      d.length < 12 &&
      d.push([...h, b])
  }
  return { patch: { ...t, traceFractions: l, fillerFractions: u, planes: d }, raised: r }
}
function cE(e, t) {
  let n = t([e[0], e[1], e[2] + 0.05], [e[0], e[1], e[2] + 40]),
    r = n ? Math.max(e[2] + 0.01, n.position[2] - 0.05) : e[2] + 40,
    i = t([e[0], e[1], r], [e[0], e[1], e[2] - 70]),
    a = i && i.normal[2] >= 0.25 ? i : null,
    o = t([e[0], e[1], e[2] + iE], [e[0], e[1], e[2] + 0.01]),
    s = o && o.normal[2] >= 0.25 ? o : null
  return s ? (a ? (s.position[2] - e[2] < e[2] - a.position[2] ? s : a) : s) : a
}
function lE(e, t = 0) {
  if (!e || t + 3 > e.length) return null
  let n = [e[t], e[t + 1], e[t + 2]]
  return n.every(Number.isFinite) ? n : null
}
