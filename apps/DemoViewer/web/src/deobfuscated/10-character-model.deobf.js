// ============================================================================
// 反混淆版本：CS2 角色模型（CharacterModel）
// 原始压缩文件：src/app/10-character-model.js
// 原文范围：decompiled/index.beautified.js L34298–35809（切片 10-character-model）
// 压缩类名：gS=ShardField, eC=CharacterAnimator, _w=RagdollFallSystem, 及大量工具函数
// 说明：这是 csdemo.tv 角色系统的**核心**。CS2 探员（agent）不是简单播放
//   glb 动画，而是由作者逆向工程出来的一整套系统：
//    1. 自研动画格式解码（ES）：从 .bin 二进制读取骨骼动画剪辑（clip）
//    2. 姿态合成（eC.pose）：根据 demo 状态（武器/移动/蹲伏/跳跃/死亡/换弹/
//       投掷/安包/拆包/瞄准）混合多个动画剪辑，实时合成骨骼姿态
//    3. 布娃娃模型构建（aw）：从骨骼 rig + 手工调参的刚体表（nw/rw/iw）
//       生成物理引擎（Ex）所需的 ragdoll 模型（球体碰撞代理 + 关节）
//    4. 布娃娃跌倒系统（_w）：死亡后驱动物理引擎，把尸体摔到地面
//  之前"像素块 vs 真实模型"问题的答案就在这里：真实模型依赖 t.glb/ct.glb
//  （角色网格）+ anims.bin（骨骼动画），缺失时退化成分块胶囊体。
// ============================================================================

// ---------------------------------------------------------------------------
// 玻璃碎片场（原 gS）：把破碎的玻璃/碎片渲染成一批受重力影响的实例
// ---------------------------------------------------------------------------
class ShardField {
  mesh;      // InstancedMesh
  count;     // 碎片数量
  start;     // 初始位置
  velocity;  // 初速度
  axis;      // 旋转轴
  spin;      // 自旋角速度
  scale;     // 缩放
  land;      // 落地时刻
  rest;      // 落地后静止朝向
  m = new Matrix4();
  p = new Vector3();
  q = new Quaternion();
  a = new Vector3();
  s = new Vector3();

  constructor(geometry, material, box, impact, floorBelow) {
    const rand = mulberry32(impact ^ 2654435769);
    const size = box.getSize(new Vector3());
    // 选最短轴作为"薄片"朝向
    const thinAxis = size.x <= size.y && size.x <= size.z ? 0 : size.y <= size.z ? 1 : 2;
    const area = (size.x * size.y * size.z) / Math.max(size.getComponent(thinAxis), 1);
    this.count = Math.round(Math.min(64, Math.max(12, area / 40)));
    this.mesh = new InstancedMesh(geometry, material, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.start = new Float32Array(this.count * 3);
    this.velocity = new Float32Array(this.count * 3);
    this.axis = new Float32Array(this.count * 3);
    this.spin = new Float32Array(this.count);
    this.scale = new Float32Array(this.count);
    this.land = new Float32Array(this.count);
    this.rest = [];

    const ray = new Raycaster();
    const tmp = new Vector3();
    for (let i = 0; i < this.count; i++) {
      const pos = this.p.set(box.min.x + rand() * size.x, box.min.y + rand() * size.y, box.min.z + rand() * size.z);
      pos.setComponent(thinAxis, (box.min.getComponent(thinAxis) + box.max.getComponent(thinAxis)) / 2);
      // 冲击方向 + 随机散布
      const dir = applyImpactDir(impact, pos, tmp);
      const vx = dir.x * (0.5 + rand() * 0.7) + (rand() - 0.5) * 70;
      const vy = dir.y * (0.5 + rand() * 0.7) + (rand() - 0.5) * 70;
      const vz = dir.z * (0.5 + rand() * 0.7) + (rand() - 0.2) * 60;
      this.start.set([pos.x, pos.y, pos.z], i * 3);
      this.velocity.set([vx, vy, vz], i * 3);
      const axis = this.a.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      this.axis.set([axis.x, axis.y, axis.z], i * 3);
      this.spin[i] = (rand() - 0.5) * 30;
      this.scale[i] = 1.5 + rand() * 3;
      this.rest.push(new Quaternion().setFromAxisAngle(this.a.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rand() * Math.PI * 2));
      // 计算落地时刻：解抛物线 t = (v + sqrt(v²+2g·h))/g
      const fallTime = (vz + Math.sqrt(vz * vz + 2 * GRAVITY_CONST * Math.max(0, pos.z - box.min.z))) / GRAVITY_CONST;
      const groundZ = floorBelow(pos.x + vx * fallTime, pos.y + vy * fallTime, pos.z, pos.z - 512, ray) ?? box.min.z - 512;
      const drop = Math.max(0, pos.z - groundZ - 0.3);
      this.land[i] = (vz + Math.sqrt(vz * vz + 2 * GRAVITY_CONST * drop)) / GRAVITY_CONST;
    }
  }

  /** 更新所有碎片到时间 t 的姿态 */
  pose(t) {
    for (let i = 0; i < this.count; i++) {
      const time = Math.min(t, this.land[i]);
      const o = i * 3;
      // 抛物线运动（受重力）
      this.p.set(
        this.start[o] + this.velocity[o] * time,
        this.start[o + 1] + this.velocity[o + 1] * time,
        this.start[o + 2] + this.velocity[o + 2] * time - 0.5 * GRAVITY_CONST * time * time,
      );
      this.q.setFromAxisAngle(this.a.set(this.axis[o], this.axis[o + 1], this.axis[o + 2]), this.spin[i] * time).multiply(this.rest[i]);
      const scale = this.scale[i];
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.set(scale, scale, 1)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** 玻璃碎片三角面几何体（原 _S）：一个三角片 */
function makeShardGeometry() {
  const geo = new BufferGeometry();
  geo.setAttribute(`position`, new BufferAttribute([-0.5, -0.4, 0, 0.6, -0.2, 0, -0.1, 0.7, 0], 3));
  geo.setAttribute(`normal`, new BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute(`aAlbedo`, new BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  geo.setAttribute(`aOrm`, new BufferAttribute([1, 0.1, 0, 1, 0.1, 0, 1, 0.1, 0], 3));
  return geo;
}

// ---------------------------------------------------------------------------
// 确定性随机数生成器（原 SS/CS）
// ---------------------------------------------------------------------------
/** 整数哈希（原 SS）：把索引混成 32bit 无符号随机种子 */
function hashInt(x) {
  let t = Math.imul(x | 0, 73244475) ^ 625341585;
  t = Math.imul(t ^ (t >>> 16), 73244475);
  return (t ^ (t >>> 16)) >>> 0;
}

/** Mulberry32 PRNG（原 CS）：返回 [0,1) 均匀分布的确定性随机数流 */
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 1831565813) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 角色动画文件解码（原 ES）：自研 .bin 动画格式
// ---------------------------------------------------------------------------
const ANIM_MAGIC = `CS2A`; // wS
const ANIM_VERSION = 1;    // TS

/**
 * 解码角色动画文件（CS2A 格式）
 * 结构：魔数(4B) + 版本(4B) + JSON 长度(4B) + JSON 元数据 + 二进制动画数据
 * 动画数据用 glTF 压缩方式存（QUATERNION 旋转 + EXPONENTIAL 平移）
 * @returns {{bones: string[], clips: Map<string, AnimationClip>}}
 */
function decodeAnimations(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 12 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== ANIM_MAGIC)
    throw Error(`not a CS2 character animation file`);
  const version = view.getUint32(4, true);
  if (version !== ANIM_VERSION) throw Error(`unsupported character animation version ${version}`);
  const jsonLen = view.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jsonLen)));
  const dataStart = 12 + jsonLen;

  // 解压一段连续数据：glTF 压缩缓冲解码
  const decodeBuffer = (desc, stride, filter = `ATTRIBUTES`) => {
    const out = new Uint8Array(desc.count * stride);
    if (desc.count > 0) {
      const offset = dataStart + desc.byteOffset;
      gltfDecoder.decodeGltfBuffer(out, desc.count, stride, bytes.subarray(offset, offset + desc.byteLength), `ATTRIBUTES`, filter);
    }
    return out.buffer;
  };

  const frames = new Uint32Array(decodeBuffer(meta.frames, 4));
  const rotations = new Int16Array(decodeBuffer(meta.rotations, 8, `QUATERNION`));
  // 反量化四元数（int16 → float，归一化）
  const rotFloat = new Float32Array(rotations.length);
  for (let i = 0; i < rotations.length; i += 4) {
    const x = rotations[i], y = rotations[i + 1], z = rotations[i + 2], w = rotations[i + 3];
    const inv = 1 / (Math.hypot(x, y, z, w) || 1);
    rotFloat[i] = x * inv; rotFloat[i + 1] = y * inv; rotFloat[i + 2] = z * inv; rotFloat[i + 3] = w * inv;
  }
  const transFloat = new Float32Array(decodeBuffer(meta.translations, 12, `EXPONENTIAL`));

  const boneCount = meta.bones.length;
  const clips = new Map();
  for (const clipMeta of meta.clips) {
    const clip = {
      name: clipMeta.name, kind: clipMeta.kind, fps: clipMeta.fps, duration: clipMeta.duration,
      speed: clipMeta.speed ?? 0, direction: clipMeta.direction ?? 0,
      rotations: Array(boneCount).fill(null),
      translations: Array(boneCount).fill(null),
    };
    const tracks = clipMeta.tracks;
    for (let i = 0; i + 4 < tracks.length; i += 5) {
      const [bone, type, count, frameOffset, valueOffset] = [tracks[i], tracks[i + 1], tracks[i + 2], tracks[i + 3], tracks[i + 4]];
      if (bone >= boneCount) continue;
      const stride = type === 0 ? 4 : 3; // 0=旋转，1=平移
      const values = type === 0 ? rotFloat : transFloat;
      const track = { frames: frames.subarray(frameOffset, frameOffset + count), values: values.subarray(valueOffset * stride, (valueOffset + count) * stride) };
      (type === 0 ? clip.rotations : clip.translations)[bone] = track;
    }
    clips.set(clip.name, clip);
  }
  return { bones: meta.bones, clips };
}

// ---------------------------------------------------------------------------
// 姿态（Pose）：每根骨头的四元数旋转 + 平移
// ---------------------------------------------------------------------------
function makePose(boneCount) {
  const pose = { q: new Float32Array(boneCount * 4), t: new Float32Array(boneCount * 3) };
  for (let i = 0; i < boneCount; i++) pose.q[i * 4 + 3] = 1;
  return pose;
}
function copyPose(src, dst) { dst.q.set(src.q); dst.t.set(src.t); }

// ---------------------------------------------------------------------------
// 骨骼 rig 构建（原 kS）：从骨骼名称列表 + 元数据构建骨架
// ---------------------------------------------------------------------------
function buildRig(names, boneInfoOf) {
  const count = names.length;
  const indexOf = new Map(names.map((n, i) => [n, i]));
  const rest = makePose(count);
  const parent = new Int16Array(count).fill(-1);
  const present = new Uint8Array(count);   // 该骨是否存在（有元数据）
  const finger = new Uint8Array(count);    // 是否为手指骨
  const upper = new Uint8Array(count);     // 是否在上半身链上

  for (let i = 0; i < count; i++) {
    finger[i] = +!!names[i].startsWith(`finger_`);
    const info = boneInfoOf(names[i]);
    if (info) {
      present[i] = 1;
      parent[i] = info.parent === null ? -1 : (indexOf.get(info.parent) ?? -1);
      for (let k = 0; k < 4; k++) rest.q[i * 4 + k] = info.quaternion[k];
      for (let k = 0; k < 3; k++) rest.t[i * 3 + k] = info.position[k];
    }
  }

  // 关键骨索引
  const requireBone = (name) => {
    const idx = indexOf.get(name);
    if (idx === undefined || !present[idx]) throw Error(`character rig has no ${name}`);
    return idx;
  };
  const pelvis = requireBone(`pelvis`);
  const wpnPivot = requireBone(`wpnPivot`);
  const spine0 = requireBone(`spine_0`);
  // 标记上半身骨（spine_0 或 wpnPivot 的祖先链）
  for (let i = 0; i < count; i++)
    for (let b = i; b >= 0; b = parent[b])
      if (b === spine0 || b === wpnPivot) { upper[i] = 1; break; }

  return {
    count, names, rest, parent, present, finger, upper,
    pelvis, wpnPivot,
    spine: [requireBone(`spine_1`), requireBone(`spine_2`), requireBone(`spine_3`)],
  };
}

// ---------------------------------------------------------------------------
// 动画采样与混合工具
// ---------------------------------------------------------------------------
/** 二分查找：最后一个 frames[i] <= t 的下标（原 AS） */
function upperBoundFrames(frames, t) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    frames[mid] <= t ? (lo = mid) : (hi = mid - 1);
  }
  return lo;
}

/** 采样单轨：把 track 在时刻 n 的值写入 out（线性插值 / 四元数球面插值） */
function sampleTrack(track, stride, n, out, offset) {
  const { frames, values } = track;
  const last = frames.length - 1;
  if (last === 0 || n <= frames[0]) { for (let i = 0; i < stride; i++) out[offset + i] = values[i]; return; }
  if (n >= frames[last]) { for (let i = 0; i < stride; i++) out[offset + i] = values[last * stride + i]; return; }
  const lo = upperBoundFrames(frames, n);
  const frac = (n - frames[lo]) / (frames[lo + 1] - frames[lo]);
  const a = lo * stride, b = a + stride;
  if (stride === 3) { // 平移线性插值
    for (let i = 0; i < 3; i++) out[offset + i] = values[a + i] + (values[b + i] - values[a + i]) * frac;
    return;
  }
  // 四元数球面插值（处理符号翻转）
  const sign = values[a] * values[b] + values[a + 1] * values[b + 1] + values[a + 2] * values[b + 2] + values[a + 3] * values[b + 3] < 0 ? -frac : frac;
  let lenSq = 0;
  for (let i = 0; i < 4; i++) { const v = values[a + i] * (1 - frac) + values[b + i] * sign; out[offset + i] = v; lenSq += v * v; }
  const inv = 1 / Math.sqrt(lenSq || 1);
  for (let i = 0; i < 4; i++) out[offset + i] *= inv;
}

/** clip 时间（秒）→ 帧号（原 MS） */
function clipFrame(clip, time) { return Math.min(Math.max(time, 0), clip.duration) * clip.fps; }

/** 把某个 clip 在时刻 n 的姿态采样到 out（原 NS），跳过上半身/手指骨 */ 
function sampleClip(rig, clip, n, out) {
  const frame = clipFrame(clip, n);
  const isUpper = clip.kind === `upper`;
  const { rest } = rig;
  for (let bone = 0; bone < rig.count; bone++) {
    if (isUpper && !rig.upper[bone]) continue;
    const rot = clip.rotations[bone];
    if (rot) sampleTrack(rot, 4, frame, out.q, bone * 4);
    else if (!rig.finger[bone]) for (let k = 0; k < 4; k++) out.q[bone * 4 + k] = rest.q[bone * 4 + k];
    const trans = clip.translations[bone];
    if (trans) sampleTrack(trans, 3, frame, out.t, bone * 3);
    else if (!rig.finger[bone]) for (let k = 0; k < 3; k++) out.t[bone * 3 + k] = rest.t[bone * 3 + k];
  }
}

/** 叠加动画（原 FS）：把 clip 增量叠加到 out，weight 缩放 */
function applyAdditive(clip, time, weight, out) {
  if (weight <= 0) return;
  const frame = clipFrame(clip, time);
  const scratch = PS_QUAT;
  for (let bone = 0; bone < clip.rotations.length; bone++) {
    const rot = clip.rotations[bone];
    if (rot) {
      sampleTrack(rot, 4, frame, scratch, 0);
      if (weight < 1) { // 权重缩放四元数（近似 slerp 到 identity）
        const sign = scratch[3] < 0 ? -1 : 1;
        scratch[0] *= weight * sign; scratch[1] *= weight * sign; scratch[2] *= weight * sign;
        scratch[3] = 1 - weight + scratch[3] * weight * sign;
        const inv = 1 / Math.hypot(scratch[0], scratch[1], scratch[2], scratch[3]);
        for (let k = 0; k < 4; k++) scratch[k] *= inv;
      }
      quatMulInto(out.q, bone * 4, out.q, bone * 4, scratch, 0);
    }
    const trans = clip.translations[bone];
    if (trans) {
      sampleTrack(trans, 3, frame, scratch, 0);
      for (let k = 0; k < 3; k++) out.t[bone * 3 + k] += scratch[k] * weight;
    }
  }
}

/** 混合两个姿态（原 IS）：out = lerp(out, target, n)，四元数 slerp */
function blendPose(out, target, n) {
  if (n <= 0) return;
  if (n >= 1) { copyPose(target, out); return; }
  const { q, t } = out;
  for (let i = 0; i < q.length; i += 4) {
    const sign = q[i] * target.q[i] + q[i + 1] * target.q[i + 1] + q[i + 2] * target.q[i + 2] + q[i + 3] * target.q[i + 3] < 0 ? -n : n;
    let lenSq = 0;
    for (let k = 0; k < 4; k++) { const v = q[i + k] * (1 - n) + target.q[i + k] * sign; q[i + k] = v; lenSq += v * v; }
    const inv = 1 / Math.sqrt(lenSq || 1);
    for (let k = 0; k < 4; k++) q[i + k] *= inv;
  }
  for (let i = 0; i < t.length; i++) t[i] += (target.t[i] - t[i]) * n;
}

/** 累加姿态（原 LS）：out += src * n（四元数带符号，平移线性） */
function accumulatePose(out, src, n, rest) {
  for (let i = 0; i < out.q.length; i += 4) {
    const sign = src.q[i] * rest.q[i] + src.q[i + 1] * rest.q[i + 1] + src.q[i + 2] * rest.q[i + 2] + src.q[i + 3] * rest.q[i + 3] < 0 ? -n : n;
    for (let k = 0; k < 4; k++) out.q[i + k] += src.q[i + k] * sign;
  }
  for (let i = 0; i < out.t.length; i++) out.t[i] += src.t[i] * n;
}

/** 归一化姿态（原 RS） */
function normalizePose(pose, scale) {
  for (let i = 0; i < pose.q.length; i += 4) {
    const inv = 1 / (Math.hypot(pose.q[i], pose.q[i + 1], pose.q[i + 2], pose.q[i + 3]) || 1);
    for (let k = 0; k < 4; k++) pose.q[i + k] *= inv;
  }
  const invScale = 1 / (scale || 1);
  for (let i = 0; i < pose.t.length; i++) pose.t[i] *= invScale;
}

/** 四元数乘法（写入 out 的 offset） */
function quatMulInto(out, outOffset, a, aOffset, b, bOffset) {
  const ax = a[aOffset], ay = a[aOffset + 1], az = a[aOffset + 2], aw = a[aOffset + 3];
  const bx = b[bOffset], by = b[bOffset + 1], bz = b[bOffset + 2], bw = b[bOffset + 3];
  out[outOffset] = aw * bx + ax * bw + ay * bz - az * by;
  out[outOffset + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[outOffset + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[outOffset + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** 四元数旋转向量（out 存结果向量） */
function quatRotateVec3(q, qOffset, x, y, z, out) {
  const qx = q[qOffset], qy = q[qOffset + 1], qz = q[qOffset + 2], qw = q[qOffset + 3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + qy * tz - qz * ty;
  out[1] = y + qw * ty + qz * tx - qx * tz;
  out[2] = z + qw * tz + qx * ty - qy * tx;
  return out;
}

const PS_QUAT = new Float32Array(4);

// ---------------------------------------------------------------------------
// 武器分类（原 US/WS/VS/HS）
// ---------------------------------------------------------------------------
const PISTOLS = new Set([`glock`, `usp_silencer`, `hkp2000`, `p250`, `fiveseven`, `tec9`, `cz75a`, `deagle`, `elite`, `revolver`, `taser`]);
const GRENADES = new Set([`hegrenade`, `flashbang`, `smokegrenade`, `molotov`, `incgrenade`, `decoy`]);

/** 武器 → 大类（none/knife/gun/grenade/c4） */
function weaponKind(weapon, hasWeapon) {
  return hasWeapon ? `knife` : weapon ? (weapon === `c4` ? `c4` : GRENADES.has(weapon) ? `grenade` : `gun`) : `none`;
}
/** 大类 → 动画集合（pistol/rifle/knife） */
function weaponClass(weapon, kind) {
  return kind === `gun` ? (PISTOLS.has(weapon) ? `pistol` : `rifle`) : `knife`;
}

// ---------------------------------------------------------------------------
// 玩家状态（原 GS）：从 demo 提取的、驱动动画合成所需的全部状态
// ---------------------------------------------------------------------------
function makePlayerState() {
  return {
    time: 0, weapon: ``, kind: `none`, speed: 0, moveAngle: 0, phase: 0, duck: 0, air: 0, airAge: 0,
    pitch: 0, equipAge: Infinity, fireAge: Infinity, reloadAge: Infinity, reloading: false,
    pinPulled: false, pinAge: Infinity, plantAge: Infinity, defuseAge: Infinity, death: ``, deathAge: 0,
  };
}

/** 根据速度/蹲伏计算步幅（原 KS） */
function strideFor(cycle, speed, duck) {
  const runBlend = clamp01((speed - cycle.walkSpeed) / Math.max(1, cycle.runSpeed - cycle.walkSpeed));
  const walkStride = cycle.walkStride + (cycle.runStride - cycle.walkStride) * runBlend;
  return walkStride + (cycle.crouchStride - walkStride) * clamp01(duck);
}

// 8 个移动方向（北/东北/东/...）
const DIRS_8 = [`n`, `ne`, `e`, `se`, `s`, `sw`, `w`, `nw`];
const DRAW_FADE_IN = 0.08;   // JS：掏枪淡入
const FIRE_FADE_OUT = 0.2;   // YS：开火淡出
const PLANT_FADE_IN = 0.2;   // XS
const MAX_AIM_DEG = 70;      // ZS：最大瞄准角
const SPINE_AIM_WEIGHTS = [0.3, 0.35, 0.35]; // QS：三段脊椎的瞄准权重分配
const BLEND_EPS = 0.001;     // $S

// ---------------------------------------------------------------------------
// 角色动画器（原 eC）：把玩家状态合成为骨骼姿态
// ---------------------------------------------------------------------------
class CharacterAnimator {
  rig;      // 骨架
  gait;     // 步态参数（walk/run/crouch 的 speed/stride）
  anims;    // 动画剪辑库
  sets;     // rifle/pistol/knife 三套动画集合
  deaths;   // 死亡动画列表
  stand;    // 站立姿态
  crouch;   // 蹲伏姿态
  scratch;  // 临时姿态
  acc;      // 累加姿态
  chainQ = new Float64Array(20);
  chainT = new Float64Array(15);
  temp = new Float64Array(8);

  constructor(anims, rig) {
    if (anims.bones.length !== rig.count) throw Error(`character rig does not match the animation bones`);
    this.anims = anims;
    this.rig = rig;
    this.sets = { rifle: this.classSet(`rifle`), pistol: this.classSet(`pistol`), knife: this.classSet(`knife`) };
    const rifle = this.sets.rifle;
    this.gait = {
      walkSpeed: rifle.walk.speed, runSpeed: rifle.run.speed, crouchSpeed: rifle.crouch.speed,
      walkStride: rifle.walk.stride, runStride: rifle.run.stride, crouchStride: rifle.crouch.stride,
    };
    this.deaths = [...anims.clips.values()].filter((c) => c.name.startsWith(`death_`));
    this.stand = makePose(rig.count);
    this.crouch = makePose(rig.count);
    this.scratch = makePose(rig.count);
    this.acc = makePose(rig.count);
  }

  get deathClips() { return this.deaths.map((c) => c.name); }

  /**
   * 主入口：根据玩家状态合成骨骼姿态到 out
   * 合成顺序：死亡 > 移动（步态）> 空中 > 持枪 > 上半身动作 > 安包/拆包 > 瞄准
   */
  pose(state, out) {
    const rig = this.rig;
    if (state.death) {
      copyPose(rig.rest, out);
      const death = this.anims.clips.get(state.death);
      if (death) sampleClip(rig, death, state.deathAge, out);
      return;
    }

    const cls = weaponClass(state.weapon, state.kind);
    const set = this.sets[cls];
    const duck = clamp01(state.duck);

    this.locomotion(set, state, duck, out);
    if (state.air > BLEND_EPS) { // 空中动画叠加
      const clip = duck > 0.5 ? set.inAirCrouch : set.inAir;
      if (clip) this.overlay(clip, Math.min(state.airAge, clip.duration), clamp01(state.air), out);
    }
    if (state.kind === `gun`) { // 持枪待机 + 开火
      const idle = this.clip(`${state.weapon}_idle`);
      if (idle) applyAdditive(idle, 0, 1, out);
      const shoot = this.clip(`${state.weapon}_shoot`) ?? (cls === `rifle` ? this.clip(`rifle_shoot`) : null);
      if (shoot && state.fireAge < shoot.duration) applyAdditive(shoot, state.fireAge, weightInOut(state.fireAge, shoot.duration, 0, FIRE_FADE_OUT), out);
    }
    const draw = state.kind === `grenade` ? this.clip(`grenade_draw`) : state.kind === `c4` ? this.clip(`c4_draw`) : null;
    if (draw) this.overlay(draw, draw.duration, 1, out);

    const upper = this.upperAction(state);
    if (upper) this.overlay(upper.clip, upper.time, upper.weight, out);

    // 安包 / 拆包
    let blockWeight = 0;
    if (state.plantAge < Infinity) {
      const clip = this.clip(duck > 0.5 ? `c4_plant_crouch` : `c4_plant`);
      if (clip) { blockWeight = weightInOut(state.plantAge, Infinity, PLANT_FADE_IN, 0); this.overlay(clip, Math.min(state.plantAge, clip.duration), blockWeight, out); }
    } else if (state.defuseAge < Infinity) {
      const clip = duck > 0.5 ? set.defuseCrouch : set.defuse;
      if (clip) { blockWeight = weightInOut(state.defuseAge, Infinity, PLANT_FADE_IN, 0); this.overlay(clip, clip.duration > 0 ? state.defuseAge % clip.duration : 0, blockWeight, out); }
    }

    // 瞄准：pitch 角驱动脊椎弯曲
    const aimDeg = Math.max(-70, Math.min(MAX_AIM_DEG, state.pitch)) * (1 - blockWeight);
    if (Math.abs(aimDeg) > 0.1) this.aim((Math.PI / 180) * aimDeg, out);
  }

  clip(name) { return this.anims.clips.get(name) ?? null; }

  /** 构建某武器类（rifle/pistol/knife）的动画集合 */
  classSet(cls) {
    const require = (name) => { const c = this.clip(name); if (!c) throw Error(`character animations lack ${name}`); return c; };
    const directions = (kind) => {
      const clips = DIRS_8.map((d) => require(`${cls}_${kind}_${d}`)).sort((a, b) => a.direction - b.direction);
      return {
        clips,
        speed: clips.reduce((sum, c) => sum + c.speed, 0) / clips.length,
        stride: clips.reduce((sum, c) => sum + c.speed * c.duration, 0) / clips.length,
      };
    };
    return {
      idle: require(`${cls}_idle`),
      idleCrouch: require(`${cls}_idle_crouch`),
      inAir: this.clip(`${cls}_inair`),
      inAirCrouch: this.clip(`${cls}_inair_crouch`),
      defuse: this.clip(`defuse_${cls}`),
      defuseCrouch: this.clip(`defuse_crouch_${cls}`),
      walk: directions(`walk`), run: directions(`run`), crouch: directions(`crouch`),
    };
  }

  /** 步态合成：根据速度/蹲伏/相位混合 walk/run/crouch 的 8 方向动画 */
  locomotion(set, state, duck, out) {
    const { rig, stand, crouch, acc, scratch } = this;
    copyPose(rig.rest, stand);
    sampleClip(rig, set.idle, 0, stand);
    copyPose(stand, crouch);
    sampleClip(rig, set.idleCrouch, 0, crouch);

    const speed = Math.max(0, state.speed);
    const standBlend = 1 - duck;
    const walkBlend = clamp01(speed / set.walk.speed);
    const runBlend = clamp01((speed - set.walk.speed) / Math.max(1, set.run.speed - set.walk.speed));
    const crouchBlend = clamp01(speed / set.crouch.speed);
    const phase = state.phase - Math.floor(state.phase);

    acc.q.fill(0); acc.t.fill(0);
    let total = 0;
    const accumulate = (pose, weight) => { if (weight <= BLEND_EPS) return; accumulatePose(acc, pose, weight, stand); total += weight; };
    const move = (set, restPose, weight) => {
      if (weight <= BLEND_EPS) return;
      const [a, b, frac] = pickDirection(set.clips, state.moveAngle);
      for (const [clip, w] of [[a, 1 - frac], [b, frac]]) {
        if (weight * w <= BLEND_EPS) continue;
        copyPose(restPose, scratch);
        sampleClip(rig, clip, phase * clip.duration, scratch);
        accumulate(scratch, weight * w);
      }
    };

    accumulate(stand, standBlend * (1 - walkBlend));
    move(set.walk, stand, standBlend * walkBlend * (1 - runBlend));
    move(set.run, stand, standBlend * walkBlend * runBlend);
    accumulate(crouch, duck * (1 - crouchBlend));
    move(set.crouch, crouch, duck * crouchBlend);

    copyPose(acc, out);
    normalizePose(out, total);
  }

  /** 叠加一个动画（原 overlay），upper 类动画会额外做持枪对齐 */
  overlay(clip, time, weight, out) {
    if (weight <= BLEND_EPS) return;
    const scratch = this.scratch;
    copyPose(out, scratch);
    sampleClip(this.rig, clip, time, scratch);
    if (clip.kind === `upper`) this.carryWeapon(scratch);
    blendPose(out, scratch, weight);
  }

  /** 持枪对齐（原 carryWeapon）：把 wpnPivot 对齐到站立姿态的 pelvis 相对位置 */
  carryWeapon(pose) {
    const { rig, temp } = this;
    const pelvisQ = rig.pelvis * 4, pelvisT = rig.pelvis * 3;
    const stand = this.stand;
    const invStandPelvis = [-stand.q[pelvisQ], -stand.q[pelvisQ + 1], -stand.q[pelvisQ + 2], stand.q[pelvisQ + 3]];
    quatMulInto(temp, 0, pose.q, pelvisQ, invStandPelvis, 0);
    quatRotateVec3(temp, 0, stand.t[pelvisT], stand.t[pelvisT + 1], stand.t[pelvisT + 2], temp.subarray(4));
    const dx = pose.t[pelvisT] - temp[4], dy = pose.t[pelvisT + 1] - temp[5], dz = pose.t[pelvisT + 2] - temp[6];
    setWpnPivot(pose, rig.wpnPivot, temp, 0, dx, dy, dz, temp);
  }

  /** 上半身动作选择（原 upperAction）：换弹/掏枪/攻击/投掷/安包 */
  upperAction(state) {
    let result = null;
    const consider = (clipName, age, noDurationCheck = false) => {
      if (!(age >= 0) || age === Infinity) return;
      const clip = this.clip(clipName);
      if (!clip || (!noDurationCheck && age >= clip.duration) || (result && result.age <= age)) return;
      const weight = noDurationCheck ? weightInOut(age, Infinity, DRAW_FADE_IN, 0) : weightInOut(age, clip.duration, clipName.endsWith(`_draw`) ? 0 : DRAW_FADE_IN, FIRE_FADE_OUT);
      result = { clip, time: Math.min(age, clip.duration), weight, age };
    };

    switch (state.kind) {
      case `gun`:
        if (state.reloading) consider(`${state.weapon}_reload`, state.reloadAge);
        consider(`${state.weapon}_draw`, state.equipAge);
        break;
      case `knife`:
        consider(`knife_draw`, state.equipAge);
        consider(`knife_attack`, state.fireAge);
        break;
      case `grenade`:
        consider(`grenade_draw`, state.equipAge);
        if (state.pinPulled) consider(`grenade_pullpin`, state.pinAge, true);
        consider(`grenade_throw`, state.fireAge);
        break;
      case `c4`:
        consider(`c4_draw`, state.equipAge);
        break;
    }
    return result;
  }

  /** 瞄准（原 aim）：pitch 角沿脊椎链（pelvis→spine）逐段弯曲 */
  aim(angle, out) {
    const { rig, chainQ, chainT, temp } = this;
    const chain = [rig.pelvis, rig.parent[rig.spine[0]], ...rig.spine];
    // 计算链上每个节点的世界四元数/平移（chainQ/chainT）
    const computeChain = (from) => {
      for (let i = from; i < chain.length; i++) {
        const bone = chain[i];
        if (i === 0) {
          for (let k = 0; k < 4; k++) chainQ[k] = out.q[bone * 4 + k];
          for (let k = 0; k < 3; k++) chainT[k] = out.t[bone * 3 + k];
          continue;
        }
        quatMulInto(chainQ, i * 4, chainQ, (i - 1) * 4, out.q, bone * 4);
        quatRotateVec3(chainQ, (i - 1) * 4, out.t[bone * 3], out.t[bone * 3 + 1], out.t[bone * 3 + 2], chainT.subarray(i * 3));
        for (let k = 0; k < 3; k++) chainT[i * 3 + k] += chainT[(i - 1) * 3 + k];
      }
    };
    computeChain(0);

    const last = chain.length - 1;
    const headQ = [chainQ[last * 4], chainQ[last * 4 + 1], chainQ[last * 4 + 2], chainQ[last * 4 + 3]];
    const headT = [chainT[last * 3], chainT[last * 3 + 1], chainT[last * 3 + 2]];

    // 逐段脊椎弯曲，权重按 SPINE_AIM_WEIGHTS 分配
    for (let i = 0; i < rig.spine.length; i++) {
      const idx = i + 2;
      const bone = chain[idx];
      const half = (angle * SPINE_AIM_WEIGHTS[i]) / 2;
      const rot = [Math.sin(half), 0, 0, Math.cos(half)];
      const curQ = [chainQ[idx * 4], chainQ[idx * 4 + 1], chainQ[idx * 4 + 2], chainQ[idx * 4 + 3]];
      quatMulInto(temp, 0, [-curQ[0], -curQ[1], -curQ[2], curQ[3]], 0, rot, 0);
      quatMulInto(temp, 0, temp, 0, curQ, 0);
      quatMulInto(out.q, bone * 4, out.q, bone * 4, temp, 0);
      computeChain(idx);
    }

    // 保持头部朝向，调整 wpnPivot
    const invHead = [-headQ[0], -headQ[1], -headQ[2], headQ[3]];
    quatMulInto(temp, 0, chainQ, last * 4, invHead, 0);
    quatRotateVec3(temp, 0, headT[0], headT[1], headT[2], temp.subarray(4));
    setWpnPivot(out, rig.wpnPivot, temp, 0, chainT[last * 3] - temp[4], chainT[last * 3 + 1] - temp[5], chainT[last * 3 + 2] - temp[6], temp);
  }
}

/** 设置武器挂点（wpnPivot）的世界位姿（原 tC） */
function setWpnPivot(pose, wpnPivot, srcQ, srcOffset, dx, dy, dz, out) {
  const qIdx = wpnPivot * 4, tIdx = wpnPivot * 3;
  quatRotateVec3(srcQ, srcOffset, pose.t[tIdx], pose.t[tIdx + 1], pose.t[tIdx + 2], out.subarray(4));
  pose.t[tIdx] = out[4] + dx;
  pose.t[tIdx + 1] = out[5] + dy;
  pose.t[tIdx + 2] = out[6] + dz;
  quatMulInto(pose.q, qIdx, srcQ, srcOffset, pose.q, qIdx);
}

/** 8 方向插值：按 moveAngle 选相邻两方向并算插值系数（原 nC） */
function pickDirection(clips, moveAngle) {
  const angle = wrapAngle(moveAngle);
  const n = clips.length;
  for (let i = 0; i < n; i++) {
    const a = clips[i].direction;
    const b = i + 1 < n ? clips[i + 1].direction : clips[0].direction + Math.PI * 2;
    let o = angle;
    if (i + 1 >= n && o < a) o += Math.PI * 2;
    if (o >= a && o < b) return [clips[i], clips[(i + 1) % n], (o - a) / (b - a)];
  }
  const a = clips[n - 1].direction - Math.PI * 2, b = clips[0].direction;
  return [clips[n - 1], clips[0], clamp01((angle - a) / (b - a))];
}

/** 角度归一化到 [0, 2π)（原 rC） */
function wrapAngle(a) { const TAU = Math.PI * 2; return a - TAU * Math.floor((a + Math.PI) / TAU); }

/** 淡入淡出权重（原 iC） */
function weightInOut(age, duration, fadeIn, fadeOut) {
  const wIn = fadeIn > 0 ? clamp01(age / fadeIn) : 1;
  const wOut = fadeOut > 0 && duration < Infinity ? clamp01((duration - age) / fadeOut) : 1;
  return Math.min(wIn, wOut);
}
function clamp01(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x; }

// ---------------------------------------------------------------------------
// 布娃娃（ragdoll）模型构建（原 aw）：从 rig + 手工调参表生成物理模型
// ---------------------------------------------------------------------------
// 各刚体（骨块）的质量与角阻尼（nw）
const RAGDOLL_BODIES = [
  { bone: `pelvis`, mass: 50, angularDamping: 2 },
  { bone: `spine_2`, mass: 50, angularDamping: 2 },
  { bone: `head_0`, mass: 12, angularDamping: 3 },
  { bone: `leg_upper_l`, mass: 35, angularDamping: 2 },
  { bone: `leg_lower_l`, mass: 25, angularDamping: 2 },
  { bone: `ankle_l`, mass: 3, angularDamping: 2 },
  { bone: `leg_upper_r`, mass: 35, angularDamping: 2 },
  { bone: `leg_lower_r`, mass: 25, angularDamping: 2 },
  { bone: `ankle_r`, mass: 3, angularDamping: 2 },
  { bone: `arm_upper_l`, mass: 7, angularDamping: 2 },
  { bone: `arm_lower_l`, mass: 7, angularDamping: 2 },
  { bone: `hand_l`, mass: 3, angularDamping: 1 },
  { bone: `arm_upper_r`, mass: 7, angularDamping: 2 },
  { bone: `arm_lower_r`, mass: 7, angularDamping: 2 },
  { bone: `hand_r`, mass: 3, angularDamping: 1 },
];
// 碰撞球体形状（rw）：每骨一条胶囊（a/b 端点 + radius）
const RAGDOLL_SHAPES = [
  { bone: `leg_upper_l`, radius: 4, a: [3.902, 0, 0.27], b: [16.181, 0, 0.267] },
  // ...（完整胶囊端点表，见原始 rw 数组，此处在反混淆时保留结构）
];
// 关节定义（iw）：父骨/子骨/连接点/角度限制/摩擦
const RAGDOLL_JOINTS = [
  { parent: `pelvis`, child: `spine_2`, origin: [9.706, 0.545, -0.006], angles: [0.953, -11.821, -0.645], hinge: false, swing: 12.61, min: -5.16, max: 33.24, friction: 0.189 },
  // ...（完整关节表见原始 iw 数组）
];

/** 构建 ragdoll 物理模型（供 PhysicsEngine 使用） */
function buildRagdollModel(rig) {
  const boneIndex = new Map();
  rig.names.forEach((name, i) => { if (rig.present[i]) boneIndex.set(name.toLowerCase(), i); });

  const n = RAGDOLL_BODIES.length;
  const bodyBone = new Int16Array(n);
  const bodyIndex = new Map();
  for (let i = 0; i < n; i++) {
    const idx = boneIndex.get(RAGDOLL_BODIES[i].bone);
    if (idx === undefined) return null;
    bodyBone[i] = idx;
    bodyIndex.set(RAGDOLL_BODIES[i].bone, i);
  }

  const { pos, rot } = rigModelSpace(rig);
  const com = new Float64Array(n * 3);       // 质心（胶囊中点）
  const mass = new Float64Array(n);
  const invMass = new Float64Array(n);
  const invInertia = new Float64Array(n * 3);
  const angularDamping = new Float64Array(n);
  const spheres = [];  // 碰撞球（每骨一条胶囊离散成多个球）

  for (let i = 0; i < n; i++) {
    const body = RAGDOLL_BODIES[i];
    const shape = RAGDOLL_SHAPES.find((s) => s.bone === body.bone);
    if (!shape) throw Error(`ragdoll body ${body.bone} has no shape`);
    const m = body.mass;
    mass[i] = m; invMass[i] = 1 / m; angularDamping[i] = body.angularDamping;
    // 胶囊端点
    const [ax, ay, az] = shape.a, [bx, by, bz] = shape.b;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    com[i * 3] = mx; com[i * 3 + 1] = my; com[i * 3 + 2] = mz;
    // 胶囊惯性矩：绕长轴 vs 垂直轴
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz), r = shape.radius;
    const iPerp = len > 0 ? 0.5 * m * r * r : 0.4 * m * r * r; // 绕长轴
    const iAlong = len > 0 ? (m * (3 * r * r + len * len)) / 12 : iPerp;
    const ex = len > 0 ? dx / len : 1, ey = len > 0 ? dy / len : 0, ez = len > 0 ? dz / len : 0;
    // 各向异性逆惯量（按长轴方向投影）
    invInertia[i * 3] = 1 / ((iAlong + (iPerp - iAlong) * ex * ex) * 7);
    invInertia[i * 3 + 1] = 1 / ((iAlong + (iPerp - iAlong) * ey * ey) * 7);
    invInertia[i * 3 + 2] = 1 / ((iAlong + (iPerp - iAlong) * ez * ez) * 7);
    // 胶囊离散成球体链
    const segs = len > 0 ? Math.ceil(len / (1.5 * r)) + 1 : 1;
    for (let s = 0; s < segs; s++) {
      const f = segs === 1 ? 0.5 : s / (segs - 1);
      spheres.push(i, ax + dx * f - mx, ay + dy * f - my, az + dz * f - mz, r);
    }
  }

  // 关节：计算每个关节的父/子偏移与旋转
  const joints = RAGDOLL_JOINTS.map((j) => {
    const pi = bodyIndex.get(j.parent), ci = bodyIndex.get(j.child);
    if (pi === undefined || ci === undefined) throw Error(`ragdoll joint ${j.parent}-${j.child} has no body`);
    const jointRot = eulerToQuat(j.angles[0], j.angles[1], j.angles[2]);
    // ...（连接点/旋转计算，详见原始 aw 函数）
    return {
      parent: pi, child: ci,
      // ⚠️ 原件（L35563）此处是 new Float64Array([e.origin[i] - 父体质心[i]])，
      //    需要从动画面板的骨骼原点读取；本改写稿未展开这部分，故置 null 并留待补齐。
      parentOffset: null,
      parentRotation: jointRot,
      // ⚠️ 原件（L35565）同 parentOffset，此处是子体质心差值；本改写稿置 null。
      childOffset: null,
      childRotation: jointRot,
      hinge: j.hinge,
      swing: (Math.PI / 180) * j.swing,
      min: j.min * (Math.PI / 180),
      max: (Math.PI / 180) * j.max,
      friction: j.friction,
    };
  });

  // 自碰撞对：排除关节相连的、以及双臂之间的碰撞
  // ...（构建 selfPairs/selfReach）
  // ⚠️ 原件里 hitBody / simulated 是两张按骨索引的映射表（Uint8Array / 布尔标记），
  //    本改写稿未展开，置 null 并留待补齐。
  return { count: n, bone: bodyBone, hitBody: null, simulated: null, com, mass, invMass, invInertia, angularDamping, joints, spheres: new Float64Array(spheres), sphereCount: spheres.length / 5, selfPairs, selfReach };
}

/** rig 模型空间位姿（原 sw）：把 rest pose 转成世界空间（累加父骨） */
function rigModelSpace(rig) {
  const pos = new Float64Array(rig.count * 3);
  const rot = new Float64Array(rig.count * 4);
  const { q, t } = rig.rest;
  for (let i = 0; i < rig.count; i++) {
    const parent = rig.parent[i];
    const lx = t[i * 3] * INCHES, ly = t[i * 3 + 1] * INCHES, lz = t[i * 3 + 2] * INCHES;
    if (parent < 0) { pos.set([lx, ly, lz], i * 3); rot.set(q.subarray(i * 4, i * 4 + 4), i * 4); continue; }
    if (parent > i) throw Error(`character rig bones must follow their parents`);
    const offset = quatRotateVec3(rot, parent * 4, lx, ly, lz);
    pos[i * 3] = pos[parent * 3] + offset[0];
    pos[i * 3 + 1] = pos[parent * 3 + 1] + offset[1];
    pos[i * 3 + 2] = pos[parent * 3 + 2] + offset[2];
    rot.set(quatMul(rot, parent * 4, q, i * 4), i * 4);
  }
  return { pos, rot };
}

// ---------------------------------------------------------------------------
// 布娃娃跌倒系统（原 _w）：死亡后驱动物理引擎摔倒
// ---------------------------------------------------------------------------
const FALL_GRID_X = 192, FALL_GRID_Y = 256, FALL_GRID_Z = 128; // fw/pw/mw
const FALL_BUDGET_MS = 4;   // hw：每帧物理预算
const MAX_CACHED_FALLS = 40; // gw

class RagdollFallSystem {
  hull = new ColliderGatherer(); // Xx
  rigs = new Map();   // rig → {model, poser}
  falls = new Map();  // entityId → fall 状态
  deadline = 0;
  box = new Box3();
  v = new Vector3();

  setCollisionObject(obj) { if (this.hull.setObject(obj)) this.falls.clear(); }
  beginFrame() { this.deadline = performance.now() + FALL_BUDGET_MS; }

  /** 获取或创建某实体的跌倒模拟 */
  fallOf(entityId, rig, makeInitial) {
    let fall = this.falls.get(entityId);
    if (fall) { this.falls.delete(entityId); this.falls.set(entityId, fall); return fall; } // LRU 刷新
    const ragdoll = this.ragdollOf(rig);
    if (!ragdoll) return null;
    const init = makeInitial();
    const grid = this.gridAround(init.root);
    fall = {
      root: init.root, pose: init.pose,
      track: new TrajectoryRecorder(ragdoll.model, grid, makeInitialState(ragdoll.poser, init.pose, init.root, init.velocity, init.force, init.hitBone)),
      poser: ragdoll.poser,
      positions: new Float64Array(ragdoll.model.count * 3),
      rotations: new Float64Array(ragdoll.model.count * 4),
    };
    this.falls.set(entityId, fall);
    if (this.falls.size > MAX_CACHED_FALLS) { // 淘汰最旧
      const oldest = this.falls.keys().next().value;
      if (oldest !== undefined) this.falls.delete(oldest);
    }
    return fall;
  }

  /** 推进跌倒模拟到时间 t，采样姿态 */
  pose(fall, t, outPose, rootOut) {
    const { track } = fall;
    for (; !track.done && track.duration < t && performance.now() < this.deadline;) track.advanceTo(t, 1);
    track.sample(t, fall.positions, fall.rotations);
    fall.poser.poseOf(fall.pose, fall.root, fall.positions, fall.rotations, outPose);
    rootOut.set(fall.positions[0], fall.positions[1], fall.positions[2]);
    return track.done ? (t >= track.duration ? `rest` : `falling`) : track.duration < t ? `behind` : `falling`;
  }

  ragdollOf(rig) {
    let ragdoll = this.rigs.get(rig);
    if (ragdoll === undefined) {
      const model = buildRagdollModel(rig);
      ragdoll = model ? { model, poser: new PhysicsModel(rig, model) } : null;
      this.rigs.set(rig, ragdoll);
    }
    return ragdoll;
  }

  gridAround(root) {
    const box = this.box.set(this.v.set(root.x - FALL_GRID_X, root.y - FALL_GRID_Y, root.z - FALL_GRID_Z), new Vector3(root.x + FALL_GRID_X, root.y + FALL_GRID_Y, root.z + FALL_GRID_Z));
    const triangles = [];
    if (this.hull.gather(box, triangles), triangles.length === 0) {
      const { x, y, z } = root, a = FALL_GRID_X;
      triangles.push(x - a, y - a, z, x + a, y - a, z, x + a, y + a, z, x - a, y - a, z, x + a, y + a, z, x - a, y + a, z);
    }
    return new CollisionGrid(new Float32Array(triangles));
  }
}

// 武器骨相对变换（原 Rw/Iw）：把世界空间挂点转回武器局部空间
const INCH_TO_UNIT_MATRIX = new Matrix4().makeScale(1 / INCHES, 1 / INCHES, 1 / INCHES);
function weaponBoneInverse(mesh) {
  const bone = mesh.userData.weaponBone;
  const m = new Matrix4();
  if (bone) {
    m.compose(new Vector3(...bone.position), new Quaternion(...bone.quaternion), new Vector3(1, 1, 1));
    m.invert();
  }
  return m;
}

// ============================================================================
// 【补充段 2026-11-09】10-character-model 切片中此前未覆盖的声明
// 依据：docs/11 §9 逐声明未覆盖清单（_S / US / WS / vS / yS 覆盖率均为 0%）
// ============================================================================

// ── L34370 `_S` → createFallbackPieceGeometry：碎片的占位三角形 ──
// 地图破坏素材还没下载完时，先用这个单三角形顶替，避免出现空洞。
// 顶点属性对齐 shader 的期望：position / normal / aAlbedo / aOrm
function createFallbackPieceGeometry() {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute([-0.5, -0.4, 0, 0.6, -0.2, 0, -0.1, 0.7, 0], 3));
  geo.setAttribute('normal', new BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('aAlbedo', new BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  // aOrm = (occlusion, roughness, metalness)；1/0.1/0 约等于「不透明、较光滑、非金属」
  geo.setAttribute('aOrm', new BufferAttribute([1, 0.1, 0, 1, 0.1, 0, 1, 0.1, 0], 3));
  return geo;
}

// ── L34380 `vS` → loadBreakPieces：加载地图的可破坏碎片素材 ──
// 返回 { statics, debris, model }：
//   statics 静止碎片（只有关卡开始时可见的）
//   debris  需要物理模拟的碎片
//   model   把 debris 合并成单个 InstancedMesh（lx），没有 debris 时为 null
// 失败不抛错，只 console.warn 并返回 null（地图破坏是可选特性）。
async function loadBreakPieces(url) {
  try {
    const pieces = await loadBreakPieceGltf(url);   // → eb
    const result = { statics: [], debris: [], model: null };
    for (const { geometry, extras } of pieces) {
      const box = geometry.boundingBox ?? new Box3().setFromBufferAttribute(geometry.getAttribute('position'));
      const entry = { geometry, glass: extras.glass === true, center: box.getCenter(new Vector3()), size: box.getSize(new Vector3()) };
      (extras.static === true ? result.statics : result.debris).push(entry);
    }
    result.model = result.debris.length > 0 ? buildDebrisModel(result.debris) : null;   // → lx
    return result;
  } catch (err) {
    console.warn('[csplayer] break pieces failed to load:', url, err);
    return null;
  }
}

// ── L34394 `yS` → disposeBreakPieces：释放碎片几何 ──
function disposeBreakPieces(pieces) {
  if (!pieces) return;
  for (const p of [...pieces.statics, ...pieces.debris]) p.geometry.dispose();
}

// ── L34686 `US` → weaponKindOf：武器名 → 大类（none/knife/c4/grenade/gun）──
// 这是决定「第一人称手部模型挂什么」的判定入口。顺序敏感：
// 先看 isKnife，再看 c4，再看投掷物集合 HS，最后都算 gun。
function weaponKindOf(weaponName, isKnife) {
  if (isKnife) return 'knife';
  if (!weaponName) return 'none';
  if (weaponName === 'c4') return 'c4';
  if (GRENADE_ITEMS.has(weaponName)) return 'grenade';
  return 'gun';
}

// ── L34689 `WS` → gunSubKindOf：枪细分（pistol / rifle / knife）──
// 只有 kind === 'gun' 才细分；手枪集合 VS 之外一律当步枪。
function gunSubKindOf(weaponName, kind) {
  if (kind !== 'gun') return 'knife';
  return PISTOL_ITEMS.has(weaponName) ? 'pistol' : 'rifle';
}

// ============================================================================
// 【补充段 2026-11-09】10-character-model 的 `aw`：ragdoll 刚体模型构建
// 原件 L35485–35619（136 行）。这是「把 demo 里的骨骼数据变成物理引擎能吃的刚体」
// 的唯一入口，输出给 07-physics-engine 的 PhysicsModel。
// ============================================================================

// 输入 e 是 demo 侧的骨架描述：{ names[], present[], parent[], count }
// 输出（被 PhysicsModel 直接消费）：
//   count/bone        刚体数 与 每个刚体对应的骨骼索引
//   hitBody           骨骼索引 → 刚体索引（-1 表示该骨骼不参与物理）
//   simulated         哪些骨骼索引被模拟（Uint8 标记）
//   com/mass/invMass  质心 / 质量 / 质量倒数
//   invInertia        逆惯性张量（3×n）
//   angularDamping    角阻尼
//   joints            关节（父/子刚体 + 偏移 + 旋转 + 铰链轴 + 摆角/限位/摩擦）
//   spheres/sphereCount  刚体近似用的一串球（每 5 个 float：x,y,z,r + 所属刚体）
//   selfPairs/selfReach  自碰撞对 与 对应的一对半径和
function buildRagdollModel(skeleton) {
  // 骨骼名 → 索引（只取 present 的）
  const boneIndexByName = new Map();
  skeleton.names.forEach((name, i) => {
    if (skeleton.present[i]) boneIndexByName.set(name.toLowerCase(), i);
  });

  // 把 RAGDOLL_BODIES 映射到骨骼索引；任何一根缺失就整体放弃（返回 null）
  const bodyCount = RAGDOLL_BODIES.length;
  const boneOf = new Int16Array(bodyCount);
  const bodyIndexByBone = new Map();
  for (let i = 0; i < bodyCount; i++) {
    const idx = boneIndexByName.get(RAGDOLL_BODIES[i].bone);
    if (idx === undefined) return null;
    boneOf[i] = idx;
    bodyIndexByBone.set(RAGDOLL_BODIES[i].bone, i);
  }

  // 取当前姿态（位置 + 四元数）
  const { pos, rot } = extractSkeletonPose(skeleton);   // → sw

  const com = new Float64Array(bodyCount * 3);
  const mass = new Float64Array(bodyCount);
  const invMass = new Float64Array(bodyCount);
  const invInertia = new Float64Array(bodyCount * 3);
  const angularDamping = new Float64Array(bodyCount);
  const spheres = [];   // 扁平的 (刚体索引, 局部x, 局部y, 局部z, 半径)

  for (let i = 0; i < bodyCount; i++) {
    const body = RAGDOLL_BODIES[i];
    const shape = RAGDOLL_SHAPES.find((s) => s.bone === body.bone);
    if (!shape) throw Error(`ragdoll body ${body.bone} has no shape`);

    const m = body.mass;
    mass[i] = m;
    invMass[i] = 1 / m;
    angularDamping[i] = body.angularDamping;

    // 形状是一个盒子（a=min 角，b=max 角），质心取中点
    const [ax, ay, az] = shape.a;
    const [bx, by, bz] = shape.b;
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    const cz = (az + bz) / 2;
    com[i * 3] = cx;
    com[i * 3 + 1] = cy;
    com[i * 3 + 2] = cz;

    // 盒子的最长边方向决定惯性主轴
    const sx = bx - ax;
    const sy = by - ay;
    const sz = bz - az;
    const len = Math.hypot(sx, sy, sz);
    const radius = shape.radius;
    // 圆柱（有长度）用 0.5mr²，球（长度 0）用 0.4mr²
    const axial = len > 0 ? 0.5 * m * radius * radius : 0.4 * m * radius * radius;
    const longitudinal = len > 0 ? (m * (3 * radius * radius + len * len)) / 12 : axial;
    const ux = len > 0 ? sx / len : 1;
    const uy = len > 0 ? sy / len : 0;
    const uz = len > 0 ? sz / len : 0;
    // 沿主轴用 longitudinal，其余两轴用 axial（椭球近似），再乘全局惯性缩放
    invInertia[i * 3] = 1 / ((longitudinal + (axial - longitudinal) * ux * ux) * INERTIA_SCALE);
    invInertia[i * 3 + 1] = 1 / ((longitudinal + (axial - longitudinal) * uy * uy) * INERTIA_SCALE);
    invInertia[i * 3 + 2] = 1 / ((longitudinal + (axial - longitudinal) * uz * uz) * INERTIA_SCALE);

    // 用一串球近似这个刚体：沿主轴每隔 1.5 半径放一个球
    const sphereSteps = len > 0 ? Math.ceil(len / (1.5 * radius)) + 1 : 1;
    for (let s = 0; s < sphereSteps; s++) {
      const t = sphereSteps === 1 ? 0.5 : s / (sphereSteps - 1);   // 单球时取中点
      spheres.push(i, ax + sx * t - cx, ay + sy * t - cy, az + sz * t - cz, radius);
    }
  }

  // ── 关节 ──
  const joints = RAGDOLL_JOINTS.map((joint) => {
    const parent = bodyIndexByBone.get(joint.parent);
    const child = bodyIndexByBone.get(joint.child);
    if (parent === undefined || child === undefined) throw Error(`ragdoll joint ${joint.parent}-${joint.child} has no body`);

    const jointRot = eulerToQuat(joint.angles[0], joint.angles[1], joint.angles[2]);   // → cw
    const pOfs = parent * 3;
    const pRotOfs = parent * 4;
    const cOfs = child * 3;
    const cRotOfs = child * 4;

    // 关节点在父体坐标系里：把 joint.origin 按父体旋转转到姿态空间，再加父体质心
    const jointPos = quatRotate(rot, pRotOfs, joint.origin[0], joint.origin[1], joint.origin[2]);   // → dw
    jointPos[0] += pos[pOfs];
    jointPos[1] += pos[pOfs + 1];
    jointPos[2] += pos[pOfs + 2];

    let parentRotation = quatMultiply(rot, pRotOfs, jointRot, 0);   // → lw
    const childRot = quatConjugate(rot, cRotOfs);                    // → uw
    const childJointPos = quatRotate(childRot, 0, jointPos[0] - pos[cOfs], jointPos[1] - pos[cOfs + 1], jointPos[2] - pos[cOfs + 2]);
    const childRotation = quatMultiply(childRot, 0, parentRotation, 0);

    const p3 = parent * 3;
    const c3 = child * 3;
    let swingDeg = joint.swing;
    let maxDeg = joint.max;

    // 上臂：摆轴要跟下臂对齐（特殊处理），摆角范围另有一套
    if (joint.child.startsWith('arm_upper_')) {
      parentRotation = alignArmJoint(rot, pRotOfs, cRotOfs, child, jointRot);   // → ow
      swingDeg = ARM_JOINT.swing;
    } else if (joint.child.startsWith('arm_lower_')) {
      maxDeg = ARM_JOINT.max;
    }

    return {
      parent,
      child,
      parentOffset: new Float64Array([joint.origin[0] - com[p3], joint.origin[1] - com[p3 + 1], joint.origin[2] - com[p3 + 2]]),
      parentRotation,
      childOffset: new Float64Array([childJointPos[0] - com[c3], childJointPos[1] - com[c3 + 1], childJointPos[2] - com[c3 + 2]]),
      childRotation,
      hinge: joint.hinge,
      swing: (Math.PI / 180) * swingDeg,
      min: joint.min * (Math.PI / 180),
      max: (Math.PI / 180) * maxDeg,
      friction: joint.friction,
    };
  });

  const sphereArr = new Float64Array(spheres);
  const sphereCount = sphereArr.length / 5;

  // 父子刚体对集合（用于排除自碰撞）
  const jointPairs = new Set(joints.map((j) => j.parent * bodyCount + j.child));
  const isArmBone = (bodyIdx) => /^(arm_upper|arm_lower|hand)_/.test(RAGDOLL_BODIES[bodyIdx].bone);
  const isTorsoBone = (bodyIdx) => RAGDOLL_BODIES[bodyIdx].bone === 'pelvis' || RAGDOLL_BODIES[bodyIdx].bone === 'spine_2';

  // ── 自碰撞对 ──
  // 规则：跳过「同一刚体 / 有关节相连 / 两只手臂之间」；骨盆与脊柱对胳膊另给更小的 reach
  const selfPairs = [];
  const selfReach = [];
  for (let a = 0; a < sphereCount; a++) {
    for (let b = a + 1; b < sphereCount; b++) {
      const ra = sphereArr[a * 5];
      const rb = sphereArr[b * 5];
      if (ra === rb || jointPairs.has(ra * bodyCount + rb) || jointPairs.has(rb * bodyCount + ra) || (isArmBone(ra) && isArmBone(rb))) continue;
      selfPairs.push(a, b);
      let reachA = sphereArr[a * 5 + 4];
      let reachB = sphereArr[b * 5 + 4];
      if (isTorsoBone(ra) && isArmBone(rb)) reachA = Math.min(reachA, ARM_TORSO_REACH);
      if (isTorsoBone(rb) && isArmBone(ra)) reachB = Math.min(reachB, ARM_TORSO_REACH);
      selfReach.push(reachA + reachB);
    }
  }

  // ── 命中映射 ──
  // simulated：哪些骨骼被物理模拟；hitBody：每根骨骼 → 最近的上游刚体（-1 = 无）
  const simulated = new Uint8Array(skeleton.count);
  for (let i = 0; i < bodyCount; i++) simulated[boneOf[i]] = 1;

  const hitBody = new Int16Array(skeleton.count).fill(-1);
  for (let b = 0; b < skeleton.count; b++) {
    for (let p = b; p >= 0; p = skeleton.parent[p]) {
      const idx = boneOf.indexOf(p);
      if (idx >= 0) {
        hitBody[b] = idx;
        break;
      }
    }
  }

  return {
    count: bodyCount,
    bone: boneOf,
    hitBody,
    simulated,
    com,
    mass,
    invMass,
    invInertia,
    angularDamping,
    joints,
    spheres: sphereArr,
    sphereCount,
    selfPairs: new Int32Array(selfPairs),
    selfReach: new Float64Array(selfReach),
  };
}

// ── L35702–35790 说明：`fw` 区的 RagdollFallSystem（_w）本文件 L846–L1000 已有完整实现，此处不重复。
// 下面只补 δ 原文件未覆盖的「调参常量」与武器骨变换表。

// ── L35773–35790 角度/尺度/预算相关常量 ──
var DEG = Math.PI / 180;           // yw
var HITGROUP_HEAD = 36;            // bw
var HITGROUP_CHEST = 52;           // xw
var HITGROUP_STOMACH = 16;         // Sw
var HITGROUP_LEG = 140;            // Cw
var TRACER_MAX_DIST = 1200;        // ww
var TRACER_FADE_DIST = 2500;       // Tw
var MAX_FALLS_PER_FRAME = 4;       // Ew
var MAX_DECALS = 40;               // Dw
var MAX_BLOOD = 12;                // Ow
var MIN_FALL_INTERVAL = 4;         // kw
var FALL_SEED_RADIUS = 64;         // Aw
var FALL_SUBSTEPS = 3;             // jw
var BUDGET_SEVERE_MS = 2e4;        // Mw
var BUDGET_WARN_MS = 12e3;         // Nw
var BUDGET_IDLE_MS = 9e3;          // Pw
var FALL_SPEED_SCALE = 0.15;       // Fw


// ── L35792 `Lw` → WEAPON_BONE_TRANSFORMS：武器骨相对变换表 ──
// 目前只有 `elite`（双持贝瑞塔）一项，因为它有**两把**武器骨，需要两个不同的变换。
// 值 = [Matrix4, Matrix4]：每个用 compose(位置, 归一化四元数, 单位缩放) 构造。
// ⚠️ 这些浮点常数是作者用编辑器调出来的，不要试图"化简"（如 0.9769 → 0.977 会改变姿态）。
var WEAPON_BONE_TRANSFORMS = new Map([
  [
    'elite',
    [
      new Matrix4().compose(
        new Vector3(-3.578, -1.581, -0.253),
        new Quaternion(-0.1273, 0.1699, 0.9769, -0.0252).normalize(),
        new Vector3(1, 1, 1),
      ),
      new Matrix4().compose(
        new Vector3(3.616, 1.361, 0.439),
        new Quaternion(0.9886, 0.0134, 0.0907, 0.1191).normalize(),
        new Vector3(1, 1, 1),
      ),
    ],
  ],
]);


// ============================================================================
// 【改动记录 2026-11-09】平滑速度改为读数据列
// 原件（src/app/10-character-model.js）**未改动**，改动只落在本文件与 speed-columns.js。
// ============================================================================
//
// ── 改动前的形态（原件 L729–742 的 SC，与 L847 的 jC）────────────────────────
//
//   function SC(data, slot, tick, pose) {
//     …
//     pose.yawRate      = computeYawRate(data, slot, tick, tickRate, numPlayers)   // 仍在用 FC 窗口
//     pose.speed        = jC(data, slot, tick, tickRate, numPlayers)               // ← 本次搬走
//     pose.distance     = computeDistance(…)                                       // 仍在用 FC 窗口
//     pose.verticalSpeed= computeVerticalSpeed(…)                                  // 仍在用 FC 窗口
//     …
//   }
//
//   function jC(data, slot, tick, tickRate, numPlayers) {
//     const { posX, posY } = data.frames
//     return !posX || !posY ? 0 : FC(data, slot, tick, tickRate, numPlayers, fC,
//                                     (a, b, dt) => MC(posX, posY, a, b, dt))
//   }
//
//   // FC：从当前 tick 往前遍历约 64 个采样帧对，做时间常数 0.1s 的指数加权积分
//   // IC(x) = 1 - (1 + n)·e^(−n),  n = x / 0.1
//   // 常量：fC = 0.1（时间常数）、mC = 600（瞬移钳制）、pC = 0.25（单帧时长上限）
//
// 这段逻辑已整体搬到 → src/deobfuscated/speed-columns.js 的 computeSpeedColumns()
//
// ── 改动后的形态 ────────────────────────────────────────────────────────────
//
//   function SC(data, slot, tick, pose) {
//     …
//     pose.yawRate       = computeYawRate(…)          // 不变
//     pose.speed         = smoothSpeedAt(data, tick, slot)   // ← 改为读列 + 插值
//     pose.distance      = computeDistance(…)         // 不变
//     pose.verticalSpeed = computeVerticalSpeed(…)    // 不变
//     …
//   }
//
//   // 从 data.frames.smoothSpeed 取值：在采样帧网格上线性插值
//   // （原 jC 在任意连续 tick 上求值；列是逐帧的，所以插值；实测误差 ≤0.54 单位/秒）
//   function smoothSpeedAt(data, tick, slot) {
//     const col = data.frames.smoothSpeed;                 // 必需列，不做空值保护
//     const ticks = data.frames.frameTick;
//     const players = data.meta.numPlayers;
//     const left = lastFrameAtOrBefore(ticks, tick);        // 原件 xC
//     const right = Math.min(left + 1, ticks.length - 1);
//     const span = ticks[right] - ticks[left];
//     const alpha = span > 0 ? Math.min(1, Math.max(0, (tick - ticks[left]) / span)) : 0;
//     const v0 = col[left * players + slot];
//     const v1 = col[right * players + slot];
//     return v0 + (v1 - v0) * alpha;
//   }
//
// ── 为什么只删 jC，保留 FC / IC / MC ────────────────────────────────────────
//
// 这三者是**共享**的：yawRate、distance、verticalSpeed 三条派生量还在用同一套窗口机制
// （原件里 FC 有 3 个调用点：L815 / L845 / L849）。只有 speed 那一条被搬走了，
// 所以只删 jC，FC/IC/MC 以及常量 fC/pC/mC 全部保留。
//
// 如果以后这三条也搬到数据提供层，可以连同 FC/IC/MC 一起删。
//
// ── 速度的消费者（别删错）────────────────────────────────────────────────────
//
//   pose.speed（本人）→ 11-character-renderer 里拷进 inputs.speed
//                    → CharacterAnimator.pose(inputs)
//                    → locomotion() 用 l/walkSpeed、(l−walkSpeed)/(runSpeed−walkSpeed)、l/crouchSpeed
//                      算走 / 跑 / 蹲的动画混合权重
//   另有 pose.speed → poseRoot() 的 Math.min(1, speed / DT) 控制姿态根偏移。
//
//   也就是说：speed 一错，人物就会「滑步」。所以这一列的语义不能改。
//
// 注意：这不等于 00c 里的 buffers.speed。那一条是「瞬时速度」，只服务于脚步声节拍和
// 开镜速度读数，两条值实测均值比 0.982 但瞬态差异很大 —— 详见 docs/07 §3.5。
