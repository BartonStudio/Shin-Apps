// ============================================================================
// writer_test.cpp —— 验证 shared_writer：C++ 写出的共享内存能被 JS 读回
// ============================================================================
//
// 做法：构造一份确定性的小 DemoData → writeSharedBuffer() 写到文件 →
//       用 tools/test-shared-buffer-from-cpp.mjs 让 JS 侧的 buildDataFromSharedBuffer
//       读回来逐字段比对。
//
// 这是**跨语言**验证：证明 C++ 的写和 JS 的读用的是同一套布局与协议。
//
// 编译运行（MSVC）：
//   cl /nologo /std:c++17 /utf-8 /EHsc /W4 writer_test.cpp shared_writer.cpp shared_layout.cpp /Fe:writer_test.exe
//   writer_test ..\tmp\shared-from-cpp.bin
//   node tools/test-shared-buffer-from-cpp.mjs
//
// 退出码 0 = 本文件的断言全过（JS 侧的比对另由 node 脚本给出）。
// ============================================================================
#include "cpp_paths.h"
#include "shared_writer.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <vector>

using namespace csdemo;

namespace {

int g_fails = 0;

void expect(bool ok, const char* what) {
    if (ok) {
        std::printf("[PASS] %s\n", what);
    } else {
        std::printf("[FAIL] %s\n", what);
        g_fails++;
    }
}

/// 造一份确定性的小数据：3 帧、2 玩家、2 面板帧。
/// 数值全部可预测，方便 JS 侧断言。
DemoData makeSample() {
    DemoData d;
    d.meta.mapName = "de_dust2";
    d.meta.tickRate = 64;
    d.meta.sampleRate = 64;
    d.meta.numPlayers = 2;
    d.meta.numFrames = 3;
    d.meta.startTick = 1000;
    d.meta.endTick = 1002;
    d.meta.durationSeconds = 2.0 / 64.0;
    d.frameCapacity = 3;
    d.panelCapacity = 2;

    d.players.resize(2);
    d.players[0] = Player{0, "76561197962984717", " Cx330.o", std::string("TEAM A"), std::string("blue"), std::nullopt};
    d.players[1] = Player{1, "76561197962984718", " 山月", std::nullopt, std::string("purple"), std::nullopt};

    const std::size_t NP = 3 * 2;   // N*P = 6

    // frameTick 严格升序的绝对 tick
    d.frames.frameTick = {1000, 1001, 1002};
    d.frames.posX = {1.5f, 2.5f, 3.5f, 4.5f, 5.5f, 6.5f};
    d.frames.posY = {-1.5f, -2.5f, -3.5f, -4.5f, -5.5f, -6.5f};
    d.frames.posZ = {10.f, 20.f, 30.f, 40.f, 50.f, 60.f};
    d.frames.yaw = {-179.5f, 0.f, 45.25f, 120.f, -90.f, 179.75f};   // 度，(-180,180]
    d.frames.pitch = {-30.f, 10.f, 45.f, 88.5f, -63.5f, 0.f};
    d.frames.health = {100, 87, 55, 12, 0, 100};
    d.frames.alive = {1, 1, 1, 0, 1, 1};
    d.frames.team = {2, 2, 3, 3, 0, 2};
    d.frames.score = {0, 1, 2, 3, 4, 5};
    d.frames.duck = {0.f, 0.25f, 0.5f, 0.75f, 1.f, 0.f};
    d.frames.flash = {0.5f, 0.f, 1.25f, 2.f, 0.f, 0.75f};
    d.frames.flashAlpha = {0.1f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f};
    d.frames.zoom = {0, 1, 2, 0, 1, 2};
    d.frames.accuracyPenalty = {-1.f, 0.5f, 0.75f, -1.f, 1.25f, 0.f};
    d.frames.reloading = {0, 1, 0, 0, 1, 0};
    d.frames.playerFlags = {0, 4, 0, 0, 4, 0};
    d.frames.speed = {0.f, 166.5f, 240.25f, 310.75f, 0.f, 120.5f};
    d.frames.smoothSpeed = {0.f, 150.25f, 220.f, 286.5f, 0.f, 100.75f};
    (void)NP;

    const std::size_t MP = 2 * 2;   // M*P = 4
    d.panelFrames.numFrames = 2;
    d.panelFrames.frameTick = {1000, 1001};
    d.panelFrames.health = {100, 87, 55, 12};
    d.panelFrames.alive = {1, 1, 1, 0};
    d.panelFrames.team = {2, 2, 3, 3};
    d.panelFrames.armor = {100, 50, 0, 0};
    d.panelFrames.flags = {3, 1, 2, 0};
    d.panelFrames.money = {800, 4700, 250, 3200};
    d.panelFrames.clipAmmo = {30, 12, 0, 7};
    d.panelFrames.reserveAmmo = {90, 36, 0, 21};
    d.panelFrames.activeWeapon = {0, 1, 2, 0};
    d.panelFrames.utilCounts = {0, 3, 1, 0};
    (void)MP;

    d.weaponNames = {"", "AK-47", "Smoke Grenade"};

    d.rounds = {Round{0, 1000, 1002, 1000}};

    // 一个 kill 事件 + 一个 round_end
    GameEvent kill;
    kill.tick = 1001;
    kill.time = (1001 - 1000) / 64.0;
    kill.type = EventType::Kill;
    kill.victimSlot = 1;
    kill.attackerSlot = 0;
    kill.assisterSlot = std::nullopt;      // 模拟 undefined（JSON 里不出现）
    kill.victimName = " 山月";
    kill.attackerName = " Cx330.o";
    kill.victimTeam = std::uint8_t{3};
    kill.attackerTeam = std::uint8_t{2};
    kill.weapon = "ak47";
    kill.headshot = true;
    kill.wallbang = false;
    d.events.push_back(kill);

    GameEvent re;
    re.tick = 1002;
    re.time = (1002 - 1000) / 64.0;
    re.type = EventType::RoundEnd;
    re.roundWinner = std::uint8_t{2};
    re.roundReason = std::uint32_t{7};
    d.events.push_back(re);

    // 一条手雷轨迹（2 个采样点）
    GrenadeTrajectory tr;
    tr.kind = GrenadeKind::Smoke;
    tr.throwerSlot = 0;
    tr.startTick = 1000;
    tr.endTick = 1002;
    tr.detonationTick = std::int32_t{1002};
    tr.posXYZ = {1.f, 2.f, 3.f, 4.f, 5.f, 6.f};
    tr.ticks = {1000, 1002};
    tr.angles = std::vector<float>{0.f, 0.f, 0.f, 10.f, 20.f, 30.f};
    tr.incendiary = false;
    d.grenades.trajectories.push_back(tr);

    GrenadeEffect eff;
    eff.kind = GrenadeKind::Smoke;
    eff.x = 4.f; eff.y = 5.f; eff.z = 6.f;
    eff.startTick = 1002;
    eff.endTick = 1002 + 960;
    d.grenades.effects.push_back(eff);

    Inferno inf;
    inf.entityId = 639;
    inf.startTick = 1002;
    inf.endTick = 1100;
    inf.effectTick = std::int32_t{15048};
    inf.infernoType = std::uint32_t{1};
    inf.lifetime = 5.5f;
    InfernoFrame f0;
    f0.tick = 1002;
    f0.positions = {7.f, 8.f, 9.f};
    f0.burning = {1};
    f0.origin = {7.5f, 8.5f, 9.5f};
    inf.frames.push_back(f0);
    d.grenades.infernos.push_back(inf);

    // 区间数据
    d.tracers.count = 1;
    d.tracers.origin = {1.f, 2.f, 3.f};
    d.tracers.end = {11.f, 12.f, 13.f};
    d.tracers.tick = {1001};
    d.tracers.team = {2};
    d.tracers.hitKind = {1};

    d.damage.count = 1;
    d.damage.attackerSlot = {0};
    d.damage.victimSlot = {1};
    d.damage.tick = {1001};
    d.damage.dmg = {100};

    d.weaponFires.ticks = {1001, 1002};
    d.weaponFires.slots = {0, 1};

    d.smokeVoxels.count = 1;
    d.smokeVoxels.tickBegin = {1002};
    d.smokeVoxels.detonation = {4.f, 5.f, 6.f};
    d.smokeVoxels.color = {0.5f, 0.5f, 0.5f};
    d.smokeVoxels.bufferOffsets = {0, 4};
    d.smokeVoxels.buffers = {1, 2, 3, 4};
    d.smokeVoxels.frameOffsets = {0, 1};
    d.smokeVoxels.frameTicks = {1002};

    // 元数据对象
    d.bomb.segments.push_back(BombSegment{BombSegmentKind::Dropped, 1000, 1002, -1181.f, -754.f, 120.18f, -1, BombSite::None});
    d.bomb.defuses.push_back(BombDefuse{1001, 1002, true, 0});
    d.deathMarkers.push_back(DeathMarker{-164.21f, 845.9f, 1.37f, 1001, 1002, 1, 3, " 山月"});
    d.timeouts.maxTacticalTimeouts = 2;
    d.timeouts.intervals.push_back(TimeoutInterval{1000, 1001, TimeoutSide::T, false});
    d.timeouts.counters.push_back(TimeoutCounter{1000, 2, 2});
    d.deathRagdolls.push_back(DeathRagdoll{1001, 1, {7670.49f, -24820.7f, 1047.14f}, 7, true, {2.375f, 106.8125f}});
    d.droppedWeapons.push_back(DroppedWeapon{449, "Nomad Knife", 521, 1000, 1002, {1000, 1001}, {1.f, 2.f, 3.f, 4.f, 5.f, 6.f}, {0.f, 0.f, 0.f, 1.f, 1.f, 1.f}});
    d.mapEntities.push_back(MapEntity{"CFuncBrush", {-1320.f, 2619.f, 160.f}, 1000, 1002, {1000, 1001}, {0.f, 0.f, 0.f, 1.f, 1.f, 1.f}, {0, 0}});

    return d;
}

}  // namespace

int main(int argc, char** argv) {
    // 输出路径优先级：argv[1] > $CSDEMO_TMP/shared-from-cpp.bin > ../tmp/shared-from-cpp.bin
    const std::string outPathStr =
        (argc > 1 && argv[1] && *argv[1]) ? std::string(argv[1])
                                          : csdemo::joinPath(csdemo::envOr("CSDEMO_TMP", "../tmp"), "shared-from-cpp.bin");
    const char* outPath = outPathStr.c_str();
    const DemoData d = makeSample();

    // ── 校验 ──
    const auto rep = validate(d);
    if (!rep.ok()) {
        std::printf("[FAIL] validate\n%s", rep.toString().c_str());
        return 1;
    }
    expect(true, "validate() passes on sample data");
    const auto ranges = auditRanges(d);
    expect(ranges.ok(), "auditRanges() passes on sample data");

    // ── 规划 ──
    Plan plan;
    try {
        plan = planSharedBuffer(d);
    } catch (const std::exception& e) {
        std::printf("[FAIL] planSharedBuffer threw: %s\n", e.what());
        return 1;
    }
    std::printf("\n  plan: N=%u P=%u M=%u flags=0x%x blocks=%zu bytes=%zu blob=%zu metaJson=%zu\n",
                plan.N, plan.P, plan.M, plan.flags, plan.layout.blocks.size(),
                plan.bytes, plan.blob.size(), plan.metaJson.size());

    expect(plan.bytes == sharedBufferBytesFor(d), "plan.bytes == sharedBufferBytesFor(d)");
    expect(plan.layout.blocks.size() == 49, "block count == 49 (all flags on)");

    // ── 写入 ──
    std::vector<std::uint8_t> buf(plan.bytes, 0);
    WriteResult wr;
    try {
        wr = writeSharedBuffer(buf.data(), buf.size(), d, /*version=*/2);
    } catch (const std::exception& e) {
        std::printf("[FAIL] writeSharedBuffer threw: %s\n", e.what());
        return 1;
    }
    expect(wr.bytes == plan.bytes, "WriteResult.bytes matches plan");
    expect(wr.blocksCopied == 48, "48 column blocks copied (49th is blob)");
    expect(wr.usedMetaA, "version=2 (even) writes meta region A");

    // ── header 自检 ──
    {
        std::uint32_t magic = 0, ver = 0;
        std::int32_t startTick = 0, endTick = 0, N = 0, P = 0, M = 0, flags = 0;
        std::memcpy(&magic, buf.data() + 0, 4);
        std::memcpy(&ver, buf.data() + 4, 4);
        std::memcpy(&startTick, buf.data() + 8, 4);
        std::memcpy(&endTick, buf.data() + 12, 4);
        std::memcpy(&N, buf.data() + 16, 4);
        std::memcpy(&P, buf.data() + 20, 4);
        std::memcpy(&M, buf.data() + 24, 4);
        std::memcpy(&flags, buf.data() + 28, 4);
        expect(magic == kCsdfMagic, "header magic == 'CSDF'");
        expect(ver == kCsdfVersion, "header version == 1");
        expect(startTick == 1000, "header startTick == 1000");
        expect(endTick == 1002, "header endTick == 1002");
        expect(N == 3 && P == 2 && M == 2, "header N/P/M == 3/2/2");
        expect(flags == 0x3f, "header flags == 0x3f (all optional on)");
    }

    // ── 列内容自检（随机抽几列比对）──
    {
        const Block& b = plan.layout.at("speed");
        std::vector<float> got(b.count);
        std::memcpy(got.data(), buf.data() + b.offset, b.length);
        expect(got == d.frames.speed, "block 'speed' content round-trips");
    }
    {
        const Block& b = plan.layout.at("panelMoney");
        std::vector<std::uint16_t> got(b.count);
        std::memcpy(got.data(), buf.data() + b.offset, b.length);
        expect(got == d.panelFrames.money, "block 'panelMoney' content round-trips");
    }

    // ── 元数据区自检：长度前缀 + JSON 首尾 ──
    {
        std::uint32_t len = 0;
        std::memcpy(&len, buf.data() + kMetaAOffset, 4);
        expect(len == plan.metaJson.size(), "meta region A: length prefix matches json size");
        std::string got(reinterpret_cast<const char*>(buf.data() + kMetaAOffset + 4), len);
        expect(got == plan.metaJson, "meta region A: bytes match json");
        expect(!got.empty() && got.front() == '{' && got.back() == '}', "meta json is a balanced object");
        expect(got.find("\"blobBytes\":") != std::string::npos, "meta json contains blobBytes");
        expect(got.find("\"startTick\":1000") != std::string::npos, "meta json contains startTick");
    }

    // ── 落盘给 JS 侧读 ──
    {
        csdemo::ensureParentDir(outPath);   // 自定义 --tmp / $CSDEMO_TMP 时目录可能不存在
        std::ofstream fout(outPath, std::ios::binary);
        if (!fout) {
            std::printf("[FAIL] cannot open %s for writing\n", outPath);
            return 1;
        }
        fout.write(reinterpret_cast<const char*>(buf.data()), static_cast<std::streamsize>(buf.size()));
        fout.close();
        std::printf("\n  wrote %zu bytes -> %s\n", buf.size(), outPath);
        std::printf("  next: node tools/test-shared-buffer-from-cpp.mjs\n");
    }

    // ── 越界防护 ──
    {
        bool threw = false;
        try {
            std::vector<std::uint8_t> small(16, 0);
            writeSharedBuffer(small.data(), small.size(), d, 2);
        } catch (const std::length_error&) { threw = true; } catch (...) {}
        expect(threw, "writeSharedBuffer throws length_error on undersized buffer");
    }

    // ── 元数据区 A/B 交替 ──
    {
        std::vector<std::uint8_t> buf2(plan.bytes, 0);
        const auto wr2 = writeSharedBuffer(buf2.data(), buf2.size(), d, /*version=*/3);
        expect(!wr2.usedMetaA, "version=3 (odd) writes meta region B");
        std::uint32_t lenA = 0, lenB = 0;
        std::memcpy(&lenA, buf2.data() + kMetaAOffset, 4);
        std::memcpy(&lenB, buf2.data() + kMetaBOffset, 4);
        expect(lenA == 0 && lenB == plan.metaJson.size(), "odd version left A empty and filled B");
    }

    std::printf("\n%s\n", g_fails ? "FAIL: some assertions failed" : "OK: all assertions passed");
    return g_fails ? 1 : 0;
}
