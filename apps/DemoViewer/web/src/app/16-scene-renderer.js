// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 39175–39543 行（切片 17/34）
// 角色：场景渲染器 qD：setShadowQuality/render/beginRenderFrame/静态阴影/大气
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var qD = class {
  scene
  renderer
  container
  sunShadowsEnabled = !0
  shadowQuality = `medium`
  renderScale = 1
  staticShadowLight = null
  staticShadowMap = null
  sunAzimuth = 141
  sunElevation = 65
  sunIntensity = 2
  atmosphereFog
  filmicContrast = !0
  cs2Environment = null
  cs2Sun = null
  sunDirection = new B()
  visibleSun
  grid
  sky
  depthRT = null
  depthPrepass = new HD()
  dbSize = new z()
  constructor(e, t = {}) {
    ;((this.container = e),
      (this.renderer = new Nd({
        antialias: t.antialias ?? !0,
        powerPreference: t.powerPreference ?? `high-performance`,
      })),
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)),
      this.renderer.setSize(e.clientWidth, e.clientHeight),
      (this.renderer.toneMapping = 4),
      (this.renderer.toneMappingExposure = 1),
      (this.renderer.shadowMap.enabled = !0),
      (this.renderer.shadowMap.type = 1),
      (this.renderer.info.autoReset = !1),
      e.appendChild(this.renderer.domElement),
      (this.scene = new Jn()),
      (this.scene.background = new U(11782374)),
      (this.atmosphereFog = new qn(13089181, UD, WD)),
      (this.scene.fog = this.atmosphereFog),
      (this.sky = JD()),
      this.scene.add(this.sky),
      (this.visibleSun = YD()),
      this.scene.add(this.visibleSun),
      this.scene.add(new ls(11453399, 5327424, 1)))
    let n = new Os(16777215, 0.3)
    ;(n.position.set(0.4, 0.6, 1), this.scene.add(n))
    let r = new ks(16777215, 0.2)
    ;(this.scene.add(r),
      (this.grid = new mc(16e3, 125, 2765636, 1712688)),
      (this.grid.rotation.x = Math.PI / 2),
      this.scene.add(this.grid))
  }
  setFloor(e) {
    this.grid.position.z = e
  }
  setGridVisible(e) {
    this.grid.visible = e
  }
  resize() {
    ;(this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale),
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight))
  }
  setRenderScale(e) {
    if (![0.5, 0.75, 1].includes(e)) throw RangeError(`Invalid render resolution`)
    e !== this.renderScale && ((this.renderScale = e), this.resize())
  }
  setSunShadowsEnabled(e) {
    ;((this.sunShadowsEnabled = e),
      this.staticShadowLight &&
        ((this.staticShadowLight.castShadow = e), (this.staticShadowLight.shadow.needsUpdate = e)))
  }
  setShadowQuality(e) {
    if (e !== this.shadowQuality && ((this.shadowQuality = e), this.staticShadowLight)) {
      let e = this.staticShadowLight.shadow,
        t = this.staticShadowMapSize()
      ;(e.mapSize.x !== t && (e.mapSize.set(t, t), e.map?.dispose(), (e.map = null)),
        (e.needsUpdate = this.sunShadowsEnabled))
    }
  }
  setClassifiedMap(e) {
    ;(this.disposeStaticMapShadow(), e && this.installStaticMapShadow(e))
  }
  installStaticMapShadow(e) {
    let t = new Os(16770488, this.sunIntensity)
    ;((t.name = `CSPlayer_StaticMapSun`),
      (t.castShadow = this.sunShadowsEnabled),
      (t.shadow.autoUpdate = !1),
      t.shadow.mapSize.setScalar(this.staticShadowMapSize()),
      (t.shadow.bias = -2e-4),
      (t.shadow.normalBias = 12),
      this.scene.add(t, t.target),
      (this.staticShadowLight = t),
      (this.staticShadowMap = e),
      this.updateStaticMapShadow())
  }
  updateStaticMapShadow() {
    let e = this.staticShadowLight,
      t = this.staticShadowMap
    if (!e || !t) return
    let n = new lr().setFromObject(t)
    if (n.isEmpty()) return
    let r = n.getCenter(new B()),
      i = n.getSize(new B()).length() * 0.5
    ;(e.position.copy(r).addScaledVector(this.sunDirection, i + GD),
      e.target.position.copy(r),
      e.updateMatrixWorld(!0),
      e.target.updateMatrixWorld(!0),
      e.shadow.updateMatrices(e))
    let a = e.shadow.camera,
      o = n.clone().applyMatrix4(a.matrixWorldInverse)
    ;((a.left = o.min.x - GD),
      (a.right = o.max.x + GD),
      (a.bottom = o.min.y - GD),
      (a.top = o.max.y + GD),
      (a.near = Math.max(1, -o.max.z - GD)),
      (a.far = Math.max(a.near + 1, -o.min.z + GD)),
      a.updateProjectionMatrix(),
      (e.shadow.needsUpdate = this.sunShadowsEnabled))
  }
  disposeStaticMapShadow() {
    let e = this.staticShadowLight
    e && (this.scene.remove(e, e.target), e.dispose(), (this.staticShadowLight = null), (this.staticShadowMap = null))
  }
  staticShadowMapSize() {
    return Math.min(KD[this.shadowQuality], this.renderer.capabilities.maxTextureSize)
  }
  setAtmosphereEnabled(e) {
    this.scene.fog = e ? this.atmosphereFog : null
  }
  setMapEnvironment(e, t, n, r, i) {
    this.cs2Environment ||
      (this.atmosphereFog.color.setHex(e),
      (this.scene.background = new U(t)),
      this.sky.material.uniforms.bottomColor.value.setHex(t),
      this.sky.material.uniforms.topColor.value.setHex(n),
      (this.sunAzimuth = r),
      (this.sunElevation = i),
      this.updateSunDirection(),
      this.updateStaticMapShadow())
  }
  setCs2Environment(e) {
    if (
      ((this.cs2Environment = e), (this.cs2Sun &&= (this.scene.remove(this.cs2Sun), this.cs2Sun.dispose(), null)), !e)
    ) {
      ;(this.setSkyMap(null, 1),
        (this.visibleSun.visible = !0),
        (this.atmosphereFog.near = UD),
        (this.atmosphereFog.far = WD),
        (this.renderer.toneMapping = this.filmicContrast ? 4 : 0),
        (this.renderer.toneMappingExposure = 1))
      return
    }
    ;(this.atmosphereFog.color.copy(e.fogColor),
      (this.atmosphereFog.near = e.fogStart),
      (this.atmosphereFog.far = e.fogEnd),
      (this.scene.background = e.fogColor.clone()),
      this.sky.material.uniforms.bottomColor.value.copy(e.fogColor))
    let t = e.skyColor.clone()
    ;(t.multiplyScalar(1 / Math.max(1, t.r, t.g, t.b)),
      this.sky.material.uniforms.topColor.value.copy(t),
      this.setSkyMap(e.sky?.map ?? null, e.sky?.vMax ?? 1),
      (this.visibleSun.visible = !e.sky))
    let n = e.sunDirection.clone().normalize()
    ;((this.sunAzimuth = Vt.radToDeg(Math.atan2(n.y, n.x))),
      (this.sunElevation = Vt.radToDeg(Math.asin(Vt.clamp(n.z, -1, 1)))),
      this.updateSunDirection(),
      (this.cs2Sun = new Os(e.sunColor, Math.PI)),
      (this.cs2Sun.name = `CSPlayer_Cs2Sun`),
      this.cs2Sun.position.copy(n),
      this.scene.add(this.cs2Sun),
      (this.renderer.toneMapping = 5),
      (this.renderer.toneMappingExposure = e.exposure))
  }
  classicLighting() {
    this.updateSunDirection()
    let e = 0.2,
      t = new U(11453399).addScalar(e).multiplyScalar(1 / Math.PI),
      n = new U(5327424).addScalar(e).multiplyScalar(1 / Math.PI),
      r = this.staticShadowLight ? new U(16770488).multiplyScalar(this.sunIntensity / Math.PI) : new U(0, 0, 0)
    return { sunDirection: this.sunDirection.clone(), sunColor: r, skyColor: t, groundColor: n, fog: this.scene.fog }
  }
  setCs2Exposure(e) {
    this.cs2Environment && ((this.cs2Environment.exposure = e), (this.renderer.toneMappingExposure = e))
  }
  setSkyMap(e, t) {
    let n = this.sky.material
    ;((n.uniforms.skyMap.value = e), (n.uniforms.skyVMax.value = t))
    let r = e !== null
    ;`USE_SKY_MAP` in n.defines !== r &&
      (r ? (n.defines.USE_SKY_MAP = ``) : delete n.defines.USE_SKY_MAP, (n.needsUpdate = !0))
  }
  setFilmicContrastEnabled(e) {
    ;((this.filmicContrast = e), !this.cs2Environment && (this.renderer.toneMapping = e ? 4 : 0))
  }
  get width() {
    return this.container.clientWidth
  }
  get height() {
    return this.container.clientHeight
  }
  beginRenderFrame() {
    this.renderer.info.reset()
  }
  render(e) {
    ;(this.sky.position.copy(e.position),
      this.updateSunDirection(),
      this.visibleSun.position.copy(e.position).addScaledVector(this.sunDirection, 3e4),
      this.renderer.render(this.scene, e))
  }
  renderPreview(e) {
    this.sky.position.copy(e.position)
    let t = this.renderer.shadowMap.enabled
    this.renderer.shadowMap.enabled = !1
    try {
      this.renderer.render(this.scene, e)
    } finally {
      this.renderer.shadowMap.enabled = t
    }
  }
  renderWithDepth(e, t) {
    let n = this.ensureDepthTarget(t)
    return (this.depthPrepass.render(this.renderer, this.scene, e, n), this.render(e), n.depthTexture)
  }
  precompile(e, t = {}) {
    let { sceneObjects: n = [], screenOverlays: r = [], offscreenOverlays: i = [] } = t,
      a = this.ensureDepthTarget(),
      o = this.renderer.getRenderTarget(),
      s = []
    try {
      ;(this.renderer.setRenderTarget(a),
        s.push(this.depthPrepass.compileAsync(this.renderer, this.scene, e, this.scene)))
      for (let t of i) s.push(VD(this.renderer, t, e))
      ;(this.renderer.setRenderTarget(null), s.push(VD(this.renderer, this.scene, e)))
      for (let t of n) s.push(VD(this.renderer, t, e, this.scene))
      for (let t of r) s.push(VD(this.renderer, t, e))
    } finally {
      this.renderer.setRenderTarget(o)
    }
    return Promise.all(s)
  }
  ensureDepthTarget(e) {
    e ? this.dbSize.copy(e) : this.renderer.getDrawingBufferSize(this.dbSize)
    let t = Math.max(1, Math.floor(this.dbSize.x)),
      n = Math.max(1, Math.floor(this.dbSize.y))
    return (
      (!this.depthRT || this.depthRT.width !== t || this.depthRT.height !== n) &&
        (this.depthRT?.dispose(),
        (this.depthRT = new ln(t, n, { format: te, type: m, depthBuffer: !0, stencilBuffer: !1 })),
        (this.depthRT.depthTexture = new ro(t, n, y)),
        (this.depthRT.depthTexture.format = A)),
      this.depthRT
    )
  }
  updateSunDirection() {
    let e = Vt.degToRad(this.sunAzimuth),
      t = Vt.degToRad(this.sunElevation),
      n = Math.cos(t)
    this.sunDirection.set(Math.cos(e) * n, Math.sin(e) * n, Math.sin(t))
  }
  get drawingBufferSize() {
    return this.renderer.getDrawingBufferSize(this.dbSize)
  }
  dispose() {
    ;(this.disposeStaticMapShadow(),
      this.depthRT?.dispose(),
      this.depthPrepass.dispose(),
      this.renderer.dispose(),
      this.renderer.domElement.remove())
  }
}
function JD() {
  let e = new To({
      side: 1,
      depthWrite: !1,
      fog: !1,
      defines: {},
      uniforms: {
        topColor: { value: new U(2320082) },
        bottomColor: { value: new U(11782374) },
        exponent: { value: 0.55 },
        skyMap: { value: null },
        skyVMax: { value: 1 },
      },
      vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position); // local sphere direction (Z-up), placement-independent
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float exponent;
      uniform sampler2D skyMap;
      uniform float skyVMax;
      varying vec3 vDir;
      void main() {
        #ifdef USE_SKY_MAP
          // The panorama has no mips, so the atan2 seam needs no derivative fix.
          vec3 d = normalize(vDir);
          vec2 uv = vec2(atan(d.y, d.x) * 0.15915494, acos(clamp(d.z, -1.0, 1.0)) * 0.31830989 / skyVMax);
          gl_FragColor = vec4(texture2D(skyMap, uv).rgb, 1.0);
        #else
          float t = pow(clamp(vDir.z * 0.5 + 0.5, 0.0, 1.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    }),
    t = new G(new mo(4e4, 32, 16), e)
  return ((t.frustumCulled = !1), (t.renderOrder = -1), t)
}
function YD() {
  let e = new Uint8Array(16384 * 4)
  for (let t = 0; t < 128; t++)
    for (let n = 0; n < 128; n++) {
      let r = Math.hypot(((n + 0.5) / 128) * 2 - 1, ((t + 0.5) / 128) * 2 - 1),
        i = r < 0.38 ? 255 : Math.round(110 * (1 - Vt.smoothstep(r, 0.38, 1))),
        a = (t * 128 + n) * 4
      ;((e[a] = 255), (e[a + 1] = 255), (e[a + 2] = 255), (e[a + 3] = i))
    }
  let t = new Hi(e, 128, 128, k)
  ;((t.minFilter = d), (t.magFilter = d), (t.generateMipmaps = !1), (t.needsUpdate = !0))
  let n = new si(new qr({ map: t, color: 16777215, transparent: !0, depthWrite: !1, depthTest: !0, fog: !1 }))
  return (n.scale.setScalar(6400), n)
}
function XD() {
  if (typeof window > `u`) return `desktop`
  let e = new URLSearchParams(window.location.search).get(`gpu`)
  return e === `mobile` || e === `desktop`
    ? e
    : window.matchMedia?.(`(pointer: coarse) and (hover: none)`).matches
      ? `mobile`
      : `desktop`
}
var ZD = 512
function QD(e, t) {
  let n = 0,
    r = 0,
    i = 0
  for (let a = 0; a < t; a++)
    ((n |= ((e >> (3 * a)) & 1) << a), (r |= ((e >> (3 * a + 1)) & 1) << a), (i |= ((e >> (3 * a + 2)) & 1) << a))
  return [n, r, i]
}
var $D = (() => {
  let e = new Int8Array(192)
  for (let t = 0; t < 64; t++) {
    let [n, r, i] = QD(t, 2)
    ;((e[t * 3] = n), (e[t * 3 + 1] = r), (e[t * 3 + 2] = i))
  }
  return e
})()
function eO(e, t, n, r) {
  if (n > ZD || t + n * 10 + 1 !== e.length || e[e.length - 1] !== 0) return !1
  let i = t
  for (let t = 0; t < n; t++) {
    let t = e[i] | (e[i + 1] << 8)
    if (t >= ZD) return !1
    let n = (e[i + 2] | (e[i + 3] << 8) | (e[i + 4] << 16) | (e[i + 5] << 24)) >>> 0,
      a = (e[i + 6] | (e[i + 7] << 8) | (e[i + 8] << 16) | (e[i + 9] << 24)) >>> 0
    ;(r.push({ base: t, lo: n, hi: a }), (i += 10))
  }
  return !0
}
