# ---------------------------------------------------------------------------
# 方案 gatekeeper —— 「加一个方案」需要写的全部 CMake。
#
# 与 apps/inspector/CMakeLists.txt 逐行同形：平台第 3、4 步落地之后，接入一个新方案
# 不再需要动 platform/ 里的任何一行（见 docs/workspace-layout-plan.md 第 6 步）。
# 宏的契约见 platform/cmake/ShinApp.cmake。
# ---------------------------------------------------------------------------
add_subdirectory(native)

shin_add_app(gatekeeper NATIVE_TARGET shin_app_gatekeeper EXE_NAME ShinGatekeeper)
