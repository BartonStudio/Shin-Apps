// ============================================================================
// gen-cs2-inject.mjs —— 生成 native 注入脚本 cs2-native-inject.js
//
// 用法：node tools/gen-cs2-inject.mjs
// 产物：tools/cs2-native-inject.js（被 ShinDemoViewer.exe 在页面脚本之前注入，
//       经 WebviewShell::InjectJSBeforeLoad → AddScriptToExecuteOnDocumentCreated）
//
// 原理（改自 tools/inject.mjs 的 worker 替身方案，数据源从 fetch 镜像换成
// 宿主推送）：拦截 parser.worker，替身不跑 wasm，而是用宿主经
// chrome.webview 推来的 CSDF 契约块（sharedbufferreceived type="csdf"）
// + 水位消息（PostWebMessageAsJson type="csdf-ready"）构建 data，
// 按真实工人协议回消息。应用完全无感 —— 走同一条 ready → new DemoApp() 路径。
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const sb = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'deobfuscated', 'shared-buffer.js'), 'utf8')
  .replace(/^export /gm, '');

const wrapper = `
(() => {
  const log = (s) => { try { window.__playbackLog.push(s); console.log('[cs2-native] ' + s); } catch (e) {} };
  window.__playbackLog = [];

  // ── 宿主数据通道 ──
  let csdfBuffer = null;   // ArrayBuffer（宿主 SendBinaryWithType("csdf") 推来）
  let readyMsg = null;     // 水位消息（csdf-ready：version/loadedRounds/visibleFrames/…）

  try {
    const wv = window.chrome && window.chrome.webview;
    if (!wv) throw new Error('chrome.webview 不可用（不在 WebView2 宿主里？）');
    wv.addEventListener('sharedbufferreceived', (e) => {
      try {
        // WebView2 各版本 additionalData 形态不一：可能是对象 / JSON 字符串 / 挂在
        // e.additionalData / 干脆为 null。本应用只推一种二进制（csdf），null 时直接认。
        let meta = e.data ?? e.additionalData ?? null;
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
        const type = meta && meta.type;
        log('SB event: type=' + (type ?? '(null)'));
        if (!type || type === 'csdf') {
          csdfBuffer = e.getBuffer();
          log('契约数据块已收到: ' + (csdfBuffer.byteLength / 1048576).toFixed(1) + ' MB');
          tryStart();
        }
      } catch (err) { log('sharedbufferreceived error: ' + err.message); }
    });
    wv.addEventListener('message', (e) => {
      try {
        const d = e.data;
        log('msg event: typeof=' + typeof d + ' ' + (d && typeof d === 'object' ? 'type=' + d.type : String(d).slice(0, 80)));
        if (d && typeof d === 'object' && d.type === 'csdf-ready') {
          readyMsg = d;
          log('csdf-ready: version=' + d.version + ' visible=' + d.visibleFrames);
          tryStart();
        }
      } catch (err) { log('message error: ' + err.message); }
    });
    log('宿主通道已挂接');
  } catch (e) {
    log('宿主通道不可用: ' + e.message);
  }

  function buildPayload() {
    if (!csdfBuffer) throw new Error('契约数据块尚未就绪');
    if (!readyMsg) throw new Error('水位消息尚未就绪');
    const data = buildDataFromSharedBuffer(csdfBuffer, readyMsg);
    const manifest = {
      mapName: data.meta.mapName,
      tickRate: data.meta.tickRate,
      startTick: data.meta.startTick,
      endTick: data.meta.endTick,
      durationSeconds: data.meta.durationSeconds,
      rounds: data.rounds,
    };
    return { data, manifest };
  }

  // ── worker 替身（同 tools/inject.mjs）──
  function makeShim(url) {
    const msgHandlers = [];
    const errHandlers = [];
    const self = {
      _onmessage: null,
      set onmessage(fn) { self._onmessage = fn; },
      get onmessage() { return self._onmessage; },
      set onerror(fn) { errHandlers.push(fn); },
      addEventListener(t, fn) { if (t === 'message') msgHandlers.push(fn); else if (t === 'error') errHandlers.push(fn); },
      removeEventListener() {},
      terminate() {},
      postMessage(msg) { handle(msg); },
    };
    const emit = (obj) => {
      const ev = { data: obj };
      try { self._onmessage && self._onmessage(ev); } catch (e) { log('onmessage threw: ' + e.message); }
      for (const h of msgHandlers) { try { h(ev); } catch (e) { log('listener threw: ' + e.message); } }
    };
    async function handle(msg) {
      log('worker<- ' + (msg && msg.type));
      if (!msg || msg.type !== 'parse') return;
      try {
        emit({ type: 'progress', phase: 'Loading from native host…', value: 0.04 });
        const t0 = performance.now();
        const { data, manifest } = buildPayload();
        log('data built in ' + Math.round(performance.now() - t0) + 'ms; N=' + data.meta.numFrames);
        emit({ type: 'manifest', manifest });
        emit({ type: 'progress', phase: 'Loaded from native host', value: 1 });
        emit({ type: 'ready', data, manifest, loadedRounds: data.rounds.length });
        emit({ type: 'done', data });
        log('emitted ready+done');
      } catch (e) {
        log('shim error: ' + ((e && e.stack) || e));
        emit({ type: 'error', message: String((e && e.message) || e) });
      }
    }
    return self;
  }

  const RealWorker = window.Worker;
  function PatchedWorker(url, opts) {
    const u = String(url);
    if (u.includes('parser.worker')) {
      log('intercepted parser worker: ' + u.split('/').pop());
      return makeShim(u);
    }
    return new RealWorker(url, opts);
  }
  PatchedWorker.prototype = RealWorker.prototype;
  window.Worker = PatchedWorker;
  log('Worker patched');

  // ── 自动触发：csdf-ready 后塞假 File 启动应用的解析流程 ──
  let triggered = false;
  function tryStart(attempt) {
    if (triggered || !csdfBuffer || !readyMsg) return;
    const input = document.getElementById('fileInput');
    if (!input) {
      if (attempt < 300) setTimeout(() => tryStart(attempt === undefined ? 0 : attempt + 1), 100);
      else log('auto-trigger gave up: #fileInput not found');
      return;
    }
    try {
      triggered = true;
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(16)], 'native.dem', { type: 'application/octet-stream' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      log('auto-triggered #fileInput');
    } catch (e) {
      triggered = false;
      log('auto-trigger failed: ' + e.message);
    }
  }
})();
`;

fs.writeFileSync(path.join(import.meta.dirname, 'cs2-native-inject.js'),
  '/* 自动生成：node tools/gen-cs2-inject.mjs —— 不要手改本文件（改 gen 脚本或 shared-buffer.js） */\n' +
  '(function () {\n' + sb + '\n' + wrapper + '})();\n');
console.log('written: tools/cs2-native-inject.js');
