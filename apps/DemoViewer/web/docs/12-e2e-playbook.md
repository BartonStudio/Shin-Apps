# 端到端链路实操手册 —— JS 解析 → C++ 构造 DemoData → 前端读 → 播放

> 这份文档教**怎么亲手把整条链路跑起来**，以及**怎么把其中的 JS 解析换成你自己的 C++ 解析器**。
>
> 如果你只想看"这条链路验证过什么"，见 `08-cpp-integration.md` 附录 H（那是验证报告）。
> **本文是操作手册** —— 每一步都有可复制的命令和成功判据。

---

## 一、先分清两条路

| | 数据来源 | 用途 | 谁跑 |
| --- | --- | --- | --- |
| **路 A（本手册）** | 原 JS 解析真实 `.dem` | **验证接口层**：证明 C++ 的 `DemoData` 装得下真实数据、布局与 JS 对齐、渲染器能播 | 现在就能跑 |
| **路 B（生产）** | 你自己的 C++ 解析器 | 实际出货 | 你写解析器之后 |

**两条路只在「DemoData 从哪来」这一步不同，其余完全相同。**

```
路 A：  dem ──JS解析──► data ──序列化──► 镜像文件 ──C++读──► DemoData ──C++写──► 镜像文件 ──JS读──► 播放
路 B：  dem ────────你自己的 C++ 解析器───────► DemoData ──C++写──► 共享内存 ──JS读──► 播放
                                                    ↑
                                    第 6 节告诉你从路 A 切到路 B 要改哪几行
```

---

## 二、前置条件

| 需要 | 检查命令 | 备注 |
| --- | --- | --- |
| Node.js **22+** | `node -v` | 需要全局 `WebSocket`（浏览器测试用） |
| MSVC 2019+ 或 VS2022 | `cmake --version` + VS 已装 | 编译 C++ 侧 |
| Chrome 或 Edge | 会自动在 `ProgramFiles` 下找 | 最后一步真浏览器播放 |
| 一份真实 `.dem` | — | 本文以 `D:/demos/match.dem` 为例，**换成你的路径** |
| 磁盘约 **400 MB** | — | 两个 66 MB 镜像 + 构建产物 |
| **外网出口**（可选） | `curl -I https://maps.csdemo.tv/` | 没有也能跑通全链路，只是地图/雷达/人物模型降级为网格 + 胶囊体 |

> ⚠️ demo **没有默认路径**，所有需要它的命令都必须 `--demo <路径>` 或设 `CSDEMO_DEM`。

---

## 三、产物地图

跑完之后你会得到这些文件，搞清楚谁在哪一步产生、被谁消费：

| 文件 | 大小 | 产生者 | 消费者 |
| --- | ---: | --- | --- |
| `docs/shared-layout.golden.tsv` | 3 KB | Step 0 | `cpp_layout` 测试 |
| `tmp/shared-from-js.bin` | **66 MB** | Step 1（`gen-js-image.mjs`） | Step 2（C++ 读） |
| `tmp/shared-from-js.json` | 1 KB | Step 1 | Step 3、Step 4（`visible` 水位） |
| `tmp/shared-from-cpp-rt.bin` | **66 MB** | Step 2（`roundtrip_test`） | Step 3、Step 4 |
| `tmp/playback.png` | 190 KB | Step 4 | 人看 |

**同一个 `.bin` 格式贯穿全链** —— 它不是临时交换格式，就是 `docs/08` §3.4 定义的共享内存布局本身（CSDF header + 元数据区 A/B + 列块区 + blob）。

---

## 四、完整执行序列（复制即用）

```bash
# ═══ Step 0. 准备（只需一次）═══
cd <repo>

# 0a. 生成布局金标准（真实 demo，49 块）
node tools/dump-shared-layout.mjs --demo D:/demos/match.dem
#    判据：输出 "块数 49"，写出 docs/shared-layout.golden.{json,tsv}

# 0b. 编译 C++
cd cpp
cmake --preset vs2019-x64          # 或 vs2022-x64
cmake --build --preset vs2019-release
cd ..
#    判据：零警告零错误，可执行文件在 cpp/out/build/vs2019-x64/bin/release/


# ═══ Step 1. JS 解析 demo → 共享内存镜像 ═══
node tools/gen-js-image.mjs --demo D:/demos/match.dem
#    判据：
#      ① 用原 JS 解析 ... （约 16s）
#      ② 写成共享内存镜像 ... 69435136 字节（66.22 MB）
#      元数据 JSON 467 KB  块数 49  blob 5.96 MB
#    产出：tmp/shared-from-js.bin + tmp/shared-from-js.json


# ═══ Step 2. C++ 读镜像 → 构造 DemoData → 再写一份 ═══
cpp/out/build/vs2019-x64/bin/release/roundtrip_test.exe \
    tmp/shared-from-js.bin tmp/shared-from-cpp-rt.bin
#    判据：
#      [PASS] readSharedBufferToDemoData 成功
#      [PASS] validate() 通过
#      [PASS] 全部块（列块 + blob）逐字节一致  —  49 块
#      OK: C++ 读→构造→写 往返一致
#    产出：tmp/shared-from-cpp-rt.bin


# ═══ Step 3. JS 读 C++ 写出的镜像，与原始指纹比对 ═══
node tools/verify-roundtrip.mjs
#    判据：PASS 28  FAIL 0
#          ROUNDTRIP OK: JS -> C++ -> JS 数据完全一致


# ═══ Step 4. 注入原应用，真浏览器播放 ═══
node tools/playback-test.mjs
#    判据：PASS 6  FAIL 0
#          OK: 注入数据后应用成功进入播放
#    产出：tmp/playback.png ← 打开看，应该能看到角色和 HUD
```

**总耗时约 60 秒**（不含 Step 0 编译）。

---

## 四·补、交互式查看：不用截图，你自己进去操作

上面 §四 的 Step 4 用的是 `playback-test.mjs` —— 它是**自动化回归测试**：起 headless 浏览器、
注入、截图断言、然后拆掉。适合 ctest，但**你没法自己操作**。

想看、想玩、想拖时间轴，用 `serve-playback.mjs`：

```bash
node tools/serve-playback.mjs                    # 起服务，然后自己打开 http://127.0.0.1:8124/
node tools/serve-playback.mjs --open             # 顺带用默认浏览器打开
node tools/serve-playback.mjs --port 8080        # 换端口
node tools/serve-playback.mjs --image out/from-my-parser.bin   # 看别的镜像
```

打开后**会自动播放**（脚本替你点好了"打开文件"），可以直接用：

| 操作 | 说明 |
| --- | --- |
| 拖底部时间轴 | 跳到任意时刻 |
| 倍速 0.25x ~ 4x | 慢放/快放 |
| 切换 POV | 点玩家面板跟进该玩家视角 |
| `F` / `Fly` / `V` / `Noclip` | 自由视角 / 飞行 / 穿墙 |

按 `Ctrl+C` 停服务。

### 两个脚本的区别

| | `playback-test.mjs` | `serve-playback.mjs` |
| --- | --- | --- |
| 用途 | 自动化回归（进 ctest） | 人看、人操作 |
| 浏览器 | headless，脚本自己起 | **你自己的浏览器** |
| 注入方式 | CDP `addScriptToEvaluateOnNewDocument` | **服务端改写 `index.html` 的响应流** |
| 结束方式 | 断言完自动拆掉 | 你按 Ctrl+C |
| 产物 | `tmp/playback.png` | 你自己看 |

两者**共用同一份注入脚本**（`tools/inject.mjs`），所以改注入逻辑只需要改一处。

### 服务端注入是怎么做的

不修改 `raw/index.html`（它是逐字原副本），而是在**响应流里**插入一行：

```js
// serve-playback.mjs 的 serveIndexWithInject()
const src = fs.readFileSync(raw/index.html, "utf8");
const at  = src.indexOf('<script type="module"');          // app bundle 的位置
const out = src.slice(0, at)                                   // 前半段
          + '<script src="/__playback-inject.js"><\/script>'   // ← 注入（classic script 先于 module 执行）
          + src.slice(at);                                       // 后半段
```

于是**任何浏览器直接打开 URL 都行** —— 不需要 CDP、不需要 headless、不需要改文件。

### 离线时地图是网格（不是 bug）

地图几何 / 雷达 / 人物模型走 `maps.csdemo.tv`。本服务做了和 `serve.mjs` 一样的
运行时代理（`/__maps`），但如果这台机器访问不到上游，你会看到：

```
  ⚠ 上游不可达：https://maps.csdemo.tv  （…）
     后果：地图几何/雷达/人物模型拿不到 → 场景会降级成网格、角色显示为胶囊体。
     数据链路本身不受影响，播放器仍可正常播放。
```

这是应用自身的容错设计（有 `using grid` 兜底）。**数据、角色位置、HUD、时间轴全都正常** —— 只是没有地图贴图和模型。

---

## 五、每步详解：它在做什么、怎么确认对了

### Step 1 · `gen-js-image.mjs` —— JS 解析 → 镜像

```bash
node tools/gen-js-image.mjs --demo D:/demos/match.dem --image out/my.bin --tmp out/work
```

它干三件事：

1. **把原 `parser.worker.js` 包成能在 Node 里跑的 ESM**（剥掉 `onmessage`，追加 `initParser` / `parseDemoCore` 导出）
2. **调 `parseDemoCore(demoBytes, {sampleRate:64})`** —— 这就是线上前端用的那条 wasm 解析链
3. **`writeSharedBuffer(ab, data, {version:2})`** 写成文件

**为什么这步有意义**：它证明了「JS 侧产出的 `data` 结构」和「共享内存镜像」是等价的 —— 后面 C++ 读的就是同一份字节。

可用参数：

| 参数 | 作用 |
| --- | --- |
| `--demo <path>` | 输入 demo（**必填**） |
| `--image <path>` | 输出镜像（默认 `tmp/shared-from-js.bin`） |
| `--sidecar <path>` | 输出水位/指纹 json（默认 `tmp/shared-from-js.json`） |
| `--tmp <dir>` | 中间文件目录 |

**旁挂 json 是什么**：它记录 `visible`（可见水位）+ 若干指纹（各列求和）。Step 3 用它做比对，Step 4 用它填 `buildDataFromSharedBuffer` 的 `visible` 参数。

---

### Step 2 · `roundtrip_test` —— C++ 读回、构造、再写

```bash
roundtrip_test.exe <输入镜像> <输出镜像>
```

它的内部就四步，对应 `cpp/shared_reader.h` + `cpp/shared_writer.h`：

```cpp
// ① 读镜像 → DemoData
csdemo::DemoData d = csdemo::readSharedBufferToDemoData(buf, bytes);

// ② 校验（列长度、索引公式、count 自洽、值域）
auto rep = csdemo::validate(d);
if (!rep.ok()) throw std::runtime_error(rep.toString());

// ③ 构造好了 —— 这一步就是你的解析器要产出的东西
//    （本测试里它来自镜像，你的解析器里它来自 .dem）

// ④ 再写一份镜像
const std::size_t need = csdemo::sharedBufferBytesFor(d);
std::vector<std::uint8_t> out(need);
csdemo::writeSharedBuffer(out.data(), need, d, /*version=*/1);
```

**为什么这步有意义**：如果 C++ 的 `DemoData` 映射有任何偏差（少一列、类型错、blob 偏移算错），往返后再写出来的字节就不可能和原镜像**逐字节相同**。

**判据里最关键的一行**：

```
[PASS] 全部块（列块 + blob）逐字节一致  —  49 块
```

这 49 块包含了 19 个 frames 列、11 个 panelFrames 列、19 个区间数据列，以及 blob 里的 306 条手雷轨迹、66 个燃烧弹的嵌套帧、481 条掉落武器。

---

### Step 3 · `verify-roundtrip.mjs` —— JS 反向确认

```bash
node tools/verify-roundtrip.mjs --image tmp/shared-from-cpp-rt.bin --sidecar tmp/shared-from-js.json
```

它用 `buildDataFromSharedBuffer` 读 C++ 写出的镜像，然后**用同一段 JS 代码**重新计算 Step 1 存下的那些指纹，逐项比对。

**为什么需要这一步**（Step 2 已经逐字节比过了）：
Step 2 比的是"C++ 写出来的字节 == JS 写出来的字节"，但**没验证"这些字节被 JS 读回来能得到正确的 data"**。
Step 3 补上这个方向，形成完整闭环：**JS → C++ → JS**。

---

### Step 4 · `playback-test.mjs` —— 真的播起来

```bash
node tools/playback-test.mjs --image tmp/shared-from-cpp-rt.bin
```

这一步最"魔法"，下面单独讲原理。

---

## 六、Step 4 的注入原理（关键，也是可复用的部分）

### 6.1 问题

原应用的数据来自 `parser.worker`。我们没法让它"跳过解析直接读文件"—— 除非改它的代码（`src/app/` 是逐字原副本，不能改）。

### 6.2 做法：替换 `window.Worker`

在**页面任何脚本执行之前**注入一段脚本，把 `window.Worker` 换成一个替身：

```
应用启动
  └─ new Worker('/assets/parser.worker-xxxx.js')
        └─ 被替身拦截（只拦 URL 含 parser.worker 的；mapGeometry 等其他 worker 放行）
应用 worker.postMessage({type:'parse', bytes, options})
        └─ 替身不跑 wasm，而是：
             fetch('/__image.bin')                    ← 我们挂的 C++ 镜像
             buildDataFromSharedBuffer(ab, VISIBLE)   ← 内联的 JS 读端
             按真实工人协议依次 emit：
                 {type:'progress', phase, value}
                 {type:'manifest', manifest}
                 {type:'ready', data, manifest, loadedRounds}
                 {type:'done', data}
应用收到 ready → kz(data, ...) → new DemoApp(...) → 渲染循环开跑
```

**应用完全不知道自己拿到的不是自己解析的数据** —— 它走的是同一条 `onReady → kz() → new DemoApp()` 路径。

### 6.3 可复制的注入脚本骨架

这是 `tools/playback-test.mjs` 里 `buildInjectScript()` 的核心，你可以直接拿去改：

```js
// 注入时机：CDP Page.addScriptToEvaluateOnNewDocument，在页面脚本之前执行
(() => {
  // ── ① 内联 shared-buffer.js（去掉 export 就能当普通脚本用）──
  //    ${sb}  ← 构建时把 src/deobfuscated/shared-buffer.js 的源码塞进来
  //    （做法：源文件读出来，sb.replace(/^export /gm, '')）

  const IMAGE_URL = '/__image.bin';   // 由本地静态服务器挂出 C++ 镜像
  const VISIBLE = {                    // 从 sidecar 的 visible 字段来
    version: 2, loadedRounds: 22,
    visibleFrames: 114326, panelVisibleFrames: 14291,
    durationSeconds: 1786.328125,
  };

  let cache = null;
  async function getData() {
    if (!cache) cache = { ab: await (await fetch(IMAGE_URL)).arrayBuffer() };
    const data = buildDataFromSharedBuffer(cache.ab, VISIBLE);
    const manifest = {
      mapName: data.meta.mapName, tickRate: data.meta.tickRate,
      startTick: data.meta.startTick, endTick: data.meta.endTick,
      durationSeconds: data.meta.durationSeconds, rounds: data.rounds,
    };
    return { data, manifest };
  }

  // ── ② worker 替身 ──
  function makeShim() {
    const msgHandlers = [];
    const self = {
      _onmessage: null,
      set onmessage(fn) { self._onmessage = fn; },
      get onmessage() { return self._onmessage; },
      set onerror(fn) {},
      addEventListener(t, fn) { if (t === 'message') msgHandlers.push(fn); },
      removeEventListener() {},
      terminate() {},
      postMessage(msg) { handle(msg); },
    };
    const emit = (obj) => {
      const ev = { data: obj };
      if (self._onmessage) self._onmessage(ev);
      for (const h of msgHandlers) h(ev);
    };
    async function handle(msg) {
      if (!msg || msg.type !== 'parse') return;
      try {
        emit({ type: 'progress', phase: 'Loading…', value: 0.04 });
        const { data, manifest } = await getData();
        emit({ type: 'manifest', manifest });
        emit({ type: 'progress', phase: 'Loaded from image', value: 1 });
        // ⚠️ 一次性给全部回合：ready 之后再补一条 done
        emit({ type: 'ready', data, manifest, loadedRounds: data.rounds.length });
        emit({ type: 'done', data });
      } catch (e) {
        emit({ type: 'error', message: String(e && e.message || e) });
      }
    }
    return self;
  }

  // ── ③ 只拦 parser.worker，其他 worker 放行 ──
  const RealWorker = window.Worker;
  function PatchedWorker(url, opts) {
    return String(url).includes('parser.worker') ? makeShim() : new RealWorker(url, opts);
  }
  PatchedWorker.prototype = RealWorker.prototype;
  window.Worker = PatchedWorker;
})();
```

### 6.4 触发加载

应用走的是 `<input type="file">` 流程，需要一个 `File` 才能进到"创建 worker"那一步。
但**文件内容是假的**（真数据由替身提供），所以塞 16 个字节就够：

```js
// 通过 CDP Runtime.evaluate 执行
const input = document.getElementById('fileInput');
const dt = new DataTransfer();
dt.items.add(new File([new Uint8Array(16)], 'injected.dem', { type: 'application/octet-stream' }));
input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
```

> 为什么不用真 demo？那样应用会真的去算 sha256、查 IndexedDB、把 87 MB 传给 worker —— 慢且没必要。
> 塞假文件后，那条路径只走"算 hash → 未命中 → 建 worker"，然后就被替身接管了。

### 6.5 自己搭这套要准备什么

| 要素 | 本项目怎么做 |
| --- | --- |
| 静态服务器 | `playback-test.mjs` 内置一个，serve `raw/`，并把镜像挂在 `/__image.bin` |
| 无头浏览器 + CDP | `--headless=new --remote-debugging-port=18722 --enable-unsafe-swiftshader --use-angle=swiftshader` |
| 注入时机 | `Page.addScriptToEvaluateOnNewDocument`（在 navigate 之前注册） |
| 断言 | `Runtime.evaluate` 取 canvas 数量/尺寸、loading 遮罩是否隐藏、`window.__playbackLog` 注入日志 |
| 截图 | `Page.captureScreenshot` → `tmp/playback.png` |

---

## 七、换成你自己的 C++ 解析器（从路 A 切到路 B）

**好消息：验证脚手架几乎不用改。** 只要你的程序能产出同格式的镜像文件，Step 3、Step 4 原样可用。

### 7.1 要改的只有一处

```
Step 2 的 roundtrip_test.exe   ←  换成你的解析器可执行文件
        （它内部的"读镜像 → DemoData"换成"解析 .dem → DemoData"）
```

Step 1 可以保留（对比用），Step 3 / Step 4 一行都不改。

### 7.2 你的解析器主程序骨架

```cpp
#include "demo_data.h"      // DemoData 契约 + validate / auditRanges
#include "shared_writer.h"  // sharedBufferBytesFor / writeSharedBuffer
#include <cstdio>
#include <vector>

int main(int argc, char** argv) {
    if (argc < 3) { std::fprintf(stderr, "用法: %s <demo.dem> <out.bin>\n", argv[0]); return 2; }

    csdemo::DemoData d;

    // ── ① 你的解析：填 d ──
    //   d.meta.mapName / tickRate / startTick / numPlayers / numFrames ...
    //   d.players / d.rounds / d.weaponNames ...
    //   d.frames.*（19 列，N×P 的 SoA） / d.panelFrames.*（11 列，M×P）
    //   d.tracers / d.damage / d.weaponFires / d.smokeVoxels
    //   d.grenades / d.bomb / d.events / d.timeouts / d.deathMarkers ...
    //   字段含义与陷阱见 docs/07-data-contract.md

    // ── ② 校验（一定要做）──
    auto rep = csdemo::validate(d);
    if (!rep.ok()) {
        std::fprintf(stderr, "validate 失败:\n%s", rep.toString().c_str());
        return 1;
    }
    #ifndef NDEBUG
    auto ranges = csdemo::auditRanges(d);        // 值域抽检，开销大，仅调试期
    if (!ranges.ok()) std::fprintf(stderr, "值域告警:\n%s", ranges.toString().c_str());
    #endif

    // ── ③ 写镜像 ──
    const std::size_t need = csdemo::sharedBufferBytesFor(d);
    std::vector<std::uint8_t> buf(need);
    csdemo::writeSharedBuffer(buf.data(), need, d, /*version=*/1);

    std::FILE* f = std::fopen(argv[2], "wb");
    if (!f) { std::perror("fopen"); return 1; }
    std::fwrite(buf.data(), 1, need, f);
    std::fclose(f);

    std::printf("wrote %zu bytes -> %s\n", need, argv[2]);
    return 0;
}
```

CMake 接上去：

```cmake
add_executable(your_parser src/main.cpp src/parse.cpp)
target_link_libraries(your_parser PRIVATE csdemo::core)
```

### 7.3 然后把 Step 2~4 换成

```bash
cpp/out/build/vs2019-x64/bin/release/your_parser.exe D:/demos/match.dem tmp/from-my-parser.bin
node tools/verify-roundtrip.mjs --image tmp/from-my-parser.bin --sidecar tmp/shared-from-js.json
node tools/playback-test.mjs    --image tmp/from-my-parser.bin
```

> ⚠️ Step 3 的 `--sidecar` 指向 Step 1 生成的「JS 解析基准」。这样比对的就是
> **你的 C++ 解析结果** vs **原 JS wasm 解析结果** —— 这是验证你解析器正确性最直接的手段。

### 7.4 生产环境（不用文件，用 WebView2 共享内存）

上面都是用**文件**代替共享内存。真上线时换成 WebView2 通道：

| 验证链路 | 生产链路 |
| --- | --- |
| `writeSharedBuffer` 写到 `std::vector` → `fwrite` 到文件 | `CreateSharedBuffer` 拿到映射基址 → `writeSharedBuffer` 直接写共享内存 |
| `playback-test.mjs` 用注入替他 worker | `bindSharedBuffer()` 监听真实 `sharedbufferreceived` / `message` |
| 水位从 sidecar json 读 | 水位从 `postRoundMessage` 的消息里读 |

这部分代码在 `cpp/webview2_bridge.h` 与 `src/deobfuscated/shared-buffer.js`，
接口名需按你的 WebView2 SDK 核对（见 `cpp/README.md` §四 第 2 条）。

---

## 八、失败排查

| 现象 | 原因 | 怎么查 |
| --- | --- | --- |
| `✗ 没有指定 demo 文件` | 没给 `--demo` | demo 无默认值，必须显式给或设 `CSDEMO_DEM` |
| `[SKIP] cannot find ...` + 退出码 2 | 输入文件不存在 | 按提示路径检查，或看 §三 产物地图谁该产出它 |
| `gen-js-image` 报 `找不到 raw/assets/…wasm` | 不在仓库根跑 | 脚本用 `import.meta.dirname` 推导仓库根，与 cwd 无关；检查 `raw/` 是否完整 |
| `roundtrip_test` 报 `magic 不符` | 输入不是共享内存镜像 | 确认传的是 `shared-from-js.bin` 而不是 `.dem` |
| `roundtrip_test` 报 `元数据区为空（选错了 A/B 区？）` | 镜像的 version 奇偶与读取侧不匹配 | writer 用 `version=2` 写 A 区；reader 会两份都试，仍报错说明镜像损坏 |
| Step 3 指纹不一致 | C++ 的 `DemoData` 映射有偏差 | 先看 Step 2 是否逐字节通过；不通过说明 writer 侧有问题 |
| `playback-test` 报 `找不到镜像` | 路径不对 | 用 `--image` 显式指定 |
| `playback-test` 卡在 landing 页 | worker 没被拦到 | 看注入日志里有没有 `intercepted parser worker`；没有说明 URL 不匹配 |
| 画面是网格、角色是胶囊体 | `maps.csdemo.tv` 不可达 | 正常降级，见 §九 |
| `ctest` 报 `***Not Run` | 可执行文件不存在 | 忘了 `cmake --build`，或 build 目录被清过 |
| 打开 `playback-test` 打印的 URL 只看到**落地页** | 那个服务器**不做服务端注入**，注入只对它自己启动的 headless 浏览器生效；且测试结束就关服 | 要看画面用 `node tools/serve-playback.mjs --open` |
| 控制台一堆 `Failed to fetch`（map / radar / catalogue / backdrop） | 这台机器**没有外网出口**，拉不到 `maps.csdemo.tv` 和 `data.csdemo.tv` | 见 §九。不影响播放，只是场景降级 |

**调试技巧**：`playback-test.mjs` 会把注入过程的日志塞进 `window.__playbackLog`，
最后打印出来。看到 `emitted ready+done` 就说明数据已经交给应用了，
后面的问题就出在应用渲染侧而不是数据侧。

---

## 九、已知限制（这条链路**没有**验证的东西）

| 项 | 说明 |
| --- | --- |
| **C++ 解析器的正确性** | 数据是 JS 解析出来的。这条链路验证的是**接口层**，不是解析层。解析层靠 `demo_data.h` 的 `validate()` / `auditRanges()` + `docs/07` 的契约保证 |
| **WebView2 真实共享内存通道** | 用文件代替了。`webview2_bridge` 只在接口声明桩上做过语法检查 |
| **在线地图 / 人物模型 / 雷达** | 需要 `maps.csdemo.tv`（几何、雷达、角色模型）与 `data.csdemo.tv`（比赛目录、地图 logo）。
  离线时应用降级为网格场景 + 胶囊体角色（应用自己的容错设计）。**这一项最容易让人以为"坏了"** —— 实际上：
  角色会正常出现在正确坐标上、名字跟随、HUD/时间轴/事件流全对，只是没有地图贴图和人物模型。
  本机实测（受限内网，无外网出口）：`www.baidu.com` / `github.com` 同样连不通，DNS 能解析但无出站 TCP —— 是环境问题不是工程问题。 |
| **回合增量发布** | 现在只做全量写。增量协议见 `docs/08` §3.5，还没实现 |

---

## 十、一页速查

```bash
# 一次性准备
node tools/dump-shared-layout.mjs --demo <dem>          # → 金标准 49 块
cd cpp && cmake --preset vs2019-x64 && cmake --build --preset vs2019-release && cd ..

# 主链路
node tools/gen-js-image.mjs --demo <dem>                                    # ① → 66 MB 镜像
cpp/.../roundtrip_test.exe tmp/shared-from-js.bin tmp/shared-from-cpp-rt.bin # ② → 往返一致
node tools/verify-roundtrip.mjs                                             # ③ → PASS 28
node tools/playback-test.mjs                                                # ④ → 播放 + 截图

# 换成自己的解析器（只替换 ②）
cpp/.../your_parser.exe <dem> tmp/from-my-parser.bin
node tools/verify-roundtrip.mjs --image tmp/from-my-parser.bin
node tools/playback-test.mjs    --image tmp/from-my-parser.bin
```

各步成功判据：① `块数 49` / ② `49 块逐字节一致` / ③ `PASS 28 FAIL 0` / ④ `PASS 6 FAIL 0`。
