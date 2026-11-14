// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 28861–29162 行（切片 2/34）
// 角色：回合/时间纯函数：炸弹下包拆包状态、计时文本、回合阶段（freeze/live/over/planted）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
    o = n
  for (let e of r) {
    if (e.tick > t) break
    ;((a = e.tRemaining), (o = e.ctRemaining))
  }
  let s = i.find((e) => t >= e.startTick && t < e.endTick)
  return {
    tUsed: Math.max(0, n - a),
    ctUsed: Math.max(0, n - o),
    side: s?.side,
    technical: s?.technical ?? !1,
    timeText: s ? g_((s.endTick - t) / e.meta.tickRate) : ``,
  }
}
function p_(e, t) {
  let n = ``
  for (let r of e.bomb.segments)
    if (r.kind === `planted` && t >= r.startTick && t < r.endTick) {
      n = r.site
      break
    }
  let r = Tg(e, t)
  return { site: n, defusing: r !== null, defuseHasKit: r?.hasKit ?? !1, defuseProgress: r?.progress ?? 0 }
}
function m_(e, t, n, r) {
  if (n < 0) return { phase: `freeze`, timeText: g_(c_), planted: !1 }
  let i = e.rounds[n],
    a = e.meta.tickRate,
    o = h_(r, i.startTick, i.endTick, t)
  if (o !== null) return { phase: `planted`, timeText: g_(l_ - (t - o) / a), planted: !0 }
  if (t < i.liveStartTick) return { phase: `freeze`, timeText: g_((i.liveStartTick - t) / a), planted: !1 }
  let s = c_ - (t - i.liveStartTick) / a
  return s <= 0 ? { phase: `over`, timeText: g_(0), planted: !1 } : { phase: `live`, timeText: g_(s), planted: !1 }
}
function h_(e, t, n, r) {
  let i = null
  for (let a of e)
    a.tick < t ||
      a.tick > n ||
      (a.type === `bomb_planted` && a.tick <= r
        ? (i = a.tick)
        : (a.type === `bomb_defused` || a.type === `bomb_exploded`) && i !== null && a.tick <= r && (i = null))
  return i
}
function g_(e) {
  let t = Math.max(0, Math.ceil(e))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, `0`)}`
}
var __ = `https://maps.csdemo.tv/`,
  v_,
  y_ = new Map(),
  b_ = new Map()
function x_(e) {
  let t = y_.get(e)
  if (t) return t
  let n = w_(e).catch((t) => {
    throw (y_.delete(e), t)
  })
  return (y_.set(e, n), n)
}
function S_(e) {
  let t = b_.get(e)
  if (t) return t
  let n = T_(e).catch((t) => {
    throw (b_.delete(e), t)
  })
  return (b_.set(e, n), n)
}
async function C_(e) {
  return (await E_()).get(e)?.logo
}
async function w_(e) {
  let t = (await E_()).get(e)
  if (t) return { collision: t.collision, lights: e === `de_mirage` ? `/maps/de_mirage_lights.json` : void 0 }
}
async function T_(e) {
  let t = (await E_()).get(e),
    n = t?.radars.get(`default`)
  if (!t || !n || !t.overview) return
  let r = await fetch(t.overview)
  if (!r.ok) throw Error(`map overview fetch failed: ${r.status} ${r.statusText} (${t.overview})`)
  let i = k_(await r.text(), t.overview),
    a = []
  for (let [e, n] of t.radars) {
    let t = i.sectionRanges.get(e)
    ;(e !== "default" && !t) ||
      a.push({ name: e, file: n, altitudeMin: t?.altitudeMin ?? -1 / 0, altitudeMax: t?.altitudeMax ?? 1 / 0 })
  }
  return { file: n, ...i.mapping, sections: a }
}
async function E_() {
  return (
    (v_ ||= D_().catch((e) => {
      throw ((v_ = void 0), e)
    })),
    v_
  )
}
async function D_() {
  let e = new URL(__, window.location.href),
    t = await O_(new URL(`index.json`, e).href)
  if (t.format !== `csdemo-map-host-v1` || typeof t.manifest != `string`)
    throw Error(`map host returned an unsupported root manifest`)
  let n = new URL(t.manifest, e).href,
    r = await O_(n)
  if (
    r.format !== `csdemo-map-release-v1` ||
    r.compression !== `EXT_meshopt_compression` ||
    r.coordinate_system !== `source2-hammer-z-up` ||
    !Array.isArray(r.maps)
  )
    throw Error(`map host returned an unsupported map release`)
  let i = new Map()
  for (let e of r.maps) {
    if (!M_(e) || typeof e.name != `string` || !M_(e.files)) continue
    let t = j_(e.files.colored) ?? j_(e.files.collision)
    if (!t) continue
    let r = j_(e.files.overview),
      a = j_(e.files.logo),
      o = new Map()
    if (Array.isArray(e.radars))
      for (let t of e.radars) {
        if (!M_(t) || typeof t.section != `string`) continue
        let e = j_(t)
        e && o.set(t.section, new URL(e, n).href)
      }
    i.set(e.name, {
      name: e.name,
      collision: new URL(t, n).href,
      overview: r ? new URL(r, n).href : void 0,
      logo: a ? new URL(a, n).href : void 0,
      radars: o,
    })
  }
  return i
}
async function O_(e) {
  let t = await fetch(e)
  if (!t.ok) throw Error(`map manifest fetch failed: ${t.status} ${t.statusText} (${e})`)
  let n = await t.json()
  if (!M_(n)) throw Error(`map manifest is not an object (${e})`)
  return n
}
function k_(e, t) {
  let n = new Map()
  for (let t of e.matchAll(/"([^"]+)"\s*"([^"]*)"/g)) n.set(t[1], t[2])
  let r = (e, r = !1) => {
      let i = n.get(e)
      if (i === void 0) {
        if (r) throw Error(`map overview is missing ${e} (${t})`)
        return
      }
      let a = Number(i)
      if (!Number.isFinite(a)) throw Error(`map overview has invalid ${e} (${t})`)
      return a
    },
    i = r(`pos_x`, !0),
    a = r(`pos_y`, !0),
    o = r(`scale`, !0)
  if (o <= 0) throw Error(`map overview has invalid scale (${t})`)
  let s = r(`zoom`) ?? 0
  if (s < 0) throw Error(`map overview has invalid zoom (${t})`)
  let c = r(`inset_left`) ?? 0,
    l = r(`inset_top`) ?? 0,
    u = r(`inset_right`) ?? 0,
    d = r(`inset_bottom`) ?? 0
  if ([c, l, u, d].some((e) => e < 0 || e >= 1) || c + u >= 1 || l + d >= 1)
    throw Error(`map overview has invalid radar insets (${t})`)
  return {
    mapping: {
      posX: i,
      posY: a,
      scale: o,
      zoom: s > 0 ? s : 1,
      insetLeft: c,
      insetTop: l,
      insetRight: u,
      insetBottom: d,
    },
    sectionRanges: A_(e, t),
  }
}
function A_(e, t) {
  let n = new Map(),
    r = e.search(/"verticalsections"\s*\{/)
  if (r < 0) return n
  let i = e.indexOf(`{`, r),
    a = e.slice(i + 1)
  for (let e of a.matchAll(/"([^"]+)"[^{]*\{([^}]*)\}/g)) {
    let r = new Map()
    for (let t of e[2].matchAll(/"([^"]+)"\s*"([^"]*)"/g)) r.set(t[1], t[2])
    let i = Number(r.get(`AltitudeMin`)),
      a = Number(r.get(`AltitudeMax`))
    if (!Number.isFinite(i) || !Number.isFinite(a) || i >= a)
      throw Error(`map overview has invalid vertical section ${e[1]} (${t})`)
    n.set(e[1], { altitudeMin: i, altitudeMax: a })
  }
  return n
}
function j_(e) {
  return M_(e) && typeof e.path == `string` ? e.path : void 0
}
function M_(e) {
  return typeof e == `object` && !!e
}
var N_ = {
  roofHeight: 0.34,
  detailSpan: 110,
  floorColor: 10721924,
  wallColor: 11575687,
  roofColor: 7695197,
  detailColor: 6120020,
  slopeColor: 9471344,
  edgeColor: 4799790,
  hazeColor: 13089181,
  skyHorizonColor: 11782374,
  skyZenithColor: 2320082,
  sunAzimuth: 141,
  sunElevation: 65,
}
function P_(e) {
  let t = {
    de_anubis: {
      floorColor: 12429187,
      wallColor: 13218707,
      roofColor: 13943461,
      detailColor: 7311256,
      slopeColor: 11836023,
      edgeColor: 7166791,
      hazeColor: 15194559,
      skyHorizonColor: 14477291,
      skyZenithColor: 8633819,
      sunAzimuth: 257,
      sunElevation: 60,
    },
    de_ancient: {
      roofHeight: 0.24,
      floorColor: 5661266,
      wallColor: 9015431,
      roofColor: 6911084,
      detailColor: 3162675,
      slopeColor: 5201232,
      edgeColor: 2569003,
      hazeColor: 13358803,
      skyHorizonColor: 14016478,
      skyZenithColor: 9545386,
      sunAzimuth: 224,
      sunElevation: 42,
    },
    de_cache: {
      roofHeight: 0.21,
      detailSpan: 220,
      floorColor: 7631988,
      wallColor: 10790559,
      roofColor: 5263440,
      detailColor: 7629153,
      slopeColor: 8225146,
      edgeColor: 4080447,
      hazeColor: 12963018,
      sunAzimuth: 297,
      sunElevation: 41,
    },
    de_dust2: { roofHeight: 0.42 },
    de_inferno: {
      roofHeight: 0.3,
      detailSpan: 110,
      floorColor: 10197392,
      wallColor: 13220255,
      roofColor: 13211503,
      detailColor: 7897963,
      slopeColor: 12099969,
      edgeColor: 6707017,
      hazeColor: 14278626,
      skyHorizonColor: 15199213,
      skyZenithColor: 10336472,
      sunAzimuth: 38,
      sunElevation: 63,
    },
    de_mirage: { roofHeight: 0.34 },
    de_nuke: {
      roofHeight: 0.44,
      detailSpan: 100,
      floorColor: 6450288,
      wallColor: 11451328,
      roofColor: 9345952,
      detailColor: 5469319,
      slopeColor: 10398381,
      edgeColor: 4083028,
      hazeColor: 12899283,
      skyHorizonColor: 13819357,
      skyZenithColor: 8825277,
      sunAzimuth: 210,
      sunElevation: 58,
    },
  }
  return { ...N_, ...t[e] }
}
var F_ = 24,
  I_ = new Map()
async function L_(e, t) {
  await B_(e, t)
}
