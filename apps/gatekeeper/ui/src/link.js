// 链路层：连接 → 解析 Gate 节点 → 订阅 → 初读；以及把事件帧路由给 mirror / command。
//
// 「重连后必须重建一切」是 IObject 的硬约束：addr 是指针数值，目标进程一重启就全变
// （见 platform/webui/transport/session.js 顶部）。所以 attach() 每次都重新解析
// `root.Gate`、重新订阅、重新读一遍通道 —— 不复用任何旧 addr。

import { session } from '@shin/webui/transport/session.js';
import { errText, shortAddr, utf8 } from '@shin/webui/bridge/bytes.js';
import { emit, logLine, state } from './store.js';
import * as mirror from './mirror.js';
import { dispatch } from './command.js';

/** Gate 节点的句柄。只在本模块内有效 —— 别的地方一律按 addr 现包（session.ro(addr)）。 */
let gateNode = null;
let subscription = null;

export async function attach() {
  if (!session.isOpen) return false;
  await detach();

  // 对象树只有一个节点（§7）：root → Gate。
  gateNode = await session.client.root.getChildItem('Gate');
  state.gate.addr = gateNode.addr;

  // 顺序不能反：`SubscribeEvent` **不补发当前值**（RuntimeBridge.cpp:162-192），
  // 所以必须先订阅再初读 —— 反过来的话，两次调用之间发生的变化会被静默漏掉。
  subscription = await gateNode.subscribe('DataChannelChanged', onFrame);
  logLine('已订阅 root.Gate 的 DataChannelChanged（addr=' + shortAddr(gateNode.addr) + '）');

  await mirror.readAll();
  emit('gate', { channel: null });
  return true;
}

export async function detach() {
  if (subscription) {
    try {
      await subscription.cancel();
    } catch { /* 连接已断时取消失败可忽略 */ }
    subscription = null;
  }
  gateNode = null;
  mirror.reset();
}

/** 调用 Gate 的方法。args 一律是**裸文本**（方法参数不用 JSON，§4.2）。 */
export async function invoke(method, arg) {
  if (!gateNode) throw new Error('尚未连接到 Gate 节点');
  await gateNode.invoke(method, utf8(arg ?? ''));
}

async function onFrame(ev) {
  if (ev.event !== 'DataChannelChanged') return;
  try {
    const text = await mirror.applyFrame(ev);
    // `Command` 是本 UI 的**输入**：C++ 只广播，执行在这里（§5）。
    // 其他通道只是状态镜像，不触发动作。
    if (ev.channel === 'Command') dispatch(text);
  } catch (e) {
    logLine('处理事件失败：' + errText(e), 'fail');
  }
}
