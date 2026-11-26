import QtQuick
import "lib/draw.js" as Draw
import "lib/sim.js" as Sim

// A tree, snowman, gift or note on the desktop. It stands where its saved
// place says, rides its window when it has one, and can be dragged, sent to
// a friend, or decorated.
Item {
  id: root

  property var scene: null
  property string kind: "snowman"
  property var item: null

  readonly property real baseW: kind === "tree" ? 150 : (kind === "snowman" ? 74 : 44)
  readonly property real baseH: kind === "tree" ? 215 : (kind === "snowman" ? 128 : (kind === "gift" && item && item.kind === "note" ? 34 : 44))
  readonly property real size: item && item.size ? item.size : 1
  width: baseW * size
  height: baseH * size

  readonly property var feet: scene && item ? scene.feetFor(item.place, kind === "snowman" ? width * 0.36 : 0) : null
  property bool dragging: false
  property real dragX: 0
  property real dragY: 0

  x: dragging ? dragX : (feet ? feet.x - width / 2 : 0)
  y: dragging ? dragY : (feet ? feet.y - height + (kind === "tree" ? 2 : 1) : 0)
  visible: dragging || feet !== null

  // Something standing on a window rocks when the window is dragged: the
  // window's acceleration tips it back, a damped spring rights it. It is
  // planted (snowmen are frozen to their spot), so it never falls off.
  readonly property string riding: feet && feet.surface ? feet.surface : ""
  property real tilt: 0
  property real tiltSpeed: 0
  transformOrigin: Item.Bottom
  rotation: tilt
  // A snow globe shake rocks everything, riding a window or not.
  readonly property bool shaken: !!scene && scene.clock - scene.shakeAt < 2.5
  FrameAnimation {
    running: root.visible && !root.dragging && root.scene
             && ((root.riding !== "" && root.scene.windowsMoving) || root.shaken || Math.abs(root.tilt) > 0.05 || Math.abs(root.tiltSpeed) > 0.05)
    onTriggered: {
      var dt = Math.min(frameTime, 0.05)
      var m = root.scene.world && root.riding !== "" ? Sim.surfaceMotion(root.scene.world, root.riding) : null
      // Degrees of lean per px/s² of sideways acceleration, capped.
      var push = m ? Math.max(-14, Math.min(14, -m.ax * 0.004)) : 0
      var since = root.scene.clock - root.scene.shakeAt
      if (since < 0.6) push += Math.sin(since * 34) * 9 * (1 - since / 0.6)
      var stiffness = 90, damping = 9
      root.tiltSpeed += ((push - root.tilt) * stiffness - root.tiltSpeed * damping) * dt
      root.tilt += root.tiltSpeed * dt
      if (!root.scene.windowsMoving && !root.shaken && Math.abs(root.tilt) < 0.05 && Math.abs(root.tiltSpeed) < 0.05) { root.tilt = 0; root.tiltSpeed = 0 }
    }
  }

  // A freshly planted tree grows; a fresh snowman is rolled ball by ball.
  property real growth: 1
  // The item can arrive a moment after the delegate is made (the scene's
  // lookup by key fills in later), so the first look waits for it.
  property bool looked: false
  function firstLook() {
    if (looked || !item) return
    looked = true
    var age = item.planted ? Date.now() - item.planted : 1e9
    if ((kind === "tree" && age < 4000) || (kind === "snowman" && !wasSeen())) { growth = 0; grow.start() }
  }
  Component.onCompleted: {
    if (scene) scene.addTouchable(root)
    firstLook()
  }
  Component.onDestruction: if (scene) scene.removeTouchable(root)

  // Snowmen roll in only when they are new this session.
  function wasSeen() {
    var seen = scene ? (scene.seenIds || {}) : {}
    var known = !!seen[item.id]
    if (scene) { var next = Object.assign({}, seen); next[item.id] = true; scene.seenIds = next }
    return known
  }

  NumberAnimation { id: grow; target: root; property: "growth"; from: 0; to: 1; duration: root.kind === "tree" ? 2400 : 1300; easing.type: Easing.OutCubic }
  onGrowthChanged: canvas.requestPaint()
  onItemChanged: { firstLook(); canvas.requestPaint(); lights.requestPaint() }
  // Theme colours reach the scarf.
  Connections {
    target: root.scene ? root.scene.service : null
    function onThemeChanged() { canvas.requestPaint() }
  }

  // The tree paints in two layers: what holds still is repainted only when
  // it changes; the lights, their glow and the star's halo run at 30 fps.
  // Both canvases reach past the item so glow is never cut off.
  readonly property real pad: 40 * size
  readonly property bool glows: kind === "tree" && item && growth >= 1
                                && (item.star || item.ornaments.some(function(o) { return o.kind === "light" }))
  onGlowsChanged: lights.requestPaint()
  Timer { interval: 33; repeat: true; running: root.glows && root.visible && !!root.scene && root.scene.visible && (root.scene.effectOn || root.scene.decorating); onTriggered: lights.requestPaint() }

  Canvas {
    id: canvas
    x: -root.pad; y: -root.pad
    width: root.width + root.pad * 2; height: root.height + root.pad
    renderTarget: Canvas.FramebufferObject
    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      ctx.clearRect(0, 0, width, height)
      if (!root.item) return
      ctx.translate(root.pad, root.pad)
      var w = root.width, h = root.height
      if (root.kind === "tree") Draw.tree(ctx, w, h, { growth: root.growth, star: root.item.star, ornaments: root.item.ornaments, seed: root.item.id }, 0)
      else if (root.kind === "snowman") Draw.snowman(ctx, w, h, { built: root.growth, scarf: root.item.scarf, outfit: root.item.outfit, themeScarf: root.item.themeScarf })
      else if (root.item.kind === "note") Draw.letter(ctx, w, h)
      else Draw.gift(ctx, w, h, root.item.color)
    }
  }

  Canvas {
    id: lights
    visible: root.kind === "tree"
    x: -root.pad; y: -root.pad
    width: root.width + root.pad * 2; height: root.height + root.pad
    renderTarget: Canvas.FramebufferObject
    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      ctx.clearRect(0, 0, width, height)
      if (!root.item || !root.glows) return
      ctx.translate(root.pad, root.pad)
      Draw.treeLights(ctx, root.width, root.height, { growth: root.growth, star: root.item.star, ornaments: root.item.ornaments }, Date.now() / 1000)
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    cursorShape: root.dragging ? Qt.ClosedHandCursor : Qt.OpenHandCursor
    property real pressX: 0
    property real pressY: 0
    property bool moved: false

    onPressed: function(m) {
      pressX = m.x; pressY = m.y; moved = false
      if (root.scene) root.scene.menuFor = null
    }
    onPositionChanged: function(m) {
      if (!(m.buttons & Qt.LeftButton)) return
      if (!moved && Math.abs(m.x - pressX) + Math.abs(m.y - pressY) < 6) return
      if (!moved) { root.dragX = root.x; root.dragY = root.y; root.dragging = true; moved = true }
      root.dragX += m.x - pressX
      root.dragY += m.y - pressY
    }
    onReleased: function(m) {
      if (!root.dragging) return
      var fx = root.dragX + root.width / 2, fy = root.dragY + root.height
      root.scene.service.moveItem(root.kindKey(), root.item.id, root.scene.placeAt(root.kind, fx, fy))
      root.dragging = false
    }
    onCanceled: {
      root.dragging = false
      moved = false
    }
    onClicked: function(m) {
      if (moved) return
      var p = root.mapToItem(null, m.x, m.y)
      if (m.button === Qt.RightButton) { root.scene.openMenu(root.kindKey(), root.item.id, p.x, p.y); return }
      root.click(m.x, m.y, p)
    }
  }

  function kindKey() { return kind === "gift" ? "gift" : kind }

  function click(lx, ly, p) {
    var tool = scene.decorating ? scene.tool : ""
    if (kind === "tree" && (tool === "bauble" || tool === "light" || tool === "candy" || tool === "star")) {
      if (tool === "star") { scene.service.decorateTree(item.id, { kind: "star" }); return }
      var at = Draw.ornamentAt(width, height, lx, ly)
      if (at) scene.service.decorateTree(item.id, { kind: tool, u: at.u, v: at.v })
      return
    }
    if (tool === "erase") { scene.service.removeItem(kindKey(), item.id); return }
    // Click a snowman to dress it, a piece at a time; right-click for its menu.
    if (kind === "snowman") { scene.service.dressSnowman(item.id); return }
    if (kind === "gift") {
      scene.service.openGift(item.id)
      var who = item.from ? "From " + item.from + ": " : ""
      scene.say(who + (item.note || "A little something for you."), p.x, root.y)
      return
    }
    scene.openMenu(kindKey(), item.id, p.x, p.y)
  }
}
