//! 步骤 2 · 字段验证工具（四趟解析版）。
//!
//! 报告：
//!   1. demo 头信息；2. 玩家名册；3. 玩家 tick 列产出（对照 PlayerSnapshot 字段）；
//!   4. 武器/投掷物列产出；5. 游戏事件名与次数；6. player_death / bomb / item 样例。
//!
//! 用法：dump_fields.exe <path.dem> [报告输出路径]

use cs2ffi::parse::{self, PassKind, KEY_EVENTS, player_props};
use parser::second_pass::variants::VarVec;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

fn col_summary(out: &parser::parse_demo::DemoOutput) -> Vec<(String, &'static str, usize)> {
    let mut rows = vec![];
    for info in &out.prop_controller.prop_infos {
        if let Some(col) = out.df.get(&info.id) {
            let (ty, len) = match &col.data {
                Some(v) => match v {
                    VarVec::F32(d) => ("F32", d.len()),
                    VarVec::I32(d) => ("I32", d.len()),
                    VarVec::U32(d) => ("U32", d.len()),
                    VarVec::U64(d) => ("U64", d.len()),
                    VarVec::Bool(d) => ("Bool", d.len()),
                    VarVec::String(d) => ("String", d.len()),
                    VarVec::StringVec(d) => ("StringVec", d.len()),
                    VarVec::U64Vec(d) => ("U64Vec", d.len()),
                    VarVec::U32Vec(d) => ("U32Vec", d.len()),
                    VarVec::XYVec(d) => ("XYVec", d.len()),
                    VarVec::XYZVec(d) => ("XYZVec", d.len()),
                    VarVec::Stickers(d) => ("Stickers", d.len()),
                    VarVec::InputHistory(d) => ("InputHistory", d.len()),
                    VarVec::UserCmdSubtickMoves(d) => ("SubtickMoves", d.len()),
                },
                None => ("(无数据)", 0),
            };
            rows.push((info.prop_friendly_name.clone(), ty, len));
        }
    }
    rows.sort();
    rows
}

fn main() {
    let demo_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "D:/workfolder/Shin-Apps/resource/42k-Dust2.dem".to_string());
    let report_path =
        std::env::args().nth(2).unwrap_or_else(|| "report.txt".to_string());

    let mut r = String::new();

    // ---- 趟 1：玩家 tick 列 ----
    let t0 = std::time::Instant::now();
    let players = match parse::parse_pass(&demo_path, PassKind::PlayerTicks) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("解析失败: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("玩家趟耗时 {:.2}s", t0.elapsed().as_secs_f64());

    // ---- 1. demo 头 ----
    let _ = writeln!(r, "=== 1. demo header ===");
    if let Some(h) = &players.header {
        for (k, v) in h.iter() {
            let _ = writeln!(r, "  {k}: {v}");
        }
    }

    // ---- 2. 玩家名册 ----
    let _ = writeln!(r, "\n=== 2. 玩家名册 ===");
    let roster = if players.player_md.is_empty() { &players.roster } else { &players.player_md };
    let _ = writeln!(r, "  player_md={} 条, roster={} 条", players.player_md.len(), players.roster.len());
    for p in roster.iter() {
        let _ = writeln!(r, "  name={:?} steamid={:?} team={:?}", p.name, p.steamid, p.team_number);
    }

    // ---- 3. 玩家 tick 列产出 ----
    let _ = writeln!(r, "\n=== 3. 玩家 tick 列（df.len()={}）===", players.df.len());
    let mut found: BTreeSet<String> = BTreeSet::new();
    for (name, ty, len) in col_summary(&players) {
        found.insert(name.clone());
        let _ = writeln!(r, "  [OK]   {name:50} type={ty:6} len={len}");
    }
    let _ = writeln!(r, "  ---- 未产出 ----");
    for p in player_props() {
        if !found.contains(&p) && !found.iter().any(|f| f.ends_with(&p)) {
            let _ = writeln!(r, "  [MISS] {p}");
        }
    }

    // ---- 趟 2：武器列 ----
    let t1 = std::time::Instant::now();
    let weapons = match parse::parse_pass(&demo_path, PassKind::WeaponTicks) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("武器趟失败: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("武器趟耗时 {:.2}s", t1.elapsed().as_secs_f64());
    let _ = writeln!(r, "\n=== 4. 武器 tick 列（df.len()={}）===", weapons.df.len());
    for (name, ty, len) in col_summary(&weapons).into_iter().take(10) {
        let _ = writeln!(r, "  [OK]   {name:50} type={ty:6} len={len}");
    }
    let _ = writeln!(r, "  （共 {} 列）", col_summary(&weapons).len());

    // ---- 趟 3：投掷物 ----
    let t2 = std::time::Instant::now();
    let nades = match parse::parse_pass(&demo_path, PassKind::Grenades) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("投掷物趟失败: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("投掷物趟耗时 {:.2}s", t2.elapsed().as_secs_f64());
    let _ = writeln!(
        r,
        "\n=== 5. 投掷物 ===\n  projectiles={} 条, grenade df 列数={}",
        nades.projectiles.len(),
        col_summary(&nades).len()
    );
    for (name, ty, len) in col_summary(&nades) {
        let _ = writeln!(r, "  [OK]   {name:50} type={ty:6} len={len}");
    }
    if let Some(p0) = nades.projectiles.first() {
        let _ = writeln!(r, "  projectile[0]: {p0:?}");
    }

    // ---- 趟 4：事件 ----
    let t3 = std::time::Instant::now();
    let events = match parse::parse_pass(&demo_path, PassKind::Events) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("事件趟失败: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("事件趟耗时 {:.2}s", t3.elapsed().as_secs_f64());
    let _ = writeln!(r, "\n=== 6. 游戏事件（KEY_EVENTS 计数）===");
    let mut counts: Vec<(String, usize)> = KEY_EVENTS
        .iter()
        .map(|k| {
            (
                k.to_string(),
                events.game_events.iter().filter(|e| &e.name == *k).count(),
            )
        })
        .collect();
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    for (name, n) in &counts {
        let _ = writeln!(r, "  {name:20} x{n}");
    }
    let _ = writeln!(r, "  （demo 中共出现 {} 种事件名）", events.game_events_counter.len());

    // ---- 7. 事件样例 ----
    let _ = writeln!(r, "\n=== 7. player_death 样例（前 2 条）===");
    for e in events.game_events.iter().filter(|e| e.name == "player_death").take(2) {
        let _ = writeln!(r, "  tick={}", e.tick);
        for f in &e.fields {
            let _ = writeln!(r, "    {} = {:?}", f.name, f.data);
        }
    }
    for name in ["bomb_planted", "item_pickup"] {
        let _ = writeln!(r, "\n  ---- {name}（前 1 条）----");
        for e in events.game_events.iter().filter(|e| e.name == name).take(1) {
            let _ = writeln!(r, "  tick={}", e.tick);
            for f in &e.fields {
                let _ = writeln!(r, "    {} = {:?}", f.name, f.data);
            }
        }
    }

    // ---- 8. 行序与数据抽查（决定列转行方式）----
    // 取 tick / steamid / X / m_iHealth 四列前 25 行，判断行是 tick-major 还是 player-major。
    let tick_col = players
        .prop_controller
        .prop_infos
        .iter()
        .find(|i| i.prop_friendly_name == "tick")
        .and_then(|i| players.df.get(&i.id))
        .map(|c| match &c.data { Some(VarVec::I32(d)) => d.clone(), _ => vec![] });
    let sid_col = players
        .prop_controller
        .prop_infos
        .iter()
        .find(|i| i.prop_friendly_name == "steamid")
        .and_then(|i| players.df.get(&i.id))
        .map(|c| match &c.data { Some(VarVec::U64(d)) => d.clone(), _ => vec![] });
    let _ = writeln!(r, "\n=== 8. 行序抽查（前 25 行：tick | steamid | X | health）===");
    if let (Some(ticks), Some(sids)) = (&tick_col, &sid_col) {
        let mut f32_cols: Vec<(String, Vec<Option<f32>>)> = vec![];
        let mut i32_cols: Vec<(String, Vec<Option<i32>>)> = vec![];
        for info in &players.prop_controller.prop_infos {
            if let Some(c) = players.df.get(&info.id) {
                match &c.data {
                    Some(VarVec::F32(d)) => f32_cols.push((info.prop_friendly_name.clone(), d.clone())),
                    Some(VarVec::I32(d)) => i32_cols.push((info.prop_friendly_name.clone(), d.clone())),
                    _ => {}
                }
            }
        }
        let xpos = f32_cols.iter().position(|(n, _)| n == "X");
        let hpos = i32_cols.iter().position(|(n, _)| n.ends_with("m_iHealth"));
        for i in 0..25.min(ticks.len()) {
            let x = xpos.and_then(|p| f32_cols[p].1.get(i)).map(|v| v.unwrap_or(f32::NAN));
            let h = hpos.and_then(|p| i32_cols[p].1.get(i)).map(|v| v.unwrap_or(-1));
            let _ = writeln!(r, "  {:?} | {:?} | {:?} | {:?}", ticks[i], sids[i], x, h);
        }
        let min_t = ticks.iter().flatten().min().unwrap_or(&0);
        let max_t = ticks.iter().flatten().max().unwrap_or(&0);
        let _ = writeln!(r, "  tick 范围: {min_t} .. {max_t}（{:.1} 分钟 @64tick）", (max_t - min_t) as f64 / 64.0 / 60.0);
    } else {
        let _ = writeln!(r, "  （tick/steamid 列缺失，无法抽查）");
    }

    // ---- 9. 武器名抽样：玩家趟 weapon_name vs 武器趟 weapon ----
    let _ = writeln!(r, "\n=== 9. 武器名值抽样 ===");
    {
        // 无持有者行的武器名分布（找 C4 落地行为何没匹配上）
        let wps: Vec<Option<String>> = weapons.prop_controller.prop_infos.iter()
            .find(|i| i.prop_friendly_name == "weapon")
            .and_then(|i| weapons.df.get(&i.id))
            .and_then(|c| match &c.data { Some(VarVec::String(d)) => Some(d.clone()), _ => None })
            .unwrap_or_default();
        let sids: Vec<Option<u64>> = weapons.prop_controller.prop_infos.iter()
            .find(|i| i.prop_friendly_name == "steamid")
            .and_then(|i| weapons.df.get(&i.id))
            .and_then(|c| match &c.data { Some(VarVec::U64(d)) => Some(d.clone()), _ => None })
            .unwrap_or_default();
        let mut dist: BTreeMap<String, usize> = BTreeMap::new();
        for (i, w) in wps.iter().enumerate() {
            if sids.get(i).copied().flatten().is_none() {
                *dist.entry(w.clone().unwrap_or_default()).or_default() += 1;
            }
        }
        let _ = writeln!(r, "  steamid=None 行的武器名分布: {:?}", dist);
    }
    {
        let get_i32 = |out: &parser::parse_demo::DemoOutput, n: &str| -> Vec<Option<i32>> {
            out.prop_controller.prop_infos.iter()
                .find(|i| i.prop_friendly_name == n)
                .and_then(|i| out.df.get(&i.id))
                .and_then(|c| match &c.data { Some(VarVec::I32(d)) => Some(d.clone()), _ => None })
                .unwrap_or_default()
        };
        let res = get_i32(&weapons, "m_pReserveAmmo");
        let wps2: Vec<Option<String>> = weapons.prop_controller.prop_infos.iter()
            .find(|i| i.prop_friendly_name == "weapon")
            .and_then(|i| weapons.df.get(&i.id))
            .and_then(|c| match &c.data { Some(VarVec::String(d)) => Some(d.clone()), _ => None })
            .unwrap_or_default();
        let nz: Vec<i32> = res.iter().flatten().copied().filter(|v| *v != 0).take(6).collect();
        let _ = writeln!(r, "  m_pReserveAmmo 非零样例: {:?}（非零 {} / {}）",
            nz, res.iter().flatten().filter(|v| **v != 0).count(), res.len());
        // reserve>10 的行：武器名对照（确认是真实备弹还是标志位）
        let mut shown2 = 0;
        for (i, v) in res.iter().enumerate() {
            if let Some(rv) = v {
                if *rv > 10 && shown2 < 6 {
                    let _ = writeln!(r, "    reserve>10 行{}: weapon={:?} res={}", i,
                        wps2.get(i).cloned().flatten().unwrap_or_default(), rv);
                    shown2 += 1;
                }
            }
        }
    // 全部含 ammo/reserve 的 prop 名（list 模式外的一次性速查）
    let _ = writeln!(r, "  含 ammo/reserve 的 prop 名:");
    for n in &players.uniq_prop_names {
        if n.to_lowercase().contains("reserve") || n.to_lowercase().contains("ammo") {
            let _ = writeln!(r, "    {}", n);
        }
    }
    }
    let mut names: BTreeSet<String> = BTreeSet::new();
    if let Some(info) = players.prop_controller.prop_infos.iter().find(|i| i.prop_friendly_name == "weapon_name") {
        if let Some(col) = players.df.get(&info.id) {
            if let Some(VarVec::String(d)) = &col.data {
                let mut shown = 0;
                for (i, v) in d.iter().enumerate() {
                    if let Some(s) = v {
                        if !s.is_empty() && shown < 10 {
                            let _ = writeln!(r, "  player weapon_name[{}]={:?}", i, s);
                            shown += 1;
                        }
                        names.insert(s.clone());
                    }
                }
                let _ = writeln!(r, "  （玩家趟 weapon_name 非空 distinct={}）", names.len());
            }
        }
    }
    let mut wnames: BTreeSet<String> = BTreeSet::new();
    if let Some(info) = weapons.prop_controller.prop_infos.iter().find(|i| i.prop_friendly_name == "weapon") {
        if let Some(col) = weapons.df.get(&info.id) {
            if let Some(VarVec::String(d)) = &col.data {
                for v in d.iter().flatten() { wnames.insert(v.clone()); }
            }
        }
    }
    let _ = writeln!(r, "  （武器趟 weapon distinct={}）全表:", wnames.len());
    for (i, n) in wnames.iter().enumerate() {
        if i >= 40 { break; }
        let _ = writeln!(r, "    {:?}", n);
    }
    // 武器趟前 5 行：steamid(归属) / weapon / clip
    {
        let get_u64 = |n: &str| -> Vec<Option<u64>> {
            weapons.prop_controller.prop_infos.iter()
                .find(|i| i.prop_friendly_name == n)
                .and_then(|i| weapons.df.get(&i.id))
                .and_then(|c| match &c.data { Some(VarVec::U64(d)) => Some(d.clone()), _ => None })
                .unwrap_or_default()
        };
        let get_str = |n: &str| -> Vec<Option<String>> {
            weapons.prop_controller.prop_infos.iter()
                .find(|i| i.prop_friendly_name == n)
                .and_then(|i| weapons.df.get(&i.id))
                .and_then(|c| match &c.data { Some(VarVec::String(d)) => Some(d.clone()), _ => None })
                .unwrap_or_default()
        };
        let get_u32 = |n: &str| -> Vec<Option<u32>> {
            weapons.prop_controller.prop_infos.iter()
                .find(|i| i.prop_friendly_name == n)
                .and_then(|i| weapons.df.get(&i.id))
                .and_then(|c| match &c.data { Some(VarVec::U32(d)) => Some(d.clone()), _ => None })
                .unwrap_or_default()
        };
        let sids = get_u64("steamid");
        let wps = get_str("weapon");
        let clips = get_u32("m_iClip1");
        let names = get_str("name");
        let _ = writeln!(r, "  武器趟前 5 行：");
        for i in 0..5.min(sids.len()) {
            let n_str = names.get(i).cloned().flatten().unwrap_or_default();
            let w_str = wps.get(i).cloned().flatten().unwrap_or_default();
            let _ = writeln!(r, "    steamid={:?} name={:?} weapon={:?} clip={:?}",
                sids.get(i).copied().flatten(),
                n_str,
                w_str,
                clips.get(i).copied().flatten());
        }
        let nonzero = sids.iter().filter(|s| s.map_or(false, |v| v != 0)).count();
        let _ = writeln!(r, "  steamid 非零行数: {} / {}", nonzero, sids.len());
    }

    std::fs::write(&report_path, &r).expect("写报告");
    eprintln!("报告已写入 {report_path}");
    print!("{r}");
}
