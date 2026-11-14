#pragma once

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include <string>

namespace shin::host {

/// WebView2 宿主能力节点：把窗口 / 导航 / 缩放 / 下载 / 系统集成等能力，
/// 以 IObject 对象的形式挂到运行时域树上。
///
/// 前端（iobject-js）经 WS 连上域后，用 `domain.Webview.Invoke("Navigate", {...})`
/// 这类调用访问 —— 不再走 window.Shin P1 桥，也不再依赖 app.json 清单。
///
/// 本类是**无状态门面**：所有能力转发给进程内唯一的 WebviewShell 实例。
/// 窗口必须在 UI 线程、iobject::Run() 之前通过 Create() 创建（WebView2 的消息泵
/// 本身就是宿主循环）。
class WebviewHost {
public:
    struct Config {
        std::string title = "Shin App";          // 窗口标题（任务栏悬浮名）
        int width = 1280;                         // 设计宽（逻辑像素，DPI 由宿主换算）
        int height = 720;
        bool resizable = true;                    // false = 固定尺寸（用户不可拖动改变）
        int minWidth = 0;                         // 用户拖动最小宽（逻辑像素，0 = 不限）
        int minHeight = 0;                        // 用户拖动最小高（逻辑像素，0 = 不限）
        int maxWidth = 0;                         // 用户拖动最大宽（逻辑像素，0 = 不限）
        int maxHeight = 0;                        // 用户拖动最大高（逻辑像素，0 = 不限）
        bool useNativeTitlebar = false;           // true = 系统原生标题栏；false = 无边框自定义标题栏
        std::string entry;                        // 入口 URL（http://... 或 file:///...）
        std::string startupHtml;                  // 内嵌 HTML（非空时优先于 entry，便于无前端 MVP）
        std::string icon;                         // 可选 .ico 路径（空 = 系统默认图标）
        bool debug = false;                       // WebView2 debug 模式
        bool ignoreGpuBlocklist = false;          // 图形类方案：--ignore-gpu-blocklist
        int remoteDebuggingPort = 0;              // CDP 端口，0 = 关闭
    };

    /// 创建窗口并返回承载本对象的 IObject 节点（所有权交给调用方，通常 Connect 到域根）。
    /// 失败返回 nullptr。必须在 UI 线程、iobject::Run() 之前调用。
    static iobject::IRuntimeObject* Create(const Config& cfg);

    /// 阻塞运行宿主循环直到窗口关闭。内部把 IObject 事件循环挂到 WebView2 消息泵上。
    static void Run();

    // ---- IObject 鸭子类型钩子 ----
    // Invoke 操作 WebView2 COM 对象，必须在循环线程（= UI 线程）执行，故非线程安全。
    static constexpr bool kThreadSafe = false;

    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result);
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const;
    bool WriteData(iobject::DataChannelView channel, iobject::ByteInput data);
    static void RegisterTypes(iobject::TypeBuilder<WebviewHost>& types);

    // ---- 宿主事件（发布到 IObject，供前端订阅） ----------------------------
    // BindRuntime 钩子：节点构造后回调 self，节点析构回调 nullptr。保存 self 用于发布事件，
    // 并把 EmitHostEvent 注册为 WebviewShell 的 hostEventSink（替代 SendJson 文本事件）。
    void BindRuntime(iobject::IRuntimeObject* self);
    // 发布一次性宿主事件：type + payload（UTF-8 JSON 文本，经 EventPayloadData 直接带字节）。
    // 由 WebviewShell 的 hostEventSink 回调触发。
    void EmitHostEvent(const std::string& type, const std::string& payload);

private:
    iobject::IRuntimeObject* self_ = nullptr;
};

} // namespace shin::host
