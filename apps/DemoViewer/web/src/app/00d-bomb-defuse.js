// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 28487–28584 行（切片 5/40）
// 角色：炸弹/拆包状态机：wg/Tg（拆包进度，含击杀打断判定）/ Eg / Dg / Og
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
function wg(e, t, n) {
  return e < t ? t : e > n ? n : e
}
function Tg(e, t) {
  if (!e.bomb.segments.some((e) => e.kind === `planted` && t >= e.startTick && t < e.endTick)) return null
  for (let n of e.bomb.defuses) {
    let r = n.hasKit ? 5 : 10,
      i = n.startTick + r * e.meta.tickRate
    if (
      t < n.startTick ||
      t >= Math.min(n.endTick, i) ||
      e.events.some((e) => e.type === `kill` && e.victimSlot === n.defuserSlot && e.tick >= n.startTick && e.tick <= t)
    )
      continue
    let a = (t - n.startTick) / e.meta.tickRate
    return {
      defuserSlot: n.defuserSlot,
      hasKit: n.hasKit,
      durationSeconds: r,
      remainingSeconds: Math.max(0, r - a),
      progress: Math.max(0, Math.min(1, a / r)),
    }
  }
  return null
}
function Eg(e, t, n) {
  let r = e - t
  return r > 0 ? Math.max(1, Math.round((r * 1e3) / n)) : 0
}
var Dg = class {
  group = null
  context = null
  groups = []
  dismissedGroup = null
  update(e, t, n, r, i, a, o) {
    let s = this.context
    ;(!s ||
      s.events !== a ||
      s.followedSlot !== t ||
      s.roundStartTick !== n ||
      s.roundEndTick !== o ||
      s.tickRate !== r ||
      s.numPlayers !== i) &&
      ((this.context = { events: a, followedSlot: t, roundStartTick: n, roundEndTick: o, tickRate: r, numPlayers: i }),
      (this.groups = this.buildGroups(this.context)))
    let c = null
    for (let t of this.groups) {
      if (t.kills[0].tick > e) break
      e < t.expiresTick && (c = t)
    }
    c &&
    this.dismissedGroup &&
    c.attackerSlot === this.dismissedGroup.attackerSlot &&
    c.roundStartTick === this.dismissedGroup.roundStartTick &&
    c.kills[0].tick === this.dismissedGroup.kills[0].tick
      ? (this.group = null)
      : ((this.dismissedGroup = null), (this.group = c))
  }
  dismiss() {
    ;((this.dismissedGroup = this.group), (this.group = null))
  }
  reset() {
    ;((this.group = null), (this.dismissedGroup = null))
  }
  buildGroups(e) {
    let { events: t, followedSlot: n, roundStartTick: r, roundEndTick: i, tickRate: a, numPlayers: o } = e,
      s = [],
      c = null,
      l = () => {
        c &&
          s.push({
            attackerSlot: n,
            roundStartTick: r,
            kills: c,
            expiresTick: Math.min(i, c[c.length - 1].tick + 10 * a),
          })
      }
    for (let e of t)
      if (!(e.tick < r)) {
        if (e.tick >= i) break
        Og(e, n, o) && (c && e.tick - c[c.length - 1].tick <= 6 * a ? c.push(e) : (l(), (c = [e])))
      }
    return (l(), s)
  }
}
function Og(e, t, n) {
  return (
    e.type === `kill` &&
    t >= 0 &&
    t < n &&
    e.attackerSlot === t &&
    e.victimSlot !== void 0 &&
    e.victimSlot >= 0 &&
    e.victimSlot < n &&
    e.victimSlot !== t &&
    e.weapon !== `world`
  )
}
