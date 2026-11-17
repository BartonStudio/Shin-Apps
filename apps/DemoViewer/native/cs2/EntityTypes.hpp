#pragma once

#include <cstdint>
#include <string>

// =============================================================================
// CS2 Demo 播放器 · 实体层基础类型
//
// 与 docs/cs2-demo-player-architecture.md §4.2 对应。
// 这些是「数据」而非「运行时节点」——节点（Entity 等）在对象树上，类型在这里。
// =============================================================================

namespace demoviewer {

/// demo 时钟单位（64 tick/s），用 uint32 足够覆盖数小时。
using Tick = std::uint32_t;

/// 业务内部自增的实体 id，一场 demo 规模远小于 2^32。
using EntityId = std::uint32_t;

/// 武器等外部标识用字符串 id（见架构文档 §4.8 定夺规则）。
using WeaponId = std::string;

/// 武器目录编号：全量快照里存编号不存字符串（省内存 + 快），目录见
/// EntityStore::WeaponCatalog()。0 = 无武器/未知。
using WeaponNum = std::uint16_t;
inline constexpr WeaponNum kNoWeapon = 0;

/// C4 在本系统内的合成实体 id：游戏里 C4 的实体 id 跨回合会重建，
/// 这里用固定 id 聚合整场的 C4（状态机 + 位置）。
inline constexpr EntityId kC4EntityId = 0xFFFFFFF0;

// ---- 枚举（种类少、稳定 → 以 int 传输，见 §4.8）----

enum class EntityKind : std::uint8_t { Player, Weapon, Grenade, C4 };

enum class Team : std::uint8_t { None, CT, T };

enum class GrenadeKind : std::uint8_t { HE, Flash, Smoke, Molotov, Decoy };

enum class C4Status : std::uint8_t { Carried, Dropped, Planted, Defused, Exploded };

// ---- 几何 ----

/// 三维位置，float32（4 字节/分量，见 §4.9 紧凑类型约定）。
struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
};

/// 朝向：欧拉角 pitch/yaw（roll 恒 0 不存，见 §4.7）。
struct ViewAngle {
    float pitch = 0.0f;
    float yaw = 0.0f;
};

/// 实体存活区间 [begin, end)。
struct TickInterval {
    Tick begin = 0;
    Tick end = 0;
};

} // namespace demoviewer
