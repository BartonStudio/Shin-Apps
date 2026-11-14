// ============================================================================
// 反混淆版本：parser.worker —— CS2 demo 解析器的 wasm 后处理层
// 原始文件：src/workers/parser.worker.js
// 说明：
//   这个 worker 分三部分：
//   (1) 作者手写的"数据后处理"：把 wasm 解析出的原始列数据（Map<字段, 数组>）
//       后处理成 SoA（Structure of Arrays）typed array 结构
//   (2) wasm-bindgen 自动生成的胶水代码（DemoInput 类，1624 行起）—— 这是 Rust 导出到 JS 的桥
//   (3) 解析入口 gt() + worker onmessage 消息循环
//   本文件只反混淆 (1) 和 (3)，(2) 是自动生成代码，仅标注。
// ============================================================================

// ── 常量：CS2 回放参数 ──────────────────────────────────────────────────────

// 地图的 C4 下包点位（用于炸弹落点归属判断）
const BOMB_SITES = {
  de_mirage: [
    { letter: `A`, x: -465, y: -2178 },
    { letter: `B`, x: -2052, y: 279 },
  ],
};

// 块大小：分区存储的数值表，每块 65536 项
const BLOCK_SIZE = 65536;

// 玩家队伍颜色（用于 HUD 上色）
const TEAM_COLORS = [`blue`, `green`, `yellow`, `orange`, `purple`];

// 闪光弹衰减参数：flash_duration 从峰值衰减的速率系数
const FLASH_DECAY_RATE = 5.2;

// 每帧 SoA 数据要采样的玩家状态字段（传给 wasm 的列名）
const FRAME_FIELDS = [
  `X`, `Y`, `Z`, `yaw`, `pitch`, `health`, `team_num`, `is_alive`,
  `team_rounds_total`, `duck_amount`, `flash_duration`, `flash_max_alpha`,
  `zoom_lvl`, `is_scoped`, `accuracy_penalty`, `is_in_reload`,
  `CCSPlayerPawn.m_fFlags`, `m_bPinPulled`, `m_bStartedArming`,
];

// 面板（HUD 左右玩家面板）要采样的字段
const PANEL_FIELDS =
  `health,is_alive,team_num,armor_value,has_helmet,has_defuser,is_defusing,CCSPlayerPawn.m_flProgressBarStartTime,CCSPlayerPawn.m_iProgressBarDuration,bomb_site,balance,current_equip_value,active_weapon_name,active_weapon_ammo,total_ammo_left,inventory,crosshair_code,team_clan_name,player_color,round_start_time,game_time,is_terrorist_timeout,is_ct_timeout,terrorist_timeout_remaining,ct_timeout_remaining,num_terrorist_timeouts,num_ct_timeouts,is_technical_timeout`.split(`,`);

// 时间线事件（回合边界 + 击杀 + 炸弹）
const TIMELINE_EVENTS = [`player_death`, `round_start`, `round_end`, `bomb_planted`, `bomb_defused`, `bomb_exploded`];

// 投掷物引爆/消失事件
const GRENADE_EVENTS = [
  `smokegrenade_detonate`, `smokegrenade_expired`, `hegrenade_detonate`,
  `flashbang_detonate`, `inferno_startburn`, `inferno_expire`, `decoy_started`, `decoy_detonate`,
];

// 炸弹相关事件
const BOMB_EVENTS = [
  `bomb_planted`, `bomb_dropped`, `bomb_pickup`, `bomb_defused`,
  `bomb_exploded`, `bomb_begindefuse`, `bomb_abortdefuse`,
];

// 时间线事件名 → 内部类型映射
const EVENT_TYPE_MAP = {
  player_death: `kill`,
  round_start: `round_start`,
  round_end: `round_end`,
  bomb_planted: `bomb_planted`,
  bomb_defused: `bomb_defused`,
  bomb_exploded: `bomb_exploded`,
};

// 回合结束原因枚举
const ROUND_END_REASONS = new Map([
  [`still_in_progress`, 0], [`bomb_exploded`, 1], [`vip_escaped`, 2], [`vip_killed`, 3],
  [`t_saved`, 4], [`ct_stopped_escape`, 5], [`RoundEndReasonTerroristsStopped`, 6], [`bomb_defused`, 7],
  [`t_killed`, 8], [`ct_killed`, 9], [`draw`, 10], [`hostage_rescued`, 11], [`time_ran_out`, 12],
  [`RoundEndReasonHostagesNotRescued`, 13], [`terrorists_not_escaped`, 14], [`vip_not_escaped`, 15],
  [`game_start`, 16], [`t_surrender`, 17], [`ct_surrender`, 18], [`t_planted`, 19], [`ct_reached_hostage`, 20],
]);

const MAX_TICK = 1e6;
const TICK_RATE = 64; // CS2 固定 64 tick

// 烟雾/燃烧瓶/闪光持续时间参数（tick 数）
const SMOKE_DURATION_TICKS = 960; // 烟雾 15s
const INFERNO_DURATION_TICKS = 448; // 燃烧瓶 7s
const FLASH_DURATION_TICKS = 26; // 闪光 ~0.4s
const SMOKE_MAX_TICKS = 1280;
const INFERNO_MAX_TICKS = 576;

// 燃烧瓶默认燃烧时长（秒，用于爆炸时间估算）
const DEFAULT_ROUND_TIME = 15; // 一个回合的"冻结+下包"基准（实际是 round start 到 live 的间隔）

// 弹道线长度（无命中时默认延伸）
const TRACER_LENGTH = 4096;
const DEG_TO_RAD = Math.PI / 180;

// 投掷物轨迹分段间隔（tick）：超过这个间隔视为新轨迹
const TRAJECTORY_GAP_TICKS = 32;

// 命中部位 → 高度偏移（用于弹道命中点抬高到身体部位）
const HITGROUP_HEIGHT = {
  head: 64, neck: 64, chest: 52, generic: 52,
  left_arm: 48, right_arm: 48, stomach: 40, pelvis: 32,
  left_leg: 18, right_leg: 18,
};

// ── 基础工具 ────────────────────────────────────────────────────────────────

/** 取某地图的炸弹点位（深拷贝） */
function getBombSites(mapName) {
  return BOMB_SITES[mapName]?.map((site) => ({ ...site }));
}

/** 分区数值表：把任意 JS 值（number/null/undefined/bool/string）按块存储，支持按索引取值 */
class BlockedValueTable {
  blocks = [];
  count = 0;
  get length() { return this.count; }

  push(value) {
    const blockIndex = Math.floor(this.count / BLOCK_SIZE);
    const offset = this.count % BLOCK_SIZE;
    let block = this.blocks[blockIndex];
    if (!block) {
      block = { values: new Float64Array(BLOCK_SIZE), types: new Uint8Array(BLOCK_SIZE), other: new Map() };
      this.blocks.push(block);
    }
    if (typeof value == `number`) block.values[offset] = value;
    else if (value === null) block.types[offset] = 1;
    else if (value === undefined) block.types[offset] = 2;
    else if (value === true) block.types[offset] = 4;
    else if (value === false) block.types[offset] = 5;
    else { block.types[offset] = 3; block.other.set(offset, value); }
    this.count++;
  }

  valueAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return;
    const block = this.blocks[Math.floor(index / BLOCK_SIZE)];
    const offset = index % BLOCK_SIZE;
    switch (block.types[offset]) {
      case 1: return null;
      case 2: return undefined;
      case 3: return block.other.get(offset);
      case 4: return true;
      case 5: return false;
      default: return block.values[offset];
    }
  }
}

/** 从 wasm 返回的"列"（数组或 BlockedValueTable）取第 i 项 */
function columnAt(column, index) {
  return Array.isArray(column) ? column[index] : column.valueAt(index);
}

/** 从 wasm 返回的 Map 取某一列 */
function getColumn(map, key) {
  return map.get(key);
}

/** 取某列的长度（第一个有值的列的长度） */
function columnLength(map) {
  for (const column of map.values()) return column.length;
  return 0;
}

// ── 数值/布尔钳制工具 ───────────────────────────────────────────────────────

function toString(v) {
  if (typeof v == `string`) return v;
  if (typeof v == `number` || typeof v == `bigint`) return String(v);
}
function toNumber(v) {
  if (typeof v == `number`) return v;
  if (typeof v == `bigint`) return Number(v);
  if (typeof v == `string` && v !== ``) {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
}
function toBool(v) { return v === true || v === 1 || v === `true`; }
function clampU8(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
function clampUnit(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clampU16(v) { return v < 0 ? 0 : v > 65535 ? 65535 : Math.round(v); }
function teamNum(v) { return v === 2 || v === 3 ? v : 0; } // 只接受 2(T) / 3(CT)

/** 把道具 inventory 编码成 8bit 位域：每 2 bit 存一类道具的数量（最多 3） */
function encodeUtilityCounts(inventory) {
  if (!Array.isArray(inventory)) return 0;
  let smoke = 0, flash = 0, he = 0, molotov = 0;
  for (const item of inventory) {
    if (typeof item != `string`) continue;
    const name = item.toLowerCase();
    if (name.includes(`smoke`)) smoke++;
    else if (name.includes(`flash`)) flash++;
    else if (name.includes(`high explosive`) || name === `he grenade`) he++;
    else if (name.includes(`molotov`) || name.includes(`incendiary`)) molotov++;
  }
  const cap3 = (n) => Math.min(3, n);
  return cap3(smoke) | (cap3(flash) << 2) | (cap3(he) << 4) | (cap3(molotov) << 6);
}

/** 生成采样 tick 序列（按采样率间隔） */
function sampleTicks(interval, maxTick = MAX_TICK) {
  if (!Number.isSafeInteger(maxTick) || maxTick < 0) throw RangeError(`Tick bound must be a nonnegative safe integer`);
  const count = Math.ceil(Math.min(MAX_TICK, maxTick) / Math.max(1, interval));
  const ticks = new Int32Array(count);
  for (let i = 0; i < count; i++) ticks[i] = i * interval;
  return ticks;
}

/** 归一化采样率（默认 32，上限 64） */
function normalizeSampleRate(rate, max = 64) {
  return !Number.isFinite(rate) || rate <= 0 ? 32 : Math.min(max, Math.max(1, Math.round(rate)));
}

/** 二分查找：找 tick 数组里最后一个 <= target 的下标 */
function lowerBound(sortedTicks) {
  const length = sortedTicks.length;
  return (tick) => {
    if (length === 0) return 0;
    let lo = 0, hi = length - 1;
    if (tick <= sortedTicks[0]) return 0;
    if (tick >= sortedTicks[hi]) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sortedTicks[mid] <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

// ── 核心：把 wasm 原始列数据 → SoA 帧结构 ───────────────────────────────────

/**
 * 从 wasm 的原始列（Map<字段名, 数组>）构建 SoA 帧缓冲。
 * 关键设计：帧缓冲是 [frameIndex * numPlayers + slot] 的二维布局，
 * 每个玩家状态字段一个并列 typed array。
 */
function buildFrameBuffers(columns) {
  const steamIdCol = getColumn(columns, `steamid`);
  const nameCol = getColumn(columns, `name`);
  const tickCol = getColumn(columns, `tick`);
  const xCol = getColumn(columns, `X`);
  const yCol = getColumn(columns, `Y`);
  const zCol = getColumn(columns, `Z`);
  const yawCol = getColumn(columns, `yaw`);
  const pitchCol = getColumn(columns, `pitch`);
  const healthCol = getColumn(columns, `health`);
  const aliveCol = getColumn(columns, `is_alive`);
  const teamCol = getColumn(columns, `team_num`);
  const scoreCol = getColumn(columns, `team_rounds_total`);
  const duckCol = getColumn(columns, `duck_amount`);
  const flashCol = getColumn(columns, `flash_duration`);
  const flashAlphaCol = getColumn(columns, `flash_max_alpha`);
  const zoomCol = getColumn(columns, `zoom_lvl`);
  const scopedCol = getColumn(columns, `is_scoped`);
  const accuracyCol = getColumn(columns, `accuracy_penalty`);
  const reloadCol = getColumn(columns, `is_in_reload`);
  const flagsCol = getColumn(columns, `CCSPlayerPawn.m_fFlags`);
  const pinPulledCol = getColumn(columns, `m_bPinPulled`);
  const armingCol = getColumn(columns, `m_bStartedArming`);

  const hasFlags = flagsCol || pinPulledCol || armingCol;
  const totalRows = columnLength(columns);

  // 第一遍：建立 steamId -> slot 映射，收集所有出现过的 tick
  const slotBySteamId = new Map();
  const players = [];
  const tickSet = new Set();
  for (let i = 0; i < totalRows; i++) {
    const steamId = steamIdCol ? toString(columnAt(steamIdCol, i)) : undefined;
    if (!steamId) continue;
    if (!slotBySteamId.has(steamId)) {
      slotBySteamId.set(steamId, players.length);
      players.push({ slot: players.length, steamId, name: (nameCol ? toString(columnAt(nameCol, i)) : undefined) ?? `` });
    }
    const tick = tickCol ? toNumber(columnAt(tickCol, i)) : undefined;
    if (tick !== undefined) tickSet.add(tick);
  }

  const frameTicks = Int32Array.from(tickSet).sort();
  const frameIndexByTick = new Map();
  for (let i = 0; i < frameTicks.length; i++) frameIndexByTick.set(frameTicks[i], i);

  const numFrames = frameTicks.length;
  const numPlayers = Math.max(players.length, 1);
  const totalSlots = numFrames * numPlayers;

  // SoA 缓冲：每个字段一个 typed array
  const buffers = {
    posX: new Float32Array(totalSlots),
    posY: new Float32Array(totalSlots),
    posZ: new Float32Array(totalSlots),
    yaw: new Float32Array(totalSlots),
    pitch: new Float32Array(totalSlots),
    health: new Uint8Array(totalSlots),
    alive: new Uint8Array(totalSlots),
    team: new Uint8Array(totalSlots),
    score: new Uint8Array(totalSlots),
    duck: new Float32Array(totalSlots),
    flash: new Float32Array(totalSlots),
    flashAlpha: new Float32Array(totalSlots),
    zoom: new Uint8Array(totalSlots),
    ...(accuracyCol ? { accuracyPenalty: new Float32Array(totalSlots).fill(-1) } : {}),
    ...(reloadCol ? { reloading: new Uint8Array(totalSlots) } : {}),
    ...(hasFlags ? { playerFlags: new Uint8Array(totalSlots) } : {}),
    frameTick: frameTicks,
  };

  // 第二遍：填充数据
  for (let i = 0; i < totalRows; i++) {
    const steamId = steamIdCol ? toString(columnAt(steamIdCol, i)) : undefined;
    if (!steamId) continue;
    const slot = slotBySteamId.get(steamId);
    const tick = tickCol ? toNumber(columnAt(tickCol, i)) : undefined;
    if (slot === undefined || tick === undefined) continue;
    const frameIndex = frameIndexByTick.get(tick);
    if (frameIndex === undefined) continue;
    const idx = frameIndex * numPlayers + slot;

    if (xCol) buffers.posX[idx] = toNumber(columnAt(xCol, i)) ?? 0;
    if (yCol) buffers.posY[idx] = toNumber(columnAt(yCol, i)) ?? 0;
    if (zCol) buffers.posZ[idx] = toNumber(columnAt(zCol, i)) ?? 0;
    if (yawCol) buffers.yaw[idx] = toNumber(columnAt(yawCol, i)) ?? 0;
    if (pitchCol) buffers.pitch[idx] = toNumber(columnAt(pitchCol, i)) ?? 0;
    if (healthCol) buffers.health[idx] = clampU8(toNumber(columnAt(healthCol, i)) ?? 0);
    if (aliveCol) buffers.alive[idx] = +!!toBool(columnAt(aliveCol, i));
    if (teamCol) buffers.team[idx] = teamNum(toNumber(columnAt(teamCol, i)));
    if (scoreCol) buffers.score[idx] = clampU8(toNumber(columnAt(scoreCol, i)) ?? 0);
    if (duckCol) buffers.duck[idx] = clampUnit(toNumber(columnAt(duckCol, i)) ?? 0);
    if (flashCol) buffers.flash[idx] = Math.max(0, toNumber(columnAt(flashCol, i)) ?? 0);
    if (flashAlphaCol) buffers.flashAlpha[idx] = clampUnit((toNumber(columnAt(flashAlphaCol, i)) ?? 0) / 255);

    if (zoomCol) {
      const scoped = scopedCol ? columnAt(scopedCol, i) : undefined;
      buffers.zoom[idx] = scoped != null && !toBool(scoped) ? 0 : clampU8(toNumber(columnAt(zoomCol, i)) ?? 0);
    }
    if (accuracyCol && buffers.accuracyPenalty) {
      const acc = toNumber(columnAt(accuracyCol, i));
      if (acc !== undefined && Number.isFinite(acc) && acc >= 0) buffers.accuracyPenalty[idx] = acc;
    }
    if (reloadCol && buffers.reloading) buffers.reloading[idx] = +!!toBool(columnAt(reloadCol, i));

    if (buffers.playerFlags) {
      const onGround = flagsCol ? ((toNumber(columnAt(flagsCol, i)) ?? 0) & 1) == 1 : false;
      buffers.playerFlags[idx] = (onGround ? 1 : 0) | (pinPulledCol && toBool(columnAt(pinPulledCol, i)) ? 2 : 0) | (armingCol && toBool(columnAt(armingCol, i)) ? 4 : 0);
    }
  }

  normalizeFlash(buffers, numFrames, numPlayers);

  const startTick = numFrames > 0 ? frameTicks[0] : 0;
  const endTick = numFrames > 0 ? frameTicks[numFrames - 1] : 0;
  const tickToFrameIndex = lowerBound(frameTicks);

  return {
    players,
    frames: buffers,
    startTick,
    endTick,
    teamAtTick: (slot, tick) => (slot < 0 || slot >= numPlayers ? 0 : buffers.team[tickToFrameIndex(tick) * numPlayers + slot]),
    frameIndexAtTick: tickToFrameIndex,
    numPlayers,
  };
}

/** 闪光持续时间归一化：把 flash 从"距峰值 tick"换算成衰减中的剩余量 */
function normalizeFlash(buffers, numFrames, numPlayers) {
  for (let slot = 0; slot < numPlayers; slot++) {
    let peakFlash = 0, peakTick = 0;
    for (let frame = 0; frame < numFrames; frame++) {
      const idx = frame * numPlayers + slot;
      const flash = buffers.flash[idx];
      if (flash <= 0) {
        peakFlash = 0;
        buffers.flash[idx] = 0;
        buffers.flashAlpha[idx] = 0;
        continue;
      }
      if (peakFlash <= 0 || Math.abs(flash - peakFlash) > 1e-4) {
        peakFlash = flash;
        peakTick = buffers.frameTick[frame];
      }
      const elapsed = (buffers.frameTick[frame] - peakTick) / TICK_RATE;
      const remaining = Math.max(0, peakFlash - elapsed);
      buffers.flash[idx] = remaining;
      buffers.flashAlpha[idx] *= Math.sqrt(Math.min(1, remaining / FLASH_DECAY_RATE));
    }
  }
}

// ── 事件后处理 ──────────────────────────────────────────────────────────────

/** 把原始事件 Map 列表 → 结构化事件对象（击杀/回合/炸弹） */
function buildEvents(rawEvents, players, startTick, teamAtTick) {
  const slotBySteamId = new Map();
  for (const player of players) slotBySteamId.set(player.steamId, player.slot);

  const events = [];
  for (const raw of rawEvents) {
    const eventName = toString(raw.get(`event_name`));
    if (!eventName) continue;
    const type = EVENT_TYPE_MAP[eventName];
    if (!type) continue;

    const tick = toNumber(raw.get(`tick`)) ?? startTick;
    const event = { tick, time: (tick - startTick) / TICK_RATE, type };

    if (type === `kill`) {
      const victimSlot = slotBySteamId.get(toString(raw.get(`user_steamid`)) ?? ``);
      const attackerSlot = slotBySteamId.get(toString(raw.get(`attacker_steamid`)) ?? ``);
      const assisterSlot = slotBySteamId.get(toString(raw.get(`assister_steamid`)) ?? ``);
      event.victimSlot = victimSlot;
      event.attackerSlot = attackerSlot;
      event.assisterSlot = assisterSlot;
      event.victimName = toString(raw.get(`user_name`));
      event.attackerName = toString(raw.get(`attacker_name`));
      if (victimSlot !== undefined) event.victimTeam = teamAtTick(victimSlot, tick);
      if (attackerSlot !== undefined) event.attackerTeam = teamAtTick(attackerSlot, tick);
      event.weapon = toString(raw.get(`weapon`));
      event.headshot = toBool(raw.get(`headshot`));
      event.noscope = toBool(raw.get(`noscope`));
      event.thrusmoke = toBool(raw.get(`thrusmoke`));
      event.attackerblind = toBool(raw.get(`attackerblind`));
      event.wallbang = (toNumber(raw.get(`penetrated`)) ?? 0) > 0;
    } else if (type === `round_end`) {
      const winner = raw.get(`winner`);
      event.roundWinner = winner === `CT` ? 3 : winner === `T` ? 2 : teamNum(toNumber(winner));
      const reason = raw.get(`reason`);
      event.roundReason = (typeof reason == `string` ? ROUND_END_REASONS.get(reason) : undefined) ?? toNumber(reason);
    }
    events.push(event);
  }
  events.sort((a, b) => a.tick - b.tick);
  return events;
}

/** 从 round_start 事件推导回合边界（合并间隔 <=8 tick 的假开局） */
function buildRounds(roundStartEvents, endTick) {
  return deriveRounds(
    roundStartEvents.filter((e) => e.type === `round_start`).map((e) => e.tick),
    endTick,
    DEFAULT_ROUND_TIME * TICK_RATE,
  );
}

/** 回合边界推导：合并临近的 round_start，计算每个回合的 liveStartTick */
function deriveRounds(startTicks, endTick, freezeDuration) {
  const sorted = [...new Set(startTicks.filter(Number.isFinite))].sort((a, b) => a - b);
  const anchors = [];
  for (let i = 0; i < sorted.length; i++) {
    let anchor = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] - sorted[i] <= 8) {
      i++;
      anchor = sorted[i];
    }
    anchors.push({ startTick: sorted[i - (i > 0 && sorted[i] - sorted[i - 1] <= 8 ? 1 : 0)] ?? anchor, anchorTick: anchor });
  }
  // 修正：上面合并逻辑简化为——
  const merged = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let anchor = start;
    while (i + 1 < sorted.length && sorted[i + 1] - sorted[i] <= 8) { i++; anchor = sorted[i]; }
    merged.push({ startTick: start, anchorTick: anchor });
  }
  while (merged.length > 1 && endTick - merged[merged.length - 1].startTick <= 8) merged.pop();

  return merged.map((r, i) => ({
    index: i,
    startTick: r.startTick,
    endTick: i + 1 < merged.length ? merged[i + 1].startTick : Math.max(r.startTick, endTick),
    liveStartTick: r.anchorTick + freezeDuration,
  }));
}

/** 从原始列推导战术暂停（timeout）状态 */
function buildTimeouts(columns) {
  const tickCol = getColumn(columns, `tick`);
  const tActiveCol = getColumn(columns, `is_terrorist_timeout`);
  const ctActiveCol = getColumn(columns, `is_ct_timeout`);
  const technicalCol = getColumn(columns, `is_technical_timeout`);
  const tCountCol = getColumn(columns, `num_terrorist_timeouts`);
  const ctCountCol = getColumn(columns, `num_ct_timeouts`);
  if (!tickCol || !tCountCol || !ctCountCol) return { maxTacticalTimeouts: 0, intervals: [], counters: [] };

  const intervals = [];
  const counters = [];
  let maxTimeouts = 0;
  let currentInterval = null;
  let prevTick = -1, prevT = -1, prevCT = -1;

  for (let i = 0; i < tickCol.length; i++) {
    const tick = toNumber(columnAt(tickCol, i));
    const tCount = toNumber(columnAt(tCountCol, i));
    const ctCount = toNumber(columnAt(ctCountCol, i));
    if (tick == null || tCount == null || ctCount == null || tick === prevTick) continue;
    prevTick = tick;

    const tRemaining = Math.max(0, Math.round(tCount));
    const ctRemaining = Math.max(0, Math.round(ctCount));
    maxTimeouts = Math.max(maxTimeouts, tRemaining, ctRemaining);
    if (tRemaining !== prevT || ctRemaining !== prevCT) {
      counters.push({ tick, tRemaining, ctRemaining });
      prevT = tRemaining;
      prevCT = ctRemaining;
    }

    const technical = technicalCol ? toBool(columnAt(technicalCol, i)) : false;
    const side = technical ? undefined : tActiveCol && toBool(columnAt(tActiveCol, i)) ? `t` : ctActiveCol && toBool(columnAt(ctActiveCol, i)) ? `ct` : undefined;
    const interval = technical || side ? { startTick: tick, endTick: tick, ...(side ? { side } : {}), technical } : undefined;

    if (!(currentInterval && interval && currentInterval.side === interval.side && currentInterval.technical === interval.technical)) {
      if (currentInterval) {
        currentInterval.endTick = tick;
        if (currentInterval.endTick > currentInterval.startTick) intervals.push(currentInterval);
      }
      currentInterval = interval;
    }
  }
  if (currentInterval) intervals.push(currentInterval);
  intervals.push(...detectTechnicalTimeouts(columns, intervals));
  intervals.sort((a, b) => a.startTick - b.startTick);
  return { maxTacticalTimeouts: maxTimeouts, intervals, counters };
}

/** 检测"技术暂停"：game_time 冻结但 tick 继续走的长间隔（>=128 tick） */
function detectTechnicalTimeouts(columns, knownIntervals) {
  const tickCol = getColumn(columns, `tick`);
  const gameTimeCol = getColumn(columns, `game_time`);
  const roundStartCol = getColumn(columns, `round_start_time`);
  if (!tickCol || !gameTimeCol || !roundStartCol) return [];

  const result = [];
  let startTick = -1, lastTick = -1, prevTick = -1;
  let prevGameTime = 0, prevRoundStart = 0;

  const flush = () => {
    if (startTick >= 0 && lastTick - startTick >= 128) {
      if (!knownIntervals.some((iv) => startTick < iv.endTick && lastTick > iv.startTick)) {
        result.push({ startTick, endTick: lastTick, technical: true });
      }
    }
    startTick = -1;
    lastTick = -1;
  };

  for (let i = 0; i < tickCol.length; i++) {
    const tick = toNumber(columnAt(tickCol, i));
    const gameTime = toNumber(columnAt(gameTimeCol, i));
    const roundStart = toNumber(columnAt(roundStartCol, i));
    if (tick == null || gameTime == null || roundStart == null || tick === prevTick) continue;

    if (prevTick >= 0) {
      const tickDelta = tick - prevTick;
      const gameDelta = gameTime - prevGameTime;
      const roundDelta = roundStart - prevRoundStart;
      const gameTimeFrozen = roundStart - gameTime;
      const isPaused = tickDelta > 0 && tickDelta <= TICK_RATE && gameDelta > 0.05 && Math.abs(roundDelta - gameDelta) < 0.03;
      const isFreeze = Math.abs(gameTimeFrozen - 20) < 0.25;
      if (isPaused && isFreeze) {
        if (startTick < 0) startTick = prevTick;
        lastTick = tick + tickDelta;
      } else flush();
    }
    prevTick = tick;
    prevGameTime = gameTime;
    prevRoundStart = roundStart;
  }
  flush();
  return result;
}

// ── 面板帧（HUD 玩家面板数据） ───────────────────────────────────────────────

function buildPanelFrames(columns, slotBySteamId, numPlayers) {
  const steamIdCol = getColumn(columns, `steamid`);
  const tickCol = getColumn(columns, `tick`);
  const totalRows = columnLength(columns);

  const tickSet = new Set();
  if (tickCol) for (let i = 0; i < totalRows; i++) {
    const tick = toNumber(columnAt(tickCol, i));
    if (tick !== undefined) tickSet.add(tick);
  }

  const frameTicks = Int32Array.from(tickSet).sort();
  const frameIndexByTick = new Map();
  for (let i = 0; i < frameTicks.length; i++) frameIndexByTick.set(frameTicks[i], i);

  const numFrames = frameTicks.length;
  const numPlayersClamped = Math.max(numPlayers, 1);
  const total = numFrames * numPlayersClamped;

  const buffers = {
    numFrames,
    frameTick: frameTicks,
    health: new Uint8Array(total),
    alive: new Uint8Array(total),
    team: new Uint8Array(total),
    armor: new Uint8Array(total),
    flags: new Uint8Array(total),
    money: new Uint16Array(total),
    equipValue: new Uint16Array(total),
    clipAmmo: new Uint16Array(total),
    reserveAmmo: new Uint16Array(total),
    activeWeapon: new Uint8Array(total),
    utilCounts: new Uint8Array(total),
  };

  // 武器名去重表（activeWeapon 存的是索引）
  const weaponNames = [``];
  const weaponIndex = new Map();
  const internWeapon = (name) => {
    if (!name) return 0;
    let idx = weaponIndex.get(name);
    if (idx === undefined) {
      if (weaponNames.length >= 256) return 0;
      idx = weaponNames.length;
      weaponNames.push(name);
      weaponIndex.set(name, idx);
    }
    return idx;
  };

  const healthCol = getColumn(columns, `health`);
  const aliveCol = getColumn(columns, `is_alive`);
  const teamCol = getColumn(columns, `team_num`);
  const armorCol = getColumn(columns, `armor_value`);
  const helmetCol = getColumn(columns, `has_helmet`);
  const defuserCol = getColumn(columns, `has_defuser`);
  const moneyCol = getColumn(columns, `balance`);
  const equipCol = getColumn(columns, `current_equip_value`);
  const clipCol = getColumn(columns, `active_weapon_ammo`);
  const reserveCol = getColumn(columns, `total_ammo_left`);
  const weaponCol = getColumn(columns, `active_weapon_name`);
  const inventoryCol = getColumn(columns, `inventory`);

  for (let i = 0; i < totalRows; i++) {
    const steamId = steamIdCol ? toString(columnAt(steamIdCol, i)) : undefined;
    if (!steamId) continue;
    const slot = slotBySteamId.get(steamId);
    const tick = tickCol ? toNumber(columnAt(tickCol, i)) : undefined;
    if (slot === undefined || tick === undefined) continue;
    const frameIndex = frameIndexByTick.get(tick);
    if (frameIndex === undefined) continue;
    const idx = frameIndex * numPlayersClamped + slot;

    if (healthCol) buffers.health[idx] = clampU8(toNumber(columnAt(healthCol, i)) ?? 0);
    if (aliveCol) buffers.alive[idx] = +!!toBool(columnAt(aliveCol, i));
    if (teamCol) buffers.team[idx] = teamNum(toNumber(columnAt(teamCol, i)));
    if (armorCol) buffers.armor[idx] = clampU8(toNumber(columnAt(armorCol, i)) ?? 0);
    buffers.flags[idx] = (helmetCol && toBool(columnAt(helmetCol, i)) ? 1 : 0) | (defuserCol && toBool(columnAt(defuserCol, i)) ? 2 : 0);
    if (moneyCol) buffers.money[idx] = clampU16(toNumber(columnAt(moneyCol, i)) ?? 0);
    if (equipCol) buffers.equipValue[idx] = clampU16(toNumber(columnAt(equipCol, i)) ?? 0);
    if (clipCol) buffers.clipAmmo[idx] = clampU16(toNumber(columnAt(clipCol, i)) ?? 0);
    if (reserveCol) buffers.reserveAmmo[idx] = clampU16(toNumber(columnAt(reserveCol, i)) ?? 0);
    if (weaponCol) buffers.activeWeapon[idx] = internWeapon(toString(columnAt(weaponCol, i)));
    buffers.utilCounts[idx] = encodeUtilityCounts(inventoryCol ? columnAt(inventoryCol, i) : undefined);
  }

  return { panelFrames: buffers, weaponNames };
}

// ── 投掷物 / 烟雾 / 弹道 / 伤害 / 炸弹 ─────────────────────────────────────

// 这些函数（buildInfernos b、buildTracers Pe、buildDamage Ie、buildBombSegments ue、
//  buildWeaponFires S、buildDroppedWeapons C、buildMapEntities T、buildDeathRagdolls E、
//  buildSmokeVoxels k）与主 bundle 里的同名逻辑一致，已在 decompiled 里可读，
// 此处省略逐行反混淆，关键点：
//   - 烟雾体素：把 wasm 的 update_ticks/update_sizes 重编码成 [tickBegin + 分块 buffer]
//   - 弹道：命中点优先匹配 player_hurt 位置，否则沿视角延伸 TRACER_LENGTH
//   - 炸弹：从 bomb_* 事件流重建 segments（carried/dropped/planted）与 defuses
//   - 伤害：player_hurt 事件 → attackerSlot/victimSlot/tick/dmg 四个并列数组

// ============================================================================
// 以下是 wasm-bindgen 自动生成的胶水代码（DemoInput 类，H），未反混淆。
// 它把 Rust 的 DemoInput 结构体导出成 JS 类，方法：new/parseHeader/parseEvents/parseRoundStream/write。
// ============================================================================

// （略，见原始 parser.worker.js 1624-1940 行）

// ============================================================================
// 解析入口 + worker 消息循环（作者手写）
// ============================================================================

/**
 * 完整解析流程（gt）：
 *   1. 读 header 拿地图名
 *   2. parseEvents 拿 round_start/round_end 推回合布局（manifest）
 *   3. parseRoundStream 流式解析各回合，每回合增量回调 onReady/onRound
 *   4. 后处理：buildFrameBuffers + buildEvents + buildRounds + 投掷物/烟雾/伤害/炸弹
 *   5. 输出 SoA 结果 + transferable ArrayBuffer 列表
 */
function parseDemo(demoBytes, options, callbacks) {
  const sampleRate = normalizeSampleRate(options.sampleRate ?? 32);
  const sampleInterval = Math.max(1, Math.round(TICK_RATE / sampleRate));
  const timings = [];

  emitProgress(callbacks, `Reading header…`, 0.1);
  const mapName = timePhase(timings, `header`, () => readHeader(demoBytes));

  emitProgress(callbacks, `Reading round layout…`, 0.12);
  const manifest = buildManifest(mapName, timePhase(timings, `manifest`, () => readManifest(demoBytes)));
  callbacks.onManifest?.(manifest);

  // 各回合数据累积容器
  const frameColumns = new Map();
  const panelColumns = new Map();
  const interner = new Map();
  const events = [], grenadeEvents = [], smokeVoxels = [], infernos = [], weaponDrops = [];
  let mapEntities, deathRagdolls, roundResult, derivationInputs;
  const isDemoInput = demoBytes instanceof DemoInput;
  const totalRounds = Math.max(1, manifest.rounds.length);

  emitProgress(callbacks, `Loading round 1…`, 0.15);

  // 每个回合解析完回调一次（流式）
  const onRoundData = (roundData) => {
    // 累积原始列
    appendColumns(frameColumns, roundData.columns, manifest.startTick, manifest.endTick, isDemoInput, interner);
    appendColumns(panelColumns, roundData.panel_columns, manifest.startTick, manifest.endTick, isDemoInput, interner);
    appendEvents(events, roundData.events, manifest.startTick, manifest.endTick);
    appendEvents(grenadeEvents, roundData.grenades, manifest.startTick, manifest.endTick);
    smokeVoxels = roundData.smoke_voxels.filter((v) => v.tick_begin >= manifest.startTick && v.tick_begin <= manifest.endTick);
    infernos = roundData.infernos.filter((v) => v.end_tick >= manifest.startTick && v.start_tick <= manifest.endTick);
    weaponDrops = (roundData.weapon_drops ?? []).filter((v) => v.end_tick >= manifest.startTick && v.start_tick <= manifest.endTick);
    mapEntities = roundData.map_entities?.filter((v) => v.end_tick > manifest.startTick && v.start_tick <= manifest.endTick);
    deathRagdolls = roundData.death_ragdolls?.filter((v) => v.tick >= manifest.startTick && v.tick <= manifest.endTick);

    const loadedRounds = Math.min(roundData.loaded_rounds, totalRounds);
    if (loadedRounds < totalRounds && !callbacks.onReady && !callbacks.onRound) {
      emitProgress(callbacks, `Loading round ${loadedRounds + 1} of ${totalRounds}…`, 0.15 + (0.8 * loadedRounds) / totalRounds);
      return;
    }

    const grouped = groupEvents(events);
    roundResult = buildPlayableData(
      frameColumns, grouped.timeline, mapName, sampleRate,
      grenadeEvents, grouped.grenade, grouped.fireBullets, grouped.playerHurt,
      panelColumns, grouped.bomb,
      options.resolveBombSites?.(mapName) ?? getBombSites(mapName),
      buildSmokeVoxels(smokeVoxels), buildInfernos(infernos),
      undefined, buildDroppedWeapons(weaponDrops), grouped.weaponFire,
      mapEntities && buildMapEntities(mapEntities, manifest.endTick + 1), deathRagdolls,
    );
    applyManifestToResult(roundResult, manifest);
    derivationInputs = buildDerivationInputs(panelColumns, grouped.fireBullets, grouped.playerHurt, grouped.bomb);

    if (loadedRounds < totalRounds) {
      if (loadedRounds === 1) callbacks.onReady?.(roundResult, manifest, loadedRounds);
      else callbacks.onRound?.(roundResult, loadedRounds);
      emitProgress(callbacks, `Loading round ${loadedRounds + 1} of ${totalRounds}…`, 0.15 + (0.8 * loadedRounds) / totalRounds);
    }
  };

  const frameColumnNames = [`X`, `Y`, `Z`, `steamid`];
  const frameEnd = isDemoInput ? manifest.endTick + 1 : undefined;
  const roundStreamArgs = [
    FRAME_FIELDS,
    sampleTicks(sampleInterval, frameEnd),
    EVENT_TYPE_MAP, // 实为事件名列表，此处简写
    frameColumnNames,
    PANEL_FIELDS,
    sampleTicks(8, frameEnd),
    Int32Array.from(manifest.rounds.map((r) => r.endTick)),
    onRoundData,
  ];

  timePhase(timings, `round stream`, () => {
    if (isDemoInput) demoBytes.parseRoundStream(...roundStreamArgs, !!(callbacks.onReady || callbacks.onRound));
    else parseRoundStreamRaw(demoBytes, ...roundStreamArgs);
  });

  if (!roundResult || !derivationInputs) throw Error(`Round parser produced no playable data.`);
  printParseTimings(timings, isDemoInput ? demoBytes.length() : demoBytes.length);
  return { data: roundResult, derivationInputs };
}

/** 读取 demo header 拿地图名 */
function readHeader(demoBytes) {
  try {
    const header = (demoBytes instanceof DemoInput ? demoBytes.parseHeader() : parseHeaderRaw(demoBytes)).get(`map_name`);
    return typeof header == `string` && header.length > 0 ? header : `unknown`;
  } catch { return `unknown`; }
}

/** 读取 round_start/round_end 事件，构建回合 manifest */
function buildManifest(mapName, roundEvents) {
  const startTicks = roundEvents.filter((e) => toString(e.get(`event_name`)) === `round_start`).map((e) => Number(e.get(`tick`))).filter(Number.isFinite).sort((a, b) => a - b).filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
  const endTicks = roundEvents.filter((e) => toString(e.get(`event_name`)) === `round_end`).map((e) => Number(e.get(`tick`))).filter(Number.isFinite).sort((a, b) => a - b);
  const endTick = endTicks[endTicks.length - 1] ?? startTicks[startTicks.length - 1] ?? 0;
  const rounds = deriveRounds(startTicks, endTick, 960);
  const startTick = rounds[0]?.startTick ?? 0;
  const lastEnd = rounds[rounds.length - 1]?.endTick ?? endTick;
  return { mapName, tickRate: TICK_RATE, startTick, endTick: lastEnd, durationSeconds: Math.max(0, lastEnd - startTick) / TICK_RATE, rounds };
}

// ── worker 消息入口 ──────────────────────────────────────────────────────────

const workerScope = self;

function post(data, transfer = []) {
  workerScope.postMessage(data, transfer);
}

/** 把结果里的所有 typed array 收集成 transferable buffer 列表（零拷贝传回主线程） */
function collectTransferables(result) {
  const frames = result.frames;
  const panel = result.panelFrames;
  const damage = result.damage;
  const smoke = result.smokeVoxels;
  return [
    frames.posX.buffer, frames.posY.buffer, frames.posZ.buffer,
    frames.yaw.buffer, frames.pitch.buffer, frames.health.buffer,
    frames.alive.buffer, frames.team.buffer, frames.score.buffer,
    frames.duck.buffer, frames.flash.buffer, frames.flashAlpha.buffer,
    frames.zoom.buffer,
    ...(frames.accuracyPenalty ? [frames.accuracyPenalty.buffer] : []),
    ...(frames.reloading ? [frames.reloading.buffer] : []),
    frames.frameTick.buffer,
    panel.frameTick.buffer, panel.health.buffer, panel.alive.buffer,
    panel.team.buffer, panel.armor.buffer, panel.flags.buffer,
    panel.money.buffer, panel.equipValue.buffer, panel.clipAmmo.buffer,
    panel.reserveAmmo.buffer, panel.activeWeapon.buffer, panel.utilCounts.buffer,
    damage.attackerSlot.buffer, damage.victimSlot.buffer, damage.tick.buffer, damage.dmg.buffer,
    smoke.tickBegin.buffer, smoke.detonation.buffer, smoke.color.buffer,
    smoke.bufferOffsets.buffer, smoke.buffers.buffer,
    ...(smoke.frameOffsets ? [smoke.frameOffsets.buffer] : []),
    ...(smoke.frameTicks ? [smoke.frameTicks.buffer] : []),
    ...(result.grenades.infernos ?? []).flatMap((inferno) => inferno.frames.flatMap((f) => [
      f.positions.buffer, f.burning.buffer,
      ...(f.origin ? [f.origin.buffer] : []),
      ...(f.parentPositions ? [f.parentPositions.buffer] : []),
      ...(f.normals ? [f.normals.buffer] : []),
    ])),
    ...(result.droppedWeapons ?? []).flatMap((w) => [w.ticks.buffer, w.positions.buffer, w.angles.buffer]),
    ...(result.mapEntities ?? []).flatMap((e) => [e.ticks.buffer, e.angles.buffer, e.hidden.buffer]),
    ...result.grenades.trajectories.flatMap((t) => (t.angles ? [t.angles.buffer] : [])),
    ...(result.weaponFires ? [result.weaponFires.ticks.buffer, result.weaponFires.slots.buffer] : []),
  ];
}

workerScope.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === `parse`) {
    try {
      post({ type: `progress`, phase: `Loading parser…`, value: 0.04 });
      await initParser(PARSER_WASM_URL);
      const result = await parseDemo(new Uint8Array(msg.bytes), msg.options, {
        onProgress: (phase, value) => post({ type: `progress`, phase, value }),
        onManifest: (manifest) => post({ type: `manifest`, manifest }),
        onReady: (data, manifest, loadedRounds) => post({ type: `ready`, data, manifest, loadedRounds }, collectTransferables(data)),
        onRound: (data, loadedRounds) => post({ type: `round`, data, loadedRounds }, collectTransferables(data)),
      });
      post({ type: `done`, data: result }, collectTransferables(result));
    } catch (err) {
      post({ type: `error`, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
