# 07 — 播放器数据契约（C++ → JS 对接规范）

> 目标读者：C++ 侧实现者。
> 本文档定义 JS 播放器（`Player` 类）**唯一**消费的数据结构。凡是按本规范产出的数据，播放器无需改动即可渲染。
>
> 所有结论均来自对 `decompiled/index.beautified.js`（53 504 行）与 `src/workers/parser.worker.js` 的静态分析，行号可复查。

---

## 0. 核心思想：分两级

播放器接受**两个独立参数**，不是一个：

```js
// 28-radar.js L1884-1898（Player 构造函数）
constructor(container, data, ???, manifest, loadedRounds, ...) {
  this.data     = data                        // ← 每段发（窗口化）
  this.model    = new bg(data)
  this.manifest = manifest ?? { /* 从 data.meta 兜底推导 */ }
  this.clock    = new Cg(this.loadedDurationSeconds())
}
```

| 级别 | 内容 | 发送频率 |
| --- | --- | --- |
| **`manifest`** | 整场不变的信息（地图/时长/回合表） | **一次** |
| **`data`** | 逐帧内容（玩家位置等） | **每段一次** |

> **框架本来就是这样设计的。** worker 里有独立的 `onManifest` 回调（`parser.worker.js` L2027 / L2200），发的就是 manifest。
> 原版 app 在 `data.meta` 里也带一份 `mapName`/`tickRate`/`endTick`，那只是 `manifest` 未提供时的**兜底路径**（L1888 `manifest ?? {...}`），不是要求你重复发。

**结论：`meta` 不要每段重复发整份。** 见第 2 节。

---

## 1. `manifest`（只发一次）

```js
{
  mapName:         string,    // 如 "de_mirage"
  tickRate:        number,    // 固定 64
  startTick:       number,    // 整场第一个 tick
  endTick:         number,    // 整场最后一个 tick
  durationSeconds: number,    // (endTick - startTick) / tickRate
  rounds: [ {
      startTick:     number,
      endTick:       number,
      liveStartTick: number,  // 回合真正开始（冻结时间结束）
      // 其余字段播放器会忽略
  }, ... ]
}
```

### 消费点（决定了它必须准确）

| 字段 | 用途 | 出处 |
| --- | --- | --- |
| `durationSeconds` | **进度条总长度**（拖动范围的右端） | L1914 `new xA(e, this.manifest.durationSeconds \|\| this.model.duration, ...)` |
| `startTick` + `tickRate` + `durationSeconds` | 把每个回合映射到进度条上的区间 | L2326-2332 `roundLoadRanges()` |
| `rounds[]` | 回合切换、时间轴分段 | 同上 |
| `startTick` + `rounds[].endTick` | 计算"已加载到哪里" | L2336-2340 `loadedDurationSeconds()` |

> ⚠️ **整场时长必须来自 `manifest`，不能来自 `data.meta`。** 一旦分窗，`data.meta` 只描述当前窗口，拿它当总长度会让进度条变成 2 秒。

---

## 2. `data.meta`（每段发，但只留窗口相关字段）

```js
data.meta = {
  startTick:       number,   // ← 本段第一个 tick（窗口起点）
  endTick:         number,   // ← 本段最后一个 tick（窗口终点）
  numFrames:       number,   // ← 本段帧数
  numPlayers:      number,   //   人数（固定，但播放器在构造时读）
  mapName:         string,   //   建议带（兜底用；manifest 有则忽略）
  tickRate:        number,   //   固定 64
  sampleRate:      number,   //   你的采样率（无损 = 64）
  durationSeconds: number,   //   (endTick - startTick) / tickRate —— 本段时长
}
```

### 哪些其实不用重复发

| 字段 | 要不要每段发 | 理由 |
| --- | --- | --- |
| `mapName` / `tickRate` | ❌ 不必（放 manifest） | 整场不变 |
| `numPlayers` | ⚠️ 建议带 | 构造时用于分配显存缓冲（L1899-1905），分段替换时不重建 |
| `startTick` / `endTick` / `numFrames` | ✅ **必须每段发** | 描述本段范围 |
| `sampleRate` | ❌ 不必 | 仅用于显示"Precise/Balanced"文案 |

---

## 3. `data.frames` —— 逐帧主数据（**索引的核心**）

### 3.1 索引公式（唯一铁律）

```
值 = 数组[ 帧序号 * numPlayers + 玩家序号 ]
```

行主序、`[帧][玩家]` 展平。出处：`parser.worker.js` L639 `teamAtTick: (e,t) => L.team[re(t) * F + e]`。

### 3.2 字段表（类型/长度必须完全一致）

| 字段 | 类型 | 长度 | 说明 |
| --- | --- | --- | --- |
| `frameTick` | `Int32Array` | `N` | **本段每帧的绝对 tick 号，必须严格升序** |
| `posX` `posY` `posZ` | `Float32Array` | `N*P` | 世界坐标（Source2 单位） |
| `yaw` `pitch` | `Float32Array` | `N*P` | 视角角，**角度制（degree）**，不是弧度！`yaw` 归一化到 **(-180, 180]**，`pitch` 约 [-64, 89]。见 3.4 |
| `health` | `Uint8Array` | `N*P` | 0..100 |
| `alive` | `Uint8Array` | `N*P` | 0 / 1 |
| `team` | `Uint8Array` | `N*P` | **数值**：2 = T，3 = CT，**0 = 该玩家未参与本回合**（实测占 20%，且 team=0 时 `alive` 恒为 0） |
| `score` | `Uint8Array` | `N*P` | |
| `duck` | `Float32Array` | `N*P` | 0..1 下蹲程度 |
| `flash` | `Float32Array` | `N*P` | 闪光剩余时间 |
| `flashAlpha` | `Float32Array` | `N*P` | 闪光白屏强度 |
| `zoom` | `Uint8Array` | `N*P` | 0 / 1 / 2 开镜档位 |
| `accuracyPenalty` | `Float32Array` | `N*P` | **可选**，无数据时全填 `-1` |
| `speed` | `Float32Array` | `N*P` | **瞬时水平速度**（Source2 单位/秒）。相邻采样帧差分 + 4 条守卫，**不是**平滑值。见 3.5 |
| `smoothSpeed` | `Float32Array` | `N*P` | **1 秒指数加权平均速度**（时间常数 0.1s）。驱动角色走/跑/蹲动画混合。见 3.5 |
| `reloading` | `Uint8Array` | `N*P` | **可选** |
| `playerFlags` | `Uint8Array` | `N*P` | **可选** |

其中 `N` = 本段帧数 = `frameTick.length`，`P` = `numPlayers`。

类型来源：`parser.worker.js` L575-593。

### 3.5 `speed` 与 `smoothSpeed` —— 两列速度

> **这两列是必需列。** 渲染层不做任何速度计算，只查表/插值。
> 唯一的规范实现是 `src/deobfuscated/speed-columns.js`；下面把它逐条写清楚，供 C++ 复刻。

#### 为什么是两列

它们回答两个不同的问题，缺一条就坏功能：

| 列 | 回答 | 消费者 | 用错会怎样 |
| --- | --- | --- | --- |
| `speed` | 这一刻多快？ | 脚步声节拍、开镜速度读数 | 用 smoothSpeed → 急停后脚步多响 ~100ms（能听出来） |
| `smoothSpeed` | 最近 1 秒平均多快？ | 走/跑/蹲动画混合、姿态根偏移 | 用 speed → 一帧守卫触发就归零，人物姿态突跳 |

实测（真实 demo，48 778 个有效样本）：两列均值比 **0.982**，但瞬态差异很大
（加速期 `speed` 领先 `smoothSpeed` 最多 28.6 单位/秒；回合解冻瞬间 `smoothSpeed`=0 而 `speed`>0）。

#### `speed[i][p]` 的定义

```
取帧对 (f, q)：
    q = min(i + 1, N - 1)
    f = (i === q) ? max(0, i - 1) : i        // 最后一帧退化为后向差分

g = (frameTick[q] - frameTick[f]) / tickRate

守卫（任一条不满足 → 本帧本玩家 = 0）：
    1. g > 0
    2. g <= 2 / sampleRate                    // 16Hz 时 = 0.125s
    3. 区间 (frameTick[f], frameTick[q]] 内**没有**任何回合起点
    4. alive[f*P+p] === 1 && alive[q*P+p] === 1
    5. team[f*P+p] === team[q*P+p]

值 = hypot(posX[q]-posX[f], posY[q]-posY[f]) / g     // 只算水平分量，忽略 Z
```

#### `smoothSpeed[i][p]` 的定义

在 `tick = frameTick[i]` 上求「过去 1 秒的指数加权平均速度」：

```
常量：TAU = 0.1        // 时间常数
      WINDOW = 10*TAU = 1.0   // 窗口
      MAX_INSTANT = 600       // 瞬时速度上限，超过视为瞬移并丢弃
      MAX_FRAME_DT = 0.25     // 单帧时长上限，超过视为不连续并跳过

IC(x) = 1 - (1 + n) * exp(-n),  n = x / TAU

acc = 0
for e 从 min(lastFrameAtOrBefore(tick), N-2) 往前:
    lo = max(0, (tick - frameTick[e+1]) / tickRate)
    if lo >= WINDOW: break
    hi = min(WINDOW, (tick - frameTick[e]) / tickRate)
    if hi <= lo: continue
    h = (frameTick[e+1] - frameTick[e]) / tickRate
    if h <= 0 || h > MAX_FRAME_DT: continue
    if alive[e*P+p] !== 1 || alive[(e+1)*P+p] !== 1: continue
    v = hypot(posX[(e+1)*P+p]-posX[e*P+p], posY[(e+1)*P+p]-posY[e*P+p]) / h
    if v > MAX_INSTANT: v = 0
    acc += v * (IC(hi) - IC(lo))

smoothSpeed = acc / IC(WINDOW)
```

`lastFrameAtOrBefore(t)`：`t <= frameTick[0]` 返回 0；`t >= frameTick[N-1]` 返回 N-1；
否则返回最大的 `i` 使 `frameTick[i] <= t`（二分）。

#### 渲染层怎么取这两列

| 列 | 取值方式 | 与原实现的差异 |
| --- | --- | --- |
| `speed` | **取区间左端那一帧**（分段常量，和 `alive`/`health`/`team` 一样） | **零差异**——原实现本来就是区间常量 |
| `smoothSpeed` | **线性插值**（和 `posX`/`yaw` 一样） | 实测误差 ≤ **0.54 单位/秒**（均值的 0.3%），传到动画权重上 ≈0.25% |

> 为什么 `smoothSpeed` 必须插值：实测「取最近帧」会把误差放大到 **11.29 单位/秒 / 5.35% 动画权重**，肉眼看得出。

### 3.4 ⚠️ `yaw` / `pitch` 是**角度制**，不是弧度

播放器内部**不做**任何角度→弧度转换，是在喂给 three.js 渲染时才转的：

```js
// 06-world-props.js L401      ix  = Math.PI / 180
// 09-trajectory-recorder.js L205  pS = Math.PI / 180
// 14-blast-effects.js L449    OD = Math.PI / 180
r.rotation.set(t.roll * ix, t.pitch * ix, t.yaw * ix)     // ← 到这里才 ×π/180
```

yaw 的插值函数也按 360 度归一化，可佐证：

```js
// index.beautified.js
function Sg(e, t, n) {            // yaw 最短弧插值
  let r = ((t - e + 180) % 360) - 180
  return (r < -180 && (r += 360), e + r * n)
}
function xg(e, t, n) { return e + (t - e) * n }   // 其他量的普通 lerp
```

**C++ 侧必须传角度制。** 传弧度会导致所有玩家朝向严重错误（差的倍数是 57.3）。

### 3.3 为什么 `frameTick` 是索引核心

播放器的所有"某个 tick 的状态"查询，都是对 `frameTick` 做二分查找拿到**帧序号**，再用索引公式取值。

**所以 `frameTick` 里放的是绝对 tick 号，窗口切换时只要换掉数组即可 —— 不需要任何 `tick - startTick` 的偏移修正。**

---

## 4. `data.panelFrames` —— 第二套逐帧数据（侧边玩家面板）

独立于 `frames`，**有自己的一套 tick**（可以是不同采样点）。

| 字段 | 类型 | 长度 |
| --- | --- | --- |
| `numFrames` | `number` | — |
| `frameTick` | `Int32Array` | `M` |
| `health` `alive` `team` `armor` `flags` | `Uint8Array` | `M*P` |
| `money` `clipAmmo` `reserveAmmo` | `Uint16Array` | `M*P` |
| `activeWeapon` `utilCounts` | `Uint8Array` | `M*P` |

> ⚠️ **`equipValue` 已从契约移除**（2026-11-09）：它是 CS2 netprop `current_equip_value`（装备美元总价），
> 原工程分配/解码/传输/序列化四步俱全，但**全库零读取**。现已连 `parser.worker` 的抓取一起去掉。


类型来源：`parser.worker.js` L1500-1520（`Le()` 函数）。
索引公式同第 3.1 节。

---

### 4.1 两个真实数据里才发现的细节

| 细节 | 实测 | 为什么要写进契约 |
| --- | --- | --- |
| `panelFrames.numFrames` 是**标量** | `14291` | 而 `frames` **没有** `numFrames` 字段（用 `frameTick.length`）。这个不对称照抄即可，别"统一" |
| `panelFrames` 的采样间隔 | **8 tick**（frames 是 1 tick） | 同一份 demo 下 M ≈ N/8 |
| `weaponNames[0]` 是**空字符串** | `''` | `activeWeapon` 索引到 0 时会取到空串，下游必须容忍空武器名 |
| `weaponNames` 混用显示名与内部名 | `USP-S` / `Butterfly Knife` / `knife_t` / `knife` | 不要假设它一定是 `weapon_*` 形式 |

## 5. `data.players` —— 玩家表（很小，整段带或只发一次都行）

```js
data.players = [ {
    slot:          number,   // 0..P-1，必须连续；是所有数组的"玩家序号"
    steamId:       string,   // ⚠️ 必须是字符串！SteamID64 ≈ 7.7e16 > 2^53，number 会丢精度
    name:          string,
    crosshairCode?: string,  // 可选
    clanName?:     string,   // 可选（队伍名）
    color?:        number,   // 可选（队友颜色索引）
}, ... ]
```

出处：`parser.worker.js` L565 + L171-184。
`R()` 函数（L1577）确认 `steamId` 被转成 string。

---

### 5.1 真实数据里的 `players[]` 字段（实测）

```
{ slot, steamId, name, clanName?, color }
```

| 要点 | 实测 | 说明 |
| --- | --- | --- |
| **没有 `team` 字段** | — | 队伍只在 `frames.team` / `panelFrames.team` 里。别在 players 上找队伍 |
| `clanName` 是**可选**的 | 10 人里 2 人没有 | 缺失时是 `undefined`，不是 `''` |
| `color` 是**字符串** | `blue` / `purple` / `orange` / `green` / `yellow` | 不是数值索引；集合与 `00e` 的 `PLAYER_COLOR_NAMES` 一致 |
| `steamId` 是字符串 | `"76561197962984717"` | SteamID64 超过 2^53，**必须**用字符串 |

## 6. 其余字段

| 字段 | 必需 | 缺失后果 |
| --- | --- | --- |
| `meta` | ✅ | 崩 |
| `players` | ✅ | 崩 |
| `frames`（含 `frameTick`） | ✅ | 崩（每帧必读） |
| `panelFrames` | 建议 | 左右玩家面板空白 |
| `events` / `rounds` | 建议 | 时间轴、回合切换、事件流不可用 |
| `weaponNames` | 建议 | 武器名显示为数字 ID |
| `bomb` / `timeouts` / `damage` | 建议 | 对应 UI 不显示 |
| `grenades` / `smokeVoxels` / `tracers` / `droppedWeapons` / `weaponFires` / `deathMarkers` | 可选 | 对应特效不显示 |
| `mapEntities` / `deathRagdolls` | 可选 | 门不动；无尸体布娃娃 |

**最小可播 = `manifest` + `meta` + `players` + `frames`。**

---

> **`rounds[]` 的实际字段**（实测）：`{ index, startTick, endTick, liveStartTick }`。
> `index` 是回合序号（0 起），`liveStartTick` 是解除冻结的 tick（如第 0 回合 startTick=0、endTick=3982、liveStartTick=1181）。

## 7. 布娃娃骨骼数据（`data.deathRagdolls`）

### 7.1 是什么

每个死亡事件对应一条布娃娃轨迹：每帧、每根骨骼的世界位置 + 朝向。

```
每骨骼每帧 = 7 × float32
  [0..2]  位置  x, y, z
  [3..6]  朝向  四元数 x, y, z, w

轨迹数组布局：
  bones[ (帧号 * 骨骼数 + 骨骼号) * 7 + 0..6 ]
```

出处：`09-trajectory-recorder.js` L57-76 `record()`，`Vx = 7`；`boneTransforms()` 在 `07-physics-engine.js` L61-68。

### 7.2 现状（JS 自己算，每帧只有 4ms）

```js
// 10-character-model.js L1414 / L1455
hw = 4                                              // 每帧模拟预算 4 毫秒
while (!done && duration < t && performance.now() < this.deadline)
    track.advanceTo(t, 1)                           // 一次只推进一步
```

**这就是跳转后卡顿的根因。** 移到 C++ 后删掉这段循环即可。

### 7.3 C++ 侧产出格式建议

```cpp
struct RagdollTrack {
    int32_t  startTick;        // 死亡触发 tick
    int32_t  numBones;         // 骨骼数
    int32_t  numFrames;        // 录制帧数
    float    frameTimes[];     // numFrames，相对死亡时刻的秒数
    float    bones[];          // numFrames * numBones * 7（pos3 + quat4）
};

// data.deathRagdolls = RagdollTrack[] 的数组化版本
```

物理实现随意（Bullet / PhysX / Jolt / 自研），只要输出**世界空间** pos + quat。

参考参数（原版取值）：录制步长 1/60 秒，单条轨迹最长 6 秒（`ux = 1/60`，`Rx = 6`）。

---

## 8. 分窗（分段发送）约定

### 8.1 每段带什么

```
段 N:
  data.meta.startTick / endTick / numFrames
  data.frames.frameTick[]          ← 本段 N 帧的绝对 tick 号
  data.frames.posX..zoom[]         ← 长度 = N * P
  data.panelFrames.*               ← 可选
```

### 8.2 换窗时**只换数组**，`meta.startTick` 必须保持不变

```js
// ✅ 正确：只替换 typed array
this.data.frames = 新段的 frames

// ❌ 错误：不要动 startTick
// this.data.meta.startTick = 新段起点
```

**原因**：`meta.startTick` 是 tick 换算的**基准**，采样器用它把"相对时间"换算成"绝对 tick"：

```js
// index.beautified.js L28383-28396  findFrame()
findFrame(相对秒数) {
  let targetTick = data.meta.startTick + 相对秒数 * data.meta.tickRate   // ← 基准
  if (目标 <= frameTick[0])  return 0
  if (目标 >= frameTick[末]) return 末
  ...二分查找...
}

// L28397-28412  sample()
let 左帧相对时间 = (frameTick[左] - meta.startTick) / tickRate            // ← 同一基准
```

而 `clock.time`（传进来的"相对秒数"）是相对 `manifest.startTick` 的
（`loadedDurationSeconds()` L2336-2340 用 `manifest.startTick` 计算）。

**所以 `meta.startTick` 必须恒等于 `manifest.startTick`。** 一旦改成"窗口起点"，
绝对 tick 会算错，事件、烟雾、弹道、炸弹全部错位。

### 8.2.1 那窗口怎么起作用？

**只靠 `frameTick` 的内容。** 采样器做二分查找，如果请求的 tick 不在本窗口内，
会钳制到窗口的首帧/末帧：

```js
if (目标 <= frameTick[0])  return 0          // 钳到首帧
if (目标 >= frameTick[末]) return 末          // 钳到末帧
```

窗口内正常播放；窗口外显示边缘帧（等你换窗）。
`numFrames` 是 getter（L28380-28382），自动跟随 `frames.frameTick.length`，不用手改。

### 8.2.2 ⚠️ 一个隐藏的坑：`model.duration` 是构造时算的

```js
// L28370-28376  bg 构造函数
constructor(data) {
  let { frameTick: t } = data.frames
  let { startTick: n, tickRate: r } = data.meta
  this.duration = t.length > 0 ? (t[t.length-1] - n) / r : data.meta.durationSeconds
}
```

`duration` 在构造时算一次，**换窗不会更新**。它作为"已加载到哪"的兜底值被使用
（`loadedDurationSeconds()` L2337 在 `manifest.rounds` 为空时取它）。

对策二选一：
- 换窗后重建 model（`new bg(data)`），或
- 用手动维护的 `parsedThroughTick` 取代它（推荐，见第 9 节）

### 8.3 边界处理

相邻窗口**建议重叠 1 帧**，这样窗口边界处的插值不会突变。

### 8.4 窗口最小 2 帧（否则 `speed` 恒为 0）

`speed` 是从**相邻两帧**求导算出来的，不是数据里的列：

```js
// L28407-28412 / L28429-28434
let 前帧 = (左 === 右) ? Math.max(0, 左 - 1) : 左
let g = (frameTick[右] - frameTick[前帧]) / tickRate
let 可用 = g > 0 && g <= 2/sampleRate && 该区间内无回合边界
...
t.speed[e] = 可用 ? hypot(posX[右]-posX[前帧], ...) / g : 0
```

**窗口只有 1 帧时 `g = 0` → `speed` 恒为 0**，角色腿部动画会一直处于站立状态
（走路/跑步动作不触发）。所以窗口最小 2 帧，实际用 128 帧完全没问题。

### 8.5 建议窗口大小

128 帧 @ 64Hz = 2 秒。这是合理的默认值：
- 传输量小（按 200 属性混合类型，128 帧 × 10 人 × ~100 B ≈ 128 KB）
- 预取 2~3 个窗口即可覆盖播放与来回拖动

---

## 9. 渐进加载水位线（进度反馈）

框架**已有**回合级的加载状态可视化：

```js
// 28-radar.js
roundLoadRanges()          // L2326：每个回合在进度条上的区间
updateRoundLoadState()     // L2333：把状态喂给控件
loadedDurationSeconds()    // L2336：已加载到哪个时间点
  → 用 manifest.rounds[loadedRounds-1].endTick 计算
```

`loadedRounds` 就是"已解析到第几回合"的水位线。

### 你的场景需要升级到帧级

因为你分窗是 **128 帧（2 秒）**，比回合细得多。改造点很小：

```js
// 现在（回合级）
loadedDurationSeconds() {
  let e = this.manifest.rounds[Math.max(0, this.loadedRounds - 1)]
  return Math.max(0, e.endTick - this.manifest.startTick) / this.manifest.tickRate
}

// 改成（帧级）：由 C++ 上报 parsedThroughTick
loadedDurationSeconds() {
  return Math.max(0, this.parsedThroughTick - this.manifest.startTick) / this.manifest.tickRate
}
```

进度条、时间轴分段、已加载区域高亮全部沿用现有控件，不需要重写。

---

## 10. 已知陷阱清单

| # | 陷阱 | 后果 | 对策 |
| --- | --- | --- | --- |
| 1 | `steamId` 用 number 传 | 精度丢失，玩家串号 | 必须用 `uint64` → 转字符串 |
| 2 | `team` 传字符串 `"T"` / `"CT"` | 队伍判断失效 | 必须传数值 2 / 3 |
| 3 | **`yaw` / `pitch` 传弧度** | 朝向严重错误（差 57.3 倍） | **必须角度制（degree）** |
| 4 | `frameTick` 非升序 | 二分查找失效，跳转错乱 | 严格升序 |
| 5 | 数组长度 ≠ `N*P` | 越界读到 0 或 crash | 断言校验 |
| 6 | `data.meta.endTick` 传窗口值当总时长 | 进度条只剩 2 秒 | 总时长放 `manifest` |
| 7 | `players[].slot` 不连续 | 索引错位 | 必须 0..P-1 |
| 8 | `accuracyPenalty` 没数据却填 0 | 弹道判定异常 | 无数据填 `-1` |
| 9 | 窗口首帧缺前一帧 | 边界插值跳变 | 窗口重叠 1 帧 |
| 10 | `playerFlags` 走结构化克隆 | 白拷一份内存（性能） | 加入 transfer list |
| 11 | **换窗时改 `meta.startTick`** | 绝对 tick 算错，特效/事件全错位 | **保持不变（= `manifest.startTick`）** |
| 12 | 窗口只给 1 帧 | `speed` 恒为 0，腿部动画失效 | 最小 2 帧 |
| 13 | 换窗没更新 `model.duration` | "已加载到哪"显示错误 | 重建 model 或用 `parsedThroughTick` |
| 14 | `alive`/`team`/`zoom` 当成可插值量 | — | 它们取**最近帧**，不插值，无需处理 |

---

## 11. C++ 结构定义（对照填）

```cpp
// ─── 一次会话，只发一次 ───
struct Manifest {
    const char* mapName;
    int32_t     tickRate;        // 64
    int32_t     startTick;
    int32_t     endTick;
    double      durationSeconds; // (endTick - startTick) / tickRate
    struct Round { int32_t startTick, endTick, liveStartTick; };
    Round*      rounds;
    int32_t     numRounds;
};

// ─── 玩家表，会话级，只发一次 ───
struct PlayerInfo {
    int32_t     slot;
    uint64_t    steamId;         // JS 侧转 string
    const char* name;
    const char* crosshairCode;   // 可空
    const char* clanName;        // 可空
    int32_t     color;           // 可空，-1 表示无
};

// ─── 每一段（窗口）发一次 ───
struct SegmentHeader {
    int32_t startTick;           // 本段首 tick
    int32_t endTick;             // 本段末 tick
    int32_t numFrames;           // N
    int32_t numPlayers;          // P
};

struct Frames {
    // 长度 N*P 的列存（SoA），按第 3.1 节公式索引
    float*   posX;  float* posY;  float* posZ;
    float*   yaw;   float* pitch;
    uint8_t* health; uint8_t* alive; uint8_t* team; uint8_t* score;
    float*   duck;  float* flash; float* flashAlpha;
    uint8_t* zoom;
    // 可选
    float*   accuracyPenalty;    // 无数据填 -1
    uint8_t* reloading;
    uint8_t* playerFlags;
    // 长度 N
    int32_t* frameTick;          // 绝对 tick，严格升序
};

struct PanelFrames {
    int32_t  numFrames;          // M
    int32_t* frameTick;          // 长度 M
    uint8_t* health; uint8_t* alive; uint8_t* team;
    uint8_t* armor;  uint8_t* flags;
    uint16_t* money; uint16_t* equipValue;
    uint16_t* clipAmmo; uint16_t* reserveAmmo;
    uint8_t* activeWeapon; uint8_t* utilCounts;
    // 全部逐帧数组长度 = M*P
};

// ─── 布娃娃，每条死亡一条 ───
struct RagdollTrack {
    int32_t startTick;
    int32_t numBones;
    int32_t numFrames;
    float*  frameTimes;          // N
    float*  bones;               // N * numBones * 7
};
```

---

## 12. 上线前自查

- [ ] `manifest.durationSeconds` = 整场时长，不是窗口时长
- [ ] `frames.frameTick` 严格升序，且是**绝对** tick 号
- [ ] 所有逐帧数组长度 = `numFrames * numPlayers`
- [ ] `steamId` 是字符串，`team` 是 2/3，**`yaw/pitch` 是角度制**
- [ ] `players[].slot` 连续 0..P-1
- [ ] 可选数组缺失时是 `undefined`，不是空数组（空数组会让长度校验失败）
- [ ] 相邻窗口重叠 1 帧，且**每个窗口 ≥ 2 帧**（否则 `speed` 为 0）
- [ ] 换窗时**没有**修改 `meta.startTick`
- [ ] 进度条总长来自 `manifest`，已加载比例来自 `parsedThroughTick`

---

## 附录 A — CSDF v1 二进制分段格式（C++ 逐字节对照实现）

真源：`tools/csdf-format.mjs`（生成器与校验器共用，改那里就全改）

### A.1 文件整体

```
┌ Header  64 字节（小端）────────────────────────────────┐
├ Block 1  （64 字节对齐）                               │
├ Block 2  …                                             │
└ …                                                      ┘
```

### A.2 Header（64 字节，全部小端）

| 偏移 | 类型 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | `u32` | `magic` | `0x46445343` = `"CSDF"` |
| 4 | `u32` | `version` | `1` |
| 8 | `i32` | `startTick` | 本段首 tick（含） |
| 12 | `i32` | `endTick` | 本段末 tick（含） |
| 16 | `i32` | `numFrames` | `N` = `frames.frameTick.length` |
| 20 | `i32` | `numPlayers` | `P` |
| 24 | `i32` | `panelNumFrames` | `M` = `panelFrames.frameTick.length`（无面板时 0） |
| 28 | `i32` | `flags` | bit0=`accuracyPenalty` bit1=`reloading` bit2=`playerFlags` bit3=含 `panelFrames` |
| 32 | `u32` | `payloadCrc32` | 对 `[64, totalBytes)` 求 CRC-32 |
| 36 | `u32` | `reserved` | 0 |
| 40 | `u64` | `payloadBytes` | `totalBytes - 64` |
| 48 | `u64` | `totalBytes` | 文件总长 |
| 56 | `u64` | `reserved2` | 0 |

### A.3 列块顺序（不可调换）

**`frames`（13 个必需块 + 3 个可选块）**

| # | 块名 | 类型 | 元素数 |
| --- | --- | --- | --- |
| 1 | `frameTick` | `i32` | `N` |
| 2-4 | `posX` `posY` `posZ` | `f32` | `N*P` |
| 5-6 | `yaw` `pitch` | `f32` | `N*P` |
| 7-10 | `health` `alive` `team` `score` | `u8` | `N*P` |
| 11-13 | `duck` `flash` `flashAlpha` | `f32` | `N*P` |
| 14 | `zoom` | `u8` | `N*P` |
| 15* | `accuracyPenalty` | `f32` | `N*P` |
| 16* | `reloading` | `u8` | `N*P` |
| 17* | `playerFlags` | `u8` | `N*P` |

**`panelFrames`（12 个块，仅当 `flags & 8`）**

| # | 块名 | 类型 | 元素数 |
| --- | --- | --- | --- |
| 18 | `panelFrameTick` | `i32` | `M` |
| 19-23 | `panelHealth` `panelAlive` `panelTeam` `panelArmor` `panelFlags` | `u8` | `M*P` |
| 24-27 | `panelMoney` `panelEquipValue` `panelClipAmmo` `panelReserveAmmo` | `u16` | `M*P` |
| 28-29 | `panelActiveWeapon` `panelUtilCounts` | `u8` | `M*P` |

> `*` = 由 flags 决定是否存在。**每块起点 64 字节对齐，块间补 0。**

### A.4 索引公式

```
值 = 数组[帧序号 * numPlayers + 玩家序号]
```

即 `[帧][玩家]` 行主序展平。**这与 `frames.frameTick` 的下标一一对应。**

---

## 附录 B — 为什么 `frames` 和 `panelFrames` 的 tick 可以不同

这不是推测，是代码结构决定的（`src/workers/parser.worker.js`）：

| 项 | `frames` | `panelFrames` |
| --- | --- | --- |
| 构建函数 | `M(columnsMap)` L534 | `Le(panelColumnsMap, …)` L1500 |
| tick 来源 | L537 `o(e, 'tick')` ← **主列 map** | L1501 `o(e, 'tick')` ← **面板列 map** |
| 生成 | L569 `Int32Array.from(A).sort()` | L1513 `Int32Array.from(l).sort()` |
| 消费者 | `bg.findFrame()`（`index.beautified.js` L28383） | `EP(panelFrames.frameTick, tick)`（L2955） |

**两个独立的 `Set` → 排序 → 两套 `Int32Array`，两套二分查找，互不约束。**

`data.meta.numFrames` 只描述 `frames`（`bg` 的 `numFrames` getter 也是读 `frames.frameTick.length`）。
`panelFrames.numFrames` 是它自己的字段。

> **C++ 侧结论**：两套 tick 集合可以不同，播放器能正确处理。
> `fixtures/segment-000.bin` 就是故意这么造的（frames 每 tick、panelFrames 每 8 tick）。

---

```bash
node tools/gen-fixture-data.mjs                              # 生成 fixtures/
node tools/gen-fixture-data.mjs --seconds 60 --players 12     # 改参数重生成
node tools/validate-fixture-data.mjs <你的.bin>                # ★ 给 C++ 侧的自检：格式/CRC/值域/单调性
node tools/validate-fixture-data.mjs <你的.bin> --json          # 机器可读输出
```

**参数与产物说明以 `fixtures/README.md` 为准**（那边由生成器写入，避免两处维护）。

校验器的语义检查已做反向测试：注入 `team=9` / `alive=7` / `health=200` / `zoom=5` / `duck=3` /
`yaw=NaN` / `reloading=2`，**7 项全部被检出**。另有结构性检查：magic / version / `frameTick` 严格升序与
端点匹配 / 各块长度与 `N·P`、`M·P` 一致 / 每块 64 字节对齐 / CRC-32。

> 生成过程中校验器**当场抓出我自己生成器的一个 bug**（`yaw` 公式错误导致值域跑到 755°）——
> 说明这套「生成 → 校验」闭环确实能拦住实现错误。
---

## 附录 D — 字段证据链（每个字段「谁在读、怎么用」）

> 生成：`node tools/trace-fields.mjs --markdown`（可重复，只读）
> 扫描范围：`src/app/` 39 个切片 + `src/workers/` 2 个 worker（**不含** vendor 里的 three.js）
>
> **为什么需要这个附录**：正文的字段类型与语义是"读代码得出的规范"。没有证据链时无法回答
> 「这个字段真的被用到吗」「取值范围由谁保证」「少发它会不会炸」。下表把每个字段的消费点抓出来。

### D.1 三条结论

| 结论 | 依据 |
| --- | --- |
| **57 个字段里，56 个有真实消费者** | 见下表「消费者」列 |
| **只有 `panelFrames.equipValue` 是死字段** | 它在全库仅 3 处：`parser.worker.js:1525` 分配 `Uint16Array`、`:1569` 从 `current_equip_value` 解码、`:2238` 列入 transferable；外加 `31-hosted-demo.js:800/813/831` 的 CSDA 解码。**零读取**。→ C++ 侧可以不产出它 |
| **`panelFrames` 的 `flags` / `money` 确实是活的** | 分别被 `26-scorebar-hud.js:267`（C4 携带标记）和 `27-player-panels.js:80`（金钱显示）读取 |

### D.2 方法与其局限

"消费者"定义为：出现在 `parser.worker.js` 与 `31-hosted-demo.js`（产出/解码路径）**之外**的读取点。
`panelFrames` 的字段额外做了两层消歧：① 优先匹配 `panelFrames.<字段>` 字面写法；
② 解析 `let { panelFrames: o } = e` 这类**解构别名**，把 `o.<字段>` 也算作命中。

> ⚠️ **局限**：`frames` 与 `panelFrames` 有 6 个同名字段（`frameTick`/`health`/`alive`/`team`/`score`/`flash`）。
> 若某处经别名访问且上下文没出现 `panelFrames` 字样，仍可能被计入 `frames`。
> **所以「消费者数量」只用于判断字段是否存活，不要用它比较两个同名字段的优先级。**
> 死字段判定不受此影响（`equipValue` 名字唯一）。

### D.3 全字段表
**manifest（会话级，只发一次）**

| 字段 | 结论 | 消费者 | 证据（第一处） |
| --- | --- | ---: | --- |
| `mapName` | 读取 20 处 | 22 | `src/app/28-radar.js:1297`<br>`this.mapName && this.loadMap(this.mapName))` |
| `tickRate` | 读取 93 处 | 100 | `src/app/28-radar.js:1890`<br>`tickRate: t.meta.tickRate,` |
| `startTick` | 读取 116 处 | 170 | `src/app/28-radar.js:1891`<br>`startTick: t.meta.startTick,` |
| `endTick` | 读取 64 处 | 108 | `src/app/28-radar.js:2330`<br>`endFraction: (t.endTick - this.manifest.startTick) / this.mani` |
| `durationSeconds` | 读取 13 处 | 19 | `src/app/28-radar.js:1893`<br>`durationSeconds: t.meta.durationSeconds,` |
| `rounds` | 读取 27 处 | 32 | `src/app/28-radar.js:1894`<br>`rounds: t.rounds,` |
| `players` | 读取 41 处 | 64 | `src/app/28-radar.js:3236`<br>`e.players.some((e, t) => e.steamId !== this.data.players[t].st` |
| `weaponNames` | 读取 10 处 | 15 | `src/app/10-character-model.js:745`<br>`let { panelFrames: o, weaponNames: s } = e` |

**data.meta（每段）**

| 字段 | 结论 | 消费者 | 证据（第一处） |
| --- | --- | ---: | --- |
| `startTick` | 读取 116 处 | 170 | `src/app/00c-frame-sampler.js:31`<br>`{ startTick: n, tickRate: r } = e.meta,` |
| `tickRate` | 读取 93 处 | 100 | `src/app/00c-frame-sampler.js:31`<br>`{ startTick: n, tickRate: r } = e.meta,` |
| `numPlayers` | 读取 46 处 | 68 | `src/app/00a-grenade-trajectory.js:45`<br>`a = e.meta.numPlayers,` |
| `sampleRate` | 读取 8 处 | 13 | `src/app/28-radar.js:2014`<br>`sampleRate: t.meta.sampleRate,` |
| `durationSeconds` | 读取 13 处 | 19 | `src/app/00c-frame-sampler.js:33`<br>`this.duration = i > 0 ? (t[i - 1] - n) / r : Math.max(0, e.met` |
| `mapName` | 读取 20 处 | 22 | `src/app/28-radar.js:1889`<br>`mapName: t.meta.mapName,` |

**data.frames（逐帧 SoA）**

| 字段 | 结论 | 消费者 | 证据（第一处） |
| --- | --- | ---: | --- |
| `frameTick` | 读取 39 处 | 54 | `src/app/00a-grenade-trajectory.js:46`<br>`o = i.frameTick` |
| `posX` | 读取 15 处 | 19 | `src/app/10-character-model.js:848`<br>`let { posX: a, posY: o } = e.frames` |
| `posY` | 读取 14 处 | 18 | `src/app/10-character-model.js:848`<br>`let { posX: a, posY: o } = e.frames` |
| `posZ` | 读取 8 处 | 12 | `src/app/10-character-model.js:812`<br>`let { posZ: a, playerFlags: o } = e.frames` |
| `yaw` | 读取 36 处 | 39 | `src/app/10-character-model.js:844`<br>`let { yaw: a } = e.frames` |
| `pitch` | 读取 26 处 | 29 | `src/app/11-character-renderer.js:246`<br>`let { frameTick: r, yaw: i, pitch: a, duck: o, alive: s, posX:` |
| `health` | 读取 10 处 | 16 | `src/app/00c-frame-sampler.js:83`<br>`;((t.alive[e] = n.alive[o]), (t.health[e] = n.health[o]), (t.t` |
| `alive` | 读取 60 处 | 66 | `src/app/10-character-model.js:823`<br>`let { posZ: o, playerFlags: s, frameTick: c, alive: l } = e.fr` |
| `team` | 读取 39 处 | 54 | `src/app/28-radar.js:2819`<br>`s = r.team[o + e],` |
| `score` | 读取 18 处 | 21 | `src/app/01-timeline-utils.js:37`<br>`t === 2 && p < 0 ? ((p = e), (d = r.score[u + e])) : t === 3 &` |
| `duck` | 读取 12 处 | 15 | `src/app/10-character-model.js:919`<br>`let { frameTick: r, posX: i, posY: a, alive: o, duck: s } = e.` |
| `flash` | 读取 15 处 | 21 | `src/app/00a-grenade-trajectory.js:47`<br>`if (!a \|\| !o.length \|\| i.flash.length < o.length * a) retu` |
| `flashAlpha` | 读取 3 处 | 8 | `src/app/00c-frame-sampler.js:81`<br>`(t.flashAlpha[e] = Math.max(0, xg(n.flashAlpha[r], n.flashAlph` |
| `zoom` | 读取 20 处 | 23 | `src/app/00c-frame-sampler.js:83`<br>`;((t.alive[e] = n.alive[o]), (t.health[e] = n.health[o]), (t.t` |
| `accuracyPenalty` | 读取 4 处 | 12 | `src/app/00c-frame-sampler.js:84`<br>`let s = n.accuracyPenalty?.[r] ?? -1,` |
| `reloading` | 读取 6 处 | 13 | `src/app/10-character-model.js:783`<br>`;((a.reloadAge = 1 / 0), (a.reloading = !1))` |
| `playerFlags` | 读取 8 处 | 15 | `src/app/10-character-model.js:791`<br>`let { playerFlags: o, frameTick: s } = e.frames` |

**data.panelFrames（回合级 SoA）**

| 字段 | 结论 | 消费者 | 证据（第一处） |
| --- | --- | ---: | --- |
| `frameTick` | 读取 51 处 | 66 | `src/app/11-character-renderer.js:894`<br>`let t = e.data.panelFrames.frameTick,` |
| `health` | 读取 11 处 | 18 | `src/app/00c-frame-sampler.js:83`<br>`;((t.alive[e] = n.alive[o]), (t.health[e] = n.health[o]), (t.t` |
| `alive` | 读取 68 处 | 75 | `src/app/28-radar.js:2894`<br>`if (n.kind === `first` && this.buffers.alive[n.slot] === 1) {` |
| `team` | 读取 42 处 | 58 | `src/app/11-character-renderer.js:833`<br>`r = t.panelFrames.team.length ? t.panelFrames.team[this.panelF` |
| `armor` | 读取 11 处 | 15 | `src/app/06-world-props.js:380`<br>`Jb = { armor: `armor`, armorHelmet: `armor_helmet`, defuser: `` |
| `flags` | 读取 8 处 | 12 | `src/app/26-scorebar-hud.js:267`<br>`i.bombCarrier === s ? (m = FM) : e.team[s] === 3 && (i.panelFr` |
| `money` | 读取 8 处 | 12 | `src/app/27-player-panels.js:80`<br>`e.money,` |
| `equipValue` | **⚠️ 只写不读（死字段）** | 4 | `src/app/31-hosted-demo.js:800`<br>`d = e.readRequiredTypedArray(Q.Uint16, `panels.equipValue`),` |
| `clipAmmo` | 读取 2 处 | 6 | `src/app/28-radar.js:2976`<br>`clipAmmo: t.clipAmmo[n],` |
| `reserveAmmo` | 读取 2 处 | 6 | `src/app/28-radar.js:2977`<br>`reserveAmmo: t.reserveAmmo[n],` |
| `activeWeapon` | 读取 13 处 | 17 | `src/app/26-scorebar-hud.js:266`<br>`;((h = Xb(i.weaponNames[i.panelFrames.activeWeapon[t]])),` |
| `utilCounts` | 读取 2 处 | 6 | `src/app/28-radar.js:2963`<br>`o = t.utilCounts[n],` |

**data.players / events / bomb / deathRagdolls**

| 字段 | 结论 | 消费者 | 证据（第一处） |
| --- | --- | ---: | --- |
| `steamId` | 读取 1 处 | 10 | `src/app/28-radar.js:3236`<br>`e.players.some((e, t) => e.steamId !== this.data.players[t].st` |
| `name` | 读取 247 处 | 253 | `src/app/13-fire-manager.js:62`<br>`(c.name = `HazardVolume`),` |
| `clanName` | 读取 5 处 | 7 | `src/app/01-timeline-utils.js:39`<br>`let h = (p >= 0 && a[p]?.clanName) \|\| `T`,` |
| `color` | 读取 66 处 | 75 | `src/app/13-fire-manager.js:129`<br>`(this.cubes = new ea(new oo(12, 12, 18), new _i({ color: 15698` |
| `slot` | 读取 54 处 | 71 | `src/app/11-character-renderer.js:832`<br>`n = SC(t, e.slot, e.tick, this.motion),` |
| `crosshairCode` | 读取 1 处 | 3 | `src/app/28-radar.js:2941`<br>`let n = this.data.players[e]?.crosshairCode` |
| `tick` | 读取 114 处 | 185 | `src/app/11-character-renderer.js:832`<br>`n = SC(t, e.slot, e.tick, this.motion),` |
| `type` | 读取 147 处 | 160 | `src/app/02-map-assets.js:125`<br>`if (e.data.type === `decoding`) {` |
| `attackerSlot` | 读取 20 处 | 27 | `src/app/28-radar.js:3187`<br>`t.weapon === `world` \|\| (t.victimSlot !== void 0 && t.attack` |
| `victimSlot` | 读取 39 处 | 47 | `src/app/06-world-props.js:173`<br>`let i = t[r.data.victimSlot] === 1,` |
| `weapon` | 读取 33 处 | 36 | `src/app/11-character-renderer.js:834`<br>`i = n.weapon ? Qy(n.weapon, r) : void 0,` |
| `segments` | 读取 19 处 | 24 | `src/app/28-radar.js:2672`<br>`let { segments: t } = this.data.bomb,` |
| `defuses` | 读取 2 处 | 6 | `src/app/00d-bomb-defuse.js:12`<br>`for (let n of e.bomb.defuses) {` |
| `deathRagdolls` | 读取 2 处 | 4 | `src/app/28-radar.js:3274`<br>`(this.data.deathRagdolls = e.deathRagdolls),` |


---

## 附录 E — 真实 demo 验证结果（2026-11-09）

> **这是本文档第一次用真实数据验证，而不是靠读代码推断。**
> 复现：`node tools/validate-contract-against-demo.mjs --demo <你的dem>`
> （demo 路径**没有默认值**，必须显式给；也可用环境变量 `CSDEMO_DEM=<路径>`）

### E.1 测试样本

| 项 | 值 |
| --- | --- |
| 文件 | `test.dem`（87 MB，Source2 `PBDEMS2`） |
| 服务器 | 完美世界竞技平台天梯服务器 |
| 地图 | `de_dust2` |
| `patch_version` | 14192 |
| 回合数 | 22 |
| 帧数（64 Hz） | 114 326 帧 × 10 人 = 1 143 260 个采样 |
| 解析耗时 | 约 14–19 秒（header 33 ms / manifest 1.8 s / round stream 12–17 s） |

### E.2 验证结果：**25 项通过，0 项失败**

| 分组 | 验证内容 | 结果 |
| --- | --- | --- |
| 索引公式 | frames 所有列长度 = N×P（114 326×10） | ✅ |
| 索引公式 | panelFrames 所有列长度 = M×P（14 291×10） | ✅ |
| **附录 B** | **frames 与 panelFrames 的 tick 数 114 326 ≠ 14 291** | ✅ **得到真实数据证实** |
| 附录 B | frames 间隔 **1 tick**、panelFrames 间隔 **8 tick** | ✅ |
| §3.2 | `frameTick` 严格升序；首末与 `meta.startTick`/`endTick` 一致 | ✅ |
| §3.2 | `team` ∈ {0,2,3}、`alive` ∈ {0,1}、`zoom` ∈ {0,1,2}、`reloading` ∈ {0,1} | ✅ |
| §3.2 | `health` ⊂ [0,100]、`duck` ⊂ [0,1] | ✅ |
| §3.4 | `yaw` ⊂ [-180, 179.999]、`pitch` ⊂ [-63.94, 89.00] → **确认是度** | ✅ |
| §3.2 | `accuracyPenalty` 全部为 -1 或 ≥0（有数据 424 879 个） | ✅ |
| §1 | manifest 含 docs/07 列出的全部字段 | ✅ |
| §5 | `players[].steamId` 是字符串（`"76561197962984717"`） | ✅ |
| §4 | `equipValue` 确实被填充（114 328/142 910 非零） | ✅ 印证「只写不读」 |

### E.3 这次验证修正/补充了 6 处契约

| # | 原文档 | 实测 | 已修正为 |
| --- | --- | --- | --- |
| 1 | `team` 只说 2=T / 3=CT | 还有 **0**，占 20%，且 team=0 时 alive 恒为 0 | **0 = 该玩家未参与本回合** |
| 2 | `yaw` 只说"角度制" | 归一化到 **(-180, 180]** | 已写明归一化区间 |
| 3 | 没提 `rounds[].index` | 实际有 `{index, startTick, endTick, liveStartTick}` | §6 已补 |
| 4 | 没提 `panelFrames.numFrames` | 是**标量** 14 291，而 `frames` 没有该字段 | §4.1 已注明这个不对称 |
| 5 | 没提 `weaponNames[0]` | 是**空字符串** | §4.1 已注明下游必须容忍空武器名 |
| 6 | §5 未列 players 实际字段 | `{slot, steamId, name, clanName?, color}`，**没有 team**；clanName 可选；color 是字符串 | §5.1 已补 |

### E.4 附带产出：真实 fixture 替换了合成数据

`fixtures/` 现在由 **`node tools/gen-fixture-from-demo.mjs --demo <你的dem>`** 从真实 demo 生成
（不再是早期手写的假数据）：

| 文件 | 内容 |
| --- | --- |
| `fixtures/manifest.json` | **真实**地图名、22 个回合、10 名玩家的真实 steamId/昵称/战队/配色、29 个武器名 |
| `fixtures/segment-000.bin` | 窗口 ticks 0..1920（1 921 帧 × 10 人）+ panelFrames 241 帧，871 936 字节，`crc32 = 0xe760d88b` |
| `fixtures/segment-000.json` | 首帧逐玩家原始值 + 各列偏移，便于 C++ 侧对齐 |

> `node tools/validate-fixture-data.mjs fixtures/segment-000.bin` 已验证通过。

### E.5 仍然未知的

- **只有一张图、一种服务器配置**：`de_dust2` + 完美世界天梯。其他地图（尤其带特殊实体/破坏物的）未验证。
- **未验证 `panelFrames` 的 tick 集合是否会超出 `frames` 的范围**：本样本里 100% 落在 frames 集合内，但代码结构允许不同（附录 B）。
- **未验证多段（分窗）拼接**：本次只生成了单段。`meta.startTick` 保持不变这条约定是靠读代码得出的（§8.2），未被真机验证。


---

## 附录 F — 分窗（分段）时速度列的历史要求

> 前提：`meta.startTick` 恒等于 `manifest.startTick`，窗口只靠 `frameTick` 数组内容体现（见 §8.2）。
> 但**速度两列有额外的时间依赖**，分窗时必须处理，否则段边界会出可见偏差。

| 列 | 依赖 | 分窗要求 | 不做的后果 |
| --- | --- | --- | --- |
| `speed[i]` | **帧 i+1** | 每段**后置多算 1 帧**（`frameTick` 不要它，只需拿它算速度） | 段末帧的 speed 会退化成后向差分；实测最多偏 ~28 单位/秒 |
| `smoothSpeed[i]` | **向前 1 秒（=64 tick）** | 每段**前置多算 64 tick 的历史** | 段首的平滑速度偏低（像刚起步）；越靠近开局越明显 |

### F.1 推荐的窗口切法

```
      ┌─ 需要前 64 tick 的历史来算它 ─┐
      │                              ▼
──────┼──────────────────────────────┼──────────────────────┼─────
   段首-64t                        段首                   段尾  段尾+1t
      └────── 只用于算 speed/smoothSpeed，不发出去 ──────┘
```

- 交付的 `frameTick` 仍是 `[段首, 段尾]`
- 计算 `smoothSpeed[段首]` 时需要 `frameTick ∈ [段首-64t, 段次]` 的 `posX/posY/alive`
- 计算 `speed[段尾]` 时需要 `frameTick = 段尾+1t` 那一帧

### F.2 如果实在不想做重叠

可以接受，但要知道代价：段首的 `smoothSpeed` 会偏小。经验上：

- 前置完全不给（0 历史）→ 段首约 **1 秒**内动画会显得"慢半拍"
- 前置给一半（32 tick）→ 偏差降到肉眼难辨

### F.3 首段与末段

- **首段**：没有更早的历史，`smoothSpeed` 窗口内的帧不足 1 秒是正常的（原实现也是这样，因为 `frameTick[0]` 之前没有数据）
- **末段**：没有后一帧，最后一帧的 `speed` 按定义退化为后向差分 —— **这是规范允许的**，不算错误
