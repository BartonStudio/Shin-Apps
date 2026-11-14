// ============================================================================
// 28-radar.deobf.js —— csdemo.tv 播放器应用层（HUD / 音频 / 主控）
// 来源：src/app/28-radar.js（Vite 生产构建，prettier 展开版）
// 原始标识符为单字符/双字符混淆名，本文件已全部语义化重命名 + 注释。
//
// 本文件实际是"播放器应用层"的聚合切片，包含六大子系统：
//   ┌─────────────────────────────────────────────────────────────┐
//   │ Radar          fN   —— 2D 小地图（按海拔分段图片 + 玩家点）    │
//   │ RoundFeed      vN   —— 回合事件流（击杀 / 道具投掷时间线）      │
//   │ Scoreboard     DN   —— 计分板（可排序、两队分区）              │
//   │ AudioEngine    QN   —— Web Audio 引擎（空间化 / bank 流式）     │
//   │ AudioDirector  dP   —— 音频导演（弹道 / 脚步 / 环境音合成）     │
//   │ DemoApp        TP   —— 播放器主控（整合所有渲染/音频/HUD 子系统）│
//   └─────────────────────────────────────────────────────────────┘
//
// 注：函数体内部仍保留原始 minified 局部变量名（a/b/c/e/t/n...），
//     但所有顶层类/函数/常量均已语义化，并补充中文注释解释意图。
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 一、Radar —— 2D 小地图
//    把游戏世界坐标映射到一张按海拔分段的雷达图上，绘制玩家点与炸弹标记。
// ────────────────────────────────────────────────────────────────────────────
class Radar {
  ready
  root
  canvas
  ctx
  mapping          // 雷达图元数据：posX/posY/scale/inset/zoom + 分段 sections
  onSelect         // 点击玩家时的回调
  images           // 已加载的雷达图片（按海拔分段）
  visible = true
  portraitLayout   // 竖屏媒体查询（竖屏下雷达不绘制，交给移动端布局）
  size = QM        // 当前边长（逻辑像素）
  lastSample = null
  lastFollowed = -1
  lastBomb = null
  dotPos = []      // 每个玩家在画布上的位置缓存（供点击命中检测）

  constructor(container, mapping, fallbackImage, onSelect, onLeave, onSettings, onPerformance) {
    this.mapping = mapping
    this.onSelect = onSelect
    let loadPromises = []

    // 逐段加载雷达图片（每个海拔区间一张图）
    this.images = mapping.sections.map((section) => {
      let image = new Image()
      let entry = { section, image, ready: false }
      loadPromises.push(
        new Promise((resolve, reject) => {
          image.onload = () => {
            entry.ready = true
            // 图片就绪后若有缓存样本，立即重绘
            if (this.lastSample) this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? undefined)
            resolve()
          }
          image.onerror = () => reject(Error(`radar image load failed (${section.file})`))
        }),
      )
      image.src = section.file
      return entry
    })

    // 构建 DOM：<div.radar><div.radar-map><canvas.radar-canvas/> + <div.radar-resize/></div><div.radar-ctrls/></div>
    this.root = document.createElement(`div`)
    this.root.className = `radar`
    let mapEl = document.createElement(`div`)
    mapEl.className = `radar-map`
    this.canvas = document.createElement(`canvas`)
    this.canvas.className = `radar-canvas`
    mapEl.appendChild(this.canvas)

    // 右下角拖拽缩放手柄
    let resizeHandle = document.createElement(`div`)
    resizeHandle.className = `radar-resize`
    resizeHandle.setAttribute(`role`, `separator`)
    resizeHandle.setAttribute(`aria-label`, `Resize radar`)
    resizeHandle.title = `Drag to resize radar`
    mapEl.appendChild(resizeHandle)
    this.root.appendChild(mapEl)

    resizeHandle.addEventListener(`pointerdown`, (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      let startX = e.clientX
      let startY = e.clientY
      let baseSize = window.innerWidth > 700 ? this.canvas.getBoundingClientRect().width : this.size
      resizeHandle.classList.add(`active`)
      let onMove = (e) => {
        let dx = e.clientX - startX
        let dy = e.clientY - startY
        let delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy   // 取主轴位移
        this.setSize(baseSize + delta)
      }
      let onUp = () => {
        resizeHandle.classList.remove(`active`)
        window.removeEventListener(`pointermove`, onMove)
        window.removeEventListener(`pointerup`, onUp)
        window.removeEventListener(`pointercancel`, onUp)
      }
      window.addEventListener(`pointermove`, onMove)
      window.addEventListener(`pointerup`, onUp)
      window.addEventListener(`pointercancel`, onUp)
    })

    // 控制按钮区（退出 / 设置 / 性能）
    let controlsEl = document.createElement(`div`)
    controlsEl.className = `radar-ctrls`
    if (onLeave) {
      let btn = document.createElement(`button`)
      btn.className = `radar-btn radar-leave`
      btn.type = `button`
      btn.title = `Leave demo`
      btn.setAttribute(`aria-label`, `Leave demo`)
      btn.innerHTML = leaveIconSvg()
      btn.addEventListener(`click`, () => onLeave())
      controlsEl.append(btn)
    }
    if (onSettings) {
      let btn = document.createElement(`button`)
      btn.className = `radar-btn radar-gear`
      btn.type = `button`
      btn.title = `Settings`
      btn.setAttribute(`aria-label`, `Settings`)
      btn.textContent = `⚙`
      btn.addEventListener(`click`, () => onSettings())
      controlsEl.append(btn)
    }
    if (onPerformance) {
      let btn = document.createElement(`button`)
      btn.className = `radar-btn radar-performance`
      btn.type = `button`
      btn.title = `Performance`
      btn.setAttribute(`aria-label`, `Performance`)
      let span = document.createElement(`span`)
      span.className = `performance-icon`
      span.setAttribute(`aria-hidden`, `true`)
      span.append(document.createElement(`i`), document.createElement(`i`), document.createElement(`i`))
      btn.appendChild(span)
      btn.addEventListener(`click`, () => onPerformance())
      controlsEl.append(btn)
    }
    this.root.appendChild(controlsEl)
    container.appendChild(this.root)

    let ctx = this.canvas.getContext(`2d`)
    if (!ctx) throw Error(`Radar: 2D canvas context unavailable`)
    this.ctx = ctx
    this.applySize()

    // 无分段信息时回退到单张默认图
    if (this.images.length === 0) {
      let image = new Image()
      let entry = { section: { name: `default`, file: fallbackImage, altitudeMin: -Infinity, altitudeMax: Infinity }, image, ready: false }
      this.images.push(entry)
      loadPromises.push(
        new Promise((resolve, reject) => {
          image.onload = () => {
            entry.ready = true
            if (this.lastSample) this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? undefined)
            resolve()
          }
          image.onerror = () => reject(Error(`radar image load failed (${fallbackImage})`))
        }),
      )
      image.src = fallbackImage
    }

    this.ready = Promise.all(loadPromises).then(() => undefined)
    this.canvas.addEventListener(`click`, (e) => this.onClick(e))
    this.portraitLayout.addEventListener(`change`, this.redraw)
  }

  redraw = () => {
    if (this.lastSample) this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? undefined)
  }
  isVisible() { return this.visible }
  toggle() { this.setVisible(!this.visible) }
  setVisible(v) {
    this.visible = v
    this.root.classList.toggle(`radar-collapsed`, !v)
    if (v && this.lastSample) this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? undefined)
  }

  // 应用设备像素比（最高 2x）到画布尺寸
  applySize() {
    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = this.size * dpr
    this.canvas.height = this.size * dpr
    this.canvas.style.width = `${this.size}px`
    this.canvas.style.height = `${this.size}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  setSize(v) {
    let clamped = Math.round(Math.max($M /* 最小 */, Math.min(eN /* 最大 */, v)))
    if (clamped !== this.size) {
      this.size = clamped
      this.applySize()
      if (this.lastSample) this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? undefined)
    }
  }

  // 核心：用最新玩家样本重绘雷达
  update(sample, followedSlot, bomb) {
    this.lastSample = sample
    this.lastFollowed = followedSlot
    this.lastBomb = bomb ?? null
    if (!this.visible || this.portraitLayout.matches) return   // 竖屏不画

    let size = this.size
    let ctx = this.ctx
    ctx.clearRect(0, 0, size, size)

    // 依据被跟随玩家的海拔 Z 选择对应分段的雷达图
    let altitude = followedSlot >= 0 ? sample.z[followedSlot] : Infinity
    let section =
      this.images.find(({ section }) => altitude >= section.altitudeMin && altitude < section.altitudeMax) ??
      this.images.find(({ section }) => section.name === `default`) ??
      this.images[0]
    let imgWidth = (section.ready && section.image.width) || 1024
    let viewport = this.getViewport(imgWidth)

    if (section.ready)
      ctx.drawImage(section.image, viewport.x, viewport.y, viewport.width, viewport.height, tN /* 边距 */, tN, size - tN * 2, size - tN * 2)

    // 绘制每个玩家点
    let count = sample.x.length
    this.dotPos.length = count
    for (let i = 0; i < count; i++) {
      let worldX = (sample.x[i] - this.mapping.posX) / this.mapping.scale
      let worldY = (this.mapping.posY - sample.y[i]) / this.mapping.scale
      let px = tN + (worldX - viewport.x) * viewport.scaleX
      let py = tN + (worldY - viewport.y) * viewport.scaleY
      let alive = sample.alive[i] === 1
      this.dotPos[i] = { x: px, y: py, alive }
      if (alive) this.drawPlayer(px, py, sample.yaw[i], sample.team[i], i === followedSlot)
    }

    if (this.lastBomb && this.lastBomb.kind !== `none`) this.drawBomb(this.lastBomb, viewport)
  }

  // 计算视口裁剪：inset 定义图片在画布中的内缩区域，zoom 定义放大倍数
  getViewport(imgWidth) {
    let insetLeft = imgWidth * this.mapping.insetLeft
    let insetTop = imgWidth * this.mapping.insetTop
    let contentW = imgWidth * (1 - this.mapping.insetLeft - this.mapping.insetRight)
    let contentH = imgWidth * (1 - this.mapping.insetTop - this.mapping.insetBottom)
    let w = contentW / this.mapping.zoom
    let h = contentH / this.mapping.zoom
    let x = insetLeft + (contentW - w) / 2
    let y = insetTop + (contentH - h) / 2
    let drawSize = this.size - tN * 2
    return { x, y, width: w, height: h, scaleX: drawSize / w, scaleY: drawSize / h }
  }

  dispose() {
    this.portraitLayout.removeEventListener(`change`, this.redraw)
    this.root.remove()
  }

  // 绘制单个玩家：扇形视野锥 + 圆形点 +（被跟随者）双圈高亮
  drawPlayer(x, y, yaw, team, isFollowed) {
    let ctx = this.ctx
    let color = team === 2 ? oN /* T */ : team === 3 ? sN /* CT */ : cN /* 观战 */
    let startAngle = -yaw * aN   // 朝向角（弧度）
    let halfFov = (rN / 2) * aN  // 视野锥半角
    let fovRadius = this.size * iN
    let grad = ctx.createRadialGradient(x, y, nN, x, y, fovRadius)
    grad.addColorStop(0, `rgba(255,255,255,0.15)`)
    grad.addColorStop(1, `rgba(255,255,255,0)`)
    // 视野锥（扇形）
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.arc(x, y, fovRadius, startAngle - halfFov, startAngle + halfFov)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
    // 玩家圆点
    ctx.beginPath()
    ctx.arc(x, y, nN, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = `rgba(0,0,0,0.6)`
    ctx.stroke()
    // 被跟随玩家：外圈双环
    if (isFollowed) {
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.strokeStyle = `rgba(0, 0, 0, 0.55)`; ctx.lineWidth = 3.5; ctx.stroke()
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.strokeStyle = `#ffffff`; ctx.lineWidth = 2; ctx.stroke()
    }
  }

  // 绘制炸弹：携带 / 已安放 / 掉落
  drawBomb(bomb, viewport) {
    if (bomb.kind === `carried`) {
      let dot = bomb.carrierSlot >= 0 ? this.dotPos[bomb.carrierSlot] : null
      if (!dot || !dot.alive) return
      this.drawC4(dot.x + nN + 3, dot.y - nN - 3, `#d24b3a`, false)
      return
    }
    let wx = (bomb.x - this.mapping.posX) / this.mapping.scale
    let wy = (this.mapping.posY - bomb.y) / this.mapping.scale
    let px = tN + (wx - viewport.x) * viewport.scaleX
    let py = tN + (wy - viewport.y) * viewport.scaleY
    if (bomb.kind === `planted`)
      this.drawC4(px, py, bomb.blink ? `#ff3b30` : `#8a1f18`, bomb.blink)   // 安放：闪烁红
    else
      this.drawC4(px, py, `#c25a2a`, false)                                 // 掉落：橙
  }

  // C4 图标：旋转 45° 的方块 +（闪烁时）红圈
  drawC4(x, y, color, blink) {
    let ctx = this.ctx
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = color
    ctx.strokeStyle = `rgba(0,0,0,0.7)`
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.rect(-5, -5, 10, 10)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
    if (blink) {
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.strokeStyle = `#ff5b50`; ctx.lineWidth = 2; ctx.stroke()
    }
  }

  // 点击命中检测：找最近且在阈值内的存活玩家
  onClick(e) {
    let rect = this.canvas.getBoundingClientRect()
    let sx = this.size / Math.max(1, rect.width)
    let sy = this.size / Math.max(1, rect.height)
    let px = (e.clientX - rect.left) * sx
    let py = (e.clientY - rect.top) * sy
    let best = -1
    let bestDist = (11 * Math.max(sx, sy)) ** 2
    for (let i = 0; i < this.dotPos.length; i++) {
      let dot = this.dotPos[i]
      if (!dot || !dot.alive) continue
      let d2 = (dot.x - px) ** 2 + (dot.y - py) ** 2
      if (d2 < bestDist) { bestDist = d2; best = i }
    }
    if (best >= 0) this.onSelect(best)
  }
}

// 退出按钮 SVG 图标
function leaveIconSvg() {
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M14 4h4.25A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20H14M10 8l-4 4 4 4m-4-4h9"/></svg>`
}

// ────────────────────────────────────────────────────────────────────────────
// 二、RoundFeed —— 回合事件流（击杀 / 道具投掷时间线）
//     两个 tab：Kills（击杀）与 Utility（道具），按时间顺序排列，可点击跳转。
// ────────────────────────────────────────────────────────────────────────────
const FEED_FLASH_WINDOW = 256          // 时间线动画窗口（tick）
const UTIL_COLOR = {
  smoke: `var(--pc-util-smoke)`,
  he: `var(--pc-util-he)`,
  flash: `var(--pc-util-flash)`,
  molotov: `var(--pc-util-molotov)`,
  decoy: `var(--pc-util-decoy)`,
}
const UTIL_LABEL = { smoke: `Smoke`, he: `HE`, flash: `Flash`, molotov: `Molotov`, decoy: `Decoy` }
const FEED_STORAGE_KEY = `csplayer:feed`

class RoundFeed {
  root
  tabsEl
  bodyEl
  tabButtons = new Map()
  tabCounts = new Map()
  callbacks
  resizeObserver
  tab
  roundIndex = -2
  kills = []
  nades = []
  rows = []
  currentTick = -Infinity
  lastTick = -Infinity

  constructor(container, callbacks) {
    this.callbacks = callbacks
    let saved = readFeedPrefs()
    this.tab = saved.tab === `utility` ? `utility` : `kills`
    this.root = document.createElement(`div`)
    this.root.className = `feed`
    this.root.id = `round-feed`
    this.root.setAttribute(`role`, `region`)
    this.root.setAttribute(`aria-label`, `Round events`)
    this.root.innerHTML = `<div class="feed-tabs"></div><div class="feed-body"></div>`
    container.appendChild(this.root)
    this.tabsEl = this.root.querySelector(`.feed-tabs`)
    this.bodyEl = this.root.querySelector(`.feed-body`)

    for (let tab of [{ key: `kills`, label: `Kills` }, { key: `utility`, label: `Utility` }]) {
      let btn = document.createElement(`button`)
      btn.type = `button`
      btn.className = `feed-tab`
      btn.innerHTML = `<span class="feed-tab-label">${tab.label}</span><span class="feed-tab-n"></span>`
      btn.addEventListener(`click`, () => this.setTab(tab.key))
      this.tabsEl.appendChild(btn)
      this.tabButtons.set(tab.key, btn)
      this.tabCounts.set(tab.key, btn.querySelector(`.feed-tab-n`))
    }

    this.bodyEl.addEventListener(`scroll`, this.recomputeFades, { passive: true })
    window.addEventListener(`resize`, this.recomputeFades)
    this.resizeObserver = new ResizeObserver(this.recomputeFades)
    this.resizeObserver.observe(this.bodyEl)
    this.renderTabs()
    this.renderCounts()
    this.renderBody()
  }

  setRound(roundIndex, kills, nades) {
    if (roundIndex !== this.roundIndex) {
      this.roundIndex = roundIndex
      this.kills = kills
      this.nades = nades
      this.renderCounts()
      this.renderBody()
    }
  }

  update(tick, playing) {
    this.currentTick = tick
    let delta = tick - this.lastTick
    let flash = playing && delta > 0 && delta < FEED_FLASH_WINDOW   // 连续播放时新条目闪一下
    for (let row of this.rows) {
      let passed = tick >= row.tick
      if (passed !== row.passed) {
        row.passed = passed
        row.el.classList.toggle(`feed-passed`, passed)
        if (passed && flash) {
          row.el.classList.remove(`feed-flash`)
          row.el.offsetWidth                      // 强制 reflow 以重启动画
          row.el.classList.add(`feed-flash`)
          row.el.scrollIntoView({ block: `nearest` })
        }
      }
    }
    this.lastTick = tick
  }

  dispose() {
    this.bodyEl.removeEventListener(`scroll`, this.recomputeFades)
    window.removeEventListener(`resize`, this.recomputeFades)
    this.resizeObserver.disconnect()
    this.root.remove()
  }

  recomputeFades = () => {
    let el = this.bodyEl
    let top = el.scrollTop > 1
    let bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    el.classList.toggle(`feed-fade-top`, top)
    el.classList.toggle(`feed-fade-bottom`, bottom)
  }

  setTab(tab) {
    if (tab !== this.tab) {
      this.tab = tab
      writeFeedPrefs({ tab })
      this.renderTabs()
      this.renderBody()
    }
  }

  renderTabs() {
    for (let [key, btn] of this.tabButtons) {
      btn.classList.toggle(`active`, key === this.tab)
      btn.setAttribute(`aria-pressed`, String(key === this.tab))
    }
    this.tabsEl.style.setProperty(`--index`, this.tab === `utility` ? `1` : `0`)
  }

  renderCounts() {
    this.tabCounts.get(`kills`).textContent = String(this.kills.length)
    this.tabCounts.get(`utility`).textContent = String(this.nades.length)
  }

  renderBody() {
    this.bodyEl.replaceChildren()
    this.rows = []
    this.lastTick = this.currentTick
    if (this.tab === `utility`) this.renderUtility()
    else this.renderKills()
    this.recomputeFades()
  }

  renderKills() {
    if (this.kills.length === 0) { this.bodyEl.appendChild(makeEmptyRow(`No kills this round`)); return }
    for (let kill of this.kills) this.bodyEl.appendChild(this.makeKillRow(kill))
  }

  renderUtility() {
    if (this.nades.length === 0) { this.bodyEl.appendChild(makeEmptyRow(`No grenades this round`)); return }
    for (let nade of this.nades) this.bodyEl.appendChild(this.makeNadeRow(nade))
  }

  makeKillRow(kill) {
    let row = document.createElement(`div`)
    row.className = `kl-row`
    row.innerHTML = `<span class="kl-time">${kill.timeLabel}</span><span class="kl-kill">${escapeHtml(kill)}</span>`
    row.addEventListener(`click`, () => this.callbacks.onSelectKill(kill.id))
    this.trackRow(row, kill.tick)
    return row
  }

  makeNadeRow(nade) {
    let row = document.createElement(`div`)
    row.className = `nl-row`
    row.innerHTML = `<span class="kl-time">${escapeHtml(nade.timeLabel)}</span><span class="nl-badge" style="--kc:${UTIL_COLOR[nade.kind]}">${utilIcon(nade.kind, `nl-ic`)}</span><span class="nl-thrower" style="color:${nade.color}">${escapeHtml(nade.thrower)}</span><div class="nl-actions">
      <button class="nl-action nl-pov" type="button">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path fill-rule="evenodd" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Zm15 0a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z"/></svg>
      </button>
      <button class="nl-action nl-landing" type="button">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path fill-rule="evenodd" d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 0 1 16 0Zm-5.5 0a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/></svg>
      </button>
    </div><span class="nl-landing-error" role="status" hidden></span>`

    let povBtn = row.querySelector(`.nl-pov`)
    povBtn.title = `Watch ${nade.thrower}'s ${UTIL_LABEL[nade.kind]} throw from player POV`
    povBtn.setAttribute(`aria-label`, povBtn.title)
    povBtn.addEventListener(`click`, (e) => { e.stopPropagation(); this.callbacks.onSelectNade(nade.id) })

    let landingBtn = row.querySelector(`.nl-landing`)
    landingBtn.title = `Watch ${UTIL_LABEL[nade.kind]} landing from 3 seconds before impact`
    landingBtn.setAttribute(`aria-label`, `Watch ${nade.thrower}'s ${UTIL_LABEL[nade.kind]} landing`)

    for (let btn of [povBtn, landingBtn])
      btn.addEventListener(`keydown`, (e) => { if (e.key === ` ` || e.key === `Enter`) e.stopPropagation() })

    landingBtn.addEventListener(`click`, (e) => {
      e.stopPropagation()
      let err = this.callbacks.onViewNadeLanding(nade.id)
      let errEl = row.querySelector(`.nl-landing-error`)
      errEl.textContent = err ?? ``
      errEl.hidden = err === null
    })
    row.addEventListener(`click`, () => this.callbacks.onSelectNade(nade.id))
    this.trackRow(row, nade.tick)
    return row
  }

  trackRow(el, tick) {
    let passed = this.currentTick >= tick
    el.classList.toggle(`feed-passed`, passed)
    this.rows.push({ el, tick, passed })
  }
}

// 道具图标（用 -webkit-mask 的 SVG 蒙版）
function utilIcon(kind, cls) {
  let url = Zb(kind)   // Zb = 图标 URL 解析（来自 31-hosted-demo / 外部）
  return `<span class="${cls}" style="-webkit-mask-image:url(${url});mask-image:url(${url})"></span>`
}
function makeEmptyRow(text) {
  let el = document.createElement(`div`)
  el.className = `nl-empty`
  el.textContent = text
  return el
}
function readFeedPrefs() {
  try { return JSON.parse(localStorage.getItem(FEED_STORAGE_KEY) || `{}`) } catch { return {} }
}
function writeFeedPrefs(patch) {
  try { let cur = readFeedPrefs(); localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify({ ...cur, ...patch })) } catch {}
}

// ────────────────────────────────────────────────────────────────────────────
// 三、Scoreboard —— 计分板（两队分区，可排序）
// ────────────────────────────────────────────────────────────────────────────
const TEAM_FULL_NAME = { ct: `Counter-Terrorists`, t: `Terrorists` }
const TEAM_SHORT_NAME = { ct: `CT`, t: `T` }
const SCOREBOARD_COLUMNS = [
  { key: `kills`, label: `K`, title: `Kills` },
  { key: `deaths`, label: `D`, title: `Deaths` },
  { key: `assists`, label: `A`, title: `Assists` },
  { key: `hsPct`, label: `HS%`, title: `Headshot percentage` },
  { key: `dmg`, label: `DMG`, title: `Damage to enemies` },
  { key: `money`, label: `Money`, title: `Money` },
]
const SORT_ARROW = `<svg class="sbd-sort-icon" viewBox="0 0 10 6" aria-hidden="true"><path d="M1.5 1.25 5 4.75l3.5-3.5"/></svg>`

class Scoreboard {
  root
  rowLists
  teamHeads
  sortCells = []
  teams
  onSelect
  visible = false
  sortKey = `kills`
  sortDesc = true
  lastRows = []
  lastLabels = ``
  lastRowsKey = ``

  constructor(container, onSelect, teams) {
    this.onSelect = onSelect
    this.teams = teams
    this.root = makeEl(`div`, `scoreboard`)
    this.root.id = `scoreboard`
    this.root.setAttribute(`role`, `region`)
    this.root.setAttribute(`aria-label`, `Scoreboard`)
    this.root.hidden = true
    this.teamHeads = { ct: makeEl(`span`, `sbd-head-team`), t: makeEl(`span`, `sbd-head-team`) }
    this.rowLists = { ct: makeEl(`div`, `sbd-rows`), t: makeEl(`div`, `sbd-rows`) }

    for (let side of [`t`, `ct`]) {
      let section = makeEl(`section`, `sbd-team sbd-${side}`)
      let head = makeEl(`div`, `sbd-head`)
      head.appendChild(this.teamHeads[side])
      for (let col of SCOREBOARD_COLUMNS) {
        let cell = makeEl(`span`, `sbd-h`)
        cell.dataset.sort = col.key
        cell.title = `Sort by ${col.title.toLowerCase()}`
        cell.innerHTML = `${SORT_ARROW}<span>${col.label}</span>`
        head.appendChild(cell)
        this.sortCells.push(cell)
      }
      section.append(head, this.rowLists[side])
      this.root.appendChild(section)
    }

    this.root.addEventListener(`mousedown`, (e) => e.preventDefault())
    this.root.addEventListener(`click`, (e) => {
      let target = e.target
      let sortCell = target?.closest(`.sbd-h`)
      if (sortCell?.dataset.sort) { this.setSort(sortCell.dataset.sort); return }
      let row = target?.closest(`.sbd-row`)
      if (row && !row.classList.contains(`sbd-dead`)) this.onSelect(Number(row.dataset.slot))
    })
    this.syncSortCells()
    container.appendChild(this.root)
  }

  isVisible() { return this.visible }
  show() { if (!this.visible) { this.visible = true; this.root.hidden = false } }
  hide() { if (this.visible) { this.visible = false; this.root.hidden = true } }

  update(rows, labels) {
    if (!this.visible) return
    let labelKey = `${labels.tLabel}|${labels.ctLabel}`
    if (labelKey !== this.lastLabels) {
      this.lastLabels = labelKey
      this.fillTeamHead(`t`, labels.tLabel)
      this.fillTeamHead(`ct`, labels.ctLabel)
    }
    let rowsKey = computeRowsKey(rows)
    if (rowsKey !== this.lastRowsKey) { this.lastRowsKey = rowsKey; this.lastRows = rows; this.renderRows() }
  }

  setSort(key) {
    this.sortDesc = key === this.sortKey ? !this.sortDesc : true
    this.sortKey = key
    this.syncSortCells()
    this.renderRows()
  }

  dispose() { this.root.remove() }

  renderRows() {
    let cmp = (a, b) => (this.sortDesc ? b[this.sortKey] - a[this.sortKey] : a[this.sortKey] - b[this.sortKey]) || tieBreak(a, b)
    for (let [side, team] of [[`t`, 2], [`ct`, 3]]) {
      let html = this.lastRows.filter((r) => r.team === team).sort(cmp).map((r) => this.rowHtml(r)).join(``)
      this.rowLists[side].innerHTML = html
    }
  }

  rowHtml(row) {
    let extra = `${row.followed ? ` sbd-followed` : ``}${row.alive ? `` : ` sbd-dead`}`
    let cell = (key, val, extraCls = ``) => `<span class="sbd-col${extraCls}${key === this.sortKey ? ` is-sorted` : ``}">${val}</span>`
    return (
      `<div class="sbd-row${extra}" data-slot="${row.slot}"${row.alive ? `` : ` title="Dead"`}><span class="sbd-name">${escapeHtml(row.name)}</span>` +
      cell(`kills`, String(row.kills)) +
      cell(`deaths`, String(row.deaths)) +
      cell(`assists`, String(row.assists)) +
      cell(`hsPct`, row.hsPct < 0 ? `–` : `${row.hsPct}%`) +
      cell(`dmg`, String(row.dmg)) +
      cell(`money`, `$${row.money.toLocaleString(`en-US`)}`, ` sbd-col-money`) +
      `</div>`
    )
  }

  syncSortCells() {
    for (let cell of this.sortCells) {
      let active = cell.dataset.sort === this.sortKey
      cell.classList.toggle(`is-sorted`, active)
      cell.classList.toggle(`is-asc`, active && !this.sortDesc)
      cell.setAttribute(`aria-sort`, active ? (this.sortDesc ? `descending` : `ascending`) : `none`)
    }
  }

  fillTeamHead(side, label) {
    let fullName = label === TEAM_SHORT_NAME[side] || label === `` ? TEAM_FULL_NAME[side] : label
    let logoUrl = this.teams?.get(label)?.logoUrl
    let mark = logoUrl ? gM(logoUrl, label, `sbd-mark`, { fallbackText: EM(label), invertWhite: true }) : makeEl(`span`, `sbd-mark sbd-badge`)
    if (!logoUrl) mark.textContent = TEAM_SHORT_NAME[side]
    this.teamHeads[side].title = fullName
    this.teamHeads[side].replaceChildren(mark, (() => { let n = makeEl(`span`, `sbd-head-name`); n.textContent = fullName; return n })())
  }
}

function tieBreak(a, b) {
  return b.kills - a.kills || a.deaths - b.deaths || b.dmg - a.dmg || a.slot - b.slot
}
function computeRowsKey(rows) {
  let key = ``
  for (let r of rows)
    key += `;${r.slot},${r.name},${r.team},${r.money},${r.kills},${r.deaths},${r.assists},${r.dmg},${r.hsPct},${+!!r.alive},${+!!r.followed}`
  return key
}
function makeEl(tag, cls) { let el = document.createElement(tag); el.className = cls; return el }
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` })[c])
}

// ────────────────────────────────────────────────────────────────────────────
// 四、时间线辅助函数
// ────────────────────────────────────────────────────────────────────────────
// 计算当前 tick 是否应被跳过（冻结时间 / 技术暂停），返回跳转到的目标 tick
function computeSkipTarget(data, currentTick, maxTick, skipFreeze, skipTimeouts) {
  if (!skipFreeze && !skipTimeouts) return null
  let intervals = [
    ...(skipFreeze ? data.rounds.map((r) => ({ startTick: r.startTick, endTick: Math.min(r.liveStartTick, r.endTick) })) : []),
    ...(skipTimeouts ? data.timeouts.intervals : []),
  ].filter((r) => r.endTick > r.startTick).sort((a, b) => a.startTick - b.startTick)
  let cursor = currentTick
  for (let it of intervals) {
    if (it.startTick > cursor) break
    if (it.endTick > cursor) cursor = it.endTick
  }
  return cursor > currentTick && cursor <= maxTick ? cursor : null
}

// 在分段线性曲线上插值（如距离衰减曲线，偶数下标=距离，奇数下标=增益）
function sampleCurve(curve, distance) {
  if (!curve || curve.length < 2) return 1
  if (distance <= curve[0]) return curve[1]
  for (let i = 2; i < curve.length; i += 2) {
    let x0 = curve[i]
    if (distance <= x0) {
      let prevX = curve[i - 2], prevY = curve[i - 1]
      return x0 > prevX ? prevY + ((curve[i + 1] - prevY) * (distance - prevX)) / (x0 - prevX) : curve[i + 1]
    }
  }
  return curve[curve.length - 1]
}

// 音量抖动：v 基础音量，vr=[min,max] 随机区间，random 归一化随机数
function jitterVolume(v, vr, random) {
  let base = v ?? 1
  return vr ? base + vr[0] + (vr[1] - vr[0]) * random : base
}

// ────────────────────────────────────────────────────────────────────────────
// 五、SurfaceGrid —— 地表材质网格（音频用）
//     SGR1 二进制格式：magic + 原点/单元格尺寸 + 每格起始索引 + 高度(z) + 表面材质索引
//     用于根据空间坐标查询脚下的表面材质（决定脚步/子弹撞击音效）。
// ────────────────────────────────────────────────────────────────────────────
function decodeSurfaceGrid(bytes) {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (magic !== `SGR1`) throw Error(`surface grid: bad magic ${magic}`)
  let x0 = view.getFloat32(4, true)
  let y0 = view.getFloat32(8, true)
  let cell = view.getFloat32(12, true)
  let width = view.getUint16(20, true)
  let height = view.getUint16(22, true)
  let surfaceCount = view.getUint32(24, true)
  let cellCount = width * height
  let offset = 28
  let start = new Uint32Array(cellCount + 1)   // 每格在 z/surface 数组中的起始索引（前缀和）
  for (let i = 0; i < cellCount; i++) start[i + 1] = start[i] + bytes[offset + i]
  offset += cellCount
  let z = new Int16Array(surfaceCount)
  for (let i = 0; i < surfaceCount; i++) z[i] = view.getInt16(offset + i * 2, true)
  offset += surfaceCount * 2
  return { x0, y0, cell, width, height, start, z, surface: bytes.slice(offset, offset + surfaceCount) }
}

// 查询 (x,y,z) 处的地表材质索引；无匹配返回 -1
function querySurface(grid, x, y, z) {
  let gx = Math.floor((x - grid.x0) / grid.cell)
  let gy = Math.floor((y - grid.y0) / grid.cell)
  if (gx < 0 || gy < 0 || gx >= grid.width || gy >= grid.height) return -1
  let idx = gy * grid.width + gx
  let s = grid.start[idx]
  let e = grid.start[idx + 1]
  if (s === e) return -1
  let best = s
  for (let i = s; i < e; i++) if (grid.z[i] <= z + 20) best = i
  return grid.surface[best]
}

// 生成 C4 倒计时的 beep 时刻序列（非线性：越接近爆炸越密集）
function makeBeepSchedule(count = 40) {
  let ticks = []
  for (let t = 0; t < count;) {
    ticks.push(t)
    let progress = Math.min(1, Math.max(0, (count - t) / count))
    t += Math.max(0.1 + 0.9 * progress, 0.15)
  }
  return ticks
}

// 检测弹道反弹点：遍历轨迹顶点，找速度方向突变（撞地/撞墙）的 tick
function detectBounces(posXYZ, ticks, tickRate) {
  let result = []
  let lastTick = -Infinity
  for (let i = 1; i + 1 < ticks.length; i++) {
    let dtPrev = (ticks[i] - ticks[i - 1]) / tickRate
    let dtNext = (ticks[i + 1] - ticks[i]) / tickRate
    if (dtPrev <= 0 || dtNext <= 0) continue
    let c = i * 3
    let vxPrev = (posXYZ[c] - posXYZ[c - 3]) / dtPrev
    let vyPrev = (posXYZ[c + 1] - posXYZ[c - 2]) / dtPrev
    let vzPrev = (posXYZ[c + 2] - posXYZ[c - 1]) / dtPrev
    let vxNext = (posXYZ[c + 3] - posXYZ[c]) / dtNext
    let vyNext = (posXYZ[c + 4] - posXYZ[c + 1]) / dtNext
    let vzNext = (posXYZ[c + 5] - posXYZ[c + 2]) / dtNext
    if (Math.hypot(vxPrev, vyPrev, vzPrev) < 60) continue
    let bounced = vzPrev < -40 && vzNext - vzPrev > 120 && vzNext > vzPrev * 0.2   // 落地反弹
    let hitWall = Math.hypot(vxPrev, vyPrev) > 60 && vxPrev * vxNext + vyPrev * vyNext < -0.1 * Math.hypot(vxPrev, vyPrev) * Math.hypot(vxNext, vyNext)  // 撞墙反弹
    if ((bounced || hitWall) && ticks[i] - lastTick > tickRate * 0.1) { result.push(i); lastTick = ticks[i] }
  }
  return result
}

// ────────────────────────────────────────────────────────────────────────────
// 六、AudioEngine —— Web Audio 引擎
//     空间化音频、bank 流式加载（Range 请求）、表面材质音效、soundscape 环境音。
// ────────────────────────────────────────────────────────────────────────────
// C4 事件时刻表（相对安放时刻的秒数 → 音效名）
const BOMB_EVENTS = [[0.1, `bomb.arm`], ...[0.667, 0.967, 1.233, 1.467, 1.667, 1.967, 2.167].map((t) => [t, `bomb.key`])]
function bombBeepEvents(startTick, endTick, tickRate) {
  let out = []
  for (let [offset, name] of BOMB_EVENTS) {
    let tick = startTick + offset * tickRate
    if (tick < endTick) out.push([tick, name])
  }
  return out
}

const ROUND_END_GAP = 2   // 回合结束播报最小间隔（秒）
// 生成回合结束播报（ct 赢 / t 赢 / 安放 / 拆除）事件
function buildRoundAnnouncements(events, tickRate, tTeam, ctTeam) {
  let out = []
  let gap = ROUND_END_GAP * tickRate
  let last = -Infinity
  let sorted = events.map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.tick - b.event.tick || Number(a.event.type === `round_end`) - Number(b.event.type === `round_end`) || a.index - b.index)
  for (let { event } of sorted) {
    let name = null
    if (event.type === `bomb_planted') name = `announce.planted`
    else if (event.type === `bomb_defused`) name = `announce.defused`
    else if (event.type === `round_end` && event.roundWinner === ctTeam) name = `announce.ctwin`
    else if (event.type === `round_end` && event.roundWinner === tTeam) name = `announce.twin`
    if (!name) continue
    let at = Math.max(event.tick, last)
    out.push([at, name])
    last = at + gap
  }
  return out
}

// 计算 foley（武器动作音效）序列：比较前后两帧的 foley 状态，输出差异
function foleyDelta(prev, current, foleyMap, out) {
  out.length = 0
  if (!prev || !current || current.duration <= 0) return out
  let same = prev.file === current.file && prev.role === current.role
  let fromTime = same && current.time >= prev.time ? prev.time : -1
  for (let [fraction, soundId] of foleyMap) {
    let t = fraction * current.duration
    if (t > fromTime && t <= current.time) out.push(soundId)
  }
  if (same && current.time < prev.time && current.duration - prev.time < 0.1)
    for (let [fraction, soundId] of foleyMap) if (fraction * current.duration > prev.time) out.push(soundId)
  return out
}

// 音频引擎常量
const MAX_VOICES = 48              // 最大同时发声数
const VOICE_DROP_TIME = 0.15       // 超限时淡出时长
const INLINE_SOUND_MAX = 64 * 1024 // 小于此字节数直接内联解码
const MAX_DECODED_BYTES = 48 * 1024 * 1024  // 解码缓存上限
const MIN_AUDIBLE_GAIN = 0.003     // 低于此增益直接丢弃
const STOP_FADE_TIME = 0.04        // 停止时的默认淡出

// 单个发声（voice）状态
class Voice {
  voices = []
  stopped = false
  retriggers = []
}

class AudioEngine {
  base = null            // 音频资源根 URL
  relocating = false
  mapName = null
  ctx = null             // AudioContext
  master = null          // 主增益节点
  manifestLoad = null
  manifestData = null    // sounds.json
  mapData = null         // maps/<map>.json
  mapGrid = null         // 地表材质网格
  mapLoad = 0
  banks = new Map()      // bank 二进制缓存
  rangedSlices = new Map()
  decoded = new Map()    // 已解码声音
  decodedSizes = new Map()
  decodedBytes = 0
  voices = []
  retriggering = new Set()
  blockedUntil = new Map()
  listener = new B()     // 听者位置（three.js Vector3）
  right = new B(1, 0, 0) // 听者右向量（用于立体声 pan）
  volume = 0.5
  running = false
  disposed = false

  get manifest() { return this.manifestData }
  get map() { return this.mapData }
  get grid() { return this.mapGrid }
  get now() { return this.ctx?.currentTime ?? 0 }

  start() {
    if (!this.ctx) {
      let ctx = new AudioContext({ latencyHint: `interactive` })
      let master = ctx.createGain()
      master.gain.value = this.volume
      let compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -6
      compressor.knee.value = 6
      compressor.ratio.value = 8
      compressor.attack.value = 0.003
      compressor.release.value = 0.15
      master.connect(compressor).connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      window.addEventListener(`pointerdown`, this.unlock, true)
      window.addEventListener(`keydown`, this.unlock, true)
    }
    this.manifestLoad ??= this.fetchJson(`sounds.json`).then((d) => ((this.manifestData = d?.version === 1 ? d : null), this.manifestData))
    return this.manifestLoad
  }

  async loadMap(name) {
    let gen = ++this.mapLoad
    this.mapName = name
    let data = await this.fetchJson(`maps/${name}.json`)
    if (gen !== this.mapLoad || this.disposed) return null
    for (let key of [...this.decoded.keys()]) if (key < 0) this.forget(key)   // 清理地图专属声音
    this.rangedSlices.clear()
    this.mapData = data?.version === 1 ? data : null
    this.mapGrid = null
    if (this.mapData?.grid) {
      let grid = await this.fetchGrid(`maps/${this.mapData.grid}`)
      if (gen === this.mapLoad) this.mapGrid = grid
    }
    return this.mapData
  }

  setRunning(running) {
    this.running = running
    let ctx = this.ctx
    if (!ctx || ctx.state === `closed`) return
    if (running && ctx.state === `suspended') ctx.resume().catch(() => {})
    else if (!running && ctx.state === `running`) ctx.suspend().catch(() => {})
  }

  setVolume(v) {
    this.volume = v
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  has(eventId) { return eventId !== undefined && this.event(eventId) !== undefined }

  // 递归计算某事件的传播距离（用于环境音点触发判断）
  reach(eventId, depth = 0) {
    let ev = this.event(eventId)
    if (!ev || depth > 4) return 0
    let dist = 0
    if (ev.f?.length) {
      let curve = ev.d
      dist = curve && curve.length >= 2 && curve[curve.length - 1] <= MIN_AUDIBLE_GAIN ? curve[curve.length - 2] : Infinity
    }
    for (let child of ev.c ?? []) dist = Math.max(dist, this.reach(child, depth + 1))
    return dist
  }

  preload(eventId, depth = 0) {
    let ev = this.event(eventId)
    if (!ev || !this.ctx || depth > 4) return
    for (let child of ev.c ?? []) this.preload(child, depth + 1)
    for (let soundRef of ev.f ?? []) {
      let bank
      if (soundRef >= 0) {
        let entry = this.manifestData?.sounds[soundRef]
        bank = entry && this.manifestData?.banks[entry[0]]
      } else {
        let entry = this.mapData?.sounds[-1 - soundRef]
        let mapBank = entry && entry[0] === 0 ? this.mapData?.banks[0] : undefined
        bank = mapBank && `maps/${mapBank}`
      }
      if (bank && !this.banks.has(bank)) this.fetchBank(bank)
    }
  }

  play(eventId, emitter, entity = -1, volume = 1) {
    if (!this.ctx || !this.running) return null
    let voice = new Voice()
    this.startEvent(eventId, emitter, entity, volume, voice, 0, true)
    if (voice.retriggers.length) this.retriggering.add(voice)
    return voice.voices.length || voice.retriggers.length ? voice : null
  }

  stop(voice, fade = STOP_FADE_TIME) {
    if (!voice || voice.stopped) return
    voice.stopped = true
    this.retriggering.delete(voice)
    for (let v of voice.voices) this.stopVoice(v, fade)
  }

  stopOneShots() {
    for (let v of this.voices) if (!v.loop) this.stopVoice(v, STOP_FADE_TIME)
    this.blockedUntil.clear()
  }

  update(camera) {
    let ctx = this.ctx
    if (!ctx) return
    camera.getWorldPosition(this.listener)
    this.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    let now = ctx.currentTime
    // 处理随机重触发（如环境虫鸣）
    for (let voice of this.retriggering)
      for (let rt of voice.retriggers) {
        if (now < rt.next) continue
        let [min, max] = rt.event.rt
        rt.next = now + min + Math.random() * Math.max(0, max - min)
        this.startEvent(rt.name, rt.emitter, rt.entity, rt.volume, voice, 0, false)
      }
    // 逐 voice 更新空间化增益 / 立体声 pan，并剔除已结束的
    let write = 0
    for (let v of this.voices) {
      if (v.ended || ((this.voices[write++] = v), !v.spatial || !v.panner || !v.pos)) continue
      let prevGain = v.spatialGain
      let prevPan = v.pan
      this.spatialize(v)
      if (Math.abs(v.spatialGain - prevGain) > 0.002) v.spatial.gain.setTargetAtTime(v.volume * v.spatialGain, now, 0.03)
      else v.spatialGain = prevGain
      if (Math.abs(v.pan - prevPan) > 0.01) v.panner.pan.setTargetAtTime(v.pan, now, 0.03)
      else v.pan = prevPan
    }
    this.voices.length = write
  }

  dispose() {
    this.disposed = true
    for (let v of this.voices) this.stopVoice(v, 0)
    this.voices.length = 0
    this.retriggering.clear()
    window.removeEventListener(`pointerdown`, this.unlock, true)
    window.removeEventListener(`keydown`, this.unlock, true)
    this.ctx?.close().catch(() => {})
    this.ctx = null
    for (let p of this.decoded.values()) p.then((v) => { if (v && `url` in v) URL.revokeObjectURL(v.url) })
    this.decoded.clear()
    this.decodedSizes.clear()
    this.decodedBytes = 0
    this.banks.clear()
    this.rangedSlices.clear()
  }

  unlock = () => {
    if (this.running && this.ctx?.state === `suspended`) this.ctx.resume().catch(() => {})
  }

  event(id) { return this.mapData?.events[id] ?? this.manifestData?.events[id] }

  startEvent(eventId, emitter, entity, volume, voice, depth, allowRetrigger) {
    let ev = this.event(eventId)
    let ctx = this.ctx
    if (!ev || !ctx || depth > 4 || voice.stopped) return
    let now = ctx.currentTime
    let limitKey = `${eventId}|${entity}`
    // 阻塞窗口（bd = block duration）：防止同一声音过频触发
    if (ev.bd && !ev.loop) {
      let blockKey = ev.be ? limitKey : eventId
      if (now < (this.blockedUntil.get(blockKey) ?? -Infinity)) return
      this.blockedUntil.set(blockKey, now + ev.bd)
    }
    for (let child of ev.c ?? []) this.startEvent(child, emitter, entity, volume, voice, depth + 1, allowRetrigger)
    // 随机重触发事件（rt = retrigger 区间）
    if (allowRetrigger && ev.rt) {
      let [min, max] = ev.rt
      voice.retriggers.push({ name: eventId, event: ev, emitter, entity, volume, next: now + min + Math.random() * Math.max(0, max - min) })
      if (!ev.loop) return
    }
    let sounds = ev.f
    if (!sounds?.length) return
    let v = {
      name: eventId,
      limitKey,
      pos: resolveSoundPos(ev, emitter),
      curve: ev.d,
      volume: Math.max(0, jitterVolume(ev.v, ev.vr, Math.random())) * volume,
      loop: ev.loop === 1,
      due: now + (ev.dl ?? 0),
      stopped: false,
      ended: false,
      spatialGain: 1,
      pan: 0,
    }
    this.spatialize(v)
    if (!v.loop && v.volume * v.spatialGain < MIN_AUDIBLE_GAIN) return
    if (ev.lim) this.enforceLimit(limitKey, ev.lim)
    this.makeRoom()
    this.voices.push(v)
    voice.voices.push(v)
    let soundRef = sounds[Math.floor(Math.random() * sounds.length)]
    let pitch = Math.max(0.25, jitterVolume(ev.p, ev.pr, Math.random()))
    this.sound(soundRef).then((buffer) => {
      if (!buffer || v.stopped || !this.ctx || this.ctx !== ctx) { v.ended = true; return }
      if (!v.loop && ctx.currentTime - v.due > VOICE_DROP_TIME) { v.ended = true; return }
      this.connect(v, buffer, pitch, ev)
    })
  }

  connect(v, buffer, pitch, ev) {
    let ctx = this.ctx
    let level = ctx.createGain()
    let spatial = ctx.createGain()
    let panner = ctx.createStereoPanner()
    spatial.gain.value = v.volume * v.spatialGain
    panner.pan.value = v.pan
    level.connect(spatial).connect(panner).connect(this.master)
    v.level = level
    v.spatial = spatial
    v.panner = panner
    let startAt = Math.max(ctx.currentTime, v.due)
    // 音量包络曲线（t = 时间轴）
    if (ev.t && ev.t.length >= 4) {
      let dur = ev.t[ev.t.length - 2]
      if (dur > 0) {
        let curve = new Float32Array(16)
        for (let i = 0; i < curve.length; i++) curve[i] = sampleCurve(ev.t, (dur * i) / (curve.length - 1))
        level.gain.setValueCurveAtTime(curve, startAt, dur)
      }
    }
    if (`buffer` in buffer) {
      let src = ctx.createBufferSource()
      src.buffer = buffer.buffer
      src.playbackRate.value = pitch
      src.loop = v.loop
      src.connect(level)
      src.onended = () => this.release(v)
      let offset = v.loop && ev.rs ? Math.random() * buffer.buffer.duration : 0
      src.start(startAt, offset)
      v.source = src
      return
    }
    // 大文件走 HTMLMediaElement 流式播放（避免整段解码）
    let media = new Audio(buffer.url)
    media.loop = v.loop
    media.preservesPitch = false
    media.playbackRate = pitch
    let node = ctx.createMediaElementSource(media)
    node.connect(level)
    media.addEventListener(`ended`, () => this.release(v))
    if (ev.rs) media.addEventListener(`loadedmetadata`, () => { if (Number.isFinite(media.duration)) media.currentTime = Math.random() * media.duration }, { once: true })
    media.play().catch(() => this.release(v))
    v.media = media
    v.mediaNode = node
  }

  stopVoice(v, fade) {
    if (v.stopped) return
    v.stopped = true
    let ctx = this.ctx
    if (!ctx || !v.level) { v.ended = true; return }
    let now = ctx.currentTime
    v.level.gain.cancelScheduledValues(now)
    v.level.gain.setTargetAtTime(0, now, Math.max(0.001, fade / 3))
    if (v.source) {
      try { v.source.stop(now + fade) } catch { this.release(v) }
    } else if (v.media) {
      let media = v.media
      window.setTimeout(() => { media.pause(); this.release(v) }, fade * 1000)
    }
  }

  release(v) {
    v.ended = true
    v.stopped = true
    v.source?.disconnect()
    v.mediaNode?.disconnect()
    if (v.media) { v.media.pause(); v.media.removeAttribute(`src`); v.media.load() }
    v.panner?.disconnect()
    v.media = undefined
    v.source = undefined
  }

  enforceLimit(limitKey, limit) {
    let count = 0
    for (let i = this.voices.length - 1; i >= 0; i--) {
      let v = this.voices[i]
      if (v.stopped || v.limitKey !== limitKey) continue
      if (++count >= limit) this.stopVoice(v, 0.02)
    }
  }

  makeRoom() {
    let count = 0
    for (let v of this.voices) if (!v.stopped) count++
    for (let v of this.voices) {
      if (count < MAX_VOICES) return
      if (!v.stopped && !v.loop) { this.stopVoice(v, 0.02); count-- }
    }
  }

  spatialize(v) {
    if (!v.pos) { v.spatialGain = sampleCurve(v.curve, 0); v.pan = 0; return }
    let dx = v.pos[0] - this.listener.x
    let dy = v.pos[1] - this.listener.y
    let dz = v.pos[2] - this.listener.z
    let dist = Math.hypot(dx, dy, dz)
    v.spatialGain = sampleCurve(v.curve, dist)
    v.pan = 0.85 * (dist > 0.001 ? (dx * this.right.x + dy * this.right.y + dz * this.right.z) / dist : 0) * Math.min(1, dist / 60)
  }

  sound(ref) {
    let p = this.decoded.get(ref)
    if (p) {
      let size = this.decodedSizes.get(ref)
      if (size !== undefined) { this.decodedSizes.delete(ref); this.decodedSizes.set(ref, size) }  // LRU 移到末尾
      return p
    }
    p = this.loadSound(ref).catch((e) => (console.warn(`[audio] sound failed:`, ref, e), null))
    this.decoded.set(ref, p)
    p.then((buf) => {
      if (!buf || !(`buffer` in buf) || this.decoded.get(ref) !== p) return
      let size = buf.buffer.length * buf.buffer.numberOfChannels * 4
      this.decodedSizes.set(ref, size)
      this.decodedBytes += size
      for (let [key] of this.decodedSizes) {
        if (this.decodedBytes <= MAX_DECODED_BYTES) break
        if (key !== ref) this.forget(key)
      }
    })
    return p
  }

  forget(ref) {
    let p = this.decoded.get(ref)
    this.decoded.delete(ref)
    this.decodedBytes -= this.decodedSizes.get(ref) ?? 0
    this.decodedSizes.delete(ref)
    p?.then((buf) => { if (buf && `url` in buf) setTimeout(() => URL.revokeObjectURL(buf.url), 60000) })
  }

  async loadSound(ref) {
    let ctx = this.ctx
    if (!ctx) return null
    let data, asUrl = false
    if (ref >= 0) {
      let entry = this.manifestData?.sounds[ref]
      let bank = entry && this.manifestData?.banks[entry[0]]
      if (!entry || !bank) return null
      data = await this.slice(bank, entry[1], entry[2], false)
    } else {
      let entry = this.mapData?.sounds[-1 - ref]
      let bank = entry && this.mapData?.banks[entry[0]]
      if (!entry || !bank) return null
      let ranged = entry[0] > 0
      asUrl = ranged && entry[2] > INLINE_SOUND_MAX
      data = await this.slice(`maps/${bank}`, entry[1], entry[2], ranged)
    }
    return data
      ? asUrl
        ? { url: URL.createObjectURL(new Blob([data], { type: `audio/ogg` })) }
        : { buffer: await ctx.decodeAudioData(data) }
      : null
  }

  async slice(bank, start, length, ranged) {
    let full = this.banks.get(bank)
    if (full || !ranged) {
      let buf = await (full ?? this.fetchBank(bank))
      return buf ? buf.slice(start, start + length) : null
    }
    // 大 bank 用 Range 请求只取需要的片段
    let key = `${bank}@${start}`
    let p = this.rangedSlices.get(key)
    if (!p) {
      p = this.fetchRange(bank, start, length)
      this.rangedSlices.set(key, p)
      p.then((b) => { if (!b && this.rangedSlices.get(key) === p) this.rangedSlices.delete(key) })
    }
    let buf = await p
    return buf ? buf.slice(0) : null
  }

  async fetchRange(bank, start, length) {
    let resp = await this.get(bank, { headers: { Range: `bytes=${start}-${start + length - 1}` } })
    if (!resp?.ok) return null
    if (resp.status === 206) return resp.arrayBuffer()
    let full = resp.arrayBuffer()
    this.banks.set(bank, full)
    return (await full).slice(start, start + length)
  }

  fetchBank(bank) {
    let p = this.get(bank).then((r) => (r?.ok ? r.arrayBuffer() : null)).catch(() => null)
    this.banks.set(bank, p)
    return p
  }

  async fetchJson(path) {
    try { let r = await this.get(path); return r?.ok ? await r.json() : null } catch { return null }
  }

  async fetchGrid(path) {
    try {
      let r = await this.get(path)
      if (!r?.ok || !r.body) return null
      let decompressed = r.body.pipeThrough(new DecompressionStream(`gzip`))
      return decodeSurfaceGrid(new Uint8Array(await new Response(decompressed).arrayBuffer()))
    } catch (e) { console.warn(`[audio] surface grid failed:`, e); return null }
  }

  async get(path, opts) {
    this.base ??= fv(`sounds`)   // fv = 资源基地址解析
    let base = await this.base
    if (!base) { this.base = null; return null }
    let resp
    try { resp = await fetch(base + path, opts) } catch { return null }
    if (resp.status === 404) this.relocate(base)
    return resp
  }

  // 404 时尝试迁移到备用资源地址（重新解析 base）
  async relocate(oldBase) {
    if (this.relocating) return
    this.relocating = true
    let newBase
    try { newBase = await pv(`sounds`, oldBase) } finally { this.relocating = false }
    if (!newBase || this.disposed || (await this.base) !== oldBase) return
    this.base = Promise.resolve(newBase)
    for (let key of [...this.decoded.keys()]) this.forget(key)
    this.banks.clear()
    this.rangedSlices.clear()
    this.manifestData = null
    this.mapData = null
    this.mapGrid = null
    if (this.manifestLoad) { this.manifestLoad = null; this.start() }
    if (this.mapName) this.loadMap(this.mapName)
  }
}

// 解析声音世界坐标：事件定义了固定 pos 则用之，否则用 emitter 位置（+ 垂直偏移 oz）
function resolveSoundPos(ev, emitter) {
  let pos = ev.pos
  return pos && (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0)
    ? [pos[0], pos[1], pos[2]]
    : emitter ? [emitter.x, emitter.y, emitter.z + (ev.oz ?? 0)] : null
}

// ────────────────────────────────────────────────────────────────────────────
// 七、AudioDirector —— 音频导演
//     把 demo 数据（击杀/弹道/脚步/门/炸弹）合成为时序 cue，实时调度 AudioEngine。
// ────────────────────────────────────────────────────────────────────────────
const TICK_WINDOW_SEC = 0.5      // 前后 tick 窗口（s）
const RUN_SPEED = 135            // 跑步速度阈值
const CRACK_RADIUS = 80          // 子弹擦过声判定半径
const IMPACT_RADIUS = 1800
const MAX_IMPACTS = 4
const AMBIENCE_CHECK_INTERVAL = 0.25
const SCAPE_VOLUME = 0.35
const ENTITY_PLAYER = 1000
const ENTITY_FIRE = 3000
const ENTITY_FIRE_LOOP = 4000
const ENTITY_ROUND = 5000

class AudioDirector {
  engine
  breaks
  tracers
  data = null
  builtFor = null
  stepsPreloaded = false
  cues = []
  fires = []
  prevTick = null
  motion = []
  prevFoley = null
  prevFoleySlot = -1
  foleyOut = []
  fireLoops = new Map()
  scapeName = ``
  scapeInstance = null
  nextAmbienceCheck = 0
  points = new Map()
  pointReach = new Map()
  emitter = { x: 0, y: 0, z: 0 }
  impact = new B()

  constructor(engine, breaks, tracers) { this.engine = engine; this.breaks = breaks; this.tracers = tracers }

  setData(data) {
    this.data = data
    this.builtFor = null
    if (this.motion.length !== data.meta.numPlayers) this.motion = Array.from({ length: data.meta.numPlayers }, makeMotionState)
  }

  resetWindow() {
    this.prevTick = null
    this.prevFoley = null
    for (let m of this.motion) Object.assign(m, makeMotionState())
  }

  stopAll() {
    for (let v of this.fireLoops.values()) this.engine.stop(v, 0.2)
    this.fireLoops.clear()
    for (let v of this.points.values()) this.engine.stop(v, 0.2)
    this.points.clear()
    this.engine.stop(this.scapeInstance, 0.2)
    this.scapeInstance = null
    this.scapeName = ``
    this.nextAmbienceCheck = 0
    this.resetWindow()
  }

  update(state) {
    let data = this.data
    let manifest = this.engine.manifest
    if (!data || !manifest) return
    if (this.builtFor !== manifest) this.build(data, manifest)
    if (!this.stepsPreloaded && this.engine.map) this.preloadMap()
    let { tick } = state
    let tickRate = data.meta.tickRate
    let prev = this.prevTick
    if (prev === null || tick < prev || tick - prev > tickRate * TICK_WINDOW_SEC) { prev = tick; this.resetWindow() }
    this.prevTick = tick
    if (tick > prev) {
      this.playCues(prev, tick, state)
      this.playBullets(data, prev, tick, state)
      this.breaks.breaksBetween(prev, tick, (isGlass, material, pos) => {
        let name = isGlass ? `break.glass` : /vent|metal|grate/i.test(material) ? `break.metal` : `break.wood`
        this.playCore(name, pos, ENTITY_FIRE_LOOP)
      })
    }
    this.playMovement(data, (tick - prev) / tickRate, state)
    this.playFoley(state)
    this.updateFires(tick)
    this.updateAmbience(state.listener)
  }

  build(data, manifest) {
    this.builtFor = manifest
    let cues = []
    let numPlayers = data.meta.numPlayers
    let tickRate = data.meta.tickRate
    let { frames, panelFrames } = data
    let core = manifest.core
    let push = (tick, name, slot, x, y, z, entity) => { if (name) cues.push({ tick, name, slot, x, y, z, entity }) }
    let frameOf = (tick) => xC(frames.frameTick, tick)   // xC = 二分查找帧
    let hasArmor = (slot, tick) => panelFrames.armor[xC(panelFrames.frameTick, tick) * numPlayers + slot] > 0

    this.fires = data.grenades.effects.filter((e) => e.kind === `molotov`)
    let damage = data.damage
    let dmgOrder = Array.from({ length: damage.count }, (_, i) => i).sort((a, b) => damage.tick[a] - damage.tick[b])
    let dmgTicks = Int32Array.from(dmgOrder, (i) => damage.tick[i])
    let weaponFires = data.weaponFires

    // 武器开火音效
    if (weaponFires)
      for (let i = 0; i < weaponFires.ticks.length; i++) {
        let tick = weaponFires.ticks[i]
        let slot = weaponFires.slots[i]
        if (slot >= numPlayers) continue
        let weapon = data.weaponNames[panelFrames.activeWeapon[xC(panelFrames.frameTick, tick) * numPlayers + slot]]
        if (!weapon) continue
        if (Xy(weapon)) {  // 近战武器
          let maxDmg = 0
          for (let j = lowerBound(dmgTicks, tick - 2); j < dmgTicks.length && dmgTicks[j] <= tick + 8; j++) {
            let k = dmgOrder[j]
            if (damage.attackerSlot[k] === slot) maxDmg = Math.max(maxDmg, damage.dmg[k])
          }
          push(tick, core[maxDmg >= 50 ? `knife.stab` : maxDmg > 0 ? `knife.hit` : `knife.swing`], slot, 0, 0, 0, slot)
          continue
        }
        let team = frames.team[frameOf(tick) * numPlayers + slot]
        let weaponSound = Qy(weapon, team)   // Qy = 武器→音效映射
        push(tick, weaponSound ? manifest.weapons[weaponSound]?.shot : undefined, slot, 0, 0, 0, slot)
      }

    // 击杀 / 死亡音效
    let deathSet = new Set()
    for (let ev of data.events) {
      if (ev.type !== `kill` || ev.victimSlot === undefined || ev.victimSlot >= numPlayers) continue
      let slot = ev.victimSlot
      for (let d = -1; d <= 1; d++) deathSet.add(`${slot}:${ev.tick + d}`)
      let name = `death.${ev.headshot ? `head` : `body`}${hasArmor(slot, ev.tick) ? `Armor` : ``}`
      push(ev.tick, core[name], slot, 0, 0, 0, slot)
    }

    // 伤害命中音效
    for (let i = 0; i < damage.count; i++) {
      let tick = damage.tick[i]
      let victim = damage.victimSlot[i]
      if (victim >= numPlayers || deathSet.has(`${victim}:${tick}`)) continue
      let idx = frameOf(tick) * numPlayers + victim
      push(tick, core[
        this.burning(frames.posX[idx], frames.posY[idx], frames.posZ[idx], tick) ? `hit.burn`
          : damage.attackerSlot[i] >= numPlayers ? `hit.fall`
          : hasArmor(victim, tick) ? `hit.bodyArmor` : `hit.body`
      ], victim, 0, 0, 0, victim)
    }

    // 手雷投掷 / 弹跳 / 引爆音效
    let trajectories = data.grenades.trajectories
    trajectories.forEach((traj, idx) => {
      if (traj.ticks.length === 0) return
      let nadeName = nadeSoundName(traj.kind, traj.incendiary === true)
      let entity = ENTITY_PLAYER + idx
      let pos = traj.posXYZ
      if (traj.throwerSlot >= 0 && traj.throwerSlot < numPlayers) push(traj.startTick, core[`throw.${nadeName}`], traj.throwerSlot, 0, 0, 0, traj.throwerSlot)
      else push(traj.startTick, core[`throw.${nadeName}`], -1, pos[0], pos[1], pos[2], entity)
      for (let bounce of detectBounces(pos, traj.ticks, tickRate))
        push(traj.ticks[bounce], core[`bounce.${nadeName}`], -1, pos[bounce * 3], pos[bounce * 3 + 1], pos[bounce * 3 + 2], entity)
    })
    for (let effect of data.grenades.effects) {
      if (effect.kind === `decoy`) continue
      let nadeName = nadeSoundName(effect.kind, false)
      if (effect.kind === `molotov')
        nadeName = nadeSoundName(`molotov`, trajectories.find((t) => t.kind === `molotov` && Math.abs((t.detonationTick ?? t.endTick) - effect.startTick) <= 32)?.incendiary === true)
      push(effect.startTick, core[`detonate.${nadeName}`], -1, effect.x, effect.y, effect.z, ENTITY_FIRE_LOOP)
    }
    // 火焰熄灭
    for (let fire of this.fires) {
      let extinguished = data.grenades.effects.some((e) => e.kind === `smoke` && Math.abs(e.startTick - fire.endTick) <= 16 && Math.hypot(e.x - fire.x, e.y - fire.y) < 300)
      push(fire.endTick, core[extinguished ? `fire.extinguish` : `fire.end`], -1, fire.x, fire.y, fire.z, ENTITY_FIRE_LOOP)
    }

    this.buildBomb(data, cues, core)
    this.buildDoors(data, cues, core)
    cues.sort((a, b) => a.tick - b.tick)
    this.cues = cues

    for (let name of new Set(cues.map((c) => c.name))) this.engine.preload(name)
    for (let name of [`gear.ct`, `gear.t`, `jump`, `bullet.crack`, `bullet.impact`, `fire.loop`, `break.glass`, `break.wood`, `break.metal`])
      if (core[name]) this.engine.preload(core[name])
    let weaponSet = new Set()
    for (let weapon of data.weaponNames)
      for (let team of [2, 3]) {
        let sound = weapon ? Qy(weapon, team) : undefined
        if (sound) weaponSet.add(sound)
      }
    for (let sound of weaponSet)
      for (let foleyList of Object.values(manifest.weapons[sound]?.foley ?? {}))
        for (let [, soundId] of foleyList) this.engine.preload(soundId)
  }

  buildBomb(data, cues, core) {
    let tickRate = data.meta.tickRate
    let numPlayers = data.meta.numPlayers
    let push = (tick, name, slot, x = 0, y = 0, z = 0) => {
      let soundId = core[name]
      if (soundId) cues.push({ tick, name: soundId, slot, x, y, z, entity: slot >= 0 ? slot : 4001 })
    }
    let playerFlags = data.frames.playerFlags
    let frameTick = data.frames.frameTick
    // 玩家携带 C4 时按 beep 表播放按键声
    if (playerFlags)
      for (let slot = 0; slot < numPlayers; slot++) {
        let carryStart = -1
        for (let i = 0; i <= frameTick.length; i++) {
          let carrying = i < frameTick.length && (playerFlags[i * numPlayers + slot] & 4) != 0
          if (carrying && carryStart < 0) carryStart = frameTick[i]
          if (carrying || carryStart < 0) continue
          let endTick = i < frameTick.length ? frameTick[i] : Infinity
          for (let [t, name] of bombBeepEvents(carryStart, endTick, tickRate)) push(t, name, slot)
          carryStart = -1
        }
      }
    let planted = data.bomb.segments.filter((s) => s.kind === `planted`)
    let segmentAt = (tick) => planted.find((s) => s.startTick <= tick && tick <= s.endTick + tickRate) ?? planted.at(-1)
    for (let seg of planted) {
      let { x, y, z } = seg
      push(seg.startTick, `bomb.planted`, -1, x, y, z)
      for (let t of makeBeepSchedule(40)) {
        let tick = seg.startTick + t * tickRate
        if (tick >= seg.endTick) break
        if (t > 0) push(tick, `bomb.beep`, -1, x, y, z)
      }
      let warnTick = seg.startTick + 38.5 * tickRate
      if (warnTick < seg.endTick) push(warnTick, `bomb.warning`, -1, x, y, z)
    }
    for (let defuse of data.bomb.defuses) {
      let seg = segmentAt(defuse.startTick)
      if (seg) push(defuse.startTick, `bomb.defuse`, -1, seg.x, seg.y, seg.z)
    }
    for (let ev of data.events) {
      if (ev.type !== `bomb_exploded` && ev.type !== `bomb_defused`) continue
      let seg = segmentAt(ev.tick)
      if (seg) push(ev.tick, ev.type === `bomb_exploded` ? `bomb.explode` : `bomb.defused`, -1, seg.x, seg.y, seg.z)
    }
    for (let [tick, name] of buildRoundAnnouncements(data.events, tickRate, 2, 3)) {
      let soundId = core[name]
      if (soundId) cues.push({ tick, name: soundId, slot: -1, x: 0, y: 0, z: 0, entity: ENTITY_ROUND, head: true })
    }
  }

  buildDoors(data, cues, core) {
    let minGap = data.meta.tickRate * 0.25
    for (let door of data.mapEntities ?? []) {
      if (door.className !== `CPropDoorRotating` || door.ticks.length < 2) continue
      let { ticks, angles, origin } = door
      let refAngle = angles[1]
      for (let i = 1; i < ticks.length;) {
        let end = i
        while (end + 1 < ticks.length && ticks[end + 1] - ticks[end] <= minGap) end++
        let startAngle = Math.abs(angleDelta(angles[(i - 1) * 3 + 1], refAngle))
        let endAngle = Math.abs(angleDelta(angles[end * 3 + 1], refAngle))
        if (Math.abs(endAngle - startAngle) > 2) {
          let opening = endAngle > startAngle
          let [x, y, z] = origin
          let openSound = core[opening ? `door.open` : `door.close`]
          let openedSound = core[opening ? `door.opened` : `door.closed`]
          if (openSound) cues.push({ tick: ticks[i], name: openSound, slot: -1, x, y, z, entity: 4002 })
          if (openedSound) cues.push({ tick: ticks[end], name: openedSound, slot: -1, x, y, z, entity: 4002 })
        }
        i = end + 1
      }
    }
  }

  preloadMap() {
    this.stepsPreloaded = true
    for (let step of Object.values(this.engine.map.steps))
      for (let s of [step.ct, step.t, step.land, step.impact]) if (s) this.engine.preload(s)
  }

  // 二分定位第一个 > tick 的 cue，然后顺序播放 [prev, tick] 区间内的 cue
  playCues(prevTick, tick, state) {
    let { cues } = this
    let lo = 0, hi = cues.length
    while (lo < hi) { let mid = (lo + hi) >> 1; cues[mid].tick <= prevTick ? (lo = mid + 1) : (hi = mid) }
    for (let i = lo; i < cues.length && cues[i].tick <= tick; i++) {
      let cue = cues[i]
      if (cue.head) this.engine.play(cue.name, null, cue.entity)
      else if (cue.slot >= 0) this.engine.play(cue.name, this.playerEmitter(cue.slot, state), cue.entity)
      else this.engine.play(cue.name, this.at(cue.x, cue.y, cue.z), cue.entity)
    }
  }

  playBullets(data, prevTick, tick, state) {
    let tracers = data.tracers
    let core = this.builtFor.core
    let { listener } = state
    // 二分定位
    let lo = 0, hi = tracers.count
    while (lo < hi) { let mid = (lo + hi) >> 1; tracers.tick[mid] <= prevTick ? (lo = mid + 1) : (hi = mid) }
    let impacts = 0
    let lastCrackTick = -1
    for (let i = lo; i < tracers.count && tracers.tick[i] <= tick; i++) {
      let p = i * 3
      let ox = tracers.origin[p], oy = tracers.origin[p + 1], oz = tracers.origin[p + 2]
      let dx = tracers.end[p] - ox, dy = tracers.end[p + 1] - oy, dz = tracers.end[p + 2] - oz
      let len2 = dx * dx + dy * dy + dz * dz
      if (len2 < 1) continue
      // 最近点到线段投影，判断子弹是否擦过听者（crack 声）
      let tProj = Math.max(0, Math.min(1, ((listener.x - ox) * dx + (listener.y - oy) * dy + (listener.z - oz) * dz) / len2))
      let cx = ox + dx * tProj, cy = oy + dy * tProj, cz = oz + dz * tProj
      let dist = Math.hypot(listener.x - cx, listener.y - cy, listener.z - cz)
      if (!(Math.hypot(listener.x - ox, listener.y - oy, listener.z - oz) < 120) && tProj > 0 && tProj < 1 && dist < CRACK_RADIUS && tracers.tick[i] !== lastCrackTick) {
        lastCrackTick = tracers.tick[i]
        this.engine.play(core[`bullet.crack`], this.at(cx, cy, cz), 4003)
      }
      // 命中点撞击声
      if (!(tracers.hitKind[i] === 1 || dist > IMPACT_RADIUS || impacts >= MAX_IMPACTS) && this.tracers.impactAt(i, this.impact)) {
        impacts++
        this.engine.play(this.impactSound(this.impact), this.at(this.impact.x, this.impact.y, this.impact.z), 4004)
      }
    }
  }

  impactSound(pos) {
    let map = this.engine.map
    let grid = this.engine.grid
    if (map && grid) {
      let surface = querySurface(grid, pos.x, pos.y, pos.z)
      let sound = surface >= 0 ? map.steps[map.surfaces[surface]]?.impact : undefined
      if (sound) return sound
    }
    return this.builtFor.core[`bullet.impact`]
  }

  playMovement(data, dt, state) {
    let { buffers } = state
    let numPlayers = data.meta.numPlayers
    let playerFlags = data.frames.playerFlags
    let frameBase = xC(data.frames.frameTick, state.tick) * numPlayers
    for (let slot = 0; slot < numPlayers; slot++) {
      let m = this.motion[slot]
      if (buffers.alive[slot] !== 1) { Object.assign(m, makeMotionState()); continue }
      let onGround = playerFlags ? (playerFlags[frameBase + slot] & 1) != 0 : true
      let z = buffers.z[slot]
      if (dt > 0) {
        if (onGround) {
          if (!m.ground && m.air > 0.3) this.playStep(slot, `land`, state)   // 落地
          m.air = 0
          let speed = buffers.speed[slot]
          if (speed > RUN_SPEED) {
            m.step += dt
            if (m.step >= Math.min(0.45, Math.max(0.3, (0.35 * 250) / speed))) { m.step = 0; this.playStep(slot, `step`, state) }
          } else m.step = 0.2
        } else {
          if (m.ground && (z - m.z) / dt > 100) this.engine.play(this.builtFor.core.jump, this.playerEmitter(slot, state), slot)  // 起跳
          m.air += dt
        }
      }
      m.ground = onGround
      m.z = z
    }
  }

  playStep(slot, type, state) {
    let map = this.engine.map
    let core = this.builtFor.core
    let { buffers } = state
    let isT = buffers.team[slot] === 2
    let step = map?.steps.default
    let grid = this.engine.grid
    if (map && grid) {
      let surface = querySurface(grid, buffers.x[slot], buffers.y[slot], buffers.z[slot])
      if (surface >= 0) step = map.steps[map.surfaces[surface]] ?? step
    }
    let emitter = this.playerEmitter(slot, state)
    if (type === `land`) { this.engine.play(step?.land ?? core[`land.default`], emitter, slot); return }
    if (step) this.engine.play(isT ? step.t : step.ct, emitter, slot)
    this.engine.play(core[isT ? `gear.t` : `gear.ct`], emitter, slot)   // 装备摩擦声
  }

  playFoley(state) {
    let foley = state.foley
    if (state.listenerSlot !== this.prevFoleySlot) this.prevFoley = null
    this.prevFoleySlot = state.listenerSlot
    if (!foley) { this.prevFoley = null; return }
    let foleyMap = this.builtFor.weapons[foley.file]?.foley?.[foley.role]
    for (let soundId of foleyDelta(this.prevFoley, foley, foleyMap, this.foleyOut)) this.engine.play(soundId, null, state.listenerSlot)
    this.prevFoley = foley
  }

  updateFires(tick) {
    let fireLoop = this.builtFor.core[`fire.loop`]
    this.fires.forEach((fire, idx) => {
      let active = fire.startTick <= tick && tick < fire.endTick
      let voice = this.fireLoops.get(idx)
      if (active && !voice && fireLoop) {
        let v = this.engine.play(fireLoop, this.at(fire.x, fire.y, fire.z, true), ENTITY_FIRE + idx)
        if (v) this.fireLoops.set(idx, v)
      } else if (!active && voice) { this.engine.stop(voice, 0.3); this.fireLoops.delete(idx) }
    })
  }

  updateAmbience(listener) {
    let map = this.engine.map
    let now = this.engine.now
    if (!map || now < this.nextAmbienceCheck) return
    this.nextAmbienceCheck = now + AMBIENCE_CHECK_INTERVAL
    let inside = ``, insideDist = Infinity
    let nearest = ``, nearestDist = Infinity
    for (let scape of map.soundscapes) {
      if (scape.off) continue
      let d = Math.hypot(listener.x - scape.o[0], listener.y - scape.o[1], listener.z - scape.o[2])
      if (d < scape.r && d < insideDist) { inside = scape.e; insideDist = d }
      if (d < nearestDist) { nearest = scape.e; nearestDist = d }
    }
    let target = inside || this.scapeName || nearest
    if (target && (target !== this.scapeName || !this.scapeInstance)) {
      this.engine.stop(this.scapeInstance, 1.5)
      this.scapeInstance = this.engine.play(target, null, 4005, SCAPE_VOLUME)
      this.scapeName = target
    }
    map.points.forEach((point, idx) => {
      let reach = this.pointReach.get(point.e)
      if (reach === undefined) { reach = this.engine.reach(point.e); this.pointReach.set(point.e, reach) }
      let d = Math.hypot(listener.x - point.o[0], listener.y - point.o[1], listener.z - point.o[2])
      let voice = this.points.get(idx)
      if (!voice && d < reach * 1.05) {
        let v = this.engine.play(point.e, { x: point.o[0], y: point.o[1], z: point.o[2] }, 4010 + idx, SCAPE_VOLUME)
        if (v) this.points.set(idx, v)
      } else if (voice && d > reach * 1.15) { this.engine.stop(voice, 0.5); this.points.delete(idx) }
    })
  }

  burning(x, y, z, tick) {
    return this.fires.some((f) => f.startTick <= tick && tick <= f.endTick && Math.hypot(f.x - x, f.y - y) < 200 && Math.abs(f.z - z) < 120)
  }

  playerEmitter(slot, state) { return slot === state.listenerSlot ? null : this.at(state.buffers.x[slot], state.buffers.y[slot], state.buffers.z[slot]) }
  at(x, y, z, fresh = false) { let p = fresh ? { x: 0, y: 0, z: 0 } : this.emitter; p.x = x; p.y = y; p.z = z; return p }
  playCore(name, pos, entity) { let sound = this.builtFor?.core[name]; if (sound) this.engine.play(sound, this.at(pos.x, pos.y, pos.z), entity) }
}

function makeMotionState() { return { ground: true, air: 0, step: 0.2, z: 0 } }
function nadeSoundName(kind, incendiary) {
  switch (kind) {
    case `he`: return `hegrenade`
    case `flash`: return `flashbang`
    case `smoke`: return `smokegrenade`
    case `decoy`: return `decoy`
    default: return incendiary ? `incgrenade` : `molotov`
  }
}
function angleDelta(a, b) { return ((((a - b) % 360) + 540) % 360) - 180 }
function lowerBound(arr, target) {
  let lo = 0, hi = arr.length
  while (lo < hi) { let mid = (lo + hi) >> 1; arr[mid] < target ? (lo = mid + 1) : (hi = mid) }
  return lo
}

// ────────────────────────────────────────────────────────────────────────────
// 八、DemoApp —— 播放器主控
//     整合场景、角色、特效、音频、HUD 所有子系统，驱动渲染循环与播放逻辑。
// ────────────────────────────────────────────────────────────────────────────
const FEED_UPDATE_WINDOW = 256      // 事件交接 tick 窗口
const SCRUB_RENDER_INTERVAL = 1000 / 30   // 拖拽预览渲染节流（ms）
const ROUND_BACKFILL_MARGIN = 3     // 平滑回填的末尾保护（秒）
const MAP_LOAD_DELAY = 2000         // 渲染器加载后的延迟（ms）
const BOMB_CARRIER_FLAG = 512       // 查找安放炸弹时回看的帧数
const MAP_MODE_CLASSIFIED = `classified`
const BOMB_BLINK_BEEP = RN()        // 复用 beep 时刻表做闪烁
const BOMB_BLINK_WINDOW = 0.12
const MAX_SOUND_SPEED = 2

class DemoApp {
  ready
  container
  model          // bg = 数据采样模型
  data
  manifest
  loadedRounds
  parsedRounds
  clock          // Cg = 播放时钟
  scene          // qD = 场景渲染器
  players        // ID = 胶囊体玩家渲染
  cameras        // zf = 相机系统
  nametags       // LM = 头顶名字
  hud            // jM = HUD
  feed           // vN = 事件流（本文件）
  controls       // xA = 播放控制条
  controlsAutoHide  // LA = 控制条自动隐藏
  povPicker      // HA = POV 选择器
  panels         // KM = 玩家面板
  mapLoader      // R_ = 地图加载
  cs2Map         // vy = CS2 地图
  grenades       // CD = 手雷特效
  smoke          // WO = 烟雾
  gpuTier = XD()
  tracers        // Ok = 弹道渲染
  deathMarkers   // Lb = 死亡标记
  droppedWeapons // ox = 掉落武器
  mapBreaks      // mS = 地图破坏
  characters     // zw = 角色渲染
  weaponLighting = new Ly()
  viewModel = new UT(this.weaponLighting)  // 第一人称视角模型
  viewPunch = $k()
  weaponModels = false
  audio          // QN = 音频引擎
  demoSounds     // dP = 音频导演
  soundOn = false
  soundRunning = false
  bombYawCache = { startTick: NaN, yaw: 0 }
  bomb           // wb = 炸弹模型
  crosshair      // XA
  scope          // oM = 开镜
  blind          // GA = 闪光致盲
  flashbang = new Ik()   // Ik = 辉光合成器
  flashEpisodeKey = null
  flashScreen = { remaining: 0, white: 0, afterimage: 0, exposure: 0 }
  damage         // QA = 伤害指示
  deathFade      // oj = 死亡淡出
  killReplay     // dj = 击杀回放
  killReplayTracker = new Dg()
  radar          // fN = 雷达（本文件）
  leaveFab
  settingsFab
  performanceFab
  scoreboard     // DN = 计分板（本文件）
  settings       // Zj = 设置面板
  statsOverlay   // vj = 性能统计
  statsConfig
  statsFrames = 0
  statsAccum = 0
  crosshairBySlot = new Map()
  buffers        // yg = 采样缓冲
  smokeOccluded
  smokeView = new B()
  smokeTarget = new B()
  raycaster = new nc()
  lastTimestamp = 0
  lastScrubRenderAt = -Infinity
  frameDt = 0
  lastRoundForFeed = -2
  nadeWindow = { startTick: 0, endTick: 0 }
  selectedGrenade = -1
  mobileFeedOpen = false
  scoreboardHeld = false
  lastHandoffTick = -Infinity
  deathScenario = null
  checkDeathScenarioAfterSeek = false
  smoothRoundBackfill = true
  pendingRoundData = null
  playbackWanted = true
  mapLoadGeneration = 0
  resetKillRespawns = new Map()
  running = true

  constructor(container, data, parseInfo, manifest = data.rounds.length, onLeave = () => {}, teams, teamResolver) {
    this.container = container
    this.data = data
    this.model = new bg(data)
    this.manifest = manifest ?? {
      mapName: data.meta.mapName, tickRate: data.meta.tickRate, startTick: data.meta.startTick,
      endTick: data.meta.endTick, durationSeconds: data.meta.durationSeconds, rounds: data.rounds,
    }
    this.loadedRounds = Math.min(manifest, this.manifest.rounds.length)
    this.parsedRounds = this.loadedRounds
    this.clock = new Cg(this.loadedDurationSeconds())
    this.buffers = yg(data.meta.numPlayers)
    this.smokeOccluded = new Uint8Array(data.meta.numPlayers)
    this.rebuildResetKillRespawns()

    let aspect = container.clientWidth / Math.max(1, container.clientHeight)
    this.scene = new qD(container, { antialias: this.gpuTier !== `mobile` })
    this.players = new ID(this.scene.scene, data.meta.numPlayers)
    this.cameras = new zf(this.scene.renderer.domElement, aspect, data.meta.numPlayers)
    this.nametags = new LM(container, this.scene.scene, data.players)
    this.hud = new jM(container, teamResolver)
    this.feed = new vN(container, {
      onSelectKill: (id) => this.jumpToKill(id),
      onSelectNade: (id) => this.jumpToNade(id),
      onViewNadeLanding: (id) => this.jumpToNadeLanding(id),
    })
    this.panels = new KM(container, (slot) => this.followPlayer(slot))
    this.controls = new xA(container, this.manifest.durationSeconds || this.model.duration, {
      onPlayPause: () => this.togglePlayback(),
      onSeek: (t) => this.seekPlayback(t),
      onSkip: (dt) => this.seekPlayback(this.clock.time + dt),
      onSpeed: (s) => { this.clock.setSpeed(s); this.controls.setSpeed(s) },
      onSelectFree: () => this.selectFreeCamera(),
      onSelectFly: () => this.selectFlyCamera(),
      onSelectNoclip: () => this.selectNoclipCamera(),
      onSelectPlayer: (slot) => this.followPlayer(slot),
      onToggleEvents: () => this.toggleMobilePanel(`events`),
      onToggleScoreboard: () => this.toggleMobilePanel(`scoreboard`),
    })
    this.controlsAutoHide = new LA({
      container, surface: this.scene.renderer.domElement, controls: this.controls.element,
      media: window.matchMedia(WA), deferTaps: () => this.cameras.getMode().kind === `free`,
    })
    this.povPicker = new HA(container, {
      onSelectFree: () => this.selectFreeCamera(),
      onSelectPlayer: (slot) => this.followPlayer(slot),
    })
    this.frameScene()
    this.controls.setTimelineMarkers(this.roundFractions(), this.timeoutMarkers(), this.majorTimelineEvents())
    this.updateRoundLoadState()
    this.hud.setInfo(data.meta.mapName, ``)

    let classification = P_(data.meta.mapName)   // P_ = 地图分类
    this.mapLoader = new R_(this.scene.scene)
    this.cs2Map = new vy(this.scene.renderer)
    this.scene.scene.add(this.cs2Map.group)
    this.grenades = new CD(this.scene.scene, data.grenades, (slot, tick) => this.teamAtFrameTick(slot, tick), this.weaponLighting, data.meta.tickRate)
    this.smoke = new WO(this.scene.scene, data.grenades.effects, data.smokeVoxels)
    this.applyGpuTier()
    this.smoke.setTracers(data.tracers)
    this.tracers = new Ok(this.scene.scene, data.tracers, this.scene.renderer)
    this.deathMarkers = new Lb(this.scene.scene, data.deathMarkers)
    this.droppedWeapons = new ox(this.scene.scene, data.droppedWeapons ?? [], this.weaponLighting)
    this.characters = new zw(this.scene.scene, data.meta.numPlayers, this.weaponLighting)
    this.bomb = new wb(this.scene.scene, this.weaponLighting)
    this.mapBreaks = new mS(this.scene.scene, this.weaponLighting)
    this.mapBreaks.setMap(this.cs2Map)
    this.mapBreaks.setCauses(this.breakCauses())
    this.audio = new QN()
    this.demoSounds = new dP(this.audio, this.mapBreaks, this.tracers)
    this.demoSounds.setData(this.data)
    this.crosshair = new XA(container)
    this.scope = new oM(container)
    this.blind = new GA(container)
    this.damage = new QA(container)
    this.deathFade = new oj(container, (slot, mode) => this.replayDeath(slot, mode), (slot, tick) => this.teamAtFrameTick(slot, tick))
    this.killReplay = new dj(container, (slot, mode) => this.replayDeath(slot, mode), () => this.dismissKillReplay(), (slot, tick) => this.teamAtFrameTick(slot, tick))

    // 三个悬浮按钮（后续被雷达内置按钮替代）
    this.leaveFab = this.makeFab(`leave-fab`, `Leave demo`, leaveIconSvg(), onLeave)
    this.settingsFab = this.makeFab(`settings-fab`, `Settings`, `⚙`, () => this.settings.toggle())
    this.performanceFab = this.makeFab(`performance-fab`, `Performance`, `▥`, () => this.statsOverlay.show())

    let statsData = { parseMs: parseInfo?.parseMs ?? null, source: parseInfo?.source ?? `local-parse`, fileSizeBytes: parseInfo?.fileSizeBytes ?? null, sampleRate: data.meta.sampleRate, tickRate: data.meta.tickRate, durationSeconds: data.meta.durationSeconds }
    this.statsConfig = gj()
    this.statsOverlay = new vj(container, statsData, this.statsConfig, () => this.hud.getScorebarBounds())

    let statsApi = { getConfig: () => this.statsConfig, setConfig: (c) => { this.statsConfig = c; this.statsOverlay.setConfig(c); _j(c) } }
    this.settings = new Zj(container, {
      onMapChange: (mode) => void this.setMapMode(mode),
      onCs2MapOptionsChange: (o) => this.setCs2MapOptions(o),
      onCs2ExposureChange: (e) => this.scene.setCs2Exposure(e),
      onMapClassificationChange: (c) => this.setMapClassification(c),
      onMapEnvironmentChange: (env) => this.applyMapEnvironment(env),
      onShadowQualityChange: (q) => this.scene.setShadowQuality(q),
      onMapAtmosphereChange: (a) => this.scene.setAtmosphereEnabled(a),
      onMapFilmicContrastChange: (c) => this.scene.setFilmicContrastEnabled(c),
      onSmoothRoundBackfillChange: (b) => { this.smoothRoundBackfill = b; if (!b) this.flushPendingRoundData(true) },
      onXrayChange: (x) => this.players.setXray(x),
      onEffectGraphicsChange: (g) => { this.smoke.setGraphics(g); this.grenades.setMolotovGraphics(g) },
      onViewerChange: (v) => this.applyViewerSettings(v),
    }, { dev: false, initialMap: { mode: this.gpuTier === `mobile` ? MAP_MODE_CLASSIFIED : `cs2`, classification }, stats: statsApi })

    this.mapLoader.setClassification(this.settings.currentMapClassification)
    this.applyMapEnvironment(this.settings.currentMapClassification)
    this.players.setXray(this.settings.xrayEnabled)
    this.smoke.setGraphics(this.settings.effectGraphics)
    this.grenades.setMolotovGraphics(this.settings.effectGraphics)
    this.scene.setShadowQuality(this.settings.currentShadowQuality)
    this.scene.setAtmosphereEnabled(this.settings.mapAtmosphereEnabled)
    this.scene.setFilmicContrastEnabled(this.settings.mapFilmicContrastEnabled)
    this.smoothRoundBackfill = true
    this.scoreboard = new DN(container, (slot) => this.followPlayer(slot), teams)
    this.applyViewerSettings(this.settings.viewerSettings)
    this.clock.onChange(() => {
      this.controls.setPlaying(this.clock.playing)
      this.controlsAutoHide.setPaused(!this.clock.playing)
      this.controls.setSpeed(this.clock.speed)
      if (!this.clock.playing) this.flushPendingRoundData(true)
    })
    this.controlsAutoHide.setPaused(!this.clock.playing)
    this.bindInput()
    window.addEventListener(`resize`, this.onResize)
    this.ready = this.prepareMap(data.meta.mapName, onLeave, teamResolver)

    let initialSlot = this.initialPlayerSlot()
    if (initialSlot >= 0) this.cameras.follow(initialSlot)
    this.sampleAndRender(0)
    this.playbackWanted = true
    this.clock.play()
    requestAnimationFrame(this.tick)
  }

  makeFab(cls, title, content, onClick) {
    let btn = document.createElement(`button`)
    btn.type = `button`
    btn.className = cls
    btn.title = title
    btn.setAttribute(`aria-label`, title)
    btn.innerHTML = content
    btn.addEventListener(`click`, onClick)
    this.container.appendChild(btn)
    return btn
  }

  async prepareMap(mapName, onLeave, onProgress) {
    let mapDone = false
    let mapPromise = this.loadMap(mapName, onProgress).finally(() => { if (!mapDone) onProgress?.(`Loading ${mapName} radar…`) })
    let radarPromise = this.loadRadar(mapName, onLeave).finally(() => { mapDone = true })
    await Promise.all([mapPromise, radarPromise])
    if (this.running) { onProgress?.(`Loading renderer…`); await new Promise((r) => window.setTimeout(r, MAP_LOAD_DELAY)) }
  }

  initialPlayerSlot() {
    let { frames, meta } = this.data
    if (meta.numPlayers === 0 || frames.frameTick.length === 0) return -1
    for (let i = 0; i < meta.numPlayers; i++) if (frames.alive[i] === 1) return i
    return 0
  }

  async loadRadar(mapName, onLeave) {
    let radar
    try {
      let mapping = await S_(mapName)   // S_ = 雷达图元数据加载
      if (!this.running || !mapping) return
      radar = new fN(this.container, mapping, mapping.file, (slot) => this.followPlayer(slot), onLeave, () => this.settings.toggle(), () => this.statsOverlay.show())
      await radar.ready
      if (!this.running) { radar.dispose(); return }
      this.radar = radar
      this.radar.setVisible(this.settings.viewerSettings.hud.radar)
      this.leaveFab?.remove(); this.settingsFab?.remove(); this.performanceFab?.remove()
      this.leaveFab = this.settingsFab = this.performanceFab = undefined
    } catch (e) { radar?.dispose(); console.warn(`[csplayer] radar load failed:`, e) }
  }

  async loadMap(mapName, onProgress) {
    let gen = ++this.mapLoadGeneration
    let mode = this.settings.mapMode
    if (mode !== `grid`)
      try { await this.showMap(mode, mapName, gen, onProgress) }
      catch (e) { console.warn(`[csplayer] map load failed, using grid:`, e) }
  }

  async showMap(mode, mapName, gen, onProgress) {
    let mapPromise = this.mapLoader.load(mapName, mode === `cs2` ? undefined : onProgress, { collisionOnly: mode === `cs2` })
    let cs2Loaded = false
    if (mode === `cs2`) {
      this.clearCs2Map()
      try { cs2Loaded = await this.cs2Map.load(mapName, this.settings.cs2MapOptions, onProgress) }
      catch (e) { console.warn(`[csplayer] CS2 map load failed, using the default map:`, e) }
    } else this.clearCs2Map()
    let mapOk = await mapPromise
    if (this.running && gen === this.mapLoadGeneration) {
      if (mode === `cs2` && !cs2Loaded) {
        this.clearCs2Map()
        mode = MAP_MODE_CLASSIFIED
        this.settings.syncMapMode(mode)
        mapOk = await this.mapLoader.load(mapName, onProgress)
        if (!this.running || gen !== this.mapLoadGeneration) return
      }
      this.scene.setGridVisible(!mapOk && !cs2Loaded)
      if (this.mapLoader.object) this.mapLoader.object.visible = !cs2Loaded
      this.scene.setClassifiedMap(mapOk && !cs2Loaded ? this.mapLoader.object : null)
      this.cameras.setCollisionObject(this.mapLoader.object)
      this.characters.setCollisionObject(this.mapLoader.object)
      this.mapBreaks.setCollisionObject(this.mapLoader.object)
      this.tracers.setMapObject(this.mapLoader.object)
      this.grenades.setMapObject(this.mapLoader.object)
      this.applyCs2Environment(cs2Loaded)
      this.precompileEffects()
    }
  }

  clearCs2Map() { this.cs2Map.clear(); this.applyCs2Environment(false) }

  applyCs2Environment(hasCs2) {
    let env = hasCs2 ? this.cs2Map.sceneEnvironment() : null
    if (env) this.cs2Map.installGrading()
    this.scene.setCs2Environment(env)
    if (!env) this.applyMapEnvironment(this.settings.currentMapClassification)
    this.settings.syncCs2Exposure(env?.exposure ?? null)
    if (!env || !this.weaponLighting.setCs2Map(this.cs2Map)) this.weaponLighting.setClassic(this.scene.classicLighting())
    this.characters.setEnabled(env !== null)
    this.setWeaponModelsEnabled(env !== null)
  }

  setWeaponModelsEnabled(enabled) {
    this.weaponModels = enabled
    this.droppedWeapons.setModelsEnabled(enabled)
    this.grenades.setModelsEnabled(enabled)
    this.bomb.setModelsEnabled(enabled)
    this.mapBreaks.setEnabled(enabled)
  }

  breakCauses() {
    return { tracers: this.data.tracers, effects: this.data.grenades.effects, frames: this.data.frames, numPlayers: this.data.meta.numPlayers, tickRate: this.data.meta.tickRate }
  }

  setCs2MapOptions(options) { this.cs2Map.pvsEnabled = options.visibilityCulling }

  precompileEffects() {
    Promise.resolve().then(() => {
      this.mapLoader.updateInteriorLights(this.cameras.camera.position)
      let smokeScenes = this.smoke.shaderScenes
      return this.scene.precompile(this.cameras.camera, {
        sceneObjects: [this.grenades.fireShaderPrototypes, this.mapBreaks.shaderPrototypes],
        screenOverlays: [this.grenades.blastScene, smokeScenes.screen],
        offscreenOverlays: [smokeScenes.offscreen],
      })
    }).catch((e) => console.warn(`[csplayer] effect shader precompile failed:`, e))
  }

  async setMapMode(mode) {
    let gen = ++this.mapLoadGeneration
    if (mode === `grid`) {
      this.mapLoader.clearMap(); this.clearCs2Map(); this.scene.setClassifiedMap(null)
      this.cameras.setCollisionObject(null); this.characters.setCollisionObject(null); this.mapBreaks.setCollisionObject(null)
      this.scene.setGridVisible(true); this.tracers.setMapObject(null); this.grenades.setMapObject(null)
      return
    }
    try { await this.showMap(mode, this.data.meta.mapName, gen) }
    catch (e) { console.warn(`[csplayer] map switch failed, using grid:`, e); if (this.running) this.scene.setGridVisible(true) }
  }

  setMapClassification(classification) {
    this.mapLoader.setClassification(classification)
    this.applyMapEnvironment(classification)
    if (this.settings.mapMode === `classified`) this.setMapMode(`classified`)
  }

  applyMapEnvironment(env) {
    this.scene.setMapEnvironment(env.hazeColor, env.skyHorizonColor, env.skyZenithColor, env.sunAzimuth, env.sunElevation)
    if (!this.weaponLighting.usesCs2Map) this.weaponLighting.setClassic(this.scene.classicLighting())
  }

  // 计算整个回放的空间包围盒，用于相机取景
  frameScene() {
    let { frames, meta } = this.data
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity
    let n = frames.posX.length
    for (let i = 0; i < n; i++) {
      if (frames.alive[i] !== 1) continue
      let x = frames.posX[i], y = frames.posY[i], z = frames.posZ[i]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z
    }
    let empty = !isFinite(minX)
    if (empty) {  // 无玩家时用烟雾/燃烧弹位置估算
      let smoke = this.data.smokeVoxels
      for (let i = 0; i < smoke.count; i++) {
        let x = smoke.detonation[i * 3], y = smoke.detonation[i * 3 + 1], z = smoke.detonation[i * 3 + 2]
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (z < minZ) minZ = z
      }
      for (let inferno of this.data.grenades.infernos ?? [])
        for (let frame of inferno.frames)
          for (let i = 0; i < frame.positions.length; i += 3) {
            minX = Math.min(minX, frame.positions[i]); maxX = Math.max(maxX, frame.positions[i])
            minY = Math.min(minY, frame.positions[i + 1]); maxY = Math.max(maxY, frame.positions[i + 1])
            minZ = Math.min(minZ, frame.positions[i + 2])
          }
    }
    if (!isFinite(minX)) minX = maxX = minY = maxY = minZ = 0
    let center = new B((minX + maxX) / 2, (minY + maxY) / 2, minZ)
    let radius = 0.5 * Math.max(maxX - minX, maxY - minY, empty ? 500 : 1000)
    this.scene.setFloor(minZ)
    this.cameras.frameScene(center, radius)
  }

  roundFractions() {
    let dur = this.manifest.durationSeconds || 1
    return this.data.rounds.map((r) => (r.startTick - this.data.meta.startTick) / this.data.meta.tickRate / dur).filter((f) => f >= 0 && f <= 1)
  }
  timeoutMarkers() {
    let dur = this.manifest.durationSeconds || 1
    return this.data.timeouts.intervals.map((t) => ({
      fraction: (t.startTick - this.data.meta.startTick) / this.data.meta.tickRate / dur,
      endFraction: (t.endTick - this.data.meta.startTick) / this.data.meta.tickRate / dur,
      side: t.side, technical: t.technical,
    })).filter((m) => m.fraction >= 0 && m.fraction <= 1)
  }
  majorTimelineEvents() {
    let { events, meta } = this.data
    let out = []
    for (let ev of events) {
      let time = (ev.tick - meta.startTick) / meta.tickRate
      if (ev.type === `kill` && (ev.attackerTeam === 2 || ev.attackerTeam === 3))
        out.push({ time, kind: `kill`, team: ev.attackerTeam === 2 ? `t` : `ct`, iconUrl: Zb(`skull`), title: `${ev.attackerName ?? `Player`} killed ${ev.victimName ?? `player`}`, actor: ev.attackerName ?? `Player`, target: ev.victimName ?? `player`, targetTeam: ev.victimTeam === 2 ? `t` : ev.victimTeam === 3 ? `ct` : undefined })
      else if (ev.type === `bomb_planted') out.push({ time, kind: `plant`, team: `t`, iconUrl: Zb(`c4`), title: `Bomb planted` })
      else if (ev.type === `bomb_exploded`) out.push({ time, kind: `explode`, team: `t`, iconUrl: Zb(`planted_c4`), title: `Bomb exploded` })
      else if (ev.type === `bomb_defused`) out.push({ time, kind: `defuse`, team: `ct`, iconUrl: Zb(`defuser`), title: `Bomb defused` })
      else if (ev.type === `round_end` && ev.roundReason === 10) out.push({ time, kind: `time`, team: `ct`, title: `Time expired` })
    }
    return out
  }

  roundLoadRanges() {
    let dur = this.manifest.durationSeconds || 1
    return this.manifest.rounds.map((r) => ({
      startFraction: (r.startTick - this.manifest.startTick) / this.manifest.tickRate / dur,
      endFraction: (r.endTick - this.manifest.startTick) / this.manifest.tickRate / dur,
    }))
  }
  updateRoundLoadState() { this.controls.setRoundLoadState(this.roundLoadRanges(), this.parsedRounds, this.loadedDurationSeconds()) }
  loadedDurationSeconds() {
    if (this.manifest.rounds.length === 0) return this.model.duration
    let last = this.manifest.rounds[Math.max(0, this.loadedRounds - 1)]
    return Math.max(0, last.endTick - this.manifest.startTick) / this.manifest.tickRate
  }

  applyViewerSettings(v) {
    for (let [key, val] of Object.entries(v.hud)) this.container.setAttribute(`data-hud-${key.toLowerCase()}`, String(val))
    this.radar?.setVisible(v.hud.radar)
    if (!v.hud.scoreboard) this.scoreboard.hide()
    if (!v.hud.eventFeed) this.mobileFeedOpen = false
    this.container.setAttribute(`data-mobile-feed`, String(this.mobileFeedOpen))
    this.controls.setHudAvailability(v.hud.eventFeed, v.hud.scoreboard)
    this.controls.setMobilePanels(this.mobileFeedOpen, this.scoreboard.isVisible())
    this.cameras.setFlyPreferences(v.mouseSensitivity, v.invertLook, v.flySpeed)
    this.scene.setRenderScale(v.renderScale)
    this.tracers.setRenderScale(v.renderScale)
    this.audio.setVolume(v.volume / 100)
    this.updateBlindOverlay()
  }

  setGpuTier(tier) { this.gpuTier = tier; this.applyGpuTier() }
  applyGpuTier() { this.smoke.setGpuTier(this.gpuTier) }

  onKeyDown = (e) => {
    if (e.target instanceof HTMLElement && (e.target.closest(`input, textarea, select, [contenteditable="true"], .settings-panel`) || (e.target.closest(`button`) && (e.key === ` ` || e.key === `Enter` || e.key === `Tab`)))) return
    switch (e.key) {
      case ` `: e.preventDefault(); this.togglePlayback(); break
      case `[`: this.cyclePlayer(-1); break
      case `]`: this.cyclePlayer(1); break
      case `f`: case `F`: this.selectFreeCamera(); break
      case `Escape`: if (this.cameras.getMode().kind !== `fly` && this.cameras.getMode().kind !== `noclip`) this.selectFreeCamera(); break
      case `v`: case `V`: this.cameras.getMode().kind === `fly` ? this.selectFreeCamera() : this.selectFlyCamera(); break
      case `n`: case `N`: this.cameras.getMode().kind === `noclip` ? this.selectFreeCamera() : this.selectNoclipCamera(); break
      case `m`: case `M`: this.settings.toggleRadar(); break
      case `x`: case `X`: this.settings.toggleXray(); break
      case `Tab`:
        e.preventDefault()
        if (this.settings.viewerSettings.hud.scoreboard) { this.scoreboardHeld = true; this.scoreboard.show() }
        this.controls.setMobilePanels(this.mobileFeedOpen, this.scoreboard.isVisible())
        break
    }
  }
  onKeyUp = (e) => {
    if (e.key === `Tab` && this.scoreboardHeld) {
      e.preventDefault(); this.scoreboardHeld = false; this.scoreboard.hide(); this.controls.setMobilePanels(this.mobileFeedOpen, false)
    }
  }

  bindInput() {
    window.addEventListener(`keydown`, this.onKeyDown)
    window.addEventListener(`keyup`, this.onKeyUp)
    this.scene.renderer.domElement.addEventListener(`click`, (e) => {
      if (this.cameras.getMode().kind === `fly` || this.cameras.getMode().kind === `noclip`) return
      let rect = this.scene.renderer.domElement.getBoundingClientRect()
      let ndc = new z(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      this.raycaster.setFromCamera(ndc, this.cameras.camera)
      let slot = this.players.intersect(this.raycaster)
      if (slot >= 0) this.followPlayer(slot)
    })
  }

  togglePlayback() { this.playbackWanted = !this.clock.playing; this.clock.toggle() }

  toggleMobilePanel(panel) {
    let hud = this.settings.viewerSettings.hud
    if (panel === `events` && hud.eventFeed) { this.mobileFeedOpen = !this.mobileFeedOpen; this.scoreboard.hide() }
    else if (panel === `scoreboard` && hud.scoreboard) {
      this.mobileFeedOpen = false
      if (this.scoreboard.isVisible()) this.scoreboard.hide()
      else { this.scoreboard.show(); this.updateScoreboard(this.clock.time) }
    }
    this.container.setAttribute(`data-mobile-feed`, String(this.mobileFeedOpen))
    this.controls.setMobilePanels(this.mobileFeedOpen, this.scoreboard.isVisible())
  }

  onResize = () => {
    let w = this.container.clientWidth, h = this.container.clientHeight
    this.scene.resize()
    this.cameras.resize(w / Math.max(1, h))
    this.nametags.resize(w, h)
    this.tracers.resize(w, h)
    this.settings.reposition()
    this.statsOverlay.reposition()
  }

  tick = (ts) => {
    if (!this.running) return
    this.maybeApplyPendingRoundData()
    let dt = this.lastTimestamp ? (ts - this.lastTimestamp) / 1000 : 0
    this.lastTimestamp = ts
    this.frameDt = Math.min(dt, 0.1)
    this.clock.advance(this.frameDt)
    if (this.clock.playing && !this.controls.isScrubbing) {
      let v = this.settings.viewerSettings
      let { startTick, tickRate } = this.data.meta
      let skipTo = computeSkipTarget(this.data, startTick + this.clock.time * tickRate, startTick + this.loadedDurationSeconds() * tickRate, v.skipFreezeTime, v.skipTimeouts)
      if (skipTo !== null) this.seekPlayback((skipTo - startTick) / tickRate)
    }
    if (this.controls.isScrubbing) {
      if (ts - this.lastScrubRenderAt >= SCRUB_RENDER_INTERVAL) { this.sampleAndRenderScrubPreview(this.clock.time); this.lastScrubRenderAt = performance.now() }
    } else this.sampleAndRender(this.clock.time, true)
    this.updateStats(dt)
    requestAnimationFrame(this.tick)
  }

  updateStats(dt) {
    this.statsFrames++
    this.statsAccum += dt
    if (this.statsAccum < 0.5) return
    let info = this.scene.renderer.info.render
    this.statsOverlay.updateLive({ fps: this.statsFrames / this.statsAccum, frameMs: (this.statsAccum * 1000) / this.statsFrames, drawCalls: info.calls, triangles: info.triangles })
    this.statsFrames = 0; this.statsAccum = 0
  }

  // 核心渲染：采样当前时间 → 更新所有子系统 → 渲染
  sampleAndRender(time, smooth = false) {
    this.model.sample(time, this.buffers)
    let tick = this.data.meta.startTick + time * this.data.meta.tickRate
    let inDeath = this.deathScenario?.pending != null
    this.updateViewPunch(tick)
    if (!inDeath) this.cameras.update(this.buffers, this.frameDt)
    this.maybeStartDeathScenarioAfterSeek(tick)
    this.updatePlaybackEvents(tick)
    if (inDeath && this.deathScenario?.pending == null) this.cameras.update(this.buffers, this.frameDt)
    this.deathFade.setActive(this.deathScenario?.pending != null)
    this.updateKillReplay(tick)

    let tagSlot = this.followedSlotForTags()
    this.mapLoader.updateInteriorLights(this.cameras.camera.position)
    this.cs2Map.updateObjects(this.data.mapEntities, tick)
    this.mapBreaks.update(tick)
    this.cs2Map.update(this.cameras.camera, this.cameras.getMode().kind === `first`)
    this.grenades.setTrajectoryVisibility(this.settings.viewerSettings.trajectories, this.cameras.getFollowedSlot(), this.selectedGrenade)
    this.grenades.update(tick, this.cameras.camera)
    this.smoke.update(tick)
    this.updateSmokeOcclusion()
    this.players.update(this.buffers, this.data.damage, tick, this.data.meta.tickRate, tagSlot, this.smokeOccluded)
    this.updateCharacters(tick, tagSlot, this.smokeOccluded)
    this.damage.update(this.data.damage, this.cameras.getFollowedSlot(), tick, this.data.meta.tickRate)

    let showTeam = tagSlot >= 0 && !this.settings.xrayEnabled
    let team = showTeam ? this.buffers.team[tagSlot] : -1
    let occluded = this.settings.xrayEnabled ? undefined : this.smokeOccluded
    let bombSnapshot = this.computeBombSnapshot(tick)
    this.nametags.update(this.buffers, tagSlot, team, occluded, this.nametagContext(tick, bombSnapshot.carrierSlot))
    this.tracers.update(tick)
    this.deathMarkers.update(tick, this.buffers.alive, showTeam)
    this.droppedWeapons.update(tick)
    this.bomb.update(bombSnapshot, this.bombYaw(tick))
    this.controls.setTime(time)
    this.updateHud(time)
    this.updateCrosshair(time, smooth)
    this.updateBlindOverlay(time)
    this.updatePanels(time)
    this.radar?.update(this.buffers, this.cameras.getFollowedSlot(), bombSnapshot)
    this.updateScoreboard(time)
    this.scene.beginRenderFrame()
    this.renderSceneAndPrepareEffects(this.cameras.camera)
    this.grenades.renderBlasts(this.scene.renderer, this.cameras.camera)
    this.smoke.render(this.scene.renderer, this.cameras.camera, this.scene.drawingBufferSize)
    this.players.renderXray(this.scene.renderer, this.cameras.camera, this.xrayCharacters())
    this.renderViewModel(tick)
    this.updateSound(tick)
    this.renderFlashbang()
    this.nametags.render(this.cameras.camera)
  }

  updateSound(tick) {
    let audio = this.audio
    let director = this.demoSounds
    let v = this.settings.viewerSettings
    let wantSound = this.weaponModels && !v.muted && v.volume > 0 && this.clock.speed <= MAX_SOUND_SPEED
    if (wantSound !== this.soundOn) {
      this.soundOn = wantSound
      if (wantSound) { audio.start(); if (audio.map === null) audio.loadMap(this.data.meta.mapName) }
      else { director.stopAll(); audio.stopOneShots() }
    }
    let shouldRun = wantSound && this.clock.playing
    if (shouldRun !== this.soundRunning) { this.soundRunning = shouldRun; audio.setRunning(shouldRun); if (!shouldRun) director.resetWindow() }
    if (!shouldRun) return
    let mode = this.cameras.getMode()
    director.update({ tick, buffers: this.buffers, listener: this.cameras.camera.position, listenerSlot: mode.kind === `first` ? mode.slot : -1, foley: this.viewModel.foleyPose })
    audio.update(this.cameras.camera)
  }

  updateCharacters(tick, tagSlot, occluded) {
    this.characters.update(this.data, this.buffers, tick, this.cameras.camera, tagSlot, occluded, this.players.xrayEnabled)
    this.players.setBodiesVisible(!this.characters.active)
  }
  xrayCharacters() { return this.characters.active ? this.characters : undefined }

  updateViewPunch(tick) {
    let mode = this.cameras.getMode()
    if (!this.weaponModels || mode.kind !== `first` || this.buffers.alive[mode.slot] !== 1) { this.cameras.setViewPunch(0, 0); return }
    tA(this.data, mode.slot, tick, this.viewPunch)   // tA = 后坐力视图冲击计算
    this.cameras.setViewPunch(this.viewPunch.pitch, this.viewPunch.yaw)
  }

  renderViewModel(tick) {
    let mode = this.cameras.getMode()
    let slot = this.weaponModels && mode.kind === `first` ? mode.slot : -1
    if (!(slot >= 0 && this.deathScenario?.pending == null && this.buffers.alive[slot] === 1 && this.buffers.zoom[slot] === 0 &&
      this.viewModel.update({ data: this.data, slot, tick, duck: this.buffers.duck[slot], aspect: this.cameras.camera.aspect, camera: this.cameras.camera }))) {
      this.viewModel.hide(); return
    }
    this.viewModel.render(this.scene.renderer)
  }

  sampleAndRenderScrubPreview(time) {
    this.model.sample(time, this.buffers)
    this.deathFade.setActive(false)
    let tagSlot = this.followedSlotForTags()
    let tick = this.data.meta.startTick + time * this.data.meta.tickRate
    this.updateKillReplay(tick)
    this.updateViewPunch(tick)
    this.cameras.update(this.buffers, this.frameDt)
    this.players.update(this.buffers, this.data.damage, tick, this.data.meta.tickRate, tagSlot)
    this.updateCharacters(tick, tagSlot)
    this.damage.update(this.data.damage, this.cameras.getFollowedSlot(), tick, this.data.meta.tickRate)
    this.tracers.update(tick)
    this.updateHud(time, false)
    this.updatePanels(time)
    this.updateCrosshair(time)
    this.updateBlindOverlay(time)
    let showTeam = tagSlot >= 0 && !this.settings.xrayEnabled
    let team = showTeam ? this.buffers.team[tagSlot] : -1
    this.deathMarkers.update(tick, this.buffers.alive, showTeam)
    this.droppedWeapons.update(tick)
    this.nametags.update(this.buffers, tagSlot, team, undefined, this.nametagContext(tick, this.computeBombSnapshot(tick).carrierSlot))
    this.scene.beginRenderFrame()
    if (this.players.xrayEnabled) {
      let depth = this.scene.renderWithDepth(this.cameras.camera)
      this.players.applyXrayDepth(depth, this.scene.drawingBufferSize)
      this.players.renderXray(this.scene.renderer, this.cameras.camera, this.xrayCharacters())
    } else this.scene.renderPreview(this.cameras.camera)
    this.renderViewModel(tick)
    this.renderFlashbang()
    this.nametags.render(this.cameras.camera)
  }

  renderSceneAndPrepareEffects(camera, target) {
    let smokeNeedsDepth = this.smoke.needsDepthPrepass(camera)
    let blastsNeedDepth = this.grenades.blastsNeedDepth
    if (smokeNeedsDepth || blastsNeedDepth || this.players.xrayEnabled) {
      let depth = this.scene.renderWithDepth(camera, target)
      let size = target ?? this.scene.drawingBufferSize
      if (smokeNeedsDepth) this.smoke.applySceneDepth(depth, camera, size)
      if (blastsNeedDepth) this.grenades.applyBlastDepth(depth, camera, size)
      if (this.players.xrayEnabled) this.players.applyXrayDepth(depth, size)
      return
    }
    this.scene.render(camera)
  }

  updateSmokeOcclusion() {
    this.smokeOccluded.fill(0)
    this.smokeView.copy(this.cameras.camera.position)
    for (let slot = 0; slot < this.buffers.alive.length; slot++) {
      if (this.buffers.alive[slot] !== 1 || slot === this.followedSlotForTags()) continue
      let height = this.buffers.duck[slot] > 0.5 ? 54 : 72
      for (let frac of [0.25, 0.55, 0.85]) {
        this.smokeTarget.set(this.buffers.x[slot], this.buffers.y[slot], this.buffers.z[slot] + height * frac)
        if (this.smoke.obscuresSegment(this.smokeView, this.smokeTarget)) { this.smokeOccluded[slot] = 1; break }
      }
    }
  }

  followedSlotForTags() { let m = this.cameras.getMode(); return m.kind === `first` ? m.slot : -1 }

  computeBombSnapshot(tick) {
    let { segments } = this.data.bomb
    let defusing = Tg(this.data, tick)   // Tg = 当前拆除状态
    let isDefusing = defusing !== null
    let hasKit = defusing?.hasKit ?? false
    let segment = null
    for (let s of segments) if (tick >= s.startTick && tick < s.endTick) { segment = s; break }
    if (!segment) return { kind: `none`, x: 0, y: 0, z: 0, carrierSlot: -1, site: ``, blink: false, defusing: isDefusing, defuseHasKit: hasKit }
    if (segment.kind === `carried`) {
      let slot = segment.carrierSlot
      let valid = slot >= 0 && slot < this.buffers.x.length
      return { kind: `carried`, x: valid ? this.buffers.x[slot] : 0, y: valid ? this.buffers.y[slot] : 0, z: valid ? this.buffers.z[slot] : 0, carrierSlot: slot, site: ``, blink: false, defusing: isDefusing, defuseHasKit: hasKit }
    }
    if (segment.kind === `planted`) {
      let elapsed = (tick - segment.startTick) / this.data.meta.tickRate
      let lo = 0, hi = BOMB_BLINK_BEEP.length - 1
      while (lo < hi) { let mid = (lo + hi + 1) >> 1; BOMB_BLINK_BEEP[mid] <= elapsed ? (lo = mid) : (hi = mid - 1) }
      let blink = elapsed >= 0 && elapsed - BOMB_BLINK_BEEP[lo] < BOMB_BLINK_WINDOW
      return { kind: `planted`, x: segment.x, y: segment.y, z: segment.z, carrierSlot: -1, site: segment.site, blink, defusing: isDefusing, defuseHasKit: hasKit }
    }
    return { kind: `dropped`, x: segment.x, y: segment.y, z: segment.z, carrierSlot: -1, site: ``, blink: false, defusing: isDefusing, defuseHasKit: hasKit }
  }

  updatePlaybackEvents(tick) {
    let prev = this.lastHandoffTick
    this.lastHandoffTick = tick
    let delta = tick - prev
    if (delta > 0 && delta < FEED_UPDATE_WINDOW) {
      for (let ev of this.data.events) {
        if (ev.tick <= prev || ev.tick > tick) continue
        this.applyPendingDeathHandoff(ev.tick)
        if (ev.type === `round_start`) { this.clearKillReplay(); this.restoreDeathCamera(); continue }
        if (ev.type !== `kill` || ev.victimSlot !== this.cameras.getFollowedSlot()) continue
        this.startDeathScenario(ev, ev.tick)
      }
      this.applyPendingDeathHandoff(tick)
    }
  }

  startDeathScenario(death, tick) {
    let mode = this.cameras.getMode()
    if (mode.kind !== `first` && mode.kind !== `spectate`) return
    this.clearKillReplay()
    this.deathScenario ??= { originalSlot: mode.slot, originalMode: mode.kind, restoreTick: this.nextRoundTick(death.tick), pending: null }
    this.deathScenario.pending = { victimSlot: mode.slot, death, switchTick: tick + 2 * this.data.meta.tickRate }
    this.deathFade.show(death, this.data.damage, this.data.players, this.roundStartTick(death.tick))
  }

  maybeStartDeathScenarioAfterSeek(tick) {
    if (!this.checkDeathScenarioAfterSeek) return
    this.checkDeathScenarioAfterSeek = false
    let mode = this.cameras.getMode()
    if ((mode.kind !== `first` && mode.kind !== `spectate`) || this.isPlayerAlive(mode.slot, tick)) return
    let death = kg(this.data.events, this.roundStartTick(tick), mode.slot, tick)   // kg = 查找死亡事件
    if (death) this.startDeathScenario(death, tick)
  }

  applyPendingDeathHandoff(tick) {
    let scenario = this.deathScenario
    if (!scenario) return
    if (scenario.restoreTick !== null && scenario.restoreTick <= tick) { this.restoreDeathCamera(); return }
    let pending = scenario.pending
    if (!pending || pending.switchTick > tick) return
    scenario.pending = null
    if (this.cameras.getFollowedSlot() !== pending.victimSlot) { this.cancelDeathScenario(); return }
    let nextSlot = Ag(this.data.events, pending.death, pending.switchTick, scenario.restoreTick, this.data.meta.tickRate, (slot, t) => this.isPlayerAlive(slot, t)) ?? this.pickLivingPlayer(pending.victimSlot, pending.switchTick, scenario.restoreTick)
    if (nextSlot >= 0) this.followLikeCurrent(nextSlot, scenario.originalMode)
    else this.cameras.setFree()
  }

  restoreDeathCamera() { let s = this.deathScenario; if (s) { this.followLikeCurrent(s.originalSlot, s.originalMode); this.cancelDeathScenario() } }

  replayDeath(event, mode) {
    let slot = mode === `victim` ? event.victimSlot : event.attackerSlot
    if (slot === undefined || slot < 0) { console.warn(`Cannot replay ${mode} POV without a valid player slot.`); return }
    let { startTick, tickRate } = this.data.meta
    let target = Math.max(this.roundStartTick(event.tick), event.tick - this.settings.viewerSettings.killLeadIn * tickRate)
    this.seekPlayback((target - startTick) / tickRate)
    this.followPlayer(slot)
    this.playbackWanted = true
    this.clock.play()
    this.sampleAndRender(this.clock.time)
  }

  followLikeCurrent(slot, mode = this.cameras.getMode().kind) {
    this.clearKillReplay()
    if (mode === `spectate') this.cameras.spectate(slot)
    else this.cameras.follow(slot)
  }

  isPlayerAlive(slot, tick) {
    let { frames, meta } = this.data
    if (slot < 0 || slot >= meta.numPlayers) return false
    let frame = this.model.findFrame((tick - meta.startTick) / meta.tickRate)
    return frames.alive[frame * meta.numPlayers + slot] === 1
  }

  pickLivingPlayer(excludeSlot, fromTick, toTick) {
    let { frames, meta } = this.data
    let n = meta.numPlayers
    let base = this.model.findFrame((fromTick - meta.startTick) / meta.tickRate) * n
    let team = frames.team[base + excludeSlot]
    let fallback = -1
    for (let slot = 0; slot < n; slot++) {
      if (slot === excludeSlot || frames.alive[base + slot] !== 1) continue
      if (!jg(this.data.events, slot, fromTick, toTick, meta.tickRate)) continue
      if (frames.team[base + slot] === team) return slot
      if (fallback < 0) fallback = slot
    }
    return fallback
  }

  followPlayer(slot) { this.clearKillReplay(); this.cancelDeathScenario(); this.cameras.follow(slot) }
  cyclePlayer(dir) { this.clearKillReplay(); this.cancelDeathScenario(); this.cameras.cyclePlayer(dir, (s) => this.buffers.alive[s] === 1) }
  selectFreeCamera() { this.clearKillReplay(); this.cancelDeathScenario(); this.cameras.setFree() }
  selectFlyCamera() { this.clearKillReplay(); this.cancelDeathScenario(); this.cameras.setFly() }
  selectNoclipCamera() { this.clearKillReplay(); this.cancelDeathScenario(); this.cameras.setNoclip() }

  seekPlayback(time) {
    this.clearKillReplay()
    this.cancelDeathScenario()
    this.scope.resetReticleTransition()
    this.clock.seek(time)
    this.audio.stopOneShots()
    this.demoSounds.resetWindow()
    this.lastHandoffTick = this.data.meta.startTick + this.clock.time * this.data.meta.tickRate
    this.checkDeathScenarioAfterSeek = true
  }

  cancelDeathScenario() { this.deathScenario = null; this.deathFade.setActive(false) }
  clearKillReplay() { this.killReplayTracker.reset(); this.killReplay.update(null, this.lastHandoffTick, this.data.meta.tickRate) }
  dismissKillReplay() { this.killReplayTracker.dismiss(); this.killReplay.update(null, this.lastHandoffTick, this.data.meta.tickRate) }

  updateKillReplay(tick) {
    let slot = this.cameras.getFollowedSlot()
    if (this.deathScenario?.pending || !this.isPlayerAlive(slot, tick)) { this.clearKillReplay(); return }
    this.killReplayTracker.update(tick, slot, this.roundStartTick(tick), this.data.meta.tickRate, this.data.meta.numPlayers, this.data.events, this.nextRoundTick(tick) ?? this.data.meta.endTick + 1)
    this.killReplay.update(this.killReplayTracker.group, tick, this.data.meta.tickRate)
  }

  roundStartTick(tick) {
    let start = this.data.meta.startTick
    for (let r of this.data.rounds) { if (r.startTick > tick) break; start = r.startTick }
    return start
  }
  nextRoundTick(tick) { return this.data.rounds.find((r) => r.startTick > tick)?.startTick ?? null }

  updateCrosshair(time, smooth = false) {
    let mode = this.cameras.getMode()
    if (mode.kind === `first` && this.buffers.alive[mode.slot] === 1) {
      let zoom = this.buffers.zoom[mode.slot]
      let { panelFrames, meta, weaponNames } = this.data
      let tick = meta.startTick + time * meta.tickRate
      let frame = EP(panelFrames.frameTick, tick)
      let weapon = weaponNames[panelFrames.activeWeapon[frame * meta.numPlayers + mode.slot]] ?? ``
      if (zoom > 0) {
        this.scope.show(zoom, weapon, this.buffers.speed[mode.slot], this.buffers.accuracyPenalty[mode.slot], this.buffers.duck[mode.slot], smooth ? { time, dt: this.clock.playing ? this.frameDt : 0, slot: mode.slot } : undefined)
        this.crosshair.hide()
      } else { this.scope.hide(); if (iM(weapon)) this.crosshair.hide(); else this.crosshair.show(this.getCrosshair(mode.slot)) }
    } else { this.scope.hide(); this.crosshair.hide() }
  }

  updateBlindOverlay(time = this.clock.time) {
    let mode = this.cameras.getMode()
    let { meta } = this.data
    let tick = meta.startTick + time * meta.tickRate
    let flash = mode.kind === `first` ? Wk(this.data.frames, meta.numPlayers, mode.slot, tick, meta.tickRate) : null
    let screen = Gk(flash, tick, meta.tickRate)
    if (mode.kind !== `first` || screen.remaining <= 0) { this.flashEpisodeKey = null; this.flashScreen = screen; this.blind.hide(); return }
    let effect = this.settings.viewerSettings.flashEffect
    this.flashScreen = Kk(screen, !this.settings.xrayEnabled, effect)
    this.flashEpisodeKey = `${mode.slot}:${flash.onsetTick}`
    this.blind.update(screen.remaining, screen.white, !this.settings.xrayEnabled, effect)
  }

  renderFlashbang() {
    let s = this.flashScreen
    this.flashbang.render(this.scene.renderer, s.afterimage > 0 ? this.flashEpisodeKey : null, s.afterimage, s.exposure, s.white)
  }

  getCrosshair(slot) {
    let crosshair = this.crosshairBySlot.get(slot)
    if (!crosshair) {
      let code = this.data.players[slot]?.crosshairCode
      crosshair = (code && vg(code)) || pg
      this.crosshairBySlot.set(slot, crosshair)
    }
    return crosshair
  }

  nametagContext(tick, bombCarrier) {
    let { panelFrames, weaponNames } = this.data
    return { panelFrames, weaponNames, frame: EP(panelFrames.frameTick, tick), bombCarrier }
  }

  updatePanels(time) {
    let { panelFrames, meta, players, weaponNames } = this.data
    let n = meta.numPlayers
    let tick = meta.startTick + time * meta.tickRate
    let defuse = Tg(this.data, tick)
    let frameBase = EP(panelFrames.frameTick, tick) * n
    let followed = this.cameras.getFollowedSlot()
    let { kills, deaths } = this.killsAtTick(tick)
    let tRows = [], ctRows = []
    for (let slot = 0; slot < n; slot++) {
      let idx = frameBase + slot
      let team = panelFrames.team[idx]
      let util = panelFrames.utilCounts[idx]
      let row = {
        slot, name: players[slot]?.name ?? `Player ${slot}`, team,
        alive: panelFrames.alive[idx] === 1,
        health: panelFrames.health[idx], armor: panelFrames.armor[idx],
        helmet: (panelFrames.flags[idx] & 1) == 1, defuser: (panelFrames.flags[idx] & 2) == 2,
        defuseProgress: panelFrames.alive[idx] === 1 && defuse?.defuserSlot === slot ? defuse.progress : null,
        money: panelFrames.money[idx], weapon: weaponNames[panelFrames.activeWeapon[idx]] ?? ``,
        clipAmmo: panelFrames.clipAmmo[idx], reserveAmmo: panelFrames.reserveAmmo[idx],
        util: [util & 3, (util >> 2) & 3, (util >> 4) & 3, (util >> 6) & 3],
        kills: kills[slot], deaths: deaths[slot], followed: slot === followed,
      }
      if (team === 2) tRows.push(row); else ctRows.push(row)
    }
    this.panels.update(tRows, ctRows)
    this.povPicker.update(this.povPlayers(tRows, ctRows), followed, this.povMode())
    this.controls.setPlayers(players.map((p, slot) => ({ slot, name: p.name, alive: this.buffers.alive[slot] === 1 })), followed)
  }

  povPlayers(tRows, ctRows) {
    let map = (r) => ({ slot: r.slot, name: r.name, side: r.team === 2 ? `t` : r.team === 3 ? `ct` : null, alive: r.alive })
    return [...tRows.map(map), ...ctRows.map(map)]
  }
  povMode() { let k = this.cameras.getMode().kind; return k === `fly` || k === `noclip` || k === `free` ? k : `player` }

  killsAtTick(tick) {
    let kills = new Int32Array(this.data.meta.numPlayers)
    let deaths = new Int32Array(this.data.meta.numPlayers)
    for (let ev of this.data.events) {
      if (ev.type !== `kill`) continue
      if (ev.tick > tick) break
      let respawnTick = this.resetKillRespawns.get(ev)
      if (respawnTick !== undefined && tick >= respawnTick) continue
      if (ev.attackerSlot !== undefined && ev.attackerSlot >= 0) kills[ev.attackerSlot]++
      if (ev.victimSlot !== undefined && ev.victimSlot >= 0) deaths[ev.victimSlot]++
    }
    return { kills, deaths }
  }

  // 预计算每起击杀后受害者的重生 tick（用于 K/D 统计在重生后归零）
  rebuildResetKillRespawns() {
    this.resetKillRespawns.clear()
    let { events, frames, meta, rounds } = this.data
    for (let kill of events) {
      if (kill.type !== `kill` || kill.victimSlot === undefined || kill.victimSlot < 0) continue
      let roundEnd = events.find((e) => e.type === `round_end` && e.tick >= kill.tick)?.tick
      let nextRound = rounds.find((r) => r.startTick > kill.tick)?.startTick
      let bound = roundEnd ?? nextRound ?? meta.endTick
      let frame = this.model.findFrame((kill.tick - meta.startTick) / meta.tickRate) + 1
      for (; frame < frames.frameTick.length && frames.frameTick[frame] < bound; frame++)
        if (frames.alive[frame * meta.numPlayers + kill.victimSlot] === 1) { this.resetKillRespawns.set(kill, frames.frameTick[frame]); break }
    }
  }

  updateHud(time, withFeed = true) {
    let frame = this.model.findFrame(time)
    let tick = this.data.meta.startTick + time * this.data.meta.tickRate
    let match = d_(this.data, frame, tick)   // d_ = 比分/回合信息
    let mode = this.cameras.getMode()
    let followed = this.cameras.getFollowedSlot()
    this.controls.setTimeoutEnd(this.activeTimeoutEnd(time))
    if (mode.kind === `fly') this.controls.setViewMode(`fly`)
    else if (mode.kind === `noclip`) this.controls.setViewMode(`noclip`)
    else if (followed >= 0) this.controls.setViewMode(`player`)
    else this.controls.setViewMode(`free`)
    this.hud.setInfo(this.data.meta.mapName, ``)
    this.hud.setMatchState(match)
    this.hud.setDefuseCue(Tg(this.data, tick), followed, this.data.players[followed]?.name ?? `Player ${followed}`)
    if (withFeed) this.updateFeed(time)
  }

  activeTimeoutEnd(time) {
    let tick = this.data.meta.startTick + time * this.data.meta.tickRate
    let interval = this.data.timeouts.intervals.find((i) => tick >= i.startTick && tick < i.endTick)
    return interval ? (interval.endTick - this.data.meta.startTick) / this.data.meta.tickRate : null
  }

  updateFeed(time) {
    let tick = this.data.meta.startTick + time * this.data.meta.tickRate
    let roundIdx = this.roundIndexAtTick(tick)
    if (roundIdx !== this.lastRoundForFeed) {
      this.lastRoundForFeed = roundIdx
      this.nadeWindow = this.roundWindow(roundIdx)
      this.feed.setRound(roundIdx, this.buildRoundKills(roundIdx), this.buildRoundNades())
    }
    this.feed.update(tick, this.clock.playing)
  }

  roundWindow(idx) {
    let { rounds, meta } = this.data
    return { startTick: idx >= 0 ? rounds[idx].startTick : meta.startTick, endTick: idx + 1 < rounds.length ? rounds[idx + 1].startTick : meta.endTick }
  }

  buildRoundNades() {
    let { grenades, players, meta } = this.data
    let { startTick, endTick } = this.nadeWindow
    let out = []
    let trajectories = grenades.trajectories
    for (let i = 0; i < trajectories.length; i++) {
      let traj = trajectories[i]
      if (traj.startTick < startTick || traj.startTick >= endTick) continue
      let team = traj.throwerSlot >= 0 ? this.teamAtFrameTick(traj.throwerSlot, traj.startTick) : 0
      out.push({
        id: i, kind: traj.kind,
        thrower: traj.throwerSlot >= 0 ? (players[traj.throwerSlot]?.name ?? `Player ${traj.throwerSlot}`) : `—`,
        color: teamColor(team),
        tick: traj.startTick,
        timeLabel: formatClock(u_(startTick, traj.startTick, meta.tickRate, this.data.timeouts.intervals)),
      })
    }
    return out.sort((a, b) => a.tick - b.tick)
  }

  updateScoreboard(time) {
    if (!this.scoreboard.isVisible()) return
    let { events, damage, players, meta, frames } = this.data
    let n = meta.numPlayers
    let tick = meta.startTick + time * meta.tickRate
    let kills = new Int32Array(n), headshots = new Int32Array(n), assists = new Int32Array(n), deaths = new Int32Array(n)
    for (let ev of events)
      if (ev.type === `kill`) {
        if (ev.tick > tick) break
        if (ev.attackerSlot !== undefined && ev.attackerSlot >= 0) { kills[ev.attackerSlot]++; if (ev.headshot) headshots[ev.attackerSlot]++ }
        if (ev.assisterSlot !== undefined && ev.assisterSlot >= 0) assists[ev.assisterSlot]++
        if (ev.victimSlot !== undefined && ev.victimSlot >= 0) deaths[ev.victimSlot]++
      }
    let dmg = new Int32Array(n)
    for (let i = 0; i < damage.count && !(damage.tick[i] > tick); i++) {
      let attacker = damage.attackerSlot[i], victim = damage.victimSlot[i]
      if (attacker !== victim && this.teamAtFrameTick(attacker, damage.tick[i]) !== this.teamAtFrameTick(victim, damage.tick[i])) dmg[attacker] += damage.dmg[i]
    }
    let frame = this.model.findFrame(time)
    let frameBase = frame * n
    let followed = this.cameras.getFollowedSlot()
    let panelFrames = this.data.panelFrames
    let panelBase = EP(panelFrames.frameTick, tick) * n
    let rows = []
    for (let slot = 0; slot < n; slot++)
      rows.push({
        slot, name: players[slot]?.name ?? `Player ${slot}`, team: frames.team[frameBase + slot],
        money: panelFrames.money[panelBase + slot] ?? 0,
        kills: kills[slot], deaths: deaths[slot], assists: assists[slot], dmg: dmg[slot],
        hsPct: kills[slot] > 0 ? Math.round((headshots[slot] / kills[slot]) * 100) : -1,
        alive: frames.alive[frameBase + slot] === 1, followed: slot === followed,
      })
    let match = d_(this.data, frame)
    this.scoreboard.update(rows, { tLabel: match.tLabel, ctLabel: match.ctLabel })
  }

  teamAtFrameTick(slot, tick) {
    let { frames, meta } = this.data
    let n = meta.numPlayers
    if (slot < 0 || slot >= n) return 0
    let frame = this.model.findFrame((tick - meta.startTick) / meta.tickRate)
    return frames.team[frame * n + slot]
  }

  bombYaw(tick) {
    let { segments } = this.data.bomb
    let segIdx = segments.findIndex((s) => tick >= s.startTick && tick < s.endTick)
    let startTick = segIdx >= 0 ? segments[segIdx].startTick : -1
    if (startTick === this.bombYawCache.startTick) return this.bombYawCache.yaw
    let { frames, meta } = this.data
    let n = meta.numPlayers
    let frame = this.model.findFrame((startTick - meta.startTick) / meta.tickRate)
    let prevSeg = segIdx > 0 ? segments[segIdx - 1] : undefined
    let carrier = prevSeg?.kind === `carried` ? prevSeg.carrierSlot : -1
    // 安放瞬间向前回看找携带者
    if (carrier < 0 && segIdx >= 0 && segments[segIdx].kind === `planted` && frames.playerFlags)
      for (let f = frame; f >= Math.max(0, frame - BOMB_CARRIER_FLAG) && carrier < 0; f--)
        for (let slot = 0; slot < n; slot++) if (frames.playerFlags[f * n + slot] & 4) carrier = slot
    let yaw = carrier >= 0 && carrier < n ? (frames.yaw[frame * n + carrier] ?? 0) : 0
    this.bombYawCache = { startTick, yaw }
    return yaw
  }

  roundIndexAtTick(tick) {
    let rounds = this.data.rounds
    let idx = -1
    for (let i = 0; i < rounds.length && rounds[i].startTick <= tick; i++) idx = i
    return idx
  }

  buildRoundKills(idx) {
    let { rounds, events, meta } = this.data
    let startTick = idx >= 0 ? rounds[idx].startTick : meta.startTick
    let endTick = idx + 1 < rounds.length ? rounds[idx + 1].startTick : meta.endTick
    let out = []
    for (let i = 0; i < events.length; i++) {
      let ev = events[i]
      if (ev.type === `kill` && !(ev.tick < startTick || ev.tick >= endTick))
        out.push(DP(ev, i, u_(startTick, ev.tick, meta.tickRate, this.data.timeouts.intervals)))
    }
    return out
  }

  jumpToKill(id) {
    let ev = this.data.events[id]
    if (!ev || ev.type !== `kill`) return
    let slot = ev.weapon === `world` || (ev.victimSlot !== undefined && ev.attackerSlot === ev.victimSlot) ? ev.victimSlot : (ev.attackerSlot ?? ev.victimSlot)
    let target = Math.max(0, ev.time - this.settings.viewerSettings.killLeadIn)
    this.seekPlayback(target)
    if (slot !== undefined && slot >= 0) this.followPlayer(slot)
    this.playbackWanted = true
    this.clock.play()
    this.sampleAndRender(this.clock.time)
  }

  jumpToNade(id) {
    let traj = this.data.grenades.trajectories[id]
    if (!traj) return
    let target = (traj.startTick - this.data.meta.startTick) / this.data.meta.tickRate
    this.selectedGrenade = id
    this.seekPlayback(Math.max(0, target - this.settings.viewerSettings.utilityLeadIn))
    if (traj.throwerSlot >= 0) this.followPlayer(traj.throwerSlot)
    this.playbackWanted = true
    this.clock.play()
    this.sampleAndRender(this.clock.time)
  }

  jumpToNadeLanding(id) {
    let traj = this.data.grenades.trajectories[id]
    if (!traj) { console.warn(`[csplayer] Cannot view landing: grenade trajectory is unavailable.`, id); return `This grenade trajectory is no longer available.` }
    let landing = Uh(traj, this.data.grenades.effects)
    let path = landing.ok ? Kh(this.data, traj, landing.landing.tick, landing.landing.target) : []
    let view = lg(traj, this.data.grenades.effects, this.mapLoader.object, path)
    if (!view.ok) { console.warn(`[csplayer] Cannot view grenade landing:`, view.reason); return view.reason }
    let { startTick, tickRate } = this.data.meta
    let target = Math.max(this.roundStartTick(traj.startTick), view.tick - this.settings.viewerSettings.utilityLeadIn * tickRate)
    this.selectedGrenade = id
    this.seekPlayback((target - startTick) / tickRate)
    this.cameras.setFlyView(view.position, view.target)
    this.playbackWanted = true
    this.clock.play()
    this.sampleAndRender(this.clock.time)
    return null
  }

  // 平滑回填：边播放边把后续回合数据替换进来
  replaceRoundData(newData, loadedRounds) {
    if (!this.running || newData.meta.mapName !== this.data.meta.mapName || newData.players.length !== this.data.players.length || newData.players.some((p, i) => p.steamId !== this.data.players[i].steamId)) return false
    let n = Math.min(loadedRounds, this.manifest.rounds.length)
    this.parsedRounds = Math.max(this.parsedRounds, n)
    this.data.timeouts = newData.timeouts
    this.controls.setTimelineMarkers(this.roundFractions(), this.timeoutMarkers(), this.majorTimelineEvents())
    if (this.smoothRoundBackfill && this.clock.playing && this.clock.time < this.loadedDurationSeconds() - ROUND_BACKFILL_MARGIN) {
      if (!this.pendingRoundData || n >= this.pendingRoundData.loadedRounds) this.pendingRoundData = { data: newData, loadedRounds: n }
      this.updateRoundLoadState()
      return true
    }
    this.pendingRoundData = null
    this.applyRoundData(newData, n, true)
    return true
  }

  maybeApplyPendingRoundData() {
    if (this.pendingRoundData && !(this.smoothRoundBackfill && this.clock.playing && this.clock.time < this.loadedDurationSeconds() - ROUND_BACKFILL_MARGIN)) this.flushPendingRoundData(false)
  }
  flushPendingRoundData(render) {
    let pending = this.pendingRoundData
    if (pending) { this.pendingRoundData = null; this.applyRoundData(pending.data, pending.loadedRounds, render) }
  }

  applyRoundData(newData, loadedRounds, render) {
    let prevDuration = this.clock.duration
    for (let i = 0; i < this.data.players.length; i++) Object.assign(this.data.players[i], newData.players[i])
    this.data.meta = newData.meta
    this.data.frames = newData.frames
    this.data.events = newData.events
    this.data.rounds = newData.rounds
    this.data.grenades = newData.grenades
    this.data.tracers = newData.tracers
    this.data.smokeVoxels = newData.smokeVoxels
    this.data.panelFrames = newData.panelFrames
    this.data.weaponNames = newData.weaponNames
    this.data.deathMarkers = newData.deathMarkers
    this.data.deathRagdolls = newData.deathRagdolls
    this.data.droppedWeapons = newData.droppedWeapons
    this.data.mapEntities = newData.mapEntities
    this.data.weaponFires = newData.weaponFires
    this.data.damage = newData.damage
    this.data.bomb = newData.bomb
    this.data.timeouts = newData.timeouts
    this.loadedRounds = Math.min(loadedRounds, this.manifest.rounds.length)
    this.parsedRounds = Math.max(this.parsedRounds, this.loadedRounds)
    this.model = new bg(this.data)
    this.rebuildResetKillRespawns()
    this.clock.setDuration(this.loadedDurationSeconds())
    if (this.playbackWanted && !this.clock.playing && this.clock.duration > prevDuration && this.clock.time >= prevDuration - 1 / this.data.meta.tickRate) this.clock.play()
    this.grenades.setData(this.data.grenades)
    this.smoke.setData(this.data.grenades.effects, this.data.smokeVoxels)
    this.smoke.setTracers(this.data.tracers)
    this.tracers.setData(this.data.tracers)
    this.deathMarkers.setData(this.data.deathMarkers)
    this.droppedWeapons.setData(this.data.droppedWeapons ?? [])
    this.mapBreaks.setCauses(this.breakCauses())
    this.demoSounds.setData(this.data)
    this.controls.setTimelineMarkers(this.roundFractions(), this.timeoutMarkers(), this.majorTimelineEvents())
    this.updateRoundLoadState()
    this.crosshairBySlot.clear()
    this.lastRoundForFeed = -2
    if (render) this.sampleAndRender(this.clock.time)
  }

  getPlaybackState() { return { time: this.clock.time, speed: this.clock.speed, playing: this.clock.playing } }
  restorePlaybackState(state) {
    this.clock.setSpeed(state.speed)
    this.seekPlayback(state.time)
    this.playbackWanted = state.playing
    if (state.playing) this.clock.play(); else this.clock.pause()
    this.sampleAndRender(this.clock.time)
  }

  dispose() {
    this.running = false
    this.container.removeAttribute(`data-mobile-feed`)
    for (let key of Object.keys(this.settings.viewerSettings.hud)) this.container.removeAttribute(`data-hud-${key.toLowerCase()}`)
    this.pendingRoundData = null
    window.removeEventListener(`keydown`, this.onKeyDown)
    window.removeEventListener(`keyup`, this.onKeyUp)
    window.removeEventListener(`resize`, this.onResize)
    this.controlsAutoHide.dispose()
    this.povPicker.element.remove()
    this.controls.dispose()
    this.hud.dispose()
    this.nametags.dispose()
    this.cameras.dispose()
    this.crosshair.dispose()
    this.scope.dispose()
    this.blind.dispose()
    this.flashbang.dispose()
    this.damage.dispose()
    this.deathFade.dispose()
    this.killReplay.dispose()
    this.radar?.dispose()
    this.leaveFab?.remove()
    this.settingsFab?.remove()
    this.performanceFab?.remove()
    this.scoreboard.dispose()
    this.feed.dispose()
    this.grenades.dispose()
    this.smoke.dispose()
    this.tracers.dispose()
    this.deathMarkers.dispose()
    this.droppedWeapons.dispose()
    this.mapBreaks.dispose()
    this.audio.dispose()
    this.characters.dispose()
    this.viewModel.dispose()
    this.bomb.dispose()
    this.panels.dispose()
    this.settings.dispose()
    this.statsOverlay.dispose()
    this.mapLoader.dispose()
    this.cs2Map.dispose()
    this.players.dispose()
    this.scene.dispose()
  }

  // 调试辅助（控制台调用）
  debugGrenadeCountsAtTime(time) { this.seekPlayback(time); this.sampleAndRender(time); return { ...this.grenades.debugCounts(), smokes: this.smoke.debugActiveCount() } }
  debugTracerCountAtTime(time) { this.seekPlayback(time); this.sampleAndRender(time); return this.tracers.debugCount() }
  debugDeathCountAtTime(time) { this.seekPlayback(time); this.sampleAndRender(time); return this.deathMarkers.debugCount() }
  debugDroppedWeaponCountAtTime(time) { this.seekPlayback(time); this.sampleAndRender(time); return this.droppedWeapons.debugCount() }
  debugBombAtTime(time) {
    this.seekPlayback(time); this.sampleAndRender(time)
    let tick = this.data.meta.startTick + time * this.data.meta.tickRate
    return { ...this.computeBombSnapshot(tick), modelVisible: this.bomb.debugVisible() }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 九、通用辅助函数
// ────────────────────────────────────────────────────────────────────────────
// 二分查找：返回最后一个 tick <= target 的帧索引
function findFrameIndex(frameTicks, target) {
  let n = frameTicks.length
  if (n === 0 || target <= frameTicks[0]) return 0
  if (target >= frameTicks[n - 1]) return n - 1
  let lo = 0, hi = n - 1
  while (lo < hi) { let mid = (lo + hi + 1) >> 1; frameTicks[mid] <= target ? (lo = mid) : (hi = mid - 1) }
  return lo
}

// 构建击杀行数据（供 RoundFeed 显示）
function buildKillRow(event, id, timeLabel) {
  let isWorld = event.weapon === `world` || (event.victimSlot !== undefined && event.attackerSlot === event.victimSlot)
  return {
    id, tick: event.tick, timeLabel: formatClock(timeLabel),
    attacker: event.attackerName || `—`, victim: event.victimName || `—`,
    attackerColor: teamColor(event.attackerTeam), victimColor: teamColor(event.victimTeam),
    weapon: event.weapon || ``, headshot: !!event.headshot, noscope: !!event.noscope,
    thrusmoke: !!event.thrusmoke, attackerblind: !!event.attackerblind, wallbang: !!event.wallbang, world: isWorld,
  }
}

// 秒 → "m:ss" 格式
function formatClock(seconds) {
  let t = Math.floor(seconds)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, `0`)}`
}

// 队伍 → 颜色变量名
function teamColor(team) {
  return team === 2 ? `var(--pc-t)` : team === 3 ? `var(--pc-ct)` : `var(--pc-secondary)`
}
