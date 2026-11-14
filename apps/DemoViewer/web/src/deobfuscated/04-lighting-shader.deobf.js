// ─────────────────────────────────────────────────────────────────────────────
// 04-lighting-shader.deobf.js — 自研光照系统：探针网格 + PBR shader + CS2 地图加载器
//
// 来源：src/app/04-lighting-shader.js（Vite 生产构建，prettier 展开版）
// 原始压缩名：zv = LightGrid，Wv = buildProbeVolumeGrid，Gv = nearestProbeBox，
//             qv/Jv/Yv/Xv/Zv/Qv/$v = GLSL 代码块，oy/sy = tone mapping，
//             uy = PVSVisibility，vy = CS2MapRenderer
//
// 本文件是 csdemo.tv 渲染管线的核心，包含：
//   1. LightGrid（zv）—— 运行时从烘焙的光照网格采样环境光 + 太阳可见性（三线性插值）。
//   2. buildProbeVolumeGrid（Wv）—— 把探针体积打包成 GPU 纹理（probe data 2D 纹理 +
//      probe 索引 3D 网格 + SH 归一化数据）。
//   3. 一套自研 GLSL：PBR 直接光（GGX + Valve 可见性 + 多散射增强）、
//      图像法间接高光（split-sum 解析拟合 + SH 归一化）、视差校正探针采样、
//      梯度雾、CS2 专属 ACES 风格 tone mapping。
//   4. PVSVisibility（uy）—— 预计算可见性（PVS）BSP 树查询。
//   5. CS2MapRenderer（vy）—— CS2 地图包（cs2render 格式）的完整加载器：
//      下载/解压材质、探针、LUT、可见性、天空、几何 chunk，构建批量网格，
//      编译材质 + 深度材质，逐帧剔除。
//
// 说明：标识符已重命名成语义化名字，局部单字母变量展开，关键逻辑补注释。
//       由于 GLSL 字符串和大量 three.js 类型名（Color/Vector3/Matrix4 等）无法
//       安全重命名，shader 原文保留（仅加注释）。未改任何语义。
// ─────────────────────────────────────────────────────────────────────────────

// ── 光照网格（zv / LightGrid） ────────────────────────────────────────────────

/**
 * 从烘焙的光照网格（light grid）采样环境光与太阳可见性。
 *
 * 数据布局：三张 3D 网格 —— luma（亮度，1 通道）、chroma（色度，2 通道）、
 * sun（太阳可见性，1 通道）。每个网格用三线性插值，luma 用指数表还原线性值，
 * chroma 用 YCoCg 反解为 RGB。
 */
class LightGrid {
  constructor(meta, data) {
    this.data = data;
    this.origin = meta.origin;

    const makePlane = (planeMeta, offset) => ({
      dims: planeMeta.dims,
      invCell: [1 / planeMeta.cell[0], 1 / planeMeta.cell[1], 1 / planeMeta.cell[2]],
      offset,
      planeSize: planeMeta.dims[0] * planeMeta.dims[1] * planeMeta.dims[2],
    });

    this.luma = makePlane(meta.luma, 0);
    this.chroma = makePlane(meta.chroma, this.luma.planeSize * 6);
    this.sun = makePlane(meta.sun, this.chroma.offset + this.chroma.planeSize * 12);

    const expectedBytes = this.sun.offset + this.sun.planeSize;
    if (data.length < expectedBytes) throw Error(`light grid is ${data.length} bytes, expected ${expectedBytes}`);

    // 亮度指数表：luma 值 = 2^((index - bias) / steps)
    for (let i = 1; i < 256; i++) this.lumaTable[i] = 2 ** ((i - meta.luma.bias) / meta.luma.steps);
  }

  /** 加载（支持 gzip 解压） */
  static async load(meta, bytes) {
    let data = new Uint8Array(bytes);
    if (data[0] === 0x1f && data[1] === 0x8b) {
      // gzip 魔数
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return new LightGrid(meta, data);
  }

  /** 采样位置 (x,y,z) 处的光照，写入 result（6 个面的环境光 + sunVisibility） */
  sample(x, y, z, result) {
    const data = this.data;
    const lumaCorners = this.lumaCorners;
    this.locate(this.luma, x, y, z, lumaCorners);
    const chromaCorners = this.corners;
    this.locate(this.chroma, x, y, z, chromaCorners);

    // 6 个面（±X/±Y/±Z）
    for (let face = 0; face < 6; face++) {
      let lumaSum = 0;
      const lumaBase = this.luma.offset + face * this.luma.planeSize;
      for (let corner = 0; corner < 8; corner++) {
        lumaSum += lumaCorners.weight[corner] * this.lumaTable[data[lumaBase + lumaCorners.index[corner]]];
      }

      // chroma 存 YCoCg（两通道：Co、Cg）
      let co = 0;
      let cg = 0;
      const coBase = this.chroma.offset + face * 2 * this.chroma.planeSize;
      const cgBase = coBase + this.chroma.planeSize;
      for (let corner = 0; corner < 8; corner++) {
        co += chromaCorners.weight[corner] * data[coBase + chromaCorners.index[corner]];
        cg += chromaCorners.weight[corner] * data[cgBase + chromaCorners.index[corner]];
      }
      co /= 255;
      cg /= 255;

      // YCoCg → RGB：R = Y + Co - Cg, G = Y + Cg, B = Y - Co - Cg
      const y = Math.max(0, 1 - co - cg);
      // 用亮度权重归一化，使总亮度匹配 luma
      const scale = lumaSum / Math.max(1e-4, LUMA_R * co + LUMA_G * cg + LUMA_B * y);

      result.ambient[face * 3] = co * scale;
      result.ambient[face * 3 + 1] = cg * scale;
      result.ambient[face * 3 + 2] = y * scale;
    }

    // 太阳可见性
    const sunCorners = this.corners;
    this.locate(this.sun, x, y, z, sunCorners);
    let sunSum = 0;
    for (let corner = 0; corner < 8; corner++) {
      sunSum += sunCorners.weight[corner] * data[this.sun.offset + sunCorners.index[corner]];
    }
    result.sunVisibility = sunSum / 255;
  }

  /** 定位位置在网格中的 8 个角，计算索引与三线性插值权重 */
  locate(plane, x, y, z, out) {
    const [dx, dy, dz] = plane.dims;
    // 世界坐标 → 网格坐标（偏移 0.5 使采样点位于体素中心）
    const cx = clampCoord((x - this.origin[0]) * plane.invCell[0] - 0.5, 0, dx - 1);
    const cy = clampCoord((y - this.origin[1]) * plane.invCell[1] - 0.5, 0, dy - 1);
    const cz = clampCoord((z - this.origin[2]) * plane.invCell[2] - 0.5, 0, dz - 1);

    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    const iz = Math.floor(cz);
    const fx = cx - ix;
    const fy = cy - iy;
    const fz = cz - iz;

    const mx = Math.min(ix + 1, dx - 1);
    const my = Math.min(iy + 1, dy - 1);
    const mz = Math.min(iz + 1, dz - 1);

    for (let corner = 0; corner < 8; corner++) {
      const px = corner & 1 ? mx : ix;
      const py = corner & 2 ? my : iy;
      const pz = corner & 4 ? mz : iz;
      out.index[corner] = (pz * dy + py) * dx + px;
      out.weight[corner] =
        (corner & 1 ? fx : 1 - fx) * (corner & 2 ? fy : 1 - fy) * (corner & 4 ? fz : 1 - fz);
    }
    return out;
  }
}

const LUMA_R = 0.2125;
const LUMA_G = 0.7154;
const LUMA_B = 0.0721;

function clampCoord(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// ── 探针体积网格打包（Wv / buildProbeVolumeGrid） ─────────────────────────────

const MAX_PROBE_VOLUMES = 255;
const MAX_GRID_DIM = 128; // 网格每维最大单元数
const CELL_SIZE = 128; // 单元尺寸

/**
 * 把多个探针体积打包成 GPU 可用的纹理：
 *   - data: 每体积 7 行 4 分量的 2D 纹理（worldToLocal 3 行 + mins/maxs/invEdge/归一化 SH）
 *   - grid: 3D 纹理，每个 cell 存 2×4 个探针候选索引（每候选 1 字节）
 * 同时返回世界空间包围盒列表（用于 fallback 探针选择）。
 */
function buildProbeVolumeGrid(volumes, bounds) {
  if (volumes.length >= MAX_PROBE_VOLUMES) throw Error(`too many probe volumes (${volumes.length})`);

  const data = new Float32Array(28 * Math.max(1, volumes.length));
  const boxes = [];
  const mat = new Matrix4();
  const matInv = new Matrix4();
  const tmpVec = new Vector3();

  volumes.forEach((volume, i) => {
    const s = volume.worldToLocal;
    const base = i * 7 * 4;
    // 每体积 7 行 × 4 分量：3 行 worldToLocal（含平移），mins、maxs、invEdge、归一化 SH
    data.set([s[0], s[1], s[2], s[9]], base);
    data.set([s[3], s[4], s[5], s[10]], base + 4);
    data.set([s[6], s[7], s[8], s[11]], base + 8);
    data.set([...volume.boxMins, volume.slot], base + 12);
    data.set([...volume.boxMaxs, 0], base + 16);
    data.set([...volume.invEdge, 0], base + 20);
    data.set(volume.normalizationSH, base + 24);

    mat.set(
      s[0], s[3], s[6], s[9],
      s[1], s[4], s[7], s[10],
      s[2], s[5], s[8], s[11],
      0, 0, 0, 1,
    );
    matInv.copy(mat).invert();

    // 计算体积的世界包围盒
    const box = new Box3();
    for (let corner = 0; corner < 8; corner++) {
      tmpVec
        .set(
          corner & 1 ? volume.boxMaxs[0] : volume.boxMins[0],
          corner & 2 ? volume.boxMaxs[1] : volume.boxMins[1],
          corner & 4 ? volume.boxMaxs[2] : volume.boxMins[2],
        )
        .applyMatrix4(matInv);
      box.expandByPoint(tmpVec);
    }
    boxes.push(box);
  });

  // 网格范围
  const origin = new Vector3(...bounds.min).subScalar(1);
  const extent = new Vector3(...bounds.max).addScalar(1).sub(origin);
  const dims = new Vector3(
    Math.min(MAX_GRID_DIM, Math.max(1, Math.ceil(extent.x / CELL_SIZE))),
    Math.min(MAX_GRID_DIM, Math.max(1, Math.ceil(extent.y / CELL_SIZE))),
    Math.min(MAX_GRID_DIM, Math.max(1, Math.ceil(extent.z / CELL_SIZE))),
  );
  const cellSize = extent.clone().divide(dims);

  const dx = dims.x;
  const dy = dims.y;
  const dz = dims.z;

  // grid：每个 cell 存 2 组 × 4 候选（RGBA8，2 个 texel）
  const grid = new Uint8Array(dx * 2 * dy * dz * 4).fill(MAX_PROBE_VOLUMES);
  const overflowCounts = new Uint8Array(dx * dy * dz);
  let overflowCells = 0;

  boxes.forEach((box, volumeIndex) => {
    const minX = Math.max(0, Math.floor((box.min.x - origin.x) / cellSize.x));
    const minY = Math.max(0, Math.floor((box.min.y - origin.y) / cellSize.y));
    const minZ = Math.max(0, Math.floor((box.min.z - origin.z) / cellSize.z));
    const maxX = Math.min(dx - 1, Math.floor((box.max.x - origin.x) / cellSize.x));
    const maxY = Math.min(dy - 1, Math.floor((box.max.y - origin.y) / cellSize.y));
    const maxZ = Math.min(dz - 1, Math.floor((box.max.z - origin.z) / cellSize.z));

    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const cellIndex = (cz * dy + cy) * dx + cx;
          const count = overflowCounts[cellIndex];
          if (count >= 8) {
            if (count === 8) {
              overflowCells++;
              overflowCounts[cellIndex] = 9; // 标记溢出
            }
            continue;
          }
          // 每 cell 2 个 texel（x*2 与 x*2+1），每 texel 4 个候选
          const texelOffset = (cz * dy + cy) * dx * 2 + cx * 2 + (count >> 2);
          grid[texelOffset * 4 + (count & 3)] = volumeIndex;
          overflowCounts[cellIndex] = count + 1;
        }
      }
    }
  });

  const probeData = new DataTexture(data, 7, Math.max(1, volumes.length), RGBAFormat, FloatType);
  probeData.minFilter = probeData.magFilter = NearestFilter;
  probeData.generateMipmaps = false;
  probeData.needsUpdate = true;

  const probeGrid = new Data3DTexture(grid, dx * 2, dy, dz);
  probeGrid.format = RGBAFormat;
  probeGrid.type = UnsignedByteType;
  probeGrid.minFilter = probeGrid.magFilter = NearestFilter;
  probeGrid.generateMipmaps = false;
  probeGrid.unpackAlignment = 1;
  probeGrid.needsUpdate = true;

  return { data: probeData, grid: probeGrid, origin, cellSize, dims, boxes, overflowCells };
}

/** 找距离点最近的探针体积索引（fallback 用） */
function nearestProbeBox(boxes, point) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const dist = boxes[i].distanceToPoint(point);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
      if (dist === 0) break;
    }
  }
  return best;
}

/** 根据材质特性生成 shader defines */
function materialDefines(opts) {
  const defines = {};
  if (opts.blend) defines.CS2_BLEND = '';
  if (opts.alphaTest) defines.CS2_ALPHATEST = '';
  if (opts.translucent) defines.CS2_TRANSLUCENT = '';
  if (opts.doubleSided) defines.CS2_DOUBLE_SIDED = '';
  if (opts.movable) defines.CS2_MOVABLE = '';
  return defines;
}

// ── GLSL 代码块 ───────────────────────────────────────────────────────────────

// 通用工具（saturate / luma / max3）
const GLSL_COMMON = `
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif

float luma(vec3 c) {
  return dot(c, vec3(0.2125, 0.7154, 0.0721));
}

float max3(vec3 v) {
  return max(max(v.x, v.y), v.z);
}
`;

// 探针相关 uniform 声明
const GLSL_PROBE_UNIFORMS = `
uniform highp sampler2DArray uProbes;
uniform highp sampler2D uProbeData;
uniform highp sampler3D uProbeGrid;
uniform vec3 uGridOrigin;
uniform vec3 uGridInvCell;
uniform ivec3 uGridMax;
uniform float uProbeMaxLod;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec4 uFogParams;   // distance scale, distance bias, height scale, height bias
uniform vec3 uFogShape;    // distance exponent, height exponent, max opacity
`;

// 环境采样 / BRDF / 直接光 / 间接光 / 雾
const GLSL_LIGHTING = `
vec2 octEncode(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 p = n.xy;
  if (n.z < 0.0) p = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return p * 0.5 + 0.5;
}

// Karis 对 split-sum 表的解析拟合：x = F0=0 的反射率，y = F0=1（VRF lut 布局）
vec2 envBrdfApprox(float roughness, float NoV) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
  return vec2(ab.y, ab.x + ab.y);
}

struct ProbeResult {
  vec3 radiance;
  vec4 normalizationSH;
};

// 采样单个探针（带视差校正 + 盒衰减）
vec3 probeSample(int row, vec3 position, vec3 R, float lod, bool boxed, out float weight, out vec4 sh) {
  vec4 c0 = texelFetch(uProbeData, ivec2(0, row), 0);
  vec4 c1 = texelFetch(uProbeData, ivec2(1, row), 0);
  vec4 c2 = texelFetch(uProbeData, ivec2(2, row), 0);
  vec4 mins = texelFetch(uProbeData, ivec2(3, row), 0);
  vec4 maxs = texelFetch(uProbeData, ivec2(4, row), 0);
  mat3 toLocal = mat3(c0.xyz, c1.xyz, c2.xyz);
  vec3 local = toLocal * position + vec3(c0.w, c1.w, c2.w);
  weight = 1.0;
  sh = vec4(0.0);
  if (boxed) {
    if (any(lessThan(local, mins.xyz)) || any(greaterThan(local, maxs.xyz))) {
      weight = 0.0;
      return vec3(0.0);
    }
    vec3 invEdge = texelFetch(uProbeData, ivec2(5, row), 0).xyz;
    vec3 fadeMax = saturate((maxs.xyz - local) * invEdge);
    vec3 fadeMin = saturate((local - mins.xyz) * invEdge);
    float edge = min(min(fadeMin.x, min(fadeMin.y, fadeMin.z)), min(fadeMax.x, min(fadeMax.y, fadeMax.z)));
    weight = edge * edge * (3.0 - 2.0 * edge);
    if (weight <= 0.0) return vec3(0.0);
  }
  sh = texelFetch(uProbeData, ivec2(6, row), 0);
  vec3 localR = toLocal * R;
  // 对探针盒做视差校正
  vec3 first = (mins.xyz - local) / localR;
  vec3 second = (maxs.xyz - local) / localR;
  vec3 furthest = max(first, second);
  float distance = abs(min(furthest.x, min(furthest.y, furthest.z)));
  vec3 dir = normalize(local + localR * distance);
  return textureLod(uProbes, vec3(octEncode(dir), mins.w), lod).rgb;
}

// 采样环境（多探针加权混合，失败则回退到 fallback 探针）
ProbeResult sampleEnvironment(vec3 position, vec3 R, float lod, int fallbackRow) {
  ProbeResult result;
  result.radiance = vec3(0.0);
  result.normalizationSH = vec4(0.0);
  float total = 0.01;
  bool searching = true;
  ivec3 cell = clamp(ivec3(floor((position - uGridOrigin) * uGridInvCell)), ivec3(0), uGridMax);
  for (int t = 0; t < 2 && searching; t++) {
    vec4 candidates = texelFetch(uProbeGrid, ivec3(cell.x * 2 + t, cell.y, cell.z), 0);
    for (int k = 0; k < 4 && searching; k++) {
      int row = int(candidates[k] * 255.0 + 0.5);
      if (row == 255) {
        searching = false;
        break;
      }
      float weight;
      vec4 sh;
      vec3 radiance = probeSample(row, position, R, lod, true, weight, sh);
      if (weight <= 0.0) continue;
      weight *= 1.0 - total;
      total += weight;
      result.radiance += radiance * weight;
      result.normalizationSH += sh * weight;
      if (total > 0.99) searching = false;
    }
  }
  if (total <= 0.01) {
    float weight;
    vec4 sh;
    result.radiance = probeSample(fallbackRow, position, R, lod, false, weight, sh);
    result.normalizationSH = sh;
    return result;
  }
  result.normalizationSH /= max(total, 1e-4);
  return result;
}

// 方向光（GGX + Valve 可见性项 + 多散射增强）；L 指向光源
void directLight(vec3 N, vec3 V, vec3 L, float NoV, float roughness, vec3 specColor, vec3 lightColor, out vec3 diffuse, out vec3 specular) {
  diffuse = vec3(0.0);
  specular = vec3(0.0);
  float NoL = dot(N, L);
  if (NoL <= 0.0 || max3(lightColor) <= 0.0) return;
  vec3 H = normalize(V + L);
  float NoH = saturate(dot(N, H));
  float VoH = saturate(dot(V, H));
  float a = max(roughness * roughness, 1e-4);
  float k = min(a / (1.0 - NoH * NoH + NoH * NoH * a * a), 453.5);
  float D = k * k;
  float kv = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float vis = 1.0 / (4.0 * max((NoL * (1.0 - kv) + kv) * (NoV * (1.0 - kv) + kv), 1e-4));
  vec3 F = specColor + (1.0 - specColor) * pow(1.0 - VoH, 5.0);
  diffuse = lightColor * NoL;
  specular = lightColor * (D * vis * NoL) * F;
  specular *= 1.0 + specColor * (0.125 * pow(2.0 * roughness, 4.0) * NoV);
}

// split-sum 图像法高光（对烘焙辐照度归一化）+ 能量守恒漫反射
void indirectLight(ProbeResult env, vec3 irradiance, vec3 N, float roughness, float NoV, vec3 specColor, out vec3 specular, out vec3 diffuse) {
  vec2 brdf = envBrdfApprox(roughness, NoV);
  vec3 single = mix(vec3(brdf.x), vec3(brdf.y), specColor);
  float energyMissing = 1.0 - brdf.y;
  vec3 averageFresnel = specColor + (1.0 - specColor) * (1.0 / 21.0);
  vec3 multi = single * averageFresnel / (vec3(1.0) - averageFresnel * energyMissing) * energyMissing;
  float bakedLuma = dot(vec4(N, 1.0), env.normalizationSH);
  float normalization = bakedLuma > 0.0 ? min(luma(irradiance) / bakedLuma, max(roughness * 2.0 + 1.0, 1.0)) : 1.0;
  specular = env.radiance * single * normalization + multi * irradiance;
  diffuse = irradiance * max(vec3(1.0) - single - multi, vec3(0.0));
}

// 梯度（距离 × 高度）雾
vec3 applyFog(vec3 color, vec3 position, vec3 eye) {
  vec2 fog = vec2(length(position - eye), position.z);
  fog = pow(clamp(fog * uFogParams.xz + uFogParams.yw, 0.0001, 1.0), uFogShape.xy);
  return mix(color, uFogColor, fog.x * fog.y * uFogShape.z);
}
`;

// 主顶点 shader
const GLSL_VERTEX = `
precision highp float;
precision highp int;

attribute vec4 aPos;   // u16 量化位置（model 矩阵缩放），w = 材质行
attribute vec4 aNrm;   // u8: octahedral 法线 xy、flags、probe slot
attribute vec4 aUv;    // 层 1 uv（xy），层 2 uv（zw）
attribute vec2 aLm;    // lightmap uv（u16）或打包的 RGBM 探针辐照度
attribute vec4 aCol;   // 顶点色（归一化）
#ifdef CS2_BLEND
attribute vec4 aBld;   // 混合值（归一化）
attribute vec2 aOvl;   // 共享颜色叠加 uv
#endif

uniform highp sampler2D uMaterials;
#ifdef CS2_MOVABLE
uniform mat3 uObjectRotation;  // 门相对烘焙姿势的旋转
#endif

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vUv;
varying vec4 vLmOvl;
varying vec4 vPaint;          // rgb 顶点色 × 材质顶点 tint，a = 探针光照的太阳可见性
varying vec3 vProbeIrradiance;
#ifdef CS2_BLEND
varying vec4 vBlend;
#endif
flat varying ivec3 vInfo;      // 材质行、探针光照标志、fallback 探针 slot

vec3 octDecode(vec2 f) {
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}

void main() {
  int material = int(aPos.w + 0.5);
  vec4 world = modelMatrix * vec4(aPos.xyz, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;

  vNormal = octDecode((aNrm.xy - 128.0) / 127.0);
#ifdef CS2_MOVABLE
  vNormal = uObjectRotation * vNormal;
#endif
  float flags = aNrm.z;
  int probeLit = int(mod(floor(flags / 2.0), 2.0));
  vInfo = ivec3(material, probeLit, int(aNrm.w + 0.5));

  vUv = aUv;
  vec2 lm = aLm / 65535.0;
  vProbeIrradiance = vec3(0.0);
  if (probeLit == 1) {
    // aLm 打包了 RGBM 辐照度
    vec4 rgbm = vec4(mod(aLm.x, 256.0), floor(aLm.x / 256.0), mod(aLm.y, 256.0), floor(aLm.y / 256.0)) / 255.0;
    vProbeIrradiance = rgbm.rgb * rgbm.a * 16.0;
    lm = vec2(0.0);
  }
  vLmOvl.xy = lm;
  vLmOvl.zw = vec2(0.0);

  vec4 t2 = texelFetch(uMaterials, ivec2(2, material), 0);
  vPaint.rgb = mix(vec3(1.0), aCol.rgb, aCol.a) * t2.rgb;
  vPaint.a = floor(flags / 4.0) / 63.0;

#ifdef CS2_BLEND
  vec4 t4 = texelFetch(uMaterials, ivec2(4, material), 0);
  vBlend = aBld;
  vBlend.w = clamp(aBld.w + t4.x, 0.001, 1.0);
  vLmOvl.zw = aOvl;
#endif
}
`;

// 主片元 shader
const GLSL_FRAGMENT = `
precision highp float;
precision highp int;

${GLSL_COMMON}

uniform highp sampler2D uMaterials;
uniform highp sampler2DArray uColor1;
uniform highp sampler2DArray uNormal1;
uniform highp sampler2DArray uMask1;
#ifdef CS2_BLEND
uniform highp sampler2DArray uColor2;
uniform highp sampler2DArray uNormal2;
uniform highp sampler2DArray uMask2;
uniform highp sampler2DArray uOverlay;
#endif
uniform highp sampler2D uLmIrradiance;
uniform highp sampler2D uLmDirectional;
uniform highp sampler2D uLmShadows;
${GLSL_PROBE_UNIFORMS}

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vUv;
varying vec4 vLmOvl;
varying vec4 vPaint;
varying vec3 vProbeIrradiance;
#ifdef CS2_BLEND
varying vec4 vBlend;
#endif
flat varying ivec3 vInfo;

const int FLAG_METAL_TEXTURE = 16;
const int FLAG_SELF_ILLUM = 32;
const int FLAG_COMPLEX = 8;
const int FLAG_MODEL_TINT_1 = 512;
const int FLAG_MODEL_TINT_2 = 1024;
const float REFLECTANCE = 0.04;

${GLSL_LIGHTING}
vec4 materialTexel(int index) {
  return texelFetch(uMaterials, ivec2(index, vInfo.x), 0);
}

vec3 colorizeTint(vec3 albedo, vec3 tint, float amount) {
  vec3 tintNorm = normalize(max(tint, vec3(0.001)));
  float l = luma(albedo);
  float tinted = min(l / luma(tintNorm), 3.0 * l * max3(tint));
  return saturate(mix(albedo, tintNorm * tinted, amount));
}

vec3 unpackNormal(vec2 rg) {
  vec2 xy = rg * 2.0 - 1.0;
  return vec3(xy, sqrt(saturate(1.0 - dot(xy, xy))));
}

void main() {
  vec4 t0 = materialTexel(0);
  vec4 t1 = materialTexel(1);
  int flags = int(t0.w + 0.5);

  vec3 geometricNormal = normalize(vNormal);
#ifdef CS2_DOUBLE_SIDED
  if (!gl_FrontFacing) geometricNormal = -geometricNormal;
#endif

  // ---- 材质（csgo_environment GetMaterial）----
  vec4 color = texture(uColor1, vec3(vUv.xy, t0.x));
  vec4 mask = texture(uMask1, vec3(vUv.xy, t0.x));
  vec3 normalTs = unpackNormal(texture(uNormal1, vec3(vUv.xy, t0.x)).rg);
  float tintMask1 = mask.b;
  float roughness = mask.r;
  float ao = mask.g;
  float layerTint1 = (flags & FLAG_MODEL_TINT_1) != 0 ? 1.0 : 0.0;
  color.rgb = colorizeTint(color.rgb, t1.rgb, t1.w * tintMask1 * layerTint1);

#ifdef CS2_BLEND
  vec4 t3 = materialTexel(3);
  vec4 t4 = materialTexel(4);
  vec4 t5 = materialTexel(5);
  vec4 color2 = texture(uColor2, vec3(vUv.zw, t0.y));
  vec4 mask2 = texture(uMask2, vec3(vUv.zw, t0.y));
  vec3 normalTs2 = unpackNormal(texture(uNormal2, vec3(vUv.zw, t0.y)).rg);
  float tintMask2 = mask2.b;
  float layerTint2 = (flags & FLAG_MODEL_TINT_2) != 0 ? 1.0 : 0.0;
  color2.rgb = colorizeTint(color2.rgb, t1.rgb, t1.w * tintMask2 * layerTint2);

  // GetBlendWeights（legacy 高度混合）
  float soft = vBlend.w;
  float h1 = t3.x + soft;
  float height1 = (mask.a - t3.z) * h1;
  float h2 = t3.y + soft;
  float h22 = (mask2.a - t3.w) * (t3.y - soft);
  float blend1 = (-t3.z * h1 - (1.0 - t3.w) * h2) - soft;
  float blend2 = (1.0 - t3.z) * h1 + t3.w * h2;
  float h2x = h22 + mix(blend1, blend2, vBlend.x);
  vec2 weights = max(vec2(height1, h2x) - vec2(max(height1, h2x) - soft), vec2(0.0));
  weights.x += 0.001;
  weights /= weights.x + weights.y;
  float w2 = weights.y;

  normalTs = normalize(mix(normalTs, normalTs2, w2));
  color.rgb = mix(color.rgb, color2.rgb, w2);
  roughness = mix(roughness, mask2.r, w2);
  ao = mix(ao, mask2.g, w2);
  float share2 = w2;
  float share1 = saturate(1.0 - share2);

  if (t0.z >= 0.0) {
    vec3 overlay = texture(uOverlay, vec3(vLmOvl.zw, t0.z)).rgb * 2.0 - 1.0;
    float bc = t5.x;
    float dc = t5.y;
    vec3 factor = max(vec3(0.0), vec3(1.0)
      + (vec3(1.0) - pow(max(vec3(1.0) - max(vec3(0.0), overlay), vec3(1e-6)), vec3(bc))) * bc
      + (pow(max(vec3(1.0) + min(vec3(0.0), overlay), vec3(1e-6)), vec3(dc)) - vec3(1.0)) * dc);
    color.rgb *= mix(vec3(1.0), factor, saturate(share1 + share2));
  }

  float mode1 = t4.y;
  float mode2 = t4.z;
  float masked = tintMask1 * share1 + tintMask2 * share2;
  float unmasked = float(mode1 != 0.0) * share1 + float(mode2 != 0.0) * share2;
  float enabled = float(mode1 != 2.0) * share1 + float(mode2 != 2.0) * share2;
  color.rgb *= mix(vec3(1.0), vPaint.rgb, saturate(saturate(masked + unmasked) * enabled));
  float metalness = 0.0;
#else
  vec4 t5 = materialTexel(5);
  // 复杂 shader 把实例 tint 折叠进顶点色
  vec3 vertexTint = (flags & FLAG_COMPLEX) != 0 ? vPaint.rgb * materialTexel(7).rgb : vPaint.rgb;
  color.rgb *= mix(vec3(1.0), vertexTint, tintMask1);
  float metalness = (flags & FLAG_METAL_TEXTURE) != 0 ? mask.a : t5.z;
#endif

  float opacity = 1.0;
#ifdef CS2_ALPHATEST
  float alphaRef = materialTexel(2).w;
  #ifdef ALPHA_TO_COVERAGE
  opacity = saturate((color.a - alphaRef) / max(fwidth(color.a), 1e-4) + 0.5);
  if (opacity <= 0.0) discard;
  #else
  if (color.a < alphaRef) discard;
  #endif
#endif
#ifdef CS2_TRANSLUCENT
  opacity = saturate(color.a * t5.w);
#endif

  // ---- 表面框架：导数余切框架（不存切线）----
  vec3 dp1 = dFdx(vWorldPos);
  vec3 dp2 = dFdy(vWorldPos);
  vec2 duv1 = dFdx(vUv.xy);
  vec2 duv2 = dFdy(vUv.xy);
  vec3 dp2perp = cross(dp2, geometricNormal);
  vec3 dp1perp = cross(geometricNormal, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invMax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
  vec3 N = normalize(T * (normalTs.x * invMax) + B * (normalTs.y * invMax) + geometricNormal * normalTs.z);

  // 几何高光抗锯齿 + 曲率估计
  vec3 dn1 = dFdx(geometricNormal);
  vec3 dn2 = dFdy(geometricNormal);
  roughness = max(roughness, sqrt(saturate(max(dot(dn1, dn1), dot(dn2, dn2)))));
  roughness = clamp(roughness, 0.02, 1.0);

  vec3 diffuseColor = color.rgb * (1.0 - metalness);
  vec3 specColor = mix(vec3(REFLECTANCE), color.rgb, metalness);

  vec3 V = normalize(cameraPosition - vWorldPos);
  float NoV = max(dot(N, V), 1e-4);

  // ---- 烘焙间接漫反射 + 太阳可见性 ----
  vec3 irradiance;
  float sunVisibility;
  float specularOcclusion = 1.0;
  if (vInfo.y == 1) {
    irradiance = vProbeIrradiance;
    sunVisibility = vPaint.a;
  } else {
    vec2 lmUv = vLmOvl.xy;
    vec3 lmColor = texture(uLmIrradiance, lmUv).rgb;
    vec4 lmDir = texture(uLmDirectional, lmUv);
    sunVisibility = 1.0 - texture(uLmShadows, lmUv).r;
    specularOcclusion = lmDir.a;

    const float MAX_XY = 0.99619;  // sqrt(1 - 0.0872^2)
    vec2 xy = lmDir.xy * 2.0 - 1.0;
    float len = length(xy);
    if (len > MAX_XY) xy *= MAX_XY / len;
    float cosTheta = sqrt(saturate(1.0 - dot(xy, xy)));
    float curvature = length(fwidth(geometricNormal)) / max(length(fwidth(vWorldPos)), 1e-4);
    float flatness = smoothstep(0.1, 0.01, curvature) * 0.8;
    float zScale = mix(1.0, mix(0.1, 2.0, saturate((1.0 - cosTheta) * 1.5)), flatness);
    vec3 L = normalize(vec3(xy, cosTheta * zScale));
    vec3 nonDirectional = lmColor * saturate(lmDir.z);
    irradiance = max(dot(L, normalTs), 0.0) * (lmColor - nonDirectional) / max(L.z, 0.05) + nonDirectional;
  }

  // ---- 太阳（带烘焙可见性的固定光）----
  vec3 sunDiffuse;
  vec3 sunSpecular;
  directLight(N, V, uSunDir, NoV, roughness, specColor, uSunColor * sunVisibility, sunDiffuse, sunSpecular);

  // ---- 图像法高光 ----
  vec3 R = normalize(reflect(-V, N));
  float r2 = roughness * roughness;
  float smoothness = saturate(1.0 - r2);
  float dominant = smoothness * (sqrt(smoothness) + r2);
  R = normalize(mix(N, R, dominant));
  ProbeResult env = sampleEnvironment(vWorldPos, R, sqrt(roughness) * uProbeMaxLod, vInfo.z);

  vec3 specularIndirect;
  vec3 diffuseIndirect;
  indirectLight(env, irradiance, N, roughness, NoV, specColor, specularIndirect, diffuseIndirect);

  // ---- 组合（ApplyAmbientOcclusion）----
  vec3 diffuse = (sunDiffuse + diffuseIndirect) * ao;
  vec3 specular = sunSpecular + specularIndirect * min(specularOcclusion, ao);
  vec3 outColor = diffuseColor * diffuse + specular;

#ifndef CS2_BLEND
  if ((flags & FLAG_SELF_ILLUM) != 0) {
    vec4 t6 = materialTexel(6);
    float selfIllumMask = (flags & FLAG_METAL_TEXTURE) != 0 ? 1.0 : mask.a;
    outColor += t6.rgb * mix(vec3(1.0), color.rgb, t6.w) * selfIllumMask;
  }
#endif

  // ---- 梯度雾 ----
  outColor = applyFog(outColor, vWorldPos, cameraPosition);

  gl_FragColor = vec4(outColor, opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// 深度 pre-pass 顶点/片元
const GLSL_DEPTH_VERTEX = `
precision highp float;
precision highp int;

attribute vec4 aPos;
#ifdef CS2_ALPHATEST
attribute vec4 aUv;
varying vec2 vUv;
flat varying int vMaterial;
#endif

void main() {
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(aPos.xyz, 1.0));
#ifdef CS2_ALPHATEST
  vUv = aUv.xy;
  vMaterial = int(aPos.w + 0.5);
#endif
}
`;

const GLSL_DEPTH_FRAGMENT = `
precision highp float;
precision highp int;

#ifdef CS2_ALPHATEST
uniform highp sampler2D uMaterials;
uniform highp sampler2DArray uColor1;
varying vec2 vUv;
flat varying int vMaterial;
#endif

void main() {
#ifdef CS2_ALPHATEST
  float layer = texelFetch(uMaterials, ivec2(0, vMaterial), 0).x;
  float alphaRef = texelFetch(uMaterials, ivec2(2, vMaterial), 0).w;
  if (texture(uColor1, vec3(vUv, layer)).a < alphaRef) discard;
#endif
  gl_FragColor = vec4(0.0);
}
`;

// ── Tone mapping（CS2 专属 ACES 风格） ─────────────────────────────────────────

const TONEMAP_EXPOSURE_BIAS = -0.4;
const TONEMAP_STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
let tonemappingParsCached = null; // ny
let lastToneMappingCode = null; // ry

/** 把数值格式化成 GLSL 字面量（保证小数点） */
function glslFloat(value) {
  const s = Number.isFinite(value) ? value.toPrecision(7) : '0.0';
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** 把 LUT 字节数组转成 GLSL 的 vec3 数组字面量 */
function lutToGLSL(bytes, size) {
  const result = [];
  for (let i = 0; i < size; i++) {
    const offset = ((i * size + i) * size + i) * 4;
    result.push([bytes[offset] / 255, bytes[offset + 1] / 255, bytes[offset + 2] / 255]);
  }
  return result;
}

/** 生成 CS2 tone mapping 的 GLSL 代码 */
function buildToneMappingCode(grade, lut) {
  const tonemap = grade.tonemap;
  const whitePoint = tonemap.whitePoint * 2.8;
  const f = (x) =>
    (x * (tonemap.shoulderStrength * x + tonemap.linearStrength * tonemap.linearAngle) + tonemap.toeNumerator * tonemap.toeStrength) /
      (x * (tonemap.shoulderStrength * x + tonemap.linearStrength) + tonemap.toeDenominator * tonemap.toeStrength) -
    tonemap.toeNumerator / tonemap.toeDenominator;
  const invWhitePoint = 1 / f(whitePoint);
  const lutArray = lut && lut.length >= 2 ? lut : null;

  return `
vec3 cs2SrgbEncode( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
vec3 cs2SrgbDecode( vec3 c ) {
  return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
}
${
  lutArray
    ? `const vec3 CS2_LUT[${lutArray.length}] = vec3[${lutArray.length}](${lutArray.map((v) => `vec3(${v.map(glslFloat).join(', ')})`).join(', ')});
float cs2LutChannel( float v, int channel ) {
  float f = clamp( v, 0.0, 1.0 ) * ${glslFloat(lutArray.length - 1)};
  int i0 = int( floor( f ) );
  int i1 = min( i0 + 1, ${lutArray.length - 1} );
  return mix( CS2_LUT[ i0 ][ channel ], CS2_LUT[ i1 ][ channel ], f - float( i0 ) );
}`
    : ''
}
vec3 CustomToneMapping( vec3 color ) {
  vec3 x = min( color * ( toneMappingExposure * ${glslFloat(2 ** (tonemap.exposureBias + TONEMAP_EXPOSURE_BIAS) * 2.8)} ), vec3( ${glslFloat(invWhitePoint)} ) );
  vec3 n = x * ( ${glslFloat(tonemap.shoulderStrength)} * x + ${glslFloat(tonemap.linearStrength * tonemap.linearAngle)} ) + ${glslFloat(tonemap.toeNumerator * tonemap.toeStrength)};
  vec3 d = x * ( ${glslFloat(tonemap.shoulderStrength)} * x + ${glslFloat(tonemap.linearStrength)} ) + ${glslFloat(tonemap.toeDenominator * tonemap.toeStrength)};
  vec3 mapped = clamp( ( n / d - ${glslFloat(tonemap.toeNumerator / tonemap.toeDenominator)} ) * ${glslFloat(invWhitePoint)}, 0.0, 1.0 );
${
  lutArray
    ? `  vec3 g = cs2SrgbEncode( mapped );
  mapped = cs2SrgbDecode( vec3( cs2LutChannel( g.r, 0 ), cs2LutChannel( g.g, 1 ), cs2LutChannel( g.b, 2 ) ) );`
    : ''
}
  return mapped;
}`;
}

/**
 * 把生成的 tone mapping 代码注入 three.js 的 tonemapping_pars_fragment。
 * 找到 CustomToneMapping 占位并替换。成功返回 true。
 */
function installToneMapping(grade, lut) {
  const code = buildToneMappingCode(grade, lut);
  if (lastToneMappingCode === null) {
    tonemappingParsCached ??= ShaderChunk.tonemapping_pars_fragment;
    if (tonemappingParsCached.includes(TONEMAP_STUB)) {
      ShaderChunk.tonemapping_pars_fragment = tonemappingParsCached.replace(TONEMAP_STUB, code);
      lastToneMappingCode = code;
      return true;
    }
    console.warn('[cs2map] three CustomToneMapping stub not found; CS2 grading disabled');
    return false;
  }
  return lastToneMappingCode === code;
}

// ── PVS 可见性（uy / PVSVisibility） ─────────────────────────────────────────

// 8 个象限的 bit 索引（用于 BSP 子节点匹配）
const PVS_CELL_OFFSETS = [0, 2, 8, 10, 32, 34, 40, 42];
const PVS_REGION_OFFSETS = [0, 1, 4, 5, 16, 17, 20, 21];

/**
 * 预计算可见性（PVS）BSP 树。给定位置，沿 BSP 树向下定位到叶子，
 * 返回该位置能看到的所有单元格（位图）。
 */
class PVSVisibility {
  constructor(info, buffer) {
    this.info = info;
    this.cellCount = info.cells;
    this.nodes = new Uint32Array(buffer, info.nodes[0], info.nodes[1]);
    this.regions = new Uint32Array(buffer, info.regions[0], info.regions[1]);
    this.masks = new Uint32Array(buffer, info.masks[0], info.masks[1] * 2);
    this.rowIndex = new Uint16Array(buffer, info.rowIndex[0], info.rowIndex[1]);
    this.rows = new Uint8Array(buffer, info.rows[0], info.rows[1] * info.rowBytes);
    this.scratch = new Uint8Array(info.rowBytes);
  }

  /** 返回位置所在的 cluster 索引（-1 表示在 bounds 外） */
  clusterAt(x, y, z) {
    const clusters = [];
    this.clustersAt(x, y, z, clusters);
    return clusters.length ? clusters[0] : -1;
  }

  /** 收集位置命中的所有 cluster（写入 out） */
  clustersAt(x, y, z, out) {
    const { boundsMin, boundsMax } = this.info;
    if (x < boundsMin[0] || y < boundsMin[1] || z < boundsMin[2] || x > boundsMax[0] || y > boundsMax[1] || z > boundsMax[2]) {
      return;
    }

    const mins = [boundsMin[0], boundsMin[1], boundsMin[2]];
    const maxs = [boundsMax[0], boundsMax[1], boundsMax[2]];
    const point = [x, y, z];

    // 计算下一层应该进入哪个子象限
    const stepDown = () => {
      let quadrant = 0;
      for (let axis = 0; axis < 3; axis++) {
        const mid = (mins[axis] + maxs[axis]) * 0.5;
        if (mid < point[axis]) {
          quadrant |= 1 << axis;
          mins[axis] = mid;
        } else {
          maxs[axis] = mid;
        }
      }
      return quadrant;
    };

    const nodes = this.nodes;
    let nodeIndex = 0;
    while (!(nodes[nodeIndex] & 1)) {
      nodeIndex = (nodes[nodeIndex] >>> 9) + stepDown();
    }
    const q1 = stepDown();
    const q2 = stepDown();
    this.matchRegions(nodeIndex, PVS_CELL_OFFSETS[q1] + PVS_REGION_OFFSETS[q2], out);
  }

  /** 返回位置的可见单元格位图（可能为 null） */
  visibleCellsAt(x, y, z) {
    const clusters = [];
    this.clustersAt(x, y, z, clusters);
    if (clusters.length === 0) return null;
    if (clusters.length === 1) return this.visibleCells(clusters[0]);
    const merged = this.scratch;
    merged.fill(0);
    for (const cluster of clusters) {
      const cells = this.visibleCells(cluster);
      if (!cells) return null;
      for (let i = 0; i < cells.length; i++) merged[i] |= cells[i];
    }
    return merged;
  }

  /** 返回某个 cluster 的可见单元格位图 */
  visibleCells(cluster) {
    if (cluster < 0 || cluster >= this.rowIndex.length) return null;
    const rowBytes = this.info.rowBytes;
    const offset = this.rowIndex[cluster] * rowBytes;
    return this.rows.subarray(offset, offset + rowBytes);
  }

  /** 根据节点与象限，把命中的 region 的 cluster 索引写入 out */
  matchRegions(nodeIndex, quadrantMask, out) {
    const totalClusters = this.info.clusters;
    const node = this.nodes[nodeIndex];
    const regionCount = (node >>> 1) & 255;
    const regionBase = node >>> 9;
    const highHalf = +(quadrantMask >= 32);
    const lowBits = quadrantMask & 31;

    for (let i = 0; i < regionCount; i++) {
      const region = this.regions[regionBase + i];
      const cluster = region & 32767;
      if (cluster >= totalClusters) continue;
      const maskIndex = region >>> 15;
      if ((this.masks[maskIndex * 2 + highHalf] >>> lowBits) & 1) out.push(cluster);
    }
  }
}

// ── CS2 地图渲染器（vy / CS2MapRenderer） ─────────────────────────────────────

const DETAIL_DISTANCE = 3200;
const LOD_PIXEL_THRESHOLD = 1;
const MAX_CONCURRENT_FETCH = 6;
const POSITION_QUANTIZE = 65535;
const MAP_FORMAT_VERSION = 5;
let gltfWorkersInitialized = false;
const noopRaycast = () => {};

/**
 * CS2 地图包（cs2render 格式）加载器与渲染器。
 * 负责下载并解析 map.json + 各 buffer，构建批量网格、编译材质，
 * 并在每帧执行 PVS + 视锥 + 细节距离剔除。
 */
class CS2MapRenderer {
  group = new Group();
  renderer;
  manifest = null;
  baseUrl = '';
  lodError = 0;
  generation = 0;
  downloadedBytes = 0;
  drawingBuffer = new Vector2();
  shared = {};
  classUniforms = new Map();
  overlay = { value: null };
  materials = new Map();
  mapTextures = [];
  staticTextures = [];
  geometryRoot = null;
  partMeshes = [];
  objects = [];
  objectMeshes = [];
  objectBoxes = [];
  doorRotations = new Map();
  objectRotations = new Map();
  objectTimeline = null;
  objectRecords = undefined;
  objectPose = { visible: true, pitch: 0, yaw: 0, roll: 0 };
  visibility = null;
  culler = new MapCuller();
  probeBoxes = [];
  lightGrid = null;
  skyTexture = null;
  lastCluster = -1;
  clearListeners = new Set();
  pvsEnabled = true;
  lutCurve = null;

  constructor(renderer) {
    this.renderer = renderer;
    this.group.name = 'CS2Map';
  }

  get loaded() {
    return this.manifest !== null && this.geometryRoot !== null;
  }
  get currentManifest() {
    return this.manifest;
  }
  get stats() {
    let total = 0;
    let visible = 0;
    for (const mesh of this.partMeshes) {
      total += mesh.triangles;
      visible += mesh.visible ? mesh.visibleTriangles : 0;
    }
    return {
      chunks: this.partMeshes.length,
      triangles: total,
      visibleTriangles: visible,
      cluster: this.lastCluster,
      downloadedBytes: this.downloadedBytes,
    };
  }

  async load(mapName, options, onProgress) {
    this.clear();
    const gen = this.generation;
    const key = `map:${mapName}`;
    let packageUrl = await fetchMapPackage(key);
    if (!packageUrl || gen !== this.generation) return false;

    let loaded;
    try {
      loaded = await this.loadFrom(packageUrl, mapName, options, onProgress);
    } catch (err) {
      if (!(await this.packageMoved(key, packageUrl, gen))) throw err;
      loaded = null;
    }
    if (loaded !== null) return loaded;

    const movedUrl = await this.packageMoved(key, packageUrl, gen);
    if (movedUrl) {
      this.clear();
      return (await this.loadFrom(movedUrl, mapName, options, onProgress)) ?? false;
    }
    return false;
  }

  async packageMoved(key, currentUrl, gen) {
    if (gen !== this.generation) return null;
    const movedUrl = await recheckMapPackage(key, currentUrl);
    return gen === this.generation ? movedUrl : null;
  }

  async loadFrom(baseUrl, mapName, options, onProgress) {
    const gen = this.generation;
    this.pvsEnabled = options.visibilityCulling;

    let response;
    try {
      response = await fetch(`${baseUrl}map.json`);
    } catch {
      return false;
    }
    if (response.status === 404) return null;
    if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return false;

    let manifest;
    try {
      manifest = await response.json();
    } catch {
      return false;
    }
    if (gen !== this.generation) return false;
    if (manifest.format !== 'cs2render' || manifest.version !== MAP_FORMAT_VERSION) {
      throw Error(`unsupported CS2 map package (${manifest.format} v${manifest.version})`);
    }

    const missingExts = checkRequiredGLExtensions(this.renderer);
    if (missingExts.length > 0) {
      console.warn(`[cs2map] GPU lacks ${missingExts.join(', ')}; using the classified map`);
      return false;
    }

    this.manifest = manifest;
    this.baseUrl = baseUrl;
    onProgress?.(`Loading ${mapName} lighting…`);
    await this.loadStatic(manifest);
    if (gen !== this.generation) return false;
    onProgress?.(`Loading ${mapName} textures…`);
    await this.loadTextures(manifest, gen);
    if (gen !== this.generation) return false;
    await this.loadGeometry(manifest, gen, (done, total) => onProgress?.(`Loading ${mapName} geometry ${done}/${total}…`));
    if (gen !== this.generation) return false;
    return true;
  }

  /** 安装 tone mapping（注入 three.js shader chunk） */
  installGrading() {
    const manifest = this.manifest;
    if (!manifest) return false;
    return installToneMapping(manifest.post, this.lutCurve);
  }

  /** 返回场景环境（雾/天空/太阳/曝光） */
  sceneEnvironment() {
    const manifest = this.manifest;
    if (!manifest) return null;
    const { sun } = manifest.scene;
    const fog = extractFog(manifest);
    return {
      fogColor: new Color().setRGB(fog.color[0], fog.color[1], fog.color[2], LinearSRGBColorSpace),
      fogStart: fog.start,
      fogEnd: fog.end,
      skyColor: new Color().setRGB(sun.skyColor[0], sun.skyColor[1], sun.skyColor[2], LinearSRGBColorSpace),
      sunDirection: new Vector3(...sun.direction).normalize(),
      sunColor: new Color().setRGB(sun.color[0], sun.color[1], sun.color[2], LinearSRGBColorSpace),
      exposure: manifest.post.exposure,
      sky: this.skyTexture && manifest.sky ? { map: this.skyTexture, vMax: manifest.sky.vMax } : null,
    };
  }

  environmentUniforms() {
    return this.manifest && 'uProbes' in this.shared ? this.shared : null;
  }

  onClear(listener) {
    this.clearListeners.add(listener);
    return () => this.clearListeners.delete(listener);
  }

  fallbackProbeRow(point) {
    return nearestProbeBox(this.probeBoxes, point);
  }

  loadLightGrid() {
    const meta = this.manifest?.lightGrid;
    if (!meta) return Promise.resolve(null);
    this.lightGrid ??= this.fetchBuffer(meta.file)
      .then((bytes) => LightGrid.load(meta, bytes))
      .catch((err) => {
        console.warn('[cs2map] light grid unavailable; dynamic objects use flat lighting', err);
        return null;
      });
    return this.lightGrid;
  }

  async loadStatic(manifest) {
    const [materialsBytes, probesBytes, lutBytes, visibilityBytes, skyBytes] = await Promise.all([
      this.fetchBuffer(manifest.materials.file),
      this.fetchBuffer(manifest.probes.file),
      manifest.post.lut ? this.fetchBuffer(manifest.post.lut.file).catch(() => null) : Promise.resolve(null),
      manifest.visibility ? this.fetchBuffer(manifest.visibility.file).catch((err) => {
        console.warn('[cs2map] visibility unavailable; drawing without PVS culling', err);
        return null;
      }) : Promise.resolve(null),
      manifest.sky ? this.fetchBuffer(manifest.sky.file).catch((err) => {
        console.warn('[cs2map] sky panorama unavailable; using a gradient sky', err);
        return null;
      }) : Promise.resolve(null),
    ]);

    this.visibility = manifest.visibility && visibilityBytes ? new PVSVisibility(manifest.visibility, visibilityBytes) : null;

    // 材质纹理（每材质 1 列，texels 行）
    const { count: materialCount, texels } = manifest.materials;
    const materialsTexture = new DataTexture(
      new Float32Array(materialsBytes, 0, materialCount * texels * 4),
      texels,
      materialCount,
      RGBAFormat,
      FloatType,
    );
    materialsTexture.minFilter = materialsTexture.magFilter = NearestFilter;
    materialsTexture.generateMipmaps = false;
    materialsTexture.needsUpdate = true;

    const probesTexture = decodeTexture(parseKtx(probesBytes), { array: true, repeat: false });
    const probeGrid = buildProbeVolumeGrid(manifest.probes.volumes, manifest.bounds);
    if (probeGrid.overflowCells > 0) {
      console.warn(`[cs2map] ${probeGrid.overflowCells} probe grid cells exceed the candidate limit`);
    }
    this.probeBoxes = probeGrid.boxes;
    this.lutCurve = lutBytes && manifest.post.lut ? lutToGLSL(new Uint8Array(lutBytes), manifest.post.lut.size) : null;

    const { sun } = manifest.scene;
    const fog = extractFog(manifest);
    const sunDir = new Vector3(...sun.direction).normalize();
    const fogRange = Math.max(0.001, fog.end - fog.start);
    const fogHeightRange = fog.heightStart - fog.heightEnd;
    const fogParams = new Vector4(1 / fogRange, -fog.start / fogRange, 0, 1);
    if (fog.height && Math.abs(fogHeightRange) > 0.001) {
      fogParams.set(fogParams.x, fogParams.y, 1 / fogHeightRange, -fog.heightEnd / fogHeightRange);
    }

    Object.assign(this.shared, {
      uMaterials: { value: materialsTexture },
      uProbes: { value: probesTexture },
      uProbeData: { value: probeGrid.data },
      uProbeGrid: { value: probeGrid.grid },
      uGridOrigin: { value: probeGrid.origin },
      uGridInvCell: { value: new Vector3(1, 1, 1).divide(probeGrid.cellSize) },
      uGridMax: { value: probeGrid.dims.clone().subScalar(1) },
      uProbeMaxLod: { value: Math.max(0, manifest.probes.levels - 1) },
      uSunDir: { value: sunDir },
      uSunColor: { value: new Vector3(...sun.color) },
      uFogColor: { value: new Vector3(...fog.color) },
      uFogParams: { value: fogParams },
      uFogShape: { value: new Vector3(fog.falloffExponent, fog.height ? fog.verticalExponent : 1, fog.maxOpacity) },
      uLmIrradiance: { value: null },
      uLmDirectional: { value: null },
      uLmShadows: { value: null },
    });

    this.staticTextures = [materialsTexture, probesTexture, probeGrid.data, probeGrid.grid];
    if (skyBytes) {
      this.skyTexture = decodeTexture(parseKtx(skyBytes), { array: false, repeat: false });
      this.skyTexture.wrapS = RepeatWrapping;
      this.staticTextures.push(this.skyTexture);
    }
    for (const texture of this.staticTextures) this.upload(texture);
  }

  async loadTextures(manifest, gen) {
    const textureMeta = manifest.textures;
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const loaded = [];
    const loadTexture = async (file, isArray, repeat, anisotropy) => {
      const texture = decodeTexture(parseKtx(await this.fetchBuffer(file)), { array: isArray, repeat, anisotropy: anisotropy ?? 1 });
      loaded.push(texture);
      return texture;
    };

    const classNames = Object.keys(textureMeta.classes);
    const tasks = [];
    const classes = new Map();
    for (const className of classNames) {
      const meta = textureMeta.classes[className];
      const entry = {};
      classes.set(className, entry);
      tasks.push(async () => { entry.color = await loadTexture(meta.color, true, true, maxAniso); });
      tasks.push(async () => { entry.normal = await loadTexture(meta.normal, true, true, maxAniso); });
      tasks.push(async () => { entry.mask = await loadTexture(meta.mask, true, true, maxAniso); });
    }

    let overlay = null;
    let irradiance = null;
    let directional = null;
    let shadows = null;
    if (textureMeta.overlay?.file) {
      tasks.push(async () => { overlay = await loadTexture(textureMeta.overlay.file, true, true, maxAniso); });
    }
    tasks.push(async () => { irradiance = await loadTexture(textureMeta.lightmaps.irradiance, false, false, 1); });
    tasks.push(async () => { directional = await loadTexture(textureMeta.lightmaps.directional, false, false, 1); });
    tasks.push(async () => { shadows = await loadTexture(textureMeta.lightmaps.shadows, false, false, 1); });

    try {
      await runWithConcurrency(tasks, MAX_CONCURRENT_FETCH);
    } catch (err) {
      for (const texture of loaded) texture.dispose();
      throw err;
    }
    if (gen !== this.generation) {
      for (const texture of loaded) texture.dispose();
      return;
    }

    for (const texture of loaded) this.upload(texture);
    for (const [className, entry] of classes) {
      const uniforms = this.classUniformsFor(className);
      uniforms.color.value = entry.color ?? null;
      uniforms.normal.value = entry.normal ?? null;
      uniforms.mask.value = entry.mask ?? null;
    }
    this.overlay.value = overlay;
    this.shared.uLmIrradiance.value = irradiance;
    this.shared.uLmDirectional.value = directional;
    this.shared.uLmShadows.value = shadows;
    this.mapTextures = loaded;
  }

  async loadGeometry(manifest, gen, onProgress) {
    const geometryMeta = manifest.geometry;
    const chunksByFile = new Map();
    for (const chunk of geometryMeta.chunks) {
      const list = chunksByFile.get(chunk.file);
      if (list) list.push(chunk);
      else chunksByFile.set(chunk.file, [chunk]);
    }

    initGltfWorkers();
    await gltfModule.ready;

    const geometryRoot = new Group();
    geometryRoot.name = 'CS2MapGeometry';
    const meshes = [];
    const files = [...chunksByFile.keys()];
    let done = 0;
    onProgress?.(0, files.length);

    try {
      await runWithConcurrency(
        files.map((file) => async () => {
          const buffer = new Uint8Array(await this.fetchBuffer(`${geometryMeta.dir}/${file}`));
          const built = await Promise.all(chunksByFile.get(file).map((chunk) => this.buildChunk(chunk, buffer)));
          if (gen !== this.generation) {
            for (const mesh of built) mesh.geometry.dispose();
            return;
          }
          for (const mesh of built) {
            geometryRoot.add(mesh);
            meshes.push(mesh);
          }
          onProgress?.(++done, files.length);
        }),
        MAX_CONCURRENT_FETCH,
      );
    } catch (err) {
      disposeGroupGeometry(geometryRoot);
      throw err;
    }
    if (gen !== this.generation) {
      disposeGroupGeometry(geometryRoot);
      return;
    }

    this.uploadGeometry(geometryRoot, meshes);
    this.geometryRoot = geometryRoot;
    this.partMeshes = meshes;
    this.lodError = geometryMeta.lodError;
    this.setupObjects(manifest.objects ?? [], meshes, geometryMeta.chunks);
    this.group.add(geometryRoot);
  }

  setupObjects(objects, meshes, chunks) {
    this.objects = objects;
    this.objectMeshes = objects.map(() => []);
    this.objectBoxes = objects.map(() => null);

    for (const chunk of chunks) {
      const objectId = chunk.object ?? 0;
      if (objectId <= 0 || objectId > objects.length) continue;
      const box = new Box3(new Vector3(...chunk.boxMin), new Vector3(...chunk.boxMax));
      this.objectBoxes[objectId - 1] = this.objectBoxes[objectId - 1]?.union(box) ?? box;
    }
    for (const mesh of meshes) {
      if (mesh.objectId > 0 && mesh.objectId <= objects.length) {
        this.objectMeshes[mesh.objectId - 1].push(mesh);
      }
    }

    objects.forEach((object, i) => {
      const meshesOfObject = this.objectMeshes[i];
      if (object.kind !== 'door' || meshesOfObject.length === 0) return;
      const origin = new Vector3(...object.origin);
      let radius = 0;
      for (const mesh of meshesOfObject) {
        radius = Math.max(radius, mesh.sphere.center.distanceTo(origin) + mesh.sphere.radius);
      }
      const rotationUniform = this.objectRotationUniform(object.id);
      for (const mesh of meshesOfObject) {
        mesh.movable = true;
        mesh.sphere.set(origin.clone(), radius);
      }
      this.doorRotations.set(i, { uniform: rotationUniform, bases: meshesOfObject.map((m) => m.matrix.clone()) });
    });

    this.objectTimeline = null;
    this.objectRecords = undefined;
  }

  get mapObjects() {
    return this.objects;
  }
  get objectState() {
    return this.objectTimeline;
  }
  objectBox(index) {
    return this.objectBoxes[index] ?? null;
  }
  fileUrl(path) {
    return `${this.baseUrl}${path}`;
  }

  /** 更新物体（门等）在指定 tick 的姿势 */
  updateObjects(records, tick) {
    if (this.objects.length === 0) return;
    if (!this.objectTimeline || records !== this.objectRecords) {
      this.objectTimeline = new ObjectTimeline(this.objects, records);
      this.objectRecords = records;
    }
    const timeline = this.objectTimeline;
    const pose = this.objectPose;

    this.objects.forEach((object, i) => {
      timeline.poseAt(i, tick, pose);
      const meshes = this.objectMeshes[i];
      for (const mesh of meshes) mesh.objectHidden = !pose.visible;

      const doorRotation = this.doorRotations.get(i);
      if (!doorRotation || !pose.visible) return;

      const rotationMatrix = eulerToMatrix(pose.pitch, pose.yaw, pose.roll, _tempRotationMat).multiply(
        _tempBaseRotation.copy(eulerToMatrix(object.angles[0], object.angles[1], object.angles[2], _tempBaseRotation)).invert(),
      );
      doorRotation.uniform.value.setFromMatrix4(rotationMatrix);

      const [ox, oy, oz] = object.origin;
      _tempTranslate.makeTranslation(ox, oy, oz).multiply(rotationMatrix).multiply(_tempUntranslate.makeTranslation(-ox, -oy, -oz));
      meshes.forEach((mesh, j) => {
        mesh.matrix.multiplyMatrices(_tempTranslate, doorRotation.bases[j]);
        mesh.matrixWorldNeedsUpdate = true;
      });
    });
  }

  /** 离屏渲染一次以初始化 GPU 缓冲 */
  uploadGeometry(geometryRoot, meshes) {
    const scene = new Scene();
    const camera = new OrthographicCamera();
    const target = new WebGLRenderTarget(1, 1);
    const prevTarget = this.renderer.getRenderTarget();
    const prevFrustum = meshes.map((m) => m.frustumCulled);

    scene.add(geometryRoot);
    for (const mesh of meshes) {
      mesh.frustumCulled = false;
      mesh.visible = true;
      mesh._multiDrawStarts[0] = 0;
      mesh._multiDrawCounts[0] = Math.min(3, mesh.geometry.index?.count ?? 0);
      mesh._multiDrawCount = 1;
    }

    try {
      this.renderer.setRenderTarget(target);
      this.renderer.render(scene, camera);
    } finally {
      this.renderer.setRenderTarget(prevTarget);
      scene.remove(geometryRoot);
      target.dispose();
      meshes.forEach((mesh, i) => {
        mesh.frustumCulled = prevFrustum[i];
        mesh.visible = false;
        mesh._multiDrawCount = 0;
      });
    }
  }

  /** 每帧更新：视锥 + PVS + 细节距离剔除 */
  update(camera, useVisibility) {
    if (this.partMeshes.length === 0) return;
    camera.updateMatrixWorld();
    this.group.updateWorldMatrix(true, false);

    const culler = this.culler;
    culler.setView(camera, this.group);
    const { x, y, z } = culler.camera;
    const visibility = this.pvsEnabled && useVisibility ? this.visibility : null;

    this.lastCluster = visibility ? visibility.clusterAt(x, y, z) : -1;
    culler.cells = visibility ? visibility.visibleCellsAt(x, y, z) : null;
    culler.detailDistance = DETAIL_DISTANCE;
    culler.lodDistance = this.lodDistance(camera);

    for (const mesh of this.partMeshes) culler.cull(mesh);
  }

  lodDistance(camera) {
    if (this.lodError <= 0) return Infinity;
    const pixelThreshold = LOD_PIXEL_THRESHOLD;
    const height = this.renderer.getDrawingBufferSize(this.drawingBuffer).y;
    if (camera instanceof PerspectiveCamera) {
      const pixelsPerUnit = (height * camera.zoom) / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
      return (this.lodError * pixelsPerUnit) / pixelThreshold;
    }
    if (camera instanceof OrthographicCamera) {
      const pixelsPerUnit = (height * camera.zoom) / (camera.top - camera.bottom);
      return this.lodError * pixelsPerUnit <= pixelThreshold ? 0 : Infinity;
    }
    return Infinity;
  }

  async buildChunk(chunk, buffer) {
    const decodeAttributes = (streamName) => {
      const [start, length, type, usage] = chunk.streams[streamName];
      return gltfModule.decodeGltfBufferAsync(chunk.vertexCount, type, buffer.subarray(start, start + length), 'ATTRIBUTES', usage);
    };
    const decodeIndices = (indexCount, [start, length]) =>
      gltfModule.decodeGltfBufferAsync(indexCount, 2, buffer.subarray(start, start + length), 'TRIANGLES');

    const streamNames = Object.keys(chunk.streams);
    const lod = chunk.lod;

    const [indices, lodIndices, ...attributeBuffers] = await Promise.all([
      decodeIndices(chunk.indexCount, chunk.index),
      lod ? decodeIndices(lod.indexCount, lod.index) : Promise.resolve(null),
      ...streamNames.map(decodeAttributes),
    ]);

    const geometry = new BufferGeometry();
    streamNames.forEach((name, i) => {
      const bufferData = attributeBuffers[i];
      const itemSize = chunk.streams[name][2];
      const attr = buildAttribute(name, bufferData, itemSize);
      if (attr) geometry.setAttribute(attr.name, attr.attribute);
    });

    let indexArray = new Uint16Array(indices.buffer, indices.byteOffset, chunk.indexCount);
    let finalIndices = indexArray;
    if (lod && lodIndices) {
      finalIndices = new Uint16Array(chunk.indexCount + lod.indexCount);
      finalIndices.set(indexArray);
      finalIndices.set(new Uint16Array(lodIndices.buffer, lodIndices.byteOffset, lod.indexCount), chunk.indexCount);
    }
    geometry.setIndex(new BufferAttribute(finalIndices, 1));

    for (const attr of [...Object.values(geometry.attributes), geometry.index]) {
      attr.onUpload(releaseBuffer);
    }

    const half = POSITION_QUANTIZE / 2;
    geometry.boundingSphere = new Sphere(new Vector3(half, half, half), half * Math.sqrt(3));
    geometry.boundingBox = new Box3(new Vector3(0, 0, 0), new Vector3(POSITION_QUANTIZE, POSITION_QUANTIZE, POSITION_QUANTIZE));

    const boxMin = new Vector3(...chunk.boxMin);
    const boxMax = new Vector3(...chunk.boxMax);
    const makeParts = ([start, length], firstIndex) => ({
      view: new DataView(buffer.buffer, buffer.byteOffset + start, length * 24),
      count: length,
      firstIndex,
    });

    const nearParts = makeParts(chunk.parts, 0);
    const lodParts = lod ? makeParts(lod.parts, chunk.indexCount) : null;
    const mesh = new BatchedMapMesh(geometry, this.materialFor(chunk), chunk.indexCount / 3, nearParts, lodParts, boxMin, boxMax, chunk.detail);
    mesh.objectId = chunk.object ?? 0;

    const scale = boxMax.clone().sub(boxMin).max(new Vector3(0.001, 0.001, 0.001)).divideScalar(POSITION_QUANTIZE);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeScale(scale.x, scale.y, scale.z).setPosition(boxMin);
    mesh.raycast = noopRaycast;
    if (chunk.family === 'translucent') mesh.renderOrder = 1;
    return mesh;
  }

  classUniformsFor(className) {
    let uniforms = this.classUniforms.get(className);
    if (!uniforms) {
      uniforms = { color: { value: null }, normal: { value: null }, mask: { value: null } };
      this.classUniforms.set(className, uniforms);
    }
    return uniforms;
  }

  objectRotationUniform(objectId) {
    let uniform = this.objectRotations.get(objectId);
    if (!uniform) {
      uniform = { value: new Matrix3() };
      this.objectRotations.set(objectId, uniform);
    }
    return uniform;
  }

  materialFor(chunk) {
    const isDoor = chunk.object ? this.manifest?.objects?.[chunk.object - 1]?.kind === 'door' : false;
    const key = `${chunk.family}|${chunk.doubleSided ? 2 : 1}|${chunk.class1}|${chunk.class2}${isDoor ? `|door${chunk.object}` : ''}`;
    let material = this.materials.get(key);
    if (material) return material;

    const isBlend = chunk.family === 'blend';
    const isAlphaTest = chunk.family === 'alphatest';
    const isTranslucent = chunk.family === 'translucent';
    const class1 = this.classUniformsFor(chunk.class1);
    const uniforms = { ...this.shared, uColor1: class1.color, uNormal1: class1.normal, uMask1: class1.mask };
    if (isBlend) {
      const class2 = this.classUniformsFor(chunk.class2 || chunk.class1);
      Object.assign(uniforms, { uColor2: class2.color, uNormal2: class2.normal, uMask2: class2.mask, uOverlay: this.overlay });
    }
    if (isDoor) uniforms.uObjectRotation = this.objectRotationUniform(chunk.object);

    material = new ShaderMaterial({
      name: `CS2_${key}`,
      vertexShader: GLSL_VERTEX,
      fragmentShader: GLSL_FRAGMENT,
      uniforms,
      defines: materialDefines({ blend: isBlend, alphaTest: isAlphaTest, translucent: isTranslucent, doubleSided: chunk.doubleSided, movable: isDoor }),
      side: chunk.doubleSided ? DoubleSide : FrontSide,
      transparent: isTranslucent,
      depthWrite: !isTranslucent,
      polygonOffset: isTranslucent,
      polygonOffsetFactor: isTranslucent ? -1 : 0,
      polygonOffsetUnits: isTranslucent ? -4 : 0,
      alphaToCoverage: isAlphaTest,
      fog: false,
      lights: false,
    });

    if (!isTranslucent) {
      const depthMaterial = new ShaderMaterial({
        name: `CS2Depth_${key}`,
        vertexShader: GLSL_DEPTH_VERTEX,
        fragmentShader: GLSL_DEPTH_FRAGMENT,
        uniforms: isAlphaTest ? { uMaterials: this.shared.uMaterials, uColor1: class1.color } : {},
        defines: isAlphaTest ? { CS2_ALPHATEST: '' } : {},
        side: material.side,
        colorWrite: false,
        fog: false,
        lights: false,
      });
      material.userData.depthMaterial = depthMaterial;
      material.addEventListener('dispose', () => depthMaterial.dispose());
    }

    this.materials.set(key, material);
    return material;
  }

  upload(texture) {
    texture.onUpdate = clearMipmaps;
    this.renderer.initTexture(texture);
  }

  async fetchBuffer(path) {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url);
    if (!response.ok) throw Error(`CS2 map fetch failed: ${response.status} ${response.statusText} (${url})`);
    let buffer = await response.arrayBuffer();
    this.downloadedBytes += buffer.byteLength;
    const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
    if (this.manifest?.compression === 'gzip' && head[0] === 0x1f && head[1] === 0x8b) {
      const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    }
    return buffer;
  }

  clear() {
    for (const listener of [...this.clearListeners]) listener();
    this.generation++;
    if (this.geometryRoot) {
      this.group.remove(this.geometryRoot);
      disposeGroupGeometry(this.geometryRoot);
    }
    this.geometryRoot = null;
    this.partMeshes = [];
    this.objects = [];
    this.objectMeshes = [];
    this.objectBoxes = [];
    this.doorRotations.clear();
    this.objectRotations.clear();
    this.objectTimeline = null;
    this.objectRecords = undefined;
    this.visibility = null;
    this.lastCluster = -1;
    this.probeBoxes = [];
    this.lightGrid = null;

    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    for (const texture of [...this.mapTextures, ...this.staticTextures]) texture.dispose();
    this.mapTextures = [];
    this.staticTextures = [];
    this.skyTexture = null;
    this.classUniforms.clear();
    this.overlay.value = null;
    for (const key of Object.keys(this.shared)) delete this.shared[key];
    this.manifest = null;
    this.lutCurve = null;
    this.downloadedBytes = 0;
  }

  dispose() {
    this.generation++;
    this.clear();
    this.group.removeFromParent();
  }
}

// ── 模块级复用对象 ────────────────────────────────────────────────────────────

const _tempEuler = new Euler();
const _tempRotationMat = new Matrix4();
const _tempBaseRotation = new Matrix4();
const _tempRotationUniform = new Matrix4();
const _tempTranslate = new Matrix4();
const _tempUntranslate = new Matrix4();

/** 从欧拉角（pitch/yaw/roll，度）构造旋转矩阵（ZYX 顺序） */
function eulerToMatrix(pitch, yaw, roll, target) {
  const rad = Math.PI / 180;
  return target.makeRotationFromEuler(_tempEuler.set(roll * rad, pitch * rad, yaw * rad, 'ZYX'));
}

/** 初始化 gltf 解码 worker（用硬件并发度 - 1 个，最多 4） */
function initGltfWorkers() {
  if (gltfWorkersInitialized) return;
  gltfWorkersInitialized = true;
  const hardware = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  gltfModule.useWorkers(Math.max(1, Math.min(4, hardware - 1)));
}

/** 把解码出的 buffer 转为 geometry attribute */
function buildAttribute(name, bufferData, itemSize) {
  const { buffer, byteOffset, byteLength } = bufferData;
  switch (name) {
    case 'pos':
      return { name: 'aPos', attribute: new BufferAttribute(new Uint16Array(buffer, byteOffset, byteLength / 2), 4, false) };
    case 'nrm':
      return { name: 'aNrm', attribute: new BufferAttribute(new Uint8Array(buffer, byteOffset, byteLength), 4, false) };
    case 'uv':
      return { name: 'aUv', attribute: new BufferAttribute(new Float32Array(buffer, byteOffset, byteLength / 4), itemSize / 4) };
    case 'lm':
      return { name: 'aLm', attribute: new BufferAttribute(new Uint16Array(buffer, byteOffset, byteLength / 2), 2, false) };
    case 'col':
      return { name: 'aCol', attribute: new BufferAttribute(new Uint8Array(buffer, byteOffset, byteLength), 4, true) };
    case 'bld':
      return { name: 'aBld', attribute: new BufferAttribute(new Uint8Array(buffer, byteOffset, byteLength), 4, true) };
    case 'ovl':
      return { name: 'aOvl', attribute: new BufferAttribute(new Float32Array(buffer, byteOffset, byteLength / 4), 2) };
    default:
      return null;
  }
}

/** 上传后释放底层数组 */
function releaseBuffer() {
  this.array = new this.array.constructor(0);
}

/** 纹理更新回调：清 mipmaps */
function clearMipmaps(texture) {
  if (texture.isCompressedTexture) texture.mipmaps = [];
  texture.onUpdate = null;
}

/** 递归释放组内所有 mesh 的 geometry */
function disposeGroupGeometry(root) {
  root.traverse((obj) => {
    const mesh = obj;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

/** 以固定并发度运行一组 async 任务 */
async function runWithConcurrency(tasks, limit) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        await task();
      }
    }),
  );
}

// ── uniform 常量 ──────────────────────────────────────────────────────────────

const SHARED_UNIFORM_NAMES = [
  'uProbes',
  'uProbeData',
  'uProbeGrid',
  'uGridOrigin',
  'uGridInvCell',
  'uGridMax',
  'uProbeMaxLod',
  'uSunDir',
  'uSunColor',
  'uFogColor',
  'uFogParams',
  'uFogShape',
];
const PROBE_UNIFORM_NAMES = ['uProbes', 'uProbeData', 'uProbeGrid'];
const INCH_TO_METER = 1 / 0.0254;

/** 动态对象的光照 uniform 结构 */
function createDynamicLightUniforms() {
  return {
    uAmbient: { value: new Float32Array(18) },
    uSunVisibility: { value: 1 },
    uFallbackProbe: { value: 0 },
    uFlashPos: { value: new Vector4() },
    uFlashColor: { value: new Vector3() },
  };
}

/** 把光照采样写入动态对象的 uniform */
function applyLightSample(uniforms, sample) {
  uniforms.uAmbient.value.set(sample.ambient);
  uniforms.uSunVisibility.value = sample.sunVisibility;
  uniforms.uFallbackProbe.value = sample.probeRow;
}
