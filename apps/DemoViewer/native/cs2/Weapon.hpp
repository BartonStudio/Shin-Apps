#pragma once

#include <nlohmann/json.hpp>

#include "Entity.hpp"

// =============================================================================
// 武器实体 —— 短命（掉落时成为独立实体），由 EntityList 动态增删
//
// 通道：state（item id 字符串 + 持有者 + 掉落态）。
// 注意：owner/dropped/dropPos 是「稀疏事件」（捡起/掉落才变），
//       不按每 tick 存，存储层待补（见 EntityStore 注释）。
// =============================================================================

namespace demoviewer {

class Weapon : public Entity {
public:
    Weapon(const EntityStore* store, EntityId id, TickInterval lifetime)
        : Entity(store, id, EntityKind::Weapon, lifetime) {}

    static void RegisterTypes(iobject::TypeBuilder<Weapon>& types) {
        types.template As<Entity>();
    }

protected:
    bool ReadChannel(iobject::DataChannelView channel,
                     iobject::DataReceiver receiver) const override {
        if (channel == "state") return ReadState(receiver);
        return false;
    }

private:
    bool ReadState(iobject::DataReceiver receiver) const {
        const WeaponSpec* spec = store_->WeaponSpecAt(id_);
        nlohmann::json j = {
            {"weapon", spec ? spec->itemId : std::string{}},
            // TODO: owner / dropped / dropPos 稀疏事件，存储层待补
            {"owner", 0u},
            {"dropped", false},
            {"dropPos", nlohmann::json::array({0.0f, 0.0f, 0.0f})}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }
};

} // namespace demoviewer
