// 本地静态服务器：把 raw/ 原样当成 csdemo.tv 的根目录来服务。
// 用法：node serve.mjs [port]   默认 http://127.0.0.1:8123
//
// 说明（都是实测结论，见 docs/05-assets-and-apis.md）：
// 1. bundle 内部用的是绝对路径（/assets/…、/icons/…），必须以"站点根目录"方式打开，不能双击 index.html。
// 2. csdemo 的两个内容子域只对 https://csdemo.tv 这个 Origin 返回 CORS 头
//    （Access-Control-Allow-Origin: https://csdemo.tv 且 Vary: Origin），
//    别的 Origin 一律拿不到头，所以直连会被浏览器拦。这里做**运行时代理 + URL 改写**：
//      - 响应 .js / .json 时，把 https://data.csdemo.tv 改成 /__data、https://maps.csdemo.tv 改成 /__maps
//      - /__data/* 与 /__maps/* 由本服务器转发到上游（服务端转发，不受 CORS 限制）
//    raw/ 里的原始文件一个字节都没改，改写只发生在响应流里。
// 3. 但职业比赛目录/托管产物还额外要求 URL 必须是 https（bundle 49233 行 `r.protocol !== 'https:'` 直接抛错），
//    所以 **http://127.0.0.1 下：本地 .dem 播放（含地图几何/雷达）可用，职业比赛列表会显示重试按钮**。
//    要连职业比赛一起用，请把本服务挂到 HTTPS 反向代理后面，或直接访问线上站点。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, 'raw');
const PORT = Number(process.argv[2] ?? 8123);

const UPSTREAM = {
  '/__data': 'https://data.csdemo.tv',
  '/__maps': 'https://maps.csdemo.tv',
};

const REWRITE = [
  ['https://data.csdemo.tv', '/__data'],
  ['https://maps.csdemo.tv', '/__maps'],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
  '.csda': 'application/octet-stream',
  '.dem': 'application/octet-stream',
};

function rewrite(text) {
  let out = text;
  for (const [from, to] of REWRITE) out = out.split(from).join(to);
  return out;
}

async function proxy(req, res, prefix) {
  const rest = req.url.slice(prefix.length) || '/';
  const upstream = UPSTREAM[prefix];
  // 约定：攻击面只有静态资源，限制 GET
  if (req.method !== 'GET') {
    res.writeHead(405).end('method not allowed');
    return;
  }
  try {
    const upstreamRes = await fetch(upstream + rest, { headers: { accept: '*/*' } });
    const type = upstreamRes.headers.get('content-type') ?? 'application/octet-stream';
    res.writeHead(upstreamRes.status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    if (type.includes('json')) {
      const text = await upstreamRes.text();
      res.end(rewrite(text));
      return;
    }
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);

  for (const prefix of Object.keys(UPSTREAM)) {
    if (url === prefix || url.startsWith(`${prefix}/`)) {
      void proxy(req, res, prefix);
      return;
    }
  }

  let file = path.join(ROOT, url);
  if (!path.resolve(file).startsWith(path.resolve(ROOT))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(ROOT, 'index.html'); // 与线上一致：未知路径回落 SPA

  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] ?? 'application/octet-stream';

  if (ext === '.js' || ext === '.json') {
    const body = rewrite(fs.readFileSync(file, 'utf8'));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }

  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`csdemo.tv mirror → http://127.0.0.1:${PORT}/`);
  console.log('root =', ROOT);
  console.log('proxy: /__data → https://data.csdemo.tv , /__maps → https://maps.csdemo.tv');
});
