// 把 csdemo.tv 生产 bundle（2026-11-03 版，prettier 展开）按真实模块边界切成可读源码。
// 逐字切片，不重写、不改名，只在文件头加来源行号信息。
//
// ── 2026-11-09 修正 ──────────────────────────────────────────────────────────
// 旧版把 three.js 边界定在 L28860，是错的。本次用「只可能出现在单侧的特征串」重新定位：
//   · three.js 专有标识（WebGLProgram / WebGLState / InterleavedBuffer …）最后一次出现在 L27786
//   · three-mesh-bvh 专有串 "BVH: Fallback raycast function not found." 在 L27956
//   · app 侧 `Uh()` 使用 { ticks, posXYZ, detonationTick, endTick }（投掷物轨迹）出现在 L27992
//   · app 侧 share code 字母表 `ug`（57 字符）出现在 L28269
//   · 常量 `Hh = new B(0,0,1)`（L27991）被 app 在 L28251 `applyAxisAngle(Hh, …)` 使用
// → three.js（含 addons，最后一个是 three-mesh-bvh）= L1–27990
// → 应用层 = L27991–53504
//
// 附带发现：旧版 01-timeline-utils 起点 L28861 落在函数 `f_`（L28858–28874）内部，
// 导致该函数丢了函数头和前两行。本次把 01 起点前移到 L28797。
// ────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'decompiled', 'index.beautified.js');
const OUT = path.join(ROOT, 'src');

const BUNDLE = 'index-E0opA-yG.js';

// [起始行(1-based, 含), 结束行(含), 目录, 文件名, 角色说明]
// three.js：L1–27990（含 OrbitControls/CSS2DRenderer/GLTFLoader/meshopt/PMREM/GGX/three-mesh-bvh）
// 应用层：L27991–53504
const REGIONS = [
  // ── 内联依赖（three.js r184 完整内联 + 附加组件，末尾是 three-mesh-bvh）──
  [1, 27990, 'vendor', 'three-r184.js', 'three.js r184 完整内联 + 附加组件（OrbitControls / CSS2DRenderer / GLTFLoader / meshopt 解码 / PMREM / GGX 卷积 / three-mesh-bvh），末尾 three-mesh-bvh 的 "BVH: Fallback raycast function not found." 是接缝标志'],

  // ── 应用层：主切片之前的前置工具模块 ──
  [27991, 28268, 'app', '00a-grenade-trajectory.js', '投掷物轨迹重采样 Uh/Kh + 落点视角 lg（用 three-mesh-bvh 对地图做碰撞射线，含 "Landing view needs loaded map geometry." 等 UX 文案）'],
  [28269, 28348, 'app', '00b-share-code.js', 'CS:GO 匹配分享码编解码：57 字符字母表 ug（ABCDEFGHJKLMNOPQRSTUVWXYZ…）+ hg/gg/_g/vg'],
  [28349, 28486, 'app', '00c-frame-sampler.js', '**帧采样核心**：玩家状态输出缓冲 yg + 帧采样器 bg（SoA 相邻帧插值 + 从相邻帧求导得 speed）+ 插值工具 xg（线性）/ Sg（yaw 最短弧，按 360° 归一化）+ 播放时钟 Cg'],
  [28487, 28584, 'app', '00d-bomb-defuse.js', '炸弹/拆包状态机：wg/Tg（拆包进度，含击杀打断判定）/ Eg / Dg / Og'],
  [28585, 28679, 'app', '00e-kill-helpers.js', '击杀查询与回放链：kg/Ag/jg/Mg/Ng/Pg + 玩家配色表 Fg（blue/green/yellow/orange/purple）'],
  [28680, 28796, 'app', '00f-dom-utils.js', 'Hg 类 + DOM/回调小工具与惰性单例（Gg/Kg、qg/Jg、Yg/Xg、Zg/Qg/$g/e_/t_、TextEncoder n_）'],

  // ── 原有切片（01 的起点已从 28861 前移到 28797，修正 f_ 被截断的问题）──
  [28797, 29162, 'app', '01-timeline-utils.js', '回合/HUD 状态纯函数：常量 o_("fire_bullets") / c_(115 回合秒) / l_(40 炸弹秒)，u_ / **d_（比分+HUD 状态构建器，唯一读 frames.score 与 players.clanName 的地方）** / f_（战术暂停）/ p_（拆包）/ m_（回合阶段）/ h_（下包）/ g_（时间格式化）'],
  [29163, 29746, 'app', '02-map-assets.js', 'maps.csdemo.tv 地图清单客户端 + overview.txt 解析成雷达坐标映射（R_ 前的函数层）'],
  [29747, 29970, 'app', '03-map-classification.js', '地图分类/破坏删除（Av：classifyDeletions/breaks/matched）+ 视锥剔除（Fv：setView/cull/sphereVisible）'],
  [29971, 31491, 'app', '04-lighting-shader.js', '自研光照系统 zv：directLight/indirectLight/probeSample/envBrdfApprox/octEncode/CustomToneMapping'],
  [31492, 32300, 'app', '05-scene-lighting.js', '场景光照管理 Ly：usesCs2Map/setCs2/setClassic/createMaterial/ambientCube'],
  [32301, 32967, 'app', '06-world-props.js', '世界道具 Eb：死亡标记（death-label/death-name）、CSS3D 图层'],
  [32968, 33613, 'app', '07-physics-engine.js', '自研物理引擎 Ex：solveJoint/step/boneTransforms/staticFriction/solveContactVelocities（XPBD 风格刚体求解器）'],
  [33614, 33718, 'app', '08-physics-model.js', '物理模型/姿势 Bx：bodiesOf/poseOf/modelSpace/placeChild'],
  [33719, 34297, 'app', '09-trajectory-recorder.js', 'ragdoll 轨迹录制器 Kx：advanceTo（前向模拟）/ record（录帧）/ sample（O(1) lerp+slerp 采样）/ collidersOf'],
  [34298, 35809, 'app', '10-character-model.js', '角色模型 gS：pose/骨骼姿势/break pieces（ragdoll 驱动，含 hw=4ms 帧预算）'],
  [35810, 37125, 'app', '11-character-renderer.js', '角色渲染 zw：characters 贴图/胶囊兜底'],
  [37126, 37844, 'app', '12-fire-shader.js', '燃烧瓶/火墙 shader uE：activeAt/footprintShape/noise/tracePatches'],
  [37845, 38343, 'app', '13-fire-manager.js', '火焰管理 YE：updateFire/removeScorch/HazardVolumes/InfernoScorch'],
  [38344, 39079, 'app', '14-blast-effects.js', '爆炸/闪光效果 cD：begin/show/end/blast'],
  [39080, 39174, 'app', '15-depth-material.js', '深度材质/深度预处理 HD：render/depthMaterialFor/compileAsync'],
  [39175, 39543, 'app', '16-scene-renderer.js', '场景渲染器 qD：setShadowQuality/render/beginRenderFrame/静态阴影/大气'],
  [39544, 39727, 'app', '17-smoke-voxels.js', '烟雾体素解码 tO：dissipationFrame/seedPointsAtTick/occupancy'],
  [39728, 40907, 'app', '18-smoke-volume.js', '烟雾体积渲染 lO：writeFramePair/disturbance/edgeAwareSmoke/shaderScenes'],
  [40908, 41380, 'app', '19-wireframe-geometry.js', '线框几何 XO：fromWireframeGeometry/fromEdgesGeometry'],
  [41381, 41590, 'app', '20-line-material.js', '线段材质 ZO：linewidth/dashed/alphaToCoverage'],
  [41591, 42174, 'app', '21-tracers.js', '弹道曳光/轨迹线 gk：setData/impactAt/render/computeLineDistances'],
  [42175, 43246, 'app', '22-transport-controls.js', '播放控制条 xA：controls/timeline/round-timeline/scrubber'],
  [43247, 43602, 'app', '23-death-fade.js', '死亡淡入叠加 oj：death-fade-*'],
  [43603, 44733, 'app', '24-performance-panel.js', '性能面板 vj：performance-*/stats-live-*/fps-chart'],
  [44734, 45086, 'app', '25-team-logos.js', '⚠️ 文件名不覆盖全部内容：开头 oM = **ScopeOverlay（开镜遮罩，scope-overlay scope-sniper）**，之后才是队伍 logo 的一组函数（gM 建 hosted-logo / _M 套用 emblem tone / CM 主题切换 / dM fM vM TM EM）——TeamLogo 不是一个类'],
  [45087, 45384, 'app', '26-scorebar-hud.js', '顶部比分条 HUD jM：hud/scorebar/sb-t-score/bomb 状态'],
  [45385, 45563, 'app', '27-player-panels.js', '玩家面板 KM：pp/pp-defuse-meter'],
  [45564, 48976, 'app', '28-radar.js', '**Player 主控类 TP（L47359 起）+ 2D 雷达 fN + 事件面板 vN + 计分板 DN + 音频引擎 + 导航辅助**'],
  [48977, 49253, 'app', '29-catalogue-client.js', 'data.csdemo.tv 职业比赛目录客户端（v2 指针 + generation + 校验 + jP 错误）'],
  [49254, 49469, 'app', '30-artifact-codec.js', 'CSDA 容器校验/解码（CF + Z 错误，含作者英文 schema notes）'],
  [49470, 50816, 'app', '31-hosted-demo.js', '托管 demo 下载（sha256/gunzip）+ **CSDA 二进制解码器（21 section）** + parser worker 桥接 + IndexedDB + 队伍识别（YI）'],
  [50817, 52714, 'app', '32-app-shell.js', 'AppShell：落地页/播放页骨架 + 最近场次 + 主题 + 设置 + 入口'],
  [52715, 53504, 'app', '33-landing-backdrop.js', '落地页 3D 背景动画 JR：landing-backdrop-canvas/mirage A 执行'],
];

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
fs.mkdirSync(path.join(OUT, 'app'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });

const total = REGIONS.length;
const manifest = [];
for (let i = 0; i < REGIONS.length; i++) {
  const [start, end, dir, name, role] = REGIONS[i];
  const body = lines.slice(start - 1, end).join('\n');
  const header = [
    '// ─────────────────────────────────────────────────────────────────────────────',
    `// 来源：https://csdemo.tv/assets/${BUNDLE}（Vite 生产构建，prettier 展开版）`,
    `// 位置：decompiled/index.beautified.js 第 ${start}–${end} 行（切片 ${i + 1}/${total}）`,
    `// 角色：${role}`,
    '// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。',
    '// ─────────────────────────────────────────────────────────────────────────────',
    '',
  ].join('\n');
  const file = path.join(OUT, dir, name);
  fs.writeFileSync(file, header + body + '\n', 'utf8');
  manifest.push({ slice: `${i + 1}/${total}`, file: `src/${dir}/${name}`, start, end, role });
}

fs.writeFileSync(
  path.join(ROOT, 'docs', 'slices.json'),
  JSON.stringify(
    {
      source: `https://csdemo.tv/assets/${BUNDLE}`,
      correctedAt: '2026-11-09',
      boundary: {
        vendor: [1, 27990],
        app: [27991, 53504],
        note: '旧版误将 three.js 边界定为 28860，把 870 行应用层代码（投掷物轨迹/分享码/帧采样器/炸弹状态/HUD 状态）装进了 vendor。',
      },
      slices: manifest,
      // ── 不来自 bundle 切片的产物：独立文件，各自对应自己的原始产物 ──
      otherSources: [
        {
          file: 'src/workers/parser.worker.js',
          raw: 'raw/assets/parser.worker-Cvx4vjXK.js',
          decompiled: 'decompiled/parser.worker.js',
          deobf: 'src/deobfuscated/parser.worker.deobf.js',
          note: 'wasm-bindgen 胶水 + SoA 后处理；不在 bundle 切片体系内',
        },
        {
          file: 'src/workers/mapGeometry.worker.js',
          raw: 'raw/assets/mapGeometry.worker-BGvfBalF.js',
          decompiled: 'decompiled/mapGeometry.worker.js',
          deobf: null,
          note: '地图 GLB/meshopt 解码 worker；不在 bundle 切片体系内，尚无改写产物',
        },
        {
          file: 'raw/assets/csplayer_parser_bg-qigVgicw.wasm',
          raw: 'raw/assets/csplayer_parser_bg-qigVgicw.wasm',
          decompiled: null,
          deobf: null,
          note: 'Rust→wasm 解析内核（LaihoE/demoparser）；无源码还原可能，元数据见 wasm/report.json',
        },
      ],
      // ── 由切片/样式派生的再加工产物 ──
      derived: {
        markup: {
          from: 'slices（bundle 内联模板字符串）',
          files: ['src/markup/app-shell.html', 'src/markup/hud.html', 'src/markup/player-panel.html'],
          fidelity: '标志行可回溯 bundle 原文',
        },
        styles: {
          from: 'decompiled/index.beautified.css',
          files: 'styles/*.css（18 个）',
          fidelity: '声明多重集与源 CSS 完全一致；@media 被逐条重新包裹，结构不可拼回',
        },
      },
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`wrote ${manifest.length} slices (vendor 1-27990, app 27991-53504) + ${3} otherSources`);
