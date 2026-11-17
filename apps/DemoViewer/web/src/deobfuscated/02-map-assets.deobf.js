// ============================================================================
// 反混淆版本：地图资源加载（maps.csdemo.tv 客户端 + 地图几何解码）
// 原始压缩文件：src/app/02-map-assets.js（decompiled/index.beautified.js 29163–29746 行）
// 原文范围：decompiled/index.beautified.js L29163–29746（切片 02-map-assets）
// 说明：
//   - 地图清单从 https://maps.csdemo.tv 拉取（index.json → release manifest）
//   - 地图几何（positions/colors）交给 mapGeometry.worker 解码成 three.js 几何
//   - overview.txt 解析成雷达坐标映射（pos_x/pos_y/scale/inset）
//   - 底部内联的 meshopt_decoder（$）与 CTEX 纹理解码（gv/yv/xv）是第三方/通用代码，仅标注不展开
// ============================================================================

// ── 地图清单客户端 ──────────────────────────────────────────────────────────

// 离线应用：素材已镜像到本地（tools/mirror-csdemo-assets.mjs），serve.mjs 把 /maphost/
// 映射到 cdn/mirror/maps.csdemo.tv/。要切回线上 CDN，改回 `https://maps.csdemo.tv/` 即可。
const MAP_HOST_URL = `/maphost/`;

let mapHostPromise = null; // 清单缓存（Promise，失败时清空）
const mapManifestCache = new Map(); // 每张地图的清单缓存
const mapRadarCache = new Map(); // 每张地图的雷达映射缓存

/** 获取某张地图的碰撞 + 灯光数据（供 MapLoader 使用） */
function fetchMapCollision(mapName) {
  let cached = mapManifestCache.get(mapName);
  if (cached) return cached;
  const promise = loadMapCollision(mapName).catch((err) => {
    mapManifestCache.delete(mapName);
    throw err;
  });
  mapManifestCache.set(mapName, promise);
  return promise;
}

/** 获取某张地图的雷达映射（overview.txt 解析结果） */
function fetchMapRadar(mapName) {
  let cached = mapRadarCache.get(mapName);
  if (cached) return cached;
  const promise = loadMapRadar(mapName).catch((err) => {
    mapRadarCache.delete(mapName);
    throw err;
  });
  mapRadarCache.set(mapName, promise);
  return promise;
}

/** 获取某张地图的队伍 logo 地址 */
async function fetchMapLogo(mapName) {
  return (await loadMapHostIndex()).get(mapName)?.logo;
}

async function loadMapCollision(mapName) {
  const entry = (await loadMapHostIndex()).get(mapName);
  if (entry) {
    return {
      collision: entry.collision,
      lights: mapName === `de_mirage` ? `/maps/de_mirage_lights.json` : undefined,
    };
  }
}

async function loadMapRadar(mapName) {
  const entry = (await loadMapHostIndex()).get(mapName);
  const defaultRadar = entry?.radars.get(`default`);
  if (!entry || !defaultRadar || !entry.overview) return;

  const resp = await fetch(entry.overview);
  if (!resp.ok) throw Error(`map overview fetch failed: ${resp.status} ${resp.statusText} (${entry.overview})`);

  const overview = parseMapOverview(await resp.text(), entry.overview);
  const sections = [];
  for (const [sectionName, radarFile] of entry.radars) {
    const range = overview.sectionRanges.get(sectionName);
    if (sectionName !== "default" && !range) continue;
    sections.push({
      name: sectionName,
      file: radarFile,
      altitudeMin: range?.altitudeMin ?? -Infinity,
      altitudeMax: range?.altitudeMax ?? Infinity,
    });
  }
  return { file: defaultRadar, ...overview.mapping, sections };
}

/** 拉取并缓存地图宿主 index（含 manifest 指针） */
async function loadMapHostIndex() {
  mapHostPromise ||= downloadMapHostIndex().catch((err) => {
    mapHostPromise = undefined;
    throw err;
  });
  return mapHostPromise;
}

async function downloadMapHostIndex() {
  const base = new URL(MAP_HOST_URL, window.location.href);
  const rootManifest = await fetchJson(new URL(`index.json`, base).href);
  if (rootManifest.format !== `csdemo-map-host-v1` || typeof rootManifest.manifest != `string`) {
    throw Error(`map host returned an unsupported root manifest`);
  }

  const releaseUrl = new URL(rootManifest.manifest, base).href;
  const release = await fetchJson(releaseUrl);
  if (
    release.format !== `csdemo-map-release-v1` ||
    release.compression !== `EXT_meshopt_compression` ||
    release.coordinate_system !== `source2-hammer-z-up` ||
    !Array.isArray(release.maps)
  ) {
    throw Error(`map host returned an unsupported map release`);
  }

  const maps = new Map();
  for (const map of release.maps) {
    if (!isObject(map) || typeof map.name != `string` || !isObject(map.files)) continue;
    const collisionPath = filePathOf(map.files.colored) ?? filePathOf(map.files.collision);
    if (!collisionPath) continue;

    const overviewPath = filePathOf(map.files.overview);
    const logoPath = filePathOf(map.files.logo);
    const radars = new Map();
    if (Array.isArray(map.radars)) {
      for (const radar of map.radars) {
        if (!isObject(radar) || typeof radar.section != `string`) continue;
        const file = filePathOf(radar);
        if (file) radars.set(radar.section, new URL(file, releaseUrl).href);
      }
    }

    maps.set(map.name, {
      name: map.name,
      collision: new URL(collisionPath, releaseUrl).href,
      overview: overviewPath ? new URL(overviewPath, releaseUrl).href : undefined,
      logo: logoPath ? new URL(logoPath, releaseUrl).href : undefined,
      radars,
    });
  }
  return maps;
}

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw Error(`map manifest fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  const data = await resp.json();
  if (!isObject(data)) throw Error(`map manifest is not an object (${url})`);
  return data;
}

/** 解析 CS2 地图的 overview.txt（雷达校准文件） */
function parseMapOverview(text, sourceUrl) {
  const kv = new Map();
  for (const m of text.matchAll(/"([^"]+)"\s*"([^"]*)"/g)) kv.set(m[1], m[2]);

  // 读取单个数值字段
  const readNumber = (key, required = false) => {
    const raw = kv.get(key);
    if (raw === undefined) {
      if (required) throw Error(`map overview is missing ${key} (${sourceUrl})`);
      return undefined;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) throw Error(`map overview has invalid ${key} (${sourceUrl})`);
    return value;
  };

  const posX = readNumber(`pos_x`, true);
  const posY = readNumber(`pos_y`, true);
  const scale = readNumber(`scale`, true);
  if (scale <= 0) throw Error(`map overview has invalid scale (${sourceUrl})`);

  const zoom = readNumber(`zoom`) ?? 0;
  if (zoom < 0) throw Error(`map overview has invalid zoom (${sourceUrl})`);

  const insetLeft = readNumber(`inset_left`) ?? 0;
  const insetTop = readNumber(`inset_top`) ?? 0;
  const insetRight = readNumber(`inset_right`) ?? 0;
  const insetBottom = readNumber(`inset_bottom`) ?? 0;

  if ([insetLeft, insetTop, insetRight, insetBottom].some((v) => v < 0 || v >= 1) || insetLeft + insetRight >= 1 || insetTop + insetBottom >= 1) {
    throw Error(`map overview has invalid radar insets (${sourceUrl})`);
  }

  return {
    mapping: {
      posX,
      posY,
      scale,
      zoom: zoom > 0 ? zoom : 1,
      insetLeft,
      insetTop,
      insetRight,
      insetBottom,
    },
    sectionRanges: parseVerticalSections(text, sourceUrl),
  };
}

/** 解析 overview.txt 里的垂直分段（多层地图的雷达分层） */
function parseVerticalSections(text, sourceUrl) {
  const result = new Map();
  const start = text.search(/"verticalsections"\s*\{/);
  if (start < 0) return result;

  const body = text.slice(text.indexOf(`{`, start) + 1);
  for (const section of body.matchAll(/"([^"]+)"[^{]*\{([^}]*)\}/g)) {
    const kv = new Map();
    for (const m of section[2].matchAll(/"([^"]+)"\s*"([^"]*)"/g)) kv.set(m[1], m[2]);

    const altitudeMin = Number(kv.get(`AltitudeMin`));
    const altitudeMax = Number(kv.get(`AltitudeMax`));
    if (!Number.isFinite(altitudeMin) || !Number.isFinite(altitudeMax) || altitudeMin >= altitudeMax) {
      throw Error(`map overview has invalid vertical section ${section[1]} (${sourceUrl})`);
    }
    result.set(section[1], { altitudeMin, altitudeMax });
  }
  return result;
}

function filePathOf(obj) {
  return isObject(obj) && typeof obj.path == `string` ? obj.path : undefined;
}
function isObject(v) {
  return typeof v == `object` && !!v;
}

// ── 地图默认光照分类 ─────────────────────────────────────────────────────────

const DEFAULT_MAP_LIGHTING = {
  roofHeight: 0.34,
  detailSpan: 110,
  floorColor: 0xa39a84, // 10721924
  wallColor: 0xb0a187, // 11575687
  roofColor: 0x756b5d, // 7695197
  detailColor: 0x5d6254, // 6120020
  slopeColor: 0x908570, // 9471344
  edgeColor: 0x493d2e, // 4799790
  hazeColor: 0xc7b99d, // 13089181
  skyHorizonColor: 0xb3c8e6, // 11782374
  skyZenithColor: 0x2366d2, // 2320082
  sunAzimuth: 141,
  sunElevation: 65,
};

const MAP_LIGHTING_OVERRIDES = {
  de_anubis: { floorColor: 0xbda783 /* 12429187 */, wallColor: 0xc9b393 /* 13218707 */, roofColor: 0xd4c2a5 /* 13943461 */, detailColor: 0x6f8f98 /* 7311256 */, slopeColor: 0xb49a77 /* 11836023 */, edgeColor: 0x6d5b47 /* 7166791 */, hazeColor: 0xe7d9bf /* 15194559 */, skyHorizonColor: 0xdce7eb /* 14477291 */, skyZenithColor: 0x83bddb /* 8633819 */, sunAzimuth: 257, sunElevation: 60 },
  de_ancient: { roofHeight: 0.24, floorColor: 0x566252 /* 5661266 */, wallColor: 0x899087 /* 9015431 */, roofColor: 0x69746c /* 6911084 */, detailColor: 0x304233 /* 3162675 */, slopeColor: 0x4f5d50 /* 5201232 */, edgeColor: 0x27332b /* 2569003 */, hazeColor: 0xcbd6d3 /* 13358803 */, skyHorizonColor: 0xd5dfde /* 14016478 */, skyZenithColor: 0x91a6aa /* 9545386 */, sunAzimuth: 224, sunElevation: 42 },
  de_cache: { roofHeight: 0.21, detailSpan: 220, floorColor: 0x747474 /* 7631988 */, wallColor: 0xa4a69f /* 10790559 */, roofColor: 0x505050 /* 5263440 */, detailColor: 0x746961 /* 7629153 */, slopeColor: 0x7d817a /* 8225146 */, edgeColor: 0x3e433f /* 4080447 */, hazeColor: 0xc5ccca /* 12963018 */, sunAzimuth: 297, sunElevation: 41 },
  de_dust2: { roofHeight: 0.42 },
  de_inferno: { roofHeight: 0.3, detailSpan: 110, floorColor: 0x9b9990 /* 10197392 */, wallColor: 0xc9b99f /* 13220255 */, roofColor: 0xc9976f /* 13211503 */, detailColor: 0x78836b /* 7897963 */, slopeColor: 0xb8a181 /* 12099969 */, edgeColor: 0x665749 /* 6707017 */, hazeColor: 0xd9dfe2 /* 14278626 */, skyHorizonColor: 0xe7ebed /* 15199213 */, skyZenithColor: 0x9db8d8 /* 10336472 */, sunAzimuth: 38, sunElevation: 63 },
  de_mirage: { roofHeight: 0.34 },
  de_nuke: { roofHeight: 0.44, detailSpan: 100, floorColor: 0x626c70 /* 6450288 */, wallColor: 0xaebbc0 /* 11451328 */, roofColor: 0x8e9ba0 /* 9345952 */, detailColor: 0x537487 /* 5469319 */, slopeColor: 0x9eaaad /* 10398381 */, edgeColor: 0x3e4d54 /* 4083028 */, hazeColor: 0xc4d3d3 /* 12899283 */, skyHorizonColor: 0xd2dddd /* 13819357 */, skyZenithColor: 0x86a9bd /* 8825277 */, sunAzimuth: 210, sunElevation: 58 },
};

/** 取某张地图的光照分类（默认 + 覆盖） */
function getMapLighting(mapName) {
  return { ...DEFAULT_MAP_LIGHTING, ...MAP_LIGHTING_OVERRIDES[mapName] };
}

// ── MapLoader：把解码后的地图数据组装成 three.js 场景 ─────────────────────────

const INTERIOR_LIGHT_LUMENS_SCALE = 24;

class MapLoader {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.group = null;
    this.disposed = false;
    this.loadGeneration = 0;
    this.geometryAbortController = null;
    this.interiorFillAmount = 2;
    this.interiorLights = [];
    this.raycastable = options.raycastable ?? true;
    this.classification = { ...DEFAULT_MAP_LIGHTING };
  }

  get object() {
    return this.group;
  }

  setClassification(classification) {
    this.classification = { ...classification };
  }

  /** 根据相机位置，只点亮最近的 20 盏室内灯（性能优化） */
  updateInteriorLights(cameraPosition) {
    const nearest = new Set(
      [...this.interiorLights]
        .sort((a, b) => a.position.distanceToSquared(cameraPosition) - b.position.distanceToSquared(cameraPosition))
        .slice(0, 20),
    );
    for (const light of this.interiorLights) {
      light.visible = nearest.has(light);
      light.power = light.visible ? light.userData.fillAmount * light.userData.sourceLumens * INTERIOR_LIGHT_LUMENS_SCALE : 0;
    }
  }

  /** 加载地图：下载 → 解码 → 组装几何 → 加入场景 */
  async load(mapName, onProgress, options = {}) {
    const generation = ++this.loadGeneration;
    const data = await prepareMapGeometry(mapName, onProgress);

    releaseGeometryCache(mapName);
    if (
      generation !== this.loadGeneration ||
      (this.clearLoadedMap(), !data) ||
      (onProgress?.(`Preparing ${mapName} geometry…`),
        await new Promise((resolve) => requestAnimationFrame(() => resolve())),
        this.disposed || generation !== this.loadGeneration)
    ) {
      return false;
    }

    let group;
    try {
      group = await this.buildGlbGroup(data, options.collisionOnly ?? false);
    } catch (err) {
      if (this.disposed || generation !== this.loadGeneration) return false;
      throw err;
    }

    return group
      ? this.disposed || generation !== this.loadGeneration
        ? (disposeObject(group), false)
        : (this.scene.add(group), (this.group = group), true)
      : false;
  }

  /** 把解码出的 positions/colors 构建成 three.js 网格组 */
  async buildGlbGroup(data, collisionOnly) {
    if (this.disposed) return null;
    this.cancelGeometryPreparation();
    const controller = new AbortController();
    this.geometryAbortController = controller;

    let built;
    try {
      built = await buildClassifiedMap(data.positions, data.colors, this.classification, controller.signal, this.raycastable, collisionOnly);
    } finally {
      if (this.geometryAbortController === controller) this.geometryAbortController = undefined;
    }

    return this.disposed
      ? (disposeObject(built.group), null)
      : (this.interiorLights.push(...createInteriorLights(built.group, data.lights, this.interiorFillAmount)), built.group);
  }

  clearMap() {
    this.loadGeneration++;
    this.cancelGeometryPreparation();
    this.clearLoadedMap();
  }

  clearLoadedMap() {
    if (this.group) {
      this.scene.remove(this.group);
      disposeObject(this.group);
      this.group = null;
    }
    this.interiorLights.length = 0;
  }

  dispose() {
    this.disposed = true;
    this.clearMap();
  }

  cancelGeometryPreparation() {
    this.geometryAbortController?.abort();
    this.geometryAbortController = undefined;
  }
}

// ── 地图几何准备（下载 + 解码，带进度回调与缓存） ───────────────────────────

const geometryPreparationCache = new Map(); // mapName -> { phase, listeners, promise, settled }

function releaseGeometryCache(mapName) {
  const entry = geometryPreparationCache.get(mapName);
  if (entry?.settled) geometryPreparationCache.delete(mapName);
}

function prepareMapGeometry(mapName, onProgress) {
  let entry = geometryPreparationCache.get(mapName);
  if (!entry) {
    const listeners = new Set();
    entry = { phase: `Fetching ${mapName} geometry…`, listeners, promise: Promise.resolve(undefined), settled: false };
    const updatePhase = (phase) => {
      entry.phase = phase;
      for (const listener of listeners) listener(phase);
    };
    entry.promise = downloadAndDecodeGeometry(mapName, updatePhase).then(
      (data) => ((entry.settled = true), data),
      (err) => {
        geometryPreparationCache.delete(mapName);
        throw err;
      },
    );
    geometryPreparationCache.set(mapName, entry);
  }

  if (onProgress) {
    entry.listeners.add(onProgress);
    onProgress(entry.phase);
    return entry.promise.finally(() => entry.listeners.delete(onProgress));
  }
  return entry.promise;
}

async function downloadAndDecodeGeometry(mapName, onPhase) {
  const collision = await fetchMapCollision(mapName);
  if (!collision) return;

  const [geometry, lights] = await Promise.all([
    decodeCollisionGeometry(collision.collision, () => onPhase(`Decoding ${mapName} geometry…`)),
    collision.lights ? fetchMapLights(collision.lights) : Promise.resolve([]),
  ]);

  onPhase(`Preparing ${mapName} geometry…`);
  return { positions: geometry.positions, colors: geometry.colors, lights };
}

/** 调 mapGeometry.worker 解码碰撞几何 */
function decodeCollisionGeometry(url, onDecoding) {
  return new Promise((resolve, reject) => {
    const worker = createMapGeometryWorker();
    const terminate = () => worker.terminate();

    worker.onmessage = (ev) => {
      if (ev.data.type === `decoding`) {
        onDecoding?.();
        return;
      }
      terminate();
      if (ev.data.type === `decoded`) resolve({ positions: ev.data.positions, colors: ev.data.colors });
      else if (ev.data.type === `error`) reject(Error(ev.data.message));
      else reject(Error(`Map geometry worker returned an unexpected response`));
    };
    worker.onerror = (ev) => {
      terminate();
      reject(Error(ev.message || `Map geometry worker failed`));
    };
    worker.onmessageerror = () => {
      terminate();
      reject(Error(`Map geometry worker returned unreadable data`));
    };
    worker.postMessage({ type: `decode`, url });
  });
}

async function fetchMapLights(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw Error(`map lights fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  const data = await resp.json();
  if (!data || typeof data != `object`) return [];
  if (!Array.isArray(data.lights)) return [];

  return data.lights.flatMap((light) => {
    if (!light || typeof light != `object`) return [];
    const { position, color, range, lumens, kind, direction, size } = light;
    const valid =
      Array.isArray(position) && Array.isArray(color) && Array.isArray(direction) &&
      position.length === 3 && color.length === 3 && direction.length === 3 &&
      typeof range == `number` && typeof lumens == `number` && typeof size == `number` &&
      (kind === `omni` || kind === `spot`) &&
      [...position, ...color, ...direction, range, lumens, size].every((v) => typeof v == `number` && Number.isFinite(v)) &&
      range > 0 && lumens > 0;
    return valid ? [{ position, color, range, lumens, kind, direction, size }] : [];
  });
}

function createMapGeometryWorker() {
  return new Worker(new URL(`/assets/mapGeometry.worker-BGvfBalF.js`, `` + import.meta.url), { type: `module` });
}

/** 带取消能力（AbortSignal）的几何准备 Promise 包装 */
function abortableMapPreparation(promise, signal, onAbort) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(new DOMException(`Map geometry preparation was cancelled`, `AbortError`));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener(`abort`, abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener(`abort`, abort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener(`abort`, abort);
        reject(err);
      },
    );
  });
}

// ── 几何构建 / 灯光注入 / 资源释放 ─────────────────────────────────────────

// （buildClassifiedMap / createClassifiedMaterial / injectShaderChunk / createInteriorLights / disposeObject
//   见下方。这些是 three.js 的网格组装，压缩名分别为 W_/J_/Y_/X_/Z_）

// 注：本文件剩余部分（meshopt_decoder 内联、CTEX 纹理解码、地图资源 URL 解析）
// 属于第三方通用库或纯资源路径工具，未逐行反混淆，详见原始切片。

// ============================================================================
// 【补充段 2026-11-09】02-map-assets 切片中此前未覆盖的 7 个声明
// 依据：docs/11 §9 的逐声明未覆盖清单（J_ / Y_ / ov / sv / dv / hv / yv 覆盖率均为 0%）
// ============================================================================

// ── L29407 `J_` → createWireframeMaterial：调试线框材质 ──
// 用 MeshStandardMaterial 起手（不透明度靠顶点色），再挂 onBeforeCompile 把
// three.js 的 `#include <xxx>` 展开并给 varying 加 centroid 修饰（避免线框抖动）。
function createWireframeMaterial() {
  const mat = new MeshStandardMaterial({ color: 16777215, emissive: 1581078, emissiveIntensity: 0.08, vertexColors: true, side: 2 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = expandThreeInclude(shader.vertexShader);
    shader.fragmentShader = expandThreeInclude(shader.fragmentShader);
  };
  return mat;
}

// ── L29416 `Y_` → expandThreeInclude：展开 GLSL 的 #include + 给 varying 加 centroid ──
// 两步：
//   1. 把整行 `#include <name>` 递归替换成 SHADER_CHUNKS[name] 的内容（找不到就原样保留）
//   2. 把行首的 `varying` 改成 `centroid varying` —— 光栅化时取像素中心而非任意采样点，
//      消除细线框的闪烁。这是 three.js 里常见的 wireframe 抗锯齿技巧。
// 依赖：SHADER_CHUNKS（原件里的 `K`，由 three.js 的 ShaderChunk 提供）
function expandThreeInclude(source) {
  return source
    .replace(/^[ \t]*#include <(\w+)>/gm, (whole, name) => {
      const chunk = SHADER_CHUNKS[name];
      return chunk === undefined ? whole : expandThreeInclude(chunk);
    })
    .replace(/^([ \t]*)varying\b/gm, '$1centroid varying');
}

// ── L29587 `ov` → viteEnvStub：Vite 的 import.meta.env 兜底对象 ──
// 这是构建期被静态替换掉的，走到运行时的分支只可能是「没被替换」的兜底路径。
function viteEnvStub() {
  return { BASE_URL: '/', DEV: false, MODE: 'production', PROD: true, SSR: false };
}

// ── L29590 `sv` → cs2AssetsBaseUrl：CS2 素材 CDN 的基址 ──
// 优先用 VITE_CS2_ASSETS_URL（保证以 / 结尾）；生产环境读不到就退到硬编码的 CDN 常量。
function cs2AssetsBaseUrl() {
  const url = viteEnvStub().VITE_CS2_ASSETS_URL;
  if (url) return url.endsWith('/') ? url : `${url}/`;
  return viteEnvStub().DEV ? null : DEFAULT_CS2_ASSETS_URL;
}

// ── L29618 `dv` → resolvePackagePath：从素材清单里取某个包的实际路径 ──
// kind 三种：'weapons' / 'sounds' / 'maps:<地图名>'（要剥掉前 5 个字符 `maps:`）
function resolvePackagePath(baseUrl, manifest, kind) {
  if (!manifest) return null;
  const entry = kind === 'weapons' ? manifest.weapons : kind === 'sounds' ? manifest.sounds : manifest.maps?.[kind.slice(4)];
  if (!entry?.path) return null;
  return `${baseUrl}${entry.path.endsWith('/') ? entry.path : `${entry.path}/`}`;
}

// ── L29653 `hv` → CTEX_MAGIC：Source2 纹理容器的魔数 ──
// 0x58455443 = 'CTEX' 的小端读法（1480938563）
var CTEX_MAGIC = 1480938563;

// ── L29664 `yv` → decodeCtex：解 Source2 的 .vtex/.ctex 纹理容器 ──
// 头部布局（全部小端）：
//   0   u32 magic     必须是 CTEX_MAGIC
//   4   u32 version   只支持 1
//   8   u32 format    源格式（Bc1Srgb / Bc7Srgb / …，见 FORMAT 枚举）
//   12  u32 width     基准宽度
//   16  u32 height    基准高度
//   20  u32 layers    数组层数
//   24  u32 mipCount  后面跟着 mipCount 个 u32 长度
//   28  ...           每个 mip 的长度表，之后紧接各 mip 的原始数据
// 每级 mip 的宽高按 width >> n / height >> n 递减，最小为 1。
function decodeCtex(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 28 || view.getUint32(0, true) !== CTEX_MAGIC) throw Error('not a CTEX file');
  const version = view.getUint32(4, true);
  if (version !== 1) throw Error(`unsupported CTEX version ${version}`);

  const format = view.getUint32(8, true);
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const layers = view.getUint32(20, true);
  const mipCount = view.getUint32(24, true);

  let offset = 28 + mipCount * 4;
  const mips = [];
  for (let n = 0; n < mipCount; n++) {
    const size = view.getUint32(28 + n * 4, true);
    if (offset + size > buffer.byteLength) throw Error('truncated CTEX file');
    mips.push({
      data: new Uint8Array(buffer, offset, size),
      width: Math.max(1, width >> n),
      height: Math.max(1, height >> n),
    });
    offset += size;
  }
  return { format, width, height, layers, mips };
}

// ── L29448–29580 `Q_` —— ⚠️ 这是 **meshoptimizer 官方 JS 解码器**，不是作者代码 ──
//
// 原件把 zeux/meshoptimizer 的 `meshopt_decoder.js`（MIT）整段内联了进来，
// 包含两段用自定义字符表编码的 wasm 字节（`e`/`t`）、一个 5 行 wasm 校验块 `n`、
// 一个 60 字节的码表 `r`，以及 `s()` 解码函数。
//
// 因此**本改写稿不对它逐行反混淆**——那是第三方库，逐行注释没有信息量，要看行为直接读上游源码。
// 这里只记录它对内的**公开接口**（这是接入方真正需要知道的部分）：
//
//   MeshoptDecoder.supported            当前环境是否支持 WebAssembly
//   .ready                              wasm 实例化完成的 Promise
//   .useWorkers(n)                      开 n 个 worker 并行解码（用 Blob + createObjectURL 生成）
//   .decodeVertexBuffer(dst, count, size, src, filterMode)
//   .decodeIndexBuffer(dst, count, size, src)
//   .decodeIndexSequence(dst, count, size, src)
//   .decodeGltfBuffer(dst, count, size, src, mode, filterMode)
//   .decodeGltfBufferAsync(count, size, src, mode, filterMode) → Promise<Uint8Array>
//
// 两个枚举（原件里的 `l` / `u`）：
//   滤波：NONE `''` / OCTAHEDRAL `meshopt_decodeFilterOct` / QUATERNION `meshopt_decodeFilterQuat`
//         / EXPONENTIAL `meshopt_decodeFilterExp` / COLOR `meshopt_decodeFilterColor`
//   类别：ATTRIBUTES `meshopt_decodeVertexBuffer` / TRIANGLES `meshopt_decodeIndexBuffer`
//         / INDICES `meshopt_decodeIndexSequence`
//
// 关键常量：解码前按 `(r + 3) & -4` 对齐分配、解码后 `sbrk(l - s(0))` 归还；
// 失败时抛 `Malformed buffer data: <code>`。
// ⚠️ 注意 `sbrk(l - s(0))` 这个写法依赖 emscripten 的 sbrk 语义（传负数视为 0），不要"优化"它。

// ── L29581–29586 作者常量（与 Q_ 紧邻，是素材 CDN 逻辑的一部分）──
var CS2_ASSETS_VERSION = 'csdemo-cs2-assets-v1';   // ev：素材包版本标记（写进缓存键）
// 离线应用：素材包基址指向本地镜像（serve.mjs /cs2/ → cdn/mirror/.../cs2/）。
// 也可用 VITE_CS2_ASSETS_URL 环境变量覆盖；切回线上改回 'https://maps.csdemo.tv/cs2/'。
var DEFAULT_CS2_ASSETS_URL = '/cs2/';
var MANIFEST_TTL_MS = 3e4;                          // nv：素材清单缓存有效期 30 秒
var cachedManifest = null;                          // rv：最近一次成功拉到的清单
var inflightManifest = null;                        // iv：进行中的清单请求（去重）
var lastManifestFetchAt = -1 / 0;                   // av：上次拉取时间戳

// ── L29329 `W_` 的命名要点：地图 Object3D 的名字 ──
// 原件把地图根节点命名为 `CSPlayer_ClassifiedMap`，下游（如 CS2MapRenderer）按名字查找它。
// 这是字符串契约，改名会导致找不到地图。
var MAP_ROOT_NAME = 'CSPlayer_ClassifiedMap';

// ── L29654 `gv` → CTEX_FORMATS：CTEX 容器里的格式编号 ──
// 与 decodeCtex 返回的 format 字段对应。
var CTEX_FORMATS = { Bc1Srgb: 1, Bc7Srgb: 2, Bc7Linear: 3, Bc5: 4, Bc4: 5, Bc6hUf16: 6, Bc1Linear: 7 };

// ── L29655 `_v` → REQUIRED_COMPRESSED_TEXTURE_EXTENSIONS ──
// CS2 的 VTEX 素材是 BC 压缩纹理，缺任何一个扩展都会有一类贴图解不出来。
var REQUIRED_COMPRESSED_TEXTURE_EXTENSIONS = [
  'EXT_texture_compression_bptc',
  'EXT_texture_compression_rgtc',
  'WEBGL_compressed_texture_s3tc',
  'WEBGL_compressed_texture_s3tc_srgb',
];

// ── L29661 `vv` → missingTextureExtensions：返回当前设备缺失的压缩纹理扩展 ──
// 返回值非空 → 调用方通常会降级到不加载 VTEX 贴图并给用户提示。
function missingTextureExtensions(renderer) {
  return REQUIRED_COMPRESSED_TEXTURE_EXTENSIONS.filter((name) => !renderer.extensions.has(name));
}
