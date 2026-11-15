// ============================================================================
// shared_writer.h —— 把 DemoData 写进共享内存（C++ 版）
// ============================================================================
//
// 与 JS 侧的 planSharedBuffer() + writeSharedBuffer() 等价
// （src/deobfuscated/shared-buffer.js）。
//
// ── 三类数据的转换方式 ─────────────────────────────────────────────────────
//
//   1. SoA 列（frames / panelFrames / tracers / damage / weaponFires / smokeVoxels）
//      → 一次 memcpy 到固定偏移。49 块里 48 块都是这样。
//
//   2. blob 变长数组（trajectories.posXYZ、infernos.frames[].positions 等）
//      → memcpy 到 blob 游标 + 记录 {o, n, t} 引用。JSON 里只存这个引用。
//
//   3. 元数据对象（rounds / players / events / bomb / 等）
//      → 序列化成 JSON，写进元数据区（A/B 按 version 奇偶交替）。
//
// ── 为什么必须先 plan 再 write ─────────────────────────────────────────────
//
//   blob 的大小取决于 JSON 里引用了哪些变长数组 —— 而 JSON 又要在
//   computeSharedLayout 之前建好（因为 blob 块的大小是布局的一部分）。
//   所以是两阶段：planSharedBuffer() 建 JSON+blob 并算布局，writeTo() 才真正落盘。
//
// ── 写入顺序（不能乱）────────────────────────────────────────────────────────
//
//   ① 列块区（48 次 memcpy）
//   ② blob 区
//   ③ 元数据区（JSON，A/B 之一）
//   ④ header（最后写，相当于"提交"）
//   ⑤ 然后才 postMessage 通知 JS
//
//   ④ 必须在 ⑤ 之前，否则 JS 可能读到半成品。
//
// ── 编译要求 ─────────────────────────────────────────────────────────────
//
//   MSVC:  cl /std:c++17 /utf-8 /EHsc /W4
//   零第三方依赖（JSON 由本模块自带的极简 emitter 生成）。
//
// ============================================================================
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "demo_data.h"
#include "shared_layout.h"

namespace csdemo {

// ════════════════════════════════════════════════════════════════════════════
// 极简 JSON 生成器
// ════════════════════════════════════════════════════════════════════════════
//
// 只覆盖本模块需要的四种构造：对象、数组、字符串、数值。
// 为什么不用 nlohmann/json：保持零第三方依赖，且这里需求极窄。
//
// 浮点格式用 %.9g —— float 能精确 round-trip 的最短位数。
// JS 侧是 JSON.parse，任何合法 JSON 数字都接受。
// 非有限值（NaN/Inf）输出 null —— 与 JS 的 JSON.stringify 行为一致。
class JsonWriter {
public:
    void objBegin();
    void objEnd();
    void arrBegin();
    void arrEnd();
    void key(std::string_view k);
    void valStr(std::string_view v);
    void valI64(std::int64_t v);
    void valF32(float v);
    void valF64(double v);
    void valBool(bool v);
    void valNull();
    /// blob 引用：{"o":偏移,"n":元素数,"t":"f32"}
    void valBlobRef(std::uint32_t o, std::uint32_t n, const char* type);

    const std::string& str() const { return buf_; }
    void clear() { buf_.clear(); stack_.clear(); }

private:
    // 分隔符模型：每个「值」或「key」写之前判一次要不要逗号。
    //   afterKey_ = true 表示上一个 token 是 key（形如 "x":），紧随的值不要逗号。
    struct Frame { bool first = true; };
    void beforeValue();
    void beforeKey();
    void writeQuoted(std::string_view v);
    void put(std::string_view s) { buf_.append(s.data(), s.size()); }

    std::string buf_;
    std::vector<Frame> stack_;
    bool afterKey_ = false;
};

// ════════════════════════════════════════════════════════════════════════════
// blob 构造器
// ════════════════════════════════════════════════════════════════════════════
//
// 变长 TypedArray 顺序拼进一块连续内存，每段按 8 字节对齐。
// JSON 里存 {o, n, t}，JS 侧 new Float32Array(ab, blobOffset + o, n) —— 零拷贝。
class BlobBuilder {
public:
    /// 追加一段；返回 {o, n}。空数组返回 o=0,n=0（JSON 侧写 null）。
    struct Ref { std::uint32_t o = 0, n = 0; };

    template <typename T>
    Ref append(const std::vector<T>& v) {
        if (v.empty()) return {};
        const std::uint32_t o = static_cast<std::uint32_t>(bytes_.size());
        const std::size_t byteLen = v.size() * sizeof(T);
        const std::size_t old = bytes_.size();
        bytes_.resize(old + byteLen);
        std::memcpy(bytes_.data() + old, v.data(), byteLen);
        // 8 字节对齐（注意不是 64 —— 与 computeSharedLayout 的 blob 块对齐规则一致）
        const std::size_t aligned = ((bytes_.size() + kBlobAlign - 1) / kBlobAlign) * kBlobAlign;
        bytes_.resize(aligned, 0);
        return {o, static_cast<std::uint32_t>(v.size())};
    }

    std::size_t size() const { return bytes_.size(); }
    const std::vector<std::uint8_t>& bytes() const { return bytes_; }

private:
    std::vector<std::uint8_t> bytes_;
};

/// 类型名（写进 blob 引用的 "t" 字段）
template <typename T> constexpr const char* blobTypeName();
template <> constexpr const char* blobTypeName<float>() { return "f32"; }
template <> constexpr const char* blobTypeName<std::int32_t>() { return "i32"; }
template <> constexpr const char* blobTypeName<std::uint16_t>() { return "u16"; }
template <> constexpr const char* blobTypeName<std::uint8_t>() { return "u8"; }

// ════════════════════════════════════════════════════════════════════════════
// 规划结果
// ════════════════════════════════════════════════════════════════════════════
struct Plan {
    std::string metaJson;                  ///< 元数据 JSON 文本
    std::vector<std::uint8_t> blob;        ///< blob 区内容
    Layout layout;                         ///< 49 个块的位置
    std::size_t bytes = 0;                 ///< 整块共享内存需要多少字节
    std::uint32_t flags = 0;
    Counts counts{};
    std::uint32_t N = 0, P = 0, M = 0;
};

/// 建 JSON + blob 并算布局。不碰共享内存。
/// @throws std::invalid_argument DemoData 未通过 validate()
Plan planSharedBuffer(const DemoData& d);

// ════════════════════════════════════════════════════════════════════════════
// 写入
// ════════════════════════════════════════════════════════════════════════════
struct WriteResult {
    std::size_t bytes = 0;
    bool usedMetaA = true;
    std::size_t metadataJsonBytes = 0;
    std::size_t blobBytes = 0;
    unsigned blocksCopied = 0;
};

/**
 * 把 DemoData 整份写进 base 指向的共享内存。
 *
 * @param base       映射到的基址（主进程或子进程都可以，但只能有一个写者）
 * @param baseBytes  base 可用的字节数，必须 >= planSharedBuffer(d).bytes
 * @param d          数据（会先跑 validate，不通过就抛）
 * @param version    版本号；奇偶决定写元数据区 A 还是 B
 * @return           写入统计
 *
 * @throws std::invalid_argument 校验失败（what() 里带完整问题清单）
 * @throws std::length_error     baseBytes 不足
 */
WriteResult writeSharedBuffer(void* base, std::size_t baseBytes, const DemoData& d, std::uint32_t version);

/// 便捷：这块 data 需要多少字节（= planSharedBuffer(d).bytes）
std::size_t sharedBufferBytesFor(const DemoData& d);

/// 便捷：元数据用 A 还是 B（version 偶数 → A）
constexpr bool metaUsesA(std::uint32_t version) { return (version % 2) == 0; }

}  // namespace csdemo
