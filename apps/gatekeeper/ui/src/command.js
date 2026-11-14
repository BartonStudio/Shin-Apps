// 命令分派：收到 `Command` 通道的新值 → 切出 verb → 执行 → （执行者自己）回写通道。
//
// 为什么执行者是前端而不是 C++：C++ 没有网络能力，也刻意不认识门禁业务（§2）。所以
// C++ 只把命令**广播**出来，真正干活的是这条链路上任意一个"有脑子"的客户端 —— 本 UI。
//
// ⚠️ 已知边界：命令是**至多一次**投递（§5.3），且没有序号去重（§5.4）。
// 如果有**两个** gatekeeper UI 同时连着，两边都会执行同一条命令 → 开两次门。
// 目前假定单实例使用；真要支持多实例，得回到序号那一层去解决。

import { errText } from '@shin/webui/bridge/bytes.js';
import { logLine } from './store.js';
import { login, openDoor, sendSms } from './api/qinlin.js';

/**
 * 拆 `verb:arg`。**只切第一个冒号** —— `RequestLogin` 的 arg 自带一个冒号
 * （`Login:13800138000:123456`），切多了会把验证码切没。
 */
export function parse(text) {
  const i = text.indexOf(':');
  if (i < 0) return { verb: text, arg: '' };
  return { verb: text.slice(0, i), arg: text.slice(i + 1) };
}

const VERB_ACTION = {
  Sms: sendSms,
  Login: login,
  Open: openDoor,
};

/**
 * 串行执行队列。
 * 两条命令连着到达（例如"发短信"之后立刻"登录"）时，并行执行会让日志交错、还会让
 * 后一条的签名基于错误的时序。串行化只有一行代码，就别给未来留坑。
 */
let chain = Promise.resolve();

/** 入队执行一条命令（不 await：调用方是事件回调）。 */
export function dispatch(text) {
  chain = chain.then(() => execute(text)).catch((e) => {
    logLine('命令执行异常：' + errText(e), 'fail');
  });
  return chain;
}

async function execute(text) {
  const { verb, arg } = parse(text);
  const action = VERB_ACTION[verb];
  if (!action) {
    // 别的方案可能往同一条通道上写自己的 verb；不认识的 verb 只记一笔，不当错误。
    logLine('未知命令 verb=' + verb + '（arg=' + arg + '），已忽略', 'fail');
    return;
  }
  logLine('执行命令 ' + verb + '（arg=' + arg + '）', 'cmd');
  await action(arg);
}
