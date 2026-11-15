// ============================================================================
// 反混淆版本：角色渲染器（CharacterRenderer）
// 原始压缩文件：src/app/11-character-renderer.js
// 原文范围：decompiled/index.beautified.js L35810–37125（切片 11-character-renderer）
// 压缩类名：zw=CharacterRenderer, UT=ViewModelRenderer, fT=MuzzleFlash
// 说明：把"角色模型 + 动画合成"的结果渲染到场景。分两个视角：
//   1. CharacterRenderer（zw）：第三人称，所有玩家的完整身体（t.glb/ct.glb）
//   2. ViewModelRenderer（UT）：第一人称，玩家自己的手臂 + 武器（fp/ 目录）
//  这里也是"像素块 vs 真实模型"的关键：setEnabled(true) 触发 load() 加载
//  角色 glb + 动画，成功则真实模型，失败则保留胶囊体兜底。
// ============================================================================

// ---------------------------------------------------------------------------
// 角色渲染器（原 zw）：第三人称角色
// ---------------------------------------------------------------------------
const CORPSE_CENTER_Z = 36;  // bw：尸体球心高度
const ALIVE_RADIUS = 52;     // xw：存活角色剔除半径
const CORPSE_RADIUS = 140;   // Cw：尸体剔除半径
const BODY_CENTER_Z = 16;    // Sw
const LIT_RANGE = 40;        // Dw：光照采样点高度
const CORPSE_LIT_Z = 12;     // Ow
const LIT_REFRESH_DIST = 4;  // Ew：光照重采样距离阈值
const MAX_POSE_SCAN = 64;    // Aw：跌倒回溯帧数
const FALL_ALIGN_TICKS = 3;  // jw
const CORPSE_REST_TICKS = 4; // kw：死亡 ragdoll 对齐窗口

class CharacterRenderer {
  group = new Group();
  lighting;        // SceneLighting
  numPlayers;
  bodies;          // [playerIdx][teamIdx] = body 对象
  weapons = new Map();       // weapon name → {requested, geometry, attach}
  weaponMaterials = [];
  templates = null;          // [t, ct] 两套角色模板（含 animator）
  gait = null;               // 步态周期计算器
  loading = null;            // load() Promise
  enabled = false;
  disposed = false;
  frame = 0;
  inputs = makePlayerState();   // 动画输入状态
  motion = makeMotionState();   // 运动状态
  air = { weight: 0, age: 0 };
  frustum = new Frustum();
  projScreen = new Matrix4();
  sphere = new Sphere();
  cameraPos = new Vector3();
  corpseIndex = null;
  falls = new RagdollFallSystem();
  drawnAlive;    // 本帧实际绘制的存活角色
  xrayOnly;      // 只画 X 光轮廓的角色（被遮挡）

  constructor(scene, numPlayers, lighting) {
    this.lighting = lighting;
    this.numPlayers = numPlayers;
    this.drawnAlive = new Uint8Array(numPlayers);
    this.xrayOnly = new Uint8Array(numPlayers);
    this.bodies = Array.from({ length: numPlayers }, () => [null, null]); // [T, CT]
    this.group.name = `characters`;
    this.group.visible = false;
    scene.add(this.group);
  }

  get active() { return this.enabled && this.templates !== null; }

  /** 启用角色渲染（触发异步加载角色模型） */
  setEnabled(enabled) {
    this.enabled = enabled;
    this.group.visible = this.active;
    if (this.enabled && !this.loading) {
      this.loading = this.load().catch((e) => {
        console.warn(`[csplayer] character models failed to load; keeping capsules`, e);
      });
    }
  }

  setCollisionObject(obj) {
    this.falls.setCollisionObject(obj);
    for (const pair of this.bodies) for (const body of pair) if (body) body.stale = true;
  }

  /**
   * 每帧更新：遍历所有玩家，设置位姿、剔除、光照采样
   */
  update(data, frame, tick, camera, selfIdx = -1, xrayMaskFn, showSelf = false) {
    const templates = this.templates;
    this.group.visible = this.active;
    this.drawnAlive.fill(0);
    this.xrayOnly.fill(0);
    if (!this.active || !templates) return;

    this.frame++;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    this.cameraPos.setFromMatrixPosition(camera.matrixWorld);

    const bomb = bombState(data, tick); // Tg
    const defuserSlot = bomb ? bomb.defuserSlot : -1;
    const defuseAge = bomb ? Math.max(0, bomb.durationSeconds - bomb.remainingSeconds) : Infinity;
    const { tickRate } = data.meta;
    const playerCount = Math.min(this.numPlayers, frame.alive.length);

    this.falls.beginFrame();
    for (let p = 0; p < playerCount; p++) {
      const alive = frame.alive[p] === 1;
      const corpse = alive ? null : this.corpseAt(data, p, tick);
      const team = alive ? frame.team[p] : corpse ? corpse.team : 0;
      const teamIdx = team === 2 ? 0 : team === 3 ? 1 : -1;
      const isSelf = alive && xrayMaskFn?.[p] === 1;
      let drawable = teamIdx >= 0 && p !== selfIdx && (alive ? !isSelf || showSelf : corpse !== null);
      const x = alive ? frame.x[p] : (corpse?.x ?? 0);
      const y = alive ? frame.y[p] : (corpse?.y ?? 0);
      const z = alive ? frame.z[p] : (corpse?.z ?? 0);

      // 视锥剔除
      drawable &&=
        (this.sphere.center.set(x, y, z + (alive ? CORPSE_CENTER_Z : BODY_CENTER_Z)),
        this.sphere.radius = alive ? ALIVE_RADIUS : CORPSE_RADIUS,
        this.frustum.intersectsSphere(this.sphere));

      const pair = this.bodies[p];
      for (let t = 0; t < 2; t++) {
        const body = pair[t];
        if (body && (!drawable || t !== teamIdx)) hideBody(body);
      }
      if (!drawable) continue;

      if (alive) this.drawnAlive[p] = 1;
      const tIdx = teamIdx;
      const template = templates[tIdx];
      let body = pair[tIdx];
      if (!body) body = pair[tIdx] = this.createBody(template);

      const fall = corpse ? this.fallOf(data, corpse, template.animator) : null;

      // 设置根节点世界矩阵（尸体用 ragdoll 位置，活人用 demo 位置 + yaw）
      if (fall) setRootMatrix(body.root.matrix, fall.root.x, fall.root.y, fall.root.z, fall.root.yaw);
      else setRootMatrix(body.root.matrix, x, y, z, frame.yaw[p] * DEG2RAD);
      body.root.matrixWorldNeedsUpdate = true;
      if (!body.shown) { body.shown = true; body.stale = true; body.root.matrixWorldAutoUpdate = true; }
      body.root.visible = !isSelf;
      if (isSelf) this.xrayOnly[p] = 1;

      if (this.needsPose(body, tick, corpse, x, y, z, p)) {
        if (corpse) {
          this.setWeapon(body, ``);
          const age = Math.max(0, (tick - corpse.startTick) / tickRate);
          if (fall) body.corpsePhase = this.falls.pose(fall, age, body.pose, body.corpseCenter);
          else {
            this.inputs.death = template.animator.deathClips[0] ?? ``;
            this.inputs.deathAge = age;
            if (this.inputs.death) template.animator.pose(this.inputs, body.pose);
            else copyPose(template.animator.rig.rest, body.pose);
            body.corpsePhase = age > CORPSE_REST_TICKS ? `rest` : `falling`;
          }
        } else {
          const pitch = frame.pitch[p];
          if (pitch > 180) pitch -= 360;
          this.aliveInputs(data, p, tick, frame.yaw[p], pitch, frame.duck[p], defuserSlot === p ? defuseAge : Infinity);
          this.setWeapon(body,
            this.inputs.kind === `knife` ? knifeModel(this.motion.weapon, team)
            : (this.inputs.kind === `gun` || this.inputs.kind === `grenade` || this.inputs.kind === `c4`) ? this.inputs.weapon : ``);
          template.animator.pose(this.inputs, body.pose);
        }
        applyPoseToBones(body); // qw：把姿态写入骨骼矩阵
        body.posedTick = tick;
        body.posedCorpse = corpse;
        body.stale = false;
      }

      if (isSelf) continue;
      // 光照采样（版本 + 距离触发重采样）
      const litPoint = corpse && fall
        ? this.sphere.center.copy(body.corpseCenter).setZ(body.corpseCenter.z + CORPSE_LIT_Z)
        : this.sphere.center.set(x, y, z + LIT_RANGE);
      const ver = this.lighting.version;
      if (body.litVersion !== ver || body.litAt.distanceToSquared(litPoint) > LIT_REFRESH_DIST ** 2) {
        body.litVersion = ver;
        body.litAt.copy(litPoint);
        this.lighting.sample(litPoint.x, litPoint.y, litPoint.z, body.light);
        applyLightUniforms(body.uniforms, body.light); // Iy
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    for (const pair of this.bodies) for (const body of pair) if (body) disposeBody(body);
    for (const m of this.weaponMaterials) m.dispose();
    for (const w of this.weapons.values()) w.geometry?.dispose();
    this.weapons.clear();
    if (this.templates) for (const t of this.templates) disposeScene(t.scene);
    this.templates = null;
  }

  /** 渲染 X 光轮廓（被墙体遮挡的队友显示轮廓） */
  renderXrayMask(renderer, camera, colorOf) {
    if (!this.active) return;
    const masked = [], hidden = [];
    for (let p = 0; p < this.bodies.length; p++) {
      for (const body of this.bodies[p]) {
        if (!body?.shown) continue;
        if (this.drawnAlive[p] !== 1) { body.root.visible = false; hidden.push(body); continue; }
        body.xrayMask.uniforms.uColor.value.copy(colorOf(p));
        body.xrayMask.uniforms.uAlpha.value = this.xrayOnly[p] === 1 ? 1 : 0.5;
        for (const part of body.parts) part.material = body.xrayMask;
        if (this.xrayOnly[p] === 1) body.root.visible = true;
        masked.push(body);
      }
    }
    const prevAuto = this.group.matrixWorldAutoUpdate;
    this.group.matrixWorldAutoUpdate = false;
    try {
      if (masked.length > 0) renderer.render(this.group, camera);
    } finally {
      this.group.matrixWorldAutoUpdate = prevAuto;
      for (const body of masked) body.parts.forEach((part, i) => { part.material = body.partMaterials[i]; });
      for (const body of hidden) body.root.visible = true;
      for (let p = 0; p < this.bodies.length; p++)
        if (this.xrayOnly[p] === 1) for (const body of this.bodies[p]) if (body?.shown) body.root.visible = false;
    }
  }

  /** 加载角色模型（t.glb / ct.glb + anims.bin） */
  async load() {
    const [t, ct, anims] = await Promise.all([loadGltf(`characters/t.glb`), loadGltf(`characters/ct.glb`), loadAnims(`characters/anims.bin`)]);
    if (this.disposed) { disposeScene(t.scene); disposeScene(ct.scene); return; }
    const templates = [makeTemplate(t.scene, anims), makeTemplate(ct.scene, anims)];
    this.gait = new GaitCycle(templates[1].animator.gait);
    this.templates = templates;
    this.group.visible = this.active;
  }

  /** 判断某角色本帧是否需要重新计算姿态（LOD 分档） */
  needsPose(body, tick, corpse, x, y, z, playerIdx) {
    if (body.stale || body.posedCorpse !== corpse || (corpse && body.corpsePhase === `behind`)) return true;
    if (body.posedTick === tick) return false;
    if (corpse) return !(body.corpsePhase === `rest` && tick >= body.posedTick);
    // 距离 LOD：远角色降帧率
    const dist = this.cameraPos.distanceTo(this.sphere.center.set(x, y, z));
    const level = dist > 2500 ? 3 : dist > 1200 ? 2 : 1; // Tw/ww
    return level === 1 || (this.frame + playerIdx) % level === 0;
  }

  /** 从 demo 帧数据提取动画输入状态 */
  aliveInputs(data, playerIdx, tick, yaw, pitch, duck, defuseAge) {
    const s = this.inputs;
    const motion = deriveMotion(data, playerIdx, tick, this.motion); // SC
    const weapon = weaponModelName(motion.weapon) ?? ``; // Yy
    const kind = weaponKind(weapon, hasWeaponModel(motion.weapon)); // US/Xy
    const yawRad = yaw * DEG2RAD;
    const moveHeading = headingOf(data, playerIdx, tick); // KC
    airState(data, playerIdx, tick, this.air); // XC
    s.time = tick / data.meta.tickRate;
    s.weapon = weapon;
    s.kind = kind;
    s.speed = motion.speed;
    s.moveAngle = Number.isNaN(moveHeading) ? 0 : moveHeading - yawRad;
    s.phase = this.gait?.at(data, playerIdx, tick) ?? 0;
    s.duck = duck;
    s.air = this.air.weight;
    s.airAge = this.air.age;
    s.pitch = pitch;
    s.equipAge = motion.equipAge;
    s.fireAge = motion.fireAge;
    s.reloadAge = motion.reloadAge;
    s.reloading = motion.reloading;
    s.pinPulled = motion.pinPulled;
    s.pinAge = motion.pinAge;
    s.plantAge = motion.planting ? motion.plantAge : Infinity;
    s.defuseAge = defuseAge;
    s.death = ``;
    s.deathAge = 0;
  }

  /** 查某玩家某 tick 是否处于死亡状态（尸体） */
  corpseAt(data, playerIdx, tick) {
    let idx = this.corpseIndex;
    if (!idx || idx.markers !== data.deathMarkers) {
      const bySlot = Array.from({ length: this.numPlayers }, () => []);
      for (const m of data.deathMarkers) bySlot[m.victimSlot]?.push(m);
      for (const list of bySlot) list.sort((a, b) => a.startTick - b.startTick);
      idx = this.corpseIndex = { markers: data.deathMarkers, bySlot };
    }
    const list = idx.bySlot[playerIdx];
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!(m.startTick > tick)) return tick < m.endTick ? m : null;
    }
    return null;
  }

  fallOf(data, corpse, animator) {
    return this.falls.fallOf(corpse, animator.rig, () => this.fallStart(data, corpse, animator));
  }

  /** 计算跌倒初始状态（位置/速度/受力/命中骨） */
  fallStart(data, corpse, animator) {
    const { frameTick, yaw, pitch, duck, alive, posX, posY, posZ } = data.frames;
    const { numPlayers, tickRate } = data.meta;
    const slot = corpse.victimSlot;
    let frame = upperBound(frameTick, corpse.startTick);
    for (let i = 0; i < MAX_POSE_SCAN && frame > 0 && alive[frame * numPlayers + slot] !== 1; i++) frame--;
    const idx = frame * numPlayers + slot;
    const pose = makePose(animator.rig.count);
    if (frameTick.length === 0)
      return (copyPose(animator.rig.rest, pose),
        { pose, root: { x: corpse.x, y: corpse.y, z: corpse.z, yaw: 0 }, velocity: [0, 0, 0], force: [0, 0, 0], hitBone: -1 });

    let p = pitch[idx];
    if (p > 180) p -= 360;
    this.aliveInputs(data, slot, frameTick[frame], yaw[idx], p, duck[idx], Infinity);
    animator.pose(this.inputs, pose);

    // 死亡瞬间速度（用前一帧差分）
    const vel = [0, 0, 0];
    const prevIdx = (frame - 1) * numPlayers + slot;
    const dt = frame > 0 ? (frameTick[frame] - frameTick[frame - 1]) / tickRate : 0;
    if (dt > 0 && dt < 0.5 && alive[prevIdx] === 1) {
      vel[0] = (posX[idx] - posX[prevIdx]) / dt;
      vel[1] = (posY[idx] - posY[prevIdx]) / dt;
      vel[2] = (posZ[idx] - posZ[prevIdx]) / dt;
    }
    const root = { x: corpse.x, y: corpse.y, z: corpse.z, yaw: yaw[idx] * DEG2RAD };
    // 优先用 demo 记录的死因（服务器端 ragdoll 数据）
    const recorded = data.deathRagdolls?.find((r) => r.slot === slot && Math.abs(r.tick - corpse.startTick) <= FALL_ALIGN_TICKS);
    return recorded
      ? { pose, root, velocity: vel, force: recorded.force, hitBone: recorded.bone }
      : { pose, root, velocity: vel, ...deathImpulse(data, corpse, animator.rig.names, frame) };
  }

  /** 创建角色 body（克隆模板 + 绑定骨架 + 创建材质） */
  createBody(template) {
    const root = new Group();
    root.matrixAutoUpdate = false;
    const scene = cloneWithSkeleton(template.scene); // Hw
    root.add(scene);

    const bonesByName = new Map();
    const skinnedMeshes = [];
    scene.traverse((obj) => {
      if (obj instanceof Bone) bonesByName.set(obj.name, obj);
      if (obj instanceof SkinnedMesh) skinnedMeshes.push(obj);
      obj.frustumCulled = false;
    });

    const rig = template.animator.rig;
    const bones = rig.names.map((n) => bonesByName.get(n) ?? null);
    for (const b of bones) if (b) b.matrixAutoUpdate = false;

    // 统一骨架（若有多套骨架，重绑定到第一套）
    const skeleton = skinnedMeshes[0].skeleton;
    for (const mesh of skinnedMeshes) {
      if (mesh.skeleton !== skeleton) {
        const old = mesh.skeleton;
        mesh.bind(skeleton, mesh.bindMatrix);
        old.dispose();
      }
    }

    const uniforms = makeObjectUniforms(); // Fy
    const materialMap = new Map();
    const makeMat = (mat) => {
      let m = materialMap.get(mat);
      if (!m) { m = this.lighting.createMaterial(materialParamsOf(mat, uniforms)); m.name = mat.name; materialMap.set(mat, m); }
      return m;
    };
    for (const mesh of skinnedMeshes)
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(makeMat) : makeMat(mesh.material);

    const weaponMat = this.lighting.createMaterial({ surface: `vertex`, object: uniforms });
    this.weaponMaterials.push(weaponMat);
    const makeHolder = () => { const m = new Mesh(undefined, weaponMat); m.frustumCulled = false; m.visible = false; m.matrixAutoUpdate = false; return m; };
    const makeMount = (name) => { const o = new Object3D(); o.matrixAutoUpdate = false; o.matrix.copy(INCH_TO_UNIT_MATRIX); bonesByName.get(name)?.add(o); return o; };
    const weapon = makeHolder(), weaponLeft = makeHolder();
    const mounts = { wpn: makeMount(`wpn`), handR: makeMount(`hand_R`) };
    mounts.wpn.add(weapon);
    makeMount(`hand_L`).add(weaponLeft);
    root.visible = false;
    root.matrixWorldAutoUpdate = false;
    this.group.add(root);

    const parts = [...skinnedMeshes, weapon, weaponLeft];
    return {
      root, bones, skeleton, uniforms,
      materials: [...materialMap.values()],
      weapon, weaponLeft, mounts, weaponFile: ``,
      parts, partMaterials: parts.map((p) => p.material),
      xrayMask: makeXrayMask(),
      pose: makePose(rig.count),
      light: makeLightSample(), // Rv
      litAt: new Vector3(), litVersion: -1,
      shown: false, posedTick: NaN, posedCorpse: null,
      corpsePhase: `falling`, corpseCenter: new Vector3(), stale: true,
    };
  }

  /** 设置/加载手持武器模型 */
  setWeapon(body, weaponName) {
    let entry;
    if (weaponName) {
      entry = this.weapons.get(weaponName);
      if (!entry) { entry = { requested: false, geometry: null, attach: new Matrix4() }; this.weapons.set(weaponName, entry); }
      if (!entry.requested) this.requestWeapon(weaponName, entry);
    }
    const geometry = entry?.geometry ?? null;
    const dual = DUAL_WIELD_ATTACH.get(weaponName); // Lw
    body.weaponFile = weaponName;
    body.weapon.visible = geometry !== null;
    body.weaponLeft.visible = geometry !== null && dual !== undefined;
    if (entry && geometry && body.weapon.geometry !== geometry) {
      (dual ? body.mounts.handR : body.mounts.wpn).add(body.weapon);
      body.weapon.matrix.copy(dual ? dual[0] : entry.attach);
      body.weaponLeft.matrix.copy(dual ? dual[1] : entry.attach);
      for (const holder of [body.weapon, body.weaponLeft]) { holder.geometry = geometry; holder.matrixWorldNeedsUpdate = true; }
    }
  }

  requestWeapon(name, entry) {
    entry.requested = true;
    loadGltf(weaponPath(`world`, name))
      .then((gltf) => {
        if (this.disposed) gltf.dispose();
        else {
          entry.geometry = gltf;
          entry.attach = weaponBoneInverse(gltf); // Rw
          for (const pair of this.bodies) for (const body of pair) if (body?.weaponFile === name) body.stale = true;
        }
      })
      .catch((e) => console.warn(`[csplayer] held weapon model ${name} failed to load`, e));
  }
}

// ---------------------------------------------------------------------------
// 角色模板构建（原 Vw/Hw/Uw）
// ---------------------------------------------------------------------------
/** 从 gltf scene + 动画构建角色模板（含 animator） */
function makeTemplate(scene, anims) {
  scene.updateMatrixWorld(true);
  const bonesByName = new Map();
  scene.traverse((obj) => { if (obj instanceof Bone) bonesByName.set(obj.name, obj); });
  return {
    scene,
    animator: new CharacterAnimator(anims, buildRig(anims.bones, (name) => {
      const bone = bonesByName.get(name);
      return bone ? {
        parent: bone.parent instanceof Bone && bonesByName.has(bone.parent.name) ? bone.parent.name : null,
        quaternion: bone.quaternion.toArray(),
        position: bone.position.toArray(),
      } : null;
    })),
  };
}

/** 深拷贝场景并重绑定骨架（原 Hw） */
function cloneWithSkeleton(scene) {
  const clone = scene.clone(true);
  const originals = [], clones = [];
  scene.traverse((o) => originals.push(o));
  clone.traverse((o) => clones.push(o));
  const map = new Map();
  for (let i = 0; i < originals.length; i++) map.set(originals[i], clones[i]);
  for (let i = 0; i < originals.length; i++) {
    const orig = originals[i], cl = clones[i];
    if (!(orig instanceof SkinnedMesh) || !(cl instanceof SkinnedMesh)) continue;
    const skeleton = orig.skeleton;
    const clonedBones = skeleton.bones.map((b) => map.get(b));
    cl.bind(new Skeleton(clonedBones, skeleton.boneInverses), orig.bindMatrix);
  }
  return clone;
}

/** 把材质参数转为本工程的自定义 PBR 材质（原 Uw） */
function materialParamsOf(material, uniforms) {
  return material instanceof MeshStandardMaterial
    ? { surface: `textured`, map: material.map ?? solidColorMap(material.color), ormMap: material.aoMap ?? material.roughnessMap ?? material.metalnessMap, ormFactors: [1, material.roughness, material.metalness], normalMap: material.normalMap, alphaTest: material.alphaTest, side: material.side, object: uniforms }
    : { surface: `textured`, map: solidColorMap(new Color(0.5, 0.5, 0.5)), ormFactors: [1, 0.8, 0], object: uniforms };
}

/** 单色 1×1 纹理（原 Ww） */
function solidColorMap(color) {
  const to255 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  const tex = new DataTexture(new Uint8Array([to255(color.r), to255(color.g), to255(color.b), 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// 死亡冲量计算（原 Gw）：根据击杀武器决定 ragdoll 受力
// ---------------------------------------------------------------------------
const IMPULSE_GUN = 2e4, IMPULSE_KNIFE = 12e3, IMPULSE_GRENADE = 9e3; // Mw/Nw/Pw
const IMPULSE_Z = 0.15; // Fw

function deathImpulse(data, corpse, boneNames, frame) {
  const result = { force: [0, 0, 0], hitBone: -1 };
  let killEvent = null;
  for (const ev of data.events) {
    if (ev.tick > corpse.startTick + FALL_ALIGN_TICKS) break;
    if (ev.type === `kill` && ev.victimSlot === corpse.victimSlot && corpse.startTick - ev.tick <= FALL_ALIGN_TICKS) killEvent = ev;
  }
  const attacker = killEvent?.attackerSlot;
  if (!killEvent || attacker === undefined || attacker === corpse.victimSlot || attacker < 0 || attacker >= data.meta.numPlayers) return result;

  const weapon = (killEvent.weapon ?? ``).toLowerCase();
  const magnitude = /inferno|molotov|incgrenade|world|c4|hurt|fall/.test(weapon) ? 0
    : weapon.includes(`hegrenade`) ? IMPULSE_GRENADE
    : /knife|bayonet|taser/.test(weapon) ? IMPULSE_KNIFE : IMPULSE_GUN;

  const atIdx = frame * data.meta.numPlayers + attacker;
  const dx = corpse.x - data.frames.posX[atIdx];
  const dy = corpse.y - data.frames.posY[atIdx];
  const dist = Math.hypot(dx, dy);
  if (magnitude === 0 || dist < 1) return result;
  const forceXY = magnitude / Math.hypot(1, IMPULSE_Z);
  const hitBone = boneNames.indexOf(killEvent.headshot ? `head_0` : `spine_2`);
  return { force: [(dx / dist) * forceXY, (dy / dist) * forceXY, IMPULSE_Z * forceXY], hitBone };
}

// ---------------------------------------------------------------------------
// 姿态 → 骨骼矩阵（原 qw）：把 pose 的四元数/平移写成 4×4 矩阵
// ---------------------------------------------------------------------------
function applyPoseToBones(body) {
  const { q, t } = body.pose;
  const bones = body.bones;
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    if (!bone) continue;
    const m = bone.matrix.elements;
    const x = q[i * 4], y = q[i * 4 + 1], z = q[i * 4 + 2], w = q[i * 4 + 3];
    // 四元数 → 旋转矩阵（标准公式）
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    m[0] = 1 - (yy + zz); m[1] = xy + wz; m[2] = xz - wy; m[3] = 0;
    m[4] = xy - wz; m[5] = 1 - (xx + zz); m[6] = yz + wx; m[7] = 0;
    m[8] = xz + wy; m[9] = yz - wx; m[10] = 1 - (xx + yy); m[11] = 0;
    m[12] = t[i * 3]; m[13] = t[i * 3 + 1]; m[14] = t[i * 3 + 2]; m[15] = 1;
  }
}

/** X 光轮廓材质（原 Jw）：纯色 + 透明度 */
function makeXrayMask() {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0.5 } },
    toneMapped: false,
    vertexShader: `
      #include <skinning_pars_vertex>
      void main() {
        vec3 transformed = position;
        #include <skinbase_vertex>
        #include <skinning_vertex>
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      void main() { gl_FragColor = vec4(uColor, uAlpha); }`,
  });
}

/** 隐藏 body（原 Yw） */
function hideBody(body) {
  if (body.shown) { body.shown = false; body.root.visible = false; body.root.matrixWorldAutoUpdate = false; }
}
/** 销毁 body（原 Xw） */
function disposeBody(body) {
  for (const mat of body.materials) {
    const map = mat.uniforms.uColorMap?.value;
    if (map instanceof DataTexture) map.dispose();
    mat.dispose();
  }
  body.xrayMask.dispose();
  body.skeleton.dispose();
  body.root.removeFromParent();
}
/** 销毁整个场景（原 Zw） */
function disposeScene(scene) {
  scene.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (mat instanceof MeshStandardMaterial) for (const tex of [mat.map, mat.aoMap, mat.roughnessMap, mat.metalnessMap, mat.normalMap]) tex?.dispose();
        mat.dispose();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 步态周期（原 GC）：根据速度/步幅累计相位
// ---------------------------------------------------------------------------
const GAIT_STRIDE_MAX = 600; // zC
const GAIT_FRAME_GAP = 0.25; // RC

class GaitCycle {
  cache = new WeakMap();
  cycle;
  constructor(cycle) { this.cycle = cycle; }

  /** 某玩家某 tick 的累计步态相位（跨帧累加步数） */
  at(data, playerIdx, tick) {
    const { frameTick, posX, posY, alive, duck } = data.frames;
    const { tickRate, numPlayers } = data.meta;
    const n = frameTick.length;
    if (!posX || !posY || n < 2) return 0;
    let perPlayer = this.cache.get(posX);
    if (!perPlayer) this.cache.set(posX, (perPlayer = new Map()));
    let accum = perPlayer.get(playerIdx);
    if (!accum) {
      accum = new Float64Array(n);
      for (let i = 0; i + 1 < n; i++) {
        const a = i * numPlayers + playerIdx, b = a + numPlayers;
        const dt = (frameTick[i + 1] - frameTick[i]) / tickRate;
        let step = 0;
        if (dt > 0 && dt <= GAIT_FRAME_GAP && alive[a] === 1 && alive[b] === 1) {
          const dist = Math.hypot(posX[b] - posX[a], posY[b] - posY[a]);
          const speed = dist / dt;
          if (speed <= GAIT_STRIDE_MAX) step = dist / strideFor(this.cycle, speed, (duck[a] + duck[b]) / 2);
        }
        accum[i + 1] = accum[i] + step;
      }
      perPlayer.set(playerIdx, accum);
    }
    const i = upperBound(frameTick, tick);
    if (i >= n - 1) return accum[n - 1];
    const dt = frameTick[i + 1] - frameTick[i];
    const frac = dt > 0 ? Math.min(1, Math.max(0, (tick - frameTick[i]) / dt)) : 0;
    return accum[i] + (accum[i + 1] - accum[i]) * frac;
  }
}

// ---------------------------------------------------------------------------
// 第一人称视角模型渲染器（原 UT）：玩家自己的手臂 + 武器
// ---------------------------------------------------------------------------
const VIEWMODEL_ACTIONS = [`draw`, `idle`, `shoot`, `shoot2`, `reload`, `pullpin`, `hold`, `plant`]; // AT

class ViewModelRenderer {
  scene = new Scene();
  camera = new PerspectiveCamera(fovForAspect(4 / 3), 4 / 3, 0.01, 10);
  root = new Group();
  container = new Group();
  flash = new MuzzleFlash();
  rigs = new Map();      // weapon → {value: rig}
  arms = null;
  shown = null;
  motion = makeMotionState();
  anim = makeAnimState();
  matrix = new Matrix4();
  quaternion = new Quaternion();
  identity = new Quaternion();
  disposed = false;
  lighting;
  objectUniforms = makeObjectUniforms();
  light = makeLightSample();
  flashColor = new Color();
  flashOffset = new Vector3();
  foleyPose = null;

  constructor(lighting) {
    this.lighting = lighting;
    this.container.rotation.y = Math.PI;
    this.container.position.set(VIEWMODEL_OFFSET[0] * INCHES, VIEWMODEL_OFFSET[2] * INCHES, -VIEWMODEL_OFFSET[1] * INCHES);
    this.root.add(this.container);
    this.root.visible = false;
    this.scene.add(this.root, this.flash.object, this.camera);
  }

  update(ctx) {
    const { data } = ctx;
    const motion = deriveMotion(data, ctx.slot, ctx.tick, this.motion);
    const team = data.panelFrames.team.length ? data.panelFrames.team[this.panelFrame(ctx) * data.meta.numPlayers + ctx.slot] : 0;
    const weapon = motion.weapon ? viewmodelPath(motion.weapon, team) : undefined;
    const rig = weapon ? this.rigFor(weapon).value : null;
    const arms = this.armsRig().value;
    if (!weapon || !rig || !arms) return (this.hide(), false);

    if (this.shown !== rig) {
      if (this.shown) this.container.remove(this.shown.scene);
      this.container.add(rig.scene, arms.scene);
      this.shown = rig;
    }
    if (this.camera.aspect !== ctx.aspect) {
      this.camera.aspect = ctx.aspect;
      this.camera.fov = fovForAspect(ctx.aspect);
      this.camera.updateProjectionMatrix();
    }

    const time = ctx.tick / data.meta.tickRate;
    this.poseRoot(motion, ctx);
    const anim = resolveAnimState(motion, rig.clips, time, this.anim);
    this.animate(rig, anim);
    const role = anim.current.role;
    this.foleyPose = role ? { file: weapon, role, time: anim.current.time, duration: rig.clips[role] ?? 0 } : null;
    this.poseArms(rig, arms);
    this.poseFlash(motion, weapon, rig, ctx.tick / data.meta.tickRate - motion.fireAge);
    this.applyLighting(ctx.camera);
    this.root.visible = true;
    return true;
  }

  applyLighting(camera) {
    const lighting = this.lighting;
    lighting.setView(camera);
    const origin = lighting.view.uViewOrigin.value;
    applyLightUniforms(this.objectUniforms, lighting.sample(origin.x, origin.y, origin.z, this.light));
    const flashLight = this.flash.light;
    const flashPos = this.objectUniforms.uFlashPos.value;
    if (flashLight.intensity <= 0) { flashPos.w = 0; return; }
    const color = this.flashColor.copy(flashLight.color).multiplyScalar(flashLight.intensity * 1.5);
    this.objectUniforms.uFlashColor.value.set(color.r, color.g, color.b);
    const offset = this.flashOffset.copy(flashLight.position).multiplyScalar(lighting.view.uViewScale.value).applyMatrix3(lighting.view.uViewToWorld.value);
    flashPos.set(origin.x + offset.x, origin.y + offset.y, origin.z + offset.z, 60);
  }

  hide() { this.root.visible = false; this.foleyPose = null; this.flash.hide(); }

  render(renderer) {
    if (!this.root.visible) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.clearDepth(); renderer.render(this.scene, this.camera); }
    finally { renderer.autoClear = prevAutoClear; }
  }

  dispose() {
    this.disposed = true;
    this.flash.dispose();
    for (const { value } of this.rigs.values()) if (value) { value.mixer.stopAllAction(); disposeViewModel(value.scene); }
    if (this.arms?.value) disposeViewModel(this.arms.value.scene);
    this.rigs.clear();
  }

  panelFrame(ctx) {
    const ticks = ctx.data.panelFrames.frameTick;
    let lo = 0, hi = ticks.length - 1;
    if (hi < 0 || ctx.tick <= ticks[0]) return 0;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; ticks[mid] <= ctx.tick ? (lo = mid) : (hi = mid - 1); }
    return lo;
  }

  /** 根节点晃动（移动/转向/落地/呼吸的相机晃动） */
  poseRoot(motion, ctx) {
    const sway = Math.min(1, motion.speed / 250) * (1 - 0.5 * ctx.duck);
    const bobPhase = (motion.distance / 147) * Math.PI * 2;
    const turn = Math.tanh(motion.yawRate / 360);
    const bob = -0.9 * Math.tanh(motion.verticalSpeed / 400);
    const landBlend = Math.min(1, Math.max(0, (motion.landSpeed - 120) / (520 - 120)));
    const landAge = motion.landAge / 0.09;
    const landBounce = Number.isFinite(landAge) ? 1.4 * landBlend * landAge * Math.exp(1 - landAge) : 0;
    this.root.position.set(
      (0.45 * sway * Math.sin(bobPhase) + 1.2 * turn) * INCHES,
      (-0.35 * sway * Math.abs(Math.cos(bobPhase)) + bob - landBounce) * INCHES,
      0,
    );
    this.root.rotation.set((0.6 * bob - 0.8 * landBounce) * DEG2RAD, -3 * turn * DEG2RAD, 0);
  }

  /** 驱动动画混合器：设置当前/上一动作的权重与时间 */
  animate(rig, anim) {
    for (const [name, [cur, prev]] of rig.actions) {
      setAction(cur, name === anim.current.role ? anim.weight : 0, anim.current.time);
      setAction(prev, name === anim.previous.role ? 1 - anim.weight : 0, anim.previous.time);
    }
    rig.mixer.update(0);
    this.root.updateMatrixWorld(true);
    // 把武器 rig 对齐到 wpn 骨骼
    this.matrix.copy(rig.scene.matrixWorld).invert().multiply(rig.wpn.matrixWorld).multiply(WEAPON_RIG_FIX);
    rig.weaponRig.matrix.copy(this.matrix);
    rig.weaponRig.updateMatrixWorld(true);
  }

  /** 手臂跟随武器 rig 的 driven 骨骼 */
  poseArms(rig, arms) {
    for (const [name, bone] of rig.driven) {
      const armBone = arms.bones.get(name);
      if (armBone) { armBone.position.copy(bone.position); armBone.quaternion.copy(bone.quaternion); armBone.scale.copy(bone.scale); }
    }
    for (const twist of arms.twists) {
      const q = this.quaternion.copy(twist.hand.quaternion).multiply(twist.handRestInverse);
      q.set(q.x, 0, 0, q.w).normalize();
      twist.bone.quaternion.copy(this.identity).slerp(q, twist.amount).multiply(twist.rest);
    }
  }

  poseFlash(motion, weapon, rig, fireAge) {
    const useShoot2 = motion.fireVariant === 1 && rig.clips.shoot2 !== undefined;
    const muzzle = rig.muzzles[+!!useShoot2];
    if (!muzzle || NON_MUZZLE_WEAPON.test(weapon) || SILENCED.has(weapon) || !(motion.fireAge < 0.05)) { this.flash.hide(); return; }
    const scale = 0.16 * (PISTOL_SET.has(weapon) ? 0.75 : SNIPER_SET.has(weapon) ? 1.25 : 1);
    this.flash.show(muzzle, scale, motion.fireAge, fireAge);
  }

  rigFor(weapon) {
    let entry = this.rigs.get(weapon);
    if (entry) return entry;
    entry = { value: null };
    this.rigs.set(weapon, entry);
    this.load(weapon, (gltf) => { entry.value = makeViewModel(gltf); });
    return entry;
  }

  armsRig() {
    if (this.arms) return this.arms;
    const entry = { value: null };
    this.arms = entry;
    this.load(`arms`, (gltf) => { entry.value = makeArms(gltf); });
    return entry;
  }

  load(path, done) {
    loadGltf(viewmodelPath2(path))
      .then((gltf) => { this.useWeaponMaterials(gltf.scene); this.disposed ? disposeViewModel(gltf.scene) : done(gltf); })
      .catch((e) => console.warn(`[csplayer] viewmodel ${path} failed to load`, e));
  }

  useWeaponMaterials(scene) {
    const cache = new Map();
    const convert = (mat) => {
      if (!(mat instanceof MeshStandardMaterial)) return mat;
      let m = cache.get(mat);
      if (!m) {
        const orm = mat.aoMap ?? mat.roughnessMap ?? mat.metalnessMap;
        m = this.lighting.createMaterial({ surface: `textured`, viewSpace: true, map: mat.map, ormMap: orm, ormFactors: [1, mat.roughness, mat.metalness], normalMap: mat.normalMap, alphaTest: mat.alphaTest, side: mat.side, object: this.objectUniforms });
        m.name = mat.name;
        cache.set(mat, m);
        mat.dispose();
      }
      return m;
    };
    scene.traverse((obj) => { if (obj instanceof Mesh) obj.material = Array.isArray(obj.material) ? obj.material.map(convert) : convert(obj.material); });
  }
}

/** 构建第一人称武器 rig（原 WT） */
function makeViewModel(gltf) {
  const { scene } = gltf;
  disableFrustumCulling(scene);
  const viewmodel = findNode(scene, `viewmodel`);
  const weaponRig = findNode(scene, `weapon_rig`);
  weaponRig.matrixAutoUpdate = false;
  const mixer = new AnimationMixer(scene);
  const actions = new Map(), clips = {};
  for (const anim of gltf.animations) {
    const name = anim.name;
    if (!VIEWMODEL_ACTIONS.includes(name)) continue;
    if (anim.duration <= 0 && name !== `hold`) continue;
    clips[name] = anim.duration;
    actions.set(name, [mixer.clipAction(anim), mixer.clipAction(anim.clone())]);
  }
  const bones = new Map();
  viewmodel.traverse((obj) => { if (obj !== viewmodel) bones.set(obj.name, obj); });
  const byName = (n) => weaponRig.getObjectByName(n) ?? null;
  return {
    scene, mixer, actions, clips, weaponRig,
    wpn: findNode(viewmodel, `wpn`),
    muzzles: [byName(`muzzle`) ?? byName(`muzzle_l`), byName(`muzzle_r`)],
    driven: bones,
  };
}

/** 构建手臂 rig（原 GT） */
function makeArms(gltf) {
  disableFrustumCulling(gltf.scene);
  const bones = new Map();
  gltf.scene.traverse((obj) => bones.set(obj.name, obj));
  const twists = [];
  for (const side of [`L`, `R`]) {
    const hand = bones.get(`hand_${side}`);
    if (hand)
      for (const [name, amount] of [[`arm_lower_${side}_TWIST1`, 0.5], [`arm_lower_${side}_TWIST`, 0.25]]) {
        const bone = bones.get(name);
        if (bone) twists.push({ bone, rest: bone.quaternion.clone(), hand, handRestInverse: hand.quaternion.clone().invert(), amount });
      }
  }
  return { scene: gltf.scene, bones, twists };
}

/** 设置动作状态（原 KT） */
function setAction(action, weight, time) {
  if (weight <= 0) { if (action.isRunning()) action.stop(); return; }
  action.enabled = true;
  action.setEffectiveWeight(weight);
  if (!action.isRunning()) action.play();
  action.time = time;
}
function disableFrustumCulling(scene) { scene.traverse((o) => { if (o instanceof Mesh) o.frustumCulled = false; }); }
function disposeViewModel(scene) {
  scene.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (mat instanceof ShaderMaterial) for (const k of [`uColorMap`, `uOrmMap`, `uNormalMap`]) mat.uniforms[k]?.value?.dispose();
        mat.dispose();
      }
    }
  });
}
function findNode(scene, name) { const n = scene.getObjectByName(name); if (!n) throw Error(`viewmodel rig has no ${name}`); return n; }

// ---------------------------------------------------------------------------
// 动画状态机（原 nT/aT/oT/sT/cT/rT/iT）：解析武器动作序列
// ---------------------------------------------------------------------------
function resolveAnimState(motion, clips, time, out) {
  const idle = clips.idle ?? 0;
  const setRole = (state, t) => { state.role = idle > 0 ? `idle` : null; state.time = idle > 0 ? wrapMod(t, idle) : 0; };
  out.weight = 1;
  setRole(out.previous, time);

  const sorted = sortedActions(motion, clips);
  const first = sorted[0];
  if (!first) { setRole(out.current, time); return out; }

  const firstDur = clips[first.role];
  const reloadHolding = first.role === `reload` && motion.reloading && firstDur < 1;
  if (first.age < firstDur || reloadHolding) {
    setRoleTimed(out.current, first, first.age, firstDur, reloadHolding);
    if (first.role === `draw` || first.age >= 0.1) return out;
    // 淡入过渡
    out.weight = smoothstep(first.age / 0.1);
    const second = sorted[1];
    const secondAge = second ? second.age - first.age : Infinity;
    if (second && secondAge < clips[second.role]) setRoleTimed(out.previous, second, secondAge, clips[second.role], false);
    else if (second?.role === `pullpin`) setHold(out.previous, secondAge - clips.pullpin, clips);
    else setRole(out.previous, time - first.age);
    return out;
  }

  const overage = first.age - firstDur;
  if (first.role === `plant`) { setRoleTimed(out.current, first, firstDur, firstDur, false); return out; }
  if (isPullpinHeld(first, motion, clips)) {
    setHold(out.current, overage, clips);
    if (clips.hold !== undefined && overage < 0.1) { out.weight = smoothstep(overage / 0.1); setRoleTimed(out.previous, first, firstDur, firstDur, false); }
    return out;
  }
  setRole(out.current, time);
  if (overage < 0.1 && !(first.role === `reload` && firstDur < 1)) {
    out.weight = smoothstep(overage / 0.1);
    setRoleTimed(out.previous, first, firstDur, firstDur, false);
  }
  return out;
}

function sortedActions(motion, clips) {
  const shootRole = (v) => (v === 1 && clips.shoot2 ? `shoot2` : `shoot`);
  return [
    { role: `draw`, age: motion.equipAge },
    { role: shootRole(motion.fireVariant), age: motion.fireAge },
    { role: shootRole(1 - motion.fireVariant), age: motion.prevFireAge },
    { role: `reload`, age: motion.reloadAge },
    { role: `pullpin`, age: motion.pinAge },
    { role: `plant`, age: motion.plantAge },
  ]
    .filter((a) => Number.isFinite(a.age) && a.age >= 0 && a.age <= motion.equipAge && (clips[a.role] ?? 0) > 0)
    .sort((a, b) => a.age - b.age);
}
function setRoleTimed(state, action, age, dur, hold) { state.role = action.role; state.time = hold ? wrapMod(age, dur) : Math.min(age, dur - 1e-4); }
function setHold(state, overage, clips) { const hold = clips.hold; if (hold === undefined) { state.role = `pullpin`; state.time = clips.pullpin - 1e-4; return; } state.role = `hold`; state.time = hold > 0 ? wrapMod(overage, hold) : 0; }
function isPullpinHeld(action, motion, clips) { return action.role === `pullpin` && motion.pinPulled && action.age >= clips.pullpin; }
function wrapMod(x, m) { return ((x % m) + m) % m; }
function smoothstep(x) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------------------
// 枪口闪光（原 fT）：第一人称开火时的火焰特效
// ---------------------------------------------------------------------------
const MUZZLE_ADDITIVE = { blending: AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, toneMapped: false };

class MuzzleFlash {
  object = new Group();
  light = new PointLight(16752704, 0, 1.5, 2);
  core;
  flames = new Group();
  burst;
  materials = [];
  textures = [];
  scale = new Vector3();

  constructor() {
    const coreTex = this.texture(makeCoreTexture());
    const flameTex = this.texture(makeFlameTexture());
    const burstTex = this.texture(makeBurstTexture());
    const coreMat = new SpriteMaterial({ map: coreTex, ...MUZZLE_ADDITIVE });
    this.materials.push([coreMat, 1]);
    this.core = new Sprite(coreMat);
    this.core.position.x = 0.1;

    const flameMat = this.material(flameTex, 0.5);
    const flameGeo = new PlaneGeometry(1, 1).translate(0.5, 0, 0);
    for (const angle of [0, Math.PI / 2]) {
      const flame = new Mesh(flameGeo, flameMat);
      flame.rotation.x = angle;
      this.flames.add(flame);
    }
    this.burst = new Mesh(new PlaneGeometry(1, 1).rotateY(Math.PI / 2), this.material(burstTex, 1));
    this.burst.position.x = 0.08;
    this.object.add(this.flames, this.burst, this.core);
    for (const obj of [this.core, ...this.flames.children, this.burst]) { obj.renderOrder = 10; obj.frustumCulled = false; }
    this.hide();
  }

  show(muzzle, scale, age, seedTime) {
    const fade = Math.min(1, Math.max(0, age / 0.05));
    if (fade >= 1) { this.hide(); return; }
    const intensity = fade < 0.25 ? 1 : (1 - (fade - 0.25) / (1 - 0.25)) ** 2;
    const rand = lcg(Math.floor(seedTime * 1e3) >>> 0);
    const s = 0.85 + 0.35 * fade;
    muzzle.matrixWorld.decompose(this.object.position, this.object.quaternion, this.scale);
    this.object.scale.setScalar(scale * s);
    this.object.visible = true;
    this.core.scale.setScalar(0.75 + 0.2 * rand());
    this.flames.rotation.x = (rand() * Math.PI) / 2;
    this.flames.scale.set(0.9 + 0.5 * rand(), 0.45, 0.45);
    this.burst.rotation.x = rand() * Math.PI * 2;
    this.burst.scale.setScalar(0.9 + 0.3 * rand());
    for (const [mat, base] of this.materials) mat.opacity = base * intensity;
    this.light.position.copy(this.object.position);
    this.light.intensity = 2.5 * intensity;
  }

  hide() { this.object.visible = false; this.light.intensity = 0; }

  dispose() {
    for (const [mat] of this.materials) mat.dispose();
    for (const tex of this.textures) tex.dispose();
    this.flames.children.forEach((m) => m.geometry.dispose());
    this.burst.geometry.dispose();
  }

  texture(img) { const t = new CanvasTexture(img); t.colorSpace = SRGBColorSpace; this.textures.push(t); return t; }
  material(tex, opacity) { const m = new MeshBasicMaterial({ map: tex, side: DoubleSide, ...MUZZLE_ADDITIVE }); this.materials.push([m, opacity]); return m; }
}

function lcg(seed) {
  let t = seed;
  return () => {
    t = (t + 1831565813) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
