// ============================================================================
// 23-death-fade.deobf.js —— 死亡淡出 / 击杀回放 / 性能统计配置
// 来源：src/app/23-death-fade.js（Vite 生产构建，prettier 展开版）
// 原文范围：decompiled/index.beautified.js L43247–43602（切片 23-death-fade）
// 原始标识符已语义化重命名 + 补充中文注释。
//
// 包含三块：
//   DeathFadeOverlay  oj  —— 玩家死亡时的全屏淡入面板（显示击杀者/伤害）
//   KillReplay        dj  —— 连续击杀回放面板（列出最近多次击杀）
//   StatsConfig            —— 性能统计面板的配置读写（localStorage）
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 一、DeathFadeOverlay —— 死亡淡入面板
//     死亡瞬间显示：击杀者（或自杀/世界击杀）、武器图标、击杀修饰符（爆头/穿墙等）、
//     承伤/输出伤害明细，以及两个回放按钮（受害者视角 / 击杀者视角）。
// ────────────────────────────────────────────────────────────────────────────
class DeathFadeOverlay {
  element
  heading
  detail
  damageTaken
  damageDealt
  victimPovButton
  killerPovButton
  currentDeath = null
  killerReplayAvailable = false
  active = false
  teamAtTick          // (slot, tick) => team 回调

  constructor(container, onReplay, teamAtTick) {
    this.teamAtTick = teamAtTick
    this.element = document.createElement(`div`)
    this.element.className = `death-fade-overlay`
    this.element.setAttribute(`aria-hidden`, `true`)
    this.element.innerHTML = `
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
    `
    this.heading = this.element.querySelector(`.death-fade-heading`)
    this.detail = this.element.querySelector(`.death-fade-detail`)
    this.damageTaken = this.element.querySelector(`.death-fade-damage-taken`)
    this.damageDealt = this.element.querySelector(`.death-fade-damage-dealt`)
    this.victimPovButton = this.element.querySelector(`.death-fade-victim-pov`)
    this.killerPovButton = this.element.querySelector(`.death-fade-killer-pov`)
    this.victimPovButton.addEventListener(`click`, (e) => {
      e.stopPropagation()
      if (this.currentDeath) onReplay(this.currentDeath, `victim`)
    })
    this.killerPovButton.addEventListener(`click`, (e) => {
      e.stopPropagation()
      if (this.currentDeath && this.killerReplayAvailable) onReplay(this.currentDeath, `killer`)
    })
    container.appendChild(this.element)
  }

  show(death, damageData, players, roundStartTick) {
    let isSuicide = death.attackerSlot !== undefined && death.attackerSlot === death.victimSlot
    let isWorld = death.weapon === `world` || death.attackerSlot === undefined
    this.currentDeath = death
    this.killerReplayAvailable = !isWorld && !isSuicide
    this.killerPovButton.hidden = !this.killerReplayAvailable

    if (isSuicide) this.heading.textContent = `${death.victimName ?? `Player`} died by suicide`
    else if (isWorld) this.heading.textContent = `${death.victimName ?? `Player`} was killed by the world`
    else {
      let attackerEl = document.createElement(`span`)
      attackerEl.className = `death-fade-player`
      attackerEl.textContent = death.attackerName ?? `Player`
      this.setTeam(attackerEl, death.attackerSlot, death.tick)
      this.heading.replaceChildren(`Killed by `, attackerEl)
    }

    this.renderDetail(death, isWorld || isSuicide)
    let victimSlot = death.victimSlot
    let damage = victimSlot === undefined
      ? { taken: [], dealt: [] }
      : computeDamageSummary(damageData, victimSlot, roundStartTick, death.tick)
    this.renderDamage(this.damageTaken, damage.taken, players, death.tick, `No damage taken`)
    this.renderDamage(this.damageDealt, damage.dealt, players, death.tick)
    this.setActive(true)
  }

  setActive(active) {
    this.victimPovButton.disabled = !active || this.currentDeath?.victimSlot === undefined
    this.killerPovButton.disabled = !active || !this.killerReplayAvailable
    if (active !== this.active) {
      this.active = active
      this.element.classList.toggle(`is-active`, active)
      this.element.setAttribute(`aria-hidden`, String(!active))
    }
  }

  dispose() { this.element.remove() }

  renderDetail(death, isWorld) {
    this.detail.replaceChildren()
    let weapon = death.weapon
    let iconUrl = isWorld ? SKULL_ICON : weaponIconUrl(weapon)
    if (iconUrl) {
      let icon = document.createElement(`span`)
      icon.className = isWorld ? `death-fade-icon death-fade-skull` : `death-fade-icon`
      icon.style.maskImage = `url(${iconUrl})`
      icon.style.webkitMaskImage = `url(${iconUrl})`
      this.detail.appendChild(icon)
    }
    let weaponLabel = formatWeaponName(weapon)
    if (weaponLabel) {
      let el = document.createElement(`span`)
      el.className = `death-fade-weapon`
      el.textContent = weaponLabel
      this.detail.appendChild(el)
    }
    // 击杀修饰符（爆头/穿墙/穿烟/致盲/不开镜）
    for (let mod of KILL_MODIFIERS) {
      if (!death[mod.key]) continue
      let wrap = document.createElement(`span`)
      wrap.className = `death-fade-modifier`
      let icon = document.createElement(`span`)
      icon.className = `death-fade-mod death-fade-mod-${mod.key}`
      icon.style.maskImage = `url(${mod.url})`
      icon.style.webkitMaskImage = `url(${mod.url})`
      icon.setAttribute(`aria-hidden`, `true`)
      wrap.appendChild(icon)
      let label = document.createElement(`span`)
      label.textContent = mod.label
      wrap.appendChild(label)
      this.detail.appendChild(wrap)
    }
  }

  renderDamage(container, rows, players, tick, emptyText) {
    container.replaceChildren()
    if (rows.length === 0) {
      if (!emptyText) return
      let el = document.createElement(`div`)
      el.className = `death-fade-damage-empty`
      el.textContent = emptyText
      container.appendChild(el)
      return
    }
    for (let row of rows) {
      let el = document.createElement(`div`)
      el.className = `death-fade-damage-row`
      let amount = document.createElement(`span`)
      amount.className = `death-fade-damage-amount`
      amount.textContent = String(row.damage)
      let name = document.createElement(`span`)
      name.className = `death-fade-damage-name death-fade-player`
      name.textContent = players[row.slot]?.name ?? `Player ${row.slot}`
      this.setTeam(name, row.slot, tick)
      el.append(amount, name)
      container.appendChild(el)
    }
  }

  setTeam(el, slot, tick) {
    let team = slot === undefined ? 0 : this.teamAtTick(slot, tick)
    el.dataset.team = team === 2 ? `t` : team === 3 ? `ct` : `unknown`
  }
}

// 统计受害者在 [roundStart, tick] 窗口内承伤/输出的伤害，按对方 slot 聚合
function computeDamageSummary(damage, victimSlot, roundStartTick, tick) {
  let taken = new Map()
  let dealt = new Map()
  for (let i = 0; i < damage.count; i++) {
    let t = damage.tick[i]
    if (t < roundStartTick) continue
    if (t > tick) break
    let attacker = damage.attackerSlot[i]
    let victim = damage.victimSlot[i]
    if (attacker === victim) continue
    if (victim === victimSlot) taken.set(attacker, (taken.get(attacker) ?? 0) + damage.dmg[i])
    if (attacker === victimSlot) dealt.set(victim, (dealt.get(victim) ?? 0) + damage.dmg[i])
  }
  return { taken: toSortedDamage(taken), dealt: toSortedDamage(dealt) }
}

function toSortedDamage(map) {
  return [...map].map(([slot, damage]) => ({ slot, damage })).sort((a, b) => b.damage - a.damage || a.slot - b.slot)
}

// "weapon_ak47" → "Ak47"
function formatWeaponName(weapon) {
  return !weapon || weapon === `world`
    ? ``
    : weapon.replace(/^weapon_/, ``).replaceAll(`_`, ` `).replace(/\b\w/g, (c) => c.toUpperCase())
}

// ────────────────────────────────────────────────────────────────────────────
// 二、KillReplay —— 连续击杀回放面板
//     当一名玩家短时间内连续击杀多人时，列出这些击杀，支持逐个回放。
// ────────────────────────────────────────────────────────────────────────────
const KILL_REPLAY_HIDE_MS = 180

class KillReplay {
  element
  victimsList
  teamAtTick
  rows = []
  group = null
  hideHandle

  constructor(container, onReplay, onDismiss, teamAtTick) {
    this.teamAtTick = teamAtTick
    this.element = document.createElement(`div`)
    this.element.className = `kill-replay`
    this.element.hidden = true
    this.element.inert = true
    this.element.setAttribute(`aria-hidden`, `true`)
    this.element.setAttribute(`role`, `group`)
    this.element.setAttribute(`aria-label`, `Kill replay`)
    this.element.innerHTML = `<div class="kill-replay-victims-list" role="group" aria-label="Individual kills"></div>`
    this.victimsList = this.element.querySelector(`.kill-replay-victims-list`)
    this.element.addEventListener(`click`, (e) => e.stopPropagation())
    this.element.addEventListener(`keydown`, (e) => {
      if (e.key === ` ` || e.key === `Tab`) e.stopPropagation()
      if (e.key === `Escape`) { e.stopPropagation(); onDismiss() }
    })
    this.victimsList.addEventListener(`click`, (e) => {
      let target = e.target
      if (!(target instanceof HTMLButtonElement) || !this.group) return
      let kill = this.group.kills[Number(target.dataset.index)]
      if (kill) onReplay(kill, target.dataset.perspective === `victim` ? `victim` : `killer`)
    })
    container.appendChild(this.element)
  }

  update(group, tick, tickRate) {
    if (!group) { if (this.group) { this.group = null; this.hide() } return }
    if (group !== this.group) {
      // 首杀变化时清空重建
      if (group?.kills[0] !== this.group?.kills[0]) { this.victimsList.replaceChildren(); this.rows.length = 0 }
      this.group = group
      this.show()
      let count = group.kills.length
      this.element.classList.toggle(`is-multi`, count > 1)
      group.kills.forEach((kill, idx) => {
        let row = this.rows[idx] ?? this.createRow(kill, idx)
        row.kill = kill
        row.attackerName.textContent = kill.attackerName ?? `Player`
        row.attackerName.title = row.attackerName.textContent
        this.setTeam(row.attackerName, group.attackerSlot, kill.tick)
        row.victimName.textContent = kill.victimName ?? `Victim ${idx + 1}`
        row.victimName.title = row.victimName.textContent
        row.icons.innerHTML = renderKillIcons(kill)
        if (kill.victimSlot !== undefined) this.setTeam(row.victimName, kill.victimSlot, kill.tick)
        let watchBtn = row.element.querySelector(`.kill-replay-kill-watch`)
        let deathBtn = row.element.querySelector(`.kill-replay-death`)
        watchBtn.title = `Replay kill ${idx + 1} against ${row.victimName.textContent} from ${row.attackerName.textContent} POV`
        deathBtn.title = `See death ${idx + 1} from ${row.victimName.textContent} POV`
        watchBtn.setAttribute(`aria-label`, watchBtn.title)
        deathBtn.setAttribute(`aria-label`, deathBtn.title)
      })
      while (this.rows.length > count) this.rows.pop().element.remove()
    }
    // 更新每行的倒计时状态
    for (let row of this.rows) {
      let remaining = computeRemainingMs(row.kill.tick, tick, tickRate)
      if (remaining === row.remainingMilliseconds) continue
      row.remainingMilliseconds = remaining
      row.element.classList.toggle(`is-upcoming`, remaining > 0)
      let secs = (remaining / 1000).toFixed(3)
      row.status.textContent = remaining > 0 ? `${secs}s` : ``
      if (remaining > 0) row.status.setAttribute(`aria-label`, `Kill in ${secs} seconds`)
      else row.status.removeAttribute(`aria-label`)
    }
  }

  dispose() { this.cancelHide(); this.element.remove() }

  show() {
    this.cancelHide()
    let wasHidden = this.element.hidden
    this.element.hidden = false
    this.element.inert = false
    this.element.removeAttribute(`aria-hidden`)
    if (wasHidden) this.element.offsetWidth   // 强制 reflow
    this.element.classList.add(`is-visible`)
  }

  hide() {
    this.element.inert = true
    this.element.setAttribute(`aria-hidden`, `true`)
    this.element.classList.remove(`is-visible`)
    if (window.matchMedia(`(prefers-reduced-motion: reduce)`).matches) { this.finishHide(); return }
    this.hideHandle = window.setTimeout(() => { this.hideHandle = undefined; this.finishHide() }, KILL_REPLAY_HIDE_MS)
  }

  finishHide() { this.element.hidden = true; this.victimsList.replaceChildren(); this.rows.length = 0 }
  cancelHide() { if (this.hideHandle !== undefined) { window.clearTimeout(this.hideHandle); this.hideHandle = undefined } }

  createRow(kill, idx) {
    let el = document.createElement(`div`)
    el.className = `kill-replay-row`
    el.innerHTML = `
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
    `
    for (let btn of el.querySelectorAll(`button`)) {
      btn.dataset.index = String(idx)
      btn.dataset.perspective = btn.classList.contains(`kill-replay-death`) ? `victim` : `killer`
    }
    let row = {
      element: el,
      attackerName: el.querySelector(`.kill-replay-attacker`),
      victimName: el.querySelector(`.kill-replay-victim`),
      icons: el.querySelector(`.kill-replay-icons`),
      status: el.querySelector(`.kill-replay-row-status`),
      kill,
      remainingMilliseconds: null,
    }
    this.rows.push(row)
    this.victimsList.appendChild(el)
    return row
  }

  setTeam(el, slot, tick) {
    let team = this.teamAtTick(slot, tick)
    el.dataset.team = team === 2 ? `t` : team === 3 ? `ct` : `unknown`
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 三、性能统计配置（localStorage 持久化）
// ────────────────────────────────────────────────────────────────────────────
// 可显示的指标定义（live = 实时渲染指标，demo = 回放元数据）
const STATS_METRICS = [
  { key: `fps`, label: `FPS`, group: `live` },
  { key: `frameMs`, label: `Frame`, group: `live` },
  { key: `drawCalls`, label: `Draws`, group: `live` },
  { key: `triangles`, label: `Tris`, group: `live` },
  { key: `parse`, label: `Parse`, group: `demo` },
  { key: `quality`, label: `Quality`, group: `demo` },
  { key: `duration`, label: `Duration`, group: `demo` },
  { key: `tickRate`, label: `Tick`, group: `demo` },
  { key: `fileSize`, label: `Size`, group: `demo` },
]
const STATS_STORAGE_KEY = `csplayer:stats`
const STATS_POLL_MS = 120

function defaultStatsConfig() {
  return {
    metrics: {
      fps: true, frameMs: true, drawCalls: true, triangles: true,
      parse: true, quality: true, duration: true, tickRate: true, fileSize: true,
    },
  }
}

function loadStatsConfig() {
  let config = defaultStatsConfig()
  try {
    let raw = localStorage.getItem(STATS_STORAGE_KEY)
    if (!raw) return config
    let saved = JSON.parse(raw)
    return { metrics: { ...config.metrics, ...(saved.metrics ?? {}) } }
  } catch { return config }
}

function saveStatsConfig(config) {
  try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify({ metrics: config.metrics })) } catch {}
}
