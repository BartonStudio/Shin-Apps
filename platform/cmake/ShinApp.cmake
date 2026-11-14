# ---------------------------------------------------------------------------
# shin_add_app —— 「加一个方案」的唯一接缝
#
#   shin_add_app(<name> [NATIVE_TARGET <lib>] [EXE_NAME <file>])
#
# 调用点必须是 apps/<name>/CMakeLists.txt（用 CMAKE_CURRENT_SOURCE_DIR 定位方案目录）。
#
# 不再读取 app.json：装配流程由方案自己的 main.cpp 用纯代码完成
# （WebviewHost::Create + 挂业务节点 + WebviewHost::Run）。
#
# 做两件事：
#   1. 传了 NATIVE_TARGET → 用 apps/<name>/main.cpp 生成独立 exe，
#      链接 shin_host 与该方案自己的 native 库；
#   2. 有 dist/ 产物时，顺带复制为产物目录下的 apps/<name>/web/。
# ---------------------------------------------------------------------------

function(shin_add_app NAME)
    cmake_parse_arguments(ARG "" "NATIVE_TARGET;EXE_NAME" "" ${ARGN})

    set(_app_dir "${CMAKE_CURRENT_SOURCE_DIR}")
    set_property(GLOBAL APPEND PROPERTY SHIN_APPS ${NAME})

    if(NOT ARG_NATIVE_TARGET)
        message(STATUS "shin_add_app(${NAME})：未声明 NATIVE_TARGET，跳过 exe")
        return()
    endif()

    set(_exe_name "${NAME}")
    if(ARG_EXE_NAME)
        set(_exe_name "${ARG_EXE_NAME}")
    endif()

    set(_main "${_app_dir}/main.cpp")
    if(NOT EXISTS "${_main}")
        message(FATAL_ERROR
            "shin_add_app(${NAME})：声明了 NATIVE_TARGET，但找不到 ${_main}\n"
            "自带 C++ 的方案必须提供程序入口。")
    endif()

    add_executable(${_exe_name} "${_main}")
    target_link_libraries(${_exe_name} PRIVATE shin_host ${ARG_NATIVE_TARGET})
    target_compile_features(${_exe_name} PRIVATE cxx_std_20)
    if(MSVC)
        target_compile_options(${_exe_name} PRIVATE /utf-8)
    endif()

    # 前端构建产物（vite build 的 dist/）。当前各方案都由 dev server 托管，
    # 这里只是"存在就顺带复制"，不生成也不报错。
    # 注意这是**配置期**判断：dist/ 是后来才产出的话，需要重跑一次 cmake。
    if(EXISTS "${_app_dir}/dist")
        add_custom_command(TARGET ${_exe_name} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                    "${_app_dir}/dist"
                    "$<TARGET_FILE_DIR:${_exe_name}>/apps/${NAME}/web"
            COMMENT "复制 ${NAME} 的前端产物到 web/"
            VERBATIM)
    endif()

    set_target_properties(${_exe_name} PROPERTIES FOLDER "Application")
    message(STATUS "shin_add_app(${NAME})：exe=${_exe_name}，native=${ARG_NATIVE_TARGET}")
endfunction()
