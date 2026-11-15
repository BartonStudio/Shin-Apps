// ============================================================================
// shared_reader.h —— 共享内存镜像 → DemoData（writer 的逆操作）
// ============================================================================
//
// 用途有两个：
//   1. **对接验证**：读 JS 产出的镜像 → 构造 DemoData → 再写出 → 比对，
//      证明 C++ 的 DemoData 映射是双向正确的
//   2. 调试：C++ 侧想确认"页面到底能看到什么数据"时，可以把镜像读回来检查
//
// 注意：**生产链路不需要读**。正常流程是「解析器 → DemoData → 写共享内存」，
//       这里是反向的，只用于验证与排查。
//
// 编译要求：MSVC /utf-8
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>

#include "demo_data.h"

namespace csdemo {

/// 可见水位。读镜像时用来把 vector 截到"已发布"的范围内。
/// 全量镜像（visible == capacity）可以全部留空，reader 会自动用容量。
struct Visible {
    std::uint32_t visibleFrames = 0;        ///< 0 = 用容量
    std::uint32_t panelVisibleFrames = 0;   ///< 0 = 用容量
    double durationSeconds = 0.0;           ///< 0 = 用 meta 里的值
};

/**
 * 读一块共享内存镜像，构造 DemoData。
 *
 * @param base       镜像基址
 * @param bytes      镜像字节数
 * @param visible    可见水位；默认（全 0）表示全量
 * @return DemoData；meta.numFrames / panelFrames.numFrames 会按 visible 设置，
 *         但各列 vector 保留**容量**长度（与写入侧一致）
 *
 * @throws std::runtime_error magic 不符 / 元数据区损坏 / JSON 语法错误 / 缓冲不足
 */
DemoData readSharedBufferToDemoData(const void* base, std::size_t bytes, Visible visible = {});

/// 便捷：从文件读
DemoData readSharedBufferFile(const char* path, Visible visible = {});

}  // namespace csdemo
