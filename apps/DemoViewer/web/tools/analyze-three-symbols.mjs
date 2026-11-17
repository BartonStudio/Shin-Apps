// 从 src/vendor/three-r184.js（压缩名）反查「压缩名 → three 类名」映射。
//
// 原理：three 的每个类都带类型标记（`prototype.isVector3 = !0` / `this.isScene = !0`
// / `this.type = 'PlaneGeometry'`）。从标记行向上找最近的 `X = class` 即得压缩名。
// 输出可直接用于 player/three-aliases.js 的导出表。
//
// 用法：node tools/analyze-three-symbols.mjs [vendor 文件]
import { readFileSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2] ?? path.join(import.meta.dirname, '..', 'src', 'vendor', 'three-r184.js');
const lines = readFileSync(file, 'utf8').split('\n');

/** 从第 i 行向上找最近的 `X = class`，返回 X。 */
function classAbove(i) {
  for (let j = i; j >= Math.max(0, i - 200); j--) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*=\s*class\b/.exec(lines[j]);
    if (m) return { name: m[1], line: j + 1 };
  }
  return null;
}

const want = [
  'Vector3', 'Vector2', 'Vector4', 'Scene', 'Mesh', 'Object3D', 'Group', 'PerspectiveCamera',
  'OrthographicCamera', 'WebGLRenderer', 'Quaternion', 'Matrix4', 'Matrix3', 'Raycaster', 'Ray',
  'Color', 'Box3', 'Sphere', 'BufferGeometry', 'Texture', 'Bone', 'SkinnedMesh', 'InstancedMesh',
  'Sprite', 'Points', 'Line', 'LineSegments', 'Frustum', 'Clock', 'Euler', 'PlaneGeometry',
  'BoxGeometry', 'SphereGeometry', 'CylinderGeometry', 'CircleGeometry', 'RingGeometry',
  'TorusGeometry', 'CapsuleGeometry', 'CanvasTexture', 'DataTexture', 'MeshBasicMaterial',
  'MeshStandardMaterial', 'MeshLambertMaterial', 'LineBasicMaterial', 'ShaderMaterial',
  'PointsMaterial', 'SpriteMaterial', 'AmbientLight', 'DirectionalLight', 'PointLight',
  'HemisphereLight', 'SpotLight', 'Fog', 'FogExp2', 'BufferAttribute', 'Float32BufferAttribute',
  'Plane', 'AnimationMixer', 'AnimationClip', 'OrbitControls',
];

const out = new Map();
const markRes = [
  /prototype\.is([A-Za-z0-9]+)\s*=\s*!0/,   // 原型式标记
  /this\.is([A-Z][A-Za-z0-9]*)\s*=\s*!0/,     // 构造器式标记
  /(?:^|[^.\w])is([A-Z][A-Za-z0-9]*)\s*=\s*!0/, // 类字段式标记（无 this./prototype.）
  /this\.type\s*=\s*`([A-Za-z0-9]+)`/,        // 几何体 type 字符串
];

for (let i = 0; i < lines.length; i++) {
  for (const re of markRes) {
    const m = re.exec(lines[i]);
    if (!m || out.has(m[1])) continue;
    const cls = classAbove(i);
    if (cls) out.set(m[1], { comp: cls.name, line: cls.line });
    break;
  }
}

// OrbitControls 没有统一的 is 标记：用 "enableDamping 默认 false + target 属性" 特征定位。
if (!out.has('OrbitControls')) {
  for (let i = 0; i < lines.length; i++) {
    if (!/enableDamping\s*=\s*!1/.test(lines[i])) continue;
    const cls = classAbove(i);
    if (cls) { out.set('OrbitControls', { comp: cls.name, line: cls.line }); break; }
  }
}

let missing = [];
for (const name of want) {
  const v = out.get(name);
  if (v) console.log(`${name.padEnd(24)} ${v.comp}@${v.line}`);
  else missing.push(name);
}
if (missing.length) console.log(`\n未自动识别（需人工/运行时补齐）：${missing.join(', ')}`);
