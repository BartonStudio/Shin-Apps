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

// 本地素材镜像（tools/mirror-csdemo-assets.mjs 的产物）——离线应用的资源来源。
// 目录结构与 maps.csdemo.tv 的 URL 路径逐字对应，所以映射就是纯字符串拼接。
const MIRROR = path.join(import.meta.dirname, 'cdn', 'mirror', 'maps.csdemo.tv');
const LOCAL_ROUTES = {
  '/cs2': path.join(MIRROR, 'cs2'),      // CS2 素材包（角色/武器/声音）——可读代码里 VITE_CS2_ASSETS_URL=/cs2/
  '/maphost': MIRROR,                    // 地图宿主清单 + release + objects —— MAP_HOST_URL 改 /maphost/
};

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
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/** 从本地镜像路径发文件；不存在返回 false（调用方回退到代理）。 */
function serveMirrorFile(res, absFile) {
  if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) return false;
  const ext = path.extname(absFile).toLowerCase();
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    // 本地开发期 webapp（:5173）与本服务（:8123）不同源，素材是公开静态资源，放开跨域。
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(absFile).pipe(res);
  return true;
}

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
  // 离线优先：/__maps/* 先查本地镜像，命中就直接发本地（无网络请求）
  if (prefix === '/__maps' && serveMirrorFile(res, path.join(MIRROR, rest))) return;
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

  // 本地镜像直连路由（离线模式的正式入口；/cs2/* 与 /maphost/* 完全不出网）
  for (const [prefix, dir] of Object.entries(LOCAL_ROUTES)) {
    if (url === prefix || url.startsWith(`${prefix}/`)) {
      const rest = url.slice(prefix.length) || '/';
      if (!path.resolve(dir, '.' + rest).startsWith(path.resolve(dir))) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (!serveMirrorFile(res, path.join(dir, rest))) res.writeHead(404).end('not in local mirror（跑 tools/mirror-csdemo-assets.mjs 补齐）');
      return;
    }
  }

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

  // native 注入脚本：ShinDemoViewer.exe 宿主需要它建立 Worker 替身 + 契约数据通道
  if (url === '/__cs2_inject.js') {
    const inj = path.join(import.meta.dirname, 'tools', 'cs2-native-inject.js');
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(inj));
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] ?? 'application/octet-stream';

  if (ext === '.js' || ext === '.json') {
    const body = rewrite(fs.readFileSync(file, 'utf8'));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }

  // HTML：往响应流里插一行脚本标签（raw/ 原文件不动，改写只发生在响应流里）。
  // classic script 先于 type=module 执行 → 注入脚本抢在 bundle 之前装好 Worker 替身。
  if (ext === '.html') {
    const body = rewrite(fs.readFileSync(file, 'utf8'));
    const tag = '<script src="/__cs2_inject.js"></script>';
    const patched = body.includes('/__cs2_inject.js')
      ? body
      : body.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(patched);
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
