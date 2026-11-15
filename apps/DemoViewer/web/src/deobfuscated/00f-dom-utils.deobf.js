// ============================================================================
// 反混淆版本：wasm-bindgen 胶水层（DemoInput 包装 + 内存编组工具）
// 原文范围：decompiled/index.beautified.js L28680–28796（切片 00f-dom-utils）
// 压缩名：Hg = DemoInput（bindgen 生成的类），Ug = finalizer，
//         Wg/Zg/Qg/$g/e_/t_ = 编组工具，Kg/Jg/Xg = 内存视图缓存，
//         n_ = TextEncoder，r_ = retptr，i_ = wasm exports，a_ = 字符串列排除集
//
// ⚠️ 两点先说明：
//   1. 切片名 `00f-dom-utils` 与内容不符 —— 这里既没有 DOM 也没有 utils，全是 bindgen 胶水。
//   2. **本文件没有作者手写的业务逻辑**。想理解业务请跳过，直接看 docs/07 附录 A。
//
// 保留它的唯一价值：它是「JS 如何调用 wasm」的权威 ABI 参考 —— 每个 JS 值都要经 malloc
// 拷进 wasm 线性内存（或经 externref 表传递），返回值再经 externref 表取回。
// ============================================================================

// ── DemoInput：wasm-bindgen 生成的类包装 ────────────────────────────────────
// 每个实例持有一个 wasm 侧指针（this.__wbg_ptr）。方法与 wasm 导出同名同参。
var DemoInput = class {
  // bindgen 生成的原型方法：free / parseEvents / parseHeader / parseRoundStream / write
  // 这里省略了文件前 23 行的字段与 free/构造函数部分（见 00f 切片 L7-39），只标注语义：
  //
  //   parseEvents(names, a, b)        → 按事件名过滤，返回事件数组
  //   parseHeader()                   → 返回元数据 Map（map_name 等）
  //   parseRoundStream(p1..p9, cb, strict)
  //                                   → **增量**解析：每完成一个回合就回调 cb（16 个参数见下）
  //   write(bytes, arg)               → 语义未知（全站无调用），签名 (ptr,len,extra)
  //
  // 其中 parseRoundStream 的实参顺序（与 docs/07 附录 A 对应）：
  //   (wantedPlayerColumns, ticksAlloc, allocators, rounds, panelColumns,
  //    panelAlloc, roundEndTicks, onRoundCallback, strict)
  //
  // 每个参数都是「先 memcpy 进 wasm 内存 → 传 (ptr, len)」的两步走；
  // 数组长度信息通过共享的 retptr（r_）回传。这段机械代码就是下面那些工具的用途。
};

// ── 编组工具（bindgen 生成，读到这里就不必细究）─────────────────────────────

// 用 externref 表把 JS 值塞给 wasm：返回 externref 索引
function externrefPush(value) {
  const idx = wasm.__externref_table_alloc();
  wasm.__wbindgen_externrefs.set(idx, value);
  return idx;
}

// 用 FinalizationRegistry 在 GC 时释放 wasm 侧对象。
// 若宿主不支持 FinalizationRegistry（`typeof … > 'u'` 即 undefined），退化为空实现。
var finalizer =
  typeof FinalizationRegistry > 'u'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_demoinput_free(ptr, 1));

// 内存视图缓存。注意每次用前都要检查 `detached` / 长度归零 ——
// wasm 的 memory.grow() 会让旧视图失效（ArrayBuffer 被 detach），必须重建。
var cachedDataView = null;
function dataView() {
  if (
    cachedDataView === null ||
    cachedDataView.buffer.detached === true ||
    (cachedDataView.buffer.detached === void 0 && cachedDataView.buffer !== wasm.memory.buffer)
  ) {
    cachedDataView = new DataView(wasm.memory.buffer);
  }
  return cachedDataView;
}

var cachedU32 = null;
function u32View() {
  if (cachedU32 === null || cachedU32.byteLength === 0) cachedU32 = new Uint32Array(wasm.memory.buffer);
  return cachedU32;
}

var cachedU8 = null;
function u8View() {
  if (cachedU8 === null || cachedU8.byteLength === 0) cachedU8 = new Uint8Array(wasm.memory.buffer);
  return cachedU8;
}

function isNil(v) {
  return v == null;
}

// ── 三种拷贝路径（全部返回 wasm 内偏移，并把长度写进 retptr）─────────────────

// JS 数值数组 → wasm（按 4 字节元素）
function passU32Array(arr, malloc) {
  const ptr = malloc(arr.length * 4, 4) >>> 0;
  u32View().set(arr, ptr / 4);
  retptr = arr.length;
  return ptr;
}

// JS 字节数组 → wasm（按 1 字节元素）
function passU8Array(arr, malloc) {
  const ptr = malloc(arr.length * 1, 1) >>> 0;
  u8View().set(arr, ptr / 1);
  retptr = arr.length;
  return ptr;
}

// JS 普通数组（含字符串/对象）→ wasm：逐个转成 externref，再写 externref 索引数组
function passExternrefArray(arr, malloc) {
  const ptr = malloc(arr.length * 4, 4) >>> 0;
  for (let i = 0; i < arr.length; i++) {
    const ref = externrefPush(arr[i]);
    dataView().setUint32(ptr + 4 * i, ref, true);
  }
  retptr = arr.length;
  return ptr;
}

// 从 wasm 取回一个 JS 值（并释放 externref 名额）
function takeExternref(idx) {
  const value = wasm.__wbindgen_externrefs.get(idx);
  wasm.__externref_table_dealloc(idx);
  return value;
}

// ── TextEncoder / retptr ────────────────────────────────────────────────────
// 老浏览器没有 `encodeInto`，bindgen 在这里打了个 polyfill。
var utf8 = new TextEncoder();
if (!('encodeInto' in utf8)) {
  utf8.encodeInto = function (str, dest) {
    const bytes = utf8.encode(str);
    dest.set(bytes);
    return { read: str.length, written: bytes.length };
  };
}

// retptr：bindgen 约定用这个全局变量在 (ptr,len) 之外回传「长度」。
// 它的存在解释了为什么每个 wasm 调用后面都跟着读一个 `r_`。
var retptr = 0;

// wasm exports 对象（在别处被赋值为 WebAssembly.instantiate 的结果）
var wasm;
void wasm; // 仅声明，避免 linter 报未定义

// ── 列名处理：字符串列排除集 ───────────────────────────────────────────────
// 这五个列存的是字符串（武器名/物品栏/准星码/战队名/玩家颜色名），
// 不能当作数值列参与「取所有非字符串列」的计算。
var STRING_COLUMNS = new Set(['active_weapon_name', 'inventory', 'crosshair_code', 'team_clan_name', 'player_color']);

// 原件最后一行是一条**结果被丢弃的**表达式语句：把「逐帧列 + 面板列去重后的字符串列」算了一遍但没有赋给任何变量
// （属于压缩/合并残留，`[...Ig, ...Lg.filter((e) => !a_.has(e))]`）。此处不再重复可执行代码，
// 只记录其等价语义（Ig/Lg 定义在 00e-kill-helpers.deobf.js）：
//
//   new Set([
//     ...WANTED_PLAYER_COLUMNS,                                     // Ig
//     ...WANTED_PANEL_COLUMNS.filter((c) => !STRING_COLUMNS.has(c)) // Lg 去掉字符串列
//   ])
//
// 该结果在原件中未被使用，属于死代码。
