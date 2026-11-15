// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 28585–28679 行（切片 6/40）
// 角色：击杀查询与回放链：kg/Ag/jg/Mg/Ng/Pg + 玩家配色表 Fg（blue/green/yellow/orange/purple）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
function kg(e, t, n, r) {
  for (let i = e.length - 1; i >= 0; i--) {
    let a = e[i]
    if (!(a.tick > r)) {
      if (a.tick < t) break
      if (a.type === `kill` && a.victimSlot === n) return a
    }
  }
  return null
}
function Ag(e, t, n, r, i, a) {
  let o = Math.min(n + 6 * i, r ?? 1 / 0),
    s = new Set(),
    c = Mg(t)
  for (; c !== null && !s.has(c);) {
    s.add(c)
    let r = a(c, n) ? Ng(e, c, n, o) : Pg(e, c, t.tick, n)
    if (!r) return a(c, n) ? c : null
    c = Mg(r)
  }
  return null
}
function jg(e, t, n, r, i) {
  return Ng(e, t, n, Math.min(n + 6 * i, r ?? 1 / 0)) === null
}
function Mg(e) {
  let t = e.attackerSlot
  return e.type === `kill` && t !== void 0 && t >= 0 && t !== e.victimSlot && e.weapon !== `world` ? t : null
}
function Ng(e, t, n, r) {
  for (let i of e)
    if (!(i.tick <= n)) {
      if (i.tick > r) break
      if (i.type === `kill` && i.victimSlot === t) return i
    }
  return null
}
function Pg(e, t, n, r) {
  for (let i = e.length - 1; i >= 0; i--) {
    let a = e[i]
    if (!(a.tick > r)) {
      if (a.tick < n) break
      if (a.type === `kill` && a.victimSlot === t) return a
    }
  }
  return null
}
var Fg = [`blue`, `green`, `yellow`, `orange`, `purple`],
  Ig = [
    `X`,
    `Y`,
    `Z`,
    `yaw`,
    `pitch`,
    `health`,
    `team_num`,
    `is_alive`,
    `team_rounds_total`,
    `duck_amount`,
    `flash_duration`,
    `flash_max_alpha`,
    `zoom_lvl`,
    `is_scoped`,
    `accuracy_penalty`,
    `is_in_reload`,
    `CCSPlayerPawn.m_fFlags`,
    `m_bPinPulled`,
    `m_bStartedArming`,
  ],
  Lg =
    `health,is_alive,team_num,armor_value,has_helmet,has_defuser,is_defusing,CCSPlayerPawn.m_flProgressBarStartTime,CCSPlayerPawn.m_iProgressBarDuration,bomb_site,balance,current_equip_value,active_weapon_name,active_weapon_ammo,total_ammo_left,inventory,crosshair_code,team_clan_name,player_color,round_start_time,game_time,is_terrorist_timeout,is_ct_timeout,terrorist_timeout_remaining,ct_timeout_remaining,num_terrorist_timeouts,num_ct_timeouts,is_technical_timeout`.split(
      `,`,
    ),
  Rg = [`player_death`, `round_start`, `round_end`, `bomb_planted`, `bomb_defused`, `bomb_exploded`],
  zg = [
    `smokegrenade_detonate`,
    `smokegrenade_expired`,
    `hegrenade_detonate`,
    `flashbang_detonate`,
    `inferno_startburn`,
    `inferno_expire`,
    `decoy_started`,
    `decoy_detonate`,
  ],
  Bg = [
    `bomb_planted`,
    `bomb_dropped`,
    `bomb_pickup`,
    `bomb_defused`,
    `bomb_exploded`,
    `bomb_begindefuse`,
    `bomb_abortdefuse`,
  ],
  Vg = `weapon_fire`
Math.PI / 180
