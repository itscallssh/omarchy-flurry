import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import "lib/wallpaper.js" as Wallpaper
import "lib/policy.js" as Policy

// One screen's weather wallpaper (opt-in: the panel's "Weather wallpaper",
// `flurry wallpaper on|off`). A painting that matches the scene mode, on a
// layer under every window. When the weather changes it crossfades to the
// next painting slowly, like light at dusk; when the feature is turned off
// it fades away and the user's own Omarchy wallpaper, which was never
// touched, is there underneath.
//
// It repaints only while a fade runs: the one NumberAnimation below is the
// only thing that ever changes, it is started for a fade and stops at its
// end. Between fades the surface is static and costs nothing.
PanelWindow {
  id: wallWin

  property var service: null

  readonly property var monitor: Hyprland.monitorFor(screen)
  readonly property var workspace: monitor ? monitor.activeWorkspace : null
  readonly property real scale: screen && screen.devicePixelRatio > 0 ? screen.devicePixelRatio : 1
  readonly property var decode: Wallpaper.coverSize(screen ? screen.width : 1920, screen ? screen.height : 1080, scale)
  readonly property bool wanted: !!service && service.wallpaperOn
  readonly property string wantedImage: wanted ? service.wallpaperImage : ""
  // A fullscreen app hides the wallpaper anyway: no fade there, the change
  // is made at once and nothing repaints behind the app.
  readonly property bool fullscreenHere: !!workspace && fullscreenOn()
  readonly property bool animate: !!service && service.wallpaperAnimate && !fullscreenHere && Style.duration(1000) > 0

  property var fade: Wallpaper.initial()
  // The two paintings: the one in front fades in over the one behind.
  property bool frontIsA: true
  readonly property Image front: frontIsA ? imgA : imgB
  readonly property Image back: frontIsA ? imgB : imgA
  // 0..1 through the running fade (linear in time; eased where it is read).
  property real progress: 1
  property string fadingTo: ""

  color: "transparent"
  visible: wanted || fade.shown !== "" || Wallpaper.busy(fade)
  exclusionMode: ExclusionMode.Ignore
  anchors { top: true; bottom: true; left: true; right: true }
  WlrLayershell.namespace: "flurry-wallpaper"
  // Bottom, not Background: the user's own wallpaper (swaybg, or the
  // shell's) lives on Background and is restarted on every theme or
  // wallpaper change, which would put it back on top of a Background
  // surface of ours. Bottom is still under every window and every panel.
  WlrLayershell.layer: WlrLayer.Bottom
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
  mask: Region {}

  function fullscreenOn() {
    var mon = monitor && monitor.lastIpcObject ? monitor.lastIpcObject : null
    var special = mon && mon.specialWorkspace && mon.specialWorkspace.id ? Number(mon.specialWorkspace.id) : 0
    var all = Hyprland.toplevels.values, items = []
    for (var i = 0; i < all.length; i++) items.push(all[i].lastIpcObject)
    return Policy.fullscreenOn(items, workspace ? Number(workspace.id) : NaN, special)
  }

  onWantedImageChanged: Qt.callLater(apply)
  // A fullscreen app came up mid-fade: finish it now rather than paint
  // frames nobody can see.
  onFullscreenHereChanged: if (fullscreenHere && fadingTo !== "") { fader.stop(); progress = 1; done() }
  Component.onCompleted: apply()

  function apply() {
    var r = Wallpaper.want(fade, wantedImage, animate)
    fade = r.state
    if (r.jump) jumpTo(r.state.shown)
    else if (r.start !== "") begin(r.start)
  }

  // At once: a fullscreen app is up, Flurry is hidden, or animations are off.
  function jumpTo(name) {
    fader.stop()
    fadingTo = ""
    front.source = name ? Qt.resolvedUrl(Wallpaper.fileOf(name)) : ""
    front.opacity = 1
    back.source = ""
    back.opacity = 0
    progress = 1
    stage.opacity = 1
  }

  // Start a fade to `to` (a painting, or "-" to fade out). A painting fades
  // in once it has loaded; until then nothing changes on screen.
  function begin(to) {
    fadingTo = to
    if (to === "-") { progress = 0; fader.restart(); return }
    frontIsA = !frontIsA          // the one showing now goes behind
    front.opacity = 0
    progress = 0
    stage.opacity = 1
    front.source = Qt.resolvedUrl(Wallpaper.fileOf(to))
    if (front.status === Image.Ready || front.status === Image.Error) fader.restart()
  }

  function done() {
    if (fadingTo === "-") {
      front.source = ""; back.source = ""
      front.opacity = 0; back.opacity = 0
    } else {
      front.opacity = 1
      back.source = ""          // the old painting is let go: one in memory between fades
      back.opacity = 0
    }
    fadingTo = ""
    var r = Wallpaper.finished(fade)
    fade = r.state
    if (r.start !== "") {
      if (animate) begin(r.start)
      else { fade = { shown: r.start === "-" ? "" : r.start, target: "", pending: "" }; jumpTo(fade.shown) }
    }
  }

  onProgressChanged: {
    if (fadingTo === "") return
    var e = Wallpaper.ease(progress)
    if (fadingTo === "-") stage.opacity = 1 - e
    else front.opacity = e
  }

  NumberAnimation {
    id: fader
    target: wallWin
    property: "progress"
    from: 0
    to: 1
    duration: Style.duration(wallWin.service ? wallWin.service.wallpaperFadeMs : 10000)
    easing.type: Easing.Linear
    onFinished: wallWin.done()
  }

  Item {
    id: stage
    anchors.fill: parent

    Image {
      id: imgA
      anchors.fill: parent
      z: wallWin.frontIsA ? 1 : 0
      opacity: 0
      asynchronous: true
      cache: false
      smooth: true
      mipmap: false
      fillMode: Image.PreserveAspectCrop
      // Cropped from the top on a wide screen: the flat ground the snow
      // and the plow sit on stays at the bottom edge.
      verticalAlignment: Image.AlignBottom
      sourceSize.width: wallWin.decode.width
      sourceSize.height: wallWin.decode.height
      onStatusChanged: if ((status === Image.Ready || status === Image.Error) && wallWin.front === imgA && wallWin.fadingTo !== "" && wallWin.fadingTo !== "-" && !fader.running) fader.restart()
    }
    Image {
      id: imgB
      anchors.fill: parent
      z: wallWin.frontIsA ? 0 : 1
      opacity: 0
      asynchronous: true
      cache: false
      smooth: true
      mipmap: false
      fillMode: Image.PreserveAspectCrop
      verticalAlignment: Image.AlignBottom
      sourceSize.width: wallWin.decode.width
      sourceSize.height: wallWin.decode.height
      onStatusChanged: if ((status === Image.Ready || status === Image.Error) && wallWin.front === imgB && wallWin.fadingTo !== "" && wallWin.fadingTo !== "-" && !fader.running) fader.restart()
    }
    // The light shifting over the fade: faintly warm, then faintly cool.
    Rectangle {
      anchors.fill: parent
      z: 2
      visible: wallWin.fadingTo !== "" && wallWin.fadingTo !== "-"
      color: Wallpaper.tint(wallWin.progress).color
      opacity: Wallpaper.tint(wallWin.progress).alpha
    }
  }
}
