# CS2 Demo 裁剪与重写 · 可行性调研与架构设计

> 目标：从一份完整 `.dem` 中裁剪出 `[startTick, endTick)` 区间，生成一份**能独立播放的新 `.dem`**。
> 首个用例：`1850-1853.dem`（75 MB，PBDEMS2）裁剪 18:30–18:53 的 23 秒。

| 项 | 内容 |
| --- | --- |
| 版本 | v0.1 |
| 日期 | 2026-11-06 |
| 状态 | 调研完成，待评审 |
| 前置 | 已装 Go 1.27.3（用户目录 `C:/Users/barton/go`，已写入 `.bashrc`） |

---

## 1. 结论先行

1. **可行，且比最初估计的成本低**——因为找到了三块现成轮子，核心难点收窄为"一个"。
2. **必须纠正一个认知**：csdemo.tv 前端**不读 `.dem`**，它读 wasm 解析出的结构化 SoA。所以"让前端播放"和"生成真 `.dem`"是**两个独立目标**，本方案只解决后者。
3. **真正的核心难题只有一个**：裁剪点 `startTick` 处必须**重建一个完整状态快照帧**（`DEM_FullPacket` / stringtable snapshot + 全实体 full update），否则新 `.dem` 无法独立播放。
4. 用户已具备"**逐帧重放还原全实体完整现场**"的能力，这恰好绕过了最难的"从增量流推导全量状态"，使整个工程退化为"**把全量状态编码回合法 netmessage**"。

---

## 2. 背景：为什么 `.dem` 不能像视频那样直接切

CS2 demo（Source 2 `PBDEMS2`）是**增量状态流**：

- 每帧只记录**相对上一帧的变化**（实体创建/更新/删除、字段 delta），依赖从第 0 tick 累积的完整状态。
- 直接切中间 23 秒字节 → 前面 18 分钟累积的实体表/字符串表/发送表状态全部缺失 → 客户端 `Failed to parse message`。

因此裁剪的**唯一正确做法**是：

```
完整解析 0 → endTick（累积出 endTick 时的完整状态）
    → 取 [startTick, endTick) 区间内的帧
    → 在 startTick 处重建"完整状态快照帧"作为新的第 0 帧
    → 重排 tick、重写 header、重新封装、输出新 .dem
```

---

## 3. CS2 Demo 文件格式（精确）

来源：pbdems2 官方文档 + cs2.samh.dev 协议指南（已交叉验证）。

### 3.1 固定文件头（16 字节）

| 偏移 | 大小 | 编码 | 含义 |
| --- | --- | --- | --- |
| 0 | 8 | ASCII | 魔数 `PBDEMS2\0` |
| 8 | 4 | LE u32 | `DEM_FileInfo` 的绝对偏移（0 表示无） |
| 12 | 4 | LE u32 | `DEM_SpawnGroups` 的绝对偏移（0 表示无） |

### 3.2 命令帧（自字节 16 起，无填充连续排列）

```
[uvarint32] command ID | 压缩标志（bit 0x40 = 64）
[uvarint32] demo tick（i32）
[uvarint32] body 长度（编码后字节数）
[bytes]    body（protobuf 或 raw-Snappy 压缩）
```

- 压缩标志是 **bit 0x40**；读时 `cmd = raw & !64`。
- 压缩用 **raw Snappy**（注意：不是 Snappy "frame" 格式，两者不同）。
- body 解压后的尺寸需先校验再分配。

### 3.3 命令 ID（`EDemoCommands`）

| ID | 命令 | 作用 |
| --- | --- | --- |
| 0 | `DEM_Stop` | 流结束 |
| 1 | `DEM_FileHeader` | 录制元数据 |
| 2 | `DEM_FileInfo` | 播放摘要 / footer |
| 3 | `DEM_SyncTick` | signon 与 play 的分界 |
| 4 | `DEM_SendTables` | 扁平化序列化器定义 |
| 5 | `DEM_ClassInfo` | 实体类名映射 |
| 6 | `DEM_StringTables` | 字符串表完整快照 |
| 7 | `DEM_Packet` | 一个播放 tick 的网络消息 |
| 8 | `DEM_SignonPacket` | signon 阶段的网络消息 |
| 13 | `DEM_FullPacket` | **字符串表快照 + packet 关键帧** |
| 14 | `DEM_SaveGame` | 嵌入存档 |
| 15 | `DEM_SpawnGroups` | 出生组状态 |

**裁剪最关键的两个命令**：`DEM_StringTables` / `DEM_FullPacket`（承载完整快照），`DEM_SendTables` / `DEM_ClassInfo`（承载实体解码所需的表定义，必须保留）。

### 3.4 tick 语义

- 64 tick/秒（CS2 固定）。
- signon 阶段帧的 tick 为 `4294967295`（2³²−1），表示"时间开始前"。
- 帧 tick 单调不递减。

---

## 4. 三块可复用轮子

| 轮子 | 语言 | 解决什么 | 是否含"写" |
| --- | --- | --- | --- |
| **pbdems2** | Rust | PBDEMS2 容器读写、命令 framing、Snappy、格式权威文档 | 只读（`Demo`/`DemoParser`/`PlaybackSession`），**无 writer** |
| **demoinfocs-golang** | Go | 完整 CS2 解析 + `pkg/demoinfocs/msg/*.pb.go` 生成 protobuf 类型（**编解码双向**） | protobuf 层双向；但 demo 文件层只读 |
| **unicbm/cs2-demo-playback-fix-260720** | JS/WASM + 参考 C 工具 | 已证明"读→精确重写 netmessage 帧→输出可播放 demo"这条路**可行且可验证** | 重写（但只删/留帧，不裁剪） |

**关键判断**：

- **pbdems2** 提供了最清晰的**格式规格**和"读框架"，是理解 framing/压缩/偏移的权威参照。但它是 Rust 且不写。
- **demoinfocs-golang** 的 `.pb.go` 意味着**每个 netmessage 的序列化逻辑已现成**（`proto.Marshal` 即可编码），这是"重编码"最大的一块，**不用自己写**。
- **unicbm 的 fix 工具**证明了：只要帧结构、tick、压缩、payload 字节都对，客户端就能播。这是可行性锚点。

**结论**：不需要从零逆向。需要自研的只是**"编排层"**（怎么把已有的状态 + 现成的 protobuf 编码，拼成一个合法的、能独立播放的 `.dem`）。

---

## 5. 核心难题：startTick 处的完整快照重建

这是整个工程唯一有实质难度、且没有现成答案的部分。

### 5.1 问题

新 `.dem` 的第一帧（即原 `startTick`）必须让客户端能**从零建立完整世界**。这意味着要重建：

1. **StringTables 完整快照**（`DEM_StringTables` / `DEM_FullPacket` 里的 snapshot）——玩家 userinfo、模型、武器、皮肤、precache 表等。
2. **全实体完整状态**（`DEM_FullPacket` 里的 full update）——每个存活实体的所有字段（位置、朝向、血量、装备、投掷物、C4、门等）。
3. **SendTables / ClassInfo**——实体解码依赖的表定义，通常从原文件头直接拷贝即可。

### 5.2 用户能力如何化解难度

用户已具备"**逐帧重放还原全实体完整现场**"能力，即：

> 用户能在内存里得到任意 tick 的**全量、非增量**实体状态（玩家 + 手雷/烟雾/掉落武器/炸弹/弹道等所有实体）。

这意味着：

- 第 5.1 节的"全实体完整状态"**用户已经算出来了**，不需要从增量流反推。
- 剩下的只是**把这份全量状态，用 demoinfocs 的 protobuf 类型重新编码成 `CSVCMsg_PacketEntities`（full update 形式）+ `CDemoStringTables`（snapshot 形式）**。

于是"最难的部分"从"逆向状态"变成"**状态 → protobuf 编码**"，后者是干净的工程活。

### 5.3 仍需攻克的具体子问题

1. **full update 的字段编码**：`CSVCMsg_PacketEntities` 的 `is_delta=false` 路径要输出**每个实体每个字段的完整值**（而非 delta）。demoinfocs 的解码侧有 `sendtables` 机制，但**编码侧没有现成的"全字段写出"**——需要遍历 serializer 字段树、按类型写 bit 流。这是自研量最大的点。
2. **snapshot 的 stringtable 编码**：`CDemoStringTables` 的 snapshot 要按 stringtable 的 protobuf 结构重新编码，demoinfocs 有 stringtable 解码，编码侧同样要补。
3. **tick 重排**：新 demo 的第一帧 tick 要设成"时间原点"，后续帧 tick 减去 startTick；signon 帧的 `4294967295` 语义要正确处理。
4. **FileHeader/FileInfo 重写**：`DEM_FileHeader`（map 名、协议版本、播放时长、tick 数）和 `DEM_FileInfo`（footer 的播放摘要）都要重算；header 里 `file_info_offset` 指针要更新。
5. **SpawnGroups**：CS2 若用了 spawn groups（header 里有非零偏移），也要重写。

---

## 6. 分阶段实施路线图

### 阶段 0：格式探查（1–2 天，先做，验证一切假设）

用 demoinfocs（或 pbdems2 思路）写一个**探查器**，对 `1850-1853.dem` 输出：

- header（两个 offset）、FileHeader 内容（map、协议版本、demo 版本）
- 各命令的分布：有多少 `DEM_StringTables` / `DEM_FullPacket` / `DEM_SendTables` / `DEM_SpawnGroups`
- tick 范围、总 tick 数、tickRate
- **18:30 和 18:53 对应的确切 tick 号**（tick = 秒 × 64；18:30 → tick `18*60+30` × 64 = 71040，18:53 → 72512，待探查确认）
- 最近一个 `DEM_FullPacket` 在 18:30 之前的位置（这决定了快照的"原材料"来源）

**产出**：一份 `1850-1853.dem` 的结构剖析报告 + 确认裁剪 tick 号。

### 阶段 1：最小闭环（"删帧式"重写，1 周）

先做 unicbm 那种"**读→过滤/重排帧→写**"的最小实现，证明**写入管线**通：

- 用 demoinfocs 读每个 command frame（cmd/tick/body）
- 只保留 `[startTick, endTick)` 的帧 + 必要的表定义帧（SendTables/ClassInfo/StringTables/FileHeader）
- 重排 tick、重写 FileHeader/FileInfo、写 header offset
- **输出一个新的 .dem，先用 `playdemo` 在游戏里验证能否播**（不追求画面正确，只求不崩）

**产出**：一个能写 `.dem` 的最小 writer + 验证脚本。此阶段**不解决快照重建**，产物预期"能播但 startTick 处状态错误"——用于验证管线。

### 阶段 2：快照重建（核心，2–4 周）

- 用**用户的重放引擎**在 startTick 处产出"全实体完整现场"
- 实现"全量状态 → full update + snapshot"的编码器（自研量最大的点）
- 与阶段 1 的管线拼接

**产出**：真正能独立播放、画面正确的裁剪 `.dem`。

### 阶段 3：鲁棒性（持续）

- 处理边界：空区间、跨回合、signon 特殊 tick、SpawnGroups
- 处理不同 demo 版本、GOTV vs POV
- 跟随 Valve 更新回归测试

---

## 7. 工作量重估（相对最初判断）

| 范围 | 最初判断 | 现在 | 依据 |
| --- | --- | --- | --- |
| 框架/压缩/偏移 | 逆向 | **复用 pbdems2 规格，自研 writer** | 格式已文档化 |
| netmessage protobuf 编解码 | 逆向 | **复用 demoinfocs .pb.go** | 序列化已现成 |
| "读→写→可播"可行性 | 不确定 | **已由 unicbm 证明** | 有锚点 |
| **full snapshot 编码（自研）** | 未单独评估 | **2–4 周，核心难点** | 无现成"全字段写出" |
| **总计（最小可用）** | 2–4 周 | **3–5 周**（阶段 0+1 约 1 周，阶段 2 约 2–4 周） | — |

> 注：阶段 1（删帧式重写）本身有独立价值——即使不做裁剪，也能做"demo 修复/瘦身/去敏感帧"，可作为 DemoViewer 的第一个落地能力。

---

## 8. 技术选型建议

| 项 | 建议 | 理由 |
| --- | --- | --- |
| 主语言 | **Go**（demoinfocs-golang） | 唯一的 CS2 解析 + 双向 protobuf 库，Go 1.27 已装 |
| 格式参照 | pbdems2（Rust，只读规格） | 权威 framing 文档，不直接依赖 |
| 快照编码 | 自研（Go，复用 `.pb.go`） | 唯一无现成方案的部分 |
| 验证 | 游戏客户端 `playdemo` + demoinfocs 回读比对 | 双保险 |

### 与现有 C++ 内核的关系

PRD 明确 DemoViewer 是 **C++ 内核 + WebView2**。裁剪器建议做成**独立 Go 子进程**（CLI），C++ 内核通过进程调用；理由：

- demoinfocs-golang 是 Go 库，无 C++ 绑定；重写 C++ 成本远高于起一个 Go 侧进程。
- 裁剪是**离线批处理**（不是播放热路径），进程边界开销可忽略。
- 未来可做成常驻服务或导出 `.dem` 的独立工具。

---

## 9. 风险与未知

1. **full update 的"全字段写出"是最大不确定点**——demoinfocs 解码侧有完整的 serializer 遍历，但**编码侧要从零写**，字段类型矩阵（int/float/bool/string/vector/angle/嵌套/数组）全都要覆盖，容易漏。
2. **Valve 更新会变 netmessage schema**——重编码依赖特定 demo 版本的 schema，跨版本需回归。
3. **旧 demo 兼容**——2026-07 前后 CS2 更新导致部分 demo 的 netmessage 变了（unicbm 的 type 138 案例），裁剪器对旧 demo 可能需额外处理。
4. **快照重建的"正确性"验证成本**——即使能播，画面是否与原 demo 一致（尤其物理/动画/投掷物轨迹）需逐项比对。
5. **用户重放引擎的"完整现场"与 demoinfocs 实体模型的对齐**——两者对实体的字段集合/命名要一致，否则编码会缺字段。

---

## 10. 下一步（建议立即做）

1. **阶段 0：写探查器**，对 `1850-1853.dem` 产出结构剖析，确认裁剪 tick、快照帧位置、是否有 SpawnGroups。
2. 基于探查结果，**冻结阶段 1 的最小 writer 设计**（帧过滤 + tick 重排 + header 重写）。
3. 与用户的重放引擎**对接"完整现场"的数据结构**，评估快照编码器的输入形态。

> 附：Go 环境已就绪（`C:/Users/barton/go`，Go 1.27.3，已写入 `~/.bashrc` 的 `GOROOT`/`GOPATH`）。choco 安装失败（需管理员权限），改用官方 zip 免安装方式装到用户目录。
