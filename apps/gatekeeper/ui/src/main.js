// 唯一外部入口：把「平台提供的能力」和「本方案的动作」接起来。
//
// 平台给了三样东西（全部来自 platform/webui，本文件一行都没重复实现）：
//   · session —— 连接生命周期 + 断线重连 + 世代令牌取消在途连接
//   · diagnose —— 连接失败后的可执行诊断（6 类）
//   · bus —— 状态容器 + 事件总线 + 事件流
// 本方案自己写的只有：通道镜像（mirror）／命令分派（command）／界面（view）／
// 亲邻接口（api）。

import { session } from '@shin/webui/transport/session.js';
import { setDemoHint } from '@shin/webui/transport/diagnose.js';
import { errText } from '@shin/webui/bridge/bytes.js';
import { hasToken, logLine, on, state } from './store.js';
import * as link from './link.js';
import * as mirror from './mirror.js';
import * as view from './view.js';
import { byDoorControlId, byDoorId, DOORS } from './api/constants.js';
import { looksLike, save as saveToken } from './token.js';

// 与 apps/gatekeeper/app.json 的 connect 一致。方案自己的连接参数属于方案知识，
// 平台不认识它（app.json 只驱动宿主，不注入页面）—— 所以这里必须与清单同步改。
const URL = 'ws://127.0.0.1:9003';
const DOMAIN = 'shingatekeeper';

// 诊断文案要写"怎么起宿主"，而 platform/webui 不该认识方案名 —— 由方案注入。
setDemoHint({ port: 9003, domain: DOMAIN, command: 'ShinGatekeeper.exe' });

/* ------------------------------------------------------------------ 动作 */

const actions = {
  async connect() {
    try {
      await session.connect(URL, DOMAIN);
      await link.attach();
    } catch {
      // 失败原因已由 session + diagnose 写进事件流，这里不重复报。
    }
  },

  async disconnect() {
    await link.detach();      // 先撤销订阅（需要连接还活着才能发 CancelEvent）
    await session.close();
  },

  /** 注入 / 清空 session。空串 = 登出（§4.1：空 token 是合法输入）。 */
  async setSession(raw) {
    const token = String(raw ?? '').trim();
    if (token && !looksLike(token)) {
      logLine('token 形状不像 app:+32位hex，仍按原样写入，由服务端判定', 'info');
    }
    try {
      await link.invoke('SetSession', token);
      saveToken(token);
      logLine(token ? '已注入 SessionToken' : '已登出', 'info');
    } catch (e) {
      logLine('注入失败：' + errText(e), 'fail');
    }
  },

  /** 发短信。注意：本 UI **不直接 fetch**，一律经 Invoke → Command → 本 UI 的执行器。 */
  async requestSms(mobile) {
    if (!/^\d{11}$/.test(mobile)) {
      logLine('手机号应为 11 位数字', 'fail');
      return;
    }
    view.markPending('sms');
    try {
      await link.invoke('RequestSms', mobile);
    } catch (e) {
      view.clearPending();
      logLine('RequestSms 失败：' + errText(e), 'fail');
    }
  },

  async requestLogin(mobile, code) {
    if (!/^\d{11}$/.test(mobile) || !code) {
      logLine('登录需要 11 位手机号 + 验证码', 'fail');
      return;
    }
    view.markPending('login');
    try {
      // arg 是「手机号:验证码」—— C++ 拼成 `Login:手机号:验证码`，切的时候只切第一个冒号。
      await link.invoke('RequestLogin', mobile + ':' + code);
    } catch (e) {
      view.clearPending();
      logLine('RequestLogin 失败：' + errText(e), 'fail');
    }
  },

  /**
   * 开门。传门名（`D10Hall`）或 doorControlId（`16708`）都行，后者会翻成门名 ——
   * 这样 `Command` 通道里永远是**人能读懂的门名**，而不是一串数字。
   */
  async requestOpen(door) {
    const key = String(door ?? '').trim();
    if (!key) return;
    const named = byDoorId(key) || byDoorControlId(key);
    if (!named) {
      logLine('不认识的 ' + key + '：本 UI 只认 constants.js 里列出的门（'
        + DOORS.map((d) => d.id + '=' + d.doorControlId).join(' / ') + '）', 'fail');
      return;
    }
    if (!hasToken()) {
      logLine('没有 token —— 先注入 SessionToken 或走登录流程', 'fail');
      return;
    }
    view.markPending('open');
    try {
      // **必须走 Invoke**，不要在这里直接 fetch：否则这次开门不会进 `Command` 通道，
      // inspector 只看得到结果、看不到动作（§5.2 的立论就是"可观测性"）。
      await link.invoke('RequestOpen', named.id);
    } catch (e) {
      view.clearPending();
      logLine('RequestOpen 失败：' + errText(e), 'fail');
    }
  },
};

/* ------------------------------------------------------------------ 装配 */

view.mount(actions);

// 断线重连成功后必须重建订阅与 addr（session 的重连逻辑会发这个事件）。
on('reconnected', () => {
  link.attach().catch((e) => logLine('重连后重建订阅失败：' + errText(e), 'fail'));
});

// 等待态收尾：命令发出后，真正的结果由**回写**带回来（§5.4）。
// 只认比"发出时刻"更晚的变化，避免 attach 时的初读把刚置上的等待态误清掉。
on('gate', ({ channel }) => {
  if (state.pending && channel && view.settled(channel)) view.clearPending();
});

// 调试入口：冒烟脚本与手工排障都从这里进（不要去 import 前端模块 ——
// Vite dev server 会在模块 URL 上挂 ?t= 时间戳，那是**另一个模块实例**）。
// mirror 也挂上：手工排障常用它读写通道（如 __gate.mirror.write('Log','x')）。
window.__gate = { state, session, link, mirror, view, actions };

logLine('界面就绪。token 权威源在 Gate 的 SessionToken 通道，本页只做镜像。', 'info');

// 本方案自带 WS 服务端，所以直接连自己的宿主，不需要用户先填地址。
actions.connect();
