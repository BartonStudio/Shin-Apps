// ============================================================================
// 反混淆版本：帧采样器（FrameSampler）—— 把 SoA 数据在任意时刻插值成一帧玩家状态
// 原文范围：decompiled/index.beautified.js L28349–28486（切片 00c-frame-sampler）
// 压缩类名：yg = createPlayerBuffers，bg = FrameSampler，Cg = PlaybackClock
//           xg = lerp，Sg = lerpAngleDeg
// 依赖：wg（clamp）定义在 00d-bomb-defuse.js；three.js 与其它模块不参与本文件。
//
// 这是整个播放链的「心脏」：`Player.sampleAndRender()` 每帧调 `FrameSampler.sample()`，
// 后者按当前播放时间在相邻两个采样帧之间插值，结果写进 `Player.buffers`。
// 下游所有渲染组件（玩家/名牌/雷达/相机……）都只读 `buffers`，不再碰原始 SoA。
//
// 设计要点（读的时候特别注意这几处）：
//   1. 索引公式：值 = 数组[帧序号 * numPlayers + 玩家序号]（列存 SoA 的行主序展平）
//   2. 绝对 tick = meta.startTick + 相对秒数 * meta.tickRate
//      → 所以 meta.startTick 是「换算基准」，必须恒等于 manifest.startTick，不能按窗口改
//   3. 位置/朝向等连续量做插值；alive/health/team/zoom 是离散量，取**最近**的那一帧
//   4. speed / smoothSpeed **是数据列**（2026-11-09 起）——
//      由数据提供层算好放进 frames.speed / frames.smoothSpeed，本采样器只做「取值」。
//      原实现是「相邻两帧前向差分」求导，那段逻辑已搬到 src/deobfuscated/speed-columns.js。
//      详见 docs/07 §3.5 与附录 F。
// ============================================================================

// ── 输出缓冲：一次分配、逐帧复用，避免每帧产生垃圾 ──────────────────────────
// 长度都是 numPlayers。注意 accuracyPenalty 初值填 -1 = 「没有数据」，
// 下游据此判断是否可用（见 docs/07 陷阱 8）。
function createPlayerBuffers(numPlayers) {
  return {
    x: new Float32Array(numPlayers),
    y: new Float32Array(numPlayers),
    z: new Float32Array(numPlayers),
    yaw: new Float32Array(numPlayers),
    pitch: new Float32Array(numPlayers),
    alive: new Uint8Array(numPlayers),
    health: new Uint8Array(numPlayers),
    team: new Uint8Array(numPlayers),
    duck: new Float32Array(numPlayers),       // 0..1 下蹲程度
    flash: new Float32Array(numPlayers),      // 闪光剩余时间
    flashAlpha: new Float32Array(numPlayers), // 闪光白屏强度
    zoom: new Uint8Array(numPlayers),         // 0/1/2 开镜档位
    accuracyPenalty: new Float32Array(numPlayers).fill(-1), // -1 = 无数据
    speed: new Float32Array(numPlayers),      // 水平移动速度；直接取自 frames.speed 列
  };
}

// ── 帧采样器 ────────────────────────────────────────────────────────────────
var FrameSampler = class {
  data;
  duration;

  constructor(data) {
    this.data = data;
    const { frameTick } = data.frames;
    const { startTick, tickRate } = data.meta;
    const frameCount = frameTick.length;
    // duration 只在构造时算一次 —— 换窗（替换 data.frames）后必须重建本对象，
    // 否则这个值会过期。见 docs/07 8.2.2。
    this.duration =
      frameCount > 0 ? (frameTick[frameCount - 1] - startTick) / tickRate : Math.max(0, data.meta.durationSeconds);
  }

  get numPlayers() {
    return this.data.meta.numPlayers;
  }

  // 注意是 getter：换窗后自动跟随新数组长度
  get numFrames() {
    return this.data.frames.frameTick.length;
  }

  // 把「相对秒数」换成「帧序号」：返回满足 frameTick[i] <= 目标 tick 的最大 i
  findFrame(seconds) {
    const frameTick = this.data.frames.frameTick;
    const targetTick = this.data.meta.startTick + seconds * this.data.meta.tickRate;
    const n = frameTick.length;
    // 三处边界钳制 —— 这也是为什么 numFrames 很小甚至为 1 时也不会越界
    if (n === 0 || targetTick <= frameTick[0]) return 0;
    if (targetTick >= frameTick[n - 1]) return n - 1;
    // 二分查找（找右边界后回退一位）
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frameTick[mid] <= targetTick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // 核心：在 seconds 时刻采样出一帧，写进 out（= Player.buffers）
  sample(seconds, out) {
    const { frames, meta } = this.data;
    const players = meta.numPlayers;

    const left = this.findFrame(seconds); // 左帧（<= 目标 tick）
    const right = Math.min(left + 1, this.numFrames - 1); // 右帧，钳制到末帧

    // 插值系数 alpha：左帧相对时间 → 段长 → 归一化到 [0,1]
    const leftSeconds = (frames.frameTick[left] - meta.startTick) / meta.tickRate;
    const span = (frames.frameTick[right] - meta.startTick) / meta.tickRate - leftSeconds;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (seconds - leftSeconds) / span)) : 0;

    const leftBase = left * players;
    const rightBase = right * players;

    // ── speed 列的下标 ──
    // 列的定义是「帧 i 与 i+1 之间的速度」，所以取区间**左端**那一帧。
    // 原实现同样是区间常量（不随 alpha 变化），因此这里取值是零行为差异。
    const speedIndexBase = left * players;

    for (let p = 0; p < players; p++) {
      const li = leftBase + p;
      const ri = rightBase + p;

      // ── 连续量：线性插值（yaw 走最短弧）──
      out.x[p] = lerp(frames.posX[li], frames.posX[ri], alpha);
      out.y[p] = lerp(frames.posY[li], frames.posY[ri], alpha);
      out.z[p] = lerp(frames.posZ[li], frames.posZ[ri], alpha);
      out.yaw[p] = lerpAngleDeg(frames.yaw[li], frames.yaw[ri], alpha); // ← yaw 单位是「度」
      out.pitch[p] = lerp(frames.pitch[li], frames.pitch[ri], alpha);
      out.duck[p] = lerp(frames.duck[li], frames.duck[ri], alpha);
      out.flash[p] = Math.max(0, lerp(frames.flash[li], frames.flash[ri], alpha));
      out.flashAlpha[p] = Math.max(0, lerp(frames.flashAlpha[li], frames.flashAlpha[ri], alpha));

      // ── 离散量：取最近帧，不插值 ──
      const nearest = alpha < 0.5 ? li : ri;
      out.alive[p] = frames.alive[nearest];
      out.health[p] = frames.health[nearest];
      out.team[p] = frames.team[nearest];
      out.zoom[p] = frames.zoom[nearest];

      // ── 精度惩罚：只有两端都有数据、且开镜档位没变时才插值 ──
      // （开镜瞬间惩罚值会跳变，插值会产生非物理的中间值）
      const penLeft = frames.accuracyPenalty?.[li] ?? -1;
      const penRight = frames.accuracyPenalty?.[ri] ?? -1;
      out.accuracyPenalty[p] =
        penLeft >= 0 && penRight >= 0 && frames.zoom[li] === frames.zoom[ri]
          ? lerp(penLeft, penRight, alpha)
          : (frames.accuracyPenalty?.[nearest] ?? -1);

      // ── 速度：直接读数据列 ──
      // 守卫（间隔/回合边界/alive/team）与差分公式全部在数据提供层，
      // 见 src/deobfuscated/speed-columns.js 的 computeSpeedColumns()。
      // 不做空值保护：两列是必需的，缺了就该立刻抛 TypeError，而不是静默变 0。
      out.speed[p] = frames.speed[speedIndexBase + p];
    }
  }
};

// ── 插值工具 ────────────────────────────────────────────────────────────────

// 普通线性插值
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 角度插值：走最短弧。把差值归一到 (-180, 180] 再插值，
// 否则从 179° 到 -179° 会绕 358° 而不是走 2°。
// ⚠️ 这里用 360 归一化，进一步证明 yaw 是「度」而不是弧度。
function lerpAngleDeg(a, b, t) {
  let delta = ((b - a + 180) % 360) - 180;
  if (delta < -180) delta += 360;
  return a + delta * t;
}

// ── 播放时钟 ────────────────────────────────────────────────────────────────
// 只管「时间/速度/暂停」，不关心数据。Player 每帧调 advance(dt)，
// 然后把 clock.time 交给 FrameSampler.sample()。
// 注意它用到的 clamp 是 wg()，定义在 00d-bomb-defuse.js。
var PlaybackClock = class {
  time = 0;
  duration;
  playing = false;
  speed = 1;
  listeners = new Set();

  constructor(duration) {
    this.duration = Math.max(0, duration);
  }

  // 返回取消订阅函数
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  play() {
    if (this.duration === 0) return; // 空片段不允许播放
    if (this.time >= this.duration) this.time = 0; // 播到末尾后重播
    this.playing = true;
    this.emit();
  }

  pause() {
    this.playing = false;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  // 最低 0.05 倍速，避免除零与「看起来卡死」
  setSpeed(speed) {
    this.speed = Math.max(0.05, speed);
    this.emit();
  }

  setDuration(duration) {
    this.duration = Math.max(0, duration);
    this.time = wg(this.time, 0, this.duration); // wg = clamp(v, lo, hi)
    this.emit();
  }

  seek(seconds) {
    this.time = wg(seconds, 0, this.duration); // wg = clamp(v, lo, hi)
    this.emit();
  }

  // 每帧推进；到末尾时钳住并自动暂停（不循环）
  advance(dtSeconds) {
    if (!this.playing) return;
    this.time += dtSeconds * this.speed;
    if (this.time >= this.duration) {
      this.time = this.duration;
      this.playing = false;
      this.emit();
    }
  }

  get progress() {
    return this.duration > 0 ? this.time / this.duration : 0;
  }
};

// ── 符号对照（压缩名 → 本文件语义名）────────────────────────────────────────
//   yg  → createPlayerBuffers   输出缓冲分配器
//   bg  → FrameSampler          帧采样器（findFrame / sample）
//   xg  → lerp                  线性插值
//   Sg  → lerpAngleDeg          角度最短弧插值
//   Cg  → PlaybackClock         播放时钟
//   wg  → clamp(v, lo, hi)      ⚠️ 定义在 00d-bomb-defuse.js，本文件不重复定义；
//                               上面两处仍按原名 wg 调用，以保持代码可运行。
