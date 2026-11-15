# 反混淆说明（deobfuscation）

> 目标：把压缩混淆后的 csdemo.tv 前端代码还原成可阅读、可学习的工程。

## 结论先行：能还原到什么程度

| 内容 | 压缩前 | 压缩后 | 能否还原 | 还原方式 |
| --- | --- | --- | --- | --- |
| 类标识符 | `MapLoader` | `R_` | ⚠️ 不可还原 | 按语义重新起名（见 docs/05 对照表） |
| 类字段名 / 方法名 | `followPlayer` | **保留原意** | ✅ 无需还原 | 直接读 |
| 局部变量名 | `slot` / `tick` | `e` / `t` / `n` | ⚠️ 无法自动还原 | 手工按语义重命名 |
| 注释 / 空行 | 有 | 已删除 | ❌ 永久丢失 | 手工补注释 |
| 原始模块划分 | 多文件 | 打成 1 个 bundle | ⚠️ 部分可推断 | 按代码边界切片 |
| three.js | 开源库 | 内联进 bundle | ✅ 无需还原 | 读官方源码 |

**关键发现**：这个 bundle 用的是 esbuild/Vite 的默认 `minify`，它**只压缩局部变量和类标识符，不混淆类成员名**。
所以类标识符会被压成 `R_`/`TP`，但字段 `group`/`loadGeneration`、方法 `followPlayer`/`sampleAndRender`
原样保留。这一点已被机器校验证实（178 729 个标识符多重集在原件与展开版之间精确相等）。

> ⚠️ **但 `src/deobfuscated/` 的改写超出了"只改局部变量"的范围**：改写者额外重命名了部分成员、
> 把重复的内联对象提取成了具名常量（如 `MUZZLE_ADDITIVE`）。
> **所以要判断"这个成员名是不是原件原来的"，必须回 `src/app/` 或 `decompiled/` 核对。**
> 现状与清单见 `docs/09` §2.3（曾有 55 处数值错误也已修，见 §2.2）。

## 为什么不能 100% 还原成作者手写的样子

压缩是**有损**的：原始变量名、注释、空行、文件结构在编译时就被永久删除了，任何工具都无法恢复。
所以"反混淆"的产物是"**语义等价、可读、带注释**"的代码，而不是"和作者源码一字不差"的代码。

## 反混淆产物清单

> ⚠️ **下表的"✅"只表示该文件存在且引用规范正确，不等于"语义已证实等价"。**
> 真实可信度分层（机器校验结果，详见 `docs/09` §2）：
>
> | 档位 | 含义 | 当前情况 |
> | --- | --- | --- |
> | ✅ 引用已核 | 头部 `原文范围` 行与实际切片一致 | **33/33 通过** |
> | ✅ 数值已核 | 未引入原件中不存在的数值 | **56/56 通过**（曾修 55 处 hex 转换错误） |
> | ⚠️ 成员改名 | 引入了原件之外的成员名 | 8 个文件（属反混淆正常手段） |
> | ❓ 语义未证 | 逻辑是否与原实现等价 | **需人工逐文件读**，自动化无法证明 |
>
> **切片覆盖 39/39**（`00a`–`00f` 六个缺口已补齐）。人工复核优先级见 `docs/09` §2.1。
>
> ⚠️ **"覆盖了切片"不等于"改写了整个切片"**：按语义骨架实测（`docs/11`），只有 **17 个文件覆盖 ≥90%**，
> **9 个覆盖不到 50%** —— 最少的是 `04-light-probe-grid`（11%）、`01-timeline-utils`（19%）、
> `parser.worker`（28%）。下表"规模"列标注为 **节选** 的即属此类，未覆盖的部分请直接读 `src/app/` 切片
> （切片是 100% 逐字完整的，**内容本身没丢**，改写只是"读起来更方便的那部分"）。

| 文件 | 内容 | 规模 | 引用 | 数值 |
| --- | --- | :--: | :--: | :--: |
| `src/deobfuscated/00a-grenade-trajectory.deobf.js` | 投掷物落点解析 + 「落点视角」相机评分启发式（three-mesh-bvh 射线） | 95% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/00b-share-code.deobf.js` | CS:GO 准星分享码解码（57 进制 → 18 字节位域） | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/00c-frame-sampler.deobf.js` | **帧采样核心**：输出缓冲 + SoA 插值 + speed 求导 + 播放时钟 | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/00d-bomb-defuse.deobf.js` | clamp + 拆包状态机 + 连续击杀回放分组 | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/00e-kill-helpers.deobf.js` | 击杀链查询 + **SoA 列/事件白名单表**（docs/07 附录的源头） | 98% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/00f-dom-utils.deobf.js` | wasm-bindgen 胶水层（DemoInput 包装 + 编组工具）—— **无业务逻辑** | 68% **节选** | ✅ | ✅ |
| `src/deobfuscated/01-timeline-utils.deobf.js` | 回合时间线 / 炸弹状态 / 计时三件套 | 94% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/02-map-assets.deobf.js` | 地图清单客户端 + MapLoader（光照分类表） | 54% **节选** | ✅ | ✅ |
| `src/deobfuscated/03-map-classification.deobf.js` | 地图实体分类 / 破坏删除 + 视锥剔除 + 批量网格 | 91% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/04-light-probe-grid.deobf.js` | 光照探针网格（YCbCr luma/chroma + 三线性插值 + gzip 解压） | 11% **节选** | ✅ | ✅ |
| `src/deobfuscated/04-lighting-shader.deobf.js` | **自研光照系统**（探针采样 + PBR shader + tone mapping） | 99% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/05-scene-lighting.deobf.js` | 场景光照管理（CS2Weapon PBR shader + uniform 注入） | 85% 较完整 | ✅ | ✅ |
| `src/deobfuscated/06-world-props.deobf.js` | 死亡标记 + 掉落武器 + 武器图标映射 + 三角形碰撞网格 | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/07-physics-engine.deobf.js` | **自研刚体物理引擎**（Ex/Bx/Kx + 四元数/三角形数学工具） | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/10-character-model.deobf.js` | 角色模型（骨骼动画 + 材质 + 武器挂载 + 死亡 impulse） | 72% 较完整 | ✅ | ✅ |
| `src/deobfuscated/11-character-renderer.deobf.js` | 角色渲染器（InstancedMesh + 材质映射 + 枪口闪光） | 60% 节选 | ✅ | ✅ |
| `src/deobfuscated/12-fire-shader.deobf.js` | 燃烧弹火焰着色器 + 轮廓/距离场计算 | 81% 较完整 | ✅ | ✅ |
| `src/deobfuscated/13-fire-manager.deobf.js` | 燃烧弹火焰管理（FireModel + HazardVolumeManager） | 86% 较完整 | ✅ | ✅ |
| `src/deobfuscated/14-blast-effects.deobf.js` | 爆炸与闪光特效 | 96% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/15-depth-material.deobf.js` | 深度预渲染（DepthPrepass） | 98% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/16-scene-renderer.deobf.js` | 场景渲染器（静态阴影 + CS2 环境 + 着色器预编译） | 96% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/17-smoke-voxels.deobf.js` | 烟雾体素解码（Morton 编码 + 64bit 位图 occupancy grid） | 96% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/18-smoke-volume.deobf.js` | 烟雾体积渲染（光线步进 + 边缘感知着色） | 91% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/19-wireframe-geometry.deobf.js` | 线段几何 + LineSegments 材质（弹道渲染） | 91% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/20-line-material.deobf.js` | 线段材质 + 线段 raycast | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/21-tracers.deobf.js` | 弹道曳光 + 辉光后处理 + 枪口闪光 + 武器后坐力模拟 | 91% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/22-transport-controls.deobf.js` | 播放控制条 + 回合缩放 scrubber + POV + 准星 + 受击指示 | 93% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/23-death-fade.deobf.js` | 死亡淡入面板 + 连续击杀回放 + 性能统计配置 | 99% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/24-performance-panel.deobf.js` | 可拖拽性能面板 + 主题管理 + 设置面板 | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/25-team-logos.deobf.js` | 开镜遮罩（ScopeOverlay）+ 队伍 Logo 色调检测/描边 | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/26-scorebar-hud.deobf.js` | 顶部比分条 + 3D 头顶名字标签（Nametags） | 99% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/27-player-panels.deobf.js` | 侧边玩家面板 + 雷达渲染常量 | 96% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/28-radar.deobf.js` | **小地图 + 回合事件流 + 计分板 + 音频引擎 + Player 主控** | 98% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/29-catalogue-client.deobf.js` | 职业比赛目录客户端（v2 指针 + 目录校验） | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/30-artifact-codec.deobf.js` | CSDA 容器格式定义（21 个 section schema） | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/31-hosted-demo.deobf.js` | **CSDA 二进制解码器（ByteReader + 21 section）+ 校验 + gzip/sha256** | 100% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/32-app-shell.deobf.js` | 托管 demo 下载 + AppShell 骨架 + 地图统计 + 目录菜单 + 背景 clip | 99% 接近完整 | ✅ | ✅ |
| `src/deobfuscated/33-landing-backdrop.deobf.js` | 落地页 3D 背景动画 + 质量选择器 + recents + 应用入口装配 | 86% 较完整 | ✅ | ✅ |
| `src/deobfuscated/parser.worker.deobf.js` | **解析管线**：wasm 后处理 → SoA（最重要） | 作者代码全覆盖<br>（仅 bindgen 区跳过） | ✅ | ✅ |
| `src/deobfuscated/Player-render-loop.md` | Player 主控渲染循环逐行解析（分析笔记） | 笔记 | — | — |
| `docs/05-deobfuscation-guide.md` | **全部类的压缩名→语义名对照表 + 阅读指南** | — | — | — |
| `src/markup/*.html`（3 个） | 人工组装的「带上下文」模板（含部分 JS 语句，如 `function ML(e) { e.innerHTML = …`） | — | — | — |
| `src/markup/templates/*.html`（12 个） | `extract-markup.mjs` 从 bundle **逐字抠出**的纯模板，头部标注 bundle 行号 | — | — | — |

## 推荐阅读顺序（学习这个工程）

1. **先读 `docs/05-deobfuscation-guide.md`** —— 建立整体地图（谁是谁）
2. **再读 `src/deobfuscated/parser.worker.deobf.js`** —— 理解 demo 如何被解析成 SoA
3. **再读 `src/deobfuscated/Player-render-loop.md`** —— 理解如何逐帧渲染
4. **最后按需读 `src/app/` 各切片** —— 结合对照表看具体实现

## three.js 怎么读

three.js 是开源库（github.com/mrdoob/three.js），bundle 里内联的是 **r184** 版本。
反混淆它没有意义——官方仓库有带完整注释的源码。要读某个 three.js 类（如 `WebGLRenderer`、`InstancedMesh`），
直接去官方 r184 tag 对照即可。本工程 `src/vendor/three-r184.js` 仅作归档，不反混淆。

## 命名规律速查（帮助读剩余切片）

- **局部变量**：`e`=第1参数、`t`=第2参数、`n/r/i/a/o/s`=后续参数或局部变量
- **顶层常量**：`xx_` 形式（`c_=115` 回合秒数、`l_=40` 炸弹秒数、`N_` 默认光照）
- **顶层函数**：单字母+下划线（`x_`/`S_`/`T_`/`g_`...），模块级工具函数
- **类**：大驼峰短名（`R_`/`Ly`/`Ex`/`TP`...），见对照表


---

## 附：有意的改动层（2026-11-09）

`src/app/` + `src/vendor/` + `src/workers/` 是**原副本**，保持**逐字不改**（`verify-restoration` B/J 两段在守），供后续查阅复核。
所有**有意的功能改动**都写在 `src/deobfuscated/` 里（修改已有改写文件 + 新增文件）：

| 改动 | 内容 |
| --- | --- |
| 速度计算前移 | `speed` / `smoothSpeed` 两列由数据提供层算好，渲染层只查表/插值。原 `bg.sample()` 的差分和 `jC()` 的 1 秒 EMA 全部搬进 `speed-columns.js` |
| `equipValue` 剔除 | 连 `parser.worker` 的 netprop 抓取一起去掉（该字段全库零读取） |

详见 `docs/07` §3.5 / 附录 F、`docs/11` §十三，以及三个改写文件里的「【改动记录 2026-11-09】」段。
