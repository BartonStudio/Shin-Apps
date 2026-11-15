// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 28349–28486 行（切片 4/40）
// 角色：**帧采样核心**：玩家状态输出缓冲 yg + 帧采样器 bg（SoA 相邻帧插值 + 从相邻帧求导得 speed）+ 插值工具 xg（线性）/ Sg（yaw 最短弧，按 360° 归一化）+ 播放时钟 Cg
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
function yg(e) {
  return {
    x: new Float32Array(e),
    y: new Float32Array(e),
    z: new Float32Array(e),
    yaw: new Float32Array(e),
    pitch: new Float32Array(e),
    alive: new Uint8Array(e),
    health: new Uint8Array(e),
    team: new Uint8Array(e),
    duck: new Float32Array(e),
    flash: new Float32Array(e),
    flashAlpha: new Float32Array(e),
    zoom: new Uint8Array(e),
    accuracyPenalty: new Float32Array(e).fill(-1),
    speed: new Float32Array(e),
  }
}
var bg = class {
  data
  duration
  constructor(e) {
    this.data = e
    let { frameTick: t } = e.frames,
      { startTick: n, tickRate: r } = e.meta,
      i = t.length
    this.duration = i > 0 ? (t[i - 1] - n) / r : Math.max(0, e.meta.durationSeconds)
  }
  get numPlayers() {
    return this.data.meta.numPlayers
  }
  get numFrames() {
    return this.data.frames.frameTick.length
  }
  findFrame(e) {
    let t = this.data.frames.frameTick,
      n = this.data.meta.startTick + e * this.data.meta.tickRate,
      r = t.length
    if (r === 0 || n <= t[0]) return 0
    if (n >= t[r - 1]) return r - 1
    let i = 0,
      a = r - 1
    for (; i < a;) {
      let e = (i + a + 1) >> 1
      t[e] <= n ? (i = e) : (a = e - 1)
    }
    return i
  }
  sample(e, t) {
    let { frames: n, meta: r } = this.data,
      i = r.numPlayers,
      a = this.findFrame(e),
      o = Math.min(a + 1, this.numFrames - 1),
      s = (n.frameTick[a] - r.startTick) / r.tickRate,
      c = (n.frameTick[o] - r.startTick) / r.tickRate - s,
      l = c > 0 ? Math.min(1, Math.max(0, (e - s) / c)) : 0,
      u = a * i,
      d = o * i,
      f = a === o ? Math.max(0, a - 1) : a,
      p = o,
      m = n.frameTick[f],
      h = n.frameTick[p],
      g = (h - m) / r.tickRate,
      _ = g > 0 && g <= 2 / r.sampleRate && !this.data.rounds.some((e) => e.startTick > m && e.startTick <= h)
    for (let e = 0; e < i; e++) {
      let r = u + e,
        a = d + e
      ;((t.x[e] = xg(n.posX[r], n.posX[a], l)),
        (t.y[e] = xg(n.posY[r], n.posY[a], l)),
        (t.z[e] = xg(n.posZ[r], n.posZ[a], l)),
        (t.yaw[e] = Sg(n.yaw[r], n.yaw[a], l)),
        (t.pitch[e] = xg(n.pitch[r], n.pitch[a], l)),
        (t.duck[e] = xg(n.duck[r], n.duck[a], l)),
        (t.flash[e] = Math.max(0, xg(n.flash[r], n.flash[a], l))),
        (t.flashAlpha[e] = Math.max(0, xg(n.flashAlpha[r], n.flashAlpha[a], l))))
      let o = l < 0.5 ? r : a
      ;((t.alive[e] = n.alive[o]), (t.health[e] = n.health[o]), (t.team[e] = n.team[o]), (t.zoom[e] = n.zoom[o]))
      let s = n.accuracyPenalty?.[r] ?? -1,
        c = n.accuracyPenalty?.[a] ?? -1
      t.accuracyPenalty[e] = s >= 0 && c >= 0 && n.zoom[r] === n.zoom[a] ? xg(s, c, l) : (n.accuracyPenalty?.[o] ?? -1)
      let m = f * i + e,
        h = p * i + e
      t.speed[e] =
        _ && n.alive[m] === 1 && n.alive[h] === 1 && n.team[m] === n.team[h]
          ? Math.hypot(n.posX[h] - n.posX[m], n.posY[h] - n.posY[m]) / g
          : 0
    }
  }
}
function xg(e, t, n) {
  return e + (t - e) * n
}
function Sg(e, t, n) {
  let r = ((t - e + 180) % 360) - 180
  return (r < -180 && (r += 360), e + r * n)
}
var Cg = class {
  time = 0
  duration
  playing = !1
  speed = 1
  listeners = new Set()
  constructor(e) {
    this.duration = Math.max(0, e)
  }
  onChange(e) {
    return (this.listeners.add(e), () => this.listeners.delete(e))
  }
  emit() {
    for (let e of this.listeners) e()
  }
  play() {
    this.duration !== 0 && (this.time >= this.duration && (this.time = 0), (this.playing = !0), this.emit())
  }
  pause() {
    ;((this.playing = !1), this.emit())
  }
  toggle() {
    this.playing ? this.pause() : this.play()
  }
  setSpeed(e) {
    ;((this.speed = Math.max(0.05, e)), this.emit())
  }
  setDuration(e) {
    ;((this.duration = Math.max(0, e)), (this.time = wg(this.time, 0, this.duration)), this.emit())
  }
  seek(e) {
    ;((this.time = wg(e, 0, this.duration)), this.emit())
  }
  advance(e) {
    this.playing &&
      ((this.time += e * this.speed),
      this.time >= this.duration && ((this.time = this.duration), (this.playing = !1), this.emit()))
  }
  get progress() {
    return this.duration > 0 ? this.time / this.duration : 0
  }
}
