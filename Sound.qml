pragma ComponentBehavior: Bound
import QtQuick
import QtQml
import QtMultimedia
import "lib/sound.js" as Snd

// Flurry's sounds (sounds/*.wav, made by tools/make-sounds.py): one ambient
// bed per effect, crossfaded when the effect changes, and the short sounds
// the scene plays the moment something happens (lib/sound.js decides which
// and how loud). Loaded by Service.qml through a Loader, so a system
// without Qt Multimedia only goes quiet (Service then falls back to
// pw-play/paplay for the short sounds).
Item {
  id: root
  // Set by Service.
  property string bed: ""          // the effect whose bed plays, "" for none
  property real bedLevel: 0        // 0..1, before the master volume
  property real volume: 0.8        // master, 0..1

  readonly property url dir: Qt.resolvedUrl("sounds/")
  // Set when Qt Multimedia loads but can't play (no audio backend, a file
  // it can't read): Service then uses the command-line player instead.
  property bool broken: false
  property string problem: ""
  function fail(what) {
    if (broken) return
    problem = what
    broken = true
    console.warn("flurry: Qt Multimedia can't play " + what + "; falling back to pw-play/paplay")
  }

  // ------------------------------------------------------------ beds
  // Each effect has three takes, faded in and out at their ends. A take
  // plays once; BED_OVERLAP seconds before it ends the next one (any but
  // this one) starts on another player, so they overlap through the fades
  // and the bed never comes round to a point you can hear. A change of
  // effect fades every playing take out and starts the new bed fading in.
  property string current: ""
  property string take: ""           // the take started last
  property int next: 0               // the player the next take goes on
  readonly property var players: [p0, p1, p2]
  onBedChanged: switchBed()
  Component.onCompleted: switchBed()
  function switchBed() {
    if (bed === current) return
    current = bed
    for (var i = 0; i < players.length; i++) if (players[i].playing || players[i].pending) players[i].fadeTo(0, 1800)
    take = ""
    handoff.stop()
    if (bed !== "") startTake(true)
  }
  function startTake(fadeIn) {
    take = Snd.nextTake(current, take)
    if (take === "") return
    // The player that has been quiet longest.
    var p = players[next]
    next = (next + 1) % players.length
    p.stop()
    p.fadeTo(0, 0)
    // A hand-off needs no fade: the takes fade themselves. A new bed does.
    p.fadeTo(1, fadeIn ? 1800 : 0)
    p.source = root.dir + take + ".wav"
    p.begin()
    handoff.interval = Math.max(1000, (Snd.BED_SECONDS - Snd.BED_OVERLAP) * 1000)
    handoff.restart()
  }
  Timer { id: handoff; repeat: false; onTriggered: if (root.current !== "") root.startTake(false) }
  component Bed: SoundEffect {
    id: self
    property real fade: 0
    property real target: 0
    property bool pending: false     // asked to play, file still loading
    loops: 1
    volume: self.fade * root.bedLevel * root.volume
    NumberAnimation {
      id: anim
      target: self
      property: "fade"
      easing.type: Easing.InOutSine
      onFinished: if (self.target === 0) { self.stop(); self.pending = false }
    }
    function fadeTo(v, ms) {
      anim.stop()
      self.target = v
      if (ms <= 0) { self.fade = v; return }
      anim.from = self.fade
      anim.to = v
      anim.duration = ms
      anim.start()
    }
    function begin() {
      if (self.status === SoundEffect.Ready) { self.pending = false; self.play() } else self.pending = true
    }
    onStatusChanged: {
      if (self.status === SoundEffect.Error) { self.pending = false; root.fail(String(self.source)) }
      else if (self.status === SoundEffect.Ready && self.pending && self.target > 0) { self.pending = false; self.play() }
    }
  }
  Bed { id: p0 }
  Bed { id: p1 }
  Bed { id: p2 }

  // For `flurry sound status`.
  function describe() {
    var names = ["null", "loading", "ready", "error"]
    var out = []
    for (var i = 0; i < players.length; i++) {
      var p = players[i]
      if (!p.playing && !p.pending) continue
      out.push({ file: String(p.source).replace(/^.*\//, ""), loaded: names[p.status] || String(p.status), playing: p.playing,
                 gain: Math.round(p.volume * 1000) / 1000 })
    }
    return { bed: current, take: take, players: out }
  }

  // ------------------------------------------------------------ one-shots
  // Every variant preloaded, two voices each so a sound can overlap itself.
  property var voices: ({})
  Instantiator {
    model: Snd.allShots()
    delegate: Item {
      id: voice
      required property string modelData
      property bool flip: false
      SoundEffect { id: va; source: root.dir + voice.modelData + ".wav"; onStatusChanged: if (va.status === SoundEffect.Error) root.fail(String(va.source)) }
      SoundEffect { id: vb; source: root.dir + voice.modelData + ".wav"; onStatusChanged: if (vb.status === SoundEffect.Error) root.fail(String(vb.source)) }
      Component.onCompleted: { var v = root.voices; v[voice.modelData] = voice; root.voices = v }
      function fire(vol) {
        var s = flip ? vb : va
        flip = !flip
        s.volume = Math.max(0, Math.min(1, vol))
        s.play()
      }
    }
  }
  // Play a cue (from Snd.cueFor) now.
  function play(cue) {
    if (!cue) return
    var v = root.voices[cue.name]
    if (v) v.fire(cue.volume * root.volume)
  }
}
