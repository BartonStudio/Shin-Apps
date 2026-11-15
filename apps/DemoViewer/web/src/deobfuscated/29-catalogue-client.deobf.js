// ============================================================================
// 29-catalogue-client.deobf.js —— 职业比赛目录客户端（v2）
// 来源：src/app/29-catalogue-client.js（Vite 生产构建，prettier 展开版）
// 原文范围：decompiled/index.beautified.js L48977–49253（切片 29-catalogue-client）
// 原始标识符已语义化重命名 + 补充中文注释。
//
// 作用：从 https://data.csdemo.tv/catalogue/v2/current.json 拉取"精选比赛目录"。
//   目录采用两级结构：
//   1. 指针文件（pointer）：含 generationId + catalogueUrl（指向真正的目录 JSON）
//   2. 目录文件（catalogue）：含 events / teams / matches 三个列表
//   每个字段都经过严格的运行时校验（类型/格式/URL 同源/去重），任何非法输入
//   都会抛出 HostedCatalogueError，避免把不可信数据直接注入页面。
// ============================================================================

const CATALOGUE_POINTER_URL = `https://data.csdemo.tv/catalogue/v2/current.json`

// 目录校验错误
class HostedCatalogueError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = `HostedCatalogueError`
  }
}

// 解析指针 URL（可覆盖），强制 HTTPS 且无凭证
function resolvePointerUrl(url = undefined) {
  return requireHttpsUrl(url === undefined ? CATALOGUE_POINTER_URL : url, `Hosted demo catalogue URL`)
}

// 主入口：拉取指针 → 拉取目录 → 校验并组装
async function fetchCatalogue(signal, pointerUrl = resolvePointerUrl()) {
  let pointer = parsePointer(
    await fetchJsonOrThrow(pointerUrl, signal, `Featured matches are unavailable right now.`, `The featured-match pointer is not valid JSON.`),
    pointerUrl,
  )
  let catalogueUrl = new URL(pointer.catalogueUrl)
  return parseCatalogue(
    await fetchJsonOrThrow(catalogueUrl, signal, `Featured matches are unavailable right now.`, `The featured-match catalogue is not valid JSON.`),
    catalogueUrl,
    pointer.identityScheme,
  )
}

// 校验指针文件（v2）
function parsePointer(raw, baseUrl) {
  let obj = requireObject(raw, `Catalogue pointer`)
  if (obj.version !== 2) throw new HostedCatalogueError(`Unsupported featured-match pointer version: ${String(obj.version)}.`)
  if (obj.identityScheme !== undefined && obj.identityScheme !== `neutral-v1`)
    throw new HostedCatalogueError(`Unsupported featured-match identity scheme: ${String(obj.identityScheme)}.`)
  return {
    version: 2,
    generationId: requireNonEmptyString(obj.generationId, `Catalogue pointer generationId`),
    publishedAt: requireDate(obj.publishedAt, `Catalogue pointer publishedAt`),
    catalogueUrl: requireSameOriginUrl(
      requireNonEmptyString(obj.catalogueUrl, `Catalogue pointer catalogueUrl`),
      `Catalogue pointer catalogueUrl`,
      baseUrl,
      baseUrl.origin,
    ).href,
    ...(obj.identityScheme === `neutral-v1` ? { identityScheme: `neutral-v1` } : {}),
  }
}

// 校验目录文件（v2）：events / teams / matches
function parseCatalogue(raw, baseUrl, identityScheme) {
  let obj = requireObject(raw, `Catalogue`)
  if (obj.version !== 2) throw new HostedCatalogueError(`Unsupported featured-match catalogue version: ${String(obj.version)}.`)
  let events = requireArray(obj.events, `Catalogue events`).map((e, i) => parseEvent(e, i, baseUrl, identityScheme))
  let teams = requireArray(obj.teams, `Catalogue teams`).map((e, i) => parseTeam(e, i, baseUrl, identityScheme))
  let eventIds = requireUniqueIds(events, `event`)
  let teamIds = requireUniqueIds(teams, `team`)
  let matches = requireArray(obj.matches, `Catalogue matches`).map((e, i) => parseMatch(e, i, baseUrl, eventIds, teamIds, identityScheme))
  requireUniqueIds(matches, `match`)
  return { version: 2, generatedAt: requireDate(obj.generatedAt, `Catalogue generatedAt`), events, teams, matches }
}

function parseEvent(raw, idx, baseUrl, identityScheme) {
  let label = `Event ${idx + 1}`
  let obj = requireObject(raw, label)
  if (identityScheme === `neutral-v1`) requireNoPrivateSource(obj, label)
  let startsAt = requireDate(obj.startsAt, `${label} startsAt`)
  let endsAt = requireDate(obj.endsAt, `${label} endsAt`)
  if (Date.parse(endsAt) < Date.parse(startsAt)) throw new HostedCatalogueError(`${label} endsAt must be on or after startsAt.`)
  return {
    id: requireNonEmptyString(obj.id, `${label} id`),
    name: requireNonEmptyString(obj.name, `${label} name`),
    status: requireStatus(obj.status, `${label} status`),
    startsAt,
    endsAt,
    logoUrl: requireSameOriginUrlIfPresent(obj.logoUrl, `${label} logoUrl`, baseUrl),
    logoSourceUrl: requireHttpsUrlIfPresent(obj.logoSourceUrl, `${label} logoSourceUrl`, baseUrl),
    ...(identityScheme === `neutral-v1` ? {} : { source: parseSource(obj.source, `${label} source`, baseUrl) }),
  }
}

function parseTeam(raw, idx, baseUrl, identityScheme) {
  let label = `Team ${idx + 1}`
  let obj = requireObject(raw, label)
  if (identityScheme === `neutral-v1`) requireNoPrivateSource(obj, label)
  return {
    id: requireNonEmptyString(obj.id, `${label} id`),
    name: requireNonEmptyString(obj.name, `${label} name`),
    logoUrl: requireSameOriginUrlIfPresent(obj.logoUrl, `${label} logoUrl`, baseUrl),
    logoSourceUrl: requireHttpsUrlIfPresent(obj.logoSourceUrl, `${label} logoSourceUrl`, baseUrl),
    ...(identityScheme === `neutral-v1` ? {} : { source: parseSource(obj.source, `${label} source`, baseUrl) }),
  }
}

function parseMatch(raw, idx, baseUrl, eventIds, teamIds, identityScheme) {
  let label = `Match ${idx + 1}`
  let obj = requireObject(raw, label)
  if (identityScheme === `neutral-v1`) requireNoPrivateSource(obj, label)
  let eventId = requireNonEmptyString(obj.eventId, `${label} eventId`)
  if (!eventIds.has(eventId)) throw new HostedCatalogueError(`${label} eventId "${eventId}" does not exist in the catalogue events list.`)
  let team1Id = requireNonEmptyString(obj.team1Id, `${label} team1Id`)
  let team2Id = requireNonEmptyString(obj.team2Id, `${label} team2Id`)
  if (!teamIds.has(team1Id)) throw new HostedCatalogueError(`${label} team1Id "${team1Id}" does not exist in the catalogue teams list.`)
  if (!teamIds.has(team2Id)) throw new HostedCatalogueError(`${label} team2Id "${team2Id}" does not exist in the catalogue teams list.`)
  if (team1Id === team2Id) throw new HostedCatalogueError(`${label} team1Id and team2Id must be different.`)
  let maps = requireArray(obj.maps, `${label} maps`).map((m, i) => parseMap(m, i, label, baseUrl, [team1Id, team2Id]))
  requireUniqueIds(maps, `${label.toLowerCase()} map`)
  requireUnique(maps.map((m) => m.order), `${label} map order`)
  return {
    id: requireNonEmptyString(obj.id, `${label} id`),
    eventId,
    team1Id,
    team2Id,
    playedAt: requireDate(obj.playedAt, `${label} playedAt`),
    format: requireNonEmptyString(obj.format, `${label} format`),
    stage: requireOptionalNonEmptyString(obj.stage, `${label} stage`),
    score: parseScore(obj.score, `${label} score`),
    maps,
    ...(identityScheme === `neutral-v1` ? {} : { source: parseSource(obj.source, `${label} source`, baseUrl) }),
  }
}

function parseMap(raw, idx, matchLabel, baseUrl, teamIds) {
  let label = `${matchLabel} map ${idx + 1}`
  let obj = requireObject(raw, label)
  let segments = requireArray(obj.segments, `${label} segments`).map((s, i) => parseSegment(s, i, label, baseUrl))
  requireUniqueIds(segments, `${label.toLowerCase()} segment`)
  return {
    id: requireNonEmptyString(obj.id, `${label} id`),
    order: requireNonNegativeInt(obj.order, `${label} order`, 0),
    name: requireNonEmptyString(obj.name, `${label} name`),
    score: parseOptionalScore(obj.score, `${label} score`),
    summary: parseSummary(obj.summary, label, baseUrl),
    summaryUnavailableReason: requireOptionalNonEmptyString(obj.summaryUnavailableReason, `${label} summaryUnavailableReason`),
    pick: parsePick(obj.pick, label, teamIds),
    segments,
  }
}

function parseSummary(raw, label, baseUrl) {
  if (raw === undefined) return undefined
  let obj = requireObject(raw, `${label} summary`)
  if (obj.version !== 1) throw new HostedCatalogueError(`${label} has an unsupported summary version.`)
  let bytes = requireNonNegativeInt(obj.bytes, `${label} summary bytes`, 1)
  if (bytes > 256 * 1024) throw new HostedCatalogueError(`${label} summary exceeds the 256 KiB preview limit.`)
  return {
    version: 1,
    url: requireSameOriginUrl(requireNonEmptyString(obj.url, `${label} summary URL`), `${label} summary URL`, baseUrl, baseUrl.origin).href,
    sha256: requireSha256(obj.sha256, `${label} summary checksum`),
    bytes,
  }
}

function parsePick(raw, label, teamIds) {
  if (raw === undefined) return undefined
  let obj = requireObject(raw, `${label} pick`)
  if (obj.type === `decider`) return { type: `decider` }
  if (obj.type !== `pick`) throw new HostedCatalogueError(`${label} pick type is invalid.`)
  let teamId = requireNonEmptyString(obj.teamId, `${label} picking team`)
  if (!teamIds.includes(teamId)) throw new HostedCatalogueError(`${label} picking team does not belong to the match.`)
  return { type: `pick`, teamId }
}

function parseSegment(raw, idx, mapLabel, baseUrl) {
  let label = `${mapLabel} segment ${idx + 1}`
  let obj = requireObject(raw, label)
  return {
    id: requireNonEmptyString(obj.id, `${label} id`),
    label: requireNonEmptyString(obj.label, `${label} label`),
    artifactUrl: requireSameOriginUrl(requireNonEmptyString(obj.artifactUrl, `${label} artifactUrl`), `${label} artifactUrl`, baseUrl, baseUrl.origin).href,
    artifactSha256: requireSha256(obj.artifactSha256, `${label} artifactSha256`),
    artifactBytes: requireNonNegativeInt(obj.artifactBytes, `${label} artifactBytes`, 1),
    formatVersion: requireNonNegativeInt(obj.formatVersion, `${label} formatVersion`, 1),
    parserRevision: requireOptionalNonEmptyString(obj.parserRevision, `${label} parserRevision`),
  }
}

// 中立身份模式：禁止暴露私有来源引用
function requireNoPrivateSource(obj, label) {
  if (obj.source !== undefined || obj.logoSourceUrl !== undefined)
    throw new HostedCatalogueError(`${label} neutral metadata must not expose private source references.`)
}

function parseSource(raw, label, baseUrl) {
  let obj = requireObject(raw, label)
  if (obj.provider !== `hltv`) throw new HostedCatalogueError(`${label} provider must be "hltv".`)
  return {
    provider: `hltv`,
    externalId: requireNonEmptyString(obj.externalId, `${label} externalId`),
    url: requireHttpsUrl(requireNonEmptyString(obj.url, `${label} url`), `${label} url`, baseUrl).href,
  }
}

function parseScore(raw, label) {
  let obj = requireObject(raw, label)
  return { team1: requireNonNegativeInt(obj.team1, `${label} team1`, 0), team2: requireNonNegativeInt(obj.team2, `${label} team2`, 0) }
}
function parseOptionalScore(raw, label) {
  if (raw !== undefined) return parseScore(raw, label)
}

// 拉取 JSON（带 AbortSignal，区分 abort / HTTP 错误 / 解析错误）
async function fetchJsonOrThrow(url, signal, httpErrorMsg, parseErrorMsg) {
  signal?.throwIfAborted()
  let resp
  try {
    resp = await fetch(url, { signal })
  } catch (e) {
    throw isAbortError(e) ? e : new HostedCatalogueError(httpErrorMsg, { cause: e })
  }
  if (!resp.ok) throw new HostedCatalogueError(`${httpErrorMsg.replace(/\.$/, ``)} (${resp.status} ${resp.statusText || `HTTP error`}).`)
  try {
    return await resp.json()
  } catch (e) {
    throw new HostedCatalogueError(parseErrorMsg, { cause: e })
  }
}

// 校验 id 唯一性，返回 id 集合
function requireUniqueIds(list, kind) {
  let seen = new Set()
  for (let item of list) {
    if (seen.has(item.id)) throw new HostedCatalogueError(`The featured-match catalogue contains duplicate ${kind} id "${item.id}".`)
    seen.add(item.id)
  }
  return seen
}
function requireUnique(values, label) {
  let seen = new Set()
  for (let v of values) {
    if (seen.has(v)) throw new HostedCatalogueError(`The featured-match catalogue contains duplicate ${label} "${v}".`)
    seen.add(v)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 底层校验原语
// ────────────────────────────────────────────────────────────────────────────
function requireArray(v, label) { if (!Array.isArray(v)) throw new HostedCatalogueError(`${label} must be an array.`); return v }
function requireObject(v, label) { if (!v || typeof v != `object` || Array.isArray(v)) throw new HostedCatalogueError(`${label} must be an object.`); return v }
function requireNonEmptyString(v, label) { if (typeof v != `string` || v.trim() === ``) throw new HostedCatalogueError(`${label} must be a non-empty string.`); return v.trim() }
function requireOptionalNonEmptyString(v, label) { if (v !== undefined) return requireNonEmptyString(v, label) }
function requireDate(v, label) { let s = requireNonEmptyString(v, label); if (!Number.isFinite(Date.parse(s))) throw new HostedCatalogueError(`${label} must be a valid date.`); return s }
function requireStatus(v, label) { if (v === `upcoming` || v === `ongoing` || v === `completed`) return v; throw new HostedCatalogueError(`${label} must be "upcoming", "ongoing", or "completed".`) }
function requireHttpsUrlIfPresent(v, label, base) { if (v !== undefined) return requireHttpsUrl(requireNonEmptyString(v, label), label, base).href }
function requireSameOriginUrlIfPresent(v, label, base) { if (v !== undefined) return requireSameOriginUrl(requireNonEmptyString(v, label), label, base, base.origin).href }

function requireHttpsUrl(v, label, base) {
  let url
  try { url = new URL(v, base) } catch (e) { throw new HostedCatalogueError(`${label} is invalid.`, { cause: e }) }
  if (url.protocol !== `https:` || url.username || url.password) throw new HostedCatalogueError(`${label} must be an HTTPS URL without credentials.`)
  return url
}
function requireSameOriginUrl(v, label, base, origin) {
  let url = requireHttpsUrl(v, label, base)
  if (url.origin !== origin) throw new HostedCatalogueError(`${label} must use ${origin}.`)
  return url
}
function requireSha256(v, label) {
  let s = requireNonEmptyString(v, label)
  if (!/^[a-f0-9]{64}$/i.test(s)) throw new HostedCatalogueError(`${label} must be a 64-character hexadecimal digest.`)
  return s.toLowerCase()
}
function requireNonNegativeInt(v, label, min) {
  if (!Number.isSafeInteger(v) || v < min) throw new HostedCatalogueError(`${label} must be an integer greater than or equal to ${min}.`)
  return v
}
function isAbortError(e) { return e instanceof DOMException && e.name === `AbortError` }
