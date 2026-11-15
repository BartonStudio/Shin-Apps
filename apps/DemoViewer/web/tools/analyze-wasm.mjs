// 分析 csplayer_parser wasm：提取段结构、name 段内容、自有源码路径、依赖、工具链。
//
// 2026-11-09 修正：旧版只匹配 `index.crates.io-…\…\src\`（反斜杠 + registry 前缀），
// 因此漏掉了两类真实依赖：
//   · 用正斜杠路径的（hashbrown-0.17.1、dlmalloc-0.2.14）
//   · 没有源码路径、只出现在 demangle 符号里的（csgoproto、prost —— 整个 protobuf 栈）
// 本版同时从「路径」和「符号命名空间」两个来源收集，并额外解析 name 自定义段。
//
// 用法：node tools/analyze-wasm.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WASM = path.join(ROOT, 'raw/assets/csplayer_parser_bg-qigVgicw.wasm');
const buf = fs.readFileSync(WASM);

// ── LEB128 ──
function readLEB(b, i) {
  let r = 0;
  let sh = 0;
  for (;;) {
    const byte = b[i++];
    r |= (byte & 0x7f) << sh;
    if ((byte & 0x80) === 0) break;
    sh += 7;
  }
  return [r >>> 0, i];
}

// ── 段解析 ──
function parseSections(b) {
  const out = [];
  let i = 8; // 跳过 magic + version
  while (i < b.length) {
    const id = b[i++];
    let size;
    [size, i] = readLEB(b, i);
    const payload = i;
    let name = null;
    let nameLen = 0;
    if (id === 0) {
      [nameLen, i] = readLEB(b, i);
      name = b.subarray(i, i + nameLen).toString('utf8');
      i += nameLen;
    }
    out.push({ id, size, payload, name, dataStart: i });
    i = payload + size;
  }
  return out;
}

// ── name 段（子段 1 = 函数名）──
function parseNameSection(b, sec) {
  const end = sec.payload + sec.size;
  let i = sec.dataStart;
  const subs = [];
  let funcNames = [];
  let moduleName = null;
  while (i < end) {
    const subId = b[i++];
    let subSize;
    [subSize, i] = readLEB(b, i);
    const subEnd = i + subSize;
    if (subId === 0) {
      let n;
      [n, i] = readLEB(b, i);
      moduleName = b.subarray(i, i + n).toString('utf8');
    } else if (subId === 1) {
      let count;
      [count, i] = readLEB(b, i);
      for (let k = 0; k < count; k++) {
        let idx;
        let n;
        [idx, i] = readLEB(b, i);
        [n, i] = readLEB(b, i);
        funcNames.push(b.subarray(i, i + n).toString('utf8'));
        i += n;
      }
    }
    subs.push({ id: subId, size: subSize });
    i = subEnd;
  }
  return { subs, funcNames, moduleName };
}

// ── 字符串扫描（Latin-1 1:1 视图，可安全用正则）──
const text = Buffer.from(buf).toString('latin1');

const sections = parseSections(buf);
const nameSec = sections.find((s) => s.name === 'name');
const nameInfo = nameSec ? parseNameSection(buf, nameSec) : { subs: [], funcNames: [], moduleName: null };

// 1) 自有源码路径
const own = new Set();
{
  const k = 'vendor\\parser\\src\\';
  const re = /vendor\\parser\\src\\[^\x00-\x1f"']{3,80}\.rs/g;
  let m;
  while ((m = re.exec(text))) own.add(m[0].slice(k.length));
}

// 2) registry 依赖（正反斜杠都认）
const registry = new Set();
{
  const re = /index\.crates\.io-[0-9a-f]+[\\/]([^\\/"'\s]+)[\\/]src[\\/]/g;
  let m;
  while ((m = re.exec(text))) registry.add(m[1]);
}

// 2b) 所有「crate-版本号/src/」形式的路径
//     兜住不带 registry 前缀的那些（如 hashbrown-0.17.1/src/raw.rs、dlmalloc-0.2.14）
const versionedPaths = new Set();
{
  const re = /([a-z][a-z0-9_-]{1,40}-\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)[\\/]src[\\/]/g;
  let m;
  while ((m = re.exec(text))) versionedPaths.add(m[1]);
}

// 3) 符号里的 crate 命名空间（cratename[16位hash]）
//
// ⚠️ 提取局限（必须知道，否则会误判）：
//   wasm data 段里的字符串没有 NUL 分隔，相邻的长度前缀字节会粘在名字前面
//   （例如 0x61='a' 紧贴 `core[...]` → 抽成 `acore`）。
//   因此**不能**用「符号里出现过的命名空间」当权威依赖清单。
//   下面只输出候选 + 出现次数，供人工判读；权威清单请看 registryDepVersions
//   与 protobufStack（后者由 `<csgoproto[..]::protobuf::X as prost[..]::Message>` 这类
//   完整 trait impl 路径确证，不是靠命名空间猜的）。
const namespaceCounts = {};
{
  const re = /([a-z][a-z_0-9]{2,40})\[([0-9a-f]{16})\]/g;
  let m;
  while ((m = re.exec(text))) namespaceCounts[m[1]] = (namespaceCounts[m[1]] || 0) + 1;
}

// 确证属实的 protobuf 消息样例（用于支撑 protobufStack 结论）
const protobufSamples = [
  ...new Set((text.match(/csgoproto\[[0-9a-f]{16}\]::protobuf::([A-Za-z0-9_]+)/g) ?? []).map((s) =>
    s.replace(/^.*::protobuf::/, ''),
  )),
].sort();

// 4) rustc commit
const rustcCommits = new Set();
{
  const re = /\/rustc\/([0-9a-f]{40})/g;
  let m;
  while ((m = re.exec(text))) rustcCommits.add(m[1]);
}

// 5) wasm-bindgen hash
const wbHash = new Set();
{
  const re = /wasm_bindgen\[([0-9a-f]{16})\]/g;
  let m;
  while ((m = re.exec(text))) wbHash.add(m[1]);
}

// 6) 从函数名里提取 crate 归属与自有模块路径
const parserModules = new Set();
const parserSymCount = {};
for (const fn of nameInfo.funcNames) {
  // 形如 <parser[c47be6aaae518df0]::parse_demo::Parser>::combine_outputs
  // 或 csplayer_parser[6ef4faa788daf580]::parse_header
  const m = /(?:^|[<:])(parser|csplayer_parser)\[[0-9a-f]{16}\]::([A-Za-z0-9_:]+)/.exec(fn);
  if (m) {
    const top = m[2].split('::')[0];
    parserModules.add(`${m[1]}::${top}`);
    parserSymCount[m[1]] = (parserSymCount[m[1]] || 0) + 1;
  }
}

// 7) bindgen 与非 bindgen 函数名拆分
const bindgen = nameInfo.funcNames.filter((n) => /__wbg|__wbindgen/.test(n)).length;

// 8) protobuf 栈检测（由完整 trait impl 路径确证，不靠命名空间猜）
const PROTO_TRAIT = /<csgoproto\[[0-9a-f]{16}\]::protobuf::([A-Za-z0-9_]+)\s+as\s+prost\[[0-9a-f]{16}\]::message::Message>/g;
const protobufTraitImpls = [...new Set((text.match(PROTO_TRAIT) ?? []).map((s) => /::protobuf::([A-Za-z0-9_]+)/.exec(s)[1]))].sort();
const protobuf = {
  hasCsgoproto: /\bcsgoproto\[[0-9a-f]{16}\]::/.test(text),
  hasProst: /\bprost\[[0-9a-f]{16}\]::/.test(text),
  // 最强证据：csgoproto 的 X 实现了 prost::Message —— 证明两者同时存在且协作
  traitImplCount: protobufTraitImpls.length,
  traitImplSamples: protobufTraitImpls.slice(0, 25),
};

// 9) 导出面（应用可调用的 API）
const exports = [];
for (const s of sections.filter((x) => x.id === 7)) {
  let i = s.dataStart;
  let n;
  [n, i] = readLEB(buf, i);
  for (let k = 0; k < n; k++) {
    let nl;
    [nl, i] = readLEB(buf, i);
    const nm = buf.subarray(i, i + nl).toString('utf8');
    i += nl;
    const kind = buf[i++];
    let idx;
    [idx, i] = readLEB(buf, i);
    exports.push({ name: nm, kind, index: idx });
  }
}

const report = {
  file: 'csplayer_parser_bg-qigVgicw.wasm',
  bytes: buf.length,
  _note:
    '依赖有两级可信度：registryDepVersions（来自真实源码路径，权威）与 protobufStack（来自完整 trait impl 路径，权威）；symbolNamespaces 只是候选，含 data 段粘连噪声，不可当清单用。',
  _corrections:
    '2026-11-09 修正两处旧报告错误：(1) 旧报告称 name 段「已剥离」，实际 228922 字节、1655 个函数名全在；(2) 旧依赖清单只有 16 个 registry crate，漏掉 hashbrown/dlmalloc（正斜杠路径）与整个 protobuf 栈 csgoproto+prost。',
  sections: sections.map((s) => ({ id: s.id, size: s.size, custom: s.name })),
  sectionIds: sections.map((s) => s.id),

  // ── name 段：事实是「未剥离」 ──
  nameSection: {
    present: !!nameSec,
    bytes: nameSec ? nameSec.size : 0,
    moduleName: nameInfo.moduleName,
    subsections: nameInfo.subs,
    functionNameCount: nameInfo.funcNames.length,
    wasmBindgenShimCount: bindgen,
    authorSymbolCount: nameInfo.funcNames.length - bindgen,
  },

  ownSources: [...own].sort(),
  ownSourceCount: own.size,
  // ── 权威：源码路径里带版本号的 registry crate ──
  registryDepVersions: [...registry].sort(),
  registryDepCount: registry.size,
  allVersionedCratePaths: [...versionedPaths].sort(),
  allVersionedCrateCount: versionedPaths.size,
  // ── 权威：protobuf 栈（由完整 trait impl 路径确证）──
  protobufStack: protobuf,
  // ── 候选：符号里的命名空间（含 data 段粘连噪声，需人工判读）──
  symbolNamespaces: namespaceCounts,
  symbolNamespaceCaveat:
    'data 段字符串无 NUL 分隔，长度前缀字节会粘连（0x61="a" 贴 core → "acore"）。出现次数少的项多为噪声，不可直接当依赖清单。',
  // ── 自有源码模块结构（从 demangle 符号提取）──
  ownModuleMap: [...parserModules].sort(),
  symbolCountByCrate: parserSymCount,

  rustcCommits: [...rustcCommits],
  wasmBindgenHash: [...wbHash],

  exports: exports.filter((e) => !/^(__|memory$)/.test(e.name)),
  exportCount: exports.length,
  exportsAll: exports,
};

fs.mkdirSync(path.join(ROOT, 'wasm'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'wasm/report.json'), JSON.stringify(report, null, 2), 'utf8');

console.log('=== name 段（关键事实）===');
console.log(`  存在: ${report.nameSection.present}  大小: ${report.nameSection.bytes} 字节`);
console.log(`  函数名总数: ${report.nameSection.functionNameCount}`);
console.log(`  其中 wasm-bindgen 胶水: ${report.nameSection.wasmBindgenShimCount}`);
console.log(`  其中作者 Rust 符号: ${report.nameSection.authorSymbolCount}`);
console.log(`  模块名: ${report.nameSection.moduleName}`);
console.log('\n=== 依赖 ===');
console.log(`  registry 版本路径: ${report.registryDepCount} 个`);
console.log(`  全部 crate-版本/src 路径: ${report.allVersionedCrateCount} 个`);
console.log(`    ${report.allVersionedCratePaths.join(', ')}`);
console.log(`  protobuf trait impl: ${report.protobufStack.traitImplCount} 个消息类型`);
console.log(`  符号命名空间候选: ${Object.keys(report.symbolNamespaces).length} 个（含噪声，见 report`);
console.log(`  protobuf 栈: csgoproto=${protobuf.hasCsgoproto} prost=${protobuf.hasProst}`);
console.log(`\n=== 自有源码 ${report.ownSources.length} 个 ===`);
for (const s of report.ownSources) console.log(`  ${s}`);
console.log(`\n=== 导出面 ${report.exportCount} 个（应用面 ${report.exports.length}）===`);
console.log(`  ${report.exports.map((e) => e.name).join(', ')}`);
console.log(`\n已写入 wasm/report.json`);
