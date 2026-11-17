#pragma once

#include <memory>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Logger.hpp>
#include <iobject/Runtime.hpp>

#include "CameraController.hpp"
#include "DemoLoaderNode.hpp"
#include "EntityStore.hpp"
#include "KillFeed.hpp"
#include "PlaybackController.hpp"
#include "Scoreboard.hpp"
#include "WorldState.hpp"

// =============================================================================
// CSRoot —— CS2 Demo 播放器的域根节点（替代早期的 DemoRoot）
//
// 职责：
//   - 组合 iobject::Logger（Invoke("Log") 汇聚点，与 DemoRoot 相同的鸭子转发）；
//   - 持有 EntityStore 的唯一所有权（shared_ptr），其余节点只持裸指针；
//   - 在 BindRuntime 里一次性创建并挂载业务子树：
//       Playback / World / Scoreboard / KillFeed / POV。
//
// 装配顺序：MakeRoot 返回本节点 → 框架回调 BindRuntime（挂业务子树）→
//           解析器把数据灌进 store() → world()->InitializePlayers()。
// =============================================================================

namespace demoviewer {

class CSRoot {
public:
    static constexpr bool kThreadSafe = true;

    CSRoot() : store_(std::make_shared<EntityStore>()) {}

    ~CSRoot() {
        delete pov_;
        delete killfeed_;
        delete scoreboard_;
        delete world_;
        delete playback_;
    }

    static void RegisterTypes(iobject::TypeBuilder<CSRoot>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) {
        // 框架约定（IObject 规则书 §3）：节点构造后回调一次（绑定），
        // 节点析构前以 nullptr 再回调一次（解绑）。解绑时只清指针，
        // 绝不能走下面的装配流程 —— self 为空，self_->Connect 直接崩。
        self_ = self;
        m_logger.BindRuntime(self);
        if (self == nullptr) return;
        // 已装配过就不再重复挂载（子树名字唯一，二次 Connect 会失败）。
        if (playback_ != nullptr) return;

        // 创建业务子树（名字唯一、root 为新节点，Connect 假定成功）。
        playback_ = iobject::Runtime::make<PlaybackController>(store_.get());
        self_->Connect("Playback", playback_);

        world_ = iobject::Runtime::make<WorldState>(store_.get());
        self_->Connect("World", world_);

        scoreboard_ = iobject::Runtime::make<Scoreboard>(store_.get());
        self_->Connect("Scoreboard", scoreboard_);

        killfeed_ = iobject::Runtime::make<KillFeed>(store_.get());
        self_->Connect("KillFeed", killfeed_);

        pov_ = iobject::Runtime::make<CameraController>(store_.get());
        self_->Connect("POV", pov_);

        // 装载节点：Invoke("Load", path) 触发后台解析 → 灌 store →
        // 前端据 progress=done 再 Invoke World "InitializePlayers"（§装配顺序）。
        loader_ = iobject::Runtime::make<DemoLoaderNode>(store_.get());
        self_->Connect("Loader", loader_);
    }

    // ---- Logger 鸭子转发（Invoke("Log") 汇聚点）----
    bool WriteData(iobject::DataChannelView channel, iobject::ByteInput data) {
        return m_logger.WriteData(channel, data);
    }
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        return m_logger.ReadData(channel, receiver);
    }
    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
        return m_logger.Invoke(method, args, result);
    }

    // ---- 解析数据灌入口（非 const：AddPlayer / AddEntity / AddKillEvent 等写入）----
    EntityStore& store() { return *store_; }

    // ---- 业务节点访问 ----
    iobject::IRuntimeObject* playback() const { return playback_; }
    iobject::IRuntimeObject* world() const { return world_; }
    iobject::IRuntimeObject* scoreboard() const { return scoreboard_; }
    iobject::IRuntimeObject* killfeed() const { return killfeed_; }
    iobject::IRuntimeObject* pov() const { return pov_; }
    iobject::IRuntimeObject* loader() const { return loader_; }

private:
    iobject::Logger m_logger;
    std::shared_ptr<EntityStore> store_;
    iobject::IRuntimeObject* self_ = nullptr;
    iobject::IRuntimeObject* playback_ = nullptr;
    iobject::IRuntimeObject* world_ = nullptr;
    iobject::IRuntimeObject* scoreboard_ = nullptr;
    iobject::IRuntimeObject* killfeed_ = nullptr;
    iobject::IRuntimeObject* pov_ = nullptr;
    iobject::IRuntimeObject* loader_ = nullptr;
};

} // namespace demoviewer
