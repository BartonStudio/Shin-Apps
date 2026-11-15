// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 41591–42174 行（切片 28/40）
// 角色：弹道曳光/轨迹线 gk：setData/impactAt/render/computeLineDistances
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var gk = class extends G {
    constructor(e = new XO(), t = new ZO({ color: Math.random() * 16777215 })) {
      ;(super(e, t), (this.isLineSegments2 = !0), (this.type = `LineSegments2`))
    }
    computeLineDistances() {
      let e = this.geometry,
        t = e.attributes.instanceStart,
        n = e.attributes.instanceEnd,
        r = new Float32Array(2 * t.count)
      for (let e = 0, i = 0, a = t.count; e < a; e++, i += 2)
        ($O.fromBufferAttribute(t, e),
          ek.fromBufferAttribute(n, e),
          (r[i] = i === 0 ? 0 : r[i - 1]),
          (r[i + 1] = r[i] + $O.distanceTo(ek)))
      let i = new ec(r, 2, 1)
      return (
        e.setAttribute(`instanceDistanceStart`, new Wr(i, 1, 0)),
        e.setAttribute(`instanceDistanceEnd`, new Wr(i, 1, 1)),
        this
      )
    }
    raycast(e, t) {
      let n = this.material.worldUnits,
        r = e.camera
      r === null &&
        !n &&
        console.error(
          `LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`,
        )
      let i = e.params.Line2 === void 0 ? 0 : e.params.Line2.threshold || 0
      dk = e.ray
      let a = this.matrixWorld,
        o = this.geometry,
        s = this.material
      ;((fk = s.linewidth + i),
        o.boundingSphere === null && o.computeBoundingSphere(),
        lk.copy(o.boundingSphere).applyMatrix4(a))
      let c
      if (
        ((c = n ? fk * 0.5 : pk(r, Math.max(r.near, lk.distanceToPoint(dk.origin)), s.resolution)),
        (lk.radius += c),
        dk.intersectsSphere(lk) === !1)
      )
        return
      ;(o.boundingBox === null && o.computeBoundingBox(), ck.copy(o.boundingBox).applyMatrix4(a))
      let l
      ;((l = n ? fk * 0.5 : pk(r, Math.max(r.near, ck.distanceToPoint(dk.origin)), s.resolution)),
        ck.expandByScalar(l),
        dk.intersectsBox(ck) !== !1 && (n ? mk(this, t) : hk(this, r, t)))
    }
    onBeforeRender(e) {
      let t = this.material.uniforms
      t && t.resolution && (e.getViewport(QO), this.material.uniforms.resolution.value.set(QO.z, QO.w))
    }
  },
  _k = 64,
  vk = Math.round(0.1 * _k),
  yk = Math.round(3 * _k),
  bk = 128,
  xk = 512,
  Sk = new U(12876324),
  Ck = new U(2653121),
  wk = new U(5792109),
  Tk = new U(9147036),
  Ek = 3,
  Dk = 2.4,
  Ok = class {
    scene
    data
    geometry
    material
    positions
    colors
    opacityAttribute
    lines
    markerColor = new U()
    markerMatrix = new H()
    lastSegCount = 0
    impacts
    impactState
    impactPos
    mapObject = null
    raycaster = new nc()
    rayOrigin = new B()
    rayDir = new B()
    constructor(e, t, n) {
      ;((this.scene = e),
        (this.data = t),
        (this.positions = new Float32Array(bk * 6)),
        (this.colors = new Float32Array(bk * 6)),
        (this.geometry = new XO()),
        this.geometry.setPositions(this.positions.subarray(0, 6)),
        this.geometry.setColors(this.colors.subarray(0, 6)),
        (this.opacityAttribute = new Ki(new Float32Array(bk), 1)),
        this.opacityAttribute.setUsage(tt),
        this.geometry.setAttribute(`instanceOpacity`, this.opacityAttribute),
        (this.material = new ZO({ vertexColors: !0, transparent: !0, linewidth: Ek, blending: 1, depthWrite: !1 })))
      let r = `void main() {`,
        i = `gl_FragColor = vec4( diffuseColor.rgb, alpha );`
      if (!this.material.vertexShader.includes(r) || !this.material.fragmentShader.includes(i))
        throw Error(`LineMaterial shader no longer supports per-tracer opacity`)
      ;((this.material.vertexShader =
        `
      attribute float instanceOpacity;
      varying float vTracerOpacity;
    ` + this.material.vertexShader.replace(r, `${r}\n vTracerOpacity = instanceOpacity;`)),
        (this.material.fragmentShader =
          `varying float vTracerOpacity;
` + this.material.fragmentShader.replace(i, `gl_FragColor = vec4( diffuseColor.rgb, alpha * vTracerOpacity );`)))
      let a = n.getSize(new z())
      ;(this.material.resolution.set(a.x, a.y),
        (this.lines = new gk(this.geometry, this.material)),
        (this.lines.frustumCulled = !1),
        (this.lines.visible = !1),
        e.add(this.lines),
        (this.impactState = new Int8Array(t.count)),
        (this.impactPos = new Float32Array(t.count * 3)))
      let o = new mo(Dk, 6, 5),
        s = new _i({ transparent: !0, opacity: 0.9, blending: 1, depthWrite: !1 })
      ;((this.impacts = new ea(o, s, xk)),
        (this.impacts.instanceColor = new Ki(new Float32Array(xk * 3), 3)),
        (this.impacts.frustumCulled = !1),
        (this.impacts.count = 0),
        e.add(this.impacts))
    }
    setData(e) {
      ;((this.data = e),
        (this.impactState = new Int8Array(e.count)),
        (this.impactPos = new Float32Array(e.count * 3)),
        (this.lastSegCount = 0),
        (this.lines.visible = !1),
        (this.impacts.count = 0))
    }
    setMapObject(e) {
      e !== this.mapObject && ((this.mapObject = e), this.impactState.fill(0))
    }
    update(e) {
      let { tick: t, count: n } = this.data
      if (n === 0) return
      let r = jk(t, n, e),
        i = Ak(t, n, e - yk),
        a = 0
      for (let n = i; n < r; n++) {
        if (this.data.hitKind[n] === 1) continue
        let r = e - t[n],
          i = n * 3,
          o = 1 - r / yk
        o <= 0 ||
          a >= xk ||
          this.ensureImpact(n) !== 1 ||
          (this.markerMatrix.makeTranslation(this.impactPos[i], this.impactPos[i + 1], this.impactPos[i + 2]),
          this.impacts.setMatrixAt(a, this.markerMatrix),
          this.markerColor.copy(Tk).multiplyScalar(0.4 + 0.6 * o),
          this.impacts.setColorAt(a, this.markerColor),
          a++)
      }
      ;((this.impacts.count = a),
        a > 0 &&
          ((this.impacts.instanceMatrix.needsUpdate = !0),
          this.impacts.instanceColor && (this.impacts.instanceColor.needsUpdate = !0)))
      let o = Ak(t, n, e - vk),
        s = 0
      for (let n = o; n < r && s < bk; n++) {
        let r = 1 - (e - t[n]) / vk
        if (r <= 0) continue
        let i = kk(this.data.team[n]),
          a = n * 3,
          o = this.data.end[a],
          c = this.data.end[a + 1],
          l = this.data.end[a + 2]
        this.data.hitKind[n] !== 1 &&
          this.ensureImpact(n) === 1 &&
          ((o = this.impactPos[a]), (c = this.impactPos[a + 1]), (l = this.impactPos[a + 2]))
        let u = s * 6
        ;((this.positions[u] = this.data.origin[a]),
          (this.positions[u + 1] = this.data.origin[a + 1]),
          (this.positions[u + 2] = this.data.origin[a + 2]),
          (this.positions[u + 3] = o),
          (this.positions[u + 4] = c),
          (this.positions[u + 5] = l))
        let d = s * 6
        ;((this.colors[d] = i.r),
          (this.colors[d + 1] = i.g),
          (this.colors[d + 2] = i.b),
          (this.colors[d + 3] = i.r),
          (this.colors[d + 4] = i.g),
          (this.colors[d + 5] = i.b),
          this.opacityAttribute.setX(s, r),
          s++)
      }
      ;(s > 0
        ? (this.geometry.setPositions(this.positions.subarray(0, s * 6)),
          this.geometry.setColors(this.colors.subarray(0, s * 6)),
          (this.opacityAttribute.needsUpdate = !0),
          (this.lines.visible = !0))
        : (this.lines.visible = !1),
        (this.lastSegCount = s))
    }
    resize(e, t) {
      this.material.resolution.set(e, t)
    }
    setRenderScale(e) {
      if (![0.5, 0.75, 1].includes(e)) throw RangeError(`Invalid tracer render resolution`)
      this.material.linewidth = Ek * e
    }
    debugCount() {
      return this.lastSegCount
    }
    impactAt(e, t) {
      return e < 0 || e >= this.impactState.length || this.ensureImpact(e) !== 1
        ? !1
        : (t.fromArray(this.impactPos, e * 3), !0)
    }
    ensureImpact(e) {
      let t = this.impactState[e]
      if (t !== 0) return t
      if (!this.mapObject) return 0
      let n = e * 3,
        r = this.data.origin[n],
        i = this.data.origin[n + 1],
        a = this.data.origin[n + 2],
        o = this.data.end[n] - r,
        s = this.data.end[n + 1] - i,
        c = this.data.end[n + 2] - a,
        l = Math.hypot(o, s, c)
      if (l < 0.001) return ((this.impactState[e] = 2), 2)
      ;(this.rayOrigin.set(r, i, a),
        this.rayDir.set(o / l, s / l, c / l),
        this.raycaster.set(this.rayOrigin, this.rayDir),
        (this.raycaster.far = l))
      let u = this.raycaster.intersectObject(this.mapObject, !0)[0]
      return u
        ? ((this.impactPos[n] = u.point.x),
          (this.impactPos[n + 1] = u.point.y),
          (this.impactPos[n + 2] = u.point.z),
          (this.impactState[e] = 1),
          1)
        : ((this.impactState[e] = 2), 2)
    }
    dispose() {
      ;(this.geometry.dispose(),
        this.material.dispose(),
        this.scene.remove(this.lines),
        this.impacts.geometry.dispose(),
        this.impacts.material.dispose(),
        this.scene.remove(this.impacts))
    }
  }
function kk(e) {
  return e === 2 ? Sk : e === 3 ? Ck : wk
}
function Ak(e, t, n) {
  let r = 0,
    i = t
  for (; r < i;) {
    let t = (r + i) >> 1
    e[t] < n ? (r = t + 1) : (i = t)
  }
  return r
}
function jk(e, t, n) {
  let r = 0,
    i = t
  for (; r < i;) {
    let t = (r + i) >> 1
    e[t] <= n ? (r = t + 1) : (i = t)
  }
  return r
}
var Mk = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  Nk = 8,
  Pk = 0.004,
  Fk = 0.995,
  Ik = class {
    camera = new _s()
    glowScene = new Jn()
    compositeScene = new Jn()
    glowMaterial
    compositeMaterial
    size = new z()
    live = null
    shot = null
    glow = null
    shotKey = null
    constructor() {
      let e = new po(2, 2)
      ;((this.glowMaterial = new To({
        uniforms: { uLive: { value: null }, uTexel: { value: new z() } },
        vertexShader: Mk,
        fragmentShader: `uniform sampler2D uLive; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          vec3 sum = texture2D(uLive, vUv + vec2(-2.0, -2.0) * uTexel).rgb
            + texture2D(uLive, vUv + vec2(2.0, -2.0) * uTexel).rgb
            + texture2D(uLive, vUv + vec2(-2.0, 2.0) * uTexel).rgb
            + texture2D(uLive, vUv + vec2(2.0, 2.0) * uTexel).rgb;
          // Only highlights bloom; mid-tones are handled by the exposure curve.
          gl_FragColor = vec4(max(sum * 0.25 - 0.45, 0.0) * 1.8, 1.0);
        }`,
        depthTest: !1,
        depthWrite: !1,
      })),
        (this.compositeMaterial = new To({
          uniforms: {
            uLive: { value: null },
            uGlow: { value: null },
            uShot: { value: null },
            uGlowTexel: { value: new z() },
            uShotTexel: { value: new z() },
            uExposure: { value: 0 },
            uAfterimage: { value: 0 },
          },
          vertexShader: Mk,
          fragmentShader: `uniform sampler2D uLive; uniform sampler2D uGlow; uniform sampler2D uShot;
        uniform vec2 uGlowTexel; uniform vec2 uShotTexel; uniform float uExposure; uniform float uAfterimage;
        varying vec2 vUv;
        // Brightens mid-tones toward white while keeping black and white fixed.
        vec3 expose(vec3 c, float k) { return 1.0 - pow(max(1.0 - c, 0.0), vec3(1.0 + k)); }
        void main() {
          vec3 color = expose(texture2D(uLive, vUv).rgb, uExposure * 2.5);
          vec3 glow = (texture2D(uGlow, vUv).rgb * 2.0
            + texture2D(uGlow, vUv + vec2(-1.0, -1.0) * uGlowTexel).rgb
            + texture2D(uGlow, vUv + vec2(1.0, -1.0) * uGlowTexel).rgb
            + texture2D(uGlow, vUv + vec2(-1.0, 1.0) * uGlowTexel).rgb
            + texture2D(uGlow, vUv + vec2(1.0, 1.0) * uGlowTexel).rgb) / 6.0;
          color = 1.0 - (1.0 - color) * (1.0 - min(glow * uExposure * 1.6, 1.0));
          if (uAfterimage > 0.0) {
            vec3 shot = (texture2D(uShot, vUv + vec2(-1.5, -1.5) * uShotTexel).rgb
              + texture2D(uShot, vUv + vec2(1.5, -1.5) * uShotTexel).rgb
              + texture2D(uShot, vUv + vec2(-1.5, 1.5) * uShotTexel).rgb
              + texture2D(uShot, vUv + vec2(1.5, 1.5) * uShotTexel).rgb) * 0.25;
            color = mix(color, expose(shot, 1.5), uAfterimage * 0.85);
          }
          gl_FragColor = vec4(color, 1.0);
        }`,
          depthTest: !1,
          depthWrite: !1,
        })))
      for (let [t, n] of [
        [this.glowScene, this.glowMaterial],
        [this.compositeScene, this.compositeMaterial],
      ]) {
        let r = new G(e, n)
        ;((r.frustumCulled = !1), t.add(r))
      }
    }
    render(e, t, n, r, i) {
      if (t === null) {
        this.shotKey = null
        return
      }
      let a = e.getRenderTarget(),
        o = e.autoClear
      try {
        if (
          (e.setRenderTarget(null),
          this.ensureSize(e),
          t !== this.shotKey && (e.copyFramebufferToTexture(this.shot), (this.shotKey = t)),
          i >= Fk || (n < Pk && r < Pk))
        )
          return
        ;(e.copyFramebufferToTexture(this.live),
          (e.autoClear = !1),
          e.setRenderTarget(this.glow),
          e.render(this.glowScene, this.camera),
          e.setRenderTarget(null))
        let a = this.compositeMaterial.uniforms
        ;((a.uExposure.value = r), (a.uAfterimage.value = n), e.render(this.compositeScene, this.camera))
      } finally {
        ;((e.autoClear = o), e.setRenderTarget(a))
      }
    }
    ensureSize(e) {
      e.getDrawingBufferSize(this.size)
      let t = Math.max(1, Math.floor(this.size.x)),
        n = Math.max(1, Math.floor(this.size.y))
      if (this.live && this.live.image.width === t && this.live.image.height === n) return
      ;(this.live?.dispose(),
        this.shot?.dispose(),
        this.glow?.dispose(),
        (this.live = Lk(t, n)),
        (this.shot = Lk(t, n)),
        (this.shotKey = null))
      let r = Math.max(1, Math.ceil(t / Nk)),
        i = Math.max(1, Math.ceil(n / Nk))
      ;((this.glow = new ln(r, i, { depthBuffer: !1, stencilBuffer: !1 })),
        (this.glow.texture.minFilter = d),
        (this.glow.texture.magFilter = d),
        (this.glowMaterial.uniforms.uLive.value = this.live),
        this.glowMaterial.uniforms.uTexel.value.set(1 / t, 1 / n))
      let a = this.compositeMaterial.uniforms
      ;((a.uLive.value = this.live),
        (a.uShot.value = this.shot),
        (a.uGlow.value = this.glow.texture),
        a.uGlowTexel.value.set(1 / r, 1 / i),
        a.uShotTexel.value.set(1 / t, 1 / n))
    }
    dispose() {
      ;(this.live?.dispose(),
        this.shot?.dispose(),
        this.glow?.dispose(),
        this.glowMaterial.dispose(),
        this.compositeMaterial.dispose(),
        this.compositeScene.children[0].geometry.dispose())
    }
  }
function Lk(e, t) {
  let n = new Qa(e, t)
  return ((n.minFilter = d), (n.magFilter = d), n)
}
function Rk(e) {
  return Number.isFinite(e) ? Math.min(1, Math.max(0, e)) : 0
}
function zk(e, t) {
  return !Number.isFinite(e) || e <= 0 ? 0 : Rk(t)
}
var Bk = 5.2,
  Vk = 3,
  Hk = 0.6,
  Uk = 1024
function Wk(e, t, n, r, i) {
  let a = e.frameTick
  if (!a.length || n < 0 || n >= t || !(i > 0) || r < a[0]) return null
  let o = 0,
    s = a.length - 1
  for (; o < s;) {
    let e = (o + s + 1) >> 1
    a[e] <= r ? (o = e) : (s = e - 1)
  }
  let c = (r) => e.flash[r * t + n]
  if (!(c(o) > 0)) return null
  let l = o
  for (; l > 0 && o - l < Uk;) {
    let e = c(l - 1),
      t = c(l),
      n = (a[l] - a[l - 1]) / i
    if (!(e > 0) || t > e + 0.001 || e - t > n + 0.1) break
    l--
  }
  let u = c(l),
    d = e.flashAlpha[l * t + n],
    f = Rk(d / Math.sqrt(Math.min(1, u / Bk)))
  return { onsetTick: a[l], duration: u, maxAlpha: f }
}
function Gk(e, t, n) {
  if (!e || !(e.duration > 0) || !(n > 0)) return { remaining: 0, white: 0, afterimage: 0, exposure: 0 }
  let r = Math.max(0, e.duration - Math.max(0, t - e.onsetTick) / n)
  if (r <= 0) return { remaining: 0, white: 0, afterimage: 0, exposure: 0 }
  let i = e.duration > Vk ? Math.min(1, r / Vk) : Hk * Math.min(1, r / e.duration),
    a = Rk(e.maxAlpha)
  return { remaining: r, white: i * i * a, afterimage: i * a, exposure: Math.sqrt(i) * a }
}
function Kk(e, t, n) {
  return n === `indicator`
    ? { ...e, white: 0, afterimage: 0, exposure: 0 }
    : n === `reduced`
      ? { ...e, white: Math.min(0.35, e.white), afterimage: 0, exposure: 0 }
      : t
        ? e
        : {
            remaining: e.remaining,
            white: Math.min(0.72, e.white),
            afterimage: Math.min(0.72, e.afterimage),
            exposure: e.exposure,
          }
}
var qk = {
    "AK-47": [30, 0, 70],
    M4A4: [23, 0, 70],
    "M4A1-S": [25, 3, 65],
    AWP: [78, 15, 20],
    "SSG 08": [33, 15, 20],
    FAMAS: [20, 1, 60],
    "Galil AR": [21, 1, 70],
    AUG: [24, 0, 60],
    "SG 553": [28, 2, 60],
    SCAR20: [31, 4, 30],
    G3SG1: [30, 4, 30],
    "MAC-10": [18, 1, 70],
    MP9: [21, 1, 70],
    MP7: [16, 1, 70],
    "MP5-SD": [16, 1, 70],
    "PP-Bizon": [18, 1, 70],
    P90: [16, 1, 70],
    "UMP-45": [23, 1, 40],
    M249: [25, 2, 50],
    Negev: [20, 2, 0],
    Nova: [143, 22, 20],
    XM1014: [80, 20, 20],
    MAG7: [165, 25, 20],
    "Sawed-Off": [143, 22, 20],
    "Desert Eagle": [48.2, 18, 60],
    "Glock-18": [18, 0, 20],
    "USP-S": [29, 0, 0],
    P2000: [26, 0, 0],
    P250: [26, 3, 10],
    "Five-SeveN": [25, 4, 5],
    "Tec-9": [23, 3, 60],
    "CZ75-Auto": [31, 6, 120],
    "Dual Berettas": [27, 4, 20],
    "R8 Revolver": [20, 0, 40],
  },
  Jk = 18,
  Yk = 0.9,
  Xk = 1 / 128,
  Zk = 1.5,
  Qk = 128
function $k() {
  return { pitch: 0, yaw: 0 }
}
var eA = new Int32Array(Qk)
function tA(e, t, n, r) {
  ;((r.pitch = 0), (r.yaw = 0))
  let i = e.weaponFires,
    { panelFrames: a, weaponNames: o } = e
  if (!i || i.ticks.length === 0 || n < i.ticks[0] || a.frameTick.length === 0) return r
  let s = xC(a.frameTick, n),
    c = qk[o[a.activeWeapon[s * e.meta.numPlayers + t]] ?? ``]
  if (!c) return r
  let { tickRate: l } = e.meta,
    u = Zk * l,
    d = 0
  for (let e = xC(i.ticks, n); e >= 0 && d < Qk; e--) {
    let r = i.ticks[e]
    if ((d === 0 ? n : eA[d - 1]) - r > u) break
    i.slots[e] === t && (eA[d++] = r)
  }
  if (d === 0) return r
  let f = { pitch: 0, yaw: 0, velPitch: 0, velYaw: 0 },
    [p, m, h] = c
  for (let e = d - 1; e >= 0; e--) {
    e < d - 1 && nA(f, (eA[e] - eA[e + 1]) / l)
    let n = h * rA(t, eA[e], 1) * (Math.PI / 180),
      r = p + m * rA(t, eA[e], 2)
    ;((f.velPitch -= Math.cos(n) * r), (f.velYaw -= Math.sin(n) * r))
  }
  return (nA(f, (n - eA[0]) / l), (r.pitch = f.pitch * Yk), (r.yaw = f.yaw * Yk), r)
}
function nA(e, t) {
  for (; t > 1e-9;) {
    let n = Math.min(Xk, t)
    t -= n
    let r = Math.exp(-8 * n)
    ;((e.pitch *= r), (e.yaw *= r))
    let i = Math.hypot(e.pitch, e.yaw),
      a = Jk * n,
      o = i > a ? 1 - a / i : 0
    ;((e.pitch = e.pitch * o + e.velPitch * n * 0.5), (e.yaw = e.yaw * o + e.velYaw * n * 0.5))
    let s = Math.exp(-4.5 * n)
    ;((e.velPitch *= s), (e.velYaw *= s), (e.pitch += e.velPitch * n * 0.5), (e.yaw += e.velYaw * n * 0.5))
  }
}
function rA(e, t, n) {
  let r = Math.imul(t ^ 2654435769, 2246822507) ^ Math.imul(e + 1, 3266489909) ^ Math.imul(n, 668265263)
  return (
    (r = Math.imul(r ^ (r >>> 15), 739982445)),
    (r = Math.imul(r ^ (r >>> 12), 695872825)),
    (r ^= r >>> 15),
    ((r >>> 0) / 4294967295) * 2 - 1
  )
}
var iA = [0.25, 0.5, 1, 2, 4],
  aA = 0.004,
  oA = 11,
  sA = [`free`, `fly`, `noclip`],
  cA = 24,
  lA = 1 / 64,
  uA = 160,
  dA = 26,
  fA = 15,
  pA = 0.02,
  mA = 44,
  hA = `csdemo.roundScrubLearned`,
  gA = `<svg class="scrub-hint-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 9.5 8 5.5l4 4"/></svg>`,
  _A = `<svg class="ctrl-icon icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5.2v13.6a1.1 1.1 0 0 0 1.7.93l10.4-6.8a1.1 1.1 0 0 0 0-1.86L9.2 4.27a1.1 1.1 0 0 0-1.7.93z"/></svg>`,
  vA = `<svg class="ctrl-icon icon-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.6" width="4.2" height="14.8" rx="1.4"/><rect x="13.8" y="4.6" width="4.2" height="14.8" rx="1.4"/></svg>`
function yA(e) {
  let t = e > 0 ? ` transform="matrix(-1 0 0 1 24 0)"` : ``,
    n = Math.abs(e)
  return `<svg class="ctrl-icon skip-icon" viewBox="0 0 24 24" aria-hidden="true"><g${t}><path class="skip-arc" d="M12.2 3.4A8.6 8.6 0 1 1 4.55 7.7"/><path class="skip-head" d="M9.3 3.4 12.5 1.35v4.1z"/></g><text class="skip-digits${n >= 10 ? ` skip-digits-wide` : ``}" x="12" y="12" dy="0.355em" text-anchor="middle">${n}</text></svg>`
}
function bA(e) {
  let t = `${e < 0 ? `Back` : `Forward`} ${Math.abs(e)} seconds`
  return `<button class="ctrl-btn skip-btn" data-skip="${e}" type="button" aria-label="${t}" title="${t}">${yA(e)}</button>`
}
