// 端到端播放验证：把 C++ 写出的共享内存镜像**注入原应用**，让它真正播起来。
//
// 链路（对应你提的第 ⑤⑥ 步）：
//   ① JS 解析 test.dem            tools/gen-js-image.mjs
//   ② C++ 读回 → DemoData → 写回   cpp/roundtrip_test
//   ③ JS 读 C++ 镜像 → 注入页面 → 播放  ← 本文件
//
// 注入手法：在页面加载前替换 `Worker`。当应用为解析创建 parser.worker 时，
// 我们的替身不跑 wasm，而是取 C++ 镜像 → buildDataFromSharedBuffer → 按真实工人协议
// 回 ready/round/done 消息。应用完全不知道数据不是它自己解析的。
//
// 用法：node tools/playback-test.mjs [--image tmp/shared-from-cpp-rt.bin] [--keep]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildInjectScript as buildInjectScriptShared } from './inject.mjs';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'raw');
const PORT = Number(opt('port') ?? 18721);
const CDP_PORT = 18722;
import {
  REPO_ROOT as P_ROOT, demoPath, tmpDir, tmpFile, imagePath, sidecarPath,
  goldenPath, needFile, opt, hasFlag, wantsHelp, printUsage, COMMON_OPTIONS,
} from './paths.mjs';

if (wantsHelp()) {
  printUsage('tools/playback-test.mjs',
    '把共享内存镜像注入原应用，在 headless Chrome 里真正播放并截图',
    [COMMON_OPTIONS.image, COMMON_OPTIONS.sidecar, ['--chrome <path>', '浏览器可执行文件（默认自动找 Chrome/Edge）'],
     ['--port <n>', '静态服务器端口（默认 18721）'], ['--out <png>', '截图输出路径'], ['--keep', '保留浏览器临时 profile'], COMMON_OPTIONS.help],
    ['node tools/playback-test.mjs',
     'node tools/playback-test.mjs --image D:\\out\\rt.bin --chrome "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"']);
  process.exit(0);
}

const IMAGE = needFile(imagePath('shared-from-cpp-rt.bin'), '共享内存镜像', '--image', 'CSDEMO_IMAGE',
  '先跑：node tools/gen-js-image.mjs + cpp/roundtrip_test');
const KEEP = process.argv.includes('--keep');

if (!fs.existsSync(IMAGE)) {
  console.error(`missing image: ${IMAGE}`);
  console.error('先跑: node tools/gen-js-image.mjs && cpp/roundtrip_test');
  process.exit(2);
}
const SIDECAR = sidecarPath();
const sidecar = fs.existsSync(SIDECAR) ? JSON.parse(fs.readFileSync(SIDECAR, 'utf8')) : null;
if (!sidecar) console.warn(`⚠ 未找到旁挂水位文件 ${SIDECAR}，将使用镜像 header 推导水位`);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.bin': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // 镜像单独挂一个路径
  if (p === '/__image.bin') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fs.statSync(IMAGE).size });
    fs.createReadStream(IMAGE).pipe(res);
    return;
  }
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(RAW, p);
  if (!file.startsWith(RAW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (p === '/favicon.svg') { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404 ' + p); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`server : http://127.0.0.1:${PORT}/  （自动化测试自用，请勿在浏览器里打开）`);
console.log('         注入只对本脚本启动的 headless 浏览器生效；你自己打开只会看到落地页。');
console.log('         想看画面：node tools/serve-playback.mjs --open');
console.log(`image  : ${IMAGE}  ${(fs.statSync(IMAGE).size / 1048576).toFixed(2)} MB`);

function buildInjectScript() {
  // 复用 tools/inject.mjs —— tools/serve-playback.mjs 用的是同一份脚本，
  // 改注入逻辑只需要改那一处。
  return buildInjectScriptShared({
    imageUrl: '/__image.bin',        // 本测试内置的服务器挂的路径
    visible: sidecar?.visible ?? null,
    autoTrigger: false,              // 这个测试自己通过 CDP 触发，便于精确控制时机
  });
}

function findChrome() {
  const cands = [
    path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

async function discover(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    if (Date.now() > deadline) throw new Error('CDP discovery timeout');
    await new Promise((r) => setTimeout(r, 250));
  }
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method) for (const l of listeners) l(m);
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id; pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    on: (fn) => listeners.push(fn),
    ready: new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); }),
    close: () => ws.close(),
  };
}

let fails = 0;
const check = (ok, label, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  —  ' + detail : ''}`);
  if (!ok) fails++;
};

const chrome = findChrome();
if (!chrome) { console.error('no browser'); server.close(); process.exit(2); }
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-play-'));
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1280,720',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let browserErr = '';
proc.stderr.on('data', (d) => { browserErr += d.toString(); });

try {
  const wsUrl = await discover();
  const c = makeClient(wsUrl);
  await c.ready;

  const consoleMsgs = [];
  const pageErrors = [];
  c.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleMsgs.push({ type: m.params.type, text: (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ') });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '?');
    }
  });
  await c.send('Runtime.enable');
  await c.send('Page.enable');

  // 注入（在页面任何脚本之前）
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: buildInjectScript() });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await new Promise((r) => setTimeout(r, 5000));

  const evalJs = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result?.value;
  };

  check(await evalJs('!!window.__playbackLog'), '注入脚本已生效', String(await evalJs('JSON.stringify((window.__playbackLog||[]).slice(0,3))')));

  // 触发：伪造一个小 File 塞进 fileInput（字节内容是假的，真数据由 worker 替身给）
  const triggered = await evalJs(`(() => {
    const input = document.getElementById('fileInput');
    if (!input) return 'no fileInput';
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(16)], 'cpp-injected.dem', { type: 'application/octet-stream' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  check(triggered === 'ok', '已触发文件加载流程', String(triggered));

  // 等数据构建 + 播放器创建
  await new Promise((r) => setTimeout(r, 12000));

  const logTail = await evalJs('JSON.stringify((window.__playbackLog||[]).slice(-12))');
  console.log(`\n  inject log: ${logTail}`);

  const state = await evalJs(`(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    const big = canvases.find(c => c.width > 200 && c.height > 200);
    return JSON.stringify({
      canvasCount: canvases.length,
      bigCanvas: big ? { w: big.width, h: big.height } : null,
      loadingHidden: (() => {
        const l = document.getElementById('loading');
        return !l || l.classList.contains('hidden') || getComputedStyle(l).display === 'none';
      })(),
      hasApp: !!document.querySelector('[data-mobile-feed]'),
      bodyAttrs: [...document.body.attributes].map(a => a.name).slice(0, 8),
    });
  })()`);
  console.log(`  page state: ${state}`);
  const st = JSON.parse(state);

  check(st.canvasCount > 0, '播放器 canvas 已创建', `count=${st.canvasCount}`);
  check(!!st.bigCanvas, 'canvas 有实际尺寸', st.bigCanvas ? `${st.bigCanvas.w}x${st.bigCanvas.h}` : 'none');
  check(st.loadingHidden, 'loading 遮罩已隐藏（进入播放器）', String(st.loadingHidden));

  // 播放是否在推进：采样两次 canvas 与内部状态
  const probe = `(() => {
    const c = document.querySelector('canvas');
    const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
    return JSON.stringify({ t: performance.now(), w: c ? c.width : 0, gl: !!gl });
  })()`;
  const p1 = JSON.parse(await evalJs(probe));
  await new Promise((r) => setTimeout(r, 2000));
  const p2 = JSON.parse(await evalJs(probe));
  check(p2.t > p1.t, 'rAF/页面时钟在推进', `${Math.round(p1.t)} → ${Math.round(p2.t)}`);

  const fatal = pageErrors.filter((e) => !/favicon|Failed to fetch|net::ERR|HostedCatalogue|landing backdrop/.test(e));
  check(fatal.length === 0, '没有致命 JS 异常', fatal.length ? fatal[0].slice(0, 200) : '');
  if (fatal.length) for (const e of fatal.slice(0, 6)) console.log(`    ! ${e.slice(0, 220)}`);

  console.log(`\n  console 消息 ${consoleMsgs.length} 条（前 12）：`);
  for (const m of consoleMsgs.slice(0, 12)) console.log(`    [${m.type}] ${m.text.slice(0, 170)}`);

  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const shotPath = opt('out') ? path.resolve(opt('out')) : tmpFile('playback.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(`\n  截图: ${shotPath} (${fs.statSync(shotPath).size} 字节)`);

  c.close();
} catch (e) {
  console.error('harness error:', e.message);
  if (browserErr) console.error('browser stderr:', browserErr.slice(-600));
  fails++;
} finally {
  proc.kill();
  server.close();
  await new Promise((r) => setTimeout(r, 400));
  if (!KEEP) fs.rmSync(userDir, { recursive: true, force: true });
}

console.log(`\n${fails ? 'FAIL: playback 有问题' : 'OK: 注入数据后应用成功进入播放'}`);
process.exitCode = fails ? 1 : 0;
