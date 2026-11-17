// =============================================================================
// shim.h —— cs2ffi 的 C 接口声明（与 src/ffi.rs 手工保持一致）
//
// 生命周期约定：
//   - DemoHandle* 由 demo_open 创建、demo_close 释放；
//   - demo_map_name / demo_col_* / demo_roster 返回的指针到 demo_close 前有效；
//   - demo_last_error 返回的指针到下一次任何 cs2ffi 调用前有效；
//   - 数值列在首次访问时做稠密化缓存（demoparser 列为 Option<T>，此处已展开）：
//       Option::None → f32 列填 NaN，整数列填 0，bool 列填 0。
// =============================================================================

#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// 不透明句柄
typedef struct DemoHandle DemoHandle;

// 通行类别（demo_col_* 的 pass 参数）
enum DemoPass {
    DEMO_PASS_PLAYER  = 0,  // 玩家每 tick 列（X/Y/Z/pitch/yaw/is_alive/health/...）
    DEMO_PASS_WEAPON  = 1,  // 武器实体每 tick 列（m_iClip1/m_pReserveAmmo/weapon/x/y/z/...）
    DEMO_PASS_GRENADE = 2,  // 投掷物每 tick 列
};

// 列类型（demo_col_type 返回值）
enum DemoColType {
    DEMO_COL_F32     = 0,
    DEMO_COL_I32     = 1,
    DEMO_COL_U32     = 2,
    DEMO_COL_U64     = 3,
    DEMO_COL_U8      = 4,   // bool
    DEMO_COL_STR     = 5,
    DEMO_COL_MISSING = 6,   // 该趟没有这个列
};

// 事件字段值（demo_event_field 的 out 参数）
enum DemoVarTag {
    DEMO_VAR_NONE = 0,
    DEMO_VAR_BOOL = 1,
    DEMO_VAR_I32  = 2,
    DEMO_VAR_U32  = 3,
    DEMO_VAR_U64  = 4,
    DEMO_VAR_F32  = 5,
    DEMO_VAR_STR  = 6,
};

typedef union DemoVarValue {
    uint8_t  b;
    int32_t  i;
    uint32_t u;
    uint64_t l;
    float    f;
    const char* s;  // 到 demo_close 前有效
} DemoVarValue;

typedef struct DemoVariant {
    uint32_t     tag;    // DemoVarTag
    DemoVarValue value;
} DemoVariant;

typedef struct DemoPlayerInfo {
    const char* name;      // 到 demo_close 前有效
    uint64_t    steamid;
    int32_t     team;      // 2=T 3=CT（CS2 约定）
} DemoPlayerInfo;

// ---- 生命周期 ----

// 打开 demo（同步四趟解析，约 2~3 秒）。失败返回 NULL（用 demo_last_error 取原因）。
DemoHandle* demo_open(const char* path);
void        demo_close(DemoHandle* h);
const char* demo_last_error(void);

// ---- 元信息 ----

const char* demo_map_name(const DemoHandle* h);
int64_t     demo_max_tick(const DemoHandle* h);

// ---- tick 列（行序：tick 优先、实体其次；各列等长）----

int64_t demo_col_len(const DemoHandle* h, int pass);
int     demo_col_type(const DemoHandle* h, int pass, const char* name);
const float*    demo_col_f32(const DemoHandle* h, int pass, const char* name);
const int32_t*  demo_col_i32(const DemoHandle* h, int pass, const char* name);
const uint32_t* demo_col_u32(const DemoHandle* h, int pass, const char* name);
const uint64_t* demo_col_u64(const DemoHandle* h, int pass, const char* name);
const uint8_t*  demo_col_u8(const DemoHandle* h, int pass, const char* name);
// 字符串列按行取（越界返回 NULL）
const char* demo_col_str(const DemoHandle* h, int pass, const char* name, int64_t index);

// ---- 名册 ----

int64_t demo_roster_count(const DemoHandle* h);
const DemoPlayerInfo* demo_roster(const DemoHandle* h);

// ---- 游戏事件 ----

int64_t demo_event_count(const DemoHandle* h, const char* event_name);
int64_t demo_event_tick(const DemoHandle* h, const char* event_name, int64_t index);
// 返回 1=找到（out 已写入）0=该字段不存在 -1=参数错误
int  demo_event_field(const DemoHandle* h, const char* event_name, int64_t index,
                      const char* field, DemoVariant* out);

#ifdef __cplusplus
}
#endif
