// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 42175–43246 行（切片 23/34）
// 角色：播放控制条 xA：controls/timeline/round-timeline/scrubber
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var xA = class {
  callbacks
  root
  duration
  timeline
  slider
  roundTimeline
  roundTimelineTitle
  roundTimelineStatus
  roundTimelineClock
  roundTimelineStage
  roundTimelineTrack
  roundTimelineEvents
  roundTimelineCaption
  roundScrubEvents = []
  roundDiscs = []
  roundCaptionKey = null
  scrubHintLabel
  roundLoadState
  markers
  playBtn
  skipTimeoutBtn
  elapsedLabel
  totalLabel
  speedGroup
  speedButtons = []
  povGroup
  povFree
  povFly
  povNoclip
  mobileSpeed
  mobileSpeedValue
  mobilePov
  mobileEvents
  mobileScoreboard
  playerOptions = new Map()
  scrubbing = !1
  loadedDuration
  roundRanges = []
  parsedRounds = 0
  chapterTrackWidth = 0
  chapterResize = null
  majorEvents = []
  timeoutMarkers = []
  dragPointerId = -1
  dragStartY = 0
  roundDragStartX = 0
  roundDragStartTime = 0
  roundDragIndex = -1
  roundTimelineHideTimer = 0
  currentSpeed = NaN
  currentViewMode = ``
  playing = null
  constructor(e, t, n) {
    ;((this.callbacks = n), (this.duration = t), (this.loadedDuration = t))
    let r = document.createElement(`div`)
    ;((r.className = `controls`),
      (r.innerHTML = `
      <div class="controls-card">
        <button class="ctrl-btn timeout-skip-btn" type="button" hidden>Skip timeout<svg class="ctrl-icon timeout-skip-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5v13l8-6.5zM13 5.5v13l8-6.5z"/></svg></button>
        <div class="scrubber">
          <span class="time-elapsed" aria-hidden="true">0:00</span>
          <div class="timeline">
            <div class="round-timeline" hidden aria-hidden="true">
              <div class="round-timeline-card">
                <div class="round-timeline-header">
                  <span class="round-timeline-title">Round</span>
                  <span class="round-timeline-clock">0:00</span>
                </div>
                <div class="round-timeline-subtitle">
                  <span class="round-timeline-status" hidden></span>
                  <span class="round-timeline-caption"></span>
                </div>
                <div class="round-timeline-stage">
                  <div class="round-timeline-track"></div>
                  <div class="round-timeline-events"></div>
                  <div class="round-timeline-thumb"></div>
                </div>
              </div>
              <div class="round-timeline-zoom"></div>
            </div>
            <div class="timeline-scrub-hint" aria-hidden="true">${gA}<span class="timeline-scrub-hint-label">Slide up to scrub this round</span></div>
            <div class="timeline-round-load"></div>
            <div class="timeline-markers"></div>
            <input class="timeline-slider" aria-label="Playback position" type="range" min="0" max="${t}" step="any" value="0" />
          </div>
          <span class="time-total" aria-hidden="true">0:00</span>
        </div>
        <div class="controls-row">
          <div class="controls-start">
            <div class="speeds segmented" role="group" aria-label="Playback speed"><span class="segmented-thumb" aria-hidden="true"></span></div>
            <div class="mobile-tools">
              <select class="mobile-pov" aria-label="Camera or player">
                <option value="free">Orbit camera</option>
                <option value="fly" disabled>Fly (keyboard)</option>
                <option value="noclip" disabled>Noclip (keyboard)</option>
              </select>
              <button class="ctrl-btn mobile-events" type="button" aria-label="Toggle event feed" aria-controls="round-feed" aria-expanded="false">Events</button>
              <button class="ctrl-btn mobile-scoreboard" type="button" aria-label="Toggle scoreboard" aria-controls="scoreboard" aria-expanded="false">Score</button>
            </div>
          </div>
          <div class="transport">
            ${bA(-15)}
            ${bA(-5)}
            <button class="ctrl-btn play-btn" type="button" aria-label="Play" title="Play (Space)">${_A}${vA}</button>
            ${bA(5)}
            ${bA(15)}
          </div>
          <div class="controls-end">
            <div class="pov segmented" role="group" aria-label="Camera" style="--count: 3">
              <span class="segmented-thumb" aria-hidden="true"></span>
              <button class="ctrl-btn pov-free" type="button" title="Free camera (F)">Free <kbd class="ctrl-key">F</kbd></button>
              <button class="ctrl-btn pov-fly" type="button" title="Collision-aware fly camera (V) — WASD, E/Q up/down, mouse to look, Shift boost, scroll speed; hold Ctrl to release mouse, Esc to unlock until a view click">Fly <kbd class="ctrl-key">V</kbd></button>
              <button class="ctrl-btn pov-noclip" type="button" title="Noclip camera (N) — fly through map geometry; hold Ctrl to release mouse, Esc to unlock until a view click">Noclip <kbd class="ctrl-key">N</kbd></button>
            </div>
            <label class="speed-picker">
              <span class="speed-picker-value" aria-hidden="true">1×</span>
              <select class="mobile-speed" aria-label="Playback speed"></select>
            </label>
          </div>
        </div>
      </div>
    `),
      e.appendChild(r),
      (this.root = r),
      (this.timeline = r.querySelector(`.timeline`)),
      (this.slider = r.querySelector(`.timeline-slider`)),
      (this.roundTimeline = r.querySelector(`.round-timeline`)),
      (this.roundTimelineTitle = r.querySelector(`.round-timeline-title`)),
      (this.roundTimelineStatus = r.querySelector(`.round-timeline-status`)),
      (this.roundTimelineClock = r.querySelector(`.round-timeline-clock`)),
      (this.roundTimelineStage = r.querySelector(`.round-timeline-stage`)),
      (this.roundTimelineTrack = r.querySelector(`.round-timeline-track`)),
      (this.roundTimelineEvents = r.querySelector(`.round-timeline-events`)),
      (this.roundTimelineCaption = r.querySelector(`.round-timeline-caption`)),
      (this.scrubHintLabel = r.querySelector(`.timeline-scrub-hint-label`)),
      this.timeline.classList.toggle(`timeline-scrub-hint-enabled`, !AA()),
      (this.roundLoadState = r.querySelector(`.timeline-round-load`)),
      (this.markers = r.querySelector(`.timeline-markers`)),
      (this.playBtn = r.querySelector(`.play-btn`)),
      (this.skipTimeoutBtn = r.querySelector(`.timeout-skip-btn`)),
      (this.elapsedLabel = r.querySelector(`.time-elapsed`)),
      (this.totalLabel = r.querySelector(`.time-total`)),
      (this.speedGroup = r.querySelector(`.speeds`)),
      (this.povGroup = r.querySelector(`.pov`)),
      (this.povFree = r.querySelector(`.pov-free`)),
      (this.povFly = r.querySelector(`.pov-fly`)),
      (this.povNoclip = r.querySelector(`.pov-noclip`)),
      (this.mobileSpeed = r.querySelector(`.mobile-speed`)),
      (this.mobileSpeedValue = r.querySelector(`.speed-picker-value`)),
      (this.mobilePov = r.querySelector(`.mobile-pov`)),
      (this.mobileEvents = r.querySelector(`.mobile-events`)),
      (this.mobileScoreboard = r.querySelector(`.mobile-scoreboard`)),
      this.playBtn.addEventListener(`click`, () => this.callbacks.onPlayPause()),
      this.skipTimeoutBtn.addEventListener(`click`, () => {
        let e = Number(this.skipTimeoutBtn.dataset.endTime)
        Number.isFinite(e) && this.callbacks.onSeek(e)
      }))
    for (let e of r.querySelectorAll(`.skip-btn`)) {
      let t = Number(e.dataset.skip)
      e.addEventListener(`click`, () => this.callbacks.onSkip(t))
    }
    ;(this.slider.addEventListener(`input`, () => {
      this.dragPointerId >= 0 || ((this.scrubbing = !0), this.seekFromControl(this.slider.valueAsNumber))
    }),
      this.slider.addEventListener(`change`, () => {
        ;((this.scrubbing = !1), this.callbacks.onSeek(this.slider.valueAsNumber))
      }),
      this.timeline.addEventListener(`pointerdown`, this.onTimelinePointerDown),
      typeof ResizeObserver < `u` &&
        ((this.chapterResize = new ResizeObserver(() => {
          Math.abs(this.timeline.getBoundingClientRect().width - this.chapterTrackWidth) >= 1 && this.renderChapters()
        })),
        this.chapterResize.observe(this.timeline)),
      this.slider.addEventListener(`keydown`, () => this.timeline.classList.remove(`timeline-pointer-focus`)),
      this.slider.addEventListener(`blur`, () => this.timeline.classList.remove(`timeline-pointer-focus`)),
      this.timeline.addEventListener(`pointermove`, this.onTimelinePointerMove),
      this.timeline.addEventListener(`pointerup`, this.onTimelinePointerEnd),
      this.timeline.addEventListener(`pointercancel`, this.onTimelinePointerEnd))
    let i = this.speedGroup
    i.style.setProperty(`--count`, String(iA.length))
    for (let e of iA) {
      let t = document.createElement(`button`)
      ;((t.type = `button`),
        (t.className = `ctrl-btn speed-btn`),
        (t.textContent = `${e}×`),
        (t.dataset.speed = String(e)),
        (t.title = `Playback speed ${e}×`),
        t.addEventListener(`click`, () => this.callbacks.onSpeed(e)),
        this.speedButtons.push(t),
        i.appendChild(t))
      let n = document.createElement(`option`)
      ;((n.value = String(e)), (n.textContent = `${e}×`), this.mobileSpeed.appendChild(n))
    }
    ;(this.setSpeed(1),
      this.mobileSpeed.addEventListener(`change`, () => this.callbacks.onSpeed(Number(this.mobileSpeed.value))),
      this.mobilePov.addEventListener(`change`, () => {
        this.mobilePov.value === `free`
          ? this.callbacks.onSelectFree()
          : this.callbacks.onSelectPlayer(Number(this.mobilePov.value))
      }),
      this.mobileEvents.addEventListener(`click`, () => this.callbacks.onToggleEvents()),
      this.mobileScoreboard.addEventListener(`click`, () => this.callbacks.onToggleScoreboard()),
      this.povFree.addEventListener(`click`, () => this.callbacks.onSelectFree()),
      this.povFly.addEventListener(`click`, () => this.callbacks.onSelectFly()),
      this.povNoclip.addEventListener(`click`, () => this.callbacks.onSelectNoclip()),
      r.addEventListener(`click`, (e) => {
        let t = e.target instanceof Element ? e.target.closest(`button`) : null
        t && e.detail > 0 && t.blur()
      }),
      this.setViewMode(`free`))
  }
  setTimelineMarkers(e, t, n = []) {
    ;((this.timeoutMarkers = t), (this.majorEvents = n), (this.markers.innerHTML = ``))
    for (let t of e) {
      if (t <= 0) continue
      let e = document.createElement(`div`)
      ;((e.className = `timeline-marker`), (e.style.left = `${(t * 100).toFixed(2)}%`), this.markers.appendChild(e))
    }
    this.renderChapters()
  }
  setTime(e) {
    this.scrubbing || ((this.slider.valueAsNumber = e), this.updateFill(), this.updateTimeLabels())
  }
  get isScrubbing() {
    return this.scrubbing
  }
  setDuration(e) {
    ;((this.duration = Math.max(0, e)),
      (this.slider.max = String(this.duration)),
      this.updateFill(),
      this.updateTimeLabels())
  }
  setRoundLoadState(e, t, n) {
    ;((this.roundRanges = e),
      (this.parsedRounds = t),
      (this.loadedDuration = Math.max(0, Math.min(this.duration, n))),
      this.renderChapters(),
      this.slider.valueAsNumber > this.loadedDuration && (this.slider.valueAsNumber = this.loadedDuration),
      this.slider.setAttribute(
        `aria-valuetext`,
        `${MA(this.slider.valueAsNumber)} loaded through ${MA(this.loadedDuration)}`,
      ),
      this.updateFill())
  }
  renderChapters() {
    let e =
        this.roundRanges.length > 0
          ? this.roundRanges
          : this.timeoutMarkers.length > 0
            ? [{ startFraction: 0, endFraction: 1 }]
            : [],
      t = this.roundRanges.length > 0 ? this.parsedRounds : e.length
    if (
      ((this.roundLoadState.innerHTML = ``),
      this.timeline.classList.toggle(`timeline-segmented`, e.length > 0),
      e.length === 0)
    )
      return
    let n = this.timeoutMarkers.filter((e) => EA(e) === `technical`),
      r = this.timeoutMarkers.filter((e) => EA(e) !== `technical`),
      i = OA(e, n, aA)
    ;((this.chapterTrackWidth = this.timeline.getBoundingClientRect().width),
      this.widenShortTimeouts(i, this.chapterTrackWidth))
    for (let e of i) {
      let n = document.createElement(`div`),
        i = e.round < t ? `loaded` : e.round === t ? `loading` : `pending`,
        a = Math.max(0, e.end - e.start)
      ;(e.timeout
        ? ((n.className = `timeline-round-segment timeline-timeout-segment timeline-timeout-${EA(e.timeout)}`),
          n.classList.toggle(`is-pending`, i !== `loaded`),
          (n.title = `${DA(e.timeout)} · ${MA(a * this.duration)} · skippable`))
        : ((n.className = `timeline-round-segment timeline-round-${i}`),
          (n.title = `Round ${e.round + 1}: ${i}`),
          this.markTeamTimeouts(n, e, r)),
        (n.dataset.round = String(e.round)),
        kA(n, e),
        this.roundLoadState.appendChild(n))
    }
  }
  markTeamTimeouts(e, t, n) {
    let r = t.left ?? t.start,
      i = Math.max(1e-9, (t.right ?? t.end) - r)
    for (let a of n) {
      let n = Math.max(t.start, a.fraction),
        o = Math.min(t.end, a.endFraction)
      if (o <= n) continue
      let s = document.createElement(`span`)
      ;((s.className = `timeline-round-timeout timeline-timeout-${EA(a)}`),
        (s.style.left = `${((n - r) / i) * 100}%`),
        (s.style.width = `${((o - n) / i) * 100}%`),
        e.appendChild(s),
        (e.title += ` · ${DA(a)} ${MA((a.endFraction - a.fraction) * this.duration)}`))
    }
  }
  widenShortTimeouts(e, t) {
    if (t <= 0) return
    let n = oA / t,
      r = 4 / t
    for (let t of e) ((t.left = t.start), (t.right = t.end))
    let i = (e, t, n) => {
      if (!e || e.timeout) return 0
      let i = n === `left` ? e.right : e.left
      return Math.abs(i - t) > 1e-9 ? 0 : Math.max(0, e.right - e.left - r)
    }
    e.forEach((t, r) => {
      let a = n - (t.right - t.left)
      if (!t.timeout || a <= 0) return
      let o = e[r - 1],
        s = e[r + 1],
        c = i(o, t.left, `left`),
        l = i(s, t.right, `right`),
        u = Math.min(a / 2, c),
        d = Math.min(a - u, l)
      ;((u = Math.min(a - d, c)),
        o && u > 0 && (o.right -= u),
        s && d > 0 && (s.left += d),
        (t.left -= u),
        (t.right += d))
    })
  }
  onTimelinePointerDown = (e) => {
    ;(e.pointerType === `mouse` && e.button !== 0) ||
      (e.target instanceof HTMLElement && e.target.closest(`button`)) ||
      (e.preventDefault(),
      this.timeline.classList.add(`timeline-pointer-focus`),
      this.slider.focus({ preventScroll: !0 }),
      (this.dragPointerId = e.pointerId),
      (this.dragStartY = e.clientY),
      (this.roundDragIndex = -1),
      (this.scrubbing = !0),
      this.timeline.classList.add(`timeline-dragging`),
      this.timeline.setPointerCapture(e.pointerId),
      this.seekMainPointer(e.clientX))
  }
  onTimelinePointerMove = (e) => {
    e.pointerId === this.dragPointerId &&
      (e.preventDefault(),
      this.roundDragIndex < 0 && this.dragStartY - e.clientY >= cA && this.beginRoundDrag(e.clientX),
      this.roundDragIndex >= 0 ? this.seekRoundPointer(e.clientX) : this.seekMainPointer(e.clientX))
  }
  onTimelinePointerEnd = (e) => {
    e.pointerId === this.dragPointerId &&
      (e.preventDefault(),
      this.timeline.hasPointerCapture(e.pointerId) && this.timeline.releasePointerCapture(e.pointerId),
      (this.dragPointerId = -1),
      (this.roundDragIndex = -1),
      this.hideRoundTimeline(),
      this.timeline.classList.remove(`timeline-dragging`),
      this.timeline.classList.remove(`timeline-round-scrubbing`),
      (this.scrubbing = !1),
      this.callbacks.onSeek(this.slider.valueAsNumber))
  }
  seekMainPointer(e) {
    let t = this.timeline.getBoundingClientRect(),
      n = t.width > 0 ? SA((e - t.left) / t.width) : 0
    ;(this.seekFromControl(n * this.duration), this.updateScrubHint(e - t.left))
  }
  updateScrubHint(e) {
    if (!this.timeline.classList.contains(`timeline-scrub-hint-enabled`)) return
    let t = this.roundIndexAt(this.slider.valueAsNumber)
    if ((this.timeline.classList.toggle(`timeline-scrub-hint-ready`, t >= 0), t < 0)) return
    let n = `Slide up to scrub round ${t + 1}`
    ;(this.scrubHintLabel.textContent !== n && (this.scrubHintLabel.textContent = n),
      this.timeline.style.setProperty(`--scrub-hint-x`, `${e}px`))
  }
  roundIndexAt(e) {
    return this.roundRanges.findIndex((t, n) => {
      let r = t.startFraction * this.duration,
        i = t.endFraction * this.duration
      return e >= r && (e < i || n === this.roundRanges.length - 1)
    })
  }
  beginRoundDrag(e) {
    let t = this.slider.valueAsNumber,
      n = this.roundIndexAt(t)
    if (n < 0) return
    let r = this.roundRanges[n]
    ;((this.roundDragIndex = n),
      (this.roundDragStartX = e),
      (this.roundDragStartTime = t),
      window.clearTimeout(this.roundTimelineHideTimer),
      this.roundTimeline.classList.remove(`is-hiding`),
      (this.roundTimeline.hidden = !1),
      this.positionRoundTimeline(r),
      this.renderRoundScrubber(r, n),
      this.timeline.classList.add(`timeline-round-scrubbing`))
    for (let e of this.roundLoadState.querySelectorAll(`.timeline-round-segment`))
      e.classList.toggle(`is-zoomed`, e.dataset.round === String(n))
    ;(this.timeline.classList.contains(`timeline-scrub-hint-enabled`) &&
      (this.timeline.classList.remove(`timeline-scrub-hint-enabled`), jA()),
      this.updateRoundTimeline())
  }
  hideRoundTimeline() {
    this.roundTimeline.hidden ||
      (this.roundTimeline.classList.add(`is-hiding`),
      window.clearTimeout(this.roundTimelineHideTimer),
      (this.roundTimelineHideTimer = window.setTimeout(() => {
        ;((this.roundTimeline.hidden = !0),
          this.roundTimeline.classList.remove(`is-hiding`),
          (this.roundTimelineHideTimer = 0))
      }, uA)))
  }
  seekRoundPointer(e) {
    let t = this.roundRanges[this.roundDragIndex]
    if (!t) return
    let [n, r] = this.roundScrubBounds(t),
      i = Math.max(0, r - n),
      a = Math.max(1, this.roundTimelineStage.getBoundingClientRect().width),
      o = this.roundDragStartTime + ((e - this.roundDragStartX) / a) * i
    ;(this.seekFromControl(Math.max(n, Math.min(r, o))), this.updateRoundTimeline())
  }
  positionRoundTimeline(e) {
    let t = this.timeline.getBoundingClientRect().width,
      n = Math.min(t, 600, Math.max(360, t * 0.55)),
      r = e.startFraction * t,
      i = e.endFraction * t,
      a = (r + i) * 0.5,
      o = Math.max(0, Math.min(t - n, a - n * 0.5))
    ;((this.roundTimeline.style.left = `${o}px`),
      (this.roundTimeline.style.width = `${n}px`),
      this.roundTimeline.style.setProperty(`--zoom-l`, `${r - o}px`),
      this.roundTimeline.style.setProperty(`--zoom-r`, `${i - o}px`),
      this.roundTimeline.style.setProperty(`--zoom-origin`, `${a - o}px`))
  }
  renderRoundScrubber(e, t) {
    ;((this.roundTimelineTitle.textContent = `Round ${t + 1}`),
      (this.roundTimelineTrack.innerHTML = ``),
      (this.roundTimelineEvents.innerHTML = ``),
      (this.roundCaptionKey = null))
    let n = e.startFraction * this.duration,
      r = e.endFraction * this.duration,
      i = Math.max(0.01, r - n),
      a = Math.max(1e-9, e.endFraction - e.startFraction),
      o = Math.max(1, this.roundTimelineStage.offsetWidth || this.roundTimelineStage.getBoundingClientRect().width),
      s = (t) => SA((t - e.startFraction) / a),
      c = OA([e], this.timeoutMarkers, pA * a)
        .map((e) => ({ ...e, start: s(e.start), end: s(e.end) }))
        .filter((e) => e.end - e.start > 1e-6)
    this.widenShortTimeouts(c, o)
    for (let e of c) {
      if (!e.timeout) continue
      let t = EA(e.timeout),
        n = e.left ?? e.start,
        r = e.right ?? e.end,
        i = document.createElement(`div`)
      ;((i.className = `round-timeline-timeout timeline-timeout-${t}`),
        (i.style.left = `${n * 100}%`),
        (i.style.width = `${(r - n) * 100}%`),
        (r - n) * o >= mA && (i.textContent = t === `technical` ? `Pause` : `Timeout`),
        this.roundTimelineTrack.appendChild(i))
    }
    this.roundScrubEvents = this.majorEvents.filter((e) => e.time >= n && e.time < r).sort((e, t) => e.time - t.time)
    let l = CA(
      this.roundScrubEvents.map((e) => ((e.time - n) / i) * o),
      o,
    )
    this.roundDiscs = this.roundScrubEvents.map((e, t) => {
      let n = document.createElement(`span`)
      return (
        (n.className = `round-timeline-event round-timeline-event-${e.team} round-timeline-event-${e.kind}`),
        (n.style.left = `${(l[t] / o) * 100}%`),
        e.iconUrl && n.style.setProperty(`--event-icon`, `url(${e.iconUrl})`),
        this.roundTimelineEvents.appendChild(n),
        n
      )
    })
  }
  seekFromControl(e) {
    ;((this.slider.valueAsNumber = Math.max(0, Math.min(this.loadedDuration, e))),
      this.updateFill(),
      this.updateTimeLabels(),
      this.callbacks.onSeek(this.slider.valueAsNumber))
  }
  updateRoundTimeline() {
    let e = this.roundRanges[this.roundDragIndex]
    if (!e) return
    let t = e.startFraction * this.duration,
      n = Math.max(0.01, e.endFraction * this.duration - t),
      r = this.slider.valueAsNumber,
      i = SA((r - t) / n)
    this.roundTimelineStage.style.setProperty(`--progress`, String(i))
    let a = `${MA(r - t)}<span class="round-timeline-clock-total"> / ${MA(n)}</span>`
    this.roundTimelineClock.innerHTML !== a && (this.roundTimelineClock.innerHTML = a)
    let o = this.timeoutMarkers.find((e) => r >= e.fraction * this.duration && r < e.endFraction * this.duration),
      s = o ? DA(o) : ``
    this.roundTimelineStatus.textContent !== s &&
      ((this.roundTimelineStatus.textContent = s),
      (this.roundTimelineStatus.hidden = !o),
      (this.roundTimelineCaption.hidden = !!o),
      (this.roundTimelineStatus.className = o
        ? `round-timeline-status timeline-timeout-${EA(o)}`
        : `round-timeline-status`))
    let c = -1
    for (; c + 1 < this.roundScrubEvents.length && this.roundScrubEvents[c + 1].time <= r;) c++
    ;(this.roundDiscs.forEach((e, t) => {
      ;(e.classList.toggle(`is-past`, t <= c), e.classList.toggle(`is-latest`, t === c))
    }),
      this.renderRoundCaption(this.roundScrubEvents[c]))
  }
  renderRoundCaption(e) {
    let t = e ? `${e.time}|${e.title}` : ``
    t !== this.roundCaptionKey &&
      ((this.roundCaptionKey = t),
      this.roundTimelineCaption.classList.toggle(`is-empty`, !e),
      e
        ? e.kind === `kill` && e.actor && e.target
          ? (this.roundTimelineCaption.innerHTML = `${wA(e.actor, e.team)} killed ${wA(e.target, e.targetTeam)}`)
          : (this.roundTimelineCaption.textContent = e.title)
        : (this.roundTimelineCaption.textContent = `No kills yet`))
  }
  roundScrubBounds(e) {
    let t = e.startFraction * this.duration,
      n = Math.min(e.endFraction * this.duration, this.loadedDuration)
    return n - t <= lA * 2 ? [t, n] : [t + lA, n - lA]
  }
  updateFill() {
    let e = this.duration > 0 ? SA(this.slider.valueAsNumber / this.duration) : 0
    ;(this.slider.style.setProperty(`--fill`, `${e * 100}%`),
      this.timeline.style.setProperty(`--fill`, `${e * 100}%`),
      this.timeline.style.setProperty(`--fill-n`, String(e)))
  }
  updateTimeLabels() {
    let e = MA(this.slider.valueAsNumber),
      t = MA(this.duration)
    ;(this.elapsedLabel.textContent !== e && (this.elapsedLabel.textContent = e),
      this.totalLabel.textContent !== t && (this.totalLabel.textContent = t))
  }
  setPlaying(e) {
    e !== this.playing &&
      ((this.playing = e),
      this.playBtn.classList.toggle(`is-playing`, e),
      this.playBtn.setAttribute(`aria-label`, e ? `Pause` : `Play`),
      (this.playBtn.title = e ? `Pause (Space)` : `Play (Space)`))
  }
  get element() {
    return this.root
  }
  setSpeed(e) {
    if (e !== this.currentSpeed) {
      ;((this.currentSpeed = e), (this.mobileSpeed.value = String(e)), (this.mobileSpeedValue.textContent = `${e}×`))
      for (let t of this.speedButtons) {
        let n = Number(t.dataset.speed) === e
        ;(t.classList.toggle(`active`, n), t.setAttribute(`aria-pressed`, String(n)))
      }
      this.speedGroup.style.setProperty(`--index`, String(iA.indexOf(e)))
    }
  }
  setViewMode(e) {
    ;(e !== `player` && (this.mobilePov.value = e),
      e !== this.currentViewMode &&
        ((this.currentViewMode = e),
        this.povFree.classList.toggle(`active`, e === `free`),
        this.povFly.classList.toggle(`active`, e === `fly`),
        this.povNoclip.classList.toggle(`active`, e === `noclip`),
        this.povGroup.style.setProperty(`--index`, String(sA.indexOf(e)))))
  }
  setPlayers(e, t) {
    let n = new Set(e.map((e) => e.slot))
    for (let [e, t] of this.playerOptions) n.has(e) || (t.remove(), this.playerOptions.delete(e))
    for (let t of e) {
      let e = this.playerOptions.get(t.slot)
      e ||
        ((e = document.createElement(`option`)),
        (e.value = String(t.slot)),
        this.playerOptions.set(t.slot, e),
        this.mobilePov.appendChild(e))
      let n = `${t.name}${t.alive ? `` : ` (dead)`}`
      ;(e.textContent !== n && (e.textContent = n), e.disabled === t.alive && (e.disabled = !t.alive))
    }
    t >= 0 && (this.mobilePov.value = String(t))
  }
  setMobilePanels(e, t) {
    ;(this.mobileEvents.setAttribute(`aria-expanded`, String(e)),
      this.mobileScoreboard.setAttribute(`aria-expanded`, String(t)))
  }
  setHudAvailability(e, t) {
    ;((this.mobileEvents.disabled = !e), (this.mobileScoreboard.disabled = !t))
  }
  setTimeoutEnd(e) {
    ;((this.skipTimeoutBtn.hidden = e === null),
      e === null ? delete this.skipTimeoutBtn.dataset.endTime : (this.skipTimeoutBtn.dataset.endTime = String(e)))
  }
  dispose() {
    ;(this.chapterResize?.disconnect(),
      window.clearTimeout(this.roundTimelineHideTimer),
      this.dragPointerId >= 0 &&
        this.timeline.hasPointerCapture(this.dragPointerId) &&
        this.timeline.releasePointerCapture(this.dragPointerId),
      this.timeline.classList.remove(`timeline-dragging`),
      this.root.remove())
  }
}
function SA(e) {
  return Math.max(0, Math.min(1, e))
}
function CA(e, t) {
  let n = [],
    r = dA / 2,
    i = Math.max(r, t - dA / 2),
    a = r,
    o = 0
  for (; o < e.length;) {
    let t = o
    for (; t + 1 < e.length && e[t + 1] - e[t] < dA;) t++
    let r = []
    for (let n = o; n <= t; n++) r.push(n === o ? e[n] : Math.max(e[n], r[r.length - 1] + fA))
    let s = (r[r.length - 1] - e[t]) / 2,
      c = r[r.length - 1] - r[0],
      l = Math.max(a, Math.min(r[0] - s, i - c))
    for (let e of r) n.push(l + e - r[0])
    ;((a = l + c + dA), (o = t + 1))
  }
  return n
}
function wA(e, t) {
  return `<span class="round-timeline-name${t ? ` round-timeline-name-${t}` : ``}">${TA(e)}</span>`
}
function TA(e) {
  return e.replace(/[&<>"']/g, (e) => ({ "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` })[e])
}
function EA(e) {
  return e.technical ? `technical` : (e.side ?? `technical`)
}
function DA(e) {
  let t = EA(e)
  return t === `technical` ? `Technical pause` : `${t.toUpperCase()} timeout`
}
function OA(e, t, n) {
  let r = []
  for (let e of [...t].sort((e, t) => e.fraction - t.fraction)) {
    let t = SA(e.fraction),
      n = SA(Math.max(e.fraction, e.endFraction))
    if (n <= t) continue
    let i = r.at(-1)
    i && t <= i.end ? (i.end = Math.max(i.end, n)) : r.push({ start: t, end: n, timeout: e })
  }
  let i = (t) => {
      let n = e.findIndex((e) => t >= e.startFraction && t < e.endFraction)
      return n >= 0 ? n : e.length - 1
    },
    a = []
  e.forEach((e, t) => {
    let n = Math.max(0, e.startFraction)
    for (let i of r)
      i.end <= n ||
        i.start >= e.endFraction ||
        (i.start > n && a.push({ start: n, end: i.start, round: t }), (n = Math.max(n, i.end)))
    e.endFraction > n && a.push({ start: n, end: e.endFraction, round: t })
  })
  for (let e of r) a.push({ start: e.start, end: e.end, round: i(e.start), timeout: e.timeout })
  a.sort((e, t) => e.start - t.start)
  for (let e = 0; e < a.length; e++) {
    let t = a[e]
    if (t.timeout || t.end - t.start >= n) continue
    let r = a[e - 1],
      i = a[e + 1]
    if (i?.timeout && Math.abs(i.start - t.end) < 1e-9) i.start = t.start
    else if (r?.timeout && Math.abs(r.end - t.start) < 1e-9) r.end = t.end
    else continue
    a.splice(e--, 1)
  }
  return a
}
function kA(e, t) {
  let n = t.left ?? t.start,
    r = t.right ?? t.end
  ;((e.style.left = `${n * 100}%`),
    (e.style.width = `${Math.max(0, r - n) * 100}%`),
    e.style.setProperty(`--seg-start`, String(t.start)),
    e.style.setProperty(`--seg-width`, String(Math.max(1e-6, t.end - t.start))))
}
function AA() {
  try {
    return typeof localStorage < `u` && localStorage.getItem(hA) === `1`
  } catch {
    return !1
  }
}
function jA() {
  try {
    typeof localStorage < `u` && localStorage.setItem(hA, `1`)
  } catch {}
}
function MA(e) {
  let t = Math.max(0, Math.floor(e))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, `0`)}`
}
var NA = 3e3,
  PA = 10,
  FA = 350,
  IA = 300,
  LA = class {
    container
    surface
    controls
    media
    releaseTarget
    delayMs
    deferTaps
    surfacePointers = new Set()
    enabled = !1
    visible = !0
    paused = !1
    held = !1
    tap = null
    hideTimer
    tapTimer
    constructor(e) {
      ;((this.container = e.container),
        (this.surface = e.surface),
        (this.controls = e.controls),
        (this.media = e.media),
        (this.releaseTarget = e.releaseTarget ?? globalThis),
        (this.delayMs = e.delayMs ?? NA),
        (this.deferTaps = e.deferTaps ?? (() => !1)),
        this.surface.addEventListener(`pointerdown`, this.onSurfaceDown),
        this.surface.addEventListener(`pointerup`, this.onSurfaceUp),
        this.surface.addEventListener(`pointercancel`, this.onSurfaceCancel),
        this.controls.addEventListener(`pointerdown`, this.onControlsDown))
      for (let e of [`click`, `input`, `change`, `keydown`]) this.controls.addEventListener(e, this.onControlsActivity)
      ;(this.releaseTarget.addEventListener(`pointerup`, this.onRelease),
        this.releaseTarget.addEventListener(`pointercancel`, this.onRelease),
        this.media.addEventListener(`change`, this.onMediaChange),
        this.onMediaChange())
    }
    get hidden() {
      return this.enabled && !this.visible
    }
    show() {
      ;((this.visible = !0), this.apply(), this.scheduleHide())
    }
    hide() {
      ;(this.clearHideTimer(), (this.visible = !1), this.apply())
    }
    setPaused(e) {
      e !== this.paused && ((this.paused = e), e ? this.clearHideTimer() : this.scheduleHide())
    }
    dispose() {
      ;(this.clearHideTimer(),
        this.clearTapTimer(),
        this.surface.removeEventListener(`pointerdown`, this.onSurfaceDown),
        this.surface.removeEventListener(`pointerup`, this.onSurfaceUp),
        this.surface.removeEventListener(`pointercancel`, this.onSurfaceCancel),
        this.controls.removeEventListener(`pointerdown`, this.onControlsDown))
      for (let e of [`click`, `input`, `change`, `keydown`])
        this.controls.removeEventListener(e, this.onControlsActivity)
      ;(this.releaseTarget.removeEventListener(`pointerup`, this.onRelease),
        this.releaseTarget.removeEventListener(`pointercancel`, this.onRelease),
        this.media.removeEventListener(`change`, this.onMediaChange),
        delete this.container.dataset.controlsHidden)
    }
    onMediaChange = () => {
      ;((this.enabled = this.media.matches),
        (this.held = !1),
        (this.tap = null),
        this.clearTapTimer(),
        this.surfacePointers.clear(),
        this.show())
    }
    onSurfaceDown = (e) => {
      let t = e
      ;(this.surfacePointers.add(t.pointerId),
        (this.tap =
          this.enabled && this.surfacePointers.size === 1 && t.button === 0
            ? { id: t.pointerId, x: t.clientX, y: t.clientY, time: e.timeStamp }
            : null))
    }
    onSurfaceUp = (e) => {
      let t = e
      this.surfacePointers.delete(t.pointerId)
      let n = this.tap
      if (
        ((this.tap = null),
        !(!this.enabled || !n || n.id !== t.pointerId) &&
          !(Math.hypot(t.clientX - n.x, t.clientY - n.y) > PA || e.timeStamp - n.time > FA))
      ) {
        if (!this.deferTaps()) {
          this.toggle()
          return
        }
        if (this.tapTimer !== void 0) {
          this.clearTapTimer()
          return
        }
        this.tapTimer = setTimeout(() => {
          ;((this.tapTimer = void 0), this.toggle())
        }, IA)
      }
    }
    toggle() {
      this.visible ? this.hide() : this.show()
    }
    clearTapTimer() {
      this.tapTimer !== void 0 && (clearTimeout(this.tapTimer), (this.tapTimer = void 0))
    }
    onSurfaceCancel = (e) => {
      ;(this.surfacePointers.delete(e.pointerId), (this.tap = null))
    }
    onControlsDown = () => {
      this.enabled && ((this.held = !0), this.clearHideTimer())
    }
    onControlsActivity = () => {
      this.enabled && this.visible && this.scheduleHide()
    }
    onRelease = () => {
      this.held && ((this.held = !1), this.scheduleHide())
    }
    scheduleHide() {
      ;(this.clearHideTimer(),
        !(!this.enabled || !this.visible || this.paused || this.held) &&
          (this.hideTimer = setTimeout(() => {
            ;((this.hideTimer = void 0), this.hide())
          }, this.delayMs)))
    }
    clearHideTimer() {
      this.hideTimer !== void 0 && (clearTimeout(this.hideTimer), (this.hideTimer = void 0))
    }
    apply() {
      this.hidden ? (this.container.dataset.controlsHidden = `true`) : delete this.container.dataset.controlsHidden
    }
  },
  RA = `<svg class="pov-picker-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l7.6 4.3v9L12 20.8l-7.6-4.3v-9zM4.4 7.5L12 11.8l7.6-4.3M12 11.8v9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  zA = `<svg class="pov-picker-chevron" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 6l3-3 3 3M2 10l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  BA = { free: `Free`, fly: `Fly`, noclip: `Noclip` },
  VA = [
    { side: `t`, label: `T` },
    { side: `ct`, label: `CT` },
    { side: null, label: `Other` },
  ],
  HA = class {
    element
    select
    badge
    label
    keyboardOption
    signature = ``
    shown = ``
    constructor(e, t) {
      let n = document.createElement(`label`)
      ;((n.className = `pov-picker`),
        (n.innerHTML = `
      <span class="pov-picker-badge" aria-hidden="true"></span>
      <span class="pov-picker-label" aria-hidden="true"></span>
      ${zA}
      <select class="pov-picker-select" aria-label="Camera"></select>
    `),
        e.appendChild(n),
        (this.element = n),
        (this.select = n.querySelector(`.pov-picker-select`)),
        (this.badge = n.querySelector(`.pov-picker-badge`)),
        (this.label = n.querySelector(`.pov-picker-label`)),
        (this.keyboardOption = document.createElement(`option`)),
        (this.keyboardOption.value = `keyboard`),
        (this.keyboardOption.disabled = !0),
        (this.keyboardOption.hidden = !0),
        this.select.addEventListener(`change`, () => {
          let e = this.select.value
          e === `free` ? t.onSelectFree() : e !== `keyboard` && t.onSelectPlayer(Number(e))
        }))
    }
    update(e, t, n) {
      let r = e.map((e) => `${e.slot}:${e.side}:${+!!e.alive}:${e.name}`).join(`|`)
      r !== this.signature && ((this.signature = r), this.renderOptions(e), (this.shown = ``))
      let i = n === `player` ? e.find((e) => e.slot === t) : void 0,
        a = i ? String(i.slot) : n === `player` || n === `free` ? `free` : `keyboard`,
        o = i?.side ?? ``,
        s = i ? i.name : BA[n === `player` ? `free` : n],
        c = `${a}|${o}|${s}`
      c !== this.shown &&
        ((this.shown = c),
        (this.select.value = a),
        (this.label.textContent = s),
        (this.element.dataset.side = o || `none`),
        (this.element.dataset.view = i ? `player` : `free`),
        (this.badge.innerHTML = i ? `` : RA))
    }
    renderOptions(e) {
      let t = document.createElement(`option`)
      ;((t.value = `free`), (t.textContent = `Free camera`))
      let n = [t, this.keyboardOption]
      for (let { side: t, label: r } of VA) {
        let i = e.filter((e) => e.side === t)
        if (i.length === 0) continue
        let a = document.createElement(`optgroup`)
        a.label = r
        for (let e of i) {
          let t = document.createElement(`option`)
          ;((t.value = String(e.slot)),
            (t.textContent = e.alive ? e.name : `${e.name} (dead)`),
            (t.disabled = !e.alive),
            a.appendChild(t))
        }
        n.push(a)
      }
      this.select.replaceChildren(...n)
    }
  },
  UA = `(max-width: 700px), (max-width: 1000px) and (pointer: coarse)`,
  WA = `(max-width: 700px) and (orientation: portrait), (max-width: 1000px) and (pointer: coarse) and (orientation: portrait)`,
  GA = class {
    element
    indicator
    opacity = 0
    constructor(e) {
      ;((this.element = document.createElement(`div`)),
        (this.element.className = `blind-overlay`),
        (this.element.hidden = !0),
        e.appendChild(this.element),
        (this.indicator = document.createElement(`div`)),
        (this.indicator.className = `blind-indicator`),
        (this.indicator.hidden = !0),
        this.indicator.setAttribute(`role`, `status`),
        e.appendChild(this.indicator))
    }
    update(e, t, n, r = `full`) {
      let i = zk(e, t)
      ;((this.indicator.hidden = r === `full` || i <= 0),
        this.indicator.hidden ||
          (this.indicator.textContent = `Blinded ${Math.round(i * 100)}% \u00b7 ${e.toFixed(1)}s`))
      let a = r === `indicator` ? 0 : r === `reduced` ? Math.min(0.35, i) : n ? i : Math.min(0.72, i)
      a !== this.opacity &&
        ((this.opacity = a), (this.element.hidden = a <= 0), (this.element.style.opacity = String(a)))
    }
    hide() {
      this.update(0, 0, !0)
    }
    dispose() {
      ;(this.element.remove(), this.indicator.remove())
    }
  },
  KA = 4,
  qA = 10,
  JA = 2,
  YA = 160,
  XA = class {
    canvas
    ctx
    current = null
    shown = !1
    constructor(e) {
      ;((this.canvas = document.createElement(`canvas`)),
        (this.canvas.className = `crosshair-overlay`),
        e.appendChild(this.canvas))
      let t = this.canvas.getContext(`2d`)
      if (!t) throw Error(`Crosshair: 2D canvas context unavailable`)
      ;((this.ctx = t), (this.canvas.style.display = `none`))
    }
    show(e) {
      ;((this.shown ||= ((this.canvas.style.display = `block`), !0)),
        e !== this.current && ((this.current = e), this.draw(e)))
    }
    hide() {
      this.shown &&= ((this.canvas.style.display = `none`), !1)
    }
    dispose() {
      this.canvas.remove()
    }
    draw(e) {
      let t = Math.min(window.devicePixelRatio || 1, 2)
      ;((this.canvas.width = YA * t),
        (this.canvas.height = YA * t),
        (this.canvas.style.width = `${YA}px`),
        (this.canvas.style.height = `${YA}px`))
      let n = this.ctx
      ;(n.setTransform(t, 0, 0, t, 0, 0), n.clearRect(0, 0, YA, YA))
      let r = YA / 2,
        i = YA / 2,
        [a, o, s] = hg(e),
        c = (e.alphaEnabled ? e.alpha : 255) / 255,
        l = Math.max(1, Math.round(e.length * KA)),
        u = Math.max(1, Math.round(e.thickness * KA)),
        d = Math.max(0, Math.round(qA + e.gap * JA)),
        f = e.outlineEnabled ? Math.max(1, Math.round(e.outline)) : 0,
        p = Math.floor(u / 2),
        m = [
          [r + d, i - p, l, u],
          [r - d - l, i - p, l, u],
          [r - p, i + d, u, l],
        ]
      if ((e.tStyleEnabled || m.push([r - p, i - d - l, u, l]), f > 0)) {
        n.fillStyle = `rgba(0,0,0,${c})`
        for (let [e, t, r, i] of m) n.fillRect(e - f, t - f, r + 2 * f, i + 2 * f)
        e.centerDotEnabled && n.fillRect(r - p - f, i - p - f, u + 2 * f, u + 2 * f)
      }
      n.fillStyle = `rgba(${a},${o},${s},${c})`
      for (let [e, t, r, i] of m) n.fillRect(e, t, r, i)
      e.centerDotEnabled && n.fillRect(r - p, i - p, u, u)
    }
  },
  ZA = 0.6,
  QA = class {
    element
    opacity = 0
    constructor(e) {
      ;((this.element = document.createElement(`div`)),
        (this.element.className = `damage-overlay`),
        this.element.setAttribute(`aria-hidden`, `true`),
        (this.element.hidden = !0),
        e.appendChild(this.element))
    }
    update(e, t, n, r) {
      if (t < 0) {
        this.hide()
        return
      }
      let i = ZA * r,
        a = 0
      for (let r = $A(e.tick, e.count, n) - 1; r >= 0; r--) {
        let o = n - e.tick[r]
        if (o > i) break
        if (e.victimSlot[r] !== t) continue
        let s = 1 - o / i,
          c = Math.min(1, 0.65 + e.dmg[r] / 100)
        a = Math.max(a, s * c)
      }
      this.setOpacity(a)
    }
    hide() {
      this.setOpacity(0)
    }
    dispose() {
      this.element.remove()
    }
    setOpacity(e) {
      e !== this.opacity &&
        ((this.opacity = e), (this.element.hidden = e <= 0), (this.element.style.opacity = String(e)))
    }
  }
function $A(e, t, n) {
  let r = 0,
    i = t
  for (; r < i;) {
    let t = (r + i) >>> 1
    e[t] <= n ? (r = t + 1) : (i = t)
  }
  return r
}
var ej = [
    { key: `noscope`, label: `No scope`, url: Zb(`noscope`) },
    { key: `wallbang`, label: `Wallbang`, url: Zb(`penetrate`) },
    { key: `thrusmoke`, label: `Through smoke`, url: Zb(`smoke_kill`) },
    { key: `attackerblind`, label: `Attacker blinded`, url: Zb(`blind_kill`) },
    { key: `headshot`, label: `Headshot`, url: Zb(`headshot`) },
  ],
  tj = Zb(`skull`)
function nj(e) {
  return e.world
    ? rj(e) + `<span class="kf-name" style="color:${e.victimColor}">${aj(e.victim)}</span>`
    : `<span class="kf-name" style="color:${e.attackerColor}">${aj(e.attacker)}</span>` +
        rj(e) +
        `<span class="kf-name" style="color:${e.victimColor}">${aj(e.victim)}</span>`
}
function rj(e) {
  if (e.world) return ij(`kf-mod kf-skull`, tj, `World / suicide`)
  let t = e.weapon ?? `Unknown weapon`,
    n = Xb(t)
  return (
    (n ? ij(`kf-icon`, n, t.replace(/^weapon_/, ``).replaceAll(`_`, ` `)) : `<span class="kf-weapon">${aj(t)}</span>`) +
    ej
      .filter((t) => e[t.key])
      .map((e) => ij(`kf-mod kf-mod-${e.key}`, e.url, e.label))
      .join(``)
  )
}
function ij(e, t, n) {
  let r = aj(n)
  return `<span class="${e}" role="img" aria-label="${r}" title="${r}" style="-webkit-mask-image:url(${t});mask-image:url(${t})"></span>`
}
function aj(e) {
  return e.replace(/[&<>"']/g, (e) => ({ "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` })[e])
}
