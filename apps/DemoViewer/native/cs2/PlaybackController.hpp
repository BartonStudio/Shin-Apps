#pragma once

#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "Encode.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"

// =============================================================================
// 播放控制器 —— 游标唯一所有者 + 播放时钟（架构文档决策 1 / §3）
//
// 全应用只有一个 currentTick 权威值，就存在这里。跳转/倍速/回合导航全部收敛为
// 「改游标」这一件事；游标变化时发布一次 DataChannelChanged("state") 节拍信号，
// 其余节点（WorldState/Scoreboard/KillFeed/实体视图）都是消费者，跟随游标刷新。
// =============================================================================

namespace demoviewer {

class PlaybackController {
public:
    static constexpr bool kThreadSafe = true;

    explicit PlaybackController(EntityStore* store) : store_(store) {}

    static void RegisterTypes(iobject::TypeBuilder<PlaybackController>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) { self_ = self; }

    // ---- 数据通道：state（游标 + 播放状态），前端订阅它作为「节拍」 ----
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "state") return ReadState(receiver);
        return false;
    }

    // ---- 命令入口（前端 Invoke）----
    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
        if (method == "Play") { Play(); result(iobject::ByteView{}); return true; }
        if (method == "Pause") { Pause(); result(iobject::ByteView{}); return true; }
        if (method == "Seek") {
            auto j = nlohmann::json::from_msgpack(args.begin(), args.end());
            if (j.is_number_unsigned()) {
                Seek(static_cast<Tick>(j.get<std::uint32_t>()));
                result(iobject::ByteView{});
                return true;
            }
            return false;
        }
        if (method == "SetSpeed") {
            auto j = nlohmann::json::from_msgpack(args.begin(), args.end());
            if (j.is_number()) {
                SetSpeed(j.get<float>());
                result(iobject::ByteView{});
                return true;
            }
            return false;
        }
        if (method == "PrevRound") { PrevRound(); result(iobject::ByteView{}); return true; }
        if (method == "NextRound") { NextRound(); result(iobject::ByteView{}); return true; }
        return false;
    }

    // ---- 业务接口 ----
    void Play() { playing_ = true; }
    void Pause() { playing_ = false; }
    void Seek(Tick tick) { SetTick(tick); }
    void SetSpeed(float speed) { speed_ = speed; }

    /// 上一/下一回合：跳到对应回合开始。依赖 RoundList（未搭），骨架阶段留 TODO。
    void PrevRound() { /* TODO: 需要 RoundList 提供回合边界 */ }
    void NextRound() { /* TODO: 需要 RoundList 提供回合边界 */ }

    /// 定时推进一帧（宿主循环按 64 tick/s × 倍速 调度调用）。
    void Advance() {
        if (!playing_) return;
        SetTick(store_->CurrentTick() + 1);
    }

    bool playing() const { return playing_; }
    float speed() const { return speed_; }

private:
    /// 唯一改游标入口：写 store 并发布节拍信号。
    void SetTick(Tick tick) {
        store_->SetCurrentTick(tick);
        if (self_) {
            self_->Publish(
                iobject::RuntimeEventTypes::DataChannelChanged,
                iobject::Runtime::make<iobject::DataChannelChangedEventData>("state"),
                true);
        }
    }

    bool ReadState(iobject::DataReceiver receiver) const {
        nlohmann::json j = {
            {"playing", playing_},
            {"speed", speed_},
            {"currentTick", store_->CurrentTick()}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    EntityStore* store_ = nullptr;
    iobject::IRuntimeObject* self_ = nullptr;
    bool playing_ = false;
    float speed_ = 1.0f;
};

} // namespace demoviewer
