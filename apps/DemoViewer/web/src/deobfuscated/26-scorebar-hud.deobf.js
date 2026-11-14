// ============================================================================
// 26-scorebar-hud.deobf.js —— 顶部比分 HUD + 头顶名字标签
// 来源：src/app/26-scorebar-hud.js（Vite 生产构建，prettier 展开版）
// 原始标识符已语义化重命名 + 补充中文注释。
//
// 包含：
//   MatchHud       jM  —— 顶部比分条（地图名/回合/比分/计时/炸弹状态/拆除进度）
//   Nametags       LM  —— 3D 场景中的玩家头顶名字标签（CSS2D 渲染）
//   玩家面板常量        —— 道具图标映射（被 27-player-panels 引用）
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 一、MatchHud —— 顶部比分条
// ────────────────────────────────────────────────────────────────────────────
class MatchHud {
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
  teams               // Map<label, {logoUrl, mapsWon, mapsToWin}>
  defuseCue
  defuseCueTime
  defuseCueName
  defuseCueMessage
  defuseCueRing
  defuseCueIcon
  lastDefuseKey = ``

  constructor(container, teams) {
    this.teams = teams
    let root = document.createElement(`div`)
    root.className = `hud`
    root.innerHTML = `
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
    `
    container.appendChild(root)
    this.root = root
    this.mapEl = root.querySelector(`.hud-map`)
    this.roundEl = root.querySelector(`.hud-round`)
    this.scorebarEl = root.querySelector(`.scorebar`)
    this.tScoreEl = root.querySelector(`.sb-t-score`)
    this.ctScoreEl = root.querySelector(`.sb-ct-score`)
    this.tLabelEl = root.querySelector(`.sb-t-label`)
    this.ctLabelEl = root.querySelector(`.sb-ct-label`)
    this.timerEl = root.querySelector(`.sb-timer`)
    this.roundNumEl = root.querySelector(`.sb-round`)
    this.bombEl = root.querySelector(`.sb-bomb`)
    this.statusEl = root.querySelector(`.sb-status`)
    this.defuseEl = root.querySelector(`.sb-defuse`)
    this.defuseFillEl = root.querySelector(`.sb-defuse-fill`)
    this.defuseCue = root.querySelector(`.defuse-cue`)
    this.defuseCueTime = root.querySelector(`.defuse-cue-time`)
    this.defuseCueName = root.querySelector(`.defuse-cue-name`)
    this.defuseCueMessage = root.querySelector(`.defuse-cue-message`)
    this.defuseCueRing = root.querySelector(`.defuse-cue-ring`)
    this.defuseCueIcon = root.querySelector(`.defuse-cue-icon`)
  }

  setInfo(mapName, roundLabel) { this.mapEl.textContent = mapName; this.roundEl.textContent = roundLabel }

  // 供性能统计面板定位用
  getScorebarBounds() { return this.scorebarEl.hidden ? null : this.scorebarEl.getBoundingClientRect() }

  // 拆除提示（大号倒计时 + 进度环）
  setDefuseCue(defuse, slot, name) {
    if (!defuse || slot < 0 || defuse.defuserSlot !== slot) {
      this.defuseCue.hidden = true
      this.lastDefuseKey = ``
      return
    }
    let percent = (defuse.progress * 100).toFixed(1)
    let remainingMs = defuse.remainingSeconds > 0 ? Math.max(1, Math.round(defuse.remainingSeconds * 1000)) : 0
    let mm = String(Math.floor(remainingMs / 60000)).padStart(2, `0`)
    let ss = String(Math.floor(remainingMs / 1000) % 60).padStart(2, `0`)
    let ms = String(remainingMs % 1000).padStart(3, `0`)
    let key = `${slot}|${name}|${defuse.hasKit}|${defuse.progress}|${remainingMs}`
    if (key === this.lastDefuseKey) return
    this.lastDefuseKey = key
    this.defuseCue.hidden = false
    this.defuseCueTime.textContent = `${mm}:${ss}.${ms}`
    this.defuseCueName.textContent = name
    this.defuseCueMessage.textContent = ` is defusing the bomb ${defuse.hasKit ? `with` : `without`} a kit.`
    let iconUrl = `url(${Zb(defuse.hasKit ? `defuser` : `c4`)})`
    this.defuseCueIcon.style.maskImage = iconUrl
    this.defuseCueIcon.style.webkitMaskImage = iconUrl
    this.defuseCueRing.style.setProperty(`--defuse-remaining`, String((1 - defuse.progress) * 100))
    this.defuseCueRing.setAttribute(`aria-valuenow`, percent)
    this.defuseCueRing.setAttribute(`aria-valuetext`, `${(remainingMs / 1000).toFixed(3)} seconds remaining${defuse.hasKit ? `, with kit` : `, no kit`}`)
  }

  // 更新整个比分条（diff key 避免不必要重绘）
  setMatchState(state) {
    let defusePct = state.defusing ? Math.round(state.defuseProgress * 100) : 0
    let key = `${state.tLabel}|${state.tScore}|${state.ctLabel}|${state.ctScore}|${state.timeoutSide}|${state.technicalTimeout}|${state.timeoutTimeText}|${state.round}|${state.timeText}|${state.phase}|${state.planted}|${state.site}|${state.defusing}|${state.defuseHasKit}|${defusePct}`
    if (key === this.lastMatchKey) return
    this.lastMatchKey = key
    if (this.scorebarEl.hidden) this.scorebarEl.hidden = false
    if (state.tLabel !== this.lastTLabel) { this.setTeamLabel(this.tLabelEl, state.tLabel); this.lastTLabel = state.tLabel }
    if (state.ctLabel !== this.lastCtLabel) { this.setTeamLabel(this.ctLabelEl, state.ctLabel); this.lastCtLabel = state.ctLabel }
    this.tScoreEl.textContent = String(state.tScore)
    this.ctScoreEl.textContent = String(state.ctScore)
    this.timerEl.textContent = state.timeText
    this.timerEl.classList.toggle(`sb-timer-bomb`, state.planted)
    this.roundNumEl.textContent = state.round > 0 ? `Round ${state.round}` : `Warmup`
    this.setStatus(state)
  }

  setTeamLabel(el, label) {
    let team = this.teams?.get(label)
    let logoUrl = team?.logoUrl
    let hasSeries = team?.mapsToWin !== undefined && team.mapsWon !== undefined
    el.title = label
    el.classList.toggle(`sb-label-logo`, !!logoUrl)
    el.classList.toggle(`sb-label-series`, hasSeries)
    if (logoUrl) el.replaceChildren(createHostedLogo(logoUrl, label, `sb-logo`, { fallbackText: label, invertWhite: true }))
    else el.textContent = label
    // 系列赛地图胜场点（BO3/BO5）
    if (team?.mapsToWin !== undefined && team.mapsWon !== undefined) {
      let wins = document.createElement(`span`)
      wins.className = `sb-map-wins`
      wins.setAttribute(`role`, `img`)
      wins.setAttribute(`aria-label`, `${label}: ${team.mapsWon} maps won; ${team.mapsToWin} needed to win the series`)
      wins.title = `${team.mapsWon} / ${team.mapsToWin} maps won`
      for (let i = 0; i < team.mapsToWin; i++) {
        let dot = document.createElement(`span`)
        dot.className = `sb-map-win${i < team.mapsWon ? ` is-won` : ``}`
        dot.setAttribute(`aria-hidden`, `true`)
        wins.appendChild(dot)
      }
      el.appendChild(wins)
    }
  }

  setStatus(state) {
    let isTimeout = state.technicalTimeout || state.timeoutSide !== undefined
    let show = isTimeout || state.defusing || state.planted
    this.statusEl.hidden = !show
    if (!show) return
    if (isTimeout) {
      this.bombEl.textContent = `${state.technicalTimeout ? `TECHNICAL PAUSE` : `${state.timeoutSide?.toUpperCase()} TIMEOUT`} ${state.timeoutTimeText}`
      this.bombEl.className = `sb-bomb sb-timeout${state.timeoutSide ? ` sb-timeout-${state.timeoutSide}` : ``}`
      this.defuseEl.style.visibility = `hidden`
    } else if (state.defusing) {
      this.bombEl.textContent = state.defuseHasKit ? `DEFUSING (KIT)` : `DEFUSING`
      this.bombEl.className = `sb-bomb sb-bomb-defuse`
      this.defuseEl.style.visibility = `visible`
      this.defuseFillEl.style.width = `${Math.round(state.defuseProgress * 100)}%`
    } else {
      this.bombEl.textContent = state.site ? `◉ ${state.site}` : `◉ PLANTED`
      this.bombEl.className = `sb-bomb sb-bomb-planted`
      this.defuseEl.style.visibility = `hidden`
    }
  }

  dispose() { this.root.remove() }
}

// ────────────────────────────────────────────────────────────────────────────
// 二、Nametags —— 3D 玩家头顶名字标签
//     用独立的 CSS2D 渲染器，将 HTML 标签钉在玩家头顶位置。
//     显示：名字、血条、武器图标、装备（C4/拆弹器）、被闪光致盲图标。
// ────────────────────────────────────────────────────────────────────────────
const NAMETAG_HEIGHT = 76        // 名字悬浮高度（世界单位）
const NAMETAG_DUCK_DROP = 18     // 蹲下时下降量
const PLAYER_COLORS = { blue: `#88cef5`, green: `#1da284`, yellow: `#f8f62d`, orange: `#ff9b25`, purple: `#c03699` }
const C4_ICON_URL = Zb(`c4`)
const DEFUSER_ICON_URL = Zb(`defuser`)

class Nametags {
  renderer
  scene
  players
  labels = []

  constructor(container, scene, players) {
    this.scene = scene
    this.players = players
    this.renderer = new Mb()   // CSS2DRenderer
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.domElement.className = `nametag-layer`
    container.appendChild(this.renderer.domElement)

    let flashIconUrl = Zb(`blind_kill`)
    for (let player of players) {
      let root = document.createElement(`div`)
      root.className = `nametag`
      let icons = document.createElement(`div`)
      icons.className = `nametag-icons`
      let equipIcon = makeNametagIcon()
      let weaponIcon = makeNametagIcon()
      icons.append(equipIcon, weaponIcon)
      let nameEl = document.createElement(`div`)
      nameEl.className = `nametag-name`
      let nameSpan = document.createElement(`span`)
      nameSpan.textContent = player.name || `unknown`
      let flashIcon = document.createElement(`span`)
      flashIcon.className = `nametag-flash-icon`
      setMaskIcon(flashIcon, flashIconUrl)
      flashIcon.hidden = true
      nameEl.append(nameSpan, flashIcon)
      let hpEl = document.createElement(`div`)
      hpEl.className = `nametag-hp`
      let arrowEl = document.createElement(`div`)
      arrowEl.className = `nametag-arrow`
      root.append(icons, nameEl, hpEl, arrowEl)

      let object = new Eb(root)   // CSS2DObject
      object.center.set(0.5, 1)
      object.visible = false
      scene.add(object)
      this.labels.push({
        object, root, equip: equipIcon, weapon: weaponIcon, hp: hpEl, flash: flashIcon,
        color: ``, compact: false, health: -1, equipUrl: null, weaponUrl: null, flashOpacity: 0,
      })
    }
  }

  update(buffers, followedSlot, showTeam = -1, occluded, context) {
    let count = this.labels.length
    let compact = followedSlot >= 0
    for (let i = 0; i < count; i++) {
      let label = this.labels[i]
      let visible = buffers.alive[i] === 1 && i !== followedSlot && occluded?.[i] !== 1
      if (visible && compact && buffers.team[i] !== showTeam) visible = false
      label.object.visible = visible
      if (!visible) continue

      label.object.position.set(buffers.x[i], buffers.y[i], buffers.z[i] + NAMETAG_HEIGHT - NAMETAG_DUCK_DROP * buffers.duck[i])

      let color = playerColor(this.players[i]?.color, buffers.team[i])
      if (color !== label.color) { label.color = color; label.root.style.setProperty(`--player-color`, color) }
      if (compact !== label.compact) { label.compact = compact; label.root.classList.toggle(`nametag--compact`, compact) }

      // 闪光致盲图标（按 alpha 淡入）
      let flash = zk(buffers.flash[i], buffers.flashAlpha[i])
      let flashOpacity = flash > 0 ? Math.round((0.65 + flash * 0.35) * 20) / 20 : 0
      if (flashOpacity !== label.flashOpacity) {
        label.flashOpacity = flashOpacity
        label.flash.hidden = flashOpacity === 0
        if (flashOpacity > 0) label.flash.style.opacity = String(flashOpacity)
      }
      if (compact) continue

      let health = buffers.health[i]
      if (health !== label.health) { label.health = health; label.hp.textContent = `${health}%` }

      // 武器 + 装备（C4/拆弹器）图标
      let equipUrl = null
      let weaponUrl = null
      if (context) {
        let idx = context.frame * count + i
        weaponUrl = weaponIconUrl(context.weaponNames[context.panelFrames.activeWeapon[idx]])
        if (context.bombCarrier === i) equipUrl = C4_ICON_URL
        else if (buffers.team[i] === 3 && (context.panelFrames.flags[idx] & 2) == 2) equipUrl = DEFUSER_ICON_URL
        if (equipUrl === weaponUrl) equipUrl = null
      }
      if (equipUrl !== label.equipUrl) { label.equipUrl = equipUrl; setOptionalIcon(label.equip, equipUrl) }
      if (weaponUrl !== label.weaponUrl) { label.weaponUrl = weaponUrl; setOptionalIcon(label.weapon, weaponUrl) }
    }
  }

  render(camera) { this.renderer.render(this.scene, camera) }
  resize(w, h) { this.renderer.setSize(w, h) }
  dispose() { for (let label of this.labels) this.scene.remove(label.object); this.renderer.domElement.remove() }
}

function makeNametagIcon() { let el = document.createElement(`span`); el.className = `nametag-icon`; el.hidden = true; return el }
function setMaskIcon(el, url) { el.style.maskImage = `url(${url})`; el.style.webkitMaskImage = `url(${url})` }
function setOptionalIcon(el, url) { el.hidden = url === null; if (url !== null) setMaskIcon(el, url) }
function playerColor(color, team) { return color ? PLAYER_COLORS[color] : team === 2 ? `#e0a526` : team === 3 ? `#6db3f2` : `#aaaaaa` }

// ────────────────────────────────────────────────────────────────────────────
// 三、玩家面板常量（被 27-player-panels 引用）
// ────────────────────────────────────────────────────────────────────────────
const UTIL_ORDER = [`smoke`, `flash`, `he`, `molotov`]
const UTIL_ICON_IDS = [`smoke`, `flash`, `he`, `molotov`]
