#pragma once

#include <cstddef>
#include <string>

#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "Encode.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"

// =============================================================================
// 击杀播报 —— 环形缓冲 + 格式化（PRD F7）
//
// 从 store 取当前 tick 之前最近 N 条击杀，格式化为「击杀者 + 武器 + 被击杀者」。
// 击杀事件本身是稀疏事件流，存 store 的 killEvents_（非每 tick 快照）。
// =============================================================================

namespace demoviewer {

class KillFeed {
public:
    static constexpr bool kThreadSafe = true;

    explicit KillFeed(const EntityStore* store) : store_(store) {}

    static void RegisterTypes(iobject::TypeBuilder<KillFeed>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) { self_ = self; }

    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "entries") return ReadEntries(receiver);
        return false;
    }

private:
    bool ReadEntries(iobject::DataReceiver receiver) const {
        const auto events = store_->RecentKills(store_->CurrentTick(), kMaxEntries);
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& e : events) {
            arr.push_back({
                {"killer", PlayerName(e.killer)},
                {"victim", PlayerName(e.victim)},
                {"weapon", e.weapon},
                {"headshot", e.headshot}
            });
        }
        SendBytes(EncodeMsgPack(arr), receiver);
        return true;
    }

    std::string PlayerName(EntityId id) const {
        const PlayerIdentity* ident = store_->IdentityAt(id);
        return ident ? ident->name : std::string{};
    }

    static constexpr std::size_t kMaxEntries = 8;

    const EntityStore* store_;
    iobject::IRuntimeObject* self_ = nullptr;
};

} // namespace demoviewer
