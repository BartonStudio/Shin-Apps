# 反混淆说明（deobfuscation）

> 目标：把压缩混淆后的 csdemo.tv 前端代码还原成可阅读、可学习的工程。

## 结论先行：能还原到什么程度

| 内容 | 压缩前 | 压缩后 | 能否还原 | 还原方式 |
| --- | --- | --- | --- | --- |
| 类名 / 类字段名 / 方法名 | `Player` / `followPlayer` | **保留原意** | ✅ 无需还原 | 直接读 |
| 局部变量名 | `slot` / `tick` | `e` / `t` / `n` | ⚠️ 无法自动还原 | 手工按语义重命名 |
| 注释 / 空行 | 有 | 已删除 | ❌ 永久丢失 | 手工补注释 |
| 原始模块划分 | 多文件 | 打成 1 个 bundle | ⚠️ 部分可推断 | 按代码边界切片 |
| three.js | 开源库 | 内联进 bundle | ✅ 无需还原 | 读官方源码 |

**关键发现**：这个 bundle 用的是 esbuild/Vite 的默认 `minify`，它**只压缩局部变量，不混淆类成员名**。
所以类名（`MapLoader` 被压成 `R_`，但字段 `group`/`loadGeneration` 保留）、方法名（`followPlayer`、`sampleAndRender`）
几乎全部保留原意。真正需要反混淆的只有**函数内部的局部变量** `e/t/n/r/i/a/o/s`。

## 为什么不能 100% 还原成作者手写的样子

压缩是**有损**的：原始变量名、注释、空行、文件结构在编译时就被永久删除了，任何工具都无法恢复。
所以"反混淆"的产物是"**语义等价、可读、带注释**"的代码，而不是"和作者源码一字不差"的代码。

## 反混淆产物清单

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| `src/deobfuscated/01-timeline-utils.deobf.js` | 回合时间线/炸弹状态/计时（完整反混淆） | ✅ |
| `src/deobfuscated/02-map-assets.deobf.js` | 地图清单客户端 + MapLoader（完整反混淆） | ✅ |
| `src/deobfuscated/parser.worker.deobf.js` | **解析管线**：wasm 后处理 → SoA（完整反混淆，最重要） | ✅ |
| `src/deobfuscated/Player-render-loop.md` | Player 主控渲染循环逐行解析 | ✅ |
| `src/deobfuscated/04-light-probe-grid.deobf.js` | 光照探针网格（YCbCr luma/chroma + 三线性插值 + gzip 解压） | ✅ |
| `src/deobfuscated/05-scene-lighting.deobf.js` | 场景光照管理（CS2Weapon PBR shader + uniform 注入） | ✅ |
| `src/deobfuscated/07-physics-engine.deobf.js` | **自研刚体物理引擎**（Ex/Bx/Kx + 四元数/三角形数学工具） | ✅ |
| `src/deobfuscated/13-fire-manager.deobf.js` | 燃烧弹火焰管理（FireModel + HazardVolumeManager） | ✅ |
| `src/deobfuscated/15-depth-material.deobf.js` | 深度预渲染（DepthPrepass） | ✅ |
| `src/deobfuscated/16-scene-renderer.deobf.js` | 场景渲染器（静态阴影 + CS2 环境 + 预编译） | ✅ |
| `src/deobfuscated/17-smoke-voxels.deobf.js` | 烟雾体素解码（Morton 编码 + 64bit 位图 occupancy grid） | ✅ |
| `src/deobfuscated/21-tracers.deobf.js` | 弹道曳光 + 辉光后处理 + 枪口闪光 + 武器后坐力模拟 | ✅ |
| `src/deobfuscated/22-transport-controls.deobf.js` | 播放控制条 + 回合缩放 scrubber + POV + 准星 + 受击指示 | ✅ |
| `src/deobfuscated/23-death-fade.deobf.js` | 死亡淡入面板 + 连续击杀回放 + 性能统计配置 | ✅ |
| `src/deobfuscated/24-performance-panel.deobf.js` | 可拖拽性能面板 + 主题管理 + 设置面板 | ✅ |
| `src/deobfuscated/25-team-logos.deobf.js` | 开镜遮罩 + 队伍 Logo 色调检测/描边 | ✅ |
| `src/deobfuscated/26-scorebar-hud.deobf.js` | 顶部比分条 + 3D 头顶名字标签 | ✅ |
| `src/deobfuscated/27-player-panels.deobf.js` | 侧边玩家面板 + 雷达渲染常量 | ✅ |
| `src/deobfuscated/28-radar.deobf.js` | **小地图 + 回合事件流 + 计分板 + 音频引擎 + 播放器主控** | ✅ |
| `src/deobfuscated/29-catalogue-client.deobf.js` | 职业比赛目录客户端（v2 指针 + 目录校验） | ✅ |
| `src/deobfuscated/30-artifact-codec.deobf.js` | CSDA 容器格式定义（21 个 section schema） | ✅ |
| `src/deobfuscated/31-hosted-demo.deobf.js` | **CSDA 二进制解码器（ByteReader + 21 section）+ 校验 + gzip/sha256** | ✅ |
| `src/deobfuscated/32-app-shell.deobf.js` | 托管 demo 下载 + AppShell 骨架 + 地图统计 + 目录菜单 + 背景 clip | ✅ |
| `src/deobfuscated/33-landing-backdrop.deobf.js` | 落地页 3D 背景动画 + 质量选择器 + recents + 应用入口装配 | ✅ |
| `src/deobfuscated/03-map-classification.deobf.js` | 地图实体分类/破坏删除 + 视锥剔除 + 批量网格 | ✅ |
| `src/deobfuscated/04-lighting-shader.deobf.js` | **自研光照系统**（探针网格 + PBR shader + tone mapping + CS2 地图加载器） | ✅ |
| `src/deobfuscated/06-world-props.deobf.js` | 死亡标记 + 掉落武器 + 武器图标映射 + 三角形碰撞网格 | ✅ |
| `src/deobfuscated/19-wireframe-geometry.deobf.js` | 线段几何 + LineSegments 材质（弹道渲染） | ✅ |
| `src/deobfuscated/20-line-material.deobf.js` | 线段材质 + 线段 raycast | ✅ |
| `docs/05-deobfuscation-guide.md` | **全部类的压缩名→语义名对照表 + 阅读指南** | ✅ |

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
