#include "WebviewShell.hpp"

#include "RuntimeHost.hpp"  // LOG_INFO / LOG_ERROR 等日志宏

#include <nlohmann/json.hpp>

#include <webview.h>
#include <thread>
#include <mutex>
#include <atomic>
#include <vector>
#include <algorithm>
#include <filesystem>
#include <future>
#include <optional>
#include <cstring>
#include <fstream>
#include <unordered_map>

#include <unordered_map>

#ifdef _WIN32
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>   // IFileOpenDialog / IFileDialog
#include <WebView2.h>
#include <wrl.h>
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "shell32.lib")
#endif

#ifdef _WIN32
namespace {
    // 转发声明
    LRESULT CALLBACK HostSubclassProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam, UINT_PTR uIdSubclass, DWORD_PTR dwRefData);
    LRESULT CALLBACK ChildSubclassProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam, UINT_PTR uIdSubclass, DWORD_PTR dwRefData);
    BOOL CALLBACK EnumChildProc(HWND hWnd, LPARAM lParam);

    // 「标题栏 X / 任务栏关闭」时的通知回调。由 WebviewShell::Initialize 注入，
    // 宿主收到 WM_CLOSE 时先通知 JS 弹「退出二次确认」；只有 JS 确认退出
    // （confirm-exit）置 g_closeConfirmed 并再次投递 WM_CLOSE，才真正关闭窗口。
    std::function<void()> g_onWindowCloseRequested;
    // JS 端已确认退出：置 true 后 WM_CLOSE 才放行走默认关闭流程。
    bool g_closeConfirmed = false;

    // 用户拖动边框的最小 / 最大跟踪尺寸（逻辑像素，0 = 不限）。由 SetMinSize/SetMaxSize
    // 维护，HostSubclassProc 的 WM_GETMINMAXINFO 按 DPI 换算后写入 ptMinTrackSize/ptMaxTrackSize。
    int g_minTrackW = 0, g_minTrackH = 0;
    int g_maxTrackW = 0, g_maxTrackH = 0;

    // ---- DPI / 工作区工具 ----------------------------------------------------
    //
    // GetDpiForWindow 与 AdjustWindowRectExForDpi 都是 Win10 1607 才有的导出。
    // WebView2 运行时的门槛（Win10 1809）已经高于它们，但仍走 GetProcAddress：
    // 这样即便对上老 SDK 也能编过，且运行时永远留有一条回退路径。

    using GetDpiForWindowFn = UINT(WINAPI*)(HWND);
    using AdjustWindowRectExForDpiFn = BOOL(WINAPI*)(LPRECT, DWORD, BOOL, DWORD, UINT);

    int DpiOfWindow(HWND hwnd) {
        static auto getDpi = reinterpret_cast<GetDpiForWindowFn>(
            GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow"));
        if (getDpi) {
            const UINT dpi = getDpi(hwnd);
            if (dpi > 0) return static_cast<int>(dpi);
        }
        HDC dc = GetDC(hwnd);
        const int dpi = dc ? GetDeviceCaps(dc, LOGPIXELSY) : 0;
        if (dc) ReleaseDC(hwnd, dc);
        return dpi > 0 ? dpi : 96;
    }

    /// 把客户区尺寸加上非客户区（标题栏 / 边框），得到 SetWindowPos 需要的外框尺寸。
    void SizeWithFrame(HWND hwnd, int& width, int& height, UINT dpi) {
        static auto adjustForDpi = reinterpret_cast<AdjustWindowRectExForDpiFn>(
            GetProcAddress(GetModuleHandleW(L"user32.dll"), "AdjustWindowRectExForDpi"));
        const DWORD style = static_cast<DWORD>(GetWindowLongPtrW(hwnd, GWL_STYLE));
        const DWORD exStyle = static_cast<DWORD>(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
        RECT r{0, 0, width, height};
        if (adjustForDpi) {
            adjustForDpi(&r, style, FALSE, exStyle, dpi);
        } else {
            AdjustWindowRectEx(&r, style, FALSE, exStyle);
        }
        width = r.right - r.left;
        height = r.bottom - r.top;
    }

    RECT WorkAreaOf(HWND hwnd) {
        MONITORINFO mi{};
        mi.cbSize = sizeof(mi);
        HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if (monitor && GetMonitorInfoW(monitor, &mi)) return mi.rcWork;
        // 拿不到显示器信息就退回主屏工作区：宁可多缩一点，也不要溢出。
        RECT work{};
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
        return work;
    }

    /// 把窗口收进工作区：放不下就等比收缩；center=true 时居中，否则只在越界时推回来。
    void FitWindowIntoWorkArea(HWND hwnd, bool center) {
        if (!hwnd || IsIconic(hwnd) || IsZoomed(hwnd)) return;  // 最小化 / 最大化交给系统

        RECT wr{};
        if (!GetWindowRect(hwnd, &wr)) return;
        const RECT work = WorkAreaOf(hwnd);
        const int workW = work.right - work.left;
        const int workH = work.bottom - work.top;
        if (workW <= 0 || workH <= 0) return;

        const int curW = wr.right - wr.left;
        const int curH = wr.bottom - wr.top;
        if (curW <= 0 || curH <= 0) return;

        int w = curW;
        int h = curH;
        // 逐项比较取最小。不要写成 std::min({a, b, c}) ——
        // windows.h 的 min/max 是**函数式宏**，会把花括号参数表当成"宏传了 3 个参数"直接报错；
        // 带括号的 (std::min)(a, b) 才安全，因为 min 后面紧跟的是 ')' 而不是 '('。
        double fit = static_cast<double>(workW) / curW;
        const double fitH = static_cast<double>(workH) / curH;
        if (fitH < fit) fit = fitH;
        if (fit > 1.0) fit = 1.0;
        if (fit < 1.0) {
            w = (std::max)(360, static_cast<int>(curW * fit));
            h = (std::max)(260, static_cast<int>(curH * fit));
            center = true;
        }

        int x = wr.left;
        int y = wr.top;
        if (center) {
            x = work.left + (workW - w) / 2;
            y = work.top + (workH - h) / 2;
        } else {
            // 只用 int 参与比较：work.left / work.right 是 LONG，与 int 混用会让
            // std::min/std::max 的模板推导直接失败（_Ty 到底是 LONG 还是 int？）。
            const int minX = work.left;
            const int minY = work.top;
            const int maxX = work.right - w;
            const int maxY = work.bottom - h;
            if (x < minX) x = minX;
            if (y < minY) y = minY;
            if (x > maxX) x = maxX;
            if (y > maxY) y = maxY;
        }
        if (x == wr.left && y == wr.top && w == curW && h == curH) return;
        SetWindowPos(hwnd, nullptr, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
    }

    LRESULT CALLBACK HostSubclassProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam, UINT_PTR uIdSubclass, DWORD_PTR dwRefData) {
        switch (uMsg) {
        case WM_NCCALCSIZE: {
            if (wParam) {
                // 无边框模式：客户区覆盖整个窗口，任何状态下都不缩进。
                // 注意最大化也不能缩进：WM_GETMINMAXINFO 已把最大化矩形钳制成
                // 恰好等于工作区（不超出屏幕），不存在默认行为下「窗口矩形越过
                // 显示器边缘」的溢出，再缩进客户区反而会让四周留出一圈非客户区，
                // 被 DWM 涂成浅色原生边框（最大化后窗口内缘出现一圈亮边）。
                DWORD style = GetWindowLongPtr(hWnd, GWL_STYLE);
                if (!(style & WS_CAPTION)) {
                    return 0;
                }
            }
            break;
        }
        case WM_NCHITTEST: {
            // 先尝试系统的默认逻辑（这会处理滚动条等）
            LRESULT hit = DefSubclassProc(hWnd, uMsg, wParam, lParam);
            
            DWORD style = GetWindowLongPtr(hWnd, GWL_STYLE);
            // 只有无边框且非最大化时，才执行自定义边缘探测
            if (!(style & WS_CAPTION) && (style & WS_THICKFRAME) && !IsZoomed(hWnd)) {
                POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
                RECT rc;
                GetWindowRect(hWnd, &rc);
                
                const int span = 10; // 足够大的探测范围

                bool left = (pt.x < rc.left + span);
                bool right = (pt.x >= rc.right - span);
                bool top = (pt.y < rc.top + span);
                bool bottom = (pt.y >= rc.bottom - span);

                if (top && left) return HTTOPLEFT;
                if (top && right) return HTTOPRIGHT;
                if (bottom && left) return HTBOTTOMLEFT;
                if (bottom && right) return HTBOTTOMRIGHT;
                if (top) return HTTOP;
                if (bottom) return HTBOTTOM;
                if (left) return HTLEFT;
                if (right) return HTRIGHT;
            }
            return hit;
        }
        case 0x02E0 /*WM_DPICHANGED*/: {
            // 先把消息交给底层 webview：它会按新 DPI 重算客户区尺寸（只做换算，且带 SWP_NOMOVE，
            // 于是窗口围着左上角长）。放到 100% 屏幕上创建、再拖到 150% 屏幕上时，
            // 窗口会长到屏幕外面去 —— 这里补上工作区兜底，把窗口收回来。
            LRESULT handled = DefSubclassProc(hWnd, uMsg, wParam, lParam);
            FitWindowIntoWorkArea(hWnd, /* center */ false);
            return handled;
        }
        case WM_CLOSE: {
            // 标题栏 X / 任务栏「关闭窗口」都会走到这里。
            // 默认先拦截：只通知 JS 弹「退出二次确认」，不关闭窗口；
            // JS 确认后（confirm-exit）置 g_closeConfirmed 并再次投递 WM_CLOSE，
            // 此时才 break 走默认 DefSubclassProc 真正关闭。
            if (!g_closeConfirmed) {
                if (g_onWindowCloseRequested) g_onWindowCloseRequested();
                return 0;  // 拦截关闭，等 JS 确认
            }
            break;
        }
        case WM_SIZE:
        case WM_SHOWWINDOW: {
            EnumChildWindows(hWnd, EnumChildProc, (LPARAM)hWnd);
            break;
        }
        case WM_GETMINMAXINFO: {
            // 确保最大化时不会遮挡任务栏
            MINMAXINFO* mmi = (MINMAXINFO*)lParam;
            // 用户拖动边框的最小 / 最大跟踪尺寸（逻辑像素 → 物理像素）。
            // ptMaxTrackSize 只管「拖动」，ptMaxSize 仍留给「最大化 = 工作区」，二者不冲突。
            const int dpi = DpiOfWindow(hWnd);
            if (g_minTrackW > 0 && g_minTrackH > 0) {
                mmi->ptMinTrackSize.x = MulDiv(g_minTrackW, dpi, 96);
                mmi->ptMinTrackSize.y = MulDiv(g_minTrackH, dpi, 96);
            }
            if (g_maxTrackW > 0 && g_maxTrackH > 0) {
                mmi->ptMaxTrackSize.x = MulDiv(g_maxTrackW, dpi, 96);
                mmi->ptMaxTrackSize.y = MulDiv(g_maxTrackH, dpi, 96);
            }
            HMONITOR monitor = MonitorFromWindow(hWnd, MONITOR_DEFAULTTONEAREST);
            if (monitor) {
                MONITORINFO mi = { sizeof(mi) };
                if (GetMonitorInfo(monitor, &mi)) {
                    mmi->ptMaxPosition.x = mi.rcWork.left - mi.rcMonitor.left;
                    mmi->ptMaxPosition.y = mi.rcWork.top - mi.rcMonitor.top;
                    mmi->ptMaxSize.x = mi.rcWork.right - mi.rcWork.left;
                    mmi->ptMaxSize.y = mi.rcWork.bottom - mi.rcWork.top;
                }
            }
            return 0;
        }
        case WM_HOTKEY: {
            // 宿主全局热键触发。仅当本窗口是前台窗口时才响应，后台不抢系统组合键。
            if (GetForegroundWindow() == hWnd) {
                shin::host::WebviewShell::GetInstance().DispatchHotkey(static_cast<int>(wParam));
            }
            return 0;  // WM_HOTKEY 默认处理即忽略，无需转发 DefSubclassProc
        }
        }
        return DefSubclassProc(hWnd, uMsg, wParam, lParam);
    }

    LRESULT CALLBACK ChildSubclassProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam, UINT_PTR uIdSubclass, DWORD_PTR dwRefData) {
        if (uMsg == WM_NCHITTEST) {
            HWND hostHwnd = (HWND)dwRefData;
            DWORD style = GetWindowLongPtr(hostHwnd, GWL_STYLE);

            if (!(style & WS_CAPTION) && (style & WS_THICKFRAME) && !IsZoomed(hostHwnd)) {
                POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
                RECT rc;
                GetWindowRect(hostHwnd, &rc);
                
                const int span = 10;
                // 检查鼠标是否在宿主窗口的边缘
                if (pt.x < rc.left + span || pt.x >= rc.right - span ||
                    pt.y < rc.top + span || pt.y >= rc.bottom - span) {
                    // 让消息穿透到宿主窗口
                    return HTTRANSPARENT;
                }
            }
        } else if (uMsg == WM_NCDESTROY) {
            RemoveWindowSubclass(hWnd, ChildSubclassProc, uIdSubclass);
            RemovePropW(hWnd, L"ShinSubclassed");
        }
        return DefSubclassProc(hWnd, uMsg, wParam, lParam);
    }

    BOOL CALLBACK EnumChildProc(HWND hWnd, LPARAM lParam) {
        // 检查是否已经子类化过
        if (!GetPropW(hWnd, L"ShinSubclassed")) {
            SetWindowSubclass(hWnd, ChildSubclassProc, 2, lParam);
            SetPropW(hWnd, L"ShinSubclassed", (HANDLE)1);
            
            // 继续向下递归枚举子窗口的子窗口
            EnumChildWindows(hWnd, EnumChildProc, lParam);
        }
        return TRUE;
    }
}
#endif

namespace shin {
namespace host {

#ifdef _WIN32
    namespace {
        std::string WideToUtf8(const wchar_t* value) {
            if (!value) return {};
            const int length = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
            if (length <= 1) return {};
            std::string result(length - 1, '\0');
            WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), length, nullptr, nullptr);
            return result;
        }

        std::wstring Utf8ToWide(const std::string& value) {
            if (value.empty()) return {};
            const int length = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
            if (length <= 0) return {};
            std::wstring result(length, L'\0');
            MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(), length);
            return result;
        }

        // —— 共享内存槽：两块独立 buffer，各有一个 owner，消除「扩容导致地址失效」竞态 ——
        struct SharedBufferSlot {
            Microsoft::WRL::ComPtr<ICoreWebView2SharedBuffer> buffer;
            void* memory = nullptr;
            size_t size = 0;
        };

        void ResetSharedBuffer(SharedBufferSlot& slot) {
            if (slot.memory) {
                UnmapViewOfFile(slot.memory);
                slot.memory = nullptr;
            }
            if (slot.buffer) {
                slot.buffer->Close();
                slot.buffer = nullptr;
            }
            slot.size = 0;
        }

        // 在 UI 线程上确保槽 >= size，不够则重建（新建成功后才释放旧槽）。调用方保证在 UI 线程。
        bool EnsureSharedBuffer(SharedBufferSlot& slot, size_t size, ICoreWebView2Controller* controller) {
            if (!controller || size == 0) return false;
            if (slot.buffer && slot.size >= size) return true;

            // 过小的 buffer 可能触发 CreateSharedBuffer/MapViewOfFile 的边界问题，统一至少 1 MiB。
            const size_t allocSize = size < 1048576 ? 1048576 : size;

            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (FAILED(controller->get_CoreWebView2(&wv2))) return false;

            Microsoft::WRL::ComPtr<ICoreWebView2_2> wv2_2;
            if (FAILED(wv2.As(&wv2_2))) return false;

            Microsoft::WRL::ComPtr<ICoreWebView2Environment> env;
            wv2_2->get_Environment(&env);
            if (!env) return false;

            Microsoft::WRL::ComPtr<ICoreWebView2Environment12> env12;
            if (FAILED(env.As(&env12))) return false;

            Microsoft::WRL::ComPtr<ICoreWebView2SharedBuffer> newBuffer;
            if (FAILED(env12->CreateSharedBuffer(allocSize, &newBuffer))) return false;

            HANDLE handle = NULL;
            if (FAILED(newBuffer->get_FileMappingHandle(&handle)) || !handle) return false;

            void* mapped = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, allocSize);
            if (!mapped) return false;

            ResetSharedBuffer(slot);
            slot.buffer = newBuffer;
            slot.memory = mapped;
            slot.size = allocSize;
            return true;
        }

        // 在 UI 线程上把指定 buffer 推给 JS（sharedbufferreceived）。调用方保证在 UI 线程。
        bool PostBufferToScript(ICoreWebView2SharedBuffer* buffer, const std::string& meta, ICoreWebView2Controller* controller) {
            if (!buffer || !controller) return false;

            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (FAILED(controller->get_CoreWebView2(&wv2))) return false;

            Microsoft::WRL::ComPtr<ICoreWebView2_17> wv2_17;
            if (FAILED(wv2.As(&wv2_17))) return false;

            int size_needed = MultiByteToWideChar(CP_UTF8, 0, meta.c_str(), (int)meta.size(), NULL, 0);
            std::wstring wmeta(size_needed, 0);
            MultiByteToWideChar(CP_UTF8, 0, meta.c_str(), (int)meta.size(), &wmeta[0], size_needed);

            HRESULT hr = wv2_17->PostSharedBufferToScript(
                buffer,
                COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
                wmeta.c_str()
            );
            return SUCCEEDED(hr);
        }

        class BrowserExtensionAddedHandler final
            : public ICoreWebView2ProfileAddBrowserExtensionCompletedHandler {
        public:
            BrowserExtensionAddedHandler(std::filesystem::path path,
                                        WebviewShell::BrowserExtensionCallback callback)
                : m_path(std::move(path)), m_callback(std::move(callback)) {}

            HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
                if (!object) return E_POINTER;
                if (iid == IID_IUnknown || iid == IID_ICoreWebView2ProfileAddBrowserExtensionCompletedHandler) {
                    *object = static_cast<ICoreWebView2ProfileAddBrowserExtensionCompletedHandler*>(this);
                    AddRef();
                    return S_OK;
                }
                *object = nullptr;
                return E_NOINTERFACE;
            }

            ULONG STDMETHODCALLTYPE AddRef() override { return ++m_referenceCount; }
            ULONG STDMETHODCALLTYPE Release() override {
                const ULONG count = --m_referenceCount;
                if (count == 0) delete this;
                return count;
            }

            HRESULT STDMETHODCALLTYPE Invoke(HRESULT errorCode,
                                             ICoreWebView2BrowserExtension* extension) override {
                WebviewShell::BrowserExtensionResult result;
                result.path = m_path;
                result.success = SUCCEEDED(errorCode) && extension;
                result.hresult = static_cast<std::int32_t>(errorCode);

                if (result.success) {
                    LPWSTR name = nullptr;
                    if (SUCCEEDED(extension->get_Name(&name))) {
                        result.name = WideToUtf8(name);
                        CoTaskMemFree(name);
                    }
                } else {
                    result.error = "AddBrowserExtension failed with HRESULT 0x" +
                                   std::to_string(static_cast<unsigned long>(errorCode));
                }

                if (m_callback) m_callback(result);
                return S_OK;
            }

        private:
            volatile ULONG m_referenceCount = 1;
            std::filesystem::path m_path;
            WebviewShell::BrowserExtensionCallback m_callback;
        };

        // ---- 下载处理 --------------------------------------------------------
        // 从 Content-Disposition（优先）或 URI 最后一段里取文件名，用于拼落盘路径。
        std::string ExtractDownloadFileName(const std::string& contentDisposition, const std::string& uri) {
            if (!contentDisposition.empty()) {
                const std::string key = "filename=";
                const auto pos = contentDisposition.find(key);
                if (pos != std::string::npos) {
                    std::string name = contentDisposition.substr(pos + key.size());
                    if (!name.empty() && name.front() == '"') {
                        const auto end = name.find('"', 1);
                        if (end != std::string::npos) name = name.substr(1, end - 1);
                    } else {
                        const auto semi = name.find(';');
                        if (semi != std::string::npos) name = name.substr(0, semi);
                    }
                    if (!name.empty()) return name;
                }
            }
            const auto q = uri.find('?');
            const std::string path = uri.substr(0, q);
            const auto slash = path.find_last_of('/');
            std::string name = (slash == std::string::npos) ? path : path.substr(slash + 1);
            return name.empty() ? "download" : name;
        }

        void SendDownloadNotification(ICoreWebView2DownloadOperation* op, const char* action) {
            if (!op) return;
            std::string uri, path, mime;
            LPWSTR w = nullptr;
            if (SUCCEEDED(op->get_Uri(&w)) && w) { uri = WideToUtf8(w); CoTaskMemFree(w); }
            if (SUCCEEDED(op->get_ResultFilePath(&w)) && w) { path = WideToUtf8(w); CoTaskMemFree(w); }
            if (SUCCEEDED(op->get_MimeType(&w)) && w) { mime = WideToUtf8(w); CoTaskMemFree(w); }
            INT64 total = -1, received = -1;
            op->get_TotalBytesToReceive(&total);
            op->get_BytesReceived(&received);
            COREWEBVIEW2_DOWNLOAD_STATE state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
            op->get_State(&state);

            nlohmann::json msg = {
                {"action", action},
                {"uri", uri},
                {"path", path},
                {"mime", mime},
                {"state", static_cast<int>(state)},
                {"totalBytes", total},
                {"receivedBytes", received}
            };
            WebviewShell::GetInstance().SendJson(msg.dump());
        }

        class DownloadOperationProgressHandler final : public ICoreWebView2BytesReceivedChangedEventHandler {
        public:
            HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
                if (!object) return E_POINTER;
                if (iid == IID_IUnknown || iid == IID_ICoreWebView2BytesReceivedChangedEventHandler) {
                    *object = static_cast<ICoreWebView2BytesReceivedChangedEventHandler*>(this);
                    AddRef();
                    return S_OK;
                }
                *object = nullptr;
                return E_NOINTERFACE;
            }
            ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
            ULONG STDMETHODCALLTYPE Release() override {
                const ULONG c = --m_ref;
                if (c == 0) delete this;
                return c;
            }
            HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2DownloadOperation* op, IUnknown*) override {
                SendDownloadNotification(op, "DownloadProgress");
                return S_OK;
            }
        private:
            volatile ULONG m_ref = 1;
        };

        class DownloadOperationStateHandler final : public ICoreWebView2StateChangedEventHandler {
        public:
            HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
                if (!object) return E_POINTER;
                if (iid == IID_IUnknown || iid == IID_ICoreWebView2StateChangedEventHandler) {
                    *object = static_cast<ICoreWebView2StateChangedEventHandler*>(this);
                    AddRef();
                    return S_OK;
                }
                *object = nullptr;
                return E_NOINTERFACE;
            }
            ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
            ULONG STDMETHODCALLTYPE Release() override {
                const ULONG c = --m_ref;
                if (c == 0) delete this;
                return c;
            }
            HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2DownloadOperation* op, IUnknown*) override {
                SendDownloadNotification(op, "DownloadStateChanged");
                return S_OK;
            }
        private:
            volatile ULONG m_ref = 1;
        };

        class DownloadStartingHandler final : public ICoreWebView2DownloadStartingEventHandler {
        public:
            HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
                if (!object) return E_POINTER;
                if (iid == IID_IUnknown || iid == IID_ICoreWebView2DownloadStartingEventHandler) {
                    *object = static_cast<ICoreWebView2DownloadStartingEventHandler*>(this);
                    AddRef();
                    return S_OK;
                }
                *object = nullptr;
                return E_NOINTERFACE;
            }
            ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
            ULONG STDMETHODCALLTYPE Release() override {
                const ULONG c = --m_ref;
                if (c == 0) delete this;
                return c;
            }

            HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) override {
                if (!args) return S_OK;
                Microsoft::WRL::ComPtr<ICoreWebView2DownloadOperation> op;
                if (FAILED(args->get_DownloadOperation(&op)) || !op) return S_OK;

                LPWSTR w = nullptr;
                std::string uri, cd;
                if (SUCCEEDED(op->get_Uri(&w)) && w) { uri = WideToUtf8(w); CoTaskMemFree(w); }
                if (SUCCEEDED(op->get_ContentDisposition(&w)) && w) { cd = WideToUtf8(w); CoTaskMemFree(w); }

                auto& shell = WebviewShell::GetInstance();
                std::string savePath = shell.TakePendingDownloadPath();
                if (savePath.empty()) {
                    const std::string dir = shell.DownloadDirectory();
                    if (!dir.empty()) {
                        savePath = dir;
                        if (savePath.back() != '\\' && savePath.back() != '/') savePath += '\\';
                        savePath += ExtractDownloadFileName(cd, uri);
                    }
                }
                if (!savePath.empty()) {
                    // Handled 保持 FALSE：让 WebView2 自己把文件写到 ResultFilePath（或默认位置）。
                    args->put_ResultFilePath(Utf8ToWide(savePath).c_str());
                }

                // 订阅进度 / 完成事件，推给 JS（WebView2 会 AddRef，这里只释放本地引用）。
                EventRegistrationToken tok{};
                auto* progress = new DownloadOperationProgressHandler();
                if (SUCCEEDED(op->add_BytesReceivedChanged(progress, &tok))) progress->Release();
                auto* state = new DownloadOperationStateHandler();
                if (SUCCEEDED(op->add_StateChanged(state, &tok))) state->Release();

                LOG_INFO("Webview", "下载开始: " + uri + (savePath.empty() ? std::string() : " -> " + savePath));
                SendDownloadNotification(op.Get(), "DownloadStarted");
                return S_OK;
            }
        private:
            volatile ULONG m_ref = 1;
        };

        // ---- IObject WebView 桥接：上行消息（window.chrome.webview.postMessage(json, [ArrayBuffer])） ----
        // 把 postMessage 的第一个 JSON 字符串 + additionalObjects[0] 的共享 buffer 字节回调给上层。
        class WebMessageReceivedHandler final : public ICoreWebView2WebMessageReceivedEventHandler {
        public:
            using Callback = std::function<void(const std::string&, const void*, size_t, const std::string&)>;

            explicit WebMessageReceivedHandler(Callback callback) : m_callback(std::move(callback)) {}

            HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
                if (!object) return E_POINTER;
                if (iid == IID_IUnknown || iid == IID_ICoreWebView2WebMessageReceivedEventHandler) {
                    *object = static_cast<ICoreWebView2WebMessageReceivedEventHandler*>(this);
                    AddRef();
                    return S_OK;
                }
                *object = nullptr;
                return E_NOINTERFACE;
            }
            ULONG STDMETHODCALLTYPE AddRef() override { return ++m_ref; }
            ULONG STDMETHODCALLTYPE Release() override {
                const ULONG count = --m_ref;
                if (count == 0) delete this;
                return count;
            }

            HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2*,
                                             ICoreWebView2WebMessageReceivedEventArgs* args) override {
                std::string json;
                {
                    LPWSTR w = nullptr;
                    if (SUCCEEDED(args->get_WebMessageAsJson(&w)) && w) {
                        json = WideToUtf8(w);
                        CoTaskMemFree(w);
                    }
                }

                // additionalObjects[0]：可能是 ArrayBuffer（零拷贝共享 buffer），
                // 也可能是 DOM File（拖放文件，经 ICoreWebView2File 拿绝对路径）。
                const void* data = nullptr;
                size_t size = 0;
                std::string filePath;
                {
                    Microsoft::WRL::ComPtr<ICoreWebView2WebMessageReceivedEventArgs2> args2;
                    if (SUCCEEDED(args->QueryInterface(
                            __uuidof(ICoreWebView2WebMessageReceivedEventArgs2),
                            reinterpret_cast<void**>(args2.GetAddressOf())))) {
                        Microsoft::WRL::ComPtr<ICoreWebView2ObjectCollectionView> objects;
                        if (SUCCEEDED(args2->get_AdditionalObjects(&objects)) && objects) {
                            UINT32 count = 0;
                            if (SUCCEEDED(objects->get_Count(&count)) && count > 0) {
                                Microsoft::WRL::ComPtr<IUnknown> unk;
                                if (SUCCEEDED(objects->GetValueAtIndex(0, &unk)) && unk) {
                                    Microsoft::WRL::ComPtr<ICoreWebView2SharedBuffer> buffer;
                                    if (SUCCEEDED(unk.As(&buffer)) && buffer) {
                                        BYTE* p = nullptr;
                                        UINT64 sz = 0;
                                        if (SUCCEEDED(buffer->get_Buffer(&p)) && p &&
                                            SUCCEEDED(buffer->get_Size(&sz))) {
                                            data = p;
                                            size = static_cast<size_t>(sz);
                                        }
                                    } else {
                                        Microsoft::WRL::ComPtr<ICoreWebView2File> file;
                                        if (SUCCEEDED(unk.As(&file)) && file) {
                                            LPWSTR pathW = nullptr;
                                            if (SUCCEEDED(file->get_Path(&pathW)) && pathW) {
                                                filePath = WideToUtf8(pathW);
                                                CoTaskMemFree(pathW);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (m_callback) {
                    m_callback(json, data, size, filePath);
                }
                return S_OK;
            }

        private:
            volatile ULONG m_ref = 1;
            Callback m_callback;
        };
    }
#endif

    struct WebviewShell::Impl {
        bool debug = false;
        void* parentWindow = nullptr;
        std::string startupUrl;
        std::string startupHtml;
        bool contextMenuEnabled = false;
        std::string title = "Shin UI";
        int width = 800;
        int height = 600;
        int hints = WEBVIEW_HINT_NONE;
        int minWidth = 0, minHeight = 0;   // 用户拖动最小尺寸（逻辑像素，0 = 不限）
        int maxWidth = 0, maxHeight = 0;   // 用户拖动最大尺寸（逻辑像素，0 = 不限）
        bool useNativeTitlebar = false;    // 是否使用系统原生标题栏

        // 运行时全局热键：id → handler；combo(mods<<16|key) → id
        int nextHotkeyId = 0x1000;
        std::unordered_map<int, std::function<void()>> hotkeyHandlers;
        std::unordered_map<uint64_t, int> hotkeyByCombo;
        bool browserExtensionsEnabled = false;
        // 由 SetRemoteDebuggingPort 维护（它每次会整体替换）
        std::string additionalBrowserArguments;
        // 由 AppendBrowserArguments 累加，与上面互不覆盖；Initialize 时拼在最后
        std::vector<std::string> extraBrowserArguments;
        
        struct BindData {
            std::string name;
            std::function<std::string(const std::string&)> fn;
        };
        std::vector<BindData> binds;
        std::vector<std::string> initScripts;
        std::function<void(const void*, size_t)> binaryReceivedCallback;

        // 宿主事件回调（SetHostEventSink 注册）：把一次性业务事件交给 IObject 发布。
        std::function<void(const std::string&, const std::string&)> hostEventSink;

        std::unique_ptr<webview::webview> w;
        std::atomic<bool> isInitialized{false};
        std::thread::id uiThreadId;

#ifdef _WIN32
        SharedBufferSlot writeBuffer;  // 单块共享内存：JS↔C++ 双向共用，posted 一次后不再重复推送

        // IObject 桥接的两块对称共享 buffer（各 4MB，预分配复用，避免每次 CreateSharedBuffer）。
        SharedBufferSlot downlinkBuffer;  // 下行：C++ 写 → JS 读（READ_ONLY）
        size_t downlinkOffset = 0;        // 下行 append-only 写偏移（溢出回绕到 0）
        SharedBufferSlot uplinkBuffer;    // 上行：JS 写 → C++ 读（READ_WRITE）

        // 下载落盘目录（空 = 系统默认「下载」目录）。由 SetDownloadDirectory 维护。
        std::string downloadDirectory;
        // 单次下载的落盘路径覆盖：DownloadFile(url, savePath) 使用后即清空。
        std::string pendingDownloadPath;
        // DownloadStarting 事件注册令牌（析构 / 重载时用于移除）。
        EventRegistrationToken downloadStartingToken{};
        bool downloadHandlerInstalled = false;

        // IObject WebView 桥接：上行消息回调（WebMessageReceived 处理器转发）。
        std::function<void(const std::string&, const void*, size_t)> webMessageReceivedCallback;
        EventRegistrationToken webMessageReceivedToken{};
        bool webMessageReceivedInstalled = false;
#endif
    };

    WebviewShell& WebviewShell::GetInstance() {
        static WebviewShell instance;
        return instance;
    }

    WebviewShell::WebviewShell() : m_impl(std::make_unique<Impl>()) {}
    WebviewShell::~WebviewShell() {
#ifdef _WIN32
        if (m_impl) {
            if (m_impl->writeBuffer.memory) UnmapViewOfFile(m_impl->writeBuffer.memory);
            if (m_impl->downlinkBuffer.memory) UnmapViewOfFile(m_impl->downlinkBuffer.memory);
            if (m_impl->uplinkBuffer.memory) UnmapViewOfFile(m_impl->uplinkBuffer.memory);
        }
#endif
    }

    void WebviewShell::SetDebug(bool enable) {
        if (!m_impl->isInitialized) m_impl->debug = enable;
    }

    void WebviewShell::SetRemoteDebuggingPort(int port) {
        if (m_impl->isInitialized) return;
        m_impl->additionalBrowserArguments.clear();
        if (port > 0) {
            // WebView2 binds the CDP endpoint to loopback (localhost) by default.
            m_impl->additionalBrowserArguments =
                "--remote-debugging-port=" + std::to_string(port);
        }
    }

    void WebviewShell::AppendBrowserArguments(const std::string& args) {
        if (m_impl->isInitialized || args.empty()) return;
        m_impl->extraBrowserArguments.push_back(args);
    }

    void WebviewShell::SetParentWindow(void* hwnd) {
        if (!m_impl->isInitialized) m_impl->parentWindow = hwnd;
    }

    void WebviewShell::SetStartupURL(const std::string& url) {
        if (!m_impl->isInitialized) m_impl->startupUrl = url;
    }

    void WebviewShell::SetStartupHTML(const std::string& html) {
        if (!m_impl->isInitialized) m_impl->startupHtml = html;
    }

    void WebviewShell::SetContextMenuEnabled(bool enable) {
        m_impl->contextMenuEnabled = enable;
        if (m_impl->w) {
#ifdef _WIN32
            auto controller = (ICoreWebView2Controller*)GetNativeController();
            if (controller) {
                Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
                if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) {
                    Microsoft::WRL::ComPtr<ICoreWebView2Settings> settings;
                    if (SUCCEEDED(wv2->get_Settings(&settings))) {
                        settings->put_AreDefaultContextMenusEnabled(enable);
                    }
                }
            }
#endif
        }
    }

    void WebviewShell::InjectJSBeforeLoad(const std::string& js) {
        if (!m_impl->isInitialized) m_impl->initScripts.push_back(js);
    }

    void WebviewShell::BindFunction(const std::string& name, std::function<std::string(const std::string&)> fn) {
        if (!m_impl->isInitialized) {
            m_impl->binds.push_back({name, fn});
        }
    }

    void WebviewShell::SetTitle(const std::string& title) {
        m_impl->title = title;
        if (m_impl->isInitialized && m_impl->w) {
            if (std::this_thread::get_id() == m_impl->uiThreadId) {
                m_impl->w->set_title(title);
            } else {
                m_impl->w->dispatch([this, title]() { m_impl->w->set_title(title); });
            }
        }
    }

    std::string WebviewShell::GetTitle() const {
        return m_impl->title;
    }

    void WebviewShell::SetBrowserExtensionsEnabled(bool enable) {
        if (!m_impl->isInitialized) {
            m_impl->browserExtensionsEnabled = enable;
        }
    }

    void WebviewShell::SetSize(int width, int height, bool fixed) {
        m_impl->width = width;
        m_impl->height = height;
        m_impl->hints = fixed ? WEBVIEW_HINT_FIXED : WEBVIEW_HINT_NONE;
        
        if (m_impl->isInitialized && m_impl->w) {
            int w_copy = m_impl->width;
            int h_copy = m_impl->height;
            int hints_copy = m_impl->hints;
            if (std::this_thread::get_id() == m_impl->uiThreadId) {
                m_impl->w->set_size(w_copy, h_copy, static_cast<webview_hint_t>(hints_copy));
            } else {
                m_impl->w->dispatch([this, w_copy, h_copy, hints_copy]() { 
                    m_impl->w->set_size(w_copy, h_copy, static_cast<webview_hint_t>(hints_copy)); 
                });
            }
        }
    }

    int WebviewShell::GetWidth() const {
        return m_impl->width;
    }

    int WebviewShell::GetHeight() const {
        return m_impl->height;
    }

    void WebviewShell::SetMinSize(int width, int height) {
        m_impl->minWidth = width;
        m_impl->minHeight = height;
        g_minTrackW = width;
        g_minTrackH = height;
    }

    void WebviewShell::SetMaxSize(int width, int height) {
        m_impl->maxWidth = width;
        m_impl->maxHeight = height;
        g_maxTrackW = width;
        g_maxTrackH = height;
    }

    void WebviewShell::SetUseNativeTitlebar(bool use) {
        if (!m_impl->isInitialized) m_impl->useNativeTitlebar = use;
    }

    WebviewShell::WindowMetrics WebviewShell::ApplyDesignSize(int designWidth, int designHeight) {
        // 记录设计尺寸（与 SetSize 同源），保证 GetWidth/GetHeight 读到最新意图。
        m_impl->width = designWidth;
        m_impl->height = designHeight;

        WindowMetrics out;
        out.designWidth = designWidth;
        out.designHeight = designHeight;
        out.clientWidth = designWidth;
        out.clientHeight = designHeight;
        out.windowWidth = designWidth;
        out.windowHeight = designHeight;

#ifdef _WIN32
        HWND hwnd = static_cast<HWND>(GetNativeWindow());
        if (!hwnd) return out;

        // 尺寸/位置只能在 UI 线程改（窗口归属线程），否则会和外层消息泵打架。
        if (std::this_thread::get_id() != m_impl->uiThreadId) {
            LOG_ERROR("Webview", "ApplyDesignSize 必须在 UI 线程调用，已忽略。");
            return out;
        }

        const int dpi = DpiOfWindow(hwnd);
        out.dpi = dpi;

        // 逻辑像素 -> 物理像素 -> 加上非客户区边框
        int winW = MulDiv(designWidth, dpi, 96);
        int winH = MulDiv(designHeight, dpi, 96);
        SizeWithFrame(hwnd, winW, winH, static_cast<UINT>(dpi));

        const RECT work = WorkAreaOf(hwnd);
        const int workW = work.right - work.left;
        const int workH = work.bottom - work.top;
        out.workAreaWidth = workW;
        out.workAreaHeight = workH;

        // 小屏 / 高缩放系数下 1280x720 可能装不下：等比收缩，保持 16:9 的构图不变形。
        if (workW > 0 && workH > 0) {
            // 同 FitWindowIntoWorkArea：不能用 std::min({...})，windows.h 的 min 宏会误判参数个数。
            double fit = static_cast<double>(workW) / winW;
            const double fitH = static_cast<double>(workH) / winH;
            if (fitH < fit) fit = fitH;
            if (fit > 1.0) fit = 1.0;
            if (fit < 1.0) {
                winW = (std::max)(360, static_cast<int>(winW * fit));
                winH = (std::max)(260, static_cast<int>(winH * fit));
                out.shrunkToFit = true;
            }
            const int x = work.left + (std::max)(0, (workW - winW) / 2);
            const int y = work.top + (std::max)(0, (workH - winH) / 2);
            SetWindowPos(hwnd, nullptr, x, y, winW, winH, SWP_NOZORDER | SWP_NOACTIVATE);
        }

        RECT cr{};
        GetClientRect(hwnd, &cr);
        out.windowWidth = winW;
        out.windowHeight = winH;
        out.clientWidth = cr.right - cr.left;
        out.clientHeight = cr.bottom - cr.top;
#endif
        return out;
    }

    bool WebviewShell::Initialize() {
        if (m_impl->isInitialized) return true;

        try {
            // 拼接全部额外浏览器参数：远程调试那段在前，追加参数在后。
            std::string browserArgs = m_impl->additionalBrowserArguments;
            for (const auto& extra : m_impl->extraBrowserArguments) {
                if (extra.empty()) continue;
                if (!browserArgs.empty()) browserArgs += ' ';
                browserArgs += extra;
            }

            m_impl->w = std::make_unique<webview::webview>(
                m_impl->debug, m_impl->parentWindow,
                m_impl->browserExtensionsEnabled,
                browserArgs);
            m_impl->uiThreadId = std::this_thread::get_id();

            m_impl->w->set_title(m_impl->title);
            m_impl->w->set_size(m_impl->width, m_impl->height, static_cast<webview_hint_t>(m_impl->hints));

            // Apply Context Menu settings
            SetContextMenuEnabled(m_impl->contextMenuEnabled);

            for (const auto& js : m_impl->initScripts) {
                m_impl->w->init(js);
            }

            // Keep custom binds working for backward compatibility or special cases
            for (const auto& b : m_impl->binds) {
                m_impl->w->bind(b.name, [fn = b.fn](const std::string& req) -> std::string {
                    return fn(req);
                });

                // Auto-map internal bound functions that start with __ and end with __ 
                // e.g. "__sendDataToCpp__" -> "window.Shin.sendDataToCpp"
                if (b.name.size() > 4 && b.name.substr(0, 2) == "__" && b.name.substr(b.name.size() - 2) == "__") {
                    std::string exposedName = b.name.substr(2, b.name.size() - 4);
                    std::string mappingScript = 
                        "window.Shin." + exposedName + " = window." + b.name + "; "
                        "delete window." + b.name + ";";
                    m_impl->w->init(mappingScript);
                }
            }

            if (!m_impl->startupHtml.empty()) {
                m_impl->w->set_html(m_impl->startupHtml);
            } else if (!m_impl->startupUrl.empty()) {
                m_impl->w->navigate(m_impl->startupUrl);
            }

            m_impl->isInitialized = true;

#ifdef _WIN32
            HWND hostHwnd = (HWND)GetNativeWindow();
            if (hostHwnd) {
                // 1. 宿主窗口子类化：处理边缘碰撞检测 + WM_CLOSE 关闭通知。
                //    必须先于下面的样式修改 / set_size：set_size 带 SWP_FRAMECHANGED 会触发
                //    WM_NCCALCSIZE，若此时子类尚未安装，客户区会走系统默认路径（保留 thickframe
                //    边框），窗口四周就会露出 DWM 绘制的浅色原生边框（白边）。
                g_onWindowCloseRequested = [this]() {
#ifdef _WIN32
                    // 最小化时收到关闭请求：先恢复并置顶，让用户看到退出二次确认框
                    // （否则确认框弹在最小化的窗口里，用户根本看不到，会以为点了没反应）。
                    HWND hwnd = (HWND)GetNativeWindow();
                    if (hwnd && IsIconic(hwnd)) {
                        BringToFront();
                    }
#endif
                    if (m_impl->hostEventSink) {
                        m_impl->hostEventSink("WindowCloseRequested", "");
                    }
                };

                SetWindowSubclass(hostHwnd, HostSubclassProc, 1, 0);

                // 0. 无边框 / 原生标题栏二选一（默认无边框）。无边框时去掉 WS_CAPTION，
                //    页面自带自定义标题栏 + 窗口按钮；useNativeTitlebar 时保留系统原生标题栏，
                //    此时 HostSubclassProc 的 NCCALCSIZE/NCHITTEST 都因存在 WS_CAPTION 而走默认，
                //    边缘 resize / 拖拽交给系统。
                if (!m_impl->useNativeTitlebar) {
                    LONG_PTR style = GetWindowLongPtrW(hostHwnd, GWL_STYLE);
                    style &= ~WS_CAPTION;
                    SetWindowLongPtrW(hostHwnd, GWL_STYLE, style);
                }

                // 无边框时底层 set_size 会按「有边框」假设把非客户区边框算进外框，而本窗口
                // 无边框后 WM_NCCALCSIZE 返回 0、客户区 = 外框，不纠正会四周留灰隙；
                // 有原生标题栏时 set_size 已正确加边框，无需纠正。
                m_impl->w->set_size(m_impl->width, m_impl->height,
                    static_cast<webview_hint_t>(m_impl->hints));

                // fixed（固定尺寸）时底层把 WS_MAXIMIZEBOX 一并去掉了，这里加回来：
                // 只禁拖拽 resize，保留最大化（全屏铺满工作区）能力。
                if (m_impl->hints == WEBVIEW_HINT_FIXED) {
                    LONG_PTR style = GetWindowLongPtrW(hostHwnd, GWL_STYLE);
                    style |= WS_MAXIMIZEBOX;
                    SetWindowLongPtrW(hostHwnd, GWL_STYLE, style);
                }

                const int dpi = DpiOfWindow(hostHwnd);
                int winW, winH;
                if (!m_impl->useNativeTitlebar) {
                    // 无边框：外框精确设回「设计尺寸 × DPI」（不加边框），客户区 = 设计尺寸。
                    winW = MulDiv(m_impl->width, dpi, 96);
                    winH = MulDiv(m_impl->height, dpi, 96);
                } else {
                    // 有原生标题栏：取 set_size 后的实际外框尺寸，仅用于居中。
                    RECT wr{};
                    GetWindowRect(hostHwnd, &wr);
                    winW = wr.right - wr.left;
                    winH = wr.bottom - wr.top;
                }

                // 初始创建：把窗口放到「当前所在显示器」的工作区正中间（不再用系统默认的级联位置）。
                // 多屏下底层默认在主屏创建，MonitorFromWindow(MONITOR_DEFAULTTONEAREST) 就近命中主屏，
                // 故首屏会居中在主显示器；要跟随鼠标所在屏可改为 MonitorFromPoint(GetCursorPos()...)。
                const RECT work = WorkAreaOf(hostHwnd);
                const int workW = work.right - work.left;
                const int workH = work.bottom - work.top;
                const int x = work.left + (std::max)(0, (workW - winW) / 2);
                const int y = work.top + (std::max)(0, (workH - winH) / 2);

                SetWindowPos(hostHwnd, nullptr, x, y, winW, winH,
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

                // 2. 子窗口枚举并子类化：让 WebView2 的边缘消息穿透到宿主
                // 稍微延迟一下确保 WebView2 子窗口已创建（可选，这里先同步尝试）
                EnumChildWindows(hostHwnd, EnumChildProc, (LPARAM)hostHwnd);
            }

            // 3. 注册下载处理：页面触发的下载统一从这里接管落盘位置 + 通知 JS。
            auto controller = (ICoreWebView2Controller*)GetNativeController();
            if (controller) {
                Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
                if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) {
                    // 关掉浏览器默认 DevTools 入口（F12 / Ctrl+Shift+I / 右键 Inspect），
                    // 控制台只允许宿主全局热键 Alt+Q 显式打开（OpenDevToolsWindow 不受此开关影响）。
                    Microsoft::WRL::ComPtr<ICoreWebView2Settings> settings;
                    if (SUCCEEDED(wv2->get_Settings(&settings))) {
                        settings->put_AreDevToolsEnabled(FALSE);
                    }

                    Microsoft::WRL::ComPtr<ICoreWebView2_4> wv2_4;
                    if (SUCCEEDED(wv2.As(&wv2_4))) {
                        auto* dl = new DownloadStartingHandler();
                        if (SUCCEEDED(wv2_4->add_DownloadStarting(dl, &m_impl->downloadStartingToken))) {
                            dl->Release();  // 本地引用还给 WebView2 持有的一份
                            m_impl->downloadHandlerInstalled = true;
                        } else {
                            dl->Release();  // 注册失败：释放本地引用（引用计数归零即自删）
                        }
                    }
                }
            }
#endif

            return true;
        } catch (...) {
            return false;
        }
    }

    void* WebviewShell::GetNativeWindow() {
        if (m_impl->w) {
            auto res = m_impl->w->window();
            if (res.ok()) return res.value();
        }
        return nullptr;
    }

    void WebviewShell::OpenDevTools() {
#ifdef _WIN32
        auto controller = (ICoreWebView2Controller*)GetNativeController();
        if (controller) {
            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) {
                wv2->OpenDevToolsWindow();
            }
        }
#endif
    }

    void* WebviewShell::GetNativeController() {
        if (m_impl->w) {
            auto res = m_impl->w->browser_controller();
            if (res.ok()) return res.value();
        }
        return nullptr;
    }

    // ---- 内部工具：在 UI 线程上跑一段逻辑（同线程直接执行，否则投递） ----
    namespace {
        template <typename Fn>
        void RunOnUi(WebviewShell& shell, Fn&& fn) {
            if (shell.IsOnUiThread()) { fn(); return; }
            shell.PostToUiThread(std::forward<Fn>(fn));
        }
    }

    void WebviewShell::GoBack() {
        RunOnUi(*this, [this]() {
#ifdef _WIN32
            auto controller = (ICoreWebView2Controller*)GetNativeController();
            if (!controller) return;
            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) wv2->GoBack();
#endif
        });
    }

    void WebviewShell::GoForward() {
        RunOnUi(*this, [this]() {
#ifdef _WIN32
            auto controller = (ICoreWebView2Controller*)GetNativeController();
            if (!controller) return;
            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) wv2->GoForward();
#endif
        });
    }

    void WebviewShell::StopNavigation() {
        RunOnUi(*this, [this]() {
#ifdef _WIN32
            auto controller = (ICoreWebView2Controller*)GetNativeController();
            if (!controller) return;
            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) wv2->Stop();
#endif
        });
    }

    void WebviewShell::Reload() {
        RunOnUi(*this, [this]() {
#ifdef _WIN32
            auto controller = (ICoreWebView2Controller*)GetNativeController();
            if (!controller) return;
            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) wv2->Reload();
#endif
        });
    }

    void WebviewShell::SetZoomFactor(double factor) {
        RunOnUi(*this, [this, factor]() {
#ifdef _WIN32
            auto controller = (ICoreWebView2Controller*)GetNativeController();
            if (controller) controller->put_ZoomFactor(factor);
#endif
        });
    }

    double WebviewShell::GetZoomFactor() {
#ifdef _WIN32
        if (IsOnUiThread()) {
            auto controller = (ICoreWebView2Controller*)GetNativeController();
            if (controller) {
                double f = 1.0;
                if (SUCCEEDED(controller->get_ZoomFactor(&f))) return f;
            }
            return 1.0;
        }
        auto promise = std::make_shared<std::promise<double>>();
        auto future = promise->get_future();
        PostToUiThread([this, promise]() { promise->set_value(GetZoomFactor()); });
        return future.get();
#else
        return 1.0;
#endif
    }

    void WebviewShell::ZoomIn(double step) {
        SetZoomFactor(GetZoomFactor() * step);
    }

    void WebviewShell::ZoomOut(double step) {
        SetZoomFactor(GetZoomFactor() * step);
    }

    void WebviewShell::ZoomReset() {
        SetZoomFactor(1.0);
    }

    void WebviewShell::SetWindowIcon(const std::string& icoPath) {
        RunOnUi(*this, [this, icoPath]() {
#ifdef _WIN32
            HWND hwnd = (HWND)GetNativeWindow();
            if (!hwnd) return;
            HICON hBig = nullptr;
            HICON hSmall = nullptr;
            if (!icoPath.empty()) {
                const std::wstring w = Utf8ToWide(icoPath);
                hBig = (HICON)LoadImageW(nullptr, w.c_str(), IMAGE_ICON,
                    GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_LOADFROMFILE);
                hSmall = (HICON)LoadImageW(nullptr, w.c_str(), IMAGE_ICON,
                    GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
            }
            if (!hBig) hBig = (HICON)GetClassLongPtrW(hwnd, GCLP_HICON);
            if (!hSmall) hSmall = (HICON)GetClassLongPtrW(hwnd, GCLP_HICONSM);
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, (LPARAM)hBig);
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)hSmall);
            LOG_INFO("Webview", "已设置窗口图标: " + (icoPath.empty() ? std::string("(默认)") : icoPath));
#endif
        });
    }

    void WebviewShell::ShowSystemMenu() {
        RunOnUi(*this, [this]() {
#ifdef _WIN32
            HWND hwnd = (HWND)GetNativeWindow();
            if (!hwnd) return;
            HMENU menu = GetSystemMenu(hwnd, FALSE);
            if (!menu) return;
            POINT pt{};
            GetCursorPos(&pt);
            UINT cmd = TrackPopupMenu(menu,
                TPM_LEFTBUTTON | TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
                pt.x, pt.y, 0, hwnd, nullptr);
            if (cmd) PostMessageW(hwnd, WM_SYSCOMMAND, cmd, 0);
#endif
        });
    }

    void WebviewShell::RestoreWindow() {
        RunOnUi(*this, [this]() {
#ifdef _WIN32
            HWND hwnd = (HWND)GetNativeWindow();
            if (!hwnd) return;
            if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
            SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
#endif
        });
    }

    void WebviewShell::BringToFront() {
        RunOnUi(*this, [this]() {
#ifdef _WIN32
            HWND hwnd = (HWND)GetNativeWindow();
            if (!hwnd) return;
            if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
            // 置顶（TOPMOST）后再置前：保证「最小化时唤出」能弹到屏幕最顶层。
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            SetForegroundWindow(hwnd);
#endif
        });
    }

    void WebviewShell::ConfirmExit() {
        RunOnUi(*this, [this]() {
#ifdef _WIN32
            // 前端二次确认通过：放行后续 WM_CLOSE，真正关闭窗口。
            g_closeConfirmed = true;
            HWND hwnd = (HWND)GetNativeWindow();
            if (hwnd) PostMessageW(hwnd, WM_CLOSE, 0, 0);
#endif
        });
    }

    int WebviewShell::BindHotkey(uint32_t modifiers, uint32_t key, std::function<void()> handler) {
#ifdef _WIN32
        HWND hwnd = static_cast<HWND>(GetNativeWindow());
        if (!hwnd || !handler) return 0;
        const uint64_t combo = (static_cast<uint64_t>(modifiers) << 16) | key;
        // 同一组合重复绑定：先解绑旧的，再绑新的。
        auto it = m_impl->hotkeyByCombo.find(combo);
        if (it != m_impl->hotkeyByCombo.end()) {
            UnregisterHotKey(hwnd, it->second);
            m_impl->hotkeyHandlers.erase(it->second);
            m_impl->hotkeyByCombo.erase(it);
        }
        const int id = m_impl->nextHotkeyId++;
        if (!RegisterHotKey(hwnd, id, modifiers, key)) return 0;
        m_impl->hotkeyHandlers[id] = std::move(handler);
        m_impl->hotkeyByCombo[combo] = id;
        return id;
#else
        return 0;
#endif
    }

    bool WebviewShell::UnbindHotkey(uint32_t modifiers, uint32_t key) {
#ifdef _WIN32
        HWND hwnd = static_cast<HWND>(GetNativeWindow());
        if (!hwnd) return false;
        const uint64_t combo = (static_cast<uint64_t>(modifiers) << 16) | key;
        auto it = m_impl->hotkeyByCombo.find(combo);
        if (it == m_impl->hotkeyByCombo.end()) return false;
        UnregisterHotKey(hwnd, it->second);
        m_impl->hotkeyHandlers.erase(it->second);
        m_impl->hotkeyByCombo.erase(it);
        return true;
#else
        return false;
#endif
    }

    void WebviewShell::DispatchHotkey(int id) {
        auto it = m_impl->hotkeyHandlers.find(id);
        if (it != m_impl->hotkeyHandlers.end() && it->second) {
            it->second();
        }
    }

    void WebviewShell::SetAlwaysOnTop(bool topmost) {
        RunOnUi(*this, [this, topmost]() {
#ifdef _WIN32
            HWND hwnd = (HWND)GetNativeWindow();
            if (!hwnd) return;
            SetWindowPos(hwnd, topmost ? HWND_TOPMOST : HWND_NOTOPMOST,
                0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
#endif
        });
    }

    bool WebviewShell::OpenExternal(const std::string& target, const std::string& args) {
        if (target.empty()) return false;
        // ShellExecuteW 线程安全，无需切 UI 线程。
#ifdef _WIN32
        const std::wstring file = Utf8ToWide(target);
        const std::wstring params = Utf8ToWide(args);
        HINSTANCE r = ShellExecuteW(nullptr, L"open", file.c_str(),
            args.empty() ? nullptr : params.c_str(), nullptr, SW_SHOWNORMAL);
        return reinterpret_cast<INT_PTR>(r) > 32;
#else
        return false;
#endif
    }

    bool WebviewShell::OpenFileExplorer(const std::string& path) {
        if (path.empty()) return false;
#ifdef _WIN32
        std::wstring w = Utf8ToWide(path);
        // 是目录 → 直接打开；是文件 → 用 explorer /select 选中它。
        const DWORD attrs = GetFileAttributesW(w.c_str());
        if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
            HINSTANCE r = ShellExecuteW(nullptr, L"open", w.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            return reinterpret_cast<INT_PTR>(r) > 32;
        }
        const std::wstring sel = L"/select,\"" + w + L"\"";
        HINSTANCE r = ShellExecuteW(nullptr, L"open", L"explorer.exe", sel.c_str(), nullptr, SW_SHOWNORMAL);
        return reinterpret_cast<INT_PTR>(r) > 32;
#else
        return false;
#endif
    }

    std::string WebviewShell::OpenFileDialog() {
#ifdef _WIN32
        // 须在 UI 线程调用：WebView2 的 UI 线程用 COINIT_APARTMENTTHREADED（STA），
        // 正是 Common Item Dialog 要求的公寓模型，可直接弹框。
        HWND hwnd = static_cast<HWND>(GetNativeWindow());

        Microsoft::WRL::ComPtr<IFileOpenDialog> dialog;
        if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_PPV_ARGS(&dialog)))) {
            return {};
        }

        // 只认 .dem：文件类型过滤。
        COMDLG_FILTERSPEC filter = { L"CS2 Demo 文件 (*.dem)", L"*.dem" };
        dialog->SetFileTypes(1, &filter);
        dialog->SetTitle(L"打开 Demo 文件");

        const HRESULT hr = dialog->Show(hwnd);
        if (FAILED(hr)) {
            return {};  // 用户取消（ERROR_CANCELLED）或失败
        }

        Microsoft::WRL::ComPtr<IShellItem> item;
        if (FAILED(dialog->GetResult(&item))) return {};

        PWSTR raw = nullptr;
        if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &raw))) return {};
        std::string path = WideToUtf8(raw);
        CoTaskMemFree(raw);
        return path;
#else
        return {};
#endif
    }

    void WebviewShell::SetDownloadDirectory(const std::string& dir) {
        m_impl->downloadDirectory = dir;
    }

    std::string WebviewShell::DownloadDirectory() const {
        return m_impl->downloadDirectory;
    }

    std::string WebviewShell::TakePendingDownloadPath() {
        std::string p = std::move(m_impl->pendingDownloadPath);
        m_impl->pendingDownloadPath.clear();
        return p;
    }

    void WebviewShell::DownloadFile(const std::string& url, const std::string& savePath) {
        if (url.empty()) return;
        if (!savePath.empty()) m_impl->pendingDownloadPath = savePath;
        // 用隐藏 <a download> 触发下载：不改动当前页面。url 用 JSON 字符串字面量安全注入。
        const std::string js =
            "(function(){"
            "var a=document.createElement('a');"
            "a.href=" + nlohmann::json(url).dump() + ";"
            "a.download='';"
            "a.style.display='none';"
            "document.body.appendChild(a);"
            "a.click();"
            "setTimeout(function(){a.remove();},0);"
            "})();";
        ExecuteJS(js);
        LOG_INFO("Webview", "发起下载: " + url + (savePath.empty() ? std::string() : " -> " + savePath));
    }

    std::string WebviewShell::UploadFile(const std::string& filterSpecs) {
#ifdef _WIN32
        // 与 OpenFileDialog 一致：须在 UI 线程调用（WebView2 的 UI 线程是 STA，
        // 正是 Common Item Dialog 要求的公寓模型）。
        HWND hwnd = static_cast<HWND>(GetNativeWindow());

        Microsoft::WRL::ComPtr<IFileOpenDialog> dialog;
        if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_PPV_ARGS(&dialog)))) {
            return {};
        }

        // 文件类型过滤：filterSpecs 形如 "*.dem;*.zip"（分号分隔，空 = 所有文件）。
        if (!filterSpecs.empty()) {
            const std::wstring wspec = Utf8ToWide(filterSpecs);
            COMDLG_FILTERSPEC spec = { L"选择文件", wspec.c_str() };
            dialog->SetFileTypes(1, &spec);
        }

        dialog->SetTitle(L"选择文件");
        const HRESULT hr = dialog->Show(hwnd);
        if (FAILED(hr)) return {};  // 用户取消（ERROR_CANCELLED）或失败

        Microsoft::WRL::ComPtr<IShellItem> item;
        if (FAILED(dialog->GetResult(&item))) return {};
        PWSTR raw = nullptr;
        if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &raw))) return {};
        const std::string path = WideToUtf8(raw);
        CoTaskMemFree(raw);
        if (path.empty()) return {};

        // 读取文件内容（二进制）。
        std::ifstream in(path, std::ios::binary);
        if (!in) {
            LOG_ERROR("Webview", "上传读取失败: " + path);
            return {};
        }
        std::vector<std::uint8_t> content((std::istreambuf_iterator<char>(in)),
                                          std::istreambuf_iterator<char>());
        if (content.empty()) return {};

        // 文件名（不含目录）。
        const size_t sep = path.find_last_of("\\/");
        const std::string name = (sep == std::string::npos) ? path : path.substr(sep + 1);

        // 推内容给前端：sharedbufferreceived，additionalData 带 type/name/size。
        nlohmann::json meta = { {"type", "file"}, {"name", name}, {"size", content.size()} };
        if (!SendBinaryWithMeta(content.data(), content.size(), meta.dump())) {
            LOG_ERROR("Webview", "上传推送失败: " + name);
            return {};
        }

        // 上传完成通知：经宿主事件回调发布给 IObject（前端订阅 DataChannelChanged + uploadedFile 通道）。
        if (m_impl->hostEventSink) {
            nlohmann::json notify = {
                { "name", name },
                { "size", content.size() },
            };
            m_impl->hostEventSink("fileUploaded", notify.dump());
        }
        LOG_INFO("Webview", "上传完成: " + name + " (" + std::to_string(content.size()) + " bytes)");

        return path;
#else
        return {};
#endif
    }

    bool WebviewShell::AddBrowserExtension(
        const std::filesystem::path& extensionPath,
        BrowserExtensionCallback callback) {
        if (!m_impl->isInitialized || !m_impl->w || !m_impl->browserExtensionsEnabled) {
            if (callback) {
                callback({false, extensionPath, {}, 0,
                          "Browser extensions must be enabled before Initialize"});
            }
            return false;
        }

        if (std::this_thread::get_id() != m_impl->uiThreadId) {
            m_impl->w->dispatch([this, extensionPath, callback]() {
                AddBrowserExtension(extensionPath, callback);
            });
            return true;
        }

        const auto manifestPath = extensionPath / "manifest.json";
        if (!std::filesystem::is_directory(extensionPath) ||
            !std::filesystem::is_regular_file(manifestPath)) {
            if (callback) {
                callback({false, extensionPath, {}, 0,
                          "Extension directory must contain a top-level manifest.json"});
            }
            LOG_ERROR("Webview", "Invalid browser extension directory: " + extensionPath.string());
            return false;
        }

#ifdef _WIN32
        auto controller = static_cast<ICoreWebView2Controller*>(GetNativeController());
        if (!controller) {
            if (callback) callback({false, extensionPath, {}, 0, "ICoreWebView2Controller is unavailable"});
            return false;
        }

        Microsoft::WRL::ComPtr<ICoreWebView2> webview;
        Microsoft::WRL::ComPtr<ICoreWebView2_13> webview13;
        Microsoft::WRL::ComPtr<ICoreWebView2Profile> profile;
        Microsoft::WRL::ComPtr<ICoreWebView2Profile7> profile7;

        HRESULT result = controller->get_CoreWebView2(&webview);
        if (SUCCEEDED(result)) result = webview.As(&webview13);
        if (SUCCEEDED(result)) result = webview13->get_Profile(&profile);
        if (SUCCEEDED(result)) result = profile.As(&profile7);
        if (FAILED(result)) {
            if (callback) {
                callback({false, extensionPath, {}, static_cast<std::int32_t>(result),
                          "WebView2 Runtime does not support the Browser Extensions API"});
            }
            LOG_ERROR("Webview", "Browser Extensions API unavailable, HRESULT=" + std::to_string(static_cast<long>(result)));
            return false;
        }

        const std::wstring absolutePath = std::filesystem::absolute(extensionPath).wstring();
        auto* handler = new BrowserExtensionAddedHandler(extensionPath, callback);
        result = profile7->AddBrowserExtension(absolutePath.c_str(), handler);
        if (FAILED(result)) {
            handler->Release();
            if (callback) {
                callback({false, extensionPath, {}, static_cast<std::int32_t>(result),
                          "AddBrowserExtension request was rejected"});
            }
            LOG_ERROR("Webview", "AddBrowserExtension request failed for " + extensionPath.string() + ", HRESULT=" + std::to_string(static_cast<long>(result)));
            return false;
        }
        return true;
#else
        if (callback) callback({false, extensionPath, {}, 0, "Browser extensions are supported only on Windows/WebView2"});
        return false;
#endif
    }

    void WebviewShell::RunBlocking() {
        if (m_impl->isInitialized && m_impl->w) {
            m_impl->w->run();
            // 关键：在 UI 线程就地销毁 webview。
            // 它的析构里会跑 deplete_run_loop_event_queue()（需要本线程的消息泵），
            // 若留到进程退出在主线程析构，会因为消息窗口线程已死而永久阻塞。
            m_impl->w.reset();
            m_impl->isInitialized = false;
        }
    }

    void WebviewShell::Terminate() {
        if (m_impl->isInitialized && m_impl->w) {
            m_impl->w->terminate();
        }
    }

    void WebviewShell::PostToUiThread(std::function<void()> fn) {
        if (m_impl->isInitialized && m_impl->w && fn) {
            // dispatch 内部是 PostMessageW 到消息窗口，总是在 UI 线程的下一轮消息循环执行
            m_impl->w->dispatch(std::move(fn));
        }
    }

    bool WebviewShell::IsOnUiThread() const {
        return std::this_thread::get_id() == m_impl->uiThreadId;
    }

    void WebviewShell::Navigate(const std::string& url) {
          if (m_impl->isInitialized && m_impl->w) {
            if (std::this_thread::get_id() == m_impl->uiThreadId) {
                m_impl->w->navigate(url);
            } else {
                m_impl->w->dispatch([this, url]() { m_impl->w->navigate(url); });
            }
        }
    }

    void WebviewShell::ExecuteJS(const std::string& js) {
        if (m_impl->isInitialized && m_impl->w) {
            if (std::this_thread::get_id() == m_impl->uiThreadId) {
                m_impl->w->eval(js);
            } else {
                m_impl->w->dispatch([this, js]() { m_impl->w->eval(js); });
            }
        }
    }

    void WebviewShell::SendJson(const std::string& json) {
        if (!m_impl->isInitialized || !m_impl->w) return;

        if (std::this_thread::get_id() != m_impl->uiThreadId) {
            m_impl->w->dispatch([this, json]() { SendJson(json); });
            return;
        }

#ifdef _WIN32
        auto controller = (ICoreWebView2Controller*)GetNativeController();
        if (controller) {
            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) {
                int size_needed = MultiByteToWideChar(CP_UTF8, 0, json.c_str(), (int)json.size(), NULL, 0);
                std::wstring wjson(size_needed, 0);
                MultiByteToWideChar(CP_UTF8, 0, json.c_str(), (int)json.size(), &wjson[0], size_needed);
                wv2->PostWebMessageAsJson(wjson.c_str());
            }
        }
#endif
    }

    void WebviewShell::SetHostEventSink(HostEventSink sink) {
        m_impl->hostEventSink = std::move(sink);
    }

    void WebviewShell::SendString(const std::string& str) {
        if (!m_impl->isInitialized || !m_impl->w) return;

        if (std::this_thread::get_id() != m_impl->uiThreadId) {
            m_impl->w->dispatch([this, str]() { SendString(str); });
            return;
        }

#ifdef _WIN32
        auto controller = (ICoreWebView2Controller*)GetNativeController();
        if (controller) {
            Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
            if (SUCCEEDED(controller->get_CoreWebView2(&wv2))) {
                int size_needed = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), NULL, 0);
                std::wstring wstr(size_needed, 0);
                MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), &wstr[0], size_needed);
                wv2->PostWebMessageAsString(wstr.c_str());
            }
        }
#endif
    }

    bool WebviewShell::EnsureWriteBuffer(size_t size) {
        if (!m_impl->isInitialized || !m_impl->w || size == 0) return false;

        // WebView2 COM 对象必须在 UI 线程访问（STA）。跨线程则 dispatch 并等待结果。
        if (std::this_thread::get_id() != m_impl->uiThreadId) {
            auto promise = std::make_shared<std::promise<bool>>();
            auto future = promise->get_future();
            m_impl->w->dispatch([this, promise, size]() {
                promise->set_value(this->EnsureWriteBuffer(size));
            });
            return future.get();
        }

#ifdef _WIN32
        return EnsureSharedBuffer(m_impl->writeBuffer, size, (ICoreWebView2Controller*)GetNativeController());
#else
        return false;
#endif
    }

    bool WebviewShell::SendWriteBufferAddress(const std::string& meta) {
        if (!m_impl->isInitialized || !m_impl->w) return false;

        // 跨线程才 dispatch，同线程必须立即同步执行（PostSharedBufferToScript 的深坑）
        if (std::this_thread::get_id() != m_impl->uiThreadId) {
            m_impl->w->dispatch([this, meta]() { SendWriteBufferAddress(meta); });
            return true;
        }

#ifdef _WIN32
        return PostBufferToScript(m_impl->writeBuffer.buffer.Get(), meta, (ICoreWebView2Controller*)GetNativeController());
#else
        return false;
#endif
    }

    void* WebviewShell::WriteBufferData() const {
        return m_impl->writeBuffer.memory;
    }

    size_t WebviewShell::WriteBufferSize() const {
        return m_impl->writeBuffer.size;
    }

    bool WebviewShell::PushSharedMemory(const void* data, size_t len) {
        if (!data || len == 0) {
            LOG_ERROR("Webview", "PushSharedMemory: 参数无效");
            return false;
        }
        if (!m_impl->isInitialized || !m_impl->w) {
            LOG_ERROR("Webview", "PushSharedMemory: 未初始化");
            return false;
        }

        if (std::this_thread::get_id() != m_impl->uiThreadId) {
            auto promise = std::make_shared<std::promise<bool>>();
            auto future = promise->get_future();
            m_impl->w->dispatch([this, promise, data, len]() {
                promise->set_value(this->PushSharedMemory(data, len));
            });
            return future.get();
        }

#ifdef _WIN32
        auto controller = (ICoreWebView2Controller*)GetNativeController();
        // 单块共享内存：写入已 posted 的 buffer，不再重复 PostSharedBufferToScript（WebView2 只认第一次推送）。
        if (!EnsureSharedBuffer(m_impl->writeBuffer, len, controller)) {
            LOG_ERROR("Webview", "PushSharedMemory: EnsureSharedBuffer 失败 size=" + std::to_string(len));
            return false;
        }
        memcpy(m_impl->writeBuffer.memory, data, len);
        // 用文本消息通知 JS 读取（而不是再推一次 buffer）
        const std::string msg = "{\"action\":\"SharedMemoryPush\",\"size\":" + std::to_string(len) + "}";
        SendJson(msg);
        LOG_INFO("Webview", "PushSharedMemory: 写入并通知 " + std::to_string(len) + " bytes");
        return true;
#else
        return false;
#endif
    }

    void WebviewShell::SetBinaryReceivedCallback(std::function<void(const void*, size_t)> callback) {
        m_impl->binaryReceivedCallback = std::move(callback);
    }

    void WebviewShell::OnBinaryReceived(const void* data, size_t len) {
        if (m_impl->binaryReceivedCallback) {
            m_impl->binaryReceivedCallback(data, len);
        }
    }

    void WebviewShell::SetWebMessageReceivedCallback(std::function<void(const std::string&, const void*, size_t)> callback) {
        m_impl->webMessageReceivedCallback = std::move(callback);
#ifdef _WIN32
        // 仅注册一次：后续 Set 只换回调，复用同一个 COM 处理器（它转发到 m_impl->webMessageReceivedCallback）。
        if (!m_impl->isInitialized || !m_impl->w || m_impl->webMessageReceivedInstalled) return;

        auto controller = (ICoreWebView2Controller*)GetNativeController();
        if (!controller) return;
        Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
        if (FAILED(controller->get_CoreWebView2(&wv2))) return;

        auto* handler = new WebMessageReceivedHandler(
            [this](const std::string& json, const void* data, size_t len, const std::string& filePath) {
                // 拖放文件：拿到真实绝对路径，回推前端（cpp 侧据此自己读文件）。
                if (!filePath.empty()) {
                    if (m_impl->hostEventSink) {
                        nlohmann::json msg = {
                            { "path", filePath },
                            { "canceled", false },
                        };
                        m_impl->hostEventSink("fileSelected", msg.dump());
                    }
                    return;
                }
                // iobject 上行信令（iobject-init 推 buffer / iobject 读 buffer）单独处理。
                if (HandleIObjectMessage(json)) return;
                if (m_impl->webMessageReceivedCallback) {
                    m_impl->webMessageReceivedCallback(json, data, len);
                }
            });
        if (SUCCEEDED(wv2->add_WebMessageReceived(handler, &m_impl->webMessageReceivedToken))) {
            m_impl->webMessageReceivedInstalled = true;
            handler->Release();  // 本地引用交给 WebView2 持有
        } else {
            handler->Release();  // 注册失败：释放本地引用（计数归零自删）
            LOG_ERROR("Webview", "WebMessageReceived 处理器注册失败（IObject 桥接上行不可用）");
        }
#endif
    }

    bool WebviewShell::SendBinaryWithMeta(const void* data, size_t len, const std::string& meta) {
        if (!data || len == 0) return false;
        if (!m_impl->isInitialized || !m_impl->w) return false;

        if (!IsOnUiThread()) {
            auto promise = std::make_shared<std::promise<bool>>();
            auto future = promise->get_future();
            m_impl->w->dispatch([this, promise, data, len, meta]() {
                promise->set_value(this->SendBinaryWithMeta(data, len, meta));
            });
            return future.get();
        }

#ifdef _WIN32
        auto controller = (ICoreWebView2Controller*)GetNativeController();
        if (!controller) return false;

        Microsoft::WRL::ComPtr<ICoreWebView2> wv2;
        if (FAILED(controller->get_CoreWebView2(&wv2))) return false;
        Microsoft::WRL::ComPtr<ICoreWebView2_2> wv2_2;
        if (FAILED(wv2.As(&wv2_2))) return false;
        Microsoft::WRL::ComPtr<ICoreWebView2Environment> env;
        if (FAILED(wv2_2->get_Environment(&env)) || !env) return false;
        Microsoft::WRL::ComPtr<ICoreWebView2Environment12> env12;
        if (FAILED(env.As(&env12))) return false;

        Microsoft::WRL::ComPtr<ICoreWebView2SharedBuffer> buffer;
        if (FAILED(env12->CreateSharedBuffer(len, &buffer))) return false;
        BYTE* dst = nullptr;
        if (FAILED(buffer->get_Buffer(&dst)) || !dst) return false;
        memcpy(dst, data, len);

        Microsoft::WRL::ComPtr<ICoreWebView2_17> wv2_17;
        if (FAILED(wv2.As(&wv2_17))) return false;

        // additionalData 是 JSON，JS 端据此路由（iobject 帧 / 上传文件帧等）。
        const std::wstring wmeta = Utf8ToWide(meta);
        return SUCCEEDED(wv2_17->PostSharedBufferToScript(
            buffer.Get(), COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY, wmeta.c_str()));
#else
        return false;
#endif
    }

    bool WebviewShell::EnsureIObjectBuffers() {
#ifdef _WIN32
        constexpr size_t kSize = 4 * 1024 * 1024;  // 上下行各 4MB，预分配复用
        auto controller = (ICoreWebView2Controller*)GetNativeController();
        if (!controller) return false;
        if (!EnsureSharedBuffer(m_impl->downlinkBuffer, kSize, controller)) return false;
        if (!EnsureSharedBuffer(m_impl->uplinkBuffer, kSize, controller)) return false;
        return true;
#else
        return false;
#endif
    }

    bool WebviewShell::SendIObjectBufferAddresses() {
        if (!m_impl->isInitialized || !m_impl->w) return false;
        if (!IsOnUiThread()) {
            m_impl->w->dispatch([this]() { SendIObjectBufferAddresses(); });
            return true;
        }
#ifdef _WIN32
        if (!EnsureIObjectBuffers()) return false;
        auto controller = (ICoreWebView2Controller*)GetNativeController();
        if (!controller) return false;
        // 只推上行（READ_WRITE）：JS 写 → C++ 读。下行已改为每次 PostSharedBufferToScript。
        return PostBufferToScript(m_impl->uplinkBuffer.buffer.Get(), "{\"type\":\"iobject-uplink\"}", controller);
#else
        return false;
#endif
    }

    const void* WebviewShell::UplinkData() const {
        return m_impl->uplinkBuffer.memory;
    }

    bool WebviewShell::SendBinary(const void* data, size_t len) {
        // 下行：每次 PostSharedBufferToScript 推一块新共享 buffer，additionalData.type="iobject"。
        // iobject-js 的 webviewSocket 只认 chrome.webview 'sharedbufferreceived' 事件 + 该 type 标记，
        // 不能走「预分配 buffer + 文本通知」——那套协议 JS 端不消费，invoke 会一直超时。
        return SendBinaryWithMeta(data, len, "{\"type\":\"iobject\"}");
    }

    bool WebviewShell::HandleIObjectMessage(const std::string& json) {
        // 快速预判：iobject 信令一定含 "iobject"；其余直接放行。
        if (json.find("\"iobject") == std::string::npos) return false;
        try {
            auto msg = nlohmann::json::parse(json);
            if (!msg.is_object()) return false;
            const std::string type = msg.value("type", "");

            if (type == "iobject-init") {
                // 前端请求推上行 READ_WRITE buffer（iobject-uplink），据此写入 msgpack 帧。
                SendIObjectBufferAddresses();
                return true;
            }
            if (type == "iobject") {
                // 前端已把一帧写入上行 buffer，通知 C++ 读 offset/len 字节。
                const size_t offset = msg.value("offset", 0);
                const size_t len = msg.value("len", 0);
#ifdef _WIN32
                if (len > 0 && m_impl->uplinkBuffer.memory &&
                    offset + len <= m_impl->uplinkBuffer.size) {
                    const void* data = static_cast<const std::uint8_t*>(m_impl->uplinkBuffer.memory) + offset;
                    if (m_impl->webMessageReceivedCallback) {
                        m_impl->webMessageReceivedCallback(json, data, len);
                    }
                }
#endif
                return true;
            }
        } catch (...) {
            return false;
        }
        return false;
    }

}
}