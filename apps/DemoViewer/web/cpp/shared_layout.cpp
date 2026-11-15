// ============================================================================
// shared_layout.cpp —— 共享内存布局计算实现
// ============================================================================
// 与 src/deobfuscated/shared-buffer.js 的 computeSharedLayout 逐字节等价。
// 改动这里之后必须重新跑 cpp/layout_test 对齐金标准。
// ============================================================================
#include "shared_layout.h"

#include <stdexcept>

namespace csdemo {
namespace {

constexpr std::size_t alignUp(std::size_t n, std::size_t a) {
    return ((n + a - 1) / a) * a;
}

/// 长度基数
enum class Basis : std::uint8_t { TickN, NP, PTickM, MP, Count };

struct ColDef {
    std::string_view name;
    ColType type;
    Basis basis;
    std::uint32_t flag;       // 0 = 必需列
};

struct ExtraColDef {
    std::string_view name;
    ColType type;
    std::uint32_t Counts::*countField;
    std::uint32_t mult;
};

// ── 必需 frames 列（顺序即内存顺序，不能改）──
constexpr ColDef kFrameCols[] = {
    {"frameTick", ColType::I32, Basis::TickN, 0},

    {"posX", ColType::F32, Basis::NP, 0},
    {"posY", ColType::F32, Basis::NP, 0},
    {"posZ", ColType::F32, Basis::NP, 0},
    {"yaw", ColType::F32, Basis::NP, 0},
    {"pitch", ColType::F32, Basis::NP, 0},

    {"health", ColType::U8, Basis::NP, 0},
    {"alive", ColType::U8, Basis::NP, 0},
    {"team", ColType::U8, Basis::NP, 0},
    {"score", ColType::U8, Basis::NP, 0},

    {"duck", ColType::F32, Basis::NP, 0},
    {"flash", ColType::F32, Basis::NP, 0},
    {"flashAlpha", ColType::F32, Basis::NP, 0},
    {"zoom", ColType::U8, Basis::NP, 0},
};

// ── 可选 frames 列（按 flags 过滤；顺序也固定）──
constexpr ColDef kFrameOptCols[] = {
    {"accuracyPenalty", ColType::F32, Basis::NP, kFlagAccuracy},
    {"reloading", ColType::U8, Basis::NP, kFlagReloading},
    {"playerFlags", ColType::U8, Basis::NP, kFlagPlayerFlags},
    {"speed", ColType::F32, Basis::NP, kFlagSpeed},
    {"smoothSpeed", ColType::F32, Basis::NP, kFlagSmoothSpeed},
};

// ── panelFrames 列 ──
constexpr ColDef kPanelCols[] = {
    {"panelFrameTick", ColType::I32, Basis::PTickM, 0},

    {"panelHealth", ColType::U8, Basis::MP, 0},
    {"panelAlive", ColType::U8, Basis::MP, 0},
    {"panelTeam", ColType::U8, Basis::MP, 0},
    {"panelArmor", ColType::U8, Basis::MP, 0},
    {"panelFlags", ColType::U8, Basis::MP, 0},

    {"panelMoney", ColType::U16, Basis::MP, 0},
    {"panelClipAmmo", ColType::U16, Basis::MP, 0},
    {"panelReserveAmmo", ColType::U16, Basis::MP, 0},

    {"panelActiveWeapon", ColType::U8, Basis::MP, 0},
    {"panelUtilCounts", ColType::U8, Basis::MP, 0},
};

// ── 区间数据列（条目数来自 Counts；顺序固定）──
constexpr ExtraColDef kExtraCols[] = {
    {"tracers.origin", ColType::F32, &Counts::tracers, 3},
    {"tracers.end", ColType::F32, &Counts::tracers, 3},
    {"tracers.tick", ColType::I32, &Counts::tracers, 1},
    {"tracers.team", ColType::U8, &Counts::tracers, 1},
    {"tracers.hitKind", ColType::U8, &Counts::tracers, 1},

    {"damage.attackerSlot", ColType::U8, &Counts::damage, 1},
    {"damage.victimSlot", ColType::U8, &Counts::damage, 1},
    {"damage.tick", ColType::I32, &Counts::damage, 1},
    {"damage.dmg", ColType::U8, &Counts::damage, 1},

    {"weaponFires.ticks", ColType::I32, &Counts::weaponFires, 1},
    {"weaponFires.slots", ColType::U8, &Counts::weaponFires, 1},

    {"smokeVoxels.tickBegin", ColType::I32, &Counts::smokeCount, 1},
    {"smokeVoxels.detonation", ColType::F32, &Counts::smokeCount, 3},
    {"smokeVoxels.color", ColType::F32, &Counts::smokeCount, 3},
    {"smokeVoxels.bufferOffsets", ColType::I32, &Counts::smokeCountPlus1, 1},
    {"smokeVoxels.frameOffsets", ColType::I32, &Counts::smokeCountPlus1, 1},
    {"smokeVoxels.buffers", ColType::U8, &Counts::smokeBufferBytes, 1},
    {"smokeVoxels.frameTicks", ColType::I32, &Counts::smokeFrameTicks, 1},
};

}  // namespace

const Block& Layout::at(std::string_view name) const {
    if (const Block* b = find(name)) return *b;
    throw std::out_of_range("Layout::at: 找不到块 " + std::string(name));
}

Layout computeSharedLayout(const LayoutInput& in) {
    if (in.numPlayers == 0) {
        throw std::invalid_argument("computeSharedLayout: numPlayers 为 0");
    }
    const std::uint64_t N = in.numFrames;
    const std::uint64_t P = in.numPlayers;
    const std::uint64_t M = in.panelNumFrames;

    Layout layout;
    layout.blocks.reserve(64);
    std::size_t off = kDataOffset;

    auto push = [&](std::string_view name, ColType type, std::uint64_t count) {
        const std::size_t length = static_cast<std::size_t>(count) * typeSize(type);
        const std::size_t padded = alignUp(length, kCsdfAlign);
        layout.blocks.push_back(Block{name, type, off, length, padded, static_cast<std::size_t>(count)});
        off += padded;
    };

    auto countFor = [&](Basis b) -> std::uint64_t {
        switch (b) {
            case Basis::TickN:  return N;
            case Basis::NP:     return N * P;
            case Basis::PTickM: return M;
            case Basis::MP:     return M * P;
            case Basis::Count:  return 0;   // 由 ExtraColDef 分支处理
        }
        return 0;
    };

    for (const auto& c : kFrameCols) push(c.name, c.type, countFor(c.basis));

    for (const auto& c : kFrameOptCols) {
        if (in.flags & c.flag) push(c.name, c.type, countFor(c.basis));
    }

    if (in.flags & kFlagPanels) {
        for (const auto& c : kPanelCols) push(c.name, c.type, countFor(c.basis));
    }

    for (const auto& c : kExtraCols) {
        const std::uint64_t base = in.counts.*(c.countField);
        push(c.name, c.type, base * c.mult);
    }

    // blob 区：变长 TypedArray 的容器（见 shared_writer.h）
    //
    // ⚠️ 这里的 padded 用 **8 字节**对齐，不是 64 —— 必须与 JS 一致。
    //    原因：blob 永远是最后一块（后面没有别的块了），所以它的 64 对齐没有意义；
    //    而 blob 内部每个数组按 8 字节对齐累积，JSON 里的引用偏移就是基于 8 对齐算的。
    //    totalBytes 会由 sharedBufferBytes() 统一向上取整到 64。
    //    （这条规则是照 JS 实现抄的，改之前先对金标准。）
    if (in.counts.blobBytes > 0) {
        const std::size_t blobBytes = in.counts.blobBytes;
        const std::size_t padded = alignUp(blobBytes, kBlobAlign);
        layout.blocks.push_back(Block{"blob", ColType::U8, off, blobBytes, padded, blobBytes});
        off += padded;
    }

    layout.totalBytes = off;
    return layout;
}

std::size_t sharedBufferBytes(const Layout& layout) {
    return alignUp(layout.totalBytes, kCsdfAlign);
}

std::uint32_t deriveFlags(const DemoData& d) {
    const auto& F = d.frames;
    std::uint32_t flags = 0;
    if (!F.accuracyPenalty.empty()) flags |= kFlagAccuracy;
    if (!F.reloading.empty())       flags |= kFlagReloading;
    if (!F.playerFlags.empty())     flags |= kFlagPlayerFlags;
    flags |= kFlagPanels;
    if (!F.speed.empty())           flags |= kFlagSpeed;
    if (!F.smoothSpeed.empty())     flags |= kFlagSmoothSpeed;
    return flags;
}

Counts deriveCounts(const DemoData& d) {
    Counts c;
    c.tracers = d.tracers.count;
    c.damage = d.damage.count;
    c.weaponFires = static_cast<std::uint32_t>(d.weaponFires.ticks.size());
    c.smokeCount = d.smokeVoxels.count;
    c.smokeCountPlus1 = d.smokeVoxels.count + 1;
    c.smokeBufferBytes = static_cast<std::uint32_t>(d.smokeVoxels.buffers.size());
    c.smokeFrameTicks = static_cast<std::uint32_t>(d.smokeVoxels.frameTicks.size());
    c.blobBytes = 0;   // 由 SharedWriter 填
    return c;
}

}  // namespace csdemo
