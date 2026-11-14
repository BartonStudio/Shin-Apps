// token 的本地副本：localStorage ↔ `SessionToken` 通道。
//
// 为什么两处都要有（§4.4 末尾）：**权威源是通道**（这样 inspector 与脚本才能参与注入），
// 但宿主进程的内存是易失的（纯 KV、无持久化），重启后通道就空了。localStorage 是
// 为了"重启宿主后自动把 token 重新注入回去"，不是第二个真源 —— 冲突时以通道为准。

const KEY = 'shin.gatekeeper.session';

export function load() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';   // 隐私模式 / 配额：没有就没有，不影响功能
  }
}

export function save(value) {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch { /* 同上 */ }
}

/** 形状校验：`app:` + 32 位 hex。只帮人看出"粘错了"，不保证服务端认。 */
export const looksLike = (value) => /^app:[0-9a-fA-F]{32}$/.test(String(value || '').trim());

/** 只显示头尾，中间打码 —— token 是可用凭据，别整串摆在屏幕上。 */
export function mask(value) {
  if (!value) return '';
  if (value.length <= 12) return value;
  return value.slice(0, 8) + '…' + value.slice(-4);
}
