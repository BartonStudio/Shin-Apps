// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 31492–32300 行（切片 12/40）
// 角色：场景光照管理 Ly：usesCs2Map/setCs2/setClassic/createMaterial/ambientCube
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var Ly = class {
  environment = {
    uProbes: { value: null },
    uProbeData: { value: null },
    uProbeGrid: { value: null },
    uGridOrigin: { value: new B() },
    uGridInvCell: { value: new B(1, 1, 1) },
    uGridMax: { value: new B() },
    uProbeMaxLod: { value: 0 },
    uSunDir: { value: new B(0, 0, 1) },
    uSunColor: { value: new B(1, 1, 1) },
    uFogColor: { value: new B() },
    uFogParams: { value: new sn(0, 0, 0, 1) },
    uFogShape: { value: new B(1, 1, 0) },
  }
  view = { uViewToWorld: { value: new V() }, uViewOrigin: { value: new B() }, uViewScale: { value: Py } }
  map = null
  unsubscribeMap = null
  grid = null
  generation = 0
  flat = Rv()
  materials = new Set()
  point = new B()
  cs2 = !1
  lightingVersion = 0
  get usesCs2Map() {
    return this.map !== null
  }
  get version() {
    return this.lightingVersion
  }
  setCs2Map(e) {
    let t = e.environmentUniforms()
    if (!t) return !1
    this.releaseMap()
    let n = ++this.generation
    ;(this.lightingVersion++,
      (this.map = e),
      (this.unsubscribeMap = e.onClear(() => this.releaseMap())),
      (this.grid = null))
    for (let e of My) this.environment[e].value = t[e].value
    let r = t.uSunColor.value,
      i = t.uFogColor.value
    return (
      Ry(this.flat, [i.x, i.y, i.z], [r.x * 0.08, r.y * 0.07, r.z * 0.06], 0.5),
      this.setCs2(!0),
      e.loadLightGrid().then((e) => {
        n === this.generation && ((this.grid = e), this.lightingVersion++)
      }),
      !0
    )
  }
  setClassic(e) {
    ;(this.releaseMap(), this.generation++, this.lightingVersion++)
    let t = this.environment
    ;(t.uSunDir.value.copy(e.sunDirection).normalize(), t.uSunColor.value.set(e.sunColor.r, e.sunColor.g, e.sunColor.b))
    let n = e.fog
    if (n) {
      let e = Math.max(0.001, n.far - n.near)
      ;(t.uFogColor.value.set(n.color.r, n.color.g, n.color.b),
        t.uFogParams.value.set(1 / e, -n.near / e, 0, 1),
        t.uFogShape.value.set(1, 1, 1))
    } else t.uFogShape.value.set(1, 1, 0)
    let r = e.skyColor,
      i = e.groundColor
    ;(Ry(this.flat, [r.r, r.g, r.b], [i.r, i.g, i.b], 0.5), this.setCs2(!1))
  }
  sample(e, t, n, r) {
    return (
      this.grid ? this.grid.sample(e, t, n, r) : (r.ambient.set(this.flat.ambient), (r.sunVisibility = 1)),
      (r.probeRow = this.map ? this.map.fallbackProbeRow(this.point.set(e, t, n)) : 0),
      r
    )
  }
  setView(e) {
    ;(this.view.uViewToWorld.value.setFromMatrix4(e.matrixWorld),
      this.view.uViewOrigin.value.setFromMatrixPosition(e.matrixWorld))
  }
  createMaterial(e) {
    let t = e.surface === `textured`,
      n = {}
    ;(t && (n.WEAPON_TEXTURED = ``),
      t && e.ormMap && (n.WEAPON_ORM_MAP = ``),
      t && e.normalMap && (n.WEAPON_NORMAL_MAP = ``),
      e.viewSpace && (n.WEAPON_VIEW_SPACE = ``),
      e.glass && (n.WEAPON_GLASS = ``),
      e.fade && (n.WEAPON_FADE = ``),
      e.tint && !t && (n.WEAPON_TINT = ``),
      this.cs2 && (n.CS2_PROBES = ``))
    let r = new To({
      name: `CS2Weapon`,
      defines: n,
      uniforms: {
        ...this.environment,
        ...(e.viewSpace ? this.view : {}),
        ...(e.object ?? Fy()),
        uColorMap: { value: e.map ?? null },
        uOrmMap: { value: e.ormMap ?? null },
        uOrmFactors: { value: new B(...(e.ormFactors ?? [1, 1, 1])) },
        uNormalMap: { value: e.normalMap ?? null },
        uAlphaTest: { value: e.alphaTest ?? 0 },
        uFade: { value: 1 },
        uTint: { value: new B(1, 1, 1) },
      },
      vertexShader: zy,
      fragmentShader: By,
      side: e.side ?? (e.glass ? 2 : 0),
      fog: !1,
      lights: !1,
      transparent: e.glass ?? !1,
      depthWrite: !e.glass,
      premultipliedAlpha: e.glass ?? !1,
    })
    if ((this.materials.add(r), r.addEventListener(`dispose`, () => this.materials.delete(r)), e.alphaTest && e.map)) {
      let t = new Ao({ map: e.map, alphaTest: e.alphaTest, side: r.side, colorWrite: !1 })
      ;((r.userData.depthMaterial = t), r.addEventListener(`dispose`, () => t.dispose()))
    }
    return r
  }
  releaseMap() {
    if (!this.map) return
    ;(this.unsubscribeMap?.(),
      (this.unsubscribeMap = null),
      (this.map = null),
      (this.grid = null),
      this.generation++,
      this.lightingVersion++)
    let e = this.environment
    for (let t of Ny) e[t].value = null
    for (let t of My) {
      let n = e[t].value
      n && typeof n.clone == `function` && (e[t].value = n.clone())
    }
    this.setCs2(!1)
  }
  setCs2(e) {
    if (e !== this.cs2) {
      this.cs2 = e
      for (let t of this.materials)
        (e ? (t.defines.CS2_PROBES = ``) : delete t.defines.CS2_PROBES, (t.needsUpdate = !0))
    }
  }
}
function Ry(e, t, n, r) {
  for (let i = 0; i < 3; i++) {
    let a = t[i] * r + n[i] * (1 - r)
    for (let t = 0; t < 4; t++) e.ambient[t * 3 + i] = a
    ;((e.ambient[12 + i] = t[i]), (e.ambient[15 + i] = n[i]))
  }
}
var zy = `
#include <skinning_pars_vertex>

#ifdef WEAPON_TEXTURED
varying vec2 vUv;
#else
#ifdef WEAPON_TINT
attribute vec4 aAlbedo;
uniform vec3 uTint;
#else
attribute vec3 aAlbedo;
#endif
attribute vec3 aOrm;
varying vec3 vAlbedo;
varying vec3 vOrm;
#endif
#ifdef WEAPON_VIEW_SPACE
uniform mat3 uViewToWorld;
uniform vec3 uViewOrigin;
uniform float uViewScale;
#endif

varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec3 objectNormal = normal;
  vec3 transformed = position;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
#ifdef USE_INSTANCING
  transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  objectNormal = mat3(instanceMatrix) * objectNormal;
#endif
#ifdef WEAPON_TEXTURED
  vUv = uv;
#else
#ifdef WEAPON_TINT
  vAlbedo = aAlbedo.rgb * mix(vec3(1.0), uTint, aAlbedo.a);
#else
  vAlbedo = aAlbedo;
#endif
  vOrm = aOrm;
#endif
#ifdef WEAPON_VIEW_SPACE
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vWorldPos = uViewOrigin + uViewToWorld * (mvPosition.xyz * uViewScale);
  vNormal = uViewToWorld * (normalMatrix * objectNormal);
#else
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  vNormal = mat3(modelMatrix) * objectNormal;
#endif
}
`,
  By = `
precision highp float;
precision highp int;

${qv}
${Jv}
${Yv}

uniform vec3 uAmbient[6];
uniform float uSunVisibility;
uniform int uFallbackProbe;
uniform vec4 uFlashPos;
uniform vec3 uFlashColor;
#ifdef WEAPON_VIEW_SPACE
uniform vec3 uViewOrigin;
#endif
#ifdef WEAPON_TEXTURED
uniform sampler2D uColorMap;
uniform vec3 uOrmFactors;
uniform float uAlphaTest;
#ifdef WEAPON_ORM_MAP
uniform sampler2D uOrmMap;
#endif
#ifdef WEAPON_NORMAL_MAP
uniform sampler2D uNormalMap;
#endif
varying vec2 vUv;
#else
varying vec3 vAlbedo;
varying vec3 vOrm;
#endif

varying vec3 vWorldPos;
varying vec3 vNormal;
#ifdef WEAPON_FADE
uniform float uFade;

float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i.x + i.y * 4] + 0.5) / 16.0;
}
#endif

// Valve's ambient cube: irradiance for a normal from the six axis colours.
vec3 ambientCube(vec3 n) {
  vec3 sq = n * n;
  return sq.x * (n.x >= 0.0 ? uAmbient[0] : uAmbient[1])
    + sq.y * (n.y >= 0.0 ? uAmbient[2] : uAmbient[3])
    + sq.z * (n.z >= 0.0 ? uAmbient[4] : uAmbient[5]);
}

void main() {
#ifdef WEAPON_FADE
  if (bayer4(gl_FragCoord.xy) >= uFade) discard;
#endif
#ifdef WEAPON_TEXTURED
  vec4 color = texture(uColorMap, vUv);
  if (color.a < uAlphaTest) discard;
  vec3 albedo = color.rgb;
#ifdef WEAPON_ORM_MAP
  vec3 orm = texture(uOrmMap, vUv).rgb * uOrmFactors;
#else
  vec3 orm = uOrmFactors;
#endif
#else
  vec3 albedo = vAlbedo;
  // Per-vertex AO is sampled where the vertices are, on edges and in crevices where the AO map is darkest, so every
  // face would interpolate between its darkest values; only a fraction of it is kept.
  vec3 orm = vec3(mix(1.0, vOrm.r, 0.3), vOrm.gb);
#endif
  float ao = orm.r;
  float roughness = orm.g;
  float metalness = orm.b;
#ifdef WEAPON_GLASS
  albedo = vec3(0.05, 0.065, 0.06);
  ao = 1.0;
  roughness = 0.05;
  metalness = 0.0;
#endif

  vec3 geometricNormal = normalize(vNormal);
  if (!gl_FrontFacing) geometricNormal = -geometricNormal;
  vec3 N = geometricNormal;
#ifdef WEAPON_NORMAL_MAP
  // glTF tangent-space normals; +v runs down the texture, so green flips for the derivative frame.
  vec2 xy = texture(uNormalMap, vUv).rg * 2.0 - 1.0;
  vec3 normalTs = vec3(xy.x, -xy.y, sqrt(saturate(1.0 - dot(xy, xy))));
  vec3 dp1 = dFdx(vWorldPos);
  vec3 dp2 = dFdy(vWorldPos);
  vec2 duv1 = dFdx(vUv);
  vec2 duv2 = dFdy(vUv);
  vec3 dp2perp = cross(dp2, geometricNormal);
  vec3 dp1perp = cross(geometricNormal, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invMax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
  N = normalize(T * (normalTs.x * invMax) + B * (normalTs.y * invMax) + geometricNormal * normalTs.z);
#endif

  vec3 dn1 = dFdx(geometricNormal);
  vec3 dn2 = dFdy(geometricNormal);
  roughness = clamp(max(roughness, sqrt(saturate(max(dot(dn1, dn1), dot(dn2, dn2))))), 0.02, 1.0);

  vec3 diffuseColor = albedo * (1.0 - metalness);
  vec3 specColor = mix(vec3(0.04), albedo, metalness);
#ifdef WEAPON_VIEW_SPACE
  vec3 eye = uViewOrigin;
#else
  vec3 eye = cameraPosition;
#endif
  vec3 V = normalize(eye - vWorldPos);
  float NoV = max(dot(N, V), 1e-4);

  vec3 irradiance = ambientCube(N);
  vec3 sunDiffuse;
  vec3 sunSpecular;
  directLight(N, V, uSunDir, NoV, roughness, specColor, uSunColor * uSunVisibility, sunDiffuse, sunSpecular);

  vec3 flashDiffuse = vec3(0.0);
  vec3 flashSpecular = vec3(0.0);
  if (uFlashPos.w > 0.0) {
    vec3 toFlash = uFlashPos.xyz - vWorldPos;
    float distance = length(toFlash);
    float falloff = saturate(1.0 - distance / uFlashPos.w);
    directLight(N, V, toFlash / max(distance, 1e-3), NoV, roughness, specColor, uFlashColor * falloff * falloff, flashDiffuse, flashSpecular);
  }

  vec3 R = normalize(reflect(-V, N));
  float r2 = roughness * roughness;
  float smoothness = saturate(1.0 - r2);
  R = normalize(mix(N, R, smoothness * (sqrt(smoothness) + r2)));
  ProbeResult env;
#ifdef CS2_PROBES
  env = sampleEnvironment(vWorldPos, R, sqrt(roughness) * uProbeMaxLod, uFallbackProbe);
#else
  env.radiance = ambientCube(R);
  env.normalizationSH = vec4(0.0);
#endif
  vec3 specularIndirect;
  vec3 diffuseIndirect;
  indirectLight(env, irradiance, N, roughness, NoV, specColor, specularIndirect, diffuseIndirect);

  vec3 outColor = diffuseColor * ((sunDiffuse + diffuseIndirect) * ao + flashDiffuse)
    + sunSpecular + flashSpecular + specularIndirect * ao;
  outColor = applyFog(outColor, vWorldPos, eye);

#ifdef WEAPON_GLASS
  // Premultiplied: the reflection adds, the pane hides more of what's behind it at grazing angles.
  gl_FragColor = vec4(outColor, mix(0.18, 0.85, pow(1.0 - NoV, 4.0)));
#else
  gl_FragColor = vec4(outColor, 1.0);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
function Vy(e, t = {}) {
  let n = t.creaseDeg ?? 35,
    r = t.ringCreaseDeg ?? 65,
    i = e.getAttribute(`position`),
    a = i.count,
    o = new Uint8Array(a),
    s = t.ringRanges ?? []
  for (let e = 0; e + 1 < s.length; e += 2) o.fill(1, Math.min(s[e], a), Math.min(s[e] + s[e + 1], a))
  let c = e.index ? e.index.array : Uint32Array.from({ length: a }, (e, t) => t),
    l = Math.floor(c.length / 3),
    u = new Float32Array(a * 3)
  for (let e = 0; e < a; e++) ((u[e * 3] = i.getX(e)), (u[e * 3 + 1] = i.getY(e)), (u[e * 3 + 2] = i.getZ(e)))
  let d = new Float32Array(l * 3),
    f = new Float32Array(l * 3),
    p = new Uint32Array(a + 1)
  for (let e = 0; e < l; e++) {
    let t = c[e * 3] * 3,
      n = c[e * 3 + 1] * 3,
      r = c[e * 3 + 2] * 3,
      i = u[n] - u[t],
      a = u[n + 1] - u[t + 1],
      o = u[n + 2] - u[t + 2],
      s = u[r] - u[t],
      l = u[r + 1] - u[t + 1],
      m = u[r + 2] - u[t + 2],
      h = a * m - o * l,
      g = o * s - i * m,
      _ = i * l - a * s,
      v = Math.hypot(h, g, _) || 1
    ;(d.set([h, g, _], e * 3), f.set([h / v, g / v, _ / v], e * 3))
    for (let t = 0; t < 3; t++) p[c[e * 3 + t] + 1]++
  }
  let m = p
  for (let e = 0; e < a; e++) m[e + 1] += m[e]
  let h = m.slice(0, a),
    g = new Uint32Array(l * 3)
  for (let e = 0; e < l; e++) for (let t = 0; t < 3; t++) g[h[c[e * 3 + t]]++] = e
  let _ = Math.cos(Vt.degToRad(n)),
    v = Math.cos(Vt.degToRad(r)),
    y = new Uint32Array(l * 3),
    b = [],
    x = [],
    S = []
  for (let e = 0; e < a; e++) {
    let t = m[e],
      n = m[e + 1] - t
    S.length = n
    for (let e = 0; e < n; e++) S[e] = e
    let r = (e) => {
      for (; S[e] !== e;) e = S[e] = S[S[e]]
      return e
    }
    for (let i = 0; i < n; i++) {
      let a = g[t + i]
      for (let s = i + 1; s < n; s++) {
        let n = g[t + s],
          l = -1
        for (let t = 0; t < 3 && l < 0; t++) {
          let r = c[a * 3 + t]
          r !== e && (r === c[n * 3] || r === c[n * 3 + 1] || r === c[n * 3 + 2]) && (l = r)
        }
        l < 0 ||
          (f[a * 3] * f[n * 3] + f[a * 3 + 1] * f[n * 3 + 1] + f[a * 3 + 2] * f[n * 3 + 2] >=
            (o[e] === 1 && o[l] === 1 ? v : _) &&
            (S[r(i)] = r(s)))
      }
    }
    let i = new Map()
    for (let a = 0; a < n; a++) {
      let n = r(a),
        o = i.get(n)
      o === void 0 && ((o = b.length), i.set(n, o), b.push(e), x.push(0, 0, 0))
      let s = g[t + a]
      for (let e = 0; e < 3; e++) x[o * 3 + e] += d[s * 3 + e]
      for (let t = 0; t < 3; t++) c[s * 3 + t] === e && (y[s * 3 + t] = o)
    }
  }
  let C = new Vr()
  for (let [t, n] of Object.entries(e.attributes)) t !== `normal` && C.setAttribute(t, Hy(n, b))
  let w = new Float32Array(x.length)
  for (let e = 0; e < x.length; e += 3) {
    let t = Math.hypot(x[e], x[e + 1], x[e + 2]) || 1
    ;((w[e] = x[e] / t), (w[e + 1] = x[e + 1] / t), (w[e + 2] = x[e + 2] / t))
  }
  return (C.setAttribute(`normal`, new W(w, 3)), C.setIndex(new W(b.length <= 65535 ? Uint16Array.from(y) : y, 1)), C)
}
function Hy(e, t) {
  let n = e.itemSize,
    r = e instanceof Wr,
    i = r ? e.data.array : e.array,
    a = r ? e.data.stride : n,
    o = r ? e.offset : 0,
    s = i.constructor,
    c = new s(t.length * n)
  for (let e = 0; e < t.length; e++) for (let r = 0; r < n; r++) c[e * n + r] = i[t[e] * a + o + r]
  return new W(c, n, e.normalized)
}
var Uy = `modulepreload`,
  Wy = function (e) {
    return `/` + e
  },
  Gy = {},
  Ky = function (e, t, n) {
    let r = Promise.resolve()
    if (t && t.length > 0) {
      let e = document.getElementsByTagName(`link`),
        i = document.querySelector(`meta[property=csp-nonce]`),
        a = i?.nonce || i?.getAttribute(`nonce`)
      function o(e) {
        return Promise.all(
          e.map((e) =>
            Promise.resolve(e).then(
              (e) => ({ status: `fulfilled`, value: e }),
              (e) => ({ status: `rejected`, reason: e }),
            ),
          ),
        )
      }
      r = o(
        t.map((t) => {
          if (((t = Wy(t, n)), t in Gy)) return
          Gy[t] = !0
          let r = t.endsWith(`.css`),
            i = r ? `[rel="stylesheet"]` : ``
          if (n)
            for (let n = e.length - 1; n >= 0; n--) {
              let i = e[n]
              if (i.href === t && (!r || i.rel === `stylesheet`)) return
            }
          else if (document.querySelector(`link[href="${t}"]${i}`)) return
          let o = document.createElement(`link`)
          if (
            ((o.rel = r ? `stylesheet` : Uy),
            r || (o.as = `script`),
            (o.crossOrigin = ``),
            (o.href = t),
            a && o.setAttribute(`nonce`, a),
            document.head.appendChild(o),
            r)
          )
            return new Promise((e, n) => {
              ;(o.addEventListener(`load`, e),
                o.addEventListener(`error`, () => n(Error(`Unable to preload CSS for ${t}`))))
            })
        }),
      )
    }
    function i(e) {
      let t = new Event(`vite:preloadError`, { cancelable: !0 })
      if (((t.payload = e), window.dispatchEvent(t), !t.defaultPrevented)) throw e
    }
    return r.then((t) => {
      for (let e of t || []) e.status === `rejected` && i(e.reason)
      return e().catch(i)
    })
  },
  qy = {
    "AK-47": `ak47`,
    M4A4: `m4a4`,
    "M4A1-S": `m4a1_silencer`,
    AWP: `awp`,
    "SSG 08": `ssg08`,
    FAMAS: `famas`,
    "Galil AR": `galilar`,
    AUG: `aug`,
    "SG 553": `sg556`,
    SCAR20: `scar20`,
    G3SG1: `g3sg1`,
    "MAC-10": `mac10`,
    MP9: `mp9`,
    MP7: `mp7`,
    "MP5-SD": `mp5sd`,
    "PP-Bizon": `bizon`,
    P90: `p90`,
    "UMP-45": `ump45`,
    M249: `m249`,
    Negev: `negev`,
    Nova: `nova`,
    XM1014: `xm1014`,
    MAG7: `mag7`,
    "Sawed-Off": `sawedoff`,
    "Desert Eagle": `deagle`,
    "Glock-18": `glock`,
    "USP-S": `usp_silencer`,
    P2000: `hkp2000`,
    P250: `p250`,
    "Five-SeveN": `fiveseven`,
    "Tec-9": `tec9`,
    "CZ75-Auto": `cz75a`,
    "Dual Berettas": `elite`,
    "R8 Revolver": `revolver`,
    Zeus: `taser`,
    "Zeus x27": `taser`,
    Taser: `taser`,
    "C4 Explosive": `c4`,
    "High Explosive Grenade": `hegrenade`,
    Flashbang: `flashbang`,
    "Smoke Grenade": `smokegrenade`,
    Molotov: `molotov`,
    "Incendiary Grenade": `incgrenade`,
    "Decoy Grenade": `decoy`,
  },
  Jy = {
    Bayonet: `knife_bayonet`,
    "Bowie Knife": `knife_bowie`,
    "Butterfly Knife": `knife_butterfly`,
    "Survival Knife": `knife_canis`,
    "Paracord Knife": `knife_cord`,
    "Classic Knife": `knife_css`,
    "Falchion Knife": `knife_falchion`,
    "Flip Knife": `knife_flip`,
    "Gut Knife": `knife_gut`,
    Karambit: `knife_karambit`,
    "Kukri Knife": `knife_kukri`,
    "M9 Bayonet": `knife_m9`,
    "Navaja Knife": `knife_navaja`,
    "Nomad Knife": `knife_outdoor`,
    "Shadow Daggers": `knife_push`,
    "Skeleton Knife": `knife_skeleton`,
    "Stiletto Knife": `knife_stiletto`,
    "Huntsman Knife": `knife_tactical`,
    "Talon Knife": `knife_talon`,
    "Ursus Knife": `knife_ursus`,
  }
function Yy(e) {
  return qy[e]
}
function Xy(e) {
  return /knife|bayonet|karambit|dagger/i.test(e)
}
function Zy(e, t) {
  return Jy[e] ?? (t === 2 ? `knife_t` : `knife_ct`)
}
function Qy(e, t) {
  return Xy(e) ? Zy(e, t) : qy[e]
}
function $y(e, t) {
  return `${e}/${t}.glb`
}
async function eb(e) {
  let t = await ab(e),
    n = []
  return (
    t.scene.updateWorldMatrix(!0, !0),
    t.scene.traverse((t) => {
      t instanceof G && n.push({ geometry: nb(t, e), extras: { ...t.userData } })
    }),
    n
  )
}
async function tb(e) {
  let t = await ob(e),
    n = []
  if (
    (t.scene.traverse((e) => {
      e instanceof G && n.push(e)
    }),
    n.length === 0)
  )
    throw Error(`no mesh in ${e}`)
  let r = n[0]
  r.updateWorldMatrix(!0, !1)
  let i = nb(r, e),
    a = r
  for (; a && !a.userData.weaponBone;) a = a.parent
  return (a && (i.userData.weaponBone = a.userData.weaponBone), i)
}
function nb(e, t) {
  let n = e.geometry,
    r = n.getAttribute(`position`),
    i = new Float32Array(r.count * 3)
  for (let e = 0; e < r.count; e++) ((i[e * 3] = r.getX(e)), (i[e * 3 + 1] = r.getY(e)), (i[e * 3 + 2] = r.getZ(e)))
  let a = new Vr()
  a.setAttribute(`position`, new W(i, 3).applyMatrix4(e.matrixWorld))
  let o = n.getAttribute(`color`),
    s = n.getAttribute(`_orm`)
  if (!o || !s) throw Error(`${t} has no PBR vertex attributes`)
  ;(a.setAttribute(`aAlbedo`, o), a.setAttribute(`aOrm`, s), a.setIndex(n.index))
  let c = n.userData.ringRanges,
    l = Vy(a, { ringRanges: c })
  return (l.computeBoundingSphere(), l.computeBoundingBox(), l)
}
async function rb(e) {
  let { scene: t, animations: n } = await ob(e)
  return { scene: t, animations: n }
}
async function ib() {
  let [{ GLTFLoader: e }, { MeshoptDecoder: t }] = await Promise.all([
    Ky(() => import(`./GLTFLoader-maChTRxv.js`), []),
    Ky(() => Promise.resolve().then(() => Q_), void 0),
  ])
  return new e().setMeshoptDecoder(t)
}
async function ab(e) {
  return (await ib()).loadAsync(e)
}
async function ob(e) {
  let [t, n] = await Promise.all([ib(), mv(`weapons`, e)])
  if (!n.ok) throw Error(`${n.status} loading weapons/${e}`)
  return t.parseAsync(await n.arrayBuffer(), ``)
}
var sb = 18,
  cb = 24,
  lb = 6,
  ub = 1,
  db = 3.6,
  fb = 4148524,
  pb = 1316367,
  mb = 13288625,
  hb = 3107386,
  gb = 16724016,
  _b = 4853519,
  vb = 4853519,
  yb = new B(3, 3.2, 1.6),
  bb = 0.3,
  xb = 7,
  Sb = 6,
  Cb = Math.PI / 180,
  wb = class {
    scene
    lighting
    group = new zn()
    device = new zn()
    led
    ledMat
    model = new zn()
    modelMaterial
    modelLedMat = new _i({ color: gb })
    glow
    light = Rv()
    litAt = new B(NaN, NaN, NaN)
    litVersion = -1
    geometry = null
    requested = !1
    modelsEnabled = !1
    disposed = !1
    constructor(e, t) {
      ;((this.scene = e), (this.lighting = t))
      let n = (e, t, n, r, i, a, o) => {
        let s = new G(new oo(e, t, n), new ko({ color: r }))
        return (s.position.set(i, a, o), (s.frustumCulled = !1), this.device.add(s), s)
      }
      ;(n(sb, cb, lb, fb, 0, 0, lb / 2), n(15, 15, ub, pb, 0, -2.5, 6.5))
      let r = new oo(3.4, 2.7, 1.4),
        i = new ko({ color: mb })
      for (let e = 0; e < 4; e++)
        for (let t = 0; t < 3; t++) {
          let n = new G(r, i)
          ;(n.position.set((t - 1) * 4.6, -2.5 + (e - 1.5) * 3.4, 7.7), (n.frustumCulled = !1), this.device.add(n))
        }
      ;(n(12.5, 4.5, 1.2, hb, -1.2, 8.3, 6.6),
        (this.ledMat = new _i({ color: gb })),
        (this.led = new G(new oo(db, db, db), this.ledMat)),
        this.led.position.set(7, 8.3, 7.8),
        (this.led.frustumCulled = !1),
        this.device.add(this.led),
        (this.modelMaterial = t.createMaterial({ surface: `vertex` })),
        (this.glow = new si(new qr({ map: Tb(), color: gb, blending: 2, depthWrite: !1, transparent: !0 }))),
        this.glow.scale.set(xb, xb, 1),
        (this.glow.renderOrder = 2),
        this.group.add(this.device, this.model),
        (this.group.visible = !1),
        e.add(this.group))
    }
    setModelsEnabled(e) {
      ;((this.modelsEnabled = e), e && this.requestModel())
    }
    update(e, t = 0) {
      if (e.kind !== `planted` && e.kind !== `dropped`) {
        this.group.visible = !1
        return
      }
      this.group.visible = !0
      let n = this.modelsEnabled && this.geometry !== null
      ;((this.device.visible = !n), (this.model.visible = n))
      let r = e.kind === `planted` && e.blink,
        i = e.kind === `planted` ? (r ? gb : _b) : vb
      if (!n) {
        ;(this.group.position.set(e.x, e.y, e.z), this.group.rotation.set(0, 0, 0), this.ledMat.color.setHex(i))
        return
      }
      ;(this.group.position.set(e.x, e.y, e.z - (this.geometry?.boundingBox?.min.z ?? 0)),
        this.group.rotation.set(0, 0, t * Cb),
        this.modelLedMat.color.setHex(i),
        (this.glow.visible = r),
        (this.litVersion !== this.lighting.version || !this.litAt.equals(this.group.position)) &&
          (this.litAt.copy(this.group.position),
          (this.litVersion = this.lighting.version),
          this.lighting.sample(e.x, e.y, e.z + Sb, this.light),
          Iy(this.modelMaterial.uniforms, this.light),
          (this.modelMaterial.uniformsNeedUpdate = !0)))
    }
    debugVisible() {
      return this.group.visible
    }
    dispose() {
      this.disposed = !0
      let e = new Set(),
        t = new Set()
      ;(this.group.traverse((n) => {
        let r = n
        r.geometry && e.add(r.geometry)
        let i = r.material
        Array.isArray(i) ? i.forEach((e) => t.add(e)) : i && t.add(i)
      }),
        e.forEach((e) => e.dispose()),
        t.forEach((e) => e.dispose()),
        this.modelMaterial.dispose(),
        this.modelLedMat.dispose(),
        this.glow.material.map?.dispose(),
        this.glow.material.dispose(),
        this.scene.remove(this.group))
    }
    requestModel() {
      this.requested ||
        ((this.requested = !0),
        tb($y(`world`, `c4`))
          .then((e) => {
            if (this.disposed) {
              e.dispose()
              return
            }
            ;(e.computeBoundingBox(), (this.geometry = e))
            let t = new G(e, this.modelMaterial),
              n = new G(new mo(bb, 8, 6), this.modelLedMat)
            ;(n.position.copy(yb), this.glow.position.copy(yb))
            for (let e of [t, n, this.glow]) e.frustumCulled = !1
            this.model.add(t, n, this.glow)
          })
          .catch((e) => console.warn(`[csplayer] C4 model failed to load`, e)))
    }
  }
function Tb() {
  let e = new Uint8Array(1024 * 4)
  for (let t = 0; t < 32; t++)
    for (let n = 0; n < 32; n++) {
      let r = Math.hypot(n + 0.5 - 32 / 2, t + 0.5 - 32 / 2) / (32 / 2),
        i = Math.max(0, 1 - r) ** 2,
        a = (t * 32 + n) * 4
      ;((e[a] = e[a + 1] = e[a + 2] = 255), (e[a + 3] = Math.round(i * 255)))
    }
  let t = new Hi(e, 32, 32)
  return ((t.needsUpdate = !0), t)
}
