# 04 — wasm 解析内核逆向

> 完整机器可读结果见 `wasm/report.json`。

## 产物

- 文件：`csplayer_parser_bg-qigVgicw.wasm`
- 大小：3 210 168 B（3.2 MB）
- 段结构：`1,2,3,4,5,6,7,9,10,11,0,0,0`（type/import/function/table/memory/global/export/element/code/data + 3 个自定义段）

## 关键发现：作者身份线索

wasm 的 producers/源码路径段**泄露了作者的开发机用户名**：

```
C:\Users\kenan\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\...
```

- 用户名：**`kenan`**（Windows 开发机）
- 这是本次逆向的最大增量——上一版没有任何作者线索

## 解析器源码结构（10 个文件）

```
vendor/parser/src/
├─ parse_demo.rs                  # 顶层入口
├─ first_pass/                    # 第一遍：结构扫描
│  ├─ parser.rs
│  ├─ prop_controller.rs          # 属性控制器
│  ├─ sendtables.rs               # 发送表
│  └─ stringtables.rs             # 字符串表
└─ second_pass/                   # 第二遍：数据提取
   ├─ parser.rs
   ├─ game_events.rs              # 游戏事件
   ├─ entities.rs                 # 实体
   ├─ variants.rs                 # 事件变体
   └─ collect_data.rs             # 聚合每帧 SoA
```

**两阶段架构**：first_pass 扫结构（实体 + 属性 + 字符串表），second_pass 提取回合事件与每帧数据。
这是典型的 Source2 demo 解析器设计。

## 工具链

| 项 | 值 |
| --- | --- |
| rustc | commit `58cf8f9c35b355199727627d07ae34a4e2846d67`（比上一版 1.93 新） |
| wasm-bindgen | 0.2.126（与上一版一致，工具链未升级） |
| serde-wasm-bindgen | 0.6.5 |

## 依赖 crate 清单

| crate | 版本 | 用途 |
| --- | --- | --- |
| bitter | 0.7.1 | **bit reader**（CS2 二进制位流解析核心） |
| phf_shared | 0.11.3 | 完美哈希（字符串表加速） |
| snap | 1.1.1 | Snappy 解压 |
| aho-corasick | 1.1.4 | 多模式字符串匹配 |
| regex / regex-automata / regex-syntax | 1.13.0 / 0.4.15 / 0.8.11 | 正则 |
| memchr | 2.8.3 | 字节搜索 |
| rayon / rayon-core | 1.12.0 / 1.13.0 | 并行（多线程解析） |
| crossbeam-epoch | 0.9.20 | 无锁并发 |
| ahash | 0.8.12 | 哈希 |
| bytes | 1.12.1 | 字节缓冲 |
| lazy_static | 1.5.0 | 惰性静态 |
| wasm-bindgen / serde-wasm-bindgen | 0.2.126 / 0.6.5 | JS 桥接 |

## 与上一版对比

| 项 | 10-22 版 | 11-03 版 |
| --- | --- | --- |
| name 段 | 未剥离（1 641 函数名） | **已剥离** |
| producers 段 | 有 | 有，泄露更多 |
| 作者用户名 | 无 | **`kenan`** |
| 源码文件数 | 部分 | **完整 10 个** |
| 依赖清单 | 部分 | **完整 16 个** |

## 结论

新版 wasm 虽然**剥离了 name 段**（减少了符号泄露），但 **producers/源码路径段反而泄露了更多**：
作者用户名 `kenan`、完整的 10 个源码文件路径、16 个依赖 crate 及其版本。
这意味着作者**没有完全清理 Rust 的 panic 路径字符串**（这些路径在 `#[track_caller]` 和 panic 信息里保留）。
