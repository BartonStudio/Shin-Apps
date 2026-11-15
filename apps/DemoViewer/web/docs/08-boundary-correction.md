# 08 — 切片边界修正（2026-11-09）

> 本文件记录对 `src/vendor/` 与 `src/app/` 切片边界的重新定位，以及由此修正的两处实际缺陷。
> 修正已通过 `node tools/slice.mjs` 重新生成，全部 40 个切片**逐字校验通过**、**无缝覆盖 L1–53504**。

---

## 一、结论

| | 旧（错误） | 新（已修正） |
| --- | --- | --- |
| three.js 内联范围 | L1 – **28860** | **L1 – 27990** |
| 应用层范围 | L**28861** – 53504 | **L27991 – 53504** |
| 切片数 | 34 | **40** |
| `src/vendor/three-r184.js` | 28 860 行 | **27 990 行** |

**旧边界把 870 行应用层代码误装进了 `vendor/`**（L27991–28860），并且让 `01-timeline-utils.js`
从一个函数体中间开始切。

---

## 二、定位方法与证据

不依赖行号猜测，用「只可能出现在单侧」的特征串双向夹逼。

### 2.1 three.js 侧的最后一个标识

| 特征串 | 最后出现行 |
| --- | --- |
| `WebGLProgram` | L19144 |
| `WebGLState` | L20692 |
| `RawShaderMaterial` | L23473 |
| `InterleavedBuffer` | L27786 |
| `BVH: Fallback raycast function not found.`（**three-mesh-bvh 专有串**） | **L27956** |

### 2.2 应用层侧的最早标识

| 特征串 | 首次出现行 |
| --- | --- |
| `var Hh = new B(0, 0, 1)`（Vector3 常量，被 app 在 L28251 `applyAxisAngle(Hh, …)` 使用） | **L27991** |
| `Uh()` 里 `{ ticks, posXYZ, detonationTick, endTick }`（投掷物轨迹结构） | **L27992** |
| `var ug = "ABCDEFGHJKLMNOPQRSTUVWXYZ…"`（**CS:GO 分享码 57 字符字母表**） | L28269 |
| `player_death` / `bomb_planted` / `round_start` 事件名 | L28655–28658 |
| `csdemo` | L28909 |
| `de_mirage` | L28934 |

### 2.3 接缝的逐行确认

```
L27944-27990   Bh / Vh / Lh / Rh / zh   ← three-mesh-bvh（"BVH: Fallback raycast function not found."）
L27991         var Hh = new B(0, 0, 1)  ← app 侧常量（L28251 被使用）
L27992         function Uh(e, t) { let { ticks, posXYZ } = e, … }   ← 投掷物轨迹，app
```

**→ three.js（含 addons）结束于 L27990，应用层从 L27991 开始。**

用词汇打分交叉验证：

| 区间 | three.js 3D 词汇 | app/CS 词汇 | 判定 |
| --- | --- | --- | --- |
| L27780–27943 | 22 | 0 | three.js |
| L27944–28077 | 26 | 12 | three.js（three-mesh-bvh） |
| L28078–28268 | 14 | 9 | 过渡段 |
| L28269–28400 | 0 | 13 | **app** |
| L28401–28660 | 0 | 95 | **app** |

---

## 三、修正的两个实际缺陷

### 缺陷 1：870 行应用层代码被装进了 `vendor/`

现在恢复为 6 个独立切片：

| 新切片 | 行范围 | 内容 |
| --- | --- | --- |
| `00a-grenade-trajectory.js` | 27991–28268 | 投掷物轨迹重采样 `Uh`/`Kh` + 落点视角 `lg`（用 three-mesh-bvh 对地图做碰撞射线） |
| `00b-share-code.js` | 28269–28348 | CS:GO 匹配分享码编解码（57 字符字母表 `ug` + `hg`/`gg`/`_g`/`vg`） |
| **`00c-frame-sampler.js`** | 28349–28486 | **帧采样核心**：输出缓冲 `yg` + **采样器 `bg`（SoA 相邻帧插值 + 从相邻帧求导算 `speed`）** + `xg`（线性插值）/`Sg`（yaw 最短弧）+ 播放时钟 `Cg` |
| `00d-bomb-defuse.js` | 28487–28584 | 炸弹/拆包状态机 `Tg`/`Dg`/`Og`（含击杀打断判定） |
| `00e-kill-helpers.js` | 28585–28679 | 击杀查询/回放链 `kg`/`Ag`/`jg`/`Mg`/`Ng`/`Pg` + 玩家配色 `Fg` |
| `00f-dom-utils.js` | 28680–28796 | `Hg` 类 + DOM/回调小工具 + 惰性单例 |

> **`00c-frame-sampler.js` 是数据契约的核心文件**。之前它在 `vendor/three-r184.js` 里，
> 任何"只扫 `src/app/`"的分析都会漏掉它——本次数据消费审计就因此一度误判
> `frames.score` / `frames.reloading` 为死字段。

### 缺陷 2：`01-timeline-utils.js` 从函数体中间开始

```js
// decompiled/index.beautified.js
L28858: function f_(e, t) {          ← 函数头
L28859:   let { maxTacticalTimeouts: n, counters: r, intervals: i } = e.timeouts,
L28860:     a = n,
L28861:     o = n                        ← 旧切片从这里开始，丢了函数头和前两行
...
L28874: }
```

旧版 01 切片起点 L28861 落在 `f_` 内部，导致该函数**没有函数头、前两行变量声明丢失**。
现起点前移至 **L28797**，`f_` 完整落在 `01-timeline-utils.js` 的 L68–84。

---

## 四、校验结果

```
verbatim mismatches: 0 / 40
contiguous coverage: 1 .. 53504   (bundle content lines = 53504)
```

- 全部 40 个切片去掉 6 行文件头后，与 `decompiled/index.beautified.js` 对应行范围**逐字节一致**
- 40 个切片首尾相接，**无缝覆盖 L1–53504**，无缺口无重叠

---

## 五、对既有文档的连带修正

以下位置原先引用了错误边界，已一并更正：

| 文件 | 原表述 | 更正 |
| --- | --- | --- |
| `README.md` | three.js 内联"前 28860 行" | **前 27 990 行**（L1–27990） |
| `README.md` | "33 段逐字切片"、"34 段切片" | **40 个切片** |
| `docs/02-changes-vs-20261022.md` | "r184 完整内联（前 28 860 行）" | **前 27 990 行** |
| `docs/05-deobfuscation-guide.md` | "vendor 层：three.js r184（前 28 860 行）" | **前 27 990 行** |

---

## 六、仍未解决的问题（已知）

1. **`28-radar.js` 文件名仍有误导性**：它实际上包含 `Player` 主控类 `TP`（自 L47359 起）、
   2D 雷达 `fN`、事件面板 `vN`、计分板 `DN`、音频引擎、导航辅助。共 3 419 行，是最大的切片。
   本次只修正了三写侧的 `vendor/app` 大边界，没有细分这个文件。
2. **切片边界仍是「行范围」，不是「原始模块边界」**：bundle 里模块之间没有分隔标记，
   原始 `.ts` 模块划分已不可恢复（全库仅泄漏过一个 `./derive.ts` 引用）。
   现行切片是按「顶层声明簇」划分的近似，不是作者原始文件。
3. **`docs/` 里其它行号引用**（如 `bundle 51233+`、`bundle 52981-52983` 等）未逐一复核，
   引用时建议以 `docs/slices.json` 的实际 `start`/`end` 为准。
