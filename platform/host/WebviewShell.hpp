#pragma once

#include <string>
#include <functional>
#include <memory>
#include <vector>
#include <filesystem>
#include <cstdint>

// 静态链接到本工程，导出宏退化为空
#define SHIN_UIWEBVIEW_API

// Disable C4251 for std::unique_ptr crossing DLL boundary
#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable: 4251)
#endif

namespace shin {
namespace host {

    class SHIN_UIWEBVIEW_API WebviewShell {
    public:
        static WebviewShell& GetInstance();

        WebviewShell(const WebviewShell&) = delete;
        WebviewShell& operator=(const WebviewShell&) = delete;

        void SetDebug(bool enable);
        // Enables remote debugging (CDP) on localhost:<port>. Must be called before Initialize().
        // port <= 0 disables remote debugging.
        void SetRemoteDebuggingPort(int port);

        // 追加一段额外的 Chromium 浏览器参数，必须在 Initialize() 之前调用，可累加。
        // 与 SetRemoteDebuggingPort 互不覆盖：后者只替换它自己那段。
        // 用途示例："--ignore-gpu-blocklist" —— 图形界面类的方案（WebGL / Three.js）
        // 被黑名单拦下时会悄悄退到软件路径，表现为前端直接停摆。
        void AppendBrowserArguments(const std::string& args);
        void SetParentWindow(void* hwnd);
        
        void SetStartupURL(const std::string& url);
        void SetStartupHTML(const std::string& html);

        void SetContextMenuEnabled(bool enable);

        void InjectJSBeforeLoad(const std::string& js);
        void BindFunction(const std::string& name, std::function<std::string(const std::string&)> fn);

        void SetTitle(const std::string& title);
        std::string GetTitle() const;   // 读当前窗口标题（业务设定值）

        void SetSize(int width, int height, bool fixed = false);
        int GetWidth() const;           // 读当前设计宽（逻辑像素，DPI 由宿主换算）
        int GetHeight() const;          // 读当前设计高（逻辑像素）

        // 用户拖动边框的最小 / 最大尺寸（逻辑像素，0 = 不限）。必须在 Initialize 之前调用。
        // fixed（不可 resize）时这些约束无效，见 WebviewHost::Create 的「fixed 优先」处理。
        void SetMinSize(int width, int height);
        void SetMaxSize(int width, int height);
        // 是否使用系统原生标题栏（false = 无边框自定义标题栏，默认）。必须在 Initialize 之前调用。
        void SetUseNativeTitlebar(bool use);

        // 「设计尺寸 -> 实际窗口」的换算结果，供调用方记日志 / 核对。
        struct WindowMetrics {
            int designWidth = 0;       // 逻辑像素（DIP），即"人眼看上去应该是多大"
            int designHeight = 0;
            int dpi = 96;              // 窗口所在显示器的缩放基准，96 = 100%
            int workAreaWidth = 0;     // 显示器工作区（物理像素，已扣掉任务栏）
            int workAreaHeight = 0;
            int windowWidth = 0;       // 实际外框（物理像素）
            int windowHeight = 0;
            int clientWidth = 0;       // 实际客户区（物理像素）
            int clientHeight = 0;
            bool shrunkToFit = false;  // 工作区放不下，已被等比收缩
        };

        // 按显示器 DPI 把设计尺寸（逻辑像素）换算成物理像素，再按工作区收敛并居中。
        // 必须在 Initialize() 成功之后、于当前 UI 线程调用；否则原样返回并记一条错误日志。
        //
        // 这是"1280x720 在任何缩放比例下都不溢出屏幕"的唯一落点：
        // 底层 webview 的 set_size 只做 DPI 换算 + 加非客户区边框，从不检查工作区
        // （见 third_party/webview/.../backends/win32_edge.hh 的 set_size_impl）。
        WindowMetrics ApplyDesignSize(int designWidth, int designHeight);

        struct BrowserExtensionResult {
            bool success = false;
            std::filesystem::path path;
            std::string name;
            std::int32_t hresult = 0;
            std::string error;
        };
        using BrowserExtensionCallback = std::function<void(const BrowserExtensionResult&)>;

        // Must be configured before Initialize because it changes WebView2 EnvironmentOptions.
        void SetBrowserExtensionsEnabled(bool enable);
        // Installs a local unpacked extension directory. The callback is invoked asynchronously.
        bool AddBrowserExtension(const std::filesystem::path& extensionPath,
                                 BrowserExtensionCallback callback = {});

        bool Initialize();

        void OpenDevTools();

        void* GetNativeWindow();
        void* GetNativeController();

        // ---- 导航控制（前进 / 后退 / 停止 / 刷新 / 缩放） --------------------
        // 这些方法都只对当前 WebView2 实例生效；非 UI 线程调用会自动投递到 UI 线程。
        void GoBack();
        void GoForward();
        void StopNavigation();
        void Reload();
        void SetZoomFactor(double factor);          // 直接设缩放系数（1.0 = 100%）
        double GetZoomFactor();                      // 读当前缩放系数（跨线程会同步等待）
        void ZoomIn(double step = 1.25);             // 放大一档（默认 ×1.25）
        void ZoomOut(double step = 0.8);             // 缩小一档（默认 ×0.8）
        void ZoomReset();                            // 重置为 100%

        // ---- 窗口外观 --------------------------------------------------------
        // 设置原生标题栏 / 任务栏图标（.ico 文件路径）。空路径 = 恢复系统默认图标。
        void SetWindowIcon(const std::string& icoPath);
        // 在光标处弹出原生系统菜单（等价于标题栏右键）。
        void ShowSystemMenu();

        // ---- 窗口行为 --------------------------------------------------------
        // 从最小化还原并置前（「最小化时唤出 UI」）。
        void RestoreWindow();
        // 置顶 / 取消置顶。
        void SetAlwaysOnTop(bool topmost);
        // 若最小化则恢复，并置前 + 置顶（TOPMOST）。用于「最小化时唤出到最顶层」。
        void BringToFront();
        // 前端确认退出：放行 WM_CLOSE，真正关闭窗口（标题栏 X / 任务栏关闭的二次确认通过后调用）。
        void ConfirmExit();

        // ---- 全局热键（运行时动态绑定 / 解绑） ----------------------------
        // 绑定「修饰键 + 单主键」全局热键，触发时在 UI 线程调用 handler。
        // modifiers = MOD_ALT / MOD_CONTROL / MOD_SHIFT / MOD_WIN 组合（bitmask）；
        // key = 主键虚拟键码（'J'、VK_F9 等）。返回热键 id（0 = 失败）。须在 UI 线程调用。
        int BindHotkey(uint32_t modifiers, uint32_t key, std::function<void()> handler);
        // 解绑「修饰键 + 单主键」全局热键。返回是否解绑成功。须在 UI 线程调用。
        bool UnbindHotkey(uint32_t modifiers, uint32_t key);
        // 热键触发分发（HostSubclassProc 的 WM_HOTKEY 调用，id 为 wParam）。
        void DispatchHotkey(int id);

        // ---- 系统集成 --------------------------------------------------------
        // 用系统默认方式打开 URL 或外部程序（等价于 shell `start`）。返回是否成功发起。
        bool OpenExternal(const std::string& target, const std::string& args = {});
        // 打开文件资源管理器：path 是目录则打开该目录，是文件则选中该文件。
        bool OpenFileExplorer(const std::string& path);
        // 弹原生「打开文件」对话框（仅 *.dem）。返回选中文件的绝对路径；用户取消返回空串。
        // 须在 UI 线程调用（STA + COM 已由 WebView2 初始化），否则行为未定义。
        std::string OpenFileDialog();
        // 配置页面下载的保存目录（空 = 系统默认「下载」目录）。影响 DownloadStarting 处理。
        void SetDownloadDirectory(const std::string& dir);
        // 触发一次文件下载（不离开当前页面）。savePath 为空则落到下载目录。
        void DownloadFile(const std::string& url, const std::string& savePath = {});
        // 读取当前下载目录（空 = 系统默认「下载」目录）。供 DownloadStarting 处理用。
        std::string DownloadDirectory() const;
        // 取出并清空单次下载的落盘路径覆盖（DownloadFile 设置的 savePath）。
        std::string TakePendingDownloadPath();

        // 弹原生「选择文件」对话框（通用，filterSpecs 为空 = 所有文件；非空形如 "*.dem;*.zip"），
        // 读取所选文件内容，经共享内存推给前端（sharedbufferreceived，additionalData.type="file"，
        // 并携带 name/size），再 SendJson 一条 fileUploaded 通知。返回文件绝对路径（取消返回空）。
        // 须在 UI 线程调用（STA + Common Item Dialog），与 OpenFileDialog 一致。
        std::string UploadFile(const std::string& filterSpecs = {});

        void RunBlocking();
        void Terminate();
        void PostToUiThread(std::function<void()> fn);  // 线程安全：投递到 UI 消息泵线程执行（总是异步排队）
        bool IsOnUiThread() const;                       // 当前线程是否是 UI 线程
        void Navigate(const std::string& url);
        void ExecuteJS(const std::string& js); 
        
        void SendJson(const std::string& json);

        // ---- 宿主事件（发布给 IObject，替代 SendJson 文本事件） --------------
        // WebviewShell 检测到的「一次性业务事件」，通过该回调交给 IObject 层（WebviewHost）
        // 发布成 IObject 事件供前端订阅，不再走 SendJson 的 postMessage 文本通道。
        // type = "WindowCloseRequested" | "fileSelected" | "fileUploaded"；
        // payload = JSON 文本载荷（无载荷事件为空串）。由 WebviewHost 在 BindRuntime 时注册。
        using HostEventSink = std::function<void(const std::string& type, const std::string& payload)>;
        void SetHostEventSink(HostEventSink sink);

        // In JS, listen via: window.chrome.webview.addEventListener('message', e => { if(typeof e.data === 'string') ... })
        void SendString(const std::string& str);
        
        // 二进制数据通道：单块共享内存（零拷贝）。
        // WebView2 的 sharedbufferreceived 只在第一次 PostSharedBufferToScript 时触发，
        // 因此这块内存只推一次；之后两个方向都往同一块内存读写，用文本消息（SharedMemoryUpdate / SharedMemoryPush）通知对方。
        bool EnsureWriteBuffer(size_t size);                           // 确保共享内存 >= size
        bool SendWriteBufferAddress(const std::string& meta = "{}");   // 把共享内存推给 JS（仅一次，SharedMemoryInit）
        void* WriteBufferData() const;                                 // C++ 读 JS 写进的数据
        size_t WriteBufferSize() const;                                // C++ 读当前共享内存大小
        bool PushSharedMemory(const void* data, size_t len);           // C++ 写数据到共享内存 + 文本通知 JS 读取（SharedMemoryPush）

        // 二进制帧收到回调：JS 写进写 buffer 后（SharedMemoryUpdate），C++ 读字节回调给上层。
        void SetBinaryReceivedCallback(std::function<void(const void*, size_t)> callback);
        void OnBinaryReceived(const void* data, size_t len);           // 转发给已注册的回调

        // ---- IObject WebView 桥接：二进制通道（上行 JS→C++，下行 C++→JS） ----
        // 上行：注册 window.chrome.webview.postMessage(json) 的接收回调。
        //   json 为 postMessage 的字符串参数（iobject-init 请求推 buffer / iobject 携带 offset/len，
        //   二进制在预分配的上行 buffer 里）。必须在 Initialize() 之后、UI 线程调用（需要 ICoreWebView2）。
        void SetWebMessageReceivedCallback(std::function<void(const std::string&, const void*, size_t)> callback);
        // 下行：每次 PostSharedBufferToScript 推一块共享 buffer 给 JS（sharedbufferreceived，
        //   additionalData.type="iobject"，iobject-js 据此取帧）。跨线程调用会同步等待。
        bool SendBinary(const void* data, size_t len);
        // 把上行（READ_WRITE）共享 buffer 推给 JS（响应前端 iobject-init）。下行已改为每次 PostSharedBufferToScript。
        bool SendIObjectBufferAddresses();
        // 读上行 buffer 基址（C++ 端据此读 JS 写入的数据）。
        const void* UplinkData() const;

    private:
        WebviewShell();
        ~WebviewShell();

        // 确保 IObject 桥接的两块共享 buffer 已预分配（各 4MB）。调用方保证在 UI 线程。
        bool EnsureIObjectBuffers();

        // 处理前端发来的 iobject 上行信令：
        //   {"type":"iobject-init"}                   → 推上行 READ_WRITE buffer 给 JS
        //   {"type":"iobject","offset":N,"len":M}     → 从上行 buffer 读 offset/len 字节喂给回调
        // 返回 true 表示已作为 iobject 信令处理；false 表示不是。
        bool HandleIObjectMessage(const std::string& json);

        // 推二进制帧到 JS（sharedbufferreceived），meta 为 additionalData JSON。上传文件 / 下行 iobject 帧等用途。
        bool SendBinaryWithMeta(const void* data, size_t len, const std::string& meta);

        struct Impl;
        std::unique_ptr<Impl> m_impl; 
    };

}
}

#ifdef _MSC_VER
#pragma warning(pop)
#endif
