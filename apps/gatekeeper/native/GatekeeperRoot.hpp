#pragma once

#include <iobject/IRuntimeObject.hpp>
#include <iobject/Logger.hpp>

// 本方案的域根节点：组合运行时内置的 Logger，并把鸭子类型钩子转发给 Logger。
//
// 域根是「平台 / 方案」接缝的一部分 —— 平台不认识这个类型，只通过
// shin::host::DomainSpec::makeRoot 拿到它（见 platform/host/RuntimeHost.hpp）；
// LOG_* 宏最终也是落到这里。方案要挂的业务对象接在它的子树上（root → Gate，见 §7）。
//
// ⚠️ 与 apps/inspector/native/InspectorRoot.hpp 逐行等价（只差命名空间）。
// 这不是"方案知识"的重复，而是**平台缺失的抽象**：域根该不该由平台统一提供，
// 是 docs/gatekeeper-app-plan.md §10 待决的问题 —— 在决定之前先如实复制，
// 好让"加一个方案要改几处平台代码"这个度量保持干净。
class GatekeeperRoot {
public:
    /// 标记：转发到线程安全的 Logger，叶子操作可跨线程。
    static constexpr bool kThreadSafe = true;

    // ---- IObject 鸭子类型钩子：转发给组合的 Logger ----
    void BindRuntime(iobject::IRuntimeObject* self) { m_logger.BindRuntime(self); }

    bool WriteData(iobject::DataChannelView channel, iobject::ByteInput data) {
        return m_logger.WriteData(channel, data);
    }

    bool ReadData(iobject::DataChannelView channel, iobject::DataReceiver receiver) const {
        return m_logger.ReadData(channel, receiver);
    }

    bool Invoke(iobject::MethodView method, iobject::ByteInput args, iobject::DataReceiver result) {
        return m_logger.Invoke(method, args, result);
    }

private:
    iobject::Logger m_logger;
};
