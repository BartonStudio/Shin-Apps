# DemoViewer —— 宿主侧装配（认识平台 shin_host：WebviewHost / RuntimeHost）。
add_library(shin_app_demoviewer STATIC
    DemoApp_host.cpp   # DemoApp.cpp 被进程锁定（内容同此文件+语法修正），锁释放后合并回去
)
target_include_directories(shin_app_demoviewer PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../third_party/json/include")
target_compile_features(shin_app_demoviewer PUBLIC cxx_std_20)
if(MSVC)
    target_compile_options(shin_app_demoviewer PRIVATE /utf-8)
endif()
# PUBLIC：让 exe 一并拿到 shin_host 的头文件与依赖。
target_link_libraries(shin_app_demoviewer PUBLIC shin_host)
set_target_properties(shin_app_demoviewer PROPERTIES FOLDER "Apps/demoviewer")

# ---------------------------------------------------------------------------
# cs2ffi —— CS2 demo 解析库（Rust：demoparser 的 C ABI 封装）
#   源码：cs2ffi/（cargo crate，staticlib）
#   产物：cs2ffi/target/x86_64-pc-windows-msvc/release/cs2ffi.lib
#   接口：cs2ffi/shim.h（外部代码 include cs2ffi 路径下的 shim.h）
#   protoc：由 cs2ffi/.cargo/config.toml 固化（vendor/protoc/bin/protoc.exe）
# ---------------------------------------------------------------------------
set(CS2FFI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/cs2ffi")
set(CS2FFI_LIB "${CS2FFI_DIR}/target/x86_64-pc-windows-msvc/release/cs2ffi.lib")
find_program(CARGO_EXE cargo PATHS "$ENV{USERPROFILE}/.cargo/bin")

if(CARGO_EXE)
    add_custom_command(
        OUTPUT "${CS2FFI_LIB}"
        COMMAND "${CARGO_EXE}" build --release --target x86_64-pc-windows-msvc
        WORKING_DIRECTORY "${CS2FFI_DIR}"
        COMMENT "cargo build cs2ffi (Rust CS2 demo parser shim)"
        VERBATIM
    )
    add_custom_target(cs2ffi_build DEPENDS "${CS2FFI_LIB}")
    add_library(cs2ffi STATIC IMPORTED GLOBAL)
    set_target_properties(cs2ffi PROPERTIES
        IMPORTED_LOCATION "${CS2FFI_LIB}"
        FOLDER "Apps/demoviewer/third_party")
    set(CS2FFI_FOUND ON)
else()
    message(WARNING "cargo 不在 PATH（%USERPROFILE%\\.cargo\\bin）——cs2ffi 不会参与构建")
    set(CS2FFI_FOUND OFF)
endif()

if(CS2FFI_FOUND)
    # Rust std 在 windows-msvc target 下的系统库依赖
    # （synchronization：WaitOnAddress/WakeByAddress；MSVC 2022 起随 SDK 提供）
    set(CS2FFI_SYSTEM_LIBS ws2_32 userenv bcrypt advapi32 ntdll synchronization)
    target_include_directories(shin_app_demoviewer PUBLIC "${CS2FFI_DIR}")
    target_link_libraries(shin_app_demoviewer PUBLIC cs2ffi ${CS2FFI_SYSTEM_LIBS})
    add_dependencies(shin_app_demoviewer cs2ffi_build)
endif()

# 冒烟测试 exe（EXCLUDE_FROM_ALL：手动 --target cs2ffi_smoke 构建）
if(CS2FFI_FOUND)
    add_executable(cs2ffi_smoke EXCLUDE_FROM_ALL cs2ffi_smoke.cpp)
    target_include_directories(cs2ffi_smoke PRIVATE "${CS2FFI_DIR}")
    if(MSVC)
        target_compile_options(cs2ffi_smoke PRIVATE /utf-8)
    endif()
    target_link_libraries(cs2ffi_smoke PRIVATE cs2ffi ${CS2FFI_SYSTEM_LIBS})
    set_target_properties(cs2ffi_smoke PROPERTIES FOLDER "Apps/demoviewer/tests")

    # DemoLoader 灌库冒烟测试（纯域类路径，不依赖 iobject/shin_host）
    add_executable(cs2_loader_smoke EXCLUDE_FROM_ALL cs2_loader_smoke.cpp)
    target_include_directories(cs2_loader_smoke PRIVATE
        "${CS2FFI_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}/cs2"
        "${CMAKE_CURRENT_SOURCE_DIR}/../../../third_party/json/include")
    target_compile_features(cs2_loader_smoke PRIVATE cxx_std_20)
    if(MSVC)
        target_compile_options(cs2_loader_smoke PRIVATE /utf-8)
    endif()
    target_link_libraries(cs2_loader_smoke PRIVATE cs2ffi ${CS2FFI_SYSTEM_LIBS})
    set_target_properties(cs2_loader_smoke PROPERTIES FOLDER "Apps/demoviewer/tests")

    # ContractFeed 契约导出冒烟测试（EntityStore → CSDF 共享内存块 → 落盘）
    add_executable(cs2_contract_smoke EXCLUDE_FROM_ALL cs2_contract_smoke.cpp)
    target_include_directories(cs2_contract_smoke PRIVATE
        "${CS2FFI_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}/cs2"
        "${CMAKE_CURRENT_SOURCE_DIR}/../../../third_party/json/include")
    target_compile_features(cs2_contract_smoke PRIVATE cxx_std_20)
    if(MSVC)
        target_compile_options(cs2_contract_smoke PRIVATE /utf-8)
    endif()
    target_link_libraries(cs2_contract_smoke PRIVATE cs2ffi ${CS2FFI_SYSTEM_LIBS})
    set_target_properties(cs2_contract_smoke PROPERTIES FOLDER "Apps/demoviewer/tests")
endif()
