#pragma once

#include <nlohmann/json.hpp>

#include "Entity.hpp"

// =============================================================================
// 玩家实体 —— 长命固定节点（PlayerList 下建一次），只读视图
//
// 通道：identity（覆盖，补 name/steamId/team）/ stats / transform / weapon。
// transform 由基类提供；stats/weapon 是玩家专属。
// 命令：无（切视角走 POV.Spectate，玩家是只读视图，见架构文档 §4.4）。
// =============================================================================

namespace demoviewer {

class Player : public Entity {
public:
    Player(const EntityStore* store, EntityId id, TickInterval lifetime)
        : Entity(store, id, EntityKind::Player, lifetime) {}

    static void RegisterTypes(iobject::TypeBuilder<Player>& types) {
        types.template As<Entity>();  // Player* → Entity*
    }

protected:
    bool ReadChannel(iobject::DataChannelView channel,
                     iobject::DataReceiver receiver) const override {
        if (channel == "stats")  return ReadStats(receiver);
        if (channel == "weapon") return ReadWeapon(receiver);
        return false;
    }

    bool ReadIdentity(iobject::DataReceiver receiver) const override {
        const PlayerIdentity* ident = store_->IdentityAt(id_);
        nlohmann::json j = {
            {"id", id_},
            {"kind", static_cast<int>(EntityKind::Player)},
            {"name", ident ? ident->name : std::string{}},
            {"steamId", ident ? ident->steamId : std::string{}},
            {"team", ident ? static_cast<int>(ident->team) : static_cast<int>(Team::None)}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

private:
    bool ReadStats(iobject::DataReceiver receiver) const {
        const PlayerSnapshot* s = store_->PlayerAt(id_, store_->CurrentTick());
        if (!s) return false;
        nlohmann::json j = {
            {"kills", s->kills},
            {"deaths", s->deaths},
            {"assists", s->assists},
            {"adr", s->adr},
            {"money", s->money},
            {"alive", s->alive}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    bool ReadWeapon(iobject::DataReceiver receiver) const {
        const PlayerSnapshot* s = store_->PlayerAt(id_, store_->CurrentTick());
        nlohmann::json j = {
            {"active", store_->WeaponAt(id_, store_->CurrentTick())},
            {"clipAmmo", s ? s->clipAmmo : std::uint16_t{0}},
            {"reserveMagazines", s ? s->reserveMagazines : std::uint16_t{0}}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }
};

} // namespace demoviewer
