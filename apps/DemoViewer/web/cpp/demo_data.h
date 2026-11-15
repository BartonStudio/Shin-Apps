// ============================================================================
// demo_data.h —— CS2 demo 播放器数据契约（C++ 侧）
// ============================================================================
//
// 这个头文件定义「解析器要产出什么」。它逐字段对应 JS 侧的 `data` 对象，
// 也就是 src/deobfuscated/shared-buffer.js 的 buildDataFromSharedBuffer() 读出来的形状。
//
// 字段级说明见：
//   docs/07-data-contract.md      —— 权威契约（值域、陷阱、分窗要求）
//   docs/08-cpp-integration.md    —— 共享内存布局与发布协议
//   src/deobfuscated/shared-buffer.js —— JS 侧参考实现（布局的唯一定义）
//
// ── 索引公式（唯一铁律）─────────────────────────────────────────────────────
//
//     值 = 数组[帧序号 * numPlayers + 玩家序号]
//
// 所有标记为「N×P」的列都是这个布局（SoA 行主序展平）。
// panelFrames 同理，只是它的帧序号是**自己那套** tick 网格（实测每 8 tick 一帧）。
//
// ── 必需 vs 可选 ────────────────────────────────────────────────────────────
//
// 除标注 [可选] 的字段外，其余全部必需。缺任何一个：
//   · validate() 会报错
//   · JS 侧会抛 TypeError（渲染层刻意不做兜底 —— 规范违规应该立刻暴露）
//
// ── 与共享内存块的对应 ──────────────────────────────────────────────────────
//
// 每个字段后面用 → 标出它在共享内存里的块名（见 shared-buffer.js 的 FRAME_COLS 等）。
// 没有 → 标记的，走元数据区 JSON（而不是列块区）。
//
// ── 编译要求 ────────────────────────────────────────────────────────────────
//
//   MSVC:   cl /std:c++17 /utf-8 /EHsc /W4 ...
//   GCC:    g++ -std=c++17 -finput-charset=UTF-8 ...
//   Clang:  clang++ -std=c++17 ...
//
//   ⚠️ **MSVC 必须加 /utf-8**（或把源文件存成带 BOM 的 UTF-8）。
//      否则它按本地代码页（中文 Windows 是 GBK）解释本文件里的中文注释，
//      会把 UTF-8 字节序列误解成字符串终止符，报出「常量中有换行符」这种莫名错误。
//      这不是语法问题，是编码问题 —— 实测踩过一次。
//
//   只依赖 C++17 标准库，无第三方依赖。
//
// ============================================================================
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace csdemo {

// ════════════════════════════════════════════════════════════════════════════
// 基础类型与常量
// ════════════════════════════════════════════════════════════════════════════

using i32 = std::int32_t;
using f32 = float;
using u8 = std::uint8_t;
using u16 = std::uint16_t;

/// CS2 固定 64 tick。契约要求恒为 64。
inline constexpr std::uint32_t kTickRate = 64;

/// 玩家配色名的取值集合（字符串，不是数值索引）
inline constexpr std::string_view kPlayerColors[] = {"blue", "green", "yellow", "orange", "purple"};

// ════════════════════════════════════════════════════════════════════════════
// 枚举（闭集 —— 用枚举而不是字符串，避免拼错）
// ════════════════════════════════════════════════════════════════════════════

/// frames.team / panelFrames.team 的取值。
/// 实测真实 demo：0 占 20%，且 team=0 时 alive 恒为 0 —— 即「该回合未参与的玩家」。
enum class Team : u8 { Unassigned = 0, T = 2, CT = 3 };

/// 投掷物种类。由武器名推导（顺序敏感：先 smoke/flash，再 molotov(含 incendiary/inferno)，最后 decoy/he）
enum class GrenadeKind : u8 { Smoke, Flash, Molotov, Decoy, HE };

/// data.events[].type
enum class EventType : u8 { Kill, RoundStart, RoundEnd, BombPlanted, BombDefused, BombExploded };

/// data.bomb.segments[].kind —— 炸弹状态机产出的三种连续状态段
enum class BombSegmentKind : u8 { Carried, Dropped, Planted };

/// data.bomb.segments[].site
enum class BombSite : u8 { None, A, B };

/// data.timeouts.intervals[].side
enum class TimeoutSide : u8 { None, T, CT };

// ── 枚举 → JSON 字符串（写元数据区时用）──
constexpr std::string_view toJson(GrenadeKind v) {
    switch (v) {
        case GrenadeKind::Smoke:   return "smoke";
        case GrenadeKind::Flash:   return "flash";
        case GrenadeKind::Molotov: return "molotov";
        case GrenadeKind::Decoy:   return "decoy";
        case GrenadeKind::HE:      return "he";
    }
    return "";
}
constexpr std::string_view toJson(EventType v) {
    switch (v) {
        case EventType::Kill:         return "kill";
        case EventType::RoundStart:   return "round_start";
        case EventType::RoundEnd:     return "round_end";
        case EventType::BombPlanted:  return "bomb_planted";
        case EventType::BombDefused:  return "bomb_defused";
        case EventType::BombExploded: return "bomb_exploded";
    }
    return "";
}
constexpr std::string_view toJson(BombSegmentKind v) {
    switch (v) {
        case BombSegmentKind::Carried: return "carried";
        case BombSegmentKind::Dropped: return "dropped";
        case BombSegmentKind::Planted: return "planted";
    }
    return "";
}
constexpr std::string_view toJson(BombSite v) {
    switch (v) {
        case BombSite::None: return "";
        case BombSite::A:    return "A";
        case BombSite::B:    return "B";
    }
    return "";
}
constexpr std::string_view toJson(TimeoutSide v) {
    switch (v) {
        case TimeoutSide::None: return "";
        case TimeoutSide::T:    return "t";
        case TimeoutSide::CT:   return "ct";
    }
    return "";
}

// ════════════════════════════════════════════════════════════════════════════
// meta
// ════════════════════════════════════════════════════════════════════════════
struct Meta {
    /// 地图名，决定加载哪张地图（如 "de_dust2"）
    std::string mapName;
    /// 恒为 kTickRate(64)
    std::uint32_t tickRate = kTickRate;
    /// 采样率（16/32/64）。仅作记录，消费方不依赖它做判断。
    std::uint32_t sampleRate = 64;
    /// = players.size()
    std::uint32_t numPlayers = 0;
    /// ⚠️ **可见**帧数（已发布给前端的），不是容量。
    ///    布局按容量算，消息里报可见数。首次全量发布时两者相等。
    std::uint32_t numFrames = 0;
    /// ★ tick 换算基准：JS 用 startTick + 秒 * tickRate 算绝对 tick。
    ///   **必须恒等于 manifest.startTick**，分窗时绝不能改成窗口起点。
    i32 startTick = 0;
    /// 可见范围内最后一帧的 tick
    i32 endTick = 0;
    /// 已可播时长（秒）
    double durationSeconds = 0.0;
};

// ════════════════════════════════════════════════════════════════════════════
// players（长度 P，走元数据区 JSON）
// ════════════════════════════════════════════════════════════════════════════
struct Player {
    std::uint32_t slot = 0;
    /// ⚠️ **必须是字符串**（SteamID64 超过 2^53，用整数会丢精度）
    std::string steamId;
    std::string name;                                   // 注意真实数据里前面常带一个空格
    std::optional<std::string> clanName;                // 可选：真实 demo 里 10 人中有 2 人没有
    std::optional<std::string> color;                   // blue / green / yellow / orange / purple
    std::optional<std::string> crosshairCode;           // 只收 "CSGO" 开头的分享码

    // 注意：**没有 team 字段**。队伍只在 frames.team / panelFrames.team 里。
};

// ════════════════════════════════════════════════════════════════════════════
// frames —— 逐帧主数据（SoA）
// ════════════════════════════════════════════════════════════════════════════
//
// 长度约定：frameTick 是 N；其余全部是 N×P。
// 容量 vs 可见：vector 可以按容量分配（增量写入），但 meta.numFrames 报的是可见数。
struct Frames {
    // ── N ──
    std::vector<i32> frameTick;                         // → frameTick   ★ 严格升序的绝对 tick

    // ── N×P：位置与朝向 ──
    std::vector<f32> posX, posY, posZ;                  // → posX/posY/posZ
    std::vector<f32> yaw;                               // → yaw    **度**，归一化到 (-180, 180]
    std::vector<f32> pitch;                             // → pitch  **度**，约 [-64, 89]

    // ── N×P：状态 ──
    std::vector<u8> health;                             // → health   0..100
    std::vector<u8> alive;                              // → alive    0 / 1
    std::vector<u8> team;                               // → team     见 enum Team（0/2/3）
    std::vector<u8> score;                              // → score
    std::vector<f32> duck;                              // → duck     0..1 下蹲程度
    std::vector<f32> flash;                             // → flash    闪光剩余时间
    std::vector<f32> flashAlpha;                        // → flashAlpha  白屏强度
    std::vector<u8> zoom;                               // → zoom     0 / 1 / 2

    // ── N×P：可选列（对应共享内存的 FLAG_*）──
    std::vector<f32> accuracyPenalty;                   // → accuracyPenalty  [可选] -1 = 无数据
    std::vector<u8> reloading;                          // → reloading        [可选] 0/1
    std::vector<u8> playerFlags;                        // → playerFlags      [可选] bit2 = 带包

    // ── N×P：速度两列（**必需**，2026-11-09 起）──
    //
    // 语义完全不同，不要混用（详见 docs/07 §3.5）：
    //   speed       瞬时水平速度 = 相邻采样帧位移 / 时间差。
    //               守卫：间隔>0 且 <= 2/sampleRate、区间内无回合起点、两端 alive、同 team。
    //               消费者：脚步声节拍、开镜速度读数。
    //   smoothSpeed 过去 1 秒、时间常数 0.1s 的指数加权平均速度。
    //               消费者：走/跑/蹲骨骼动画混合、姿态根偏移。
    //               用错会让角色滑步。
    // 参考实现：src/deobfuscated/speed-columns.js
    std::vector<f32> speed;                             // → speed
    std::vector<f32> smoothSpeed;                       // → smoothSpeed

    std::size_t capacityFrames() const { return frameTick.size(); }
};

// ════════════════════════════════════════════════════════════════════════════
// panelFrames —— 侧边玩家面板（粒度比 frames 粗）
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ 这是**另一套 tick 网格**，与 frames 独立。实测真实 demo：frames 间隔 1 tick
//    （114 326 帧），panelFrames 间隔 8 tick（14 291 帧）。
//    两套 tick 的集合可以不同，各自的消费者也互不依赖。
//
// ⚠️ numFrames 是**标量字段**（frames 没有对应字段，用的是 frameTick.size()）。
//    这个不对称照抄即可，别"统一"。
struct PanelFrames {
    /// = frameTick.size()（可见面板帧数 M）
    std::uint32_t numFrames = 0;

    // ── M ──
    std::vector<i32> frameTick;                         // → panelFrameTick

    // ── M×P：8 位 ──
    std::vector<u8> health;                             // → panelHealth
    std::vector<u8> alive;                              // → panelAlive
    std::vector<u8> team;                               // → panelTeam
    std::vector<u8> armor;                              // → panelArmor
    std::vector<u8> flags;                              // → panelFlags   bit0 = 有头盔, bit1 = 有拆弹器
    std::vector<u8> activeWeapon;                       // → panelActiveWeapon  索引到 weaponNames[]
    std::vector<u8> utilCounts;                         // → panelUtilCounts

    // ── M×P：16 位 ──
    std::vector<u16> money;                             // → panelMoney
    std::vector<u16> clipAmmo;                          // → panelClipAmmo
    std::vector<u16> reserveAmmo;                       // → panelReserveAmmo

    // 注意：**没有 equipValue**。它是 CS2 netprop `current_equip_value`（装备美元总价），
    //       原工程分配/解码/传输/序列化四步俱全但全库零读取，已从契约移除。
};

// ════════════════════════════════════════════════════════════════════════════
// events（元数据区 JSON）
// ════════════════════════════════════════════════════════════════════════════
struct GameEvent {
    i32 tick = 0;
    double time = 0.0;                                  // = (tick - startTick) / tickRate
    EventType type = EventType::RoundStart;

    // ── type == Kill 时才有 ──
    std::optional<std::uint32_t> victimSlot;
    std::optional<std::uint32_t> attackerSlot;
    std::optional<std::uint32_t> assisterSlot;          // 助攻；可能没有
    std::optional<std::string> victimName;
    std::optional<std::string> attackerName;
    std::optional<u8> victimTeam;                       // Team
    std::optional<u8> attackerTeam;
    std::optional<std::string> weapon;
    bool headshot = false;
    bool noscope = false;
    bool thrusmoke = false;
    bool attackerblind = false;
    bool wallbang = false;                              // = penetrated > 0

    // ── type == RoundEnd 时才有 ──
    std::optional<u8> roundWinner;                      // 2 = T, 3 = CT, 0 = 无
    std::optional<std::uint32_t> roundReason;           // CS2 RoundEndReason 枚举值
};

// ════════════════════════════════════════════════════════════════════════════
// rounds
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ 建议**首轮就把全部回合的 startTick/endTick 填满**（liveStartTick 可以随后更新）。
//    因为 JS 的 loadedDurationSeconds() 用 manifest.rounds[loadedRounds-1].endTick 算时长，
//    填满了就只要 loadedRounds 递增，时长自动变长，JS 侧一行都不用改。
struct Round {
    std::uint32_t index = 0;                            // 回合序号，0 起
    i32 startTick = 0;
    i32 endTick = 0;
    i32 liveStartTick = 0;                              // 解除冻结的 tick（如回合 0：0..3982，live 1181）
};

// ════════════════════════════════════════════════════════════════════════════
// grenades
// ════════════════════════════════════════════════════════════════════════════
struct GrenadeTrajectory {
    GrenadeKind kind = GrenadeKind::Smoke;
    std::int32_t throwerSlot = -1;                      // -1 = 找不到投掷者
    i32 startTick = 0;
    i32 endTick = 0;
    std::optional<i32> detonationTick;                  // 引爆 tick；找不到时无值

    std::vector<f32> posXYZ;                            // 扁平 xyz，长度 = 采样点数 × 3
    std::vector<i32> ticks;                             // 长度 = 采样点数
    std::optional<std::vector<f32>> angles;             // 扁平 xyz 欧拉角，长度 = 采样点数 × 3（可能没有）
    bool incendiary = false;                            // 仅 molotov 有意义：是否燃烧弹
};

struct GrenadeEffect {
    GrenadeKind kind = GrenadeKind::Smoke;
    f32 x = 0, y = 0, z = 0;
    i32 startTick = 0;
    i32 endTick = 0;
};

struct InfernoFrame {
    i32 tick = 0;
    std::vector<f32> positions;                         // 扁平 xyz
    std::vector<u8> burning;                            // 逐点燃烧标记
    std::vector<f32> origin;                            // 扁平 xyz
    std::optional<std::vector<f32>> parentPositions;
    std::optional<std::vector<f32>> normals;
};

struct Inferno {
    std::uint32_t entityId = 0;
    i32 startTick = 0;
    i32 endTick = 0;
    std::optional<i32> effectTick;
    std::optional<std::uint32_t> infernoType;           // 0 / 1
    std::optional<f32> lifetime;
    std::vector<InfernoFrame> frames;
};

struct Grenades {
    std::vector<GrenadeTrajectory> trajectories;
    std::vector<GrenadeEffect> effects;
    std::vector<Inferno> infernos;
};

// ════════════════════════════════════════════════════════════════════════════
// 区间数据（列块区，SoA）
// ════════════════════════════════════════════════════════════════════════════

/// 弹道 / 曳光。count 是条目数，origin/end 是 count×3。
struct Tracers {
    std::uint32_t count = 0;
    std::vector<f32> origin;                            // → tracers.origin  count×3
    std::vector<f32> end;                               // → tracers.end     count×3
    std::vector<i32> tick;                              // → tracers.tick    count
    std::vector<u8> team;                               // → tracers.team    count
    std::vector<u8> hitKind;                            // → tracers.hitKind count（1 = 命中，0 = 沿准星方向的固定长度）
};

/// 伤害飘字
struct Damage {
    std::uint32_t count = 0;
    std::vector<u8> attackerSlot;                       // → damage.attackerSlot  count
    std::vector<u8> victimSlot;                         // → damage.victimSlot    count
    std::vector<i32> tick;                              // → damage.tick          count
    std::vector<u8> dmg;                                // → damage.dmg           count
};

/// 开火事件（用于声音与曳光配对）
struct WeaponFires {
    std::vector<i32> ticks;                             // → weaponFires.ticks
    std::vector<u8> slots;                              // → weaponFires.slots
};

/// 烟雾体素。**打包结构**：每团烟雾的数据是 buffers 的一个切片，
/// 切片边界由 bufferOffsets（前缀和，长度 count+1）给出；
/// frameTicks 同理用 frameOffsets 切。
///
/// ⚠️ 追加一团新烟雾时，bufferOffsets/frameOffsets 的**最后一项**要改 ——
///    这就是为什么这两张表放在「双份元数据区」里而不是纯 append-only 区。
struct SmokeVoxels {
    std::uint32_t count = 0;
    std::vector<i32> tickBegin;                         // → smokeVoxels.tickBegin        count
    std::vector<f32> detonation;                        // → smokeVoxels.detonation       count×3
    std::vector<f32> color;                             // → smokeVoxels.color            count×3
    std::vector<i32> bufferOffsets;                     // → smokeVoxels.bufferOffsets    count+1
    std::vector<u8> buffers;                            // → smokeVoxels.buffers          总字节数
    std::vector<i32> frameOffsets;                      // → smokeVoxels.frameOffsets     count+1
    std::vector<i32> frameTicks;                        // → smokeVoxels.frameTicks       总帧数
};

// ════════════════════════════════════════════════════════════════════════════
// 其余（元数据区 JSON）
// ════════════════════════════════════════════════════════════════════════════

struct BombSegment {
    BombSegmentKind kind = BombSegmentKind::Carried;
    i32 startTick = 0;
    i32 endTick = 0;
    f32 x = 0, y = 0, z = 0;
    std::int32_t carrierSlot = -1;                      // 只有 carried 段有意义，其余 -1
    BombSite site = BombSite::None;
};

struct BombDefuse {
    i32 startTick = 0;
    i32 endTick = 0;
    bool hasKit = false;                                // 有拆弹器 → 5 秒，否则 10 秒
    std::int32_t defuserSlot = -1;
};

struct Bomb {
    std::vector<BombSegment> segments;
    std::vector<BombDefuse> defuses;
};

/// 战术暂停 / 技术暂停的时间区间
struct TimeoutInterval {
    i32 startTick = 0;
    i32 endTick = 0;
    TimeoutSide side = TimeoutSide::None;               // 战术暂停才有 side
    bool technical = false;                             // 技术暂停（game_time 冻结但 tick 在走）
};

struct TimeoutCounter {
    i32 tick = 0;
    std::uint32_t tRemaining = 0;
    std::uint32_t ctRemaining = 0;
};

struct Timeouts {
    std::uint32_t maxTacticalTimeouts = 0;
    std::vector<TimeoutInterval> intervals;
    std::vector<TimeoutCounter> counters;
};

/// 击杀位置标记（屏幕上「X 在这里死的」）
struct DeathMarker {
    f32 x = 0, y = 0, z = 0;
    i32 startTick = 0;
    i32 endTick = 0;                                    // = 下一个回合的 startTick
    std::uint32_t victimSlot = 0;
    u8 team = 0;                                        // Team
    std::string name;
};

/// 掉落武器轨迹
struct DroppedWeapon {
    std::uint32_t entityId = 0;
    std::string weapon;                                 // 显示名，如 "Nomad Knife"
    std::uint32_t itemDef = 0;
    i32 startTick = 0;
    i32 endTick = 0;
    std::vector<i32> ticks;
    std::vector<f32> positions;                         // 扁平 xyz
    std::vector<f32> angles;                            // 扁平 xyz 欧拉角
};

/// 地图上的可交互/可破坏实体（门、闸门、玻璃…）
struct MapEntity {
    std::string className;                              // 如 "CFuncBrush"
    std::vector<f32> origin;                            // 3 个元素
    i32 startTick = 0;
    i32 endTick = 0;
    std::vector<i32> ticks;
    std::vector<f32> angles;                            // 扁平 xyz 欧拉角（长度 = ticks × 3）
    std::vector<u8> hidden;                             // 长度 = ticks
};

/// 死亡布娃娃的初始冲量（驱动倒地物理）
struct DeathRagdoll {
    i32 tick = 0;
    std::uint32_t slot = 0;
    std::vector<f32> force;                             // 3 个元素
    std::uint32_t bone = 0;
    bool headshot = false;
    std::vector<f32> eyeAngles;                         // 2 个元素：yaw, pitch（度）
};

// ════════════════════════════════════════════════════════════════════════════
// DemoData —— 顶层契约
// ════════════════════════════════════════════════════════════════════════════
struct DemoData {
    // ── 布局用容量（与 meta.numFrames 的「可见数」区分）──
    //
    // 一次性全量发布：capacity 与 meta.numFrames 相等。
    // 增量发布：Frames 的 vector 按 capacity 分配，逐回合填充，
    //           消息里报的 visibleFrames 递增，meta.numFrames = visibleFrames。
    std::uint32_t frameCapacity = 0;
    std::uint32_t panelCapacity = 0;

    Meta meta;
    std::vector<Player> players;

    Frames frames;
    PanelFrames panelFrames;

    std::vector<GameEvent> events;
    std::vector<Round> rounds;
    Grenades grenades;

    Tracers tracers;
    Damage damage;
    WeaponFires weaponFires;
    SmokeVoxels smokeVoxels;

    Bomb bomb;
    Timeouts timeouts;
    std::vector<DeathMarker> deathMarkers;
    std::vector<DroppedWeapon> droppedWeapons;
    std::vector<MapEntity> mapEntities;
    std::vector<DeathRagdoll> deathRagdolls;

    /// 武器名（索引 → 显示名）。
    /// ⚠️ **第 0 项应当是空字符串** —— panelFrames.activeWeapon 索引到 0 时会取到空串，
    ///    下游必须容忍空武器名（真实数据里确实如此）。
    std::vector<std::string> weaponNames;
};

// ════════════════════════════════════════════════════════════════════════════
// validate —— 写共享内存之前必须先跑一遍
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么值得单独做：这些约束在 JS 侧全部**不做兜底**（规范违规直接抛 TypeError）。
// 所以错误信息只能来自这里 —— 让它在 C++ 侧就报清楚「哪一列长度不对」，
// 而不是等到浏览器控制台里看到一个 minified 的 TypeError。

struct ValidationIssue {
    std::string field;
    std::string problem;
};

struct ValidationReport {
    std::vector<ValidationIssue> issues;

    bool ok() const { return issues.empty(); }
    explicit operator bool() const { return ok(); }

    /// 拼成一段可读文本（可直接写日志）
    std::string toString() const {
        std::string out;
        out.reserve(issues.size() * 96);
        for (const auto& it : issues) {
            out += it.field;
            out += ": ";
            out += it.problem;
            out += '\n';
        }
        return out;
    }
};

/// 检查 data 是否满足契约。返回的 report 里会列出**全部**问题（不是遇到第一个就返回）。
inline ValidationReport validate(const DemoData& d) {
    ValidationReport rep;
    auto fail = [&rep](std::string_view f, std::string p) {
        rep.issues.push_back({std::string(f), std::move(p)});
    };
    auto needLen = [&](std::string_view name, std::size_t got, std::size_t want) {
        if (got != want) {
            fail(name, "长度 " + std::to_string(got) + "，期望 " + std::to_string(want));
        }
    };

    const auto P = d.meta.numPlayers;
    const auto N = d.meta.numFrames;
    const auto M = d.panelFrames.numFrames;

    // ── meta ──
    if (d.meta.mapName.empty()) fail("meta.mapName", "为空");
    if (d.meta.tickRate != kTickRate) fail("meta.tickRate", "必须是 64，实际 " + std::to_string(d.meta.tickRate));
    if (P == 0) fail("meta.numPlayers", "为 0");
    if (N == 0) fail("meta.numFrames", "为 0（可见帧数）");
    if (N > d.frameCapacity) fail("meta.numFrames", "超过 frameCapacity");
    if (M > d.panelCapacity) fail("panelFrames.numFrames", "超过 panelCapacity");

    // ── players ──
    needLen("players", d.players.size(), P);
    for (std::size_t i = 0; i < d.players.size(); ++i) {
        if (d.players[i].steamId.empty()) fail("players[" + std::to_string(i) + "].steamId", "为空（必须是字符串）");
        if (d.players[i].slot != i) fail("players[" + std::to_string(i) + "].slot", "应等于下标");
    }

    // ── frames ──
    const auto NP = static_cast<std::size_t>(N) * P;
    if (d.frames.frameTick.size() < N) {
        fail("frames.frameTick", "长度 " + std::to_string(d.frames.frameTick.size()) + " < 可见帧数 " + std::to_string(N));
    } else {
        // 严格升序
        for (std::size_t i = 1; i < N; ++i) {
            if (d.frames.frameTick[i] <= d.frames.frameTick[i - 1]) {
                fail("frames.frameTick", "在 " + std::to_string(i) + " 处不是严格升序");
                break;
            }
        }
        if (N > 0 && d.meta.endTick != d.frames.frameTick[N - 1]) {
            fail("meta.endTick", "应等于最后一帧 tick，实际 " + std::to_string(d.meta.endTick) +
                                      " vs " + std::to_string(d.frames.frameTick[N - 1]));
        }
    }

    const std::pair<std::string_view, std::size_t> npCols[] = {
        {"frames.posX", d.frames.posX.size()}, {"frames.posY", d.frames.posY.size()},
        {"frames.posZ", d.frames.posZ.size()}, {"frames.yaw", d.frames.yaw.size()},
        {"frames.pitch", d.frames.pitch.size()}, {"frames.health", d.frames.health.size()},
        {"frames.alive", d.frames.alive.size()}, {"frames.team", d.frames.team.size()},
        {"frames.score", d.frames.score.size()}, {"frames.duck", d.frames.duck.size()},
        {"frames.flash", d.frames.flash.size()}, {"frames.flashAlpha", d.frames.flashAlpha.size()},
        {"frames.zoom", d.frames.zoom.size()},
        {"frames.speed", d.frames.speed.size()}, {"frames.smoothSpeed", d.frames.smoothSpeed.size()},
    };
    for (const auto& [name, got] : npCols) {
        if (got < NP) fail(name, "长度 " + std::to_string(got) + " < N*P " + std::to_string(NP));
    }
    // 可选列：要么空（不发），要么满长度
    const std::pair<std::string_view, std::size_t> optCols[] = {
        {"frames.accuracyPenalty", d.frames.accuracyPenalty.size()},
        {"frames.reloading", d.frames.reloading.size()},
        {"frames.playerFlags", d.frames.playerFlags.size()},
    };
    for (const auto& [name, got] : optCols) {
        if (got != 0 && got < NP) fail(name, "可选列若提供就必须满长度：实际 " + std::to_string(got) + " < " + std::to_string(NP));
    }

    // ── panelFrames ──
    const auto MP = static_cast<std::size_t>(M) * P;
    if (d.panelFrames.frameTick.size() < M) {
        fail("panelFrames.frameTick", "长度 " + std::to_string(d.panelFrames.frameTick.size()) + " < " + std::to_string(M));
    } else {
        for (std::size_t i = 1; i < M; ++i) {
            if (d.panelFrames.frameTick[i] <= d.panelFrames.frameTick[i - 1]) {
                fail("panelFrames.frameTick", "在 " + std::to_string(i) + " 处不是严格升序");
                break;
            }
        }
    }
    const std::pair<std::string_view, std::size_t> mpCols[] = {
        {"panelFrames.health", d.panelFrames.health.size()}, {"panelFrames.alive", d.panelFrames.alive.size()},
        {"panelFrames.team", d.panelFrames.team.size()}, {"panelFrames.armor", d.panelFrames.armor.size()},
        {"panelFrames.flags", d.panelFrames.flags.size()}, {"panelFrames.activeWeapon", d.panelFrames.activeWeapon.size()},
        {"panelFrames.utilCounts", d.panelFrames.utilCounts.size()},
        {"panelFrames.money", d.panelFrames.money.size()}, {"panelFrames.clipAmmo", d.panelFrames.clipAmmo.size()},
        {"panelFrames.reserveAmmo", d.panelFrames.reserveAmmo.size()},
    };
    for (const auto& [name, got] : mpCols) {
        if (got < MP) fail(name, "长度 " + std::to_string(got) + " < M*P " + std::to_string(MP));
    }

    // ── 区间数据：count 与各列长度必须自洽 ──
    needLen("tracers.origin", d.tracers.origin.size(), static_cast<std::size_t>(d.tracers.count) * 3);
    needLen("tracers.end", d.tracers.end.size(), static_cast<std::size_t>(d.tracers.count) * 3);
    needLen("tracers.tick", d.tracers.tick.size(), d.tracers.count);
    needLen("tracers.team", d.tracers.team.size(), d.tracers.count);
    needLen("tracers.hitKind", d.tracers.hitKind.size(), d.tracers.count);

    needLen("damage.attackerSlot", d.damage.attackerSlot.size(), d.damage.count);
    needLen("damage.victimSlot", d.damage.victimSlot.size(), d.damage.count);
    needLen("damage.tick", d.damage.tick.size(), d.damage.count);
    needLen("damage.dmg", d.damage.dmg.size(), d.damage.count);

    needLen("weaponFires.ticks", d.weaponFires.ticks.size(), d.weaponFires.slots.size());

    const auto SC = d.smokeVoxels.count;
    needLen("smokeVoxels.tickBegin", d.smokeVoxels.tickBegin.size(), SC);
    needLen("smokeVoxels.detonation", d.smokeVoxels.detonation.size(), static_cast<std::size_t>(SC) * 3);
    needLen("smokeVoxels.color", d.smokeVoxels.color.size(), static_cast<std::size_t>(SC) * 3);
    needLen("smokeVoxels.bufferOffsets", d.smokeVoxels.bufferOffsets.size(), static_cast<std::size_t>(SC) + 1);
    needLen("smokeVoxels.frameOffsets", d.smokeVoxels.frameOffsets.size(), static_cast<std::size_t>(SC) + 1);
    if (!d.smokeVoxels.bufferOffsets.empty() &&
        d.smokeVoxels.bufferOffsets.back() != static_cast<i32>(d.smokeVoxels.buffers.size())) {
        fail("smokeVoxels.bufferOffsets", "末项应等于 buffers 字节数");
    }
    if (!d.smokeVoxels.frameOffsets.empty() &&
        d.smokeVoxels.frameOffsets.back() != static_cast<i32>(d.smokeVoxels.frameTicks.size())) {
        fail("smokeVoxels.frameOffsets", "末项应等于 frameTicks 元素数");
    }

    // ── 元数据对象的基本自洽 ──
    if (d.rounds.empty()) fail("rounds", "为空（至少要有一个回合）");
    for (std::size_t i = 1; i < d.rounds.size(); ++i) {
        if (d.rounds[i].startTick < d.rounds[i - 1].startTick) {
            fail("rounds", "startTick 未按升序排列");
            break;
        }
    }
    if (!d.weaponNames.empty() && !d.weaponNames[0].empty()) {
        fail("weaponNames[0]", "应当是空字符串（activeWeapon 索引 0 会取到它）");
    }
    for (std::size_t i = 0; i < d.events.size(); ++i) {
        if (i && d.events[i].tick < d.events[i - 1].tick) {
            fail("events", "tick 未按升序排列（第 " + std::to_string(i) + " 项）");
            break;
        }
    }
    for (std::size_t i = 0; i < d.grenades.trajectories.size(); ++i) {
        const auto& t = d.grenades.trajectories[i];
        if (t.posXYZ.size() != t.ticks.size() * 3) {
            fail("grenades.trajectories[" + std::to_string(i) + "].posXYZ",
                 "长度应为 ticks×3，实际 " + std::to_string(t.posXYZ.size()) + " vs " + std::to_string(t.ticks.size() * 3));
        }
        if (t.angles && t.angles->size() != t.ticks.size() * 3) {
            fail("grenades.trajectories[" + std::to_string(i) + "].angles", "长度应为 ticks×3");
        }
    }
    for (std::size_t i = 0; i < d.mapEntities.size(); ++i) {
        const auto& m = d.mapEntities[i];
        if (m.origin.size() != 3) fail("mapEntities[" + std::to_string(i) + "].origin", "应为 3 个元素");
        if (!m.angles.empty() && m.angles.size() != m.ticks.size() * 3) {
            fail("mapEntities[" + std::to_string(i) + "].angles", "长度应为 ticks×3");
        }
        if (!m.hidden.empty() && m.hidden.size() != m.ticks.size()) {
            fail("mapEntities[" + std::to_string(i) + "].hidden", "长度应为 ticks");
        }
    }
    for (std::size_t i = 0; i < d.droppedWeapons.size(); ++i) {
        const auto& w = d.droppedWeapons[i];
        if (w.ticks.empty()) continue;
        if (w.positions.size() != w.ticks.size() * 3) {
            fail("droppedWeapons[" + std::to_string(i) + "].positions", "长度应为 ticks×3");
        }
        if (!w.angles.empty() && w.angles.size() != w.ticks.size() * 3) {
            fail("droppedWeapons[" + std::to_string(i) + "].angles", "长度应为 ticks×3");
        }
    }
    for (std::size_t i = 0; i < d.deathRagdolls.size(); ++i) {
        if (d.deathRagdolls[i].force.size() != 3) fail("deathRagdolls[" + std::to_string(i) + "].force", "应为 3 个元素");
        if (d.deathRagdolls[i].eyeAngles.size() != 2) fail("deathRagdolls[" + std::to_string(i) + "].eyeAngles", "应为 2 个元素");
    }

    return rep;
}

// ════════════════════════════════════════════════════════════════════════════
// 值域抽检（开销比 validate 大，开发期用；正式流程只跑 validate）
// ════════════════════════════════════════════════════════════════════════════
//
// 这些范围来自真实 demo 实测 + docs/07 §3.2。超出范围说明解析或映射写错了。
inline ValidationReport auditRanges(const DemoData& d) {
    ValidationReport rep;
    auto fail = [&rep](std::string_view f, std::string p) { rep.issues.push_back({std::string(f), std::move(p)}); };

    auto checkSet = [&](std::string_view name, const std::vector<u8>& v, std::initializer_list<int> allowed) {
        for (std::size_t i = 0; i < v.size(); ++i) {
            bool hit = false;
            for (int a : allowed) if (v[i] == a) { hit = true; break; }
            if (!hit) { fail(name, "在 " + std::to_string(i) + " 处出现非法值 " + std::to_string(v[i])); return; }
        }
    };
    auto checkRange = [&](std::string_view name, const std::vector<f32>& v, double lo, double hi) {
        for (std::size_t i = 0; i < v.size(); ++i) {
            if (v[i] < lo || v[i] > hi) {
                fail(name, "在 " + std::to_string(i) + " 处 " + std::to_string(v[i]) + " 超出 [" + std::to_string(lo) + ", " + std::to_string(hi) + "]");
                return;
            }
        }
    };

    // 注意：不做切片 —— auditRanges 检查的是整条列，包括增量写入时尚未发布的部分。
    // 如果只想查已发布区间，自行按 NP 截断后再调。

    checkSet("frames.team", d.frames.team, {0, 2, 3});
    checkSet("frames.alive", d.frames.alive, {0, 1});
    checkSet("frames.zoom", d.frames.zoom, {0, 1, 2});
    checkSet("panelFrames.team", d.panelFrames.team, {0, 2, 3});
    checkSet("panelFrames.alive", d.panelFrames.alive, {0, 1});
    checkRange("frames.yaw", d.frames.yaw, -360.0, 360.0);      // 实测 (-180, 180]
    checkRange("frames.pitch", d.frames.pitch, -90.0, 90.0);    // 实测 [-64, 89]
    checkRange("frames.duck", d.frames.duck, 0.0, 1.0);
    checkRange("frames.speed", d.frames.speed, 0.0, 5000.0);    // 实测最大 310.79
    checkRange("frames.smoothSpeed", d.frames.smoothSpeed, 0.0, 5000.0); // 实测最大 286.71

    return rep;
}

}  // namespace csdemo
