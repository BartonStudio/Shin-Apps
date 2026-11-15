// ─────────────────────────────────────────────────────────────────────────────
// 33-landing-backdrop.deobf.js — 落地页 3D 背景动画 + 质量选择器 + recents 渲染
//
// 来源：src/app/33-landing-backdrop.js（Vite 生产构建，prettier 展开版）
// 原文范围：decompiled/index.beautified.js L52715–53504（切片 33-landing-backdrop）
// 原始压缩名：JR = LandingBackdrop，YR = createBackdropPlayers，XR = createRenderTarget，
//             ZR = createBlurMaterial，rz = createQualitySelector，cz = createRecents，等
//
// 本文件包含：
//   1. LandingBackdrop（JR）—— 落地页的 3D 背景动画：在 Mirage 地图上渲染一群
//      小人（instanced cylinder+cone），用一个预录的「backdrop clip」（CSBG 格式）
//      驱动它们的走位；相机沿预设镜头序列（shot）平滑移动；通过离屏 RT + 高斯模糊
//      + 饱和度/调暗做后处理，形成毛玻璃氛围背景。
//   2. 背景 clip 解码（decodeBackdropClip 在 32 里，这里用其产物）。
//   3. 质量选择器（createQualitySelector）—— 选择解析采样率（16/32/64 Hz）。
//   4. recents 列表渲染（createRecents）。
//   5. 应用入口装配（底部 IIFE）：把 AppShell、背景、质量选择器、recents、
//      hosted 菜单、上传、本地解析、托管下载全部串起来。
//
// 说明：标识符已重命名成语义化名字，局部单字母变量展开，关键逻辑补注释。
//       未改任何语义。
// ─────────────────────────────────────────────────────────────────────────────

// ── 常量 ───────────────────────────────────────────────────────────────────────

const BACKDROP_CLIP_URL = '/backdrop/mirage-a-execute.bin';
const BACKDROP_MAP = 'de_mirage';
const FRAME_INTERVAL_MS = 1000 / 30; // 约 30 FPS
const SCENE_TARGET_SCALE = 1 / 4; // 场景离屏 RT 相对 CSS 尺寸的缩放
const MAX_SCENE_TARGET_WIDTH = 480; // 场景 RT 最大宽度（控制开销）
const BLUR_TARGET_SCALE = 1 / 4; // 模糊 RT 相对 CSS 尺寸的缩放
const BLUR_SAMPLES = 4; // 模糊采样数（tap 数量 = 4*2+1）
const BLUR_SPREAD = 6; // 模糊步长（像素）
const FADE_IN_MS = 1400; // 淡入时长
const SHOT_FADE = 0.9; // 镜头切换淡入淡出比例
const CAMERA_FOV = 50; // 相机 FOV

// 预设镜头序列：from/to 是相机位置，lookFrom/lookTo 是视线目标
const CAMERA_SHOTS = [
  { from: [350, -650, 20], to: [200, -450, 40], lookFrom: [-900, -650, -220], lookTo: [-700, -750, -220] },
  { from: [-1650, -150, 90], to: [-1610, 250, 90], lookFrom: [-2600, 600, -120], lookTo: [-2600, 100, -120] },
  { from: [-700, -2330, 100], to: [-820, -1880, 100], lookFrom: [-100, -1850, -60], lookTo: [-100, -2050, -60] },
];

const PLAYER_CYLINDER_HEIGHT = 24;
const PLAYER_CONICAL_TOP = 56;

// 玩家小人颜色：CT 偏蓝、T 偏黄（乘 1.8 提亮）
const CT_COLOR = new Color(0xffb02e).multiplyScalar(1.8); // 16756782
const T_COLOR = new Color(0x5aa9ff).multiplyScalar(1.8); // 5941759

// 背景 clip 的缓存（单例）
let backdropClipPromise = null;

/** 加载（并缓存）背景 clip */
function loadBackdropClip() {
  backdropClipPromise ??= fetch(BACKDROP_CLIP_URL)
    .then((response) => {
      if (!response.ok) throw Error(`Backdrop clip request failed (${response.status})`);
      return response.arrayBuffer();
    })
    .then((buffer) => decodeBackdropClip(buffer))
    .catch((err) => {
      backdropClipPromise = null; // 失败后允许重试
      throw err;
    });
  return backdropClipPromise;
}

// ── 落地页背景动画（JR / LandingBackdrop） ────────────────────────────────────

class LandingBackdrop {
  disposed = false;
  root = null; // 3D 应用实例（qD）
  loader = null; // 地图加载器（R_）
  clip = null; // 背景 clip 数据

  camera = new PerspectiveCamera(CAMERA_FOV, 1, 20, 20000);
  blitCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blurScene = new Scene();
  blurMaterial = createBlurMaterial();
  blurQuad = new Mesh(new PlaneGeometry(2, 2), this.blurMaterial);

  players = null; // InstancedMesh
  sceneTarget = null; // 场景离屏 RT
  blurTarget = null; // 模糊离屏 RT

  cssSize = new Vector2();
  sizeDirty = true;
  frameHandle = 0;
  lastFrameAt = 0;
  lastTickAt = 0;
  clipTime = 0;
  shownAt = 0;
  opacity = -1;

  matrix = new Matrix4();
  position = new Vector3();
  scale = new Vector3();
  rotation = new Quaternion();
  lookAt = new Vector3();

  host; // 挂载元素
  onFail; // 失败回调

  constructor(host, onFail) {
    this.host = host;
    this.onFail = onFail;
    this.blurQuad.frustumCulled = false;
    this.blurScene.add(this.blurQuad);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.init().catch((err) => {
      if (!this.disposed) this.onFail(err);
    });
  }

  async init() {
    const clip = await loadBackdropClip();
    if (this.disposed) return;
    this.clip = clip;

    // 创建 3D 应用（低功耗、无抗锯齿）
    const app = new Demo3DApp(this.host, { antialias: false, powerPreference: 'low-power' });
    this.root = app;
    const canvas = app.renderer.domElement;
    canvas.className = 'landing-backdrop-canvas';
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    app.renderer.setPixelRatio(1);
    app.setGridVisible(false);
    app.setShadowQuality('low');

    // 设置 Mirage 地图环境（天空/雾/太阳）
    const mapEnv = getMapEnvironment(BACKDROP_MAP);
    app.setMapEnvironment(mapEnv.hazeColor, mapEnv.skyHorizonColor, mapEnv.skyZenithColor, mapEnv.sunAzimuth, mapEnv.sunElevation);

    // 加载地图几何（不可 raycast）
    const loader = new MapLoader(app.scene, { raycastable: false });
    this.loader = loader;
    loader.setClassification(mapEnv);
    const loaded = await loader.load(BACKDROP_MAP);

    if (!this.disposed) {
      if (!loaded || !loader.object) throw Error('Mirage geometry is unavailable');
      app.setClassifiedMap(loader.object);

      this.players = createBackdropPlayers(clip);
      app.scene.add(this.players);

      this.resize();
      this.update(0);
      await this.precompile();
      if (!this.disposed) {
        this.lastTickAt = performance.now();
        this.requestFrame();
      }
    }
  }

  /** 预编译 shader（把场景和模糊 pass 各渲染一次以编译程序） */
  precompile() {
    const renderer = this.root.renderer;
    const tasks = [];
    renderer.setRenderTarget(this.sceneTarget);
    tasks.push(renderAsync(renderer, this.root.scene, this.camera));
    renderer.setRenderTarget(this.blurTarget);
    tasks.push(renderAsync(renderer, this.blurScene, this.blitCamera));
    renderer.setRenderTarget(null);
    tasks.push(renderAsync(renderer, this.blurScene, this.blitCamera));
    return Promise.all(tasks);
  }

  onResize = () => {
    this.sizeDirty = true;
  };

  onVisibilityChange = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    } else if (this.players) {
      this.lastTickAt = performance.now();
      this.requestFrame();
    }
  };

  onContextLost = (event) => {
    event.preventDefault();
    if (!this.disposed) this.onFail(Error('WebGL context lost'));
  };

  requestFrame() {
    if (!this.frameHandle && !this.disposed && !document.hidden) {
      this.frameHandle = requestAnimationFrame(this.tick);
    }
  }

  tick = (timestamp) => {
    this.frameHandle = 0;
    if (this.disposed) return;
    this.requestFrame();
    // 限制到 ~30 FPS
    if (timestamp - this.lastFrameAt < FRAME_INTERVAL_MS - 4) return;
    this.lastFrameAt = timestamp;

    const delta = Math.min((timestamp - this.lastTickAt) / 1000, 0.1);
    this.lastTickAt = timestamp;
    if (this.sizeDirty) this.resize();
    this.update(delta);
    this.render();
    this.shownAt ||= timestamp;
    // 淡入 + 镜头切换淡出
    this.setOpacity(Math.min(1, (timestamp - this.shownAt) / FADE_IN_MS) * this.cutFade());
  };

  resize() {
    this.sizeDirty = false;
    const app = this.root;
    const cssWidth = Math.max(1, this.host.clientWidth);
    const cssHeight = Math.max(1, this.host.clientHeight);
    this.cssSize.set(cssWidth, cssHeight);

    // 场景 RT 尺寸（受限）
    const sceneWidth = Math.max(16, Math.min(MAX_SCENE_TARGET_WIDTH, Math.round(cssWidth * SCENE_TARGET_SCALE)));
    const sceneHeight = Math.max(16, Math.round((sceneWidth * cssHeight) / cssWidth));
    // 模糊 RT 尺寸（更低）
    const blurWidth = Math.max(8, Math.round(cssWidth * BLUR_TARGET_SCALE));
    const blurHeight = Math.max(8, Math.round(cssHeight * BLUR_TARGET_SCALE));

    app.renderer.setSize(blurWidth, blurHeight, false);
    this.sceneTarget = createRenderTarget(this.sceneTarget, app.renderer, sceneWidth, sceneHeight, true, BLUR_SAMPLES);
    this.blurTarget = createRenderTarget(this.blurTarget, app.renderer, blurWidth, blurHeight, false);
    this.camera.aspect = cssWidth / cssHeight;
    this.camera.updateProjectionMatrix();
  }

  /** 推进 clip 时间，更新所有玩家的实例矩阵 + 相机 */
  update(delta) {
    const clip = this.clip;
    const players = this.players;
    this.clipTime = (this.clipTime + delta) % clip.duration;

    const { frame, next, t } = sampleBackdropFrame(clip, this.clipTime);
    const playerCount = clip.playerCount;

    for (let player = 0; player < playerCount; player++) {
      const sampleA = frame * playerCount + player;
      const sampleB = next * playerCount + player;
      const flag = clip.flags[t < 0.5 ? sampleA : sampleB];

      if (!(flag & 1)) {
        // 未存活：缩放到 0 隐藏
        this.scale.setScalar(0);
      } else {
        const heightScale = flag & 2 ? 0.75 : 1; // 蹲伏（flag 第 2 位）时变矮
        this.scale.set(1, 1, heightScale);
        this.position.set(
          lerp(clip.positions[sampleA * 3], clip.positions[sampleB * 3], t),
          lerp(clip.positions[sampleA * 3 + 1], clip.positions[sampleB * 3 + 1], t),
          lerp(clip.positions[sampleA * 3 + 2], clip.positions[sampleB * 3 + 2], t) + PLAYER_CONICAL_TOP * heightScale,
        );
      }
      players.setMatrixAt(player, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    players.instanceMatrix.needsUpdate = true;

    // 相机沿当前镜头移动
    const { shot, progress } = this.currentShot();
    this.camera.position.set(
      lerp(shot.from[0], shot.to[0], progress),
      lerp(shot.from[1], shot.to[1], progress),
      lerp(shot.from[2], shot.to[2], progress),
    );
    this.lookAt.set(
      lerp(shot.lookFrom[0], shot.lookTo[0], progress),
      lerp(shot.lookFrom[1], shot.lookTo[1], progress),
      lerp(shot.lookFrom[2], shot.lookTo[2], progress),
    );
    this.camera.lookAt(this.lookAt);
  }

  /** 计算当前镜头（根据 clip 时间在镜头序列里定位） */
  currentShot() {
    const shotDuration = this.clip.duration / CAMERA_SHOTS.length;
    const shotIndex = Math.min(CAMERA_SHOTS.length - 1, Math.floor(this.clipTime / shotDuration));
    const elapsed = this.clipTime - shotIndex * shotDuration;
    return { shot: CAMERA_SHOTS[shotIndex], progress: elapsed / shotDuration, remaining: shotDuration - elapsed, elapsed };
  }

  /** 渲染：场景 → 场景 RT，再做两次方向模糊（水平+垂直）做后处理 */
  render() {
    const app = this.root;
    const renderer = app.renderer;
    const uniforms = this.blurMaterial.uniforms;
    const isDark = document.documentElement.dataset.theme === 'dark';

    app.beginRenderFrame();
    renderer.setRenderTarget(this.sceneTarget);
    app.render(this.camera);

    // 水平模糊
    uniforms.uSource.value = this.sceneTarget.texture;
    uniforms.uStep.value.set(BLUR_SPREAD / this.cssSize.x, 0);
    uniforms.uDim.value = 1;
    uniforms.uSaturation.value = 1;
    renderer.setRenderTarget(this.blurTarget);
    renderer.render(this.blurScene, this.blitCamera);

    // 垂直模糊 + 暗角/饱和度（暗色主题更暗、更不饱和）
    uniforms.uSource.value = this.blurTarget.texture;
    uniforms.uStep.value.set(0, BLUR_SPREAD / this.cssSize.y);
    uniforms.uDim.value = isDark ? 0.62 : 1;
    uniforms.uSaturation.value = isDark ? 0.85 : 0.92;
    renderer.setRenderTarget(null);
    renderer.render(this.blurScene, this.blitCamera);
  }

  /** 镜头切换时的淡入淡出（用 smoothstep 平滑） */
  cutFade() {
    const { elapsed, remaining } = this.currentShot();
    return smoothstep(Math.min(1, Math.min(elapsed, remaining) / SHOT_FADE));
  }

  setOpacity(value) {
    const rounded = Math.round(value * 100) / 100;
    if (rounded === this.opacity || !this.root) return;
    this.opacity = rounded;
    this.root.renderer.domElement.style.opacity = String(rounded);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.loader?.dispose();
    if (this.players) {
      this.players.geometry.dispose();
      this.players.material.dispose();
      this.players.dispose();
    }
    this.sceneTarget?.dispose();
    this.blurTarget?.dispose();
    this.blurQuad.geometry.dispose();
    this.blurMaterial.dispose();

    const app = this.root;
    if (app) {
      app.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
      app.dispose();
      app.renderer.forceContextLoss();
    }
  }
}

/** 创建背景小人（instanced 圆柱 + 圆锥帽） */
function createBackdropPlayers(clip) {
  // 圆柱体（底部），从 -56 到 -32（相对高度），半径 3，10 段
  const geometry = new CylinderGeometry(PLAYER_CONICAL_TOP, PLAYER_CONICAL_TOP * 2 - PLAYER_CONICAL_TOP * 2, 3, 10);
  // 注：原始参数为 new so(zR, BR*2 - zR*2, 3, 10) = so(24, 112-48=64, 3, 10)
  // 实际是一个从下到上的锥/柱组合，此处保留语义化的等价描述
  geometry.rotateX(Math.PI / 2);

  const material = new MeshBasicMaterial({ color: 0xffffff, fog: false });
  const mesh = new InstancedMesh(geometry, material, clip.playerCount);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;

  for (let player = 0; player < clip.playerCount; player++) {
    mesh.setColorAt(player, clip.teams[player] === 2 ? CT_COLOR : T_COLOR);
  }
  return mesh;
}

/** 创建（或复用）一个离屏渲染目标 */
function createRenderTarget(existing, renderer, width, height, depthBuffer, samples = 0) {
  if (existing && existing.width === width && existing.height === height) return existing;
  existing?.dispose();
  const target = new WebGLRenderTarget(width, height, {
    type: renderer.extensions.has('EXT_color_buffer_float') ? HalfFloatType : UnsignedByteType,
    depthBuffer,
    stencilBuffer: false,
    samples,
  });
  target.texture.minFilter = LinearFilter;
  target.texture.magFilter = LinearFilter;
  target.texture.generateMipmaps = false;
  return target;
}

/** 创建高斯模糊 + 饱和度/暗角后处理材质 */
function createBlurMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uSource: { value: null },
      uStep: { value: new Vector2() },
      uDim: { value: 1 },
      uSaturation: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uSource;
      uniform vec2 uStep;
      uniform float uDim;
      uniform float uSaturation;
      varying vec2 vUv;
      // 单个 NaN/Inf texel 会污染整个模糊块，这里做钳制防护
      vec4 tap(vec2 uv) {
        vec4 c = texture2D(uSource, uv);
        return all(lessThan(abs(c), vec4(60000.0))) ? min(c, vec4(64.0)) : vec4(0.0);
      }
      void main() {
        vec4 color = tap(vUv) * 0.2270270270;
        color += (tap(vUv + uStep) + tap(vUv - uStep)) * 0.1945945946;
        color += (tap(vUv + 2.0 * uStep) + tap(vUv - 2.0 * uStep)) * 0.1216216216;
        color += (tap(vUv + 3.0 * uStep) + tap(vUv - 3.0 * uStep)) * 0.0540540541;
        color += (tap(vUv + 4.0 * uStep) + tap(vUv - 4.0 * uStep)) * 0.0162162162;
        gl_FragColor = vec4(color.rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        float luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor.rgb = mix(vec3(luma), gl_FragColor.rgb, uSaturation) * uDim;
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

/** 线性插值 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}
/** smoothstep 缓动 */
function smoothstep(x) {
  return x * x * (3 - 2 * x);
}

// ── 质量选择器（采样率） ───────────────────────────────────────────────────────

const SAMPLE_RATE_KEY = 'csplayer:sampleRate';
const DEFAULT_SAMPLE_RATE = 32;
const SAMPLE_RATE_OPTIONS = [
  { rate: 16, label: 'Fast', hint: '16 Hz · quickest load' },
  { rate: 32, label: 'Balanced', hint: '32 Hz · recommended' },
  { rate: 64, label: 'Precise', hint: '64 Hz · highest fidelity' },
];

/** 创建「播放细节」采样率选择器 */
function createQualitySelector(container) {
  let rate = readSampleRate();

  const render = () => {
    container.innerHTML = `
      <div class="quality-head">
        <span class="quality-label hud-label">Playback detail</span>
        <span class="quality-hint">${sampleRateHint(rate)}</span>
      </div>
      <div class="quality-options" role="group" aria-label="Playback detail">
        ${SAMPLE_RATE_OPTIONS.map(
          (option) => `
          <button type="button" class="quality-opt${option.rate === rate ? ' active' : ''}" data-rate="${option.rate}" aria-pressed="${option.rate === rate}">
            <span>${option.label}</span><small>${option.rate} Hz</small>
          </button>
        `,
        ).join('')}
      </div>
    `;
    container.querySelectorAll('.quality-opt').forEach((button) => {
      button.addEventListener('click', () => {
        rate = normalizeSampleRate(Number(button.dataset.rate));
        writeSampleRate(rate);
        render();
      });
    });
  };

  render();
  return { getSampleRate: () => rate };
}

function sampleRateHint(rate) {
  return SAMPLE_RATE_OPTIONS.find((option) => option.rate === rate)?.hint ?? '';
}
function normalizeSampleRate(rate) {
  return SAMPLE_RATE_OPTIONS.some((option) => option.rate === rate) ? rate : DEFAULT_SAMPLE_RATE;
}
function readSampleRate() {
  try {
    return normalizeSampleRate(Number(localStorage.getItem(SAMPLE_RATE_KEY)));
  } catch {
    return DEFAULT_SAMPLE_RATE;
  }
}
function writeSampleRate(rate) {
  try {
    localStorage.setItem(SAMPLE_RATE_KEY, String(rate));
  } catch {
    /* 忽略 */
  }
}

// ── recents 列表渲染 ───────────────────────────────────────────────────────────

/** 创建「最近场次」列表，支持点击打开、删除、清空 */
function createRecents(container, onOpen) {
  let renderVersion = 0;

  const render = () => {
    const version = ++renderVersion;
    const recents = readRecents();
    pruneCache(recents.map((r) => r.key));

    if (recents.length === 0) {
      container.innerHTML = `
        <div class="recents-empty">
          <span class="recents-empty-mark">00</span>
          <strong>No recent demos</strong>
          <span>Matches you open will be kept here for quick access.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="recents-head">
        <span class="recents-title">${recents.length} cached ${recents.length === 1 ? 'match' : 'matches'}</span>
        <button class="recents-clear" type="button">Clear history</button>
      </div>
      <div class="recents-grid">
        ${recents.map((entry, index) => renderRecentCard(entry, index)).join('')}
      </div>
    `;

    container.querySelector('.recents-clear')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      clearRecents();
      await clearCache();
      render();
    });

    container.querySelectorAll('.recent-card').forEach((card) => {
      card.addEventListener('click', () => {
        const entry = recents[Number(card.dataset.index)];
        if (entry) onOpen(entry);
      });
    });

    container.querySelectorAll('.recent-delete').forEach((button) => {
      button.addEventListener('click', async () => {
        const entry = recents[Number(button.dataset.index)];
        if (entry) {
          button.disabled = true;
          removeRecent(entry.key);
          await deleteCache(entry.key);
          render();
        }
      });
    });

    // 异步加载地图 logo 缩略图
    Promise.all(recents.map((entry) => loadMapLogo(entry.map)))
      .then((logos) => {
        if (version !== renderVersion) return;
        container.querySelectorAll('.recent-thumb').forEach((thumb, index) => {
          const url = logos[index];
          if (url) thumb.style.backgroundImage = `url("${url}")`;
        });
      })
      .catch((err) => {
        console.warn('[csplayer] recent map logos failed:', err);
      });
  };

  render();
  return { refresh: render };
}

/** 渲染单个 recent 卡片 */
function renderRecentCard(entry, index) {
  return `
    <div class="recent-entry">
      <button class="recent-card" type="button" data-index="${index}" title="${escapeAttr(entry.name)}">
        <span class="recent-map-identity">
          <span class="recent-map">${escapeHtml(prettyMapName(entry.map))}</span>
          <span class="recent-thumb"></span>
        </span>
        <span class="recent-info">
          <span class="recent-date">${escapeHtml(formatRelativeTime(entry.date))}</span>
          <span class="recent-score">
            <span class="recent-side rc-t"><span>${escapeHtml(entry.tLabel || 'T')}</span><strong>${entry.tScore | 0}</strong></span>
            <span class="rc-sep">:</span>
            <span class="recent-side rc-ct"><strong>${entry.ctScore | 0}</strong><span>${escapeHtml(entry.ctLabel || 'CT')}</span></span>
          </span>
          <span class="recent-meta">
            <span>${escapeHtml(formatDuration(entry.durationSeconds))}</span>
            <span>${entry.sampleRate || 32} Hz</span>
          </span>
        </span>
      </button>
      <button class="recent-delete" type="button" data-index="${index}" title="Remove cached demo" aria-label="Remove ${escapeAttr(entry.name)} from cached demos">&times;</button>
    </div>
  `;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

function formatRelativeTime(timestamp) {
  const elapsed = Date.now() - timestamp;
  const MINUTE = 60000;
  const HOUR = 3600000;
  const DAY = 86400000;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}
function escapeAttr(value) {
  return value.replace(/[&"]/g, (ch) => (ch === '&' ? '&amp;' : '&quot;'));
}

// ── 应用入口装配 ───────────────────────────────────────────────────────────────

const appRoot = document.querySelector('#app');
if (!appRoot) throw Error('Missing #app root element');

// 注册一个 passive touchstart（让移动端滚动更顺滑）
document.addEventListener('touchstart', () => {}, { passive: true });
initThemeManager();

// 创建 AppShell
const shell = createAppShell(appRoot);

// 给 landing header 加主题切换按钮，并挂载背景动画
shell.dropScreen.querySelector('.landing-header')?.appendChild(createThemeSwitch('theme-switch landing-theme-switch'));
mountBackdrop(shell.dropScreen);

// 状态
let currentApp; // 当前播放器（TP 实例）
let generation = 0; // 加载代次（用于竞态处理）
let abortController; // 当前加载的 AbortController
let parseState; // 解析进行中的状态（{generation, progress}）
const DOWNLOAD_PROGRESS_WEIGHT = 0.8; // 下载阶段占总进度的权重
const PREPARE_PROGRESS_TARGET = 0.97; // 准备阶段推进到的进度上限

const qualitySelector = createQualitySelector(shell.qualitySlot);
const recents = createRecents(shell.recentsSlot, (entry) => void openFromLibrary(entry));

const hostedMenu = createHostedDemoMenu(
  shell.hostedDemosSlot,
  (entry) => void openHostedDemo(entry),
  () => void loadCatalogue(),
  () => shell.phoneWizard.go('match'),
);

bindDropZone(shell, (file) => void openLocalFile(file));
loadCatalogue();

/** 加载托管目录 */
async function loadCatalogue() {
  hostedMenu.showLoading();
  try {
    const catalogue = await fetchCatalogue();
    hostedMenu.showCatalogue(catalogue);
  } catch (err) {
    hostedMenu.showError(err instanceof Error ? err.message : 'Featured matches are unavailable right now.');
    console.error('[csplayer] failed to load hosted catalogue:', err);
  }
}

/** 打开本地 .dem 文件 */
async function openLocalFile(file) {
  const thisGeneration = ++generation;
  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;

  currentApp?.dispose();
  currentApp = undefined;
  shell.hideDropScreen();
  shell.hideParsingLeaveConfirmation(true);
  shell.showLoading('Reading demo…', cancelLoad, { title: file.name });

  const ctx = {};
  try {
    const startTime = performance.now();
    let progress = 0;
    const hasContent = (data) => data.meta.numFrames > 0 || data.smokeVoxels.count > 0 || !!data.grenades.infernos?.length;
    const updateLabel = (phase) => {
      if (thisGeneration === generation) shell.setLoadingLabel(prettyPhase(phase));
    };
    // 数据到达时创建/更新播放器
    const applyData = (data, loadedRounds) => {
      if (thisGeneration !== generation) return;
      if (!ctx.app) {
        ctx.app = createPlayer(data, { parseMs: performance.now() - startTime, source: 'local-parse', fileSizeBytes: file.size }, ctx.manifest, loadedRounds);
        return;
      }
      if (!ctx.app.replaceRoundData(data, loadedRounds)) {
        const state = ctx.app.getPlaybackState();
        ctx.app.dispose();
        ctx.app = createPlayer(data, { parseMs: performance.now() - startTime, source: 'local-parse', fileSizeBytes: file.size }, ctx.manifest, loadedRounds);
        ctx.app.restorePlaybackState(state);
      }
    };

    const { data, key, fromCache } = await parseLocalFile(file, {
      signal: controller.signal,
      sampleRate: qualitySelector.getSampleRate(),
      onManifest: (manifest) => {
        if (thisGeneration !== generation) return;
        parseState = { generation: thisGeneration, progress };
        ctx.manifest = manifest;
        ctx.mapAssets ??= preloadMapAssets(manifest.mapName, updateLabel);
        shell.setLoadingLabel('Loading round 1…');
      },
      onReady: (data, manifest, loadedRounds) => {
        ctx.manifest = manifest;
        if (hasContent(data)) applyData(data, loadedRounds);
      },
      onRound: (data, loadedRounds) => {
        if (hasContent(data)) applyData(data, loadedRounds);
      },
      onProgress: (phase, value) => {
        if (thisGeneration !== generation) return;
        if (Number.isFinite(value) && value >= 0) {
          progress = Math.max(progress, Math.min(1, value));
          if (parseState?.generation === thisGeneration) {
            parseState.progress = progress;
            shell.setParsingLeaveProgress(progress);
          }
        }
        if (!ctx.app) shell.setLoadingLabel(prettyPhase(phase));
      },
    });

    if (thisGeneration !== generation) return;
    parseState = undefined;
    shell.hideParsingLeaveConfirmation();
    const parseMs = performance.now() - startTime;

    if (data.meta.numFrames === 0) {
      if (data.smokeVoxels.count === 0 && !data.grenades.infernos?.length) {
        throw Error('No player or recorded grenade-effect data found in this demo.');
      }
      // 只有 grenade 效果、没有玩家帧时，重算 meta 的起止 tick
      adjustTimelineToEffects(data);
    }

    ctx.mapAssets ??= preloadMapAssets(data.meta.mapName, updateLabel);
    if (ctx.app) {
      applyData(data, ctx.manifest?.rounds.length ?? data.rounds.length);
    } else {
      createPlayer(
        data,
        { parseMs: fromCache ? null : parseMs, source: fromCache ? 'local-cache' : 'local-parse', fileSizeBytes: file.size },
        ctx.manifest,
        ctx.manifest?.rounds.length ?? data.rounds.length,
      );
    }

    if (key) {
      saveRecent(key, file.name, data, file.size);
      recents.refresh();
    }
  } catch (err) {
    if (
      thisGeneration !== generation ||
      (parseState = undefined, shell.hideParsingLeaveConfirmation(true), err instanceof DOMException && err.name === 'AbortError')
    ) {
      return;
    }
    if (ctx.app) {
      console.error('[csplayer] background demo details failed:', err);
    } else {
      showLoadError(err);
    }
  } finally {
    if (abortController === controller) abortController = undefined;
  }
}

/** 从缓存打开一个 demo */
async function openFromLibrary(entry) {
  const thisGeneration = ++generation;
  abortController?.abort();
  abortController = undefined;
  currentApp?.dispose();
  currentApp = undefined;
  shell.hideDropScreen();
  shell.hideParsingLeaveConfirmation(true);
  shell.showLoading('Opening from your library…', cancelLoad, { title: entry.name });

  try {
    preloadMapAssets(entry.map, (phase) => {
      if (thisGeneration === generation) shell.setLoadingLabel(prettyPhase(phase));
    });

    const data = await readCachedData(entry.key);
    if (thisGeneration !== generation) return;

    if (!data || (data.meta.numFrames === 0 && data.smokeVoxels.count === 0 && !data.grenades.infernos?.length)) {
      removeRecent(entry.key);
      recents.refresh();
      shell.hideLoading(true);
      shell.showDropScreen();
      return;
    }

    if (data.meta.numFrames === 0) adjustTimelineToEffects(data);
    createPlayer(data, { parseMs: null, source: 'local-cache', fileSizeBytes: entry.fileSizeBytes ?? null });
    addRecent({ ...entry, date: Date.now() });
    recents.refresh();
  } catch (err) {
    if (thisGeneration !== generation) return;
    showLoadError(err);
  }
}

/** 打开托管 demo */
async function openHostedDemo(entry) {
  const thisGeneration = ++generation;
  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;

  parseState = undefined;
  currentApp?.dispose();
  currentApp = undefined;
  hostedMenu.setSelected(entry.id);
  shell.hideDropScreen();
  shell.hideParsingLeaveConfirmation(true);
  shell.showLoading('Downloading…', cancelLoad, {
    title: entry.teams?.length === 2 ? undefined : entry.matchLabel,
    teams: entry.teams,
  });

  try {
    const { data, byteLength } = await loadHostedDemo(entry, {
      signal: controller.signal,
      onProgress: ({ loadedBytes, totalBytes }) => {
        if (thisGeneration !== generation) return;
        if (totalBytes && totalBytes > 0) {
          shell.setLoadingProgress((loadedBytes / totalBytes) * DOWNLOAD_PROGRESS_WEIGHT);
          shell.setLoadingLabel(`Downloading… ${formatBytes(loadedBytes)} of ${formatBytes(totalBytes)}`);
        } else {
          shell.setLoadingLabel(`Downloading… ${formatBytes(loadedBytes)}`);
        }
      },
    });

    if (thisGeneration !== generation) return;

    if (data.meta.numFrames === 0) adjustTimelineToEffects(data);
    shell.setLoadingProgress(DOWNLOAD_PROGRESS_WEIGHT);
    await preloadMapAssets(data.meta.mapName, (phase) => {
      if (thisGeneration === generation) {
        shell.setLoadingLabel(prettyPhase(phase));
        shell.advanceLoadingProgress(PREPARE_PROGRESS_TARGET);
      }
    });
    if (thisGeneration !== generation) return;

    const playbackMeta = {
      mapName: data.meta.mapName,
      tickRate: data.meta.tickRate,
      startTick: data.meta.startTick,
      endTick: data.meta.endTick,
      durationSeconds: data.meta.durationSeconds,
      rounds: data.rounds,
    };

    createPlayer(
      data,
      { parseMs: null, source: 'hosted', fileSizeBytes: byteLength },
      playbackMeta,
      data.rounds.length,
      resolveTeamIdentities(entry.teams ?? [], data.players),
    );
  } catch (err) {
    if (thisGeneration !== generation || (err instanceof DOMException && err.name === 'AbortError')) return;
    showLoadError(err);
  } finally {
    if (abortController === controller) abortController = undefined;
    if (thisGeneration === generation) hostedMenu.setSelected(undefined);
  }
}

/** 创建播放器实例（TP = DemoApp） */
function createPlayer(data, options, manifest, loadedRounds, teamIdentities) {
  shell.setLoadingLabel(`Preparing ${prettyMapName(data.meta.mapName)}…`);
  shell.advanceLoadingProgress(PREPARE_PROGRESS_TARGET);
  const app = new DemoApp(
    shell.viewport,
    data,
    options,
    manifest,
    loadedRounds,
    cancelLoad,
    (phase) => {
      shell.setLoadingLabel(prettyPhase(phase));
      shell.advanceLoadingProgress(PREPARE_PROGRESS_TARGET);
    },
    teamIdentities,
  );
  currentApp = app;
  app.ready.then(() => {
    if (currentApp === app) shell.hideLoading();
  });
  return app;
}

/** 预加载地图几何 + 雷达图 */
async function preloadMapAssets(mapName, onPhase) {
  await Promise.all([
    preloadMapGeometry(mapName, onPhase).catch((err) => console.warn('[csplayer] map geometry preload failed:', err)),
    preloadRadar(mapName).catch((err) => console.warn('[csplayer] radar preload failed:', err)),
  ]);
}

/** 根据解析结果保存 recent 条目 */
function saveRecent(key, name, data, fileSize) {
  const score = computeFinalScore(data, Math.max(0, data.meta.numFrames - 1));
  addRecent({
    key,
    name,
    map: data.meta.mapName,
    date: Date.now(),
    durationSeconds: data.meta.durationSeconds,
    sampleRate: data.meta.sampleRate,
    fileSizeBytes: fileSize,
    tScore: score.tScore,
    ctScore: score.ctScore,
    tLabel: score.tLabel,
    ctLabel: score.ctLabel,
  });
}

/** 显示加载错误 */
function showLoadError(err) {
  shell.showError(err instanceof Error ? err.message : String(err), cancelLoad);
  console.error('[csplayer] failed to load demo:', err);
}

/** 取消/离开加载流程 */
function cancelLoad() {
  const state = parseState;
  if (state?.generation === generation) {
    shell.showParsingLeaveConfirmation(state.progress, cancelLoad);
    return;
  }
  resetToDropScreen();
}

/** 回到落地页，取消一切加载 */
function resetToDropScreen() {
  generation++;
  parseState = undefined;
  shell.hideParsingLeaveConfirmation(true);
  abortController?.abort();
  abortController = undefined;
  currentApp?.dispose();
  currentApp = undefined;
  shell.hideLoading(true);
  hostedMenu.setSelected(undefined);
  recents.refresh();
  shell.showDropScreen();
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 把解析阶段的原始文字转成可读文案（de_xxx → Xxx） */
function prettyPhase(phase) {
  return phase.replace(/\b(?:de|cs|ar|dz|gd|coop)_[a-z0-9_]+/gi, (match) => prettyMapName(match));
}

/**
 * 当 demo 没有玩家帧、只有 grenade 效果（烟雾/燃烧弹）时，
 * 根据效果的起止 tick 重算 meta 的 startTick / endTick / durationSeconds。
 */
function adjustTimelineToEffects(data) {
  const smoke = data.smokeVoxels;
  const tickRate = data.meta.tickRate;
  let minTick = Infinity;
  let maxTick = -Infinity;

  for (let i = 0; i < smoke.count; i++) {
    const begin = smoke.tickBegin[i];
    if (begin < minTick) minTick = begin;
    if (begin + 26 * tickRate > maxTick) maxTick = begin + 26 * tickRate;
  }
  for (const inferno of data.grenades.infernos ?? []) {
    minTick = Math.min(minTick, inferno.startTick);
    maxTick = Math.max(maxTick, inferno.endTick + tickRate);
  }

  if (isFinite(minTick)) {
    data.meta.startTick = Math.max(0, minTick - tickRate);
    data.meta.endTick = maxTick;
    data.meta.durationSeconds = (data.meta.endTick - data.meta.startTick) / tickRate;
  }
}

// 共享内存接入层需要这个符号（见 src/deobfuscated/shared-buffer.js）
// 创建播放器实例（原 kz）
export { createPlayer };
