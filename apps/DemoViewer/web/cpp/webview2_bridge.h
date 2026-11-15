// ============================================================================
// webview2_bridge.h —— WebView2 共享内存通道 + 回合消息
// ============================================================================
//
// 负责三件事：
//   1. 创建共享内存（CoreWebView2Environment::CreateSharedBuffer）
//   2. 把它交给页面（PostSharedBufferToScript）→ JS 收 sharedbufferreceived
//   3. 发回合水位消息（PostWebMessageAsString）→ JS 收 message
//
// ── ⚠️ 这个文件没有在本机编译验证 ────────────────────────────────────────────
//
//   本机没有安装 WebView2 SDK（找不到 <WebView2.h>），所以只用一份**接口声明桩**
//   做了语法检查，没有拿真实 SDK 编过。
//
//   你接入时**必须**先确认：
//     · 你的 SDK 版本里是否存在 ICoreWebView2Environment12 / ICoreWebView2_17
//       （CreateSharedBuffer 与 PostSharedBufferToScript 所需的接口）
//     · COREWEBVIEW2_SHARED_BUFFER_ACCESS 的枚举名
//     · sharedbufferreceived 事件的 additionalData 传参方式
//   接口名以你手上的 WebView2.h 为准，若有出入按 SDK 调整本文件。
//
// ── 进程分工 ───────────────────────────────────────────────────────────────
//
//   主进程（宿主）
//     · create()            → 申请共享内存并映射（拿 base 指针）
//     · duplicateForChild() → 把 mapping 句柄复制给解析子进程
//     · postToScript()      → 交给页面（页面只读）
//     · postRoundMessage()  → 每回合发水位
//
//   解析子进程
//     · mapInChild()        → 用句柄映射出 base
//     · csdemo::writeSharedBuffer(base, bytes, data, version)   ← 见 shared_writer.h
//     · 通过你自己的 IPC 通知主进程"回合 N 好了"
//
//   ⚠️ **只能有一个写者**。主进程如果也 MapViewOfFile 并写，就会和子进程竞争。
//      推荐：主进程只创建+传句柄，不写；子进程独占写入。
//
// ── 同步模型 ───────────────────────────────────────────────────────────────
//
//   WebView2 给 JS 的是普通 ArrayBuffer（不是 SharedArrayBuffer），所以：
//     · 零拷贝读 ✅
//     · Atomics 不可用 ❌ → 不能做原子锁
//     · 但也不需要锁：数据是 append-only，C++ 写尾部、JS 读头部，天然分区
//   水位一律由 postRoundMessage 携带（消息投递是 happens-before 边界）。
//
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>

#if __has_include(<WebView2.h>)
#    define CSDEMO_HAS_WEBVIEW2 1

#    include <Windows.h>
#    include <WebView2.h>
#    include <wrl/client.h>

namespace csdemo::webview2 {

inline constexpr bool kSdkAvailable = true;

using Microsoft::WRL::ComPtr;

/// 页面侧对共享内存的访问权限
enum class Access {
    ReadOnly,    ///< 页面只读（推荐 —— JS 侧不应写）
    ReadWrite,   ///< 页面可写（一般不用）
};

/// 一块共享内存的宿主侧句柄 + 映射
class SharedBuffer {
public:
    SharedBuffer() = default;
    ~SharedBuffer() { release(); }

    SharedBuffer(const SharedBuffer&) = delete;
    SharedBuffer& operator=(const SharedBuffer&) = delete;
    SharedBuffer(SharedBuffer&& o) noexcept { swap(o); }
    SharedBuffer& operator=(SharedBuffer&& o) noexcept {
        if (this != &o) { release(); swap(o); }
        return *this;
    }

    bool valid() const { return buffer_ != nullptr; }
    /// 底层 COM 对象（postToScript 用）
    ICoreWebView2SharedBuffer* bufferPtr() const { return buffer_.Get(); }
    void* base() const { return base_; }
    std::size_t bytes() const { return bytes_; }
    HANDLE mappingHandle() const { return mapping_; }

    /// 申请一块共享内存并映射到本进程地址空间
    /// @return S_OK 成功；失败时 *this 保持 invalid
    HRESULT create(ICoreWebView2Environment* env, std::size_t bytes);

    /// 用已有的 mapping 句柄映射（子进程用）
    bool mapFromHandle(HANDLE mapping, std::size_t bytes);

    /// 把 mapping 句柄复制给目标进程（子进程继承或 DuplicateHandle 两种方式都行）
    bool duplicateForChild(HANDLE targetProcess, bool inheritHandle, HANDLE* out) const;

    /// 解除映射并释放 COM 对象
    void release();

private:
    void swap(SharedBuffer& o) noexcept;

    ComPtr<ICoreWebView2SharedBuffer> buffer_;
    HANDLE mapping_ = nullptr;   // 来自 get_FileMappingHandle，由 COM 对象持有，不要 CloseHandle
    void* base_ = nullptr;       // MapViewOfFile 的返回值，需要 UnmapViewOfFile
    std::size_t bytes_ = 0;
};

/// 把共享内存交给页面 —— JS 侧触发 sharedbufferreceived
/// @param additionalJson  附加数据（原样出现在 event.additionalData），可传 nullptr
HRESULT postToScript(ICoreWebView2* webview, SharedBuffer& buf, Access access,
                     const wchar_t* additionalJson);

/// 发回合水位消息 —— JS 侧触发 message（JSON 字符串）
///
/// 水位为什么放在消息里而不是让 JS 读共享内存头：
///   WebView2 给的是普通 ArrayBuffer，跨进程的普通内存读没有内存序保证，
///   而 Atomics 不可用补不了。消息投递本身构成 happens-before 边界。
///
/// @return S_OK 成功
HRESULT postRoundMessage(ICoreWebView2* webview,
                         std::uint32_t version,
                         std::uint32_t loadedRounds,
                         std::uint32_t visibleFrames,
                         std::uint32_t panelVisibleFrames,
                         double durationSeconds);

/// 发一条纯文本消息（错误上报等）
HRESULT postText(ICoreWebView2* webview, const wchar_t* json);

}  // namespace csdemo::webview2

#else  // 没有 WebView2 SDK

namespace csdemo::webview2 {
inline constexpr bool kSdkAvailable = false;
}  // namespace csdemo::webview2

#endif  // __has_include(<WebView2.h>)
