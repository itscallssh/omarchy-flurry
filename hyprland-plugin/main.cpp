#define WLR_USE_UNSTABLE

#include <unistd.h>

#include <algorithm>
#include <charconv>
#include <sstream>

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/desktop/view/Window.hpp>
#include <hyprland/src/desktop/state/WindowState.hpp>
#include <hyprland/src/render/Renderer.hpp>
#include <hyprland/src/event/EventBus.hpp>

#include "AnchorDeco.hpp"
#include "globals.hpp"
#include "protocol.hpp"

// Do NOT change this function.
APICALL EXPORT std::string PLUGIN_API_VERSION() {
    return HYPRLAND_API_VERSION;
}

static CFlurryAnchorDeco* decoOf(const PHLWINDOW& w) {
    for (const auto& d : w->m_windowDecorations)
        if (d->getDisplayName() == "Flurry Anchor")
            return dc<CFlurryAnchorDeco*>(d.get());
    return nullptr;
}

static void addDeco(PHLWINDOW w) {
    if (!w || decoOf(w))
        return;
    HyprlandAPI::addWindowDecoration(PHANDLE, w, makeUnique<CFlurryAnchorDeco>(w));
}

static PHLWINDOW windowByAddress(uintptr_t addr) {
    for (const auto& w : Desktop::windowState()->windows())
        if (rc<uintptr_t>(w.get()) == addr)
            return w;
    return nullptr;
}

// `hyprctl flurry ...` (or the same request on Hyprland's socket; Flurry
// sends them batched: "[[BATCH]]flurry set ...;flurry set ...").
static std::string onCommand(eHyprCtlOutputFormat, std::string request) {
    const auto CMD = FlurryAnchor::parse(request);
    if (CMD.kind != FlurryAnchor::SCommand::BAD)
        g_lastHeard = std::chrono::steady_clock::now();
    switch (CMD.kind) {
        case FlurryAnchor::SCommand::PING: return "flurry-anchor ok " FLURRY_ANCHOR_VERSION;
        case FlurryAnchor::SCommand::SET: {
            const auto W = windowByAddress(CMD.address);
            if (!W)
                return "flurry-anchor error: no such window";
            if (!W->m_ruleApplicator->decorate().valueOrDefault())
                return "flurry-anchor error: window undecorated";
            auto& strip     = g_anchors[CMD.address].strips[CMD.slot];
            strip.path      = CMD.path;
            strip.ox        = CMD.ox;
            strip.oy        = CMD.oy;
            strip.w         = CMD.w;
            strip.h         = CMD.h;
            strip.seq++;
            addDeco(W);
            if (const auto D = decoOf(W))
                D->refreshExtents();
            return "ok";
        }
        case FlurryAnchor::SCommand::CLEAR: {
            g_anchors.erase(CMD.address);
            if (const auto W = windowByAddress(CMD.address))
                if (const auto D = decoOf(W))
                    D->refreshExtents();
            return "ok";
        }
        case FlurryAnchor::SCommand::CLEARALL: {
            g_anchors.clear();
            for (const auto& w : Desktop::windowState()->windows())
                if (const auto D = decoOf(w))
                    D->refreshExtents();
            return "ok";
        }
        default: return "flurry-anchor error: " + CMD.error;
    }
}

APICALL EXPORT PLUGIN_DESCRIPTION_INFO PLUGIN_INIT(HANDLE handle) {
    PHANDLE = handle;

    const std::string HASH        = __hyprland_api_get_hash();
    const std::string CLIENT_HASH = __hyprland_api_get_client_hash();

    if (HASH != CLIENT_HASH) {
        HyprlandAPI::addNotification(PHANDLE, "[flurry-anchor] Version mismatch: rebuild the plugin for this Hyprland (hyprpm update)", CHyprColor{1.0, 0.2, 0.2, 1.0}, 6000);
        throw std::runtime_error("[flurry-anchor] Version mismatch");
    }

    HyprlandAPI::registerHyprCtlCommand(PHANDLE, SHyprCtlCommand{.name = "flurry", .exact = false, .fn = onCommand});

    static auto POPEN  = Event::bus()->m_events.window.open.listen([](PHLWINDOW w) { addDeco(w); });
    static auto PCLOSE = Event::bus()->m_events.window.close.listen([](PHLWINDOW w) {
        // Whatever lay on it goes with it: nothing is left where it was.
        if (w)
            g_anchors.erase(rc<uintptr_t>(w.get()));
    });

    for (const auto& w : Desktop::windowState()->windows()) {
        if (w->isHidden() || !validMapped(w))
            continue;
        addDeco(w);
    }

    return {"flurry-anchor", "Keeps Flurry's frost, snow ledges and icicles on their windows, frame for frame.", "Flurry", FLURRY_ANCHOR_VERSION};
}

APICALL EXPORT void PLUGIN_EXIT() {
    g_anchors.clear();
    g_pHyprRenderer->m_renderPass.removeAllOfType("CFlurryAnchorPassElement");
}
