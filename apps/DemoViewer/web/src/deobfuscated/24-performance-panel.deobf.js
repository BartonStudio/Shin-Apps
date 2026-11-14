// ============================================================================
// 24-performance-panel.deobf.js —— 性能面板 + 主题管理 + 设置面板
// 来源：src/app/24-performance-panel.js（Vite 生产构建，prettier 展开版）
// 原始标识符已语义化重命名 + 补充中文注释。
//
// 包含三块：
//   PerformancePanel  vj  —— 可拖拽的性能统计面板（FPS 历史图 + 实时/回放指标）
//   ThemeManager          —— 明暗主题管理（light/system/dark，localStorage 持久化）
//   SettingsPanel     Zj  —— 设置面板（可视化/回放/相机/性能/调试五 tab）
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 一、PerformancePanel —— 性能统计面板
//     显示 FPS 历史曲线（60s）+ 实时渲染指标（帧耗时/绘制调用/三角形数）+ 回放元数据。
//     可通过标题栏拖拽，可关闭。
// ────────────────────────────────────────────────────────────────────────────
const FPS_HISTORY_LEN = 120   // 历史采样点（约 60s，0.5s 一次）

class PerformancePanel {
  root
  fpsValue
  fpsChart
  rows = new Map()
  fpsHistory = []
  demo
  container
  scorebarBounds
  config
  dragging = false
  dragOffset = { x: 0, y: 0 }

  constructor(container, demo, config, scorebarBounds) {
    this.container = container
    this.demo = demo
    this.config = config
    this.scorebarBounds = scorebarBounds

    this.root = document.createElement(`section`)
    this.root.className = `performance-overlay stats-hidden`
    this.root.setAttribute(`aria-label`, `Performance`)

    // 标题栏（可拖拽）
    let titlebar = document.createElement(`div`)
    titlebar.className = `performance-titlebar`
    let title = document.createElement(`span`)
    title.className = `performance-title`
    title.textContent = `Performance`
    let grip = document.createElement(`span`)
    grip.className = `performance-grip`
    grip.setAttribute(`aria-hidden`, `true`)
    grip.innerHTML = gripIconSvg()
    let closeBtn = document.createElement(`button`)
    closeBtn.className = `performance-close`
    closeBtn.type = `button`
    closeBtn.title = `Close performance`
    closeBtn.setAttribute(`aria-label`, `Close performance`)
    closeBtn.innerHTML = `&#10005;`
    closeBtn.addEventListener(`click`, () => this.close())
    titlebar.append(title, grip, closeBtn)
    titlebar.addEventListener(`pointerdown`, this.beginDrag)
    this.root.appendChild(titlebar)

    let content = document.createElement(`div`)
    content.className = `performance-content`
    let liveHeader = document.createElement(`div`)
    liveHeader.className = `stats-live-header`
    let liveTitle = document.createElement(`span`)
    liveTitle.className = `stats-live-title`
    liveTitle.textContent = `Live performance`
    this.fpsValue = document.createElement(`strong`)
    this.fpsValue.className = `stats-live-fps`
    liveHeader.append(liveTitle, this.fpsValue)

    this.fpsChart = document.createElement(`canvas`)
    this.fpsChart.className = `stats-fps-chart`
    this.fpsChart.setAttribute(`aria-label`, `Frames per second over the last minute`)

    let chartCaption = document.createElement(`div`)
    chartCaption.className = `stats-chart-caption`
    chartCaption.innerHTML = `<span>FPS history</span><span>60 s</span>`

    let liveRows = document.createElement(`div`)
    liveRows.className = `stats-live-rows`
    content.append(liveHeader, this.fpsChart, chartCaption, liveRows)

    // 回放元数据区
    let demoSection = document.createElement(`section`)
    demoSection.className = `stats-demo-section`
    let demoTitle = document.createElement(`div`)
    demoTitle.className = `stats-demo-title`
    demoTitle.textContent = `Demo`
    demoSection.appendChild(demoTitle)

    for (let { key, label, group } of STATS_METRICS) {
      let row = document.createElement(`div`)
      row.className = `stats-row`
      let keyEl = document.createElement(`span`)
      keyEl.className = `stats-key`
      keyEl.textContent = label
      let valEl = document.createElement(`span`)
      valEl.className = `stats-val`
      row.append(keyEl, valEl)
      ;(group === `live` ? liveRows : demoSection).appendChild(row)
      this.rows.set(key, { row, value: valEl })
    }
    content.appendChild(demoSection)
    this.root.appendChild(content)
    container.appendChild(this.root)
    this.renderStatic()
    this.applyConfig()
  }

  setConfig(config) { this.config = config; this.applyConfig() }
  show() { this.root.classList.remove(`stats-hidden`); this.positionAtScorebar(); this.drawFpsChart() }
  close() { this.dragging = false; this.root.classList.add(`stats-hidden`); this.root.style.left = ``; this.root.style.top = `` }

  reposition() {
    if (this.root.classList.contains(`stats-hidden`)) return
    let rect = this.root.getBoundingClientRect()
    let parent = this.container.getBoundingClientRect()
    this.setPosition(rect.left - parent.left, rect.top - parent.top, 8)
  }

  updateLive(metrics) {
    this.fpsHistory.push(metrics.fps)
    if (this.fpsHistory.length > FPS_HISTORY_LEN) this.fpsHistory.shift()
    this.set(`fps`, `${Math.round(metrics.fps)}`)
    this.fpsValue.textContent = `${Math.round(metrics.fps)} FPS`
    this.set(`frameMs`, `${metrics.frameMs.toFixed(1)} ms`)
    this.set(`drawCalls`, `${metrics.drawCalls}`)
    this.set(`triangles`, formatCount(metrics.triangles))
    this.drawFpsChart()
  }

  dispose() {
    window.removeEventListener(`pointermove`, this.moveDrag)
    window.removeEventListener(`pointerup`, this.endDrag)
    this.root.remove()
  }

  applyConfig() {
    for (let { key } of STATS_METRICS) this.rows.get(key)?.row.classList.toggle(`stats-row-hidden`, !this.config.metrics[key])
    this.fpsValue.classList.toggle(`stats-row-hidden`, !this.config.metrics.fps)
    this.fpsChart.classList.toggle(`stats-row-hidden`, !this.config.metrics.fps)
    this.root.querySelector(`.stats-chart-caption`)?.classList.toggle(`stats-row-hidden`, !this.config.metrics.fps)
    if (this.config.metrics.fps) this.drawFpsChart()
  }

  renderStatic() {
    this.set(`parse`,
      this.demo.source === `hosted` ? `pre-parsed`
        : this.demo.source === `local-cache` ? `cached`
        : this.demo.parseMs === null ? `—`
        : formatMs(this.demo.parseMs))
    this.set(`quality`, `${this.demo.sampleRate} Hz`)
    this.set(`duration`, formatClock(this.demo.durationSeconds))
    this.set(`tickRate`, `${this.demo.tickRate}`)
    this.set(`fileSize`, this.demo.fileSizeBytes === null ? `—` : formatBytes(this.demo.fileSizeBytes))
  }

  set(key, value) { let row = this.rows.get(key); if (row) row.value.textContent = value }

  beginDrag = (e) => {
    if (e.button !== 0 || e.target instanceof HTMLButtonElement) return
    let rect = this.root.getBoundingClientRect()
    this.dragging = true
    this.dragOffset.x = e.clientX - rect.left
    this.dragOffset.y = e.clientY - rect.top
    window.addEventListener(`pointermove`, this.moveDrag)
    window.addEventListener(`pointerup`, this.endDrag)
  }
  moveDrag = (e) => {
    if (!this.dragging) return
    let parent = this.container.getBoundingClientRect()
    this.setPosition(e.clientX - parent.left - this.dragOffset.x, e.clientY - parent.top - this.dragOffset.y, 8)
  }
  endDrag = () => { this.dragging = false; window.removeEventListener(`pointermove`, this.moveDrag); window.removeEventListener(`pointerup`, this.endDrag) }

  positionAtScorebar() {
    let parent = this.container.getBoundingClientRect()
    let bounds = this.scorebarBounds()
    let x = bounds ? bounds.right - parent.left + 12 : parent.width - this.root.offsetWidth - 12
    let y = bounds ? bounds.top - parent.top : 12
    if (x + this.root.offsetWidth > parent.width - 12) {
      x = Math.max(12, parent.width - this.root.offsetWidth - 12)
      y = bounds ? bounds.bottom - parent.top + 12 : y
    }
    this.setPosition(x, y, 12)
  }

  setPosition(x, y, margin) {
    let parent = this.container.getBoundingClientRect()
    this.root.style.left = `${Math.min(Math.max(margin, x), Math.max(margin, parent.width - this.root.offsetWidth - margin))}px`
    this.root.style.top = `${Math.min(Math.max(margin, y), Math.max(margin, parent.height - this.root.offsetHeight - margin))}px`
  }

  drawFpsChart() {
    let w = this.fpsChart.clientWidth
    let h = this.fpsChart.clientHeight
    if (!w || !h) return
    let dpr = window.devicePixelRatio || 1
    let pw = Math.ceil(w * dpr)
    let ph = Math.ceil(h * dpr)
    if (this.fpsChart.width !== pw || this.fpsChart.height !== ph) { this.fpsChart.width = pw; this.fpsChart.height = ph }
    let ctx = this.fpsChart.getContext(`2d`)
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    let history = this.fpsHistory
    let maxY = Math.max(60, Math.ceil(Math.max(...history, 0) / 30) * 30)
    let pad = { top: 8, right: 4, bottom: 5, left: 25 }
    let plotW = w - pad.left - pad.right
    let plotH = h - pad.top - pad.bottom
    let style = getComputedStyle(this.fpsChart)
    let css = (prop, fallback) => style.getPropertyValue(prop).trim() || fallback

    ctx.font = `500 10px ${style.fontFamily || `system-ui, sans-serif`}`
    ctx.textAlign = `right`
    ctx.textBaseline = `middle`

    // 网格线 + 刻度
    for (let frac of [0, 0.5, 1]) {
      let y = pad.top + plotH * (1 - frac)
      ctx.strokeStyle = css(`--chart-grid`, `rgba(60, 60, 67, 0.18)`)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(pad.left, y + 0.5)
      ctx.lineTo(w - pad.right, y + 0.5)
      ctx.stroke()
      ctx.fillStyle = css(`--chart-label`, `rgba(60, 60, 67, 0.5)`)
      ctx.fillText(`${Math.round(maxY * frac)}`, pad.left - 4, y)
    }

    // FPS 折线
    if (history.length >= 2) {
      ctx.beginPath()
      history.forEach((fps, i) => {
        let x = pad.left + (plotW * i) / (FPS_HISTORY_LEN - 1)
        let y = pad.top + plotH * (1 - Math.min(1, fps / maxY))
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.strokeStyle = css(`--chart-line`, `#007aff`)
      ctx.lineWidth = 1.5
      ctx.lineJoin = `round`
      ctx.lineCap = `round`
      ctx.stroke()
    }
  }
}

function formatMs(ms) { return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s` }
function formatClock(seconds) { let t = Math.max(0, Math.round(seconds)); return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, `0`)}` }
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  let kb = bytes / 1024
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`
}
function formatCount(n) { return n < 1000 ? `${n}` : n < 1e6 ? `${(n / 1e3).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M` }
function gripIconSvg() {
  return `<svg viewBox="0 0 20 12" focusable="false" aria-hidden="true"><circle cx="2" cy="2" r="1.75"/><circle cx="10" cy="2" r="1.75"/><circle cx="18" cy="2" r="1.75"/><circle cx="2" cy="10" r="1.75"/><circle cx="10" cy="10" r="1.75"/><circle cx="18" cy="10" r="1.75"/></svg>`
}

// ────────────────────────────────────────────────────────────────────────────
// 二、ThemeManager —— 明暗主题管理
// ────────────────────────────────────────────────────────────────────────────
const THEME_STORAGE_KEY = `csdemo:theme`
const DARK_QUERY = `(prefers-color-scheme: dark)`
const themeListeners = new Set()
let currentTheme = `system`
let themeInitialized = false

function normalizeTheme(theme) { return theme === `light` || theme === `dark` ? theme : `system` }
function resolveTheme(theme, prefersDark) { return theme === `system` ? (prefersDark ? `dark` : `light`) : theme }
function getCurrentTheme() { return currentTheme }

function setTheme(theme) {
  currentTheme = normalizeTheme(theme)
  try { currentTheme === `system` ? localStorage.removeItem(THEME_STORAGE_KEY) : localStorage.setItem(THEME_STORAGE_KEY, currentTheme) } catch {}
  applyTheme()
  for (let listener of themeListeners) listener(currentTheme)
}
function onThemeChange(listener) { themeListeners.add(listener); return () => themeListeners.delete(listener) }

function initTheme() {
  if (!themeInitialized) {
    themeInitialized = true
    try { currentTheme = normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY)) } catch { currentTheme = `system` }
    applyTheme()
    window.matchMedia?.(DARK_QUERY).addEventListener(`change`, () => { if (currentTheme === `system`) applyTheme() })
  }
}
function applyTheme() {
  let prefersDark = window.matchMedia?.(DARK_QUERY).matches ?? false
  document.documentElement.dataset.theme = resolveTheme(currentTheme, prefersDark)
}

// 主题切换按钮组
const THEME_ICONS = {
  light: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>`,
  system: `<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>`,
  dark: `<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>`,
}
const THEME_LABELS = { light: `Light`, system: `Auto`, dark: `Dark` }

function createThemeSwitch(cls = `theme-switch`) {
  let root = document.createElement(`div`)
  root.className = cls
  root.setAttribute(`role`, `radiogroup`)
  root.setAttribute(`aria-label`, `Appearance`)
  let buttons = new Map()
  for (let theme of [`light`, `system`, `dark`]) {
    let btn = document.createElement(`button`)
    btn.type = `button`
    btn.className = `theme-switch-option`
    btn.setAttribute(`role`, `radio`)
    btn.title = theme === `system` ? `Match device` : THEME_LABELS[theme]
    btn.setAttribute(`aria-label`, btn.title)
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${THEME_ICONS[theme]}</svg>`
    btn.addEventListener(`click`, () => setTheme(theme))
    buttons.set(theme, btn)
    root.appendChild(btn)
  }
  let sync = (theme) => {
    for (let [key, btn] of buttons) {
      let active = key === theme
      btn.classList.toggle(`active`, active)
      btn.setAttribute(`aria-checked`, String(active))
      btn.tabIndex = active ? 0 : -1
    }
  }
  root.addEventListener(`keydown`, (e) => {
    let order = [`light`, `system`, `dark`]
    let dir = e.key === `ArrowRight` || e.key === `ArrowDown` ? 1 : e.key === `ArrowLeft` || e.key === `ArrowUp` ? -1 : 0
    if (!dir) return
    e.preventDefault()
    let next = order[(order.indexOf(currentTheme) + dir + order.length) % order.length]
    setTheme(next)
    buttons.get(next)?.focus()
  })
  sync(currentTheme)
  onThemeChange(sync)
  return root
}

// ────────────────────────────────────────────────────────────────────────────
// 三、SettingsPanel —— 设置面板
//     五个 tab：Visuals（可视化）/ Playback（回放）/ Camera（相机）/ Performance / Debug。
//     所有设置持久化到 localStorage，通过 callbacks 通知主控层。
// ────────────────────────────────────────────────────────────────────────────
const SETTINGS_STORAGE_KEY = `csplayer:settings`
const SHADOW_QUALITIES = [
  { value: `low`, label: `Low` },
  { value: `medium`, label: `Medium` },
  { value: `high`, label: `High` },
  { value: `ultra`, label: `Ultra` },
]
const MAP_MODES = [
  { value: `grid`, label: `Grid only` },
  { value: `classified`, label: `Default` },
  { value: `cs2`, label: `CS2` },
]
const EFFECT_GRAPHICS = [
  { value: `off`, label: `Off` },
  { value: `cubes`, label: `Cubes` },
  { value: `medium`, label: `Detailed` },
]

class SettingsPanel {
  root
  body
  tabButtons = new Map()
  callbacks
  dev
  stats
  tab
  open
  mode            // 地图模式：grid / classified / cs2
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
  dragging = false
  hasCustomPos = false
  dragOffset = { x: 0, y: 0 }
  stopThemeSync

  constructor(container, callbacks, options) {
    this.callbacks = callbacks
    this.dev = options.dev
    this.stats = options.stats

    let saved = loadSettings()
    this.mode = saved.mapView ? (saved.mapView === `cs2` ? `cs2` : `classified`) : options.initialMap.mode
    this.tab = saved.tab && this.tabAllowed(saved.tab) ? saved.tab : `visuals`
    this.open = false
    this.xray = saved.xray ?? false
    this.effects = saved.effectGraphics ?? `medium`
    this.classification = { ...options.initialMap.classification }
    this.shadowQuality = SHADOW_QUALITIES.find((q) => q.value === saved.shadowQuality)?.value ?? `medium`
    this.mapAtmosphere = saved.mapAtmosphere ?? true
    this.mapFilmicContrast = saved.mapFilmicContrast ?? true
    this.smoothRoundBackfill = saved.smoothRoundBackfill ?? true
    this.cs2Options = { visibilityCulling: saved.cs2VisibilityCulling ?? true }
    this.viewer = parseViewerSettings(saved.viewer)
    saveSettings({ effectGraphics: this.effects })
    this.hasCustomPos = false

    this.root = document.createElement(`div`)
    this.root.className = `settings-panel`
    this.root.innerHTML = `
      <div class="settings-titlebar">
        <span class="settings-title">Settings</span>
        <span class="settings-grip" aria-hidden="true">${gripIconSvg()}</span>
        <button class="settings-close" type="button" title="Close" aria-label="Close settings">&#10005;</button>
      </div>
      <div class="settings-tabs"></div>
      <div class="settings-body"></div>
    `
    container.appendChild(this.root)

    let tabsEl = this.root.querySelector(`.settings-tabs`)
    this.body = this.root.querySelector(`.settings-body`)
    let tabs = [
      { key: `visuals`, label: `Visuals` },
      { key: `playback`, label: `Playback` },
      { key: `camera`, label: `Camera` },
      { key: `performance`, label: `Performance` },
    ]
    if (this.dev) tabs.push({ key: `debug`, label: `Debug` })
    for (let tab of tabs) {
      let btn = document.createElement(`button`)
      btn.type = `button`
      btn.className = `settings-tab`
      btn.textContent = tab.label
      btn.addEventListener(`click`, () => this.setTab(tab.key))
      tabsEl.appendChild(btn)
      this.tabButtons.set(tab.key, btn)
    }
    this.root.querySelector(`.settings-close`).addEventListener(`click`, () => this.setOpen(false))
    this.root.querySelector(`.settings-titlebar`).addEventListener(`pointerdown`, this.onPointerDown)
    this.renderTabs()
    this.renderBody()
    this.applyOpen()
    this.stopThemeSync = onThemeChange(() => { if (this.tab === `visuals`) this.refreshBody(`Appearance`) })
  }

  toggle() { this.setOpen(!this.open) }
  get xrayEnabled() { return this.xray }
  get effectGraphics() { return this.effects }
  get mapMode() { return this.mode }
  get cs2MapOptions() { return { ...this.cs2Options } }
  get currentMapClassification() { return { ...this.classification } }
  get smoothRoundBackfillEnabled() { return this.smoothRoundBackfill }
  get viewerSettings() { return { ...this.viewer, hud: { ...this.viewer.hud } } }

  syncMapMode(mode) { if (mode !== this.mode) { this.mode = mode; if (this.tab !== `playback` && this.tab !== `camera`) this.renderBody() } }
  syncCs2Exposure(exposure) { this.cs2Exposure = exposure; if (this.tab === `debug`) this.renderBody() }

  toggleRadar() {
    this.setViewer({ hud: { ...this.viewer.hud, radar: !this.viewer.hud.radar } })
    if (this.tab === `visuals`) this.renderBody()
  }
  toggleXray() { this.setXray(!this.xray); if (this.tab === `visuals`) this.renderBody() }

  reposition() {
    if (!this.open) return
    if (!this.hasCustomPos) { this.positionNextToRadar(); return }
    let rect = this.root.getBoundingClientRect()
    let parent = this.parentRect()
    this.root.style.left = `${Math.min(Math.max(0, rect.left - parent.left), Math.max(0, parent.width - this.root.offsetWidth))}px`
    this.root.style.top = `${Math.min(Math.max(0, rect.top - parent.top), Math.max(0, parent.height - this.root.offsetHeight))}px`
  }

  tabAllowed(tab) { return [`visuals`, `playback`, `camera`, `performance`].includes(tab) || (tab === `debug` && this.dev) }

  setOpen(open) {
    if (open) this.resetPosition()
    this.open = open
    this.applyOpen()
    saveSettings({ left: undefined, top: undefined })
  }
  applyOpen() {
    this.root.classList.toggle(`settings-hidden`, !this.open)
    if (this.open && !this.hasCustomPos) this.positionNextToRadar()
  }
  resetPosition() {
    this.hasCustomPos = false
    this.root.style.left = ``; this.root.style.top = ``; this.root.style.right = ``; this.root.style.bottom = ``; this.root.style.transform = ``
  }
  positionNextToRadar() {
    let radar = document.querySelector(`.radar`)
    if (!radar) return
    let parent = this.parentRect()
    let rect = radar.getBoundingClientRect()
    let x = Math.min(rect.right - parent.left + 8, Math.max(0, parent.width - this.root.offsetWidth))
    let y = Math.min(Math.max(0, rect.top - parent.top), Math.max(0, parent.height - this.root.offsetHeight))
    this.root.style.left = `${x}px`; this.root.style.top = `${y}px`; this.root.style.right = `auto`; this.root.style.bottom = `auto`; this.root.style.transform = `none`
  }

  setTab(tab) {
    if (tab !== this.tab) { this.tab = tab; this.renderTabs(); this.renderBody(); this.reposition(); saveSettings({ tab }) }
  }
  renderTabs() {
    for (let [key, btn] of this.tabButtons) { btn.classList.toggle(`active`, key === this.tab); btn.setAttribute(`aria-pressed`, String(key === this.tab)) }
  }
  renderBody() {
    this.body.replaceChildren()
    this.body.appendChild(
      this.tab === `debug` ? this.renderDebugTab()
        : this.tab === `performance` ? this.renderPerformanceTab()
        : this.tab === `playback` ? this.renderPlaybackTab()
        : this.tab === `camera` ? this.renderCameraTab()
        : this.renderVisualsTab())
  }

  renderVisualsTab() {
    let section = document.createElement(`div`)
    section.className = `settings-section`

    // 地图视图（Classic / CS2）
    let mapValue = this.mode === `cs2` ? `cs2` : this.mode === `classified` ? `classic` : null
    section.appendChild(this.settingsGroup(`Map view`,
      this.segRow(
        [{ value: `classic`, text: `Classic` }, { value: `cs2`, text: `CS2` }].map((opt) => ({
          text: opt.text,
          active: opt.value === mapValue,
          onClick: () => {
            saveSettings({ mapView: opt.value })
            this.setMode(opt.value === `cs2` ? `cs2` : `classified`)
            this.refreshBody(`Map view`)
          },
        })),
        `Map view`),
      this.hint(`Classic is a light, simplified map with player capsules and weapon icons. CS2 shows the game's textures, lighting, player and weapon models and the first-person gun, and needs a stronger GPU.`)))

    // HUD 预设 + 各 HUD 元素开关
    let preset = this.choiceRow(`Preset`,
      this.segRow([`Full`, `Minimal`, `Custom`].map((name) => ({
        text: name,
        active: this.viewer.hudPreset === name.toLowerCase(),
        onClick: () => {
          if (name === `Custom') this.setViewer({ hudPreset: `custom` })
          else this.setViewer({ hud: { ...(name === `Full` ? FULL_HUD : MINIMAL_HUD) }, hudPreset: name === `Full` ? `full` : `minimal` })
          this.refreshBody(`HUD preset`)
        },
      })), `HUD preset`))

    let toggleGrid = document.createElement(`div`)
    toggleGrid.className = `settings-toggle-grid`
    for (let [key, label] of [[`playerCards`, `Player cards`], [`eventFeed`, `Event feed`], [`nametags`, `Nametags`], [`radar`, `Radar`], [`scoreboard`, `Scoreboard`]])
      toggleGrid.appendChild(this.toggleRow(label, this.viewer.hud[key], (v) => {
        this.setViewer({ hud: { ...this.viewer.hud, [key]: v } })
        this.refreshBody(label)
      }))
    section.appendChild(this.settingsGroup(`HUD`, preset, toggleGrid))

    let flashChoice = this.choiceRow(`Flashbang effect`,
      this.viewerChoices(`flashEffect`, [
        { value: `full`, text: `Full` }, { value: `reduced`, text: `Reduced` }, { value: `indicator`, text: `Indicator only` },
      ], `Flashbang effect`))
    section.appendChild(this.settingsGroup(`Visibility`, this.toggleRow(`X-RAY`, this.xray, (v) => this.setXray(v)), flashChoice))

    section.appendChild(this.settingsGroup(`Utility trajectories`,
      this.viewerChoices(`trajectories`, [
        { value: `all`, text: `All` }, { value: `followed`, text: `Followed player` }, { value: `selected`, text: `Selected grenade` }, { value: `off`, text: `Off` },
      ], `Utility trajectories`)))

    // 外观（主题）
    let theme = getCurrentTheme()
    section.appendChild(this.settingsGroup(`Appearance`,
      this.segRow([`light`, `system`, `dark`].map((t) => ({ text: THEME_LABELS[t], active: t === theme, onClick: () => setTheme(t) })), `Appearance`)))

    return section
  }

  renderPerformanceTab() {
    let section = document.createElement(`div`)
    section.className = `settings-section`
    let resolution = this.choiceRow(`Render resolution`,
      this.viewerChoices(`renderScale`, [{ value: 0.5, text: `50%` }, { value: 0.75, text: `75%` }, { value: 1, text: `100%` }], `Render resolution`))
    let smoke = this.choiceRow(`Smoke & molotovs`,
      this.segRow(EFFECT_GRAPHICS.map((opt) => ({ text: opt.label, active: opt.value === this.effects, onClick: () => this.setEffectGraphics(opt.value) })), `Smoke and molotov graphics`))
    let shadows = this.choiceRow(`Sun shadows`,
      this.segRow(SHADOW_QUALITIES.map((opt) => ({ text: opt.label, active: opt.value === this.shadowQuality, onClick: () => this.setShadowQuality(opt.value) })), `Sun shadows`))
    section.appendChild(this.settingsGroup(`Rendering quality`, resolution, smoke, shadows))
    if (this.mode === `cs2`) {
      let culling = this.toggleRow(`Visibility culling`, this.cs2Options.visibilityCulling, (v) => this.setCs2Options({ visibilityCulling: v }))
      section.appendChild(this.settingsGroup(`Map detail`, culling,
        this.hint(`Visibility culling skips hidden parts of the map in first-person player views; turn it off if distant buildings go missing.`)))
    }
    section.appendChild(this.settingsGroup(`Performance display`, this.renderStatsTab()))
    return section
  }

  renderPlaybackTab() {
    let section = document.createElement(`div`)
    section.className = `settings-section`
    let skipGrid = document.createElement(`div`)
    skipGrid.className = `settings-toggle-grid`
    skipGrid.appendChild(this.toggleRow(`Freeze time`, this.viewer.skipFreezeTime, (v) => this.setViewer({ skipFreezeTime: v })))
    skipGrid.appendChild(this.toggleRow(`Timeouts`, this.viewer.skipTimeouts, (v) => this.setViewer({ skipTimeouts: v })))
    section.appendChild(this.settingsGroup(`Skip downtime`, skipGrid))
    section.appendChild(this.settingsGroup(`Replay lead-in`,
      this.choiceRow(`Kill replay`, this.viewerChoices(`killLeadIn`, [3, 5, 8].map((v) => ({ value: v, text: `${v}s` })), `Kill replay lead-in`)),
      this.choiceRow(`Utility replay`, this.viewerChoices(`utilityLeadIn`, [2, 3, 5, 8].map((v) => ({ value: v, text: `${v}s` })), `Utility replay lead-in`))))
    section.appendChild(this.settingsGroup(`Sound`,
      this.toggleRow(`Mute`, this.viewer.muted, (v) => this.setViewer({ muted: v })),
      this.rangeRow(`Volume`, this.viewer.volume, 0, 100, 1, (v) => this.setViewer({ volume: v }))))
    return section
  }

  renderCameraTab() {
    let section = document.createElement(`div`)
    section.className = `settings-section`
    section.appendChild(this.settingsGroup(`Fly / Noclip look`,
      this.rangeRow(`Mouse sensitivity`, this.viewer.mouseSensitivity, 0.25, 3, 0.05, (v) => this.setViewer({ mouseSensitivity: v })),
      this.toggleRow(`Invert vertical look`, this.viewer.invertLook, (v) => this.setViewer({ invertLook: v })),
      this.hint(`Hold Ctrl to release the mouse temporarily; Escape unlocks until a view click.`)))
    section.appendChild(this.settingsGroup(`Movement`,
      this.rangeRow(`Default movement speed`, this.viewer.flySpeed, 150, 24000, 50, (v) => this.setViewer({ flySpeed: v }))))
    return section
  }

  setViewer(patch) {
    this.viewer = parseViewerSettings({ ...this.viewer, ...(patch.hud ? { hudPreset: `custom` } : {}), ...patch })
    saveSettings({ viewer: this.viewer })
    this.callbacks.onViewerChange(this.viewerSettings)
  }

  viewerChoices(key, options, label) {
    return this.segRow(options.map((opt) => ({
      text: opt.text,
      active: this.viewer[key] === opt.value,
      onClick: () => { this.setViewer({ [key]: opt.value }); this.refreshBody(label) },
    })), label)
  }

  refreshBody(label) {
    this.renderBody()
    let target = [...this.body.querySelectorAll(`[role="switch"], [role="group"]`)].find((el) => el.getAttribute(`aria-label`) === label || el.textContent === label)
    ;(target?.querySelector(`[aria-pressed="true"]`) ?? target)?.focus({ preventScroll: true })
    if (this.open && !this.hasCustomPos) this.positionNextToRadar()
  }

  hint(text) { let el = document.createElement(`div`); el.className = `settings-hint`; el.textContent = text; return el }
  choiceRow(label, control) {
    let row = document.createElement(`div`)
    row.className = `settings-choice-row`
    let span = document.createElement(`span`)
    span.className = `settings-choice-label`
    span.textContent = label
    row.append(span, control)
    return row
  }
  settingsGroup(title, ...children) {
    let section = document.createElement(`section`)
    section.className = `settings-group`
    section.setAttribute(`aria-label`, title)
    let h = document.createElement(`h3`)
    h.className = `settings-group-title`
    h.textContent = title
    let content = document.createElement(`div`)
    content.className = `settings-group-content`
    content.append(...children)
    section.append(h, content)
    return section
  }

  setEffectGraphics(value) {
    if (value !== this.effects) {
      this.effects = value
      this.callbacks.onEffectGraphicsChange(value)
      saveSettings({ effectGraphics: value })
      if (this.tab === `performance`) this.refreshBody(`Smoke and molotov graphics`)
    }
  }
  setXray(value) {
    if (value !== this.xray) { this.xray = value; this.callbacks.onXrayChange(value); saveSettings({ xray: value }) }
  }

  renderStatsTab() {
    let section = document.createElement(`div`)
    section.className = `settings-section`
    let config = this.stats.getConfig()
    let grid = document.createElement(`div`)
    grid.className = `settings-metrics`
    for (let group of [`live`, `demo`]) {
      let groupEl = document.createElement(`div`)
      groupEl.className = `settings-metric-group`
      groupEl.appendChild(this.sectionLabel(group === `live` ? `Live` : `Demo`))
      for (let metric of STATS_METRICS.filter((m) => m.group === group))
        groupEl.appendChild(this.toggleRow(metric.label, config.metrics[metric.key], (v) => {
          let cur = this.stats.getConfig()
          this.stats.setConfig({ ...cur, metrics: { ...cur.metrics, [metric.key]: v } })
        }))
      grid.appendChild(groupEl)
    }
    section.appendChild(grid)
    return section
  }

  toggleRow(label, checked, onChange) {
    let row = document.createElement(`div`)
    row.className = `settings-toggle`
    row.setAttribute(`role`, `switch`)
    row.setAttribute(`aria-checked`, String(checked))
    row.tabIndex = 0
    let labelEl = document.createElement(`span`)
    labelEl.className = `settings-toggle-label`
    labelEl.textContent = label
    let switchEl = document.createElement(`span`)
    switchEl.className = `settings-switch${checked ? ` on` : ``}`
    row.append(labelEl, switchEl)
    let toggle = () => {
      let next = !switchEl.classList.contains(`on`)
      switchEl.classList.toggle(`on`, next)
      row.setAttribute(`aria-checked`, String(next))
      onChange(next)
    }
    row.addEventListener(`click`, toggle)
    row.addEventListener(`keydown`, (e) => { if (e.key === ` ` || e.key === `Enter`) { e.preventDefault(); toggle() } })
    return row
  }

  renderDebugTab() {
    let section = document.createElement(`div`)
    section.className = `settings-section`
    section.appendChild(this.settingsGroup(`Map source`,
      this.segRow(MAP_MODES.map((opt) => ({ text: opt.label, active: opt.value === this.mode, onClick: () => this.setMode(opt.value) })))))
    if (this.mode === `classified`) {
      section.appendChild(this.settingsGroup(`Classification thresholds`,
        this.rangeRow(`Roof height`, this.classification.roofHeight, 0.1, 0.9, 0.01, (v) => this.setClassification({ roofHeight: v })),
        this.rangeRow(`Small-object cutoff`, this.classification.detailSpan, 25, 500, 5, (v) => this.setClassification({ detailSpan: v })),
        this.hint(`Lower the cutoff to classify fewer pieces as Detail.`)))
      section.appendChild(this.settingsGroup(`Lighting`,
        this.rangeRow(`Sun azimuth`, this.classification.sunAzimuth, 0, 360, 1, (v) => this.setMapEnvironment({ sunAzimuth: v })),
        this.rangeRow(`Sun elevation`, this.classification.sunElevation, 0, 90, 1, (v) => this.setMapEnvironment({ sunElevation: v })),
        this.toggleRow(`Atmospheric haze`, this.mapAtmosphere, (v) => this.setMapAtmosphere(v)),
        this.toggleRow(`Filmic contrast`, this.mapFilmicContrast, (v) => this.setMapFilmicContrast(v))))
    }
    if (this.mode === `cs2` && this.cs2Exposure !== null) {
      section.appendChild(this.settingsGroup(`CS2 lighting`,
        this.rangeRow(`Exposure`, this.cs2Exposure, 0.25, 3, 0.05, (v) => { this.cs2Exposure = v; this.callbacks.onCs2ExposureChange(v) })))
    }
    section.appendChild(this.settingsGroup(`Playback loading`,
      this.toggleRow(`Smooth round backfill`, this.smoothRoundBackfill, (v) => {
        this.smoothRoundBackfill = v
        saveSettings({ smoothRoundBackfill: v })
        this.callbacks.onSmoothRoundBackfillChange(v)
      })))
    return section
  }

  setMode(mode) { if (mode !== this.mode) { this.mode = mode; this.renderBody(); this.callbacks.onMapChange(this.mode) } }
  setCs2Options(patch) {
    let next = { ...this.cs2Options, ...patch }
    if (next.visibilityCulling !== this.cs2Options.visibilityCulling) {
      this.cs2Options = next
      saveSettings({ cs2VisibilityCulling: next.visibilityCulling })
      this.callbacks.onCs2MapOptionsChange({ ...next })
    }
  }
  setClassification(patch) { this.classification = { ...this.classification, ...patch }; this.callbacks.onMapClassificationChange(this.classification) }
  setMapEnvironment(patch) { this.classification = { ...this.classification, ...patch }; this.callbacks.onMapEnvironmentChange(this.classification) }
  setShadowQuality(value) {
    if (value !== this.shadowQuality) {
      this.shadowQuality = value
      saveSettings({ shadowQuality: value })
      this.callbacks.onShadowQualityChange(value)
      if (this.tab === `performance`) this.refreshBody(`Sun shadows`)
    }
  }
  setMapAtmosphere(value) { this.mapAtmosphere = value; saveSettings({ mapAtmosphere: value }); this.callbacks.onMapAtmosphereChange(value) }
  setMapFilmicContrast(value) { this.mapFilmicContrast = value; saveSettings({ mapFilmicContrast: value }); this.callbacks.onMapFilmicContrastChange(value) }
  get currentShadowQuality() { return this.shadowQuality }
  get mapAtmosphereEnabled() { return this.mapAtmosphere }
  get mapFilmicContrastEnabled() { return this.mapFilmicContrast }

  rangeRow(label, value, min, max, step, onChange) {
    let row = document.createElement(`label`)
    row.className = `settings-range`
    let labelEl = document.createElement(`span`)
    labelEl.textContent = label
    let output = document.createElement(`output`)
    output.textContent = value.toFixed(step < 1 ? 2 : 0)
    let input = document.createElement(`input`)
    input.type = `range`
    input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value)
    input.setAttribute(`aria-label`, label)
    input.addEventListener(`input`, () => {
      let v = Number(input.value)
      output.textContent = v.toFixed(step < 1 ? 2 : 0)
      onChange(v)
    })
    row.append(labelEl, input, output)
    return row
  }

  sectionLabel(text) { let el = document.createElement(`div`); el.className = `settings-seclabel`; el.textContent = text; return el }

  segRow(items, label) {
    let row = document.createElement(`div`)
    row.className = `settings-seg`
    if (label) { row.setAttribute(`role`, `group`); row.setAttribute(`aria-label`, label) }
    for (let item of items) {
      let btn = document.createElement(`button`)
      btn.type = `button`
      btn.className = `settings-seg-btn${item.active ? ` active` : ``}`
      btn.textContent = item.text
      btn.setAttribute(`aria-pressed`, String(item.active))
      btn.addEventListener(`click`, item.onClick)
      row.appendChild(btn)
    }
    return row
  }

  onPointerDown = (e) => {
    if (e.target.closest(`button`)) return
    let rect = this.root.getBoundingClientRect()
    let parent = this.parentRect()
    this.root.style.left = `${rect.left - parent.left}px`
    this.root.style.top = `${rect.top - parent.top}px`
    this.root.style.right = `auto`; this.root.style.bottom = `auto`; this.root.style.transform = `none`
    this.dragOffset.x = e.clientX - rect.left
    this.dragOffset.y = e.clientY - rect.top
    this.dragging = true
    window.addEventListener(`pointermove`, this.onPointerMove)
    window.addEventListener(`pointerup`, this.onPointerUp)
    e.preventDefault()
  }
  onPointerMove = (e) => {
    if (!this.dragging) return
    let parent = this.parentRect()
    let maxX = Math.max(0, parent.width - this.root.offsetWidth)
    let maxY = Math.max(0, parent.height - this.root.offsetHeight)
    let x = Math.min(Math.max(0, e.clientX - parent.left - this.dragOffset.x), maxX)
    let y = Math.min(Math.max(0, e.clientY - parent.top - this.dragOffset.y), maxY)
    this.root.style.left = `${x}px`
    this.root.style.top = `${y}px`
  }
  onPointerUp = () => {
    this.dragging = false
    this.hasCustomPos = true
    window.removeEventListener(`pointermove`, this.onPointerMove)
    window.removeEventListener(`pointerup`, this.onPointerUp)
    saveSettings({ left: parseFloat(this.root.style.left) || 0, top: parseFloat(this.root.style.top) || 0 })
  }
  parentRect() { return this.root.offsetParent?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight) }

  dispose() {
    window.removeEventListener(`pointermove`, this.onPointerMove)
    window.removeEventListener(`pointerup`, this.onPointerUp)
    this.stopThemeSync()
    this.root.remove()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 设置持久化
// ────────────────────────────────────────────────────────────────────────────
const FULL_HUD = { playerCards: true, eventFeed: true, nametags: true, radar: true, scoreboard: true }
const MINIMAL_HUD = { playerCards: false, eventFeed: false, nametags: false, radar: true, scoreboard: true }

function parseViewerSettings(raw) {
  let obj = typeof raw == `object` && raw && !Array.isArray(raw) ? raw : {}
  let hud = typeof obj.hud == `object` && obj.hud ? obj.hud : {}
  let hudSettings = {
    playerCards: typeof hud.playerCards == `boolean` ? hud.playerCards : true,
    eventFeed: typeof hud.eventFeed == `boolean` ? hud.eventFeed : true,
    nametags: typeof hud.nametags == `boolean` ? hud.nametags : true,
    radar: typeof hud.radar == `boolean` ? hud.radar : true,
    scoreboard: typeof hud.scoreboard == `boolean` ? hud.scoreboard : true,
  }
  let matchesPreset = (preset) => Object.keys(preset).every((k) => hudSettings[k] === preset[k])
  let pick = (v, allowed, fallback) => allowed.find((a) => a === v) ?? fallback
  let clampNumber = (v, min, max, fallback) => (typeof v == `number` && Number.isFinite(v) && v >= min && v <= max ? v : fallback)
  return {
    hud: hudSettings,
    hudPreset: obj.hudPreset === `custom` ? `custom` : matchesPreset(FULL_HUD) ? `full` : matchesPreset(MINIMAL_HUD) ? `minimal` : `custom`,
    flashEffect: pick(obj.flashEffect, [`full`, `reduced`, `indicator`], `full`),
    trajectories: pick(obj.trajectories, [`all`, `followed`, `selected`, `off`], `all`),
    skipFreezeTime: typeof obj.skipFreezeTime == `boolean` ? obj.skipFreezeTime : false,
    skipTimeouts: typeof obj.skipTimeouts == `boolean` ? obj.skipTimeouts : false,
    killLeadIn: pick(obj.killLeadIn, [3, 5, 8], 5),
    utilityLeadIn: pick(obj.utilityLeadIn, [2, 3, 5, 8], 2),
    mouseSensitivity: clampNumber(obj.mouseSensitivity, 0.25, 3, 1),
    invertLook: typeof obj.invertLook == `boolean` ? obj.invertLook : false,
    flySpeed: clampNumber(obj.flySpeed, 150, 24000, 500),
    renderScale: pick(obj.renderScale, [0.5, 0.75, 1], 1),
    volume: clampNumber(obj.volume, 0, 100, 50),
    muted: typeof obj.muted == `boolean` ? obj.muted : false,
  }
}

function loadSettings() {
  try {
    let raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || `{}`)
    if (!raw || typeof raw != `object` || Array.isArray(raw)) return {}
    // 迁移旧字段（effectGraphics 合并旧的 smoke/molotov 设置）
    let normalizeEffect = (v) => (v === `off` || v === `cubes` ? v : `medium`)
    let effectGraphics =
      raw.effectGraphics === undefined
        ? raw.smokeGraphics === undefined
          ? raw.smoke === undefined
            ? raw.molotovGraphics === undefined
              ? `medium`
              : normalizeEffect(raw.molotovGraphics)
            : (raw.smoke === `off` ? `cubes` : `medium`)
          : normalizeEffect(raw.smokeGraphics)
        : normalizeEffect(raw.effectGraphics)
    for (let key of [`smoke`, `smokeGraphics`, `molotovGraphics`, `smokeSolid`, `smokeMode`, `smokeSize`, `smokeRotation`, `smokeStyle`, `smokeCompareStyle`, `smokeCompare`, `fireStyle`, `fireCompareStyle`, `fireCompare`])
      delete raw[key]
    if (`mapClassification` in raw) { delete raw.mapClassification; localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(raw)) }
    return { ...raw, effectGraphics, tab: raw.tab === `stats` ? `performance` : raw.tab }
  } catch (e) {
    console.warn(`[csplayer] Could not load settings:`, e)
    return {}
  }
}

function saveSettings(patch) {
  try {
    let current = loadSettings()
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...patch }))
  } catch (e) {
    console.warn(`[csplayer] Could not save settings:`, e)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 四、武器开镜类型辅助（被 ScopeOverlay 引用）
// ────────────────────────────────────────────────────────────────────────────
const SCOPE_MASK_RADIUS = 0.42       // 暗角遮罩半径（相对屏幕最小边）
const SCOPE_BLUR_TIME_CONSTANT = 0.07

// 判断武器是"步枪"（aug/sg553/sg556 带 1.5x 镜）还是"狙击"
function weaponScopeType(weapon) {
  let name = weapon.replace(/^weapon_/i, ``).replace(/[\s-]/g, ``).toLowerCase()
  return name === `aug` || name === `sg553` || name === `sg556` ? `rifle` : `sniper`
}

// 判断是否为纯狙击（awp/ssg08/scar20/g3sg1，需要完整狙击镜遮罩）
function isFullSniper(weapon) {
  let name = weapon.replace(/^weapon_/i, ``).replace(/[\s-]/g, ``).toLowerCase()
  return name === `awp` || name === `ssg08` || name === `scar20` || name === `g3sg1`
}

// 计算开镜模糊量（模拟景深 + 移动/射击导致的模糊）
function computeScopeBlur(weapon, zoom, speed, accuracyPenalty, duck, screenHeight) {
  let name = weapon.replace(/^weapon_/i, ``).replace(/[\s-]/g, ``).toLowerCase()
  let isScout = name === `ssg08` || name === `scout`
  if (name !== `awp` && !isScout) return 0
  let zoomFactor = Math.max(0, Math.min(1, (zoom / (isScout ? 230 : 100) - 0.34) / 0.61))
  let accuracyBase = 0.002 - Math.max(0, Math.min(1, accuracyPenalty)) * 0.0005
  let movement = (speed >= 0 ? Math.max(0, speed - accuracyBase) : 0) + zoomFactor * zoomFactor * (isScout ? 0.03 : 0.09)
  let focalLength = screenHeight / (2 * Math.tan(((duck === 2 ? 20 : 40) * Math.PI) / 360))
  return Math.min(3, movement * focalLength * 0.06)
}
