// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 45087–45384 行（切片 33/40）
// 角色：顶部比分条 HUD jM：hud/scorebar/sb-t-score/bomb 状态
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var jM = class {
    root
    mapEl
    roundEl
    tScoreEl
    ctScoreEl
    tLabelEl
    ctLabelEl
    timerEl
    roundNumEl
    bombEl
    statusEl
    defuseEl
    defuseFillEl
    scorebarEl
    lastMatchKey = ``
    lastTLabel = ``
    lastCtLabel = ``
    teams
    defuseCue
    defuseCueTime
    defuseCueName
    defuseCueMessage
    defuseCueRing
    defuseCueIcon
    lastDefuseKey = ``
    constructor(e, t) {
      this.teams = t
      let n = document.createElement(`div`)
      ;((n.className = `hud`),
        (n.innerHTML = `
      <div class="hud-info">
        <span class="hud-map">—</span>
        <span class="hud-round"></span>
      </div>
      <div class="scorebar" hidden>
        <span class="sb-team sb-t"><span class="sb-label sb-t-label">T</span><span class="sb-score sb-t-score">0</span></span>
        <div class="sb-center">
          <span class="sb-timer">0:00</span>
          <div class="sb-status" hidden>
            <span class="sb-bomb"></span>
            <div class="sb-defuse"><div class="sb-defuse-fill"></div></div>
          </div>
          <span class="sb-round"></span>
        </div>
        <span class="sb-team sb-ct"><span class="sb-score sb-ct-score">0</span><span class="sb-label sb-ct-label">CT</span></span>
      </div>
      <div class="defuse-cue" hidden>
        <div class="defuse-cue-ring" role="progressbar" aria-label="Bomb defuse progress" aria-valuemin="0" aria-valuemax="100">
          <svg class="defuse-cue-circle" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="defuse-cue-track" cx="50" cy="50" r="40"></circle>
            <path class="defuse-cue-arc" d="M 50 90 A 40 40 0 0 1 50 10" pathLength="100"></path>
            <path class="defuse-cue-arc" d="M 50 90 A 40 40 0 0 0 50 10" pathLength="100"></path>
          </svg>
          <span class="defuse-cue-icon" aria-hidden="true"></span>
        </div>
        <span class="defuse-cue-heading"><span class="defuse-cue-name"></span><span class="defuse-cue-message"></span></span>
        <span class="defuse-cue-time"></span>
      </div>
    `),
        e.appendChild(n),
        (this.root = n),
        (this.mapEl = n.querySelector(`.hud-map`)),
        (this.roundEl = n.querySelector(`.hud-round`)),
        (this.scorebarEl = n.querySelector(`.scorebar`)),
        (this.tScoreEl = n.querySelector(`.sb-t-score`)),
        (this.ctScoreEl = n.querySelector(`.sb-ct-score`)),
        (this.tLabelEl = n.querySelector(`.sb-t-label`)),
        (this.ctLabelEl = n.querySelector(`.sb-ct-label`)),
        (this.timerEl = n.querySelector(`.sb-timer`)),
        (this.roundNumEl = n.querySelector(`.sb-round`)),
        (this.bombEl = n.querySelector(`.sb-bomb`)),
        (this.statusEl = n.querySelector(`.sb-status`)),
        (this.defuseEl = n.querySelector(`.sb-defuse`)),
        (this.defuseFillEl = n.querySelector(`.sb-defuse-fill`)),
        (this.defuseCue = n.querySelector(`.defuse-cue`)),
        (this.defuseCueTime = n.querySelector(`.defuse-cue-time`)),
        (this.defuseCueName = n.querySelector(`.defuse-cue-name`)),
        (this.defuseCueMessage = n.querySelector(`.defuse-cue-message`)),
        (this.defuseCueRing = n.querySelector(`.defuse-cue-ring`)),
        (this.defuseCueIcon = n.querySelector(`.defuse-cue-icon`)))
    }
    setInfo(e, t) {
      ;((this.mapEl.textContent = e), (this.roundEl.textContent = t))
    }
    getScorebarBounds() {
      return this.scorebarEl.hidden ? null : this.scorebarEl.getBoundingClientRect()
    }
    setDefuseCue(e, t, n) {
      if (!e || t < 0 || e.defuserSlot !== t) {
        ;((this.defuseCue.hidden = !0), (this.lastDefuseKey = ``))
        return
      }
      let r = (e.progress * 100).toFixed(1),
        i = e.remainingSeconds > 0 ? Math.max(1, Math.round(e.remainingSeconds * 1e3)) : 0,
        a = String(Math.floor(i / 6e4)).padStart(2, `0`),
        o = String(Math.floor(i / 1e3) % 60).padStart(2, `0`),
        s = String(i % 1e3).padStart(3, `0`),
        c = `${t}|${n}|${e.hasKit}|${e.progress}|${i}`
      if (c === this.lastDefuseKey) return
      ;((this.lastDefuseKey = c),
        (this.defuseCue.hidden = !1),
        (this.defuseCueTime.textContent = `${a}:${o}.${s}`),
        (this.defuseCueName.textContent = n),
        (this.defuseCueMessage.textContent = ` is defusing the bomb ${e.hasKit ? `with` : `without`} a kit.`))
      let l = `url(${Zb(e.hasKit ? `defuser` : `c4`)})`
      ;((this.defuseCueIcon.style.maskImage = l),
        (this.defuseCueIcon.style.webkitMaskImage = l),
        this.defuseCueRing.style.setProperty(`--defuse-remaining`, String((1 - e.progress) * 100)),
        this.defuseCueRing.setAttribute(`aria-valuenow`, r),
        this.defuseCueRing.setAttribute(
          `aria-valuetext`,
          `${(i / 1e3).toFixed(3)} seconds remaining${e.hasKit ? `, with kit` : `, no kit`}`,
        ))
    }
    setMatchState(e) {
      let t = e.defusing ? Math.round(e.defuseProgress * 100) : 0,
        n = `${e.tLabel}|${e.tScore}|${e.ctLabel}|${e.ctScore}|${e.timeoutSide}|${e.technicalTimeout}|${e.timeoutTimeText}|${e.round}|${e.timeText}|${e.phase}|${e.planted}|${e.site}|${e.defusing}|${e.defuseHasKit}|${t}`
      n !== this.lastMatchKey &&
        ((this.lastMatchKey = n),
        this.scorebarEl.hidden && (this.scorebarEl.hidden = !1),
        e.tLabel !== this.lastTLabel && (this.setTeamLabel(this.tLabelEl, e.tLabel), (this.lastTLabel = e.tLabel)),
        e.ctLabel !== this.lastCtLabel &&
          (this.setTeamLabel(this.ctLabelEl, e.ctLabel), (this.lastCtLabel = e.ctLabel)),
        (this.tScoreEl.textContent = String(e.tScore)),
        (this.ctScoreEl.textContent = String(e.ctScore)),
        (this.timerEl.textContent = e.timeText),
        this.timerEl.classList.toggle(`sb-timer-bomb`, e.planted),
        (this.roundNumEl.textContent = e.round > 0 ? `Round ${e.round}` : `Warmup`),
        this.setStatus(e))
    }
    setTeamLabel(e, t) {
      let n = this.teams?.get(t),
        r = n?.logoUrl,
        i = n?.mapsToWin !== void 0 && n.mapsWon !== void 0
      if (
        ((e.title = t),
        e.classList.toggle(`sb-label-logo`, !!r),
        e.classList.toggle(`sb-label-series`, i),
        r ? e.replaceChildren(gM(r, t, `sb-logo`, { fallbackText: t, invertWhite: !0 })) : (e.textContent = t),
        n?.mapsToWin !== void 0 && n.mapsWon !== void 0)
      ) {
        let r = document.createElement(`span`)
        ;((r.className = `sb-map-wins`),
          r.setAttribute(`role`, `img`),
          r.setAttribute(`aria-label`, `${t}: ${n.mapsWon} maps won; ${n.mapsToWin} needed to win the series`),
          (r.title = `${n.mapsWon} / ${n.mapsToWin} maps won`))
        for (let e = 0; e < n.mapsToWin; e++) {
          let t = document.createElement(`span`)
          ;((t.className = `sb-map-win${e < n.mapsWon ? ` is-won` : ``}`),
            t.setAttribute(`aria-hidden`, `true`),
            r.appendChild(t))
        }
        e.appendChild(r)
      }
    }
    setStatus(e) {
      let t = e.technicalTimeout || e.timeoutSide !== void 0,
        n = t || e.defusing || e.planted
      ;((this.statusEl.hidden = !n),
        n &&
          (t
            ? ((this.bombEl.textContent = `${e.technicalTimeout ? `TECHNICAL PAUSE` : `${e.timeoutSide?.toUpperCase()} TIMEOUT`} ${e.timeoutTimeText}`),
              (this.bombEl.className = `sb-bomb sb-timeout${e.timeoutSide ? ` sb-timeout-${e.timeoutSide}` : ``}`),
              (this.defuseEl.style.visibility = `hidden`))
            : e.defusing
              ? ((this.bombEl.textContent = e.defuseHasKit ? `DEFUSING (KIT)` : `DEFUSING`),
                (this.bombEl.className = `sb-bomb sb-bomb-defuse`),
                (this.defuseEl.style.visibility = `visible`),
                (this.defuseFillEl.style.width = `${Math.round(e.defuseProgress * 100)}%`))
              : ((this.bombEl.textContent = e.site ? `◉ ${e.site}` : `◉ PLANTED`),
                (this.bombEl.className = `sb-bomb sb-bomb-planted`),
                (this.defuseEl.style.visibility = `hidden`))))
    }
    dispose() {
      this.root.remove()
    }
  },
  MM = 76,
  NM = 18,
  PM = { blue: `#88cef5`, green: `#1da284`, yellow: `#f8f62d`, orange: `#ff9b25`, purple: `#c03699` },
  FM = Zb(`c4`),
  IM = Zb(`defuser`),
  LM = class {
    renderer
    scene
    players
    labels = []
    constructor(e, t, n) {
      ;((this.scene = t),
        (this.players = n),
        (this.renderer = new Mb()),
        this.renderer.setSize(e.clientWidth, e.clientHeight),
        (this.renderer.domElement.className = `nametag-layer`),
        e.appendChild(this.renderer.domElement))
      let r = Zb(`blind_kill`)
      for (let e of n) {
        let n = document.createElement(`div`)
        n.className = `nametag`
        let i = document.createElement(`div`)
        i.className = `nametag-icons`
        let a = RM(),
          o = RM()
        i.append(a, o)
        let s = document.createElement(`div`)
        s.className = `nametag-name`
        let c = document.createElement(`span`)
        c.textContent = e.name || `unknown`
        let l = document.createElement(`span`)
        ;((l.className = `nametag-flash-icon`), zM(l, r), (l.hidden = !0), s.append(c, l))
        let u = document.createElement(`div`)
        u.className = `nametag-hp`
        let d = document.createElement(`div`)
        ;((d.className = `nametag-arrow`), n.append(i, s, u, d))
        let f = new Eb(n)
        ;(f.center.set(0.5, 1),
          (f.visible = !1),
          t.add(f),
          this.labels.push({
            object: f,
            root: n,
            equip: a,
            weapon: o,
            hp: u,
            flash: l,
            color: ``,
            compact: !1,
            health: -1,
            equipUrl: null,
            weaponUrl: null,
            flashOpacity: 0,
          }))
      }
    }
    update(e, t, n = -1, r, i) {
      let a = this.labels.length,
        o = n >= 0
      for (let s = 0; s < a; s++) {
        let c = this.labels[s],
          l = e.alive[s] === 1 && s !== t && r?.[s] !== 1
        if ((l && o && e.team[s] !== n && (l = !1), (c.object.visible = l), !l)) continue
        c.object.position.set(e.x[s], e.y[s], e.z[s] + MM - NM * e.duck[s])
        let u = VM(this.players[s]?.color, e.team[s])
        ;(u !== c.color && ((c.color = u), c.root.style.setProperty(`--player-color`, u)),
          o !== c.compact && ((c.compact = o), c.root.classList.toggle(`nametag--compact`, o)))
        let d = zk(e.flash[s], e.flashAlpha[s]),
          f = d > 0 ? Math.round((0.65 + d * 0.35) * 20) / 20 : 0
        if (
          (f !== c.flashOpacity &&
            ((c.flashOpacity = f), (c.flash.hidden = f === 0), f > 0 && (c.flash.style.opacity = String(f))),
          o)
        )
          continue
        let p = e.health[s]
        p !== c.health && ((c.health = p), (c.hp.textContent = `${p}%`))
        let m = null,
          h = null
        if (i) {
          let t = i.frame * a + s
          ;((h = Xb(i.weaponNames[i.panelFrames.activeWeapon[t]])),
            i.bombCarrier === s ? (m = FM) : e.team[s] === 3 && (i.panelFrames.flags[t] & 2) == 2 && (m = IM),
            m === h && (m = null))
        }
        ;(m !== c.equipUrl && ((c.equipUrl = m), BM(c.equip, m)),
          h !== c.weaponUrl && ((c.weaponUrl = h), BM(c.weapon, h)))
      }
    }
    render(e) {
      this.renderer.render(this.scene, e)
    }
    resize(e, t) {
      this.renderer.setSize(e, t)
    }
    dispose() {
      for (let e of this.labels) this.scene.remove(e.object)
      this.renderer.domElement.remove()
    }
  }
function RM() {
  let e = document.createElement(`span`)
  return ((e.className = `nametag-icon`), (e.hidden = !0), e)
}
function zM(e, t) {
  ;((e.style.maskImage = `url(${t})`), (e.style.webkitMaskImage = `url(${t})`))
}
function BM(e, t) {
  ;((e.hidden = t === null), t !== null && zM(e, t))
}
function VM(e, t) {
  return e ? PM[e] : t === 2 ? `#e0a526` : t === 3 ? `#6db3f2` : `#aaaaaa`
}
var HM = 5,
  UM = [`smoke`, `flash`, `he`, `molotov`],
  WM = [`smoke`, `flash`, `he`, `molotov`]
function GM(e, t) {
  let n = Zb(e)
  return `<span class="pp-ic ${t}" style="-webkit-mask-image:url(${n});mask-image:url(${n})"></span>`
}
