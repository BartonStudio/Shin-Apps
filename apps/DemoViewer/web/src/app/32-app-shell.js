// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 50817–52714 行（切片 39/40）
// 角色：AppShell：落地页/播放页骨架 + 最近场次 + 主题 + 设置 + 入口
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var YI = class extends Error {
  constructor(e, t) {
    ;(super(e, t), (this.name = `HostedDemoLoadError`))
  }
}
async function XI(e, t = {}) {
  let { signal: n, onProgress: r } = t
  n?.throwIfAborted()
  let i
  try {
    i = await fetch(e.artifactUrl, { signal: n })
  } catch (e) {
    throw nL(e) ? e : new YI(`The hosted demo could not be downloaded.`, { cause: e })
  }
  if (!i.ok) throw new YI(`The hosted demo is unavailable (${i.status} ${i.statusText || `HTTP error`}).`)
  let a = QI(i.headers.get(`Content-Length`)),
    o = await ZI(i, n, a, r)
  n?.throwIfAborted()
  let s = await JI(o)
  if ((n?.throwIfAborted(), s !== e.artifactSha256))
    throw new YI(`The hosted demo does not match its catalogue checksum.`)
  let c
  try {
    c = await qI(o)
  } catch (e) {
    throw e instanceof Z
      ? new YI(
          /DecompressionStream is unavailable/i.test(e.message)
            ? `This browser cannot decompress hosted demos. Update your browser and try again.`
            : /unsupported|version/i.test(e.message)
              ? `This hosted demo uses an unsupported artifact version.`
              : `This hosted demo is corrupt or failed its integrity checks.`,
          { cause: e },
        )
      : e
  }
  if ((n?.throwIfAborted(), !eL(c.manifest.identity.mapName, e.mapName) || !eL(c.data.meta.mapName, e.mapName)))
    throw new YI(`The hosted demo does not match its catalogue map.`)
  if (!$I(c.data)) throw new YI(`This hosted demo has no playable frames or recorded effects.`)
  return { data: c.data, manifest: c.manifest, byteLength: o.byteLength }
}
async function ZI(e, t, n, r) {
  if (!e.body) {
    let t = new Uint8Array(await e.arrayBuffer())
    return (r?.({ loadedBytes: t.byteLength, totalBytes: n }), t)
  }
  let i = e.body.getReader(),
    a = [],
    o = 0
  try {
    for (;;) {
      t?.throwIfAborted()
      let { done: e, value: s } = await i.read()
      if (e) break
      ;(a.push(s), (o += s.byteLength), r?.({ loadedBytes: o, totalBytes: n }))
    }
  } finally {
    i.releaseLock()
  }
  let s = new Uint8Array(o),
    c = 0
  for (let e of a) (s.set(e, c), (c += e.byteLength))
  return s
}
function QI(e) {
  if (e === null) return
  let t = Number(e)
  return Number.isSafeInteger(t) && t >= 0 ? t : void 0
}
function $I(e) {
  return e.meta.numFrames > 0 || e.smokeVoxels.count > 0 || !!e.grenades.infernos?.length
}
function eL(e, t) {
  return tL(e) === tL(t)
}
function tL(e) {
  return e
    .trim()
    .toLowerCase()
    .replace(/^(de|cs|ar|dz|gd|coop)_/i, ``)
    .replace(/[\s_-]+/g, ``)
}
function nL(e) {
  return e instanceof DOMException && e.name === `AbortError`
}
function rL(e, t) {
  let n = new Map()
  if (e.length === 0) return n
  let r = new Map()
  for (let e of t) {
    if (!e.clanName) continue
    let t = r.get(e.clanName) ?? []
    ;(t.push(e.name.trim().toLowerCase()), r.set(e.clanName, t))
  }
  for (let [t, i] of r) {
    let r = e.filter((e) => e.playerNames?.some((e) => i.includes(e.trim().toLowerCase()))),
      a = aL(t),
      o = r.length > 0 ? r : e.filter((e) => a !== `` && aL(e.name) === a)
    o.length === 1
      ? n.set(t, o[0])
      : console.warn(`[csplayer] no unambiguous hosted identity for recorded team "${t}"; keeping its name.`)
  }
  return n
}
function iL(e, t) {
  let n = /^bo([13579])$/i.exec(e.format)?.[1]
  if (!n) {
    console.warn(`[csplayer] unsupported series format "${e.format}"; map-win squares are unavailable.`)
    return
  }
  let r = e.maps.filter((e) => e.order < t.order)
  if (r.length !== t.order - 1) {
    console.warn(`[csplayer] previous map results are incomplete; map-win squares are unavailable.`)
    return
  }
  let i = [0, 0]
  for (let e of r) {
    let t = e.score
    if (!t || t.team1 === t.team2) {
      console.warn(`[csplayer] previous map results are incomplete; map-win squares are unavailable.`)
      return
    }
    i[t.team1 > t.team2 ? 0 : 1]++
  }
  return { mapsToWin: (Number(n) + 1) / 2, mapsWon: i }
}
function aL(e) {
  return e
    .normalize(`NFKC`)
    .toLowerCase()
    .replace(/\b(team|gaming|esports|e-sports)\b/g, ``)
    .replace(/[^\p{L}\p{N}]/gu, ``)
}
var oL = `csplayer`,
  sL = `demos`,
  cL = 1,
  lL = 47
function uL() {
  return new Promise((e, t) => {
    let n = indexedDB.open(oL, cL)
    ;((n.onupgradeneeded = () => {
      let e = n.result
      e.objectStoreNames.contains(sL) || e.createObjectStore(sL)
    }),
      (n.onsuccess = () => e(n.result)),
      (n.onerror = () => t(n.error)))
  })
}
async function dL(e, t) {
  try {
    if (!(`crypto` in globalThis) || !crypto.subtle) return null
    let n = await crypto.subtle.digest(`SHA-256`, e)
    return `${[...new Uint8Array(n)].map((e) => e.toString(16).padStart(2, `0`)).join(``)}:sr${t}:v${lL}`
  } catch {
    return null
  }
}
async function fL(e) {
  if (!(!e || !e.endsWith(`:v${lL}`) || !(`indexedDB` in globalThis)))
    try {
      let t = await uL()
      try {
        return await new Promise((n, r) => {
          let i = t.transaction(sL, `readonly`).objectStore(sL).get(e)
          ;((i.onsuccess = () => n(i.result)), (i.onerror = () => r(i.error)))
        })
      } finally {
        t.close()
      }
    } catch {
      return
    }
}
async function pL(e, t) {
  if (!(!e || !(`indexedDB` in globalThis)))
    try {
      let n = await uL()
      try {
        await new Promise((r, i) => {
          let a = n.transaction(sL, `readwrite`)
          ;(a.objectStore(sL).put(t, e), (a.oncomplete = () => r()), (a.onerror = () => i(a.error)))
        })
      } finally {
        n.close()
      }
    } catch {}
}
async function mL(e) {
  if (`indexedDB` in globalThis)
    try {
      let t = await uL()
      try {
        await new Promise((n, r) => {
          let i = t.transaction(sL, `readwrite`)
          ;(i.objectStore(sL).delete(e), (i.oncomplete = () => n()), (i.onerror = () => r(i.error)))
        })
      } finally {
        t.close()
      }
    } catch {}
}
async function hL() {
  if (`indexedDB` in globalThis)
    try {
      let e = await uL()
      try {
        await new Promise((t, n) => {
          let r = e.transaction(sL, `readwrite`)
          ;(r.objectStore(sL).clear(), (r.oncomplete = () => t()), (r.onerror = () => n(r.error)))
        })
      } finally {
        e.close()
      }
    } catch {}
}
async function gL(e) {
  if (!(`indexedDB` in globalThis)) return
  let t = new Set(e)
  try {
    let e = await uL()
    try {
      await new Promise((n, r) => {
        let i = e.transaction(sL, `readwrite`),
          a = i.objectStore(sL).openCursor()
        ;((a.onsuccess = () => {
          let e = a.result
          if (!e) return
          let n = e.primaryKey
          ;((typeof n != `string` || !n.endsWith(`:v${lL}`) || !t.has(n)) && e.delete(), e.continue())
        }),
          (a.onerror = () => r(a.error)),
          (i.oncomplete = () => n()),
          (i.onerror = () => r(i.error)))
      })
    } finally {
      e.close()
    }
  } catch {}
}
async function _L(e, t = {}) {
  let { signal: n, onProgress: r, onManifest: i, onReady: a, onRound: o, ...s } = t,
    c = s.sampleRate ?? 32
  ;(n?.throwIfAborted(), r?.(`Reading file…`, -1))
  let l = await e.arrayBuffer()
  n?.throwIfAborted()
  let u = await dL(l, c)
  n?.throwIfAborted()
  let d = await fL(u)
  if ((n?.throwIfAborted(), d)) return (r?.(`Loaded from cache`, 1), { data: d, key: u, fromCache: !0 })
  let f = await yL(l, s, n, r, i, a, o)
  return (pL(u, f), { data: f, key: u, fromCache: !1 })
}
function vL(e) {
  return fL(e)
}
function yL(e, t, n, r, i, a, o) {
  return new Promise((s, c) => {
    let l = new Worker(new URL(`/assets/parser.worker-Cvx4vjXK.js`, `` + import.meta.url), { type: `module` }),
      u = () => {
        ;(l.terminate(), c(n?.reason instanceof Error ? n.reason : new DOMException(`Parsing cancelled`, `AbortError`)))
      }
    if (n?.aborted) {
      u()
      return
    }
    n?.addEventListener(`abort`, u, { once: !0 })
    let d = (e) => {
      ;(n?.removeEventListener(`abort`, u), l.terminate(), e())
    }
    ;((l.onmessage = (e) => {
      let t = e.data
      switch (t.type) {
        case `progress`:
          r?.(t.phase, t.value)
          break
        case `manifest`:
          i?.(t.manifest)
          break
        case `ready`:
          a?.(t.data, t.manifest, t.loadedRounds)
          break
        case `round`:
          o?.(t.data, t.loadedRounds)
          break
        case `done`:
          d(() => s(t.data))
          break
        case `error`:
          d(() => c(Error(t.message)))
          break
      }
    }),
      (l.onerror = (e) => {
        d(() => c(Error(e.message || `Parser worker crashed`)))
      }))
    let f = { type: `parse`, bytes: e, options: t }
    l.postMessage(f, [e])
  })
}
var bL = `csplayer:recents`,
  xL = 12
function SL(e) {
  if (!e || typeof e != `object`) return !1
  let t = e
  return typeof t.key == `string` && typeof t.name == `string` && typeof t.map == `string`
}
function CL() {
  try {
    let e = localStorage.getItem(bL)
    if (!e) return []
    let t = JSON.parse(e)
    return Array.isArray(t) ? t.filter(SL) : []
  } catch {
    return []
  }
}
function wL(e) {
  try {
    let t = CL().filter((t) => t.key !== e.key)
    ;(t.unshift(e), localStorage.setItem(bL, JSON.stringify(t.slice(0, xL))))
  } catch {}
}
function TL(e) {
  try {
    let t = CL().filter((t) => t.key !== e)
    localStorage.setItem(bL, JSON.stringify(t))
  } catch {}
}
function EL() {
  try {
    localStorage.removeItem(bL)
  } catch {}
}
var DL = `csdemoPhoneStep`,
  OL = { matches: void 0, match: `matches` }
function kL(e) {
  return typeof e == `string` && Object.hasOwn(OL, e)
}
function AL(e) {
  return e && typeof e == `object` ? e[DL] : void 0
}
function jL(e, t) {
  let n = `matches`,
    r = window.history,
    i = (t) => {
      ;((n = t), (e.screen.dataset.phoneStep = t), (e.back.hidden = OL[t] === void 0))
    }
  ;(r && kL(AL(r.state)) && r.replaceState(null, ``),
    window.addEventListener(`popstate`, (e) => {
      let t = AL(e.state)
      i(kL(t) ? t : `matches`)
    }),
    e.back.addEventListener(`click`, () => a.back()),
    i(n))
  let a = {
    get step() {
      return n
    },
    go(e) {
      e !== n && (i(e), t.matches && r && r.pushState({ [DL]: e }, ``))
    },
    back() {
      let e = OL[n]
      e && (t.matches && r && AL(r.state) === n ? r.back() : i(e))
    },
  }
  return a
}
function ML(e) {
  e.innerHTML = `
    <div id="viewport"></div>

    <div class="drop-screen" id="dropScreen">
      <div class="drop-content">
        <header class="landing-header">
          <div class="brand">
            <h1 class="brand-title">CS<span class="brand-accent">DEMO</span></h1>
          </div>
        </header>

        <button class="phone-wizard-back" id="phoneWizardBack" type="button" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>All matches</span>
        </button>

        <nav class="landing-mode-switch" aria-label="Choose a demo source">
          <button class="landing-mode active" id="proGamesTab" type="button" role="tab"
            aria-selected="true" aria-controls="proGamesPanel">
            <span class="landing-mode-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M8 4h8v4a4 4 0 0 1-8 0V4Zm0 2H5v1a4 4 0 0 0 4 4m7-5h3v1a4 4 0 0 1-4 4M12 12v4m-4 4h8m-6-4h4"
                  fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span>
              <strong>Pro matches</strong>
            </span>
          </button>
          <button class="landing-mode" id="ownDemosTab" type="button" role="tab"
            aria-selected="false" aria-controls="ownDemosPanel" tabindex="-1">
            <span class="landing-mode-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 15V3m0 0 4 4m-4-4-4 4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                  fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span>
              <strong>Your demos</strong>
              <small>Upload a .dem file</small>
            </span>
          </button>
        </nav>

        <main>
          <section class="landing-view" id="proGamesPanel" role="tabpanel" aria-labelledby="proGamesTab">
            <div class="hosted-panel" aria-labelledby="hostedTitle">
              <div class="panel-heading hosted-heading">
                <div>
                  <h2 id="hostedTitle">Watch professional matches</h2>
                </div>
              </div>
              <div class="hosted-demos" id="hostedDemos"></div>
            </div>
          </section>

          <section class="landing-view hidden" id="ownDemosPanel" role="tabpanel" aria-labelledby="ownDemosTab">
            <div class="landing-workspace">
              <section class="import-panel" aria-labelledby="importTitle">
                <div class="panel-heading">
                  <div>
                    <h2 id="importTitle">Upload your demo</h2>
                    <p>Locally processed</p>
                  </div>
                </div>

                <div class="drop-zone" id="dropZone" role="button" tabindex="0" aria-label="Choose or drop a .dem file">
                  <span class="drop-zone-icon-wrap">
                    <svg class="drop-zone-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 15V3m0 0 4 4m-4-4-4 4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                        fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <span class="drop-zone-copy">
                    <span class="drop-zone-main">Drop your <strong>.dem</strong> here</span>
                    <span class="drop-hint">or click to choose a file</span>
                  </span>
                  <span class="drop-browse">Browse files</span>
                </div>

                <div class="quality" id="quality"></div>
              </section>

              <section class="history-panel" aria-labelledby="historyTitle">
                <div class="panel-heading">
                  <div>
                    <h2 id="historyTitle">On this device</h2>
                  </div>
                </div>
                <div class="recents" id="recents"></div>
              </section>
            </div>
          </section>
        </main>

        <footer class="landing-disclaimer">
          CSDEMO is not affiliated with or endorsed by Valve Corporation.
        </footer>
      </div>

      <input type="file" id="fileInput" accept=".dem" class="hidden" />
    </div>

    <div class="loading hidden" id="loading">
      <div class="landing-backdrop" aria-hidden="true"></div>
      <section class="loading-card" id="loadingCard" aria-labelledby="loadingTitle">
        <div class="loading-hero" id="loadingHero" aria-hidden="true"></div>
        <h2 class="loading-title" id="loadingTitle">Opening demo</h2>
        <div class="loading-progress" id="loadingProgress">
          <div class="loading-bar indeterminate" id="loadingBar" role="progressbar" aria-labelledby="loadingLabel" aria-valuemin="0" aria-valuemax="100">
            <div class="loading-bar-fill" id="loadingBarFill"></div>
          </div>
          <div class="loading-status">
            <span class="loading-label" id="loadingLabel" aria-live="polite">Loading…</span>
            <span class="loading-timer" id="loadingTimer">0.0s</span>
          </div>
        </div>
        <p class="error-text hidden" id="errorText" role="alert"></p>
        <button class="loading-action hidden" id="loadingAction" type="button"></button>
      </section>
    </div>

    <div class="drop-overlay hidden" id="dropOverlay" aria-hidden="true">
      <div class="drop-overlay-inner">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15V3m0 0 4 4m-4-4-4 4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
            fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <p>Release to load demo</p>
      </div>
    </div>

    <div class="leave-confirm hidden" id="leaveConfirm" role="dialog" aria-modal="true" aria-labelledby="leaveConfirmTitle">
      <div class="leave-confirm-panel">
        <h2 id="leaveConfirmTitle">Leave demo?</h2>
        <p>This demo is still processing. If you leave now, it won’t be saved on this device.</p>
        <div class="leave-confirm-progress" id="leaveConfirmProgress" role="progressbar" aria-label="Demo processing progress" aria-valuemin="0" aria-valuemax="100">
          <div class="leave-confirm-progress-fill" id="leaveConfirmProgressFill"></div>
        </div>
        <div class="leave-confirm-actions">
          <button type="button" class="leave-confirm-stay" id="leaveConfirmStay">Keep watching</button>
          <button type="button" class="leave-confirm-leave" id="leaveConfirmLeave">Leave demo</button>
        </div>
      </div>
    </div>
  `
  let t = (t) => {
      let n = e.querySelector(`#${t}`)
      if (!n) throw Error(`AppShell: missing #${t}`)
      return n
    },
    n = t(`viewport`),
    r = t(`dropScreen`),
    i = (e) => {
      r.classList.contains(`hidden`) &&
        (e.target?.closest?.(`input, textarea, [contenteditable="true"]`) || e.preventDefault())
    },
    a = e.ownerDocument
  ;(a?.addEventListener(`copy`, i), a?.addEventListener(`cut`, i), n.addEventListener(`dragstart`, i))
  let o = t(`dropZone`),
    s = t(`fileInput`),
    c = t(`recents`),
    l = t(`hostedDemos`),
    u = t(`quality`),
    d = t(`dropOverlay`),
    f = t(`proGamesTab`),
    p = t(`ownDemosTab`),
    m = t(`proGamesPanel`),
    h = t(`ownDemosPanel`),
    g = t(`loading`),
    _ = t(`loadingLabel`),
    v = t(`loadingCard`),
    y = t(`loadingHero`),
    b = t(`loadingTitle`),
    x = t(`loadingProgress`),
    S = t(`loadingBar`),
    C = t(`loadingBarFill`),
    w = t(`loadingTimer`),
    T = t(`errorText`),
    E = t(`loadingAction`),
    D = t(`leaveConfirm`),
    O = t(`leaveConfirmProgress`),
    k = t(`leaveConfirmProgressFill`),
    A = t(`leaveConfirmStay`),
    ee = t(`leaveConfirmLeave`),
    te,
    j,
    M,
    ne,
    re = (e = !1) => {
      if (
        ((j = void 0),
        ne !== void 0 && (clearTimeout(ne), (ne = void 0)),
        e || window.matchMedia(`(prefers-reduced-motion: reduce)`).matches)
      ) {
        ;(D.classList.add(`hidden`), D.classList.remove(`leave-confirm-transitioning`))
        return
      }
      D.classList.contains(`hidden`) ||
        (D.classList.add(`leave-confirm-transitioning`),
        (ne = window.setTimeout(() => {
          ;(D.classList.add(`hidden`), D.classList.remove(`leave-confirm-transitioning`), (ne = void 0))
        }, 220)))
    }
  ;(E.addEventListener(`click`, () => te?.()),
    A.addEventListener(`click`, () => re()),
    ee.addEventListener(`click`, () => j?.()))
  let ie = window.matchMedia(UA),
    ae = (e) => {
      let t = ie.matches || e === `pro`
      ;(f.classList.toggle(`active`, t),
        f.setAttribute(`aria-selected`, String(t)),
        (f.tabIndex = t ? 0 : -1),
        p.classList.toggle(`active`, !t),
        p.setAttribute(`aria-selected`, String(!t)),
        (p.tabIndex = t ? -1 : 0),
        m.classList.toggle(`hidden`, !t),
        h.classList.toggle(`hidden`, t))
    }
  ;(f.addEventListener(`click`, () => ae(`pro`)), p.addEventListener(`click`, () => ae(`own`)))
  let oe = [f, p]
  for (let e of oe)
    e.addEventListener(`keydown`, (t) => {
      if (ie.matches || (t.key !== `ArrowLeft` && t.key !== `ArrowRight`)) return
      t.preventDefault()
      let n = e === p
      ;(ae(n ? `pro` : `own`), oe[+!n].focus())
    })
  let se = () => {
    ;((s.disabled = ie.matches),
      (p.disabled = ie.matches),
      m.setAttribute(`role`, ie.matches ? `region` : `tabpanel`),
      m.setAttribute(`aria-labelledby`, ie.matches ? `hostedTitle` : `proGamesTab`),
      ie.matches && (ae(`pro`), d.classList.add(`hidden`)))
  }
  ;(ie.addEventListener(`change`, se), se())
  let ce = jL({ screen: r, back: t(`phoneWizardBack`) }, window.matchMedia(WA)),
    le,
    ue = () => {
      le !== void 0 && (clearInterval(le), (le = void 0))
    },
    de = () => {
      ue()
      let e = performance.now()
      ;((w.textContent = IL(0)),
        w.classList.remove(`hidden`),
        (le = window.setInterval(() => {
          w.textContent = IL(performance.now() - e)
        }, 100)))
    },
    fe = () => {
      ;(M !== void 0 && (clearTimeout(M), (M = void 0)), g.classList.remove(`loading-exiting`))
    },
    pe = null,
    me = (e) => {
      if (
        ((pe = e === null ? null : Math.max(pe ?? 0, Math.min(1, Math.max(0, e)))),
        S.classList.toggle(`indeterminate`, pe === null),
        pe === null)
      ) {
        ;(S.removeAttribute(`aria-valuenow`), C.style.removeProperty(`width`))
        return
      }
      ;(S.setAttribute(`aria-valuenow`, String(Math.round(pe * 100))), (C.style.width = `${pe * 100}%`))
    },
    he = (e, t = `loading`) => {
      let n = e.teams,
        r = n?.length === 2 && n.every((e) => e.name) ? n : void 0
      if (
        ((b.textContent = e.title ?? ``),
        b.classList.toggle(`hidden`, !e.title),
        e.title
          ? (v.setAttribute(`aria-labelledby`, `loadingTitle`), v.removeAttribute(`aria-label`))
          : (v.removeAttribute(`aria-labelledby`),
            v.setAttribute(`aria-label`, r ? `${r[0].name} vs ${r[1].name}` : `Opening demo`)),
        (v.dataset.state = t),
        y.replaceChildren(),
        t === `error`)
      ) {
        y.append(PL(`error`))
        return
      }
      if (r) {
        let e = document.createElement(`span`)
        ;((e.className = `loading-versus`),
          y.append(
            gM(r[0].logoUrl, r[0].name, `hosted-team-logo loading-team-logo`, { invertWhite: !0 }),
            e,
            gM(r[1].logoUrl, r[1].name, `hosted-team-logo loading-team-logo`, { invertWhite: !0 }),
          ))
        return
      }
      y.append(PL(`demo`))
    }
  return {
    viewport: n,
    dropScreen: r,
    phoneWizard: ce,
    dropZone: o,
    fileInput: s,
    recentsSlot: c,
    hostedDemosSlot: l,
    qualitySlot: u,
    dropOverlay: d,
    showDropScreen() {
      r.classList.remove(`hidden`)
    },
    hideDropScreen() {
      r.classList.add(`hidden`)
    },
    showLoading(e, t, n) {
      ;(fe(),
        T.classList.add(`hidden`),
        he(n ?? { title: `Opening demo` }),
        x.classList.remove(`hidden`),
        (_.textContent = e),
        (pe = null),
        me(null),
        (te = t),
        (E.textContent = `Cancel`),
        E.classList.remove(`loading-action-primary`),
        E.classList.toggle(`hidden`, !t),
        de())
      let r = g.classList.contains(`hidden`)
      ;(g.classList.remove(`hidden`),
        r && (v.classList.remove(`loading-card-enter`), v.offsetWidth, v.classList.add(`loading-card-enter`)))
    },
    setLoadingLabel(e) {
      _.textContent = e
    },
    setLoadingProgress(e) {
      me(e)
    },
    advanceLoadingProgress(e) {
      pe === null || pe >= e || me(pe + (e - pe) * 0.35)
    },
    hideLoading(e = !1) {
      if (
        (ue(), (te = void 0), pe !== null && me(1), e || window.matchMedia(`(prefers-reduced-motion: reduce)`).matches)
      ) {
        ;(fe(), g.classList.add(`hidden`))
        return
      }
      ;(g.classList.add(`loading-exiting`),
        (M = window.setTimeout(() => {
          ;(g.classList.add(`hidden`), g.classList.remove(`loading-exiting`), (M = void 0))
        }, 350)))
    },
    showError(e, t) {
      ;(ue(),
        fe(),
        he({ title: `This demo couldn’t be opened` }, `error`),
        x.classList.add(`hidden`),
        (T.textContent = e),
        T.classList.remove(`hidden`),
        (te = t),
        (E.textContent = `Choose another demo`),
        E.classList.add(`loading-action-primary`),
        E.classList.toggle(`hidden`, !t),
        g.classList.remove(`hidden`))
    },
    showParsingLeaveConfirmation(e, t) {
      ;(ne !== void 0 && (clearTimeout(ne), (ne = void 0)), (j = t), FL(O, k, e))
      let n = D.classList.contains(`hidden`) && !window.matchMedia(`(prefers-reduced-motion: reduce)`).matches
      ;(D.classList.toggle(`leave-confirm-transitioning`, n),
        D.classList.remove(`hidden`),
        n && (D.offsetWidth, D.classList.remove(`leave-confirm-transitioning`)),
        A.focus())
    },
    setParsingLeaveProgress(e) {
      FL(O, k, e)
    },
    hideParsingLeaveConfirmation(e = !1) {
      re(e)
    },
  }
}
var NL = `http://www.w3.org/2000/svg`
function PL(e) {
  let t = document.createElement(`span`)
  t.className = `loading-glyph loading-glyph-${e}`
  let n = document.createElementNS(NL, `svg`)
  n.setAttribute(`viewBox`, `0 0 24 24`)
  let r = document.createElementNS(NL, `path`)
  return (
    r.setAttribute(
      `d`,
      e === `error`
        ? `M12 8.5v4.5m0 3.4v.1M10.3 3.9 2.6 17.3a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z`
        : `M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Zm6 0V8.5h5M10.5 12.5v5l4-2.5-4-2.5Z`,
    ),
    r.setAttribute(`fill`, `none`),
    r.setAttribute(`stroke`, `currentColor`),
    r.setAttribute(`stroke-width`, `1.6`),
    r.setAttribute(`stroke-linecap`, `round`),
    r.setAttribute(`stroke-linejoin`, `round`),
    n.append(r),
    t.append(n),
    t
  )
}
function FL(e, t, n) {
  let r = Math.round(Math.max(0, Math.min(1, n)) * 100)
  ;(e.setAttribute(`aria-valuenow`, String(r)), (t.style.width = `${r}%`))
}
function IL(e) {
  let t = e / 1e3
  return t < 60
    ? `${t.toFixed(1)}s`
    : `${Math.floor(t / 60)}:${Math.floor(t % 60)
        .toString()
        .padStart(2, `0`)}`
}
function LL(e, t) {
  let { dropZone: n, fileInput: r, dropOverlay: i } = e,
    a = (e) => {
      e && !r.disabled && t(e)
    }
  ;(n.addEventListener(`click`, () => {
    r.disabled || r.click()
  }),
    n.addEventListener(`keydown`, (e) => {
      ;(e.key === `Enter` || e.key === ` `) && (e.preventDefault(), r.disabled || r.click())
    }),
    r.addEventListener(`change`, () => {
      ;(a(r.files?.[0]), (r.value = ``))
    }))
  let o = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(`Files`),
    s = 0,
    c = () => {
      ;((s = 0), i.classList.add(`hidden`))
    }
  ;(window.addEventListener(`dragenter`, (e) => {
    if (o(e)) {
      if ((e.preventDefault(), r.disabled)) {
        c()
        return
      }
      ;(s++, i.classList.remove(`hidden`))
    }
  }),
    window.addEventListener(`dragover`, (e) => {
      o(e) && e.preventDefault()
    }),
    window.addEventListener(`dragleave`, (e) => {
      o(e) && ((s = Math.max(0, s - 1)), s === 0 && c())
    }),
    window.addEventListener(`drop`, (e) => {
      ;(e.preventDefault(), c(), a(e.dataTransfer?.files?.[0]))
    }))
}
async function RL(e, t, n) {
  let r = t.summary
  if (!r) throw new jP(`Statistics have not been published for this map.`)
  let i = AbortSignal.any([n, AbortSignal.timeout(3e4)]),
    a
  try {
    a = await fetch(r.url, { signal: i })
  } catch (e) {
    throw n.aborted ? e : new jP(`Map statistics could not be downloaded.`, { cause: e })
  }
  if (!a.ok) throw new jP(`Map statistics are unavailable (HTTP ${a.status}).`)
  if (!a.body) throw new jP(`Map statistics response has no body.`)
  let o = a.body.getReader(),
    s = [],
    c = 0
  try {
    for (;;) {
      i.throwIfAborted()
      let { value: e, done: t } = await o.read()
      if (t) break
      if (((c += e.byteLength), c > r.bytes || c > 256 * 1024))
        throw (await o.cancel(), new jP(`Map statistics exceed their published size.`))
      s.push(e)
    }
  } finally {
    o.releaseLock()
  }
  if (c !== r.bytes) throw new jP(`Map statistics do not match their published size.`)
  let l = new Uint8Array(c),
    u = 0
  for (let e of s) (l.set(e, u), (u += e.byteLength))
  if ((await JI(l)) !== r.sha256) throw new jP(`Map statistics failed their checksum verification.`)
  i.throwIfAborted()
  let d
  try {
    d = JSON.parse(new TextDecoder(`utf-8`, { fatal: !0 }).decode(l))
  } catch (e) {
    throw new jP(`Map statistics are not valid JSON.`, { cause: e })
  }
  return zL(d, e, t)
}
function zL(e, t, n) {
  let r = VL(e, `Map summary`)
  ;((r.version !== 1 || r.coverage !== `complete`) && BL(`Unsupported or incomplete map summary.`),
    (r.matchId !== t.id || r.mapId !== n.id || KL(r.mapName) !== KL(n.name)) &&
      BL(`Map statistics belong to a different match or map.`))
  let i = VL(r.producer, `Summary producer`),
    a = GL(r.score)
  ;(!n.score || a.team1 !== n.score.team1 || a.team2 !== n.score.team2) &&
    BL(`Map statistics do not match the catalogue score.`)
  let o = new Set(),
    s = HL(r.teams, `Summary teams`).map((e, n) => {
      let r = VL(e, `Summary team`),
        i = UL(r.id, `Team ID`)
      i !== [t.team1Id, t.team2Id][n] && BL(`Summary teams do not match catalogue order.`)
      let a = HL(r.players, `Team players`).map((e) => {
        let t = VL(e, `Summary player`),
          n = UL(t.id, `Player ID`)
        return (
          o.has(n) && BL(`Duplicate player in map statistics.`),
          o.add(n),
          (typeof t.adr != `number` || !Number.isFinite(t.adr) || t.adr < 0) && BL(`Player ADR is invalid.`),
          {
            id: n,
            name: UL(t.name, `Player name`),
            kills: WL(t.kills),
            deaths: WL(t.deaths),
            assists: WL(t.assists),
            adr: t.adr,
          }
        )
      })
      return (a.length || BL(`Summary team has no players.`), { id: i, name: UL(r.name, `Team name`), players: a })
    })
  s.length !== 2 && BL(`Map statistics need exactly two teams.`)
  let c = { team1: 0, team2: 0 },
    l = HL(r.rounds, `Summary rounds`).map((e, n) => {
      let r = VL(e, `Summary round`),
        i = WL(r.number),
        a = UL(r.winnerTeamId, `Round winner`)
      ;((i !== n + 1 || ![t.team1Id, t.team2Id].includes(a)) && BL(`Round order or winner is invalid.`),
        r.side !== `ct` && r.side !== `t` && BL(`Round side is invalid.`),
        r.reason !== `elimination` &&
          r.reason !== `bomb` &&
          r.reason !== `defuse` &&
          r.reason !== `time` &&
          r.reason !== `unknown` &&
          BL(`Round win reason is invalid.`),
        ((r.reason === `bomb` && r.side !== `t`) || ([`defuse`, `time`].includes(r.reason) && r.side !== `ct`)) &&
          BL(`Round win reason conflicts with its side.`),
        a === t.team1Id ? c.team1++ : c.team2++)
      let o = GL(r.score)
      return (
        (o.team1 !== c.team1 || o.team2 !== c.team2) && BL(`Round history has an inconsistent running score.`),
        {
          number: i,
          winnerTeamId: a,
          side: r.side,
          reason: r.reason,
          score: o,
          ...(r.phase === void 0 ? {} : { phase: UL(r.phase, `Round phase`) }),
        }
      )
    })
  return (
    (c.team1 !== a.team1 || c.team2 !== a.team2) && BL(`Round history does not match the final score.`),
    {
      version: 1,
      matchId: t.id,
      mapId: n.id,
      mapName: n.name,
      coverage: `complete`,
      producer: {
        parserVersion: UL(i.parserVersion, `Parser version`),
        ...(i.parserRevision === void 0 ? {} : { parserRevision: UL(i.parserRevision, `Parser revision`) }),
      },
      score: a,
      teams: [s[0], s[1]],
      rounds: l,
    }
  )
}
function BL(e) {
  throw new jP(e)
}
function VL(e, t) {
  return ((!e || typeof e != `object` || Array.isArray(e)) && BL(`${t} must be an object.`), e)
}
function HL(e, t) {
  return (Array.isArray(e) || BL(`${t} must be an array.`), e)
}
function UL(e, t) {
  return ((typeof e != `string` || !e.trim()) && BL(`${t} must be a nonempty string.`), e.trim())
}
function WL(e) {
  return (
    (typeof e != `number` || !Number.isSafeInteger(e) || e < 0) && BL(`Summary counts must be nonnegative integers.`),
    e
  )
}
function GL(e) {
  let t = VL(e, `Score`)
  return { team1: WL(t.team1), team2: WL(t.team2) }
}
function KL(e) {
  return UL(e, `Map name`)
    .toLowerCase()
    .replace(/^de_/, ``)
    .replace(/[^a-z0-9]/g, ``)
}
function qL(e, t, n, r) {
  let i = (e, t, i) => ({
      name: n.get(e)?.name ?? e,
      logoUrl: n.get(e)?.logoUrl,
      score: i,
      players: r?.teams[t].players.map((e) => ({ ...e })) ?? [],
    }),
    a = [i(e.team1Id, 0, t.score?.team1), i(e.team2Id, 1, t.score?.team2)]
  return {
    teams: a,
    pickedBy: t.pick?.type === `pick` ? a[t.pick.teamId === e.team1Id ? 0 : 1] : void 0,
    rounds: r?.rounds.map((t) => ({
      number: t.number,
      winner: t.winnerTeamId === e.team1Id ? 0 : 1,
      side: t.side,
      reason: t.reason,
      score: [t.score.team1, t.score.team2],
      ...(t.phase === void 0 ? {} : { phase: t.phase }),
    })),
  }
}
function JL(e, t, n) {
  return e === void 0 ? `neutral` : e > n ? `positive` : e < t ? `negative` : `neutral`
}
function YL(e, t) {
  return t === void 0 ? `neutral` : JL(e, t, t)
}
var XL = new Intl.Collator(void 0, { numeric: !0, sensitivity: `base` })
function ZL(e, t) {
  let n = t.direction === `ascending` ? 1 : -1
  return [...e].sort((e, r) => {
    if (t.column === `name`) return n * XL.compare(e.name, r.name)
    let i = t.column === `kdRatio` ? (e.deaths === 0 ? void 0 : e.kills / e.deaths) : e[t.column],
      a = t.column === `kdRatio` ? (r.deaths === 0 ? void 0 : r.kills / r.deaths) : r[t.column]
    return i === void 0 && a !== void 0
      ? 1
      : a === void 0 && i !== void 0
        ? -1
        : (i !== void 0 && a !== void 0 ? n * (i - a) : 0) || XL.compare(e.name, r.name)
  })
}
function QL(e, t, n, r) {
  let i,
    a,
    o,
    s,
    c,
    l,
    u = () => {
      if (!i) {
        ;((l = void 0), e.replaceChildren(hR(`No featured matches are available yet.`)))
        return
      }
      let n = new Map(i.teams.map((e) => [e.id, e])),
        d = new Map(i.teams.map((e) => [e.id, e.name])),
        f = new Map(),
        p = new Map(),
        m = new Map(),
        h = Date.now()
      for (let e of i.events) m.set(e.id, !1)
      for (let e of i.matches) {
        let t = uR(e, d, i.events, h)
        p.set(e.id, t)
        let n = pR(e, i.events, h) && t.length > 0,
          r = f.get(e.eventId) ?? []
        ;(r.push({ id: e.id, match: e, disabled: !n }), f.set(e.eventId, r), n && m.set(e.eventId, !0))
      }
      if (i.events.length === 0) {
        ;((l = void 0), e.replaceChildren(hR(`No featured matches are available yet.`)))
        return
      }
      let g = [...i.events]
        .sort((e, t) => Date.parse(e.startsAt) - Date.parse(t.startsAt))
        .map((e) => ({ id: e.id, event: e, disabled: e.status === `upcoming` || !m.get(e.id) }))
      o = mR(g, o)
      let _ = o ? (f.get(o) ?? []) : []
      s = mR(_, s)
      let v = s ? (p.get(s) ?? []) : []
      c = mR(
        v.map((e) => ({ id: e.id, disabled: !1 })),
        c,
      )
      let y = i.matches.find((e) => e.id === s),
        b = v.find((e) => e.id === c)
      if (!b || !y) {
        l = void 0
        let t = document.createElement(`div`)
        ;((t.className = `hosted-menu`),
          t.append(
            hR(
              g.some((e) => !e.disabled)
                ? `No published map segments are available for this event yet.`
                : `Published match segments will appear here once events begin.`,
            ),
          ),
          e.replaceChildren(t))
        return
      }
      let x = [...y.maps]
          .sort((e, t) => e.order - t.order)
          .flatMap((e) => {
            let t = qL(y, e, n)
            return v.filter((t) => t.mapId === e.id).map((n) => ({ id: n.id, selection: n, map: e, preview: t }))
          }),
        S = x.find((e) => e.id === b.id)
      if (!S) throw Error(`HostedDemoMenu: missing map option for ${b.id}`)
      if (!l) {
        let t = $L((e) => {
            o !== e && ((o = e), (s = void 0), (c = void 0), u())
          }),
          i = eR(n, (e) => {
            ;(s !== e && ((s = e), (c = void 0), u()), r?.())
          }),
          a = rR((e) => {
            c !== e && ((c = e), u())
          })
        l = { events: t, matches: i, segments: a }
        let d = document.createElement(`div`)
        ;((d.className = `hosted-menu`), d.append(t.element, i.element, a.element), e.replaceChildren(d))
      }
      let C = a !== void 0
      ;(l.events.update(g, o, C),
        l.matches.update(_, s, C),
        l.segments.update(x, c, C),
        l.segments.showMatch(
          y,
          i.events.find((e) => e.id === y.eventId),
          n,
        ),
        l.segments.showDetails(S, y, n),
        (l.segments.watch.disabled = C),
        (l.segments.watch.textContent = a === b.id ? `Loading…` : `Watch`),
        l.segments.watch.setAttribute(`aria-label`, `Watch ${b.displayTitle}`),
        (l.segments.watch.onclick = () => {
          let e = qL(y, S.map, n, l?.segments.getSummary()),
            r = iL(y, S.map)
          t({
            ...b,
            teams: e.teams.map((e, t) => ({
              name: e.name,
              logoUrl: e.logoUrl,
              playerNames: e.players.map((e) => e.name),
              mapsWon: r?.mapsWon[t],
              mapsToWin: r?.mapsToWin,
            })),
          })
        }))
    }
  return {
    showLoading() {
      ;(l?.segments.dispose(), (i = void 0), (l = void 0), e.replaceChildren(hR(`Loading featured matches…`, !0)))
    },
    showCatalogue(e) {
      ;(l?.segments.dispose(), (i = e), (l = void 0), (a = void 0), (o = void 0), (s = void 0), (c = void 0), u())
    },
    showError(t) {
      ;(l?.segments.dispose(), (i = void 0), (l = void 0))
      let r = hR(t),
        a = document.createElement(`button`)
      ;((a.className = `hosted-retry`),
        (a.type = `button`),
        (a.textContent = `Try again`),
        a.addEventListener(`click`, n),
        r.appendChild(a),
        e.replaceChildren(r))
    },
    setSelected(e) {
      ;((a = e), u())
    },
  }
}
function $L(e) {
  let t = lR(`Event`)
  t.classList.add(`hosted-event-picker`)
  let n = document.createElement(`div`)
  n.className = `hosted-event-grid`
  let r = sR(
    n,
    (e) => {
      let { event: t } = e,
        n = document.createElement(`button`)
      ;((n.className = `hosted-event-card`),
        n.appendChild(gM(t.logoUrl, t.name, `hosted-event-logo`, { invertWhite: !0 })))
      let r = document.createElement(`span`)
      r.className = `hosted-event-copy`
      let i = document.createElement(`strong`)
      i.textContent = t.name
      let a = document.createElement(`span`)
      return ((a.textContent = [_R(t.status), bR(t)].join(` · `)), r.append(i, a), n.appendChild(r), n)
    },
    e,
  )
  return (t.appendChild(n), { element: t, update: r })
}
function eR(e, t) {
  let n = lR(`Match`)
  n.classList.add(`hosted-match-picker`)
  let r = document.createElement(`div`)
  r.className = `hosted-match-grid`
  let i = sR(
    r,
    (t) => {
      let { match: n } = t,
        r = e.get(n.team1Id),
        i = e.get(n.team2Id),
        a = document.createElement(`button`)
      a.className = `hosted-match-card`
      let o = document.createElement(`span`)
      return (
        (o.className = `hosted-match-teams`),
        o.append(tR(r, n.team1Id), nR(n), tR(i, n.team2Id)),
        a.appendChild(o),
        a
      )
    },
    t,
  )
  return (n.appendChild(r), { element: n, update: i })
}
function tR(e, t) {
  let n = e?.name ?? t,
    r = document.createElement(`span`)
  ;((r.className = `hosted-match-team`), r.appendChild(gM(e?.logoUrl, n, `hosted-team-logo`, { invertWhite: !0 })))
  let i = document.createElement(`span`)
  return ((i.className = `hosted-match-team-name`), (i.textContent = n), r.appendChild(i), r)
}
function nR(e) {
  let t = document.createElement(`span`)
  t.className = `hosted-match-center`
  let n = document.createElement(`span`)
  ;((n.className = `hosted-match-date`), (n.textContent = vR(e.playedAt) ?? ``))
  let r = document.createElement(`span`)
  r.className = `hosted-match-score`
  let i = document.createElement(`strong`)
  i.textContent = String(e.score.team1)
  let a = document.createElement(`span`)
  ;((a.className = `hosted-versus`), (a.textContent = `:`))
  let o = document.createElement(`strong`)
  ;((o.textContent = String(e.score.team2)), r.append(i, a, o))
  let s = document.createElement(`span`)
  return (
    (s.className = `hosted-match-card-meta`),
    (s.textContent = yR(e.stage) ?? ``),
    (s.title = s.textContent),
    t.append(n, r, s),
    t
  )
}
function rR(e) {
  let t = lR(`Map`)
  t.classList.add(`hosted-map-picker`)
  let n = document.createElement(`div`)
  n.className = `hosted-map-column`
  let r = document.createElement(`div`)
  r.className = `hosted-segment-list`
  let i = sR(
      r,
      ({ selection: e, map: t, preview: n }) => {
        let r = document.createElement(`button`)
        r.className = `hosted-segment`
        let i = document.createElement(`span`)
        i.className = `hosted-segment-label`
        let a = document.createElement(`strong`)
        if (((a.textContent = gR(e.mapName)), i.appendChild(a), t.pick?.type === `decider`)) {
          let e = document.createElement(`span`)
          ;((e.className = `hosted-map-decider`), (e.textContent = `Decider`), i.appendChild(e))
        }
        let o = document.createElement(`span`)
        ;((o.className = `hosted-segment-map-info`), o.append(cR(e.mapName, e.mapName), i))
        let s = document.createElement(`span`)
        s.className = `hosted-segment-teams`
        for (let [e, t] of n.teams.entries()) {
          let r = document.createElement(`span`)
          ;((r.className = `hosted-segment-team`), (r.title = t.name))
          let i = document.createElement(`span`)
          ;((i.className = `hosted-segment-score`),
            (i.textContent = t.score === void 0 ? `—` : String(t.score)),
            i.classList.add(`hosted-segment-${YL(t.score, n.teams[1 - e].score)}`))
          let a = gM(t.logoUrl, t.name, `hosted-team-logo`, { invertWhite: !0 })
          if ((e === 0 ? r.append(a, i) : r.append(i, a), t === n.pickedBy)) {
            let n = document.createElement(`span`)
            ;((n.className = `hosted-map-pick-marker`),
              (n.textContent = `PICK`),
              (n.title = `Picked by ${t.name}`),
              e === 0 ? r.prepend(n) : r.appendChild(n))
          }
          s.appendChild(r)
        }
        if (
          (r.setAttribute(
            `aria-label`,
            `${e.optionLabel}${n.pickedBy ? `; picked by ${n.pickedBy.name}` : t.pick?.type === `decider` ? `; decider` : `; map pick unavailable`}`,
          ),
          r.append(o, s),
          n.pickedBy)
        ) {
          let e = document.createElement(`span`)
          ;((e.className = `hosted-segment-pick-backdrop`),
            e.setAttribute(`aria-hidden`, `true`),
            e.appendChild(gM(n.pickedBy.logoUrl, n.pickedBy.name, `hosted-team-logo`, { invertWhite: !0 })),
            r.appendChild(e))
        }
        return r
      },
      e,
    ),
    a = document.createElement(`section`)
  ;((a.className = `hosted-map-details`), a.setAttribute(`aria-label`, `Selected map details`))
  let o = document.createElement(`div`)
  o.className = `hosted-map-details-header`
  let s = document.createElement(`div`)
  s.className = `hosted-map-heading`
  let c = document.createElement(`div`)
  c.className = `hosted-map-details-body`
  let l = document.createElement(`button`)
  ;((l.className = `hosted-watch`), (l.type = `button`), o.append(s, l), a.append(o, c), t.appendChild(r))
  let u = document.createElement(`div`)
  ;((u.className = `hosted-match-summary`), n.append(u, t, a))
  let d,
    f = (e, t, n) => {
      if (d === e.id) return
      d = e.id
      let r = document.createElement(`span`)
      r.className = `hosted-match-summary-event`
      let i = document.createElement(`span`)
      ;((i.textContent = t?.name ?? ``),
        (r.title = i.textContent),
        t && r.appendChild(gM(t.logoUrl, t.name, `hosted-event-logo`, { invertWhite: !0 })),
        r.appendChild(i))
      let a = document.createElement(`span`)
      ;((a.className = `hosted-match-teams`),
        a.append(tR(n.get(e.team1Id), e.team1Id), nR(e), tR(n.get(e.team2Id), e.team2Id)),
        u.replaceChildren(r, a))
    },
    p,
    m,
    h = new Map(),
    g,
    _ = { column: `kills`, direction: `descending` }
  return {
    element: n,
    update: (e, t, r) => {
      ;(n.style.setProperty(`--map-count`, String(e.length)), i(e, t, r))
    },
    watch: l,
    showMatch: f,
    showDetails: ({ selection: e, map: t }, n, r) => {
      if (p === e.id) return
      ;(m?.abort(), (p = e.id), (g = void 0))
      let i = document.createElement(`h4`)
      ;((i.className = `hosted-map-details-title`), (i.textContent = gR(t.name)))
      let a = document.createElement(`div`)
      if (
        ((a.className = `hosted-map-heading-copy`),
        a.appendChild(i),
        s.replaceChildren(cR(t.name, gR(t.name)), a),
        (c.scrollTop = 0),
        (c.scrollLeft = 0),
        !t.summary)
      ) {
        c.replaceChildren(
          hR(
            t.summaryUnavailableReason
              ? `Statistics unavailable: ${t.summaryUnavailableReason}`
              : `Statistics have not been published for this map yet.`,
          ),
        )
        return
      }
      let o = t.summary,
        l = `${n.id}:${t.id}:${o.url}:${o.sha256}`,
        u = (e) => {
          g = e
          let i = qL(n, t, r, e)
          c.replaceChildren(oR(i, _), aR(i))
        },
        d = () => {
          let r = h.get(l)
          if (r) {
            u(r)
            return
          }
          m?.abort()
          let i = new AbortController()
          ;((m = i),
            c.replaceChildren(hR(`Loading map statistics…`, !0)),
            RL(n, t, i.signal)
              .then((t) => {
                i.signal.aborted || p !== e.id || (h.set(l, t), u(t))
              })
              .catch((t) => {
                if (i.signal.aborted || p !== e.id) return
                console.error(`[csplayer] map statistics failed:`, t)
                let n = hR(t instanceof Error ? t.message : `Map statistics could not be loaded.`),
                  r = document.createElement(`button`)
                ;((r.className = `hosted-retry`),
                  (r.type = `button`),
                  (r.textContent = `Retry statistics`),
                  r.addEventListener(`click`, d),
                  n.appendChild(r),
                  c.replaceChildren(n))
              }))
        }
      d()
    },
    getSummary: () => g,
    dispose: () => {
      ;(m?.abort(), h.clear(), (g = void 0))
    },
  }
}
function iR() {
  let e = document.createElement(`span`)
  return (
    (e.className = `hosted-map-mock-badge`),
    (e.textContent = `Mock`),
    (e.title = `Map picks, player statistics and round history are illustrative mock data; final scores are from the catalogue.`),
    e.setAttribute(`aria-label`, e.title),
    e
  )
}
function aR(e) {
  let t = document.createElement(`section`)
  ;((t.className = `hosted-round-history`),
    t.setAttribute(`aria-label`, e.mock ? `Round history, mock data` : `Round history`))
  let n = document.createElement(`div`)
  n.className = `hosted-round-history-heading`
  let r = document.createElement(`h5`)
  ;((r.textContent = `Round history`), n.appendChild(r), e.mock && n.appendChild(iR()), t.appendChild(n))
  let i = e.rounds
  if (!i?.length) {
    let e = document.createElement(`p`)
    return (
      (e.className = `hosted-round-history-empty`),
      (e.textContent = i ? `No scored rounds for this map.` : `Round history needs a published map score.`),
      t.appendChild(e),
      t
    )
  }
  let a = document.createElement(`span`)
  a.className = `hosted-round-history-legend`
  for (let e of [`ct`, `t`]) {
    let t = document.createElement(`span`)
    ;((t.className = `hosted-round-${e}`), (t.textContent = e.toUpperCase()), a.appendChild(t))
  }
  n.appendChild(a)
  let o = document.createElement(`div`)
  ;((o.className = `hosted-round-history-scroll`),
    (o.tabIndex = 0),
    o.setAttribute(`role`, `region`),
    o.setAttribute(`aria-label`, `${e.mock ? `Mock round` : `Round`} results; scroll horizontally to see every round`))
  let s = document.createElement(`table`)
  ;((s.className = `hosted-round-history-table`),
    s.setAttribute(`aria-label`, `${e.mock ? `Mock round` : `Round`} winners and win reasons`),
    s.style.setProperty(`--round-history-width`, `${2.5 + i.length * 1.4}rem`))
  let c = s.createTHead().insertRow(),
    l = document.createElement(`th`)
  ;((l.scope = `col`), l.setAttribute(`aria-label`, `Team`), c.appendChild(l))
  for (let t of i) {
    let n = document.createElement(`th`)
    ;((n.scope = `col`),
      (n.textContent = String(t.number)),
      (n.title = `Round ${t.number}${t.phase ? ` · ${t.phase}${e.mock ? ` (mock)` : ``}` : ``}`),
      n.classList.toggle(`hosted-round-phase-start`, t.number > 1 && t.phase !== void 0),
      c.appendChild(n))
  }
  let u = {
      elimination: `elimination`,
      bomb: `bomb explosion`,
      defuse: `bomb defuse`,
      time: `time expiry`,
      unknown: `an unclassified win condition`,
    },
    d = { elimination: `skull`, bomb: `planted_c4`, defuse: `defuser` },
    f = s.createTBody()
  for (let [t, n] of e.teams.entries()) {
    let r = f.insertRow(),
      a = document.createElement(`th`)
    ;((a.scope = `row`),
      a.setAttribute(`aria-label`, n.name),
      (a.title = n.name),
      a.appendChild(gM(n.logoUrl, n.name, `hosted-team-logo`, { invertWhite: !0 })),
      r.appendChild(a))
    for (let a of i) {
      let i = r.insertCell()
      if ((i.classList.toggle(`hosted-round-phase-start`, a.number > 1 && a.phase !== void 0), a.winner !== t)) continue
      let o = document.createElement(`span`)
      ;((o.className = `hosted-round-win hosted-round-${a.side}`),
        o.setAttribute(`role`, `img`),
        o.setAttribute(
          `aria-label`,
          `${e.mock ? `Mock · ` : ``}Round ${a.number} · ${n.name} (${a.side.toUpperCase()}) won by ${u[a.reason]} · Score ${a.score[0]}–${a.score[1]}`,
        ))
      let s = document.createElement(`span`)
      ;((s.className = `hosted-round-icon`),
        s.setAttribute(`aria-hidden`, `true`),
        a.reason === `unknown`
          ? (s.classList.add(`hosted-round-unknown`), (s.textContent = `?`))
          : a.reason === `time`
            ? s.classList.add(`hosted-round-clock`)
            : s.style.setProperty(`--round-icon`, `url("${Zb(d[a.reason])}")`),
        o.appendChild(s),
        i.appendChild(o))
    }
  }
  return (o.appendChild(s), t.appendChild(o), t)
}
function oR(e, t) {
  let n = document.createElement(`table`)
  ;((n.className = `hosted-map-scoreboard`),
    n.setAttribute(
      `aria-label`,
      e.mock ? `Selected map scoreboard, mock player statistics` : `Selected map scoreboard`,
    ))
  let r = document.createElement(`colgroup`)
  for (let e of [
    `hosted-scoreboard-player-column`,
    ...[, , , , ,].fill(`hosted-scoreboard-stat-column`),
    `hosted-scoreboard-team-column`,
  ]) {
    let t = document.createElement(`col`)
    ;((t.className = e), r.appendChild(t))
  }
  n.appendChild(r)
  let i = n.createTHead().insertRow(),
    a = [],
    o = [],
    s = () => {
      let e = n.parentElement,
        r = e?.scrollTop,
        i = e?.scrollLeft
      for (let { column: e, cell: n, button: r, title: i } of a) {
        let a = e === t.column
        a ? n.setAttribute(`aria-sort`, t.direction) : n.removeAttribute(`aria-sort`)
        let o =
          a && t.direction === `descending` ? `ascending` : a ? `descending` : e === `name` ? `ascending` : `descending`
        r.setAttribute(`aria-label`, `Sort ${i} ${o} within each team`)
      }
      for (let { body: e, rows: n, identity: r } of o) {
        r.remove()
        let i = ZL([...n.keys()], t)
        for (let t of i) {
          let r = n.get(t)
          if (!r) throw Error(`HostedDemoMenu: missing scoreboard row for ${t.name}`)
          e.appendChild(r)
        }
        e.rows[0]?.appendChild(r)
      }
      e && r !== void 0 && i !== void 0 && ((e.scrollTop = r), (e.scrollLeft = i))
    }
  for (let [e, n, r] of [
    [`name`, `Player`, `Player name`],
    [`kills`, `K`, `Kills`],
    [`deaths`, `D`, `Deaths`],
    [`assists`, `A`, `Assists`],
    [`kdRatio`, `K/D`, `Kill/death ratio`],
    [`adr`, `ADR`, `Average damage per round`],
  ]) {
    let o = document.createElement(`th`)
    o.scope = `col`
    let c = document.createElement(`button`)
    ;((c.type = `button`),
      (c.className = `hosted-scoreboard-sort`),
      (c.textContent = n),
      (c.title = r),
      c.addEventListener(`click`, () => {
        ;((t.direction =
          e === t.column
            ? t.direction === `ascending`
              ? `descending`
              : `ascending`
            : e === `name`
              ? `ascending`
              : `descending`),
          (t.column = e),
          s())
      }),
      o.appendChild(c),
      i.appendChild(o),
      a.push({ column: e, cell: o, button: c, title: r }))
  }
  let c = document.createElement(`th`)
  ;((c.scope = `col`), c.setAttribute(`aria-label`, `Team and map score`), i.appendChild(c))
  for (let [t, r] of e.teams.entries()) {
    let i = n.createTBody()
    i.setAttribute(`aria-label`, r.name)
    let a = new Map(),
      s = document.createElement(`th`)
    ;((s.className = `hosted-scoreboard-identity`), (s.scope = `rowgroup`), (s.rowSpan = r.players.length))
    let c = document.createElement(`div`)
    c.className = `hosted-scoreboard-team-stack`
    let l = document.createElement(`span`)
    ;((l.className = `hosted-scoreboard-score`), (l.textContent = r.score === void 0 ? `—` : String(r.score)))
    let u = YL(r.score, e.teams[1 - t].score)
    ;(l.classList.add(`hosted-scoreboard-${u}`),
      c.append(gM(r.logoUrl, r.name, `hosted-team-logo`, { invertWhite: !0 }), l),
      s.appendChild(c),
      s.setAttribute(`aria-label`, `${r.name}: ${r.score === void 0 ? `score unavailable` : r.score}`))
    for (let [e, t] of r.players.entries()) {
      let n = i.insertRow()
      a.set(t, n)
      let r = document.createElement(`th`)
      r.scope = `row`
      let o = document.createElement(`span`)
      ;((o.className = `hosted-scoreboard-player-name`),
        (o.textContent = t.name),
        (o.title = t.name),
        r.appendChild(o),
        n.appendChild(r))
      let c = t.deaths === 0 ? void 0 : Number((t.kills / t.deaths).toFixed(2)),
        l = [
          [String(t.kills)],
          [String(t.deaths)],
          [String(t.assists)],
          [c === void 0 ? `—` : c.toFixed(2), JL(c, 0.95, 1.05)],
          [t.adr.toFixed(1)],
        ]
      for (let [e, t] of l) {
        let r = n.insertCell()
        ;((r.textContent = e), t && r.classList.add(`hosted-scoreboard-${t}`))
      }
      e === 0 && n.appendChild(s)
    }
    o.push({ body: i, rows: a, identity: s })
  }
  return (s(), n)
}
function sR(e, t, n) {
  let r = new Map()
  return (i, a, o) => {
    let s = e.scrollTop,
      c = new Set(i.map((e) => e.id))
    for (let [e, t] of r) c.has(e) || (t.remove(), r.delete(e))
    ;(i.forEach((i, s) => {
      let c = r.get(i.id)
      ;(c || ((c = t(i)), (c.type = `button`), c.addEventListener(`click`, () => n(i.id)), r.set(i.id, c)),
        (c.disabled = o || i.disabled === !0),
        c.classList.toggle(`active`, i.id === a),
        c.setAttribute(`aria-pressed`, String(i.id === a)))
      let l = e.children.item(s)
      l !== c && e.insertBefore(c, l)
    }),
      (e.scrollTop = s))
  }
}
function cR(e, t) {
  let n = document.createElement(`span`)
  n.className = `hosted-map-icon`
  let r = document.createElement(`span`)
  return (
    (r.textContent = EM(t.replace(/^(de|cs|ar|dz|gd|coop)_/i, ``))),
    n.appendChild(r),
    C_(e)
      .then((e) => {
        if (!e || !n.isConnected) return
        let t = document.createElement(`img`)
        ;((t.src = e),
          (t.alt = ``),
          (t.decoding = `async`),
          t.addEventListener(`load`, () => n.classList.add(`loaded`)),
          t.addEventListener(`error`, () => t.remove()),
          n.appendChild(t))
      })
      .catch((t) => {
        console.warn(`[csplayer] map logo failed for ${e}:`, t)
      }),
    n
  )
}
function lR(e) {
  let t = document.createElement(`section`)
  t.className = `hosted-picker`
  let n = document.createElement(`h3`)
  return ((n.className = `hosted-picker-label`), (n.textContent = e), t.appendChild(n), t)
}
function uR(e, t, n, r) {
  if (!pR(e, n, r)) return []
  let i = dR(e, t)
  return [...e.maps]
    .sort((e, t) => e.order - t.order)
    .flatMap((t) =>
      t.segments.map((r) => {
        let a = fR(gR(t.name), r.label, t.score?.team1, t.score?.team2)
        return {
          id: `${e.id}:${t.id}:${r.id}`,
          eventId: e.eventId,
          eventName: n.find((t) => t.id === e.eventId)?.name ?? `Unknown event`,
          matchId: e.id,
          matchLabel: i,
          mapId: t.id,
          mapName: t.name,
          segmentId: r.id,
          segmentLabel: r.label,
          optionLabel: a,
          displayTitle: `${i} — ${a}`,
          artifactUrl: r.artifactUrl,
          artifactSha256: r.artifactSha256,
          artifactBytes: r.artifactBytes,
          formatVersion: r.formatVersion,
        }
      }),
    )
}
function dR(e, t) {
  return `${t.get(e.team1Id) ?? e.team1Id} vs ${t.get(e.team2Id) ?? e.team2Id}`
}
function fR(e, t, n, r) {
  let i = e.localeCompare(t, void 0, { sensitivity: `accent` }) === 0 ? e : `${e} — ${t}`,
    a = n === void 0 || r === void 0 ? void 0 : xR(n, r)
  return a ? `${i} (${a})` : i
}
function pR(e, t, n) {
  let r = t.find((t) => t.id === e.eventId)
  return !r || r.status === `upcoming` ? !1 : Date.parse(e.playedAt) <= n
}
function mR(e, t) {
  return t && e.some((e) => e.id === t && !e.disabled) ? t : (e.find((e) => !e.disabled)?.id ?? e[0]?.id)
}
function hR(e, t = !1) {
  let n = document.createElement(`div`)
  return (
    (n.className = `hosted-status`),
    (n.textContent = e),
    n.setAttribute(`role`, `status`),
    t && n.setAttribute(`aria-busy`, `true`),
    n
  )
}
function gR(e) {
  return (
    e
      .replace(/^(de|cs|ar|dz|gd|coop)_/i, ``)
      .split(`_`)
      .filter(Boolean)
      .map((e) => e.charAt(0).toUpperCase() + e.slice(1))
      .join(` `) || e
  )
}
function _R(e) {
  return e.charAt(0).toUpperCase() + e.slice(1)
}
function vR(e) {
  if (e) return new Date(e).toLocaleDateString(void 0, { dateStyle: `medium` })
}
function yR(e) {
  return e?.split(/[.!?](?:\s|$)/, 1)[0]?.trim() || void 0
}
function bR(e) {
  let t = new Date(e.startsAt),
    n = new Date(e.endsAt)
  return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth()
    ? `${t.toLocaleDateString(void 0, { month: `short`, day: `numeric` })}–${n.getDate()}, ${n.getFullYear()}`
    : `${vR(e.startsAt)}–${vR(e.endsAt)}`
}
function xR(e, t) {
  return `${e}-${t}`
}
var SR = 12,
  CR = 8
function wR(e, t = 2.2) {
  let n = new DataView(e)
  if (e.byteLength < SR) throw Error(`Backdrop clip is truncated`)
  if (String.fromCharCode(n.getUint8(0), n.getUint8(1), n.getUint8(2), n.getUint8(3)) !== `CSBG`)
    throw Error(`Not a backdrop clip`)
  if (n.getUint8(4) !== 1) throw Error(`Unsupported backdrop clip version ${n.getUint8(4)}`)
  let r = n.getUint8(5),
    i = n.getUint8(6),
    a = n.getUint16(8, !0)
  if (r === 0 || i === 0 || a < 2) throw Error(`Backdrop clip is empty`)
  let o = SR + r
  if (e.byteLength < o + a * r * CR) throw Error(`Backdrop clip is truncated`)
  let s = new Uint8Array(e.slice(SR, o)),
    c = a * r,
    l = new Float32Array(c * 3),
    u = new Float32Array(c),
    d = new Uint8Array(c)
  for (let e = 0; e < c; e++) {
    let t = o + e * CR
    ;((l[e * 3] = n.getInt16(t, !0)),
      (l[e * 3 + 1] = n.getInt16(t + 2, !0)),
      (l[e * 3 + 2] = n.getInt16(t + 4, !0)),
      (u[e] = (n.getUint8(t + 6) / 256) * Math.PI * 2),
      (d[e] = n.getUint8(t + 7)))
  }
  let f = {
    playerCount: r,
    sampleRate: i,
    frameCount: a,
    duration: (a - 1) / i,
    teams: s,
    positions: l,
    yaws: u,
    flags: d,
    focus: new Float32Array(a * 3),
  }
  return (TR(f, t), f)
}
function TR(e, t) {
  let { playerCount: n, frameCount: r, teams: i, positions: a, flags: o, focus: s } = e,
    c = [0, 0, 0],
    l = !1
  for (let e = 0; e < r; e++) {
    let t = d(e, !0) ?? d(e, !1)
    if (t && ((c[0] = t[0]), (c[1] = t[1]), (c[2] = t[2]), !l)) {
      for (let n = 0; n < e; n++) s.set(t, n * 3)
      l = !0
    }
    ;((s[e * 3] = c[0]), (s[e * 3 + 1] = c[1]), (s[e * 3 + 2] = c[2]))
  }
  if (t <= 0) return
  let u = 1 - Math.exp(-1 / (e.sampleRate * t))
  for (let e = 0; e < 3; e++) {
    for (let t = 1; t < r; t++) {
      let n = t * 3 + e
      s[n] = s[n - 3] + (s[n] - s[n - 3]) * u
    }
    for (let t = r - 2; t >= 0; t--) {
      let n = t * 3 + e
      s[n] = s[n + 3] + (s[n] - s[n + 3]) * u
    }
  }
  function d(e, t) {
    let r = 0,
      s = 0,
      c = 0,
      l = 0
    for (let u = 0; u < n; u++) {
      let d = e * n + u
      o[d] & 1 && ((t && i[u] !== 2) || ((r += a[d * 3]), (s += a[d * 3 + 1]), (c += a[d * 3 + 2]), l++))
    }
    return l > 0 ? [r / l, s / l, c / l] : null
  }
}
function ER(e, t) {
  let n = Math.min(Math.max(t * e.sampleRate, 0), e.frameCount - 1),
    r = Math.min(Math.floor(n), e.frameCount - 2)
  return { frame: r, next: r + 1, t: n - r }
}
var DR = `/backdrop/mirage-a-execute.bin`,
  OR = `de_mirage`,
  kR = 1e3 / 30,
  AR = 1 / 4,
  jR = 480,
  MR = 1 / 4,
  NR = 4,
  PR = 6,
  FR = 1400,
  IR = 0.9,
  LR = 50,
  RR = [
    { from: [350, -650, 20], to: [200, -450, 40], lookFrom: [-900, -650, -220], lookTo: [-700, -750, -220] },
    { from: [-1650, -150, 90], to: [-1610, 250, 90], lookFrom: [-2600, 600, -120], lookTo: [-2600, 100, -120] },
    { from: [-700, -2330, 100], to: [-820, -1880, 100], lookFrom: [-100, -1850, -60], lookTo: [-100, -2050, -60] },
  ],
  zR = 24,
  BR = 56,
  VR = new U(16756782).multiplyScalar(1.8),
  HR = new U(5941759).multiplyScalar(1.8),
  UR = null
function WR() {
  return (
    (UR ??= fetch(DR)
      .then((e) => {
        if (!e.ok) throw Error(`Backdrop clip request failed (${e.status})`)
        return e.arrayBuffer()
      })
      .then((e) => wR(e))
      .catch((e) => {
        throw ((UR = null), e)
      })),
    UR
  )
}
function GR(e) {
  let t = document.createElement(`div`)
  ;((t.className = `landing-backdrop`), t.setAttribute(`aria-hidden`, `true`), e.prepend(t))
  let n = typeof window.matchMedia == `function`,
    r = n ? [UA, `(prefers-reduced-motion: reduce)`].map((e) => window.matchMedia(e)) : [],
    i = null,
    a = null,
    o = !1,
    s = !1,
    c = () => n && !s && !o && !e.classList.contains(`hidden`) && !r.some((e) => e.matches) && !KR(),
    l = () => {
      if (c()) {
        !i && !a && (a = qR(u))
        return
      }
      ;(a?.(), (a = null), i?.dispose(), (i = null))
    },
    u = () => {
      ;((a = null),
        !(!c() || i) &&
          (i = new JR(t, (e) => {
            ;(console.warn(`[csplayer] landing backdrop unavailable, keeping the still image:`, e),
              (o = !0),
              i?.dispose(),
              (i = null))
          })))
    },
    d = new MutationObserver(l)
  d.observe(e, { attributes: !0, attributeFilter: [`class`] })
  for (let e of r) e.addEventListener(`change`, l)
  return (
    l(),
    {
      dispose() {
        ;((s = !0), d.disconnect())
        for (let e of r) e.removeEventListener(`change`, l)
        ;(l(), t.remove())
      },
    }
  )
}
function KR() {
  return navigator.connection?.saveData === !0
}
function qR(e) {
  if (typeof window.requestIdleCallback == `function`) {
    let t = window.requestIdleCallback(e, { timeout: 1500 })
    return () => window.cancelIdleCallback(t)
  }
  let t = window.setTimeout(e, 300)
  return () => window.clearTimeout(t)
}
