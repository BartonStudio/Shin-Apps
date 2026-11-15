// ============================================================================
// 反混淆版本：parser.worker —— CS2 demo 解析器的 wasm 后处理层
// 原始文件：src/workers/parser.worker.js
// 原文范围：src/workers/parser.worker.js（非切片来源；原始产物 raw/assets/parser.worker-Cvx4vjXK.js）
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
  `health,is_alive,team_num,armor_value,has_helmet,has_defuser,is_defusing,CCSPlayerPawn.m_flProgressBarStartTime,CCSPlayerPawn.m_iProgressBarDuration,bomb_site,balance,active_weapon_name,active_weapon_ammo,total_ammo_left,inventory,crosshair_code,team_clan_name,player_color,round_start_time,game_time,is_terrorist_timeout,is_ct_timeout,terrorist_timeout_remaining,ct_timeout_remaining,num_terrorist_timeouts,num_ct_timeouts,is_technical_timeout`.split(`,`);

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

// ============================================================================
// 【补充段 2026-11-09】把原先跳过的作者手写代码补全
// 依据：tools/compare-deobf-semantics.mjs --by-unit 报出的覆盖缺口
//       （作者区 24 个函数待补；bindgen 区 L1624–1949 仍按计划跳过）
// 本段覆盖 L154–323：中央装配函数 + 燃烧弹/开火/掉落武器三个构建器
// ============================================================================

// ── L154 `y` → assembleDemoData：整个 data 对象的中央装配点 ─────────────────
// 这是 worker 里唯一一个「把所有子结果拼成最终 data」的函数。
// 想知道 data 里每个字段从哪来，看这里就够了。
// 参数顺序与调用点（parseDemoCore 的 L2059）严格对应。
function assembleDemoData(
  columns,              // 主列 Map（wasm 逐帧输出）
  timelineEvents,       // round_start / round_end / player_death … 原始事件
  mapName,
  sampleRate,           // 16 / 32 / 64
  grenades,             // 投掷物轨迹原始数据
  grenadeEffects,       // 投掷物特效区
  fireBullets,          // fire_bullets 事件
  playerHurt,           // player_hurt 事件
  panelColumns,         // 面板列 Map（可为空，则退化为 new Map()）
  bombEvents,           // 炸弹事件
  bombSiteDefs,         // 本地图的下包点位（resolveBombSites 的结果）
  smokeVoxels,          // 烟雾体素
  infernos = [],        // 燃烧弹（下面 buildInfernos 的产物）
  extraGrenadeArg,      // 透传给投掷物构建器的额外参数
  droppedWeapons = [],  // 掉落武器
  weaponFireRaw = [],   // weapon_fire 原始事件
  mapEntities,          // 地图实体（可破坏物）
  deathRagdolls,        // 布娃娃采样
) {
  const panel = panelColumns ?? new Map();

  // ── 第一步：从主列 Map 拆出 players / frames / tick 区间 ──
  // M() 就是本文件里的 buildModelFromColumns；它产出 SoA 的 frames 与 players 表
  const { players, frames, startTick, endTick, teamAtTick, frameIndexAtTick, numPlayers } = buildModelFromColumns(columns);

  // ── 第二步：事件与回合 ──
  const events = buildEvents(timelineEvents, players, startTick, teamAtTick); // → N()
  const rounds = deriveRounds(events, endTick);                              // → P()

  // ── 第三、四步：面板列补进 blocks 表、收集回合计时器 ──
  stackPanelColumns(rounds, panel);                                          // → se()
  const timeouts = buildTimeouts(panel);                                     // → I()

  // steamId → slot 的反查表（后面反复用）
  const slotBySteamId = new Map();
  for (const p of players) slotBySteamId.set(p.steamId, p.slot);

  // ── 第五步：投掷物 ──
  const grenadeBundle = buildGrenades(grenades ?? [], grenadeEffects ?? [], slotBySteamId, bombSiteDefs); // → we()
  grenadeBundle.infernos = infernos;
  if (smokeVoxels) attachSmokeToEffects(smokeVoxels, grenadeBundle.effects);  // → O()

  // ── 第六步：弹道、面板帧、死亡标记、伤害、炸弹、计时器 ──
  const tracers = buildTracers(fireBullets ?? [], playerHurt ?? [], frames, numPlayers, slotBySteamId, frameIndexAtTick); // → Pe()
  const { panelFrames, weaponNames } = buildPanelFrames(panel, slotBySteamId, numPlayers);   // → Le()
  const deathMarkers = buildDeathMarkers(events, rounds, frames, frameIndexAtTick, numPlayers, endTick); // → ce()
  const damage = buildDamageEvents(playerHurt ?? [], slotBySteamId);                          // → Ie()
  const bomb = buildBombState(bombFromEvents(bombEvents ?? [], panel), rounds, slotBySteamId, endTick, bombSiteDefs ?? []); // → ue(le(...))
  const crosshairBySteamId = buildCrosshairMap(panel);   // → fe()
  for (const p of players) {
    const code = crosshairBySteamId.get(p.steamId);
    if (code) p.crosshairCode = code;
  }
  const clanBySteamId = buildClanNameMap(panel);         // → pe()
  for (const p of players) {
    const clan = clanBySteamId.get(p.steamId);
    if (clan) p.clanName = clan;
  }
  const colorBySteamId = buildPlayerColorMap(panel);     // → me()
  for (const p of players) {
    const color = colorBySteamId.get(p.steamId);
    if (color) p.color = color;
  }

  // ── 第七步：组装 ──
  const numFrames = frames.frameTick.length;
  const durationSeconds = startTick <= endTick ? (endTick - startTick) / 64 : 0;
  return {
    meta: { mapName, tickRate: 64, sampleRate, numPlayers: players.length, numFrames, startTick, endTick, durationSeconds },
    players,
    frames,
    events,
    rounds,
    grenades: grenadeBundle,
    tracers,
    smokeVoxels: smokeVoxels ?? emptySmokeVoxels(),      // → D()
    panelFrames,
    weaponNames,
    deathMarkers,
    damage,
    bomb,
    timeouts,
    droppedWeapons,
    weaponFires: buildWeaponFires(weaponFireRaw, slotBySteamId),  // → S()
    ...(mapEntities === undefined ? {} : { mapEntities }),
    ...(deathRagdolls === undefined ? {} : { deathRagdolls: mapRagdolls(deathRagdolls, slotBySteamId) }), // → E()
  };
}

// ── L217 `b` → buildInfernos：把 wasm 的燃烧弹原始帧转成 typed array ────────
// 注意三点：
//   1. 有一整轮「防御性校验」——任何一个字段类型不对就整条记录丢弃（下面 a=false）
//   2. positions / parent_positions / normals 逐帧展开成 Float32Array，长度必须一致
//   3. 帧按 tick 排序，整体按 (startTick, entityId) 排序，保证确定性输出
function buildInfernos(list) {
  const out = [];
  const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  const toVec3Array = (v, expectedLen) => {
    if (!(!Array.isArray(v) || v.length !== expectedLen || !v.every(isVec3))) return Float32Array.from(v.flat());
  };

  for (const rec of list) {
    if (
      !Number.isInteger(rec.entity_id) ||
      !Number.isInteger(rec.start_tick) ||
      !Number.isInteger(rec.end_tick) ||
      rec.end_tick <= rec.start_tick ||
      !Array.isArray(rec.frames)
    ) continue;

    const byTick = new Map();
    let ok = true;
    for (const f of rec.frames) {
      if (!Number.isInteger(f.tick) || f.tick < rec.start_tick || f.tick >= rec.end_tick) continue;
      if (
        !Array.isArray(f.positions) ||
        f.positions.length > 64 ||                 // 单帧最多 64 个火焰点
        !Array.isArray(f.burning) ||
        f.burning.length !== f.positions.length ||
        !f.burning.every((x) => typeof x === 'boolean')
      ) { ok = false; break; }
      const positions = toVec3Array(f.positions, f.positions.length);
      if (!positions) { ok = false; break; }
      byTick.set(f.tick, {
        tick: f.tick,
        positions,
        burning: Uint8Array.from(f.burning, (x) => Number(x)),
        ...(isVec3(f.origin) ? { origin: Float32Array.from(f.origin) } : {}),
        parentPositions: toVec3Array(f.parent_positions, f.positions.length),
        normals: toVec3Array(f.normals, f.positions.length),
      });
    }
    if (!ok || byTick.size === 0) continue;

    out.push({
      entityId: rec.entity_id,
      startTick: rec.start_tick,
      endTick: rec.end_tick,
      effectTick: Number.isInteger(rec.effect_tick) ? rec.effect_tick : undefined,
      infernoType: rec.inferno_type === 0 || rec.inferno_type === 1 ? rec.inferno_type : undefined,
      lifetime: typeof rec.lifetime === 'number' && Number.isFinite(rec.lifetime) && rec.lifetime > 0 ? rec.lifetime : undefined,
      frames: [...byTick.values()].sort((a, b) => a.tick - b.tick),
    });
  }
  return out.sort((a, b) => a.startTick - b.startTick || a.entityId - b.entityId);
}

// ── L274 `x` 常量 + L275 `S` → buildWeaponFires：开火事件 → (tick, slot) 两条平行数组
var WEAPON_FIRE_EVENT = 'weapon_fire';
function buildWeaponFires(rawEvents, slotBySteamId) {
  const pairs = [];
  for (const ev of rawEvents) {
    const tick = toInt(ev.get('tick'));
    const slot = slotBySteamId.get(toString(ev.get('user_steamid')) ?? '');
    // 注意这一行是「或」短路：只要 tick 或 slot 任一缺失就跳过（`||` 右侧的 push 才是正常路径）
    if (tick === undefined || !Number.isInteger(tick) || slot === undefined || pairs.push([tick, slot]));
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { ticks: Int32Array.from(pairs, ([t]) => t), slots: Uint8Array.from(pairs, ([, s]) => s) };
}

// ── L287 `C` → buildDroppedWeapons：掉落武器轨迹 ────────────────────────────
// 与 buildInfernos 结构相似但没有「全帧校验失败就丢弃」的机制：
// 单帧位置不合法只跳过那一帧（`n(t.position) && e.set(...)`）。
function buildDroppedWeapons(list) {
  const out = [];
  const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

  for (const rec of list) {
    if (
      !Number.isInteger(rec.entity_id) ||
      !Number.isInteger(rec.start_tick) ||
      !Number.isInteger(rec.end_tick) ||
      !Number.isInteger(rec.item_def) ||
      rec.end_tick <= rec.start_tick ||
      !Array.isArray(rec.frames)
    ) continue;

    const byTick = new Map();
    for (const f of rec.frames) {
      if (!Number.isInteger(f.tick) || f.tick < rec.start_tick || f.tick >= rec.end_tick) continue;
      if (isVec3(f.position)) byTick.set(f.tick, f);
    }
    if (byTick.size === 0) continue;

    const sorted = [...byTick.values()].sort((a, b) => a.tick - b.tick);
    const ticks = new Int32Array(sorted.length);
    const positions = new Float32Array(sorted.length * 3);
    const angles = new Float32Array(sorted.length * 3);
    sorted.forEach((f, i) => {
      ticks[i] = f.tick;
      positions.set(f.position, i * 3);
      if (isVec3(f.rotation)) angles.set(f.rotation, i * 3);
    });

    out.push({
      entityId: rec.entity_id,
      weapon: typeof rec.weapon_name === 'string' ? rec.weapon_name : '',
      itemDef: rec.item_def,
      startTick: rec.start_tick,
      endTick: rec.end_tick,
      ticks,
      positions,
      angles,
    });
  }
  return out.sort((a, b) => a.startTick - b.startTick || a.entityId - b.entityId);
}

// ============================================================================
// 【补充段 2026-11-09 · 二】管线管道代码（L1951–2187）
// 这段是 parseDemoCore 的上下游：wasm 初始化、进度/计时、manifest 派生与回填、事件分组。
// 逻辑本身不复杂，但要看懂「解析耗时花在哪」和「哪些事件被挑出来」必须读这里。
// ============================================================================

// ── L1951 `ct` → instantiateWasm：包住 instantiateStreaming 的 MIME 回退 ────
// 关键点：服务器若没把 .wasm 以 application/wasm 返回，instantiateStreaming 会失败；
// 这里检测到是 MIME 问题就降级为 instantiate（更慢但能跑），其余错误照常抛。
async function instantiateWasm(source, imports) {
  if (typeof Response === 'function' && source instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        return await WebAssembly.instantiateStreaming(source, imports);
      } catch (err) {
        if (source.ok && isSameOriginType(source.type) && source.headers.get('Content-Type') !== 'application/wasm') {
          console.warn(
            '`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n',
            err,
          );
        } else throw err;
      }
    }
    const bytes = await source.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const result = await WebAssembly.instantiate(source, imports);
    return result instanceof WebAssembly.Instance ? { instance: result, module: source } : result;
  }
  // 只对同源/可跨域的响应尝试 MIME 回退
  function isSameOriginType(type) {
    switch (type) {
      case 'basic':
      case 'cors':
      case 'default':
        return true;
    }
    return false;
  }
}

// ── L1980 `lt` → initParser：加载并实例化 wasm（幂等）──
async function initParser(arg) {
  if (wasmExports !== undefined) return wasmExports;
  if (arg !== undefined) {
    if (Object.getPrototypeOf(arg) === Object.prototype) ({ module_or_path: arg } = arg);
    else console.warn('using deprecated parameters for the initialization function; pass a single object instead');
  }
  if (arg === undefined) arg = new URL('/assets/csplayer_parser_bg-qigVgicw.wasm', '' + import.meta.url);

  const imports = makeWasmImports();
  if (typeof arg == 'string' || (typeof Request === 'function' && arg instanceof Request) || (typeof URL === 'function' && arg instanceof URL)) {
    arg = fetch(arg);
  }
  const { instance, module } = await instantiateWasm(await arg, imports);
  return finalizeWasm(instance, module);
}

// ── L1995–2001 一次初始化 + 对外入口 ──
var parserPromise = null;
function ensureParser(moduleOrPath) {
  return (parserPromise ??= initParser({ module_or_path: moduleOrPath })), parserPromise;
}
async function parseDemoBytes(bytes, options = {}, callbacks = {}) {
  if (!parserPromise) throw Error('Parser is not initialized. Call initParser() first.');
  await parserPromise;
  return parseDemoCore(bytes, options, callbacks).data;
}

// ── L2003 `pt` → reportProgress ──
function reportProgress(cb, phase, value = -1) {
  cb.onProgress?.(phase, value);
}

// ── L2006 `mt` → timed：把某阶段耗时记进 timings 数组并返回结果 ──
function timed(timings, phase, fn) {
  const t0 = performance.now();
  const result = fn();
  timings.push([phase, performance.now() - t0]);
  return result;
}

// ── L2011 `ht` → printTimings：控制台打印各阶段耗时占比 ──
function printTimings(timings, totalMs) {
  const sum = timings.reduce((acc, [, ms]) => acc + ms, 0) || 1;
  const rows = timings.map(([phase, ms]) => ({ phase, ms: Math.round(ms), '%': Math.round((ms / sum) * 100) }));
  console.info(`[parse] ${(totalMs / 1e6).toFixed(1)} MB demo \u2014 ${Math.round(sum)} ms total`);
  console.table(rows);
}

// ── L2097 `_t` → readRoundEvents：只取回合起止两个事件 ──
function readRoundEvents(demoInput) {
  return demoInput instanceof DemoInput
    ? demoInput.parseEvents(['round_start', 'round_end'], [], [])
    : parseEventsExternal(demoInput, ['round_start', 'round_end'], [], []);
}

// ── L2102 `vt` → buildRoundManifest：把 round_start/round_end 事件折成 manifest ──
function buildRoundManifest(mapName, roundEvents) {
  const startTicks = roundEvents
    .filter((e) => toString(e.get('event_name')) === 'round_start')
    .map((e) => Number(e.get('tick')))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .filter((v, i, arr) => i === 0 || v !== arr[i - 1]); // 去重

  const endTicks = roundEvents
    .filter((e) => toString(e.get('event_name')) === 'round_end')
    .map((e) => Number(e.get('tick')))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const lastEnd = endTicks[endTicks.length - 1] ?? startTicks[startTicks.length - 1] ?? 0;
  const rounds = deriveRoundLayout(startTicks, lastEnd, 960);   // → F()
  const startTick = rounds[0]?.startTick ?? 0;
  const endTick = rounds[rounds.length - 1]?.endTick ?? lastEnd;
  return {
    mapName,
    tickRate: 64,
    startTick,
    endTick,
    durationSeconds: Math.max(0, endTick - startTick) / 64,
    rounds,
  };
}

// ── L2120 `yt` → applyManifestToData：把 manifest 的时间段回填进已组装的 data ──
// 为什么需要它：assembleDemoData 用的是「主列里 tick 的实际范围」，
// 而 manifest 用的是「回合布局的范围」。两者可能差一点，最终以 manifest 为准。
// 注意 meta.startTick 是 tick 换算基准，这里必须同步更新。
function applyManifestToData(data, manifest) {
  const keepLive = data.rounds;
  data.meta.startTick = manifest.startTick;
  data.meta.endTick = manifest.endTick;
  data.meta.durationSeconds = manifest.durationSeconds;
  data.rounds = manifest.rounds.map((r, i) => ({ ...r, liveStartTick: keepLive[i]?.liveStartTick ?? r.liveStartTick }));
}

// ── L2127–2128 列名集合 ──
// 存字符串的列（不能当数值列处理）；下面的「要请求的列」= tick + 逐帧列 + 面板列去掉字符串列
var STRING_COLUMNS = new Set(['active_weapon_name', 'inventory', 'crosshair_code', 'team_clan_name', 'player_color']);
var WANTED_COLUMNS = new Set(['tick', ...FRAME_FIELDS, ...PANEL_FIELDS.filter((c) => !STRING_COLUMNS.has(c))]);

// ── L2155 `Ct` → collectEventsInRange：把落在 [from,to] 的事件挑出来 ──
function collectEventsInRange(out, events, fromTick, toTick) {
  for (const ev of events) {
    const tick = Number(ev.get('tick'));
    if (Number.isFinite(tick) && tick >= fromTick && tick <= toTick) out.push(ev);
  }
}

// ── L2161 `wt` → readMapName：读地图名，失败一律退成 'unknown' ──
function readMapName(demoInput) {
  try {
    const name = (demoInput instanceof DemoInput ? demoInput.parseHeader() : parseHeaderExternal(demoInput)).get('map_name');
    return typeof name === 'string' && name.length > 0 ? name : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── L2169–2171 两个额外事件名 + 事件请求清单 ──
var FIRE_BULLETS_EVENT = 'fire_bullets';
var PLAYER_HURT_EVENT = 'player_hurt';
var EVENT_REQUEST_LIST = [...new Set([...TIMELINE_EVENTS, ...GRENADE_EVENTS, FIRE_BULLETS_EVENT, PLAYER_HURT_EVENT, WEAPON_FIRE_EVENT, ...BOMB_EVENTS])];

// ── L2172 `Ot` → groupEvents：按用途把事件分到 6 个桶 ──
// 这是「哪些事件进入哪条下游管线」的唯一权威映射。
function groupEvents(events) {
  const timelineSet = new Set(TIMELINE_EVENTS);
  const grenadeSet = new Set(GRENADE_EVENTS);
  const bombSet = new Set(BOMB_EVENTS);
  const buckets = { timeline: [], grenade: [], fireBullets: [], playerHurt: [], bomb: [], weaponFire: [] };
  for (const ev of events) {
    const name = toString(ev.get('event_name')) ?? '';
    if (timelineSet.has(name)) buckets.timeline.push(ev);
    if (grenadeSet.has(name)) buckets.grenade.push(ev);
    if (bombSet.has(name)) buckets.bomb.push(ev);
    if (name === FIRE_BULLETS_EVENT) buckets.fireBullets.push(ev);
    if (name === PLAYER_HURT_EVENT) buckets.playerHurt.push(ev);
    if (name === 'weapon_fire') buckets.weaponFire.push(ev);
  }
  return buckets;
}

// ============================================================================
// 【补充段 2026-11-09 · 三】地图实体 / 布娃娃 / 烟雾体素（L325–532）
// 这四个构建器负责「非玩家、非投掷物」的可视对象：
//   地图可破坏实体、死亡布娃娃参数、烟雾体素的位图打包。
// ============================================================================

// 原件 L324 的 `var w = 0.01`：地图实体 origin 判等容差
var ORIGIN_EPS = 0.01;

// ── L325 `T` → buildMapEntities：地图可破坏实体（门/板/箱子…）的位姿时间线 ──
// 这是本文件里最复杂的一个构建器，因为它要**合并同一实体碎裂前后多段记录**：
// 同一个 class_name + 同一起点（origin 误差 ≤ w=0.01）的连续记录属于同一实体，
// 要把它们的 ticks/angles/hidden 拼成一条连续时间线。
function buildMapEntities(rawEntities, endTickCap = 2 ** 53 - 1) {
  const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

  // 第一轮：过滤 + 把 end_tick 钳到窗口上界
  const list = rawEntities
    .filter(
      (e) =>
        Number.isInteger(e.start_tick) &&
        Number.isInteger(e.end_tick) &&
        typeof e.class_name === 'string' &&
        e.class_name !== '' &&
        isVec3(e.origin) &&
        Array.isArray(e.samples),
    )
    .map((e) => ({ ...e, end_tick: Math.min(e.end_tick, endTickCap) }))
    .filter((e) => e.end_tick > e.start_tick);

  list.sort((a, b) => a.start_tick - b.start_tick || a.entity_id - b.entity_id);

  // 两个判等器：origin 近似相等；末帧的 (hidden, angles) 与待追加帧相同
  const originNear = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= ORIGIN_EPS);
  const isSameTail = (rec, angles, hiddenFlag) => {
    const last = rec.hidden.length - 1;
    return rec.hidden[last] === hiddenFlag && angles.every((a, i) => rec.angles[last * 3 + i] === a);
  };

  const out = [];
  const openAtTick = new Map(); // startTick -> 该 tick 起始、尚未关闭的实体列表

  for (const ent of list) {
    // 采样点按 tick 去重排序
    const byTick = new Map();
    for (const s of ent.samples) {
      if (!Number.isInteger(s.tick) || s.tick < ent.start_tick || s.tick >= ent.end_tick || !isVec3(s.angles)) continue;
      byTick.set(s.tick, s);
    }
    const samples = [...byTick.values()].sort((a, b) => a.tick - b.tick);
    // 没有任何采样也要产出一条「静止」记录，否则该实体在时间线上会消失
    if (samples.length === 0) samples.push({ tick: ent.start_tick, angles: [0, 0, 0], hidden: false });

    const origin = [ent.origin[0], ent.origin[1], ent.origin[2]];
    const openList = openAtTick.get(ent.start_tick) ?? [];
    // 找同一起点处是否有「同名 + 同位置」的未关闭记录 → 是则续接，否则新建
    const idx = openList.findIndex((r) => r.className === ent.class_name && originNear(r.origin, origin));
    let rec;
    if (idx >= 0) {
      rec = openList[idx];
      openList.splice(idx, 1);
    } else {
      rec = { className: ent.class_name, origin, startTick: ent.start_tick, endTick: ent.end_tick, ticks: [], angles: [], hidden: [] };
      out.push(rec);
    }

    samples.forEach((s, i) => {
      const hiddenFlag = +!!s.hidden;
      // 与上一帧完全相同时不重复记录（省内存，也是下游能做差分的前提）
      if (rec.ticks.length > 0 && isSameTail(rec, s.angles, hiddenFlag)) return;
      rec.ticks.push(i === 0 ? ent.start_tick : s.tick);
      rec.angles.push(s.angles[0], s.angles[1], s.angles[2]);
      rec.hidden.push(hiddenFlag);
    });
    rec.endTick = ent.end_tick;

    // 登记到 endTick 桶，供后续记录续接
    const bucket = openAtTick.get(ent.end_tick);
    if (bucket) bucket.push(rec);
    else openAtTick.set(ent.end_tick, [rec]);
  }

  // 输出：确定性排序 + 转 typed array
  return out
    .sort(
      (a, b) =>
        a.startTick - b.startTick ||
        a.className.localeCompare(b.className) ||
        a.origin[0] - b.origin[0] ||
        a.origin[1] - b.origin[1] ||
        a.origin[2] - b.origin[2],
    )
    .map((r) => ({
      className: r.className,
      origin: r.origin,
      startTick: r.startTick,
      endTick: r.endTick,
      ticks: Int32Array.from(r.ticks),
      angles: Float32Array.from(r.angles),
      hidden: Uint8Array.from(r.hidden),
    }));
}

// ── L399 `E` → mapRagdolls：死亡布娃娃参数（把 steamid 换成 slot）──
// wasm 侧给的是 steamid 字符串，这里转成玩家 slot；找不到对应玩家的直接丢弃。
function mapRagdolls(rawRagdolls, slotBySteamId) {
  const isNumArray = (v, len) => Array.isArray(v) && v.length === len && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  const out = [];
  for (const r of rawRagdolls) {
    const slot = slotBySteamId.get(typeof r.steamid === 'string' ? r.steamid : '');
    if (
      slot === undefined ||
      !Number.isInteger(r.tick) ||
      !Number.isInteger(r.bone) ||
      typeof r.headshot !== 'boolean' ||
      !isNumArray(r.force, 3) ||
      !isNumArray(r.eye_angles, 2)
    ) continue;
    out.push({
      tick: r.tick,
      slot,
      force: [r.force[0], r.force[1], r.force[2]],
      bone: r.bone,
      headshot: r.headshot,
      eyeAngles: [r.eye_angles[0], r.eye_angles[1]],
    });
  }
  return out.sort((a, b) => a.tick - b.tick || a.slot - b.slot);
}

// ── L421 `D` → emptySmokeVoxels：没有烟雾数据时的空结构 ──
// 注意 bufferOffsets / frameOffsets 长度是 1 而不是 0 —— 下游按「N+1 个偏移」读取，
// count=0 时仍需一个终止偏移。改动这里会让烟雾渲染崩。
function emptySmokeVoxels() {
  return {
    count: 0,
    tickBegin: new Int32Array(),
    detonation: new Float32Array(),
    color: new Float32Array(),
    bufferOffsets: new Int32Array(1),
    buffers: new Uint8Array(),
    frameOffsets: new Int32Array(1),
    frameTicks: new Int32Array(),
  };
}

// ── L433 `O` → attachSmokeToEffects：把烟雾体素的起始 tick 吸附到最近的投掷物 ──
// 为什么需要：wasm 给的 tickBegin 是「烟雾生成」估计值，而投掷物事件里有准确的
// detonate tick。这里在 5 单位（25 = 5²）内找最近的 smoke 特效点，用它的 startTick 覆盖。
function attachSmokeToEffects(smoke, effects) {
  const smokeEffects = effects.filter((e) => e.kind === 'smoke');
  if (smokeEffects.length === 0) return;
  for (let i = 0; i < smoke.count; i++) {
    const x = smoke.detonation[i * 3];
    const y = smoke.detonation[i * 3 + 1];
    const z = smoke.detonation[i * 3 + 2];
    let best = -1;
    let bestDist = 1 / 0;
    for (let k = 0; k < smokeEffects.length; k++) {
      const fx = smokeEffects[k];
      const dx = fx.x - x;
      const dy = fx.y - y;
      const dz = fx.z - z;
      if (dx * dx + dy * dy + dz * dz > 25) continue; // 超过 5 单位不考虑
      const tickDist = Math.abs(fx.startTick - smoke.tickBegin[i]);
      if (tickDist < bestDist) {
        bestDist = tickDist;
        best = k;
      }
    }
    if (best >= 0) smoke.tickBegin[i] = smokeEffects[best].startTick;
  }
}

// ── L454 `k` → buildSmokeVoxels：把烟雾体素块打包成一整块连续 buffer ──
// 数据结构是「大二进制块 + 偏移索引」：
//   buffers      所有帧的体素位图首尾相接
//   bufferOffsets 每团烟雾在 buffers 里的起始偏移（长度 count+1）
//   frameOffsets  每团烟雾在 frameTicks 里的起始下标（长度 count+1）
//   frameTicks    每团烟雾各帧对应的 tick
function buildSmokeVoxels(rawVoxels) {
  const list = rawVoxels.filter((e) => e.data && e.data.length > 0);
  const n = list.length;

  const tickBegin = new Int32Array(n);
  const detonation = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const bufferOffsets = new Int32Array(n + 1);
  const frameTicksPerGroup = list.map(parseSmokeUpdateTicks);   // → A()
  const frameOffsets = new Int32Array(n + 1);

  const totalFrames = frameTicksPerGroup.reduce((s, a) => s + a.length, 0);
  const frameTicks = new Int32Array(totalFrames);
  let totalBytes = 0;
  for (const e of list) totalBytes += e.data.length;
  const buffers = new Uint8Array(totalBytes);

  let frameCursor = 0;
  let byteCursor = 0;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    // tickBegin 优先用「首帧 tick - 1」，没有帧记录时退回 wasm 给的 tick_begin
    tickBegin[i] = frameTicksPerGroup[i].length ? frameTicksPerGroup[i][0] - 1 : e.tick_begin;
    frameOffsets[i] = frameCursor;
    frameTicks.set(frameTicksPerGroup[i], frameCursor);
    frameCursor += frameTicksPerGroup[i].length;

    detonation[i * 3] = e.detonation[0];
    detonation[i * 3 + 1] = e.detonation[1];
    detonation[i * 3 + 2] = e.detonation[2];
    color[i * 3] = e.color[0];
    color[i * 3 + 1] = e.color[1];
    color[i * 3 + 2] = e.color[2];

    bufferOffsets[i] = byteCursor;
    buffers.set(e.data, byteCursor);
    byteCursor += e.data.length;
  }
  bufferOffsets[n] = byteCursor;
  frameOffsets[n] = frameCursor;

  return { count: n, tickBegin, detonation, color, bufferOffsets, buffers, frameOffsets, frameTicks };
}

// ── L491 `A` → parseSmokeUpdateTicks：解析体素块的帧头，得出每帧的 tick ──
// data 布局：重复的 [u16 frameIndex][u16 payloadLen][payload...]。
// update_ticks / update_sizes 是 wasm 给的「每帧结束位置 + 大小」表，用来做一致性校验。
// 任何不一致都返回空数组 —— 宁可没有帧数据，也不能给出错位的时间线。
function parseSmokeUpdateTicks(voxel) {
  const updateTicks = voxel.update_ticks;
  const updateSizes = voxel.update_sizes;
  if (!updateTicks?.length || !updateSizes || updateTicks.length !== updateSizes.length) return [];

  // 前置一致性校验：tick 递增、大小合法且递增
  for (let i = 0; i < updateTicks.length; i++) {
    if (
      !Number.isInteger(updateTicks[i]) ||
      updateTicks[i] < 0 ||
      updateTicks[i] >= 2147483647 ||
      !Number.isInteger(updateSizes[i]) ||
      updateSizes[i] <= 0 ||
      updateSizes[i] > voxel.data.length ||
      (i > 0 && (updateTicks[i] < updateTicks[i - 1] || updateSizes[i] <= updateSizes[i - 1]))
    ) return [];
  }

  const out = [];
  let cursor = 0;   // 在 data 里的读写位置
  let sizeIdx = 0;  // 在 updateSizes 里的游标
  while (cursor + 4 <= voxel.data.length) {
    const frameIndex = voxel.data[cursor] | (voxel.data[cursor + 1] << 8);
    const payloadLen = voxel.data[cursor + 2] | (voxel.data[cursor + 3] << 8);
    // 帧序号必须连续；payload 至少 3 字节；不能越过 data 末尾
    if (frameIndex !== out.length || payloadLen < 3 || ((cursor += 4 + payloadLen), cursor > voxel.data.length)) return [];
    // 推进到覆盖当前 cursor 的那一帧大小
    while (sizeIdx < updateSizes.length && updateSizes[sizeIdx] < cursor) sizeIdx++;
    if (sizeIdx === updateSizes.length) return [];
    out.push(updateTicks[sizeIdx] + 1);
  }
  return cursor === voxel.data.length ? out : [];
}

// ── L519 `j` → makeLowerBoundFn：生成「二分找右边界」的闭包 ──
// 返回 i = 满足 sorted[i] <= value 的最大下标；value 小于首元素时返回 0，
// 大于末元素时返回 last。多个模块共用同一份查找逻辑。
function makeLowerBoundFn(sorted) {
  const n = sorted.length;
  return (value) => {
    if (n === 0) return 0;
    let lo = 0;
    let hi = n - 1;
    if (value <= sorted[0]) return 0;
    if (value >= sorted[hi]) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sorted[mid] <= value) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

// ============================================================================
// 【补充段 2026-11-09 · 四】炸弹段与拆包事件的**反推重建**（L962–1058）
// 关键认知：wasm 不给 bomb_begindefuse / bomb_abortdefuse 事件，也常缺 bomb_site。
// 这两个函数就是用「面板列 + 游戏事件」把缺失的信息**反推**出来：
//   le()  —— 从 is_defusing / 进度条 / game_time 反推每一次拆包（起止 tick、是否有拆弹器）
//            ，并把 bomb_site 补回到 bomb_planted 事件上
//   ue()  —— 把反推结果与真实事件合并、去重、排序，产出最终 bomb.events
// ============================================================================

// ── L962 `le` → synthesizeBombEvents ────────────────────────────────────────
// 输入：bombEvents（原始炸弹事件）、panelColumns（含 is_defusing / 进度条列）
// 输出：补齐了 bomb_site 的事件 + 合成的 begindefuse/abortdefuse 事件，按 tick 排序
function synthesizeBombEvents(bombEvents, panelColumns) {
  const tickCol = getColumn(panelColumns, 'tick');
  const steamidCol = getColumn(panelColumns, 'steamid') ?? [];
  if (!tickCol) return bombEvents;

  const bombSiteCol = getColumn(panelColumns, 'bomb_site') ?? [];
  const siteSamples = [];
  const defuseRuns = [];          // 每次拆包的原始记录
  const openByActor = new Map();  // steamid -> 进行中的拆包记录
  const defusingCol = getColumn(panelColumns, 'is_defusing') ?? [];
  const gameTimeCol = getColumn(panelColumns, 'game_time') ?? [];
  const progressStartCol = getColumn(panelColumns, 'CCSPlayerPawn.m_flProgressBarStartTime') ?? [];
  const progressDurCol = getColumn(panelColumns, 'CCSPlayerPawn.m_iProgressBarDuration') ?? [];
  const hasDefuserCol = getColumn(panelColumns, 'has_defuser') ?? [];

  // ── 第一步：逐面板帧扫描，抽出「哪一刻在下包点、谁在拆包」──
  for (let row = 0; row < tickCol.length; row++) {
    const tick = toInt(columnAt(tickCol, row));
    if (tick === undefined) continue;

    // 下包点采样：0 = A，1 = B（只记录变化点）
    const site = toInt(columnAt(bombSiteCol, row));
    if ((site === 0 || site === 1) && siteSamples[siteSamples.length - 1]?.tick !== tick) {
      siteSamples.push({ tick, site });
    }

    const actor = toString(columnAt(steamidCol, row));
    const defusing = columnAt(defusingCol, row);
    if (!actor || defusing == null) continue;

    const openRun = openByActor.get(actor);
    if (!toBool(defusing)) {
      // 拆包结束（成功/中断/放手）：关闭这条记录
      if (openRun) {
        openRun.end = Math.min(openRun.end, tick);
        openByActor.delete(actor);
      }
      continue;
    }

    // ── 从进度条反推这次拆包的「起点 tick」──
    // 游戏里进度条的起点时间存在 m_flProgressBarStartTime，配合 game_time 与当前 tick
    // 可以算出「进度条开始那一刻对应的 demo tick」。
    const duration = toInt(columnAt(progressDurCol, row));
    const hasKit = duration === 5 || (duration !== 10 && toBool(columnAt(hasDefuserCol, row)));
    const gameTime = toInt(columnAt(gameTimeCol, row));
    const barStart = toInt(columnAt(progressStartCol, row));
    const startTick =
      gameTime !== undefined && barStart !== undefined && barStart > 0 && (duration === 5 || duration === 10)
        ? Math.round(tick - (gameTime - barStart) * 64)
        : (openRun?.start ?? tick);

    // 起点必须在过去、且没超过拆包总时长（5s 有包 / 10s 无包）
    if (startTick > tick || tick >= startTick + (hasKit ? 5 : 10) * 64) continue;

    let run = openRun;
    if (!run || run.start !== startTick) {
      if (run) run.end = Math.min(run.end, startTick);
      run = { actor, start: startTick, end: tick, firstTick: tick, hasKit };
      defuseRuns.push(run);
      openByActor.set(actor, run);
    }
    // 尾部留 8 tick 余量（面板采样有延迟）
    run.end = Math.min(tick + 8, startTick + (hasKit ? 5 : 10) * 64);
  }

  // ── 第二步：把 bomb_site 补回 bomb_planted 事件 ──
  const events = bombEvents.map((ev) => {
    if (ev.get('event_name') !== 'bomb_planted') return ev;
    const tick = toInt(ev.get('tick'));
    if (tick === undefined) return ev;
    const near = siteSamples.find((s) => s.tick >= tick && s.tick <= tick + 8);
    if (!near) return ev;
    const patched = new Map(ev);
    patched.set('bomb_site', near.site);
    return patched;
  });

  // ── 第三步：把每条拆包记录展开成 begindefuse + abortdefuse 两个合成事件 ──
  const consumedBegindefuse = new Set();
  const synthesized = [];
  for (const run of defuseRuns) {
    // 若真实流里已有同一人的 bomb_begindefuse，就用真实 tick，且标记为「已消费」
    const realBegin = events.find(
      (ev) =>
        ev.get('event_name') === 'bomb_begindefuse' &&
        toString(ev.get('user_steamid')) === run.actor &&
        Number(ev.get('tick')) >= run.start - 8 &&
        Number(ev.get('tick')) <= run.firstTick,
    );
    const beginTick = realBegin ? Number(realBegin.get('tick')) : run.start;
    if (realBegin) consumedBegindefuse.add(realBegin);

    // 结束 tick = 区间内最后一条「与炸弹或本人相关」的事件
    let endTick = run.end;
    for (const ev of events) {
      const t = Number(ev.get('tick'));
      if (t <= beginTick || t > endTick) continue;
      const name = ev.get('event_name');
      const byActor = toString(ev.get('user_steamid')) === run.actor;
      if (
        name === 'bomb_planted' ||
        name === 'bomb_defused' ||
        name === 'bomb_exploded' ||
        (byActor && (name === 'bomb_abortdefuse' || name === 'bomb_begindefuse'))
      ) endTick = t;
    }
    if (endTick <= beginTick) continue;

    synthesized.push(new Map([
      ['event_name', 'bomb_begindefuse'],
      ['tick', beginTick],
      ['user_steamid', run.actor],
      ['haskit', run.hasKit],
    ]));
    synthesized.push(new Map([
      ['event_name', 'bomb_abortdefuse'],
      ['tick', endTick],
      ['user_steamid', run.actor],
    ]));
  }

  // ── 第四步：合成 abort 事件 + 未被消费的真实事件一起按 tick 排序 ──
  // 顺序很重要：abort 在前，保证「先中断再开始」的语义不被颠倒
  return [
    ...synthesized.filter((e) => e.get('event_name') === 'bomb_abortdefuse'),
    ...events.filter((e) => !consumedBegindefuse.has(e)),
    ...synthesized.filter((e) => e.get('event_name') === 'bomb_begindefuse'),
  ].sort((a, b) => Number(a.get('tick')) - Number(b.get('tick')));
}

// ============================================================================
// 【补充段 2026-11-09 · 五】事件解析器 + 技术暂停检测 + 面板列堆叠 + 死亡标记
// （L795–961）这一段是「原始事件 Map → 结构化对象」的转换层，以及几个派生量。
// ============================================================================

// ── L795 `te` → parseFireBullets：fire_bullets 事件 → 弹道起点 ──
// 注意：任何字段缺失就整条丢弃（下面那串 `||` 是靠右侧的 push 短路完成的）。
function parseFireBullets(rawEvents) {
  const out = [];
  for (const ev of rawEvents) {
    const attackerSteamId = toString(ev.get('user_steamid'));
    const tick = toInt(ev.get('tick'));
    const originX = toInt(ev.get('origin_x'));
    const originY = toInt(ev.get('origin_y'));
    const originZ = toInt(ev.get('origin_z'));
    const pitchDeg = toInt(ev.get('angles_x'));
    const yawDeg = toInt(ev.get('angles_y'));
    if (
      !attackerSteamId ||
      tick === undefined ||
      originX === undefined ||
      originY === undefined ||
      originZ === undefined ||
      pitchDeg === undefined ||
      yawDeg === undefined ||
      out.push({ tick, attackerSteamId, originX, originY, originZ, pitchDeg, yawDeg })
    ) continue;
  }
  return out;
}

// ── L816 `ne` → parsePlayerHurts：player_hurt 事件 → 命中记录 ──
function parsePlayerHurts(rawEvents) {
  const out = [];
  for (const ev of rawEvents) {
    const attackerSteamId = toString(ev.get('attacker_steamid'));
    const victimSteamId = toString(ev.get('user_steamid'));
    const tick = toInt(ev.get('tick'));
    const x = toInt(ev.get('user_X'));
    const y = toInt(ev.get('user_Y'));
    const z = toInt(ev.get('user_Z'));
    if (
      !attackerSteamId ||
      !victimSteamId ||
      tick === undefined ||
      x === undefined ||
      y === undefined ||
      z === undefined ||
      out.push({
        tick,
        attackerSteamId,
        victimSteamId,
        x,
        y,
        z,
        hitgroup: toString(ev.get('hitgroup')) ?? '',
        dmgHealth: toInt(ev.get('dmg_health')) ?? 0,
      })
    ) continue;
  }
  return out;
}

// ── L844 `re` → parseBombEvents：炸弹事件 → 带 site 字母的派生结构 ──
// 这里的 site 是「A」/「B」字符串（面板里的 bomb_site netprop 是 0/1）。
function parseBombEvents(rawEvents) {
  const out = [];
  for (const ev of rawEvents) {
    const eventName = toString(ev.get('event_name'));
    const tick = toInt(ev.get('tick'));
    if (eventName === undefined || tick === undefined) continue;
    const siteNum = toInt(ev.get('bomb_site'));
    if (!eventName || tick === undefined) continue;
    void siteNum;
    out.push({
      tick,
      eventName,
      actorSteamId: toString(ev.get('user_steamid')) ?? '',
      x: toInt(ev.get('user_X')) ?? 0,
      y: toInt(ev.get('user_Y')) ?? 0,
      z: toInt(ev.get('user_Z')) ?? 0,
      hasKit: toBool(ev.get('haskit')),
      ...(siteNum === 0 || siteNum === 1 ? { site: siteNum === 0 ? 'A' : 'B' } : {}),
    });
  }
  return out;
}

// ── L866 `ie` → buildDerivationInputs：C++ 侧可复现「派生数据」所需的全部输入 ──
// 这是 parseDemoCore 的第二个返回值（derivationInputs）。
// 目的：如果 C++ 重算派生量（弹道/伤害/炸弹事件/回合计时），需要这些原始输入才能复现。
function buildDerivationInputs(panelColumns, fireBulletsRaw, playerHurtRaw, bombEventsRaw, columns) {
  return {
    derivationVersion: 1,
    roundTiming: buildRoundTiming(columns),                        // → L()
    fireBullets: parseFireBullets(fireBulletsRaw),
    playerHurts: parsePlayerHurts(playerHurtRaw),
    bombEvents: parseBombEvents(synthesizeBombEvents(bombEventsRaw, panelColumns)),
  };
}

// ── L907 `se` → stackPanelColumns：给每个回合算出 liveStartTick（解除冻结的 tick）──
// 做法：用「game_time − tick/64」的中位数作为全局偏移，再用 round_start_time 反推。
// 为什么能这么做：CS2 的 game_time 是回合内秒表，round_start_time 是它的零基准，
// 两者与 demo tick 之间存在固定偏移，取中位数可以抗噪。
function stackPanelColumns(rounds, panelColumns) {
  const tickCol = getColumn(panelColumns, 'tick');
  const gameTimeCol = getColumn(panelColumns, 'game_time');
  const roundStartCol = getColumn(panelColumns, 'round_start_time');
  const offsets = [];
  const starts = [];
  if (!tickCol) return;

  for (let row = 0; row < tickCol.length; row++) {
    const tick = toInt(columnAt(tickCol, row));
    if (tick == null) continue;
    const game = gameTimeCol ? toInt(columnAt(gameTimeCol, row)) : undefined;
    if (game != null) offsets.push(game - tick / 64);
    const rst = roundStartCol ? toInt(columnAt(roundStartCol, row)) : undefined;
    if (rst != null && rst > 0) starts.push({ tick, rst });
  }
  if (offsets.length === 0 || starts.length === 0) return;

  offsets.sort((a, b) => a - b);
  const medianOffset = offsets[Math.floor(offsets.length / 2)];
  starts.sort((a, b) => a.tick - b.tick);

  for (const round of rounds) {
    const limit = round.endTick > round.startTick ? round.endTick : 1 / 0;
    let rst = null;
    for (const s of starts) {
      if (s.tick < round.startTick) continue;
      if (s.tick >= limit) break;
      rst = s.rst;
    }
    if (rst != null) round.liveStartTick = Math.round((rst - medianOffset) * 64);
  }
}

// ── L937 `ce` → buildDeathMarkers：击杀位置标记（屏幕上「X 在这里死的」）──
function buildDeathMarkers(events, rounds, frames, frameIndexAtTick, numPlayers, endTick) {
  const roundStarts = rounds.map((r) => r.startTick).sort((a, b) => a - b);
  const nextRoundStart = (tick) => {
    for (const t of roundStarts) if (t > tick) return t;
    return endTick;
  };

  const out = [];
  for (const ev of events) {
    if (ev.type !== 'kill') continue;
    const victimSlot = ev.victimSlot;
    if (victimSlot === undefined || victimSlot < 0 || victimSlot >= numPlayers) continue;
    const idx = frameIndexAtTick(ev.tick) * numPlayers + victimSlot;
    out.push({
      x: frames.posX[idx],
      y: frames.posY[idx],
      z: frames.posZ[idx],
      startTick: ev.tick,
      endTick: nextRoundStart(ev.tick),
      victimSlot,
      team: ev.victimTeam ?? frames.team[idx],
      name: ev.victimName ?? '',
    });
  }
  return out;
}

// ============================================================================
// 【补充段 2026-11-09 · 六】投掷物构建器（L1234–1379）—— 本文件最后一个大缺口
// 结构：
//   we()  → 对外入口，返回 { trajectories, effects }
//   Te()  → 按 entity_id 归并采样点 → 切成「一串够长且连续」的轨迹
//   Ee()  → 单条采样点 → { tick,x,y,z,kind,thrower,rotation?,incendiary? }
//   De()  → 投掷物事件（detonate 等）→ 特效区候选
//   Oe()  → 给一条轨迹找引爆 tick（优先同 entityId 的事件，否则按空间最近）
//   ke()  → 轨迹 → typed array（posXYZ / ticks / detonationTick / angles / incendiary）
//   Ae()  → 生成 effects（烟雾/燃烧/闪光各自的生命周期）
//   Se()  → 武器名 → 投掷物种类
//
// 复用文件中已定义的常量：TRAJECTORY_GAP_TICKS(32) / SMOKE_DURATION_TICKS(960) /
//   INFERNO_DURATION_TICKS(448) / FLASH_DURATION_TICKS(26) /
//   SMOKE_MAX_TICKS(1280) / INFERNO_MAX_TICKS(576)
// ============================================================================

// ── L1234 `we` → buildGrenadeBundle：对外入口 ──
function buildGrenadeBundle(rawGrenades, rawEvents, slotBySteamId, extraArg) {
  return {
    trajectories: buildGrenadeTrajectories(rawGrenades, rawEvents, slotBySteamId, extraArg), // → Te()
    effects: buildGrenadeEffects(rawEvents),                                                 // → Ae()
  };
}

// ── L1237 `Te` → buildGrenadeTrajectories ───────────────────────────────────
// 两阶段：
//   1. 按 entity_id 把采样点归并（同一个投掷物实体的连续坐标）
//   2. 同一实体里再按「间隔 ≤ 32 tick 且 kind/thrower 不变」切成若干条独立轨迹
//      且每条至少 3 个采样点才算数（少于 3 点无法拟合抛物线）
function buildGrenadeTrajectories(rawGrenades, rawEvents, slotBySteamId, overrideGroup) {
  const byEntity = new Map();
  for (const raw of rawGrenades) {
    const parsed = parseGrenadeSample(raw);   // → Ee()
    if (!parsed) continue;
    const [entityId, sample] = parsed;
    const list = byEntity.get(entityId);
    if (list) list.push(sample);
    else byEntity.set(entityId, [sample]);
  }

  const detonations = parseGrenadeEvents(rawEvents);   // → De()
  const out = [];

  for (const [entityId, samples] of overrideGroup ?? byEntity) {
    samples.sort((a, b) => a.tick - b.tick);

    let run = [];
    const flush = () => {
      if (run.length >= 3) {
        const first = run[0];
        const throwerSlot = slotBySteamId.get(first.thrower) ?? -1;
        const detonationTick = findDetonationTick(entityId, first.kind, run, detonations); // → Oe()
        out.push(toTrajectory(first.kind, throwerSlot, run, detonationTick));             // → ke()
      }
      run = [];
    };

    for (const s of samples) {
      const last = run[run.length - 1];
      // 间隔过大 / 种类变了 / 投掷者变了 → 断开，另起一条
      if (last && (s.tick - last.tick > TRAJECTORY_GAP_TICKS || s.kind !== last.kind || s.thrower !== last.thrower)) flush();
      run.push(s);
    }
    flush();
  }
  return out;
}

// ── L1268 `Ee` → parseGrenadeSample：一条采样 → [entityId, sample] ──
function parseGrenadeSample(raw) {
  const entityId = toInt(raw.get('grenade_entity_id'));
  const typeName = toString(raw.get('grenade_type'));
  const x = toInt(raw.get('x'));
  const y = toInt(raw.get('y'));
  const z = toInt(raw.get('z'));
  const tick = toInt(raw.get('tick'));
  if (entityId === undefined || !typeName || x === undefined || y === undefined || z === undefined || tick === undefined) return;
  const kind = grenadeKindOf(typeName);   // → Se()
  if (!kind) return;

  const sample = { tick, x, y, z, kind, thrower: toString(raw.get('steamid')) ?? '' };
  // 旋转只在三元数值数组时保留
  const rotation = raw.get('grenade_rotation');
  if (Array.isArray(rotation) && rotation.length === 3 && rotation.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    sample.rotation = [rotation[0], rotation[1], rotation[2]];
  }
  // 燃烧弹标记（molotov / incendiary 的区分）
  const incendiary = raw.get('grenade_incendiary');
  if (typeof incendiary === 'boolean') sample.incendiary = incendiary;
  return [entityId, sample];
}

// ── L1287 `De` → parseGrenadeEvents：投掷物事件 → 特效候选 ──
function parseGrenadeEvents(rawEvents) {
  const out = [];
  for (const raw of rawEvents) {
    const eventName = toString(raw.get('event_name'));
    const kind = eventName ? GRENADE_EVENT_KIND[eventName] : undefined;   // → Ce
    const tick = toInt(raw.get('tick'));
    const x = toInt(raw.get('x'));
    const y = toInt(raw.get('y'));
    const z = toInt(raw.get('z'));
    if (
      !kind ||
      tick === undefined ||
      x === undefined ||
      y === undefined ||
      z === undefined ||
      out.push({ entityId: toInt(raw.get('entityid')), kind, tick, x, y, z })
    ) continue;
  }
  return out;
}

// ── L1305 `Oe` → findDetonationTick：给一条轨迹找引爆 tick ──
// 优先：同 entityId 的事件（最准）
// 回退：与轨迹末点在 64 单位内（4096 = 64²）空间最近的事件
function findDetonationTick(entityId, kind, samples, events) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const candidates = events.filter((e) => e.kind === kind && e.tick >= first.tick && e.tick <= last.tick + TRAJECTORY_GAP_TICKS);

  const exact = candidates.find((e) => e.entityId === entityId);
  if (exact) return exact.tick;

  let best;
  let bestDistSq = 4096;
  for (const e of candidates) {
    const dx = e.x - last.x;
    const dy = e.y - last.y;
    const dz = e.z - last.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= bestDistSq) {
      best = e;
      bestDistSq = d2;
    }
  }
  return best?.tick;
}

// ── L1322 `ke` → toTrajectory：一条轨迹 → typed array 结构 ──
// 注意 incendiary 的判定：只有 molotov 且「有过燃烧标记的采样点中，超过半数标为 incendiary」
// 才认为这枚是 incendiary（喷火瓶），否则是普通 molotov。
function toTrajectory(kind, throwerSlot, samples, detonationTick) {
  const posXYZ = new Float32Array(samples.length * 3);
  const ticks = new Int32Array(samples.length);
  const hasRotation = samples.some((s) => s.rotation !== undefined);
  const angles = hasRotation ? new Float32Array(samples.length * 3) : undefined;
  let lastRotation = samples.find((s) => s.rotation)?.rotation ?? [0, 0, 0];
  let markedCount = 0;
  let incendiaryCount = 0;

  for (let i = 0; i < samples.length; i++) {
    posXYZ[i * 3] = samples[i].x;
    posXYZ[i * 3 + 1] = samples[i].y;
    posXYZ[i * 3 + 2] = samples[i].z;
    ticks[i] = samples[i].tick;
    if (angles) {
      lastRotation = samples[i].rotation ?? lastRotation;
      angles.set(lastRotation, i * 3);
    }
    if (samples[i].incendiary !== undefined) {
      markedCount++;
      if (samples[i].incendiary) incendiaryCount++;
    }
  }

  return {
    kind,
    throwerSlot,
    posXYZ,
    ticks,
    startTick: ticks[0],
    endTick: ticks[ticks.length - 1],
    detonationTick,
    ...(angles ? { angles } : {}),
    ...(kind === 'molotov' && markedCount > 0 ? { incendiary: incendiaryCount * 2 > markedCount } : {}),
  };
}

// ── L1348 `Ae` → buildGrenadeEffects：生成特效生命周期 ──
// 每种投掷物的 endTick 算法不同：
//   smoke   : min(过期事件 tick, 引爆 + 960)，上限引爆 + 1280
//   molotov : min(过期事件 tick, 引爆 + 448)，上限引爆 + 576
//   其他    : 引爆 + 26（闪光/HE/诱饵）
function buildGrenadeEffects(rawEvents) {
  // 先扫一遍收集「expired / expire」事件的 tick，按 entityid 建表
  const expireTickByEntity = new Map();
  for (const raw of rawEvents) {
    const eventName = toString(raw.get('event_name'));
    const entityId = toInt(raw.get('entityid'));
    const tick = toInt(raw.get('tick'));
    if (entityId === undefined || tick === undefined) continue;
    if (eventName === 'smokegrenade_expired' || eventName === 'inferno_expire') expireTickByEntity.set(entityId, tick);
  }

  const out = [];
  for (const raw of rawEvents) {
    const eventName = toString(raw.get('event_name'));
    if (!eventName) continue;
    const kind = GRENADE_EVENT_KIND[eventName];
    if (!kind) continue;
    const x = toInt(raw.get('x'));
    const y = toInt(raw.get('y'));
    const z = toInt(raw.get('z'));
    const startTick = toInt(raw.get('tick'));
    if (x === undefined || y === undefined || z === undefined || startTick === undefined) continue;

    const entityId = toInt(raw.get('entityid'));
    let endTick;
    if (kind === 'smoke') {
      const expired = entityId === undefined ? undefined : expireTickByEntity.get(entityId);
      endTick = Math.min(expired ?? startTick + SMOKE_DURATION_TICKS, startTick + SMOKE_MAX_TICKS);
    } else if (kind === 'molotov') {
      const expired = entityId === undefined ? undefined : expireTickByEntity.get(entityId);
      endTick = Math.min(expired ?? startTick + INFERNO_DURATION_TICKS, startTick + INFERNO_MAX_TICKS);
    } else {
      endTick = startTick + FLASH_DURATION_TICKS;
    }
    out.push({ kind, x, y, z, startTick, endTick });
  }
  out.sort((a, b) => a.startTick - b.startTick);
  return out;
}

// ── L1213 `Se` → grenadeKindOf：武器/实体名 → 投掷物种类 ──
// 顺序敏感：先判 smoke/flash，再判 molotov（含 incendiary/inferno 两种写法），最后 decoy/he。
function grenadeKindOf(typeName) {
  const t = typeName.toLowerCase();
  if (t.includes('smoke')) return 'smoke';
  if (t.includes('flash')) return 'flash';
  if (t.includes('molotov') || t.includes('incendiary') || t.includes('inferno')) return 'molotov';
  if (t.includes('decoy')) return 'decoy';
  if (t.includes('he')) return 'he';
  return null;
}

// ── L1227 `Ce` → GRENADE_EVENT_KIND：事件名 → 投掷物种类 ──
var GRENADE_EVENT_KIND = {
  smokegrenade_detonate: 'smoke',
  hegrenade_detonate: 'he',
  flashbang_detonate: 'flash',
  inferno_startburn: 'molotov',
  decoy_started: 'decoy',
};

// ── L1382 `Ne` → hitgroupHeight：命中部位 → 弹道绘制高度 ──
// 只影响曳光的视觉终点高度，不影响伤害判定。
function hitgroupHeight(hitgroup) {
  switch (hitgroup) {
    case 'head':
    case 'neck':
      return 64;
    case 'chest':
    case 'generic':
      return 52;
    case 'left_arm':
    case 'right_arm':
      return 48;
    case 'stomach':
      return 40;
    case 'pelvis':
      return 32;
    case 'left_leg':
    case 'right_leg':
      return 18;
    default:
      return 48;
  }
}

// ============================================================================
// 【补充段 2026-11-09 · 七】炸弹状态机 + 玩家属性反查表（L1059–1206）
// ============================================================================

// ── L1059 `ue` → buildBombState：炸弹事件的**状态机**，产出 segments + defuses ──
// segments：炸弹的连续状态段（carried 携带 / dropped 掉落 / planted 已下包）
// defuses ：每一次拆包尝试（含 defuserSlot / hasKit / 起止 tick）
//
// 状态机规则（关键，改错会直接导致 HUD 显示错）：
//   bomb_pickup    → 关闭当前段，开 carried 段（记录 carrierSlot）
//   bomb_dropped   → 关闭当前段，开 dropped 段（记录落点坐标）
//   bomb_planted   → 关闭当前段 + 关闭拆包段，开 planted 段（site 缺失时按坐标就近推断）
//   bomb_begindefuse → 关闭拆包段，开新拆包段
//   bomb_abortdefuse → 只有「同一人」的 abort 才关闭拆包段
//   bomb_defused / bomb_exploded / round_start → 全部关闭
// 收尾时把拆包段的 endTick 钳到「起始 + 5s(有包) / 10s(无包)」。
function buildBombState(bombEvents, rounds, slotBySteamId, endTick, bombSiteDefs) {
  const events = [];
  for (const raw of bombEvents) {
    const kind = toString(raw.get('event_name'));
    if (!kind) continue;
    events.push({
      tick: toInt(raw.get('tick')) ?? 0,
      kind,
      slot: slotBySteamId.get(toString(raw.get('user_steamid')) ?? '') ?? -1,
      x: toInt(raw.get('user_X')) ?? 0,
      y: toInt(raw.get('user_Y')) ?? 0,
      z: toInt(raw.get('user_Z')) ?? 0,
      hasKit: toBool(raw.get('haskit')),
      site: toInt(raw.get('bomb_site')) === 0 ? 'A' : toInt(raw.get('bomb_site')) === 1 ? 'B' : '',
    });
  }
  // 每个回合起点也当作「炸弹状态重置」注入
  for (const r of rounds) {
    events.push({ tick: r.startTick, kind: 'round_start', slot: -1, x: 0, y: 0, z: 0, hasKit: false, site: '' });
  }
  events.sort((a, b) => a.tick - b.tick);

  const segments = [];
  const defuses = [];
  let segment = null;
  let defuse = null;

  const closeSegment = (tick) => {
    if (segment && tick > segment.startTick) {
      segment.endTick = tick;
      segments.push(segment);
    }
    segment = null;
  };
  const closeDefuse = (tick) => {
    if (defuse) {
      defuse.endTick = tick;
      defuses.push(defuse);
    }
    defuse = null;
  };

  for (const e of events) {
    switch (e.kind) {
      case 'bomb_pickup':
        closeSegment(e.tick);
        segment = { kind: 'carried', startTick: e.tick, endTick: e.tick, x: 0, y: 0, z: 0, carrierSlot: e.slot, site: '' };
        break;
      case 'bomb_dropped':
        closeSegment(e.tick);
        segment = { kind: 'dropped', startTick: e.tick, endTick: e.tick, x: e.x, y: e.y, z: e.z, carrierSlot: -1, site: '' };
        break;
      case 'bomb_planted':
        closeSegment(e.tick);
        closeDefuse(e.tick);
        segment = {
          kind: 'planted', startTick: e.tick, endTick: e.tick, x: e.x, y: e.y, z: e.z, carrierSlot: -1,
          // site 缺失时按落点坐标就近推断（nearestBombSite）
          site: e.site || nearestBombSite(bombSiteDefs, e.x, e.y),
        };
        break;
      case 'bomb_begindefuse':
        closeDefuse(e.tick);
        defuse = { startTick: e.tick, endTick: e.tick, hasKit: e.hasKit, defuserSlot: e.slot };
        break;
      case 'bomb_abortdefuse':
        // 只关闭「同一个人」的拆包段 —— 别人放手不影响
        if (defuse?.defuserSlot === e.slot) closeDefuse(e.tick);
        break;
      case 'bomb_defused':
      case 'bomb_exploded':
      case 'round_start':
        closeSegment(e.tick);
        closeDefuse(e.tick);
        break;
    }
  }
  closeSegment(endTick);
  closeDefuse(endTick);

  // 拆包时长上限：有拆弹器 5s，没有 10s
  for (const d of defuses) {
    const limit = d.startTick + (d.hasKit ? 5 : 10) * 64;
    if (d.endTick > limit) d.endTick = limit;
  }
  return { segments, defuses };
}

// ── L1148 `de` → nearestBombSite：按 (x,y) 平面距离找最近的下包点字母 ──
function nearestBombSite(sites, x, y) {
  let letter = '';
  let bestSq = 1 / 0;
  for (const s of sites) {
    const dx = s.x - x;
    const dy = s.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestSq) {
      bestSq = d2;
      letter = s.letter;
    }
  }
  return letter;
}

// ── L1159 `fe` → buildCrosshairMap：steamid → 准星分享码（只收 CSGO- 开头的）──
function buildCrosshairMap(panelColumns) {
  const out = new Map();
  const steamidCol = getColumn(panelColumns, 'steamid');
  const codeCol = getColumn(panelColumns, 'crosshair_code');
  if (!steamidCol || !codeCol) return out;
  for (let row = 0; row < steamidCol.length; row++) {
    const id = toString(columnAt(steamidCol, row));
    const code = toString(columnAt(codeCol, row));
    // 只保留第一条有效值（同一玩家在不同帧可能重复出现）
    if (id && code && code.startsWith('CSGO') && !out.has(id)) out.set(id, code);
  }
  return out;
}

// ── L1171 `pe` → buildClanNameMap：steamid → 战队名 ──
// 排除 "CT" / "TERRORIST"（那是默认队名，不是战队名）。
function buildClanNameMap(panelColumns) {
  const out = new Map();
  const steamidCol = getColumn(panelColumns, 'steamid');
  const clanCol = getColumn(panelColumns, 'team_clan_name');
  if (!steamidCol || !clanCol) return out;
  for (let row = 0; row < steamidCol.length; row++) {
    const id = toString(columnAt(steamidCol, row));
    const clan = toString(columnAt(clanCol, row))?.trim();
    if (!id || !clan || out.has(id) || clan === 'CT' || clan === 'TERRORIST' || out.set(id, clan)) continue;
  }
  return out;
}

// ── L1183 `me` → buildPlayerColorMap：steamid → 出现次数最多的颜色名 ──
function buildPlayerColorMap(panelColumns) {
  const out = new Map();
  const steamidCol = getColumn(panelColumns, 'steamid');
  const colorCol = getColumn(panelColumns, 'player_color');
  if (!steamidCol || !colorCol) return out;

  // 先按玩家统计每种颜色的出现次数
  const tally = new Map();
  for (let row = 0; row < steamidCol.length; row++) {
    const id = toString(columnAt(steamidCol, row));
    const color = toString(columnAt(colorCol, row));
    if (!id || !isKnownPlayerColor(color)) continue;
    let perPlayer = tally.get(id);
    if (!perPlayer) tally.set(id, (perPlayer = new Map()));
    perPlayer.set(color, (perPlayer.get(color) ?? 0) + 1);
  }
  // 取每个玩家的众数
  for (const [id, counts] of tally) {
    let best;
    let bestCount = 0;
    for (const [color, n] of counts) {
      if (n > bestCount) {
        best = color;
        bestCount = n;
      }
    }
    if (best) out.set(id, best);
  }
  return out;
}

// ── L1204 `he` → isKnownPlayerColor ──
function isKnownPlayerColor(color) {
  return PLAYER_COLOR_NAMES.includes(color ?? '');
}

// ============================================================================
// 【补充段 2026-11-09 · 八】弹道/曳光构建器（L1404–1479）—— 最后一个真实缺口
// 逻辑要点：把「开火事件（起点+朝向）」和「命中事件（终点）」按 攻击者@tick 配对。
// 配上了 → 曳光画到命中点（hit=1）；配不上 → 沿准星方向画固定长度（hit=0）。
// ============================================================================

// ── L1404 `Pe` → buildTracers ───────────────────────────────────────────────
// 参数：fireBullets(开火), playerHurt(命中), frames, numPlayers, slotBySteamId, frameIndexAtTick
function buildTracers(fireBulletsRaw, playerHurtRaw, frames, numPlayers, slotBySteamId, frameIndexAtTick) {
  // 第一遍：把命中点按「攻击者@tick」分桶（同一 tick 可能有多发命中）
  const hitsByKey = new Map();
  for (const ev of playerHurtRaw) {
    const attacker = toString(ev.get('attacker_steamid'));
    const tick = toInt(ev.get('tick'));
    const x = toInt(ev.get('user_X'));
    const y = toInt(ev.get('user_Y'));
    const z = toInt(ev.get('user_Z'));
    if (!attacker || tick === undefined || x === undefined || y === undefined || z === undefined) continue;
    const key = `${attacker}@${tick}`;
    // 命中点高度按命中部位上抬（hitgroupHeight）
    const hitPoint = { x, y, z: z + hitgroupHeight(toString(ev.get('hitgroup')) ?? '') };
    const bucket = hitsByKey.get(key);
    if (bucket) bucket.push(hitPoint);
    else hitsByKey.set(key, [hitPoint]);
  }

  // 第二遍：逐条开火事件算终点
  const rows = [];
  for (const ev of fireBulletsRaw) {
    const shooter = toString(ev.get('user_steamid'));
    const tick = toInt(ev.get('tick'));
    const ox = toInt(ev.get('origin_x'));
    const oy = toInt(ev.get('origin_y'));
    const oz = toInt(ev.get('origin_z'));
    const anglesX = toInt(ev.get('angles_x'));
    const anglesY = toInt(ev.get('angles_y'));
    if (!shooter || tick === undefined || ox === undefined || oy === undefined || oz === undefined || anglesX === undefined || anglesY === undefined) continue;

    const slot = slotBySteamId.get(shooter);
    if (slot === undefined) continue;

    // 角度 → 单位方向向量（Source2：pitch 绕 Y、yaw 绕 Z，Z-up）
    const yaw = anglesY * DEG_TO_RAD;
    const pitch = anglesX * DEG_TO_RAD;
    const cosPitch = Math.cos(pitch);
    const dirX = Math.cos(yaw) * cosPitch;
    const dirY = Math.sin(yaw) * cosPitch;
    const dirZ = -Math.sin(pitch);

    const bucket = hitsByKey.get(`${shooter}@${tick}`);
    // 同一 tick 多发命中时，取「与射线夹角最小」的那个（consumeNearestHit）
    const hit = bucket && bucket.length > 0 ? consumeNearestHit(bucket, ox, oy, oz, dirX, dirY, dirZ) : null;

    let ex, ey, ez, hitFlag;
    if (hit) {
      ex = hit.x; ey = hit.y; ez = hit.z; hitFlag = 1;
    } else {
      // 没配上命中：沿方向画固定长度（TRACER_LENGTH = 4096）
      ex = ox + dirX * TRACER_LENGTH;
      ey = oy + dirY * TRACER_LENGTH;
      ez = oz + dirZ * TRACER_LENGTH;
      hitFlag = 0;
    }

    const frameIdx = frameIndexAtTick(tick);
    const team = frames.team[frameIdx * numPlayers + slot] ?? 0;
    rows.push({ ox, oy, oz, ex, ey, ez, tick, team, hit: hitFlag });
  }
  rows.sort((a, b) => a.tick - b.tick);

  const n = rows.length;
  const origin = new Float32Array(n * 3);
  const end = new Float32Array(n * 3);
  const tickArr = new Int32Array(n);
  const teamArr = new Uint8Array(n);
  const hitKind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    origin[i * 3] = r.ox; origin[i * 3 + 1] = r.oy; origin[i * 3 + 2] = r.oz;
    end[i * 3] = r.ex; end[i * 3 + 1] = r.ey; end[i * 3 + 2] = r.ez;
    tickArr[i] = r.tick;
    teamArr[i] = r.team;
    hitKind[i] = r.hit;
  }
  return { origin, end, tick: tickArr, team: teamArr, hitKind, count: n };
}

// ── L1468 `Fe` → consumeNearestHit：从命中桶里取「最贴合射线方向」的一个并移除 ──
// 判据是归一化点积（越大越贴合）；`|| 1` 防止零距离时除零。
function consumeNearestHit(bucket, ox, oy, oz, dirX, dirY, dirZ) {
  let bestIdx = -1;
  let bestDot = -1 / 0;
  for (let i = 0; i < bucket.length; i++) {
    const dx = bucket[i].x - ox;
    const dy = bucket[i].y - oy;
    const dz = bucket[i].z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const dot = (dx * dirX + dy * dirY + dz * dirZ) / len;
    if (dot > bestDot) {
      bestDot = dot;
      bestIdx = i;
    }
  }
  return bestIdx < 0 ? null : bucket.splice(bestIdx, 1)[0];
}


// ============================================================================
// 【改动记录 2026-11-09】本次对 worker 的两处改动
// 原件（src/workers/parser.worker.js）**未改动**，改动只落在本文件与 speed-columns.js。
// ============================================================================
//
// ── 改动 1：新增速度两列的生产（frames.speed / frames.smoothSpeed）──────────
//
// 位置：parseDemoCore() 的逐回合回调里，assembleDemoData 装配完 data 之后、回调之前。
// 原件的对应行（bundle L2079 附近）是：
//
//     yt(O, c),                                  // 修正 meta
//     (A = ie(f, o.fireBullets, o.playerHurt, o.bomb)),   // 派生输入
//     a < j && (a === 1 ? r.onReady?.(O, c, a) : r.onRound?.(O, a), …)
//
// 改成（插在 yt(O, c) 之后）：
//
//     yt(O, c),
//     (speedCarry = cloneCarry(computeSpeedColumns(O, speedCarry))),
//     (A = ie(f, …)),
//     …
//
// 另外两处配套改动：
//   · gt() 的 let 链里加一个 speedCarry（跨回合增量用，见下）
//   · collectTransferables()（bundle L2209 的 jt）里加两行（无条件，不做空值判断）：
//         t.speed.buffer,
//         t.smoothSpeed.buffer,
//     不加的话两列会退化成结构化克隆（多一次拷贝），功能不受影响。
//
// 为什么要 carry 还要 clone：
//   data.frames.speed 的 buffer 会通过 postMessage **转移**给主线程，转移后原对象失效。
//   所以下一回合增量计算时必须持有一份自己的拷贝 —— 这就是 cloneCarry() 的作用。
//
// 为什么增量：
//   smoothSpeed 的每个值都要回溯 1 秒（64 tick）窗口。全量重算 114 326 帧 × 10 人
//   约 73M 次迭代 / 2 秒；按回合增量后总耗时约等于「算一遍」，不会随回合数平方增长。
//
// 算法与常量见 → src/deobfuscated/speed-columns.js
// 契约（含分窗历史要求）见 → docs/07-data-contract.md §3.5 + 附录 F
//
// ── 改动 2：彻底移除 equipValue ─────────────────────────────────────────────
//
// 它是 CS2 netprop `current_equip_value`（玩家当前装备的美元总价）。
// 原件里四步俱全（分配 / 解码 / 传输 / 序列化进 .csda），但**全库零读取**。
// 本文件已删掉下面 4 处，并把它从 PANEL_FIELDS 的抓取列表里去掉：
//
//   · PANEL_FIELDS 抓取列表里的那一项（紧跟在 balance 后面）
//   · buildPanelFrames 里为它分配的 Uint16Array 缓冲区
//   · getColumn() 取列的那一行
//   · 逐行解码写入那个缓冲区的那一行
//   · collectTransferables 传输列表里的对应项
//
// 对比：`balance`（余额）→ `money` 有消费者（记分板），所以保留。
