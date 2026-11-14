#pragma once

#include <string>
#include <unordered_map>

#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "Encode.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"
#include "Player.hpp"

// =============================================================================
// 玩家列表 —— 长命玩家的一次性装配（§4.4 / 设计说明）
//
// 玩家是整场固定的节点（10 人从开局到结束都在），所以这里「建一次就再也不动」，
// 与 EntityList（短命实体随 tick 增删）形成对照。两类对象的生命周期策略不同，故拆开。
// =============================================================================

namespace demoviewer {

class PlayerList {
public:
    static constexpr bool kThreadSafe = true;

    explicit PlayerList(const EntityStore* store) : store_(store) {}

    ~PlayerList() {
        for (auto& [id, node] : children_) {
            (void)id;
            delete node;
        }
    }

    static void RegisterTypes(iobject::TypeBuilder<PlayerList>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) { self_ = self; }

    /// 数据通道：玩家 id 列表（供前端初始同步）。
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "ids") return ReadIds(receiver);
        return false;
    }

    /// 一次性装配：为 store 里的每个玩家创建 Player 节点并 Connect。
    /// 需在玩家数据加载完成后、前端连接前调用。
    void Initialize() {
        for (EntityId id : store_->PlayerIds()) {
            iobject::IRuntimeObject* node =
                iobject::Runtime::make<Player>(store_, id, store_->PlayerLifetime(id));
            const std::string name = "player:" + std::to_string(id);
            if (self_ && self_->Connect(name, node)) {
                children_[id] = node;
            } else {
                delete node;
            }
        }
    }

private:
    bool ReadIds(iobject::DataReceiver receiver) const {
        nlohmann::json ids = nlohmann::json::array();
        for (const auto& [id, node] : children_) {
            (void)node;
            ids.push_back(id);
        }
        SendBytes(EncodeMsgPack(ids), receiver);
        return true;
    }

    const EntityStore* store_;
    iobject::IRuntimeObject* self_ = nullptr;
    std::unordered_map<EntityId, iobject::IRuntimeObject*> children_;
};

} // namespace demoviewer
