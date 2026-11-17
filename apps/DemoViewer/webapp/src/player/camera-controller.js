// =============================================================================
// camera-controller.js —— 播放器相机系统（自由视角 / 飞行 / 跟随 / 观战）
//
// 来源：原 bundle 的 `zf` 类（web/src/vendor/three-r184.js L25268–25445，
//       被误切进 vendor 段）。这里做了语义化改写：类名、方法名、常量名全部
//       换成可读名称，逻辑与原件逐行对应，未增删语义。
//
// 四种模式：
//   free     自由视角：OrbitControls 轨道 + 触屏双指，适合看整张地图
//   fly      飞行：FlyControls，带碰撞（撞墙停）
//   noclip   穿墙飞行：FlyControls，无碰撞
//   first    第一人称跟随某个玩家（眼位 = 位置 + 眼高 - 蹲下高度）
//   spectate 第三人称观战某个玩家（身后 180、高 90）
//
// 坐标约定（CS2）：Z 轴朝上，角度单位为「度」，内部乘 DEG 转弧度。
// =============================================================================
import {
  Vector3,
  PerspectiveCamera,
  OrbitControls,
  FlyControls,
  TouchControls,
} from './vendor/three-bundle.js';

const DEG = Math.PI / 180;

/** 玩家眼高（单位与地图一致，约等于 64 世界单位） */
const EYE_HEIGHT = 64;
/** 蹲下时眼位下降量 */
const DUCK_DROP = 18;
/** 观战视角：相机在目标身后多远、多高 */
const SPECTATE_DISTANCE = 180;
const SPECTATE_HEIGHT = 90;
/** 各倍镜档位的视场角（0 = 无镜，1 = 单倍镜，2 = 高倍镜） */
const ZOOM_FOVS = [90, 40, 20];
/** 从跟随切回自由视角时，相机落在玩家身后多远、多高 */
const FREE_FOLLOW_DISTANCE = 520;
const FREE_FOLLOW_HEIGHT = 460;

/** 默认自由视角 FOV / 飞行 FOV / 观战 FOV */
const FOV_FREE = 70;
const FOV_FLY = 90;
const FOV_SPECTATE = 75;

export class CameraController {
  camera;
  controls;
  fly;
  touch;
  /** 当前模式：{kind:'free'} | {kind:'fly'} | {kind:'noclip'} | {kind:'first',slot} | {kind:'spectate',slot} */
  mode = { kind: 'free' };
  numPlayers;

  /** 复用的临时向量（避免每帧分配） */
  forward = new Vector3();
  target = new Vector3();

  /** 被跟随玩家的最后姿态（切回自由视角时用来定位相机） */
  followPose = { x: 0, y: 0, z: 0, yaw: 0, valid: false };

  /** 视角抖动（开火后坐力 / 受击），由 DemoApp 每帧写入 */
  punchPitch = 0;
  punchYaw = 0;

  /**
   * @param {HTMLElement} domElement 接收鼠标/触摸事件的容器
   * @param {number} aspect 初始宽高比
   * @param {number} numPlayers 场上玩家数（循环切换用）
   */
  constructor(domElement, aspect, numPlayers) {
    this.numPlayers = numPlayers;
    this.camera = new PerspectiveCamera(FOV_FREE, aspect, 1, 50000);
    this.camera.position.set(0, -1500, 1500);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 4000;
    // 旋转灵敏度：1.0 = 原版 csdemo.tv 的默认值（OrbitControls 出厂值）。
    // 觉得原版手感慢/快，调这个数即可（0.5 半速，2.0 双倍速）。
    this.controls.rotateSpeed = 1.0;
    // 触屏手势交给下方的 TouchControls（自定义双指逻辑），OrbitControls 的老式触摸关掉
    this.controls.touches = { ONE: null, TWO: null };

    this.fly = new FlyControls(this.camera, domElement);
    this.touch = new TouchControls(this.camera, this.controls.target, domElement, {
      maxDistance: this.controls.maxDistance,
    });
    this.touch.setEnabled(true);
  }

  getMode() {
    return this.mode;
  }

  /** 设置视角抖动（角度制）：pitch 上下、yaw 左右 */
  setViewPunch(pitch, yaw) {
    this.punchPitch = pitch;
    this.punchYaw = yaw;
  }

  /** 当前跟随的玩家槽位；自由/飞行模式返回 -1 */
  getFollowedSlot() {
    return this.mode.kind === 'first' || this.mode.kind === 'spectate' ? this.mode.slot : -1;
  }

  getFlySpeed() {
    return this.fly.currentSpeed;
  }

  setFlyPreferences(...args) {
    this.fly.setPreferences(...args);
  }

  setCollisionObject(object) {
    this.fly.setCollisionObject(object);
  }

  /** ── 模式切换 ─────────────────────────────────────────────────────────── */

  setFree() {
    const previous = this.mode.kind;
    this.mode = { kind: 'free' };
    this.fly.disable();
    this.controls.enabled = true;
    this.touch.setEnabled(true);
    this.setFov(FOV_FREE);
    // 从第一人称/观战退出时，把相机摆到玩家身后，避免视角跳回原点
    if ((previous === 'first' || previous === 'spectate') && this.followPose.valid) {
      this.frameFollowedPlayer();
    }
  }

  setFly() {
    this.mode = { kind: 'fly' };
    this.controls.enabled = false;
    this.touch.setEnabled(false);
    this.fly.setCollisionEnabled(true);
    this.fly.enable();
    this.setFov(FOV_FLY);
  }

  /** 以指定机位进入飞行模式 */
  setFlyView(position, lookAt) {
    this.camera.position.copy(position);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(lookAt);
    this.fly.seedFromCamera();
    this.setFly();
  }

  setNoclip() {
    this.mode = { kind: 'noclip' };
    this.controls.enabled = false;
    this.touch.setEnabled(false);
    this.fly.setCollisionEnabled(false);
    this.fly.enable();
    this.setFov(FOV_FLY);
  }

  /** 第一人称跟随某个玩家槽位 */
  follow(slot) {
    this.mode = { kind: 'first', slot: this.wrapSlot(slot) };
    this.fly.disable();
    this.controls.enabled = false;
    this.touch.setEnabled(false);
    this.setFov(FOV_FLY);
  }

  /** 第三人称观战某个玩家槽位 */
  spectate(slot) {
    this.mode = { kind: 'spectate', slot: this.wrapSlot(slot) };
    this.fly.disable();
    this.controls.enabled = false;
    this.touch.setEnabled(false);
    this.setFov(FOV_SPECTATE);
  }

  /**
   * 循环切换玩家：direction = +1 下一个 / -1 上一个。
   * accept(slot) 返回 false 的玩家会被跳过（例如已死亡）。
   */
  cyclePlayer(direction, accept = () => true) {
    const mode = this.mode;
    const followed = mode.kind === 'first' || mode.kind === 'spectate';
    let start = followed ? mode.slot + direction : direction === 1 ? 0 : -1;
    for (let i = 0; i < this.numPlayers; i++) {
      const slot = this.wrapSlot(start + i * direction);
      if (accept(slot)) {
        if (this.mode.kind === 'spectate') this.spectate(slot);
        else this.follow(slot);
        return;
      }
    }
  }

  /** 把相机对准整个场景（自由视角下用于「看全景」） */
  frameScene(center, radius) {
    this.touch.stop();
    this.controls.target.copy(center);
    const distance = Math.max(1200, radius * 1.6);
    this.camera.position.set(center.x, center.y - distance, center.z + distance * 0.8);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** 每帧更新：dt 秒 */
  update(sample, dt = 0) {
    switch (this.mode.kind) {
      case 'free':
        this.touch.update(dt);
        this.controls.update();
        break;
      case 'fly':
      case 'noclip':
        this.fly.update(dt);
        break;
      case 'first':
        this.updateFirstPerson(sample, this.mode.slot);
        break;
      case 'spectate':
        this.updateSpectate(sample, this.mode.slot);
        break;
    }
  }

  /** 第一人称：眼位 = 玩家位置 + (眼高 - 蹲下量)，朝向由 yaw/pitch 决定 */
  updateFirstPerson(sample, slot) {
    const yaw = (sample.yaw[slot] + this.punchYaw) * DEG;
    const pitch = (sample.pitch[slot] + this.punchPitch) * DEG;
    const cosPitch = Math.cos(pitch);
    this.forward.set(Math.cos(yaw) * cosPitch, Math.sin(yaw) * cosPitch, -Math.sin(pitch));

    const eye = EYE_HEIGHT - sample.duck[slot] * DUCK_DROP;
    this.rememberFollowPose(sample, slot);
    this.camera.position.set(sample.x[slot], sample.y[slot], sample.z[slot] + eye);
    this.target.copy(this.camera.position).add(this.forward);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);

    const fov = ZOOM_FOVS[sample.zoom[slot]] ?? ZOOM_FOVS[0];
    if (this.camera.fov !== fov) this.setFov(fov);
  }

  /** 第三人称观战：相机在目标身后（沿 yaw 反向 180）+ 高度 90，看向胸口 */
  updateSpectate(sample, slot) {
    const yaw = sample.yaw[slot] * DEG;
    const px = sample.x[slot];
    const py = sample.y[slot];
    const pz = sample.z[slot];
    const eye = EYE_HEIGHT - sample.duck[slot] * DUCK_DROP;

    this.rememberFollowPose(sample, slot);
    this.camera.position.set(
      px - Math.cos(yaw) * SPECTATE_DISTANCE,
      py - Math.sin(yaw) * SPECTATE_DISTANCE,
      pz + SPECTATE_HEIGHT,
    );
    this.target.set(px, py, pz + eye);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.touch.dispose();
    this.fly.dispose();
    this.controls.dispose();
  }

  rememberFollowPose(sample, slot) {
    const pose = this.followPose;
    pose.x = sample.x[slot];
    pose.y = sample.y[slot];
    pose.z = sample.z[slot];
    pose.yaw = sample.yaw[slot] * DEG;
    pose.valid = true;
  }

  /** 相机退到被跟随玩家身后（自由视角接管时用） */
  frameFollowedPlayer() {
    const { x, y, z, yaw } = this.followPose;
    this.controls.target.set(x, y, z);
    this.camera.position.set(
      x - Math.cos(yaw) * FREE_FOLLOW_DISTANCE,
      y - Math.sin(yaw) * FREE_FOLLOW_DISTANCE,
      z + FREE_FOLLOW_HEIGHT,
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  wrapSlot(slot) {
    const n = this.numPlayers;
    return n > 0 ? ((slot % n) + n) % n : 0;
  }
}
