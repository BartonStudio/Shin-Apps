# ---------------------------------------------------------------------------
# gatekeeper —— 门禁远程控制应用（apps/gatekeeper）的宿主侧原生部分
#
# 两个目标，刻意分开：
#
#   gatekeeper_native   纯业务对象 GateObject：状态镜像 + 命令中转，**零三方依赖**
#                       （只 include <iobject/...>，不碰 webview / json / 网络库）。
#                       单独成型是为了让它能被独立编译与单测（§11 的 GateObject 单测
#                       不需要把 WebView2 拖进来）。
#
#   shin_app_gatekeeper 装配层 GatekeeperApp：把 GateObject 挂到域根上、起 WS 服务端。
#                       这层要认识平台（shin_host），所以不能混进上面那个目标。
#
# 界面（ui/）与 app.json 由上一层 apps/gatekeeper/CMakeLists.txt 经 shin_add_app() 接入。
# 设计见 docs/gatekeeper-app-plan.md §9。
# ---------------------------------------------------------------------------
add_library(gatekeeper_native STATIC
    GateObject.cpp
)
target_include_directories(gatekeeper_native PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(gatekeeper_native PUBLIC cxx_std_20)
if(MSVC)
    target_compile_options(gatekeeper_native PRIVATE /utf-8)
endif()
target_link_libraries(gatekeeper_native PUBLIC IObject::IObject)
set_target_properties(gatekeeper_native PROPERTIES FOLDER "Apps/gatekeeper")


add_library(shin_app_gatekeeper STATIC
    GatekeeperApp.cpp
)
target_include_directories(shin_app_gatekeeper PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(shin_app_gatekeeper PUBLIC cxx_std_20)
if(MSVC)
    target_compile_options(shin_app_gatekeeper PRIVATE /utf-8)
endif()
# PUBLIC 而非 PRIVATE：GateObject 是本方案的组成部分，跟着一起链进 exe。
target_link_libraries(shin_app_gatekeeper PUBLIC shin_host gatekeeper_native)
set_target_properties(shin_app_gatekeeper PROPERTIES FOLDER "Apps/gatekeeper")
