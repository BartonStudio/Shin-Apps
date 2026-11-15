// ============================================================================
// 反混淆版本：光照探针网格（LightProbeGrid）—— CS2 光照核心
// 原始压缩文件：src/app/04-lighting-shader.js（decompiled 29971–31491 行）
// 原文范围：decompiled/index.beautified.js L29971–31491（切片 04-lighting-shader，本文件为其子集）
// 压缩类名：zv
// 说明：CS2 地图的"光照探针体积"（light probe volume）采样器。
//   数据是 luma/chroma 分离的 YCbCr 风格色彩空间，带 HDR 亮度查表，
//   采样时做三线性插值，重建每个方向（6 个面/轴）的环境光照。
//   这是 CS2 Source2 引擎光照烘焙数据的运行时还原。
// ============================================================================

const MAX_LUMA_STEPS = 256;

class LightProbeGrid {
  /**
   * @param {object} meta 探针元数据（origin/dims/cell/luma/chroma/sun/bias/steps）
   * @param {Uint8Array} data 烘焙的探针数据（gzip 已解压）
   */
  constructor(meta, data) {
    this.data = data;
    this.origin = meta.origin;

    // 三个平面（plane）的布局描述：luma（亮度）、chroma（色度）、sun（太阳可见性）
    const planeInfo = (plane, offset) => ({
      dims: plane.dims,
      invCell: [1 / plane.cell[0], 1 / plane.cell[1], 1 / plane.cell[2]],
      offset,
      planeSize: plane.dims[0] * plane.dims[1] * plane.dims[2],
    });

    // luma 有 6 个方向（+X/-X/+Y/-Y/+Z/-Z），chroma 每方向 2 个通道，sun 每方向 1 个
    this.luma = planeInfo(meta.luma, 0);
    this.chroma = planeInfo(meta.chroma, this.luma.planeSize * 6);
    this.sun = planeInfo(meta.sun, this.chroma.offset + this.chroma.planeSize * 12);

    const expectedSize = this.sun.offset + this.sun.planeSize;
    if (data.length < expectedSize) throw Error(`light grid is ${data.length} bytes, expected ${expectedSize}`);

    // 亮度查表：把 8bit 索引映射回 HDR 亮度（2 的幂次，模拟对数空间）
    this.lumaTable = new Float32Array(MAX_LUMA_STEPS);
    for (let i = 1; i < MAX_LUMA_STEPS; i++) {
      this.lumaTable[i] = 2 ** ((i - meta.luma.bias) / meta.luma.steps);
    }

    // 三线性插值的 8 个角落缓存
    this.corners = { index: new Int32Array(8), weight: new Float32Array(8) };
    this.lumaCorners = { index: new Int32Array(8), weight: new Float32Array(8) };
  }

  /** 加载：若数据是 gzip（0x1f 0x8b 魔数）则先解压 */
  static async load(meta, bytes) {
    let data = new Uint8Array(bytes);
    if (data[0] === 0x1f && data[1] === 0x8b) {
      // 浏览器原生 gzip 解压
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(`gzip`));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return new LightProbeGrid(meta, data);
  }

  /**
   * 采样某位置 (x,y,z) 的环境光照。
   * 输出 r.ambient（6 方向 × RGB）和 r.sunVisibility（0~1）。
   */
  sample(x, y, z, out) {
    const data = this.data;

    // 定位 luma 和 chroma 的插值角落
    this.locate(this.luma, x, y, z, this.lumaCorners);
    this.locate(this.chroma, x, y, z, this.corners);

    // 每个方向（6 个）独立重建
    for (let dir = 0; dir < 6; dir++) {
      // luma：8 角插值 + 查表解码 → 亮度 L
      let luma = 0;
      const lumaBase = this.luma.offset + dir * this.luma.planeSize;
      for (let corner = 0; corner < 8; corner++) {
        luma += this.lumaCorners.weight[corner] * this.lumaTable[data[lumaBase + this.lumaCorners.index[corner]]];
      }

      // chroma：8 角插值，两个色度通道 → 归一化
      let chromaA = 0, chromaB = 0;
      const chromaAOffset = this.chroma.offset + dir * 2 * this.chroma.planeSize;
      const chromaBOffset = chromaAOffset + this.chroma.planeSize;
      for (let corner = 0; corner < 8; corner++) {
        chromaA += this.corners.weight[corner] * data[chromaAOffset + this.corners.index[corner]];
        chromaB += this.corners.weight[corner] * data[chromaBOffset + this.corners.index[corner]];
      }
      chromaA /= 255;
      chromaB /= 255;

      // YCbCr → RGB 重建（chromaA/chromaB 是两个色度分量）
      const chromaC = Math.max(0, 1 - chromaA - chromaB);
      // 亮度归一化：除以色度加权后的"总亮度贡献"，把 HDR 亮度映射回颜色
      const denom = Math.max(1e-4, LUMA_TO_RGB[0] * chromaA + LUMA_TO_RGB[1] * chromaB + LUMA_TO_RGB[2] * chromaC);
      const scale = luma / denom;
      out.ambient[dir * 3] = chromaA * scale;
      out.ambient[dir * 3 + 1] = chromaB * scale;
      out.ambient[dir * 3 + 2] = chromaC * scale;
    }

    // 太阳可见性：8 角插值 → 0~1
    this.locate(this.sun, x, y, z, this.corners);
    let sunVisibility = 0;
    for (let corner = 0; corner < 8; corner++) {
      sunVisibility += this.corners.weight[corner] * data[this.sun.offset + this.corners.index[corner]];
    }
    out.sunVisibility = sunVisibility / 255;
  }

  /** 三线性插值定位：计算 8 个相邻探针的索引和权重 */
  locate(plane, x, y, z, out) {
    const [dimX, dimY, dimZ] = plane.dims;
    // 网格坐标（-0.5 让采样点落在体素中心）
    const gx = clampFloat((x - this.origin[0]) * plane.invCell[0] - 0.5, 0, dimX - 1);
    const gy = clampFloat((y - this.origin[1]) * plane.invCell[1] - 0.5, 0, dimY - 1);
    const gz = clampFloat((z - this.origin[2]) * plane.invCell[2] - 0.5, 0, dimZ - 1);

    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
    const x1 = Math.min(x0 + 1, dimX - 1);
    const y1 = Math.min(y0 + 1, dimY - 1);
    const z1 = Math.min(z0 + 1, dimZ - 1);

    const fx = gx - x0, fy = gy - y0, fz = gz - z0; // 小数部分

    // 8 个角落（x0/x1, y0/y1, z0/z1），权重是三线性插值系数
    for (let corner = 0; corner < 8; corner++) {
      const ix = corner & 1 ? x1 : x0;
      const iy = corner & 2 ? y1 : y0;
      const iz = corner & 4 ? z1 : z0;
      out.index[corner] = (iz * dimY + iy) * dimX + ix;
      out.weight[corner] = (corner & 1 ? fx : 1 - fx) * (corner & 2 ? fy : 1 - fy) * (corner & 4 ? fz : 1 - fz);
    }
    return out;
  }
}

function clampFloat(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
