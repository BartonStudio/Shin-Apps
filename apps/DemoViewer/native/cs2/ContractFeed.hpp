#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

#include "EntityStore.hpp"
#include "EntityTypes.hpp"

// =============================================================================
// ContractFeed —— EntityStore → 前端播放器数据契约（CSDF v1 + shared-buffer 扩展）
//
// 这是 web/src/deobfuscated/shared-buffer.js 的 C++ 侧镜像实现，两者必须逐字节
// 对齐（列顺序 / 64 字节对齐 / 元数据 JSON 键 / blob 引用格式）。改动任何一侧，
// 必须同步另一侧并用 tools/validate-contract.mjs 交叉校验。
//
// 内存布局（与 shared-buffer.js 头注释一致）：
//   [0, 64)           CSDF v1 header（64 字节，小端，最后写 = 提交）
//   [64, 64+1MB)      元数据区 A（u32 len + utf8 JSON + 补 0）
//   [64+1MB, 64+2MB)  元数据区 B（同上；A/B 按 version 奇偶交替，防撕裂）
//   [64+2MB, …)       列块数据区（每块起点 64 字节对齐）+ blob 区
//
// 陷阱清单（docs/07 §10 + 实现核对）：
//   - yaw/pitch 是角度制（demo 原生就是角度制，不做转换）
//   - steamId 必须字符串；team 0=未参战；speed/smoothSpeed 算法逐字复刻
// =============================================================================

namespace demoviewer {

class ContractFeed {
public:
    // ---- 布局常量（与 shared-buffer.js 严格一致）----
    static constexpr std::uint32_t kMagic = 0x46445343;  // 'CSDF'
    static constexpr std::uint32_t kVersion = 1;
    static constexpr std::size_t kHeaderBytes = 64;
    static constexpr std::size_t kAlign = 64;
    static constexpr std::size_t kMetaRegionBytes = 1 << 20;
    static constexpr std::size_t kMetaAOffset = kHeaderBytes;
    static constexpr std::size_t kMetaBOffset = kMetaAOffset + kMetaRegionBytes;
    static constexpr std::size_t kDataOffset = kMetaBOffset + kMetaRegionBytes;

    static constexpr std::uint32_t kFlagAccuracy = 1u << 0;
    static constexpr std::uint32_t kFlagReloading = 1u << 1;
    static constexpr std::uint32_t kFlagPlayerFlags = 1u << 2;
    static constexpr std::uint32_t kFlagPanels = 1u << 3;
    static constexpr std::uint32_t kFlagSpeed = 1u << 4;
    static constexpr std::uint32_t kFlagSmoothSpeed = 1u << 5;

    /// 面板帧采样间隔（原工程 panelFrames 是 8 tick）
    static constexpr Tick kPanelStride = 8;

    // ---- 写入结果 ----
    struct WriteResult {
        std::string messageJson;  // 回合水位消息（PostWebMessageAsJson 的内容）
        std::size_t bytesUsed = 0;
        bool usedMetaA = true;
    };

    /// 把整场数据写进 [buffer, buffer+size)。version 单调递增（奇偶选元数据区）。
    /// 前置条件：size >= RequiredBytes(store)。
    static WriteResult WriteAll(const EntityStore& store, void* buffer, std::size_t size,
                                std::uint32_t version) {
        // ---- 0. 基本量 ----
        std::vector<EntityId> ids = store.PlayerIds();
        std::sort(ids.begin(), ids.end());  // slot 顺序稳定（unordered_map 无序）
        const std::size_t P = ids.size();
        const Tick maxTick = store.MaxTick();
        const std::size_t N = static_cast<std::size_t>(maxTick) + 1;  // 每 tick 一帧，含 0
        const std::size_t M = static_cast<std::size_t>(maxTick) / kPanelStride + 1;

        std::unordered_map<EntityId, std::size_t> slotOf;
        for (std::size_t p = 0; p < P; ++p) slotOf.emplace(ids[p], p);

        const std::uint32_t flags = kFlagPanels | kFlagSpeed | kFlagSmoothSpeed;

        // ---- 1. 列数据（先算数据，再算 blob，最后算布局——顺序不可换）----
        FramesData fd = BuildFrames(store, ids, N, P);
        PanelsData pd = BuildPanels(store, ids, M, P);
        JsonAndBlob jb = BuildMetaAndBlob(store, ids, slotOf, maxTick);

        // ---- 2. 布局（与 shared-buffer.js computeSharedLayout 逐块一致）----
        Counts counts = jb.counts;
        std::vector<Block> blocks;
        std::size_t off = kDataOffset;
        auto push = [&](const char* name, const char* type, std::size_t bytes) {
            const std::size_t padded = AlignUp(bytes, kAlign);
            blocks.push_back(Block{name, type, off, bytes, padded});
            off += padded;
        };
        auto np = [&] { return N * P; };
        auto mp = [&] { return M * P; };
        // frames（14 必需块，顺序与 FRAME_COLS 一致）
        push("frameTick", "i32", N * 4);
        push("posX", "f32", np() * 4); push("posY", "f32", np() * 4); push("posZ", "f32", np() * 4);
        push("yaw", "f32", np() * 4);  push("pitch", "f32", np() * 4);
        push("health", "u8", np()); push("alive", "u8", np());
        push("team", "u8", np());   push("score", "u8", np());
        push("duck", "f32", np() * 4); push("flash", "f32", np() * 4);
        push("flashAlpha", "f32", np() * 4); push("zoom", "u8", np());
        // frames 可选块（按 flags）
        if (flags & kFlagSpeed) push("speed", "f32", np() * 4);
        if (flags & kFlagSmoothSpeed) push("smoothSpeed", "f32", np() * 4);
        // panelFrames（flags & kFlagPanels，11 块）
        push("panelFrameTick", "i32", M * 4);
        push("panelHealth", "u8", mp()); push("panelAlive", "u8", mp());
        push("panelTeam", "u8", mp());   push("panelArmor", "u8", mp());
        push("panelFlags", "u8", mp());
        push("panelMoney", "u16", mp() * 2); push("panelClipAmmo", "u16", mp() * 2);
        push("panelReserveAmmo", "u16", mp() * 2);
        push("panelActiveWeapon", "u8", mp()); push("panelUtilCounts", "u8", mp());
        // 区间数据（本实现全 0 条目，但块必须存在——JS 按名字查）
        push("tracers.origin", "f32", counts.tracers * 3 * 4);
        push("tracers.end", "f32", counts.tracers * 3 * 4);
        push("tracers.tick", "i32", counts.tracers * 4);
        push("tracers.team", "u8", counts.tracers);
        push("tracers.hitKind", "u8", counts.tracers);
        push("damage.attackerSlot", "u8", counts.damage);
        push("damage.victimSlot", "u8", counts.damage);
        push("damage.tick", "i32", counts.damage * 4);
        push("damage.dmg", "u8", counts.damage);
        push("weaponFires.ticks", "i32", counts.weaponFires * 4);
        push("weaponFires.slots", "u8", counts.weaponFires);
        push("smokeVoxels.tickBegin", "i32", counts.smokeCount * 4);
        push("smokeVoxels.detonation", "f32", counts.smokeCount * 3 * 4);
        push("smokeVoxels.color", "f32", counts.smokeCount * 3 * 4);
        push("smokeVoxels.bufferOffsets", "i32", counts.smokeCountPlus1 * 4);
        push("smokeVoxels.frameOffsets", "i32", counts.smokeCountPlus1 * 4);
        push("smokeVoxels.buffers", "u8", counts.smokeBufferBytes);
        push("smokeVoxels.frameTicks", "i32", counts.smokeFrameTicks * 4);
        // blob 区
        const std::size_t blobPadded = AlignUp(counts.blobBytes, 8);
        if (counts.blobBytes > 0) {
            blocks.push_back(Block{"blob", "u8", off, counts.blobBytes, blobPadded});
            off += blobPadded;
        }

        const std::size_t totalBytes = AlignUp(off, kAlign);
        if (size < totalBytes) {
            return WriteResult{.messageJson = "", .bytesUsed = 0, .usedMetaA = true};  // 不够：调用方先扩
        }
        auto* base = static_cast<std::uint8_t*>(buffer);
        std::memset(base, 0, totalBytes);

        auto blockOf = [&](const char* name) -> const Block* {
            for (const auto& b : blocks) {
                if (b.name == name) return &b;
            }
            return nullptr;
        };
        auto putVec = [&](const char* name, const auto& vec) {
            const Block* b = blockOf(name);
            if (!b) return;
            using T = typename std::remove_reference_t<decltype(vec)>::value_type;
            std::memcpy(base + b->offset, vec.data(), vec.size() * sizeof(T));
        };

        // ---- 3. 写列块 ----
        putVec("frameTick", fd.frameTick);
        putVec("posX", fd.posX); putVec("posY", fd.posY); putVec("posZ", fd.posZ);
        putVec("yaw", fd.yaw);   putVec("pitch", fd.pitch);
        putVec("health", fd.health); putVec("alive", fd.alive);
        putVec("team", fd.team);     putVec("score", fd.score);
        putVec("duck", fd.duck);     putVec("flash", fd.flash);
        putVec("flashAlpha", fd.flashAlpha); putVec("zoom", fd.zoom);
        putVec("speed", fd.speed);   putVec("smoothSpeed", fd.smoothSpeed);
        putVec("panelFrameTick", pd.frameTick);
        putVec("panelHealth", pd.health); putVec("panelAlive", pd.alive);
        putVec("panelTeam", pd.team);     putVec("panelArmor", pd.armor);
        putVec("panelFlags", pd.flags);
        putVec("panelMoney", pd.money);   putVec("panelClipAmmo", pd.clipAmmo);
        putVec("panelReserveAmmo", pd.reserveAmmo);
        putVec("panelActiveWeapon", pd.activeWeapon); putVec("panelUtilCounts", pd.utilCounts);

        // ---- 4. 写 blob ----
        if (const Block* blobBlock = blockOf("blob")) {
            for (const auto& part : jb.blobParts) {
                std::memcpy(base + blobBlock->offset + part.offset, part.bytes.data(),
                            part.bytes.size());
            }
        }

        // ---- 5. 写元数据区（version 奇偶选 A/B）----
        jb.meta["counts"] = CountsJson(counts);
        const std::string json = jb.meta.dump();
        const bool useA = version % 2 == 0;
        const std::size_t metaOff = useA ? kMetaAOffset : kMetaBOffset;
        if (json.size() + 4 > kMetaRegionBytes) {
            return WriteResult{.messageJson = "", .bytesUsed = 0, .usedMetaA = true};
        }
        const std::uint32_t jsonLen = static_cast<std::uint32_t>(json.size());
        std::memcpy(base + metaOff, &jsonLen, 4);
        std::memcpy(base + metaOff + 4, json.data(), json.size());

        // ---- 6. 写 header（最后 = 提交；对齐 writeSharedBuffer 的字段布局）----
        auto w32 = [&](std::size_t o, std::uint32_t v) { std::memcpy(base + o, &v, 4); };
        auto wI32 = [&](std::size_t o, std::int32_t v) { std::memcpy(base + o, &v, 4); };
        auto w64 = [&](std::size_t o, std::uint64_t v) { std::memcpy(base + o, &v, 8); };
        w32(0, kMagic);
        w32(4, kVersion);
        wI32(8, static_cast<std::int32_t>(jb.startTick));
        wI32(12, static_cast<std::int32_t>(maxTick));
        wI32(16, static_cast<std::int32_t>(N));
        wI32(20, static_cast<std::int32_t>(P));
        wI32(24, static_cast<std::int32_t>(M));
        wI32(28, static_cast<std::int32_t>(flags));
        w32(32, 0);  // crc32：共享内存场景不做全量校验
        w32(36, 0);
        w64(40, layoutPayloadBytes(blocks, totalBytes));
        w64(48, totalBytes);
        w64(56, 0);

        // ---- 7. 水位消息 ----
        nlohmann::json msg = {
            {"version", version},
            {"loadedRounds", store.Rounds().size()},
            {"visibleFrames", N},
            {"panelVisibleFrames", M},
            {"durationSeconds", static_cast<double>(maxTick - jb.startTick) / 64.0},
        };
        return WriteResult{.messageJson = msg.dump(), .bytesUsed = totalBytes, .usedMetaA = useA};
    }

    /// 需要的共享内存字节数（调用方按它分配）。
    static std::size_t RequiredBytes(const EntityStore& store) {
        const std::size_t P = store.PlayerIds().size();
        const std::size_t N = static_cast<std::size_t>(store.MaxTick()) + 1;
        const std::size_t M = static_cast<std::size_t>(store.MaxTick()) / kPanelStride + 1;
        const std::uint32_t flags = kFlagPanels | kFlagSpeed | kFlagSmoothSpeed;
        // 粗算（不含 blob/grenade 数据，blobs 由第一次 WriteAll 后才知道）——
        // 这里加一个 blob 预留常量。真实 demo 的 blob ≈ 数 MB。
        std::size_t off = kDataOffset;
        auto np = [&] { return N * P; };
        auto mp = [&] { return M * P; };
        auto add = [&](std::size_t bytes) { off += AlignUp(bytes, kAlign); };
        add(N * 4);
        add(np() * 4 * 3 + np() * 4 * 2);          // pos*3 + yaw/pitch
        add(np() * 4);                             // health/alive/team/score
        add(np() * 4 * 3);                         // duck/flash/flashAlpha
        add(np());                                 // zoom
        add(np() * 4 * 2);                         // speed/smoothSpeed
        add(M * 4);
        add(mp() * 5);                             // panel u8 ×5
        add(mp() * 2 * 3);                         // panel u16 ×3
        add(mp() * 2);                             // panel u8 ×2
        // 区间数据全 0：每块至少占一个对齐槽（17 块）
        for (int i = 0; i < 17; ++i) add(0);
        add(kBlobReserveBytes);
        return AlignUp(off, kAlign);
    }

private:
    static constexpr std::size_t kBlobReserveBytes = 8u << 20;  // blob 预留 8MB

    struct Block {
        std::string name;
        const char* type;
        std::size_t offset;
        std::size_t length;
        std::size_t padded;
    };

    struct Counts {
        std::size_t tracers = 0;
        std::size_t damage = 0;
        std::size_t weaponFires = 0;
        std::size_t smokeCount = 0;
        std::size_t smokeCountPlus1 = 1;
        std::size_t smokeBufferBytes = 0;
        std::size_t smokeFrameTicks = 0;
        std::size_t blobBytes = 0;
    };

    static nlohmann::json CountsJson(const Counts& c) {
        return {
            {"tracers", c.tracers},         {"damage", c.damage},
            {"weaponFires", c.weaponFires}, {"smokeCount", c.smokeCount},
            {"smokeCountPlus1", c.smokeCountPlus1},
            {"smokeBufferBytes", c.smokeBufferBytes},
            {"smokeFrameTicks", c.smokeFrameTicks},
            {"blobBytes", c.blobBytes},
        };
    }

    static std::size_t AlignUp(std::size_t n, std::size_t a) {
        return (n + a - 1) / a * a;
    }

    static std::uint64_t layoutPayloadBytes(const std::vector<Block>& blocks, std::size_t total) {
        (void)blocks;
        return static_cast<std::uint64_t>(total - kHeaderBytes);
    }

    // ---- 帧列数据 ----
    struct FramesData {
        std::vector<std::int32_t> frameTick;
        std::vector<float> posX, posY, posZ, yaw, pitch;
        std::vector<std::uint8_t> health, alive, team, score, zoom;
        std::vector<float> duck, flash, flashAlpha;
        std::vector<float> speed, smoothSpeed;
    };

    static FramesData BuildFrames(const EntityStore& store, const std::vector<EntityId>& ids,
                                  std::size_t N, std::size_t P) {
        FramesData fd;
        fd.frameTick.resize(N);
        fd.posX.resize(N * P); fd.posY.resize(N * P); fd.posZ.resize(N * P);
        fd.yaw.resize(N * P);  fd.pitch.resize(N * P);
        fd.health.resize(N * P); fd.alive.resize(N * P);
        fd.team.resize(N * P);   fd.score.resize(N * P); fd.zoom.resize(N * P);
        fd.duck.resize(N * P);   fd.flash.resize(N * P); fd.flashAlpha.resize(N * P);
        fd.speed.resize(N * P);  fd.smoothSpeed.resize(N * P);

        // 每玩家帧指针（PlayerRecord.frames 是 [0, maxTick] 全量快照）
        std::vector<const PlayerSnapshot*> frames(P, nullptr);
        for (std::size_t p = 0; p < P; ++p) {
            const auto* v = store.PlayerFrames(ids[p]);
            if (v && v->size() >= N) frames[p] = v->data();
        }

        for (std::size_t i = 0; i < N; ++i) {
            fd.frameTick[i] = static_cast<std::int32_t>(i);
            for (std::size_t p = 0; p < P; ++p) {
                const std::size_t idx = i * P + p;
                const PlayerSnapshot* s = frames[p] ? frames[p] + i : nullptr;
                fd.posX[idx] = s ? s->pos.x : 0.0f;
                fd.posY[idx] = s ? s->pos.y : 0.0f;
                fd.posZ[idx] = s ? s->pos.z : 0.0f;
                fd.yaw[idx] = s ? s->view.yaw : 0.0f;      // 角度制，不转换
                fd.pitch[idx] = s ? s->view.pitch : 0.0f;
                fd.health[idx] = s ? ClampU8(s->health, 100) : 0;
                fd.alive[idx] = (s && s->alive) ? 1 : 0;
                fd.team[idx] = s ? s->team : 0;
                fd.score[idx] = s ? ClampU8(s->score, 255) : 0;
                fd.zoom[idx] = 0;                           // 未采开镜数据（契约必填列）
                fd.duck[idx] = s ? s->duck : 0.0f;
                fd.flash[idx] = 0.0f;                       // 未采致盲数据
                fd.flashAlpha[idx] = 0.0f;
            }
        }

        const Tick tickRate = 64;
        ComputeSpeedColumns(fd, store, N, P, tickRate);
        return fd;
    }

    static std::uint8_t ClampU8(std::uint32_t v, std::uint8_t hi) {
        return v > hi ? hi : static_cast<std::uint8_t>(v);
    }

    /// speed / smoothSpeed（docs/07 §3.5 逐字复刻；规范实现 src/deobfuscated/speed-columns.js）
    static void ComputeSpeedColumns(FramesData& fd, const EntityStore& store,
                                    std::size_t N, std::size_t P, Tick tickRate) {
        // 回合起点集合（speed 守卫 3）
        std::vector<Tick> roundStarts;
        for (const RoundSpan& r : store.Rounds()) roundStarts.push_back(r.startTick);

        auto hasRoundStartIn = [&](std::int32_t lo, std::int32_t hi) {  // (lo, hi]
            for (Tick t : roundStarts) {
                const auto tt = static_cast<std::int32_t>(t);
                if (tt > lo && tt <= hi) return true;
            }
            return false;
        };

        const double dtRate = static_cast<double>(tickRate);
        // ---- speed：相邻帧水平差分 + 4 条守卫 ----
        for (std::size_t i = 0; i < N; ++i) {
            const std::size_t q = (i + 1 < N) ? i + 1 : N - 1;
            const std::size_t f = (i == q) ? ((i > 0) ? i - 1 : 0) : i;
            const double g = static_cast<double>(fd.frameTick[q] - fd.frameTick[f]) / dtRate;
            const bool guardBase =
                g > 0.0 && g <= 2.0 / 64.0 &&
                !hasRoundStartIn(fd.frameTick[f], fd.frameTick[q]);
            for (std::size_t p = 0; p < P; ++p) {
                const std::size_t a = f * P + p, b = q * P + p;
                if (!guardBase || fd.alive[a] != 1 || fd.alive[b] != 1 ||
                    fd.team[a] != fd.team[b]) {
                    fd.speed[i * P + p] = 0.0f;
                    continue;
                }
                const double dx = static_cast<double>(fd.posX[b]) - fd.posX[a];
                const double dy = static_cast<double>(fd.posY[b]) - fd.posY[a];
                fd.speed[i * P + p] = static_cast<float>(std::hypot(dx, dy) / g);
            }
        }

        // ---- smoothSpeed：过去 1 秒指数加权平均（常量不可改）----
        constexpr double kTau = 0.1;
        constexpr double kWindow = 10.0 * kTau;
        constexpr double kMaxInstant = 600.0;
        constexpr double kMaxFrameDt = 0.25;
        auto ic = [](double x) {
            const double n = x / kTau;
            return 1.0 - (1.0 + n) * std::exp(-n);
        };
        const double icNorm = ic(kWindow);
        // 按玩家逐个精确计算（与 speed-columns.js 一致）
        for (std::size_t p = 0; p < P; ++p) {
            for (std::size_t i = 0; i < N; ++i) {
                const std::int32_t t = fd.frameTick[i];
                std::size_t e = (i < N - 1) ? i : N - 2;
                double acc = 0.0;
                while (true) {
                    const double lo = (t - fd.frameTick[e + 1]) / dtRate;
                    if (lo >= kWindow) break;
                    const double hi = std::min(kWindow, (t - fd.frameTick[e]) / dtRate);
                    if (hi > lo) {
                        const double h = (fd.frameTick[e + 1] - fd.frameTick[e]) / dtRate;
                        if (h > 0.0 && h <= kMaxFrameDt &&
                            fd.alive[e * P + p] == 1 && fd.alive[(e + 1) * P + p] == 1) {
                            const double dx = static_cast<double>(fd.posX[(e + 1) * P + p]) - fd.posX[e * P + p];
                            const double dy = static_cast<double>(fd.posY[(e + 1) * P + p]) - fd.posY[e * P + p];
                            double v = std::hypot(dx, dy) / h;
                            if (v > kMaxInstant) v = 0.0;
                            acc += v * (ic(hi) - ic(lo));
                        }
                    }
                    if (e == 0) break;
                    --e;
                }
                fd.smoothSpeed[i * P + p] = static_cast<float>(acc / icNorm);
            }
        }
    }

    // ---- 面板列数据 ----
    struct PanelsData {
        std::vector<std::int32_t> frameTick;
        std::vector<std::uint8_t> health, alive, team, armor, flags;
        std::vector<std::uint16_t> money, clipAmmo, reserveAmmo;
        std::vector<std::uint8_t> activeWeapon, utilCounts;
    };

    static PanelsData BuildPanels(const EntityStore& store, const std::vector<EntityId>& ids,
                                  std::size_t M, std::size_t P) {
        PanelsData pd;
        pd.frameTick.resize(M);
        pd.health.resize(M * P); pd.alive.resize(M * P); pd.team.resize(M * P);
        pd.armor.resize(M * P);  pd.flags.resize(M * P);
        pd.money.resize(M * P);  pd.clipAmmo.resize(M * P); pd.reserveAmmo.resize(M * P);
        pd.activeWeapon.resize(M * P); pd.utilCounts.resize(M * P);
        for (std::size_t m = 0; m < M; ++m) {
            const Tick t = static_cast<Tick>(m * kPanelStride);
            pd.frameTick[m] = static_cast<std::int32_t>(t);
            for (std::size_t p = 0; p < P; ++p) {
                const std::size_t idx = m * P + p;
                const PlayerSnapshot* s = store.PlayerAt(ids[p], t);
                pd.health[idx] = s ? ClampU8(s->health, 100) : 0;
                pd.alive[idx] = (s && s->alive) ? 1 : 0;
                pd.team[idx] = s ? s->team : 0;
                pd.armor[idx] = s ? s->armor : 0;
                pd.flags[idx] = 0;                          // 未采 flags
                pd.money[idx] = s ? s->money : 0;
                pd.clipAmmo[idx] = s ? s->clipAmmo : 0;
                pd.reserveAmmo[idx] = s ? s->reserveMagazines : 0;
                pd.activeWeapon[idx] = s ? static_cast<std::uint8_t>(std::min<std::uint32_t>(s->weaponNum, 255)) : 0;
                pd.utilCounts[idx] = 0;                     // 未采道具计数
            }
        }
        return pd;
    }

    // ---- blob：变长 TypedArray 顺序拼接（8 字节对齐），JSON 存 {o,n,t} 引用 ----
    struct BlobPart {
        std::size_t offset;
        std::vector<std::uint8_t> bytes;
    };
    struct BlobBuilder {
        std::vector<BlobPart> parts;
        std::size_t bytes = 0;
        nlohmann::json Ref(const void* data, std::size_t elemSize, std::size_t count,
                           const char* type) {
            if (count == 0 || !data) return nullptr;
            const std::size_t o = AlignUp(bytes, 8);
            BlobPart part;
            part.offset = o;
            part.bytes.resize(count * elemSize);
            std::memcpy(part.bytes.data(), data, count * elemSize);
            parts.push_back(std::move(part));
            bytes = o + count * elemSize;
            return {{"o", o}, {"n", count}, {"t", type}};
        }
    };

    struct JsonAndBlob {
        nlohmann::json meta;
        std::vector<BlobPart> blobParts;
        Counts counts;
        std::int32_t startTick = 0;
    };

    static JsonAndBlob BuildMetaAndBlob(const EntityStore& store,
                                        const std::vector<EntityId>& ids,
                                        const std::unordered_map<EntityId, std::size_t>& slotOf,
                                        Tick maxTick) {
        JsonAndBlob out;
        BlobBuilder blob;
        out.startTick = 0;  // 整场导出，起点恒 0（demo 首帧）

        // rounds（manifest + meta 共用一份）
        nlohmann::json rounds = nlohmann::json::array();
        for (const RoundSpan& r : store.Rounds()) {
            rounds.push_back({
                {"index", r.index},
                {"startTick", r.startTick},
                {"endTick", r.endTick},
                {"liveStartTick", r.liveStartTick},
            });
        }

        // players
        nlohmann::json players = nlohmann::json::array();
        for (std::size_t p = 0; p < ids.size(); ++p) {
            const PlayerIdentity* ident = store.IdentityAt(ids[p]);
            players.push_back({
                {"slot", p},
                {"steamId", ident ? ident->steamId : ""},   // 必须字符串（>2^53）
                {"name", ident ? ident->name : ""},
            });
        }

        // weaponNames：[0] 恒为空串，武器目录从 1 开始对齐
        nlohmann::json weaponNames = nlohmann::json::array();
        weaponNames.push_back("");
        for (const WeaponId& w : store.WeaponCatalog()) weaponNames.push_back(w);

        // events（type: kill / round_start / round_end / bomb_planted / bomb_defused / bomb_exploded）
        nlohmann::json events = nlohmann::json::array();
        auto timeOf = [&](Tick t) { return static_cast<double>(t - out.startTick) / 64.0; };
        for (const KillEvent& k : store.KillEvents()) {
            nlohmann::json ev = {
                {"tick", k.tick},
                {"time", timeOf(k.tick)},
                {"type", "kill"},
                {"victimSlot", SlotOf(slotOf, k.victim)},
                {"attackerSlot", k.killer ? SlotOf(slotOf, k.killer) : -1},
                {"assisterSlot", -1},                       // 未采助攻者（KillEvent 无此字段）
                {"weapon", k.weapon},
                {"headshot", k.headshot},
                {"noscope", false}, {"thrusmoke", false},
                {"attackerblind", false}, {"wallbang", false},
            };
            if (const PlayerIdentity* v = store.IdentityAt(k.victim)) ev["victimName"] = v->name;
            if (const PlayerIdentity* a = store.IdentityAt(k.killer)) ev["attackerName"] = a->name;
            if (const PlayerSnapshot* vs = store.PlayerAt(k.victim, k.tick)) ev["victimTeam"] = vs->team;
            if (const PlayerSnapshot* as = store.PlayerAt(k.killer, k.tick)) ev["attackerTeam"] = as->team;
            events.push_back(std::move(ev));
        }
        for (const RoundSpan& r : store.Rounds()) {
            events.push_back({{"tick", r.startTick}, {"time", timeOf(r.startTick)},
                              {"type", "round_start"}});
            events.push_back({{"tick", r.endTick}, {"time", timeOf(r.endTick)},
                              {"type", "round_end"},
                              {"roundWinner", r.winnerTeam}});
        }
        if (const auto* c4 = store.C4StatusChangesAt(kC4EntityId)) {
            for (const auto& [tick, status] : *c4) {
                const char* type = status == C4Status::Planted   ? "bomb_planted"
                                   : status == C4Status::Defused ? "bomb_defused"
                                   : status == C4Status::Exploded ? "bomb_exploded"
                                                                  : nullptr;
                if (type) events.push_back({{"tick", tick}, {"time", timeOf(tick)}, {"type", type}});
            }
        }
        std::sort(events.begin(), events.end(), [](const nlohmann::json& a, const nlohmann::json& b) {
            return a["tick"].get<Tick>() < b["tick"].get<Tick>();
        });

        // bomb.segments（kind: carried/dropped/planted；close 于换段/回合事件）
        nlohmann::json bombSegments = nlohmann::json::array();
        {
            nlohmann::json open;
            auto close = [&](Tick t) {
                if (!open.is_null()) {
                    open["endTick"] = t;
                    if (t > open["startTick"].get<Tick>()) bombSegments.push_back(open);
                    open = nullptr;
                }
            };
            const auto* c4 = store.C4StatusChangesAt(kC4EntityId);
            if (c4) {
                for (const auto& [tick, status] : *c4) {
                    switch (status) {
                        case C4Status::Carried: {
                            close(tick);
                            // 携带者位置前端跟人，x/y/z 置 0（worker 同款）
                            EntityId carrier = 0;
                            if (const C4Spec* spec = store.C4SpecAt(kC4EntityId)) carrier = spec->carrier;
                            open = {{"kind", "carried"}, {"startTick", tick},
                                    {"x", 0.0f}, {"y", 0.0f}, {"z", 0.0f},
                                    {"carrierSlot", carrier ? SlotOf(slotOf, carrier) : -1},
                                    {"site", ""}};
                            break;
                        }
                        case C4Status::Dropped: {
                            close(tick);
                            const TransformSnapshot* tr = store.TransformAt(kC4EntityId, tick);
                            open = {{"kind", "dropped"}, {"startTick", tick},
                                    {"x", tr ? tr->pos.x : 0.0f}, {"y", tr ? tr->pos.y : 0.0f},
                                    {"z", tr ? tr->pos.z : 0.0f},
                                    {"carrierSlot", -1}, {"site", ""}};
                            break;
                        }
                        case C4Status::Planted: {
                            close(tick);
                            const C4Spec* spec = store.C4SpecAt(kC4EntityId);
                            open = {{"kind", "planted"}, {"startTick", tick},
                                    {"x", spec ? spec->plantPos.x : 0.0f},
                                    {"y", spec ? spec->plantPos.y : 0.0f},
                                    {"z", spec ? spec->plantPos.z : 0.0f},
                                    {"carrierSlot", -1},
                                    {"site", ""}};  // site 缺省 → 前端 nearestBombSite 按坐标推断
                            break;
                        }
                        case C4Status::Defused:
                        case C4Status::Exploded:
                            close(tick);
                            break;
                    }
                }
                close(maxTick);
            }
        }

        // grenades：trajectories（posXYZ/ticks 走 blob）+ smoke effects
        nlohmann::json trajectories = nlohmann::json::array();
        nlohmann::json effects = nlohmann::json::array();
        for (const auto& lt : store.Lifetimes()) {
            if (lt.kind != EntityKind::Grenade) continue;
            const GrenadeSpec* spec = store.GrenadeSpecAt(lt.id);
            if (!spec || spec->trajectoryPoints.empty()) continue;
            // posXYZ / ticks 平铺
            std::vector<float> xyz;
            std::vector<std::int32_t> ticks;
            xyz.reserve(spec->trajectoryPoints.size() * 3);
            ticks.reserve(spec->trajectoryTicks.size());
            for (const Vec3& p : spec->trajectoryPoints) {
                xyz.push_back(p.x); xyz.push_back(p.y); xyz.push_back(p.z);
            }
            for (Tick t : spec->trajectoryTicks) ticks.push_back(static_cast<std::int32_t>(t));
            trajectories.push_back({
                {"kind", GrenadeKindName(spec->kind)},
                {"throwerSlot", spec->thrower ? SlotOf(slotOf, spec->thrower) : -1},
                {"startTick", spec->throwTick},
                {"endTick", spec->detonateTick},
                {"detonationTick", spec->detonateTick},
                {"posXYZ", blob.Ref(xyz.data(), 4, xyz.size(), "f32")},
                {"ticks", blob.Ref(ticks.data(), 4, ticks.size(), "i32")},
                {"angles", nullptr},
                {"incendiary", false},
            });
            if (spec->kind == GrenadeKind::Smoke) {
                const Vec3& p = spec->trajectoryPoints.back();
                effects.push_back({{"kind", "smoke"},
                                   {"x", p.x}, {"y", p.y}, {"z", p.z},
                                   {"startTick", spec->detonateTick},
                                   {"endTick", spec->detonateTick + 960}});  // SMOKE_DURATION_TICKS
            }
        }

        // droppedWeapons：地面武器段，每 8 tick 采样位置（blob 控制体积）
        nlohmann::json dropped = nlohmann::json::array();
        for (const auto& lt : store.Lifetimes()) {
            if (lt.kind != EntityKind::Weapon) continue;
            const WeaponSpec* spec = store.WeaponSpecAt(lt.id);
            std::vector<std::int32_t> ticks;
            std::vector<float> positions;
            for (Tick t = lt.begin; t < lt.end; t += kPanelStride) {
                const TransformSnapshot* tr = store.TransformAt(lt.id, t);
                if (!tr) continue;
                ticks.push_back(static_cast<std::int32_t>(t));
                positions.push_back(tr->pos.x);
                positions.push_back(tr->pos.y);
                positions.push_back(tr->pos.z);
            }
            if (ticks.empty()) continue;
            dropped.push_back({
                {"entityId", lt.id},
                {"weapon", spec ? spec->itemId : ""},
                {"itemDef", 0},
                {"startTick", lt.begin},
                {"endTick", lt.end},
                {"ticks", blob.Ref(ticks.data(), 4, ticks.size(), "i32")},
                {"positions", blob.Ref(positions.data(), 4, positions.size(), "f32")},
                {"angles", nullptr},
            });
        }

        out.counts.blobBytes = blob.bytes;
        out.blobParts = std::move(blob.parts);
        out.meta = {
            {"mapName", store.MapName()},
            {"tickRate", 64},
            {"sampleRate", 64},
            {"startTick", out.startTick},
            {"durationSeconds", static_cast<double>(maxTick - out.startTick) / 64.0},
            {"rounds", std::move(rounds)},
            {"players", std::move(players)},
            {"weaponNames", std::move(weaponNames)},
            {"events", std::move(events)},
            {"bomb", {{"segments", std::move(bombSegments)}, {"defuses", nlohmann::json::array()}}},
            {"deathMarkers", nlohmann::json::array()},
            {"timeouts", {{"maxTacticalTimeouts", 0}, {"intervals", nlohmann::json::array()},
                          {"counters", nlohmann::json::array()}}},
            {"deathRagdolls", nlohmann::json::array()},
            {"droppedWeapons", std::move(dropped)},
            {"mapEntities", nlohmann::json::array()},
            {"grenades", {{"trajectories", std::move(trajectories)},
                          {"effects", std::move(effects)},
                          {"infernos", nlohmann::json::array()}}},
        };
        return out;
    }

    static std::int64_t SlotOf(const std::unordered_map<EntityId, std::size_t>& slotOf, EntityId id) {
        auto it = slotOf.find(id);
        return it == slotOf.end() ? -1 : static_cast<std::int64_t>(it->second);
    }

    static const char* GrenadeKindName(GrenadeKind kind) {
        // 与前端 grenadeKindOf 的产出一致（parser.worker.deobf.js L2088）
        switch (kind) {
            case GrenadeKind::Flash:  return "flash";
            case GrenadeKind::Smoke:  return "smoke";
            case GrenadeKind::Molotov: return "molotov";
            case GrenadeKind::Decoy:  return "decoy";
            case GrenadeKind::HE:     return "he";
        }
        return "he";
    }
};

} // namespace demoviewer
