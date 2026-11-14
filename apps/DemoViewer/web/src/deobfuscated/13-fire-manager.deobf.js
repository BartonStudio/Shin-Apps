// ============================================================================
// 反混淆版本：燃烧弹火焰（Fire/Inferno）渲染管理
// 原始压缩文件：src/app/13-fire-manager.js + 12-fire-shader.js（部分）
// 压缩类名：YE=HazardVolumeManager, QE=RecordedInfernoManager, uE=FireModel
// 说明：CS2 燃烧弹（Molotov/燃烧手雷）的火焰效果分两层：
//   1. RecordedInfernoManager（QE）：管理 demo 里"录制"的燃烧弹数据
//      —— 火焰被离散成"燃烧补丁（burning patches）"，每个补丁是一个
//      在墙体/地面上的火焰单元，通过射线追踪投射到场景几何体上
//   2. HazardVolumeManager（YE）：把燃烧补丁合并成"危险体（hazard volume）"
//      网格，以及地面烧焦痕迹（scorch）
//  火焰的蔓延/熄灭由 demo 数据驱动（startTick/endTick/burning 标记），
//  渲染端只负责把这些数据转成几何体 + 自定义火焰 shader。
// ============================================================================

// 火焰几何体构建的覆盖率步长（原 XE）与时间桶（原 ZE）
const COVERAGE_STEP = 16;
const SHAPE_BUCKET_TICKS = 16;

/**
 * 火焰模型（原 uE）：解析单个燃烧弹的"燃烧补丁"时空数据
 * 从 demo 的逐帧 burning/positions/origin/normals 数据中，
 * 重建每个火焰补丁的生命周期（出生 tick、结束 tick、位置、法线、目标半径）
 */
class FireModel {
  data;       // 原始燃烧弹帧数据
  tickRate;   // tick 率（默认 64）
  spans = []; // 重建出的燃烧补丁列表
  origin;     // 燃烧弹落点
  radiusRange;// 火焰半径范围 [min, max]
  trace;      // 射线追踪（场景碰撞）
  shapes = new Map(); // 形状缓存

  constructor(data, trace, tickRate = 64, radiusFn) {
    this.data = data;
    this.trace = trace;
    this.tickRate = tickRate;
    // infernoType 0/1 是燃烧弹/火瓶，有固定半径范围
    this.radiusRange = data.infernoType === 0 || data.infernoType === 1 ? fireRadiusRange(data.infernoType) : null;
    this.origin = vec3Or(data.frames[0]?.origin) ?? vec3Or(data.frames[0]?.positions) ?? [0, 0, 0];

    // 逐帧重建补丁生命周期
    const active = new Map(); // patchId → span
    for (const frame of data.frames) {
      const newSpans = new Map();
      // 先处理已有补丁的"熄灭/移动"：燃烧状态改变或位置移动则结束当前 span
      for (const [patchId, span] of active) {
        const pos = vec3Or(frame.positions, patchId * 3);
        if (!frame.burning[patchId] || !pos || pos.some((v, k) => v !== span.position[k])) {
          span.endTick = frame.tick;
          active.delete(patchId);
          if (frame.burning[patchId] && pos) newSpans.set(patchId, span); // 移动 → 重新起一个 span
        }
      }
      // 再处理新出现的燃烧补丁
      for (let patchId = 0; patchId < frame.burning.length; patchId++) {
        if (frame.burning[patchId] !== 1 || active.has(patchId)) continue;
        const pos = vec3Or(frame.positions, patchId * 3);
        if (!pos) continue;
        const origin = vec3Or(frame.origin);
        const parentPos = vec3Or(frame.parentPositions, patchId * 3);
        const normal = vec3Or(frame.normals, patchId * 3);
        const existing = newSpans.get(patchId);
        const isMove = existing && Math.hypot(...pos.map((v, k) => v - existing.position[k])) < 12;
        const span = {
          index: this.spans.length,
          patchId,
          position: pos,
          origin: origin ?? [...this.origin],
          // parent 世界位置 = 父位置 + 落点
          parent: origin && parentPos ? parentPos.map((v, k) => v + origin[k]) : [...pos],
          normal: normal ?? [0, 0, 1],
          startTick: frame.tick,
          birthTick: isMove ? existing.birthTick : frame.tick,
          endTick: data.endTick,
          // spatial：是否有完整几何信息（可投影到场景）
          spatial: !!(origin && parentPos && normal && this.radiusRange),
          targetRadius: this.radiusRange ? (this.radiusRange[0] + this.radiusRange[1]) / 2 : 0,
        };
        if (radiusFn) span.targetRadius = radiusFn(span);
        // 校验目标半径在合法范围内
        if (span.spatial && (!Number.isFinite(span.targetRadius) || span.targetRadius < this.radiusRange[0] || span.targetRadius > this.radiusRange[1]))
          throw Error(`Fire target radius is outside the native type range`);
        active.set(patchId, span);
        this.spans.push(span);
      }
    }
  }

  /** 某 tick 处于燃烧状态的补丁列表 */
  activeAt(tick) {
    if (!Number.isFinite(tick) || tick < this.data.startTick || tick >= this.data.endTick) return [];
    return this.spans.filter((s) => s.startTick <= tick && tick < s.endTick);
  }

  /**
   * 计算某 tick 的火焰几何形状（带缓存）
   * @param {number} tick
   * @param {boolean} withSources 是否生成火焰"源"（发光球）
   */
  shapeAt(tick, withSources = true) {
    const floorTick = Math.floor(tick);
    const active = this.activeAt(floorTick).filter((s) => s.spatial);
    if (!this.trace || active.length === 0) return { tick: floorTick, patches: [], sources: [], rejectedGround: 0 };

    // 缓存键：活跃补丁集合 + 是否"刚出生" + 是否含源
    const newborn = active.some((s) => floorTick < s.birthTick + this.tickRate * 2);
    const key = `${active.map((s) => s.index).join(`,`)}:${newborn ? floorTick : `mature`}:${withSources ? `sources` : `patches`}`;
    const cached = this.shapes.get(key);
    if (cached) return cached;

    const patches = this.tracePatches(active, () => floorTick);
    if (!withSources) {
      const shape = { tick: floorTick, patches, sources: [], rejectedGround: 0 };
      this.shapes.set(key, shape);
      return shape;
    }
    // ...（源码续：生成火焰源、地面拒绝等）
    // 注：完整实现见 12-fire-shader.js 68 行之后，此处保留核心结构
    const shape = { tick: floorTick, patches, sources: [], rejectedGround: 0 };
    this.shapes.set(key, shape);
    return shape;
  }
}

// ---------------------------------------------------------------------------
// 危险体管理器（原 YE）：把火焰补丁合成"危险体"网格 + 地面烧焦
// ---------------------------------------------------------------------------

class HazardVolumeManager {
  group = new Group();
  entries = new Map();       // model → entry {material, fire, scorch}
  caches = new WeakMap();    // model → 缓存
  uniforms = { uTime: { value: 0 } };
  geometryBuilds = 0;

  constructor() {
    this.group.name = `HazardVolumes`;
    this.group.visible = false;
  }

  /**
   * 更新所有火焰模型：合成危险体网格 + 烧焦痕迹
   * @param {Array} models {model, shape, footprint} 列表
   * @param {*} trace 场景碰撞
   * @param {number} time 当前时间（秒）
   * @param {number} step 覆盖率步长
   */
  update(models, trace, time, step = COVERAGE_STEP) {
    this.uniforms.uTime.value = time;
    const alive = new Set(models.map(({ model }) => model));

    // 移除已消失的火焰
    for (const [model, entry] of this.entries) {
      if (!alive.has(model)) { this.remove(entry); this.entries.delete(model); }
    }

    for (const { model, shape, footprint } of models) {
      const duration = model.data.endTick / model.tickRate;
      let entry = this.entries.get(model);
      if (!entry) {
        const fireType = model.data.infernoType === UE ? GE : WE; // 燃烧弹 vs 火瓶
        entry = { material: createFireMaterial(this.uniforms.uTime, fireType, duration), fire: null, scorch: null };
        this.entries.set(model, entry);
      }

      // 更新火焰体
      this.updateFire(entry, model, shape, trace, step);

      // 更新地面烧焦痕迹
      if (footprint && footprint.patches.length && entry.scorch?.shape !== footprint) {
        this.removeScorch(entry);
        const coverage = buildCoverage(footprint, model.origin, trace, this.cacheFor(model), step);
        if (coverage.indices.length >= 3) {
          const mesh = new Mesh(coverageToGeometry(coverage), createScorchMaterial(this.uniforms.uTime, duration, footprint));
          mesh.name = `InfernoScorch`;
          mesh.frustumCulled = false;
          mesh.renderOrder = -2.6;
          entry.scorch = { shape: footprint, mesh };
          this.group.add(mesh);
          this.geometryBuilds++;
        }
      } else if (!footprint) {
        this.removeScorch(entry);
      }
    }
  }

  /** 更新/重建单个火焰的危险体网格 */
  updateFire(entry, model, shape, trace, step) {
    const fire = entry.fire;
    // 形状未变则跳过
    const key = fire?.shape === shape && fire.coverage.step === step
      ? fire.key
      : `${step}:` + shape.patches.map((p) =>
          [p.index, ...p.position, Math.max(60, p.radius), ...p.traceFractions, ...p.planes.flat()].join(`,`),
        ).join(`;`);
    if (fire && fire.key === key) { fire.shape = shape; return; }

    this.removeFire(entry);
    if (!shape.patches.length) return;

    const coverage = buildCoverage(shape, model.origin, trace, this.cacheFor(model), step);
    let mesh = null;
    if (coverage.indices.length >= 3) {
      mesh = new Mesh(coverageToGeometry(coverage, shape.startTick / model.tickRate).geometry, entry.material);
      mesh.name = `HazardVolume`;
      mesh.frustumCulled = false;
      mesh.renderOrder = -2.5;
      this.group.add(mesh);
      this.geometryBuilds++;
    }
    entry.fire = { shape, key, coverage, mesh };
  }

  cacheFor(model) {
    let cache = this.caches.get(model);
    if (!cache) { cache = new CoverageCache(); this.caches.set(model, cache); }
    return cache;
  }

  debugStats() {
    let cells = 0, area = 0;
    for (const { fire } of this.entries.values()) if (fire) { cells += fire.coverage.cells; area += fire.coverage.area; }
    return { cells, area, geometryBuilds: this.geometryBuilds };
  }

  removeFire(entry) {
    if (entry.fire?.mesh) { this.group.remove(entry.fire.mesh); entry.fire.mesh.geometry.dispose(); }
    entry.fire = null;
  }

  removeScorch(entry) {
    if (entry.scorch) {
      this.group.remove(entry.scorch.mesh);
      entry.scorch.mesh.geometry.dispose();
      entry.scorch.mesh.material.dispose();
    }
    entry.scorch = null;
  }

  remove(entry) {
    this.removeFire(entry);
    this.removeScorch(entry);
    entry.material.dispose();
  }

  clear() {
    for (const entry of this.entries.values()) this.remove(entry);
    this.entries.clear();
    this.caches = new WeakMap();
  }

  dispose() { this.clear(); }
}
