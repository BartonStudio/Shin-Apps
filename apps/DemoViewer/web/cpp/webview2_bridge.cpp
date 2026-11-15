// ============================================================================
// webview2_bridge.cpp —— WebView2 共享内存通道实现
// ============================================================================
// ⚠️ 本机无 WebView2 SDK，此文件只用**接口声明桩**做过语法检查。
//    真实 SDK 的接口名/枚举名请按你手上的 <WebView2.h> 核对（见头文件说明）。
// ============================================================================
#include "webview2_bridge.h"

#if CSDEMO_HAS_WEBVIEW2

#include <cstdio>
#include <cstring>
#include <string>

namespace csdemo::webview2 {
namespace {

constexpr const wchar_t* kClsidSharedBuffer = nullptr;   // 占位：真实实现用 QueryInterface 取接口

COREWEBVIEW2_SHARED_BUFFER_ACCESS toAccess(Access a) {
    return a == Access::ReadOnly ? COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY
                                 : COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE;
}

/// 把 double 序列化成 JSON 数字（%.17g 足够 double 精确 round-trip）
void appendDouble(std::wstring& out, double v) {
    char b[40];
    std::snprintf(b, sizeof b, "%.17g", v);
    for (const char* p = b; *p; ++p) out.push_back(static_cast<wchar_t>(*p));
}
void appendUInt(std::wstring& out, std::uint32_t v) {
    char b[24];
    std::snprintf(b, sizeof b, "%u", v);
    for (const char* p = b; *p; ++p) out.push_back(static_cast<wchar_t>(*p));
}

}  // namespace

// ════════════════════════════════════════════════════════════════════════════
// SharedBuffer
// ════════════════════════════════════════════════════════════════════════════
void SharedBuffer::swap(SharedBuffer& o) noexcept {
    buffer_.Swap(o.buffer_);
    std::swap(mapping_, o.mapping_);
    std::swap(base_, o.base_);
    std::swap(bytes_, o.bytes_);
}

void SharedBuffer::release() {
    if (base_) {
        ::UnmapViewOfFile(base_);
        base_ = nullptr;
    }
    // mapping_ 由 ICoreWebView2SharedBuffer 持有，不要 CloseHandle
    mapping_ = nullptr;
    buffer_.Reset();
    bytes_ = 0;
}

HRESULT SharedBuffer::create(ICoreWebView2Environment* env, std::size_t bytes) {
    release();
    if (!env || bytes == 0) return E_INVALIDARG;

    // CreateSharedBuffer 在 ICoreWebView2Environment12 上。
    // 用 QueryInterface 取，避免 SDK 版本差异导致编译不过。
    ComPtr<ICoreWebView2Environment12> env12;
    HRESULT hr = env->QueryInterface(IID_PPV_ARGS(&env12));
    if (FAILED(hr) || !env12) return E_NOINTERFACE;   // 说明 WebView2 Runtime 太旧

    hr = env12->CreateSharedBuffer(static_cast<UINT64>(bytes), &buffer_);
    if (FAILED(hr) || !buffer_) return hr;

    hr = buffer_->get_FileMappingHandle(&mapping_);
    if (FAILED(hr) || !mapping_) return hr;

    // 宿主侧也要写（子进程或本进程），所以自己映射一份
    base_ = ::MapViewOfFile(mapping_, FILE_MAP_ALL_ACCESS, 0, 0, bytes);
    if (!base_) {
        hr = HRESULT_FROM_WIN32(::GetLastError());
        release();
        return hr;
    }
    bytes_ = bytes;
    return S_OK;
}

bool SharedBuffer::mapFromHandle(HANDLE mapping, std::size_t bytes) {
    release();
    if (!mapping || bytes == 0) return false;
    base_ = ::MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, bytes);
    if (!base_) return false;
    mapping_ = mapping;   // 只借用，不拥有
    bytes_ = bytes;
    return true;
}

bool SharedBuffer::duplicateForChild(HANDLE targetProcess, bool inheritHandle, HANDLE* out) const {
    if (!mapping_ || !out) return false;
    if (inheritHandle) {
        // 简单场景：让子进程直接继承（CreateProcess 时 bInheritHandles=TRUE）
        *out = mapping_;
        return true;
    }
    if (!targetProcess) return false;
    HANDLE dup = nullptr;
    if (!::DuplicateHandle(::GetCurrentProcess(), mapping_, targetProcess, &dup, 0, FALSE,
                           DUPLICATE_SAME_ACCESS)) {
        return false;
    }
    *out = dup;
    return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 发消息
// ════════════════════════════════════════════════════════════════════════════
HRESULT postToScript(ICoreWebView2* webview, SharedBuffer& buf, Access access,
                     const wchar_t* additionalJson) {
    if (!webview || !buf.valid()) return E_INVALIDARG;

    // PostSharedBufferToScript 在 ICoreWebView2_17 上
    ComPtr<ICoreWebView2_17> wv17;
    HRESULT hr = webview->QueryInterface(IID_PPV_ARGS(&wv17));
    if (FAILED(hr) || !wv17) return E_NOINTERFACE;

    return wv17->PostSharedBufferToScript(
        buf.bufferPtr(), toAccess(access), additionalJson ? additionalJson : L"null");
}

HRESULT postRoundMessage(ICoreWebView2* webview,
                         std::uint32_t version,
                         std::uint32_t loadedRounds,
                         std::uint32_t visibleFrames,
                         std::uint32_t panelVisibleFrames,
                         double durationSeconds) {
    if (!webview) return E_INVALIDARG;

    std::wstring json;
    json.reserve(160);
    json += L"{\"version\":";
    appendUInt(json, version);
    json += L",\"loadedRounds\":";
    appendUInt(json, loadedRounds);
    json += L",\"visibleFrames\":";
    appendUInt(json, visibleFrames);
    json += L",\"panelVisibleFrames\":";
    appendUInt(json, panelVisibleFrames);
    json += L",\"durationSeconds\":";
    appendDouble(json, durationSeconds);
    json += L"}";

    return webview->PostWebMessageAsString(json.c_str());
}

HRESULT postText(ICoreWebView2* webview, const wchar_t* json) {
    if (!webview || !json) return E_INVALIDARG;
    return webview->PostWebMessageAsString(json);
}

}  // namespace csdemo::webview2

#endif  // CSDEMO_HAS_WEBVIEW2
