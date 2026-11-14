#pragma once

#include <cstdint>

#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "Encode.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"

// =============================================================================
// 相机控制器（POV）—— 观察目标 + 存活自动切换（PRD F5）
//
// 命令 Spectate(id)：目标存活则切换，阵亡返回 false。
// 自动切换规则（UpdateTarget，游标变化时由装配代码驱动）：
//   当前目标阵亡 → 先同阵营存活，再敌方存活；无存活则保持 0。
// =============================================================================

namespace demoviewer {

class CameraController {
public:
    static constexpr bool kThreadSafe = true;

    explicit CameraController(const EntityStore* store) : store_(store) {}

    static void RegisterTypes(iobject::TypeBuilder<CameraController>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) { self_ = self; }

    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "target") return ReadTarget(receiver);
        return false;
    }

    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
        if (method == "Spectate") {
            auto j = nlohmann::json::from_msgpack(args.begin(), args.end());
            if (!j.is_number_unsigned()) return false;
            const bool ok = Spectate(static_cast<EntityId>(j.get<std::uint32_t>()));
            result(iobject::ByteView{});
            return ok;
        }
        return false;
    }

    /// 切视角：目标存活则切换成功，阵亡/不存在返回 false。
    bool Spectate(EntityId id) {
        if (!store_->AliveAt(id, store_->CurrentTick())) return false;
        currentTarget_ = id;
        return true;
    }

    /// 自动切换（游标变化时由装配代码调用）：当前目标阵亡则切下一个存活玩家。
    void UpdateTarget() {
        const Tick tick = store_->CurrentTick();
        if (currentTarget_ != 0 && store_->AliveAt(currentTarget_, tick)) return;
        currentTarget_ = FindNextAlive(currentTarget_, tick);
    }

private:
    bool ReadTarget(iobject::DataReceiver receiver) const {
        const Tick tick = store_->CurrentTick();
        const PlayerSnapshot* s =
            currentTarget_ != 0 ? store_->PlayerAt(currentTarget_, tick) : nullptr;
        nlohmann::json j = {
            {"target", currentTarget_},
            {"pos", s ? ToJson(s->pos) : nlohmann::json::array({0.0f, 0.0f, 0.0f})},
            {"view", s ? ToJson(s->view) : nlohmann::json::array({0.0f, 0.0f})}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    /// 找下一个存活玩家：先同阵营，再任意（比分板顺序）。
    EntityId FindNextAlive(EntityId afterId, Tick tick) const {
        const Team preferred = TeamOf(afterId);
        if (preferred != Team::None) {
            for (EntityId id : store_->PlayerIds()) {
                if (id == afterId) continue;
                if (TeamOf(id) == preferred && store_->AliveAt(id, tick)) return id;
            }
        }
        for (EntityId id : store_->PlayerIds()) {
            if (id == afterId) continue;
            if (store_->AliveAt(id, tick)) return id;
        }
        return 0;  // 无存活玩家
    }

    Team TeamOf(EntityId id) const {
        const PlayerIdentity* ident = store_->IdentityAt(id);
        return ident ? ident->team : Team::None;
    }

    const EntityStore* store_;
    iobject::IRuntimeObject* self_ = nullptr;
    EntityId currentTarget_ = 0;  // 0 = 无观察目标
};

} // namespace demoviewer
