#pragma once

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Logger.hpp>
#include <iobject/RuntimeDomain.hpp>

#include <functional>
#include <string>

// =============================================================================
// 全局运行时域：进程内唯一的一棵对象树。
//
// 这里解决的是「域名与根对象双双硬编码」这个结构问题：早先这两样是编译期常量
// （域名叫 shininspector、根是 InspectorRoot），于是第二个方案想挂自己的域就只能
// 把这份装配代码抄一遍 —— 而 RuntimeDomain 的注释写得很清楚，「一个活动
// IRuntimeObject 同一时刻有且仅属于一个域」，抄一份出来的不是第二个域，
// 是第二份互相打架的宿主。
//
// 现在两样都由方案在启动时注入，平台自己不认识任何方案。
// =============================================================================

namespace shin::host {

/// 本进程唯一对象树的描述。
struct DomainSpec {
    /// 域名 = 「域路由键」：远程客户端 Connect 时用同名字符串声明要连哪棵树。
    /// 也必须与 app.json 的 connect.domain 一致，否则前端按清单填的域会被服务端拒绝。
    std::string name;

    /// 域根节点的构造方式，返回的节点所有权交给域（域析构时 delete）。
    ///
    /// 为什么要注入类型而不写死：域根同时是**日志汇聚点**（各方案的根节点都把
    /// Invoke("Log") 转发给 iobject::Logger，见 apps/inspector/native/InspectorRoot.hpp），
    /// 而「根上还挂什么」是方案的领域知识。写死一个类型等于把某个方案焊进平台。
    std::function<iobject::IRuntimeObject*()> makeRoot;
};

/// 配置本进程的运行时域。必须在使用 Domain() / Root() 之前调用，且只能调一次。
///
/// 重复配置、或未配置就使用，都会抛 std::logic_error —— 两种都是装配错误，
/// 静默兜底只会把问题推到更远的地方才发作（症状通常变成"前端连不上"）。
void ConfigureDomain(DomainSpec spec);

/// 本进程唯一的运行时域（懒初始化：首次访问时按 DomainSpec 创建）。
iobject::RuntimeDomain& Domain();

/// 域持有的根锚点。业务方用 Connect 把对象接入它的子树。
iobject::IRuntimeObject* Root();

} // namespace shin::host

// =============================================================================
// 分级日志宏：替代「找 domain 根节点 → Invoke("Log") 打印」的复杂写法
//   用法：LOG_INFO("App", "hello");
//
// 日志落到**当前方案自己的域根**上（Root() 由 DomainSpec::name 决定），
// 所以同一份代码在任意方案里都会写进它自己的域，不会串台。
// =============================================================================
#define LOG_TRACE(tag, msg) ::shin::host::Root()->Invoke("Log", iobject::EncodeLogMessage(iobject::LogLevel::Trace, (tag), (msg)), [](iobject::ByteView) {})
#define LOG_DEBUG(tag, msg) ::shin::host::Root()->Invoke("Log", iobject::EncodeLogMessage(iobject::LogLevel::Debug, (tag), (msg)), [](iobject::ByteView) {})
#define LOG_INFO(tag, msg)  ::shin::host::Root()->Invoke("Log", iobject::EncodeLogMessage(iobject::LogLevel::Info, (tag), (msg)), [](iobject::ByteView) {})
#define LOG_WARN(tag, msg)  ::shin::host::Root()->Invoke("Log", iobject::EncodeLogMessage(iobject::LogLevel::Warning, (tag), (msg)), [](iobject::ByteView) {})
#define LOG_ERROR(tag, msg) ::shin::host::Root()->Invoke("Log", iobject::EncodeLogMessage(iobject::LogLevel::Error, (tag), (msg)), [](iobject::ByteView) {})
