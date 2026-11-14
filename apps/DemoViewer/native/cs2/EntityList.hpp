#pragma once

#include <string>
#include <unordered_map>
#include <utility>

#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "C4Bomb.hpp"
#include "Encode.hpp"
#include "Entity.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"
#include "Grenade.hpp"
#include "Player.hpp"
#include "Weapon.hpp"

// =============================================================================
// 短命实体列表 —— 负责 Weapon / Grenade / C4 的动态增删（§4.5）
//
// 要点：
//   - 游标跨越某实体存活区间边界时 Connect/Disconnect（不每 tick 全量遍历）；
//   - 前端靠 ChildConnected / ChildDisconnected 事件增删渲染对象；
//   - 玩家是长命固定节点，由 PlayerList 管理，不在本列表内。
// =============================================================================

namespace demoviewer {

inline std::string KindName(EntityKind kind) {
    switch (kind) {
        case EntityKind::Player:  return "player";
        case EntityKind::Weapon:  return "weapon";
        case EntityKind::Grenade: return "grenade";
        case EntityKind::C4:      return "c4";
    }
    return "entity";
}

class EntityList {
public:
    static constexpr bool kThreadSafe = true;

    explicit EntityList(const EntityStore* store) : store_(store) {}

    ~EntityList() {
        for (auto& [id, child] : children_) {
            (void)id;
            delete child.node;
        }
    }

    static void RegisterTypes(iobject::TypeBuilder<EntityList>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) { self_ = self; }

    /// 数据通道：当前在场实体 id 列表（供前端初始同步/快照）。
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "alive") return ReadAlive(receiver);
        return false;
    }

    /// 核心：按 tick 同步增删（游标变化时由 WorldState / Playback 驱动调用）。
    void SyncToTick(Tick tick) {
        for (const auto& rec : store_->Lifetimes()) {
            if (rec.kind == EntityKind::Player) continue;  // 玩家由 PlayerList 固定管理
            const bool shouldExist = tick >= rec.begin && tick < rec.end;
            const bool exists = children_.contains(rec.id);
            if (shouldExist && !exists) {
                Spawn(rec.id, rec.kind, TickInterval{rec.begin, rec.end});
            } else if (!shouldExist && exists) {
                Despawn(rec.id);
            }
        }
        lastTick_ = tick;
    }

    /// 工厂：按 kind 创建对应的实体视图节点（调用方负责 delete 返回节点）。
    static iobject::IRuntimeObject* CreateEntityNode(const EntityStore* store, EntityId id,
                                                     EntityKind kind, TickInterval lifetime) {
        switch (kind) {
            case EntityKind::Player:  return iobject::Runtime::make<Player>(store, id, lifetime);
            case EntityKind::Weapon:  return iobject::Runtime::make<Weapon>(store, id, lifetime);
            case EntityKind::Grenade: return iobject::Runtime::make<Grenade>(store, id, lifetime);
            case EntityKind::C4:      return iobject::Runtime::make<C4Bomb>(store, id, lifetime);
        }
        return nullptr;
    }

private:
    struct ChildNode {
        iobject::IRuntimeObject* node = nullptr;
        std::string name;
    };

    bool ReadAlive(iobject::DataReceiver receiver) const {
        nlohmann::json ids = nlohmann::json::array();
        for (const auto& [id, child] : children_) {
            (void)child;
            ids.push_back(id);
        }
        SendBytes(EncodeMsgPack(ids), receiver);
        return true;
    }

    iobject::IRuntimeObject* Spawn(EntityId id, EntityKind kind, TickInterval lifetime) {
        iobject::IRuntimeObject* node = CreateEntityNode(store_, id, kind, lifetime);
        if (!node) return nullptr;
        const std::string name = KindName(kind) + ":" + std::to_string(id);
        if (self_ && self_->Connect(name, node)) {
            children_[id] = ChildNode{node, name};
            return node;
        }
        delete node;  // Connect 失败：不归属本节点，立即释放
        return nullptr;
    }

    void Despawn(EntityId id) {
        auto it = children_.find(id);
        if (it == children_.end()) return;
        if (self_) {
            self_->Disconnect(it->second.name);
        }
        delete it->second.node;  // 释放运行时节点（父节点不 delete child，本类负责）
        children_.erase(it);
    }

    const EntityStore* store_;
    iobject::IRuntimeObject* self_ = nullptr;
    std::unordered_map<EntityId, ChildNode> children_;
    Tick lastTick_ = 0;
};

} // namespace demoviewer
