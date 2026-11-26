// The live-desktop paths of the visitors, the ice and the plow switch:
// every painter run against a strict stand-in for Qt's Context2D (see
// qtcanvas.js), a tiled Omarchy desktop where the bird used to find no
// perch and the icicles hung where nothing shows, icicles and frost at
// night with live weather off, the plow switch, faults kept to the feature
// that threw, and what `flurry diag` reports.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const Q = require("./qtcanvas")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const Season = load("lib/season.js")
const Policy = load("lib/policy.js")
const T = load("lib/theme.js")

const dt = 1 / 60
const W = 1920, H = 1080
// Omarchy's tiling at 1920x1080: the bar on top, gaps of 10 px, two
// windows side by side filling the screen (every ledge at the same height,
// every bottom edge on the ground).
const TILED = [
  { id: "0xa1", x: 10, y: 38, w: 945, h: 1032, floating: false, z: 0 },
  { id: "0xa2", x: 965, y: 38, w: 945, h: 1032, floating: false, z: 1 }
]
const FLOAT = { id: "0xf1", x: 600, y: 300, w: 700, h: 420, floating: true, z: 0 }

function run(w, secs, rects, input) {
  for (let t = 0; t < secs - 1e-9; t += dt) { S.setSurfaces(w, rects, w.time); S.step(w, dt, input ? input(t) : undefined) }
}
// A November night in the calendar's weather (live weather off).
const NIGHT = Season.environment(new Date(2026, 10, 24, 21, 30), { weather: null, seasons: true, dayCycle: true })

function strictPaint(label, fn) {
  const e = Q.paint(fn)
  assert.strictEqual(e, null, label + ": " + (e && e.message))
}

test("the strict Context2D mock throws where Qt does", () => {
  assert.ok(Q.paint(c => c.arc(0, 0, -1, 0, 1)), "negative radius")
  assert.ok(Q.paint(c => c.createRadialGradient(0, 0, -1, 0, 0, 2)), "negative gradient radius")
  assert.ok(Q.paint(c => c.createLinearGradient(0, NaN, 0, 1)), "non-finite gradient")
  assert.ok(Q.paint(c => c.createLinearGradient(0, 0, 0, 1).addColorStop(1.2, "#fff")), "offset out of range")
  assert.ok(Q.paint(c => c.createLinearGradient(0, 0, 0, 1).addColorStop(0, "rgba(1,2,3,NaN)")), "bad colour")
  assert.ok(Q.paint(c => c.roundRect(0, 0, 1, 1, 1)), "not in Qt")
  assert.ok(Q.paint(c => { c.filter = "blur(2px)" }), "not in Qt")
  assert.ok(Q.paint(c => c.ellipse(0, 0, 1, 1, 0, 0, 6)), "browser ellipse")
  assert.ok(Q.paint(c => { c.globalCompositeOperation = "multiply" }), "Qt spells it qt-multiply")
  assert.ok(Q.paint(c => { c.save() }), "unbalanced save")
  assert.strictEqual(Q.paint(c => { c.save(); c.translate(1, 2); c.arc(0, 0, 2, 0, 6); c.restore() }), null)
})

test("every painter runs clean against Qt's Context2D: bird, hare, icicles, frost, Santa, train, snowman, fireworks, sprouts, golden flake", () => {
  const theme = T.derive(T.parse('accent = "#89b4fa"\nbackground = "#1e1e2e"\nforeground = "#cdd6f4"\ncolor4 = "#89b4fa"\n'))
  for (const th of [null, theme]) {
    D.setTheme(th)
    const w = S.createWorld(W, H, { effect: "snow", intensity: 1.6 })
    S.setEnv(w, NIGHT)
    const rects = TILED.concat([FLOAT])
    let frames = 0
    for (let i = 0; i < 60 * 150; i++) {
      S.setSurfaces(w, rects, w.time)
      S.step(w, dt, { pointer: { x: 400 + 300 * Math.sin(i / 90), y: 250, present: true, vx: 0, vy: 0 } })
      if (i === 60 * 20) { S.spawnBird(w); S.spawnRabbit(w); S.spawnGolden(w); S.startFireworks(w, 20) }
      if (i % 400 === 0 && !w.bird) S.spawnBird(w)
      if (i % 500 === 0 && !w.rabbit) S.spawnRabbit(w, { coat: i % 1000 ? "white" : "brown" })
      if (i === 60 * 70) S.callPlow(w)
      if (i === 60 * 110) S.shake(w, 1)
      if (i % 4 === 0) { strictPaint("world@" + i, c => D.world(c, w)); frames++ }
      if (w.rabbit) strictPaint("rabbit", c => D.drawRabbit(c, w.rabbit))
      if (w.bird) strictPaint("bird", c => D.drawBird(c, w.bird, w.time))
    }
    assert.ok(frames > 2000)
    assert.ok(!w.faults, "no feature faulted: " + JSON.stringify(w.faults))
    // Spring: sprouts, blossom and a brown hare.
    const sp = S.createWorld(W, H, { effect: "snow" })
    S.setEnv(sp, Season.environment(new Date(2027, 2, 22, 14, 0), { seasons: true, dayCycle: true }))
    S.spawnRabbit(sp, { coat: "brown" })
    for (let i = 0; i < 60 * 70; i++) { S.setSurfaces(sp, [FLOAT], sp.time); S.step(sp, dt); if (i % 10 === 0) strictPaint("spring", c => D.world(c, sp)) }
    assert.ok(sp.sprouts && sp.sprouts.some(s => s.g > 0.3), "sprouts came up")
    // Each hare pose, both coats, both ways.
    for (const coat of ["white", "brown"]) for (const dir of [1, -1]) for (const pose of [-1, -0.5, 0, 0.5, 1]) for (const up of [0, 1])
      strictPaint("hare", c => D.drawRabbit(c, { x: 50, y: 50, dir, pose, up, ears: up, lift: pose > 0 ? 6 : 0, look: 0.3, nose: 1.2, coat }))
    // The characters painted in their own canvases.
    strictPaint("sleigh", c => { c.reset(); D.sleigh(c, 260, 96, 1.3) })
    strictPaint("yeti", c => D.yeti(c, 120, 150, 2, 1, true, false))
    for (const cargo of ["", "gift", "tree", "snowman", "note"]) strictPaint("train", c => D.train(c, 200, 80, 3, 1, cargo))
    strictPaint("snowman", c => D.snowman(c, 80, 120, { built: 1, scarf: "#c33", outfit: { nose: true, scarf: true, hat: true } }))
    strictPaint("snowman half", c => D.snowman(c, 80, 120, { built: 0.4, scarf: "#3c3", outfit: { nose: false, scarf: false, hat: false } }))
    const orn = [{ u: 0.3, v: 0.4, kind: "bauble", color: "#d33" }, { u: 0.5, v: 0.6, kind: "lights" }, { u: 0.6, v: 0.3, kind: "cane" }]
    for (const style of ["glass", "frosted", "pearl", "gilded", "mercury"])
      strictPaint("tree " + style, c => D.tree(c, 160, 220, { growth: 1, star: true, ornaments: orn.map(o => Object.assign({ style }, o)), seed: "t" }, 0))
    strictPaint("tree lights", c => D.treeLights(c, 160, 220, { growth: 1, star: true, ornaments: orn }, 3.3))
    strictPaint("letter", c => D.letter(c, 40, 30))
    strictPaint("gift", c => D.gift(c, 40, 40, "#c33"))
  }
  D.setTheme(null)
})

test("a robin finds a perch on a tiled desktop with deep snow on every ledge, and on the ground", () => {
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1.4, plow: false })
  S.setEnv(w, NIGHT)
  run(w, 240, TILED)
  const top = Math.max(...w.surfaces["0xa1"].bins)
  assert.ok(top > 16, "the ledges are deep: " + top)
  // Before, a perch needed its snow top 30 px below the screen's top: on
  // ledges at y 38 that failed once 8 px of snow lay there, for good.
  const ctx = S.critterContext(w)
  assert.ok(ctx.perches > 0, "perches: " + ctx.perches)
  let landed = 0, onGround = 0
  for (let k = 0; k < 20; k++) {
    w.bird = null
    assert.ok(S.spawnBird(w))
    if (w.bird.s === S.GROUND_ID) onGround++
    run(w, 3, TILED)
    if (w.bird && w.bird.mode === "perch") landed++
  }
  assert.ok(landed >= 18, `landed ${landed}/20`)
  assert.ok(onGround < 20, "ledges are used, not only the ground")
  assert.ok(w.bird.y >= 10, "its feet are on the screen")
})

test("a robin flies off when a snowball flies near it", () => {
  const w = S.createWorld(1600, 1000, { plow: false })
  const r = { id: "a", x: 400, y: 400, w: 600, h: 300, floating: true, z: 0 }
  S.setSurfaces(w, [r], 0)
  S.spawnBird(w)
  run(w, 3, [r])
  assert.strictEqual(w.bird.mode, "perch")
  w.balls.push({ x: w.bird.x - 50, y: w.bird.y - 10, vx: 600, vy: 0, r: 8, held: false })
  S.step(w, dt)
  w.balls = []
  assert.strictEqual(w.bird.mode, "out")
})

test("windows freeze at night with live weather off: icicles in a minute or two, where they show, and frost", () => {
  assert.strictEqual(NIGHT.weather, false)
  assert.ok(NIGHT.tempC < 0 && NIGHT.icicle > 0.4 && NIGHT.freeze > 0.5, JSON.stringify(NIGHT))
  // A tiled desktop: the bottom edges sit on the ground, so they hang from
  // the top edge, under the snow.
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  S.setEnv(w, NIGHT)
  run(w, 120, TILED)
  const s = w.surfaces["0xa1"]
  assert.strictEqual(s.iceAt, "top")
  const long = s.icicles.filter(i => i.len > 3).length
  assert.ok(long >= 5, `${long} icicles over 3 px after two minutes`)
  assert.ok(s.icicles.every(i => i.len <= i.max * 0.56), "shorter under the snow")
  assert.ok(s.frost > 0.6, "frosted: " + s.frost)
  // A floating window with room below: from its bottom edge.
  const f = S.createWorld(W, H, { effect: "snow", plow: false })
  S.setEnv(f, NIGHT)
  run(f, 90, [FLOAT])
  assert.strictEqual(f.surfaces["0xf1"].iceAt, "bottom")
  assert.ok(f.surfaces["0xf1"].icicles.filter(i => i.len > 3).length >= 5)
  // Painted where they hang: pixels just below the top edge of the tiled window.
  let createCanvas = null
  try { createCanvas = require("@napi-rs/canvas").createCanvas } catch (e) {}
  if (createCanvas) {
    const c = createCanvas(W, H), cx = c.getContext("2d")
    D.world(cx, w)
    const px = cx.getImageData(s.x + 40, s.y + 2, s.w - 80, 10).data
    let lit = 0
    for (let i = 3; i < px.length; i += 4) if (px[i] > 20) lit++
    assert.ok(lit > 200, `${lit} px of ice and frost under the ledge`)
  }
  // Warm afternoon: no frost.
  const warm = S.createWorld(W, H, { effect: "snow", plow: false })
  S.setEnv(warm, Object.assign({}, NIGHT, { tempC: 6, sun: 1, icicle: 0 }))
  run(warm, 60, TILED)
  assert.ok(warm.surfaces["0xa1"].frost < 0.05)
  // Switched off (Melting, icicles, night glaze): none.
  const off = S.createWorld(W, H, { effect: "snow", plow: false })
  S.setEnv(off, NIGHT); S.setFeatures(off, { icicles: false })
  run(off, 60, TILED)
  assert.ok(!off.surfaces["0xa1"].icicles && !(off.surfaces["0xa1"].frost > 0.01))
})

test("a yank snaps top-hung icicles too", () => {
  const w = S.createWorld(W, H, { effect: "snow", plow: false })
  S.setEnv(w, NIGHT)
  run(w, 120, TILED)
  const s = w.surfaces["0xa1"]
  s.icicles.forEach(i => { i.len = Math.max(i.len, 8) })
  let x = 10
  const motion = () => ({ pointer: { x: x + 300, y: 300, vx: 2400, vy: 0, present: true, stillFor: 0 }, poll: 0.016, layoutAge: 1e9 })
  for (let t = 0; t < 0.3; t += dt) {
    x += 2400 * dt
    S.setSurfaces(w, [Object.assign({}, TILED[0], { x }), TILED[1]], w.time, null, motion())
    S.step(w, dt)
  }
  assert.ok(w.particles.some(p => p.kind === "shard"), "shards fell")
})

test("the snow plow switch: off, it never comes; mid-run it finishes and leaves; a call is refused", () => {
  const deep = w => { const g = w.surfaces.__ground; g.bins = g.bins.map(() => 20) }
  // On: deep ground snow brings it.
  const on = S.createWorld(1600, 1000, { plow: true, arrival: false })
  deep(on); S.setEnv(on, { snowScale: 0 })
  run(on, 2, [])
  assert.ok(on.plow, "comes when it is on")
  // Off: never, however deep.
  const off = S.createWorld(1600, 1000, { plow: false, arrival: false })
  deep(off); S.setEnv(off, { snowScale: 0 })
  run(off, 30, [])
  assert.strictEqual(off.plow, null)
  assert.strictEqual(off.plowRuns, 0)
  assert.strictEqual(S.requestPlow(off), "off", "a manual call is refused while it is off")
  assert.strictEqual(off.plow, null)
  S.setPlow(off, true)
  assert.strictEqual(S.requestPlow(off), "sent")
  assert.strictEqual(S.requestPlow(off), "out")
  // Switched off mid-run: it finishes its pass, briskly, and is gone; then none comes back.
  const mid = S.createWorld(1600, 1000, { plow: true, arrival: false })
  deep(mid); S.setEnv(mid, { snowScale: 0 })
  run(mid, 3, [])
  assert.ok(mid.plow)
  S.setPlow(mid, false)
  assert.ok(mid.plow.recall)
  let t = 0
  while (mid.plow && t < 40) { run(mid, 0.5, []); t += 0.5 }
  assert.strictEqual(mid.plow, null, "drove off")
  deep(mid)
  run(mid, 20, [])
  assert.strictEqual(mid.plow, null, "and stays away")
  assert.strictEqual(mid.plowRuns, 1)
})

test("a feature that throws is dropped and noted once; the snow and the others carry on", () => {
  const w = S.createWorld(800, 600, { plow: false })
  const r = { id: "a", x: 100, y: 200, w: 500, h: 300, floating: true, z: 0 }
  S.setSurfaces(w, [r], 0)
  S.spawnBird(w); S.spawnRabbit(w)
  w.rabbit.pose = undefined
  Object.defineProperty(w.rabbit, "age", { get() { throw new Error("boom") }, set() { throw new Error("boom") } })
  run(w, 2, [r])
  assert.strictEqual(w.rabbit, null)
  assert.ok(w.bird, "the bird still came")
  assert.strictEqual(w.faults.rabbit.message, "boom")
  assert.strictEqual(w.faults.rabbit.count, 1)
  // In the paint: a layer that throws is skipped, and what comes after is still drawn.
  const ctx = Q.create()
  w.golden = { x: 50, y: 50, spin: 0, rest: null, restLeft: 1, age: 0 }
  w.bird.x = NaN   // a NaN coordinate: the strict context throws on it
  D.world(ctx, w)
  ctx.__check()
  assert.ok(w.faults["draw:bird"], "noted")
  assert.ok(!w.faults["draw:golden"], "the golden flake after it painted fine")
})

test("flurry diag says what each visitor waits for, the ice, and any faults", () => {
  const w = S.createWorld(W, H, { effect: "snow", plow: false })
  S.setEnv(w, NIGHT)
  run(w, 90, TILED)
  const ctx = Object.assign(S.critterContext(w), { mode: "rain", surprises: true })
  const d = Policy.diagReport({ now: 1000, mode: "rain", env: NIGHT, history: [], last: { kind: "rabbit", came: false, why: "x" },
                                weather: { live: true, kind: "rain" }, gates: { dayCycle: true }, timer: { running: true, nextAt: 16000 },
                                ctx, faults: { "draw:bird": { message: "m", count: 2 } } })
  assert.strictEqual(d.surprises.nextInS, 15)
  assert.ok(/only in snow/.test(d.surprises.rabbit), d.surprises.rabbit)
  assert.ok(/no robins in rain/.test(d.surprises.bird), d.surprises.bird)
  assert.ok(d.ice.icicles > 0 && d.ice.ledges.length === 2 && d.ice.ledges[0].iceAt === "top")
  assert.strictEqual(d.faults["draw:bird"].count, 2)
  assert.strictEqual(d.weather.kind, "rain")
  const snow = Policy.diagReport({ now: 0, mode: "snow", env: NIGHT, ctx: Object.assign(S.critterContext(w), { mode: "snow" }), timer: { running: false } })
  assert.strictEqual(snow.surprises.bird, "can come")
  assert.strictEqual(snow.surprises.nextInS, null)
  assert.strictEqual(snow.weather.kind, "(off: calendar)")
  assert.ok(/growing/.test(snow.ice.status))
  JSON.stringify(d)
})

test("the scheduler on a tiled desktop: a visitor within two minutes, then one every few, never the same twice running", () => {
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1 })
  S.setEnv(w, NIGHT)
  let seed = 3
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  let history = [], next = Policy.planSurprise([], 0, {}, rng, { first: true }).delay / 1000
  const visits = []
  for (let t = 0; t < 20 * 60; t += 0.5) {
    run(w, 0.5, TILED)
    if (t < next) continue
    const ctx = Object.assign(S.critterContext(w), { mode: "snow", surprises: true })
    const kind = Policy.pickSurprise(history, t * 1000, ctx, rng)
    let came = false
    if (kind === "bird") came = S.spawnBird(w)
    else if (kind === "rabbit") came = S.spawnRabbit(w)
    else if (kind === "golden") came = S.spawnGolden(w)
    if (came) { history = Policy.remember(history, kind, t * 1000); visits.push([Math.round(t), kind]) }
    next = t + Policy.planSurprise(history, t * 1000, ctx, rng, { missed: !came }).delay / 1000
  }
  assert.ok(visits.length >= 4, JSON.stringify(visits))
  assert.ok(visits[0][0] <= 125, "first within about two minutes: " + JSON.stringify(visits[0]))
  assert.ok(visits.some(v => v[1] === "bird") && visits.some(v => v[1] === "rabbit"), JSON.stringify(visits))
  // A repeat only when the other could not come at that moment.
  let repeats = 0
  for (let i = 1; i < visits.length; i++) if (visits[i][1] !== "golden" && visits[i][1] === visits[i - 1][1]) repeats++
  assert.ok(repeats <= 1, JSON.stringify(visits))
})

test("flurry freeze: icicles and frost at once, in any weather; then the weather takes over", () => {
  const w = S.createWorld(W, H, { effect: "rain", plow: false })
  S.setEnv(w, { tempC: 12, sun: 1, icicle: 0 })
  S.setSurfaces(w, TILED.concat([FLOAT]), 0)
  const n = S.freezeNow(w)
  assert.ok(n >= 30, String(n))
  assert.strictEqual(w.surfaces["0xa1"].iceAt, "top")
  assert.strictEqual(w.surfaces["0xf1"].iceAt, "bottom")
  assert.ok(w.surfaces["0xf1"].icicles.every(i => i.len > i.max * 0.65))
  assert.strictEqual(w.surfaces["0xa1"].frost, 1)
  strictPaint("frozen", c => D.world(c, w))
  run(w, 5, TILED.concat([FLOAT]))
  assert.ok(w.surfaces["0xf1"].icicles.some(i => i.len > 5), "still there a moment later")
})

test("the snow plow switch is saved, on by default", () => {
  const Store = load("lib/store.js")
  assert.strictEqual(Store.defaults().plow, true)
  assert.strictEqual(Store.normalize({}).plow, true)
  assert.strictEqual(Store.normalize({ plow: false }).plow, false)
  assert.strictEqual(Store.normalize(JSON.parse(JSON.stringify(Store.normalize({ plow: false })))).plow, false)
})
