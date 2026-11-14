// DemoViewer 程序入口：装配全在 DemoApp::Run 里（纯代码，无 app.json / RunApp）。

#include "DemoApp.hpp"

int main() {
    demoviewer::DemoApp app;
    return app.Run();
}
