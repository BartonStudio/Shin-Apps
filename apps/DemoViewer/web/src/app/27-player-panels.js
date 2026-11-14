// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 45385–45563 行（切片 28/34）
// 角色：玩家面板 KM：pp/pp-defuse-meter
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var KM = class {
  leftEls = []
  rightEls = []
  leftRoot
  rightRoot
  onSelect
  constructor(e, t) {
    this.onSelect = t
    let n = document.createElement(`div`)
    n.className = `player-panels player-panels-left`
    let r = document.createElement(`div`)
    ;((r.className = `player-panels player-panels-right`),
      e.appendChild(n),
      e.appendChild(r),
      (this.leftRoot = n),
      (this.rightRoot = r))
    for (let e = 0; e < HM; e++) (this.leftEls.push(this.createPanel(n)), this.rightEls.push(this.createPanel(r)))
  }
  update(e, t) {
    ;(this.renderSide(this.leftEls, e), this.renderSide(this.rightEls, t))
  }
  dispose() {
    ;(this.leftRoot.remove(), this.rightRoot.remove())
  }
  createPanel(e) {
    let t = document.createElement(`div`)
    ;((t.className = `pp`), (t.style.display = `none`))
    let n = { root: t, key: ``, slot: -1, alive: !1, health: 0, armor: 0, defuseMeter: null }
    return (
      t.addEventListener(`click`, () => {
        n.alive && n.slot >= 0 && this.onSelect(n.slot)
      }),
      e.appendChild(t),
      n
    )
  }
  renderSide(e, t) {
    for (let n = 0; n < HM; n++) {
      let r = e[n],
        i = t[n]
      if (!i) {
        ;((r.slot = -1), (r.alive = !1), r.key !== `` && ((r.key = ``), (r.root.style.display = `none`)))
        continue
      }
      let a = r.slot === i.slot && r.key !== ``
      ;((r.slot = i.slot), (r.alive = i.alive))
      let o = qM(i)
      if (o !== r.key) {
        ;((r.key = o), (r.root.style.display = ``))
        let e = YM(i.health),
          t = i.alive ? YM(i.armor) : 0
        ;(JM(r.root, i, a ? r.health : e, a ? r.armor : t),
          (r.health = e),
          (r.armor = t),
          (r.defuseMeter = r.root.querySelector(`.pp-defuse-meter`)))
      }
      r.defuseMeter && i.defuseProgress !== null
        ? (r.root.style.setProperty(`--defuse-progress`, String(i.defuseProgress)),
          r.defuseMeter.setAttribute(`aria-valuenow`, (i.defuseProgress * 100).toFixed(1)))
        : r.root.style.removeProperty(`--defuse-progress`)
    }
  }
}
function qM(e) {
  return [
    e.slot,
    e.team,
    +!!e.alive,
    e.health,
    e.armor,
    +!!e.helmet,
    +!!e.defuser,
    e.alive && e.defuseProgress !== null ? 1 : 0,
    e.money,
    e.weapon,
    e.util.join(``),
    e.kills,
    e.deaths,
    +!!e.followed,
  ].join(`|`)
}
function JM(e, t, n, r) {
  let i = t.team === 2 ? `pp-t` : t.team === 3 ? `pp-ct` : ``,
    a = t.alive && t.defuseProgress !== null
  e.className = `pp ${i}${t.alive ? `` : ` pp-dead`}${t.followed ? ` pp-followed` : ``}${a ? ` pp-defuse-active` : ``}`
  let o = t.util
      .map((e, t) =>
        e <= 0 ? `` : Array.from({ length: e }, () => GM(qb[UM[t]], `pp-util-ic pp-util-${WM[t]}`)).join(``),
      )
      .join(``),
    s = t.alive ? Xb(t.weapon) : null,
    c = s
      ? `<span class="pp-weapon-ic" style="-webkit-mask-image:url(${s});mask-image:url(${s})"></span>`
      : t.alive && t.weapon
        ? `<span class="pp-weapon">${ZM(XM(t.weapon))}</span>`
        : ``,
    l = YM(t.health),
    u = t.alive ? YM(t.armor) : 0,
    d = u > 0 ? `Armor ${u}${t.helmet ? ` + helmet` : ``}` : `No armor`,
    f =
      t.alive && t.team === 3 && t.defuser
        ? `<span class="pp-kit" title="Defuse kit" aria-label="Defuse kit">${GM(Jb.defuser, `pp-gear-ic pp-defuser-ic`)}</span>`
        : ``,
    p = a
      ? `<div class="pp-defuse-meter" role="progressbar" aria-label="${ZM(t.name)} defusing the bomb" aria-valuemin="0" aria-valuemax="100">
        ${GM(Jb.defuser, `pp-defuse-icon`)}
        <div class="pp-defuse-fill">${GM(Jb.defuser, `pp-defuse-icon pp-defuse-icon-filled`)}</div>
      </div>`
      : ``,
    m = l <= 20 ? ` pp-hp-low` : l <= 50 ? ` pp-hp-mid` : ``,
    h = Math.max(n, l),
    g = `
    <div class="pp-line pp-top">
      <span class="pp-name">${ZM(t.name)}</span>
      <span class="pp-kd" title="${t.kills} kills, ${t.deaths} deaths">
        <span class="pp-kd-stat pp-kd-kills">${GM(`crosshair`, `pp-kd-ic`)}<span class="pp-kd-n">${t.kills}</span></span>
        <span class="pp-kd-stat pp-kd-deaths">${GM(`skull`, `pp-kd-ic`)}<span class="pp-kd-n">${t.deaths}</span></span>
      </span>
    </div>
    <div class="pp-line pp-gear">
      ${c}
      <span class="pp-util-list">${f}${o}</span>
      <span class="pp-money">$${t.money.toLocaleString(`en-US`)}</span>
    </div>
    <div class="pp-line pp-status${m}">
      <span class="pp-hp" title="Health ${l}">${l}</span>
      <span class="pp-bars" aria-hidden="true">
        <span class="pp-bar pp-hp-bar" title="Health ${l}">
          <span class="pp-hp-trail" style="--from:${h}%;width:${l}%"></span>
          <span class="pp-hp-fill" style="--from:${n}%;width:${l}%"></span>
        </span>
        <span class="pp-bar pp-armor-bar${t.helmet ? ` pp-helmet` : ``}" title="${d}">
          <span class="pp-armor-fill" style="--from:${r}%;width:${u}%"></span>
        </span>
      </span>
    </div>
  `
  e.innerHTML = `
    ${p}
    <div class="pp-body" aria-label="${ZM(t.name)}: ${l} health, ${u} armor${u > 0 && t.helmet ? ` with helmet` : ``}">${g}</div>
    ${a ? `<div class="pp-defuse-content" aria-hidden="true">${g}</div>` : ``}
  `
}
function YM(e) {
  return Math.max(0, Math.min(100, Math.round(e)))
}
function XM(e) {
  return e.replace(/^weapon_/, ``)
}
function ZM(e) {
  return e.replace(/[&<>"']/g, (e) => ({ "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` })[e])
}
var QM = 320,
  $M = 160,
  eN = 480,
  tN = 16,
  nN = 5,
  rN = 100,
  iN = 0.16,
  aN = Math.PI / 180,
  oN = `#e0a526`,
  sN = `#6db3f2`,
  cN = `#9aa3b2`,
  lN = new Map()
async function uN(e) {
  let t = await S_(e)
  t && (await Promise.all(t.sections.map((e) => dN(e.file))))
}
function dN(e) {
  let t = lN.get(e)
  if (t) return t
  let n = new Promise((t, n) => {
    let r = new Image()
    ;((r.onload = () => t()), (r.onerror = () => n(Error(`radar image load failed (${e})`))), (r.src = e))
  }).catch((t) => {
    throw (lN.delete(e), t)
  })
  return (lN.set(e, n), n)
}
