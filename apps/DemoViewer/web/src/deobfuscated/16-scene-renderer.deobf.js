// ============================================================================
// 反混淆版本：场景渲染器（SceneRenderer）
// 原始压缩文件：src/app/16-scene-renderer.js（decompiled 39175–39543 行）
// 原文范围：decompiled/index.beautified.js L39175–39543（切片 16-scene-renderer）
// 压缩类名：qD
// 说明：three.js 的 WebGLRenderer 封装，负责太阳阴影、大气雾、天空、色调映射、
//       深度预渲染（depth prepass）、着色器预编译。字段/方法名已保留语义，仅补注释。
// ============================================================================

import { Color, DirectionalLight, AmbientLight, HemisphereLight, Scene, Fog, BoxGeometry, Mesh, PlaneGeometry,
  ShaderMaterial, DataTexture, SpriteMaterial, Sprite, Vector2, Vector3, Box3, MathUtils, FloatType,
  DepthTexture, UnsignedIntType, WebGLRenderTarget, RGBAFormat, BackSide, LinearFilter, NearestFilter,
  ClampToEdgeWrapping, RepeatWrapping, ACESFilmicToneMapping, NoToneMapping, AgXToneMapping, PCFShadowMap,
  RGBAFormat as _RGBA } from 'three';

// 默认大气雾范围（米）
const FOG_NEAR = 1200;  // 雾起始距离（原件 UD = 1200）
const FOG_FAR = 9000;   // 雾完全距离（原件 WD = 9e3）

// 静态阴影贴图边缘外扩量（米）
const SHADOW_MARGIN = 300;  // 原件 GD = 300

// 阴影质量 → 阴影贴图分辨率
const SHADOW_MAP_SIZES = { low: 1024, medium: 2048, high: 4096, ultra: 8192 };  // 原件 KD，含 ultra

class SceneRenderer {
  constructor(container, options = {}) {
    this.container = container;

    // WebGL 渲染器：优先高性能 GPU（独立显卡）
    this.renderer = new WebGLRenderer({
      antialias: options.antialias ?? true,
      powerPreference: options.powerPreference ?? `high-performance`,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 限制 DPR 上限防性能爆炸
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = ACESFilmicToneMapping;   // 4 = ACES filmic
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;          // 1 = PCF 软阴影
    this.renderer.info.autoReset = false;                 // 手动重置统计（beginRenderFrame）
    container.appendChild(this.renderer.domElement);

    // 场景 + 天空色背景（浅灰蓝）
    this.scene = new Scene();
    this.scene.background = new Color(0xb3c8e6);

    // 大气雾
    this.atmosphereFog = new Fog(0xc7b99d, FOG_NEAR, FOG_FAR);
    this.scene.fog = this.atmosphereFog;

    // 天空穹顶（渐变 shader 球体）+ 太阳光斑 + 半球光
    this.sky = createSkyDome();
    this.scene.add(this.sky);
    this.visibleSun = createSunSprite();
    this.scene.add(this.visibleSun);
    this.scene.add(new HemisphereLight(0xaec3d7, 0x514a40, 1));

    // 环境光（补光）
    const ambient = new AmbientLight(0xffffff, 0.3);
    ambient.position.set(0.4, 0.6, 1);
    this.scene.add(ambient);

    // 网格地面（Classic 模式的地板）
    this.grid = new GridHelper(16000, 125, 0x2a3344, 0x1a2230);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    // 其余字段
    this.sunShadowsEnabled = true;
    this.shadowQuality = `medium`;
    this.renderScale = 1;
    this.staticShadowLight = null;   // 静态地图太阳（投影用）
    this.staticShadowMap = null;     // 被投影的地图对象
    this.sunAzimuth = 141;           // 太阳方位角（度）
    this.sunElevation = 65;          // 太阳仰角（度）
    this.sunIntensity = 2;
    this.filmicContrast = true;
    this.cs2Environment = null;      // CS2 模式的环境数据（从地图 manifest 读）
    this.cs2Sun = null;              // CS2 模式的太阳光
    this.sunDirection = new Vector3();
    this.depthRT = null;             // 深度预渲染目标
    this.depthPrepass = new DepthPrepass();
    this.dbSize = new Vector2();
  }

  // ── 基础设置 ──────────────────────────────────────────────────────────────

  setFloor(z) { this.grid.position.z = z; }
  setGridVisible(v) { this.grid.visible = v; }

  resize() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  /** 渲染分辨率缩放（0.5 / 0.75 / 1） */
  setRenderScale(scale) {
    if (![0.5, 0.75, 1].includes(scale)) throw RangeError(`Invalid render resolution`);
    if (scale !== this.renderScale) { this.renderScale = scale; this.resize(); }
  }

  /** 开关太阳阴影 */
  setSunShadowsEnabled(enabled) {
    this.sunShadowsEnabled = enabled;
    if (this.staticShadowLight) {
      this.staticShadowLight.castShadow = enabled;
      this.staticShadowLight.shadow.needsUpdate = enabled;
    }
  }

  /** 阴影质量（low/medium/high）→ 调整阴影贴图分辨率 */
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
    light.name = `CSPlayer_StaticMapSun`;
    light.castShadow = this.sunShadowsEnabled;
    light.shadow.autoUpdate = false;                        // 静态地图阴影只算一次
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

  // ── 环境与光照 ────────────────────────────────────────────────────────────

  setAtmosphereEnabled(enabled) {
    this.scene.fog = enabled ? this.atmosphereFog : null;
  }

  /** Classic 模式的地图环境（从地图分类数据设置天空/太阳） */
  setMapEnvironment(hazeColor, skyHorizonColor, skyZenithColor, sunAzimuth, sunElevation) {
    if (this.cs2Environment) return; // CS2 模式下由 CS2 环境接管
    this.atmosphereFog.color.setHex(hazeColor);
    this.scene.background = new Color(skyHorizonColor);
    this.sky.material.uniforms.bottomColor.value.setHex(skyHorizonColor);
    this.sky.material.uniforms.topColor.value.setHex(skyZenithColor);
    this.sunAzimuth = sunAzimuth;
    this.sunElevation = sunElevation;
    this.updateSunDirection();
    this.updateStaticMapShadow();
  }

  /** CS2 模式的环境（从 CS2 地图 manifest 的 scene 数据设置） */
  setCs2Environment(environment) {
    this.cs2Environment = environment;
    if (this.cs2Sun) { this.scene.remove(this.cs2Sun); this.cs2Sun.dispose(); this.cs2Sun = null; }

    // 无环境 → 回退到 Classic 默认
    if (!environment) {
      this.setSkyMap(null, 1);
      this.visibleSun.visible = true;
      this.atmosphereFog.near = FOG_NEAR;
      this.atmosphereFog.far = FOG_FAR;
      this.renderer.toneMapping = this.filmicContrast ? ACESFilmicToneMapping : NoToneMapping;
      this.renderer.toneMappingExposure = 1;
      return;
    }

    // 应用 CS2 环境的雾、天空色
    this.atmosphereFog.color.copy(environment.fogColor);
    this.atmosphereFog.near = environment.fogStart;
    this.atmosphereFog.far = environment.fogEnd;
    this.scene.background = environment.fogColor.clone();
    this.sky.material.uniforms.bottomColor.value.copy(environment.fogColor);

    // 天空顶色归一化（去亮度，只取色调）
    const skyColor = environment.skyColor.clone();
    skyColor.multiplyScalar(1 / Math.max(1, skyColor.r, skyColor.g, skyColor.b));
    this.sky.material.uniforms.topColor.value.copy(skyColor);
    this.setSkyMap(environment.sky?.map ?? null, environment.sky?.vMax ?? 1);
    this.visibleSun.visible = !environment.sky;

    // 太阳方向 → 方位角/仰角
    const sunDirection = environment.sunDirection.clone().normalize();
    this.sunAzimuth = MathUtils.radToDeg(Math.atan2(sunDirection.y, sunDirection.x));
    this.sunElevation = MathUtils.radToDeg(Math.asin(MathUtils.clamp(sunDirection.z, -1, 1)));
    this.updateSunDirection();

    // CS2 太阳光
    this.cs2Sun = new DirectionalLight(environment.sunColor, Math.PI);
    this.cs2Sun.name = `CSPlayer_Cs2Sun`;
    this.cs2Sun.position.copy(sunDirection);
    this.scene.add(this.cs2Sun);

    // CS2 用 AgX 色调映射
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = environment.exposure;
  }

  /** Classic 模式的经典光照（给武器/角色光照用） */
  classicLighting() {
    this.updateSunDirection();
    const epsilon = 0.2;
    const skyColor = new Color(0xaec3d7).addScalar(epsilon).multiplyScalar(1 / Math.PI);
    const groundColor = new Color(0x514a40).addScalar(epsilon).multiplyScalar(1 / Math.PI);
    const sunColor = this.staticShadowLight
      ? new Color(0xffe5b8).multiplyScalar(this.sunIntensity / Math.PI)
      : new Color(0, 0, 0);
    return { sunDirection: this.sunDirection.clone(), sunColor, skyColor, groundColor, fog: this.scene.fog };
  }

  setCs2Exposure(exposure) {
    if (this.cs2Environment) {
      this.cs2Environment.exposure = exposure;
      this.renderer.toneMappingExposure = exposure;
    }
  }

  /** 设置天空全景贴图（CS2 地图自带的天空） */
  setSkyMap(texture, vMax) {
    const material = this.sky.material;
    material.uniforms.skyMap.value = texture;
    material.uniforms.skyVMax.value = vMax;
    const useSkyMap = texture !== null;
    if ((`USE_SKY_MAP` in material.defines) !== useSkyMap) {
      if (useSkyMap) material.defines.USE_SKY_MAP = ``;
      else delete material.defines.USE_SKY_MAP;
      material.needsUpdate = true;
    }
  }

  setFilmicContrastEnabled(enabled) {
    this.filmicContrast = enabled;
    if (!this.cs2Environment) this.renderer.toneMapping = enabled ? ACESFilmicToneMapping : NoToneMapping;
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  get width() { return this.container.clientWidth; }
  get height() { return this.container.clientHeight; }

  /** 每帧开始：重置渲染统计 */
  beginRenderFrame() { this.renderer.info.reset(); }

  /** 渲染一帧（天空/太阳跟随相机） */
  render(camera) {
    this.sky.position.copy(camera.position);
    this.updateSunDirection();
    this.visibleSun.position.copy(camera.position).addScaledVector(this.sunDirection, 30000);
    this.renderer.render(this.scene, camera);
  }

  /** 预览渲染（临时关阴影，供 scrub 预览用） */
  renderPreview(camera) {
    this.sky.position.copy(camera.position);
    const shadowEnabled = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = false;
    try { this.renderer.render(this.scene, camera); }
    finally { this.renderer.shadowMap.enabled = shadowEnabled; }
  }

  /** 带深度预渲染的渲染（供需要深度贴图的特效用） */
  renderWithDepth(camera, size) {
    const depthTarget = this.ensureDepthTarget(size);
    this.depthPrepass.render(this.renderer, this.scene, camera, depthTarget);
    this.render(camera);
    return depthTarget.depthTexture;
  }

  /** 预编译着色器：把场景对象、屏幕叠加、离屏叠加都渲染一遍，触发 shader 编译 */
  precompile(camera, options = {}) {
    const { sceneObjects = [], screenOverlays = [], offscreenOverlays = [] } = options;
    const depthTarget = this.ensureDepthTarget();
    const prevTarget = this.renderer.getRenderTarget();
    const tasks = [];
    try {
      this.renderer.setRenderTarget(depthTarget);
      tasks.push(this.depthPrepass.compileAsync(this.renderer, this.scene, camera, this.scene));
      for (const overlay of offscreenOverlays) tasks.push(compileRender(this.renderer, overlay, camera));
      this.renderer.setRenderTarget(null);
      tasks.push(compileRender(this.renderer, this.scene, camera));
      for (const obj of sceneObjects) tasks.push(compileRender(this.renderer, obj, camera, this.scene));
      for (const overlay of screenOverlays) tasks.push(compileRender(this.renderer, overlay, camera));
    } finally {
      this.renderer.setRenderTarget(prevTarget);
    }
    return Promise.all(tasks);
  }

  /** 确保深度渲染目标存在且尺寸正确 */
  ensureDepthTarget(size) {
    if (size) this.dbSize.copy(size);
    else this.renderer.getDrawingBufferSize(this.dbSize);
    const w = Math.max(1, Math.floor(this.dbSize.x));
    const h = Math.max(1, Math.floor(this.dbSize.y));
    if (!this.depthRT || this.depthRT.width !== w || this.depthRT.height !== h) {
      this.depthRT?.dispose();
      this.depthRT = new WebGLRenderTarget(w, h, { format: RGBAFormat, type: FloatType, depthBuffer: true, stencilBuffer: false });
      this.depthRT.depthTexture = new DepthTexture(w, h, UnsignedIntType);
      this.depthRT.depthTexture.format = DepthFormat;
    }
    return this.depthRT;
  }

  /** 由方位角/仰角计算太阳方向向量 */
  updateSunDirection() {
    const azimuth = MathUtils.degToRad(this.sunAzimuth);
    const elevation = MathUtils.degToRad(this.sunElevation);
    const cosElev = Math.cos(elevation);
    this.sunDirection.set(Math.cos(azimuth) * cosElev, Math.sin(azimuth) * cosElev, Math.sin(elevation));
  }

  get drawingBufferSize() {
    return this.renderer.getDrawingBufferSize(this.dbSize);
  }

  dispose() {
    this.disposeStaticMapShadow();
    this.depthRT?.dispose();
    this.depthPrepass.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ── 天空穹顶 shader ─────────────────────────────────────────────────────────

/** 渐变天空球（顶部色 → 底部色，可选全景贴图） */
function createSkyDome() {
  const material = new ShaderMaterial({
    side: BackSide,
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
          vec2 uv = vec2(atan(d.y, d.x) * 0.15915494, acos(clamp(d.z, -1.0, 1.0)) * 0.31830989 / skyVMax);
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

/** 太阳光斑 sprite（一张径向渐变的圆形贴图） */
function createSunSprite() {
  const data = new Uint8Array(16384 * 4); // 128×128 RGBA
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
  const texture = new DataTexture(data, 128, 128, RGBAFormat);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, color: 0xffffff, transparent: true, depthWrite: false, depthTest: true, fog: false }));
  sprite.scale.setScalar(6400);
  return sprite;
}
