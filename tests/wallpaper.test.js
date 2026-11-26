// Weather wallpaper: which painting goes with each scene mode, the toggle
// and the CLI, fades that run only during a change, and the user's own
// wallpaper never touched.
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path"), crypto = require("crypto")
const load = require("./load")
const root = path.join(__dirname, "..")
const W = load("lib/wallpaper.js")
const Store = load("lib/store.js")
const Policy = load("lib/policy.js")
const Sim = load("lib/sim.js")
const read = f => fs.readFileSync(path.join(root, f), "utf8")

test("every scene mode has a painting, and modes that look alike share one", () => {
  const expect = {
    snow: "snow", flurries: "snow", blizzard: "snow",
    rain: "rain", sleet: "rain",
    clear: "clear",
    sakura: "sakura", spring: "sakura",
    leaves: "autumn", starfall: "night", fireflies: "summer-night"
  }
  for (const m in expect) assert.strictEqual(W.imageFor(m), expect[m], m)
  // Every effect Flurry has, and every word the live weather can give.
  for (const e of Sim.EFFECTS) assert.ok(W.MODE_IMAGE[e], "no painting for effect " + e)
  for (const k of ["blizzard", "snow", "flurries", "sleet", "rain", "clear"]) assert.ok(W.MODE_IMAGE[k], "no painting for weather " + k)
  // Through Policy.sceneMode, as Service.qml reads it.
  assert.strictEqual(W.imageFor(Policy.sceneMode("snow", { spring: 0.8 }, "")), "sakura")
  assert.strictEqual(W.imageFor(Policy.sceneMode("snow", { spring: 0 }, "sleet")), "rain")
  assert.strictEqual(W.imageFor(Policy.sceneMode("snow", { spring: 0 }, "")), "snow")
  assert.strictEqual(W.imageFor(Policy.sceneMode("leaves", { spring: 0 }, "rain")), "autumn")
  // Unknown modes fall back to snow; a clear night is the night painting.
  assert.strictEqual(W.imageFor("hail"), "snow")
  assert.strictEqual(W.imageFor(""), "snow")
  assert.strictEqual(W.imageFor("clear", { sun: 0 }), "night")
  assert.strictEqual(W.imageFor("clear", { sun: 0.6 }), "clear")
  assert.strictEqual(W.imageFor("snow", { sun: 0 }), "snow")
})

test("each painting ships as an 8K JPEG of sensible size, with a docs preview", () => {
  let total = 0
  for (const name of W.IMAGES) {
    const f = path.join(root, W.fileOf(name))
    assert.ok(fs.existsSync(f), f)
    const buf = fs.readFileSync(f)
    total += buf.length
    assert.ok(buf.length < 12 * 1024 * 1024, name + " is over 12 MB")
    assert.strictEqual(buf[0], 0xff); assert.strictEqual(buf[1], 0xd8)
    // Size from the JPEG's SOF marker.
    let i = 2, size = null
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xc3) { size = { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; break }
      i += 2 + buf.readUInt16BE(i + 2)
    }
    assert.deepStrictEqual(size, { w: 7680, h: 4320 }, name)
    assert.ok(fs.existsSync(path.join(root, "docs/wallpapers", name + ".jpg")), "preview " + name)
  }
  assert.ok(total < 40 * 1024 * 1024, "the paintings together are " + total + " bytes")
  assert.strictEqual(W.fileOf("nope"), "wallpapers/snow.jpg")
})

test("a painting is decoded only as large as the screen needs", () => {
  assert.deepStrictEqual(W.coverSize(1920, 1080, 1), { width: 1920, height: 1080 })
  assert.deepStrictEqual(W.coverSize(1920, 1080, 2), { width: 3840, height: 2160 })
  // Ultrawide: covered by width, cropped top and bottom.
  const uw = W.coverSize(3440, 1440, 1)
  assert.strictEqual(uw.width, 3440); assert.ok(uw.height >= 1440)
  // 16:10: covered by height.
  const t = W.coverSize(2560, 1600, 1)
  assert.strictEqual(t.height, 1600); assert.ok(t.width >= 2560)
  // Never above the file's own size.
  assert.deepStrictEqual(W.coverSize(7680, 4320, 2), { width: 7680, height: 4320 })
  assert.deepStrictEqual(W.coverSize(0, 0, 0), { width: 2, height: 1 })
})

test("the fade eases like dusk and tints only a little", () => {
  assert.strictEqual(W.ease(0), 0); assert.strictEqual(W.ease(1), 1)
  assert.ok(Math.abs(W.ease(0.5) - 0.5) < 1e-9)
  assert.ok(W.ease(0.1) < 0.01, "slow to start")
  assert.ok(W.ease(0.9) > 0.99, "slow to finish")
  for (let t = 0; t < 1; t += 0.05) assert.ok(W.ease(t + 0.05) >= W.ease(t))
  assert.strictEqual(W.tint(0).alpha, 0); assert.strictEqual(W.tint(1).alpha, 0)
  assert.ok(W.tint(0.5).alpha > 0.03 && W.tint(0.5).alpha <= 0.06)
  assert.ok(parseInt(W.tint(0.1).color.slice(1, 3), 16) > parseInt(W.tint(0.9).color.slice(1, 3), 16), "warm, then cool")
  assert.match(W.tint(0.3).color, /^#[0-9a-f]{6}$/)
  assert.strictEqual(W.fadeSeconds(undefined), 10)
  assert.strictEqual(W.fadeSeconds(""), 10)
  assert.strictEqual(W.fadeSeconds(1), 2)
  assert.strictEqual(W.fadeSeconds(500), 60)
  assert.strictEqual(W.fadeSeconds("12"), 12)
})

test("fades start only on a change, queue the latest change, and end idle", () => {
  let st = W.initial()
  assert.strictEqual(W.busy(st), false)
  // Turned on: fade in over the user's wallpaper.
  let r = W.want(st, "snow", true)
  assert.strictEqual(r.start, "snow"); st = r.state
  assert.ok(W.busy(st))
  // The same painting again: nothing new.
  r = W.want(st, "snow", true); assert.strictEqual(r.start, ""); assert.strictEqual(r.state.pending, "")
  // Two changes mid-fade: only the latest waits.
  r = W.want(r.state, "rain", true); assert.strictEqual(r.start, "")
  r = W.want(r.state, "sakura", true); st = r.state
  assert.strictEqual(st.pending, "sakura")
  r = W.finished(st)
  assert.strictEqual(r.state.shown, "snow"); assert.strictEqual(r.start, "sakura"); st = r.state
  r = W.finished(st)
  assert.strictEqual(r.start, ""); st = r.state
  assert.deepStrictEqual(st, { shown: "sakura", target: "", pending: "" })
  assert.strictEqual(W.busy(st), false, "idle after the fade: nothing to repaint")
  // Nothing changes: no fade.
  r = W.want(st, "sakura", true); assert.strictEqual(r.start, ""); assert.strictEqual(r.jump, false)
  // A change and back again before the first fade ends: the pending one is dropped.
  r = W.want(st, "rain", true); st = r.state
  r = W.want(st, "rain", true); assert.strictEqual(r.state.pending, "")
  // Off: a fade out, after which the screen is the user's again.
  r = W.want(W.finished(r.state).state, "", true)
  assert.strictEqual(r.start, "-")
  r = W.finished(r.state)
  assert.deepStrictEqual(r.state, W.initial())
  // Nobody watching (fullscreen, hidden, animations off): at once, no fade.
  r = W.want(W.initial(), "night", false)
  assert.strictEqual(r.start, ""); assert.strictEqual(r.jump, true); assert.strictEqual(r.state.shown, "night")
  r = W.want(r.state, "night", false); assert.strictEqual(r.jump, false)
})

test("the toggle is off by default, kept when saved, and the fade length is held in range", () => {
  assert.strictEqual(Store.defaults().wallpaper, false)
  assert.strictEqual(Store.defaults().wallpaperFade, 10)
  assert.strictEqual(Store.normalize({}).wallpaper, false)
  assert.strictEqual(Store.normalize({ wallpaper: true }).wallpaper, true)
  assert.strictEqual(Store.normalize({ wallpaper: "yes" }).wallpaper, false)
  assert.strictEqual(Store.normalize({ wallpaperFade: 0.5 }).wallpaperFade, 2)
  assert.strictEqual(Store.normalize({ wallpaperFade: 999 }).wallpaperFade, 60)
  assert.strictEqual(Store.normalize({ wallpaperFade: "x" }).wallpaperFade, 10)
  assert.strictEqual(Store.normalize(Store.normalize({ wallpaper: true, wallpaperFade: 14 })).wallpaperFade, 14)
})

test("the panel toggle and `flurry wallpaper on|off|toggle` reach the service", () => {
  const w = read("Widget.qml")
  assert.match(w, /title: strings\.t\("wallpaper"\)/)
  assert.match(w, /onToggled: root\.service\.setWallpaper\(!root\.saved\.wallpaper\)/)
  const bin = read("bin/flurry")
  assert.match(bin, /^\s*wallpaper\) call wallpaper "\$\{1:-status\}" "\$\{2:-\}" ;;$/m)
  assert.match(bin, /wallpaper \[on\|off\|toggle\|status\|fade <seconds>\]/)
  const svc = read("Service.qml")
  assert.match(svc, /function wallpaper\(mode: string, value: string\): string \{ return root\.wallpaperCommand\(mode, value\) \}/)
  // wallpaperCommand, run as plain JS against a stand-in service.
  const body = svc.slice(svc.indexOf("  function wallpaperCommand("), svc.indexOf("  function toggleFlag(name) {"))
  const svcRoot = { saved: Store.defaults(), wallpaperImage: "snow" }
  const update = fn => { const n = JSON.parse(JSON.stringify(svcRoot.saved)); fn(n); svcRoot.saved = Store.normalize(n) }
  const setWallpaper = on => update(s => { s.wallpaper = !!on })
  const cmd = new Function("root", "update", "setWallpaper", "Wallpaper", body + "\nreturn wallpaperCommand")(svcRoot, update, setWallpaper, W)
  assert.strictEqual(cmd("status"), "off (fade 10 s)")
  assert.strictEqual(cmd("on"), "on"); assert.strictEqual(svcRoot.saved.wallpaper, true)
  assert.strictEqual(cmd("status"), "on: snow (fade 10 s)")
  assert.strictEqual(cmd("toggle"), "off"); assert.strictEqual(svcRoot.saved.wallpaper, false)
  assert.strictEqual(cmd("TOGGLE"), "on")
  assert.strictEqual(cmd("off"), "off")
  assert.strictEqual(cmd("fade", "15"), "15 s"); assert.strictEqual(svcRoot.saved.wallpaperFade, 15)
  assert.strictEqual(cmd("fade", "1"), "2 s")
  assert.match(cmd("fade", ""), /seconds, 2 to 60/)
  assert.match(cmd("bogus"), /^wallpaper: on, off/)
  // One window per screen, built like the scenes.
  assert.match(svc, /Variants \{\s*model: Quickshell\.screens\s*delegate: Component \{\s*WallpaperWindow \{/)
})

test("the wallpaper window sits under every window, repaints only during a fade, and never writes a file", () => {
  const src = read("WallpaperWindow.qml")
  const code = src.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n")
  assert.match(code, /WlrLayershell\.layer: WlrLayer\.(Bottom|Background)/)
  assert.match(code, /exclusionMode: ExclusionMode\.Ignore/)
  assert.match(code, /WlrKeyboardFocus\.None/)
  assert.match(code, /mask: Region \{\}/, "takes no input")
  // The only animation: started for a fade, linear in time, never looping.
  assert.strictEqual((code.match(/\b(NumberAnimation|PropertyAnimation|OpacityAnimator|ColorAnimation|SequentialAnimation)\b/g) || []).length, 1)
  assert.ok(!/\bTimer\b|FrameAnimation|requestAnimationFrame|\bloops:|running: true/.test(code), "no timers or loops")
  assert.ok(!/Behavior on/.test(code), "no implicit animations")
  assert.match(code, /duration: Style\.duration\(/)
  assert.match(code, /onFinished: wallWin\.done\(\)/)
  // Decoded at the screen's size, cropped to cover, ground kept at the bottom.
  assert.match(code, /sourceSize\.width: wallWin\.decode\.width/)
  assert.match(code, /fillMode: Image\.PreserveAspectCrop/)
  assert.match(code, /verticalAlignment: Image\.AlignBottom/)
  assert.match(code, /cache: false/)
  // Never touches the user's wallpaper or theme: no processes, no file writes.
  for (const f of ["WallpaperWindow.qml", "lib/wallpaper.js"]) {
    const s = read(f)
    assert.ok(!/\b(Process|FileView|execDetached|swaybg|hyprpaper|omarchy-theme|omarchy-bg|background\.)/.test(s.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n")), f)
  }
  const svc = read("Service.qml")
  const wpBlock = svc.slice(svc.indexOf("readonly property bool wallpaperOn"), svc.indexOf("  function toggleFlag(name) {"))
  assert.ok(!/execDetached|Process|swaybg|backgrounds/.test(wpBlock))
})

test("the user's own Omarchy wallpaper files stay byte for byte the same", () => {
  // A stand-in Omarchy config: theme backgrounds and the current-background
  // link. Nothing in the feature knows these paths; check that running the
  // whole state machine and every command against them changes nothing.
  const os = require("os")
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "flurry-wp-"))
  const bgDir = path.join(home, ".config/omarchy/backgrounds/tokyo-night")
  fs.mkdirSync(bgDir, { recursive: true })
  const bg = path.join(bgDir, "1-scenery.jpg")
  fs.writeFileSync(bg, crypto.randomBytes(4096))
  fs.mkdirSync(path.join(home, ".config/omarchy/current"), { recursive: true })
  const link = path.join(home, ".config/omarchy/current/background")
  fs.symlinkSync(bg, link)
  const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")
  const before = { bg: hash(bg), link: fs.readlinkSync(link), mtime: fs.statSync(bg).mtimeMs }
  let st = W.initial()
  for (const m of ["snow", "rain", "clear", "starfall", "leaves", "sakura", "fireflies"]) {
    st = W.want(st, W.imageFor(m), true).state
    st = W.finished(st).state
  }
  st = W.finished(W.want(st, "", true).state).state
  assert.deepStrictEqual(st, W.initial())
  assert.strictEqual(hash(bg), before.bg)
  assert.strictEqual(fs.readlinkSync(link), before.link)
  assert.strictEqual(fs.statSync(bg).mtimeMs, before.mtime)
  // And the plugin never names those paths anywhere in its code.
  for (const f of fs.readdirSync(root).filter(f => f.endsWith(".qml")).concat(["lib/wallpaper.js", "bin/flurry"])) {
    const s = read(f)
    assert.ok(!/omarchy\/current\/background|omarchy\/backgrounds|swaybg -i/.test(s), f)
  }
  fs.rmSync(home, { recursive: true, force: true })
})
