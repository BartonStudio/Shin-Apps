// ============================================================================
// 反混淆版本：弹道曳光/枪线 + 屏幕辉光后处理 + 枪口闪光
// 原始压缩文件：src/app/21-tracers.js
// 压缩类名：gk=LineSegments2子类, Ok=TracerRenderer, Ik=Bloom/Afterimage, 及辅助函数
// 说明：CS2 demo 回放中的"子弹轨迹"渲染。三块核心能力：
//   1. TracerRenderer（Ok）：把 demo 里的子弹起点/终点画成发光线段，
//      并对命中墙体的子弹做射线检测，把线截断在命中点 + 画命中标记
//   2. BloomCompositor（Ik）：屏幕空间辉光 + 余像（afterimage）后处理，
//      模拟闪光弹/爆炸的视觉冲击
//   3. 枪口闪光（Wk/Gk）：根据 flash 数据计算白屏/余像/曝光强度
//   另含：武器后坐力/准星晃动模拟（tA/nA）、确定性随机数（rA）
// ============================================================================

// ---------------------------------------------------------------------------
// LineSegments2 子类（原 gk）：three.js 的粗线段，补充 lineDistance 计算
// ---------------------------------------------------------------------------
class TracerLineSegments extends LineSegments2 {
  constructor(geometry = new LineSegmentsGeometry(), material = new LineMaterial({ color: Math.random() * 0xffffff })) {
    super(geometry, material);
    this.isLineSegments2 = true;
    this.type = `LineSegments2`;
  }

  /** 计算线段累计距离（用于 shader 里的虚线/渐变） */
  computeLineDistances() {
    const geometry = this.geometry;
    const start = geometry.attributes.instanceStart;
    const end = geometry.attributes.instanceEnd;
    const distances = new Float32Array(2 * start.count);
    const vStart = new Vector3();
    const vEnd = new Vector3();
    for (let i = 0, j = 0, n = start.count; i < n; i++, j += 2) {
      vStart.fromBufferAttribute(start, i);
      vEnd.fromBufferAttribute(end, i);
      distances[j] = j === 0 ? 0 : distances[j - 1];
      distances[j + 1] = distances[j] + vStart.distanceTo(vEnd);
    }
    const interleaved = new InterleavedBuffer(distances, 2, 1);
    geometry.setAttribute(`instanceDistanceStart`, new InterleavedBufferAttribute(interleaved, 1, 0));
    geometry.setAttribute(`instanceDistanceEnd`, new InterleavedBufferAttribute(interleaved, 1, 1));
    return this;
  }
}

// ---------------------------------------------------------------------------
// 常量（原 _k/vk/yk/bk/xk/Sk/Ck/wk/Tk/Ek/Dk）
// ---------------------------------------------------------------------------
const TRACER_FADE_TICKS = 64;           // _k：曳光弹淡出时长（tick）
const TRACER_FADE_SHORT = Math.round(0.1 * 64); // vk：短淡出（命中后？）
const TRACER_FADE_LONG = Math.round(3 * 64);    // yk：长淡出
const MAX_TRACERS = 128;                // bk：最大同时渲染的曳光线段数
const MAX_IMPACTS = 512;                // xk：最大命中标记数
const COLOR_CT = new Color(12876324);   // Sk：CT 队（蓝）
const COLOR_T = new Color(2653121);     // Ck：T 队（黄）
const COLOR_OTHER = new Color(5792109); // wk：其他
const IMPACT_COLOR = new Color(9147036); // Tk：命中标记颜色
const TRACER_LINEWIDTH = 3;             // Ek：曳光线宽
const IMPACT_RADIUS = 2.4;              // Dk：命中标记半径

/** 队伍 → 颜色 */
function teamColor(team) {
  return team === 2 ? COLOR_CT : team === 3 ? COLOR_T : COLOR_OTHER;
}

/** 二分查找：第一个 tick >= n 的下标（原 Ak） */
function lowerBoundTick(ticks, count, n) {
  let lo = 0, hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    ticks[mid] < n ? (lo = mid + 1) : (hi = mid);
  }
  return lo;
}

/** 二分查找：第一个 tick > n 的下标（原 jk） */
function upperBoundTick(ticks, count, n) {
  let lo = 0, hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    ticks[mid] <= n ? (lo = mid + 1) : (hi = mid);
  }
  return lo;
}

// ---------------------------------------------------------------------------
// 弹道渲染器（原 Ok）
// ---------------------------------------------------------------------------
class TracerRenderer {
  scene;
  data;            // 子弹数据（origin/end/team/hitKind/tick）
  geometry;
  material;
  positions;       // 线段顶点缓冲
  colors;          // 线段颜色缓冲
  opacityAttribute;
  lines;           // LineSegments2 对象
  markerColor = new Color();
  markerMatrix = new Matrix4();
  lastSegCount = 0;
  impacts;         // 命中标记 InstancedMesh
  impactState;     // 命中检测状态缓存（0=未算，1=命中，2=未命中）
  impactPos;       // 命中点缓存
  mapObject = null;
  raycaster = new Raycaster();
  rayOrigin = new Vector3();
  rayDir = new Vector3();

  constructor(scene, data, renderer) {
    this.scene = scene;
    this.data = data;
    this.positions = new Float32Array(MAX_TRACERS * 6);
    this.colors = new Float32Array(MAX_TRACERS * 6);
    this.geometry = new LineSegmentsGeometry();
    this.geometry.setPositions(this.positions.subarray(0, 6));
    this.geometry.setColors(this.colors.subarray(0, 6));
    // 每段独立的透明度属性
    this.opacityAttribute = new InstancedBufferAttribute(new Float32Array(MAX_TRACERS), 1);
    this.opacityAttribute.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute(`instanceOpacity`, this.opacityAttribute);
    this.material = new LineMaterial({ vertexColors: true, transparent: true, linewidth: TRACER_LINEWIDTH, blending: AdditiveBlending, depthWrite: false });

    // 给 LineMaterial 注入逐段透明度的 shader 补丁
    const vsMarker = `void main() {`;
    const fsMarker = `gl_FragColor = vec4( diffuseColor.rgb, alpha );`;
    if (!this.material.vertexShader.includes(vsMarker) || !this.material.fragmentShader.includes(fsMarker))
      throw Error(`LineMaterial shader no longer supports per-tracer opacity`);
    this.material.vertexShader =
      `\n      attribute float instanceOpacity;\n      varying float vTracerOpacity;\n    ` +
      this.material.vertexShader.replace(vsMarker, `${vsMarker}\n vTracerOpacity = instanceOpacity;`);
    this.material.fragmentShader =
      `varying float vTracerOpacity;\n` +
      this.material.fragmentShader.replace(fsMarker, `gl_FragColor = vec4( diffuseColor.rgb, alpha * vTracerOpacity );`);

    const size = renderer.getSize(new Vector2());
    this.material.resolution.set(size.x, size.y);
    this.lines = new TracerLineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
    this.impactState = new Int8Array(data.count);
    this.impactPos = new Float32Array(data.count * 3);

    // 命中标记（小球 instanced）
    const markerGeom = new SphereGeometry(IMPACT_RADIUS, 6, 5);
    const markerMat = new MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
    this.impacts = new InstancedMesh(markerGeom, markerMat, MAX_IMPACTS);
    this.impacts.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_IMPACTS * 3), 3);
    this.impacts.frustumCulled = false;
    this.impacts.count = 0;
    scene.add(this.impacts);
  }

  setData(data) {
    this.data = data;
    this.impactState = new Int8Array(data.count);
    this.impactPos = new Float32Array(data.count * 3);
    this.lastSegCount = 0;
    this.lines.visible = false;
    this.impacts.count = 0;
  }

  setMapObject(obj) {
    if (obj !== this.mapObject) { this.mapObject = obj; this.impactState.fill(0); }
  }

  /** 每帧更新：筛选出当前 tick 附近的子弹，更新线段与命中标记 */
  update(tick) {
    const { tick: ticks, count } = this.data;
    if (count === 0) return;

    const upper = upperBoundTick(ticks, count, tick);          // tick <= 当前
    const lowerImpacts = lowerBoundTick(ticks, count, tick - TRACER_FADE_LONG);

    // 1. 命中标记：最近 TRACER_FADE_LONG 内、且命中墙体的子弹
    let impactCount = 0;
    for (let i = lowerImpacts; i < upper; i++) {
      if (this.data.hitKind[i] === 1) continue; // hitKind=1 表示未命中，跳过
      const age = tick - ticks[i];
      const fade = 1 - age / TRACER_FADE_LONG;
      if (fade <= 0 || impactCount >= MAX_IMPACTS) continue;
      if (this.ensureImpact(i) !== 1) continue; // 需要命中点
      const p = i * 3;
      this.markerMatrix.makeTranslation(this.impactPos[p], this.impactPos[p + 1], this.impactPos[p + 2]);
      this.impacts.setMatrixAt(impactCount, this.markerMatrix);
      this.markerColor.copy(IMPACT_COLOR).multiplyScalar(0.4 + 0.6 * fade);
      this.impacts.setColorAt(impactCount, this.markerColor);
      impactCount++;
    }
    this.impacts.count = impactCount;
    if (impactCount > 0) {
      this.impacts.instanceMatrix.needsUpdate = true;
      if (this.impacts.instanceColor) this.impacts.instanceColor.needsUpdate = true;
    }

    // 2. 曳光线段：最近 TRACER_FADE_SHORT 内的子弹
    const lowerTracers = lowerBoundTick(ticks, count, tick - TRACER_FADE_SHORT);
    let segCount = 0;
    for (let i = lowerTracers; i < upper && segCount < MAX_TRACERS; i++) {
      const fade = 1 - (tick - ticks[i]) / TRACER_FADE_SHORT;
      if (fade <= 0) continue;
      const color = teamColor(this.data.team[i]);
      const p = i * 3;
      let ex = this.data.end[p], ey = this.data.end[p + 1], ez = this.data.end[p + 2];
      // 命中墙体的子弹：线段终点截断到命中点
      if (this.data.hitKind[i] !== 1 && this.ensureImpact(i) === 1) {
        ex = this.impactPos[p]; ey = this.impactPos[p + 1]; ez = this.impactPos[p + 2];
      }
      const o = segCount * 6;
      this.positions[o] = this.data.origin[p];
      this.positions[o + 1] = this.data.origin[p + 1];
      this.positions[o + 2] = this.data.origin[p + 2];
      this.positions[o + 3] = ex;
      this.positions[o + 4] = ey;
      this.positions[o + 5] = ez;
      this.colors[o] = color.r; this.colors[o + 1] = color.g; this.colors[o + 2] = color.b;
      this.colors[o + 3] = color.r; this.colors[o + 4] = color.g; this.colors[o + 5] = color.b;
      this.opacityAttribute.setX(segCount, fade);
      segCount++;
    }

    if (segCount > 0) {
      this.geometry.setPositions(this.positions.subarray(0, segCount * 6));
      this.geometry.setColors(this.colors.subarray(0, segCount * 6));
      this.opacityAttribute.needsUpdate = true;
      this.lines.visible = true;
    } else {
      this.lines.visible = false;
    }
    this.lastSegCount = segCount;
  }

  resize(w, h) { this.material.resolution.set(w, h); }

  setRenderScale(scale) {
    if (![0.5, 0.75, 1].includes(scale)) throw new RangeError(`Invalid tracer render resolution`);
    this.material.linewidth = TRACER_LINEWIDTH * scale;
  }

  debugCount() { return this.lastSegCount; }

  /** 查询第 i 颗子弹的命中点 */
  impactAt(i, out) {
    if (i < 0 || i >= this.impactState.length || this.ensureImpact(i) !== 1) return false;
    out.fromArray(this.impactPos, i * 3);
    return true;
  }

  /**
   * 惰性计算第 i 颗子弹与地图的命中点（带缓存）
   * @returns 1=命中，2=未命中，0=无法计算
   */
  ensureImpact(i) {
    const cached = this.impactState[i];
    if (cached !== 0) return cached;
    if (!this.mapObject) return 0;

    const p = i * 3;
    const ox = this.data.origin[p], oy = this.data.origin[p + 1], oz = this.data.origin[p + 2];
    const dx = this.data.end[p] - ox, dy = this.data.end[p + 1] - oy, dz = this.data.end[p + 2] - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.001) { this.impactState[i] = 2; return 2; }

    this.rayOrigin.set(ox, oy, oz);
    this.rayDir.set(dx / len, dy / len, dz / len);
    this.raycaster.set(this.rayOrigin, this.rayDir);
    this.raycaster.far = len;
    const hit = this.raycaster.intersectObject(this.mapObject, true)[0];
    if (hit) {
      this.impactPos[p] = hit.point.x;
      this.impactPos[p + 1] = hit.point.y;
      this.impactPos[p + 2] = hit.point.z;
      this.impactState[i] = 1;
      return 1;
    }
    this.impactState[i] = 2;
    return 2;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.lines);
    this.impacts.geometry.dispose();
    this.impacts.material.dispose();
    this.scene.remove(this.impacts);
  }
}

// ---------------------------------------------------------------------------
// 屏幕辉光 + 余像后处理（原 Ik）
// ---------------------------------------------------------------------------
const BLUR_DOWNSCALE = 8;  // Nk：辉光缓冲降采样倍数
const EXPOSURE_MIN = 0.004; // Pk
const AFTERIMAGE_MAX = 0.995; // Fk

// 全屏 quad 的顶点 shader
const FULLSCREEN_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

class BloomCompositor {
  camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  glowScene = new Scene();
  compositeScene = new Scene();
  glowMaterial;     // 提取高光（bloom 掩码）
  compositeMaterial; // 合成（曝光 + 辉光 + 余像）
  size = new Vector2();
  live = null;      // 当前帧纹理
  shot = null;      // 上次"快照"纹理（余像来源）
  glow = null;      // 辉光降采样缓冲
  shotKey = null;   // 快照缓存键

  constructor() {
    const quad = new PlaneGeometry(2, 2);
    // 辉光提取：4 邻域采样，只保留高光
    this.glowMaterial = new ShaderMaterial({
      uniforms: { uLive: { value: null }, uTexel: { value: new Vector2() } },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: `uniform sampler2D uLive; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          vec3 sum = texture2D(uLive, vUv + vec2(-2.0, -2.0) * uTexel).rgb
            + texture2D(uLive, vUv + vec2(2.0, -2.0) * uTexel).rgb
            + texture2D(uLive, vUv + vec2(-2.0, 2.0) * uTexel).rgb
            + texture2D(uLive, vUv + vec2(2.0, 2.0) * uTexel).rgb;
          gl_FragColor = vec4(max(sum * 0.25 - 0.45, 0.0) * 1.8, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    // 合成：曝光曲线 + 辉光叠加 + 余像混合
    this.compositeMaterial = new ShaderMaterial({
      uniforms: {
        uLive: { value: null }, uGlow: { value: null }, uShot: { value: null },
        uGlowTexel: { value: new Vector2() }, uShotTexel: { value: new Vector2() },
        uExposure: { value: 0 }, uAfterimage: { value: 0 },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: `uniform sampler2D uLive; uniform sampler2D uGlow; uniform sampler2D uShot;
        uniform vec2 uGlowTexel; uniform vec2 uShotTexel; uniform float uExposure; uniform float uAfterimage;
        varying vec2 vUv;
        vec3 expose(vec3 c, float k) { return 1.0 - pow(max(1.0 - c, 0.0), vec3(1.0 + k)); }
        void main() {
          vec3 color = expose(texture2D(uLive, vUv).rgb, uExposure * 2.5);
          vec3 glow = (texture2D(uGlow, vUv).rgb * 2.0
            + texture2D(uGlow, vUv + vec2(-1.0, -1.0) * uGlowTexel).rgb
            + texture2D(uGlow, vUv + vec2(1.0, -1.0) * uGlowTexel).rgb
            + texture2D(uGlow, vUv + vec2(-1.0, 1.0) * uGlowTexel).rgb
            + texture2D(uGlow, vUv + vec2(1.0, 1.0) * uGlowTexel).rgb) / 6.0;
          color = 1.0 - (1.0 - color) * (1.0 - min(glow * uExposure * 1.6, 1.0));
          if (uAfterimage > 0.0) {
            vec3 shot = (texture2D(uShot, vUv + vec2(-1.5, -1.5) * uShotTexel).rgb
              + texture2D(uShot, vUv + vec2(1.5, -1.5) * uShotTexel).rgb
              + texture2D(uShot, vUv + vec2(-1.5, 1.5) * uShotTexel).rgb
              + texture2D(uShot, vUv + vec2(1.5, 1.5) * uShotTexel).rgb) * 0.25;
            color = mix(color, expose(shot, 1.5), uAfterimage * 0.85);
          }
          gl_FragColor = vec4(color, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });

    for (const [scene, material] of [[this.glowScene, this.glowMaterial], [this.compositeScene, this.compositeMaterial]]) {
      const quadMesh = new Mesh(quad, material);
      quadMesh.frustumCulled = false;
      scene.add(quadMesh);
    }
  }

  /**
   * 渲染后处理：从当前帧缓冲采样 → 提取辉光 → 合成输出
   * @param {WebGLRenderer} renderer
   * @param {*} shotKey 快照键（变化时更新余像快照）
   * @param {number} afterimage 余像强度
   * @param {number} exposure 曝光强度
   */
  render(renderer, shotKey, afterimage, exposure) {
    if (shotKey === null) { this.shotKey = null; return; }
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(null);
      this.ensureSize(renderer);
      if (shotKey !== this.shotKey) { renderer.copyFramebufferToTexture(this.shot); this.shotKey = shotKey; }
      if (afterimage >= AFTERIMAGE_MAX || (exposure < EXPOSURE_MIN && afterimage < EXPOSURE_MIN)) return;

      renderer.copyFramebufferToTexture(this.live);
      renderer.autoClear = false;
      renderer.setRenderTarget(this.glow);
      renderer.render(this.glowScene, this.camera);
      renderer.setRenderTarget(null);

      const u = this.compositeMaterial.uniforms;
      u.uExposure.value = exposure;
      u.uAfterimage.value = afterimage;
      renderer.render(this.compositeScene, this.camera);
    } finally {
      renderer.autoClear = prevAutoClear;
      renderer.setRenderTarget(prevTarget);
    }
  }

  /** 按渲染缓冲尺寸重建纹理（尺寸变化时） */
  ensureSize(renderer) {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    if (this.live && this.live.image.width === w && this.live.image.height === h) return;

    this.live?.dispose();
    this.shot?.dispose();
    this.glow?.dispose();
    this.live = makeTexture(w, h);
    this.shot = makeTexture(w, h);
    this.shotKey = null;

    const gw = Math.max(1, Math.ceil(w / BLUR_DOWNSCALE));
    const gh = Math.max(1, Math.ceil(h / BLUR_DOWNSCALE));
    this.glow = new WebGLRenderTarget(gw, gh, { depthBuffer: false, stencilBuffer: false });
    this.glow.texture.minFilter = LinearFilter;
    this.glow.texture.magFilter = LinearFilter;
    this.glowMaterial.uniforms.uLive.value = this.live;
    this.glowMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);

    const u = this.compositeMaterial.uniforms;
    u.uLive.value = this.live;
    u.uShot.value = this.shot;
    u.uGlow.value = this.glow.texture;
    u.uGlowTexel.value.set(1 / gw, 1 / gh);
    u.uShotTexel.value.set(1 / w, 1 / h);
  }

  dispose() {
    this.live?.dispose();
    this.shot?.dispose();
    this.glow?.dispose();
    this.glowMaterial.dispose();
    this.compositeMaterial.dispose();
    this.compositeScene.children[0].geometry.dispose();
  }
}

/** 创建线性过滤纹理（原 Lk） */
function makeTexture(w, h) {
  const tex = new DataTexture(new Uint8Array(w * h * 4), w, h);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

// ---------------------------------------------------------------------------
// 枪口闪光分析（原 Wk/Gk/Kk）
// ---------------------------------------------------------------------------
const FLASH_MIN_DURATION = 5.2; // Bk：闪光最短持续时间（tick）
const FLASH_FULL_WHITE = 3;     // Vk：全白阶段时长
const FLASH_REDUCED_FACTOR = 0.6; // Hk
const FLASH_SCAN_WINDOW = 1024; // Uk：回溯扫描窗口

/** 钳制到 [0,1]，NaN 归零（原 Rk） */
function clamp01(x) { return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0; }
/** 除零保护 + 钳制（原 zk） */
function safeClamp01(x) { return !Number.isFinite(x) || x <= 0 ? 0 : clamp01(x); }

/**
 * 找到某玩家某时刻的"闪光事件"起始与强度（原 Wk）
 * @returns {{onsetTick, duration, maxAlpha}|null}
 */
function findFlash(flashData, numPlayers, player, tick, tickRate) {
  const ticks = flashData.frameTick;
  if (!ticks.length || player < 0 || player >= numPlayers || !(tickRate > 0) || tick < ticks[0]) return null;

  // 二分找最近帧
  let lo = 0, hi = ticks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    ticks[mid] <= tick ? (lo = mid) : (hi = mid - 1);
  }
  const flashAt = (i) => flashData.flash[i * numPlayers + player];
  if (!(flashAt(lo) > 0)) return null;

  // 向前回溯，找闪光起点（强度突变处）
  let start = lo;
  while (start > 0 && lo - start < FLASH_SCAN_WINDOW) {
    const prev = flashAt(start - 1), cur = flashAt(start);
    const step = (ticks[start] - ticks[start - 1]) / tickRate;
    if (!(prev > 0) || cur > prev + 0.001 || prev - cur > step + 0.1) break;
    start--;
  }
  const duration = flashAt(start);
  const rawAlpha = flashData.flashAlpha[start * numPlayers + player];
  const maxAlpha = clamp01(rawAlpha / Math.sqrt(Math.min(1, duration / FLASH_MIN_DURATION)));
  return { onsetTick: ticks[start], duration, maxAlpha };
}

/** 根据闪光事件计算当前帧的视觉强度（原 Gk） */
function flashIntensity(event, tick, tickRate) {
  if (!event || !(event.duration > 0) || !(tickRate > 0)) return { remaining: 0, white: 0, afterimage: 0, exposure: 0 };
  const remaining = Math.max(0, event.duration - Math.max(0, tick - event.onsetTick) / tickRate);
  if (remaining <= 0) return { remaining: 0, white: 0, afterimage: 0, exposure: 0 };
  const strength = event.duration > FLASH_FULL_WHITE
    ? Math.min(1, remaining / FLASH_FULL_WHITE)
    : FLASH_REDUCED_FACTOR * Math.min(1, remaining / event.duration);
  const alpha = clamp01(event.maxAlpha);
  return {
    remaining,
    white: strength * strength * alpha,
    afterimage: strength * alpha,
    exposure: Math.sqrt(strength) * alpha,
  };
}

/** 按模式调整闪光强度（原 Kk）：indicator/reduced 会削弱 */
function modulateFlash(intensity, mode) {
  if (mode === `indicator`) return { ...intensity, white: 0, afterimage: 0, exposure: 0 };
  if (mode === `reduced`) return { ...intensity, white: Math.min(0.35, intensity.white), afterimage: 0, exposure: 0 };
  if (mode === `full`) return intensity;
  return {
    remaining: intensity.remaining,
    white: Math.min(0.72, intensity.white),
    afterimage: Math.min(0.72, intensity.afterimage),
    exposure: intensity.exposure,
  };
}

// ---------------------------------------------------------------------------
// 武器后坐力 / 准星晃动模拟（原 tA/nA/rA）
// ---------------------------------------------------------------------------
// 各武器后坐力参数：[上跳幅度, 散布, 后坐力恢复速率]（源自 CS2 手感）
const WEAPON_RECOIL = {
  "AK-47": [30, 0, 70], M4A4: [23, 0, 70], "M4A1-S": [25, 3, 65],
  AWP: [78, 15, 20], "SSG 08": [33, 15, 20], FAMAS: [20, 1, 60],
  "Galil AR": [21, 1, 70], AUG: [24, 0, 60], "SG 553": [28, 2, 60],
  SCAR20: [31, 4, 30], G3SG1: [30, 4, 30], "MAC-10": [18, 1, 70],
  MP9: [21, 1, 70], MP7: [16, 1, 70], "MP5-SD": [16, 1, 70],
  "PP-Bizon": [18, 1, 70], P90: [16, 1, 70], "UMP-45": [23, 1, 40],
  M249: [25, 2, 50], Negev: [20, 2, 0], Nova: [143, 22, 20],
  XM1014: [80, 20, 20], MAG7: [165, 25, 20], "Sawed-Off": [143, 22, 20],
  "Desert Eagle": [48.2, 18, 60], "Glock-18": [18, 0, 20], "USP-S": [29, 0, 0],
  P2000: [26, 0, 0], P250: [26, 3, 10], "Five-SeveN": [25, 4, 5],
  "Tec-9": [23, 3, 60], "CZ75-Auto": [31, 6, 120], "Dual Berettas": [27, 4, 20],
  "R8 Revolver": [20, 0, 40],
};

const RECOIL_MAX_RATE = 18;    // Jk：后坐力恢复速率上限
const RECOIL_DAMP = 0.9;       // Yk：整体阻尼
const RECOIL_STEP = 1 / 128;   // Xk：积分步长（秒）
const RECOIL_WINDOW = 1.5;     // Zk：后坐力回溯窗口（秒）
const RECOIL_QUEUE = 128;      // Qk：射击队列容量

/** 确定性伪随机数（原 rA），返回 [-1, 1] */
function seededNoise(player, tick, salt) {
  let r = Math.imul(tick ^ 2654435769, 2246822507) ^ Math.imul(player + 1, 3266489909) ^ Math.imul(salt, 668265263);
  r = Math.imul(r ^ (r >>> 15), 739982445);
  r = Math.imul(r ^ (r >>> 12), 695872825);
  r ^= r >>> 15;
  return ((r >>> 0) / 4294967295) * 2 - 1;
}

const shotTicks = new Int32Array(RECOIL_QUEUE);

/**
 * 计算某玩家某时刻的后坐力偏移（pitch/yaw）
 * 原理：回溯最近 RECOIL_WINDOW 内的射击事件，累加每次射击造成的准星上跳，
 *   并模拟恢复（recovery）衰减
 */
function computeRecoil(state, player, tick, out) {
  out.pitch = 0; out.yaw = 0;
  const fires = state.weaponFires;
  const { panelFrames, weaponNames } = state;
  if (!fires || fires.ticks.length === 0 || tick < fires.ticks[0] || panelFrames.frameTick.length === 0) return out;

  const frameIdx = upperBoundTick(panelFrames.frameTick, panelFrames.frameTick.length, tick);
  const weapon = weaponNames[panelFrames.activeWeapon[frameIdx * state.meta.numPlayers + player]] ?? ``;
  const params = WEAPON_RECOIL[weapon];
  if (!params) return out;

  const tickRate = state.meta.tickRate;
  const windowTicks = RECOIL_WINDOW * tickRate;
  // 回溯收集该玩家最近 RECOIL_QUEUE 次射击的 tick
  let count = 0;
  for (let i = upperBoundTick(fires.ticks, fires.ticks.length, tick); i >= 0 && count < RECOIL_QUEUE; i--) {
    const t = fires.ticks[i];
    if ((count === 0 ? tick : shotTicks[count - 1]) - t > windowTicks) break;
    if (fires.slots[i] === player) shotTicks[count++] = t;
  }
  if (count === 0) return out;

  const acc = { pitch: 0, yaw: 0, velPitch: 0, velYaw: 0 };
  const [rise, spread, recovery] = params;
  for (let i = count - 1; i >= 0; i--) {
    if (i < count - 1) recoilIntegrate(acc, (shotTicks[i] - shotTicks[i + 1]) / tickRate);
    const angle = recovery * seededNoise(player, shotTicks[i], 1) * (Math.PI / 180);
    const magnitude = rise + spread * seededNoise(player, shotTicks[i], 2);
    acc.velPitch -= Math.cos(angle) * magnitude;
    acc.velYaw -= Math.sin(angle) * magnitude;
  }
  recoilIntegrate(acc, (tick - shotTicks[0]) / tickRate);
  out.pitch = acc.pitch * RECOIL_DAMP;
  out.yaw = acc.yaw * RECOIL_DAMP;
  return out;
}

/** 后坐力阻尼积分（原 nA）：指数衰减 + 速度耦合 */
function recoilIntegrate(acc, dt) {
  while (dt > 1e-9) {
    const step = Math.min(RECOIL_STEP, dt);
    dt -= step;
    const decayPos = Math.exp(-8 * step);
    acc.pitch *= decayPos; acc.yaw *= decayPos;
    const mag = Math.hypot(acc.pitch, acc.yaw);
    const rateCap = RECOIL_MAX_RATE * step;
    const soften = mag > rateCap ? 1 - rateCap / mag : 0;
    acc.pitch = acc.pitch * soften + acc.velPitch * step * 0.5;
    acc.yaw = acc.yaw * soften + acc.velYaw * step * 0.5;
    const decayVel = Math.exp(-4.5 * step);
    acc.velPitch *= decayVel; acc.velYaw *= decayVel;
    acc.pitch += acc.velPitch * step * 0.5;
    acc.yaw += acc.velYaw * step * 0.5;
  }
}
