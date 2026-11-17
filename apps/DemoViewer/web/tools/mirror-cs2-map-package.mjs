// ============================================================================
// mirror-cs2-map-package.mjs —— 把 CS2 地图渲染包镜像到本地（csdemo-cs2-assets-v1）
//
// 用法：node tools/mirror-cs2-map-package.mjs [de_mirage,de_nuke,...|all]
//
// 包结构：/cs2/maps/<name>/<hash>/ 下的 cs2render 素材，文件清单由包内
// `map.json` 驱动（materials/probes/post.lut/visibility/sky/lightGrid/geometry/
// textures 各条目的 `file` 字段，geometry.chunks[].file 相对 geometry.dir）。
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const CDN = 'https://maps.csdemo.tv';
const MIRROR = path.join(import.meta.dirname, '..', 'cdn', 'mirror', 'maps.csdemo.tv');

let totalBytes = 0, totalFiles = 0, failed = [];

async function fetchBuf(url, tries = 3) {
  for (let i = 0; i < tries; ++i) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

async function mirror(url, rel) {
  const dest = path.join(MIRROR, rel);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = await fetchBuf(url);
  if (!buf) {
    failed.push(`${rel} (HTTP 失败)`);
    return;
  }
  fs.writeFileSync(dest, buf);
  totalFiles++;
  totalBytes += buf.length;
  process.stdout.write(`  ✓ ${rel} (${(buf.length / 1024).toFixed(0)}KB)\n`);
}

/** 递归收集 map.json 里所有数据文件引用（file/color/normal/mask 等字符串值，按扩展名过滤） */
const DATA_EXT = /\.(ctex|bin|glb|json|lut)$/i;
function collectFiles(node, dirPrefix = '', out = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectFiles(item, dirPrefix, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const dir = typeof node.dir === 'string' ? node.dir : dirPrefix;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'dir') continue;
    if (typeof value === 'string' && DATA_EXT.test(value)) {
      // file 字段相对所属对象的 dir；其它字段相对包根
      const rel = key === 'file' && dir ? `${dir}/${value}` : value;
      out.add(rel);
    } else if (typeof value === 'object') {
      collectFiles(value, dir, out);
    }
  }
  return out;
}

const wanted = process.argv[2] ?? 'de_mirage';
const pkg = JSON.parse(fs.readFileSync(path.join(MIRROR, 'cs2', 'index.json'), 'utf8'));
const names = wanted === 'all' ? Object.keys(pkg.maps) : wanted.split(',');

for (const name of names) {
  const entry = pkg.maps[name];
  if (!entry?.path) {
    console.error(`cs2/index.json 里没有 ${name}`);
    continue;
  }
  const base = `${CDN}/cs2/${entry.path.endsWith('/') ? entry.path : entry.path + '/'}`;
  const relBase = `cs2/${entry.path.endsWith('/') ? entry.path : entry.path + '/'}`;
  console.log(`[cs2map] ${name} → ${relBase}`);
  await mirror(`${base}map.json`, `${relBase}map.json`);
  const manifest = JSON.parse(fs.readFileSync(path.join(MIRROR, relBase, 'map.json'), 'utf8'));
  if (manifest.format !== 'cs2render') throw Error(`非 cs2render 包: ${manifest.format}`);
  const files = collectFiles(manifest);
  console.log(`  共 ${files.size} 个数据文件`);
  for (const f of files) await mirror(base + f, relBase + f);
}

console.log(`\n完成：${totalFiles} 个文件，${(totalBytes / 1048576).toFixed(1)} MB`);
if (failed.length) {
  console.log(`失败 ${failed.length} 个：\n  ` + failed.join('\n  '));
  process.exitCode = 1;
}
