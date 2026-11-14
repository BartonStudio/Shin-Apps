// ============================================================================
// 反混淆版本：地图资源加载（maps.csdemo.tv 客户端 + 地图几何解码）
// 原始压缩文件：src/app/02-map-assets.js（decompiled/index.beautified.js 28912–29746 行）
// 说明：
//   - 地图清单从 https://maps.csdemo.tv 拉取（index.json → release manifest）
//   - 地图几何（positions/colors）交给 mapGeometry.worker 解码成 three.js 几何
//   - overview.txt 解析成雷达坐标映射（pos_x/pos_y/scale/inset）
//   - 底部内联的 meshopt_decoder（$）与 CTEX 纹理解码（gv/yv/xv）是第三方/通用代码，仅标注不展开
// ============================================================================

// ── 地图清单客户端 ──────────────────────────────────────────────────────────

const MAP_HOST_URL = `https://maps.csdemo.tv/`;

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
  floorColor: 0xa39e44, // 10721924
  wallColor: 0xb0a7a5, // 11575687
  roofColor: 0x756d69, // 7695197
  detailColor: 0x5d5f50, // 6120020
  slopeColor: 0x907fb0, // 9471344
  edgeColor: 0x493a3a, // 4799790
  hazeColor: 0xc7b5a7, // 13089181
  skyHorizonColor: 0xb3c2c6, // 11782374
  skyZenithColor: 0x23655a, // 2320082
  sunAzimuth: 141,
  sunElevation: 65,
};

const MAP_LIGHTING_OVERRIDES = {
  de_anubis: { floorColor: 0xbda643, wallColor: 0xc9af73, roofColor: 0xd4c0a5, detailColor: 0x6f8b98, slopeColor: 0xb49a37, edgeColor: 0x6d5a47, hazeColor: 0xe7e2d5, skyHorizonColor: 0xdce8e8, skyZenithColor: 0x83b8bb, sunAzimuth: 257, sunElevation: 60 },
  de_ancient: { roofHeight: 0.24, floorColor: 0x565d32, wallColor: 0x899087, roofColor: 0x69727c, detailColor: 0x303033, slopeColor: 0x4f5a50, edgeColor: 0x272e4b, hazeColor: 0xcbd5d3, skyHorizonColor: 0xd5e0de, skyZenithColor: 0x919aaa, sunAzimuth: 224, sunElevation: 42 },
  de_cache: { roofHeight: 0.21, detailSpan: 220, floorColor: 0x74715a, wallColor: 0xa4a55f, roofColor: 0x505458, detailColor: 0x745e61, slopeColor: 0x7d7d7a, edgeColor: 0x3e407f, hazeColor: 0xc5c5ca, sunAzimuth: 297, sunElevation: 41 },
  de_dust2: { roofHeight: 0.42 },
  de_inferno: { roofHeight: 0.3, detailSpan: 110, floorColor: 0x9b9a70, wallColor: 0xc9bdb7, roofColor: 0xc9a1af, detailColor: 0x788a73, slopeColor: 0xb8a481, edgeColor: 0x665659, hazeColor: 0xd9e0e0, skyHorizonColor: 0xe7f0f0, skyZenithColor: 0x9db6b8, sunAzimuth: 38, sunElevation: 63 },
  de_mirage: { roofHeight: 0.34 },
  de_nuke: { roofHeight: 0.44, detailSpan: 100, floorColor: 0x626b70, wallColor: 0xaeb3c0, roofColor: 0x8e94a0, detailColor: 0x537567, slopeColor: 0x9ea3a1, edgeColor: 0x3e4b54, hazeColor: 0xc4d0d3, skyHorizonColor: 0xd2dcdd, skyZenithColor: 0x86a1a9, sunAzimuth: 210, sunElevation: 58 },
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
