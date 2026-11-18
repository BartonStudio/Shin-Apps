# DemoViewer 进度记录

> 最后更新：2026-11-17（P4a 完成）。记录观看页（Watch View）播放链路的实施进度：已完成 / 进行中 / 待办。
> 架构与数据契约的权威说明见 `web/docs/01-architecture.md` 与 `web/docs/07-data-contract.md`（参考实现文档）。

## 一句话现状

**播放闭环 + 场景物件已通**：native 播放时钟驱动游标 → World `snapshot` 通道输出每拍全量世界快照 → 前端节拍订阅驱动实体渲染（玩家 + 掉落武器 + 投掷物轨迹 + C4）+ 全部 HUD（比分/回合/计时/击杀流/名册/控制条）。地图上能看到 10 个玩家跑动、雷飞来飞去（带轨迹线）、C4 在谁手上。

---

## 已完成

### P0 — 播放时钟（native，`PlaybackController.hpp`）

- **心跳闹钟**：独立线程 16ms 一拍，`iobject::Post` 封回循环线程，不碰业务状态。
- **时钟对齐**（`AdvanceAt`）：`游标 = 锚点 + 流逝时间 × tickrate × 倍速`，定时器抖动不影响速度精度。
- **锚点管理**：Play / 播放中 Seek / 播放中 SetSpeed 重新锚定；到 `MaxTick` 自动停。
- 线程安全：仅 `playing_/running_` 原子；锚点与游标只在循环线程，零锁。
- 实测：1 倍速 1.5s≈94 tick ✓；2 倍速精确 128 tick/s ✓；播完自动停（115363≈30:02.5）✓；暂停冻结 ✓。
- Playback 命令面：`Play / Pause / Seek(tick) / SetSpeed(x)`；`state` 通道 `{playing, speed, currentTick}`。

### P1 — 快照通道 + 节拍订阅

- **native（`WorldState.hpp`）**：新增 `snapshot` 数据通道。`SnapshotAt(CurrentTick())` 聚合编码 msgpack：
  - `tick` / `maxTick`（进度比例基准）
  - `round`：当前 tick 所在回合 `{index, startTick, endTick, liveStartTick, winnerTeam}`
  - `score`：**截至当前 tick** 已分胜负回合数 `{t, ct}`（区别于 Scoreboard 的整场统计）
  - `players[]`：id/name/team/teamSlot/pos/view/alive/**health/armor**/weapon/kills/deaths/assists/money/clipAmmo/reserveMagazines
  - `entities[]`：存活短命实体 id/kind/pos（kind：0 Player 1 Weapon 2 Grenade 3 C4）
  - `recentKills[]`：tick/killer/victim(均为 id)/weapon/headshot
- **前端（`playback-feed.js`）**：`openPlaybackFeed(onUpdate)`。
  - **节拍订阅方案可用**（桥端 `RuntimeSession::SubscribeEvent` 会转发业务节点 Publish 且自动附通道快照，实测 2s 收 66 拍）——订阅 `Playback` 的 `DataChannelChanged("state")` → 拉 World `snapshot` → 回调 `onUpdate(snap, state)`。
  - tick 与播放状态都没变的拍跳过；挂载即出第一帧。
  - 教训记录：第一版探针误判"桥不转发事件"，根因是测试窗口里没在播放（0 拍是正确行为）。下"不支持"结论前必须确认事件发生过。
- **调试工具（`player/dev.js` → `window.__playerDev`）**：`play/pause/seek/speed/state/watchState(ms)/probeBeats(ms)/snapshot/feedTest(ms)`；`window.__demoDev`：`load(demo)/enterWatch()`。

### P2 — 玩家实体渲染（`player/entity-renderer.js`）

- 每玩家一组：占位胶囊（CS2 hull 半径 16、站高 72）+ 朝向杆（yaw 驱动）；队色（T 橙 / CT 蓝）；`alive=false` 隐藏。
- 几何/材质共享，dispose 干净；换图重建（`world.js attachEntities()` 幂等挂载）。
- 坐标系结论：**Source 坐标直通**（场景 z-up，`camera.up=(0,0,1)`，CS2 chunk 顶点直通）——已用 6 种候选映射放球俯瞰定案。
- 实测：特写可见胶囊+朝向杆立于地面；播放中实体层跟随节拍更新、阵亡隐藏。

### P3 — HUD 动态化 + 控制条（`watch-hud.js`）

- **scorebar**：地图名（`de_dust2 → DUST2`）、实时比分、`ROUND N`、回合剩余时间（冻结期显示满 live 时长、live 阶段倒数到回合结束）。
- **KillFeed**：快照 recentKills + 名册映射还原真名；攻防双方按队伍上色、长名截断、爆头标记、最近 5 条。
- **5v5 名册**（左右 player-card）：动态生成（按 `Team` 枚举 None=0/CT=1/T=2 分组、teamSlot 升序）；血条/护甲条 scaleX 填充（T 从左、CT 从右镜像）；死亡态整卡降透明度+名字变灰（无删除线）；结构指纹（id:team:teamSlot）变化才重建 DOM（换边安全）；hover 详情 id/slot/武器/经济。
- **控制条**：播放/暂停切换（图标以 native 实际状态刷新，防与 feed 状态读回竞态）、倍速循环 1X→2X→4X→0.5X、进度条点击+拖拽 Seek（60% 精确 69218 tick）。
- 实测全部通过（见各节）。

### P4a — 短命实体可视化（已完成主体）

**native**：
- `snapshot.entities[]` 扩详情：投掷物带 `grenade:{sub, thrower}`（GrenadeKind：0 HE 1 Flash 2 Smoke 3 Molotov 4 Decoy）；C4 带 `c4:{status, carrier, explodeTick}`（C4Status：0 Carried 1 Dropped 2 Planted 3 Defused 4 Exploded，状态走 `C4StatusAt(tick)` 状态机）。
- **新数据通道 `grenadePaths`**：全量投掷物静态轨迹 `{id → {sub, thrower, trajectory[[x,y,z]...], radius, fireArea}}`（spec 不随 tick 变，前端在投掷物集合变化时拉取一次）。实测一场 demo 306 条轨迹、单条最多 1612 点。
- `EntityStore.Entities()` 只读遍历接口；**`PlayerRecord`/`EntityRecord` 从类 private 嵌套移到 namespace 层**（public 方法返回 private 嵌套类型外部无法命名，是编译错误的根因）。

**前端（`entity-renderer.js` 扩展）**：
- `demo-dyn` 子组，每拍 diff（id 集合）增删：掉落武器=地面暗色长条（kind 1）、投掷物=移动小球（按子类型着色）+ 轨迹虚线（kind 2）、C4=红块 Planted 时 emissive 脉动闪烁（kind 3）。
- smoke 落点半透明球（effectRadius，压扁 0.72 模拟云团）、molotov 火区三角扇面（fireArea 顶点手写索引——bundle 裁剪版无 ShapeGeometry/DoubleSide，后者用常量 2）。
- 轨迹静态数据懒加载（`world.attachEntities({loadGrenadePaths})` 注入），实体消失时连 extras 一起 dispose。

**实测**（tick 30000）：dyn 层 9 box（8 武器+C4）+ 3 球 + 3 轨迹线全可见；播放 2s 后第一枚 HE 爆炸自动消失（生命周期同步 ✓）；截图确认红球+轨迹线落在正确位置。

---

## 接下来的工作

### P4a 尾巴

- **smoke/molotov 可视化未实测**：测试 demo 的 306 条投掷物全是 HE（sub 全 0），烟球/火区代码路径未被真数据覆盖——需找含烟雾/燃烧弹的 demo 回归。
- C4 Planted 闪烁未实测（当前 tick C4 均为 Carried）；爆炸倒计时数字未上 HUD。
- 点亮名册卡的 `__util` 道具槽（手里道具数量）。
- 投掷物轨迹线可优化：目前整条轨迹常显（从抛出即画全程），可改为只画已飞部分（按 tick 截断 trajectoryTicks）。

### P4b — POV 相机跟随

- 相机绑定到选中选手的第一人称（位姿 + view 角度直驱相机）。
- 控制条 `FREE` 字样升级为视角切换器：列出存活选手（血量/武器），点击切换；选手阵亡自动切击杀者视角。
- 相机控制器已有 `followPose/punchPitch/punchYaw` 字段（原版对齐预留），从 FREE 模式切 POV 的状态机待实现。

### 名册卡片图标化（已完成，2026-11-17）

- **图标资源**：原 csdemo.tv 的武器 SVG 库（58 个：枪械/投掷物/C4/护甲/拆弹器/爆头标记等）已在逆向时抓取，位于 `web/raw/icons/weapons/`，已拷贝到 `webapp/public/icons/weapons/` 供前端直接引用。
- **映射**：`watch-hud.js` 的 `WEAPON_ICON` 表（源自原版逆向 `06-world-props.deobf.js`）+ `weaponIcon()` 兼容两种输入——快照 players[].weapon 是**显示名**（"AK-47"），recentKills[].weapon 是**内部名**（"ak47"、"m4a1_txz03" 带皮肤后缀）；刀类本地只有 5 个图标，统一 fallback `knife.svg`。
- **卡片升级**：名字行另一端显示当前武器图标（T 右/CT 左固定槽位）；名字区收窄至 92px 防重叠。血量/护甲为**纯条形动态填充**（血条绿 #7ac74f / 护甲条暗黄 #c9a227——用户指定：深黄但不到橙色；历史演进 #8aa0b0 在浅色卡片上不可见 → #4a7396 钢青 → 现暗黄，高 5px；scaleX 随快照实时变化，不显示数字——用户明确要求去掉数字形式）。
- **KillFeed 升级**：武器占位色块 → 真实武器 SVG（无匹配退回色块 span）。
- **仍未有的数据**：玩家"手里道具列表"（烟/闪/雷存量）快照里没有（投掷物实体只代表已扔出的）——点亮 `__util` 槽需 native 解析线补字段；头盔/拆弹器标志同理（快照只有 armor 数值）。

### 打磨项（不阻塞闭环）

- 占位胶囊 → CS2 玩家模型（人形 + 动画混合；`PlayerSnapshot.duck` 下蹲系数已备）。
- 玩家头顶名牌（POV 模式下隐藏）。
- 回合间隙（加时/中场）计时显示策略：当前逻辑取最后一个 startTick≤tick 的回合，间隙期显示 0:00。
- 武器图标刀类补全（本地只有 5/18 个刀图标，现统一 fallback knife.svg）。

---

## 缺失 / 待办（技术债与风险）

| 项 | 说明 | 影响 | 处理建议 |
|---|---|---|---|
| 快照全量编码开销 | 每拍（~33Hz 实测）对 10 玩家 + 全部存活实体做 JSON→msgpack 全量编码，无增量 | 大规模数据（职业比赛 10 人无碍）或实体很多时带宽/CPU 上升 | 现状可接受；后续可做序列号 + 脏字段增量，或节流到 30Hz 上限 |
| grenadePaths 全量拉取 | 306 条轨迹整场全量（约几 MB），每次投掷物集合变化都重拉 | 进度条随意 seek 时可能频繁重拉 | 已按集合指纹去重；后续可按"新增实体增量拉"或前端常驻缓存 |
| native KillFeed 节点闲置 | `KillFeed "entries"` 通道（名字形式）前端未消费——前端直接用 snapshot.recentKills(id)+名册映射 | 无功能影响；两处击杀逻辑并存 | 保留（native 视图层给未来其他消费者用）；如确认无人用可考虑收敛 |
| 换边（上半/下半场）未实测 | 名册结构指纹重建逻辑已实现，但测试 demo 未跑到换边 | 换边瞬间名册分组可能异常 | 找含换边的 demo 回归 |
| POV 需要的逐帧数据核验 | view 角度直驱相机时 punch/recoil 平滑、deathcam 处理未做 | POV 切换体验 | P4b 实现时处理 |
| `web/` 旧参考仓库与 webapp 并存 | `web/` 是原版逆向参考实现（bundle 分析/文档/工具），运行的是 `webapp/` | 新人易混淆 | 在 `web/README.md` 顶部加"仅供参考"声明 |
| ESC 菜单 / cinema 裁剪等 UI 项 | CROP/EXIT 按钮逻辑未接播放语义 | 体验完整性 | 低优先级 |

---

## 关键约定速查

- **Team 编码两套**：`PlayerIdentity.team`（快照/前端用）= `Team{None=0, CT=1, T=2}`；`PlayerSnapshot.team`（解析器帧数据）= 2=T 3=CT。**前端只见前者**。
- **坐标系**：Source 世界坐标直通 three.js 场景（z-up），无 swizzle。
- **游标权威**：唯一真相源在 native `PlaybackController`；前端只消费（节拍→拉快照），不推进时间。
- **通道契约**：Publish 只发变脏信号，载荷走拉取（`state` 拍附带的 state 快照是桥自动附带的例外；`grenadePaths` 是静态数据通道，前端按需拉）。
- **字体约定**：应用内出现的任何汉字统一黑体（SimHei，macOS 兜底 Heiti SC）——`--mono` 与 `--sans` 两条字体栈均已在西文字体后插入 SimHei（逐字符回退，拉丁字形不受影响）。新增 UI 不要单独指定含中文的字体栈。
- **three bundle 裁剪版**：`player/vendor/three-bundle.js` 没有全部导出（无 DoubleSide/Shape/ShapeGeometry 等）——新增渲染特性前先确认导出存在，缺失就手写几何/用数值常量。
- **测试入口**：应用启动后 CDP eval：`__demoDev.load(demo路径)` → `__demoDev.enterWatch()` → `__playerDev.play()/seek(t)/state()/snapshot()`；截图 `node tools/cdp-shot.mjs tmp/x.png`。飞相机取景必须同时设 `camera.controls.target`（否则被 controls 拉回）。
