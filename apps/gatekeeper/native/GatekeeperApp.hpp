#pragma once

#include <HostMain.hpp>

#include <memory>
#include <string>
#include <vector>

namespace iobject { class IRuntimeObject; class WebSocketServer; }

namespace gatekeeper {

/// 本方案（ShinGatekeeper）的宿主侧装配。
///
/// 它只负责"这个方案比平台多出来什么"：
///   · 域根是一个只带 Logger 的节点（GatekeeperRoot）；
///   · 启动时把 GateObject 挂成 root 的子节点 `Gate`，并起一个内置 WS 服务端。
/// 窗口 / DPI / 清单 / 事件循环都在 shin::host（platform/host/）里。
///
/// 与 inspector 的差别：**服务端无条件启动**。inspector 是"连别人"的调试器，内置
/// 服务端只在 --demo 时才起；gatekeeper 是"被自己前端连"的应用，没有服务端就什么都做不了。
class GatekeeperApp {
public:
    // 构造/析构都在 .cpp 里定义：本类持有 unique_ptr<WebSocketServer>，而头文件
    // 只前向声明了它 —— 若在这里 = default，编译器会在每个包含本头文件的 TU 里
    // 生成 unique_ptr 的析构调用，那时类型还不完整（C2027 / C2338）。
    GatekeeperApp();
    ~GatekeeperApp();

    GatekeeperApp(const GatekeeperApp&) = delete;
    GatekeeperApp& operator=(const GatekeeperApp&) = delete;

    /// 交给 shin::host::RunApp 的钩子集合。
    shin::host::AppHooks Hooks();

private:
    /// 域根。平台不认识这个类型，只通过 DomainSpec::makeRoot 拿到它。
    static iobject::IRuntimeObject* MakeRoot();

    /// 窗口与域都就绪之后调用：挂 Gate 节点 + 起内置 WS 服务端。
    void Start();

    /// 事件循环退出之后调用：先关服务端（断开全部远程会话），再销毁业务对象。
    /// 幂等 —— 析构也会调它一次以兜住异常路径。
    void Stop();

    /// Gate 节点。所有权在**域**里（它 Connect 到了 root 的子树上），
    /// 所以这里只是一个观察指针：Stop() 里 delete，之后置空，绝不重复删除。
    iobject::IRuntimeObject* gate_ = nullptr;

    std::unique_ptr<iobject::WebSocketServer> wsServer_;
    bool stopped_ = false;
};

} // namespace gatekeeper
