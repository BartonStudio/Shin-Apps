// ============================================================================
// 反混淆版本：数值工具 + 拆包状态机 + 连续击杀回放分组
// 原文范围：decompiled/index.beautified.js L28487–28584（切片 00d-bomb-defuse）
// 压缩名：wg = clamp，Tg = computeDefuseState，Eg = secondsToTicks，
//         Dg = KillReplayGroups，Og = isCountedKill
// 依赖：无（本文件是底层工具，被 00c 与 28-radar 的 Player 调用）
//
// 三个互不相关的模块被 Vite 打在同一段里：
//   1. wg  —— 全站共用的 clamp（00c 的播放时钟也用它）
//   2. Tg  —— 「当前这一刻的拆包状态」纯函数（HUD/玩家面板要用）
//   3. Dg  —— 连续击杀回放（一次多杀后的镜头回放）的分组与推进
// ============================================================================

// ── 1. clamp ────────────────────────────────────────────────────────────────
function wg(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── 2. 拆包状态 ─────────────────────────────────────────────────────────────
// 返回 null 表示「当前没有正在进行且有效的拆包」，否则返回进度快照。
//
// 关键规则（都在下面的条件里）：
//   · 只有炸弹处于 planted 段内才可能存在拆包
//   · 拆包时长：有拆弹器 5 秒，没有 10 秒
//   · 一旦拆到 min(endTick, startTick + 时长) 就算这次拆包结束（成功或被打断）
//   · 若拆包者在这段时间内被击杀，这次拆包作废（要跳过，找下一条）
function Tg(data, tick) {
  // 先快速判掉：没有 planted 段直接返回 null，避免下面遍历拆包记录
  if (!data.bomb.segments.some((s) => s.kind === 'planted' && tick >= s.startTick && tick < s.endTick)) return null;

  for (const defuse of data.bomb.defuses) {
    const durationSeconds = defuse.hasKit ? 5 : 10;
    const completeTick = defuse.startTick + durationSeconds * data.meta.tickRate;

    if (
      tick < defuse.startTick || // 还没开始
      tick >= Math.min(defuse.endTick, completeTick) || // 已结束（完成或中断）
      // 拆包者在拆包期间被击杀 → 本次无效
      data.events.some(
        (ev) => ev.type === 'kill' && ev.victimSlot === defuse.defuserSlot && ev.tick >= defuse.startTick && ev.tick <= tick,
      )
    ) {
      continue;
    }

    const elapsedSeconds = (tick - defuse.startTick) / data.meta.tickRate;
    return {
      defuserSlot: defuse.defuserSlot,
      hasKit: defuse.hasKit,
      durationSeconds,
      remainingSeconds: Math.max(0, durationSeconds - elapsedSeconds),
      progress: Math.max(0, Math.min(1, elapsedSeconds / durationSeconds)),
    };
  }
  return null;
}

// ── 3. 秒 → tick 数（向上取整，至少 1）─────────────────────────────────────
// 用于「再等 N 秒就过期」这类判定。tickRate 为 0 时会得到 0，调用方需自行保证 tickRate > 0。
function Eg(fromTick, toTick, tickRate) {
  const diff = fromTick - toTick;
  return diff > 0 ? Math.max(1, Math.round((diff * 1e3) / tickRate)) : 0;
}

// ── 4. 连续击杀回放分组 ─────────────────────────────────────────────────────
// 用途：跟拍某个玩家时，如果他一波连续击杀，就把这一段做成一次「回放」，
// 在屏幕上叠一个击杀串烧面板。
//
// 分组规则（见 buildGroups）：
//   · 只统计 roundStartTick..roundEndTick 之间、攻击者是「被跟拍者」的击杀
//   · 相邻两杀间隔 ≤ 6 秒 → 归为同一组（连续击杀）
//   · 一组的有效期再往后延 10 秒（expiresTick），但不超出回合结束
class KillReplayGroups {
  group = null;
  context = null;
  groups = [];
  dismissedGroup = null;

  // 每帧调用。context 变化（换跟拍对象/换回合/tickRate 变化…）才重建分组。
  update(tick, followedSlot, roundStartTick, tickRate, numPlayers, events, roundEndTick) {
    const ctx = this.context;
    if (
      !ctx ||
      ctx.events !== events || // 事件表换了（换窗口/换回合数据）
      ctx.followedSlot !== followedSlot ||
      ctx.roundStartTick !== roundStartTick ||
      ctx.roundEndTick !== roundEndTick ||
      ctx.tickRate !== tickRate ||
      ctx.numPlayers !== numPlayers
    ) {
      this.context = { events, followedSlot, roundStartTick, roundEndTick, tickRate, numPlayers };
      this.groups = this.buildGroups(this.context);
    }

    // 找出「当前正在展示的那一组」：kills[0].tick <= tick < expiresTick
    let active = null;
    for (const g of this.groups) {
      if (g.kills[0].tick > tick) break; // groups 按时间升序，可提前退出
      if (tick < g.expiresTick) active = g;
    }

    // 用户手动关掉了某组 → 在它仍然有效期间不要重新弹出来
    if (
      active &&
      this.dismissedGroup &&
      active.attackerSlot === this.dismissedGroup.attackerSlot &&
      active.roundStartTick === this.dismissedGroup.roundStartTick &&
      active.kills[0].tick === this.dismissedGroup.kills[0].tick
    ) {
      this.group = null;
    } else {
      this.dismissedGroup = null;
      this.group = active;
    }
  }

  dismiss() {
    this.dismissedGroup = this.group;
    this.group = null;
  }

  reset() {
    this.group = null;
    this.dismissedGroup = null;
  }

  // 把事件流切成一串「连续击杀组」
  buildGroups(ctx) {
    const { events, followedSlot, roundStartTick, roundEndTick, tickRate, numPlayers } = ctx;
    const out = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      out.push({
        attackerSlot: followedSlot,
        roundStartTick,
        kills: current,
        // 最后一个击杀之后再留 10 秒展示时间，但不超过回合结束
        expiresTick: Math.min(roundEndTick, current[current.length - 1].tick + 10 * tickRate),
      });
    };

    for (const ev of events) {
      if (ev.tick < roundStartTick) continue;
      if (ev.tick >= roundEndTick) break;
      if (!isCountedKill(ev, followedSlot, numPlayers)) continue;
      if (current && ev.tick - current[current.length - 1].tick <= 6 * tickRate) {
        current.push(ev); // 6 秒内 → 同一波
      } else {
        flush();
        current = [ev];
      }
    }
    flush();
    return out;
  }
}

// 判定一条事件是否算「该玩家的有效击杀」。
// 排除 world（环境伤害致死，如摔死/自己烧死），排除自杀，
// 并要求 attacker/victim 的 slot 都落在 [0, numPlayers)。
function Og(ev, followedSlot, numPlayers) {
  return (
    ev.type === 'kill' &&
    followedSlot >= 0 &&
    followedSlot < numPlayers &&
    ev.attackerSlot === followedSlot &&
    ev.victimSlot !== undefined &&
    ev.victimSlot >= 0 &&
    ev.victimSlot < numPlayers &&
    ev.victimSlot !== followedSlot &&
    ev.weapon !== 'world'
  );
}
