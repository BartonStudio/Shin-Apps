// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 44734–45086 行（切片 26/34）
// 角色：队伍 logo oM：hosted-logo-fallback/emblem tone
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var oM = class {
    canvas
    ctx
    reticle
    reticleCtx
    rifleBlur
    rifleReticle
    blur = -1
    transitionBlur = -1
    lastTime = null
    viewKey = ``
    w = 0
    h = 0
    dpr = 0
    constructor(e) {
      ;((this.canvas = document.createElement(`canvas`)),
        (this.canvas.className = `scope-overlay scope-sniper`),
        this.canvas.setAttribute(`aria-hidden`, `true`),
        e.appendChild(this.canvas))
      let t = this.canvas.getContext(`2d`)
      if (!t) throw Error(`ScopeOverlay: 2D canvas context unavailable`)
      ;((this.ctx = t),
        (this.reticle = document.createElement(`canvas`)),
        (this.reticle.className = `scope-overlay scope-sniper scope-sniper-reticle`),
        this.reticle.setAttribute(`aria-hidden`, `true`),
        e.appendChild(this.reticle))
      let n = this.reticle.getContext(`2d`)
      if (!n) throw Error(`ScopeOverlay: reticle 2D canvas context unavailable`)
      ;((this.reticleCtx = n),
        (this.rifleBlur = document.createElement(`div`)),
        (this.rifleBlur.className = `scope-overlay scope-rifle-blur`),
        this.rifleBlur.setAttribute(`aria-hidden`, `true`),
        e.appendChild(this.rifleBlur),
        (this.rifleReticle = document.createElement(`div`)),
        (this.rifleReticle.className = `scope-overlay scope-rifle-reticle`),
        this.rifleReticle.setAttribute(`aria-hidden`, `true`),
        (this.rifleReticle.innerHTML = `<div class="scope-rifle-lens"></div><div class="scope-rifle-dot"></div>`),
        e.appendChild(this.rifleReticle))
    }
    show(e, t, n = 0, r = -1, i = 0, a) {
      let o = rM(t) === `rifle`
      if (
        (this.canvas.classList.toggle(`is-active`, !o),
        this.reticle.classList.toggle(`is-active`, !o),
        this.rifleBlur.classList.toggle(`is-active`, o),
        this.rifleReticle.classList.toggle(`is-active`, o),
        o)
      ) {
        this.resetReticleTransition()
        return
      }
      let s = window.innerWidth,
        c = window.innerHeight,
        l = Math.min(window.devicePixelRatio || 1, 2),
        u = s !== this.w || c !== this.h || l !== this.dpr
      u && ((this.w = s), (this.h = c), (this.dpr = l), this.drawMask(s, c))
      let d = aM(t, n, r, i, e, c),
        f = `${a?.slot ?? -1}:${t}:${e}`,
        p = this.lastTime === null || (a && (a.time < this.lastTime || a.time - this.lastTime > 0.5))
      ;(!a || u || this.transitionBlur < 0 || f !== this.viewKey || p
        ? (this.transitionBlur = d)
        : a.dt > 0 &&
          ((this.transitionBlur += (d - this.transitionBlur) * (1 - Math.exp(-a.dt / nM))),
          Math.abs(d - this.transitionBlur) < 1 / 256 && (this.transitionBlur = d)),
        (this.viewKey = f),
        (this.lastTime = a?.time ?? null))
      let m = Math.round(this.transitionBlur * 64) / 64
      ;(u || m !== this.blur) && ((this.blur = m), this.drawReticle(s, c, m))
    }
    hide() {
      ;(this.resetReticleTransition(),
        this.canvas.classList.remove(`is-active`),
        this.reticle.classList.remove(`is-active`),
        this.rifleBlur.classList.remove(`is-active`),
        this.rifleReticle.classList.remove(`is-active`))
    }
    resetReticleTransition() {
      ;((this.transitionBlur = -1), (this.lastTime = null), (this.viewKey = ``))
    }
    dispose() {
      ;(this.canvas.remove(), this.reticle.remove(), this.rifleBlur.remove(), this.rifleReticle.remove())
    }
    prepareCanvas(e, t, n, r) {
      let i = this.dpr,
        a = Math.floor(n * i),
        o = Math.floor(r * i)
      ;(e.width !== a && (e.width = a),
        e.height !== o && (e.height = o),
        (e.style.width = `${n}px`),
        (e.style.height = `${r}px`),
        t.setTransform(i, 0, 0, i, 0, 0),
        t.clearRect(0, 0, n, r))
    }
    drawMask(e, t) {
      let n = this.ctx
      this.prepareCanvas(this.canvas, n, e, t)
      let r = e / 2,
        i = t / 2,
        a = Math.min(e, t) * tM,
        o = Math.min(e, t) * 0.008,
        s = n.createRadialGradient(r, i, a - o, r, i, a + o)
      ;(s.addColorStop(0, `rgba(0,0,0,0)`),
        s.addColorStop(0.5, `rgba(0,0,0,0.45)`),
        s.addColorStop(1, `#000`),
        (n.fillStyle = s),
        n.fillRect(0, 0, e, t))
    }
    drawReticle(e, t, n) {
      let r = this.reticleCtx
      this.prepareCanvas(this.reticle, r, e, t)
      let i = e / 2,
        a = t / 2,
        o = 0.85
      ;((r.lineWidth = 2 + n),
        (r.filter = n > 0 ? `blur(${n * this.dpr}px)` : `none`),
        (r.strokeStyle = `rgba(0,0,0,${o})`),
        r.beginPath(),
        r.moveTo(0, a),
        r.lineTo(e, a),
        r.moveTo(i, 0),
        r.lineTo(i, t),
        r.stroke(),
        r.beginPath(),
        r.arc(i, a, 1.5, 0, Math.PI * 2),
        (r.fillStyle = `rgba(0,0,0,${o})`),
        r.fill(),
        (r.filter = `none`))
    }
  },
  sM = 128
function cM(e, t, n) {
  let r = 0,
    i = 0,
    a = (r, i) => (r < 0 || i < 0 || r >= t || i >= n ? 0 : e[(i * t + r) * 4 + 3])
  for (let o = 0; o < n; o++)
    for (let n = 0; n < t; n++) {
      let s = (o * t + n) * 4
      e[s + 3] < sM ||
        (a(n - 1, o) >= sM && a(n + 1, o) >= sM && a(n, o - 1) >= sM && a(n, o + 1) >= sM) ||
        (r++, dM(e[s], e[s + 1], e[s + 2]) <= 0.3 && i++)
    }
  return r > 0 && i / r >= 0.6
}
function lM(e, t, n, r, i) {
  let a = Math.ceil(r + 1),
    o = []
  for (let e = -a; e <= a; e++)
    for (let t = -a; t <= a; t++) {
      let n = Math.min(1, Math.max(0, r + 1 - Math.hypot(t, e)))
      n > 0 && o.push({ dx: t, dy: e, weight: n })
    }
  let s = new Float32Array(t * n)
  for (let t = 0; t < s.length; t++) s[t] = e[t * 4 + 3] / 255
  let [c, l, u, d] = i
  for (let r = 0; r < n; r++)
    for (let i = 0; i < t; i++) {
      let a = r * t + i,
        f = s[a]
      if (f >= 1) continue
      let p = 0
      for (let { dx: e, dy: a, weight: c } of o) {
        let o = i + e,
          l = r + a
        if (o < 0 || l < 0 || o >= t || l >= n) continue
        let u = s[l * t + o] * c
        if (u > p && ((p = u), p >= 1)) break
      }
      let m = p * d
      if (m <= 0) continue
      let h = f + m * (1 - f),
        g = a * 4,
        _ = m * (1 - f)
      ;((e[g] = (e[g] * f + c * _) / h),
        (e[g + 1] = (e[g + 1] * f + l * _) / h),
        (e[g + 2] = (e[g + 2] * f + u * _) / h),
        (e[g + 3] = h * 255))
    }
}
function uM(e, t, n) {
  let r = t,
    i = n,
    a = -1,
    o = -1
  for (let s = 0; s < n; s++)
    for (let n = 0; n < t; n++)
      e[(s * t + n) * 4 + 3] < 8 || (n < r && (r = n), n > a && (a = n), s < i && (i = s), s > o && (o = s))
  return a < 0 ? Math.min(t, n) : Math.min(r, i, t - 1 - a, n - 1 - o)
}
function dM(e, t, n) {
  return 0.2126 * fM(e) + 0.7152 * fM(t) + 0.0722 * fM(n)
}
function fM(e) {
  let t = e / 255
  return t <= 0.04045 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4
}
var pM = new Map(),
  mM = new Map(),
  hM = 1500
function gM(e, t, n, r = {}) {
  let i = document.createElement(`span`)
  i.className = `hosted-logo ${n}`
  let a = document.createElement(`span`)
  if (((a.className = `hosted-logo-fallback`), (a.textContent = r.fallbackText ?? EM(t)), i.appendChild(a), e)) {
    let n = document.createElement(`img`)
    ;((n.alt = `${t} logo`), (n.decoding = `async`), (n.hidden = !0), i.classList.add(`pending`))
    let a = setTimeout(() => i.classList.remove(`pending`), hM),
      o = !1,
      s = r.invertWhite ? mM.get(e) : void 0
    ;(s && ((o = !0), _M(n, e, s)), n.getAttribute(`src`) || (n.src = e))
    let c = (e) => {
      ;(clearTimeout(a),
        e && n.hidden && i.classList.add(`fade-in`),
        (n.hidden = !1),
        i.classList.remove(`pending`),
        i.classList.add(`loaded`))
    }
    ;(n.addEventListener(`load`, () => {
      ;(c(!0),
        r.invertWhite &&
          !o &&
          ((o = !0),
          vM(e)
            .then((t) => _M(n, e, t))
            .catch((e) => {
              console.warn(`[csplayer] emblem tone detection failed for ${t}:`, e)
            })))
    }),
      n.addEventListener(`error`, () => {
        ;(clearTimeout(a),
          i.classList.remove(`pending`),
          console.warn(`[csplayer] logo failed for ${t}:`, e),
          n.remove())
      }),
      i.appendChild(n),
      n.complete && n.naturalWidth > 0 && c(!1))
  }
  return i
}
function _M(e, t, { tone: n, lightSrc: r }) {
  n === `white`
    ? e.classList.add(`logo-white`)
    : n === `black`
      ? e.classList.add(`logo-black`)
      : n === `bright` &&
        r &&
        (e.classList.add(`logo-bright`), (e.dataset.darkSrc = t), (e.dataset.lightSrc = r), TM(), CM(e))
}
function vM(e) {
  let t = pM.get(e)
  if (t) return t
  let n = (async () => {
    let t = await fetch(e, { mode: `cors`, cache: `reload` })
    if (!t.ok) throw Error(`Logo inspection failed (HTTP ${t.status})`)
    let n = await createImageBitmap(await t.blob())
    try {
      let e = document.createElement(`canvas`)
      e.width = e.height = 64
      let t = e.getContext(`2d`, { willReadFrequently: !0 })
      if (!t) throw Error(`Canvas pixel inspection is unavailable`)
      t.drawImage(n, 0, 0, 64, 64)
      let r = OM(t.getImageData(0, 0, 64, 64).data)
      if (r !== `bright`) return { tone: r }
      let i = await SM(n)
      return i ? { tone: r, lightSrc: i } : { tone: `color` }
    } finally {
      n.close()
    }
  })()
    .then((t) => (mM.set(e, t), t))
    .catch((t) => {
      throw (pM.delete(e), t)
    })
  return (pM.set(e, n), n)
}
var yM = 192,
  bM = 0.028,
  xM = [29, 29, 31, 0.92]
async function SM(e) {
  let t = Math.min(1, yM / Math.max(e.width, e.height)),
    n = Math.max(1, Math.round(e.width * t)),
    r = Math.max(1, Math.round(e.height * t)),
    i = Math.max(1.5, Math.max(n, r) * bM),
    a = document.createElement(`canvas`)
  ;((a.width = n), (a.height = r))
  let o = a.getContext(`2d`, { willReadFrequently: !0 })
  if (!o) throw Error(`Canvas pixel inspection is unavailable`)
  o.drawImage(e, 0, 0, n, r)
  let s = o.getImageData(0, 0, n, r).data
  if (cM(s, n, r)) return
  let c = Math.max(0, Math.ceil(i + 1) - uM(s, n, r)),
    l = document.createElement(`canvas`)
  ;((l.width = n + c * 2), (l.height = r + c * 2))
  let u = l.getContext(`2d`, { willReadFrequently: !0 })
  if (!u) throw Error(`Canvas pixel inspection is unavailable`)
  u.drawImage(e, c, c, n, r)
  let d = u.getImageData(0, 0, l.width, l.height)
  ;(lM(d.data, l.width, l.height, i, xM), u.putImageData(d, 0, 0))
  let f = await new Promise((e) => l.toBlob(e, `image/png`))
  if (!f) throw Error(`Could not encode the outlined emblem`)
  return URL.createObjectURL(f)
}
function CM(e) {
  let t = document.documentElement.dataset.theme === `dark` ? e.dataset.darkSrc : e.dataset.lightSrc
  t && e.getAttribute(`src`) !== t && (e.src = t)
}
var wM
function TM() {
  wM ||
    ((wM = new MutationObserver(() => {
      for (let e of document.querySelectorAll(`img.logo-bright`)) CM(e)
    })),
    wM.observe(document.documentElement, { attributes: !0, attributeFilter: [`data-theme`] }))
}
function EM(e) {
  return (
    e
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((e) => e.charAt(0))
      .join(``)
      .toUpperCase() || `?`
  )
}
function DM(e) {
  let t = !1
  for (let n = 0; n < e.length; n += 4)
    if (!(e[n + 3] < 32) && ((t = !0), e[n] < 245 || e[n + 1] < 245 || e[n + 2] < 245)) return !1
  return t
}
function OM(e) {
  return DM(e) ? `white` : AM(e) ? `black` : kM(e) ? `bright` : `color`
}
function kM(e) {
  let t = 0,
    n = 0
  for (let r = 0; r < e.length; r += 4)
    e[r + 3] < 32 || (t++, 1.05 / (dM(e[r], e[r + 1], e[r + 2]) + 0.05) < 1.5 && n++)
  return t > 0 && n / t >= 0.5
}
function AM(e) {
  let t = 0,
    n = 0
  for (let r = 0; r < e.length; r += 4) {
    if (e[r + 3] < 32) continue
    let i = e[r],
      a = e[r + 1],
      o = e[r + 2]
    if (Math.max(i, a, o) - Math.min(i, a, o) > 24) return !1
    ;(t++, Math.max(i, a, o) < 80 && n++)
  }
  return t > 0 && n / t >= 0.6
}
