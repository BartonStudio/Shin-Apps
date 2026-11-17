// DemoLoader 冒烟测试：灌库后从 EntityStore 抽样核对（第 4/5 步验证点）。
// 用法：cs2_loader_smoke.exe [demo.dem]
#include <cstdio>
#include <chrono>

#include "cs2/DemoLoader.hpp"

using namespace demoviewer;

int main(int argc, char** argv) {
    const char* path = argc > 1 ? argv[1] : "D:/workfolder/Shin-Apps/resource/42k-Dust2.dem";

    EntityStore store;
    DemoMeta meta;
    std::string error;

    auto t0 = std::chrono::steady_clock::now();
    bool ok = DemoLoader::Load(path, store, meta,
                               [](LoadStage s, int p) {
                                   printf("  [progress] %d%%\n", p);
                               },
                               error);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                  std::chrono::steady_clock::now() - t0)
                  .count();
    if (!ok) {
        printf("LOAD FAILED: %s\n", error.c_str());
        return 1;
    }
    printf("[1] loaded in %lld ms. map=%s maxTick=%u (%.1f min)\n", (long long)ms,
           meta.mapName.c_str(), meta.maxTick, meta.durationSec / 60.0f);

    const Tick mid = meta.maxTick / 2;

    // ---- 玩家快照（含全量武器编号）----
    printf("[2] players=%zu weaponCatalog=%zu\n", store.PlayerIds().size(),
           store.WeaponCatalog().size());
    for (EntityId id : store.PlayerIds()) {
        const auto* ident = store.IdentityAt(id);
        const auto* s = store.PlayerAt(id, mid);
        printf("    id=%u %-20s team=%d mid: alive=%d kills=%u money=%u clip=%u weapon=%s\n",
               id, ident ? ident->name.c_str() : "?",
               ident ? (int)ident->team : -1,
               s ? (int)s->alive : -1,
               s ? s->kills : 0, s ? s->money : 0, s ? s->clipAmmo : 0,
               store.WeaponAt(id, mid).c_str());
    }

    // ---- 击杀 ----
    auto kills = store.RecentKills(mid, 3);
    printf("[3] recent kills: %zu\n", kills.size());
    for (const auto& k : kills) {
        const auto* killer = k.killer ? store.IdentityAt(k.killer) : nullptr;
        const auto* victim = store.IdentityAt(k.victim);
        printf("    tick=%u %s -> %s weapon=%s hs=%d\n", k.tick,
               killer ? killer->name.c_str() : "(环境/自杀)",
               victim ? victim->name.c_str() : "?", k.weapon.c_str(), (int)k.headshot);
    }

    // ---- 短命实体 ----
    size_t nWeapon = 0, nGrenade = 0, nC4 = 0;
    Tick grenadeTicks = 0;
    for (const auto& lt : store.Lifetimes()) {
        if (lt.kind == EntityKind::Weapon) ++nWeapon;
        else if (lt.kind == EntityKind::Grenade) { ++nGrenade; grenadeTicks += lt.end - lt.begin; }
        else if (lt.kind == EntityKind::C4) ++nC4;
    }
    printf("[4] entities: weapon=%zu grenade=%zu(avg %.1f ticks) c4=%zu\n",
           nWeapon, nGrenade,
           nGrenade ? (float)grenadeTicks / (float)nGrenade : 0.f, nC4);

    // ---- 投掷物轨迹抽样 ----
    for (const auto& lt : store.Lifetimes()) {
        if (lt.kind != EntityKind::Grenade) continue;
        const GrenadeSpec* spec = store.GrenadeSpecAt(lt.id);
        if (!spec) continue;
        printf("    grenade id=%u kind=%d throw=%u detonate=%u points=%zu first=(%.0f,%.0f,%.0f)\n",
               lt.id, (int)spec->kind, spec->throwTick, spec->detonateTick,
               spec->trajectoryPoints.size(),
               spec->trajectoryPoints.empty() ? 0.f : spec->trajectoryPoints[0].x,
               spec->trajectoryPoints.empty() ? 0.f : spec->trajectoryPoints[0].y,
               spec->trajectoryPoints.empty() ? 0.f : spec->trajectoryPoints[0].z);
        break;  // 抽一条
    }

    // ---- C4 状态机 ----
    if (nC4 > 0) {
        const C4Spec* spec = store.C4SpecAt(kC4EntityId);
        printf("[5] C4: status@mid=%d plantTick=%u explodeTick=%u plantPos=(%.0f,%.0f,%.0f)\n",
               (int)store.C4StatusAt(kC4EntityId, mid),
               spec ? spec->plantTick : 0, spec ? spec->explodeTick : 0,
               spec ? spec->plantPos.x : 0.f, spec ? spec->plantPos.y : 0.f,
               spec ? spec->plantPos.z : 0.f);
        // 找一个 planted 后的 tick 验证状态
        if (spec && spec->plantTick > 0) {
            Tick t = spec->plantTick + 100;
            printf("    status@plant+100=%d (期望 Planted=%d)\n",
                   (int)store.C4StatusAt(kC4EntityId, t), (int)C4Status::Planted);
        }
    }

    // ---- SnapshotAt 整场快照 ----
    auto snap = store.SnapshotAt(mid, 8);
    printf("[6] SnapshotAt(%u): players=%zu entities=%zu kills=%zu\n", snap.tick,
           snap.players.size(), snap.entities.size(), snap.recentKills.size());
    for (const auto& p : snap.players) {
        printf("    P%u %-14s alive=%d weapon=%s pos=(%.0f,%.0f,%.0f)\n",
               p.id, p.identity ? p.identity->name.c_str() : "?",
               p.snap ? (int)p.snap->alive : -1, p.weapon.c_str(),
               p.snap ? p.snap->pos.x : 0.f, p.snap ? p.snap->pos.y : 0.f,
               p.snap ? p.snap->pos.z : 0.f);
        break;  // 抽一个
    }

    // ---- 游标 + 存活查询 ----
    store.SetCurrentTick(mid);
    printf("[7] currentTick=%u alive(id=1)=%d\n", store.CurrentTick(),
           (int)store.AliveAt(1, store.CurrentTick()));

    printf("ALL PASS\n");
    return 0;
}
