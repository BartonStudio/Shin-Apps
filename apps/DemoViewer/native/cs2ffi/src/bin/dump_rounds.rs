//! 临时分析工具：dump round_start / round_freeze_end / round_end 事件 tick。
//! 用法：dump_rounds.exe <path.dem>

use cs2ffi::parse::{self, PassKind};

fn main() {
    let demo_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "D:/workfolder/Shin-Apps/resource/42k-Dust2.dem".to_string());

    let events = parse::parse_pass(&demo_path, PassKind::Events)
        .unwrap_or_else(|e| {
            eprintln!("解析失败: {e}");
            std::process::exit(1);
        });

    for name in ["round_start", "round_freeze_end", "round_end"] {
        println!("--- {name} ---");
        for (i, e) in events.game_events.iter().filter(|e| e.name == name).enumerate() {
            let mut extra = String::new();
            if name == "round_end" {
                for f in &e.fields {
                    if f.name == "winner" {
                        extra = format!(" winner={:?}", f.data);
                    }
                }
            }
            println!("  [{i:2}] tick={:7} ({:.1}s){}", e.tick, e.tick as f64 / 64.0, extra);
        }
    }

    // 时间线对照：前 4 个 round 的 start / freeze_end / end
    println!("\n--- 前 4 回合时间线（tick → 秒）---");
    let starts: Vec<i32> = events.game_events.iter().filter(|e| e.name == "round_start").map(|e| e.tick).collect();
    let freezes: Vec<i32> = events.game_events.iter().filter(|e| e.name == "round_freeze_end").map(|e| e.tick).collect();
    let ends: Vec<i32> = events.game_events.iter().filter(|e| e.name == "round_end").map(|e| e.tick).collect();
    let n = starts.len().min(freezes.len()).min(ends.len()).min(4);
    for i in 0..n {
        let s = starts[i];
        let f = freezes[i];
        let e = ends[i];
        println!(
            "  round{i}: start={} ({:.0}s) freeze_end={} ({:.0}s, +{:.0}s) round_end={} ({:.0}s, live={:.0}s)",
            s, s as f64 / 64.0,
            f, f as f64 / 64.0, (f - s) as f64 / 64.0,
            e, e as f64 / 64.0, (e - f) as f64 / 64.0
        );
    }
    println!("\n  round_start 总数={}  freeze_end 总数={}  round_end 总数={}", starts.len(), freezes.len(), ends.len());

    // 字段抽查：round_start / round_freeze_end / round_end 各事件的所有字段
    println!("\n--- 事件字段抽查 ---");
    for name in ["round_start", "round_freeze_end", "round_end"] {
        for e in events.game_events.iter().filter(|e| e.name == name).take(2) {
            println!("  {name} @tick={} ({:.1}s):", e.tick, e.tick as f64 / 64.0);
            for f in &e.fields {
                println!("      {} = {:?}", f.name, f.data);
            }
        }
    }
}
