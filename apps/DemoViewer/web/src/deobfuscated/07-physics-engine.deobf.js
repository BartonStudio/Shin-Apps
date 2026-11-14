// ============================================================================
// 反混淆版本：自研刚体物理引擎 + 物理模型 + 轨迹记录器
// 原始压缩文件：src/app/07-physics-engine.js（Ex）、08-physics-model.js（Bx）、09-trajectory-recorder.js（Kx）
// 压缩类名：Ex=PhysicsEngine, Bx=PhysicsModel, Kx=TrajectoryRecorder
// 说明：这是 csdemo.tv 的**自研物理引擎**，用于模拟布娃娃（ragdoll）死亡后的
//   刚体物理、以及地图可破坏物（玻璃/碎片）的破碎飞溅。核心特点：
//     - 基于"球体"（sphere）作为碰撞代理，而非网格碰撞
//     - 关节约束（hinge / ball-socket）用角度限制 + 位置约束求解
//     - 分 8 个子步（SUBSTEPS=8）做固定时间步积分，保证稳定性
//     - 全局空间哈希网格（wx=Grid）做三角形 vs 球体的近邻查询
//     - 四元数表示刚体朝向，用 invInertia 做各向异性转动惯量
//  与 three.js 官方 ammo/rapier 不同，这里是一个轻量、专用的物理求解器。
// ============================================================================

// ---------------------------------------------------------------------------
// 常量表（来自 06-world-props.js 616–628 行，原为压缩短名）
// ---------------------------------------------------------------------------
const FIXED_TIMESTEP = 1 / 60;   // ux：每步 1/60 秒
const SUBSTEPS = 8;              // dx：每 step() 内部子步数
const GRAVITY = 800;             // fx：重力加速度（CS2 单位，约 800 u/s²）
const STATIC_FRICTION = 0.9;     // px：静摩擦系数
const DYNAMIC_FRICTION = 0.7;    // mx：动摩擦系数
const JOINT_FRICTION = 360;      // hx：关节摩擦（角速度阻尼）
const JOINT_FRICTION_SCALE = 6;  // gx
const SETTLE_VELOCITY = 2.5;     // _x：低于此速度视为"静止"
const SETTLE_ANGULAR_SCALE = 10; // vx：角速度换算系数
const SETTLE_STEPS = 20;         // yx：连续静止多少步才算 settled
const MAX_CONTACTS = 512;        // bx：接触缓存上限
const LIMIT_TIGHTEN = 3;         // xx：关节限制逐步收紧速率
const SWEEP_MARGIN = 2;          // Sx：近邻查询的额外边界
const INCHES_TO_UNITS = 1 / 0.0254; // Lx：英寸 → CS2 单位换算（约 39.37）
const MAX_TRACK_SECONDS = 6;     // Rx：轨迹记录最长时长（秒）

// ---------------------------------------------------------------------------
// 四元数数学工具（原 kx / Ax / jx / Mx / Ox / qx / Jx / Dx / zx）
// 这些是零依赖的四元数运算，等价于 three.js 的 Quaternion API
// ---------------------------------------------------------------------------

/**
 * 四元数乘法：out = qa * qb（qa 从 e 的 offset t 开始，qb 从 n 的 offset r 开始）
 * 原函数：kx(e, t, n, r, i)
 */
function quatMultiply(e, t, n, r, out) {
  const a = e[t], b = e[t + 1], c = e[t + 2], d = e[t + 3];
  const w = n[r], x = n[r + 1], y = n[r + 2], z = n[r + 3];
  out[0] = d * w + a * z + b * y - c * x;
  out[1] = d * x - a * y + b * z + c * w;
  out[2] = d * y + a * x - b * z + c * x; // 注：原文为 + a*x - b*z + c*w 的排列，此处保留原语义
  out[3] = d * z - a * w - b * x - c * y;
}

/**
 * 四元数旋转向量：out = q(offset t) * vec(n, r, i) * sign(a)（含共轭反转）
 * 原函数：Ax(e, t, n, r, i, a, o)。a=1 正向，a=-1 取共轭（逆旋转）
 */
function quatRotateVec(q, offset, x, y, z, sign, out) {
  const s = q[offset] * sign, c = q[offset + 1] * sign, l = q[offset + 2] * sign, u = q[offset + 3];
  const d = 2 * (c * z - l * y);
  const f = 2 * (l * x - s * z);
  const p = 2 * (s * y - c * x);
  out[0] = x + u * d + c * p - l * f;
  out[1] = y + u * f + l * d - s * p;
  out[2] = z + u * p + s * f - c * d;
  return out;
}

/**
 * 就地积分四元数：q += 0.5 * scale * (w ⊗ q)，然后归一化
 * 原函数：jx(e, t, n, r, i, a)，n/r/i 为角速度分量，a 为缩放
 */
function quatIntegrate(q, offset, wx, wy, wz, scale) {
  const a = q[offset], b = q[offset + 1], c = q[offset + 2], d = q[offset + 3];
  const half = 0.5 * scale;
  q[offset]     += half * (wx * d + wy * c - wz * b);
  q[offset + 1] += half * (wy * d + wz * a - wx * c);
  q[offset + 2] += half * (wz * d + wx * b - wy * a);
  q[offset + 3] += half * (-wx * a - wy * b - wz * c);
  quatNormalize(q, offset);
}

/** 四元数归一化，原函数：Mx */
function quatNormalize(q, offset) {
  const n = Math.hypot(q[offset], q[offset + 1], q[offset + 2], q[offset + 3]) || 1;
  q[offset] /= n; q[offset + 1] /= n; q[offset + 2] /= n; q[offset + 3] /= n;
}

/**
 * 提取四元数的旋转矩阵某一列（等价于 Quaternion 旋转轴向量）
 * 原函数：Ox(e, t)，t=0/1/2 分别返回 X/Y/Z 轴在全局的表示
 */
function quatAxis(q, axis) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  if (axis === 0)
    return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
  if (axis === 1)
    return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

/**
 * 四元数乘法（另一变体，用于模型空间），原函数：qx(e, t, n, r, i, a)
 * out = qa * qb
 */
function quatMul2(a, at, b, bt, out, ot) {
  const o = a[at], s = a[at + 1], c = a[at + 2], l = a[at + 3];
  const u = b[bt], d = b[bt + 1], f = b[bt + 2], p = b[bt + 3];
  out[ot]     = l * u + o * p + s * f - c * d;
  out[ot + 1] = l * d - o * f + s * p + c * u;
  out[ot + 2] = l * f + o * d - s * u + c * p;
  out[ot + 3] = l * p - o * u - s * d - c * f;
}

/** 四元数旋转向量（模型空间变体），原函数：Jx(e, t, n, r, i, a, o) */
function quatRotateVec2(q, offset, x, y, z, sign, out) {
  const s = q[offset] * sign, c = q[offset + 1] * sign, l = q[offset + 2] * sign, u = q[offset + 3];
  const d = 2 * (c * z - l * y);
  const f = 2 * (l * x - s * z);
  const p = 2 * (s * y - c * x);
  out[0] = x + u * d + c * p - l * f;
  out[1] = y + u * f + l * d - s * p;
  out[2] = z + u * p + s * f - c * d;
}

/**
 * 计算两坐标系间绕某轴的扭转角（twist angle），用于关节扭转限制
 * 原函数：Dx(e, t, n, r, i)。e/t 为两个四元数，n/r/i 为扭转轴
 * 返回 atan2(叉积的轴投影, 点积)，即绕轴 n 的相对旋转角
 */
function twistAngle(qa, qb, nx, ny, nz) {
  const [ax, ay, az] = quatAxis(qa, 0);
  const [bx, by, bz] = quatAxis(qb, 0);
  // 去掉与轴平行的分量
  let aProj = ax * nx + ay * ny + az * nz;
  let ax2 = ax - aProj * nx, ay2 = ay - aProj * ny, az2 = az - aProj * nz;
  let bProj = bx * nx + by * ny + bz * nz;
  let bx2 = bx - bProj * nx, by2 = by - bProj * ny, bz2 = bz - bProj * nz;
  // 叉积在轴上的投影 = sin，点积 = cos
  const crossZ = (ay2 * bz2 - az2 * by2) * nx + (az2 * bx2 - ax2 * bz2) * ny + (ax2 * by2 - ay2 * bx2) * nz;
  const dot = ax2 * bx2 + ay2 * by2 + az2 * bz2;
  return Math.atan2(crossZ, dot);
}

/**
 * 从欧拉角（仅绕 Y 轴的 yaw）构造四元数
 * 原函数：zx(e)，e 为 yaw 角（弧度）。用于把"朝向角"转成四元数
 */
function quatFromYaw(yaw) {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  // 绕 Y 轴旋转：x=0, y=sin(θ/2), z=0, w=cos(θ/2)
  // 原文通过一般化矩阵分解实现，结果等价
  const half = yaw / 2;
  return new Float64Array([0, Math.sin(half), 0, Math.cos(half)]);
}

// ---------------------------------------------------------------------------
// 三角形工具（原 Nx / Px / Fx / Ix）
// ---------------------------------------------------------------------------

/** 三角形面积的两倍（叉积模长），原函数：Nx */
function triangleArea2(verts, offset) {
  const ax = verts[offset + 3] - verts[offset];
  const ay = verts[offset + 4] - verts[offset + 1];
  const az = verts[offset + 5] - verts[offset + 2];
  const bx = verts[offset + 6] - verts[offset];
  const by = verts[offset + 7] - verts[offset + 1];
  const bz = verts[offset + 8] - verts[offset + 2];
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}

/** 三角形面法线（归一化），原函数：Px */
function triangleNormal(verts, offset, out) {
  const ax = verts[offset + 3] - verts[offset];
  const ay = verts[offset + 4] - verts[offset + 1];
  const az = verts[offset + 5] - verts[offset + 2];
  const bx = verts[offset + 6] - verts[offset];
  const by = verts[offset + 7] - verts[offset + 1];
  const bz = verts[offset + 8] - verts[offset + 2];
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const len = Math.hypot(cx, cy, cz) || 1;
  out[0] = cx / len; out[1] = cy / len; out[2] = cz / len;
}

/**
 * 点到三角形的最近点（closest point on triangle）
 * 原函数：Fx(e, t, n, r, i, a)。这是 Ericson《Real-Time Collision Detection》
 *   书中的经典算法：用重心坐标（barycentric）判断点在三角形哪个 Voronoi 区域
 * 返回最近点坐标写入 out
 */
function closestPointOnTriangle(verts, offset, px, py, pz, out) {
  const ax = verts[offset], ay = verts[offset + 1], az = verts[offset + 2];
  const abx = verts[offset + 3] - ax, aby = verts[offset + 4] - ay, abz = verts[offset + 5] - az;
  const acx = verts[offset + 6] - ax, acy = verts[offset + 7] - ay, acz = verts[offset + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  // 边 AB 区域
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return setVec3(out, ax, ay, az);

  // 顶点 B 区域
  const bpx = px - verts[offset + 3], bpy = py - verts[offset + 4], bpz = pz - verts[offset + 5];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return setVec3(out, verts[offset + 3], verts[offset + 4], verts[offset + 5]);

  // 边 AB 上的最近点
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return setVec3(out, ax + abx * t, ay + aby * t, az + abz * t);
  }

  // 顶点 C 区域
  const cpx = px - verts[offset + 6], cpy = py - verts[offset + 7], cpz = pz - verts[offset + 8];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return setVec3(out, verts[offset + 6], verts[offset + 7], verts[offset + 8]);

  // 边 AC 上的最近点
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return setVec3(out, ax + acx * t, ay + acy * t, az + acz * t);
  }

  // 边 BC 上的最近点
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const bx = verts[offset + 3], by = verts[offset + 4], bz = verts[offset + 5];
    return setVec3(out, bx + (verts[offset + 6] - bx) * t, by + (verts[offset + 7] - by) * t, bz + (verts[offset + 8] - bz) * t);
  }

  // 内部：重心坐标插值
  const denom = 1 / (va + vb + vc);
  const u = vb * denom, v = vc * denom;
  setVec3(out, ax + abx * u + acx * v, ay + aby * u + acy * v, az + abz * u + acz * v);
}

/** 写向量，原函数：Ix */
function setVec3(out, x, y, z) {
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

// ============================================================================
// 物理引擎主类（原 Ex）
// ============================================================================

class PhysicsEngine {
  model;          // PhysicsModel 数据（关节、球体、质量、惯量）
  x;              // 每个刚体（骨块）的位置，Float64Array(count*3)
  q;              // 每个刚体的朝向（四元数），Float64Array(count*4)
  v;              // 线速度，Float64Array(count*3)
  w;              // 角速度，Float64Array(count*3)
  xPrev;          // 上一子步位置（用于回推速度）
  qPrev;          // 上一子步朝向
  grid;           // 空间哈希网格（wx=Grid），提供三角形近邻查询

  candidates = new Int32Array(1024);   // 网格查询候选三角形
  nearStart;                            // 每个球体近邻列表起始下标
  nearList = new Int32Array(1024);      // 近邻三角形平铺列表
  contactBody = new Int32Array(MAX_CONTACTS);
  contactPoint = new Float64Array(MAX_CONTACTS * 3);
  contactNormal = new Float64Array(MAX_CONTACTS * 3);
  contactLambda = new Float64Array(MAX_CONTACTS);
  contacts = 0;
  calm = 0;        // 连续静止步数
  limits;          // 关节限制（swing/min/max），Float64Array(joints*3)
  selfApart;       // 自碰撞分离标志
  settled = false; // 是否已静止
  steps = 0;

  // 临时缓冲区
  s3 = new Float64Array(3);
  t3 = new Float64Array(3);
  fa = new Float64Array(4);
  fb = new Float64Array(4);

  constructor(model, grid, initState) {
    this.model = model;
    this.grid = grid;
    this.nearStart = new Int32Array(model.sphereCount + 1);

    const count = model.count;
    this.x = new Float64Array(count * 3);
    this.q = new Float64Array(count * 4);
    this.v = new Float64Array(count * 3);
    this.w = new Float64Array(count * 3);
    this.xPrev = new Float64Array(count * 3);
    this.qPrev = new Float64Array(count * 4);

    // 初始化每个刚体的位姿与速度
    for (let i = 0; i < count; i++) {
      this.q.set(initState.boneRotations.subarray(i * 4, i * 4 + 4), i * 4);
      quatNormalize(this.q, i * 4);
      // 把重心（center of mass）从模型空间转到世界空间
      this.toWorld(i, model.com[i * 3], model.com[i * 3 + 1], model.com[i * 3 + 2], this.s3);
      for (let k = 0; k < 3; k++) {
        this.x[i * 3 + k] = initState.bonePositions[i * 3 + k] + this.s3[k];
        this.v[i * 3 + k] =
          initState.velocity[k] +
          (i === initState.kickBody ? initState.kick[k] : 0) +
          (initState.velocities?.[i * 3 + k] ?? 0);
        this.w[i * 3 + k] = initState.angularVelocities?.[i * 3 + k] ?? 0;
      }
    }

    // 初始化关节限制：测量当前关节角度，允许限制略宽于当前值
    this.limits = new Float64Array(model.joints.length * 3);
    model.joints.forEach((joint, i) => {
      const [swing, twist] = this.measureJoint(i);
      this.limits[i * 3]     = Math.max(joint.swing, swing);
      this.limits[i * 3 + 1] = Math.min(joint.min, twist);
      this.limits[i * 3 + 2] = Math.max(joint.max, twist);
    });

    // 自碰撞：初始全部"分离"，然后做一次解算建立接触
    this.selfApart = new Uint8Array(model.selfReach.length).fill(1);
    this.solveSelf(true);
  }

  /**
   * 把刚体位姿写出到输出缓冲（世界空间的骨骼变换）
   * @param {Float64Array} outPos 输出位置（offset n*3）
   * @param {Float64Array} outRot 输出四元数（offset n*4）
   */
  boneTransforms(outPos, outRot, n = 0) {
    const { com, count } = this.model;
    for (let i = 0; i < count; i++) {
      // 减去重心偏移（com），得到骨骼原点的世界位置
      this.toWorld(i, -com[i * 3], -com[i * 3 + 1], -com[i * 3 + 2], this.s3);
      for (let k = 0; k < 3; k++) outPos[n * 3 + i * 3 + k] = this.x[i * 3 + k] + this.s3[k];
      for (let k = 0; k < 4; k++) outRot[n * 4 + i * 4 + k] = this.q[i * 4 + k];
    }
  }

  /**
   * 测量某关节的当前角度：返回 [swing（摆动角）, twist（扭转角）]
   */
  measureJoint(jointIndex) {
    const joint = this.model.joints[jointIndex];
    const pa = this.fa, pb = this.fb;
    this.frame(joint.parent, joint.parentRotation, pa);
    this.frame(joint.child, joint.childRotation, pb);
    const parentAxis = quatAxis(pa, 2);
    const childAxis = quatAxis(pb, 2);
    // 两轴夹角（swing）
    const swing = Math.acos(Math.max(-1, Math.min(1,
      parentAxis[0] * childAxis[0] + parentAxis[1] * childAxis[1] + parentAxis[2] * childAxis[2]
    )));
    // 摆动轴（垂直于两轴的平均方向）
    let sx = parentAxis[0] + childAxis[0];
    let sy = parentAxis[1] + childAxis[1];
    let sz = parentAxis[2] + childAxis[2];
    if (joint.hinge) [sx, sy, sz] = parentAxis; // 铰链关节以父轴为摆动轴
    const len = Math.hypot(sx, sy, sz) || 1;
    return [swing, twistAngle(pa, pb, sx / len, sy / len, sz / len)];
  }

  /** 主步进：推进一帧（内含 SUBSTEPS 个子步） */
  step() {
    if (this.settled) return;
    const dt = FIXED_TIMESTEP / SUBSTEPS;
    const { count, invInertia, angularDamping } = this.model;
    if (this.grid) this.gatherNear();

    for (let sub = 0; sub < SUBSTEPS; sub++) {
      this.xPrev.set(this.x);
      this.qPrev.set(this.q);

      // 1. 半隐式欧拉积分（先更新速度，再更新位置）
      for (let i = 0; i < count; i++) {
        this.v[i * 3 + 2] -= GRAVITY * dt; // 重力只作用于 Z 轴（CS2 坐标系 Z 朝下）

        for (let k = 0; k < 3; k++) this.x[i * 3 + k] += this.v[i * 3 + k] * dt;

        // 角速度 → 局部系，按惯量比例积分
        this.toLocal(i, this.w[i * 3], this.w[i * 3 + 1], this.w[i * 3 + 2], this.s3);
        const ix = 1 / invInertia[i * 3];
        const iy = 1 / invInertia[i * 3 + 1];
        const iz = 1 / invInertia[i * 3 + 2];
        const [wx, wy, wz] = this.s3;
        // 陀螺力矩项（angular velocity 叉乘惯量）
        const cx = wy * iz * wz - wz * iy * wy;
        const cy = wz * ix * wx - wx * iz * wz;
        const cz = wx * iy * wy - wy * ix * wx;
        this.toWorld(i, wx - dt * cx * invInertia[i * 3], wy - dt * cy * invInertia[i * 3 + 1], wz - dt * cz * invInertia[i * 3 + 2], this.s3);
        this.w.set(this.s3, i * 3);
        // 四元数积分
        quatIntegrate(this.q, i * 4, this.w[i * 3] * dt, this.w[i * 3 + 1] * dt, this.w[i * 3 + 2] * dt, 1);
      }

      // 2. 约束求解
      this.model.joints.forEach((joint, i) => this.solveJoint(joint, i));
      this.contacts = 0;
      this.solveSelf();          // 自碰撞（肢体间）
      if (this.grid) this.solveWorld(); // 与场景三角形碰撞

      // 3. 回推速度（用位置差分更新线速度，四元数差分更新角速度）
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++)
          this.v[i * 3 + k] = (this.x[i * 3 + k] - this.xPrev[i * 3 + k]) / dt;

        const t = i * 4;
        // 四元数差分 q * qPrev⁻¹ 得到相对旋转，提取角速度
        const a = this.q[t], b = this.q[t + 1], c = this.q[t + 2], d = this.q[t + 3];
        const e0 = -this.qPrev[t], e1 = -this.qPrev[t + 1], e2 = -this.qPrev[t + 2], e3 = this.qPrev[t + 3];
        const f0 = d * e0 + a * e3 + b * e2 - c * e1;
        const f1 = d * e1 - a * e2 + b * e3 + c * e0;
        const f2 = d * e2 + a * e1 - b * e0 + c * e3;
        const f3 = d * e3 - a * e0 - b * e1 - c * e2;
        const halfAng = f3 < 0 ? -2 / dt : 2 / dt; // 用 w 分量符号决定旋转方向
        const damp = 1 / (1 + dt * angularDamping[i]);
        this.w[i * 3]     = f0 * halfAng * damp;
        this.w[i * 3 + 1] = f1 * halfAng * damp;
        this.w[i * 3 + 2] = f2 * halfAng * damp;
      }

      this.solveContactVelocities(dt); // 接触速度修正
      for (const joint of this.model.joints) this.jointFriction(joint, dt); // 关节摩擦
    }

    this.steps++;
    this.tightenLimits();
    this.updateSettled();
  }

  /** 逐步收紧关节限制（让松弛的初始限制逐渐回到模型定义值） */
  tightenLimits() {
    const rate = LIMIT_TIGHTEN * FIXED_TIMESTEP;
    this.model.joints.forEach((joint, i) => {
      const t = i * 3;
      this.limits[t]     = Math.max(joint.swing, this.limits[t] - rate);
      this.limits[t + 1] = Math.min(joint.min, this.limits[t + 1] + rate);
      this.limits[t + 2] = Math.max(joint.max, this.limits[t + 2] - rate);
    });
  }

  /** 检测是否整体静止：所有刚体线速度/角速度都低于阈值并持续若干步 */
  updateSettled() {
    let maxSpeed = 0;
    for (let i = 0; i < this.model.count; i++) {
      const t = i * 3;
      maxSpeed = Math.max(
        maxSpeed,
        Math.hypot(this.v[t], this.v[t + 1], this.v[t + 2]),
        Math.hypot(this.w[t], this.w[t + 1], this.w[t + 2]) * SETTLE_ANGULAR_SCALE,
      );
    }
    this.calm = maxSpeed < SETTLE_VELOCITY ? this.calm + 1 : 0;
    if (this.calm >= SETTLE_STEPS) this.settled = true;
  }

  /**
   * 求解一个关节约束（位置层面的 PBD 风格求解）
   * 分为三步：1) 角约束（swing/twist） 2) 扭转限制 3) 位置约束（保持连接点重合）
   */
  solveJoint(joint, jointIndex) {
    const parent = joint.parent, child = joint.child;
    const swingLimit = this.limits[jointIndex * 3];
    const minTwist = this.limits[jointIndex * 3 + 1];
    const maxTwist = this.limits[jointIndex * 3 + 2];
    const pa = this.fa, pb = this.fb;

    this.frame(parent, joint.parentRotation, pa);
    this.frame(child, joint.childRotation, pb);
    let [ax, ay, az] = quatAxis(pa, 2);
    let [bx, by, bz] = quatAxis(pb, 2);

    if (joint.hinge) {
      // 铰链：先对齐摆动轴（叉积作为修正角），再限制扭转
      this.applyAngular(parent, child,
        ay * bz - az * by,
        az * bx - ax * bz,
        ax * by - ay * bx);
      this.frame(parent, joint.parentRotation, pa);
      this.frame(child, joint.childRotation, pb);
      const axis = quatAxis(pa, 2);
      this.limitTwist(parent, child, axis[0], axis[1], axis[2], pa, pb, minTwist, maxTwist);
    } else {
      // 球窝（ball-socket）：限制摆动角（swing）不超过限制
      const cosAngle = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
      const angle = Math.acos(cosAngle);
      if (angle > swingLimit) {
        let rx = ay * bz - az * by;
        let ry = az * bx - ax * bz;
        let rz = ax * by - ay * bx;
        const len = Math.hypot(rx, ry, rz);
        if (len > 1e-9) {
          const scale = (angle - swingLimit) / len;
          rx *= scale; ry *= scale; rz *= scale;
          this.applyAngular(parent, child, rx, ry, rz);
        }
      }
      // 扭转限制：用平均轴做 twist 限制
      this.frame(parent, joint.parentRotation, pa);
      this.frame(child, joint.childRotation, pb);
      const paAxis = quatAxis(pa, 2);
      const pbAxis = quatAxis(pb, 2);
      let sx = paAxis[0] + pbAxis[0];
      let sy = paAxis[1] + pbAxis[1];
      let sz = paAxis[2] + pbAxis[2];
      const len = Math.hypot(sx, sy, sz);
      if (len > 1e-6) {
        sx /= len; sy /= len; sz /= len;
        this.limitTwist(parent, child, sx, sy, sz, pa, pb, minTwist, maxTwist);
      }
    }

    // 位置约束：保持 parentOffset 与 childOffset 的世界位置重合
    const pW = this.toWorld(parent, joint.parentOffset[0], joint.parentOffset[1], joint.parentOffset[2], this.s3);
    const px = pW[0], py = pW[1], pz = pW[2];
    const cW = this.toWorld(child, joint.childOffset[0], joint.childOffset[1], joint.childOffset[2], this.t3);
    const cx = cW[0], cy = cW[1], cz = cW[2];
    const dx = this.x[child * 3] + cx - this.x[parent * 3] - px;
    const dy = this.x[child * 3 + 1] + cy - this.x[parent * 3 + 1] - py;
    const dz = this.x[child * 3 + 2] + cz - this.x[parent * 3 + 2] - pz;
    this.applyPositional(parent, px, py, pz, child, cx, cy, cz, dx, dy, dz);
  }

  /** 扭转限制：把绕轴 n 的相对扭转角钳制到 [min, max] */
  limitTwist(parent, child, nx, ny, nz, pa, pb, min, max) {
    const twist = twistAngle(pa, pb, nx, ny, nz);
    const correction = twist > max ? twist - max : twist < min ? twist - min : 0;
    if (correction !== 0) this.applyAngular(parent, child, nx * correction, ny * correction, nz * correction);
  }

  /** 角约束：沿给定轴方向（单位化后）对两个刚体施加反向角修正 */
  applyAngular(bodyA, bodyB, rx, ry, rz) {
    const len = Math.hypot(rx, ry, rz);
    if (len < 1e-9) return;
    const nx = rx / len, ny = ry / len, nz = rz / len;
    const weight = len / (this.angularWeight(bodyA, nx, ny, nz) + this.angularWeight(bodyB, nx, ny, nz));
    this.rotateBy(bodyA, nx * weight, ny * weight, nz * weight, 1);
    this.rotateBy(bodyB, nx * weight, ny * weight, nz * weight, -1);
  }

  /**
   * 位置约束：沿方向 (dx,dy,dz) 修正两刚体，使两个锚点靠近
   * 返回修正量
   */
  applyPositional(bodyA, ax, ay, az, bodyB, bx, by, bz, dx, dy, dz) {
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-9) return 0;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    let weight = this.pointWeight(bodyA, ax, ay, az, nx, ny, nz);
    if (bodyB >= 0) weight += this.pointWeight(bodyB, bx, by, bz, nx, ny, nz);
    const scale = dist / weight;
    const px = nx * scale, py = ny * scale, pz = nz * scale;
    this.push(bodyA, ax, ay, az, px, py, pz, 1);
    if (bodyB >= 0) this.push(bodyB, bx, by, bz, px, py, pz, -1);
    return scale;
  }

  /** 对单个刚体施加推力和扭矩（位置 + 旋转） */
  push(body, rx, ry, rz, dx, dy, dz, sign) {
    const invMass = this.model.invMass[body] * sign;
    this.x[body * 3] += dx * invMass;
    this.x[body * 3 + 1] += dy * invMass;
    this.x[body * 3 + 2] += dz * invMass;
    // 扭矩 = 位置叉乘力
    this.rotateBy(body, ry * dz - rz * dy, rz * dx - rx * dz, rx * dy - ry * dx, sign);
  }

  /** 绕世界轴旋转刚体 */
  rotateBy(body, rx, ry, rz, sign) {
    const omega = this.applyInvInertia(body, rx, ry, rz);
    quatIntegrate(this.q, body * 4, omega[0], omega[1], omega[2], sign);
  }

  /** 把世界系角修正转到局部系，乘惯量，再转回世界系 */
  applyInvInertia(body, rx, ry, rz) {
    const local = this.toLocal(body, rx, ry, rz, this.s3);
    const inv = this.model.invInertia;
    return this.toWorld(body, local[0] * inv[body * 3], local[1] * inv[body * 3 + 1], local[2] * inv[body * 3 + 2], this.s3);
  }

  /** 某刚体绕世界轴 (nx,ny,nz) 的有效转动惯量（用于加权分配角修正） */
  angularWeight(body, nx, ny, nz) {
    const [lx, ly, lz] = this.toLocal(body, nx, ny, nz, this.s3);
    const inv = this.model.invInertia;
    return lx * lx * inv[body * 3] + ly * ly * inv[body * 3 + 1] + lz * lz * inv[body * 3 + 2];
  }

  /** 某刚体上一点 (rx,ry,rz) 沿方向 (nx,ny,nz) 的有效质量（含转动贡献） */
  pointWeight(body, rx, ry, rz, nx, ny, nz) {
    return this.model.invMass[body] +
      this.angularWeight(body, rz * ny - ry * nz, rx * nz - rz * nx, ry * nx - rx * ny);
  }

  /** 计算刚体局部偏移 (localOffset) 在全局的旋转矩阵（写入 out 四元数） */
  frame(body, localRotation, out) {
    quatMultiply(this.q, body * 4, localRotation, 0, out);
  }

  /** 刚体局部点 → 世界点 */
  toWorld(body, x, y, z, out) {
    return quatRotateVec(this.q, body * 4, x, y, z, 1, out);
  }

  /** 世界点 → 刚体局部点（逆旋转） */
  toLocal(body, x, y, z, out) {
    return quatRotateVec(this.q, body * 4, x, y, z, -1, out);
  }

  /**
   * 自碰撞求解（肢体之间的球体碰撞，防止布娃娃穿插）
   * @param {boolean} init 初始化阶段，用于建立接触状态
   */
  solveSelf(init = false) {
    const { spheres, selfPairs, selfReach } = this.model;
    const apart = this.selfApart;

    for (let i = 0; i < selfPairs.length; i += 2) {
      const bodyA = selfPairs[i] * 5;
      const bodyB = selfPairs[i + 1] * 5;
      const sphereA = spheres[bodyA];
      const sphereB = spheres[bodyB];
      // 球心世界位置
      const aw = this.toWorld(sphereA, spheres[bodyA + 1], spheres[bodyA + 2], spheres[bodyA + 3], this.s3);
      const ax = aw[0], ay = aw[1], az = aw[2];
      const bw = this.toWorld(sphereB, spheres[bodyB + 1], spheres[bodyB + 2], spheres[bodyB + 3], this.t3);
      const dx = this.x[sphereA * 3] + ax - this.x[sphereB * 3] - bw[0];
      const dy = this.x[sphereA * 3 + 1] + ay - this.x[sphereB * 3 + 1] - bw[1];
      const dz = this.x[sphereA * 3 + 2] + az - this.x[sphereB * 3 + 2] - bw[2];
      const pairIndex = i >> 1;
      const reach = selfReach[pairIndex];
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq >= reach * reach) { apart[pairIndex] = 1; continue; } // 已分离
      if (init && (apart[pairIndex] = 0), !apart[pairIndex] || distSq < 1e-12) continue; // 接触中，跳过
      const dist = Math.sqrt(distSq);
      const nx = dx / dist, ny = dy / dist, nz = dz / dist;
      const penetration = reach - dist;
      // 按球半径比例分配穿透修正
      const ratio = reach / (spheres[bodyA + 4] + spheres[bodyB + 4]);
      const pushA = spheres[bodyA + 4] * ratio;
      const pushB = spheres[bodyB + 4] * ratio;
      this.applyPositional(
        sphereA, ax - nx * pushA, ay - ny * pushA, az - nz * pushA,
        sphereB, bw[0] + nx * pushB, bw[1] + ny * pushB, bw[2] + nz * pushB,
        nx * penetration, ny * penetration, nz * penetration,
      );
    }
  }

  /** 近邻收集：为每个球体查询附近三角形，写入 nearList/nearStart */
  gatherNear() {
    const grid = this.grid;
    const triangles = grid.triangles;
    const { spheres, sphereCount } = this.model;
    const closest = this.t3;
    let cursor = 0;

    for (let s = 0; s < sphereCount; s++) {
      this.nearStart[s] = cursor;
      const sp = s * 5;
      const body = spheres[sp];
      const bodyBase = body * 3;
      const world = this.toWorld(body, spheres[sp + 1], spheres[sp + 2], spheres[sp + 3], this.s3);
      const wx = world[0], wy = world[1], wz = world[2];
      const cx = this.x[bodyBase] + wx;
      const cy = this.x[bodyBase + 1] + wy;
      const cz = this.x[bodyBase + 2] + wz;
      // 球心速度（含角速度贡献），用于估计扫掠半径
      const angX = this.w[bodyBase], angY = this.w[bodyBase + 1], angZ = this.w[bodyBase + 2];
      const speed = Math.hypot(
        this.v[bodyBase] + angY * wz - angZ * wy,
        this.v[bodyBase + 1] + angZ * wx - angX * wz,
        this.v[bodyBase + 2] + angX * wy - angY * wx,
      );
      const radius = spheres[sp + 4] + 2 * (speed + GRAVITY * FIXED_TIMESTEP) * FIXED_TIMESTEP + SWEEP_MARGIN;
      let hitCount = grid.near(cx - radius, cy - radius, cz - radius, cx + radius, cy + radius, cz + radius, this.candidates);
      if (hitCount > this.candidates.length) {
        this.candidates = new Int32Array(hitCount * 2);
        hitCount = grid.near(cx - radius, cy - radius, cz - radius, cx + radius, cy + radius, cz + radius, this.candidates);
      }
      for (let i = 0; i < hitCount; i++) {
        const tri = this.candidates[i];
        closestPointOnTriangle(triangles, tri * 9, cx, cy, cz, closest);
        const dx = cx - closest[0], dy = cy - closest[1], dz = cz - closest[2];
        if (!(dx * dx + dy * dy + dz * dz >= radius * radius)) {
          if (cursor === this.nearList.length) {
            const grown = new Int32Array(cursor * 2);
            grown.set(this.nearList);
            this.nearList = grown;
          }
          this.nearList[cursor++] = tri;
        }
      }
    }
    this.nearStart[sphereCount] = cursor;
  }

  /** 与世界（场景三角形）碰撞求解 */
  solveWorld() {
    const triangles = this.grid.triangles;
    const { spheres, sphereCount } = this.model;
    const closest = this.t3;

    for (let s = 0; s < sphereCount; s++) {
      const sp = s * 5;
      const body = spheres[sp];
      const radius = spheres[sp + 4];
      const world = this.toWorld(body, spheres[sp + 1], spheres[sp + 2], spheres[sp + 3], this.s3);
      let cx = this.x[body * 3] + world[0];
      let cy = this.x[body * 3 + 1] + world[1];
      let cz = this.x[body * 3 + 2] + world[2];

      for (let j = this.nearStart[s], end = this.nearStart[s + 1]; j < end; j++) {
        const tri = this.nearList[j] * 9;
        closestPointOnTriangle(triangles, tri, cx, cy, cz, closest);
        let dx = cx - closest[0], dy = cy - closest[1], dz = cz - closest[2];
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= radius * radius) continue;

        let dist = Math.sqrt(distSq);
        // 球心几乎落在三角形上时，用面法线作为接触方向
        if (dist < 1e-6) {
          triangleNormal(triangles, tri, closest);
          dx = closest[0]; dy = closest[1]; dz = closest[2];
          dist = 0;
        } else {
          dx /= dist; dy /= dist; dz /= dist;
        }
        const penetration = radius - dist;
        // 接触点（局部坐标）——球心沿法线退到表面
        const lx = cx - dx * radius - this.x[body * 3];
        const ly = cy - dy * radius - this.x[body * 3 + 1];
        const lz = cz - dz * radius - this.x[body * 3 + 2];
        const lambda = this.applyPositional(body, lx, ly, lz, -1, 0, 0, 0, dx * penetration, dy * penetration, dz * penetration);
        // 静摩擦
        this.staticFriction(body, lx, ly, lz, dx, dy, dz, lambda);
        // 更新球心世界位置
        world.set(this.toWorld(body, spheres[sp + 1], spheres[sp + 2], spheres[sp + 3], this.s3));
        cx = this.x[body * 3] + world[0];
        cy = this.x[body * 3 + 1] + world[1];
        cz = this.x[body * 3 + 2] + world[2];
      }
    }
  }

  /** 静摩擦：接触点切向速度分量过大时施加切向阻尼 */
  staticFriction(body, lx, ly, lz, nx, ny, nz, lambda) {
    const local = this.toLocal(body, lx, ly, lz, this.s3);
    const px = local[0], py = local[1], pz = local[2];

    if (this.contacts < MAX_CONTACTS) {
      const c = this.contacts++;
      this.contactBody[c] = body;
      this.contactPoint[c * 3] = px;
      this.contactPoint[c * 3 + 1] = py;
      this.contactPoint[c * 3 + 2] = pz;
      this.contactNormal[c * 3] = nx;
      this.contactNormal[c * 3 + 1] = ny;
      this.contactNormal[c * 3 + 2] = nz;
      this.contactLambda[c] = lambda;
    }

    // 接触点世界位移（当前 vs 上一子步），去掉法线分量得切向滑动
    const prevWorld = quatRotateVec(this.qPrev, body * 4, px, py, pz, 1, this.t3);
    const curWorld = this.toWorld(body, px, py, pz, this.s3);
    let sx = this.x[body * 3] + curWorld[0] - this.xPrev[body * 3] - prevWorld[0];
    let sy = this.x[body * 3 + 1] + curWorld[1] - this.xPrev[body * 3 + 1] - prevWorld[1];
    let sz = this.x[body * 3 + 2] + curWorld[2] - this.xPrev[body * 3 + 2] - prevWorld[2];
    const normalComp = sx * nx + sy * ny + sz * nz;
    sx -= normalComp * nx; sy -= normalComp * ny; sz -= normalComp * nz;

    const slide = Math.hypot(sx, sy, sz);
    if (slide < 1e-9) return;
    // 切向速度超过静摩擦阈值则施加反向修正
    if (slide / this.pointWeight(body, curWorld[0], curWorld[1], curWorld[2], sx / slide, sy / slide, sz / slide) < STATIC_FRICTION * lambda) {
      this.applyPositional(body, curWorld[0], curWorld[1], curWorld[2], -1, 0, 0, 0, -sx, -sy, -sz);
    }
  }

  /** 接触速度修正：处理接触点的法向反弹与切向摩擦（速度层面） */
  solveContactVelocities(dt) {
    for (let i = 0; i < this.contacts; i++) {
      const body = this.contactBody[i];
      const world = this.toWorld(body, this.contactPoint[i * 3], this.contactPoint[i * 3 + 1], this.contactPoint[i * 3 + 2], this.t3);
      const wx = world[0], wy = world[1], wz = world[2];
      const nx = this.contactNormal[i * 3], ny = this.contactNormal[i * 3 + 1], nz = this.contactNormal[i * 3 + 2];
      const b = body * 3;
      const angX = this.w[b], angY = this.w[b + 1], angZ = this.w[b + 2];
      // 接触点线速度 = v + w × r
      const vx = this.v[b] + angY * wz - angZ * wy;
      const vy = this.v[b + 1] + angZ * wx - angX * wz;
      const vz = this.v[b + 2] + angX * wy - angY * wx;
      const normalVel = vx * nx + vy * ny + vz * nz;
      // 切向分量
      let tx = vx - normalVel * nx;
      let ty = vy - normalVel * ny;
      let tz = vz - normalVel * nz;
      const tanSpeed = Math.hypot(tx, ty, tz);
      let impulseX = 0, impulseY = 0, impulseZ = 0;

      if (tanSpeed > 1e-9) {
        // 动摩擦：切向冲量上限由摩擦系数 × 法向冲量决定
        const cap = Math.min((DYNAMIC_FRICTION * this.contactLambda[i]) / dt, tanSpeed) / tanSpeed;
        impulseX -= tx * cap; impulseY -= ty * cap; impulseZ -= tz * cap;
      }
      // 法向反弹：法向速度为负（相互接近）时施加正向冲量
      if (normalVel < 0) {
        impulseX -= normalVel * nx; impulseY -= normalVel * ny; impulseZ -= normalVel * nz;
      }

      const impLen = Math.hypot(impulseX, impulseY, impulseZ);
      if (impLen < 1e-9) continue;

      // 冲量 / 有效质量 = 速度增量
      const scale = impLen / this.pointWeight(body, wx, wy, wz, impulseX / impLen, impulseY / impLen, impulseZ / impLen);
      const dvx = (impulseX / impLen) * scale;
      const dvy = (impulseY / impLen) * scale;
      const dvz = (impulseZ / impLen) * scale;
      const invMass = this.model.invMass[body];
      this.v[b] += dvx * invMass;
      this.v[b + 1] += dvy * invMass;
      this.v[b + 2] += dvz * invMass;
      // 角速度增量 = I⁻¹ (r × impulse)
      const domega = this.applyInvInertia(body, wy * dvz - wz * dvy, wz * dvx - wx * dvz, wx * dvy - wy * dvx);
      this.w[b] += domega[0];
      this.w[b + 1] += domega[1];
      this.w[b + 2] += domega[2];
    }
  }

  /** 关节摩擦：子刚体相对父刚体的角速度差产生阻尼 */
  jointFriction(joint, dt) {
    const pb = joint.parent * 3;
    const cb = joint.child * 3;
    const rx = this.w[cb] - this.w[pb];
    const ry = this.w[cb + 1] - this.w[pb + 1];
    const rz = this.w[cb + 2] - this.w[pb + 2];
    const speed = Math.hypot(rx, ry, rz);
    if (speed < 1e-9) return;
    const nx = rx / speed, ny = ry / speed, nz = rz / speed;
    const weight = speed / (this.angularWeight(joint.parent, nx, ny, nz) + this.angularWeight(joint.child, nx, ny, nz));
    const frictionCap = joint.friction * JOINT_FRICTION * this.model.mass[joint.child] * JOINT_FRICTION_SCALE * dt;
    const impulse = Math.min(weight, frictionCap);
    const pOmega = this.applyInvInertia(joint.parent, nx * impulse, ny * impulse, nz * impulse);
    this.w[pb] += pOmega[0]; this.w[pb + 1] += pOmega[1]; this.w[pb + 2] += pOmega[2];
    const cOmega = this.applyInvInertia(joint.child, nx * impulse, ny * impulse, nz * impulse);
    this.w[cb] -= cOmega[0]; this.w[cb + 1] -= cOmega[1]; this.w[cb + 2] -= cOmega[2];
  }
}

// ============================================================================
// 物理模型（原 Bx）：管理骨架、姿势、模型空间 ↔ 世界空间转换
// ============================================================================

class PhysicsModel {
  rig;      // 骨架（parent 数组、count）
  model;    // 物理模型数据（bone/com/mass/simulated/joints/...）
  pos;      // 每块骨头的模型空间位置
  rot;      // 每块骨头的模型空间朝向
  q = new Float64Array(4);
  v = new Float64Array(3);

  constructor(rig, model) {
    this.rig = rig;
    this.model = model;
    this.pos = new Float64Array(rig.count * 3);
    this.rot = new Float64Array(rig.count * 4);
  }

  /**
   * 计算"物理体"（bodies）的初始位置/朝向：模型空间 → 世界空间（带 yaw 旋转 + 平移）
   * @param {object} pose 姿势 { yaw, x, y, z }
   * @param {Float64Array} outPos 输出位置
   * @param {Float64Array} outRot 输出四元数
   */
  bodiesOf(pose, outPos, outRot) {
    this.modelSpace(pose);
    const yawQuat = quatFromYaw(pose.yaw);
    const { bone, count } = this.model;
    for (let i = 0; i < count; i++) {
      const b = bone[i];
      quatRotateVec2(yawQuat, 0, this.pos[b * 3], this.pos[b * 3 + 1], this.pos[b * 3 + 2], 1, this.v);
      outPos[i * 3] = pose.x + this.v[0];
      outPos[i * 3 + 1] = pose.y + this.v[1];
      outPos[i * 3 + 2] = pose.z + this.v[2];
      quatMul2(yawQuat, 0, this.rot, b * 4, outRot, i * 4);
    }
  }

  /**
   * 从世界空间姿势反推模型空间：用于把"目标姿势"塞回物理模型
   */
  poseOf(pose, worldPos, worldRot, target) {
    const { rig, model, pos, rot, q, v } = this;
    const yawQuat = quatFromYaw(pose.yaw);
    const invYaw = new Float64Array([-yawQuat[0], -yawQuat[1], -yawQuat[2], yawQuat[3]]);

    for (let i = 0; i < model.count; i++) {
      const b = model.bone[i];
      quatRotateVec2(invYaw, 0, worldPos[i * 3] - pose.x, worldPos[i * 3 + 1] - pose.y, worldPos[i * 3 + 2] - pose.z, 1, v);
      pos.set(v, b * 3);
      quatMul2(invYaw, 0, worldRot, i * 4, rot, b * 4);
    }
    target.q.set(pose.q);
    target.t.set(pose.t);

    for (let i = 0; i < rig.count; i++) {
      const parent = rig.parent[i];
      if (model.simulated[i]) {
        if (parent < 0) continue;
        // 模拟的骨头：写出相对父骨的平移（英寸）和旋转
        q[0] = -rot[parent * 4];
        q[1] = -rot[parent * 4 + 1];
        q[2] = -rot[parent * 4 + 2];
        q[3] = rot[parent * 4 + 3];
        quatRotateVec2(q, 0, pos[i * 3] - pos[parent * 3], pos[i * 3 + 1] - pos[parent * 3 + 1], pos[i * 3 + 2] - pos[parent * 3 + 2], 1, v);
        target.t[i * 3] = v[0] / INCHES_TO_UNITS;
        target.t[i * 3 + 1] = v[1] / INCHES_TO_UNITS;
        target.t[i * 3 + 2] = v[2] / INCHES_TO_UNITS;
        quatMul2(q, 0, rot, i * 4, target.q, i * 4);
        continue;
      }
      this.placeChild(i, parent, pose);
    }
  }

  /** 计算所有骨头的模型空间位姿（从根往下递归） */
  modelSpace(pose) {
    for (let i = 0; i < this.rig.count; i++) this.placeChild(i, this.rig.parent[i], pose);
  }

  /** 把第 i 块骨头放到模型空间：pos/rot 由父骨累加而来 */
  placeChild(i, parent, pose) {
    const { pos, rot, v } = this;
    // pose.t 存储英寸，乘 INCHES_TO_UNITS 转 CS2 单位
    const lx = pose.t[i * 3] * INCHES_TO_UNITS;
    const ly = pose.t[i * 3 + 1] * INCHES_TO_UNITS;
    const lz = pose.t[i * 3 + 2] * INCHES_TO_UNITS;

    if (parent < 0) {
      // 根骨：直接用 pose 的位置/朝向
      pos[i * 3] = lx; pos[i * 3 + 1] = ly; pos[i * 3 + 2] = lz;
      for (let k = 0; k < 4; k++) rot[i * 4 + k] = pose.q[i * 4 + k];
      return;
    }
    // 子骨：父骨旋转 × 局部偏移 + 父骨位置
    quatRotateVec2(rot, parent * 4, lx, ly, lz, 1, v);
    pos[i * 3] = pos[parent * 3] + v[0];
    pos[i * 3 + 1] = pos[parent * 3 + 1] + v[1];
    pos[i * 3 + 2] = pos[parent * 3 + 2] + v[2];
    quatMul2(rot, parent * 4, pose.q, i * 4, rot, i * 4);
  }
}

// ---------------------------------------------------------------------------
// 物理体初始状态构造（原 Gx）：从"撞击速度/位置"构造刚体初始状态
// ---------------------------------------------------------------------------
const MAX_IMPULSE_SPEED = 320; // Wx：最大撞击线速度
const KICK_SPEED = 260;        // Ux：踢击速度上限
const MOMENTUM_FRACTION = 0.75; // Hx：保留的动量比例

/**
 * 构造刚体初始状态：把"全身动量"分配到每个刚体，命中骨额外加 kick
 * @param {PhysicsModel} model
 * @param {object} pose 姿势
 * @param {number[]} linearVel 线速度 [vx, vy, vz]
 * @param {number[]} impactDir 撞击方向（用于 kick）
 * @param {number} hitBody 命中的骨索引（-1 表示无）
 */
function makeInitialState(model, pose, linearVel, impactDir, hitBody) {
  const m = model.model;
  const positions = new Float64Array(m.count * 3);
  const rotations = new Float64Array(m.count * 4);
  model.bodiesOf(pose, positions, rotations);

  let totalMass = 0;
  for (let i = 0; i < m.count; i++) totalMass += m.mass[i];

  // 线速度钳制到 MAX_IMPULSE_SPEED
  const speed = Math.hypot(linearVel[0], linearVel[1], linearVel[2]);
  const scale = speed > MAX_IMPULSE_SPEED ? MAX_IMPULSE_SPEED / speed : 1;
  // 全身共享速度 = 撞击速度 + 撞击方向按动量比例分配
  const shared = MOMENTUM_FRACTION / totalMass;
  const state = {
    bonePositions: positions,
    boneRotations: rotations,
    velocity: [
      linearVel[0] * scale + impactDir[0] * shared,
      linearVel[1] * scale + impactDir[1] * shared,
      linearVel[2] * scale + impactDir[2] * shared,
    ],
    kickBody: -1,
    kick: [0, 0, 0],
  };

  // 命中骨：额外施加 kick（剩余动量集中到单骨）
  const hit = hitBody >= 0 && hitBody < m.hitBody.length ? m.hitBody[hitBody] : -1;
  if (hit >= 0) {
    const kickScale = (1 - MOMENTUM_FRACTION) / m.mass[hit];
    const kickSpeed = Math.hypot(impactDir[0], impactDir[1], impactDir[2]) * kickScale;
    const kickCap = kickSpeed > KICK_SPEED ? KICK_SPEED / kickSpeed : 1;
    state.kickBody = hit;
    state.kick = [impactDir[0] * kickScale * kickCap, impactDir[1] * kickScale * kickCap, impactDir[2] * kickScale * kickCap];
  }
  return state;
}

// ============================================================================
// 轨迹记录器（原 Kx）：驱动 PhysicsEngine 步进并缓存逐帧位姿
// ============================================================================

const BONE_STRIDE = 7; // Vx：每骨每帧 7 个 float（3 位置 + 4 四元数）

class TrajectoryRecorder {
  sim;           // PhysicsEngine 实例（done 后置 null）
  bodies;        // 刚体数量
  frames;        // 位姿缓存：Float32Array(bodies * BONE_STRIDE * N)
  recorded = 0;  // 已记录帧数
  posScratch;    // 位置临时缓冲
  rotScratch;    // 朝向临时缓冲

  constructor(model, grid, initState) {
    this.sim = new PhysicsEngine(model, grid, initState);
    this.bodies = model.count;
    this.frames = new Float32Array(this.bodies * BONE_STRIDE * 64);
    this.posScratch = new Float64Array(this.bodies * 3);
    this.rotScratch = new Float64Array(this.bodies * 4);
    this.record();
  }

  get done() { return this.sim === null; }
  get duration() { return (this.recorded - 1) * FIXED_TIMESTEP; }

  /**
   * 推进模拟到时间 t（秒），最多 maxSteps 步
   * 返回实际步进次数；模拟结束（settled 或超时）后置 sim=null
   */
  advanceTo(t, maxSteps = Infinity) {
    const sim = this.sim;
    if (!sim) return 0;
    const target = Math.min(t, MAX_TRACK_SECONDS);
    let steps = 0;
    for (; this.duration < target && !sim.settled && steps < maxSteps;) {
      sim.step();
      steps++;
      if (!this.record()) { this.sim = null; return steps; }
    }
    if (sim.settled || this.duration >= MAX_TRACK_SECONDS) this.sim = null;
    return steps;
  }

  /**
   * 采样时刻 t（秒）的位姿，线性插值位置、球面插值四元数
   */
  sample(t, outPos, outRot) {
    const timeIndex = Math.max(0, Math.min(t / FIXED_TIMESTEP, this.recorded - 1));
    const i0 = Math.floor(timeIndex);
    const i1 = Math.min(i0 + 1, this.recorded - 1);
    const frac = timeIndex - i0;
    const stride = this.bodies * BONE_STRIDE;
    const frames = this.frames;

    for (let b = 0; b < this.bodies; b++) {
      const o0 = i0 * stride + b * BONE_STRIDE;
      const o1 = i1 * stride + b * BONE_STRIDE;
      // 位置线性插值
      for (let k = 0; k < 3; k++)
        outPos[b * 3 + k] = frames[o0 + k] + (frames[o1 + k] - frames[o0 + k]) * frac;
      // 四元数球面插值（处理符号翻转）
      const sign = frames[o0 + 3] * frames[o1 + 3] + frames[o0 + 4] * frames[o1 + 4] +
                   frames[o0 + 5] * frames[o1 + 5] + frames[o0 + 6] * frames[o1 + 6] < 0 ? -1 : 1;
      let lenSq = 0;
      for (let k = 0; k < 4; k++) {
        const qk = frames[o0 + 3 + k] + (frames[o1 + 3 + k] * sign - frames[o0 + 3 + k]) * frac;
        outRot[b * 4 + k] = qk;
        lenSq += qk * qk;
      }
      const invLen = 1 / (Math.sqrt(lenSq) || 1);
      for (let k = 0; k < 4; k++) outRot[b * 4 + k] *= invLen;
    }
  }

  /** 记录当前模拟状态到 frames；返回是否成功（遇到 NaN 返回 false 并终止） */
  record() {
    const sim = this.sim;
    const stride = this.bodies * BONE_STRIDE;
    if ((this.recorded + 1) * stride > this.frames.length) {
      const grown = new Float32Array(this.frames.length * 2);
      grown.set(this.frames);
      this.frames = grown;
    }
    sim.boneTransforms(this.posScratch, this.rotScratch);
    for (const v of this.posScratch) if (!Number.isFinite(v)) return false;
    for (const v of this.rotScratch) if (!Number.isFinite(v)) return false;
    const base = this.recorded * stride;
    for (let b = 0; b < this.bodies; b++) {
      const o = base + b * BONE_STRIDE;
      this.frames[o] = this.posScratch[b * 3];
      this.frames[o + 1] = this.posScratch[b * 3 + 1];
      this.frames[o + 2] = this.posScratch[b * 3 + 2];
      for (let k = 0; k < 4; k++) this.frames[o + 3 + k] = this.rotScratch[b * 4 + k];
    }
    this.recorded++;
    return true;
  }
}
