# 反混淆阅读指南 —— csdemo.tv 前端工程

> 反混淆原则：这个 bundle 用 esbuild/Vite 做了**压缩（minify）**，但**类字段名、方法名基本保留原意**，
> 只有类标识符和函数内部的局部变量被压成了 `R_`/`TP`/`e`/`t`/`n`/`r`。
> 本指南给出全部关键类的**压缩名 → 语义名**对照，配合 `src/deobfuscated/` 里已逐行反混淆的样板文件阅读。
>
> ⚠️ **两条要分清**：
> 1. **原件**：成员名确实被保留（已机器验证 178 729 个标识符多重集相等），按本表 grep 原件是可靠的。
> 2. **改写产物**：改写者**额外重命名了部分成员、提取了具名常量**（如 `MUZZLE_ADDITIVE`）。
>    要确认某成员名是否原件原有，请回 `src/app/` 或 `decompiled/` 核对。清单见 `docs/09` §2.3。

## 一、工程总体分层

```
app 层（作者手写，~26 000 行）
├─ 解析/数据：wasm 解析器 glue、帧采样模型、CSDA 容器解码
├─ 渲染内核：three.js r184（内联）+ 自研光照/物理/烟雾/火焰/弹道
├─ UI 组件：HUD/雷达/计分板/事件面板/播放控制条（纯 DOM）
└─ 组合根：Player 主控类，把所有组件拼起来
vendor 层：three.js r184（内联，前 27 990 行；末尾含 three-mesh-bvh）
```

## 二、类名对照表（压缩名 → 语义名 → 职责）

### 地图与场景

| 压缩名 | 语义名 | 职责 | 关键字段/方法 |
| --- | --- | --- | --- |
| `R_` | **MapLoader** | 地图加载器：下载→解码→组装几何→加场景 | `load/buildGlbGroup/updateInteriorLights/clearMap` |
| `Av` | **MapBreakClassifier** | 地图可破坏物分类（物体时间线） | `broken/classifyDeletions/breaks/matched` |
| `Fv` | **BatchedMapMesh** | 批量地图网格：`extends Mesh` 且 `isBatchedMesh = true`，multiDraw + LOD + nearParts | `partStart/partCount/partCell/partSphere/usingLod` |
| `Iv` | **MapFrustumCuller** | **视锥剔除器**（`extends Mesh`，逐区块 cull） | `planes/cull/sphereVisible` |
| `zv` | **LightingShader** | 自研光照：直接光/间接光/环境采样。⚠️ 下列名字是**GLSL 着色器函数名**（写在模板字符串里，如 `void directLight(vec3 N, …)`），**不是 JS 方法**，别去 `Class.prototype` 上找 | `directLight/indirectLight/probeSample/envBrdfApprox` |
| `Ly` | **SceneLighting** | 场景光照管理（CS2/经典两套） | `usesCs2Map/setCs2/setClassic/createMaterial` |
| `uy`/`vy` | **Cs2Map** | CS2 地图（GLB 解码后场景） | `manifest/partMeshes/objectMeshes/doorRotations` |
| `wb` | **BombEntity** | C4 炸弹实体 | `group/model/modelLedMat/light` |
| `mS` | **MapBreakage** | 地图破坏（碎片几何） | `shardGeometry/objects/entries` |

### 物理与轨迹

| 压缩名 | 语义名 | 职责 | 关键方法 |
| --- | --- | --- | --- |
| `Ex` | **PhysicsEngine** | 自研刚体物理（关节/摩擦/接触） | `solveJoint/step/staticFriction/solveContactVelocities/boneTransforms` |
| `Bx` | **PhysicsModel** | 物理模型（刚体+姿势） | `bodiesOf/poseOf/modelSpace/placeChild` |
| `Kx` | **TrajectoryRecorder** | 轨迹/碰撞记录器 | `advanceTo/sample/collidersOf` |

### 角色

| 压缩名 | 语义名 | 职责 | 关键点 |
| --- | --- | --- | --- |
| `gS` | **CharacterModel** | 角色模型（骨骼/break pieces） | `pose` |
| `zw` | **CharacterRenderer** | 角色渲染（胶囊兜底） | `group/weapons/templates` |
| `UT` | **ViewModel** | 第一人称持枪视图模型 | `camera/flash/arms/anim` |

### 特效（烟雾/火焰/爆炸/弹道）

| 压缩名 | 语义名 | 职责 |
| --- | --- | --- |
| `uE` | **FireShader** | 燃烧瓶/火墙 shader（noise/footprintShape） |
| `YE` | **FireManager** | 火焰管理（InfernoScorch/HazardVolumes） |
| `cD` | **BlastPool** | 爆炸特效对象池 |
| `CD` | **GrenadeManager** | 投掷物管理（轨迹/模型） |
| `tO` | **SmokeVoxelDecoder** | 烟雾体素解码 |
| `lO` | **SmokeVolume** | 烟雾体积渲染（edgeAwareSmoke） |
| `gk` | **Tracers** | 弹道曳光/轨迹线 |
| `Ik` | **FlashbangGlow** | 闪光弹辉光 |

### 渲染

| 压缩名 | 语义名 | 职责 |
| --- | --- | --- |
| `qD` | **SceneRenderer** | 场景渲染器（静态阴影/大气/filmic） |
| `HD` | **DepthMaterial** | 深度材质/深度预处理 |
| `ID` | **XrayRenderer** | X-Ray 透视渲染 |
| `XO`/`ZO` | **LineGeometry/LineMaterial** | 线框几何/线段材质 |

### UI 组件（纯 DOM）

| 压缩名 | 语义名 | DOM 根类 | 职责 |
| --- | --- | --- | --- |
| `xA` | **TransportControls** | `.controls` | 播放控制条（时间轴/scrubber/倍速/POV） |
| `LA` | **ControlsAutoHide** | — | 控件自动隐藏 |
| `HA` | **PovPicker** | `.pov-picker` | POV 选择器 |
| `oj` | **DeathFade** | `.death-fade-overlay` | 死亡淡入叠加 |
| `vj` | **PerformancePanel** | `.performance-*` | 性能面板（FPS 图） |
| `Zj` | **SettingsPanel** | `.settings-panel` | 设置面板（4 个 tab） |
| `oM` | **ScopeOverlay** | `.scope-overlay.scope-sniper` | **开镜遮罩**（两张 2D canvas：主遮罩 + 准星；内含 `ScopeOverlay:` 报错文案，是自我标识）|
| `jM` | **ScorebarHUD** | `.hud` | 顶部比分条 + 炸弹/拆包提示 |
| `LM` | **Nametags** | `.nametag-layer` | 世界空间玩家名牌 |
| `KM` | **PlayerPanels** | `.pp` | 左右玩家面板 |
| `fN` | **Radar** | `.radar` | 2D 雷达 |
| `vN` | **EventFeed** | `.feed` | 回合事件面板（击杀/道具） |
| `DN` | **Scoreboard** | `.scoreboard` | 计分板 |

> **两支易混项，已核实纠正**：
> - **`oM` 是 ScopeOverlay，不是 TeamLogo**（`canvas.className = 'scope-overlay scope-sniper'`，报错文案 `ScopeOverlay:`）。
> - **TeamLogo 不是一个类**，而是 `25-team-logos.js` 里的一组函数：`gM`（建 `hosted-logo` 元素）、
>   `_M`（套用 tone，`logo-white`/`logo-black`/`logo-bright`）、`CM`（主题切换）、`dM`/`fM`/`vM`/`TM`/`EM`。
>   注意该切片名为 `25-team-logos.js`，但**开头就是 `oM`（开镜遮罩）**——切片名不覆盖全部内容。

### 数据层

| 压缩名 | 语义名 | 职责 |
| --- | --- | --- |
| `jP` | **CatalogueError** | 目录客户端错误 |
| `CF` | **ArtifactCodec** | CSDA 容器解码 |
| `Z` | **ArtifactError** | CSDA 校验错误 |
| `YI` | **HostedIdentity** | 托管场次队伍识别 |

### 组合根

| 压缩名 | 语义名 | 职责 |
| --- | --- | --- |
| `TP` | **Player** | **应用主控**：组装全部组件 + 渲染循环 + 相机 + 输入 + 播放时钟 |
| `JR` | **LandingBackdrop** | 落地页 3D 背景动画（mirage A 执行） |

## 三、Player 主控（TP）—— 组合根解析

Player 是理解整个工程的入口。它的构造函数（bundle L47441 起；TP 类本身起于 L47359）按顺序组装：

```
构造函数真实顺序（bundle L47441 起，已逐行核实）：

① 基础        bg(帧采样模型) → Cg(播放时钟)
② 场景/相机   qD(SceneRenderer) → ID(XrayRenderer) → zf(CameraController)
③ HUD(先建)   LM(Nametags) → jM(ScorebarHUD) → vN(EventFeed) → KM(PlayerPanels)
④ 播放控件    xA(TransportControls) → LA(ControlsAutoHide) → HA(PovPicker)
⑤ 地图        R_(MapLoader) → vy(Cs2Map)
⑥ 道具/特效   CD(GrenadeManager) → WO(SmokeVolume) → Ok(Tracers) → Lb(DeathMarkers)
              → ox(DroppedWeapons) → zw(CharacterRenderer) → wb(BombEntity) → mS(MapBreakage)
⑦ 音频        QN(AudioEngine) → dP(DemoSounds)
⑧ 全屏叠加    XA(Crosshair) → oM(ScopeOverlay) → GA(BlindOverlay) → QA(DamageIndicator)
              → oj(DeathFade) → dj(KillReplay)
⑨ 面板(后建)  vj(PerformancePanel) → Zj(SettingsPanel) → DN(Scoreboard)
```

> ⚠️ **两个不在构造函数里的**（原文档误列进顺序）：
> - `UT`(ViewModel)：是**类字段初始化器** —— `viewModel = new UT(this.weaponLighting)`（slice 28-radar L1832），
>   在构造函数体执行**之前**就已创建。
> - `fN`(Radar)：**惰性创建** —— `new fN(...)` 在 slice 28-radar L2099（某个方法内），不是构造时。
>
> 原文档写的"bundle 47432+"实测为 **L47441**（TP 类本身起于 L47359）。

**关键方法**（方法名保留原意，直接可读）：

| 方法 | 作用 |
| --- | --- |
| `sampleAndRender` | 每帧采样 SoA 数据 → 插值 → 渲染 |
| `renderSceneAndPrepareEffects` | 场景渲染 + 特效准备 |
| `togglePlayback` | 播放/暂停 |
| `followPlayer` / `cyclePlayer` | 跟随/切换玩家视角 |
| `selectFreeCamera` / `selectFlyCamera` / `selectNoclipCamera` | 相机模式切换 |
| `jumpToKill` / `jumpToNade` / `jumpToNadeLanding` | 跳转到击杀/道具/落点 |
| `computeBombSnapshot` | 炸弹快照（下包/拆包进度） |
| `updateScoreboard` / `updateFeed` / `updatePanels` | 各 UI 面板刷新 |
| `applyViewerSettings` / `applyGpuTier` | 设置/画质应用 |
| `replaceRoundData` / `applyRoundData` | 增量回填后续回合数据 |
| `precompileEffects` | 着色器预编译 |

## 四、核心数据流

```
.dem 文件
  → sha256 + 采样率 = 缓存键
  → IndexedDB 命中？直接取解析结果 : 转移给 parser.worker
  → parser.worker: WebAssembly(DemoInput) 两阶段解析（first_pass 扫结构 / second_pass 提取数据）
  → SoA typed array（posX/posY/posZ/yaw/pitch/health/alive/team/duck/flash...）
  → Player.sampleAndRender 采样 + 插值
  → three.js 渲染（InstancedMesh 玩家 / 烟雾体素 / 弹道 / 地图 GLB）
```

## 五、已反混淆的样板文件

| 文件 | 内容 |
| --- | --- |
| `src/deobfuscated/01-timeline-utils.deobf.js` | 回合时间线/炸弹状态/计时纯函数（完整反混淆） |
| `src/deobfuscated/02-map-assets.deobf.js` | 地图清单客户端 + MapLoader（完整反混淆，第三方库已标注） |

## 六、命名规律速查

压缩后的命名是有规律的（esbuild 的短名分配）：

- **类字段/方法名**：基本保留原意（`smoke`、`grenades`、`followPlayer`...），可直接读
- **局部变量**：`e`=首个参数、`t`=第二参数、`n`/`r`/`i`/`a`/`o`/`s`=局部/后续参数
- **顶层常量**：`xx_` 形式（如 `c_ = 115` 回合秒数、`l_ = 40` 炸弹秒数、`N_` 默认光照）
- **顶层函数**：`x_`/`S_`/`T_` 等单字母+下划线，是模块级工具函数
- **类**：`R_`/`Ly`/`Ex` 等大驼峰短名，见上表对照
