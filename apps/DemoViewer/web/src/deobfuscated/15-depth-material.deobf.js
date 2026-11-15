// ============================================================================
// 反混淆版本：深度预处理（DepthPrepass）
// 原始压缩文件：src/app/15-depth-material.js
// 原文范围：decompiled/index.beautified.js L39080–39174（切片 15-depth-material）
// 压缩类名：HD
// 说明：csdemo.tv 的自定义深度预渲染通道。作用是在主渲染之前，把场景中所有
//   不透明、写深度的物体用"简化深度材质"重画一遍，得到深度缓冲，供后续
//   特效（爆炸冲击波、火焰遮挡、辉光等）做"被几何体遮挡"的判断。
//   核心技巧：
//     - 用 colorWrite:false 的廉价材质替换原材质，避免重复跑光照着色
//     - 对 alphaTest 物体（如树叶、铁丝网）单独缓存带贴图的深度材质
//     - 临时关闭阴影/背景/自动清屏，渲染到指定 render target 后恢复现场
// ============================================================================

// 深度缓冲距离参数（单位：CS2 单位，1 unit ≈ 1 英寸）
const DEPTH_NEAR = 1200;   // UD：近平面
const DEPTH_FAR = 9000;    // WD：远平面
const DEPTH_BIAS = 300;    // GD：阴影偏移相关

// 各画质档对应的阴影贴图分辨率
const SHADOW_MAP_SIZE = { low: 1024, medium: 2048, high: 4096, ultra: 8192 }; // KD

class DepthPrepass {
  shared = new Map();          // 按渲染面（side）缓存的共享深度材质
  alphaTested = new WeakMap(); // 按原材质缓存的 alphaTest 深度材质
  groupDepths = new WeakMap(); // 材质数组 → 深度材质数组缓存
  skipped = new MeshDepthMaterial({ visible: false }); // 占位"跳过"材质
  meshes = [];      // 本轮收集到的 mesh
  originals = [];   // 对应原材质
  depths = [];      // 对应深度材质
  hidden = [];      // 需要临时隐藏的非 mesh 对象（点/线/精灵）

  /**
   * 执行一次深度预渲染：把场景里所有写深度的不透明物体用深度材质画到 target
   * @param {WebGLRenderer} renderer
   * @param {Object3D} root 场景根节点
   * @param {Camera} camera
   * @param {RenderTarget} target 深度输出目标
   */
  render(renderer, root, camera, target) {
    root.traverseVisible((obj) => this.collect(obj, true));
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevShadowMap = renderer.shadowMap.enabled;
    const prevBackground = root.background;

    try {
      this.swap(); // 换成深度材质
      for (const obj of this.hidden) obj.visible = false;
      renderer.shadowMap.enabled = false;   // 关闭阴影
      root.background = null;               // 去掉背景
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.clear(true, true, false);    // 只清深度/颜色，不清模板
      renderer.render(root, camera);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      renderer.shadowMap.enabled = prevShadowMap;
      root.background = prevBackground;
      this.restore();
    }
  }

  /**
   * 异步编译（预热着色器）：提前把深度材质编译好，避免首帧卡顿
   */
  compileAsync(renderer, root, camera, target) {
    root.traverse((obj) => this.collect(obj, false));
    try {
      this.swap();
      return renderer.compileAsync(root, camera, target); // 原 VD
    } finally {
      this.restore();
    }
  }

  /**
   * 为单个材质（或材质数组）生成对应的深度材质
   * 返回 null 表示该物体不参与深度（透明/不写深度/不可见）
   */
  depthMaterialFor(material) {
    // 数组：逐个处理，全部为 null 则返回 null
    if (Array.isArray(material)) {
      let list = this.groupDepths.get(material);
      if (!list) this.groupDepths.set(material, (list = []));
      list.length = material.length;
      let any = false;
      for (let i = 0; i < material.length; i++) {
        const m = this.depthMaterialFor(material[i]);
        list[i] = m ?? this.skipped;
        any ||= m !== null;
      }
      return any ? list : null;
    }

    // 不可见 / 透明 / 不写深度的物体跳过
    if (!material.visible || material.transparent || !material.depthWrite) return null;

    // 用户自定义深度材质优先
    const custom = material.userData.depthMaterial;
    if (custom instanceof MeshDepthMaterial) return custom;

    // alphaTest 材质（有 alpha 贴图裁剪）：需要带贴图的深度材质
    const map = material.map;
    if (material.alphaTest > 0 && map) {
      let m = this.alphaTested.get(material);
      if (!m) {
        m = new MeshDepthMaterial({ colorWrite: false });
        material.addEventListener(`dispose`, () => m.dispose());
        this.alphaTested.set(material, m);
      }
      m.map = map;
      m.alphaTest = material.alphaTest;
      m.side = material.side;
      return m;
    }

    // 普通不透明：用按 side 缓存的共享深度材质
    return this.sharedFor(material.side);
  }

  dispose() {
    for (const m of this.shared.values()) m.dispose();
    this.shared.clear();
    this.skipped.dispose();
  }

  /** 收集需要深度渲染的对象 */
  collect(obj, hideNonMesh) {
    if (obj.isMesh) {
      const depthMat = this.depthMaterialFor(obj.material);
      if (depthMat) {
        this.meshes.push(obj);
        this.originals.push(obj.material);
        this.depths.push(depthMat);
      } else if (hideNonMesh) {
        this.hidden.push(obj);
      }
    } else if (hideNonMesh && (obj.isPoints || obj.isLine || obj.isSprite)) {
      this.hidden.push(obj); // 点/线/精灵不参与深度，先隐藏
    }
  }

  /** 把所有 mesh 的材质替换成深度材质 */
  swap() {
    for (let i = 0; i < this.meshes.length; i++)
      this.meshes[i].material = this.depths[i];
  }

  /** 恢复原材质与可见性 */
  restore() {
    for (let i = 0; i < this.meshes.length; i++)
      this.meshes[i].material = this.originals[i];
    for (const obj of this.hidden) obj.visible = true;
    this.meshes.length = 0;
    this.originals.length = 0;
    this.depths.length = 0;
    this.hidden.length = 0;
  }

  /** 按渲染面（FrontSide/BackSide/DoubleSide）缓存共享深度材质 */
  sharedFor(side) {
    let m = this.shared.get(side);
    if (!m) {
      m = new MeshDepthMaterial({ side, colorWrite: false });
      this.shared.set(side, m);
    }
    return m;
  }
}
