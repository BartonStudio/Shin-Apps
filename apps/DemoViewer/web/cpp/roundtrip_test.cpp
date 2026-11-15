// ============================================================================
// roundtrip_test.cpp —— 真实全量数据的往返验证
// ============================================================================
//
// 链路：
//   ① JS 解析真实 demo → 共享内存镜像（tmp/shared-from-js.bin）
//   ② 【本文件】读该镜像 → 构造 DemoData
//   ③ 【本文件】DemoData → writeSharedBuffer → 新镜像（tmp/shared-from-cpp-rt.bin）
//   ④ 【本文件】逐块比对两份镜像的列块与 blob（必须逐字节一致）
//   ⑤ 【node tools/verify-roundtrip.mjs】JS 读新镜像，与原始指纹比对
//
// 编译运行（MSVC）：
//   cl /nologo /std:c++17 /utf-8 /EHsc /W4 roundtrip_test.cpp shared_reader.cpp shared_writer.cpp shared_layout.cpp
//   roundtrip_test tmp\shared-from-js.bin tmp\shared-from-cpp-rt.bin
//
// 退出码 0 = ①②③④ 全过。
// ============================================================================
#include "cpp_paths.h"
#include "shared_layout.h"
#include "shared_reader.h"
#include "shared_writer.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

using namespace csdemo;

namespace {

int g_fails = 0;

void expect(bool ok, const char* what, const std::string& detail = {}) {
    if (ok) {
        std::printf("[PASS] %s%s%s\n", what, detail.empty() ? "" : "  —  ", detail.c_str());
    } else {
        std::printf("[FAIL] %s%s%s\n", what, detail.empty() ? "" : "  —  ", detail.c_str());
        g_fails++;
    }
}

std::vector<std::uint8_t> loadFile(const char* path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error(std::string("cannot open ") + path);
    f.seekg(0, std::ios::end);
    const auto n = static_cast<std::streamsize>(f.tellg());
    f.seekg(0, std::ios::beg);
    std::vector<std::uint8_t> v(static_cast<std::size_t>(n));
    if (n > 0) f.read(reinterpret_cast<char*>(v.data()), n);
    return v;
}

}  // namespace

int main(int argc, char** argv) {
    // 输入/输出路径优先级：argv > $CSDEMO_IMAGE / $CSDEMO_TMP > 默认
    // 输入缺失时 resolveInput 会打印指引并 exit 2（ctest 记成 SKIPPED）
    const std::string inPathStr = csdemo::resolveInput(argc, argv, 1,
        "CSDEMO_IMAGE", "tmp/shared-from-js.bin",
        "JS-produced shared buffer image (shared-from-js.bin)",
        "generate it first:  node tools/gen-js-image.mjs");
    const std::string outPathStr =
        (argc > 2 && argv[2] && *argv[2])
            ? std::string(argv[2])
            : csdemo::joinPath(csdemo::envOr("CSDEMO_TMP", "tmp"), "shared-from-cpp-rt.bin");
    const char* inPath = inPathStr.c_str();
    const char* outPath = outPathStr.c_str();

    std::vector<std::uint8_t> jsImage;
    try {
        jsImage = loadFile(inPath);
    } catch (const std::exception& e) {
        std::printf("[FAIL] %s\n", e.what());
        std::printf("先跑: node tools/gen-js-image.mjs\n");
        return 2;
    }
    std::printf("JS image: %s  %zu bytes (%.2f MB)\n\n", inPath, jsImage.size(), jsImage.size() / 1048576.0);

    // ═══ ② 读 → DemoData ═══
    DemoData d;
    try {
        d = readSharedBufferToDemoData(jsImage.data(), jsImage.size());
        expect(true, "readSharedBufferToDemoData 成功（全量 87MB demo 的数据）");
    } catch (const std::exception& e) {
        expect(false, "readSharedBufferToDemoData 抛异常", e.what());
        return 1;
    }

    std::printf("  read back: N=%u P=%u M=%u flags=0x%x map=%s\n",
                d.meta.numFrames, d.meta.numPlayers, d.panelFrames.numFrames,
                deriveFlags(d), d.meta.mapName.c_str());
    std::printf("             rounds=%zu players=%zu events=%zu\n",
                d.rounds.size(), d.players.size(), d.events.size());
    std::printf("             trajectories=%zu infernos=%zu droppedWeapons=%zu mapEntities=%zu\n",
                d.grenades.trajectories.size(), d.grenades.infernos.size(),
                d.droppedWeapons.size(), d.mapEntities.size());
    std::printf("             tracers=%u damage=%u weaponFires=%zu smokeVoxels=%u\n\n",
                d.tracers.count, d.damage.count, d.weaponFires.ticks.size(), d.smokeVoxels.count);

    // ═══ 结构自检 ═══
    {
        const auto rep = validate(d);
        expect(rep.ok(), "validate() 通过（列长度/索引公式/count 自洽）", rep.ok() ? "" : rep.toString());
    }
    {
        const auto rep = auditRanges(d);
        expect(rep.ok(), "auditRanges() 通过（值域）", rep.ok() ? "" : rep.toString());
    }

    // 全量镜像的可见数应等于容量
    expect(d.meta.numFrames == d.frameCapacity, "meta.numFrames == frameCapacity（全量镜像）",
           std::to_string(d.meta.numFrames) + " vs " + std::to_string(d.frameCapacity));
    expect(d.panelFrames.numFrames == d.panelCapacity, "panelFrames.numFrames == panelCapacity");

    // ═══ ③ 写回 ═══
    WriteResult wr;
    std::vector<std::uint8_t> cppImage;
    try {
        const std::size_t need = sharedBufferBytesFor(d);
        cppImage.assign(need, 0);
        wr = writeSharedBuffer(cppImage.data(), cppImage.size(), d, /*version=*/2);
        expect(true, "writeSharedBuffer 成功", std::to_string(cppImage.size()) + " 字节");
    } catch (const std::exception& e) {
        expect(false, "writeSharedBuffer 抛异常", e.what());
        return 1;
    }

    expect(cppImage.size() == jsImage.size(), "两份镜像总字节相同",
           std::to_string(cppImage.size()) + " vs " + std::to_string(jsImage.size()));

    // ═══ ④ 逐块比对列块 + blob ═══
    {
        Counts counts = deriveCounts(d);
        counts.blobBytes = static_cast<std::uint32_t>(d.smokeVoxels.buffers.size());   // 占位，下面按布局取
        // 直接用读回时的布局重新算一份（与写回时一致）
        LayoutInput in;
        in.numFrames = d.frameCapacity;
        in.numPlayers = d.meta.numPlayers;
        in.panelNumFrames = d.panelCapacity;
        in.flags = deriveFlags(d);

        // blobBytes 需要从两份镜像的 blob 块长度里取（读回时 counts 已经算过）
        // 这里用写回镜像的 blob 块长度反填
        // 先算一次不含 blob 的布局来拿 EXTRA 的块头，再单独处理 blob —— 简化做法：
        // 从 readSharedBufferToDemoData 同样的路径重算 counts.blobBytes
        // （读镜像时已经算过，所以这里直接扫描 header 后的元数据不现实；改为比对时按名字取）

        // 简化且更稳的做法：直接按两份镜像各自的 blob 块长度比对
        // 先算 counts：blobBytes 未知时假设它等于某值会算错布局，
        // 所以直接复用 writer 内部同一套推导 —— 用 planSharedBuffer
        const Plan plan = planSharedBuffer(d);
        const Layout& layout = plan.layout;

        const Block* blobBlock = layout.find("blob");
        const std::size_t blobLen = blobBlock ? blobBlock->length : 0;
        expect(blobLen == 0 || blobLen <= cppImage.size(), "blob 块长度合理", std::to_string(blobLen));

        // 逐块比对（跳过 null 区，只比数据区）
        std::size_t compared = 0, diffs = 0;
        std::string firstDiff;
        for (const auto& b : layout.blocks) {
            if (b.offset + b.length > jsImage.size() || b.offset + b.length > cppImage.size()) {
                diffs++;
                if (firstDiff.empty()) firstDiff = std::string(b.name) + " 越界";
                continue;
            }
            if (std::memcmp(jsImage.data() + b.offset, cppImage.data() + b.offset, b.length) != 0) {
                diffs++;
                if (firstDiff.empty()) {
                    // 找到第一个不同的字节
                    for (std::size_t k = 0; k < b.length; k++) {
                        if (jsImage[b.offset + k] != cppImage[b.offset + k]) {
                            firstDiff = std::string(b.name) + " 第 " + std::to_string(k) + " 字节不同";
                            break;
                        }
                    }
                }
            }
            compared++;
        }
        expect(diffs == 0, "全部块（列块 + blob）逐字节一致",
               std::to_string(compared) + " 块" + (diffs ? "，" + std::to_string(diffs) + " 块不同：" + firstDiff : ""));
    }

    // ═══ 落盘，供 JS 读回 ═══
    {
        csdemo::ensureParentDir(outPath);   // 自定义路径时目录可能不存在
        std::ofstream fout(outPath, std::ios::binary);
        if (!fout) {
            expect(false, "写不出输出镜像", outPath);
            return 1;
        }
        fout.write(reinterpret_cast<const char*>(cppImage.data()), static_cast<std::streamsize>(cppImage.size()));
        std::printf("\n  C++ image written: %s  %zu bytes\n", outPath, cppImage.size());
        std::printf("  next: node tools/verify-roundtrip.mjs\n");
    }

    std::printf("\n%s\n", g_fails ? "FAIL: roundtrip 有差异" : "OK: C++ 读→构造→写 往返一致");
    return g_fails ? 1 : 0;
}
