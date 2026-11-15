# 03 — 播放流水线：从 .dem 到第一帧

> 结论每条都带 bundle 行号（`decompiled/index.beautified.js`）。

## 完整链路

```
用户拖入 .dem
   │
   ▼
AppShell 拖放处理（bundle 51289 是 `<input type="file" accept=".dem">`；51621 起注册 dragenter/dragover）
   │
   ▼
file.arrayBuffer() 读进内存
   │
   ▼
算缓存键 = sha256(file) + 采样率
   │
   ├─ IndexedDB 命中（库 csplayer）→ 直接拿解析结果对象，跳过 wasm
   │
   └─ 未命中 → ArrayBuffer 转移给 parser.worker（postMessage transfer）
        │
        ▼
     WebAssembly.instantiateStreaming('csplayer_parser_bg-qigVgicw.wasm')
        │
        ▼
     DemoInput 流式解析：
       parseHeader → 元数据（地图/玩家/回合/tickRate）
       first_pass  → 结构扫描（sendtables/stringtables/prop_controller）
       second_pass → 回合事件 + 每帧 SoA 数据
        │
        ├─ {type:'ready'}  → 主线程立即建 Player，播第 1 回合
        └─ {type:'round'} → 后续回合增量回填（smoothRoundBackfill）
   │
   ▼
主线程 Player：每帧采样 SoA → 相邻帧线性插值（yaw 走最短弧）
   │
   ▼
three.js r184 渲染（InstancedMesh 玩家 / 烟雾体素 / 弹道 / 地图 GLB）
```

## 关键实现细节

### 1. 采样率与缓存键

- 三档：16 Hz（Fast）、32 Hz（Balanced，默认）、64 Hz（Precise）— bundle 52981-52983
- **采样率只决定输出体积 / 内存占用 / 缓存键，不决定解析耗时**：
  实体状态是 delta 编码（`svc_PacketEntities` 只发变化量），要得到 tick N 的状态必须处理
  0..N 的所有实体更新，所以三档的解析耗时几乎相同。这是**内存/画质的权衡旋钮，不是性能旋钮**。
- 缓存键把采样率算进去，所以同一份 demo 的 16/32/64 Hz 三档解析结果各存一份。

### 2. SoA 帧数据结构

每帧是多个并列的 typed array：`posX/posY/posZ/yaw/pitch/health/alive/team/duck/flash/...`，
主线程在相邻采样帧之间做线性插值，yaw 角走最短弧。

### 3. 边解析边播

- 第 1 回合解析完就 `postMessage({type:'ready'})`，主线程立刻建 Player
- 后续回合 `{type:'round'}` 增量回填
- 播放头追上新数据时挂起（`smoothRoundBackfill`）

### 4. 地图加载

- 地图几何不是实时读 VPK，而是从 `maps.csdemo.tv/cs2/` 下载 meshopt 压缩 GLB
- `mapGeometry.worker-BGvfBalF.js` 里解码
- `overview.txt` 解析成雷达坐标映射（bundle 28939-28942 取文件、28978 解析、28990 建 URL）

### 5. 托管场次（职业比赛）

- 从 `data.csdemo.tv/catalogue/v2/current.json` 拿目录指针 → generation → 完整 events
- 下载已解析的 `.csda`（gzip + `CSDA` 容器 + 分块 sha256）
- 浏览器只做校验 + 解码，不跑 wasm

## 渲染管线组件（应用层切片对应）

| 切片 | 组件 | 作用 |
| --- | --- | --- |
| 16 | scene-renderer | WebGLRenderer、静态阴影、大气、filmic 对比度 |
| 04/05 | lighting | 自研 GGX 光照 + 环境采样 |
| 07/08 | physics | 自研刚体物理（角色 ragdoll、轨迹碰撞） |
| 17/18 | smoke | 烟雾体素 + 体积渲染 |
| 12/13 | fire | 燃烧瓶火墙 |
| 14 | blast | 爆炸/闪光 |
| 21 | tracers | 弹道曳光 |
| 10/11 | character | 角色模型 + 胶囊兜底 |
