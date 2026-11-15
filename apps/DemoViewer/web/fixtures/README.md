# fixtures — CSDF v1 参照数据（**真实 demo 生成**）

> 早期这里是手写的**合成**假数据。现在由 `node tools/gen-fixture-from-demo.mjs`
> 从真实 `.dem` 解析生成，C++ 侧对照实现才有意义。

| 文件 | 内容 |
| --- | --- |
| `manifest.json` | 真实地图名、22 个回合、10 名玩家的真实 steamId/昵称/战队/配色、29 个武器名 |
| `segment-000.bin` | 一个时间窗的二进制正文（CSDF v1，小端，每块 64 字节对齐） |
| `segment-000.json` | 同一段的侧车：header、各块偏移/长度、首帧逐玩家原始值 |

## 本次生成的参数

- 来源：`test.dem`（87 MB，`PBDEMS2`，de_dust2，完美世界竞技平台天梯服务器）
- 窗口：ticks **0..1920**（前 30 秒 @ 64 Hz）→ **1 921 帧 × 10 人**
- panelFrames：**241 帧**（每 8 tick 一帧，与 frames 的 tick 集合不同）
- `flags = 0x0f`（三个可选列 + 面板全开）
- 总大小 **871 936 字节**，`crc32 = 0xe760d88b`

## 怎么用

1. **C++ 侧**：照 `tools/csdf-format.mjs` 的 header 定义与列顺序实现写出，然后用
   `node tools/validate-fixture-data.mjs fixtures/segment-000.bin` 自检。
2. **对齐校验**：`segment-000.json` 的 `sampleFrame` 是窗口第 0 帧的**逐玩家原始值**，
   可以逐字节对齐你的实现。
3. **改窗口重生成**：`node tools/gen-fixture-from-demo.mjs --start 200 --seconds 30`

## 格式要点（完整定义见 `tools/csdf-format.mjs` 与 `docs/07` 附录 A）

- 索引公式：`值 = 数组[帧序号 * numPlayers + 玩家序号]`
- `frameTick` 必须是**严格升序的绝对 tick 号**
- `yaw`/`pitch` 单位是**度**（`yaw` 归一化到 (-180, 180]）
- `steamId` 必须是**字符串**
- `team` 取值 **0 / 2 / 3**（0 = 该玩家未参与本回合）
- 每块起点 64 字节对齐
