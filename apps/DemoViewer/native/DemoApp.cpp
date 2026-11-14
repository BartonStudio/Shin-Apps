#include "DemoApp.hpp"

#include "cs2/CSRoot.hpp"
#include "cs2/WorldState.hpp"

#include <RuntimeHost.hpp>
#include <WebviewBridge.hpp>
#include <WebviewHost.hpp>

#include <iobject/Runtime.hpp>

#include <string>

namespace demoviewer {

DemoApp::DemoApp() = default;

DemoApp::~DemoApp() {
    Stop(); // 兜住异常路径；正常路径上 Run 末尾已 Stop()（幂等）
}

int DemoApp::Run() {
    // 1. 配域：域名 = 前端 iobject-js Connect 时的路由键。
    shin::host::ConfigureDomain(shin::host::DomainSpec{
        "demoviewer",
        &DemoApp::MakeRoot,
    });

    // 2. 建窗口 + Webview 能力节点（纯代码配置，无 app.json）。
    shin::host::WebviewHost::Config cfg;
    cfg.title = "Demo Viewer";
    cfg.width = 1280;
    cfg.height = 720;
    cfg.resizable = false;         // 固定尺寸：不可拖拽 resize，但保留最大化（全屏）
    cfg.minWidth = 0;              // fixed 优先：min/max 无效，全部置 0
    cfg.minHeight = 0;
    cfg.maxWidth = 0;
    cfg.maxHeight = 0;
    cfg.useNativeTitlebar = false; // 无边框 + 前端自定义标题栏（默认，显式写出）
    cfg.debug = true;
    cfg.remoteDebuggingPort = 9222; // CDP 端口，0 = 关闭

    // 前端入口：写死在这里，切换调试/生产时手动改这一行。
    //   调试（本地）：先 `cd apps/DemoViewer/webapp && npm run dev`，再填 http://127.0.0.1:5173/
    //   生产：`npm run build` 后填 webapp/dist/index.html 的 file:// 绝对路径
    cfg.entry = "http://127.0.0.1:5173/";

    webview_ = shin::host::WebviewHost::Create(cfg);
    if (!webview_) {
        return 1;
    }
    shin::host::Root()->Connect("Webview", webview_);
    LOG_INFO("DemoViewer", "Webview 能力节点已挂载到域根");

    // 装配业务子树：CSRoot 的 BindRuntime 已自动创建 Playback/World/Scoreboard/KillFeed/POV。
    // TODO: demo 解析器接入后，先把解析结果灌进 csRoot->store()，再初始化玩家节点。
    if (auto* csRoot = shin::host::Root()->As<CSRoot>()) {
        csRoot->world()->As<WorldState>()->InitializePlayers();
    }

    // 3. 建内进程 WebView 桥接（共享内存二进制通道），让前端经 iobject-js 访问对象树，
    //    不再起 WebSocket 服务端、不占端口。
    Start();

    // 4. 跑宿主循环（阻塞直到窗口关闭）。
    shin::host::WebviewHost::Run();

    Stop();
    return 0;
}

void DemoApp::Start() {
    webviewBridge_ = std::make_unique<shin::host::WebviewBridge>();
    LOG_INFO("DemoViewer", "WebView 桥接已建立（内进程共享内存通道，无端口，domain="
        + shin::host::Domain().Name() + ")");
}

void DemoApp::Stop() {
    if (stopped_) return;
    stopped_ = true;

    // 顺序不能变：先关桥接（关闭会话），再销毁业务节点 ——
    // 满足「会话先于业务对象销毁」的约束（RuntimeDomain 析构要求）。
    webviewBridge_.reset();
    delete webview_;   // IRuntimeObject 析构会自动解除拓扑
    webview_ = nullptr;
}

iobject::IRuntimeObject* DemoApp::MakeRoot() {
    return iobject::Runtime::make<CSRoot>();
}

} // namespace demoviewer
