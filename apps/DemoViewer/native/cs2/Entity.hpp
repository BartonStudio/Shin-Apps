#pragma once

#include <cstdint>
#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "Encode.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"

// =============================================================================
// 实体基类 Entity —— 所有游戏实体的鸭子类型父类
//
// 设计（见 docs/cs2-demo-player-architecture.md §4.3）：
//   - 不继承 IRuntimeObject，而是实现 ReadData/BindRuntime/RegisterTypes 等鸭子钩子，
//     经 Runtime::make<Player>() 等包装成对象树节点；
//   - 模板方法模式：ReadData 统一处理通用通道（lifetime/transform/identity），
//     子类通过 ReadChannel / ReadIdentity 扩展自己的专属通道；
//   - 视图节点不存数据：只持有 store 指针 + 实体 id，读时按当前游标 tick 查表。
// =============================================================================

namespace demoviewer {

class Entity {
public:
    /// 标记：ReadData 内部只读 store（线程安全），框架跳过线程亲和断言。
    static constexpr bool kThreadSafe = true;

    Entity(const EntityStore* store, EntityId id, EntityKind kind, TickInterval lifetime)
        : store_(store), id_(id), kind_(kind), lifetime_(lifetime) {}

    virtual ~Entity() = default;

    // ---- 鸭子类型钩子 ----

    /// 类型登记：让 node->As<Entity>() 可用。
    /// 子类（Player 等）在其 RegisterTypes 里 `types.As<Entity>()` 即可向上转换。
    static void RegisterTypes(iobject::TypeBuilder<Entity>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) { self_ = self; }

    /// 数据通道出口：前端 ReadData 时调用。
    /// 通用通道在基类处理，子类专属通道交给 ReadChannel（模板方法）。
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "lifetime")  return ReadLifetime(receiver);
        if (channel == "transform") return ReadTransform(receiver);
        if (channel == "identity")  return ReadIdentity(receiver);
        return ReadChannel(channel, receiver);
    }

    // ---- 访问器（供 WorldState / EntityList / CameraController 等业务方使用）----
    EntityId id() const { return id_; }
    EntityKind kind() const { return kind_; }
    TickInterval lifetime() const { return lifetime_; }
    bool aliveAt(Tick tick) const { return tick >= lifetime_.begin && tick < lifetime_.end; }
    iobject::IRuntimeObject* self() const { return self_; }

protected:
    /// 子类扩展点：处理专属通道（stats/weapon/trajectory/effect/state…）。
    /// 默认不支持（返回 false = 框架层面 ReadData 失败）。
    virtual bool ReadChannel(iobject::DataChannelView channel,
                             iobject::DataReceiver receiver) const {
        (void)channel;
        (void)receiver;
        return false;
    }

    /// 子类可覆盖：基类默认只给 {id, kind}，Player 覆盖补 name/steamId/team。
    virtual bool ReadIdentity(iobject::DataReceiver receiver) const {
        nlohmann::json j = {
            {"id", id_},
            {"kind", static_cast<int>(kind_)}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    const EntityStore* store_;
    EntityId id_;
    EntityKind kind_;
    TickInterval lifetime_;
    iobject::IRuntimeObject* self_ = nullptr;

private:
    bool ReadLifetime(iobject::DataReceiver receiver) const {
        nlohmann::json j = {
            {"begin", lifetime_.begin},
            {"end", lifetime_.end},
            {"alive", aliveAt(store_->CurrentTick())}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    bool ReadTransform(iobject::DataReceiver receiver) const {
        const Tick tick = store_->CurrentTick();
        Vec3 pos;
        ViewAngle view;
        if (kind_ == EntityKind::Player) {
            const PlayerSnapshot* s = store_->PlayerAt(id_, tick);
            if (!s) return false;
            pos = s->pos;
            view = s->view;
        } else {
            const TransformSnapshot* s = store_->TransformAt(id_, tick);
            if (!s) return false;
            pos = s->pos;
            view = s->view;
        }
        nlohmann::json j = {
            {"tick", tick},
            {"pos", ToJson(pos)},
            {"view", ToJson(view)}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }
};

} // namespace demoviewer
