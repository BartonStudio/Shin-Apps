# 08 · C++ 侧对接说明：怎么把 `data` 交给前端

> 本文是给 **C++ 侧**看的接口规格。字段级契约以 `docs/07-data-contract.md` 为准，
> 本文只讲「怎么组织、怎么传、传完会发生什么」。
>
> 所有数字都来自真实 demo（`test.dem`，de_dust2，22 回合，87 MB，64 Hz）实测。
>
> **选型前提（已定，不再讨论）**：解析与计算全部放在**原生 C++**，通过 **WebView2 共享内存**交给 JS。
> 不使用 wasm。决策依据见 §3.1。

---

## 一、现在 JS 的数据入口：三条路径，收敛到同一个 `data`

```
① 本地 .dem 文件
──────────────────────────────────────────────────────────────────────
  File 对象
    │ file.arrayBuffer()                                32-app-shell:L250
    ├─► 缓存键 = sha256(bytes) + ':' + sampleRate          L158 / L252
    │
    ├─► 命中 IndexedDB ────────────────────────────────► data  ┐
    │     fL(key)  L255，fromCache = true                      │
    │                                                          │
    └─► 未命中                                                 │
          new Worker('/assets/parser.worker-*.js', {type:'module'})  L264
          postMessage({ type:'parse', bytes, options }, [bytes])     L302-303
              │  ⚠️ ArrayBuffer 所有权转移给 worker
              │
              │  worker 内：wasm 解析 → 列 Map → TypedArray → data
              │
          ◄── ⑤ 条消息                                       L276-297
                { type:'progress', phase, value }
                { type:'manifest', manifest }
                { type:'ready',  data, manifest, loadedRounds }    ← 第 1 回合
                { type:'round',  data, loadedRounds }              ← 后续每回合
                { type:'done',   data }                            ← 全部完成
                { type:'error',  message }
              │  data 随消息**零拷贝 transfer**（transfer list 是显式列举的）

② 缓存命中（IndexedDB）
──────────────────────────────────────────────────────────────────────
  fL(key) → 直接拿到完整 data，**不跑 wasm**

③ 托管比赛（.csda）
──────────────────────────────────────────────────────────────────────
  下载 data.csdemo.tv 的产物 → 纯 JS 解码器 → 同一个 data（不跑 wasm）

④ 三条路径汇合之后
──────────────────────────────────────────────────────────────────────
  c(data, loadedRounds)                            33-landing-backdrop:L487-510
    │
    ├─ 首次：r.app = kz(data, opts, manifest, loadedRounds)
    │         └─ new TP(viewport, data, opts, manifest, rounds, …)   28-radar:L1884
    │            构造末尾立刻：sampleAndRender(0) + clock.play() + rAF(tick)
    │            ↑ 注意：**不等地图加载**，prepareMap 是并行跑的
    │
    └─ 后续：r.app.replaceRoundData(data, loadedRounds)            L3231
              返回 false → 调用方 dispose() + 重建 + restorePlaybackState()
```

**C++ 要顶掉的就是 ①②③ —— 也就是"谁产出 `data`"。④ 之后一行都不用动。**

---

## 二、`data` 的完整结构（实测导出）

### 2.1 `meta`（8 个标量，全部必需）

| 字段 | 类型 | 实测值 | 说明 |
| --- | --- | --- | --- |
| `mapName` | string | `"de_dust2"` | 决定加载哪张地图 |
| `tickRate` | number | `64` | **必须 64** |
| `sampleRate` | number | `64` | 只是记录，消费方不依赖 |
| `numPlayers` | number | `10` | = P |
| `numFrames` | number | `114326` | = N |
| `startTick` | number | `0` | ★ **tick 换算基准，必须恒等于 `manifest.startTick`**，分窗时**不得**改成窗口起点 |
| `endTick` | number | `114325` | |
| `durationSeconds` | number | `1786.33` | |

### 2.2 `players`（长度 P 的对象数组，全部必需）

```js
{ slot: number, steamId: string, name: string, clanName?: string, color?: string, crosshairCode?: string }
```

- **`steamId` 必须是字符串**（SteamID64 超过 2^53）
- **没有 `team` 字段** —— 队伍只在 `frames.team` / `panelFrames.team` 里
- `color` 是字符串：`blue` / `purple` / `orange` / `green` / `yellow`

### 2.3 `frames`（SoA 主数据）

**索引公式（唯一铁律）：`值 = 数组[帧序号 * numPlayers + 玩家序号]`**

| 字段 | 类型 | 长度 | 必需 | 值域 / 说明 |
| --- | --- | --- | --- | --- |
| `frameTick` | `Int32Array` | N | ✅ | **严格升序**的**绝对** tick |
| `posX` `posY` `posZ` | `Float32Array` | N×P | ✅ | Source2 单位 |
| `yaw` | `Float32Array` | N×P | ✅ | **度**，归一化到 `(-180, 180]` |
| `pitch` | `Float32Array` | N×P | ✅ | **度**，约 `[-64, 89]` |
| `health` | `Uint8Array` | N×P | ✅ | `0..100` |
| `alive` | `Uint8Array` | N×P | ✅ | `0` / `1` |
| `team` | `Uint8Array` | N×P | ✅ | `0`（未参与本回合）/ `2`（T）/ `3`（CT） |
| `score` | `Uint8Array` | N×P | ✅ | |
| `duck` | `Float32Array` | N×P | ✅ | `0..1` |
| `flash` | `Float32Array` | N×P | ✅ | 闪光剩余时间 |
| `flashAlpha` | `Float32Array` | N×P | ✅ | 白屏强度 |
| `zoom` | `Uint8Array` | N×P | ✅ | `0` / `1` / `2` |
| `accuracyPenalty` | `Float32Array` | N×P | 可选 | `-1` = 无数据 |
| `reloading` | `Uint8Array` | N×P | 可选 | `0` / `1` |
| `playerFlags` | `Uint8Array` | N×P | 可选 | bit2 = 带包 |
| **`speed`** | `Float32Array` | N×P | ✅ **必需** | 见 §2.6 |
| **`smoothSpeed`** | `Float32Array` | N×P | ✅ **必需** | 见 §2.6 |

> ⚠️ `speed` / `smoothSpeed` **不做空值保护** —— 缺了渲染循环会直接抛 `TypeError`。
> 这是刻意的：规范违规应该立刻暴露，而不是静默让角色滑步。

### 2.4 `panelFrames`（侧边面板，粒度比 `frames` 粗）

**索引公式同上**：`值 = 数组[面板帧序号 * numPlayers + 玩家序号]`

| 字段 | 类型 | 长度 | 说明 |
| --- | --- | --- | --- |
| `numFrames` | number | — | **标量** M（注意 `frames` 没有这个字段） |
| `frameTick` | `Int32Array` | M | 实测每 **8 tick** 一帧（frames 是 1 tick） |
| `health` `alive` `team` `armor` `flags` | `Uint8Array` | M×P | |
| `activeWeapon` `utilCounts` | `Uint8Array` | M×P | |
| `money` `clipAmmo` `reserveAmmo` | `Uint16Array` | M×P | |

> `equipValue` **已从契约移除**（全库零读取）。原 worker 因历史原因仍会产它，
> C++ 侧不要发。JS 侧本就不读。

### 2.5 其余 15 个字段（实测形状）

```js
events:          Array(n) { tick, time, type }                        // type: round_start / round_end / player_death / …
rounds:          Array(r) { index, startTick, endTick, liveStartTick }
grenades: {
  trajectories:  Array { kind, throwerSlot, posXYZ: Float32Array, ticks: Int32Array,
                         startTick, endTick, detonationTick, angles?: Float32Array }
  effects:       Array { kind, x, y, z, startTick, endTick }
  infernos:      Array { entityId, startTick, endTick, effectTick, infernoType, lifetime,
                         frames: Array { tick, positions, burning, origin, parentPos… } }
}
tracers:         { origin: Float32Array(count*3), end: Float32Array(count*3),
                   tick: Int32Array(count), team: Uint8Array(count),
                   hitKind: Uint8Array(count), count: number }
smokeVoxels:     { count, tickBegin: Int32Array(count), detonation: Float32Array(count*3),
                   color: Float32Array(count*3), bufferOffsets: Int32Array(count+1),
                   buffers: Uint8Array(totalBytes), frameOffsets: Int32Array(count+1),
                   frameTicks: Int32Array(totalFrames) }
damage:          { attackerSlot, victimSlot: Uint8Array(count), tick: Int32Array(count),
                   dmg: Uint8Array(count), count: number }
bomb:            { segments: Array { kind, startTick, endTick, x, y, z, carrierSlot, site },
                   defuses:  Array { startTick, endTick, hasKit, defuserSlot } }
timeouts:        { maxTacticalTimeouts, intervals: Array, counters: Array { tick, tRemaining, ctRemaining } }
deathMarkers:    Array { x, y, z, startTick, endTick, victimSlot, team, name }
droppedWeapons:  Array { entityId, weapon, itemDef, startTick, endTick, ticks, positions, angles }
weaponFires:     { ticks: Int32Array(n), slots: Uint8Array(n) }
mapEntities:     Array { className, origin: [x,y,z], startTick, endTick, ticks, angles, hidden }
deathRagdolls:   Array { tick, slot, force: [x,y,z], bone, headshot, eyeAngles: [yaw,pitch] }
weaponNames:     Array(string)        // ⚠️ [0] 是空字符串，下游必须容忍空武器名
```

**实测规模**（22 回合全程）：events 216、rounds 22、grenade trajectories 306 / effects 302 / infernos 66、
tracers 2989、smokeVoxels count 88（buffers 222 101 B）、damage 606、bomb segments 79 / defuses 3、
deathMarkers 157、droppedWeapons 481、weaponFires 3612、mapEntities 3、deathRagdolls 123、weaponNames 29。

### 2.6 两列速度的语义（C++ 必须复刻）

**唯一规范实现**：`src/deobfuscated/speed-columns.js`。以下是要点，完整定义见 `docs/07` §3.5。

| 列 | 语义 | 消费者 | 渲染层怎么取 |
| --- | --- | --- | --- |
| `speed` | **瞬时**水平速度 = 相邻采样帧的水平位移 / 时间差，带 4 条守卫 | 脚步声节拍、开镜速度读数 | 取**区间左端那一帧**（分段常量） |
| `smoothSpeed` | 过去 **1 秒**、时间常数 **0.1s** 的指数加权平均速度 | 走/跑/蹲动画混合、姿态根偏移 | **线性插值** |

`speed` 的四条守卫（任一不满足 → 该帧该玩家 = 0）：
```
g = (frameTick[q] - frameTick[f]) / tickRate        // f/q 是相邻采样帧
g > 0
g <= 2 / sampleRate
区间 (frameTick[f], frameTick[q]] 内无回合起点
alive 两端都为 1  且  team 两端相同
```

`smoothSpeed` 的三个常量（**不要改**）：
```
EMA_TAU = 0.1          // 时间常数
EMA_WINDOW = 10*TAU = 1.0
MAX_INSTANT = 600      // 瞬时速度上限，超过视为瞬移并丢弃
MAX_FRAME_DT = 0.25    // 单帧时长上限，超过视为不连续并跳过
```

---

## 三、C++ 怎么把数据交给 JS：**原生 + WebView2 共享 buffer**

> **选型已定：只做原生 C++，不用 wasm。** 本节记录这个决策的依据，避免以后反复讨论。

### 3.1 为什么不用 wasm（决策记录）

| 原因 | 说明 |
| --- | --- |
| **文件 I/O** | wasm 沙盒**没有文件系统**。87 MB 的 `.dem` 必须由 JS 读进来再拷进 wasm 线性内存 —— 每次解析白付 87 MB 拷贝。原生 `mmap` 直接映射，零拷贝 |
| **线程** | wasm 线程要 `SharedArrayBuffer` → 要 `crossOriginIsolated` → 要 COOP/COEP 头，在 WebView2 虚拟主机下很折腾。原生 `std::thread` 随便开 |
| **SIMD** | wasm 只有 SIMD128；原生 AVX2/AVX-512 |
| **UI 阻塞** | wasm 在渲染线程，长解析必须扔 Worker；原生天然在别的进程 |
| **调试** | 原生有完整调试器 + ASAN/TSAN；wasm 崩溃只有一个 `unreachable` |

**唯一放弃的收益**：wasm 的沙盒能兜住 C++ 内存 bug（解析不可信 `.dem` 时的 RCE 风险）。
**这个风险用「解析放进独立低权限子进程」来缓解** —— 见 3.2。

### 3.2 进程与数据流

```
┌─ 主进程（桌面壳）────────────────────────────────────────┐
│  WebView2 宿主                                          │
│    · 窗口 / 菜单 / 文件选择                              │
│    · CoreWebView2Environment::CreateSharedBuffer()      │
│    · 把 buffer 句柄同时交给解析子进程和页面               │
└──────────┬──────────────────────────┬───────────────────┘
           │ 共享内存（双缓冲交替）      │ PostSharedBufferToScript
           ▼                          ▼
┌─ 解析子进程（低权限）─────────┐  ┌─ WebView2 页面 ─────────────┐
│  原生 C++                     │  │  只读共享内存                │
│   · mmap(test.dem)            │  │  new Float32Array(ab, off,  │
│   · 多线程解析                 │  │      len)  ← 零拷贝视图      │
│   · 速度两列 / 布娃娃物理       │  │  sample() 插值               │
│   · 直接写共享内存             │  │  three.js 渲染              │
└───────────────────────────────┘  └─────────────────────────────┘
```

**为什么放独立子进程**：`.dem` 是用户提供的不可信二进制。解析器的越界写若发生在主进程里，
等于给恶意 demo 打开整个桌面应用的权限。放子进程后，崩了/被攻破也只影响子进程。

### 3.3 WebView2 的桥

WebView2 SDK 自带共享内存通道（不需要写原生插件）：

```cpp
// 1) 建一块共享内存（主进程）
wil::com_ptr<ICoreWebView2Environment> env;
wil::com_ptr<ICoreWebView2SharedBuffer> shared;
env->CreateSharedBuffer(byteCount, &shared);        // 大小自定

// 2) 让解析子进程也拿到这块内存
//    ICoreWebView2SharedBuffer::get_FileMappingHandle() → 把句柄传给子进程，
//    子进程用 OpenFileMapping + MapViewOfFile 映射到自己的地址空间

// 3) 数据写好后，把 buffer 交给页面
webview->PostSharedBufferToScript(
    shared,
    COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,    // 页面只读
    L"{\"version\":1}");                           // 附带元数据（JSON）
```

```js
// JS 侧
chrome.webview.addEventListener('sharedbufferreceived', (e) => {
  const meta = JSON.parse(e.additionalData)   // { version: 1 }
  const ab = e.getBuffer()                    // ArrayBuffer，映射同一块内存
  // …见 3.6…
})
```

> ⚠️ **关键区别**：WebView2 给 JS 的是**普通 `ArrayBuffer`**，不是 `SharedArrayBuffer`。
> 所以：✅ 零拷贝读没问题；❌ **`Atomics` 不可用**（不是 SAB）；
> ✅ 但也**不需要 COOP/COEP** 跨源隔离头。
> **同步必须靠消息通道**（`PostWebMessageAsString` 传版本号），好在它是有序的。

> 📌 API 名与最低 Runtime 版本请按你手上的 SDK 头文件确认一次（我这边无法验证你的版本）。

### 3.4 共享内存布局

固定的头部 + 描述符区 + 对齐的数据区。**描述符表让布局可以演进** ——
JS 按列名查偏移，找不到就报错，而不是按硬编码偏移读错位。

```
偏移 0       magic          u32   'CSDF' = 0x46445343
偏移 4       version        u32   布局版本
偏移 8       state          u32   0=空闲 1=写入中 2=就绪
偏移 12      numFrames      u32   N
偏移 16      numPlayers     u32   P
偏移 20      panelNumFrames u32   M
偏移 24      flags          u32
偏移 28      startTick      i32   ★ 必须恒等于 manifest.startTick
偏移 32      endTick        i32
偏移 36      tickRate       u32   64
偏移 40      roundCount     u32
偏移 44      mapNameLen     u32
偏移 48      mapName        utf8[64]
偏移 112     rounds         { index, startTick, endTick, liveStartTick } × roundCount
偏移 …       players        { slot, steamIdLen, steamId[24], nameLen, name[48], … } × P
偏移 …       列描述符表      { type u8, dim u8, pad u16, byteOffset u32, byteLen u32 } × 列数
             type: 1=f32 2=i32 3=u8 4=u16
             dim : 0=标量 1=N 2=N*P 3=M 4=M*P 5=其他
偏移 4096    ── 数据区（16 字节对齐）──
               frames.posX / posY / posZ / yaw / pitch / …
               frames.speed / frames.smoothSpeed
               panelFrames.*
               tracers.* / damage.* / smokeVoxels.*
```

**估算大小**（真实 demo，22 回合全程）：

| 组 | 字节 |
| --- | ---: |
| `frames`（17 列，含两列速度） | 58.7 MB |
| `panelFrames`（11 列） | 1.8 MB |
| `tracers` + `damage` + `smokeVoxels.buffers` | ≈ 0.3 MB |
| **合计（一块）** | **≈ 61 MB** |

双缓冲 → **≈ 122 MB** 常驻。桌面应用完全可以接受。

#### 3.4.1 元数据区：JSON 索引 + blob 二进制

> **实测教训**：最初把所有变长数组也 JSON 化，真实 demo 的元数据膨胀到 **28.9 MB**
> （grenades.trajectories 17.6 万个点、droppedWeapons 3.8 万个 tick），每回合 parse 一次不可接受。

改成两层：

```
元数据区 A/B（各 1 MB）          列块区（~64 MB）
  ├─ JSON（实测 462 KB）           ├─ frames.* / panelFrames.*（零拷贝视图）
  │   rounds / players /          ├─ tracers / damage / weaponFires / smokeVoxels
  │   weaponNames / events /      └─ blob 区（6.0 MB）
  │   bomb / deathMarkers /           变长 TypedArray 顺序拼在一起，8 字节对齐
  │   grenades 的标量部分
  └─ 变长数组只存引用 { o, n, t }     ← JSON 里指到 blob 的切片
```

JSON 里的引用形如 `{ "o": 131072, "n": 528, "t": "f32" }`，读取时
`new Float32Array(ab, blobOffset + o, n)` —— **零拷贝**。

**JSON 实测 462 KB**（不是 28.9 MB），每回合 parse 一次约 5 ms。

### 3.5 发布协议：单块内存 + 回合粒度 + 消息带水位

> **决策**：发布单位是**回合**，不是帧。已解析的部分以回合为单位离散增加，这是可以接受的。

#### 为什么不需要锁

`frames` / `panelFrames` / `tracers` / `damage` / `weaponFires` / `smokeVoxels` 都是
**按 tick 递增的 append-only 结构**（合计占 99.7% 数据量）。所以：

```
C++ 只写  [已发布水位, ∞)         ← 新回合的数据
JS  只读  [0, 已发布水位)         ← 天然分区，物理上不可能撞上
```

**append-only 结构根本不需要锁** —— 这比双缓冲省一半内存（61 MB vs 122 MB），也不需要任何互斥原语。

#### ⚠️ 水位必须走消息，不能让 JS 从内存里读

这一点是**正确性要求**，不是风格偏好：

| 做法 | 问题 |
| --- | --- |
| ❌ JS 从共享内存读 `header.writeIndex` | 跨进程的普通内存读**没有内存序保证**，可能读到旧值；而 WebView2 给的是普通 `ArrayBuffer`，**`Atomics` 不可用**，补不了 |
| ✅ **把水位放进 post 消息** | 消息投递本身构成 happens-before 边界，天然有同步语义 |

所以每次发布都用消息携带全部水位：

```jsonc
// C++ → JS，每解析完一个回合发一次
{
  "version": 7,                  // 单调递增；JS 忽略旧版本（防乱序）
  "loadedRounds": 7,             // 已发布到第几个回合（1 起）
  "visibleFrames": 39820,        // frames 可见的帧数（= N*P 的那个 N）
  "panelVisibleFrames": 4977,    // panelFrames 可见的面板帧数（= M）
  "durationSeconds": 622.2       // 已可播时长
}
```

`Header` 里那份 `writeIndex` **只做启动时的冗余校验**，之后 JS 一律以消息为准。

#### ⚠️ 回合粒度下仍然存在「回头改」——但只有 3 类

绝大多数数据是纯追加，但这三类**会修改已发布区域**（实测核对过）：

| 数据 | 为什么会回头改 | 规模 | 处理办法 |
| --- | --- | --- | ---: |
| `bomb.segments[last].endTick` | 一个炸弹状态段的结束 tick 要等下一个事件（通常是下一回合的 `round_start`）才知道 | 1 条 | 见下 |
| `deathMarkers[last].endTick` | 死亡标记的 `endTick` = **下一个回合的起点** | 最后一批 | 见下 |
| `rounds[].liveStartTick` | 用 `round_start_time` 的**中位数偏移**反推，属于全局统计 | 最多 1 条 | 见下 |

**处理办法：把这 3 类放进独立的「小元数据区」，双份 A/B 按版本交替写。**

```
大块 append-only 区（单份，~61 MB）
  frames.* / panelFrames.* / tracers.* / damage.* / weaponFires.* / smokeVoxels 数据体

小元数据区（双份 A/B，按 version 奇偶交替，~100 KB × 2）
  rounds[] / bomb.segments / bomb.defuses / deathMarkers /
  players[] / weaponNames[] / 列描述符表 / 各 count
```

JS 按当前 `version` 的奇偶决定读 A 还是 B。**代价 100 KB，换掉全部锁和撕裂风险。**

> 顺带解决另一个问题：`smokeVoxels` 的 `bufferOffsets` / `frameOffsets` 是**前缀和**，
> 追加一个烟雾时要改最后一项。把 offsets 表放进元数据区（双份）就一起解决了。

#### 为什么回合粒度让 JS 侧改动极小

因为**每个回合发布时，上一个回合之前的所有数据都已定稿**（原项目就是这个语义）。
所以 JS 可以完全复用现有的 `replaceRoundData(data, loadedRounds)` 热替换路径 ——
它内部做的正是「整块换 `this.data.frames` + `new bg(data)` 重建采样器」，
而我们每次只是把视图的 `length` 换成新的可见长度，**零拷贝**。

### 3.6 JS 侧的接法：每次重建视图，零拷贝

> ✅ **已实现并验证**：`src/deobfuscated/shared-buffer.js`
> 复现：`node tools/test-shared-buffer.mjs --demo <你的dem>` → **PASS 76 / FAIL 0**
> （真实 demo 打包→读回，全部列与字段逐字节/逐值一致；含部分可见与越界防护）

核心技巧：**每次收到回合消息，就用新的可见长度重建一遍 `TypedArray` 视图。**

- 视图是 `new Float32Array(ab, byteOffset, length)` —— **不复制任何数据**，只是一层描述符
- 30 个视图的构造成本 ≈ 微秒级，每回合一次完全无感
- 关键收益：`frameTick.length` 自动等于可见帧数，于是
  `numFrames` getter / `findFrame()` 二分 / 采样器 `duration` **全部不用改一行**

```js
function buildDataFromSharedBuffer(ab, visible) {
  const u32 = new Uint32Array(ab, 0, 16)
  if (u32[0] !== 0x46445343) throw Error('CSDF: bad magic')

  const P = u32[4], metaBlock = u32[5]           // panelNumFrames
  const startTick = new Int32Array(ab, 28, 1)[0]
  const tickRate = u32[9]

  // 元数据区（双份 A/B）：按 version 奇偶选
  const metaA = readMetaRegion(ab, 'A')
  const metaB = readMetaRegion(ab, 'B')
  const metaRegion = (visible.version & 1) ? metaB : metaA

  // ⚠️ 关键：length 传 visible.visibleFrames，不是预分配容量
  const CTOR = { 1: Float32Array, 2: Int32Array, 3: Uint8Array, 4: Uint16Array }
  const frames = {}, panelFrames = {}
  for (const d of metaRegion.descriptors) {
    const C = CTOR[d.type]
    const count = d.dim === 2 ? visible.visibleFrames * P
                : d.dim === 4 ? visible.panelVisibleFrames * P
                : d.dim === 1 ? visible.visibleFrames
                : d.dim === 3 ? visible.panelVisibleFrames
                : 1
    const view = new C(ab, d.byteOffset, count)      // ← 只是换个 length，零拷贝
    ;(d.group === 'panel' ? panelFrames : frames)[d.name] = view
  }
  panelFrames.numFrames = visible.panelVisibleFrames

  return {
    meta: {
      mapName: metaRegion.mapName, tickRate, sampleRate: 64,
      numPlayers: P, numFrames: visible.visibleFrames,
      startTick, endTick: frames.frameTick[visible.visibleFrames - 1],
      durationSeconds: visible.durationSeconds,
    },
    players:        metaRegion.players,        // slot / steamId / name / clanName / color
    rounds:         metaRegion.rounds,         // ★ 必须是**全部**回合（C++ 首轮就填满）
    weaponNames:    metaRegion.weaponNames,
    bomb:           metaRegion.bomb,           // segments / defuses
    deathMarkers:   metaRegion.deathMarkers.slice(0, metaRegion.deathMarkerCount),
    frames, panelFrames,
    // …其余区间数据按各自 count 切视图或切片…
  }
}
```

#### 每次都重建的好处

| 项 | 是否需要改代码 |
| --- | --- |
| `get numFrames() { return frames.frameTick.length }` | ❌ **不用改** —— 视图长度就是可见帧数 |
| `findFrame()` 的二分（用 `t.length`） | ❌ **不用改** |
| 采样器构造里的 `duration`（用 `t[i-1]`） | ❌ **不用改** |
| `loadedDurationSeconds()`（用 `manifest.rounds[loadedRounds-1].endTick`） | ❌ **不用改** |
| 20+ 渲染子系统 | ❌ **不用改** |

前提是两个约定（必须遵守）：

1. **`rounds[]` 首轮就填满全部回合**的 `startTick` / `endTick`（`liveStartTick` 可随解析更新）。
   这样 `loadedDurationSeconds()` 只要 `loadedRounds` 递增就自动变长。
2. **每次重建的 `players[]` 顺序和 steamId 完全一致** —— 否则 `replaceRoundData` 的兼容性检查会返回 false。

## 四、入口适配代码（约 130 行，全是新增）

> **重要结论**：按「回合粒度 + 每次重建视图」的方案，**现有代码一行都不用改**，
> 除了把 `kz` / `TP` 这两个模块内私有符号暴露出来（2 个 `export`）。

### 4.1 新增文件：`shared-buffer.js`（约 110 行）

```js
// ① 共享 buffer → data 结构（视图，零拷贝；重建视图让 length 自动等于可见长度）
export function buildDataFromSharedBuffer(ab, visible) { /* 见 §3.6 */ }

// ② 元数据区解析（双份 A/B，按 version 奇偶选）
function readMetaRegion(ab, which) {
  // rounds[] / players[] / weaponNames[] / descriptors[] / bomb / deathMarkers
  // ⚠️ 这几个「会回头改」的量用 slice() 浅拷贝（约 100 KB/回合，代价可忽略），
  //    故意不与共享内存别名 —— 避免 C++ 原地重写时 JS 持有半新半旧的引用。
}

// ③ WebView2 消息绑定
const state = { app: null, version: 0, ab: null }

export function bindSharedBuffer() {
  // buffer 只来一次（或换 demo 时再来），拿到后就一直用
  chrome.webview.addEventListener('sharedbufferreceived', (e) => {
    state.ab = e.getBuffer()
  })

  // 每回合一条：水位全在消息里，不从内存读
  chrome.webview.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.version <= state.version) return          // 忽略旧版本（防乱序）
    state.version = msg.version

    const data = buildDataFromSharedBuffer(state.ab, msg)

    if (!state.app) {
      state.app = kz(data, { source: 'native', parseMs: 0 }, makeManifest(data), msg.loadedRounds)
    } else if (!state.app.replaceRoundData(data, msg.loadedRounds)) {
      // 只会发生在 players 顺序变了 / mapName 变了（不该发生，但要有兜底）
      const playback = state.app.getPlaybackState()
      state.app.dispose()
      state.app = kz(data, { source: 'native', parseMs: 0 }, makeManifest(data), msg.loadedRounds)
      state.app.restorePlaybackState(playback)
    }
  })
}

function makeManifest(data) {
  // manifest 可以不给（TP 构造有兜底），显式给出更清楚
  return {
    mapName: data.meta.mapName, tickRate: data.meta.tickRate,
    startTick: data.meta.startTick, endTick: data.meta.endTick,
    durationSeconds: data.meta.durationSeconds, rounds: data.rounds,
  }
}
```

### 4.2 现有代码的唯一改动：暴露两个符号（2 行）

```js
// src/app/33-landing-backdrop.js —— kz 是创建 app 的工厂
export { kz }                                    // ← 新增 1 行

// src/app/28-radar.js —— TP 是 app 主类
export { TP }                                    // ← 新增 1 行
```

> 你的工程是自己组织的，可能已经有导出机制；如果没有，加这两行即可。
> **这两个文件是「原副本」，加 export 会破坏逐字性** —— 建议在构建时用插件/包装层注入，
> 而不是直接改切片（本项目自己的 `verify-restoration` B 段就在守这条）。

### 4.3 为什么「现有代码一行都不用改」

| 你可能担心要改的地方 | 实际情况 |
| --- | --- |
| `get numFrames()` 返回预分配全长 | ❌ 重建视图时 `length` 就是可见帧数，getter 自动正确 |
| `findFrame()` 二分会跑到未写入区 | ❌ 用 `frameTick.length`，同上自动正确 |
| 采样器 `duration` 算错 | ❌ 用 `t[i-1]`，同上 |
| `loadedDurationSeconds()` 要改 | ❌ 用 `manifest.rounds[loadedRounds-1].endTick`；只要 `rounds[]` 首轮就填满全部回合，`loadedRounds` 递增就自动变长 |
| 20+ 渲染子系统要适配渐进 | ❌ 它们只读 `buffers` 和 `data.*`，视图变了照常读 |
| 时间轴/控制器要改 | ❌ `applyRoundData` 里已有 `clock.setDuration()` + `setTimelineMarkers()` |

### 4.4 渐进播放的两个注意点

**① 新回合可能被「挂起」**

`replaceRoundData` 内部逻辑（`28-radar.js:L3244`）：

```
正在播 && 还没播到已加载时长末尾  →  先挂起（pendingRoundData），下一帧开头才应用
否则                              →  立刻应用
```

这是原项目的**防卡顿设计**（避免播放中途重建采样器）。你按回合推送时行为完全一致，不用管。
但要知道：**连续快速推 3 个回合，中间的可能被跳过**（只保留最新的一份）。

**② 播到末尾会自动续播**

`applyRoundData` 尾部：时钟停在旧时长末尾时，新的回合一到会自动 `clock.play()`。
所以「先播着，等后续回合」这个体验是天然的。

---

## 五、硬约束清单（漏一条就出问题）

| # | 约束 | 违反后果 |
| --- | --- | --- |
| 1 | `meta.startTick` **恒等于** `manifest.startTick` | 所有按 tick 查询的子系统（手雷/曳光/HUD）全错位 |
| 2 | `frames.frameTick` 严格升序、绝对值 | `findFrame` 二分失效 |
| 3 | 索引公式 `arr[帧*P + 玩家]` | 数据错位 |
| 4 | `yaw`/`pitch` 单位是**度**，`yaw` 归一化到 `(-180,180]` | 视角乱转 |
| 5 | `steamId` 是**字符串** | 玩家匹配失败 |
| 6 | `team` 取值 `0/2/3` | 队伍色/名牌错 |
| 7 | **`speed` + `smoothSpeed` 必须给** | 角色滑步、脚步不响（会抛 TypeError） |
| 8 | `weaponNames[0]` 允许空字符串 | 下游已容忍，但你别塞有效名进去 |
| 9 | 热替换时 `mapName` / `players.length` / 每个 slot 的 `steamId` 必须相同 | `replaceRoundData` 返回 false → 整个 app 重建，播放状态闪一下 |
| 10 | `replaceRoundData(data, n)` 的 `n` 不能超过 `manifest.rounds.length` | 会被 `Math.min` 夹住，容易误判进度 |
| 11 | **地图资源必须可获取**（`prepareMap(mapName)` 要在别处下载地图几何 + BVH） | 场景空白，什么都不显示 |
| 12 | 人物模型 / 动画 clip / 音效库同样不在 `data` 里 | 人物不显示 / 没声音 |

---

## 六、分窗（分段）时的额外要求

> 前提：`meta.startTick` 恒定（约束 1）。窗口只靠 `frameTick` 数组内容体现。

| 列 | 依赖 | 分窗必须做的 |
| --- | --- | --- |
| `speed[i]` | **帧 i+1** | 段尾**后置多算 1 帧** |
| `smoothSpeed[i]` | **向前 1 秒（64 tick）** | 段首**前置多算 64 tick 的历史** |

不做的话：段末 `speed` 退化成后向差分（偏约 28 单位/秒）；段首 `smoothSpeed` 偏低（像刚起步）。
首段没有更早历史、末段没有后一帧，**这两处退化是规范允许的**。

---

## 七、验证

```bash
# ⚠️ demo 路径没有默认值，下面三种方式任选其一：
#      --demo <路径>   或   环境变量 CSDEMO_DEM=<路径>   或   --help 查参数

# 1) 用真实 demo 验证字段契约（29 项检查）
node tools/validate-contract-against-demo.mjs --demo <你的dem>

# 2) 生成一份真实参照数据，C++ 侧逐字节对齐
node tools/gen-fixture-from-demo.mjs --demo <你的dem>
node tools/validate-fixture-data.mjs fixtures/segment-000.bin

# 3) 确认你的两列速度和 JS 参考实现一致（关键）
#    在 validate-contract-against-demo 的 §3.5 段里，会把两列和「原渲染层算法」逐值比对
#    实测 1 143 260 个样本，最大偏差 1.53e-5（纯 Float32 舍入）
```

`fixtures/segment-000.json` 里有 `sampleFrame`（窗口第 0 帧的逐玩家原始值）
和每列的偏移表，可以直接拿来做对齐测试。


---

## 附录 G — C++ 侧已落地的代码

| 文件 | 作用 | 验证状态 |
| --- | --- | --- |
| `cpp/demo_data.h` | 数据契约（`DemoData` / `validate()` / `auditRanges()`） | ✅ MSVC `/W4` 零警告 |
| `cpp/shared_layout.h/.cpp` | `computeSharedLayout()`，与 §3.4 的布局定义逐字节等价 | ✅ 与金标准 **49 块全部一致** |
| `cpp/shared_writer.h/.cpp` | `planSharedBuffer()` + `writeSharedBuffer()`，自带极简 JSON emitter | ✅ 全部断言通过 |
| `cpp/webview2_bridge.h/.cpp` | `CreateSharedBuffer` / `PostSharedBufferToScript` / 回合消息 | ⚠️ **仅桩级语法检查**（本机无 SDK） |
| `cpp/CMakeLists.txt` + `CMakePresets.json` | CMake 工程：`csdemo::core` 静态库 + 4 个测试 + 4 项跨语言测试注册进 ctest | ✅ VS2019 x64 零警告，`ctest` 8/8 |

### G.0 构建（CMake）

```bash
# 在 Visual Studio 里：File → Open → Folder… 选 cpp/ ，下拉框选 vs2019-x64 / vs2022-x64
# 命令行（必须在 cpp/ 下，CMake 从当前目录找 presets）：
cd cpp
# -DCSDEMO_DEM_FILE 决定要不要跑 demo 相关项（不设则那些项 SKIPPED）
cmake --preset vs2019-x64 -DCSDEMO_DEM_FILE=D:/demos/match.dem
cmake --build --preset vs2019-release
ctest --preset vs2019-release          # 设了 9 项，不设 8 项
```

`/utf-8 /W4 /permissive-` 写在 `CMakeLists.txt` 里了（G.2 那条坑的固化措施）。
缺输入文件的测试会 `***Skipped` 而不是 FAIL（`SKIP_RETURN_CODE 2`）。

### G.1 验证链（三层，都可复跑）

> 完整操作步骤见 `docs/12-e2e-playbook.md`。

```bash
node tools/dump-shared-layout.mjs --demo <你的dem>   # ① 生成金标准（真实 demo，49 块）
#   或轻量版（不需要 demo，48 块）：node tools/dump-shared-layout.mjs --from-fixture
cpp/layout_test.exe docs/shared-layout.golden.tsv   # ② 布局逐块比对
cpp/writer_test.exe tmp/shared-from-cpp.bin         # ③ C++ 写出一份镜像
node tools/test-shared-buffer-from-cpp.mjs          # ④ JS 读回 C++ 写的内存（114 项断言）
```

第 ④ 步是**跨语言**验证：同一份字节，C++ 写、JS 读，逐字段一致。
它同时证明了布局、blob 引用、元数据 JSON、header 四件事都是对的。

### G.1.1 路径解析约定（JS 与 C++ 同一套）

所有工具脚本（`tools/paths.mjs`）与 C++ 测试（`cpp/cpp_paths.h`）
都按同一套优先级解析路径，**没有任何一处把路径写死在代码里**：

```
① 命令行参数    --demo / --tmp / --image / --golden   （C++：argv[n]）
② 环境变量      CSDEMO_DEM / CSDEMO_TMP / CSDEMO_IMAGE / CSDEMO_GOLDEN
③ 仓库默认值    （demo 无默认值）   <repo>/tmp/  <repo>/docs/…
```

> demo **没有默认值**，必须显式给 `--demo` 或 `CSDEMO_DEM`。

| 场景 | 做法 |
| --- | --- |
| demo 在别处 | `--demo D:/demos/match.dem` 或 `CSDEMO_DEM=…` |
| 中间产物放别处 | `--tmp out/work` 或 `CSDEMO_TMP=…`（C++ 侧输出目录会自动创建） |
| 金标准放别处 | `--golden …` 或 `CSDEMO_GOLDEN=…` |
| 不记得参数 | 任何脚本加 `--help` |

输入缺失时：打印「怎么指定」的指引 + **退出码 2**。ctest 配了 `SKIP_RETURN_CODE 2`，
所以记成 `***Skipped` 而不是 FAILED。

⚠️ `dump-shared-layout.mjs --from-fixture` 写的是 `*.fixture.golden.*`（48 块降级版），
不会覆盖真实 demo 的权威金标准 `*.golden.*`（49 块）—— 两种文件名是故意的。

---

### G.2 编译要求（踩过的坑）

MSVC **必须加 `/utf-8`**（或源文件存成带 BOM 的 UTF-8），否则按 GBK 解释中文注释会报
「常量中有换行符」。另外约定 **`printf` 输出一律用英文** —— 中文字符串字面量会触发 C4819、
并让 `printf` 的格式串错位（C4474）。


---

## 附录 H — 端到端播放验证（2026-11-09，全链路跑通）

> 📖 **要亲手跑一遍？看 `docs/12-e2e-playbook.md`** —— 那是操作手册
> （逐条命令 + 成功判据 + 注入脚本骨架 + 怎么换成你自己的 C++ 解析器）。
> 本附录只记录「做过什么、结果如何」。

### H.1 验证链路

```
① JS 解析真实 .dem（87 MB / 22 回合）          tools/gen-js-image.mjs
        ↓  共享内存镜像 66.22 MB
② C++ 读镜像 → 构造 DemoData → 再写回          cpp/roundtrip_test
        ↓  validate() 通过，49 块逐字节一致
③ JS 读 C++ 镜像 → 注入原应用 → **真的播起来**  tools/playback-test.mjs
```

### H.2 每步的结果

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| ① JS → 镜像 | `node tools/gen-js-image.mjs --demo <你的dem>` | 66 235 136 字节，49 块，blob 5.96 MB |
| ② C++ 往返 | `cpp/roundtrip_test` | 读回 N=114326 / 306 手雷 / 66 燃烧弹 / 481 掉落武器；`validate()` 通过；**49 块逐字节一致** |
| ② 后半 | `node tools/verify-roundtrip.mjs` | 指纹全对，**PASS 28 / FAIL 0** |
| ③ 播放 | `node tools/playback-test.mjs` | **PASS 6 / FAIL 0**，成功进入播放器 |

### H.3 播放验证的注入手法

在页面加载前用 CDP `Page.addScriptToEvaluateOnNewDocument` 注入一段脚本：

1. 内联 `shared-buffer.js`（去掉 `export`）
2. **替换 `window.Worker`**：只拦截 URL 含 `parser.worker` 的那个；
   我们的替身不跑 wasm，而是 `fetch` C++ 镜像 → `buildDataFromSharedBuffer` →
   按真实工人协议回 `progress/manifest/ready/done`
3. 向 `#fileInput` 塞一个 16 字节的假 File 触发加载流程（真数据由替身提供）

应用**完全不知道**数据不是它自己解析的 —— 它走的是同一条 `onReady → kz() → new DemoApp()` 路径。

### H.4 截图里能验证的东西

| 画面元素 | 数据来源 |
| --- | --- |
| `DE_DUST2` | `meta.mapName` |
| `TEAM B 0 / 0 TEAM`、`0:06 ROUND 1` | `meta` + `rounds` |
| 左右面板的**真实中文昵称** | `players` |
| `$800` / `$150` / 血量 / 护甲 / 武器图标 | `panelFrames` |
| `Kills 6` / `Utility 0` 事件流 | `events` |
| 底部时间轴 `0:13 … 29:46` + 倍速 | `meta.durationSeconds` |
| **两个渲染出来的角色**（名字跟随） | `frames.posX/posY/posZ` + `team` |

截图产物：`tmp/playback.png`

### H.5 离线环境的两个已知降级

| 现象 | 原因 | 影响 |
| --- | --- | --- |
| `map load failed, using grid` | `maps.csdemo.tv` 不可达 | 场景是网格而不是 de_dust2 几何；**不影响数据链路验证** |
| `radar load failed` / 角色是胶囊体 | 雷达图与人物模型同样走 CDN | 同上 |

**这两处降级是应用自己设计的**（有 `using grid` 兜底），说明它容错良好。

### H.6 这条验证覆盖了什么、没覆盖什么

**覆盖了**：
- C++ 的 `DemoData` 能装下真实全量数据（114 326 帧 × 10 人 + 全部区间数据）
- C++ 的布局/序列化与 JS 的读取**完全对齐**（逐字节）
- 数据经 C++ 走一圈后，**原渲染器依然能正确播放**（人、HUD、时间轴、事件全对）

**没覆盖**：
- C++ **解析器本身**的正确性（数据是 JS 解析出来的）
- 在线地图/模型资产下的完整视觉
- WebView2 真实共享内存通道（用文件代替了）

> 定位：这条链路验证的是**接口层**，不是解析层。解析层靠 `cpp/demo_data.h` 的
> `validate()` / `auditRanges()` + `docs/07` 的契约来保证。
