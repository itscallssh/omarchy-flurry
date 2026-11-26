// Idle and power: a scene with nothing moving stops its frame loop and only
// looks in now and then (lib/sim.js quiet/advance, SceneWindow idle), the
// window list is read on a timer only during a drag, and nothing ticks
// while no scene shows (Service.qml).
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")
const load = require("./load")
const S = load("lib/sim.js")

const dt = 1 / 60
const sum = a => a.reduce((x, y) => x + y, 0)
const win = { id: "0xa1", x: 200, y: 300, w: 800, h: 400, floating: false, z: 0 }
function run(w, secs, rects) { for (let t = 0; t < secs - 1e-9; t += dt) { S.setSurfaces(w, rects, w.time, rects.map(r => r.id)); S.step(w, dt) } }

test("a clear sky over lying snow goes quiet; snowfall, a visitor or a moving window never does", () => {
  const w = S.createWorld(1400, 900, { effect: "snow", intensity: 2, plow: false })
  S.setFeatures(w, { gusts: false })
  run(w, 20, [win])
  assert.strictEqual(S.quiet(w), false, "it is snowing")
  S.setEnv(w, { snowScale: 0, windVar: 0 })
  run(w, 40, [win])
  assert.ok(sum(w.surfaces[win.id].bins) > 50, "snow lies on the window")
  assert.strictEqual(S.quiet(w), true, "the last flakes have landed: " + w.particles.filter(p => !p.rest).length + " in the air")
  S.spawnRabbit(w, { dir: 1 })
  assert.strictEqual(S.quiet(w), false, "a hare is about")
  w.rabbit = null
  assert.strictEqual(S.quiet(w), true)
  // The window moves: its snow is moving with it.
  S.setSurfaces(w, [Object.assign({}, win, { x: win.x + 40 })], w.time, [win.id], { pointer: { x: win.x + 300, y: win.y + 10, vx: 2400, vy: 0, present: true, stillFor: 0 }, poll: 1 / 60, layoutAge: 1e9 })
  S.step(w, dt)
  const moving = !S.quiet(w)
  run(w, 4, [Object.assign({}, win, { x: win.x + 40 })])
  assert.ok(moving, "not quiet while the window moves")
  for (const eff of ["rain", "leaves", "fireflies", "sakura", "starfall"]) {
    const x = S.createWorld(800, 600, { effect: eff })
    S.step(x, dt)
    assert.strictEqual(S.quiet(x), false, eff + " never rests")
  }
})

test("advance steps in ordinary steps: a 1 s idle look-in melts as much as 60 frames would", () => {
  const mk = () => {
    const w = S.createWorld(1400, 900, { effect: "snow", intensity: 2, plow: false })
    S.setFeatures(w, { gusts: false, icicles: false })
    run(w, 15, [win])
    S.setEnv(w, { snowScale: 0, windVar: 0, melt: 0.02, sun: 1, tempC: 6 })
    w.particles = w.particles.filter(p => p.rest)
    return w
  }
  const rnd = Math.random
  let seed = 7
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  try {
    const a = mk(); seed = 99; const b = mk()
    b.surfaces[win.id].bins = a.surfaces[win.id].bins.slice()
    const start = sum(a.surfaces[win.id].bins)
    for (let i = 0; i < 60; i++) S.step(a, dt)
    assert.ok(Math.abs(S.advance(b, 1) - 1) < 1e-9, "stepped 1 s")
    const ma = sum(a.surfaces[win.id].bins), mb = sum(b.surfaces[win.id].bins)
    assert.ok(ma < start, "it melts")
    assert.ok(Math.abs(ma - mb) < 0.05 * start, "about the same: " + ma.toFixed(1) + " vs " + mb.toFixed(1))
  } finally { Math.random = rnd }
  assert.strictEqual(S.advance(S.createWorld(10, 10), NaN), 0)
})

// The shell's side is QML; these read it for the rules it must keep.
const qml = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")

test("shell: the frame loop rests when the scene is idle, and the clock follows real time", () => {
  const sw = qml("SceneWindow.qml")
  assert.match(sw, /FrameAnimation \{\s*id: frames\s*running: sceneWin\.visible && sceneWin\.wantsFrames && !sceneWin\.idle/)
  assert.match(sw, /Sim\.quiet\(/)
  assert.match(sw, /Sim\.advance\(/)
  assert.match(sw, /function realDt\(\)/)
  assert.doesNotMatch(sw, /clock \+= dt\b(?!.*real)/, "the clock is not the clamped step")
})

test("shell: the window list is polled only during a drag, and nothing ticks while no scene shows", () => {
  const sv = qml("Service.qml")
  assert.match(sv, /id: windowPoll\s*running: root\.showing && root\.dragActive/)
  // Every repeating timer either waits on showing, or is one of the few
  // that decide whether the scenes show at all (calm, power, the clock for
  // the New Year, the weather) or runs only while the panel is open.
  const timers = [...sv.matchAll(/Timer \{([\s\S]*?)\n  \}/g)].map(m => m[1]).filter(b => /repeat: true/.test(b))
  const allowed = /calmCheck|newYearTimer|weatherTimer|springRamp|root\.upowerBattery|inbox/
  for (const b of timers) {
    if (/running:[^\n]*root\.showing/.test(b) || allowed.test(b)) continue
    assert.fail("a timer runs while nothing shows:\n" + b.trim().split("\n").slice(0, 4).join("\n"))
  }
})
