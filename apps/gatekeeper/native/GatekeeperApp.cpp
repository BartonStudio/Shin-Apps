#include "GatekeeperApp.hpp"

#include "GateObject.hpp"
#include "GatekeeperRoot.hpp"

#include <RuntimeHost.hpp>

#include <iobject/Runtime.hpp>
#include <iobject/WebSocketServer.hpp>

#include <cstdint>
#include <memory>

namespace gatekeeper {
namespace {

/// 内置 WebSocket 服务端监听的端口。
/// 三处必须一致：apps/gatekeeper/app.json 的 connect.url、ui/src/main.js 里注入的
/// 连接提示（诊断文案会把端口与启动命令直接写给用户看）、以及这里。
/// 9002 已被 inspector 占用，所以本方案用 9003。
constexpr std::uint16_t kPort = 9003;

} // namespace

GatekeeperApp::GatekeeperApp() = default;

GatekeeperApp::~GatekeeperApp() {
    // 正常路径上 onStopping 已经调过 Stop()（幂等）；这里兜住"RunApp 抛异常"的路径。
    Stop();
}

shin::host::AppHooks GatekeeperApp::Hooks() {
    shin::host::AppHooks hooks;
    hooks.makeRoot = &GatekeeperApp::MakeRoot;
    hooks.onStarted = [this](const std::vector<std::string>&) { Start(); };
    hooks.onStopping = [this]() { Stop(); };
    // 没有 windowTitleSuffix：本方案没有模式开关，标题就是清单里的 title。
    return hooks;
}

iobject::IRuntimeObject* GatekeeperApp::MakeRoot() {
    return iobject::Runtime::make<GatekeeperRoot>();
}

void GatekeeperApp::Start() {
    // 对象树只有一个节点（§7）：root → Gate。门只是 Gate 通道里 JSON 的一个 key，
    // 所以这里不做"一门一节点"。
    gate_ = makeGateNode();
    shin::host::Root()->Connect("Gate", gate_);
    LOG_INFO("App", "已挂载 Gate 节点（方法 4 个 / 通道 5 个）");

    wsServer_ = std::make_unique<iobject::WebSocketServer>(iobject::WebSocketServer::Config{kPort});
    wsServer_->BindDomain(shin::host::Domain());  // 路由键 = 清单里的 connect.domain

    // WebSocketServer 的约定是「Start 失败不抛异常」（见其类注释"容错"），端口被占用时
    // 它会静默进入未运行状态。必须显式查一次 —— 否则前端只会看到一句没有信息量的连接失败。
    if (!wsServer_->IsRunning()) {
        LOG_ERROR("App", "WebSocket 服务端启动失败：端口 " + std::to_string(kPort)
            + " 可能已被占用。前端将连不上本进程，请腾出该端口后重启。");
    } else {
        LOG_INFO("App", "WebSocket 服务端已启动: " + std::to_string(kPort)
            + " (domain=" + shin::host::Domain().Name() + ")");
    }
}

void GatekeeperApp::Stop() {
    if (stopped_) return;
    stopped_ = true;

    // 顺序不能变：先停 WS 服务（关闭全部远程会话），再销毁业务对象 ——
    // 满足「会话先于业务对象销毁」的约束（RuntimeDomain 的析构要求）。
    wsServer_.reset();
    delete gate_;
    gate_ = nullptr;
}

} // namespace gatekeeper
