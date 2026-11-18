// =============================================================================
// player/entity-renderer.js —— 回放实体层（P2 玩家 + P4a 短命实体）
//
// 玩家：胶囊体（CS2 hull 半径 16、站高 72）+ 朝向杆；队色；alive=false 隐藏。
// 短命实体（每拍 diff 增删）：
//   - 掉落武器（kind=1）：地面小暗色块
//   - 投掷物（kind=2）：移动小球（按 GrenadeKind 着色）+ 轨迹线；
//     smoke 落点画半透明球（effectRadius），molotov 画火区
//   - C4（kind=3）：红色块，Planted 后闪烁；倒计时数字后续接 HUD
//
// 投掷物静态轨迹走 World "grenadePaths" 通道（spec 不随 tick 变，集合变化时拉取），
// 其余数据全部来自 playback-feed 的 snapshot（native SnapshotAt 现读）。
//
// 坐标约定（实测确认）：场景是 Z-up（camera.up=(0,0,1)，CS2 chunk 顶点直通），
// demo 快照的 Source 坐标 (x 水平, y 水平, z 高度) 直通放入场景，无需 swizzle。
// 朝向：Source yaw（度）绕 z 轴，yaw=0 指向 +x。
// =============================================================================

import {
  Group, Mesh, MeshLambertMaterial, MeshBasicMaterial, BoxGeometry,
  CapsuleGeometry, SphereGeometry, Line, LineBasicMaterial, BufferGeometry,
  BufferAttribute, Color,
} from './vendor/three-bundle.js';

const DOUBLE_SIDE = 2; // THREE.DoubleSide（bundle 裁剪版未导出常量，直接用数值）

const TEAM_COLORS = { 1: 0x6db3f2, 2: 0xe0a526, 0: 0x9aa0a8 }; // 1=CT 2=T 0=None
const HULL_RADIUS = 16;
const HULL_HEIGHT = 72;

// GrenadeKind：0 HE 1 Flash 2 Smoke 3 Molotov 4 Decoy
const GRENADE_COLORS = { 0: 0xcc4433, 1: 0xf0f0c0, 2: 0xbfd8c8, 3: 0xe08030, 4: 0x8a8a8a };
const SMOKE_COLOR = 0xc8d4cc;
const FIRE_COLOR = 0xe06a20;
const C4_COLOR = 0x30242a;
const WEAPON_COLOR = 0x3a3f45;

// GrenadeKind → 子类型名（title 提示用）
const GRENADE_NAMES = { 0: 'HE', 1: 'Flash', 2: 'Smoke', 3: 'Molotov', 4: 'Decoy' };

/**
 * 创建实体层。
 * @param {object} opts
 * @param {() => Promise<object>} [opts.loadGrenadePaths] 拉取投掷物静态轨迹的懒加载器
 * @returns {{ group: object, update(snap: object): void, dispose(): void }}
 */
export function createEntityLayer({ loadGrenadePaths } = {}) {
  const group = new Group();
  group.name = 'demo-entities';

  // ---------------------------------------------------------------- 玩家（P2）
  const bodyGeo = new CapsuleGeometry(HULL_RADIUS, HULL_HEIGHT - HULL_RADIUS * 2);
  const pointerGeo = new BoxGeometry(HULL_RADIUS * 2 + 14, 5, 5);
  const materials = new Map();
  const byId = new Map();

  function material(team) {
    if (!materials.has(team)) {
      const color = TEAM_COLORS[team] ?? TEAM_COLORS[0];
      materials.set(team, new MeshLambertMaterial({
        color,
        emissive: new Color(color).multiplyScalar(0.35), // 烘焙光照采样前的自发光兜底
      }));
    }
    return materials.get(team);
  }

  function create(player) {
    const g = new Group();
    const m = material(player.team);
    const body = new Mesh(bodyGeo, m);
    body.rotation.x = Math.PI / 2;        // 胶囊长轴沿 z（场景 Z-up）
    body.position.z = HULL_HEIGHT / 2;
    const pointer = new Mesh(pointerGeo, m);
    pointer.position.x = HULL_RADIUS + 10; // 朝向杆：静止指向 +x，按 yaw 旋转
    pointer.position.z = HULL_HEIGHT / 2;
    g.add(body, pointer);
    g.visible = false;
    group.add(g);
    return { group: g, pointer };
  }

  function updatePlayers(snap) {
    const seen = new Set();
    for (const p of snap.players) {
      seen.add(p.id);
      let e = byId.get(p.id);
      if (!e) {
        e = create(p);
        byId.set(p.id, e);
      }
      e.group.position.set(p.pos[0], p.pos[1], 0);
      e.pointer.rotation.z = (p.view?.[1] ?? 0) * (Math.PI / 180); // yaw 度 → rad
      e.group.visible = p.alive;
    }
    // 名册里消失的玩家（未连接/退场）保持隐藏
    for (const [id, e] of byId) {
      if (!seen.has(id)) e.group.visible = false;
    }
  }

  // ------------------------------------------------- 短命实体（P4a，每拍 diff）

  const dyn = new Group();       // 全部短命实体
  dyn.name = 'demo-dyn';
  group.add(dyn);

  const weaponGeo = new BoxGeometry(28, 7, 5);   // 掉落武器：地面长条
  const grenadeGeo = new SphereGeometry(7, 10, 8);
  const c4Geo = new BoxGeometry(22, 14, 8);
  const dynMaterials = new Map();

  function dynMaterial(key, opts) {
    if (!dynMaterials.has(key)) dynMaterials.set(key, opts());
    return dynMaterials.get(key);
  }

  // 实体 id → 渲染对象。trail: 轨迹 Line；smokeBall / fireMesh：区域效果
  const dynById = new Map();
  // 投掷物静态轨迹缓存（entityId → spec），集合变化时整体重拉
  let pathCache = null;
  let pathCacheKey = '';

  function addTrail(id, spec) {
    const pts = spec.trajectory ?? [];
    if (pts.length < 2) return null;
    const arr = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      arr[i * 3] = pts[i][0];
      arr[i * 3 + 1] = pts[i][1];
      arr[i * 3 + 2] = pts[i][2];
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(arr, 3));
    const mat = new LineBasicMaterial({
      color: GRENADE_COLORS[spec.sub] ?? 0x888888,
      transparent: true,
      opacity: 0.55,
    });
    const line = new Line(geo, mat);
    dyn.add(line);
    return line;
  }

  /** smoke 落点半透明球（半径 = effectRadius，高度压扁一点模拟云团）。 */
  function addSmokeBall(id, spec) {
    const r = spec.radius || 144;
    const end = spec.trajectory?.[spec.trajectory.length - 1];
    if (!end) return null;
    const geo = new SphereGeometry(r, 16, 12);
    const mat = dynMaterial(`smoke${id}`, () => new MeshBasicMaterial({
      color: SMOKE_COLOR, transparent: true, opacity: 0.38, depthWrite: false,
    }));
    const ball = new Mesh(geo, mat);
    ball.position.set(end[0], end[1], Math.max(r * 0.6, end[2] + r * 0.5));
    ball.scale.z = 0.72; // Z-up：云团压扁
    dyn.add(ball);
    return ball;
  }

  /** molotov 火区：fireArea 顶点做三角扇（顶点序由 native 给出）。 */
  function addFireArea(id, spec) {
    const pts = spec.fireArea ?? [];
    if (pts.length < 3) return null;
    // 三角扇：pts[0] 为扇心，与相邻顶点连成三角形（bundle 无 ShapeGeometry，手写索引）
    const positions = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      positions[i * 3] = pts[i][0];
      positions[i * 3 + 1] = pts[i][1];
      positions[i * 3 + 2] = pts[i][2];
    }
    const indices = [];
    for (let i = 1; i < pts.length - 1; i++) indices.push(0, i, i + 1);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mat = dynMaterial(`fire${id}`, () => new MeshBasicMaterial({
      color: FIRE_COLOR, transparent: true, opacity: 0.5, side: DOUBLE_SIDE, depthWrite: false,
    }));
    const mesh = new Mesh(geo, mat);
    mesh.position.z = 1.5; // 贴地面略抬（Z-up：地面是 z 平面）
    dyn.add(mesh);
    return mesh;
  }

  function createDyn(e) {
    const g = new Group();
    if (e.kind === 1) { // 掉落武器
      const m = new Mesh(weaponGeo, dynMaterial('weapon', () => new MeshLambertMaterial({ color: WEAPON_COLOR })));
      m.rotation.z = Math.PI / 6;
      g.add(m);
    } else if (e.kind === 2) { // 投掷物
      const sub = e.grenade?.sub ?? 0;
      const m = new Mesh(grenadeGeo, dynMaterial(`gren${sub}`, () => new MeshBasicMaterial({
        color: GRENADE_COLORS[sub] ?? 0x888888,
      })));
      m.userData.kindName = GRENADE_NAMES[sub] ?? '?';
      g.add(m);
      // 轨迹/烟球/火区（需要静态 spec；pathCache 未就绪时由 ensurePaths 补）
      const spec = pathCache?.[String(e.id)];
      if (spec) attachSpec(g, e.id, spec);
    } else if (e.kind === 3) { // C4
      const m = new Mesh(c4Geo, dynMaterial('c4', () => new MeshLambertMaterial({
        color: C4_COLOR, emissive: new Color(0xff2020).multiplyScalar(0.4),
      })));
      m.userData.c4 = e.c4 ?? null;
      g.add(m);
    }
    g.visible = false;
    dyn.add(g);
    return { group: g, extras: [] };
  }

  /** 把静态 spec 的可视化（轨迹/烟球/火区）挂到实体组，登记到 extras 便于统一移除。 */
  function attachSpec(entry, id, spec) {
    if (entry.extras.length) return;
    const trail = addTrail(id, spec);
    if (trail) entry.extras.push(trail);
    if (spec.sub === 2) {
      const ball = addSmokeBall(id, spec);
      if (ball) entry.extras.push(ball);
    } else if (spec.sub === 3) {
      const fire = addFireArea(id, spec);
      if (fire) entry.extras.push(fire);
    }
  }

  /** 投掷物集合变化 → 重拉 grenadePaths 并给已存在的实体补挂可视化。 */
  function ensurePaths(entities) {
    const key = entities
      .filter((e) => e.kind === 2)
      .map((e) => e.id).sort().join(',');
    if (!key) { pathCache = null; pathCacheKey = ''; return Promise.resolve(); }
    if (key === pathCacheKey) return Promise.resolve();
    pathCacheKey = key;
    if (!loadGrenadePaths) return Promise.resolve();
    return loadGrenadePaths().then((paths) => {
      pathCache = paths;
      for (const [id, entry] of dynById) {
        const spec = paths?.[String(id)];
        if (spec) attachSpec(entry, id, spec);
      }
    }).catch(() => { /* 轨迹拉取失败不影响移动点渲染 */ });
  }

  function updateDyn(snap) {
    const entities = snap.entities ?? [];
    ensurePaths(entities);
    const seen = new Set();
    for (const e of entities) {
      seen.add(e.id);
      let entry = dynById.get(e.id);
      if (!entry) {
        entry = createDyn(e);
        dynById.set(e.id, entry);
        // createDyn 时 pathCache 可能已就绪（ensurePaths 先跑）但异步竞态下也可能没挂上
        if (e.kind === 2) {
          const spec = pathCache?.[String(e.id)];
          if (spec) attachSpec(entry, e.id, spec);
        }
      }
      entry.group.position.set(e.pos[0], e.pos[1], e.pos[2]);
      entry.group.visible = true;
      // C4 Planted 闪烁：爆红亮度按节拍脉动
      if (e.kind === 3) {
        const mesh = entry.group.children[0];
        if (mesh?.userData.c4) mesh.userData.c4 = e.c4;
        const planted = (e.c4?.status ?? 0) === 2;
        if (mesh?.material?.emissive) {
          mesh.material.emissive.setHex(0xff2020);
          mesh.material.emissive.multiplyScalar(
            planted ? 0.6 + 0.4 * Math.abs(Math.sin(snap.tick / 8)) : 0.4);
        }
      }
    }
    // 消失的实体：连 extras 一起移除并释放几何
    for (const [id, entry] of dynById) {
      if (seen.has(id)) continue;
      dyn.remove(entry.group);
      for (const ex of entry.extras) {
        dyn.remove(ex);
        ex.geometry?.dispose();
        if (ex.material?.userData?.shared !== true) ex.material?.dispose?.();
      }
      dynById.delete(id);
    }
  }

  /** 用一帧快照更新玩家 + 短命实体。 */
  function update(snap) {
    updatePlayers(snap);
    updateDyn(snap);
  }

  function dispose() {
    for (const e of byId.values()) group.remove(e.group);
    byId.clear();
    for (const [, entry] of dynById) {
      for (const ex of entry.extras) { ex.geometry?.dispose(); ex.material?.dispose?.(); }
    }
    dynById.clear();
    bodyGeo.dispose();
    pointerGeo.dispose();
    weaponGeo.dispose();
    grenadeGeo.dispose();
    c4Geo.dispose();
    for (const m of materials.values()) m.dispose();
    materials.clear();
    for (const m of dynMaterials.values()) m.dispose();
    dynMaterials.clear();
    group.parent?.remove(group);
  }

  return { group, update, dispose };
}
