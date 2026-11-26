// The plugin's command parsing, on its own (no Hyprland needed):
//   make -C hyprland-plugin test
#include "../protocol.hpp"
#include <cassert>
#include <cstdio>

using namespace FlurryAnchor;

int main() {
    int n = 0;
    auto ok = [&](bool v, const char* what) { n++; if (!v) { std::fprintf(stderr, "FAIL: %s\n", what); std::exit(1); } };

    ok(parse("flurry ping").kind == SCommand::PING, "ping");
    ok(parse("/flurry ping").kind == SCommand::PING, "ping via socket form");

    auto s = parse("flurry set 0x55d0a1b2c3d0 top -16 -72 932 116 /run/user/1000/flurry-anchor/55d0a1b2c3d0-top-1.png");
    ok(s.kind == SCommand::SET, "set parses");
    ok(s.address == 0x55d0a1b2c3d0ULL, "address");
    ok(s.slot == 0 && s.ox == -16 && s.oy == -72 && s.w == 932 && s.h == 116, "geometry");
    ok(s.path == "/run/user/1000/flurry-anchor/55d0a1b2c3d0-top-1.png", "path");

    auto b = parse("flurry set 55d0a1b2c3d0 bottom -16 452 932 68 /tmp/a b.png\n");
    ok(b.kind == SCommand::SET && b.slot == 1 && b.path == "/tmp/a b.png", "bottom, path with a space, trailing newline");
    ok(parse("flurry set 0x1 top -1.5 -2.25 10 20 /x.png").ox == -1.5, "fractional offsets");

    // Exactly as lib/policy.js anchorSet writes it (Hyprland strips the
    // leading "/" first; the parser takes it either way).
    auto js = parse("/flurry set 0xabc top -16 -72 932.33 120 /run/user/1000/flurry-anchor/abc-top-1.png");
    ok(js.kind == SCommand::SET && js.address == 0xabc && js.w == 932.33 && js.path == "/run/user/1000/flurry-anchor/abc-top-1.png", "policy.js form");
    ok(parse("flurry set 0xabc top -16 -72 932.33 120 /run/user/1000/flurry-anchor/abc-top-1.png").kind == SCommand::SET, "after Hyprland strips the slash");

    ok(parse("flurry clear 0xabc").kind == SCommand::CLEAR && parse("flurry clear 0xabc").address == 0xabc, "clear");
    ok(parse("flurry clearall").kind == SCommand::CLEARALL, "clearall");

    ok(parse("flurry set zz top 0 0 1 1 /x.png").kind == SCommand::BAD, "bad address");
    ok(parse("flurry set 0x1 left 0 0 1 1 /x.png").kind == SCommand::BAD, "bad slot");
    ok(parse("flurry set 0x1 top 0 0 -1 1 /x.png").kind == SCommand::BAD, "negative size");
    ok(parse("flurry set 0x1 top 0 0 1 1 relative.png").kind == SCommand::BAD, "relative path");
    ok(parse("flurry set 0x1 top nan 0 1 1 /x.png").kind == SCommand::BAD, "nan rejected");
    ok(parse("flurry set 0x1 top 0 0 inf 1 /x.png").kind == SCommand::BAD, "inf rejected");
    ok(parse("flurry set 0x1 top 0 0 -inf 1 /x.png").kind == SCommand::BAD, "-inf rejected");
    ok(parse("flurry set 0x1 top 1,5 0 1 1 /x.png").kind == SCommand::BAD, "comma decimal rejected");
    ok(parse("flurry set 0x1 top 0 0 1").kind == SCommand::BAD, "missing fields");
    ok(parse("flurry dance").kind == SCommand::BAD, "unknown verb");
    ok(parse("clients").kind == SCommand::BAD, "not ours");

    std::printf("protocol: %d checks passed\n", n);
    return 0;
}
