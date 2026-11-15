# csdemotv-20261103 — csdemo.tv 前端拆解归档 + 原生 C++ 对接层

> **一句话**：把 `https://csdemo.tv/` 的 CS2 3D demo 播放器完整拆开、翻译成可读代码，
> 并给出「原生 C++ 解析 + WebView2 共享内存」的完整接口层 —— 含端到端验证
> （真实 demo → C++ 往返 → 真的播起来）。

**所有内容都来自线上真实产物，没有臆造代码。** `raw/` 是原样下载（80 个文件，sha256 全对得上），
`src/` 是按真实代码边界逐字切片，`styles/` 是按选择器前缀机械拆分，`docs/` 里每个结论都标注了 bundle 行号。

> 上一版归档在 `D:\workfolder\testNadeAtlas\cstv`（抓取时间 2026-10-22）。本目录是它的升级重抓。

---

## 0. 想知道什么 → 读哪里

| 你的问题 | 去这里 |
| --- | --- |
| 这播放器整体怎么跑起来的 | 本文件 §「它是怎么实现 CS2 demo 播放的」 · `docs/01-architecture.md` |
| **每帧数据有哪些字段、什么含义、什么陷阱** | `docs/07-data-contract.md`（931 行，权威） |
| **C++ 怎么把数据喂给前端** | `docs/08-cpp-integration.md`（792 行，含布局/协议/12 条硬约束） |
| C++ 侧代码怎么写 | `cpp/README.md` + `cpp/demo_data.h` 的注释 |
| **动手改 C++ 前先看「还有什么没做」** | 本文件 §七 |
| **想亲手把整条链路跑一遍（JS 解析 → C++ 构造 → 前端播放）** | `docs/12-e2e-playbook.md`（操作手册） |
| 压缩名 → 语义名对照 | `docs/05-deobfuscation-guide.md`（读工程必备） |
| 播放循环的调用链 | `docs/03-playback-pipeline.md` · `src/deobfuscated/Player-render-loop.md` |
| 解析内核（Rust wasm）逆向 | `docs/04-wasm-parser.md` · `wasm/report.json` |
| 翻译产物可信吗 | `docs/09-restoration-audit.md` · `docs/11-semantic-review.md`（逐文件判定表） |

---

## 它是怎么实现 CS2 demo 播放的

1. **`<input type="file">` / 拖放** 拿到 `.dem`，整个文件 `arrayBuffer()` 读进内存。
2. **算缓存键**（`sha256(file)` + 采样率），先查 IndexedDB（库 `csplayer`），命中就秒开。
3. **没命中就把 `ArrayBuffer` 转移给 module worker**（`parser.worker-Cvx4vjXK.js`），
   worker 里 `WebAssembly.instantiateStreaming('csplayer_parser_bg-qigVgicw.wasm')`。
   wasm 是 **Rust** 编译（wasm-bindgen 0.2.126，3.2 MB）。
4. **解析链**：`bitter`（bit reader）→ `prost` + `csgoproto`（**protobuf 解帧**）→ `snap`（Snappy 解压）
   → `SecondPassParser::decode_entity_update`（实体增量解码）。
   两阶段架构：`first_pass/`（parser_settings → prop_controller → sendtables → stringtables）先扫实体与属性，
   `second_pass/`（game_events → entities → variants → collect_data）再提取回合事件与每帧 SoA 数据。
5. **每帧数据是 SoA 的 typed array**（posX/posY/posZ/yaw/pitch/health/alive/team/duck/flash/…），
   采样率可选 **16/32/64 Hz**（默认 32），主线程在相邻采样帧之间线性插值。
   注意：实体状态是 **delta 编码**，所以三档采样率**解析耗时几乎相同**，只影响输出体积与内存。
6. **渲染**：three.js **r184** 完整内联（`src/vendor/three-r184.js`，L1–27990），
   含 OrbitControls / CSS2DRenderer / GLTFLoader / meshopt / PMREM / three-mesh-bvh。
   应用层自研了一整套图形/物理系统（探针体积光照、刚体物理、烟雾体素、弹道曳光、地图破坏）。
7. **HUD 全是原生 DOM + CSS**（比分条、计分板、击杀/道具事件面板、2D 雷达、玩家面板、开镜/致盲/受击/死亡回放叠加层）。
8. **托管场次走另一条路**：从 `data.csdemo.tv` 下载**已解析好的 `.csda`**（gzip + `CSDA` 容器 + 分块 sha256），
   浏览器只做校验 + 解码。

---

## 一、这个工程交付了三样**互相独立**的东西

### 1️⃣ 原始归档（`raw/`、`decompiled/`、`styles/`）
线上产物的可复现镜像。`raw/` 能直接跑起来，`decompiled/` 是 prettier 展开的可读版。

### 2️⃣ 可读重写（`src/`、`docs/`）
把 53 504 行的压缩 bundle 切成 39 段，逐段做**语义反混淆改写**成带中文注释的代码。

### 3️⃣ 原生 C++ 接口层（`cpp/`）★ 本轮新增
不是解析器 —— 是**「C++ 解析出的数据怎么交给这个前端」**的完整实现：
数据契约、共享内存布局、写入器、读取器、WebView2 通道，以及 **ctest 8 项**
（4 项 C++ + 4 项跨语言/端到端），外加 4 个手写的验证脚本。

> **为什么 C++ 不用 wasm**：见 `docs/08` §3.1。要点是 87 MB demo 在 wasm 里无法直接读文件、
> 多线程需要 COOP/COEP、SIMD128 不如 AVX2、会阻塞渲染线程、调试困难。

---

## 二、⚠️ 信任层级（二次开发前必读）

这个工程里的文件**可信度差别很大**。改错地方会让你白忙一天。

```
最高 │ raw/                    线上原样，sha256 全对得上            【只读，不要改】
     │ decompiled/             prettier 展开，与 raw/ 等价          【只读，用来核对】
     │ ─────────────────────────────────────────────────────────
     │ styles/                 按选择器机械拆分，可逐字节拼回原文件   【可改，能验证】
     │ src/app/ src/vendor/    逐字切片，**与原 bundle 逐字相同**     【只读，不要改】
     │ src/workers/
     │ ─────────────────────────────────────────────────────────
     │ src/markup/             从模板字符串提取，带上下文             【可改，属提取物】
     │ docs/                   分析文档，每个结论有 bundle 行号        【可改】
     │ ─────────────────────────────────────────────────────────
     │ fixtures/ cpp/ tools/   本项目原创                             【随便改】
     │ ─────────────────────────────────────────────────────────
最低 │ src/deobfuscated/       **有损重写**：重命名了部分成员、        【要改就在这里改】
     │                         提取了具名常量、补了中文注释
```

### 三条铁律

1. **`src/app/` + `src/vendor/` + `src/workers/` 是「原副本」，逐字不可改。**
   `tools/verify-restoration.mjs` 的 B 段和 J 段在守这条。要加功能请加到 `src/deobfuscated/`。
2. **`src/deobfuscated/` 里的成员名不一定是原件原有的。**
   改写者重命名了部分成员（如 `MUZZLE_ADDITIVE`）。要确认某名字是否原件原有，
   必须回 `src/app/` 或 `decompiled/` 核对。
3. **原件的压缩方式**：esbuild 默认 minify，**只压类标识符和局部变量，不压类成员名**
   （`followPlayer`、`sampleAndRender` 原样存在，已机器验证 178 729 个标识符多重集相等）。

---

## 三、目录结构

```
csdemotv-20261103/
│
├─ raw/                        ★ 线上原样产物，80 个文件（5.5 MB），可直接跑起来
│  ├─ index.html               入口
│  ├─ assets/                  6 个：主 bundle 1.27MB · css 129KB · 2 个 worker · wasm 3.06MB
│  ├─ data/                    4 个：地图清单 / 目录指针 / 比赛目录 / manifest
│  ├─ fonts/ backdrop/ icons/  字体 · 落地页背景 · 58 个图标
│  └─ maps/                    只有 de_mirage_lights.json（23KB）—— 地图几何**不在这里**，见 §七
│
├─ decompiled/                 prettier 展开 2.3 MB
│  ├─ index.beautified.js      53 504 行主 bundle
│  ├─ parser.worker.js         46 KB
│  └─ mapGeometry.worker.js    257 KB
│
├─ src/
│  ├─ app/                ★39 段逐字切片（00a-grenade-trajectory … 33-landing-backdrop）
│  │                          无缝拼回 L1–53504。**原副本，不要改**
│  ├─ vendor/three-r184.js★   three.js r184 完整内联（L1–27990）。**原副本，不要改**
│  ├─ workers/            ★2  parser.worker.js · mapGeometry.worker.js。**原副本，不要改**
│  ├─ markup/                 15 个模板（3 带上下文 + templates/ 下 12 个纯模板）
│  └─ deobfuscated/           42 个文件 ← **你要改的就是这里**
│     ├─ 00a…33 共 39 份      *.deobf.js 语义改写
│     ├─ Player-render-loop.md 播放循环调用链笔记（150 行）
│     ├─ speed-columns.js     ★ 速度两列的**可运行**参考实现（211 行）
│     └─ shared-buffer.js     ★ WebView2 共享内存 → data 的 JS 端（774 行）
│
├─ cpp/                       ★ 原生 C++ 接口层（纯 C++17，零第三方依赖，CMake 工程，18 个文件）
│  ├─ CMakeLists.txt          246  ★ VS 打开 cpp/ 目录即可自动识别
│  ├─ CMakePresets.json        42  vs2022-x64 / vs2019-x64 两个预设
│  ├─ demo_data.h             779  DemoData 数据契约 + validate() + auditRanges()
│  ├─ cpp_paths.h             117  测试程序的路径解析（与 tools/paths.mjs 同一套规则）
│  ├─ shared_layout.h/.cpp    387  computeSharedLayout()：49 个块的偏移计算
│  ├─ shared_writer.h/.cpp    826  planSharedBuffer() + writeSharedBuffer()（自带极简 JSON emitter）
│  ├─ shared_reader.h/.cpp    542  镜像 → DemoData（writer 的逆操作，仅验证/调试用）
│  ├─ mini_json.h             232  极简 JSON 解析器（零依赖）
│  ├─ webview2_bridge.h/.cpp  308  CreateSharedBuffer / PostSharedBufferToScript / 回合消息
│  ├─ smoke_test.cpp           67  validate() 行为测试
│  ├─ layout_test.cpp         197  布局对金标准逐块比对
│  ├─ writer_test.cpp         336  写入 + 落盘
│  ├─ roundtrip_test.cpp      203  真实全量数据往返
│  └─ README.md               209  编译/验证说明 + 踩坑记录
│
├─ docs/                      17 个文件（git 跟踪）
│  ├─ 01-architecture.md      113  整体架构
│  ├─ 02-changes-vs-20261022  100  与上一版归档的差异
│  ├─ 03-playback-pipeline.md  87  播放管线调用链
│  ├─ 04-wasm-parser.md       227  Rust wasm 解析内核逆向
│  ├─ 05-deobfuscation-guide  188  ★ 压缩名→语义名对照表
│  ├─ 06-deobfuscation-notes  129  反混淆说明与阅读顺序
│  ├─ 07-data-contract.md     931  ★★ 数据契约（权威，含 CSDF ABI + 14 条陷阱）
│  ├─ 08-boundary-correction  140  bundle 边界修正依据
│  ├─ 08-cpp-integration.md   792  ★★ C++ 对接（布局/协议/12 条硬约束）
│  ├─ 09-restoration-audit    193  + .txt 270  还原审计与证据
│  ├─ 11-semantic-review.md   668  ★ 逐文件语义判定表（39 份）
│  ├─ 12-e2e-playbook.md      479  ★★ 端到端实操手册（怎么跑 + 怎么换成自己的解析器）
│  ├─ raw-manifest.json       405  80 个文件的 sha256
│  ├─ shared-layout.golden.*  ★ 布局金标准（json 430 行 + tsv 66 行）
│  └─ slices.json             336  39 个切片的行号边界
│     （另有 shared-layout.fixture.golden.*，由 --from-fixture 生成，已 gitignore）
│
├─ tools/                     29 个脚本（6 424 行）
│  ├─ 基础设施
│  │   paths.mjs              ★ 路径解析（CLI > 环境变量 > 默认值），全部脚本共用
│  ├─ 校验器（只读，8 个）
│  │   verify-restoration · check-hex-consistency · trace-colors · reassemble-css
│  │   trace-fields · compare-deobf-semantics · slice-coverage · validate-fixture-data
│  ├─ 生成器
│  │   dump-shared-layout · gen-js-image · gen-fixture-data/gen-fixture-from-demo
│  │   slice · split-css · extract-markup · analyze-wasm · fetch-raw
│  ├─ 验证器（C++ / 跨语言 / 端到端）
│  │   test-shared-buffer · test-shared-buffer-from-cpp · verify-roundtrip
│  │   playback-test（自动化，进 ctest） · probe-app
│  ├─ 交互式
│  │   serve-playback          ★ 起服务 + 浏览器打开就能看（服务端注入，不需要 CDP）
│  │   inject.mjs              ★ 上面两者共用的注入脚本生成器
│  └─ 工具
│      csdf-format · css-toplevel · fix-deobf-headers · validate-contract-against-demo
│
├─ fixtures/                  CSDF v1 参照数据（给 C++ 侧对接用，1.0 MB）
│  ├─ segment-000.bin         真实 demo 前 1921 帧（de_dust2，crc32 0x57da91ad）
│  ├─ segment-000.json        旁挂描述
│  └─ manifest.json · README.md
│
├─ styles/                    18 个组件 CSS + _manifest.json（可逐字节拼回原文件）
├─ wasm/report.json           解析内核逆向结果
├─ serve.mjs                  本地静态服务器（116 行，带运行时代理）
├─ test.dem                   ⚠️ 87 MB，**不在 git 里**，见 §四
└─ package.json               scripts: serve / test / test:demo / test:cross
                              唯一依赖：prettier（仅 decompiled/ 用到）
```

---

## 四、快速开始

### 依赖

| 用途 | 需要 | 必需? |
| --- | --- | --- |
| 跑 JS 校验器 | **Node.js 22+** | ✅ 必需 |
| 跑 `playback-test`（端到端播放） | Node 22+（需要全局 `WebSocket`）+ Chrome / Edge | 可选 |
| 编译 C++ | **MSVC 2019+**（`/std:c++17`）或 GCC / Clang | 可选 |
| 验证真实 demo 相关项 | **`test.dem`（87 MB）** | 见下 |

### 路径全部可配置（不写死在代码里）

所有脚本与 C++ 测试的路径都按同一套优先级解析：

```
① 命令行参数    --demo <path>    --tmp <dir>    --image <path>    --golden <path>
② 环境变量      CSDEMO_DEM       CSDEMO_TMP     CSDEMO_IMAGE      CSDEMO_GOLDEN
③ 仓库默认值    （没有）           <repo>/tmp/    <repo>/tmp/...    <repo>/docs/...
```

> ⚠️ **demo 文件没有默认值** —— 必须用 `--demo` 或 `CSDEMO_DEM` 显式指定。
> 之前默认指向 `<repo>/test.dem`，结果换台机器它就成了一个指向不存在文件的死路径。
> 与其默认错，不如要求明确。

找不到时**不会只丢一个 ENOENT** —— 会打印「怎么指定」的指引，并以**退出码 2** 结束
（ctest 把它记成 `***Skipped` 而不是 FAILED）。每个脚本都支持 `--help`。

```bash
node tools/test-shared-buffer.mjs --demo D:/demos/match.dem
CSDEMO_DEM=D:/demos/match.dem node tools/dump-shared-layout.mjs
node tools/playback-test.mjs --image out/rt.bin
node tools/gen-js-image.mjs --help
```

| 参数 / 变量 | 作用 |
| --- | --- |
| `--demo` / `CSDEMO_DEM` | demo 文件（**必填，无默认值**） |
| `--tmp` / `CSDEMO_TMP` | 中间产物目录（默认 `<repo>/tmp`） |
| `--image` / `CSDEMO_IMAGE` | 共享内存镜像 |
| `--sidecar` / `CSDEMO_SIDECAR` | 旁挂水位/指纹 json |
| `--golden` / `CSDEMO_GOLDEN` | 布局金标准 |

C++ 测试程序用同一套规则（见 `cpp/cpp_paths.h`），CMake 还会给 ctest 注入
绝对路径的 `CSDEMO_TMP` / `CSDEMO_GOLDEN`，所以它不依赖运行时 cwd。

### ⚠️ 关于 `test.dem`

- **87 MB，且被 `.gitignore` 排除** —— 如果你用 `git clone` 拷走，**这个文件不会跟着走**。
- 依赖它的验证项：`validate-contract-against-demo`、`gen-js-image`、`test-shared-buffer`、
  `verify-roundtrip`、`playback-test`（后两项间接依赖它产出的镜像）。缺失时脚本会退出码 2 并提示。
- `dump-shared-layout.mjs` 两者皆可：不加参数会解析 demo，加 `--from-fixture` 则改用 `fixtures/`。
- 它是一份真实 CS2 demo：`de_dust2` / 完美世界竞技平台天梯 / patch 14192 / 22 回合 /
  114 326 帧 / 10 名玩家 / 14 291 面板帧。
- **没有它，以下 13 项仍可全部通过**：
  A 组 8 项 + `dump-shared-layout --from-fixture` + ctest 里 4 项
  （`cpp_smoke` / `cpp_layout` / `cpp_writer` / `cpp_to_js`）。
  另：`test-shared-buffer-from-cpp` 在 `cpp_writer` 产出镜像后也能跑。

### 跑起来（复现线上播放器）

```bash
node serve.mjs        # → http://127.0.0.1:8123/
```

- 必须用 HTTP 访问（bundle 里全是 `/assets/…` 绝对路径），不能双击 `index.html`。
- `.wasm` 必须以 `application/wasm` 返回，否则 `instantiateStreaming` 会退化。
- 服务器会做**运行时代理 + URL 改写**：`/__data` → `data.csdemo.tv`、`/__maps` → `maps.csdemo.tv`
  （这两个子域 CORS 只放行 `https://csdemo.tv`，直连必被拦）。
- 已知限制：职业比赛/托管产物强制要求 HTTPS，`http://127.0.0.1` 下「职业比赛」会显示重试按钮，
  但本地 `.dem` 播放（含地图几何、雷达）完全可用。

---

## 五、运行测试（4 组 19 项，退出码 0 = 通过）

### 先记住一件事：demo 路径必须显式给

**没有默认值。** 需要 demo 的脚本，不给就退出码 2。下面所有命令里的
`--demo <你的demo>` 都要换成本机实际路径（Windows 用 `D:/demos/match.dem` 这种正斜杠或双反斜杠都行）。

```bash
# demo 的三种给法（任选）
  node tools/xxx.mjs --demo D:/demos/match.dem      # ① 命令行参数（最常用）
  CSDEMO_DEM=D:/demos/match.dem node tools/xxx.mjs  # ② 环境变量
  node tools/xxx.mjs --help                         # ③ 查某个脚本支持哪些参数
```

> 下面为便于阅读统一写成 `--demo <你的demo>`；实际执行请替换成真实路径。

---

### 推荐路径：两条命令跑完

```bash
# ① A 组 8 项只读校验（不需要 demo，约 10 秒）
npm test

# ② 其余全部（需要 demo + MSVC）：ctest 会自动串起序号
cd cpp
cmake --preset vs2019-x64 -DCSDEMO_DEM_FILE=D:/demos/match.dem
cmake --build --preset vs2019-release
ctest --preset vs2019-release --output-on-failure      # 9 项，约 60 秒
```

`-DCSDEMO_DEM_FILE` 是关键：设了它，ctest 会额外注册 `gen_js_image`（解析 demo 生成镜像），
并把依赖串成 `gen_js_image → cpp_roundtrip → js_to_cpp → playback`，**一条命令跑完全链路**。

不设它也能跑，但需要 demo 的测试会 `***Skipped`（记成跳过而不是失败）。

---

### 分组说明：每项需要什么、产出什么

#### A 组 · 只读校验（不需要 demo，秒级）

```bash
node tools/verify-restoration.mjs                # A–J 十组主校验  → FAIL 0 / WARN 4
node tools/check-hex-consistency.mjs             # 改写里 hex 与十进制注释是否一致
node tools/trace-colors.mjs                      # 改写里的数值能否在原件中溯源
node tools/reassemble-css.mjs                    # styles/ 能否逐字节拼回源 CSS
node tools/trace-fields.mjs                      # 契约字段的消费点追踪
node tools/compare-deobf-semantics.mjs           # 改写 vs 原件的语义骨架比对
node tools/slice-coverage.mjs [--union]          # 按切片算覆盖率（两种口径）
node tools/validate-fixture-data.mjs fixtures/segment-000.bin   # CSDF 格式自检
```

> `verify-restoration` 的十组分别是：A 文件存在、B **原副本逐字**、C 切片无缝拼接、
> D 切片边界声明、E 跳过区间、F 标识符、G 数值、H 引用、I **39 份 deobf 全部可解析**、
> J **新功能不污染原副本**。

#### B 组 · 需要真实 demo（每次约 16–20 秒）

```bash
node tools/validate-contract-against-demo.mjs --demo <你的demo>   # ★ 验证 docs/07 契约 → PASS 29 / FAIL 0
node tools/dump-shared-layout.mjs             --demo <你的demo>   # 生成 docs/shared-layout.golden.{json,tsv}
node tools/gen-js-image.mjs                   --demo <你的demo>   # 生成 tmp/shared-from-js.bin（66 MB）
```

**不需要 demo 的轻量替代**（用 `fixtures/` 里的 30 秒窗口）：

```bash
node tools/dump-shared-layout.mjs --from-fixture   # 写 docs/shared-layout.fixture.golden.*（48 块）
```

> ⚠️ `--from-fixture` 产出的是**降级版**（fixtures 里没有 tracers/damage/smokeVoxels，
> 只有 48 块）。它写到 `shared-layout.fixture.golden.*`，**不会覆盖**真实 demo 的
> 权威金标准（49 块，`shared-layout.golden.*`）。两种文件名是故意的。

#### C 组 · C++ 侧（CMake，需要 MSVC）

**用 Visual Studio**：`File → Open → Folder…` 选 `cpp/` 目录，VS 自动读 `CMakeLists.txt`，
下拉框选 `vs2019-x64` 或 `vs2022-x64` 预设，然后 Build。

**用命令行**（⚠️ 必须在 `cpp/` 目录下，CMake 从当前目录找 presets）：

```bash
cd cpp

# 不跑 demo 相关的测试（4 项 C++ + 部分跨语言）
cmake --preset vs2019-x64

# 想把 demo 相关项也带上（推荐）——注意这里给的是绝对路径
cmake --preset vs2019-x64 -DCSDEMO_DEM_FILE=D:/demos/match.dem

cmake --build --preset vs2019-release
ctest --preset vs2019-release             # 未设 DEMO_FILE=8 项；设了=9 项
```

`/utf-8 /W4 /permissive-` 已经写进 `CMakeLists.txt`，不用手工加。
详细说明、`CSDEMO_DEM_FILE` 与「输入缺失时会 SKIP」的行为见 `cpp/README.md`。

#### D 组 · 跨语言 / 端到端（最有价值）

> 📖 **想完整走一遍这条链路（含注入原理、换成自己解析器的方法、失败排查），看**
> `docs/12-e2e-playbook.md`**。** 下面是速查版。

**这些默认读 `tmp/` 里的中间产物，不直接读 demo** —— 所以必须先跑 B 组和 C 组生成它们。

```bash
# 只有第一条需要 demo；后三条读的是上面的中间产物，不需要 --demo
node tools/test-shared-buffer.mjs --demo <你的demo>   # JS 写 → JS 读（自己解析 demo）→ PASS 76 / FAIL 0
node tools/test-shared-buffer-from-cpp.mjs            # C++ 写 → JS 读              → PASS 114 / FAIL 0
node tools/verify-roundtrip.mjs                       # JS→C++→JS 指纹比对          → PASS 28 / FAIL 0
node tools/playback-test.mjs                          # ★ 真浏览器播放              → PASS 6 / FAIL 0
```

> 后三条如果想把中间产物换个位置，用 `--image` / `--sidecar` / `--tmp`，
> 完整可用参数用 `--help` 查。

> 💡 **想看 / 想自己操作**（拖时间轴、换 POV、自由视角），用交互模式：
>
> ```bash
> node tools/serve-playback.mjs --open      # 起服务 + 打开浏览器，自动播放
> ```
>
> 它靠**服务端改写 index.html** 做注入，不需要 CDP / headless / 改文件。
> 与 `playback-test.mjs` 共用同一份注入脚本 `tools/inject.mjs`。

`playback-test.mjs` 会启动 headless Chrome，把 C++ 写出的镜像注入原应用并截图到
`tmp/playback.png`。截图里应能看到：`DE_DUST2`、真实中文昵称、`$800` money、血量/护甲/武器图标、
`Kills 6` 事件流、时间轴 `0:13…29:46`、以及**渲染出来的角色**。

> ⚠️ 该测试需要联网访问 `maps.csdemo.tv` 才能看到完整地图几何。离线时会降级为网格场景 +
> 胶囊体角色 —— 这是应用自身的容错设计，**不影响数据链路验证**。

---

### 顺序依赖（手动逐项跑时才需要关心）

```
B 组 gen-js-image.mjs  ──►  tmp/shared-from-js.bin + tmp/shared-from-js.json
                              │
C 组 cpp_writer        ──►  tmp/shared-from-cpp.bin          │
                              │                              │
C 组 cpp_roundtrip     ◄──────┴──────────────────────────────┘
                       ──►  tmp/shared-from-cpp-rt.bin
                              │
D 组 verify-roundtrip  ◄──────┤  需要：shared-from-cpp-rt.bin + shared-from-js.json
D 组 playback-test     ◄──────┘  需要：shared-from-cpp-rt.bin

D 组 test-shared-buffer        只需要 demo（自己就能跑）
D 组 test-shared-buffer-from-cpp 需要 cpp_writer 的产物
```

用 `ctest -DCSDEMO_DEM_FILE` 时这套顺序由 CMake 的 `DEPENDS` 自动保证，不用管。

### 路径与产物位置

| 参数 / 变量 | 作用 | 没给时 |
| --- | --- | --- |
| `--demo` / `CSDEMO_DEM` | demo 文件 | **报错退出码 2**（无默认值） |
| `--tmp` / `CSDEMO_TMP` | 中间产物目录 | `<repo>/tmp` |
| `--image` / `CSDEMO_IMAGE` | 共享内存镜像 | `<repo>/tmp/<默认文件名>` |
| `--sidecar` / `CSDEMO_SIDECAR` | 旁挂水位/指纹 json | `<repo>/tmp/shared-from-js.json` |
| `--golden` / `CSDEMO_GOLDEN` | 布局金标准 | `<repo>/docs/shared-layout.golden.tsv` |

C++ 测试走同一套规则（见 `cpp/cpp_paths.h`），且 ctest 由 CMake 注入绝对路径。

### 当前状态

| 组 | 项数 | 需要 demo | 结果 |
| --- | ---: | :---: | --- |
| A 只读校验 | 8 | 否 | ✅ 全过（`verify-restoration` FAIL 0 / WARN 4） |
| B 真实 demo | 3 | **是** | ✅ `PASS 29 / FAIL 0` |
| C C++ | 4 | 部分 | ✅ 全过（49 块 / 25 断言 / 逐字节） |
| D 跨语言端到端 | 4 | 部分 | ✅ `76 / 114 / 28 / 6` 全 PASS |

实测：`ctest` 未设 `CSDEMO_DEM_FILE` → **8/8**（demo 相关项正确 SKIP）；
设了 → **9/9**（`gen_js_image` 17.99s 自动串起全链路）。

---

## 六、关键事实速查

| 问题 | 事实 | 出处 |
| --- | --- | --- |
| demo 会上传吗 | 不会，只在浏览器内存/IndexedDB | `src/app/32-app-shell.js`、bundle 51289 |
| 解析器是什么 | Rust wasm（wasm-bindgen 0.2.126），3.2 MB，两阶段 | `wasm/report.json` |
| 依赖了什么 | 18 个带版号 crate + **protobuf 栈 `csgoproto`+`prost`** | `wasm/report.json` |
| wasm 作者线索 | 开发机用户名 `kenan`（`C:\Users\kenan\.cargo\…`，85 处） | `wasm/report.json` |
| wasm 泄露程度 | **name 段未剥离**：1 655 函数名（1 617 个作者符号） | `docs/04` |
| 用了什么框架 | 没有框架，纯 DOM + 模板字符串 + 原生事件 | 全 bundle |
| three.js 版本 | r184，**完整内联**（L1–27990） | bundle L12110 `revision: "184"` |
| 为什么有三档画质 | 采样率 16/32/64 Hz → 输出体积/内存 + 缓存键（**不影响解析耗时**） | bundle L52981-52983 |
| 地图从哪来 | `maps.csdemo.tv` 的 meshopt GLB + overview.txt + 分层雷达 PNG | bundle L28939-28942、L29582 |
| 职业比赛数据格式 | `.csda`（gzip + `CSDA` 容器 + 分块 sha256） | bundle L49254+ |
| 本地缓存存什么 | 解析结果对象，不是 `.dem` | bundle L50956+ |
| 数据契约验证过吗 | ✅ **已用真实 demo 验证 29 项全过**（de_dust2 / 22 回合 / 87 MB） | `docs/07` 附录 E |
| 速度在哪里算 | **数据提供层**（`frames.speed`/`frames.smoothSpeed`），渲染层只查表/插值 | `docs/07` §3.5 · `src/deobfuscated/speed-columns.js` |
| 两种速度的区别 | `speed` 瞬时（驱动脚步声/开镜读数）· `smoothSpeed` 1s EMA（驱动骨骼动画混合）。**用错会滑步** | `docs/07` §3.5 |
| 索引公式 | `值 = 数组[帧序号 × numPlayers + 玩家序号]` | 全部 SoA 列 |
| frames 与 panelFrames | **两套独立 tick 网格**：frames 间隔 1 tick（114 326），panel 间隔 8 tick（14 291） | `docs/07` |
| C++ 怎么把数据交给前端 | 原生 C++ + WebView2 共享内存（不用 wasm）：进程划分、buffer 布局、回合粒度发布、12 条硬约束 | `docs/08-cpp-integration.md` |
| 共享内存布局 | CSDF header 64B + 元数据区 A/B 各 1MB + 列块区（64B 对齐）+ blob（8B 对齐）= **69 435 136 B / 49 块** | `docs/08` §3.4 · `shared-layout.golden.tsv` |
| 为什么水位走消息不走内存 | WebView2 给的是普通 `ArrayBuffer`（**不是 SharedArrayBuffer**），`Atomics` 不可用补不了内存序 | `docs/08` §3.5 |
| 端到端验证过吗 | ✅ **已跑通**：JS 解析 → C++ 往返 → 注入原应用 → 真浏览器播放 | `docs/08` 附录 H |

---

## 七、⚠️ 还有什么没做（交接必读）

### 按优先级排序

| # | 未完成项 | 现状 | 规模估计 | 优先级 |
| --- | --- | --- | --- | :---: |
| 1 | **C++ 解析器本身** | `cpp/` 里**没有任何解析代码** —— 只有数据搬运与校验。`grep` 不到 `ParseDemo`、EMA、`hypot` | 最大的一块，取决于你复用多少 Rust 逻辑 | ★★★ |
| 2 | **WebView2 通道未真机验证** | `cpp/webview2_bridge.*` 只用**接口声明桩**做过语法检查（本机无 WebView2 SDK） | 按你手上的 `WebView2.h` 核对接口名/枚举名，约半天 | ★★★ |
| 3 | **回合增量发布未实现** | `writeSharedBuffer` 只做**全量写**。回合粒度协议在 `docs/08` §3.5 有完整规格，但没有代码 | 约 200 行 | ★★ |
| 4 | **`bindSharedBuffer` 的注入点未接** | `shared-buffer.js` 的 `bindSharedBuffer({createApp})` 需要外部把 `createPlayer`（原 `kz`）/ `DemoApp`（原 `TP`）传进去，目前无人调用 | **约 15 行** | ★★ |
| 5 | **速度两列的 C++ 实现** | 规范在 `docs/07` §3.5 + `src/deobfuscated/speed-columns.js`（可运行参考实现），C++ 侧只有字段定义 | 约 80 行 | ★★ |
| 6 | **地图 / 人物模型 / 音频资产不在仓库** | `raw/maps/` 只有一个灯光 json。几何、雷达、角色模型、音效全部运行时从 `maps.csdemo.tv` 拉 | 需自备或做本地代理，见 §四 | ★★ |
| 7 | **`probe-app.mjs` 只是探测脚本** | 用于确认应用能启动，不是正式测试，未纳入验证矩阵 | — | ★ |
| 8 | **12 份 deobf 是节选，3 份曾有实质错误（已修）** | 逐文件判定见 `docs/11` §8（39 行表：29 等价 / 1 等价但有遗漏 / 6 节选 / 3 有实质错误·已修） | 参考时注意 | ★ |
| 9 | **没有单元测试框架** | 全部是自研 node 脚本 + C++ `main()` 断言，无 jest / vitest / gtest | — | ★ |
| 10 | **`src/markup/` 与真实 DOM 的一致性无机器校验** | 15 个模板是从模板字符串人工提取的，属「提取物」而非逐字切片；没有类似 `verify-restoration` 的校验器 | 约 100 行 | ★ |

### 建议的入手顺序

```
① 先跑通 §五 的 A 组（8 项只读校验，约 10 秒）→ 确认环境正常
② 读 docs/07（数据契约）+ docs/08（C++ 对接）
③ 编译 cpp/ 并跑 C 组 + D 组 → 确认 C++ 接口层在你机器上是好的
④ 按 §七 #2 核对 WebView2 SDK 接口名 → 补 webview2_bridge
⑤ 写你的 C++ 解析器，产出 DemoData，用 validate() 挡住列长度错误
⑥ 先全量写（writeSharedBuffer），跑 playback-test 确认能播
⑦ 再按 docs/08 §3.5 改回合增量发布
```

### 一个必须分清的事

**§五 D 组验证的是「接口层」，不是「解析层」。**

数据是 JS 解析出来的，那条链路证明的是：C++ 的 `DemoData` 装得下真实全量数据、
布局/序列化与 JS 完全对齐、走一圈后渲染器还能正确播放。

它**没有**证明 C++ 解析器本身正确 —— 那要靠 `cpp/demo_data.h` 的 `validate()` / `auditRanges()`
加 `docs/07` 的契约来保证。

---

## 反混淆（deobfuscation）概要

`src/deobfuscated/` 有 **39 份**语义改写，覆盖全部 39 个 app 切片，外加 3 个可运行模块
（`speed-columns.js`、`shared-buffer.js`、`Player-render-loop.md`）。

可信度：**引用准确 33/33 · 39 个文件全部可通过 JS 解析 · 作者代码全覆盖 ·
语义等价已逐文件给出结论（29 等价 / 1 等价但有遗漏 / 6 节选 / 3 曾修实质错误）**。

three.js 是开源库，直接读官方 r184 源码即可，无需反混淆。

---

## 使用边界

仅供技术研究与学习。`raw/`、`decompiled/`、`styles/`、`src/` 中的内容版权归 csdemo.tv 及其素材权利人；
地图几何/雷达图来自 Valve 游戏资源、队伍 logo 来自各赛事方。二次分发前请自行确认授权。
