#pragma once

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Runtime.hpp>

#include "Encode.hpp"
#include "EntityList.hpp"
#include "EntityStore.hpp"
#include "EntityTypes.hpp"
#include "PlayerList.hpp"

// =============================================================================
// 世界状态节点 —— 「存储 + 游标视图」的分水岭（架构文档 §4.1）
//
// 上面是 Playback（游标来源），下面是实体视图。WorldState 不拥有存储（只持只读裸指针，
// 所有权归 CSRoot 的 shared_ptr），实体节点经它拿到 store 引用 + 当前游标。
// 同时作为父容器，挂 Players（PlayerList）与 Entities（EntityList）。
// =============================================================================

namespace demoviewer {

class WorldState {
public:
    static constexpr bool kThreadSafe = true;

    explicit WorldState(const EntityStore* store) : store_(store) {}

    ~WorldState() {
        delete players_;
        delete entities_;
    }

    static void RegisterTypes(iobject::TypeBuilder<WorldState>& /*types*/) {}

    void BindRuntime(iobject::IRuntimeObject* self) {
        self_ = self;
        if (!players_) {
            players_ = iobject::Runtime::make<PlayerList>(store_);
            if (!self_->Connect("Players", players_)) {
                delete players_;
                players_ = nullptr;
            }
        }
        if (!entities_) {
            entities_ = iobject::Runtime::make<EntityList>(store_);
            if (!self_->Connect("Entities", entities_)) {
                delete entities_;
                entities_ = nullptr;
            }
        }
    }

    const EntityStore& store() const { return *store_; }

    /// ---- 数据通道 ----
    /// snapshot：当前游标时刻的整场世界快照（节拍=变脏信号，数据走拉取，
    /// 与 progress 通道契约一致：Publish 只发信号、不捎载荷）。
    /// grenadePaths：全量投掷物静态轨迹（spec 不随 tick 变，前端在投掷物
    /// 实体集合变化时拉取一次，画轨迹线/烟球/火区）。
    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        if (channel == "snapshot") return ReadSnapshot(receiver);
        if (channel == "grenadePaths") return ReadGrenadePaths(receiver);
        return false;
    }

    /// 一次性装配玩家节点（需在玩家数据加载完成后、前端连接前调用）。
    void InitializePlayers() {
        if (players_) players_->As<PlayerList>()->Initialize();
    }

    // ---- 命令入口（前端 Invoke）----
    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
        if (method == "InitializePlayers") {
            // 装载完成后的装配触发点：Loader 节点报 done → 前端 Invoke 本方法。
            InitializePlayers();
            result(iobject::ByteView{});
            return true;
        }
        return false;
    }

    /// 短命实体动态增删同步（游标变化时驱动）。
    void SyncEntities(Tick tick) {
        if (entities_) entities_->As<EntityList>()->SyncToTick(tick);
    }

    iobject::IRuntimeObject* players() const { return players_; }
    iobject::IRuntimeObject* entities() const { return entities_; }

private:
    /// 当前游标时刻的世界快照：在场玩家（位姿/武器/KDA/经济）+ 存活短命实体
    /// + 最近击杀。team 编码：0=None 1=CT 2=T；kind：0=Player 1=Weapon
    /// 2=Grenade 3=C4（EntityKind 原值）。killer/victim 只给 id，
    /// 前端用 snapshot.players 的 id→name 映射还原名字。
    bool ReadSnapshot(iobject::DataReceiver receiver) const {
        const Tick tick = store_->CurrentTick();
        const auto ws = store_->SnapshotAt(tick);

        nlohmann::json players = nlohmann::json::array();
        for (const auto& p : ws.players) {
            players.push_back({
                {"id", p.id},
                {"name", p.identity ? p.identity->name : std::string{}},
                {"team", p.identity ? static_cast<int>(p.identity->team) : 0},
                {"teamSlot", p.identity ? p.identity->teamSlot : std::uint8_t{0}},
                {"pos", ToJson(p.snap->pos)},
                {"view", ToJson(p.snap->view)},
                {"alive", p.snap->alive},
                {"health", p.snap->health},
                {"armor", p.snap->armor},
                {"weapon", p.weapon},
                {"kills", p.snap->kills}, {"deaths", p.snap->deaths},
                {"assists", p.snap->assists}, {"money", p.snap->money},
                {"clipAmmo", p.snap->clipAmmo},
                {"reserveMagazines", p.snap->reserveMagazines},
            });
        }

        nlohmann::json entities = nlohmann::json::array();
        for (const auto& e : ws.entities) {
            nlohmann::json entry = {
                {"id", e.id},
                {"kind", static_cast<int>(e.kind)},
                {"pos", ToJson(e.transform->pos)},
            };
            // 投掷物：子类型（GrenadeKind：0 HE 1 Flash 2 Smoke 3 Molotov 4 Decoy）
            // + 投掷者（前端映射名字/队伍色）。
            if (e.kind == EntityKind::Grenade) {
                if (const GrenadeSpec* gs = store_->GrenadeSpecAt(e.id)) {
                    entry["grenade"] = {
                        {"sub", static_cast<int>(gs->kind)},
                        {"thrower", gs->thrower},
                    };
                }
            }
            // C4：状态机当前态（C4Status：0 Carried 1 Dropped 2 Planted 3 Defused
            // 4 Exploded）；Planted 后前端用 explodeTick 算倒计时。
            else if (e.kind == EntityKind::C4) {
                if (const C4Spec* cs = store_->C4SpecAt(e.id)) {
                    entry["c4"] = {
                        {"status", static_cast<int>(store_->C4StatusAt(e.id, tick))},
                        {"carrier", cs->carrier},
                        {"explodeTick", cs->explodeTick},
                    };
                }
            }
            entities.push_back(std::move(entry));
        }

        nlohmann::json kills = nlohmann::json::array();
        for (const auto& k : ws.recentKills) {
            kills.push_back({
                {"tick", k.tick},
                {"killer", k.killer},
                {"victim", k.victim},
                {"weapon", k.weapon},
                {"headshot", k.headshot},
            });
        }

        // 回合上下文：当前 tick 所在回合（HUD 的 ROUND N 与剩余时间）。
        // 取最后一个 startTick <= tick 的回合；tick 落在回合间隙（加时/中场）时
        // winnerTeam 已定、endTick 已过——剩余时间钳到 0。
        nlohmann::json round = nlohmann::json::value_t::null;
        for (const RoundSpan& r : store_->Rounds()) {
            if (r.startTick > tick) break;
            round = {
                {"index", r.index},
                {"startTick", r.startTick},
                {"endTick", r.endTick},
                {"liveStartTick", r.liveStartTick},
                {"liveEndTick", r.liveEndTick},
                {"winnerTeam", r.winnerTeam},
            };
        }

        // 比分：截至当前 tick 已分出胜负的回合数（HUD 比分条实时跟随）。
        std::uint16_t ctWins = 0, tWins = 0;
        for (const RoundSpan& r : store_->Rounds()) {
            if (r.endTick > tick) break;
            if (r.winnerTeam == 2) ++tWins;
            else if (r.winnerTeam == 3) ++ctWins;
        }

        SendBytes(EncodeMsgPack(nlohmann::json{
            {"tick", tick},
            {"maxTick", store_->MaxTick()},
            {"round", std::move(round)},
            {"score", {{"t", tWins}, {"ct", ctWins}}},
            {"players", std::move(players)},
            {"entities", std::move(entities)},
            {"recentKills", std::move(kills)},
        }), receiver);
        return true;
    }

    const EntityStore* store_ = nullptr;
    iobject::IRuntimeObject* self_ = nullptr;
    iobject::IRuntimeObject* players_ = nullptr;   // PlayerList 节点
    iobject::IRuntimeObject* entities_ = nullptr;  // EntityList 节点

    /// 全量投掷物静态轨迹（GrenadeSpec 不随 tick 变）。输出：
    /// { "<entityId>": { sub, thrower, trajectory:[[x,y,z]...], radius, fireArea:[[..]..] } }
    /// trajectoryPoints 与 trajectoryTicks 一一对应，前端画线只需要 points。
    bool ReadGrenadePaths(iobject::DataReceiver receiver) const {
        nlohmann::json paths = nlohmann::json::object();
        const auto& all = store_->Entities();
        for (auto it = all.begin(); it != all.end(); ++it) {
            const EntityId id = it->first;
            const EntityRecord& rec = it->second;
            if (rec.kind != EntityKind::Grenade) continue;
            const GrenadeSpec* gs = store_->GrenadeSpecAt(id);
            if (!gs) continue;
            nlohmann::json traj = nlohmann::json::array();
            for (const Vec3& p : gs->trajectoryPoints) traj.push_back(ToJson(p));
            nlohmann::json fire = nlohmann::json::array();
            for (const Vec3& p : gs->fireArea) fire.push_back(ToJson(p));
            paths[std::to_string(id)] = {
                {"sub", static_cast<int>(gs->kind)},
                {"thrower", gs->thrower},
                {"trajectory", std::move(traj)},
                {"radius", gs->effectRadius},
                {"fireArea", std::move(fire)},
            };
        }
        SendBytes(EncodeMsgPack(nlohmann::json{{"paths", std::move(paths)}}), receiver);
        return true;
    }
};

} // namespace demoviewer
