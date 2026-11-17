// =============================================================================
// player/index.js —— 播放器入口（M1：渲染地基）
//
// 目标：不接任何 demo 数据，只验证三件事——
//   1. three.js vendor 模块能加载（压缩名映射正确）
//   2. 相机系统（CameraController）自由视角能操作
//   3. DemoApp 将来挂载所需的最小场景壳（renderer / scene / resize / RAF）成立
//
// 环境还原：scene-environment.js 按原版 qD（SceneRenderer）classic 模式还原
//   背景天空/大气雾/穹顶/太阳/光照/ACES 色调映射——与 csdemo.tv 低配模式一致。
//
// 用法（M1 临时验证入口）：
//   window.__playerDev.open()   // 在 webapp 里打开 3D 视口
//   window.__playerDev.close()  // 关闭
// =============================================================================
import {
  Scene,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  LineSegments,
  LineBasicMaterial,
} from './vendor/three-bundle.js';
import { CameraController } from './camera-controller.js';
import { SceneEnvironment } from './scene-environment.js';
import { updateInteriorLights } from './map-classified.js';

const GRID_HALF = 1200;   // 网格半径（世界单位，Dust2 约 4000×4000）
const GRID_STEP = 200;    // 网格间距

/** 地面参考网格 + 三色坐标轴（不依赖 GridHelper/AxesHelper，避免再引入未映射符号） */
function buildGrid() {
  const points = [];
  const colors = [];

  for (let i = -GRID_HALF; i <= GRID_HALF; i += GRID_STEP) {
    const dim = i === 0 ? 1 : 0.35;      // 过原点的两条线亮一点
    // 平行于 X 的线
    points.push(-GRID_HALF, i, 0, GRID_HALF, i, 0);
    // 平行于 Y 的线
    points.push(i, -GRID_HALF, 0, i, GRID_HALF, 0);
    for (let k = 0; k < 4; k++) colors.push(dim, dim, dim);
  }

  // 坐标轴：X 红、Y 绿、Z 蓝（长度 600）
  const axis = [
    [600, 0, 0, 0.9, 0.2, 0.2],
    [0, 600, 0, 0.2, 0.8, 0.2],
    [0, 0, 600, 0.25, 0.45, 0.95],
  ];
  for (const [x, y, z, r, g, b] of axis) {
    points.push(0, 0, 0, x, y, z);
    colors.push(r, g, b, r, g, b);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  const material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
  return new LineSegments(geometry, material);
}

/**
 * 创建播放器实例（M1 版本：空场景 + 原版大气环境）。
 * @param {HTMLElement} container 挂载容器（会被清空并铺满 canvas）
 * @param {{grid?: boolean}} [options] grid=false 时不加调试参考网格（进图观感用）
 */
export function createPlayer(container, { grid: withGrid = true } = {}) {
  const scene = new Scene();
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  // 原版大气环境（背景/雾/穹顶/太阳/半球光/ACES）——替代早先的深色占位背景
  const environment = new SceneEnvironment(scene, renderer);

  const camera = new CameraController(renderer.domElement, container.clientWidth / container.clientHeight, 0);

  const grid = withGrid ? buildGrid() : null;
  if (grid) scene.add(grid);

  // 初始机位：俯视原点
  camera.frameScene({ x: 0, y: 0, z: 0 }, 1600);

  let running = true;
  let paused = false;
  let last = performance.now();
  const interiorLights = []; // 当前地图的室内灯（loadMapGeometry 后填充）
  const frameHooks = [];      // 每帧回调（CS2 渲染器的 PVS/剔除等）

  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.resize(w / h);
  };
  window.addEventListener('resize', onResize);

  const frame = (now) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) {
      camera.update(null, dt);
      environment.update(camera.camera); // 穹顶跟相机 + 太阳摆位（原版 render() 前置逻辑）
      if (interiorLights.length > 0) {
        // 只点亮最近 20 盏室内灯（原版 MapLoader.updateInteriorLights）
        updateInteriorLights(camera.camera.position, interiorLights);
      }
      for (const hook of frameHooks) hook(camera.camera, dt);
      renderer.render(scene, camera.camera);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    scene,
    renderer,
    camera,
    environment,
    interiorLights,
    frameHooks,
    /** 供 M2 起的子系统往场景里加东西 */
    add(obj) { scene.add(obj); },
    /** 暂停渲染（观看界面退出后省电；resume 后继续） */
    setPaused(v) { paused = !!v; last = performance.now(); },
    dispose() {
      running = false;
      window.removeEventListener('resize', onResize);
      camera.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
