// The robin's visit: it moves between the ground and the tops of windows
// in view, hopping, pecking and kicking a few flakes off a ledge between
// flights, both on a visit of its own and while it waits with the hare for
// the plow. It never stands on a ledge a window in front covers or one up
// under the bar's reserved area, it leaves a window that is dragged,
// closes or goes fullscreen, and it still flees the plow from a ledge.
// Run on a simulated clock with a seeded Math.random, so every run takes
// the same course.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const S = load("lib/sim.js")

const dt = 1 / 60
const W = 1600, H = 900

function seeded(seed) {
  let a = seed >>> 0
  return function() {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function withSeed(seed, fn) {
  const real = Math.random
  Math.random = seeded(seed)
  try { return fn() } finally { Math.random = real }
}
function world(fill, rects) {
  const w = S.createWorld(W, H, { effect: "snow" })
  S.setEnv(w, { snowScale: 0 })
  const g = w.surfaces[S.GROUND_ID]
  g.bins = g.bins.map(() => S.TUNING.snow.groundCap * fill)
  S.setSurfaces(w, rects, 0)
  // A little snow on every ledge, so there is some to kick.
  for (const r of rects) { const s = w.surfaces[r.id]; s.bins = s.bins.map(() => 3) }
  return w
}
function step(w, rects, input) { S.setSurfaces(w, rects, w.time); S.step(w, dt, input) }
function at(log, e) { const n = log.find(x => x.e === e); return n ? n.t : -1 }

// Two floating windows low on the screen, side by side.
const LOW = [
  { id: "0xa", x: 220, y: 520, w: 460, h: 300, floating: true, z: 1 },
  { id: "0xb", x: 900, y: 600, w: 420, h: 220, floating: true, z: 2 }
]

// What the robin stands on this frame: "ground", a window id, or "".
function perchedOn(w) {
  const B = w.bird
  if (!B || B.mode !== "perch") return ""
  return B.s === S.GROUND_ID ? "ground" : B.s
}

test("a visit of its own: 2-4 flights between the ground and the window tops, a few flakes kicked off a ledge, then it goes", () => {
  for (const seed of [3, 17, 42, 1234]) withSeed(seed, () => {
    const w = world(0.2, LOW)
    assert.ok(S.spawnBird(w, { surface: S.GROUND_ID }), "it comes")
    const B = w.bird
    const seen = new Set()
    let flights = 0, last = "", kicked = 0, frames = 0, arcs = 0, glided = false, awake = true
    const before = w.surfaces["0xa"].bins.reduce((a, b) => a + b, 0) + w.surfaces["0xb"].bins.reduce((a, b) => a + b, 0)
    while (w.bird && frames < 60 * 90) {
      const was = w.bird.mode
      step(w, LOW)
      frames++
      if (w.bird && was === "perch" && w.bird.mode === "fly") flights++
      if (w.bird && w.bird.mode === "fly") {
        // A real arc: the bird is above the straight line between its perches mid-flight.
        if (w.bird.t > w.bird.dur * 0.4 && w.bird.t < w.bird.dur * 0.6) {
          const s = w.surfaces[w.bird.s], tx = s.x + w.bird.ox
          const u = (w.bird.x - w.bird.sx) / ((tx - w.bird.sx) || 1)
          const lineY = w.bird.sy + (s.y - S.heightAt(s, tx) - w.bird.sy) * Math.min(1, Math.max(0, u))
          if (w.bird.y < lineY - 4) arcs++
        }
        if (w.bird.glide) glided = true
      }
      if (w.bird && w.bird.act === "kick") kicked++
      const p = perchedOn(w)
      if (p && p !== last) { seen.add(p); last = p }
      if (w.bird && S.quiet(w)) awake = false
    }
    assert.strictEqual(w.bird, null, "it went (seed " + seed + ")")
    assert.ok(seen.has("ground"), "on the ground: " + [...seen])
    assert.ok(seen.has("0xa") || seen.has("0xb"), "and on a window top (seed " + seed + "): " + [...seen])
    assert.ok(flights >= 2 && flights <= 4, "2-4 flights, made " + flights + " (seed " + seed + ")")
    assert.strictEqual(B.moves, 0, "every flight of the visit was made")
    assert.ok(arcs > 0, "its flights arc up over the straight line")
    assert.ok(glided, "it sets its wings to land")
    assert.ok(kicked > 0, "it kicked some snow off a ledge (seed " + seed + ")")
    const after = w.surfaces["0xa"].bins.reduce((a, b) => a + b, 0) + w.surfaces["0xb"].bins.reduce((a, b) => a + b, 0)
    assert.ok(after < before, "the kicks took snow off the ledges")
    assert.ok(awake, "the idle loop stays awake while it is here")
    const secs = frames * dt
    assert.ok(secs > 15 && secs < 62, "a visit of " + secs.toFixed(1) + " s")
  })
})

test("before the plow: over the linger the robin is on the ground near the hare and on a window top, then flees the plow", () => {
  let fromLedge = 0
  for (const seed of [7, 8, 21, 33]) withSeed(seed, () => {
    const w = world(0.6, LOW)
    const seen = new Set()
    let last = "", landed = -1, called = -1, fledOn = null, fledMode = "", birdObj = null
    for (let i = 0; i < 60 * 90; i++) {
      const prev = w.bird ? { s: w.bird.s, mode: w.bird.mode } : null
      step(w, LOW)
      const A = w.arrival || w.arrivalLast
      if (!A) continue
      landed = at(A.log, "bird-landed"); called = at(A.log, "plow-called")
      if (landed >= 0 && called < 0) {
        const p = perchedOn(w)
        if (p && p !== last) { seen.add(p); last = p }
        if (p === "ground") {
          const R = w.rabbit
          assert.ok(R && Math.abs(R.x - w.bird.x) < 260, "on the ground near the hare")
        }
      }
      if (w.bird) birdObj = w.bird
      if (prev && prev.mode !== "out" && birdObj && birdObj.mode === "out" && fledOn === null && at(A.log, "bird-fled") >= 0) {
        fledOn = prev.s; fledMode = prev.mode
      }
      if (!w.arrival && w.arrivalLast && w.plowRuns === 1 && w.time > 30) break
    }
    const log = w.arrivalLast.log
    assert.ok(at(log, "bird-landed") > 0, "the robin came (seed " + seed + ")")
    assert.ok(seen.has("ground"), "it was on the ground: " + [...seen])
    assert.ok(seen.has("0xa") || seen.has("0xb"), "and on a window top over the linger (seed " + seed + "): " + [...seen])
    assert.ok(at(log, "bird-fled") >= at(log, "plow-seen"), "it fled the plow once it showed")
    if (fledOn && fledOn !== S.GROUND_ID && fledMode === "perch") fromLedge++
  })
  // However it fell above, this one is made to flee from a ledge.
  withSeed(5, () => {
    const w = world(0.6, LOW)
    let onLedge = false
    for (let i = 0; i < 60 * 60; i++) {
      step(w, LOW)
      const A = w.arrival
      if (A && A.phase === "linger" && w.bird && w.bird.mode === "perch" && w.bird.s !== S.GROUND_ID) {
        // Hold it there and let the plow go now.
        w.bird.dwell = 1e9
        A.lingerUntil = w.time
        onLedge = true
        break
      }
    }
    assert.ok(onLedge, "it got up onto a ledge during the linger")
    const ledge = w.bird.s
    let fled = false
    for (let i = 0; i < 60 * 20 && w.bird; i++) {
      step(w, LOW)
      if (w.bird && w.bird.mode === "out") { fled = true; break }
      assert.strictEqual(w.bird.s, ledge, "it stays on its ledge until it sees the plow")
    }
    assert.ok(fled, "it flew off the ledge")
    const L = w.arrival || w.arrivalLast
    assert.ok(at(L.log, "bird-fled") >= at(L.log, "plow-seen") && at(L.log, "plow-seen") > 0, "because of the plow")
    for (let i = 0; i < 60 * 30 && (w.arrival || w.plow); i++) step(w, LOW)
    assert.strictEqual(w.bird, null, "and is gone")
  })
})

test("it never stands on a ledge a window in front covers, nor one up under the bar's reserved area", () => {
  // A wide window at the back, half its top under a floating one in front;
  // a window whose top is right up under the bar (y 4: a perch there would
  // put its feet in the reserved area); and a narrow open window.
  const back = { id: "0xback", x: 100, y: 500, w: 900, h: 380, floating: false, z: 3 }
  const front = { id: "0xfront", x: 420, y: 420, w: 420, h: 300, floating: true, z: 0 }
  const high = { id: "0xhigh", x: 1050, y: 4, w: 500, h: 400, floating: false, z: 4 }
  const rects = [back, front, high]
  let ledges = 0, onBack = 0
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) withSeed(seed, () => {
    const w = world(0.2, rects)
    S.spawnBird(w, { surface: S.GROUND_ID })
    for (let i = 0; i < 60 * 70 && w.bird; i++) {
      step(w, rects)
      const B = w.bird
      if (!B || B.mode !== "perch" || B.s === S.GROUND_ID) continue
      ledges++
      assert.notStrictEqual(B.s, high.id, "never on the ledge under the bar")
      assert.ok(B.y >= S.BIRD.minFeetY, "feet below the reserved area")
      if (B.s === back.id) {
        onBack++
        // Its body (x +-7) and head (12 px up) clear of the window in front.
        for (const dx of [-7, 0, 7]) {
          const x = B.x + dx
          const inside = x >= front.x && x <= front.x + front.w && B.y - 12 >= front.y - 1 && B.y - 2 <= front.y + front.h
          assert.ok(!inside, "covered at x " + x.toFixed(0) + " (seed " + seed + ")")
        }
      }
    }
  })
  assert.ok(ledges > 100 && onBack > 0, "it did stand on the open part of the back window: " + onBack + "/" + ledges)
  // The perch lists themselves never offer them either.
  withSeed(99, () => {
    const w = world(0.2, rects)
    for (let k = 0; k < 50; k++) {
      for (const p of S.birdPerches(w, 8)) {
        assert.notStrictEqual(p.s.id, high.id)
        if (p.s.id === back.id) assert.ok(S.ledgeOpen(w, p.s, p.s.x + p.ox))
      }
      const B = { x: 300, y: 880, s: S.GROUND_ID, seq: false }
      const l = S.birdSpot(w, B, "ledge")
      if (l) { assert.notStrictEqual(l.s.id, high.id); assert.ok(S.ledgeOpen(w, l.s, l.s.x + l.ox)) }
    }
  })
})

test("it leaves a window that is dragged, closes or goes fullscreen; one it was flying to that closes, it turns from", () => {
  const A = { id: "0xa", x: 300, y: 520, w: 500, h: 300, floating: true, z: 0 }
  function perchOn(seed) {
    return withSeed(seed, () => {
      const w = world(0.2, [A])
      S.spawnBird(w, { surface: A.id })
      for (let i = 0; i < 60 * 3; i++) step(w, [A])
      assert.strictEqual(w.bird.mode, "perch")
      assert.strictEqual(w.bird.s, A.id)
      w.bird.dwell = 1e9
      return w
    })
  }
  // Dragged.
  let w = perchOn(1)
  let x = A.x
  for (let i = 0; i < 20; i++) { x += 250 * dt; step(w, [Object.assign({}, A, { x })]) }
  assert.strictEqual(w.bird.mode, "out", "dragged: it flies off")
  // Closed.
  w = perchOn(2)
  step(w, [])
  step(w, [])
  assert.strictEqual(w.bird.mode, "out", "closed: it flies off")
  // Fullscreen: the window fills the screen, its top up under the bar.
  w = perchOn(3)
  for (let i = 0; i < 3; i++) step(w, [Object.assign({}, A, { x: 0, y: 0, w: W, h: H })])
  assert.strictEqual(w.bird.mode, "out", "fullscreen: it flies off")
  // Flying to a window that closes on the way: it turns for the ground.
  withSeed(4, () => {
    const w2 = world(0.2, [A])
    S.spawnBird(w2, { surface: S.GROUND_ID })
    for (let i = 0; i < 60 * 3; i++) step(w2, [A])
    assert.strictEqual(w2.bird.mode, "perch")
    const B = w2.bird
    S.birdFlies(w2, B, { s: w2.surfaces[A.id], ox: 200, h: 3, w: 1 })
    for (let i = 0; i < 10; i++) step(w2, [A])
    assert.strictEqual(B.mode, "fly")
    step(w2, []); step(w2, [])
    assert.ok(w2.bird && (w2.bird.mode === "fly" || w2.bird.mode === "out"))
    assert.notStrictEqual(w2.bird.s, A.id, "no longer headed for the closed window")
    for (let i = 0; i < 60 * 3 && w2.bird && w2.bird.mode === "fly"; i++) step(w2, [])
    if (w2.bird && w2.bird.mode === "perch") assert.strictEqual(w2.bird.s, S.GROUND_ID, "it came down on the ground")
  })
})

test("its flights use the frame's real dt: the same course at 60 and at 144 Hz, and a step costs next to nothing", () => {
  function course(hz) {
    return withSeed(77, () => {
      const w = world(0.2, LOW)
      S.spawnBird(w, { surface: S.GROUND_ID })
      const B = w.bird
      for (let t = 0; t < 4; t += 1 / 60) { S.setSurfaces(w, LOW, w.time); S.step(w, 1 / 60) }
      // A fixed flight from where it stands, stepped at hz.
      const before = { x: B.x, y: B.y }
      S.birdFlies(w, B, { s: w.surfaces["0xa"], ox: 120, h: 3, w: 1 })
      const dur = B.dur
      let frames = 0
      while (B.mode === "fly" && frames < 1000) { S.setSurfaces(w, LOW, w.time); S.step(w, 1 / hz); frames++ }
      return { dur, frames, mode: B.mode, s: B.s, x: B.x, from: before }
    })
  }
  const a = course(60), b = course(144)
  assert.strictEqual(a.mode, "perch"); assert.strictEqual(b.mode, "perch")
  assert.ok(Math.abs(a.frames / 60 - a.dur) < 0.05 && Math.abs(b.frames / 144 - b.dur) < 0.05, "flight time is dur in seconds at either rate")
  assert.ok(a.dur >= S.BIRD.flit[0] && a.dur <= S.BIRD.flit[1])
  // Cost: the robin's step alone, many times over.
  withSeed(3, () => {
    const w = world(0.2, LOW)
    S.spawnBird(w, { surface: S.GROUND_ID })
    for (let i = 0; i < 200; i++) step(w, LOW)
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < 20000 && w.bird; i++) { S.stepBird(w, dt, null); w.time += dt }
    const per = Number(process.hrtime.bigint() - t0) / 20000 / 1e6
    assert.ok(per < 0.05, "stepBird " + per.toFixed(4) + " ms a frame")
  })
})
