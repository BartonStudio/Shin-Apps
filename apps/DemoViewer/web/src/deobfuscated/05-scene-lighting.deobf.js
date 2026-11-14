// ============================================================================
// 反混淆版本：场景光照管理（SceneLighting）
// 原始压缩文件：src/app/05-scene-lighting.js（decompiled 31492–32300 行）
// 压缩类名：Ly
// 说明：管理"武器/角色"自研 PBR 材质的光照环境。核心设计：
//   - 一套自定义 shader（CS2Weapon），光照通过 uniform 注入
//   - 环境光 = 天空色 + 地面色混合（flat ambient，4×3 矩阵存三个方向的半球光）
//   - CS2 模式用光照探针（light probe grid），Classic 模式用简单太阳光
// ============================================================================

class SceneLighting {
  // 光照环境 uniform（所有 CS2Weapon 材质共享）
  environment = {
    uProbes: { value: null },         // 光照探针纹理（CS2 光照探针数据）
    uProbeData: { value: null },
    uProbeGrid: { value: null },
    uGridOrigin: { value: new Vector3() },
    uGridInvCell: { value: new Vector3(1, 1, 1) },
    uGridMax: { value: new Vector3() },
    uProbeMaxLod: { value: 0 },
    uSunDir: { value: new Vector3(0, 0, 1) },
    uSunColor: { value: new Vector3(1, 1, 1) },
    uFogColor: { value: new Vector3() },
    uFogParams: { value: new Vector4(0, 0, 0, 1) },
    uFogShape: { value: new Vector3(1, 1, 0) },
  };
  // 视图空间 uniform（第一人称持枪用，在视图空间渲染）
  view = { uViewToWorld: { value: new Matrix4() }, uViewOrigin: { value: new Vector3() }, uViewScale: { value: VIEW_SCALE } };

  map = null;             // CS2 地图（提供光照探针/环境）
  unsubscribeMap = null;  // 地图销毁回调
  grid = null;            // 光照探针网格
  generation = 0;         // 代际计数（异步加载防竞态）
  flat = createAmbientLut(); // 扁平环境光（天空+地面混合）
  materials = new Set();  // 所有受管理的材质（切 CS2 模式时批量更新）
  point = new Vector3();
  cs2 = false;            // 是否 CS2 模式
  lightingVersion = 0;    // 光照版本（触发材质重编译）

  get usesCs2Map() { return this.map !== null; }
  get version() { return this.lightingVersion; }

  /** 切到 CS2 地图的光照（光照探针 + 太阳 + 雾） */
  setCs2Map(cs2Map) {
    const envUniforms = cs2Map.environmentUniforms();
    if (!envUniforms) return false;

    this.releaseMap();
    const generation = ++this.generation;
    this.lightingVersion++;
    this.map = cs2Map;
    this.unsubscribeMap = cs2Map.onClear(() => this.releaseMap());
    this.grid = null;

    // 复制环境 uniform（探针/太阳/雾）
    for (const key of CS2_ENV_UNIFORMS) this.environment[key].value = envUniforms[key].value;

    const sunColor = envUniforms.uSunColor.value;
    const fogColor = envUniforms.uFogColor.value;
    // 扁平环境光 = 雾色 + 弱化的太阳色（天空=雾色，地面=弱太阳色）
    mixAmbient(this.flat, [fogColor.x, fogColor.y, fogColor.z], [sunColor.x * 0.08, sunColor.y * 0.07, sunColor.z * 0.06], 0.5);
    this.setCs2(true);

    // 异步加载光照探针网格
    cs2Map.loadLightGrid().then((grid) => {
      if (generation === this.generation) { this.grid = grid; this.lightingVersion++; }
    });
    return true;
  }

  /** Classic 模式光照（简单太阳 + 天空/地面色） */
  setClassic(lighting) {
    this.releaseMap();
    this.generation++;
    this.lightingVersion++;
    const env = this.environment;
    env.uSunDir.value.copy(lighting.sunDirection).normalize();
    env.uSunColor.value.set(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b);

    const fog = lighting.fog;
    if (fog) {
      const invRange = Math.max(0.001, fog.far - fog.near);
      env.uFogColor.value.set(fog.color.r, fog.color.g, fog.color.b);
      env.uFogParams.value.set(1 / invRange, -fog.near / invRange, 0, 1);
      env.uFogShape.value.set(1, 1, 1);
    } else {
      env.uFogShape.value.set(1, 1, 0);
    }

    // 扁平环境光 = 天空色 + 地面色混合
    const sky = lighting.skyColor, ground = lighting.groundColor;
    mixAmbient(this.flat, [sky.r, sky.g, sky.b], [ground.r, ground.g, ground.b], 0.5);
    this.setCs2(false);
  }

  /** 采样某位置的光照（供 shader 用；无探针时回退到扁平环境光） */
  sample(x, y, z, out) {
    if (this.grid) this.grid.sample(x, y, z, out);
    else { out.ambient.set(this.flat.ambient); out.sunVisibility = 1; }
    out.probeRow = this.map ? this.map.fallbackProbeRow(this.point.set(x, y, z)) : 0;
    return out;
  }

  /** 更新视图空间矩阵（第一人称持枪用） */
  setView(camera) {
    this.view.uViewToWorld.value.setFromMatrix4(camera.matrixWorld);
    this.view.uViewOrigin.value.setFromMatrixPosition(camera.matrixWorld);
  }

  /**
   * 创建一个 CS2 武器/角色用的 PBR 材质。
   * 通过 defines 开关不同特性（贴图/法线/ORM/玻璃/淡出/视图空间/CS2 探针）。
   */
  createMaterial(options) {
    const textured = options.surface === `textured`;
    const defines = {};
    if (textured) defines.WEAPON_TEXTURED = ``;
    if (textured && options.ormMap) defines.WEAPON_ORM_MAP = ``;
    if (textured && options.normalMap) defines.WEAPON_NORMAL_MAP = ``;
    if (options.viewSpace) defines.WEAPON_VIEW_SPACE = ``;
    if (options.glass) defines.WEAPON_GLASS = ``;
    if (options.fade) defines.WEAPON_FADE = ``;
    if (options.tint && !textured) defines.WEAPON_TINT = ``;
    if (this.cs2) defines.CS2_PROBES = ``;

    const material = new ShaderMaterial({
      name: `CS2Weapon`,
      defines,
      uniforms: {
        ...this.environment,
        ...(options.viewSpace ? this.view : {}),
        ...(options.object ?? OBJECT_UNIFORMS()),
        uColorMap: { value: options.map ?? null },
        uOrmMap: { value: options.ormMap ?? null },
        uOrmFactors: { value: new Vector3(...(options.ormFactors ?? [1, 1, 1])) }, // 遮挡/粗糙度/金属度系数
        uNormalMap: { value: options.normalMap ?? null },
        uAlphaTest: { value: options.alphaTest ?? 0 },
        uFade: { value: 1 },
        uTint: { value: new Vector3(1, 1, 1) },
      },
      vertexShader: WEAPON_VERTEX_SHADER,
      fragmentShader: WEAPON_FRAGMENT_SHADER,
      side: options.side ?? (options.glass ? DoubleSide : FrontSide),
      fog: false,          // 雾在 shader 里手动处理（自定义雾）
      lights: false,       // 不用 three.js 内置光照，自己采样探针
      transparent: options.glass ?? false,
      depthWrite: !options.glass,
      premultipliedAlpha: options.glass ?? false,
    });

    this.materials.add(material);
    material.addEventListener(`dispose`, () => this.materials.delete(material));

    // 透明裁剪需要深度材质（用于深度预渲染）
    if (options.alphaTest && options.map) {
      const depthMaterial = new MeshDepthMaterial({ map: options.map, alphaTest: options.alphaTest, side: material.side, colorWrite: false });
      material.userData.depthMaterial = depthMaterial;
      material.addEventListener(`dispose`, () => depthMaterial.dispose());
    }
    return material;
  }

  /** 释放 CS2 地图光照（切回 Classic） */
  releaseMap() {
    if (!this.map) return;
    this.unsubscribeMap?.();
    this.unsubscribeMap = null;
    this.map = null;
    this.grid = null;
    this.generation++;
    this.lightingVersion++;

    // 清空探针 uniform，克隆基础 uniform 防止共享引用
    const env = this.environment;
    for (const key of NULLABLE_UNIFORMS) env[key].value = null;
    for (const key of CLONEABLE_UNIFORMS) {
      const value = env[key].value;
      if (value && typeof value.clone == `function`) env[key].value = value.clone();
    }
    this.setCs2(false);
  }

  /** 切换 CS2 探针开关（批量更新所有材质的 defines） */
  setCs2(cs2) {
    if (cs2 === this.cs2) return;
    this.cs2 = cs2;
    for (const material of this.materials) {
      if (cs2) material.defines.CS2_PROBES = ``;
      else delete material.defines.CS2_PROBES;
      material.needsUpdate = true;
    }
  }
}

/**
 * 计算扁平环境光（flat ambient）：
 * 把天空色和地面色混合成一个 4×3 的"环境光查找表"——三行存三个方向的半球光照。
 * 这是 CS2 武器材质在没有光照探针时的简单环境光近似。
 */
function mixAmbient(ambient, sky, ground, ratio) {
  for (let i = 0; i < 3; i++) {
    const mixed = sky[i] * ratio + ground[i] * (1 - ratio);
    for (let channel = 0; channel < 4; channel++) ambient.ambient[channel * 3 + i] = mixed;
    ambient.ambient[12 + i] = sky[i];
    ambient.ambient[15 + i] = ground[i];
  }
}
