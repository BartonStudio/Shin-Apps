// CDP 快速探针：读取页面 __playbackLog / __cs2 状态。用法：node tools/cdp-peek.mjs [expr]
import os from 'node:os';
const expr = process.argv[2] ?? 'JSON.stringify((window.__playbackLog||[]).slice(-20), null, 1)';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m); }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const res = await new Promise((resolve) => {
  const i = ++id;
  pending.set(i, resolve);
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});
if (res.result?.exceptionDetails) {
  console.log('EVAL ERROR: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 500));
} else {
  console.log(res.result?.result?.value ?? JSON.stringify(res.result));
}
ws.close();
process.exit(0);
