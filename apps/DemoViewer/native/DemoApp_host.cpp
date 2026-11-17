// ============================================================================
// DemoApp_host.cpp —— DemoApp.cpp 的修正副本。
//
// 背景：原 DemoApp.cpp 被某个进程独占锁定（写工具全部静默失效），本文件是
//       其修正版（GetInstance 引用语法），CMakeLists 暂编译本文件。
//       文件锁释放后，可以把本文件内容拷回 DemoApp.cpp 并改回 CMakeLists。
// ============================================================================
#include "DemoApp.hpp"

#include "cs2/ContractFeed.hpp"
#include "cs2/CSRoot.hpp"
#include "cs2/DemoLoader.hpp"
#include "cs2/WorldState.hpp"

#include <RuntimeHost.hpp>
#include <WebviewBridge.hpp>
#include <WebviewHost.hpp>
#include <WebviewShell.hpp>

#include <iobject/Runtime.hpp>

#include <chrono>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

namespace demoviewer {
// native 注入脚本（Worker 替身 + chrome.webview 契约数据接收）。
// 由 web/tools/gen-cs2-inject.mjs 生成；改注入逻辑后重新生成。
static constexpr const char* kInjectScriptPath =
    "D:/workfolder/Shin-Apps/apps/DemoViewer/web/tools/cs2-native-inject.js";
}

namespace demoviewer {

DemoApp::DemoApp() = default;

DemoApp::~DemoApp() {
    Stop(); // 兜住异常路径；正常路径上 Run 末尾已 Stop()（幂等）
}

int DemoApp::Run(const std::string& demoPath) {
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
    //   简易壳（webapp vite）：`cd apps/DemoViewer/webapp && npm run dev`，填 http://127.0.0.1:5173/
    //   播放器镜像页（e2e 验证用）：`node apps/DemoViewer/web/serve.mjs`，填 http://127.0.0.1:8123/
    cfg.entry = "http://127.0.0.1:5173/";

    // 注入「native 数据通道」脚本：Worker 替身 + chrome.webview 契约数据接收。
    // 必须在 webview 创建之前注册（InjectJSBeforeLoad 只在未初始化时接受）。
    {
        std::ifstream in(kInjectScriptPath, std::ios::binary);
        if (in) {
            std::string js((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
            shin::host::WebviewShell::GetInstance().InjectJSBeforeLoad(js);
            LOG_INFO("DemoViewer", "native 注入脚本已注册（" + std::to_string(js.size()) + " bytes）");
        } else {
            LOG_INFO("DemoViewer", "找不到注入脚本，页面将以原版 JS 解析模式运行: " + std::string(kInjectScriptPath));
        }
    }

    webview_ = shin::host::WebviewHost::Create(cfg);
    if (!webview_) {
        return 1;
    }
    shin::host::Root()->Connect("Webview", webview_);
    LOG_INFO("DemoViewer", "Webview 能力节点已挂载到域根");

    // 装配业务子树：CSRoot 的 BindRuntime 已自动创建
    // Playback/World/Scoreboard/KillFeed/POV/Loader。
    //
    // demo 装载流程（IObject 驱动，前端发起）：
    //   1. 前端 Invoke Root/Loader "Load"（demo 路径）——后台线程解析 + 灌 store；
    //   2. 前端读 Loader "progress"，done 后 Invoke Root/World "InitializePlayers"；
    //   3. 之后 Playback "Play"/"Seek" 开始播放。
    // 装配前 store 为空，InitializePlayers 是空操作（PlayerIds 为空）。

    // 3. 建内进程 WebView 桥接（共享内存二进制通道），让前端经 iobject-js 访问对象树，
    //    不再起 WebSocket 服务端、不占端口。
    Start();

    // 3b. 命令行给了 demo 路径：后台装载 → 契约数据块推给前端（零交互播放路径）
    if (!demoPath.empty()) {
        StartContractFeed(demoPath);
    }

    // 4. 跑宿主循环（阻塞直到窗口关闭）。
    shin::host::WebviewHost::Run();

    Stop();
    return 0;
}

void DemoApp::StartContractFeed(const std::string& demoPath) {
    std::thread([demoPath]() {
        EntityStore store;
        DemoMeta meta;
        std::string error;
        const auto t0 = std::chrono::steady_clock::now();
        if (!DemoLoader::Load(demoPath, store, meta, {}, error)) {
            LOG_ERROR("DemoViewer", "demo 装载失败: " + error);
            return;
        }
        LOG_INFO("DemoViewer", "demo 装载完成: " + meta.mapName + "，开始生成契约数据块…");

        std::vector<std::uint8_t> buffer(ContractFeed::RequiredBytes(store), 0);
        const auto res = ContractFeed::WriteAll(store, buffer.data(), buffer.size(), 0);
        if (res.messageJson.empty()) {
            LOG_ERROR("DemoViewer", "契约数据块生成失败（bytesUsed=0）");
            return;
        }
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - t0).count();
        LOG_INFO("DemoViewer", "契约块 " + std::to_string(res.bytesUsed / 1048576) + "MB，耗时 " +
                 std::to_string(ms) + "ms，推送前端…");

        // 水位消息：csdf-ready = 契约块已就绪 + 回合可见范围（前端据此触发播放流程）
        std::string msg = res.messageJson;
        msg.pop_back();  // 去掉 '}'
        msg += ",\"type\":\"csdf-ready\"}";

        auto& shell = shin::host::WebviewShell::GetInstance();
        shell.PostToUiThread([&shell, buffer = std::move(buffer), msg = std::move(msg)]() {
            // 顺序不能反：先推数据块（sharedbufferreceived），再发水位消息（happens-before，docs/08 §3.5）
            if (!shell.SendBinaryWithType(buffer.data(), buffer.size(), "csdf")) {
                LOG_ERROR("DemoViewer", "契约数据块推送失败");
                return;
            }
            shell.SendJson(msg);
            LOG_INFO("DemoViewer", "契约数据块已推送，等待前端建播放器");
        });
    }).detach();
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
