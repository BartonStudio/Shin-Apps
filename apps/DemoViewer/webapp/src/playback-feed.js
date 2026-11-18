// =============================================================================
// playback-feed.js —— 播放数据流：把 native 游标时刻的世界快照流到前端
//
// 数据流（P1）：
//   native 播放时钟推游标 → Playback Publish DataChannelChanged("state") 节拍
//   → 桥把事件帧转发给已订阅的前端（event.data = state 通道快照，桥自动读取）
//   → 前端拉 World "snapshot" 拿当前时刻全量快照 → onUpdate
//
// 契约：Publish 只发信号（state 通道快照很小），大快照走拉取——
// 与 progress 通道的设计一致（docs/cs2-demo-player-architecture.md §4.8）。
//
// 用法：
//   const close = await openPlaybackFeed((snap, state) => { render(snap); });
//   ...
//   close();
// =============================================================================

import { decode } from '@msgpack/msgpack';
import { getClient } from './iobject.js';

/**
 * 打开播放数据流。
 *
 * @param {(snap: object, state: object) => void} onUpdate
 *   snap = World "snapshot" 通道载荷：
 *     { tick, players:[{id,name,team,teamSlot,pos,view,alive,weapon,kills,...}],
 *       entities:[{id,kind,pos}], recentKills:[{tick,killer,victim,weapon,headshot}] }
 *   state = Playback "state" 通道载荷：{ playing, speed, currentTick }
 * @returns {Promise<() => void>} 取消函数（幂等）
 */
export async function openPlaybackFeed(onUpdate) {
  const client = getClient();
  if (!client) throw Error('IObject 未连接');
  const world = await client.root.getChildItem('World');
  const playback = await client.root.getChildItem('Playback');

  let lastTick = -1;
  let lastPlaying = null;

  /** 拉一帧快照并回调；tick 与播放状态都没变时跳过（seek/播放都体现为 tick 变化） */
  async function pull(state) {
    try {
      const snap = decode(await world.readData('snapshot'));
      if (snap.tick === lastTick && state.playing === lastPlaying) return;
      lastTick = snap.tick;
      lastPlaying = state.playing;
      onUpdate(snap, state);
    } catch {
      // 通道瞬态错误（重载/断开中）：丢弃本帧，等下一拍
    }
  }

  // 挂载即出第一帧（订阅前的当前状态）
  try {
    const state = decode(await playback.readData('state'));
    await pull(state);
  } catch { /* 桥未就绪时静默，等节拍驱动 */ }

  // 节拍订阅：event.data 是桥自动附带的 Playback "state" 通道快照
  const subscription = await playback.subscribe('DataChannelChanged', (event) => {
    let state;
    try {
      state = event.data ? decode(event.data) : null;
    } catch {
      return;
    }
    if (state) pull(state);
  });

  return () => subscription.cancel();
}
