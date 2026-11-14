# ---------------------------------------------------------------------------
# platform/host —— 所有方案共用的宿主壳（C++）
#
# 归属判据（docs/workspace-layout-plan.md §1）：这里删掉任何一段，
# 两个方案会各自抄一份吗？会 —— 窗口/DPI/消息泵、运行时域、清单解析、
# 装配流程 —— 所以它们在平台里。
#
# 方案通过 `<WebviewHost.hpp>` / `<RuntimeHost.hpp>` / `<HostUtil.hpp>` 引入
# （本目录是 PUBLIC include）。
# ---------------------------------------------------------------------------
add_library(shin_host STATIC
    WebviewShell.cpp
    WebviewHost.cpp
    RuntimeHost.cpp
    WebviewBridge.cpp
)

target_include_directories(shin_host
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}
    PRIVATE ${MSWebView2_ROOT}/include
)

target_compile_features(shin_host PUBLIC cxx_std_20)
if(MSVC)
    target_compile_options(shin_host PRIVATE /utf-8)
endif()

target_link_libraries(shin_host PUBLIC
    webview::core_static
    nlohmann_json::nlohmann_json
    IObject::IObject
)

set_target_properties(shin_host PROPERTIES FOLDER "Platform")
