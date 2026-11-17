// =============================================================================
// cs2/support.js —— CS2 渲染器的外围支撑（原件里散落在 bundle 各处的助手）
//
// 对应原件：
//   · yv / xv    —— CTEX（Source2 .ctex 容器）解析 + 压缩纹理上传
//   · bv/gv      —— CTEX format 枚举 → three 压缩纹理格式 + 色彩空间
//   · $_(Q_)     —— meshopt 解码器（用我们已有的 vendor/meshopt-decoder）
//   · fv / pv    —— fetchMapPackage / recheckMapPackage（CS2 包地址解析）
//   · Fv         —— BatchedMapMesh（原版是 multi-draw 批量网格，这里退化为普通 Mesh）
//   · MapCuller  —— 视锥/PVS/细节距离剔除（这里保留接口，PVS 由调用方传入）
// =============================================================================
import {
  Mesh,
  Sphere,
  Vector3,
  Matrix4,
  CompressedTexture,
  CompressedArrayTexture,
  Vector2,
} from '../vendor/three-bundle.js';
import { MeshoptDecoder } from '../vendor/meshopt-decoder.js';

// ── CTEX 解析（原件 yv + gv 枚举） ───────────────────────────────────────────

const CTEX_MAGIC = 1480938563; // 'CTEX' 小端

const CTEX_FORMAT = {
  Bc1Srgb: 1,
  Bc7Srgb: 2,
  Bc7Linear: 3,
  Bc5: 4,
  Bc4: 5,
  Bc6hUf16: 6,
  Bc1Linear: 7,
};

// three 压缩纹理格式常量（r184 数值，稳定公开）
const FMT = {
  RGB_S3TC_DXT1: 33776,
  RGBA_BPTC: 36492,
  RGB_BPTC_UNSIGNED: 36495,
  RED_RGTC1: 36283,
  RED_GREEN_RGTC2: 36285,
};

const COLOR_SPACE_SRGB = 'srgb';

const FILTER = { Nearest: 1003, Linear: 1006, LinearMipmapLinear: 1008 };
const WRAP = { Repeat: 1000, ClampToEdge: 1001 };

/** CTEX 容器解析（原件 yv）：返回 {format, width, height, layers, mips[]} */
export function parseKtx(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 28 || view.getUint32(0, true) !== CTEX_MAGIC) throw Error('not a CTEX file');
  const version = view.getUint32(4, true);
  if (version !== 1) throw Error(`unsupported CTEX version ${version}`);

  const format = view.getUint32(8, true);
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const layers = view.getUint32(20, true);
  const mipCount = view.getUint32(24, true);

  let offset = 28 + mipCount * 4;
  const mips = [];
  for (let n = 0; n < mipCount; n++) {
    const size = view.getUint32(28 + n * 4, true);
    if (offset + size > buffer.byteLength) throw Error('truncated CTEX file');
    mips.push({
      data: new Uint8Array(buffer, offset, size),
      width: Math.max(1, width >> n),
      height: Math.max(1, height >> n),
    });
    offset += size;
  }
  return { format, width, height, layers, mips };
}

/** CTEX format → three 压缩格式 + 色彩空间（原件 bv） */
function ctexTarget(format) {
  switch (format) {
    case CTEX_FORMAT.Bc1Srgb: return { format: FMT.RGB_S3TC_DXT1, colorSpace: COLOR_SPACE_SRGB };
    case CTEX_FORMAT.Bc1Linear: return { format: FMT.RGB_S3TC_DXT1, colorSpace: '' };
    case CTEX_FORMAT.Bc7Srgb: return { format: FMT.RGBA_BPTC, colorSpace: COLOR_SPACE_SRGB };
    case CTEX_FORMAT.Bc7Linear: return { format: FMT.RGBA_BPTC, colorSpace: '' };
    case CTEX_FORMAT.Bc5: return { format: FMT.RED_GREEN_RGTC2, colorSpace: '' };
    case CTEX_FORMAT.Bc4: return { format: FMT.RED_RGTC1, colorSpace: '' };
    case CTEX_FORMAT.Bc6hUf16: return { format: FMT.RGB_BPTC_UNSIGNED, colorSpace: '' };
    default: throw Error(`unknown CTEX format ${String(format)}`);
  }
}

/** CTEX → CompressedTexture / CompressedArrayTexture（原件 xv） */
export function decodeTexture(ktx, opts = {}) {
  const { format, colorSpace } = ctexTarget(ktx.format);
  const texture = opts.array
    ? new CompressedArrayTexture(ktx.mips, ktx.width, ktx.height, ktx.layers, format)
    : new CompressedTexture(ktx.mips, ktx.width, ktx.height, format);
  texture.colorSpace = colorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.magFilter = FILTER.Linear;
  texture.minFilter = ktx.mips.length > 1 ? FILTER.LinearMipmapLinear : FILTER.Linear;
  const wrap = opts.repeat ? WRAP.Repeat : WRAP.ClampToEdge;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.anisotropy = opts.anisotropy ?? 1;
  texture.needsUpdate = true;
  return texture;
}

/** 先解析再建纹理的便捷函数 */
export function decodeCtexBytes(bytes, opts) {
  return decodeTexture(parseKtx(bytes), opts);
}

// ── meshopt 解码器（原件 Q_ / $_） ──────────────────────────────────────────

export const gltfModule = {
  get ready() {
    return MeshoptDecoder.ready;
  },
  decodeGltfBufferAsync: (...args) => MeshoptDecoder.decodeGltfBufferAsync(...args),
  useWorkers: (n) => MeshoptDecoder.useWorkers?.(n),
};

// ── CS2 包地址（原件 fv / pv） ──────────────────────────────────────────────

const CS2_BASE_URL =
  import.meta.env.VITE_CS2_ASSETS_URL ??
  (import.meta.env.DEV ? 'http://127.0.0.1:8123/cs2/' : '/cs2/');

let packageIndexPromise = null;
const resolvedPackages = new Map();

async function loadPackageIndex() {
  packageIndexPromise ??= fetch(new URL('index.json', CS2_BASE_URL).href)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return packageIndexPromise;
}

/** 解析 `map:<name>` → 包基址；原件走 CDN 清单 + 迁移检测 */
export async function fetchMapPackage(key) {
  if (resolvedPackages.has(key)) return resolvedPackages.get(key);
  if (!key.startsWith('map:')) return null;
  const mapName = key.slice(4);
  const index = await loadPackageIndex();
  const path = index?.maps?.[mapName]?.path;
  if (!path) return null;
  const base = `${CS2_BASE_URL}${path.endsWith('/') ? path : `${path}/`}`;
  resolvedPackages.set(key, base);
  return base;
}

/** 包迁移检测：本地镜像固定路径，永不迁移 */
export async function recheckMapPackage() {
  return null;
}

// ── 环境取值（原件 Sv / extractFog） ───────────────────────────────────────

/** manifest.scene.fog 缺省时用天空色、近乎无雾 */
export function extractFog(manifest) {
  return (
    manifest.scene.fog ?? {
      color: manifest.scene.sun.skyColor,
      start: 1e6,
      end: 1e7,
      falloffExponent: 1,
      maxOpacity: 0,
      height: false,
      heightStart: 0,
      heightEnd: 0,
      verticalExponent: 1,
    }
  );
}

// ── GPU 压缩纹理能力检测（原件 vv） ─────────────────────────────────────────

const REQUIRED_GL_EXTENSIONS = [
  'EXT_texture_compression_bptc',
  'EXT_texture_compression_rgtc',
  'WEBGL_compressed_texture_s3tc',
  'WEBGL_compressed_texture_s3tc_srgb',
];

/** 返回缺失的扩展名列表（空数组 = 支持 CS2 材质压缩纹理） */
export function checkRequiredGLExtensions(renderer) {
  return REQUIRED_GL_EXTENSIONS.filter((name) => !renderer.extensions.has(name));
}

// ── 批量网格（原件 Fv：multi-draw + LOD 双段，这里退化为单段普通 Mesh） ─────

export class BatchedMapMesh extends Mesh {
  constructor(geometry, material, triangles, nearParts, lodParts, boxMin, boxMax, detail) {
    super(geometry, material);
    this.name = 'CS2MapChunk';
    this.triangles = triangles;
    this.visibleTriangles = 0;
    this.nearParts = nearParts;
    this.lodParts = lodParts;
    this.boxMin = boxMin;
    this.boxMax = boxMax;
    this.detail = detail;
    this.objectId = 0;
    this.movable = false;
    this.objectHidden = false;
    // 原版 multi-draw 的占位字段（update/uploadGeometry 会用到）
    this._multiDrawStarts = new Uint32Array(1);
    this._multiDrawCounts = new Uint32Array(1);
    this._multiDrawCount = 0;
    this._multiDrawInstances = null;
    // 剔除用包围球（局部空间，位置是 0..65535 的量化坐标）
    this.sphere = new Sphere(new Vector3(32767.5, 32767.5, 32767.5), 32767.5 * Math.sqrt(3));
  }
}

// ── 视锥剔除（原件 Fv 配套的 MapCuller；PVS 部分保留接口） ───────────────────

const _sphereWorld = new Sphere();
const _mat = new Matrix4();

/** 极简视锥（6 平面），接口与 three 的 Frustum 一致的部分只保留 intersectsSphere */
class MiniFrustum {
  constructor() {
    // 每平面存 (nx, ny, nz, d)，平面朝内法线
    this.planes = Array.from({ length: 6 }, () => new Float64Array(4));
  }

  /** 从 projectionMatrix × matrixWorldInverse 提取 6 个裁剪平面 */
  setFromProjectionMatrix(m) {
    const e = m.elements;
    const p = this.planes;
    const set = (i, a, b, c, d) => {
      const len = Math.hypot(a, b, c) || 1;
      p[i][0] = a / len; p[i][1] = b / len; p[i][2] = c / len; p[i][3] = d / len;
    };
    set(0, e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]); // left
    set(1, e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]); // right
    set(2, e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]); // bottom
    set(3, e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]); // top
    set(4, e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]); // near
    set(5, e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]); // far
    return this;
  }

  intersectsSphere(sphere) {
    const { center, radius } = sphere;
    for (const plane of this.planes) {
      if (plane[0] * center.x + plane[1] * center.y + plane[2] * center.z + plane[3] < -radius) return false;
    }
    return true;
  }
}

export class MapCuller {
  constructor() {
    this.frustum = new MiniFrustum();
    this.camera = new Vector3();
    this.cells = null;
    this.detailDistance = Infinity;
    this.lodDistance = Infinity;
  }

  setView(camera, group) {
    _mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_mat);
    this.camera.setFromMatrixPosition(camera.matrixWorld);
    this.group = group;
  }

  cull(mesh) {
    if (mesh.movable && mesh.objectHidden) {
      mesh.visible = false;
      mesh._multiDrawCount = 0;
      return;
    }
    _sphereWorld.copy(mesh.sphere).applyMatrix4(mesh.matrixWorld);
    let visible = this.frustum.intersectsSphere(_sphereWorld);
    if (visible && mesh.detail) {
      visible = this.camera.distanceToSquared(_sphereWorld.center) <= this.detailDistance * this.detailDistance;
    }
    mesh.visible = visible;
    if (visible) {
      const lod = _sphereWorld.center.distanceToSquared(this.camera) > this.lodDistance * this.lodDistance;
      const start = lod && mesh.lodParts ? mesh.lodParts.firstIndex : 0;
      mesh._multiDrawStarts[0] = start;
      mesh._multiDrawCounts[0] = Math.min(3, mesh.geometry.index ? mesh.geometry.index.count : 0);
      mesh._multiDrawCount = 1;
      mesh.visibleTriangles = mesh.triangles;
    } else {
      mesh._multiDrawCount = 0;
      mesh.visibleTriangles = 0;
    }
  }
}

export { Vector2 };
