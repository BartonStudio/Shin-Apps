# Player 主控类（TP）渲染循环逐行解析

> 这是整个应用的"心脏"。方法名和字段名都保留了原意，只需把局部变量 `e/t/n/r/i/a/o/s/c` 还原即可。
> 原始位置：decompiled/index.beautified.js 47359–48976 行。下面给出 `sampleAndRender`（48050 行起）的完整还原。

## 类字段（语义名已保留）

```js
class Player {
  // 数据
  model            // 帧采样模型（把 SoA 按 tick 采样 + 插值）
  data             // 解析结果（meta/players/frames/events/rounds/grenades/...）
  manifest         // 回合布局
  buffers          // 每帧的插值输出缓冲（当前帧的玩家姿态）
  clock            // 播放时钟（时间/速度/暂停）

  // 场景与渲染
  scene            // SceneRenderer（qD）
  cs2Map           // CS2 地图（vy）
  mapLoader        // MapLoader（R_）
  players          // 玩家模型（ID，InstancedMesh）
  cameras          // 相机控制器（zf：free/fly/noclip/first/spectate）
  nametags         // 玩家名牌（LM）
  grenades         // 投掷物管理（CD）
  smoke            // 烟雾体积（WO）
  tracers          // 弹道曳光（Ok）
  deathMarkers     // 死亡标记（Lb）
  droppedWeapons   // 掉落武器（ox）
  characters       // 角色模型（zw）
  bomb             // 炸弹实体（wb）
  mapBreaks        // 地图破坏（mS）
  viewModel        // 第一人称持枪视图（UT）
  weaponLighting   // 武器光照（Ly）

  // HUD / UI
  hud, feed, panels, scoreboard, radar, crosshair, scope, blind, deathFade, killReplay,
  controls, controlsAutoHide, povPicker, settings, statsOverlay

  // 状态
  smokeOccluded    // 每个玩家是否被烟雾遮挡（Uint8Array）
  bombYawCache     // 炸弹朝向缓存
  flashbang        // 闪光弹辉光（Ik）
  raycaster        // 拾取射线
  frameDt          // 帧间隔（用于插值）
  playbackWanted   // 是否想要播放
  smoothRoundBackfill // 平滑回填后续回合
  pendingRoundData // 挂起的回合数据（播放头追上前）
}
```

## sampleAndRender(time, isScrub) —— 渲染一帧的完整流程

```js
sampleAndRender(time, isScrub = false) {
  // 1. 从 SoA 采样当前时刻的玩家姿态（线性插值，yaw 走最短弧）
  this.model.sample(time, this.buffers);

  const tick = this.data.meta.startTick + time * this.data.meta.tickRate;
  const deathPending = this.deathScenario?.pending != null;

  // 2. 相机更新 + 受击抖动
  this.updateViewPunch(tick);          // 受击视角抖动
  if (!deathPending) this.cameras.update(this.buffers, this.frameDt);
  this.maybeStartDeathScenarioAfterSeek(tick);
  this.updatePlaybackEvents(tick);
  if (deathPending && this.deathScenario?.pending == null) this.cameras.update(this.buffers, this.frameDt);
  this.deathFade.setActive(this.deathScenario?.pending != null);
  this.updateKillReplay(tick);

  // 3. 更新场景各子系统（按依赖顺序）
  const followedSlot = this.followedSlotForTags();
  this.mapLoader.updateInteriorLights(this.cameras.camera.position); // 只亮最近的 20 盏室内灯
  this.cs2Map.updateObjects(this.data.mapEntities, tick);            // 门/旋转物体
  this.mapBreaks.update(tick);                                       // 地图破坏碎片
  this.cs2Map.update(this.cameras.camera, this.cameras.getMode().kind === `first`);
  this.grenades.setTrajectoryVisibility(...);                        // 投掷物轨迹可见性
  this.grenades.update(tick, this.cameras.camera);
  this.smoke.update(tick);                                           // 烟雾体积
  this.updateSmokeOcclusion();                                       // 计算谁被烟雾遮挡（X-Ray 用）
  this.players.update(this.buffers, this.data.damage, tick, this.data.meta.tickRate, followedSlot, this.smokeOccluded);
  this.updateCharacters(tick, followedSlot, this.smokeOccluded);
  this.damage.update(this.data.damage, this.cameras.getFollowedSlot(), tick, this.data.meta.tickRate);

  // 4. 计算被跟随玩家的队伍 + 炸弹快照
  const showTeam = followedSlot >= 0 && !this.settings.xrayEnabled;
  const team = showTeam ? this.buffers.team[followedSlot] : -1;
  const occlusion = this.settings.xrayEnabled ? undefined : this.smokeOccluded;
  const bombSnapshot = this.computeBombSnapshot(tick);              // 下包/拆包进度

  // 5. 更新各 UI 组件
  this.nametags.update(this.buffers, followedSlot, team, occlusion, this.nametagContext(tick, bombSnapshot.carrierSlot));
  this.tracers.update(tick);
  this.deathMarkers.update(tick, this.buffers.alive, showTeam);
  this.droppedWeapons.update(tick);
  this.bomb.update(bombSnapshot, this.bombYaw(tick));
  this.controls.setTime(time);
  this.updateHud(time);
  this.updateCrosshair(time, isScrub);
  this.updateBlindOverlay(time);
  this.updatePanels(time);
  this.radar?.update(this.buffers, this.cameras.getFollowedSlot(), bombSnapshot);
  this.updateScoreboard(time);

  // 6. 渲染管线（顺序关键）
  this.scene.beginRenderFrame();
  this.renderSceneAndPrepareEffects(this.cameras.camera);  // 场景 + 特效准备
  this.grenades.renderBlasts(this.scene.renderer, this.cameras.camera); // 爆炸
  this.smoke.render(this.scene.renderer, this.cameras.camera, this.scene.drawingBufferSize);
  this.players.renderXray(this.scene.renderer, this.cameras.camera, this.xrayCharacters());
  this.renderViewModel(tick);                              // 第一人称持枪视图
  this.updateSound(tick);
  this.renderFlashbang();
  this.nametags.render(this.cameras.camera);               // CSS2D 名牌
}
```

## 关键设计洞察

1. **采样与渲染分离**：`model.sample()` 只做纯数据插值，产出 `this.buffers`（当前帧姿态），
   之后所有子系统（players/smoke/radar/hud...）都读这个 buffers，职责单一。

2. **烟雾遮挡（smokeOccluded）贯穿全局**：`updateSmokeOcclusion()` 计算每个玩家是否被烟雾遮挡，
   这个结果同时用于 X-Ray 透视、名牌显隐、玩家模型渲染，是"墙后/烟后可见性"的统一依据。

3. **渲染顺序固定**：场景 → 爆炸 → 烟雾 → X-Ray → 持枪视图 → 名牌，层层叠加，
   烟雾和 X-Ray 是半透明后处理，必须在场景之后。

4. **性能优化点**：
   - 室内灯只点亮相机最近的 20 盏（`updateInteriorLights`）
   - 地图门/旋转物体按 tick 惰性更新（`updateObjects`）
   - 死亡场景（deathScenario）走独立相机轨道，暂停常规相机更新

## 其他关键方法（语义名已保留，直接可读）

| 方法 | 作用 |
| --- | --- |
| `followPlayer(slot)` | 切换到第一人称跟随某玩家 |
| `cyclePlayer(delta)` | 循环切换玩家 |
| `selectFreeCamera/Fly/Noclip` | 三种自由相机模式 |
| `seekPlayback(time)` | 跳转播放（带 scrub preview） |
| `jumpToKill/Nade/NadeLanding` | 跳转到特定事件时刻 |
| `replaceRoundData/applyRoundData` | 增量回填后续回合（边播边解析） |
| `computeBombSnapshot` | 下包/拆包进度快照 |
| `xrayCharacters` | X-Ray 透视角色 |
| `precompileEffects` | 地图加载后预编译 effect shader |
