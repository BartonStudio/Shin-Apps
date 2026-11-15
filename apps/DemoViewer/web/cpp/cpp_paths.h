// ============================================================================
// cpp_paths.h —— 测试程序的路径解析（与 tools/paths.mjs 同一套优先级）
// ============================================================================
//
//     ① 命令行参数（argv[n]）
//     ② 环境变量（CSDEMO_DEM / CSDEMO_TMP / CSDEMO_IMAGE / CSDEMO_GOLDEN）
//     ③ 默认值（相对仓库根）
//
// 为什么测试程序也要做这件事：最初 writer_test / roundtrip_test 把
// "tmp/shared-from-cpp.bin" 之类的路径写死在代码里，换台机器、换个目录就得改源码。
//
// 退出码约定（与 CMake 的 SKIP_RETURN_CODE 2 配合）：
//     2 = 输入缺失（不是错误，是「前置条件没满足」）→ ctest 标成 SKIPPED
//     1 = 真的失败
//
// 注意：本文件是 UTF-8 **带 BOM**，且运行时输出一律用英文 —— 中文只出现在注释里。
//      （MSVC 会把 printf 里的中文字面量挤坏格式串，并额外报 C4819，见 docs/08 G.2）
// ============================================================================
#pragma once

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <string_view>
#include <sys/stat.h>

namespace csdemo {

/// 文件是否存在
inline bool fileExists(const std::string& p) {
    struct stat st {};
    return ::stat(p.c_str(), &st) == 0;
}

/// 读环境变量；没有则返回 fallback。MSVC 上走 _dupenv_s 以避免 C4996 废弃警告。
inline std::string envOr(const char* name, const char* fallback = nullptr) {
#ifdef _MSC_VER
    char* buf = nullptr;
    std::size_t len = 0;
    if (::_dupenv_s(&buf, &len, name) == 0 && buf && *buf) {
        std::string out(buf);
        std::free(buf);
        return out;
    }
    std::free(buf);
#else
    const char* v = std::getenv(name);
    if (v && *v) return std::string(v);
#endif
    return fallback ? std::string(fallback) : std::string();
}

/// 拼目录与文件名（处理末尾斜杠，兼容 Windows 反斜杠）
inline std::string joinPath(std::string_view dir, std::string_view name) {
    if (dir.empty()) return std::string(name);
    std::string out(dir);
    const char last = out.back();
    if (last != '/' && last != '\\') out.push_back('/');
    out.append(name);
    return out;
}

/**
 * 解析一个输入文件路径。
 *
 * @param argc      main 的 argc
 * @param argv      main 的 argv
 * @param idx       argv 里这个参数的索引（从 1 开始）；argc <= idx 表示没给
 * @param envName   环境变量名，如 "CSDEMO_DEM"
 * @param fallback  默认值（相对仓库根，如 "../docs/shared-layout.golden.tsv"）
 * @param label     人类可读的名字（英文），如 "layout golden file"
 * @param howto     额外提示（英文，如 "generate it first: node tools/..."）
 * @return 解析出的路径；**文件不存在时会打印指引并以退出码 2 结束**
 */
inline std::string resolveInput(int argc, char** argv, int idx,
                                const char* envName, const char* fallback,
                                const char* label, const char* howto = nullptr) {
    std::string p;
    if (argc > idx && argv[idx] && *argv[idx]) {
        p = argv[idx];
    } else {
        const std::string fromEnv = envOr(envName);
        p = fromEnv.empty() ? std::string(fallback) : fromEnv;
    }

    if (fileExists(p)) return p;

    std::printf("\n[SKIP] cannot find %s:\n    %s\n\n", label, p.c_str());
    std::printf("how to specify (either one):\n");
    std::printf("  1) command line   %s <path>   (argument #%d)\n",
                (argc > 0 && argv[0]) ? argv[0] : "<program>", idx);
    std::printf("  2) environment    %s=<path>\n", envName);
    if (howto) std::printf("\n%s\n", howto);
    std::printf("\n");
    std::exit(2);   // 2 = prerequisite missing -> ctest reports SKIPPED
}

/// 中间产物目录：① argv[idx]  ② $CSDEMO_TMP  ③ "../tmp"
inline std::string resolveTmpDir(int argc, char** argv, int idx) {
    if (argc > idx && argv[idx] && *argv[idx]) return std::string(argv[idx]);
    const std::string fromEnv = envOr("CSDEMO_TMP");
    return fromEnv.empty() ? std::string("../tmp") : fromEnv;
}

/// 确保一个文件的**父目录**存在（写文件前调用）。
/// 返回 true = 已存在或创建成功。
inline bool ensureParentDir(const std::string& file) {
    const std::filesystem::path p(file);
    if (p.parent_path().empty()) return true;
    std::error_code ec;
    std::filesystem::create_directories(p.parent_path(), ec);
    return !ec;
}

}  // namespace csdemo
