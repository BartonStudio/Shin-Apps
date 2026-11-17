#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <system_error>
#include <unordered_map>
#include <vector>

#include "EntityStore.hpp"
#include "EntityTypes.hpp"
#include "shim.h"

// =============================================================================
// DemoLoader —— 解析结果 → EntityStore 的灌装层（纯域类，无 iobject 依赖）
//
// 职责（架构文档 §4.1 数据链路的最后一跳）：把增量存储的 demo 还原成完整数据。
//   1. 经 cs2ffi 打开 demo（四趟解析，Rust 侧）；
//   2. 玩家列转行 → 每 tick 全量快照（位置/朝向/生死/记分/弹药/当前武器编号）；
//   3. player_death → KillEvent；bomb_* → C4 状态机（稀疏变更表）；
//   4. 武器趟落地行（steamid==0）→ 地上武器实体（按「地面段」切分、稠密化）；
//   5. 投掷物趟 → GrenadeSpec 轨迹 + 短命实体。
//
// 线程模型：Load 可在任意后台线程调用；store 写入期间主线程不消费
// （DemoLoaderNode 保证装载完成前前端拿不到 done 状态）。
// =============================================================================

namespace demoviewer {

/// 解析结果元信息（前端展示：地图、时长、文件大小）。
struct DemoMeta {
    std::string mapName;
    Tick maxTick = 0;
    float durationSec = 0.0f;  // maxTick / 64
    std::uint64_t fileSize = 0;  // demo 文件字节数（File Loaded 卡片展示）
};

/// 装载阶段（DemoLoaderNode 经 ReadData("progress") 暴露给前端）。
enum class LoadStage : std::uint8_t { Idle, Parsing, Filling, Done, Error };

class DemoLoader {
public:
    using ProgressFn = std::function<void(LoadStage stage, int percent)>;

    /// 把 path 指向的 demo 灌进 store。失败返回 false 且 error 带说明。
    static bool Load(const std::string& path, EntityStore& store, DemoMeta& meta,
                     const ProgressFn& onProgress, std::string& error) {
        DemoHandle* h = demo_open(path.c_str());
        if (!h) {
            error = "demo_open 失败: " + std::string(demo_last_error() ? demo_last_error() : "?");
            return false;
        }
        struct Guard {
            DemoHandle* h;
            ~Guard() { demo_close(h); }
        } guard{h};

        // ---- 元信息 ----
        {
            std::error_code ec;
            const auto bytes = std::filesystem::file_size(path, ec);
            meta.fileSize = ec ? 0 : static_cast<std::uint64_t>(bytes);
        }
        meta.mapName = demo_map_name(h) ? demo_map_name(h) : "";
        meta.maxTick = static_cast<Tick>(demo_max_tick(h));
        meta.durationSec = static_cast<float>(meta.maxTick) / 64.0f;
        store.SetMapName(meta.mapName);
        store.SetMaxTick(meta.maxTick);
        if (meta.maxTick == 0) {
            error = "demo_max_tick = 0（空录像或解析异常）";
            return false;
        }
        if (onProgress) onProgress(LoadStage::Parsing, 10);

        // ---- 1. 名册：steamid → EntityId（内部自增 1..n）----
        const int64_t rosterN = demo_roster_count(h);
        const DemoPlayerInfo* roster = demo_roster(h);
        if (rosterN <= 0 || !roster) {
            error = "名册为空";
            return false;
        }
        std::unordered_map<std::uint64_t, EntityId> sidToId;
        std::unordered_map<std::string, EntityId> strSidToId;
        std::vector<PlayerIdentity> identities;
        identities.reserve(static_cast<std::size_t>(rosterN));
        int slotT = 0, slotCT = 0;
        for (int64_t i = 0; i < rosterN; ++i) {
            const EntityId id = static_cast<EntityId>(i + 1);
            PlayerIdentity identity;
            identity.name = roster[i].name ? roster[i].name : "";
            identity.steamId = std::to_string(roster[i].steamid);
            if (roster[i].team == 2) {
                identity.team = Team::T;
                identity.teamSlot = static_cast<std::uint8_t>(slotT++);
            } else if (roster[i].team == 3) {
                identity.team = Team::CT;
                identity.teamSlot = static_cast<std::uint8_t>(slotCT++);
            }
            sidToId[roster[i].steamid] = id;
            strSidToId[identity.steamId] = id;
            identities.push_back(std::move(identity));
        }

        // ---- 2. 玩家快照（列转行）+ 武器切换检测 ----
        if (onProgress) onProgress(LoadStage::Filling, 30);
        const int64_t N = demo_col_len(h, DEMO_PASS_PLAYER);
        if (N <= 0) {
            error = "玩家趟无数据";
            return false;
        }

        // 列指针（缺失的列记为 null，字段映射处做空值兜底）
        const float*    px      = demo_col_f32(h, DEMO_PASS_PLAYER, "X");
        const float*    py      = demo_col_f32(h, DEMO_PASS_PLAYER, "Y");
        const float*    pz      = demo_col_f32(h, DEMO_PASS_PLAYER, "Z");
        const float*    ppitch  = demo_col_f32(h, DEMO_PASS_PLAYER, "pitch");
        const float*    pyaw    = demo_col_f32(h, DEMO_PASS_PLAYER, "yaw");
        const uint8_t*  palive  = demo_col_u8(h, DEMO_PASS_PLAYER, "is_alive");
        const uint64_t* psid    = demo_col_u64(h, DEMO_PASS_PLAYER, "steamid");
        const int32_t*  ptick   = demo_col_i32(h, DEMO_PASS_PLAYER, "tick");
        const int32_t*  pkills  = demo_col_i32(h, DEMO_PASS_PLAYER, KILLS_COL);
        const int32_t*  pdeaths = demo_col_i32(h, DEMO_PASS_PLAYER, DEATHS_COL);
        const int32_t*  passist = demo_col_i32(h, DEMO_PASS_PLAYER, ASSISTS_COL);
        const int32_t*  pmoney  = demo_col_i32(h, DEMO_PASS_PLAYER, MONEY_COL);
        // 前端契约（frames/panelFrames）需要的逐帧列（真实 prop 路径）
        const uint32_t* pteam   = demo_col_u32(h, DEMO_PASS_PLAYER, TEAM_COL);
        const int32_t*  pscore  = demo_col_i32(h, DEMO_PASS_PLAYER, SCORE_COL);
        const int32_t*  parmor  = demo_col_i32(h, DEMO_PASS_PLAYER, ARMOR_COL);
        const float*    pduck   = demo_col_f32(h, DEMO_PASS_PLAYER, DUCK_COL);
        const int32_t*  phealth = demo_col_i32(h, DEMO_PASS_PLAYER, HEALTH_COL);
        if (!psid || !ptick) {
            error = "玩家趟缺 steamid/tick 列";
            return false;
        }

        // 武器趟列（弹药匹配用）。
        // 关键事实：武器趟是「变更时才有行」的稀疏流（不是每 tick 每把武器都有），
        // 所以弹药语义 = 「≤ 当前 tick 的最近一次该武器更新」。
        const int64_t   M       = demo_col_len(h, DEMO_PASS_WEAPON);
        const int32_t*  wtick   = demo_col_i32(h, DEMO_PASS_WEAPON, "tick");
        const uint64_t* wsid    = demo_col_u64(h, DEMO_PASS_WEAPON, "steamid");
        const uint32_t* wclip   = demo_col_u32(h, DEMO_PASS_WEAPON, "m_iClip1");
        const int32_t*  wres    = demo_col_i32(h, DEMO_PASS_WEAPON, "m_pReserveAmmo");
        const int32_t*  wentity = demo_col_i32(h, DEMO_PASS_WEAPON, "entity_id");
        const float*    wx      = demo_col_f32(h, DEMO_PASS_WEAPON, "x");
        const float*    wy      = demo_col_f32(h, DEMO_PASS_WEAPON, "y");
        const float*    wz      = demo_col_f32(h, DEMO_PASS_WEAPON, "z");
        const bool ammoReady = M > 0 && wtick && wsid && wclip && wres;

        // 按持有者聚合弹药时间线：每 (玩家, 武器名) 一条 (tick → clip/reserve) 序列。
        struct AmmoTimeline {
            std::vector<std::pair<Tick, std::pair<std::uint16_t, std::uint16_t>>> pts;
            std::size_t cursor = 0;  // 玩家行按 tick 升序消费，游标只前进
        };
        std::vector<std::unordered_map<std::string, AmmoTimeline>> ammo(
            static_cast<std::size_t>(rosterN));

        // 地上行收集（steamid==0 = 无持有者：掉落的枪 / 落地的 C4）。
        // 同一游戏实体 id 可能多次落地（掉→捡→再掉），先攒原始行、后面按「地面段」切分。
        struct GroundRow { Tick t; float x, y, z; };
        struct GroundBuild {
            std::string weapon;           // 首个非空武器名
            std::vector<GroundRow> rows;  // 本实体全部地面行（升序）
            std::vector<Tick> ownedTicks; // 持有行 tick（=被捡起时刻，用于封段）
        };
        std::unordered_map<int64_t, GroundBuild> ground;
        std::vector<GroundRow> c4Ground;  // C4 落地行（跨回合聚合到合成 id）
        if (M > 0 && wtick) {
            for (int64_t k = 0; k < M; ++k) {
                const Tick t = static_cast<Tick>(wtick[k]);
                GroundBuild& gb = ground[wentity ? wentity[k] : k];
                if (wsid[k] != 0) {
                    gb.ownedTicks.push_back(t);
                    continue;
                }
                const char* wn = demo_col_str(h, DEMO_PASS_WEAPON, "weapon", k);
                const std::string weapon = wn ? wn : "";
                const GroundRow row{t, wx ? wx[k] : 0.0f, wy ? wy[k] : 0.0f, wz ? wz[k] : 0.0f};
                if (weapon == "C4 Explosive") {
                    c4Ground.push_back(row);  // C4 走单独的状态机/合成实体
                    continue;
                }
                if (gb.weapon.empty() && !weapon.empty()) gb.weapon = weapon;
                gb.rows.push_back(row);
            }
        }

        // 投掷物行收集（grenade_entity_id 分组；行序 tick 升序）
        const int64_t  G       = demo_col_len(h, DEMO_PASS_GRENADE);
        const int32_t* gentity = demo_col_i32(h, DEMO_PASS_GRENADE, "grenade_entity_id");
        const int32_t* gtick   = demo_col_i32(h, DEMO_PASS_GRENADE, "tick");
        const uint64_t* gsid   = demo_col_u64(h, DEMO_PASS_GRENADE, "steamid");
        const float*   gx      = demo_col_f32(h, DEMO_PASS_GRENADE, "x");
        const float*   gy      = demo_col_f32(h, DEMO_PASS_GRENADE, "y");
        const float*   gz      = demo_col_f32(h, DEMO_PASS_GRENADE, "z");
        struct GrenadeBuild {
            std::string type;
            std::uint64_t throwerSid = 0;  // 投掷者 steamid（行内不变，取首个）
            std::vector<GroundRow> rows;
        };
        std::unordered_map<int64_t, GrenadeBuild> grenades;
        if (G > 0 && gentity && gtick) {
            for (int64_t k = 0; k < G; ++k) {
                GrenadeBuild& gb = grenades[gentity[k]];
                if (gb.type.empty()) {
                    const char* gt = demo_col_str(h, DEMO_PASS_GRENADE, "grenade_type", k);
                    if (gt) gb.type = gt;
                }
                if (gb.throwerSid == 0 && gsid) gb.throwerSid = gsid[k];
                gb.rows.push_back({static_cast<Tick>(gtick[k]),
                                   gx ? gx[k] : 0.0f, gy ? gy[k] : 0.0f, gz ? gz[k] : 0.0f});
            }
        }

        if (ammoReady) {
            for (int64_t k = 0; k < M; ++k) {
                auto it = sidToId.find(wsid[k]);
                if (it == sidToId.end()) continue;
                const char* wn = demo_col_str(h, DEMO_PASS_WEAPON, "weapon", k);
                if (!wn) continue;
                ammo[static_cast<std::size_t>(it->second - 1)][wn].pts.emplace_back(
                    static_cast<Tick>(wtick[k]),
                    std::make_pair(static_cast<std::uint16_t>(wclip[k]),
                                   static_cast<std::uint16_t>(wres[k] < 0 ? 0 : wres[k])));
            }
        }

        // 每玩家的构建缓冲：frames[本地 tick 下标]
        const std::size_t nTicks = static_cast<std::size_t>(meta.maxTick) + 1;
        struct PlayerBuild {
            explicit PlayerBuild(std::size_t nTicks) : frames(nTicks) {}
            std::vector<PlayerSnapshot> frames;
            Vec3 lastPos{};  // None→NaN 时沿用上一个有效坐标
        };
        std::vector<PlayerBuild> builds;
        builds.reserve(static_cast<std::size_t>(rosterN));
        for (int64_t i = 0; i < rosterN; ++i)
            builds.emplace_back(nTicks);

        // 行主循环：行序 = tick 优先、每 tick 内玩家稳定（步骤 2 已验证）。
        for (int64_t i = 0; i < N; ++i) {
            auto sidIt = sidToId.find(psid[i]);
            if (sidIt == sidToId.end()) continue;
            const EntityId id = sidIt->second;
            PlayerBuild& b = builds[id - 1];
            const Tick t = static_cast<Tick>(ptick[i]);
            if (t > meta.maxTick) continue;
            PlayerSnapshot& s = b.frames[t];

            // 当前武器（全量快照：登记武器目录、快照里存编号）
            const char* w = demo_col_str(h, DEMO_PASS_PLAYER, "weapon_name", i);
            const std::string ws = w ? w : "";
            if (!ws.empty()) s.weaponNum = store.InternWeapon(ws);

            // 弹药：当前武器时间线上，≤ t 的最近一次更新
            if (ammoReady && !ws.empty()) {
                auto& timelines = ammo[static_cast<std::size_t>(id - 1)];
                auto it = timelines.find(ws);
                if (it != timelines.end()) {
                    AmmoTimeline& tl = it->second;
                    while (tl.cursor < tl.pts.size() && tl.pts[tl.cursor].first <= t) {
                        ++tl.cursor;
                    }
                    if (tl.cursor > 0) {
                        s.clipAmmo = tl.pts[tl.cursor - 1].second.first;
                        s.reserveMagazines = tl.pts[tl.cursor - 1].second.second;
                    }
                }
            }

            // 位置（None→NaN 时沿用上一个有效值，避免跳 0 点）
            if (px && py && pz) {
                if (!std::isnan(px[i])) { b.lastPos.x = px[i]; }
                if (!std::isnan(py[i])) { b.lastPos.y = py[i]; }
                if (!std::isnan(pz[i])) { b.lastPos.z = pz[i]; }
                s.pos = b.lastPos;
            }
            if (ppitch) s.view.pitch = ppitch[i];
            if (pyaw) s.view.yaw = pyaw[i];
            if (pkills) s.kills = static_cast<std::uint16_t>(pkills[i] < 0 ? 0 : pkills[i]);
            if (pdeaths) s.deaths = static_cast<std::uint16_t>(pdeaths[i] < 0 ? 0 : pdeaths[i]);
            if (passist) s.assists = static_cast<std::uint16_t>(passist[i] < 0 ? 0 : passist[i]);
            if (pmoney) s.money = static_cast<std::uint16_t>(pmoney[i] < 0 ? 0 : pmoney[i]);
            if (palive) s.alive = palive[i] != 0;
            if (phealth) s.health = static_cast<std::uint8_t>(phealth[i] < 0 ? 0 : (phealth[i] > 100 ? 100 : phealth[i]));
            // 契约逐帧字段：team 2/3 之外的值（0 等）= 未参战
            if (pteam) {
                const std::uint32_t tn = pteam[i];
                s.team = (tn == 2 || tn == 3) ? static_cast<std::uint8_t>(tn) : 0;
            }
            if (pscore) s.score = static_cast<std::uint16_t>(pscore[i] < 0 ? 0 : pscore[i]);
            if (parmor) s.armor = static_cast<std::uint8_t>(parmor[i] < 0 ? 0 : parmor[i]);
            if (pduck) s.duck = pduck[i] < 0.0f ? 0.0f : (pduck[i] > 1.0f ? 1.0f : pduck[i]);
        }

        // ---- 3. 击杀事件 ----
        const int64_t deathN = demo_event_count(h, "player_death");
        for (int64_t i = 0; i < deathN; ++i) {
            KillEvent e;
            e.tick = static_cast<Tick>(demo_event_tick(h, "player_death", i));
            DemoVariant v;
            auto field = [&](const char* name, std::string& out) {
                if (demo_event_field(h, "player_death", i, name, &v) == 1 &&
                    v.tag == DEMO_VAR_STR && v.value.s) {
                    out = v.value.s;
                    return true;
                }
                return false;
            };
            std::string killerSid, victimSid;
            field("attacker_steamid", killerSid);
            field("user_steamid", victimSid);
            if (!victimSid.empty()) {
                auto it = strSidToId.find(victimSid);
                if (it != strSidToId.end()) e.victim = it->second;
            }
            // killer = 0 表示自杀/环境伤害（§4.3 约定）
            if (!killerSid.empty() && killerSid != victimSid) {
                auto it = strSidToId.find(killerSid);
                if (it != strSidToId.end()) e.killer = it->second;
            }
            if (demo_event_field(h, "player_death", i, "weapon", &v) == 1 &&
                v.tag == DEMO_VAR_STR && v.value.s) {
                e.weapon = v.value.s;
            }
            if (demo_event_field(h, "player_death", i, "headshot", &v) == 1 &&
                v.tag == DEMO_VAR_BOOL) {
                e.headshot = v.value.b != 0;
            }
            store.AddKillEvent(std::move(e));
        }

        // ---- 3b. round_start tick（地上武器生命周期封口 + 回合表构建）----
        std::vector<Tick> roundStarts;
        {
            const int64_t rsN = demo_event_count(h, "round_start");
            roundStarts.reserve(static_cast<std::size_t>(rsN));
            for (int64_t i = 0; i < rsN; ++i) {
                roundStarts.push_back(static_cast<Tick>(demo_event_tick(h, "round_start", i)));
            }
        }

        // 回合表（前端 manifest.rounds[]）：round_start 开回合，
        // round_freeze_end 定 liveStartTick，round_end 定胜方，endTick = 下一回合开始前一刻。
        {
            const int64_t reN = demo_event_count(h, "round_end");
            std::vector<std::pair<Tick, std::uint8_t>> roundEnds;  // (tick, winnerTeam)
            roundEnds.reserve(static_cast<std::size_t>(reN));
            for (int64_t i = 0; i < reN; ++i) {
                std::uint8_t winner = 0;
                DemoVariant v;
                if (demo_event_field(h, "round_end", i, "winner", &v) == 1) {
                    if (v.tag == DEMO_VAR_I32) {
                        winner = (v.value.i == 2 || v.value.i == 3) ? (std::uint8_t)v.value.i : 0;
                    } else if (v.tag == DEMO_VAR_STR && v.value.s) {
                        if (std::strcmp(v.value.s, "T") == 0) winner = 2;
                        else if (std::strcmp(v.value.s, "CT") == 0) winner = 3;
                    }
                }
                roundEnds.emplace_back(static_cast<Tick>(demo_event_tick(h, "round_end", i)), winner);
            }

            const int64_t feN = demo_event_count(h, "round_freeze_end");
            std::vector<Tick> freezeEnds;
            freezeEnds.reserve(static_cast<std::size_t>(feN));
            for (int64_t i = 0; i < feN; ++i) {
                freezeEnds.push_back(static_cast<Tick>(demo_event_tick(h, "round_freeze_end", i)));
            }
            for (std::size_t r = 0; r < roundStarts.size(); ++r) {
                RoundSpan span;
                span.index = static_cast<std::uint32_t>(r);
                span.startTick = roundStarts[r];
                span.endTick = (r + 1 < roundStarts.size()) ? roundStarts[r + 1] - 1
                                                            : meta.maxTick;
                // liveStartTick：本回合 startTick 之后第一个 freeze_end（没有则取 startTick）
                for (Tick fe : freezeEnds) {
                    if (fe >= span.startTick) { span.liveStartTick = fe; break; }
                }
                if (span.liveStartTick == 0) span.liveStartTick = span.startTick;
                // 胜方：本回合区间内最后一个 round_end 的 winner
                for (const auto& [reTick, winner] : roundEnds) {
                    if (reTick >= span.startTick && reTick <= span.endTick) {
                        span.winnerTeam = winner;  // 取最后一个（覆盖）
                    }
                }
                store.AddRound(span);
            }
        }
        auto nextRoundStart = [&](Tick t) -> Tick {
            for (Tick r : roundStarts) {
                if (r > t) return r;
            }
            return meta.maxTick + 1;
        };

        // ---- 3c. 地上武器灌库：同一实体 id 的「地面段」拆成独立合成实体 ----
        //   合成 id 空间：0x10000000 + gid*4 + 段序（与投掷物 0x20000000 段隔离）。
        //   段尾 = min(下次被捡起的持有行 tick, 下一个 round_start)——
        //   行是稀疏流，躺在地上不动的枪不会再出行，用回合开始封口。
        for (auto& [gid, gb] : ground) {
            if (gb.rows.empty()) continue;
            const std::vector<Tick>& owned = gb.ownedTicks;
            std::size_t oi = 0, row = 0, seg = 0;
            while (row < gb.rows.size()) {
                const Tick begin = gb.rows[row].t;
                while (oi < owned.size() && owned[oi] <= begin) ++oi;
                const Tick ownedAfter = oi < owned.size() ? owned[oi] : 0;
                std::size_t j = row;
                while (j < gb.rows.size() && (ownedAfter == 0 || gb.rows[j].t < ownedAfter)) ++j;
                const Tick lastRow = gb.rows[j - 1].t;
                Tick end = nextRoundStart(lastRow);
                if (ownedAfter != 0 && ownedAfter < end) end = ownedAfter;
                if (end <= begin) end = begin + 1;

                // 稠密化：行间沿用上一个有效位置（增量 → 全量快照）
                std::vector<TransformSnapshot> frames;
                frames.reserve(static_cast<std::size_t>(end - begin));
                std::size_t r = row;
                Vec3 last{};
                for (Tick t = begin; t < end; ++t) {
                    while (r < j && gb.rows[r].t == t) {
                        const GroundRow& gr = gb.rows[r];
                        if (!std::isnan(gr.x)) last.x = gr.x;
                        if (!std::isnan(gr.y)) last.y = gr.y;
                        if (!std::isnan(gr.z)) last.z = gr.z;
                        ++r;
                    }
                    frames.push_back(TransformSnapshot{last, ViewAngle{}});
                }
                const EntityId id = static_cast<EntityId>(0x10000000u + gid * 4 + seg);
                store.AddEntity(id, EntityKind::Weapon, begin, end, std::move(frames));
                if (!gb.weapon.empty()) store.SetWeaponSpec(id, WeaponSpec{gb.weapon});
                row = j;
                ++seg;
            }
        }

        // ---- 3d. 投掷物灌库：按「实体 id + 连续段」切分（与前端 worker 同款规则）----
        //   游戏会跨回合复用实体 id：tick 间隔 > 32 即断开新段；有效点 < 3 的段丢弃。
        //   合成 id：0x20000000 + 全局段序号。
        {
            constexpr Tick kTrajectoryGap = 32;
            std::uint32_t runCounter = 0;
            for (auto& [gid, gb] : grenades) {
                if (gb.rows.empty()) continue;
                auto th = sidToId.find(gb.throwerSid);
                const EntityId thrower = th != sidToId.end() ? th->second : 0;

                // 切段
                std::vector<std::size_t> runStarts;
                runStarts.push_back(0);
                for (std::size_t i = 1; i < gb.rows.size(); ++i) {
                    if (gb.rows[i].t - gb.rows[i - 1].t > kTrajectoryGap) runStarts.push_back(i);
                }
                runStarts.push_back(gb.rows.size());

                for (std::size_t r = 0; r + 1 < runStarts.size(); ++r) {
                    const std::size_t r0 = runStarts[r], r1 = runStarts[r + 1];
                    const Tick begin = gb.rows[r0].t;
                    const Tick lastRow = gb.rows[r1 - 1].t;

                    // 稠密化（增量 → 全量快照）
                    std::vector<TransformSnapshot> frames;
                    frames.reserve(static_cast<std::size_t>(lastRow - begin) + 1);
                    std::size_t k = r0;
                    Vec3 last{};
                    for (Tick t = begin; t <= lastRow; ++t) {
                        while (k < r1 && gb.rows[k].t == t) {
                            const GroundRow& gr = gb.rows[k];
                            if (!std::isnan(gr.x)) last.x = gr.x;
                            if (!std::isnan(gr.y)) last.y = gr.y;
                            if (!std::isnan(gr.z)) last.z = gr.z;
                            ++k;
                        }
                        frames.push_back(TransformSnapshot{last, ViewAngle{}});
                    }

                    GrenadeSpec spec;
                    spec.kind = GrenadeKindOf(gb.type);
                    spec.thrower = thrower;
                    spec.throwTick = begin;
                    spec.effectRadius = spec.kind == GrenadeKind::Smoke ? 144.0f : 0.0f;
                    for (std::size_t k2 = r0; k2 < r1; ++k2) {
                        const GroundRow& gr = gb.rows[k2];
                        if (!std::isnan(gr.x) && !std::isnan(gr.y) && !std::isnan(gr.z)) {
                            spec.trajectoryPoints.push_back({gr.x, gr.y, gr.z});
                            spec.trajectoryTicks.push_back(gr.t);
                        }
                    }
                    if (spec.trajectoryPoints.size() < 3) continue;  // 无法拟合抛物线
                    spec.detonateTick = spec.trajectoryTicks.back();  // 引爆 tick 近似 = 末采样

                    const EntityId id = static_cast<EntityId>(0x20000000u + runCounter++);
                    store.AddEntity(id, EntityKind::Grenade, begin, lastRow + 1, std::move(frames));
                    store.SetGrenadeSpec(id, std::move(spec));
                }
            }
        }

        // ---- 3e. C4 状态机：bomb_* 事件 → 稀疏状态变更 + 静态 spec ----
        {
            struct C4Event { Tick t; C4Status st; EntityId carrier; };
            std::vector<C4Event> c4Events;
            auto collect = [&](const char* name, C4Status st) {
                const int64_t n = demo_event_count(h, name);
                for (int64_t i = 0; i < n; ++i) {
                    C4Event e{static_cast<Tick>(demo_event_tick(h, name, i)), st, 0};
                    DemoVariant v;
                    if (demo_event_field(h, name, i, "user_steamid", &v) == 1 &&
                        v.tag == DEMO_VAR_STR && v.value.s) {
                        auto it = strSidToId.find(v.value.s);
                        if (it != strSidToId.end()) e.carrier = it->second;
                    }
                    c4Events.push_back(e);
                }
            };
            collect("bomb_pickup",   C4Status::Carried);
            collect("bomb_dropped",  C4Status::Dropped);
            collect("bomb_planted",  C4Status::Planted);
            collect("bomb_defused",  C4Status::Defused);
            collect("bomb_exploded", C4Status::Exploded);
            std::sort(c4Events.begin(), c4Events.end(),
                      [](const C4Event& a, const C4Event& b) { return a.t < b.t; });

            C4Spec spec;
            bool planted = false;
            for (const C4Event& e : c4Events) {
                store.AddC4StatusChange(kC4EntityId, e.t, e.st);
                if (e.st == C4Status::Carried || e.st == C4Status::Dropped) spec.carrier = e.carrier;
                if (e.st == C4Status::Planted) {
                    planted = true;
                    spec.plantTick = e.t;
                    spec.explodeTick = 0;  // 新一轮安放：清掉旧回合的爆炸终点
                    // 安放位置：武器趟没有「安放后的 C4」实体行，用安放者脚下位置
                    if (e.carrier != 0) {
                        const PlayerBuild& pb = builds[static_cast<std::size_t>(e.carrier - 1)];
                        if (e.t < pb.frames.size()) spec.plantPos = pb.frames[e.t].pos;
                    }
                }
                // 爆炸事件可能属于更早回合的 plant（spec 记录的是最后一次安放），
                // 只有发生在 plant 之后/当刻的爆炸才是本次倒计时的终点。
                if (e.st == C4Status::Exploded && (!planted || e.t >= spec.plantTick)) {
                    spec.explodeTick = e.t;
                }
            }
            if (planted && spec.explodeTick == 0) spec.explodeTick = spec.plantTick + 40 * 64;
            if (!c4Events.empty()) {
                store.SetC4Spec(kC4EntityId, spec);
            }

            // C4 实体：整场存活；位置按状态段推算——
            //   Planted/Defused/Exploded → 钉在 plantPos；
            //   Carried/Dropped → 携带者（或掉落者）当时的玩家位置；
            //   事件前 → (0,0,0)（前端按 Carried 跟随携带者，不用此值）。
            {
                std::vector<TransformSnapshot> c4Frames;
                c4Frames.reserve(nTicks);
                std::size_t ei = 0;
                Vec3 cur{};
                for (Tick t = 0; t < nTicks; ++t) {
                    while (ei < c4Events.size() && c4Events[ei].t == t) {
                        const C4Event& e = c4Events[ei];
                        if (e.st == C4Status::Planted || e.st == C4Status::Defused ||
                            e.st == C4Status::Exploded) {
                            cur = spec.plantPos;
                        } else if (e.carrier != 0) {
                            const PlayerBuild& pb =
                                builds[static_cast<std::size_t>(e.carrier - 1)];
                            if (t < pb.frames.size()) cur = pb.frames[t].pos;
                        }
                        ++ei;
                    }
                    c4Frames.push_back(TransformSnapshot{cur, ViewAngle{}});
                }
                store.AddEntity(kC4EntityId, EntityKind::C4, 0, meta.maxTick + 1,
                                std::move(c4Frames));
            }
        }

        // ---- 4. 灌入玩家（数据在本地缓冲里齐了再一次性进 store）----
        const Tick end = meta.maxTick + 1;
        for (int64_t i = 0; i < rosterN; ++i) {
            const EntityId id = static_cast<EntityId>(i + 1);
            store.AddPlayer(id, std::move(identities[i]), 0, end,
                            std::move(builds[static_cast<std::size_t>(i)].frames));
        }

        if (onProgress) onProgress(LoadStage::Done, 100);
        return true;
    }

private:
    // ---- 列名常量（CS2 更新导致改名时只需改这里，§风险对策）----
    static constexpr const char* KILLS_COL =
        "CCSPlayerController.CCSPlayerController_ActionTrackingServices.m_iKills";
    static constexpr const char* DEATHS_COL =
        "CCSPlayerController.CCSPlayerController_ActionTrackingServices.m_iDeaths";
    static constexpr const char* ASSISTS_COL =
        "CCSPlayerController.CCSPlayerController_ActionTrackingServices.CSPerRoundStats_t.m_iAssists";
    static constexpr const char* MONEY_COL =
        "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount";
    static constexpr const char* HEALTH_COL = "CCSPlayerPawn.m_iHealth";
    static constexpr const char* TEAM_COL  = "CCSPlayerPawn.m_iTeamNum";
    static constexpr const char* SCORE_COL = "CCSPlayerController.m_iScore";
    static constexpr const char* ARMOR_COL = "CCSPlayerPawn.m_ArmorValue";
    static constexpr const char* DUCK_COL =
        "CCSPlayerPawn.CCSPlayer_MovementServices.m_flDuckAmount";

    /// grenade_type 字符串 → 枚举（maps.rs:1180 的 parser 产出值）。
    static GrenadeKind GrenadeKindOf(const std::string& type) {
        if (type == "flashbang") return GrenadeKind::Flash;
        if (type == "smoke")     return GrenadeKind::Smoke;
        if (type == "molotov")   return GrenadeKind::Molotov;
        if (type == "decoy")     return GrenadeKind::Decoy;
        return GrenadeKind::HE;
    }
};

} // namespace demoviewer
