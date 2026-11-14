#pragma once

#include <atomic>
#include <cstdint>
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
    Tick throwTick = 0;
    Tick detonateTick = 0;
    std::vector<Vec3> trajectoryPoints;  // 抛→落/爆 路径点（C++ 算好，前端画线）
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

    /// 玩家当前武器（稀疏事件：记录「变更点」，而非每 tick 存字符串）。
    /// 假设按 tick 升序追加；骨架阶段不重排序。
    void AddWeaponChange(EntityId id, Tick tick, WeaponId weaponId) {
        players_[id].weaponChanges.emplace_back(tick, std::move(weaponId));
    }

    /// C4 状态机变更（稀疏事件），按 tick 升序追加。
    void AddC4StatusChange(EntityId id, Tick tick, C4Status status) {
        c4StatusChanges_[id].emplace_back(tick, status);
    }

    /// 击杀事件（按 tick 升序追加）。
    void AddKillEvent(KillEvent e) { killEvents_.push_back(std::move(e)); }

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

    /// 玩家在 tick 时的当前武器（取最后一个 tick <= 目标 tick 的变更点）。
    WeaponId WeaponAt(EntityId id, Tick tick) const {
        auto it = players_.find(id);
        if (it == players_.end()) return {};
        const auto& changes = it->second.weaponChanges;
        WeaponId result;
        for (const auto& [t, w] : changes) {
            if (t > tick) break;
            result = w;
        }
        return result;
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
        std::vector<std::pair<Tick, WeaponId>> weaponChanges;  // 按 tick 升序
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
    std::vector<LifetimeRecord> lifetimes_;

    std::atomic<Tick> currentTick_{0};
};

} // namespace demoviewer
