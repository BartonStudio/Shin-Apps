#pragma once

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "EntityList.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"
#include "PlayerList.hpp"

// =============================================================================
// 世界状态节点 —— 「存储 + 游标视图」的分水岭（架构文档 §4.1）
//
// 上面是 Playback（游标来源），下面是实体视图。WorldState 不拥有存储（只持只读裸指针，
// 所有权归 CSRoot 的 shared_ptr），实体节点经它拿到 store 引用 + 当前游标。
// 同时作为父容器，挂 Players（PlayerList）与 Entities（EntityList）。
// =============================================================================

namespace demoviewer {

class WorldState {
public:
    static constexpr bool kThreadSafe = true;

    explicit WorldState(const EntityStore* store) : store_(store) {}

    ~WorldState() {
        delete players_;
        delete entities_;
    }

    static void RegisterTypes(iobject::TypeBuilder<WorldState>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) {
        self_ = self;
        if (!players_) {
            players_ = iobject::Runtime::make<PlayerList>(store_);
            if (!self_->Connect("Players", players_)) {
                delete players_;
                players_ = nullptr;
            }
        }
        if (!entities_) {
            entities_ = iobject::Runtime::make<EntityList>(store_);
            if (!self_->Connect("Entities", entities_)) {
                delete entities_;
                entities_ = nullptr;
            }
        }
    }

    const EntityStore& store() const { return *store_; }

    /// 一次性装配玩家节点（需在玩家数据加载完成后、前端连接前调用）。
    void InitializePlayers() {
        if (players_) players_->As<PlayerList>()->Initialize();
    }

    // ---- 命令入口（前端 Invoke）----
    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
        if (method == "InitializePlayers") {
            // 装载完成后的装配触发点：Loader 节点报 done → 前端 Invoke 本方法。
            InitializePlayers();
            result(iobject::ByteView{});
            return true;
        }
        return false;
    }

    /// 短命实体动态增删同步（游标变化时驱动）。
    void SyncEntities(Tick tick) {
        if (entities_) entities_->As<EntityList>()->SyncToTick(tick);
    }

    iobject::IRuntimeObject* players() const { return players_; }
    iobject::IRuntimeObject* entities() const { return entities_; }

private:
    const EntityStore* store_ = nullptr;
    iobject::IRuntimeObject* self_ = nullptr;
    iobject::IRuntimeObject* players_ = nullptr;   // PlayerList 节点
    iobject::IRuntimeObject* entities_ = nullptr;  // EntityList 节点
};

} // namespace demoviewer
