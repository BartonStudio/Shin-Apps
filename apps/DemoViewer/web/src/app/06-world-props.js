// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 32301–32967 行（切片 13/40）
// 角色：世界道具 Eb：死亡标记（death-label/death-name）、CSS3D 图层
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var Eb = class extends Rn {
    constructor(e = document.createElement(`div`)) {
      ;(super(),
        (this.isCSS2DObject = !0),
        (this.element = e),
        (this.element.style.position = `absolute`),
        (this.element.style.userSelect = `none`),
        this.element.setAttribute(`draggable`, !1),
        (this.center = new z(0.5, 0.5)),
        this.addEventListener(`removed`, function () {
          this.traverse(function (e) {
            e.element &&
              e.element instanceof e.element.ownerDocument.defaultView.Element &&
              e.element.parentNode !== null &&
              e.element.remove()
          })
        }))
    }
    copy(e, t) {
      return (super.copy(e, t), (this.element = e.element.cloneNode(!0)), (this.center = e.center), this)
    }
  },
  Db = new B(),
  Ob = new H(),
  kb = new H(),
  Ab = new B(),
  jb = new B(),
  Mb = class {
    constructor(e = {}) {
      let t = this,
        n,
        r,
        i,
        a,
        o = { objects: new WeakMap() },
        s = e.element === void 0 ? document.createElement(`div`) : e.element
      ;((s.style.overflow = `hidden`),
        (this.domElement = s),
        (this.sortObjects = !0),
        (this.getSize = function () {
          return { width: n, height: r }
        }),
        (this.render = function (e, t) {
          ;(e.matrixWorldAutoUpdate === !0 && e.updateMatrixWorld(),
            t.parent === null && t.matrixWorldAutoUpdate === !0 && t.updateMatrixWorld(),
            Ob.copy(t.matrixWorldInverse),
            kb.multiplyMatrices(t.projectionMatrix, Ob),
            l(e, e, t),
            this.sortObjects && f(e))
        }),
        (this.setSize = function (e, t) {
          ;((n = e), (r = t), (i = n / 2), (a = r / 2), (s.style.width = e + `px`), (s.style.height = t + `px`))
        }))
      function c(e) {
        e.isCSS2DObject && (e.element.style.display = `none`)
        for (let t = 0, n = e.children.length; t < n; t++) c(e.children[t])
      }
      function l(e, n, r) {
        if (e.visible === !1) {
          c(e)
          return
        }
        if (e.isCSS2DObject) {
          ;(Db.setFromMatrixPosition(e.matrixWorld), Db.applyMatrix4(kb))
          let c = Db.z >= -1 && Db.z <= 1 && e.layers.test(r.layers) === !0,
            l = e.element
          ;((l.style.display = c === !0 ? `` : `none`),
            c === !0 &&
              (e.onBeforeRender(t, n, r),
              (l.style.transform =
                `translate(` +
                -100 * e.center.x +
                `%,` +
                -100 * e.center.y +
                `%)translate(` +
                (Db.x * i + i) +
                `px,` +
                (-Db.y * a + a) +
                `px)`),
              l.parentNode !== s && s.appendChild(l),
              e.onAfterRender(t, n, r)))
          let d = { distanceToCameraSquared: u(r, e) }
          o.objects.set(e, d)
        }
        for (let t = 0, i = e.children.length; t < i; t++) l(e.children[t], n, r)
      }
      function u(e, t) {
        return (
          Ab.setFromMatrixPosition(e.matrixWorld),
          jb.setFromMatrixPosition(t.matrixWorld),
          Ab.distanceToSquared(jb)
        )
      }
      function d(e) {
        let t = []
        return (
          e.traverseVisible(function (e) {
            e.isCSS2DObject && t.push(e)
          }),
          t
        )
      }
      function f(e) {
        let t = d(e).sort(function (e, t) {
            return e.renderOrder === t.renderOrder
              ? o.objects.get(e).distanceToCameraSquared - o.objects.get(t).distanceToCameraSquared
              : t.renderOrder - e.renderOrder
          }),
          n = t.length
        for (let e = 0, r = t.length; e < r; e++) t[e].element.style.zIndex = n - e
      }
    }
  },
  Nb = 17,
  Pb = 2.2,
  Fb = 2.7,
  Ib = 26,
  Lb = class {
    scene
    group = new zn()
    markers = []
    crossGeometry = new so(Pb, Nb * 2 - Pb * 2, 4, 8)
    materials = new Map()
    constructor(e, t) {
      this.scene = e
      for (let e of t) this.addMarker(e)
      e.add(this.group)
    }
    setData(e) {
      let t = 0
      for (; t < this.markers.length && t < e.length;) {
        let n = this.markers[t].data,
          r = e[t]
        if (
          n.startTick !== r.startTick ||
          n.endTick !== r.endTick ||
          n.x !== r.x ||
          n.y !== r.y ||
          n.z !== r.z ||
          n.victimSlot !== r.victimSlot ||
          n.team !== r.team ||
          n.name !== r.name
        )
          break
        t++
      }
      if (t < this.markers.length) {
        for (let e of this.markers)
          (this.group.remove(e.cross),
            this.scene.remove(e.label),
            e.label.element.parentNode?.removeChild(e.label.element))
        ;((this.markers.length = 0), (t = 0))
      }
      for (let n = t; n < e.length; n++) this.addMarker(e[n])
    }
    addMarker(e) {
      let t = Rb(e, this.crossGeometry, this.materialFor(e.team))
      ;((t.visible = !1), this.group.add(t))
      let n = new Eb(zb(e))
      ;(n.position.set(e.x, e.y, e.z + Ib),
        (n.visible = !1),
        this.scene.add(n),
        this.markers.push({ data: e, cross: t, label: n }))
    }
    update(e, t, n = !1) {
      for (let r of this.markers) {
        let i = t[r.data.victimSlot] === 1,
          a = e >= r.data.startTick && e < r.data.endTick && !i
        ;((r.cross.visible = a), (r.label.visible = a && !n))
      }
    }
    debugCount() {
      return this.markers.filter((e) => e.cross.visible).length
    }
    dispose() {
      for (let e of this.markers) {
        this.scene.remove(e.label)
        let t = e.label.element
        t.parentNode?.removeChild(t)
      }
      ;(this.crossGeometry.dispose(), this.materials.forEach((e) => e.dispose()), this.scene.remove(this.group))
    }
    materialFor(e) {
      let t = this.materials.get(e)
      return (
        t ||
        ((t = new _i({ color: Bb(e), transparent: !0, opacity: 0.52, depthWrite: !1 })), this.materials.set(e, t), t)
      )
    }
  }
function Rb(e, t, n) {
  let r = new zn()
  r.position.set(e.x, e.y, e.z + Fb)
  for (let e of [-Math.PI / 4, Math.PI / 4]) {
    let i = new G(t, n)
    ;((i.rotation.z = e), (i.frustumCulled = !1), r.add(i))
  }
  return r
}
function zb(e) {
  let t = document.createElement(`div`)
  ;((t.className = `death-label`), t.style.setProperty(`--team-color`, Bb(e.team)))
  let n = document.createElement(`div`)
  return ((n.className = `death-name`), (n.textContent = e.name || `unknown`), t.appendChild(n), t)
}
function Bb(e) {
  return e === 2 ? `#e0a526` : e === 3 ? `#6db3f2` : `#aaaaaa`
}
function Vb(e, t) {
  let n = 0,
    r = e.length - 1
  if (r <= 0 || t < e[0]) return 0
  for (; n < r;) {
    let i = (n + r + 1) >> 1
    e[i] <= t ? (n = i) : (r = i - 1)
  }
  return n
}
function Hb(e, t, n) {
  if (t < e.startTick || t >= e.endTick || e.ticks.length === 0) return !1
  let r = Vb(e.ticks, t),
    i = r + 1,
    a = 0
  if (i < e.ticks.length && t > e.ticks[r]) {
    let n = e.ticks[i] - e.ticks[r]
    n > 0 && n <= 4 && (a = Math.min(1, (t - e.ticks[r]) / n))
  }
  let o = e.positions,
    s = e.angles,
    c = r * 3
  if (a === 0)
    return (
      (n.x = o[c]),
      (n.y = o[c + 1]),
      (n.z = o[c + 2]),
      (n.pitch = s[c]),
      (n.yaw = s[c + 1]),
      (n.roll = s[c + 2]),
      !0
    )
  let l = i * 3
  return (
    (n.x = o[c] + (o[l] - o[c]) * a),
    (n.y = o[c + 1] + (o[l + 1] - o[c + 1]) * a),
    (n.z = o[c + 2] + (o[l + 2] - o[c + 2]) * a),
    (n.pitch = Ub(s[c], s[l], a)),
    (n.yaw = Ub(s[c + 1], s[l + 1], a)),
    (n.roll = Ub(s[c + 2], s[l + 2], a)),
    !0
  )
}
function Ub(e, t, n) {
  return e + (((((t - e) % 360) + 540) % 360) - 180) * n
}
var Wb = {
    "AK-47": `ak47`,
    M4A4: `m4a1`,
    "M4A1-S": `m4a1_silencer`,
    AWP: `awp`,
    "SSG 08": `ssg08`,
    FAMAS: `famas`,
    "Galil AR": `galilar`,
    AUG: `aug`,
    "SG 553": `sg556`,
    "MAC-10": `mac10`,
    MP9: `mp9`,
    MP7: `mp7`,
    "MP5-SD": `mp5sd`,
    "PP-Bizon": `bizon`,
    P90: `p90`,
    "UMP-45": `ump45`,
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
    M249: `m249`,
    Negev: `negev`,
    Nova: `nova`,
    XM1014: `xm1014`,
    MAG7: `mag7`,
    "Sawed-Off": `sawedoff`,
    SCAR20: `scar20`,
    G3SG1: `g3sg1`,
    Zeus: `taser`,
    "Zeus x27": `taser`,
    Taser: `taser`,
    "High Explosive Grenade": `hegrenade`,
    Flashbang: `flashbang`,
    "Smoke Grenade": `smokegrenade`,
    Molotov: `molotov`,
    "Incendiary Grenade": `incgrenade`,
    "Decoy Grenade": `decoy`,
    "C4 Explosive": `c4`,
    Healthshot: `healthshot`,
    knife: `knife`,
    knife_t: `knife_t`,
    Bayonet: `bayonet`,
    "Bowie Knife": `knife_survival_bowie`,
    "Butterfly Knife": `knife_butterfly`,
    "Survival Knife": `knife_canis`,
    "Paracord Knife": `knife_cord`,
    "Classic Knife": `knife_css`,
    "Falchion Knife": `knife_falchion`,
    "Flip Knife": `knife_flip`,
    "Gut Knife": `knife_gut`,
    Karambit: `knife_karambit`,
    "Kukri Knife": `knife_kukri`,
    "M9 Bayonet": `knife_m9_bayonet`,
    "Navaja Knife": `knife_gypsy_jackknife`,
    "Nomad Knife": `knife_outdoor`,
    "Shadow Daggers": `knife_push`,
    "Skeleton Knife": `knife_skeleton`,
    "Stiletto Knife": `knife_stiletto`,
    "Huntsman Knife": `knife_tactical`,
    "Talon Knife": `knife_widowmaker`,
    "Ursus Knife": `knife_ursus`,
  },
  Gb = new Set(Object.values(Wb).filter((e) => /^(knife|bayonet)/.test(e))),
  Kb = {
    ak47: `ak47`,
    m4a1: `m4a1`,
    m4a1_silencer: `m4a1_silencer`,
    awp: `awp`,
    ssg08: `ssg08`,
    famas: `famas`,
    galilar: `galilar`,
    aug: `aug`,
    sg556: `sg556`,
    mac10: `mac10`,
    mp9: `mp9`,
    mp7: `mp7`,
    mp5sd: `mp5sd`,
    bizon: `bizon`,
    p90: `p90`,
    ump45: `ump45`,
    deagle: `deagle`,
    glock: `glock`,
    usp_silencer: `usp_silencer`,
    hkp2000: `hkp2000`,
    p250: `p250`,
    fiveseven: `fiveseven`,
    tec9: `tec9`,
    cz75a: `cz75a`,
    elite: `elite`,
    revolver: `revolver`,
    m249: `m249`,
    negev: `negev`,
    nova: `nova`,
    xm1014: `xm1014`,
    mag7: `mag7`,
    sawedoff: `sawedoff`,
    scar20: `scar20`,
    g3sg1: `g3sg1`,
    taser: `taser`,
    hegrenade: `hegrenade`,
    flashbang: `flashbang`,
    smokegrenade: `smokegrenade`,
    molotov: `molotov`,
    incgrenade: `incgrenade`,
    inferno: `molotov`,
    decoy: `decoy`,
    knife: `knife`,
    knife_t: `knife_t`,
    c4: `c4`,
    healthshot: `healthshot`,
  },
  qb = { smoke: `smokegrenade`, flash: `flashbang`, he: `hegrenade`, molotov: `molotov`, decoy: `decoy` },
  Jb = { armor: `armor`, armorHelmet: `armor_helmet`, defuser: `defuser` }
function Yb(e) {
  return `/icons/weapons/${e}.svg`
}
function Xb(e) {
  if (!e) return null
  let t = Wb[e]
  if (t) return Yb(t)
  let n = e.replace(/^weapon_/, ``).toLowerCase(),
    r = Kb[n]
  return r ? Yb(r) : Gb.has(n) ? Yb(n) : /knife|bayonet|karambit|dagger/i.test(e) ? Yb(`knife`) : null
}
function Zb(e) {
  return Yb(e)
}
var Qb = 0.36,
  $b = 4,
  ex = 1.25,
  tx = 1,
  nx = `#ececec`,
  rx = `rgba(8, 10, 12, 0.9)`,
  ix = Math.PI / 180,
  ax = 6,
  ox = class {
    scene
    group = new zn()
    geometry
    lighting
    modelMaterial
    icons = new Map()
    models = new Map()
    drops = []
    pose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }
    disposed = !1
    modelsEnabled = !1
    constructor(e, t, n) {
      ;((this.scene = e),
        (this.lighting = n),
        (this.modelMaterial = n.createMaterial({ surface: `vertex` })),
        (this.geometry = new po(1, 1)),
        this.geometry.rotateX(Math.PI / 2),
        this.setData(t),
        e.add(this.group))
    }
    setData(e) {
      let t = 0
      for (let n of e) {
        let e = Xb(n.weapon),
          r = this.modelFor(n.weapon)
        if (!e && !r) continue
        let i = e ? this.iconFor(e) : null,
          a = this.drops[t]
        if (a) ((a.data = n), (a.icon = i), (a.model = r))
        else {
          let e = new G(this.geometry, this.modelMaterial)
          ;((e.rotation.order = `ZYX`), (e.visible = !1), (e.frustumCulled = !1))
          let t = { data: n, mesh: e, icon: i, model: r, light: Rv(), litAt: new B(), litVersion: -1 }
          ;((e.onBeforeRender = (e, n, r, i, a) => {
            a === this.modelMaterial &&
              (Iy(this.modelMaterial.uniforms, t.light), (this.modelMaterial.uniformsNeedUpdate = !0))
          }),
            this.group.add(e),
            this.drops.push(t))
        }
        t++
      }
      for (let e = t; e < this.drops.length; e++) this.group.remove(this.drops[e].mesh)
      this.drops.length = t
    }
    setModelsEnabled(e) {
      if (((this.modelsEnabled = e), e)) for (let e of this.models.values()) this.requestModel(e)
    }
    update(e) {
      let t = this.pose
      for (let n of this.drops) {
        let { mesh: r, icon: i } = n,
          a = this.modelsEnabled ? (n.model?.geometry ?? null) : null
        if (!(a !== null || (i !== null && i.width > 0)) || !Hb(n.data, e, t)) {
          r.visible = !1
          continue
        }
        ;((r.visible = !0),
          r.rotation.set(t.roll * ix, t.pitch * ix, t.yaw * ix),
          a
            ? ((r.geometry = a),
              (r.material = this.modelMaterial),
              (r.renderOrder = 0),
              r.position.set(t.x, t.y, t.z),
              r.scale.set(1, 1, 1),
              (n.litVersion !== this.lighting.version || !n.litAt.equals(r.position)) &&
                (n.litAt.copy(r.position),
                (n.litVersion = this.lighting.version),
                this.lighting.sample(t.x, t.y, t.z + ax, n.light)))
            : i &&
              ((r.geometry = this.geometry),
              (r.material = i.material),
              (r.renderOrder = 1),
              r.position.set(t.x, t.y, t.z + tx),
              r.scale.set(i.width, 1, i.height)))
      }
    }
    debugCount() {
      return this.drops.filter((e) => e.mesh.visible).length
    }
    dispose() {
      ;((this.disposed = !0), this.scene.remove(this.group), this.geometry.dispose(), this.modelMaterial.dispose())
      for (let e of this.icons.values()) (e.material.dispose(), e.texture?.dispose())
      this.icons.clear()
      for (let e of this.models.values()) e.geometry?.dispose()
      ;(this.models.clear(), (this.drops.length = 0))
    }
    modelFor(e) {
      let t = Yy(e)
      if (!t) return null
      let n = this.models.get(t)
      if (n) return n
      let r = { file: t, requested: !1, geometry: null }
      return (this.models.set(t, r), this.modelsEnabled && this.requestModel(r), r)
    }
    requestModel(e) {
      e.requested ||
        ((e.requested = !0),
        tb($y(`world`, e.file))
          .then((t) => {
            this.disposed ? t.dispose() : (e.geometry = t)
          })
          .catch((t) => console.warn(`[csplayer] dropped weapon model ${e.file} failed to load`, t)))
    }
    iconFor(e) {
      let t = this.icons.get(e)
      if (t) return t
      let n = new _i({
          transparent: !0,
          alphaTest: 0.05,
          depthWrite: !1,
          side: 2,
          polygonOffset: !0,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
        r = { material: n, texture: null, width: 0, height: 0 }
      this.icons.set(e, r)
      let i = new Image()
      return (
        (i.decoding = `async`),
        (i.onload = () => {
          if (this.disposed) return
          let e = sx(i)
          if (!e) return
          let t = new no(e)
          ;((t.colorSpace = Ye), (t.anisotropy = 4), (n.map = t), (n.needsUpdate = !0), (r.texture = t))
          let a = 1 / $b
          ;((r.width = e.width * a * Qb), (r.height = e.height * a * Qb))
        }),
        (i.src = e),
        r
      )
    }
  }
function sx(e) {
  let t = e.naturalWidth || e.width,
    n = e.naturalHeight || e.height
  if (!t || !n) return null
  let r = Math.ceil(ex * $b) + 1,
    i = Math.ceil(t * $b),
    a = Math.ceil(n * $b),
    o = (t) => {
      let n = document.createElement(`canvas`)
      ;((n.width = i), (n.height = a))
      let r = n.getContext(`2d`)
      return (
        r.drawImage(e, 0, 0, i, a),
        (r.globalCompositeOperation = `source-in`),
        (r.fillStyle = t),
        r.fillRect(0, 0, i, a),
        n
      )
    },
    s = document.createElement(`canvas`)
  ;((s.width = i + r * 2), (s.height = a + r * 2))
  let c = s.getContext(`2d`)
  if (!c) return null
  let l = o(rx),
    u = ex * $b
  for (let e = 0; e < 16; e++) {
    let t = (e / 16) * Math.PI * 2
    c.drawImage(l, r + Math.cos(t) * u, r + Math.sin(t) * u)
  }
  return (c.drawImage(o(nx), r, r), s)
}
var cx = 0.02
function lx(e) {
  let t = e.length,
    n = new Float64Array(t * 3),
    r = new Float64Array(t),
    i = new Float64Array(t),
    a = new Float64Array(t * 3),
    o = new Float64Array(t).fill(1.5),
    s = []
  return (
    e.forEach(({ center: e, size: t }, o) => {
      n.set([e.x, e.y, e.z], o * 3)
      let c = Math.max(t.x, 1),
        l = Math.max(t.y, 1),
        u = Math.max(t.z, 1),
        d = Math.min(40, Math.max(0.5, c * l * u * cx))
      ;((r[o] = d),
        (i[o] = 1 / d),
        (a[o * 3] = 12 / (d * (l * l + u * u))),
        (a[o * 3 + 1] = 12 / (d * (c * c + u * u))),
        (a[o * 3 + 2] = 12 / (d * (c * c + l * l))))
      let f = Math.min(3, Math.max(0.5, Math.min(t.x, t.y, t.z) / 2)),
        p = [t.x, t.y, t.z].map((e) => {
          let t = e / 2 - f
          return t <= f / 2 ? [0] : t > 8 * f ? [-t, 0, t] : [-t, t]
        })
      for (let e of p[0]) for (let t of p[1]) for (let n of p[2]) s.push(o, e, t, n, f)
    }),
    {
      count: t,
      bone: new Int16Array(t),
      hitBody: new Int16Array(),
      simulated: new Uint8Array(),
      com: n,
      mass: r,
      invMass: i,
      invInertia: a,
      angularDamping: o,
      joints: [],
      spheres: new Float64Array(s),
      sphereCount: s.length / 5,
      selfPairs: new Int32Array(),
      selfReach: new Float64Array(),
    }
  )
}
var ux = 1 / 60,
  dx = 8,
  fx = 800,
  px = 0.9,
  mx = 0.7,
  hx = 360,
  gx = 6,
  _x = 2.5,
  vx = 10,
  yx = 20,
  bx = 512,
  xx = 3,
  Sx = 2,
  Cx = 0.001,
  wx = class {
    triangles
    cell
    cells = new Map()
    stamp
    query = 0
    constructor(e, t = 32) {
      ;((this.triangles = e), (this.cell = t))
      let n = e.length / 9
      this.stamp = new Uint32Array(n)
      for (let r = 0; r < n; r++) {
        let n = r * 9
        if (Nx(e, n) < Cx) continue
        let i = Math.min(e[n], e[n + 3], e[n + 6]),
          a = Math.min(e[n + 1], e[n + 4], e[n + 7]),
          o = Math.min(e[n + 2], e[n + 5], e[n + 8]),
          s = Math.max(e[n], e[n + 3], e[n + 6]),
          c = Math.max(e[n + 1], e[n + 4], e[n + 7]),
          l = Math.max(e[n + 2], e[n + 5], e[n + 8])
        for (let e = Math.floor(i / t); e <= Math.floor(s / t); e++)
          for (let n = Math.floor(a / t); n <= Math.floor(c / t); n++)
            for (let i = Math.floor(o / t); i <= Math.floor(l / t); i++) {
              let t = Tx(e, n, i),
                a = this.cells.get(t)
              a ? a.push(r) : this.cells.set(t, [r])
            }
      }
    }
    near(e, t, n, r, i, a, o) {
      let s = this.cell,
        c = ++this.query,
        l = 0
      for (let u = Math.floor(e / s); u <= Math.floor(r / s); u++)
        for (let e = Math.floor(t / s); e <= Math.floor(i / s); e++)
          for (let t = Math.floor(n / s); t <= Math.floor(a / s); t++) {
            let n = this.cells.get(Tx(u, e, t))
            if (n) for (let e of n) this.stamp[e] !== c && ((this.stamp[e] = c), l < o.length && (o[l] = e), l++)
          }
      return l
    }
  }
function Tx(e, t, n) {
  return ((e + 1024) * 2048 + (t + 1024)) * 2048 + (n + 1024)
}
