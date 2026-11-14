// 通道镜像：把 Gate 的 5 个通道搬进前端状态，并把前端的状态写回通道。
//
// 「镜像」是**双向**的（§9）：订阅 + 初读把远端值拉过来，write() 把本地结论推回去。
// 两个方向都走同一条通道 —— 写入后 C++ 会 Publish，所以本地不需要乐观更新，
// 值会经由我们自己的订阅绕回来（这也是"值只有一个真源"的做法）。

import { session } from '@shin/webui/transport/session.js';
import { utf8, bytesToText, errText } from '@shin/webui/bridge/bytes.js';
import { CHANNELS, state, emit, pushEvent, logLine } from './store.js';

/** 用 addr 临时包一个远端对象。每次现包，避免重连后拿着旧 addr 的僵尸句柄。 */
const gate = () => session.ro(state.gate.addr);

export function reset() {
  state.gate.addr = null;
  state.gate.values = {};
  state.gate.seen = {};
}

/** 首次把 5 个通道全读一遍。 */
export async function readAll() {
  for (const channel of CHANNELS) await read(channel);
}

/** 主动读一个通道。 */
export async function read(channel) {
  try {
    apply(channel, await gate().readData(channel));
  } catch (e) {
    // C++ 对**不认识的通道名**返回 false，协议层把它翻成 OperationFailed，readData 会 reject
    // （RuntimeBridgeProtocol.cpp 的 accepted==false 分支）。所以这里的失败意味着
    // 前端用了 GateObject 白名单之外的通道名 —— 是契约不符，不是"没写过"。
    // 注意区分：认识但没写过是 **空字节**，那是成功的读取结果。
    logLine('通道 ' + channel + ' 读取被拒：' + errText(e) + '（GateObject 不认这个名字）', 'fail');
    apply(channel, undefined);
  }
}

/**
 * 处理一个 DataChannelChanged 帧。
 * @returns {Promise<string>} 该通道变化后的文本值（供命令分派用）
 */
export async function applyFrame(ev) {
  const channel = ev.channel;
  if (!channel) return '';
  if (ev.data !== undefined) {
    // data 只在「事件是 DataChannelChanged 且服务端当次 ReadData 成功」时才存在，
    // 且**空字节也是合法快照** —— 所以要判字段存在性，不判长度。
    apply(channel, ev.data);
  } else {
    // 没带快照（服务端读取失败）：回退到主动拉一次。
    await read(channel);
  }
  return bytesToText(state.gate.values[channel] ?? undefined);
}

/** 写一个通道。返回 false 表示被 C++ 拒绝。 */
export async function write(channel, text) {
  try {
    await gate().writeData(channel, utf8(text));
    return true;
  } catch (e) {
    // 典型情形：往 Command 写 —— 它是输出通道，对外只读（§4.2 关键点 3）。
    logLine('通道 ' + channel + ' 写入被拒：' + errText(e), 'fail');
    return false;
  }
}

function apply(channel, bytes) {
  state.gate.values[channel] = bytes === undefined ? null : bytes;
  state.gate.seen[channel] = new Date();
  pushEvent({ ts: new Date(), type: 'chan', path: 'Gate', channel, data: bytes, isLog: false });
  emit('gate', { channel });
}

/* ------------------------------------------------------------ 门状态表 */

/**
 * 把 `Doors` 通道解析成一张 `{ 门名: {state,lastResult,at} }` 表。
 *
 * 内容虽然由本前端自己构造（C++ 不解析，所以这里可以放心用 JSON），但仍然**防御性解析**：
 * 通道是任何客户端都能写的地方，一条坏记录不该把整个界面打瘫。
 *
 * 放在这里而不是各调用点：这条通道的读写有三处（界面 / 开门回写 / 冒烟脚本），
 * 解析规则只能有一份 —— 否则"空值算什么"这类细节会在三处慢慢长歪。
 */
export function doorsTable() {
  const raw = bytesToText(state.gate.values.Doors ?? undefined);
  if (!raw) return {};
  try {
    const table = JSON.parse(raw);
    return table && typeof table === 'object' && !Array.isArray(table) ? table : {};
  } catch {
    logLine('Doors 通道里不是合法 JSON，按空表处理', 'info');
    return {};
  }
}

/** 读-改-写地更新一扇门。**不能整表覆盖** —— 别的门（可能由别的客户端写的）不能被抹掉。 */
export async function setDoor(doorId, record) {
  await write('Doors', JSON.stringify({ ...doorsTable(), [doorId]: record }));
}
