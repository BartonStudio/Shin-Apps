#pragma once

#include <memory>
#include <string>

namespace iobject { class IRuntimeObject; }
namespace shin::host { class WebviewBridge; }

namespace demoviewer {

/// DemoViewer 的宿主侧装配：纯代码（不再有 app.json / RunApp）。
/// 流程 = 配域 → WebviewHost::Create → 挂 Webview 节点 → 建 WebviewBridge → WebviewHost::Run。
class DemoApp {
public:
    // 构造/析构都在 .cpp 定义：本类持有 unique_ptr<WebviewBridge>，头文件只前向声明了它，
    // 若在此 = default，编译器会在包含本头文件的每个 TU 里生成 unique_ptr 析构，届时类型不完整。
    DemoApp();
    ~DemoApp();

    DemoApp(const DemoApp&) = delete;
    DemoApp& operator=(const DemoApp&) = delete;

    /// demoPath：命令行传入的 .dem 路径（空 = 用默认测试路径）。
    /// 有路径时启动即后台装载，装载完成把契约数据块推给前端（无需前端交互）。
    int Run(const std::string& demoPath = {});

private:
    void Start();                                  // 建 WebviewBridge（内进程桥接，无端口）
    void StartContractFeed(const std::string& demoPath);  // 后台装载 demo → 推契约数据块
    void Stop();                                   // 先关桥接会话，再销毁业务节点（幂等）
    static iobject::IRuntimeObject* MakeRoot();

    iobject::IRuntimeObject* webview_ = nullptr;   // WebviewHost 节点（Connect 到根，观察指针）
    std::unique_ptr<shin::host::WebviewBridge> webviewBridge_;
    bool stopped_ = false;
};

} // namespace demoviewer
