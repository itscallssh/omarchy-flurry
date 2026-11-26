const test = require("node:test")
const assert = require("node:assert")
const S = require("./load")("lib/sim.js")

function run(world, seconds, rects, pointer) {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    if (rects) S.setSurfaces(world, rects, world.time)
    S.step(world, dt, { pointer })
  }
}

test("snow piles up on an exposed window top and the ground", () => {
  const w = S.createWorld(1200, 800, { effect: "snow", intensity: 2 })
  const rects = [{ id: "a", x: 200, y: 300, w: 600, h: 400, floating: false, z: 0 }]
  run(w, 40, rects)
  const a = w.surfaces.a.bins.reduce((x, y) => x + y, 0)
  const g = w.surfaces.__ground.bins.reduce((x, y) => x + y, 0)
  assert.ok(a > 50, "window collected snow: " + a)
  assert.ok(g > 50, "ground collected snow: " + g)
  assert.ok(Math.max(...w.surfaces.a.bins) <= S.TUNING.snow.cap + 1e-6)
})

// Windows are panes, not roofs (bug 3), and what rests on a window is drawn
// with that window, so a window in front hides it (bug 1). A covered top
// edge therefore keeps collecting, out of sight, from the snowfall that
// passes behind the front window (e858117): when the front window leaves,
// the ledge behind is as deep as the rest of it (recording 11-39-11 @27 s).
// It only gets what goes on past the front window's own ledge, so it is
// never deeper than that ledge.
test("a covered top edge collects only out of sight, behind the front window", () => {
  const w = S.createWorld(1000, 800, { effect: "snow", intensity: 2 })
  const rects = [
    { id: "back", x: 100, y: 300, w: 800, h: 300, floating: false, z: 3 },
    { id: "front", x: 50, y: 200, w: 900, h: 500, floating: true, z: 0 }
  ]
  run(w, 30, rects)
  const back = w.surfaces.back.bins.reduce((x, y) => x + y, 0)
  const front = w.surfaces.front.bins.reduce((x, y) => x + y, 0)
  assert.ok(front > 10, "the front window's ledge fills: " + front)
  assert.ok(back > 10, "the hidden ledge behind fills too: " + back)
  // Per px of ledge it gets no more than the open front ledge does.
  assert.ok(back / 800 < 1.25 * front / 900, back + " behind vs " + front + " in front")
})

// A snowy floating window with the snow switched off, so only the physics
// moves snow around.
function snowyWindow() {
  const w = S.createWorld(1600, 1000, { effect: "snow", intensity: 2 })
  const r = { id: "a", x: 400, y: 400, w: 600, h: 400, floating: true, z: 0 }
  run(w, 40, [r])
  S.setEffect(w, "fireflies")
  return { w, r }
}

// Moves the window along offset(t) -> [dx, dy], sampling every frame as the
// shell does while something is moving.
function move(w, r, seconds, offset) {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    const [dx, dy] = offset(t)
    S.setSurfaces(w, [Object.assign({}, r, { x: r.x + dx, y: r.y + (dy || 0) })], w.time)
    S.step(w, dt)
  }
}

const sum = a => a.reduce((x, y) => x + y, 0)
const onWindow = w => sum(w.surfaces.a.bins) + w.surfaces.a.edges[0].m + w.surfaces.a.edges[1].m

test("a slow, steady drag keeps the snow on the window", () => {
  const { w, r } = snowyWindow()
  const before = onWindow(w)
  // Eases up to 120 px/s and back over two seconds.
  move(w, r, 2.2, t => { const u = Math.min(t / 2, 1); return [240 * u * u * (3 - 2 * u)] })
  assert.ok(onWindow(w) > before * 0.85, `kept ${onWindow(w)} of ${before}`)
})

// Changed with the yank physics: this fling goes from a standstill to
// 2000 px/s in one frame, about 120 g, far past what the snow's grip can
// pass on, so the window is pulled out from under the snow (see
// tests/yank.test.js). It used to ride along and shed gradually.
test("a fling from a standstill is a yank: the ledge comes off at once and falls behind the window", () => {
  const { w, r } = snowyWindow()
  const before = onWindow(w)
  const dt = 1 / 60
  for (let t = 0; t < 0.9; t += dt) {
    S.setSurfaces(w, [Object.assign({}, r, { x: r.x + Math.min(t, 0.35) / 0.35 * 700 })], w.time)
    S.step(w, dt)
  }
  assert.ok(onWindow(w) < before * 0.05, `it came off: kept ${onWindow(w)} of ${before}`)
  const left = w.particles.filter(p => p.kind === "clump" && p.x < w.surfaces.a.x)
  assert.ok(left.length > 0, "snow came off behind the moving window")
})

// What the fling test used to check, at a pull the grip can hold: a brisk
// drag that speeds up at about 1.2 g sheds gradually, a little at a time.
test("a brisk drag within the snow's grip sheds a little at a time, never in a burst", () => {
  const { w, r } = snowyWindow()
  const before = onWindow(w)
  let most = 0
  const dt = 1 / 60
  for (let t = 0; t < 1.2; t += dt) {
    const had = w.particles.length
    const u = Math.min(t, 0.7)
    S.setSurfaces(w, [Object.assign({}, r, { x: r.x + 960 * u * u + (t - u) * 1344 })], w.time)
    S.step(w, dt)
    most = Math.max(most, w.particles.length - had)
  }
  assert.ok(onWindow(w) > before * 0.6, `most of it rode along: kept ${onWindow(w)} of ${before}`)
  assert.ok(most <= S.SNOW.shedBudget + 8, `no burst: at most ${most} new pieces in a frame`)
})

test("a hard stop throws the snow forward", () => {
  const { w, r } = snowyWindow()
  // Glides right at 700 px/s, gently enough to hold on, then stops dead.
  move(w, r, 1.2, t => [t < 0.6 ? 700 * t * t / 1.2 * 2 / 1 : 0].map(x => Math.min(x, 420)))
  const right = w.particles.filter(p => p.kind === "clump" && p.x > w.surfaces.a.x + w.surfaces.a.w)
  assert.ok(right.length > 0, "chunks went over the leading edge")
})

test("a window dropped faster than gravity lifts its snow off over a moment, not in one frame", () => {
  let seed = 17
  const rnd = Math.random
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  try {
    const { w, r } = snowyWindow()
    const before = sum(w.surfaces.a.bins)
    const dt = 1 / 60
    let worst = 0, prev = before
    for (let t = 0; t < 0.5; t += dt) {
      S.setSurfaces(w, [Object.assign({}, r, { y: r.y + 0.5 * 5000 * t * t })], w.time)
      S.step(w, dt)
      const now = sum(w.surfaces.a.bins)
      worst = Math.max(worst, (prev - now) / before)
      prev = now
    }
    assert.ok(sum(w.surfaces.a.bins) < before * 0.5, `most of the snow lifted off: ${sum(w.surfaces.a.bins)} of ${before}`)
    assert.ok(worst < 0.2, `a share at a time: worst frame took ${worst}`)
    assert.ok(w.particles.some(p => p.kind === "clump"))
    assert.ok(w.particles.every(p => Math.hypot(p.vx, p.vy) < 2200), "nothing flies off faster than the window could throw it")
  } finally { Math.random = rnd }
})

test("sliding conserves snow", () => {
  const { w, r } = snowyWindow()
  // Flakes still falling from before the snow stopped count too: they land
  // during the test (leaving them out made it fail now and then).
  // A fresh flake lies on a window at up to TUNING.snow.windowCatch times its
  // volume, so each is counted at that (the most it can add).
  const flake = p => Math.PI * p.r * p.r * S.FLAKE_VOLUME / S.CELL * S.TUNING.snow.windowCatch
  const airborne = () => w.particles.reduce((a, p) => a + (p.kind === "clump" || p.kind === "powder" ? p.amount : (p.kind === "flake" ? flake(p) : 0)), 0)
  const total = () => S.totalSnow(w) + airborne()
  const before = total()
  // Shake without melting: compare over a short window.
  move(w, r, 0.6, t => [40 * Math.sin(t * 30)])
  const after = total()
  // Melting (non-snow effect) and dust that fades take a little.
  assert.ok(after > before * 0.9 && after < before * 1.001, `${after} vs ${before}`)
})

test("piles slump to their angle of repose", () => {
  const w = S.createWorld(800, 600, { effect: "snow" })
  S.setSurfaces(w, [{ id: "a", x: 100, y: 300, w: 400, h: 200 }], 0)
  S.setEffect(w, "fireflies")
  const s = w.surfaces.a
  s.bins[50] = 14
  for (let i = 0; i < 120; i++) S.step(w, 1 / 60)
  let steepest = 0
  for (let i = 0; i + 1 < s.bins.length; i++) steepest = Math.max(steepest, Math.abs(s.bins[i] - s.bins[i + 1]))
  assert.ok(steepest <= S.SNOW.repose[1] * S.CELL + 0.2, "steepest step " + steepest)
  assert.ok(s.bins[49] > 1 && s.bins[51] > 1, "spread to the neighbours")
})

test("a chunk hitting hard breaks up", () => {
  const w = S.createWorld(800, 600, { effect: "fireflies" })
  w.particles.push({ kind: "clump", x: 400, y: 580, vx: 0, vy: 900, r: 3, amount: 4, pack: 0.2, angle: 0, spin: 0, life: 5, age: 0, rest: null })
  for (let i = 0; i < 6; i++) S.step(w, 1 / 60)
  assert.ok(w.particles.some(p => p.kind === "powder" || p.kind === "clump"), "pieces flew")
  assert.ok(S.totalSnow(w) > 2, "most of it stayed")
})

test("snow waits for a window on another workspace", () => {
  const { w, r } = snowyWindow()
  const before = sum(w.surfaces.a.bins)
  const clumps = () => w.particles.filter(p => p.kind === "clump").length
  const had = clumps()
  S.setSurfaces(w, [], w.time, ["a"])
  assert.strictEqual(clumps(), had, "nothing spilled")
  S.setSurfaces(w, [r], w.time, ["a"])
  assert.ok(sum(w.surfaces.a.bins) > before * 0.95)
})

test("resizing from the left keeps the snow where it lies", () => {
  const { w, r } = snowyWindow()
  const s = w.surfaces.a
  for (let i = 0; i < s.bins.length; i++) s.bins[i] = i === 100 ? 9 : 0
  const x = s.x + 100.5 * S.CELL
  S.setSurfaces(w, [Object.assign({}, r, { x: r.x + 80, w: r.w - 80 })], w.time)
  assert.ok(S.restingY(w, "a", x) < r.y - 8, "the heap stayed put on screen")
})

test("closing a window drops its snow", () => {
  const w = S.createWorld(1200, 800, { effect: "snow", intensity: 2 })
  run(w, 20, [{ id: "a", x: 200, y: 300, w: 600, h: 400 }])
  S.setSurfaces(w, [], w.time)
  assert.strictEqual(w.surfaces.a, undefined)
  assert.ok(w.particles.some(p => p.kind === "clump"))
})

test("leaves rest and a fast pointer scatters them", () => {
  const w = S.createWorld(800, 600, { effect: "leaves", intensity: 2 })
  run(w, 40, [])
  const resting = w.particles.filter(p => p.kind === "leaf" && p.rest)
  assert.ok(resting.length > 5, "leaves landed: " + resting.length)
  const leaf = resting[0]
  run(w, 0.05, [], { x: leaf.x, y: leaf.y, vx: 900, vy: 0, present: true, stillFor: 0 })
  assert.strictEqual(leaf.rest, null)
})

test("meteors burst into sparks and rain splashes", () => {
  const w = S.createWorld(800, 600, { effect: "starfall", intensity: 2 })
  run(w, 30, [])
  // Sparks are short-lived, so look for them during a run.
  let sparks = 0
  for (let i = 0; i < 600 && !sparks; i++) { S.step(w, 1 / 60, {}); sparks = w.particles.filter(p => p.kind === "spark").length }
  assert.ok(sparks > 0)
  S.setEffect(w, "rain")
  let splashes = 0
  for (let i = 0; i < 120 && !splashes; i++) { S.step(w, 1 / 60, {}); splashes = w.particles.filter(p => p.kind === "splash").length }
  assert.ok(splashes > 0)
})

test("fireflies gather around a still pointer", () => {
  const w = S.createWorld(1000, 800, { effect: "fireflies", intensity: 1 })
  const ptr = { x: 500, y: 400, vx: 0, vy: 0, present: true, stillFor: 5 }
  run(w, 12, [], ptr)
  const flies = w.particles.filter(p => p.kind === "firefly")
  const near = flies.filter(p => Math.hypot(p.x - 500, p.y - 400) < 160).length
  assert.ok(flies.length >= 10)
  assert.ok(near / flies.length > 0.7, `${near}/${flies.length} near`)
})

test("particle count stays bounded at max intensity", () => {
  const w = S.createWorld(3840, 2160, { effect: "rain", intensity: 2 })
  run(w, 10, [])
  assert.ok(w.particles.length <= S.maxParticles(w) * 1.6)
})

test("snow melts after switching effect", () => {
  const w = S.createWorld(800, 600, { effect: "snow", intensity: 2 })
  run(w, 20, [{ id: "a", x: 100, y: 200, w: 500, h: 300 }])
  const before = S.totalSnow(w)
  S.setEffect(w, "sakura")
  run(w, 60, [{ id: "a", x: 100, y: 200, w: 500, h: 300 }])
  assert.ok(S.totalSnow(w) < before * 0.2)
})

// ------------------------------------------------------------------ the plow

// The plow's own mechanics, without its hare and robin coming first
// (arrival: false; the sequence is tested in arrival.test.js).
function snowyGround(fill) {
  const w = S.createWorld(1280, 720, { effect: "snow", intensity: 0.25, arrival: false })
  const g = w.surfaces[S.GROUND_ID]
  for (let i = 0; i < g.bins.length; i++) g.bins[i] = S.TUNING.snow.groundCap * fill * (0.8 + 0.4 * ((i * 7) % 10) / 10)
  return w
}

test("the plow stays home while the ground is thin", () => {
  const w = snowyGround(0.2)
  run(w, 5)
  assert.equal(w.plow, null)
  assert.equal(w.plowRuns, 0)
})

test("the plow comes out when the ground fills, clears it, and leaves", () => {
  const w = snowyGround(0.6)
  run(w, 1)
  assert.ok(w.plow, "plow is out")
  let maxLoad = 0, sawRoof = false, sawSmoke = false
  for (let t = 0; t < 60 && w.plow; t += 1 / 60) {
    S.step(w, 1 / 60)
    if (w.plow) maxLoad = Math.max(maxLoad, w.plow.load)
    if (w.surfaces.__plow) sawRoof = true
    if (w.particles.some(p => p.kind === "smoke")) sawSmoke = true
  }
  assert.equal(w.plow, null, "plow left the screen")
  assert.ok(maxLoad > 50, "it pushed a berm")
  assert.ok(sawRoof && sawSmoke)
  assert.equal(w.surfaces.__plow, undefined, "its roof went with it")
  // Let what it threw ahead settle, then the ground is clean apart from fresh snow.
  assert.ok(S.groundFill(w) < 0.06, "ground clean: " + S.groundFill(w))
})

test("the plow returns when the snow builds up again", () => {
  const w = snowyGround(0.6)
  for (let t = 0; t < 70 && (w.plowRuns === 0 || w.plow); t += 1 / 60) S.step(w, 1 / 60)
  assert.equal(w.plowRuns, 1)
  const g = w.surfaces[S.GROUND_ID]
  for (let i = 0; i < g.bins.length; i++) g.bins[i] = S.TUNING.snow.groundCap * 0.6
  run(w, 3)
  assert.equal(w.plowRuns, 1, "rests a few seconds first")
  run(w, 5)
  assert.equal(w.plowRuns, 2)
  assert.equal(w.plow.dir, -1, "and comes from the other side")
})

test("the plow keeps away when switched off or another effect is on", () => {
  const w = snowyGround(0.6)
  S.setPlow(w, false)
  run(w, 3)
  assert.equal(w.plow, null)
  const r = snowyGround(0.6)
  S.setEffect(r, "rain")
  run(r, 3)
  assert.equal(r.plow, null)
})

test("windows never lose their snow to the plow", () => {
  const w = snowyGround(0.6)
  const win = { id: "a", x: 300, y: 300, w: 400, h: 200 }
  S.setSurfaces(w, [win], 0)
  w.surfaces.a.bins.fill(5)
  w.surfaces.a.pack = 1
  for (let t = 0; t < 60 && (w.plowRuns === 0 || w.plow); t += 1 / 60) { S.setSurfaces(w, [win], w.time); S.step(w, 1 / 60) }
  assert.ok(sum(w.surfaces.a.bins) > 0.9 * 5 * w.surfaces.a.bins.length)
  assert.ok(!w.surfaces.__plow)
})

// ------------------------------------------------------------------ light strings

function stringWorld(win) {
  const w = S.createWorld(1280, 720, { effect: "snow", intensity: 0.25, plow: false })
  S.setSurfaces(w, [win], 0)
  return w
}
function runStrings(w, seconds, rect, spec) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = typeof rect === "function" ? rect(t) : rect
    S.setSurfaces(w, [r], w.time); S.setStrings(w, spec(r)); S.step(w, 1 / 60)
  }
}
const spec = r => [{ id: "s:" + r.id, surface: r.id, palette: "multi" }]

test("a light string hangs in even swags between clips on the window's top", () => {
  const win = { id: "t", x: 200, y: 150, w: 600, h: 300 }
  const w = stringWorld(win)
  runStrings(w, 4, win, spec)
  const L = w.strings["s:t"]
  assert.equal(L.n, 4)
  const m = 10
  for (let j = 0; j < L.n; j++) {
    const clip = L.pts[j * m], mid = L.pts[j * m + m / 2]
    assert.ok(Math.abs(clip.y - (win.y + 2)) < 0.01, "clip on the edge")
    const sag = mid.y - clip.y
    assert.ok(sag > 15 && sag < 40, "sag " + sag)
  }
  assert.ok(L.bulbs.length >= 18)
  for (const b of L.bulbs) assert.ok(Math.abs(b.theta) < 0.05, "bulbs hang straight at rest")
})

test("dragging the window swings the lights, and they settle", () => {
  const win = { id: "t", x: 200, y: 150, w: 600, h: 300 }
  const w = stringWorld(win)
  runStrings(w, 3, win, spec)
  const L = w.strings["s:t"]
  const restSag = L.pts[5].y - L.pts[0].y
  // Fling right 300 px in 0.2 s, then stop.
  let maxTilt = 0, minSag = restSag
  runStrings(w, 0.6, t => Object.assign({}, win, { x: win.x + Math.min(300, 1500 * t) }), r => {
    const S2 = w.strings["s:t"]
    if (S2) { maxTilt = Math.max(maxTilt, ...S2.bulbs.map(b => Math.abs(b.theta))); minSag = Math.min(minSag, S2.pts[5].y - S2.pts[0].y) }
    return spec(r)
  })
  assert.ok(maxTilt > 0.25, "bulbs swing: " + maxTilt)
  const moved = Object.assign({}, win, { x: win.x + 300 })
  runStrings(w, 6, moved, spec)
  const L2 = w.strings["s:t"]
  assert.ok(Math.abs(L2.pts[0].x - (moved.x + 10)) < 0.01, "clips follow the window")
  assert.ok(Math.abs((L2.pts[5].y - L2.pts[0].y) - restSag) < 1.5, "settles back to its sag")
  for (const b of L2.bulbs) assert.ok(Math.abs(b.theta) < 0.05)
})

test("resizing re-spaces the clips and changes their count only when needed", () => {
  const win = { id: "t", x: 100, y: 100, w: 600, h: 300 }
  const w = stringWorld(win)
  runStrings(w, 1, win, spec)
  const phase = w.strings["s:t"].bulbs[0].phase
  runStrings(w, 1, Object.assign({}, win, { w: 700 }), spec)
  assert.equal(w.strings["s:t"].n, 4, "same clips, wider swags")
  runStrings(w, 1, Object.assign({}, win, { w: 1100 }), spec)
  const L = w.strings["s:t"]
  assert.equal(L.n, 7, "re-hung with more clips")
  assert.equal(L.bulbs[0].phase, phase, "bulbs keep their twinkle")
  const last = L.pts[L.pts.length - 1]
  assert.ok(Math.abs(last.x - (100 + 1100 - 10)) < 0.01)
})

test("a string comes down with its window, and never rises above the top edge", () => {
  const win = { id: "t", x: 100, y: 300, w: 500, h: 200 }
  const w = stringWorld(win)
  // Yank the window down fast: the wire may lag, but stays on the window.
  for (let t = 0; t < 0.5; t += 1 / 60) {
    const r = Object.assign({}, win, { y: win.y + Math.min(250, 2500 * t) })
    S.setSurfaces(w, [r], w.time); S.setStrings(w, spec(r)); S.step(w, 1 / 60)
    for (const p of w.strings["s:t"].pts) assert.ok(p.y >= r.y + 0.99)
  }
  S.setSurfaces(w, [], w.time); S.setStrings(w, [])
  assert.deepEqual(Object.keys(w.strings), [])
})

test("surfaceAt finds the front window under a point", () => {
  const w = S.createWorld(1280, 720, {})
  S.setSurfaces(w, [{ id: "back", x: 100, y: 100, w: 400, h: 300, z: 2 }, { id: "front", x: 300, y: 200, w: 400, h: 300, z: 1 }], 0)
  assert.equal(S.surfaceAt(w, 350, 250), "front")
  assert.equal(S.surfaceAt(w, 150, 150), "back")
  assert.equal(S.surfaceAt(w, 900, 600), null)
})

test("rain gathers on a window top and pours off both ends, clear of the window, then drains", () => {
  const w = S.createWorld(1400, 900, { effect: "rain", intensity: 1.5, groundInset: 0 })
  const rects = [{ id: "a", x: 300, y: 300, w: 600, h: 300, floating: false, z: 0 }]
  for (let t = 0; t < 20; t += 1 / 60) { S.setSurfaces(w, rects, w.time); S.step(w, 1 / 60, {}) }
  const a = w.surfaces.a
  assert.ok(a.water > 5, `film ${a.water}`)
  assert.ok(a.pourGeo && a.pourGeo[0] && a.pourGeo[1], "a stream off each end")
  assert.ok(a.pourGeo[0].x0 < 300 && a.pourGeo[1].x0 > 900, "the streams start outside the window")
  const drips = w.particles.filter(p => p.kind === "drip")
  assert.ok(drips.length > 0, "the streams break into drops")
  assert.ok(drips.every(p => p.x < 300 || p.x > 900 || p.y > 600), "no drop falls over the window")
  assert.ok(w.wet > 0.5, "storm light")
  S.setEffect(w, "snow")
  for (let t = 0; t < 30; t += 1 / 60) { S.setSurfaces(w, rects, w.time); S.step(w, 1 / 60, {}) }
  assert.ok(!a.pour && !a.water, "dry again")
})

test("a dry window top soaks up the first rain: water starts running off only after a while and builds up", () => {
  const w = S.createWorld(1920, 1080, { effect: "rain", intensity: 1, groundInset: 0 })
  const rects = [{ id: "a", x: 500, y: 300, w: 900, h: 400, floating: false, z: 0 }]
  const flow = () => { const a = w.surfaces.a; return a.pour ? a.pour[0] + a.pour[1] : 0 }
  const at = {}
  for (let t = 0; t < 20; t += 1 / 60) {
    S.setSurfaces(w, rects, w.time); S.step(w, 1 / 60, {})
    for (const s of [3, 8, 18]) if (at[s] === undefined && t >= s) at[s] = flow()
  }
  assert.ok(!(w.surfaces.a.pourGeo && at[3] > 1), `nothing pours at first (${at[3]})`)
  assert.ok(at[8] > at[3] && at[18] > 2 * at[8], `it builds up: ${at[3]} ${at[8]} ${at[18]}`)
  // A window opened later in the rain starts dry too.
  rects.push({ id: "b", x: 100, y: 800, w: 300, h: 200, floating: false, z: 1 })
  for (let t = 0; t < 2; t += 1 / 60) { S.setSurfaces(w, rects, w.time); S.step(w, 1 / 60, {}) }
  const b = w.surfaces.b
  assert.ok(!b.pour || b.pour[0] + b.pour[1] < 0.5, "a new window does not pour at once")
})

test("a stream that falls onto a window below waters it in turn", () => {
  const w = S.createWorld(1400, 900, { effect: "rain", intensity: 1.5, groundInset: 0 })
  const rects = [{ id: "a", x: 300, y: 300, w: 400, h: 200, floating: false, z: 0 },
                 { id: "b", x: 690, y: 360, w: 400, h: 300, floating: false, z: 1 }]
  for (let t = 0; t < 20; t += 1 / 60) { S.setSurfaces(w, rects, w.time); S.step(w, 1 / 60, {}) }
  const g = w.surfaces.a.pourGeo[1]
  assert.ok(g && g.reaches && g.len < 80, "the right-hand stream lands on b")
})

test("lightning forks", () => {
  const w = S.createWorld(1400, 900, { effect: "rain", groundInset: 0 })
  let forks = 0
  for (let i = 0; i < 20; i++) forks += S.makeBolt(w).branches.length
  assert.ok(forks > 0)
})
