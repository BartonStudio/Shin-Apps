// ============================================================================
// shared_layout.h —— 共享内存布局计算（C++ 版）
// ============================================================================
//
// 与 JS 侧的 computeSharedLayout() 逐字节等价。JS 定义在：
//   src/deobfuscated/shared-buffer.js  L187
// 布局说明见：
//   docs/08-cpp-integration.md §3.4
//
// ── 这个文件只做一件事 ─────────────────────────────────────────────────────
//
//   给定 (N, P, M, flags, counts)，算出 49 个块各自落在哪个字节偏移。
//   不碰数据、不碰 WebView2、不碰 JSON。
//
// ── 怎么验对 ───────────────────────────────────────────────────────────────
//
//   node tools/dump-shared-layout.mjs          # 生成金标准
//   cpp/layout_test  docs/shared-layout.golden.tsv   # 逐块比对
//
//   金标准是从真实 demo（de_dust2，22 回合，87 MB）算出来的，49 个块。
//   你的实现只要 offset/length/padded/count 全部对上，布局就是对的。
//
// ── 内存布局总览 ───────────────────────────────────────────────────────────
//
//   [0, 64)                 CSDF header
//   [64, 64+1MB)            元数据区 A（JSON：u32 长度 + utf8）
//   [64+1MB, 64+2MB)        元数据区 B（同上，A/B 按 version 奇偶交替写）
//   [64+2MB, …)             列块区：每块 64 字节对齐
//       ├─ FRAME_COLS
//       ├─ FRAME_OPT_COLS（按 flags 过滤）
//       ├─ PANEL_COLS（flags 含 FLAG_PANELS 才写）
//       ├─ EXTRA_COLS（区间数据）
//       └─ blob（变长数组容器，内部按 8 字节对齐）
//
// ── 编译要求 ───────────────────────────────────────────────────────────────
//
//   MSVC:  cl /std:c++17 /utf-8 /EHsc /W4
//   ⚠️ MSVC 必须加 /utf-8（本文件含中文注释，否则按 GBK 解释会报「常量中有换行符」）
//
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "demo_data.h"   // 复用 Counts 之外的 f32/i32/u8/u16 别名

namespace csdemo {

// ════════════════════════════════════════════════════════════════════════════
// 常量（必须与 src/deobfuscated/shared-buffer.js 顶部完全一致）
// ════════════════════════════════════════════════════════════════════════════

/// 'CSDF' 小端
inline constexpr std::uint32_t kCsdfMagic = 0x46445343u;
inline constexpr std::uint32_t kCsdfVersion = 1u;
inline constexpr std::uint32_t kCsdfHeaderBytes = 64u;
/// 列块对齐（64 字节）
inline constexpr std::uint32_t kCsdfAlign = 64u;

// 可选列开关
inline constexpr std::uint32_t kFlagAccuracy    = 1u << 0;
inline constexpr std::uint32_t kFlagReloading   = 1u << 1;
inline constexpr std::uint32_t kFlagPlayerFlags = 1u << 2;
inline constexpr std::uint32_t kFlagPanels      = 1u << 3;
inline constexpr std::uint32_t kFlagSpeed       = 1u << 4;
inline constexpr std::uint32_t kFlagSmoothSpeed = 1u << 5;

/// 单个元数据区容量（A、B 各一份）。实测真实 demo 的元数据 JSON 约 462 KB。
inline constexpr std::uint32_t kMetaRegionBytes = 1u << 20;
inline constexpr std::uint32_t kMetaAOffset = kCsdfHeaderBytes;
inline constexpr std::uint32_t kMetaBOffset = kMetaAOffset + kMetaRegionBytes;
/// 列块数据区起点
inline constexpr std::uint32_t kDataOffset = kMetaBOffset + kMetaRegionBytes;

/// blob 内部对齐（8 字节，注意不是 64）
inline constexpr std::uint32_t kBlobAlign = 8u;

// ════════════════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════════════════

enum class ColType : std::uint8_t { I32, F32, U8, U16 };

constexpr std::uint32_t typeSize(ColType t) {
    switch (t) {
        case ColType::I32: return 4;
        case ColType::F32: return 4;
        case ColType::U8:  return 1;
        case ColType::U16: return 2;
    }
    return 0;
}

constexpr std::string_view typeName(ColType t) {
    switch (t) {
        case ColType::I32: return "i32";
        case ColType::F32: return "f32";
        case ColType::U8:  return "u8";
        case ColType::U16: return "u16";
    }
    return "?";
}

/// 区间数据的条目数。全部必填（为 0 也要给），漏了 computeSharedLayout 会抛异常。
struct Counts {
    std::uint32_t tracers = 0;            ///< 弹道/曳光条目数
    std::uint32_t damage = 0;             ///< 伤害条目数
    std::uint32_t weaponFires = 0;        ///< 开火事件数
    std::uint32_t smokeCount = 0;         ///< 烟雾团数
    std::uint32_t smokeCountPlus1 = 1;    ///< = smokeCount + 1（offsets 表长度）
    std::uint32_t smokeBufferBytes = 0;   ///< smokeVoxels.buffers 字节数
    std::uint32_t smokeFrameTicks = 0;    ///< smokeVoxels.frameTicks 元素数
    std::uint32_t blobBytes = 0;          ///< blob 区字节数（由 planSharedBuffer 填）
};

struct LayoutInput {
    std::uint32_t numFrames = 0;        ///< N：整段 demo 总帧数（容量，不是可见数）
    std::uint32_t numPlayers = 0;       ///< P
    std::uint32_t panelNumFrames = 0;   ///< M：面板帧容量
    std::uint32_t flags = 0;            ///< kFlag* 的按位或
    Counts counts{};
};

struct Block {
    std::string_view name;
    ColType type = ColType::U8;
    std::size_t offset = 0;    ///< 相对共享内存基址的绝对字节偏移（已 64 字节对齐）
    std::size_t length = 0;    ///< 实际数据字节数（不含 padding）
    std::size_t padded = 0;    ///< 对齐后的跨度（下一块从这里开始）
    std::size_t count = 0;     ///< 元素个数
};

struct Layout {
    std::vector<Block> blocks;
    std::size_t totalBytes = 0;   ///< 最后一块的 offset + padded

    /// 按名字找块；找不到返回 nullptr
    const Block* find(std::string_view name) const {
        for (const auto& b : blocks) {
            if (b.name == name) return &b;
        }
        return nullptr;
    }
    /// 同上，但找不到就抛 std::out_of_range
    const Block& at(std::string_view name) const;
};

// ════════════════════════════════════════════════════════════════════════════
// 核心：算布局
// ════════════════════════════════════════════════════════════════════════════
//
// 规则（与 JS 完全一致，顺序敏感）：
//   1. 从 kDataOffset 开始
//   2. 每块 padded = ceil(length / 64) * 64，下一块从 offset + padded 开始
//   3. 块顺序：FRAME_COLS → FRAME_OPT_COLS(按 flag) → PANEL_COLS(有 flag)
//              → EXTRA_COLS → blob(blobBytes>0 才有，内部 8 字节对齐)
//
/// @throws std::invalid_argument numPlayers 为 0
Layout computeSharedLayout(const LayoutInput& in);

/// 整块共享内存应该申请多少字节（= totalBytes 向上取整到 64）
std::size_t sharedBufferBytes(const Layout& layout);

// ════════════════════════════════════════════════════════════════════════════
// 从 DemoData 推出 (flags, counts) —— 与 JS 的 deriveFlags / deriveCounts 一致
// ════════════════════════════════════════════════════════════════════════════
std::uint32_t deriveFlags(const DemoData& d);

/// 注意：返回的 blobBytes 一定是 0 —— 真实值要等 JSON 里引用完变长数组才知道。
/// 计算布局前必须由 SharedWriter 填上。
Counts deriveCounts(const DemoData& d);

}  // namespace csdemo
