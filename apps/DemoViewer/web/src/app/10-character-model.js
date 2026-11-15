// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 34298–35809 行（切片 17/40）
// 角色：角色模型 gS：pose/骨骼姿势/break pieces（ragdoll 驱动，含 hw=4ms 帧预算）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var gS = class {
  mesh
  count
  start
  velocity
  axis
  spin
  scale
  land
  rest
  m = new H()
  p = new B()
  q = new Ht()
  a = new B()
  s = new B()
  constructor(e, t, n, r, i, a) {
    let o = CS(i ^ 2654435769),
      s = n.getSize(new B()),
      c = s.x <= s.y && s.x <= s.z ? 0 : s.y <= s.z ? 1 : 2,
      l = (s.x * s.y * s.z) / Math.max(s.getComponent(c), 1),
      u = Math.round(Math.min(64, Math.max(12, l / 40)))
    ;((this.count = u),
      (this.mesh = new ea(e, t, u)),
      (this.mesh.frustumCulled = !1),
      (this.mesh.renderOrder = 1),
      (this.start = new Float32Array(u * 3)),
      (this.velocity = new Float32Array(u * 3)),
      (this.axis = new Float32Array(u * 3)),
      (this.spin = new Float32Array(u)),
      (this.scale = new Float32Array(u)),
      (this.land = new Float32Array(u)),
      (this.rest = []))
    let d = new gi(),
      f = new B()
    for (let e = 0; e < u; e++) {
      let t = this.p.set(n.min.x + o() * s.x, n.min.y + o() * s.y, n.min.z + o() * s.z)
      ;(t.setComponent(c, (n.min.getComponent(c) + n.max.getComponent(c)) / 2), hS(r, t, f))
      let i = f.x * (0.5 + o() * 0.7) + (o() - 0.5) * 70,
        l = f.y * (0.5 + o() * 0.7) + (o() - 0.5) * 70,
        u = f.z * (0.5 + o() * 0.7) + (o() - 0.2) * 60
      ;(this.start.set([t.x, t.y, t.z], e * 3), this.velocity.set([i, l, u], e * 3))
      let p = this.a.set(o() - 0.5, o() - 0.5, o() - 0.5).normalize()
      ;(this.axis.set([p.x, p.y, p.z], e * 3),
        (this.spin[e] = (o() - 0.5) * 30),
        (this.scale[e] = 1.5 + o() * 3),
        this.rest.push(
          new Ht().setFromAxisAngle(this.a.set(o() - 0.5, o() - 0.5, o() - 0.5).normalize(), o() * Math.PI * 2),
        ))
      let m = (u + Math.sqrt(u * u + 2 * fS * Math.max(0, t.z - n.min.z))) / fS,
        h = a.floorBelow(t.x + i * m, t.y + l * m, t.z, t.z - 512, d) ?? n.min.z - 512,
        g = Math.max(0, t.z - h - 0.3)
      this.land[e] = (u + Math.sqrt(u * u + 2 * fS * g)) / fS
    }
  }
  pose(e) {
    for (let t = 0; t < this.count; t++) {
      let n = Math.min(e, this.land[t]),
        r = t * 3
      ;(this.p.set(
        this.start[r] + this.velocity[r] * n,
        this.start[r + 1] + this.velocity[r + 1] * n,
        this.start[r + 2] + this.velocity[r + 2] * n - 0.5 * fS * n * n,
      ),
        this.q
          .setFromAxisAngle(this.a.set(this.axis[r], this.axis[r + 1], this.axis[r + 2]), this.spin[t] * n)
          .multiply(this.rest[t]))
      let i = this.scale[t]
      this.mesh.setMatrixAt(t, this.m.compose(this.p, this.q, this.s.set(i, i, 1)))
    }
    this.mesh.instanceMatrix.needsUpdate = !0
  }
}
function _S() {
  let e = new Vr()
  return (
    e.setAttribute(`position`, new kr([-0.5, -0.4, 0, 0.6, -0.2, 0, -0.1, 0.7, 0], 3)),
    e.setAttribute(`normal`, new kr([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)),
    e.setAttribute(`aAlbedo`, new kr([1, 1, 1, 1, 1, 1, 1, 1, 1], 3)),
    e.setAttribute(`aOrm`, new kr([1, 0.1, 0, 1, 0.1, 0, 1, 0.1, 0], 3)),
    e
  )
}
async function vS(e) {
  try {
    let t = await eb(e),
      n = { statics: [], debris: [], model: null }
    for (let { geometry: e, extras: r } of t) {
      let t = e.boundingBox ?? new lr().setFromBufferAttribute(e.getAttribute(`position`)),
        i = { geometry: e, glass: r.glass === !0, center: t.getCenter(new B()), size: t.getSize(new B()) }
      ;(r.static === !0 ? n.statics : n.debris).push(i)
    }
    return ((n.model = n.debris.length > 0 ? lx(n.debris) : null), n)
  } catch (t) {
    return (console.warn(`[csplayer] break pieces failed to load:`, e, t), null)
  }
}
function yS(e) {
  if (e) for (let t of [...e.statics, ...e.debris]) t.geometry.dispose()
}
function bS(e) {
  ;(e.group.removeFromParent(), e.shards?.mesh.dispose())
}
function xS(e, t, n) {
  let r = 0,
    i = t
  for (; r < i;) {
    let t = (r + i) >> 1
    e[t] < n ? (r = t + 1) : (i = t)
  }
  return r
}
function SS(e) {
  let t = Math.imul(e | 0, 73244475) ^ 625341585
  return ((t = Math.imul(t ^ (t >>> 16), 73244475)), (t ^ (t >>> 16)) >>> 0)
}
function CS(e) {
  let t = e >>> 0
  return () => {
    t = (t + 1831565813) >>> 0
    let e = t
    return (
      (e = Math.imul(e ^ (e >>> 15), e | 1)),
      (e ^= e + Math.imul(e ^ (e >>> 7), e | 61)),
      ((e ^ (e >>> 14)) >>> 0) / 4294967296
    )
  }
}
var wS = `CS2A`,
  TS = 1
function ES(e, t) {
  let n = new Uint8Array(e),
    r = new DataView(e)
  if (n.length < 12 || String.fromCharCode(n[0], n[1], n[2], n[3]) !== wS)
    throw Error(`not a CS2 character animation file`)
  let i = r.getUint32(4, !0)
  if (i !== TS) throw Error(`unsupported character animation version ${i}`)
  let a = r.getUint32(8, !0),
    o = JSON.parse(new TextDecoder().decode(n.subarray(12, 12 + a))),
    s = 12 + a,
    c = (e, r, i) => {
      let a = new Uint8Array(e.count * r)
      if (e.count > 0) {
        let o = s + e.byteOffset
        t.decodeGltfBuffer(a, e.count, r, n.subarray(o, o + e.byteLength), `ATTRIBUTES`, i)
      }
      return a.buffer
    },
    l = new Uint32Array(c(o.frames, 4)),
    u = new Int16Array(c(o.rotations, 8, `QUATERNION`)),
    d = new Float32Array(u.length)
  for (let e = 0; e < u.length; e += 4) {
    let t = u[e],
      n = u[e + 1],
      r = u[e + 2],
      i = u[e + 3],
      a = 1 / (Math.hypot(t, n, r, i) || 1)
    ;((d[e] = t * a), (d[e + 1] = n * a), (d[e + 2] = r * a), (d[e + 3] = i * a))
  }
  let f = new Float32Array(c(o.translations, 12, `EXPONENTIAL`)),
    p = o.bones.length,
    m = new Map()
  for (let e of o.clips) {
    let t = {
        name: e.name,
        kind: e.kind,
        fps: e.fps,
        duration: e.duration,
        speed: e.speed ?? 0,
        direction: e.direction ?? 0,
        rotations: Array(p).fill(null),
        translations: Array(p).fill(null),
      },
      n = e.tracks
    for (let e = 0; e + 4 < n.length; e += 5) {
      let [r, i, a, o, s] = [n[e], n[e + 1], n[e + 2], n[e + 3], n[e + 4]]
      if (r >= p) continue
      let c = i === 0 ? 4 : 3,
        u = i === 0 ? d : f,
        m = { frames: l.subarray(o, o + a), values: u.subarray(s * c, (s + a) * c) }
      ;(i === 0 ? t.rotations : t.translations)[r] = m
    }
    m.set(t.name, t)
  }
  return { bones: o.bones, clips: m }
}
function DS(e) {
  let t = { q: new Float32Array(e * 4), t: new Float32Array(e * 3) }
  for (let n = 0; n < e; n++) t.q[n * 4 + 3] = 1
  return t
}
function OS(e, t) {
  ;(t.q.set(e.q), t.t.set(e.t))
}
function kS(e, t) {
  let n = e.length,
    r = new Map(e.map((e, t) => [e, t])),
    i = DS(n),
    a = new Int16Array(n).fill(-1),
    o = new Uint8Array(n),
    s = new Uint8Array(n),
    c = new Uint8Array(n)
  for (let c = 0; c < n; c++) {
    s[c] = +!!e[c].startsWith(`finger_`)
    let n = t(e[c])
    if (n) {
      ;((o[c] = 1), (a[c] = n.parent === null ? -1 : (r.get(n.parent) ?? -1)))
      for (let e = 0; e < 4; e++) i.q[c * 4 + e] = n.quaternion[e]
      for (let e = 0; e < 3; e++) i.t[c * 3 + e] = n.position[e]
    }
  }
  let l = (e) => {
      let t = r.get(e)
      if (t === void 0 || !o[t]) throw Error(`character rig has no ${e}`)
      return t
    },
    u = l(`pelvis`),
    d = l(`wpnPivot`),
    f = l(`spine_0`)
  for (let e = 0; e < n; e++)
    for (let t = e; t >= 0; t = a[t])
      if (t === f || t === d) {
        c[e] = 1
        break
      }
  return {
    count: n,
    names: e,
    rest: i,
    parent: a,
    present: o,
    finger: s,
    upper: c,
    pelvis: u,
    wpnPivot: d,
    spine: [l(`spine_1`), l(`spine_2`), l(`spine_3`)],
  }
}
function AS(e, t) {
  let n = 0,
    r = e.length - 1
  for (; n < r;) {
    let i = (n + r + 1) >> 1
    e[i] <= t ? (n = i) : (r = i - 1)
  }
  return n
}
function jS(e, t, n, r, i) {
  let { frames: a, values: o } = e,
    s = a.length - 1
  if (s === 0 || n <= a[0]) {
    for (let e = 0; e < t; e++) r[i + e] = o[e]
    return
  }
  if (n >= a[s]) {
    for (let e = 0; e < t; e++) r[i + e] = o[s * t + e]
    return
  }
  let c = AS(a, n),
    l = (n - a[c]) / (a[c + 1] - a[c]),
    u = c * t,
    d = u + t
  if (t === 3) {
    for (let e = 0; e < 3; e++) r[i + e] = o[u + e] + (o[d + e] - o[u + e]) * l
    return
  }
  let f = o[u] * o[d] + o[u + 1] * o[d + 1] + o[u + 2] * o[d + 2] + o[u + 3] * o[d + 3] < 0 ? -l : l,
    p = 0
  for (let e = 0; e < 4; e++) {
    let t = o[u + e] * (1 - l) + o[d + e] * f
    ;((r[i + e] = t), (p += t * t))
  }
  let m = 1 / Math.sqrt(p || 1)
  for (let e = 0; e < 4; e++) r[i + e] *= m
}
function MS(e, t) {
  return Math.min(Math.max(t, 0), e.duration) * e.fps
}
function NS(e, t, n, r) {
  let i = MS(t, n),
    a = t.kind === `upper`,
    { rest: o } = e
  for (let n = 0; n < e.count; n++) {
    if (a && !e.upper[n]) continue
    let s = t.rotations[n]
    if (s) jS(s, 4, i, r.q, n * 4)
    else if (!e.finger[n]) for (let e = 0; e < 4; e++) r.q[n * 4 + e] = o.q[n * 4 + e]
    let c = t.translations[n]
    if (c) jS(c, 3, i, r.t, n * 3)
    else if (!e.finger[n]) for (let e = 0; e < 3; e++) r.t[n * 3 + e] = o.t[n * 3 + e]
  }
}
var PS = new Float32Array(4)
function FS(e, t, n, r) {
  if (n <= 0) return
  let i = MS(e, t)
  for (let t = 0; t < e.rotations.length; t++) {
    let a = e.rotations[t]
    if (a) {
      if ((jS(a, 4, i, PS, 0), n < 1)) {
        let e = PS[3] < 0 ? -1 : 1
        ;((PS[0] *= n * e), (PS[1] *= n * e), (PS[2] *= n * e), (PS[3] = 1 - n + PS[3] * n * e))
        let t = 1 / Math.hypot(PS[0], PS[1], PS[2], PS[3])
        for (let e = 0; e < 4; e++) PS[e] *= t
      }
      zS(r.q, t * 4, r.q, t * 4, PS, 0)
    }
    let o = e.translations[t]
    if (o) {
      jS(o, 3, i, PS, 0)
      for (let e = 0; e < 3; e++) r.t[t * 3 + e] += PS[e] * n
    }
  }
}
function IS(e, t, n) {
  if (n <= 0) return
  if (n >= 1) {
    OS(t, e)
    return
  }
  let { q: r, t: i } = e
  for (let e = 0; e < r.length; e += 4) {
    let i = r[e] * t.q[e] + r[e + 1] * t.q[e + 1] + r[e + 2] * t.q[e + 2] + r[e + 3] * t.q[e + 3] < 0 ? -n : n,
      a = 0
    for (let o = 0; o < 4; o++) {
      let s = r[e + o] * (1 - n) + t.q[e + o] * i
      ;((r[e + o] = s), (a += s * s))
    }
    let o = 1 / Math.sqrt(a || 1)
    for (let t = 0; t < 4; t++) r[e + t] *= o
  }
  for (let e = 0; e < i.length; e++) i[e] += (t.t[e] - i[e]) * n
}
function LS(e, t, n, r) {
  for (let i = 0; i < e.q.length; i += 4) {
    let a = t.q[i] * r.q[i] + t.q[i + 1] * r.q[i + 1] + t.q[i + 2] * r.q[i + 2] + t.q[i + 3] * r.q[i + 3] < 0 ? -n : n
    for (let n = 0; n < 4; n++) e.q[i + n] += t.q[i + n] * a
  }
  for (let r = 0; r < e.t.length; r++) e.t[r] += t.t[r] * n
}
function RS(e, t) {
  for (let t = 0; t < e.q.length; t += 4) {
    let n = 1 / (Math.hypot(e.q[t], e.q[t + 1], e.q[t + 2], e.q[t + 3]) || 1)
    for (let r = 0; r < 4; r++) e.q[t + r] *= n
  }
  let n = 1 / (t || 1)
  for (let t = 0; t < e.t.length; t++) e.t[t] *= n
}
function zS(e, t, n, r, i, a) {
  let o = n[r],
    s = n[r + 1],
    c = n[r + 2],
    l = n[r + 3],
    u = i[a],
    d = i[a + 1],
    f = i[a + 2],
    p = i[a + 3]
  ;((e[t] = l * u + o * p + s * f - c * d),
    (e[t + 1] = l * d - o * f + s * p + c * u),
    (e[t + 2] = l * f + o * d - s * u + c * p),
    (e[t + 3] = l * p - o * u - s * d - c * f))
}
function BS(e, t, n, r, i, a) {
  let o = n[r],
    s = n[r + 1],
    c = n[r + 2],
    l = n[r + 3],
    u = i[a],
    d = i[a + 1],
    f = i[a + 2],
    p = 2 * (s * f - c * d),
    m = 2 * (c * u - o * f),
    h = 2 * (o * d - s * u)
  ;((e[t] = u + l * p + s * h - c * m), (e[t + 1] = d + l * m + c * p - o * h), (e[t + 2] = f + l * h + o * m - s * p))
}
var VS = new Set([
    `glock`,
    `usp_silencer`,
    `hkp2000`,
    `p250`,
    `fiveseven`,
    `tec9`,
    `cz75a`,
    `deagle`,
    `elite`,
    `revolver`,
    `taser`,
  ]),
  HS = new Set([`hegrenade`, `flashbang`, `smokegrenade`, `molotov`, `incgrenade`, `decoy`])
function US(e, t) {
  return t ? `knife` : e ? (e === `c4` ? `c4` : HS.has(e) ? `grenade` : `gun`) : `none`
}
function WS(e, t) {
  return t === `gun` ? (VS.has(e) ? `pistol` : `rifle`) : `knife`
}
function GS() {
  return {
    time: 0,
    weapon: ``,
    kind: `none`,
    speed: 0,
    moveAngle: 0,
    phase: 0,
    duck: 0,
    air: 0,
    airAge: 0,
    pitch: 0,
    equipAge: 1 / 0,
    fireAge: 1 / 0,
    reloadAge: 1 / 0,
    reloading: !1,
    pinPulled: !1,
    pinAge: 1 / 0,
    plantAge: 1 / 0,
    defuseAge: 1 / 0,
    death: ``,
    deathAge: 0,
  }
}
function KS(e, t, n) {
  let r = aC((t - e.walkSpeed) / Math.max(1, e.runSpeed - e.walkSpeed)),
    i = e.walkStride + (e.runStride - e.walkStride) * r
  return i + (e.crouchStride - i) * aC(n)
}
var qS = [`n`, `ne`, `e`, `se`, `s`, `sw`, `w`, `nw`],
  JS = 0.08,
  YS = 0.2,
  XS = 0.2,
  ZS = 70,
  QS = [0.3, 0.35, 0.35],
  $S = 0.001,
  eC = class {
    rig
    gait
    anims
    sets
    deaths
    stand
    crouch
    scratch
    acc
    chainQ = new Float64Array(20)
    chainT = new Float64Array(15)
    temp = new Float64Array(8)
    constructor(e, t) {
      if (e.bones.length !== t.count) throw Error(`character rig does not match the animation bones`)
      ;((this.anims = e),
        (this.rig = t),
        (this.sets = { rifle: this.classSet(`rifle`), pistol: this.classSet(`pistol`), knife: this.classSet(`knife`) }))
      let n = this.sets.rifle
      ;((this.gait = {
        walkSpeed: n.walk.speed,
        runSpeed: n.run.speed,
        crouchSpeed: n.crouch.speed,
        walkStride: n.walk.stride,
        runStride: n.run.stride,
        crouchStride: n.crouch.stride,
      }),
        (this.deaths = [...e.clips.values()].filter((e) => e.name.startsWith(`death_`))),
        (this.stand = DS(t.count)),
        (this.crouch = DS(t.count)),
        (this.scratch = DS(t.count)),
        (this.acc = DS(t.count)))
    }
    get deathClips() {
      return this.deaths.map((e) => e.name)
    }
    pose(e, t) {
      let n = this.rig
      if (e.death) {
        OS(n.rest, t)
        let r = this.anims.clips.get(e.death)
        r && NS(n, r, e.deathAge, t)
        return
      }
      let r = WS(e.weapon, e.kind),
        i = this.sets[r],
        a = aC(e.duck)
      if ((this.locomotion(i, e, a, t), e.air > $S)) {
        let n = a > 0.5 ? i.inAirCrouch : i.inAir
        n && this.overlay(n, Math.min(e.airAge, n.duration), aC(e.air), t)
      }
      if (e.kind === `gun`) {
        let n = this.clip(`${e.weapon}_idle`)
        n && FS(n, 0, 1, t)
        let i = this.clip(`${e.weapon}_shoot`) ?? (r === `rifle` ? this.clip(`rifle_shoot`) : null)
        i && e.fireAge < i.duration && FS(i, e.fireAge, iC(e.fireAge, i.duration, 0, YS), t)
      }
      let o = e.kind === `grenade` ? this.clip(`grenade_draw`) : e.kind === `c4` ? this.clip(`c4_draw`) : null
      o && this.overlay(o, o.duration, 1, t)
      let s = this.upperAction(e)
      s && this.overlay(s.clip, s.time, s.weight, t)
      let c = 0
      if (e.plantAge < 1 / 0) {
        let n = this.clip(a > 0.5 ? `c4_plant_crouch` : `c4_plant`)
        n && ((c = iC(e.plantAge, 1 / 0, XS, 0)), this.overlay(n, Math.min(e.plantAge, n.duration), c, t))
      } else if (e.defuseAge < 1 / 0) {
        let n = a > 0.5 ? i.defuseCrouch : i.defuse
        n && ((c = iC(e.defuseAge, 1 / 0, XS, 0)), this.overlay(n, n.duration > 0 ? e.defuseAge % n.duration : 0, c, t))
      }
      let l = Math.max(-70, Math.min(ZS, e.pitch)) * (1 - c)
      Math.abs(l) > 0.1 && this.aim((Math.PI / 180) * l, t)
    }
    clip(e) {
      return this.anims.clips.get(e) ?? null
    }
    classSet(e) {
      let t = (e) => {
          let t = this.clip(e)
          if (!t) throw Error(`character animations lack ${e}`)
          return t
        },
        n = (n) => {
          let r = qS.map((r) => t(`${e}_${n}_${r}`)).sort((e, t) => e.direction - t.direction)
          return {
            clips: r,
            speed: r.reduce((e, t) => e + t.speed, 0) / r.length,
            stride: r.reduce((e, t) => e + t.speed * t.duration, 0) / r.length,
          }
        }
      return {
        idle: t(`${e}_idle`),
        idleCrouch: t(`${e}_idle_crouch`),
        inAir: this.clip(`${e}_inair`),
        inAirCrouch: this.clip(`${e}_inair_crouch`),
        defuse: this.clip(`defuse_${e}`),
        defuseCrouch: this.clip(`defuse_crouch_${e}`),
        walk: n(`walk`),
        run: n(`run`),
        crouch: n(`crouch`),
      }
    }
    locomotion(e, t, n, r) {
      let { rig: i, stand: a, crouch: o, acc: s, scratch: c } = this
      ;(OS(i.rest, a), NS(i, e.idle, 0, a), OS(a, o), NS(i, e.idleCrouch, 0, o))
      let l = Math.max(0, t.speed),
        u = 1 - n,
        d = aC(l / e.walk.speed),
        f = aC((l - e.walk.speed) / Math.max(1, e.run.speed - e.walk.speed)),
        p = aC(l / e.crouch.speed),
        m = t.phase - Math.floor(t.phase)
      ;(s.q.fill(0), s.t.fill(0))
      let h = 0,
        g = (e, t) => {
          t <= $S || (LS(s, e, t, a), (h += t))
        },
        _ = (e, n, r) => {
          if (r <= $S) return
          let [a, o, s] = nC(e.clips, t.moveAngle)
          for (let [e, t] of [
            [a, 1 - s],
            [o, s],
          ])
            r * t <= $S || (OS(n, c), NS(i, e, m * e.duration, c), g(c, r * t))
        }
      ;(g(a, u * (1 - d)),
        _(e.walk, a, u * d * (1 - f)),
        _(e.run, a, u * d * f),
        g(o, n * (1 - p)),
        _(e.crouch, o, n * p),
        OS(s, r),
        RS(r, h))
    }
    overlay(e, t, n, r) {
      if (n <= $S) return
      let i = this.scratch
      ;(OS(r, i), NS(this.rig, e, t, i), e.kind === `upper` && this.carryWeapon(i), IS(r, i, n))
    }
    carryWeapon(e) {
      let { rig: t, temp: n } = this,
        r = t.pelvis * 4,
        i = t.pelvis * 3,
        a = this.stand,
        o = [-a.q[r], -a.q[r + 1], -a.q[r + 2], a.q[r + 3]]
      ;(zS(n, 0, e.q, r, o, 0), BS(n, 4, n, 0, a.t, i))
      let s = e.t[i] - n[4],
        c = e.t[i + 1] - n[5],
        l = e.t[i + 2] - n[6]
      tC(e, t.wpnPivot, n, 0, s, c, l, n)
    }
    upperAction(e) {
      let t = null,
        n = (e, n, r = !1) => {
          if (!(n >= 0) || n === 1 / 0) return
          let i = this.clip(e)
          if (!i || (!r && n >= i.duration) || (t && t.age <= n)) return
          let a = r ? iC(n, 1 / 0, JS, 0) : iC(n, i.duration, e.endsWith(`_draw`) ? 0 : JS, YS)
          t = { clip: i, time: Math.min(n, i.duration), weight: a, age: n }
        }
      switch (e.kind) {
        case `gun`:
          ;(e.reloading && n(`${e.weapon}_reload`, e.reloadAge), n(`${e.weapon}_draw`, e.equipAge))
          break
        case `knife`:
          ;(n(`knife_draw`, e.equipAge), n(`knife_attack`, e.fireAge))
          break
        case `grenade`:
          ;(n(`grenade_draw`, e.equipAge),
            e.pinPulled && n(`grenade_pullpin`, e.pinAge, !0),
            n(`grenade_throw`, e.fireAge))
          break
        case `c4`:
          n(`c4_draw`, e.equipAge)
          break
        default:
          break
      }
      return t
    }
    aim(e, t) {
      let { rig: n, chainQ: r, chainT: i, temp: a } = this,
        o = [n.pelvis, n.parent[n.spine[0]], ...n.spine],
        s = (e) => {
          for (let n = e; n < o.length; n++) {
            let e = o[n]
            if (n === 0) {
              for (let n = 0; n < 4; n++) r[n] = t.q[e * 4 + n]
              for (let n = 0; n < 3; n++) i[n] = t.t[e * 3 + n]
              continue
            }
            ;(zS(r, n * 4, r, (n - 1) * 4, t.q, e * 4), BS(i, n * 3, r, (n - 1) * 4, t.t, e * 3))
            for (let e = 0; e < 3; e++) i[n * 3 + e] += i[(n - 1) * 3 + e]
          }
        }
      s(0)
      let c = o.length - 1,
        l = [r[c * 4], r[c * 4 + 1], r[c * 4 + 2], r[c * 4 + 3]],
        u = [i[c * 3], i[c * 3 + 1], i[c * 3 + 2]]
      for (let i = 0; i < n.spine.length; i++) {
        let n = i + 2,
          c = o[n],
          l = (e * QS[i]) / 2,
          u = [Math.sin(l), 0, 0, Math.cos(l)],
          d = [r[n * 4], r[n * 4 + 1], r[n * 4 + 2], r[n * 4 + 3]]
        ;(zS(a, 0, [-d[0], -d[1], -d[2], d[3]], 0, u, 0), zS(a, 0, a, 0, d, 0), zS(t.q, c * 4, t.q, c * 4, a, 0), s(n))
      }
      let d = [-l[0], -l[1], -l[2], l[3]]
      ;(zS(a, 0, r, c * 4, d, 0),
        BS(a, 4, a, 0, u, 0),
        tC(t, n.wpnPivot, a, 0, i[c * 3] - a[4], i[c * 3 + 1] - a[5], i[c * 3 + 2] - a[6], a))
    }
  }
function tC(e, t, n, r, i, a, o, s) {
  let c = t * 4,
    l = t * 3
  ;(BS(s, 4, n, r, e.t, l),
    (e.t[l] = s[4] + i),
    (e.t[l + 1] = s[5] + a),
    (e.t[l + 2] = s[6] + o),
    zS(e.q, c, n, r, e.q, c))
}
function nC(e, t) {
  let n = rC(t),
    r = e.length
  for (let t = 0; t < r; t++) {
    let i = e[t].direction,
      a = t + 1 < r ? e[t + 1].direction : e[0].direction + Math.PI * 2,
      o = n
    if ((t + 1 >= r && o < i && (o += Math.PI * 2), o >= i && o < a)) return [e[t], e[(t + 1) % r], (o - i) / (a - i)]
  }
  let i = e[r - 1].direction - Math.PI * 2,
    a = e[0].direction
  return [e[r - 1], e[0], aC((n - i) / (a - i))]
}
function rC(e) {
  let t = Math.PI * 2
  return e - t * Math.floor((e + Math.PI) / t)
}
function iC(e, t, n, r) {
  let i = n > 0 ? aC(e / n) : 1,
    a = r > 0 && t < 1 / 0 ? aC((t - e) / r) : 1
  return Math.min(i, a)
}
function aC(e) {
  return e <= 0 ? 0 : e >= 1 ? 1 : e
}
var oC = 2,
  sC = 1,
  cC = 64,
  lC = 256,
  uC = 16,
  dC = 0.06,
  fC = 0.1,
  pC = 0.25,
  mC = 600,
  hC = 0.08,
  gC = 2e3,
  _C = 1,
  vC = 512,
  yC = 2.9
function bC() {
  return {
    weapon: ``,
    equipAge: 1 / 0,
    fireAge: 1 / 0,
    prevFireAge: 1 / 0,
    fireVariant: 0,
    reloadAge: 1 / 0,
    reloading: !1,
    yawRate: 0,
    speed: 0,
    distance: 0,
    pinPulled: !1,
    pinAge: 1 / 0,
    planting: !1,
    plantAge: 1 / 0,
    verticalSpeed: 0,
    landAge: 1 / 0,
    landSpeed: 0,
  }
}
function xC(e, t) {
  let n = e.length
  if (n === 0 || t <= e[0]) return 0
  if (t >= e[n - 1]) return n - 1
  let r = 0,
    i = n - 1
  for (; r < i;) {
    let n = (r + i + 1) >> 1
    e[n] <= t ? (r = n) : (i = n - 1)
  }
  return r
}
function SC(e, t, n, r) {
  let { tickRate: i, numPlayers: a } = e.meta
  return (
    CC(e, t, n, i, a, r),
    wC(e, t, n, i, r),
    TC(e, t, n, i, a, r),
    EC(e, t, n, i, a, r),
    (r.yawRate = AC(e, t, n, i, a)),
    (r.speed = jC(e, t, n, i, a)),
    (r.distance = PC(e, t, n, i, a)),
    (r.verticalSpeed = OC(e, t, n, i, a)),
    kC(e, t, n, i, a, r),
    r
  )
}
function CC(e, t, n, r, i, a) {
  let { panelFrames: o, weaponNames: s } = e
  if (((a.weapon = ``), (a.equipAge = 1 / 0), o.frameTick.length === 0)) return
  let c = xC(o.frameTick, n),
    l = o.activeWeapon[c * i + t]
  a.weapon = s[l] ?? ``
  for (let e = 1; e <= uC && c - e >= 0; e++) {
    let s = (c - e) * i + t
    if (o.activeWeapon[s] !== l || o.alive[s] !== 1) {
      a.equipAge = (n - o.frameTick[c - e + 1]) / r
      return
    }
  }
}
function wC(e, t, n, r, i) {
  ;((i.fireAge = 1 / 0), (i.prevFireAge = 1 / 0), (i.fireVariant = 0))
  let a = e.weaponFires
  if (!a || a.ticks.length === 0 || n < a.ticks[0]) return
  let o = n - oC * r,
    s = 0,
    c = 0
  for (let e = xC(a.ticks, n); e >= 0; e--) {
    let l = a.ticks[e]
    if (a.slots[e] !== t) {
      if (l < o) break
      continue
    }
    if (s === 0) {
      if (l < o) break
      i.fireAge = (n - l) / r
    } else {
      if ((c - l) / r > sC) break
      s === 1 && (i.prevFireAge = (n - l) / r)
    }
    if (((c = l), ++s >= cC)) break
  }
  i.fireVariant = s > 0 ? (s - 1) % 2 : 0
}
function TC(e, t, n, r, i, a) {
  ;((a.reloadAge = 1 / 0), (a.reloading = !1))
  let { reloading: o, frameTick: s } = e.frames
  if (!o || s.length === 0 || n < s[0]) return
  let c = DC(o, 1, xC(s, n), t, i, lC)
  ;((a.reloading = c.active), c.start >= 0 && (a.reloadAge = (n - s[c.start]) / r))
}
function EC(e, t, n, r, i, a) {
  ;((a.pinPulled = !1), (a.pinAge = 1 / 0), (a.planting = !1), (a.plantAge = 1 / 0))
  let { playerFlags: o, frameTick: s } = e.frames
  if (!o || s.length === 0 || n < s[0]) return
  let c = xC(s, n),
    l = DC(o, 2, c, t, i, vC)
  ;((a.pinPulled = l.active), l.start >= 0 && (a.pinAge = (n - s[l.start]) / r))
  let u = DC(o, 4, c, t, i, vC)
  if (((a.planting = u.active), u.start < 0)) return
  let d = s[Math.min(u.end + 1, s.length - 1)]
  ;(u.active || (d - s[u.start]) / r >= yC) && (a.plantAge = (n - s[u.start]) / r)
}
function DC(e, t, n, r, i, a) {
  let o = (n) => (e[n * i + r] & t) !== 0,
    s = o(n),
    c = n
  for (; c >= 0 && n - c < a && !o(c);) c--
  if (c < 0 || !o(c)) return { start: -1, end: -1, active: s }
  let l = c
  for (; l > 0 && c - l < a && o(l - 1);) l--
  return { start: l, end: c, active: s }
}
function OC(e, t, n, r, i) {
  let { posZ: a, playerFlags: o } = e.frames
  return !a || !o
    ? 0
    : FC(e, t, n, r, i, hC, (e, t, n) => {
        if (o[e] & o[t] & 1) return 0
        let r = (a[t] - a[e]) / n
        return Math.abs(r) > gC ? 0 : r
      })
}
function kC(e, t, n, r, i, a) {
  ;((a.landAge = 1 / 0), (a.landSpeed = 0))
  let { posZ: o, playerFlags: s, frameTick: c, alive: l } = e.frames
  if (!o || !s || c.length < 2 || n < c[0]) return
  let u = (e) => (s[e * i + t] & 1) != 0,
    d = (e) => {
      if (e < 0) return 0
      let n = e * i + t,
        a = n + i,
        s = (c[e + 1] - c[e]) / r
      if (s <= 0 || s > pC || l[n] !== 1 || l[a] !== 1) return 0
      let u = (o[n] - o[a]) / s
      return u > gC ? 0 : Math.max(0, u)
    }
  for (let e = xC(c, n); e > 0; e--) {
    if ((n - c[e]) / r > _C) return
    if (!(!u(e) || u(e - 1) || l[e * i + t] !== 1)) {
      ;((a.landAge = (n - c[e]) / r), (a.landSpeed = Math.max(d(e - 1), d(e - 2))))
      return
    }
  }
}
function AC(e, t, n, r, i) {
  let { yaw: a } = e.frames
  return FC(e, t, n, r, i, dC, (e, t, n) => LC(a[e], a[t]) / n)
}
function jC(e, t, n, r, i) {
  let { posX: a, posY: o } = e.frames
  return !a || !o ? 0 : FC(e, t, n, r, i, fC, (e, t, n) => MC(a, o, e, t, n))
}
function MC(e, t, n, r, i) {
  let a = Math.hypot(e[r] - e[n], t[r] - t[n]) / i
  return a > mC ? 0 : a
}
var NC = new WeakMap()
function PC(e, t, n, r, i) {
  let { frameTick: a, posX: o, posY: s, alive: c } = e.frames,
    l = a.length
  if (!o || !s || l < 2) return 0
  let u = NC.get(o)
  u || NC.set(o, (u = new Map()))
  let d = u.get(t)
  if (!d) {
    d = new Float64Array(l)
    for (let e = 0; e + 1 < l; e++) {
      let n = e * i + t,
        l = n + i,
        u = (a[e + 1] - a[e]) / r,
        f = u > 0 && u <= pC && c[n] === 1 && c[l] === 1
      d[e + 1] = d[e] + (f ? MC(o, s, n, l, u) * u : 0)
    }
    u.set(t, d)
  }
  let f = xC(a, n)
  if (f >= l - 1) return d[l - 1]
  let p = Math.min(1, Math.max(0, (n - a[f]) / (a[f + 1] - a[f])))
  return d[f] + (d[f + 1] - d[f]) * p
}
function FC(e, t, n, r, i, a, o) {
  let { frameTick: s, alive: c } = e.frames,
    l = s.length
  if (l < 2) return 0
  let u = 10 * a,
    d = 0
  for (let e = Math.min(xC(s, n), l - 2); e >= 0; e--) {
    let l = Math.max(0, (n - s[e + 1]) / r)
    if (l >= u) break
    let f = Math.min(u, (n - s[e]) / r)
    if (f <= l) continue
    let p = e * i + t,
      m = p + i,
      h = (s[e + 1] - s[e]) / r
    h <= 0 || h > pC || c[p] !== 1 || c[m] !== 1 || (d += o(p, m, h) * (IC(f, a) - IC(l, a)))
  }
  return d / IC(u, a)
}
function IC(e, t) {
  let n = e / t
  return 1 - (1 + n) * Math.exp(-n)
}
function LC(e, t) {
  let n = (t - e) % 360
  return (n > 180 && (n -= 360), n < -180 && (n += 360), n)
}
var RC = 0.25,
  zC = 600,
  BC = 0.1,
  VC = 5,
  HC = 0.12,
  UC = 0.15,
  WC = 128,
  GC = class {
    cache = new WeakMap()
    cycle
    constructor(e) {
      this.cycle = e
    }
    at(e, t, n) {
      let { frameTick: r, posX: i, posY: a, alive: o, duck: s } = e.frames,
        { tickRate: c, numPlayers: l } = e.meta,
        u = r.length
      if (!i || !a || u < 2) return 0
      let d = this.cache.get(i)
      d || this.cache.set(i, (d = new Map()))
      let f = d.get(t)
      if (!f) {
        f = new Float64Array(u)
        for (let e = 0; e + 1 < u; e++) {
          let n = e * l + t,
            u = n + l,
            d = (r[e + 1] - r[e]) / c,
            p = 0
          if (d > 0 && d <= RC && o[n] === 1 && o[u] === 1) {
            let e = Math.hypot(i[u] - i[n], a[u] - a[n]),
              t = e / d
            t <= zC && (p = e / KS(this.cycle, t, (s[n] + s[u]) / 2))
          }
          f[e + 1] = f[e] + p
        }
        d.set(t, f)
      }
      let p = xC(r, n)
      if (p >= u - 1) return f[u - 1]
      let m = r[p + 1] - r[p],
        h = m > 0 ? Math.min(1, Math.max(0, (n - r[p]) / m)) : 0
      return f[p] + (f[p + 1] - f[p]) * h
    }
  }
function KC(e, t, n) {
  let { tickRate: r } = e.meta,
    i = BC * r
  if (!YC(e, t, n - i, qC) || !YC(e, t, n + i, JC)) return NaN
  let a = JC[0] - qC[0],
    o = JC[1] - qC[1],
    s = Math.hypot(a, o) / (2 * BC)
  return s < VC || s > zC ? NaN : Math.atan2(o, a)
}
var qC = new Float64Array(2),
  JC = new Float64Array(2)
function YC(e, t, n, r) {
  let { frameTick: i, posX: a, posY: o, alive: s } = e.frames,
    c = e.meta.numPlayers,
    l = i.length
  if (l === 0) return !1
  let u = xC(i, n),
    d = Math.min(u + 1, l - 1),
    f = u * c + t,
    p = d * c + t
  if (s[f] !== 1 || s[p] !== 1) return !1
  let m = i[d] - i[u],
    h = m > 0 ? Math.min(1, Math.max(0, (n - i[u]) / m)) : 0
  return ((r[0] = a[f] + (a[p] - a[f]) * h), (r[1] = o[f] + (o[p] - o[f]) * h), !0)
}
function XC(e, t, n, r) {
  ;((r.weight = 0), (r.age = 0))
  let { playerFlags: i, frameTick: a, alive: o } = e.frames
  if (!i || a.length === 0 || n < a[0]) return r
  let { tickRate: s, numPlayers: c } = e.meta,
    l = (e) => (i[e * c + t] & 1) != 0,
    u = xC(a, n)
  if (o[u * c + t] !== 1) return r
  if (!l(u)) {
    let e = u
    for (; e > 0 && u - e < WC && !l(e - 1);) e--
    return ((r.age = Math.max(0, (n - a[e]) / s)), (r.weight = Math.min(1, r.age / HC)), r)
  }
  let d = u
  for (; d > 0 && u - d < WC && l(d - 1);) {
    if ((n - a[d - 1]) / s > UC) return r
    d--
  }
  if (d === 0 || l(d - 1)) return r
  let f = Math.max(0, (n - a[d]) / s)
  if (f >= UC) return r
  let p = d - 1
  for (; p > 0 && d - p < WC && !l(p - 1);) p--
  return ((r.age = Math.max(0, (a[d] - a[p]) / s)), (r.weight = 1 - f / UC), r)
}
var ZC = 1 / 0.0254,
  QC = 7,
  $C = 4.5,
  ew = { down: 30, forward: 45, swing: 60 },
  tw = 120,
  nw = [
    { bone: `pelvis`, mass: 50, angularDamping: 2 },
    { bone: `spine_2`, mass: 50, angularDamping: 2 },
    { bone: `head_0`, mass: 12, angularDamping: 3 },
    { bone: `leg_upper_l`, mass: 35, angularDamping: 2 },
    { bone: `leg_lower_l`, mass: 25, angularDamping: 2 },
    { bone: `ankle_l`, mass: 3, angularDamping: 2 },
    { bone: `leg_upper_r`, mass: 35, angularDamping: 2 },
    { bone: `leg_lower_r`, mass: 25, angularDamping: 2 },
    { bone: `ankle_r`, mass: 3, angularDamping: 2 },
    { bone: `arm_upper_l`, mass: 7, angularDamping: 2 },
    { bone: `arm_lower_l`, mass: 7, angularDamping: 2 },
    { bone: `hand_l`, mass: 3, angularDamping: 1 },
    { bone: `arm_upper_r`, mass: 7, angularDamping: 2 },
    { bone: `arm_lower_r`, mass: 7, angularDamping: 2 },
    { bone: `hand_r`, mass: 3, angularDamping: 1 },
  ],
  rw = [
    { bone: `leg_upper_l`, radius: 4, a: [3.902, 0, 0.27], b: [16.181, 0, 0.267] },
    { bone: `leg_lower_l`, radius: 4, a: [-1.268, 0, 0.272], b: [17.396, -0.014, 0.445] },
    { bone: `leg_upper_r`, radius: 4, a: [-3.747, 0.955, -0.202], b: [-15.911, 0.515, -0.281] },
    { bone: `leg_lower_r`, radius: 4, a: [1.755, 0, -0.486], b: [-17.394, 0.715, -0.285] },
    { bone: `head_0`, radius: 5, a: [2.613, 0.396, 0], b: [2.613, 0.396, 0] },
    { bone: `pelvis`, radius: 7, a: [-1.021, 1.017, 0], b: [8.89, 0.546, 0] },
    { bone: `spine_2`, radius: 7, a: [0, 0, 0], b: [9.874, 0.471, 0] },
    { bone: `arm_upper_l`, radius: 3, a: [0, 0, 0], b: [11.802, 0, 0] },
    { bone: `arm_lower_l`, radius: 2.7, a: [0, 0, 0], b: [12.028, 0, 0.609] },
    { bone: `arm_upper_r`, radius: 3, a: [0, 0, 0], b: [-11.802, 0, 0] },
    { bone: `arm_lower_r`, radius: 2.7, a: [0, 0, 0], b: [-12.028, 0, -0.78] },
    { bone: `hand_l`, radius: 3, a: [3.453, 1.472, 0], b: [3.453, 1.472, 0] },
    { bone: `hand_r`, radius: 3, a: [-3.534, -1.723, 0], b: [-3.534, -1.723, 0] },
    { bone: `ankle_l`, radius: 2, a: [-0.167, -2.314, 0], b: [8.454, 1.822, 0] },
    { bone: `ankle_r`, radius: 2, a: [-8.742, -1.77, 0], b: [0.058, 2.422, 0] },
  ],
  iw = [
    {
      parent: `pelvis`,
      child: `spine_2`,
      origin: [9.706, 0.545, -0.006],
      angles: [0.953, -11.821, -0.645],
      hinge: !1,
      swing: 12.61,
      min: -5.16,
      max: 33.24,
      friction: 0.189,
    },
    {
      parent: `spine_2`,
      child: `head_0`,
      origin: [15.008, 2.811, 0],
      angles: [87.837, -64.505, -91.148],
      hinge: !1,
      swing: 25,
      min: -40,
      max: 40,
      friction: 0.686,
    },
    {
      parent: `pelvis`,
      child: `leg_upper_l`,
      origin: [-3.722, 0.868, 3.703],
      angles: [-2.204, -178.527, 4.816],
      hinge: !1,
      swing: 15,
      min: -73.2,
      max: 35.52,
      friction: 0.377,
    },
    {
      parent: `leg_upper_l`,
      child: `leg_lower_l`,
      origin: [16.964, 0, 0],
      angles: [0, 1.67, 0],
      hinge: !0,
      swing: 0,
      min: 0,
      max: 110,
      friction: 0.157,
    },
    {
      parent: `leg_lower_l`,
      child: `ankle_l`,
      origin: [16.936, 0.015, 0],
      angles: [0, -70.606, 0],
      hinge: !1,
      swing: 6,
      min: -22.8,
      max: 28.2,
      friction: 0.381,
    },
    {
      parent: `pelvis`,
      child: `leg_upper_r`,
      origin: [-3.783, 0.94, -3.696],
      angles: [4.638, 176.304, -6.421],
      hinge: !1,
      swing: 15,
      min: -69.6,
      max: 34.8,
      friction: 0.37,
    },
    {
      parent: `leg_upper_r`,
      child: `leg_lower_r`,
      origin: [-16.98, 0.157, 0],
      angles: [0, -171.379, 0],
      hinge: !0,
      swing: 0,
      min: 0,
      max: 90,
      friction: 0.15,
    },
    {
      parent: `leg_lower_r`,
      child: `ankle_r`,
      origin: [-16.958, 0, 0],
      angles: [0, 114.122, 0],
      hinge: !1,
      swing: 5,
      min: -24.6,
      max: 26.4,
      friction: 0.393,
    },
    {
      parent: `spine_2`,
      child: `arm_upper_l`,
      origin: [9.199, 0.444, 7.169],
      angles: [-28.095, -25.792, -15.843],
      hinge: !1,
      swing: 45,
      min: -25,
      max: 0,
      friction: 0.201,
    },
    {
      parent: `arm_upper_l`,
      child: `arm_lower_l`,
      origin: [11.52, 0, 0],
      angles: [0, 25.482, 0],
      hinge: !1,
      swing: 7.45,
      min: -10.8,
      max: 51,
      friction: 0.162,
    },
    {
      parent: `arm_lower_l`,
      child: `hand_l`,
      origin: [11.506, 0, 0.212],
      angles: [0, 0, 0],
      hinge: !1,
      swing: 8,
      min: -15.99,
      max: 33.15,
      friction: 0.291,
    },
    {
      parent: `spine_2`,
      child: `arm_upper_r`,
      origin: [9.199, 0.444, -7.164],
      angles: [32.502, -54.418, -178.469],
      hinge: !1,
      swing: 45,
      min: -25,
      max: 0,
      friction: 0.201,
    },
    {
      parent: `arm_upper_r`,
      child: `arm_lower_r`,
      origin: [-11.62, 0.056, -0.001],
      angles: [0, -153.816, 0],
      hinge: !1,
      swing: 7.45,
      min: -12.6,
      max: 68.4,
      friction: 0.16,
    },
    {
      parent: `arm_lower_r`,
      child: `hand_r`,
      origin: [-12.455, 0, -0.68],
      angles: [0, 146.349, 0],
      hinge: !1,
      swing: 8,
      min: -10.07,
      max: 42.03,
      friction: 0.22,
    },
  ]
function aw(e) {
  let t = new Map()
  e.names.forEach((n, r) => {
    e.present[r] && t.set(n.toLowerCase(), r)
  })
  let n = nw.length,
    r = new Int16Array(n),
    i = new Map()
  for (let e = 0; e < n; e++) {
    let n = t.get(nw[e].bone)
    if (n === void 0) return null
    ;((r[e] = n), i.set(nw[e].bone, e))
  }
  let { pos: a, rot: o } = sw(e),
    s = new Float64Array(n * 3),
    c = new Float64Array(n),
    l = new Float64Array(n),
    u = new Float64Array(n * 3),
    d = new Float64Array(n),
    f = []
  for (let e = 0; e < n; e++) {
    let t = nw[e],
      n = rw.find((e) => e.bone === t.bone)
    if (!n) throw Error(`ragdoll body ${t.bone} has no shape`)
    let r = t.mass
    ;((c[e] = r), (l[e] = 1 / r), (d[e] = t.angularDamping))
    let [i, a, o] = n.a,
      [p, m, h] = n.b,
      g = (i + p) / 2,
      _ = (a + m) / 2,
      v = (o + h) / 2
    ;((s[e * 3] = g), (s[e * 3 + 1] = _), (s[e * 3 + 2] = v))
    let y = p - i,
      b = m - a,
      x = h - o,
      S = Math.hypot(y, b, x),
      C = n.radius,
      w = S > 0 ? 0.5 * r * C * C : 0.4 * r * C * C,
      T = S > 0 ? (r * (3 * C * C + S * S)) / 12 : w,
      E = S > 0 ? y / S : 1,
      D = S > 0 ? b / S : 0,
      O = S > 0 ? x / S : 0
    ;((u[e * 3] = 1 / ((T + (w - T) * E * E) * QC)),
      (u[e * 3 + 1] = 1 / ((T + (w - T) * D * D) * QC)),
      (u[e * 3 + 2] = 1 / ((T + (w - T) * O * O) * QC)))
    let k = S > 0 ? Math.ceil(S / (1.5 * C)) + 1 : 1
    for (let t = 0; t < k; t++) {
      let n = k === 1 ? 0.5 : t / (k - 1)
      f.push(e, i + y * n - g, a + b * n - _, o + x * n - v, C)
    }
  }
  let p = iw.map((e) => {
      let t = i.get(e.parent),
        n = i.get(e.child)
      if (t === void 0 || n === void 0) throw Error(`ragdoll joint ${e.parent}-${e.child} has no body`)
      let c = cw(e.angles[0], e.angles[1], e.angles[2]),
        l = r[t] * 3,
        u = r[t] * 4,
        d = r[n] * 3,
        f = r[n] * 4,
        p = dw(o, u, e.origin[0], e.origin[1], e.origin[2])
      ;((p[0] += a[l]), (p[1] += a[l + 1]), (p[2] += a[l + 2]))
      let m = lw(o, u, c, 0),
        h = uw(o, f),
        g = dw(h, 0, p[0] - a[d], p[1] - a[d + 1], p[2] - a[d + 2]),
        _ = lw(h, 0, m, 0),
        v = t * 3,
        y = n * 3,
        b = c,
        x = e.swing,
        S = e.max
      return (
        e.child.startsWith(`arm_upper_`)
          ? ((b = ow(o, u, f, n, c)), (x = ew.swing))
          : e.child.startsWith(`arm_lower_`) && (S = tw),
        {
          parent: t,
          child: n,
          parentOffset: new Float64Array([e.origin[0] - s[v], e.origin[1] - s[v + 1], e.origin[2] - s[v + 2]]),
          parentRotation: b,
          childOffset: new Float64Array([g[0] - s[y], g[1] - s[y + 1], g[2] - s[y + 2]]),
          childRotation: _,
          hinge: e.hinge,
          swing: (Math.PI / 180) * x,
          min: e.min * (Math.PI / 180),
          max: (Math.PI / 180) * S,
          friction: e.friction,
        }
      )
    }),
    m = new Float64Array(f),
    h = m.length / 5,
    g = new Set(p.map((e) => e.parent * n + e.child)),
    _ = (e) => /^(arm_upper|arm_lower|hand)_/.test(nw[e].bone),
    v = (e) => nw[e].bone === `pelvis` || nw[e].bone === `spine_2`,
    y = [],
    b = []
  for (let e = 0; e < h; e++)
    for (let t = e + 1; t < h; t++) {
      let r = m[e * 5],
        i = m[t * 5]
      if (r === i || g.has(r * n + i) || g.has(i * n + r) || (_(r) && _(i))) continue
      y.push(e, t)
      let a = m[e * 5 + 4],
        o = m[t * 5 + 4]
      ;(v(r) && _(i) && (a = Math.min(a, $C)), v(i) && _(r) && (o = Math.min(o, $C)), b.push(a + o))
    }
  let x = new Uint8Array(e.count)
  for (let e = 0; e < n; e++) x[r[e]] = 1
  let S = new Int16Array(e.count).fill(-1)
  for (let t = 0; t < e.count; t++)
    for (let n = t; n >= 0; n = e.parent[n]) {
      let e = r.indexOf(n)
      if (e >= 0) {
        S[t] = e
        break
      }
    }
  return {
    count: n,
    bone: r,
    hitBody: S,
    simulated: x,
    com: s,
    mass: c,
    invMass: l,
    invInertia: u,
    angularDamping: d,
    joints: p,
    spheres: m,
    sphereCount: h,
    selfPairs: new Int32Array(y),
    selfReach: new Float64Array(b),
  }
}
function ow(e, t, n, r, i) {
  let a = rw.find((e) => e.bone === nw[r].bone),
    o = dw(e, n, a.b[0] - a.a[0], a.b[1] - a.a[1], a.b[2] - a.a[2]),
    s = dw(uw(e, t), 0, o[0], o[1], o[2]),
    c = Math.hypot(s[0], s[1], s[2]),
    l = s[0] / c,
    u = s[1] / c,
    d = s[2] / c,
    f = Math.PI / 180,
    p = ew.down * f,
    m = ew.forward * f,
    h = -Math.cos(p),
    g = Math.sin(p) * Math.sin(m),
    _ = Math.sign(d) * Math.sin(p) * Math.cos(m),
    v = 1 + l * h + u * g + d * _,
    y = u * _ - d * g,
    b = d * h - l * _,
    x = l * g - u * h,
    S = Math.hypot(y, b, x, v)
  return lw([y / S, b / S, x / S, v / S], 0, i, 0)
}
function sw(e) {
  let t = new Float64Array(e.count * 3),
    n = new Float64Array(e.count * 4),
    { q: r, t: i } = e.rest
  for (let a = 0; a < e.count; a++) {
    let o = e.parent[a],
      s = i[a * 3] * ZC,
      c = i[a * 3 + 1] * ZC,
      l = i[a * 3 + 2] * ZC
    if (o < 0) {
      ;(t.set([s, c, l], a * 3), n.set(r.subarray(a * 4, a * 4 + 4), a * 4))
      continue
    }
    if (o > a) throw Error(`character rig bones must follow their parents`)
    let u = dw(n, o * 4, s, c, l)
    ;((t[a * 3] = t[o * 3] + u[0]),
      (t[a * 3 + 1] = t[o * 3 + 1] + u[1]),
      (t[a * 3 + 2] = t[o * 3 + 2] + u[2]),
      n.set(lw(n, o * 4, r, a * 4), a * 4))
  }
  return { pos: t, rot: n }
}
function cw(e, t, n) {
  let r = Math.PI / 360,
    i = Math.sin(e * r),
    a = Math.cos(e * r),
    o = Math.sin(t * r),
    s = Math.cos(t * r),
    c = Math.sin(n * r),
    l = Math.cos(n * r)
  return new Float64Array([c * a * s - l * i * o, l * i * s + c * a * o, l * a * o - c * i * s, l * a * s + c * i * o])
}
function lw(e, t, n, r) {
  let i = e[t],
    a = e[t + 1],
    o = e[t + 2],
    s = e[t + 3],
    c = n[r],
    l = n[r + 1],
    u = n[r + 2],
    d = n[r + 3]
  return new Float64Array([
    s * c + i * d + a * u - o * l,
    s * l - i * u + a * d + o * c,
    s * u + i * l - a * c + o * d,
    s * d - i * c - a * l - o * u,
  ])
}
function uw(e, t) {
  return new Float64Array([-e[t], -e[t + 1], -e[t + 2], e[t + 3]])
}
function dw(e, t, n, r, i) {
  let a = e[t],
    o = e[t + 1],
    s = e[t + 2],
    c = e[t + 3],
    l = 2 * (o * i - s * r),
    u = 2 * (s * n - a * i),
    d = 2 * (a * r - o * n)
  return new Float64Array([n + c * l + o * d - s * u, r + c * u + s * l - a * d, i + c * d + a * u - o * l])
}
var fw = 192,
  pw = 256,
  mw = 128,
  hw = 4,
  gw = 40,
  _w = class {
    hull = new Xx()
    rigs = new Map()
    falls = new Map()
    deadline = 0
    box = new lr()
    v = new B()
    setCollisionObject(e) {
      this.hull.setObject(e) && this.falls.clear()
    }
    beginFrame() {
      this.deadline = performance.now() + hw
    }
    fallOf(e, t, n) {
      let r = this.falls.get(e)
      if (r) return (this.falls.delete(e), this.falls.set(e, r), r)
      let i = this.ragdollOf(t)
      if (!i) return null
      let a = n(),
        o = this.gridAround(a.root)
      if (
        ((r = {
          root: a.root,
          pose: a.pose,
          track: new Kx(i.model, o, Gx(i.poser, a.pose, a.root, a.velocity, a.force, a.hitBone)),
          poser: i.poser,
          positions: new Float64Array(i.model.count * 3),
          rotations: new Float64Array(i.model.count * 4),
        }),
        this.falls.set(e, r),
        this.falls.size > gw)
      ) {
        let e = this.falls.keys().next().value
        e !== void 0 && this.falls.delete(e)
      }
      return r
    }
    pose(e, t, n, r) {
      let { track: i } = e
      for (; !i.done && i.duration < t && performance.now() < this.deadline;) i.advanceTo(t, 1)
      return (
        i.sample(t, e.positions, e.rotations),
        e.poser.poseOf(e.pose, e.root, e.positions, e.rotations, n),
        r.set(e.positions[0], e.positions[1], e.positions[2]),
        i.done ? (t >= i.duration ? `rest` : `falling`) : i.duration < t ? `behind` : `falling`
      )
    }
    ragdollOf(e) {
      let t = this.rigs.get(e)
      if (t === void 0) {
        let n = aw(e)
        ;((t = n ? { model: n, poser: new Bx(e, n) } : null), this.rigs.set(e, t))
      }
      return t
    }
    gridAround(e) {
      let t = this.box.set(this.v.set(e.x - fw, e.y - fw, e.z - pw), new B(e.x + fw, e.y + fw, e.z + mw)),
        n = []
      if ((this.hull.gather(t, n), n.length === 0)) {
        let { x: t, y: r, z: i } = e,
          a = fw
        n.push(t - a, r - a, i, t + a, r - a, i, t + a, r + a, i, t - a, r - a, i, t + a, r + a, i, t - a, r + a, i)
      }
      return new wx(new Float32Array(n))
    }
  },
  vw = 1 / 0.0254,
  yw = Math.PI / 180,
  bw = 36,
  xw = 52,
  Sw = 16,
  Cw = 140,
  ww = 1200,
  Tw = 2500,
  Ew = 4,
  Dw = 40,
  Ow = 12,
  kw = 4,
  Aw = 64,
  jw = 3,
  Mw = 2e4,
  Nw = 12e3,
  Pw = 9e3,
  Fw = 0.15,
  Iw = new H().makeScale(1 / vw, 1 / vw, 1 / vw),
  Lw = new Map([
    [
      `elite`,
      [
        new H().compose(
          new B(-3.578, -1.581, -0.253),
          new Ht(-0.1273, 0.1699, 0.9769, -0.0252).normalize(),
          new B(1, 1, 1),
        ),
        new H().compose(new B(3.616, 1.361, 0.439), new Ht(0.9886, 0.0134, 0.0907, 0.1191).normalize(), new B(1, 1, 1)),
      ],
    ],
  ])
function Rw(e) {
  let t = e.userData.weaponBone,
    n = new H()
  return t ? (n.compose(new B(...t.position), new Ht(...t.quaternion), new B(1, 1, 1)), n.invert()) : n
}
