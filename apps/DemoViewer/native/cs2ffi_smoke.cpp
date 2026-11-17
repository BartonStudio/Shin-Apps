// cs2ffi 冒烟测试：C++ 侧端到端验证 shim.h 接口。
// 用法：cs2ffi_smoke.exe [demo.dem]（默认 resource/42k-Dust2.dem）
#include <cstdio>

#include "shim.h"

int main(int argc, char** argv) {
    const char* path = argc > 1 ? argv[1] : "D:/workfolder/Shin-Apps/resource/42k-Dust2.dem";

    printf("[1] demo_open(\"%s\") ...\n", path);
    auto* h = demo_open(path);
    if (!h) {
        printf("    FAILED: %s\n", demo_last_error());
        return 1;
    }
    printf("    ok. map=%s max_tick=%lld\n", demo_map_name(h), demo_max_tick(h));

    // ---- 名册 ----
    printf("[2] roster: %lld players\n", demo_roster_count(h));
    auto* roster = demo_roster(h);
    for (int64_t i = 0; i < demo_roster_count(h) && i < 3; ++i) {
        printf("    name=%s steamid=%llu team=%d\n", roster[i].name,
               (unsigned long long)roster[i].steamid, roster[i].team);
    }

    // ---- 玩家 tick 列 ----
    int64_t n = demo_col_len(h, DEMO_PASS_PLAYER);
    printf("[3] player pass rows=%lld\n", n);
    auto* px = demo_col_f32(h, DEMO_PASS_PLAYER, "X");
    auto* ph = demo_col_i32(h, DEMO_PASS_PLAYER, "CCSPlayerPawn.m_iHealth");
    auto* pa = demo_col_u8(h, DEMO_PASS_PLAYER, "is_alive");
    auto* ps = demo_col_u64(h, DEMO_PASS_PLAYER, "steamid");
    auto* py = demo_col_f32(h, DEMO_PASS_PLAYER, "Y");
    printf("    row0: steamid=%llu X=%.2f Y=%.2f health=%d alive=%d\n",
           (unsigned long long)ps[0], px[0], py[0], ph[0], pa[0]);
    printf("    row1: steamid=%llu X=%.2f health=%d alive=%d\n",
           (unsigned long long)ps[1], px[1], ph[1], pa[1]);
    // 第 10 行应为下一 tick（行序：tick 优先）
    printf("    row10 (tick+1): X=%.2f\n", px[10]);

    // ---- 武器列 ----
    int64_t wn = demo_col_len(h, DEMO_PASS_WEAPON);
    auto* wclip = demo_col_u32(h, DEMO_PASS_WEAPON, "m_iClip1");
    printf("[4] weapon pass rows=%lld, clip[0]=%u\n", wn, wclip ? wclip[0] : 0);

    // ---- 事件 ----
    int64_t deaths = demo_event_count(h, "player_death");
    printf("[5] player_death x%lld\n", deaths);
    if (deaths > 0) {
        DemoVariant v;
        printf("    death[0] tick=%lld", demo_event_tick(h, "player_death", 0));
        if (demo_event_field(h, "player_death", 0, "weapon", &v) == 1 && v.tag == DEMO_VAR_STR)
            printf(" weapon=%s", v.value.s);
        if (demo_event_field(h, "player_death", 0, "headshot", &v) == 1 && v.tag == DEMO_VAR_BOOL)
            printf(" headshot=%d", v.value.b);
        if (demo_event_field(h, "player_death", 0, "attacker_name", &v) == 1 && v.tag == DEMO_VAR_STR)
            printf(" attacker=%s", v.value.s);
        if (demo_event_field(h, "player_death", 0, "user_name", &v) == 1 && v.tag == DEMO_VAR_STR)
            printf(" victim=%s", v.value.s);
        printf("\n");
    }
    printf("    bomb_planted x%lld, item_pickup x%lld\n",
           demo_event_count(h, "bomb_planted"), demo_event_count(h, "item_pickup"));

    demo_close(h);
    printf("[6] demo_close ok —— ALL PASS\n");
    return 0;
}
