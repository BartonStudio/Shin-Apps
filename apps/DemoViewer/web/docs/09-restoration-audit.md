# 09 — 还原工程复核报告（当前状态）

> 一键复现全部结论：
> `node tools/verify-restoration.mjs && node tools/check-hex-consistency.mjs && node tools/reassemble-css.mjs && node tools/validate-fixture-data.mjs fixtures/segment-000.bin`
> 机器输出：`docs/09-restoration-audit.txt`

## 校验汇总

| 组 | 检查对象 | 结果 |
| --- | --- | --- |
| A | `raw/` → `decompiled/` 是否纯格式变换 | ✅ 四重指纹精确相等 |
| B | 40 个切片逐字一致 + 无缝覆盖 | ✅ 0 不一致，覆盖 L1–53504 |
| C | `styles/` 内容无损 + **可逐字节拼回** | ✅ 4 483 声明相等，157 966 字符往返一致 |
| D | 改写文件的引用规范与覆盖面 | ✅ 33/33 引用准确，**切片覆盖 39/39**；作者代码已全部覆盖（`docs/11` §十一） |
| E | `src/markup/` 可回溯 bundle 原文 | ✅ 3/3 |
| F | `docs/05` 类名对照表 | ✅ 48/48 可定位，名字全部真实存在 |
| G | 改写是否引入原件不存在的数值/成员名 | ✅ **0 个新数值**；8 个文件有成员改名（预期，见 §2.3） |
| H | `docs/` 里的 `bundle N` 行号声明 | ✅ 11 处均在范围内；人工核实 7 处，修正 2 处 |
| I | **39 个改写文件能否被 JS 解析** | ✅ **全部有效**（本轮新增；此前有 5 个无法解析，已修复） |

**FAIL 0 项。**

> 复核全过程与最终判定见 **`docs/11-semantic-review.md`**（含 39 个文件的逐文件结论、
> 5 个曾无法解析的文件、以及 3 处曾修过的实质错误）。

---

## 一、可信层（有机器证明，可直接依赖）

### 1.1 `decompiled/` 是纯格式变换

用递归扫描器（正确处理字符串、模板 `${}` 嵌套、注释、正则字面量）提取**格式化工具不可能改变**的指纹：

| 指纹 | 原始产物 | 展开版 |
| --- | --- | --- |
| 字符串/正则字面量 | 231 | 231 ✅ |
| 模板字面量静态片段 | 7 039 段 | 7 039 段 ✅ |
| 标识符 | 178 729 个 / 7 686 种 | 同 ✅ |
| 数值字面量 | 18 861 个 | 同 ✅ |
| `{}` / `[]` 计数 | 8 200/8 199、6 594 | 同 ✅ |
| `()` 计数 | 28 547 | 41 609（**预期**：formatter 补括号，左右配平） |

两个 worker、主 CSS 同样全等。**任何语义改动都会破坏这些多重集**，所以可排除"展开过程中被删改"。

> 校验器本身修过 4 个 bug（正则字面量误判、模板 `${}` 未递归、CSS at-rule prelude 当声明、
> `...spread` 当属性访问）。前几版报的 FAIL **全是校验器缺陷，不是工程问题**。

### 1.2 切片逐字可信

40 个切片 = `decompiled/index.beautified.js` 的行区间**逐字节拷贝**，首尾相接覆盖 L1–53504。
vendor/app 边界为 **L1–27990 / L27991–53504**（依据见 `docs/08`）。

### 1.3 `styles/` 无损且可逆

- 4 483 条声明与源 CSS **多重集完全相等**
- `styles/_manifest.json` 逐条记录原始顺序、所在文件、文件内序号、**原始前导空白**、at-rule 实例
- `node tools/reassemble-css.mjs` 可**逐字节**拼回源文件（157 966 字符往返一致）

---

## 二、改写层（`src/deobfuscated/`）的真实状态

56 个文件（39 个切片 + worker + Player 笔记）。
**"引用准确 + 无数值错误"已机器保证；"逻辑等价"未证。**

| 状态 | 含义 | 现状 |
| --- | --- | --- |
| ✅ 引用已核 | 头部 `原文范围` 行与实际切片一致 | 33/33 |
| ✅ 数值已核 | 未引入原件不存在的数值 | **56/56**（曾修 55 处，见 §2.2） |
| ⚠️ 成员改名 | 引入了原件不存在的成员名 | 8 个文件（反混淆的正常手段，见 §2.3） |
| ❓ 语义未证 | 逻辑是否与原实现等价 | **56 个都需人工读**，自动化无解 |

### 2.1 优先人工复核顺序

| 优先级 | 文件 | 理由 |
| --- | --- | --- |
| P0 | `parser.worker.deobf.js` | 解析后处理 + SoA 组装，理解错整条数据链都错 |
| P0 | `30-artifact-codec.deobf.js` | CSDA 21 个 section schema（G 段**完全干净**，可作信任基线） |
| P0 | `00c-frame-sampler.deobf.js` | SoA 插值 + `speed` 求导，播放链核心 |
| P1 | `31-hosted-demo.deobf.js` | CSDA 解码器，接 C++ 数据源的参照 |
| P1 | `07-physics-engine.deobf.js` | 短标识符占比 80.5%，最易失真 |
| P2 | `28-radar.deobf.js` | 最大文件（3 419 行），含 `Player` 主控 |

### 2.2 已修的 55 处数值错误（同一根因）

**根因**：改写者手工把十进制颜色/常量转十六进制时低字节系统性算错，而正确值留在了行尾注释里。
**正解全部来自原件**（注释里的十进制，或 bundle 对应位置的十进制），逐值核对过。

| 文件 | 处数 | 例 |
| --- | --- | --- |
| `02-map-assets` | 51 | `0xa39e44`(10722884) → `0xa39a84`(**10721924**) |
| `16-scene-renderer` | 13 | `0xb3c2c6`→`0xb3c8e6`；`FOG_NEAR 400`→**1200**；`FOG_FAR 26000`→**9000**；`SHADOW_MARGIN 500`→**300**；补 `ultra: 8192` |
| `33-landing-backdrop` | 2 | `0xffb14e` → `0xffb02e` |
| `31-hosted-demo` | 1 | 8 个 Tailwind hex → 原件真实的 **5 个颜色名** |

修完 `node tools/trace-colors.mjs` 报 **0 个不可溯源色值**。

### 2.3 成员改名（可接受，但要知情）

8 个文件引入了原件不存在的成员名，例如 `MUZZLE_ADDITIVE`（把重复的内联对象提取成具名常量）、
`SUPPORTED_CONTAINER_VERSIONS`（原压缩名 `hF`，注释里保留了）、`makeFab`（重命名）。

**影响**：按 `docs/05` 说的"类成员名基本保留"去 grep 会找不到。
要确认某成员名是否原件原有，**必须回 `src/app/` 或 `decompiled/` 核对**。

---

## 三、已修正的错误一览

### 3.1 结构性错误

| 位置 | 原（错） | 实测 |
| --- | --- | --- |
| `src/vendor/three-r184.js` 边界 | three.js 到 L28860 | **L27990**；870 行 app 代码被误装进 vendor |
| `01-timeline-utils.js` 起点 | L28861 | **L28797**（原起点落在函数 `f_` 内部，丢了函数头） |
| `docs/04`/`docs/02` name 段 | 「已剥离」 | **未剥离**：228 922 B、1 655 函数名（38 胶水 + **1 617 作者符号**） |
| `docs/04` 自有模块名 | `parser` | **`parser_settings`** |
| `docs/04` 依赖 | 16 个 crate | **18 个带版号** + **protobuf 栈 `csgoproto`+`prost`**（6 条 trait impl 确证） |
| `docs/04` 作者符号数 | 110 | **1 617** |

### 3.2 文档事实错误

| 位置 | 原（错） | 实测 |
| --- | --- | --- |
| `docs/01` 判断 2 | 「采样率三档 = 解析量三档」 | **错**：实体状态是 delta 编码，16/32/64 Hz **解析耗时几乎相同**，采样率只定输出体积/内存 |
| `docs/01` 判断 1 | bitter/phf/snap | 漏了 protobuf 层，已补成完整链路 |
| `docs/01` 判断 4 | 「GGX **VNDF** 重要性采样」 | **错**：`VNDF` 应用层出现 **0 次**（属 three.js PMREM）。实际是 GGX + **Valve 可见性项** + 多重散射 |
| `docs/05` | `Fv` = MapFrustumCuller | **`Fv` = BatchedMapMesh**；剔除器是 **`Iv`**（原文完全没提） |
| `docs/05` | `oM` = TeamLogo | **`oM` = ScopeOverlay**；TeamLogo 是一组函数（`gM`/`_M`/`CM`…），不是一个类 |
| `docs/05` §三 | 构造函数 47432，5 行粗略顺序 | **L47441**，按 34 处 `new` 重写为 9 组；`UT` 是字段初始化器、`fN` 是惰性创建（都不在构造函数里） |
| `docs/01` 模块地图 | 应用层"bundle 28861 后" | **27991** |
| `docs/03` | 拖放"51233+" | `<input>` 在 **51289**，`dragenter/dragover` 在 **51621** |
| `docs/03` | `overview.txt` "28909+" | **28939-28942** |
| `Player-render-loop.md` | TP 类 47359–48976 | 类体实为 **47359–48938**；`sampleAndRender` L48050 ✅ 本是对的 |
| `serve.mjs` 注释 | HTTPS 校验 38857 | **49233** |

---

## 四、复现方式

### 校验（全部只读，退出码 0 = 通过）

| 命令 | 作用 |
| --- | --- |
| `node tools/verify-restoration.mjs` | 八组主校验（A–H），写 `docs/09-restoration-audit.txt` |
| `node tools/check-hex-consistency.mjs` | 改写里 hex 字面量与十进制注释是否一致 |
| `node tools/trace-colors.mjs` | 改写里的数值能否在原件中溯源 |
| `node tools/reassemble-css.mjs` | `styles/` 能否逐字节拼回源 CSS |
| `node tools/validate-fixture-data.mjs <file.bin>` | **给 C++ 侧**：CSDF 分段格式自检 |

### 生成（会写文件）

| 命令 | 产出 |
| --- | --- |
| `node tools/slice.mjs` | 40 个切片 + `docs/slices.json` |
| `node tools/split-css.mjs` | 18 个样式文件 + `styles/_manifest.json` |
| `node tools/analyze-wasm.mjs` | `wasm/report.json` |
| `node tools/gen-fixture-data.mjs` | `fixtures/`（会话 manifest + 参照二进制） |
| `node tools/fix-deobf-headers.mjs` | 规范化改写文件的「原文范围」行（幂等） |

---

## 五、仍未做的事

1. **改写逻辑的语义等价**——只能人工逐文件读，见 §2.1 优先级。
2. **P0（按要求未做）**：`bg.sample()` 支持 `frames.speed` 列、`panelFrames.equipValue` 移出必发清单。
3. ✅ **数据契约已用真实 demo 验证**（2026-11-09）：`test.dem`（87 MB，de_dust2，完美世界竞技平台）
   完整解析 → **25 项检查全部通过、0 项失败**，并据此修正/补充了 `docs/07` 的 6 处细节。
   复现：`node tools/validate-contract-against-demo.mjs --demo <你的dem>`。详见 `docs/07` 附录 E。

4. ✅ **速度计算已前移到数据层**（2026-11-09）：`frames.speed` / `frames.smoothSpeed` 两列由
   数据提供层产出，渲染层不再计算。改动只写进 `src/deobfuscated/`（修改 + 新增），
   `src/app/`+`src/vendor/`+`src/workers/` 作为原副本保持逐字；
   校验器新增 **J 段**双向守护：「原副本仍含改动前代码」+「改写产物已更新」。
   代价实测：解析 +11.1%（19.11s→21.24s），换渲染期每帧省掉约 640 次窗口迭代。
   正确性：两列与原算法逐值一致（1 143 260 样本，最大偏差 1.53e-5）。
3. **`docs/` 里少数概括性行号表述**未逐字复核（H 段标出 3 处自动判定未命中，人工确认为引号风格/概括差异）。

---

## 六、变更历史

| commit | 内容 |
| --- | --- |
| `40deb46` | 基线：边界修正后 + 复核工具就位的完整快照 |
| `976dc52` | wasm 更正：name 段未剥离、补 protobuf 栈与 hashbrown/dlmalloc |
| `a8e4574` | 修 55 处 hex 转换错误；新增 trace-colors / check-hex-consistency |
| `ae7dea3` | `docs/01` 三条设计判断 + `docs/06` 状态分档 + Player 笔记行号 |
| `1a9954c` | `styles/` 可逆：css-toplevel + _manifest + reassemble |
| `e9e8a6e` | 补齐 `00a`–`00f` 六个切片（覆盖 39/39） |

`git log --oneline` 查全部细节；`git diff 40deb46 HEAD` 看累计改动。
