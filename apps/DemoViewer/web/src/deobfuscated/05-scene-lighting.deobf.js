// ============================================================================
// 反混淆版本：场景光照管理（SceneLighting）
// 原始压缩文件：src/app/05-scene-lighting.js（decompiled 31492–32300 行）
// 原文范围：decompiled/index.beautified.js L31492–32300（切片 05-scene-lighting）
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

// ============================================================================
// 【补充段 2026-11-09】05-scene-lighting：武器显示名 → 模型名映射表
// 原件 L31900–32086。这是「HUD 上写的枪名」到「素材里的模型文件名」的唯一转换表，
// 也是判断某个物品是不是刀的依据（Xy 的正则）。
// ============================================================================

// ── L32059 `Jy` → KNIFE_MODEL_BY_NAME：21 把刀的显示名 → 模型名 ──
// 注意 `knife_canis`/`knife_cord`/`knife_outdoor`/`knife_push` 这些模型名与显示名
// 并不对应（历史遗留，Valve 的命名），照抄即可，不要"修正"。
var KNIFE_MODEL_BY_NAME = {
  'Bayonet': 'knife_bayonet',
  'Bowie Knife': 'knife_bowie',
  'Butterfly Knife': 'knife_butterfly',
  'Survival Knife': 'knife_canis',
  'Paracord Knife': 'knife_cord',
  'Classic Knife': 'knife_css',
  'Falchion Knife': 'knife_falchion',
  'Flip Knife': 'knife_flip',
  'Gut Knife': 'knife_gut',
  // Karambit 的 key 在原件里**没有引号**（合法标识符），这里保留不加引号的形式以贴合原文
  Karambit: 'knife_karambit',
  'Kukri Knife': 'knife_kukri',
  'M9 Bayonet': 'knife_m9',
  'Navaja Knife': 'knife_navaja',
  'Nomad Knife': 'knife_outdoor',
  'Shadow Daggers': 'knife_push',
  'Skeleton Knife': 'knife_skeleton',
  'Stiletto Knife': 'knife_stiletto',
  'Huntsman Knife': 'knife_tactical',
  'Talon Knife': 'knife_talon',
  'Ursus Knife': 'knife_ursus',
};

// 同文件里紧邻的 `qy`（L31900–32058）是枪械/投掷物的同类映射表，末尾几项：
//   'CZ75-Auto'→cz75a / 'Dual Berettas'→elite / 'R8 Revolver'→revolver /
//   Zeus|'Zeus x27'|Taser→taser / 'C4 Explosive'→c4 /
//   'High Explosive Grenade'→hegrenade / Flashbang→flashbang /
//   'Smoke Grenade'→smokegrenade / Molotov→molotov /
//   'Incendiary Grenade'→incgrenade / 'Decoy Grenade'→decoy

// ── L32081 `Yy` → modelNameOf：查表 ──
function modelNameOf(displayName) {
  return WEAPON_MODEL_BY_NAME[displayName];
}

// ── L32084 `Xy` → isKnifeModel：用正则判断是否刀类模型 ──
// 之所以用正则而不是查表：刀的种类多、且素材名有 knife_/bayonet/karambit/dagger 多种写法。
function isKnifeModel(name) {
  return /knife|bayonet|karambit|dagger/i.test(name);
}

// ============================================================================
// 【补充段 2026-11-09】05-scene-lighting：武器模型与 C4 的 LED 光效常量
// 原件 L32158–32174。这些是「武器上的 LED 指示灯 / C4 的闪烁灯」用的参数。
// ============================================================================

var WEAPON_LED_SIZE = 18;        // sb：LED 平面尺寸
var WEAPON_LED_PAD = 24;         // cb
var WEAPON_LED_MARGIN = 6;       // lb
var WEAPON_LED_INTENSITY = 1;    // ub
var WEAPON_LED_DURATION = 3.6;   // db：一次闪烁持续秒数
// 六组 LED 颜色（0xRRGGBB），前五项是武器/装备状态色，最后两项同值（`_b` 与 `vb` 重复，
// 原件就是这样——`vb` 可能是后来加的别名，保持原样）
var LED_COLOR_A = 4148524;       // fb
var LED_COLOR_B = 1316367;       // pb
var LED_COLOR_C = 13288625;      // mb
var LED_COLOR_D = 3107386;       // hb
var LED_COLOR_E = 16724016;      // gb
var LED_COLOR_F = 4853519;       // _b
var LED_COLOR_G = 4853519;       // vb（与 _b 同值）
var WEAPON_LED_PLATE_SIZE = new Vector3(3, 3.2, 1.6);   // yb：LED 底板尺寸
var WEAPON_LED_SCALE = 0.3;      // bb
var WEAPON_LED_ROWS = 7;         // xb
var WEAPON_LED_COLS = 6;         // Sb
var LED_DEG = Math.PI / 180;     // Cb

// 说明：`wb`（L32175 起）是武器模型加载器，负责按上面的参数生成 LED 光效面片；
// 它依赖 GLTFLoader（动态 import，见原件 L32145 的 `./GLTFLoader-maChTRxv.js`）。
// C4 模型加载失败时打印 `[csplayer] C4 model failed to load` 并降级为占位方块。

// ============================================================================
// 【补充段 2026-11-09】05-scene-lighting 的 `Vy`：顶点焊接 + 平滑法线
// 原件 L31857–31942（87 行）。地图几何的原始顶点是逐三角形的（硬边），
// 这个函数按**折痕角**把相邻三角形焊接起来，再取平均法线，得到平滑曲面。
// ============================================================================

// 参数 opts：
//   creaseDeg      普通区域的折痕角阈值（默认 35°）——超过此夹角就保留硬边
//   ringCreaseDeg  环形区域的折痕角阈值（默认 65°）——环形几何允许更大的夹角仍算平滑
//   ringRanges     环形顶点区间，扁平数组 [start0, len0, start1, len1, …]
// 返回：新的 BufferGeometry（带焊接后的索引与平均法线）
function weldAndSmoothNormals(geometry, opts = {}) {
  const creaseDeg = opts.creaseDeg ?? 35;
  const ringCreaseDeg = opts.ringCreaseDeg ?? 65;
  const position = geometry.getAttribute('position');
  const vertCount = position.count;

  // 标记哪些顶点属于「环」——它们用更宽松的阈值
  const isRing = new Uint8Array(vertCount);
  const ringRanges = opts.ringRanges ?? [];
  for (let i = 0; i + 1 < ringRanges.length; i += 2) {
    isRing.fill(1, Math.min(ringRanges[i], vertCount), Math.min(ringRanges[i] + ringRanges[i + 1], vertCount));
  }

  // 没有索引就当作每三个顶点一个三角形
  const index = geometry.index ? geometry.index.array : Uint32Array.from({ length: vertCount }, (_, i) => i);
  const triCount = Math.floor(index.length / 3);

  // 展开成扁平坐标
  const pos = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    pos[i * 3] = position.getX(i);
    pos[i * 3 + 1] = position.getY(i);
    pos[i * 3 + 2] = position.getZ(i);
  }

  // 逐三角形算面法线（先不归一化，长度 = 2×面积，后面加权平均用得上）
  const faceNormalRaw = new Float32Array(triCount * 3);
  const faceNormalUnit = new Float32Array(triCount * 3);
  const vertTriCount = new Uint32Array(vertCount + 1);
  for (let t = 0; t < triCount; t++) {
    const ia = index[t * 3] * 3;
    const ib = index[t * 3 + 1] * 3;
    const ic = index[t * 3 + 2] * 3;
    const e1x = pos[ib] - pos[ia];
    const e1y = pos[ib + 1] - pos[ia + 1];
    const e1z = pos[ib + 2] - pos[ia + 2];
    const e2x = pos[ic] - pos[ia];
    const e2y = pos[ic + 1] - pos[ia + 1];
    const e2z = pos[ic + 2] - pos[ia + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    faceNormalRaw.set([nx, ny, nz], t * 3);
    faceNormalUnit.set([nx / len, ny / len, nz / len], t * 3);
    for (let k = 0; k < 3; k++) vertTriCount[index[t * 3 + k] + 1]++;
  }
  // 前缀和 → 每个顶点关联的三角形列表
  const vertTriStart = vertTriCount;
  for (let i = 0; i < vertCount; i++) vertTriStart[i + 1] += vertTriStart[i];
  const vertTriCursor = vertTriStart.slice(0, vertCount);
  const vertTriangles = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) vertTriangles[vertTriCursor[index[t * 3 + k]]++] = t;
  }

  const cosNormal = Math.cos(THREE_MATH.degToRad(creaseDeg));
  const cosRing = Math.cos(THREE_MATH.degToRad(ringCreaseDeg));

  const vertTriGroup = new Uint32Array(triCount * 3);
  const newIndices = [];
  const accumNormals = [];
  const groupParent = [];

  for (let v = 0; v < vertCount; v++) {
    const from = vertTriStart[v];
    const n = vertTriStart[v + 1] - from;
    // 并查集（路径压缩）在局部用数组
    groupParent.length = n;
    for (let i = 0; i < n; i++) groupParent[i] = i;
    const find = (i) => {
      while (groupParent[i] !== i) i = groupParent[i] = groupParent[groupParent[i]];
      return i;
    };
    for (let i = 0; i < n; i++) {
      const ta = vertTriangles[from + i];
      for (let j = i + 1; j < n; j++) {
        const tb = vertTriangles[from + j];
        // 找到这对三角形共享的另一个顶点
        let shared = -1;
        for (let k = 0; k < 3 && shared < 0; k++) {
          const other = index[ta * 3 + k];
          if (other !== v && (other === index[tb * 3] || other === index[tb * 3 + 1] || other === index[tb * 3 + 2])) shared = other;
        }
        if (shared < 0) continue;
        // 两面法线夹角够小（点积够大）才焊接；环区用更宽松的阈值
        const dot = faceNormalUnit[ta * 3] * faceNormalUnit[tb * 3] + faceNormalUnit[ta * 3 + 1] * faceNormalUnit[tb * 3 + 1] + faceNormalUnit[ta * 3 + 2] * faceNormalUnit[tb * 3 + 2];
        const threshold = isRing[v] === 1 && isRing[shared] === 1 ? cosRing : cosNormal;
        if (dot >= threshold) groupParent[find(i)] = find(j);
      }
    }
    // 每个并查集组产出一个新顶点
    const groupIndex = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      let gi = groupIndex.get(root);
      if (gi === undefined) {
        gi = newIndices.length;
        groupIndex.set(root, gi);
        newIndices.push(v);
        accumNormals.push(0, 0, 0);
      }
      const tri = vertTriangles[from + i];
      for (let k = 0; k < 3; k++) accumNormals[gi * 3 + k] += faceNormalRaw[tri * 3 + k];
      for (let k = 0; k < 3; k++) if (index[tri * 3 + k] === v) vertTriGroup[tri * 3 + k] = gi;
    }
  }

  // 重映射所有非 normal 属性
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (name !== 'normal') out.setAttribute(name, remapAttribute(attr, newIndices));   // → Hy
  }

  // 累积法线归一化
  const normals = new Float32Array(accumNormals.length);
  for (let i = 0; i < accumNormals.length; i += 3) {
    const len = Math.hypot(accumNormals[i], accumNormals[i + 1], accumNormals[i + 2]) || 1;
    normals[i] = accumNormals[i] / len;
    normals[i + 1] = accumNormals[i + 1] / len;
    normals[i + 2] = accumNormals[i + 2] / len;
  }
  out.setAttribute('normal', new BufferAttribute(normals, 3));
  // 顶点数 ≤ 65535 用 Uint16 索引省内存
  out.setIndex(new BufferAttribute(newIndices.length <= 65535 ? Uint16Array.from(vertTriGroup) : vertTriGroup, 1));
  return out;
}
