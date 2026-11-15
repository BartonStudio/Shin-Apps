// ============================================================================
// 22-transport-controls.deobf.js —— 播放控制条与 HUD 覆盖层
// 来源：src/app/22-transport-controls.js（Vite 生产构建，prettier 展开版）
// 原文范围：decompiled/index.beautified.js L42175–43246（切片 22-transport-controls）
// 原始标识符已语义化重命名 + 补充中文注释。
//
// 包含六块：
//   TransportControls  xA  —— 播放控制条（时间线/回合缩放/速度/POV/跳转）
//   ControlsAutoHide   LA  —— 控制条自动隐藏（触摸设备）
//   PovPicker          HA  —— POV 下拉选择器
//   BlindOverlay       GA  —— 闪光致盲遮罩
//   Crosshair          XA  —— 准星（Canvas 绘制 CS2 准星样式）
//   DamageIndicator    QA  —— 受击红屏指示
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 一、TransportControls —— 播放控制条
//     时间线 + 回合缩放 scrubber + 章节（回合/暂停）分段 + 播放/跳转/速度/POV。
// ────────────────────────────────────────────────────────────────────────────
class TransportControls {
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
  scrubbing = false
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

  constructor(container, duration, callbacks) {
    this.callbacks = callbacks
    this.duration = duration
    this.loadedDuration = duration
    let root = document.createElement(`div`)
    root.className = `controls`
    root.innerHTML = `
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
            <div class="timeline-scrub-hint" aria-hidden="true">${SCRUB_HINT_ICON}<span class="timeline-scrub-hint-label">Slide up to scrub this round</span></div>
            <div class="timeline-round-load"></div>
            <div class="timeline-markers"></div>
            <input class="timeline-slider" aria-label="Playback position" type="range" min="0" max="${duration}" step="any" value="0" />
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
            ${makeSkipBtn(-15)}${makeSkipBtn(-5)}
            <button class="ctrl-btn play-btn" type="button" aria-label="Play" title="Play (Space)">${PLAY_ICON}${PAUSE_ICON}</button>
            ${makeSkipBtn(5)}${makeSkipBtn(15)}
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
    `
    container.appendChild(root)
    this.root = root
    this.timeline = root.querySelector(`.timeline`)
    this.slider = root.querySelector(`.timeline-slider`)
    this.roundTimeline = root.querySelector(`.round-timeline`)
    this.roundTimelineTitle = root.querySelector(`.round-timeline-title`)
    this.roundTimelineStatus = root.querySelector(`.round-timeline-status`)
    this.roundTimelineClock = root.querySelector(`.round-timeline-clock`)
    this.roundTimelineStage = root.querySelector(`.round-timeline-stage`)
    this.roundTimelineTrack = root.querySelector(`.round-timeline-track`)
    this.roundTimelineEvents = root.querySelector(`.round-timeline-events`)
    this.roundTimelineCaption = root.querySelector(`.round-timeline-caption`)
    this.scrubHintLabel = root.querySelector(`.timeline-scrub-hint-label`)
    this.timeline.classList.toggle(`timeline-scrub-hint-enabled`, !scrubHintSeen())
    this.roundLoadState = root.querySelector(`.timeline-round-load`)
    this.markers = root.querySelector(`.timeline-markers`)
    this.playBtn = root.querySelector(`.play-btn`)
    this.skipTimeoutBtn = root.querySelector(`.timeout-skip-btn`)
    this.elapsedLabel = root.querySelector(`.time-elapsed`)
    this.totalLabel = root.querySelector(`.time-total`)
    this.speedGroup = root.querySelector(`.speeds`)
    this.povGroup = root.querySelector(`.pov`)
    this.povFree = root.querySelector(`.pov-free`)
    this.povFly = root.querySelector(`.pov-fly`)
    this.povNoclip = root.querySelector(`.pov-noclip`)
    this.mobileSpeed = root.querySelector(`.mobile-speed`)
    this.mobileSpeedValue = root.querySelector(`.speed-picker-value`)
    this.mobilePov = root.querySelector(`.mobile-pov`)
    this.mobileEvents = root.querySelector(`.mobile-events`)
    this.mobileScoreboard = root.querySelector(`.mobile-scoreboard`)

    this.playBtn.addEventListener(`click`, () => this.callbacks.onPlayPause())
    this.skipTimeoutBtn.addEventListener(`click`, () => {
      let endTime = Number(this.skipTimeoutBtn.dataset.endTime)
      if (Number.isFinite(endTime)) this.callbacks.onSeek(endTime)
    })

    for (let btn of root.querySelectorAll(`.skip-btn`)) {
      let seconds = Number(btn.dataset.skip)
      btn.addEventListener(`click`, () => this.callbacks.onSkip(seconds))
    }

    // 主时间线滑块
    this.slider.addEventListener(`input`, () => {
      if (this.dragPointerId < 0) { this.scrubbing = true; this.seekFromControl(this.slider.valueAsNumber) }
    })
    this.slider.addEventListener(`change`, () => { this.scrubbing = false; this.callbacks.onSeek(this.slider.valueAsNumber) })

    this.timeline.addEventListener(`pointerdown`, this.onTimelinePointerDown)
    if (typeof ResizeObserver < `u`) {
      this.chapterResize = new ResizeObserver(() => {
        if (Math.abs(this.timeline.getBoundingClientRect().width - this.chapterTrackWidth) >= 1) this.renderChapters()
      })
      this.chapterResize.observe(this.timeline)
    }
    this.slider.addEventListener(`keydown`, () => this.timeline.classList.remove(`timeline-pointer-focus`))
    this.slider.addEventListener(`blur`, () => this.timeline.classList.remove(`timeline-pointer-focus`))
    this.timeline.addEventListener(`pointermove`, this.onTimelinePointerMove)
    this.timeline.addEventListener(`pointerup`, this.onTimelinePointerEnd)
    this.timeline.addEventListener(`pointercancel`, this.onTimelinePointerEnd)

    // 速度按钮 + 移动端下拉
    let speedGroup = this.speedGroup
    speedGroup.style.setProperty(`--count`, String(SPEED_OPTIONS.length))
    for (let speed of SPEED_OPTIONS) {
      let btn = document.createElement(`button`)
      btn.type = `button`
      btn.className = `ctrl-btn speed-btn`
      btn.textContent = `${speed}×`
      btn.dataset.speed = String(speed)
      btn.title = `Playback speed ${speed}×`
      btn.addEventListener(`click`, () => this.callbacks.onSpeed(speed))
      this.speedButtons.push(btn)
      speedGroup.appendChild(btn)
      let option = document.createElement(`option`)
      option.value = String(speed)
      option.textContent = `${speed}×`
      this.mobileSpeed.appendChild(option)
    }
    this.setSpeed(1)
    this.mobileSpeed.addEventListener(`change`, () => this.callbacks.onSpeed(Number(this.mobileSpeed.value)))
    this.mobilePov.addEventListener(`change`, () => {
      this.mobilePov.value === `free` ? this.callbacks.onSelectFree() : this.callbacks.onSelectPlayer(Number(this.mobilePov.value))
    })
    this.mobileEvents.addEventListener(`click`, () => this.callbacks.onToggleEvents())
    this.mobileScoreboard.addEventListener(`click`, () => this.callbacks.onToggleScoreboard())
    this.povFree.addEventListener(`click`, () => this.callbacks.onSelectFree())
    this.povFly.addEventListener(`click`, () => this.callbacks.onSelectFly())
    this.povNoclip.addEventListener(`click`, () => this.callbacks.onSelectNoclip())
    root.addEventListener(`click`, (e) => {
      let btn = e.target instanceof Element ? e.target.closest(`button`) : null
      if (btn && e.detail > 0) btn.blur()
    })
    this.setViewMode(`free`)
  }

  setTimelineMarkers(roundFractions, timeouts, majorEvents = []) {
    this.timeoutMarkers = timeouts
    this.majorEvents = majorEvents
    this.markers.innerHTML = ``
    for (let fraction of roundFractions) {
      if (fraction <= 0) continue
      let marker = document.createElement(`div`)
      marker.className = `timeline-marker`
      marker.style.left = `${(fraction * 100).toFixed(2)}%`
      this.markers.appendChild(marker)
    }
    this.renderChapters()
  }

  setTime(time) {
    if (!this.scrubbing) { this.slider.valueAsNumber = time; this.updateFill(); this.updateTimeLabels() }
  }

  get isScrubbing() { return this.scrubbing }

  setDuration(duration) {
    this.duration = Math.max(0, duration)
    this.slider.max = String(this.duration)
    this.updateFill()
    this.updateTimeLabels()
  }

  setRoundLoadState(roundRanges, parsedRounds, loadedDuration) {
    this.roundRanges = roundRanges
    this.parsedRounds = parsedRounds
    this.loadedDuration = Math.max(0, Math.min(this.duration, loadedDuration))
    this.renderChapters()
    if (this.slider.valueAsNumber > this.loadedDuration) this.slider.valueAsNumber = this.loadedDuration
    this.slider.setAttribute(`aria-valuetext`, `${formatClock(this.slider.valueAsNumber)} loaded through ${formatClock(this.loadedDuration)}`)
    this.updateFill()
  }

  // 渲染时间线章节分段（回合 + 暂停）
  renderChapters() {
    let segments = this.roundRanges.length > 0
      ? this.roundRanges
      : this.timeoutMarkers.length > 0
        ? [{ startFraction: 0, endFraction: 1 }]
        : []
    let loadedRounds = this.roundRanges.length > 0 ? this.parsedRounds : segments.length
    this.roundLoadState.innerHTML = ``
    this.timeline.classList.toggle(`timeline-segmented`, segments.length > 0)
    if (segments.length === 0) return

    let technical = this.timeoutMarkers.filter((t) => timeoutKind(t) === `technical`)
    let teamTimeouts = this.timeoutMarkers.filter((t) => timeoutKind(t) !== `technical`)
    let chapters = mergeChapters(segments, technical, MIN_CHAPTER_WIDTH)
    this.chapterTrackWidth = this.timeline.getBoundingClientRect().width
    this.widenShortTimeouts(chapters, this.chapterTrackWidth)

    for (let chapter of chapters) {
      let el = document.createElement(`div`)
      let loadState = chapter.round < loadedRounds ? `loaded` : chapter.round === loadedRounds ? `loading` : `pending`
      let duration = Math.max(0, chapter.end - chapter.start)
      if (chapter.timeout) {
        el.className = `timeline-round-segment timeline-timeout-segment timeline-timeout-${timeoutKind(chapter.timeout)}`
        el.classList.toggle(`is-pending`, loadState !== `loaded`)
        el.title = `${timeoutLabel(chapter.timeout)} · ${formatClock(duration * this.duration)} · skippable`
      } else {
        el.className = `timeline-round-segment timeline-round-${loadState}`
        el.title = `Round ${chapter.round + 1}: ${loadState}`
        this.markTeamTimeouts(el, chapter, teamTimeouts)
      }
      el.dataset.round = String(chapter.round)
      positionChapter(el, chapter)
      this.roundLoadState.appendChild(el)
    }
  }

  markTeamTimeouts(el, chapter, teamTimeouts) {
    let left = chapter.left ?? chapter.start
    let span = Math.max(1e-9, (chapter.right ?? chapter.end) - left)
    for (let timeout of teamTimeouts) {
      let start = Math.max(chapter.start, timeout.fraction)
      let end = Math.min(chapter.end, timeout.endFraction)
      if (end <= start) continue
      let mark = document.createElement(`span`)
      mark.className = `timeline-round-timeout timeline-timeout-${timeoutKind(timeout)}`
      mark.style.left = `${((start - left) / span) * 100}%`
      mark.style.width = `${((end - start) / span) * 100}%`
      el.appendChild(mark)
      el.title += ` · ${timeoutLabel(timeout)} ${formatClock((timeout.endFraction - timeout.fraction) * this.duration)}`
    }
  }

  // 太窄的暂停分段向两侧"借"宽度，保证可见
  widenShortTimeouts(chapters, trackWidth) {
    if (trackWidth <= 0) return
    let minWidth = MIN_PX / trackWidth
    let minRoundWidth = 4 / trackWidth
    for (let c of chapters) { c.left = c.start; c.right = c.end }
    let spare = (c, side, x) => {
      if (!c || c.timeout) return 0
      let edge = side === `left` ? c.right : c.left
      return Math.abs(edge - x) > 1e-9 ? 0 : Math.max(0, c.right - c.left - minRoundWidth)
    }
    chapters.forEach((c, idx) => {
      let deficit = minWidth - (c.right - c.left)
      if (!c.timeout || deficit <= 0) return
      let prev = chapters[idx - 1]
      let next = chapters[idx + 1]
      let prevSpare = spare(prev, c.left, `left`)
      let nextSpare = spare(next, c.right, `right`)
      let takeLeft = Math.min(deficit / 2, prevSpare)
      let takeRight = Math.min(deficit - takeLeft, nextSpare)
      takeLeft = Math.min(deficit - takeRight, prevSpare)
      if (prev && takeLeft > 0) prev.right -= takeLeft
      if (next && takeRight > 0) next.left += takeRight
      c.left -= takeLeft
      c.right += takeRight
    })
  }

  onTimelinePointerDown = (e) => {
    if (e.pointerType === `mouse` && e.button !== 0) return
    if (e.target instanceof HTMLElement && e.target.closest(`button`)) return
    e.preventDefault()
    this.timeline.classList.add(`timeline-pointer-focus`)
    this.slider.focus({ preventScroll: true })
    this.dragPointerId = e.pointerId
    this.dragStartY = e.clientY
    this.roundDragIndex = -1
    this.scrubbing = true
    this.timeline.classList.add(`timeline-dragging`)
    this.timeline.setPointerCapture(e.pointerId)
    this.seekMainPointer(e.clientX)
  }

  onTimelinePointerMove = (e) => {
    if (e.pointerId !== this.dragPointerId) return
    e.preventDefault()
    if (this.roundDragIndex < 0 && this.dragStartY - e.clientY >= ROUND_DRAG_THRESHOLD) this.beginRoundDrag(e.clientX)
    if (this.roundDragIndex >= 0) this.seekRoundPointer(e.clientX)
    else this.seekMainPointer(e.clientX)
  }

  onTimelinePointerEnd = (e) => {
    if (e.pointerId !== this.dragPointerId) return
    e.preventDefault()
    if (this.timeline.hasPointerCapture(e.pointerId)) this.timeline.releasePointerCapture(e.pointerId)
    this.dragPointerId = -1
    this.roundDragIndex = -1
    this.hideRoundTimeline()
    this.timeline.classList.remove(`timeline-dragging`)
    this.timeline.classList.remove(`timeline-round-scrubbing`)
    this.scrubbing = false
    this.callbacks.onSeek(this.slider.valueAsNumber)
  }

  seekMainPointer(clientX) {
    let rect = this.timeline.getBoundingClientRect()
    let fraction = rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0
    this.seekFromControl(fraction * this.duration)
    this.updateScrubHint(clientX - rect.left)
  }

  updateScrubHint(x) {
    if (!this.timeline.classList.contains(`timeline-scrub-hint-enabled`)) return
    let round = this.roundIndexAt(this.slider.valueAsNumber)
    this.timeline.classList.toggle(`timeline-scrub-hint-ready`, round >= 0)
    if (round < 0) return
    let text = `Slide up to scrub round ${round + 1}`
    if (this.scrubHintLabel.textContent !== text) this.scrubHintLabel.textContent = text
    this.timeline.style.setProperty(`--scrub-hint-x`, `${x}px`)
  }

  roundIndexAt(time) {
    return this.roundRanges.findIndex((range, idx) => {
      let start = range.startFraction * this.duration
      let end = range.endFraction * this.duration
      return time >= start && (time < end || idx === this.roundRanges.length - 1)
    })
  }

  beginRoundDrag(clientX) {
    let time = this.slider.valueAsNumber
    let round = this.roundIndexAt(time)
    if (round < 0) return
    let range = this.roundRanges[round]
    this.roundDragIndex = round
    this.roundDragStartX = clientX
    this.roundDragStartTime = time
    window.clearTimeout(this.roundTimelineHideTimer)
    this.roundTimeline.classList.remove(`is-hiding`)
    this.roundTimeline.hidden = false
    this.positionRoundTimeline(range)
    this.renderRoundScrubber(range, round)
    this.timeline.classList.add(`timeline-round-scrubbing`)
    for (let el of this.roundLoadState.querySelectorAll(`.timeline-round-segment`))
      el.classList.toggle(`is-zoomed`, el.dataset.round === String(round))
    if (this.timeline.classList.contains(`timeline-scrub-hint-enabled`)) {
      this.timeline.classList.remove(`timeline-scrub-hint-enabled`)
      markScrubHintSeen()
    }
    this.updateRoundTimeline()
  }

  hideRoundTimeline() {
    if (this.roundTimeline.hidden) return
    this.roundTimeline.classList.add(`is-hiding`)
    window.clearTimeout(this.roundTimelineHideTimer)
    this.roundTimelineHideTimer = window.setTimeout(() => {
      this.roundTimeline.hidden = true
      this.roundTimeline.classList.remove(`is-hiding`)
      this.roundTimelineHideTimer = 0
    }, ROUND_TIMELINE_HIDE_MS)
  }

  seekRoundPointer(clientX) {
    let range = this.roundRanges[this.roundDragIndex]
    if (!range) return
    let [min, max] = this.roundScrubBounds(range)
    let span = Math.max(0, max - min)
    let stageWidth = Math.max(1, this.roundTimelineStage.getBoundingClientRect().width)
    let time = this.roundDragStartTime + ((clientX - this.roundDragStartX) / stageWidth) * span
    this.seekFromControl(Math.max(min, Math.min(max, time)))
    this.updateRoundTimeline()
  }

  positionRoundTimeline(range) {
    let trackWidth = this.timeline.getBoundingClientRect().width
    let width = Math.min(trackWidth, 600, Math.max(360, trackWidth * 0.55))
    let leftFrac = range.startFraction * trackWidth
    let rightFrac = range.endFraction * trackWidth
    let center = (leftFrac + rightFrac) * 0.5
    let left = Math.max(0, Math.min(trackWidth - width, center - width * 0.5))
    this.roundTimeline.style.left = `${left}px`
    this.roundTimeline.style.width = `${width}px`
    this.roundTimeline.style.setProperty(`--zoom-l`, `${leftFrac - left}px`)
    this.roundTimeline.style.setProperty(`--zoom-r`, `${rightFrac - left}px`)
    this.roundTimeline.style.setProperty(`--zoom-origin`, `${center - left}px`)
  }

  renderRoundScrubber(range, round) {
    this.roundTimelineTitle.textContent = `Round ${round + 1}`
    this.roundTimelineTrack.innerHTML = ``
    this.roundTimelineEvents.innerHTML = ``
    this.roundCaptionKey = null
    let startTime = range.startFraction * this.duration
    let endTime = range.endFraction * this.duration
    let span = Math.max(0.01, endTime - startTime)
    let fractionSpan = Math.max(1e-9, range.endFraction - range.startFraction)
    let stageWidth = Math.max(1, this.roundTimelineStage.offsetWidth || this.roundTimelineStage.getBoundingClientRect().width)
    let toFrac = (t) => clamp01((t - range.startFraction) / fractionSpan)
    let chapters = mergeChapters([range], this.timeoutMarkers, ROUND_MIN_CHAPTER * fractionSpan)
      .map((c) => ({ ...c, start: toFrac(c.start), end: toFrac(c.end) }))
      .filter((c) => c.end - c.start > 1e-6)
    this.widenShortTimeouts(chapters, stageWidth)

    // 暂停分段
    for (let chapter of chapters) {
      if (!chapter.timeout) continue
      let kind = timeoutKind(chapter.timeout)
      let left = chapter.left ?? chapter.start
      let right = chapter.right ?? chapter.end
      let el = document.createElement(`div`)
      el.className = `round-timeline-timeout timeline-timeout-${kind}`
      el.style.left = `${left * 100}%`
      el.style.width = `${(right - left) * 100}%`
      if ((right - left) * stageWidth >= ROUND_TIMEOUT_LABEL_PX) el.textContent = kind === `technical` ? `Pause` : `Timeout`
      this.roundTimelineTrack.appendChild(el)
    }

    // 主要事件圆点
    this.roundScrubEvents = this.majorEvents.filter((e) => e.time >= startTime && e.time < endTime).sort((a, b) => a.time - b.time)
    let positions = resolveEventPositions(this.roundScrubEvents.map((e) => ((e.time - startTime) / span) * stageWidth), stageWidth)
    this.roundDiscs = this.roundScrubEvents.map((event, idx) => {
      let disc = document.createElement(`span`)
      disc.className = `round-timeline-event round-timeline-event-${event.team} round-timeline-event-${event.kind}`
      disc.style.left = `${(positions[idx] / stageWidth) * 100}%`
      if (event.iconUrl) disc.style.setProperty(`--event-icon`, `url(${event.iconUrl})`)
      this.roundTimelineEvents.appendChild(disc)
      return disc
    })
  }

  seekFromControl(time) {
    this.slider.valueAsNumber = Math.max(0, Math.min(this.loadedDuration, time))
    this.updateFill()
    this.updateTimeLabels()
    this.callbacks.onSeek(this.slider.valueAsNumber)
  }

  updateRoundTimeline() {
    let range = this.roundRanges[this.roundDragIndex]
    if (!range) return
    let startTime = range.startFraction * this.duration
    let span = Math.max(0.01, range.endFraction * this.duration - startTime)
    let time = this.slider.valueAsNumber
    let progress = clamp01((time - startTime) / span)
    this.roundTimelineStage.style.setProperty(`--progress`, String(progress))
    let clock = `${formatClock(time - startTime)}<span class="round-timeline-clock-total"> / ${formatClock(span)}</span>`
    if (this.roundTimelineClock.innerHTML !== clock) this.roundTimelineClock.innerHTML = clock

    let timeout = this.timeoutMarkers.find((t) => time >= t.fraction * this.duration && time < t.endFraction * this.duration)
    let status = timeout ? timeoutLabel(timeout) : ``
    if (this.roundTimelineStatus.textContent !== status) {
      this.roundTimelineStatus.textContent = status
      this.roundTimelineStatus.hidden = !timeout
      this.roundTimelineCaption.hidden = !!timeout
      this.roundTimelineStatus.className = timeout ? `round-timeline-status timeline-timeout-${timeoutKind(timeout)}` : `round-timeline-status`
    }

    let latest = -1
    while (latest + 1 < this.roundScrubEvents.length && this.roundScrubEvents[latest + 1].time <= time) latest++
    this.roundDiscs.forEach((disc, idx) => {
      disc.classList.toggle(`is-past`, idx <= latest)
      disc.classList.toggle(`is-latest`, idx === latest)
    })
    this.renderRoundCaption(this.roundScrubEvents[latest])
  }

  renderRoundCaption(event) {
    let key = event ? `${event.time}|${event.title}` : ``
    if (key === this.roundCaptionKey) return
    this.roundCaptionKey = key
    this.roundTimelineCaption.classList.toggle(`is-empty`, !event)
    if (event) {
      if (event.kind === `kill` && event.actor && event.target)
        this.roundTimelineCaption.innerHTML = `${nameSpan(event.actor, event.team)} killed ${nameSpan(event.target, event.targetTeam)}`
      else this.roundTimelineCaption.textContent = event.title
    } else this.roundTimelineCaption.textContent = `No kills yet`
  }

  roundScrubBounds(range) {
    let start = range.startFraction * this.duration
    let end = Math.min(range.endFraction * this.duration, this.loadedDuration)
    return end - start <= ROUND_EDGE_PADDING * 2 ? [start, end] : [start + ROUND_EDGE_PADDING, end - ROUND_EDGE_PADDING]
  }

  updateFill() {
    let fraction = this.duration > 0 ? clamp01(this.slider.valueAsNumber / this.duration) : 0
    this.slider.style.setProperty(`--fill`, `${fraction * 100}%`)
    this.timeline.style.setProperty(`--fill`, `${fraction * 100}%`)
    this.timeline.style.setProperty(`--fill-n`, String(fraction))
  }

  updateTimeLabels() {
    let elapsed = formatClock(this.slider.valueAsNumber)
    let total = formatClock(this.duration)
    if (this.elapsedLabel.textContent !== elapsed) this.elapsedLabel.textContent = elapsed
    if (this.totalLabel.textContent !== total) this.totalLabel.textContent = total
  }

  setPlaying(playing) {
    if (playing !== this.playing) {
      this.playing = playing
      this.playBtn.classList.toggle(`is-playing`, playing)
      this.playBtn.setAttribute(`aria-label`, playing ? `Pause` : `Play`)
      this.playBtn.title = playing ? `Pause (Space)` : `Play (Space)`
    }
  }

  get element() { return this.root }

  setSpeed(speed) {
    if (speed !== this.currentSpeed) {
      this.currentSpeed = speed
      this.mobileSpeed.value = String(speed)
      this.mobileSpeedValue.textContent = `${speed}×`
      for (let btn of this.speedButtons) {
        let active = Number(btn.dataset.speed) === speed
        btn.classList.toggle(`active`, active)
        btn.setAttribute(`aria-pressed`, String(active))
      }
      this.speedGroup.style.setProperty(`--index`, String(SPEED_OPTIONS.indexOf(speed)))
    }
  }

  setViewMode(mode) {
    if (mode !== `player`) this.mobilePov.value = mode
    if (mode !== this.currentViewMode) {
      this.currentViewMode = mode
      this.povFree.classList.toggle(`active`, mode === `free`)
      this.povFly.classList.toggle(`active`, mode === `fly`)
      this.povNoclip.classList.toggle(`active`, mode === `noclip`)
      this.povGroup.style.setProperty(`--index`, String(VIEW_MODES.indexOf(mode)))
    }
  }

  setPlayers(players, followedSlot) {
    let valid = new Set(players.map((p) => p.slot))
    for (let [slot, option] of this.playerOptions) {
      if (!valid.has(slot)) { option.remove(); this.playerOptions.delete(slot) }
    }
    for (let player of players) {
      let option = this.playerOptions.get(player.slot)
      if (!option) {
        option = document.createElement(`option`)
        option.value = String(player.slot)
        this.playerOptions.set(player.slot, option)
        this.mobilePov.appendChild(option)
      }
      let label = `${player.name}${player.alive ? `` : ` (dead)`}`
      if (option.textContent !== label) option.textContent = label
      if (option.disabled === player.alive) option.disabled = !player.alive
    }
    if (followedSlot >= 0) this.mobilePov.value = String(followedSlot)
  }

  setMobilePanels(feedOpen, scoreboardOpen) {
    this.mobileEvents.setAttribute(`aria-expanded`, String(feedOpen))
    this.mobileScoreboard.setAttribute(`aria-expanded`, String(scoreboardOpen))
  }

  setHudAvailability(feedAvailable, scoreboardAvailable) {
    this.mobileEvents.disabled = !feedAvailable
    this.mobileScoreboard.disabled = !scoreboardAvailable
  }

  setTimeoutEnd(time) {
    this.skipTimeoutBtn.hidden = time === null
    if (time === null) delete this.skipTimeoutBtn.dataset.endTime
    else this.skipTimeoutBtn.dataset.endTime = String(time)
  }

  dispose() {
    this.chapterResize?.disconnect()
    window.clearTimeout(this.roundTimelineHideTimer)
    if (this.dragPointerId >= 0 && this.timeline.hasPointerCapture(this.dragPointerId)) this.timeline.releasePointerCapture(this.dragPointerId)
    this.timeline.classList.remove(`timeline-dragging`)
    this.root.remove()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────────────────────
function clamp01(v) { return Math.max(0, Math.min(1, v)) }
function formatClock(seconds) { let t = Math.max(0, Math.floor(seconds)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, `0`)}` }
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` })[c]) }
function nameSpan(name, team) { return `<span class="round-timeline-name${team ? ` round-timeline-name-${team}` : ``}">${escapeHtml(name)}</span>` }

// 事件圆点防重叠布局
function resolveEventPositions(positions, trackWidth) {
  let out = []
  let minGap = EVENT_MIN_GAP / 2
  let maxX = Math.max(minGap, trackWidth - EVENT_MIN_GAP / 2)
  let cursor = minGap
  let i = 0
  while (i < positions.length) {
    let end = i
    while (end + 1 < positions.length && positions[end + 1] - positions[end] < EVENT_MIN_GAP) end++
    let group = []
    for (let j = i; j <= end; j++) group.push(j === i ? positions[j] : Math.max(positions[j], group[group.length - 1] + EVENT_MIN_STEP))
    let halfShift = (group[group.length - 1] - positions[end]) / 2
    let groupWidth = group[group.length - 1] - group[0]
    let start = Math.max(cursor, Math.min(group[0] - halfShift, maxX - groupWidth))
    for (let p of group) out.push(start + p - group[0])
    cursor = start + groupWidth + EVENT_MIN_GAP
    i = end + 1
  }
  return out
}

function timeoutKind(timeout) { return timeout.technical ? `technical` : (timeout.side ?? `technical`) }
function timeoutLabel(timeout) { let kind = timeoutKind(timeout); return kind === `technical` ? `Technical pause` : `${kind.toUpperCase()} timeout` }

// 合并回合与暂停为互不重叠的章节序列
function mergeChapters(roundRanges, timeouts, minWidth) {
  let timeoutSpans = []
  for (let timeout of [...timeouts].sort((a, b) => a.fraction - b.fraction)) {
    let start = clamp01(timeout.fraction)
    let end = clamp01(Math.max(timeout.fraction, timeout.endFraction))
    if (end <= start) continue
    let last = timeoutSpans.at(-1)
    if (last && start <= last.end) last.end = Math.max(last.end, end)
    else timeoutSpans.push({ start, end, timeout })
  }
  let roundAt = (t) => {
    let idx = roundRanges.findIndex((r) => t >= r.startFraction && t < r.endFraction)
    return idx >= 0 ? idx : roundRanges.length - 1
  }
  let chapters = []
  roundRanges.forEach((range, round) => {
    let cursor = Math.max(0, range.startFraction)
    for (let span of timeoutSpans) {
      if (span.end <= cursor || span.start >= range.endFraction) continue
      if (span.start > cursor) chapters.push({ start: cursor, end: span.start, round })
      cursor = Math.max(cursor, span.end)
    }
    if (range.endFraction > cursor) chapters.push({ start: cursor, end: range.endFraction, round })
  })
  for (let span of timeoutSpans) chapters.push({ start: span.start, end: span.end, round: roundAt(span.start), timeout: span.timeout })
  chapters.sort((a, b) => a.start - b.start)
  // 合并过短的章节到相邻暂停
  for (let i = 0; i < chapters.length; i++) {
    let chapter = chapters[i]
    if (chapter.timeout || chapter.end - chapter.start >= minWidth) continue
    let prev = chapters[i - 1]
    let next = chapters[i + 1]
    if (next?.timeout && Math.abs(next.start - chapter.end) < 1e-9) next.start = chapter.start
    else if (prev?.timeout && Math.abs(prev.end - chapter.start) < 1e-9) prev.end = chapter.end
    else continue
    chapters.splice(i--, 1)
  }
  return chapters
}

function positionChapter(el, chapter) {
  let left = chapter.left ?? chapter.start
  let right = chapter.right ?? chapter.end
  el.style.left = `${left * 100}%`
  el.style.width = `${Math.max(0, right - left) * 100}%`
  el.style.setProperty(`--seg-start`, String(chapter.start))
  el.style.setProperty(`--seg-width`, String(Math.max(1e-6, chapter.end - chapter.start)))
}

function scrubHintSeen() {
  try { return typeof localStorage < `u` && localStorage.getItem(SCRUB_HINT_KEY) === `1` } catch { return false }
}
function markScrubHintSeen() {
  try { if (typeof localStorage < `u`) localStorage.setItem(SCRUB_HINT_KEY, `1`) } catch {}
}

// ────────────────────────────────────────────────────────────────────────────
// 二、ControlsAutoHide —— 控制条自动隐藏
//     触摸设备上，空闲一段时间后自动隐藏控制条；点按画面切换显隐。
// ────────────────────────────────────────────────────────────────────────────
const AUTO_HIDE_DELAY = 3000   // 空闲隐藏延迟
const TAP_MOVE_TOLERANCE = 10  // 点击位移容差
const TAP_TIME_TOLERANCE = 350 // 点击时长容差
const DEFERRED_TAP_DELAY = 300 // 延迟点击判定

class ControlsAutoHide {
  container
  surface
  controls
  media
  releaseTarget
  delayMs
  deferTaps
  surfacePointers = new Set()
  enabled = false
  visible = true
  paused = false
  held = false
  tap = null
  hideTimer
  tapTimer

  constructor(options) {
    this.container = options.container
    this.surface = options.surface
    this.controls = options.controls
    this.media = options.media
    this.releaseTarget = options.releaseTarget ?? globalThis
    this.delayMs = options.delayMs ?? AUTO_HIDE_DELAY
    this.deferTaps = options.deferTaps ?? (() => false)
    this.surface.addEventListener(`pointerdown`, this.onSurfaceDown)
    this.surface.addEventListener(`pointerup`, this.onSurfaceUp)
    this.surface.addEventListener(`pointercancel`, this.onSurfaceCancel)
    this.controls.addEventListener(`pointerdown`, this.onControlsDown)
    for (let ev of [`click`, `input`, `change`, `keydown`]) this.controls.addEventListener(ev, this.onControlsActivity)
    this.releaseTarget.addEventListener(`pointerup`, this.onRelease)
    this.releaseTarget.addEventListener(`pointercancel`, this.onRelease)
    this.media.addEventListener(`change`, this.onMediaChange)
    this.onMediaChange()
  }

  get hidden() { return this.enabled && !this.visible }
  show() { this.visible = true; this.apply(); this.scheduleHide() }
  hide() { this.clearHideTimer(); this.visible = false; this.apply() }
  setPaused(paused) { if (paused !== this.paused) { this.paused = paused; paused ? this.clearHideTimer() : this.scheduleHide() } }

  dispose() {
    this.clearHideTimer(); this.clearTapTimer()
    this.surface.removeEventListener(`pointerdown`, this.onSurfaceDown)
    this.surface.removeEventListener(`pointerup`, this.onSurfaceUp)
    this.surface.removeEventListener(`pointercancel`, this.onSurfaceCancel)
    this.controls.removeEventListener(`pointerdown`, this.onControlsDown)
    for (let ev of [`click`, `input`, `change`, `keydown`]) this.controls.removeEventListener(ev, this.onControlsActivity)
    this.releaseTarget.removeEventListener(`pointerup`, this.onRelease)
    this.releaseTarget.removeEventListener(`pointercancel`, this.onRelease)
    this.media.removeEventListener(`change`, this.onMediaChange)
    delete this.container.dataset.controlsHidden
  }

  onMediaChange = () => { this.enabled = this.media.matches; this.held = false; this.tap = null; this.clearTapTimer(); this.surfacePointers.clear(); this.show() }

  onSurfaceDown = (e) => {
    this.surfacePointers.add(e.pointerId)
    this.tap = this.enabled && this.surfacePointers.size === 1 && e.button === 0
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp }
      : null
  }

  onSurfaceUp = (e) => {
    this.surfacePointers.delete(e.pointerId)
    let tap = this.tap
    this.tap = null
    if (this.enabled && tap && tap.id === e.pointerId && !(Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_MOVE_TOLERANCE || e.timeStamp - tap.time > TAP_TIME_TOLERANCE)) {
      if (!this.deferTaps()) { this.toggle(); return }
      if (this.tapTimer !== undefined) { this.clearTapTimer(); return }
      this.tapTimer = setTimeout(() => { this.tapTimer = undefined; this.toggle() }, DEFERRED_TAP_DELAY)
    }
  }

  toggle() { this.visible ? this.hide() : this.show() }
  clearTapTimer() { if (this.tapTimer !== undefined) { clearTimeout(this.tapTimer); this.tapTimer = undefined } }
  onSurfaceCancel = (e) => { this.surfacePointers.delete(e.pointerId); this.tap = null }
  onControlsDown = () => { if (this.enabled) { this.held = true; this.clearHideTimer() } }
  onControlsActivity = () => { if (this.enabled && this.visible) this.scheduleHide() }
  onRelease = () => { if (this.held) { this.held = false; this.scheduleHide() } }

  scheduleHide() {
    this.clearHideTimer()
    if (this.enabled && this.visible && !this.paused && !this.held)
      this.hideTimer = setTimeout(() => { this.hideTimer = undefined; this.hide() }, this.delayMs)
  }
  clearHideTimer() { if (this.hideTimer !== undefined) { clearTimeout(this.hideTimer); this.hideTimer = undefined } }
  apply() { if (this.hidden) this.container.dataset.controlsHidden = `true`; else delete this.container.dataset.controlsHidden }
}

// ────────────────────────────────────────────────────────────────────────────
// 三、PovPicker —— POV 下拉选择器
// ────────────────────────────────────────────────────────────────────────────
const POV_PICKER_CUBE = `<svg class="pov-picker-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l7.6 4.3v9L12 20.8l-7.6-4.3v-9zM4.4 7.5L12 11.8l7.6-4.3M12 11.8v9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`
const POV_PICKER_CHEVRON = `<svg class="pov-picker-chevron" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 6l3-3 3 3M2 10l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const VIEW_MODE_LABELS = { free: `Free`, fly: `Fly`, noclip: `Noclip` }
const POV_SIDE_GROUPS = [{ side: `t`, label: `T` }, { side: `ct`, label: `CT` }, { side: null, label: `Other` }]

class PovPicker {
  element
  select
  badge
  label
  keyboardOption
  signature = ``
  shown = ``

  constructor(container, callbacks) {
    let root = document.createElement(`label`)
    root.className = `pov-picker`
    root.innerHTML = `
      <span class="pov-picker-badge" aria-hidden="true"></span>
      <span class="pov-picker-label" aria-hidden="true"></span>
      ${POV_PICKER_CHEVRON}
      <select class="pov-picker-select" aria-label="Camera"></select>
    `
    container.appendChild(root)
    this.element = root
    this.select = root.querySelector(`.pov-picker-select`)
    this.badge = root.querySelector(`.pov-picker-badge`)
    this.label = root.querySelector(`.pov-picker-label`)
    this.keyboardOption = document.createElement(`option`)
    this.keyboardOption.value = `keyboard`
    this.keyboardOption.disabled = true
    this.keyboardOption.hidden = true
    this.select.addEventListener(`change`, () => {
      let value = this.select.value
      if (value === `free`) callbacks.onSelectFree()
      else if (value !== `keyboard`) callbacks.onSelectPlayer(Number(value))
    })
  }

  update(players, followedSlot, mode) {
    let signature = players.map((p) => `${p.slot}:${p.side}:${+!!p.alive}:${p.name}`).join(`|`)
    if (signature !== this.signature) { this.signature = signature; this.renderOptions(players); this.shown = `` }
    let selected = mode === `player` ? players.find((p) => p.slot === followedSlot) : undefined
    let value = selected ? String(selected.slot) : (mode === `player` || mode === `free` ? `free` : `keyboard`)
    let side = selected?.side ?? ``
    let name = selected ? selected.name : VIEW_MODE_LABELS[mode === `player` ? `free` : mode]
    let shown = `${value}|${side}|${name}`
    if (shown !== this.shown) {
      this.shown = shown
      this.select.value = value
      this.label.textContent = name
      this.element.dataset.side = side || `none`
      this.element.dataset.view = selected ? `player` : `free`
      this.badge.innerHTML = selected ? `` : POV_PICKER_CUBE
    }
  }

  renderOptions(players) {
    let freeOption = document.createElement(`option`)
    freeOption.value = `free`
    freeOption.textContent = `Free camera`
    let options = [freeOption, this.keyboardOption]
    for (let { side, label } of POV_SIDE_GROUPS) {
      let group = players.filter((p) => p.side === side)
      if (group.length === 0) continue
      let optgroup = document.createElement(`optgroup`)
      optgroup.label = label
      for (let player of group) {
        let option = document.createElement(`option`)
        option.value = String(player.slot)
        option.textContent = player.alive ? player.name : `${player.name} (dead)`
        option.disabled = !player.alive
        optgroup.appendChild(option)
      }
      options.push(optgroup)
    }
    this.select.replaceChildren(...options)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 四、BlindOverlay —— 闪光致盲遮罩
// ────────────────────────────────────────────────────────────────────────────
class BlindOverlay {
  element
  indicator
  opacity = 0

  constructor(container) {
    this.element = document.createElement(`div`)
    this.element.className = `blind-overlay`
    this.element.hidden = true
    container.appendChild(this.element)
    this.indicator = document.createElement(`div`)
    this.indicator.className = `blind-indicator`
    this.indicator.hidden = true
    this.indicator.setAttribute(`role`, `status`)
    container.appendChild(this.indicator)
  }

  // remaining: 剩余致盲时间；amount: 致盲强度（0-1）；mode: full/indicator/reduced
  update(remaining, amount, xray, mode = `full`) {
    let strength = zk(remaining, amount)   // 计算实际致盲强度
    this.indicator.hidden = mode === `full` || strength <= 0
    if (!this.indicator.hidden) this.indicator.textContent = `Blinded ${Math.round(strength * 100)}% · ${remaining.toFixed(1)}s`
    let opacity = mode === `indicator` ? 0 : mode === `reduced` ? Math.min(0.35, strength) : xray ? strength : Math.min(0.72, strength)
    if (opacity !== this.opacity) {
      this.opacity = opacity
      this.element.hidden = opacity <= 0
      this.element.style.opacity = String(opacity)
    }
  }
  hide() { this.update(0, 0, true) }
  dispose() { this.element.remove(); this.indicator.remove() }
}

// ────────────────────────────────────────────────────────────────────────────
// 五、Crosshair —— 准星（Canvas 绘制）
//     支持 CS2 准星参数：颜色/长度/粗细/间隙/中心点/描边/T 型。
// ────────────────────────────────────────────────────────────────────────────
const CROSSHAIR_SCALE = 4      // 准星参数到像素的缩放
const CROSSHAIR_BASE_GAP = 10  // 基础间隙
const CROSSHAIR_GAP_SCALE = 2
const CROSSHAIR_CANVAS = 160

class Crosshair {
  canvas
  ctx
  current = null
  shown = false

  constructor(container) {
    this.canvas = document.createElement(`canvas`)
    this.canvas.className = `crosshair-overlay`
    container.appendChild(this.canvas)
    let ctx = this.canvas.getContext(`2d`)
    if (!ctx) throw Error(`Crosshair: 2D canvas context unavailable`)
    this.ctx = ctx
    this.canvas.style.display = `none`
  }

  show(crosshair) {
    this.shown ||= (this.canvas.style.display = `block`, true)
    if (crosshair !== this.current) { this.current = crosshair; this.draw(crosshair) }
  }
  hide() { this.shown &&= (this.canvas.style.display = `none`, false) }
  dispose() { this.canvas.remove() }

  draw(crosshair) {
    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = CROSSHAIR_CANVAS * dpr
    this.canvas.height = CROSSHAIR_CANVAS * dpr
    this.canvas.style.width = `${CROSSHAIR_CANVAS}px`
    this.canvas.style.height = `${CROSSHAIR_CANVAS}px`
    let ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, CROSSHAIR_CANVAS, CROSSHAIR_CANVAS)

    let cx = CROSSHAIR_CANVAS / 2
    let cy = CROSSHAIR_CANVAS / 2
    let [r, g, b] = hexToRgb(crosshair.color)
    let alpha = (crosshair.alphaEnabled ? crosshair.alpha : 255) / 255
    let length = Math.max(1, Math.round(crosshair.length * CROSSHAIR_SCALE))
    let thickness = Math.max(1, Math.round(crosshair.thickness * CROSSHAIR_SCALE))
    let gap = Math.max(0, Math.round(CROSSHAIR_BASE_GAP + crosshair.gap * CROSSHAIR_GAP_SCALE))
    let outline = crosshair.outlineEnabled ? Math.max(1, Math.round(crosshair.outline)) : 0
    let half = Math.floor(thickness / 2)

    // 四个方向的线条（上/左/右，下可选）
    let bars = [
      [cx + gap, cy - half, length, thickness],          // 右
      [cx - gap - length, cy - half, length, thickness], // 左
      [cx - half, cy + gap, thickness, length],          // 下
    ]
    if (crosshair.tStyleEnabled) bars.push([cx - half, cy - gap - length, thickness, length])  // 上

    // 描边（黑色底）
    if (outline > 0) {
      ctx.fillStyle = `rgba(0,0,0,${alpha})`
      for (let [x, y, w, h] of bars) ctx.fillRect(x - outline, y - outline, w + 2 * outline, h + 2 * outline)
      if (crosshair.centerDotEnabled) ctx.fillRect(cx - half - outline, cy - half - outline, thickness + 2 * outline, thickness + 2 * outline)
    }
    // 主线条
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
    for (let [x, y, w, h] of bars) ctx.fillRect(x, y, w, h)
    if (crosshair.centerDotEnabled) ctx.fillRect(cx - half, cy - half, thickness, thickness)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 六、DamageIndicator —— 受击红屏
//     最近受到伤害时，按伤害量显示红色屏幕边缘提示。
// ────────────────────────────────────────────────────────────────────────────
const DAMAGE_FADE_RATIO = 0.6   // 伤害指示淡出时间相对 tickRate 的比例

class DamageIndicator {
  element
  opacity = 0

  constructor(container) {
    this.element = document.createElement(`div`)
    this.element.className = `damage-overlay`
    this.element.setAttribute(`aria-hidden`, `true`)
    this.element.hidden = true
    container.appendChild(this.element)
  }

  update(damageData, followedSlot, tick, tickRate) {
    if (followedSlot < 0) { this.hide(); return }
    let windowTicks = DAMAGE_FADE_RATIO * tickRate
    let maxOpacity = 0
    // 从最近的伤害事件向前回溯
    for (let i = upperBound(damageData.tick, damageData.count, tick) - 1; i >= 0; i--) {
      let age = tick - damageData.tick[i]
      if (age > windowTicks) break
      if (damageData.victimSlot[i] !== followedSlot) continue
      let fade = 1 - age / windowTicks
      let intensity = Math.min(1, 0.65 + damageData.dmg[i] / 100)
      maxOpacity = Math.max(maxOpacity, fade * intensity)
    }
    this.setOpacity(maxOpacity)
  }

  hide() { this.setOpacity(0) }
  dispose() { this.element.remove() }
  setOpacity(opacity) {
    if (opacity !== this.opacity) {
      this.opacity = opacity
      this.element.hidden = opacity <= 0
      this.element.style.opacity = String(opacity)
    }
  }
}

// 二分查找第一个 tick > target 的索引
function upperBound(ticks, count, target) {
  let lo = 0, hi = count
  while (lo < hi) { let mid = (lo + hi) >>> 1; ticks[mid] <= target ? (lo = mid + 1) : (hi = mid) }
  return lo
}

// ────────────────────────────────────────────────────────────────────────────
// 七、击杀行渲染辅助（被 RoundFeed 引用）
// ────────────────────────────────────────────────────────────────────────────
const KILL_MODIFIERS = [
  { key: `noscope`, label: `No scope`, url: Zb(`noscope`) },
  { key: `wallbang`, label: `Wallbang`, url: Zb(`penetrate`) },
  { key: `thrusmoke`, label: `Through smoke`, url: Zb(`smoke_kill`) },
  { key: `attackerblind`, label: `Attacker blinded`, url: Zb(`blind_kill`) },
  { key: `headshot`, label: `Headshot`, url: Zb(`headshot`) },
]
const SKULL_ICON = Zb(`skull`)

function renderKillLine(kill) {
  return kill.world
    ? renderKillIcons(kill) + `<span class="kf-name" style="color:${kill.victimColor}">${escapeHtml(kill.victim)}</span>`
    : `<span class="kf-name" style="color:${kill.attackerColor}">${escapeHtml(kill.attacker)}</span>` +
        renderKillIcons(kill) +
        `<span class="kf-name" style="color:${kill.victimColor}">${escapeHtml(kill.victim)}</span>`
}

function renderKillIcons(kill) {
  if (kill.world) return killIcon(`kf-mod kf-skull`, SKULL_ICON, `World / suicide`)
  let weapon = kill.weapon ?? `Unknown weapon`
  let icon = weaponIconUrl(weapon)
  return (
    (icon ? killIcon(`kf-icon`, icon, weapon.replace(/^weapon_/, ``).replaceAll(`_`, ` `)) : `<span class="kf-weapon">${escapeHtml(weapon)}</span>`) +
    KILL_MODIFIERS.filter((m) => kill[m.key]).map((m) => killIcon(`kf-mod kf-mod-${m.key}`, m.url, m.label)).join(``)
  )
}

function killIcon(cls, url, label) {
  let safe = escapeHtml(label)
  return `<span class="${cls}" role="img" aria-label="${safe}" title="${safe}" style="-webkit-mask-image:url(${url});mask-image:url(${url})"></span>`
}
