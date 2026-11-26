// The snow globe shake, wind from windows, writing in the snow, icicles,
// the night glaze, melting, spring, fireworks, the bird, the cat, the golden
// snowflake, snowballs thrown to friends, and the state behind them.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const S = load("lib/sim.js")
const Store = load("lib/store.js")

const dt = 1 / 60
const sum = a => a.reduce((x, y) => x + y, 0)
function run(w, secs, rects, input) {
  for (let t = 0; t < secs - 1e-9; t += dt) {
    if (rects) S.setSurfaces(w, rects, w.time)
    S.step(w, dt, input ? input(t) : undefined)
  }
}
// A window and the ground with settled snow, the sky switched off.
function snowy(opts) {
  const w = S.createWorld(1600, 1000, Object.assign({ effect: "snow", intensity: 2, plow: false }, opts || {}))
  const r = { id: "a", x: 400, y: 400, w: 600, h: 300, floating: true, z: 0 }
  run(w, 30, [r])
  const g = w.surfaces.__ground
  g.bins = g.bins.map((v, i) => 14 + 2 * Math.sin(i * 0.1))
  S.setEnv(w, { snowScale: 0 })
  w.particles = []
  return { w, r }
}
const lying = w => Object.values(w.surfaces).reduce((t, s) => t + sum(s.bins) + s.edges[0].m + s.edges[1].m, 0)
const inAir = w => w.particles.reduce((t, p) => t + (p.kind === "flake" && p.amount ? p.amount : 0) + (p.kind === "powder" ? p.amount : 0)
                                      + (p.kind === "clump" ? p.amount : 0), 0)

// ------------------------------------------------------------- shake

test("shake lifts the lying snow into the air as flakes, without losing it", () => {
  const { w, r } = snowy()
  const before = lying(w)
  const onWindow = sum(w.surfaces.a.bins)
  const lifted = S.shake(w, 1)
  assert.ok(lifted > before * 0.5, `lifted ${lifted} of ${before}`)
  assert.ok(sum(w.surfaces.a.bins) < onWindow * 0.25, "the window is mostly bare")
  assert.ok(sum(w.surfaces.__ground.bins) > 0, "the bottom of the drift stays")
  const total = lying(w) + inAir(w)
  assert.ok(Math.abs(total - before) / before < 0.02, `conserved: ${total} vs ${before}`)
  // The surge carries it up first.
  run(w, 0.3, [r])
  const flakes = w.particles.filter(p => p.kind === "flake" && p.amount)
  const risen = flakes.filter(p => p.vy < -50).length
  assert.ok(risen > flakes.length * 0.5, `${risen} of ${flakes.length} rising`)
  assert.ok(Math.min(...flakes.map(p => p.y)) < 600, "high above where it lay")
})

test("after a shake the snow swirls, then settles back on the window and the ground", () => {
  const { w, r } = snowy()
  const before = lying(w)
  S.shake(w, 1)
  run(w, 2, [r])
  // Eddies: flakes moving sideways both ways at once.
  const vx = w.particles.filter(p => p.kind === "flake").map(p => p.vx)
  assert.ok(vx.some(v => v > 40) && vx.some(v => v < -40), "turning over")
  run(w, 40, [r])
  assert.strictEqual(w.shake, null, "the swirl has died down")
  const back = lying(w)
  assert.ok(back > before * 0.7, `settled again: ${back} of ${before}`)
  assert.ok(sum(w.surfaces.a.bins) > 30, "some lands on the window again")
})

test("shake knocks snowballs and resting petals loose", () => {
  const { w, r } = snowy()
  const b = S.makeBall(w, 700, 400 - 20, Math.PI * 12 * 12, 0.8)
  w.balls.push(b)
  run(w, 0.5, [r])
  S.shake(w, 1)
  assert.ok(b.vy < -100, "the ball hops")
})

// ------------------------------------------------------------- wind from windows

function gustScene(speed, gusts) {
  const w = S.createWorld(1600, 1000, { effect: "snow", intensity: 1, plow: false, gusts })
  S.setEnv(w, { snowScale: 0, windVar: 0 })
  const r = { id: "a", x: 300, y: 400, w: 300, h: 200, floating: true, z: 0 }
  S.setSurfaces(w, [r], 0)
  // A column of flakes hanging just right of the window, still air.
  for (let i = 0; i < 40; i++) w.particles.push({ kind: "flake", x: 640, y: 380 + i * 6, vx: 0, vy: 40, r: 1.5, depth: 0.5, vt: 40,
                                                  phase: 0, freq: 1, sway: 0, life: 100, age: 0, rest: null })
  let x = r.x
  for (let t = 0; t < 0.35; t += dt) {
    x += speed * dt
    S.setSurfaces(w, [Object.assign({}, r, { x })], w.time)
    S.step(w, dt)
  }
  return w
}
const meanVx = w => { const f = w.particles.filter(p => p.kind === "flake"); return sum(f.map(p => p.vx)) / f.length }

test("a window moving fast pushes the air: nearby flakes are carried along", () => {
  const fast = gustScene(900, true)
  const slow = gustScene(80, true)
  const off = gustScene(900, false)
  assert.ok(meanVx(fast) > 150, `pushed: ${meanVx(fast)}`)
  assert.ok(Math.abs(meanVx(slow)) < 30, `a slow drag stirs little: ${meanVx(slow)}`)
  assert.ok(Math.abs(meanVx(off)) < 30, `switched off: ${meanVx(off)}`)
})

test("gusts fall off with distance and linger a moment after the window stops", () => {
  const w = S.createWorld(1600, 1000, { effect: "snow", plow: false })
  const r = { id: "a", x: 300, y: 400, w: 300, h: 200, floating: true, z: 0 }
  S.setSurfaces(w, [r], 0)
  let x = r.x
  for (let t = 0; t < 0.4; t += dt) { x += 1000 * dt; S.setSurfaces(w, [Object.assign({}, r, { x })], w.time); S.step(w, dt) }
  const e = w.gustList[0]
  assert.ok(S.gustAt(w, e.x + e.w + 10, 500))
  const near = w.gx
  assert.ok(S.gustAt(w, e.x + e.w + 200, 500))
  const far = w.gx
  assert.ok(near > far * 4 && far > 0, `${near} vs ${far}`)
  assert.ok(!S.gustAt(w, e.x + e.w + 900, 500), "out of reach")
  // Stopped: the air coasts on, then settles.
  for (let t = 0; t < 0.2; t += dt) { S.setSurfaces(w, [Object.assign({}, r, { x })], w.time); S.step(w, dt) }
  assert.ok(w.gustList.length === 1, "still moving air")
  for (let t = 0; t < 3; t += dt) { S.setSurfaces(w, [Object.assign({}, r, { x })], w.time); S.step(w, dt) }
  assert.strictEqual(w.gustList.length, 0)
})

test("a fast window blows loose powder up off the ground snow beneath it", () => {
  const w = S.createWorld(1600, 1000, { effect: "snow", plow: false })
  S.setEnv(w, { snowScale: 0 })
  const g = w.surfaces.__ground
  g.bins = g.bins.map(() => 12)
  g.pack = 0.1
  const r = { id: "a", x: 200, y: 880, w: 300, h: 100, floating: true, z: 0 }
  S.setSurfaces(w, [r], 0)
  const before = sum(g.bins)
  let x = r.x
  // The air eases in, so it takes a moment to get going.
  let puffs = false
  for (let t = 0; t < 1.0; t += dt) {
    x += 1500 * dt; S.setSurfaces(w, [Object.assign({}, r, { x })], w.time); S.step(w, dt)
    puffs = puffs || w.particles.some(p => p.kind === "powder")
  }
  assert.ok(puffs, "powder in the air")
  assert.ok(sum(g.bins) < before, "taken from the ground")
})

// ------------------------------------------------------------- writing

test("writing presses a groove into the snow; new snow fills it in", () => {
  const { w, r } = snowy()
  const g = w.surfaces.__ground
  const y = 1000 - 7
  // Well clear of the window, whose full ledge pours over its edges.
  assert.ok(S.writeStart(w, 100, y))
  for (let x = 100; x <= 220; x += 3) S.writeTo(w, x, y + Math.sin(x * 0.1) * 3)
  S.writeEnd(w)
  assert.ok(g.marks.length > 60, `points: ${g.marks.length}`)
  assert.ok(g.marks.every(m => m.t === 0 && m.a === 1))
  // Nothing falls: it stays crisp.
  run(w, 5, [r])
  assert.ok(g.marks.length > 60 && g.marks.every(m => m.a === 1))
  // Fresh snow on it: the groove fades a little with every flake, and goes.
  S.setEnv(w, { snowScale: 1 })
  run(w, 50, [r])
  const left = g.marks.length ? sum(g.marks.map(m => m.a)) / 124 : 0
  assert.ok(left < 0.85, `fading: ${left}`)
  w.intensity = 2
  run(w, 90, [r])
  assert.ok(!g.marks || g.marks.length < 15, `filled in: ${g.marks ? g.marks.length : 0}`)
})

test("writing along the top cuts a notch with a raised rim, and needs snow to write in", () => {
  const { w } = snowy()
  const g = w.surfaces.__ground
  const c = Math.floor(500 / 4)
  const before = g.bins.slice(c - 2, c + 3)
  const top = 1000 - g.bins[c]
  assert.ok(S.writeStart(w, 502, top + 1))
  S.writeTo(w, 503, top + 1)
  S.writeEnd(w)
  assert.ok(g.bins[c] < before[2], "notched")
  assert.ok(g.bins[c - 1] > before[1] || g.bins[c + 1] > before[3], "rim")
  // Bare desktop: nothing to write in.
  assert.ok(!S.writeStart(w, 800, 200))
  assert.strictEqual(w.pen, null)
})

test("marks go where the snow under them goes", () => {
  const { w, r } = snowy()
  const g = w.surfaces.__ground
  S.writeStart(w, 600, 1000 - 4); S.writeTo(w, 650, 1000 - 4); S.writeEnd(w)
  const n = g.marks.length
  for (let i = 140; i <= 170; i++) g.bins[i] = 1
  run(w, 0.2, [r])
  assert.ok(g.marks.length < n * 0.6, `${g.marks.length} of ${n}`)
})

// ------------------------------------------------------------- icicles

test("icicles grow on a snowy window's bottom edge within a minute or two, and only while it holds snow", () => {
  const ic = { len: 0, max: 20 }
  S.growIcicle(ic, 60, 1)
  assert.ok(ic.len > 5 && ic.len < 14, `a minute: ${ic.len}`)
  S.growIcicle(ic, 600, 1)
  assert.ok(ic.len > 19 && ic.len <= 20, `ten minutes: ${ic.len}`)
  // A cold night still grows them, a little slower.
  const night = { len: 0, max: 20 }
  S.growIcicle(night, 120, S.neutralEnv().icicle)
  assert.ok(night.len > 4, `a cold night: ${night.len}`)

  const { w, r } = snowy()
  S.setEnv(w, { snowScale: 0, icicle: 1, tempC: -2 })
  run(w, 1, [r])
  const s = w.surfaces.a
  assert.ok(s.icicles && s.icicles.length >= 5, "seeded along the edge")
  assert.ok(s.icicles.every(i => i.ox > 0 && i.ox < r.w))
  for (let k = 0; k < 2400; k++) S.step(w, 0.05)   // two minutes
  const long = s.icicles.filter(i => i.len > 3).length
  assert.ok(long >= 3, `grown: ${long}`)
  // A bare window grows none.
  const bare = S.createWorld(1600, 1000, { plow: false })
  S.setEnv(bare, { snowScale: 0, icicle: 1 })
  run(bare, 2, [r])
  assert.ok(!bare.surfaces.a.icicles)
})

test("icicles drip one drop at a time in the thaw, and shrink in the warmth", () => {
  const { w, r } = snowy()
  const s = w.surfaces.a
  s.icicles = S.seedIcicles(s)
  s.icicles.forEach(i => { i.len = i.max })
  S.setEnv(w, { snowScale: 0, drip: 1, tempC: 0.5 })
  let drops = 0
  for (let t = 0; t < 20; t += dt) {
    S.setSurfaces(w, [r], w.time); S.step(w, dt)
    drops = Math.max(drops, w.particles.filter(p => p.kind === "drip").length)
  }
  assert.ok(drops >= 1, "it drips")
  assert.ok(drops <= s.icicles.length, "single drops, not a stream")
  // Drops start at the tips.
  const lens = s.icicles.map(i => i.len)
  S.setEnv(w, { snowScale: 0, tempC: 8, melt: 0.0005 })
  run(w, 60, [r])
  assert.ok(s.icicles.every((i, k) => i.len < lens[k]), "melting")
  S.setEnv(w, { drip: 0, tempC: -5 })
  w.particles = []
  run(w, 10, [r])
  assert.strictEqual(w.particles.filter(p => p.kind === "drip").length, 0, "frozen: no drips")
})

test("a jolt snaps the icicles off, long ones first, and they fall and shatter", () => {
  const { w, r } = snowy()
  const s = w.surfaces.a
  s.icicles = S.seedIcicles(s)
  s.icicles.forEach((i, k) => { i.len = k % 2 ? 24 : 4 })
  S.setEnv(w, { snowScale: 0, tempC: -3 })
  // A gentle drag keeps them.
  let x = r.x
  for (let t = 0; t < 1; t += dt) { x += 60 * dt; S.setSurfaces(w, [Object.assign({}, r, { x })], w.time); S.step(w, dt) }
  assert.ok(s.icicles.filter(i => i.len > 20).length >= 3, "a gentle drag keeps them")
  // A fling snaps the long ones.
  for (let t = 0; t < 0.25; t += dt) { x += 1800 * dt; S.setSurfaces(w, [Object.assign({}, r, { x })], w.time); S.step(w, dt) }
  const shards = w.particles.filter(p => p.kind === "shard").length
  assert.ok(shards >= 3, `snapped: ${shards}`)
  assert.ok(s.icicles.filter(i => i.len > 20).length === 0)
  run(w, 3, [Object.assign({}, r, { x })])
  assert.strictEqual(w.particles.filter(p => p.kind === "shard").length, 0, "shattered on landing")
})

test("closing a window drops its icicles; a hidden window keeps them", () => {
  const { w, r } = snowy()
  const s = w.surfaces.a
  s.icicles = S.seedIcicles(s)
  s.icicles.forEach(i => { i.len = 15 })
  S.setSurfaces(w, [], w.time, ["a"])
  assert.ok(w.stash.a && w.stash.a.icicles.length)
  S.setSurfaces(w, [r], w.time)
  assert.ok(w.surfaces.a.icicles.every(i => i.len === 15), "back with it")
  S.setSurfaces(w, [], w.time)
  assert.ok(w.particles.filter(p => p.kind === "shard").length >= 3, "closed: they fall")
})

// ------------------------------------------------------------- day and night

test("the night glaze builds slowly, holds snow down, and fresh snow covers it", () => {
  const { w, r } = snowy()
  S.setEnv(w, { snowScale: 0, freeze: 1 })
  for (let k = 0; k < 24000; k++) S.step(w, 0.05)   // twenty minutes
  const glaze = w.surfaces.a.glaze
  assert.ok(glaze > 0.5, `glazed: ${glaze}`)
  S.setEnv(w, { snowScale: 2, freeze: 1 })
  run(w, 20, [r])
  assert.ok(w.surfaces.a.glaze < glaze, "covered by fresh snow")
})

test("warm afternoons melt the lying snow slowly; cold ones keep it", () => {
  const cold = snowy().w, warm = snowy().w
  S.setEnv(cold, { snowScale: 0, melt: 0 })
  S.setEnv(warm, { snowScale: 0, melt: 1 / 1800 })
  // The window's snow (the ground has its own slow melt to stop endless piles).
  const onWin = w => sum(w.surfaces.a.bins)
  const a = onWin(cold), b = onWin(warm)
  for (let k = 0; k < 12000; k++) { S.step(cold, 0.05); S.step(warm, 0.05) }   // ten minutes
  assert.ok(onWin(warm) < b * 0.85, `melted: ${onWin(warm)} of ${b}`)
  assert.ok(onWin(cold) > a * 0.95, `kept: ${onWin(cold)} of ${a}`)
})

// ------------------------------------------------------------- spring

test("spring: no flakes, petals drift down instead, sprouts come up through thin snow", () => {
  const w = S.createWorld(1600, 1000, { effect: "snow", intensity: 1, plow: false })
  S.setEnv(w, { snowScale: 0, petals: 1, sprouts: 1, spring: 1 })
  const g = w.surfaces.__ground
  g.bins = g.bins.map((v, i) => i < 200 ? 20 : 0)
  run(w, 50, [])
  assert.strictEqual(w.particles.filter(p => p.kind === "flake").length, 0)
  assert.ok(w.particles.filter(p => p.kind === "petal" && p.blossom).length > 5)
  const up = w.sprouts.filter(s => s.g > 0.8)
  assert.ok(up.length > 10, `sprouts: ${up.length}`)
  assert.ok(up.every(s => s.x > 200 * 4 - 20), "not through deep snow")
  // Back to winter: they wither away.
  S.setEnv(w, { sprouts: 0 })
  run(w, 100, [])
  assert.strictEqual(w.sprouts, null)
})

// ------------------------------------------------------------- fireworks

test("fireworks: shells rise, burst into embers near the top, and the show ends", () => {
  const w = S.createWorld(1600, 1000, { effect: "snow", plow: false })
  S.setEnv(w, { snowScale: 0 })
  S.startFireworks(w, 12)
  let rockets = 0, embers = 0, highest = 1000
  for (let t = 0; t < 12; t += dt) {
    S.step(w, dt)
    for (const p of w.particles) {
      if (p.kind === "rocket") { rockets++; highest = Math.min(highest, p.y) }
      if (p.kind === "ember" && !p.flash) embers++
    }
  }
  assert.ok(rockets > 0 && embers > 0)
  assert.ok(highest < 1000 * 0.7, "they climb well up")
  assert.strictEqual(w.fw, null)
  run(w, 5, [])
  assert.strictEqual(w.particles.filter(p => p.kind === "ember" || p.kind === "rocket").length, 0, "all burnt out")
  S.countdownTick(w, 3)
  assert.strictEqual(w.particles.filter(p => p.kind === "tick").length, 1)
})

// ------------------------------------------------------------- the bird, the cat, the golden flake

test("a bird lands on a snowy ledge, leaves footprints, and flies off when the pointer comes near", () => {
  const { w, r } = snowy()
  assert.ok(S.spawnBird(w, { surface: "a" }))
  run(w, 3, [r])
  assert.strictEqual(w.bird.mode, "perch")
  const s = w.surfaces.a
  assert.ok(s.marks && s.marks.some(m => m.t === 2), "footprints")
  const B = w.bird
  run(w, 0.2, [r], () => ({ pointer: { x: B.x + 30, y: B.y - 10, vx: 0, vy: 0, present: true } }))
  assert.strictEqual(w.bird.mode, "out")
  run(w, 4, [r])
  assert.strictEqual(w.bird, null, "gone")
})

test("a perched bird flies off when its window moves; a bare ledge will do, with no window the ground", () => {
  const { w, r } = snowy()
  S.spawnBird(w, { surface: "a" })
  run(w, 3, [r])
  let x = r.x
  for (let t = 0; t < 0.3; t += dt) { x += 300 * dt; S.setSurfaces(w, [Object.assign({}, r, { x })], w.time); S.step(w, dt) }
  assert.strictEqual(w.bird.mode, "out")
  const bare = S.createWorld(1600, 1000, { plow: false })
  S.setSurfaces(bare, [r], 0)
  assert.ok(S.spawnBird(bare, { surface: "a" }), "a bare window top is a perch too")
  const none = S.createWorld(1600, 1000, { plow: false })
  assert.ok(S.spawnBird(none), "no window: the ground will do")
  assert.strictEqual(none.bird.s, S.GROUND_ID)
})

test("a hare hops across the ground snow, leaving paired hind and fore prints", () => {
  const { w, r } = snowy()
  assert.ok(S.spawnRabbit(w, { dir: 1 }))
  w.rabbit.stay = 1e9
  run(w, 12, [r])
  const marks = w.surfaces.__ground.marks || []
  const hind = marks.filter(m => m.t === 3).length, fore = marks.filter(m => m.t === 1).length
  assert.ok(hind >= 8 && fore >= 8, `hind ${hind}, fore ${fore}`)
  assert.ok(Math.abs(hind - fore) <= 4, "in pairs")
  assert.ok(w.rabbit && w.rabbit.x > 40, "on its way across")
  // It bolts from the pointer, and is gone soon after.
  const R = w.rabbit
  run(w, 0.1, [r], () => ({ pointer: { x: R.x + 40, y: 1000 - 20, vx: 0, vy: 0, present: true } }))
  assert.strictEqual(w.rabbit.mode, "bolt")
  assert.strictEqual(w.rabbit.dir, -1, "away from the pointer")
  run(w, 8, [r])
  assert.strictEqual(w.rabbit, null, "gone")
  // On bare ground it leaves no prints.
  const bare = S.createWorld(1600, 1000, { plow: false })
  assert.ok(S.spawnRabbit(bare, { coat: "brown" }))
  assert.strictEqual(bare.rabbit.coat, "brown")
  run(bare, 5, [])
  assert.ok(!(bare.surfaces.__ground.marks || []).length, "no prints without snow")
})

test("a hare sits up now and then, ears raised, and bolts when a snowball lands near it", () => {
  // Seeded, so the run is the same alone or in the full suite (it used to
  // draw on whatever Math.random the earlier tests had left it at and
  // could go 40 s without one sit-up); the sim also caps the low stops in
  // a row (RABBIT.maxLowStops), so any seed sits up.
  const rnd = Math.random
  let seed = 20261126
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  try { hareSitsUp() } finally { Math.random = rnd }
})
function hareSitsUp() {
  const { w, r } = snowy()
  S.spawnRabbit(w, { dir: 1 })
  w.rabbit.stay = 1e9
  let sat = 0
  for (let i = 0; i < 40 * 60 && w.rabbit; i++) {
    S.setSurfaces(w, [r], w.time); S.step(w, dt)
    if (w.rabbit && w.rabbit.up > 0.9 && w.rabbit.ears > 0.9) sat++
  }
  assert.ok(sat > 30, `sat up for ${sat} frames`)
  const w2 = snowy().w
  S.spawnRabbit(w2, { dir: 1 })
  run(w2, 3, [r])
  w2.thud = { x: w2.rabbit.x + 60, y: 990, t: w2.time }
  run(w2, 0.05, [r])
  assert.strictEqual(w2.rabbit.mode, "bolt")
}

test("switched off (or calm), visitors leave gracefully: the bird flies, the hare bolts", () => {
  const { w, r } = snowy()
  S.spawnBird(w); S.spawnRabbit(w)
  run(w, 3, [r])
  assert.strictEqual(w.bird.mode, "perch")
  assert.ok(S.dismissCritters(w))
  assert.strictEqual(w.bird.mode, "out")
  assert.strictEqual(w.rabbit.mode, "bolt")
  run(w, 10, [r])
  assert.strictEqual(w.bird, null)
  assert.strictEqual(w.rabbit, null)
})

test("the golden snowflake falls slowly; caught, it tells the shell once", () => {
  const { w, r } = snowy()
  assert.ok(S.spawnGolden(w))
  assert.ok(!S.spawnGolden(w), "one at a time")
  run(w, 4, [r])
  const F = w.golden
  assert.ok(F.y > 30 && F.y < 200, `slow: ${F.y}`)
  assert.ok(S.goldenRect(w).w > 0)
  assert.ok(S.goldenAt(w, F.x + 5, F.y))
  run(w, dt, [r], () => ({ pointer: { x: F.x, y: F.y, vx: 0, vy: 0, present: true } }))
  assert.strictEqual(w.golden, null)
  assert.deepStrictEqual(S.takeEvents(w), [{ type: "golden" }])
  assert.deepStrictEqual(S.takeEvents(w), [])
  assert.ok(w.particles.some(p => p.kind === "spark"))
})

test("golden flake unlocks persist: each unlocks the next finish, saved and reloaded", () => {
  let saved = Store.defaults()
  assert.deepStrictEqual(saved.ornamentStyles, ["glass"])
  assert.strictEqual(Store.unlockNext(saved), "frosted")
  assert.strictEqual(saved.ornamentStyle, "frosted")
  saved = Store.normalize(JSON.parse(JSON.stringify(saved)))
  assert.deepStrictEqual(saved.ornamentStyles, ["glass", "frosted"])
  assert.strictEqual(saved.ornamentStyle, "frosted")
  assert.strictEqual(Store.unlockNext(saved), "pearl")
  assert.strictEqual(Store.nextStyle(saved), "glass")
  while (Store.unlockNext(saved));
  assert.deepStrictEqual(saved.ornamentStyles, Store.ORNAMENT_STYLES)
  assert.strictEqual(Store.unlockNext(saved), "")
  // A hand-edited file can't unlock what wasn't caught, or pick a locked one.
  const evil = Store.normalize({ ornamentStyles: ["gilded", "bogus"], ornamentStyle: "mercury" })
  assert.deepStrictEqual(evil.ornamentStyles, ["glass", "gilded"])
  assert.strictEqual(evil.ornamentStyle, "glass")
  // Baubles keep their finish.
  const t = Store.normalizeTree({ ornaments: [{ kind: "bauble", style: "pearl" }, { kind: "bauble", style: "nope" }, { kind: "light", style: "pearl" }] })
  assert.strictEqual(t.ornaments[0].style, "pearl")
  assert.strictEqual(t.ornaments[1].style, undefined)
  assert.strictEqual(t.ornaments[2].style, undefined)
})

// ------------------------------------------------------------- snowballs to friends

test("offscreen throw: only a free ball moving fast at the edge leaves", () => {
  const b = { x: 1590, r: 12, vx: 1400, held: false }
  assert.strictEqual(S.throwsOff(b, 1600, 1150), "right")
  assert.strictEqual(S.throwsOff(Object.assign({}, b, { vx: 600 }), 1600, 1150), "")
  assert.strictEqual(S.throwsOff(Object.assign({}, b, { held: true }), 1600, 1150), "")
  assert.strictEqual(S.throwsOff({ x: 8, r: 12, vx: -1500 }, 1600, 1150), "left")
  assert.strictEqual(S.throwsOff({ x: 800, r: 12, vx: -1500 }, 1600, 1150), "")
})

function thrown(throwOut, vx) {
  const w = S.createWorld(1600, 1000, { effect: "snow", plow: false })
  S.setEnv(w, { snowScale: 0 })
  S.setFeatures(w, { throwOut })
  const b = S.makeBall(w, 1400, 500, Math.PI * 14 * 14, 0.9)
  b.vx = vx; b.vy = -200
  w.balls.push(b)
  for (let t = 0; t < 1; t += dt) S.step(w, dt)
  return w
}

test("a hard throw at the side sails off to a friend; without friends it bursts there", () => {
  const w = thrown(true, 1800)
  const ev = S.takeEvents(w)
  assert.strictEqual(ev.length, 1)
  assert.strictEqual(ev[0].type, "throw")
  assert.strictEqual(ev[0].side, "right")
  assert.ok(ev[0].y > 0.2 && ev[0].y < 0.7 && ev[0].vx > 1150 && ev[0].r > 10)
  assert.strictEqual(w.balls.length, 0)
  const off = thrown(false, 1800)
  assert.strictEqual(S.takeEvents(off).length, 0)
  assert.ok(off.particles.some(p => p.kind === "clump"), "burst on the edge")
  const soft = thrown(true, 500)
  assert.strictEqual(S.takeEvents(soft).length, 0, "too slow to leave")
})

test("a friend's snowball flies in by the opposite edge and splats", () => {
  const w = S.createWorld(1600, 1000, { effect: "snow", plow: false })
  S.setEnv(w, { snowScale: 0 })
  const r = { id: "a", x: 700, y: 450, w: 600, h: 400, floating: true, z: 0 }
  S.setSurfaces(w, [r], 0)
  const b = S.launchBall(w, { side: "right", y: 0.5, vx: 1700, vy: -100, r: 14 })
  assert.ok(b.x < 0 && b.vx > 0, "in from the left")
  const c = S.launchBall(w, { side: "left", y: 0.5, vx: 1700, vy: -100, r: 14 })
  assert.ok(c.x > 1600 && c.vx < 0, "in from the right")
  for (let t = 0; t < 2; t += dt) { S.setSurfaces(w, [r], w.time); S.step(w, dt) }
  assert.ok(w.balls.length < 2, "at least one burst")
  assert.ok(sum(w.surfaces.a.bins) + sum(w.surfaces.__ground.bins) > 0, "a splat stuck somewhere")
})

test("snowballs travel as gifts: clamped on the way in, from friends only by kind", () => {
  const me = { id: "a".repeat(32), name: "Saman" }
  const msg = Store.giftMessage(me, "snowball", { side: "right", y: 0.4, vx: 99999, vy: -300, r: 500, type: "throw" })
  assert.deepStrictEqual(msg.art, { side: "right", y: 0.4, vx: 3200, vy: -300, r: 40 })
  const line = JSON.stringify({ event: "message", id: "x1", message: JSON.stringify(msg) })
  const got = Store.parseInbox(line, [{ id: me.id, name: "Saman" }])
  assert.strictEqual(got.gift.kind, "snowball")
  assert.strictEqual(got.gift.art.side, "right")
  const evil = JSON.parse(JSON.stringify(msg)); evil.art = { side: "up", y: "x", vx: -5 }
  const bad = Store.parseInbox(JSON.stringify({ event: "message", id: "x2", message: JSON.stringify(evil) }), [])
  assert.deepStrictEqual(bad.gift.art, { side: "right", y: 0.5, vx: 300, vy: -200, r: 12 })
  const saved = Store.normalize({ friends: [{ id: "b".repeat(32), name: "Ali" }, { id: "c".repeat(32), name: "Sara" }], throwTo: "c".repeat(32) })
  assert.strictEqual(Store.throwTarget(saved).name, "Sara")
  assert.strictEqual(Store.throwTarget(Store.normalize({ friends: saved.friends })).name, "Ali")
  assert.strictEqual(Store.throwTarget(Store.defaults()), null)
})

// ------------------------------------------------------------- the state behind it

test("new settings default sensibly and survive a hand-edited file", () => {
  const d = Store.defaults()
  assert.strictEqual(d.liveWeather, false, "live weather is opt-in")
  assert.strictEqual(d.throwToFriends, false, "throwing to friends is opt-in")
  for (const k of ["shake", "windGusts", "writing", "dayCycle", "seasons", "newYear", "surprises", "themeSync"]) assert.strictEqual(d[k], true, k)
  const n = Store.normalize({ calm: "work", workHours: { start: "08:30", end: "25:00", days: [6, 0, 9, 1, 1] }, weatherLat: "35.7",
                              weatherLon: 400, weatherCity: "Tehran", surprises: false, weatherCache: { at: 5, current: { tempC: 999 } } })
  assert.strictEqual(n.calm, "work")
  assert.deepStrictEqual(n.workHours, { start: "08:30", end: "17:00", days: [0, 1, 6] })
  assert.strictEqual(n.weatherLat, 35.7)
  assert.strictEqual(n.weatherLon, null)
  assert.strictEqual(n.surprises, false)
  assert.strictEqual(n.weatherCache.current.tempC, 60)
  assert.strictEqual(Store.normalize({ calm: "sometimes" }).calm, "off")
})

test("snowmen: new ones are bare, a click dresses them piece by piece, old ones keep their outfit", () => {
  assert.deepStrictEqual(Store.normalizeSnowman({}).outfit, { nose: true, scarf: true, hat: true }, "saved before outfits: all on")
  let o = { nose: false, scarf: false, hat: false }
  o = Store.dressNext(o); assert.deepStrictEqual(o, { nose: true, scarf: false, hat: false })
  o = Store.dressNext(o); assert.deepStrictEqual(o, { nose: true, scarf: true, hat: false })
  o = Store.dressNext(o); assert.deepStrictEqual(o, { nose: true, scarf: true, hat: true })
  o = Store.dressNext(o); assert.deepStrictEqual(o, { nose: false, scarf: false, hat: false })
  const m = Store.normalize({ snowmen: [{ outfit: { nose: true, hat: 1 }, themeScarf: true }] }).snowmen[0]
  assert.deepStrictEqual(m.outfit, { nose: true, scarf: false, hat: true })
  assert.strictEqual(m.themeScarf, true)
})

test("a hare that turns about near an edge stays on the screen until it means to leave", () => {
  // It used to turn about near the left edge, hop off and be dropped there
  // a few seconds into its visit, so most visits were never seen.
  for (let k = 0; k < 30; k++) {
    const { w, r } = snowy()
    assert.ok(S.spawnRabbit(w, { dir: 1 }))
    w.rabbit.stay = 1e9
    let seen = 0
    for (let t = 0; t < 20; t += dt) {
      S.setSurfaces(w, [r], w.time); S.step(w, dt)
      assert.ok(w.rabbit, `gone after ${t.toFixed(1)} s, run ${k}`)
      if (w.rabbit.x > 0 && w.rabbit.x < w.width) seen += dt
    }
    assert.ok(seen > 18, `on screen for ${seen.toFixed(1)} s`)
  }
})

test("the hare comes on a clear day with snow lying, not in the rain", () => {
  const P = load("lib/policy.js")
  const ctx = { mode: "clear", groundCover: 0.4, groundSnow: 3, perches: 2 }
  assert.strictEqual(P.surpriseBlock("rabbit", ctx), "")
  assert.notStrictEqual(P.surpriseBlock("rabbit", Object.assign({}, ctx, { mode: "rain" })), "")
  assert.notStrictEqual(P.surpriseBlock("rabbit", Object.assign({}, ctx, { groundCover: 0, groundSnow: 0 })), "")
})

test("a hare mostly walks, forefeet reaching ahead one then the other, and stops to nibble or look about", () => {
  const { w, r } = snowy()
  S.spawnRabbit(w, { dir: 1 })
  w.rabbit.stay = 1e9
  const seen = { walk: 0, hop: 0, graze: 0, up: 0 }
  let staggered = 0, lifted = 0, maxLift = 0
  for (let t = 0; t < 120 && w.rabbit; t += dt) {
    S.setSurfaces(w, [r], w.time); S.step(w, dt)
    const R = w.rabbit
    if (R.mode === "walk") {
      seen.walk += dt
      if (R.fn - R.ff > 0.2) staggered++
      if (R.hb > 1) lifted++
      assert.strictEqual(R.lift, 0, "walking, it keeps its feet on the snow")
    }
    if (R.mode === "hop") { seen.hop += dt; maxLift = Math.max(maxLift, R.lift) }
    if (R.mode === "rest" && R.act === "graze" && R.graze > 0.9) seen.graze += dt
    if (R.mode === "rest" && R.act === "up" && R.up > 0.9) seen.up += dt
  }
  assert.ok(seen.walk > seen.hop, JSON.stringify(seen))
  assert.ok(seen.graze > 1 && seen.up > 1, JSON.stringify(seen))
  assert.ok(staggered > 30, "the forefeet step one after the other")
  assert.ok(lifted > 30, "the haunch lifts as the hind feet come up")
  assert.ok(maxLift < 9, `hops stay low: ${maxLift.toFixed(1)} px`)
})

test("the hare comes on its own now and then, more often than the robin", () => {
  const Policy = load("lib/policy.js")
  let seed = 11
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  const ctx = { mode: "snow", perches: 5, groundSnow: 3, groundCover: 0.6 }
  let history = [], now = 0, hares = 0
  for (let i = 0; i < 60; i++) {
    const plan = Policy.planSurprise(history, now, ctx, rng, { first: !history.length })
    now += plan.delay
    if (plan.kind === "rabbit") hares++
    history = Policy.remember(history, plan.kind, now)
  }
  // An hour of visits: the hare is at least every other one.
  assert.ok(hares >= 25, `${hares} hares in ${(now / 60000).toFixed(0)} min`)
})
