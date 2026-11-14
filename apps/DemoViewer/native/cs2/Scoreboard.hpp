#pragma once

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "Encode.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"

// =============================================================================
// 比分板 —— 纯聚合视图（PRD F6）
//
// 把 PlayerList 里各玩家的统计按队伍（CT/T）聚合，前端只渲染表格。
// 经济/KDA/ADR 等统计都在 C++ 侧算好。命令只有 ToggleVisible（显隐状态由 C++ 持有）。
// 玩家名可点击切视角：前端直接调 POV.Spectate，不走比分板。
// =============================================================================

namespace demoviewer {

class Scoreboard {
public:
    static constexpr bool kThreadSafe = true;

    explicit Scoreboard(const EntityStore* store) : store_(store) {}

    static void RegisterTypes(iobject::TypeBuilder<Scoreboard>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) { self_ = self; }

    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "rows") return ReadRows(receiver);
        if (channel == "visible") return ReadVisible(receiver);
        return false;
    }

    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
        (void)args;
        if (method == "ToggleVisible") {
            visible_ = !visible_;
            result(iobject::ByteView{});
            return true;
        }
        return false;
    }

private:
    bool ReadVisible(iobject::DataReceiver receiver) const {
        SendBytes(EncodeMsgPack(nlohmann::json{{"visible", visible_}}), receiver);
        return true;
    }

    bool ReadRows(iobject::DataReceiver receiver) const {
        const Tick tick = store_->CurrentTick();
        nlohmann::json ct = nlohmann::json::array();
        nlohmann::json t = nlohmann::json::array();
        for (EntityId id : store_->PlayerIds()) {
            const PlayerIdentity* ident = store_->IdentityAt(id);
            const PlayerSnapshot* s = store_->PlayerAt(id, tick);
            nlohmann::json row = {
                {"id", id},
                {"name", ident ? ident->name : std::string{}},
                {"teamSlot", ident ? ident->teamSlot : std::uint8_t{0}},
                {"kills", s ? s->kills : std::uint16_t{0}},
                {"deaths", s ? s->deaths : std::uint16_t{0}},
                {"assists", s ? s->assists : std::uint16_t{0}},
                {"adr", s ? s->adr : 0.0f},
                {"money", s ? s->money : std::uint16_t{0}},
                {"alive", s ? s->alive : false}
            };
            if (ident && ident->team == Team::CT) {
                ct.push_back(std::move(row));
            } else {
                t.push_back(std::move(row));
            }
        }
        SendBytes(EncodeMsgPack(nlohmann::json{{"ct", std::move(ct)}, {"t", std::move(t)}}), receiver);
        return true;
    }

    const EntityStore* store_;
    iobject::IRuntimeObject* self_ = nullptr;
    bool visible_ = true;
};

} // namespace demoviewer
