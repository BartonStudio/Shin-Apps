// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 48977–49253 行（切片 30/34）
// 角色：data.csdemo.tv 职业比赛目录客户端（v2 指针 + generation + 校验 + jP 错误）
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var AP = `https://data.csdemo.tv/catalogue/v2/current.json`,
  jP = class extends Error {
    constructor(e, t) {
      ;(super(e, t), (this.name = `HostedCatalogueError`))
    }
  }
function MP(e = void 0) {
  return iF(e === void 0 ? AP : e, `Hosted demo catalogue URL`)
}
async function NP(e, t = MP()) {
  let n = PP(
      await qP(t, e, `Featured matches are unavailable right now.`, `The featured-match pointer is not valid JSON.`),
      t,
    ),
    r = new URL(n.catalogueUrl)
  return FP(
    await qP(r, e, `Featured matches are unavailable right now.`, `The featured-match catalogue is not valid JSON.`),
    r,
    n.identityScheme,
  )
}
function PP(e, t) {
  let n = ZP(e, `Catalogue pointer`)
  if (n.version !== 2) throw new jP(`Unsupported featured-match pointer version: ${String(n.version)}.`)
  if (n.identityScheme !== void 0 && n.identityScheme !== `neutral-v1`)
    throw new jP(`Unsupported featured-match identity scheme: ${String(n.identityScheme)}.`)
  return {
    version: 2,
    generationId: QP(n.generationId, `Catalogue pointer generationId`),
    publishedAt: eF(n.publishedAt, `Catalogue pointer publishedAt`),
    catalogueUrl: aF(
      QP(n.catalogueUrl, `Catalogue pointer catalogueUrl`),
      `Catalogue pointer catalogueUrl`,
      t,
      t.origin,
    ).href,
    ...(n.identityScheme === `neutral-v1` ? { identityScheme: `neutral-v1` } : {}),
  }
}
function FP(e, t, n) {
  let r = ZP(e, `Catalogue`)
  if (r.version !== 2) throw new jP(`Unsupported featured-match catalogue version: ${String(r.version)}.`)
  let i = XP(r.events, `Catalogue events`).map((e, r) => IP(e, r, t, n)),
    a = XP(r.teams, `Catalogue teams`).map((e, r) => LP(e, r, t, n)),
    o = JP(i, `event`),
    s = JP(a, `team`),
    c = XP(r.matches, `Catalogue matches`).map((e, r) => RP(e, r, t, o, s, n))
  return (
    JP(c, `match`),
    { version: 2, generatedAt: eF(r.generatedAt, `Catalogue generatedAt`), events: i, teams: a, matches: c }
  )
}
function IP(e, t, n, r) {
  let i = `Event ${t + 1}`,
    a = ZP(e, i)
  r === `neutral-v1` && UP(a, i)
  let o = eF(a.startsAt, `${i} startsAt`),
    s = eF(a.endsAt, `${i} endsAt`)
  if (Date.parse(s) < Date.parse(o)) throw new jP(`${i} endsAt must be on or after startsAt.`)
  return {
    id: QP(a.id, `${i} id`),
    name: QP(a.name, `${i} name`),
    status: tF(a.status, `${i} status`),
    startsAt: o,
    endsAt: s,
    logoUrl: rF(a.logoUrl, `${i} logoUrl`, n),
    logoSourceUrl: nF(a.logoSourceUrl, `${i} logoSourceUrl`, n),
    ...(r === `neutral-v1` ? {} : { source: WP(a.source, `${i} source`, n) }),
  }
}
function LP(e, t, n, r) {
  let i = `Team ${t + 1}`,
    a = ZP(e, i)
  return (
    r === `neutral-v1` && UP(a, i),
    {
      id: QP(a.id, `${i} id`),
      name: QP(a.name, `${i} name`),
      logoUrl: rF(a.logoUrl, `${i} logoUrl`, n),
      logoSourceUrl: nF(a.logoSourceUrl, `${i} logoSourceUrl`, n),
      ...(r === `neutral-v1` ? {} : { source: WP(a.source, `${i} source`, n) }),
    }
  )
}
function RP(e, t, n, r, i, a) {
  let o = `Match ${t + 1}`,
    s = ZP(e, o)
  a === `neutral-v1` && UP(s, o)
  let c = QP(s.eventId, `${o} eventId`)
  if (!r.has(c)) throw new jP(`${o} eventId "${c}" does not exist in the catalogue events list.`)
  let l = QP(s.team1Id, `${o} team1Id`),
    u = QP(s.team2Id, `${o} team2Id`)
  if (!i.has(l)) throw new jP(`${o} team1Id "${l}" does not exist in the catalogue teams list.`)
  if (!i.has(u)) throw new jP(`${o} team2Id "${u}" does not exist in the catalogue teams list.`)
  if (l === u) throw new jP(`${o} team1Id and team2Id must be different.`)
  let d = XP(s.maps, `${o} maps`).map((e, t) => zP(e, t, o, n, [l, u]))
  return (
    JP(d, `${o.toLowerCase()} map`),
    YP(
      d.map((e) => e.order),
      `${o} map order`,
    ),
    {
      id: QP(s.id, `${o} id`),
      eventId: c,
      team1Id: l,
      team2Id: u,
      playedAt: eF(s.playedAt, `${o} playedAt`),
      format: QP(s.format, `${o} format`),
      stage: $P(s.stage, `${o} stage`),
      score: GP(s.score, `${o} score`),
      maps: d,
      ...(a === `neutral-v1` ? {} : { source: WP(s.source, `${o} source`, n) }),
    }
  )
}
function zP(e, t, n, r, i) {
  let a = `${n} map ${t + 1}`,
    o = ZP(e, a),
    s = XP(o.segments, `${a} segments`).map((e, t) => HP(e, t, a, r))
  return (
    JP(s, `${a.toLowerCase()} segment`),
    {
      id: QP(o.id, `${a} id`),
      order: sF(o.order, `${a} order`, 0),
      name: QP(o.name, `${a} name`),
      score: KP(o.score, `${a} score`),
      summary: BP(o.summary, a, r),
      summaryUnavailableReason: $P(o.summaryUnavailableReason, `${a} summaryUnavailableReason`),
      pick: VP(o.pick, a, i),
      segments: s,
    }
  )
}
function BP(e, t, n) {
  if (e === void 0) return
  let r = ZP(e, `${t} summary`)
  if (r.version !== 1) throw new jP(`${t} has an unsupported summary version.`)
  let i = sF(r.bytes, `${t} summary bytes`, 1)
  if (i > 256 * 1024) throw new jP(`${t} summary exceeds the 256 KiB preview limit.`)
  return {
    version: 1,
    url: aF(QP(r.url, `${t} summary URL`), `${t} summary URL`, n, n.origin).href,
    sha256: oF(r.sha256, `${t} summary checksum`),
    bytes: i,
  }
}
function VP(e, t, n) {
  if (e === void 0) return
  let r = ZP(e, `${t} pick`)
  if (r.type === `decider`) return { type: `decider` }
  if (r.type !== `pick`) throw new jP(`${t} pick type is invalid.`)
  let i = QP(r.teamId, `${t} picking team`)
  if (!n.includes(i)) throw new jP(`${t} picking team does not belong to the match.`)
  return { type: `pick`, teamId: i }
}
function HP(e, t, n, r) {
  let i = `${n} segment ${t + 1}`,
    a = ZP(e, i)
  return {
    id: QP(a.id, `${i} id`),
    label: QP(a.label, `${i} label`),
    artifactUrl: aF(QP(a.artifactUrl, `${i} artifactUrl`), `${i} artifactUrl`, r, r.origin).href,
    artifactSha256: oF(a.artifactSha256, `${i} artifactSha256`),
    artifactBytes: sF(a.artifactBytes, `${i} artifactBytes`, 1),
    formatVersion: sF(a.formatVersion, `${i} formatVersion`, 1),
    parserRevision: $P(a.parserRevision, `${i} parserRevision`),
  }
}
function UP(e, t) {
  if (e.source !== void 0 || e.logoSourceUrl !== void 0)
    throw new jP(`${t} neutral metadata must not expose private source references.`)
}
function WP(e, t, n) {
  let r = ZP(e, t)
  if (r.provider !== `hltv`) throw new jP(`${t} provider must be "hltv".`)
  return {
    provider: `hltv`,
    externalId: QP(r.externalId, `${t} externalId`),
    url: iF(QP(r.url, `${t} url`), `${t} url`, n).href,
  }
}
function GP(e, t) {
  let n = ZP(e, t)
  return { team1: sF(n.team1, `${t} team1`, 0), team2: sF(n.team2, `${t} team2`, 0) }
}
function KP(e, t) {
  if (e !== void 0) return GP(e, t)
}
async function qP(e, t, n, r) {
  t?.throwIfAborted()
  let i
  try {
    i = await fetch(e, { signal: t })
  } catch (e) {
    throw cF(e) ? e : new jP(n, { cause: e })
  }
  if (!i.ok) throw new jP(`${n.replace(/\.$/, ``)} (${i.status} ${i.statusText || `HTTP error`}).`)
  try {
    return await i.json()
  } catch (e) {
    throw new jP(r, { cause: e })
  }
}
function JP(e, t) {
  let n = new Set()
  for (let r of e) {
    if (n.has(r.id)) throw new jP(`The featured-match catalogue contains duplicate ${t} id "${r.id}".`)
    n.add(r.id)
  }
  return n
}
function YP(e, t) {
  let n = new Set()
  for (let r of e) {
    if (n.has(r)) throw new jP(`The featured-match catalogue contains duplicate ${t} "${r}".`)
    n.add(r)
  }
}
function XP(e, t) {
  if (!Array.isArray(e)) throw new jP(`${t} must be an array.`)
  return e
}
function ZP(e, t) {
  if (!e || typeof e != `object` || Array.isArray(e)) throw new jP(`${t} must be an object.`)
  return e
}
function QP(e, t) {
  if (typeof e != `string` || e.trim() === ``) throw new jP(`${t} must be a non-empty string.`)
  return e.trim()
}
function $P(e, t) {
  if (e !== void 0) return QP(e, t)
}
function eF(e, t) {
  let n = QP(e, t)
  if (!Number.isFinite(Date.parse(n))) throw new jP(`${t} must be a valid date.`)
  return n
}
function tF(e, t) {
  if (e === `upcoming` || e === `ongoing` || e === `completed`) return e
  throw new jP(`${t} must be "upcoming", "ongoing", or "completed".`)
}
function nF(e, t, n) {
  if (e !== void 0) return iF(QP(e, t), t, n).href
}
function rF(e, t, n) {
  if (e !== void 0) return aF(QP(e, t), t, n, n.origin).href
}
function iF(e, t, n) {
  let r
  try {
    r = new URL(e, n)
  } catch (e) {
    throw new jP(`${t} is invalid.`, { cause: e })
  }
  if (r.protocol !== `https:` || r.username || r.password)
    throw new jP(`${t} must be an HTTPS URL without credentials.`)
  return r
}
function aF(e, t, n, r) {
  let i = iF(e, t, n)
  if (i.origin !== r) throw new jP(`${t} must use ${r}.`)
  return i
}
function oF(e, t) {
  let n = QP(e, t)
  if (!/^[a-f0-9]{64}$/i.test(n)) throw new jP(`${t} must be a 64-character hexadecimal digest.`)
  return n.toLowerCase()
}
function sF(e, t, n) {
  if (!Number.isSafeInteger(e) || e < n) throw new jP(`${t} must be an integer greater than or equal to ${n}.`)
  return e
}
function cF(e) {
  return e instanceof DOMException && e.name === `AbortError`
}
