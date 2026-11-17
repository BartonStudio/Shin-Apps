// ============================================================================
// mirror-csdemo-assets.mjs —— 把 csdemo.tv 的素材 CDN 完整镜像到本地
//
// 用法：
//   node tools/mirror-csdemo-assets.mjs                 # 镜像 de_dust2 + 全部武器/角色
//   node tools/mirror-csdemo-assets.mjs --maps all      # 全部 8 张地图
//   node tools/mirror-csdemo-assets.mjs --maps de_mirage,de_dust2
//   node tools/mirror-csdemo-assets.mjs --no-sounds     # 跳过声音（默认拉）
//
// 目标布局（保持 URL 结构原样，静态服务器从根目录直接映射）：
//   cdn/mirror/maps.csdemo.tv/
//     index.json                         ← 地图宿主清单（csdemo-map-host-v1）
//     v1/release-*.json                  ← 地图 release 清单
//     objects/*.glb|txt|svg|png          ← 地图几何/雷达/校准
//     cs2/index.json                     ← 素材包清单（csdemo-cs2-assets-v1）
//     cs2/weapons/<hash>/characters/…    ← t/ct 模型 + anims.bin
//     cs2/weapons/<hash>/world/*.glb     ← 第三人称武器模型
//     cs2/weapons/<hash>/fp/*.glb        ← 第一人称视图模型
//     cs2/sounds/<hash>/…                ← 声音（sounds.json 驱动）
//     cs2/maps/de_*/<hash>/…             ← 地图环境音等
//
// 离线配置（两处，均已接线）：
//   1. serve.mjs：/cs2/*、/maphost/* 直接映射到本目录（无网络请求）；
//      /__maps/* 代理前先查本地镜像。
//   2. 可读代码组装（B 方案）：cs2AssetsBaseUrl() 支持 VITE_CS2_ASSETS_URL 环境变量，
//      设为 `/cs2/` 即走本地；02-map-assets 的 MAP_HOST_URL 改 `/maphost/` 即可。
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const CDN = 'https://maps.csdemo.tv';
const MIRROR = path.join(import.meta.dirname, '..', 'cdn', 'mirror', 'maps.csdemo.tv');

const args = process.argv.slice(2);
const withSounds = !args.includes('--no-sounds');
const mapsIdx = args.indexOf('--maps');
const mapsArg = mapsIdx >= 0 && args[mapsIdx + 1] ? args[mapsIdx + 1] : 'de_dust2';

// ── 武器模型名表（与 bundle 内 qy/Jy/Zy 一致；缺一个文件 → 对应武器兜底为胶囊体）──
const WEAPON_MODELS = [
  // 主战/手枪/投掷物（qy 值）
  'ak47', 'm4a4', 'm4a1_silencer', 'awp', 'ssg08', 'famas', 'galilar', 'aug', 'sg556', 'scar20',
  'g3sg1', 'mac10', 'mp9', 'mp7', 'mp5sd', 'bizon', 'p90', 'ump45', 'm249', 'negev',
  'nova', 'xm1014', 'mag7', 'sawedoff', 'deagle', 'glock', 'usp_silencer', 'hkp2000', 'p250',
  'fiveseven', 'tec9', 'cz75a', 'elite', 'revolver', 'taser', 'c4',
  'hegrenade', 'flashbang', 'smokegrenade', 'molotov', 'incgrenade', 'decoy',
  // 刀（Jy 值 + qy 兜底）
  'knife_bayonet', 'knife_bowie', 'knife_butterfly', 'knife_canis', 'knife_cord', 'knife_css',
  'knife_falchion', 'knife_flip', 'knife_gut', 'knife_karambit', 'knife_kukri', 'knife_m9',
  'knife_navaja', 'knife_outdoor', 'knife_push', 'knife_skeleton', 'knife_stiletto',
  'knife_tactical', 'knife_talon', 'knife_ursus', 'knife_t', 'knife_ct',
];

let totalBytes = 0, totalFiles = 0, failed = [];

async function fetchBuf(url, tries = 3) {
  for (let i = 0; i < tries; ++i) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;                       // 404 等直接返回 null（探测路径）
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}

/** 下载一个文件到镜像目录；sha256 可选校验（地图清单提供）。 */
async function mirror(url, relPath, sha256 = null) {
  const out = path.join(MIRROR, relPath);
  if (fs.existsSync(out) && (!sha256 || await shaMatches(out, sha256))) {
    totalBytes += fs.statSync(out).size; totalFiles++;
    return true;
  }
  const buf = await fetchBuf(url);
  if (!buf) return false;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  totalBytes += buf.length; totalFiles++;
  process.stdout.write(`  ${relPath} (${(buf.length / 1048576).toFixed(1)} MB)\n`);
  return true;
}

async function shaMatches(file, expect) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex') === expect;
}

async function mirrorJsonFile(url, relPath) {
  const ok = await mirror(url, relPath);
  if (!ok) return null;
  return JSON.parse(fs.readFileSync(path.join(MIRROR, relPath), 'utf8'));
}

// ── 1. 地图宿主：index.json → release 清单 → 每图全部文件 ──
// 注意：release 里的文件路径是相对 release 清单 URL 的（v1/objects/…），
// 与前端 new URL(path, releaseUrl) 的解析方式一致——不能直接拼根路径。
async function mirrorMaps(which) {
  const host = await mirrorJsonFile(`${CDN}/index.json`, 'index.json');
  if (!host) throw Error('地图宿主 index.json 拉取失败');
  const releaseUrl = `${CDN}/${host.manifest}`;
  const release = await mirrorJsonFile(releaseUrl, host.manifest);
  if (!release) throw Error('release 清单拉取失败');
  const rel = (p) => new URL(p, releaseUrl).pathname.slice(1); // 相对路径 → 站点绝对路径

  const pkg = await mirrorJsonFile(`${CDN}/cs2/index.json`, 'cs2/index.json');
  const wanted = which === 'all' ? release.maps.map((m) => m.name) : which.split(',');
  for (const map of release.maps) {
    if (!wanted.includes(map.name)) continue;
    process.stdout.write(`[map] ${map.name}\n`);
    for (const f of Object.values(map.files ?? {})) {
      if (f?.path) await mirror(new URL(f.path, releaseUrl).href, rel(f.path), f.sha256);
    }
    for (const radar of map.radars ?? []) {
      if (radar?.path) await mirror(new URL(radar.path, releaseUrl).href, rel(radar.path), radar.sha256);
    }
    // 地图素材包（环境音）：sounds.json 的 banks 字段驱动
    const mp = pkg?.maps?.[map.name]?.path;
    if (mp && withSounds) {
      const sj = await mirrorJsonFile(`${CDN}/cs2/${mp}sounds.json`, `cs2/${mp}sounds.json`);
      for (const bank of Object.values(sj?.banks ?? {})) {
        await mirror(`${CDN}/cs2/${mp}${bank}`, `cs2/${mp}${bank}`);
      }
    }
  }
}

// ── 2. CS2 素材包：weapons（角色+世界+第一人称）+ sounds ──
async function mirrorCs2Packages() {
  const pkg = await mirrorJsonFile(`${CDN}/cs2/index.json`, 'cs2/index.json');
  if (!pkg) throw Error('cs2/index.json 拉取失败');
  const wp = pkg.weapons?.path;
  if (!wp) throw Error('weapons 包缺失');

  process.stdout.write(`[weapons] 角色 + 动画\n`);
  for (const f of ['characters/t.glb', 'characters/ct.glb', 'characters/anims.bin']) {
    await mirror(`${CDN}/cs2/${wp}${f}`, `cs2/${wp}${f}`);
  }

  process.stdout.write(`[weapons] 世界模型 world/*.glb\n`);
  for (const name of WEAPON_MODELS) {
    await mirror(`${CDN}/cs2/${wp}world/${name}.glb`, `cs2/${wp}world/${name}.glb`);
  }

  process.stdout.write(`[weapons] 第一人称 fp/*.glb（含 arms）\n`);
  for (const name of [...WEAPON_MODELS, 'arms']) {
    await mirror(`${CDN}/cs2/${wp}fp/${name}.glb`, `cs2/${wp}fp/${name}.glb`);
  }

  if (withSounds) {
    const sp = pkg.sounds?.path;
    if (sp) {
      process.stdout.write(`[sounds] sounds.json 的 banks 驱动\n`);
      const sj = await mirrorJsonFile(`${CDN}/cs2/${sp}sounds.json`, `cs2/${sp}sounds.json`);
      for (const bank of Object.values(sj?.banks ?? {})) {
        await mirror(`${CDN}/cs2/${sp}${bank}`, `cs2/${sp}${bank}`);
      }
    }
  }
}

// ── 主流程 ──
const t0 = Date.now();
try {
  await mirrorMaps(mapsArg);
  await mirrorCs2Packages();
} catch (e) {
  console.error('镜像失败：', e.message);
  process.exit(1);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n完成：${totalFiles} 个文件，${(totalBytes / 1048576).toFixed(1)} MB，${secs}s，目录 ${MIRROR}`);
if (failed.length) console.log(`失败 ${failed.length} 个：\n  ` + failed.join('\n  '));
