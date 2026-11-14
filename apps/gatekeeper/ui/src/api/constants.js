// 亲邻相关的全部常量，**唯一一处**（与 tools/ 下 Python / Postman 的对拍脚本对齐）。
//
// 改这里的任何一个值之前，先跑 `node tools/verify-crypto.mjs` —— 它会把 signer.js
// 与 door-test.html 里的内联实现逐字节对拍，漂移会当场失败。

/** body / query 签名盐。sign = UPPER(MD5(字典序 "k=v&"… + "key=" + SALT)) */
export const SALT = 'qiAnlPinP';

/** 手机号的 AES-128 key（hex）。ECB / PKCS#7 / 输出大写 hex。 */
export const AES_KEY_HEX = 'FBC213C4C7BEEBD2AA4EDBF0F681C41B';

/** 请求头签名（短信接口）用的一对。 */
export const HEADER_APPID = 'gbDjIZQSOpCMX49P';
export const HEADER_APPSECRET = 'OKFoQ9MmNXQtcyXROo4PnaFkfDPTHuDg';

/** 接口版本号：既进签名串，也进 URL 查询串。 */
export const VERSION = '5.2.1';

export const COMMUNITY_ID = 4222;

/**
 * 小区里的门。**这是方案的知识，不是平台的知识** —— C++ 侧完全不认识这些名字和 id
 * （它只把门名当字符串转发，见 §4.1）。
 *
 * id 是给 `Command` 用的门名（`Open:D10Hall`），doorControlId 是接口要的数字。
 * 两者分开：门名要人能读懂（日志 / 多客户端可见），数字是实现细节。
 */
export const DOORS = [
  { id: 'D10Hall', label: 'D10 大堂', doorControlId: 16708 },
  { id: 'D10B1', label: 'D10 负一1', doorControlId: 16709 },
  { id: 'D12Manual', label: 'D12 推拉门', doorControlId: 16671 },
];

export const URL_OPEN = 'https://mobileapi3.qinlinkeji.com/api/open/doorcontrol/v2/open';
export const URL_LOGIN = 'https://mobileapi3.qinlinkeji.com/api/app/v1/login';
export const URL_SMS = 'https://gateway2.qinlinkeji.com/member/sms/sendSecurityCode';

export const byDoorId = (id) => DOORS.find((d) => d.id === id) || null;
export const byDoorControlId = (n) => DOORS.find((d) => d.doorControlId === Number(n)) || null;
