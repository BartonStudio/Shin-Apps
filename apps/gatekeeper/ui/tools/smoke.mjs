// 端到端冒烟：真 Chromium 打开 dev server 上的界面 → 连**真实运行中的** ShinGatekeeper.exe
// → 走一遍注入 / 开门 / 短信 / 登录四条主路径。
//
// 用法（必须**从仓库根**运行，临时文件落在 .workbuddy/tmp/）：
//   node apps/gatekeeper/ui/tools/smoke.mjs
//   SHIN_APP_URL=http://127.0.0.1:8849/index.html node apps/gatekeeper/ui/tools/smoke.mjs
//
// 前置只有一件事：apps/gatekeeper/ui 下 `npm run dev` 在跑（8849）。
// 宿主由本脚本自己起 —— 见下面 startHeadlessHost() 的说明，**别**手工去跑
// build/bin/Debug/ShinGatekeeper.exe 再跑这个脚本。
//
// 为什么必须真实时钟（不用 --virtual-time-budget）：Chromium 的虚拟时钟不把 WebSocket
// 往返当 pending 工作，会把预算瞬间快进掉，await 一个 RPC 永远等不到结果。
//
// 安全：开拦截之后**绝不碰真接口** —— 三个 API 一律由本脚本用假响应 fulfill。
// 门的假响应默认 openDoorState=1（可切成 6 验失败分支）。开门的副作用是真开门，所以
// 拦截是硬前提，不是优化。

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const APP_URL = process.env.SHIN_APP_URL || 'http://127.0.0.1:8849/index.html';
const DOMAIN = process.env.SHIN_DOMAIN || 'shingatekeeper';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) {
  console.error('找不到 Chromium 内核浏览器，无法运行冒烟测试。');
  process.exit(2);
}

const cwd = process.cwd();
const outDir = path.join(cwd, '.workbuddy', 'tmp');
fs.mkdirSync(outDir, { recursive: true });

/* ---- 独立裁判：用 Node 的 crypto 复算签名，不信任页面算的那份 ---- */

const SALT = 'qiAnlPinP';
const APPID = 'gbDjIZQSOpCMX49P';
const APPSECRET = 'OKFoQ9MmNXQtcyXROo4PnaFkfDPTHuDg';
const AES_KEY_HEX = 'FBC213C4C7BEEBD2AA4EDBF0F681C41B';
const VERSION = '5.2.1';

const nmd5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
const signOf = (map, salt) => {
  const m = {};
  for (const k in map) m[k] = String(map[k]);
  return nmd5(Object.keys(m).sort().map((k) => `${k}=${m[k]}`).join('&') + `&${salt}`);
};
const nodeAesHex = (plain) => {
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(AES_KEY_HEX, 'hex'), null);
  return Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]).toString('hex').toUpperCase();
};

/* ---- 断言 ---- */

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log('  ok   ' + name); return true; }
  fail++;
  console.log(`  FAIL ${name}\n       got  ${got}\n       want ${want}`);
  return false;
}
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ok   ' + name); return true; }
  fail++;
  console.log(`  FAIL ${name} ${extra}`);
  return false;
}

/* ---- 页面侧的等待原语 ----
 *
 * ⚠️ 通道状态活在**宿主进程**里（GateObject 是纯 KV、无持久化），宿主不退，上一轮的
 * Doors / Log 就还在。所以断言**不能等"值出现"**（上一轮早就出现过了，waitForFunction
 * 会立刻返回，读到的是陈旧记录），必须等"值发生变化"。
 * 这与 inspector 冒烟开头要 localStorage.clear() 是同一类问题：状态会污染用例。
 */

/** 读 Doors 通道里某一扇门的记录（无记录返回 null）。解析走方案自己的实现，避免这份脚本再抄一套。 */
const doorRecord = (id) => page.evaluate((doorId) => window.__gate.mirror.doorsTable()[doorId] ?? null, id);

/** 等这扇门的记录时间戳变掉（= 本轮的开门真的落地了）。 */
const waitDoorChanged = (id, before) => page.waitForFunction(
  (doorId, prev) => {
    const rec = window.__gate.mirror.doorsTable()[doorId];
    return !!rec && rec.at !== prev;
  },
  { timeout: 8000 },
  id,
  before ?? null,
).catch(() => {});

/* ---- 宿主：本脚本自己起一个"不加载界面"的实例 ----
 *
 * 为什么不能直接跑 build/bin/Debug/ShinGatekeeper.exe：
 * 那样它自己的 WebView 也会加载同一份界面、也会连上 9003、也会订阅 Command ——
 * 于是每一条命令被**两个客户端各执行一次**，而本脚本的请求拦截只管得住自己这个
 * 浏览器页面。结果是：另一次执行直连真实接口，**真的会把门打开**。
 * （命令是至多一次投递且无序号去重，见 src/command.js 顶部的边界说明。）
 *
 * 做法：把 exe 复制到临时目录，附一份把 entry.dev 改成空白页的 app.json ——
 * 宿主照常配域、照常起 9003，只是它的窗口里什么都不跑。顺带也避开了
 * WebView2 用户数据目录被别的实例独占的问题。
 *
 * 若 9003 已被占用，说明**另有一个真宿主在跑**：那种情况下本脚本拒绝继续，
 * 因为无法阻止它对同一条命令再执行一次。
 */

const HOST_DIR = path.join(cwd, '.workbuddy', 'tmp', 'gk-host');
const EXE_SRC = path.join(cwd, 'build', 'bin', 'Debug', 'ShinGatekeeper.exe');
const MANIFEST_SRC = path.join(cwd, 'apps', 'gatekeeper', 'app.json');
const PORT = 9003;

/**
 * 端口上是否**已经有人在听**。
 *
 * 用 connect 而不是"试着 bind 一下"：Windows 上 SO_REUSEADDR 的语义允许在 0.0.0.0:9003
 * 已被占用时仍然成功 bind 127.0.0.1:9003 —— 用 bind 探测会**漏判**，于是守卫形同虚设。
 * 主动连一次才靠得住。
 */
function portInUse(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

function waitPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error('等待端口 ' + port + ' 超时'));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

/** 删临时宿主目录。正在运行的 exe 会被锁住（Windows 上 rmSync 直接 EBUSY），所以要重试。 */
function cleanHostDir() {
  for (let i = 0; i < 6; i++) {
    try {
      fs.rmSync(HOST_DIR, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === 5) {
        throw new Error('清不掉 ' + path.relative(cwd, HOST_DIR) + '（' + e.code
          + '）：里面还有个宿主进程锁着 exe。先把它关掉再跑。');
      }
      // 同步 sleep：这是脚本启动阶段，阻塞几百毫秒无妨
      const until = Date.now() + 300;
      while (Date.now() < until) { /* spin */ }
    }
  }
}

async function startHeadlessHost() {
  if (!fs.existsSync(EXE_SRC)) {
    throw new Error('没找到 ' + path.relative(cwd, EXE_SRC) + ' —— 先构建 ShinGatekeeper 目标');
  }
  if (await portInUse(PORT)) {
    throw new Error(
      '端口 ' + PORT + ' 已被占用：另一个 ShinGatekeeper 实例正在运行。\n'
      + '       它也会执行同一条命令（命令无去重），而本脚本的请求拦截管不到它 —— '
      + '那一次会直连真接口开门。请先关掉它再跑。');
  }

  cleanHostDir();
  fs.mkdirSync(path.join(HOST_DIR, 'apps', 'gatekeeper'), { recursive: true });
  fs.copyFileSync(EXE_SRC, path.join(HOST_DIR, 'ShinGatekeeper.exe'));

  const stub = path.join(HOST_DIR, 'stub.html');
  fs.writeFileSync(stub, '<!DOCTYPE html><meta charset="utf-8"><title>host stub</title>');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_SRC, 'utf8'));
  manifest.entry.dev = 'file:///' + stub.replace(/\\/g, '/');
  manifest.title = 'ShinGatekeeper（冒烟宿主）';
  fs.writeFileSync(
    path.join(HOST_DIR, 'apps', 'gatekeeper', 'app.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  const child = spawn(path.join(HOST_DIR, 'ShinGatekeeper.exe'), [], {
    cwd: HOST_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  const collect = (buf) => log.push(...String(buf).split('\n').map((s) => s.trim()).filter(Boolean));
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  await waitPort(PORT);

  // 宿主确实挂上了 Gate 节点、而且**没有**连自己的界面（entry 是那个空白页）
  const okLog = log.some((l) => l.includes('已挂载 Gate 节点'));
  return { child, log, okLog };
}

const host = await startHeadlessHost();
// 无论怎么退出都别把宿主落下（包括断言抛异常、Ctrl-C）
process.on('exit', () => { try { host.child.kill(); } catch { /* 已经退了 */ } });
console.log('冒烟宿主已启动（exe 副本 + 指向空白页的 app.json），9003 就绪');
if (!host.okLog) console.log('  [warn] 宿主日志里没看到"已挂载 Gate 节点"，继续跑但可能失败');
host.log.forEach((l) => console.log('  host | ' + l));

/* ---- 浏览器 ---- */

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: 900, height: 620 },
});
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console.error] ' + m.text());
});

console.log('打开 ' + APP_URL + '\n目标域 ' + DOMAIN + '（宿主需在 127.0.0.1:9003 上运行）');
await page.goto(APP_URL, { waitUntil: 'load' });

// 清掉上一轮的 token 与本地状态：断言不该依赖历史，否则第二次跑结论会不同。
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });

// 等 main.js 装配完成。只等 load 不够 —— dev server 的模块图是逐级 fetch 的。
await page.waitForFunction(() => !!window.__gate && !!document.getElementById('door-list'), { timeout: 15000 });

// 等真实连接建立（页面启动时自动连自己的宿主）。
await page.waitForFunction(
  () => window.__gate.state.connection.status === 'open' && !!window.__gate.state.gate.addr,
  { timeout: 15000 },
).catch(() => {});

/* ---------- 1. 页面健康 ---------- */

console.log('\n1) 页面健康');
eq('标题', await page.title(), 'SHIN::GATEKEEPER');
ok('脚本执行无异常', pageErrors.length === 0, pageErrors.join(' | '));

const dom = await page.evaluate(() => ({
  session: !!document.getElementById('sec-session'),
  feed: !!document.getElementById('feed'),
  doors: document.querySelectorAll('button[data-door]').length,
  labels: [...document.querySelectorAll('.door-btn')].map((b) => b.textContent),
}));
eq('3 个门按钮', dom.doors, 3);
ok('门名来自 constants.js', dom.labels.join(',') === 'D10 大堂,D10 负一1,D12 推拉门', dom.labels.join(','));
ok('面板齐备', dom.session && dom.feed);

/* ---------- 2. 连接与订阅 ---------- */

console.log('\n2) 连接与订阅（真实 WS 到 9003）');
const conn = await page.evaluate(() => {
  const c = window.__gate.state.connection;
  return { status: c.status, domain: c.domain, url: c.url, rootAddr: c.rootAddr, gateAddr: window.__gate.state.gate.addr };
});
eq('状态', conn.status, 'open');
eq('域来自清单', conn.domain, DOMAIN);
eq('地址', conn.url, 'ws://127.0.0.1:9003');
ok('root 锚点非 0', conn.rootAddr > 0, String(conn.rootAddr));
ok('已解析出 Gate 节点', conn.gateAddr > 0, String(conn.gateAddr));

// 5 个通道都读到了（认识但没写过 = 空字节，那也算读到）。null 表示读取被拒（契约不符）。
const channels = await page.evaluate(() => {
  const v = window.__gate.state.gate.values;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null ? 'REJECTED' : 'bytes:' + x.length]));
});
for (const ch of ['SessionToken', 'SessionInfo', 'Doors', 'Command', 'Log']) {
  ok('通道 ' + ch + ' 读到了', channels[ch] && channels[ch] !== 'REJECTED', channels[ch]);
}

/* ---------- 3. 外部注入：零网络路径 ---------- */

console.log('\n3) 外部注入 SessionToken（不碰网络）');
const FAKE = 'app:00112233445566778899aabbccddeeff';
await page.$eval('#token-input', (el, v) => { el.value = v; }, FAKE);
await page.click('#btn-set');
await page.waitForFunction(
  (want) => {
    const b = window.__gate.state.gate.values.SessionToken;
    return !!b && new TextDecoder().decode(b) === want;
  },
  { timeout: 5000 },
  FAKE,
).catch(() => {});

const injected = await page.evaluate(() => ({
  value: new TextDecoder().decode(window.__gate.state.gate.values.SessionToken || new Uint8Array()),
  seen: !!window.__gate.state.gate.seen.SessionToken,
  view: document.getElementById('token-view').textContent,
  stored: localStorage.getItem('shin.gatekeeper.session'),
}));
// main.js 不做乐观更新 —— 值出现在 state 里就证明它是**从 C++ 广播回来**的。
eq('通道里的值（经 C++ 往返）', injected.value, FAKE);
ok('收到过 DataChannelChanged', injected.seen);
ok('界面打码显示', injected.view.includes('…') && !injected.view.includes('00112233'), injected.view);
eq('本地副本已保存', injected.stored, FAKE);

/* ---------- 4. Command 只读 ---------- */

console.log('\n4) Command 对外只读');
const refused = await page.evaluate(async () => {
  const ro = window.__gate.session.ro(window.__gate.state.gate.addr);
  const enc = new TextEncoder();
  const out = {};
  try {
    await ro.writeData('Command', enc.encode('99:Open:D10Hall'));
    out.command = 'ACCEPTED';
  } catch (e) {
    out.command = 'refused: ' + (e.code || e.name);
  }
  try {
    await ro.writeData('NoSuchChannel', enc.encode('x'));
    out.bogus = 'ACCEPTED';
  } catch (e) {
    out.bogus = 'refused: ' + (e.code || e.name);
  }
  return out;
});
ok('写 Command 被拒', refused.command !== 'ACCEPTED', refused.command);
ok('写不存在的通道名被拒', refused.bogus !== 'ACCEPTED', refused.bogus);

/* ---------- 5. 开门：Invoke → Command → 执行器 → 回写 ---------- */

// 到这里为止一个 API 请求都不该发生。之后才开拦截 —— 连接已经建立，
// 后开拦截不会影响已建立的 WS。
const seen = { open: [], sms: [], login: [], preflight: 0, blocked: 0, other: 0 };
let openDoorState = 1;

await page.setRequestInterception(true);
page.on('request', async (req) => {
  const url = req.url();
  const method = req.method();

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
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ code: 0, message: 'success', data: { communityName: '富力桃园D区', communityId: 4222, openDoorState } }),
    });
  }
  if (url.includes('/member/sms/sendSecurityCode')) {
    seen.sms.push({ url, method, headers: req.headers(), body: req.postData() || '' });
    return req.respond({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ code: 0, message: 'success', data: null }),
    });
  }
  if (url.includes('/api/app/v1/login')) {
    seen.login.push({ url, method, headers: req.headers(), body: req.postData() || '' });
    return req.respond({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ code: 0, message: 'success', data: { sessionId: 'app:aaaabbbbccccddddeeeeffff00001111' } }),
    });
  }
  // 本机 dev server / 宿主一律放行；其余外网请求一律拦下并计数（期望为 0）
  if (url.startsWith('http://127.0.0.1:')) { seen.other++; return req.continue(); }
  seen.blocked++;
  return req.abort();
});

console.log('\n5) 开门：按钮 → Invoke(RequestOpen) → Command → 执行器 → fetch');
ok('这里之前没发生过 API 请求', seen.open.length === 0 && seen.sms.length === 0 && seen.login.length === 0);
// 按钮必须走 Invoke，不能自己 fetch —— 但门按钮在无 token 时是禁用的，所以先确认它已可用
ok('门按钮已启用（有 token）', !(await page.$eval('button[data-door="D10Hall"]', (b) => b.disabled)));

const beforeHall = await doorRecord('D10Hall');
await page.click('button[data-door="D10Hall"]');
// 等本轮的开门记录落地（不是等"记录存在" —— 宿主不退，上一轮的可能还在）
await waitDoorChanged('D10Hall', beforeHall && beforeHall.at);

eq('只发 1 次开门请求', seen.open.length, 1);
const o = seen.open[0];
const ou = new URL(o.url);
const qp = Object.fromEntries(ou.searchParams);
eq('方法', o.method, 'POST');
eq('host', ou.host, 'mobileapi3.qinlinkeji.com');
eq('path', ou.pathname, '/api/open/doorcontrol/v2/open');
eq('sessionId 用的是注入的 token', qp.sessionId, FAKE);
eq('appChannel 固定 1', qp.appChannel, '1');
eq('communityId', qp.communityId, '4222');
eq('doorControlId 来自门名 D10Hall', qp.doorControlId, '16708');
eq('version', qp.version, VERSION);
ok('nonce 5 位', /^\d{5}$/.test(qp.nonce || ''), qp.nonce);
ok('timestamp 是 13 位且接近当前', /^\d{13}$/.test(qp.timestamp || '') && Math.abs(Date.now() - Number(qp.timestamp)) < 60000, qp.timestamp);
ok('URL 上不出现 token 参数', !('token' in qp));
eq('sign == Node 独立复算值',
  qp.sign,
  signOf({ appChannel: 1, communityId: 4222, doorControlId: qp.doorControlId, nonce: qp.nonce, timestamp: qp.timestamp, token: FAKE, version: VERSION }, `key=${SALT}`));

// Command 通道：**动作必须可见** —— 这正是保留 Command 的立论（可观测性）。
const cmd = await page.evaluate(() =>
  new TextDecoder().decode(window.__gate.state.gate.values.Command || new Uint8Array()));
eq('Command 通道内容', cmd, 'Open:D10Hall');

// 回写：Doors 通道 + 界面
const doors = await page.evaluate(() => ({
  table: window.__gate.mirror.doorsTable(),
  state: document.querySelector('.door-state[data-state="D10Hall"]').textContent,
  cls: document.querySelector('.door-state[data-state="D10Hall"]').className,
}));
eq('Doors 通道记录了这一扇门', doors.table.D10Hall && doors.table.D10Hall.state, 'open');
eq('界面显示已开', doors.state, '已开 · 1');
eq('界面按成功着色', doors.cls, 'door-state ok');

// 「正在发送…」必须已经收尾（等回写，不是等 invoke 的 resolve）
ok('等待态已解除', await page.evaluate(() => !window.__gate.state.pending));

/* ---------- 6. 失败分支：code=0 但 openDoorState=6 ---------- */

console.log('\n6) 受理但门没开（openDoorState=6）');
openDoorState = 6;
const beforeManual = await doorRecord('D12Manual');
await page.click('button[data-door="D12Manual"]');
await waitDoorChanged('D12Manual', beforeManual && beforeManual.at);
const failed = await page.evaluate(() => ({
  rec: window.__gate.mirror.doorsTable().D12Manual,
  state: document.querySelector('.door-state[data-state="D12Manual"]').textContent,
}));
eq('判定为失败', failed.rec && failed.rec.state, 'failed');
eq('保留了 openDoorState', failed.rec && failed.rec.lastResult, 6);
eq('界面显示失败', failed.state, '失败 · 6');
openDoorState = 1;

/* ---------- 7. 发短信：header 签名用 appsecret ---------- */

console.log('\n7) 发短信（经 Command → 执行器）');
await page.$eval('#mobile', (el) => { el.value = '18211576983'; });
await page.click('#btn-sms');
await page.waitForFunction(() => document.getElementById('feed').textContent.includes('验证码已发送'), { timeout: 5000 }).catch(() => {});

eq('只发 1 次', seen.sms.length, 1);
const s = seen.sms[0];
const su = new URL(s.url);
eq('host', su.host, 'gateway2.qinlinkeji.com');
eq('path', su.pathname, '/member/sms/sendSecurityCode');
eq('body 只有 mobile', s.body, JSON.stringify({ mobile: '18211576983' }));
eq('appid 头', s.headers['appid'], APPID);
eq('version 头', s.headers['version'], 'v2');
ok('nonce 4 位', /^\d{4}$/.test(s.headers['nonce'] || ''), s.headers['nonce']);
eq('sign == 用 appsecret 复算',
  s.headers['sign'],
  signOf({ appid: APPID, mobile: '18211576983', nonce: s.headers['nonce'], timestamp: s.headers['timestamp'], version: 'v2' }, `appsecret=${APPSECRET}`));
eq('Command 通道内容', await page.evaluate(() => new TextDecoder().decode(window.__gate.state.gate.values.Command || new Uint8Array())), 'Sms:18211576983');

// Log 通道 —— JS 把结论写回通道，其他客户端（inspector）才看得到
const logChannel = await page.evaluate(() => new TextDecoder().decode(window.__gate.state.gate.values.Log || new Uint8Array()));
ok('Log 通道被回写', logChannel.includes('验证码已发送'), logChannel);

/* ---------- 8. 登录：AES + body 签名 + 回写 token ---------- */

console.log('\n8) 登录（AES mobile + body 签名 + 回写 SessionToken）');
await page.$eval('#code', (el) => { el.value = '123456'; });
await page.click('#btn-login');
await page.waitForFunction(() => {
  const b = window.__gate.state.gate.values.SessionToken;
  return !!b && new TextDecoder().decode(b).startsWith('app:aaaa');
}, { timeout: 8000 }).catch(() => {});

eq('只发 1 次', seen.login.length, 1);
const lg = seen.login[0];
const lbody = JSON.parse(lg.body);
eq('Command 通道内容（只切第一个冒号）', await page.evaluate(() => new TextDecoder().decode(window.__gate.state.gate.values.Command || new Uint8Array())), 'Login:18211576983:123456');
eq('mobile 是 AES 密文', lbody.mobile, nodeAesHex('18211576983'));
ok('mobile 不是明文', lbody.mobile !== '18211576983');
eq('smsCode', lbody.smsCode, '123456');
eq('appChannel 是数字 2', lbody.appChannel, 2);
ok('nonce 5 位', /^\d{5}$/.test(String(lbody.nonce)), String(lbody.nonce));
eq('sign == Node 复算（appChannel 按字符串参与）',
  lbody.sign,
  signOf({ mobile: lbody.mobile, smsCode: '123456', appChannel: 2, timestamp: lbody.timestamp, version: VERSION, nonce: lbody.nonce }, `key=${SALT}`));

const afterLogin = await page.evaluate(() => ({
  token: new TextDecoder().decode(window.__gate.state.gate.values.SessionToken || new Uint8Array()),
  info: new TextDecoder().decode(window.__gate.state.gate.values.SessionInfo || new Uint8Array()),
  stored: localStorage.getItem('shin.gatekeeper.session'),
}));
eq('SessionToken 已被登录结果覆盖', afterLogin.token, 'app:aaaabbbbccccddddeeeeffff00001111');
ok('SessionInfo 写了手机号', afterLogin.info.includes('18211576983'), afterLogin.info);
eq('本地副本同步', afterLogin.stored, 'app:aaaabbbbccccddddeeeeffff00001111');

/* ---------- 9. 登出 ---------- */

console.log('\n9) 登出（写空 token）');
await page.click('#btn-logout');
await page.waitForFunction(() => {
  const b = window.__gate.state.gate.values.SessionToken;
  return !!b && b.length === 0;
}, { timeout: 5000 }).catch(() => {});
const afterLogout = await page.evaluate(() => ({
  len: (window.__gate.state.gate.values.SessionToken || new Uint8Array()).length,
  view: document.getElementById('token-view').textContent,
  stored: localStorage.getItem('shin.gatekeeper.session'),
}));
eq('通道被清空', afterLogout.len, 0);
eq('界面回到未设置', afterLogout.view, '(未设置)');
eq('本地副本被清掉', afterLogout.stored, null);

/* ---------- 10. 收尾 ---------- */

console.log('\n10) 收尾');
eq('没有请求被放行到真外网', seen.blocked, 0);
ok('全程无页面异常', pageErrors.length === 0, pageErrors.join(' | '));

// 版式不溢出：面板内的滚动必须留在面板里，页面本身不许出现滚动条。
// 长签名串最容易把事件行撑宽、逼出横向滚动，把左边缘（时间戳/标签）推出视野。
const overflow = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('.sec-body')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => el.parentElement.id);
  return {
    pageX: document.documentElement.scrollWidth - window.innerWidth,
    pageY: document.documentElement.scrollHeight - window.innerHeight,
    panels,
  };
});
ok('页面无横向溢出', overflow.pageX <= 0, `溢出 ${overflow.pageX}px`);
ok('页面无纵向溢出', overflow.pageY <= 0, `溢出 ${overflow.pageY}px`);
ok('面板内无横向溢出', overflow.panels.length === 0, overflow.panels.join(','));

await page.screenshot({ path: path.join(outDir, 'gatekeeper-smoke.png') });
console.log('\n截图：' + path.relative(cwd, path.join(outDir, 'gatekeeper-smoke.png')));

await browser.close();
host.child.kill();
console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败`);
// 用 exitCode 而不是 process.exit()：stdout 是管道时 process.exit() 会截断还没 flush
// 的输出（表现为"管道给下游时什么都收不到"，很误导）。
process.exitCode = fail === 0 ? 0 : 1;
