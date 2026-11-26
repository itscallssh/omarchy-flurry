#pragma once

// The plugin's command line, kept free of Hyprland so it can be tested on
// its own (tests/protocol_test.cpp).
//
//   flurry ping
//   flurry set <address> <top|bottom> <ox> <oy> <w> <h> <png path>
//   flurry clear <address>
//   flurry clearall
//
// <address> is the window's address as hyprctl prints it (0x...). ox, oy:
// where the strip's top-left corner lies from the window's top-left corner;
// w, h: its size; all in layout px. The path is the rest of the line.

#include <charconv>
#include <cmath>
#include <cstdint>
#include <string>
#include <string_view>

#define FLURRY_ANCHOR_VERSION "1.0"

namespace FlurryAnchor {
    struct SCommand {
        enum eKind { BAD, PING, SET, CLEAR, CLEARALL } kind = BAD;
        uintptr_t   address = 0;
        int         slot    = 0; // 0 top, 1 bottom
        double      ox = 0, oy = 0, w = 0, h = 0;
        std::string path;
        std::string error;
    };

    inline std::string_view nextWord(std::string_view& s) {
        while (!s.empty() && (s.front() == ' ' || s.front() == '\t'))
            s.remove_prefix(1);
        size_t n = 0;
        while (n < s.size() && s[n] != ' ' && s[n] != '\t')
            n++;
        auto w = s.substr(0, n);
        s.remove_prefix(n);
        return w;
    }

    inline bool parseAddress(std::string_view w, uintptr_t& out) {
        if (w.starts_with("0x") || w.starts_with("0X"))
            w.remove_prefix(2);
        if (w.empty())
            return false;
        unsigned long long v = 0;
        auto [p, ec]         = std::from_chars(w.data(), w.data() + w.size(), v, 16);
        if (ec != std::errc() || p != w.data() + w.size())
            return false;
        out = static_cast<uintptr_t>(v);
        return true;
    }

    inline bool parseNumber(std::string_view w, double& out) {
        if (w.empty())
            return false;
        double v = 0;
        auto [p, ec] = std::from_chars(w.data(), w.data() + w.size(), v);
        if (ec != std::errc() || p != w.data() + w.size() || !std::isfinite(v))
            return false;
        out = v;
        return true;
    }

    inline SCommand parse(std::string_view s) {
        SCommand c;
        // "flurry" itself, as hyprctl hands on the whole request.
        auto first = nextWord(s);
        if (first == "/flurry" || first == "j/flurry")
            first = "flurry";
        if (first != "flurry") {
            c.error = "not a flurry command";
            return c;
        }
        const auto VERB = nextWord(s);
        if (VERB == "ping") {
            c.kind = SCommand::PING;
            return c;
        }
        if (VERB == "clearall") {
            c.kind = SCommand::CLEARALL;
            return c;
        }
        if (VERB != "set" && VERB != "clear") {
            c.error = "unknown verb";
            return c;
        }
        if (!parseAddress(nextWord(s), c.address)) {
            c.error = "bad address";
            return c;
        }
        if (VERB == "clear") {
            c.kind = SCommand::CLEAR;
            return c;
        }
        const auto SLOT = nextWord(s);
        if (SLOT != "top" && SLOT != "bottom") {
            c.error = "bad slot";
            return c;
        }
        c.slot = SLOT == "top" ? 0 : 1;
        if (!parseNumber(nextWord(s), c.ox) || !parseNumber(nextWord(s), c.oy) || !parseNumber(nextWord(s), c.w) || !parseNumber(nextWord(s), c.h) || c.w < 0 || c.h < 0) {
            c.error = "bad geometry";
            return c;
        }
        while (!s.empty() && (s.front() == ' ' || s.front() == '\t'))
            s.remove_prefix(1);
        while (!s.empty() && (s.back() == ' ' || s.back() == '\n' || s.back() == '\r'))
            s.remove_suffix(1);
        if (s.empty() || s.front() != '/') {
            c.error = "bad path";
            return c;
        }
        c.path = std::string(s);
        c.kind = SCommand::SET;
        return c;
    }
}
