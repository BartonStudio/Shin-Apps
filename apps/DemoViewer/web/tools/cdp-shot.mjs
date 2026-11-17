// CDP 截图：node tools/cdp-shot.mjs [输出.png]
import fs from 'node:fs';
const out = process.argv[2] ?? 'tmp/playback.png';
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
  ws.send(JSON.stringify({ id: i, method: 'Page.captureScreenshot', params: { format: 'png' } }));
});
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(out, Buffer.from(res.result.data, 'base64'));
console.log('saved: ' + out);
ws.close();
process.exit(0);
