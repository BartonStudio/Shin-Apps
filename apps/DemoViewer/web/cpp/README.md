# cpp —— C++ 侧实现（CMake 工程）

给「原生 C++ 解析 + WebView2 共享内存」这条链路用。纯 C++17，**零第三方依赖**。

> ⚠️ **这里没有 demo 解析器** —— 只有「解析出的数据怎么交给前端」所需的契约、布局、写入/读取、通道封装。
> 详见 `../docs/08-cpp-integration.md`。

---

## 一、用 Visual Studio 打开

### 方式 A：直接开目录（推荐）

```
Visual Studio → File → Open → Folder…  →  选这个 cpp/ 目录
```

VS 会自动读取 `CMakeLists.txt`，并生成 `out/build/<preset>` 构建目录。
打开后顶部下拉框选预设：

| 预设 | 适用于 |
| --- | --- |
| `vs2022-x64` | Visual Studio 2022 |
| `vs2019-x64` | Visual Studio 2019 |

选错版本会报 `generator not found` —— 换另一个即可。

### 方式 B：走 presets 从命令行

> ⚠️ **必须在 `cpp/` 目录下执行**。CMake 从**当前目录**向上找 `CMakePresets.json`，
> 在仓库根目录执行会报 `Could not read presets`。

```bash
cd cpp

cmake --preset vs2019-x64                 # 或 vs2022-x64
cmake --build --preset vs2019-release     # 或 vs2019-debug / vs2022-release
ctest --preset vs2019-release             # 跑全部测试
```

### 方式 C：不用 presets

```bash
cd cpp
cmake -S . -B out/build -G "Visual Studio 16 2019" -A x64
cmake --build out/build --config Release
ctest --test-dir out/build -C Release --output-on-failure
```

---

## 二、工程结构

```
cpp/
├─ CMakeLists.txt        CMake 工程定义
├─ CMakePresets.json     两个 VS 版本的预设
│
├─ [库]  csdemo_core（静态库，你的解析器 link 它即可）
│   demo_data.h          数据契约（DemoData / validate() / auditRanges()）
│   mini_json.h          极简 JSON 解析器（零依赖）
│   shared_layout.h/.cpp computeSharedLayout()：49 个块的偏移
│   shared_writer.h/.cpp planSharedBuffer() + writeSharedBuffer()
│   shared_reader.h/.cpp 镜像 → DemoData（writer 的逆操作，仅验证/调试用）
│
├─ [库]  csdemo_webview2（可选，找不到 WebView2 SDK 就跳过）
│   webview2_bridge.h/.cpp  CreateSharedBuffer / PostSharedBufferToScript / 回合消息
│
└─ [测试]  4 个可执行 + 4 个 node 跨语言测试，全部注册进 ctest
    smoke_test.cpp        validate() / auditRanges() 行为
    layout_test.cpp       布局对金标准逐块比对
    writer_test.cpp       写入 + 落盘
    roundtrip_test.cpp    真实全量数据往返
```

### 你的解析器怎么接

```cmake
add_executable(your_parser src/main.cpp src/parse.cpp)
target_link_libraries(your_parser PRIVATE csdemo::core)
```

```cpp
#include "demo_data.h"
#include "shared_writer.h"

csdemo::DemoData d;
// … 你的解析器填 d …

auto report = csdemo::validate(d);          // 列长度 / 索引公式 / count 自洽
if (!report.ok()) throw std::runtime_error(report.toString());

const std::size_t need = csdemo::sharedBufferBytesFor(d);
auto buf = /* 共享内存基址 */;
csdemo::writeSharedBuffer(buf, need, d, /*version=*/1);
```

---

## 环境变量与路径

C++ 测试程序（`cpp/cpp_paths.h`）与 JS 脚本（`tools/paths.mjs`）用**同一套优先级**：

```
① 命令行参数    argv[n]           （如 layout_test <golden.tsv>）
② 环境变量      CSDEMO_DEM / CSDEMO_TMP / CSDEMO_IMAGE / CSDEMO_GOLDEN
③ 默认值        相对仓库根（如 ../docs/shared-layout.golden.tsv）
```

输入文件缺失时打印指引并以**退出码 2**结束 —— CMake 里配了 `SKIP_RETURN_CODE 2`，
所以 ctest 记成 `***Skipped` 而不是 FAILED。

CMake 还会在 ctest 时注入绝对路径的 `CSDEMO_TMP` / `CSDEMO_GOLDEN`（见 CMakeLists.txt），
所以测试不依赖你从哪个目录运行。

输出目录不存在会自动创建（`ensureParentDir`）。

---

## 三、测试

```bash
cd cpp
ctest --preset vs2019-release              # 全部 8 项
ctest --preset vs2019-release -L cpp       # 只跑 4 项 C++ 测试
ctest --preset vs2019-release -L cross     # 只跑 4 项跨语言 / 端到端测试
ctest --preset vs2019-release --output-on-failure
```

### 8 项测试

| 测试 | 标签 | 用时 | 作用 |
| --- | --- | --- | --- |
| `cpp_smoke` | cpp | 0.2s | `validate()` / `auditRanges()` |
| `cpp_layout` | cpp | 0.2s | 49 块对金标准逐块比对 |
| `cpp_writer` | cpp | 0.5s | 写入 + 落盘 `tmp/shared-from-cpp.bin` |
| `cpp_roundtrip` | cpp | 0.5s | 真实全量数据（114 326 帧）往返 |
| `js_only` | cross | 19s | JS 写 → JS 读逐字节（PASS 76） |
| `cpp_to_js` | cross | 0.3s | C++ 写 → JS 读（PASS 114） |
| `js_to_cpp` | cross | 0.2s | JS→C++→JS 指纹比对（PASS 28） |
| `playback` | cross | 22s | headless Chrome 真播放（PASS 6） |

### 输入缺失时会被 SKIP，不会 FAIL

部分测试需要先生成中间产物。缺文件时程序以**退出码 2**退出，
CMake 里用 `SKIP_RETURN_CODE 2` 把这种情况标成 `***Skipped` 而不是失败：

| 缺什么 | 谁会 Skip | 怎么补 |
| --- | --- | --- |
| `../docs/shared-layout.golden.tsv` | `cpp_layout` | `node ../tools/dump-shared-layout.mjs --demo <你的dem>`（或 `--from-fixture`） |
| `../tmp/shared-from-js.bin` | `cpp_roundtrip` | `node ../tools/gen-js-image.mjs --demo <你的dem>` |
| 上一步产物 | `js_to_cpp` / `playback` | 同上 |
| demo 文件 | `js_only` / `gen_js_image` | 用 `-DCSDEMO_DEM_FILE=<路径>` 配置（见上节），或设 `CSDEMO_DEM` |

> demo 文件**没有默认路径**，`.gitignore` 也排除了 `*.dem`。
> 不给 demo 时：`cpp_smoke` / `cpp_layout` / `cpp_writer` / `cpp_to_js` 四项仍可全过。

---

## 四、⚠️ 两条必须知道的坑

### 1. MSVC 必须加 `/utf-8`

源文件里有大量中文注释。不加这个，MSVC 按本地代码页（中文 Windows 是 GBK）解释 UTF-8 字节，
会报出**「常量中有换行符」** 这种与真实原因无关的错误，能浪费你半天。

**已经写进 `CMakeLists.txt` 了**（`/utf-8 /W4 /permissive-`），所以你用 CMake 构建不会遇到。
只有当你手工用 `cl` 编译时才需要自己加。

相关约定：**运行时输出（`printf`）一律用英文**。中文字符串字面量会
① 触发 C4819 警告 ② 把 `printf` 的格式串挤错位（报 C4474「参数太多」）③ 在 GBK 控制台输出乱码。
中文只出现在注释里。

### 2. `webview2_bridge` 未用真实 SDK 验证

开发机上没装 WebView2 SDK（`WebView2.h` 不存在），只做了桩级语法检查。
CMake 里用 `find_path(WEBVIEW2_INCLUDE_DIR WebView2.h)` 探测，找不到就跳过这个库。

启用方式：
```bash
# NuGet 装 Microsoft.Web.WebView2 之后
cmake --preset vs2019-x64 -DWEBVIEW2_INCLUDE_DIR=<...>/build/native/include
# 或直接用 VS 的 NuGet 包管理
```

接入时**必须按你手上的 `WebView2.h` 核对**：
- `ICoreWebView2Environment12::CreateSharedBuffer` 是否存在（Runtime 版本要求）
- `ICoreWebView2_17::PostSharedBufferToScript` 是否存在
- `COREWEBVIEW2_SHARED_BUFFER_ACCESS` 的枚举名
- `sharedbufferreceived` 事件的 `additionalData` / `getBuffer()` 用法

代码里用 `QueryInterface` 取这两个接口，所以 SDK 版本不匹配时返回 `E_NOINTERFACE` 而不是编译失败。

---

## 五、构建配置项

| CMake 选项 | 默认 | 说明 |
| --- | --- | --- |
| `CSDEMO_BUILD_TESTS` | ON | 构建 4 个测试可执行 |
| `CSDEMO_WITH_NODE_TESTS` | ON | 把 4 项 node 测试也注册进 ctest（需要 `node`） |
| `CSDEMO_BUILD_WEBVIEW2` | ON | 构建 WebView2 通道（需 SDK，找不到自动跳过） |
| `WEBVIEW2_INCLUDE_DIR` | 自动探测 | `WebView2.h` 所在目录 |
| `WEBVIEW2_LOADER_LIB` | 自动探测 | `WebView2LoaderStatic.lib` |
| `CSDEMO_DEM_FILE` | 空 | demo 文件路径。**设了它**，ctest 才会注册需要 demo 的测试（含自动跑 gen-js-image 串起全链路）；不设则那些测试 SKIPPED |

产物位置：可执行文件在 `out/build/<preset>/bin/<config>/`，
测试中间文件写到仓库的 `tmp/`（与 README 记录的命令一致）。
