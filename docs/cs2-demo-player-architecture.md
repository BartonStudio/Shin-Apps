# CS2 Demo 播放器 · 架构设计（业务类 & 对象树）

> 版本 v0.3 · 日期 2026-11-06
> 配套需求文档：`cs2-demo-player-prd.md`
> 目标：业务与逻辑全部在 C++ 侧，前端只接收数据渲染。

---

## 1. IObject 框架下的业务类形态

业务类**不继承** `IRuntimeObject`，而是鸭子类型——实现约定方法后用 `Runtime::make<T>()` 包装成对象树节点。四个机制决定类怎么拆：

| 机制 | 用途 | 映射 |
| --- | --- | --- |
| `ReadData(channel)` | 前端读状态 | 状态**输出**口（前端渲染数据源） |
| `Invoke(method)` | 前端下命令 | 命令**输入**口（播放/暂停/切视角…） |
| `Publish(DataChannelChanged)` | 状态变更通知 | 通知前端「通道变了，重新读」 |
| `Connect/Disconnect` 对象树 | 组织对象 | 静态逻辑结构 |

一句话原则：**树是结构，通道是状态，Invoke 是命令，逻辑在叶子节点内部算好，前端只订阅通道拿字节。**

---

## 2. 对象树总览

```
Root (CSRoot)
├── Session      DemoSession         元数据 / 加载解析状态
├── Timeline     Timeline            tick↔时间轴、已解析区间
├── Playback     PlaybackController  播放/暂停/seek/倍速/回合跳转（游标唯一所有者）
├── Scoreboard   Scoreboard          比分板聚合视图
├── KillFeed     KillFeed            击杀播报环形缓冲
├── POV          CameraController    相机 / 观察目标 / 存活自动切换
└── World        WorldState          当前 tick 的世界快照（3D 渲染数据源）
    ├── Teams    TeamList            → CT / T 两支队
    ├── Rounds   RoundList           → 各回合边界
    ├── Players  PlayerList          → 各 Player（长命，固定节点）
    └── Entities EntityList          → Weapon / Grenade / C4（短命，动态增删）
```

### 各节点职责一句话

| 节点 | 职责 | 关键通道 | 关键命令 |
| --- | --- | --- | --- |
| `Session` | demo 元数据、加载/解析状态机 | `meta` | `Load(path)` / `Close` |
| `Timeline` | tick↔秒换算、已解析区间集合 | `progress` | — |
| `Playback` | 持有 `currentTick` 游标、播放时钟、倍速、回合跳转 | `state` | `Play` / `Pause` / `Seek` / `SetSpeed` / `PrevRound` / `NextRound` |
| `World` | 持有不可变 tick 存储 + 游标视图 | （聚合，见实体层） | — |
| `Scoreboard` | 玩家统计按队伍聚合（KDA/ADR/经济） | `rows` | `ToggleVisible` / `SelectPlayer` |
| `KillFeed` | 击杀播报环形缓冲、格式化 | `entries` | — |
| `POV` | 观察目标、存活自动切换规则 | `target` | `Spectate(id)` |

---

## 3. 已定关键决策

1. **游标模型**：全应用只有 `PlaybackController` 一个 `currentTick` 权威值，其余节点都是「当前游标处的视图」。跳转/倍速/回合只改这一个游标，再靠事件广播刷新。
2. **通道粒度**：按渲染单元拆通道（`transform` / `stats` / `trajectory`…），前端按需订阅，禁止「一个 World 大通道返回全部」。
3. **序列化格式**：通道数据用 **MessagePack 二进制**编码——C++ 侧 `msgpack11`（已 vendored）、前端 `@msgpack/msgpack`（已依赖），与框架桥接协议同一技术栈，零新增依赖（详见 4.8）。
4. **统计存储**：**每 tick 快照**（内存换 seek 速度，简单可靠）。
5. **子弹弹道**：不渲染，**不设 `Projectile` 类**。
6. **标识定夺**：种类/状态类小枚举用 **int**；武器等外部标识用 **字符串 id**（详见 4.8）。
7. **朝向**：用**欧拉角（pitch/yaw，roll 恒 0）**，前端渲染时自行转四元数插值（详见 4.7）。
8. **内存**：每 tick 快照不设上限，极限加时 ~90 分钟约 200~250 MB，可接受；坚持 `float32`/`uint16` 紧凑类型即可。
9. **所有权**：`Runtime::make<T>()` 返回节点由 C++ `delete`；业务对象用 `shared_ptr` 承载；短命实体频繁 Connect/Disconnect，注意不泄漏。
10. **线程**：解析线程（后台写存储）与主线程（游标推进/前端读）分离，`WorldState` 存储需线程安全（`kThreadSafe=true` 或加锁）。

---

## 4. 实体层设计（详细）

> 实体层 = 3D 比赛画面的数据来源（PRD F3 / F5 / F8）。是所有内容里最需要「逻辑在 C++、前端只渲染」的一层。

### 4.1 总体模型：存储 + 游标视图

CS2 demo 是 64 tick/s 的离散时间序列，且要求能随时 seek 回跳。因此实体层采用两层结构：

- **存储层（内部，不在对象树上）**：`EntityStore` 持有解析出的全部实体的**不可变时间序列数据**（按实体 id 索引，每 tick 快照）。
- **视图层（对象树节点）**：树上的实体节点**不自己存数据**，只持有「存储引用 + 实体 id」，`ReadData` 时按当前游标 tick 从存储取值返回。

```
                ┌─────────────────────────────────────────┐
                │  EntityStore（不可变，后台解析线程写入）      │
                │  PlayerRecord / WeaponRecord / ...        │
                └─────────────────────────────────────────┘
                                   ▲ 按 (实体id, tick) 查询
        ┌──────────────────────────┴──────────────────────┐
        │  WorldState（对象树节点）                          │
        │  持有 store 引用 + 当前游标 tick                    │
        │    ├── Players/Player(id)   → 视图，ReadData 时查表 │
        │    └── Entities/Grenade(id) → 视图，短命动态增删     │
        └─────────────────────────────────────────────────┘
```

好处：seek 天然支持（查任意 tick 即可）、存储不可变无并发写冲突、树节点是轻量视图。

### 4.2 基础类型

```cpp
using Tick     = std::uint32_t;
using EntityId = std::uint32_t;             // 业务内部自增 id，一场 demo 规模远小于 2^32
using WeaponId = std::string;               // 武器用字符串 id，见 4.8

enum class EntityKind : std::uint8_t { Player, Weapon, Grenade, C4 };   // int 传输
enum class Team       : std::uint8_t { None, CT, T };                    // int 传输
enum class GrenadeKind: std::uint8_t { HE, Flash, Smoke, Molotov, Decoy }; // int 传输
enum class C4Status   : std::uint8_t { Carried, Dropped, Planted, Defused, Exploded };   // int 传输

struct Vec3 { float x, y, z; };             // float32
struct ViewAngle { float pitch, yaw; };     // 欧拉角，roll 恒 0 不存
struct TickInterval { Tick begin; Tick end; };  // [begin, end)
```

### 4.3 实体基类 `Entity`

所有实体共享的共性：唯一 id、种类、队伍、存活区间、当前 tick 的 transform。

```cpp
class Entity {
public:
    static constexpr bool kThreadSafe = true;
    static void RegisterTypes(iobject::TypeBuilder<Entity>& types); // 暴露 As<Entity>()

    void BindRuntime(iobject::IRuntimeObject* self);
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const;

    EntityId      id() const;
    EntityKind    kind() const;
    TickInterval  lifetime() const;
    bool          aliveAt(Tick tick) const;

private:
    const EntityStore* store_;   // 指向 WorldState 的存储
    EntityId           id_;
};
```

**基类通用通道**（编码为 msgpack map，字段名作 key，见 4.8）：

| 通道 | 内容 | 字段 |
| --- | --- | --- |
| `identity` | 身份与种类 | `id`(uint32)、`kind`(int)、`team`(int)、`owner`(uint32) |
| `lifetime` | 存活区间 | `begin`(tick)、`end`(tick)、`alive`(bool) |
| `transform` | 当前 tick 姿态 | `tick`、`pos`[x,y,z](float32)、`view`[pitch,yaw](float32) |

### 4.4 各实体子类

#### Player（玩家）——长命，固定节点

| 项 | 内容 |
| --- | --- |
| 生命周期 | 整场固定（在 `Players` 下建一次） |
| 身份 | 名字、steamId、队伍 CT/T |
| 统计 | K / D / A / ADR / 经济 / 是否存活（当前 tick 累计值） |
| 姿态 | 位置 + 朝向（相机切视角 + 3D 渲染） |
| 通道 | `identity` `stats` `transform` `weapon` |
| `identity` 字段 | `name`(string) `steamId`(string，超 2^53 必须字符串) `team`(int) `teamSlot`(uint8，队伍内槽位→前端映射颜色) |
| `stats` 字段 | `kills` `deaths` `assists` `adr`(float32) `money` `alive`(bool) |
| `weapon` 字段 | `active`(string，武器 id) `clipAmmo`(当前弹匣子弹) `reserveMagazines`(备用弹匣数) |
| 命令 | 无（切视角走 `POV.Spectate`，玩家是只读视图） |

**统计存储策略**：每 tick 快照（决策 4），seek 时直接下标取值，O(1)。

#### Weapon（武器）

| 项 | 内容 |
| --- | --- |
| 生命周期 | 跟随持有者；掉落时成为独立短命实体 |
| 属性 | 武器字符串 id、持有者 id（null = 掉落）、掉落位置 |
| 通道 | `state` |
| `state` 字段 | `weapon`(string id) `owner`(uint32) `dropped`(bool) `dropPos`[x,y,z] |

#### Grenade / Throwable（投掷物）——短命，动态增删

| 项 | 内容 |
| --- | --- |
| 子类型 | HE / Flash / Smoke / Molotov / Decoy |
| 属性 | 类型(int)、投掷者、轨迹点（抛→落/爆）、效果参数、起效 tick |
| 通道 | `trajectory` `effect` |
| `trajectory` 字段 | `throwTick` `detonateTick` `points`[[x,y,z]…] |
| `effect` 字段 | `type`(int) `detonateTick` `radius`(smoke) / `area`[[x,y,z]…](fire) |

**逻辑边界**：轨迹路径点（抛→落/爆的完整路径）由 C++ 计算好，前端只画线；烟雾范围/燃烧区域由 C++ 给出几何参数，前端只渲染覆盖物。

#### C4Bomb（C4）——短命，动态增删

| 项 | 内容 |
| --- | --- |
| 状态机 | `carried → dropped → planted → defused/exploded` |
| 属性 | 携带者、安放位置/安放 tick、爆炸 tick（倒计时）、是否拆除 |
| 通道 | `state` |
| `state` 字段 | `status`(int) `carrier`(uint32) `plantPos`[x,y,z] `plantTick` `explodeTick` `defused`(bool) |

> 子弹/弹道不渲染，**不设 `Projectile` 类**（决策 5）。

### 4.5 动态增删机制

`EntityList` 节点职责：

- 内部维护 `map<EntityId, IRuntimeObject*>` 子节点。
- 维护「实体存活区间索引」，游标跨越某实体的 `begin`/`end` tick 时才增删（**不要每个 tick 都遍历增删**）。
  - 进入存活区间 → `Connect("<kind>:<id>", node)`
  - 离开存活区间 → `Disconnect("<kind>:<id>")`
- 前端订阅 `ChildConnected` / `ChildDisconnected` 事件，据此增删渲染对象（PRD F3/F8：手雷等在其存活区间显示，之后消失）。

命名规则：`Connect` 的名字不能含 `.` 且单层，用 `"grenade:12"`、`"c4:1"` 这类 `种类:实体id` 的扁平名。

### 4.6 数据流（节拍机制）

每 tick（64/s）对所有实体发布 `DataChannelChanged` 会消息洪泛。采用「**节拍 + 批量读**」：

```
PlaybackController.currentTick 变化
  → 发布 DataChannelChanged("state")   ← 唯一的节拍信号（事件帧自带 state 字节快照）
  → 前端收到，知道 tick 变了
  → 前端按需批量 ReadData：World 下各实体的 transform / stats / trajectory ...
  → 渲染刷新
```

- **节拍源只有一个**：`Playback.state` 通道。
- 实体节点是「读时查表」的被动视图，不需要自己在每次 tick 变化时主动发布变更。
- 前端每帧最多读一次（前端做帧率节流），C++ 侧无洪泛。

### 4.7 transform 朝向与插值边界（重要）

- **C++ 给**：离散 tick 的**精确 transform**，朝向用**欧拉角 pitch/yaw**（roll 恒 0，不存），贴合 demo 原始数据，最忠实、最省字节（8 字节）。
- **前端做**：相邻 tick 间的**插值/平滑渲染**；渲染平滑旋转时**前端自行把欧拉角转四元数做 slerp**（属渲染层职责，不算业务逻辑）。

这条边界不划清，会不自觉地把「四元数转换 + 渲染平滑」塞进 C++。

### 4.8 通道二进制编码方案（MessagePack）

**为什么选 MessagePack**：

1. 框架桥接协议（WebSocket → 前端）本身就是 MessagePack，通道数据作为 `bin` 类型**原样透传，无 Base64 膨胀**；
2. 前端 `iobject-js`（`client.ts`）已依赖 `@msgpack/msgpack`，**零新增依赖**；
3. C++ 侧用 `nlohmann::json::to_msgpack`（经 `shin_host` PUBLIC 暴露，零新增依赖；`msgpack11` 是 IObject 的 PRIVATE 依赖，业务层不可见）；
4. 比 JSON 紧凑，比手写 struct 易维护，比 FlatBuffers 零新增依赖。

**标识定夺规则（决策 6）**：

| 类别 | 用什么 | 例子 |
| --- | --- | --- |
| 种类/状态小枚举（3~5 种，稳定） | **int** | `EntityKind` / `Team` / `GrenadeKind` / `C4Status` |
| 外部标识、会扩展、或 demo 天然字符串 | **字符串 id** | 武器 `"weapon_ak47"`、地图名、steamId |

> steamId 是 64 位整数（17 位十进制），超过 JS `Number` 的 2^53 安全精度，**必须用字符串传**，否则前端 decode 丢精度。

**数值编码约定**：

- 通道载荷 = 一个 msgpack **map**，字段名作 string key；
- 坐标/角度用 **float32**（4 字节）而非 float64，省一半；
- 计数（tick、KDA、经济、实体 id）用 **uint32 / uint16** 紧凑类型；
- 批量数据（如比分板 rows、轨迹 points）用 **array** 一次性编码，减少 map 数量。

**`transform` 通道载荷示例**（msgpack 结构示意）：

```
map {
  "tick" : 8400                     (uint32)
  "pos"  : [1.25, 0.0, 3.48]        (float32 array)
  "view" : [-3.0, 90.0]             (float32 array, pitch/yaw)
}
```

### 4.9 内存评估（决策 8）

每 tick 快照，极端加时 ~90 分钟（34.5 万 tick）估算：

| 对象 | 计算 | 内存 |
| --- | --- | --- |
| 10 玩家 | 10 × ~35B × 34.5万 | ~121 MB |
| 投掷物（400 个） | 400 × 512 tick × 12B | ~2.5 MB |
| 掉落武器（100 个） | 100 × 1280 tick × 12B | ~1.5 MB |
| **原始数据合计** | | **~125 MB** |

乘结构对齐/容器开销 ≈ **200~250 MB**，现代桌面完全可接受（即便 2 小时也 ~300MB）。

> 关键：坚持 `float32`/`uint16` 紧凑类型，勿用 `double`/`int32`（会翻倍到 500MB+）。

### 4.10 World 子树：三个容器类

「World」子树由三个容器类撑起来，分别承担「承上、启下、分治」：

| 类 | 角色 | 职责 |
| --- | --- | --- |
| `PlaybackController` | 承上：游标唯一所有者 | 持有 `currentTick`、播放/暂停/倍速/回合导航，游标变化时发布 `DataChannelChanged("state")` 节拍 |
| `WorldState` | 启下：存储 + 游标视图分水岭 | 持有 `shared_ptr<EntityStore>`，挂 `Players`/`Entities` 子节点，暴露 store 与游标给实体视图 |
| `PlayerList` / `EntityList` | 分治：长命 vs 短命 | 玩家一次性装配；投掷物/武器/C4 随 tick 增删 |

**PlaybackController**（单一游标）：跳转/倍速/回合导航全部收敛为「改一个 `currentTick`」，其余节点都是消费者、跟随游标刷新——避免多头状态打架。

**WorldState**（所有权分水岭）：`EntityStore` 用 `shared_ptr` 在 WorldState 与 PlaybackController 间共享；实体节点只持 `const EntityStore*` 裸指针，生命周期由 shared_ptr 保证。「视图不存数据、读时查表」由此成立。

**PlayerList vs EntityList**（生命周期分治）：玩家整场固定、建一次不动；投掷物/武器/C4 短命、随 tick 增删。两者生命周期策略不同，故拆开，`EntityList::SyncToTick` 里 `skip Player`。

### 4.11 其余业务节点与域根

| 节点 | 文件 | 职责 | 通道 / 命令 |
| --- | --- | --- | --- |
| `Scoreboard` | `Scoreboard.hpp` | 玩家统计按队伍（CT/T）聚合，纯只读视图 | `rows` / `visible`；命令 `ToggleVisible` |
| `KillFeed` | `KillFeed.hpp` | 击杀播报环形缓冲 + 格式化 | `entries`（最近 8 条） |
| `CameraController`（POV） | `CameraController.hpp` | 观察目标 + 存活自动切换 | `target`；命令 `Spectate(id)` |
| `CSRoot` | `CSRoot.hpp` | 域根：组合 Logger + 唯一持有 `shared_ptr<EntityStore>` + 挂业务子树 | 转发 `Invoke("Log")` |

**所有权约定**：`CSRoot` 唯一持有 `shared_ptr<EntityStore>`；其余节点只持裸指针（`PlaybackController` 持非 const 以写游标，其余持 `const` 只读）。生命周期由 `CSRoot` 的 shared_ptr 保证。

**装配时序**：`MakeRoot` 返回 `CSRoot` → 框架回调 `BindRuntime`（创建并挂载 Playback/World/Scoreboard/KillFeed/POV）→ 解析器灌数据进 `store()` → `world()->InitializePlayers()`。

**Scoreboard 与 POV 的分工**：玩家名点击切视角由前端直接调 `POV.Spectate(id)`，不走 Scoreboard（比分板只负责展示，无 SelectPlayer 命令）。

**击杀事件存储**：`KillEvent` 是稀疏事件流，存 `EntityStore::killEvents_`（非每 tick 快照），`RecentKills(tick, n)` 查最近 n 条。

---

## 5. 已解决记录

| 问题 | 结论 |
| --- | --- |
| 标识用 int 还是字符串 | 小枚举 int，外部标识（武器/steamId/地图）字符串 |
| 朝向欧拉角还是四元数 | C++ 发欧拉角 pitch/yaw，前端转四元数 |
| 每 tick 快照内存上限 | 不设上限，~250MB 可接受，坚持紧凑类型 |
| 子弹弹道 | 不渲染，不设 Projectile 类 |
| C4 状态 | 补 `Dropped`（掉落），去掉 `Exploding` |
| 弹药 | `clipAmmo` + `reserveMagazines`（弹匣系统），每 tick 快照 |
| 玩家颜色 | 记录 `teamSlot`（队伍内槽位），前端映射颜色 |
