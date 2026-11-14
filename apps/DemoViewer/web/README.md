# csdemotv-20261103 — csdemo.tv 前端实现扒取（2026-11-03 版）

对 `https://csdemo.tv/`（CSDEMO — 3D CS2 Demo Viewer）线上前端的完整拆解与归档，**两周后（2026-11-03）重新抓取的最新版本**。
**所有内容都来自线上真实产物，没有臆造代码**：`raw/` 是原样下载，`src/` 是按真实代码边界逐字切片，
`styles/` 是按选择器前缀机械拆分，`docs/` 里每个结论都标注了 bundle 行号。

> 上一版归档在 `D:\workfolder\testNadeAtlas\cstv`（抓取时间 2026-10-22）。本目录是它的**升级重抓**。

## 结论：它是怎么实现 CS2 demo 播放的

1. **`<input type="file">` / 拖放** 拿到 `.dem`，整个文件 `arrayBuffer()` 读进内存。
2. **算缓存键**（`sha256(file)` + 采样率），先查 IndexedDB（库 `csplayer`），命中就秒开。
3. **没命中就把 `ArrayBuffer` 转移给 module worker**（`parser.worker-Cvx4vjXK.js`），
   worker 里 `WebAssembly.instantiateStreaming('csplayer_parser_bg-qigVgicw.wasm')`，
   用 wasm 的 `DemoInput` 流式解析。wasm 是 **Rust** 编译（wasm-bindgen 0.2.126，3.2 MB）。
4. **两阶段解析架构**（见 `wasm/report.json` 的 `ownSources`）：
   `first_pass/`（parser → prop_controller → sendtables → stringtables）先扫实体与属性，
   `second_pass/`（game_events → entities → variants → collect_data）再提取回合事件与每帧 SoA 数据。
5. **每帧数据是 SoA 的 typed array**（posX/posY/posZ/yaw/pitch/health/alive/team/duck/flash/...），
   采样率可选 **16 / 32 / 64 Hz**（默认 32），主线程在相邻采样帧之间线性插值。
6. **渲染**：three.js **r184** + WebGL2。**本次发现 three.js 被完整内联进主 bundle**（`src/vendor/three-r184.js`，前 28860 行），
   包括核心 + 附加组件（OrbitControls、CSS2DRenderer、GLTFLoader、meshopt、PMREM、GGX 卷积）。
   应用层自研了一整套图形/物理系统（详见目录）。
7. **HUD 全是原生 DOM + CSS**（比分条、计分板、击杀/道具事件面板、2D 雷达、玩家面板、开镜/致盲/受击/死亡回放叠加层）。
8. **托管场次走另一条路**：从 `data.csdemo.tv` 下载**已解析好的 `.csda`**（gzip + `CSDA` 容器 + sha256），浏览器只做校验 + 解码。

## 目录

```
csdemotv-20261103/
├─ raw/                    # 线上原样产物（可直接跑起来的镜像）
│  ├─ index.html / favicon.svg
│  ├─ assets/              # 主 bundle / css / 2 个 worker / 3.2MB wasm
│  ├─ fonts/ backdrop/ icons/weapons/ maps/
│  └─ data/                # 地图清单、目录指针、完整比赛目录、manifest
├─ decompiled/             # prettier 展开：主 bundle（53 504 行）、2 个 worker、css
├─ src/
│  ├─ vendor/three-r184.js # three.js r184 完整内联（1~28860 行）
│  ├─ app/                 # 33 段逐字切片（01-timeline-utils.js … 33-landing-backdrop.js）
│  ├─ workers/             # parser.worker.js、mapGeometry.worker.js
│  └─ markup/              # 抠出的 HTML 模板（app-shell / hud / player-panel）
├─ styles/                 # 按组件拆分的 18 个 CSS 文件
├─ wasm/                   # 解析内核反抓：源码路径 / 依赖 crate / rustc 版本
├─ docs/
│  ├─ 01-architecture.md   # 技术栈、产物清单、模块地图、运行拓扑
│  ├─ 02-changes-vs-20261022.md # 与两周前版本的逐项对比
│  ├─ 03-playback-pipeline.md # 从 .dem 到第一帧的完整链路
│  ├─ 04-wasm-parser.md    # 解析内核逆向：两阶段架构、依赖、工具链
│  ├─ slices.json          # 34 段切片的行号索引（机器可读）
│  └─ raw-manifest.json    # 79 个抓取文件的大小与 sha256
├─ tools/                  # fetch-raw / slice / split-css / analyze-wasm
└─ serve.mjs               # 本地静态服务器
```

## 跑起来（复现线上播放器）

```bash
node csdemotv-20261103/serve.mjs        # → http://127.0.0.1:8123/
```

- 必须用 HTTP 访问（bundle 里全是 `/assets/…` 绝对路径），不能双击 index.html。
- `.wasm` 必须以 `application/wasm` 返回，否则 `instantiateStreaming` 会退化。
- 服务器会做**运行时代理 + URL 改写**：`/__data` → `data.csdemo.tv`、`/__maps` → `maps.csdemo.tv`
  （这两个子域 CORS 只放行 `https://csdemo.tv`，直连必被拦）。
- 已知限制：职业比赛/托管产物强制要求 HTTPS，`http://127.0.0.1` 下"职业比赛"会显示重试按钮，
  但本地 `.dem` 播放（含地图几何、雷达）完全可用。

## 与两周前版本的关键差异（详见 docs/02）

| 维度 | 2026-10-22 版 | 2026-11-03 版 |
| --- | --- | --- |
| 主 bundle | `index-DFwAquL5.js`（42 880 行展开） | `index-E0opA-yG.js`（53 504 行展开，+25%） |
| three.js | 部分内联 | **r184 完整内联**（前 28 860 行） |
| wasm | 3.1 MB，name 段**未剥离** | 3.2 MB，name 段**已剥离** |
| wasm 泄露信息 | 1 641 函数名 + 110 Rust 符号 | **作者用户名 `kenan`** + 10 个源码文件路径 + 16 个依赖 crate |
| 解析器版本 | 无版本字段 | 新增 `parserVersion` + `parserRevision` |
| 着色器预编译 | 无 | 新增 `precompileEffects()` 机制 |
| 采样率文案 | `Fast16 / Balanced32 / Precise64` | `Fast(quickest load) / Balanced(recommended) / Precise(highest fidelity)` |

## 关键事实速查

| 问题 | 事实 | 出处 |
| --- | --- | --- |
| demo 会上传吗 | 不会，只在浏览器内存/IndexedDB | `src/app/32-app-shell.js`、bundle 51233+ |
| 解析器是什么 | Rust wasm（wasm-bindgen 0.2.126），3.2 MB，两阶段架构 | `wasm/report.json`、worker |
| wasm 作者线索 | 开发机用户名 `kenan`（`C:\Users\kenan\.cargo\...`） | `wasm/report.json` |
| 解析器源码结构 | `first_pass/`(parser/sendtables/stringtables/prop_controller) + `second_pass/`(game_events/entities/variants/collect_data) + `parse_demo.rs` | `wasm/report.json` |
| 用了什么框架 | 没有框架，纯 DOM + 模板字符串 + 原生事件 | 全 bundle |
| three.js 版本 | r184，**完整内联** | bundle 12110 行 `revision: "184"` |
| 为什么有三档画质 | 采样率 16/32/64 Hz，决定解析量与缓存键 | bundle 52981-52983 |
| 地图从哪来 | `maps.csdemo.tv` 的 meshopt GLB + overview.txt + 分层雷达 PNG | bundle 28909、29582 |
| 职业比赛数据格式 | `.csda`（gzip + `CSDA` 容器 + 分块 sha256） | bundle 49254+ |
| 本地缓存存什么 | 解析结果对象，不是 `.dem` | bundle 50956+ |

## 反混淆（deobfuscation）

已对核心模块做语义反混淆（重命名局部变量 + 补注释），见：

- `src/deobfuscated/` — 反混淆产物（时间线/地图加载/解析管线/渲染循环）
- `docs/05-deobfuscation-guide.md` — **全部类的压缩名→语义名对照表**（读工程必备）
- `docs/06-deobfuscation-notes.md` — 反混淆说明与阅读顺序

**关键结论**：bundle 只压缩了局部变量，类名/方法名/字段名基本保留原意（`followPlayer`、`sampleAndRender` 等直接可读）。
three.js 是开源库，直接读官方 r184 源码即可，无需反混淆。

## 使用边界

仅供技术研究与学习。`raw/`、`decompiled/`、`styles/`、`src/` 中的内容版权归 csdemo.tv 及其素材权利人；
地图几何/雷达图来自 Valve 游戏资源、队伍 logo 来自各赛事方。二次分发前请自行确认授权。
