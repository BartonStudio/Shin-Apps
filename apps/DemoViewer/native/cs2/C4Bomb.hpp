#pragma once

#include <nlohmann/json.hpp>

#include "Entity.hpp"

// =============================================================================
// C4 实体 —— 短命，由 EntityList 动态增删
//
// 状态机：carried → planted → exploding → defused/exploded（C4Status 枚举）。
// 通道：state（状态 + 安放位置/倒计时）。
// =============================================================================

namespace demoviewer {

class C4Bomb : public Entity {
public:
    C4Bomb(const EntityStore* store, EntityId id, TickInterval lifetime)
        : Entity(store, id, EntityKind::C4, lifetime) {}

    static void RegisterTypes(iobject::TypeBuilder<C4Bomb>& types) {
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
        const C4Spec* spec = store_->C4SpecAt(id_);
        nlohmann::json j = {
            {"status", static_cast<int>(store_->C4StatusAt(id_, store_->CurrentTick()))},
            {"carrier", spec ? spec->carrier : 0u},
            {"plantPos", spec ? ToJson(spec->plantPos) : nlohmann::json::array({0.0f, 0.0f, 0.0f})},
            {"plantTick", spec ? spec->plantTick : 0u},
            {"explodeTick", spec ? spec->explodeTick : 0u}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }
};

} // namespace demoviewer
