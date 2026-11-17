// =============================================================================
// player/dev.js —— 开发调试入口（仅 dev 构建挂载）
//
// 控制台调用：
//   __playerDev.open()                打开 3D 视口（空场景，可操作相机）
//   __playerDev.loadMap('de_mirage')  加载地图（v1 分类管线 + CS2 环境）
//   __playerDev.loadCs2Map('de_nuke') 加载地图（CS2 完整渲染管线）
// 生产播放流程走 main.js → player/world.js；本文件只做调试包装。
// =============================================================================
import { openWorld } from './world.js';

let useCs2Environment = true; // 原版默认：桌面 GPU 走 CS2 模式（环境接管）
let world = null;

export function installPlayerDev() {
  window.__playerDev = {
    open() {
      world ??= openWorld();
      return world.player;
    },

    /** v1 分类管线（collision GLB → worker 着色），环境优先 CS2 manifest */
    async loadMap(name = 'de_mirage') {
      world ??= openWorld();
      return world.load(name, { engine: 'v1', cs2Environment: useCs2Environment });
    },

    /** CS2 完整管线：几何 chunk + BCn 纹理 + 烘焙光照 + 探针 + 天空 + PVS + LUT */
    async loadCs2Map(name = 'de_mirage') {
      world ??= openWorld();
      const info = await world.load(name, { engine: 'cs2' });
      window.__cs2 = world.cs2; // 调试
      return info;
    },

    /** 调自由视角旋转灵敏度（1.0 = 原版默认） */
    setSensitivity(x = 1) {
      if (!world) return '视口未打开';
      world.player.camera.controls.rotateSpeed = x;
      return `rotateSpeed = ${x}`;
    },

    /** CS2 门/可动物体时间线（M2 demo 回放调用）：records = demo 物体轨迹 */
    cs2UpdateObjects(records, tick) {
      const cs2 = world?.cs2;
      if (!cs2) return 'CS2 地图未加载';
      cs2.updateObjects(records, tick);
      return `objects @tick ${tick}`;
    },

    /** CS2 环境开关（true = manifest 接管雾/天空/曝光；false = 分类表环境） */
    useCs2Env(v = true) {
      useCs2Environment = v;
      return `useCs2Environment = ${v}（下次 loadMap 生效）`;
    },

    get instance() {
      return world?.player ?? null;
    },
    get world() {
      return world;
    },
  };
}
