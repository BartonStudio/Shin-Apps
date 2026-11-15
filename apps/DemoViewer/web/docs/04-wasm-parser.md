# 04 — wasm 解析内核逆向（2026-11-09 修订版）

> 完整机器可读结果：`wasm/report.json`（由 `node tools/analyze-wasm.mjs` 生成，可复现）
>
> **本文件已重写**。原版有两处方向性错误（见文末「修订记录」），会误导对解析链的理解。

---

## 一、产物与段结构

| 项 | 值 |
| --- | --- |
| 文件 | `csplayer_parser_bg-qigVgicw.wasm` |
| 大小 | 3 210 168 B（3.2 MB） |
| 段序列 | `1,2,3,4,5,6,7,9,10,11,0,0,0` |
| 自定义段 | `name`(228 922 B) · `producers`(124 B) · `target_features`(148 B) |
| `code` 段 | 1 814 355 B |
| `data` 段 | 1 161 464 B |

---

## 二、⚠️ 关键更正：`name` 段**没有被剥离**

原版 `docs/04` 与 `docs/02` 都写"name 段已剥离（作者做了 size 优化）"。**这是错的。**

实测（可复现）：

```
name 段存在:  true
name 段大小:  228 922 字节
模块名:       csplayer_parser.wasm
函数名总数:   1 655
  其中 wasm-bindgen 胶水: 38
  其中作者 Rust 符号:     1 617   ← 全部是完整 demangle 的符号
```

### 2.1 泄露出来的真实模块结构

从这 1 617 个符号可以直接读出解析器的内部架构：

```
parser::first_pass::parser_settings::FirstPassParser
    ::parse_demo / parse_sendtable / parse_string_table
parser::first_pass::prop_controller::PropController
    ::new / handle_prop
parser::second_pass::parser_settings::SecondPassParser
    ::parse_packet_from_bitreader / parse_packet_ents / decode_entity_update
    ::collect_entities / update_entity / emit_events / create_output / parse_paths
    ::create_custom_event_fire_bullets
parser::second_pass::parser::SecondPassOutput        ← 输出类型在这里
parser::parse_demo::Parser
    ::parse_demo / combine_outputs / combine_dfs / rm_unwanted_ticks
csplayer_parser::{parse_header, parse_events, parse_effects, parse_round_stream,
                  parseTimeline, timeline_value, round_chunk_value,
                  to_strings, og_name_map, err, DemoInput}
```

> **注意模块名是 `parser_settings`，不是 `parser`**。原版 `docs/04` 把源码文件列表写成
> `first_pass/parser.rs` / `second_pass/parser.rs`，实际符号里的模块路径是
> `first_pass::parser_settings` / `second_pass::parser_settings`（文件里定义了名为
> `parser_settings` 的模块）。

### 2.2 自有源码 10 个文件（路径确证）

```
vendor/parser/src/
├─ parse_demo.rs
├─ first_pass/
│   ├─ parser.rs
│   ├─ prop_controller.rs
│   ├─ sendtables.rs
│   └─ stringtables.rs
└─ second_pass/
    ├─ parser.rs
    ├─ collect_data.rs
    ├─ entities.rs
    ├─ game_events.rs
    └─ variants.rs
```

`first_pass` 与 `second_pass` 的**分工**（由符号语义确证）：

| 阶段 | 模块 | 干什么 |
| --- | --- | --- |
| 第一遍 | `FirstPassParser` | 扫结构：`parse_sendtable`（实体网络表）、`parse_string_table`、`PropController::handle_prop`（属性定义） |
| 第二遍 | `SecondPassParser` | 提数据：`decode_entity_update`（增量实体解码）、`parse_packet_ents`、`emit_events`（游戏事件）、`collect_entities`、`create_output` |
| 收尾 | `parse_demo::Parser` | `combine_outputs`（拼各线程输出）、`combine_dfs`、`rm_unwanted_ticks`（过滤不要的 tick） |

---

## 三、依赖清单（原版漏了 protobuf 栈）

### 3.1 有版本号路径的 18 个 crate（源码路径确证）

| crate | 版本 | 用途 |
| --- | --- | --- |
| `bitter` | 0.7.1 | **bit reader** —— CS2 二进制位流解析核心 |
| `snap` | 1.1.1 | Snappy 解压（demo 包体压缩） |
| `phf_shared` | 0.11.3 | 完美哈希（字符串表加速） |
| `aho-corasick` | 1.1.4 | 多模式字符串匹配 |
| `memchr` | 2.8.3 | 字节搜索 |
| `regex` / `regex-automata` / `regex-syntax` | 1.13.0 / 0.4.15 / 0.8.11 | 正则 |
| `rayon` / `rayon-core` | 1.12.0 / 1.13.0 | 并行（原生多线程；wasm 下单线程） |
| `crossbeam-epoch` | 0.9.20 | 无锁并发 |
| `ahash` | 0.8.12 | 快速哈希 |
| `hashbrown` | 0.17.1 | HashMap 底层（**原版漏记**） |
| `dlmalloc` | 0.2.14 | wasm 分配器（**原版漏记**） |
| `bytes` | 1.12.1 | 字节缓冲 |
| `lazy_static` | 1.5.0 | 惰性静态 |
| `wasm-bindgen` | 0.2.126 | JS 桥接（与上一版一致，工具链未升级） |
| `serde-wasm-bindgen` | 0.6.5 | 结构体 → JS 值 |

> **原版为什么少了 2 个**：`tools/analyze-wasm.mjs` 旧版只匹配
> `index.crates.io-…\…\src\`（**反斜杠** + registry 前缀）。`hashbrown` 与 `dlmalloc`
> 的路径用的是正斜杠且不带 registry 前缀，所以被漏掉。已修正。

### 3.2 🔴 protobuf 栈：`csgoproto` + `prost`（原版完全没记录）

这是**整个解析链最核心的缺失项**——CS2 demo 本身就是 protobuf 流。

**实证**（不是猜的，来自完整 trait impl 路径）：

```
<csgoproto[f9caf4cec9772a19]::protobuf::CDemoPacket      as prost[a869a182f288c193]::message::Message>::decode
<csgoproto[...]::protobuf::CDemoFullPacket              as prost[...]::message::Message>
<csgoproto[...]::protobuf::CsvcMsgCreateStringTable     as prost[...]::message::Message>
<csgoproto[...]::protobuf::CsvcMsgUpdateStringTable     as prost[...]::message::Message>
<csgoproto[...]::protobuf::CsvcMsgGameEventList         as prost[...]::message::Message>
<csgoproto[...]::protobuf::CsgoUserCmdPb                as prost[...]::message::Message>
```

含义：

| crate | 作用 |
| --- | --- |
| **`csgoproto`** | CS2/CS:GO 的 protobuf **消息定义**（`CDemoPacket`、`CDemoFullPacket`、`CsvcMsgCreateStringTable`、`CsvcMsgUpdateStringTable`、`CsvcMsgGameEventList`、`CsgoUserCmdPb` 等） |
| **`prost`** | protobuf **编解码器**（`Message::decode` / `merge_field` / `merge_repeated`） |

> 也就是说：**解析链是「bit reader(bitter) → protobuf 解帧(prost + csgoproto) → Snappy 解压(snap) → 实体增量解码」**。
> 原版文档只讲了 bitter 和 snap，**跳过了 protobuf 这一层**，导致对"数据怎么从字节变实体"的理解缺了一环。

### 3.3 符号里还出现、但无源码路径的命名空间

`wasm/report.json` 的 `symbolNamespaces` 字段列出了全部候选及出现次数。**注意**：
wasm data 段的字符串没有 NUL 分隔，长度前缀字节会粘在名字前面（`0x61='a'` 紧贴 `core` → 抽成
`acore`），所以该字段**含噪声，不能当依赖清单用**。权威清单请看 `registryDepVersions` 与
`protobufStack`。

其中可确认为真实存在的还有：`core` / `alloc` / `std`（Rust 标准库）、`hashbrown`、
`once_cell`、`phf`、`crossbeam_utils`、`getrandom`、`serde_core`。

---

## 四、工具链

| 项 | 值 |
| --- | --- |
| rustc commit | `58cf8f9c35b355199727627d07ae34a4e2846d67` |
| wasm-bindgen | 0.2.126（两版一致，工具链未升级） |
| wasm-bindgen hash | `5663806b8b774ddf` / `acbe69b831453cec` |
| 模块名 | `csplayer_parser.wasm` |

---

## 五、作者身份线索

`producers` / panic 路径里保留了 Rust 的源码位置字符串，泄露了开发机用户名：

```
C:\Users\kenan\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\...
```

- 用户名 **`kenan`**（Windows 开发机），全库出现 **85 处**
- 原因：作者没有清理 `#[track_caller]` / panic 信息里的源码路径

---

## 六、导出面：25 个导出，应用面 14 个

| 导出 | 类别 | 应用是否使用 |
| --- | --- | --- |
| `memory` | 内存 | — |
| `demoinput_new` / `demoinput_length` / `__wbg_demoinput_free` | 对象生命周期 | ✅ |
| `demoinput_parseHeader` / `parseHeader` | 元数据 | ✅ |
| `demoinput_parseEvents` / `parseEvents` | 事件流 | ✅ |
| `demoinput_parseRoundStream` / `parseRoundStream` | 降采样回合流 | ✅ |
| **`parseTicks`** | **全量 per-tick 查询（不降采样）** | ❌ **未使用** |
| **`parseTimeline`** | 回合时间线 | ❌ 未使用 |
| **`parseGrenades`** | 投掷物 | ❌ 未使用 |
| **`parseGrenadeEffects`** | 投掷物效果区 | ❌ 未使用 |
| **`parseSmokeVoxels`** | 烟雾体素 | ❌ 未使用 |
| **`demoinput_write`** | 语义未知（全站无调用） | ❌ 未使用 |
| `__wbindgen_malloc` / `__wbindgen_realloc` / `__wbindgen_exn_store` / `__externref_table_*` / `__wbindgen_start` / `__abort_handler` / `__instance_terminated` | wasm-bindgen 运行时 | — |

> **`parseTicks` 存在但应用不用**，这是重要事实：demoparser 原生的全量通道已经在你的 wasm 里，
> 只是应用选择了降采样的 `parseRoundStream`（16/32/64 Hz）。详见 `docs/07` 附录 B 与 P5 性能工作。

---

## 七、与上一版（2026-10-22）的对比：原版结论方向是反的

原版 `docs/02` 的对比表写：

| 项 | 10-22 版 | 11-03 版（原版结论） |
| --- | --- | --- |
| name 段 | 未剥离（1 641 函数名） | **已剥离** |
| wasm 泄露信息 | 1 641 函数名 + 110 Rust 符号 | 作者用户名 `kenan` + 10 源码路径 + 16 依赖 |

**正确结论**：

| 项 | 10-22 版 | 11-03 版（实测） |
| --- | --- | --- |
| name 段 | 未剥离 | **仍未剥离**（228 922 B / 1 655 函数名） |
| 函数名数 | 1 641 | **1 655**（略增） |
| 作者符号 | 有 | **1 617 个**（不是 110） |
| 依赖 | 16 | **18 个带版号 + protobuf 栈** |

所以 11-03 版**不是"为了 size 优化剥离了 name 段"**，而是**什么都没剥离，且泄露更多**。

---

## 八、修订记录

| 日期 | 修正内容 |
| --- | --- |
| 2026-11-09 | ① 更正「name 段已剥离」→ **未剥离**（228 922 B、1 655 函数名、1 617 作者符号）<br>② 补全依赖：18 个带版号 crate（原 16，漏 `hashbrown`/`dlmalloc`）+ **protobuf 栈 `csgoproto`+`prost`**（原版完全未记录）<br>③ 更正自有模块名 `parser_settings`（原写 `parser`）<br>④ 补全导出面 25 个（原版未列）<br>⑤ 更正 `docs/02` 对比表方向<br>⑥ 分析脚本 `tools/analyze-wasm.mjs` 重写，`wasm/report.json` 重新生成 |
