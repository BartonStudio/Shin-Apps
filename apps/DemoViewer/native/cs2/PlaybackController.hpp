#pragma once

#include <atomic>
#include <chrono>
#include <thread>

#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>
#include <iobject/Executor.hpp>

#include "Encode.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"

// =============================================================================
// 播放控制器 —— 游标唯一所有者 + 播放时钟（架构文档决策 1 / §3）
//
// 全应用只有一个 currentTick 权威值，就存在这里。跳转/倍速/回合导航全部收敛为
// 「改游标」这一件事；游标变化时发布一次 DataChannelChanged("state") 节拍信号，
// 其余节点（WorldState/Scoreboard/KillFeed/实体视图）都是消费者，跟随游标刷新。
//
// 播放时钟（P0）：
//   心跳线程只当「闹钟」——每 16ms 检查一次 playing_，在播则把「当前时刻」
//   经 iobject::Post 封回循环线程；循环线程里按真实时钟把游标拨到
//   「此刻应在的位置」（时钟对齐：定时器抖动不影响速度，Seek/倍速天然精确）。
//   所有播放状态（锚点/游标/开关）只在循环线程读写，心跳线程只读 playing_，
//   因此除 playing_/running_ 外无需任何锁。
// =============================================================================

namespace demoviewer {

class PlaybackController {
public:
    static constexpr bool kThreadSafe = true;

    explicit PlaybackController(EntityStore* store) : store_(store) {}

    // 心跳线程以 this 为上下文，析构必须先停表（否则悬垂）。
    ~PlaybackController() { StopHeartbeat(); }

    static void RegisterTypes(iobject::TypeBuilder<PlaybackController>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) {
        if (self == nullptr) {
            // 解绑：宿主域在拆，心跳没有继续跑的理由（也避免 Post 到已停止的宿主泵）。
            StopHeartbeat();
            self_ = nullptr;
            return;
        }
        self_ = self;
        StartHeartbeat();
    }

    // ---- 数据通道：state（游标 + 播放状态），前端订阅它作为「节拍」 ----
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "state") return ReadState(receiver);
        return false;
    }

    // ---- 命令入口（前端 Invoke；均在循环线程执行）----
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
    void Play() {
        if (store_->MaxTick() == 0) return;  // 未装载：无可播放的时间轴
        Reanchor();                          // 从当前位置、现在时刻起表
        playing_.store(true, std::memory_order_release);
    }
    void Pause() { playing_.store(false, std::memory_order_release); }
    void Seek(Tick tick) {
        SetTick(tick);
        // 播放中跳转：锚点必须挪到新位置，否则时钟会按旧轨迹把游标「拉回去」。
        if (playing_.load(std::memory_order_acquire)) Reanchor();
    }
    void SetSpeed(float speed) {
        speed_.store(speed, std::memory_order_release);
        // 改速即改轨迹斜率，播放中同样要重锚（否则速度跳变会补涨/回退一大段）。
        if (playing_.load(std::memory_order_acquire)) Reanchor();
    }

    /// 上一/下一回合：跳到对应回合开始。依赖 RoundList（未搭），骨架阶段留 TODO。
    void PrevRound() { /* TODO: 需要 RoundList 提供回合边界 */ }
    void NextRound() { /* TODO: 需要 RoundList 提供回合边界 */ }

    bool playing() const { return playing_.load(std::memory_order_acquire); }
    float speed() const { return speed_.load(std::memory_order_acquire); }

private:
    /// demo tickrate：与 DemoLoader 的 durationSec = maxTick / 64 同源（解析器当前固定 64）。
    static constexpr double kTickRate = 64.0;
    /// 心跳间隔：约 60Hz 出节拍，够渲染顺滑，也不至于空转烧 CPU。
    static constexpr int kHeartbeatMs = 16;

    /// 播放基准（锚点）：仅循环线程读写，无需原子。
    void Reanchor() {
        anchorTick_ = store_->CurrentTick();
        anchorTime_ = std::chrono::steady_clock::now();
    }

    /// 心跳循环（独立线程）：只做「在播 → 投递一次拨表任务」，不碰任何业务状态。
    void HeartbeatLoop() {
        using clock = std::chrono::steady_clock;
        while (running_.load(std::memory_order_acquire)) {
            if (playing_.load(std::memory_order_acquire)) {
                const auto now = clock::now();
                iobject::Post([this, now]() { AdvanceAt(now); });
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(kHeartbeatMs));
        }
    }

    /// 按真实时钟把游标拨到「此刻应在的位置」。仅循环线程执行。
    void AdvanceAt(std::chrono::steady_clock::time_point now) {
        if (!playing_.load(std::memory_order_acquire)) return;
        const double dt = std::chrono::duration<double>(now - anchorTime_).count();
        const Tick target =
            anchorTick_ + static_cast<Tick>(dt * kTickRate * speed_.load(std::memory_order_acquire));
        if (target <= store_->CurrentTick()) return;  // 还没走到下一个 tick
        const Tick maxTick = store_->MaxTick();
        if (target >= maxTick) {
            SetTick(maxTick);
            playing_.store(false, std::memory_order_release);  // 播完自动停
            return;
        }
        SetTick(target);
    }

    void StartHeartbeat() {
        if (heart_.joinable()) return;  // 已在跑（BindRuntime 可能被重复调用）
        running_.store(true, std::memory_order_release);
        heart_ = std::thread([this]() { HeartbeatLoop(); });
    }
    void StopHeartbeat() {
        running_.store(false, std::memory_order_release);
        if (heart_.joinable()) heart_.join();
    }

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
            {"playing", playing_.load(std::memory_order_acquire)},
            {"speed", speed_.load(std::memory_order_acquire)},
            {"currentTick", store_->CurrentTick()}
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    EntityStore* store_ = nullptr;
    iobject::IRuntimeObject* self_ = nullptr;
    std::atomic<bool> playing_{false};
    std::atomic<float> speed_{1.0f};
    std::atomic<bool> running_{false};
    std::thread heart_;
    // 播放锚点：仅循环线程访问
    Tick anchorTick_ = 0;
    std::chrono::steady_clock::time_point anchorTime_{};
};

} // namespace demoviewer
