pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Services.UPower
import qs.Commons
import qs.Commons as Commons
import "lib/store.js" as Store
import "lib/season.js" as Season
import "lib/weather.js" as Weather
import "lib/theme.js" as Theme
import "lib/policy.js" as Policy
import "lib/sound.js" as Snd
import "lib/draw.js" as Draw
import "lib/sim.js" as Sim

// Flurry's headless core. Owns the saved state, the per-screen scenes, the
// window and pointer feeds the simulation reads, the visitors' schedule, and
// the friends inbox. The bar widget and the IPC target only talk to this.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  readonly property string pluginId: manifest && manifest.id ? manifest.id : "itscallssh.flurry"
  Translations { id: strings; directory: Qt.resolvedUrl("i18n") }
  function tr(key) { return strings.t(key) }

  // ------------------------------------------------------------------ state

  property var saved: Store.defaults()
  property bool loaded: false
  readonly property bool isOn: saved.enabled
  readonly property string effect: saved.effect
  readonly property real intensity: saved.intensity
  readonly property bool plowOn: saved.plow
  readonly property bool snowballsOn: saved.snowballs
  readonly property var effects: Store.EFFECTS

  // On battery (UPower, or /sys/class/power_supply when UPower has no
  // answer) the effect is halved and capped at 30 fps; below 20% it drops
  // further. Calm mode lowers it too. See Policy.gate.
  property var sysPower: ({ known: false, battery: false, onBattery: false, percent: 100 })
  // UPower answers for the system battery when it has one; then there is
  // nothing to read by hand.
  readonly property var upowerDevice: UPower.displayDevice
  readonly property bool upowerBattery: !!upowerDevice && !!upowerDevice.isPresent
  readonly property bool onBattery: UPower.onBattery || (!upowerBattery && sysPower.known && sysPower.onBattery)
  readonly property real batteryPercent: upowerBattery ? Math.max(0, Math.min(100, Number(upowerDevice.percentage) * 100 || 0))
                                                       : (sysPower.known ? sysPower.percent : 100)
  readonly property var gate: Policy.gate({ onBattery: onBattery, percent: batteryPercent, batterySaver: saved.batterySaver,
                                            calm: calmActive, surprises: saved.surprises, fireworks: saved.newYear })
  readonly property real quality: gate.quality
  readonly property int fpsCap: gate.fps

  readonly property string stateDir: {
    var base = Quickshell.env("XDG_STATE_HOME")
    if (!base) {
      var home = Quickshell.env("HOME")
      base = home ? home + "/.local/state" : ""
    }
    return base ? base + "/omarchy-flurry" : ""
  }

  // Replace the saved state with a changed copy, so bindings see a new object.
  function update(mutator) {
    var next = JSON.parse(JSON.stringify(root.saved))
    mutator(next)
    root.saved = Store.normalize(next)
    saveTimer.restart()
  }

  function setEnabled(on) { update(function(s) { s.enabled = !!on }) }
  function toggle() { setEnabled(!root.saved.enabled) }
  function setEffect(name) {
    if (Store.EFFECTS.indexOf(String(name)) < 0) return false
    update(function(s) { s.effect = String(name); s.enabled = true })
    return true
  }
  function nextEffect(delta) {
    var i = Store.EFFECTS.indexOf(root.saved.effect)
    var n = Store.EFFECTS.length
    setEffect(Store.EFFECTS[((i + (delta || 1)) % n + n) % n])
  }
  function setIntensity(v) { update(function(s) { s.intensity = Number(v) }) }
  function setVisitors(on) { update(function(s) { s.visitors = !!on }) }
  function setPlow(on) { update(function(s) { s.plow = !!on }) }
  function setSnowballs(on) { update(function(s) { s.snowballs = !!on }) }
  function setBatterySaver(on) { update(function(s) { s.batterySaver = !!on }) }
  function setSound(on) { update(function(s) { s.sound = !!on }) }
  function setSoundVolume(v) { update(function(s) { s.soundVolume = Math.max(0, Math.min(1, Number(v))) }) }
  // The newer switches, all by name (see Store.defaults for what each does).
  readonly property var flagNames: ["shake", "windGusts", "writing", "dayCycle", "seasons", "newYear", "surprises",
                                    "themeSync", "throwToFriends", "liveWeather"]
  function setFlag(name, on) {
    if (root.flagNames.indexOf(name) < 0) return false
    update(function(s) { s[name] = !!on })
    if (name === "liveWeather" && on) weatherSoon.restart()
    if (name === "surprises" && !on) dismissCritters()
    return true
  }
  function toggleFlag(name) { setFlag(name, !root.saved[name]); return root.saved[name] ? "on" : "off" }
  function setCalm(mode) {
    if (Store.CALM_MODES.indexOf(String(mode)) < 0) return false
    update(function(s) { s.calm = String(mode) })
    calmCheck.triggered()
    return true
  }

  Process {
    id: makeStateDir
    command: root.stateDir ? ["install", "-d", "-m", "700", root.stateDir] : ["true"]
    running: true
    onExited: function(code) {
      if (code === 0 && root.stateDir) stateFile.path = root.stateDir + "/state.json"
      else { root.saved = Store.defaults(); root.loaded = true }
    }
  }

  FileView {
    id: stateFile
    printErrors: false
    atomicWrites: true
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      var raw = null
      var body = text()
      var parseFailed = false
      if (body.length > 262144) {
        parseFailed = true
      } else {
        try { raw = JSON.parse(body) } catch (e) { parseFailed = true }
      }
      if (parseFailed) {
        // Keep the unreadable file beside the fresh one: it holds the
        // friend code and everything placed, and the next save replaces it.
        console.warn("flurry: state.json unreadable, starting fresh (kept as state.json.broken)")
        Quickshell.execDetached(["cp", "-f", "--remove-destination", "--", stateFile.path, stateFile.path + ".broken"])
      }
      root.saved = Store.normalize(raw)
      root.loaded = true
    }
    onLoadFailed: function(error) {
      root.saved = Store.defaults()
      root.loaded = true
    }
    onSaveFailed: function(error) { console.warn("flurry: could not save state.json: " + error) }
  }

  Timer {
    id: saveTimer
    interval: 800
    onTriggered: if (root.loaded && stateFile.path !== "") stateFile.setText(JSON.stringify(root.saved, null, 2) + "\n")
  }

  Component.onDestruction: {
    if (saveTimer.running) {
      saveTimer.stop()
      if (root.loaded && stateFile.path !== "") stateFile.setText(JSON.stringify(root.saved, null, 2) + "\n")
    }
    cliBedPlayer.pendingRestart = false
    cliBedPlayer.running = false
    inboxProc.running = false
    geoProc.running = false
    weatherProc.running = false
    sendProc.running = false
    pasteProc.running = false
    clientsProc.running = false
    cursorSocket.connected = false
    anchorSocket.connected = false
    if (root.anchorAvailable) Quickshell.execDetached(["hyprctl", "flurry", "clearall"])
  }

  // ------------------------------------------------------------ decorations

  // Each scene reports in, so the service can hand a visitor or a delivery to
  // the screen that should show it.
  property var scenes: ({})
  // What lies on windows out of sight (another workspace, another
  // monitor), shared by every screen's world (Sim.stashSurface).
  readonly property var sharedStash: Sim.sharedStash()
  function registerScene(name, scene) {
    var next = Object.assign({}, root.scenes); next[name] = scene; root.scenes = next
  }
  function unregisterScene(name, scene) {
    if (root.scenes[name] !== scene) return
    var next = Object.assign({}, root.scenes); delete next[name]; root.scenes = next
    if (root.decorating === name) root.decorating = ""
    sceneShown(name, false)
  }

  // Which screens show a scene right now. With none (Flurry off, or a
  // fullscreen app on every screen) the window, pointer and client feeds
  // rest: there is nothing to draw them for.
  property var shownScenes: ({})
  readonly property bool showing: root.active && Object.keys(root.shownScenes).length > 0
  function sceneShown(name, shown) {
    if (!!root.shownScenes[name] === !!shown) return
    var next = Object.assign({}, root.shownScenes)
    if (shown) next[name] = true; else delete next[name]
    root.shownScenes = next
  }
  // The focused screen's scene when it is live (shown, not under a
  // fullscreen app), else any live one: a visitor goes where it can be
  // seen, and a fullscreen app on the focused monitor does not keep them
  // away from the other.
  function liveScene() {
    var f = focusedScene()
    if (f && f.live) return f
    for (var k in root.scenes) if (root.scenes[k].live) return root.scenes[k]
    return f
  }
  function focusedScene() {
    var m = Hyprland.focusedMonitor
    if (m && root.scenes[m.name]) return root.scenes[m.name]
    for (var k in root.scenes) return root.scenes[k]
    return null
  }
  // The scene whose screen shows this window now, if any.
  function sceneShowing(addr, except) {
    for (var k in root.scenes) {
      var sc = root.scenes[k]
      if (sc && sc !== except && sc.rectFor && sc.rectFor(addr)) return sc
    }
    return null
  }
  function sceneForPlace(place) {
    return (place && root.scenes[place.screen]) || root.focusedScene()
  }

  function addTree(place) {
    if (root.saved.trees.length >= Store.MAX_TREES) {
      notify("Three trees is the limit", "Remove one to grow another.")
      return null
    }
    var t = Store.normalizeTree({ place: place, planted: Date.now() })
    update(function(s) { s.trees.push(t) })
    return t.id
  }
  function addSnowman(place, extra) {
    if (root.saved.snowmen.length >= Store.MAX_SNOWMEN) {
      notify("That's a lot of snowmen", "Remove one to roll another.")
      return null
    }
    // A new snowman is bare; click it to dress it.
    var m = Store.normalizeSnowman(Object.assign({ place: place, outfit: { nose: false, scarf: false, hat: false } }, extra || {}))
    update(function(s) { s.snowmen.push(m) })
    return m.id
  }
  function addGift(place, extra) {
    var g = Store.normalizeGift(Object.assign({ place: place }, extra || {}))
    update(function(s) {
      if (s.gifts.length >= Store.MAX_GIFTS) s.gifts = s.gifts.slice(-(Store.MAX_GIFTS - 1))
      s.gifts.push(g)
    })
    return g.id
  }
  function listFor(kind) {
    return kind === "tree" ? "trees" : (kind === "snowman" ? "snowmen" : "gifts")
  }
  function find(kind, id) {
    var list = root.saved[listFor(kind)]
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
    return null
  }
  function moveItem(kind, id, place) {
    update(function(s) {
      var list = s[listFor(kind)]
      for (var i = 0; i < list.length; i++) if (list[i].id === id) list[i].place = place
    })
  }
  function removeItem(kind, id) {
    update(function(s) {
      var key = listFor(kind)
      s[key] = s[key].filter(function(x) { return x.id !== id })
    })
  }
  function decorateTree(id, ornament) {
    var done = false
    update(function(s) {
      for (var i = 0; i < s.trees.length; i++) {
        var t = s.trees[i]
        if (t.id !== id) continue
        if (ornament.kind === "star") { t.star = true; done = true; continue }
        if (t.ornaments.length >= Store.MAX_ORNAMENTS) continue
        var palette = ornament.kind === "light" ? Store.LIGHT_COLORS : Store.BAUBLE_COLORS
        var o = { kind: ornament.kind, u: ornament.u, v: ornament.v, color: palette[t.ornaments.length % palette.length] }
        if (ornament.kind === "bauble" && s.ornamentStyle !== "glass") o.style = s.ornamentStyle
        t.ornaments.push(o)
        done = true
      }
    })
    return done
  }
  function openGift(id) {
    update(function(s) { for (var i = 0; i < s.gifts.length; i++) if (s.gifts[i].id === id) s.gifts[i].opened = true })
  }
  function clearDecorations() { update(function(s) { s.trees = []; s.snowmen = []; s.gifts = []; s.strings = [] }) }

  // A click puts the next piece of the outfit on a snowman (nose, scarf,
  // hat), and once it is all on, takes it off again. The scarf takes the
  // theme's colour while theme colours are on.
  function dressSnowman(id) {
    var next = null
    update(function(s) {
      for (var i = 0; i < s.snowmen.length; i++) {
        if (s.snowmen[i].id !== id) continue
        var before = Store.normalizeOutfit(s.snowmen[i].outfit)
        next = s.snowmen[i].outfit = Store.dressNext(before)
        if (next.scarf && !before.scarf) s.snowmen[i].themeScarf = !!s.themeSync
      }
    })
    return next
  }

  // Bauble finishes: the golden snowflake unlocks them, the menu picks one.
  function unlockOrnament() {
    var got = ""
    update(function(s) { got = Store.unlockNext(s) })
    if (got) notify("You caught the golden snowflake", "A new bauble finish: " + Store.ORNAMENT_STYLE_NAMES[got] + ". Your next baubles use it.")
    else notify("You caught the golden snowflake", "You have every bauble finish already. Lucky you.")
    return got
  }
  function setOrnamentStyle(style) {
    if (root.saved.ornamentStyles.indexOf(String(style)) < 0) return false
    update(function(s) { s.ornamentStyle = String(style) })
    return true
  }
  function nextOrnamentStyle() { setOrnamentStyle(Store.nextStyle(root.saved)); return root.saved.ornamentStyle }

  // Light strings belong to a window class, so they come back with the app.
  function lightsFor(cls) {
    for (var i = 0; i < root.saved.strings.length; i++) if (root.saved.strings[i].windowClass === cls) return root.saved.strings[i]
    return null
  }
  // Hangs a string on windows of `cls`, or, when it has one, changes its colours.
  function decorateWindow(cls) {
    if (!cls) return ""
    var have = lightsFor(cls)
    if (!have && root.saved.strings.length >= Store.MAX_STRINGS) {
      notify("That's a lot of lights", "Take a string down to hang another.")
      return ""
    }
    var palette = root.saved.themeSync ? "theme" : "warm"
    update(function(s) {
      for (var i = 0; i < s.strings.length; i++) {
        if (s.strings[i].windowClass !== cls) continue
        var p = Store.STRING_PALETTES
        palette = s.strings[i].palette = p[(p.indexOf(s.strings[i].palette) + 1) % p.length]
        return
      }
      s.strings.push(Store.normalizeString({ windowClass: cls, palette: palette }))
    })
    return palette
  }
  function removeWindowLights(cls) {
    update(function(s) { s.strings = s.strings.filter(function(l) { return l.windowClass !== cls }) })
  }
  // For `flurry lights`: on the focused window, cycling colours, then off.
  function focusedLights() {
    var t = Hyprland.activeToplevel
    var ipc = t ? t.lastIpcObject : null
    var cls = ipc ? String(ipc["class"] || "") : ""
    if (!cls) return "no window"
    var have = lightsFor(cls)
    if (have && have.palette === Store.STRING_PALETTES[Store.STRING_PALETTES.length - 1]) { removeWindowLights(cls); return "off" }
    return decorateWindow(cls) || "limit reached"
  }

  // Decorate mode turns the overlay on the focused screen interactive.
  property string decorating: ""   // screen name, or "" when off
  function startDecorating() {
    var m = Hyprland.focusedMonitor
    root.decorating = m ? m.name : ""
    if (!root.saved.enabled) setEnabled(true)
  }
  function stopDecorating() { root.decorating = "" }

  // --------------------------------------------------------- window feed
  //
  // Hyprland reports no events while a window is being dragged, so the
  // scenes cannot just wait for one. While the effect is on, the toplevel
  // list is refreshed on a timer: every frame for two seconds after any
  // window moved, every 50 ms while the pointer moves (a drag may be
  // starting), and every 200 ms otherwise. A refresh is one request on
  // Hyprland's socket, not a process.
  //
  // Which windows exist is not taken from that list alone. Quickshell
  // re-creates a closed window's toplevel when a j/clients reply that was
  // in flight as it closed arrives afterwards, and never drops it again; at
  // this polling rate that happens often, and it left a ghost window that
  // kept collecting snow in mid-air. So windows are also tracked by their
  // address: one that closed (closewindow) is kept out at once, and every
  // couple of seconds `hyprctl clients` says which windows really exist.

  // Addresses as Hyprland's events write them: lower-case hex, no 0x.
  function addrKey(a) {
    var k = String(a === undefined || a === null ? "" : a).trim().toLowerCase()
    return k.indexOf("0x") === 0 ? k.slice(2) : k
  }
  property var closedWindows: ({})       // address key -> when it closed (ms)
  property var liveWindows: null         // address key -> true, from hyprctl; null until the first read
  property int windowEpoch: 0            // bumped whenever either changes
  function windowExists(addr) {
    var k = addrKey(addr)
    if (!k || root.closedWindows[k]) return false
    return root.liveWindows === null || root.liveWindows[k] === true
  }
  // Whether Hyprland said this window closed (and no new window has
  // opened at its address since).
  function windowWasClosed(addr) {
    var k = addrKey(addr)
    return !!k && !!root.closedWindows[k]
  }
  function windowClosed(addr) {
    var k = addrKey(addr)
    if (!k) return
    var next = Object.assign({}, root.closedWindows)
    next[k] = Date.now()
    // Keep the list short: the oldest go first, unless a ghost still has them.
    var keys = Object.keys(next)
    if (keys.length > 256) {
      keys.sort(function(a, b) { return next[a] - next[b] })
      for (var i = 0; i < keys.length - 256; i++) delete next[keys[i]]
    }
    root.closedWindows = next
    if (root.liveWindows && root.liveWindows[k]) {
      var live = Object.assign({}, root.liveWindows)
      delete live[k]
      root.liveWindows = live
    }
    root.windowEpoch++
  }
  signal windowOpenedAt(string id)
  function windowOpened(addr) {
    var k = addrKey(addr)
    if (!k) return
    // Hyprland reuses addresses: a new window at one that closed is a new window.
    if (root.closedWindows[k]) {
      var next = Object.assign({}, root.closedWindows)
      delete next[k]
      root.closedWindows = next
    }
    // The scenes jostle the ledges around it when it shows up.
    root.windowOpenedAt("0x" + k)
    // It exists from now on, before the next `hyprctl clients` says so.
    if (root.liveWindows && !root.liveWindows[k]) {
      var live = Object.assign({}, root.liveWindows)
      live[k] = true
      root.liveWindows = live
    }
    root.windowEpoch++
  }

  Process {
    id: clientsProc
    // Asked for again while a read was running: read once more after it,
    // so the answer is never older than the last event.
    property bool again: false
    property real startedAt: 0
    property var collector: Policy.newCollector(262144)
    command: ["hyprctl", "-j", "clients"]
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        if (!Policy.collectChunk(clientsProc.collector, chunk)) {
          console.warn("flurry: hyprctl clients output exceeded 256 KiB; aborting")
          clientsProc.running = false
        }
      }
    }
    stderr: SplitParser { splitMarker: ""; onRead: function() {} }
    onExited: function(code) {
      var c = clientsProc.collector
      clientsProc.collector = Policy.newCollector(262144)
      if (code === 0 && !c.overflowed) {
        var list = null
        try { list = JSON.parse(c.buf) } catch (e) { list = null }
        if (list instanceof Array) {
          var live = {}
          for (var i = 0; i < list.length; i++) if (list[i] && list[i].address) live[root.addrKey(list[i].address)] = true
          // A window this says exists, that closed before this read began,
          // is a new window at a reused address. One that closed while the
          // read ran is closed: the reply is older than the event.
          var closed = root.closedWindows, changed = false, nextClosed = Object.assign({}, closed)
          for (var k in live) {
            if (!nextClosed[k]) continue
            if (nextClosed[k] < clientsProc.startedAt) { delete nextClosed[k]; changed = true }
            else delete live[k]
          }
          if (changed) root.closedWindows = nextClosed
          root.liveWindows = live
          root.windowEpoch++
        } else {
          console.warn("flurry: hyprctl clients returned unexpected output")
        }
      } else if (code !== 0) {
        console.warn("flurry: hyprctl clients exited with code " + code)
      }
      if (again) { again = false; root.readClients() }
    }
  }
  Timer {
    id: clientsSoon
    interval: 60
    onTriggered: { if (clientsProc.running) clientsProc.again = true; else root.readClients() }
  }
  // The window events keep the list current (clientsSoon); this read is
  // a safety net for an event missed, and the first read when a scene
  // shows again.
  Timer {
    interval: 30000
    repeat: true
    running: root.showing
    triggeredOnStart: true
    onTriggered: if (!clientsProc.running) root.readClients()
  }
  function readClients() {
    clientsProc.collector = Policy.newCollector(262144)
    clientsProc.startedAt = Date.now()
    clientsProc.running = true
  }

  property real lastMotion: 0
  property real lastPointerMove: 0
  property real lastSetOff: 0
  // When the windows were last asked for (the answer is back within a
  // frame or so). A dragged window's snow is painted ahead of its reading
  // only until a reading taken after the pointer set off shows it still
  // (see draw.js leadOf).
  property real windowsReadAt: 0
  // Something moved or changed on the desktop: every scene resting its
  // frame loop wakes (SceneWindow idle).
  signal wakeScenes()
  function noteMotion() {
    var idle = Date.now() - root.lastMotion >= 2000
    root.lastMotion = Date.now()
    root.dragActive = true
    root.wakeScenes()
    // Waking from idle: poll fast at once instead of after the idle tick.
    if (idle && windowPoll.running) { windowPoll.interval = root.fastPoll; windowPoll.restart() }
    if (idle && cursorPoll.running) { cursorPoll.interval = root.fastPoll; cursorPoll.restart() }
  }
  // A drag (or any window motion the events do not tell of) is under way:
  // windows moved within the last two seconds, or the focused window moved
  // under the pointer (takeCursorReply). Only then is the window list read
  // on a timer; otherwise Hyprland's events say when to read it.
  property bool dragActive: false
  readonly property bool active: root.loaded && root.saved.enabled

  // While something moves the list is read every frame (about 60 times a
  // second), so the snow physics sees a drag as the smooth motion it is and
  // can tell a gentle drag from a jerk. Two seconds after the last change it
  // drops back to a slower rate.
  readonly property int fastPoll: 16
  readonly property int pointerPoll: 50
  // With the pointer feed on, a mouse drag wakes the fast poll at once, so
  // the idle rate only has to catch keyboard resizes.
  readonly property int idlePoll: root.wantsPointer ? 400 : 200
  function pollInterval() {
    var now = Date.now()
    if (now - root.lastMotion < 2000) return root.fastPoll
    // Just set off from rest: this may be a drag starting, so the windows
    // are read every frame until it shows (see takePointer).
    if (now - root.lastSetOff < 300) return root.fastPoll
    if (now - root.lastPointerMove < 400) return root.pointerPoll
    return root.idlePoll
  }
  // When the compositor last rearranged windows itself (ms), and the gap
  // between window polls right now (s): the scenes tell a drag from a jump
  // with these and the pointer.
  property real lastLayoutEvent: 0
  readonly property real windowPollGap: (windowPoll.running ? windowPoll.interval : root.pointerPoll) / 1000
  Timer {
    id: windowPoll
    running: root.showing && root.dragActive
    repeat: true
    interval: root.fastPoll
    onTriggered: {
      { Hyprland.refreshToplevels(); root.windowsReadAt = Date.now() }
      var now = Date.now()
      // The drag is over: no window has moved for two seconds and the
      // pointer has not just set off.
      if (now - root.lastMotion >= 2000 && now - root.lastSetOff >= 300) { root.dragActive = false; return }
      interval = root.pollInterval()
    }
  }
  // The border Hyprland draws around windows (general:border_size). Window
  // geometry leaves it out, so the icicles hang from its outer edge. Read
  // once when the scene first shows and again when Hyprland reloads its
  // config; nothing polls it.
  property int windowBorder: 2
  property bool borderRead: false
  onShowingChanged: {
    if (!showing) return
    if (!borderRead) readBorder()
    Hyprland.refreshMonitors()
  }
  function readBorder() {
    borderRead = true
    if (borderProc.running) return
    borderProc.collector = Policy.newCollector(4096)
    borderProc.running = true
  }
  Process {
    id: borderProc
    property var collector: Policy.newCollector(4096)
    command: ["hyprctl", "-j", "getoption", "general:border_size"]
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        if (!Policy.collectChunk(borderProc.collector, chunk)) borderProc.running = false
      }
    }
    onExited: function(code) {
      var c = borderProc.collector
      borderProc.collector = Policy.newCollector(4096)
      if (code !== 0 || c.overflowed) return
      var o = null
      try { o = JSON.parse(c.buf) } catch (e) { o = null }
      var b = o ? Number(o.int !== undefined ? o.int : o.value) : NaN
      if (isFinite(b) && b >= 0 && b <= 20) root.windowBorder = Math.round(b)
    }
  }
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      var name = String(event.name)
      if (name === "configreloaded") root.readBorder()
      if (!root.showing) return
      // Monitors and what they reserve (the bar, panels): the scenes keep
      // out of the reserved areas and stand the ground above the bottom one,
      // so they are read again whenever those can have changed (and when
      // the scenes show again). Quickshell fills
      // HyprlandMonitor.lastIpcObject only on refreshMonitors().
      switch (name) {
      case "monitoradded": case "monitoraddedv2": case "monitorremoved": case "monitorremovedv2":
      case "configreloaded": case "openlayer": case "closelayer":
        monitorsSoon.restart()
        break
      case "activespecial": case "activespecialv2":
        // Which special workspace a monitor shows is read from its
        // lastIpcObject, which only refreshMonitors() fills: read it now,
        // or the scratchpad's windows keep (or never get) their ledges.
        Hyprland.refreshMonitors()
      }
      switch (name) {
      case "closewindow":
        root.windowClosed(String(event.data).split(",")[0])
        break
      case "openwindow":
        root.windowOpened(String(event.data).split(",")[0])
        break
      }
      switch (name) {
      // Windows rearranged by the compositor, not dragged: a move of a window
      // right after one of these is a jump, never a yank (see Sim.dragging).
      // Focus changes are left out: clicking a window to drag it is one.
      case "openwindow": case "closewindow": case "movewindowv2": case "changefloatingmode":
      case "fullscreen": case "workspacev2": case "focusedmonv2": case "moveworkspacev2":
      case "activespecial": case "activespecialv2": case "minimized":
        root.lastLayoutEvent = Date.now()
      }
      switch (name) {
      case "openwindow": case "closewindow": case "movewindowv2": case "changefloatingmode":
      case "fullscreen": case "workspacev2": case "focusedmonv2":
      case "moveworkspacev2": case "activespecial": case "activespecialv2": case "minimized":
        { Hyprland.refreshToplevels(); root.windowsReadAt = Date.now() }
        root.noteMotion()
        clientsSoon.restart()
        break
      case "activewindowv2":
        // A focus change only restacks: one read of the list for the new
        // order, nothing more (no fast poll, no hyprctl, no wake-up).
        { Hyprland.refreshToplevels(); root.windowsReadAt = Date.now() }
        break
      }
    }
  }

  // Layer events come in bursts (a bar reloading opens a layer per
  // monitor), so the monitors are read once after the burst.
  Timer {
    id: monitorsSoon
    interval: 120
    onTriggered: Hyprland.refreshMonitors()
  }

  // ---------------------------------------------------------- pointer feed
  //
  // The overlay takes no input, so it cannot see the pointer. The air the
  // pointer drags along scatters snow, leaves and petals and fireflies
  // gather around it, so for those effects it is read from Hyprland's
  // socket, about 20 times a second. Rain and starfall do not need it.

  readonly property bool wantsPointer: root.active && ((root.saved.effect !== "rain" && root.saved.effect !== "starfall") || root.saved.strings.length > 0)
  property var pointer: ({ x: 0, y: 0, vx: 0, vy: 0, present: false, stillFor: 0, at: 0 })
  readonly property string hyprSocket: {
    var dir = Quickshell.env("XDG_RUNTIME_DIR"), sig = Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE")
    return dir && sig ? dir + "/hypr/" + sig + "/.socket.sock" : ""
  }

  // The focused window as Hyprland had it at the same instant as the
  // pointer reading: { id ("0x" + hex), x, y, w, h (global layout px),
  // at (ms) }, or null. A dragged window is the focused one, and the window
  // list (refreshToplevels) answers a poll or two behind the compositor, so
  // the scenes take this window's rectangle from here while it is fresh
  // (see Policy.withSnapshot): its snow is then kept and painted where the
  // window really is, instead of trailing it as a line.
  property var focusSnap: null
  property int focusSeq: 0
  Timer {
    id: setOffRead
    interval: 70
    onTriggered: if (root.showing) { Hyprland.refreshToplevels(); root.windowsReadAt = Date.now() }
  }
  // Older Hyprland that cannot answer the batch: the plain cursorpos.
  property bool cursorBatch: true

  Socket {
    id: cursorSocket
    path: root.hyprSocket
    property string buf: ""
    property bool abortedByPoll: false
    onConnectedChanged: {
      if (!connected) {
        // Hyprland closed its end: whatever came is all there is, unless
        // the poll timer cancelled a slow read before reconnecting.
        if (!abortedByPoll && buf !== "") root.takeCursorReply(buf, true)
        abortedByPoll = false
        buf = ""
        return
      }
      abortedByPoll = false
      buf = ""
      write(root.cursorBatch ? Policy.CURSOR_BATCH : "cursorpos")
      flush()
    }
    parser: SplitParser {
      // Hyprland writes the reply with no closing newline, possibly in
      // more than one chunk, so the chunks are gathered until it reads whole.
      splitMarker: ""
      onRead: function(chunk) {
        var s = String(chunk)
        if (cursorSocket.buf.length + s.length > 65536) {
          cursorSocket.abortedByPoll = true
          cursorSocket.buf = ""
          cursorSocket.connected = false
          return
        }
        cursorSocket.buf += s
        // Hyprland closes its end once it has answered; closing ours first
        // keeps Quickshell from logging a PeerClosedError on every poll.
        if (root.takeCursorReply(cursorSocket.buf, false)) { cursorSocket.buf = ""; cursorSocket.connected = false }
      }
    }
  }
  // True once the reply was read (or given up on).
  function takeCursorReply(text, whole) {
    var r = Policy.parseCursorReply(text)
    if (r.state === "partial" && !whole) return false
    if (r.state !== "ok") {
      // Not understood: fall back to the plain request from now on.
      if (root.cursorBatch) { root.cursorBatch = false; console.warn("flurry: the pointer batch was not understood; using cursorpos") }
      return true
    }
    var now = Date.now()
    var k = r.win ? root.addrKey(r.win.address) : ""
    var was = root.focusSnap
    root.focusSnap = k ? { id: "0x" + k, x: r.win.x, y: r.win.y, w: r.win.w, h: r.win.h, at: now } : null
    // The focused window moved or changed size with no event: a drag (or a
    // keyboard resize). Read the window list every frame while it lasts.
    if (was && root.focusSnap && was.id === root.focusSnap.id
        && (was.x !== r.win.x || was.y !== r.win.y || was.w !== r.win.w || was.h !== r.win.h)) root.noteMotion()
    root.focusSeq++
    root.takePointer(r.x, r.y)
    return true
  }

  // 30 times a second, every frame while a window is moving or the pointer
  // has just set off (cursorpos and activewindow are cheap requests): a
  // dragged window's rectangle is read from here (see focusSnap), so a drag
  // setting off is caught within a couple of frames. It runs for every
  // effect, since every effect lays something on the windows; the pointer
  // itself is only handed on for the effects that use it (wantsPointer).
  Timer {
    id: cursorPoll
    running: root.showing && root.hyprSocket !== ""
    repeat: true
    interval: 33
    onTriggered: {
      if (cursorSocket.connected) { cursorSocket.abortedByPoll = true; cursorSocket.connected = false }
      cursorSocket.connected = true
      interval = Date.now() - root.lastMotion < 2000 || Date.now() - root.lastSetOff < 300 ? root.fastPoll : 33
    }
  }


  // ------------------------------------------- the compositor plugin
  //
  // With hyprland-plugin/ (flurry-anchor) loaded, the compositor paints
  // what lies on each window (frost, ledge, icicles) with the window, in
  // the frame it moves it, from strips the scenes render (SceneWindow
  // anchor*). Without it the overlay paints them, a few frames behind a
  // moving window. Requests go over Hyprland's socket one batch at a time.
  property bool anchorAvailable: false
  readonly property string anchorDir: {
    var d = Quickshell.env("XDG_RUNTIME_DIR")
    return d ? d + "/flurry-anchor" : ""
  }
  property bool anchorDirReady: false
  Process {
    id: makeAnchorDir
    command: ["mkdir", "-p", root.anchorDir]
    running: root.anchorDir !== ""
    onExited: function(code) { root.anchorDirReady = code === 0 }
  }
  property var anchorQueue: []
  property bool anchorBusy: false
  // Send a batch of `n` requests; done(replyText or null) when answered.
  function anchorSend(text, n, done) {
    if (!text || root.hyprSocket === "" || root.anchorQueue.length >= 64) { if (done) done(null); return }
    root.anchorQueue = root.anchorQueue.concat([{ text: text, n: n, done: done }])
    if (!root.anchorBusy) root.anchorNext()
  }
  function anchorNext() {
    if (!root.anchorQueue.length) { root.anchorBusy = false; return }
    root.anchorBusy = true
    anchorSocket.job = root.anchorQueue[0]
    root.anchorQueue = root.anchorQueue.slice(1)
    anchorSocket.buf = ""
    anchorStall.restart()
    anchorSocket.connected = true
  }
  function anchorFinish() {
    anchorStall.stop()
    var job = anchorSocket.job, text = anchorSocket.buf
    anchorSocket.job = null
    anchorSocket.buf = ""
    if (job && job.done) { try { job.done(text) } catch (e) { console.warn("flurry: anchor reply: " + e) } }
    root.anchorNext()
  }
  Socket {
    id: anchorSocket
    path: root.hyprSocket
    property var job: null
    property string buf: ""
    onConnectedChanged: {
      if (connected) {
        if (job) { write(job.text); flush() }
        return
      }
      if (job) root.anchorFinish()
    }
    parser: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        var s = String(chunk)
        if (anchorSocket.buf.length + s.length > 65536) {
          anchorSocket.buf = ""
          anchorSocket.connected = false
          return
        }
        anchorSocket.buf += s
        // Every answer in: close our end first (as the pointer feed does).
        var job = anchorSocket.job
        if (job && Policy.anchorBatchComplete(anchorSocket.buf, job.n)) anchorSocket.connected = false
      }
    }
  }
  // Hidden or off: nothing the compositor plugin holds stays on the windows.
  Connections {
    target: root
    function onShowingChanged() { if (!root.showing && root.anchorAvailable) root.anchorSend(Policy.anchorBatch([Policy.ANCHOR_CLEAR_ALL]), 1, null) }
  }
  Timer {
    id: anchorStall
    interval: 600
    onTriggered: { if (anchorSocket.connected) anchorSocket.connected = false; else if (anchorSocket.job) root.anchorFinish() }
  }
  // Whether the plugin is there, asked every few seconds; the same ping
  // tells the plugin Flurry is still running (it stops drawing what Flurry
  // left once Flurry falls silent).
  Timer {
    interval: root.anchorAvailable ? 4000 : 8000
    repeat: true
    running: root.showing && root.hyprSocket !== "" && root.anchorDirReady
    triggeredOnStart: true
    onTriggered: root.anchorSend(Policy.anchorBatch([Policy.ANCHOR_PING]), 1, function(text) {
      var ok = Policy.anchorPingOk(String(text || "").trim())
      // Found it: whatever an earlier session left on the windows goes first.
      if (ok && !root.anchorAvailable) root.anchorSend(Policy.anchorBatch([Policy.ANCHOR_CLEAR_ALL]), 1, null)
      if (ok !== root.anchorAvailable) console.log("flurry: compositor plugin " + (ok ? "found: frost and snow ride the windows" : "not loaded: the overlay paints the windows' snow"))
      root.anchorAvailable = ok
    })
  }

  // The pointer as last read, whether or not the effect uses it.
  property var cursor: ({ x: 0, y: 0, vx: 0, vy: 0, present: false, stillFor: 0, at: 0 })
  readonly property var noPointer: ({ x: 0, y: 0, vx: 0, vy: 0, present: false, stillFor: 0, at: 0 })
  function takePointer(x, y) {
    var now = Date.now()
    var p = root.cursor
    var dt = p.at ? Math.max(0.016, (now - p.at) / 1000) : 0.05
    var vx = (x - p.x) / dt, vy = (y - p.y) / dt
    var moved = Math.abs(x - p.x) + Math.abs(y - p.y) > 2
    // A moving pointer may be dragging a window: poll windows faster.
    if (moved) {
      var wasIdle = now - root.lastPointerMove >= 400 && now - root.lastMotion >= 2000
      root.lastPointerMove = now
      // Setting off after a rest is how every drag begins: read the windows
      // at once and every frame for a moment, so a dragged window's snow
      // starts moving with it a frame or two in, not a poll later.
      if (p.stillFor > 0.08 && root.showing) {
        root.lastSetOff = now
        { Hyprland.refreshToplevels(); root.windowsReadAt = Date.now() }
        // A drag may be starting (of the focused window, which the pointer
        // feed itself follows, or of another): read again a moment later;
        // a window found moving turns the drag poll on (noteMotion).
        setOffRead.restart()
        if (cursorPoll.running) { cursorPoll.interval = root.fastPoll; cursorPoll.restart() }
      } else if (wasIdle && windowPoll.running) { windowPoll.interval = root.pointerPoll; windowPoll.restart() }
      if (root.wantsPointer) root.wakeScenes()
    }
    root.cursor = {
      x: x, y: y,
      vx: p.at ? p.vx * 0.4 + vx * 0.6 : 0, vy: p.at ? p.vy * 0.4 + vy * 0.6 : 0,
      present: true, stillFor: moved ? 0 : p.stillFor + dt, at: now
    }
    // Only the effects that use the pointer are handed it.
    if (root.wantsPointer) root.pointer = root.cursor
    else if (root.pointer.present) root.pointer = root.noPointer
  }

  // ---------------------------------------------------------- visitors
  //
  // Santa crosses now and then while it snows. The Yeti comes for a snowman
  // when there is one on the ground. Both can be called up over IPC.

  Timer {
    id: santaTimer
    running: root.showing && root.saved.visitors && root.saved.effect === "snow"
    // The first visit comes a few minutes after the scene starts, then every
    // eight to twenty minutes.
    interval: 60000 * (3 + Math.random() * 2)
    onTriggered: { root.summonSanta(); interval = 60000 * (8 + Math.floor(Math.random() * 12)); restart() }
  }

  Timer {
    id: yetiTimer
    running: root.showing && root.saved.visitors && root.saved.snowmen.length > 0
    interval: 60000 * (10 + Math.floor(Math.random() * 15))
    onTriggered: { root.summonYeti(); interval = 60000 * (10 + Math.floor(Math.random() * 15)); restart() }
  }

  // Sends the plow out on the screen in focus, snow or not.
  // `flurry plow`: calls the plow now on the screen in focus, snow or not,
  // while the Snow plow switch is on. Switched off, it is refused (turn it
  // back on with `flurry plow on`). Returns what happened, in words.
  function summonPlow() {
    if (!root.saved.plow) return "the snow plow is off (flurry plow on)"
    var scene = focusedScene()
    var got = scene ? scene.callPlow() : "no screen"
    return got === "sent" ? "on its way" : (got === "out" ? "already out" : (got === "off" ? "the snow plow is off (flurry plow on)" : got))
  }
  function plowCommand(mode) {
    mode = String(mode || "").trim().toLowerCase()
    if (mode === "" || mode === "now" || mode === "call") return summonPlow()
    if (mode === "on" || mode === "off") { setPlow(mode === "on"); return mode }
    if (mode === "toggle") { setPlow(!root.saved.plow); return root.saved.plow ? "on" : "off" }
    if (mode === "status") return root.saved.plow ? "on" : "off"
    return "plow: on, off, toggle, or nothing to call it now"
  }

  function summonSanta() {
    var scene = focusedScene()
    return scene ? scene.callSanta() : false
  }

  function summonYeti() {
    // Go where a ground snowman is, else wherever the user is looking.
    for (var i = 0; i < root.saved.snowmen.length; i++) {
      var m = root.saved.snowmen[i]
      if (!m.place.windowClass && root.scenes[m.place.screen]) return root.scenes[m.place.screen].callYeti(m.id)
    }
    var scene = focusedScene()
    return scene ? scene.callYeti("") : false
  }

  // ---------------------------------------------------------- friends

  readonly property var identity: saved.identity
  readonly property var friends: saved.friends
  readonly property string friendCode: Store.friendCode(saved.identity)

  // The inbox id is drawn from /dev/urandom rather than Math.random.
  Process {
    id: identityProc
    property string name: ""
    property var collector: Policy.newCollector(256)
    command: ["sh", "-c", "od -An -tx1 -N16 /dev/urandom | tr -d ' \\n'"]
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        if (!Policy.collectChunk(identityProc.collector, chunk)) identityProc.running = false
      }
    }
    onExited: function(code) {
      var c = identityProc.collector
      identityProc.collector = Policy.newCollector(256)
      var id = code === 0 && !c.overflowed ? c.buf.trim() : ""
      if (!/^[a-f0-9]{32}$/.test(id)) { root.notify("Couldn't set up friends", "No randomness from /dev/urandom."); return }
      root.update(function(s) { s.identity = { id: id, name: identityProc.name } })
    }
  }

  function setupFriends(name) {
    if (root.saved.identity) {
      if (name) update(function(s) { s.identity.name = String(name).slice(0, 40) })
      return
    }
    if (identityProc.running) return
    identityProc.collector = Policy.newCollector(256)
    identityProc.name = String(name || Quickshell.env("USER") || "Me").slice(0, 40)
    identityProc.running = true
  }

  function copyFriendCode() {
    if (!root.friendCode) { setupFriends(""); return false }
    Quickshell.execDetached(["wl-copy", root.friendCode])
    notify("Friend code copied", "Send it to a friend who runs Flurry.")
    return true
  }

  function addFriend(code) {
    var f = Store.parseFriendCode(code)
    if (!f) { notify("That isn't a Flurry friend code", "It looks like flurry1:name:…"); return false }
    if (root.saved.identity && f.id === root.saved.identity.id) { notify("That's your own code", ""); return false }
    var exists = !!friendById(f.id)
    if (!exists && root.saved.friends.length >= Store.MAX_FRIENDS) {
      notify("Friend list is full", "Remove a friend before adding another.")
      return false
    }
    update(function(s) {
      s.friends = s.friends.filter(function(x) { return x.id !== f.id })
      s.friends.push(f)
    })
    notify("Added " + f.name, "You can send them gifts now.")
    return true
  }

  Process {
    id: pasteProc
    property var collector: Policy.newCollector(Store.MAX_FRIEND_CODE_BYTES)
    command: ["wl-paste", "--no-newline"]
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        if (!Policy.collectChunk(pasteProc.collector, chunk)) pasteProc.running = false
      }
    }
    onExited: function(code) {
      var c = pasteProc.collector
      pasteProc.collector = Policy.newCollector(Store.MAX_FRIEND_CODE_BYTES)
      if (c.overflowed) { root.notify("That isn't a Flurry friend code", "Clipboard content is too large."); return }
      if (code !== 0) { root.notify("Clipboard is empty", "Copy a friend code first."); return }
      root.addFriend(c.buf)
    }
  }
  function addFriendFromClipboard() {
    if (pasteProc.running) return
    pasteProc.collector = Policy.newCollector(Store.MAX_FRIEND_CODE_BYTES)
    pasteProc.running = true
  }

  function removeFriend(id) { update(function(s) { s.friends = s.friends.filter(function(x) { return x.id !== id }) }) }

  // Outgoing gifts queue up and go one at a time.
  property var outbox: []
  function post(friendId, message) {
    if (root.outbox.length >= Store.MAX_OUTBOX) return false
    root.outbox = root.outbox.concat([{ topic: Store.topicFor(friendId), body: JSON.stringify(message) }])
    if (!sendProc.running) sendNext()
    return true
  }
  function sendNext() {
    if (!root.outbox.length) return
    var next = root.outbox[0]
    root.outbox = root.outbox.slice(1)
    sendProc.environment = { FLURRY_URL: root.saved.server + "/" + next.topic, FLURRY_BODY: next.body }
    sendProc.command = ["bash", "-c",
      "exec curl -sS -f -m 20 --connect-timeout 10 --proto =https --proto-redir =https --max-redirs 0 "
      + "-H 'Content-Type: application/json' -H 'Cache: yes' "
      + "--config <(printf 'url = \"%s\"\\n' \"$FLURRY_URL\") --data-binary @<(printf '%s' \"$FLURRY_BODY\")"]
    sendProc.running = true
  }
  Process {
    id: sendProc
    stdout: SplitParser { splitMarker: ""; onRead: function() {} }
    stderr: SplitParser { splitMarker: ""; onRead: function() {} }
    onExited: function(code) {
      sendProc.environment = ({})
      if (code !== 0) root.notify("A gift didn't go out", "The train couldn't reach " + root.saved.server + ".")
      root.sendNext()
    }
  }

  function friendById(id) {
    for (var i = 0; i < root.saved.friends.length; i++) if (root.saved.friends[i].id === id) return root.saved.friends[i]
    return null
  }

  // Send what is on the desktop: the train comes for it and it leaves.
  property var pendingSends: ({})
  function sendItem(kind, id, friendId) {
    var friend = friendById(friendId)
    if (!friend || !root.saved.identity) return false
    var key = kind + ":" + id
    if (root.pendingSends[key]) return false
    var item = find(kind, id)
    if (!item) return false
    var payload = kind === "tree" ? { star: item.star, size: item.size, ornaments: item.ornaments }
                                  : { scarf: item.themeScarf && root.theme ? root.theme.scarf : item.scarf, size: item.size, outfit: item.outfit }
    var scene = sceneForPlace(item.place)
    root.pendingSends[key] = true
    var go = function() {
      delete root.pendingSends[key]
      if (!root.find(kind, id)) return
      root.post(friend.id, Store.giftMessage(root.saved.identity, kind, payload))
      root.removeItem(kind, id)
      root.notify("On its way to " + friend.name, "")
    }
    if (scene) scene.trainPickup(kind, id, go)
    else go()
    return true
  }

  function sendNote(friendId, note) {
    var friend = friendById(friendId)
    var text = String(note || "").trim()
    if (!friend || !root.saved.identity || !text) return false
    if (!root.post(friend.id, Store.giftMessage(root.saved.identity, "note", { note: text }))) return false
    var scene = focusedScene()
    if (scene) scene.trainDepart("note")
    notify("Note sent to " + friend.name, "")
    return true
  }

  // Incoming: one long-lived stream of the inbox topic, resumed from the
  // last message seen so nothing sent while the shell was down is lost
  // (ntfy keeps messages for a while).
  readonly property bool inboxWanted: root.loaded && !!root.saved.identity
  readonly property string inboxTarget: inboxWanted ? (root.saved.server + "/" + Store.topicFor(root.saved.identity.id)) : ""
  property int inboxBackoff: 5
  property real giftWindowStart: 0
  property int giftWindowCount: 0

  function receiveGiftAllowed(gift) {
    if (gift.kind === "snowball") return true
    var now = Date.now()
    if (now - root.giftWindowStart > 10000) {
      root.giftWindowStart = now
      root.giftWindowCount = 0
    }
    if (root.giftWindowCount >= 5) return false
    root.giftWindowCount++
    return true
  }

  function handleInboxLine(line) {
    var ev = Store.classifyInboxEvent(line, root.saved.friends)
    if (!ev) return
    root.inboxBackoff = 5
    if (ev.type !== "gift") return
    if (ev.gift.kind === "snowball") {
      root.receive(ev.gift)
      if (ev.id) root.update(function(s) { s.inboxSince = ev.id })
      return
    }
    if (ev.id) ev.gift.inboxId = ev.id
    if (root.receiveGiftAllowed(ev.gift)) root.receive(ev.gift)
    else if (ev.id) root.update(function(s) { s.inboxSince = ev.id })
  }

  function startInbox() {
    if (!root.inboxWanted || inboxProc.running) return
    var url = root.inboxTarget + "/json?since=" + root.saved.inboxSince
    inboxProc.stream = Policy.newLineStream(Store.MAX_INBOX_LINE)
    inboxProc.environment = { FLURRY_URL: url }
    inboxProc.command = ["sh", "-c",
      "exec curl -sS -f -N --no-buffer --connect-timeout 10 --limit-rate 64K "
      + "--proto =https --proto-redir =https --max-redirs 0 --speed-limit 1 --speed-time 180 --config - <<EOF\nurl = \"$FLURRY_URL\"\nEOF"]
    inboxProc.running = true
  }

  Process {
    id: inboxProc
    running: false
    property var stream: Policy.newLineStream(Store.MAX_INBOX_LINE)
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        if (!Policy.pushLineChunk(inboxProc.stream, chunk, root.handleInboxLine)) {
          console.warn("flurry: ntfy stream line exceeded " + Store.MAX_INBOX_LINE + " bytes; reconnecting")
          inboxProc.running = false
        }
      }
    }
    stderr: SplitParser { splitMarker: ""; onRead: function() {} }
    onExited: {
      inboxProc.environment = ({})
      if (root.inboxWanted) inboxRetry.restart()
    }
  }

  Timer {
    id: inboxRetry
    interval: root.inboxBackoff * 1000
    onTriggered: {
      root.inboxBackoff = Math.min(120, root.inboxBackoff * 2)
      root.startInbox()
    }
  }

  onInboxWantedChanged: {
    if (inboxWanted) root.startInbox()
    else { inboxRetry.stop(); inboxProc.running = false }
  }
  onInboxTargetChanged: {
    if (!inboxWanted) return
    if (inboxProc.running) inboxProc.running = false
    else if (!inboxRetry.running) root.startInbox()
  }

  function receive(gift) {
    if (gift.kind === "snowball") { catchSnowball(gift); return }
    var scene = focusedScene()
    if (scene) scene.trainDeliver(gift)
    else deliverAt(gift, { screen: "", fx: 0.5, fy: 1 })
  }

  // Called by the scene once the train has stopped, with where it stopped.
  function deliverAt(gift, place) {
    var who = gift.from + (gift.known ? "" : " (not in your friends)")
    if (gift.kind === "snowman" && root.saved.snowmen.length < Store.MAX_SNOWMEN) {
      addSnowman(place, { scarf: gift.art.scarf, size: gift.art.size, from: gift.from, outfit: gift.art.outfit || { nose: true, scarf: true, hat: true } })
      if (gift.note) addGift(Object.assign({}, place, { fx: Math.min(0.97, (place.fx || 0.5) + 0.05) }),
                             { kind: "note", from: gift.from, note: gift.note })
    } else if (gift.kind === "tree" && root.saved.trees.length < Store.MAX_TREES) {
      var t = Store.normalizeTree({ place: place, star: gift.art.star, size: gift.art.size,
                                    ornaments: gift.art.ornaments, planted: Date.now() })
      update(function(s) { s.trees.push(t) })
      if (gift.note) addGift(Object.assign({}, place, { fx: Math.min(0.97, (place.fx || 0.5) + 0.05) }),
                             { kind: "note", from: gift.from, note: gift.note })
    } else {
      addGift(place, { kind: gift.kind === "note" ? "note" : "gift", from: gift.from, note: gift.note })
    }
    if (gift.inboxId) root.update(function(s) { s.inboxSince = gift.inboxId })
    notify(gift.kind === "note" ? "A note from " + who : "A gift from " + who,
           gift.note || "The little train just dropped it off.")
  }

  // ---------------------------------------------------------- the environment
  //
  // Season, time of day and (optionally) the real weather, folded into one
  // object every scene's simulation reads. Recomputed every half minute and
  // whenever an input changes.

  property var env: Season.neutral()
  property string seasonOverride: ""      // "", "winter" or "spring": a preview
  property real springPreview: 0
  readonly property var weatherNow: saved.liveWeather ? Weather.usable(saved.weatherCache, envTick.stamp) : null

  function computeEnv() {
    root.env = Season.environment(new Date(), {
      weather: root.weatherNow, seasons: root.saved.seasons, dayCycle: root.saved.dayCycle,
      override: root.seasonOverride, springAt: root.springPreview, calm: root.calmActive
    })
  }
  Timer {
    id: envTick
    property real stamp: Date.now()
    interval: 30000
    repeat: true
    // The scene's weather and light only matter while a scene shows; it is
    // worked out afresh the moment one does.
    running: root.showing
    triggeredOnStart: true
    onTriggered: { stamp = Date.now(); root.computeEnv() }
  }
  onWeatherNowChanged: computeEnv()
  onCalmActiveChanged: { computeEnv(); if (root.calmActive) dismissCritters() }
  onSavedChanged: if (root.loaded) root.computeEnv()

  // `flurry season spring` previews the thaw: the snow eases off and melts,
  // sprouts come up and blossom falls, over about a minute. `winter` holds
  // deep winter; `auto` goes back to the calendar.
  function previewSeason(name) {
    name = String(name || "auto")
    if (name === "auto" || name === "off") { root.seasonOverride = ""; springRamp.stop(); computeEnv(); return "auto (" + root.env.season + ")" }
    if (name !== "spring" && name !== "winter") return "season: auto, winter or spring"
    root.seasonOverride = name
    root.springPreview = 0
    if (name === "spring") springRamp.restart()
    computeEnv()
    if (!root.saved.enabled) setEnabled(true)
    return name
  }
  Timer {
    id: springRamp
    interval: 1000
    repeat: true
    onTriggered: {
      root.springPreview = Math.min(1, root.springPreview + 1 / 60)
      root.computeEnv()
      if (root.springPreview >= 1) stop()
    }
  }

  // ---------------------------------------------------------- live weather
  //
  // Open-Meteo, every 15 minutes while Live weather is on, for the city set
  // (looked up once through its geocoding API) or the coordinates given.
  // The last good reading is saved, so the scene keeps it through a restart
  // or a spell offline; after three hours without one the scene goes back to
  // the calendar's mild winter day.

  property int weatherFailures: 0
  property string missingCity: ""          // a city the geocoder didn't know: don't ask again
  property string weatherStatus: ""        // "", "loading", "ok", "not_found", "error"
  readonly property bool weatherWanted: root.active && root.saved.liveWeather
  readonly property bool weatherPlaced: root.saved.weatherLat !== null && root.saved.weatherLon !== null

  function setWeatherCity(name) {
    var city = String(name || "").trim()
    root.missingCity = ""
    root.weatherStatus = city ? "loading" : ""
    update(function(s) { s.weatherCity = city; s.weatherLat = null; s.weatherLon = null; s.weatherPlace = ""; s.liveWeather = city !== "" || s.liveWeather })
    weatherSoon.restart()
  }
  function setWeatherLocation(lat, lon) {
    if (!Weather.validLat(lat) || !Weather.validLon(lon)) return false
    root.missingCity = ""
    root.weatherStatus = "loading"
    update(function(s) { s.weatherLat = Number(lat); s.weatherLon = Number(lon); s.weatherCity = ""; s.weatherPlace = Number(lat).toFixed(2) + ", " + Number(lon).toFixed(2); s.liveWeather = true })
    weatherSoon.restart()
    return true
  }
  function weatherCommand(mode) {
    mode = String(mode || "")
    if (mode === "on" || mode === "off") { setFlag("liveWeather", mode === "on"); return mode }
    if (mode === "now" || mode === "refresh") {
      if (!root.saved.liveWeather) return "live weather is off (flurry weather on)"
      weatherSoon.restart()
      return "fetching"
    }
    var c = root.saved.weatherCache
    return JSON.stringify({ live: root.saved.liveWeather, place: root.saved.weatherPlace || root.saved.weatherCity,
                            reading: c ? c.current : null, at: c ? new Date(c.at).toISOString() : null, mapped: root.weatherNow })
  }
  function weatherCurlArgs(url) {
    return ["curl", "-sS", "-f", "-m", "15", "--connect-timeout", "10",
            "--max-filesize", String(Weather.MAX_RESPONSE_BYTES),
            "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "0", "--", url]
  }
  function fetchWeather() {
    if (!root.weatherWanted || geoProc.running || weatherProc.running) return
    if (!root.weatherPlaced) {
      if (!root.saved.weatherCity || root.saved.weatherCity === root.missingCity) return
      geoProc.langs = Weather.geocodeLanguages(Weather.cityParts(root.saved.weatherCity).name)
      geoProc.lang = 0
      root.geocodeNext()
      return
    }
    var furl = Weather.forecastUrl(root.saved.weatherLat, root.saved.weatherLon)
    if (!furl) return
    root.weatherStatus = "loading"
    weatherProc.collector = Policy.newCollector(Weather.MAX_RESPONSE_BYTES)
    weatherProc.command = weatherCurlArgs(furl)
    weatherProc.running = true
  }
  // Ask the geocoder in the next language for the name's script (see
  // Weather.geocodeLanguages).
  function geocodeNext() {
    var gurl = Weather.geocodeUrl(root.saved.weatherCity, geoProc.langs[geoProc.lang])
    if (!gurl) return false
    root.weatherStatus = "loading"
    geoProc.city = root.saved.weatherCity
    geoProc.collector = Policy.newCollector(Weather.MAX_RESPONSE_BYTES)
    geoProc.command = weatherCurlArgs(gurl)
    geoProc.running = true
    return true
  }
  function weatherFailed() {
    root.weatherFailures++
    root.weatherStatus = "error"
    weatherTimer.interval = Weather.retryDelay(root.weatherFailures)
    if (root.weatherWanted) weatherTimer.restart()
  }
  Process {
    id: geoProc
    property var collector: Policy.newCollector(Weather.MAX_RESPONSE_BYTES)
    property var langs: ["en"]
    property int lang: 0
    property string city: ""        // the city this request is for
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        if (!Policy.collectChunk(geoProc.collector, chunk)) {
          console.warn("flurry: Open-Meteo geocode response exceeded " + Weather.MAX_RESPONSE_BYTES + " bytes; aborting")
          geoProc.running = false
        }
      }
    }
    stderr: SplitParser { splitMarker: ""; onRead: function() {} }
    onExited: function(code) {
      var c = geoProc.collector
      geoProc.collector = Policy.newCollector(Weather.MAX_RESPONSE_BYTES)
      if (code !== 0 || c.overflowed) { root.weatherFailed(); return }
      // The city was changed while this was on its way: ask about the new one.
      if (geoProc.city !== root.saved.weatherCity) { weatherSoon.restart(); return }
      var res = Weather.parseGeocodeStatus(c.buf, Weather.cityParts(geoProc.city).hint)
      if (res.status === "error") { root.weatherFailed(); return }
      if (res.status === "not_found" && geoProc.lang + 1 < geoProc.langs.length) { geoProc.lang++; Qt.callLater(root.geocodeNext); return }
      if (res.status === "not_found") {
        root.missingCity = root.saved.weatherCity
        root.weatherStatus = "not_found"
        root.notify("Couldn't find " + root.saved.weatherCity, "Try a bigger city nearby, or `flurry location <lat> <lon>`.")
        return
      }
      var g = res.location
      root.weatherFailures = 0
      root.weatherStatus = "ok"
      root.update(function(s) { s.weatherLat = g.lat; s.weatherLon = g.lon; s.weatherPlace = g.name })
      weatherSoon.restart()
    }
  }
  Process {
    id: weatherProc
    property var collector: Policy.newCollector(Weather.MAX_RESPONSE_BYTES)
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        if (!Policy.collectChunk(weatherProc.collector, chunk)) {
          console.warn("flurry: Open-Meteo forecast response exceeded " + Weather.MAX_RESPONSE_BYTES + " bytes; aborting")
          weatherProc.running = false
        }
      }
    }
    stderr: SplitParser { splitMarker: ""; onRead: function() {} }
    onExited: function(code) {
      var c = weatherProc.collector
      weatherProc.collector = Policy.newCollector(Weather.MAX_RESPONSE_BYTES)
      if (code !== 0 || c.overflowed) { root.weatherFailed(); return }
      var cur = Weather.parseCurrent(c.buf)
      if (!cur) { root.weatherFailed(); return }
      root.weatherFailures = 0
      root.weatherStatus = "ok"
      weatherTimer.interval = Weather.REFRESH_MS
      if (root.weatherWanted) weatherTimer.restart()
      root.update(function(s) { s.weatherCache = { at: Date.now(), current: cur } })
    }
  }
  Timer {
    id: weatherTimer
    interval: Weather.REFRESH_MS
    repeat: true
    running: root.weatherWanted
    onTriggered: root.fetchWeather()
  }
  Timer { id: weatherSoon; interval: 1500; onTriggered: root.fetchWeather() }
  onWeatherWantedChanged: if (weatherWanted) weatherSoon.restart()

  // ---------------------------------------------------------- theme colours
  //
  // The Omarchy theme's palette, read from its colors.toml. Omarchy pushes a
  // theme switch to the shell, which changes qs.Commons.Color, so a change
  // there re-reads the file; the file watch catches anything else.

  property var theme: null
  readonly property string themePath: Quickshell.env("HOME") + "/.local/state/omarchy/current/theme/colors.toml"
  function applyTheme(text) {
    var next = root.saved.themeSync ? Theme.derive(text === null ? Theme.fallback() : Theme.parse(text)) : null
    if (Theme.same(next, root.theme) || (!next && !root.theme)) return
    Draw.setTheme(next)
    root.theme = next
  }
  FileView {
    id: themeFile
    path: root.themePath
    printErrors: false
    watchChanges: true
    onFileChanged: reload()
    onLoaded: root.applyTheme(text())
    onLoadFailed: root.applyTheme(null)
  }
  Connections {
    target: Commons.Color
    function onAccentChanged() { themeFile.reload() }
    function onBackgroundChanged() { themeFile.reload() }
  }
  readonly property bool themeOn: saved.themeSync
  onThemeOnChanged: themeFile.reload()

  // ---------------------------------------------------------- power
  //
  // /sys/class/power_supply: a fallback for machines where UPower has no
  // battery to report. Read once a minute only while Flurry runs and only
  // where it found a battery (a desktop is read once and left alone).
  Process {
    id: powerProc
    property var collector: Policy.newCollector(16384)
    command: ["sh", "-c", "for d in /sys/class/power_supply/*; do [ -e \"$d/type\" ] || continue; "
                        + "printf '%s|%s|%s|%s|%s\\n' \"${d##*/}\" \"$(cat \"$d/type\" 2>/dev/null)\" \"$(cat \"$d/status\" 2>/dev/null)\" "
                        + "\"$(cat \"$d/capacity\" 2>/dev/null)\" \"$(cat \"$d/online\" 2>/dev/null)\"; done"]
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        if (!Policy.collectChunk(powerProc.collector, chunk)) powerProc.running = false
      }
    }
    onExited: function(code) {
      var c = powerProc.collector
      powerProc.collector = Policy.newCollector(16384)
      if (code === 0 && !c.overflowed) root.sysPower = Policy.parsePowerSupply(c.buf)
    }
  }
  Timer {
    interval: 60000
    repeat: true
    running: root.active && !root.upowerBattery && (!root.sysPower.known || root.sysPower.battery)
    triggeredOnStart: true
    onTriggered: if (!powerProc.running) { powerProc.collector = Policy.newCollector(16384); powerProc.running = true }
  }

  // ---------------------------------------------------------- calm
  property bool calmActive: false
  Timer {
    id: calmCheck
    interval: 30000
    repeat: true
    // "off" never turns calm on, and while Flurry is off there is nothing
    // to calm: no timer then.
    running: root.active && root.saved.calm !== "off"
    triggeredOnStart: true
    onTriggered: root.calmActive = Policy.calmNow(root.saved.calm, root.saved.workHours, new Date())
    onRunningChanged: if (!running) root.calmActive = Policy.calmNow(root.saved.calm, root.saved.workHours, new Date())
  }

  // ---------------------------------------------------------- the snow globe
  function shakeAll() {
    if (!root.saved.shake || !root.active) return false
    var any = false
    for (var k in root.scenes) if (root.scenes[k].shake()) any = true
    return any
  }

  // ---------------------------------------------------------- New Year
  //
  // Asleep until a little before midnight on December 31st; then ten
  // seconds of countdown, and fireworks on every screen.

  property string newYearPhase: ""
  property int lastTick: -1
  function previewFireworks(seconds) {
    if (!root.active) return false
    var any = false
    for (var k in root.scenes) if (root.scenes[k].startFireworks(seconds)) any = true
    return any
  }
  Timer {
    id: newYearTimer
    running: root.active && root.saved.newYear
    repeat: true
    interval: 1000
    triggeredOnStart: true
    onTriggered: {
      var now = new Date()
      var ny = Season.newYear(now)
      if (ny.phase === "countdown" && root.gate.fireworks) {
        var n = Math.ceil(ny.seconds)
        if (n !== root.lastTick) { root.lastTick = n; for (var k in root.scenes) root.scenes[k].countdownTick(n) }
      } else if (ny.phase === "show" && root.newYearPhase !== "show" && root.gate.fireworks) {
        root.previewFireworks(Season.NEW_YEAR.show - ny.seconds)
      }
      root.newYearPhase = ny.phase
      interval = Season.msUntilNewYearWatch(now)
    }
  }

  // ---------------------------------------------------------- surprises
  //
  // Now and then a robin, a winter hare or (rarely) the golden snowflake,
  // chosen in Policy: each only where it makes sense (the hare only in
  // snow, the robin not in a blizzard...), never the same visitor twice
  // running, and never while calm mode is on, a fullscreen app is up, a
  // window is being dragged or Flurry is being decorated. The scheduler
  // runs whenever Flurry does; when nothing can come it looks again in
  // fifteen seconds instead of waiting out the interval, and it keeps why
  // for `flurry diag`.

  property var surpriseHistory: []
  property real surpriseNextAt: 0
  property var surpriseLast: null          // { at, kind, result, why, manual }
  property var serviceFaults: ({})
  function noteFault(name, e) {
    if (root.serviceFaults[name]) return
    var next = Object.assign({}, root.serviceFaults)
    next[name] = { message: String(e && e.message ? e.message : e), at: new Date().toISOString() }
    root.serviceFaults = next
    console.warn("flurry: " + name + " failed: " + next[name].message)
  }

  readonly property string weatherKind: root.weatherNow && root.weatherNow.kind ? root.weatherNow.kind : ""
  readonly property string sceneMode: Policy.sceneMode(root.saved.effect, root.env, root.weatherKind)

  function surpriseContextOf(scene) {
    var c = scene ? scene.surpriseContext() : { offline: "no screen" }
    c.mode = root.sceneMode
    c.surprises = root.saved.surprises
    c.calm = root.calmActive
    c.lowPower = root.gate.quality < 0.5
    c.decorating = root.decorating !== ""
    return c
  }

  // The schedule is kept as a time (surpriseNextAt), checked every few
  // seconds while Flurry shows, rather than as a one-shot Timer restarted
  // from its own onTriggered: that timer started again from zero whenever
  // the scenes hid and showed (a fullscreen app, a visitor's errand, the
  // panel's switches), and a restart() made inside onTriggered could be
  // undone by Qt finishing the one-shot run, so on a busy desktop the
  // robin and the hare could wait forever. Now the time only moves when a
  // visit comes, misses (looked at again in 15 s) or the scenes first show.
  Timer {
    id: surpriseTimer
    running: root.showing && root.saved.surprises
    repeat: true
    interval: Policy.SURPRISE.check
    onRunningChanged: {
      if (!running) return
      var now = Date.now()
      // Back after a long time away (or the first time): the first visit
      // comes within a minute or two, as when Flurry starts.
      if (root.surpriseNextAt <= 0 || root.surpriseNextAt - now > Policy.SURPRISE.minGap + Policy.SURPRISE.spread
          || now - root.surpriseNextAt > 10 * 60000)
        root.surpriseNextAt = now + Policy.planSurprise(root.surpriseHistory, now, {}, Math.random, { first: true }).delay
    }
    onTriggered: {
      var now = Date.now()
      if (now < root.surpriseNextAt) return
      var came = false
      try { came = root.surpriseAttempt("", false).came } catch (e) { root.noteFault("surprise scheduler", e) }
      root.surpriseMisses = came ? 0 : root.surpriseMisses + 1
      root.surpriseNextAt = now + Policy.planSurprise(root.surpriseHistory, now, {}, Math.random, { missed: !came }).delay
    }
  }
  property int surpriseMisses: 0

  // One try: picks what may come (or takes `kind`), checks it may, and
  // sends it. A manual call (`flurry surprise rabbit`) skips the timing and
  // the surprises switch but not the sense: no hare in the rain.
  function surpriseAttempt(kind, manual) {
    var scene = liveScene()
    var res = { at: new Date().toISOString(), kind: "", came: false, why: "", manual: !!manual }
    if (!scene || !root.active) { res.why = "no screen"; root.surpriseLast = res; return res }
    var ctx = surpriseContextOf(scene)
    if (ctx.offline) { res.why = ctx.offline; root.surpriseLast = res; return res }
    if (manual) { ctx.surprises = true; ctx.dragging = false; ctx.calm = false; ctx.decorating = false; ctx.lowPower = false }
    kind = Policy.surpriseAlias(kind)
    if (kind) {
      // Named: it comes now, bypassing the timer, the weather and the
      // season; what would normally keep it away is said as a warning.
      res.kind = kind
      res.warning = Policy.surpriseBlock(kind, ctx)
    } else {
      kind = Policy.pickSurprise(root.surpriseHistory, Date.now(), ctx)
      res.kind = kind
      if (!kind) {
        var opt = Policy.surpriseOptions(root.surpriseHistory, Date.now(), ctx)
        res.why = "bird: " + (opt.bird || "ok") + "; rabbit: " + (opt.rabbit || "ok")
      }
    }
    if (kind && !res.why) {
      if (scene.surprise(kind, !!manual)) {
        res.came = true
        root.surpriseHistory = Policy.remember(root.surpriseHistory, kind, Date.now())
      } else res.why = kind === "bird" ? "a bird is already here, or nowhere to land" : (kind === "rabbit" ? "a hare is already here" : "already falling")
    }
    root.surpriseLast = res
    return res
  }
  function surpriseNow(kind) {
    var known = ["", "bird", "rabbit", "golden"]
    if (known.indexOf(Policy.surpriseAlias(kind)) < 0) return "surprise: bird, rabbit or golden"
    var r = surpriseAttempt(kind, true)
    if (r.came) return r.kind + (r.warning ? " (forced; normally not now: " + r.warning + ")" : "")
    return (r.kind ? r.kind + ": " : "") + (r.why || "nothing can come now")
  }

  // For the panel: is a visitor here now, and if not, why it can't come
  // (the same answer `flurry diag` gives). { here, why }: why is "" when
  // it can come.
  function visitorStatus(kind) {
    kind = Policy.surpriseAlias(kind)
    var scene = focusedScene()
    if (!scene || !root.active) return { here: false, why: "Flurry is off" }
    try {
      var ctx = surpriseContextOf(scene)
      if (ctx.offline) return { here: false, why: ctx.offline }
      return { here: !!ctx[kind], why: Policy.surpriseBlock(kind, ctx) }
    } catch (e) {
      root.noteFault("visitor status", e)
      return { here: false, why: "" }
    }
  }

  // `flurry freeze`: the windows in view freeze now, whatever the weather.
  function freezeNow() {
    var scene = focusedScene()
    if (!scene || !root.active) return "no screen"
    var n = scene.freeze()
    if (n < 0) return "not showing now (Flurry off or a fullscreen app)"
    return n + " icicles" + (root.saved.dayCycle ? "" : " (Melting, icicles, night glaze is off: they will not grow back)")
            + (root.saved.effect === "snow" ? "" : " (not snowing: they will melt)")
  }

  // Calm mode on, or surprises off: the robin and the hare leave now.
  function dismissCritters() { for (var k in root.scenes) root.scenes[k].dismissCritters() }
  // (calm mode coming on also sends the visitors away: see onCalmActiveChanged above)

  // `flurry diag`: the state of each feature and why it is (or isn't) on.
  function diag() {
    var scene = focusedScene()
    var faults = {}
    for (var k in root.serviceFaults) faults["service:" + k] = root.serviceFaults[k]
    var sf = scene ? scene.faults() : {}
    for (var j in sf) faults[j] = sf[j]
    return JSON.stringify(Policy.diagReport({
      now: Date.now(), mode: root.sceneMode, env: root.env, history: root.surpriseHistory, last: root.surpriseLast,
      weather: { live: root.saved.liveWeather, kind: root.weatherKind },
      gates: { enabled: root.saved.enabled, effect: root.saved.effect, surprises: root.saved.surprises, calm: root.calmActive,
               calmMode: root.saved.calm, decorating: root.decorating, onBattery: root.onBattery, quality: root.quality,
               dayCycle: root.saved.dayCycle, plow: root.saved.plow, fullscreen: scene ? scene.fullscreenApp : false },
      timer: { running: surpriseTimer.running, nextAt: root.surpriseNextAt, misses: root.surpriseMisses },
      ctx: surpriseContextOf(scene), faults: faults
    }), null, 1)
  }

  // ---------------------------------------------------------- snowballs to friends
  //
  // A snowball thrown off the side of the screen goes to a friend (the one
  // picked with `flurry throwto`, else the first) over the gift inbox, at
  // most one every second and a half; theirs come in the same way.

  readonly property var throwFriend: Store.throwTarget(saved)
  readonly property bool throwOn: saved.throwToFriends && !!saved.identity && !!throwFriend
  property real lastThrow: 0
  property real lastCatch: 0
  function setThrowTarget(name) {
    var n = String(name || "").toLowerCase()
    for (var i = 0; i < root.saved.friends.length; i++) {
      var f = root.saved.friends[i]
      if (f.name.toLowerCase() === n || f.id === name) {
        update(function(s) { s.throwTo = f.id; s.throwToFriends = true })
        return "snowballs go to " + f.name
      }
    }
    return "no friend called " + name
  }
  function throwSnowball(ev) {
    var friend = root.throwFriend
    if (!root.throwOn || !friend || Date.now() - root.lastThrow < 1500) return false
    root.lastThrow = Date.now()
    root.post(friend.id, Store.giftMessage(root.saved.identity, "snowball", ev))
    return true
  }
  function catchSnowball(gift) {
    if (!root.active || root.saved.effect !== "snow" || Date.now() - root.lastCatch < 1500) return
    root.lastCatch = Date.now()
    var scene = focusedScene()
    if (scene) scene.incomingSnowball(gift.art)
  }

  // What a scene's simulation reported this frame.
  function sceneEvent(scene, ev) {
    root.playCue(ev)
    if (ev.type === "throw") throwSnowball(ev)
    else if (ev.type === "golden") unlockOrnament()
  }


  // ---------------------------------------------------------- sound
  //
  // Each effect's own sounds (Sound.qml, lib/sound.js): its bed while a
  // scene shows it, and a sound the moment the scene does something (the
  // thunder plays in the frame its bolt flashes). Off in the panel, in calm
  // mode, and while a fullscreen app covers every screen.
  property bool anyLive: false
  Timer {
    interval: 400
    repeat: true
    running: root.showing && root.saved.sound
    triggeredOnStart: true
    onTriggered: {
      var live = false, wet = 0
      for (var k in root.scenes) {
        var sc = root.scenes[k]
        if (!sc || !sc.live) continue
        live = true
        if (sc.world) wet = Math.max(wet, sc.world.wet || 0)
      }
      root.anyLive = live
      root.stormWet = wet
    }
    onRunningChanged: if (!running) root.anyLive = false
  }
  // Calm mode plays everything at half its level.
  readonly property bool soundOn: root.loaded && !!root.saved.sound && root.showing && root.anyLive
  property var soundState: Snd.newState()
  property real stormWet: 0.5
  Loader {
    id: soundLoader
    active: root.loaded && !!root.saved.sound
    source: "Sound.qml"
    onStatusChanged: if (status === Loader.Error) console.warn("flurry: Qt Multimedia (qt6-multimedia) is not available; sounds go through pw-play/paplay instead")
  }
  // Qt Multimedia when it loads and its player works; otherwise PipeWire's
  // or PulseAudio's command-line player, for the bed as well as the cues.
  readonly property bool qtSound: soundLoader.status === Loader.Ready && !!soundLoader.item && !soundLoader.item.broken
  readonly property string soundBackend: !root.saved.sound ? "off" : (root.qtSound ? "qt" : "cli")
  onSoundBackendChanged: console.info("flurry: sound backend " + root.soundBackend
                                      + (soundLoader.item && soundLoader.item.problem ? " (" + soundLoader.item.problem + ")" : ""))
  readonly property real soundVolume: root.saved.soundVolume === undefined ? 0.8 : root.saved.soundVolume
  readonly property string bedNow: root.soundOn ? Snd.bedFor(root.effect, true) : ""
  readonly property real bedLevelNow: Snd.bedLevel(root.effect, root.intensity, root.stormWet) * (root.calmActive ? 0.5 : 1)
  Binding { target: soundLoader.item; property: "bed"; value: root.qtSound ? root.bedNow : ""; when: soundLoader.status === Loader.Ready }
  Binding { target: soundLoader.item; property: "bedLevel"; value: root.bedLevelNow; when: soundLoader.status === Loader.Ready }
  Binding { target: soundLoader.item; property: "volume"; value: root.soundVolume; when: soundLoader.status === Loader.Ready }
  readonly property string soundDir: decodeURIComponent(String(Qt.resolvedUrl("sounds/")).replace(/^file:\/\//, ""))

  // The bed through the command-line player: the file over and over, at the
  // bed's level (rounded, so a slowly changing level doesn't restart it).
  readonly property string cliBed: root.soundBackend === "cli" && root.bedNow !== "" ? root.bedNow : ""
  readonly property real cliBedVolume: Math.round(root.bedLevelNow * root.soundVolume * 20) / 20
  // Same as the Qt player: takes in a random order (never the same one
  // twice running), each started BED_OVERLAP seconds before the last ends.
  Process {
    id: cliBedPlayer
    property bool pendingRestart: false
    command: ["sh", "-c",
      "dir=$1; vol=$2; pvol=$3; len=$4; shift 4; TAKES=$*; last=; kids=; "
      + "trap 'kill $kids $s 2>/dev/null; exit 0' TERM INT; "
      + "if command -v pw-play >/dev/null 2>&1; then play() { pw-play --volume=\"$vol\" \"$1\"; }; "
      + "elif command -v paplay >/dev/null 2>&1; then play() { paplay --volume=\"$pvol\" \"$1\"; }; else exit 1; fi; "
      + "while :; do "
      + "  set -- $(for f in $TAKES; do [ \"$f\" != \"$last\" ] && echo $f; done | shuf); last=$1; "
      + "  play \"$dir/$1.wav\" & kids=\"$kids $!\"; sleep \"$len\" & s=$!; wait $s; "
      + "  kids=$(for k in $kids; do kill -0 $k 2>/dev/null && echo $k; done); "
      + "done",
      "flurry-bed", root.soundDir.replace(/\/$/, ""), root.cliBedVolume.toFixed(2), String(Math.round(root.cliBedVolume * 65536)),
      String(Snd.BED_SECONDS - Snd.BED_OVERLAP)].concat(Snd.bedTakes(root.cliBed))
    running: false
    onRunningChanged: root.cliBedStartedAt = running ? root.cliBedVolume : -1
    onExited: {
      if (cliBedPlayer.pendingRestart) {
        cliBedPlayer.pendingRestart = false
        if (root.cliBed !== "" && root.cliBedVolume > 0) cliBedPlayer.running = true
      }
    }
  }
  function restartCliBed() {
    var want = root.cliBed !== "" && root.cliBedVolume > 0
    if (cliBedPlayer.running) {
      cliBedPlayer.pendingRestart = want
      cliBedPlayer.running = false
    } else if (want) {
      cliBedPlayer.pendingRestart = false
      cliBedPlayer.running = true
    }
  }
  onCliBedChanged: restartCliBed()
  // A level that drifts (the storm's wetness eases in over half a minute)
  // restarted the player, cutting the bed off mid-take, at every 0.05 step.
  // Only a real change of level does now.
  property real cliBedStartedAt: -1
  onCliBedVolumeChanged: if (root.cliBed !== "") cliBedTweak.restart()
  Timer {
    id: cliBedTweak
    interval: 600
    onTriggered: {
      var was = root.cliBedStartedAt, now = root.cliBedVolume
      if (cliBedPlayer.running && was > 0 && now > 0 && Math.abs(now - was) < 0.15) return
      root.restartCliBed()
    }
  }

  function playCue(ev) {
    if (!root.soundOn) return
    var cue = Snd.cueFor(root.soundState, ev, Date.now() / 1000)
    if (cue) root.playSound(cue.name, cue.volume * (root.calmActive ? 0.5 : 1))
  }
  function playSound(name, volume) {
    if (root.qtSound) { soundLoader.item.play({ name: name, volume: volume }); return }
    var vol = Math.max(0, Math.min(1, volume * root.soundVolume))
    if (vol <= 0) return
    Quickshell.execDetached(["sh", "-c",
      "if command -v pw-play >/dev/null 2>&1; then exec pw-play --volume=\"$2\" \"$1\"; "
      + "elif command -v paplay >/dev/null 2>&1; then exec paplay --volume=\"$3\" \"$1\"; fi",
      "flurry-sound", root.soundDir + name + ".wav", vol.toFixed(3), String(Math.round(vol * 65536))])
  }
  // `flurry sound [on|off|test|status]`. test plays a close thunder now,
  // whatever the scene is doing; status says why it is quiet, if it is.
  function soundCommand(mode) {
    if (mode === "on" || mode === "off") { setSound(mode === "on"); return mode }
    if (mode === "test") {
      if (!root.saved.sound) return "sound is off in the panel (flurry sound on)"
      root.playSound("thunder-near-1", 1)
      return "thunder (" + root.soundBackend + ")"
    }
    var why = []
    if (!root.saved.sound) why.push("off in the panel")
    if (!root.showing) why.push("Flurry is not showing")
    if (root.showing && !root.anyLive) why.push("a fullscreen app covers every screen")
    if (root.calmActive) why.push("calm mode: everything at half level (flurry calm off)")
    return JSON.stringify({ backend: root.soundBackend, qtMultimedia: soundLoader.status === Loader.Ready,
                            problem: soundLoader.item ? soundLoader.item.problem : (soundLoader.status === Loader.Error ? "Qt Multimedia missing" : ""),
                            playing: root.soundOn, bed: root.bedNow,
                            player: root.qtSound ? soundLoader.item.describe() : (cliBedPlayer.running ? "pw-play loop" : "stopped"), volume: root.soundVolume, quietBecause: why,
                            files: root.soundDir })
  }

  // ---------------------------------------------------------- misc

  function notify(title, body) {
    // Omarchy's own notifications where they are; notify-send elsewhere.
    Quickshell.execDetached(["sh", "-c",
      "if command -v omarchy-notification-send >/dev/null 2>&1; then exec omarchy-notification-send --app-name Flurry -g \"$3\" \"$1\" \"$2\"; "
      + "else exec notify-send -a Flurry -i weather-snow -- \"$1\" \"$2\"; fi",
      "flurry-notify", String(title), String(body || ""), String.fromCodePoint(0xF0717)])
  }

  function status() {
    var scene = focusedScene()
    return JSON.stringify({
      enabled: root.saved.enabled, effect: root.saved.effect, intensity: root.saved.intensity,
      quality: root.quality, trees: root.saved.trees.length, snowmen: root.saved.snowmen.length,
      gifts: root.saved.gifts.length, friends: root.saved.friends.length,
      friendCode: root.friendCode, scene: scene ? scene.stats() : null,
      season: root.env.season, spring: root.env.spring, tempC: root.env.tempC, liveWeather: root.saved.liveWeather,
      weather: root.saved.weatherCache ? { place: root.saved.weatherPlace, at: new Date(root.saved.weatherCache.at).toISOString(),
                                           current: root.saved.weatherCache.current } : null,
      calm: root.calmActive, onBattery: root.onBattery, battery: root.batteryPercent, fps: root.fpsCap,
      theme: root.theme ? root.theme.source : "off", ornamentStyle: root.saved.ornamentStyle,
      ornamentStyles: root.saved.ornamentStyles, preview: root.seasonOverride,
      windows: { live: root.liveWindows ? Object.keys(root.liveWindows).length : -1, closed: Object.keys(root.closedWindows).length }
    })
  }

  ShellIpc {
    target: "flurry"

    function toggle(): string { root.toggle(); return root.saved.enabled ? "on" : "off" }
    function on(): string { root.setEnabled(true); return "on" }
    function off(): string { root.setEnabled(false); return "off" }
    function effect(name: string): string { return root.setEffect(name) ? name : "unknown effect: " + name }
    function next(): string { root.nextEffect(1); return root.saved.effect }
    function intensity(value: string): string { root.setIntensity(Number(value)); return String(root.saved.intensity) }
    function decorate(): string { root.decorating ? root.stopDecorating() : root.startDecorating(); return root.decorating ? "decorating" : "done" }
    function santa(): string { return root.summonSanta() ? "ho ho ho" : "no screen" }
    function lights(): string { return root.focusedLights() }
    function plow(mode: string): string { return root.plowCommand(mode) }
    function snowballs(): string { root.setSnowballs(!root.saved.snowballs); return root.saved.snowballs ? "on" : "off" }
    function yeti(): string { return root.summonYeti() ? "grr" : "no screen" }
    function clear(): string { root.clearDecorations(); return "ok" }
    function friendCode(): string { if (!root.friendCode) root.setupFriends(""); return root.friendCode || "creating, ask again" }
    function setName(name: string): string { root.setupFriends(name); return "ok" }
    function addFriend(code: string): string { return root.addFriend(code) ? "ok" : "invalid code" }
    function note(friend: string, text: string): string {
      var match = null
      for (var i = 0; i < root.saved.friends.length; i++) {
        var f = root.saved.friends[i]
        if (f.name.toLowerCase() === String(friend).toLowerCase() || f.id === friend) match = f
      }
      if (!match) return "no friend called " + friend
      return root.sendNote(match.id, text) ? "sent" : "not sent"
    }
    function status(): string { return root.status() }
    function shake(): string { return root.shakeAll() ? "whoosh" : "off" }
    function fireworks(seconds: string): string {
      var n = seconds === "" ? 60 : Number(seconds)
      if (!isFinite(n) || n <= 0) return "fireworks: seconds must be positive"
      return root.previewFireworks(n) ? "bang" : "off"
    }
    function season(name: string): string { return root.previewSeason(name) }
    function weather(mode: string): string { return root.weatherCommand(mode) }
    function city(name: string): string { root.setWeatherCity(name); return "looking up " + name }
    function location(lat: string, lon: string): string { return root.setWeatherLocation(lat, lon) ? "ok" : "invalid coordinates" }
    function calm(mode: string): string { return root.setCalm(mode) ? root.saved.calm : "calm: off, on or work" }
    function surprise(kind: string): string { return root.surpriseNow(kind) }
    function diag(): string { return root.diag() }
    function sound(mode: string): string { return root.soundCommand(mode) }
    function freeze(): string { return root.freezeNow() }
    function ornaments(style: string): string {
      if (style === "" || style === "next") return root.nextOrnamentStyle()
      return root.setOrnamentStyle(style) ? style : "locked (catch a golden snowflake): " + style
    }
    function throwTo(friend: string): string { return root.setThrowTarget(friend) }
    function toggleFlag(name: string): string { return root.flagNames.indexOf(name) < 0 ? "unknown: " + name : root.toggleFlag(name) }
  }

  // ---------------------------------------------------------- scenes

  Variants {
    model: Quickshell.screens
    delegate: Component {
      SceneWindow {
        required property var modelData
        screen: modelData
        service: root
      }
    }
  }
}
