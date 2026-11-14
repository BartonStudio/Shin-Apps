#pragma once

#include <iobject/IRuntimeObject.hpp>

#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <vector>

namespace gatekeeper {

/// 门禁应用的宿主侧原生对象：一张「通道 → 字节」的表 + 一个广播口 + 一个命令中转口。
///
/// **它不做网络、不认识 JSON、不认识门**。签名、HTTPS、会话生命周期、门状态字典全部在浏览器
/// JS 里（见 docs/gatekeeper-app-plan.md §0）。原生侧只负责三件事：
///
///   1. 把客户端写进来的通道值原样存下来，供任何客户端读取（无解析、无转换）；
///   2. 每次写入后发布一次 DataChannelChanged，让变更广播到**所有**连接（本 UI、inspector、脚本）；
///   3. 把 Invoke 请求翻译成一条 `Command` 通道内容并广播 —— 真正的执行者是没有网络能力的 JS，
///      所以命令必须借通道投递（§5：远端帧的载荷是派发瞬间对通道的快照）。
///
/// 通道（§4.2）：
///   - `SessionToken` 裸 token 字符串。**双向**：JS 登录成功后写它，外部也可直接写它（注入入口）。
///   - `SessionInfo`  JSON `{mobile,expireAt,loggedIn}`，纯展示。
///   - `Doors`        JSON `{D10Hall:{state,lastResult,at}, ...}`，纯展示。
///   - `Command`      `"verb:arg"` 文本。**只读**：它是输出通道，外部写入一律拒绝（§4.2 关键点 3）。
///   - `Log`          单行文本（滚动窗口由 JS 侧维护）。
///
/// 方法（§4.1）：
///   - `SetSession`    args = 裸 token。写 `SessionToken` 并广播；**不生成命令**。
///   - `RequestSms`    args = 手机号
///   - `RequestLogin`  args = `"手机号:验证码"`
///   - `RequestOpen`   args = 门名（如 `D10Hall`）
///     后三者等价于「往 `Command` 写 `"verb:arg"` 再广播」，C++ **只中转、不执行**。
///
/// ⚠️ 刻意**不声明** `kThreadSafe`：本对象的钩子只在 IObject 的循环线程上被调用，
/// 声明 `true` 只是关掉线程亲和断言，不提供任何并发安全。
class GateObject {
public:
    GateObject() = default;
    ~GateObject() = default;

    GateObject(const GateObject&) = delete;
    GateObject& operator=(const GateObject&) = delete;
    GateObject(GateObject&&) = delete;
    GateObject& operator=(GateObject&&) = delete;

    /// 框架在节点构造/析构时回调：记下自身节点指针（Publish 需要它）。
    void BindRuntime(iobject::IRuntimeObject* self);

    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const;
    bool WriteData(iobject::DataChannelView channel, iobject::ByteInput data);
    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result);

private:
    /// 内部写：直接落表，不做检查、不发信号。
    /// 它存在的唯一原因是 WriteData 里有「Command 只读」这条规则 —— 对象自己要写 Command 时必须
    /// 绕开它，而绕开的方式不能是「给 WriteData 加个布尔开关」（那等于把内部语义暴露成公开钩子的参数）。
    void assign(const std::string& channel, const std::string& value);

    /// 广播一次 DataChannelChanged。**必须在写完通道之后调用** —— 框架在派发瞬间同步
    /// ReadData(该通道) 取快照，顺序反了快照抓到的是旧值（§5）。
    void publish(const std::string& channel);

    /// 命令中转：assign("Command", "verb:arg") → publish → result(空)。
    /// 返回 false 表示参数不合法（空 arg），此时不写通道也不广播。
    bool forward(const char* verb, const std::string& arg, iobject::DataReceiver& result);

    iobject::IRuntimeObject* self_ = nullptr;
    // 通道名 → 原始字节。用 std::less<> 透明比较器，使 ReadData 能直接拿 DataChannelView
    // （= std::string_view）查表，不必每读一次就构造一个临时 std::string。
    std::map<std::string, std::vector<std::uint8_t>, std::less<>> channels_;
};

/// 创建 GateObject 并包装成运行时节点（调用方负责 delete 返回的节点）。
///
/// 宿主侧唯一的创建入口。它同时是**接口对齐的编译期验证**：`Runtime::make<T>` 是模板，
/// 鸭子类型探测（`ReadData` / `WriteData` / `Invoke` / `BindRuntime` 是否存在、签名是否匹配）
/// 只有在它被真正调用过一次时才会实例化 —— 少了这个函数，钩子签名写错了也会"编译通过"。
iobject::IRuntimeObject* makeGateNode();

}  // namespace gatekeeper
