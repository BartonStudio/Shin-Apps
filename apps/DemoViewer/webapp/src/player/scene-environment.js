// =============================================================================
// scene-environment.js —— 场景大气环境（v1/classified 模式，忠实还原原版 qD 行为）
//
// 对照原件：web/src/deobfuscated/16-scene-renderer.deobf.js（SceneRenderer）与
//           02-map-assets.deobf.js（MAP_LIGHTING 分类表）。参数逐字一致：
//   · 背景浅灰蓝 0xb3c8e6；大气雾 Fog(0xc7b99d, 1200, 9000)
//   · 天空穹顶：渐变 shader 球（0x2366d2 → 0xb3c8e6，exponent 0.55，跟随相机）
//   · 太阳光斑 sprite（径向渐变贴图，放在相机 + sunDirection×30000）
//   · 半球光 0xaec3d7/0x514a40 ×1 + 环境光 0xffffff ×0.3
//   · ACESFilmic 色调映射、曝光 1
// 每张图的环境差异走 MAP_LIGHTING 表（mirage 用默认值，仅 roofHeight 不同）。
// =============================================================================
import {
  Color,
  Scene,
  Fog,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  DataTexture,
  HemisphereLight,
  AmbientLight,
  DirectionalLight,
  Box3,
  MathUtils,
  Vector3,
} from './vendor/three-bundle.js';
import { applyCs2Environment } from './cs2-environment.js';

// three.js 常量（vendor 未导出常量表，按 r184 数值内联；与原版 deobf 里的 import 等价）
const BACK_SIDE = 1;            // BackSide
const RGBA_FORMAT = 1023;       // RGBAFormat
const LINEAR_FILTER = 1006;     // LinearFilter
const ACES_FILMIC = 4;          // ACESFilmicToneMapping

// 默认大气雾范围（米）——原件 UD/WD
const FOG_NEAR = 1200;
const FOG_FAR = 9000;

// 静态阴影贴图边缘外扩量（米）——原件 GD = 300
const SHADOW_MARGIN = 300;

// 阴影质量 → 阴影贴图分辨率——原件 KD，含 ultra
const SHADOW_MAP_SIZES = { low: 1024, medium: 2048, high: 4096, ultra: 8192 };

/**
 * 地图光照分类表（原件 DEFAULT_MAP_LIGHTING + MAP_LIGHTING_OVERRIDES，逐字搬运）。
 * v1/classified 模式下按地图名取环境：雾/天际线/天顶/太阳方位。
 */
const DEFAULT_MAP_LIGHTING = {
  roofHeight: 0.3,
  detailSpan: 180,
  floorColor: 0x8a7d6b,
  wallColor: 0xa8a093,
  roofColor: 0x756b5d,
  detailColor: 0x5d6254,
  slopeColor: 0x908570,
  edgeColor: 0x493d2e,
  hazeColor: 0xc7b99d,
  skyHorizonColor: 0xb3c8e6,
  skyZenithColor: 0x2366d2,
  sunAzimuth: 141,
  sunElevation: 65,
};

const MAP_LIGHTING_OVERRIDES = {
  de_anubis: { floorColor: 0xbda783, wallColor: 0xc9b393, roofColor: 0xd4c2a5, detailColor: 0x6f8f98, slopeColor: 0xb49a77, edgeColor: 0x6d5b47, hazeColor: 0xe7d9bf, skyHorizonColor: 0xdce7eb, skyZenithColor: 0x83bddb, sunAzimuth: 257, sunElevation: 60 },
  de_ancient: { roofHeight: 0.24, floorColor: 0x566252, wallColor: 0x899087, roofColor: 0x69746c, detailColor: 0x304233, slopeColor: 0x4f5d50, edgeColor: 0x27332b, hazeColor: 0xcbd6d3, skyHorizonColor: 0xd5dfde, skyZenithColor: 0x91a6aa, sunAzimuth: 224, sunElevation: 42 },
  de_cache: { roofHeight: 0.21, detailSpan: 220, floorColor: 0x747474, wallColor: 0xa4a69f, roofColor: 0x505050, detailColor: 0x746961, slopeColor: 0x7d817a, edgeColor: 0x3e433f, hazeColor: 0xc5ccca, sunAzimuth: 297, sunElevation: 41 },
  de_dust2: { roofHeight: 0.42 },
  de_inferno: { roofHeight: 0.3, detailSpan: 110, floorColor: 0x9b9990, wallColor: 0xc9b99f, roofColor: 0xc9976f, detailColor: 0x78836b, slopeColor: 0xb8a181, edgeColor: 0x665749, hazeColor: 0xd9dfe2, skyHorizonColor: 0xe7ebed, skyZenithColor: 0x9db8d8, sunAzimuth: 38, sunElevation: 63 },
  de_mirage: { roofHeight: 0.34 },
  de_nuke: { roofHeight: 0.44, detailSpan: 100, floorColor: 0x626c70, wallColor: 0xaebbc0, roofColor: 0x8e9ba0, detailColor: 0x537487, slopeColor: 0x9eaaad, edgeColor: 0x3e4d54, hazeColor: 0xc4d3d3, skyHorizonColor: 0xd2dddd, skyZenithColor: 0x86a9bd, sunAzimuth: 210, sunElevation: 58 },
};

/** 取某张地图的光照分类（默认 + 覆盖）——原件 getMapLighting */
export function getMapLighting(mapName) {
  return { ...DEFAULT_MAP_LIGHTING, ...MAP_LIGHTING_OVERRIDES[mapName] };
}

/** 渐变天空球（顶部色 → 底部色）——原件 createSkyDome，shader 逐字一致 */
function createSkyDome() {
  const material = new ShaderMaterial({
    side: BACK_SIDE,
    depthWrite: false,
    fog: false,
    defines: {},
    uniforms: {
      topColor: { value: new Color(0x2366d2) },
      bottomColor: { value: new Color(0xb3c8e6) },
      exponent: { value: 0.55 },
      skyMap: { value: null },
      skyVMax: { value: 1 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float exponent;
      uniform sampler2D skyMap;
      uniform float skyVMax;
      varying vec3 vDir;
      void main() {
        #ifdef USE_SKY_MAP
          vec3 d = normalize(vDir);
          // 注意：v 轴翻转后才是正确映射（CTEX 全景行序自下而上；deobf 稿此行
          // 有转写笔误，实测不翻转会采样到地面沙色区域）
          vec2 uv = vec2(atan(d.y, d.x) * 0.15915494, 1.0 - acos(clamp(d.z, -1.0, 1.0)) * 0.31830989 / skyVMax);
          gl_FragColor = vec4(texture2D(skyMap, uv).rgb, 1.0);
        #else
          float t = pow(clamp(vDir.z * 0.5 + 0.5, 0.0, 1.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new Mesh(new SphereGeometry(40000, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // 最先渲染
  return mesh;
}

/** 太阳光斑 sprite（128×128 径向渐变圆）——原件 createSunSprite，逐字一致 */
function createSunSprite() {
  const data = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dist = Math.hypot(((x + 0.5) / 128) * 2 - 1, ((y + 0.5) / 128) * 2 - 1);
      const alpha = dist < 0.38 ? 255 : Math.round(110 * (1 - MathUtils.smoothstep(dist, 0.38, 1)));
      const offset = (y * 128 + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new DataTexture(data, 128, 128, RGBA_FORMAT);
  texture.minFilter = LINEAR_FILTER;
  texture.magFilter = LINEAR_FILTER;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, color: 0xffffff, transparent: true, depthWrite: false, depthTest: true, fog: false }));
  sprite.scale.setScalar(6400);
  return sprite;
}

/**
 * 场景大气环境：挂到既有 renderer + scene 上（对应原件 SceneRenderer 构造里的环境部分）。
 */
export class SceneEnvironment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;

    renderer.toneMapping = ACES_FILMIC; // 原件：classic 模式 ACESFilmic
    renderer.toneMappingExposure = 1;

    // 天空色背景 + 大气雾（原件构造默认值）
    scene.background = new Color(0xb3c8e6);
    this.atmosphereFog = new Fog(0xc7b99d, FOG_NEAR, FOG_FAR);
    scene.fog = this.atmosphereFog;

    // 天空穹顶 + 太阳 + 光照
    this.sky = createSkyDome();
    scene.add(this.sky);
    this.sun = createSunSprite();
    scene.add(this.sun);
    scene.add(new HemisphereLight(0xaec3d7, 0x514a40, 1));
    const ambient = new AmbientLight(0xffffff, 0.3);
    ambient.position.set(0.4, 0.6, 1);
    scene.add(ambient);

    // 太阳方位（原件默认 141°/65°）
    this.sunAzimuth = 141;
    this.sunElevation = 65;
    this.sunDirection = new Vector3();

    // ── 静态地图阴影（原件 sunShadowsEnabled/shadowQuality/staticShadowLight）──
    this.sunShadowsEnabled = true;
    this.shadowQuality = 'medium';
    this.staticShadowLight = null; // 静态地图太阳（投影用）
    this.staticShadowMap = null;   // 被投影的地图对象
    this.sunIntensity = 2;         // 原件默认
    this.filmicContrast = true;    // 原件默认开启
    this.cs2Environment = null;    // CS2 环境数据（接管时非空）
  }

  /** CS2 环境接管（原件 setCs2Environment；environment=null 回退 Classic 默认） */
  setCs2Environment(environment, options) {
    this.cs2Environment = environment;
    applyCs2Environment(this, environment, options);
    // 太阳方向变了 → 静态阴影相机要重算
    this.updateStaticMapShadow();
  }

  /** sky.ctex 全景贴穹顶（sky = { map, vMax }，null 回退 gradient） */
  setSkyPanorama(sky) {
    const uniforms = this.sky.material.uniforms;
    if (sky?.map) {
      uniforms.skyMap.value = sky.map;
      uniforms.skyVMax.value = sky.vMax ?? 1;
      this.sky.material.defines.USE_SKY_MAP = '';
    } else {
      uniforms.skyMap.value = null;
      delete this.sky.material.defines.USE_SKY_MAP;
    }
    this.sky.material.needsUpdate = true;
  }

  /** 回到 Classic 环境（原件无此独立方法，此处是 setMapEnvironment + ACES 的组合） */
  restoreClassic(mapName) {
    this.cs2Environment = null;
    this.renderer.toneMapping = this.filmicContrast ? ACES_FILMIC : 0;
    this.renderer.toneMappingExposure = 1;
    if (mapName) this.setMapEnvironment(mapName);
    this.sun.visible = true;
  }

  // ── 阴影系统（原件 L104-193，逐字对齐） ────────────────────────────────────

  /** 开关太阳阴影 */
  setSunShadowsEnabled(enabled) {
    this.sunShadowsEnabled = enabled;
    if (this.staticShadowLight) {
      this.staticShadowLight.castShadow = enabled;
      this.staticShadowLight.shadow.needsUpdate = enabled;
    }
  }

  /** 阴影质量（low/medium/high/ultra）→ 调整阴影贴图分辨率 */
  setShadowQuality(quality) {
    if (quality === this.shadowQuality) return;
    this.shadowQuality = quality;
    if (this.staticShadowLight) {
      const shadow = this.staticShadowLight.shadow;
      const size = this.staticShadowMapSize();
      if (shadow.mapSize.x !== size) {
        shadow.mapSize.set(size, size);
        shadow.map?.dispose();
        shadow.map = null;
      }
      shadow.needsUpdate = this.sunShadowsEnabled;
    }
  }

  /** 设置被投影的静态地图（切换地图时调用） */
  setClassifiedMap(mapObject) {
    this.disposeStaticMapShadow();
    if (mapObject) this.installStaticMapShadow(mapObject);
  }

  /** 为静态地图安装一个"包住整张地图"的定向太阳阴影 */
  installStaticMapShadow(mapObject) {
    const light = new DirectionalLight(0xffe5b8, this.sunIntensity);
    light.name = 'CSPlayer_StaticMapSun';
    light.castShadow = this.sunShadowsEnabled;
    light.shadow.autoUpdate = false; // 静态地图阴影只算一次
    light.shadow.mapSize.setScalar(this.staticShadowMapSize());
    light.shadow.bias = -2e-4;
    light.shadow.normalBias = 12;
    this.scene.add(light, light.target);
    this.staticShadowLight = light;
    this.staticShadowMap = mapObject;
    this.updateStaticMapShadow();
  }

  /** 计算静态阴影的投影范围：把整张地图的包围盒包进阴影相机 */
  updateStaticMapShadow() {
    const light = this.staticShadowLight;
    const mapObject = this.staticShadowMap;
    if (!light || !mapObject) return;

    const box = new Box3().setFromObject(mapObject);
    if (box.isEmpty()) return;

    const center = box.getCenter(new Vector3());
    const radius = box.getSize(new Vector3()).length() * 0.5;

    // 太阳光位置 = 地图中心 + 太阳方向 × (半径 + 边距)
    light.position.copy(center).addScaledVector(this.sunDirection, radius + SHADOW_MARGIN);
    light.target.position.copy(center);
    light.updateMatrixWorld(true);
    light.target.updateMatrixWorld(true);
    light.shadow.updateMatrices(light);

    // 用包围盒在光照空间里设定正交投影范围
    const shadowCamera = light.shadow.camera;
    const boxInLight = box.clone().applyMatrix4(shadowCamera.matrixWorldInverse);
    shadowCamera.left = boxInLight.min.x - SHADOW_MARGIN;
    shadowCamera.right = boxInLight.max.x + SHADOW_MARGIN;
    shadowCamera.bottom = boxInLight.min.y - SHADOW_MARGIN;
    shadowCamera.top = boxInLight.max.y + SHADOW_MARGIN;
    shadowCamera.near = Math.max(1, -boxInLight.max.z - SHADOW_MARGIN);
    shadowCamera.far = Math.max(shadowCamera.near + 1, -boxInLight.min.z + SHADOW_MARGIN);
    shadowCamera.updateProjectionMatrix();
    light.shadow.needsUpdate = this.sunShadowsEnabled;
  }

  disposeStaticMapShadow() {
    const light = this.staticShadowLight;
    if (light) {
      this.scene.remove(light, light.target);
      light.dispose();
      this.staticShadowLight = null;
      this.staticShadowMap = null;
    }
  }

  staticShadowMapSize() {
    return Math.min(SHADOW_MAP_SIZES[this.shadowQuality], this.renderer.capabilities.maxTextureSize);
  }

  /** 按地图名应用环境（原件 setMapEnvironment；mirage/dust2 等走分类表） */
  setMapEnvironment(mapName) {
    this.currentMapName = mapName; // 供 restoreClassic 回退用
    const env = getMapLighting(mapName);
    this.atmosphereFog.color.setHex(env.hazeColor);
    this.scene.background = new Color(env.skyHorizonColor);
    this.sky.material.uniforms.bottomColor.value.setHex(env.skyHorizonColor);
    this.sky.material.uniforms.topColor.value.setHex(env.skyZenithColor);
    this.sunAzimuth = env.sunAzimuth;
    this.sunElevation = env.sunElevation;
    this.updateSunDirection();
  }

  /** 由方位角/仰角计算太阳方向向量——原件 updateSunDirection，逐字一致 */
  updateSunDirection() {
    // CS2 模式太阳方向由 manifest 直接给出（向量），不走方位角
    if (this.cs2Environment) return;
    if (this.sunAzimuth == null || this.sunElevation == null) return;
    const azimuth = MathUtils.degToRad(this.sunAzimuth);
    const elevation = MathUtils.degToRad(this.sunElevation);
    const cosElev = Math.cos(elevation);
    this.sunDirection.set(Math.cos(azimuth) * cosElev, Math.sin(azimuth) * cosElev, Math.sin(elevation));
  }

  /** 每帧渲染前调用：穹顶跟随相机、太阳贴在远侧天空——原件 render() 里的两行 */
  update(camera) {
    this.sky.position.copy(camera.position);
    this.updateSunDirection();
    this.sun.position.copy(camera.position).addScaledVector(this.sunDirection, 30000);
  }
}
