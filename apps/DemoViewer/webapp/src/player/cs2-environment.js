// =============================================================================
// cs2-environment.js —— CS2 模式环境（manifest scene 数据 → 渲染器/场景）
//
// 对照原件：
//   · CS2Map.loadFrom（beautified L1059885+）：fetch `${pkg}map.json`，format 'cs2render'
//   · CS2Map.sceneEnvironment / Sv(extractFog)（beautified L1063184+ / fog 兜底）
//   · SceneRenderer.setCs2Environment（16-scene-renderer.deobf L215-259，逐字对齐）
//
// 分阶段说明（当前为"环境接管"阶段）：
//   ✓ map.json 拉取 + scene/fog/post 解析 + 环境/雾/天空/太阳/AgX 曝光接管
//   ✓ sky.ctex 全景缺省时走原版的 gradient-sky 兜底分支（原件 console.warn 行为一致）
//   ⏳ CS2 几何 chunks（geo/*.bin 自定义格式）、BCn 压缩纹理、光照探针、
//      CustomToneMapping LUT grading —— 属 M2 渲染引擎范畴，后续接入
// =============================================================================
import { Color, Vector3, LinearSRGBColorSpace } from './vendor/three-bundle.js';

// three r184 色调映射枚举（vendor 未导出常量表）
const AGX_TONE_MAPPING = 6;

/** CS2 素材包基址（离线镜像；与原版 DEFAULT_CS2_ASSETS_URL 对应） */
const CS2_BASE_URL =
  import.meta.env.VITE_CS2_ASSETS_URL ??
  (import.meta.env.DEV ? 'http://127.0.0.1:8123/cs2/' : '/cs2/');

/** 原件 Sv(extractFog)：manifest.scene.fog 缺省时用天空色、近乎无雾 */
function extractFog(manifest) {
  return (
    manifest.scene.fog ?? {
      color: manifest.scene.sun.skyColor,
      start: 1e6,
      end: 1e7,
      falloffExponent: 1,
      maxOpacity: 0,
      height: false,
      heightStart: 0,
      heightEnd: 0,
      verticalExponent: 1,
    }
  );
}

/** 拉取某图的 CS2 包清单（原件 loadFrom 的 map.json 步骤） */
export async function fetchCs2Manifest(mapName) {
  const indexUrl = new URL('index.json', CS2_BASE_URL).href;
  const pkg = await (await fetch(indexUrl)).json();
  const entry = pkg.maps?.[mapName];
  if (!entry?.path) return null; // 镜像里没有该图 CS2 包 → null（调用方走 classic 环境）
  const base = `${CS2_BASE_URL}${entry.path.endsWith('/') ? entry.path : entry.path + '/'}`;
  const resp = await fetch(`${base}map.json`);
  if (!resp.ok) return null;
  const manifest = await resp.json();
  if (manifest.format !== 'cs2render') throw Error(`unsupported CS2 map package (${manifest.format} v${manifest.version})`);
  return { manifest, baseUrl: base };
}

/** 原件 sceneEnvironment()：manifest → 渲染环境对象（线性空间颜色） */
export function createCs2Environment(manifest, skyTexture = null) {
  const { sun } = manifest.scene;
  const fog = extractFog(manifest);
  return {
    fogColor: new Color().setRGB(fog.color[0], fog.color[1], fog.color[2], LinearSRGBColorSpace),
    fogStart: fog.start,
    fogEnd: fog.end,
    skyColor: new Color().setRGB(sun.skyColor[0], sun.skyColor[1], sun.skyColor[2], LinearSRGBColorSpace),
    sunDirection: new Vector3(...sun.direction).normalize(),
    sunColor: new Color().setRGB(sun.color[0], sun.color[1], sun.color[2], LinearSRGBColorSpace),
    exposure: manifest.post.exposure,
    // sky.ctex 全景解码未接入 → null 走原版 gradient-sky 兜底（visibleSun 显示）
    sky: skyTexture && manifest.sky ? { map: skyTexture, vMax: manifest.sky.vMax } : null,
  };
}

/**
 * CS2 环境接管（原件 setCs2Environment，逐字对齐；本类挂在 SceneEnvironment 上调用）。
 * geometryLoading 由 CS2Map 接管后 false → 光照切 CS2 共享 uniforms（M2 接入）。
 */
export function applyCs2Environment(sceneEnv, environment, { geometryLoading = true } = {}) {
  const { scene, renderer, sky, sun } = sceneEnv;

  if (!environment) {
    // 无环境 → 回退到 Classic 默认（原件 L219-228：restoreClassic 由调用方传地图名）
    sceneEnv.restoreClassic(sceneEnv.currentMapName);
    return;
  }

  // 应用 CS2 环境的雾、天空色（原件 L230-242）
  sceneEnv.atmosphereFog.color.copy(environment.fogColor);
  sceneEnv.atmosphereFog.near = environment.fogStart;
  sceneEnv.atmosphereFog.far = environment.fogEnd;
  scene.background = environment.fogColor.clone();
  sky.material.uniforms.bottomColor.value.copy(environment.fogColor);

  // 天空顶色归一化（去亮度，只取色调）
  const skyColor = environment.skyColor.clone();
  skyColor.multiplyScalar(1 / Math.max(1, skyColor.r, skyColor.g, skyColor.b));
  sky.material.uniforms.topColor.value.copy(skyColor);
  // sky.ctex 全景（原件 setCs2Environment 不直接贴图，由 CS2Map.skyTexture 走
  // setSkyPanorama；这里只负责无全景时的 gradient 兜底与太阳光斑显隐）
  sun.visible = !environment.sky;

  // 太阳方向随图（原件 L244-254：cs2Sun 建立部分在 M2 几何接入时补齐）
  sceneEnv.sunAzimuth = null; // CS2 用向量而非方位角
  sceneEnv.sunDirection.copy(environment.sunDirection);

  // CS2 用 AgX 色调映射（原件 L256-258）
  renderer.toneMapping = AGX_TONE_MAPPING;
  renderer.toneMappingExposure = environment.exposure;
  void geometryLoading;
}
