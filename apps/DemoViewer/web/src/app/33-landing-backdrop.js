// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 52715–53504 行（切片 34/34）
// 角色：落地页 3D 背景动画 JR：landing-backdrop-canvas/mirage A 执行
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var JR = class {
  disposed = !1
  root = null
  loader = null
  clip = null
  camera = new xs(LR, 1, 20, 2e4)
  blitCamera = new Es(-1, 1, 1, -1, 0, 1)
  blurScene = new Jn()
  blurMaterial = ZR()
  blurQuad = new G(new po(2, 2), this.blurMaterial)
  players = null
  sceneTarget = null
  blurTarget = null
  cssSize = new z()
  sizeDirty = !0
  frameHandle = 0
  lastFrameAt = 0
  lastTickAt = 0
  clipTime = 0
  shownAt = 0
  opacity = -1
  matrix = new H()
  position = new B()
  scale = new B()
  rotation = new Ht()
  lookAt = new B()
  host
  onFail
  constructor(e, t) {
    ;((this.host = e),
      (this.onFail = t),
      (this.blurQuad.frustumCulled = !1),
      this.blurScene.add(this.blurQuad),
      window.addEventListener(`resize`, this.onResize),
      document.addEventListener(`visibilitychange`, this.onVisibilityChange),
      this.init().catch((e) => {
        this.disposed || this.onFail(e)
      }))
  }
  async init() {
    let e = await WR()
    if (this.disposed) return
    this.clip = e
    let t = new qD(this.host, { antialias: !1, powerPreference: `low-power` })
    this.root = t
    let n = t.renderer.domElement
    ;((n.className = `landing-backdrop-canvas`),
      n.addEventListener(`webglcontextlost`, this.onContextLost),
      t.renderer.setPixelRatio(1),
      t.setGridVisible(!1),
      t.setShadowQuality(`low`))
    let r = P_(OR)
    t.setMapEnvironment(r.hazeColor, r.skyHorizonColor, r.skyZenithColor, r.sunAzimuth, r.sunElevation)
    let i = new R_(t.scene, { raycastable: !1 })
    ;((this.loader = i), i.setClassification(r))
    let a = await i.load(OR)
    if (!this.disposed) {
      if (!a || !i.object) throw Error(`Mirage geometry is unavailable`)
      ;(t.setClassifiedMap(i.object),
        (this.players = YR(e)),
        t.scene.add(this.players),
        this.resize(),
        this.update(0),
        await this.precompile(),
        !this.disposed && ((this.lastTickAt = performance.now()), this.requestFrame()))
    }
  }
  precompile() {
    let e = this.root.renderer,
      t = []
    return (
      e.setRenderTarget(this.sceneTarget),
      t.push(VD(e, this.root.scene, this.camera)),
      e.setRenderTarget(this.blurTarget),
      t.push(VD(e, this.blurScene, this.blitCamera)),
      e.setRenderTarget(null),
      t.push(VD(e, this.blurScene, this.blitCamera)),
      Promise.all(t)
    )
  }
  onResize = () => {
    this.sizeDirty = !0
  }
  onVisibilityChange = () => {
    document.hidden
      ? (cancelAnimationFrame(this.frameHandle), (this.frameHandle = 0))
      : this.players && ((this.lastTickAt = performance.now()), this.requestFrame())
  }
  onContextLost = (e) => {
    ;(e.preventDefault(), this.disposed || this.onFail(Error(`WebGL context lost`)))
  }
  requestFrame() {
    !this.frameHandle && !this.disposed && !document.hidden && (this.frameHandle = requestAnimationFrame(this.tick))
  }
  tick = (e) => {
    if (((this.frameHandle = 0), this.disposed || (this.requestFrame(), e - this.lastFrameAt < kR - 4))) return
    this.lastFrameAt = e
    let t = Math.min((e - this.lastTickAt) / 1e3, 0.1)
    ;((this.lastTickAt = e),
      this.sizeDirty && this.resize(),
      this.update(t),
      this.render(),
      (this.shownAt ||= e),
      this.setOpacity(Math.min(1, (e - this.shownAt) / FR) * this.cutFade()))
  }
  resize() {
    this.sizeDirty = !1
    let e = this.root,
      t = Math.max(1, this.host.clientWidth),
      n = Math.max(1, this.host.clientHeight)
    this.cssSize.set(t, n)
    let r = Math.max(16, Math.min(jR, Math.round(t * AR))),
      i = Math.max(16, Math.round((r * n) / t)),
      a = Math.max(8, Math.round(t * MR)),
      o = Math.max(8, Math.round(n * MR))
    ;(e.renderer.setSize(a, o, !1),
      (this.sceneTarget = XR(this.sceneTarget, e.renderer, r, i, !0, NR)),
      (this.blurTarget = XR(this.blurTarget, e.renderer, a, o, !1)),
      (this.camera.aspect = t / n),
      this.camera.updateProjectionMatrix())
  }
  update(e) {
    let t = this.clip,
      n = this.players
    this.clipTime = (this.clipTime + e) % t.duration
    let { frame: r, next: i, t: a } = ER(t, this.clipTime),
      o = t.playerCount
    for (let e = 0; e < o; e++) {
      let s = r * o + e,
        c = i * o + e,
        l = t.flags[a < 0.5 ? s : c]
      if (!(l & 1)) this.scale.setScalar(0)
      else {
        let e = l & 2 ? 0.75 : 1
        ;(this.scale.set(1, 1, e),
          this.position.set(
            QR(t.positions[s * 3], t.positions[c * 3], a),
            QR(t.positions[s * 3 + 1], t.positions[c * 3 + 1], a),
            QR(t.positions[s * 3 + 2], t.positions[c * 3 + 2], a) + BR * e,
          ))
      }
      n.setMatrixAt(e, this.matrix.compose(this.position, this.rotation, this.scale))
    }
    n.instanceMatrix.needsUpdate = !0
    let { shot: s, progress: c } = this.currentShot()
    ;(this.camera.position.set(QR(s.from[0], s.to[0], c), QR(s.from[1], s.to[1], c), QR(s.from[2], s.to[2], c)),
      this.lookAt.set(
        QR(s.lookFrom[0], s.lookTo[0], c),
        QR(s.lookFrom[1], s.lookTo[1], c),
        QR(s.lookFrom[2], s.lookTo[2], c),
      ),
      this.camera.lookAt(this.lookAt))
  }
  currentShot() {
    let e = this.clip.duration / RR.length,
      t = Math.min(RR.length - 1, Math.floor(this.clipTime / e)),
      n = this.clipTime - t * e
    return { shot: RR[t], progress: n / e, remaining: e - n, elapsed: n }
  }
  render() {
    let e = this.root,
      t = e.renderer,
      n = this.blurMaterial.uniforms,
      r = document.documentElement.dataset.theme === `dark`
    ;(e.beginRenderFrame(),
      t.setRenderTarget(this.sceneTarget),
      e.render(this.camera),
      (n.uSource.value = this.sceneTarget.texture),
      n.uStep.value.set(PR / this.cssSize.x, 0),
      (n.uDim.value = 1),
      (n.uSaturation.value = 1),
      t.setRenderTarget(this.blurTarget),
      t.render(this.blurScene, this.blitCamera),
      (n.uSource.value = this.blurTarget.texture),
      n.uStep.value.set(0, PR / this.cssSize.y),
      (n.uDim.value = r ? 0.62 : 1),
      (n.uSaturation.value = r ? 0.85 : 0.92),
      t.setRenderTarget(null),
      t.render(this.blurScene, this.blitCamera))
  }
  cutFade() {
    let { elapsed: e, remaining: t } = this.currentShot()
    return $R(Math.min(1, Math.min(e, t) / IR))
  }
  setOpacity(e) {
    let t = Math.round(e * 100) / 100
    t === this.opacity || !this.root || ((this.opacity = t), (this.root.renderer.domElement.style.opacity = String(t)))
  }
  dispose() {
    if (this.disposed) return
    ;((this.disposed = !0),
      cancelAnimationFrame(this.frameHandle),
      window.removeEventListener(`resize`, this.onResize),
      document.removeEventListener(`visibilitychange`, this.onVisibilityChange),
      this.loader?.dispose(),
      this.players && (this.players.geometry.dispose(), this.players.material.dispose(), this.players.dispose()),
      this.sceneTarget?.dispose(),
      this.blurTarget?.dispose(),
      this.blurQuad.geometry.dispose(),
      this.blurMaterial.dispose())
    let e = this.root
    e &&
      (e.renderer.domElement.removeEventListener(`webglcontextlost`, this.onContextLost),
      e.dispose(),
      e.renderer.forceContextLoss())
  }
}
function YR(e) {
  let t = new so(zR, BR * 2 - zR * 2, 3, 10)
  t.rotateX(Math.PI / 2)
  let n = new ea(t, new _i({ color: 16777215, fog: !1 }), e.playerCount)
  ;(n.instanceMatrix.setUsage(tt), (n.frustumCulled = !1))
  for (let t = 0; t < e.playerCount; t++) n.setColorAt(t, e.teams[t] === 2 ? VR : HR)
  return n
}
function XR(e, t, n, r, i, a = 0) {
  if (e && e.width === n && e.height === r) return e
  e?.dispose()
  let o = new ln(n, r, {
    type: t.extensions.has(`EXT_color_buffer_float`) ? x : m,
    depthBuffer: i,
    stencilBuffer: !1,
    samples: a,
  })
  return ((o.texture.minFilter = d), (o.texture.magFilter = d), (o.texture.generateMipmaps = !1), o)
}
function ZR() {
  return new To({
    uniforms: { uSource: { value: null }, uStep: { value: new z() }, uDim: { value: 1 }, uSaturation: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uSource;
      uniform vec2 uStep;
      uniform float uDim;
      uniform float uSaturation;
      varying vec2 vUv;
      // A single NaN/Inf texel would otherwise smear into a hard black block across the blur.
      vec4 tap(vec2 uv) {
        vec4 c = texture2D(uSource, uv);
        return all(lessThan(abs(c), vec4(60000.0))) ? min(c, vec4(64.0)) : vec4(0.0);
      }
      void main() {
        vec4 color = tap(vUv) * 0.2270270270;
        color += (tap(vUv + uStep) + tap(vUv - uStep)) * 0.1945945946;
        color += (tap(vUv + 2.0 * uStep) + tap(vUv - 2.0 * uStep)) * 0.1216216216;
        color += (tap(vUv + 3.0 * uStep) + tap(vUv - 3.0 * uStep)) * 0.0540540541;
        color += (tap(vUv + 4.0 * uStep) + tap(vUv - 4.0 * uStep)) * 0.0162162162;
        gl_FragColor = vec4(color.rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        float luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor.rgb = mix(vec3(luma), gl_FragColor.rgb, uSaturation) * uDim;
      }`,
    depthTest: !1,
    depthWrite: !1,
  })
}
function QR(e, t, n) {
  return e + (t - e) * n
}
function $R(e) {
  return e * e * (3 - 2 * e)
}
var ez = `csplayer:sampleRate`,
  tz = 32,
  nz = [
    { rate: 16, label: `Fast`, hint: `16 Hz · quickest load` },
    { rate: 32, label: `Balanced`, hint: `32 Hz · recommended` },
    { rate: 64, label: `Precise`, hint: `64 Hz · highest fidelity` },
  ]
function rz(e) {
  let t = oz(),
    n = () => {
      ;((e.innerHTML = `
      <div class="quality-head">
        <span class="quality-label hud-label">Playback detail</span>
        <span class="quality-hint">${iz(t)}</span>
      </div>
      <div class="quality-options" role="group" aria-label="Playback detail">
        ${nz
          .map(
            (e) => `
          <button type="button" class="quality-opt${e.rate === t ? ` active` : ``}" data-rate="${e.rate}" aria-pressed="${e.rate === t}">
            <span>${e.label}</span><small>${e.rate} Hz</small>
          </button>
        `,
          )
          .join(``)}
      </div>
    `),
        e.querySelectorAll(`.quality-opt`).forEach((e) => {
          e.addEventListener(`click`, () => {
            ;((t = az(Number(e.dataset.rate))), sz(t), n())
          })
        }))
    }
  return (n(), { getSampleRate: () => t })
}
function iz(e) {
  return nz.find((t) => t.rate === e)?.hint ?? ``
}
function az(e) {
  return nz.some((t) => t.rate === e) ? e : tz
}
function oz() {
  try {
    return az(Number(localStorage.getItem(ez)))
  } catch {
    return tz
  }
}
function sz(e) {
  try {
    localStorage.setItem(ez, String(e))
  } catch {}
}
function cz(e, t) {
  let n = 0,
    r = () => {
      let i = ++n,
        a = CL()
      if ((gL(a.map((e) => e.key)), a.length === 0)) {
        e.innerHTML = `
        <div class="recents-empty">
          <span class="recents-empty-mark">00</span>
          <strong>No recent demos</strong>
          <span>Matches you open will be kept here for quick access.</span>
        </div>
      `
        return
      }
      ;((e.innerHTML = `
      <div class="recents-head">
        <span class="recents-title">${a.length} cached ${a.length === 1 ? `match` : `matches`}</span>
        <button class="recents-clear" type="button">Clear history</button>
      </div>
      <div class="recents-grid">
        ${a.map((e, t) => lz(e, t)).join(``)}
      </div>
    `),
        e.querySelector(`.recents-clear`)?.addEventListener(`click`, async (e) => {
          let t = e.currentTarget
          ;((t.disabled = !0), EL(), await hL(), r())
        }),
        e.querySelectorAll(`.recent-card`).forEach((e) => {
          e.addEventListener(`click`, () => {
            let n = a[Number(e.dataset.index)]
            n && t(n)
          })
        }),
        e.querySelectorAll(`.recent-delete`).forEach((e) => {
          e.addEventListener(`click`, async () => {
            let t = a[Number(e.dataset.index)]
            t && ((e.disabled = !0), TL(t.key), await mL(t.key), r())
          })
        }),
        Promise.all(a.map((e) => C_(e.map)))
          .then((t) => {
            i === n &&
              e.querySelectorAll(`.recent-thumb`).forEach((e, n) => {
                let r = t[n]
                r && (e.style.backgroundImage = `url("${r}")`)
              })
          })
          .catch((e) => {
            console.warn(`[csplayer] recent map logos failed:`, e)
          }))
    }
  return (r(), { refresh: r })
}
function lz(e, t) {
  return `
    <div class="recent-entry">
      <button class="recent-card" type="button" data-index="${t}" title="${mz(e.name)}">
        <span class="recent-map-identity">
          <span class="recent-map">${pz(uz(e.map))}</span>
          <span class="recent-thumb"></span>
        </span>
        <span class="recent-info">
          <span class="recent-date">${pz(fz(e.date))}</span>
          <span class="recent-score">
            <span class="recent-side rc-t"><span>${pz(e.tLabel || `T`)}</span><strong>${e.tScore | 0}</strong></span>
            <span class="rc-sep">:</span>
            <span class="recent-side rc-ct"><strong>${e.ctScore | 0}</strong><span>${pz(e.ctLabel || `CT`)}</span></span>
          </span>
          <span class="recent-meta">
            <span>${pz(dz(e.durationSeconds))}</span>
            <span>${e.sampleRate || 32} Hz</span>
          </span>
        </span>
      </button>
      <button class="recent-delete" type="button" data-index="${t}" title="Remove cached demo" aria-label="Remove ${mz(e.name)} from cached demos">&times;</button>
    </div>
  `
}
function uz(e) {
  return (
    e
      .replace(/^(de|cs|ar|dz|gd|coop)_/i, ``)
      .split(`_`)
      .filter(Boolean)
      .map((e) => e.charAt(0).toUpperCase() + e.slice(1))
      .join(` `) || e
  )
}
function dz(e) {
  let t = Math.max(0, Math.round(e))
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, `0`)}`
}
function fz(e) {
  let t = Date.now() - e,
    n = 6e4,
    r = 36e5,
    i = 864e5
  return t < n
    ? `just now`
    : t < r
      ? `${Math.floor(t / n)}m ago`
      : t < i
        ? `${Math.floor(t / r)}h ago`
        : t < 7 * i
          ? `${Math.floor(t / i)}d ago`
          : new Date(e).toLocaleDateString()
}
function pz(e) {
  return e.replace(/[&<>"']/g, (e) =>
    e === `&` ? `&amp;` : e === `<` ? `&lt;` : e === `>` ? `&gt;` : e === `"` ? `&quot;` : `&#39;`,
  )
}
function mz(e) {
  return e.replace(/[&"]/g, (e) => (e === `&` ? `&amp;` : `&quot;`))
}
var hz = document.querySelector(`#app`)
if (!hz) throw Error(`Missing #app root element`)
;(document.addEventListener(`touchstart`, () => {}, { passive: !0 }), Pj())
var $ = ML(hz)
;($.dropScreen.querySelector(`.landing-header`)?.appendChild(Rj(`theme-switch landing-theme-switch`)), GR($.dropScreen))
var gz,
  _z = 0,
  vz,
  yz,
  bz = 0.8,
  xz = 0.97,
  Sz = rz($.qualitySlot),
  Cz = cz($.recentsSlot, (e) => void Dz(e)),
  wz = QL(
    $.hostedDemosSlot,
    (e) => void Oz(e),
    () => void Tz(),
    () => $.phoneWizard.go(`match`),
  )
;(LL($, (e) => void Ez(e)), Tz())
async function Tz() {
  wz.showLoading()
  try {
    let e = await NP()
    wz.showCatalogue(e)
  } catch (e) {
    ;(wz.showError(e instanceof Error ? e.message : `Featured matches are unavailable right now.`),
      console.error(`[csplayer] failed to load hosted catalogue:`, e))
  }
}
async function Ez(e) {
  let t = ++_z
  vz?.abort()
  let n = new AbortController()
  ;((vz = n),
    gz?.dispose(),
    (gz = void 0),
    $.hideDropScreen(),
    $.hideParsingLeaveConfirmation(!0),
    $.showLoading(`Reading demo…`, Nz, { title: e.name }))
  let r = {}
  try {
    let i = performance.now(),
      a = 0,
      o = (e) => e.meta.numFrames > 0 || e.smokeVoxels.count > 0 || !!e.grenades.infernos?.length,
      s = (e) => {
        t === _z && $.setLoadingLabel(Iz(e))
      },
      c = (n, a) => {
        if (t === _z) {
          if (!r.app) {
            r.app = kz(
              n,
              { parseMs: performance.now() - i, source: `local-parse`, fileSizeBytes: e.size },
              r.manifest,
              a,
            )
            return
          }
          if (!r.app.replaceRoundData(n, a)) {
            let t = r.app.getPlaybackState()
            ;(r.app.dispose(),
              (r.app = kz(
                n,
                { parseMs: performance.now() - i, source: `local-parse`, fileSizeBytes: e.size },
                r.manifest,
                a,
              )),
              r.app.restorePlaybackState(t))
          }
        }
      },
      {
        data: l,
        key: u,
        fromCache: d,
      } = await _L(e, {
        signal: n.signal,
        sampleRate: Sz.getSampleRate(),
        onManifest: (e) => {
          t === _z &&
            ((yz = { generation: t, progress: a }),
            (r.manifest = e),
            (r.mapAssets ??= Az(e.mapName, s)),
            $.setLoadingLabel(`Loading round 1…`))
        },
        onReady: (e, t, n) => {
          ;((r.manifest = t), o(e) && c(e, n))
        },
        onRound: (e, t) => {
          o(e) && c(e, t)
        },
        onProgress: (e, n) => {
          t === _z &&
            (Number.isFinite(n) &&
              n >= 0 &&
              ((a = Math.max(a, Math.min(1, n))),
              yz?.generation === t && ((yz.progress = a), $.setParsingLeaveProgress(a))),
            !r.app && $.setLoadingLabel(Iz(e)))
        },
      })
    if (t !== _z) return
    ;((yz = void 0), $.hideParsingLeaveConfirmation())
    let f = performance.now() - i
    if (l.meta.numFrames === 0) {
      if (l.smokeVoxels.count === 0 && !l.grenades.infernos?.length)
        throw Error(`No player or recorded grenade-effect data found in this demo.`)
      Lz(l)
    }
    ;((r.mapAssets ??= Az(l.meta.mapName, s)),
      r.app
        ? c(l, r.manifest?.rounds.length ?? l.rounds.length)
        : kz(
            l,
            { parseMs: d ? null : f, source: d ? `local-cache` : `local-parse`, fileSizeBytes: e.size },
            r.manifest,
            r.manifest?.rounds.length ?? l.rounds.length,
          ),
      u && (jz(u, e.name, l, e.size), Cz.refresh()))
  } catch (e) {
    if (
      t !== _z ||
      ((yz = void 0), $.hideParsingLeaveConfirmation(!0), e instanceof DOMException && e.name === `AbortError`)
    )
      return
    r.app ? console.error(`[csplayer] background demo details failed:`, e) : Mz(e)
  } finally {
    vz === n && (vz = void 0)
  }
}
async function Dz(e) {
  let t = ++_z
  ;(vz?.abort(),
    (vz = void 0),
    gz?.dispose(),
    (gz = void 0),
    $.hideDropScreen(),
    $.hideParsingLeaveConfirmation(!0),
    $.showLoading(`Opening from your library…`, Nz, { title: e.name }))
  try {
    Az(e.map, (e) => {
      t === _z && $.setLoadingLabel(Iz(e))
    })
    let n = await vL(e.key)
    if (t !== _z) return
    if (!n || (n.meta.numFrames === 0 && n.smokeVoxels.count === 0 && !n.grenades.infernos?.length)) {
      ;(TL(e.key), Cz.refresh(), $.hideLoading(!0), $.showDropScreen())
      return
    }
    ;(n.meta.numFrames === 0 && Lz(n),
      kz(n, { parseMs: null, source: `local-cache`, fileSizeBytes: e.fileSizeBytes ?? null }),
      wL({ ...e, date: Date.now() }),
      Cz.refresh())
  } catch (e) {
    if (t !== _z) return
    Mz(e)
  }
}
async function Oz(e) {
  let t = ++_z
  vz?.abort()
  let n = new AbortController()
  ;((vz = n),
    (yz = void 0),
    gz?.dispose(),
    (gz = void 0),
    wz.setSelected(e.id),
    $.hideDropScreen(),
    $.hideParsingLeaveConfirmation(!0),
    $.showLoading(`Downloading…`, Nz, { title: e.teams?.length === 2 ? void 0 : e.matchLabel, teams: e.teams }))
  try {
    let { data: r, byteLength: i } = await XI(e, {
      signal: n.signal,
      onProgress: ({ loadedBytes: e, totalBytes: n }) => {
        t === _z &&
          (n && n > 0
            ? ($.setLoadingProgress((e / n) * bz), $.setLoadingLabel(`Downloading… ${Fz(e)} of ${Fz(n)}`))
            : $.setLoadingLabel(`Downloading… ${Fz(e)}`))
      },
    })
    if (
      t !== _z ||
      (r.meta.numFrames === 0 && Lz(r),
      $.setLoadingProgress(bz),
      await Az(r.meta.mapName, (e) => {
        t === _z && ($.setLoadingLabel(Iz(e)), $.advanceLoadingProgress(xz))
      }),
      t !== _z)
    )
      return
    let a = {
      mapName: r.meta.mapName,
      tickRate: r.meta.tickRate,
      startTick: r.meta.startTick,
      endTick: r.meta.endTick,
      durationSeconds: r.meta.durationSeconds,
      rounds: r.rounds,
    }
    kz(r, { parseMs: null, source: `hosted`, fileSizeBytes: i }, a, r.rounds.length, rL(e.teams ?? [], r.players))
  } catch (e) {
    if (t !== _z || (e instanceof DOMException && e.name === `AbortError`)) return
    Mz(e)
  } finally {
    ;(vz === n && (vz = void 0), t === _z && wz.setSelected(void 0))
  }
}
function kz(e, t, n, r, i) {
  ;($.setLoadingLabel(`Preparing ${gR(e.meta.mapName)}…`), $.advanceLoadingProgress(xz))
  let a = new TP(
    $.viewport,
    e,
    t,
    n,
    r,
    Nz,
    (e) => {
      ;($.setLoadingLabel(Iz(e)), $.advanceLoadingProgress(xz))
    },
    i,
  )
  return (
    (gz = a),
    a.ready.then(() => {
      gz === a && $.hideLoading()
    }),
    a
  )
}
async function Az(e, t) {
  await Promise.all([
    L_(e, t).catch((e) => console.warn(`[csplayer] map geometry preload failed:`, e)),
    uN(e).catch((e) => console.warn(`[csplayer] radar preload failed:`, e)),
  ])
}
function jz(e, t, n, r) {
  let i = d_(n, Math.max(0, n.meta.numFrames - 1))
  wL({
    key: e,
    name: t,
    map: n.meta.mapName,
    date: Date.now(),
    durationSeconds: n.meta.durationSeconds,
    sampleRate: n.meta.sampleRate,
    fileSizeBytes: r,
    tScore: i.tScore,
    ctScore: i.ctScore,
    tLabel: i.tLabel,
    ctLabel: i.ctLabel,
  })
}
function Mz(e) {
  ;($.showError(e instanceof Error ? e.message : String(e), Pz), console.error(`[csplayer] failed to load demo:`, e))
}
function Nz() {
  let e = yz
  if (e?.generation === _z) {
    $.showParsingLeaveConfirmation(e.progress, Pz)
    return
  }
  Pz()
}
function Pz() {
  ;(_z++,
    (yz = void 0),
    $.hideParsingLeaveConfirmation(!0),
    vz?.abort(),
    (vz = void 0),
    gz?.dispose(),
    (gz = void 0),
    $.hideLoading(!0),
    wz.setSelected(void 0),
    Cz.refresh(),
    $.showDropScreen())
}
function Fz(e) {
  return `${(e / (1024 * 1024)).toFixed(1)} MB`
}
function Iz(e) {
  return e.replace(/\b(?:de|cs|ar|dz|gd|coop)_[a-z0-9_]+/gi, (e) => gR(e))
}
function Lz(e) {
  let t = e.smokeVoxels,
    n = e.meta.tickRate,
    r = 1 / 0,
    i = -1 / 0
  for (let e = 0; e < t.count; e++) {
    let a = t.tickBegin[e]
    ;(a < r && (r = a), a + 26 * n > i && (i = a + 26 * n))
  }
  for (let t of e.grenades.infernos ?? []) ((r = Math.min(r, t.startTick)), (i = Math.max(i, t.endTick + n)))
  isFinite(r) &&
    ((e.meta.startTick = Math.max(0, r - n)),
    (e.meta.endTick = i),
    (e.meta.durationSeconds = (e.meta.endTick - e.meta.startTick) / n))
}
export {
  Gi as $,
  Kr as A,
  l as B,
  Ua as C,
  Xe as D,
  f as E,
  Oo as F,
  Ts as G,
  Rn as H,
  Do as I,
  Xs as J,
  Xa as K,
  s as L,
  H as M,
  G as N,
  ts as O,
  _i as P,
  Ye as Q,
  c as R,
  Wa as S,
  p as T,
  Es as U,
  Wo as V,
  xs as W,
  Ko as X,
  Ht as Y,
  a as Z,
  Io as _,
  Vr as a,
  z as at,
  za as b,
  Yt as c,
  zn as d,
  Bi as et,
  Ns as f,
  Wr as g,
  Hr as h,
  W as i,
  ss as it,
  Vt as j,
  As as k,
  Os as l,
  ea as m,
  Vi as n,
  Cs as nt,
  o,
  B as ot,
  Ki as p,
  Ga as q,
  lr as r,
  on as rt,
  U as s,
  Jo as st,
  Yo as t,
  Nr as tt,
  is as u,
  ze as v,
  d as w,
  ja as x,
  Be as y,
  u as z,
}
