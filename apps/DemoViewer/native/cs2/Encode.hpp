#pragma once

#include <cstdint>
#include <span>
#include <vector>

#include <nlohmann/json.hpp>

#include "EntityTypes.hpp"

// =============================================================================
// 通道数据编码辅助：MessagePack 二进制
//
// 为什么用 nlohmann::json::to_msgpack 而不是 msgpack11：
//   - msgpack11 是 IObject 的 PRIVATE 依赖，业务层拿不到头文件；
//   - nlohmann/json 经 shin_host PUBLIC 暴露，to_msgpack 输出标准 MessagePack；
//   - 前端 iobject-js 已依赖 @msgpack/msgpack，可直接 decode。
//
// 编码约定见 docs/cs2-demo-player-architecture.md §4.8。
// =============================================================================

namespace demoviewer {

/// 把 nlohmann::json 编码成 MessagePack 二进制字节。
/// 前端拿到的通道字节（bin）直接丢给 @msgpack/msgpack 的 decode() 即可。
inline std::vector<std::uint8_t> EncodeMsgPack(const nlohmann::json& value) {
    return nlohmann::json::to_msgpack(value);
}

/// 把字节视图交给 IObject 的 DataReceiver（字节仅在 receiver 调用期间有效）。
/// 用法：SendBytes(EncodeMsgPack(j), std::move(receiver));
template <typename Receiver>
inline void SendBytes(const std::vector<std::uint8_t>& bytes, Receiver&& receiver) {
    receiver(std::span<const std::uint8_t>(bytes.data(), bytes.size()));
}

// ---- 常用小工具：几何量 → json ----

inline nlohmann::json ToJson(const Vec3& v) {
    return nlohmann::json::array({v.x, v.y, v.z});
}

inline nlohmann::json ToJson(const ViewAngle& a) {
    return nlohmann::json::array({a.pitch, a.yaw});
}

} // namespace demoviewer
