// ContractFeed 冒烟测试：灌库 → 生成契约内存块 → 落盘（供 Node 侧 shared-buffer.js 校验）。
// 用法：cs2_contract_smoke.exe [demo.dem] [输出.bin]
#include <cstdio>
#include <chrono>
#include <fstream>
#include <vector>

#include "cs2/ContractFeed.hpp"
#include "cs2/DemoLoader.hpp"

using namespace demoviewer;

int main(int argc, char** argv) {
    const char* path = argc > 1 ? argv[1] : "D:/workfolder/Shin-Apps/resource/42k-Dust2.dem";
    const char* outPath = argc > 2 ? argv[2] : "contract_segment.bin";

    EntityStore store;
    DemoMeta meta;
    std::string error;
    auto t0 = std::chrono::steady_clock::now();
    if (!DemoLoader::Load(path, store, meta, {}, error)) {
        printf("LOAD FAILED: %s\n", error.c_str());
        return 1;
    }
    auto loadMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - t0).count();
    printf("[1] loaded in %lld ms. map=%s maxTick=%u rounds=%zu grenades…\n",
           (long long)loadMs, meta.mapName.c_str(), meta.maxTick, store.Rounds().size());

    // 分配共享内存块
    const std::size_t need = ContractFeed::RequiredBytes(store);
    printf("[2] RequiredBytes = %.1f MB\n", need / 1048576.0);
    std::vector<std::uint8_t> buffer(need, 0);

    auto t1 = std::chrono::steady_clock::now();
    const auto res = ContractFeed::WriteAll(store, buffer.data(), buffer.size(), 0);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                  std::chrono::steady_clock::now() - t1).count();
    if (res.messageJson.empty()) {
        printf("WRITE FAILED（bytesUsed=0）\n");
        return 1;
    }
    printf("[3] WriteAll in %lld ms. used=%.1f MB metaA=%d\n",
           (long long)ms, res.bytesUsed / 1048576.0, (int)res.usedMetaA);
    printf("[4] message = %s\n", res.messageJson.c_str());

    // header 抽查
    auto r32 = [&](std::size_t o) {
        std::uint32_t v; std::memcpy(&v, buffer.data() + o, 4); return v;
    };
    printf("[5] header: magic=0x%08X version=%u startTick=%d endTick=%d N=%d P=%d M=%d flags=0x%X\n",
           r32(0), r32(4),
           [&]{ std::int32_t v; std::memcpy(&v, buffer.data()+8, 4); return v; }(),
           [&]{ std::int32_t v; std::memcpy(&v, buffer.data()+12, 4); return v; }(),
           [&]{ std::int32_t v; std::memcpy(&v, buffer.data()+16, 4); return v; }(),
           [&]{ std::int32_t v; std::memcpy(&v, buffer.data()+20, 4); return v; }(),
           [&]{ std::int32_t v; std::memcpy(&v, buffer.data()+24, 4); return v; }(),
           r32(28));

    // 元数据 JSON 抽查
    std::uint32_t jsonLen;
    std::memcpy(&jsonLen, buffer.data() + ContractFeed::kMetaAOffset, 4);
    printf("[6] meta JSON = %u bytes\n", jsonLen);

    // 落盘（只写实际用到的字节，供 Node 校验）
    std::ofstream f(outPath, std::ios::binary);
    f.write(reinterpret_cast<const char*>(buffer.data()),
            static_cast<std::streamsize>(res.bytesUsed));
    f.close();
    printf("[7] written %s (%zu bytes). ALL PASS\n", outPath, res.bytesUsed);
    return 0;
}
