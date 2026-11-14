#include "GateObject.hpp"

#include <iobject/Runtime.hpp>   // Runtime::make<DataChannelChangedEventData>

#include <array>
#include <cstdint>

namespace gatekeeper {
namespace {

/// 通道名白名单 —— 与 §4.2 的表格一一对应。
/// ReadData 用它区分「通道名不认识」（失败）和「认识但从未写过」（空值）。
constexpr std::array<iobject::DataChannelView, 5> kKnownChannels{
    "SessionToken", "SessionInfo", "Doors", "Command", "Log"};

bool isKnownChannel(const iobject::DataChannelView channel) {
    for (const iobject::DataChannelView known : kKnownChannels) {
        if (channel == known) {
            return true;
        }
    }
    return false;
}

/// ByteInput → std::string。空输入返回空串，避免 std::string(nullptr, 0) 这种未定义行为。
std::string toText(const iobject::ByteInput bytes) {
    if (bytes.empty()) {
        return {};
    }
    return std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}

}  // namespace

void GateObject::BindRuntime(iobject::IRuntimeObject* self) {
    self_ = self;
}

void GateObject::assign(const std::string& channel, const std::string& value) {
    std::vector<std::uint8_t>& slot = channels_[channel];   // 通道不存在时默认构造出空 vector
    slot.assign(value.begin(), value.end());                // 覆盖，不追加（通道是槽位，不是日志）
}

void GateObject::publish(const std::string& channel) {
    if (self_ == nullptr) {
        return;   // 未 BindRuntime 过（不该发生）——静默跳过，绝不 deref 空指针
    }
    self_->Publish(iobject::RuntimeEventTypes::DataChannelChanged,
                   iobject::Runtime::make<iobject::DataChannelChangedEventData>(channel),
                   /*destroyDataAfterPublish=*/true);
}

bool GateObject::ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
    if (!isKnownChannel(channel)) {
        return false;   // 通道名不认识 → 协议层回 OperationFailed "对象拒绝读取通道: x"
    }
    const auto it = channels_.find(channel);
    if (it == channels_.end()) {
        receiver(iobject::ByteView{});   // 认识、但从未写过：空数据是成功结果（IRuntimeObject.hpp:201-202）
        return true;
    }
    receiver(iobject::ByteView(it->second.data(), it->second.size()));
    return true;
}

bool GateObject::WriteData(iobject::DataChannelView channel, iobject::ByteInput data) {
    if (channel == "Command") {
        // 输出通道，不是输入：外部写的值永远不会被派发（WriteData 不自动发事件，远端也没有 Publish），
        // 下次对象自己写时还会被覆盖。与其"写成功了却什么都不发生"，不如立刻拒绝。
        // 注意这**不是权限控制** —— 触发开门的口子是 Invoke("RequestOpen")，那正是设计意图。
        return false;
    }
    if (!isKnownChannel(channel)) {
        return false;   // 拼错的通道名立刻可见，不被静默吞掉
    }
    assign(std::string(channel), toText(data));
    publish(std::string(channel));
    return true;
}

bool GateObject::Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
    if (method == "SetSession") {
        // 同步完成：只写通道 + 广播，不生成命令、不需要 JS 参与。
        // 空 token 是合法输入 —— 写入空值即「清空会话」（登出）。
        const std::string token = toText(args);
        assign("SessionToken", token);
        publish("SessionToken");
        result(iobject::ByteView{});
        return true;
    }
    if (method == "RequestSms") {
        return forward("Sms", toText(args), result);
    }
    if (method == "RequestLogin") {
        return forward("Login", toText(args), result);
    }
    if (method == "RequestOpen") {
        return forward("Open", toText(args), result);
    }
    return false;   // 未知方法：返回 false，框架不会回调 result
}

bool GateObject::forward(const char* verb, const std::string& arg, iobject::DataReceiver& result) {
    if (arg.empty()) {
        // 结构规则，不是业务判断：命令必须带参数，否则会广播出 "Open:" 这种空指令，
        // 前端只能丢弃它，而调用方却以为命令已发出。
        return false;
    }
    assign("Command", std::string(verb) + ":" + arg);   // 纯拼接：无 JSON、无转义
    publish("Command");                                 // 先写通道，再发信号，顺序不能反
    result(iobject::ByteView{});                         // 空 = "命令已广播"，执行结果由 JS 回写通道
    return true;
}

iobject::IRuntimeObject* makeGateNode() {
    return iobject::Runtime::make<GateObject>();
}

}  // namespace gatekeeper
