// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 41381–41590 行（切片 21/34）
// 角色：线段材质 ZO：linewidth/dashed/alphaToCoverage
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var ZO = class extends To {
    constructor(e) {
      ;(super({
        type: `LineMaterial`,
        uniforms: So.clone(bc.line.uniforms),
        vertexShader: bc.line.vertexShader,
        fragmentShader: bc.line.fragmentShader,
        clipping: !0,
      }),
        (this.isLineMaterial = !0),
        this.setValues(e))
    }
    get color() {
      return this.uniforms.diffuse.value
    }
    set color(e) {
      this.uniforms.diffuse.value = e
    }
    get worldUnits() {
      return `WORLD_UNITS` in this.defines
    }
    set worldUnits(e) {
      ;((e === !0) !== this.worldUnits && (this.needsUpdate = !0),
        e === !0 ? (this.defines.WORLD_UNITS = ``) : delete this.defines.WORLD_UNITS)
    }
    get linewidth() {
      return this.uniforms.linewidth.value
    }
    set linewidth(e) {
      this.uniforms.linewidth && (this.uniforms.linewidth.value = e)
    }
    get dashed() {
      return `USE_DASH` in this.defines
    }
    set dashed(e) {
      ;((e === !0) !== this.dashed && (this.needsUpdate = !0),
        e === !0 ? (this.defines.USE_DASH = ``) : delete this.defines.USE_DASH)
    }
    get dashScale() {
      return this.uniforms.dashScale.value
    }
    set dashScale(e) {
      this.uniforms.dashScale.value = e
    }
    get dashSize() {
      return this.uniforms.dashSize.value
    }
    set dashSize(e) {
      this.uniforms.dashSize.value = e
    }
    get dashOffset() {
      return this.uniforms.dashOffset.value
    }
    set dashOffset(e) {
      this.uniforms.dashOffset.value = e
    }
    get gapSize() {
      return this.uniforms.gapSize.value
    }
    set gapSize(e) {
      this.uniforms.gapSize.value = e
    }
    get opacity() {
      return this.uniforms.opacity.value
    }
    set opacity(e) {
      this.uniforms && (this.uniforms.opacity.value = e)
    }
    get resolution() {
      return this.uniforms.resolution.value
    }
    set resolution(e) {
      this.uniforms.resolution.value.copy(e)
    }
    get alphaToCoverage() {
      return `USE_ALPHA_TO_COVERAGE` in this.defines
    }
    set alphaToCoverage(e) {
      this.defines &&
        ((e === !0) !== this.alphaToCoverage && (this.needsUpdate = !0),
        e === !0 ? (this.defines.USE_ALPHA_TO_COVERAGE = ``) : delete this.defines.USE_ALPHA_TO_COVERAGE)
    }
  },
  QO = new sn(),
  $O = new B(),
  ek = new B(),
  tk = new sn(),
  nk = new sn(),
  rk = new sn(),
  ik = new B(),
  ak = new H(),
  ok = new pc(),
  sk = new B(),
  ck = new lr(),
  lk = new Nr(),
  uk = new sn(),
  dk,
  fk
function pk(e, t, n) {
  return (
    uk.set(0, 0, -t, 1).applyMatrix4(e.projectionMatrix),
    uk.multiplyScalar(1 / uk.w),
    (uk.x = fk / n.width),
    (uk.y = fk / n.height),
    uk.applyMatrix4(e.projectionMatrixInverse),
    uk.multiplyScalar(1 / uk.w),
    Math.abs(Math.max(uk.x, uk.y))
  )
}
function mk(e, t) {
  let n = e.matrixWorld,
    r = e.geometry,
    i = r.attributes.instanceStart,
    a = r.attributes.instanceEnd,
    o = Math.min(r.instanceCount, i.count)
  for (let r = 0, s = o; r < s; r++) {
    ;(ok.start.fromBufferAttribute(i, r), ok.end.fromBufferAttribute(a, r), ok.applyMatrix4(n))
    let o = new B(),
      s = new B()
    ;(dk.distanceSqToSegment(ok.start, ok.end, s, o),
      s.distanceTo(o) < fk * 0.5 &&
        t.push({
          point: s,
          pointOnLine: o,
          distance: dk.origin.distanceTo(s),
          object: e,
          face: null,
          faceIndex: r,
          uv: null,
          uv1: null,
        }))
  }
}
function hk(e, t, n) {
  let r = t.projectionMatrix,
    i = e.material.resolution,
    a = e.matrixWorld,
    o = e.geometry,
    s = o.attributes.instanceStart,
    c = o.attributes.instanceEnd,
    l = Math.min(o.instanceCount, s.count),
    u = -t.near
  ;(dk.at(1, rk),
    (rk.w = 1),
    rk.applyMatrix4(t.matrixWorldInverse),
    rk.applyMatrix4(r),
    rk.multiplyScalar(1 / rk.w),
    (rk.x *= i.x / 2),
    (rk.y *= i.y / 2),
    (rk.z = 0),
    ik.copy(rk),
    ak.multiplyMatrices(t.matrixWorldInverse, a))
  for (let t = 0, o = l; t < o; t++) {
    if (
      (tk.fromBufferAttribute(s, t),
      nk.fromBufferAttribute(c, t),
      (tk.w = 1),
      (nk.w = 1),
      tk.applyMatrix4(ak),
      nk.applyMatrix4(ak),
      tk.z > u && nk.z > u)
    )
      continue
    if (tk.z > u) {
      let e = tk.z - nk.z,
        t = (tk.z - u) / e
      tk.lerp(nk, t)
    } else if (nk.z > u) {
      let e = nk.z - tk.z,
        t = (nk.z - u) / e
      nk.lerp(tk, t)
    }
    ;(tk.applyMatrix4(r),
      nk.applyMatrix4(r),
      tk.multiplyScalar(1 / tk.w),
      nk.multiplyScalar(1 / nk.w),
      (tk.x *= i.x / 2),
      (tk.y *= i.y / 2),
      (nk.x *= i.x / 2),
      (nk.y *= i.y / 2),
      ok.start.copy(tk),
      (ok.start.z = 0),
      ok.end.copy(nk),
      (ok.end.z = 0))
    let o = ok.closestPointToPointParameter(ik, !0)
    ok.at(o, sk)
    let l = Vt.lerp(tk.z, nk.z, o),
      d = l >= -1 && l <= 1,
      f = ik.distanceTo(sk) < fk * 0.5
    if (d && f) {
      ;(ok.start.fromBufferAttribute(s, t),
        ok.end.fromBufferAttribute(c, t),
        ok.start.applyMatrix4(a),
        ok.end.applyMatrix4(a))
      let r = new B(),
        i = new B()
      ;(dk.distanceSqToSegment(ok.start, ok.end, i, r),
        n.push({
          point: i,
          pointOnLine: r,
          distance: dk.origin.distanceTo(i),
          object: e,
          face: null,
          faceIndex: t,
          uv: null,
          uv1: null,
        }))
    }
  }
}
