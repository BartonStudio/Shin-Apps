// demo_data.h 的编译与行为冒烟测试。
//
// 期望输出：
//   validate: OK
//   auditRanges: OK
//   故意造错后: validate issues=1, auditRanges issues=1
//   frames.posX: 长度 5 < N*P 6
//
// 编译运行（MSVC）：
//   cl /nologo /std:c++17 /utf-8 /EHsc /W4 /I.. smoke_test.cpp /Fe:smoke.exe && smoke.exe
//
// 注意最后一行断言：故意把 posX 少一个元素、把 team 改成 7 之后，
// 两个检查都必须报错 —— 否则说明校验逻辑失效了。

#include "../cpp/demo_data.h"
#include <cstdio>

int main() {
    csdemo::DemoData d;
    d.meta.mapName = "de_dust2";
    d.meta.numPlayers = 2;
    d.meta.numFrames = 3;
    d.meta.startTick = 0;
    d.meta.endTick = 2;
    d.frameCapacity = 3;
    d.panelCapacity = 1;
    d.panelFrames.numFrames = 1;
    d.players.resize(2);
    d.players[0].slot = 0; d.players[0].steamId = "76561197962984717"; d.players[0].name = "a";
    d.players[1].slot = 1; d.players[1].steamId = "76561197962984718"; d.players[1].name = "b";
    const size_t NP = 6;
    d.frames.frameTick = {0, 1, 2};
    d.frames.posX.assign(NP, 0.f); d.frames.posY.assign(NP, 0.f); d.frames.posZ.assign(NP, 0.f);
    d.frames.yaw.assign(NP, 0.f); d.frames.pitch.assign(NP, 0.f);
    d.frames.health.assign(NP, 100); d.frames.alive.assign(NP, 1); d.frames.team.assign(NP, 2);
    d.frames.score.assign(NP, 0); d.frames.duck.assign(NP, 0.f);
    d.frames.flash.assign(NP, 0.f); d.frames.flashAlpha.assign(NP, 0.f); d.frames.zoom.assign(NP, 0);
    d.frames.speed.assign(NP, 100.f); d.frames.smoothSpeed.assign(NP, 90.f);
    d.panelFrames.frameTick = {0};
    d.panelFrames.health.assign(2, 100); d.panelFrames.alive.assign(2, 1); d.panelFrames.team.assign(2, 2);
    d.panelFrames.armor.assign(2, 0); d.panelFrames.flags.assign(2, 0); d.panelFrames.activeWeapon.assign(2, 0);
    d.panelFrames.utilCounts.assign(2, 0);
    d.panelFrames.money.assign(2, 800); d.panelFrames.clipAmmo.assign(2, 30); d.panelFrames.reserveAmmo.assign(2, 90);
    d.weaponNames = {"", "AK-47"};
    d.rounds.push_back({0, 0, 2, 0});
    d.tracers.count = 0; d.damage.count = 0;
    d.smokeVoxels.count = 0;
    d.smokeVoxels.bufferOffsets = {0};
    d.smokeVoxels.frameOffsets  = {0};

    auto rep = csdemo::validate(d);
    printf("validate: %s\n", rep.ok() ? "OK" : "FAIL");
    if (!rep.ok()) printf("%s", rep.toString().c_str());
    auto rep2 = csdemo::auditRanges(d);
    printf("auditRanges: %s\n", rep2.ok() ? "OK" : "FAIL");
    if (!rep2.ok()) printf("%s", rep2.toString().c_str());

    // 故意造错，验证 report 能报出来
    d.frames.posX.pop_back();
    d.frames.team[0] = 7;
    auto rep3 = csdemo::validate(d);
    auto rep4 = csdemo::auditRanges(d);
    printf("\nafter deliberate corruption: validate issues=%zu, auditRanges issues=%zu\n", rep3.issues.size(), rep4.issues.size());
    printf("%s", rep3.toString().c_str());
    return (rep.ok() && rep2.ok() && !rep3.ok() && !rep4.ok()) ? 0 : 1;
}
