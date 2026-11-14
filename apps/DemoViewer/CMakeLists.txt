# DemoViewer —— 「加一个方案」需要写的全部 CMake（不再读 app.json）。
add_subdirectory(native)

shin_add_app(demoviewer NATIVE_TARGET shin_app_demoviewer EXE_NAME ShinDemoViewer)
