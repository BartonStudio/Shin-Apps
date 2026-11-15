// ============================================================================
// 反混淆版本：爆炸/闪光特效 + 投掷物轨迹 + 胶囊体兜底渲染
// 原始压缩文件：src/app/14-blast-effects.js
// 原文范围：decompiled/index.beautified.js L38344–39079（切片 14-blast-effects）
// 压缩类名：cD=BlastEffects, CD=GrenadeEffects, ID=CapsuleRenderer
// 说明：三个核心能力：
//   1. BlastEffects（cD）：爆炸/闪光的屏幕空间冲击波 shader（依赖深度缓冲）
//   2. GrenadeEffects（CD）：投掷物（手雷/闪光/烟/火）的抛物线轨迹 + 3D 模型
//   3. CapsuleRenderer（ID）：**像素块的来源**——当真实角色模型未加载/关闭时，
//      用胶囊体 + 球体（鼻子）的 instanced mesh 兜底显示玩家
// ============================================================================

// ---------------------------------------------------------------------------
// 爆炸/闪光冲击波（原 cD）：屏幕空间 shader，用深度缓冲让冲击波贴合场景
// ---------------------------------------------------------------------------
const BLAST_POOL_SIZE = 12;      // $E
const BLAST_SCALE_PAD = 1.08;    // eD

// 高爆手雷参数（tD）
const HE_BLAST_PARAMS = {
  seconds: 0.75, waveRadius: 170, waveSeconds: 0.6, ringAlpha: 0.9, ringWidth: [2, 1],
  echoDelay: 0.09, echoSeconds: 0.5, echoAlpha: 0.4, shellAlpha: 0.4, veilAlpha: 0.14,
  shellFadeSeconds: 0.45, glowRadius: 26, glowLift: 14, glowDecay: 8,
  coreGain: 0.9, haloGain: 0.45, waveColor: [1, 0.36, 0.1], coreColor: [1, 0.9, 0.74], haloColor: [1, 0.42, 0.13],
  lightColor: 16751189, lightIntensity: 220, lightRange: 340, lightLift: 32,
};
// 闪光弹参数（nD）
const FLASH_BLAST_PARAMS = {
  seconds: 0.55, waveRadius: 185, waveSeconds: 0.42, ringAlpha: 0.75, ringWidth: [1.6, 0.8],
  echoDelay: 0.06, echoSeconds: 0.38, echoAlpha: 0.28, shellAlpha: 0, veilAlpha: 0,
  shellFadeSeconds: 0.32, glowRadius: 30, glowLift: 8, glowDecay: 17,
  coreGain: 1.4, haloGain: 0.55, waveColor: [0.72, 0.84, 1], coreColor: [1, 1, 1], haloColor: [0.82, 0.9, 1],
  lightColor: 15134463, lightIntensity: 420, lightRange: 560, lightLift: 24,
};

class BlastEffects {
  pool = [];
  geometry = new SphereGeometry(1, 3);
  scene = new Scene();
  shared = {
    uDepth: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uNear: { value: 1 },
    uFar: { value: 1e3 },
    uForward: { value: new Vector3(0, 0, -1) },
    uPixelAngle: { value: 0.001 },
  };
  light = new PointLight(16777215, 0, HE_BLAST_PARAMS.lightRange, 1);
  used = 0;
  lightLevel = 0;
  hasDepth = false;

  constructor(parent) {
    parent.add(this.light);
    for (let i = 0; i < BLAST_POOL_SIZE; i++) {
      const material = new ShaderMaterial({
        uniforms: {
          ...this.shared,
          uCenter: { value: new Vector3() }, uRadius: { value: 0 }, uWidth: { value: 0 },
          uRingAlpha: { value: 0 }, uEcho: { value: 0 }, uEchoAlpha: { value: 0 },
          uShellAlpha: { value: 0 }, uVeilAlpha: { value: 0 }, uGlow: { value: 0 },
          uGlowRadius: { value: 1 }, uGlowLift: { value: 0 }, uCoreGain: { value: 0 }, uHaloGain: { value: 0 },
          uWaveColor: { value: new Vector3() }, uCoreColor: { value: new Vector3() }, uHaloColor: { value: new Vector3() },
        },
        vertexShader: BLAST_VS,
        fragmentShader: BLAST_FS,
        side: FrontSide, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.pool.push({ mesh, material });
    }
  }

  begin() { this.used = 0; this.lightLevel = 0; }

  /** 显示一个爆炸冲击波 */
  show(center, t, params = HE_BLAST_PARAMS) {
    if (this.used >= this.pool.length) return false;
    const { mesh, material } = this.pool[this.used++];
    const u = material.uniforms;
    const waveRadius = waveRadiusAt(params, t);
    const waveFrac = waveRadius / params.waveRadius;
    u.uCenter.value.set(center.x, center.y, center.z);
    u.uRadius.value = waveRadius;
    u.uWidth.value = params.ringWidth[0] + (params.ringWidth[1] - params.ringWidth[0]) * waveFrac;
    u.uRingAlpha.value = params.ringAlpha * smoothstepRange(0, 0.02, t) * (1 - smoothstepRange(params.waveSeconds * 0.25, params.waveSeconds, t));
    const echoAge = t - params.echoDelay;
    u.uEcho.value = 0.75 * params.waveRadius * easeOutCubic(clamp01(echoAge / params.echoSeconds));
    u.uEchoAlpha.value = params.echoAlpha * smoothstepRange(0, 0.02, echoAge) * (1 - smoothstepRange(params.echoSeconds * 0.2, params.echoSeconds, echoAge));
    const shellFade = smoothstepRange(0.03, 0.1, t) * (1 - smoothstepRange(0.1, params.shellFadeSeconds, t));
    u.uShellAlpha.value = params.shellAlpha * shellFade;
    u.uVeilAlpha.value = params.veilAlpha * shellFade;
    const glow = glowAt(params, t);
    const glowRadius = params.glowRadius * (1 + t * 2);
    u.uGlow.value = glow;
    u.uGlowRadius.value = glowRadius;
    u.uGlowLift.value = params.glowLift;
    u.uCoreGain.value = params.coreGain;
    u.uHaloGain.value = params.haloGain;
    u.uWaveColor.value.fromArray(params.waveColor);
    u.uCoreColor.value.fromArray(params.coreColor);
    u.uHaloColor.value.fromArray(params.haloColor);
    const scale = Math.max(waveRadius + 6, params.glowLift + 5 * glowRadius);
    mesh.position.set(center.x, center.y, center.z);
    mesh.scale.setScalar(scale * BLAST_SCALE_PAD);
    mesh.visible = true;
    const lightIntensity = glow * params.lightIntensity;
    if (lightIntensity > this.lightLevel) {
      this.lightLevel = lightIntensity;
      this.light.position.set(center.x, center.y, center.z + params.lightLift);
      this.light.color.setHex(params.lightColor);
      this.light.distance = params.lightRange;
    }
    return true;
  }

  end() {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].mesh.visible = false;
    this.light.intensity = this.lightLevel;
    this.hasDepth = false;
  }

  get needsDepth() { return this.used > 0; }

  /** 注入场景深度缓冲（冲击波 shader 需要它来判断遮挡） */
  applySceneDepth(depthTex, camera, resolution) {
    this.shared.uDepth.value = depthTex;
    this.shared.uResolution.value.copy(resolution);
    this.shared.uNear.value = camera.near;
    this.shared.uFar.value = camera.far;
    camera.getWorldDirection(this.shared.uForward.value);
    this.shared.uPixelAngle.value = (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, resolution.y);
    this.hasDepth = true;
  }

  render(renderer, camera) {
    if (this.used === 0 || !this.hasDepth) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(this.scene, camera); }
    finally { renderer.autoClear = prevAutoClear; }
  }

  get activeCount() { return this.pool.filter(({ mesh }) => mesh.visible).length; }

  dispose() {
    this.light.removeFromParent();
    this.light.dispose();
    for (const { material } of this.pool) material.dispose();
    this.geometry.dispose();
  }
}

// 缓动函数
function easeOutCubic(x) { return 1 - (1 - x) ** 3; }
function clamp01(x) { return Math.min(1, Math.max(0, x)); }
function smoothstepRange(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
/** 冲击波半径随时间的推进（原 sD） */
function waveRadiusAt(params, t) { return params.waveRadius * easeOutCubic(clamp01(t / params.waveSeconds)); }
/** 辉光强度衰减（原 oD） */
function glowAt(params, t) { return smoothstepRange(0, 0.012, t) * Math.exp(-t * params.glowDecay); }

// 冲击波 shader（顶点/片元，原 rD/iD，保留原始逻辑）
const BLAST_VS = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const BLAST_FS = `/* 见原 iD：band/echo/shell/veil/core 分层合成，用深度缓冲贴合几何体 */`;

// ---------------------------------------------------------------------------
// 投掷物轨迹采样（原 hD/mD/gD/pD）
// ---------------------------------------------------------------------------
const DEG2RAD_HALF = Math.PI / 360;

/** 欧拉角（度）→ 四元数（原 mD） */
function eulerToQuatDeg(pitch, yaw, roll, out) {
  const cy = Math.cos(roll * DEG2RAD_HALF), sy = Math.sin(roll * DEG2RAD_HALF);
  const cp = Math.cos(pitch * DEG2RAD_HALF), sp = Math.sin(pitch * DEG2RAD_HALF);
  const cr = Math.cos(yaw * DEG2RAD_HALF), sr = Math.sin(yaw * DEG2RAD_HALF);
  out.qx = sy * cp * cr - cy * sp * sr;
  out.qy = cy * sp * cr + sy * cp * sr;
  out.qz = cy * cp * sr - sy * sp * cr;
  out.qw = cy * cp * cr + sy * sp * sr;
}

/** 采样投掷物轨迹：位置线性插值 + 四元数球面插值（原 hD/gD） */
function sampleTrajectory(traj, tick, out) {
  const i = upperBoundTickIdx(traj.ticks, tick);
  const j = Math.min(i + 1, traj.ticks.length - 1);
  const dt = traj.ticks[j] - traj.ticks[i];
  const frac = dt > 0 ? Math.min(1, Math.max(0, (tick - traj.ticks[i]) / dt)) : 0;
  const pos = traj.posXYZ, a = i * 3, b = j * 3;
  out.x = pos[a] + (pos[b] - pos[a]) * frac;
  out.y = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * frac;
  out.z = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * frac;
  const angles = traj.angles;
  if (!angles || angles.length !== traj.ticks.length * 3) { out.qx = 0; out.qy = 0; out.qz = 0; out.qw = 1; return; }
  eulerToQuatDeg(angles[a], angles[a + 1], angles[a + 2], out);
  if (frac === 0 || j === i) return;
  const qx0 = out.qx, qy0 = out.qy, qz0 = out.qz, qw0 = out.qw;
  eulerToQuatDeg(angles[b], angles[b + 1], angles[b + 2], out);
  quatSlerp(qx0, qy0, qz0, qw0, out, frac);
}
function quatSlerp(x, y, z, w, out, t) {
  let bx = out.qx, by = out.qy, bz = out.qz, bw = out.qw;
  let dot = x * bx + y * by + z * bz + w * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0, s1;
  if (dot > 0.9995) { s0 = 1 - t; s1 = t; }
  else { const theta = Math.acos(dot), sinTheta = Math.sin(theta); s0 = Math.sin((1 - t) * theta) / sinTheta; s1 = Math.sin(t * theta) / sinTheta; }
  const qx = x * s0 + bx * s1, qy = y * s0 + by * s1, qz = z * s0 + bz * s1, qw = w * s0 + bw * s1;
  const inv = Math.hypot(qx, qy, qz, qw) || 1;
  out.qx = qx / inv; out.qy = qy / inv; out.qz = qz / inv; out.qw = qw / inv;
}
function upperBoundTickIdx(ticks, n) {
  let lo = 0, hi = ticks.length - 1;
  if (hi <= 0 || n <= ticks[0]) return 0;
  if (n >= ticks[hi]) return hi;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; ticks[mid] <= n ? (lo = mid) : (hi = mid - 1); }
  return lo;
}
/** 投掷物种类 → 模型文件名（原 _D） */
function grenadeModelName(kind, incendiary, isT) {
  switch (kind) {
    case `smoke`: return `smokegrenade`;
    case `he`: return `hegrenade`;
    case `flash`: return `flashbang`;
    case `decoy`: return `decoy`;
    case `molotov`: return (incendiary ?? isT) ? `incgrenade` : `molotov`;
  }
}

// ---------------------------------------------------------------------------
// 投掷物特效（原 CD）：轨迹线 + 模型 + 爆炸 + 火焰
// ---------------------------------------------------------------------------
const TRAJ_FADE_TICKS = 320; // yD = 5*64：爆炸后轨迹线淡出时长
const TRAJ_COLOR = { 2: 14722342, 3: 7189490, neutral: 10133674 }; // bD：CT蓝/T黄
const GRENADE_COLOR = { smoke: 13684944, he: 16735067, flash: 16772744, molotov: 16742959, decoy: 6741384 }; // xD

class GrenadeEffects {
  scene; data; teamOf;
  group = new Group();
  lines = [];
  markers;
  markerColor = new Color();
  dummy = new Object3D();
  modelsEnabled = false;
  disposed = false;
  models = new Map();      // modelFile → {requested, geometry}
  lighting;
  modelMaterial;
  modelMeshes = [];
  pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  fire;       // RecordedInfernoManager
  blasts;     // BlastEffects
  tickRate;
  markerCapacity;
  trajectoryVisibility = `all`;
  followedSlot = -1;
  selectedGrenade = -1;

  constructor(scene, data, teamOf, lighting, tickRate = 64) {
    this.scene = scene;
    this.lighting = lighting;
    this.modelMaterial = lighting.createMaterial({ surface: `vertex` });
    this.data = data;
    this.teamOf = teamOf;
    this.tickRate = tickRate;
    this.fire = new RecordedInfernoManager(scene, data.infernos ?? [], tickRate);
    this.blasts = new BlastEffects(this.group);
    for (const traj of data.trajectories) this.addTrajectory(traj);
    this.markerCapacity = 48;
    const markerGeom = new SphereGeometry(6, 8, 6);
    const markerMat = new MeshBasicMaterial();
    this.markers = new InstancedMesh(markerGeom, markerMat, this.markerCapacity);
    this.markers.instanceColor = new InstancedBufferAttribute(new Float32Array(this.markerCapacity * 3), 3);
    this.markers.frustumCulled = false;
    this.markers.count = 0;
    this.group.add(this.markers);
    scene.add(this.group);
  }

  setData(data) {
    // 复用未变化的轨迹线
    let keep = 0;
    while (keep < this.lines.length && keep < data.trajectories.length) {
      const a = this.lines[keep].traj, b = data.trajectories[keep];
      if (a.kind !== b.kind || a.throwerSlot !== b.throwerSlot || a.startTick !== b.startTick || a.endTick !== b.endTick ||
          a.detonationTick !== b.detonationTick || a.ticks.length !== b.ticks.length || a.ticks[0] !== b.ticks[0] ||
          a.ticks[a.ticks.length - 1] !== b.ticks[b.ticks.length - 1] || a.posXYZ[0] !== b.posXYZ[0] ||
          a.posXYZ[a.posXYZ.length - 1] !== b.posXYZ[b.posXYZ.length - 1] || a.angles?.length !== b.angles?.length || a.incendiary !== b.incendiary)
        break;
      keep++;
    }
    while (this.lines.length > keep) {
      const l = this.lines.pop();
      this.group.remove(l.line); l.line.geometry.dispose(); l.material.dispose();
    }
    for (let i = keep; i < data.trajectories.length; i++) this.addTrajectory(data.trajectories[i]);
    this.data = data;
    this.fire.setData(data.infernos ?? []);
  }

  addTrajectory(traj) {
    const geo = new BufferGeometry();
    geo.setAttribute(`position`, new BufferAttribute(traj.posXYZ, 3));
    const team = traj.throwerSlot >= 0 ? this.teamOf(traj.throwerSlot, traj.startTick) : 0;
    const mat = new LineBasicMaterial({ color: TRAJ_COLOR[team] ?? TRAJ_COLOR.neutral, transparent: true, opacity: 1 });
    const line = new Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    this.group.add(line);
    const modelFile = grenadeModelName(traj.kind, traj.incendiary, team === 3);
    this.lines.push({ traj, line, material: mat, modelFile });
    if (this.modelsEnabled) this.requestModel(modelFile);
  }

  setModelsEnabled(enabled) {
    this.modelsEnabled = enabled;
    if (enabled) for (const { modelFile } of this.lines) this.requestModel(modelFile);
  }

  requestModel(file) {
    let entry = this.models.get(file);
    if (!entry) { entry = { requested: false, geometry: null }; this.models.set(file, entry); }
    if (entry.requested) return;
    entry.requested = true;
    loadGltf(weaponPath(`world`, file))
      .then((gltf) => { this.disposed ? gltf.dispose() : (entry.geometry = gltf); })
      .catch((e) => console.warn(`[csplayer] grenade model ${file} failed to load`, e));
  }

  modelMesh(i) {
    let slot = this.modelMeshes[i];
    if (!slot) {
      const mesh = new Mesh(undefined, this.modelMaterial);
      mesh.frustumCulled = false;
      const light = makeLightSample();
      mesh.onBeforeRender = () => { applyLightUniforms(this.modelMaterial.uniforms, light); this.modelMaterial.uniformsNeedUpdate = true; };
      this.group.add(mesh);
      slot = { mesh, light };
      this.modelMeshes.push(slot);
    }
    return slot;
  }

  update(tick, camera) {
    this.updateTrajectoriesAndMarkers(tick);
    this.updateEffects(tick);
    this.fire.update(tick, camera);
  }

  setMapObject(obj) { this.fire.setMapObject(obj); }
  setMolotovGraphics(g) { this.fire.setGraphics(g); }
  setTrajectoryVisibility(mode, followedSlot, selectedGrenade) { this.trajectoryVisibility = mode; this.followedSlot = followedSlot; this.selectedGrenade = selectedGrenade; }
  debugFireCounts() { return this.fire.debugCounts(); }
  get blastsNeedDepth() { return this.blasts.needsDepth; }
  applyBlastDepth(depth, camera, res) { this.blasts.applySceneDepth(depth, camera, res); }
  renderBlasts(renderer, camera) { this.blasts.render(renderer, camera); }
  get blastScene() { return this.blasts.scene; }
  get fireShaderPrototypes() { return this.fire.shaderPrototypes; }

  debugCounts() {
    return { lines: this.lines.filter((l) => l.line.visible).length, fires: this.fire.debugCounts().patches, blasts: this.blasts.activeCount };
  }

  updateTrajectoriesAndMarkers(tick) {
    let markerCount = 0, modelCount = 0;
    for (let [i, entry] of this.lines.entries()) {
      const { traj, line, material } = entry;
      const detonationTick = traj.detonationTick ?? traj.endTick;
      const flying = tick >= traj.startTick && tick <= detonationTick;
      const fading = tick > detonationTick && tick <= detonationTick + TRAJ_FADE_TICKS;
      if (!flying && !fading) { line.visible = false; continue; }

      line.visible = this.trajectoryVisibility === `all` ||
        (this.trajectoryVisibility === `followed` && this.followedSlot >= 0 && traj.throwerSlot === this.followedSlot) ||
        (this.trajectoryVisibility === `selected` && i === this.selectedGrenade);

      if (flying) {
        const idx = upperBoundTickIdx(traj.ticks, tick);
        line.geometry.setDrawRange(0, Math.max(2, idx + 1));
        material.opacity = 1;
        const model = this.modelsEnabled ? (this.models.get(entry.modelFile)?.geometry ?? null) : null;
        if (model) {
          sampleTrajectory(traj, tick, this.pose);
          const { mesh, light } = this.modelMesh(modelCount++);
          this.lighting.sample(this.pose.x, this.pose.y, this.pose.z, light);
          mesh.geometry = model;
          mesh.position.set(this.pose.x, this.pose.y, this.pose.z);
          mesh.quaternion.set(this.pose.qx, this.pose.qy, this.pose.qz, this.pose.qw);
          mesh.visible = true;
        } else if (markerCount < this.markerCapacity) {
          this.dummy.position.set(traj.posXYZ[idx * 3], traj.posXYZ[idx * 3 + 1], traj.posXYZ[idx * 3 + 2]);
          this.dummy.scale.setScalar(1);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.updateMatrix();
          this.markers.setMatrixAt(markerCount, this.dummy.matrix);
          this.markers.setColorAt(markerCount, this.markerColor.set(GRENADE_COLOR[traj.kind]));
          markerCount++;
        }
      } else {
        line.geometry.setDrawRange(0, traj.ticks.length);
        material.opacity = 1 - (tick - detonationTick) / TRAJ_FADE_TICKS;
      }
    }
    for (let i = modelCount; i < this.modelMeshes.length; i++) this.modelMeshes[i].mesh.visible = false;
    this.markers.count = markerCount;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
  }

  updateEffects(tick) {
    this.blasts.begin();
    for (const effect of this.data.effects) {
      const params = effect.kind === `he` ? HE_BLAST_PARAMS : effect.kind === `flash` ? FLASH_BLAST_PARAMS : null;
      if (!params) continue;
      const age = blastAge(params, effect, tick, this.tickRate);
      if (age !== null) this.blasts.show(effect, age, params);
    }
    this.blasts.end();
  }

  dispose() {
    this.disposed = true;
    this.fire.dispose();
    this.blasts.dispose();
    for (const { line, material } of this.lines) { line.geometry.dispose(); material.dispose(); }
    this.markers.geometry.dispose();
    this.markers.material.dispose();
    for (const entry of this.models.values()) entry.geometry?.dispose();
    this.models.clear();
    this.modelMaterial.dispose();
    this.scene.remove(this.group);
  }
}
/** 爆炸年龄（原 aD）：返回 0..seconds 内的年龄，否则 null */
function blastAge(params, effect, tick, tickRate) {
  const age = (tick - effect.startTick) / tickRate;
  return age >= 0 && age <= params.seconds ? age : null;
}

// ---------------------------------------------------------------------------
// 胶囊体兜底渲染（原 ID）：**像素块的来源**
// 真实角色模型缺失/关闭时，用"胶囊体(身体)+球(鼻子)"的 instanced mesh 显示玩家
// ---------------------------------------------------------------------------
const CAPSULE_HEIGHT = 14, CAPSULE_RADIUS = 44; // wD/TD
const NOSE_LIFT = 36;  // ED
const DUCK_SCALE = 0.75; // DD
const DAMAGE_TINT_WINDOW = 0.75; // ND

class CapsuleRenderer {
  capsules;   // 身体胶囊 InstancedMesh
  noses;      // 鼻子球 InstancedMesh
  xrayScene = new Scene();
  xrayCapsules; xrayNoses;
  xrayMaskMat;
  xrayCompositeScene = new Scene();
  xrayCompositeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  xrayCompositeMesh;
  xraySmoke;
  xrayResolution = new Vector2(1, 1);
  xrayTarget = null;
  bodyMat; noseMat;
  dummy = new Object3D();
  playerColor = new Color();
  slotColors;
  colorOf = (i) => this.slotColors[i];
  damageTint;
  count;
  xray = false;

  constructor(scene, count) {
    this.count = count;
    this.damageTint = new Float32Array(count);
    this.slotColors = Array.from({ length: count }, () => new Color(8947848));
    const capGeom = new CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT, 6, 12);
    capGeom.rotateX(Math.PI / 2);
    const noseGeom = new SphereGeometry(6, 18, 10);
    noseGeom.rotateZ(-Math.PI / 2);
    noseGeom.translate(22, 0, 6);
    this.bodyMat = new MeshLambertMaterial();
    this.noseMat = new MeshLambertMaterial();
    this.xraySmoke = new InstancedBufferAttribute(new Float32Array(count), 1);
    capGeom.setAttribute(`xraySmoke`, this.xraySmoke);
    noseGeom.setAttribute(`xraySmoke`, this.xraySmoke);
    this.xrayMaskMat = makeXrayMaskMaterial();
    this.xrayCompositeMesh = makeXrayCompositeMesh(this.xrayResolution);
    this.xrayCompositeScene.add(this.xrayCompositeMesh);
    this.capsules = new InstancedMesh(capGeom, this.bodyMat, count);
    this.noses = new InstancedMesh(noseGeom, this.noseMat, count);
    this.xrayCapsules = new InstancedMesh(capGeom, this.xrayMaskMat, count);
    this.xrayNoses = new InstancedMesh(noseGeom, this.xrayMaskMat, count);
    for (const m of [this.capsules, this.noses, this.xrayCapsules, this.xrayNoses]) { m.frustumCulled = false; m.instanceMatrix.setUsage(DynamicDrawUsage); }
    for (let i = 0; i < count; i++) {
      this.capsules.setColorAt(i, new Color(8947848));
      this.noses.setColorAt(i, new Color(8947848));
      this.xrayCapsules.setColorAt(i, new Color(8947848));
      this.xrayNoses.setColorAt(i, new Color(8947848));
    }
    scene.add(this.capsules, this.noses);
    this.xrayScene.add(this.xrayCapsules, this.xrayNoses);
  }

  update(frame, tick, hurtEvents, tickRate, selfIdx = -1, xrayMaskFn) {
    this.updateDamageTint(hurtEvents, tick, tickRate);
    for (let i = 0; i < this.count; i++) {
      const alive = frame.alive[i] === 1;
      const visible = alive && i !== selfIdx && xrayMaskFn?.[i] !== 1;
      const scaleZ = 1 - frame.duck[i] * (1 - DUCK_SCALE);
      this.dummy.position.set(frame.x[i], frame.y[i], frame.z[i] + NOSE_LIFT * scaleZ);
      this.dummy.rotation.set(0, 0, frame.yaw[i] * DEG2RAD);
      this.dummy.scale.set(+!!visible, +!!visible, visible ? scaleZ : 0);
      this.dummy.updateMatrix();
      this.capsules.setMatrixAt(i, this.dummy.matrix);
      this.noses.setMatrixAt(i, this.dummy.matrix);
      const xrayVisible = this.xray && alive && i !== selfIdx;
      this.dummy.scale.set(+!!xrayVisible, +!!xrayVisible, xrayVisible ? scaleZ : 0);
      this.dummy.updateMatrix();
      this.xrayCapsules.setMatrixAt(i, this.dummy.matrix);
      this.xrayNoses.setMatrixAt(i, this.dummy.matrix);
      this.xraySmoke.setX(i, +(xrayMaskFn?.[i] === 1));
      const color = this.playerColor.copy(teamColorOf(frame.team[i])).lerp(new Color(16724040), this.damageTint[i]);
      this.slotColors[i].copy(color);
      this.capsules.setColorAt(i, color);
      this.noses.setColorAt(i, color);
      this.xrayCapsules.setColorAt(i, color);
      this.xrayNoses.setColorAt(i, color);
    }
    this.capsules.instanceMatrix.needsUpdate = true;
    this.noses.instanceMatrix.needsUpdate = true;
    this.xrayCapsules.instanceMatrix.needsUpdate = true;
    this.xrayNoses.instanceMatrix.needsUpdate = true;
    this.xraySmoke.needsUpdate = true;
    if (this.capsules.instanceColor) this.capsules.instanceColor.needsUpdate = true;
    if (this.noses.instanceColor) this.noses.instanceColor.needsUpdate = true;
    if (this.xrayCapsules.instanceColor) this.xrayCapsules.instanceColor.needsUpdate = true;
    if (this.xrayNoses.instanceColor) this.xrayNoses.instanceColor.needsUpdate = true;
  }

  /** 根据最近受击事件计算红色受伤染色 */
  updateDamageTint(hurtEvents, tick, tickRate) {
    this.damageTint.fill(0);
    const window = DAMAGE_TINT_WINDOW * tickRate;
    const start = upperBoundCount(hurtEvents.tick, hurtEvents.count, tick);
    for (let i = start - 1; i >= 0; i--) {
      const age = tick - hurtEvents.tick[i];
      if (age > window) break;
      const slot = hurtEvents.victimSlot[i];
      if (slot >= this.count) continue;
      const fade = 1 - age / window;
      const strength = Math.min(1, 0.3 + hurtEvents.dmg[i] / 100) * 0.58;
      this.damageTint[slot] = Math.max(this.damageTint[slot], fade * strength);
    }
  }

  applyXrayDepth(depthTex, resolution) { this.xrayCompositeMesh.material.uniforms.uSceneDepth.value = depthTex; this.xrayResolution.copy(resolution); }

  renderXray(renderer, camera, characterRenderer) {
    if (!this.xray) return;
    const w = Math.max(1, Math.floor(this.xrayResolution.x));
    const h = Math.max(1, Math.floor(this.xrayResolution.y));
    if (this.xrayTarget) {
      if (this.xrayTarget.width !== w || this.xrayTarget.height !== h) this.xrayTarget.setSize(w, h);
    } else {
      this.xrayTarget = new WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false });
      this.xrayTarget.texture.minFilter = NearestFilter;
      this.xrayTarget.texture.magFilter = NearestFilter;
      this.xrayTarget.depthTexture = new DepthTexture(w, h, UnsignedIntType);
      this.xrayTarget.depthTexture.format = DepthFormat;
    }
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = renderer.getClearColor(new Color());
    const prevClearAlpha = renderer.getClearAlpha();
    try {
      if (characterRenderer) this.collapseXrayCapsules(characterRenderer.drawnAlive);
      renderer.setRenderTarget(this.xrayTarget);
      renderer.setClearColor(0, 0);
      renderer.clear();
      renderer.render(this.xrayScene, camera);
      if (characterRenderer) { renderer.autoClear = false; characterRenderer.renderXrayMask(renderer, camera, this.colorOf); }
      this.xrayCompositeMesh.material.uniforms.uMask.value = this.xrayTarget.texture;
      this.xrayCompositeMesh.material.uniforms.uPlayerDepth.value = this.xrayTarget.depthTexture;
      this.xrayCompositeMesh.material.uniforms.uNearFar.value.set(camera.near, camera.far);
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = false;
      renderer.render(this.xrayCompositeScene, this.xrayCompositeCamera);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      renderer.setClearColor(prevClearColor, prevClearAlpha);
    }
  }

  get xrayEnabled() { return this.xray; }
  setXray(v) { this.xray = v; }
  setBodiesVisible(v) { this.capsules.visible = v; this.noses.visible = v; }

  /** 已用真实模型绘制的角色，收起其胶囊体（避免重叠） */
  collapseXrayCapsules(drawnAlive) {
    let changed = false;
    for (let i = 0; i < this.count; i++) {
      if (drawnAlive[i] === 1) {
        this.xrayCapsules.setMatrixAt(i, ZERO_MATRIX);
        this.xrayNoses.setMatrixAt(i, ZERO_MATRIX);
        changed = true;
      }
    }
    if (changed) { this.xrayCapsules.instanceMatrix.needsUpdate = true; this.xrayNoses.instanceMatrix.needsUpdate = true; }
  }

  dispose() {
    this.capsules.geometry.dispose();
    this.noses.geometry.dispose();
    this.bodyMat.dispose();
    this.noseMat.dispose();
    this.xrayMaskMat.dispose();
    this.xrayCompositeMesh.geometry.dispose();
    this.xrayCompositeMesh.material.dispose();
    this.xrayTarget?.dispose();
    this.capsules.removeFromParent();
    this.noses.removeFromParent();
    this.capsules.dispose();
    this.noses.dispose();
  }

  /** 拾取：射线命中胶囊体返回玩家索引 */
  intersect(raycaster) {
    const hit = raycaster.intersectObject(this.capsules, false)[0];
    return hit && hit.instanceId != null ? hit.instanceId : -1;
  }
}
const ZERO_MATRIX = new Matrix4().makeScale(0, 0, 0);
function teamColorOf(team) { return team === 2 ? new Color(14722342) : team === 3 ? new Color(7189490) : new Color(8947848); }
function upperBoundCount(ticks, count, n) {
  let lo = 0, hi = count;
  while (lo < hi) { const mid = (lo + hi) >>> 1; ticks[mid] <= n ? (lo = mid + 1) : (hi = mid); }
  return lo;
}

/** X 光轮廓 mask 材质（原 zD） */
function makeXrayMaskMaterial() {
  return new ShaderMaterial({
    vertexColors: true, depthTest: true, depthWrite: true, toneMapped: false,
    vertexShader: `
      attribute float xraySmoke;
      varying vec3 vColor;
      varying float vSmokeOccluded;
      void main() {
        vColor = instanceColor;
        vSmokeOccluded = xraySmoke;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vSmokeOccluded;
      void main() { gl_FragColor = vec4(vColor, mix(0.5, 1.0, vSmokeOccluded)); }`,
  });
}

/** X 光合成 shader（原 BD）：用深度缓冲检测"被遮挡"，画轮廓 */
function makeXrayCompositeMesh(resolution) {
  const material = new ShaderMaterial({
    uniforms: {
      uMask: { value: null }, uPlayerDepth: { value: null }, uSceneDepth: { value: null },
      uResolution: { value: resolution }, uNearFar: { value: new Vector2(1, 1e3) },
    },
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uMask;
      uniform sampler2D uPlayerDepth;
      uniform sampler2D uSceneDepth;
      uniform vec2 uResolution;
      uniform vec2 uNearFar;
      varying vec2 vUv;
      float viewDistance(float depth) { return uNearFar.x * uNearFar.y / (uNearFar.y - (uNearFar.y - uNearFar.x) * depth); }
      void main() {
        vec2 texel = 1.0 / uResolution;
        if (texture2D(uMask, vUv).a > 0.25) discard;
        vec4 edge = vec4(0.0);
        for (int y = -3; y <= 3; y++) {
          for (int x = -3; x <= 3; x++) {
            vec2 offset = vec2(float(x), float(y));
            if (dot(offset, offset) > 9.0) continue;
            vec2 sampleUv = vUv + offset * texel;
            vec4 sampleMask = texture2D(uMask, sampleUv);
            if (sampleMask.a <= max(edge.a, 0.25)) continue;
            bool hidden = sampleMask.a > 0.75;
            if (!hidden) {
              float playerDistance = viewDistance(texture2D(uPlayerDepth, sampleUv).r);
              float sceneDistance = viewDistance(texture2D(uSceneDepth, sampleUv).r);
              hidden = sceneDistance < playerDistance - 8.0;
            }
            if (hidden) edge = sampleMask;
          }
        }
        if (edge.a <= 0.25) discard;
        gl_FragColor = vec4(mix(edge.rgb, vec3(1.0), 0.25), 0.95);
      }`,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  return mesh;
}
