// ============================================================================
// 反混淆版本：回合时间线 / 炸弹状态 / 计时文本
// 原始压缩文件：src/app/01-timeline-utils.js（decompiled/index.beautified.js 28797–29162 行）
// 原文范围：decompiled/index.beautified.js L28797–29162（切片 01-timeline-utils）
// 说明：标识符已从压缩名（f_/p_/m_/h_/g_）重命名为语义名，常量已内联并注释，逻辑未改。
// ============================================================================

// CS2 竞技回合总时长（秒）：1:55 = 115s
const ROUND_TIME_SECONDS = 115;
// C4 炸弹引爆时间（秒）
const BOMB_EXPLODE_SECONDS = 40;

/**
 * 查询某一时刻（tick）的战术暂停状态。
 * @param {object} match 比赛数据（含 timeouts 字段）
 * @param {number} tick 当前 tick
 * @returns 已用暂停数（T/CT）、当前是否处于暂停区间、剩余时间文本
 */
function getTacticalTimeoutState(match, tick) {
  const { maxTacticalTimeouts, counters, intervals } = match.timeouts;
  let tRemaining = maxTacticalTimeouts;
  let ctRemaining = maxTacticalTimeouts;

  // 累加 tick 之前的暂停消耗
  for (const counter of counters) {
    if (counter.tick > tick) break;
    tRemaining = counter.tRemaining;
    ctRemaining = counter.ctRemaining;
  }

  // 当前 tick 是否落在某个暂停区间内
  const interval = intervals.find((i) => tick >= i.startTick && tick < i.endTick);

  return {
    tUsed: Math.max(0, maxTacticalTimeouts - tRemaining),
    ctUsed: Math.max(0, maxTacticalTimeouts - ctRemaining),
    side: interval?.side,
    technical: interval?.technical ?? false,
    timeText: interval ? formatClock((interval.endTick - tick) / match.meta.tickRate) : ``,
  };
}

/**
 * 查询某一时刻的炸弹状态（是否已下包、拆弹进度等）。
 */
function getBombState(match, tick) {
  let site = ``;
  for (const segment of match.bomb.segments) {
    if (segment.kind === `planted` && tick >= segment.startTick && tick < segment.endTick) {
      site = segment.site;
      break;
    }
  }
  const defuse = getDefuseState(match, tick); // Tg
  return {
    site,
    defusing: defuse !== null,
    defuseHasKit: defuse?.hasKit ?? false,
    defuseProgress: defuse?.progress ?? 0,
  };
}

/**
 * 查询某一回合、某一 tick 的回合阶段（freeze / live / planted / over）。
 * @param {object} match 比赛数据
 * @param {number} tick 当前 tick
 * @param {number} roundIndex 回合下标
 * @param {object} bombEvents 炸弹事件列表
 */
function getRoundPhase(match, tick, roundIndex, bombEvents) {
  // 回合还没开始（roundIndex < 0）
  if (roundIndex < 0) return { phase: `freeze`, timeText: formatClock(ROUND_TIME_SECONDS), planted: false };

  const round = match.rounds[roundIndex];
  const tickRate = match.meta.tickRate;
  const plantTick = getLastPlantTick(bombEvents, round.startTick, round.endTick, tick);

  // 已下包 → 显示炸弹倒计时
  if (plantTick !== null) {
    return { phase: `planted`, timeText: formatClock(BOMB_EXPLODE_SECONDS - (tick - plantTick) / tickRate), planted: true };
  }

  // 冻结时间（准备阶段）
  if (tick < round.liveStartTick) {
    return { phase: `freeze`, timeText: formatClock((round.liveStartTick - tick) / tickRate), planted: false };
  }

  // 正常进行
  const remaining = ROUND_TIME_SECONDS - (tick - round.liveStartTick) / tickRate;
  return remaining <= 0
    ? { phase: `over`, timeText: formatClock(0), planted: false }
    : { phase: `live`, timeText: formatClock(remaining), planted: false };
}

/**
 * 求某一 tick 之前最后一次下包的 tick（考虑之后是否被拆/被引爆）。
 */
function getLastPlantTick(bombEvents, rangeStart, rangeEnd, tick) {
  let plantTick = null;
  for (const event of bombEvents) {
    if (event.tick < rangeStart || event.tick > rangeEnd) continue;
    if (event.type === `bomb_planted` && event.tick <= tick) {
      plantTick = event.tick;
    } else if (
      (event.type === `bomb_defused` || event.type === `bomb_exploded`) &&
      plantTick !== null &&
      event.tick <= tick
    ) {
      plantTick = null; // 炸弹已被拆除/引爆，倒计时取消
    }
  }
  return plantTick;
}

/**
 * 把秒数格式化为 MM:SS。
 */
function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, `0`)}`;
}
