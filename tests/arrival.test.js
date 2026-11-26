// The plow's visitors (Sim.startArrival): before every plow run the winter
// hare hops in, the robin follows ARRIVAL.birdDelay s later, both potter
// about, then the plow comes and they run and fly off from it, and it
// clears the ground. Run on a simulated clock with a seeded Math.random,
// so every run takes the same course.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const S = load("lib/sim.js")
const Policy = load("lib/policy.js")

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
// Ground snow at `fill` of its capacity everywhere (the plow's trigger is
// the mean of that share), nothing falling unless asked.
function world(fill, opts) {
  const w = S.createWorld(W, H, Object.assign({ effect: "snow" }, opts || {}))
  S.setEnv(w, { snowScale: 0 })
  setGround(w, fill)
  return w
}
function setGround(w, fill) {
  const g = w.surfaces[S.GROUND_ID]
  g.bins = g.bins.map(() => S.TUNING.snow.groundCap * fill)
}
function at(log, e) { const n = log.find(x => x.e === e); return n ? n.t : -1 }

test("before the plow: the hare comes, the robin 5 s later, both linger, the plow comes, they flee, it clears", () => withSeed(7, () => {
  const w = world(0.6)
  const samples = []
  let plowFirst = -1, hareDirAtFlee = 0, plowDir = 0, fledWhilePlowShown = false
  let rabbits = new Set(), birds = new Set()
  for (let i = 0; i < 60 * 90; i++) {
    S.step(w, dt)
    if (w.rabbit) rabbits.add(w.rabbit)
    if (w.bird) birds.add(w.bird)
    if (w.plow && plowFirst < 0) { plowFirst = w.time; plowDir = w.plow.dir }
    const A = w.arrival
    if (A) samples.push({ t: w.time, phase: A.phase, plow: !!w.plow, hare: w.rabbit ? w.rabbit.mode : "", bird: w.bird ? w.bird.mode : "" })
    if (w.rabbit && w.rabbit.mode === "bolt" && !hareDirAtFlee) {
      hareDirAtFlee = w.rabbit.dir
      fledWhilePlowShown = !!w.plow && (w.plow.dir > 0 ? w.plow.x >= 0 : w.plow.x <= W)
    }
    if (!w.arrival && w.arrivalLast && !w.plow && w.plowRuns === 1 && w.time > 30) break
  }
  const L = w.arrivalLast
  assert.ok(L, "a sequence ran")
  assert.strictEqual(L.source, "auto", "the deep ground called it")
  const log = L.log
  const hare = at(log, "hare-arrived"), birdIn = at(log, "bird-in"), landed = at(log, "bird-landed")
  const called = at(log, "plow-called"), seen = at(log, "plow-seen")
  const hareFled = at(log, "hare-fled"), birdFled = at(log, "bird-fled"), cleared = at(log, "plow-cleared")
  // 1. the hare first
  assert.ok(hare > 0, "hare arrived")
  assert.ok(at(log, "hare-called") < hare)
  // 2. the robin about 5 s after it
  assert.ok(Math.abs(birdIn - hare - 5) < 0.05, "robin flies in at +" + (birdIn - hare).toFixed(2) + " s")
  assert.ok(landed > birdIn && landed - birdIn < 3, "and lands")
  // 3. both linger 6-8 s after the robin lands, the plow held all the while
  assert.ok(called - landed >= 6 - 0.02 && called - landed <= 8 + 0.02, "linger " + (called - landed).toFixed(2) + " s")
  const linger = samples.filter(s => s.t > landed + 0.1 && s.t < called - 0.05)
  assert.ok(linger.length > 300)
  for (const s of linger) {
    assert.ok(!s.plow, "no plow while they linger")
    assert.ok(s.hare && s.hare !== "bolt", "the hare stays (" + s.hare + ")")
    assert.strictEqual(s.bird, "perch", "the robin stays")
  }
  assert.ok(new Set(linger.map(s => s.hare)).size >= 2, "the hare moves about: " + [...new Set(linger.map(s => s.hare))])
  assert.ok(samples.filter(s => s.t < called - 0.01).every(s => !s.plow), "the plow never came before its call")
  // 4. the plow enters
  assert.ok(Math.abs(plowFirst - called) < 0.02, "the plow is out when called")
  assert.ok(seen >= called, "and shows on the screen")
  // 5. they react to the plow: after it shows, away from it
  assert.ok(hareFled >= seen && birdFled >= seen, "both flee after the plow shows")
  assert.ok(fledWhilePlowShown, "with the plow on the screen")
  assert.strictEqual(hareDirAtFlee, plowDir, "the hare runs away from the plow")
  assert.ok(log.find(x => x.e === "hare-fled").why, "and says what sent it")
  // 6. the plow clears
  assert.ok(cleared > hareFled && cleared > birdFled, "the plow clears after they are gone")
  assert.ok(S.groundFill(w) < 0.06, "ground clear: " + S.groundFill(w))
  assert.strictEqual(w.plowRuns, 1)
  // The order, as a list.
  const order = ["hare-arrived", "bird-in", "bird-landed", "plow-called", "plow-seen", "plow-cleared"].map(e => at(log, e))
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], "order at " + i)
  // One hare and one robin, never a second.
  assert.strictEqual(rabbits.size, 1)
  assert.strictEqual(birds.size, 1)
}))

test("hidden mid-sequence: it is cancelled cleanly, the plow is not held, and comes again later with its visitors", () => withSeed(11, () => {
  const w = world(0.6)
  assert.strictEqual(S.requestPlow(w), "sent", "`flurry plow` starts the sequence")
  assert.strictEqual(S.requestPlow(w), "coming", "a second call is told it is coming")
  for (let i = 0; i < 60 * 9 && !(w.arrival && w.arrival.phase === "bird" && w.bird); i++) S.step(w, dt)
  assert.ok(w.arrival && w.rabbit && w.bird, "hare in, robin flying in")
  assert.strictEqual(S.quiet(w), false, "the idle loop stays awake")
  // The scene hides (SceneWindow: onVisibleChanged / onLiveChanged).
  assert.ok(S.cancelArrival(w, "scene hidden", "remove"))
  assert.strictEqual(w.arrival, null)
  assert.strictEqual(w.rabbit, null, "the hare is gone")
  assert.strictEqual(w.bird, null, "the robin is gone")
  assert.strictEqual(w.plow, null, "no plow drives on behind a hidden scene")
  assert.strictEqual(w.arrivalLast.outcome, "cancelled: scene hidden")
  assert.strictEqual(S.cancelArrival(w, "again"), false, "nothing left to cancel")
  // It rests, then the deep ground calls it again, with its visitors.
  const restAt = w.time
  let next = -1
  for (let i = 0; i < 60 * 80; i++) {
    S.step(w, dt)
    if (w.arrival && next < 0) next = w.time
    if (w.plow) break
  }
  assert.ok(next - restAt >= 10 - 0.6, "rested first (" + (next - restAt).toFixed(1) + " s)")
  assert.ok(w.plow, "and the plow came in the end")
  assert.ok(at(w.arrival.log, "hare-arrived") > 0, "after its hare")
}))

test("a workspace switch or the switch going off mid-sequence lets everyone go and never holds the plow", () => withSeed(3, () => {
  const w = world(0.6)
  S.requestPlow(w)
  for (let i = 0; i < 60 * 4; i++) S.step(w, dt)
  assert.ok(w.rabbit && w.rabbit.seq)
  S.cancelArrival(w, "workspace switched", "leave")
  assert.strictEqual(w.rabbit.mode, "bolt", "the hare runs off")
  assert.strictEqual(w.arrival, null)
  const off = world(0.6)
  S.requestPlow(off)
  for (let i = 0; i < 60 * 4; i++) S.step(off, dt)
  S.setPlow(off, false)
  assert.strictEqual(off.arrival, null, "switched off: no sequence")
  assert.ok(off.rabbit && off.rabbit.mode !== "bolt" && off.rabbit.stay < 1e8, "the hare stays on as an ordinary visitor")
  for (let i = 0; i < 60 * 30; i++) S.step(off, dt)
  assert.strictEqual(off.plow, null)
  assert.strictEqual(off.plowRuns, 0)
}))

test("the plow comes only on deep ground snow, starts with its visitors at the threshold, and cools down after", () => withSeed(5, () => {
  const thr = S.PLOW.threshold
  // Thin: never, however long.
  const thin = world(thr * 0.5)
  for (let i = 0; i < 60 * 120; i++) S.step(thin, dt)
  assert.strictEqual(thin.plow, null)
  assert.strictEqual(thin.arrival, null)
  assert.strictEqual(thin.plowRuns, 0)
  assert.strictEqual(thin.arrivalLast, null)
  // Just under the threshold: still not.
  const under = world(thr * 0.97)
  for (let i = 0; i < 60 * 10; i++) S.step(under, dt)
  assert.strictEqual(under.arrival, null)
  // Past it: the sequence starts within one check (0.5 s), and the plow follows.
  const deep = world(thr * 1.05)
  let started = -1
  for (let i = 0; i < 60 * 60 && !deep.plow; i++) { S.step(deep, dt); if (deep.arrival && started < 0) started = deep.time }
  assert.ok(started >= 0 && started <= 0.55, "sequence began at " + started)
  assert.ok(deep.plow, "and the plow came")
  assert.strictEqual(deep.arrival.source, "auto")
  // Cooldown: deep snow again the moment it has gone does not call it straight back.
  for (let i = 0; i < 60 * 60 && deep.plow; i++) S.step(deep, dt)
  assert.strictEqual(deep.plow, null)
  for (let i = 0; i < 60 * 10 && deep.arrival; i++) S.step(deep, dt)
  setGround(deep, 0.8)
  const gone = deep.time
  let again = -1
  for (let i = 0; i < 60 * 12 && again < 0; i++) { S.step(deep, dt); if (deep.arrival) again = deep.time }
  assert.ok(again - gone >= S.PLOW.rest - 0.6, "rested " + (again - gone).toFixed(1) + " s")
  // A thin ground never calls it however often it is checked; deep falling
  // snow does, on its own (a short heavy fall, no timer anywhere).
  const fall = S.createWorld(W, H, { effect: "snow", intensity: 2 })
  S.setEnv(fall, { snowScale: 2.5 })
  let firstFill = -1
  for (let i = 0; i < 60 * 600 && !fall.arrival; i++) {
    S.step(fall, 1 / 20)
    if (!fall.arrival) assert.ok(S.groundFill(fall) < thr + 0.02, "nothing came while the ground was under the threshold")
    if (firstFill < 0 && S.groundFill(fall) >= thr) firstFill = fall.time
  }
  assert.ok(fall.arrival, "a heavy fall brings it")
  assert.ok(fall.arrival.start - firstFill <= 0.6, "as soon as the ground passed the threshold")
}))

test("a hare and robin already here are taken in, no duplicates come, and the random visitors keep away", () => withSeed(9, () => {
  const w = world(0.3)
  assert.ok(S.spawnRabbit(w, { dir: 1 }))
  for (let i = 0; i < 60 * 4; i++) S.step(w, dt)
  assert.ok(S.spawnBird(w))
  for (let i = 0; i < 60 * 3; i++) S.step(w, dt)
  const hare = w.rabbit, robin = w.bird
  assert.ok(hare && robin && robin.mode === "perch")
  setGround(w, 0.6)
  assert.strictEqual(S.requestPlow(w), "sent")
  assert.strictEqual(w.rabbit, hare)
  assert.ok(w.arrival.reused.hare && w.arrival.reused.bird, "both taken in")
  // The schedule's visitors are refused while it runs, and the policy says why.
  assert.strictEqual(S.spawnRabbit(w), false)
  assert.strictEqual(S.spawnBird(w), false)
  const ctx = Object.assign(S.critterContext(w), { mode: "blizzard" })
  assert.strictEqual(Policy.surpriseBlock("rabbit", ctx), "the plow's visitors are here")
  assert.strictEqual(Policy.surpriseBlock("bird", ctx), "the plow's visitors are here")
  // Surprises switched off: the plow's two are not the surprises', they stay.
  S.dismissCritters(w)
  assert.ok(w.rabbit.mode !== "bolt" && w.bird.mode === "perch")
  for (let i = 0; i < 60 * 60 && !w.plow; i++) S.step(w, dt)
  assert.ok(w.plow)
  assert.strictEqual(w.rabbit, hare, "the same hare, never a second")
  assert.ok(w.arrival, JSON.stringify(w.arrivalLast && w.arrivalLast.log))
  const diag = Policy.diagReport({ now: 0, mode: "snow", ctx: Object.assign(S.critterContext(w), { plowArrival: S.arrivalSummary(w) }) })
  assert.strictEqual(diag.plowArrival.now.phase, "plow")
  assert.strictEqual(diag.plowArrival.timings.birdDelay, 5)
}))

test("in a blizzard (live weather, the Snow effect) the sequence still runs; in calm mode the plow comes alone; a scared-off pair never holds it", () => withSeed(13, () => {
  // A blizzard is the Snow effect with heavy wind and snow; the random
  // visitors' policy keeps them away, the plow's sequence does not ask it.
  const bz = world(0.6)
  S.setEnv(bz, { snowScale: 2.5, windBase: 70, windVar: 60 })
  for (let i = 0; i < 60 * 40 && !bz.plow; i++) S.step(bz, 1 / 30)
  assert.ok(bz.plow)
  assert.ok(at(bz.arrival.log, "hare-arrived") > 0 && at(bz.arrival.log, "bird-in") > 0, "hare and robin came first")
  const calm = world(0.6)
  S.setFeatures(calm, { calm: true })
  S.step(calm, dt)
  assert.ok(calm.plow, "calm: the plow at once")
  assert.strictEqual(calm.rabbit, null)
  assert.strictEqual(calm.bird, null)
  // The pointer chases them away again and again: the plow still comes, in
  // well under maxHold.
  const chased = world(0.6)
  let t0 = -1
  for (let i = 0; i < 60 * 60 && !chased.plow; i++) {
    const p = chased.rabbit ? { x: chased.rabbit.x, y: H - 20 } : (chased.bird ? { x: chased.bird.x, y: chased.bird.y } : null)
    S.step(chased, dt, { pointer: p })
    if (chased.arrival && t0 < 0) t0 = chased.time
  }
  assert.ok(chased.plow, "the plow came")
  assert.ok(chased.time - t0 <= S.ARRIVAL.maxHold + 0.1)
}))
