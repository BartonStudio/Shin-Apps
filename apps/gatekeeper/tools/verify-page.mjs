// 端到端校验 door-test.html：真在 Chromium 里跑一遍，把三类请求拦下来逐项核对。
// 用法： node apps/gatekeeper/tools/verify-page.mjs
//
// 为什么需要它：MD5/AES 对了不等于**请求形状**对（参数名、位置、token 上不上 URL、
// header 签名用哪个盐）。这些错了同样是"门不开"，而且更隐蔽。
//
// 安全：request interception 全程开启，**不会碰真接口** —— API 请求一律由本脚本
// 用假响应 fulfill，其余外部请求 abort；用的也是假 sessionId。

import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// puppeteer-core 装在本方案的 ui 包里（见 ui/package.json 的 devDependencies），
// 从那个包的位置解析依赖 —— 不再依赖 inspector。
const requireFromUi = createRequire(new URL('../ui/package.json', import.meta.url));
const puppeteer = requireFromUi('puppeteer-core');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if (!exe) { console.error('找不到 Chromium 内核浏览器'); process.exit(2); }

const PAGE_URL = 'file:///' + fileURLToPath(new URL('./door-test.html', import.meta.url)).replace(/\\/g, '/');

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log('  ok   ' + name); return true; }
  fail++; console.log(`  FAIL ${name}\n       got  ${got}\n       want ${want}`); return false;
}
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ok   ' + name); return true; }
  fail++; console.log(`  FAIL ${name} ${extra}`); return false;
}

/* ---- 与页面无关的第二实现：用 Node 的 crypto 复算签名，当作独立裁判 ---- */
const SALT = 'qiAnlPinP';
const nmd5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
const signOf = (map, salt) => {
  const m = {}; for (const k in map) m[k] = String(map[k]);
  return nmd5(Object.keys(m).sort().map(k => `${k}=${m[k]}`).join('&') + `&${salt}`);
};
const nodeAesHex = plain => {
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from('FBC213C4C7BEEBD2AA4EDBF0F681C41B', 'hex'), null);
  return Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]).toString('hex').toUpperCase();
};

const browser = await puppeteer.launch({
  executablePath: exe, headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: 1100, height: 900 },
});
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

let openDoorState = 1;                       // 可切换，用来验失败分支
const seen = { open: [], sms: [], login: [], preflight: 0, blocked: 0 };

await page.setRequestInterception(true);
page.on('request', async req => {
  const url = req.url();
  const method = req.method();

  if (url.startsWith('file://')) return req.continue();

  // 预检：浏览器的跨域检查只在 fulfilled 响应上做，所以这里也要给全 CORS 头
  if (method === 'OPTIONS') {
    seen.preflight++;
    return req.respond({
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': req.headers()['access-control-request-headers'] || '*',
      },
    });
  }
  if (url.includes('/api/open/doorcontrol/v2/open')) {
    seen.open.push({ url, method, headers: req.headers(), body: req.postData() || '' });
    return req.respond({
      status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ code: 0, message: 'success', data: { communityName: '富力桃园D区', communityId: 4222, openDoorState } }),
    });
  }
  if (url.includes('/member/sms/sendSecurityCode')) {
    seen.sms.push({ url, method, headers: req.headers(), body: req.postData() || '' });
    return req.respond({
      status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ code: 0, message: 'success', data: null }),
    });
  }
  if (url.includes('/api/app/v1/login')) {
    seen.login.push({ url, method, headers: req.headers(), body: req.postData() || '' });
    return req.respond({
      status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ code: 0, message: 'success', data: { sessionId: 'app:aaaabbbbccccddddeeeeffff00001111' } }),
    });
  }
  seen.blocked++;
  return req.abort();
});

console.log('打开 ' + PAGE_URL);
await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());

// ---------- 1. 页面自身健康 ----------
console.log('1) 页面健康');
ok('脚本执行无异常', pageErrors.length === 0, pageErrors.join(' | '));
eq('标题', await page.title(), '亲邻开门 · 浏览器测试页');
const domReady = await page.evaluate(() =>
  ['sessionId', 'saveSess', 'log', 'mobile', 'smsCode', 'sendSms', 'doLogin'].every(id => !!document.getElementById(id))
  && document.querySelectorAll('button[data-door]').length === 3);
ok('关键元素齐备（含 3 个门按钮）', domReady);

// 在页面里复算一次，确认浏览器里跑的就是被对拍过的那份实现
eq('页面内 md5hex("abc")', await page.evaluate(() => md5hex('abc')), '900150983CD24FB0D6963F7D28E17F72');
eq('页面内 AES(mobile 明文)', await page.evaluate(() => AES.ecbHex('18211576983', AES_KEY_HEX)), nodeAesHex('18211576983'));

// ---------- 2. 无 sessionId 时必须拦住，不发请求 ----------
console.log('2) 无 sessionId 的守卫');
await page.click('button[data-door="16708"]');
await new Promise(r => setTimeout(r, 200));
eq('未发开门请求', seen.open.length, 0);
ok('日志给出提示', await page.evaluate(() => document.getElementById('log').textContent.includes('没有 sessionId')));

// ---------- 3. sessionId 落盘 ----------
console.log('3) sessionId 持久化');
const FAKE = 'app:00112233445566778899aabbccddeeff';
await page.$eval('#sessionId', (el, v) => { el.value = v; }, FAKE);
await page.click('#saveSess');
ok('形状通过校验', await page.evaluate(() => document.getElementById('sessState').classList.contains('ok')));
eq('写入 localStorage', await page.evaluate(() => localStorage.getItem('qinlin.sessionId')), FAKE);

// ---------- 4. 开门：URL / 参数 / 签名 ----------
console.log('4) 开门请求');
await page.click('button[data-door="16708"]');
await page.waitForFunction(() => document.getElementById('log').textContent.includes('开门成功'), { timeout: 5000 });

eq('只发 1 次', seen.open.length, 1);
const o = seen.open[0];
eq('方法', o.method, 'POST');
eq('空 body', o.body, '');
eq('content-type', o.headers['content-type'], 'application/json; charset=utf-8');
// 未勾选「附加客户端标识头」时不应带 q* 头
ok('默认不带 q* 标识头', !o.headers['qversioncode'] && !o.headers['qchannel']);

const u = new URL(o.url);
const qp = Object.fromEntries(u.searchParams);
eq('path', u.pathname, '/api/open/doorcontrol/v2/open');
eq('host', u.host, 'mobileapi3.qinlinkeji.com');
eq('sessionId', qp.sessionId, FAKE);
eq('appChannel', qp.appChannel, '1');
eq('communityId', qp.communityId, '4222');
eq('doorControlId', qp.doorControlId, '16708');
eq('version', qp.version, '5.2.1');
ok('nonce 是 5 位数字', /^\d{5}$/.test(qp.nonce || ''), `实得 ${qp.nonce}`);
ok('timestamp 是 13 位毫秒且接近当前', /^\d{13}$/.test(qp.timestamp || '') && Math.abs(Date.now() - Number(qp.timestamp)) < 60000, `实得 ${qp.timestamp}`);
ok('sign 是 32 位大写 hex', /^[0-9A-F]{32}$/.test(qp.sign || ''), `实得 ${qp.sign}`);
ok('URL 上不出现 token 参数', !('token' in qp));

// 关键一步：用 Node 独立复算签名，看页面算得对不对
eq('sign == 独立复算值',
   qp.sign,
   signOf({ appChannel: 1, communityId: 4222, doorControlId: qp.doorControlId, nonce: qp.nonce, timestamp: qp.timestamp, token: FAKE, version: '5.2.1' }, `key=${SALT}`));
ok('日志里打印了签名原文', await page.evaluate(() => document.getElementById('log').textContent.includes('token=' + 'app:00112233445566778899aabbccddeeff')));

// ---------- 5. 失败分支：code=0 但 openDoorState!=1 ----------
console.log('5) 受理但门没开');
openDoorState = 6;
await page.click('button[data-door="16671"]');
await page.waitForFunction(() => document.getElementById('log').textContent.includes('openDoorState=6'), { timeout: 5000 });
eq('被判定为失败（不是成功）', seen.open.length, 2);
ok('日志明确说门没开', await page.evaluate(() => document.getElementById('log').textContent.includes('服务端受理但门没开')));
openDoorState = 1;

// ---------- 6. 发送短信：header 签名用 appsecret ----------
console.log('6) 发送短信');
await page.$eval('#mobile', el => { el.value = '18211576983'; });
await page.$eval('#extraHead', el => { el.checked = true; });       // 顺带验一下 q* 头
await page.click('#sendSms');
await page.waitForFunction(() => document.getElementById('log').textContent.includes('短信已发出'), { timeout: 5000 });

eq('只发 1 次', seen.sms.length, 1);
const s = seen.sms[0];
const su = new URL(s.url);
eq('host', su.host, 'gateway2.qinlinkeji.com');
eq('path', su.pathname, '/member/sms/sendSecurityCode');
eq('body = 只有 mobile', s.body, JSON.stringify({ mobile: '18211576983' }));
eq('appid 头', s.headers['appid'], 'gbDjIZQSOpCMX49P');
eq('version 头', s.headers['version'], 'v2');
ok('nonce 是 4 位数字', /^\d{4}$/.test(s.headers['nonce'] || ''), `实得 ${s.headers['nonce']}`);
ok('勾选后带 q* 标识头', s.headers['qversioncode'] === '3141' && s.headers['qvendor'] === 'OnePlus');
eq('sign == 用 appsecret 复算',
   s.headers['sign'],
   signOf({ appid: 'gbDjIZQSOpCMX49P', mobile: '18211576983', nonce: s.headers['nonce'], timestamp: s.headers['timestamp'], version: 'v2' },
          'appsecret=OKFoQ9MmNXQtcyXROo4PnaFkfDPTHuDg'));

// ---------- 7. 登录：body 签名 + AES(mobile) + 回写 sessionId ----------
console.log('7) 登录');
await page.$eval('#smsCode', el => { el.value = '123456'; });
await page.click('#doLogin');
await page.waitForFunction(() => document.getElementById('log').textContent.includes('登录成功'), { timeout: 5000 });

eq('只发 1 次', seen.login.length, 1);
const lg = seen.login[0];
const lbody = JSON.parse(lg.body);
eq('mobile 是 AES 大写 hex', lbody.mobile, nodeAesHex('18211576983'));
ok('mobile 不是明文', lbody.mobile !== '18211576983');
eq('smsCode', lbody.smsCode, '123456');
eq('appChannel 是数字 2', lbody.appChannel, 2);
ok('nonce 是 5 位数字', /^\d{5}$/.test(String(lbody.nonce)), `实得 ${lbody.nonce}`);
// appChannel 在签名里必须按字符串 "2" 参与
eq('sign == 独立复算值',
   lbody.sign,
   signOf({ mobile: lbody.mobile, smsCode: '123456', appChannel: 2, timestamp: lbody.timestamp, version: '5.2.1', nonce: lbody.nonce }, `key=${SALT}`));
eq('sessionId 已回写到输入框', await page.$eval('#sessionId', el => el.value), 'app:aaaabbbbccccddddeeeeffff00001111');
eq('sessionId 已落盘', await page.evaluate(() => localStorage.getItem('qinlin.sessionId')), 'app:aaaabbbbccccddddeeeeffff00001111');

// ---------- 8. 收尾 ----------
console.log('8) 收尾');
eq('没有请求被意外放行到外网', seen.blocked, 0);
ok('全程无页面异常', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
