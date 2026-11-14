// 重新抓取 csdemo.tv 线上产物到 raw/（可复现）。2026-11-03 版本。
// 用法：node tools/fetch-raw.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..', 'raw');
const BASE = 'https://csdemo.tv';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const report = [];

// 首页 + 主 bundle + css + 两个 worker + wasm
const FILES = [
  '/index.html',
  '/favicon.svg',
  '/assets/index-E0opA-yG.js',
  '/assets/index-CKB5zRpH.css',
  '/assets/parser.worker-Cvx4vjXK.js',
  '/assets/mapGeometry.worker-BGvfBalF.js',
  '/assets/csplayer_parser_bg-qigVgicw.wasm',
  '/assets/GLTFLoader-maChTRxv.js', // 动态 import 的 GLTF 加载器（真实模型必需）
];

// 字体
const FONTS = [
  '/fonts/BarlowSemiCondensed-400.woff2',
  '/fonts/BarlowSemiCondensed-500.woff2',
  '/fonts/BarlowSemiCondensed-600.woff2',
  '/fonts/BarlowSemiCondensed-700.woff2',
];

// backdrop 静态图 + 落地页 3D 背景动画数据
const BACKDROPS = [
  '/backdrop/still-landscape.jpg',
  '/backdrop/still-landscape-dark.jpg',
  '/backdrop/still-portrait.jpg',
  '/backdrop/still-portrait-dark.jpg',
  '/backdrop/mirage-a-execute.bin',
];

// 武器/状态图标
const ICONS = [
  'ak47','m4a1','m4a1_silencer','awp','ssg08','famas','galilar','aug','sg556','mac10','mp9','mp7','mp5sd',
  'bizon','p90','ump45','deagle','glock','usp_silencer','hkp2000','p250','fiveseven','tec9','cz75a','elite',
  'revolver','m249','negev','nova','xm1014','mag7','sawedoff','scar20','g3sg1','taser','hegrenade','flashbang',
  'smokegrenade','molotov','incgrenade','decoy','knife','knife_t','knife_bowie','knife_m9_bayonet',
  'knife_gypsy_jackknife','c4','healthshot','skull','headshot','noscope','penetrate','smoke_kill','blind_kill',
  'defuser','armor','armor_helmet','crosshair',
];

// 旧版 mirage 灯光回退
const MAPS = ['/maps/de_mirage_lights.json'];

// 外部数据接口
const EXTERNAL = [
  ['https://maps.csdemo.tv/index.json', 'data/maps-index.json'],
  ['https://data.csdemo.tv/catalogue/v2/current.json', 'data/catalogue-pointer.json'],
];

async function save(url, rel) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.log(`FAIL network ${url}: ${e.message}`);
    return;
  }
  if (!res.ok) {
    console.log(`FAIL ${res.status} ${url}`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const out = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  report.push({ url, file: `raw/${rel}`, bytes: buf.length, sha256: sha(buf) });
  console.log(res.status, buf.length, rel);
}

for (const f of FILES) await save(BASE + f, f.replace(/^\//, ''));
for (const f of FONTS) await save(BASE + f, f.replace(/^\//, ''));
for (const f of BACKDROPS) await save(BASE + f, f.replace(/^\//, ''));
for (const f of MAPS) await save(BASE + f, f.replace(/^\//, ''));
for (const n of ICONS) await save(`${BASE}/icons/weapons/${n}.svg`, `icons/weapons/${n}.svg`);
for (const [url, rel] of EXTERNAL) await save(url, rel);

// maps manifest 由 maps-index.json 的 manifest 字段决定，单独抓
try {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/maps-index.json'), 'utf8'));
  const manifestUrl = idx.manifest ? new URL(idx.manifest, 'https://maps.csdemo.tv/').href : null;
  if (manifestUrl) await save(manifestUrl, 'data/maps-manifest.json');
} catch (e) {
  console.log(`WARN maps manifest skip: ${e.message}`);
}

// 当前 catalogue 的完整 events 清单
try {
  const ptr = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalogue-pointer.json'), 'utf8'));
  if (ptr.catalogueUrl) await save(ptr.catalogueUrl, 'data/catalogue.json');
} catch (e) {
  console.log(`WARN catalogue skip: ${e.message}`);
}

fs.writeFileSync(
  path.join(path.resolve(import.meta.dirname, '..'), 'docs', 'raw-manifest.json'),
  JSON.stringify({ fetchedAt: new Date().toISOString(), files: report }, null, 2),
  'utf8',
);
console.log(`\n${report.length} files saved`);
