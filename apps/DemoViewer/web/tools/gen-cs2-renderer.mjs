// 把 deobf/04-lighting-shader 的可读实现移植成 webapp 模块（加导入外墙 + 常量）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/deobfuscated/04-lighting-shader.deobf.js'), 'utf8');

// 1) 去掉文件头注释，从第一个实现处开始
const startIdx = src.indexOf('class LightGrid {');
if (startIdx < 0) throw Error('未找到 LightGrid 起点');
let body = src.slice(startIdx);

// 修正 deobf 转写笔误：CustomToneMapping 的 clamp 上限应为 whitePoint（原件 iy(r)），
// 不是 invWhitePoint（负数会把所有像素 min 成负值 → 全黑）。
body = body.replace(
  'vec3 x = min( color * ( toneMappingExposure * ${glslFloat(2 ** (tonemap.exposureBias + TONEMAP_EXPOSURE_BIAS) * 2.8)} ), vec3( ${glslFloat(invWhitePoint)} ) );',
  'vec3 x = min( color * ( toneMappingExposure * ${glslFloat(2 ** (tonemap.exposureBias + TONEMAP_EXPOSURE_BIAS) * 2.8)} ), vec3( ${glslFloat(whitePoint)} ) );',
);

// 2) 去掉尾部的说明性小结（如有）
const tailIdx = body.lastIndexOf('// ───');
if (tailIdx > body.length - 400) body = body.slice(0, tailIdx);

const prologue = `// =============================================================================
// cs2/map-renderer.js —— CS2 地图包（cs2render v5）完整渲染器
//
// 本文件由 tools/gen-cs2-renderer.mjs 从 web/src/deobfuscated/04-lighting-shader.deobf.js
// 移植生成：GLSL 与逐帧逻辑保持原件一字不改，仅补充 three 导入与少量常量。
// 原版对照：beautified L29971-31491（切片 04-lighting-shader）
//   · LightGrid          —— 烘焙光照网格三线性采样
//   · buildProbeVolumeGrid —— 探针体积 → GPU 纹理打包
//   · PVSVisibility      —— 预计算可见性 BSP 查询
//   · CS2MapRenderer     —— map.json 驱动的地图加载/材质/几何/剔除
//   · installToneMapping —— LUT 曲线注入 three 的 CustomToneMapping
// =============================================================================
import {
  Color, Vector2, Vector3, Vector4, Matrix3, Matrix4, Euler, Box3, Sphere,
  Scene, Group, Mesh, BufferGeometry, BufferAttribute, DataTexture, Data3DTexture,
  ShaderMaterial, ShaderChunk, MathUtils, PerspectiveCamera, OrthographicCamera,
  WebGLRenderTarget, LinearSRGBColorSpace, SRGBColorSpace,
} from '../vendor/three-bundle.js';
import {
  parseKtx, decodeTexture, decodeCtexBytes, gltfModule,
  fetchMapPackage, recheckMapPackage, BatchedMapMesh, MapCuller,
  checkRequiredGLExtensions, extractFog,
} from './support.js';

// three 常量（r184 公开数值；vendor 未导出常量表）
const RGBAFormat = 1023;
const RedFormat = 1029;
const FloatType = 1015;
const HalfFloatType = 1016;
const UnsignedByteType = 1009;
const NearestFilter = 1003;
const LinearFilter = 1006;
const LinearMipmapLinearFilter = 1008;
const RepeatWrapping = 1000;
const ClampToEdgeWrapping = 1001;
const CustomToneMapping = 5;
const FrontSide = 0;
const DoubleSide = 2;

`;

const epilogue = `
export {
  LightGrid,
  buildProbeVolumeGrid,
  nearestProbeBox,
  PVSVisibility,
  CS2MapRenderer,
  installToneMapping,
  decodeCtexBytes,
};
`;

const out = prologue + body + epilogue;
const dest = path.join(ROOT, '..', 'webapp/src/player/cs2/map-renderer.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);

// 3) 检查未定义的标识符（粗筛：大写开头 + 已知 three 名单）
const KNOWN_IMPORTS = new Set(['Color', 'Vector2', 'Vector3', 'Vector4', 'Matrix3', 'Matrix4', 'Euler', 'Box3', 'Sphere', 'Scene', 'Group', 'Mesh', 'BufferGeometry', 'BufferAttribute', 'DataTexture', 'Data3DTexture', 'ShaderMaterial', 'ShaderChunk', 'MathUtils', 'PerspectiveCamera', 'OrthographicCamera', 'WebGLRenderTarget', 'RGBAFormat', 'RedFormat', 'FloatType', 'HalfFloatType', 'UnsignedByteType', 'NearestFilter', 'LinearFilter', 'LinearMipmapLinearFilter', 'RepeatWrapping', 'ClampToEdgeWrapping', 'CustomToneMapping', 'FrontSide', 'DoubleSide', 'parseKtx', 'decodeTexture', 'decodeCtexBytes', 'gltfModule', 'fetchMapPackage', 'recheckMapPackage', 'BatchedMapMesh', 'MapCuller']);
const defined = new Set(KNOWN_IMPORTS);
for (const m of out.matchAll(/^(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);

const suspicious = new Set();
for (const m of out.matchAll(/\b([A-Z][A-Za-z0-9_]{2,})\b/g)) {
  const name = m[1];
  if (!defined.has(name)) suspicious.add(name);
}
console.log('已写出', dest, (out.length / 1024).toFixed(1) + 'KB');
console.log('可疑未定义标识符：', [...suspicious].join(', ') || '（无）');
