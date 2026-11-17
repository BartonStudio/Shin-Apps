//! C ABI 导出面（步骤 3）。
//!
//! 设计：
//!   - 句柄 DemoHandle 持有四趟解析的输出（玩家列 / 武器列 / 投掷物列 / 事件）；
//!   - 数值列懒转换为稠密 C 数组缓存（demoparser 的列是 Vec<Option<T>>，
//!     Option<f32> 8 字节，不能直接给 C++；转换时 None→NAN/0）；
//!   - 字符串（列内字符串、事件字段字符串、名册名字）转 CString 后存入句柄，
//!     指针生命周期 = 句柄生命周期；
//!   - 所有导出函数 catch_unwind 包裹，错误信息存 thread_local，
//!     通过 demo_last_error() 读取。

use std::cell::RefCell;
use std::ffi::{c_char, CStr, CString};
use std::panic::AssertUnwindSafe;

use ahash::AHashMap;
use parser::parse_demo::DemoOutput;
use parser::second_pass::game_events::GameEvent;
use parser::second_pass::variants::{VarVec, Variant};

use crate::parse::{parse_pass, PassKind};

// ---------------------------------------------------------------------------
// 错误传递（thread_local，非线程安全用法：各线程独立）
// ---------------------------------------------------------------------------

thread_local! {
    static LAST_ERROR: RefCell<CString> = RefCell::new(CString::new("no error").unwrap());
}

fn set_last_error(msg: &str) {
    LAST_ERROR.with(|e| {
        *e.borrow_mut() = CString::new(msg.replace('\0', " ")).unwrap_or_default();
    });
}

// ---------------------------------------------------------------------------
// 句柄
// ---------------------------------------------------------------------------

pub struct DemoHandle {
    /// 三趟 tick 列输出：0=玩家 1=武器 2=投掷物
    passes: [Option<DemoOutput>; 3],
    /// 事件趟输出（df 恒为空，只用 game_events）
    events: Option<DemoOutput>,
    /// 稠密数值列缓存：key = (pass, prop_id)
    f32_cache: RefCell<AHashMap<(u32, u32), Vec<f32>>>,
    i32_cache: RefCell<AHashMap<(u32, u32), Vec<i32>>>,
    u32_cache: RefCell<AHashMap<(u32, u32), Vec<u32>>>,
    u64_cache: RefCell<AHashMap<(u32, u32), Vec<u64>>>,
    u8_cache: RefCell<AHashMap<(u32, u32), Vec<u8>>>,
    /// 列内字符串缓存：key = (pass, prop_id, 行号)
    str_cache: RefCell<AHashMap<(u32, u32, usize), CString>>,
    /// 事件字段字符串缓冲区（只增不减，指针长期有效）
    event_str_arena: RefCell<Vec<CString>>,
    /// 事件名 → 该事件在 game_events 里的下标列表（懒建）
    event_index: RefCell<Option<AHashMap<String, Vec<u32>>>>,
    /// 名册
    /// 名册（infos 里的 name 指针指向 roster_names 中的 CString）
    roster: Vec<DemoPlayerInfo>,
    roster_names: Vec<CString>,
    map_name: CString,
    max_tick: i64,
}

// ---------------------------------------------------------------------------
// C 可见类型（与 shim.h 手工保持一致）
// ---------------------------------------------------------------------------

/// 通行类别（对应 parse::PassKind 的三个 tick 列趟）
pub const DEMO_PASS_PLAYER: u32 = 0;
pub const DEMO_PASS_WEAPON: u32 = 1;
pub const DEMO_PASS_GRENADE: u32 = 2;

/// 列类型标记
pub const DEMO_COL_MISSING: u32 = 6;
pub const DEMO_COL_F32: u32 = 0;
pub const DEMO_COL_I32: u32 = 1;
pub const DEMO_COL_U32: u32 = 2;
pub const DEMO_COL_U64: u32 = 3;
pub const DEMO_COL_U8: u32 = 4;
pub const DEMO_COL_STR: u32 = 5;

/// 事件字段值的类型标记（DemoVariant.tag）
pub const DEMO_VAR_NONE: u32 = 0;
pub const DEMO_VAR_BOOL: u32 = 1;
pub const DEMO_VAR_I32: u32 = 2;
pub const DEMO_VAR_U32: u32 = 3;
pub const DEMO_VAR_U64: u32 = 4;
pub const DEMO_VAR_F32: u32 = 5;
pub const DEMO_VAR_STR: u32 = 6;

#[repr(C)]
pub union DemoVarValue {
    pub b: u8,
    pub i: i32,
    pub u: u32,
    pub l: u64,
    pub f: f32,
    pub s: *const c_char,
}

#[repr(C)]
pub struct DemoVariant {
    pub tag: u32,
    pub value: DemoVarValue,
}

#[repr(C)]
pub struct DemoPlayerInfo {
    pub name: *const c_char,
    pub steamid: u64,
    pub team: i32,
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

fn find_prop<'a>(out: &'a DemoOutput, name: &str) -> Option<(&'a parser::first_pass::prop_controller::PropInfo, &'a parser::second_pass::variants::PropColumn)> {
    out.prop_controller
        .prop_infos
        .iter()
        .find(|i| i.prop_friendly_name == name)
        .and_then(|i| out.df.get(&i.id).map(|c| (i, c)))
}

fn col_type_of(col: &parser::second_pass::variants::PropColumn) -> u32 {
    match &col.data {
        Some(VarVec::F32(_)) => DEMO_COL_F32,
        Some(VarVec::I32(_)) => DEMO_COL_I32,
        Some(VarVec::U32(_)) => DEMO_COL_U32,
        Some(VarVec::U64(_)) => DEMO_COL_U64,
        Some(VarVec::Bool(_)) => DEMO_COL_U8,
        Some(VarVec::String(_)) => DEMO_COL_STR,
        _ => DEMO_COL_MISSING,
    }
}

impl DemoHandle {
    fn open(path: &str) -> Result<Box<DemoHandle>, String> {
        let player = parse_pass(path, PassKind::PlayerTicks)?;
        let weapons = parse_pass(path, PassKind::WeaponTicks)?;
        let grenades = parse_pass(path, PassKind::Grenades)?;
        let events = parse_pass(path, PassKind::Events)?;

        // 名册：优先 player_md（终局记分板），缺失用 roster（Controller 名册）回退
        let src = if player.player_md.is_empty() { &player.roster } else { &player.player_md };
        let mut roster = Vec::with_capacity(src.len());
        let mut roster_names = Vec::with_capacity(src.len());
        for p in src.iter() {
            let c = CString::new(p.name.clone().unwrap_or_default().replace('\0', " "))
                .unwrap_or_default();
            roster_names.push(c);
        }
        for (i, p) in src.iter().enumerate() {
            roster.push(DemoPlayerInfo {
                name: roster_names[i].as_ptr(),
                steamid: p.steamid.unwrap_or(0),
                team: p.team_number.unwrap_or(0),
            });
        }

        let map_name = CString::new(
            player
                .header
                .as_ref()
                .and_then(|h| h.get("map_name").cloned())
                .unwrap_or_default(),
        )
        .unwrap_or_default();

        // 总 tick：tick 列最大值
        let max_tick = find_prop(&player, "tick")
            .and_then(|(_, c)| match &c.data {
                Some(VarVec::I32(d)) => d.iter().flatten().max().map(|t| *t as i64),
                _ => None,
            })
            .unwrap_or(0);

        Ok(Box::new(DemoHandle {
            passes: [Some(player), Some(weapons), Some(grenades)],
            events: Some(events),
            f32_cache: RefCell::default(),
            i32_cache: RefCell::default(),
            u32_cache: RefCell::default(),
            u64_cache: RefCell::default(),
            u8_cache: RefCell::default(),
            str_cache: RefCell::default(),
            event_str_arena: RefCell::default(),
            event_index: RefCell::default(),
            roster,
            roster_names,
            map_name,
            max_tick,
        }))
    }

    fn pass_out(&self, pass: u32) -> Option<&DemoOutput> {
        self.passes.get(pass as usize).and_then(|o| o.as_ref())
    }

    /// 按名取某趟的列（不在缓存中时做稠密转换并缓存）
    fn dense_f32(&self, pass: u32, name: &str) -> Option<*const f32> {
        let out = self.pass_out(pass)?;
        let (info, col) = find_prop(out, name)?;
        let key = (pass, info.id);
        if let Some(v) = self.f32_cache.borrow().get(&key) {
            return Some(v.as_ptr());
        }
        let VarVec::F32(data) = col.data.as_ref()? else { return None };
        let dense: Vec<f32> = data.iter().map(|x| x.unwrap_or(f32::NAN)).collect();
        let ptr = dense.as_ptr();
        self.f32_cache.borrow_mut().insert(key, dense);
        Some(ptr)
    }

    fn dense_i32(&self, pass: u32, name: &str) -> Option<*const i32> {
        let out = self.pass_out(pass)?;
        let (info, col) = find_prop(out, name)?;
        let key = (pass, info.id);
        if let Some(v) = self.i32_cache.borrow().get(&key) {
            return Some(v.as_ptr());
        }
        let VarVec::I32(data) = col.data.as_ref()? else { return None };
        let dense: Vec<i32> = data.iter().map(|x| x.unwrap_or(0)).collect();
        let ptr = dense.as_ptr();
        self.i32_cache.borrow_mut().insert(key, dense);
        Some(ptr)
    }

    fn dense_u32(&self, pass: u32, name: &str) -> Option<*const u32> {
        let out = self.pass_out(pass)?;
        let (info, col) = find_prop(out, name)?;
        let key = (pass, info.id);
        if let Some(v) = self.u32_cache.borrow().get(&key) {
            return Some(v.as_ptr());
        }
        let VarVec::U32(data) = col.data.as_ref()? else { return None };
        let dense: Vec<u32> = data.iter().map(|x| x.unwrap_or(0)).collect();
        let ptr = dense.as_ptr();
        self.u32_cache.borrow_mut().insert(key, dense);
        Some(ptr)
    }

    fn dense_u64(&self, pass: u32, name: &str) -> Option<*const u64> {
        let out = self.pass_out(pass)?;
        let (info, col) = find_prop(out, name)?;
        let key = (pass, info.id);
        if let Some(v) = self.u64_cache.borrow().get(&key) {
            return Some(v.as_ptr());
        }
        let VarVec::U64(data) = col.data.as_ref()? else { return None };
        let dense: Vec<u64> = data.iter().map(|x| x.unwrap_or(0)).collect();
        let ptr = dense.as_ptr();
        self.u64_cache.borrow_mut().insert(key, dense);
        Some(ptr)
    }

    fn dense_u8(&self, pass: u32, name: &str) -> Option<*const u8> {
        let out = self.pass_out(pass)?;
        let (info, col) = find_prop(out, name)?;
        let key = (pass, info.id);
        if let Some(v) = self.u8_cache.borrow().get(&key) {
            return Some(v.as_ptr());
        }
        let VarVec::Bool(data) = col.data.as_ref()? else { return None };
        let dense: Vec<u8> = data.iter().map(|x| x.unwrap_or(false) as u8).collect();
        let ptr = dense.as_ptr();
        self.u8_cache.borrow_mut().insert(key, dense);
        Some(ptr)
    }

    fn col_str_at(&self, pass: u32, name: &str, index: usize) -> Option<*const c_char> {
        let out = self.pass_out(pass)?;
        let (info, col) = find_prop(out, name)?;
        let VarVec::String(data) = col.data.as_ref()? else { return None };
        let s = data.get(index)?.as_ref()?;
        let key = (pass, info.id, index);
        if let Some(c) = self.str_cache.borrow().get(&key) {
            return Some(c.as_ptr());
        }
        let c = CString::new(s.replace('\0', " ")).unwrap_or_default();
        let ptr = c.as_ptr();
        self.str_cache.borrow_mut().insert(key, c);
        Some(ptr)
    }

    fn events(&self) -> &Vec<GameEvent> {
        static EMPTY: Vec<GameEvent> = Vec::new();
        self.events.as_ref().map(|o| &o.game_events).unwrap_or(&EMPTY)
    }

    fn event_indices(&self, name: &str) -> Vec<u32> {
        // 懒建索引：事件名 -> 下标列表
        {
            let mut idx = self.event_index.borrow_mut();
            if idx.is_none() {
                let mut map: AHashMap<String, Vec<u32>> = AHashMap::default();
                for (i, e) in self.events().iter().enumerate() {
                    map.entry(e.name.clone()).or_default().push(i as u32);
                }
                *idx = Some(map);
            }
        }
        self.event_index
            .borrow()
            .as_ref()
            .and_then(|m| m.get(name).cloned())
            .unwrap_or_default()
    }

    /// 事件字段 → DemoVariant（字符串进 arena，指针长期有效）
    fn variant_to_ffi(&self, v: &Variant) -> DemoVariant {
        match v {
            Variant::Bool(b) => DemoVariant { tag: DEMO_VAR_BOOL, value: DemoVarValue { b: *b as u8 } },
            Variant::I32(i) => DemoVariant { tag: DEMO_VAR_I32, value: DemoVarValue { i: *i } },
            Variant::U32(u) => DemoVariant { tag: DEMO_VAR_U32, value: DemoVarValue { u: *u } },
            Variant::U64(l) => DemoVariant { tag: DEMO_VAR_U64, value: DemoVarValue { l: *l } },
            Variant::F32(f) => DemoVariant { tag: DEMO_VAR_F32, value: DemoVarValue { f: *f } },
            Variant::String(s) => {
                let c = CString::new(s.replace('\0', " ")).unwrap_or_default();
                let ptr = c.as_ptr();
                self.event_str_arena.borrow_mut().push(c);
                DemoVariant { tag: DEMO_VAR_STR, value: DemoVarValue { s: ptr } }
            }
            // U64/字符串以外的容器类型（皮肤/输入历史等）当前加载器用不到
            _ => DemoVariant { tag: DEMO_VAR_NONE, value: DemoVarValue { b: 0 } },
        }
    }
}

// ---------------------------------------------------------------------------
// 导出函数（全部 catch_unwind）
// ---------------------------------------------------------------------------

/// 包裹导出函数体：catch_unwind 防跨 ABI panic。
/// body 是普通代码块（可用 `?`，错误须为 &'static str），整个块被包进 Ok()。
macro_rules! guard {
    ($default:expr, $body:expr) => {
        match std::panic::catch_unwind(AssertUnwindSafe(|| -> Result<_, &'static str> { Ok($body) })) {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                set_last_error(e);
                $default
            }
            Err(_) => {
                set_last_error("panic in cs2ffi export");
                $default
            }
        }
    };
}

/// 打开 demo（同步四趟解析，约 2~3s）。失败返回 NULL，用 demo_last_error 取原因。
#[no_mangle]
pub extern "C" fn demo_open(path: *const c_char) -> *mut DemoHandle {
    guard!(std::ptr::null_mut(), {
        if path.is_null() {
            return Err("path is null");
        }
        let path = unsafe { CStr::from_ptr(path) }.to_string_lossy().into_owned();
        let h = DemoHandle::open(&path).map_err(|e| {
            set_last_error(&e);
            "open failed"
        })?;
        Box::into_raw(h)
    })
}

/// 关闭并释放（NULL 安全）。
#[no_mangle]
pub extern "C" fn demo_close(h: *mut DemoHandle) {
    guard!((), {
        if !h.is_null() {
            unsafe { drop(Box::from_raw(h)) };
        }
    })
}

/// 取最后一次错误的说明（thread_local；指针仅到下次调用前有效）。
#[no_mangle]
pub extern "C" fn demo_last_error() -> *const c_char {
    LAST_ERROR.with(|e| e.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn demo_map_name(h: *const DemoHandle) -> *const c_char {
    guard!(std::ptr::null(), {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        h.map_name.as_ptr()
    })
}

/// 总 tick 数（player 趟 tick 列最大值）。
#[no_mangle]
pub extern "C" fn demo_max_tick(h: *const DemoHandle) -> i64 {
    guard!(-1, {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        h.max_tick
    })
}

/// 某趟的行数（= 每 tick × 每行实体数；tick 优先、实体其次，行序稳定）。
#[no_mangle]
pub extern "C" fn demo_col_len(h: *const DemoHandle, pass: u32) -> i64 {
    guard!(-1, {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let out = h.pass_out(pass).ok_or("bad pass")?;
        // 任取一列长度即可（各列等长）
        out.df.values().next().map(col_data_len).unwrap_or(-1)
    })
}

fn col_data_len(c: &parser::second_pass::variants::PropColumn) -> i64 {
    match &c.data {
        Some(VarVec::F32(d)) => d.len() as i64,
        Some(VarVec::I32(d)) => d.len() as i64,
        Some(VarVec::U32(d)) => d.len() as i64,
        Some(VarVec::U64(d)) => d.len() as i64,
        Some(VarVec::Bool(d)) => d.len() as i64,
        Some(VarVec::String(d)) => d.len() as i64,
        Some(VarVec::StringVec(d)) => d.len() as i64,
        Some(VarVec::U64Vec(d)) => d.len() as i64,
        Some(VarVec::U32Vec(d)) => d.len() as i64,
        Some(VarVec::XYVec(d)) => d.len() as i64,
        Some(VarVec::XYZVec(d)) => d.len() as i64,
        Some(VarVec::Stickers(d)) => d.len() as i64,
        Some(VarVec::InputHistory(d)) => d.len() as i64,
        Some(VarVec::UserCmdSubtickMoves(d)) => d.len() as i64,
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn demo_col_type(h: *const DemoHandle, pass: u32, name: *const c_char) -> u32 {
    guard!(DEMO_COL_MISSING, {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let out = h.pass_out(pass).ok_or("bad pass")?;
        let name = unsafe { CStr::from_ptr(name) }.to_string_lossy();
        find_prop(out, &name).map(|(_, c)| col_type_of(c)).unwrap_or(DEMO_COL_MISSING)
    })
}

#[no_mangle]
pub extern "C" fn demo_col_f32(h: *const DemoHandle, pass: u32, name: *const c_char) -> *const f32 {
    guard!(std::ptr::null(), {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let name = unsafe { CStr::from_ptr(name) }.to_string_lossy().into_owned();
        h.dense_f32(pass, &name).unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn demo_col_i32(h: *const DemoHandle, pass: u32, name: *const c_char) -> *const i32 {
    guard!(std::ptr::null(), {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let name = unsafe { CStr::from_ptr(name) }.to_string_lossy().into_owned();
        h.dense_i32(pass, &name).unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn demo_col_u32(h: *const DemoHandle, pass: u32, name: *const c_char) -> *const u32 {
    guard!(std::ptr::null(), {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let name = unsafe { CStr::from_ptr(name) }.to_string_lossy().into_owned();
        h.dense_u32(pass, &name).unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn demo_col_u64(h: *const DemoHandle, pass: u32, name: *const c_char) -> *const u64 {
    guard!(std::ptr::null(), {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let name = unsafe { CStr::from_ptr(name) }.to_string_lossy().into_owned();
        h.dense_u64(pass, &name).unwrap_or(std::ptr::null())
    })
}

/// 布尔列（0/1 数组）。
#[no_mangle]
pub extern "C" fn demo_col_u8(h: *const DemoHandle, pass: u32, name: *const c_char) -> *const u8 {
    guard!(std::ptr::null(), {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let name = unsafe { CStr::from_ptr(name) }.to_string_lossy().into_owned();
        h.dense_u8(pass, &name).unwrap_or(std::ptr::null())
    })
}

/// 字符串列按行取值（指针到 demo_close 前有效）。
#[no_mangle]
pub extern "C" fn demo_col_str(
    h: *const DemoHandle,
    pass: u32,
    name: *const c_char,
    index: i64,
) -> *const c_char {
    guard!(std::ptr::null(), {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        if index < 0 {
            return Err("index negative");
        }
        let name = unsafe { CStr::from_ptr(name) }.to_string_lossy().into_owned();
        h.col_str_at(pass, &name, index as usize).unwrap_or(std::ptr::null())
    })
}

// ---- 名册 ----

#[no_mangle]
pub extern "C" fn demo_roster_count(h: *const DemoHandle) -> i64 {
    guard!(-1, {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        h.roster.len() as i64
    })
}

/// 返回名册数组指针（demo_roster_count 个，指针到 demo_close 前有效）。
#[no_mangle]
pub extern "C" fn demo_roster(h: *const DemoHandle) -> *const DemoPlayerInfo {
    guard!(std::ptr::null(), {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        h.roster.as_ptr()
    })
}

// ---- 事件 ----

#[no_mangle]
pub extern "C" fn demo_event_count(h: *const DemoHandle, event_name: *const c_char) -> i64 {
    guard!(-1, {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let name = unsafe { CStr::from_ptr(event_name) }.to_string_lossy().into_owned();
        h.event_indices(&name).len() as i64
    })
}

/// 第 index 条该类事件的 tick。
#[no_mangle]
pub extern "C" fn demo_event_tick(
    h: *const DemoHandle,
    event_name: *const c_char,
    index: i64,
) -> i64 {
    guard!(-1, {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let name = unsafe { CStr::from_ptr(event_name) }.to_string_lossy().into_owned();
        let idx = h.event_indices(&name);
        let i = usize::try_from(index).map_err(|_| "bad index")?;
        let e = idx.get(i).ok_or("index out of range")?;
        h.events()[*e as usize].tick as i64
    })
}

/// 读事件字段。返回 1 = 找到（out 已写入），0 = 该字段不存在，-1 = 参数错误。
#[no_mangle]
pub extern "C" fn demo_event_field(
    h: *const DemoHandle,
    event_name: *const c_char,
    index: i64,
    field: *const c_char,
    out: *mut DemoVariant,
) -> i32 {
    guard!(-1, {
        let h = unsafe { h.as_ref() }.ok_or("null handle")?;
        let out = unsafe { out.as_mut() }.ok_or("null out")?;
        let name = unsafe { CStr::from_ptr(event_name) }.to_string_lossy().into_owned();
        let field = unsafe { CStr::from_ptr(field) }.to_string_lossy().into_owned();
        let idx = h.event_indices(&name);
        let i = usize::try_from(index).map_err(|_| "bad index")?;
        let e = idx.get(i).ok_or("index out of range")?;
        let ev = &h.events()[*e as usize];
        match ev.fields.iter().find(|f| f.name == field).and_then(|f| f.data.as_ref()) {
            Some(v) => {
                *out = h.variant_to_ffi(v);
                1
            }
            None => 0,
        }
    })
}
