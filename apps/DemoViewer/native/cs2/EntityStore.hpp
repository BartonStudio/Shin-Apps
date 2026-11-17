#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "EntityTypes.hpp"

// =============================================================================
// 实体层 · 存储层（不可变时间序列，每 tick 快照）
//
// 对应架构文档 §4.1「存储 + 游标视图」。
// 关键点：
//   - 这里存的是「每 tick 快照」，下标 = tick - begin，查询 O(1)；
//   - 存储由后台解析线程写入（Add*），主线程只读（*At），故 kThreadSafe；
//   - 对象树上的 Entity 节点不存数据，只持有 store 指针 + 实体 id，读时查表；
//   - 身份/武器/状态这类「稀疏事件」用变更表存，不做每 tick 快照（省内存）。
// =============================================================================

namespace demoviewer {

/// 玩家每 tick 快照（身份与武器是「稀疏事件」，另存，见下）。
struct PlayerSnapshot {
    Vec3 pos{};
    ViewAngle view{};
    std::uint16_t kills = 0;
    std::uint16_t deaths = 0;
    std::uint16_t assists = 0;
    std::uint16_t money = 0;
    float adr = 0.0f;
    bool alive = false;
    // 弹药：当前活跃武器的弹匣子弹 + 备用弹匣数。
    // 变化频繁（每发子弹/换弹），按每 tick 快照，不做稀疏变更（用户确认）。
    std::uint16_t clipAmmo = 0;
    std::uint16_t reserveMagazines = 0;
    // 当前武器（全量快照，存目录编号不存字符串——用户确认接受全量）。
    WeaponNum weaponNum = kNoWeapon;
    // 前端契约（frames/panelFrames）需要的逐帧字段。
    std::uint8_t health = 100;     // 0..100
    std::uint8_t team = 0;         // 2=T 3=CT 0=未参战（换边/缺席时按帧变）
    std::uint16_t score = 0;       // 记分板分数
    std::uint8_t armor = 0;        // 护甲值
    float duck = 0.0f;             // 0..1 下蹲程度（动画混合）
};

/// 通用实体（武器/投掷物/C4）每 tick 快照：只有 transform。
struct TransformSnapshot {
    Vec3 pos{};
    ViewAngle view{};
};

/// 武器静态属性（item id 整场不变）。
struct WeaponSpec {
    WeaponId itemId;  // 如 "weapon_ak47"
};

/// 投掷物静态属性（解析时算好，不随 tick 变）。
struct GrenadeSpec {
    GrenadeKind kind = GrenadeKind::HE;
    EntityId thrower = 0;                // 投掷者玩家 id（0 = 未知）
    Tick throwTick = 0;
    Tick detonateTick = 0;
    std::vector<Vec3> trajectoryPoints;  // 抛→落/爆 路径点（C++ 算好，前端画线）
    std::vector<Tick> trajectoryTicks;   // 与 trajectoryPoints 一一对应的 tick（前端契约要双数组）
    float effectRadius = 0.0f;           // smoke 覆盖半径
    std::vector<Vec3> fireArea;          // 燃烧区域顶点（molotov/incendiary）
};

/// C4 静态属性（安放位置/倒计时；状态机随 tick 变，走稀疏变更表）。
struct C4Spec {
    EntityId carrier = 0;   // 携带者（planted 前）
    Vec3 plantPos{};
    Tick plantTick = 0;
    Tick explodeTick = 0;   // 爆炸 tick（倒计时终点）
};

/// 玩家的身份信息（整场不变）。
struct PlayerIdentity {
    std::string name;
    std::string steamId;    // 17 位十进制，超 JS 2^53，必须字符串（§4.8）
    Team team = Team::None;
    std::uint8_t teamSlot = 0;  // 队伍内槽位 0~4，前端映射颜色（§4.4）
};

/// 击杀事件（稀疏事件流，供 KillFeed 使用）。
struct KillEvent {
    Tick tick = 0;
    EntityId killer = 0;   // 0 = 无击杀者（环境/自杀）
    EntityId victim = 0;
    WeaponId weapon;       // 击杀武器
    bool headshot = false;
};

/// 回合区间（前端 manifest.rounds[] 的数据源）。
struct RoundSpan {
    std::uint32_t index = 0;      // 回合序号，0 起
    Tick startTick = 0;           // 回合开始
    Tick endTick = 0;             // 回合结束（含）
    Tick liveStartTick = 0;       // 冻结结束、真正开打
    std::uint8_t winnerTeam = 0;  // 胜方 2=T 3=CT 0=未知（round_end 事件）
};

class EntityStore {
public:
    static constexpr bool kThreadSafe = true;

    EntityStore() = default;
    EntityStore(const EntityStore&) = delete;
    EntityStore& operator=(const EntityStore&) = delete;

    // =========================================================================
    // 写入（后台解析线程调用）
    // =========================================================================
    void AddPlayer(EntityId id, PlayerIdentity identity, Tick begin, Tick end,
                   std::vector<PlayerSnapshot> frames) {
        PlayerRecord rec;
        rec.identity = std::move(identity);
        rec.begin = begin;
        rec.end = end;
        rec.frames = std::move(frames);
        players_[id] = std::move(rec);
        // 玩家是长命固定节点，不进 lifetimes_（由 PlayerList 固定管理）。
    }

    void AddEntity(EntityId id, EntityKind kind, Tick begin, Tick end,
                   std::vector<TransformSnapshot> frames) {
        EntityRecord rec;
        rec.kind = kind;
        rec.begin = begin;
        rec.end = end;
        rec.frames = std::move(frames);
        entities_[id] = std::move(rec);
        lifetimes_.push_back(LifetimeRecord{id, kind, begin, end});  // 短命实体：供动态增删
    }

    void SetWeaponSpec(EntityId id, WeaponSpec spec) { weaponSpecs_[id] = std::move(spec); }
    void SetGrenadeSpec(EntityId id, GrenadeSpec spec) { grenadeSpecs_[id] = std::move(spec); }
    void SetC4Spec(EntityId id, C4Spec spec) { c4Specs_[id] = std::move(spec); }

    /// 武器目录登记：返回该武器名的编号（首次出现时追加目录）。
    /// 装载线程专用（写）；播放期只读目录，无并发冲突。
    WeaponNum InternWeapon(const WeaponId& name) {
        std::lock_guard<std::mutex> lock(weaponMutex_);
        auto it = weaponIndex_.find(name);
        if (it != weaponIndex_.end()) return it->second;
        const auto num = static_cast<WeaponNum>(weaponCatalog_.size() + 1);  // 0 保留
        weaponCatalog_.push_back(name);
        weaponIndex_.emplace(name, num);
        return num;
    }

    const std::vector<WeaponId>& WeaponCatalog() const { return weaponCatalog_; }

    WeaponId WeaponName(WeaponNum num) const {
        if (num == kNoWeapon || num > weaponCatalog_.size()) return {};
        return weaponCatalog_[num - 1];
    }

    /// C4 状态机变更（稀疏事件），按 tick 升序追加。
    void AddC4StatusChange(EntityId id, Tick tick, C4Status status) {
        c4StatusChanges_[id].emplace_back(tick, status);
    }

    /// 击杀事件（按 tick 升序追加）。
    void AddKillEvent(KillEvent e) { killEvents_.push_back(std::move(e)); }

    /// 回合区间（按 startTick 升序追加；前端 manifest.rounds[] 数据源）。
    void AddRound(RoundSpan r) { rounds_.push_back(r); }
    const std::vector<RoundSpan>& Rounds() const { return rounds_; }

    /// 地图名（前端 manifest.mapName）。
    void SetMapName(std::string name) { mapName_ = std::move(name); }
    const std::string& MapName() const { return mapName_; }

    /// 清空全部装载产物（换 demo / 重复装载前必须调用）：
    /// vector 类容器（rounds_/killEvents_/lifetimes_/c4StatusChanges_）是追加式，
    /// 不清会导致比分/击杀/C4 时间线翻倍、tick 顺序错乱；map 类容器按 id 覆盖，
    /// 但两次装载的 id 从相同基数分配，不清会让两场数据混进同一批 id。
    /// World 子树的 Player/Entity 节点持有 EntityId，数据全部从本 store 现读，
    /// 因此清空后旧节点读新数据是安全的（名册重初始化走 InitializePlayers）。
    void Clear() {
        std::lock_guard<std::mutex> lock(weaponMutex_);
        players_.clear();
        entities_.clear();
        weaponSpecs_.clear();
        grenadeSpecs_.clear();
        c4Specs_.clear();
        c4StatusChanges_.clear();
        killEvents_.clear();
        rounds_.clear();
        lifetimes_.clear();
        weaponCatalog_.clear();
        weaponIndex_.clear();
        mapName_.clear();
        maxTick_ = 0;
        currentTick_.store(0, std::memory_order_release);
    }

    /// 整场最后一个 tick（DemoLoader 从 demo header 写入）。
    void SetMaxTick(Tick t) { maxTick_ = t; }
    Tick MaxTick() const { return maxTick_; }

    /// 击杀事件全量列表（ContractFeed 用，按 tick 升序）。
    const std::vector<KillEvent>& KillEvents() const { return killEvents_; }

    /// C4 状态变更表（ContractFeed 的 bomb.segments 数据源）。
    const std::vector<std::pair<Tick, C4Status>>* C4StatusChangesAt(EntityId id) const {
        auto it = c4StatusChanges_.find(id);
        return it == c4StatusChanges_.end() ? nullptr : &it->second;
    }

    /// 玩家整场帧数组（ContractFeed 批量导出用；未登记返回 nullptr）。
    const std::vector<PlayerSnapshot>* PlayerFrames(EntityId id) const {
        auto it = players_.find(id);
        return it == players_.end() ? nullptr : &it->second.frames;
    }

    // =========================================================================
    // 查询（主线程 / 前端 ReadData 时调用）
    // =========================================================================
    const PlayerIdentity* IdentityAt(EntityId id) const {
        auto it = players_.find(id);
        return it == players_.end() ? nullptr : &it->second.identity;
    }

    const PlayerSnapshot* PlayerAt(EntityId id, Tick tick) const {
        auto it = players_.find(id);
        if (it == players_.end()) return nullptr;
        const PlayerRecord& rec = it->second;
        if (tick < rec.begin || tick >= rec.end) return nullptr;
        return &rec.frames[static_cast<std::size_t>(tick - rec.begin)];
    }

    const TransformSnapshot* TransformAt(EntityId id, Tick tick) const {
        auto it = entities_.find(id);
        if (it == entities_.end()) return nullptr;
        const EntityRecord& rec = it->second;
        if (tick < rec.begin || tick >= rec.end) return nullptr;
        return &rec.frames[static_cast<std::size_t>(tick - rec.begin)];
    }

    const WeaponSpec* WeaponSpecAt(EntityId id) const {
        auto it = weaponSpecs_.find(id);
        return it == weaponSpecs_.end() ? nullptr : &it->second;
    }

    const GrenadeSpec* GrenadeSpecAt(EntityId id) const {
        auto it = grenadeSpecs_.find(id);
        return it == grenadeSpecs_.end() ? nullptr : &it->second;
    }

    const C4Spec* C4SpecAt(EntityId id) const {
        auto it = c4Specs_.find(id);
        return it == c4Specs_.end() ? nullptr : &it->second;
    }

    /// 玩家在 tick 时的当前武器（全量快照：O(1) 查表 + 目录还原字符串）。
    WeaponId WeaponAt(EntityId id, Tick tick) const {
        auto it = players_.find(id);
        if (it == players_.end()) return {};
        if (tick < it->second.begin || tick >= it->second.end) return {};
        return WeaponName(it->second.frames[tick - it->second.begin].weaponNum);
    }

    C4Status C4StatusAt(EntityId id, Tick tick) const {
        auto it = c4StatusChanges_.find(id);
        if (it == c4StatusChanges_.end()) return C4Status::Carried;
        C4Status result = C4Status::Carried;
        for (const auto& [t, s] : it->second) {
            if (t > tick) break;
            result = s;
        }
        return result;
    }

    /// 某实体在某 tick 是否存活（未登记或越界返回 false）。
    bool AliveAt(EntityId id, Tick tick) const {
        if (auto it = players_.find(id); it != players_.end()) {
            return tick >= it->second.begin && tick < it->second.end;
        }
        if (auto it = entities_.find(id); it != entities_.end()) {
            return tick >= it->second.begin && tick < it->second.end;
        }
        return false;
    }

    // =========================================================================
    // 整场世界快照（§4.1「存储 + 游标视图」的聚合视图）
    // 纯查询层便利函数：前端要一次性拿「某 tick 的完整世界状态」（全量重绘/
    // 记分板/小地图）时用，内部就是循环调上面几个单点查询，不改存储。
    // =========================================================================
    struct WorldSnapshot {
        Tick tick = 0;
        struct PlayerView {
            EntityId id;
            const PlayerIdentity* identity;  // 指向 store 内部（装载后不再写入，稳定）
            const PlayerSnapshot* snap;
            WeaponId weapon;                 // 目录还原后的武器名
        };
        struct EntityView {
            EntityId id;
            EntityKind kind;
            const TransformSnapshot* transform;
        };
        std::vector<PlayerView> players;
        std::vector<EntityView> entities;    // 只含该 tick 存活的短命实体
        std::vector<KillEvent> recentKills;  // 最多 maxKills 条（最新在前）
    };

    WorldSnapshot SnapshotAt(Tick tick, std::size_t maxKills = 8) const {
        WorldSnapshot ws;
        ws.tick = tick;
        for (const auto& [id, rec] : players_) {
            if (tick >= rec.begin && tick < rec.end) {
                const PlayerSnapshot* s = &rec.frames[tick - rec.begin];
                ws.players.push_back({id, &rec.identity, s, WeaponName(s->weaponNum)});
            }
        }
        for (const auto& [id, rec] : entities_) {
            if (tick >= rec.begin && tick < rec.end) {
                ws.entities.push_back({id, rec.kind, &rec.frames[tick - rec.begin]});
            }
        }
        ws.recentKills = RecentKills(tick, maxKills);
        return ws;
    }

    /// 所有玩家 id（供 PlayerList 一次性装配）。
    std::vector<EntityId> PlayerIds() const {
        std::vector<EntityId> ids;
        ids.reserve(players_.size());
        for (const auto& [id, rec] : players_) {
            (void)rec;
            ids.push_back(id);
        }
        return ids;
    }

    /// 玩家整场存活区间（PlayerList 创建节点时用）。
    TickInterval PlayerLifetime(EntityId id) const {
        auto it = players_.find(id);
        if (it == players_.end()) return {};
        return TickInterval{it->second.begin, it->second.end};
    }

    /// 目标 tick 之前最近的 n 条击杀（最新在前）。事件按 tick 升序存储。
    std::vector<KillEvent> RecentKills(Tick tick, std::size_t n) const {
        std::vector<KillEvent> result;
        result.reserve(n);
        for (auto it = killEvents_.rbegin(); it != killEvents_.rend() && result.size() < n; ++it) {
            if (it->tick <= tick) result.push_back(*it);
        }
        return result;
    }

    // =========================================================================
    // 游标（唯一所有者 PlaybackController 写入，实体节点读时用它查表）
    // =========================================================================
    Tick CurrentTick() const { return currentTick_.load(std::memory_order_acquire); }
    void SetCurrentTick(Tick tick) { currentTick_.store(tick, std::memory_order_release); }

    // =========================================================================
    // 存活区间索引（短命实体，供 EntityList 做动态增删）
    // =========================================================================
    struct LifetimeRecord {
        EntityId id;
        EntityKind kind;
        Tick begin;
        Tick end;
    };
    const std::vector<LifetimeRecord>& Lifetimes() const { return lifetimes_; }

private:
    struct PlayerRecord {
        PlayerIdentity identity;
        Tick begin = 0;
        Tick end = 0;
        std::vector<PlayerSnapshot> frames;
    };
    struct EntityRecord {
        EntityKind kind = EntityKind::Weapon;
        Tick begin = 0;
        Tick end = 0;
        std::vector<TransformSnapshot> frames;
    };

    std::unordered_map<EntityId, PlayerRecord> players_;
    std::unordered_map<EntityId, EntityRecord> entities_;
    std::unordered_map<EntityId, WeaponSpec> weaponSpecs_;
    std::unordered_map<EntityId, GrenadeSpec> grenadeSpecs_;
    std::unordered_map<EntityId, C4Spec> c4Specs_;
    std::unordered_map<EntityId, std::vector<std::pair<Tick, C4Status>>> c4StatusChanges_;
    std::vector<KillEvent> killEvents_;   // 按 tick 升序
    std::vector<RoundSpan> rounds_;       // 按 startTick 升序
    std::vector<LifetimeRecord> lifetimes_;

    // 武器目录（编号 → 名字）；装载线程写、播放期只读
    std::mutex weaponMutex_;
    std::vector<WeaponId> weaponCatalog_;
    std::unordered_map<WeaponId, WeaponNum> weaponIndex_;

    std::string mapName_;                 // 整场不变（demo header）
    Tick maxTick_ = 0;                    // 整场不变（demo header）
    std::atomic<Tick> currentTick_{0};
};

} // namespace demoviewer
