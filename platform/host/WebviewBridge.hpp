#pragma once

#include <iobject/RuntimeBridgeProtocol.hpp>

#include <memory>

namespace shin::host {

/// WebView2 内进程桥接：把「前端 iobject-js」与「本进程对象树」直接连起来，
/// 不再起 WebSocket 服务端、不占端口。传输载体是 WebView2 原生共享内存二进制通道：
///   上行（JS→C++）：window.chrome.webview.postMessage({type:"iobject"}, [msgpack 帧 ArrayBuffer])
///   下行（C++→JS）：PostSharedBufferToScript（JS 端 chrome.webview 'sharedbufferreceived' 事件）
///
/// 协议适配器复用 iobject::RuntimeBridgePeer —— 与 WebSocketServer 走的是同一套 MessagePack
/// 协议，只是把「网络套接字」换成「进程内 WebView 消息通道」。域名仍取自本进程运行时域
/// （shin::host::Domain() 的 Name()），前端 Connect 时填的名字不变。
///
/// 线程模型：与 WebSocketServer 一致。构造/析构/收帧都发生在宿主 UI 线程 ——
/// WebviewHost::Run() 已把 IObject 事件循环挂到 WebView2 消息泵上，收发无需跨线程。
class WebviewBridge {
public:
    /// 构造即接管本进程运行时域的桥接入口，并注册上行消息回调。
    /// 必须在 WebviewHost::Create 之后（webview 已 Initialize）调用。
    explicit WebviewBridge();
    ~WebviewBridge();

    WebviewBridge(const WebviewBridge&) = delete;
    WebviewBridge& operator=(const WebviewBridge&) = delete;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace shin::host
