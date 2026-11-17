// DemoViewer 程序入口：装配全在 DemoApp::Run 里（纯代码，无 app.json / RunApp）。
// 用法：ShinDemoViewer.exe [demo.dem] —— 传路径则启动即自动装载 + 推契约数据。

#include "DemoApp.hpp"

int main(int argc, char** argv) {
    demoviewer::DemoApp app;
    return app.Run(argc > 1 ? argv[1] : std::string{});
}
