#pragma once

#include <nlohmann/json.hpp>

#include "Entity.hpp"

// =============================================================================
// 投掷物实体 —— 短命，由 EntityList 动态增删
//
// 通道：trajectory（飞行轨迹点，C++ 算好）/ effect（烟雾范围/燃烧区域）。
// 逻辑边界（§4.4）：轨迹路径与范围几何参数由 C++ 算，前端只画线/渲染覆盖物。
// =============================================================================

namespace demoviewer {

class Grenade : public Entity {
public:
    Grenade(const EntityStore* store, EntityId id, TickInterval lifetime)
        : Entity(store, id, EntityKind::Grenade, lifetime) {}

    static void RegisterTypes(iobject::TypeBuilder<Grenade>& types) {
        types.template As<Entity>();
    }

protected:
    bool ReadChannel(iobject::DataChannelView channel,
                     iobject::DataReceiver receiver) const override {
        if (channel == "trajectory") return ReadTrajectory(receiver);
        if (channel == "effect")     return ReadEffect(receiver);
        return false;
    }

private:
    bool ReadTrajectory(iobject::DataReceiver receiver) const {
        const GrenadeSpec* spec = store_->GrenadeSpecAt(id_);
        if (!spec) return false;
        nlohmann::json points = nlohmann::json::array();
        for (const Vec3& p : spec->trajectoryPoints) {
            points.push_back(ToJson(p));
        }
        nlohmann::json j = {
            {"throwTick", spec->throwTick},
            {"detonateTick", spec->detonateTick},
            {"points", std::move(points)}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    bool ReadEffect(iobject::DataReceiver receiver) const {
        const GrenadeSpec* spec = store_->GrenadeSpecAt(id_);
        if (!spec) return false;
        nlohmann::json area = nlohmann::json::array();
        for (const Vec3& p : spec->fireArea) {
            area.push_back(ToJson(p));
        }
        nlohmann::json j = {
            {"type", static_cast<int>(spec->kind)},
            {"detonateTick", spec->detonateTick},
            {"radius", spec->effectRadius},
            {"area", std::move(area)}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }
};

} // namespace demoviewer
