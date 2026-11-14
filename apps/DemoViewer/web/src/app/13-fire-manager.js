// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 37845–38343 行（切片 14/34）
// 角色：火焰管理 YE：updateFire/removeScorch/HazardVolumes/InfernoScorch
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var YE = class {
    group = new zn()
    entries = new Map()
    caches = new WeakMap()
    uniforms = { uTime: { value: 0 } }
    geometryBuilds = 0
    constructor() {
      ;((this.group.name = `HazardVolumes`), (this.group.visible = !1))
    }
    update(e, t, n, r = 12) {
      this.uniforms.uTime.value = n
      let i = new Set(e.map(({ model: e }) => e))
      for (let [e, t] of this.entries) i.has(e) || (this.remove(t), this.entries.delete(e))
      for (let { model: n, shape: i, footprint: a } of e) {
        let e = this.entries.get(n),
          o = n.data.endTick / n.tickRate
        if (!e) {
          let t = n.data.infernoType === UE ? GE : WE
          ;((e = { material: KE(this.uniforms.uTime, t, o), fire: null, scorch: null }), this.entries.set(n, e))
        }
        if ((this.updateFire(e, n, i, t, r), a && a.patches.length && e.scorch?.shape !== a)) {
          this.removeScorch(e)
          let i = NE(a, n.origin, t, this.cacheFor(n), r)
          if (i.indices.length >= 3) {
            let t = new G(HE(i), qE(this.uniforms.uTime, o, a))
            ;((t.name = `InfernoScorch`),
              (t.frustumCulled = !1),
              (t.renderOrder = -2.6),
              (e.scorch = { shape: a, mesh: t }),
              this.group.add(t),
              this.geometryBuilds++)
          }
        } else a || this.removeScorch(e)
      }
    }
    updateFire(e, t, n, r, i) {
      let a = e.fire,
        o =
          a?.shape === n && a.coverage.step === i
            ? a.key
            : `${i}:` +
              n.patches
                .map((e) =>
                  [e.index, ...e.position, Math.max(60, e.radius), ...e.traceFractions, ...e.planes.flat()].join(`,`),
                )
                .join(`;`)
      if (a && a.key === o) {
        a.shape = n
        return
      }
      if ((this.removeFire(e), !n.patches.length)) return
      let s = NE(n, t.origin, r, this.cacheFor(t), i),
        c = null
      ;(s.indices.length >= 3 &&
        ((c = new G(FE(s, t.data.startTick / t.tickRate).geometry, e.material)),
        (c.name = `HazardVolume`),
        (c.frustumCulled = !1),
        (c.renderOrder = -2.5),
        this.group.add(c),
        this.geometryBuilds++),
        (e.fire = { shape: n, key: o, coverage: s, mesh: c }))
    }
    cacheFor(e) {
      let t = this.caches.get(e)
      return (t || ((t = new wE()), this.caches.set(e, t)), t)
    }
    debugStats() {
      let e = 0,
        t = 0
      for (let { fire: n } of this.entries.values()) n && ((e += n.coverage.cells), (t += n.coverage.area))
      return { cells: e, area: t, geometryBuilds: this.geometryBuilds }
    }
    removeFire(e) {
      ;(e.fire?.mesh && (this.group.remove(e.fire.mesh), e.fire.mesh.geometry.dispose()), (e.fire = null))
    }
    removeScorch(e) {
      ;(e.scorch &&
        (this.group.remove(e.scorch.mesh), e.scorch.mesh.geometry.dispose(), e.scorch.mesh.material.dispose()),
        (e.scorch = null))
    }
    remove(e) {
      ;(this.removeFire(e), this.removeScorch(e), e.material.dispose())
    }
    clear() {
      for (let e of this.entries.values()) this.remove(e)
      ;(this.entries.clear(), (this.caches = new WeakMap()))
    }
    dispose() {
      this.clear()
    }
  },
  XE = 16,
  ZE = 16,
  QE = class {
    scene
    data
    tickRate
    group = new zn()
    models = new Map()
    geometryShapes = new Map()
    modelBounds = new Map()
    cubes
    cubeCapacity = 64
    mapObject = null
    trace = null
    graphics = `medium`
    styled = null
    prototypes = null
    dirty = !0
    lastTick = NaN
    disposed = !1
    vertical = new B(0, 0, 1)
    dummy = new Rn()
    frustum = new ca()
    projectionView = new H()
    previousProjectionView = new H()
    hasPreviousProjectionView = !1
    counts = { infernos: 0, patches: 0, sources: 0, fallbackPatches: 0 }
    constructor(e, t, n = 64) {
      ;((this.scene = e),
        (this.data = t),
        (this.tickRate = n),
        (this.cubes = new ea(new oo(12, 12, 18), new _i({ color: 15698994 }), this.cubeCapacity)),
        (this.cubes.name = `RecordedInfernoCells`),
        (this.cubes.frustumCulled = !1),
        (this.cubes.count = 0),
        (this.group.name = `RecordedInfernos`),
        this.group.add(this.cubes),
        e.add(this.group))
    }
    setData(e) {
      ;((this.data = e),
        this.models.clear(),
        this.geometryShapes.clear(),
        this.modelBounds.clear(),
        this.styled?.clear(),
        (this.dirty = !0),
        (this.lastTick = NaN))
    }
    setMapObject(e) {
      this.disposed ||
        e === this.mapObject ||
        ((this.dirty = !0),
        this.styled?.clear(),
        (this.mapObject = e),
        this.models.clear(),
        this.geometryShapes.clear(),
        this.modelBounds.clear(),
        this.releaseTrace(),
        this.graphics !== `off` && this.prepareTrace())
    }
    prepareTrace() {
      let e = this.mapObject
      if (!e || this.trace) return
      e.updateWorldMatrix(!0, !0)
      let t = []
      ;(e.traverse((e) => {
        if (!(e instanceof G)) return
        let n = e.geometry,
          r = n.getAttribute(`position`)
        if (!r || r.count < 3) return
        let i = n.boundsTree instanceof Ih ? n.boundsTree : new Ih(n, { indirect: !0 })
        ;((n.boundsTree = i), t.push({ tree: i, matrixWorld: e.matrixWorld.clone() }))
      }),
        t.length > 0 && (this.trace = oE(t)))
    }
    releaseTrace() {
      this.trace = null
    }
    setGraphics(e) {
      e !== this.graphics &&
        ((this.graphics = e),
        this.models.clear(),
        this.geometryShapes.clear(),
        this.modelBounds.clear(),
        this.styled?.clear(),
        e === `off` ? this.releaseTrace() : this.prepareTrace(),
        (this.dirty = !0),
        this.refreshVisibility())
    }
    getGraphics() {
      return this.graphics
    }
    debugStyleStats() {
      return { style: `hazard-volume`, ...(this.styled?.debugStats() ?? { cells: 0, area: 0, geometryBuilds: 0 }) }
    }
    update(e, t) {
      if (this.disposed) return
      if (this.graphics === `off`) {
        ;((this.counts = { infernos: 0, patches: 0, sources: 0, fallbackPatches: 0 }), (this.group.visible = !1))
        return
      }
      this.group.visible = !0
      let n = !1
      if (
        (t
          ? (t.updateMatrixWorld(),
            this.projectionView.multiplyMatrices(t.projectionMatrix, t.matrixWorldInverse),
            (n = !this.hasPreviousProjectionView || !this.previousProjectionView.equals(this.projectionView)),
            this.previousProjectionView.copy(this.projectionView),
            (this.hasPreviousProjectionView = !0),
            this.frustum.setFromProjectionMatrix(this.projectionView))
          : (this.hasPreviousProjectionView &&= ((n = !0), !1)),
        !this.dirty && e === this.lastTick && !n)
      ) {
        this.refreshVisibility()
        return
      }
      this.counts = { infernos: 0, patches: 0, sources: 0, fallbackPatches: 0 }
      let r = [],
        i = [],
        a = new Set(),
        o = bE * this.tickRate,
        s = xE * this.tickRate,
        c = this.graphics !== `cubes` && !!this.trace
      for (let n of this.data) {
        let l = e < n.endTick
        if (e < n.startTick || (!l && (!c || e >= n.endTick + o))) continue
        a.add(n)
        let u = this.models.get(n)
        u || ((u = new uE(n, this.trace, this.tickRate)), this.models.set(n, u))
        let d = !t || this.frustum.intersectsSphere(this.boundsFor(u))
        if (!l) {
          if (!d) continue
          let e = n.endTick - 1,
            t = this.styleShapeAt(u, u.activeAt(e), e)
          r.push({ model: u, shape: t, footprint: u.footprintShape() })
          continue
        }
        let f = u.activeAt(e),
          p = c && e >= n.endTick - s ? u.footprintShape() : void 0
        if (f.length === 0) {
          d && p && r.push({ model: u, shape: this.styleShapeAt(u, f, e), footprint: p })
          continue
        }
        ;(this.counts.infernos++, (this.counts.patches += f.length))
        let m = null
        d && this.graphics === `cubes`
          ? ((m = u.shapeAt(e)), (this.counts.sources += m.sources.length))
          : d &&
            this.trace &&
            ((m = this.styleShapeAt(u, f, e)), (m.patches.length || p) && r.push({ model: u, shape: m, footprint: p }))
        for (let e of f)
          (this.trace && e.spatial) ||
            (i.push(new B(...e.position).addScaledVector(this.vertical, 9)), this.counts.fallbackPatches++)
        if (this.graphics === `cubes` && m)
          for (let e of m.sources)
            i.push(new B(...e.position).addScaledVector(this.vertical, e.family === `edge` ? -31 : 9))
      }
      for (let [e, t] of this.models)
        a.has(e) || (this.models.delete(e), this.geometryShapes.delete(t), this.modelBounds.delete(t))
      ;(this.graphics !== `cubes` && this.trace
        ? (this.styled || ((this.styled = new YE()), this.group.add(this.styled.group)),
          this.styled.update(r, this.trace, e / this.tickRate, XE))
        : this.styled?.clear(),
        this.ensureCubes(i.length),
        i.forEach((e, t) => {
          ;(this.dummy.position.copy(e), this.dummy.updateMatrix(), this.cubes.setMatrixAt(t, this.dummy.matrix))
        }),
        (this.cubes.count = i.length),
        i.length && (this.cubes.instanceMatrix.needsUpdate = !0),
        (this.lastTick = e),
        (this.dirty = !1),
        this.refreshVisibility())
    }
    styleShapeAt(e, t, n) {
      let r = Math.floor(n),
        i = Math.max(1, Math.round(this.tickRate / ZE)),
        a = Math.floor(r / i),
        o = t
          .filter((e) => e.spatial)
          .map((e) => e.index)
          .join(`,`),
        s = this.geometryShapes.get(e)
      if (s?.bucket === a && s.activeKey === o) return s.shape
      let c = a * i,
        l = e
          .activeAt(c)
          .filter((e) => e.spatial)
          .map((e) => e.index)
          .join(`,`),
        u = e.shapeAt(l === o ? c : r, !1)
      return (this.geometryShapes.set(e, { bucket: a, activeKey: o, shape: u }), u)
    }
    boundsFor(e) {
      let t = this.modelBounds.get(e)
      if (t) return t
      let n = new B(1 / 0, 1 / 0, 1 / 0),
        r = new B(-1 / 0, -1 / 0, -1 / 0)
      for (let t of e.spans)
        ((n.x = Math.min(n.x, t.position[0])),
          (n.y = Math.min(n.y, t.position[1])),
          (n.z = Math.min(n.z, t.position[2])),
          (r.x = Math.max(r.x, t.position[0])),
          (r.y = Math.max(r.y, t.position[1])),
          (r.z = Math.max(r.z, t.position[2])))
      let i = n.add(r).multiplyScalar(0.5),
        a = 80
      for (let t of e.spans)
        a = Math.max(a, i.distanceTo(this.dummy.position.fromArray(t.position)) + t.targetRadius + 80)
      let o = new Nr(i, a)
      return (this.modelBounds.set(e, o), o)
    }
    debugCounts() {
      return { ...this.counts }
    }
    refreshVisibility() {
      ;((this.group.visible = this.graphics !== `off`),
        (this.cubes.visible = this.cubes.count > 0),
        this.styled && (this.styled.group.visible = this.graphics !== `off` && this.graphics !== `cubes`))
    }
    ensureCubes(e) {
      if (e <= this.cubeCapacity) return
      this.cubeCapacity = 2 ** Math.ceil(Math.log2(e))
      let t = this.cubes
      ;((this.cubes = new ea(t.geometry, t.material, this.cubeCapacity)),
        (this.cubes.name = t.name),
        (this.cubes.frustumCulled = !1),
        this.group.remove(t),
        t.dispose(),
        this.group.add(this.cubes))
    }
    get shaderPrototypes() {
      return ((this.prototypes ??= JE()), this.prototypes)
    }
    dispose() {
      if (!this.disposed) {
        if (((this.disposed = !0), this.scene.remove(this.group), this.styled?.dispose(), this.prototypes)) {
          let e = this.prototypes.children
          for (let t of e) t.material.dispose()
          ;(e[0]?.geometry.dispose(), (this.prototypes = null))
        }
        ;(this.cubes.dispose(),
          this.cubes.geometry.dispose(),
          this.cubes.material.dispose(),
          this.releaseTrace(),
          this.models.clear(),
          this.geometryShapes.clear(),
          this.modelBounds.clear(),
          (this.trace = null))
      }
    }
  },
  $E = 12,
  eD = 1.08,
  tD = {
    seconds: 0.75,
    waveRadius: 170,
    waveSeconds: 0.6,
    ringAlpha: 0.9,
    ringWidth: [2, 1],
    echoDelay: 0.09,
    echoSeconds: 0.5,
    echoAlpha: 0.4,
    shellAlpha: 0.4,
    veilAlpha: 0.14,
    shellFadeSeconds: 0.45,
    glowRadius: 26,
    glowLift: 14,
    glowDecay: 8,
    coreGain: 0.9,
    haloGain: 0.45,
    waveColor: [1, 0.36, 0.1],
    coreColor: [1, 0.9, 0.74],
    haloColor: [1, 0.42, 0.13],
    lightColor: 16751189,
    lightIntensity: 220,
    lightRange: 340,
    lightLift: 32,
  },
  nD = {
    seconds: 0.55,
    waveRadius: 185,
    waveSeconds: 0.42,
    ringAlpha: 0.75,
    ringWidth: [1.6, 0.8],
    echoDelay: 0.06,
    echoSeconds: 0.38,
    echoAlpha: 0.28,
    shellAlpha: 0,
    veilAlpha: 0,
    shellFadeSeconds: 0.32,
    glowRadius: 30,
    glowLift: 8,
    glowDecay: 17,
    coreGain: 1.4,
    haloGain: 0.55,
    waveColor: [0.72, 0.84, 1],
    coreColor: [1, 1, 1],
    haloColor: [0.82, 0.9, 1],
    lightColor: 15134463,
    lightIntensity: 420,
    lightRange: 560,
    lightLift: 24,
  },
  rD = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
  iD = `
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform vec3 uForward;
uniform float uPixelAngle;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uWidth;
uniform float uRingAlpha;
uniform float uEcho;
uniform float uEchoAlpha;
uniform float uShellAlpha;
uniform float uVeilAlpha;
uniform float uGlow;
uniform float uGlowRadius;
uniform float uGlowLift;
uniform float uCoreGain;
uniform float uHaloGain;
uniform vec3 uWaveColor;
uniform vec3 uCoreColor;
uniform vec3 uHaloColor;
varying vec3 vWorld;

float band(float distance, float radius, float halfWidth, float aa) {
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(distance - radius));
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float depth = texture2D(uDepth, gl_FragCoord.xy / uResolution).x;
  float surface = 1e9;
  float ring = 0.0;
  if (depth < 0.999999) {
    float viewZ = (uNear * uFar) / ((uFar - uNear) * depth - uFar);
    surface = -viewZ / max(dot(rd, uForward), 1e-3);
    // Distance from the blast to the visible surface, so the wave follows whatever geometry it reaches.
    float distance = length(ro + rd * surface - uCenter);
    float pixel = surface * uPixelAngle;
    float aa = clamp(fwidth(distance), pixel * 0.5, pixel * 3.0);
    float front = band(distance, uRadius, max(uWidth, pixel * 0.6), aa);
    float wake = distance < uRadius ? exp(-(uRadius - distance) / 22.0) * 0.22 : 0.0;
    float echo = band(distance, uEcho, max(uWidth * 0.6, pixel * 0.5), aa) * uEchoAlpha;
    ring = clamp((front + wake) * uRingAlpha + echo, 0.0, 1.0);
  }

  // The shell in the air: a light tint over what is behind it and a brighter rim where the ray grazes it,
  // both hidden where the shell passes behind geometry.
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + uRadius * uRadius;
  float shell = 0.0;
  float veil = 0.0;
  if (h > 0.0 && uShellAlpha > 0.0) {
    float s = sqrt(h);
    float edge = smoothstep(0.0, 2.0 * max(1.0, (-b) * uPixelAngle), s);
    for (int i = 0; i < 2; i++) {
      float t = i == 0 ? -b - s : -b + s;
      if (t <= 0.0 || t >= surface) continue;
      float facing = abs(dot(normalize(oc + rd * t), rd));
      shell += pow(1.0 - facing, 4.0) * edge;
      veil = max(veil, edge * (0.55 + 0.45 * (1.0 - facing)));
    }
    shell *= uShellAlpha;
    veil *= uVeilAlpha;
  }

  // Core: glow from the closest approach to the blast, faded out when geometry is in front of it.
  vec3 og = ro - (uCenter + vec3(0.0, 0.0, uGlowLift));
  float tc = -dot(og, rd);
  float miss = max(dot(og, og) - tc * tc, 0.0);
  float inFront = smoothstep(-uGlowRadius, uGlowRadius * 0.5, surface - tc) * step(0.0, tc);
  float core = exp(-miss / (uGlowRadius * uGlowRadius));
  float halo = exp(-miss / (4.0 * uGlowRadius * uGlowRadius));
  vec3 waveColor = linearToOutputTexel(vec4(uWaveColor, 1.0)).rgb;
  vec3 coreColor = linearToOutputTexel(vec4(uCoreColor, 1.0)).rgb;
  vec3 haloColor = linearToOutputTexel(vec4(uHaloColor, 1.0)).rgb;
  vec3 glow = (coreColor * core * uCoreGain + haloColor * halo * uHaloGain) * uGlow * inFront;

  vec3 light = glow + waveColor * shell;
  float alpha = ring + veil * (1.0 - ring);
  if (alpha + max(light.r, max(light.g, light.b)) < 0.003) discard;
  // Premultiplied: the ring and veil blend over the scene; the rim and glow add light.
  gl_FragColor = vec4(waveColor * (ring + veil * (1.0 - ring) * 0.8) + light, alpha);
}`
function aD(e, t, n, r) {
  let i = (n - t.startTick) / r
  return i >= 0 && i <= e.seconds ? i : null
}
function oD(e, t) {
  return dD(0, 0.012, t) * Math.exp(-t * e.glowDecay)
}
function sD(e, t) {
  return e.waveRadius * lD(uD(t / e.waveSeconds))
}
