// ShinGatekeeper 的方案状态容器。
//
// 与 apps/inspector/ui/src/store.js 一样是**薄壳**：平台那份（platform/webui/state/bus.js）
// 只放"任何方案都要有"的东西（连接状态 / 事件流 / 暂停开关），领域状态由方案自己挂上来。
// 这样各模块的 import 路径保持稳定，而 platform 里不会出现"门禁"这个词。
//
// 判据（同 bus.js 顶部）：删掉这个字段，另一个方案会重新写一遍吗？
//   gate / pending 只有门禁这种"状态镜像 + 命令中转"形态用得上 → 留在这里。

import { state, on, emit, pushEvent, logLine, setUI } from '@shin/webui/state/bus.js';
import { bytesToText } from '@shin/webui/bridge/bytes.js';
import { load as loadStoredToken } from './token.js';

/** `Command` = "verb:arg"，按 verb 区分动作（§4.2 关键点 1）。 */
export const VERBS = { Sms: 'RequestSms', Login: 'RequestLogin', Open: 'RequestOpen' };

/** GateObject 认得这 5 个通道名，其余一律被 C++ 拒绝（GateObject.cpp 的 kKnownChannels）。 */
export const CHANNELS = ['SessionToken', 'SessionInfo', 'Doors', 'Command', 'Log'];

Object.assign(state, {
  gate: {
    /** root.Gate 的 addr；重连后必须重新解析（addr 是指针数值，target 重启即失效）。 */
    addr: null,
    /** channel → Uint8Array | null */
    values: {},
    /** channel → Date（最近一次变化时刻，只用于界面显示"多久前"） */
    seen: {},
  },

  /**
   * 正在等待结果的动作名。**不是**「invoke 还没 resolve」——
   * invoke 的 resolve 只表示"命令已广播"（§4.4）。
   * 这里只在"命令已经发出、还没等到回写"期间置位，用来收尾按钮的互斥态。
   */
  pending: null,
});

/** 读通道值：null（从未写过）与空字节都返回 ''。 */
export function channelText(channel) {
  return bytesToText(state.gate.values[channel] ?? undefined);
}

/**
 * 有没有可用 token。
 * **顺序不能反**：权威源是通道（inspector / 脚本注入的 token 走的就是这条路），
 * localStorage 只是为了"宿主重启后自动重注入"，通道里有时不能被本地副本否决。
 */
export function hasToken() {
  return !!channelText('SessionToken').trim() || !!loadStoredToken();
}

export { state, on, emit, pushEvent, logLine, setUI };
