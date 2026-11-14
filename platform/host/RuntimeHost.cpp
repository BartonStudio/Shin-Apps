#include "RuntimeHost.hpp"

#include <memory>
#include <stdexcept>
#include <utility>

namespace shin::host {
namespace {

struct State {
    DomainSpec spec;
    bool configured = false;
    std::unique_ptr<iobject::RuntimeDomain> domain;
};

State& S() {
    static State s;
    return s;
}

} // namespace

void ConfigureDomain(DomainSpec spec) {
    State& s = S();
    if (s.configured) {
        throw std::logic_error("ConfigureDomain: 运行时域已配置，进程内只允许一个域");
    }
    if (spec.name.empty()) {
        // 空名不可被 BindDomain 路由（RuntimeDomain 的注释：空名表示未命名），
        // 前端会拿到 DomainNotFound —— 与其等运行时握手失败，不如在这里拒掉。
        throw std::logic_error("ConfigureDomain: 域名不能为空");
    }
    if (!spec.makeRoot) {
        throw std::logic_error("ConfigureDomain: makeRoot 未提供");
    }

    s.spec = std::move(spec);
    s.configured = true;
}

iobject::RuntimeDomain& Domain() {
    State& s = S();
    if (!s.configured) {
        throw std::logic_error("Domain(): 运行时域尚未配置 —— 先调用 shin::host::ConfigureDomain()");
    }
    if (!s.domain) {
        // 到这里才真正建域：root 的所有权移交 RuntimeDomain（它析构时 delete）。
        s.domain = std::make_unique<iobject::RuntimeDomain>(s.spec.makeRoot(), s.spec.name);
    }
    return *s.domain;
}

iobject::IRuntimeObject* Root() {
    return Domain().RootAnchor();
}

} // namespace shin::host
