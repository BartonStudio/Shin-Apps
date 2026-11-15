// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 38344–39079 行（切片 21/40）
// 角色：爆炸/闪光效果 cD：begin/show/end/blast
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var cD = class {
  pool = []
  geometry = new fo(1, 3)
  scene = new Jn()
  shared = {
    uDepth: { value: null },
    uResolution: { value: new z(1, 1) },
    uNear: { value: 1 },
    uFar: { value: 1e3 },
    uForward: { value: new B(0, 0, -1) },
    uPixelAngle: { value: 0.001 },
  }
  light = new Ts(16777215, 0, tD.lightRange, 1)
  used = 0
  lightLevel = 0
  hasDepth = !1
  constructor(e) {
    e.add(this.light)
    for (let e = 0; e < $E; e++) {
      let e = new To({
          uniforms: {
            ...this.shared,
            uCenter: { value: new B() },
            uRadius: { value: 0 },
            uWidth: { value: 0 },
            uRingAlpha: { value: 0 },
            uEcho: { value: 0 },
            uEchoAlpha: { value: 0 },
            uShellAlpha: { value: 0 },
            uVeilAlpha: { value: 0 },
            uGlow: { value: 0 },
            uGlowRadius: { value: 1 },
            uGlowLift: { value: 0 },
            uCoreGain: { value: 0 },
            uHaloGain: { value: 0 },
            uWaveColor: { value: new B() },
            uCoreColor: { value: new B() },
            uHaloColor: { value: new B() },
          },
          vertexShader: rD,
          fragmentShader: iD,
          side: 1,
          transparent: !0,
          depthTest: !1,
          depthWrite: !1,
          premultipliedAlpha: !0,
        }),
        t = new G(this.geometry, e)
      ;((t.visible = !1), (t.frustumCulled = !1), this.scene.add(t), this.pool.push({ mesh: t, material: e }))
    }
  }
  begin() {
    ;((this.used = 0), (this.lightLevel = 0))
  }
  show(e, t, n = tD) {
    if (this.used >= this.pool.length) return !1
    let { mesh: r, material: i } = this.pool[this.used++],
      a = i.uniforms,
      o = sD(n, t),
      s = o / n.waveRadius
    ;(a.uCenter.value.set(e.x, e.y, e.z),
      (a.uRadius.value = o),
      (a.uWidth.value = n.ringWidth[0] + (n.ringWidth[1] - n.ringWidth[0]) * s),
      (a.uRingAlpha.value = n.ringAlpha * dD(0, 0.02, t) * (1 - dD(n.waveSeconds * 0.25, n.waveSeconds, t))))
    let c = t - n.echoDelay
    ;((a.uEcho.value = 0.75 * n.waveRadius * lD(uD(c / n.echoSeconds))),
      (a.uEchoAlpha.value = n.echoAlpha * dD(0, 0.02, c) * (1 - dD(n.echoSeconds * 0.2, n.echoSeconds, c))))
    let l = dD(0.03, 0.1, t) * (1 - dD(0.1, n.shellFadeSeconds, t))
    ;((a.uShellAlpha.value = n.shellAlpha * l), (a.uVeilAlpha.value = n.veilAlpha * l))
    let u = oD(n, t),
      d = n.glowRadius * (1 + t * 2)
    ;((a.uGlow.value = u),
      (a.uGlowRadius.value = d),
      (a.uGlowLift.value = n.glowLift),
      (a.uCoreGain.value = n.coreGain),
      (a.uHaloGain.value = n.haloGain),
      a.uWaveColor.value.fromArray(n.waveColor),
      a.uCoreColor.value.fromArray(n.coreColor),
      a.uHaloColor.value.fromArray(n.haloColor))
    let f = Math.max(o + 6, n.glowLift + 5 * d)
    ;(r.position.set(e.x, e.y, e.z), r.scale.setScalar(f * eD), (r.visible = !0))
    let p = u * n.lightIntensity
    return (
      p > this.lightLevel &&
        ((this.lightLevel = p),
        this.light.position.set(e.x, e.y, e.z + n.lightLift),
        this.light.color.setHex(n.lightColor),
        (this.light.distance = n.lightRange)),
      !0
    )
  }
  end() {
    for (let e = this.used; e < this.pool.length; e++) this.pool[e].mesh.visible = !1
    ;((this.light.intensity = this.lightLevel), (this.hasDepth = !1))
  }
  get needsDepth() {
    return this.used > 0
  }
  applySceneDepth(e, t, n) {
    ;((this.shared.uDepth.value = e),
      this.shared.uResolution.value.copy(n),
      (this.shared.uNear.value = t.near),
      (this.shared.uFar.value = t.far),
      t.getWorldDirection(this.shared.uForward.value),
      (this.shared.uPixelAngle.value = (2 * Math.tan(Vt.degToRad(t.fov) / 2)) / Math.max(1, n.y)),
      (this.hasDepth = !0))
  }
  render(e, t) {
    if (this.used === 0 || !this.hasDepth) return
    let n = e.autoClear
    e.autoClear = !1
    try {
      e.render(this.scene, t)
    } finally {
      e.autoClear = n
    }
  }
  get activeCount() {
    return this.pool.filter(({ mesh: e }) => e.visible).length
  }
  dispose() {
    ;(this.light.removeFromParent(), this.light.dispose())
    for (let { material: e } of this.pool) e.dispose()
    this.geometry.dispose()
  }
}
function lD(e) {
  return 1 - (1 - e) ** 3
}
function uD(e) {
  return Math.min(1, Math.max(0, e))
}
function dD(e, t, n) {
  let r = uD((n - e) / (t - e))
  return r * r * (3 - 2 * r)
}
var fD = Math.PI / 360
function pD(e, t) {
  let n = 0,
    r = e.length - 1
  if (r <= 0 || t <= e[0]) return 0
  if (t >= e[r]) return r
  for (; n < r;) {
    let i = (n + r + 1) >> 1
    e[i] <= t ? (n = i) : (r = i - 1)
  }
  return n
}
function mD(e, t, n, r) {
  let i = Math.cos(n * fD),
    a = Math.sin(n * fD),
    o = Math.cos(e * fD),
    s = Math.sin(e * fD),
    c = Math.cos(t * fD),
    l = Math.sin(t * fD)
  ;((r.qx = a * o * c - i * s * l),
    (r.qy = i * s * c + a * o * l),
    (r.qz = i * o * l - a * s * c),
    (r.qw = i * o * c + a * s * l))
}
function hD(e, t, n) {
  let r = pD(e.ticks, t),
    i = Math.min(r + 1, e.ticks.length - 1),
    a = e.ticks[i] - e.ticks[r],
    o = a > 0 ? Math.min(1, Math.max(0, (t - e.ticks[r]) / a)) : 0,
    s = e.posXYZ,
    c = r * 3,
    l = i * 3
  ;((n.x = s[c] + (s[l] - s[c]) * o),
    (n.y = s[c + 1] + (s[l + 1] - s[c + 1]) * o),
    (n.z = s[c + 2] + (s[l + 2] - s[c + 2]) * o))
  let u = e.angles
  if (!u || u.length !== e.ticks.length * 3) {
    ;((n.qx = 0), (n.qy = 0), (n.qz = 0), (n.qw = 1))
    return
  }
  if ((mD(u[c], u[c + 1], u[c + 2], n), o === 0 || i === r)) return
  let d = n.qx,
    f = n.qy,
    p = n.qz,
    m = n.qw
  ;(mD(u[l], u[l + 1], u[l + 2], n), gD(d, f, p, m, n, o))
}
function gD(e, t, n, r, i, a) {
  let o = i.qx,
    s = i.qy,
    c = i.qz,
    l = i.qw,
    u = e * o + t * s + n * c + r * l
  u < 0 && ((u = -u), (o = -o), (s = -s), (c = -c), (l = -l))
  let d, f
  if (u > 0.9995) ((d = 1 - a), (f = a))
  else {
    let e = Math.acos(u),
      t = Math.sin(e)
    ;((d = Math.sin((1 - a) * e) / t), (f = Math.sin(a * e) / t))
  }
  let p = e * d + o * f,
    m = t * d + s * f,
    h = n * d + c * f,
    g = r * d + l * f,
    _ = Math.hypot(p, m, h, g) || 1
  ;((i.qx = p / _), (i.qy = m / _), (i.qz = h / _), (i.qw = g / _))
}
function _D(e, t, n) {
  switch (e) {
    case `smoke`:
      return `smokegrenade`
    case `he`:
      return `hegrenade`
    case `flash`:
      return `flashbang`
    case `decoy`:
      return `decoy`
    case `molotov`:
      return (t ?? n) ? `incgrenade` : `molotov`
  }
}
var vD = 64,
  yD = 5 * vD,
  bD = { 2: 14722342, 3: 7189490, neutral: 10133674 },
  xD = { smoke: 13684944, he: 16735067, flash: 16772744, molotov: 16742959, decoy: 6741384 },
  SD = 6,
  CD = class {
    scene
    data
    teamOf
    group = new zn()
    lines = []
    markers
    markerColor = new U()
    dummy = new Rn()
    modelsEnabled = !1
    disposed = !1
    models = new Map()
    lighting
    modelMaterial
    modelMeshes = []
    pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
    fire
    blasts
    tickRate
    markerCapacity
    trajectoryVisibility = `all`
    followedSlot = -1
    selectedGrenade = -1
    constructor(e, t, n, r, i = vD) {
      ;((this.scene = e),
        (this.lighting = r),
        (this.modelMaterial = r.createMaterial({ surface: `vertex` })),
        (this.data = t),
        (this.teamOf = n),
        (this.tickRate = i),
        (this.fire = new QE(e, t.infernos ?? [], i)),
        (this.blasts = new cD(this.group)))
      for (let e of t.trajectories) this.addTrajectory(e)
      this.markerCapacity = 48
      let a = new mo(SD, 8, 6),
        o = new _i()
      ;((this.markers = new ea(a, o, this.markerCapacity)),
        (this.markers.instanceColor = new Ki(new Float32Array(this.markerCapacity * 3), 3)),
        (this.markers.frustumCulled = !1),
        (this.markers.count = 0),
        this.group.add(this.markers),
        e.add(this.group))
    }
    setData(e) {
      let t = 0
      for (; t < this.lines.length && t < e.trajectories.length;) {
        let n = this.lines[t].traj,
          r = e.trajectories[t]
        if (
          n.kind !== r.kind ||
          n.throwerSlot !== r.throwerSlot ||
          n.startTick !== r.startTick ||
          n.endTick !== r.endTick ||
          n.detonationTick !== r.detonationTick ||
          n.ticks.length !== r.ticks.length ||
          n.ticks[0] !== r.ticks[0] ||
          n.ticks[n.ticks.length - 1] !== r.ticks[r.ticks.length - 1] ||
          n.posXYZ[0] !== r.posXYZ[0] ||
          n.posXYZ[n.posXYZ.length - 1] !== r.posXYZ[r.posXYZ.length - 1] ||
          n.angles?.length !== r.angles?.length ||
          n.incendiary !== r.incendiary
        )
          break
        t++
      }
      for (; this.lines.length > t;) {
        let e = this.lines.pop()
        ;(this.group.remove(e.line), e.line.geometry.dispose(), e.material.dispose())
      }
      for (let n = t; n < e.trajectories.length; n++) this.addTrajectory(e.trajectories[n])
      ;((this.data = e), this.fire.setData(e.infernos ?? []))
    }
    addTrajectory(e) {
      let t = new Vr()
      t.setAttribute(`position`, new W(e.posXYZ, 3))
      let n = e.throwerSlot >= 0 ? this.teamOf(e.throwerSlot, e.startTick) : 0,
        r = new ja({ color: bD[n] ?? bD.neutral, transparent: !0, opacity: 1 }),
        i = new za(t, r)
      ;((i.visible = !1), (i.frustumCulled = !1), this.group.add(i))
      let a = _D(e.kind, e.incendiary, n === 3)
      ;(this.lines.push({ traj: e, line: i, material: r, modelFile: a }), this.modelsEnabled && this.requestModel(a))
    }
    setModelsEnabled(e) {
      if (((this.modelsEnabled = e), e)) for (let { modelFile: e } of this.lines) this.requestModel(e)
    }
    requestModel(e) {
      let t = this.models.get(e)
      if ((t || ((t = { requested: !1, geometry: null }), this.models.set(e, t)), t.requested)) return
      t.requested = !0
      let n = t
      tb($y(`world`, e))
        .then((e) => {
          this.disposed ? e.dispose() : (n.geometry = e)
        })
        .catch((t) => console.warn(`[csplayer] grenade model ${e} failed to load`, t))
    }
    modelMesh(e) {
      let t = this.modelMeshes[e]
      if (!t) {
        let e = new G(void 0, this.modelMaterial)
        e.frustumCulled = !1
        let n = Rv()
        ;((e.onBeforeRender = () => {
          ;(Iy(this.modelMaterial.uniforms, n), (this.modelMaterial.uniformsNeedUpdate = !0))
        }),
          this.group.add(e),
          (t = { mesh: e, light: n }),
          this.modelMeshes.push(t))
      }
      return t
    }
    update(e, t) {
      ;(this.updateTrajectoriesAndMarkers(e), this.updateEffects(e), this.fire.update(e, t))
    }
    setMapObject(e) {
      this.fire.setMapObject(e)
    }
    setMolotovGraphics(e) {
      this.fire.setGraphics(e)
    }
    setTrajectoryVisibility(e, t, n) {
      ;((this.trajectoryVisibility = e), (this.followedSlot = t), (this.selectedGrenade = n))
    }
    debugFireCounts() {
      return this.fire.debugCounts()
    }
    get blastsNeedDepth() {
      return this.blasts.needsDepth
    }
    applyBlastDepth(e, t, n) {
      this.blasts.applySceneDepth(e, t, n)
    }
    renderBlasts(e, t) {
      this.blasts.render(e, t)
    }
    get blastScene() {
      return this.blasts.scene
    }
    get fireShaderPrototypes() {
      return this.fire.shaderPrototypes
    }
    debugCounts() {
      return {
        lines: this.lines.filter((e) => e.line.visible).length,
        fires: this.fire.debugCounts().patches,
        blasts: this.blasts.activeCount,
      }
    }
    updateTrajectoriesAndMarkers(e) {
      let t = 0,
        n = 0
      for (let [r, i] of this.lines.entries()) {
        let { traj: a, line: o, material: s } = i,
          c = a.detonationTick ?? a.endTick,
          l = e >= a.startTick && e <= c,
          u = e > c && e <= c + yD
        if (!l && !u) {
          o.visible = !1
          continue
        }
        if (
          ((o.visible =
            this.trajectoryVisibility === `all` ||
            (this.trajectoryVisibility === `followed` &&
              this.followedSlot >= 0 &&
              a.throwerSlot === this.followedSlot) ||
            (this.trajectoryVisibility === `selected` && r === this.selectedGrenade)),
          l)
        ) {
          let r = pD(a.ticks, e)
          ;(o.geometry.setDrawRange(0, Math.max(2, r + 1)), (s.opacity = 1))
          let c = this.modelsEnabled ? (this.models.get(i.modelFile)?.geometry ?? null) : null
          if (c) {
            let t = this.pose
            hD(a, e, t)
            let { mesh: r, light: i } = this.modelMesh(n++)
            ;(this.lighting.sample(t.x, t.y, t.z, i),
              (r.geometry = c),
              r.position.set(t.x, t.y, t.z),
              r.quaternion.set(t.qx, t.qy, t.qz, t.qw),
              (r.visible = !0))
          } else
            t < this.markerCapacity &&
              (this.dummy.position.set(a.posXYZ[r * 3], a.posXYZ[r * 3 + 1], a.posXYZ[r * 3 + 2]),
              this.dummy.scale.setScalar(1),
              this.dummy.rotation.set(0, 0, 0),
              this.dummy.updateMatrix(),
              this.markers.setMatrixAt(t, this.dummy.matrix),
              this.markers.setColorAt(t, this.markerColor.set(xD[a.kind])),
              t++)
        } else (o.geometry.setDrawRange(0, a.ticks.length), (s.opacity = 1 - (e - c) / yD))
      }
      for (let e = n; e < this.modelMeshes.length; e++) this.modelMeshes[e].mesh.visible = !1
      ;((this.markers.count = t),
        (this.markers.instanceMatrix.needsUpdate = !0),
        this.markers.instanceColor && (this.markers.instanceColor.needsUpdate = !0))
    }
    updateEffects(e) {
      this.blasts.begin()
      for (let t of this.data.effects) {
        let n = t.kind === `he` ? tD : t.kind === `flash` ? nD : null
        if (!n) continue
        let r = aD(n, t, e, this.tickRate)
        r !== null && this.blasts.show(t, r, n)
      }
      this.blasts.end()
    }
    dispose() {
      ;((this.disposed = !0), this.fire.dispose(), this.blasts.dispose())
      for (let { line: e, material: t } of this.lines) (e.geometry.dispose(), t.dispose())
      ;(this.markers.geometry.dispose(), this.markers.material.dispose())
      for (let e of this.models.values()) e.geometry?.dispose()
      ;(this.models.clear(), this.modelMaterial.dispose(), this.scene.remove(this.group))
    }
  },
  wD = 14,
  TD = 44,
  ED = 36,
  DD = 0.75,
  OD = Math.PI / 180,
  kD = new U(14722342),
  AD = new U(7189490),
  jD = new U(8947848),
  MD = new U(16724040),
  ND = 0.75,
  PD = new H().makeScale(0, 0, 0),
  FD = 8,
  ID = class {
    capsules
    noses
    xrayScene = new Jn()
    xrayCapsules
    xrayNoses
    xrayMaskMat
    xrayCompositeScene = new Jn()
    xrayCompositeCamera = new _s()
    xrayCompositeMesh
    xraySmoke
    xrayResolution = new z(1, 1)
    xrayTarget = null
    bodyMat
    noseMat
    dummy = new Rn()
    playerColor = new U()
    slotColors
    colorOf = (e) => this.slotColors[e]
    damageTint
    count
    xray = !1
    constructor(e, t) {
      ;((this.count = t),
        (this.damageTint = new Float32Array(t)),
        (this.slotColors = Array.from({ length: t }, () => jD.clone())))
      let n = new so(wD, TD, 6, 12)
      n.rotateX(Math.PI / 2)
      let r = new lo(6, 18, 10)
      ;(r.rotateZ(-Math.PI / 2),
        r.translate(22, 0, 6),
        (this.bodyMat = new ko()),
        (this.noseMat = new ko()),
        (this.xraySmoke = new Ki(new Float32Array(t), 1)),
        n.setAttribute(`xraySmoke`, this.xraySmoke),
        r.setAttribute(`xraySmoke`, this.xraySmoke),
        (this.xrayMaskMat = zD()),
        (this.xrayCompositeMesh = BD(this.xrayResolution)),
        this.xrayCompositeScene.add(this.xrayCompositeMesh),
        (this.capsules = new ea(n, this.bodyMat, t)),
        (this.noses = new ea(r, this.noseMat, t)),
        (this.xrayCapsules = new ea(n, this.xrayMaskMat, t)),
        (this.xrayNoses = new ea(r, this.xrayMaskMat, t)),
        (this.capsules.frustumCulled = !1),
        (this.noses.frustumCulled = !1),
        (this.xrayCapsules.frustumCulled = !1),
        (this.xrayNoses.frustumCulled = !1),
        this.capsules.instanceMatrix.setUsage(tt),
        this.noses.instanceMatrix.setUsage(tt),
        this.xrayCapsules.instanceMatrix.setUsage(tt),
        this.xrayNoses.instanceMatrix.setUsage(tt))
      for (let e = 0; e < t; e++)
        (this.capsules.setColorAt(e, jD),
          this.noses.setColorAt(e, jD),
          this.xrayCapsules.setColorAt(e, jD),
          this.xrayNoses.setColorAt(e, jD))
      ;(e.add(this.capsules), e.add(this.noses), this.xrayScene.add(this.xrayCapsules, this.xrayNoses))
    }
    update(e, t, n, r, i = -1, a) {
      this.updateDamageTint(t, n, r)
      for (let t = 0; t < this.count; t++) {
        let n = e.alive[t] === 1,
          r = n && t !== i && a?.[t] !== 1,
          o = 1 - e.duck[t] * (1 - DD)
        ;(this.dummy.position.set(e.x[t], e.y[t], e.z[t] + ED * o),
          this.dummy.rotation.set(0, 0, e.yaw[t] * OD),
          this.dummy.scale.set(+!!r, +!!r, r ? o : 0),
          this.dummy.updateMatrix(),
          this.capsules.setMatrixAt(t, this.dummy.matrix),
          this.noses.setMatrixAt(t, this.dummy.matrix))
        let s = this.xray && n && t !== i
        ;(this.dummy.scale.set(+!!s, +!!s, s ? o : 0),
          this.dummy.updateMatrix(),
          this.xrayCapsules.setMatrixAt(t, this.dummy.matrix),
          this.xrayNoses.setMatrixAt(t, this.dummy.matrix),
          this.xraySmoke.setX(t, +(a?.[t] === 1)))
        let c = this.playerColor.copy(LD(e.team[t])).lerp(MD, this.damageTint[t])
        ;(this.slotColors[t].copy(c),
          this.capsules.setColorAt(t, c),
          this.noses.setColorAt(t, c),
          this.xrayCapsules.setColorAt(t, c),
          this.xrayNoses.setColorAt(t, c))
      }
      ;((this.capsules.instanceMatrix.needsUpdate = !0),
        (this.noses.instanceMatrix.needsUpdate = !0),
        (this.xrayCapsules.instanceMatrix.needsUpdate = !0),
        (this.xrayNoses.instanceMatrix.needsUpdate = !0),
        (this.xraySmoke.needsUpdate = !0),
        this.capsules.instanceColor && (this.capsules.instanceColor.needsUpdate = !0),
        this.noses.instanceColor && (this.noses.instanceColor.needsUpdate = !0),
        this.xrayCapsules.instanceColor && (this.xrayCapsules.instanceColor.needsUpdate = !0),
        this.xrayNoses.instanceColor && (this.xrayNoses.instanceColor.needsUpdate = !0))
    }
    updateDamageTint(e, t, n) {
      this.damageTint.fill(0)
      let r = ND * n,
        i = RD(e.tick, e.count, t)
      for (let n = i - 1; n >= 0; n--) {
        let i = t - e.tick[n]
        if (i > r) break
        let a = e.victimSlot[n]
        if (a >= this.count) continue
        let o = 1 - i / r,
          s = Math.min(1, 0.3 + e.dmg[n] / 100) * 0.58
        this.damageTint[a] = Math.max(this.damageTint[a], o * s)
      }
    }
    applyXrayDepth(e, t) {
      ;((this.xrayCompositeMesh.material.uniforms.uSceneDepth.value = e), this.xrayResolution.copy(t))
    }
    renderXray(e, t, n) {
      if (!this.xray) return
      let r = Math.max(1, Math.floor(this.xrayResolution.x)),
        i = Math.max(1, Math.floor(this.xrayResolution.y))
      this.xrayTarget
        ? (this.xrayTarget.width !== r || this.xrayTarget.height !== i) && this.xrayTarget.setSize(r, i)
        : ((this.xrayTarget = new ln(r, i, { depthBuffer: !0, stencilBuffer: !1 })),
          (this.xrayTarget.texture.minFilter = c),
          (this.xrayTarget.texture.magFilter = c),
          (this.xrayTarget.depthTexture = new ro(r, i, y)),
          (this.xrayTarget.depthTexture.format = A))
      let a = e.getRenderTarget(),
        o = e.autoClear,
        s = e.getClearColor(new U()),
        l = e.getClearAlpha()
      try {
        ;(n && this.collapseXrayCapsules(n.drawnAlive),
          e.setRenderTarget(this.xrayTarget),
          e.setClearColor(0, 0),
          e.clear(),
          e.render(this.xrayScene, t),
          n && ((e.autoClear = !1), n.renderXrayMask(e, t, this.colorOf)),
          (this.xrayCompositeMesh.material.uniforms.uMask.value = this.xrayTarget.texture),
          (this.xrayCompositeMesh.material.uniforms.uPlayerDepth.value = this.xrayTarget.depthTexture),
          this.xrayCompositeMesh.material.uniforms.uNearFar.value.set(t.near, t.far),
          e.setRenderTarget(a),
          (e.autoClear = !1),
          e.render(this.xrayCompositeScene, this.xrayCompositeCamera))
      } finally {
        ;(e.setRenderTarget(a), (e.autoClear = o), e.setClearColor(s, l))
      }
    }
    get xrayEnabled() {
      return this.xray
    }
    collapseXrayCapsules(e) {
      let t = !1
      for (let n = 0; n < this.count; n++)
        e[n] === 1 && (this.xrayCapsules.setMatrixAt(n, PD), this.xrayNoses.setMatrixAt(n, PD), (t = !0))
      t && ((this.xrayCapsules.instanceMatrix.needsUpdate = !0), (this.xrayNoses.instanceMatrix.needsUpdate = !0))
    }
    dispose() {
      ;(this.capsules.geometry.dispose(),
        this.noses.geometry.dispose(),
        this.bodyMat.dispose(),
        this.noseMat.dispose(),
        this.xrayMaskMat.dispose(),
        this.xrayCompositeMesh.geometry.dispose(),
        this.xrayCompositeMesh.material.dispose(),
        this.xrayTarget?.dispose(),
        this.capsules.removeFromParent(),
        this.noses.removeFromParent(),
        this.capsules.dispose(),
        this.noses.dispose())
    }
    setXray(e) {
      this.xray = e
    }
    setBodiesVisible(e) {
      ;((this.capsules.visible = e), (this.noses.visible = e))
    }
    intersect(e) {
      let t = e.intersectObject(this.capsules, !1)[0]
      return t && t.instanceId != null ? t.instanceId : -1
    }
  }
function LD(e) {
  return e === 2 ? kD : e === 3 ? AD : jD
}
function RD(e, t, n) {
  let r = 0,
    i = t
  for (; r < i;) {
    let t = (r + i) >>> 1
    e[t] <= n ? (r = t + 1) : (i = t)
  }
  return r
}
function zD() {
  return new To({
    vertexColors: !0,
    depthTest: !0,
    depthWrite: !0,
    toneMapped: !1,
    vertexShader: `
      attribute float xraySmoke;
      varying vec3 vColor;
      varying float vSmokeOccluded;
      void main() {
        vColor = instanceColor;
        vSmokeOccluded = xraySmoke;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vSmokeOccluded;
      void main() {
        gl_FragColor = vec4(vColor, mix(0.5, 1.0, vSmokeOccluded));
      }
    `,
  })
}
function BD(e) {
  let t = new To({
      uniforms: {
        uMask: { value: null },
        uPlayerDepth: { value: null },
        uSceneDepth: { value: null },
        uResolution: { value: e },
        uNearFar: { value: new z(1, 1e3) },
      },
      transparent: !0,
      depthTest: !1,
      depthWrite: !1,
      toneMapped: !1,
      vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
      fragmentShader: `
      uniform sampler2D uMask;
      uniform sampler2D uPlayerDepth;
      uniform sampler2D uSceneDepth;
      uniform vec2 uResolution;
      uniform vec2 uNearFar;
      varying vec2 vUv;
      float viewDistance(float depth) {
        return uNearFar.x * uNearFar.y / (uNearFar.y - (uNearFar.y - uNearFar.x) * depth);
      }
      void main() {
        vec2 texel = 1.0 / uResolution;
        if (texture2D(uMask, vUv).a > 0.25) discard;
        vec4 edge = vec4(0.0);
        for (int y = -3; y <= 3; y++) {
          for (int x = -3; x <= 3; x++) {
            vec2 offset = vec2(float(x), float(y));
            if (dot(offset, offset) > 9.0) continue;
            vec2 sampleUv = vUv + offset * texel;
            vec4 sampleMask = texture2D(uMask, sampleUv);
            if (sampleMask.a <= max(edge.a, 0.25)) continue;
            // The test is made where the player is, not at this outline pixel: below a boot the outline pixel is the
            // floor in front of the foot, which is always nearer. The tolerance ignores soles sunk into the floor.
            bool hidden = sampleMask.a > 0.75;
            if (!hidden) {
              float playerDistance = viewDistance(texture2D(uPlayerDepth, sampleUv).r);
              float sceneDistance = viewDistance(texture2D(uSceneDepth, sampleUv).r);
              hidden = sceneDistance < playerDistance - ${FD.toFixed(1)};
            }
            if (hidden) edge = sampleMask;
          }
        }
        if (edge.a <= 0.25) discard;
        gl_FragColor = vec4(mix(edge.rgb, vec3(1.0), 0.25), 0.95);
      }
    `,
    }),
    n = new G(new po(2, 2), t)
  return ((n.frustumCulled = !1), n)
}
function VD(e, t, n, r = null) {
  let i = e.compile(t, n, r)
  return new Promise((t) => {
    let n = () => {
      for (let t of i) {
        let n = e.properties.get(t).currentProgram
        ;(!n || n.isReady()) && i.delete(t)
      }
      i.size === 0 ? t() : setTimeout(n, 10)
    }
    e.extensions.has(`KHR_parallel_shader_compile`) ? n() : setTimeout(n, 10)
  })
}
