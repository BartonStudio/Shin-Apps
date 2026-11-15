// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 39728–40907 行（切片 25/40）
// 角色：烟雾体积渲染 lO：writeFramePair/disturbance/edgeAwareSmoke/shaderScenes
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var lO = class {
    buffers = [new Float32Array(rO * 4), new Float32Array(rO * 4)]
    active = [new Uint8Array(rO), new Uint8Array(rO)]
    blocked = new Uint8Array(rO)
    linearBlocked = new Uint8Array(rO)
    neighborDensity = new Float32Array(6)
    previous = new Uint8Array(rO)
    seedRecords = null
    emitters = []
    current = 0
    frame = -1
    clip
    constructor(e) {
      this.clip = e
    }
    step() {
      if (this.frame + 1 >= this.clip.frameCount) throw RangeError(`End of smoke journal`)
      ;(this.writeBytes(this.previous), this.frame++, this.clip.occupancyAtFrame(this.frame, this.linearBlocked))
      for (let e = 0; e < rO; e++) this.blocked[e] = this.linearBlocked[aO[e]]
      let e = this.clip.seedPointsAtFrame(this.frame)
      if (e !== this.seedRecords) {
        this.seedRecords = e
        let t = new DataView(new ArrayBuffer(4))
        this.emitters = e.map((e) => {
          if (Math.min(e.x, e.y, e.z) < 0 || Math.max(e.x, e.y, e.z) >= 32) throw Error(`Seed outside the native grid`)
          t.setUint32(0, e.extra, !0)
          let n = t.getFloat32(0, !0)
          if (!Number.isFinite(n)) throw Error(`Invalid emitter state`)
          return {
            cell: cO(e.x, e.y, e.z),
            suppression: n,
            nearOrigin: Math.hypot((e.x - 15.5) * 20, (e.y - 15.5) * 20, (e.z - 15.5) * 20) <= 80,
          }
        })
      }
      let t = this.buffers[this.current],
        n = this.buffers[1 - this.current],
        r = this.active[this.current],
        i = this.active[1 - this.current],
        a = this.frame >= this.clip.dissipationFrame,
        o = this.emitters.filter((e) => e.suppression < Y(0.01)).length,
        s = Y(Math.max(1, Y(Y(1 - Y(o / 40)) * 3.5)) * 50)
      for (let e of this.emitters) {
        let i = e.cell
        if (this.frame === 0) {
          for (let e = -1; e <= 1; e++)
            for (let a = -1; a <= 1; a++)
              for (let o = -1; o <= 1; o++) {
                if (o === 0 && a === 0 && e === 0) continue
                let s = oO[i * 3] + o,
                  c = oO[i * 3 + 1] + a,
                  l = oO[i * 3 + 2] + e
                if (Math.min(s, c, l) < 0 || Math.max(s, c, l) >= 32) continue
                let u = cO(s, c, l)
                r[u] || this.blocked[u] || ((t[u * 4] = Y(t[u * 4] + 30)), (n[u * 4] = t[u * 4]), (r[u] = 1))
              }
          r[i] = 1
          continue
        }
        if (a) t[i * 4] = 0
        else {
          let n = e.nearOrigin
          if (!n) {
            let e = 0
            for (let n = 0; n < 6; n++) {
              let a = sO[i * 6 + n]
              a >= 0 && r[a] && (e = Y(e + Math.min(1, Math.max(0, Y(t[a * 4] / 50)))))
            }
            n = Y(e / 6) > Y(0.2)
          }
          ;((e.suppression = n ? Y(e.suppression * Y(0.8)) : 1),
            (t[i * 4] = Math.min(s, Y(t[i * 4] + Y(Y(1 - e.suppression) * 60)))))
        }
        ;((r[i] = 1), n.set(t.subarray(i * 4, i * 4 + 4), i * 4))
      }
      a && (this.emitters = [])
      for (let e = 0; e < rO; e++) {
        if (!r[e]) continue
        let o = e * 4
        if (this.blocked[e]) {
          n[o] = 0
          continue
        }
        let s = Math.min(1, Math.max(0, Y(n[o] / 50))),
          c = 0,
          l = [!1, !1, !1, !1, !1, !1]
        for (let a = 0; a < 6; a++) {
          let u = sO[e * 6 + a]
          if (u < 0 || this.blocked[u]) {
            ;((this.neighborDensity[a] = 0), (l[a] = !0))
            continue
          }
          let d = u * 4,
            f = t[d]
          this.neighborDensity[a] = f
          let p = Y(a === 4 ? 0.79 : 1.2)
          if (a < 4) {
            let [e, n, r] = iO[a]
            p = Y(Y(Y(-n * t[d + 2]) - Y(r * t[d + 3])) - Y(e * t[d + 1])) > Y(0.2) ? 1.25 : Y(0.9)
          }
          let m = Y(Y(Y(f / 6) * Y(1 - s)) * p)
          ;((c = Y(c + m)), (n[d] = Math.max(0, Y(n[d] - m))), !r[u] && t[o] > 5 && (i[u] = 1))
        }
        let u = oO[e * 3],
          d = oO[e * 3 + 1],
          f = oO[e * 3 + 2]
        if (Math.min(u, d, f) === 0 || Math.max(u, d, f) === 31) {
          n[o] = Y(n[o] * Y(0.3))
          continue
        }
        n[o] = Y(n[o] + c)
        let p = Y(this.neighborDensity[0] - this.neighborDensity[1]),
          m = Y(this.neighborDensity[2] - this.neighborDensity[3])
        ;((l[0] || l[1]) && (p = 0), (l[2] || l[3]) && (m = 0))
        let h = Y(Math.sqrt(Y(Y(m * m) + Y(p * p)))),
          g = h > 0 ? Y(1 / h) : 0
        ;((n[o + 1] = Y(p * g)),
          (n[o + 2] = Y(m * g)),
          (n[o + 3] = 0),
          (n[o] = Math.max(0, Y(n[o] - (a ? 0.25 : 0.5)))))
      }
      for (let e = 0; e < rO; e++) (r[e] && t.set(n.subarray(e * 4, e * 4 + 4), e * 4), (r[e] |= i[e]), (i[e] = r[e]))
      this.current = 1 - this.current
    }
    writeBytes(e) {
      let t = this.buffers[1 - this.current]
      for (let n = 0; n < rO; n++) e[aO[n]] = Math.trunc(Y(Math.min(1, Math.max(0, Y(t[n * 4] / 50))) * 255))
    }
    bytes() {
      let e = new Uint8Array(rO)
      return (this.writeBytes(e), e)
    }
    writeFramePair(e, t) {
      if (!Number.isInteger(e) || e < 0 || e >= this.clip.frameCount) throw RangeError(`Invalid smoke frame`)
      if (t.length !== rO * 2) throw RangeError(`Smoke texture must contain two channels per cell`)
      if (e < this.frame) {
        for (let e of this.buffers) e.fill(0)
        for (let e of this.active) e.fill(0)
        ;((this.seedRecords = null), (this.emitters = []), (this.current = 0), (this.frame = -1), this.previous.fill(0))
      }
      for (; this.frame < e;) this.step()
      let n = this.buffers[1 - this.current]
      for (let e = 0; e < rO; e++) {
        let r = aO[e]
        ;((t[r * 2] = this.previous[r]),
          (t[r * 2 + 1] = Math.trunc(Y(Math.min(1, Math.max(0, Y(n[e * 4] / 50))) * 255))))
      }
    }
  },
  uO = new U(12567238),
  dO = 0.22
function fO(e, t) {
  let n = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2]
  if (!(n > 0.01)) return t.copy(uO)
  let r = (Math.max(e[0], 0.01) / n) ** +dO,
    i = (Math.max(e[1], 0.01) / n) ** +dO,
    a = (Math.max(e[2], 0.01) / n) ** +dO,
    o = 0.2126 * r + 0.7152 * i + 0.0722 * a
  return t.setRGB((uO.r * r) / o, (uO.g * i) / o, (uO.b * a) / o)
}
var pO = 64,
  mO = 16,
  X = 32,
  hO = 0.25,
  gO = 2,
  _O = 16,
  vO = 8,
  yO = 640,
  bO = 0.32,
  xO = 0.06,
  SO = {
    desktop: { resolutionScale: 0.5, stepLength: 10, maxSteps: 64 },
    mobile: { resolutionScale: 0.35, stepLength: 14, maxSteps: 44 },
  },
  CO = 0.035,
  wO = new B(0.35, 0.2, 1).normalize(),
  TO = `
uniform int uShotCount;
uniform int uBlastCount;
uniform vec4 uShotStart[${_O}];
uniform vec4 uShotEnd[${_O}];
uniform vec4 uBlasts[${vO}];

float disturbance(vec3 position) {
  float remaining = 1.0;
  for (int shot = 0; shot < ${_O}; shot++) {
    if (shot >= uShotCount) break;
    vec3 start = uShotStart[shot].xyz;
    vec3 segment = uShotEnd[shot].xyz - start;
    float along = clamp(dot(position - start, segment) / max(dot(segment, segment), 0.001), 0.0, 1.0);
    float distance = length(position - start - along * segment);
    float radius = max(uShotStart[shot].w, 0.001);
    remaining *= mix(1.0, smoothstep(radius * 0.4, radius, distance), uShotEnd[shot].w);
  }
  for (int blast = 0; blast < ${vO}; blast++) {
    if (blast >= uBlastCount) break;
    float radius = max(uBlasts[blast].w, 0.001);
    remaining *= smoothstep(radius * 0.65, radius, distance(position, uBlasts[blast].xyz));
  }
  return remaining;
}`,
  EO = `
precision highp sampler3D;
uniform sampler3D uDensity;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uFrameBlend;
uniform float uOpacity;
out vec3 vWorldPos;
out vec3 vNormal;
flat out float vDensity;
void main() {
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 field = texture(uDensity, (center.xyz - uBoxMin) / uBoxSize).rg;
  vDensity = mix(field.r, field.g, uFrameBlend) * uOpacity;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
  DO = `
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
flat in float vDensity;
uniform vec3 uColor;
uniform vec3 uLightDir;
out vec4 outColor;
${TO}
void main() {
  float density = vDensity * disturbance(vWorldPos);
  if (density <= 0.0) discard;
  float light = 0.6 + 0.4 * max(dot(normalize(vNormal), uLightDir), 0.0);
  outColor = vec4(uColor * mix(0.45, 1.0, density) * light, 1.0);
}`,
  OO = `
out vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
  kO = `
precision highp float;
precision highp sampler3D;
in vec3 vWorldPos;
uniform sampler3D uDensity;
uniform sampler3D uLight;
uniform sampler3D uFormNoise;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uMarchMin;
uniform vec3 uMarchMax;
uniform vec3 uOrigin;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uFrameBlend;
uniform float uAge;
uniform int uSteps;
uniform float uStepLength;
uniform float uAbsorb;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform float uCamNear;
uniform float uCamFar;
uniform vec3 uCamForward;
uniform float uUseDepth;
out vec4 outColor;

vec2 hitBox(vec3 ro, vec3 rd, vec3 mn, vec3 mx) {
  vec3 inv = 1.0 / rd;
  vec3 a = (mn - ro) * inv;
  vec3 b = (mx - ro) * inv;
  vec3 tmn = min(a, b);
  vec3 tmx = max(a, b);
  return vec2(max(max(tmn.x, tmn.y), tmn.z), min(min(tmx.x, tmx.y), tmx.z));
}

float smoothNoise(vec3 position) {
  vec3 cell = floor(position);
  vec3 blend = fract(position);
  blend = blend * blend * (3.0 - 2.0 * blend);
  return texture(uFormNoise, (cell + blend + 0.5) / 32.0).r;
}

${TO}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - ro);
  vec2 t = hitBox(ro, rd, uMarchMin, uMarchMax);
  t.x = max(t.x, 0.0);
  if (t.y <= t.x) discard;
  float surface = 1e9;
  if (uUseDepth > 0.5) {
    float sd = texture(uSceneDepth, gl_FragCoord.xy / uResolution).x;
    if (sd < 0.999999) {
      float viewZ = (uCamNear * uCamFar) / ((uCamFar - uCamNear) * sd - uCamFar);
      surface = -viewZ / max(dot(rd, uCamForward), 1e-3);
      t.y = min(t.y, surface);
      if (t.y <= t.x) discard;
    }
  }
  float span = t.y - t.x;
  int steps = int(clamp(ceil(span / uStepLength), 1.0, float(uSteps)));
  float dt = span / float(steps);
  // Interleaved gradient noise staggers neighbouring pixels' samples so slices never line up as bands.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float dist = t.x + dt * jitter;
  vec3 drift = vec3(0.10, -0.06, 0.22) * uAge;
  float T = 1.0;
  vec3 color = vec3(0.0);
  float held = 0.0;
  for (int i = 0; i < 96; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * dist;
    vec3 uvw = (p - uBoxMin) / uBoxSize;
    vec2 field = texture(uDensity, uvw).rg;
    float density = mix(field.r, field.g, uFrameBlend) * uOpacity;
    // Voxels holding solid geometry are empty, so filtering fades the cloud to nothing over the
    // last voxel before every engulfed surface and its edges show through. Near the surface the
    // ray keeps the density it was already travelling through instead.
    float surfaceFill = smoothstep(${(40).toFixed(1)}, ${(20 * 0.5).toFixed(1)}, surface - dist);
    held = max(density, held - dt * (1.0 - surfaceFill) * ${(1 / 40).toFixed(4)});
    density = mix(density, held, surfaceFill);
    if (density > 0.003) density *= disturbance(p);
    if (density > 0.003) {
      vec3 q = (p - uOrigin) / 34.0 + uOrigin * 0.003 - drift;
      float noise = 0.62 * smoothNoise(q) + 0.38 * smoothNoise(q * 2.3 + 11.0);
      // Thin fringes erode into wisps while the dense core keeps its recorded opacity.
      float fringe = 1.0 - smoothstep(0.08, 0.6, density);
      density *= clamp(1.0 - fringe * (1.25 - 1.6 * noise), 0.0, 1.15);
      vec2 lightField = texture(uLight, uvw).rg;
      // Opacity scales optical depth, so the faded transmittance is T^opacity (T stored as T^(1/N)).
      float encodedSun = mix(lightField.r, lightField.g, uFrameBlend);
      float lightPower = ${(8).toFixed(1)} * max(uOpacity, 0.05);
      float sun = pow(encodedSun, lightPower);
      float height = clamp((p.z - uMarchMin.z) / max(uMarchMax.z - uMarchMin.z, 1.0), 0.0, 1.0);
      vec3 ambient = vec3(0.62, 0.66, 0.71) * (0.80 + 0.25 * height);
      // The soft T^0.1 octave stands in for multiple scattering, which keeps a dense cloud's
      // shadowed core milky instead of dropping to the bare ambient term.
      vec3 direct = vec3(0.66, 0.62, 0.55) * (0.6 * sun + 0.5 * pow(encodedSun, 0.1 * lightPower));
      vec3 lit = uColor * (ambient + direct) * (0.9 + 0.2 * noise);
      float a = 1.0 - exp(-uAbsorb * density * dt);
      color += T * a * lit;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
    dist += dt;
  }
  float alpha = 1.0 - T;
  if (alpha <= 0.002) discard;
  outColor = vec4(color, alpha);
}`,
  AO = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
  jO = `
uniform sampler2D uSmoke;
uniform sampler2D uSceneDepth;
uniform vec2 uSourceSize;
uniform float uCamNear;
uniform float uCamFar;
varying vec2 vUv;

float linearDepth(float depth) {
  return (2.0 * uCamNear * uCamFar) /
    max(uCamFar + uCamNear - (depth * 2.0 - 1.0) * (uCamFar - uCamNear), 0.0001);
}

vec4 edgeAwareSmoke(vec2 position, float centerDepth) {
  vec2 cell = floor(position);
  vec2 blend = fract(position);
  float center = linearDepth(centerDepth);
  float threshold = max(16.0, center * 0.035);
  vec4 sum = vec4(0.0);
  float weight = 0.0;
  vec4 nearest = vec4(0.0);
  float nearestDifference = 1e20;
  for (int index = 0; index < 4; index++) {
    vec2 offset = vec2(float(index - (index / 2) * 2), float(index / 2));
    vec2 uv = clamp((cell + offset + 0.5) / uSourceSize, vec2(0.0), vec2(1.0));
    vec4 smoke = texture2D(uSmoke, uv);
    float difference = abs(linearDepth(texture2D(uSceneDepth, uv).x) - center);
    vec2 bilinear = mix(1.0 - blend, blend, offset);
    float tapWeight = bilinear.x * bilinear.y * step(difference, threshold);
    sum += smoke * tapWeight;
    weight += tapWeight;
    if (difference < nearestDifference) { nearestDifference = difference; nearest = smoke; }
  }
  // Renormalise surviving taps; where none share this pixel's surface, take the closest-depth tap
  // instead of dropping to clear air (which left dotted gaps along wall and floor edges).
  return weight > 0.001 ? sum / weight : nearest;
}

void main() {
  vec2 position = vUv * uSourceSize - 0.5;
  vec2 cell = floor(position);
  // One filtered fetch at the 2x2 quad centre is the mean tap alpha. The result is a convex blend of
  // those taps, so when even 4x the mean is below the smoothstep floor the result is exactly clear.
  if (texture2D(uSmoke, (cell + 1.0) / uSourceSize).a * 4.0 < 0.014) discard;
  vec4 smoke = edgeAwareSmoke(position, texture2D(uSceneDepth, vUv).x);
  float alpha = smoothstep(0.015, 0.18, smoke.a);
  gl_FragColor = vec4(smoke.rgb * alpha / max(smoke.a, 0.001), alpha);
}`,
  MO = class {
    scene
    volumeScene = new Jn()
    compositeScene = new Jn()
    compositeCamera = new _s()
    compositeMesh
    voxelData
    clips = new Map()
    slots = []
    geo
    cubeGeo = new oo(20, 20, 20)
    cubeMatrix = new H()
    normalTarget = null
    normalSize = new z()
    graphics = `medium`
    budget = SO.desktop
    lightScratch = new Float32Array(X * X * 4)
    lastTick = NaN
    shotCount = { value: 0 }
    blastCount = { value: 0 }
    shotStart = Array.from({ length: _O }, () => new sn())
    shotEnd = Array.from({ length: _O }, () => new sn())
    blasts = Array.from({ length: vO }, () => new sn())
    visible = !1
    activeCount = 0
    fwd = new B()
    frustum = new ca()
    projectionView = new H()
    scissorRect = new sn()
    marchBox = new lr()
    cornerClip = new Float64Array(24)
    formTexture
    constructor(e, t) {
      ;((this.scene = e),
        (this.voxelData = t),
        (this.geo = new oo(yO, yO, yO)),
        (this.formTexture = FO()),
        (this.compositeMesh = new G(
          new po(2, 2),
          new To({
            uniforms: {
              uSmoke: { value: null },
              uSceneDepth: { value: null },
              uSourceSize: { value: new z(1, 1) },
              uCamNear: { value: 1 },
              uCamFar: { value: 1 },
            },
            vertexShader: AO,
            fragmentShader: jO,
            transparent: !0,
            premultipliedAlpha: !0,
            depthTest: !1,
            depthWrite: !1,
          }),
        )),
        (this.compositeMesh.frustumCulled = !1),
        this.compositeScene.add(this.compositeMesh))
      let n = wO.clone()
      for (let e = 0; e < mO; e++) {
        let e = new Uint8Array(X * X * X * 2),
          t = NO(e),
          r = new Uint8Array(X * X * X * 2),
          i = NO(r),
          a = new To({
            glslVersion: nt,
            uniforms: {
              uDensity: { value: t },
              uLight: { value: i },
              uFormNoise: { value: this.formTexture },
              uBoxMin: { value: new B() },
              uBoxSize: { value: new B(yO, yO, yO) },
              uMarchMin: { value: new B() },
              uMarchMax: { value: new B() },
              uOrigin: { value: new B() },
              uColor: { value: uO.clone() },
              uOpacity: { value: 1 },
              uFrameBlend: { value: 1 },
              uAge: { value: 0 },
              uSteps: { value: this.budget.maxSteps },
              uStepLength: { value: this.budget.stepLength },
              uShotCount: this.shotCount,
              uBlastCount: this.blastCount,
              uShotStart: { value: this.shotStart },
              uShotEnd: { value: this.shotEnd },
              uBlasts: { value: this.blasts },
              uLightDir: { value: n },
              uAbsorb: { value: bO },
              uSceneDepth: { value: null },
              uResolution: { value: new z(1, 1) },
              uCamNear: { value: 1 },
              uCamFar: { value: 1 },
              uCamForward: { value: new B(0, 0, -1) },
              uUseDepth: { value: 0 },
            },
            vertexShader: OO,
            fragmentShader: kO,
            transparent: !0,
            premultipliedAlpha: !0,
            depthWrite: !1,
            depthTest: !1,
            side: 1,
          }),
          o = new G(this.geo, a)
        ;((o.frustumCulled = !0),
          (o.visible = !1),
          this.volumeScene.add(o),
          this.slots.push({
            mesh: o,
            cubes: null,
            cubeFrameIdx: -1,
            material: a,
            texture: t,
            data: e,
            lightTexture: i,
            light: r,
            lightFrameIdx: -1,
            empty: !0,
            smokeIdx: -1,
            frameIdx: -1,
            simulation: null,
          }))
      }
    }
    get shaderScenes() {
      return { offscreen: this.volumeScene, screen: this.compositeScene }
    }
    setData(e) {
      ;((this.voxelData = e), this.clips.clear(), (this.lastTick = NaN), (this.activeCount = 0))
      for (let e of this.slots)
        ((e.mesh.visible = !1),
          e.cubes && (e.cubes.visible = !1),
          (e.smokeIdx = -1),
          (e.frameIdx = -1),
          (e.cubeFrameIdx = -1),
          (e.simulation = null))
    }
    setVisible(e) {
      if (((this.lastTick = NaN), (this.visible = e), !e)) {
        for (let e of this.slots)
          ((e.mesh.visible = !1),
            e.cubes && (e.cubes.visible = !1),
            (e.smokeIdx = -1),
            (e.frameIdx = -1),
            (e.cubeFrameIdx = -1),
            (e.simulation = null))
        this.activeCount = 0
      }
    }
    debugActiveCount() {
      return this.activeCount
    }
    setGraphics(e) {
      if (e !== this.graphics) {
        ;((this.graphics = e),
          this.setVisible(e !== `off`),
          (e === `off` || e === `cubes`) && (this.normalTarget?.dispose(), (this.normalTarget = null)))
        for (let t = 0; t < this.activeCount; t++) {
          let n = this.slots[t]
          e === `cubes` && n.cubeFrameIdx !== n.frameIdx && this.rebuildCubes(n)
        }
        this.refreshVisibility()
      }
    }
    setGpuTier(e) {
      this.budget = SO[e]
      for (let e of this.slots)
        ((e.material.uniforms.uSteps.value = this.budget.maxSteps),
          (e.material.uniforms.uStepLength.value = this.budget.stepLength))
    }
    clearDisturbances() {
      ;((this.shotCount.value = 0), (this.blastCount.value = 0))
    }
    addShot(e, t, n, r, i, a, o, s) {
      let c = this.shotCount.value
      c >= _O || (this.shotStart[c].set(e, t, n, o), this.shotEnd[c].set(r, i, a, LO(s)), this.shotCount.value++)
    }
    addBlast(e, t, n, r) {
      let i = this.blastCount.value
      i >= vO || (this.blasts[i].set(e, t, n, r), this.blastCount.value++)
    }
    needsDepth(e) {
      if (!this.visible || this.graphics === `cubes` || this.activeCount === 0) return !1
      if (!e) return !0
      ;(e.updateMatrixWorld(),
        this.projectionView.multiplyMatrices(e.projectionMatrix, e.matrixWorldInverse),
        this.frustum.setFromProjectionMatrix(this.projectionView))
      for (let e = 0; e < this.activeCount; e++) {
        let t = this.slots[e]
        if (!t.empty && this.frustum.intersectsObject(t.mesh)) return !0
      }
      return !1
    }
    refreshVisibility() {
      for (let e = 0; e < this.slots.length; e++) {
        let t = this.slots[e],
          n = this.visible && e < this.activeCount
        ;((t.mesh.visible = n && this.graphics !== `cubes` && !t.empty),
          t.cubes && (t.cubes.visible = n && this.graphics === `cubes`))
      }
    }
    applySceneDepth(e, t, n) {
      t.getWorldDirection(this.fwd)
      for (let r = 0; r < this.activeCount; r++) {
        let i = this.slots[r].material.uniforms
        ;((i.uSceneDepth.value = e),
          i.uResolution.value.copy(n),
          (i.uCamNear.value = t.near),
          (i.uCamFar.value = t.far),
          i.uCamForward.value.copy(this.fwd),
          (i.uUseDepth.value = 1))
      }
    }
    render(e, t, n) {
      if (!this.visible || this.graphics === `cubes` || this.activeCount === 0 || !this.screenBounds(t, n)) return
      ;(this.normalSize.set(
        Math.max(1, Math.ceil(n.x * this.budget.resolutionScale)),
        Math.max(1, Math.ceil(n.y * this.budget.resolutionScale)),
      ),
        this.normalTarget
          ? (this.normalTarget.width !== this.normalSize.x || this.normalTarget.height !== this.normalSize.y) &&
            this.normalTarget.setSize(this.normalSize.x, this.normalSize.y)
          : ((this.normalTarget = new ln(this.normalSize.x, this.normalSize.y, {
              type: e.extensions.has(`EXT_color_buffer_float`) ? x : m,
              depthBuffer: !1,
              stencilBuffer: !1,
            })),
            (this.normalTarget.texture.minFilter = d),
            (this.normalTarget.texture.magFilter = d)))
      let r = e.getRenderTarget(),
        i = e.autoClear,
        a = e.getClearColor(new U()),
        o = e.getClearAlpha(),
        s = e.getScissorTest(),
        c = e.getScissor(new sn())
      try {
        for (let e = 0; e < this.activeCount; e++)
          this.slots[e].material.uniforms.uResolution.value.copy(this.normalSize)
        ;(e.setRenderTarget(this.normalTarget), e.setClearColor(0, 0), e.clear(), e.render(this.volumeScene, t))
        let n = this.compositeMesh.material.uniforms
        if (
          ((n.uSmoke.value = this.normalTarget.texture),
          (n.uSceneDepth.value = this.slots[0].material.uniforms.uSceneDepth.value),
          n.uSourceSize.value.copy(this.normalSize),
          (n.uCamNear.value = t.near),
          (n.uCamFar.value = t.far),
          e.setRenderTarget(r),
          (e.autoClear = !1),
          !r)
        ) {
          let t = this.scissorRect,
            n = e.getPixelRatio()
          ;(e.setScissor(t.x / n, t.y / n, t.z / n, t.w / n), e.setScissorTest(!0))
        }
        e.render(this.compositeScene, this.compositeCamera)
      } finally {
        ;(e.setScissor(c), e.setScissorTest(s), (e.autoClear = i), e.setClearColor(a, o), e.setRenderTarget(r))
      }
    }
    screenBounds(e, t) {
      ;(e.updateMatrixWorld(), this.projectionView.multiplyMatrices(e.projectionMatrix, e.matrixWorldInverse))
      let n = this.projectionView.elements
      this.frustum.setFromProjectionMatrix(this.projectionView)
      let r = 1 / 0,
        i = 1 / 0,
        a = -1 / 0,
        o = -1 / 0
      for (let t = 0; t < this.activeCount; t++) {
        let s = this.slots[t]
        if (!s.mesh.visible) continue
        let c = s.material.uniforms.uMarchMin.value,
          l = s.material.uniforms.uMarchMax.value
        if (!this.frustum.intersectsBox(this.marchBox.set(c, l))) continue
        let u = this.cornerClip
        for (let e = 0; e < 8; e++) {
          let t = e & 1 ? l.x : c.x,
            r = e & 2 ? l.y : c.y,
            i = e & 4 ? l.z : c.z
          ;((u[e * 3] = n[0] * t + n[4] * r + n[8] * i + n[12]),
            (u[e * 3 + 1] = n[1] * t + n[5] * r + n[9] * i + n[13]),
            (u[e * 3 + 2] = n[3] * t + n[7] * r + n[11] * i + n[15]))
        }
        let d = (e, t, n) => {
          ;((r = Math.min(r, e / n)), (a = Math.max(a, e / n)), (i = Math.min(i, t / n)), (o = Math.max(o, t / n)))
        }
        for (let t = 0; t < 8; t++) {
          let n = u[t * 3 + 2]
          n >= e.near && d(u[t * 3], u[t * 3 + 1], n)
          for (let r = 1; r < 8; r <<= 1) {
            if (t & r) continue
            let i = t | r,
              a = u[i * 3 + 2]
            if (n >= e.near == a >= e.near) continue
            let o = (e.near - n) / (a - n)
            d(u[t * 3] + (u[i * 3] - u[t * 3]) * o, u[t * 3 + 1] + (u[i * 3 + 1] - u[t * 3 + 1]) * o, e.near)
          }
        }
      }
      let s = 4 / this.budget.resolutionScale,
        c = Math.max(0, Math.floor((r * 0.5 + 0.5) * t.x - s)),
        l = Math.max(0, Math.floor((i * 0.5 + 0.5) * t.y - s)),
        u = Math.min(t.x, Math.ceil((a * 0.5 + 0.5) * t.x + s)),
        d = Math.min(t.y, Math.ceil((o * 0.5 + 0.5) * t.y + s))
      return u <= c || d <= l ? !1 : (this.scissorRect.set(c, l, u - c, d - l), !0)
    }
    obscuresSegment(e, t) {
      if (!this.visible || this.activeCount === 0) return !1
      for (let n = 0; n < this.activeCount; n++) {
        let r = this.slots[n],
          i = r.material.uniforms.uBoxMin.value,
          a = r.material.uniforms.uBoxSize.value,
          o = r.material.uniforms.uOpacity.value,
          s = r.material.uniforms.uFrameBlend.value,
          c = IO(e, t, i, a)
        if (!c) continue
        let l = t.distanceTo(e) * (c[1] - c[0]),
          u = Math.max(8, Math.min(64, Math.ceil(l / 12))),
          d = 0
        for (let n = 0; n < u; n++) {
          let f = c[0] + ((n + 0.5) / u) * (c[1] - c[0]),
            p = e.x + (t.x - e.x) * f,
            m = e.y + (t.y - e.y) * f,
            h = e.z + (t.z - e.z) * f,
            g = this.densityAt(r, p, m, h, i, a, s) * o * this.disturbanceAt(p, m, h)
          if (((d += bO * g * (l / u)), Math.exp(-d) <= xO)) return !0
        }
      }
      return !1
    }
    update(e) {
      if (!this.visible) return 0
      if (e === this.lastTick) return (this.refreshVisibility(), this.activeCount)
      let t = []
      for (let n = 0; n < this.voxelData.count && t.length < mO; n++) {
        let r = this.getClip(n)
        r && (e < r.tickBegin || e >= r.endTick || t.push({ idx: n, clip: r }))
      }
      for (let e of this.slots)
        t.some(({ idx: t }) => t === e.smokeIdx) || ((e.smokeIdx = -1), (e.frameIdx = -1), (e.simulation = null))
      let n = 0
      for (let { idx: r, clip: i } of t) {
        let t = this.slots.findIndex((e) => e.smokeIdx === r)
        ;(t < 0 && (t = this.slots.findIndex((e) => e.smokeIdx < 0)),
          t !== n && ([this.slots[n], this.slots[t]] = [this.slots[t], this.slots[n]]))
        let a = e,
          o = i.frameForTick(a),
          s = (e - i.tickBegin) / pO,
          c =
            i.dissipationFrame < i.frameCount
              ? i.tickForFrame(i.dissipationFrame)
              : Math.max(i.tickBegin, i.endTick - gO * pO),
          l = (i.endTick - e) / Math.max(1, i.endTick - c),
          u = LO(s / hO) * RO(0, 1, l),
          d = this.slots[n]
        ;((d.smokeIdx !== r || d.frameIdx !== o) &&
          ((d.smokeIdx !== r || d.simulation === null) && (d.simulation = new lO(i)),
          d.simulation.writeFramePair(o, d.data),
          (d.texture.needsUpdate = !0),
          (d.smokeIdx = r),
          (d.frameIdx = o),
          (d.cubeFrameIdx = -1),
          (d.lightFrameIdx = -1),
          this.fitOccupiedBounds(d, i.detonation)),
          d.lightFrameIdx !== o &&
            !d.empty &&
            (PO(d.data, d.light, this.lightScratch), (d.lightTexture.needsUpdate = !0), (d.lightFrameIdx = o)))
        let f = i.detonation
        ;(d.material.uniforms.uBoxMin.value.set(f[0] - 320, f[1] - 320, f[2] - 320),
          d.material.uniforms.uBoxSize.value.setScalar(yO),
          d.material.uniforms.uOrigin.value.set(f[0], f[1], f[2]),
          fO(i.color, d.material.uniforms.uColor.value),
          (d.material.uniforms.uOpacity.value = u),
          (d.material.uniforms.uFrameBlend.value = i.blendForTick(e)),
          (d.material.uniforms.uAge.value = s),
          this.graphics === `cubes` && d.cubeFrameIdx !== o && this.rebuildCubes(d),
          d.cubes && d.cubes.position.set(f[0], f[1], f[2]),
          n++)
      }
      for (let e = n; e < mO; e++)
        ((this.slots[e].mesh.visible = !1),
          this.slots[e].cubes && (this.slots[e].cubes.visible = !1),
          (this.slots[e].smokeIdx = -1),
          (this.slots[e].simulation = null))
      return ((this.activeCount = n), (this.lastTick = e), this.refreshVisibility(), n)
    }
    fitOccupiedBounds(e, t) {
      let n = X,
        r = X,
        i = X,
        a = -1,
        o = -1,
        s = -1,
        c = e.data
      for (let e = 0, t = 0; e < X; e++)
        for (let l = 0; l < X; l++)
          for (let u = 0; u < X; u++, t++)
            (!c[t * 2] && !c[t * 2 + 1]) ||
              (u < n && (n = u),
              u > a && (a = u),
              l < r && (r = l),
              l > o && (o = l),
              e < i && (i = e),
              e > s && (s = e))
      if (((e.empty = a < 0), e.empty)) return
      let l = (e, n) => t[n] - 320 + Math.max(0, e - 1) * 20,
        u = (e, n) => t[n] - 320 + Math.min(X, e + 2) * 20,
        d = e.material.uniforms.uMarchMin.value.set(l(n, 0), l(r, 1), l(i, 2)),
        f = e.material.uniforms.uMarchMax.value.set(u(a, 0), u(o, 1), u(s, 2))
      ;(e.mesh.position.addVectors(d, f).multiplyScalar(0.5),
        e.mesh.scale.subVectors(f, d).divideScalar(yO),
        e.mesh.updateMatrixWorld())
    }
    rebuildCubes(e) {
      let t = 0
      for (let n = 0; n < X ** 3; n++) (e.data[n * 2] || e.data[n * 2 + 1]) && t++
      let n = e.cubes
      if (!n || n.instanceMatrix.count < t) {
        let r =
          n?.material ??
          new To({
            glslVersion: `300 es`,
            uniforms: e.material.uniforms,
            vertexShader: EO,
            fragmentShader: DO,
            depthTest: !0,
            depthWrite: !0,
          })
        n && (this.scene.remove(n), n.dispose())
        let i = 2 ** Math.ceil(Math.log2(Math.max(1, t)))
        ;((n = new ea(this.cubeGeo, r, i)),
          n.instanceMatrix.setUsage(tt),
          (n.frustumCulled = !1),
          this.scene.add(n),
          (e.cubes = n))
      }
      let r = 0
      for (let t = 0; t < X ** 3; t++)
        (!e.data[t * 2] && !e.data[t * 2 + 1]) ||
          (this.cubeMatrix.makeTranslation(
            ((t % X) + 0.5 - 16) * 20,
            ((Math.floor(t / X) % X) + 0.5 - 16) * 20,
            (Math.floor(t / (X * X)) + 0.5 - 16) * 20,
          ),
          n.setMatrixAt(r++, this.cubeMatrix))
      ;((n.count = t),
        n.position.copy(e.material.uniforms.uOrigin.value),
        (n.instanceMatrix.needsUpdate = !0),
        (e.cubeFrameIdx = e.frameIdx))
    }
    densityAt(e, t, n, r, i, a, o) {
      let s = Math.floor(((t - i.x) / a.x) * X),
        c = Math.floor(((n - i.y) / a.y) * X),
        l = Math.floor(((r - i.z) / a.z) * X)
      if (s < 0 || c < 0 || l < 0 || s >= X || c >= X || l >= X) return 0
      let u = (s + X * (c + X * l)) * 2
      return (e.data[u] + (e.data[u + 1] - e.data[u]) * o) / 255
    }
    disturbanceAt(e, t, n) {
      let r = 1
      for (let i = 0; i < this.shotCount.value; i++) {
        let a = this.shotStart[i],
          o = this.shotEnd[i],
          s = o.x - a.x,
          c = o.y - a.y,
          l = o.z - a.z,
          u = Math.max(s ** 2 + c ** 2 + l ** 2, 0.001),
          d = Math.max(0, Math.min(1, ((e - a.x) * s + (t - a.y) * c + (n - a.z) * l) / u)),
          f = Math.hypot(e - a.x - s * d, t - a.y - c * d, n - a.z - l * d)
        r *= 1 - (1 - RO(a.w * 0.4, a.w, f)) * o.w
      }
      for (let i = 0; i < this.blastCount.value; i++) {
        let a = this.blasts[i]
        r *= RO(a.w * 0.65, a.w, Math.hypot(e - a.x, t - a.y, n - a.z))
      }
      return r
    }
    getClip(e) {
      let t = this.clips.get(e)
      if (t !== void 0) return t
      let n = nO(this.voxelData, e)
      return (this.clips.set(e, n), n)
    }
    dispose() {
      for (let e of this.slots)
        (this.volumeScene.remove(e.mesh),
          e.cubes && (this.scene.remove(e.cubes), e.cubes.dispose(), e.cubes.material.dispose()),
          e.material.dispose(),
          e.texture.dispose(),
          e.lightTexture.dispose(),
          (e.simulation = null))
      ;(this.geo.dispose(),
        this.cubeGeo.dispose(),
        this.normalTarget?.dispose(),
        this.compositeMesh.geometry.dispose(),
        this.compositeMesh.material.dispose(),
        this.formTexture.dispose(),
        this.clips.clear())
    }
  }
function NO(e) {
  let t = new dn(e, X, X, X)
  return (
    (t.format = M),
    (t.type = m),
    (t.minFilter = d),
    (t.magFilter = d),
    (t.wrapS = t.wrapT = t.wrapR = o),
    (t.needsUpdate = !0),
    t
  )
}
function PO(e, t, n) {
  let r = X * X * 2,
    i = wO.x / wO.z,
    a = wO.y / wO.z,
    o = Math.floor(i),
    s = Math.floor(a),
    c = i - o,
    l = a - s,
    u = (CO * 20) / wO.z / 255 / 8,
    d = 0,
    f = r
  n.fill(0, d, d + r)
  let p = (e, t, r) => (e < 0 || t < 0 || e >= X || t >= X ? 0 : n[d + (e + X * t) * 2 + r])
  for (let r = X - 1; r >= 0; r--) {
    for (let i = 0; i < X; i++) {
      let a = i + s
      for (let s = 0; s < X; s++) {
        let d = s + o,
          m = s + X * (i + X * r)
        for (let r = 0; r < 2; r++) {
          let o =
              (1 - l) * ((1 - c) * p(d, a, r) + c * p(d + 1, a, r)) +
              l * ((1 - c) * p(d, a + 1, r) + c * p(d + 1, a + 1, r)),
            h = e[m * 2 + r]
          ;((n[f + (s + X * i) * 2 + r] = o + h), (t[m * 2 + r] = Math.round(255 * Math.exp(-u * (o + h * 0.5)))))
        }
      }
    }
    ;[d, f] = [f, d]
  }
}
function FO() {
  let e = new Uint8Array(32 ** 3)
  for (let t = 0; t < e.length; t++) {
    let n = Math.imul(t ^ 2654435769, 569420461)
    ;((n = Math.imul(n ^ (n >>> 15), 1935289751)), (e[t] = (n ^ (n >>> 15)) >>> 24))
  }
  let t = new dn(e, 32, 32, 32)
  return (
    (t.format = te),
    (t.type = m),
    (t.minFilter = t.magFilter = d),
    (t.wrapS = t.wrapT = t.wrapR = a),
    (t.unpackAlignment = 1),
    (t.needsUpdate = !0),
    t
  )
}
function IO(e, t, n, r) {
  let i = 0,
    a = 1
  for (let o of [`x`, `y`, `z`]) {
    let s = t[o] - e[o],
      c = n[o],
      l = c + r[o]
    if (Math.abs(s) < 1e-6) {
      if (e[o] < c || e[o] > l) return null
      continue
    }
    let u = (c - e[o]) / s,
      d = (l - e[o]) / s
    if ((u > d && ([u, d] = [d, u]), (i = Math.max(i, u)), (a = Math.min(a, d)), a <= i)) return null
  }
  return [i, a]
}
function LO(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e
}
function RO(e, t, n) {
  let r = n <= e ? 0 : n >= t ? 1 : (n - e) / (t - e)
  return r * r * (3 - 2 * r)
}
var zO = 64,
  BO = 0.8,
  VO = 18,
  HO = 4,
  UO = 320,
  WO = class {
    graphics = `medium`
    activeCount = 0
    voxelData
    volume
    lastTick = NaN
    tracers = null
    manualShots = []
    carveLo = 0
    carveHi = 0
    blastX = new Float32Array()
    blastY = new Float32Array()
    blastZ = new Float32Array()
    blastTick = new Int32Array()
    blastCount = 0
    manualBlasts = []
    blastLo = 0
    blastHi = 0
    constructor(e, t, n) {
      ;((this.voxelData = n ?? {
        count: 0,
        tickBegin: new Int32Array(),
        detonation: new Float32Array(),
        color: new Float32Array(),
        bufferOffsets: new Int32Array(1),
        buffers: new Uint8Array(),
      }),
        (this.volume = new MO(e, this.voxelData)),
        this.volume.setVisible(!0),
        this.setEffects(t))
    }
    setData(e, t) {
      ;((this.voxelData = t), this.volume.setData(t), this.setEffects(e), (this.lastTick = NaN))
    }
    setEffects(e) {
      let t = e.filter((e) => e.kind === `he`)
      ;((this.blastCount = t.length),
        (this.blastX = new Float32Array(this.blastCount)),
        (this.blastY = new Float32Array(this.blastCount)),
        (this.blastZ = new Float32Array(this.blastCount)),
        (this.blastTick = new Int32Array(this.blastCount)))
      for (let e = 0; e < this.blastCount; e++)
        ((this.blastX[e] = t[e].x),
          (this.blastY[e] = t[e].y),
          (this.blastZ[e] = t[e].z),
          (this.blastTick[e] = t[e].startTick))
      ;((this.blastLo = 0), (this.blastHi = 0))
    }
    setGraphics(e) {
      ;((this.graphics = e), (this.lastTick = NaN), this.volume.setGraphics(e))
    }
    getGraphics() {
      return this.graphics
    }
    obscuresSegment(e, t) {
      return this.volume.obscuresSegment(e, t)
    }
    get hasVoxels() {
      return this.voxelData.count > 0
    }
    setGpuTier(e) {
      this.volume.setGpuTier(e)
    }
    needsDepthPrepass(e) {
      return this.volume.needsDepth(e)
    }
    applySceneDepth(e, t, n) {
      this.volume.applySceneDepth(e, t, n)
    }
    render(e, t, n) {
      this.volume.render(e, t, n)
    }
    get shaderScenes() {
      return this.volume.shaderScenes
    }
    setTracers(e) {
      ;((this.tracers = e), (this.lastTick = NaN))
    }
    addShot(e, t, n, r, i, a, o) {
      ;(this.manualShots.push(o, e, t, n, r, i, a), (this.lastTick = NaN))
    }
    addBlast(e, t, n, r) {
      ;(this.manualBlasts.push(r, e, t, n), (this.lastTick = NaN))
    }
    update(e) {
      if (this.graphics === `off`) {
        this.activeCount = 0
        return
      }
      ;(e !== this.lastTick && this.updateVolumeDisturbances(e),
        (this.lastTick = e),
        (this.activeCount = this.volume.update(e)))
    }
    updateVolumeDisturbances(e) {
      ;(this.updateCarveWindow(e), this.volume.clearDisturbances())
      let t = (t, n, r, i, a, o, s) => {
        let c = GO((e - t) / (BO * zO)),
          l = 1 - c * c * (3 - 2 * c)
        this.volume.addShot(n, r, i, a, o, s, VO, l)
      }
      if (this.tracers) {
        let { origin: e, end: n, tick: r } = this.tracers
        for (let i = this.carveHi - 1; i >= this.carveLo; i--) {
          let a = i * 3
          t(r[i], e[a], e[a + 1], e[a + 2], n[a], n[a + 1], n[a + 2])
        }
      }
      for (let e = this.manualShots.length - 7; e >= 0; e -= 7) {
        let n = this.manualShots
        t(n[e], n[e + 1], n[e + 2], n[e + 3], n[e + 4], n[e + 5], n[e + 6])
      }
      let n = (t, n, r, i) => {
        let a = GO((GO((e - t) / (HO * zO)) - 0.25) / 0.75),
          o = UO * (1 - a * a * (3 - 2 * a))
        this.volume.addBlast(n, r, i, o)
      }
      for (let e = this.blastHi - 1; e >= this.blastLo; e--)
        n(this.blastTick[e], this.blastX[e], this.blastY[e], this.blastZ[e])
      for (let e = this.manualBlasts.length - 4; e >= 0; e -= 4) {
        let t = this.manualBlasts
        n(t[e], t[e + 1], t[e + 2], t[e + 3])
      }
    }
    debugActiveCount() {
      return this.activeCount
    }
    dispose() {
      this.volume.dispose()
    }
    updateCarveWindow(e) {
      let t = e - BO * zO
      this.tracers && this.tracers.count > 0
        ? ((this.carveLo = KO(this.tracers.tick, this.tracers.count, t)),
          (this.carveHi = qO(this.tracers.tick, this.tracers.count, e)))
        : (this.carveLo = this.carveHi = 0)
      let n = this.manualShots
      if (n.length > 0) {
        let r = 0
        for (let i = 0; i < n.length; i += 7)
          if (n[i] > t && n[i] <= e) {
            if (r !== i) for (let e = 0; e < 7; e++) n[r + e] = n[i + e]
            r += 7
          }
        n.length = r
      }
      let r = e - HO * zO
      this.blastCount > 0
        ? ((this.blastLo = KO(this.blastTick, this.blastCount, r)),
          (this.blastHi = qO(this.blastTick, this.blastCount, e)))
        : (this.blastLo = this.blastHi = 0)
      let i = this.manualBlasts
      if (i.length > 0) {
        let t = 0
        for (let n = 0; n < i.length; n += 4)
          if (i[n] > r && i[n] <= e) {
            if (t !== n) for (let e = 0; e < 4; e++) i[t + e] = i[n + e]
            t += 4
          }
        i.length = t
      }
    }
  }
function GO(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e
}
function KO(e, t, n) {
  let r = 0,
    i = t
  for (; r < i;) {
    let t = (r + i) >> 1
    e[t] < n ? (r = t + 1) : (i = t)
  }
  return r
}
function qO(e, t, n) {
  let r = 0,
    i = t
  for (; r < i;) {
    let t = (r + i) >> 1
    e[t] <= n ? (r = t + 1) : (i = t)
  }
  return r
}
var JO = new lr(),
  YO = new B(),
