cmake_minimum_required(VERSION 3.20)

# ════════════════════════════════════════════════════════════════════════════
# csdemo C++ 接口层
# ════════════════════════════════════════════════════════════════════════════
#
# 这个工程**不含 demo 解析器** —— 只有「C++ 解析出的数据怎么交给 WebView2 前端」
# 所需的契约、共享内存布局、写入/读取、以及通道封装。
# 详见 ../docs/08-cpp-integration.md 与 README.md
#
# 在 Visual Studio 里：
#   File → Open → Folder…  选这个 cpp/ 目录，VS 会自动读本文件
#   或者 CMakePresets.json 的两个预设任选其一（按你的 VS 版本）
#
# 命令行：
#   cmake -S . -B out/build -G "Visual Studio 16 2019" -A x64
#   cmake --build out/build --config Release
#   ctest --test-dir out/build -C Release --output-on-failure
#
# ════════════════════════════════════════════════════════════════════════════

project(csdemo_cpp
    VERSION 1.0.0
    DESCRIPTION "csdemo.tv CS2 demo 播放器 —— 原生 C++ 与 WebView2 的对接层"
    LANGUAGES CXX)

# ── 全局设置 ────────────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_CONFIGURATION_TYPES AND NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "构建类型" FORCE)
endif()

# 可执行文件统一落到 out/bin/<Config>/，避免 VS 默认的 Debug/Release 分散
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
foreach(cfg IN ITEMS DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${cfg} "${CMAKE_BINARY_DIR}/bin/$<LOWER_CASE:${cfg}>")
endforeach()

# ── 编译选项 ────────────────────────────────────────────────────────────────
#
# ⚠️ MSVC 必须加 /utf-8
#    源文件里有大量中文注释。不加这个，MSVC 会按本地代码页（中文 Windows 是 GBK）
#    解释 UTF-8 字节，报出「常量中有换行符」这种与真实原因无关的错误。
#    已实测踩过一次，所以写进 CMake 而不是靠人记得加。
#
if(MSVC)
    add_compile_options(
        /utf-8        # 源文件与执行字符集都按 UTF-8  ← 必须
        /W4           # 高警告等级（本工程在 /W4 下零警告）
        /permissive-  # 标准一致性
    )
    # 只在多配置生成器（VS）下追加，单配置时 CMAKE_BUILD_TYPE 已经管了
    add_compile_options($<$<CONFIG:Release>:/O2>)
else()
    add_compile_options(-Wall -Wextra -Wpedantic)
    add_compile_options($<$<CONFIG:Release>:-O2>)
endif()

# ── 路径 ────────────────────────────────────────────────────────────────────
# 仓库根 = 本 CMakeLists 所在目录的上一级（本文件在 cpp/ 里）
get_filename_component(CSDEMO_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)

set(CSDEMO_GOLDEN_TSV "${CSDEMO_REPO_ROOT}/docs/shared-layout.golden.tsv")
# 测试产物落到仓库的 tmp/，与 README 里记录的命令保持一致
set(CSDEMO_TMP_DIR "${CSDEMO_REPO_ROOT}/tmp")
file(MAKE_DIRECTORY "${CSDEMO_TMP_DIR}")

# ── 选项 ────────────────────────────────────────────────────────────────────
option(CSDEMO_BUILD_TESTS "构建测试可执行文件" ON)
option(CSDEMO_WITH_NODE_TESTS "把 JS / 跨语言 / 端到端测试也注册进 ctest（需要 node）" ON)

# demo 文件路径。**没有默认值** —— 设了这个，需要 demo 的 node 测试才会真正跑，
# 否则它们以退出码 2 结束、被 ctest 记成 SKIPPED。
set(CSDEMO_DEM_FILE "" CACHE FILEPATH "demo 文件路径（例如 D:/demos/match.dem）")

# ════════════════════════════════════════════════════════════════════════════
# 核心静态库
# ════════════════════════════════════════════════════════════════════════════
#
# 你的解析器只要产出 DemoData，就可以：
#     target_link_libraries(your_parser PRIVATE csdemo::core)
#
add_library(csdemo_core STATIC
    shared_layout.cpp
    shared_writer.cpp
    shared_reader.cpp
)
add_library(csdemo::core ALIAS csdemo_core)

target_include_directories(csdemo_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")

# 头文件（不参与编译，只是让它们在 VS 解决方案里可见/可搜索）
target_sources(csdemo_core PUBLIC
    demo_data.h
    cpp_paths.h
    mini_json.h
    shared_layout.h
    shared_writer.h
    shared_reader.h
)

# ════════════════════════════════════════════════════════════════════════════
# WebView2 通道（可选 —— 找不到 SDK 就跳过）
# ════════════════════════════════════════════════════════════════════════════
#
# ⚠️ 这一段**没有在开发机上验证过**（当时无 WebView2 SDK）。
#    期望的接入方式：NuGet 装 Microsoft.Web.WebView2，
#    必要时手动指定：
#      cmake -S . -B out/build -DWEBVIEW2_INCLUDE_DIR=... -DWEBVIEW2_LOADER_LIB=...
#
option(CSDEMO_BUILD_WEBVIEW2 "构建 WebView2 通道（需要 WebView2 SDK）" ON)

if(CSDEMO_BUILD_WEBVIEW2)
    find_path(WEBVIEW2_INCLUDE_DIR WebView2.h)
    find_library(WEBVIEW2_LOADER_LIB
        NAMES WebView2LoaderStatic WebView2Loader
        PATH_SUFFIXES lib lib/x64)

    if(WEBVIEW2_INCLUDE_DIR)
        add_library(csdemo_webview2 STATIC webview2_bridge.cpp)
        add_library(csdemo::webview2 ALIAS csdemo_webview2)
        target_include_directories(csdemo_webview2 PRIVATE "${WEBVIEW2_INCLUDE_DIR}")
        target_link_libraries(csdemo_webview2 PUBLIC csdemo::core)
        # webview2_bridge.cpp 内部用 __has_include 判断，SDK 缺失时会编译成空 TU
        if(WEBVIEW2_LOADER_LIB)
            target_link_libraries(csdemo_webview2 PRIVATE "${WEBVIEW2_LOADER_LIB}")
            message(STATUS "WebView2: 已启用 (${WEBVIEW2_INCLUDE_DIR})")
        else()
            message(WARNING
                "找到 WebView2.h 但未找到 WebView2Loader 库。"
                "csdemo_webview2 可以编译，但链接时可能缺符号。"
                "用 -DWEBVIEW2_LOADER_LIB=<path> 指定。")
        endif()
    else()
        message(STATUS
            "WebView2 SDK 未找到 —— 跳过 csdemo_webview2。"
            "（NuGet: Microsoft.Web.WebView2；或用 -DWEBVIEW2_INCLUDE_DIR=... 指定）")
    endif()
endif()

# ════════════════════════════════════════════════════════════════════════════
# 测试
# ════════════════════════════════════════════════════════════════════════════
if(CSDEMO_BUILD_TESTS)
    enable_testing()

    add_executable(smoke_test smoke_test.cpp)
    target_link_libraries(smoke_test PRIVATE csdemo::core)

    add_executable(layout_test layout_test.cpp)
    target_link_libraries(layout_test PRIVATE csdemo::core)

    add_executable(writer_test writer_test.cpp)
    target_link_libraries(writer_test PRIVATE csdemo::core)

    add_executable(roundtrip_test roundtrip_test.cpp)
    target_link_libraries(roundtrip_test PRIVATE csdemo::core)

    # ── C++ 测试 ──
    add_test(NAME cpp_smoke     COMMAND smoke_test)
    add_test(NAME cpp_layout    COMMAND layout_test "${CSDEMO_GOLDEN_TSV}")
    add_test(NAME cpp_writer    COMMAND writer_test "${CSDEMO_TMP_DIR}/shared-from-cpp.bin")
    add_test(NAME cpp_roundtrip COMMAND roundtrip_test
        "${CSDEMO_TMP_DIR}/shared-from-js.bin"
        "${CSDEMO_TMP_DIR}/shared-from-cpp-rt.bin")

    # 给所有 C++ 测试注入绝对路径 —— 它们内部按
    #     argv > $CSDEMO_GOLDEN / $CSDEMO_TMP > 相对默认值
    # 解析，所以 ctest 下永远拿到绝对路径，不依赖运行时 cwd
    set_tests_properties(cpp_layout
        PROPERTIES ENVIRONMENT "CSDEMO_GOLDEN=${CSDEMO_GOLDEN_TSV}")
    set_tests_properties(cpp_writer cpp_roundtrip
        PROPERTIES ENVIRONMENT "CSDEMO_TMP=${CSDEMO_TMP_DIR}")

    # 输入文件缺失时这些程序以退出码 2 退出 → 让 ctest 报 SKIPPED 而不是 FAILED
    set_tests_properties(cpp_smoke cpp_layout cpp_writer cpp_roundtrip
        PROPERTIES LABELS "cpp" SKIP_RETURN_CODE 2 TIMEOUT 600)

    # cpp_layout 需要金标准；金标准由 tools/dump-shared-layout.mjs 生成
    if(NOT EXISTS "${CSDEMO_GOLDEN_TSV}")
        message(WARNING
            "缺少金标准 ${CSDEMO_GOLDEN_TSV}\n"
            "  先跑: node tools/dump-shared-layout.mjs\n"
            "  cpp_layout 测试会被跳过。")
    endif()

    # ── JS / 跨语言 / 端到端测试（可选）──
    if(CSDEMO_WITH_NODE_TESTS)
        find_program(CSDEMO_NODE NAMES node node.exe)
        if(CSDEMO_NODE)
            add_test(NAME js_only    COMMAND "${CSDEMO_NODE}" "${CSDEMO_REPO_ROOT}/tools/test-shared-buffer.mjs")

            # demo 没有默认值 —— 只有在设了 CSDEMO_DEM_FILE 时才注册需要 demo 的测试
            if(CSDEMO_DEM_FILE)
                add_test(NAME gen_js_image COMMAND "${CSDEMO_NODE}" "${CSDEMO_REPO_ROOT}/tools/gen-js-image.mjs")
                set_tests_properties(gen_js_image PROPERTIES
                    LABELS "cross"
                    WORKING_DIRECTORY "${CSDEMO_REPO_ROOT}"
                    ENVIRONMENT "CSDEMO_DEM=${CSDEMO_DEM_FILE};CSDEMO_TMP=${CSDEMO_TMP_DIR}"
                    TIMEOUT 300)
                # js_only 也需要 demo
                set_tests_properties(js_only PROPERTIES
                    ENVIRONMENT "CSDEMO_DEM=${CSDEMO_DEM_FILE};CSDEMO_TMP=${CSDEMO_TMP_DIR}")
            endif()
            add_test(NAME cpp_to_js  COMMAND "${CSDEMO_NODE}" "${CSDEMO_REPO_ROOT}/tools/test-shared-buffer-from-cpp.mjs")
            add_test(NAME js_to_cpp  COMMAND "${CSDEMO_NODE}" "${CSDEMO_REPO_ROOT}/tools/verify-roundtrip.mjs")
            add_test(NAME playback   COMMAND "${CSDEMO_NODE}" "${CSDEMO_REPO_ROOT}/tools/playback-test.mjs")

            set_tests_properties(js_only cpp_to_js js_to_cpp playback PROPERTIES
                LABELS "cross"
                SKIP_RETURN_CODE 2
                WORKING_DIRECTORY "${CSDEMO_REPO_ROOT}"
                TIMEOUT 900)

            # 依赖关系：谁产出谁就需要谁先跑
            set_tests_properties(cpp_to_js PROPERTIES DEPENDS cpp_writer)
            set_tests_properties(js_to_cpp PROPERTIES DEPENDS cpp_roundtrip)
            set_tests_properties(playback  PROPERTIES DEPENDS cpp_roundtrip)

            # gen_js_image 产出 shared-from-js.bin —— 只有注册了它才挂依赖
            if(CSDEMO_DEM_FILE)
                set_tests_properties(cpp_roundtrip PROPERTIES DEPENDS gen_js_image)
                set_tests_properties(js_to_cpp     PROPERTIES DEPENDS gen_js_image)
                set_tests_properties(playback      PROPERTIES DEPENDS gen_js_image)
            endif()

            message(STATUS "Node 测试: 已注册 4 项（${CSDEMO_NODE}）")
        else()
            message(STATUS "node 未找到 —— 跳过 JS / 跨语言测试")
        endif()
    endif()
endif()

# ── 配置摘要 ──
message(STATUS "")
message(STATUS "csdemo_cpp ${PROJECT_VERSION}")
message(STATUS "  源码目录   ${CMAKE_CURRENT_SOURCE_DIR}")
message(STATUS "  构建目录   ${CMAKE_BINARY_DIR}")
message(STATUS "  仓库根     ${CSDEMO_REPO_ROOT}")
message(STATUS "  测试       ${CSDEMO_BUILD_TESTS}")
message(STATUS "  编译器     ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "")
