// ============================================================================
// shared_reader.cpp —— 共享内存镜像 → DemoData
// ============================================================================
// 与 shared_writer.cpp 严格互逆。
// ============================================================================
#include "shared_reader.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "mini_json.h"
#include "shared_layout.h"

namespace csdemo {
namespace {

using json::Value;

std::string readFileBytes(const char* path, std::vector<std::uint8_t>& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error(std::string("readSharedBufferFile: 打不开 ") + path);
    f.seekg(0, std::ios::end);
    const auto n = static_cast<std::streamsize>(f.tellg());
    f.seekg(0, std::ios::beg);
    out.resize(static_cast<std::size_t>(n));
    if (n > 0) f.read(reinterpret_cast<char*>(out.data()), n);
    return std::string(path);
}

/// 从元数据区取 JSON 文本
std::string metaJsonAt(const std::uint8_t* p, std::size_t bytes, std::size_t offset) {
    if (offset + 4 > bytes) throw std::runtime_error("shared_reader: 元数据区偏移越界");
    std::uint32_t len = 0;
    std::memcpy(&len, p + offset, 4);
    if (len == 0) throw std::runtime_error("shared_reader: 元数据区为空（选错了 A/B 区？）");
    if (offset + 4 + len > bytes) throw std::runtime_error("shared_reader: 元数据长度越界");
    return std::string(reinterpret_cast<const char*>(p + offset + 4), len);
}

// ── blob 引用解析 ──
struct BlobLoc {
    const std::uint8_t* base = nullptr;
    std::size_t bytes = 0;
};

template <typename T>
void readBlobInto(const BlobLoc& blob, const Value* ref, std::vector<T>& out) {
    out.clear();
    if (!ref || ref->isNull()) return;
    if (!ref->isObj()) throw std::runtime_error("shared_reader: blob 引用不是对象");
    const auto o = ref->find("o") ? ref->find("o")->u32() : 0u;
    const auto n = ref->find("n") ? ref->find("n")->u32() : 0u;
    if (n == 0) return;
    const std::size_t byteOff = o;
    const std::size_t byteLen = static_cast<std::size_t>(n) * sizeof(T);
    if (byteOff + byteLen > blob.bytes) {
        throw std::runtime_error("shared_reader: blob 引用越界 o=" + std::to_string(o) + " n=" + std::to_string(n));
    }
    out.resize(n);
    std::memcpy(out.data(), blob.base + byteOff, byteLen);
}

/// 从列块拷进 vector
template <typename T>
void readBlock(const std::uint8_t* p, const Layout& layout, std::string_view name, std::vector<T>& out) {
    const Block* b = layout.find(name);
    if (!b) { out.clear(); return; }
    const std::size_t n = b->length / sizeof(T);
    out.resize(n);
    if (n) std::memcpy(out.data(), p + b->offset, b->length);
}

const Value* arr(const Value& v, const char* key) {
    const Value* x = v.find(key);
    return (x && x->isArr()) ? x : nullptr;
}
const Value* obj(const Value& v, const char* key) {
    const Value* x = v.find(key);
    return (x && x->isObj()) ? x : nullptr;
}

}  // namespace

DemoData readSharedBufferToDemoData(const void* base, std::size_t bytes, Visible visible) {
    if (!base || bytes < kCsdfHeaderBytes) throw std::runtime_error("shared_reader: 缓冲过小");
    const auto* p = static_cast<const std::uint8_t*>(base);

    // ── header ──
    std::uint32_t magic = 0, version = 0;
    std::int32_t startTick = 0, endTick = 0, Ncap = 0, P = 0, Mcap = 0, flags = 0;
    std::memcpy(&magic, p + 0, 4);
    std::memcpy(&version, p + 4, 4);
    std::memcpy(&startTick, p + 8, 4);
    std::memcpy(&endTick, p + 12, 4);
    std::memcpy(&Ncap, p + 16, 4);
    std::memcpy(&P, p + 20, 4);
    std::memcpy(&Mcap, p + 24, 4);
    std::memcpy(&flags, p + 28, 4);
    if (magic != kCsdfMagic) throw std::runtime_error("shared_reader: magic 不符");
    if (version != kCsdfVersion) throw std::runtime_error("shared_reader: 版本不支持");
    if (P <= 0 || Ncap <= 0) throw std::runtime_error("shared_reader: header 里 P/N 非法");

    // ── 元数据 JSON（A/B 两份都可能被写过，挑非空的那份）──
    std::string jsonText;
    std::string lastErr;
    for (std::size_t off : {static_cast<std::size_t>(kMetaAOffset), static_cast<std::size_t>(kMetaBOffset)}) {
        try {
            jsonText = metaJsonAt(p, bytes, off);
            break;
        } catch (const std::exception& e) { lastErr = e.what(); }
    }
    if (jsonText.empty()) throw std::runtime_error("shared_reader: 两个元数据区都读不出 " + lastErr);

    const Value meta = json::parse(jsonText);

    // ── counts（决定布局里 EXTRA_COLS 与 blob 的大小）──
    const Value* countsV = obj(meta, "counts");
    if (!countsV) throw std::runtime_error("shared_reader: 元数据缺 counts");
    Counts counts;
    counts.tracers = countsV->find("tracers") ? countsV->find("tracers")->u32() : 0;
    counts.damage = countsV->find("damage") ? countsV->find("damage")->u32() : 0;
    counts.weaponFires = countsV->find("weaponFires") ? countsV->find("weaponFires")->u32() : 0;
    counts.smokeCount = countsV->find("smokeCount") ? countsV->find("smokeCount")->u32() : 0;
    counts.smokeCountPlus1 = countsV->find("smokeCountPlus1") ? countsV->find("smokeCountPlus1")->u32() : 1;
    counts.smokeBufferBytes = countsV->find("smokeBufferBytes") ? countsV->find("smokeBufferBytes")->u32() : 0;
    counts.smokeFrameTicks = countsV->find("smokeFrameTicks") ? countsV->find("smokeFrameTicks")->u32() : 0;
    counts.blobBytes = countsV->find("blobBytes") ? countsV->find("blobBytes")->u32() : 0;

    LayoutInput in;
    in.numFrames = static_cast<std::uint32_t>(Ncap);
    in.numPlayers = static_cast<std::uint32_t>(P);
    in.panelNumFrames = static_cast<std::uint32_t>(Mcap);
    in.flags = static_cast<std::uint32_t>(flags);
    in.counts = counts;
    const Layout layout = computeSharedLayout(in);
    if (sharedBufferBytes(layout) > bytes) {
        throw std::runtime_error("shared_reader: 按布局推算的字节数超过实际缓冲");
    }

    // ── blob ──
    BlobLoc blob{};
    if (const Block* bb = layout.find("blob")) {
        blob.base = p + bb->offset;
        blob.bytes = bb->length;
    }

    DemoData d;

    // ── meta ──
    d.frameCapacity = static_cast<std::uint32_t>(Ncap);
    d.panelCapacity = static_cast<std::uint32_t>(Mcap);
    d.meta.mapName = meta.find("mapName") ? meta.find("mapName")->str() : std::string();
    d.meta.tickRate = meta.find("tickRate") ? meta.find("tickRate")->u32() : kTickRate;
    d.meta.sampleRate = meta.find("sampleRate") ? meta.find("sampleRate")->u32() : 0;
    d.meta.numPlayers = static_cast<std::uint32_t>(P);
    d.meta.startTick = startTick;
    d.meta.endTick = endTick;
    d.meta.durationSeconds = meta.find("durationSeconds") ? meta.find("durationSeconds")->num() : 0.0;

    const std::uint32_t visN = visible.visibleFrames ? visible.visibleFrames : static_cast<std::uint32_t>(Ncap);
    const std::uint32_t visM = visible.panelVisibleFrames ? visible.panelVisibleFrames : static_cast<std::uint32_t>(Mcap);
    d.meta.numFrames = visN;
    d.panelFrames.numFrames = visM;
    if (visible.durationSeconds > 0.0) d.meta.durationSeconds = visible.durationSeconds;

    // ── players ──
    if (const Value* a = arr(meta, "players")) {
        d.players.reserve(a->array.size());
        for (const auto& e : a->array) {
            Player pl;
            pl.slot = e.find("slot") ? e.find("slot")->u32() : 0;
            pl.steamId = e.find("steamId") ? e.find("steamId")->str() : std::string();
            pl.name = e.find("name") ? e.find("name")->str() : std::string();
            if (const Value* x = e.find("clanName"); x && x->type == Value::Type::String) pl.clanName = x->string;
            if (const Value* x = e.find("color"); x && x->type == Value::Type::String) pl.color = x->string;
            if (const Value* x = e.find("crosshairCode"); x && x->type == Value::Type::String) pl.crosshairCode = x->string;
            d.players.push_back(std::move(pl));
        }
    }

    // ── rounds ──
    if (const Value* a = arr(meta, "rounds")) {
        for (const auto& e : a->array) {
            Round r;
            r.index = e.find("index") ? e.find("index")->u32() : 0;
            r.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
            r.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
            r.liveStartTick = e.find("liveStartTick") ? static_cast<i32>(e.find("liveStartTick")->i64()) : 0;
            d.rounds.push_back(r);
        }
    }

    // ── weaponNames ──
    if (const Value* a = arr(meta, "weaponNames")) {
        for (const auto& e : a->array) d.weaponNames.push_back(e.str());
    }

    // ── events ──
    if (const Value* a = arr(meta, "events")) {
        for (const auto& e : a->array) {
            GameEvent ev;
            ev.tick = e.find("tick") ? static_cast<i32>(e.find("tick")->i64()) : 0;
            ev.time = e.find("time") ? e.find("time")->num() : 0.0;
            const std::string& ty = e.find("type") ? e.find("type")->str() : std::string();
            if (ty == "kill") ev.type = EventType::Kill;
            else if (ty == "round_start") ev.type = EventType::RoundStart;
            else if (ty == "round_end") ev.type = EventType::RoundEnd;
            else if (ty == "bomb_planted") ev.type = EventType::BombPlanted;
            else if (ty == "bomb_defused") ev.type = EventType::BombDefused;
            else if (ty == "bomb_exploded") ev.type = EventType::BombExploded;

            if (const Value* x = e.find("victimSlot")) ev.victimSlot = x->u32();
            if (const Value* x = e.find("attackerSlot")) ev.attackerSlot = x->u32();
            if (const Value* x = e.find("assisterSlot")) ev.assisterSlot = x->u32();
            if (const Value* x = e.find("victimName")) ev.victimName = x->str();
            if (const Value* x = e.find("attackerName")) ev.attackerName = x->str();
            if (const Value* x = e.find("victimTeam")) ev.victimTeam = static_cast<u8>(x->u32());
            if (const Value* x = e.find("attackerTeam")) ev.attackerTeam = static_cast<u8>(x->u32());
            if (const Value* x = e.find("weapon")) ev.weapon = x->str();
            ev.headshot = e.find("headshot") ? e.find("headshot")->boolv() : false;
            ev.noscope = e.find("noscope") ? e.find("noscope")->boolv() : false;
            ev.thrusmoke = e.find("thrusmoke") ? e.find("thrusmoke")->boolv() : false;
            ev.attackerblind = e.find("attackerblind") ? e.find("attackerblind")->boolv() : false;
            ev.wallbang = e.find("wallbang") ? e.find("wallbang")->boolv() : false;
            if (const Value* x = e.find("roundWinner")) ev.roundWinner = static_cast<u8>(x->u32());
            if (const Value* x = e.find("roundReason")) ev.roundReason = x->u32();
            d.events.push_back(std::move(ev));
        }
    }

    // ── bomb ──
    if (const Value* b = obj(meta, "bomb")) {
        if (const Value* a = arr(*b, "segments")) {
            for (const auto& e : a->array) {
                BombSegment s;
                const std::string& k = e.find("kind") ? e.find("kind")->str() : std::string();
                if (k == "carried") s.kind = BombSegmentKind::Carried;
                else if (k == "dropped") s.kind = BombSegmentKind::Dropped;
                else s.kind = BombSegmentKind::Planted;
                s.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
                s.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
                s.x = e.find("x") ? e.find("x")->f32v() : 0.f;
                s.y = e.find("y") ? e.find("y")->f32v() : 0.f;
                s.z = e.find("z") ? e.find("z")->f32v() : 0.f;
                s.carrierSlot = e.find("carrierSlot") ? static_cast<std::int32_t>(e.find("carrierSlot")->i64()) : -1;
                const std::string& site = e.find("site") ? e.find("site")->str() : std::string();
                s.site = site == "A" ? BombSite::A : site == "B" ? BombSite::B : BombSite::None;
                d.bomb.segments.push_back(s);
            }
        }
        if (const Value* a = arr(*b, "defuses")) {
            for (const auto& e : a->array) {
                BombDefuse x;
                x.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
                x.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
                x.hasKit = e.find("hasKit") ? e.find("hasKit")->boolv() : false;
                x.defuserSlot = e.find("defuserSlot") ? static_cast<std::int32_t>(e.find("defuserSlot")->i64()) : -1;
                d.bomb.defuses.push_back(x);
            }
        }
    }

    // ── deathMarkers ──
    if (const Value* a = arr(meta, "deathMarkers")) {
        for (const auto& e : a->array) {
            DeathMarker m;
            m.x = e.find("x") ? e.find("x")->f32v() : 0.f;
            m.y = e.find("y") ? e.find("y")->f32v() : 0.f;
            m.z = e.find("z") ? e.find("z")->f32v() : 0.f;
            m.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
            m.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
            m.victimSlot = e.find("victimSlot") ? e.find("victimSlot")->u32() : 0;
            m.team = e.find("team") ? static_cast<u8>(e.find("team")->u32()) : 0;
            m.name = e.find("name") ? e.find("name")->str() : std::string();
            d.deathMarkers.push_back(std::move(m));
        }
    }

    // ── timeouts ──
    if (const Value* t = obj(meta, "timeouts")) {
        d.timeouts.maxTacticalTimeouts = t->find("maxTacticalTimeouts") ? t->find("maxTacticalTimeouts")->u32() : 0;
        if (const Value* a = arr(*t, "intervals")) {
            for (const auto& e : a->array) {
                TimeoutInterval iv;
                iv.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
                iv.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
                const std::string& sd = e.find("side") ? e.find("side")->str() : std::string();
                iv.side = sd == "t" ? TimeoutSide::T : sd == "ct" ? TimeoutSide::CT : TimeoutSide::None;
                iv.technical = e.find("technical") ? e.find("technical")->boolv() : false;
                d.timeouts.intervals.push_back(iv);
            }
        }
        if (const Value* a = arr(*t, "counters")) {
            for (const auto& e : a->array) {
                TimeoutCounter tc;
                tc.tick = e.find("tick") ? static_cast<i32>(e.find("tick")->i64()) : 0;
                tc.tRemaining = e.find("tRemaining") ? e.find("tRemaining")->u32() : 0;
                tc.ctRemaining = e.find("ctRemaining") ? e.find("ctRemaining")->u32() : 0;
                d.timeouts.counters.push_back(tc);
            }
        }
    }

    // ── deathRagdolls ──
    if (const Value* a = arr(meta, "deathRagdolls")) {
        for (const auto& e : a->array) {
            DeathRagdoll r;
            r.tick = e.find("tick") ? static_cast<i32>(e.find("tick")->i64()) : 0;
            r.slot = e.find("slot") ? e.find("slot")->u32() : 0;
            if (const Value* f = arr(e, "force")) for (const auto& x : f->array) r.force.push_back(x.f32v());
            r.bone = e.find("bone") ? e.find("bone")->u32() : 0;
            r.headshot = e.find("headshot") ? e.find("headshot")->boolv() : false;
            if (const Value* f = arr(e, "eyeAngles")) for (const auto& x : f->array) r.eyeAngles.push_back(x.f32v());
            d.deathRagdolls.push_back(std::move(r));
        }
    }

    // ── droppedWeapons（blob 引用）──
    if (const Value* a = arr(meta, "droppedWeapons")) {
        for (const auto& e : a->array) {
            DroppedWeapon w;
            w.entityId = e.find("entityId") ? e.find("entityId")->u32() : 0;
            w.weapon = e.find("weapon") ? e.find("weapon")->str() : std::string();
            w.itemDef = e.find("itemDef") ? e.find("itemDef")->u32() : 0;
            w.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
            w.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
            readBlobInto(blob, e.find("ticks"), w.ticks);
            readBlobInto(blob, e.find("positions"), w.positions);
            readBlobInto(blob, e.find("angles"), w.angles);
            d.droppedWeapons.push_back(std::move(w));
        }
    }

    // ── mapEntities（blob 引用）──
    if (const Value* a = arr(meta, "mapEntities")) {
        for (const auto& e : a->array) {
            MapEntity m;
            m.className = e.find("className") ? e.find("className")->str() : std::string();
            readBlobInto(blob, e.find("origin"), m.origin);
            m.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
            m.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
            readBlobInto(blob, e.find("ticks"), m.ticks);
            readBlobInto(blob, e.find("angles"), m.angles);
            readBlobInto(blob, e.find("hidden"), m.hidden);
            d.mapEntities.push_back(std::move(m));
        }
    }

    // ── grenades ──
    if (const Value* g = obj(meta, "grenades")) {
        if (const Value* a = arr(*g, "trajectories")) {
            for (const auto& e : a->array) {
                GrenadeTrajectory tr;
                const std::string& k = e.find("kind") ? e.find("kind")->str() : std::string();
                tr.kind = k == "smoke" ? GrenadeKind::Smoke
                        : k == "flash" ? GrenadeKind::Flash
                        : k == "molotov" ? GrenadeKind::Molotov
                        : k == "decoy" ? GrenadeKind::Decoy
                        : GrenadeKind::HE;
                tr.throwerSlot = e.find("throwerSlot") ? static_cast<std::int32_t>(e.find("throwerSlot")->i64()) : -1;
                tr.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
                tr.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
                if (const Value* x = e.find("detonationTick"); x && x->type == Value::Type::Number) {
                    tr.detonationTick = static_cast<i32>(x->i64());
                }
                readBlobInto(blob, e.find("posXYZ"), tr.posXYZ);
                readBlobInto(blob, e.find("ticks"), tr.ticks);
                std::vector<float> anglesTmp;
                readBlobInto(blob, e.find("angles"), anglesTmp);
                if (!anglesTmp.empty()) tr.angles = std::move(anglesTmp);
                tr.incendiary = e.find("incendiary") ? e.find("incendiary")->boolv() : false;
                d.grenades.trajectories.push_back(std::move(tr));
            }
        }
        if (const Value* a = arr(*g, "effects")) {
            for (const auto& e : a->array) {
                GrenadeEffect ef;
                const std::string& k = e.find("kind") ? e.find("kind")->str() : std::string();
                ef.kind = k == "smoke" ? GrenadeKind::Smoke
                        : k == "flash" ? GrenadeKind::Flash
                        : k == "molotov" ? GrenadeKind::Molotov
                        : k == "decoy" ? GrenadeKind::Decoy
                        : GrenadeKind::HE;
                ef.x = e.find("x") ? e.find("x")->f32v() : 0.f;
                ef.y = e.find("y") ? e.find("y")->f32v() : 0.f;
                ef.z = e.find("z") ? e.find("z")->f32v() : 0.f;
                ef.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
                ef.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
                d.grenades.effects.push_back(ef);
            }
        }
        if (const Value* a = arr(*g, "infernos")) {
            for (const auto& e : a->array) {
                Inferno inf;
                inf.entityId = e.find("entityId") ? e.find("entityId")->u32() : 0;
                inf.startTick = e.find("startTick") ? static_cast<i32>(e.find("startTick")->i64()) : 0;
                inf.endTick = e.find("endTick") ? static_cast<i32>(e.find("endTick")->i64()) : 0;
                if (const Value* x = e.find("effectTick"); x && x->type == Value::Type::Number) inf.effectTick = static_cast<i32>(x->i64());
                if (const Value* x = e.find("infernoType"); x && x->type == Value::Type::Number) inf.infernoType = x->u32();
                if (const Value* x = e.find("lifetime"); x && x->type == Value::Type::Number) inf.lifetime = x->f32v();
                if (const Value* fr = arr(e, "frames")) {
                    for (const auto& fe : fr->array) {
                        InfernoFrame f;
                        f.tick = fe.find("tick") ? static_cast<i32>(fe.find("tick")->i64()) : 0;
                        readBlobInto(blob, fe.find("positions"), f.positions);
                        readBlobInto(blob, fe.find("burning"), f.burning);
                        readBlobInto(blob, fe.find("origin"), f.origin);
                        std::vector<float> pp, nm;
                        readBlobInto(blob, fe.find("parentPositions"), pp);
                        readBlobInto(blob, fe.find("normals"), nm);
                        if (!pp.empty()) f.parentPositions = std::move(pp);
                        if (!nm.empty()) f.normals = std::move(nm);
                        inf.frames.push_back(std::move(f));
                    }
                }
                d.grenades.infernos.push_back(std::move(inf));
            }
        }
    }

    // ── 列块 ──
    readBlock(p, layout, "frameTick", d.frames.frameTick);
    readBlock(p, layout, "posX", d.frames.posX);
    readBlock(p, layout, "posY", d.frames.posY);
    readBlock(p, layout, "posZ", d.frames.posZ);
    readBlock(p, layout, "yaw", d.frames.yaw);
    readBlock(p, layout, "pitch", d.frames.pitch);
    readBlock(p, layout, "health", d.frames.health);
    readBlock(p, layout, "alive", d.frames.alive);
    readBlock(p, layout, "team", d.frames.team);
    readBlock(p, layout, "score", d.frames.score);
    readBlock(p, layout, "duck", d.frames.duck);
    readBlock(p, layout, "flash", d.frames.flash);
    readBlock(p, layout, "flashAlpha", d.frames.flashAlpha);
    readBlock(p, layout, "zoom", d.frames.zoom);
    readBlock(p, layout, "accuracyPenalty", d.frames.accuracyPenalty);
    readBlock(p, layout, "reloading", d.frames.reloading);
    readBlock(p, layout, "playerFlags", d.frames.playerFlags);
    readBlock(p, layout, "speed", d.frames.speed);
    readBlock(p, layout, "smoothSpeed", d.frames.smoothSpeed);

    readBlock(p, layout, "panelFrameTick", d.panelFrames.frameTick);
    readBlock(p, layout, "panelHealth", d.panelFrames.health);
    readBlock(p, layout, "panelAlive", d.panelFrames.alive);
    readBlock(p, layout, "panelTeam", d.panelFrames.team);
    readBlock(p, layout, "panelArmor", d.panelFrames.armor);
    readBlock(p, layout, "panelFlags", d.panelFrames.flags);
    readBlock(p, layout, "panelMoney", d.panelFrames.money);
    readBlock(p, layout, "panelClipAmmo", d.panelFrames.clipAmmo);
    readBlock(p, layout, "panelReserveAmmo", d.panelFrames.reserveAmmo);
    readBlock(p, layout, "panelActiveWeapon", d.panelFrames.activeWeapon);
    readBlock(p, layout, "panelUtilCounts", d.panelFrames.utilCounts);

    readBlock(p, layout, "tracers.origin", d.tracers.origin);
    readBlock(p, layout, "tracers.end", d.tracers.end);
    readBlock(p, layout, "tracers.tick", d.tracers.tick);
    readBlock(p, layout, "tracers.team", d.tracers.team);
    readBlock(p, layout, "tracers.hitKind", d.tracers.hitKind);
    d.tracers.count = counts.tracers;

    readBlock(p, layout, "damage.attackerSlot", d.damage.attackerSlot);
    readBlock(p, layout, "damage.victimSlot", d.damage.victimSlot);
    readBlock(p, layout, "damage.tick", d.damage.tick);
    readBlock(p, layout, "damage.dmg", d.damage.dmg);
    d.damage.count = counts.damage;

    readBlock(p, layout, "weaponFires.ticks", d.weaponFires.ticks);
    readBlock(p, layout, "weaponFires.slots", d.weaponFires.slots);

    d.smokeVoxels.count = counts.smokeCount;
    readBlock(p, layout, "smokeVoxels.tickBegin", d.smokeVoxels.tickBegin);
    readBlock(p, layout, "smokeVoxels.detonation", d.smokeVoxels.detonation);
    readBlock(p, layout, "smokeVoxels.color", d.smokeVoxels.color);
    readBlock(p, layout, "smokeVoxels.bufferOffsets", d.smokeVoxels.bufferOffsets);
    readBlock(p, layout, "smokeVoxels.frameOffsets", d.smokeVoxels.frameOffsets);
    readBlock(p, layout, "smokeVoxels.buffers", d.smokeVoxels.buffers);
    readBlock(p, layout, "smokeVoxels.frameTicks", d.smokeVoxels.frameTicks);

    return d;
}

DemoData readSharedBufferFile(const char* path, Visible visible) {
    std::vector<std::uint8_t> buf;
    readFileBytes(path, buf);
    return readSharedBufferToDemoData(buf.data(), buf.size(), visible);
}

}  // namespace csdemo
