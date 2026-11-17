#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "DemoLoader.hpp"
#include "Encode.hpp"
#include "EntityStore.hpp"

// =============================================================================
// DemoLoaderNode —— 解析装载的 IObject 节点（挂 CSRoot 下 "Loader"）
//
// 职责：命令入口 + 进度状态机，不做重活（重活在 DemoLoader 纯域类里，
// 后台 std::jthread 执行 —— 对应 EntityStore「后台解析线程写入」的约定）。
//
// 前端协议：
//   Invoke("Load", "path.dem")        开始装载（装载中重复调用返回 false）
//   ReadData("progress") → {stage, percent, done, error, mapName, maxTick, fileSize}
//   ReadData("meta")     → {mapName, maxTick, durationSec, fileSize}
//   完成后前端 Invoke World "InitializePlayers" 装配玩家节点（§装配顺序）。
// =============================================================================

namespace demoviewer {

class DemoLoaderNode {
public:
    static constexpr bool kThreadSafe = true;

    explicit DemoLoaderNode(EntityStore* store) : store_(store) {}

    ~DemoLoaderNode() {
        if (worker_.joinable()) worker_.join();
    }

    static void RegisterTypes(iobject::TypeBuilder<DemoLoaderNode>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) { self_ = self; }

    // ---- 数据通道 ----
    // 注意：必须是 const —— IObject 框架的 readData 回调签名为 const void*，
    // 非 const 成员会被静默忽略，桥层表现为「对象拒绝读取通道」。
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "progress") return ReadProgress(receiver);
        if (channel == "meta") return ReadMeta(receiver);
        return false;
    }

    // ---- 命令入口 ----
    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
        if (method == "Load") {
            auto j = nlohmann::json::from_msgpack(args.begin(), args.end());
            if (!j.is_string()) return false;
            const bool started = StartLoad(j.get<std::string>());
            if (started) result(iobject::ByteView{});
            return started;
        }
        return false;
    }

private:
    bool StartLoad(const std::string& path) {
        std::lock_guard<std::mutex> lock(loadMutex_);
        if (loading_.load(std::memory_order_acquire)) return false;

        // 重置状态 + 清空 store（支持换一个 demo 重新装载）
        {
            std::lock_guard<std::mutex> m(metaMutex_);
            mapName_.clear();
            maxTick_ = 0;
            fileSize_ = 0;
            error_.clear();
        }
        // 清空上一场的全部装载产物（无此调用则回合/击杀累加，比分翻倍）
        store_->Clear();
        stage_.store(static_cast<std::uint8_t>(LoadStage::Parsing), std::memory_order_release);
        percent_.store(0, std::memory_order_release);
        loading_.store(true, std::memory_order_release);

        if (worker_.joinable()) worker_.join();
        worker_ = std::jthread([this, path]() {
            DemoMeta meta;
            std::string err;
            auto onProgress = [this](LoadStage stage, int percent) {
                stage_.store(static_cast<std::uint8_t>(stage), std::memory_order_release);
                percent_.store(percent, std::memory_order_release);
                PublishProgress();
            };
            const bool ok = DemoLoader::Load(path, *store_, meta, onProgress, err);
            {
                std::lock_guard<std::mutex> m(metaMutex_);
                if (ok) {
                    mapName_ = meta.mapName;
                    maxTick_ = meta.maxTick;
                    fileSize_ = meta.fileSize;
                } else {
                    error_ = err;
                }
            }
            stage_.store(static_cast<std::uint8_t>(
                             ok ? LoadStage::Done : LoadStage::Error),
                         std::memory_order_release);
            percent_.store(ok ? 100 : 0, std::memory_order_release);
            loading_.store(false, std::memory_order_release);
            PublishProgress();  // done/error 都发一次，前端据此装配/提示
        });
        return true;
    }

    // 注意：不要从解析线程 Publish —— Publish 是同步派发且内部要拿运行时锁，
    // 在 worker 线程调用会与 Invoke 调用栈互锁（实测卡死在第一次 onProgress）。
    // 进度契约改为「前端轮询 ReadData("progress")」，这里不再发事件。
    void PublishProgress() {}

    bool ReadProgress(iobject::DataReceiver receiver) const {
        const auto stage = static_cast<LoadStage>(stage_.load(std::memory_order_acquire));
        std::string mapName, error;
        Tick maxTick = 0;
        std::uint64_t fileSize = 0;
        {
            std::lock_guard<std::mutex> m(metaMutex_);
            mapName = mapName_;
            maxTick = maxTick_;
            fileSize = fileSize_;
            error = error_;
        }
        nlohmann::json j = {
            {"stage", StageName(stage)},
            {"percent", percent_.load(std::memory_order_acquire)},
            {"done", stage == LoadStage::Done},
            {"failed", stage == LoadStage::Error},
            {"error", error},
            {"mapName", mapName},
            {"maxTick", maxTick},
            {"fileSize", fileSize},
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    bool ReadMeta(iobject::DataReceiver receiver) const {
        std::lock_guard<std::mutex> m(metaMutex_);
        nlohmann::json j = {
            {"mapName", mapName_},
            {"maxTick", maxTick_},
            {"durationSec", static_cast<float>(maxTick_) / 64.0f},
            {"fileSize", fileSize_},
        };
        SendBytes(EncodeMsgPack(j), receiver);
        return true;
    }

    static const char* StageName(LoadStage s) {
        switch (s) {
            case LoadStage::Idle:    return "idle";
            case LoadStage::Parsing: return "parsing";
            case LoadStage::Filling: return "filling";
            case LoadStage::Done:    return "done";
            case LoadStage::Error:   return "error";
        }
        return "idle";
    }

    EntityStore* store_ = nullptr;
    iobject::IRuntimeObject* self_ = nullptr;

    std::mutex loadMutex_;
    std::jthread worker_;
    std::atomic<bool> loading_{false};

    // 进度状态（worker 写 / 主线程读，atomic 即可）
    std::atomic<std::uint8_t> stage_{static_cast<std::uint8_t>(LoadStage::Idle)};
    std::atomic<int> percent_{0};

    // 结果元信息（worker 写 / 主线程读；const ReadData 里要 lock → mutable）
    mutable std::mutex metaMutex_;
    std::string mapName_;
    Tick maxTick_ = 0;
    std::uint64_t fileSize_ = 0;
    std::string error_;
};

} // namespace demoviewer
