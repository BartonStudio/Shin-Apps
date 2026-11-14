// ============================================================================
// 27-player-panels.deobf.js —— 侧边玩家面板 + 雷达常量 + 雷达图预加载
// 来源：src/app/27-player-panels.js（Vite 生产构建，prettier 展开版）
// 原始标识符已语义化重命名 + 补充中文注释。
//
// 包含：
//   PlayerPanels  KM  —— 左右两侧玩家信息面板（血条/护甲/武器/道具/经济/拆除进度）
//   雷达渲染常量         —— 尺寸/颜色/角度（被 28-radar 的 Radar 类引用）
//   雷达图预加载         —— 提前加载雷达分段图片
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 一、PlayerPanels —— 侧边玩家面板
//     左右各最多 5 个面板（T 左 CT 右），显示每名玩家的生命/护甲/武器/道具/经济/K-D。
//     通过"diff key"避免不必要的 DOM 重建（只有数据变化才重写面板）。
// ────────────────────────────────────────────────────────────────────────────
const MAX_PANELS_PER_SIDE = 5

class PlayerPanels {
  leftEls = []
  rightEls = []
  leftRoot
  rightRoot
  onSelect

  constructor(container, onSelect) {
    this.onSelect = onSelect
    let leftRoot = document.createElement(`div`)
    leftRoot.className = `player-panels player-panels-left`
    let rightRoot = document.createElement(`div`)
    rightRoot.className = `player-panels player-panels-right`
    container.appendChild(leftRoot)
    container.appendChild(rightRoot)
    this.leftRoot = leftRoot
    this.rightRoot = rightRoot
    for (let i = 0; i < MAX_PANELS_PER_SIDE; i++) {
      this.leftEls.push(this.createPanel(leftRoot))
      this.rightEls.push(this.createPanel(rightRoot))
    }
  }

  update(tRows, ctRows) {
    this.renderSide(this.leftEls, tRows)
    this.renderSide(this.rightEls, ctRows)
  }

  dispose() { this.leftRoot.remove(); this.rightRoot.remove() }

  createPanel(parent) {
    let el = document.createElement(`div`)
    el.className = `pp`
    el.style.display = `none`
    let state = { root: el, key: ``, slot: -1, alive: false, health: 0, armor: 0, defuseMeter: null }
    el.addEventListener(`click`, () => { if (state.alive && state.slot >= 0) this.onSelect(state.slot) })
    parent.appendChild(el)
    return state
  }

  renderSide(els, rows) {
    for (let i = 0; i < MAX_PANELS_PER_SIDE; i++) {
      let state = els[i]
      let row = rows[i]
      if (!row) {
        state.slot = -1
        state.alive = false
        if (state.key !== ``) { state.key = ``; state.root.style.display = `none` }
        continue
      }
      let animated = state.slot === row.slot && state.key !== ``   // 同一玩家，允许血条/护甲动画
      state.slot = row.slot
      state.alive = row.alive
      let key = panelKey(row)
      if (key !== state.key) {
        state.key = key
        state.root.style.display = ``
        let health = clamp100(row.health)
        let armor = row.alive ? clamp100(row.armor) : 0
        renderPanelHtml(state.root, row, animated ? state.health : health, animated ? state.armor : armor)
        state.health = health
        state.armor = armor
        state.defuseMeter = state.root.querySelector(`.pp-defuse-meter`)
      }
      // 拆除进度条（实时更新，不重建 DOM）
      if (state.defuseMeter && row.defuseProgress !== null) {
        state.root.style.setProperty(`--defuse-progress`, String(row.defuseProgress))
        state.defuseMeter.setAttribute(`aria-valuenow`, (row.defuseProgress * 100).toFixed(1))
      } else {
        state.root.style.removeProperty(`--defuse-progress`)
      }
    }
  }
}

// 计算面板 diff key：任何数据变化都会导致 key 变化，触发重建
function panelKey(row) {
  return [
    row.slot, row.team, +!!row.alive, row.health, row.armor, +!!row.helmet, +!!row.defuser,
    row.alive && row.defuseProgress !== null ? 1 : 0,
    row.money, row.weapon, row.util.join(``), row.kills, row.deaths, +!!row.followed,
  ].join(`|`)
}

// 渲染单个面板的完整 HTML（含血条动画的 from 值）
function renderPanelHtml(root, row, fromHealth, fromArmor) {
  let teamCls = row.team === 2 ? `pp-t` : row.team === 3 ? `pp-ct` : ``
  let defusing = row.alive && row.defuseProgress !== null
  root.className = `pp ${teamCls}${row.alive ? `` : ` pp-dead`}${row.followed ? ` pp-followed` : ``}${defusing ? ` pp-defuse-active` : ``}`

  // 道具图标（烟雾/闪光/高爆/燃烧弹，数量决定图标个数）
  let utilHtml = row.util
    .map((count, i) => count <= 0 ? `` : Array.from({ length: count }, () => utilIcon(UTIL_ICON_IDS[UTIL_ORDER[i]], `pp-util-ic pp-util-${UTIL_ORDER[i]}`)).join(``))
    .join(``)

  let weaponIcon = row.alive ? weaponIconUrl(row.weapon) : null
  let weaponHtml = weaponIcon
    ? `<span class="pp-weapon-ic" style="-webkit-mask-image:url(${weaponIcon});mask-image:url(${weaponIcon})"></span>`
    : row.alive && row.weapon
      ? `<span class="pp-weapon">${escapeHtml(stripWeaponPrefix(row.weapon))}</span>`
      : ``

  let health = clamp100(row.health)
  let armor = row.alive ? clamp100(row.armor) : 0
  let armorTitle = armor > 0 ? `Armor ${armor}${row.helmet ? ` + helmet` : ``}` : `No armor`

  // 拆弹器图标（CT 且持有）
  let kitHtml = row.alive && row.team === 3 && row.defuser
    ? `<span class="pp-kit" title="Defuse kit" aria-label="Defuse kit">${utilIcon(DEFUSER_ICON, `pp-gear-ic pp-defuser-ic`)}</span>`
    : ``

  // 拆除进度条
  let defuseHtml = defusing
    ? `<div class="pp-defuse-meter" role="progressbar" aria-label="${escapeHtml(row.name)} defusing the bomb" aria-valuemin="0" aria-valuemax="100">
        ${utilIcon(DEFUSER_ICON, `pp-defuse-icon`)}
        <div class="pp-defuse-fill">${utilIcon(DEFUSER_ICON, `pp-defuse-icon pp-defuse-icon-filled`)}</div>
      </div>`
    : ``

  let hpCls = health <= 20 ? ` pp-hp-low` : health <= 50 ? ` pp-hp-mid` : ``
  let fromHealthMax = Math.max(fromHealth, health)

  let body = `
    <div class="pp-line pp-top">
      <span class="pp-name">${escapeHtml(row.name)}</span>
      <span class="pp-kd" title="${row.kills} kills, ${row.deaths} deaths">
        <span class="pp-kd-stat pp-kd-kills">${utilIcon(CROSSHAIR_ICON, `pp-kd-ic`)}<span class="pp-kd-n">${row.kills}</span></span>
        <span class="pp-kd-stat pp-kd-deaths">${utilIcon(SKULL_ICON, `pp-kd-ic`)}<span class="pp-kd-n">${row.deaths}</span></span>
      </span>
    </div>
    <div class="pp-line pp-gear">
      ${weaponHtml}
      <span class="pp-util-list">${kitHtml}${utilHtml}</span>
      <span class="pp-money">$${row.money.toLocaleString(`en-US`)}</span>
    </div>
    <div class="pp-line pp-status${hpCls}">
      <span class="pp-hp" title="Health ${health}">${health}</span>
      <span class="pp-bars" aria-hidden="true">
        <span class="pp-bar pp-hp-bar" title="Health ${health}">
          <span class="pp-hp-trail" style="--from:${fromHealthMax}%;width:${health}%"></span>
          <span class="pp-hp-fill" style="--from:${fromHealth}%;width:${health}%"></span>
        </span>
        <span class="pp-bar pp-armor-bar${row.helmet ? ` pp-helmet` : ``}" title="${armorTitle}">
          <span class="pp-armor-fill" style="--from:${fromArmor}%;width:${armor}%"></span>
        </span>
      </span>
    </div>
  `

  root.innerHTML = `
    ${defuseHtml}
    <div class="pp-body" aria-label="${escapeHtml(row.name)}: ${health} health, ${armor} armor${armor > 0 && row.helmet ? ` with helmet` : ``}">${body}</div>
    ${defusing ? `<div class="pp-defuse-content" aria-hidden="true">${body}</div>` : ``}
  `
}

function clamp100(v) { return Math.max(0, Math.min(100, Math.round(v))) }
function stripWeaponPrefix(weapon) { return weapon.replace(/^weapon_/, ``) }
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` })[c]) }
function utilIcon(url, cls) { return `<span class="pp-ic ${cls}" style="-webkit-mask-image:url(${url});mask-image:url(${url})"></span>` }

// ────────────────────────────────────────────────────────────────────────────
// 二、雷达渲染常量（被 28-radar 的 Radar 类引用）
// ────────────────────────────────────────────────────────────────────────────
const RADAR_DEFAULT_SIZE = 320   // 默认边长（逻辑像素）
const RADAR_MIN_SIZE = 160
const RADAR_MAX_SIZE = 480
const RADAR_MARGIN = 16          // 图片内缩边距（px）
const RADAR_DOT_RADIUS = 5       // 玩家点半径
const RADAR_FOV_DEG = 100        // 视野锥角度（度）
const RADAR_FOV_SCALE = 0.16     // 视野锥半径占雷达尺寸比例
const DEG_TO_RAD = Math.PI / 180
const RADAR_COLOR_T = `#e0a526`   // 黄色（T）
const RADAR_COLOR_CT = `#6db3f2`  // 蓝色（CT）
const RADAR_COLOR_SPEC = `#9aa3b2` // 灰色（观战/未知）

// 雷达图预加载缓存
const radarImageCache = new Map()

// 预加载某地图的所有雷达分段图片
async function preloadRadarImages(mapName) {
  let mapping = await loadRadarMapping(mapName)   // S_ = 雷达元数据加载
  if (mapping) await Promise.all(mapping.sections.map((s) => preloadRadarImage(s.file)))
}

// 加载单张雷达图（带缓存去重）
function preloadRadarImage(file) {
  let cached = radarImageCache.get(file)
  if (cached) return cached
  let promise = new Promise((resolve, reject) => {
    let img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(Error(`radar image load failed (${file})`))
    img.src = file
  }).catch((e) => { radarImageCache.delete(file); throw e })
  radarImageCache.set(file, promise)
  return promise
}
