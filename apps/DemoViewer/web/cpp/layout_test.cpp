// ============================================================================
// layout_test.cpp —— 用金标准验证 computeSharedLayout
// ============================================================================
//
// 读 docs/shared-layout.golden.tsv（由 tools/dump-shared-layout.mjs 从真实 demo 生成），
// 用里面的输入参数跑一遍 computeSharedLayout，然后逐块比对 offset/length/padded/count。
//
// 编译运行（MSVC）：
//   cl /nologo /std:c++17 /utf-8 /EHsc /W4 layout_test.cpp shared_layout.cpp /Fe:layout_test.exe
//   layout_test ..\docs\shared-layout.golden.tsv
//
// 退出码 0 = 全部一致。
// ============================================================================
#include "cpp_paths.h"
#include "shared_layout.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using namespace csdemo;

namespace {

struct GoldenBlock {
    std::string name;
    std::string type;
    std::size_t offset = 0, length = 0, padded = 0, count = 0;
};

ColType parseType(const std::string& t) {
    if (t == "i32") return ColType::I32;
    if (t == "f32") return ColType::F32;
    if (t == "u8")  return ColType::U8;
    if (t == "u16") return ColType::U16;
    throw std::runtime_error("unknown type: " + t);
}

std::vector<std::string> splitTab(const std::string& line) {
    std::vector<std::string> out;
    std::string cur;
    for (char ch : line) {
        if (ch == '\t') { out.push_back(cur); cur.clear(); }
        else if (ch != '\r') cur.push_back(ch);
    }
    out.push_back(cur);
    return out;
}

}  // namespace

int main(int argc, char** argv) {
    // 路径优先级：argv[1] > $CSDEMO_GOLDEN > ../docs/shared-layout.golden.tsv
    // 找不到时打印指引并 exit 2（ctest 会记成 SKIPPED 而不是 FAILED）
    const std::string pathStr = csdemo::resolveInput(argc, argv, 1,
        "CSDEMO_GOLDEN", "../docs/shared-layout.golden.tsv",
        "layout golden file (docs/shared-layout.golden.tsv)",
        "generate it first:  node tools/dump-shared-layout.mjs");
    const char* path = pathStr.c_str();
    std::ifstream fin(path);
    if (!fin) {
        std::printf("[SKIP] cannot open golden file: %s\n", path);
        return 2;
    }

    // ── 解析 TSV ──
    LayoutInput in;
    Counts& counts = in.counts;
    std::vector<GoldenBlock> golden;
    std::size_t gTotal = 0;
    bool sawBlockHeader = false;

    std::string line;
    while (std::getline(fin, line)) {
        if (line.empty() || line[0] == '#') {
            if (line.rfind("# name", 0) == 0) sawBlockHeader = true;
            continue;
        }
        auto f = splitTab(line);
        if (f.empty()) continue;

        const std::string& k = f[0];
        if (!sawBlockHeader) {
            if (k == "totalBytes") gTotal = std::stoull(f[1]);
            else if (k == "flags") in.flags = static_cast<std::uint32_t>(std::stoul(f[1]));
            else if (k == "numFrames") in.numFrames = static_cast<std::uint32_t>(std::stoul(f[1]));
            else if (k == "numPlayers") in.numPlayers = static_cast<std::uint32_t>(std::stoul(f[1]));
            else if (k == "panelNumFrames") in.panelNumFrames = static_cast<std::uint32_t>(std::stoul(f[1]));
            else if (k == "count" && f.size() >= 3) {
                const std::string& key = f[1];
                const auto v = static_cast<std::uint32_t>(std::stoul(f[2]));
                if (key == "tracers") counts.tracers = v;
                else if (key == "damage") counts.damage = v;
                else if (key == "weaponFires") counts.weaponFires = v;
                else if (key == "smokeCount") counts.smokeCount = v;
                else if (key == "smokeCountPlus1") counts.smokeCountPlus1 = v;
                else if (key == "smokeBufferBytes") counts.smokeBufferBytes = v;
                else if (key == "smokeFrameTicks") counts.smokeFrameTicks = v;
                else if (key == "blobBytes") counts.blobBytes = v;
            }
            continue;
        }
        if (f.size() < 6) continue;
        GoldenBlock b;
        b.name = f[0];
        b.type = f[1];
        b.offset = std::stoull(f[2]);
        b.length = std::stoull(f[3]);
        b.padded = std::stoull(f[4]);
        b.count = std::stoull(f[5]);
        golden.push_back(std::move(b));
    }

    std::printf("golden: %s\n", path);
    std::printf("  input N=%u P=%u M=%u flags=0x%x blobBytes=%u\n",
                in.numFrames, in.numPlayers, in.panelNumFrames, in.flags, counts.blobBytes);
    std::printf("  expect %zu blocks, totalBytes %zu\n\n", golden.size(), gTotal);

    // ── 跑实现 ──
    Layout layout;
    try {
        layout = computeSharedLayout(in);
    } catch (const std::exception& e) {
        std::printf("computeSharedLayout threw: %s\n", e.what());
        return 1;
    }
    const std::size_t bytes = sharedBufferBytes(layout);

    int fails = 0;

    // ── 总字节 ──
    if (bytes != gTotal) {
        std::printf("[FAIL] totalBytes: got %zu, want %zu (delta %+lld)\n",
                    bytes, gTotal, static_cast<long long>(bytes) - static_cast<long long>(gTotal));
        fails++;
    } else {
        std::printf("[PASS] totalBytes = %zu (%.2f MB)\n", bytes, bytes / 1048576.0);
    }

    // ── 块数 ──
    if (layout.blocks.size() != golden.size()) {
        std::printf("[FAIL] block count: got %zu, want %zu\n", layout.blocks.size(), golden.size());
        fails++;
    } else {
        std::printf("[PASS] block count = %zu\n", layout.blocks.size());
    }

    // ── 逐块比对 ──
    const std::size_t n = std::min(layout.blocks.size(), golden.size());
    for (std::size_t i = 0; i < n; i++) {
        const Block& a = layout.blocks[i];
        const GoldenBlock& g = golden[i];
        bool ok = a.name == g.name
               && typeName(a.type) == g.type
               && a.offset == g.offset
               && a.length == g.length
               && a.padded == g.padded
               && a.count == g.count;
        if (!ok) {
            fails++;
            std::printf("[FAIL] #%zu %s\n", i, g.name.c_str());
            if (a.name != g.name) std::printf("         name:   got %.*s, want %s\n", (int)a.name.size(), a.name.data(), g.name.c_str());
            if (typeName(a.type) != g.type) std::printf("         type:   got %.*s, want %s\n", (int)typeName(a.type).size(), typeName(a.type).data(), g.type.c_str());
            if (a.offset != g.offset) std::printf("         offset: got %zu, want %zu\n", a.offset, g.offset);
            if (a.length != g.length) std::printf("         length: got %zu, want %zu\n", a.length, g.length);
            if (a.padded != g.padded) std::printf("         padded: got %zu, want %zu\n", a.padded, g.padded);
            if (a.count != g.count)   std::printf("         count:  got %zu, want %zu\n", a.count, g.count);
        }
    }
    if (fails == 0) {
        std::printf("[PASS] all %zu blocks match on name/type/offset/length/padded/count\n", n);
    }

    // ── 对齐自检（不依赖金标准）──
    {
        int misaligned = 0, typeMisaligned = 0, overlap = 0;
        for (std::size_t i = 0; i < layout.blocks.size(); i++) {
            const auto& b = layout.blocks[i];
            if (b.offset % kCsdfAlign != 0) misaligned++;
            if (b.offset % typeSize(b.type) != 0) typeMisaligned++;
            if (i && layout.blocks[i - 1].offset + layout.blocks[i - 1].padded > b.offset) overlap++;
        }
        if (misaligned) { std::printf("[FAIL] %d blocks not 64-byte aligned\n", misaligned); fails++; }
        else std::printf("[PASS] all blocks 64-byte aligned\n");
        if (typeMisaligned) { std::printf("[FAIL] %d blocks not type-aligned (view construction would throw)\n", typeMisaligned); fails++; }
        else std::printf("[PASS] all blocks type-aligned\n");
        if (overlap) { std::printf("[FAIL] %d block overlaps\n", overlap); fails++; }
        else std::printf("[PASS] no block overlaps\n");
    }

    std::printf("\n%s\n", fails ? "FAIL: layout differs from golden" : "OK: layout matches golden exactly");
    return fails ? 1 : 0;
}
