// ============================================================================
// 25-team-logos.deobf.js —— 开镜遮罩 + 队伍 Logo 徽章处理
// 来源：src/app/25-team-logos.js（Vite 生产构建，prettier 展开版）
// 原始标识符已语义化重命名 + 补充中文注释。
//
// 包含：
//   ScopeOverlay  oM  —— 狙击镜/步枪开镜的屏幕遮罩与十字准线（Canvas 绘制）
//   TeamLogo 处理      —— 队伍 Logo 的色调检测（白/黑/亮/彩色）、描边、主题切换
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 一、ScopeOverlay —— 开镜遮罩
//     狙击镜：径向渐变暗角遮罩 + 十字线（带景深模糊过渡）
//     步枪：模糊边缘 + 圆点准星
// ────────────────────────────────────────────────────────────────────────────
const SCOPE_MIN_ALPHA = 128   // 描边检测的 alpha 阈值

class ScopeOverlay {
  canvas       // 暗角遮罩画布
  ctx
  reticle      // 十字线画布
  reticleCtx
  rifleBlur    // 步枪模糊边缘 div
  rifleReticle // 步枪准星 div
  blur = -1
  transitionBlur = -1
  lastTime = null
  viewKey = ``
  w = 0
  h = 0
  dpr = 0

  constructor(container) {
    this.canvas = document.createElement(`canvas`)
    this.canvas.className = `scope-overlay scope-sniper`
    this.canvas.setAttribute(`aria-hidden`, `true`)
    container.appendChild(this.canvas)
    let ctx = this.canvas.getContext(`2d`)
    if (!ctx) throw Error(`ScopeOverlay: 2D canvas context unavailable`)
    this.ctx = ctx

    this.reticle = document.createElement(`canvas`)
    this.reticle.className = `scope-overlay scope-sniper scope-sniper-reticle`
    this.reticle.setAttribute(`aria-hidden`, `true`)
    container.appendChild(this.reticle)
    let reticleCtx = this.reticle.getContext(`2d`)
    if (!reticleCtx) throw Error(`ScopeOverlay: reticle 2D canvas context unavailable`)
    this.reticleCtx = reticleCtx

    this.rifleBlur = document.createElement(`div`)
    this.rifleBlur.className = `scope-overlay scope-rifle-blur`
    this.rifleBlur.setAttribute(`aria-hidden`, `true`)
    container.appendChild(this.rifleBlur)

    this.rifleReticle = document.createElement(`div`)
    this.rifleReticle.className = `scope-overlay scope-rifle-reticle`
    this.rifleReticle.setAttribute(`aria-hidden`, `true`)
    this.rifleReticle.innerHTML = `<div class="scope-rifle-lens"></div><div class="scope-rifle-dot"></div>`
    container.appendChild(this.rifleReticle)
  }

  // zoom > 0 表示开镜；weapon 决定是狙击还是步枪
  show(zoom, weapon, speed = 0, accuracyPenalty = -1, duck = 0, frame) {
    let isRifle = weaponScopeType(weapon) === `rifle`
    this.canvas.classList.toggle(`is-active`, !isRifle)
    this.reticle.classList.toggle(`is-active`, !isRifle)
    this.rifleBlur.classList.toggle(`is-active`, isRifle)
    this.rifleReticle.classList.toggle(`is-active`, isRifle)
    if (isRifle) { this.resetReticleTransition(); return }

    let w = window.innerWidth
    let h = window.innerHeight
    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    let resized = w !== this.w || h !== this.h || dpr !== this.dpr
    if (resized) { this.w = w; this.h = h; this.dpr = dpr; this.drawMask(w, h) }

    let targetBlur = computeScopeBlur(weapon, zoom, speed, accuracyPenalty, duck, h)
    let viewKey = `${frame?.slot ?? -1}:${weapon}:${zoom}`
    let jumped = this.lastTime === null || (frame && (frame.time < this.lastTime || frame.time - this.lastTime > 0.5))

    // 景深模糊的平滑过渡（指数衰减逼近目标值）
    if (!frame || resized || this.transitionBlur < 0 || viewKey !== this.viewKey || jumped) {
      this.transitionBlur = targetBlur
    } else if (frame.dt > 0) {
      this.transitionBlur += (targetBlur - this.transitionBlur) * (1 - Math.exp(-frame.dt / SCOPE_BLUR_TIME_CONSTANT))
      if (Math.abs(targetBlur - this.transitionBlur) < 1 / 256) this.transitionBlur = targetBlur
    }
    this.viewKey = viewKey
    this.lastTime = frame?.time ?? null

    let quantized = Math.round(this.transitionBlur * 64) / 64
    if (resized || quantized !== this.blur) { this.blur = quantized; this.drawReticle(w, h, quantized) }
  }

  hide() {
    this.resetReticleTransition()
    this.canvas.classList.remove(`is-active`)
    this.reticle.classList.remove(`is-active`)
    this.rifleBlur.classList.remove(`is-active`)
    this.rifleReticle.classList.remove(`is-active`)
  }

  resetReticleTransition() { this.transitionBlur = -1; this.lastTime = null; this.viewKey = `` }
  dispose() { this.canvas.remove(); this.reticle.remove(); this.rifleBlur.remove(); this.rifleReticle.remove() }

  prepareCanvas(canvas, ctx, w, h) {
    let dpr = this.dpr
    let pw = Math.floor(w * dpr)
    let ph = Math.floor(h * dpr)
    if (canvas.width !== pw) canvas.width = pw
    if (canvas.height !== ph) canvas.height = ph
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
  }

  // 径向渐变暗角遮罩
  drawMask(w, h) {
    let ctx = this.ctx
    this.prepareCanvas(this.canvas, ctx, w, h)
    let cx = w / 2
    let cy = h / 2
    let radius = Math.min(w, h) * SCOPE_MASK_RADIUS
    let feather = Math.min(w, h) * 0.008
    let grad = ctx.createRadialGradient(cx, cy, radius - feather, cx, cy, radius + feather)
    grad.addColorStop(0, `rgba(0,0,0,0)`)
    grad.addColorStop(0.5, `rgba(0,0,0,0.45)`)
    grad.addColorStop(1, `#000`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  // 十字线（带 blur 模拟景深）
  drawReticle(w, h, blur) {
    let ctx = this.reticleCtx
    this.prepareCanvas(this.reticle, ctx, w, h)
    let cx = w / 2
    let cy = h / 2
    let alpha = 0.85
    ctx.lineWidth = 2 + blur
    ctx.filter = blur > 0 ? `blur(${blur * this.dpr}px)` : `none`
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`
    ctx.beginPath()
    ctx.moveTo(0, cy); ctx.lineTo(w, cy)
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(0,0,0,${alpha})`
    ctx.fill()
    ctx.filter = `none`
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 二、队伍 Logo 徽章处理
//     检测 logo 的色调（白/黑/亮/彩色），对"亮色" logo 生成描边变体，
//     以适配明暗主题，并监听主题切换动态换图。
// ────────────────────────────────────────────────────────────────────────────
const LOGO_ALPHA_THRESHOLD = 128        // 检测 alpha 阈值
const LOGO_OUTLINE_COLOR = [29, 29, 31, 0.92]  // 描边颜色（RGBA，深灰）
const LOGO_MAX_DIM = 192                // 描边处理时的最大尺寸
const LOGO_OUTLINE_RATIO = 0.028        // 描边宽度比例

// 检测 logo 是否为"亮色"（需要在暗色背景加描边）
function isBrightLogo(pixels, width, height) {
  let colored = 0
  let bright = 0
  let sample = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : pixels[(y * width + x) * 4 + 3])
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let idx = (y * width + x) * 4
      if (pixels[idx + 3] < LOGO_ALPHA_THRESHOLD) continue
      // 只统计边缘像素（四周至少一个透明像素）
      if (sample(x - 1, y) >= LOGO_ALPHA_THRESHOLD && sample(x + 1, y) >= LOGO_ALPHA_THRESHOLD && sample(x, y - 1) >= LOGO_ALPHA_THRESHOLD && sample(x, y + 1) >= LOGO_ALPHA_THRESHOLD) continue
      colored++
      if (relativeLuminance(pixels[idx], pixels[idx + 1], pixels[idx + 2]) <= 0.3) bright++
    }
  return colored > 0 && bright / colored >= 0.6
}

// 在透明 logo 边缘生成描边（向外膨胀 alpha 并混色）
function applyOutline(pixels, width, height, radius, color) {
  let radiusCeil = Math.ceil(radius + 1)
  let kernel = []
  for (let dy = -radiusCeil; dy <= radiusCeil; dy++)
    for (let dx = -radiusCeil; dx <= radiusCeil; dx++) {
      let weight = Math.min(1, Math.max(0, radius + 1 - Math.hypot(dx, dy)))
      if (weight > 0) kernel.push({ dx, dy, weight })
    }
  let alpha = new Float32Array(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3] / 255
  let [r, g, b, a] = color
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let idx = y * width + x
      let base = alpha[idx]
      if (base >= 1) continue
      // 在邻域找最大 alpha（作为描边强度）
      let maxAlpha = 0
      for (let { dx, dy, weight } of kernel) {
        let nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        let a = alpha[ny * width + nx] * weight
        if (a > maxAlpha) { maxAlpha = a; if (maxAlpha >= 1) break }
      }
      let amount = maxAlpha * a
      if (amount <= 0) continue
      let newAlpha = base + amount * (1 - base)
      let out = idx * 4
      let blend = amount * (1 - base)
      pixels[out] = (pixels[out] * base + r * blend) / newAlpha
      pixels[out + 1] = (pixels[out + 1] * base + g * blend) / newAlpha
      pixels[out + 2] = (pixels[out + 2] * base + b * blend) / newAlpha
      pixels[out + 3] = newAlpha * 255
    }
}

// 计算 logo 内容到画布边缘的最小距离（用于决定描边 padding）
function contentInset(pixels, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (pixels[(y * width + x) * 4 + 3] >= 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
  return maxX < 0 ? Math.min(width, height) : Math.min(minX, minY, width - 1 - maxX, height - 1 - maxY)
}

// 相对亮度（ITU-R BT.709），用于色调检测
function relativeLuminance(r, g, b) { return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b) }
function srgbToLinear(c) { let t = c / 255; return t <= 0.04045 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4 }

const logoInspectionCache = new Map()   // url → Promise<inspection>
const logoResultCache = new Map()       // url → 检测结果
const LOGO_PENDING_TIMEOUT = 1500

// 生成带描边的 logo（用于亮色 logo 的暗色背景适配）
function createHostedLogo(url, name, extraClass, options = {}) {
  let root = document.createElement(`span`)
  root.className = `hosted-logo ${extraClass}`
  let fallback = document.createElement(`span`)
  fallback.className = `hosted-logo-fallback`
  fallback.textContent = options.fallbackText ?? initialsFromName(name)
  root.appendChild(fallback)

  if (url) {
    let img = document.createElement(`img`)
    img.alt = `${name} logo`
    img.decoding = `async`
    img.hidden = true
    root.classList.add(`pending`)
    let timeout = setTimeout(() => root.classList.remove(`pending`), LOGO_PENDING_TIMEOUT)
    let outlined = false
    let cachedResult = options.invertWhite ? logoResultCache.get(url) : undefined
    if (cachedResult) { outlined = true; applyLogoVariant(img, url, cachedResult) }
    if (!img.getAttribute(`src`)) img.src = url
    let onReady = (animate) => {
      clearTimeout(timeout)
      if (animate && img.hidden) root.classList.add(`fade-in`)
      img.hidden = false
      root.classList.remove(`pending`)
      root.classList.add(`loaded`)
    }
    img.addEventListener(`load`, () => {
      onReady(true)
      // 首次加载且需要反白时，检测色调并生成描边变体
      if (options.invertWhite && !outlined) {
        outlined = true
        inspectLogo(url).then((result) => applyLogoVariant(img, url, result)).catch((e) => {
          console.warn(`[csplayer] emblem tone detection failed for ${name}:`, e)
        })
      }
    })
    img.addEventListener(`error`, () => {
      clearTimeout(timeout)
      root.classList.remove(`pending`)
      console.warn(`[csplayer] logo failed for ${name}:`, url)
      img.remove()
    })
    root.appendChild(img)
    if (img.complete && img.naturalWidth > 0) onReady(false)
  }
  return root
}

function applyLogoVariant(img, url, { tone, lightSrc }) {
  if (tone === `white') img.classList.add(`logo-white`)
  else if (tone === `black`) img.classList.add(`logo-black`)
  else if (tone === `bright` && lightSrc) {
    img.classList.add(`logo-bright`)
    img.dataset.darkSrc = url
    img.dataset.lightSrc = lightSrc
    initThemeObserver()
    applyThemeLogo(img)
  }
}

// 检测 logo 色调：white / black / bright / color
function inspectLogo(url) {
  let cached = logoInspectionCache.get(url)
  if (cached) return cached
  let promise = (async () => {
    let resp = await fetch(url, { mode: `cors`, cache: `reload` })
    if (!resp.ok) throw Error(`Logo inspection failed (HTTP ${resp.status})`)
    let bitmap = await createImageBitmap(await resp.blob())
    try {
      let canvas = document.createElement(`canvas`)
      canvas.width = canvas.height = 64
      let ctx = canvas.getContext(`2d`, { willReadFrequently: true })
      if (!ctx) throw Error(`Canvas pixel inspection is unavailable`)
      ctx.drawImage(bitmap, 0, 0, 64, 64)
      let tone = detectTone(ctx.getImageData(0, 0, 64, 64).data)
      if (tone !== `bright`) return { tone }
      let lightSrc = await generateOutlinedLogo(bitmap)
      return lightSrc ? { tone, lightSrc } : { tone: `color` }
    } finally {
      bitmap.close()
    }
  })()
    .then((result) => (logoResultCache.set(url, result), result))
    .catch((e) => { logoInspectionCache.delete(url); throw e })
  logoInspectionCache.set(url, promise)
  return promise
}

// 生成描边变体（返回 blob URL）
async function generateOutlinedLogo(bitmap) {
  let scale = Math.min(1, LOGO_MAX_DIM / Math.max(bitmap.width, bitmap.height))
  let w = Math.max(1, Math.round(bitmap.width * scale))
  let h = Math.max(1, Math.round(bitmap.height * scale))
  let outlineRadius = Math.max(1.5, Math.max(w, h) * LOGO_OUTLINE_RATIO)
  let canvas = document.createElement(`canvas`)
  canvas.width = w
  canvas.height = h
  let ctx = canvas.getContext(`2d`, { willReadFrequently: true })
  if (!ctx) throw Error(`Canvas pixel inspection is unavailable`)
  ctx.drawImage(bitmap, 0, 0, w, h)
  let pixels = ctx.getImageData(0, 0, w, h).data
  if (isBrightLogo(pixels, w, h)) return undefined
  let padding = Math.max(0, Math.ceil(outlineRadius + 1) - contentInset(pixels, w, h))
  let outCanvas = document.createElement(`canvas`)
  outCanvas.width = w + padding * 2
  outCanvas.height = h + padding * 2
  let outCtx = outCanvas.getContext(`2d`, { willReadFrequently: true })
  if (!outCtx) throw Error(`Canvas pixel inspection is unavailable`)
  outCtx.drawImage(bitmap, padding, padding, w, h)
  let outData = outCtx.getImageData(0, 0, outCanvas.width, outCanvas.height)
  applyOutline(outData.data, outCanvas.width, outCanvas.height, outlineRadius, LOGO_OUTLINE_COLOR)
  outCtx.putImageData(outData, 0, 0)
  let blob = await new Promise((resolve) => outCanvas.toBlob(resolve, `image/png`))
  if (!blob) throw Error(`Could not encode the outlined emblem`)
  return URL.createObjectURL(blob)
}

// 根据当前主题选择亮/暗变体
function applyThemeLogo(img) {
  let src = document.documentElement.dataset.theme === `dark` ? img.dataset.darkSrc : img.dataset.lightSrc
  if (src && img.getAttribute(`src`) !== src) img.src = src
}

let themeObserver
function initThemeObserver() {
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => {
      for (let img of document.querySelectorAll(`img.logo-bright`)) applyThemeLogo(img)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: [`data-theme`] })
  }
}

// 从队伍名提取首字母（最多 2 个）
function initialsFromName(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join(``).toUpperCase() || `?`
}

// 色调检测三连：白 / 黑 / 亮
function detectTone(pixels) { return isWhiteLogo(pixels) ? `white` : isBlackLogo(pixels) ? `black` : isBrightLogoFull(pixels) ? `bright` : `color` }
function isWhiteLogo(pixels) {
  let hasPixel = false
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 32) continue
    hasPixel = true
    if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) return false
  }
  return hasPixel
}
function isBrightLogoFull(pixels) {
  let total = 0
  let bright = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 32) continue
    total++
    if (1.05 / (relativeLuminance(pixels[i], pixels[i + 1], pixels[i + 2]) + 0.05) < 1.5) bright++
  }
  return total > 0 && bright / total >= 0.5
}
function isBlackLogo(pixels) {
  let total = 0
  let dark = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 32) continue
    let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) return false
    total++
    if (Math.max(r, g, b) < 80) dark++
  }
  return total > 0 && dark / total >= 0.6
}
