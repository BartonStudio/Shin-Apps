// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 43247–43602 行（切片 30/40）
// 角色：死亡淡入叠加 oj：death-fade-*
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var oj = class {
  element
  heading
  detail
  damageTaken
  damageDealt
  victimPovButton
  killerPovButton
  currentDeath = null
  killerReplayAvailable = !1
  active = !1
  teamAtTick
  constructor(e, t, n) {
    ;((this.teamAtTick = n),
      (this.element = document.createElement(`div`)),
      (this.element.className = `death-fade-overlay`),
      this.element.setAttribute(`aria-hidden`, `true`),
      (this.element.innerHTML = `
      <div class="death-fade-backdrop"></div>
      <div class="death-fade-label">
        <div class="death-fade-kill">
          <div class="death-fade-heading"></div>
          <div class="death-fade-detail"></div>
        </div>
        <div class="death-fade-combat">
          <section class="death-fade-damage">
            <div class="death-fade-damage-heading">Damage taken</div>
            <div class="death-fade-damage-taken"></div>
          </section>
          <section class="death-fade-damage">
            <div class="death-fade-damage-heading">Damage dealt</div>
            <div class="death-fade-damage-dealt"></div>
          </section>
        </div>
        <div class="death-fade-actions">
          <div class="death-fade-action-group">
            <button class="death-fade-action death-fade-victim-pov" type="button">Replay</button>
            <button class="death-fade-action death-fade-killer-pov" type="button">See kill</button>
          </div>
        </div>
      </div>
    `),
      (this.heading = this.element.querySelector(`.death-fade-heading`)),
      (this.detail = this.element.querySelector(`.death-fade-detail`)),
      (this.damageTaken = this.element.querySelector(`.death-fade-damage-taken`)),
      (this.damageDealt = this.element.querySelector(`.death-fade-damage-dealt`)),
      (this.victimPovButton = this.element.querySelector(`.death-fade-victim-pov`)),
      (this.killerPovButton = this.element.querySelector(`.death-fade-killer-pov`)),
      this.victimPovButton.addEventListener(`click`, (e) => {
        ;(e.stopPropagation(), this.currentDeath && t(this.currentDeath, `victim`))
      }),
      this.killerPovButton.addEventListener(`click`, (e) => {
        ;(e.stopPropagation(), this.currentDeath && this.killerReplayAvailable && t(this.currentDeath, `killer`))
      }),
      e.appendChild(this.element))
  }
  show(e, t, n, r) {
    let i = e.attackerSlot !== void 0 && e.attackerSlot === e.victimSlot,
      a = e.weapon === `world` || e.attackerSlot === void 0
    if (
      ((this.currentDeath = e),
      (this.killerReplayAvailable = !a && !i),
      (this.killerPovButton.hidden = !this.killerReplayAvailable),
      i)
    )
      this.heading.textContent = `${e.victimName ?? `Player`} died by suicide`
    else if (a) this.heading.textContent = `${e.victimName ?? `Player`} was killed by the world`
    else {
      let t = document.createElement(`span`)
      ;((t.className = `death-fade-player`),
        (t.textContent = e.attackerName ?? `Player`),
        this.setTeam(t, e.attackerSlot, e.tick),
        this.heading.replaceChildren(`Killed by `, t))
    }
    this.renderDetail(e, a || i)
    let o = e.victimSlot,
      s = o === void 0 ? { taken: [], dealt: [] } : sj(t, o, r, e.tick)
    ;(this.renderDamage(this.damageTaken, s.taken, n, e.tick, `No damage taken`),
      this.renderDamage(this.damageDealt, s.dealt, n, e.tick),
      this.setActive(!0))
  }
  setActive(e) {
    ;((this.victimPovButton.disabled = !e || this.currentDeath?.victimSlot === void 0),
      (this.killerPovButton.disabled = !e || !this.killerReplayAvailable),
      e !== this.active &&
        ((this.active = e),
        this.element.classList.toggle(`is-active`, e),
        this.element.setAttribute(`aria-hidden`, String(!e))))
  }
  dispose() {
    this.element.remove()
  }
  renderDetail(e, t) {
    this.detail.replaceChildren()
    let n = e.weapon,
      r = t ? tj : Xb(n)
    if (r) {
      let e = document.createElement(`span`)
      ;((e.className = t ? `death-fade-icon death-fade-skull` : `death-fade-icon`),
        (e.style.maskImage = `url(${r})`),
        (e.style.webkitMaskImage = `url(${r})`),
        this.detail.appendChild(e))
    }
    let i = lj(n)
    if (i) {
      let e = document.createElement(`span`)
      ;((e.className = `death-fade-weapon`), (e.textContent = i), this.detail.appendChild(e))
    }
    for (let t of ej) {
      if (!e[t.key]) continue
      let n = document.createElement(`span`)
      n.className = `death-fade-modifier`
      let r = document.createElement(`span`)
      ;((r.className = `death-fade-mod death-fade-mod-${t.key}`),
        (r.style.maskImage = `url(${t.url})`),
        (r.style.webkitMaskImage = `url(${t.url})`),
        r.setAttribute(`aria-hidden`, `true`),
        n.appendChild(r))
      let i = document.createElement(`span`)
      ;((i.textContent = t.label), n.appendChild(i), this.detail.appendChild(n))
    }
  }
  renderDamage(e, t, n, r, i) {
    if ((e.replaceChildren(), t.length === 0)) {
      if (!i) return
      let t = document.createElement(`div`)
      ;((t.className = `death-fade-damage-empty`), (t.textContent = i), e.appendChild(t))
      return
    }
    for (let i of t) {
      let t = document.createElement(`div`)
      t.className = `death-fade-damage-row`
      let a = document.createElement(`span`)
      ;((a.className = `death-fade-damage-amount`), (a.textContent = String(i.damage)))
      let o = document.createElement(`span`)
      ;((o.className = `death-fade-damage-name death-fade-player`),
        (o.textContent = n[i.slot]?.name ?? `Player ${i.slot}`),
        this.setTeam(o, i.slot, r),
        t.append(a, o),
        e.appendChild(t))
    }
  }
  setTeam(e, t, n) {
    let r = t === void 0 ? 0 : this.teamAtTick(t, n)
    e.dataset.team = r === 2 ? `t` : r === 3 ? `ct` : `unknown`
  }
}
function sj(e, t, n, r) {
  let i = new Map(),
    a = new Map()
  for (let o = 0; o < e.count; o++) {
    let s = e.tick[o]
    if (s < n) continue
    if (s > r) break
    let c = e.attackerSlot[o],
      l = e.victimSlot[o]
    c !== l && (l === t && i.set(c, (i.get(c) ?? 0) + e.dmg[o]), c === t && a.set(l, (a.get(l) ?? 0) + e.dmg[o]))
  }
  return { taken: cj(i), dealt: cj(a) }
}
function cj(e) {
  return [...e].map(([e, t]) => ({ slot: e, damage: t })).sort((e, t) => t.damage - e.damage || e.slot - t.slot)
}
function lj(e) {
  return !e || e === `world`
    ? ``
    : e
        .replace(/^weapon_/, ``)
        .replaceAll(`_`, ` `)
        .replace(/\b\w/g, (e) => e.toUpperCase())
}
var uj = 180,
  dj = class {
    element
    victimsList
    teamAtTick
    rows = []
    group = null
    hideHandle
    constructor(e, t, n, r) {
      ;((this.teamAtTick = r),
        (this.element = document.createElement(`div`)),
        (this.element.className = `kill-replay`),
        (this.element.hidden = !0),
        (this.element.inert = !0),
        this.element.setAttribute(`aria-hidden`, `true`),
        this.element.setAttribute(`role`, `group`),
        this.element.setAttribute(`aria-label`, `Kill replay`),
        (this.element.innerHTML = `
      <div class="kill-replay-victims-list" role="group" aria-label="Individual kills"></div>
    `),
        (this.victimsList = this.element.querySelector(`.kill-replay-victims-list`)),
        this.element.addEventListener(`click`, (e) => e.stopPropagation()),
        this.element.addEventListener(`keydown`, (e) => {
          ;((e.key === ` ` || e.key === `Tab`) && e.stopPropagation(), e.key === `Escape` && (e.stopPropagation(), n()))
        }),
        this.victimsList.addEventListener(`click`, (e) => {
          let n = e.target
          if (!(n instanceof HTMLButtonElement) || !this.group) return
          let r = this.group.kills[Number(n.dataset.index)]
          r && t(r, n.dataset.perspective === `victim` ? `victim` : `killer`)
        }),
        e.appendChild(this.element))
    }
    update(e, t, n) {
      if (!e) {
        this.group && ((this.group = null), this.hide())
        return
      }
      if (e !== this.group) {
        ;(e?.kills[0] !== this.group?.kills[0] && (this.victimsList.replaceChildren(), (this.rows.length = 0)),
          (this.group = e),
          this.show())
        let t = e.kills.length
        for (
          this.element.classList.toggle(`is-multi`, t > 1),
            e.kills.forEach((t, n) => {
              let r = this.rows[n] ?? this.createRow(t, n)
              ;((r.kill = t),
                (r.attackerName.textContent = t.attackerName ?? `Player`),
                (r.attackerName.title = r.attackerName.textContent),
                this.setTeam(r.attackerName, e.attackerSlot, t.tick),
                (r.victimName.textContent = t.victimName ?? `Victim ${n + 1}`),
                (r.victimName.title = r.victimName.textContent),
                (r.icons.innerHTML = rj(t)),
                t.victimSlot !== void 0 && this.setTeam(r.victimName, t.victimSlot, t.tick))
              let i = r.element.querySelector(`.kill-replay-kill-watch`),
                a = r.element.querySelector(`.kill-replay-death`)
              ;((i.title = `Replay kill ${n + 1} against ${r.victimName.textContent} from ${r.attackerName.textContent} POV`),
                (a.title = `See death ${n + 1} from ${r.victimName.textContent} POV`),
                i.setAttribute(`aria-label`, i.title),
                a.setAttribute(`aria-label`, a.title))
            });
          this.rows.length > t;
        )
          this.rows.pop().element.remove()
      }
      for (let e of this.rows) {
        let r = Eg(e.kill.tick, t, n)
        if (r === e.remainingMilliseconds) continue
        ;((e.remainingMilliseconds = r), e.element.classList.toggle(`is-upcoming`, r > 0))
        let i = (r / 1e3).toFixed(3)
        ;((e.status.textContent = r > 0 ? `${i}s` : ``),
          r > 0 ? e.status.setAttribute(`aria-label`, `Kill in ${i} seconds`) : e.status.removeAttribute(`aria-label`))
      }
    }
    dispose() {
      ;(this.cancelHide(), this.element.remove())
    }
    show() {
      this.cancelHide()
      let e = this.element.hidden
      ;((this.element.hidden = !1),
        (this.element.inert = !1),
        this.element.removeAttribute(`aria-hidden`),
        e && this.element.offsetWidth,
        this.element.classList.add(`is-visible`))
    }
    hide() {
      if (
        ((this.element.inert = !0),
        this.element.setAttribute(`aria-hidden`, `true`),
        this.element.classList.remove(`is-visible`),
        window.matchMedia(`(prefers-reduced-motion: reduce)`).matches)
      ) {
        this.finishHide()
        return
      }
      this.hideHandle = window.setTimeout(() => {
        ;((this.hideHandle = void 0), this.finishHide())
      }, uj)
    }
    finishHide() {
      ;((this.element.hidden = !0), this.victimsList.replaceChildren(), (this.rows.length = 0))
    }
    cancelHide() {
      this.hideHandle !== void 0 && (window.clearTimeout(this.hideHandle), (this.hideHandle = void 0))
    }
    createRow(e, t) {
      let n = document.createElement(`div`)
      ;((n.className = `kill-replay-row`),
        (n.innerHTML = `
      <div class="kill-replay-row-heading">
        <span class="kill-replay-name kill-replay-attacker"></span>
        <span class="kill-replay-icons"></span>
        <span class="kill-replay-name kill-replay-victim"></span>
        <span class="kill-replay-row-status" role="timer" aria-live="off"></span>
      </div>
      <div class="kill-replay-actions">
        <button class="kill-replay-action kill-replay-kill-watch" type="button">Replay</button>
        <button class="kill-replay-action kill-replay-death" type="button">See death</button>
      </div>
    `))
      for (let e of n.querySelectorAll(`button`))
        ((e.dataset.index = String(t)),
          (e.dataset.perspective = e.classList.contains(`kill-replay-death`) ? `victim` : `killer`))
      let r = {
        element: n,
        attackerName: n.querySelector(`.kill-replay-attacker`),
        victimName: n.querySelector(`.kill-replay-victim`),
        icons: n.querySelector(`.kill-replay-icons`),
        status: n.querySelector(`.kill-replay-row-status`),
        kill: e,
        remainingMilliseconds: null,
      }
      return (this.rows.push(r), this.victimsList.appendChild(n), r)
    }
    setTeam(e, t, n) {
      let r = this.teamAtTick(t, n)
      e.dataset.team = r === 2 ? `t` : r === 3 ? `ct` : `unknown`
    }
  },
  fj = [
    { key: `fps`, label: `FPS`, group: `live` },
    { key: `frameMs`, label: `Frame`, group: `live` },
    { key: `drawCalls`, label: `Draws`, group: `live` },
    { key: `triangles`, label: `Tris`, group: `live` },
    { key: `parse`, label: `Parse`, group: `demo` },
    { key: `quality`, label: `Quality`, group: `demo` },
    { key: `duration`, label: `Duration`, group: `demo` },
    { key: `tickRate`, label: `Tick`, group: `demo` },
    { key: `fileSize`, label: `Size`, group: `demo` },
  ],
  pj = `csplayer:stats`,
  mj = 120
function hj() {
  return {
    metrics: {
      fps: !0,
      frameMs: !0,
      drawCalls: !0,
      triangles: !0,
      parse: !0,
      quality: !0,
      duration: !0,
      tickRate: !0,
      fileSize: !0,
    },
  }
}
function gj() {
  let e = hj()
  try {
    let t = localStorage.getItem(pj)
    if (!t) return e
    let n = JSON.parse(t)
    return { metrics: { ...e.metrics, ...(n.metrics ?? {}) } }
  } catch {
    return e
  }
}
function _j(e) {
  try {
    localStorage.setItem(pj, JSON.stringify({ metrics: e.metrics }))
  } catch {}
}
