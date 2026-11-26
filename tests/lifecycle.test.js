// Windows coming and going: everything that rides a window is keyed to its
// address and lets go the moment it is gone from the screen, snow rides a
// smoothly dragged window and leaves it only gradually (a yank is in
// tests/yank.test.js), jumps are not jolts, and the
// drawing never paints falling snow over a window's face.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const S = load("lib/sim.js")
const Store = load("lib/store.js")
let createCanvas = null
try { createCanvas = require("@napi-rs/canvas").createCanvas } catch (e) {}

const dt = 1 / 60
const sum = a => a.reduce((x, y) => x + y, 0)
const W = 1920, H = 1080
const TERM = { id: "0x55d1c0a3e2f0", x: 510, y: 300, w: 900, h: 460, floating: true, z: 0 }
const at = (r, dx, dy) => Object.assign({}, r, { x: r.x + (dx || 0), y: r.y + (dy || 0) })

// The user's scene: a 1920x1080 screen, a terminal, snow for a while.
function scene(secs) {
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1.4, plow: false })
  S.setEnv(w, { tempC: -4, icicle: 1 })
  for (let t = 0; t < (secs || 60); t += dt) { S.setSurfaces(w, [TERM], w.time, [TERM.id]); S.step(w, dt) }
  return w
}
const ledge = (w, id) => w.surfaces[id || TERM.id] ? sum(w.surfaces[id || TERM.id].bins) : 0
const airborneSnow = w => w.particles.reduce((t, p) => t + ((p.kind === "clump" || p.kind === "powder") ? p.amount : 0), 0)

test("open, accumulate, close: the ledge falls as loose snow at once and leaves no ghost", () => {
  const w = scene(90)
  const s = w.surfaces[TERM.id]
  assert.ok(ledge(w) > 600, "a believable layer built up: " + ledge(w))
  assert.ok(s.icicles && s.icicles.some(i => i.len > 4), "icicles grew on it")
  S.spawnBird(w, { surface: TERM.id })
  for (let t = 0; t < 3; t += dt) { S.setSurfaces(w, [TERM], w.time, [TERM.id]); S.step(w, dt) }
  assert.strictEqual(w.bird.mode, "perch")
  const lying = ledge(w) + s.edges[0].m + s.edges[1].m
  const before = airborneSnow(w)
  const old = new Set(w.particles)
  // Closed: gone from the rectangles and from the windows that exist.
  S.setSurfaces(w, [], w.time, [])
  assert.strictEqual(w.surfaces[TERM.id], undefined, "no surface")
  assert.strictEqual(w.stash[TERM.id], undefined, "nothing put aside")
  assert.strictEqual(S.restingY(w, TERM.id, TERM.x + 100), null, "nothing stands on it")
  assert.strictEqual(w.bird.mode, "out", "the bird flew off")
  assert.ok(Math.abs(airborneSnow(w) - before - lying) < lying * 0.02 + 1, `the snow is all in the air: ${airborneSnow(w) - before} of ${lying}`)
  assert.ok(w.particles.some(p => p.kind === "shard"), "the icicles fell")
  const clumps = w.particles.filter(p => p.kind === "clump" && !old.has(p))
  assert.ok(clumps.length > 20 && clumps.length < 600, `a row of clumps: ${clumps.length}`)
  assert.ok(clumps.every(p => Math.abs(p.vx) < 200 && Math.abs(p.vy) < 200), "it drops, it is not thrown")
  // A few seconds on, nothing is left where the window's top edge was.
  for (let t = 0; t < 3; t += dt) { S.setSurfaces(w, [], w.time, []); S.step(w, dt) }
  const hanging = w.particles.filter(p => (p.kind === "clump" || p.kind === "powder") && p.y > TERM.y - 30 && p.y < TERM.y + 10 && p.x > TERM.x && p.x < TERM.x + TERM.w)
  assert.strictEqual(hanging.length, 0, "nothing hangs in the air")
  assert.ok(!Object.keys(w.gusts).length && !Object.keys(w.strings).length)
})

test("everything keyed to the window lets go with it: lights, gusts, the pen, a ball resting on it", () => {
  const w = scene(60)
  S.setStrings(w, [{ id: "l1:" + TERM.id, surface: TERM.id, palette: "warm" }])
  assert.ok(w.strings["l1:" + TERM.id])
  S.writeStart(w, TERM.x + 200, TERM.y - 4)
  // Off to another workspace: alive, but not on this screen.
  S.setSurfaces(w, [], w.time, [TERM.id])
  assert.strictEqual(w.surfaces[TERM.id], undefined, "no ledge drawn on this screen")
  assert.ok(w.stash[TERM.id], "its snow waits for it")
  assert.strictEqual(Object.keys(w.strings).length, 0, "its lights are taken down here")
  assert.strictEqual(w.pen, null, "writing on it stops")
  // Closed while away: its snow is forgotten, not kept forever.
  S.setSurfaces(w, [], w.time, [])
  assert.strictEqual(w.stash[TERM.id], undefined)
})

test("a workspace switch: windows of the other workspace leave no ledge here, and theirs come back", () => {
  const w = scene(60)
  const had = ledge(w)
  const other = { id: "0xbeef", x: 100, y: 200, w: 700, h: 500, floating: false, z: 1 }
  const n = w.particles.length
  // Switch: this workspace shows `other`; the terminal still exists elsewhere.
  S.setSurfaces(w, [other], w.time, [TERM.id, other.id])
  assert.strictEqual(w.surfaces[TERM.id], undefined)
  assert.ok(w.particles.length <= n, "nothing spilled")
  for (let t = 0; t < 2; t += dt) { S.setSurfaces(w, [other], w.time, [TERM.id, other.id]); S.step(w, dt) }
  // Back again.
  S.setSurfaces(w, [TERM], w.time, [TERM.id, other.id])
  assert.ok(ledge(w) > had * 0.95, "its snow is back")
  assert.ok(w.stash[other.id] || ledge(w, other.id) === 0, "the other's snow waits for it")
  assert.strictEqual(w.surfaces[other.id], undefined)
})

// Retitled with the yank physics: a late sample with no pointer dragging
// the window (a snap, a layout change, a keyboard move) is still a jump.
// The first sample of a real drag is now told apart by the pointer and is
// judged as a drag (tests/yank.test.js).
test("a jump with no pointer behind it (a snap, a layout change) moves the snow with the window and sheds nothing", () => {
  const clumpsAfter = jump => {
    const w = scene(60)
    S.setEnv(w, { snowScale: 0 }); w.particles = []
    const had = ledge(w)
    const bins = w.surfaces[TERM.id].bins.slice()
    // Nothing new for a quarter second (the idle poll), then 240 px further.
    const r = jump ? at(TERM, 240, 60) : TERM
    for (let t = 0; t < 0.25; t += dt) S.step(w, dt)
    for (let t = 0; t < 0.5; t += dt) { S.setSurfaces(w, [r], w.time, [TERM.id]); S.step(w, dt) }
    const s = w.surfaces[TERM.id]
    assert.ok(ledge(w) > had * 0.99, `kept ${ledge(w)} of ${had}`)
    if (jump) {
      assert.ok(Math.abs(S.restingY(w, TERM.id, TERM.x + 240 + 302) - (TERM.y + 60 - bins[75])) < 3, "the snow is on the window where it moved to")
      assert.strictEqual(s.vx, 0, "no speed read from a jump")
    }
    return w.particles.filter(p => p.kind === "clump").reduce((t, p) => t + p.amount, 0)
  }
  // A full ledge pours a little over its ends on its own; a jump adds nothing to that.
  const still = clumpsAfter(false), jumped = clumpsAfter(true)
  assert.ok(jumped <= still + 15, `jumped ${jumped}, still ${still}`)
})

test("a smooth drag: the snow rides along; nothing bursts, no sheets, speeds stay plausible", () => {
  let seed = 101
  const rnd = Math.random
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  try {
    // A ledge as deep as 60 s of snow built before windows caught it faster
    // (TUNING.snow.windowCatch): a ledge filled to the cap sheds more, by design.
    const w = scene(Math.round(60 / S.TUNING.snow.windowCatch))
    S.setEnv(w, { snowScale: 0 }); w.particles = []
    const had = ledge(w)
    let most = 0, fastest = 0, x = 0, y = 0
    // Eases out to ~1100 px/s and back, twice, sampled every frame.
    for (let t = 0; t < 4; t += dt) {
      const n = w.particles.length
      x = 500 * Math.sin(t * Math.PI / 2) * Math.sin(t * Math.PI / 2) * (t < 2 ? 1 : -1)
      y = 40 * Math.sin(t * Math.PI)
      S.setSurfaces(w, [at(TERM, x, y)], w.time, [TERM.id])
      S.step(w, dt)
      most = Math.max(most, w.particles.length - n)
      for (const p of w.particles) {
        assert.ok(isFinite(p.x) && isFinite(p.y) && isFinite(p.vx) && isFinite(p.vy), "no NaN")
        if (p.kind === "clump" || p.kind === "powder") fastest = Math.max(fastest, Math.hypot(p.vx, p.vy))
      }
    }
    assert.ok(ledge(w) > had * 0.85, `most of it rode along: ${ledge(w)} of ${had}`)
    assert.ok(most <= S.SNOW.shedBudget + 6, `at most ${most} new pieces in one frame`)
    assert.ok(fastest < S.SNOW.shedMax + 300, `fastest piece ${fastest} px/s`)
  } finally { Math.random = rnd }
})

test("a slow drag sheds nothing more than standing still does", () => {
  const shed = drag => {
    const w = scene(60)
    S.setEnv(w, { snowScale: 0 }); w.particles = []
    const had = ledge(w)
    for (let t = 0; t < 3; t += dt) {
      S.setSurfaces(w, [at(TERM, drag ? 300 * (1 - Math.cos(t * Math.PI / 3)) / 2 : 0)], w.time, [TERM.id])
      S.step(w, dt)
    }
    assert.ok(ledge(w) > had * 0.98, `kept ${ledge(w)} of ${had}`)
    return w.particles.filter(p => p.kind === "clump").reduce((t, p) => t + p.amount, 0)
  }
  // A full ledge pours a little over its ends on its own either way.
  const still = shed(false), dragged = shed(true)
  assert.ok(dragged <= still + 12, `dragged ${dragged}, still ${still}`)
})

test("window wind eases in and out: no step in the air when a window starts or stops", () => {
  const w = S.createWorld(W, H, { effect: "snow", plow: false })
  const r = { id: "a", x: 200, y: 400, w: 300, h: 200, floating: true, z: 0 }
  S.setSurfaces(w, [r], 0)
  let x = r.x, prev = 0, worst = 0, peak = 0
  for (let t = 0; t < 2; t += dt) {
    if (t < 1) x += 1200 * dt
    S.setSurfaces(w, [Object.assign({}, r, { x })], w.time)
    S.step(w, dt)
    const e = w.gusts.a
    const v = e ? e.vx : 0
    worst = Math.max(worst, Math.abs(v - prev))
    peak = Math.max(peak, Math.abs(v))
    prev = v
  }
  assert.ok(peak > 400, `it blows: ${peak}`)
  assert.ok(worst < peak * 0.06, `largest change in a frame ${worst} of ${peak}`)
})

test("a long frame after a suspend, NaN and junk rectangles change nothing", () => {
  const w = scene(30)
  const had = ledge(w)
  S.step(w, 3600)
  S.step(w, NaN)
  S.setSurfaces(w, [TERM, { id: "junk", x: NaN, y: 0, w: 100, h: 100 }, { id: "tiny", x: 0, y: 0, w: 2, h: 2 }], w.time, [TERM.id])
  S.step(w, dt)
  assert.ok(ledge(w) > had * 0.98)
  assert.strictEqual(w.surfaces.junk, undefined)
  assert.ok(w.particles.every(p => isFinite(p.x) && isFinite(p.y)))
  assert.ok(w.time < 31, "the long frame counted as one: " + w.time)
})

test("the event queue never grows without bound", () => {
  const w = S.createWorld(800, 600, {})
  for (let i = 0; i < 500; i++) { S.spawnGolden(w); S.catchGolden(w) }
  assert.ok(w.events.length <= 32)
})

test("snowmen ride a window by its address; junk addresses are dropped", () => {
  const p = Store.normalizePlace({ screen: "DP-1", windowAddress: "0x55D1C0A3E2F0", windowClass: "Alacritty", windowFx: 0.3 })
  assert.strictEqual(p.windowAddress, "0x55d1c0a3e2f0")
  assert.strictEqual(Store.normalizePlace({ windowAddress: "rm -rf" }).windowAddress, "")
  assert.strictEqual(Store.normalizePlace({}).windowAddress, "")
})

test("surprises come within a minute or two: a bird on a bare ledge, a hare on bare ground", () => {
  const w = S.createWorld(W, H, { plow: false })
  S.setSurfaces(w, [TERM], 0)
  assert.ok(S.spawnBird(w, { surface: TERM.id }))
  assert.ok(S.spawnRabbit(w))
  for (let t = 0; t < 4; t += dt) { S.setSurfaces(w, [TERM], w.time); S.step(w, dt) }
  assert.strictEqual(w.bird.mode, "perch")
  assert.ok(w.rabbit && isFinite(w.rabbit.x) && isFinite(w.rabbit.y))
})

test("drawing: falling snow, shed clumps and rain are all painted behind windows, never over their content", { skip: !createCanvas && "needs @napi-rs/canvas" }, () => {
  const D = load("lib/draw.js")
  const r = { id: "0x1", x: 200, y: 150, w: 400, h: 300, floating: true, z: 0 }
  const face = (kinds) => {
    const w = S.createWorld(800, 600, { effect: "snow", intensity: 2, plow: false })
    // Frost and icicles are ice on the window, not snow: switched off here.
    S.setFeatures(w, { icicles: false })
    for (let t = 0; t < 20; t += dt) { S.setSurfaces(w, [r], w.time); S.step(w, dt) }
    // Put particles right in front of the window's face.
    w.particles = []
    for (let i = 0; i < 200; i++) w.particles.push({ kind: kinds[i % kinds.length], x: 220 + Math.random() * 360, y: 200 + Math.random() * 200,
      vx: 0, vy: 400, r: 2, len: 12, depth: 0.9, amount: 0.5, pack: 0.5, angle: 0, spin: 0, life: 10, age: 0, rest: null })
    const c = createCanvas(800, 600), ctx = c.getContext("2d")
    D.world(ctx, w)
    const px = ctx.getImageData(r.x + 4, r.y + 8, r.w - 8, r.h - 40).data
    let painted = 0
    for (let i = 3; i < px.length; i += 4) if (px[i] > 8) painted++
    return painted
  }
  // Since the window-attachment fix (2026-11-25) nothing in the air is
  // painted over a window's content: flakes and shed clumps fall behind
  // windows, as rain always did (draw.js world, drawHeaps clears faces).
  assert.strictEqual(face(["flake", "clump", "powder"]), 0, "snow over the window's face")
  assert.strictEqual(face(["drop"]), 0, "rain over the window's face")
})
