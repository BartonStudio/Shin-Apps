#include "WebviewBridge.hpp"

#include "RuntimeHost.hpp"   // Domain() / LOG_*
#include "WebviewShell.hpp"

#include <iobject/RuntimeBridge.hpp>

#include <cstdint>

namespace shin::host {

struct WebviewBridge::Impl {
    std::unique_ptr<iobject::RuntimeBridgePeer> peer;

    // 下行发送：把 MessagePack 帧字节经共享内存推给 JS。
    static void Send(iobject::ByteView frame) {
        if (frame.empty()) {
            return;
        }
        if (!WebviewShell::GetInstance().SendBinary(frame.data(), frame.size())) {
            LOG_ERROR("WebviewBridge", "下行帧发送失败（size=" + std::to_string(frame.size()) + "）");
        }
    }
};

WebviewBridge::WebviewBridge() : impl_(std::make_unique<Impl>()) {
    auto& shell = WebviewShell::GetInstance();

    // 下行：RuntimeBridgePeer 的 SendCallback 直接把帧推给 JS（sharedbufferreceived）。
    auto& domain = Domain();
    impl_->peer = std::make_unique<iobject::RuntimeBridgePeer>(
        domain.BridgeRoot(), domain.Name(), &Impl::Send);

    // 上行：JS postMessage(json, [bytes]) → 二进制喂给 RuntimeBridgePeer。
    shell.SetWebMessageReceivedCallback(
        [this](const std::string&, const void* data, size_t len) {
            if (impl_->peer && data && len > 0) {
                impl_->peer->ReceiveMessage(iobject::ByteView(
                    static_cast<const std::uint8_t*>(data), len));
            }
        });
}

WebviewBridge::~WebviewBridge() {
    // 先清掉上行回调（避免 webview 还活着时回调到已析构的 this），再关会话。
    WebviewShell::GetInstance().SetWebMessageReceivedCallback({});
    if (impl_->peer) {
        impl_->peer->Close();
    }
}

} // namespace shin::host
