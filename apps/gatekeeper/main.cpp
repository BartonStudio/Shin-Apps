// 方案的 C++ 程序入口。
//
// 与 apps/inspector/main.cpp 同形：装配流程（读清单 → 建窗口 → 配域 → 跑事件循环）
// 全在 shin::host::RunApp 里，方案只提供自己的钩子。
// 清单 app.json 由 shin_add_app() 复制到 exe 旁边，宿主按
// <exeDir>/apps/<SHIN_APP_NAME>/app.json 查找 —— 所以这里必须声明真实方案名。

#include <HostMain.hpp>

#include "GatekeeperApp.hpp"

#ifndef SHIN_APP_NAME
#error "SHIN_APP_NAME 未定义 —— 方案的可执行文件应由 shin_add_app() 生成（见 platform/cmake/ShinApp.cmake）"
#endif

int main(int argc, char* argv[]) {
    gatekeeper::GatekeeperApp   app;
    return shin::host::RunApp(argc, argv, SHIN_APP_NAME, app.Hooks());
}
