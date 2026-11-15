// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 29971–31491 行（切片 11/40）
// 角色：自研光照系统 zv：directLight/indirectLight/probeSample/envBrdfApprox/octEncode/CustomToneMapping
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var zv = class e {
  data
  origin
  luma
  chroma
  sun
  lumaTable = new Float32Array(256)
  corners = { index: new Int32Array(8), weight: new Float32Array(8) }
  lumaCorners = { index: new Int32Array(8), weight: new Float32Array(8) }
  constructor(e, t) {
    ;((this.data = t), (this.origin = e.origin))
    let n = (e, t) => ({
      dims: e.dims,
      invCell: [1 / e.cell[0], 1 / e.cell[1], 1 / e.cell[2]],
      offset: t,
      planeSize: e.dims[0] * e.dims[1] * e.dims[2],
    })
    ;((this.luma = n(e.luma, 0)),
      (this.chroma = n(e.chroma, this.luma.planeSize * 6)),
      (this.sun = n(e.sun, this.chroma.offset + this.chroma.planeSize * 12)))
    let r = this.sun.offset + this.sun.planeSize
    if (t.length < r) throw Error(`light grid is ${t.length} bytes, expected ${r}`)
    for (let t = 1; t < 256; t++) this.lumaTable[t] = 2 ** ((t - e.luma.bias) / e.luma.steps)
  }
  static async load(t, n) {
    let r = new Uint8Array(n)
    if (r[0] === 31 && r[1] === 139) {
      let e = new Blob([n]).stream().pipeThrough(new DecompressionStream(`gzip`))
      r = new Uint8Array(await new Response(e).arrayBuffer())
    }
    return new e(t, r)
  }
  sample(e, t, n, r) {
    let i = this.data,
      a = this.lumaCorners
    this.locate(this.luma, e, t, n, a)
    let o = this.locate(this.chroma, e, t, n, this.corners)
    for (let e = 0; e < 6; e++) {
      let t = 0,
        n = this.luma.offset + e * this.luma.planeSize
      for (let e = 0; e < 8; e++) t += a.weight[e] * this.lumaTable[i[n + a.index[e]]]
      let s = 0,
        c = 0,
        l = this.chroma.offset + e * 2 * this.chroma.planeSize,
        u = l + this.chroma.planeSize
      for (let e = 0; e < 8; e++) ((s += o.weight[e] * i[l + o.index[e]]), (c += o.weight[e] * i[u + o.index[e]]))
      ;((s /= 255), (c /= 255))
      let d = Math.max(0, 1 - s - c),
        f = t / Math.max(1e-4, Lv[0] * s + Lv[1] * c + Lv[2] * d)
      ;((r.ambient[e * 3] = s * f), (r.ambient[e * 3 + 1] = c * f), (r.ambient[e * 3 + 2] = d * f))
    }
    let s = this.locate(this.sun, e, t, n, this.corners),
      c = 0
    for (let e = 0; e < 8; e++) c += s.weight[e] * i[this.sun.offset + s.index[e]]
    r.sunVisibility = c / 255
  }
  locate(e, t, n, r, i) {
    let [a, o, s] = e.dims,
      c = Bv((t - this.origin[0]) * e.invCell[0] - 0.5, 0, a - 1),
      l = Bv((n - this.origin[1]) * e.invCell[1] - 0.5, 0, o - 1),
      u = Bv((r - this.origin[2]) * e.invCell[2] - 0.5, 0, s - 1),
      d = Math.floor(c),
      f = Math.floor(l),
      p = Math.floor(u),
      m = Math.min(d + 1, a - 1),
      h = Math.min(f + 1, o - 1),
      g = Math.min(p + 1, s - 1),
      _ = c - d,
      v = l - f,
      y = u - p
    for (let e = 0; e < 8; e++) {
      let t = e & 1 ? m : d,
        n = e & 2 ? h : f,
        r = e & 4 ? g : p
      ;((i.index[e] = (r * o + n) * a + t),
        (i.weight[e] = (e & 1 ? _ : 1 - _) * (e & 2 ? v : 1 - v) * (e & 4 ? y : 1 - y)))
    }
    return i
  }
}
function Bv(e, t, n) {
  return e < t ? t : e > n ? n : e
}
var Vv = 255,
  Hv = 128,
  Uv = 128
function Wv(e, t) {
  if (e.length >= Vv) throw Error(`too many probe volumes (${e.length})`)
  let n = new Float32Array(28 * Math.max(1, e.length)),
    r = [],
    i = new H(),
    a = new H(),
    o = new B()
  e.forEach((e, t) => {
    let s = e.worldToLocal,
      c = t * 7 * 4
    ;(n.set([s[0], s[1], s[2], s[9]], c),
      n.set([s[3], s[4], s[5], s[10]], c + 4),
      n.set([s[6], s[7], s[8], s[11]], c + 8),
      n.set([...e.boxMins, e.slot], c + 12),
      n.set([...e.boxMaxs, 0], c + 16),
      n.set([...e.invEdge, 0], c + 20),
      n.set(e.normalizationSH, c + 24),
      i.set(s[0], s[3], s[6], s[9], s[1], s[4], s[7], s[10], s[2], s[5], s[8], s[11], 0, 0, 0, 1),
      a.copy(i).invert())
    let l = new lr()
    for (let t = 0; t < 8; t++)
      (o
        .set(
          t & 1 ? e.boxMaxs[0] : e.boxMins[0],
          t & 2 ? e.boxMaxs[1] : e.boxMins[1],
          t & 4 ? e.boxMaxs[2] : e.boxMins[2],
        )
        .applyMatrix4(a),
        l.expandByPoint(o))
    r.push(l)
  })
  let s = new B(...t.min).subScalar(1),
    l = new B(...t.max).addScalar(1).sub(s),
    u = new B(
      Math.min(Uv, Math.max(1, Math.ceil(l.x / Hv))),
      Math.min(Uv, Math.max(1, Math.ceil(l.y / Hv))),
      Math.min(Uv, Math.max(1, Math.ceil(l.z / Hv))),
    ),
    d = l.clone().divide(u),
    f = u.x,
    p = u.y,
    h = u.z,
    g = new Uint8Array(f * 2 * p * h * 4).fill(Vv),
    _ = new Uint8Array(f * p * h),
    v = 0
  r.forEach((e, t) => {
    let n = Math.max(0, Math.floor((e.min.x - s.x) / d.x)),
      r = Math.max(0, Math.floor((e.min.y - s.y) / d.y)),
      i = Math.max(0, Math.floor((e.min.z - s.z) / d.z)),
      a = Math.min(f - 1, Math.floor((e.max.x - s.x) / d.x)),
      o = Math.min(p - 1, Math.floor((e.max.y - s.y) / d.y)),
      c = Math.min(h - 1, Math.floor((e.max.z - s.z) / d.z))
    for (let e = i; e <= c; e++)
      for (let i = r; i <= o; i++)
        for (let r = n; r <= a; r++) {
          let n = (e * p + i) * f + r,
            a = _[n]
          if (a >= 8) {
            ;(a === 8 && v++, (_[n] = 9))
            continue
          }
          let o = (e * p + i) * f * 2 + r * 2 + (a >> 2)
          ;((g[o * 4 + (a & 3)] = t), (_[n] = a + 1))
        }
  })
  let y = new Hi(n, 7, Math.max(1, e.length), k, b)
  ;((y.minFilter = y.magFilter = c), (y.generateMipmaps = !1), (y.needsUpdate = !0))
  let x = new dn(g, f * 2, p, h)
  return (
    (x.format = k),
    (x.type = m),
    (x.minFilter = x.magFilter = c),
    (x.generateMipmaps = !1),
    (x.unpackAlignment = 1),
    (x.needsUpdate = !0),
    { data: y, grid: x, origin: s, cellSize: d, dims: u, boxes: r, overflowCells: v }
  )
}
function Gv(e, t) {
  let n = 0,
    r = 1 / 0
  for (let i = 0; i < e.length; i++) {
    let a = e[i].distanceToPoint(t)
    if (a < r && ((n = i), (r = a), a === 0)) break
  }
  return n
}
function Kv(e) {
  let t = {}
  return (
    e.blend && (t.CS2_BLEND = ``),
    e.alphaTest && (t.CS2_ALPHATEST = ``),
    e.translucent && (t.CS2_TRANSLUCENT = ``),
    e.doubleSided && (t.CS2_DOUBLE_SIDED = ``),
    e.movable && (t.CS2_MOVABLE = ``),
    t
  )
}
var qv = `
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif

float luma(vec3 c) {
  return dot(c, vec3(0.2125, 0.7154, 0.0721));
}

float max3(vec3 v) {
  return max(max(v.x, v.y), v.z);
}
`,
  Jv = `
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
`,
  Yv = `
vec2 octEncode(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 p = n.xy;
  if (n.z < 0.0) p = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return p * 0.5 + 0.5;
}

// Karis' analytic fit of the split-sum table: x = reflectance at F0 = 0, y = at F0 = 1 (VRF lut layout).
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
  // Parallax correction against the probe box.
  vec3 first = (mins.xyz - local) / localR;
  vec3 second = (maxs.xyz - local) / localR;
  vec3 furthest = max(first, second);
  float distance = abs(min(furthest.x, min(furthest.y, furthest.z)));
  vec3 dir = normalize(local + localR * distance);
  return textureLod(uProbes, vec3(octEncode(dir), mins.w), lod).rgb;
}

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

// A directional light (GGX, Valve's visibility term and the multiscatter boost); L points towards the light.
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

// Split-sum image-based specular normalised against the baked irradiance, plus the energy-conserving diffuse.
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

// Gradient (distance x height) fog.
vec3 applyFog(vec3 color, vec3 position, vec3 eye) {
  vec2 fog = vec2(length(position - eye), position.z);
  fog = pow(clamp(fog * uFogParams.xz + uFogParams.yw, 0.0001, 1.0), uFogShape.xy);
  return mix(color, uFogColor, fog.x * fog.y * uFogShape.z);
}
`,
  Xv = `
precision highp float;
precision highp int;

attribute vec4 aPos;   // u16 quantized position in the chunk box (model matrix rescales), w = material row
attribute vec4 aNrm;   // u8: octahedral normal xy, flags, probe slot
attribute vec4 aUv;    // layer 1 uv (xy), layer 2 uv (zw)
attribute vec2 aLm;    // lightmap uv (u16) or packed RGBM probe irradiance
attribute vec4 aCol;   // vertex paint (normalized)
#ifdef CS2_BLEND
attribute vec4 aBld;   // blend values (normalized)
attribute vec2 aOvl;   // shared colour overlay uv
#endif

uniform highp sampler2D uMaterials;
#ifdef CS2_MOVABLE
uniform mat3 uObjectRotation;  // the door's rotation away from its baked pose
#endif

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vUv;
varying vec4 vLmOvl;
varying vec4 vPaint;          // rgb vertex paint x material vertex tint, a = probe-lit sun visibility
varying vec3 vProbeIrradiance;
#ifdef CS2_BLEND
varying vec4 vBlend;
#endif
flat varying ivec3 vInfo;      // material row, probe-lit, fallback probe slot

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
`,
  Zv = `
precision highp float;
precision highp int;

${qv}

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
${Jv}

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

${Yv}
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

  // ---- Material (csgo_environment GetMaterial) ----
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

  // GetBlendWeights (legacy height blend).
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
  // Complex shaders fold the instance tint into the vertex colour, so both stay inside the tint mask.
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

  // ---- Surface frame: derivative cotangent frame (no stored tangents) ----
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

  // Geometric specular anti-aliasing and the curvature estimate used by the lightmap direction.
  vec3 dn1 = dFdx(geometricNormal);
  vec3 dn2 = dFdy(geometricNormal);
  roughness = max(roughness, sqrt(saturate(max(dot(dn1, dn1), dot(dn2, dn2)))));
  roughness = clamp(roughness, 0.02, 1.0);

  vec3 diffuseColor = color.rgb * (1.0 - metalness);
  vec3 specColor = mix(vec3(REFLECTANCE), color.rgb, metalness);

  vec3 V = normalize(cameraPosition - vWorldPos);
  float NoV = max(dot(N, V), 1e-4);

  // ---- Baked indirect diffuse + sun visibility ----
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

  // ---- Sun (stationary light with baked visibility) ----
  vec3 sunDiffuse;
  vec3 sunSpecular;
  directLight(N, V, uSunDir, NoV, roughness, specColor, uSunColor * sunVisibility, sunDiffuse, sunSpecular);

  // ---- Image-based specular ----
  vec3 R = normalize(reflect(-V, N));
  float r2 = roughness * roughness;
  float smoothness = saturate(1.0 - r2);
  float dominant = smoothness * (sqrt(smoothness) + r2);
  R = normalize(mix(N, R, dominant));
  ProbeResult env = sampleEnvironment(vWorldPos, R, sqrt(roughness) * uProbeMaxLod, vInfo.z);

  vec3 specularIndirect;
  vec3 diffuseIndirect;
  indirectLight(env, irradiance, N, roughness, NoV, specColor, specularIndirect, diffuseIndirect);

  // ---- Combine (ApplyAmbientOcclusion) ----
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

  // ---- Gradient fog ----
  outColor = applyFog(outColor, vWorldPos, cameraPosition);

  gl_FragColor = vec4(outColor, opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
  Qv = `
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
`,
  $v = `
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
`,
  ey = -0.4,
  ty = `vec3 CustomToneMapping( vec3 color ) { return color; }`,
  ny = null,
  ry = null
function iy(e) {
  let t = Number.isFinite(e) ? e.toPrecision(7) : `0.0`
  return /[.e]/.test(t) ? t : `${t}.0`
}
function ay(e, t) {
  let n = []
  for (let r = 0; r < t; r++) {
    let i = ((r * t + r) * t + r) * 4
    n.push([e[i] / 255, e[i + 1] / 255, e[i + 2] / 255])
  }
  return n
}
function oy(e, t) {
  let n = e.tonemap,
    r = n.whitePoint * 2.8,
    i =
      1 /
      ((e) =>
        (e * (n.shoulderStrength * e + n.linearStrength * n.linearAngle) + n.toeNumerator * n.toeStrength) /
          (e * (n.shoulderStrength * e + n.linearStrength) + n.toeDenominator * n.toeStrength) -
        n.toeNumerator / n.toeDenominator)(r),
    a = t && t.length >= 2 ? t : null
  return `
vec3 cs2SrgbEncode( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
vec3 cs2SrgbDecode( vec3 c ) {
  return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
}
${
  a
    ? `const vec3 CS2_LUT[${a.length}] = vec3[${a.length}](${a.map((e) => `vec3(${e.map(iy).join(`, `)})`).join(`, `)});
float cs2LutChannel( float v, int channel ) {
  float f = clamp( v, 0.0, 1.0 ) * ${iy(a.length - 1)};
  int i0 = int( floor( f ) );
  int i1 = min( i0 + 1, ${a.length - 1} );
  return mix( CS2_LUT[ i0 ][ channel ], CS2_LUT[ i1 ][ channel ], f - float( i0 ) );
}`
    : ``
}
vec3 CustomToneMapping( vec3 color ) {
  vec3 x = min( color * ( toneMappingExposure * ${iy(2 ** (n.exposureBias + ey) * 2.8)} ), vec3( ${iy(r)} ) );
  vec3 n = x * ( ${iy(n.shoulderStrength)} * x + ${iy(n.linearStrength * n.linearAngle)} ) + ${iy(n.toeNumerator * n.toeStrength)};
  vec3 d = x * ( ${iy(n.shoulderStrength)} * x + ${iy(n.linearStrength)} ) + ${iy(n.toeDenominator * n.toeStrength)};
  vec3 mapped = clamp( ( n / d - ${iy(n.toeNumerator / n.toeDenominator)} ) * ${iy(i)}, 0.0, 1.0 );
${
  a
    ? `  vec3 g = cs2SrgbEncode( mapped );
  mapped = cs2SrgbDecode( vec3( cs2LutChannel( g.r, 0 ), cs2LutChannel( g.g, 1 ), cs2LutChannel( g.b, 2 ) ) );`
    : ``
}
  return mapped;
}`
}
function sy(e, t) {
  let n = oy(e, t)
  return ry === null
    ? ((ny ??= K.tonemapping_pars_fragment),
      ny.includes(ty)
        ? ((K.tonemapping_pars_fragment = ny.replace(ty, n)), (ry = n), !0)
        : (console.warn(`[cs2map] three CustomToneMapping stub not found; CS2 grading disabled`), !1))
    : ry === n
}
var cy = [0, 2, 8, 10, 32, 34, 40, 42],
  ly = [0, 1, 4, 5, 16, 17, 20, 21],
  uy = class {
    cellCount
    info
    nodes
    regions
    masks
    rowIndex
    rows
    scratch
    constructor(e, t) {
      ;((this.info = e),
        (this.cellCount = e.cells),
        (this.nodes = new Uint32Array(t, e.nodes[0], e.nodes[1])),
        (this.regions = new Uint32Array(t, e.regions[0], e.regions[1])),
        (this.masks = new Uint32Array(t, e.masks[0], e.masks[1] * 2)),
        (this.rowIndex = new Uint16Array(t, e.rowIndex[0], e.rowIndex[1])),
        (this.rows = new Uint8Array(t, e.rows[0], e.rows[1] * e.rowBytes)),
        (this.scratch = new Uint8Array(e.rowBytes)))
    }
    clusterAt(e, t, n) {
      let r = []
      return (this.clustersAt(e, t, n, r), r.length ? r[0] : -1)
    }
    clustersAt(e, t, n, r) {
      let { boundsMin: i, boundsMax: a } = this.info
      if (e < i[0] || t < i[1] || n < i[2] || e > a[0] || t > a[1] || n > a[2]) return
      let o = [i[0], i[1], i[2]],
        s = [a[0], a[1], a[2]],
        c = [e, t, n],
        l = () => {
          let e = 0
          for (let t = 0; t < 3; t++) {
            let n = (o[t] + s[t]) * 0.5
            n < c[t] ? ((e |= 1 << t), (o[t] = n)) : (s[t] = n)
          }
          return e
        },
        u = this.nodes,
        d = 0
      for (; !(u[d] & 1);) d = (u[d] >>> 9) + l()
      let f = l(),
        p = l()
      this.matchRegions(d, cy[f] + ly[p], r)
    }
    visibleCellsAt(e, t, n) {
      let r = []
      if ((this.clustersAt(e, t, n, r), r.length === 0)) return null
      if (r.length === 1) return this.visibleCells(r[0])
      let i = this.scratch
      i.fill(0)
      for (let e of r) {
        let t = this.visibleCells(e)
        if (!t) return null
        for (let e = 0; e < t.length; e++) i[e] |= t[e]
      }
      return i
    }
    visibleCells(e) {
      if (e < 0 || e >= this.rowIndex.length) return null
      let t = this.info.rowBytes,
        n = this.rowIndex[e] * t
      return this.rows.subarray(n, n + t)
    }
    matchRegions(e, t, n) {
      let r = this.info.clusters,
        i = this.nodes[e],
        a = (i >>> 1) & 255,
        o = i >>> 9,
        s = +(t >= 32),
        c = t & 31
      for (let e = 0; e < a; e++) {
        let t = this.regions[o + e],
          i = t & 32767
        if (i >= r) continue
        let a = t >>> 15
        ;(this.masks[a * 2 + s] >>> c) & 1 && n.push(i)
      }
    }
  },
  dy = 3200,
  fy = 1,
  py = 6,
  my = 65535,
  hy = 5,
  gy = !1,
  _y = () => {},
  vy = class {
    group = new zn()
    renderer
    manifest = null
    baseUrl = ``
    lodError = 0
    drawingBuffer = new z()
    generation = 0
    downloadedBytes = 0
    shared = {}
    classUniforms = new Map()
    overlay = { value: null }
    materials = new Map()
    mapTextures = []
    staticTextures = []
    geometryRoot = null
    partMeshes = []
    objects = []
    objectMeshes = []
    objectBoxes = []
    doorRotations = new Map()
    objectRotations = new Map()
    objectTimeline = null
    objectRecords = void 0
    objectPose = { visible: !0, pitch: 0, yaw: 0, roll: 0 }
    visibility = null
    culler = new Iv()
    probeBoxes = []
    lightGrid = null
    skyTexture = null
    lastCluster = -1
    clearListeners = new Set()
    pvsEnabled = !0
    constructor(e) {
      ;((this.renderer = e), (this.group.name = `CS2Map`))
    }
    get loaded() {
      return this.manifest !== null && this.geometryRoot !== null
    }
    get currentManifest() {
      return this.manifest
    }
    get stats() {
      let e = 0,
        t = 0
      for (let n of this.partMeshes) ((e += n.triangles), (t += n.visible ? n.visibleTriangles : 0))
      return {
        chunks: this.partMeshes.length,
        triangles: e,
        visibleTriangles: t,
        cluster: this.lastCluster,
        downloadedBytes: this.downloadedBytes,
      }
    }
    async load(e, t, n) {
      this.clear()
      let r = this.generation,
        i = `map:${e}`,
        a = await fv(i)
      if (!a || r !== this.generation) return !1
      let o
      try {
        o = await this.loadFrom(a, e, t, n)
      } catch (e) {
        if (!(await this.packageMoved(i, a, r))) throw e
        o = null
      }
      if (o !== null) return o
      let s = await this.packageMoved(i, a, r)
      return s ? (this.clear(), (await this.loadFrom(s, e, t, n)) ?? !1) : !1
    }
    async packageMoved(e, t, n) {
      if (n !== this.generation) return null
      let r = await pv(e, t)
      return n === this.generation ? r : null
    }
    async loadFrom(e, t, n, r) {
      let i = this.generation
      this.pvsEnabled = n.visibilityCulling
      let a, o
      try {
        o = await fetch(`${e}map.json`)
      } catch {
        return !1
      }
      if (o.status === 404) return null
      if (!o.ok || (o.headers.get(`content-type`) ?? ``).includes(`text/html`)) return !1
      try {
        a = await o.json()
      } catch {
        return !1
      }
      if (i !== this.generation) return !1
      if (a.format !== `cs2render` || a.version !== hy)
        throw Error(`unsupported CS2 map package (${a.format} v${a.version})`)
      let s = vv(this.renderer)
      return s.length > 0
        ? (console.warn(`[cs2map] GPU lacks ${s.join(`, `)}; using the classified map`), !1)
        : ((this.manifest = a),
          (this.baseUrl = e),
          r?.(`Loading ${t} lighting…`),
          await this.loadStatic(a),
          !(
            i !== this.generation ||
            (r?.(`Loading ${t} textures…`), await this.loadTextures(a, i), i !== this.generation) ||
            (await this.loadGeometry(a, i, (e, n) => r?.(`Loading ${t} geometry ${e}/${n}…`)), i !== this.generation)
          ))
    }
    installGrading() {
      let e = this.manifest
      if (!e) return !1
      let t = this.lutCurve
      return sy(e.post, t)
    }
    sceneEnvironment() {
      let e = this.manifest
      if (!e) return null
      let { sun: t } = e.scene,
        n = Sv(e)
      return {
        fogColor: new U().setRGB(n.color[0], n.color[1], n.color[2], Xe),
        fogStart: n.start,
        fogEnd: n.end,
        skyColor: new U().setRGB(t.skyColor[0], t.skyColor[1], t.skyColor[2], Xe),
        sunDirection: new B(...t.direction).normalize(),
        sunColor: new U().setRGB(t.color[0], t.color[1], t.color[2], Xe),
        exposure: e.post.exposure,
        sky: this.skyTexture && e.sky ? { map: this.skyTexture, vMax: e.sky.vMax } : null,
      }
    }
    environmentUniforms() {
      return this.manifest && `uProbes` in this.shared ? this.shared : null
    }
    onClear(e) {
      return (this.clearListeners.add(e), () => this.clearListeners.delete(e))
    }
    fallbackProbeRow(e) {
      return Gv(this.probeBoxes, e)
    }
    loadLightGrid() {
      let e = this.manifest?.lightGrid
      return e
        ? ((this.lightGrid ??= this.fetchBuffer(e.file)
            .then((t) => zv.load(e, t))
            .catch(
              (e) => (console.warn(`[cs2map] light grid unavailable; dynamic objects use flat lighting`, e), null),
            )),
          this.lightGrid)
        : Promise.resolve(null)
    }
    lutCurve = null
    async loadStatic(e) {
      let [t, n, r, i, o] = await Promise.all([
        this.fetchBuffer(e.materials.file),
        this.fetchBuffer(e.probes.file),
        e.post.lut ? this.fetchBuffer(e.post.lut.file).catch(() => null) : Promise.resolve(null),
        e.visibility
          ? this.fetchBuffer(e.visibility.file).catch(
              (e) => (console.warn(`[cs2map] visibility unavailable; drawing without PVS culling`, e), null),
            )
          : Promise.resolve(null),
        e.sky
          ? this.fetchBuffer(e.sky.file).catch(
              (e) => (console.warn(`[cs2map] sky panorama unavailable; using a gradient sky`, e), null),
            )
          : Promise.resolve(null),
      ])
      this.visibility = e.visibility && i ? new uy(e.visibility, i) : null
      let { count: s, texels: l } = e.materials,
        u = new Hi(new Float32Array(t, 0, s * l * 4), l, s, k, b)
      ;((u.minFilter = u.magFilter = c), (u.generateMipmaps = !1), (u.needsUpdate = !0))
      let d = xv(yv(n), { array: !0, repeat: !1 }),
        f = Wv(e.probes.volumes, e.bounds)
      ;(f.overflowCells > 0 && console.warn(`[cs2map] ${f.overflowCells} probe grid cells exceed the candidate limit`),
        (this.probeBoxes = f.boxes),
        (this.lutCurve = r && e.post.lut ? ay(new Uint8Array(r), e.post.lut.size) : null))
      let { sun: p } = e.scene,
        m = Sv(e),
        h = new B(...p.direction).normalize(),
        g = Math.max(0.001, m.end - m.start),
        _ = m.heightStart - m.heightEnd,
        v = new sn(1 / g, -m.start / g, 0, 1)
      ;(m.height && Math.abs(_) > 0.001 && v.set(v.x, v.y, 1 / _, -m.heightEnd / _),
        Object.assign(this.shared, {
          uMaterials: { value: u },
          uProbes: { value: d },
          uProbeData: { value: f.data },
          uProbeGrid: { value: f.grid },
          uGridOrigin: { value: f.origin },
          uGridInvCell: { value: new B(1, 1, 1).divide(f.cellSize) },
          uGridMax: { value: f.dims.clone().subScalar(1) },
          uProbeMaxLod: { value: Math.max(0, e.probes.levels - 1) },
          uSunDir: { value: h },
          uSunColor: { value: new B(...p.color) },
          uFogColor: { value: new B(...m.color) },
          uFogParams: { value: v },
          uFogShape: { value: new B(m.falloffExponent, m.height ? m.verticalExponent : 1, m.maxOpacity) },
          uLmIrradiance: { value: null },
          uLmDirectional: { value: null },
          uLmShadows: { value: null },
        }),
        (this.staticTextures = [u, d, f.data, f.grid]),
        o &&
          ((this.skyTexture = xv(yv(o), { array: !1, repeat: !1 })),
          (this.skyTexture.wrapS = a),
          this.staticTextures.push(this.skyTexture)))
      for (let e of this.staticTextures) this.upload(e)
    }
    async loadTextures(e, t) {
      let n = e.textures,
        r = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
        i = [],
        a = async (e, t, n) => {
          let a = xv(yv(await this.fetchBuffer(e)), { array: t, repeat: n, anisotropy: n ? r : 1 })
          return (i.push(a), a)
        },
        o = Object.keys(n.classes),
        s = [],
        c = new Map()
      for (let e of o) {
        let t = n.classes[e],
          r = {}
        ;(c.set(e, r),
          s.push(async () => {
            r.color = await a(t.color, !0, !0)
          }),
          s.push(async () => {
            r.normal = await a(t.normal, !0, !0)
          }),
          s.push(async () => {
            r.mask = await a(t.mask, !0, !0)
          }))
      }
      let l = null,
        u = null,
        d = null,
        f = null,
        p = n.overlay?.file
      ;(p &&
        s.push(async () => {
          l = await a(p, !0, !0)
        }),
        s.push(async () => {
          u = await a(n.lightmaps.irradiance, !1, !1)
        }),
        s.push(async () => {
          d = await a(n.lightmaps.directional, !1, !1)
        }),
        s.push(async () => {
          f = await a(n.lightmaps.shadows, !1, !1)
        }))
      try {
        await jy(s, py)
      } catch (e) {
        for (let e of i) e.dispose()
        throw e
      }
      if (t !== this.generation) {
        for (let e of i) e.dispose()
        return
      }
      for (let e of i) this.upload(e)
      for (let [e, t] of c) {
        let n = this.classUniformsFor(e)
        ;((n.color.value = t.color ?? null), (n.normal.value = t.normal ?? null), (n.mask.value = t.mask ?? null))
      }
      ;((this.overlay.value = l),
        (this.shared.uLmIrradiance.value = u),
        (this.shared.uLmDirectional.value = d),
        (this.shared.uLmShadows.value = f),
        (this.mapTextures = i))
    }
    async loadGeometry(e, t, n) {
      let r = e.geometry,
        i = new Map()
      for (let e of r.chunks) {
        let t = i.get(e.file)
        t ? t.push(e) : i.set(e.file, [e])
      }
      ;(Ey(), await $_.ready)
      let a = new zn()
      a.name = `CS2MapGeometry`
      let o = [],
        s = [...i.keys()],
        c = 0
      n?.(0, s.length)
      try {
        await jy(
          s.map((e) => async () => {
            let l = new Uint8Array(await this.fetchBuffer(`${r.dir}/${e}`)),
              u = await Promise.all(i.get(e).map((e) => this.buildChunk(e, l)))
            if (t !== this.generation) {
              for (let e of u) e.geometry.dispose()
              return
            }
            for (let e of u) (a.add(e), o.push(e))
            n?.(++c, s.length)
          }),
          py,
        )
      } catch (e) {
        throw (Ay(a), e)
      }
      if (t !== this.generation) {
        Ay(a)
        return
      }
      ;(this.uploadGeometry(a, o),
        (this.geometryRoot = a),
        (this.partMeshes = o),
        (this.lodError = r.lodError),
        this.setupObjects(e.objects ?? [], o, r.chunks),
        this.group.add(a))
    }
    setupObjects(e, t, n) {
      ;((this.objects = e), (this.objectMeshes = e.map(() => [])), (this.objectBoxes = e.map(() => null)))
      for (let t of n) {
        let n = t.object ?? 0
        if (n <= 0 || n > e.length) continue
        let r = new lr(new B(...t.boxMin), new B(...t.boxMax))
        this.objectBoxes[n - 1] = this.objectBoxes[n - 1]?.union(r) ?? r
      }
      for (let n of t) n.objectId > 0 && n.objectId <= e.length && this.objectMeshes[n.objectId - 1].push(n)
      ;(e.forEach((e, t) => {
        let n = this.objectMeshes[t]
        if (e.kind !== `door` || n.length === 0) return
        let r = new B(...e.origin),
          i = 0
        for (let e of n) i = Math.max(i, e.sphere.center.distanceTo(r) + e.sphere.radius)
        let a = this.objectRotationUniform(e.id)
        for (let e of n) ((e.movable = !0), e.sphere.set(r.clone(), i))
        this.doorRotations.set(t, { uniform: a, bases: n.map((e) => e.matrix.clone()) })
      }),
        (this.objectTimeline = null),
        (this.objectRecords = void 0))
    }
    get mapObjects() {
      return this.objects
    }
    get objectState() {
      return this.objectTimeline
    }
    objectBox(e) {
      return this.objectBoxes[e] ?? null
    }
    fileUrl(e) {
      return `${this.baseUrl}${e}`
    }
    updateObjects(e, t) {
      if (this.objects.length === 0) return
      ;(!this.objectTimeline || e !== this.objectRecords) &&
        ((this.objectTimeline = new Av(this.objects, e)), (this.objectRecords = e))
      let n = this.objectTimeline,
        r = this.objectPose
      this.objects.forEach((e, i) => {
        n.poseAt(i, t, r)
        let a = this.objectMeshes[i]
        for (let e of a) e.objectHidden = !r.visible
        let o = this.doorRotations.get(i)
        if (!o || !r.visible) return
        let s = Ty(r.pitch, r.yaw, r.roll, by).multiply(Sy.copy(Ty(e.angles[0], e.angles[1], e.angles[2], xy)).invert())
        o.uniform.value.setFromMatrix4(s)
        let [c, l, u] = e.origin
        ;(Cy.makeTranslation(c, l, u)
          .multiply(s)
          .multiply(wy.makeTranslation(-c, -l, -u)),
          a.forEach((e, t) => {
            ;(e.matrix.multiplyMatrices(Cy, o.bases[t]), (e.matrixWorldNeedsUpdate = !0))
          }))
      })
    }
    uploadGeometry(e, t) {
      let n = new Jn(),
        r = new Es(),
        i = new ln(1, 1),
        a = this.renderer.getRenderTarget(),
        o = t.map((e) => e.frustumCulled)
      n.add(e)
      for (let e of t)
        ((e.frustumCulled = !1),
          (e.visible = !0),
          (e._multiDrawStarts[0] = 0),
          (e._multiDrawCounts[0] = Math.min(3, e.geometry.index?.count ?? 0)),
          (e._multiDrawCount = 1))
      try {
        ;(this.renderer.setRenderTarget(i), this.renderer.render(n, r))
      } finally {
        ;(this.renderer.setRenderTarget(a),
          n.remove(e),
          i.dispose(),
          t.forEach((e, t) => {
            ;((e.frustumCulled = o[t]), (e.visible = !1), (e._multiDrawCount = 0))
          }))
      }
    }
    update(e, t) {
      if (this.partMeshes.length === 0) return
      ;(e.updateMatrixWorld(), this.group.updateWorldMatrix(!0, !1))
      let n = this.culler
      n.setView(e, this.group)
      let { x: r, y: i, z: a } = n.camera,
        o = this.pvsEnabled && t ? this.visibility : null
      ;((this.lastCluster = o ? o.clusterAt(r, i, a) : -1),
        (n.cells = o ? o.visibleCellsAt(r, i, a) : null),
        (n.detailDistance = dy),
        (n.lodDistance = this.lodDistance(e)))
      for (let e of this.partMeshes) n.cull(e)
    }
    lodDistance(e) {
      if (this.lodError <= 0) return 1 / 0
      let t = fy,
        n = this.renderer.getDrawingBufferSize(this.drawingBuffer).y
      if (e instanceof xs) {
        let r = (n * e.zoom) / (2 * Math.tan(Vt.degToRad(e.fov) / 2))
        return (this.lodError * r) / t
      }
      if (e instanceof Es) {
        let r = (n * e.zoom) / (e.top - e.bottom)
        return this.lodError * r <= t ? 0 : 1 / 0
      }
      return 1 / 0
    }
    async buildChunk(e, t) {
      let n = (n) => {
          let [r, i, a, o] = e.streams[n]
          return $_.decodeGltfBufferAsync(e.vertexCount, a, t.subarray(r, r + i), `ATTRIBUTES`, o)
        },
        r = (e, [n, r]) => $_.decodeGltfBufferAsync(e, 2, t.subarray(n, n + r), `TRIANGLES`),
        i = Object.keys(e.streams),
        a = e.lod,
        [o, s, ...c] = await Promise.all([
          r(e.indexCount, e.index),
          a ? r(a.indexCount, a.index) : Promise.resolve(null),
          ...i.map(n),
        ]),
        l = new Vr()
      i.forEach((t, n) => {
        let r = c[n],
          i = e.streams[t][2],
          a = Dy(t, r, i)
        a && l.setAttribute(a.name, a.attribute)
      })
      let u = new Uint16Array(o.buffer, o.byteOffset, e.indexCount),
        d = u
      ;(a &&
        s &&
        ((d = new Uint16Array(e.indexCount + a.indexCount)),
        d.set(u),
        d.set(new Uint16Array(s.buffer, s.byteOffset, a.indexCount), e.indexCount)),
        l.setIndex(new W(d, 1)))
      for (let e of [...Object.values(l.attributes), l.index]) e.onUpload(Oy)
      let f = my / 2
      ;((l.boundingSphere = new Nr(new B(f, f, f), f * Math.sqrt(3))),
        (l.boundingBox = new lr(new B(0, 0, 0), new B(my, my, my))))
      let p = new B(...e.boxMin),
        m = new B(...e.boxMax),
        h = ([e, n], r) => ({ view: new DataView(t.buffer, t.byteOffset + e, n * 24), count: n, firstIndex: r }),
        g = h(e.parts, 0),
        _ = a ? h(a.parts, e.indexCount) : null,
        v = new Fv(l, this.materialFor(e), e.indexCount / 3, g, _, p, m, e.detail)
      v.objectId = e.object ?? 0
      let y = m
        .clone()
        .sub(p)
        .max(new B(0.001, 0.001, 0.001))
        .divideScalar(my)
      return (
        (v.matrixAutoUpdate = !1),
        v.matrix.makeScale(y.x, y.y, y.z).setPosition(p),
        (v.raycast = _y),
        e.family === `translucent` && (v.renderOrder = 1),
        v
      )
    }
    classUniformsFor(e) {
      let t = this.classUniforms.get(e)
      return (
        t ||
          ((t = { color: { value: null }, normal: { value: null }, mask: { value: null } }),
          this.classUniforms.set(e, t)),
        t
      )
    }
    objectRotationUniform(e) {
      let t = this.objectRotations.get(e)
      return (t || ((t = { value: new V() }), this.objectRotations.set(e, t)), t)
    }
    materialFor(e) {
      let t = e.object ? this.manifest?.objects?.[e.object - 1]?.kind === `door` : !1,
        n = `${e.family}|${e.doubleSided ? 2 : 1}|${e.class1}|${e.class2}${t ? `|door${e.object}` : ``}`,
        r = this.materials.get(n)
      if (r) return r
      let i = e.family === `blend`,
        a = e.family === `alphatest`,
        o = e.family === `translucent`,
        s = this.classUniformsFor(e.class1),
        c = { ...this.shared, uColor1: s.color, uNormal1: s.normal, uMask1: s.mask }
      if (i) {
        let t = this.classUniformsFor(e.class2 || e.class1)
        Object.assign(c, { uColor2: t.color, uNormal2: t.normal, uMask2: t.mask, uOverlay: this.overlay })
      }
      if (
        (t && (c.uObjectRotation = this.objectRotationUniform(e.object)),
        (r = new To({
          name: `CS2_${n}`,
          vertexShader: Xv,
          fragmentShader: Zv,
          uniforms: c,
          defines: Kv({ blend: i, alphaTest: a, translucent: o, doubleSided: e.doubleSided, movable: t }),
          side: e.doubleSided ? 2 : 0,
          transparent: o,
          depthWrite: !o,
          polygonOffset: o,
          polygonOffsetFactor: o ? -1 : 0,
          polygonOffsetUnits: o ? -4 : 0,
          alphaToCoverage: a,
          fog: !1,
          lights: !1,
        })),
        !o)
      ) {
        let e = new To({
          name: `CS2Depth_${n}`,
          vertexShader: Qv,
          fragmentShader: $v,
          uniforms: a ? { uMaterials: this.shared.uMaterials, uColor1: s.color } : {},
          defines: a ? { CS2_ALPHATEST: `` } : {},
          side: r.side,
          colorWrite: !1,
          fog: !1,
          lights: !1,
        })
        ;((r.userData.depthMaterial = e), r.addEventListener(`dispose`, () => e.dispose()))
      }
      return (this.materials.set(n, r), r)
    }
    upload(e) {
      ;((e.onUpdate = ky), this.renderer.initTexture(e))
    }
    async fetchBuffer(e) {
      let t = `${this.baseUrl}${e}`,
        n = await fetch(t)
      if (!n.ok) throw Error(`CS2 map fetch failed: ${n.status} ${n.statusText} (${t})`)
      let r = await n.arrayBuffer()
      this.downloadedBytes += r.byteLength
      let i = new Uint8Array(r, 0, Math.min(2, r.byteLength))
      if (this.manifest?.compression === `gzip` && i[0] === 31 && i[1] === 139) {
        let e = new Blob([r]).stream().pipeThrough(new DecompressionStream(`gzip`))
        return new Response(e).arrayBuffer()
      }
      return r
    }
    clear() {
      for (let e of [...this.clearListeners]) e()
      ;(this.generation++,
        this.geometryRoot && (this.group.remove(this.geometryRoot), Ay(this.geometryRoot)),
        (this.geometryRoot = null),
        (this.partMeshes = []),
        (this.objects = []),
        (this.objectMeshes = []),
        (this.objectBoxes = []),
        this.doorRotations.clear(),
        this.objectRotations.clear(),
        (this.objectTimeline = null),
        (this.objectRecords = void 0),
        (this.visibility = null),
        (this.lastCluster = -1),
        (this.probeBoxes = []),
        (this.lightGrid = null))
      for (let e of this.materials.values()) e.dispose()
      this.materials.clear()
      for (let e of [...this.mapTextures, ...this.staticTextures]) e.dispose()
      ;((this.mapTextures = []),
        (this.staticTextures = []),
        (this.skyTexture = null),
        this.classUniforms.clear(),
        (this.overlay.value = null))
      for (let e of Object.keys(this.shared)) delete this.shared[e]
      ;((this.manifest = null), (this.lutCurve = null), (this.downloadedBytes = 0))
    }
    dispose() {
      ;(this.generation++, this.clear(), this.group.removeFromParent())
    }
  },
  yy = new xn(),
  by = new H(),
  xy = new H(),
  Sy = new H(),
  Cy = new H(),
  wy = new H()
function Ty(e, t, n, r) {
  let i = Math.PI / 180
  return r.makeRotationFromEuler(yy.set(n * i, e * i, t * i, `ZYX`))
}
function Ey() {
  if (gy) return
  gy = !0
  let e = (typeof navigator < `u` && navigator.hardwareConcurrency) || 4
  $_.useWorkers(Math.max(1, Math.min(4, e - 1)))
}
function Dy(e, t, n) {
  let { buffer: r, byteOffset: i, byteLength: a } = t
  switch (e) {
    case `pos`:
      return { name: `aPos`, attribute: new W(new Uint16Array(r, i, a / 2), 4, !1) }
    case `nrm`:
      return { name: `aNrm`, attribute: new W(new Uint8Array(r, i, a), 4, !1) }
    case `uv`:
      return { name: `aUv`, attribute: new W(new Float32Array(r, i, a / 4), n / 4) }
    case `lm`:
      return { name: `aLm`, attribute: new W(new Uint16Array(r, i, a / 2), 2, !1) }
    case `col`:
      return { name: `aCol`, attribute: new W(new Uint8Array(r, i, a), 4, !0) }
    case `bld`:
      return { name: `aBld`, attribute: new W(new Uint8Array(r, i, a), 4, !0) }
    case `ovl`:
      return { name: `aOvl`, attribute: new W(new Float32Array(r, i, a / 4), 2) }
    default:
      return null
  }
}
function Oy() {
  this.array = new this.array.constructor(0)
}
function ky(e) {
  ;(e.isCompressedTexture && (e.mipmaps = []), (e.onUpdate = null))
}
function Ay(e) {
  e.traverse((e) => {
    let t = e
    t.isMesh && t.geometry.dispose()
  })
}
async function jy(e, t) {
  let n = 0
  await Promise.all(
    Array.from({ length: Math.min(t, e.length) }, async () => {
      for (; n < e.length;) {
        let t = e[n++]
        await t()
      }
    }),
  )
}
var My = [
    `uProbes`,
    `uProbeData`,
    `uProbeGrid`,
    `uGridOrigin`,
    `uGridInvCell`,
    `uGridMax`,
    `uProbeMaxLod`,
    `uSunDir`,
    `uSunColor`,
    `uFogColor`,
    `uFogParams`,
    `uFogShape`,
  ],
  Ny = [`uProbes`, `uProbeData`, `uProbeGrid`],
  Py = 1 / 0.0254
function Fy() {
  return {
    uAmbient: { value: new Float32Array(18) },
    uSunVisibility: { value: 1 },
    uFallbackProbe: { value: 0 },
    uFlashPos: { value: new sn() },
    uFlashColor: { value: new B() },
  }
}
function Iy(e, t) {
  ;(e.uAmbient.value.set(t.ambient), (e.uSunVisibility.value = t.sunVisibility), (e.uFallbackProbe.value = t.probeRow))
}
