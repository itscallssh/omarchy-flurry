#include "AnchorDeco.hpp"

#include <algorithm>
#include <cairo/cairo.h>

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/desktop/view/Window.hpp>
#include <hyprland/src/render/OpenGL.hpp>
#include <hyprland/src/render/Renderer.hpp>
#include <hyprutils/memory/Casts.hpp>

#include "AnchorPassElement.hpp"
#include "globals.hpp"

using namespace Hyprutils::Memory;

CFlurryAnchorDeco::CFlurryAnchorDeco(PHLWINDOW pWindow) : IHyprWindowDecoration(pWindow), m_window(pWindow) {
    m_lastPos  = pWindow->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
    m_lastSize = pWindow->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
}

CFlurryAnchorDeco::~CFlurryAnchorDeco() {
    damageEntire();
}

static SFlurryAnchor* anchorFor(const PHLWINDOW& w) {
    if (!w)
        return nullptr;
    const auto IT = g_anchors.find(rc<uintptr_t>(w.get()));
    return IT == g_anchors.end() ? nullptr : &IT->second;
}

void CFlurryAnchorDeco::refreshExtents() {
    const auto PWINDOW = m_window.lock();
    SBoxExtents e{};
    if (const auto A = anchorFor(PWINDOW)) {
        const auto SIZE = PWINDOW->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
        for (const auto& s : A->strips) {
            if (s.path.empty())
                continue;
            e.topLeft.x     = std::max(e.topLeft.x, -s.ox);
            e.topLeft.y     = std::max(e.topLeft.y, -s.oy);
            e.bottomRight.x = std::max(e.bottomRight.x, s.ox + s.w - SIZE.x);
            e.bottomRight.y = std::max(e.bottomRight.y, s.oy + s.h - SIZE.y);
        }
    }
    if (e.topLeft != m_extents.topLeft || e.bottomRight != m_extents.bottomRight) {
        damageEntire();
        m_extents = e;
        g_pDecorationPositioner->repositionDeco(this);
    }
    damageEntire();
}

SDecorationPositioningInfo CFlurryAnchorDeco::getPositioningInfo() {
    // Absolute: it reserves no space and moves nothing; it only says how far
    // past the window it draws, so moving the window damages that area too.
    SDecorationPositioningInfo info;
    info.policy         = DECORATION_POSITION_ABSOLUTE;
    info.desiredExtents = m_extents;
    info.edges          = DECORATION_EDGE_BOTTOM | DECORATION_EDGE_LEFT | DECORATION_EDGE_RIGHT | DECORATION_EDGE_TOP;
    return info;
}

void CFlurryAnchorDeco::onPositioningReply(const SDecorationPositioningReply& reply) {
    updateWindow(m_window.lock());
}

eDecorationType CFlurryAnchorDeco::getDecorationType() {
    return DECORATION_CUSTOM;
}

eDecorationLayer CFlurryAnchorDeco::getDecorationLayer() {
    // Over the window's own content (the ledge's foot and the frost lie on
    // its edge) but under its popups.
    return DECORATION_LAYER_OVER;
}

uint64_t CFlurryAnchorDeco::getDecorationFlags() {
    return DECORATION_NON_SOLID;
}

std::string CFlurryAnchorDeco::getDisplayName() {
    return "Flurry Anchor";
}

void CFlurryAnchorDeco::updateWindow(PHLWINDOW pWindow) {
    if (!pWindow)
        return;
    damageEntire();
    m_lastPos  = pWindow->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
    m_lastSize = pWindow->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
    damageEntire();
}

void CFlurryAnchorDeco::damageEntire() {
    const auto PWINDOW = m_window.lock();
    if (!PWINDOW)
        return;
    CBox box = {m_lastPos.x - m_extents.topLeft.x, m_lastPos.y - m_extents.topLeft.y, m_lastSize.x + m_extents.topLeft.x + m_extents.bottomRight.x,
                m_lastSize.y + m_extents.topLeft.y + m_extents.bottomRight.y};
    box.translate(PWINDOW->m_floatingOffset);
    if (box.w > 0 && box.h > 0)
        g_pHyprRenderer->damageBox(box.expand(2));
}

void CFlurryAnchorDeco::draw(PHLMONITOR pMonitor, float const& a) {
    if (!validMapped(m_window))
        return;
    const auto PWINDOW = m_window.lock();
    if (!PWINDOW->m_ruleApplicator->decorate().valueOrDefault())
        return;
    if (anchorsStale()) {
        if (!g_anchors.empty())
            g_anchors.clear();
        if (m_extents.topLeft != Vector2D{} || m_extents.bottomRight != Vector2D{}) {
            damageEntire();
            m_extents = {};
        }
        return;
    }
    if (!anchorFor(PWINDOW))
        return;

    CFlurryAnchorPassElement::SData data;
    data.deco = this;
    data.a    = a;
    g_pHyprRenderer->m_renderPass.add(makeUnique<CFlurryAnchorPassElement>(data));
}

void CFlurryAnchorDeco::drawPass(PHLMONITOR pMonitor, float const& a) {
    const auto PWINDOW = m_window.lock();
    if (!PWINDOW || !pMonitor)
        return;
    auto* const A = anchorFor(PWINDOW);
    if (!A)
        return;

    // Where the compositor draws the window in this frame: its animated
    // position (what a drag moves), plus the offsets every decoration takes.
    const auto PWORKSPACE      = PWINDOW->m_workspace;
    const auto WORKSPACEOFFSET = PWORKSPACE && !PWINDOW->m_pinned ? PWORKSPACE->m_renderOffset->value() : Vector2D();
    const auto ORIGIN          = PWINDOW->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT) + PWINDOW->m_floatingOffset + WORKSPACEOFFSET - pMonitor->m_position;

    for (auto& s : A->strips) {
        if (s.path.empty())
            continue;
        // A new picture: load it here, where the GL context is current.
        if (s.seq != s.loadedSeq) {
            s.loadedSeq = s.seq;
            s.tex.reset();
            const auto CAIRO = cairo_image_surface_create_from_png(s.path.c_str());
            if (CAIRO && cairo_surface_status(CAIRO) == CAIRO_STATUS_SUCCESS)
                s.tex = g_pHyprRenderer->createTexture(CAIRO);
            if (CAIRO)
                cairo_surface_destroy(CAIRO);
        }
        if (!s.tex || s.w < 1 || s.h < 1)
            continue;
        CBox box = {ORIGIN.x + s.ox, ORIGIN.y + s.oy, s.w, s.h};
        box.scale(pMonitor->m_scale).round();
        Render::GL::g_pHyprOpenGL->renderTexture(s.tex, box, {.a = a});
    }
}
