// ============================================================================
// serve-playback.mjs —— 交互式查看：起服务 → 你用浏览器打开 → 自动播放 C++ 数据
// ============================================================================
//
// 和 tools/playback-test.mjs 的区别：
//   playback-test.mjs   自动化回归（headless + CDP 注入 + 截图断言 → 进 ctest）
//   serve-playback.mjs  交互观看（服务端注入，你自己浏览器打开，可以拖时间轴/换视角）
//
// 不做任何浏览器自动化：注入脚本由服务器**写进 index.html 的响应流**，
// 所以任何浏览器直接打开 URL 就行，不需要 CDP，也不需要 headless。
//
// 用法：
//   node tools/serve-playback.mjs                                    # 用 tmp/ 里现成的镜像
//   node tools/serve-playback.mjs --image out/from-my-parser.bin
//   node tools/serve-playback.mjs --port 8080 --open                 # 自动打开浏览器
//   node tools/serve-playback.mjs --no-auto                          # 不自动触发，自己点"打开文件"
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildInjectScript } from './inject.mjs';
import { imagePath, sidecarPath, needFile, opt, hasFlag, wantsHelp, printUsage } from './paths.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(REPO_ROOT, 'raw');

if (wantsHelp()) {
  printUsage('tools/serve-playback.mjs',
    '交互式查看：起本地服务，用你自己的浏览器打开就能看 C++ 数据播放',
    [
      ['--image <path>', '共享内存镜像（默认 $CSDEMO_IMAGE 或 <repo>/tmp/shared-from-cpp-rt.bin）'],
      ['--sidecar <path>', '旁挂水位 json（默认同目录 shared-from-js.json）'],
      ['--port <n>', '端口（默认 8124）'],
      ['--open', '启动后自动用默认浏览器打开'],
      ['--no-auto', '不在页面加载后自动播放（改成手动点"打开文件"）'],
      ['--help, -h', '打印本帮助'],
    ],
    [
      'node tools/serve-playback.mjs',
      'node tools/serve-playback.mjs --image tmp/from-my-parser.bin --port 8080 --open',
    ]);
  process.exit(0);
}

const PORT = Number(opt('port') ?? 8124);
const AUTO = !hasFlag('no-auto');
const OPEN = hasFlag('open');

const IMAGE = needFile(imagePath('shared-from-cpp-rt.bin'), '共享内存镜像', '--image', 'CSDEMO_IMAGE',
  '先跑一遍：node tools/gen-js-image.mjs --demo <dem> 然后 cpp/roundtrip_test');
const SIDECAR = sidecarPath();
if (!fs.existsSync(SIDECAR)) {
  console.error(`\n✗ 找不到旁挂水位文件：${SIDECAR}\n` +
    `  它由 node tools/gen-js-image.mjs 生成，或直接用 --sidecar <path> 指定。\n`);
  process.exit(2);
}

const INJECT = buildInjectScript({
  imageUrl: '/__playback.bin',
  sidecarUrl: '/__playback-sidecar.json',
  autoTrigger: AUTO,
});

// ── 与 serve.mjs 相同的运行时代理（让地图几何/雷达能从 maps.csdemo.tv 拉下来）──
const UPSTREAM = { '/__data': 'https://data.csdemo.tv', '/__maps': 'https://maps.csdemo.tv' };
const REWRITE = [['https://data.csdemo.tv', '/__data'], ['https://maps.csdemo.tv', '/__maps']];
const rewrite = (t) => REWRITE.reduce((s, [a, b]) => s.split(a).join(b), t);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.bin': 'application/octet-stream',
};

let upstreamWarned = false;
function warnUpstreamOnce(prefix, msg) {
  if (upstreamWarned) return;
  upstreamWarned = true;
  console.log('');
  console.log('  ⚠ 上游不可达：' + UPSTREAM[prefix] + '  （' + msg + '）');
  console.log('     后果：地图几何/雷达/人物模型拿不到 → 场景会降级成网格、角色显示为胶囊体。');
  console.log('     数据链路本身不受影响，播放器仍可正常播放。');
  console.log('     要看到完整地图，请确认本机能访问 maps.csdemo.tv。');
  console.log('');
}

async function proxy(req, res, prefix) {
  if (req.method !== 'GET') { res.writeHead(405).end('method not allowed'); return; }
  const rest = req.url.slice(prefix.length) || '/';
  try {
    const upstreamRes = await fetch(UPSTREAM[prefix] + rest, { headers: { accept: '*/*' } });
    const type = upstreamRes.headers.get('content-type') ?? 'application/octet-stream';
    res.writeHead(upstreamRes.status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    if (type.includes('json')) { res.end(rewrite(await upstreamRes.text())); return; }
    res.end(Buffer.from(await upstreamRes.arrayBuffer()));
  } catch (err) {
    warnUpstreamOnce(prefix, err instanceof Error ? err.message : String(err));
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 把注入脚本插到 app bundle 的 module script 之前 */
function serveIndexWithInject(res) {
  const src = fs.readFileSync(path.join(RAW, 'index.html'), 'utf8');
  const marker = '<script type="module"';
  const at = src.indexOf(marker);
  const tag = '<script src="/__playback-inject.js"></script>\n      ';
  const out = at >= 0 ? src.slice(0, at) + tag + src.slice(at) : src.replace('</head>', tag + '</head>');
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
  res.end(out);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);

  // ① 注入资源
  if (url === '/__playback-inject.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    res.end(INJECT);
    return;
  }
  if (url === '/__playback-sidecar.json') {
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(SIDECAR));
    return;
  }
  if (url === '/__playback.bin') {
    res.writeHead(200, { 'Content-Type': TYPES['.bin'], 'Content-Length': fs.statSync(IMAGE).size });
    fs.createReadStream(IMAGE).pipe(res);
    return;
  }

  // ② 代理
  for (const prefix of Object.keys(UPSTREAM)) {
    if (url === prefix || url.startsWith(`${prefix}/`)) { void proxy(req, res, prefix); return; }
  }

  // ③ index.html：响应流里注入脚本
  if (url === '/' || url === '/index.html') { serveIndexWithInject(res); return; }

  // ④ 其余静态文件（与 serve.mjs 同样做 URL 改写）
  let file = path.join(RAW, url);
  if (!path.resolve(file).startsWith(path.resolve(RAW))) { res.writeHead(403).end('forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found: ' + url); return; }
  const ext = path.extname(file).toLowerCase();
  if (ext === '.js' || ext === '.json') {
    res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(rewrite(fs.readFileSync(file, 'utf8')));
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║  交互式播放（数据来自共享内存镜像，不是真的解析 demo）        ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   打开：  ${url}`);
  console.log(`   镜像：  ${IMAGE}`);
  console.log(`   水位：  ${SIDECAR}`);
  console.log(`   自动播放：${AUTO ? '开（进入后自动加载数据）' : '关（需手动点"打开文件"）'}`);
  console.log('');
  console.log('   页面里能做的：拖时间轴、调倍速、切换 POV、自由视角（F / Fly / V / Noclip）');
  console.log('   注意：地图几何/雷达/人物模型走 maps.csdemo.tv，需要联网；离线会降级成网格 + 胶囊体');
  console.log('');
  console.log('   Ctrl+C 停止');
  console.log('');

  // 网络自检：提前告诉用户地图资源能不能拉到（否则要等页面报错才知道）
  void (async () => {
    const probe = async (url) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      try {
        const r = await fetch(url, { method: 'HEAD', signal: ctl.signal });
        return r.ok || r.status < 500;
      } catch { return false; } finally { clearTimeout(timer); }
    };
    const [maps, data] = await Promise.all([
      probe('https://maps.csdemo.tv/'),
      probe('https://data.csdemo.tv/'),
    ]);
    if (maps && data) {
      console.log('   网络自检：地图/数据 CDN 可达 —— 可以加载真实地图几何与雷达');
    } else {
      console.log('   网络自检：' + [
        !maps ? 'maps.csdemo.tv 不可达' : null,
        !data ? 'data.csdemo.tv 不可达' : null,
      ].filter(Boolean).join(' / '));
      console.log('     → 地图几何/雷达/人物模型会缺失，场景降级为网格 + 胶囊体；');
      console.log('       数据、角色位置、HUD、时间轴不受影响。');
    }
    console.log('');
  })();

  if (OPEN) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
    try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch { /* 忽略 */ }
  }
});

process.on('SIGINT', () => { console.log('\n  已停止。\n'); server.close(); process.exit(0); });
