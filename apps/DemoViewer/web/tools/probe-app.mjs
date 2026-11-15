// 最小探测：起静态服务器 + Chrome headless，看原应用能否启动。
//
// 目的：在投入「注入数据让应用播放」之前，先确认
//   ① Chrome headless 能跑 ② CDP 能连 ③ 应用 bundle 能加载 ④ 有没有致命错误
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'raw');
const PORT = 18717;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(RAW, p);
    if (!file.startsWith(RAW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA 回退；同时为 favicon 等给个 204
      if (p === '/favicon.svg') { res.writeHead(204); res.end(); return; }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found: ' + p);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
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

async function cdp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
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
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return {
    send,
    on: (fn) => listeners.push(fn),
    ready: new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); }),
    close: () => ws.close(),
  };
}

const server = await startServer();
console.log(`static server: http://127.0.0.1:${PORT}/  (root = raw/)`);

const chrome = findChrome();
if (!chrome) { console.error('找不到 Chrome/Edge'); server.close(); process.exit(2); }
console.log(`browser: ${chrome}`);

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-probe-'));
const proc = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=18718',
  `--user-data-dir=${userDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu-sandbox',
  '--enable-unsafe-swiftshader',   // 软件 WebGL（headless 常见需要）
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--window-size=1280,720',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let browserErr = '';
proc.stderr.on('data', (d) => { browserErr += d.toString(); });

let fails = 0;
const check = (ok, label, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  —  ' + detail : ''}`);
  if (!ok) fails++;
};

try {
  const wsUrl = await cdp(18718);
  console.log('CDP connected\n');
  const c = makeClient(wsUrl);
  await c.ready;

  const consoleMsgs = [];
  const pageErrors = [];
  c.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      consoleMsgs.push({ type: m.params.type, text: args });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '?');
    }
  });

  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Log.enable').catch(() => {});

  await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await new Promise((r) => setTimeout(r, 6000));

  // DOM 概况
  const evalJs = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  const title = await evalJs('document.title');
  check(!!title && title.includes('CSDEMO'), '页面标题正确', String(title));

  const canvasCount = await evalJs('document.querySelectorAll("canvas").length');
  check(canvasCount > 0, '页面存在 canvas（WebGL 上下文已建立）', `canvas=${canvasCount}`);

  const appState = await evalJs(`(() => {
    const f = document.getElementById('fileInput');
    return JSON.stringify({
      hasFileInput: !!f,
      accept: f?.accept ?? null,
      bodyChildren: document.body.children.length,
      dropZone: !!document.getElementById('dropZone'),
    });
  })()`);
  console.log(`  app DOM: ${appState}`);

  const webglInfo = await evalJs(`(() => {
    const c = document.querySelector('canvas');
    if (!c) return 'no canvas';
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'no gl context';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return JSON.stringify({
      w: c.width, h: c.height,
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    });
  })()`);
  console.log(`  webgl: ${webglInfo}`);

  const fatal = pageErrors.filter((e) => !/favicon|Failed to fetch|net::ERR/.test(e));
  check(fatal.length === 0, '没有致命 JS 异常', fatal.length ? fatal[0].slice(0, 160) : '');
  if (fatal.length) for (const e of fatal.slice(0, 5)) console.log(`    ! ${e.slice(0, 200)}`);

  console.log(`\n  console 消息 ${consoleMsgs.length} 条：`);
  for (const m of consoleMsgs.slice(0, 15)) console.log(`    [${m.type}] ${m.text.slice(0, 160)}`);

  // 截图
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const shotPath = path.join(ROOT, 'tmp', 'probe-app.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(`\n  截图: ${shotPath} (${fs.statSync(shotPath).size} 字节)`);

  c.close();
} catch (e) {
  console.error('harness error:', e.message);
  if (browserErr) console.error('browser stderr:', browserErr.slice(-800));
  fails++;
} finally {
  proc.kill();
  server.close();
  await new Promise((r) => setTimeout(r, 400));
  fs.rmSync(userDir, { recursive: true, force: true });
}

console.log(`\n${fails ? 'FAIL: probe 有问题' : 'OK: 应用能在 headless 里启动'}`);
process.exitCode = fails ? 1 : 0;
