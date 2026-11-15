// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 32968–33613 行（切片 14/40）
// 角色：自研物理引擎 Ex：solveJoint/step/boneTransforms/staticFriction/solveContactVelocities（XPBD 风格刚体求解器）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var Ex = class {
  model
  x
  q
  v
  w
  xPrev
  qPrev
  grid
  candidates = new Int32Array(1024)
  nearStart
  nearList = new Int32Array(1024)
  contactBody = new Int32Array(bx)
  contactPoint = new Float64Array(bx * 3)
  contactNormal = new Float64Array(bx * 3)
  contactLambda = new Float64Array(bx)
  contacts = 0
  calm = 0
  limits
  selfApart
  settled = !1
  steps = 0
  s3 = new Float64Array(3)
  t3 = new Float64Array(3)
  fa = new Float64Array(4)
  fb = new Float64Array(4)
  constructor(e, t, n) {
    ;((this.model = e), (this.grid = t), (this.nearStart = new Int32Array(e.sphereCount + 1)))
    let r = e.count
    ;((this.x = new Float64Array(r * 3)),
      (this.q = new Float64Array(r * 4)),
      (this.v = new Float64Array(r * 3)),
      (this.w = new Float64Array(r * 3)),
      (this.xPrev = new Float64Array(r * 3)),
      (this.qPrev = new Float64Array(r * 4)))
    for (let t = 0; t < r; t++) {
      ;(this.q.set(n.boneRotations.subarray(t * 4, t * 4 + 4), t * 4),
        Mx(this.q, t * 4),
        this.toWorld(t, e.com[t * 3], e.com[t * 3 + 1], e.com[t * 3 + 2], this.s3))
      for (let e = 0; e < 3; e++)
        ((this.x[t * 3 + e] = n.bonePositions[t * 3 + e] + this.s3[e]),
          (this.v[t * 3 + e] = n.velocity[e] + (t === n.kickBody ? n.kick[e] : 0) + (n.velocities?.[t * 3 + e] ?? 0)),
          (this.w[t * 3 + e] = n.angularVelocities?.[t * 3 + e] ?? 0))
    }
    ;((this.limits = new Float64Array(e.joints.length * 3)),
      e.joints.forEach((e, t) => {
        let [n, r] = this.measureJoint(t)
        ;((this.limits[t * 3] = Math.max(e.swing, n)),
          (this.limits[t * 3 + 1] = Math.min(e.min, r)),
          (this.limits[t * 3 + 2] = Math.max(e.max, r)))
      }),
      (this.selfApart = new Uint8Array(e.selfReach.length).fill(1)),
      this.solveSelf(!0))
  }
  boneTransforms(e, t, n = 0) {
    let { com: r, count: i } = this.model
    for (let a = 0; a < i; a++) {
      this.toWorld(a, -r[a * 3], -r[a * 3 + 1], -r[a * 3 + 2], this.s3)
      for (let t = 0; t < 3; t++) e[n * 3 + a * 3 + t] = this.x[a * 3 + t] + this.s3[t]
      for (let e = 0; e < 4; e++) t[n * 4 + a * 4 + e] = this.q[a * 4 + e]
    }
  }
  measureJoint(e) {
    let t = this.model.joints[e],
      n = this.fa,
      r = this.fb
    ;(this.frame(t.parent, t.parentRotation, n), this.frame(t.child, t.childRotation, r))
    let i = Ox(n, 2),
      a = Ox(r, 2),
      o = Math.acos(Math.max(-1, Math.min(1, i[0] * a[0] + i[1] * a[1] + i[2] * a[2]))),
      s = i[0] + a[0],
      c = i[1] + a[1],
      l = i[2] + a[2]
    t.hinge && ([s, c, l] = i)
    let u = Math.hypot(s, c, l) || 1
    return [o, Dx(n, r, s / u, c / u, l / u)]
  }
  step() {
    if (this.settled) return
    let e = ux / dx,
      { count: t, invInertia: n, angularDamping: r } = this.model
    this.grid && this.gatherNear()
    for (let i = 0; i < dx; i++) {
      ;(this.xPrev.set(this.x), this.qPrev.set(this.q))
      for (let r = 0; r < t; r++) {
        this.v[r * 3 + 2] -= fx * e
        for (let t = 0; t < 3; t++) this.x[r * 3 + t] += this.v[r * 3 + t] * e
        this.toLocal(r, this.w[r * 3], this.w[r * 3 + 1], this.w[r * 3 + 2], this.s3)
        let t = 1 / n[r * 3],
          i = 1 / n[r * 3 + 1],
          a = 1 / n[r * 3 + 2],
          [o, s, c] = this.s3,
          l = s * a * c - c * i * s,
          u = c * t * o - o * a * c,
          d = o * i * s - s * t * o
        ;(this.toWorld(r, o - e * l * n[r * 3], s - e * u * n[r * 3 + 1], c - e * d * n[r * 3 + 2], this.s3),
          this.w.set(this.s3, r * 3),
          jx(this.q, r * 4, this.w[r * 3] * e, this.w[r * 3 + 1] * e, this.w[r * 3 + 2] * e, 1))
      }
      ;(this.model.joints.forEach((e, t) => this.solveJoint(e, t)),
        (this.contacts = 0),
        this.solveSelf(),
        this.grid && this.solveWorld())
      for (let n = 0; n < t; n++) {
        for (let t = 0; t < 3; t++) this.v[n * 3 + t] = (this.x[n * 3 + t] - this.xPrev[n * 3 + t]) / e
        let t = n * 4,
          i = this.q[t],
          a = this.q[t + 1],
          o = this.q[t + 2],
          s = this.q[t + 3],
          c = -this.qPrev[t],
          l = -this.qPrev[t + 1],
          u = -this.qPrev[t + 2],
          d = this.qPrev[t + 3],
          f = s * c + i * d + a * u - o * l,
          p = s * l - i * u + a * d + o * c,
          m = s * u + i * l - a * c + o * d,
          h = s * d - i * c - a * l - o * u < 0 ? -2 / e : 2 / e,
          g = 1 / (1 + e * r[n])
        ;((this.w[n * 3] = f * h * g), (this.w[n * 3 + 1] = p * h * g), (this.w[n * 3 + 2] = m * h * g))
      }
      this.solveContactVelocities(e)
      for (let t of this.model.joints) this.jointFriction(t, e)
    }
    ;(this.steps++, this.tightenLimits(), this.updateSettled())
  }
  tightenLimits() {
    let e = xx * ux
    this.model.joints.forEach((t, n) => {
      let r = n * 3
      ;((this.limits[r] = Math.max(t.swing, this.limits[r] - e)),
        (this.limits[r + 1] = Math.min(t.min, this.limits[r + 1] + e)),
        (this.limits[r + 2] = Math.max(t.max, this.limits[r + 2] - e)))
    })
  }
  updateSettled() {
    let e = 0
    for (let t = 0; t < this.model.count; t++) {
      let n = t * 3
      e = Math.max(
        e,
        Math.hypot(this.v[n], this.v[n + 1], this.v[n + 2]),
        Math.hypot(this.w[n], this.w[n + 1], this.w[n + 2]) * vx,
      )
    }
    ;((this.calm = e < _x ? this.calm + 1 : 0), this.calm >= yx && (this.settled = !0))
  }
  solveJoint(e, t) {
    let n = e.parent,
      r = e.child,
      i = this.limits[t * 3],
      a = this.limits[t * 3 + 1],
      o = this.limits[t * 3 + 2],
      s = this.fa,
      c = this.fb
    ;(this.frame(n, e.parentRotation, s), this.frame(r, e.childRotation, c))
    let [l, u, d] = Ox(s, 2),
      [f, p, m] = Ox(c, 2)
    if (e.hinge) {
      ;(this.applyAngular(n, r, u * m - d * p, d * f - l * m, l * p - u * f),
        this.frame(n, e.parentRotation, s),
        this.frame(r, e.childRotation, c))
      let t = Ox(s, 2)
      this.limitTwist(n, r, t[0], t[1], t[2], s, c, a, o)
    } else {
      let t = Math.max(-1, Math.min(1, l * f + u * p + d * m)),
        h = Math.acos(t)
      if (h > i) {
        let e = u * m - d * p,
          t = d * f - l * m,
          a = l * p - u * f,
          o = Math.hypot(e, t, a)
        if (o > 1e-9) {
          let s = (h - i) / o
          ;((e *= s), (t *= s), (a *= s), this.applyAngular(n, r, e, t, a))
        }
      }
      ;(this.frame(n, e.parentRotation, s), this.frame(r, e.childRotation, c))
      let g = Ox(s, 2),
        _ = Ox(c, 2),
        v = g[0] + _[0],
        y = g[1] + _[1],
        b = g[2] + _[2],
        x = Math.hypot(v, y, b)
      x > 1e-6 && ((v /= x), (y /= x), (b /= x), this.limitTwist(n, r, v, y, b, s, c, a, o))
    }
    let h = this.toWorld(n, e.parentOffset[0], e.parentOffset[1], e.parentOffset[2], this.s3),
      g = h[0],
      _ = h[1],
      v = h[2],
      y = this.toWorld(r, e.childOffset[0], e.childOffset[1], e.childOffset[2], this.t3),
      b = y[0],
      x = y[1],
      S = y[2],
      C = this.x[r * 3] + b - this.x[n * 3] - g,
      w = this.x[r * 3 + 1] + x - this.x[n * 3 + 1] - _,
      T = this.x[r * 3 + 2] + S - this.x[n * 3 + 2] - v
    this.applyPositional(n, g, _, v, r, b, x, S, C, w, T)
  }
  limitTwist(e, t, n, r, i, a, o, s, c) {
    let l = Dx(a, o, n, r, i),
      u = l > c ? l - c : l < s ? l - s : 0
    u !== 0 && this.applyAngular(e, t, n * u, r * u, i * u)
  }
  applyAngular(e, t, n, r, i) {
    let a = Math.hypot(n, r, i)
    if (a < 1e-9) return
    let o = n / a,
      s = r / a,
      c = i / a,
      l = a / (this.angularWeight(e, o, s, c) + this.angularWeight(t, o, s, c))
    ;(this.rotateBy(e, o * l, s * l, c * l, 1), this.rotateBy(t, o * l, s * l, c * l, -1))
  }
  applyPositional(e, t, n, r, i, a, o, s, c, l, u) {
    let d = Math.hypot(c, l, u)
    if (d < 1e-9) return 0
    let f = c / d,
      p = l / d,
      m = u / d,
      h = this.pointWeight(e, t, n, r, f, p, m)
    i >= 0 && (h += this.pointWeight(i, a, o, s, f, p, m))
    let g = d / h,
      _ = f * g,
      v = p * g,
      y = m * g
    return (this.push(e, t, n, r, _, v, y, 1), i >= 0 && this.push(i, a, o, s, _, v, y, -1), g)
  }
  push(e, t, n, r, i, a, o, s) {
    let c = this.model.invMass[e] * s
    ;((this.x[e * 3] += i * c),
      (this.x[e * 3 + 1] += a * c),
      (this.x[e * 3 + 2] += o * c),
      this.rotateBy(e, n * o - r * a, r * i - t * o, t * a - n * i, s))
  }
  rotateBy(e, t, n, r, i) {
    let a = this.applyInvInertia(e, t, n, r)
    jx(this.q, e * 4, a[0], a[1], a[2], i)
  }
  applyInvInertia(e, t, n, r) {
    let i = this.toLocal(e, t, n, r, this.s3),
      a = this.model.invInertia
    return this.toWorld(e, i[0] * a[e * 3], i[1] * a[e * 3 + 1], i[2] * a[e * 3 + 2], this.s3)
  }
  angularWeight(e, t, n, r) {
    let [i, a, o] = this.toLocal(e, t, n, r, this.s3),
      s = this.model.invInertia
    return i * i * s[e * 3] + a * a * s[e * 3 + 1] + o * o * s[e * 3 + 2]
  }
  pointWeight(e, t, n, r, i, a, o) {
    return this.model.invMass[e] + this.angularWeight(e, n * o - r * a, r * i - t * o, t * a - n * i)
  }
  frame(e, t, n) {
    kx(this.q, e * 4, t, 0, n)
  }
  toWorld(e, t, n, r, i) {
    return Ax(this.q, e * 4, t, n, r, 1, i)
  }
  toLocal(e, t, n, r, i) {
    return Ax(this.q, e * 4, t, n, r, -1, i)
  }
  solveSelf(e = !1) {
    let { spheres: t, selfPairs: n, selfReach: r } = this.model,
      i = this.selfApart
    for (let a = 0; a < n.length; a += 2) {
      let o = n[a] * 5,
        s = n[a + 1] * 5,
        c = t[o],
        l = t[s],
        u = this.toWorld(c, t[o + 1], t[o + 2], t[o + 3], this.s3),
        d = u[0],
        f = u[1],
        p = u[2],
        m = this.toWorld(l, t[s + 1], t[s + 2], t[s + 3], this.t3),
        h = this.x[c * 3] + d - this.x[l * 3] - m[0],
        g = this.x[c * 3 + 1] + f - this.x[l * 3 + 1] - m[1],
        _ = this.x[c * 3 + 2] + p - this.x[l * 3 + 2] - m[2],
        v = a >> 1,
        y = r[v],
        b = h * h + g * g + _ * _
      if (b >= y * y) {
        i[v] = 1
        continue
      }
      if ((e && (i[v] = 0), !i[v] || b < 1e-12)) continue
      let x = Math.sqrt(b),
        S = h / x,
        C = g / x,
        w = _ / x,
        T = y - x,
        E = y / (t[o + 4] + t[s + 4]),
        D = t[o + 4] * E,
        O = t[s + 4] * E
      this.applyPositional(
        c,
        d - S * D,
        f - C * D,
        p - w * D,
        l,
        m[0] + S * O,
        m[1] + C * O,
        m[2] + w * O,
        S * T,
        C * T,
        w * T,
      )
    }
  }
  gatherNear() {
    let e = this.grid,
      t = e.triangles,
      { spheres: n, sphereCount: r } = this.model,
      i = this.t3,
      a = 0
    for (let o = 0; o < r; o++) {
      this.nearStart[o] = a
      let r = o * 5,
        s = n[r],
        c = s * 3,
        l = this.toWorld(s, n[r + 1], n[r + 2], n[r + 3], this.s3),
        u = l[0],
        d = l[1],
        f = l[2],
        p = this.x[c] + u,
        m = this.x[c + 1] + d,
        h = this.x[c + 2] + f,
        g = this.w[c],
        _ = this.w[c + 1],
        v = this.w[c + 2],
        y = Math.hypot(this.v[c] + _ * f - v * d, this.v[c + 1] + v * u - g * f, this.v[c + 2] + g * d - _ * u),
        b = n[r + 4] + 2 * (y + fx * ux) * ux + Sx,
        x = e.near(p - b, m - b, h - b, p + b, m + b, h + b, this.candidates)
      x > this.candidates.length &&
        ((this.candidates = new Int32Array(x * 2)),
        (x = e.near(p - b, m - b, h - b, p + b, m + b, h + b, this.candidates)))
      for (let e = 0; e < x; e++) {
        let n = this.candidates[e]
        Fx(t, n * 9, p, m, h, i)
        let r = p - i[0],
          o = m - i[1],
          s = h - i[2]
        if (!(r * r + o * o + s * s >= b * b)) {
          if (a === this.nearList.length) {
            let e = new Int32Array(a * 2)
            ;(e.set(this.nearList), (this.nearList = e))
          }
          this.nearList[a++] = n
        }
      }
    }
    this.nearStart[r] = a
  }
  solveWorld() {
    let e = this.grid.triangles,
      { spheres: t, sphereCount: n } = this.model,
      r = this.t3
    for (let i = 0; i < n; i++) {
      let n = i * 5,
        a = t[n],
        o = t[n + 4],
        s = this.toWorld(a, t[n + 1], t[n + 2], t[n + 3], this.s3),
        c = this.x[a * 3] + s[0],
        l = this.x[a * 3 + 1] + s[1],
        u = this.x[a * 3 + 2] + s[2]
      for (let d = this.nearStart[i], f = this.nearStart[i + 1]; d < f; d++) {
        let i = this.nearList[d] * 9
        Fx(e, i, c, l, u, r)
        let f = c - r[0],
          p = l - r[1],
          m = u - r[2],
          h = f * f + p * p + m * m
        if (h >= o * o) continue
        let g = Math.sqrt(h)
        g < 1e-6 ? (Px(e, i, r), (f = r[0]), (p = r[1]), (m = r[2]), (g = 0)) : ((f /= g), (p /= g), (m /= g))
        let _ = o - g,
          v = c - f * o - this.x[a * 3],
          y = l - p * o - this.x[a * 3 + 1],
          b = u - m * o - this.x[a * 3 + 2],
          x = this.applyPositional(a, v, y, b, -1, 0, 0, 0, f * _, p * _, m * _)
        ;(this.staticFriction(a, v, y, b, f, p, m, x),
          (s = this.toWorld(a, t[n + 1], t[n + 2], t[n + 3], this.s3)),
          (c = this.x[a * 3] + s[0]),
          (l = this.x[a * 3 + 1] + s[1]),
          (u = this.x[a * 3 + 2] + s[2]))
      }
    }
  }
  staticFriction(e, t, n, r, i, a, o, s) {
    let c = this.toLocal(e, t, n, r, this.s3),
      l = c[0],
      u = c[1],
      d = c[2]
    if (this.contacts < bx) {
      let t = this.contacts++
      ;((this.contactBody[t] = e),
        (this.contactPoint[t * 3] = l),
        (this.contactPoint[t * 3 + 1] = u),
        (this.contactPoint[t * 3 + 2] = d),
        (this.contactNormal[t * 3] = i),
        (this.contactNormal[t * 3 + 1] = a),
        (this.contactNormal[t * 3 + 2] = o),
        (this.contactLambda[t] = s))
    }
    let f = Ax(this.qPrev, e * 4, l, u, d, 1, this.t3),
      p = this.toWorld(e, l, u, d, this.s3),
      m = this.x[e * 3] + p[0] - this.xPrev[e * 3] - f[0],
      h = this.x[e * 3 + 1] + p[1] - this.xPrev[e * 3 + 1] - f[1],
      g = this.x[e * 3 + 2] + p[2] - this.xPrev[e * 3 + 2] - f[2],
      _ = m * i + h * a + g * o
    ;((m -= _ * i), (h -= _ * a), (g -= _ * o))
    let v = Math.hypot(m, h, g)
    if (v < 1e-9) return
    let y = p[0],
      b = p[1],
      x = p[2]
    v / this.pointWeight(e, y, b, x, m / v, h / v, g / v) < px * s &&
      this.applyPositional(e, y, b, x, -1, 0, 0, 0, -m, -h, -g)
  }
  solveContactVelocities(e) {
    for (let t = 0; t < this.contacts; t++) {
      let n = this.contactBody[t],
        r = this.toWorld(
          n,
          this.contactPoint[t * 3],
          this.contactPoint[t * 3 + 1],
          this.contactPoint[t * 3 + 2],
          this.t3,
        ),
        i = r[0],
        a = r[1],
        o = r[2],
        s = this.contactNormal[t * 3],
        c = this.contactNormal[t * 3 + 1],
        l = this.contactNormal[t * 3 + 2],
        u = n * 3,
        d = this.w[u],
        f = this.w[u + 1],
        p = this.w[u + 2],
        m = this.v[u] + f * o - p * a,
        h = this.v[u + 1] + p * i - d * o,
        g = this.v[u + 2] + d * a - f * i,
        _ = m * s + h * c + g * l,
        v = m - _ * s,
        y = h - _ * c,
        b = g - _ * l,
        x = Math.hypot(v, y, b),
        S = 0,
        C = 0,
        w = 0
      if (x > 1e-9) {
        let n = Math.min((mx * this.contactLambda[t]) / e, x) / x
        ;((S -= v * n), (C -= y * n), (w -= b * n))
      }
      _ < 0 && ((S -= _ * s), (C -= _ * c), (w -= _ * l))
      let T = Math.hypot(S, C, w)
      if (T < 1e-9) continue
      let E = T / this.pointWeight(n, i, a, o, S / T, C / T, w / T),
        D = (S / T) * E,
        O = (C / T) * E,
        k = (w / T) * E,
        A = this.model.invMass[n]
      ;((this.v[u] += D * A), (this.v[u + 1] += O * A), (this.v[u + 2] += k * A))
      let ee = this.applyInvInertia(n, a * k - o * O, o * D - i * k, i * O - a * D)
      ;((this.w[u] += ee[0]), (this.w[u + 1] += ee[1]), (this.w[u + 2] += ee[2]))
    }
  }
  jointFriction(e, t) {
    let n = e.parent * 3,
      r = e.child * 3,
      i = this.w[r] - this.w[n],
      a = this.w[r + 1] - this.w[n + 1],
      o = this.w[r + 2] - this.w[n + 2],
      s = Math.hypot(i, a, o)
    if (s < 1e-9) return
    let c = i / s,
      l = a / s,
      u = o / s,
      d = s / (this.angularWeight(e.parent, c, l, u) + this.angularWeight(e.child, c, l, u)),
      f = e.friction * hx * this.model.mass[e.child] * gx * t,
      p = Math.min(d, f),
      m = this.applyInvInertia(e.parent, c * p, l * p, u * p)
    ;((this.w[n] += m[0]), (this.w[n + 1] += m[1]), (this.w[n + 2] += m[2]))
    let h = this.applyInvInertia(e.child, c * p, l * p, u * p)
    ;((this.w[r] -= h[0]), (this.w[r + 1] -= h[1]), (this.w[r + 2] -= h[2]))
  }
}
function Dx(e, t, n, r, i) {
  let [a, o, s] = Ox(e, 0),
    [c, l, u] = Ox(t, 0),
    d = a * n + o * r + s * i
  ;((a -= d * n), (o -= d * r), (s -= d * i), (d = c * n + l * r + u * i), (c -= d * n), (l -= d * r), (u -= d * i))
  let f = (o * u - s * l) * n + (s * c - a * u) * r + (a * l - o * c) * i
  return Math.atan2(f, a * c + o * l + s * u)
}
function Ox(e, t) {
  let n = e[0],
    r = e[1],
    i = e[2],
    a = e[3]
  return t === 0
    ? [1 - 2 * (r * r + i * i), 2 * (n * r + a * i), 2 * (n * i - a * r)]
    : t === 1
      ? [2 * (n * r - a * i), 1 - 2 * (n * n + i * i), 2 * (r * i + a * n)]
      : [2 * (n * i + a * r), 2 * (r * i - a * n), 1 - 2 * (n * n + r * r)]
}
function kx(e, t, n, r, i) {
  let a = e[t],
    o = e[t + 1],
    s = e[t + 2],
    c = e[t + 3],
    l = n[r],
    u = n[r + 1],
    d = n[r + 2],
    f = n[r + 3]
  ;((i[0] = c * l + a * f + o * d - s * u),
    (i[1] = c * u - a * d + o * f + s * l),
    (i[2] = c * d + a * u - o * l + s * f),
    (i[3] = c * f - a * l - o * u - s * d))
}
function Ax(e, t, n, r, i, a, o) {
  let s = e[t] * a,
    c = e[t + 1] * a,
    l = e[t + 2] * a,
    u = e[t + 3],
    d = 2 * (c * i - l * r),
    f = 2 * (l * n - s * i),
    p = 2 * (s * r - c * n)
  return ((o[0] = n + u * d + c * p - l * f), (o[1] = r + u * f + l * d - s * p), (o[2] = i + u * p + s * f - c * d), o)
}
function jx(e, t, n, r, i, a) {
  let o = e[t],
    s = e[t + 1],
    c = e[t + 2],
    l = e[t + 3],
    u = 0.5 * a
  ;((e[t] += u * (n * l + r * c - i * s)),
    (e[t + 1] += u * (r * l + i * o - n * c)),
    (e[t + 2] += u * (i * l + n * s - r * o)),
    (e[t + 3] += u * (-n * o - r * s - i * c)),
    Mx(e, t))
}
function Mx(e, t) {
  let n = Math.hypot(e[t], e[t + 1], e[t + 2], e[t + 3]) || 1
  ;((e[t] /= n), (e[t + 1] /= n), (e[t + 2] /= n), (e[t + 3] /= n))
}
function Nx(e, t) {
  let n = e[t + 3] - e[t],
    r = e[t + 4] - e[t + 1],
    i = e[t + 5] - e[t + 2],
    a = e[t + 6] - e[t],
    o = e[t + 7] - e[t + 1],
    s = e[t + 8] - e[t + 2]
  return Math.hypot(r * s - i * o, i * a - n * s, n * o - r * a)
}
function Px(e, t, n) {
  let r = e[t + 3] - e[t],
    i = e[t + 4] - e[t + 1],
    a = e[t + 5] - e[t + 2],
    o = e[t + 6] - e[t],
    s = e[t + 7] - e[t + 1],
    c = e[t + 8] - e[t + 2],
    l = i * c - a * s,
    u = a * o - r * c,
    d = r * s - i * o,
    f = Math.hypot(l, u, d) || 1
  ;((n[0] = l / f), (n[1] = u / f), (n[2] = d / f))
}
function Fx(e, t, n, r, i, a) {
  let o = e[t],
    s = e[t + 1],
    c = e[t + 2],
    l = e[t + 3] - o,
    u = e[t + 4] - s,
    d = e[t + 5] - c,
    f = e[t + 6] - o,
    p = e[t + 7] - s,
    m = e[t + 8] - c,
    h = n - o,
    g = r - s,
    _ = i - c,
    v = l * h + u * g + d * _,
    y = f * h + p * g + m * _
  if (v <= 0 && y <= 0) return Ix(a, o, s, c)
  let b = n - e[t + 3],
    x = r - e[t + 4],
    S = i - e[t + 5],
    C = l * b + u * x + d * S,
    w = f * b + p * x + m * S
  if (C >= 0 && w <= C) return Ix(a, e[t + 3], e[t + 4], e[t + 5])
  let T = v * w - C * y
  if (T <= 0 && v >= 0 && C <= 0) {
    let e = v / (v - C)
    return Ix(a, o + l * e, s + u * e, c + d * e)
  }
  let E = n - e[t + 6],
    D = r - e[t + 7],
    O = i - e[t + 8],
    k = l * E + u * D + d * O,
    A = f * E + p * D + m * O
  if (A >= 0 && k <= A) return Ix(a, e[t + 6], e[t + 7], e[t + 8])
  let ee = k * y - v * A
  if (ee <= 0 && y >= 0 && A <= 0) {
    let e = y / (y - A)
    return Ix(a, o + f * e, s + p * e, c + m * e)
  }
  let te = C * A - k * w
  if (te <= 0 && w - C >= 0 && k - A >= 0) {
    let n = (w - C) / (w - C + (k - A)),
      r = e[t + 3],
      i = e[t + 4],
      o = e[t + 5]
    return Ix(a, r + (e[t + 6] - r) * n, i + (e[t + 7] - i) * n, o + (e[t + 8] - o) * n)
  }
  let j = 1 / (te + ee + T),
    M = ee * j,
    ne = T * j
  Ix(a, o + l * M + f * ne, s + u * M + p * ne, c + d * M + m * ne)
}
function Ix(e, t, n, r) {
  ;((e[0] = t), (e[1] = n), (e[2] = r))
}
var Lx = 1 / 0.0254,
  Rx = 6
function zx(e) {
  let t = Math.cos(e),
    n = Math.sin(e),
    r = -n,
    i = t,
    a = t,
    o = n,
    s = r + 0 + 0,
    c,
    l,
    u,
    d
  if (s > 0) {
    let e = 0.5 / Math.sqrt(s + 1)
    ;((d = 0.25 / e), (c = (1 - o) * e), (l = (i - 0) * e), (u = (a - 0) * e))
  } else if (r > 0 && r > 0) {
    let e = 2 * Math.sqrt(1 + r - 0 - 0)
    ;((d = (1 - o) / e), (c = 0.25 * e), (l = (0 + a) / e), (u = (i + 0) / e))
  } else {
    let e = 2 * Math.sqrt(1 - r - 0)
    ;((d = (a - 0) / e), (c = (i + 0) / e), (l = (o + 1) / e), (u = 0.25 * e))
  }
  return new Float64Array([c, l, u, d])
}
