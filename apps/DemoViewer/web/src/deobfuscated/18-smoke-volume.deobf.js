// ============================================================================
// 反混淆版本：烟雾体素模拟 + 体积渲染（SmokeSimulation / SmokeVolumeRenderer）
// 原始压缩文件：src/app/18-smoke-volume.js
// 压缩类名：lO=SmokeSimulation（体素密度扩散）, MO=SmokeVolumeRenderer（ray marching）
// 说明：CS2 烟雾弹的完整渲染管线，技术密度最高的模块：
//   1. SmokeSimulation（lO）：在 32³ 体素网格上做**实时流体扩散模拟**——
//      密度从"种子点（发射器）"向外扩散，受墙体阻挡、受子弹/爆炸扰动
//   2. SmokeVolumeRenderer（MO）：用 **3D 纹理 ray marching**（光线行进）渲染
//      烟雾体积，带光照、噪声扰动、深度缓冲遮挡，分 desktop/mobile 两档质量
//   3. 边缘感知上采样（edge-aware smoke）：低分辨率渲染后智能放大，避免锯齿
//  这套系统把"离散体素 → 连续体积"做得非常完整。
// ============================================================================

// ---------------------------------------------------------------------------
// 体素密度模拟（原 lO）：32³ 网格上的扩散 + 扰动
// ---------------------------------------------------------------------------
const SMOKE_GRID = 32;           // 网格边长
const SMOKE_CELLS = 32 ** 3;     // rO：体素数

class SmokeSimulation {
  buffers = [new Float32Array(SMOKE_CELLS * 4), new Float32Array(SMOKE_CELLS * 4)]; // [density, nx, ny, nz]
  active = [new Uint8Array(SMOKE_CELLS), new Uint8Array(SMOKE_CELLS)];
  blocked = new Uint8Array(SMOKE_CELLS);       // 被墙体占据的体素
  linearBlocked = new Uint8Array(SMOKE_CELLS); // 线性索引下的 blocked
  neighborDensity = new Float32Array(6);
  previous = new Uint8Array(SMOKE_CELLS);
  seedRecords = null;
  emitters = [];    // 种子点（烟雾发射源）
  current = 0;      // 当前缓冲（双缓冲 ping-pong）
  frame = -1;
  clip;

  constructor(clip) { this.clip = clip; }

  /** 推进一帧模拟（密度扩散 + 扰动） */
  step() {
    if (this.frame + 1 >= this.clip.frameCount) throw new RangeError(`End of smoke journal`);
    this.writeBytes(this.previous);
    this.frame++;
    // 读取录制好的占用图（记录真实烟雾的体素占用）
    this.clip.occupancyAtFrame(this.frame, this.linearBlocked);
    for (let i = 0; i < SMOKE_CELLS; i++) this.blocked[i] = this.linearBlocked[mortonToIndex[i]];

    // 更新发射器（种子点）
    const seeds = this.clip.seedPointsAtFrame(this.frame);
    if (seeds !== this.seedRecords) {
      this.seedRecords = seeds;
      const view = new DataView(new ArrayBuffer(4));
      this.emitters = seeds.map((s) => {
        if (Math.min(s.x, s.y, s.z) < 0 || Math.max(s.x, s.y, s.z) >= 32) throw Error(`Seed outside the native grid`);
        view.setUint32(0, s.extra, true);
        const suppression = view.getFloat32(0, true);
        if (!Number.isFinite(suppression)) throw Error(`Invalid emitter state`);
        return {
          cell: mortonEncode(s.x, s.y, s.z),
          suppression,
          nearOrigin: Math.hypot((s.x - 15.5) * 20, (s.y - 15.5) * 20, (s.z - 15.5) * 20) <= 80,
        };
      });
    }

    const src = this.buffers[this.current];
    const dst = this.buffers[1 - this.current];
    const srcActive = this.active[this.current];
    const dstActive = this.active[1 - this.current];
    const dissipating = this.frame >= this.clip.dissipationFrame;
    // 发射器抑制：活跃发射器越少，烟雾扩散越强
    const activeEmitters = this.emitters.filter((e) => e.suppression < Math.fround(0.01)).length;
    const maxDensity = Math.fround(Math.max(1, Math.fround(Math.fround(1 - Math.fround(activeEmitters / 40)) * 3.5)) * 50);

    for (const emitter of this.emitters) {
      const cell = emitter.cell;
      if (this.frame === 0) {
        // 首帧：发射器周围 3×3×3 播撒初始密度
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const x = mortonToCoord[cell * 3] + dx, y = mortonToCoord[cell * 3 + 1] + dy, z = mortonToCoord[cell * 3 + 2] + dz;
              if (Math.min(x, y, z) < 0 || Math.max(x, y, z) >= 32) continue;
              const n = mortonEncode(x, y, z);
              if (srcActive[n] || this.blocked[n]) continue;
              src[n * 4] = Math.fround(src[n * 4] + 30);
              dst[n * 4] = src[n * 4];
              srcActive[n] = 1;
            }
        srcActive[cell] = 1;
        continue;
      }
      if (dissipating) src[cell * 4] = 0;
      else {
        let suppress = emitter.nearOrigin;
        if (!suppress) {
          // 检查周围是否已有密度（决定是否抑制）
          let sum = 0;
          for (let f = 0; f < 6; f++) {
            const n = mortonToNeighbors[cell * 6 + f];
            if (n >= 0 && srcActive[n]) sum = Math.fround(sum + Math.min(1, Math.max(0, Math.fround(src[n * 4] / 50))));
          }
          suppress = Math.fround(sum / 6) > Math.fround(0.2);
        }
        emitter.suppression = suppress ? Math.fround(emitter.suppression * Math.fround(0.8)) : 1;
        src[cell * 4] = Math.min(maxDensity, Math.fround(src[cell * 4] + Math.fround(Math.fround(1 - emitter.suppression) * 60)));
      }
      srcActive[cell] = 1;
      dst.set(src.subarray(cell * 4, cell * 4 + 4), cell * 4);
    }
    if (dissipating) this.emitters = [];

    // 主扩散循环：密度向 6 个邻居流动
    for (let i = 0; i < SMOKE_CELLS; i++) {
      if (!srcActive[i]) continue;
      const o = i * 4;
      if (this.blocked[i]) { dst[o] = 0; continue; }

      const density = Math.min(1, Math.max(0, Math.fround(dst[o] / 50)));
      let totalFlow = 0;
      const walled = [false, false, false, false, false, false];
      for (let f = 0; f < 6; f++) {
        const n = mortonToNeighbors[i * 6 + f];
        if (n < 0 || this.blocked[n]) { this.neighborDensity[f] = 0; walled[f] = true; continue; }
        const nd = src[n * 4];
        this.neighborDensity[f] = nd;
        // 水平/垂直方向不同扩散速率；水平方向受"上飘"倾向影响
        let rate = Math.fround(f === 4 ? 0.79 : 1.2); // 4 = -z（向下）扩散较慢
        if (f < 4) {
          const [dx, dy, dz] = FACE_NEIGHBORS[f];
          rate = Math.fround(Math.fround(Math.fround(-dy * src[n * 4 + 2]) - Math.fround(dz * src[n * 4 + 3])) - Math.fround(dx * src[n * 4 + 1])) > Math.fround(0.2) ? 1.25 : Math.fround(0.9);
        }
        const flow = Math.fround(Math.fround(Math.fround(nd / 6) * Math.fround(1 - density)) * rate);
        totalFlow = Math.fround(totalFlow + flow);
        dst[n * 4] = Math.max(0, Math.fround(dst[n * 4] - flow));
        if (!srcActive[n] && src[o] > 5) dstActive[n] = 1;
      }

      const x = mortonToCoord[i * 3], y = mortonToCoord[i * 3 + 1], z = mortonToCoord[i * 3 + 2];
      if (Math.min(x, y, z) === 0 || Math.max(x, y, z) === 31) { dst[o] = Math.fround(dst[o] * Math.fround(0.3)); continue; } // 边界衰减
      dst[o] = Math.fround(dst[o] + totalFlow);
      // 计算密度梯度 → 法线方向（用于光照）
      const gx = Math.fround(this.neighborDensity[0] - this.neighborDensity[1]);
      const gy = Math.fround(this.neighborDensity[2] - this.neighborDensity[3]);
      if (walled[0] || walled[1]) gx = 0;
      if (walled[2] || walled[3]) gy = 0;
      const glen = Math.fround(Math.sqrt(Math.fround(gy * gy + gx * gx)));
      const inv = glen > 0 ? Math.fround(1 / glen) : 0;
      dst[o + 1] = Math.fround(gx * inv);
      dst[o + 2] = Math.fround(gy * inv);
      dst[o + 3] = 0;
      dst[o] = Math.max(0, Math.fround(dst[o] - (dissipating ? 0.25 : 0.5))); // 密度耗散
    }
    // 交换缓冲
    for (let i = 0; i < SMOKE_CELLS; i++) {
      if (srcActive[i]) src.set(dst.subarray(i * 4, i * 4 + 4), i * 4);
      srcActive[i] |= dstActive[i];
      dstActive[i] = srcActive[i];
    }
    this.current = 1 - this.current;
  }

  /** 把当前密度写入字节图（0..255） */
  writeBytes(out) {
    const buf = this.buffers[1 - this.current];
    for (let i = 0; i < SMOKE_CELLS; i++)
      out[mortonToIndex[i]] = Math.trunc(Math.fround(Math.min(1, Math.max(0, Math.fround(buf[i * 4] / 50))) * 255));
  }
  bytes() { const out = new Uint8Array(SMOKE_CELLS); this.writeBytes(out); return out; }

  /** 写出一对帧（当前 + 上一帧）用于帧间混合 */
  writeFramePair(frame, out) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.clip.frameCount) throw new RangeError(`Invalid smoke frame`);
    if (out.length !== SMOKE_CELLS * 2) throw new RangeError(`Smoke texture must contain two channels per cell`);
    if (frame < this.frame) {
      for (const b of this.buffers) b.fill(0);
      for (const a of this.active) a.fill(0);
      this.seedRecords = null; this.emitters = []; this.current = 0; this.frame = -1; this.previous.fill(0);
    }
    for (; this.frame < frame;) this.step();
    const buf = this.buffers[1 - this.current];
    for (let i = 0; i < SMOKE_CELLS; i++) {
      const idx = mortonToIndex[i];
      out[idx * 2] = this.previous[i];
      out[idx * 2 + 1] = Math.trunc(Math.fround(Math.min(1, Math.max(0, Math.fround(buf[i * 4] / 50))) * 255));
    }
  }
}

/** 烟雾颜色：根据 demo 颜色做色调校正（原 fO） */
const SMOKE_BASE_COLOR = new Color(12567238);
function smokeColorOf(srcColor, out) {
  const lum = 0.2126 * srcColor[0] + 0.7152 * srcColor[1] + 0.0722 * srcColor[2];
  if (!(lum > 0.01)) return out.copy(SMOKE_BASE_COLOR);
  const r = (Math.max(srcColor[0], 0.01) / lum) ** 0.22;
  const g = (Math.max(srcColor[1], 0.01) / lum) ** 0.22;
  const b = (Math.max(srcColor[2], 0.01) / lum) ** 0.22;
  const norm = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return out.setRGB((SMOKE_BASE_COLOR.r * r) / norm, (SMOKE_BASE_COLOR.g * g) / norm, (SMOKE_BASE_COLOR.b * b) / norm);
}

// ---------------------------------------------------------------------------
// 烟雾体积渲染器（原 MO）：3D 纹理 ray marching
// ---------------------------------------------------------------------------
const SMOKE_TEX_SIZE = 640;      // yO：体素纹理尺寸（对应 640 单位世界空间）
const SMOKE_GRID_RES = 32;       // X：体素网格分辨率
const MAX_SMOKE_SLOTS = 16;      // mO：最多同时渲染的烟雾
const MAX_SHOTS = 16, MAX_BLASTS = 8; // _O/vO：扰动源上限
const SHOT_RADIUS = 18;          // VO
const BLAST_RADIUS = 320;        // UO

// 画质档（desktop/mobile）
const SMOKE_QUALITY = {
  desktop: { resolutionScale: 0.5, stepLength: 10, maxSteps: 64 },
  mobile: { resolutionScale: 0.35, stepLength: 14, maxSteps: 44 },
};

class SmokeVolumeRenderer {
  scene;
  volumeScene = new Scene();
  compositeScene = new Scene();
  compositeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  compositeMesh;
  voxelData;
  clips = new Map();
  slots = [];
  geo;                 // 体积包围盒几何
  cubeGeo = new BoxGeometry(20, 20, 20); // cubes 模式的小方块
  cubeMatrix = new Matrix4();
  normalTarget = null;  // 降分辨率渲染目标
  normalSize = new Vector2();
  graphics = `medium`;
  budget = SMOKE_QUALITY.desktop;
  lightScratch = new Float32Array(32 * 32 * 4);
  lastTick = NaN;
  shotCount = { value: 0 };
  blastCount = { value: 0 };
  shotStart = Array.from({ length: MAX_SHOTS }, () => new Vector4());
  shotEnd = Array.from({ length: MAX_SHOTS }, () => new Vector4());
  blasts = Array.from({ length: MAX_BLASTS }, () => new Vector4());
  visible = false;
  activeCount = 0;
  fwd = new Vector3();
  frustum = new Frustum();
  projectionView = new Matrix4();
  scissorRect = new Vector4();
  marchBox = new Box3();
  cornerClip = new Float64Array(24);
  formTexture;

  constructor(scene, voxelData) {
    this.scene = scene;
    this.voxelData = voxelData;
    this.geo = new BoxGeometry(SMOKE_TEX_SIZE, SMOKE_TEX_SIZE, SMOKE_TEX_SIZE);
    this.formTexture = makeFormNoiseTexture();
    // 边缘感知合成 shader（把降分辨率的烟雾放大到全屏）
    this.compositeMesh = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
      uniforms: {
        uSmoke: { value: null }, uSceneDepth: { value: null }, uSourceSize: { value: new Vector2(1, 1) },
        uCamNear: { value: 1 }, uCamFar: { value: 1 },
      },
      vertexShader: FULLSCREEN_QUAD_VS,
      fragmentShader: EDGE_AWARE_SMOKE_FS,
      transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false,
    }));
    this.compositeMesh.frustumCulled = false;
    this.compositeScene.add(this.compositeMesh);

    const lightDir = new Vector3(0.35, 0.2, 1).normalize();
    for (let i = 0; i < MAX_SMOKE_SLOTS; i++) {
      const densityData = new Uint8Array(32 * 32 * 32 * 2);
      const densityTex = makeSmokeTexture(densityData);
      const lightData = new Uint8Array(32 * 32 * 32 * 2);
      const lightTex = makeSmokeTexture(lightData);
      const material = new ShaderMaterial({
        glslVersion: GLSL3,
        uniforms: {
          uDensity: { value: densityTex }, uLight: { value: lightTex }, uFormNoise: { value: this.formTexture },
          uBoxMin: { value: new Vector3() }, uBoxSize: { value: new Vector3(SMOKE_TEX_SIZE, SMOKE_TEX_SIZE, SMOKE_TEX_SIZE) },
          uMarchMin: { value: new Vector3() }, uMarchMax: { value: new Vector3() }, uOrigin: { value: new Vector3() },
          uColor: { value: SMOKE_BASE_COLOR.clone() }, uOpacity: { value: 1 }, uFrameBlend: { value: 1 }, uAge: { value: 0 },
          uSteps: { value: this.budget.maxSteps }, uStepLength: { value: this.budget.stepLength },
          uShotCount: this.shotCount, uBlastCount: this.blastCount,
          uShotStart: { value: this.shotStart }, uShotEnd: { value: this.shotEnd }, uBlasts: { value: this.blasts },
          uLightDir: { value: lightDir }, uAbsorb: { value: 0.32 },
          uSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) },
          uCamNear: { value: 1 }, uCamFar: { value: 1 }, uCamForward: { value: new Vector3(0, 0, -1) }, uUseDepth: { value: 0 },
        },
        vertexShader: VOLUME_VS,
        fragmentShader: VOLUME_FS,
        transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: false, side: FrontSide,
      });
      const mesh = new Mesh(this.geo, material);
      mesh.frustumCulled = true;
      mesh.visible = false;
      this.volumeScene.add(mesh);
      this.slots.push({ mesh, cubes: null, cubeFrameIdx: -1, material, texture: densityTex, data: densityData, lightTexture: lightTex, light: lightData, lightFrameIdx: -1, empty: true, smokeIdx: -1, frameIdx: -1, simulation: null });
    }
  }

  get shaderScenes() { return { offscreen: this.volumeScene, screen: this.compositeScene }; }

  setData(voxelData) {
    this.voxelData = voxelData;
    this.clips.clear(); this.lastTick = NaN; this.activeCount = 0;
    for (const slot of this.slots) { slot.mesh.visible = false; slot.cubes && (slot.cubes.visible = false); slot.smokeIdx = -1; slot.frameIdx = -1; slot.cubeFrameIdx = -1; slot.simulation = null; }
  }

  setVisible(visible) {
    this.lastTick = NaN; this.visible = visible;
    if (!visible) for (const slot of this.slots) { slot.mesh.visible = false; slot.cubes && (slot.cubes.visible = false); slot.smokeIdx = -1; slot.frameIdx = -1; slot.cubeFrameIdx = -1; slot.simulation = null; }
    this.activeCount = 0;
  }

  debugActiveCount() { return this.activeCount; }

  setGraphics(g) {
    if (g !== this.graphics) {
      this.graphics = g;
      this.setVisible(g !== `off`);
      if (g === `off` || g === `cubes`) { this.normalTarget?.dispose(); this.normalTarget = null; }
      for (let i = 0; i < this.activeCount; i++) { const s = this.slots[i]; if (g === `cubes` && s.cubeFrameIdx !== s.frameIdx) this.rebuildCubes(s); }
      this.refreshVisibility();
    }
  }

  setGpuTier(tier) {
    this.budget = SMOKE_QUALITY[tier];
    for (const slot of this.slots) { slot.material.uniforms.uSteps.value = this.budget.maxSteps; slot.material.uniforms.uStepLength.value = this.budget.stepLength; }
  }

  clearDisturbances() { this.shotCount.value = 0; this.blastCount.value = 0; }
  addShot(tick, sx, sy, sz, ex, ey, ez, radius, strength) {
    const c = this.shotCount.value;
    if (c >= MAX_SHOTS) return;
    this.shotStart[c].set(sx, sy, sz, radius);
    this.shotEnd[c].set(ex, ey, ez, clamp01(strength));
    this.shotCount.value++;
  }
  addBlast(x, y, z, radius) {
    const c = this.blastCount.value;
    if (c >= MAX_BLASTS) return;
    this.blasts[c].set(x, y, z, radius);
    this.blastCount.value++;
  }

  needsDepth(camera) {
    if (!this.visible || this.graphics === `cubes` || this.activeCount === 0) return false;
    if (!camera) return true;
    camera.updateMatrixWorld();
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);
    for (let i = 0; i < this.activeCount; i++) { const s = this.slots[i]; if (!s.empty && this.frustum.intersectsObject(s.mesh)) return true; }
    return false;
  }

  refreshVisibility() {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const on = this.visible && i < this.activeCount;
      s.mesh.visible = on && this.graphics !== `cubes` && !s.empty;
      s.cubes && (s.cubes.visible = on && this.graphics === `cubes`);
    }
  }

  applySceneDepth(depthTex, camera, resolution) {
    camera.getWorldDirection(this.fwd);
    for (let i = 0; i < this.activeCount; i++) {
      const u = this.slots[i].material.uniforms;
      u.uSceneDepth.value = depthTex;
      u.uResolution.value.copy(resolution);
      u.uCamNear.value = camera.near;
      u.uCamFar.value = camera.far;
      u.uCamForward.value.copy(this.fwd);
      u.uUseDepth.value = 1;
    }
  }

  /** 主渲染：降分辨率 ray march → 边缘感知放大到全屏 */
  render(renderer, camera, resolution) {
    if (!this.visible || this.graphics === `cubes` || this.activeCount === 0 || !this.screenBounds(camera, resolution)) return;
    // 降分辨率渲染目标
    this.normalSize.set(Math.max(1, Math.ceil(resolution.x * this.budget.resolutionScale)), Math.max(1, Math.ceil(resolution.y * this.budget.resolutionScale)));
    if (this.normalTarget) {
      if (this.normalTarget.width !== this.normalSize.x || this.normalTarget.height !== this.normalSize.y) this.normalTarget.setSize(this.normalSize.x, this.normalSize.y);
    } else {
      this.normalTarget = new WebGLRenderTarget(this.normalSize.x, this.normalSize.y, {
        type: renderer.extensions.has(`EXT_color_buffer_float`) ? FloatType : HalfFloatType,
        depthBuffer: false, stencilBuffer: false,
      });
      this.normalTarget.texture.minFilter = LinearFilter;
      this.normalTarget.texture.magFilter = LinearFilter;
    }
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = renderer.getClearColor(new Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const prevScissorTest = renderer.getScissorTest();
    const prevScissor = renderer.getScissor(new Vector4());
    try {
      for (let i = 0; i < this.activeCount; i++) this.slots[i].material.uniforms.uResolution.value.copy(this.normalSize);
      renderer.setRenderTarget(this.normalTarget);
      renderer.setClearColor(0, 0);
      renderer.clear();
      renderer.render(this.volumeScene, camera);
      const u = this.compositeMesh.material.uniforms;
      u.uSmoke.value = this.normalTarget.texture;
      u.uSceneDepth.value = this.slots[0].material.uniforms.uSceneDepth.value;
      u.uSourceSize.value.copy(this.normalSize);
      u.uCamNear.value = camera.near;
      u.uCamFar.value = camera.far;
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = false;
      if (!prevTarget) { // 全屏时用 scissor 裁剪到烟雾屏幕范围
        const r = this.scissorRect;
        const pr = renderer.getPixelRatio();
        renderer.setScissor(r.x / pr, r.y / pr, r.z / pr, r.w / pr);
        renderer.setScissorTest(true);
      }
      renderer.render(this.compositeScene, this.compositeCamera);
    } finally {
      renderer.setScissor(prevScissor);
      renderer.setScissorTest(prevScissorTest);
      renderer.autoClear = prevAutoClear;
      renderer.setClearColor(prevClearColor, prevClearAlpha);
      renderer.setRenderTarget(prevTarget);
    }
  }

  /** 计算所有烟雾体积在屏幕上的包围盒（用于 scissor 裁剪） */
  screenBounds(camera, resolution) {
    camera.updateMatrixWorld();
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const m = this.projectionView.elements;
    this.frustum.setFromProjectionMatrix(this.projectionView);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.activeCount; i++) {
      const s = this.slots[i];
      if (!s.mesh.visible) continue;
      const mn = s.material.uniforms.uMarchMin.value;
      const mx = s.material.uniforms.uMarchMax.value;
      if (!this.frustum.intersectsBox(this.marchBox.set(mn, mx))) continue;
      // 8 个角投影到屏幕，求屏幕包围盒
      const clip = this.cornerClip;
      for (let c = 0; c < 8; c++) {
        const x = c & 1 ? mx.x : mn.x, y = c & 2 ? mx.y : mn.y, z = c & 4 ? mx.z : mn.z;
        clip[c * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        clip[c * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        clip[c * 3 + 2] = m[3] * x + m[7] * y + m[11] * z + m[15];
      }
      const addPoint = (x, y, w) => { minX = Math.min(minX, x / w); maxX = Math.max(maxX, x / w); minY = Math.min(minY, y / w); maxY = Math.max(maxY, y / w); };
      for (let c = 0; c < 8; c++) {
        const w = clip[c * 3 + 2];
        if (w >= camera.near) addPoint(clip[c * 3], clip[c * 3 + 1], w);
        // 近平面裁剪（边与近平面交点）
        for (let bit = 1; bit < 8; bit <<= 1) {
          if (c & bit) continue;
          const j = c | bit;
          const wj = clip[j * 3 + 2];
          if (w >= camera.near === wj >= camera.near) continue;
          const t = (camera.near - w) / (wj - w);
          addPoint(clip[c * 3] + (clip[j * 3] - clip[c * 3]) * t, clip[c * 3 + 1] + (clip[j * 3 + 1] - clip[c * 3 + 1]) * t, camera.near);
        }
      }
    }
    const pad = 4 / this.budget.resolutionScale;
    const x0 = Math.max(0, Math.floor((minX * 0.5 + 0.5) * resolution.x - pad));
    const y0 = Math.max(0, Math.floor((minY * 0.5 + 0.5) * resolution.y - pad));
    const x1 = Math.min(resolution.x, Math.ceil((maxX * 0.5 + 0.5) * resolution.x + pad));
    const y1 = Math.min(resolution.y, Math.ceil((maxY * 0.5 + 0.5) * resolution.y + pad));
    if (x1 <= x0 || y1 <= y0) return false;
    this.scissorRect.set(x0, y0, x1 - x0, y1 - y0);
    return true;
  }

  /** 判断烟雾是否完全遮挡某段视线（用于音频/可见性判断） */
  obscuresSegment(a, b) {
    if (!this.visible || this.activeCount === 0) return false;
    for (let i = 0; i < this.activeCount; i++) {
      const s = this.slots[i];
      const boxMin = s.material.uniforms.uBoxMin.value;
      const boxSize = s.material.uniforms.uBoxSize.value;
      const opacity = s.material.uniforms.uOpacity.value;
      const blend = s.material.uniforms.uFrameBlend.value;
      const t = rayBoxIntersect(a, b, boxMin, boxSize);
      if (!t) continue;
      const length = b.distanceTo(a) * (t[1] - t[0]);
      const steps = Math.max(8, Math.min(64, Math.ceil(length / 12)));
      let opticalDepth = 0;
      for (let sIdx = 0; sIdx < steps; sIdx++) {
        const f = t[0] + ((sIdx + 0.5) / steps) * (t[1] - t[0]);
        const px = a.x + (b.x - a.x) * f, py = a.y + (b.y - a.y) * f, pz = a.z + (b.z - a.z) * f;
        const density = this.densityAt(s, px, py, pz, boxMin, boxSize, blend) * opacity * this.disturbanceAt(px, py, pz);
        opticalDepth += 0.32 * density * (length / steps);
        if (Math.exp(-opticalDepth) <= 0.06) return true;
      }
    }
    return false;
  }

  /** 每帧更新：分配烟雾槽位、推进模拟、写入 3D 纹理 */
  update(tick) {
    if (!this.visible) return 0;
    if (tick === this.lastTick) { this.refreshVisibility(); return this.activeCount; }
    // 收集当前活跃的烟雾 clip
    const active = [];
    for (let i = 0; i < this.voxelData.count && active.length < MAX_SMOKE_SLOTS; i++) {
      const clip = this.getClip(i);
      if (clip && tick < clip.tickBegin) continue;
      if (clip && tick >= clip.endTick) continue;
      if (clip) active.push({ idx: i, clip });
    }
    // 释放不再活跃的槽位
    for (const slot of this.slots)
      if (!active.some(({ idx }) => idx === slot.smokeIdx)) { slot.smokeIdx = -1; slot.frameIdx = -1; slot.simulation = null; }

    let n = 0;
    for (const { idx, clip } of active) {
      let slotIdx = this.slots.findIndex((s) => s.smokeIdx === idx);
      if (slotIdx < 0) slotIdx = this.slots.findIndex((s) => s.smokeIdx < 0);
      if (slotIdx !== n) [this.slots[n], this.slots[slotIdx]] = [this.slots[slotIdx], this.slots[n]];
      const frame = clip.frameForTick(tick);
      const age = (tick - clip.tickBegin) / 64;
      const dissipateTick = clip.dissipationFrame < clip.frameCount ? clip.tickForFrame(clip.dissipationFrame) : Math.max(clip.tickBegin, clip.endTick - 2 * 64);
      const opacityCurve = clamp01((clip.endTick - tick) / Math.max(1, clip.endTick - dissipateTick));
      const opacity = clamp01(age / 0.25) * smoothstep(0, 1, opacityCurve);
      const slot = this.slots[n];
      if (slot.smokeIdx !== idx || slot.frameIdx !== frame) {
        if (slot.smokeIdx !== idx || slot.simulation === null) slot.simulation = new SmokeSimulation(clip);
        slot.simulation.writeFramePair(frame, slot.data);
        slot.texture.needsUpdate = true;
        slot.smokeIdx = idx;
        slot.frameIdx = frame;
        slot.cubeFrameIdx = -1;
        slot.lightFrameIdx = -1;
        this.fitOccupiedBounds(slot, clip.detonation);
      }
      if (slot.lightFrameIdx !== frame && !slot.empty) {
        computeSmokeLight(slot.data, slot.light, this.lightScratch);
        slot.lightTexture.needsUpdate = true;
        slot.lightFrameIdx = frame;
      }
      const det = clip.detonation;
      slot.material.uniforms.uBoxMin.value.set(det[0] - 320, det[1] - 320, det[2] - 320);
      slot.material.uniforms.uBoxSize.value.setScalar(SMOKE_TEX_SIZE);
      slot.material.uniforms.uOrigin.value.set(det[0], det[1], det[2]);
      smokeColorOf(clip.color, slot.material.uniforms.uColor.value);
      slot.material.uniforms.uOpacity.value = opacity;
      slot.material.uniforms.uFrameBlend.value = clip.blendForTick(tick);
      slot.material.uniforms.uAge.value = age;
      if (this.graphics === `cubes` && slot.cubeFrameIdx !== frame) this.rebuildCubes(slot);
      if (slot.cubes) slot.cubes.position.set(det[0], det[1], det[2]);
      n++;
    }
    for (let i = n; i < MAX_SMOKE_SLOTS; i++) { this.slots[i].mesh.visible = false; this.slots[i].cubes && (this.slots[i].cubes.visible = false); this.slots[i].smokeIdx = -1; this.slots[i].simulation = null; }
    this.activeCount = n;
    this.lastTick = tick;
    this.refreshVisibility();
    return n;
  }

  /** 收缩体素包围盒到实际有烟雾的区域 */
  fitOccupiedBounds(slot, detonation) {
    let minX = 32, minY = 32, minZ = 32, maxX = -1, maxY = -1, maxZ = -1;
    const data = slot.data;
    for (let z = 0, idx = 0; z < 32; z++)
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++, idx++) {
          if (!data[idx * 2] && !data[idx * 2 + 1]) continue;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
    slot.empty = maxX < 0;
    if (slot.empty) return;
    const lo = (v, axis) => detonation[axis] - 320 + Math.max(0, v - 1) * 20;
    const hi = (v, axis) => detonation[axis] - 320 + Math.min(32, v + 2) * 20;
    const mn = slot.material.uniforms.uMarchMin.value.set(lo(minX, 0), lo(minY, 1), lo(minZ, 2));
    const mx = slot.material.uniforms.uMarchMax.value.set(hi(maxX, 0), hi(maxY, 1), hi(maxZ, 2));
    slot.mesh.position.addVectors(mn, mx).multiplyScalar(0.5);
    slot.mesh.scale.subVectors(mx, mn).divideScalar(SMOKE_TEX_SIZE);
    slot.mesh.updateMatrixWorld();
  }

  /** cubes 模式：把有烟雾的体素画成小方块（调试/低端机兜底） */
  rebuildCubes(slot) {
    let count = 0;
    for (let i = 0; i < 32 ** 3; i++) if (slot.data[i * 2] || slot.data[i * 2 + 1]) count++;
    let cubes = slot.cubes;
    if (!cubes || cubes.instanceMatrix.count < count) {
      const mat = cubes?.material ?? new ShaderMaterial({ glslVersion: `300 es`, uniforms: slot.material.uniforms, vertexShader: CUBE_VS, fragmentShader: CUBE_FS, depthTest: true, depthWrite: true });
      if (cubes) { this.scene.remove(cubes); cubes.dispose(); }
      const cap = 2 ** Math.ceil(Math.log2(Math.max(1, count)));
      cubes = new InstancedMesh(this.cubeGeo, mat, cap);
      cubes.instanceMatrix.setUsage(DynamicDrawUsage);
      cubes.frustumCulled = false;
      this.scene.add(cubes);
      slot.cubes = cubes;
    }
    let r = 0;
    for (let i = 0; i < 32 ** 3; i++) {
      if (!slot.data[i * 2] && !slot.data[i * 2 + 1]) continue;
      this.cubeMatrix.makeTranslation(((i % 32) + 0.5 - 16) * 20, ((Math.floor(i / 32) % 32) + 0.5 - 16) * 20, (Math.floor(i / (32 * 32)) + 0.5 - 16) * 20);
      cubes.setMatrixAt(r++, this.cubeMatrix);
    }
    cubes.count = count;
    cubes.position.copy(slot.material.uniforms.uOrigin.value);
    cubes.instanceMatrix.needsUpdate = true;
    slot.cubeFrameIdx = slot.frameIdx;
  }

  densityAt(slot, x, y, z, boxMin, boxSize, blend) {
    const ix = Math.floor(((x - boxMin.x) / boxSize.x) * 32);
    const iy = Math.floor(((y - boxMin.y) / boxSize.y) * 32);
    const iz = Math.floor(((z - boxMin.z) / boxSize.z) * 32);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= 32 || iy >= 32 || iz >= 32) return 0;
    const idx = (ix + 32 * (iy + 32 * iz)) * 2;
    return (slot.data[idx] + (slot.data[idx + 1] - slot.data[idx]) * blend) / 255;
  }

  /** 计算某点的扰动因子（子弹/爆炸把烟雾"吹开"） */
  disturbanceAt(x, y, z) {
    let r = 1;
    for (let i = 0; i < this.shotCount.value; i++) {
      const a = this.shotStart[i], b = this.shotEnd[i];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const lenSq = Math.max(dx ** 2 + dy ** 2 + dz ** 2, 0.001);
      const along = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / lenSq));
      const dist = Math.hypot(x - a.x - dx * along, y - a.y - dy * along, z - a.z - dz * along);
      r *= 1 - (1 - smoothstep(a.w * 0.4, a.w, dist)) * b.w;
    }
    for (let i = 0; i < this.blastCount.value; i++) {
      const a = this.blasts[i];
      r *= smoothstep(a.w * 0.65, a.w, Math.hypot(x - a.x, y - a.y, z - a.z));
    }
    return r;
  }

  getClip(idx) {
    let clip = this.clips.get(idx);
    if (clip !== undefined) return clip;
    clip = decodeSmokeClip(this.voxelData, idx); // nO
    this.clips.set(idx, clip);
    return clip;
  }

  dispose() {
    for (const slot of this.slots) {
      this.volumeScene.remove(slot.mesh);
      if (slot.cubes) { this.scene.remove(slot.cubes); slot.cubes.dispose(); slot.cubes.material.dispose(); }
      slot.material.dispose();
      slot.texture.dispose();
      slot.lightTexture.dispose();
      slot.simulation = null;
    }
    this.geo.dispose();
    this.cubeGeo.dispose();
    this.normalTarget?.dispose();
    this.compositeMesh.geometry.dispose();
    this.compositeMesh.material.dispose();
    this.formTexture.dispose();
    this.clips.clear();
  }
}

/** 创建烟雾 3D 纹理（原 NO） */
function makeSmokeTexture(data) {
  const tex = new Data3DTexture(data, 32, 32, 32);
  tex.format = RGFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** 预计算烟雾光照 3D 纹理（原 PO）：沿光照方向累积光学深度 */
function computeSmokeLight(density, out, scratch) {
  const lightDir = new Vector3(0.35, 0.2, 1).normalize();
  const stride = 32 * 32 * 2;
  const ox = lightDir.x / lightDir.z, oy = lightDir.y / lightDir.z;
  const fxo = Math.floor(ox), fyo = Math.floor(oy);
  const fx = ox - fxo, fy = oy - fyo;
  const stepAbsorb = (0.035 * 20) / lightDir.z / 255 / 8;
  let readBuf = 0, writeBuf = stride;
  scratch.fill(0, 0, stride);
  const sample = (x, y, ch) => (x < 0 || y < 0 || x >= 32 || y >= 32 ? 0 : scratch[readBuf + (x + 32 * y) * 2 + ch]);
  for (let z = 32 - 1; z >= 0; z--) {
    for (let y = 0; y < 32; y++) {
      const sy = y + fyo;
      for (let x = 0; x < 32; x++) {
        const sx = x + fxo;
        const cell = x + 32 * (y + 32 * z);
        for (let ch = 0; ch < 2; ch++) {
          const interp = (1 - fy) * ((1 - fx) * sample(sx, sy, ch) + fx * sample(sx + 1, sy, ch)) + fy * ((1 - fx) * sample(sx, sy + 1, ch) + fx * sample(sx + 1, sy + 1, ch));
          const d = density[cell * 2 + ch];
          scratch[writeBuf + (x + 32 * y) * 2 + ch] = interp + d;
          out[cell * 2 + ch] = Math.round(255 * Math.exp(-stepAbsorb * (interp + d * 0.5)));
        }
      }
    }
    [readBuf, writeBuf] = [writeBuf, readBuf];
  }
}

/** 形式噪声 3D 纹理（原 FO）：烟雾形态的随机扰动 */
function makeFormNoiseTexture() {
  const data = new Uint8Array(32 ** 3);
  for (let i = 0; i < data.length; i++) {
    let n = Math.imul(i ^ 2654435769, 569420461);
    n = Math.imul(n ^ (n >>> 15), 1935289751);
    data[i] = (n ^ (n >>> 15)) >>> 24;
  }
  const tex = new Data3DTexture(data, 32, 32, 32);
  tex.format = RedFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** 射线与 AABB 求交（原 IO） */
function rayBoxIntersect(a, b, boxMin, boxSize) {
  let tMin = 0, tMax = 1;
  for (const axis of [`x`, `y`, `z`]) {
    const d = b[axis] - a[axis];
    const lo = boxMin[axis], hi = lo + boxSize[axis];
    if (Math.abs(d) < 1e-6) { if (a[axis] < lo || a[axis] > hi) return null; continue; }
    let t1 = (lo - a[axis]) / d, t2 = (hi - a[axis]) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMax <= tMin) return null;
  }
  return [tMin, tMax];
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smoothstep(a, b, x) { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); }
