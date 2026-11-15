// 速度列生产者 —— 把原本跑在「渲染层」的两处速度计算前移到「产数据」阶段。
//
// 为什么放在 src/deobfuscated/ 而不是 src/app/：
//   src/app/ + src/vendor/ + src/workers/ 是 bundle 的**逐字原副本**，
//   必须保持可核查（verify-restoration 的 B/J 两段在守）。
//   所有有意改动都写在本目录：修改已有的 *.deobf.js，以及新增本文件。
//   本文件**是唯一一份可运行的参考实现**（工具与校验器都 import 它），
//   也是 C++ 侧复刻这两列的唯一依据。
//
// ═══════════════════════════════════════════════════════════════════════════
// 为什么要有这个文件
// ═══════════════════════════════════════════════════════════════════════════
// 原工程里 speeds 是渲染时才现算的，分成两条完全不同的链路：
//
//   A. 瞬时速度（原 00c-frame-sampler.js 的 bg.sample()）
//      相邻「采样帧」的水平位移 / 时间差。消费者：脚步声节拍、开镜速度读数。
//
//   B. 平滑速度（原 10-character-model.js 的 jC() → FC() → IC()）
//      过去 1 秒的指数加权平均（时间常数 0.1s）。消费者：走/跑/蹲动画混合、姿态根偏移。
//
// 两条语义不同、消费者不同，缺一条就会坏功能：
//   · 用 A 喂动画 → 一帧守卫触发就归零，人物姿态突跳
//   · 用 B 喂步频 → 玩家急停后 EMA 还有残留，脚步会多响 ~100ms
//
// 本模块把两者都变成 data 里的**正式列**（frames.speed / frames.smoothSpeed），
// 渲染层此后只做「查表 / 插值」，不再做任何计算。
// 未来 C++ 接管时，只要产出同样两列，JS 渲染层一行都不用改。
//
// ═══════════════════════════════════════════════════════════════════════════
// 用法
// ═══════════════════════════════════════════════════════════════════════════
//   // 一次性（缓存的旧数据、外部产出的数据）
//   computeSpeedColumns(data);
//
//   // 增量（解析器逐回合装配，data.frames 每轮都是新数组）
//   let carry;
//   while (moreRounds) {
//     data = assemble();
//     carry = computeSpeedColumns(data, carry);   // carry 必须自己持有一份拷贝
//   }
//
// 返回的 carry 形如 { upTo, speed, smoothSpeed }。传入上一轮的 carry 时，
// 只会重算 [upTo, N) 这些帧 —— 避免每回合重做 64 倍窗口遍历。
//
// ⚠️ carry 里的数组**不能**是 data.frames.speed 本身：
//    那些 buffer 会通过 postMessage 转移（transfer）给主线程，转移后原对象失效。
//
// ═══════════════════════════════════════════════════════════════════════════
// 与 C++ 的契约
// ═══════════════════════════════════════════════════════════════════════════
// 本文件的算法就是唯一规范（docs/07 §3.5 有逐条说明）。C++ 复刻时注意：
//   · speed[i]      用帧 i 与 i+1（i 是最后一帧时退化为 i-1 与 i）
//   · smoothSpeed[i] 在帧 i 的 tick 上求值，需要向前 1 秒（=64 tick）的历史
//   · 分窗时：段尾补 1 帧、段首补 1 秒，否则边界处两列都会偏

// ── 常量（与原工程逐字一致，不要改）──
export const SPEED_CONST = Object.freeze({
  EMA_TAU: 0.1,        // fC：EMA 时间常数（秒）
  EMA_WINDOW_MULT: 10, // 窗口 = 10 × EMA_TAU = 1.0 秒
  MAX_INSTANT: 600,    // mC：瞬时速度上限，超过视为瞬移并丢弃
  MAX_FRAME_DT: 0.25,  // pC：单帧时长上限，超过视为不连续并跳过
});

const { EMA_TAU, EMA_WINDOW_MULT, MAX_INSTANT, MAX_FRAME_DT } = SPEED_CONST;
const EMA_WINDOW = EMA_WINDOW_MULT * EMA_TAU; // = 1.0

// 一阶低通的解析累积：IC(x, τ) = 1 − (1 + n)·e^(−n)，n = x/τ
function IC(x, tau) {
  const n = x / tau;
  return 1 - (1 + n) * Math.exp(-n);
}

// 与原工程 xC() 一致：<= 首帧返回 0，>= 末帧返回 len-1，否则最大 i 使 arr[i] <= t
function frameIndexAt(ticks, t) {
  const n = ticks.length;
  if (n === 0 || t <= ticks[0]) return 0;
  if (t >= ticks[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ticks[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 给 data.frames 挂上 speed 与 smoothSpeed 两列。
 *
 * @param {object} data   解析产出的 data 对象（需要 frames.{frameTick,posX,posY,alive,team}、
 *                        meta.{numPlayers,tickRate,sampleRate}、rounds[]）
 * @param {object} [carry] 上一轮返回的 { upTo, speed, smoothSpeed }
 * @returns {{upTo:number, speed:Float32Array, smoothSpeed:Float32Array}} 本轮的可复用缓存
 */
export function computeSpeedColumns(data, carry) {
  const F = data.frames;
  const META = data.meta;
  const P = META.numPlayers | 0;
  const N = F.frameTick.length;
  const TR = META.tickRate || 64;
  const SR = META.sampleRate || 32;

  if (N === 0 || P === 0) {
    F.speed = new Float32Array(0);
    F.smoothSpeed = new Float32Array(0);
    return { upTo: 0, speed: F.speed, smoothSpeed: F.smoothSpeed };
  }

  const total = N * P;
  // 已算到哪一帧：留最后一帧不固化（它的 speed 需要下一帧，等下一轮再算）
  const from = carry ? Math.max(0, Math.min(carry.upTo, N - 1)) : 0;

  const speed = new Float32Array(total);
  const smooth = new Float32Array(total);
  if (from > 0 && carry) {
    speed.set(carry.speed.subarray(0, from * P));
    smooth.set(carry.smoothSpeed.subarray(0, from * P));
  }

  // ── A. 瞬时速度：复刻 bg.sample() 的守卫 ──────────────────────────────
  // 原逻辑在 sample(t) 里：左帧 a = findFrame(t)，右帧 o = min(a+1, N-1)，
  // 若 a === o（时间轴走到最后一帧）则退化为 (a-1, a)；然后
  //   g = (tick[p] − tick[f]) / tickRate
  //   守卫 = g > 0 && g ≤ 2/sampleRate && 区间 (tick[f], tick[p]] 内无回合起点
  //   且两端 alive===1 且 team 相同，否则置 0
  const ticks = F.frameTick;
  const alive = F.alive;
  const team = F.team;
  const px = F.posX;
  const py = F.posY;
  const rounds = data.rounds ?? [];
  const maxGap = 2 / SR;
  for (let i = from; i < N; i++) {
    const a = i;
    const o = Math.min(a + 1, N - 1);
    const f = a === o ? Math.max(0, a - 1) : a;
    const q = o;
    const g = (ticks[q] - ticks[f]) / TR;
    const t0 = ticks[f];
    const t1 = ticks[q];
    let usable = g > 0 && g <= maxGap;
    if (usable) {
      for (let r = 0; r < rounds.length; r++) {
        const st = rounds[r].startTick;
        if (st > t0 && st <= t1) {
          usable = false;
          break;
        }
      }
    }
    const base = i * P;
    if (!usable) continue; // 保持 0
    const i1 = f * P;
    const i2 = q * P;
    for (let p = 0; p < P; p++) {
      if (alive[i1 + p] !== 1 || alive[i2 + p] !== 1) continue;
      if (team[i1 + p] !== team[i2 + p]) continue;
      speed[base + p] = Math.hypot(px[i2 + p] - px[i1 + p], py[i2 + p] - py[i1 + p]) / g;
    }
  }

  // ── B. 平滑速度：复刻 jC() → FC() → IC() ─────────────────────────────
  // 在每个采样帧的 tick 上求「过去 1 秒、时间常数 0.1s 的指数加权平均速度」。
  // 逐帧依赖向前 1 秒的历史，所以增量计算是安全的（历史已在数组里）。
  const L = ticks.length;
  if (L >= 2) {
    const invWin = 1 / IC(EMA_WINDOW, EMA_TAU); // 归一化因子只算一次
    for (let i = from; i < N; i++) {
      const tick = ticks[i];
      const base = i * P;
      for (let p = 0; p < P; p++) {
        let acc = 0;
        for (let e = Math.min(frameIndexAt(ticks, tick), L - 2); e >= 0; e--) {
          const lo = Math.max(0, (tick - ticks[e + 1]) / TR);
          if (lo >= EMA_WINDOW) break;
          const hi = Math.min(EMA_WINDOW, (tick - ticks[e]) / TR);
          if (hi <= lo) continue;
          const pi = e * P + p;
          const qi = pi + P;
          const h = (ticks[e + 1] - ticks[e]) / TR;
          if (h <= 0 || h > MAX_FRAME_DT) continue;
          if (alive[pi] !== 1 || alive[qi] !== 1) continue;
          let v = Math.hypot(px[qi] - px[pi], py[qi] - py[pi]) / h;
          if (v > MAX_INSTANT) v = 0;
          acc += v * (IC(hi, EMA_TAU) - IC(lo, EMA_TAU));
        }
        smooth[base + p] = acc * invWin;
      }
    }
  }

  F.speed = speed;
  F.smoothSpeed = smooth;
  return { upTo: Math.max(0, N - 1), speed, smoothSpeed: smooth };
}

/**
 * 从上一轮 carry 里拷出一份可长期持有的缓存（供下一轮增量用）。
 * 因为 data.frames.speed/smoothSpeed 的 buffer 会被 transfer 给主线程，
 * 转移后原 TypedArray 变 detached，不能直接拿来当 carry。
 */
export function cloneCarry(carry) {
  if (!carry) return undefined;
  return {
    upTo: carry.upTo,
    speed: carry.speed.slice(),
    smoothSpeed: carry.smoothSpeed.slice(),
  };
}
