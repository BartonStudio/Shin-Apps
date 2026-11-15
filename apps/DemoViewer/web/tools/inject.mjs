// ============================================================================
// inject.mjs —— 生成「用共享内存镜像替他 parser.worker」的注入脚本
// ============================================================================
//
// 两个使用者：
//   · tools/playback-test.mjs   自动化回归（headless + CDP 注入 + 截图断言）
//   · tools/serve-playback.mjs  交互式观看（服务端注入，你用自己浏览器打开）
//
// 原理：在页面任何脚本执行前，把 window.Worker 换成替身。替身只拦截 URL 含
//       parser.worker 的那个，其余（mapGeometry 等）放行。拦截后不跑 wasm，
//       而是 fetch 镜像 → buildDataFromSharedBuffer → 按真实工人协议回消息。
//
//       应用完全不知道自己拿到的不是自己解析的数据 —— 它走的是同一条
//       onReady → kz() → new DemoApp() 路径。
//
// 详见 docs/12-e2e-playbook.md §六。
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * @param {object} opts
 * @param {string} [opts.imageUrl]  镜像的 URL（默认 '/__playback.bin'）
 * @param {object|null} [opts.visible]  可见水位；null 时让脚本自己去 fetch sidecar
 * @param {string} [opts.sidecarUrl]  sidecar URL（visible 为 null 时用）
 * @param {boolean} [opts.autoTrigger] 是否自动向 #fileInput 塞假 File 触发加载
 * @returns {string} 可注入的脚本源码（IIFE）
 */
export function buildInjectScript({
  imageUrl = '/__playback.bin',
  visible = null,
  sidecarUrl = '/__playback-sidecar.json',
  autoTrigger = false,
} = {}) {
  // 内联 shared-buffer.js，去掉 ES module 语法后它就能当普通脚本用
  let sb = fs.readFileSync(path.join(REPO_ROOT, 'src/deobfuscated/shared-buffer.js'), 'utf8');
  sb = sb.replace(/^export /gm, '');

  return `
(() => {
  // ── ① 内联 shared-buffer.js ──
${sb}

  const IMAGE_URL  = ${JSON.stringify(imageUrl)};
  const SIDECAR_URL = ${JSON.stringify(sidecarUrl)};
  const INLINE_VISIBLE = ${JSON.stringify(visible)};
  const AUTO_TRIGGER = ${autoTrigger ? 'true' : 'false'};

  window.__playbackLog = [];
  const log = (s) => { try { window.__playbackLog.push(s); console.log('[inject] ' + s); } catch (e) {} };

  let imageCache = null;
  async function getData() {
    if (!imageCache) {
      const resp = await fetch(IMAGE_URL);
      if (!resp.ok) throw new Error('fetch image failed: HTTP ' + resp.status);
      imageCache = { ab: await resp.arrayBuffer() };
      log('image loaded: ' + imageCache.ab.byteLength + ' bytes');
    }
    let visible = INLINE_VISIBLE;
    if (!visible) {
      const r = await fetch(SIDECAR_URL);
      if (!r.ok) throw new Error('fetch sidecar failed: HTTP ' + r.status);
      visible = (await r.json()).visible;
    }
    const data = buildDataFromSharedBuffer(imageCache.ab, visible);
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

  // ── ② worker 替身 ──
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
        emit({ type: 'progress', phase: 'Loading parser…', value: 0.04 });
        const t0 = performance.now();
        const { data, manifest } = await getData();
        log('data built in ' + Math.round(performance.now() - t0) + 'ms; N=' + data.meta.numFrames);
        emit({ type: 'manifest', manifest });
        emit({ type: 'progress', phase: 'Loaded from shared-buffer image', value: 1 });
        // 一次性给全部回合（真实协议里 ready 之后还会有 round/done）
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

  // ── ③ 只拦 parser.worker ──
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

  // ── ④ 可选：自动触发文件选择，省掉手点 ──
  if (AUTO_TRIGGER) {
    const tryStart = (attempt) => {
      const input = document.getElementById('fileInput');
      if (!input) {
        if (attempt < 200) setTimeout(() => tryStart(attempt + 1), 100);
        else log('auto-trigger gave up: #fileInput not found');
        return;
      }
      try {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(16)], 'injected.dem', { type: 'application/octet-stream' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        log('auto-triggered #fileInput');
      } catch (e) {
        log('auto-trigger failed: ' + e.message);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(() => tryStart(0), 300));
    } else {
      setTimeout(() => tryStart(0), 300);
    }
  }
})();
`;
}
