// 把 csdemo.tv 生产 bundle（2026-11-03 版，prettier 展开）按真实模块边界切成可读源码。
// 逐字切片，不重写、不改名，只在文件头加来源行号信息。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'decompiled', 'index.beautified.js');
const OUT = path.join(ROOT, 'src');

const BUNDLE = 'index-E0opA-yG.js';

// [起始行(1-based, 含), 结束行(含), 目录, 文件名, 角色说明]
// 新版把 three.js r184 完整内联进 bundle 前半段（1~28860），应用代码在后半段（28861+）。
const REGIONS = [
  // —— 内联依赖 ——
  [1, 28860, 'vendor', 'three-r184.js', 'three.js r184 完整内联（核心 + 附加组件：OrbitControls、CSS2DRenderer、GLTFLoader、meshopt 解码、PMREM、GGX 卷积等）'],

  // —— 应用层 ——
  [28861, 29162, 'app', '01-timeline-utils.js', '回合/时间纯函数：炸弹下包拆包状态、计时文本、回合阶段（freeze/live/over/planted）'],
  [29163, 29746, 'app', '02-map-assets.js', 'maps.csdemo.tv 地图清单客户端 + overview.txt 解析成雷达坐标映射（R_ 前的函数层）'],
  [29747, 29970, 'app', '03-map-classification.js', '地图分类/破坏删除（Av：classifyDeletions/breaks/matched）+ 视锥剔除（Fv：setView/cull/sphereVisible）'],
  [29971, 31491, 'app', '04-lighting-shader.js', '自研光照系统 zv：directLight/indirectLight/probeSample/envBrdfApprox/octEncode/CustomToneMapping'],
  [31492, 32300, 'app', '05-scene-lighting.js', '场景光照管理 Ly：usesCs2Map/setCs2/setClassic/createMaterial/ambientCube'],
  [32301, 32967, 'app', '06-world-props.js', '世界道具 Eb：死亡标记（death-label/death-name）、CSS3D 图层'],
  [32968, 33613, 'app', '07-physics-engine.js', '自研物理引擎 Ex：solveJoint/step/boneTransforms/staticFriction/solveContactVelocities'],
  [33614, 33718, 'app', '08-physics-model.js', '物理模型/姿势 Bx：bodiesOf/poseOf/modelSpace/placeChild'],
  [33719, 34297, 'app', '09-trajectory-recorder.js', '轨迹/碰撞记录器 Kx：advanceTo/sample/collidersOf/shaderPrototypes'],
  [34298, 35809, 'app', '10-character-model.js', '角色模型 gS：pose/骨骼姿势/break pieces'],
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
  [44734, 45086, 'app', '25-team-logos.js', '队伍 logo oM：hosted-logo-fallback/emblem tone'],
  [45087, 45384, 'app', '26-scorebar-hud.js', '顶部比分条 HUD jM：hud/scorebar/sb-t-score/bomb 状态'],
  [45385, 45563, 'app', '27-player-panels.js', '玩家面板 KM：pp/pp-defuse-meter'],
  [45564, 48976, 'app', '28-radar.js', '2D 雷达 fN：radar-canvas/radar-resize/radar-ctrls'],
  [48977, 49253, 'app', '29-catalogue-client.js', 'data.csdemo.tv 职业比赛目录客户端（v2 指针 + generation + 校验 + jP 错误）'],
  [49254, 49469, 'app', '30-artifact-codec.js', 'CSDA 容器校验/解码（CF + Z 错误）'],
  [49470, 50816, 'app', '31-hosted-demo.js', '托管 demo 下载（sha256/gunzip）+ parser worker 桥接 + IndexedDB + 队伍识别（YI）'],
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
  JSON.stringify({ source: `https://csdemo.tv/assets/${BUNDLE}`, slices: manifest }, null, 2),
  'utf8',
);
console.log(`wrote ${manifest.length} slices`);
