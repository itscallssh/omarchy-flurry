// Each effect's sounds: a bed per effect, a sound with each thing the scene
// does, played in the frame it happens (thunder with its flash), never the
// same variant twice running, and a switch and a volume in the panel.
"use strict"
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")
const load = require("./load")
const S = load("lib/sim.js"), Snd = load("lib/sound.js"), Store = load("lib/store.js")
const root = path.join(__dirname, "..")
const dt = 1 / 60

function readWav(name) {
  const b = fs.readFileSync(path.join(root, "sounds", name + ".wav"))
  assert.strictEqual(b.toString("ascii", 0, 4), "RIFF", name)
  assert.strictEqual(b.toString("ascii", 8, 12), "WAVE", name)
  const ch = b.readUInt16LE(22), rate = b.readUInt32LE(24), bits = b.readUInt16LE(34)
  let off = 12
  while (off < b.length && b.toString("ascii", off, off + 4) !== "data") off += 8 + b.readUInt32LE(off + 4)
  const n = b.readUInt32LE(off + 4) / 2
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(off + 8 + i * 2) / 32767
  return { ch, rate, bits, x }
}
const rms = x => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length)
const peakOf = x => { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m }

test("every effect has its bed, and every cue its sounds, as plain 16-bit mono WAV", () => {
  for (const e of Store.EFFECTS) assert.ok(Snd.EFFECTS.indexOf(e) >= 0, e + " has a bed")
  for (const name of Snd.bedFiles().concat(Snd.allShots())) {
    const w = readWav(name)
    assert.deepStrictEqual([w.ch, w.rate, w.bits], [1, name.startsWith("bed-") ? 24000 : 32000, 16], name)
    assert.ok(rms(w.x) > 0.02, name + " is not silent")
    assert.ok(peakOf(w.x) <= 1, name)
  }
})

test("the beds never sound like a loop: three takes each, overlapped one into another at a steady level", () => {
  for (const e of Snd.EFFECTS) {
    const takes = Snd.bedTakes(e)
    assert.strictEqual(takes.length, 3, e)
    const xs = takes.map(n => readWav(n).x)
    const rate = 24000, n = Math.round(Snd.BED_OVERLAP * rate)
    for (let k = 0; k < xs.length; k++) {
      const x = xs[k]
      assert.ok(Math.abs(x.length / rate - Snd.BED_SECONDS) < 0.01, takes[k] + " is BED_SECONDS long")
      // Faded in and out: silent at both ends, so starting the next take
      // over this one's tail can't click.
      assert.ok(Math.abs(x[0]) < 0.002 && Math.abs(x[x.length - 1]) < 0.002, takes[k] + " starts and ends at silence")
      // Not three copies of one take.
      if (k > 0) assert.ok(Math.abs(rms(x.slice(0, 48000)) - rms(xs[0].slice(0, 48000))) > 1e-4
                           || x[50000] !== xs[0][50000], takes[k] + " differs from take 1")
    }
    // Every join (a into b): across the overlap the level stays inside the
    // range the bed itself moves through (gusts come and go), so nothing
    // dips or bumps where one take hands over to the next.
    const db = v => 20 * Math.log10(v + 1e-9)
    let lo = Infinity, hi = -Infinity
    for (const x of xs) for (let s = n; s + n <= x.length - n; s += n / 5) {
      const l = db(rms(x.slice(s, s + n))); lo = Math.min(lo, l); hi = Math.max(hi, l)
    }
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < xs.length; j++) {
      if (i === j) continue
      const a = xs[i], b = xs[j]
      const tail = a.slice(a.length - n), head = b.slice(0, n)
      const join = db(rms(tail.map((v, q) => v + head[q])))
      assert.ok(join > lo - 1.5 && join < hi + 1.5, `${e} ${i + 1}->${j + 1}: ${join.toFixed(1)} dB at the join, the bed runs ${lo.toFixed(1)}..${hi.toFixed(1)}`)
    }
  }
  // The next take is never the one playing.
  for (let r = 0; r < 1; r += 0.05) {
    for (const cur of Snd.bedTakes("rain")) assert.notStrictEqual(Snd.nextTake("rain", cur, r), cur)
  }
  assert.ok(Snd.bedTakes("rain").indexOf(Snd.nextTake("rain", "", 0.99)) >= 0)
  assert.strictEqual(Snd.nextTake("nothing", "", 0.5), "")
})

test("a close thunder cracks at once (in sync with the flash); a far one rolls in", () => {
  for (const n of Snd.SHOTS.thunderNear) {
    const { x } = readWav(n)
    const peak = peakOf(x)
    const first = peakOf(x.slice(0, 32000 * 0.03))
    assert.ok(first > peak * 0.5, n + ": loud within 30 ms")
  }
  for (const n of Snd.SHOTS.thunderFar) {
    const { x } = readWav(n)
    assert.ok(x.length / 32000 > 4, n + ": a long roll")
  }
})

test("a bolt's thunder is heard in the very step its flash is lit", () => {
  const w = S.createWorld(1920, 1080, { effect: "rain", intensity: 2, plow: false })
  let strikes = 0
  for (let i = 0; i < 60 * 240; i++) {
    const before = w.flash
    S.step(w, dt)
    const ev = S.takeSounds(w).filter(e => e.type === "thunder")
    const struck = w.bolt && w.bolt.age === 0 && w.flash >= 0.79 && w.flash > before
    if (struck) { strikes++; assert.strictEqual(ev.length, 1, "one thunder with the flash, same step") }
    else assert.strictEqual(ev.length, 0, "no thunder without a bolt")
    if (ev.length) assert.ok(ev[0].x >= 0 && ev[0].x <= 1 && typeof ev[0].near === "boolean")
  }
  assert.ok(strikes >= 3, "it stormed: " + strikes)
})

test("the scene says when snow comes off, an icicle snaps, a star falls, fireworks go up and burst", () => {
  const seen = {}
  const note = w => { for (const e of S.takeSounds(w).concat(S.takeEvents(w))) seen[e.type] = (seen[e.type] || 0) + 1 }
  const st = S.createWorld(1920, 1080, { effect: "starfall", intensity: 2, plow: false })
  for (let i = 0; i < 60 * 30; i++) { S.step(st, dt); note(st) }
  const fw = S.createWorld(1920, 1080, { effect: "snow", intensity: 1, plow: false })
  S.startFireworks(fw, 8)
  for (let i = 0; i < 60 * 10; i++) { S.step(fw, dt); note(fw) }
  // A snowy window shaken hard sheds snow and icicles.
  const w = S.createWorld(1920, 1080, { effect: "snow", intensity: 2, plow: false })
  S.setFeatures(w, { icicles: true, border: 2 })
  const r = { id: "0xa", x: 400, y: 300, w: 800, h: 300, floating: true, z: 0 }
  for (let t = 0; t < 4; t += dt) { S.setSurfaces(w, [r], w.time, ["0xa"]); S.step(w, dt) }
  w.surfaces["0xa"].bins.fill(12)
  S.freezeNow(w)
  S.takeEvents(w); S.takeSounds(w)
  for (let i = 0; i < 90; i++) {
    const y = 300 + (i % 10 < 5 ? 1 : -1) * 220 * Math.sin((i % 5) / 5 * Math.PI)
    const p = { x: 600, y: y + 14, vx: 0, vy: (i % 10 < 5 ? 1 : -1) * 4000, present: true, stillFor: 0, age: 0 }
    S.setSurfaces(w, [{ ...r, y: Math.round(y) }], w.time, ["0xa"], { pointer: p, poll: dt, layoutAge: 30 })
    S.step(w, dt, { pointer: p })
    note(w)
  }
  for (const k of ["meteor", "launch", "burst", "shed", "ice"]) assert.ok(seen[k] > 0, k + " heard: " + JSON.stringify(seen))
})

test("cues: the right sound for each event, never the same variant twice running, and not a flood", () => {
  const st = Snd.newState()
  const near = Snd.cueFor(st, { type: "thunder", near: true }, 0, 0)
  assert.ok(/^thunder-near-/.test(near.name) && near.volume === 1)
  assert.strictEqual(Snd.cueFor(st, { type: "thunder", near: false }, 0.5), null, "one thunder at a time")
  const far = Snd.cueFor(st, { type: "thunder", near: false }, 2, 0)
  assert.ok(/^thunder-far-/.test(far.name))
  // Variants: none repeats the one before it.
  let last = ""
  for (let i = 0; i < 40; i++) {
    const c = Snd.cueFor(st, { type: "shed", amount: 4 }, 10 + i, (i * 0.37) % 1)
    assert.notStrictEqual(c.name, last, "the same thud twice running")
    last = c.name
  }
  // A shake's many pieces: one thud a beat.
  const s2 = Snd.newState()
  let n = 0
  for (let t = 0; t < 1; t += 1 / 60) if (Snd.cueFor(s2, { type: "shed", amount: 3 }, t)) n++
  assert.ok(n >= 5 && n <= 8, "thuds in a second: " + n)
  // Louder for more snow; a dusting makes none.
  const a = Snd.cueFor(Snd.newState(), { type: "shed", amount: 1 }, 0), b = Snd.cueFor(Snd.newState(), { type: "shed", amount: 30 }, 0)
  assert.ok(b.volume > a.volume)
  assert.strictEqual(Snd.cueFor(Snd.newState(), { type: "shed", amount: 0.1 }, 0), null)
  for (const [type, re] of [["ice", /^ice-/], ["meteor", /^chime-/], ["golden", /^chime-/], ["launch", /^firework-launch$/], ["burst", /^firework-boom-/], ["throw", /^whoosh-/], ["sleigh", /^sleigh-bells$/]])
    assert.ok(re.test(Snd.cueFor(Snd.newState(), { type, len: 20 }, 0).name), type)
  assert.strictEqual(Snd.cueFor(Snd.newState(), { type: "yank" }, 0), null)
  assert.strictEqual(Snd.cueFor(Snd.newState(), null, 0), null)
  for (const name of Snd.allShots()) assert.ok(fs.existsSync(path.join(root, "sounds", name + ".wav")), name)
})

test("the bed follows the effect, goes quiet when nothing shows, and grows with the amount", () => {
  for (const e of Snd.EFFECTS) {
    assert.strictEqual(Snd.bedFor(e, true), e)
    assert.strictEqual(Snd.bedFor(e, false), "")
    assert.ok(Snd.bedLevel(e, 2) > Snd.bedLevel(e, 0.25), e)
    assert.ok(Snd.bedLevel(e, 2) <= 1 && Snd.bedLevel(e, 0.25) > 0)
  }
  assert.ok(Snd.bedLevel("rain", 1, 1) > Snd.bedLevel("rain", 1, 0), "a storm is louder")
  assert.strictEqual(Snd.bedFor("nothing", true), "")
})

test("sound is on by default, can be switched off, and its volume is kept in range", () => {
  const d = Store.normalize({})
  assert.strictEqual(d.sound, true)
  assert.strictEqual(d.soundVolume, 0.8)
  assert.strictEqual(Store.normalize({ sound: false }).sound, false)
  assert.strictEqual(Store.normalize({ soundVolume: 7 }).soundVolume, 1)
  assert.strictEqual(Store.normalize({ soundVolume: -1 }).soundVolume, 0)
})

test("wiring: the panel switch and slider, the player, and every scene event reaching it", () => {
  const svc = fs.readFileSync(path.join(root, "Service.qml"), "utf8")
  const widget = fs.readFileSync(path.join(root, "Widget.qml"), "utf8")
  const player = fs.readFileSync(path.join(root, "Sound.qml"), "utf8")
  assert.match(svc, /source: "Sound\.qml"/)
  assert.match(svc, /function sceneEvent\(scene, ev\) \{\n    root\.playCue\(ev\)/)
  assert.match(fs.readFileSync(path.join(root, "SceneWindow.qml"), "utf8"), /var sounds = Sim\.takeSounds\(sceneWin\.world\)\n        for \(var q = 0; q < sounds\.length; q\+\+\) sceneWin\.service\.playCue\(sounds\[q\]\)/)
  // The sounds have a channel of their own: the events the shell acts on are as before.
  const w = S.createWorld(800, 600, { effect: "rain", intensity: 2 })
  w.nextLightning = 0
  S.step(w, dt)
  assert.ok(S.takeSounds(w).some(e => e.type === "thunder"))
  assert.ok(!S.takeEvents(w).some(e => e.type === "thunder"))
  assert.match(svc, /readonly property bool soundOn: root\.loaded && !!root\.saved\.sound/)
  assert.match(svc, /function setSound\(on\)/)
  assert.match(svc, /function setSoundVolume\(v\)/)
  assert.match(widget, /onToggled: root\.service\.setSound\(!root\.saved\.sound\)/)
  assert.match(widget, /onReleased: function\(v\) \{ root\.service\.setSoundVolume\(v\) \}/)
  // Beds: takes played once each, the next started BED_OVERLAP before the end.
  assert.match(player, /Snd\.nextTake\(current, take\)/)
  assert.match(player, /\(Snd\.BED_SECONDS - Snd\.BED_OVERLAP\) \* 1000/)
  assert.doesNotMatch(player, /SoundEffect\.Infinite/)
  assert.match(svc, /\.concat\(Snd\.bedTakes\(root\.cliBed\)\)/)
  // Without Qt Multimedia, or when it can't play, everything (the bed too)
  // goes through pw-play/paplay; and `flurry sound test|status` says why.
  assert.match(player, /onStatusChanged: if \((va|vb)\.status === SoundEffect\.Error\) root\.fail/)
  assert.match(svc, /readonly property bool qtSound: soundLoader\.status === Loader\.Ready && !!soundLoader\.item && !soundLoader\.item\.broken/)
  assert.match(svc, /readonly property string cliBed: root\.soundBackend === "cli" && root\.bedNow !== ""/)
  assert.match(svc, /pw-play --volume/)
  assert.match(svc, /function sound\(mode: string\): string \{ return root\.soundCommand\(mode\) \}/)
  assert.match(fs.readFileSync(path.join(root, "bin", "flurry"), "utf8"), /  sound\) call sound "\$\{1:-status\}" ;;/)
  for (const lang of ["en", "fa"]) {
    const t = JSON.parse(fs.readFileSync(path.join(root, "i18n", lang + ".json"), "utf8"))
    for (const k of ["sound", "sound.desc", "sound.volume"]) assert.ok(t[k], lang + " " + k)
  }
})
