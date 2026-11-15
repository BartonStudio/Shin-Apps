// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 43603–44733 行（切片 31/40）
// 角色：性能面板 vj：performance-*/stats-live-*/fps-chart
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var vj = class {
  root
  fpsValue
  fpsChart
  rows = new Map()
  fpsHistory = []
  demo
  container
  scorebarBounds
  config
  dragging = !1
  dragOffset = { x: 0, y: 0 }
  constructor(e, t, n, r) {
    ;((this.container = e),
      (this.demo = t),
      (this.config = n),
      (this.scorebarBounds = r),
      (this.root = document.createElement(`section`)),
      (this.root.className = `performance-overlay stats-hidden`),
      this.root.setAttribute(`aria-label`, `Performance`))
    let i = document.createElement(`div`)
    i.className = `performance-titlebar`
    let a = document.createElement(`span`)
    ;((a.className = `performance-title`), (a.textContent = `Performance`))
    let o = document.createElement(`span`)
    ;((o.className = `performance-grip`), o.setAttribute(`aria-hidden`, `true`), (o.innerHTML = Cj()))
    let s = document.createElement(`button`)
    ;((s.className = `performance-close`),
      (s.type = `button`),
      (s.title = `Close performance`),
      s.setAttribute(`aria-label`, `Close performance`),
      (s.innerHTML = `&#10005;`),
      s.addEventListener(`click`, () => this.close()),
      i.append(a, o, s),
      i.addEventListener(`pointerdown`, this.beginDrag),
      this.root.appendChild(i))
    let c = document.createElement(`div`)
    c.className = `performance-content`
    let l = document.createElement(`div`)
    l.className = `stats-live-header`
    let u = document.createElement(`span`)
    ;((u.className = `stats-live-title`),
      (u.textContent = `Live performance`),
      (this.fpsValue = document.createElement(`strong`)),
      (this.fpsValue.className = `stats-live-fps`),
      l.append(u, this.fpsValue),
      (this.fpsChart = document.createElement(`canvas`)),
      (this.fpsChart.className = `stats-fps-chart`),
      this.fpsChart.setAttribute(`aria-label`, `Frames per second over the last minute`))
    let d = document.createElement(`div`)
    ;((d.className = `stats-chart-caption`), (d.innerHTML = `<span>FPS history</span><span>60 s</span>`))
    let f = document.createElement(`div`)
    ;((f.className = `stats-live-rows`), c.append(l, this.fpsChart, d, f))
    let p = document.createElement(`section`)
    p.className = `stats-demo-section`
    let m = document.createElement(`div`)
    ;((m.className = `stats-demo-title`), (m.textContent = `Demo`), p.appendChild(m))
    for (let { key: e, label: t, group: n } of fj) {
      let r = document.createElement(`div`)
      r.className = `stats-row`
      let i = document.createElement(`span`)
      ;((i.className = `stats-key`), (i.textContent = t))
      let a = document.createElement(`span`)
      ;((a.className = `stats-val`),
        r.append(i, a),
        (n === `live` ? f : p).appendChild(r),
        this.rows.set(e, { row: r, value: a }))
    }
    ;(c.appendChild(p), this.root.appendChild(c), e.appendChild(this.root), this.renderStatic(), this.applyConfig())
  }
  setConfig(e) {
    ;((this.config = e), this.applyConfig())
  }
  show() {
    ;(this.root.classList.remove(`stats-hidden`), this.positionAtScorebar(), this.drawFpsChart())
  }
  close() {
    ;((this.dragging = !1),
      this.root.classList.add(`stats-hidden`),
      (this.root.style.left = ``),
      (this.root.style.top = ``))
  }
  reposition() {
    if (this.root.classList.contains(`stats-hidden`)) return
    let e = this.root.getBoundingClientRect(),
      t = this.container.getBoundingClientRect()
    this.setPosition(e.left - t.left, e.top - t.top, 8)
  }
  updateLive(e) {
    ;(this.fpsHistory.push(e.fps),
      this.fpsHistory.length > mj && this.fpsHistory.shift(),
      this.set(`fps`, `${Math.round(e.fps)}`),
      (this.fpsValue.textContent = `${Math.round(e.fps)} FPS`),
      this.set(`frameMs`, `${e.frameMs.toFixed(1)} ms`),
      this.set(`drawCalls`, `${e.drawCalls}`),
      this.set(`triangles`, Sj(e.triangles)),
      this.drawFpsChart())
  }
  dispose() {
    ;(window.removeEventListener(`pointermove`, this.moveDrag),
      window.removeEventListener(`pointerup`, this.endDrag),
      this.root.remove())
  }
  applyConfig() {
    for (let { key: e } of fj) this.rows.get(e)?.row.classList.toggle(`stats-row-hidden`, !this.config.metrics[e])
    ;(this.fpsValue.classList.toggle(`stats-row-hidden`, !this.config.metrics.fps),
      this.fpsChart.classList.toggle(`stats-row-hidden`, !this.config.metrics.fps),
      this.root.querySelector(`.stats-chart-caption`)?.classList.toggle(`stats-row-hidden`, !this.config.metrics.fps),
      this.config.metrics.fps && this.drawFpsChart())
  }
  renderStatic() {
    ;(this.set(
      `parse`,
      this.demo.source === `hosted`
        ? `pre-parsed`
        : this.demo.source === `local-cache`
          ? `cached`
          : this.demo.parseMs === null
            ? `—`
            : yj(this.demo.parseMs),
    ),
      this.set(`quality`, `${this.demo.sampleRate} Hz`),
      this.set(`duration`, bj(this.demo.durationSeconds)),
      this.set(`tickRate`, `${this.demo.tickRate}`),
      this.set(`fileSize`, this.demo.fileSizeBytes === null ? `—` : xj(this.demo.fileSizeBytes)))
  }
  set(e, t) {
    let n = this.rows.get(e)
    n && (n.value.textContent = t)
  }
  beginDrag = (e) => {
    if (e.button !== 0 || e.target instanceof HTMLButtonElement) return
    let t = this.root.getBoundingClientRect()
    ;((this.dragging = !0),
      (this.dragOffset.x = e.clientX - t.left),
      (this.dragOffset.y = e.clientY - t.top),
      window.addEventListener(`pointermove`, this.moveDrag),
      window.addEventListener(`pointerup`, this.endDrag))
  }
  moveDrag = (e) => {
    if (!this.dragging) return
    let t = this.container.getBoundingClientRect()
    this.setPosition(e.clientX - t.left - this.dragOffset.x, e.clientY - t.top - this.dragOffset.y, 8)
  }
  endDrag = () => {
    ;((this.dragging = !1),
      window.removeEventListener(`pointermove`, this.moveDrag),
      window.removeEventListener(`pointerup`, this.endDrag))
  }
  positionAtScorebar() {
    let e = this.container.getBoundingClientRect(),
      t = this.scorebarBounds(),
      n = t ? t.right - e.left + 12 : e.width - this.root.offsetWidth - 12,
      r = t ? t.top - e.top : 12
    ;(n + this.root.offsetWidth > e.width - 12 &&
      ((n = Math.max(12, e.width - this.root.offsetWidth - 12)), (r = t ? t.bottom - e.top + 12 : r)),
      this.setPosition(n, r, 12))
  }
  setPosition(e, t, n) {
    let r = this.container.getBoundingClientRect()
    ;((this.root.style.left = `${Math.min(Math.max(n, e), Math.max(n, r.width - this.root.offsetWidth - n))}px`),
      (this.root.style.top = `${Math.min(Math.max(n, t), Math.max(n, r.height - this.root.offsetHeight - n))}px`))
  }
  drawFpsChart() {
    let e = this.fpsChart.clientWidth,
      t = this.fpsChart.clientHeight
    if (!e || !t) return
    let n = window.devicePixelRatio || 1,
      r = Math.ceil(e * n),
      i = Math.ceil(t * n)
    ;(this.fpsChart.width !== r || this.fpsChart.height !== i) &&
      ((this.fpsChart.width = r), (this.fpsChart.height = i))
    let a = this.fpsChart.getContext(`2d`)
    if (!a) return
    ;(a.setTransform(n, 0, 0, n, 0, 0), a.clearRect(0, 0, e, t))
    let o = this.fpsHistory,
      s = Math.max(60, Math.ceil(Math.max(...o, 0) / 30) * 30),
      c = { top: 8, right: 4, bottom: 5, left: 25 },
      l = e - c.left - c.right,
      u = t - c.top - c.bottom,
      d = getComputedStyle(this.fpsChart),
      f = (e, t) => d.getPropertyValue(e).trim() || t
    ;((a.font = `500 10px ${d.fontFamily || `system-ui, sans-serif`}`),
      (a.textAlign = `right`),
      (a.textBaseline = `middle`))
    for (let t of [0, 0.5, 1]) {
      let n = c.top + u * (1 - t)
      ;((a.strokeStyle = f(`--chart-grid`, `rgba(60, 60, 67, 0.18)`)),
        (a.lineWidth = 1),
        a.beginPath(),
        a.moveTo(c.left, n + 0.5),
        a.lineTo(e - c.right, n + 0.5),
        a.stroke(),
        (a.fillStyle = f(`--chart-label`, `rgba(60, 60, 67, 0.5)`)),
        a.fillText(`${Math.round(s * t)}`, c.left - 4, n))
    }
    o.length < 2 ||
      (a.beginPath(),
      o.forEach((e, t) => {
        let n = c.left + (l * t) / (mj - 1),
          r = c.top + u * (1 - Math.min(1, e / s))
        t === 0 ? a.moveTo(n, r) : a.lineTo(n, r)
      }),
      (a.strokeStyle = f(`--chart-line`, `#007aff`)),
      (a.lineWidth = 1.5),
      (a.lineJoin = `round`),
      (a.lineCap = `round`),
      a.stroke())
  }
}
function yj(e) {
  return e < 1e3 ? `${Math.round(e)} ms` : `${(e / 1e3).toFixed(1)} s`
}
function bj(e) {
  let t = Math.max(0, Math.round(e))
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, `0`)}`
}
function xj(e) {
  if (e < 1024) return `${e} B`
  let t = e / 1024
  return t < 1024 ? `${t.toFixed(0)} KB` : `${(t / 1024).toFixed(1)} MB`
}
function Sj(e) {
  return e < 1e3 ? `${e}` : e < 1e6 ? `${(e / 1e3).toFixed(1)}k` : `${(e / 1e6).toFixed(2)}M`
}
function Cj() {
  return `<svg viewBox="0 0 20 12" focusable="false" aria-hidden="true"><circle cx="2" cy="2" r="1.75"/><circle cx="10" cy="2" r="1.75"/><circle cx="18" cy="2" r="1.75"/><circle cx="2" cy="10" r="1.75"/><circle cx="10" cy="10" r="1.75"/><circle cx="18" cy="10" r="1.75"/></svg>`
}
var wj = `csdemo:theme`,
  Tj = `(prefers-color-scheme: dark)`,
  Ej = new Set(),
  Dj = `system`,
  Oj = !1
function kj(e) {
  return e === `light` || e === `dark` ? e : `system`
}
function Aj(e, t) {
  return e === `system` ? (t ? `dark` : `light`) : e
}
function jj() {
  return Dj
}
function Mj(e) {
  Dj = kj(e)
  try {
    Dj === `system` ? localStorage.removeItem(wj) : localStorage.setItem(wj, Dj)
  } catch {}
  Fj()
  for (let e of Ej) e(Dj)
}
function Nj(e) {
  return (Ej.add(e), () => Ej.delete(e))
}
function Pj() {
  if (!Oj) {
    Oj = !0
    try {
      Dj = kj(localStorage.getItem(wj))
    } catch {
      Dj = `system`
    }
    ;(Fj(),
      window.matchMedia?.(Tj).addEventListener(`change`, () => {
        Dj === `system` && Fj()
      }))
  }
}
function Fj() {
  let e = window.matchMedia?.(Tj).matches ?? !1
  document.documentElement.dataset.theme = Aj(Dj, e)
}
var Ij = {
    light: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>`,
    system: `<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>`,
    dark: `<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>`,
  },
  Lj = { light: `Light`, system: `Auto`, dark: `Dark` }
function Rj(e = `theme-switch`) {
  let t = document.createElement(`div`)
  ;((t.className = e), t.setAttribute(`role`, `radiogroup`), t.setAttribute(`aria-label`, `Appearance`))
  let n = new Map()
  for (let e of [`light`, `system`, `dark`]) {
    let r = document.createElement(`button`)
    ;((r.type = `button`),
      (r.className = `theme-switch-option`),
      r.setAttribute(`role`, `radio`),
      (r.title = e === `system` ? `Match device` : Lj[e]),
      r.setAttribute(`aria-label`, r.title),
      (r.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${Ij[e]}</svg>`),
      r.addEventListener(`click`, () => Mj(e)),
      n.set(e, r),
      t.appendChild(r))
  }
  let r = (e) => {
    for (let [t, r] of n) {
      let n = t === e
      ;(r.classList.toggle(`active`, n), r.setAttribute(`aria-checked`, String(n)), (r.tabIndex = n ? 0 : -1))
    }
  }
  return (
    t.addEventListener(`keydown`, (e) => {
      let t = [`light`, `system`, `dark`],
        r = e.key === `ArrowRight` || e.key === `ArrowDown` ? 1 : e.key === `ArrowLeft` || e.key === `ArrowUp` ? -1 : 0
      if (!r) return
      e.preventDefault()
      let i = t[(t.indexOf(Dj) + r + t.length) % t.length]
      ;(Mj(i), n.get(i)?.focus())
    }),
    r(Dj),
    Nj(r),
    t
  )
}
var zj = Lj,
  Bj = { playerCards: !0, eventFeed: !0, nametags: !0, radar: !0, scoreboard: !0 },
  Vj = { playerCards: !1, eventFeed: !1, nametags: !1, radar: !0, scoreboard: !0 },
  Hj = (e) => (typeof e == `object` && e && !Array.isArray(e) ? e : {}),
  Uj = (e, t) => (typeof e == `boolean` ? e : t),
  Wj = (e, t, n, r) => (typeof e == `number` && Number.isFinite(e) && e >= t && e <= n ? e : r),
  Gj = (e, t, n) => t.find((t) => t === e) ?? n
function Kj(e) {
  let t = Hj(e),
    n = Hj(t.hud),
    r = {
      playerCards: Uj(n.playerCards, !0),
      eventFeed: Uj(n.eventFeed, !0),
      nametags: Uj(n.nametags, !0),
      radar: Uj(n.radar, !0),
      scoreboard: Uj(n.scoreboard, !0),
    },
    i = (e) => Object.keys(e).every((t) => r[t] === e[t])
  return {
    hud: r,
    hudPreset: t.hudPreset === `custom` ? `custom` : i(Bj) ? `full` : i(Vj) ? `minimal` : `custom`,
    flashEffect: Gj(t.flashEffect, [`full`, `reduced`, `indicator`], `full`),
    trajectories: Gj(t.trajectories, [`all`, `followed`, `selected`, `off`], `all`),
    skipFreezeTime: Uj(t.skipFreezeTime, !1),
    skipTimeouts: Uj(t.skipTimeouts, !1),
    killLeadIn: Gj(t.killLeadIn, [3, 5, 8], 5),
    utilityLeadIn: Gj(t.utilityLeadIn, [2, 3, 5, 8], 2),
    mouseSensitivity: Wj(t.mouseSensitivity, 0.25, 3, 1),
    invertLook: Uj(t.invertLook, !1),
    flySpeed: Wj(t.flySpeed, 150, 24e3, 500),
    renderScale: Gj(t.renderScale, [0.5, 0.75, 1], 1),
    volume: Wj(t.volume, 0, 100, 50),
    muted: Uj(t.muted, !1),
  }
}
var qj = `csplayer:settings`,
  Jj = [
    { value: `low`, label: `Low` },
    { value: `medium`, label: `Medium` },
    { value: `high`, label: `High` },
    { value: `ultra`, label: `Ultra` },
  ],
  Yj = [
    { value: `grid`, label: `Grid only` },
    { value: `classified`, label: `Default` },
    { value: `cs2`, label: `CS2` },
  ],
  Xj = [
    { value: `off`, label: `Off` },
    { value: `cubes`, label: `Cubes` },
    { value: `medium`, label: `Detailed` },
  ],
  Zj = class {
    root
    body
    tabButtons = new Map()
    callbacks
    dev
    stats
    tab
    open
    mode
    xray
    effects
    classification
    shadowQuality
    mapAtmosphere
    mapFilmicContrast
    smoothRoundBackfill
    cs2Options
    cs2Exposure = null
    viewer
    dragging = !1
    hasCustomPos = !1
    dragOffset = { x: 0, y: 0 }
    stopThemeSync
    constructor(e, t, n) {
      ;((this.callbacks = t), (this.dev = n.dev), (this.stats = n.stats))
      let r = Qj()
      ;((this.mode = r.mapView ? (r.mapView === `cs2` ? `cs2` : `classified`) : n.initialMap.mode),
        (this.tab = r.tab && this.tabAllowed(r.tab) ? r.tab : `visuals`),
        (this.open = !1),
        (this.xray = r.xray ?? !1),
        (this.effects = r.effectGraphics ?? `medium`),
        (this.classification = { ...n.initialMap.classification }),
        (this.shadowQuality = Jj.find((e) => e.value === r.shadowQuality)?.value ?? `medium`),
        (this.mapAtmosphere = r.mapAtmosphere ?? !0),
        (this.mapFilmicContrast = r.mapFilmicContrast ?? !0),
        (this.smoothRoundBackfill = r.smoothRoundBackfill ?? !0),
        (this.cs2Options = { visibilityCulling: r.cs2VisibilityCulling ?? !0 }),
        (this.viewer = Kj(r.viewer)),
        $j({ effectGraphics: this.effects }),
        (this.hasCustomPos = !1),
        (this.root = document.createElement(`div`)),
        (this.root.className = `settings-panel`),
        (this.root.innerHTML = `
      <div class="settings-titlebar">
        <span class="settings-title">Settings</span>
        <span class="settings-grip" aria-hidden="true">${eM()}</span>
        <button class="settings-close" type="button" title="Close" aria-label="Close settings">&#10005;</button>
      </div>
      <div class="settings-tabs"></div>
      <div class="settings-body"></div>
    `),
        e.appendChild(this.root))
      let i = this.root.querySelector(`.settings-tabs`)
      this.body = this.root.querySelector(`.settings-body`)
      let a = [
        { key: `visuals`, label: `Visuals` },
        { key: `playback`, label: `Playback` },
        { key: `camera`, label: `Camera` },
        { key: `performance`, label: `Performance` },
      ]
      this.dev && a.push({ key: `debug`, label: `Debug` })
      for (let e of a) {
        let t = document.createElement(`button`)
        ;((t.type = `button`),
          (t.className = `settings-tab`),
          (t.textContent = e.label),
          t.addEventListener(`click`, () => this.setTab(e.key)),
          i.appendChild(t),
          this.tabButtons.set(e.key, t))
      }
      ;(this.root.querySelector(`.settings-close`).addEventListener(`click`, () => this.setOpen(!1)),
        this.root.querySelector(`.settings-titlebar`).addEventListener(`pointerdown`, this.onPointerDown),
        this.renderTabs(),
        this.renderBody(),
        this.applyOpen(),
        (this.stopThemeSync = Nj(() => {
          this.tab === `visuals` && this.refreshBody(`Appearance`)
        })))
    }
    toggle() {
      this.setOpen(!this.open)
    }
    get xrayEnabled() {
      return this.xray
    }
    get effectGraphics() {
      return this.effects
    }
    get mapMode() {
      return this.mode
    }
    get cs2MapOptions() {
      return { ...this.cs2Options }
    }
    syncMapMode(e) {
      e !== this.mode && ((this.mode = e), this.tab !== `playback` && this.tab !== `camera` && this.renderBody())
    }
    syncCs2Exposure(e) {
      ;((this.cs2Exposure = e), this.tab === `debug` && this.renderBody())
    }
    get currentMapClassification() {
      return { ...this.classification }
    }
    get smoothRoundBackfillEnabled() {
      return this.smoothRoundBackfill
    }
    get viewerSettings() {
      return { ...this.viewer, hud: { ...this.viewer.hud } }
    }
    toggleRadar() {
      ;(this.setViewer({ hud: { ...this.viewer.hud, radar: !this.viewer.hud.radar } }),
        this.tab === `visuals` && this.renderBody())
    }
    reposition() {
      if (!this.open) return
      if (!this.hasCustomPos) {
        this.positionNextToRadar()
        return
      }
      let e = this.root.getBoundingClientRect(),
        t = this.parentRect()
      ;((this.root.style.left = `${Math.min(Math.max(0, e.left - t.left), Math.max(0, t.width - this.root.offsetWidth))}px`),
        (this.root.style.top = `${Math.min(Math.max(0, e.top - t.top), Math.max(0, t.height - this.root.offsetHeight))}px`))
    }
    toggleXray() {
      ;(this.setXray(!this.xray), this.tab === `visuals` && this.renderBody())
    }
    tabAllowed(e) {
      return [`visuals`, `playback`, `camera`, `performance`].includes(e) || (e === `debug` && this.dev)
    }
    setOpen(e) {
      ;(e || this.resetPosition(), (this.open = e), this.applyOpen(), $j({ left: void 0, top: void 0 }))
    }
    applyOpen() {
      ;(this.root.classList.toggle(`settings-hidden`, !this.open),
        this.open && !this.hasCustomPos && this.positionNextToRadar())
    }
    resetPosition() {
      ;((this.hasCustomPos = !1),
        (this.root.style.left = ``),
        (this.root.style.top = ``),
        (this.root.style.right = ``),
        (this.root.style.bottom = ``),
        (this.root.style.transform = ``))
    }
    positionNextToRadar() {
      let e = document.querySelector(`.radar`)
      if (!e) return
      let t = this.parentRect(),
        n = e.getBoundingClientRect(),
        r = Math.min(n.right - t.left + 8, Math.max(0, t.width - this.root.offsetWidth)),
        i = Math.min(Math.max(0, n.top - t.top), Math.max(0, t.height - this.root.offsetHeight))
      ;((this.root.style.left = `${r}px`),
        (this.root.style.top = `${i}px`),
        (this.root.style.right = `auto`),
        (this.root.style.bottom = `auto`),
        (this.root.style.transform = `none`))
    }
    setTab(e) {
      e !== this.tab && ((this.tab = e), this.renderTabs(), this.renderBody(), this.reposition(), $j({ tab: e }))
    }
    renderTabs() {
      for (let [e, t] of this.tabButtons)
        (t.classList.toggle(`active`, e === this.tab), t.setAttribute(`aria-pressed`, String(e === this.tab)))
    }
    renderBody() {
      ;(this.body.replaceChildren(),
        this.tab === `debug`
          ? this.body.appendChild(this.renderDebugTab())
          : this.tab === `performance`
            ? this.body.appendChild(this.renderPerformanceTab())
            : this.tab === `playback`
              ? this.body.appendChild(this.renderPlaybackTab())
              : this.tab === `camera`
                ? this.body.appendChild(this.renderCameraTab())
                : this.body.appendChild(this.renderVisualsTab()))
    }
    renderVisualsTab() {
      let e = document.createElement(`div`)
      e.className = `settings-section`
      let t = [
          { value: `classic`, text: `Classic` },
          { value: `cs2`, text: `CS2` },
        ],
        n = this.mode === `cs2` ? `cs2` : this.mode === `classified` ? `classic` : null
      e.appendChild(
        this.settingsGroup(
          `Map view`,
          this.segRow(
            t.map((e) => ({
              text: e.text,
              active: e.value === n,
              onClick: () => {
                ;($j({ mapView: e.value }),
                  this.setMode(e.value === `cs2` ? `cs2` : `classified`),
                  this.refreshBody(`Map view`))
              },
            })),
            `Map view`,
          ),
          this.hint(
            `Classic is a light, simplified map with player capsules and weapon icons. CS2 shows the game's textures, lighting, player and weapon models and the first-person gun, and needs a stronger GPU.`,
          ),
        ),
      )
      let r = this.choiceRow(
          `Preset`,
          this.segRow(
            [`Full`, `Minimal`, `Custom`].map((e) => ({
              text: e,
              active: this.viewer.hudPreset === e.toLowerCase(),
              onClick: () => {
                ;(e === `Custom`
                  ? this.setViewer({ hudPreset: `custom` })
                  : this.setViewer({
                      hud: { ...(e === `Full` ? Bj : Vj) },
                      hudPreset: e === `Full` ? `full` : `minimal`,
                    }),
                  this.refreshBody(`HUD preset`))
              },
            })),
            `HUD preset`,
          ),
        ),
        i = document.createElement(`div`)
      i.className = `settings-toggle-grid`
      for (let [e, t] of [
        [`playerCards`, `Player cards`],
        [`eventFeed`, `Event feed`],
        [`nametags`, `Nametags`],
        [`radar`, `Radar`],
        [`scoreboard`, `Scoreboard`],
      ])
        i.appendChild(
          this.toggleRow(t, this.viewer.hud[e], (n) => {
            ;(this.setViewer({ hud: { ...this.viewer.hud, [e]: n } }), this.refreshBody(t))
          }),
        )
      e.appendChild(this.settingsGroup(`HUD`, r, i))
      let a = this.choiceRow(
        `Flashbang effect`,
        this.viewerChoices(
          `flashEffect`,
          [
            { value: `full`, text: `Full` },
            { value: `reduced`, text: `Reduced` },
            { value: `indicator`, text: `Indicator only` },
          ],
          `Flashbang effect`,
        ),
      )
      ;(e.appendChild(
        this.settingsGroup(
          `Visibility`,
          this.toggleRow(`X-RAY`, this.xray, (e) => this.setXray(e)),
          a,
        ),
      ),
        e.appendChild(
          this.settingsGroup(
            `Utility trajectories`,
            this.viewerChoices(
              `trajectories`,
              [
                { value: `all`, text: `All` },
                { value: `followed`, text: `Followed player` },
                { value: `selected`, text: `Selected grenade` },
                { value: `off`, text: `Off` },
              ],
              `Utility trajectories`,
            ),
          ),
        ))
      let o = jj()
      return (
        e.appendChild(
          this.settingsGroup(
            `Appearance`,
            this.segRow(
              [`light`, `system`, `dark`].map((e) => ({ text: zj[e], active: e === o, onClick: () => Mj(e) })),
              `Appearance`,
            ),
          ),
        ),
        e
      )
    }
    renderPerformanceTab() {
      let e = document.createElement(`div`)
      e.className = `settings-section`
      let t = this.choiceRow(
          `Render resolution`,
          this.viewerChoices(
            `renderScale`,
            [
              { value: 0.5, text: `50%` },
              { value: 0.75, text: `75%` },
              { value: 1, text: `100%` },
            ],
            `Render resolution`,
          ),
        ),
        n = this.choiceRow(
          `Smoke & molotovs`,
          this.segRow(
            Xj.map((e) => ({
              text: e.label,
              active: e.value === this.effects,
              onClick: () => this.setEffectGraphics(e.value),
            })),
            `Smoke and molotov graphics`,
          ),
        ),
        r = this.choiceRow(
          `Sun shadows`,
          this.segRow(
            Jj.map((e) => ({
              text: e.label,
              active: e.value === this.shadowQuality,
              onClick: () => this.setShadowQuality(e.value),
            })),
            `Sun shadows`,
          ),
        )
      if ((e.appendChild(this.settingsGroup(`Rendering quality`, t, n, r)), this.mode === `cs2`)) {
        let t = this.toggleRow(`Visibility culling`, this.cs2Options.visibilityCulling, (e) =>
          this.setCs2Options({ visibilityCulling: e }),
        )
        e.appendChild(
          this.settingsGroup(
            `Map detail`,
            t,
            this.hint(
              `Visibility culling skips hidden parts of the map in first-person player views; turn it off if distant buildings go missing.`,
            ),
          ),
        )
      }
      return (e.appendChild(this.settingsGroup(`Performance display`, this.renderStatsTab())), e)
    }
    renderPlaybackTab() {
      let e = document.createElement(`div`)
      e.className = `settings-section`
      let t = document.createElement(`div`)
      return (
        (t.className = `settings-toggle-grid`),
        t.appendChild(
          this.toggleRow(`Freeze time`, this.viewer.skipFreezeTime, (e) => this.setViewer({ skipFreezeTime: e })),
        ),
        t.appendChild(this.toggleRow(`Timeouts`, this.viewer.skipTimeouts, (e) => this.setViewer({ skipTimeouts: e }))),
        e.appendChild(this.settingsGroup(`Skip downtime`, t)),
        e.appendChild(
          this.settingsGroup(
            `Replay lead-in`,
            this.choiceRow(
              `Kill replay`,
              this.viewerChoices(
                `killLeadIn`,
                [3, 5, 8].map((e) => ({ value: e, text: `${e}s` })),
                `Kill replay lead-in`,
              ),
            ),
            this.choiceRow(
              `Utility replay`,
              this.viewerChoices(
                `utilityLeadIn`,
                [2, 3, 5, 8].map((e) => ({ value: e, text: `${e}s` })),
                `Utility replay lead-in`,
              ),
            ),
          ),
        ),
        e.appendChild(
          this.settingsGroup(
            `Sound`,
            this.toggleRow(`Mute`, this.viewer.muted, (e) => this.setViewer({ muted: e })),
            this.rangeRow(`Volume`, this.viewer.volume, 0, 100, 1, (e) => this.setViewer({ volume: e })),
          ),
        ),
        e
      )
    }
    renderCameraTab() {
      let e = document.createElement(`div`)
      return (
        (e.className = `settings-section`),
        e.appendChild(
          this.settingsGroup(
            `Fly / Noclip look`,
            this.rangeRow(`Mouse sensitivity`, this.viewer.mouseSensitivity, 0.25, 3, 0.05, (e) =>
              this.setViewer({ mouseSensitivity: e }),
            ),
            this.toggleRow(`Invert vertical look`, this.viewer.invertLook, (e) => this.setViewer({ invertLook: e })),
            this.hint(`Hold Ctrl to release the mouse temporarily; Escape unlocks until a view click.`),
          ),
        ),
        e.appendChild(
          this.settingsGroup(
            `Movement`,
            this.rangeRow(`Default movement speed`, this.viewer.flySpeed, 150, 24e3, 50, (e) =>
              this.setViewer({ flySpeed: e }),
            ),
          ),
        ),
        e
      )
    }
    setViewer(e) {
      ;((this.viewer = Kj({ ...this.viewer, ...(e.hud ? { hudPreset: `custom` } : {}), ...e })),
        $j({ viewer: this.viewer }),
        this.callbacks.onViewerChange(this.viewerSettings))
    }
    viewerChoices(e, t, n) {
      return this.segRow(
        t.map((t) => ({
          text: t.text,
          active: this.viewer[e] === t.value,
          onClick: () => {
            ;(this.setViewer({ [e]: t.value }), this.refreshBody(n))
          },
        })),
        n,
      )
    }
    refreshBody(e) {
      this.renderBody()
      let t = [...this.body.querySelectorAll(`[role="switch"], [role="group"]`)].find(
        (t) => t.getAttribute(`aria-label`) === e || t.textContent === e,
      )
      ;((t?.querySelector(`[aria-pressed="true"]`) ?? t)?.focus({ preventScroll: !0 }),
        this.open && !this.hasCustomPos && this.positionNextToRadar())
    }
    hint(e) {
      let t = document.createElement(`div`)
      return ((t.className = `settings-hint`), (t.textContent = e), t)
    }
    choiceRow(e, t) {
      let n = document.createElement(`div`)
      n.className = `settings-choice-row`
      let r = document.createElement(`span`)
      return ((r.className = `settings-choice-label`), (r.textContent = e), n.append(r, t), n)
    }
    settingsGroup(e, ...t) {
      let n = document.createElement(`section`)
      ;((n.className = `settings-group`), n.setAttribute(`aria-label`, e))
      let r = document.createElement(`h3`)
      ;((r.className = `settings-group-title`), (r.textContent = e))
      let i = document.createElement(`div`)
      return ((i.className = `settings-group-content`), i.append(...t), n.append(r, i), n)
    }
    setEffectGraphics(e) {
      e !== this.effects &&
        ((this.effects = e),
        this.callbacks.onEffectGraphicsChange(e),
        $j({ effectGraphics: e }),
        this.tab === `performance` && this.refreshBody(`Smoke and molotov graphics`))
    }
    setXray(e) {
      e !== this.xray && ((this.xray = e), this.callbacks.onXrayChange(e), $j({ xray: e }))
    }
    renderStatsTab() {
      let e = document.createElement(`div`)
      e.className = `settings-section`
      let t = this.stats.getConfig(),
        n = document.createElement(`div`)
      n.className = `settings-metrics`
      for (let e of [`live`, `demo`]) {
        let r = document.createElement(`div`)
        ;((r.className = `settings-metric-group`), r.appendChild(this.sectionLabel(e === `live` ? `Live` : `Demo`)))
        for (let n of fj.filter((t) => t.group === e))
          r.appendChild(
            this.toggleRow(n.label, t.metrics[n.key], (e) => {
              let t = this.stats.getConfig()
              this.stats.setConfig({ ...t, metrics: { ...t.metrics, [n.key]: e } })
            }),
          )
        n.appendChild(r)
      }
      return (e.appendChild(n), e)
    }
    toggleRow(e, t, n) {
      let r = document.createElement(`div`)
      ;((r.className = `settings-toggle`),
        r.setAttribute(`role`, `switch`),
        r.setAttribute(`aria-checked`, String(t)),
        (r.tabIndex = 0))
      let i = document.createElement(`span`)
      ;((i.className = `settings-toggle-label`), (i.textContent = e))
      let a = document.createElement(`span`)
      ;((a.className = `settings-switch${t ? ` on` : ``}`), r.append(i, a))
      let o = () => {
        let e = !a.classList.contains(`on`)
        ;(a.classList.toggle(`on`, e), r.setAttribute(`aria-checked`, String(e)), n(e))
      }
      return (
        r.addEventListener(`click`, o),
        r.addEventListener(`keydown`, (e) => {
          ;(e.key === ` ` || e.key === `Enter`) && (e.preventDefault(), o())
        }),
        r
      )
    }
    renderDebugTab() {
      let e = document.createElement(`div`)
      return (
        (e.className = `settings-section`),
        e.appendChild(
          this.settingsGroup(
            `Map source`,
            this.segRow(
              Yj.map((e) => ({ text: e.label, active: e.value === this.mode, onClick: () => this.setMode(e.value) })),
            ),
          ),
        ),
        this.mode === `classified` &&
          (e.appendChild(
            this.settingsGroup(
              `Classification thresholds`,
              this.rangeRow(`Roof height`, this.classification.roofHeight, 0.1, 0.9, 0.01, (e) =>
                this.setClassification({ roofHeight: e }),
              ),
              this.rangeRow(`Small-object cutoff`, this.classification.detailSpan, 25, 500, 5, (e) =>
                this.setClassification({ detailSpan: e }),
              ),
              this.hint(`Lower the cutoff to classify fewer pieces as Detail.`),
            ),
          ),
          e.appendChild(
            this.settingsGroup(
              `Lighting`,
              this.rangeRow(`Sun azimuth`, this.classification.sunAzimuth, 0, 360, 1, (e) =>
                this.setMapEnvironment({ sunAzimuth: e }),
              ),
              this.rangeRow(`Sun elevation`, this.classification.sunElevation, 0, 90, 1, (e) =>
                this.setMapEnvironment({ sunElevation: e }),
              ),
              this.toggleRow(`Atmospheric haze`, this.mapAtmosphere, (e) => this.setMapAtmosphere(e)),
              this.toggleRow(`Filmic contrast`, this.mapFilmicContrast, (e) => this.setMapFilmicContrast(e)),
            ),
          )),
        this.mode === `cs2` &&
          this.cs2Exposure !== null &&
          e.appendChild(
            this.settingsGroup(
              `CS2 lighting`,
              this.rangeRow(`Exposure`, this.cs2Exposure, 0.25, 3, 0.05, (e) => {
                ;((this.cs2Exposure = e), this.callbacks.onCs2ExposureChange(e))
              }),
            ),
          ),
        e.appendChild(
          this.settingsGroup(
            `Playback loading`,
            this.toggleRow(`Smooth round backfill`, this.smoothRoundBackfill, (e) => {
              ;((this.smoothRoundBackfill = e),
                $j({ smoothRoundBackfill: e }),
                this.callbacks.onSmoothRoundBackfillChange(e))
            }),
          ),
        ),
        e
      )
    }
    setMode(e) {
      e !== this.mode && ((this.mode = e), this.renderBody(), this.callbacks.onMapChange(this.mode))
    }
    setCs2Options(e) {
      let t = { ...this.cs2Options, ...e }
      t.visibilityCulling !== this.cs2Options.visibilityCulling &&
        ((this.cs2Options = t),
        $j({ cs2VisibilityCulling: t.visibilityCulling }),
        this.callbacks.onCs2MapOptionsChange({ ...t }))
    }
    setClassification(e) {
      ;((this.classification = { ...this.classification, ...e }),
        this.callbacks.onMapClassificationChange(this.classification))
    }
    setMapEnvironment(e) {
      ;((this.classification = { ...this.classification, ...e }),
        this.callbacks.onMapEnvironmentChange(this.classification))
    }
    setShadowQuality(e) {
      e !== this.shadowQuality &&
        ((this.shadowQuality = e),
        $j({ shadowQuality: e }),
        this.callbacks.onShadowQualityChange(e),
        this.tab === `performance` && this.refreshBody(`Sun shadows`))
    }
    setMapAtmosphere(e) {
      ;((this.mapAtmosphere = e), $j({ mapAtmosphere: e }), this.callbacks.onMapAtmosphereChange(e))
    }
    setMapFilmicContrast(e) {
      ;((this.mapFilmicContrast = e), $j({ mapFilmicContrast: e }), this.callbacks.onMapFilmicContrastChange(e))
    }
    get currentShadowQuality() {
      return this.shadowQuality
    }
    get mapAtmosphereEnabled() {
      return this.mapAtmosphere
    }
    get mapFilmicContrastEnabled() {
      return this.mapFilmicContrast
    }
    rangeRow(e, t, n, r, i, a) {
      let o = document.createElement(`label`)
      o.className = `settings-range`
      let s = document.createElement(`span`)
      s.textContent = e
      let c = document.createElement(`output`)
      c.textContent = t.toFixed(i < 1 ? 2 : 0)
      let l = document.createElement(`input`)
      return (
        (l.type = `range`),
        (l.min = String(n)),
        (l.max = String(r)),
        (l.step = String(i)),
        (l.value = String(t)),
        l.setAttribute(`aria-label`, e),
        l.addEventListener(`input`, () => {
          let e = Number(l.value)
          ;((c.textContent = e.toFixed(i < 1 ? 2 : 0)), a(e))
        }),
        o.append(s, l, c),
        o
      )
    }
    sectionLabel(e) {
      let t = document.createElement(`div`)
      return ((t.className = `settings-seclabel`), (t.textContent = e), t)
    }
    segRow(e, t) {
      let n = document.createElement(`div`)
      ;((n.className = `settings-seg`), t && (n.setAttribute(`role`, `group`), n.setAttribute(`aria-label`, t)))
      for (let t of e) {
        let e = document.createElement(`button`)
        ;((e.type = `button`),
          (e.className = `settings-seg-btn${t.active ? ` active` : ``}`),
          (e.textContent = t.text),
          e.setAttribute(`aria-pressed`, String(t.active)),
          e.addEventListener(`click`, t.onClick),
          n.appendChild(e))
      }
      return n
    }
    onPointerDown = (e) => {
      if (e.target.closest(`button`)) return
      let t = this.root.getBoundingClientRect(),
        n = this.parentRect()
      ;((this.root.style.left = `${t.left - n.left}px`),
        (this.root.style.top = `${t.top - n.top}px`),
        (this.root.style.right = `auto`),
        (this.root.style.bottom = `auto`),
        (this.root.style.transform = `none`),
        (this.dragOffset.x = e.clientX - t.left),
        (this.dragOffset.y = e.clientY - t.top),
        (this.dragging = !0),
        window.addEventListener(`pointermove`, this.onPointerMove),
        window.addEventListener(`pointerup`, this.onPointerUp),
        e.preventDefault())
    }
    onPointerMove = (e) => {
      if (!this.dragging) return
      let t = this.parentRect(),
        n = Math.max(0, t.width - this.root.offsetWidth),
        r = Math.max(0, t.height - this.root.offsetHeight),
        i = Math.min(Math.max(0, e.clientX - t.left - this.dragOffset.x), n),
        a = Math.min(Math.max(0, e.clientY - t.top - this.dragOffset.y), r)
      ;((this.root.style.left = `${i}px`), (this.root.style.top = `${a}px`))
    }
    onPointerUp = () => {
      ;((this.dragging = !1),
        (this.hasCustomPos = !0),
        window.removeEventListener(`pointermove`, this.onPointerMove),
        window.removeEventListener(`pointerup`, this.onPointerUp),
        $j({ left: parseFloat(this.root.style.left) || 0, top: parseFloat(this.root.style.top) || 0 }))
    }
    parentRect() {
      return this.root.offsetParent?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    }
    dispose() {
      ;(window.removeEventListener(`pointermove`, this.onPointerMove),
        window.removeEventListener(`pointerup`, this.onPointerUp),
        this.stopThemeSync(),
        this.root.remove())
    }
  }
function Qj() {
  try {
    let e = JSON.parse(localStorage.getItem(qj) || `{}`)
    if (!e || typeof e != `object` || Array.isArray(e)) return {}
    let t = (e) => (e === `off` || e === `cubes` ? e : `medium`),
      n =
        e.effectGraphics === void 0
          ? e.smokeGraphics === void 0
            ? e.smoke === void 0
              ? e.molotovGraphics === void 0
                ? `medium`
                : t(e.molotovGraphics)
              : ((e) => (e === `off` ? `cubes` : `medium`))(e.smoke)
            : t(e.smokeGraphics)
          : t(e.effectGraphics)
    for (let t of [
      `smoke`,
      `smokeGraphics`,
      `molotovGraphics`,
      `smokeSolid`,
      `smokeMode`,
      `smokeSize`,
      `smokeRotation`,
      `smokeStyle`,
      `smokeCompareStyle`,
      `smokeCompare`,
      `fireStyle`,
      `fireCompareStyle`,
      `fireCompare`,
    ])
      delete e[t]
    return (
      `mapClassification` in e && (delete e.mapClassification, localStorage.setItem(qj, JSON.stringify(e))),
      { ...e, effectGraphics: n, tab: e.tab === `stats` ? `performance` : e.tab }
    )
  } catch (e) {
    return (console.warn(`[csplayer] Could not load settings:`, e), {})
  }
}
function $j(e) {
  try {
    let t = Qj()
    localStorage.setItem(qj, JSON.stringify({ ...t, ...e }))
  } catch (e) {
    console.warn(`[csplayer] Could not save settings:`, e)
  }
}
function eM() {
  return `<svg viewBox="0 0 20 12" focusable="false" aria-hidden="true"><circle cx="2" cy="2" r="1.75"/><circle cx="10" cy="2" r="1.75"/><circle cx="18" cy="2" r="1.75"/><circle cx="2" cy="10" r="1.75"/><circle cx="10" cy="10" r="1.75"/><circle cx="18" cy="10" r="1.75"/></svg>`
}
var tM = 0.42,
  nM = 0.07
function rM(e) {
  let t = e
    .replace(/^weapon_/i, ``)
    .replace(/[\s-]/g, ``)
    .toLowerCase()
  return t === `aug` || t === `sg553` || t === `sg556` ? `rifle` : `sniper`
}
function iM(e) {
  let t = e
    .replace(/^weapon_/i, ``)
    .replace(/[\s-]/g, ``)
    .toLowerCase()
  return t === `awp` || t === `ssg08` || t === `scar20` || t === `g3sg1`
}
function aM(e, t, n, r, i, a) {
  let o = e
      .replace(/^weapon_/i, ``)
      .replace(/[\s-]/g, ``)
      .toLowerCase(),
    s = o === `ssg08` || o === `scout`
  if (o !== `awp` && !s) return 0
  let c = Math.max(0, Math.min(1, (t / (s ? 230 : 100) - 0.34) / 0.6099999999999999)),
    l = 0.002 - Math.max(0, Math.min(1, r)) * 5e-4,
    u = (n >= 0 ? Math.max(0, n - l) : 0) + c * c * (s ? 0.03 : 0.09),
    d = a / (2 * Math.tan(((i === 2 ? 20 : 40) * Math.PI) / 360))
  return Math.min(3, u * d * 0.06)
}
