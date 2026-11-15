// ============================================================================
// shared_writer.cpp —— DemoData → 共享内存
// ============================================================================
// 与 src/deobfuscated/shared-buffer.js 的 planSharedBuffer / writeSharedBuffer 等价。
// 改这里之后必须重跑 cpp/writer_test + tools/test-shared-buffer-from-cpp.mjs。
// ============================================================================
#include "shared_writer.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <stdexcept>

namespace csdemo {

// ════════════════════════════════════════════════════════════════════════════
// JsonWriter
// ════════════════════════════════════════════════════════════════════════════
void JsonWriter::beforeValue() {
    if (afterKey_) { afterKey_ = false; return; }
    if (stack_.empty()) return;
    Frame& f = stack_.back();
    if (!f.first) buf_.push_back(',');
    f.first = false;
}

void JsonWriter::beforeKey() {
    if (afterKey_) afterKey_ = false;   // 防御：不该发生
    if (stack_.empty()) return;
    Frame& f = stack_.back();
    if (!f.first) buf_.push_back(',');
    f.first = false;
}

void JsonWriter::objBegin() {
    beforeValue();
    buf_.push_back('{');
    stack_.push_back({true});
}
void JsonWriter::objEnd() {
    buf_.push_back('}');
    if (!stack_.empty()) stack_.pop_back();
}
void JsonWriter::arrBegin() {
    beforeValue();
    buf_.push_back('[');
    stack_.push_back({true});
}
void JsonWriter::arrEnd() {
    buf_.push_back(']');
    if (!stack_.empty()) stack_.pop_back();
}

void JsonWriter::key(std::string_view k) {
    beforeKey();
    writeQuoted(k);
    buf_.push_back(':');
    afterKey_ = true;
}

void JsonWriter::writeQuoted(std::string_view v) {
    buf_.push_back('"');
    for (char c : v) {
        switch (c) {
            case '"':  put("\\\""); break;
            case '\\': put("\\\\"); break;
            case '\b': put("\\b"); break;
            case '\f': put("\\f"); break;
            case '\n': put("\\n"); break;
            case '\r': put("\\r"); break;
            case '\t': put("\\t"); break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char esc[8];
                    std::snprintf(esc, sizeof esc, "\\u%04x", static_cast<unsigned>(static_cast<unsigned char>(c)));
                    put(esc);
                } else {
                    buf_.push_back(c);   // UTF-8 字节原样透传
                }
        }
    }
    buf_.push_back('"');
}

void JsonWriter::valStr(std::string_view v) {
    beforeValue();
    writeQuoted(v);
}

void JsonWriter::valI64(std::int64_t v) {
    beforeValue();
    char b[32];
    std::snprintf(b, sizeof b, "%lld", static_cast<long long>(v));
    put(b);
}
void JsonWriter::valF32(float v) {
    beforeValue();
    if (!std::isfinite(v)) { put("null"); return; }
    char b[40];
    std::snprintf(b, sizeof b, "%.9g", static_cast<double>(v));
    put(b);
}
void JsonWriter::valF64(double v) {
    beforeValue();
    if (!std::isfinite(v)) { put("null"); return; }
    char b[40];
    std::snprintf(b, sizeof b, "%.17g", v);
    put(b);
}
void JsonWriter::valBool(bool v) { beforeValue(); put(v ? "true" : "false"); }
void JsonWriter::valNull() { beforeValue(); put("null"); }

void JsonWriter::valBlobRef(std::uint32_t o, std::uint32_t n, const char* type) {
    if (n == 0) { valNull(); return; }
    objBegin();
    key("o"); valI64(o);
    key("n"); valI64(n);
    key("t"); valStr(type);
    objEnd();
}

// ════════════════════════════════════════════════════════════════════════════
// 元数据 JSON 构造
// ════════════════════════════════════════════════════════════════════════════
namespace {

void writeRounds(JsonWriter& j, const std::vector<Round>& v) {
    j.key("rounds");
    j.arrBegin();
    for (const auto& r : v) {
        j.objBegin();
        j.key("index"); j.valI64(r.index);
        j.key("startTick"); j.valI64(r.startTick);
        j.key("endTick"); j.valI64(r.endTick);
        j.key("liveStartTick"); j.valI64(r.liveStartTick);
        j.objEnd();
    }
    j.arrEnd();
}

void writePlayers(JsonWriter& j, const std::vector<Player>& v) {
    j.key("players");
    j.arrBegin();
    for (const auto& p : v) {
        j.objBegin();
        j.key("slot"); j.valI64(p.slot);
        j.key("steamId"); j.valStr(p.steamId);
        j.key("name"); j.valStr(p.name);
        if (p.clanName) { j.key("clanName"); j.valStr(*p.clanName); }
        if (p.color) { j.key("color"); j.valStr(*p.color); }
        if (p.crosshairCode) { j.key("crosshairCode"); j.valStr(*p.crosshairCode); }
        j.objEnd();
    }
    j.arrEnd();
}

void writeWeaponNames(JsonWriter& j, const std::vector<std::string>& v) {
    j.key("weaponNames");
    j.arrBegin();
    for (const auto& s : v) j.valStr(s);
    j.arrEnd();
}

void writeEvents(JsonWriter& j, const std::vector<GameEvent>& v) {
    j.key("events");
    j.arrBegin();
    for (const auto& e : v) {
        j.objBegin();
        j.key("tick"); j.valI64(e.tick);
        j.key("time"); j.valF64(e.time);
        j.key("type"); j.valStr(toJson(e.type));
        if (e.victimSlot) { j.key("victimSlot"); j.valI64(*e.victimSlot); }
        if (e.attackerSlot) { j.key("attackerSlot"); j.valI64(*e.attackerSlot); }
        if (e.assisterSlot) { j.key("assisterSlot"); j.valI64(*e.assisterSlot); }
        if (e.victimName) { j.key("victimName"); j.valStr(*e.victimName); }
        if (e.attackerName) { j.key("attackerName"); j.valStr(*e.attackerName); }
        if (e.victimTeam) { j.key("victimTeam"); j.valI64(*e.victimTeam); }
        if (e.attackerTeam) { j.key("attackerTeam"); j.valI64(*e.attackerTeam); }
        if (e.weapon) { j.key("weapon"); j.valStr(*e.weapon); }
        if (e.type == EventType::Kill) {
            j.key("headshot"); j.valBool(e.headshot);
            j.key("noscope"); j.valBool(e.noscope);
            j.key("thrusmoke"); j.valBool(e.thrusmoke);
            j.key("attackerblind"); j.valBool(e.attackerblind);
            j.key("wallbang"); j.valBool(e.wallbang);
        }
        if (e.roundWinner) { j.key("roundWinner"); j.valI64(*e.roundWinner); }
        if (e.roundReason) { j.key("roundReason"); j.valI64(*e.roundReason); }
        j.objEnd();
    }
    j.arrEnd();
}

void writeBomb(JsonWriter& j, const Bomb& b) {
    j.key("bomb");
    j.objBegin();
    j.key("segments");
    j.arrBegin();
    for (const auto& s : b.segments) {
        j.objBegin();
        j.key("kind"); j.valStr(toJson(s.kind));
        j.key("startTick"); j.valI64(s.startTick);
        j.key("endTick"); j.valI64(s.endTick);
        j.key("x"); j.valF32(s.x);
        j.key("y"); j.valF32(s.y);
        j.key("z"); j.valF32(s.z);
        j.key("carrierSlot"); j.valI64(s.carrierSlot);
        j.key("site"); j.valStr(toJson(s.site));
        j.objEnd();
    }
    j.arrEnd();
    j.key("defuses");
    j.arrBegin();
    for (const auto& d : b.defuses) {
        j.objBegin();
        j.key("startTick"); j.valI64(d.startTick);
        j.key("endTick"); j.valI64(d.endTick);
        j.key("hasKit"); j.valBool(d.hasKit);
        j.key("defuserSlot"); j.valI64(d.defuserSlot);
        j.objEnd();
    }
    j.arrEnd();
    j.objEnd();
}

void writeDeathMarkers(JsonWriter& j, const std::vector<DeathMarker>& v) {
    j.key("deathMarkers");
    j.arrBegin();
    for (const auto& m : v) {
        j.objBegin();
        j.key("x"); j.valF32(m.x);
        j.key("y"); j.valF32(m.y);
        j.key("z"); j.valF32(m.z);
        j.key("startTick"); j.valI64(m.startTick);
        j.key("endTick"); j.valI64(m.endTick);
        j.key("victimSlot"); j.valI64(m.victimSlot);
        j.key("team"); j.valI64(m.team);
        j.key("name"); j.valStr(m.name);
        j.objEnd();
    }
    j.arrEnd();
}

void writeTimeouts(JsonWriter& j, const Timeouts& t) {
    j.key("timeouts");
    j.objBegin();
    j.key("maxTacticalTimeouts"); j.valI64(t.maxTacticalTimeouts);
    j.key("intervals");
    j.arrBegin();
    for (const auto& iv : t.intervals) {
        j.objBegin();
        j.key("startTick"); j.valI64(iv.startTick);
        j.key("endTick"); j.valI64(iv.endTick);
        if (iv.side != TimeoutSide::None) { j.key("side"); j.valStr(toJson(iv.side)); }
        if (iv.technical) { j.key("technical"); j.valBool(true); }
        j.objEnd();
    }
    j.arrEnd();
    j.key("counters");
    j.arrBegin();
    for (const auto& c : t.counters) {
        j.objBegin();
        j.key("tick"); j.valI64(c.tick);
        j.key("tRemaining"); j.valI64(c.tRemaining);
        j.key("ctRemaining"); j.valI64(c.ctRemaining);
        j.objEnd();
    }
    j.arrEnd();
    j.objEnd();
}

void writeDeathRagdolls(JsonWriter& j, const std::vector<DeathRagdoll>& v) {
    j.key("deathRagdolls");
    j.arrBegin();
    for (const auto& r : v) {
        j.objBegin();
        j.key("tick"); j.valI64(r.tick);
        j.key("slot"); j.valI64(r.slot);
        j.key("force");
        j.arrBegin();
        for (float f : r.force) j.valF32(f);
        j.arrEnd();
        j.key("bone"); j.valI64(r.bone);
        j.key("headshot"); j.valBool(r.headshot);
        j.key("eyeAngles");
        j.arrBegin();
        for (float f : r.eyeAngles) j.valF32(f);
        j.arrEnd();
        j.objEnd();
    }
    j.arrEnd();
}

}  // namespace

// 变长数组统一走 blob：JSON 里只留 {o,n,t}
void writeGrenades(JsonWriter& j, const Grenades& g, BlobBuilder& blob) {
    j.key("grenades");
    j.objBegin();

    j.key("trajectories");
    j.arrBegin();
    for (const auto& tr : g.trajectories) {
        j.objBegin();
        j.key("kind"); j.valStr(toJson(tr.kind));
        j.key("throwerSlot"); j.valI64(tr.throwerSlot);
        j.key("startTick"); j.valI64(tr.startTick);
        j.key("endTick"); j.valI64(tr.endTick);
        j.key("detonationTick");
        if (tr.detonationTick) j.valI64(*tr.detonationTick); else j.valNull();

        auto rp = blob.append(tr.posXYZ);
        j.key("posXYZ"); j.valBlobRef(rp.o, rp.n, "f32");
        auto rt = blob.append(tr.ticks);
        j.key("ticks"); j.valBlobRef(rt.o, rt.n, "i32");
        if (tr.angles) {
            auto ra = blob.append(*tr.angles);
            j.key("angles"); j.valBlobRef(ra.o, ra.n, "f32");
        }
        if (tr.incendiary) { j.key("incendiary"); j.valBool(true); }
        j.objEnd();
    }
    j.arrEnd();

    j.key("effects");
    j.arrBegin();
    for (const auto& e : g.effects) {
        j.objBegin();
        j.key("kind"); j.valStr(toJson(e.kind));
        j.key("x"); j.valF32(e.x);
        j.key("y"); j.valF32(e.y);
        j.key("z"); j.valF32(e.z);
        j.key("startTick"); j.valI64(e.startTick);
        j.key("endTick"); j.valI64(e.endTick);
        j.objEnd();
    }
    j.arrEnd();

    j.key("infernos");
    j.arrBegin();
    for (const auto& n : g.infernos) {
        j.objBegin();
        j.key("entityId"); j.valI64(n.entityId);
        j.key("startTick"); j.valI64(n.startTick);
        j.key("endTick"); j.valI64(n.endTick);
        if (n.effectTick) { j.key("effectTick"); j.valI64(*n.effectTick); }
        if (n.infernoType) { j.key("infernoType"); j.valI64(*n.infernoType); }
        if (n.lifetime) { j.key("lifetime"); j.valF32(*n.lifetime); }
        j.key("frames");
        j.arrBegin();
        for (const auto& f : n.frames) {
            j.objBegin();
            j.key("tick"); j.valI64(f.tick);
            auto r1 = blob.append(f.positions);
            j.key("positions"); j.valBlobRef(r1.o, r1.n, "f32");
            auto r2 = blob.append(f.burning);
            j.key("burning"); j.valBlobRef(r2.o, r2.n, "u8");
            auto r3 = blob.append(f.origin);
            j.key("origin"); j.valBlobRef(r3.o, r3.n, "f32");
            if (f.parentPositions) {
                auto r4 = blob.append(*f.parentPositions);
                j.key("parentPositions"); j.valBlobRef(r4.o, r4.n, "f32");
            }
            if (f.normals) {
                auto r5 = blob.append(*f.normals);
                j.key("normals"); j.valBlobRef(r5.o, r5.n, "f32");
            }
            j.objEnd();
        }
        j.arrEnd();
        j.objEnd();
    }
    j.arrEnd();
    j.objEnd();
}

namespace {

void writeDroppedWeapons(JsonWriter& j, const std::vector<DroppedWeapon>& v, BlobBuilder& blob) {
    j.key("droppedWeapons");
    j.arrBegin();
    for (const auto& w : v) {
        j.objBegin();
        j.key("entityId"); j.valI64(w.entityId);
        j.key("weapon"); j.valStr(w.weapon);
        j.key("itemDef"); j.valI64(w.itemDef);
        j.key("startTick"); j.valI64(w.startTick);
        j.key("endTick"); j.valI64(w.endTick);
        auto r1 = blob.append(w.ticks);
        j.key("ticks"); j.valBlobRef(r1.o, r1.n, "i32");
        auto r2 = blob.append(w.positions);
        j.key("positions"); j.valBlobRef(r2.o, r2.n, "f32");
        auto r3 = blob.append(w.angles);
        j.key("angles"); j.valBlobRef(r3.o, r3.n, "f32");
        j.objEnd();
    }
    j.arrEnd();
}

void writeMapEntities(JsonWriter& j, const std::vector<MapEntity>& v, BlobBuilder& blob) {
    j.key("mapEntities");
    j.arrBegin();
    for (const auto& m : v) {
        j.objBegin();
        j.key("className"); j.valStr(m.className);
        auto r0 = blob.append(m.origin);
        j.key("origin"); j.valBlobRef(r0.o, r0.n, "f32");
        j.key("startTick"); j.valI64(m.startTick);
        j.key("endTick"); j.valI64(m.endTick);
        auto r1 = blob.append(m.ticks);
        j.key("ticks"); j.valBlobRef(r1.o, r1.n, "i32");
        auto r2 = blob.append(m.angles);
        j.key("angles"); j.valBlobRef(r2.o, r2.n, "f32");
        auto r3 = blob.append(m.hidden);
        j.key("hidden"); j.valBlobRef(r3.o, r3.n, "u8");
        j.objEnd();
    }
    j.arrEnd();
}

}  // namespace

// ════════════════════════════════════════════════════════════════════════════
// planSharedBuffer
// ════════════════════════════════════════════════════════════════════════════
Plan planSharedBuffer(const DemoData& d) {
    const auto report = validate(d);
    if (!report.ok()) {
        throw std::invalid_argument("planSharedBuffer: validate 失败\n" + report.toString());
    }

    Plan plan;
    plan.N = d.meta.numFrames;
    plan.P = d.meta.numPlayers;
    plan.M = d.panelFrames.numFrames;
    plan.flags = deriveFlags(d);
    plan.counts = deriveCounts(d);

    BlobBuilder blob;
    JsonWriter j;
    j.objBegin();

    j.key("mapName"); j.valStr(d.meta.mapName);
    j.key("tickRate"); j.valI64(d.meta.tickRate);
    j.key("sampleRate"); j.valI64(d.meta.sampleRate);
    j.key("startTick"); j.valI64(d.meta.startTick);
    j.key("durationSeconds"); j.valF64(d.meta.durationSeconds);

    writeRounds(j, d.rounds);
    writePlayers(j, d.players);
    writeWeaponNames(j, d.weaponNames);
    writeEvents(j, d.events);
    writeBomb(j, d.bomb);
    writeDeathMarkers(j, d.deathMarkers);
    writeTimeouts(j, d.timeouts);
    writeDeathRagdolls(j, d.deathRagdolls);
    writeDroppedWeapons(j, d.droppedWeapons, blob);
    writeMapEntities(j, d.mapEntities, blob);
    writeGrenades(j, d.grenades, blob);

    // counts 是最后一个 key —— 因为 blobBytes 要等上面所有 blob.append 完成才知道。
    // 关键：此时 JsonWriter 的顶层对象还开着，所以可以直接接着写，不需要字符串修补。
    plan.counts.blobBytes = static_cast<std::uint32_t>(blob.size());
    plan.blob = blob.bytes();

    j.key("counts");
    j.objBegin();
    j.key("tracers");           j.valI64(plan.counts.tracers);
    j.key("damage");            j.valI64(plan.counts.damage);
    j.key("weaponFires");       j.valI64(plan.counts.weaponFires);
    j.key("smokeCount");        j.valI64(plan.counts.smokeCount);
    j.key("smokeCountPlus1");   j.valI64(plan.counts.smokeCountPlus1);
    j.key("smokeBufferBytes");  j.valI64(plan.counts.smokeBufferBytes);
    j.key("smokeFrameTicks");   j.valI64(plan.counts.smokeFrameTicks);
    j.key("blobBytes");         j.valI64(plan.counts.blobBytes);
    j.objEnd();

    j.objEnd();                              // 顶层对象收尾
    plan.metaJson = j.str();

    LayoutInput in;
    in.numFrames = plan.N;
    in.numPlayers = plan.P;
    in.panelNumFrames = plan.M;
    in.flags = plan.flags;
    in.counts = plan.counts;
    plan.layout = computeSharedLayout(in);
    plan.bytes = sharedBufferBytes(plan.layout);
    return plan;
}

std::size_t sharedBufferBytesFor(const DemoData& d) {
    return planSharedBuffer(d).bytes;
}

// ════════════════════════════════════════════════════════════════════════════
// 列数据定位：块名 → (源指针, 元素数)
// ════════════════════════════════════════════════════════════════════════════
namespace {

struct SrcPtr {
    const void* ptr = nullptr;
    std::size_t count = 0;
};

template <typename T>
SrcPtr fromVec(const std::vector<T>& v) {
    return {v.data(), v.size()};
}

SrcPtr locateBlock(const DemoData& d, std::string_view name) {
    const auto& F = d.frames;
    const auto& PF = d.panelFrames;

    // ── frames ──
    if (name == "frameTick") return fromVec(F.frameTick);
    if (name == "posX") return fromVec(F.posX);
    if (name == "posY") return fromVec(F.posY);
    if (name == "posZ") return fromVec(F.posZ);
    if (name == "yaw") return fromVec(F.yaw);
    if (name == "pitch") return fromVec(F.pitch);
    if (name == "health") return fromVec(F.health);
    if (name == "alive") return fromVec(F.alive);
    if (name == "team") return fromVec(F.team);
    if (name == "score") return fromVec(F.score);
    if (name == "duck") return fromVec(F.duck);
    if (name == "flash") return fromVec(F.flash);
    if (name == "flashAlpha") return fromVec(F.flashAlpha);
    if (name == "zoom") return fromVec(F.zoom);
    if (name == "accuracyPenalty") return fromVec(F.accuracyPenalty);
    if (name == "reloading") return fromVec(F.reloading);
    if (name == "playerFlags") return fromVec(F.playerFlags);
    if (name == "speed") return fromVec(F.speed);
    if (name == "smoothSpeed") return fromVec(F.smoothSpeed);

    // ── panelFrames ──
    if (name == "panelFrameTick") return fromVec(PF.frameTick);
    if (name == "panelHealth") return fromVec(PF.health);
    if (name == "panelAlive") return fromVec(PF.alive);
    if (name == "panelTeam") return fromVec(PF.team);
    if (name == "panelArmor") return fromVec(PF.armor);
    if (name == "panelFlags") return fromVec(PF.flags);
    if (name == "panelMoney") return fromVec(PF.money);
    if (name == "panelClipAmmo") return fromVec(PF.clipAmmo);
    if (name == "panelReserveAmmo") return fromVec(PF.reserveAmmo);
    if (name == "panelActiveWeapon") return fromVec(PF.activeWeapon);
    if (name == "panelUtilCounts") return fromVec(PF.utilCounts);

    // ── 区间数据 ──
    if (name == "tracers.origin") return fromVec(d.tracers.origin);
    if (name == "tracers.end") return fromVec(d.tracers.end);
    if (name == "tracers.tick") return fromVec(d.tracers.tick);
    if (name == "tracers.team") return fromVec(d.tracers.team);
    if (name == "tracers.hitKind") return fromVec(d.tracers.hitKind);
    if (name == "damage.attackerSlot") return fromVec(d.damage.attackerSlot);
    if (name == "damage.victimSlot") return fromVec(d.damage.victimSlot);
    if (name == "damage.tick") return fromVec(d.damage.tick);
    if (name == "damage.dmg") return fromVec(d.damage.dmg);
    if (name == "weaponFires.ticks") return fromVec(d.weaponFires.ticks);
    if (name == "weaponFires.slots") return fromVec(d.weaponFires.slots);
    if (name == "smokeVoxels.tickBegin") return fromVec(d.smokeVoxels.tickBegin);
    if (name == "smokeVoxels.detonation") return fromVec(d.smokeVoxels.detonation);
    if (name == "smokeVoxels.color") return fromVec(d.smokeVoxels.color);
    if (name == "smokeVoxels.bufferOffsets") return fromVec(d.smokeVoxels.bufferOffsets);
    if (name == "smokeVoxels.frameOffsets") return fromVec(d.smokeVoxels.frameOffsets);
    if (name == "smokeVoxels.buffers") return fromVec(d.smokeVoxels.buffers);
    if (name == "smokeVoxels.frameTicks") return fromVec(d.smokeVoxels.frameTicks);

    return {};   // blob 或未知
}

}  // namespace

// ════════════════════════════════════════════════════════════════════════════
// writeSharedBuffer
// ════════════════════════════════════════════════════════════════════════════
WriteResult writeSharedBuffer(void* base, std::size_t baseBytes, const DemoData& d, std::uint32_t version) {
    const Plan plan = planSharedBuffer(d);
    if (baseBytes < plan.bytes) {
        throw std::length_error("writeSharedBuffer: 缓冲不足 需要 " +
                                std::to_string(plan.bytes) + " 实际 " + std::to_string(baseBytes));
    }

    auto* p = static_cast<std::uint8_t*>(base);
    std::memset(p, 0, plan.bytes);

    WriteResult res;
    res.bytes = plan.bytes;
    res.blobBytes = plan.blob.size();
    res.metadataJsonBytes = plan.metaJson.size();

    // ── ① 列块区 ──
    for (const auto& b : plan.layout.blocks) {
        if (b.name == "blob") continue;
        const SrcPtr src = locateBlock(d, b.name);
        if (!src.ptr) {
            throw std::logic_error("writeSharedBuffer: 找不到块 " + std::string(b.name) + " 的数据源");
        }
        const std::size_t want = src.count * typeSize(b.type);
        if (want != b.length) {
            throw std::logic_error("writeSharedBuffer: 块 " + std::string(b.name) + " 长度不符 源 " +
                                   std::to_string(want) + " vs 布局 " + std::to_string(b.length));
        }
        std::memcpy(p + b.offset, src.ptr, b.length);
        res.blocksCopied++;
    }

    // ── ② blob 区 ──
    if (const Block* bb = plan.layout.find("blob")) {
        if (!plan.blob.empty()) std::memcpy(p + bb->offset, plan.blob.data(), plan.blob.size());
    }

    // ── ③ 元数据区（A/B 按 version 奇偶）──
    res.usedMetaA = metaUsesA(version);
    const std::size_t metaOff = res.usedMetaA ? kMetaAOffset : kMetaBOffset;
    const std::uint32_t jsonLen = static_cast<std::uint32_t>(plan.metaJson.size());
    std::memcpy(p + metaOff, &jsonLen, 4);                       // 小端（x64/arm64 都是）
    std::memcpy(p + metaOff + 4, plan.metaJson.data(), jsonLen);

    // ── ④ header（最后写 = 提交）──
    const auto putU32 = [p](std::size_t off, std::uint32_t v) { std::memcpy(p + off, &v, 4); };
    const auto putI32 = [p](std::size_t off, std::int32_t v) { std::memcpy(p + off, &v, 4); };
    const auto putU64 = [p](std::size_t off, std::uint64_t v) { std::memcpy(p + off, &v, 8); };

    putU32(0, kCsdfMagic);
    putU32(4, kCsdfVersion);
    putI32(8, d.meta.startTick);
    putI32(12, plan.N > 0 ? d.frames.frameTick[plan.N - 1] : d.meta.startTick);
    putI32(16, static_cast<std::int32_t>(plan.N));
    putI32(20, static_cast<std::int32_t>(plan.P));
    putI32(24, static_cast<std::int32_t>(plan.M));
    putI32(28, static_cast<std::int32_t>(plan.flags));
    putU32(32, 0);                                             // crc32：共享内存场景不做全量校验
    putU32(36, 0);
    putU64(40, static_cast<std::uint64_t>(plan.layout.totalBytes - kCsdfHeaderBytes));
    putU64(48, static_cast<std::uint64_t>(plan.bytes));
    putU64(56, 0);

    return res;
}

}  // namespace csdemo
