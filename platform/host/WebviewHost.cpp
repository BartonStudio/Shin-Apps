#include "WebviewHost.hpp"

#include "RuntimeHost.hpp"   // LOG_*
#include "WebviewShell.hpp"

#include <iobject/Executor.hpp>

#include <nlohmann/json.hpp>

#include <windows.h>

#include <cstdint>
#include <cstdlib>
#include <functional>
#include <string>

namespace shin::host {
namespace {

void Reply(const iobject::DataReceiver& result, const nlohmann::json& res) {
    if (!result) return;
    const std::string s = res.dump();
    result(iobject::ByteView(reinterpret_cast<const std::uint8_t*>(s.data()), s.size()));
}

nlohmann::json ParseArgs(iobject::ByteInput args) {
    if (args.empty()) return nlohmann::json::object();
    try {
        return nlohmann::json::parse(args.begin(), args.end());
    } catch (...) {
        return nlohmann::json::object();
    }
}

HWND HostWindow() {
    return static_cast<HWND>(WebviewShell::GetInstance().GetNativeWindow());
}

// 通道数据编码：json → MessagePack 字节交给 receiver（字节仅在 receiver 调用期间有效）。
void ReplyChannel(const iobject::DataReceiver& receiver, const nlohmann::json& value) {
    if (!receiver) return;
    const auto bytes = nlohmann::json::to_msgpack(value);
    receiver(iobject::ByteView(bytes.data(), bytes.size()));
}

// 通道数据解码：MessagePack 字节 → json；失败返回 null（discarded）。
nlohmann::json ParseChannel(iobject::ByteInput data) {
    if (data.empty()) return nlohmann::json();
    try {
        return nlohmann::json::from_msgpack(data.begin(), data.end());
    } catch (...) {
        return nlohmann::json();
    }
}

// 解析修饰键字符串："Ctrl+Alt+Shift+Win" 的任意子集，大小写不敏感。
uint32_t ParseHotkeyModifiers(const std::string& in) {
    std::string s;
    s.reserve(in.size());
    for (char c : in) s.push_back((c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c);
    uint32_t mods = 0;
    if (s.find("ctrl") != std::string::npos || s.find("control") != std::string::npos) mods |= MOD_CONTROL;
    if (s.find("alt") != std::string::npos) mods |= MOD_ALT;
    if (s.find("shift") != std::string::npos) mods |= MOD_SHIFT;
    if (s.find("win") != std::string::npos || s.find("meta") != std::string::npos) mods |= MOD_WIN;
    return mods;
}

// 解析主键：单字符（字母/数字/符号）→ 虚拟键码；"F1"~"F24" → VK_F1..；常用键名 → 对应 VK。
uint32_t ParseHotkeyKey(const std::string& s) {
    if (s.empty()) return 0;
    if (s.size() == 1) {
        const char c = s[0];
        if (c >= 'a' && c <= 'z') return static_cast<uint32_t>(c - 'a' + 'A');  // 字母 → 大写虚拟键
        return static_cast<uint32_t>(static_cast<unsigned char>(c));
    }
    if ((s[0] == 'F' || s[0] == 'f') && s.size() <= 3) {
        const int n = std::atoi(s.c_str() + 1);
        if (n >= 1 && n <= 24) return static_cast<uint32_t>(VK_F1 + (n - 1));
    }
    if (s == "Space") return VK_SPACE;
    if (s == "Enter" || s == "Return") return VK_RETURN;
    if (s == "Esc" || s == "Escape") return VK_ESCAPE;
    if (s == "Tab") return VK_TAB;
    if (s == "Home") return VK_HOME;
    if (s == "End") return VK_END;
    if (s == "Up") return VK_UP;
    if (s == "Down") return VK_DOWN;
    if (s == "Left") return VK_LEFT;
    if (s == "Right") return VK_RIGHT;
    return 0;
}

// 执行一个「无参数动作」（热键触发用）。返回 true 表示识别该动作。
bool RunAction(WebviewShell& shell, const std::string& action) {
    if (action == "Reload")         { shell.Reload(); return true; }
    if (action == "GoBack")         { shell.GoBack(); return true; }
    if (action == "GoForward")      { shell.GoForward(); return true; }
    if (action == "Stop")           { shell.StopNavigation(); return true; }
    if (action == "ZoomIn")         { shell.ZoomIn(1.25); return true; }
    if (action == "ZoomOut")        { shell.ZoomOut(0.8); return true; }
    if (action == "ZoomReset")      { shell.ZoomReset(); return true; }
    if (action == "Minimize")       { if (HWND h = HostWindow()) PostMessageW(h, WM_SYSCOMMAND, SC_MINIMIZE, 0); return true; }
    if (action == "ToggleMaximize") { if (HWND h = HostWindow()) PostMessageW(h, WM_SYSCOMMAND, IsZoomed(h) ? SC_RESTORE : SC_MAXIMIZE, 0); return true; }
    if (action == "Restore")        { shell.RestoreWindow(); return true; }
    if (action == "BringToFront")   { shell.BringToFront(); return true; }
    if (action == "Close")          { if (HWND h = HostWindow()) PostMessageW(h, WM_SYSCOMMAND, SC_CLOSE, 0); return true; }
    if (action == "OpenDevTools")   { shell.OpenDevTools(); return true; }
    return false;
}

// 把 action 名包装成热键 handler（无参数动作）。
std::function<void()> MakeActionHandler(WebviewShell& shell, const std::string& action) {
    return [&shell, action]() { RunAction(shell, action); };
}

} // namespace

iobject::IRuntimeObject* WebviewHost::Create(const Config& cfg) {
    auto& shell = WebviewShell::GetInstance();

    // 这些必须在 Initialize 之前设置。
    if (cfg.debug) shell.SetDebug(true);
    if (cfg.ignoreGpuBlocklist) shell.AppendBrowserArguments("--ignore-gpu-blocklist");
    if (cfg.remoteDebuggingPort > 0) shell.SetRemoteDebuggingPort(cfg.remoteDebuggingPort);

    shell.SetTitle(cfg.title);
    shell.SetSize(cfg.width, cfg.height, !cfg.resizable);
    // fixed（不可 resize）优先：拖动被禁时 min/max 无意义，跳过。
    if (cfg.resizable) {
        shell.SetMinSize(cfg.minWidth, cfg.minHeight);
        shell.SetMaxSize(cfg.maxWidth, cfg.maxHeight);
    }
    shell.SetUseNativeTitlebar(cfg.useNativeTitlebar);
    if (!cfg.startupHtml.empty()) {
        shell.SetStartupHTML(cfg.startupHtml);
    } else {
        shell.SetStartupURL(cfg.entry);
    }

    if (!shell.Initialize()) {
        LOG_ERROR("WebviewHost", "WebviewShell::Initialize() 失败");
        return nullptr;
    }

    // 图标需要窗口 HWND 就绪，故在 Initialize 之后。
    if (!cfg.icon.empty()) shell.SetWindowIcon(cfg.icon);

    return iobject::Runtime::make<WebviewHost>();
}

void WebviewHost::Run() {
    auto& webview = WebviewShell::GetInstance();
    // 单线程：把 IObject 事件循环挂到 WebView2 的 UI 消息泵上。
    iobject::UseExecutor(std::make_unique<iobject::HostLoopExecutor>(
        /* onRun */          [&webview]() { webview.RunBlocking(); },
        /* onPost */         [&webview](std::function<void()> task) { webview.PostToUiThread(std::move(task)); },
        /* onStop */         [&webview]() { webview.Terminate(); },
        /* isOnLoopThread */ [&webview]() { return webview.IsOnUiThread(); }));
    iobject::Run();
}

bool WebviewHost::Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
    auto& shell = WebviewShell::GetInstance();
    const nlohmann::json req = ParseArgs(args);
    nlohmann::json res = nlohmann::json::object();
    const std::string m(method);

    // ---- 导航 ----
    if (m == "Navigate")    { shell.Navigate(req.value("url", "")); Reply(result, res); return true; }
    if (m == "Reload")      { shell.Reload(); Reply(result, res); return true; }
    if (m == "GoBack")      { shell.GoBack(); Reply(result, res); return true; }
    if (m == "GoForward")   { shell.GoForward(); Reply(result, res); return true; }
    if (m == "Stop")        { shell.StopNavigation(); Reply(result, res); return true; }

    // ---- 缩放 ----
    if (m == "ZoomIn")      { shell.ZoomIn(req.value("step", 1.25)); Reply(result, res); return true; }
    if (m == "ZoomOut")     { shell.ZoomOut(req.value("step", 0.8)); Reply(result, res); return true; }
    if (m == "ZoomReset")   { shell.ZoomReset(); Reply(result, res); return true; }


    // ---- 窗口控制 ----
    if (m == "Minimize") {
        if (HWND h = HostWindow()) PostMessageW(h, WM_SYSCOMMAND, SC_MINIMIZE, 0);
        Reply(result, res); return true;
    }
    if (m == "ToggleMaximize") {
        if (HWND h = HostWindow()) PostMessageW(h, WM_SYSCOMMAND, IsZoomed(h) ? SC_RESTORE : SC_MAXIMIZE, 0);
        Reply(result, res); return true;
    }
    if (m == "Restore")          { shell.RestoreWindow(); Reply(result, res); return true; }
    if (m == "BringToFront")     { shell.BringToFront(); Reply(result, res); return true; }
    if (m == "Close") {
        if (HWND h = HostWindow()) PostMessageW(h, WM_SYSCOMMAND, SC_CLOSE, 0);
        Reply(result, res); return true;
    }
    if (m == "BeginDrag") {
        // 触发系统级窗口拖动：等价于按住原生标题栏拖动。SendMessage 进入同步模态循环，
        // 会阻塞到鼠标释放，因此前端须 fire-and-forget（不等待响应）。
        if (HWND h = HostWindow()) {
            ReleaseCapture();
            SendMessageW(h, WM_NCLBUTTONDOWN, HTCAPTION, 0);
        }
        Reply(result, res); return true;
    }
    if (m == "ConfirmExit")      { shell.ConfirmExit(); Reply(result, res); return true; }
    if (m == "SetAlwaysOnTop")   { shell.SetAlwaysOnTop(req.value("topmost", false)); Reply(result, res); return true; }
    if (m == "ShowSystemMenu")   { shell.ShowSystemMenu(); Reply(result, res); return true; }
    if (m == "SetIcon")          { shell.SetWindowIcon(req.value("path", "")); Reply(result, res); return true; }

    // ---- 系统集成 ----
    if (m == "OpenExternal") {
        res["ok"] = shell.OpenExternal(req.value("target", ""), req.value("args", ""));
        Reply(result, res); return true;
    }
    if (m == "OpenFileExplorer") {
        res["ok"] = shell.OpenFileExplorer(req.value("path", ""));
        Reply(result, res); return true;
    }
    if (m == "OpenFileDialog") {
        const std::string path = shell.OpenFileDialog();
        res["path"] = path;
        res["canceled"] = path.empty();
        Reply(result, res); return true;
    }
    if (m == "OpenDevTools")            { shell.OpenDevTools(); Reply(result, res); return true; }

    // ---- 全局热键（运行时动态绑定 / 解绑） ----
    if (m == "BindHotkey") {
        const std::string action = req.value("action", "");
        const uint32_t mods = ParseHotkeyModifiers(req.value("modifiers", ""));
        uint32_t key = 0;
        if (req["key"].is_number()) {
            key = req["key"].get<uint32_t>();
        } else if (req["key"].is_string()) {
            key = ParseHotkeyKey(req["key"].get<std::string>());
        }
        const int id = shell.BindHotkey(mods, key, MakeActionHandler(shell, action));
        res["ok"] = id != 0;
        res["id"] = id;
        Reply(result, res); return true;
    }
    if (m == "UnbindHotkey") {
        const uint32_t mods = ParseHotkeyModifiers(req.value("modifiers", ""));
        uint32_t key = 0;
        if (req["key"].is_number()) {
            key = req["key"].get<uint32_t>();
        } else if (req["key"].is_string()) {
            key = ParseHotkeyKey(req["key"].get<std::string>());
        }
        res["ok"] = shell.UnbindHotkey(mods, key);
        Reply(result, res); return true;
    }
    if (m == "SetDownloadDirectory")    { shell.SetDownloadDirectory(req.value("dir", "")); Reply(result, res); return true; }
    if (m == "Download") {
        shell.DownloadFile(req.value("url", ""), req.value("savePath", ""));
        Reply(result, res); return true;
    }
    if (m == "Upload") {
        res["path"] = shell.UploadFile(req.value("filter", ""));
        Reply(result, res); return true;
    }

    return false; // 未知方法
}

bool WebviewHost::ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
    auto& shell = WebviewShell::GetInstance();
    if (channel == "title") {
        ReplyChannel(receiver, shell.GetTitle());
        return true;
    }
    if (channel == "size") {
        ReplyChannel(receiver, nlohmann::json{{"width", shell.GetWidth()}, {"height", shell.GetHeight()}});
        return true;
    }
    if (channel == "zoom") {
        ReplyChannel(receiver, shell.GetZoomFactor());
        return true;
    }
    return false; // 未知通道
}

bool WebviewHost::WriteData(iobject::DataChannelView channel, iobject::ByteInput data) {
    auto& shell = WebviewShell::GetInstance();
    if (channel == "title") {
        const auto j = ParseChannel(data);
        if (!j.is_string()) return false;
        shell.SetTitle(j.get<std::string>());
        return true;
    }
    if (channel == "size") {
        const auto j = ParseChannel(data);
        if (!j.is_object()) return false;
        const int w = j.value("width", 0);
        const int h = j.value("height", 0);
        if (w <= 0 || h <= 0) return false;
        shell.ApplyDesignSize(w, h);  // 无边框：走 DPI 换算 + 外框纠正，避免灰隙
        return true;
    }
    if (channel == "zoom") {
        const auto j = ParseChannel(data);
        if (!j.is_number()) return false;
        shell.SetZoomFactor(j.get<double>());
        return true;
    }
    return false; // 未知通道
}

void WebviewHost::BindRuntime(iobject::IRuntimeObject* self) {
    self_ = self;
    if (self_) {
        // 把本节点的 EmitHostEvent 注册为 WebviewShell 的宿主事件出口：
        // WebviewShell 检测到的一次性业务事件 → 这里发布成 IObject 事件。
        WebviewShell::GetInstance().SetHostEventSink(
            [this](const std::string& type, const std::string& payload) {
                EmitHostEvent(type, payload);
            });
    } else {
        WebviewShell::GetInstance().SetHostEventSink(WebviewShell::HostEventSink{});
    }
}

void WebviewHost::EmitHostEvent(const std::string& type, const std::string& payload) {
    if (!self_) return;
    if (type == "WindowCloseRequested") {
        // 无载荷事件：纯自定义事件类型。
        self_->Publish("WindowCloseRequested");
    } else if (type == "fileSelected" || type == "fileUploaded") {
        // 一次性事件参数：payload 是 UTF-8 JSON 文本，经 EventPayloadData 直接带字节载荷。
        std::vector<std::uint8_t> bytes(payload.begin(), payload.end());
        self_->Publish(type,
                       iobject::Runtime::make<iobject::EventPayloadData>(std::move(bytes)),
                       /*destroyDataAfterPublish=*/true);
    }
}

void WebviewHost::RegisterTypes(iobject::TypeBuilder<WebviewHost>&) {
    // 默认已登记 As<WebviewHost>()，暂无需额外转换。
}

} // namespace shin::host
