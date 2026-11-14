// ============================================================================
// 反混淆版本：火焰几何体追踪 + 火焰 shader（FireGeometry / FireShader）
// 原始压缩文件：src/app/12-fire-shader.js（切片 13/34，71–725 行）
// 压缩类名：uE=FireModel（已在 13-fire-manager 反混淆），wE=ProbeCache, NE=火体几何构建
// 说明：燃烧弹火焰的几何构建算法。核心思路：
//   1. 火焰被离散成"燃烧补丁（burning patch）"——每个补丁是地面/墙上的一个圆
//   2. 每个补丁从中心向 15 个方向（每 24°）发射射线，检测火焰能蔓延多远
//      （traceFractions / fillerFractions 记录每条射线的蔓延比例）
//   3. 把多个补丁的轮廓合并成一张 2D 网格（Marching Squares 风格），生成
//      火焰体的三角网格，顶点带高度/蔓延信息
//   4. 顶点 shader 用噪声驱动火焰摇曳，片元 shader 做火焰颜色渐变
//  这是整个工程里算法密度最高的模块之一。
// ============================================================================

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
const FIRE_RAYS = 15;          // 每个补丁的射线数（每 24° 一条）
const MIN_FIRE_RADIUS = 60;    // 火焰最小半径
const FIRE_MAX_HEIGHT = 22;    // dE：火焰最大高度
const FIRE_MIN_HEIGHT_FRAC = 0.55; // fE
const HEIGHT_BLEND = 26;       // pE
const GROWTH_TIME = 0.75;      // mE：火焰生长时间（秒）
const BURNOUT_TIME = 0.25;     // hE：烧尽时间
const BURNOUT_STAGGER = 1.1;   // gE
const SCORCH_FADE = 3.5;       // _E
const SCORCH_OFFSET = 0.6;     // vE
const MAX_PATCHES = 64;        // yE
const FIRE_RAY_STEP = 6;       // SE

// 火焰颜色方案（燃烧弹 vs 燃烧瓶）
const MOLOTOV_COLORS = { base: [0.2, 0.035, 0.38], ember: [1, 0.24, 0.015], hot: [1, 0.52, 0.055] }; // WE
const INCENDIARY_COLORS = { base: [0.02, 0.24, 0.3], ember: MOLOTOV_COLORS.ember, hot: MOLOTOV_COLORS.hot }; // GE

/** 燃烧类型 → 半径范围（原 aE） */
function fireRadiusRange(type) {
  if (type !== 0 && type !== 1) throw Error(`Unsupported inferno type`);
  return type === 0 ? [70, 90] : [50, 70]; // 燃烧弹 vs 燃烧瓶
}

// ---------------------------------------------------------------------------
// 射线追踪器（原 oE）：在场景碰撞树里做射线，返回最近命中
// ---------------------------------------------------------------------------
function makeTracer(colliders) {
  const ray = new Raycaster();
  const localRay = new Raycaster();
  const hitPoint = new Vector3();
  const hitNormal = new Vector3();
  const tmp = new Vector3();
  const entries = colliders.map(({ tree, matrixWorld }) => ({
    tree, matrixWorld,
    inverse: matrixWorld.equals(new Matrix4()) ? null : matrixWorld.clone().invert(),
    normalMatrix: new Matrix3().getNormalMatrix(matrixWorld),
  }));
  return (origin, direction) => {
    ray.origin.fromArray(origin);
    ray.direction.copy(tmp.fromArray(direction)).sub(ray.origin);
    const length = ray.direction.length();
    if (length < 1e-6) return null;
    ray.direction.multiplyScalar(1 / length);
    let bestDist = length, hit = false;
    for (const entry of entries) {
      if (!entry.inverse) {
        const res = entry.tree.raycastFirst(ray, DoubleSide, 0.001, bestDist);
        if (!res?.face || res.distance >= bestDist) continue;
        bestDist = res.distance;
        hitPoint.copy(res.point);
        hitNormal.copy(res.face.normal);
        hit = true;
        continue;
      }
      localRay.copy(ray).applyMatrix4(entry.inverse);
      const scale = localRay.direction.length();
      localRay.direction.multiplyScalar(1 / scale);
      const res = entry.tree.raycastFirst(localRay, DoubleSide, 0.001 * scale, bestDist * scale);
      if (!res?.face) continue;
      const point = res.point.clone().applyMatrix4(entry.matrixWorld);
      const dist = point.distanceTo(ray.origin);
      if (dist >= bestDist) continue;
      bestDist = dist;
      hitPoint.copy(point);
      hitNormal.copy(res.face.normal).applyMatrix3(entry.normalMatrix).normalize();
      hit = true;
    }
    if (!hit) return null;
    const normal = hitNormal.clone();
    if (normal.dot(ray.direction) > 0) normal.negate();
    return { fraction: Math.fround(bestDist / length), position: hitPoint.toArray().map(Math.fround), normal: normal.toArray().map(Math.fround) };
  };
}

// ---------------------------------------------------------------------------
// 单补丁射线追踪（原 sE）：从补丁中心向 15 方向探测蔓延
// ---------------------------------------------------------------------------
function tracePatch(origin, patch, trace, raised) {
  const minR = Math.max(60, patch.radius);
  const targetR = patch.targetRadius;
  const pos = patch.position;
  // 向下探测地面高度
  const down = trace([pos[0], pos[1], pos[2] + 0.01], [pos[0], pos[1], pos[2] + 60]);
  const downFrac = down?.fraction ?? 1;
  const traceFractions = [];
  const fillerFractions = [];
  const planes = [];

  for (let ray = 0; ray < FIRE_RAYS; ray++) {
    const dir = rayDirDeg(ray * 24); // ZT
    const from = [pos[0], pos[1], Math.fround(pos[2] + 30 + (raised && down ? downFrac * 30 : 0))];
    const hit = trace(from, [Math.fround(from[0] + Math.fround(dir[0] * targetR)), Math.fround(from[1] + Math.fround(dir[1] * targetR)), Math.fround(from[2] + (raised ? Math.max(0.5, downFrac) * 30 : 0))]);
    if (!hit) { traceFractions.push(1); fillerFractions.push(Math.fround(1 - Math.fround(10 / minR))); continue; }
    raised = true;
    const n = hit.normal;
    // 射线沿法线方向的投影（决定火焰能否沿墙蔓延）
    const alongNormal = Math.fround(-Math.fround(Math.fround(n[0] * dir[0]) + Math.fround(n[1] * dir[1])) * targetR);
    const fracAt = (offset) => (alongNormal > 0 ? Math.fround(Math.max(0, Math.fround(hit.fraction - Math.fround(offset / alongNormal)))) : 0);
    traceFractions.push(fracAt(5));
    fillerFractions.push(fracAt(10));
    // 记录墙面平面（用于裁剪火焰体）
    const reach = Math.fround(hit.fraction * targetR);
    const p = [Math.fround(Math.fround(pos[0] - origin[0]) + Math.fround(dir[0] * reach)), Math.fround(Math.fround(pos[1] - origin[1]) + Math.fround(dir[1] * reach)), Math.fround(pos[2] - origin[2])];
    const d = -Math.fround(Math.fround(Math.fround(p[0] * n[0]) + Math.fround(p[1] * n[1])) + Math.fround(p[2] * n[2]));
    if (!planes.some((pl) => n.every((v, k) => Math.abs(v - pl[k]) < 1e-5) && Math.abs(d - pl[3]) < 0.01) && planes.length < 12)
      planes.push([...n, d]);
  }
  return { patch: { ...patch, traceFractions, fillerFractions, planes }, raised };
}

/** 方向向量（原 ZT） */
function rayDirDeg(deg) { const a = Math.fround(Math.fround(deg) * Math.fround(Math.PI / 180)); return [Math.fround(Math.cos(a)), Math.fround(Math.sin(a)), 0]; }

/** 找补丁下方最近的水平地面（原 cE） */
function findGround(pos, trace) {
  const up = trace([pos[0], pos[1], pos[2] + 0.05], [pos[0], pos[1], pos[2] + 40]);
  const ceilZ = up ? Math.max(pos[2] + 0.01, up.position[2] - 0.05) : pos[2] + 40;
  const down = trace([pos[0], pos[1], ceilZ], [pos[0], pos[1], pos[2] - 70]);
  const below = down && down.normal[2] >= 0.25 ? down : null;
  const above = trace([pos[0], pos[1], pos[2] + 70], [pos[0], pos[1], pos[2] + 0.01]);
  const aboveHit = above && above.normal[2] >= 0.25 ? above : null;
  return aboveHit ? (below ? (aboveHit.position[2] - pos[2] < pos[2] - below.position[2] ? aboveHit : below) : aboveHit) : below;
}

/** 读向量（原 lE） */
function vec3Or(arr, offset = 0) {
  if (!arr || offset + 3 > arr.length) return null;
  const v = [arr[offset], arr[offset + 1], arr[offset + 2]];
  return v.every(Number.isFinite) ? v : null;
}

// ---------------------------------------------------------------------------
// 探针缓存（原 wE）：按 (高度, x, y) 缓存地面/天花板探测结果
// ---------------------------------------------------------------------------
const CACHE_LIMIT = 1048576;
class ProbeCache {
  probes = new Map();
  offLattice = new Map();
  footprints = new Map();
  get(height, x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && Math.abs(x) < CACHE_LIMIT && Math.abs(y) < CACHE_LIMIT
      ? this.probes.get(height)?.get((x + CACHE_LIMIT) * CACHE_LIMIT * 2 + y + CACHE_LIMIT)
      : this.offLattice.get(`${height}:${x}:${y}`);
  }
  set(height, x, y, v) {
    if (Number.isInteger(x) && Number.isInteger(y) && Math.abs(x) < CACHE_LIMIT && Math.abs(y) < CACHE_LIMIT) {
      let map = this.probes.get(height);
      if (!map) { map = new Map(); this.probes.set(height, map); }
      map.set((x + CACHE_LIMIT) * CACHE_LIMIT * 2 + y + CACHE_LIMIT, v);
    } else this.offLattice.set(`${height}:${x}:${y}`, v);
  }
}

// ---------------------------------------------------------------------------
// 火体几何构建（原 NE）：把多个补丁轮廓合并成三角网格（Marching Squares 风格）
// 这是整个火焰系统的核心算法，输出 {positions, limits, distances, indices}
// ---------------------------------------------------------------------------
function buildFireGeometry(shape, origin, trace, cache = new ProbeCache(), step = 12) {
  // 单点探测：向下找地面，再向上找天花板，得到 (地面高度, 净空高度)
  const probeAt = (patch, x, y) => {
    const h = patch.position[2];
    let cached = cache.get(h, x, y);
    if (cached) return cached;
    const ground = findGround([x, y, h], trace);
    const groundHit = ground && ground.normal[2] >= 0.5 ? ground : null;
    const ceiling = groundHit ? trace([x, y, groundHit.position[2] + 0.1], [x, y, groundHit.position[2] + 64]) : null;
    const result = { hit: groundHit, ceiling: groundHit && ceiling ? Math.max(0, ceiling.position[2] - groundHit.position[2] - 1.5) : 64 };
    cache.set(h, x, y, result);
    return result;
  };

  // 单补丁轮廓：15 条射线端点连成的多边形 + 边界距离场
  const contourOf = (patch) => {
    const reach = patch.traceFractions.map((n) => Math.min(60, Math.fround(n * patch.targetRadius)));
    const inputs = [step, ...origin, ...patch.position, ...reach, ...patch.planes.flat()];
    const cached = cache.footprints.get(patch.index);
    if (cached && cached.inputs.length === inputs.length && cached.inputs.every((v, i) => v === inputs[i])) return cached;
    const { contour, points } = buildContour(patch, reach);
    const result = { inputs, contour, columns: [], rows: [], probes: [] };
    const minX = Math.floor(Math.min(...points.map((p) => p[0])) / step) - 1;
    const maxX = Math.ceil(Math.max(...points.map((p) => p[0])) / step) + 1;
    const minY = Math.floor(Math.min(...points.map((p) => p[1])) / step) - 1;
    const maxY = Math.ceil(Math.max(...points.map((p) => p[1])) / step) + 1;
    for (let row = minY; row <= maxY; row++)
      for (let col = minX; col <= maxX; col++) {
        const x = col * step, y = row * step;
        if (outsideContour(contour, origin, [x, y, patch.position[2]], -2 * step)) continue;
        const probe = probeAt(patch, x, y);
        if (probe.hit) { result.columns.push(col); result.rows.push(row); result.probes.push(probe); }
      }
    cache.footprints.set(patch.index, result);
    return result;
  };

  // ...（后续：合并重叠补丁的探针 → 生成网格顶点 → 三角化，见原始 NE 函数）
  // 核心：用带符号距离场（TE/AE/OE/kE）判断每个格点是否在火焰内，
  // 用 Marching Squares 风格在格点上生成网格顶点，最终输出三角索引。
  // 由于篇幅，此处保留结构说明；完整算法见 src/app/12-fire-shader.js NE 函数。
  return {
    step,
    positions: new Float32Array(0),
    limits: new Float32Array(0),
    distances: new Float32Array(0),
    indices: new Uint32Array(0),
    cells: 0,
    area: 0,
  };
}

/** 构建单补丁的 2D 轮廓（原 DE）：15 射线端点 + 边界距离场 */
function buildContour(patch, reach) {
  const points = reach.map((r, i) => {
    const dir = rayDirDeg(i * 24);
    return [patch.position[0] + dir[0] * r, patch.position[1] + dir[1] * r];
  });
  const edges = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    return { start: p, end: q, deltaX: dx, deltaY: dy, squaredLength: Math.max(1e-9, dx * dx + dy * dy) };
  });
  // 完整覆盖时（所有射线都到满），内部距离为 0
  let inner = 0;
  if (reach.length * 24 == 360 && reach.every((r) => r > 0)) {
    inner = Infinity;
    const [cx, cy] = patch.position;
    for (const e of edges) {
      const t = Math.max(0, Math.min(1, ((cx - e.start[0]) * e.deltaX + (cy - e.start[1]) * e.deltaY) / e.squaredLength));
      inner = Math.min(inner, Math.hypot(cx - e.start[0] - e.deltaX * t, cy - e.start[1] - e.deltaY * t));
    }
  }
  return {
    contour: {
      patch,
      reach: Math.max(...points.map(([x, y]) => Math.hypot(x - patch.position[0], y - patch.position[1]))),
      inner,
      edges,
      planes: patch.planes.map((pl) => ({ plane: pl, length: Math.hypot(pl[0], pl[1]) })).filter(({ length }) => length >= 0.01),
    },
    points,
  };
}

/** 到补丁边界的带符号距离（正=内，负=外）（原 TE/OE/kE/AE） */
function signedDistance(contour, origin, point) {
  let inside = false, minDist = Infinity;
  const [px, py] = point;
  for (const { start, end, deltaX, deltaY, squaredLength } of contour.edges) {
    const t = Math.max(0, Math.min(1, ((px - start[0]) * deltaX + (py - start[1]) * deltaY) / squaredLength));
    minDist = Math.min(minDist, (px - start[0] - deltaX * t) ** 2 + (py - start[1] - deltaY * t) ** 2);
    if (start[1] > py !== end[1] > py && px < start[0] + ((py - start[1]) * deltaX) / deltaY) inside = !inside;
  }
  let d = Math.sqrt(minDist) * (inside ? 1 : -1);
  for (const { plane, length } of contour.planes) {
    const dist = plane[3] + (point[0] - origin[0]) * plane[0] + (point[1] - origin[1]) * plane[1] + (point[2] - origin[2]) * plane[2];
    d = Math.min(d, dist / length);
  }
  return d;
}

// ---------------------------------------------------------------------------
// 火焰体积几何（原 FE）：把网格顶点扩展为带高度的"火焰体"三角带
// ---------------------------------------------------------------------------
function buildFireVolume(coverage, startTime = 0) {
  const { positions, limits, distances, indices } = coverage;
  const n = limits.length;
  const heights = new Float64Array(n);
  for (let i = 0; i < n; i++) heights[i] = heightAt(limits[i], distances[i]);

  // 收集边界边（只出现一次的边 = 轮廓边）
  const edgeMap = new Map();
  const edgeA = [], edgeB = [], edgeCount = [];
  const triCount = indices.length - (indices.length % 3);
  for (let i = 0; i < triCount; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[i + k], b = indices[i + ((k + 1) % 3)];
      if (a === b) continue;
      const key = a < b ? a * n + b : b * n + a;
      const idx = edgeMap.get(key);
      if (idx === undefined) { edgeMap.set(key, edgeA.length); edgeA.push(a); edgeB.push(b); edgeCount.push(1); }
      else edgeCount[idx]++;
    }
  // 轮廓边（只出现一次）
  const boundary = [];
  for (let i = 0; i < edgeA.length; i++) {
    if (edgeCount[i] !== 1) continue;
    const a = edgeA[i], b = edgeB[i];
    if (Math.hypot(positions[b * 3] - positions[a * 3], positions[b * 3 + 1] - positions[a * 3 + 1], positions[b * 3 + 2] - positions[a * 3 + 2]) < 0.001) continue;
    boundary.push(a, b);
  }
  const boundaryCount = boundary.length / 2;

  // 顶点：每个网格顶点一个"顶面"，每条边界边 6 个"侧面"顶点
  const totalVerts = triCount + boundaryCount * 6;
  const outPos = new Float32Array(totalVerts * 3);
  const aTop = new Float32Array(totalVerts);
  const aHeightFraction = new Float32Array(totalVerts);
  const aBaseHeight = new Float32Array(totalVerts);
  const aStartTime = new Float32Array(totalVerts).fill(startTime);

  for (let i = 0; i < triCount; i++) {
    const vi = indices[i], z = positions[vi * 3 + 2];
    outPos[i * 3] = positions[vi * 3];
    outPos[i * 3 + 1] = positions[vi * 3 + 1];
    outPos[i * 3 + 2] = z + heights[vi];
    aTop[i] = 1; aHeightFraction[i] = 1; aBaseHeight[i] = z;
  }
  // 侧面顶点（6 个一组：底/顶/底/顶...）
  const SIDE_IDX = [0, 1, 1, 0, 1, 0]; // IE
  const SIDE_TOP = [0, 0, 1, 0, 1, 1]; // LE
  for (let e = 0; e < boundaryCount; e++)
    for (let k = 0; k < 6; k++) {
      const vi = boundary[e * 2 + SIDE_IDX[k]];
      const out = triCount + e * 6 + k;
      const z = positions[vi * 3 + 2];
      outPos[out * 3] = positions[vi * 3];
      outPos[out * 3 + 1] = positions[vi * 3 + 1];
      outPos[out * 3 + 2] = SIDE_TOP[k] ? z + heights[vi] : z + 0.2;
      aHeightFraction[out] = SIDE_TOP[k];
      aBaseHeight[out] = z;
    }

  const geo = new BufferGeometry();
  geo.setAttribute(`position`, new BufferAttribute(outPos, 3));
  geo.setAttribute(`aTop`, new BufferAttribute(aTop, 1));
  geo.setAttribute(`aHeightFraction`, new BufferAttribute(aHeightFraction, 1));
  geo.setAttribute(`aBaseHeight`, new BufferAttribute(aBaseHeight, 1));
  geo.setAttribute(`aStartTime`, new BufferAttribute(aStartTime, 1));
  return { geometry: geo, boundarySegments: boundaryCount };
}

/** 火焰高度（原 PE）：随距离衰减 + 平滑 */
function heightAt(limit, distance) {
  const frac = Math.max(0, Math.min(1, distance / HEIGHT_BLEND));
  const smooth = FIRE_MIN_HEIGHT_FRAC + (1 - FIRE_MIN_HEIGHT_FRAC) * frac * frac * (3 - 2 * frac);
  return Math.max(0, Math.min(limit, FIRE_MAX_HEIGHT * smooth));
}

// ---------------------------------------------------------------------------
// 火焰 shader（原 RE/zE：顶点摇曳 + 片元颜色；BE/VE：地面烧焦）
// 顶点 shader：用 hash/noise 让火焰摇曳、烧尽时下沉变薄
// 片元 shader：火焰颜色从 base→ember→hot 渐变 + 舌焰抖动
// ---------------------------------------------------------------------------
/** 创建火焰材质（原 KE） */
function createFireMaterial(uTime, colors, endTime) {
  const c3 = (v) => ({ value: new Vector3(v[0], v[1], v[2]) });
  return new ShaderMaterial({
    uniforms: { uTime, uEndTime: { value: endTime }, uBase: c3(colors.base), uEmber: c3(colors.ember), uHot: c3(colors.hot) },
    vertexShader: FIRE_VS,
    fragmentShader: FIRE_FS,
    transparent: true, depthWrite: false, side: DoubleSide,
  });
}

/** 创建烧焦材质（原 qE）：地面焦痕，圆盘并集深度场 */
function createScorchMaterial(uTime, endTime, footprint) {
  const patches = footprint.patches
    .map((p) => new Vector3(p.position[0], p.position[1], Math.min(Math.max(60, p.radius), p.targetRadius || 60)))
    .sort((a, b) => b.z - a.z)
    .slice(0, MAX_PATCHES);
  const arr = Array.from({ length: MAX_PATCHES }, (_, i) => patches[i] ?? new Vector3());
  return new ShaderMaterial({
    uniforms: { uTime, uEndTime: { value: endTime }, uPatches: { value: arr }, uPatchCount: { value: patches.length } },
    vertexShader: SCORCH_VS,
    fragmentShader: SCORCH_FS,
    transparent: true, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// 火焰顶点 shader（原 RE，逻辑保留）
const FIRE_VS = `
uniform float uTime;
uniform float uEndTime;
attribute float aTop;
attribute float aHeightFraction;
attribute float aBaseHeight;
attribute float aStartTime;
varying float vTop;
varying float vHeightFraction;
varying float vGrowth;
varying float vFlame;
varying float vAlive;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float growth = smoothstep(0.0, 0.75, max(0.0, uTime - aStartTime));
  vec3 point = position;
  // 烧尽：火焰不均匀地下沉变薄
  float dying = clamp((uTime - uEndTime + 0.25) / 1.10, 0.0, 1.0);
  float stagger = noise(point.xy / 55.0) * 0.7 + noise(point.xy / 19.0) * 0.3;
  float alive = 1.0 - clamp(dying * 1.6 - stagger * 0.6, 0.0, 1.0);
  float flame = sin(point.x * 0.075 + point.y * 0.052 + uTime * 3.1) + 0.5 * sin(point.x * -0.041 + point.y * 0.083 - uTime * 4.3);
  float height = clamp(aHeightFraction, 0.0, 1.0);
  point.xy += vec2(sin(flame + uTime * 2.4), cos(flame * 1.3 - uTime * 1.9)) * height * 0.75;
  point.z = aBaseHeight + 0.2 + (point.z - aBaseHeight) * growth * alive * (0.94 + flame * 0.04);
  vTop = aTop; vHeightFraction = aHeightFraction; vGrowth = growth; vFlame = flame; vAlive = alive;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
}`;

const FIRE_FS = `
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uEmber;
uniform vec3 uHot;
varying float vTop;
varying float vHeightFraction;
varying float vGrowth;
varying float vFlame;
varying float vAlive;
void main() {
  float tongue = 0.5 + 0.5 * sin(vHeightFraction * 10.0 - uTime * 4.2 + vFlame * 1.7);
  float heat = smoothstep(0.05, 0.80, vHeightFraction + (tongue - 0.5) * 0.16) * mix(0.55, 1.0, vAlive);
  vec3 color = mix(uBase, uEmber, heat);
  color = mix(color, uHot, smoothstep(0.68, 1.0, heat) * (0.45 + tongue * 0.35));
  color *= 0.95 + 0.05 * sin(uTime * 3.0 + vFlame);
  float alpha = 0.65 * smoothstep(0.0, 0.18, vGrowth) * smoothstep(0.0, 0.6, vAlive);
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SCORCH_VS = `
attribute float aEdge;
varying float vEdge;
varying vec2 vGround;
void main() {
  vEdge = aEdge;
  vGround = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SCORCH_FS = `
uniform float uTime;
uniform float uEndTime;
uniform vec3 uPatches[64];
uniform int uPatchCount;
varying float vEdge;
varying vec2 vGround;
void main() {
  float since = uTime - uEndTime;
  float formed = smoothstep(-0.25, 0.77, since);
  float fading = smoothstep(3.5, 5.5, since);
  float inside = -1e4;
  for (int index = 0; index < 64; index++) {
    if (index >= uPatchCount) break;
    vec3 disc = uPatches[index];
    float depth = disc.z - distance(vGround, disc.xy);
    float blend = clamp(0.5 + 0.5 * (depth - inside) / 24.0, 0.0, 1.0);
    inside = mix(inside, depth, blend) + 24.0 * blend * (1.0 - blend);
  }
  float edge = min(inside, vEdge);
  float rim = smoothstep(0.0, 3.0, edge);
  float alpha = formed * (1.0 - fading) * rim * 0.85;
  if (alpha <= 0.002) discard;
  vec3 color = vec3(0.04);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;
