// =============================================================================
// map-loader.js —— 地图几何加载（离线版，v1/classified 管线）
//
// 数据来源：本地镜像（web/cdn/mirror/maps.csdemo.tv，tools/mirror-csdemo-assets.mjs 下载）
//   /maphost/index.json            → { manifest: 'v1/release-xxx.json' }
//   /maphost/v1/release-xxx.json   → { maps: [{ name, files: { collision, colored, overview, logo } }] }
//   /maphost/v1/objects/<sha>.glb  → 几何本体（EXT_meshopt_compression 压缩）
//
// 还原原版 csdemo.tv 行为：加载 **collision** GLB（自带顶点色），交给
// mapGeometry.worker 分类着色（roofHeight/detailSpan/六色分类 + 法线 + 轮廓边），
// 组装成 Lambert 材质网格 —— 即原版 buildClassifiedMap 管线（见 map-classified.js）。
// colored GLB 原版 v1 主链路不用，保留 variant 参数仅为调试对比。
//
// 坐标约定：glTF 本身 Z 轴向上（与 CS2 世界坐标一致），相机 up=(0,0,1)。
// =============================================================================
import { Box3 } from './vendor/three-bundle.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt-decoder.js';
import { fetchMapCollision, loadClassifiedMap } from './map-classified.js';
import { getMapLighting } from './scene-environment.js';

/**
 * 地图宿主基址（离线镜像；线上是 https://maps.csdemo.tv/）。
 * 生产运行时走同源相对路径；dev 期 webapp(:5173) 与镜像服务(:8123) 不同源，直连。
 * 可用 VITE_MAP_HOST_URL 覆盖。
 */
const MAP_HOST_URL =
  import.meta.env.VITE_MAP_HOST_URL ??
  (import.meta.env.DEV ? 'http://127.0.0.1:8123/maphost/' : '/maphost/');

/** 归一成绝对基址（相对路径按当前页面解析），供 new URL(x, base) 使用 */
const MAP_HOST_BASE = new URL(MAP_HOST_URL, location.origin).href;

const loader = new GLTFLoader();
let decoderReady = null;

/** meshopt 解码器只需初始化一次 */
function ensureDecoder() {
  decoderReady ??= MeshoptDecoder.ready.then(() => loader.setMeshoptDecoder(MeshoptDecoder));
  return decoderReady;
}

/** 拉地图宿主 → release 清单，找到指定地图条目 */
export async function fetchMapEntry(mapName) {
  const host = await (await fetch(new URL('index.json', MAP_HOST_BASE))).json();
  const releaseUrl = new URL(host.manifest, MAP_HOST_BASE).href;
  const release = await (await fetch(releaseUrl)).json();
  const entry = release.maps.find((m) => m.name === mapName);
  if (!entry) throw Error(`release 清单里没有地图 ${mapName}`);
  return { entry, releaseUrl };
}

/**
 * 加载地图几何（默认走原版 classified 管线）。
 * @param {string} mapName 如 'de_mirage'
 * @param {{variant?: 'classified'|'colored'|'collision'}} [opts]
 * @returns {Promise<{object: import('./vendor/three-bundle.js').Object3D, box: Box3, url: string, interiorLights: []}>}
 */
export async function loadMapGeometry(mapName, opts = {}) {
  // 调试旁路：直载 colored GLB（原版 v1 主链路不走这里）
  if (opts.variant === 'colored' || opts.variant === 'collision') {
    const { entry, releaseUrl } = await fetchMapEntry(mapName);
    const file = entry.files[opts.variant] ?? entry.files.collision;
    const url = new URL(file.path, releaseUrl).href;
    await ensureDecoder();
    const gltf = await loader.loadAsync(url);
    const coloredBox = new Box3().setFromObject(gltf.scene);
    return { object: gltf.scene, box: coloredBox, url, interiorLights: [] };
  }

  // 原版 v1/classified：collision GLB → worker 分类着色 + 室内灯
  const collision = await fetchMapCollision(mapName);
  const classification = getMapLighting(mapName);
  const { group, interiorLights } = await loadClassifiedMap(mapName, classification, {
    interiorFillAmount: 2, // 原版 MapLoader.interiorFillAmount 默认 2
  });

  const box = new Box3().setFromObject(group);
  return { object: group, box, url: collision.collision, interiorLights };
}
