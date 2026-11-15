// ============================================================================
// mini_json.h —— 极简 JSON 解析器（只为本项目的元数据区服务）
// ============================================================================
//
// 为什么需要它：共享内存的元数据区是一段 JSON（由 shared_writer 生成、JS 的 JSON.parse 读取）。
// C++ 侧要把它读回 DemoData，就需要一个解析器。为了保持**零第三方依赖**，这里手写一个。
//
// 支持范围（足够覆盖本项目产出的全部 JSON）：
//   · object / array / string / number / true / false / null
//   · 字符串转义：\" \\ \/ \b \f \n \r \t \uXXXX（\u 只在 BMP 内，且按 UTF-8 输出）
//   · 不做流式解析、不支持注释与尾随逗号 —— 我们的产出里没有这些
//
// 不追求：极致性能、错误恢复、超大文件。元数据区实测约 467 KB，够用。
//
// 编译要求：MSVC /utf-8（本文件含中文注释）
// ============================================================================
#pragma once

#include <cstdint>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace csdemo::json {

class Value {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    Type type = Type::Null;
    bool boolean = false;
    double number = 0.0;
    std::string string;
    std::vector<Value> array;
    std::vector<std::pair<std::string, Value>> object;   // 保序，便于调试

    bool isNull() const { return type == Type::Null; }
    bool isArr() const { return type == Type::Array; }
    bool isObj() const { return type == Type::Object; }

    /// 取对象成员；不存在返回 nullptr
    const Value* find(std::string_view key) const {
        if (type != Type::Object) return nullptr;
        for (const auto& kv : object) {
            if (kv.first == key) return &kv.second;
        }
        return nullptr;
    }

    // ── 带默认值的安全取值 ──
    double num(double def = 0.0) const { return type == Type::Number ? number : def; }
    std::int64_t i64(std::int64_t def = 0) const { return type == Type::Number ? static_cast<std::int64_t>(number) : def; }
    std::uint32_t u32(std::uint32_t def = 0) const { return type == Type::Number ? static_cast<std::uint32_t>(number) : def; }
    float f32v(float def = 0.f) const { return type == Type::Number ? static_cast<float>(number) : def; }
    bool boolv(bool def = false) const { return type == Type::Bool ? boolean : def; }
    const std::string& str() const {
        static const std::string kEmpty;
        return type == Type::String ? string : kEmpty;
    }
};

namespace detail {

struct Parser {
    std::string_view s;
    std::size_t i = 0;

    [[noreturn]] void fail(const char* what) const {
        throw std::runtime_error(std::string("mini_json: ") + what + " at offset " + std::to_string(i));
    }

    void skipWs() {
        while (i < s.size()) {
            const char c = s[i];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') { ++i; continue; }
            break;
        }
    }
    bool eof() const { return i >= s.size(); }

    char peek() const { return i < s.size() ? s[i] : '\0'; }
    char take() { return i < s.size() ? s[i++] : '\0'; }

    void expect(char c) {
        if (take() != c) fail("unexpected character");
    }

    static void appendUtf8(std::string& out, unsigned cp) {
        if (cp < 0x80) { out.push_back(static_cast<char>(cp)); return; }
        if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
            return;
        }
        if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
            return;
        }
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }

    std::string parseString() {
        expect('"');
        std::string out;
        while (!eof()) {
            const char c = take();
            if (c == '"') return out;
            if (c != '\\') { out.push_back(c); continue; }
            const char e = take();
            switch (e) {
                case '"':  out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/':  out.push_back('/'); break;
                case 'b':  out.push_back('\b'); break;
                case 'f':  out.push_back('\f'); break;
                case 'n':  out.push_back('\n'); break;
                case 'r':  out.push_back('\r'); break;
                case 't':  out.push_back('\t'); break;
                case 'u': {
                    unsigned cp = 0;
                    for (int k = 0; k < 4; k++) {
                        const char h = take();
                        unsigned d;
                        if (h >= '0' && h <= '9') d = static_cast<unsigned>(h - '0');
                        else if (h >= 'a' && h <= 'f') d = static_cast<unsigned>(h - 'a' + 10);
                        else if (h >= 'A' && h <= 'F') d = static_cast<unsigned>(h - 'A' + 10);
                        else { fail("bad \\u escape"); }
                        cp = cp * 16 + d;
                    }
                    // 代理对：只处理 BMP 内的，够本项目用（我们的字符串是中文/ASCII）
                    appendUtf8(out, cp);
                    break;
                }
                default: fail("bad escape");
            }
        }
        fail("unterminated string");
    }

    Value parseNumber() {
        const std::size_t start = i;
        if (peek() == '-' || peek() == '+') ++i;
        while (!eof()) {
            const char c = peek();
            if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') ++i;
            else break;
        }
        if (i == start) fail("bad number");
        Value v;
        v.type = Value::Type::Number;
        v.number = std::strtod(std::string(s.substr(start, i - start)).c_str(), nullptr);
        return v;
    }

    Value parseValue() {
        skipWs();
        const char c = peek();
        if (c == '{') return parseObject();
        if (c == '[') return parseArray();
        if (c == '"') { Value v; v.type = Value::Type::String; v.string = parseString(); return v; }
        if (c == 't') { expectWord("true"); Value v; v.type = Value::Type::Bool; v.boolean = true; return v; }
        if (c == 'f') { expectWord("false"); Value v; v.type = Value::Type::Bool; v.boolean = false; return v; }
        if (c == 'n') { expectWord("null"); return Value{}; }
        return parseNumber();
    }

    void expectWord(const char* w) {
        for (const char* p = w; *p; ++p) {
            if (take() != *p) fail("bad literal");
        }
    }

    Value parseObject() {
        expect('{');
        Value v;
        v.type = Value::Type::Object;
        skipWs();
        if (peek() == '}') { ++i; return v; }
        for (;;) {
            skipWs();
            std::string k = parseString();
            skipWs();
            expect(':');
            Value val = parseValue();
            v.object.emplace_back(std::move(k), std::move(val));
            skipWs();
            const char c = take();
            if (c == ',') continue;
            if (c == '}') return v;
            fail("expected , or } in object");
        }
    }

    Value parseArray() {
        expect('[');
        Value v;
        v.type = Value::Type::Array;
        skipWs();
        if (peek() == ']') { ++i; return v; }
        for (;;) {
            v.array.push_back(parseValue());
            skipWs();
            const char c = take();
            if (c == ',') continue;
            if (c == ']') return v;
            fail("expected , or ] in array");
        }
    }
};

}  // namespace detail

/// 解析一段 JSON 文本
/// @throws std::runtime_error 语法错误（消息里带偏移）
inline Value parse(std::string_view text) {
    detail::Parser p{text};
    Value v = p.parseValue();
    p.skipWs();
    if (!p.eof()) p.fail("trailing garbage");
    return v;
}

}  // namespace csdemo::json
