# DemoViewer —— 宿主侧装配（认识平台 shin_host：WebviewHost / RuntimeHost）。
add_library(shin_app_demoviewer STATIC
    DemoApp.cpp
)
target_include_directories(shin_app_demoviewer PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(shin_app_demoviewer PUBLIC cxx_std_20)
if(MSVC)
    target_compile_options(shin_app_demoviewer PRIVATE /utf-8)
endif()
# PUBLIC：让 exe 一并拿到 shin_host 的头文件与依赖。
target_link_libraries(shin_app_demoviewer PUBLIC shin_host)
set_target_properties(shin_app_demoviewer PROPERTIES FOLDER "Apps/demoviewer")
