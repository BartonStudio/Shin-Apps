# 反混淆阅读指南 —— csdemo.tv 前端工程

> 反混淆原则：这个 bundle 用 esbuild/Vite 做了**压缩（minify）**，但**类名、类字段名、方法名基本保留原意**，
> 只有函数内部的局部变量被压成了 `e`/`t`/`n`/`r`。所以反混淆的核心工作是把局部变量还原成语义名。
> 本指南给出全部关键类的**压缩名 → 语义名**对照，配合 `src/deobfuscated/` 里已逐行反混淆的样板文件阅读。

## 一、工程总体分层

```
app 层（作者手写，~26 000 行）
├─ 解析/数据：wasm 解析器 glue、帧采样模型、CSDA 容器解码
├─ 渲染内核：three.js r184（内联）+ 自研光照/物理/烟雾/火焰/弹道
├─ UI 组件：HUD/雷达/计分板/事件面板/播放控制条（纯 DOM）
└─ 组合根：Player 主控类，把所有组件拼起来
vendor 层：three.js r184（内联，前 28 860 行）
```

## 二、类名对照表（压缩名 → 语义名 → 职责）

### 地图与场景

| 压缩名 | 语义名 | 职责 | 关键字段/方法 |
| --- | --- | --- | --- |
| `R_` | **MapLoader** | 地图加载器：下载→解码→组装几何→加场景 | `load/buildGlbGroup/updateInteriorLights/clearMap` |
| `Av` | **MapBreakClassifier** | 地图可破坏物分类 | `broken/classifyDeletions` |
| `Fv` | **MapFrustumCuller** | 视锥剔除（extend three.js Mesh） | `planes/cull/sphereVisible` |
| `zv` | **LightingShader** | 自研光照：直接光/间接光/环境采样 | `directLight/indirectLight/probeSample/envBrdfApprox` |
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
| `oM` | **TeamLogo** | — | 队伍 logo（emblem tone 检测） |
| `jM` | **ScorebarHUD** | `.hud` | 顶部比分条 + 炸弹/拆包提示 |
| `LM` | **Nametags** | `.nametag-layer` | 世界空间玩家名牌 |
| `KM` | **PlayerPanels** | `.pp` | 左右玩家面板 |
| `fN` | **Radar** | `.radar` | 2D 雷达 |
| `vN` | **EventFeed** | `.feed` | 回合事件面板（击杀/道具） |
| `DN` | **Scoreboard** | `.scoreboard` | 计分板 |

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

Player 是理解整个工程的入口。它的构造函数（bundle 47432+）按顺序组装：

```
场景类：qD(SceneRenderer) → ID(Xray) → zf(CameraController) → R_(MapLoader) → vy(Cs2Map)
角色类：zw(CharacterRenderer) → UT(ViewModel)
道具类：CD(GrenadeManager) → WO(SmokeVolume) → Ok(Tracers) → Lb(DeathMarkers)
        → ox(DroppedWeapons) → wb(Bomb) → mS(MapBreaks)
HUD 类：jM(ScorebarHUD) → vN(EventFeed) → KM(PlayerPanels) → DN(Scoreboard) → fN(Radar)
        → LM(Nametags) → oj(DeathFade) → vj(PerformancePanel) → Zj(SettingsPanel)
控制类：xA(TransportControls) → LA(AutoHide) → HA(PovPicker)
```

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
