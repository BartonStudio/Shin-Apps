// ─────────────────────────────────────────────────────────────────────────────
// 06-world-props.deobf.js — 世界道具：死亡标记 + 掉落武器 + 武器图标 + 三角形网格
//
// 来源：src/app/06-world-props.js（Vite 生产构建，prettier 展开版）
// 原文范围：decompiled/index.beautified.js L32301–32967（切片 06-world-props）
// 原始压缩名：Eb = CSS2DObject，Mb = CSS2DRenderer，Lb = DeathMarkers，
//             ox = DroppedWeapons，wx = TriangleGrid，Wb/Kb/Gb = 武器图标映射表
//
// 本文件包含：
//   1. CSS2DObject / CSS2DRenderer —— 把 DOM 元素作为 3D 场景中的标签渲染
//      （投影到屏幕坐标，按深度排序）。
//   2. DeathMarkers（Lb）—— 死亡标记：一个十字 + 一个 CSS2D 名字标签，
//      在死亡后显示、受害者复活时隐藏。
//   3. DroppedWeapons（ox）—— 掉落武器：优先用图标（带描边的 canvas 纹理），
//      可选加载真实 3D 武器模型；按轨迹逐帧摆放。
//   4. 武器图标映射（Wb/Kb/Gb/qb）—— CS2 武器名 → 图标文件名的映射表。
//   5. TriangleGrid（wx）—— 基于空间哈希的三角形网格，用于碰撞检测。
//
// 说明：标识符已重命名成语义化名字，局部单字母变量展开，关键逻辑补注释。
//       未改任何语义。
// ─────────────────────────────────────────────────────────────────────────────

// ── CSS2DObject（Eb） ─────────────────────────────────────────────────────────

/** 把 DOM 元素作为 3D 场景中的一个 2D 标签对象 */
class CSS2DObject extends Object3D {
  constructor(element = document.createElement('div')) {
    super();
    this.isCSS2DObject = true;
    this.element = element;
    this.element.style.position = 'absolute';
    this.element.style.userSelect = 'none';
    this.element.setAttribute('draggable', false);
    this.center = new Vector2(0.5, 0.5);
    this.addEventListener('removed', function () {
      this.traverse(function (obj) {
        if (
          obj.element &&
          obj.element instanceof obj.element.ownerDocument.defaultView.Element &&
          obj.element.parentNode !== null
        ) {
          obj.element.remove();
        }
      });
    });
  }

  copy(source, recursive) {
    super.copy(source, recursive);
    this.element = source.element.cloneNode(true);
    this.center = source.center;
    return this;
  }
}

// ── CSS2DRenderer（Mb） ───────────────────────────────────────────────────────

// 复用向量/矩阵（模块级，避免每帧分配）
const _cssVec = new Vector3();
const _cssMat = new Matrix4();
const _cssMat2 = new Matrix4();
const _cssVecA = new Vector3();
const _cssVecB = new Vector3();

/** 把 CSS2D 对象投影到屏幕并管理 zIndex 排序的渲染器 */
class CSS2DRenderer {
  constructor(options = {}) {
    let width;
    let height;
    let halfWidth;
    let halfHeight;
    const state = { objects: new WeakMap() };
    const domElement = options.element === undefined ? document.createElement('div') : options.element;

    domElement.style.overflow = 'hidden';
    this.domElement = domElement;
    this.sortObjects = true;

    this.getSize = function () {
      return { width, height };
    };

    this.render = function (scene, camera) {
      if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
      if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();
      _cssMat.copy(camera.matrixWorldInverse);
      _cssMat2.multiplyMatrices(camera.projectionMatrix, _cssMat);
      renderObject(scene, scene, camera);
      if (this.sortObjects) sortByDepth(scene);
    };

    this.setSize = function (w, h) {
      width = w;
      height = h;
      halfWidth = w / 2;
      halfHeight = h / 2;
      domElement.style.width = w + 'px';
      domElement.style.height = h + 'px';
    };

    /** 递归隐藏不可见子树里的 CSS2D 元素 */
    function hideObject(object) {
      if (object.isCSS2DObject) object.element.style.display = 'none';
      for (let i = 0, n = object.children.length; i < n; i++) hideObject(object.children[i]);
    }

    function renderObject(object, scene, camera) {
      if (object.visible === false) {
        hideObject(object);
        return;
      }
      if (object.isCSS2DObject) {
        _cssVec.setFromMatrixPosition(object.matrixWorld);
        _cssVec.applyMatrix4(_cssMat2);
        const visible = _cssVec.z >= -1 && _cssVec.z <= 1 && object.layers.test(camera.layers) === true;
        const element = object.element;
        element.style.display = visible === true ? '' : 'none';
        if (visible === true) {
          object.onBeforeRender(this, scene, camera);
          element.style.transform =
            `translate(` +
            -100 * object.center.x +
            `%,` +
            -100 * object.center.y +
            `%)translate(` +
            (_cssVec.x * halfWidth + halfWidth) +
            `px,` +
            (-_cssVec.y * halfHeight + halfHeight) +
            `px)`;
          if (element.parentNode !== domElement) domElement.appendChild(element);
          object.onAfterRender(this, scene, camera);
        }
        const entry = { distanceToCameraSquared: getDistanceToSquared(camera, object) };
        state.objects.set(object, entry);
      }
      for (let i = 0, n = object.children.length; i < n; i++) renderObject(object.children[i], scene, camera);
    }

    function getDistanceToSquared(camera, object) {
      _cssVecA.setFromMatrixPosition(camera.matrixWorld);
      _cssVecB.setFromMatrixPosition(object.matrixWorld);
      return _cssVecA.distanceToSquared(_cssVecB);
    }

    function collectVisible(object) {
      const result = [];
      object.traverseVisible(function (child) {
        if (child.isCSS2DObject) result.push(child);
      });
      return result;
    }

    function sortByDepth(scene) {
      const list = collectVisible(scene).sort(function (a, b) {
        return a.renderOrder === b.renderOrder
          ? state.objects.get(a).distanceToCameraSquared - state.objects.get(b).distanceToCameraSquared
          : b.renderOrder - a.renderOrder;
      });
      const len = list.length;
      for (let i = 0, n = list.length; i < n; i++) list[i].element.style.zIndex = len - i;
    }
  }
}

// ── 死亡标记（Lb / DeathMarkers） ─────────────────────────────────────────────

const CROSS_RADIUS = 17; // Nb
const CROSS_THICKNESS = 2.2; // Pb
const CROSS_HEIGHT = 2.7; // Fb（十字离地高度）
const LABEL_HEIGHT = 26; // Ib（名字标签离地高度）

/** 死亡标记集合：十字（3D）+ 名字标签（CSS2D） */
class DeathMarkers {
  constructor(scene, data) {
    this.scene = scene;
    this.group = new Group();
    this.markers = [];
    this.crossGeometry = new CylinderGeometry(CROSS_THICKNESS, CROSS_RADIUS * 2 - CROSS_THICKNESS * 2, 4, 8);
    this.materials = new Map();

    for (const marker of data) this.addMarker(marker);
    scene.add(this.group);
  }

  /** 增量更新标记数据（尽量复用已有对象） */
  setData(data) {
    let commonPrefix = 0;
    while (commonPrefix < this.markers.length && commonPrefix < data.length) {
      const a = this.markers[commonPrefix].data;
      const b = data[commonPrefix];
      if (
        a.startTick !== b.startTick ||
        a.endTick !== b.endTick ||
        a.x !== b.x ||
        a.y !== b.y ||
        a.z !== b.z ||
        a.victimSlot !== b.victimSlot ||
        a.team !== b.team ||
        a.name !== b.name
      ) {
        break;
      }
      commonPrefix++;
    }

    if (commonPrefix < this.markers.length) {
      for (const marker of this.markers) {
        this.group.remove(marker.cross);
        this.scene.remove(marker.label);
        marker.label.element.parentNode?.removeChild(marker.label.element);
      }
      this.markers.length = 0;
      commonPrefix = 0;
    }

    for (let i = commonPrefix; i < data.length; i++) this.addMarker(data[i]);
  }

  addMarker(markerData) {
    const cross = createDeathCross(markerData, this.crossGeometry, this.materialFor(markerData.team));
    cross.visible = false;
    this.group.add(cross);

    const label = new CSS2DObject(createDeathLabel(markerData));
    label.position.set(markerData.x, markerData.y, markerData.z + LABEL_HEIGHT);
    label.visible = false;
    this.scene.add(label);

    this.markers.push({ data: markerData, cross, label });
  }

  /**
   * 更新可见性：tick 在 [startTick, endTick) 内且受害者仍死亡时显示。
   * @param {number} tick 当前 tick
   * @param {Uint8Array} alive 各玩家存活状态
   * @param {boolean} hideLabels 是否隐藏标签（如小地图视角）
   */
  update(tick, alive, hideLabels = false) {
    for (const marker of this.markers) {
      const victimDead = alive[marker.data.victimSlot] === 1;
      const show = tick >= marker.data.startTick && tick < marker.data.endTick && !victimDead;
      marker.cross.visible = show;
      marker.label.visible = show && !hideLabels;
    }
  }

  debugCount() {
    return this.markers.filter((m) => m.cross.visible).length;
  }

  dispose() {
    for (const marker of this.markers) {
      this.scene.remove(marker.label);
      const element = marker.label.element;
      element.parentNode?.removeChild(element);
    }
    this.crossGeometry.dispose();
    this.materials.forEach((material) => material.dispose());
    this.scene.remove(this.group);
  }

  materialFor(team) {
    let material = this.materials.get(team);
    if (!material) {
      material = new MeshBasicMaterial({ color: teamColor(team), transparent: true, opacity: 0.52, depthWrite: false });
      this.materials.set(team, material);
    }
    return material;
  }
}

/** 创建一个死亡十字（两条交叉的柱） */
function createDeathCross(data, geometry, material) {
  const group = new Group();
  group.position.set(data.x, data.y, data.z + CROSS_HEIGHT);
  for (const angle of [-Math.PI / 4, Math.PI / 4]) {
    const bar = new Mesh(geometry, material);
    bar.rotation.z = angle;
    bar.frustumCulled = false;
    group.add(bar);
  }
  return group;
}

/** 创建死亡名字标签 DOM */
function createDeathLabel(data) {
  const wrapper = document.createElement('div');
  wrapper.className = 'death-label';
  wrapper.style.setProperty('--team-color', teamColor(data.team));
  const name = document.createElement('div');
  name.className = 'death-name';
  name.textContent = data.name || 'unknown';
  wrapper.appendChild(name);
  return wrapper;
}

/** 队伍颜色：2=CT(黄)，3=T(蓝)，其他=灰 */
function teamColor(team) {
  return team === 2 ? '#e0a526' : team === 3 ? '#6db3f2' : '#aaaaaa';
}

// ── 轨迹插值辅助 ──────────────────────────────────────────────────────────────

/** 在升序数组中二分查找 <= t 的最大索引 */
function lowerBound(sorted, t) {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi <= 0 || t < sorted[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 求掉落武器在某 tick 的姿势（位置 + 欧拉角），支持短窗口插值。
 * 返回 false 表示该 tick 不在轨迹范围内。
 */
function sampleTrajectory(record, tick, out) {
  if (tick < record.startTick || tick >= record.endTick || record.ticks.length === 0) return false;
  const frame = lowerBound(record.ticks, tick);
  const next = frame + 1;
  let t = 0;
  if (next < record.ticks.length && tick > record.ticks[frame]) {
    const span = record.ticks[next] - record.ticks[frame];
    if (span > 0 && span <= 4) t = Math.min(1, (tick - record.ticks[frame]) / span);
  }

  const positions = record.positions;
  const angles = record.angles;
  const base = frame * 3;

  if (t === 0) {
    out.x = positions[base];
    out.y = positions[base + 1];
    out.z = positions[base + 2];
    out.pitch = angles[base];
    out.yaw = angles[base + 1];
    out.roll = angles[base + 2];
    return true;
  }

  const nxt = next * 3;
  out.x = positions[base] + (positions[nxt] - positions[base]) * t;
  out.y = positions[base + 1] + (positions[nxt + 1] - positions[base + 1]) * t;
  out.z = positions[base + 2] + (positions[nxt + 2] - positions[base + 2]) * t;
  out.pitch = lerpAngle(positions ? angles[base] : 0, angles[nxt], t);
  out.pitch = lerpAngle(angles[base], angles[nxt], t);
  out.yaw = lerpAngle(angles[base + 1], angles[nxt + 1], t);
  out.roll = lerpAngle(angles[base + 2], angles[nxt + 2], t);
  return true;
}

// ── 武器图标映射 ──────────────────────────────────────────────────────────────

/** CS2 显示名 → 图标文件名 */
const WEAPON_DISPLAY_TO_ICON = {
  'AK-47': 'ak47',
  M4A4: 'm4a1',
  'M4A1-S': 'm4a1_silencer',
  AWP: 'awp',
  'SSG 08': 'ssg08',
  FAMAS: 'famas',
  'Galil AR': 'galilar',
  AUG: 'aug',
  'SG 553': 'sg556',
  'MAC-10': 'mac10',
  MP9: 'mp9',
  MP7: 'mp7',
  'MP5-SD': 'mp5sd',
  'PP-Bizon': 'bizon',
  P90: 'p90',
  'UMP-45': 'ump45',
  'Desert Eagle': 'deagle',
  'Glock-18': 'glock',
  'USP-S': 'usp_silencer',
  P2000: 'hkp2000',
  P250: 'p250',
  'Five-SeveN': 'fiveseven',
  'Tec-9': 'tec9',
  'CZ75-Auto': 'cz75a',
  'Dual Berettas': 'elite',
  'R8 Revolver': 'revolver',
  M249: 'm249',
  Negev: 'negev',
  Nova: 'nova',
  XM1014: 'xm1014',
  MAG7: 'mag7',
  'Sawed-Off': 'sawedoff',
  SCAR20: 'scar20',
  G3SG1: 'g3sg1',
  Zeus: 'taser',
  'Zeus x27': 'taser',
  Taser: 'taser',
  'High Explosive Grenade': 'hegrenade',
  Flashbang: 'flashbang',
  'Smoke Grenade': 'smokegrenade',
  Molotov: 'molotov',
  'Incendiary Grenade': 'incgrenade',
  'Decoy Grenade': 'decoy',
  'C4 Explosive': 'c4',
  Healthshot: 'healthshot',
  knife: 'knife',
  knife_t: 'knife_t',
  Bayonet: 'bayonet',
  'Bowie Knife': 'knife_survival_bowie',
  'Butterfly Knife': 'knife_butterfly',
  'Survival Knife': 'knife_canis',
  'Paracord Knife': 'knife_cord',
  'Classic Knife': 'knife_css',
  'Falchion Knife': 'knife_falchion',
  'Flip Knife': 'knife_flip',
  'Gut Knife': 'knife_gut',
  Karambit: 'knife_karambit',
  'Kukri Knife': 'knife_kukri',
  'M9 Bayonet': 'knife_m9_bayonet',
  'Navaja Knife': 'knife_gypsy_jackknife',
  'Nomad Knife': 'knife_outdoor',
  'Shadow Daggers': 'knife_push',
  'Skeleton Knife': 'knife_skeleton',
  'Stiletto Knife': 'knife_stiletto',
  'Huntsman Knife': 'knife_tactical',
  'Talon Knife': 'knife_widowmaker',
  'Ursus Knife': 'knife_ursus',
};

/** 图标文件名里的「刀」集合 */
const KNIFE_ICONS = new Set(Object.values(WEAPON_DISPLAY_TO_ICON).filter((name) => /^(knife|bayonet)/.test(name)));

/** 内部武器名（去 weapon_ 前缀后）→ 图标文件名 */
const WEAPON_INTERNAL_TO_ICON = {
  ak47: 'ak47',
  m4a1: 'm4a1',
  m4a1_silencer: 'm4a1_silencer',
  awp: 'awp',
  ssg08: 'ssg08',
  famas: 'famas',
  galilar: 'galilar',
  aug: 'aug',
  sg556: 'sg556',
  mac10: 'mac10',
  mp9: 'mp9',
  mp7: 'mp7',
  mp5sd: 'mp5sd',
  bizon: 'bizon',
  p90: 'p90',
  ump45: 'ump45',
  deagle: 'deagle',
  glock: 'glock',
  usp_silencer: 'usp_silencer',
  hkp2000: 'hkp2000',
  p250: 'p250',
  fiveseven: 'fiveseven',
  tec9: 'tec9',
  cz75a: 'cz75a',
  elite: 'elite',
  revolver: 'revolver',
  m249: 'm249',
  negev: 'negev',
  nova: 'nova',
  xm1014: 'xm1014',
  mag7: 'mag7',
  sawedoff: 'sawedoff',
  scar20: 'scar20',
  g3sg1: 'g3sg1',
  taser: 'taser',
  hegrenade: 'hegrenade',
  flashbang: 'flashbang',
  smokegrenade: 'smokegrenade',
  molotov: 'molotov',
  incgrenade: 'incgrenade',
  inferno: 'molotov',
  decoy: 'decoy',
  knife: 'knife',
  knife_t: 'knife_t',
  c4: 'c4',
  healthshot: 'healthshot',
};

/** 手榴弹 kind → 图标文件名 */
const GRENADE_KIND_TO_ICON = { smoke: 'smokegrenade', flash: 'flashbang', he: 'hegrenade', molotov: 'molotov', decoy: 'decoy' };

/** 装备 kind → 图标文件名 */
const EQUIPMENT_KIND_TO_ICON = { armor: 'armor', armorHelmet: 'armor_helmet', defuser: 'defuser' };

function weaponIconUrl(file) {
  return `/icons/weapons/${file}.svg`;
}

/** 根据武器名解析图标 URL（null 表示无图标） */
function resolveWeaponIconUrl(name) {
  if (!name) return null;
  const direct = WEAPON_DISPLAY_TO_ICON[name];
  if (direct) return weaponIconUrl(direct);
  const internal = name.replace(/^weapon_/, '').toLowerCase();
  const mapped = WEAPON_INTERNAL_TO_ICON[internal];
  if (mapped) return weaponIconUrl(mapped);
  if (KNIFE_ICONS.has(internal)) return weaponIconUrl(internal);
  if (/knife|bayonet|karambit|dagger/i.test(name)) return weaponIconUrl('knife');
  return null;
}

/** 直接根据图标文件名生成 URL */
function iconUrl(file) {
  return weaponIconUrl(file);
}

// ── 掉落武器（ox / DroppedWeapons） ───────────────────────────────────────────

const ICON_SCALE = 0.36; // Qb —— 图标世界尺寸缩放
const ICON_PIXEL_SCALE = 4; // $b —— 图标像素放大倍数
const ICON_OUTLINE_PX = 1.25; // ex —— 描边宽度（像素）
const ICON_LIFT = 1; // tx —— 图标离地高度
const OUTLINE_COLOR = '#ececec'; // nx —— 描边颜色（浅色）
const SHADOW_COLOR = 'rgba(8, 10, 12, 0.9)'; // rx —— 阴影颜色
const DEG2RAD = Math.PI / 180;
const MODEL_LIFT = 6; // ax —— 模型离地高度

/** 掉落武器渲染：图标（带描边）或真实 3D 模型 */
class DroppedWeapons {
  constructor(scene, data, lighting) {
    this.scene = scene;
    this.lighting = lighting;
    this.modelMaterial = lighting.createMaterial({ surface: 'vertex' });
    this.geometry = new PlaneGeometry(1, 1);
    this.geometry.rotateX(Math.PI / 2);
    this.setData(data);
    scene.add(this.group);
  }

  setData(data) {
    let index = 0;
    for (const weapon of data) {
      const iconUrl = resolveWeaponIconUrl(weapon.weapon);
      const model = this.modelFor(weapon.weapon);
      if (!iconUrl && !model) continue;
      const icon = iconUrl ? this.iconFor(iconUrl) : null;
      const drop = this.drops[index];
      if (drop) {
        drop.data = weapon;
        drop.icon = icon;
        drop.model = model;
      } else {
        const mesh = new Mesh(this.geometry, this.modelMaterial);
        mesh.rotation.order = 'ZYX';
        mesh.visible = false;
        mesh.frustumCulled = false;
        const entry = { data: weapon, mesh, icon, model, light: createLightSample(), litAt: new Vector3(), litVersion: -1 };
        mesh.onBeforeRender = (renderer, scene, camera, geometry, material) => {
          if (material === this.modelMaterial) {
            applyLightSample(this.modelMaterial.uniforms, entry.light);
            this.modelMaterial.uniformsNeedUpdate = true;
          }
        };
        this.group.add(mesh);
        this.drops.push(entry);
      }
      index++;
    }
    for (let i = index; i < this.drops.length; i++) this.group.remove(this.drops[i].mesh);
    this.drops.length = index;
  }

  setModelsEnabled(enabled) {
    this.modelsEnabled = enabled;
    if (enabled) for (const model of this.models.values()) this.requestModel(model);
  }

  update(tick) {
    const pose = this.pose;
    for (const drop of this.drops) {
      const { mesh, icon } = drop;
      const modelGeometry = this.modelsEnabled ? (drop.model?.geometry ?? null) : null;
      if ((modelGeometry === null && (icon === null || icon.width <= 0)) || !sampleTrajectory(drop.data, tick, pose)) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.rotation.set(pose.roll * DEG2RAD, pose.pitch * DEG2RAD, pose.yaw * DEG2RAD);
      if (modelGeometry) {
        mesh.geometry = modelGeometry;
        mesh.material = this.modelMaterial;
        mesh.renderOrder = 0;
        mesh.position.set(pose.x, pose.y, pose.z);
        mesh.scale.set(1, 1, 1);
        if (drop.litVersion !== this.lighting.version || !drop.litAt.equals(mesh.position)) {
          drop.litAt.copy(mesh.position);
          drop.litVersion = this.lighting.version;
          this.lighting.sample(pose.x, pose.y, pose.z + MODEL_LIFT, drop.light);
        }
      } else if (icon) {
        mesh.geometry = this.geometry;
        mesh.material = icon.material;
        mesh.renderOrder = 1;
        mesh.position.set(pose.x, pose.y, pose.z + ICON_LIFT);
        mesh.scale.set(icon.width, 1, icon.height);
      }
    }
  }

  debugCount() {
    return this.drops.filter((d) => d.mesh.visible).length;
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    this.geometry.dispose();
    this.modelMaterial.dispose();
    for (const icon of this.icons.values()) {
      icon.material.dispose();
      icon.texture?.dispose();
    }
    this.icons.clear();
    for (const model of this.models.values()) model.geometry?.dispose();
    this.models.clear();
    this.drops.length = 0;
  }

  modelFor(weaponName) {
    const file = resolveWeaponModelFile(weaponName);
    if (!file) return null;
    let model = this.models.get(file);
    if (model) return model;
    model = { file, requested: false, geometry: null };
    this.models.set(file, model);
    if (this.modelsEnabled) this.requestModel(model);
    return model;
  }

  requestModel(model) {
    if (model.requested) return;
    model.requested = true;
    loadWorldModel(`world`, model.file)
      .then((geometry) => {
        if (this.disposed) geometry.dispose();
        else model.geometry = geometry;
      })
      .catch((err) => console.warn(`[csplayer] dropped weapon model ${model.file} failed to load`, err));
  }

  iconFor(url) {
    let icon = this.icons.get(url);
    if (icon) return icon;
    const material = new MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.05,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    icon = { material, texture: null, width: 0, height: 0 };
    this.icons.set(url, icon);

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (this.disposed) return;
      const canvas = buildOutlinedIcon(image);
      if (!canvas) return;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 4;
      material.map = texture;
      material.needsUpdate = true;
      icon.texture = texture;
      const scale = 1 / ICON_PIXEL_SCALE;
      icon.width = canvas.width * scale * ICON_SCALE;
      icon.height = canvas.height * scale * ICON_SCALE;
    };
    image.src = url;
    return icon;
  }
}

/**
 * 给武器图标加描边 + 阴影，生成一张更大的 canvas。
 * 先画一圈阴影（深色描边），再叠一圈浅色描边，最后画本体。
 */
function buildOutlinedIcon(image) {
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  if (!srcW || !srcH) return null;

  const pad = Math.ceil(ICON_OUTLINE_PX * ICON_PIXEL_SCALE) + 1;
  const w = Math.ceil(srcW * ICON_PIXEL_SCALE);
  const h = Math.ceil(srcH * ICON_PIXEL_SCALE);

  const tint = (color) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return canvas;
  };

  const out = document.createElement('canvas');
  out.width = w + pad * 2;
  out.height = h + pad * 2;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  const shadow = tint(SHADOW_COLOR);
  const radius = ICON_OUTLINE_PX * ICON_PIXEL_SCALE;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    ctx.drawImage(shadow, pad + Math.cos(angle) * radius, pad + Math.sin(angle) * radius);
  }
  ctx.drawImage(tint(OUTLINE_COLOR), pad, pad);
  return out;
}

// ── 三角形网格（wx / TriangleGrid） ───────────────────────────────────────────

const TRIANGLE_AREA_EPSILON = 0.001; // Cx —— 忽略面积过小的三角形

/**
 * 基于空间哈希的三角形网格，用于快速的「点在哪个三角形上」/碰撞查询。
 * 把三角形按包围盒分桶到均匀网格，查询时只检查附近桶。
 */
class TriangleGrid {
  constructor(triangles, cellSize = 32) {
    this.triangles = triangles;
    this.cell = cellSize;
    this.cells = new Map();
    this.query = 0;

    const triCount = triangles.length / 9;
    this.stamp = new Uint32Array(triCount);

    for (let tri = 0; tri < triCount; tri++) {
      const base = tri * 9;
      if (triangleArea2D(triangles, base) < TRIANGLE_AREA_EPSILON) continue;

      const minX = Math.min(triangles[base], triangles[base + 3], triangles[base + 6]);
      const minY = Math.min(triangles[base + 1], triangles[base + 4], triangles[base + 7]);
      const minZ = Math.min(triangles[base + 2], triangles[base + 5], triangles[base + 8]);
      const maxX = Math.max(triangles[base], triangles[base + 3], triangles[base + 6]);
      const maxY = Math.max(triangles[base + 1], triangles[base + 4], triangles[base + 7]);
      const maxZ = Math.max(triangles[base + 2], triangles[base + 5], triangles[base + 8]);

      for (let cx = Math.floor(minX / cellSize); cx <= Math.floor(maxX / cellSize); cx++) {
        for (let cy = Math.floor(minY / cellSize); cy <= Math.floor(maxY / cellSize); cy++) {
          for (let cz = Math.floor(minZ / cellSize); cz <= Math.floor(maxZ / cellSize); cz++) {
            const key = cellKey(cx, cy, cz);
            const bucket = this.cells.get(key);
            if (bucket) bucket.push(tri);
            else this.cells.set(key, [tri]);
          }
        }
      }
    }
  }

  /** 查询与给定 AABB 相交的三角形，写入 out 数组，返回命中数（去重） */
  near(minX, minY, minZ, maxX, maxY, maxZ, out) {
    const cell = this.cell;
    const stamp = ++this.query;
    let count = 0;
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
      for (let cy = Math.floor(minY / cell); cy <= Math.floor(maxY / cell); cy++) {
        for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
          const bucket = this.cells.get(cellKey(cx, cy, cz));
          if (bucket) {
            for (const tri of bucket) {
              if (this.stamp[tri] !== stamp) {
                this.stamp[tri] = stamp;
                if (count < out.length) out[count] = tri;
                count++;
              }
            }
          }
        }
      }
    }
    return count;
  }
}

/** 三角形在 XZ 平面的面积（用于跳过退化三角形） */
function triangleArea2D(tri, base) {
  const ax = tri[base];
  const az = tri[base + 2];
  const bx = tri[base + 3];
  const bz = tri[base + 5];
  const cx = tri[base + 6];
  const cz = tri[base + 8];
  return Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * 0.5;
}

/** 网格单元 key（偏移 1024 避免负坐标） */
function cellKey(cx, cy, cz) {
  return ((cx + 1024) * 2048 + (cy + 1024)) * 2048 + (cz + 1024);
}
