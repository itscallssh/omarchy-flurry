// The bug sweep: fullscreen in a special workspace, the compositor plugin
// letting go of what it drew, a screen going away, rain soak across a
// workspace switch, special workspace toggles, `flurry update` without jq.
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process")
const load = require("./load")
const S = load("lib/sim.js")
const P = load("lib/policy.js")
const qml = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")
const sum = a => a.reduce((x, y) => x + y, 0)
const dt = 1 / 60

test("fullscreen: on the active workspace or in the special workspace over it; maximized, hidden or elsewhere never", () => {
  const win = (ws, fs, extra) => Object.assign({ workspace: { id: ws }, fullscreen: fs }, extra || {})
  assert.ok(P.fullscreenOn([win(1, 2)], 1, 0))
  assert.ok(!P.fullscreenOn([win(1, 1)], 1, 0), "maximized")
  assert.ok(!P.fullscreenOn([win(2, 2)], 1, 0), "another workspace")
  assert.ok(P.fullscreenOn([win(-98, 2)], 1, -98), "a fullscreen app in the open scratchpad")
  assert.ok(!P.fullscreenOn([win(-98, 2)], 1, 0), "the scratchpad is closed")
  assert.ok(!P.fullscreenOn([win(1, 2, { mapped: false })], 1, 0))
  assert.ok(!P.fullscreenOn([null, {}, win(1, 0)], 1, 0))
})

test("a screen going away puts its windows' snow aside for the screen they move to", () => {
  const shared = S.sharedStash()
  const a = S.createWorld(1600, 900, { effect: "snow", intensity: 2, plow: false }); a.shared = shared
  const r = { id: "0xc3", x: 200, y: 300, w: 700, h: 400, floating: true, z: 0 }
  for (let t = 0; t < 20; t += dt) { S.setSurfaces(a, [r], a.time, [r.id]); S.step(a, dt) }
  const m = sum(a.surfaces[r.id].bins)
  assert.ok(m > 100)
  S.forgetWorld(a, { stash: true })
  assert.ok(shared.stash[r.id], "put aside")
  const b = S.createWorld(1920, 1080, { effect: "snow", intensity: 2, plow: false }); b.shared = shared
  S.setEnv(b, { snowScale: 0 })
  S.setSurfaces(b, [r], b.time, [r.id])
  assert.ok(sum(b.surfaces[r.id].bins) > 0.95 * m, "taken up on the other screen")
  // Plain forget (a world started afresh) leaves the stash alone.
  const c = S.createWorld(100, 100); c.shared = S.sharedStash()
  S.forgetWorld(c)
  assert.deepStrictEqual(c.shared.stash, {})
})

test("rain: a soaked window top is still wet when it comes back from another workspace mid-storm", () => {
  const w = S.createWorld(1600, 900, { effect: "rain", intensity: 2, plow: false })
  const r = { id: "0xd4", x: 300, y: 300, w: 800, h: 400, floating: true, z: 0 }
  for (let t = 0; t < 25; t += dt) { S.setSurfaces(w, [r], w.time, [r.id]); S.step(w, dt) }
  const soak = w.surfaces[r.id].soak
  assert.ok(soak > 10, "soaked: " + soak)
  for (let t = 0; t < 2; t += dt) { S.setSurfaces(w, [], w.time, [r.id]); S.step(w, dt) }
  S.setSurfaces(w, [r], w.time, [r.id])
  const back = w.surfaces[r.id].soak || 0
  assert.ok(back > 0.9 * soak, "kept: " + back.toFixed(1) + " of " + soak.toFixed(1))
})

test("shell: the plugin's strips are cleared when this scene lets go, even for windows it still lists", () => {
  const sw = qml("SceneWindow.qml"), sv = qml("Service.qml")
  assert.match(sv, /function sceneShowing\(addr, except\)/)
  const reset = sw.slice(sw.indexOf("function anchorReset()"), sw.indexOf("onAnchorOnChanged"))
  assert.match(reset, /sceneShowing\(id, sceneWin\)/, "anchorReset skips this scene")
  assert.match(sw, /if \(!sceneWin\.anchorOn\) \{[\s\S]{0,400}anchorClear\(id\)/, "a set that lands after switching off is cleared")
  assert.match(sw, /Sim\.forgetWorld\(world, \{ stash: true \}\)/)
})

test("shell: a special workspace toggle re-reads the monitors, and fullscreen counts the scratchpad", () => {
  const sv = qml("Service.qml"), sw = qml("SceneWindow.qml")
  assert.match(sv, /case "activespecial": case "activespecialv2":\s*\/\/[\s\S]*?Hyprland\.refreshMonitors\(\)/)
  assert.match(sw, /Policy\.fullscreenOn\(/)
})

test("flurry update finds the plugin id without jq", { skip: process.platform !== "linux" && "needs bash" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flurry-upd-"))
  const plug = path.join(dir, "omarchy-flurry"), bin = path.join(dir, "bin")
  fs.mkdirSync(path.join(plug, "bin"), { recursive: true }); fs.mkdirSync(bin)
  fs.copyFileSync(path.join(__dirname, "..", "bin", "flurry"), path.join(plug, "bin", "flurry"))
  fs.copyFileSync(path.join(__dirname, "..", "manifest.json"), path.join(plug, "manifest.json"))
  // A stand-in omarchy that prints what it was asked; no jq on the PATH.
  fs.writeFileSync(path.join(bin, "omarchy"), "#!/bin/sh\necho \"$@\"\n", { mode: 0o755 })
  for (const t of ["sed", "head", "dirname", "readlink", "basename"]) {
    const real = cp.execSync("command -v " + t, { shell: "/bin/bash" }).toString().trim()
    fs.symlinkSync(real, path.join(bin, t))
  }
  const out = cp.execFileSync("/bin/bash", [path.join(plug, "bin", "flurry"), "update", "--yes"], { env: { PATH: bin } }).toString().trim()
  assert.strictEqual(out, "plugin update itscallssh.flurry --yes")
  fs.rmSync(dir, { recursive: true, force: true })
})
