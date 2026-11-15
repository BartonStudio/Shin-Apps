// ============================================================================
// 反混淆版本：投掷物落点解析 + 「落点视角」（自动选一个能看清落点的相机位）
// 原文范围：decompiled/index.beautified.js L27991–28268（切片 00a-grenade-trajectory）
// 压缩名：Hh=WORLD_UP_Z，Uh=resolveLandingPoint，Wh/Kh=闪光候选收集，
//         qh..cg=落点视角调参常量，lg=buildLandingView，h/g/x/se=内部函数
// 依赖：three.js（B=Vector3, Nr=Sphere, V=Matrix3, gi=Ray, lr=Box3，Ih=three-mesh-bvh 的 MeshBVH）
// ⚠️ 本文件依赖上述 **three.js 压缩符号**，无法单独 import 运行（同其它 deobf 文件）。
//    若要在真实环境跑，需先在其作用域内提供 B/Nr/V/gi/lr/G/Ih 这些别名——
//    它们就是 vendor 区里 three.js r184 的实际导出名。
//
// 这个切片是**纯几何启发式**，没有网络/存储副作用。两块内容：
//   A. Uh  —— 从投掷物的采样轨迹里算出「落点」（含插值、吸附到同 tick 的 effect 点、估计入射方向）
//   B. lg  —— 给定落点和地图碰撞体，给出一台「最佳观察相机」的位置与朝向：
//            在落点周围环形+分层撒候选点 → 逐个打分（视线通畅、朝向、离落点的距离、
//            周围有多少闪光受害者/队友可看、俯仰角是否过大）→ 取最高分。
//
// 读这段代码的心态：它是**美术向的调参**，不是严格的物理。绝大多数数字都是经验权重，
// 改任何一个小数都会改变镜头选择。所以要调整观感就在这里调常量，不要动结构。
// ============================================================================

// 世界 Z 轴（Source2 是 Z-up）。给 applyAxisAngle 当旋转轴用。
var WORLD_UP_Z = new B(0, 0, 1);

// ── A. 解析落点 ─────────────────────────────────────────────────────────────
// data   : 投掷物轨迹记录 { ticks[], posXYZ[], startTick, endTick, detonationTick?, kind }
// effects: 同 tick 的特效点（用来把落点吸附到真实爆点，避免插值误差）
// 返回   : { ok:true, landing:{ tick, target, approach } } 或 { ok:false, reason }
function resolveLandingPoint(grenade, effects) {
  const { ticks, posXYZ } = grenade;
  const detonationTick = grenade.detonationTick ?? grenade.endTick;
  const NO_LANDING = { ok: false, reason: 'This grenade has no valid recorded landing position.' };

  // 轨迹必须自洽：有 tick、位置数组长度 = tick 数 × 3、引爆 tick 合法
  if (!ticks.length || posXYZ.length !== ticks.length * 3 || !Number.isFinite(detonationTick) || detonationTick < grenade.startTick) {
    return NO_LANDING;
  }

  // 找到 detonationTick 落在哪两个采样之间（左端点索引）
  let left = 0;
  for (; left + 1 < ticks.length && ticks[left + 1] <= detonationTick; ) left++;

  // 在左端点上做线性插值，得到引爆时刻的位置
  const target = new B().fromArray(posXYZ, left * 3);
  if (left + 1 < ticks.length) {
    const span = ticks[left + 1] - ticks[left];
    if (span > 0) {
      target.lerp(new B().fromArray(posXYZ, (left + 1) * 3), Vt.clamp((detonationTick - ticks[left]) / span, 0, 1));
    }
  }
  if (![target.x, target.y, target.z].every(Number.isFinite)) return NO_LANDING;

  // 吸附：在同 kind 且 startTick === 引爆 tick 的特效点里找最近的一个（距离平方 <= 4096，即 64 单位内）
  let snapped = undefined;
  let bestDistSq = 4096;
  for (const fx of effects) {
    if (fx.kind !== grenade.kind || fx.startTick !== detonationTick) continue;
    const d2 = target.distanceToSquared(new B(fx.x, fx.y, fx.z));
    if (d2 <= bestDistSq) {
      bestDistSq = d2;
      snapped = fx;
    }
  }
  if (snapped) target.set(snapped.x, snapped.y, snapped.z);

  // 入射方向：从落点往回找最近一个「水平距离 >= 32 单位」(1024 = 32²) 的采样点，作为来向
  const approach = new B(1, 0, 0);
  for (let i = left; i >= 0; i--) {
    const back = new B(posXYZ[i * 3] - target.x, posXYZ[i * 3 + 1] - target.y, 0);
    if (back.lengthSq() >= 1024) {
      approach.copy(back).normalize();
      break;
    }
  }

  return { ok: true, landing: { tick: detonationTick, target, approach } };
}

// ── B1. 闪光弹的「受害者候选点」────────────────────────────────────────────
// 用途：闪光爆开时，谁的屏幕白得最厉害 → 这些人的位置就是「有价值的观察目标」。
// 返回 [{ position, weight }]：weight 越大越值得看（被闪的人 > 敌人 > 队友）。
var FLASH_WEIGHT_EPS = 0.3; // 闪光增量低于此值忽略
var FLASH_NEAR_RADIUS = 1500; // 未被闪到时，只推荐这个半径内的敌人

function collectFlashCandidates(data, grenade, tick, viewerPosition) {
  if (grenade.kind !== 'flash') return [];
  const { frames } = data;
  const numPlayers = data.meta.numPlayers;
  const frameTick = frames.frameTick;
  if (!numPlayers || !frameTick.length || frames.flash.length < frameTick.length * numPlayers) return [];

  // 二分找到第一个 frameTick >= tick 的位置，再退一格当基准帧
  let lo = 0;
  let hi = frameTick.length;
  for (; lo < hi; ) {
    const mid = (lo + hi) >> 1;
    if (frameTick[mid] < tick) lo = mid + 1;
    else hi = mid;
  }
  const base = lo - 1;
  if (base < 0 || lo >= frameTick.length) return [];

  const throwerSlot = grenade.throwerSlot;
  const throwerTeam = throwerSlot >= 0 && throwerSlot < numPlayers ? frames.team[base * numPlayers + throwerSlot] : 0;

  const out = [];
  for (let p = 0; p < numPlayers; p++) {
    const baseIdx = base * numPlayers + p;
    if (!frames.alive[baseIdx]) continue;

    // 在 [base, base+2s] 窗口里找该玩家 flash 增量最大的那一帧
    let peakGain = 0;
    let peakFrame = lo;
    for (let f = lo; f < frameTick.length && (f === lo || frameTick[f] <= tick + 2); f++) {
      const gain = frames.flash[f * numPlayers + p] - frames.flash[baseIdx];
      if (gain > peakGain) {
        peakGain = gain;
        peakFrame = f;
      }
    }

    const peakIdx = peakFrame * numPlayers + p;
    const position = new B(frames.posX[peakIdx], frames.posY[peakIdx], frames.posZ[peakIdx]);
    if (![position.x, position.y, position.z].every(Number.isFinite)) continue;

    const isEnemy = !throwerTeam || frames.team[baseIdx] !== throwerTeam;

    if (peakGain > FLASH_WEIGHT_EPS) {
      // 确实被闪到了：投掷者自己权重最低，敌人最高
      out.push({ position, weight: p === throwerSlot ? 1 : isEnemy ? 3 : 1.5 });
    } else if (isEnemy && position.distanceTo(viewerPosition) <= FLASH_NEAR_RADIUS) {
      // 没被闪但离得近的敌人（说明他就在爆点附近）
      out.push({ position, weight: 0.75 });
    }
  }
  return out;
}

// ── B2. 落点视角的调参常量 ─────────────────────────────────────────────────
var CHEST_HEIGHT = 48;                       // qh：脚 → 胸口的抬升
var MAX_VIEW_ANGLE = Vt.degToRad(28);        // Jh：允许的最大偏角（28°）
var MAX_CANDIDATE_DIST = 2200;               // Yh：候选点距离超过此值权重清零
var MIN_DIST_FACTOR = 260;                   // Xh：相机离落点的最小距离下限
var LOW_GROUND_DELTA = 160;                  // Zh：落点高于地面多少才认为「有高低差」→ 加高处环
var HIGH_ANGLE_SOFT = Vt.degToRad(22);       // Qh：仰角软约束（高差相机）
var HIGH_ANGLE_HARD = Vt.degToRad(30);       // $h：仰角硬惩罚起点
var RING_RADII = [96, 160, 240, 320, 420];   // eg：主环半径（落点周围撒点）
var INNER_RING_RADII = [96, 160, 240];       // tg：有高低差时，在高处再撒一圈
var HEIGHT_STEPS = [32, 64, 96, 160];        // ng：每个候选列的离地高度候选
var EXTRA_HEIGHT_STEPS = [48, 96];           // rg：额外的相对落点高度候选
var LIFT_ABOVE_LANDING = 16;                 // ig：落点视角的抬升
var MAX_EXTRA_HEIGHT = 320;                  // ag：额外高度上限
var AZIMUTH_STEPS = 16;                      // og：环向切分数（16 个方位）
var MAX_COLUMN_HITS = 4;                     // sg：单列最多取几层地面
var Z_SCAN_RANGE = 256;                      // cg：竖直扫描的余量

// ── B3. 主函数：计算落点视角 ───────────────────────────────────────────────
// data       : 全局 data
// effects    : 投掷物特效点（给 resolveLandingPoint 用）
// mapRoot    : 已加载的地图 Object3D（必须有碰撞几何）
// candidates : collectFlashCandidates 的结果（用于评价「这个机位能看到多少人」）
function buildLandingView(data, effects, mapRoot, candidates = []) {
  const landingRes = resolveLandingPoint(data, effects);
  if (!landingRes.ok) return landingRes;
  if (!mapRoot) return { ok: false, reason: 'Landing view needs loaded map geometry. Try again once the map loads.' };

  mapRoot.updateWorldMatrix(true, true);
  const mapBox = new lr().setFromObject(mapRoot);

  // 收集所有网格的 BVH 碰撞体（three-mesh-bvh），并缓存其逆矩阵
  const colliders = [];
  mapRoot.traverse((obj) => {
    if (!(obj instanceof G) || !obj.geometry.getAttribute('position')) return;
    const geo = obj.geometry;
    if (!(geo.boundsTree instanceof Ih)) geo.boundsTree = new Ih(geo, { indirect: true });
    colliders.push({ tree: geo.boundsTree, inverse: obj.matrixWorld.clone().invert(), world: obj.matrixWorld.clone() });
  });
  if (!colliders.length) return { ok: false, reason: 'Landing view needs map collision geometry.' };

  // 向内收缩 12 单位当作可用区域（避免贴墙/贴边）
  const usable = mapBox.clone().expandByScalar(-12);
  const { target, approach, tick } = landingRes.landing;

  // 落点必须在地图包围盒内
  if (target.x < mapBox.min.x || target.x > mapBox.max.x || target.y < mapBox.min.y || target.y > mapBox.max.y || target.z < mapBox.min.z) {
    return { ok: false, reason: 'The recorded landing is outside the loaded map.' };
  }

  const ray = new gi();
  const tmpVec = new B();
  const tmpSphere = new Nr();
  const tmpMat3 = new V();

  // 从 from 到 to 做一次「最近的」射线测试，返回 {point, normal} 或 null
  function raycastClosest(from, to) {
    let best = null;
    let bestDist = from.distanceTo(to);
    for (const c of colliders) {
      ray.origin.copy(from).applyMatrix4(c.inverse);
      ray.direction.copy(tmpVec.copy(to).applyMatrix4(c.inverse)).sub(ray.origin);
      const len = ray.direction.length();
      if (len < 1e-6) continue;
      ray.direction.multiplyScalar(1 / len);
      const hit = c.tree.raycastFirst(ray, 2, 0.01, len); // 2 = DoubleSide
      if (!hit?.face) continue;
      const point = hit.point.clone().applyMatrix4(c.world);
      const dist = from.distanceTo(point);
      if (dist >= bestDist) continue;
      bestDist = dist;
      best = { point, normal: hit.face.normal.clone().applyMatrix3(tmpMat3.getNormalMatrix(c.world)).normalize() };
    }
    return best;
  }

  // 该点周围 radius=12 的球是否不与任何碰撞体相交（= 有空间站人/放相机）
  function isPointClear(p) {
    return colliders.every((c) => (tmpSphere.set(p, 12).applyMatrix4(c.inverse), !c.tree.intersectsSphere(tmpSphere)));
  }

  // 候选观察目标（人）：抬到胸口高度；若胸口被遮挡则该目标权重降为 1/4
  const people = candidates
    .filter((c) => c.weight > 0 && [c.position.x, c.position.y, c.position.z].every(Number.isFinite))
    .map((c) => {
      const chest = c.position.clone().setZ(c.position.z + CHEST_HEIGHT);
      return { chest, feet: c.position, weight: raycastClosest(target, chest) ? c.weight * 0.25 : c.weight };
    });
  people.sort((a, b) => b.weight - a.weight);
  const totalWeight = people.reduce((sum, c) => sum + c.weight, 0);

  // 竖直扫描范围
  const zTop = Math.min(mapBox.max.z + 1, Math.max(target.z, ...people.map((c) => c.chest.z)) + Z_SCAN_RANGE);
  const zBottom = Math.max(mapBox.min.z - 1, Math.min(target.z, ...people.map((c) => c.feet.z)) - 1024);

  // 沿 (x,y) 向下打竖直射线，收集「可站立的水平面」高度（法线朝上 >= 0.5）
  function columnGroundZ(x, y) {
    const hits = [];
    const from = new B(x, y, zTop);
    const to = new B(x, y, zBottom);
    for (let i = 0; i < 10 && hits.length < MAX_COLUMN_HITS && from.z > to.z; i++) {
      const hit = raycastClosest(from, to);
      if (!hit) break;
      if (hit.normal.z >= 0.5) hits.push(hit.point.z);
      from.z = hit.point.z - 1;
    }
    return hits;
  }

  // 落点所在地面高度：优先用人群的加权脚底高度，否则向下打一条射线
  let groundZ = target.z;
  if (totalWeight > 0) {
    groundZ = people.reduce((sum, c) => sum + c.feet.z * c.weight, 0) / totalWeight;
  } else {
    const hit = raycastClosest(target, new B(target.x, target.y, zBottom));
    if (hit) groundZ = hit.point.z;
  }

  const heightDelta = target.z - groundZ; // 落点相对地面有多高（炸弹在空中爆 / 落在高台）
  const preferredDist = Math.max(MIN_DIST_FACTOR, heightDelta * 1.1);
  const elevatedAnchor = heightDelta > LOW_GROUND_DELTA ? new B(target.x, target.y, groundZ + CHEST_HEIGHT) : null;
  const ringRadii = elevatedAnchor ? [...RING_RADII, 560, 720] : RING_RADII;

  // 基准方位：从落点「看向来向」的反方向（即观察者站在来向侧）
  const baseAzimuth = Math.atan2(approach.y, approach.x) + Math.PI;

  // 生成候选点（极坐标 → 笛卡尔）
  const spots = [];
  for (let i = 0; i < AZIMUTH_STEPS; i++) {
    const azimuth = baseAzimuth + (i * Math.PI * 2) / AZIMUTH_STEPS;
    for (const radius of ringRadii) {
      spots.push({ x: target.x + Math.cos(azimuth) * radius, y: target.y + Math.sin(azimuth) * radius, azimuth, radius });
    }
  }
  // 有高低差时，在人群质心周围再撒一圈内环
  if (totalWeight > 0) {
    const centroid = people.reduce((acc, c) => acc.addScaledVector(c.feet, c.weight), new B()).multiplyScalar(1 / totalWeight);
    for (let i = 0; i < AZIMUTH_STEPS; i++) {
      const azimuth = baseAzimuth + (i * Math.PI * 2) / AZIMUTH_STEPS;
      for (const radius of INNER_RING_RADII) {
        const x = centroid.x + Math.cos(azimuth) * radius;
        const y = centroid.y + Math.sin(azimuth) * radius;
        spots.push({ x, y, azimuth: Math.atan2(y - target.y, x - target.x), radius: Math.hypot(x - target.x, y - target.y) });
      }
    }
  }

  // ── 把候选点展开成三维机位，并给每个机位一个基础分 ──
  const cameraSpots = [];
  const AZIMUTH_BONUS = totalWeight > 0 ? 1.5 : 4;
  // 某人对机位的贡献：距离越远权重越低（1.4 - d/1500，钳在 0.35..1），超过 2200 直接 0
  const personWeightAt = (person, dist) => (dist > MAX_CANDIDATE_DIST ? 0 : person.weight * Vt.clamp(1.4 - dist / 1500, 0.35, 1));

  for (const spot of spots) {
    if (spot.x < usable.min.x || spot.x > usable.max.x || spot.y < usable.min.y || spot.y > usable.max.y) continue;
    for (const groundHit of columnGroundZ(spot.x, spot.y)) {
      // 惩罚：离落点太高或太低
      const zPenalty = Math.max(0, groundHit - groundZ - 150) / 24 + Math.max(0, groundZ - groundHit - 200) / 32;
      const heights = [...HEIGHT_STEPS];
      for (const extra of EXTRA_HEIGHT_STEPS) {
        const h = target.z + extra - groundHit;
        if (h > HEIGHT_STEPS[HEIGHT_STEPS.length - 1] && h <= MAX_EXTRA_HEIGHT) heights.push(h);
      }
      for (const h of heights) {
        const position = new B(spot.x, spot.y, groundHit + h);
        if (!usable.containsPoint(position)) continue;
        // 基础分：朝向加成 + 高度加成 - 与期望距离的偏差 - 高度惩罚
        const base =
          Math.cos(spot.azimuth - baseAzimuth) * AZIMUTH_BONUS +
          Math.min(h, 160) / 48 -
          Math.abs(position.distanceTo(target) - preferredDist) / 80 -
          zPenalty;
        // 能看到的人带来的加成
        let visible = 0;
        for (const person of people) visible += personWeightAt(person, position.distanceTo(person.chest));
        cameraSpots.push({ position, base, bound: base + visible * 6 + 3 + 9 });
      }
    }
  }
  cameraSpots.sort((a, b) => b.bound - a.bound);

  // ── 逐个机位精确打分，取最高 ──
  const toTarget = new B();
  const aim = new B();
  const flat = new B();
  const toElevated = new B();
  const axis = new B();
  const visiblePeople = [];
  let bestSpot = null;
  let bestScore = -Infinity;

  function scoreSpot(lookFrom) {
    for (const spot of cameraSpots) {
      if (spot.bound <= bestScore) break; // 上界都被超越，后面不用看
      if (!isPointClear(spot.position)) continue;

      const targetVisible = !raycastClosest(spot.position, lookFrom);
      if (!targetVisible && !people.length) continue;

      visiblePeople.length = 0;
      let weightSum = 0;
      let remaining = (spot.bound - spot.base - 12) / 6;
      let score = spot.base + (targetVisible ? 3 : 0) + 9;

      for (const person of people) {
        const w = personWeightAt(person, spot.position.distanceTo(person.chest));
        if (!w) continue;
        remaining -= w;
        if (raycastClosest(spot.position, person.chest)) {
          if (score + (weightSum + remaining) * 6 <= bestScore) break;
          continue;
        }
        visiblePeople.push({ direction: person.chest.clone().sub(spot.position).normalize(), weight: w });
        weightSum += w;
      }
      if ((!targetVisible && !visiblePeople.length) || score + weightSum * 6 <= bestScore) continue;

      // 朝向：先指向落点，再被人群方向"拉"过去（迭代 2 次修正偏角）
      toTarget.copy(lookFrom).sub(spot.position).normalize();
      aim.copy(toTarget);
      if (visiblePeople.length) {
        aim.multiplyScalar(targetVisible ? 2 : 0);
        for (const person of visiblePeople) aim.addScaledVector(person.direction, person.weight);
        for (let iter = 0; iter < 2; iter++) {
          if (aim.lengthSq() < 1e-6) aim.copy(toTarget);
          aim.normalize();
          const delta = new B();
          if (targetVisible && aim.angleTo(toTarget) <= MAX_VIEW_ANGLE) delta.addScaledVector(toTarget, 2);
          for (const person of visiblePeople) {
            if (aim.angleTo(person.direction) <= MAX_VIEW_ANGLE) delta.addScaledVector(person.direction, person.weight);
          }
          if (delta.lengthSq() > 1e-6) aim.copy(delta);
        }
        aim.normalize();
      }

      // 有高台且没人可看时：把朝向抬高到高台方向（受角度软/硬约束）
      if (elevatedAnchor && !visiblePeople.length) {
        toElevated.copy(elevatedAnchor).sub(spot.position).normalize();
        const maxAngle = targetVisible ? HIGH_ANGLE_SOFT - aim.angleTo(toTarget) : MAX_VIEW_ANGLE;
        const angle = Math.min(aim.angleTo(toElevated), Math.max(0, maxAngle));
        axis.crossVectors(aim, toElevated);
        if (angle > 1e-4 && axis.lengthSq() > 1e-8) aim.applyAxisAngle(axis.normalize(), angle);
      }

      // 计分：可见权重 + 目标可见加成 - 仰角惩罚
      let seenWeight = 0;
      for (const person of visiblePeople) if (aim.angleTo(person.direction) <= MAX_VIEW_ANGLE) seenWeight += person.weight;
      const seesTarget = targetVisible && aim.angleTo(toTarget) <= MAX_VIEW_ANGLE;
      const upAngle = Math.asin(Vt.clamp(Math.abs(aim.z), 0, 1));
      const scoreNow = spot.base + seenWeight * 6 + (seesTarget ? 3 : 0) - Math.max(0, upAngle - HIGH_ANGLE_HARD) * 8;
      if (scoreNow + 9 <= bestScore) continue;

      // 侧向可见性：水平方向左右各 30° 是否被挡（被挡则降权）
      let blockedSides = 0;
      flat.set(aim.x, aim.y, 0);
      if (flat.lengthSq() > 1e-6) {
        flat.normalize();
        for (const yaw of [-Math.PI / 6, 0, Math.PI / 6]) {
          const dir = flat.clone().applyAxisAngle(WORLD_UP_Z, yaw);
          if (!raycastClosest(spot.position, spot.position.clone().addScaledVector(dir, 96))) blockedSides++;
        }
      }
      const finalScore = scoreNow + blockedSides * 3;
      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestSpot = { position: spot.position, aim: aim.clone(), look: lookFrom };
      }
    }
  }

  scoreSpot(target);
  const lifted = target.clone().setZ(target.z + LIFT_ABOVE_LANDING);
  if ((!bestSpot && !raycastClosest(target, lifted) && scoreSpot(lifted), !bestSpot)) {
    return { ok: false, reason: 'No clear, in-bounds landing view was found here. Use the thrower replay instead.' };
  }

  // 最终朝向：若瞄准方向与「看向落点」几乎一致，就直接看落点；否则沿 aim 方向拉远
  const look =
    bestSpot.aim.angleTo(bestSpot.look.clone().sub(bestSpot.position)) < 1e-4
      ? bestSpot.look
      : bestSpot.position.clone().addScaledVector(bestSpot.aim, Math.max(64, bestSpot.position.distanceTo(bestSpot.look)));

  return { ok: true, position: bestSpot.position, target: look, tick };
}
