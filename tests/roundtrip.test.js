// A window that goes away and comes back keeps what lies on it: another
// workspace and back, the toplevel list losing it for a moment on the way
// (recording 11-39-11 at 36-37.5 s: a maximized window, round-tripped
// through an empty workspace, came back with a bare top edge).
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const S = load("lib/sim.js")
const P = load("lib/policy.js")

const dt = 1 / 60
const sum = a => a.reduce((x, y) => x + y, 0)
const win = { id: "0xa1", x: 0, y: 0, w: 1920, h: 1040, floating: false, z: 0 }

// The shell's side, as SceneWindow.syncWindows runs it each frame: the
// windows in view, and the alive list read through Policy.graceAlive.
function shell() {
  const memo = {}, closed = {}
  let now = 1e6
  return {
    closed,
    frame(w, rects, aliveNow) {
      now += 1000 / 60
      const alive = P.graceAlive(memo, aliveNow, now, P.ALIVE_GRACE_MS, id => !!closed[id])
      S.setSurfaces(w, rects, w.time, alive)
      S.step(w, dt)
    },
    run(w, secs, rects, aliveNow) { for (let t = 0; t < secs; t += dt) this.frame(w, rects, aliveNow) }
  }
}
function snowyWorld() {
  const w = S.createWorld(1920, 1040, { effect: "snow", intensity: 2, plow: false })
  S.setFeatures(w, { icicles: false })
  return w
}

test("graceAlive: a window gone from the list for a moment still counts; a closed one never does", () => {
  const memo = {}
  assert.deepStrictEqual(P.graceAlive(memo, ["0xa", "0xb"], 1000, 2500), ["0xa", "0xb"])
  assert.deepStrictEqual(P.graceAlive(memo, ["0xa"], 1100, 2500).sort(), ["0xa", "0xb"], "a blip keeps it")
  assert.deepStrictEqual(P.graceAlive(memo, ["0xa"], 1200, 2500, id => id === "0xb"), ["0xa"], "closed: gone at once")
  assert.deepStrictEqual(P.graceAlive(memo, [], 3000, 2500), ["0xa"])
  assert.deepStrictEqual(P.graceAlive(memo, [], 3701, 2500), [], "past the grace period it is gone")
  assert.deepStrictEqual(memo, {})
})

test("recording 11-39-11 @36 s: a workspace round trip keeps the ledge, even when the window drops out of the toplevel list on the way", () => {
  const w = snowyWorld(), sh = shell()
  sh.run(w, 40, [win], [win.id])
  const before = sum(w.surfaces[win.id].bins)
  assert.ok(before > 500, "a ledge: " + before)
  S.setEnv(w, { snowScale: 0 })
  w.particles = []
  // Off to an empty workspace; mid-switch, the toplevel list loses it for
  // a few frames (neither in view nor alive).
  sh.run(w, 0.1, [], [])
  sh.run(w, 1.2, [], [win.id])
  sh.run(w, 0.05, [], [])
  // And back.
  sh.run(w, 0.5, [win], [win.id])
  const after = sum(w.surfaces[win.id].bins)
  assert.ok(after > 0.97 * before, "kept: " + after.toFixed(0) + " of " + before.toFixed(0))
  // Nothing fell from it on the way: no clumps came off where it was.
  assert.strictEqual(w.particles.filter(p => p.kind === "clump").length, 0)
})

test("a window that really closes drops its ledge at once; one that vanishes without a word is let go after the grace period", () => {
  const w = snowyWorld(), sh = shell()
  const other = { id: "0xb2", x: 300, y: 300, w: 600, h: 400, floating: true, z: 1 }
  sh.run(w, 30, [win, other], [win.id, other.id])
  S.setEnv(w, { snowScale: 0 })
  w.particles = []
  sh.closed[other.id] = true
  sh.frame(w, [win], [win.id])
  assert.ok(!w.surfaces[other.id], "gone from the world")
  assert.ok(w.particles.some(p => p.kind === "clump" || p.kind === "powder"), "its snow falls where it was")
  // A window the list loses for good, with no closewindow (a missed event):
  // put aside for the grace period, then dropped from the stash.
  sh.frame(w, [], [])
  const stash = w.shared ? w.shared.stash : w.stash
  assert.ok(stash[win.id], "put aside for now")
  sh.run(w, P.ALIVE_GRACE_MS / 1000 + 0.2, [], [])
  assert.ok(!stash[win.id], "let go after the grace period")
})
