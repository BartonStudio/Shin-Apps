cmake_minimum_required(VERSION 3.20)
project(ShinApps VERSION 0.1.0 LANGUAGES CXX)

# ---------------------------------------------------------------------------
# Release 加固（MSVC）
#   · /O2 是 MSVC Release 默认优化级别（CMAKE_CXX_FLAGS_RELEASE 已含 /O2 /Ob2），无需显式。
#   · /GL + /LTCG（链接时代码生成）：跨翻译单元内联，既提速也增大反汇编的阅读难度。
#   · PDB：CMake 的 MSVC Release flags 不含 /Zi /DEBUG，默认就不生成调试符号；
#     发布时确保不把任何 .pdb 随 exe 一起分发即可。
# ---------------------------------------------------------------------------
if(MSVC)
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE ON)
endif()

# 统一输出目录：exe 与 dll 同目录，便于运行时加载；静态库单独放 lib/
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")

set_property(GLOBAL PROPERTY USE_FOLDERS ON)

# ---------------------------------------------------------------------------
# 第三方
# ---------------------------------------------------------------------------
# IObject —— 运行时对象模型静态库（C++20）
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(third_party/IObject)

# WebView2 SDK（仅本地头文件，供 platform/host 编译）
set(MSWebView2_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/third_party/WebView2" CACHE PATH "WebView2 SDK root" FORCE)

# webview 库（vendored，github.com/webview/webview，只构建静态库）
set(WEBVIEW_BUILD_SHARED_LIBRARY OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_STATIC_LIBRARY ON CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(WEBVIEW_BUILD_AMALGAMATION OFF CACHE BOOL "" FORCE)
set(WEBVIEW_INSTALL_TARGETS OFF CACHE BOOL "" FORCE)
set(WEBVIEW_ENABLE_PACKAGING OFF CACHE BOOL "" FORCE)
set(WEBVIEW_USE_COMPAT_MINGW OFF CACHE BOOL "" FORCE)
add_subdirectory(third_party/webview)

# nlohmann/json（vendored，仅头文件）
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
add_subdirectory(third_party/json)

# ---------------------------------------------------------------------------
# platform —— 所有方案共用的底座（宿主壳 + 桥接 + 连接基础设施）
#
# 归属判据（docs/workspace-layout-plan.md §1）：删掉这段，两个方案会各抄一份吗？
# 会 → platform；不会 → apps/<name>/。
#
# 顺序有依赖：apps/ 里的方案要调用 shin_add_app()，并链接 shin_host。
# ---------------------------------------------------------------------------
include(platform/cmake/ShinApp.cmake)
add_subdirectory(platform/host)

# ---------------------------------------------------------------------------
# apps —— 一个方案一个目录，彼此互不可见
# ---------------------------------------------------------------------------
add_subdirectory(apps/DemoViewer)

