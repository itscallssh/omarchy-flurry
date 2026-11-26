import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import "lib/sim.js" as Sim
import "lib/draw.js" as Draw
import "lib/store.js" as Store
import "lib/policy.js" as Policy

// One screen's weather. A transparent layer over the windows that takes no
// input except on the things you can touch: decorations, visitors, snow
// deep enough to make a snowball from, snowballs, and, in decorate mode,
// the whole screen.
PanelWindow {
  id: sceneWin

  property var service: null

  readonly property var monitor: Hyprland.monitorFor(screen)
  readonly property var workspace: monitor ? monitor.activeWorkspace : null
  readonly property string screenName: screen ? String(screen.name) : ""
  readonly property bool decorating: !!service && service.decorating === screenName
  readonly property bool effectOn: !!service && service.isOn
  // Whether a fullscreen app covers this screen. Read straight from
  // Hyprland, then applied a moment later: hiding the scene changes what
  // Hyprland reports in the same pass, and a direct binding would loop.
  readonly property bool fullscreenNow: !!workspace && workspace.hasFullscreen && fullscreenMode() >= 2
  property bool fullscreenApp: false
  onFullscreenNowChanged: Qt.callLater(syncFullscreen)
  function syncFullscreen() { if (fullscreenApp !== fullscreenNow) fullscreenApp = fullscreenNow }
  readonly property bool live: effectOn && !fullscreenApp
  readonly property bool busy: santa.running || yeti.mode !== "" || train.mode !== ""

  // What the monitor reserves for the bar and any panels (hyprctl
  // monitors `reserved`). The scene's surface is kept out of the top, left
  // and right ones (margins below), so nothing it paints, no snow, no
  // icicle, no visitor, ever covers the bar; the ground sits above the
  // bottom one. Read again on monitor and layer events (Service.qml).
  readonly property var reservedArea: Policy.reservedOf(monitor && monitor.lastIpcObject ? monitor.lastIpcObject.reserved : null,
                                                        screen ? screen.width : 0, screen ? screen.height : 0)
  readonly property real groundInset: reservedArea.bottom
  readonly property real groundY: height - groundInset
  // The scene's top-left corner in Hyprland's global layout px.
  readonly property real originX: (screen ? screen.x : 0) + reservedArea.left
  readonly property real originY: (screen ? screen.y : 0) + reservedArea.top

  color: "transparent"
  // A visitor (Santa, the Yeti, a delivery) never shows over a fullscreen
  // app: it waits, paused, until the app leaves fullscreen.
  visible: !!service && (decorating || (!fullscreenApp && (live || busy)))
  onVisibleChanged: if (service) service.sceneShown(screenName, visible)
  exclusionMode: ExclusionMode.Ignore
  anchors { top: true; bottom: true; left: true; right: true }
  margins { top: sceneWin.reservedArea.top; left: sceneWin.reservedArea.left; right: sceneWin.reservedArea.right }
  WlrLayershell.namespace: "flurry"
  WlrLayershell.layer: WlrLayer.Top
  WlrLayershell.keyboardFocus: decorating ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  // Hyprland's fullscreen state of each window on this workspace; a real
  // fullscreen one (not just maximized) pauses the scene, simulation and all.
  function fullscreenMode() {
    var modes = []
    var list = workspace && workspace.toplevels ? workspace.toplevels.values : []
    for (var i = 0; i < list.length; i++) {
      var ipc = list[i].lastIpcObject
      if (ipc && ipc.fullscreen) modes.push(Number(ipc.fullscreen))
    }
    return Policy.fullscreenActive(modes) ? 2 : 0
  }

  // ------------------------------------------------------------ simulation

  property var world: null
  property real clock: 0
  property real frameDebt: 0
  property string surfaceSig: ""
  // Window rectangles on this screen, screen-local, for placing decorations.
  property var windowRects: []
  // Bumped a few times a second so decorations follow the snow under them.
  property int heapTick: 0

  function freshWorld() {
    var w = Sim.createWorld(width, height, { effect: service ? service.effect : "snow", intensity: service ? service.intensity : 1, groundInset: groundInset, plow: service ? service.plowOn : true })
    if (service) Sim.setEnv(w, service.env)
    return w
  }
  Component.onCompleted: {
    syncFullscreen()
    world = freshWorld()
    if (service) {
      var initial = {}
      var list = service.saved.snowmen || []
      for (var i = 0; i < list.length; i++) initial[list[i].id] = true
      seenIds = initial
      applyFeatures()
      service.registerScene(screenName, sceneWin)
      service.sceneShown(screenName, visible)
    }
  }

  // A world that throws on every frame (state no step can get past) is
  // started afresh after two seconds of it, instead of costing an exception
  // a frame for the rest of the session. The snowmen and trees are kept:
  // they live in the saved state, not in the world.
  property int stepFailures: 0
  function recoverWorld() {
    console.warn("flurry: the scene on " + screenName + " kept failing; starting it afresh")
    try { Sim.letGo(world) } catch (e) { }
    world = freshWorld()
    applyFeatures()
    anchorReset()
    surfaceSig = ""
    stepFailures = 0
    canvas.requestPaint()
  }
  Component.onDestruction: {
    anchorReset()
    if (service) service.unregisterScene(screenName, sceneWin)
  }

  onWidthChanged: if (world) Sim.resize(world, width, height, groundInset)
  onHeightChanged: if (world) Sim.resize(world, width, height, groundInset)
  onGroundInsetChanged: if (world) Sim.resize(world, width, height, groundInset)

  Connections {
    target: sceneWin.service
    function onEffectChanged() { if (sceneWin.world) Sim.setEffect(sceneWin.world, sceneWin.service.effect) }
    function onIntensityChanged() { if (sceneWin.world) Sim.setIntensity(sceneWin.world, sceneWin.service.intensity) }
    function onPlowOnChanged() { if (sceneWin.world) Sim.setPlow(sceneWin.world, sceneWin.service.plowOn) }
    function onEnvChanged() { if (sceneWin.world) Sim.setEnv(sceneWin.world, sceneWin.service.env) }
    function onSavedChanged() { sceneWin.applyFeatures() }
    function onThrowOnChanged() { sceneWin.applyFeatures() }
    function onWindowBorderChanged() { sceneWin.applyFeatures() }
    function onThemeChanged() { canvas.requestPaint() }
  }

  function applyFeatures() {
    if (!world || !service) return
    Sim.setFeatures(world, { gusts: service.saved.windGusts, icicles: service.saved.dayCycle, throwOut: service.throwOn,
                             border: service.windowBorder })
  }

  // Turned off: Santa does not finish his crossing over an empty sky. (The
  // Yeti and the train carry things, so they finish their errand.)
  onEffectOnChanged: if (!effectOn && santa.running) { santa.running = false; santa.visible = false }

  onLiveChanged: {
    if (live || !world) return
    // Off: nothing keeps falling in the background, and the canvas is cleared.
    world.particles = []
    if (goldenZone.w > 0) goldenZone = noZone
    canvas.requestPaint()
  }

  // The windows in view on this screen, screen-local, keyed by their
  // Hyprland address ("0x" + hex) so everything riding one is tied to that
  // window and nothing else. Only windows that really exist (see the window
  // feed in Service.qml), on this monitor's active workspace or its open
  // special workspace, mapped and not hidden.
  function windowId(ipc, toplevel) {
    var k = service ? service.addrKey(ipc && ipc.address ? ipc.address : toplevel.address) : ""
    return k ? "0x" + k : ""
  }
  function readWindows() {
    if (!workspace || !service) return []
    var mon = monitor && monitor.lastIpcObject ? monitor.lastIpcObject : null
    var all = Hyprland.toplevels.values
    var items = []
    for (var i = 0; i < all.length; i++) {
      var ipc = all[i].lastIpcObject
      if (ipc) items.push({ ipc: ipc, id: windowId(ipc, all[i]) })
    }
    var rects = Policy.sceneRects(items, {
      wsId: Number(workspace.id),
      special: mon && mon.specialWorkspace && mon.specialWorkspace.id ? Number(mon.specialWorkspace.id) : 0,
      ox: originX, oy: originY,
      exists: function(id) { return service.windowExists(id) }
    })
    // The focused window (the one a drag moves) is read from the pointer
    // feed's snapshot when that is fresher than the list: the list answers
    // a poll or two behind the compositor, and its snow would trail the
    // window. Every rect also says how old its reading is (age, s).
    return Policy.withSnapshot(rects, service.focusSnap, Date.now(), originX, originY, service.windowsReadAt, 150)
  }

  // Every window that still exists, on any workspace or monitor: their snow
  // is kept aside while they are out of sight instead of falling.
  function aliveIds() {
    var ids = []
    if (!service) return ids
    var all = Hyprland.toplevels.values
    for (var i = 0; i < all.length; i++) {
      var id = windowId(all[i].lastIpcObject, all[i])
      if (id && service.windowExists(id)) ids.push(id)
    }
    return ids
  }

  // True for a moment after any window here moved, so decorations riding
  // windows only run their sway while it can matter.
  property real lastSurfaceChange: -10
  readonly property bool windowsMoving: clock - lastSurfaceChange < 1.5

  // Windows seen on this screen this session, and where each was last, so
  // something riding a window that closes can be put down where it was.
  property var seenWindows: ({})
  property var lastRects: ({})

  // What the simulation needs to tell a drag (the pointer moving with the
  // window) from a jump (a layout change, a workspace switch, a keyboard
  // move), in screen-local px.
  function motionHint() {
    if (!service) return null
    var p = service.pointer
    var now = Date.now()
    return {
      pointer: p.present ? { x: p.x - originX, y: p.y - originY, vx: p.vx, vy: p.vy,
                             present: true, stillFor: p.stillFor + (p.at ? Math.max(0, now - p.at) / 1000 : 0) } : null,
      poll: service.windowPollGap,
      layoutAge: service.lastLayoutEvent ? (now - service.lastLayoutEvent) / 1000 : 1e9
    }
  }

  // A window yanked out from under its snow: a snowman riding it stays
  // where it was and drops to the ground there, like its snow.
  function dropRiders(ev) {
    var list = service.saved.snowmen
    for (var i = 0; i < list.length; i++) {
      var m = list[i], pl = m.place
      if (pl.screen !== screenName || pl.windowAddress !== ev.surface) continue
      var fx = (ev.x + pl.windowFx * ev.w) / width
      service.moveItem("snowman", m.id, { screen: screenName, fx: Math.max(0, Math.min(1, fx)), fy: 1, windowAddress: "", windowClass: "", windowFx: 0.5 })
    }
  }

  property int focusSeqSeen: 0
  function syncWindows() {
    var rects = readWindows()
    var sig = rects.map(function(r) { return [r.id, r.x, r.y, r.w, r.h, r.floating ? 1 : 0, r.z].join(",") }).join(";")
    // A fresh snapshot that shows the focused window where it was: it has
    // stopped, so its snow is painted where it is (see draw.js leadOf).
    var snap = service.focusSeq !== focusSeqSeen ? service.focusSnap : null
    focusSeqSeen = service.focusSeq
    if (sig === surfaceSig) {
      if (snap) Sim.noteStill(world, [snap.id])
      return
    }
    if (surfaceSig !== "") service.noteMotion()
    var gone = surfaceSig !== "" && rects.length < windowRects.length
    surfaceSig = sig
    windowRects = rects
    lastSurfaceChange = clock
    Sim.setSurfaces(world, rects, clock, aliveIds(), motionHint())
    if (snap) Sim.noteStill(world, [snap.id])
    var seen = seenWindows, last = {}
    for (var i = 0; i < rects.length; i++) { seen[rects[i].id] = true; last[rects[i].id] = rects[i] }
    for (var k in lastRects) if (!last[k] && service.windowExists(k)) last[k] = lastRects[k]
    lastRects = last
    seenWindows = seen
    if (gone || rects.length) checkRiders()
  }

  FrameAnimation {
    id: frames
    running: sceneWin.visible && (sceneWin.live || sceneWin.busy || sceneWin.decorating)
    onTriggered: {
      // A long frame (a suspend, a stall) counts as an ordinary one, so
      // nothing jumps when the machine wakes.
      var dt = Math.min(Math.max(frameTime, 0), 0.1)
      sceneWin.clock += dt
      // On battery the scene draws at 30 fps (24 when it runs low).
      if (sceneWin.service.fpsCap < 60) {
        sceneWin.frameDebt += dt
        if (sceneWin.frameDebt < 1 / sceneWin.service.fpsCap) return
        dt = sceneWin.frameDebt
        sceneWin.frameDebt = 0
      }
      sceneWin.syncWindows()
      if (sceneWin.live) {
        sceneWin.world.quality = sceneWin.service.quality
        var p = sceneWin.service.pointer
        var sx = sceneWin.screen ? sceneWin.screen.x : 0, sy = sceneWin.screen ? sceneWin.screen.y : 0
        var local = p.present ? { x: p.x - sx, y: p.y - sy, vx: p.vx, vy: p.vy,
                                  present: p.x >= sx && p.x < sx + sceneWin.width
                                        && p.y >= sy && p.y < sy + sceneWin.height,
                                  stillFor: p.stillFor, age: p.at ? Math.max(0, Date.now() - p.at) / 1000 : 0 } : null
        Sim.setStrings(sceneWin.world, sceneWin.stringSpecList)
        try {
          Sim.step(sceneWin.world, dt, { pointer: local })
          sceneWin.stepFailures = 0
        } catch (e) {
          sceneWin.noteFault("step", e)
          if (++sceneWin.stepFailures >= 120) { sceneWin.recoverWorld(); return }
        }
        sceneWin.reportFaults()
        // Sounds first, so the thunder goes with its flash.
        var sounds = Sim.takeSounds(sceneWin.world)
        for (var q = 0; q < sounds.length; q++) sceneWin.service.playCue(sounds[q])
        var events = Sim.takeEvents(sceneWin.world)
        for (var e = 0; e < events.length; e++) {
          if (events[e].type === "yank") sceneWin.dropRiders(events[e])
          else sceneWin.service.sceneEvent(sceneWin, events[e])
        }
        var gr = Sim.goldenRect(sceneWin.world)
        if (gr) {
          if (Math.abs(gr.x - sceneWin.goldenZone.x) > 1 || Math.abs(gr.y - sceneWin.goldenZone.y) > 1 || sceneWin.goldenZone.w <= 0)
            sceneWin.goldenZone = gr
        } else if (sceneWin.goldenZone.w > 0) {
          sceneWin.goldenZone = sceneWin.noZone
        }
        canvas.requestPaint()
        sceneWin.anchorTick()
      }
      sceneWin.stepVisitors(dt)
    }
  }

  Timer {
    interval: 120
    repeat: true
    running: frames.running
    onTriggered: sceneWin.heapTick++
  }

  // ------------------------------------------------------------ snowballs

  // Where the pointer can take hold of snow or a ball right now. Refreshed
  // often while a ball moves, rarely while everything lies still.
  readonly property bool snowballsOn: live && !decorating && !!service && service.snowballsOn
  property var zones: []
  readonly property var noZone: ({ x: 0, y: 0, w: 0, h: 0 })
  function zone(i) { return snowballsOn && i < zones.length ? zones[i] : noZone }
  property bool ballsMoving: false

  Timer {
    interval: sceneWin.ballsMoving ? 50 : 200
    repeat: true
    running: sceneWin.snowballsOn
    onTriggered: {
      sceneWin.ballsMoving = Sim.ballsMoving(sceneWin.world)
      var next = Sim.touchZones(sceneWin.world, 4, 14)
      if (JSON.stringify(next) !== JSON.stringify(sceneWin.zones)) sceneWin.zones = next
    }
  }
  onSnowballsOnChanged: {
    if (snowballsOn || !world) return
    Sim.letGo(world)
    zones = []
  }

  // Press on snow to scoop a handful, or on a ball to pick it up; drag to
  // roll or carry it; let go to throw it. Input only reaches this where the
  // mask lets it (the zones), and once pressed the pointer stays with it
  // until it is released, wherever it goes.
  MouseArea {
    id: snowHands
    anchors.fill: parent
    enabled: sceneWin.snowballsOn
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton
    cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
    // Ctrl+drag writes in the snow instead of scooping it.
    property bool writing: false
    onPressed: function(mouse) {
      if (Sim.goldenAt(sceneWin.world, mouse.x, mouse.y)) { Sim.catchGolden(sceneWin.world); return }
      writing = false
      if ((mouse.modifiers & Qt.ControlModifier) && sceneWin.service.saved.writing) {
        writing = Sim.writeStart(sceneWin.world, mouse.x, mouse.y)
        if (!writing) mouse.accepted = false
        return
      }
      var got = Sim.grabSnow(sceneWin.world, mouse.x, mouse.y)
      if (!got) { mouse.accepted = false; return }
      sceneWin.ballsMoving = true
    }
    onPositionChanged: function(mouse) {
      if (!pressed) return
      if (writing) Sim.writeTo(sceneWin.world, mouse.x, mouse.y)
      else Sim.dragSnow(sceneWin.world, mouse.x, mouse.y)
    }
    onReleased: { if (writing) Sim.writeEnd(sceneWin.world); else Sim.letGo(sceneWin.world); writing = false }
    onCanceled: { if (writing) Sim.writeEnd(sceneWin.world); else Sim.letGo(sceneWin.world); writing = false }
  }

  // The golden snowflake takes a click wherever it is.
  property var goldenZone: noZone
  MouseArea {
    x: sceneWin.goldenZone.x; y: sceneWin.goldenZone.y; width: sceneWin.goldenZone.w; height: sceneWin.goldenZone.h
    enabled: sceneWin.live && sceneWin.goldenZone.w > 0
    cursorShape: Qt.PointingHandCursor
    onPressed: Sim.catchGolden(sceneWin.world)
  }

  Canvas {
    id: canvas
    anchors.fill: parent
    visible: sceneWin.live
    renderTarget: Canvas.FramebufferObject
    renderStrategy: Canvas.Cooperative
    onPaint: {
      if (!sceneWin.world) return
      var ctx = getContext("2d")
      // A fresh state every frame, so nothing a failed paint left behind (a
      // transform, an alpha) carries into the next one.
      ctx.reset()
      try { Draw.world(ctx, sceneWin.world) } catch (e) { sceneWin.noteFault("paint", e) }
    }
  }


  // ------------------------------------------------- compositor plugin
  //
  // With the flurry-anchor plugin loaded (Service.anchorAvailable), what
  // lies on each window here is painted into two strips in the window's own
  // frame (draw.js paintStrip), saved as PNGs and handed to the plugin,
  // which draws them with the window at its position in every frame. The
  // overlay then leaves those windows' frost, ledge and icicles out
  // (world.anchored). A strip is painted again when what it shows changed
  // (draw.js attachedSig): at most 30 times a second for a window that is
  // moving or shedding, 4 times a second otherwise.
  property var anchorHeld: ({})       // id -> true once the plugin has both strips
  property var anchorSigs: ({})       // id -> fingerprint last sent
  property var anchorAt: ({})         // id -> clock when last sent
  property var anchorActiveFiles: ({}) // id -> [paths] currently held by the plugin
  property int anchorSeq: 0
  property int anchorJobSeq: 0
  property var anchorJob: null        // { seq, id, strips, files, i, sig, started }
  readonly property bool anchorOn: !!service && service.anchorAvailable && live

  function cleanupAnchorFiles(paths) {
    if (paths && paths.length) Quickshell.execDetached(["rm", "-f", "--"].concat(paths))
  }

  function anchorReset() {
    var gone = Object.keys(anchorHeld)
    var toClear = [], filesToDelete = []
    for (var i = 0; i < gone.length; i++) {
      var id = gone[i]
      if (!service || !service.sceneShowing(id)) {
        toClear.push(Policy.anchorClear(id))
        if (anchorActiveFiles[id]) filesToDelete = filesToDelete.concat(anchorActiveFiles[id])
      }
    }
    anchorHeld = ({}); anchorSigs = ({}); anchorAt = ({}); anchorActiveFiles = ({}); anchorJob = null
    if (world) world.anchored = null
    if (toClear.length && service && service.anchorAvailable)
      service.anchorSend(Policy.anchorBatch(toClear), toClear.length, null)
    cleanupAnchorFiles(filesToDelete)
    canvas.requestPaint()
  }
  onAnchorOnChanged: if (!anchorOn) anchorReset()

  property bool anchorWarned: false
  function anchorTick() {
    // A strip that never got painted or answered (it should take a frame
    // or two): given up on, so the next can go.
    if (anchorJob && clock - anchorJob.started > 1) {
      if (!anchorWarned) { anchorWarned = true; console.warn("flurry: a strip for the compositor plugin was not painted in time; retrying") }
      anchorJob = null
    }
    if (!anchorOn || anchorJob || !world || !service.anchorDirReady) return
    // Windows that left this screen (closed, another workspace): theirs go,
    // unless another screen's scene is already showing that window.
    var ids = windowRects.map(function(r) { return r.id })
    var gone = Policy.anchorGone(anchorHeld, ids)
    if (gone.length) {
      var held = Object.assign({}, anchorHeld)
      var clearCmds = [], filesToDelete = []
      for (var g = 0; g < gone.length; g++) {
        var gid = gone[g]
        delete held[gid]; delete anchorSigs[gid]; delete anchorAt[gid]
        if (!service.sceneShowing(gid)) {
          clearCmds.push(Policy.anchorClear(gid))
          if (anchorActiveFiles[gid]) filesToDelete = filesToDelete.concat(anchorActiveFiles[gid])
        }
        delete anchorActiveFiles[gid]
      }
      anchorHeld = held
      world.anchored = held
      if (clearCmds.length) service.anchorSend(Policy.anchorBatch(clearCmds), clearCmds.length, null)
      cleanupAnchorFiles(filesToDelete)
    }
    // The window most overdue for fresh strips.
    var best = null, bestLate = 0
    for (var i = 0; i < windowRects.length; i++) {
      var id = windowRects[i].id, s = world.surfaces[id]
      if (!s || s.ground || s.plow) continue
      var sig = Draw.attachedSig(world, s)
      var since = clock - (anchorAt[id] === undefined ? -1e9 : anchorAt[id])
      var animated = (s.glaze || 0) > 0.04 || (s.water || 0) > 0.5 || s.pour
      var gap = windowsMoving ? 1 / 30 : 0.25
      var due = !anchorHeld[id] || (sig !== anchorSigs[id] && since >= gap) || (animated && since >= 0.5)
      if (due && since > bestLate) { best = { id: id, sig: sig }; bestLate = since }
    }
    if (!best) return
    var surf = world.surfaces[best.id]
    var strips = Draw.anchorStrips(surf, world.border)
    anchorSeq++
    var files = strips.map(function(st) { return Policy.anchorFile(service.anchorDir, best.id, st.slot, anchorSeq) })
    if (files.indexOf("") >= 0) return
    anchorJob = { seq: ++anchorJobSeq, id: best.id, strips: strips, files: files, i: 0, sig: best.sig, started: clock }
    anchorPaintNext()
  }
  function anchorPaintNext() {
    var job = anchorJob
    var st = job.strips[job.i]
    anchorCanvas.width = Math.max(1, Math.ceil(st.w))
    anchorCanvas.height = Math.max(1, Math.ceil(st.h))
    anchorCanvas.requestPaint()
  }
  function anchorPainted() {
    var job = anchorJob
    if (!job) return
    if (!anchorCanvas.save(job.files[job.i])) { console.warn("flurry: could not write " + job.files[job.i]); anchorJob = null; return }
    if (++job.i < job.strips.length) { anchorPaintNext(); return }
    var cmds = job.strips.map(function(st, k) { return Policy.anchorSet(job.id, st, job.files[k]) })
    var id = job.id, sig = job.sig, at = clock, jobSeq = job.seq, files = job.files
    service.anchorSend(Policy.anchorBatch(cmds), cmds.length, function(text) {
      var ok = Policy.anchorReplies(String(text || ""), cmds.length)
      if (sceneWin.anchorJob && sceneWin.anchorJob.seq === jobSeq) sceneWin.anchorJob = null
      if (!sceneWin.anchorOn) { sceneWin.cleanupAnchorFiles(files); return }
      if (ok.every(function(v) { return v })) {
        var prev = sceneWin.anchorActiveFiles[id] || []
        var stale = prev.filter(function(p) { return files.indexOf(p) < 0 })
        sceneWin.cleanupAnchorFiles(stale)
        sceneWin.anchorActiveFiles[id] = files
        sceneWin.anchorSigs[id] = sig
        sceneWin.anchorAt[id] = at
        if (!sceneWin.anchorHeld[id]) {
          var held = Object.assign({}, sceneWin.anchorHeld)
          held[id] = true
          sceneWin.anchorHeld = held
          sceneWin.world.anchored = held
          canvas.requestPaint()
        }
      } else {
        // Not taken (the window is gone, or the plugin was unloaded): the
        // overlay paints it again, and the plugin is asked for afresh.
        sceneWin.anchorAt[id] = at
        if (sceneWin.anchorHeld[id]) {
          var held2 = Object.assign({}, sceneWin.anchorHeld)
          delete held2[id]
          sceneWin.anchorHeld = held2
          sceneWin.world.anchored = held2
          canvas.requestPaint()
        }
      }
    })
  }
  // Painted off screen: the overlay shows nothing of it.
  Canvas {
    id: anchorCanvas
    x: 0; y: 0
    width: 1; height: 1
    opacity: 0
    enabled: false
    renderTarget: Canvas.Image
    renderStrategy: Canvas.Immediate
    onPaint: {
      var job = sceneWin.anchorJob
      var ctx = getContext("2d")
      ctx.reset()
      if (!job || !sceneWin.world) return
      var s = sceneWin.world.surfaces[job.id]
      if (!s) return
      try { Draw.paintStrip(ctx, sceneWin.world, s, job.strips[job.i], 1) } catch (e) { sceneWin.noteFault("anchor", e) }
    }
    onPainted: sceneWin.anchorPainted()
  }

  // ------------------------------------------------------------ placement

  // The light strings on this screen now: one on every window of each
  // decorated class, each keyed by that window's address. Recomputed only
  // when the windows or the strings change, not every frame.
  readonly property var stringSpecList: {
    var list = service ? service.saved.strings : []
    var out = []
    for (var i = 0; i < list.length; i++)
      for (var j = 0; j < windowRects.length; j++)
        if (windowRects[j].cls === list[i].windowClass)
          out.push({ id: list[i].id + ":" + windowRects[j].id, surface: windowRects[j].id, palette: list[i].palette })
    return out
  }
  function stringSpecs() { return stringSpecList }

  function classAt(x, y) {
    var id = world ? Sim.surfaceAt(world, x, y) : null
    if (!id) return ""
    for (var i = 0; i < windowRects.length; i++) if (windowRects[i].id === id) return windowRects[i].cls
    return ""
  }

  function rectFor(id) {
    for (var i = 0; i < windowRects.length; i++) if (windowRects[i].id === id) return windowRects[i]
    return null
  }

  function rectForClass(cls) {
    for (var i = 0; i < windowRects.length; i++) if (windowRects[i].cls === cls) return windowRects[i]
    return null
  }

  // A window of this class that exists anywhere, on any workspace.
  function classAlive(cls) {
    var all = Hyprland.toplevels.values
    for (var i = 0; i < all.length; i++) {
      var ipc = all[i].lastIpcObject
      if (ipc && String(ipc["class"] || "") === cls && service.windowExists(windowId(ipc, all[i]))) return true
    }
    return false
  }

  function groundTop(x, half) {
    var tick = heapTick
    var y = world ? Sim.restingYUnder(world, Sim.GROUND_ID, x, half || 0) : null
    return y === null ? groundY : y
  }

  // Feet position for a saved place, or null when it rides a window that is
  // not in view on this screen right now (on another workspace, hidden,
  // behind another window, or gone: checkRiders puts those down).
  // `half` is how far the thing's base reaches either side of its feet.
  function feetFor(place, half) {
    var tick = heapTick
    var rects = windowRects
    if (place.windowAddress || place.windowClass) {
      var r = place.windowAddress ? rectFor(place.windowAddress) : null
      if (!r) return null
      var x = r.x + place.windowFx * r.w
      var top = world ? Sim.restingYUnder(world, r.id, x, half || 0) : r.y
      var y = top === null ? r.y : top
      if (world && Sim.surfaceCovered(world, r.id, x, y - 4)) return null
      return { x: x, y: y, surface: r.id }
    }
    var fx = place.fx * width
    return { x: fx, y: place.fy >= 0.999 ? groundTop(fx, half) : place.fy * groundY, surface: "" }
  }

  // Where something dropped at feet (x, y) belongs. A snowman let go just
  // above a window's top edge rides that window, by its address.
  function placeAt(kind, x, y) {
    if (kind === "snowman") {
      for (var i = 0; i < windowRects.length; i++) {
        var r = windowRects[i]
        if (x >= r.x && x <= r.x + r.w && y >= r.y - 40 && y <= r.y + 30 && (!world || !Sim.surfaceCovered(world, r.id, x, r.y - 4)))
          return { screen: screenName, fx: x / width, fy: 1, windowAddress: r.id, windowClass: r.cls, windowFx: (x - r.x) / r.w }
      }
    }
    var fy = Math.max(0.05, Math.min(1, y / groundY))
    if (fy > 0.95) fy = 1
    return { screen: screenName, fx: Math.max(0, Math.min(1, x / width)), fy: fy, windowAddress: "", windowClass: "", windowFx: 0.5 }
  }

  // Snowmen riding windows. One whose window closed this session is put
  // down on the ground below where it stood, at once. One saved in an
  // earlier session (its window's address is gone with that session) takes
  // the first window of the same app, or the ground if there is none.
  property real startedAt: Date.now()
  function checkRiders() {
    if (!service) return
    var list = service.saved.snowmen
    for (var i = 0; i < list.length; i++) {
      var m = list[i], pl = m.place
      if (pl.screen !== screenName || (!pl.windowAddress && !pl.windowClass)) continue
      if (pl.windowAddress && service.windowExists(pl.windowAddress)) {
        // Its window went to another monitor: it goes along.
        if (!rectFor(pl.windowAddress)) {
          var other = service.sceneShowing(pl.windowAddress)
          if (other && other !== sceneWin) service.moveItem("snowman", m.id, Object.assign({}, pl, { screen: other.screenName }))
        }
        continue
      }
      var was = pl.windowAddress ? lastRects[pl.windowAddress] : null
      var known = pl.windowAddress && seenWindows[pl.windowAddress]
      if (!known && pl.windowClass) {
        var r = rectForClass(pl.windowClass)
        if (r) { service.moveItem("snowman", m.id, Object.assign({}, pl, { windowAddress: r.id })); continue }
        var migrated = false
        for (var sk in service.scenes) {
          var otherScene = service.scenes[sk]
          if (!otherScene || otherScene === sceneWin || !otherScene.rectForClass) continue
          var ro = otherScene.rectForClass(pl.windowClass)
          if (ro) {
            service.moveItem("snowman", m.id, Object.assign({}, pl, { screen: otherScene.screenName, windowAddress: ro.id }))
            migrated = true
            break
          }
        }
        if (migrated) continue
        // Give the session a moment to show its windows before giving up.
        if (Date.now() - startedAt < 4000 || classAlive(pl.windowClass)) continue
      }
      var fx = was ? (was.x + pl.windowFx * was.w) / width : pl.fx
      service.moveItem("snowman", m.id, { screen: screenName, fx: Math.max(0, Math.min(1, fx)), fy: 1, windowAddress: "", windowClass: "", windowFx: 0.5 })
    }
  }
  Timer {
    interval: 3000
    repeat: true
    running: sceneWin.visible
    onTriggered: {
      sceneWin.checkRiders()
      // Forget windows that are gone for good once their riders are down.
      var keep = {}
      for (var k in sceneWin.seenWindows) if (sceneWin.service.windowExists(k)) keep[k] = true
      sceneWin.seenWindows = keep
    }
  }

  // ------------------------------------------------------------ decorations

  readonly property var decorations: {
    if (!service) return []
    var s = service.saved
    var out = []
    var add = function(kind, list) {
      for (var i = 0; i < list.length; i++) if (list[i].place.screen === sceneWin.screenName || (!list[i].place.screen && sceneWin.isPrimary()))
        out.push({ kind: kind, item: list[i] })
    }
    add("tree", s.trees)
    add("gift", s.gifts)
    add("snowman", s.snowmen)
    return out
  }

  // Delegates are keyed by id, so a state change elsewhere (a friend added,
  // the inbox position saved) never rebuilds a decoration mid-drag.
  readonly property var decorationsByKey: {
    var map = {}
    for (var i = 0; i < decorations.length; i++) map[decorations[i].kind + ":" + decorations[i].item.id] = decorations[i]
    return map
  }
  ListModel { id: decorModel }
  onDecorationsChanged: {
    var keys = decorations.map(function(d) { return d.kind + ":" + d.item.id })
    for (var i = decorModel.count - 1; i >= 0; i--)
      if (keys.indexOf(decorModel.get(i).key) < 0) decorModel.remove(i)
    var have = {}
    for (var j = 0; j < decorModel.count; j++) have[decorModel.get(j).key] = true
    for (var k = 0; k < keys.length; k++) if (!have[keys[k]]) decorModel.append({ key: keys[k] })
  }

  function isPrimary() { return Quickshell.screens.length > 0 && Quickshell.screens[0] === screen }

  // Mask slots: decorations register the item that takes their input.
  property var touchables: []
  function addTouchable(item) { touchables = touchables.concat([item]) }
  function removeTouchable(item) { touchables = touchables.filter(function(x) { return x !== item }) }
  function touchable(i) { return i < touchables.length && touchables[i].visible ? touchables[i] : null }

  property string tool: ""          // decorate-mode tool
  property var seenIds: ({})        // decorations already shown this session
  property var menuFor: null        // { kind, id, x, y }
  property var bubble: null         // { text, x, y }

  // Clicking empty space in decorate mode uses the tool there.
  MouseArea {
    anchors.fill: parent
    enabled: sceneWin.decorating
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    onClicked: function(mouse) {
      sceneWin.menuFor = null
      if (mouse.button === Qt.RightButton) { sceneWin.tool = ""; return }
      if (sceneWin.tool === "string" || sceneWin.tool === "erase") {
        var cls = sceneWin.classAt(mouse.x, mouse.y)
        if (!cls) return
        if (sceneWin.tool === "erase") { sceneWin.service.removeWindowLights(cls); return }
        var palette = sceneWin.service.decorateWindow(cls)
        if (palette) sceneWin.say({ warm: "Warm white", theme: "Theme colours", multi: "Classic colours", cool: "Icy blue", candy: "Candy cane" }[palette] + ". Click again for other colours.", mouse.x, mouse.y - 30)
        return
      }
      if (sceneWin.tool === "tree") sceneWin.service.addTree(sceneWin.placeAt("tree", mouse.x, mouse.y))
      else if (sceneWin.tool === "snowman") sceneWin.service.addSnowman(sceneWin.placeAt("snowman", mouse.x, mouse.y))
    }
  }

  Item {
    id: decorLayer
    anchors.fill: parent
    visible: sceneWin.effectOn || sceneWin.decorating

    Repeater {
      model: decorModel
      delegate: Decoration {
        required property string key
        readonly property var entry: sceneWin.decorationsByKey[key] || null
        scene: sceneWin
        kind: key.split(":")[0]
        item: entry ? entry.item : null
      }
    }
  }

  // ------------------------------------------------------------ visitors

  // "sent", "off" (the switch is off) or "out" (one is already on its way).
  function callPlow() { return world ? Sim.requestPlow(world) : "no screen" }

  // The snow globe: everything lying about lifts and swirls, and the
  // decorations rock.
  property real shakeAt: -10
  function shake() {
    if (!world || !live) return false
    Sim.shake(world, 1)
    shakeAt = clock
    return true
  }

  function startFireworks(seconds) {
    if (!world || !live) return false
    return Sim.startFireworks(world, seconds)
  }
  function countdownTick(n) { if (world && live) Sim.countdownTick(world, n) }

  // What the visitors would find here now, for the scheduler and `flurry
  // diag` (see Sim.critterContext and Policy.surpriseBlock).
  function surpriseContext() {
    if (!world) return { offline: "no scene" }
    if (!live) return { offline: effectOn ? "a fullscreen app is up" : "Flurry is off", fullscreen: fullscreenApp }
    var c = Sim.critterContext(world)
    c.fullscreen = fullscreenApp
    // A window being dragged (or anything moved in the last moment and the
    // pointer is moving): nothing lands on a moving target.
    c.dragging = windowsMoving && !!service && Date.now() - service.lastPointerMove < 1500
    return c
  }
  // force: a named call (`flurry surprise rabbit`), which comes even with
  // the plow out.
  function surprise(kind, force) {
    if (!world || !live) return false
    if (kind === "bird") return Sim.spawnBird(world)
    if (kind === "rabbit") return Sim.spawnRabbit(world, { coat: world.env.spring >= 0.5 ? "brown" : "white", force: !!force })
    if (kind === "golden") return Sim.spawnGolden(world)
    return false
  }
  function freeze() { return world && live ? Sim.freezeNow(world) : -1 }
  // Calm mode came on (or surprises went off): whoever is here leaves now.
  function dismissCritters() { return world ? Sim.dismissCritters(world) : false }

  // Faults a feature hit in the simulation or the paint (see Sim.fault and
  // Draw.layer), each printed once; `flurry diag` lists them.
  property int faultsSeen: 0
  property var shellFaults: ({})
  function noteFault(name, e) {
    var f = shellFaults[name]
    if (f) { f.count++; return }
    var next = Object.assign({}, shellFaults)
    next[name] = { message: String(e && e.message ? e.message : e), count: 1 }
    shellFaults = next
    console.warn("flurry: " + name + " failed: " + next[name].message)
  }
  function reportFaults() {
    if (!world || !world.faults || (world.faultSeq || 0) === faultsSeen) return
    faultsSeen = world.faultSeq || 0
    for (var k in world.faults) if (!world.faults[k].warned) {
      world.faults[k].warned = true
      console.warn("flurry: " + k + " failed and was switched off for that frame: " + world.faults[k].message)
    }
  }
  function faults() {
    var out = {}
    if (world && world.faults) for (var k in world.faults) out[k] = { message: world.faults[k].message, count: world.faults[k].count }
    for (var j in shellFaults) out["scene:" + j] = shellFaults[j]
    return out
  }

  // A friend's snowball, flying in.
  function incomingSnowball(art) {
    if (!world || !live) return false
    return !!Sim.launchBall(world, art)
  }

  // Not over a fullscreen app: the visit would wait there unseen.
  function callSanta() {
    if (fullscreenApp) return false
    if (!santa.running) { santa.start(); if (service) service.playCue({ type: "sleigh" }) }
    return true
  }

  function callYeti(targetId) {
    if (fullscreenApp) return false
    if (yeti.mode === "") yeti.begin(targetId)
    return true
  }

  // The train runs one job at a time.
  property var trainJobs: []
  function trainPickup(kind, id, done) { queueTrain({ type: "pickup", kind: kind, id: id, done: done }) }
  function trainDeliver(gift) { queueTrain({ type: "deliver", gift: gift }) }
  function trainDepart(cargo) { queueTrain({ type: "depart", cargo: cargo }) }
  function queueTrain(job) {
    if (job.type === "deliver" && trainJobs.length >= 16) return
    trainJobs = trainJobs.concat([job])
    if (train.mode === "") train.next()
  }

  function stepVisitors(dt) {
    if (santa.running) santa.step(dt)
    if (yeti.mode !== "") yeti.step(dt)
    if (train.mode !== "") train.step(dt)
  }

  function stats() { return world ? Sim.stats(world) : null }

  Visitor {
    id: santa
    scene: sceneWin
    width: 260; height: 96
    painter: function(ctx, w, h, t) { Draw.sleigh(ctx, w, h, t) }
    property bool running: false
    property bool dropped: false
    function start() {
      x = -width; y = sceneWin.height * 0.1; dropped = false; running = true; visible = true
    }
    function step(dt) {
      x += dt * sceneWin.width / 14
      y = sceneWin.height * 0.1 + Math.sin(sceneWin.clock * 1.3) * 18
      paint()
      if (x > sceneWin.width + 20) { running = false; visible = false }
    }
    onTapped: {
      sceneWin.say("Ho ho ho!", x + width * 0.25, y)
      if (dropped) return
      dropped = true
      var gx = Math.max(20, Math.min(sceneWin.width - 20, x + width * 0.2))
      sceneWin.service.addGift(sceneWin.placeAt("gift", gx, sceneWin.groundY), { from: "Santa", note: "Merry Christmas!" })
    }
  }

  Visitor {
    id: yeti
    scene: sceneWin
    width: 120; height: 150
    property string mode: ""        // "", "walk", "grab", "leave", "flee"
    property string targetId: ""
    property real targetX: 0
    property real facing: 1
    property bool carrying: false
    property real wait: 0
    painter: function(ctx, w, h, t) { Draw.yeti(ctx, w, h, t, yeti.facing, yeti.carrying, yeti.mode === "flee") }

    function begin(id) {
      targetId = id
      var target = id ? sceneWin.service.find("snowman", id) : null
      var feet = target ? sceneWin.feetFor(target.place) : null
      facing = Math.random() < 0.5 ? 1 : -1
      x = facing > 0 ? -width : sceneWin.width
      targetX = feet ? feet.x - width / 2 : (facing > 0 ? sceneWin.width + width : -width * 2)
      if (feet) facing = targetX > x ? 1 : -1
      carrying = false
      mode = "walk"
      visible = true
    }
    function step(dt) {
      y = sceneWin.groundTop(x + width / 2) - height
      var speed = mode === "flee" ? 520 : 110
      if (mode === "walk") {
        x += facing * speed * dt
        if ((facing > 0 && x >= targetX) || (facing < 0 && x <= targetX)) {
          if (targetId && sceneWin.service.find("snowman", targetId)) { mode = "grab"; wait = 1.1 }
          else mode = "leave"
        }
      } else if (mode === "grab") {
        wait -= dt
        if (wait <= 0) {
          if (sceneWin.service.find("snowman", targetId)) {
            sceneWin.service.removeItem("snowman", targetId)
            carrying = true
            sceneWin.service.notify("The Yeti took your snowman!", "Click him next time to scare him off.")
          }
          facing = x + width / 2 < sceneWin.width / 2 ? -1 : 1
          mode = "leave"
        }
      } else {
        x += facing * speed * dt
      }
      paint()
      if (x < -width * 1.5 || x > sceneWin.width + width * 0.5) { mode = ""; visible = false }
    }
    onTapped: {
      if (mode === "flee" || carrying) return
      sceneWin.say("Eek!", x + width / 2, y)
      facing = x + width / 2 < sceneWin.width / 2 ? -1 : 1
      mode = "flee"
    }
  }

  Visitor {
    id: train
    scene: sceneWin
    width: 200; height: 80
    property string mode: ""        // "", "in", "stop", "out"
    property var job: null
    property real stopX: 0
    property real wait: 0
    property string cargo: ""
    painter: function(ctx, w, h, t) { Draw.train(ctx, w, h, t, 1, train.cargo) }

    function next() {
      if (!sceneWin.trainJobs.length) { mode = ""; visible = false; job = null; return }
      job = sceneWin.trainJobs[0]
      sceneWin.trainJobs = sceneWin.trainJobs.slice(1)
      x = -width
      if (job.type === "pickup") {
        var item = sceneWin.service.find(job.kind, job.id)
        var feet = item ? sceneWin.feetFor(item.place) : null
        stopX = feet ? feet.x - width * 0.21 : sceneWin.width * 0.5
        cargo = ""
      } else if (job.type === "deliver") {
        stopX = sceneWin.width * (0.3 + Math.random() * 0.4)
        cargo = job.gift.kind === "note" ? "note" : (job.gift.kind === "tree" ? "tree" : (job.gift.kind === "snowman" ? "snowman" : "gift"))
      } else {
        stopX = -1
        cargo = job.cargo
      }
      mode = "in"
      visible = true
    }
    function step(dt) {
      y = sceneWin.groundTop(x + width / 2) - height
      if (mode === "in") {
        x += 180 * dt
        if (stopX >= 0 && x >= stopX) { x = stopX; mode = "stop"; wait = 1.2 }
        else if (stopX < 0 && x > sceneWin.width) { next(); return }
      } else if (mode === "stop") {
        wait -= dt
        if (wait <= 0) {
          if (job.type === "pickup") {
            cargo = job.kind
            if (job.done) job.done()
          } else if (job.type === "deliver") {
            sceneWin.service.deliverAt(job.gift, sceneWin.placeAt(job.gift.kind, x + width * 0.21, sceneWin.groundY))
            cargo = ""
          }
          mode = "out"
        }
      } else if (mode === "out") {
        x += 200 * dt
        if (x > sceneWin.width) { next(); return }
      }
      paint()
    }
  }

  function say(text, x, y) {
    bubble = { text: String(text), x: x, y: y }
    bubbleTimer.restart()
  }
  Timer { id: bubbleTimer; interval: 2600; onTriggered: sceneWin.bubble = null }

  Rectangle {
    id: bubbleView
    visible: sceneWin.bubble !== null
    x: sceneWin.bubble ? Math.max(8, Math.min(sceneWin.width - width - 8, sceneWin.bubble.x - width / 2)) : 0
    y: sceneWin.bubble ? Math.max(8, sceneWin.bubble.y - height - 10) : 0
    width: Math.min(320, bubbleText.implicitWidth + 24)
    height: bubbleText.implicitHeight + 16
    radius: 10
    color: "#fbf7ee"
    border.color: "#d8ccb0"
    Text {
      id: bubbleText
      anchors.centerIn: parent
      width: Math.min(296, implicitWidth)
      wrapMode: Text.Wrap
      textFormat: Text.PlainText
      text: sceneWin.bubble ? sceneWin.bubble.text : ""
      color: "#3a2f22"
      font.pixelSize: 14
      font.family: Style.font.family
    }
  }

  // ------------------------------------------------------------ menus

  function openMenu(kind, id, x, y) { menuFor = { kind: kind, id: id, x: x, y: y } }

  ContextMenu {
    id: menu
    scene: sceneWin
  }

  Toolbar {
    id: toolbar
    scene: sceneWin
    visible: sceneWin.decorating
  }

  Item {
    focus: sceneWin.decorating
    Keys.onEscapePressed: {
      if (sceneWin.menuFor) sceneWin.menuFor = null
      else if (sceneWin.tool) sceneWin.tool = ""
      else sceneWin.service.stopDecorating()
    }
  }

  // ------------------------------------------------------------ input mask

  mask: Region {
    Region { item: sceneWin.decorating ? decorLayer : null }
    Region { item: santa.visible ? santa : null }
    Region { item: yeti.visible ? yeti : null }
    Region { item: menu.visible ? menu : null }
    Region { item: toolbar.visible ? toolbar : null }
    // The golden snowflake, while one falls.
    Region { x: sceneWin.goldenZone.x; y: sceneWin.goldenZone.y; width: sceneWin.goldenZone.w; height: sceneWin.goldenZone.h }
    // Snow and snowballs you can take hold of (see touchZones in sim.js).
    Region { x: sceneWin.zone(0).x; y: sceneWin.zone(0).y; width: sceneWin.zone(0).w; height: sceneWin.zone(0).h }
    Region { x: sceneWin.zone(1).x; y: sceneWin.zone(1).y; width: sceneWin.zone(1).w; height: sceneWin.zone(1).h }
    Region { x: sceneWin.zone(2).x; y: sceneWin.zone(2).y; width: sceneWin.zone(2).w; height: sceneWin.zone(2).h }
    Region { x: sceneWin.zone(3).x; y: sceneWin.zone(3).y; width: sceneWin.zone(3).w; height: sceneWin.zone(3).h }
    Region { x: sceneWin.zone(4).x; y: sceneWin.zone(4).y; width: sceneWin.zone(4).w; height: sceneWin.zone(4).h }
    Region { x: sceneWin.zone(5).x; y: sceneWin.zone(5).y; width: sceneWin.zone(5).w; height: sceneWin.zone(5).h }
    Region { x: sceneWin.zone(6).x; y: sceneWin.zone(6).y; width: sceneWin.zone(6).w; height: sceneWin.zone(6).h }
    Region { x: sceneWin.zone(7).x; y: sceneWin.zone(7).y; width: sceneWin.zone(7).w; height: sceneWin.zone(7).h }
    Region { x: sceneWin.zone(8).x; y: sceneWin.zone(8).y; width: sceneWin.zone(8).w; height: sceneWin.zone(8).h }
    Region { x: sceneWin.zone(9).x; y: sceneWin.zone(9).y; width: sceneWin.zone(9).w; height: sceneWin.zone(9).h }
    Region { x: sceneWin.zone(10).x; y: sceneWin.zone(10).y; width: sceneWin.zone(10).w; height: sceneWin.zone(10).h }
    Region { x: sceneWin.zone(11).x; y: sceneWin.zone(11).y; width: sceneWin.zone(11).w; height: sceneWin.zone(11).h }
    Region { x: sceneWin.zone(12).x; y: sceneWin.zone(12).y; width: sceneWin.zone(12).w; height: sceneWin.zone(12).h }
    Region { x: sceneWin.zone(13).x; y: sceneWin.zone(13).y; width: sceneWin.zone(13).w; height: sceneWin.zone(13).h }
    // One slot per decoration (3 trees, 12 snowmen, 24 gifts at most).
    Region { item: sceneWin.touchable(0) }
    Region { item: sceneWin.touchable(1) }
    Region { item: sceneWin.touchable(2) }
    Region { item: sceneWin.touchable(3) }
    Region { item: sceneWin.touchable(4) }
    Region { item: sceneWin.touchable(5) }
    Region { item: sceneWin.touchable(6) }
    Region { item: sceneWin.touchable(7) }
    Region { item: sceneWin.touchable(8) }
    Region { item: sceneWin.touchable(9) }
    Region { item: sceneWin.touchable(10) }
    Region { item: sceneWin.touchable(11) }
    Region { item: sceneWin.touchable(12) }
    Region { item: sceneWin.touchable(13) }
    Region { item: sceneWin.touchable(14) }
    Region { item: sceneWin.touchable(15) }
    Region { item: sceneWin.touchable(16) }
    Region { item: sceneWin.touchable(17) }
    Region { item: sceneWin.touchable(18) }
    Region { item: sceneWin.touchable(19) }
    Region { item: sceneWin.touchable(20) }
    Region { item: sceneWin.touchable(21) }
    Region { item: sceneWin.touchable(22) }
    Region { item: sceneWin.touchable(23) }
    Region { item: sceneWin.touchable(24) }
    Region { item: sceneWin.touchable(25) }
    Region { item: sceneWin.touchable(26) }
    Region { item: sceneWin.touchable(27) }
    Region { item: sceneWin.touchable(28) }
    Region { item: sceneWin.touchable(29) }
    Region { item: sceneWin.touchable(30) }
    Region { item: sceneWin.touchable(31) }
    Region { item: sceneWin.touchable(32) }
    Region { item: sceneWin.touchable(33) }
    Region { item: sceneWin.touchable(34) }
    Region { item: sceneWin.touchable(35) }
    Region { item: sceneWin.touchable(36) }
    Region { item: sceneWin.touchable(37) }
    Region { item: sceneWin.touchable(38) }
    Region { item: sceneWin.touchable(39) }
  }
}
