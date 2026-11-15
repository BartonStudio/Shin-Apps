// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 33614–33718 行（切片 15/40）
// 角色：物理模型/姿势 Bx：bodiesOf/poseOf/modelSpace/placeChild
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var Bx = class {
    rig
    model
    pos
    rot
    q = new Float64Array(4)
    v = new Float64Array(3)
    constructor(e, t) {
      ;((this.rig = e),
        (this.model = t),
        (this.pos = new Float64Array(e.count * 3)),
        (this.rot = new Float64Array(e.count * 4)))
    }
    bodiesOf(e, t, n, r) {
      this.modelSpace(e)
      let i = zx(t.yaw),
        { bone: a, count: o } = this.model
      for (let e = 0; e < o; e++) {
        let o = a[e]
        ;(Jx(i, 0, this.pos[o * 3], this.pos[o * 3 + 1], this.pos[o * 3 + 2], 1, this.v),
          (n[e * 3] = t.x + this.v[0]),
          (n[e * 3 + 1] = t.y + this.v[1]),
          (n[e * 3 + 2] = t.z + this.v[2]),
          qx(i, 0, this.rot, o * 4, r, e * 4))
      }
    }
    poseOf(e, t, n, r, i) {
      let { rig: a, model: o, pos: s, rot: c, q: l, v: u } = this,
        d = zx(t.yaw),
        f = new Float64Array([-d[0], -d[1], -d[2], d[3]])
      for (let e = 0; e < o.count; e++) {
        let i = o.bone[e]
        ;(Jx(f, 0, n[e * 3] - t.x, n[e * 3 + 1] - t.y, n[e * 3 + 2] - t.z, 1, u),
          s.set(u, i * 3),
          qx(f, 0, r, e * 4, c, i * 4))
      }
      ;(i.q.set(e.q), i.t.set(e.t))
      for (let t = 0; t < a.count; t++) {
        let n = a.parent[t]
        if (o.simulated[t]) {
          if (n < 0) continue
          ;((l[0] = -c[n * 4]),
            (l[1] = -c[n * 4 + 1]),
            (l[2] = -c[n * 4 + 2]),
            (l[3] = c[n * 4 + 3]),
            Jx(l, 0, s[t * 3] - s[n * 3], s[t * 3 + 1] - s[n * 3 + 1], s[t * 3 + 2] - s[n * 3 + 2], 1, u),
            (i.t[t * 3] = u[0] / Lx),
            (i.t[t * 3 + 1] = u[1] / Lx),
            (i.t[t * 3 + 2] = u[2] / Lx),
            qx(l, 0, c, t * 4, i.q, t * 4))
          continue
        }
        this.placeChild(t, n, e)
      }
    }
    modelSpace(e) {
      for (let t = 0; t < this.rig.count; t++) this.placeChild(t, this.rig.parent[t], e)
    }
    placeChild(e, t, n) {
      let { pos: r, rot: i, v: a } = this,
        o = n.t[e * 3] * Lx,
        s = n.t[e * 3 + 1] * Lx,
        c = n.t[e * 3 + 2] * Lx
      if (t < 0) {
        ;((r[e * 3] = o), (r[e * 3 + 1] = s), (r[e * 3 + 2] = c))
        for (let t = 0; t < 4; t++) i[e * 4 + t] = n.q[e * 4 + t]
        return
      }
      ;(Jx(i, t * 4, o, s, c, 1, a),
        (r[e * 3] = r[t * 3] + a[0]),
        (r[e * 3 + 1] = r[t * 3 + 1] + a[1]),
        (r[e * 3 + 2] = r[t * 3 + 2] + a[2]),
        qx(i, t * 4, n.q, e * 4, i, e * 4))
    }
  },
  Vx = 7,
  Hx = 0.75,
  Ux = 260,
  Wx = 320
function Gx(e, t, n, r, i, a) {
  let o = e.model,
    s = new Float64Array(o.count * 3),
    c = new Float64Array(o.count * 4)
  e.bodiesOf(t, n, s, c)
  let l = 0
  for (let e = 0; e < o.count; e++) l += o.mass[e]
  let u = Math.hypot(r[0], r[1], r[2]),
    d = u > Wx ? Wx / u : 1,
    f = Hx / l,
    p = {
      bonePositions: s,
      boneRotations: c,
      velocity: [r[0] * d + i[0] * f, r[1] * d + i[1] * f, r[2] * d + i[2] * f],
      kickBody: -1,
      kick: [0, 0, 0],
    },
    m = a >= 0 && a < o.hitBody.length ? o.hitBody[a] : -1
  if (m >= 0) {
    let e = (1 - Hx) / o.mass[m],
      t = Math.hypot(i[0], i[1], i[2]) * e,
      n = t > Ux ? Ux / t : 1
    ;((p.kickBody = m), (p.kick = [i[0] * e * n, i[1] * e * n, i[2] * e * n]))
  }
  return p
}
