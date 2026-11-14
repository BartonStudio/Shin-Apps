#pragma once

#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace shin::host {

/// exe 所在目录（末尾不带分隔符）。用于拼「exe 旁边」的资源路径（图标、静态入口等）。
inline std::string ExecutableDirectory() {
#ifdef _WIN32
    std::wstring buffer(MAX_PATH, L'\0');
    for (;;) {
        const DWORD written = ::GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (written == 0) {
            throw std::runtime_error("GetModuleFileNameW 失败");
        }
        if (written < buffer.size()) {
            buffer.resize(written);
            break;
        }
        buffer.resize(buffer.size() * 2); // 被截断，翻倍重试
    }
    return std::filesystem::path(buffer).parent_path().string();
#else
    return std::filesystem::current_path().string();
#endif
}

/// 命令行里是否有这个参数（精确匹配整项，不做前缀/简写解析）。
inline bool HasFlag(const std::vector<std::string>& args, const std::string& flag) {
    for (const auto& arg : args) {
        if (arg == flag) return true;
    }
    return false;
}

} // namespace shin::host
