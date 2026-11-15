// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 28680–28796 行（切片 7/40）
// 角色：Hg 类 + DOM/回调小工具与惰性单例（Gg/Kg、qg/Jg、Yg/Xg、Zg/Qg/$g/e_/t_、TextEncoder n_）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var Hg = class {
  __destroy_into_raw() {
    let e = this.__wbg_ptr
    return ((this.__wbg_ptr = 0), Ug.unregister(this), e)
  }
  free() {
    let e = this.__destroy_into_raw()
    i_.__wbg_demoinput_free(e, 0)
  }
  length() {
    return i_.demoinput_length(this.__wbg_ptr) >>> 0
  }
  constructor(e) {
    let t = i_.demoinput_new(e)
    if (t[2]) throw t_(t[1])
    return ((this.__wbg_ptr = t[0]), Ug.register(this, this.__wbg_ptr, this), this)
  }
  parseEvents(e, t, n) {
    var r = Zg(e) ? 0 : e_(e, i_.__wbindgen_malloc),
      i = r_,
      a = Zg(t) ? 0 : e_(t, i_.__wbindgen_malloc),
      o = r_,
      s = Zg(n) ? 0 : e_(n, i_.__wbindgen_malloc),
      c = r_
    let l = i_.demoinput_parseEvents(this.__wbg_ptr, r, i, a, o, s, c)
    if (l[2]) throw t_(l[1])
    return t_(l[0])
  }
  parseHeader() {
    let e = i_.demoinput_parseHeader(this.__wbg_ptr)
    if (e[2]) throw t_(e[1])
    return t_(e[0])
  }
  parseRoundStream(e, t, n, r, i, a, o, s, c) {
    var l = Zg(e) ? 0 : e_(e, i_.__wbindgen_malloc),
      u = r_,
      d = Zg(t) ? 0 : Qg(t, i_.__wbindgen_malloc),
      f = r_,
      p = Zg(n) ? 0 : e_(n, i_.__wbindgen_malloc),
      m = r_,
      h = Zg(r) ? 0 : e_(r, i_.__wbindgen_malloc),
      g = r_,
      _ = Zg(i) ? 0 : e_(i, i_.__wbindgen_malloc),
      v = r_,
      y = Zg(a) ? 0 : Qg(a, i_.__wbindgen_malloc),
      b = r_
    let x = Qg(o, i_.__wbindgen_malloc),
      S = r_,
      C = i_.demoinput_parseRoundStream(this.__wbg_ptr, l, u, d, f, p, m, h, g, _, v, y, b, x, S, s, c)
    if (C[1]) throw t_(C[0])
  }
  write(e, t) {
    let n = $g(e, i_.__wbindgen_malloc),
      r = r_,
      i = i_.demoinput_write(this.__wbg_ptr, n, r, t)
    if (i[1]) throw t_(i[0])
  }
}
Symbol.dispose && (Hg.prototype[Symbol.dispose] = Hg.prototype.free)
var Ug =
  typeof FinalizationRegistry > `u`
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((e) => i_.__wbg_demoinput_free(e, 1))
function Wg(e) {
  let t = i_.__externref_table_alloc()
  return (i_.__wbindgen_externrefs.set(t, e), t)
}
var Gg = null
function Kg() {
  return (
    (Gg === null || Gg.buffer.detached === !0 || (Gg.buffer.detached === void 0 && Gg.buffer !== i_.memory.buffer)) &&
      (Gg = new DataView(i_.memory.buffer)),
    Gg
  )
}
var qg = null
function Jg() {
  return ((qg === null || qg.byteLength === 0) && (qg = new Uint32Array(i_.memory.buffer)), qg)
}
var Yg = null
function Xg() {
  return ((Yg === null || Yg.byteLength === 0) && (Yg = new Uint8Array(i_.memory.buffer)), Yg)
}
function Zg(e) {
  return e == null
}
function Qg(e, t) {
  let n = t(e.length * 4, 4) >>> 0
  return (Jg().set(e, n / 4), (r_ = e.length), n)
}
function $g(e, t) {
  let n = t(e.length * 1, 1) >>> 0
  return (Xg().set(e, n / 1), (r_ = e.length), n)
}
function e_(e, t) {
  let n = t(e.length * 4, 4) >>> 0
  for (let t = 0; t < e.length; t++) {
    let r = Wg(e[t])
    Kg().setUint32(n + 4 * t, r, !0)
  }
  return ((r_ = e.length), n)
}
function t_(e) {
  let t = i_.__wbindgen_externrefs.get(e)
  return (i_.__externref_table_dealloc(e), t)
}
new TextDecoder(`utf-8`, { ignoreBOM: !0, fatal: !0 }).decode()
var n_ = new TextEncoder()
;`encodeInto` in n_ ||
  (n_.encodeInto = function (e, t) {
    let n = n_.encode(e)
    return (t.set(n), { read: e.length, written: n.length })
  })
var r_ = 0,
  i_,
  a_ = new Set([`active_weapon_name`, `inventory`, `crosshair_code`, `team_clan_name`, `player_color`])
;[...Ig, ...Lg.filter((e) => !a_.has(e))]
