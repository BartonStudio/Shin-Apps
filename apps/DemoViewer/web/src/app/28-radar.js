// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 45564–48976 行（切片 29/34）
// 角色：2D 雷达 fN：radar-canvas/radar-resize/radar-ctrls
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var fN = class {
  ready
  root
  canvas
  ctx
  mapping
  onSelect
  images
  visible = !0
  portraitLayout = window.matchMedia(WA)
  size = QM
  lastSample = null
  lastFollowed = -1
  lastBomb = null
  dotPos = []
  constructor(e, t, n, r, i, a, o) {
    ;((this.mapping = t), (this.onSelect = r))
    let s = []
    ;((this.images = t.sections.map((e) => {
      let t = new Image(),
        n = { section: e, image: t, ready: !1 }
      return (
        s.push(
          new Promise((r, i) => {
            ;((t.onload = () => {
              ;((n.ready = !0),
                this.lastSample && this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? void 0),
                r())
            }),
              (t.onerror = () => i(Error(`radar image load failed (${e.file})`))))
          }),
        ),
        (t.src = e.file),
        n
      )
    })),
      (this.root = document.createElement(`div`)),
      (this.root.className = `radar`))
    let c = document.createElement(`div`)
    ;((c.className = `radar-map`),
      (this.canvas = document.createElement(`canvas`)),
      (this.canvas.className = `radar-canvas`),
      c.appendChild(this.canvas))
    let l = document.createElement(`div`)
    ;((l.className = `radar-resize`),
      l.setAttribute(`role`, `separator`),
      l.setAttribute(`aria-label`, `Resize radar`),
      (l.title = `Drag to resize radar`),
      c.appendChild(l),
      this.root.appendChild(c),
      l.addEventListener(`pointerdown`, (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        let t = e.clientX,
          n = e.clientY,
          r = window.innerWidth > 700 ? this.canvas.getBoundingClientRect().width : this.size
        l.classList.add(`active`)
        let i = (e) => {
            let i = e.clientX - t,
              a = e.clientY - n,
              o = Math.abs(i) >= Math.abs(a) ? i : a
            this.setSize(r + o)
          },
          a = () => {
            ;(l.classList.remove(`active`),
              window.removeEventListener(`pointermove`, i),
              window.removeEventListener(`pointerup`, a),
              window.removeEventListener(`pointercancel`, a))
          }
        ;(window.addEventListener(`pointermove`, i),
          window.addEventListener(`pointerup`, a),
          window.addEventListener(`pointercancel`, a))
      }))
    let u = document.createElement(`div`)
    if (((u.className = `radar-ctrls`), i)) {
      let e = document.createElement(`button`)
      ;((e.className = `radar-btn radar-leave`),
        (e.type = `button`),
        (e.title = `Leave demo`),
        e.setAttribute(`aria-label`, `Leave demo`),
        (e.innerHTML = pN()),
        e.addEventListener(`click`, () => i()),
        u.append(e))
    }
    if (a) {
      let e = document.createElement(`button`)
      ;((e.className = `radar-btn radar-gear`),
        (e.type = `button`),
        (e.title = `Settings`),
        e.setAttribute(`aria-label`, `Settings`),
        (e.textContent = `⚙`),
        e.addEventListener(`click`, () => a()),
        u.append(e))
    }
    if (o) {
      let e = document.createElement(`button`)
      ;((e.className = `radar-btn radar-performance`),
        (e.type = `button`),
        (e.title = `Performance`),
        e.setAttribute(`aria-label`, `Performance`))
      let t = document.createElement(`span`)
      ;((t.className = `performance-icon`),
        t.setAttribute(`aria-hidden`, `true`),
        t.append(document.createElement(`i`), document.createElement(`i`), document.createElement(`i`)),
        e.appendChild(t),
        e.addEventListener(`click`, () => o()),
        u.append(e))
    }
    ;(this.root.appendChild(u), e.appendChild(this.root))
    let d = this.canvas.getContext(`2d`)
    if (!d) throw Error(`Radar: 2D canvas context unavailable`)
    if (((this.ctx = d), this.applySize(), this.images.length === 0)) {
      let e = new Image(),
        t = { section: { name: `default`, file: n, altitudeMin: -1 / 0, altitudeMax: 1 / 0 }, image: e, ready: !1 }
      ;(this.images.push(t),
        s.push(
          new Promise((r, i) => {
            ;((e.onload = () => {
              ;((t.ready = !0),
                this.lastSample && this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? void 0),
                r())
            }),
              (e.onerror = () => i(Error(`radar image load failed (${n})`))))
          }),
        ),
        (e.src = n))
    }
    ;((this.ready = Promise.all(s).then(() => void 0)),
      this.canvas.addEventListener(`click`, (e) => this.onClick(e)),
      this.portraitLayout.addEventListener(`change`, this.redraw))
  }
  redraw = () => {
    this.lastSample && this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? void 0)
  }
  isVisible() {
    return this.visible
  }
  toggle() {
    this.setVisible(!this.visible)
  }
  setVisible(e) {
    ;((this.visible = e),
      this.root.classList.toggle(`radar-collapsed`, !e),
      e && this.lastSample && this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? void 0))
  }
  applySize() {
    let e = Math.min(window.devicePixelRatio || 1, 2)
    ;((this.canvas.width = this.size * e),
      (this.canvas.height = this.size * e),
      (this.canvas.style.width = `${this.size}px`),
      (this.canvas.style.height = `${this.size}px`),
      this.ctx.setTransform(e, 0, 0, e, 0, 0))
  }
  setSize(e) {
    let t = Math.round(Math.max($M, Math.min(eN, e)))
    t !== this.size &&
      ((this.size = t),
      this.applySize(),
      this.lastSample && this.update(this.lastSample, this.lastFollowed, this.lastBomb ?? void 0))
  }
  update(e, t, n) {
    if (
      ((this.lastSample = e),
      (this.lastFollowed = t),
      (this.lastBomb = n ?? null),
      !this.visible || this.portraitLayout.matches)
    )
      return
    let r = this.size,
      i = this.ctx
    i.clearRect(0, 0, r, r)
    let a = t >= 0 ? e.z[t] : 1 / 0,
      o =
        this.images.find(({ section: e }) => a >= e.altitudeMin && a < e.altitudeMax) ??
        this.images.find(({ section: e }) => e.name === "default") ??
        this.images[0],
      s = (o.ready && o.image.width) || 1024,
      c = this.getViewport(s)
    o.ready && i.drawImage(o.image, c.x, c.y, c.width, c.height, tN, tN, r - tN * 2, r - tN * 2)
    let l = e.x.length
    this.dotPos.length = l
    for (let n = 0; n < l; n++) {
      let r = (e.x[n] - this.mapping.posX) / this.mapping.scale,
        i = (this.mapping.posY - e.y[n]) / this.mapping.scale,
        a = tN + (r - c.x) * c.scaleX,
        o = tN + (i - c.y) * c.scaleY,
        s = e.alive[n] === 1
      ;((this.dotPos[n] = { x: a, y: o, alive: s }), s && this.drawPlayer(a, o, e.yaw[n], e.team[n], n === t))
    }
    this.lastBomb && this.lastBomb.kind !== `none` && this.drawBomb(this.lastBomb, c)
  }
  getViewport(e) {
    let t = e * this.mapping.insetLeft,
      n = e * this.mapping.insetTop,
      r = e * (1 - this.mapping.insetLeft - this.mapping.insetRight),
      i = e * (1 - this.mapping.insetTop - this.mapping.insetBottom),
      a = r / this.mapping.zoom,
      o = i / this.mapping.zoom,
      s = t + (r - a) / 2,
      c = n + (i - o) / 2,
      l = this.size - tN * 2
    return { x: s, y: c, width: a, height: o, scaleX: l / a, scaleY: l / o }
  }
  dispose() {
    ;(this.portraitLayout.removeEventListener(`change`, this.redraw), this.root.remove())
  }
  drawPlayer(e, t, n, r, i) {
    let a = this.ctx,
      o = r === 2 ? oN : r === 3 ? sN : cN,
      s = -n * aN,
      c = (rN / 2) * aN,
      l = this.size * iN,
      u = a.createRadialGradient(e, t, nN, e, t, l)
    ;(u.addColorStop(0, `rgba(255,255,255,0.15)`),
      u.addColorStop(1, `rgba(255,255,255,0)`),
      a.beginPath(),
      a.moveTo(e, t),
      a.arc(e, t, l, s - c, s + c),
      a.closePath(),
      (a.fillStyle = u),
      a.fill(),
      a.beginPath(),
      a.arc(e, t, nN, 0, Math.PI * 2),
      (a.fillStyle = o),
      a.fill(),
      (a.lineWidth = 1.5),
      (a.strokeStyle = `rgba(0,0,0,0.6)`),
      a.stroke(),
      i &&
        (a.beginPath(),
        a.arc(e, t, 8, 0, Math.PI * 2),
        (a.strokeStyle = `rgba(0, 0, 0, 0.55)`),
        (a.lineWidth = 3.5),
        a.stroke(),
        a.beginPath(),
        a.arc(e, t, 8, 0, Math.PI * 2),
        (a.strokeStyle = `#ffffff`),
        (a.lineWidth = 2),
        a.stroke()))
  }
  drawBomb(e, t) {
    if (e.kind === `carried`) {
      let t = e.carrierSlot >= 0 ? this.dotPos[e.carrierSlot] : null
      if (!t || !t.alive) return
      this.drawC4(t.x + nN + 3, t.y - nN - 3, `#d24b3a`, !1)
      return
    }
    let n = (e.x - this.mapping.posX) / this.mapping.scale,
      r = (this.mapping.posY - e.y) / this.mapping.scale,
      i = tN + (n - t.x) * t.scaleX,
      a = tN + (r - t.y) * t.scaleY
    e.kind === `planted`
      ? this.drawC4(i, a, e.blink ? `#ff3b30` : `#8a1f18`, e.blink)
      : this.drawC4(i, a, `#c25a2a`, !1)
  }
  drawC4(e, t, n, r) {
    let i = this.ctx
    ;(i.save(),
      i.translate(e, t),
      i.rotate(Math.PI / 4),
      (i.fillStyle = n),
      (i.strokeStyle = `rgba(0,0,0,0.7)`),
      (i.lineWidth = 1.5),
      i.beginPath(),
      i.rect(-5, -5, 10, 10),
      i.fill(),
      i.stroke(),
      i.restore(),
      r && (i.beginPath(), i.arc(e, t, 9, 0, Math.PI * 2), (i.strokeStyle = `#ff5b50`), (i.lineWidth = 2), i.stroke()))
  }
  onClick(e) {
    let t = this.canvas.getBoundingClientRect(),
      n = this.size / Math.max(1, t.width),
      r = this.size / Math.max(1, t.height),
      i = (e.clientX - t.left) * n,
      a = (e.clientY - t.top) * r,
      o = -1,
      s = (11 * Math.max(n, r)) ** 2
    for (let e = 0; e < this.dotPos.length; e++) {
      let t = this.dotPos[e]
      if (!t || !t.alive) continue
      let n = (t.x - i) ** 2 + (t.y - a) ** 2
      n < s && ((s = n), (o = e))
    }
    o >= 0 && this.onSelect(o)
  }
}
function pN() {
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M14 4h4.25A1.75 1.75 0 0 1 20 5.75v12.5A1.75 1.75 0 0 1 18.25 20H14M10 8l-4 4 4 4m-4-4h9"/></svg>`
}
var mN = 256,
  hN = {
    smoke: `var(--pc-util-smoke)`,
    he: `var(--pc-util-he)`,
    flash: `var(--pc-util-flash)`,
    molotov: `var(--pc-util-molotov)`,
    decoy: `var(--pc-util-decoy)`,
  },
  gN = { smoke: `Smoke`, he: `HE`, flash: `Flash`, molotov: `Molotov`, decoy: `Decoy` },
  _N = `csplayer:feed`,
  vN = class {
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
    currentTick = -1 / 0
    lastTick = -1 / 0
    constructor(e, t) {
      this.callbacks = t
      let n = xN()
      ;((this.tab = n.tab === `utility` ? `utility` : `kills`),
        (this.root = document.createElement(`div`)),
        (this.root.className = `feed`),
        (this.root.id = `round-feed`),
        this.root.setAttribute(`role`, `region`),
        this.root.setAttribute(`aria-label`, `Round events`),
        (this.root.innerHTML = `
      <div class="feed-tabs"></div>
      <div class="feed-body"></div>
    `),
        e.appendChild(this.root),
        (this.tabsEl = this.root.querySelector(`.feed-tabs`)),
        (this.bodyEl = this.root.querySelector(`.feed-body`)))
      for (let e of [
        { key: `kills`, label: `Kills` },
        { key: `utility`, label: `Utility` },
      ]) {
        let t = document.createElement(`button`)
        ;((t.type = `button`),
          (t.className = `feed-tab`),
          (t.innerHTML = `<span class="feed-tab-label">${e.label}</span><span class="feed-tab-n"></span>`),
          t.addEventListener(`click`, () => this.setTab(e.key)),
          this.tabsEl.appendChild(t),
          this.tabButtons.set(e.key, t),
          this.tabCounts.set(e.key, t.querySelector(`.feed-tab-n`)))
      }
      ;(this.bodyEl.addEventListener(`scroll`, this.recomputeFades, { passive: !0 }),
        window.addEventListener(`resize`, this.recomputeFades),
        (this.resizeObserver = new ResizeObserver(this.recomputeFades)),
        this.resizeObserver.observe(this.bodyEl),
        this.renderTabs(),
        this.renderCounts(),
        this.renderBody())
    }
    setRound(e, t, n) {
      e !== this.roundIndex &&
        ((this.roundIndex = e), (this.kills = t), (this.nades = n), this.renderCounts(), this.renderBody())
    }
    update(e, t) {
      this.currentTick = e
      let n = e - this.lastTick,
        r = t && n > 0 && n < mN
      for (let t of this.rows) {
        let n = e >= t.tick
        n !== t.passed &&
          ((t.passed = n),
          t.el.classList.toggle(`feed-passed`, n),
          n &&
            r &&
            (t.el.classList.remove(`feed-flash`),
            t.el.offsetWidth,
            t.el.classList.add(`feed-flash`),
            t.el.scrollIntoView({ block: `nearest` })))
      }
      this.lastTick = e
    }
    dispose() {
      ;(this.bodyEl.removeEventListener(`scroll`, this.recomputeFades),
        window.removeEventListener(`resize`, this.recomputeFades),
        this.resizeObserver.disconnect(),
        this.root.remove())
    }
    recomputeFades = () => {
      let e = this.bodyEl,
        t = e.scrollTop > 1,
        n = e.scrollTop + e.clientHeight < e.scrollHeight - 1
      ;(e.classList.toggle(`feed-fade-top`, t), e.classList.toggle(`feed-fade-bottom`, n))
    }
    setTab(e) {
      e !== this.tab && ((this.tab = e), SN({ tab: e }), this.renderTabs(), this.renderBody())
    }
    renderTabs() {
      for (let [e, t] of this.tabButtons)
        (t.classList.toggle(`active`, e === this.tab), t.setAttribute(`aria-pressed`, String(e === this.tab)))
      this.tabsEl.style.setProperty(`--index`, this.tab === `utility` ? `1` : `0`)
    }
    renderCounts() {
      ;((this.tabCounts.get(`kills`).textContent = String(this.kills.length)),
        (this.tabCounts.get(`utility`).textContent = String(this.nades.length)))
    }
    renderBody() {
      ;(this.bodyEl.replaceChildren(),
        (this.rows = []),
        (this.lastTick = this.currentTick),
        this.tab === `utility` ? this.renderUtility() : this.renderKills(),
        this.recomputeFades())
    }
    renderKills() {
      if (this.kills.length === 0) {
        this.bodyEl.appendChild(bN(`No kills this round`))
        return
      }
      for (let e of this.kills) this.bodyEl.appendChild(this.makeKillRow(e))
    }
    renderUtility() {
      if (this.nades.length === 0) {
        this.bodyEl.appendChild(bN(`No grenades this round`))
        return
      }
      for (let e of this.nades) this.bodyEl.appendChild(this.makeNadeRow(e))
    }
    makeKillRow(e) {
      let t = document.createElement(`div`)
      return (
        (t.className = `kl-row`),
        (t.innerHTML = `<span class="kl-time">${e.timeLabel}</span><span class="kl-kill">${nj(e)}</span>`),
        t.addEventListener(`click`, () => this.callbacks.onSelectKill(e.id)),
        this.trackRow(t, e.tick),
        t
      )
    }
    makeNadeRow(e) {
      let t = document.createElement(`div`)
      ;((t.className = `nl-row`),
        (t.innerHTML = `<span class="kl-time">${aj(e.timeLabel)}</span><span class="nl-badge" style="--kc:${hN[e.kind]}">${yN(qb[e.kind], `nl-ic`)}</span><span class="nl-thrower" style="color:${e.color}">${aj(e.thrower)}</span><div class="nl-actions">
        <button class="nl-action nl-pov" type="button">
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path fill-rule="evenodd" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Zm15 0a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z"/>
          </svg>
        </button>
        <button class="nl-action nl-landing" type="button">
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path fill-rule="evenodd" d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 0 1 16 0Zm-5.5 0a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/>
          </svg>
        </button>
      </div><span class="nl-landing-error" role="status" hidden></span>`))
      let n = t.querySelector(`.nl-pov`)
      ;((n.title = `Watch ${e.thrower}'s ${gN[e.kind]} throw from player POV`),
        n.setAttribute(`aria-label`, n.title),
        n.addEventListener(`click`, (t) => {
          ;(t.stopPropagation(), this.callbacks.onSelectNade(e.id))
        }))
      let r = t.querySelector(`.nl-landing`)
      ;((r.title = `Watch ${gN[e.kind]} landing from 3 seconds before impact`),
        r.setAttribute(`aria-label`, `Watch ${e.thrower}'s ${gN[e.kind]} landing`))
      for (let e of [n, r])
        e.addEventListener(`keydown`, (e) => {
          ;(e.key === ` ` || e.key === `Enter`) && e.stopPropagation()
        })
      return (
        r.addEventListener(`click`, (n) => {
          n.stopPropagation()
          let r = this.callbacks.onViewNadeLanding(e.id),
            i = t.querySelector(`.nl-landing-error`)
          ;((i.textContent = r ?? ``), (i.hidden = r === null))
        }),
        t.addEventListener(`click`, () => this.callbacks.onSelectNade(e.id)),
        this.trackRow(t, e.tick),
        t
      )
    }
    trackRow(e, t) {
      let n = this.currentTick >= t
      ;(e.classList.toggle(`feed-passed`, n), this.rows.push({ el: e, tick: t, passed: n }))
    }
  }
function yN(e, t) {
  let n = Zb(e)
  return `<span class="${t}" style="-webkit-mask-image:url(${n});mask-image:url(${n})"></span>`
}
function bN(e) {
  let t = document.createElement(`div`)
  return ((t.className = `nl-empty`), (t.textContent = e), t)
}
function xN() {
  try {
    return JSON.parse(localStorage.getItem(_N) || `{}`)
  } catch {
    return {}
  }
}
function SN(e) {
  try {
    let t = xN()
    localStorage.setItem(_N, JSON.stringify({ ...t, ...e }))
  } catch {}
}
var CN = { ct: `Counter-Terrorists`, t: `Terrorists` },
  wN = { ct: `CT`, t: `T` },
  TN = [
    { key: `kills`, label: `K`, title: `Kills` },
    { key: `deaths`, label: `D`, title: `Deaths` },
    { key: `assists`, label: `A`, title: `Assists` },
    { key: `hsPct`, label: `HS%`, title: `Headshot percentage` },
    { key: `dmg`, label: `DMG`, title: `Damage to enemies` },
    { key: `money`, label: `Money`, title: `Money` },
  ],
  EN = `<svg class="sbd-sort-icon" viewBox="0 0 10 6" aria-hidden="true"><path d="M1.5 1.25 5 4.75l3.5-3.5"/></svg>`,
  DN = class {
    root
    rowLists
    teamHeads
    sortCells = []
    teams
    onSelect
    visible = !1
    sortKey = `kills`
    sortDesc = !0
    lastRows = []
    lastLabels = ``
    lastRowsKey = ``
    constructor(e, t, n) {
      ;((this.onSelect = t),
        (this.teams = n),
        (this.root = AN(`div`, `scoreboard`)),
        (this.root.id = `scoreboard`),
        this.root.setAttribute(`role`, `region`),
        this.root.setAttribute(`aria-label`, `Scoreboard`),
        (this.root.hidden = !0),
        (this.teamHeads = { ct: AN(`span`, `sbd-head-team`), t: AN(`span`, `sbd-head-team`) }),
        (this.rowLists = { ct: AN(`div`, `sbd-rows`), t: AN(`div`, `sbd-rows`) }))
      for (let e of [`t`, `ct`]) {
        let t = AN(`section`, `sbd-team sbd-${e}`),
          n = AN(`div`, `sbd-head`)
        n.appendChild(this.teamHeads[e])
        for (let e of TN) {
          let t = AN(`span`, `sbd-h`)
          ;((t.dataset.sort = e.key),
            (t.title = `Sort by ${e.title.toLowerCase()}`),
            (t.innerHTML = `${EN}<span>${e.label}</span>`),
            n.appendChild(t),
            this.sortCells.push(t))
        }
        ;(t.append(n, this.rowLists[e]), this.root.appendChild(t))
      }
      ;(this.root.addEventListener(`mousedown`, (e) => e.preventDefault()),
        this.root.addEventListener(`click`, (e) => {
          let t = e.target,
            n = t?.closest(`.sbd-h`)
          if (n?.dataset.sort) {
            this.setSort(n.dataset.sort)
            return
          }
          let r = t?.closest(`.sbd-row`)
          r && !r.classList.contains(`sbd-dead`) && this.onSelect(Number(r.dataset.slot))
        }),
        this.syncSortCells(),
        e.appendChild(this.root))
    }
    isVisible() {
      return this.visible
    }
    show() {
      this.visible || ((this.visible = !0), (this.root.hidden = !1))
    }
    hide() {
      this.visible && ((this.visible = !1), (this.root.hidden = !0))
    }
    update(e, t) {
      if (!this.visible) return
      let n = `${t.tLabel}|${t.ctLabel}`
      n !== this.lastLabels &&
        ((this.lastLabels = n), this.fillTeamHead(`t`, t.tLabel), this.fillTeamHead(`ct`, t.ctLabel))
      let r = kN(e)
      r !== this.lastRowsKey && ((this.lastRowsKey = r), (this.lastRows = e), this.renderRows())
    }
    setSort(e) {
      ;((this.sortDesc = e === this.sortKey ? !this.sortDesc : !0),
        (this.sortKey = e),
        this.syncSortCells(),
        this.renderRows())
    }
    dispose() {
      this.root.remove()
    }
    renderRows() {
      let e = (e, t) =>
        (this.sortDesc ? t[this.sortKey] - e[this.sortKey] : e[this.sortKey] - t[this.sortKey]) || ON(e, t)
      for (let [t, n] of [
        [`t`, 2],
        [`ct`, 3],
      ]) {
        let r = this.lastRows
          .filter((e) => e.team === n)
          .sort(e)
          .map((e) => this.rowHtml(e))
          .join(``)
        this.rowLists[t].innerHTML = r
      }
    }
    rowHtml(e) {
      let t = `${e.followed ? ` sbd-followed` : ``}${e.alive ? `` : ` sbd-dead`}`,
        n = (e, t, n = ``) => `<span class="sbd-col${n}${e === this.sortKey ? ` is-sorted` : ``}">${t}</span>`
      return (
        `<div class="sbd-row${t}" data-slot="${e.slot}"${e.alive ? `` : ` title="Dead"`}><span class="sbd-name">${MN(e.name)}</span>` +
        n(`kills`, String(e.kills)) +
        n(`deaths`, String(e.deaths)) +
        n(`assists`, String(e.assists)) +
        n(`hsPct`, e.hsPct < 0 ? `–` : `${e.hsPct}%`) +
        n(`dmg`, String(e.dmg)) +
        n(`money`, `$${e.money.toLocaleString(`en-US`)}`, ` sbd-col-money`) +
        `</div>`
      )
    }
    syncSortCells() {
      for (let e of this.sortCells) {
        let t = e.dataset.sort === this.sortKey
        ;(e.classList.toggle(`is-sorted`, t),
          e.classList.toggle(`is-asc`, t && !this.sortDesc),
          e.setAttribute(`aria-sort`, t ? (this.sortDesc ? `descending` : `ascending`) : `none`))
      }
    }
    fillTeamHead(e, t) {
      let n = t === wN[e] || t === `` ? CN[e] : t,
        r = this.teams?.get(t)?.logoUrl,
        i = r ? gM(r, t, `sbd-mark`, { fallbackText: EM(t), invertWhite: !0 }) : jN(`sbd-mark sbd-badge`, wN[e])
      ;((this.teamHeads[e].title = n), this.teamHeads[e].replaceChildren(i, jN(`sbd-head-name`, n)))
    }
  }
function ON(e, t) {
  return t.kills - e.kills || e.deaths - t.deaths || t.dmg - e.dmg || e.slot - t.slot
}
function kN(e) {
  let t = ``
  for (let n of e)
    t += `;${n.slot},${n.name},${n.team},${n.money},${n.kills},${n.deaths},${n.assists},${n.dmg},${n.hsPct},${+!!n.alive},${+!!n.followed}`
  return t
}
function AN(e, t) {
  let n = document.createElement(e)
  return ((n.className = t), n)
}
function jN(e, t) {
  let n = AN(`span`, e)
  return ((n.textContent = t), n)
}
function MN(e) {
  return e.replace(/[&<>"']/g, (e) => ({ "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` })[e])
}
function NN(e, t, n, r, i) {
  if (!r && !i) return null
  let a = [
      ...(r ? e.rounds.map((e) => ({ startTick: e.startTick, endTick: Math.min(e.liveStartTick, e.endTick) })) : []),
      ...(i ? e.timeouts.intervals : []),
    ]
      .filter((e) => e.endTick > e.startTick)
      .sort((e, t) => e.startTick - t.startTick),
    o = t
  for (let e of a) {
    if (e.startTick > o) break
    e.endTick > o && (o = e.endTick)
  }
  return o > t && o <= n ? o : null
}
function PN(e, t) {
  if (!e || e.length < 2) return 1
  if (t <= e[0]) return e[1]
  for (let n = 2; n < e.length; n += 2) {
    let r = e[n]
    if (t <= r) {
      let i = e[n - 2],
        a = e[n - 1]
      return r > i ? a + ((e[n + 1] - a) * (t - i)) / (r - i) : e[n + 1]
    }
  }
  return e[e.length - 1]
}
function FN(e, t, n) {
  let r = e ?? 1
  return t ? r + t[0] + (t[1] - t[0]) * n : r
}
function IN(e) {
  let t = new DataView(e.buffer, e.byteOffset, e.byteLength),
    n = String.fromCharCode(e[0], e[1], e[2], e[3])
  if (n !== `SGR1`) throw Error(`surface grid: bad magic ${n}`)
  let r = t.getFloat32(4, !0),
    i = t.getFloat32(8, !0),
    a = t.getFloat32(12, !0),
    o = t.getUint16(20, !0),
    s = t.getUint16(22, !0),
    c = t.getUint32(24, !0),
    l = o * s,
    u = 28,
    d = new Uint32Array(l + 1)
  for (let t = 0; t < l; t++) d[t + 1] = d[t] + e[u + t]
  u += l
  let f = new Int16Array(c)
  for (let e = 0; e < c; e++) f[e] = t.getInt16(u + e * 2, !0)
  return ((u += c * 2), { x0: r, y0: i, cell: a, width: o, height: s, start: d, z: f, surface: e.slice(u, u + c) })
}
function LN(e, t, n, r) {
  let i = Math.floor((t - e.x0) / e.cell),
    a = Math.floor((n - e.y0) / e.cell)
  if (i < 0 || a < 0 || i >= e.width || a >= e.height) return -1
  let o = a * e.width + i,
    s = e.start[o],
    c = e.start[o + 1]
  if (s === c) return -1
  let l = s
  for (let t = s; t < c; t++) e.z[t] <= r + 20 && (l = t)
  return e.surface[l]
}
function RN(e = 40) {
  let t = []
  for (let n = 0; n < e;) {
    t.push(n)
    let r = Math.min(1, Math.max(0, (e - n) / e))
    n += Math.max(0.1 + 0.9 * r, 0.15)
  }
  return t
}
function zN(e, t, n) {
  let r = [],
    i = -1 / 0
  for (let a = 1; a + 1 < t.length; a++) {
    let o = (t[a] - t[a - 1]) / n,
      s = (t[a + 1] - t[a]) / n
    if (o <= 0 || s <= 0) continue
    let c = a * 3,
      l = (e[c] - e[c - 3]) / o,
      u = (e[c + 1] - e[c - 2]) / o,
      d = (e[c + 2] - e[c - 1]) / o,
      f = (e[c + 3] - e[c]) / s,
      p = (e[c + 4] - e[c + 1]) / s,
      m = (e[c + 5] - e[c + 2]) / s
    if (Math.hypot(l, u, d) < 60) continue
    let h = d < -40 && m - d > 120 && m > d * 0.2,
      g = Math.hypot(l, u),
      _ = g > 60 && l * f + u * p < -0.1 * g * Math.hypot(f, p)
    ;(h || _) && t[a] - i > n * 0.1 && (r.push(a), (i = t[a]))
  }
  return r
}
var BN = [[0.1, `bomb.arm`], ...[0.667, 0.967, 1.233, 1.467, 1.667, 1.967, 2.167].map((e) => [e, `bomb.key`])]
function VN(e, t, n) {
  let r = []
  for (let [i, a] of BN) {
    let o = e + i * n
    o < t && r.push([o, a])
  }
  return r
}
var HN = 2
function UN(e, t, n, r) {
  let i = [],
    a = HN * t,
    o = -1 / 0,
    s = e
      .map((e, t) => ({ event: e, index: t }))
      .sort(
        (e, t) =>
          e.event.tick - t.event.tick ||
          Number(e.event.type === `round_end`) - Number(t.event.type === `round_end`) ||
          e.index - t.index,
      )
  for (let { event: e } of s) {
    let t = null
    if (
      (e.type === `bomb_planted`
        ? (t = `announce.planted`)
        : e.type === `bomb_defused`
          ? (t = `announce.defused`)
          : e.type === `round_end` && e.roundWinner === r
            ? (t = `announce.ctwin`)
            : e.type === `round_end` && e.roundWinner === n && (t = `announce.twin`),
      !t)
    )
      continue
    let s = Math.max(e.tick, o)
    ;(i.push([s, t]), (o = s + a))
  }
  return i
}
function WN(e, t, n, r) {
  if (((r.length = 0), !e || !n || t.duration <= 0)) return r
  let i = e.file === t.file && e.role === t.role,
    a = i && t.time >= e.time ? e.time : -1
  for (let [e, i] of n) {
    let n = e * t.duration
    n > a && n <= t.time && r.push(i)
  }
  if (i && t.time < e.time && t.duration - e.time < 0.1) for (let [i, a] of n) i * t.duration > e.time && r.push(a)
  return r
}
var GN = 48,
  KN = 0.15,
  qN = 64 * 1024,
  JN = 48 * 1024 * 1024,
  YN = 0.003,
  XN = 0.04,
  ZN = class {
    voices = []
    stopped = !1
    retriggers = []
  },
  QN = class {
    base = null
    relocating = !1
    mapName = null
    ctx = null
    master = null
    manifestLoad = null
    manifestData = null
    mapData = null
    mapGrid = null
    mapLoad = 0
    banks = new Map()
    rangedSlices = new Map()
    decoded = new Map()
    decodedSizes = new Map()
    decodedBytes = 0
    voices = []
    retriggering = new Set()
    blockedUntil = new Map()
    listener = new B()
    right = new B(1, 0, 0)
    volume = 0.5
    running = !1
    disposed = !1
    get manifest() {
      return this.manifestData
    }
    get map() {
      return this.mapData
    }
    get grid() {
      return this.mapGrid
    }
    get now() {
      return this.ctx?.currentTime ?? 0
    }
    start() {
      if (!this.ctx) {
        let e = new AudioContext({ latencyHint: `interactive` }),
          t = e.createGain()
        t.gain.value = this.volume
        let n = e.createDynamicsCompressor()
        ;((n.threshold.value = -6),
          (n.knee.value = 6),
          (n.ratio.value = 8),
          (n.attack.value = 0.003),
          (n.release.value = 0.15),
          t.connect(n).connect(e.destination),
          (this.ctx = e),
          (this.master = t),
          window.addEventListener(`pointerdown`, this.unlock, !0),
          window.addEventListener(`keydown`, this.unlock, !0))
      }
      return (
        (this.manifestLoad ??= this.fetchJson(`sounds.json`).then(
          (e) => ((this.manifestData = e?.version === 1 ? e : null), this.manifestData),
        )),
        this.manifestLoad
      )
    }
    async loadMap(e) {
      let t = ++this.mapLoad
      this.mapName = e
      let n = await this.fetchJson(`maps/${e}.json`)
      if (t !== this.mapLoad || this.disposed) return null
      for (let e of [...this.decoded.keys()]) e < 0 && this.forget(e)
      if (
        (this.rangedSlices.clear(),
        (this.mapData = n?.version === 1 ? n : null),
        (this.mapGrid = null),
        this.mapData?.grid)
      ) {
        let e = await this.fetchGrid(`maps/${this.mapData.grid}`)
        t === this.mapLoad && (this.mapGrid = e)
      }
      return this.mapData
    }
    setRunning(e) {
      this.running = e
      let t = this.ctx
      !t ||
        t.state === `closed` ||
        (e && t.state === `suspended`
          ? t.resume().catch(() => void 0)
          : !e && t.state === `running` && t.suspend().catch(() => void 0))
    }
    setVolume(e) {
      ;((this.volume = e), this.master && this.ctx && this.master.gain.setTargetAtTime(e, this.ctx.currentTime, 0.02))
    }
    has(e) {
      return e !== void 0 && this.event(e) !== void 0
    }
    reach(e, t = 0) {
      let n = this.event(e)
      if (!n || t > 4) return 0
      let r = 0
      if (n.f?.length) {
        let e = n.d
        r = e && e.length >= 2 && e[e.length - 1] <= YN ? e[e.length - 2] : 1 / 0
      }
      for (let e of n.c ?? []) r = Math.max(r, this.reach(e, t + 1))
      return r
    }
    preload(e, t = 0) {
      let n = this.event(e)
      if (!(!n || !this.ctx || t > 4)) {
        for (let e of n.c ?? []) this.preload(e, t + 1)
        for (let e of n.f ?? []) {
          let t
          if (e >= 0) {
            let n = this.manifestData?.sounds[e]
            t = n && this.manifestData?.banks[n[0]]
          } else {
            let n = this.mapData?.sounds[-1 - e],
              r = n && n[0] === 0 ? this.mapData?.banks[0] : void 0
            t = r && `maps/${r}`
          }
          t && !this.banks.has(t) && this.fetchBank(t)
        }
      }
    }
    play(e, t, n = -1, r = 1) {
      if (!this.ctx || !this.running) return null
      let i = new ZN()
      return (
        this.startEvent(e, t, n, r, i, 0, !0),
        i.retriggers.length && this.retriggering.add(i),
        i.voices.length || i.retriggers.length ? i : null
      )
    }
    stop(e, t = XN) {
      if (!(!e || e.stopped)) {
        ;((e.stopped = !0), this.retriggering.delete(e))
        for (let n of e.voices) this.stopVoice(n, t)
      }
    }
    stopOneShots() {
      for (let e of this.voices) e.loop || this.stopVoice(e, XN)
      this.blockedUntil.clear()
    }
    update(e) {
      let t = this.ctx
      if (!t) return
      ;(e.getWorldPosition(this.listener), this.right.setFromMatrixColumn(e.matrixWorld, 0).normalize())
      let n = t.currentTime
      for (let e of this.retriggering)
        for (let t of e.retriggers) {
          if (n < t.next) continue
          let [r, i] = t.event.rt
          ;((t.next = n + r + Math.random() * Math.max(0, i - r)),
            this.startEvent(t.name, t.emitter, t.entity, t.volume, e, 0, !1))
        }
      let r = 0
      for (let e of this.voices) {
        if (e.ended || ((this.voices[r++] = e), !e.spatial || !e.panner || !e.pos)) continue
        let t = e.spatialGain,
          i = e.pan
        ;(this.spatialize(e),
          Math.abs(e.spatialGain - t) > 0.002
            ? e.spatial.gain.setTargetAtTime(e.volume * e.spatialGain, n, 0.03)
            : (e.spatialGain = t),
          Math.abs(e.pan - i) > 0.01 ? e.panner.pan.setTargetAtTime(e.pan, n, 0.03) : (e.pan = i))
      }
      this.voices.length = r
    }
    dispose() {
      this.disposed = !0
      for (let e of this.voices) this.stopVoice(e, 0)
      ;((this.voices.length = 0),
        this.retriggering.clear(),
        window.removeEventListener(`pointerdown`, this.unlock, !0),
        window.removeEventListener(`keydown`, this.unlock, !0),
        this.ctx?.close().catch(() => void 0),
        (this.ctx = null))
      for (let e of this.decoded.values())
        e.then((e) => {
          e && `url` in e && URL.revokeObjectURL(e.url)
        })
      ;(this.decoded.clear(),
        this.decodedSizes.clear(),
        (this.decodedBytes = 0),
        this.banks.clear(),
        this.rangedSlices.clear())
    }
    unlock = () => {
      this.running && this.ctx?.state === `suspended` && this.ctx.resume().catch(() => void 0)
    }
    event(e) {
      return this.mapData?.events[e] ?? this.manifestData?.events[e]
    }
    startEvent(e, t, n, r, i, a, o) {
      let s = this.event(e),
        c = this.ctx
      if (!s || !c || a > 4 || i.stopped) return
      let l = c.currentTime,
        u = `${e}|${n}`
      if (s.bd && !s.loop) {
        let t = s.be ? u : e
        if (l < (this.blockedUntil.get(t) ?? -1 / 0)) return
        this.blockedUntil.set(t, l + s.bd)
      }
      for (let e of s.c ?? []) this.startEvent(e, t, n, r, i, a + 1, o)
      if (o && s.rt) {
        let [a, o] = s.rt
        if (
          (i.retriggers.push({
            name: e,
            event: s,
            emitter: t,
            entity: n,
            volume: r,
            next: l + a + Math.random() * Math.max(0, o - a),
          }),
          !s.loop)
        )
          return
      }
      let d = s.f
      if (!d?.length) return
      let f = {
        name: e,
        limitKey: u,
        pos: $N(s, t),
        curve: s.d,
        volume: Math.max(0, FN(s.v, s.vr, Math.random())) * r,
        loop: s.loop === 1,
        due: l + (s.dl ?? 0),
        stopped: !1,
        ended: !1,
        spatialGain: 1,
        pan: 0,
      }
      if ((this.spatialize(f), !f.loop && f.volume * f.spatialGain < YN)) return
      ;(s.lim && this.enforceLimit(u, s.lim), this.makeRoom(), this.voices.push(f), i.voices.push(f))
      let p = d[Math.floor(Math.random() * d.length)],
        m = Math.max(0.25, FN(s.p, s.pr, Math.random()))
      this.sound(p).then((e) => {
        if (!e || f.stopped || !this.ctx || this.ctx !== c) {
          f.ended = !0
          return
        }
        if (!f.loop && c.currentTime - f.due > KN) {
          f.ended = !0
          return
        }
        this.connect(f, e, m, s)
      })
    }
    connect(e, t, n, r) {
      let i = this.ctx,
        a = i.createGain(),
        o = i.createGain(),
        s = i.createStereoPanner()
      ;((o.gain.value = e.volume * e.spatialGain),
        (s.pan.value = e.pan),
        a.connect(o).connect(s).connect(this.master),
        (e.level = a),
        (e.spatial = o),
        (e.panner = s))
      let c = Math.max(i.currentTime, e.due)
      if (r.t && r.t.length >= 4) {
        let e = r.t[r.t.length - 2]
        if (e > 0) {
          let t = new Float32Array(16)
          for (let n = 0; n < t.length; n++) t[n] = PN(r.t, (e * n) / (t.length - 1))
          a.gain.setValueCurveAtTime(t, c, e)
        }
      }
      if (`buffer` in t) {
        let o = i.createBufferSource()
        ;((o.buffer = t.buffer),
          (o.playbackRate.value = n),
          (o.loop = e.loop),
          o.connect(a),
          (o.onended = () => this.release(e)))
        let s = e.loop && r.rs ? Math.random() * t.buffer.duration : 0
        ;(o.start(c, s), (e.source = o))
        return
      }
      let l = new Audio(t.url)
      ;((l.loop = e.loop), (l.preservesPitch = !1), (l.playbackRate = n))
      let u = i.createMediaElementSource(l)
      ;(u.connect(a),
        l.addEventListener(`ended`, () => this.release(e)),
        r.rs &&
          l.addEventListener(
            `loadedmetadata`,
            () => {
              Number.isFinite(l.duration) && (l.currentTime = Math.random() * l.duration)
            },
            { once: !0 },
          ),
        l.play().catch(() => this.release(e)),
        (e.media = l),
        (e.mediaNode = u))
    }
    stopVoice(e, t) {
      if (e.stopped) return
      e.stopped = !0
      let n = this.ctx
      if (!n || !e.level) {
        e.ended = !0
        return
      }
      let r = n.currentTime
      if ((e.level.gain.cancelScheduledValues(r), e.level.gain.setTargetAtTime(0, r, Math.max(0.001, t / 3)), e.source))
        try {
          e.source.stop(r + t)
        } catch {
          this.release(e)
        }
      else if (e.media) {
        let n = e.media
        window.setTimeout(() => {
          ;(n.pause(), this.release(e))
        }, t * 1e3)
      }
    }
    release(e) {
      ;((e.ended = !0),
        (e.stopped = !0),
        e.source?.disconnect(),
        e.mediaNode?.disconnect(),
        e.media && (e.media.pause(), e.media.removeAttribute(`src`), e.media.load()),
        e.panner?.disconnect(),
        (e.media = void 0),
        (e.source = void 0))
    }
    enforceLimit(e, t) {
      let n = 0
      for (let r = this.voices.length - 1; r >= 0; r--) {
        let i = this.voices[r]
        i.stopped || i.limitKey !== e || (++n >= t && this.stopVoice(i, 0.02))
      }
    }
    makeRoom() {
      let e = 0
      for (let t of this.voices) t.stopped || e++
      for (let t of this.voices) {
        if (e < GN) return
        t.stopped || t.loop || (this.stopVoice(t, 0.02), e--)
      }
    }
    spatialize(e) {
      if (!e.pos) {
        ;((e.spatialGain = PN(e.curve, 0)), (e.pan = 0))
        return
      }
      let t = e.pos[0] - this.listener.x,
        n = e.pos[1] - this.listener.y,
        r = e.pos[2] - this.listener.z,
        i = Math.hypot(t, n, r)
      ;((e.spatialGain = PN(e.curve, i)),
        (e.pan =
          0.85 * (i > 0.001 ? (t * this.right.x + n * this.right.y + r * this.right.z) / i : 0) * Math.min(1, i / 60)))
    }
    sound(e) {
      let t = this.decoded.get(e)
      if (t) {
        let n = this.decodedSizes.get(e)
        return (n !== void 0 && (this.decodedSizes.delete(e), this.decodedSizes.set(e, n)), t)
      }
      return (
        (t = this.loadSound(e).catch((t) => (console.warn(`[audio] sound failed:`, e, t), null))),
        this.decoded.set(e, t),
        t.then((n) => {
          if (!n || !(`buffer` in n) || this.decoded.get(e) !== t) return
          let r = n.buffer.length * n.buffer.numberOfChannels * 4
          ;(this.decodedSizes.set(e, r), (this.decodedBytes += r))
          for (let [t] of this.decodedSizes) {
            if (this.decodedBytes <= JN) break
            t !== e && this.forget(t)
          }
        }),
        t
      )
    }
    forget(e) {
      let t = this.decoded.get(e)
      ;(this.decoded.delete(e),
        (this.decodedBytes -= this.decodedSizes.get(e) ?? 0),
        this.decodedSizes.delete(e),
        t?.then((e) => {
          e && `url` in e && setTimeout(() => URL.revokeObjectURL(e.url), 6e4)
        }))
    }
    async loadSound(e) {
      let t = this.ctx
      if (!t) return null
      let n,
        r = !1
      if (e >= 0) {
        let t = this.manifestData?.sounds[e],
          r = t && this.manifestData?.banks[t[0]]
        if (!t || !r) return null
        n = await this.slice(r, t[1], t[2], !1)
      } else {
        let t = this.mapData?.sounds[-1 - e],
          i = t && this.mapData?.banks[t[0]]
        if (!t || !i) return null
        let a = t[0] > 0
        ;((r = a && t[2] > qN), (n = await this.slice(`maps/${i}`, t[1], t[2], a)))
      }
      return n
        ? r
          ? { url: URL.createObjectURL(new Blob([n], { type: `audio/ogg` })) }
          : { buffer: await t.decodeAudioData(n) }
        : null
    }
    async slice(e, t, n, r) {
      let i = this.banks.get(e)
      if (i || !r) {
        let r = await (i ?? this.fetchBank(e))
        return r ? r.slice(t, t + n) : null
      }
      let a = `${e}@${t}`,
        o = this.rangedSlices.get(a)
      o ||
        ((o = this.fetchRange(e, t, n)),
        this.rangedSlices.set(a, o),
        o.then((e) => {
          !e && this.rangedSlices.get(a) === o && this.rangedSlices.delete(a)
        }))
      let s = await o
      return s ? s.slice(0) : null
    }
    async fetchRange(e, t, n) {
      let r = await this.get(e, { headers: { Range: `bytes=${t}-${t + n - 1}` } })
      if (!r?.ok) return null
      if (r.status === 206) return r.arrayBuffer()
      let i = r.arrayBuffer()
      return (this.banks.set(e, i), (await i).slice(t, t + n))
    }
    fetchBank(e) {
      let t = this.get(e)
        .then((e) => (e?.ok ? e.arrayBuffer() : null))
        .catch(() => null)
      return (this.banks.set(e, t), t)
    }
    async fetchJson(e) {
      try {
        let t = await this.get(e)
        return t?.ok ? await t.json() : null
      } catch {
        return null
      }
    }
    async fetchGrid(e) {
      try {
        let t = await this.get(e)
        if (!t?.ok || !t.body) return null
        let n = t.body.pipeThrough(new DecompressionStream(`gzip`))
        return IN(new Uint8Array(await new Response(n).arrayBuffer()))
      } catch (e) {
        return (console.warn(`[audio] surface grid failed:`, e), null)
      }
    }
    async get(e, t) {
      this.base ??= fv(`sounds`)
      let n = await this.base
      if (!n) return ((this.base = null), null)
      let r
      try {
        r = await fetch(n + e, t)
      } catch {
        return null
      }
      return (r.status === 404 && this.relocate(n), r)
    }
    async relocate(e) {
      if (this.relocating) return
      this.relocating = !0
      let t
      try {
        t = await pv(`sounds`, e)
      } finally {
        this.relocating = !1
      }
      if (!(!t || this.disposed || (await this.base) !== e)) {
        this.base = Promise.resolve(t)
        for (let e of [...this.decoded.keys()]) this.forget(e)
        ;(this.banks.clear(),
          this.rangedSlices.clear(),
          (this.manifestData = null),
          (this.mapData = null),
          (this.mapGrid = null),
          this.manifestLoad && ((this.manifestLoad = null), this.start()),
          this.mapName && this.loadMap(this.mapName))
      }
    }
  }
function $N(e, t) {
  let n = e.pos
  return n && (n[0] !== 0 || n[1] !== 0 || n[2] !== 0) ? [n[0], n[1], n[2]] : t ? [t.x, t.y, t.z + (e.oz ?? 0)] : null
}
var eP = 0.5,
  tP = 135,
  nP = 80,
  rP = 1800,
  iP = 4,
  aP = 0.25,
  oP = 0.35,
  sP = 1e3,
  cP = 3e3,
  lP = 4e3,
  uP = 5e3,
  dP = class {
    engine
    breaks
    tracers
    data = null
    builtFor = null
    stepsPreloaded = !1
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
    constructor(e, t, n) {
      ;((this.engine = e), (this.breaks = t), (this.tracers = n))
    }
    setData(e) {
      ;((this.data = e),
        (this.builtFor = null),
        this.motion.length !== e.meta.numPlayers && (this.motion = Array.from({ length: e.meta.numPlayers }, fP)))
    }
    resetWindow() {
      ;((this.prevTick = null), (this.prevFoley = null))
      for (let e of this.motion) Object.assign(e, fP())
    }
    stopAll() {
      for (let e of this.fireLoops.values()) this.engine.stop(e, 0.2)
      this.fireLoops.clear()
      for (let e of this.points.values()) this.engine.stop(e, 0.2)
      ;(this.points.clear(),
        this.engine.stop(this.scapeInstance, 0.2),
        (this.scapeInstance = null),
        (this.scapeName = ``),
        (this.nextAmbienceCheck = 0),
        this.resetWindow())
    }
    update(e) {
      let t = this.data,
        n = this.engine.manifest
      if (!t || !n) return
      ;(this.builtFor !== n && this.build(t, n), !this.stepsPreloaded && this.engine.map && this.preloadMap())
      let { tick: r } = e,
        i = t.meta.tickRate,
        a = this.prevTick
      ;((a === null || r < a || r - a > i * eP) && ((a = r), this.resetWindow()),
        (this.prevTick = r),
        r > a &&
          (this.playCues(a, r, e),
          this.playBullets(t, a, r, e),
          this.breaks.breaksBetween(a, r, (e, t, n) => {
            let r = e ? `break.glass` : /vent|metal|grate/i.test(t) ? `break.metal` : `break.wood`
            this.playCore(r, n, lP)
          })),
        this.playMovement(t, (r - a) / i, e),
        this.playFoley(e),
        this.updateFires(r),
        this.updateAmbience(e.listener))
    }
    build(e, t) {
      this.builtFor = t
      let n = [],
        r = e.meta.numPlayers,
        i = e.meta.tickRate,
        { frames: a, panelFrames: o } = e,
        s = t.core,
        c = (e, t, r, i, a, o, s) => {
          t && n.push({ tick: e, name: t, slot: r, x: i, y: a, z: o, entity: s })
        },
        l = (e) => xC(a.frameTick, e),
        u = (e, t) => o.armor[xC(o.frameTick, t) * r + e] > 0
      this.fires = e.grenades.effects.filter((e) => e.kind === `molotov`)
      let d = e.damage,
        f = Array.from({ length: d.count }, (e, t) => t).sort((e, t) => d.tick[e] - d.tick[t]),
        p = Int32Array.from(f, (e) => d.tick[e]),
        m = e.weaponFires
      if (m)
        for (let n = 0; n < m.ticks.length; n++) {
          let i = m.ticks[n],
            u = m.slots[n]
          if (u >= r) continue
          let h = e.weaponNames[o.activeWeapon[xC(o.frameTick, i) * r + u]]
          if (!h) continue
          if (Xy(h)) {
            let e = 0
            for (let t = hP(p, i - 2); t < p.length && p[t] <= i + 8; t++) {
              let n = f[t]
              d.attackerSlot[n] === u && (e = Math.max(e, d.dmg[n]))
            }
            c(i, s[e >= 50 ? `knife.stab` : e > 0 ? `knife.hit` : `knife.swing`], u, 0, 0, 0, u)
            continue
          }
          let g = Qy(h, a.team[l(i) * r + u])
          c(i, g ? t.weapons[g]?.shot : void 0, u, 0, 0, 0, u)
        }
      let h = new Set()
      for (let t of e.events) {
        if (t.type !== `kill` || t.victimSlot === void 0 || t.victimSlot >= r) continue
        let e = t.victimSlot
        for (let n = -1; n <= 1; n++) h.add(`${e}:${t.tick + n}`)
        let n = `death.${t.headshot ? `head` : `body`}${u(e, t.tick) ? `Armor` : ``}`
        c(t.tick, s[n], e, 0, 0, 0, e)
      }
      for (let e = 0; e < d.count; e++) {
        let t = d.tick[e],
          n = d.victimSlot[e]
        if (n >= r || h.has(`${n}:${t}`)) continue
        let i = l(t) * r + n
        c(
          t,
          s[
            this.burning(a.posX[i], a.posY[i], a.posZ[i], t)
              ? `hit.burn`
              : d.attackerSlot[e] >= r
                ? `hit.fall`
                : u(n, t)
                  ? `hit.bodyArmor`
                  : `hit.body`
          ],
          n,
          0,
          0,
          0,
          n,
        )
      }
      let g = e.grenades.trajectories
      g.forEach((e, t) => {
        if (e.ticks.length === 0) return
        let n = pP(e.kind, e.incendiary === !0),
          a = sP + t,
          o = e.posXYZ
        e.throwerSlot >= 0 && e.throwerSlot < r
          ? c(e.startTick, s[`throw.${n}`], e.throwerSlot, 0, 0, 0, e.throwerSlot)
          : c(e.startTick, s[`throw.${n}`], -1, o[0], o[1], o[2], a)
        for (let t of zN(o, e.ticks, i)) c(e.ticks[t], s[`bounce.${n}`], -1, o[t * 3], o[t * 3 + 1], o[t * 3 + 2], a)
      })
      for (let t of e.grenades.effects) {
        if (t.kind === `decoy`) continue
        let e = pP(t.kind, !1)
        ;(t.kind === `molotov` &&
          (e = pP(
            `molotov`,
            g.find((e) => e.kind === `molotov` && Math.abs((e.detonationTick ?? e.endTick) - t.startTick) <= 32)
              ?.incendiary === !0,
          )),
          c(t.startTick, s[`detonate.${e}`], -1, t.x, t.y, t.z, lP))
      }
      for (let t of this.fires) {
        let n = e.grenades.effects.some(
          (e) =>
            e.kind === `smoke` && Math.abs(e.startTick - t.endTick) <= 16 && Math.hypot(e.x - t.x, e.y - t.y) < 300,
        )
        c(t.endTick, s[n ? `fire.extinguish` : `fire.end`], -1, t.x, t.y, t.z, lP)
      }
      ;(this.buildBomb(e, n, s), this.buildDoors(e, n, s), n.sort((e, t) => e.tick - t.tick), (this.cues = n))
      for (let e of new Set(n.map((e) => e.name))) this.engine.preload(e)
      for (let e of [
        `gear.ct`,
        `gear.t`,
        `jump`,
        `bullet.crack`,
        `bullet.impact`,
        `fire.loop`,
        `break.glass`,
        `break.wood`,
        `break.metal`,
      ])
        s[e] && this.engine.preload(s[e])
      let _ = new Set()
      for (let t of e.weaponNames)
        for (let e of [2, 3]) {
          let n = t ? Qy(t, e) : void 0
          n && _.add(n)
        }
      for (let e of _)
        for (let n of Object.values(t.weapons[e]?.foley ?? {})) for (let [, e] of n) this.engine.preload(e)
    }
    buildBomb(e, t, n) {
      let r = e.meta.tickRate,
        i = e.meta.numPlayers,
        a = (e, r, i, a = 0, o = 0, s = 0) => {
          let c = n[r]
          c && t.push({ tick: e, name: c, slot: i, x: a, y: o, z: s, entity: i >= 0 ? i : 4001 })
        },
        o = e.frames.playerFlags,
        s = e.frames.frameTick
      if (o)
        for (let e = 0; e < i; e++) {
          let t = -1
          for (let n = 0; n <= s.length; n++) {
            let c = n < s.length && (o[n * i + e] & 4) != 0
            if ((c && t < 0 && (t = s[n]), c || t < 0)) continue
            let l = n < s.length ? s[n] : 1 / 0
            for (let [n, i] of VN(t, l, r)) a(n, i, e)
            t = -1
          }
        }
      let c = e.bomb.segments.filter((e) => e.kind === `planted`),
        l = (e) => c.find((t) => t.startTick <= e && e <= t.endTick + r) ?? c.at(-1)
      for (let e of c) {
        let { x: t, y: n, z: i } = e
        a(e.startTick, `bomb.planted`, -1, t, n, i)
        for (let o of RN(40)) {
          let s = e.startTick + o * r
          if (s >= e.endTick) break
          o > 0 && a(s, `bomb.beep`, -1, t, n, i)
        }
        let o = e.startTick + 38.5 * r
        o < e.endTick && a(o, `bomb.warning`, -1, t, n, i)
      }
      for (let t of e.bomb.defuses) {
        let e = l(t.startTick)
        e && a(t.startTick, `bomb.defuse`, -1, e.x, e.y, e.z)
      }
      for (let t of e.events) {
        if (t.type !== `bomb_exploded` && t.type !== `bomb_defused`) continue
        let e = l(t.tick)
        e && a(t.tick, t.type === `bomb_exploded` ? `bomb.explode` : `bomb.defused`, -1, e.x, e.y, e.z)
      }
      for (let [i, a] of UN(e.events, r, 2, 3)) {
        let e = n[a]
        e && t.push({ tick: i, name: e, slot: -1, x: 0, y: 0, z: 0, entity: uP, head: !0 })
      }
    }
    buildDoors(e, t, n) {
      let r = e.meta.tickRate * 0.25
      for (let i of e.mapEntities ?? []) {
        if (i.className !== `CPropDoorRotating` || i.ticks.length < 2) continue
        let { ticks: e, angles: a, origin: o } = i,
          s = a[1]
        for (let i = 1; i < e.length;) {
          let c = i
          for (; c + 1 < e.length && e[c + 1] - e[c] <= r;) c++
          let l = Math.abs(mP(a[(i - 1) * 3 + 1], s)),
            u = Math.abs(mP(a[c * 3 + 1], s))
          if (Math.abs(u - l) > 2) {
            let r = u > l,
              [a, s, d] = o,
              f = n[r ? `door.open` : `door.close`],
              p = n[r ? `door.opened` : `door.closed`]
            ;(f && t.push({ tick: e[i], name: f, slot: -1, x: a, y: s, z: d, entity: 4002 }),
              p && t.push({ tick: e[c], name: p, slot: -1, x: a, y: s, z: d, entity: 4002 }))
          }
          i = c + 1
        }
      }
    }
    preloadMap() {
      this.stepsPreloaded = !0
      for (let e of Object.values(this.engine.map.steps))
        for (let t of [e.ct, e.t, e.land, e.impact]) t && this.engine.preload(t)
    }
    playCues(e, t, n) {
      let { cues: r } = this,
        i = 0,
        a = r.length
      for (; i < a;) {
        let t = (i + a) >> 1
        r[t].tick <= e ? (i = t + 1) : (a = t)
      }
      for (let e = i; e < r.length && r[e].tick <= t; e++) {
        let t = r[e]
        t.head
          ? this.engine.play(t.name, null, t.entity)
          : t.slot >= 0
            ? this.engine.play(t.name, this.playerEmitter(t.slot, n), t.entity)
            : this.engine.play(t.name, this.at(t.x, t.y, t.z), t.entity)
      }
    }
    playBullets(e, t, n, r) {
      let i = e.tracers,
        a = this.builtFor.core,
        { listener: o } = r,
        s = 0,
        c = i.count
      for (; s < c;) {
        let e = (s + c) >> 1
        i.tick[e] <= t ? (s = e + 1) : (c = e)
      }
      let l = 0,
        u = -1
      for (let e = s; e < i.count && i.tick[e] <= n; e++) {
        let t = e * 3,
          n = i.origin[t],
          r = i.origin[t + 1],
          s = i.origin[t + 2],
          c = i.end[t] - n,
          d = i.end[t + 1] - r,
          f = i.end[t + 2] - s,
          p = c * c + d * d + f * f
        if (p < 1) continue
        let m = Math.max(0, Math.min(1, ((o.x - n) * c + (o.y - r) * d + (o.z - s) * f) / p)),
          h = n + c * m,
          g = r + d * m,
          _ = s + f * m,
          v = Math.hypot(o.x - h, o.y - g, o.z - _)
        ;(!(Math.hypot(o.x - n, o.y - r, o.z - s) < 120) &&
          m > 0 &&
          m < 1 &&
          v < nP &&
          i.tick[e] !== u &&
          ((u = i.tick[e]), this.engine.play(a[`bullet.crack`], this.at(h, g, _), 4003)),
          !(i.hitKind[e] === 1 || v > rP || l >= iP) &&
            this.tracers.impactAt(e, this.impact) &&
            (l++,
            this.engine.play(
              this.impactSound(this.impact),
              this.at(this.impact.x, this.impact.y, this.impact.z),
              4004,
            )))
      }
    }
    impactSound(e) {
      let t = this.engine.map,
        n = this.engine.grid
      if (t && n) {
        let r = LN(n, e.x, e.y, e.z),
          i = r >= 0 ? t.steps[t.surfaces[r]]?.impact : void 0
        if (i) return i
      }
      return this.builtFor.core[`bullet.impact`]
    }
    playMovement(e, t, n) {
      let { buffers: r } = n,
        i = e.meta.numPlayers,
        a = e.frames.playerFlags,
        o = xC(e.frames.frameTick, n.tick) * i
      for (let e = 0; e < i; e++) {
        let i = this.motion[e]
        if (r.alive[e] !== 1) {
          Object.assign(i, fP())
          continue
        }
        let s = a ? (a[o + e] & 1) != 0 : !0,
          c = r.z[e]
        if (t > 0)
          if (s) {
            ;(!i.ground && i.air > 0.3 && this.playStep(e, `land`, n), (i.air = 0))
            let a = r.speed[e]
            a > tP
              ? ((i.step += t),
                i.step >= Math.min(0.45, Math.max(0.3, (0.35 * 250) / a)) &&
                  ((i.step = 0), this.playStep(e, `step`, n)))
              : (i.step = 0.2)
          } else
            (i.ground && (c - i.z) / t > 100 && this.engine.play(this.builtFor.core.jump, this.playerEmitter(e, n), e),
              (i.air += t))
        ;((i.ground = s), (i.z = c))
      }
    }
    playStep(e, t, n) {
      let r = this.engine.map,
        i = this.builtFor.core,
        { buffers: a } = n,
        o = a.team[e] === 2,
        s = r?.steps.default,
        c = this.engine.grid
      if (r && c) {
        let t = LN(c, a.x[e], a.y[e], a.z[e])
        t >= 0 && (s = r.steps[r.surfaces[t]] ?? s)
      }
      let l = this.playerEmitter(e, n)
      if (t === `land`) {
        this.engine.play(s?.land ?? i[`land.default`], l, e)
        return
      }
      ;(s && this.engine.play(o ? s.t : s.ct, l, e), this.engine.play(i[o ? `gear.t` : `gear.ct`], l, e))
    }
    playFoley(e) {
      let t = e.foley
      if (
        (e.listenerSlot !== this.prevFoleySlot && (this.prevFoley = null), (this.prevFoleySlot = e.listenerSlot), !t)
      ) {
        this.prevFoley = null
        return
      }
      let n = this.builtFor.weapons[t.file]?.foley?.[t.role]
      for (let r of WN(this.prevFoley, t, n, this.foleyOut)) this.engine.play(r, null, e.listenerSlot)
      this.prevFoley = t
    }
    updateFires(e) {
      let t = this.builtFor.core[`fire.loop`]
      this.fires.forEach((n, r) => {
        let i = n.startTick <= e && e < n.endTick,
          a = this.fireLoops.get(r)
        if (i && !a && t) {
          let e = this.engine.play(t, this.at(n.x, n.y, n.z, !0), cP + r)
          e && this.fireLoops.set(r, e)
        } else !i && a && (this.engine.stop(a, 0.3), this.fireLoops.delete(r))
      })
    }
    updateAmbience(e) {
      let t = this.engine.map,
        n = this.engine.now
      if (!t || n < this.nextAmbienceCheck) return
      this.nextAmbienceCheck = n + aP
      let r = ``,
        i = 1 / 0,
        a = ``,
        o = 1 / 0
      for (let n of t.soundscapes) {
        if (n.off) continue
        let t = Math.hypot(e.x - n.o[0], e.y - n.o[1], e.z - n.o[2])
        ;(t < n.r && t < i && ((r = n.e), (i = t)), t < o && ((a = n.e), (o = t)))
      }
      let s = r || this.scapeName || a
      ;(s &&
        (s !== this.scapeName || !this.scapeInstance) &&
        (this.engine.stop(this.scapeInstance, 1.5),
        (this.scapeInstance = this.engine.play(s, null, 4005, oP)),
        (this.scapeName = s)),
        t.points.forEach((t, n) => {
          let r = this.pointReach.get(t.e)
          r === void 0 && ((r = this.engine.reach(t.e)), this.pointReach.set(t.e, r))
          let i = Math.hypot(e.x - t.o[0], e.y - t.o[1], e.z - t.o[2]),
            a = this.points.get(n)
          if (!a && i < r * 1.05) {
            let e = this.engine.play(t.e, { x: t.o[0], y: t.o[1], z: t.o[2] }, 4010 + n, oP)
            e && this.points.set(n, e)
          } else a && i > r * 1.15 && (this.engine.stop(a, 0.5), this.points.delete(n))
        }))
    }
    burning(e, t, n, r) {
      return this.fires.some(
        (i) => i.startTick <= r && r <= i.endTick && Math.hypot(i.x - e, i.y - t) < 200 && Math.abs(i.z - n) < 120,
      )
    }
    playerEmitter(e, t) {
      return e === t.listenerSlot ? null : this.at(t.buffers.x[e], t.buffers.y[e], t.buffers.z[e])
    }
    at(e, t, n, r = !1) {
      let i = r ? { x: 0, y: 0, z: 0 } : this.emitter
      return ((i.x = e), (i.y = t), (i.z = n), i)
    }
    playCore(e, t, n) {
      let r = this.builtFor?.core[e]
      r && this.engine.play(r, this.at(t.x, t.y, t.z), n)
    }
  }
function fP() {
  return { ground: !0, air: 0, step: 0.2, z: 0 }
}
function pP(e, t) {
  switch (e) {
    case `he`:
      return `hegrenade`
    case `flash`:
      return `flashbang`
    case `smoke`:
      return `smokegrenade`
    case `decoy`:
      return `decoy`
    default:
      return t ? `incgrenade` : `molotov`
  }
}
function mP(e, t) {
  return ((((e - t) % 360) + 540) % 360) - 180
}
function hP(e, t) {
  let n = 0,
    r = e.length
  for (; n < r;) {
    let i = (n + r) >> 1
    e[i] < t ? (n = i + 1) : (r = i)
  }
  return n
}
var gP = 256,
  _P = 1e3 / 30,
  vP = 3,
  yP = 2e3,
  bP = 512,
  xP = `classified`,
  SP = RN(),
  CP = 0.12,
  wP = 2,
  TP = class {
    ready
    container
    model
    data
    manifest
    loadedRounds
    parsedRounds
    clock
    scene
    players
    cameras
    nametags
    hud
    feed
    controls
    controlsAutoHide
    povPicker
    panels
    mapLoader
    cs2Map
    grenades
    smoke
    gpuTier = XD()
    tracers
    deathMarkers
    droppedWeapons
    mapBreaks
    characters
    weaponLighting = new Ly()
    viewModel = new UT(this.weaponLighting)
    viewPunch = $k()
    weaponModels = !1
    audio
    demoSounds
    soundOn = !1
    soundRunning = !1
    bombYawCache = { startTick: NaN, yaw: 0 }
    bomb
    crosshair
    scope
    blind
    flashbang = new Ik()
    flashEpisodeKey = null
    flashScreen = { remaining: 0, white: 0, afterimage: 0, exposure: 0 }
    damage
    deathFade
    killReplay
    killReplayTracker = new Dg()
    radar
    leaveFab
    settingsFab
    performanceFab
    scoreboard
    settings
    statsOverlay
    statsConfig
    statsFrames = 0
    statsAccum = 0
    crosshairBySlot = new Map()
    buffers
    smokeOccluded
    smokeView = new B()
    smokeTarget = new B()
    raycaster = new nc()
    lastTimestamp = 0
    lastScrubRenderAt = -1 / 0
    frameDt = 0
    lastRoundForFeed = -2
    nadeWindow = { startTick: 0, endTick: 0 }
    selectedGrenade = -1
    mobileFeedOpen = !1
    scoreboardHeld = !1
    lastHandoffTick = -1 / 0
    deathScenario = null
    checkDeathScenarioAfterSeek = !1
    smoothRoundBackfill = !0
    pendingRoundData = null
    playbackWanted = !0
    mapLoadGeneration = 0
    resetKillRespawns = new Map()
    running = !0
    constructor(e, t, n, r, i = t.rounds.length, a = () => void 0, o, s) {
      ;((this.container = e),
        (this.data = t),
        (this.model = new bg(t)),
        (this.manifest = r ?? {
          mapName: t.meta.mapName,
          tickRate: t.meta.tickRate,
          startTick: t.meta.startTick,
          endTick: t.meta.endTick,
          durationSeconds: t.meta.durationSeconds,
          rounds: t.rounds,
        }),
        (this.loadedRounds = Math.min(i, this.manifest.rounds.length)),
        (this.parsedRounds = this.loadedRounds),
        (this.clock = new Cg(this.loadedDurationSeconds())),
        (this.buffers = yg(t.meta.numPlayers)),
        (this.smokeOccluded = new Uint8Array(t.meta.numPlayers)),
        this.rebuildResetKillRespawns())
      let c = e.clientWidth / Math.max(1, e.clientHeight)
      ;((this.scene = new qD(e, { antialias: this.gpuTier !== `mobile` })),
        (this.players = new ID(this.scene.scene, t.meta.numPlayers)),
        (this.cameras = new zf(this.scene.renderer.domElement, c, t.meta.numPlayers)),
        (this.nametags = new LM(e, this.scene.scene, t.players)),
        (this.hud = new jM(e, s)),
        (this.feed = new vN(e, {
          onSelectKill: (e) => this.jumpToKill(e),
          onSelectNade: (e) => this.jumpToNade(e),
          onViewNadeLanding: (e) => this.jumpToNadeLanding(e),
        })),
        (this.panels = new KM(e, (e) => this.followPlayer(e))),
        (this.controls = new xA(e, this.manifest.durationSeconds || this.model.duration, {
          onPlayPause: () => this.togglePlayback(),
          onSeek: (e) => this.seekPlayback(e),
          onSkip: (e) => this.seekPlayback(this.clock.time + e),
          onSpeed: (e) => {
            ;(this.clock.setSpeed(e), this.controls.setSpeed(e))
          },
          onSelectFree: () => this.selectFreeCamera(),
          onSelectFly: () => this.selectFlyCamera(),
          onSelectNoclip: () => this.selectNoclipCamera(),
          onSelectPlayer: (e) => this.followPlayer(e),
          onToggleEvents: () => this.toggleMobilePanel(`events`),
          onToggleScoreboard: () => this.toggleMobilePanel(`scoreboard`),
        })),
        (this.controlsAutoHide = new LA({
          container: e,
          surface: this.scene.renderer.domElement,
          controls: this.controls.element,
          media: window.matchMedia(WA),
          deferTaps: () => this.cameras.getMode().kind === `free`,
        })),
        (this.povPicker = new HA(e, {
          onSelectFree: () => this.selectFreeCamera(),
          onSelectPlayer: (e) => this.followPlayer(e),
        })),
        this.frameScene(),
        this.controls.setTimelineMarkers(this.roundFractions(), this.timeoutMarkers(), this.majorTimelineEvents()),
        this.updateRoundLoadState(),
        this.hud.setInfo(t.meta.mapName, ``))
      let l = P_(t.meta.mapName)
      ;((this.mapLoader = new R_(this.scene.scene)),
        (this.cs2Map = new vy(this.scene.renderer)),
        this.scene.scene.add(this.cs2Map.group),
        (this.grenades = new CD(
          this.scene.scene,
          t.grenades,
          (e, t) => this.teamAtFrameTick(e, t),
          this.weaponLighting,
          t.meta.tickRate,
        )),
        (this.smoke = new WO(this.scene.scene, t.grenades.effects, t.smokeVoxels)),
        this.applyGpuTier(),
        this.smoke.setTracers(t.tracers),
        (this.tracers = new Ok(this.scene.scene, t.tracers, this.scene.renderer)),
        (this.deathMarkers = new Lb(this.scene.scene, t.deathMarkers)),
        (this.droppedWeapons = new ox(this.scene.scene, t.droppedWeapons ?? [], this.weaponLighting)),
        (this.characters = new zw(this.scene.scene, t.meta.numPlayers, this.weaponLighting)),
        (this.bomb = new wb(this.scene.scene, this.weaponLighting)),
        (this.mapBreaks = new mS(this.scene.scene, this.weaponLighting)),
        this.mapBreaks.setMap(this.cs2Map),
        this.mapBreaks.setCauses(this.breakCauses()),
        (this.audio = new QN()),
        (this.demoSounds = new dP(this.audio, this.mapBreaks, this.tracers)),
        this.demoSounds.setData(this.data),
        (this.crosshair = new XA(e)),
        (this.scope = new oM(e)),
        (this.blind = new GA(e)),
        (this.damage = new QA(e)),
        (this.deathFade = new oj(
          e,
          (e, t) => this.replayDeath(e, t),
          (e, t) => this.teamAtFrameTick(e, t),
        )),
        (this.killReplay = new dj(
          e,
          (e, t) => this.replayDeath(e, t),
          () => this.dismissKillReplay(),
          (e, t) => this.teamAtFrameTick(e, t),
        )))
      let u = document.createElement(`button`)
      ;((u.type = `button`),
        (u.className = `leave-fab`),
        (u.title = `Leave demo`),
        u.setAttribute(`aria-label`, `Leave demo`),
        (u.innerHTML = pN()),
        u.addEventListener(`click`, a),
        e.appendChild(u),
        (this.leaveFab = u))
      let d = document.createElement(`button`)
      ;((d.type = `button`),
        (d.className = `settings-fab`),
        (d.title = `Settings`),
        d.setAttribute(`aria-label`, `Settings`),
        (d.textContent = `⚙`),
        d.addEventListener(`click`, () => this.settings.toggle()),
        e.appendChild(d),
        (this.settingsFab = d))
      let f = document.createElement(`button`)
      ;((f.type = `button`),
        (f.className = `performance-fab`),
        (f.title = `Performance`),
        f.setAttribute(`aria-label`, `Performance`),
        (f.textContent = `▥`),
        f.addEventListener(`click`, () => this.statsOverlay.show()),
        e.appendChild(f),
        (this.performanceFab = f))
      let p = {
        parseMs: n?.parseMs ?? null,
        source: n?.source ?? `local-parse`,
        fileSizeBytes: n?.fileSizeBytes ?? null,
        sampleRate: t.meta.sampleRate,
        tickRate: t.meta.tickRate,
        durationSeconds: t.meta.durationSeconds,
      }
      ;((this.statsConfig = gj()),
        (this.statsOverlay = new vj(e, p, this.statsConfig, () => this.hud.getScorebarBounds())))
      let m = {
        getConfig: () => this.statsConfig,
        setConfig: (e) => {
          ;((this.statsConfig = e), this.statsOverlay.setConfig(e), _j(e))
        },
      }
      ;((this.settings = new Zj(
        e,
        {
          onMapChange: (e) => void this.setMapMode(e),
          onCs2MapOptionsChange: (e) => this.setCs2MapOptions(e),
          onCs2ExposureChange: (e) => this.scene.setCs2Exposure(e),
          onMapClassificationChange: (e) => this.setMapClassification(e),
          onMapEnvironmentChange: (e) => this.applyMapEnvironment(e),
          onShadowQualityChange: (e) => this.scene.setShadowQuality(e),
          onMapAtmosphereChange: (e) => this.scene.setAtmosphereEnabled(e),
          onMapFilmicContrastChange: (e) => this.scene.setFilmicContrastEnabled(e),
          onSmoothRoundBackfillChange: (e) => {
            ;((this.smoothRoundBackfill = e), e || this.flushPendingRoundData(!0))
          },
          onXrayChange: (e) => this.players.setXray(e),
          onEffectGraphicsChange: (e) => {
            ;(this.smoke.setGraphics(e), this.grenades.setMolotovGraphics(e))
          },
          onViewerChange: (e) => this.applyViewerSettings(e),
        },
        { dev: !1, initialMap: { mode: this.gpuTier === `mobile` ? xP : `cs2`, classification: l }, stats: m },
      )),
        this.mapLoader.setClassification(this.settings.currentMapClassification),
        this.applyMapEnvironment(this.settings.currentMapClassification),
        this.players.setXray(this.settings.xrayEnabled),
        this.smoke.setGraphics(this.settings.effectGraphics),
        this.grenades.setMolotovGraphics(this.settings.effectGraphics),
        this.scene.setShadowQuality(this.settings.currentShadowQuality),
        this.scene.setAtmosphereEnabled(this.settings.mapAtmosphereEnabled),
        this.scene.setFilmicContrastEnabled(this.settings.mapFilmicContrastEnabled),
        (this.smoothRoundBackfill = !0),
        (this.scoreboard = new DN(e, (e) => this.followPlayer(e), s)),
        this.applyViewerSettings(this.settings.viewerSettings),
        this.clock.onChange(() => {
          ;(this.controls.setPlaying(this.clock.playing),
            this.controlsAutoHide.setPaused(!this.clock.playing),
            this.controls.setSpeed(this.clock.speed),
            this.clock.playing || this.flushPendingRoundData(!0))
        }),
        this.controlsAutoHide.setPaused(!this.clock.playing),
        this.bindInput(),
        window.addEventListener(`resize`, this.onResize),
        (this.ready = this.prepareMap(t.meta.mapName, a, o)))
      let h = this.initialPlayerSlot()
      ;(h >= 0 && this.cameras.follow(h),
        this.sampleAndRender(0),
        (this.playbackWanted = !0),
        this.clock.play(),
        requestAnimationFrame(this.tick))
    }
    async prepareMap(e, t, n) {
      let r = !1,
        i = this.loadMap(e, n).finally(() => {
          r || n?.(`Loading ${e} radar…`)
        }),
        a = this.loadRadar(e, t).finally(() => {
          r = !0
        })
      ;(await Promise.all([i, a]),
        this.running && (n?.(`Loading renderer…`), await new Promise((e) => window.setTimeout(e, yP))))
    }
    initialPlayerSlot() {
      let { frames: e, meta: t } = this.data
      if (t.numPlayers === 0 || e.frameTick.length === 0) return -1
      for (let n = 0; n < t.numPlayers; n++) if (e.alive[n] === 1) return n
      return 0
    }
    async loadRadar(e, t) {
      let n
      try {
        let r = await S_(e)
        if (!this.running || !r) return
        if (
          ((n = new fN(
            this.container,
            r,
            r.file,
            (e) => this.followPlayer(e),
            t,
            () => this.settings.toggle(),
            () => this.statsOverlay.show(),
          )),
          await n.ready,
          !this.running)
        ) {
          n.dispose()
          return
        }
        ;((this.radar = n),
          this.radar.setVisible(this.settings.viewerSettings.hud.radar),
          this.leaveFab?.remove(),
          this.settingsFab?.remove(),
          this.performanceFab?.remove(),
          (this.leaveFab = void 0),
          (this.settingsFab = void 0),
          (this.performanceFab = void 0))
      } catch (e) {
        ;(n?.dispose(), console.warn(`[csplayer] radar load failed:`, e))
      }
    }
    async loadMap(e, t) {
      let n = ++this.mapLoadGeneration,
        r = this.settings.mapMode
      if (r !== `grid`)
        try {
          await this.showMap(r, e, n, t)
        } catch (e) {
          console.warn(`[csplayer] map load failed, using grid:`, e)
        }
    }
    async showMap(e, t, n, r) {
      let i = this.mapLoader.load(t, e === `cs2` ? void 0 : r, { collisionOnly: e === `cs2` }),
        a = !1
      if (e === `cs2`) {
        this.clearCs2Map()
        try {
          a = await this.cs2Map.load(t, this.settings.cs2MapOptions, r)
        } catch (e) {
          console.warn(`[csplayer] CS2 map load failed, using the default map:`, e)
        }
      } else this.clearCs2Map()
      let o = await i
      !this.running ||
        n !== this.mapLoadGeneration ||
        (e === `cs2` &&
          !a &&
          (this.clearCs2Map(),
          (e = xP),
          this.settings.syncMapMode(e),
          (o = await this.mapLoader.load(t, r)),
          !this.running || n !== this.mapLoadGeneration)) ||
        (this.scene.setGridVisible(!o && !a),
        this.mapLoader.object && (this.mapLoader.object.visible = !a),
        this.scene.setClassifiedMap(o && !a ? this.mapLoader.object : null),
        this.cameras.setCollisionObject(this.mapLoader.object),
        this.characters.setCollisionObject(this.mapLoader.object),
        this.mapBreaks.setCollisionObject(this.mapLoader.object),
        this.tracers.setMapObject(this.mapLoader.object),
        this.grenades.setMapObject(this.mapLoader.object),
        this.applyCs2Environment(a),
        this.precompileEffects())
    }
    clearCs2Map() {
      ;(this.cs2Map.clear(), this.applyCs2Environment(!1))
    }
    applyCs2Environment(e) {
      let t = e ? this.cs2Map.sceneEnvironment() : null
      ;(t && this.cs2Map.installGrading(),
        this.scene.setCs2Environment(t),
        t || this.applyMapEnvironment(this.settings.currentMapClassification),
        this.settings.syncCs2Exposure(t?.exposure ?? null),
        (!t || !this.weaponLighting.setCs2Map(this.cs2Map)) &&
          this.weaponLighting.setClassic(this.scene.classicLighting()),
        this.characters.setEnabled(t !== null),
        this.setWeaponModelsEnabled(t !== null))
    }
    setWeaponModelsEnabled(e) {
      ;((this.weaponModels = e),
        this.droppedWeapons.setModelsEnabled(e),
        this.grenades.setModelsEnabled(e),
        this.bomb.setModelsEnabled(e),
        this.mapBreaks.setEnabled(e))
    }
    breakCauses() {
      return {
        tracers: this.data.tracers,
        effects: this.data.grenades.effects,
        frames: this.data.frames,
        numPlayers: this.data.meta.numPlayers,
        tickRate: this.data.meta.tickRate,
      }
    }
    setCs2MapOptions(e) {
      this.cs2Map.pvsEnabled = e.visibilityCulling
    }
    precompileEffects() {
      Promise.resolve()
        .then(() => {
          this.mapLoader.updateInteriorLights(this.cameras.camera.position)
          let e = this.smoke.shaderScenes
          return this.scene.precompile(this.cameras.camera, {
            sceneObjects: [this.grenades.fireShaderPrototypes, this.mapBreaks.shaderPrototypes],
            screenOverlays: [this.grenades.blastScene, e.screen],
            offscreenOverlays: [e.offscreen],
          })
        })
        .catch((e) => console.warn(`[csplayer] effect shader precompile failed:`, e))
    }
    async setMapMode(e) {
      let t = ++this.mapLoadGeneration
      if (e === `grid`) {
        ;(this.mapLoader.clearMap(),
          this.clearCs2Map(),
          this.scene.setClassifiedMap(null),
          this.cameras.setCollisionObject(null),
          this.characters.setCollisionObject(null),
          this.mapBreaks.setCollisionObject(null),
          this.scene.setGridVisible(!0),
          this.tracers.setMapObject(null),
          this.grenades.setMapObject(null))
        return
      }
      try {
        await this.showMap(e, this.data.meta.mapName, t)
      } catch (e) {
        ;(console.warn(`[csplayer] map switch failed, using grid:`, e), this.running && this.scene.setGridVisible(!0))
      }
    }
    setMapClassification(e) {
      ;(this.mapLoader.setClassification(e),
        this.applyMapEnvironment(e),
        this.settings.mapMode === `classified` && this.setMapMode(`classified`))
    }
    applyMapEnvironment(e) {
      ;(this.scene.setMapEnvironment(e.hazeColor, e.skyHorizonColor, e.skyZenithColor, e.sunAzimuth, e.sunElevation),
        this.weaponLighting.usesCs2Map || this.weaponLighting.setClassic(this.scene.classicLighting()))
    }
    frameScene() {
      let { frames: e, meta: t } = this.data,
        n = 1 / 0,
        r = -1 / 0,
        i = 1 / 0,
        a = -1 / 0,
        o = 1 / 0,
        s = e.posX.length
      for (let t = 0; t < s; t++) {
        if (e.alive[t] !== 1) continue
        let s = e.posX[t],
          c = e.posY[t],
          l = e.posZ[t]
        ;(s < n && (n = s), s > r && (r = s), c < i && (i = c), c > a && (a = c), l < o && (o = l))
      }
      let c = !isFinite(n)
      if (c) {
        let e = this.data.smokeVoxels
        for (let t = 0; t < e.count; t++) {
          let s = e.detonation[t * 3],
            c = e.detonation[t * 3 + 1],
            l = e.detonation[t * 3 + 2]
          ;(s < n && (n = s), s > r && (r = s), c < i && (i = c), c > a && (a = c), l < o && (o = l))
        }
        for (let e of this.data.grenades.infernos ?? [])
          for (let t of e.frames)
            for (let e = 0; e < t.positions.length; e += 3)
              ((n = Math.min(n, t.positions[e])),
                (r = Math.max(r, t.positions[e])),
                (i = Math.min(i, t.positions[e + 1])),
                (a = Math.max(a, t.positions[e + 1])),
                (o = Math.min(o, t.positions[e + 2])))
      }
      isFinite(n) || (n = r = i = a = o = 0)
      let l = new B((n + r) / 2, (i + a) / 2, o),
        u = 0.5 * Math.max(r - n, a - i, c ? 500 : 1e3)
      ;(this.scene.setFloor(o), this.cameras.frameScene(l, u))
    }
    roundFractions() {
      let e = this.manifest.durationSeconds || 1
      return this.data.rounds
        .map((t) => (t.startTick - this.data.meta.startTick) / this.data.meta.tickRate / e)
        .filter((e) => e >= 0 && e <= 1)
    }
    timeoutMarkers() {
      let e = this.manifest.durationSeconds || 1
      return this.data.timeouts.intervals
        .map((t) => ({
          fraction: (t.startTick - this.data.meta.startTick) / this.data.meta.tickRate / e,
          endFraction: (t.endTick - this.data.meta.startTick) / this.data.meta.tickRate / e,
          side: t.side,
          technical: t.technical,
        }))
        .filter((e) => e.fraction >= 0 && e.fraction <= 1)
    }
    majorTimelineEvents() {
      let { events: e, meta: t } = this.data,
        n = []
      for (let r of e) {
        let e = (r.tick - t.startTick) / t.tickRate
        r.type === `kill` && (r.attackerTeam === 2 || r.attackerTeam === 3)
          ? n.push({
              time: e,
              kind: `kill`,
              team: r.attackerTeam === 2 ? `t` : `ct`,
              iconUrl: Zb(`skull`),
              title: `${r.attackerName ?? `Player`} killed ${r.victimName ?? `player`}`,
              actor: r.attackerName ?? `Player`,
              target: r.victimName ?? `player`,
              targetTeam: r.victimTeam === 2 ? `t` : r.victimTeam === 3 ? `ct` : void 0,
            })
          : r.type === `bomb_planted`
            ? n.push({ time: e, kind: `plant`, team: `t`, iconUrl: Zb(`c4`), title: `Bomb planted` })
            : r.type === `bomb_exploded`
              ? n.push({ time: e, kind: `explode`, team: `t`, iconUrl: Zb(`planted_c4`), title: `Bomb exploded` })
              : r.type === `bomb_defused`
                ? n.push({ time: e, kind: `defuse`, team: `ct`, iconUrl: Zb(`defuser`), title: `Bomb defused` })
                : r.type === `round_end` &&
                  r.roundReason === 10 &&
                  n.push({ time: e, kind: `time`, team: `ct`, title: `Time expired` })
      }
      return n
    }
    roundLoadRanges() {
      let e = this.manifest.durationSeconds || 1
      return this.manifest.rounds.map((t) => ({
        startFraction: (t.startTick - this.manifest.startTick) / this.manifest.tickRate / e,
        endFraction: (t.endTick - this.manifest.startTick) / this.manifest.tickRate / e,
      }))
    }
    updateRoundLoadState() {
      this.controls.setRoundLoadState(this.roundLoadRanges(), this.parsedRounds, this.loadedDurationSeconds())
    }
    loadedDurationSeconds() {
      if (this.manifest.rounds.length === 0) return this.model.duration
      let e = this.manifest.rounds[Math.max(0, this.loadedRounds - 1)]
      return Math.max(0, e.endTick - this.manifest.startTick) / this.manifest.tickRate
    }
    applyViewerSettings(e) {
      for (let [t, n] of Object.entries(e.hud)) this.container.setAttribute(`data-hud-${t.toLowerCase()}`, String(n))
      ;(this.radar?.setVisible(e.hud.radar),
        e.hud.scoreboard || this.scoreboard.hide(),
        e.hud.eventFeed || (this.mobileFeedOpen = !1),
        this.container.setAttribute(`data-mobile-feed`, String(this.mobileFeedOpen)),
        this.controls.setHudAvailability(e.hud.eventFeed, e.hud.scoreboard),
        this.controls.setMobilePanels(this.mobileFeedOpen, this.scoreboard.isVisible()),
        this.cameras.setFlyPreferences(e.mouseSensitivity, e.invertLook, e.flySpeed),
        this.scene.setRenderScale(e.renderScale),
        this.tracers.setRenderScale(e.renderScale),
        this.audio.setVolume(e.volume / 100),
        this.updateBlindOverlay())
    }
    setGpuTier(e) {
      ;((this.gpuTier = e), this.applyGpuTier())
    }
    applyGpuTier() {
      this.smoke.setGpuTier(this.gpuTier)
    }
    onKeyDown = (e) => {
      if (!(
        e.target instanceof HTMLElement &&
        (e.target.closest(`input, textarea, select, [contenteditable="true"], .settings-panel`) ||
          (e.target.closest(`button`) && (e.key === ` ` || e.key === `Enter` || e.key === `Tab`)))
      ))
        switch (e.key) {
          case ` `:
            ;(e.preventDefault(), this.togglePlayback())
            break
          case `[`:
            this.cyclePlayer(-1)
            break
          case `]`:
            this.cyclePlayer(1)
            break
          case `f`:
          case `F`:
            this.selectFreeCamera()
            break
          case `Escape`:
            this.cameras.getMode().kind !== `fly` && this.cameras.getMode().kind !== `noclip` && this.selectFreeCamera()
            break
          case `v`:
          case `V`:
            this.cameras.getMode().kind === `fly` ? this.selectFreeCamera() : this.selectFlyCamera()
            break
          case `n`:
          case `N`:
            this.cameras.getMode().kind === `noclip` ? this.selectFreeCamera() : this.selectNoclipCamera()
            break
          case `m`:
          case `M`:
            this.settings.toggleRadar()
            break
          case `x`:
          case `X`:
            this.settings.toggleXray()
            break
          case `Tab`:
            ;(e.preventDefault(),
              this.settings.viewerSettings.hud.scoreboard && ((this.scoreboardHeld = !0), this.scoreboard.show()),
              this.controls.setMobilePanels(this.mobileFeedOpen, this.scoreboard.isVisible()))
            break
        }
    }
    onKeyUp = (e) => {
      e.key === `Tab` &&
        this.scoreboardHeld &&
        (e.preventDefault(),
        (this.scoreboardHeld = !1),
        this.scoreboard.hide(),
        this.controls.setMobilePanels(this.mobileFeedOpen, !1))
    }
    bindInput() {
      ;(window.addEventListener(`keydown`, this.onKeyDown),
        window.addEventListener(`keyup`, this.onKeyUp),
        this.scene.renderer.domElement.addEventListener(`click`, (e) => {
          if (this.cameras.getMode().kind === `fly` || this.cameras.getMode().kind === `noclip`) return
          let t = this.scene.renderer.domElement.getBoundingClientRect(),
            n = new z(((e.clientX - t.left) / t.width) * 2 - 1, -((e.clientY - t.top) / t.height) * 2 + 1)
          this.raycaster.setFromCamera(n, this.cameras.camera)
          let r = this.players.intersect(this.raycaster)
          r >= 0 && this.followPlayer(r)
        }))
    }
    togglePlayback() {
      ;((this.playbackWanted = !this.clock.playing), this.clock.toggle())
    }
    toggleMobilePanel(e) {
      let t = this.settings.viewerSettings.hud
      ;(e === `events` && t.eventFeed
        ? ((this.mobileFeedOpen = !this.mobileFeedOpen), this.scoreboard.hide())
        : e === `scoreboard` &&
          t.scoreboard &&
          ((this.mobileFeedOpen = !1),
          this.scoreboard.isVisible()
            ? this.scoreboard.hide()
            : (this.scoreboard.show(), this.updateScoreboard(this.clock.time))),
        this.container.setAttribute(`data-mobile-feed`, String(this.mobileFeedOpen)),
        this.controls.setMobilePanels(this.mobileFeedOpen, this.scoreboard.isVisible()))
    }
    onResize = () => {
      let e = this.container.clientWidth,
        t = this.container.clientHeight
      ;(this.scene.resize(),
        this.cameras.resize(e / Math.max(1, t)),
        this.nametags.resize(e, t),
        this.tracers.resize(e, t),
        this.settings.reposition(),
        this.statsOverlay.reposition())
    }
    tick = (e) => {
      if (!this.running) return
      this.maybeApplyPendingRoundData()
      let t = this.lastTimestamp ? (e - this.lastTimestamp) / 1e3 : 0
      if (
        ((this.lastTimestamp = e),
        (this.frameDt = Math.min(t, 0.1)),
        this.clock.advance(this.frameDt),
        this.clock.playing && !this.controls.isScrubbing)
      ) {
        let e = this.settings.viewerSettings,
          { startTick: t, tickRate: n } = this.data.meta,
          r = NN(
            this.data,
            t + this.clock.time * n,
            t + this.loadedDurationSeconds() * n,
            e.skipFreezeTime,
            e.skipTimeouts,
          )
        r !== null && this.seekPlayback((r - t) / n)
      }
      ;(this.controls.isScrubbing
        ? e - this.lastScrubRenderAt >= _P &&
          (this.sampleAndRenderScrubPreview(this.clock.time), (this.lastScrubRenderAt = performance.now()))
        : this.sampleAndRender(this.clock.time, !0),
        this.updateStats(t),
        requestAnimationFrame(this.tick))
    }
    updateStats(e) {
      if ((this.statsFrames++, (this.statsAccum += e), this.statsAccum < 0.5)) return
      let t = this.scene.renderer.info.render
      ;(this.statsOverlay.updateLive({
        fps: this.statsFrames / this.statsAccum,
        frameMs: (this.statsAccum * 1e3) / this.statsFrames,
        drawCalls: t.calls,
        triangles: t.triangles,
      }),
        (this.statsFrames = 0),
        (this.statsAccum = 0))
    }
    sampleAndRender(e, t = !1) {
      this.model.sample(e, this.buffers)
      let n = this.data.meta.startTick + e * this.data.meta.tickRate,
        r = this.deathScenario?.pending != null
      ;(this.updateViewPunch(n),
        r || this.cameras.update(this.buffers, this.frameDt),
        this.maybeStartDeathScenarioAfterSeek(n),
        this.updatePlaybackEvents(n),
        r && this.deathScenario?.pending == null && this.cameras.update(this.buffers, this.frameDt),
        this.deathFade.setActive(this.deathScenario?.pending != null),
        this.updateKillReplay(n))
      let i = this.followedSlotForTags()
      ;(this.mapLoader.updateInteriorLights(this.cameras.camera.position),
        this.cs2Map.updateObjects(this.data.mapEntities, n),
        this.mapBreaks.update(n),
        this.cs2Map.update(this.cameras.camera, this.cameras.getMode().kind === `first`),
        this.grenades.setTrajectoryVisibility(
          this.settings.viewerSettings.trajectories,
          this.cameras.getFollowedSlot(),
          this.selectedGrenade,
        ),
        this.grenades.update(n, this.cameras.camera),
        this.smoke.update(n),
        this.updateSmokeOcclusion(),
        this.players.update(this.buffers, this.data.damage, n, this.data.meta.tickRate, i, this.smokeOccluded),
        this.updateCharacters(n, i, this.smokeOccluded),
        this.damage.update(this.data.damage, this.cameras.getFollowedSlot(), n, this.data.meta.tickRate))
      let a = i >= 0 && !this.settings.xrayEnabled,
        o = a ? this.buffers.team[i] : -1,
        s = this.settings.xrayEnabled ? void 0 : this.smokeOccluded,
        c = this.computeBombSnapshot(n)
      ;(this.nametags.update(this.buffers, i, o, s, this.nametagContext(n, c.carrierSlot)),
        this.tracers.update(n),
        this.deathMarkers.update(n, this.buffers.alive, a),
        this.droppedWeapons.update(n),
        this.bomb.update(c, this.bombYaw(n)),
        this.controls.setTime(e),
        this.updateHud(e),
        this.updateCrosshair(e, t),
        this.updateBlindOverlay(e),
        this.updatePanels(e),
        this.radar?.update(this.buffers, this.cameras.getFollowedSlot(), c),
        this.updateScoreboard(e),
        this.scene.beginRenderFrame(),
        this.renderSceneAndPrepareEffects(this.cameras.camera),
        this.grenades.renderBlasts(this.scene.renderer, this.cameras.camera),
        this.smoke.render(this.scene.renderer, this.cameras.camera, this.scene.drawingBufferSize),
        this.players.renderXray(this.scene.renderer, this.cameras.camera, this.xrayCharacters()),
        this.renderViewModel(n),
        this.updateSound(n),
        this.renderFlashbang(),
        this.nametags.render(this.cameras.camera))
    }
    updateSound(e) {
      let t = this.audio,
        n = this.demoSounds,
        r = this.settings.viewerSettings,
        i = this.weaponModels && !r.muted && r.volume > 0 && this.clock.speed <= wP
      i !== this.soundOn &&
        ((this.soundOn = i),
        i ? (t.start(), t.map === null && t.loadMap(this.data.meta.mapName)) : (n.stopAll(), t.stopOneShots()))
      let a = i && this.clock.playing
      if ((a !== this.soundRunning && ((this.soundRunning = a), t.setRunning(a), a || n.resetWindow()), !a)) return
      let o = this.cameras.getMode()
      ;(n.update({
        tick: e,
        buffers: this.buffers,
        listener: this.cameras.camera.position,
        listenerSlot: o.kind === `first` ? o.slot : -1,
        foley: this.viewModel.foleyPose,
      }),
        t.update(this.cameras.camera))
    }
    updateCharacters(e, t, n) {
      ;(this.characters.update(this.data, this.buffers, e, this.cameras.camera, t, n, this.players.xrayEnabled),
        this.players.setBodiesVisible(!this.characters.active))
    }
    xrayCharacters() {
      return this.characters.active ? this.characters : void 0
    }
    updateViewPunch(e) {
      let t = this.cameras.getMode()
      if (!this.weaponModels || t.kind !== `first` || this.buffers.alive[t.slot] !== 1) {
        this.cameras.setViewPunch(0, 0)
        return
      }
      ;(tA(this.data, t.slot, e, this.viewPunch), this.cameras.setViewPunch(this.viewPunch.pitch, this.viewPunch.yaw))
    }
    renderViewModel(e) {
      let t = this.cameras.getMode(),
        n = this.weaponModels && t.kind === `first` ? t.slot : -1
      if (!(
        n >= 0 &&
        this.deathScenario?.pending == null &&
        this.buffers.alive[n] === 1 &&
        this.buffers.zoom[n] === 0 &&
        this.viewModel.update({
          data: this.data,
          slot: n,
          tick: e,
          duck: this.buffers.duck[n],
          aspect: this.cameras.camera.aspect,
          camera: this.cameras.camera,
        })
      )) {
        this.viewModel.hide()
        return
      }
      this.viewModel.render(this.scene.renderer)
    }
    sampleAndRenderScrubPreview(e) {
      ;(this.model.sample(e, this.buffers), this.deathFade.setActive(!1))
      let t = this.followedSlotForTags(),
        n = this.data.meta.startTick + e * this.data.meta.tickRate
      ;(this.updateKillReplay(n),
        this.updateViewPunch(n),
        this.cameras.update(this.buffers, this.frameDt),
        this.players.update(this.buffers, this.data.damage, n, this.data.meta.tickRate, t),
        this.updateCharacters(n, t),
        this.damage.update(this.data.damage, this.cameras.getFollowedSlot(), n, this.data.meta.tickRate),
        this.tracers.update(n),
        this.updateHud(e, !1),
        this.updatePanels(e),
        this.updateCrosshair(e),
        this.updateBlindOverlay(e))
      let r = t >= 0 && !this.settings.xrayEnabled,
        i = r ? this.buffers.team[t] : -1
      if (
        (this.deathMarkers.update(n, this.buffers.alive, r),
        this.droppedWeapons.update(n),
        this.nametags.update(
          this.buffers,
          t,
          i,
          void 0,
          this.nametagContext(n, this.computeBombSnapshot(n).carrierSlot),
        ),
        this.scene.beginRenderFrame(),
        this.players.xrayEnabled)
      ) {
        let e = this.scene.renderWithDepth(this.cameras.camera)
        ;(this.players.applyXrayDepth(e, this.scene.drawingBufferSize),
          this.players.renderXray(this.scene.renderer, this.cameras.camera, this.xrayCharacters()))
      } else this.scene.renderPreview(this.cameras.camera)
      ;(this.renderViewModel(n), this.renderFlashbang(), this.nametags.render(this.cameras.camera))
    }
    renderSceneAndPrepareEffects(e, t) {
      let n = this.smoke.needsDepthPrepass(e),
        r = this.grenades.blastsNeedDepth
      if (n || r || this.players.xrayEnabled) {
        let i = this.scene.renderWithDepth(e, t),
          a = t ?? this.scene.drawingBufferSize
        ;(n && this.smoke.applySceneDepth(i, e, a),
          r && this.grenades.applyBlastDepth(i, e, a),
          this.players.xrayEnabled && this.players.applyXrayDepth(i, a))
        return
      }
      this.scene.render(e)
    }
    updateSmokeOcclusion() {
      ;(this.smokeOccluded.fill(0), this.smokeView.copy(this.cameras.camera.position))
      for (let e = 0; e < this.buffers.alive.length; e++) {
        if (this.buffers.alive[e] !== 1 || e === this.followedSlotForTags()) continue
        let t = this.buffers.duck[e] > 0.5 ? 54 : 72
        for (let n of [0.25, 0.55, 0.85])
          if (
            (this.smokeTarget.set(this.buffers.x[e], this.buffers.y[e], this.buffers.z[e] + t * n),
            this.smoke.obscuresSegment(this.smokeView, this.smokeTarget))
          ) {
            this.smokeOccluded[e] = 1
            break
          }
      }
    }
    followedSlotForTags() {
      let e = this.cameras.getMode()
      return e.kind === `first` ? e.slot : -1
    }
    computeBombSnapshot(e) {
      let { segments: t } = this.data.bomb,
        n = Tg(this.data, e),
        r = n !== null,
        i = n?.hasKit ?? !1,
        a = null
      for (let n of t)
        if (e >= n.startTick && e < n.endTick) {
          a = n
          break
        }
      if (!a)
        return { kind: `none`, x: 0, y: 0, z: 0, carrierSlot: -1, site: ``, blink: !1, defusing: r, defuseHasKit: i }
      if (a.kind === `carried`) {
        let e = a.carrierSlot,
          t = e >= 0 && e < this.buffers.x.length
        return {
          kind: `carried`,
          x: t ? this.buffers.x[e] : 0,
          y: t ? this.buffers.y[e] : 0,
          z: t ? this.buffers.z[e] : 0,
          carrierSlot: e,
          site: ``,
          blink: !1,
          defusing: r,
          defuseHasKit: i,
        }
      }
      if (a.kind === `planted`) {
        let t = (e - a.startTick) / this.data.meta.tickRate,
          n = 0,
          o = SP.length - 1
        for (; n < o;) {
          let e = (n + o + 1) >> 1
          SP[e] <= t ? (n = e) : (o = e - 1)
        }
        let s = t >= 0 && t - SP[n] < CP
        return {
          kind: `planted`,
          x: a.x,
          y: a.y,
          z: a.z,
          carrierSlot: -1,
          site: a.site,
          blink: s,
          defusing: r,
          defuseHasKit: i,
        }
      }
      return {
        kind: `dropped`,
        x: a.x,
        y: a.y,
        z: a.z,
        carrierSlot: -1,
        site: ``,
        blink: !1,
        defusing: r,
        defuseHasKit: i,
      }
    }
    updatePlaybackEvents(e) {
      let t = this.lastHandoffTick
      this.lastHandoffTick = e
      let n = e - t
      if (n > 0 && n < gP) {
        for (let n of this.data.events)
          if (!(n.tick <= t || n.tick > e)) {
            if ((this.applyPendingDeathHandoff(n.tick), n.type === `round_start`)) {
              ;(this.clearKillReplay(), this.restoreDeathCamera())
              continue
            }
            n.type !== `kill` || n.victimSlot !== this.cameras.getFollowedSlot() || this.startDeathScenario(n, n.tick)
          }
        this.applyPendingDeathHandoff(e)
      }
    }
    startDeathScenario(e, t) {
      let n = this.cameras.getMode()
      ;(n.kind !== `first` && n.kind !== `spectate`) ||
        (this.clearKillReplay(),
        (this.deathScenario ??= {
          originalSlot: n.slot,
          originalMode: n.kind,
          restoreTick: this.nextRoundTick(e.tick),
          pending: null,
        }),
        (this.deathScenario.pending = { victimSlot: n.slot, death: e, switchTick: t + 2 * this.data.meta.tickRate }),
        this.deathFade.show(e, this.data.damage, this.data.players, this.roundStartTick(e.tick)))
    }
    maybeStartDeathScenarioAfterSeek(e) {
      if (!this.checkDeathScenarioAfterSeek) return
      this.checkDeathScenarioAfterSeek = !1
      let t = this.cameras.getMode()
      if ((t.kind !== `first` && t.kind !== `spectate`) || this.isPlayerAlive(t.slot, e)) return
      let n = kg(this.data.events, this.roundStartTick(e), t.slot, e)
      n && this.startDeathScenario(n, e)
    }
    applyPendingDeathHandoff(e) {
      let t = this.deathScenario
      if (!t) return
      if (t.restoreTick !== null && t.restoreTick <= e) {
        this.restoreDeathCamera()
        return
      }
      let n = t.pending
      if (!n || n.switchTick > e) return
      if (((t.pending = null), this.cameras.getFollowedSlot() !== n.victimSlot)) {
        this.cancelDeathScenario()
        return
      }
      let r =
        Ag(this.data.events, n.death, n.switchTick, t.restoreTick, this.data.meta.tickRate, (e, t) =>
          this.isPlayerAlive(e, t),
        ) ?? this.pickLivingPlayer(n.victimSlot, n.switchTick, t.restoreTick)
      r >= 0 ? this.followLikeCurrent(r, t.originalMode) : this.cameras.setFree()
    }
    restoreDeathCamera() {
      let e = this.deathScenario
      e && (this.followLikeCurrent(e.originalSlot, e.originalMode), this.cancelDeathScenario())
    }
    replayDeath(e, t) {
      let n = t === `victim` ? e.victimSlot : e.attackerSlot
      if (n === void 0 || n < 0) {
        console.warn(`Cannot replay ${t} POV without a valid player slot.`)
        return
      }
      let { startTick: r, tickRate: i } = this.data.meta,
        a = Math.max(this.roundStartTick(e.tick), e.tick - this.settings.viewerSettings.killLeadIn * i)
      ;(this.seekPlayback((a - r) / i),
        this.followPlayer(n),
        (this.playbackWanted = !0),
        this.clock.play(),
        this.sampleAndRender(this.clock.time))
    }
    followLikeCurrent(e, t = this.cameras.getMode().kind) {
      ;(this.clearKillReplay(), t === `spectate` ? this.cameras.spectate(e) : this.cameras.follow(e))
    }
    isPlayerAlive(e, t) {
      let { frames: n, meta: r } = this.data
      if (e < 0 || e >= r.numPlayers) return !1
      let i = this.model.findFrame((t - r.startTick) / r.tickRate)
      return n.alive[i * r.numPlayers + e] === 1
    }
    pickLivingPlayer(e, t, n) {
      let { frames: r, meta: i } = this.data,
        a = i.numPlayers,
        o = this.model.findFrame((t - i.startTick) / i.tickRate) * a,
        s = r.team[o + e],
        c = -1
      for (let l = 0; l < a; l++)
        if (!(l === e || r.alive[o + l] !== 1) && jg(this.data.events, l, t, n, i.tickRate)) {
          if (r.team[o + l] === s) return l
          c < 0 && (c = l)
        }
      return c
    }
    followPlayer(e) {
      ;(this.clearKillReplay(), this.cancelDeathScenario(), this.cameras.follow(e))
    }
    cyclePlayer(e) {
      ;(this.clearKillReplay(),
        this.cancelDeathScenario(),
        this.cameras.cyclePlayer(e, (e) => this.buffers.alive[e] === 1))
    }
    selectFreeCamera() {
      ;(this.clearKillReplay(), this.cancelDeathScenario(), this.cameras.setFree())
    }
    selectFlyCamera() {
      ;(this.clearKillReplay(), this.cancelDeathScenario(), this.cameras.setFly())
    }
    selectNoclipCamera() {
      ;(this.clearKillReplay(), this.cancelDeathScenario(), this.cameras.setNoclip())
    }
    seekPlayback(e) {
      ;(this.clearKillReplay(),
        this.cancelDeathScenario(),
        this.scope.resetReticleTransition(),
        this.clock.seek(e),
        this.audio.stopOneShots(),
        this.demoSounds.resetWindow(),
        (this.lastHandoffTick = this.data.meta.startTick + this.clock.time * this.data.meta.tickRate),
        (this.checkDeathScenarioAfterSeek = !0))
    }
    cancelDeathScenario() {
      ;((this.deathScenario = null), this.deathFade.setActive(!1))
    }
    clearKillReplay() {
      ;(this.killReplayTracker.reset(), this.killReplay.update(null, this.lastHandoffTick, this.data.meta.tickRate))
    }
    dismissKillReplay() {
      ;(this.killReplayTracker.dismiss(), this.killReplay.update(null, this.lastHandoffTick, this.data.meta.tickRate))
    }
    updateKillReplay(e) {
      let t = this.cameras.getFollowedSlot()
      if (this.deathScenario?.pending || !this.isPlayerAlive(t, e)) {
        this.clearKillReplay()
        return
      }
      ;(this.killReplayTracker.update(
        e,
        t,
        this.roundStartTick(e),
        this.data.meta.tickRate,
        this.data.meta.numPlayers,
        this.data.events,
        this.nextRoundTick(e) ?? this.data.meta.endTick + 1,
      ),
        this.killReplay.update(this.killReplayTracker.group, e, this.data.meta.tickRate))
    }
    roundStartTick(e) {
      let t = this.data.meta.startTick
      for (let n of this.data.rounds) {
        if (n.startTick > e) break
        t = n.startTick
      }
      return t
    }
    nextRoundTick(e) {
      return this.data.rounds.find((t) => t.startTick > e)?.startTick ?? null
    }
    updateCrosshair(e, t = !1) {
      let n = this.cameras.getMode()
      if (n.kind === `first` && this.buffers.alive[n.slot] === 1) {
        let r = this.buffers.zoom[n.slot],
          { panelFrames: i, meta: a, weaponNames: o } = this.data,
          s = a.startTick + e * a.tickRate,
          c = EP(i.frameTick, s),
          l = o[i.activeWeapon[c * a.numPlayers + n.slot]] ?? ``
        r > 0
          ? (this.scope.show(
              r,
              l,
              this.buffers.speed[n.slot],
              this.buffers.accuracyPenalty[n.slot],
              this.buffers.duck[n.slot],
              t ? { time: e, dt: this.clock.playing ? this.frameDt : 0, slot: n.slot } : void 0,
            ),
            this.crosshair.hide())
          : (this.scope.hide(), iM(l) ? this.crosshair.hide() : this.crosshair.show(this.getCrosshair(n.slot)))
      } else (this.scope.hide(), this.crosshair.hide())
    }
    updateBlindOverlay(e = this.clock.time) {
      let t = this.cameras.getMode(),
        { meta: n } = this.data,
        r = n.startTick + e * n.tickRate,
        i = t.kind === `first` ? Wk(this.data.frames, n.numPlayers, t.slot, r, n.tickRate) : null,
        a = Gk(i, r, n.tickRate)
      if (t.kind !== `first` || a.remaining <= 0) {
        ;((this.flashEpisodeKey = null), (this.flashScreen = a), this.blind.hide())
        return
      }
      let o = this.settings.viewerSettings.flashEffect
      ;((this.flashScreen = Kk(a, !this.settings.xrayEnabled, o)),
        (this.flashEpisodeKey = `${t.slot}:${i.onsetTick}`),
        this.blind.update(a.remaining, a.white, !this.settings.xrayEnabled, o))
    }
    renderFlashbang() {
      let e = this.flashScreen
      this.flashbang.render(
        this.scene.renderer,
        e.afterimage > 0 ? this.flashEpisodeKey : null,
        e.afterimage,
        e.exposure,
        e.white,
      )
    }
    getCrosshair(e) {
      let t = this.crosshairBySlot.get(e)
      if (!t) {
        let n = this.data.players[e]?.crosshairCode
        ;((t = (n && vg(n)) || pg), this.crosshairBySlot.set(e, t))
      }
      return t
    }
    nametagContext(e, t) {
      let { panelFrames: n, weaponNames: r } = this.data
      return { panelFrames: n, weaponNames: r, frame: EP(n.frameTick, e), bombCarrier: t }
    }
    updatePanels(e) {
      let { panelFrames: t, meta: n, players: r, weaponNames: i } = this.data,
        a = n.numPlayers,
        o = n.startTick + e * n.tickRate,
        s = Tg(this.data, o),
        c = EP(t.frameTick, o) * a,
        l = this.cameras.getFollowedSlot(),
        { kills: u, deaths: d } = this.killsAtTick(o),
        f = [],
        p = []
      for (let e = 0; e < a; e++) {
        let n = c + e,
          a = t.team[n],
          o = t.utilCounts[n],
          m = {
            slot: e,
            name: r[e]?.name ?? `Player ${e}`,
            team: a,
            alive: t.alive[n] === 1,
            health: t.health[n],
            armor: t.armor[n],
            helmet: (t.flags[n] & 1) == 1,
            defuser: (t.flags[n] & 2) == 2,
            defuseProgress: t.alive[n] === 1 && s?.defuserSlot === e ? s.progress : null,
            money: t.money[n],
            weapon: i[t.activeWeapon[n]] ?? ``,
            clipAmmo: t.clipAmmo[n],
            reserveAmmo: t.reserveAmmo[n],
            util: [o & 3, (o >> 2) & 3, (o >> 4) & 3, (o >> 6) & 3],
            kills: u[e],
            deaths: d[e],
            followed: e === l,
          }
        a === 2 ? f.push(m) : p.push(m)
      }
      ;(this.panels.update(f, p),
        this.povPicker.update(this.povPlayers(f, p), l, this.povMode()),
        this.controls.setPlayers(
          r.map((e, t) => ({ slot: t, name: e.name, alive: this.buffers.alive[t] === 1 })),
          l,
        ))
    }
    povPlayers(e, t) {
      let n = (e) => ({
        slot: e.slot,
        name: e.name,
        side: e.team === 2 ? `t` : e.team === 3 ? `ct` : null,
        alive: e.alive,
      })
      return [...e.map(n), ...t.map(n)]
    }
    povMode() {
      let e = this.cameras.getMode().kind
      return e === `fly` || e === `noclip` || e === `free` ? e : `player`
    }
    killsAtTick(e) {
      let t = new Int32Array(this.data.meta.numPlayers),
        n = new Int32Array(this.data.meta.numPlayers)
      for (let r of this.data.events) {
        if (r.type !== `kill`) continue
        if (r.tick > e) break
        let i = this.resetKillRespawns.get(r)
        ;(i !== void 0 && e >= i) ||
          (r.attackerSlot !== void 0 && r.attackerSlot >= 0 && t[r.attackerSlot]++,
          r.victimSlot !== void 0 && r.victimSlot >= 0 && n[r.victimSlot]++)
      }
      return { kills: t, deaths: n }
    }
    rebuildResetKillRespawns() {
      this.resetKillRespawns.clear()
      let { events: e, frames: t, meta: n, rounds: r } = this.data
      for (let i of e) {
        if (i.type !== `kill` || i.victimSlot === void 0 || i.victimSlot < 0) continue
        let a = e.find((e) => e.type === `round_end` && e.tick >= i.tick)?.tick,
          o = r.find((e) => e.startTick > i.tick)?.startTick,
          s = a ?? o ?? n.endTick,
          c = this.model.findFrame((i.tick - n.startTick) / n.tickRate) + 1
        for (; c < t.frameTick.length && t.frameTick[c] < s; c++)
          if (t.alive[c * n.numPlayers + i.victimSlot] === 1) {
            this.resetKillRespawns.set(i, t.frameTick[c])
            break
          }
      }
    }
    updateHud(e, t = !0) {
      let n = this.model.findFrame(e),
        r = this.data.meta.startTick + e * this.data.meta.tickRate,
        i = d_(this.data, n, r),
        a = this.cameras.getMode(),
        o = this.cameras.getFollowedSlot()
      ;(this.controls.setTimeoutEnd(this.activeTimeoutEnd(e)),
        a.kind === `fly`
          ? this.controls.setViewMode(`fly`)
          : a.kind === `noclip`
            ? this.controls.setViewMode(`noclip`)
            : o >= 0
              ? this.controls.setViewMode(`player`)
              : this.controls.setViewMode(`free`),
        this.hud.setInfo(this.data.meta.mapName, ``),
        this.hud.setMatchState(i),
        this.hud.setDefuseCue(Tg(this.data, r), o, this.data.players[o]?.name ?? `Player ${o}`),
        t && this.updateFeed(e))
    }
    activeTimeoutEnd(e) {
      let t = this.data.meta.startTick + e * this.data.meta.tickRate,
        n = this.data.timeouts.intervals.find((e) => t >= e.startTick && t < e.endTick)
      return n ? (n.endTick - this.data.meta.startTick) / this.data.meta.tickRate : null
    }
    updateFeed(e) {
      let t = this.data.meta.startTick + e * this.data.meta.tickRate,
        n = this.roundIndexAtTick(t)
      ;(n !== this.lastRoundForFeed &&
        ((this.lastRoundForFeed = n),
        (this.nadeWindow = this.roundWindow(n)),
        this.feed.setRound(n, this.buildRoundKills(n), this.buildRoundNades())),
        this.feed.update(t, this.clock.playing))
    }
    roundWindow(e) {
      let { rounds: t, meta: n } = this.data
      return {
        startTick: e >= 0 ? t[e].startTick : n.startTick,
        endTick: e + 1 < t.length ? t[e + 1].startTick : n.endTick,
      }
    }
    buildRoundNades() {
      let { grenades: e, players: t, meta: n } = this.data,
        { startTick: r, endTick: i } = this.nadeWindow,
        a = [],
        o = e.trajectories
      for (let e = 0; e < o.length; e++) {
        let s = o[e]
        if (s.startTick < r || s.startTick >= i) continue
        let c = s.throwerSlot >= 0 ? this.teamAtFrameTick(s.throwerSlot, s.startTick) : 0
        a.push({
          id: e,
          kind: s.kind,
          thrower: s.throwerSlot >= 0 ? (t[s.throwerSlot]?.name ?? `Player ${s.throwerSlot}`) : `—`,
          color: kP(c),
          tick: s.startTick,
          timeLabel: OP(u_(r, s.startTick, n.tickRate, this.data.timeouts.intervals)),
        })
      }
      return (a.sort((e, t) => e.tick - t.tick), a)
    }
    updateScoreboard(e) {
      if (!this.scoreboard.isVisible()) return
      let { events: t, damage: n, players: r, meta: i, frames: a } = this.data,
        o = i.numPlayers,
        s = i.startTick + e * i.tickRate,
        c = new Int32Array(o),
        l = new Int32Array(o),
        u = new Int32Array(o),
        d = new Int32Array(o)
      for (let e of t)
        if (e.type === `kill`) {
          if (e.tick > s) break
          ;(e.attackerSlot !== void 0 &&
            e.attackerSlot >= 0 &&
            (c[e.attackerSlot]++, e.headshot && d[e.attackerSlot]++),
            e.assisterSlot !== void 0 && e.assisterSlot >= 0 && l[e.assisterSlot]++,
            e.victimSlot !== void 0 && e.victimSlot >= 0 && u[e.victimSlot]++)
        }
      let f = new Int32Array(o),
        p = n
      for (let e = 0; e < p.count && !(p.tick[e] > s); e++) {
        let t = p.attackerSlot[e],
          n = p.victimSlot[e]
        t !== n && this.teamAtFrameTick(t, p.tick[e]) !== this.teamAtFrameTick(n, p.tick[e]) && (f[t] += p.dmg[e])
      }
      let m = this.model.findFrame(e),
        h = m * o,
        g = this.cameras.getFollowedSlot(),
        _ = this.data.panelFrames,
        v = EP(_.frameTick, s) * o,
        y = []
      for (let e = 0; e < o; e++)
        y.push({
          slot: e,
          name: r[e]?.name ?? `Player ${e}`,
          team: a.team[h + e],
          money: _.money[v + e] ?? 0,
          kills: c[e],
          deaths: u[e],
          assists: l[e],
          dmg: f[e],
          hsPct: c[e] > 0 ? Math.round((d[e] / c[e]) * 100) : -1,
          alive: a.alive[h + e] === 1,
          followed: e === g,
        })
      let b = d_(this.data, m)
      this.scoreboard.update(y, { tLabel: b.tLabel, ctLabel: b.ctLabel })
    }
    teamAtFrameTick(e, t) {
      let { frames: n, meta: r } = this.data,
        i = r.numPlayers
      if (e < 0 || e >= i) return 0
      let a = this.model.findFrame((t - r.startTick) / r.tickRate)
      return n.team[a * i + e]
    }
    bombYaw(e) {
      let { segments: t } = this.data.bomb,
        n = t.findIndex((t) => e >= t.startTick && e < t.endTick),
        r = n >= 0 ? t[n].startTick : -1
      if (r === this.bombYawCache.startTick) return this.bombYawCache.yaw
      let { frames: i, meta: a } = this.data,
        o = a.numPlayers,
        s = this.model.findFrame((r - a.startTick) / a.tickRate),
        c = n > 0 ? t[n - 1] : void 0,
        l = c?.kind === `carried` ? c.carrierSlot : -1
      if (l < 0 && n >= 0 && t[n].kind === `planted` && i.playerFlags)
        for (let e = s; e >= Math.max(0, s - bP) && l < 0; e--)
          for (let t = 0; t < o; t++) i.playerFlags[e * o + t] & 4 && (l = t)
      let u = l >= 0 && l < o ? (i.yaw[s * o + l] ?? 0) : 0
      return ((this.bombYawCache = { startTick: r, yaw: u }), u)
    }
    roundIndexAtTick(e) {
      let t = this.data.rounds,
        n = -1
      for (let r = 0; r < t.length && t[r].startTick <= e; r++) n = r
      return n
    }
    buildRoundKills(e) {
      let { rounds: t, events: n, meta: r } = this.data,
        i = e >= 0 ? t[e].startTick : r.startTick,
        a = e + 1 < t.length ? t[e + 1].startTick : r.endTick,
        o = []
      for (let e = 0; e < n.length; e++) {
        let t = n[e]
        t.type === `kill` &&
          (t.tick < i || t.tick >= a || o.push(DP(t, e, u_(i, t.tick, r.tickRate, this.data.timeouts.intervals))))
      }
      return o
    }
    jumpToKill(e) {
      let t = this.data.events[e]
      if (!t || t.type !== `kill`) return
      let n =
          t.weapon === `world` || (t.victimSlot !== void 0 && t.attackerSlot === t.victimSlot)
            ? t.victimSlot
            : (t.attackerSlot ?? t.victimSlot),
        r = Math.max(0, t.time - this.settings.viewerSettings.killLeadIn)
      ;(this.seekPlayback(r),
        n !== void 0 && n >= 0 && this.followPlayer(n),
        (this.playbackWanted = !0),
        this.clock.play(),
        this.sampleAndRender(this.clock.time))
    }
    jumpToNade(e) {
      let t = this.data.grenades.trajectories[e]
      if (!t) return
      let n = (t.startTick - this.data.meta.startTick) / this.data.meta.tickRate
      ;((this.selectedGrenade = e),
        this.seekPlayback(Math.max(0, n - this.settings.viewerSettings.utilityLeadIn)),
        t.throwerSlot >= 0 && this.followPlayer(t.throwerSlot),
        (this.playbackWanted = !0),
        this.clock.play(),
        this.sampleAndRender(this.clock.time))
    }
    jumpToNadeLanding(e) {
      let t = this.data.grenades.trajectories[e]
      if (!t)
        return (
          console.warn(`[csplayer] Cannot view landing: grenade trajectory is unavailable.`, e),
          `This grenade trajectory is no longer available.`
        )
      let n = Uh(t, this.data.grenades.effects),
        r = n.ok ? Kh(this.data, t, n.landing.tick, n.landing.target) : [],
        i = lg(t, this.data.grenades.effects, this.mapLoader.object, r)
      if (!i.ok) return (console.warn(`[csplayer] Cannot view grenade landing:`, i.reason), i.reason)
      let { startTick: a, tickRate: o } = this.data.meta,
        s = Math.max(this.roundStartTick(t.startTick), i.tick - this.settings.viewerSettings.utilityLeadIn * o)
      return (
        (this.selectedGrenade = e),
        this.seekPlayback((s - a) / o),
        this.cameras.setFlyView(i.position, i.target),
        (this.playbackWanted = !0),
        this.clock.play(),
        this.sampleAndRender(this.clock.time),
        null
      )
    }
    replaceRoundData(e, t) {
      if (
        !this.running ||
        e.meta.mapName !== this.data.meta.mapName ||
        e.players.length !== this.data.players.length ||
        e.players.some((e, t) => e.steamId !== this.data.players[t].steamId)
      )
        return !1
      let n = Math.min(t, this.manifest.rounds.length)
      return (
        (this.parsedRounds = Math.max(this.parsedRounds, n)),
        (this.data.timeouts = e.timeouts),
        this.controls.setTimelineMarkers(this.roundFractions(), this.timeoutMarkers(), this.majorTimelineEvents()),
        this.smoothRoundBackfill && this.clock.playing && this.clock.time < this.loadedDurationSeconds() - vP
          ? ((!this.pendingRoundData || n >= this.pendingRoundData.loadedRounds) &&
              (this.pendingRoundData = { data: e, loadedRounds: n }),
            this.updateRoundLoadState(),
            !0)
          : ((this.pendingRoundData = null), this.applyRoundData(e, n, !0), !0)
      )
    }
    maybeApplyPendingRoundData() {
      this.pendingRoundData &&
        ((this.smoothRoundBackfill && this.clock.playing && this.clock.time < this.loadedDurationSeconds() - vP) ||
          this.flushPendingRoundData(!1))
    }
    flushPendingRoundData(e) {
      let t = this.pendingRoundData
      t && ((this.pendingRoundData = null), this.applyRoundData(t.data, t.loadedRounds, e))
    }
    applyRoundData(e, t, n) {
      let r = this.clock.duration
      for (let t = 0; t < this.data.players.length; t++) Object.assign(this.data.players[t], e.players[t])
      ;((this.data.meta = e.meta),
        (this.data.frames = e.frames),
        (this.data.events = e.events),
        (this.data.rounds = e.rounds),
        (this.data.grenades = e.grenades),
        (this.data.tracers = e.tracers),
        (this.data.smokeVoxels = e.smokeVoxels),
        (this.data.panelFrames = e.panelFrames),
        (this.data.weaponNames = e.weaponNames),
        (this.data.deathMarkers = e.deathMarkers),
        (this.data.deathRagdolls = e.deathRagdolls),
        (this.data.droppedWeapons = e.droppedWeapons),
        (this.data.mapEntities = e.mapEntities),
        (this.data.weaponFires = e.weaponFires),
        (this.data.damage = e.damage),
        (this.data.bomb = e.bomb),
        (this.data.timeouts = e.timeouts),
        (this.loadedRounds = Math.min(t, this.manifest.rounds.length)),
        (this.parsedRounds = Math.max(this.parsedRounds, this.loadedRounds)),
        (this.model = new bg(this.data)),
        this.rebuildResetKillRespawns(),
        this.clock.setDuration(this.loadedDurationSeconds()),
        this.playbackWanted &&
          !this.clock.playing &&
          this.clock.duration > r &&
          this.clock.time >= r - 1 / this.data.meta.tickRate &&
          this.clock.play(),
        this.grenades.setData(this.data.grenades),
        this.smoke.setData(this.data.grenades.effects, this.data.smokeVoxels),
        this.smoke.setTracers(this.data.tracers),
        this.tracers.setData(this.data.tracers),
        this.deathMarkers.setData(this.data.deathMarkers),
        this.droppedWeapons.setData(this.data.droppedWeapons ?? []),
        this.mapBreaks.setCauses(this.breakCauses()),
        this.demoSounds.setData(this.data),
        this.controls.setTimelineMarkers(this.roundFractions(), this.timeoutMarkers(), this.majorTimelineEvents()),
        this.updateRoundLoadState(),
        this.crosshairBySlot.clear(),
        (this.lastRoundForFeed = -2),
        n && this.sampleAndRender(this.clock.time))
    }
    getPlaybackState() {
      return { time: this.clock.time, speed: this.clock.speed, playing: this.clock.playing }
    }
    restorePlaybackState(e) {
      ;(this.clock.setSpeed(e.speed),
        this.seekPlayback(e.time),
        (this.playbackWanted = e.playing),
        e.playing ? this.clock.play() : this.clock.pause(),
        this.sampleAndRender(this.clock.time))
    }
    dispose() {
      ;((this.running = !1), this.container.removeAttribute(`data-mobile-feed`))
      for (let e of Object.keys(this.settings.viewerSettings.hud))
        this.container.removeAttribute(`data-hud-${e.toLowerCase()}`)
      ;((this.pendingRoundData = null),
        window.removeEventListener(`keydown`, this.onKeyDown),
        window.removeEventListener(`keyup`, this.onKeyUp),
        window.removeEventListener(`resize`, this.onResize),
        this.controlsAutoHide.dispose(),
        this.povPicker.element.remove(),
        this.controls.dispose(),
        this.hud.dispose(),
        this.nametags.dispose(),
        this.cameras.dispose(),
        this.crosshair.dispose(),
        this.scope.dispose(),
        this.blind.dispose(),
        this.flashbang.dispose(),
        this.damage.dispose(),
        this.deathFade.dispose(),
        this.killReplay.dispose(),
        this.radar?.dispose(),
        this.leaveFab?.remove(),
        this.settingsFab?.remove(),
        this.performanceFab?.remove(),
        this.scoreboard.dispose(),
        this.feed.dispose(),
        this.grenades.dispose(),
        this.smoke.dispose(),
        this.tracers.dispose(),
        this.deathMarkers.dispose(),
        this.droppedWeapons.dispose(),
        this.mapBreaks.dispose(),
        this.audio.dispose(),
        this.characters.dispose(),
        this.viewModel.dispose(),
        this.bomb.dispose(),
        this.panels.dispose(),
        this.settings.dispose(),
        this.statsOverlay.dispose(),
        this.mapLoader.dispose(),
        this.cs2Map.dispose(),
        this.players.dispose(),
        this.scene.dispose())
    }
    debugGrenadeCountsAtTime(e) {
      return (
        this.seekPlayback(e),
        this.sampleAndRender(e),
        { ...this.grenades.debugCounts(), smokes: this.smoke.debugActiveCount() }
      )
    }
    debugTracerCountAtTime(e) {
      return (this.seekPlayback(e), this.sampleAndRender(e), this.tracers.debugCount())
    }
    debugDeathCountAtTime(e) {
      return (this.seekPlayback(e), this.sampleAndRender(e), this.deathMarkers.debugCount())
    }
    debugDroppedWeaponCountAtTime(e) {
      return (this.seekPlayback(e), this.sampleAndRender(e), this.droppedWeapons.debugCount())
    }
    debugBombAtTime(e) {
      ;(this.seekPlayback(e), this.sampleAndRender(e))
      let t = this.data.meta.startTick + e * this.data.meta.tickRate
      return { ...this.computeBombSnapshot(t), modelVisible: this.bomb.debugVisible() }
    }
  }
function EP(e, t) {
  let n = e.length
  if (n === 0 || t <= e[0]) return 0
  if (t >= e[n - 1]) return n - 1
  let r = 0,
    i = n - 1
  for (; r < i;) {
    let n = (r + i + 1) >> 1
    e[n] <= t ? (r = n) : (i = n - 1)
  }
  return r
}
function DP(e, t, n) {
  let r = e.weapon === `world` || (e.victimSlot !== void 0 && e.attackerSlot === e.victimSlot)
  return {
    id: t,
    tick: e.tick,
    timeLabel: OP(n),
    attacker: e.attackerName || `—`,
    victim: e.victimName || `—`,
    attackerColor: kP(e.attackerTeam),
    victimColor: kP(e.victimTeam),
    weapon: e.weapon || ``,
    headshot: !!e.headshot,
    noscope: !!e.noscope,
    thrusmoke: !!e.thrusmoke,
    attackerblind: !!e.attackerblind,
    wallbang: !!e.wallbang,
    world: r,
  }
}
function OP(e) {
  let t = Math.floor(e)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, `0`)}`
}
function kP(e) {
  return e === 2 ? `var(--pc-t)` : e === 3 ? `var(--pc-ct)` : `var(--pc-secondary)`
}
