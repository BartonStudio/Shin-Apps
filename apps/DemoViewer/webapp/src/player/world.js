// =============================================================================
// player/world.js —— 地图世界加载（生产入口；dev.js 复用同一套逻辑）
//
// 两条引擎路径（与原版一致：桌面 GPU 走 CS2 包，缺包/失败回退 v1 分类管线）：
//   · cs2 ：cs2render 地图包（几何 chunk + BCn 纹理 + 烘焙光照 + 探针 + 天空全景 +
//           PVS + LUT grading），逐字移植自原版 CS2Map
//   · v1  ：collision GLB → worker 分类着色 + 室内灯 + 静态阴影
//
// 用法：
//   const world = openWorld(mountEl);            // 打开视口（复用已有实例）
//   await world.load('de_mirage', { engine: 'auto', onProgress });
//   world.pause() / world.resume(); world.close();
// =============================================================================
import { createPlayer } from './index.js';
import { loadMapGeometry } from './map-loader.js';
import { fetchCs2Manifest, createCs2Environment } from './cs2-environment.js';
import { CS2MapRenderer } from './cs2/map-renderer.js';
import { Vector3, Box3 } from './vendor/three-bundle.js';

const CUSTOM_TONE_MAPPING = 5; // three r184 CustomToneMapping（LUT grading 注入用）

let instance = null;
let hostEl = null;
let cs2Renderer = null;
let classicObject = null;
let currentMap = null;
let currentEngine = null;

/** 打开（或复用）地图视口。mount 省略时用全屏浮层（dev 调试）。 */
export function openWorld(mount = null) {
  if (instance) return worldApi;
  hostEl = mount ?? document.createElement('div');
  if (!mount) {
    hostEl.id = 'player-world-host';
    hostEl.style.cssText = 'position:fixed;inset:0;z-index:200;background:#14161a';
    document.body.appendChild(hostEl);
  } else {
    hostEl.dataset.worldMount = '1'; // 挂载在页面里的容器，close() 时不删 DOM
  }
  instance = createPlayer(hostEl, { grid: false });
  return worldApi;
}

function clearWorld(player) {
  if (cs2Renderer) {
    cs2Renderer.clear();
    player.scene.remove(cs2Renderer.group);
    cs2Renderer = null;
  }
  if (classicObject) {
    player.scene.remove(classicObject);
    classicObject = null;
  }
  player.environment.setClassifiedMap(null);
  player.environment.setSkyPanorama(null);
  player.interiorLights.length = 0;
  currentMap = null;
  currentEngine = null;
}

/** CS2 包路径：几何/纹理/光照/探针/天空/PVS/LUT */
async function loadCs2(player, name, onProgress) {
  if (!cs2Renderer) {
    cs2Renderer = new CS2MapRenderer(player.renderer);
    player.add(cs2Renderer.group);
    player.frameHooks.push((camera) => cs2Renderer.update(camera, true));
  }
  const ok = await cs2Renderer.load(name, { visibilityCulling: true }, onProgress);
  if (!ok) return false;

  cs2Renderer.loadLightGrid(); // 动态物体（玩家/武器/门）烘焙光照网格（M2 用）

  const environment = cs2Renderer.sceneEnvironment();
  if (environment) {
    player.environment.setMapEnvironment(name);
    player.environment.setCs2Environment(environment);
    player.environment.setSkyPanorama(environment.sky);
  }
  if (cs2Renderer.installGrading()) {
    player.renderer.toneMapping = CUSTOM_TONE_MAPPING;
    player.renderer.toneMappingExposure = environment?.exposure ?? 1;
  }

  const bounds = cs2Renderer.manifest?.bounds;
  const box = new Box3();
  if (bounds) box.set(new Vector3(...bounds.min), new Vector3(...bounds.max));
  else box.setFromObject(cs2Renderer.group);
  return box;
}

/** v1 路径：collision GLB → 分类着色 + 室内灯 + 静态阴影（环境优先 CS2 manifest） */
async function loadV1(player, name, onProgress, useCs2Environment = true) {
  onProgress?.(`Loading ${name} geometry…`);
  const { object, box, interiorLights } = await loadMapGeometry(name);
  classicObject = object;
  player.add(object);

  player.environment.cs2Environment = null;
  player.environment.setMapEnvironment(name);
  let cs2 = null;
  try {
    if (useCs2Environment) cs2 = await fetchCs2Manifest(name);
  } catch (err) {
    console.warn(`[world] CS2 环境不可用，回退分类表：${err.message}`);
  }
  if (cs2) {
    player.environment.setCs2Environment(createCs2Environment(cs2.manifest), { geometryLoading: false });
    player.environment.setSkyPanorama(null);
  }
  player.environment.setClassifiedMap(object);
  player.interiorLights.length = 0;
  player.interiorLights.push(...(interiorLights ?? []));
  return box;
}

async function load(name, { engine = 'auto', onProgress, cs2Environment = true } = {}) {
  const player = instance;
  if (!player) throw Error('world 未打开');
  if (!name) throw Error('缺少地图名');

  const t0 = performance.now();
  clearWorld(player);

  let box = null;
  let used = null;

  if (engine === 'cs2' || engine === 'auto') {
    try {
      box = await loadCs2(player, name, onProgress);
      if (box) used = 'cs2';
    } catch (err) {
      console.warn(`[world] CS2 包加载失败（${name}）：${err.message}`);
      if (engine === 'cs2') throw err;
      clearWorld(player);
    }
  }
  if (!box && engine !== 'cs2') {
    box = await loadV1(player, name, onProgress, cs2Environment);
    used = 'v1';
  }
  if (!box) throw Error(`无法加载地图 ${name}`);

  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  player.camera.frameScene(center, Math.max(size.x, size.y) / 2 || 2000);

  currentMap = name;
  currentEngine = used;
  const info = {
    map: name,
    engine: used,
    ms: Math.round(performance.now() - t0),
    size: size.toArray().map((v) => +v.toFixed(0)),
  };
  console.log('[world] 地图世界已加载', info);
  return info;
}

const worldApi = {
  load,
  get player() { return instance; },
  get map() { return currentMap; },
  get engine() { return currentEngine; },
  get cs2() { return cs2Renderer; },
  get host() { return hostEl; },
  pause() { instance?.setPaused(true); },
  resume() { instance?.setPaused(false); },
  close() {
    if (!instance) return;
    clearWorld(instance);
    instance.dispose();
    if (!hostEl?.dataset?.worldMount) hostEl?.remove();
    instance = null;
    hostEl = null;
  },
};
