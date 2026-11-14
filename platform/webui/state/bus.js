// 全局状态容器 + 极简事件总线。
// 各模块只通过这里交换数据，不互相持有状态引用。
//
// 这里只放**任何方案都要有**的东西：连接状态、事件流、事件暂停开关。
// 方案自己的领域状态（如观察清单 / 拓扑节点 / 渲染器句柄）由方案在启动时
// Object.assign 进来 —— 见 apps/inspector/ui/src/store.js。
//
// 判据：删掉这个字段，另一个方案会重新写一遍吗？会 → 留在这里；只有某一个
// 方案用得上 → 放它自己的 store。

const listeners = new Map();

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}

export function emit(evt, payload) {
  const set = listeners.get(evt);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (e) {
      console.error('[store] 监听器抛异常：' + evt, e);
    }
  }
}

export const MAX_EVENTS = 2000;

export const state = {
  /** { status: idle|connecting|open|closed|error, url, domain, rootAddr, error, diagnosis } */
  connection: { status: 'idle', url: '', domain: '', rootAddr: null, error: '', diagnosis: null },

  /** 事件流（环形缓冲）。 */
  events: [],

  ui: {
    // 暂停时事件仍然记录（可回看），只是不派发给界面。
    eventPaused: false,
  },
};

export function pushEvent(rec) {
  state.events.push(rec);
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
  if (!state.ui.eventPaused) emit('event', rec);
}

/** 往事件流里塞一段纯文本（不属于任何通道观测）。 */
export function logLine(text, type = 'conn') {
  pushEvent({ ts: new Date(), type, path: text, channel: '', data: undefined, isLog: true });
}

export function setUI(patch) {
  Object.assign(state.ui, patch);
  emit('ui', state.ui);
}
