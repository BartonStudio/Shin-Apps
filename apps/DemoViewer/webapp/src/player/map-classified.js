// =============================================================================
// map-classified.js —— v1/classified 地图管线（逐字还原原版行为）
//
// 对照原件：decompiled/index.beautified.js L29329-29447 与
//           02-map-assets.deobf.js（fetchMapCollision / decodeCollisionGeometry）。
//
// 原版链路（v1/classified 模式，mobile 或用户选低配时）：
//   1. fetchMapCollision(mapName) —— /maphost/ index.json → release → files.collision
//      mirage 另有灯光 JSON（/maps/de_mirage_lights.json）
//   2. worker decode：fetch collision GLB（meshopt 压缩）→ positions + 顶点色
//   3. worker prepare：按分类表（roofHeight/detailSpan/六色）程序化重新着色，
//      生成法线 + 轮廓边线 → chunks[] + edges
//   4. 主线程：共享一个 MeshLambertMaterial（白 + 微自发光 + 顶点色 + 双面），
//      建 Mesh（castShadow/receiveShadow）、edges LineSegments、室内 PointLight
//
// 差异说明：原版 raycast 用 three-mesh-bvh（Ih/Bh），本模块测试阶段不接
//   raycastable 路径（传 false），M2 观战拾取需要时再引入。
// =============================================================================
import {
  Group,
  Mesh,
  BufferGeometry,
  BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  PointLight,
  Color,
  MeshLambertMaterial,
  ShaderChunk,
} from './vendor/three-bundle.js';

// ── 地图宿主清单（原版 loadMapHostIndex / fetchMapCollision） ────────────────

const MAP_HOST_URL = '/maphost/';

let mapHostPromise = null; // 清单缓存（Promise，失败时清空）
const mapManifestCache = new Map();

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw Error(`fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  return resp.json();
}

/** 拉取并缓存地图宿主 index → release manifest，返回 mapName → {collision, colored, overview, logo} */
async function loadMapHostIndex() {
  mapHostPromise ||= (async () => {
    const base = new URL(MAP_HOST_URL, location.href);
    const root = await fetchJson(new URL('index.json', base).href);
    if (root.format !== 'csdemo-map-host-v1' || typeof root.manifest !== 'string') {
      throw Error('map host returned an unsupported root manifest');
    }
    const releaseUrl = new URL(root.manifest, base).href;
    const release = await fetchJson(releaseUrl);
    // files.*.path 相对 release 所在目录（v1/）解析——与原版 downloadMapHostIndex 一致
    const releaseBase = new URL('.', releaseUrl).href;
    const mapByName = new Map();
    for (const map of release.maps) {
      mapByName.set(map.name, {
        collision: map.files.collision ? new URL(map.files.collision.path, releaseBase).href : undefined,
        colored: map.files.colored ? new URL(map.files.colored.path, releaseBase).href : undefined,
        overview: map.files.overview ? new URL(map.files.overview.path, releaseBase).href : undefined,
        logo: map.files.logo ? new URL(map.files.logo.path, releaseBase).href : undefined,
      });
    }
    return mapByName;
  })();
  return mapHostPromise;
}

/** 获取某张地图的碰撞 + 灯光数据（原版 fetchMapCollision，含 mirage 灯光特例） */
export function fetchMapCollision(mapName) {
  let cached = mapManifestCache.get(mapName);
  if (cached) return cached;
  const promise = loadMapHostIndex().then((index) => {
    const entry = index.get(mapName);
    if (!entry?.collision) throw Error(`map ${mapName} has no collision asset`);
    return {
      collision: entry.collision,
      lights: mapName === 'de_mirage' ? '/maps/de_mirage_lights.json' : undefined,
    };
  });
  mapManifestCache.set(mapName, promise);
  return promise;
}

// ── mapGeometry.worker 交互（原版 decodeCollisionGeometry / G_ / q_） ────────

function createMapGeometryWorker() {
  return new Worker(new URL('./workers/mapGeometry.worker.js', import.meta.url), { type: 'module' });
}

/** 带取消能力的 Promise 包装（原版 q_） */
function abortable(promise, signal, onAbort) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(new DOMException('Map geometry preparation was cancelled', 'AbortError'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(
      (v) => {
        signal?.removeEventListener('abort', abort);
        resolve(v);
      },
      (e) => {
        signal?.removeEventListener('abort', abort);
        reject(e);
      },
    );
  });
}

/** 调 worker 解码 collision GLB（meshopt）→ {positions, colors}（原版 decodeCollisionGeometry） */
export function decodeCollisionGeometry(url, onDecoding) {
  return new Promise((resolve, reject) => {
    const worker = createMapGeometryWorker();
    const terminate = () => worker.terminate();
    worker.onmessage = (ev) => {
      if (ev.data.type === 'decoding') {
        onDecoding?.();
        return;
      }
      terminate();
      if (ev.data.type === 'decoded') resolve({ positions: ev.data.positions, colors: ev.data.colors });
      else if (ev.data.type === 'error') reject(Error(ev.data.message));
      else reject(Error('Map geometry worker returned an unexpected response'));
    };
    worker.onerror = (ev) => {
      terminate();
      reject(Error(ev.message || 'Map geometry worker failed'));
    };
    worker.onmessageerror = () => {
      terminate();
      reject(Error('Map geometry worker returned unreadable data'));
    };
    worker.postMessage({ type: 'decode', url });
  });
}

/** 拉取灯光 JSON 并校验（原版 fetchMapLights） */
async function fetchMapLights(url) {
  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.lights)) return [];
  return data.lights.flatMap((light) => {
    const { position, color, range, lumens, kind, direction, size } = light ?? {};
    const valid =
      Array.isArray(position) && Array.isArray(color) && Array.isArray(direction) &&
      position.length === 3 && color.length === 3 && direction.length === 3 &&
      typeof range === 'number' && typeof lumens === 'number' && typeof size === 'number' &&
      (kind === 'omni' || kind === 'spot') &&
      [...position, ...color, ...direction, range, lumens, size].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
      range > 0 && lumens > 0;
    return valid ? [{ position, color, range, lumens, kind, direction, size }] : [];
  });
}

/** 下载 + 解码（原版 downloadAndDecodeGeometry） */
async function downloadAndDecodeGeometry(mapName, onPhase) {
  const collision = await fetchMapCollision(mapName);
  const [geometry, lights] = await Promise.all([
    decodeCollisionGeometry(collision.collision, () => onPhase?.(`Decoding ${mapName} geometry…`)),
    collision.lights ? fetchMapLights(collision.lights) : Promise.resolve([]),
  ]);
  onPhase?.(`Preparing ${mapName} geometry…`);
  return { positions: geometry.positions, colors: geometry.colors, lights };
}

/** worker 第二阶段：分类着色 + 法线 + 边线 → {chunks, edges}（原版 G_） */
function prepareClassifiedGeometry(positions, colors, config, signal, collisionOnly) {
  const worker = createMapGeometryWorker();
  return abortable(
    new Promise((resolve, reject) => {
      const terminate = () => worker.terminate();
      worker.onmessage = (ev) => {
        terminate();
        if (ev.data.type === 'prepared') resolve(ev.data.result);
        else if (ev.data.type === 'error') reject(Error(ev.data.message));
        else reject(Error('Map geometry worker returned an unexpected response'));
      };
      worker.onerror = (ev) => {
        terminate();
        reject(Error(ev.message || 'Map geometry worker failed'));
      };
      worker.onmessageerror = () => {
        terminate();
        reject(Error('Map geometry worker returned unreadable data'));
      };
      worker.postMessage({ type: 'prepare', positions, colors: collisionOnly ? undefined : colors, config, collisionOnly });
    }),
    signal,
    () => worker.terminate(),
  );
}

// ── 材质 / 边线 / 灯光（原版 J_ / Y_ / X_ / Z_） ─────────────────────────────

/** 展开 #include <xxx> 并给 varying 加 centroid（原版 Y_，防线条抖动） */
function injectShaderChunk(source) {
  return source
    .replace(/^[ \t]*#include <(\w+)>/gm, (m, name) => {
      const chunk = ShaderChunk[name];
      return chunk === undefined ? m : injectShaderChunk(chunk);
    })
    .replace(/^([ \t]*)varying\b/gm, '$1centroid varying');
}

/**
 * 分类地图共享材质（原版 J_）。
 * MeshLambertMaterial（beautified L29408 用 ko，已核实 isMeshLambertMaterial）：
 * 受半球光/太阳光照射，顶点色提供分类调色，微自发光避免全黑死角，双面（薄壳）。
 */
function createClassifiedMaterial() {
  const material = new MeshLambertMaterial({ color: 16777215, emissive: 1581078, emissiveIntensity: 0.08, vertexColors: true, side: 2 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = injectShaderChunk(shader.vertexShader);
    shader.fragmentShader = injectShaderChunk(shader.fragmentShader);
  };
  return material;
}

/** 资源释放（原版 Z_） */
export function disposeObject(root) {
  const materials = new Set();
  root.traverse((node) => {
    node.geometry?.dispose?.();
    const material = node.material;
    if (Array.isArray(material)) material.forEach((m) => materials.add(m));
    else if (material) materials.add(material);
  });
  for (const m of materials) m.dispose();
}

/** 室内灯（原版 X_）：一灯一 PointLight，默认不可见，由 updateInteriorLights 点亮最近 20 盏 */
const INTERIOR_LIGHT_LUMENS_SCALE = 24; // 原件常量

export function createInteriorLights(group, lights, fillAmount) {
  const created = [];
  for (const light of lights) {
    const point = new PointLight(new Color(...light.color), 0, light.range, 2);
    point.position.set(...light.position);
    point.visible = false;
    point.userData.fillAmount = fillAmount;
    point.userData.sourceLumens = light.lumens;
    group.add(point);
    created.push(point);
  }
  return created;
}

/** 根据相机位置，只点亮最近的 20 盏室内灯（原版 MapLoader.updateInteriorLights） */
export function updateInteriorLights(cameraPosition, interiorLights) {
  const nearest = new Set(
    [...interiorLights]
      .sort((a, b) => a.position.distanceToSquared(cameraPosition) - b.position.distanceToSquared(cameraPosition))
      .slice(0, 20),
  );
  for (const light of interiorLights) {
    light.visible = nearest.has(light);
    light.power = light.visible ? light.userData.fillAmount * light.userData.sourceLumens * INTERIOR_LIGHT_LUMENS_SCALE : 0;
  }
}

// ── 组装（原版 W_ buildClassifiedMap） ───────────────────────────────────────

/**
 * 分类地图组装。签名对齐原版 W_：
 * @param {Float32Array} positions worker 解出的顶点
 * @param {Float32Array|undefined} colors 顶点色（collisionOnly 时不传）
 * @param {object} classification 分类表（scene-environment.js getMapLighting）
 * @param {AbortSignal} signal
 * @param {boolean} raycastable 本实现暂不支持 bvh，恒走 false 路径
 * @param {boolean} collisionOnly 只做碰撞（不投影/不接收阴影）
 * @returns {Promise<{group: Group, box: Box3}>}
 */
export async function buildClassifiedMap(positions, colors, classification, signal, raycastable = false, collisionOnly = false) {
  const built = await prepareClassifiedGeometry(positions, colors, classification, signal, collisionOnly);
  const group = new Group();
  group.name = 'CSPlayer_ClassifiedMap';

  const material = createClassifiedMaterial();
  try {
    for (let i = 0; i < built.chunks.length; i++) {
      const chunk = built.chunks[i];
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3));
      if (chunk.normals) geometry.setAttribute('normal', new BufferAttribute(chunk.normals, 3, true));
      if (chunk.colors) geometry.setAttribute('color', new BufferAttribute(chunk.colors, 3, true));
      const mesh = new Mesh(geometry, material);
      mesh.name = `CSPlayer_Map_${i}`;
      group.add(mesh);
      // 原版此处建 three-mesh-bvh boundsTree（raycastable=true 时），暂不引入
      mesh.castShadow = !collisionOnly;
      mesh.receiveShadow = !collisionOnly;
    }
  } catch (err) {
    disposeObject(group);
    throw err;
  }

  // 轮廓边线（原版 W_ 尾部：opacity 0.2 的分类表 edgeColor）
  if (built.edges.length > 0) {
    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute('position', new BufferAttribute(built.edges, 3));
    group.add(new LineSegments(edgeGeometry, new LineBasicMaterial({ color: classification.edgeColor, transparent: true, opacity: 0.2 })));
  }
  return { group, geometryData: built };
}

/** 一步到位：加载某图的 classified 组（downloadAndDecode + buildClassifiedMap + 室内灯） */
export async function loadClassifiedMap(mapName, classification, { onPhase, interiorFillAmount = 2, collisionOnly = false } = {}) {
  const { positions, colors, lights } = await downloadAndDecodeGeometry(mapName, onPhase);
  const { group } = await buildClassifiedMap(positions, colors, classification, undefined, false, collisionOnly);
  const interiorLights = createInteriorLights(group, lights, interiorFillAmount);
  return { group, interiorLights };
}
