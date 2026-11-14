// ─────────────────────────────────────────────────────────────────────────────
// 03-map-classification.deobf.js — 地图实体分类/破坏删除 + 视锥剔除 + 批量网格
//
// 来源：src/app/03-map-classification.js（Vite 生产构建，prettier 展开版）
// 原始压缩名：Av = ObjectTimeline（物体时间线），jv = kindMatches，Fv = BatchedMapMesh，
//             Iv = MapCuller（视锥剔除器），Lv = LUMA_WEIGHTS，Rv = createLightSample
//
// 本文件包含：
//   1. ObjectTimeline（Av）—— 把「地图实体记录」（门/可交互物）匹配到静态对象，
//      并按时间轴判定哪些记录是「破坏」（物体被打碎/门被拆掉），从而在回放时
//      正确显示/隐藏物体。
//   2. BatchedMapMesh（Fv）—— 继承 Mesh 的批量网格，含 multi-draw 间接绘制所需
//      的 part 表（partStart/partCount/partCell/partSphere），支持 LOD 两档。
//   3. MapCuller（Iv）—— 基于 6 个视锥平面的自定义剔除器，配合 PVS 可见性
//      单元格（cells）与细节距离（detailDistance）/ LOD 距离，生成 multi-draw 批次。
//
// 说明：标识符已重命名成语义化名字，局部单字母变量展开，关键逻辑补注释。
//       未改任何语义。
// ─────────────────────────────────────────────────────────────────────────────

// ── 常量 ───────────────────────────────────────────────────────────────────────

const QUANTIZE_MAX = 65535; // Mv —— 位置量化上限（chunk box 内 u16 坐标）
const INDEX_SCALE = 2; // Nv —— 索引单位缩放（uint16 索引 vs uint32）
const LOD_HYSTERESIS = 0.85; // Pv —— LOD 切换滞回系数（避免抖动）
const LUMA_WEIGHTS = [0.2125, 0.7154, 0.0721]; // Lv —— 亮度权重（Rec.709）

/** 一个空的「光照采样」结构（后续由 light grid 填充） */
function createLightSample() {
  return { ambient: new Float32Array(18), sunVisibility: 1, probeRow: 0 };
}

// ── 物体时间线（Av / ObjectTimeline） ─────────────────────────────────────────

/**
 * 把地图实体记录（来自 CSDA 的 mapEntities section）匹配到静态对象，
 * 并按时间轴分类「破坏」事件。
 *
 * 一个「记录」描述某个实体在 [startTick, endTick) 内的位置/朝向/隐藏状态。
 * 当某个记录在其 endTick 之后没有其他记录接续，且周围同时有多个实体在同
 * 一 tick 附近结束，则判定该实体被「破坏」（打碎/移除），之后不再显示。
 */
class ObjectTimeline {
  constructor(objects, records) {
    this.objects = objects;
    this.records = objects.map(() => []);
    this.broken = new Set();

    // 建立 object id -> 索引 的映射，求每个对象的「跟随对象」索引（follows）
    const idToIndex = new Map(objects.map((obj, i) => [obj.id, i]));
    this.leaders = objects.map((obj) => (obj.follows === undefined ? -1 : (idToIndex.get(obj.follows) ?? -1)));

    const maxDistSq = MATCH_CELL * MATCH_CELL;
    for (const record of records ?? []) {
      if (record.ticks.length === 0) continue;
      const hiddenAtStart = record.hidden[0] !== 0;
      let bestIndex = -1;
      let bestScore = Infinity;

      // 在所有对象里找最近的匹配：优先距离近、隐藏状态一致、kind 匹配
      objects.forEach((obj, idx) => {
        const distSq = distSqBetween(obj.origin, record.origin);
        if (distSq > maxDistSq) return;
        const score =
          distSq +
          (obj.hidden === hiddenAtStart ? 0 : maxDistSq * 2) +
          (kindMatches(obj, record) ? 0 : maxDistSq * 4);
        if (score < bestScore) {
          bestScore = score;
          bestIndex = idx;
        }
      });

      if (bestIndex >= 0) this.records[bestIndex].push(record);
    }

    for (const list of this.records) list.sort((a, b) => a.startTick - b.startTick);
    this.classifyDeletions(records ?? []);
  }

  /**
   * 判定哪些记录代表「破坏」：一个记录在 endTick 后没有接续（在全局最大
   * endTick 之前结束），且同一 tick 附近结束的实体数不够「密集」，则视为破坏。
   */
  classifyDeletions(records) {
    let globalMaxEndTick = -Infinity;
    for (const r of records) globalMaxEndTick = Math.max(globalMaxEndTick, r.endTick);

    for (const list of this.records) {
      for (const record of list) {
        const endTick = record.endTick;
        if (endTick >= globalMaxEndTick) continue;

        let total = 0;
        let near = 0;
        for (const other of records) {
          if (other.startTick >= endTick || other.endTick <= endTick - BREAK_WINDOW) continue;
          total++;
          if (Math.abs(other.endTick - endTick) <= BREAK_WINDOW) near++;
        }
        // 结束得不够「密集」（near 太少）则视为被破坏
        if (near < MIN_BREAK_COUNT || near < total * BREAK_RATIO) this.broken.add(record);
      }
    }
  }

  /** 返回某个对象的「破坏」事件列表（tick + 复活 tick） */
  breaks(objectIndex) {
    if (this.leaders[objectIndex] >= 0) return []; // 跟随对象不独立判定
    const list = this.records[objectIndex];
    const result = [];
    list.forEach((record, i) => {
      if (this.broken.has(record)) {
        result.push({ tick: record.endTick, respawnTick: list[i + 1]?.startTick ?? Infinity });
      }
    });
    return result;
  }

  /** 是否至少匹配到一个记录 */
  get matched() {
    return this.records.some((list) => list.length > 0);
  }

  /**
   * 求对象在某个 tick 的姿势（可见性 + pitch/yaw/roll）。
   * 支持「跟随对象」（跟随 leader 的可见性，叠加自身朝向）。
   * 记录内用二分查找定位 tick 所在帧，并做短窗口插值。
   */
  poseAt(objectIndex, tick, out) {
    const obj = this.objects[objectIndex];
    const leader = this.leaders[objectIndex];

    if (leader >= 0) {
      // 跟随 leader
      out.visible = this.poseAt(leader, tick, out).visible && !obj.hidden;
      out.pitch = obj.angles[0];
      out.yaw = obj.angles[1];
      out.roll = obj.angles[2];
      return out;
    }

    out.visible = !obj.hidden;
    out.pitch = obj.angles[0];
    out.yaw = obj.angles[1];
    out.roll = obj.angles[2];

    const list = this.records[objectIndex];
    let active = null;
    for (const record of list) {
      if (record.startTick > tick) break;
      active = record;
    }
    if (!active) return out;

    if (tick >= active.endTick) {
      if (this.broken.has(active)) {
        out.visible = false;
        return out;
      }
      tick = active.endTick - 1;
    }

    const { ticks, angles, hidden } = active;
    let lo = 0;
    let hi = ticks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ticks[mid] <= tick) lo = mid;
      else hi = mid - 1;
    }
    const frame = lo;
    out.visible = hidden[frame] === 0;
    out.pitch = angles[frame * 3];
    out.yaw = angles[frame * 3 + 1];
    out.roll = angles[frame * 3 + 2];

    const next = frame + 1;
    if (next < ticks.length && ticks[next] - ticks[frame] <= INTERP_WINDOW && tick > ticks[frame]) {
      const t = (tick - ticks[frame]) / (ticks[next] - ticks[frame]);
      out.pitch = lerpAngle(out.pitch, angles[next * 3], t);
      out.yaw = lerpAngle(out.yaw, angles[next * 3 + 1], t);
      out.roll = lerpAngle(out.roll, angles[next * 3 + 2], t);
    }
    return out;
  }
}

// 匹配/插值常量（原始为字面量，此处集中命名）
const MATCH_CELL = 1; // Cv —— 匹配距离阈值（网格单元格单位）
const BREAK_WINDOW = 1; // Tv —— 破坏判定的时间窗（tick）
const MIN_BREAK_COUNT = 1; // Dv —— 最少「同时结束」数量
const BREAK_RATIO = 0.5; // Ev —— 同时结束占比阈值
const INTERP_WINDOW = 1; // wv —— 插值允许的最大 tick 间隔

/** 判断对象 kind 与记录 className 是否匹配（door 特判） */
function kindMatches(obj, record) {
  const isDoor = /door/i.test(record.className);
  return obj.kind === 'door' ? isDoor : !isDoor;
}

function distSqBetween(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** 角度线性插值（处理 ±180° 环绕） */
function lerpAngle(a, b, t) {
  return a + (((((b - a) % 360) + 540) % 360) - 180) * t;
}

// ── 批量网格（Fv / BatchedMapMesh） ───────────────────────────────────────────

/**
 * 一个用 multi-draw 间接绘制的大块地图网格。
 * 每个「part」是同一块 chunk 内的一段三角形范围（含近距/LOD 两档），
 * 附带各自的包围球与所属 PVS 单元格，供剔除器快速筛选。
 */
class BatchedMapMesh extends Mesh {
  isBatchedMesh = true;
  _multiDrawStarts;
  _multiDrawCounts;
  _multiDrawCount = 0;
  _matricesTexture = null;
  _indirectTexture = null;
  _colorsTexture = null;
  colorTexture = null;
  nearParts;
  triangles;
  usingLod = false;
  partStart;
  partCount;
  partCell;
  partSphere;
  sphere;
  detail;
  visibleTriangles = 0;
  objectId = 0;
  objectHidden = false;
  movable = false;

  constructor(geometry, material, triangleCount, nearParts, lodParts, boxMin, boxMax, detail) {
    super(geometry, material);
    this.detail = detail;
    this.triangles = triangleCount;
    this.nearParts = nearParts.count;

    const totalParts = nearParts.count + (lodParts?.count ?? 0);
    this._multiDrawStarts = new Int32Array(Math.max(nearParts.count, lodParts?.count ?? 0));
    this._multiDrawCounts = new Int32Array(this._multiDrawStarts.length);
    this.partStart = new Int32Array(totalParts);
    this.partCount = new Int32Array(totalParts);
    this.partCell = new Uint32Array(totalParts);
    this.partSphere = new Float32Array(totalParts * 4);

    // 世界坐标到 chunk 局部量化坐标的缩放（除以 65535）
    const cellScale = new Vector3()
      .subVectors(boxMax, boxMin)
      .max(new Vector3(0.001, 0.001, 0.001))
      .divideScalar(QUANTIZE_MAX);

    let partIndex = 0;
    for (const partSet of lodParts ? [nearParts, lodParts] : [nearParts]) {
      for (let i = 0; i < partSet.count; i++, partIndex++) {
        const base = i * 24;
        const view = partSet.view;
        this.partStart[partIndex] = (partSet.firstIndex + view.getUint32(base, true)) * INDEX_SCALE;
        this.partCount[partIndex] = view.getUint32(base + 4, true);
        this.partCell[partIndex] = view.getUint32(base + 8, true);

        // 从量化包围盒还原世界空间包围球
        let radiusSq = 0;
        for (let axis = 0; axis < 3; axis++) {
          const minQ = view.getUint16(base + 12 + axis * 2, true);
          const maxQ = view.getUint16(base + 18 + axis * 2, true);
          const scale = cellScale.getComponent(axis);
          const half = (maxQ - minQ) * 0.5 * scale;
          this.partSphere[partIndex * 4 + axis] = boxMin.getComponent(axis) + (minQ + maxQ) * 0.5 * scale;
          radiusSq += half * half;
        }
        this.partSphere[partIndex * 4 + 3] = Math.sqrt(radiusSq);
      }
    }

    this.sphere = new Box3(boxMin, boxMax).getBoundingSphere(new Sphere());

    for (let i = 0; i < nearParts.count; i++) {
      this._multiDrawStarts[i] = this.partStart[i];
      this._multiDrawCounts[i] = this.partCount[i];
    }
    this._multiDrawCount = nearParts.count;
  }
}

// ── 视锥剔除器（Iv / MapCuller） ──────────────────────────────────────────────

/**
 * 基于视锥平面 + PVS 可见性单元格 + 细节距离的自定义剔除器。
 * 为每个批量网格生成 multi-draw 批次（合并相邻 part），并更新可见三角形数。
 */
class MapCuller {
  planes = new Float32Array(24); // 6 个平面 × 4 分量
  camera = new Vector3();
  cells = null; // PVS 可见性单元格位图
  detailDistance = Infinity;
  lodDistance = Infinity;
  frustum = new Frustum();
  matrix = new Matrix4();
  inverse = new Matrix4();

  /** 设置视锥（结合相机投影矩阵与地图组的变换） */
  setView(camera, mapGroup) {
    this.matrix
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(mapGroup.matrixWorld);
    this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem);
    this.frustum.planes.forEach((plane, i) => {
      this.planes[i * 4] = plane.normal.x;
      this.planes[i * 4 + 1] = plane.normal.y;
      this.planes[i * 4 + 2] = plane.normal.z;
      this.planes[i * 4 + 3] = plane.constant;
    });
    this.camera.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inverse.copy(mapGroup.matrixWorld).invert());
  }

  /** 剔除一个批量网格，更新其 multi-draw 批次 */
  cull(mesh) {
    const center = mesh.sphere.center;
    const radius = mesh.sphere.radius;

    if (mesh.objectHidden || !this.sphereVisible(center.x, center.y, center.z, radius)) {
      mesh.visible = false;
      mesh.visibleTriangles = 0;
      return;
    }

    const { cells, camera, detailDistance } = this;
    const { partStart, partCount, partCell, partSphere, _multiDrawStarts, _multiDrawCounts } = mesh;

    // LOD 切换（带滞回）
    if (mesh.nearParts < partStart.length) {
      const dist = Math.hypot(center.x - camera.x, center.y - camera.y, center.z - camera.z) - radius;
      mesh.usingLod = dist > this.lodDistance * (mesh.usingLod ? LOD_HYSTERESIS : 1);
    }

    const rangeStart = mesh.usingLod ? mesh.nearParts : 0;
    const rangeEnd = mesh.usingLod ? partStart.length : mesh.nearParts;
    let drawCount = 0;
    let triangleCount = 0;
    let prevEnd = -1;

    for (let i = rangeStart; i < rangeEnd; i++) {
      const cell = partCell[i];
      // PVS：单元格不可见则跳过
      if (cells && !((cells[cell >>> 3] >>> (cell & 7)) & 1)) continue;

      if (!mesh.movable) {
        const base = i * 4;
        const sx = partSphere[base];
        const sy = partSphere[base + 1];
        const sz = partSphere[base + 2];
        const sr = partSphere[base + 3];
        // 细节距离：远处的细小 part 跳过；视锥外跳过
        if ((mesh.detail && Math.hypot(sx - camera.x, sy - camera.y, sz - camera.z) - sr > detailDistance) || !this.sphereVisible(sx, sy, sz, sr)) {
          continue;
        }
      }

      const start = partStart[i];
      const count = partCount[i];
      // 合并相邻 part 到同一 batch
      if (start === prevEnd) {
        _multiDrawCounts[drawCount - 1] += count;
      } else {
        _multiDrawStarts[drawCount] = start;
        _multiDrawCounts[drawCount] = count;
        drawCount++;
      }
      prevEnd = start + count * INDEX_SCALE;
      triangleCount += count;
    }

    mesh._multiDrawCount = drawCount;
    mesh.visible = drawCount > 0;
    mesh.visibleTriangles = triangleCount / 3;
  }

  /** 球体是否与视锥相交（6 平面测试） */
  sphereVisible(x, y, z, radius) {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -radius) return false;
    }
    return true;
  }
}
