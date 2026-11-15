# 01 — 架构总览（2026-11-03 版）

## 技术栈

| 层 | 技术 | 出处 |
| --- | --- | --- |
| 前端框架 | **无框架**，纯 DOM + 模板字符串 + 原生事件 | 全 bundle |
| 3D 渲染 | **three.js r184**（WebGL2），完整内联进主 bundle | bundle 12110 行 `revision: "184"` |
| demo 解析 | **Rust → wasm**（wasm-bindgen 0.2.126），3.2 MB | worker + `wasm/report.json` |
| 地图几何 | meshopt 压缩 GLB（Source2Viewer 预转换），`mapGeometry.worker` 解码 | bundle 29581-29582 |
| 构建 | Vite（`import.meta.url` + module worker + 内容哈希文件名） | 产物结构 |
| 存储 | IndexedDB（库 `csplayer`）+ localStorage（`csdemo:theme` 等） | bundle 50956+ |

## 产物清单

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `index.html` | 1 259 B | SPA 壳，`<div id="app">` |
| `assets/index-E0opA-yG.js` | 1 334 759 B | 主 bundle（three.js + 应用，展开 53 504 行） |
| `assets/index-CKB5zRpH.css` | 129 424 B | 全站样式（展开 7 310 行） |
| `assets/parser.worker-Cvx4vjXK.js` | 46 139 B | wasm 解析器 worker |
| `assets/mapGeometry.worker-BGvfBalF.js` | 257 144 B | 地图 GLB 解码 worker |
| `assets/csplayer_parser_bg-qigVgicw.wasm` | 3 210 168 B | Rust 解析内核 |

## 模块地图（应用层，bundle 27991 行之后）

| 切片 | 文件 | 角色 |
| --- | --- | --- |
| vendor | `three-r184.js` | three.js r184 完整内联 |
| 01 | `timeline-utils.js` | 回合/时间纯函数 |
| 02 | `map-assets.js` | maps.csdemo.tv 地图清单 + overview 雷达映射 |
| 03 | `map-classification.js` | 地图分类/破坏删除 + 视锥剔除 |
| 04 | `lighting-shader.js` | **自研光照系统**（directLight/indirectLight/probeSample/CustomToneMapping） |
| 05 | `scene-lighting.js` | 场景光照管理（usesCs2Map/setCs2/ambientCube） |
| 06 | `world-props.js` | 死亡标记、CSS3D 图层 |
| 07 | `physics-engine.js` | **自研物理引擎**（solveJoint/staticFriction/solveContactVelocities） |
| 08 | `physics-model.js` | 物理模型/姿势 |
| 09 | `trajectory-recorder.js` | 轨迹/碰撞记录器 |
| 10 | `character-model.js` | 角色模型（骨骼姿势/break pieces） |
| 11 | `character-renderer.js` | 角色渲染（胶囊兜底） |
| 12 | `fire-shader.js` | 燃烧瓶/火墙 shader |
| 13 | `fire-manager.js` | 火焰管理（HazardVolumes/InfernoScorch） |
| 14 | `blast-effects.js` | 爆炸/闪光效果 |
| 15 | `depth-material.js` | 深度材质/深度预处理 |
| 16 | `scene-renderer.js` | 场景渲染器（静态阴影/大气/filmic） |
| 17 | `smoke-voxels.js` | 烟雾体素解码 |
| 18 | `smoke-volume.js` | 烟雾体积渲染（edgeAwareSmoke） |
| 19 | `wireframe-geometry.js` | 线框几何 |
| 20 | `line-material.js` | 线段材质 |
| 21 | `tracers.js` | 弹道曳光/轨迹线 |
| 22 | `transport-controls.js` | 播放控制条（时间轴/scrubber） |
| 23 | `death-fade.js` | 死亡淡入叠加 |
| 24 | `performance-panel.js` | 性能面板（FPS 图） |
| 25 | `team-logos.js` | 队伍 logo（emblem tone 检测） |
| 26 | `scorebar-hud.js` | 顶部比分条 HUD |
| 27 | `player-panels.js` | 玩家面板 |
| 28 | `radar.js` | 2D 雷达 |
| 29 | `catalogue-client.js` | data.csdemo.tv 目录客户端 |
| 30 | `artifact-codec.js` | CSDA 容器校验/解码 |
| 31 | `hosted-demo.js` | 托管 demo 下载 + worker 桥接 + IndexedDB |
| 32 | `app-shell.js` | AppShell 落地页/播放页骨架 + 入口 |
| 33 | `landing-backdrop.js` | 落地页 3D 背景动画 |

## 运行拓扑

```
浏览器
 ├─ 主线程：AppShell → Player（组装全部组件，渲染循环，相机，键盘输入）
 ├─ parser.worker：WebAssembly(DemoInput) 解析 .dem → SoA typed array → postMessage
 ├─ mapGeometry.worker：解码 maps.csdemo.tv 的 meshopt GLB → 几何
 └─ 外部：maps.csdemo.tv（地图）、data.csdemo.tv（职业比赛目录/已解析产物）
```

## 关键设计判断（从代码读出的实现选择，2026-11-09 已逐条核实并修正）

1. **解析器用 Rust wasm 而非 JS**：CS2 demo 是 Source2 二进制格式，完整的依赖链是
   **`bitter`（bit reader）→ `prost` + `csgoproto`（protobuf 解帧）→ `snap`（Snappy 解压）
   → `SecondPassParser::decode_entity_update`（实体增量解码）**，另有 `phf_shared` 加速字符串表。
   两阶段（`first_pass`/`second_pass`）架构说明作者把"结构扫描"和"数据提取"分开了。

   > ⚠️ 旧版只提了 `bitter` / `phf` / `snap`，**漏掉了 protobuf 这一层**——而 demo 本身就是
   > protobuf 流，它才是解析链的核心。详见 `docs/04` 第 3.2 节。

2. **采样率三档 ≠ 解析量三档**（⚠️ 旧版这里是错的）：CS2 的实体状态是 **delta 编码**的
   （`svc_PacketEntities` 只发变化量），要得到 tick N 的状态必须处理 0..N 的所有实体更新，
   **所以 16/32/64 Hz 的解析耗时几乎相同**。采样率只决定：

   | 采样率 | 解析耗时 | 输出体积 / 内存 | 缓存键 |
   | --- | --- | --- | --- |
   | 16 Hz | 基准 | 1×（约 1/4） | 不同 |
   | 32 Hz（默认） | **基本相同** | 2× | 不同 |
   | 64 Hz | **基本相同** | 4× | 不同 |

   也就是说它是**内存/画质的权衡旋钮，不是解析性能的旋钮**。

3. **地图不实时读 VPK**：而是从自己的 CDN 下载预转换的 meshopt GLB
   （`maps-manifest.json` 里写着 `compression: EXT_meshopt_compression`、
   `source2viewer_version: 20.0.6980+a06886f7…`），避免在浏览器里解析 Source2 地图格式。

4. **自研渲染/物理**（⚠️ 旧版把"GGX VNDF"归给应用层，实际不是）：
   应用层的自研光照是 `04-lighting-shader.js` 里的这一套——
   **光照探针体积采样**（`probeSample`：YCbCr luma/chroma + 三线性插值）、
   **八面体法线编码**（`octEncode`/`octDecode`）、
   **GGX 直接光 + Valve 可见性项 + 多重散射补偿**（`directLight`，代码自带英文注释
   *"A directional light (GGX, Valve's visibility term and the multiscatter boost)"*）、
   **环境 BRDF 近似**（`envBrdfApprox`）、
   **自定义 tonemapping**（`CustomToneMapping`）与 `cs2SrgbEncode/Decode` + `cs2LutChannel`。

   > `VNDF` 在应用层出现 **0 次** —— 那是 three.js 自己 PMREM 里的实现（vendor 区），
   > 不属于这个作者的自研部分。物理（刚体+接触摩擦）、烟雾（体素+边缘感知着色）确实是自研。
   > 结论（"作者不只是调库"）成立，但依据要换。

