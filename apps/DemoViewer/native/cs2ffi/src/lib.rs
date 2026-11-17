//! cs2ffi —— demoparser（LaihoE，vendored）的 C ABI 封装。
//!
//! 分层：
//!   C++ (DemoLoader)
//!     └─ extern "C" 导出（步骤 3，见 src/ffi.rs）
//!          └─ 本 crate 内部 Rust API（parse 模块）
//!               └─ vendor/demoparser/src/parser（真正的解析器）
//!
//! 步骤 2 先落地字段验证工具（src/bin/dump_fields.rs），
//! FFI 导出面在第 3 步定型后补上。

pub mod ffi;
pub mod parse;
