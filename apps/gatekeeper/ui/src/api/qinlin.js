// 真实网络调用：发短信 / 登录 / 开门。**只有这一层碰 fetch。**
//
// 它是 `Command` 通道的**执行者**：C++ 转发过来的命令最终落到这里（§5）。三个动作
// 共用一条 Command 通道、靠 verb 区分，所以这里也是三个平级的函数，不做分发
// （分发在 src/command.js）。
//
// 每个函数都只做一件事：算签名 → 请求 → 把结论**写回通道**。回写这一步不能省 ——
// 通道是唯一能让其他客户端（inspector / 脚本）看到结果的途径。

import { channelText, logLine } from '../store.js';
import * as mirror from '../mirror.js';
import { load as loadToken, save as saveToken } from '../token.js';
import {
  AES_KEY_HEX,
  COMMUNITY_ID,
  HEADER_APPID,
  URL_LOGIN,
  URL_OPEN,
  URL_SMS,
  VERSION,
  byDoorId,
} from './constants.js';
import { aesEcbText, nonce, nowMs, SALT_BODY, SALT_HEADER, signBody, signHeader, signRaw } from './signer.js';

/**
 * 附加的客户端标识头。默认**不带** —— 实测不带头也能正常返回 JSON，而每多一个
 * 自定义头就多一个预检要放行的字段。`user-agent` 是 forbidden header，JS 设不了，
 * 所以真实请求带的是浏览器 UA 而不是 `Dart/3.10`；服务端目前不校验它。
 */
const clientHeaders = (extra) => ({
  'content-type': 'application/json; charset=utf-8',
  ...extra,
});

/** 统一 POST + 日志。日志里连**签名原文**一起打，方便与 Python / Postman 对拍。 */
async function post(url, headers, body) {
  logLine('POST ' + url, 'req');
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body });
  } catch (e) {
    logLine(e.name + ': ' + e.message + '（跨域预检被拒或断网）', 'fail');
    return null;
  }
  const text = await res.text();
  logLine('HTTP ' + res.status + ' · ' + text.slice(0, 400), res.ok ? 'info' : 'fail');
  try {
    return JSON.parse(text);
  } catch {
    logLine('响应不是 JSON', 'fail');
    return null;
  }
}

/** 服务端的两种"成功"码。 */
const accepted = (js) => js.code === 0 || js.code === 200;

/** 把一条结论同时写进 `Log` 通道（其他客户端可见）与本地事件条。 */
async function report(text, ok) {
  logLine(text, ok ? 'ok' : 'fail');
  await mirror.write('Log', text);
}

/* ------------------------------------------------------------------ 短信 */

/** @param {string} mobile 11 位手机号 */
export async function sendSms(mobile) {
  if (!/^\d{11}$/.test(mobile)) {
    logLine('手机号应为 11 位数字：' + mobile, 'fail');
    return false;
  }
  const ts = nowMs();
  const nc = nonce(4);                    // 短信接口 nonce 4 位
  const h = { appid: HEADER_APPID, mobile, nonce: nc, timestamp: ts, version: 'v2' };
  const sign = signHeader(h);
  logLine('SIGN ' + signRaw(h, SALT_HEADER), 'info');
  logLine('SIGN = ' + sign, 'info');

  const js = await post(
    URL_SMS,
    clientHeaders({ appid: HEADER_APPID, nonce: nc, timestamp: ts, version: 'v2', sign }),
    JSON.stringify({ mobile }),
  );
  if (!js) return false;

  if (accepted(js)) {
    await report('验证码已发送（每日上限 5 次，5 分钟内有效）', true);
    return true;
  }
  await report(`发短信失败 code=${js.code} ${js.message || ''}`, false);
  return false;
}

/* ------------------------------------------------------------------ 登录 */

/**
 * @param {string} arg `"手机号:验证码"`
 *
 * arg 里的冒号是**结构的一部分**（§4.2 关键点 1）。分发时只切掉了前面那个 verb 冒号，
 * 所以这里再切一次是安全的：手机号本身不含冒号。
 */
export async function login(arg) {
  const i = arg.indexOf(':');
  const mobile = i < 0 ? arg : arg.slice(0, i);
  const smsCode = i < 0 ? '' : arg.slice(i + 1);
  if (!/^\d{11}$/.test(mobile) || !smsCode) {
    logLine('RequestLogin 的 arg 应为「手机号:验证码」，收到：' + arg, 'fail');
    return false;
  }

  // 手机号要 AES-128-ECB 加密后再进 body，**并用密文参与签名**（appChannel 以字符串 "2" 参与）。
  const encMobile = aesEcbText(mobile, AES_KEY_HEX);
  logLine('AES(' + mobile + ') = ' + encMobile, 'info');

  const body = {
    mobile: encMobile,
    smsCode,
    appChannel: 2,
    timestamp: nowMs(),
    version: VERSION,
    nonce: nonce(5),                      // 登录 nonce 5 位
  };
  const sign = signBody(body);
  logLine('SIGN ' + signRaw(body, SALT_BODY), 'info');
  logLine('SIGN = ' + sign, 'info');

  const js = await post(URL_LOGIN, clientHeaders(), JSON.stringify({ ...body, sign }));
  if (!js) return false;

  // sessionId 可能出现的位置：data.sessionId / data.token，或响应文本里直接匹配。
  let sid = (js.data && (js.data.sessionId || js.data.token)) || null;
  if (!sid) {
    const m = JSON.stringify(js).match(/app:[0-9a-fA-F]{32}/);
    if (m) sid = m[0];
  }
  if (!sid) {
    await report(`登录失败 code=${js.code} ${js.message || ''}`, false);
    return false;
  }

  saveToken(sid);                          // 本地副本，宿主重启后自动重注入
  await mirror.write('SessionToken', sid); // 权威源
  await mirror.write('SessionInfo', JSON.stringify({ mobile, expireAt: null, loggedIn: true }));
  await report('登录成功，token 已写入 SessionToken 通道', true);
  return true;
}

/* ------------------------------------------------------------------ 开门 */

/** @param {string} doorId 门名（`constants.DOORS[].id`），不是 doorControlId */
export async function openDoor(doorId) {
  const door = byDoorId(doorId);
  if (!door) {
    // 门名表是前端知识：C++ 只转发字符串，不会在这里拦下来（§4.1）。所以拼错门名
    // 只有本 UI 会报错，inspector 那边只会看到一条广播出去的命令。
    await report('未知门名：' + doorId, false);
    return false;
  }

  // token 以通道为准；通道空则回退到本地副本（刚重启宿主、还没重新注入的窗口期）。
  const token = (channelText('SessionToken') || loadToken()).trim();
  if (!token) {
    await report('没有 token —— 先注入 SessionToken 或走登录流程', false);
    return false;
  }

  const ts = nowMs();
  const nc = nonce(5);                    // 开门 nonce 5 位
  const signMap = {
    appChannel: 1,                        // 开门固定 1（与登录的 2 不同）
    communityId: COMMUNITY_ID,
    doorControlId: door.doorControlId,
    nonce: nc,
    timestamp: ts,
    token,                                // 关键：token 参与签名，但**不出现在 URL 上**
    version: VERSION,
  };
  const raw = signRaw(signMap, SALT_BODY);
  const sign = signBody(signMap);
  logLine('SIGN ' + raw, 'info');
  logLine('SIGN = ' + sign, 'info');

  const query = new URLSearchParams({
    sessionId: token,
    appChannel: '1',
    doorControlId: String(door.doorControlId),
    communityId: String(COMMUNITY_ID),
    timestamp: ts,
    version: VERSION,
    nonce: nc,
    sign,
  });

  const js = await post(URL_OPEN + '?' + query.toString(), clientHeaders(), '');
  if (!js) return false;

  if (!accepted(js)) {
    await report(`code=${js.code} ${js.message || ''}`, false);
    if (String(js.message || '').includes('登录')) {
      // token 失效（约会被踢 / 过期）：清掉权威源，让所有客户端同时转"未登录"。
      saveToken('');
      await mirror.write('SessionToken', '');
      await report('token 已失效，已清空 SessionToken', false);
    }
    await recordDoor(door.id, 'failed', js);
    return false;
  }

  const state = js.data && js.data.openDoorState;
  const ok = state === 1;
  if (ok) {
    await report(`开门成功 · ${door.label} · openDoorState=1`, true);
  } else {
    // code 0 只表示"受理"，门没开时 openDoorState 会给出原因（6 = sign / timestamp 不对）。
    await report(`服务端受理但门没开：openDoorState=${state}（先对拍上面的签名串，再核本机时钟）`, false);
  }
  await recordDoor(door.id, ok ? 'open' : 'failed', js);
  return ok;
}

/* ------------------------------------------------------------------ 回写 */

/** 更新 `Doors` 通道里的这一扇门（读-改-写在 mirror 里，这里只递记录）。 */
async function recordDoor(doorId, state, js) {
  await mirror.setDoor(doorId, {
    state,
    lastResult: (js && js.data && js.data.openDoorState) ?? null,
    at: new Date().toISOString(),
  });
}
