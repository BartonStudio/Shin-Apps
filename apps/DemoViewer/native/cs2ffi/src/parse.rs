//! 内部 Rust API：封装 ParserInputs 构造与多趟解析。
//!
//! demoparser 的设计（对照 Python 绑定的 parse_ticks / parse_weapons /
//! parse_grenades / parse_events 四个独立 API）：
//!   - 一趟解析里「tick 列收集」与「事件收集」互斥（collect_data.rs:67）；
//!   - 玩家列 / 武器列 / 投掷物列三者也互斥（collect_entities 内部 if-return 分支）；
//!   - 事件模式下 game_events 照常收集，但 df 恒为空。
//! 因此一次加载需要多趟解析（每趟 ~1.7s / 91MB demo，4 趟可接受）。

use ahash::AHashMap;
use parser::first_pass::parser_settings::{ParserInputs, rm_user_friendly_names};
use parser::parse_demo::{DemoOutput, ParsingMode, Parser};
use parser::second_pass::parser_settings::create_huffman_lookup_table;

/// PlayerSnapshot 需要的玩家属性（友好名；未知名会原样透传为真实 prop 路径）。
pub fn player_props() -> Vec<String> {
    [
        // 坐标 / 视角（自定义列，内部由 m_vec + m_cell 组合）
        "X",
        "Y",
        "Z",
        "pitch",
        "yaw",
        // 状态
        "is_alive",
        "health",
        "team_num",
        "armor_value",
        "balance",
        "active_weapon_name",
        // 下蹲程度（前端动画混合，契约 frames.duck）
        "CCSPlayerPawn.CCSPlayer_MovementServices.m_flDuckAmount",
        // 记分板
        "mvps",
        "score",
        "kills_this_round",
        "assists_this_round",
        // 整场累计击杀/死亡（真实 prop 路径，friendly 表里没有）
        "CCSPlayerController.CCSPlayerController_ActionTrackingServices.m_iKills",
        "CCSPlayerController.CCSPlayerController_ActionTrackingServices.m_iDeaths",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// 武器实体的属性（武器趟）。
pub fn weapon_props() -> Vec<String> {
    ["m_iClip1", "m_pReserveAmmo"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// 投掷物实体的属性（投掷物趟）。
pub fn grenade_props() -> Vec<String> {
    ["X", "Y", "Z"].iter().map(|s| s.to_string()).collect()
}

/// 关注的游戏事件名。
pub const KEY_EVENTS: &[&str] = &[
    "player_death",
    "player_connect",
    "player_disconnect",
    "round_start",
    "round_end",
    "round_freeze_end",
    "bomb_planted",
    "bomb_defused",
    "bomb_exploded",
    "bomb_dropped",
    "bomb_pickup",
    "item_pickup",
    "weapon_fire",
    "player_team",
    "round_mvp",
];

/// 一趟解析的类别（对应 python 绑定的四个 API）。
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PassKind {
    /// 玩家每 tick 列（parse_ticks）
    PlayerTicks,
    /// 武器实体每 tick 列（parse_weapons）
    WeaponTicks,
    /// 投掷物（parse_grenades / parse_projectiles）
    Grenades,
    /// 游戏事件（parse_events，df 恒为空）
    Events,
}

pub fn parse_pass(demo_path: &str, kind: PassKind) -> Result<DemoOutput, String> {
    let huf = create_huffman_lookup_table();
    let file =
        std::fs::File::open(demo_path).map_err(|e| format!("打开失败 {demo_path}: {e}"))?;
    let mmap = unsafe { memmap2::MmapOptions::new().map(&file) }
        .map_err(|e| format!("mmap 失败: {e}"))?;

    let (player_props, other_props, wanted_events, parse_weapons, parse_projectiles, parse_grenades) =
        match kind {
            PassKind::PlayerTicks => (player_props(), vec![], vec![], false, false, false),
            PassKind::WeaponTicks => (vec![], weapon_props(), vec![], true, false, false),
            PassKind::Grenades => (vec![], grenade_props(), vec![], false, true, true),
            PassKind::Events => (vec![], vec![], vec!["all".to_string()], false, false, false),
        };

    // 友好名 → 真实 prop 路径（parser 本体只认真实名；未知名原样透传，
    // X/Y/Z/pitch/yaw/is_alive 等特殊列在 parser 内部按名处理，不受影响）。
    let player_props = rm_user_friendly_names(&player_props).map_err(|e| format!("{e}"))?;
    let other_props = rm_user_friendly_names(&other_props).map_err(|e| format!("{e}"))?;

    let settings = ParserInputs {
        wanted_player_props: player_props,
        wanted_other_props: other_props,
        wanted_events,
        real_name_to_og_name: AHashMap::default(),
        wanted_players: vec![],
        wanted_ticks: vec![],
        parse_ents: true,
        parse_projectiles,
        parse_grenades,
        parse_weapons,
        only_header: false,
        list_props: false,
        only_convars: false,
        huffman_lookup_table: &huf,
        order_by_steamid: false,
        wanted_prop_states: AHashMap::default(),
        fallback_bytes: None,
    };
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    parser.parse_demo(&mmap).map_err(|e| format!("{e}"))
}
