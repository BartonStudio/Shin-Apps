// ============================================================================
// 反混淆版本：击杀查询辅助 + **SoA 列/事件白名单表**
// 原文范围：decompiled/index.beautified.js L28585–28679（切片 00e-kill-helpers）
// 压缩名：kg = findKillBefore，Ag = walkKillChain，jg = willChainEnd，
//         Mg = attackerOf，Ng = firstKillAfter，Pg = lastKillBefore,
//         Fg/Ig/Lg/Rg/zg/Bg/Vg = 各类列名与事件名白名单
// 依赖：无
//
// 这个切片有两块内容：
//   A. 击杀查询（kg/Ag/jg/Mg/Ng/Pg）—— 「谁杀了谁、下一杀是谁、连锁在 N 秒内会不会断」
//   B. ★ 白名单表（Fg/Ig/Lg/Rg/zg/Bg/Vg）—— 解析器向 wasm 请求哪些列/哪些事件。
//      这就是 docs/07 附录 A 里那两张类型表的**源头**，也是「为什么 data 里只有这些字段」的答案：
//      wasm 只返回这里列出来的东西。
// ============================================================================

// ── A. 击杀查询 ─────────────────────────────────────────────────────────────

// 在事件流里**倒序**找：最后一次满足 startTick <= tick <= endTick 且 victimSlot === slot 的击杀
function findKillBefore(events, startTick, victimSlot, endTick) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.tick > endTick) continue;
    if (ev.tick < startTick) break; // events 按 tick 升序，倒序扫描可提前退出
    if (ev.type === 'kill' && ev.victimSlot === victimSlot) return ev;
  }
  return null;
}

// 从一个击杀事件出发，沿着「凶手又被谁杀」一路追下去，判断这串连锁会不会在窗口内延续。
//   events        事件流（按 tick 升序）
//   startEvent    起始事件（用它自己的 tick 作为时间基准，所以传的是事件而不是 slot）
//   fromTick      时间基准
//   roundEndTick  回合结束 tick（可为 null）
//   tickRate      64
//   isFollowed    (slot, tick) => bool，判断某 slot 是否是当前被跟拍者
// 返回：链条在窗口内终止时返回末尾 slot，否则 null
function walkKillChain(events, startEvent, fromTick, roundEndTick, tickRate, isFollowed) {
  // 观察窗口：从 fromTick 起 6 秒，但不越过回合结束
  const untilTick = Math.min(fromTick + 6 * tickRate, roundEndTick ?? Infinity);
  const seen = new Set(); // 防止 A→B→A 这类死循环
  let slot = attackerOf(startEvent);

  for (; slot !== null && !seen.has(slot); ) {
    seen.add(slot);
    // 被跟拍者：往后找他下一次杀人；其他人：往前找上一次杀他的
    const kill = isFollowed(slot, fromTick)
      ? firstKillAfter(events, slot, fromTick, untilTick)
      : lastKillBefore(events, slot, startEvent.tick, fromTick);
    if (!kill) return isFollowed(slot, fromTick) ? slot : null;
    slot = attackerOf(kill);
  }
  return null;
}

// 便捷判定：从 t 起的连锁在窗口内是否立即结束
function willChainEnd(events, slot, fromTick, roundEndTick, tickRate) {
  return firstKillAfter(events, slot, fromTick, Math.min(fromTick + 6 * tickRate, roundEndTick ?? Infinity)) === null;
}

// 一条事件若是「有效击杀」，返回凶手 slot，否则 null。
// 排除：非 kill 事件、缺 attackerSlot、自杀、world（环境致死）。
function attackerOf(ev) {
  const attacker = ev.attackerSlot;
  return ev.type === 'kill' && attacker !== undefined && attacker >= 0 && attacker !== ev.victimSlot && ev.weapon !== 'world'
    ? attacker
    : null;
}

// 正序找：第一个 tick > fromTick 且 <= untilTick 的、受害者是 victimSlot 的击杀
function firstKillAfter(events, victimSlot, fromTick, untilTick) {
  for (const ev of events) {
    if (ev.tick <= fromTick) continue;
    if (ev.tick > untilTick) break;
    if (ev.type === 'kill' && ev.victimSlot === victimSlot) return ev;
  }
  return null;
}

// 倒序找：最后一次 tick 落在 [fromTick, untilTick] 内、受害者是 victimSlot 的击杀
function lastKillBefore(events, victimSlot, fromTick, untilTick) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.tick > untilTick) continue;
    if (ev.tick < fromTick) break;
    if (ev.type === 'kill' && ev.victimSlot === victimSlot) return ev;
  }
  return null;
}

// ── B. 白名单表 ★ ──────────────────────────────────────────────────────────
// 这些数组会被传给 wasm 的 parseRoundStream / parseEvents，决定返回哪些数据。
// 改动这里 = 改动 data 契约的字段覆盖面（详见 docs/07 第 3、4 节）。

// 玩家配色名（1 字节索引会指向这里；Player 里作为 PLAYER_COLORS 使用）
// 注意：原件就是 CSS 颜色名字符串，不是 hex 数值。
var PLAYER_COLOR_NAMES = ['blue', 'green', 'yellow', 'orange', 'purple'];

// ★ 逐帧请求的 19 个玩家属性列（对应 data.frames 的 posX..playerFlags）
// 其中后 3 个是原始 Source2 netprop 名，wasm 直接透传
var WANTED_PLAYER_COLUMNS = [
  'X',
  'Y',
  'Z',
  'yaw',
  'pitch',
  'health',
  'team_num',
  'is_alive',
  'team_rounds_total',
  'duck_amount',
  'flash_duration',
  'flash_max_alpha',
  'zoom_lvl',
  'is_scoped',
  'accuracy_penalty',
  'is_in_reload',
  'CCSPlayerPawn.m_fFlags', // → frames.playerFlags
  'm_bPinPulled',           // → 与下一项一起决定 m_bStartedArming 的可用性
  'm_bStartedArming',
];

// ★ 面板（回合级）请求的 28 个属性列（对应 data.panelFrames）
var WANTED_PANEL_COLUMNS =
  'health,is_alive,team_num,armor_value,has_helmet,has_defuser,is_defusing,' +
  'CCSPlayerPawn.m_flProgressBarStartTime,CCSPlayerPawn.m_iProgressBarDuration,' +
  'bomb_site,balance,current_equip_value,active_weapon_name,active_weapon_ammo,' +
  'total_ammo_left,inventory,crosshair_code,team_clan_name,player_color,' +
  'round_start_time,game_time,is_terrorist_timeout,is_ct_timeout,' +
  'terrorist_timeout_remaining,ct_timeout_remaining,' +
  'num_terrorist_timeouts,num_ct_timeouts,is_technical_timeout'.split(',');

// ★ 关键事件白名单（6 个）—— 回合/击杀/炸弹骨架全靠这几个
var WANTED_KEY_EVENTS = [
  'player_death',
  'round_start',
  'round_end',
  'bomb_planted',
  'bomb_defused',
  'bomb_exploded',
];

// ★ 道具事件白名单（8 个）—— 烟雾/闪光/火/诱饵的生命周期
var WANTED_GRENADE_EVENTS = [
  'smokegrenade_detonate',
  'smokegrenade_expired',
  'hegrenade_detonate',
  'flashbang_detonate',
  'inferno_startburn',
  'inferno_expire',
  'decoy_started',
  'decoy_detonate',
];

// ★ 炸弹事件白名单（7 个）—— 炸弹状态机的输入
var WANTED_BOMB_EVENTS = [
  'bomb_planted',
  'bomb_dropped',
  'bomb_pickup',
  'bomb_defused',
  'bomb_exploded',
  'bomb_begindefuse',
  'bomb_abortdefuse',
];

// 开火事件（单条，用于弹道曳光与枪口闪光）
var WANTED_FIRE_EVENT = 'weapon_fire';

// 原件在此处还有一条不合任何语义的表达式语句 `Math.PI / 180`
// （压缩残留，结果被丢弃）。此处照原样保留，不做删改，以免与原件产生差异。
Math.PI / 180;
