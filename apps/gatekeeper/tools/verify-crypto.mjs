// 对拍校验手写的 MD5 与 AES-128-ECB —— **同时对两份实现**。
// 用法： node apps/gatekeeper/tools/verify-crypto.mjs
//
// 为什么需要它：签名与加密都是自己写的（不引任何外部库，§6），写错了的表现不是报错，
// 而是"门不开"（code:0 + openDoorState:6，见 §13 第 2 条）。
//
// 为什么是**两份**：
//   1. apps/gatekeeper/ui/src/api/signer.js   —— 应用真正跑的那份（ES module）
//   2. apps/gatekeeper/tools/door-test.html   —— 零依赖单文件测试页里的内联副本
// 测试页要求"双击即用"，不能用 ES module 从 (1) 引入，所以算法必然有两份拷贝。
// 本脚本把两边都加载进来，用 Node 的 crypto + FIPS-197 官方向量分别对拍 —— 于是
// **两份实现之间的漂移会当场变成测试失败**，而不是等到某天门不开才发现。

import fs from 'node:fs';
import crypto from 'node:crypto';

/* ============ 加载 (1)：单文件测试页里的内联实现 ============ */

const html = fs.readFileSync(new URL('./door-test.html', import.meta.url), 'utf8');
const START = '/* ===== crypto-core:start';
const END = '/* ===== crypto-core:end ===== */';

const head = html.indexOf(START);
if (head < 0) throw new Error('没找到 crypto-core:start 标记');
const bodyFrom = html.indexOf('*/', head) + 2;
const bodyTo = html.indexOf(END, bodyFrom);
if (bodyTo < 0) throw new Error('没找到 crypto-core:end 标记');
const core = html.slice(bodyFrom, bodyTo);

const inline = new Function(core + `
  return { md5hex, ecbHex: AES.ecbHex, ecbBytesHex: AES.ecbBytesHex,
           signRaw, qappSign, SALT, AES_KEY_HEX, HEADER_APPID, HEADER_APPSECRET, VERSION };
`)();

/* ============ 加载 (2)：应用真正引用的 ES module ============ */

const mod = await import(new URL('../ui/src/api/signer.js', import.meta.url).href);
const cst = await import(new URL('../ui/src/api/constants.js', import.meta.url).href);

const moduleImpl = {
  md5hex: mod.md5hex,
  ecbHex: mod.aesEcbText,
  ecbBytesHex: mod.aesEcbHex,
  signRaw: mod.signRaw,
  // signer.js 把"用哪个盐"做成了常量 + 具名函数（不再让调用方自己拼），这里映射回测试页的形状
  qappSign: mod.signBody,
  signHeader: mod.signHeader,
  SALT: cst.SALT,
  SALT_BODY: mod.SALT_BODY,
  SALT_HEADER: mod.SALT_HEADER,
  AES_KEY_HEX: cst.AES_KEY_HEX,
  HEADER_APPID: cst.HEADER_APPID,
  HEADER_APPSECRET: cst.HEADER_APPSECRET,
  VERSION: cst.VERSION,
};

/* ============ 断言小工具 ============ */

let pass = 0;
let fail = 0;

function eq(tag, name, got, want) {
  if (got === want) { pass++; return; }
  fail++;
  console.log(`  FAIL [${tag}] ${name}\n       got  ${got}\n       want ${want}`);
}

function ok(tag, name, cond, extra = '') {
  if (cond) { pass++; return; }
  fail++;
  console.log(`  FAIL [${tag}] ${name} ${extra}`);
}

const nodeMd5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();

function nodeAesEcbHex(plain, keyHex) {
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(keyHex, 'hex'), null);
  return Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]).toString('hex').toUpperCase();
}

/* ============ 同一套向量，跑两份实现 ============ */

function suite(tag, M) {
  const KEY = M.AES_KEY_HEX;

  console.log('\n── ' + tag + ' ──');

  console.log('MD5');
  eq(tag, '空串', M.md5hex(''), nodeMd5(''));
  eq(tag, 'abc 固定向量', M.md5hex('abc'), '900150983CD24FB0D6963F7D28E17F72');
  eq(tag, '昆特狐狸固定向量', M.md5hex('The quick brown fox jumps over the lazy dog'),
     '9E107D9D372BB6826BD81D3542A419D6');

  // 边界长度：补位规则最容易在这几处写错
  for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
    const s = 'a'.repeat(n);
    eq(tag, `长度 ${n}`, M.md5hex(s), nodeMd5(s));
  }
  // UTF-8 多字节：签名串里含中文时才会用上，但一样不能错
  for (const s of ['中文测试', '门禁·富力桃园D区', 'a'.repeat(53) + '中文']) {
    eq(tag, `UTF-8 ${s.slice(0, 12)}`, M.md5hex(s), nodeMd5(s));
  }
  eq(tag, '随机长串', M.md5hex('x'.repeat(4096)), nodeMd5('x'.repeat(4096)));

  console.log('AES-128-ECB / PKCS#7');
  ok(tag, 'key 是 16 字节', KEY.length === 32, `(实得 ${KEY.length} hex 字符)`);

  // 空串 → PKCS#7 必须补满一整块 0x10；长度刚好 16 的倍数也必须再补一整块
  for (const plain of ['', '18211576983', '1234567890123456', '12345678901234567890123456789012', 'A', '中文手机号测试']) {
    eq(tag, `密文 ${JSON.stringify(plain).slice(0, 24)} (${new TextEncoder().encode(plain).length}B)`,
       M.ecbHex(plain, KEY), nodeAesEcbHex(plain, KEY));
  }
  eq(tag, '空串长度 = 32 hex（一整块）', M.ecbHex('', KEY).length, 32);
  eq(tag, '17 字节 → 两块', M.ecbHex('a'.repeat(17), KEY).length, 64);

  // 换 key：验证密钥扩展是通用的，不是碰巧对上了那一组
  for (const k of ['000102030405060708090A0B0C0D0E0F', 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', '2B7E151628AED2A6ABF7158809CF4F3C']) {
    eq(tag, `另一 key ${k.slice(0, 8)}…`, M.ecbHex('block cipher me!', k), nodeAesEcbHex('block cipher me!', k));
  }

  // FIPS-197 官方向量（raw 单块，不补位）：
  //   key   2B7E151628AED2A6ABF7158809CF4F3C
  //   plain 3243F6A8885A308D313198A2E0370734
  //   out   3925841D02DC09FBDC118597196A0B32
  const fipsPlain = Uint8Array.from('3243F6A8885A308D313198A2E0370734'.match(/../g), (h) => parseInt(h, 16));
  eq(tag, 'FIPS-197 官方向量 · 第 1 块', M.ecbBytesHex(fipsPlain, '2B7E151628AED2A6ABF7158809CF4F3C').slice(0, 32),
     '3925841D02DC09FBDC118597196A0B32');
  eq(tag, 'FIPS-197 单块输入 → 补位后又多一块',
     M.ecbBytesHex(fipsPlain, '2B7E151628AED2A6ABF7158809CF4F3C').length, 64);

  console.log('签名');
  eq(tag, '字典序 + 盐', M.signRaw({ b: 2, a: 1, c: '3' }, 'key=qiAnlPinP'), 'a=1&b=2&c=3&key=qiAnlPinP');
  eq(tag, '数值也转字符串', M.signRaw({ appChannel: 2, nonce: 1234 }, 'key=qiAnlPinP'), 'appChannel=2&nonce=1234&key=qiAnlPinP');

  // 开门签名：token 参与签名但不上 URL
  const doorMap = { appChannel: 1, communityId: 4222, doorControlId: 16708, nonce: '01234', timestamp: '1723200000000', token: 'app:00112233445566778899aabbccddeeff', version: '5.2.1' };
  eq(tag, '开门签名串',
     M.signRaw(doorMap, `key=${M.SALT}`),
     'appChannel=1&communityId=4222&doorControlId=16708&nonce=01234&timestamp=1723200000000&token=app:00112233445566778899aabbccddeeff&version=5.2.1&key=qiAnlPinP');
  eq(tag, '开门 sign', M.qappSign(doorMap), nodeMd5(M.signRaw(doorMap, `key=${M.SALT}`)));

  // 短信 header 签名：盐换成 appsecret
  const smsMap = { appid: M.HEADER_APPID, mobile: '18211576983', nonce: '1234', timestamp: '1723200000000', version: 'v2' };
  eq(tag, '短信签名串',
     M.signRaw(smsMap, `appsecret=${M.HEADER_APPSECRET}`),
     'appid=gbDjIZQSOpCMX49P&mobile=18211576983&nonce=1234&timestamp=1723200000000&version=v2&appsecret=OKFoQ9MmNXQtcyXROo4PnaFkfDPTHuDg');

  // 登录 body 签名：mobile 用密文参与
  const loginMap = { mobile: M.ecbHex('18211576983', KEY), smsCode: '123456', appChannel: 2, timestamp: '1723200000000', version: M.VERSION, nonce: '01234' };
  eq(tag, '登录签名串形状',
     M.signRaw(loginMap, `key=${M.SALT}`),
     `appChannel=2&mobile=${loginMap.mobile}&nonce=01234&smsCode=123456&timestamp=1723200000000&version=5.2.1&key=qiAnlPinP`);
}

suite('door-test.html（内联）', inline);
suite('ui/src/api/signer.js（模块）', moduleImpl);

/* ============ 两份实现互相对拍（防漂移） ============ */

console.log('\n── 两份实现互相对拍 ──');

// 常量必须完全一致 —— 它们分散在两个文件里，改一处忘一处是最隐蔽的漂移
for (const k of ['SALT', 'AES_KEY_HEX', 'HEADER_APPID', 'HEADER_APPSECRET', 'VERSION']) {
  eq('cross', '常量 ' + k, moduleImpl[k], inline[k]);
}

// 盐**表达式**（不是裸盐）必须一致。少一个 `key=` / `appsecret=` 前缀不报错，
// 只表现为"门不开" —— 所以单独钉一条。
eq('cross', 'body 盐表达式', moduleImpl.SALT_BODY, `key=${inline.SALT}`);
eq('cross', 'header 盐表达式', moduleImpl.SALT_HEADER, `appsecret=${inline.HEADER_APPSECRET}`);

// 用一批"不像测试向量"的输入打一遍：边界值只覆盖了规则，这里覆盖实现细节
let mismatch = 0;
for (let i = 0; i < 200; i++) {
  const src = 'k' + i + '=值' + (i * 7919 % 100000) + '&x=' + 'z'.repeat(i % 70);
  if (inline.md5hex(src) !== moduleImpl.md5hex(src)) mismatch++;
  if (inline.ecbHex(src, moduleImpl.AES_KEY_HEX) !== moduleImpl.ecbHex(src, moduleImpl.AES_KEY_HEX)) mismatch++;
}
eq('cross', '200 组随机输入 MD5 + AES 结果一致', mismatch, 0);

const randomMaps = [
  { appChannel: 1, communityId: 4222, doorControlId: 16709, nonce: '98765', timestamp: '1799000000000', token: 'app:ffffffffffffffffffffffffffffffff', version: '5.2.1' },
  { mobile: '13800138000', smsCode: '000000', appChannel: 2, timestamp: '1799000000001', version: '5.2.1', nonce: '00012' },
  { b: 'x&y=z', a: 0, c: '' },   // 含 & 与 = 的值：字典序拼接不做转义，两边必须一样"错"
];
for (let i = 0; i < randomMaps.length; i++) {
  eq('cross', `签名 map #${i}`, moduleImpl.qappSign(randomMaps[i]), inline.qappSign(randomMaps[i]));
}

/* ============ 模拟调用点：把签名串按调用点的写法拼一遍 ============ */

// 上面只证明"同一个 map 两边算得一样"。真正容易写错的是**调用点**：用哪个盐、拼不拼
// `key=` / `appsecret=` 前缀。这里照 ui/src/api/qinlin.js 的写法重算一遍三处签名。
console.log('\n── 调用点形状（照 qinlin.js 的写法） ──');
{
  const ts = '1723200000000';
  const doorMap = { appChannel: 1, communityId: 4222, doorControlId: 16708, nonce: '01234', timestamp: ts, token: 'app:00112233445566778899aabbccddeeff', version: '5.2.1' };
  const smsMap = { appid: 'gbDjIZQSOpCMX49P', mobile: '18211576983', nonce: '1234', timestamp: ts, version: 'v2' };
  const loginMap = { mobile: inline.ecbHex('18211576983', inline.AES_KEY_HEX), smsCode: '123456', appChannel: 2, timestamp: ts, version: '5.2.1', nonce: '01234' };

  // signer.js 的 signBody / signHeader vs 测试页里"调用点自己拼盐"的写法
  eq('call', '开门  signBody', moduleImpl.qappSign(doorMap), inline.md5hex(inline.signRaw(doorMap, `key=${inline.SALT}`)));
  eq('call', '登录  signBody', moduleImpl.qappSign(loginMap), inline.md5hex(inline.signRaw(loginMap, `key=${inline.SALT}`)));
  eq('call', '短信  signHeader', moduleImpl.signHeader(smsMap), inline.md5hex(inline.signRaw(smsMap, `appsecret=${inline.HEADER_APPSECRET}`)));

  // 反向陷阱：如果哪天有人把 body 签名也拿去签 header（或反过来），这条会炸。
  ok('call', 'body 与 header 签名结果不同（没有互相串用）',
     moduleImpl.qappSign(doorMap) !== moduleImpl.signHeader(doorMap));
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
