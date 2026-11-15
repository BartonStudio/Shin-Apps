// ─────────────────────────────────────────────────────────────────────────────
// 来源：https://csdemo.tv/assets/index-E0opA-yG.js（Vite 生产构建，prettier 展开版）
// 位置：decompiled/index.beautified.js 第 39080–39174 行（切片 22/40）
// 角色：深度材质/深度预处理 HD：render/depthMaterialFor/compileAsync
// 说明：原文逐字切片，标识符保留压缩后的名字；仅做换行/缩进美化，未改语义。
// ─────────────────────────────────────────────────────────────────────────────
var HD = class {
    shared = new Map()
    alphaTested = new WeakMap()
    groupDepths = new WeakMap()
    skipped = new Ao({ visible: !1 })
    meshes = []
    originals = []
    depths = []
    hidden = []
    render(e, t, n, r) {
      t.traverseVisible((e) => this.collect(e, !0))
      let i = e.getRenderTarget(),
        a = e.autoClear,
        o = e.shadowMap.enabled,
        s = t.background
      try {
        this.swap()
        for (let e of this.hidden) e.visible = !1
        ;((e.shadowMap.enabled = !1),
          (t.background = null),
          (e.autoClear = !1),
          e.setRenderTarget(r),
          e.clear(!0, !0, !1),
          e.render(t, n))
      } finally {
        ;(e.setRenderTarget(i), (e.autoClear = a), (e.shadowMap.enabled = o), (t.background = s), this.restore())
      }
    }
    compileAsync(e, t, n, r) {
      t.traverse((e) => this.collect(e, !1))
      try {
        return (this.swap(), VD(e, t, n, r))
      } finally {
        this.restore()
      }
    }
    depthMaterialFor(e) {
      if (Array.isArray(e)) {
        let t = this.groupDepths.get(e)
        ;(t || this.groupDepths.set(e, (t = [])), (t.length = e.length))
        let n = !1
        for (let r = 0; r < e.length; r++) {
          let i = this.depthMaterialFor(e[r])
          ;((t[r] = i ?? this.skipped), (n ||= i !== null))
        }
        return n ? t : null
      }
      if (!e.visible || e.transparent || !e.depthWrite) return null
      let t = e.userData.depthMaterial
      if (t instanceof Kr) return t
      let n = e.map
      if (e.alphaTest > 0 && n) {
        let t = this.alphaTested.get(e)
        return (
          t ||
            ((t = new Ao({ colorWrite: !1 })),
            e.addEventListener(`dispose`, () => t.dispose()),
            this.alphaTested.set(e, t)),
          (t.map = n),
          (t.alphaTest = e.alphaTest),
          (t.side = e.side),
          t
        )
      }
      return this.sharedFor(e.side)
    }
    dispose() {
      for (let e of this.shared.values()) e.dispose()
      ;(this.shared.clear(), this.skipped.dispose())
    }
    collect(e, t) {
      let n = e
      if (n.isMesh) {
        let r = this.depthMaterialFor(n.material)
        r ? (this.meshes.push(n), this.originals.push(n.material), this.depths.push(r)) : t && this.hidden.push(e)
      } else t && (e.isPoints || e.isLine || e.isSprite) && this.hidden.push(e)
    }
    swap() {
      for (let e = 0; e < this.meshes.length; e++) this.meshes[e].material = this.depths[e]
    }
    restore() {
      for (let e = 0; e < this.meshes.length; e++) this.meshes[e].material = this.originals[e]
      for (let e of this.hidden) e.visible = !0
      ;((this.meshes.length = 0), (this.originals.length = 0), (this.depths.length = 0), (this.hidden.length = 0))
    }
    sharedFor(e) {
      let t = this.shared.get(e)
      return (t || ((t = new Ao({ side: e, colorWrite: !1 })), this.shared.set(e, t)), t)
    }
  },
  UD = 1200,
  WD = 9e3,
  GD = 300,
  KD = { low: 1024, medium: 2048, high: 4096, ultra: 8192 }
Rn.DEFAULT_UP.set(0, 0, 1)
