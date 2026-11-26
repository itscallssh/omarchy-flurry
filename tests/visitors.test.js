// The robin and the hare come on their own, with the real default
// settings, on an ordinary tiled desktop where the mouse is in use.
//
// The scheduler here is the one in Service.qml (surpriseTimer and
// surpriseAttempt) step for step: a check every Policy.SURPRISE.check ms
// against an absolute time (surpriseNextAt), the gates from Policy.gate
// with Store's defaults, the scene's context from Sim.critterContext, and
// the drag gate as SceneWindow.surpriseContext now computes it (a window
// changing place in the last half second with the pointer moving).
//   FLURRY_ROOT=/old/checkout node --test tests/visitors.test.js
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")

const ROOT = process.env.FLURRY_ROOT || path.join(__dirname, "..")
function load(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^\.pragma library\s*/m, "").replace(/^\.import .*$/mg, "")
  const names = [...src.matchAll(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/mg)].map(m => m[1])
  return new Function(src + "\nreturn {" + [...new Set(names)].map(n => n + ": " + n).join(", ") + "}")()
}
const S = load("lib/sim.js"), P = load("lib/policy.js"), Store = load("lib/store.js"), Season = load("lib/season.js")

// Omarchy's default look: a 1920x1080 screen less a 32 px bar, two tiled
// terminals with 10 px gaps reaching down to the ground.
const W = 1920, H = 1048
const rects = [{ id: "0x1", x: 10, y: 10, w: 945, h: 1028, floating: false, z: 0 },
               { id: "0x2", x: 965, y: 10, w: 945, h: 1028, floating: false, z: 1 }]

function run(minutes, opts) {
  opts = opts || {}
  const saved = Store.defaults()
  const env = Season.environment(new Date("2026-11-26T15:00:00"), { weather: null, seasons: saved.seasons, dayCycle: saved.dayCycle, override: "", springAt: 0, calm: false })
  const gate = P.gate({ onBattery: false, percent: 100, batterySaver: saved.batterySaver, calm: P.calmNow(saved.calm, saved.workHours, new Date("2026-11-26T15:00:00")), surprises: saved.surprises, fireworks: saved.newYear })
  const w = S.createWorld(W, H, { effect: saved.effect, intensity: saved.intensity, plow: saved.plow })
  S.setEnv(w, env)
  const dt = 1 / 15, check = (P.SURPRISE && P.SURPRISE.check) || 5000
  let now = 0, nextAt = 0, history = [], lastGeo = -10, lastPointerMove = -10, came = [], lastCheck = 0
  for (let t = 0; t < minutes * 60; t += dt) {
    now = t * 1000
    // The user at work: the mouse moves now and then, focus follows it.
    if (opts.mousing && Math.floor(t) % 3 === 0) lastPointerMove = t
    if (opts.dragEvery && t % opts.dragEvery < 2) lastGeo = t
    const list = rects.map(r => Object.assign({}, r, { z: opts.mousing && Math.floor(t / 3) % 2 ? 1 - r.z : r.z }))
    S.setSurfaces(w, list, w.time, ["0x1", "0x2"])
    S.step(w, dt)
    if (w.bird && w.bird.mode === "gone") w.bird = null
    if (!nextAt) nextAt = now + P.planSurprise(history, now, {}, Math.random, { first: true }).delay
    if (now - lastCheck < check) continue
    lastCheck = now
    if (now < nextAt) continue
    const ctx = Object.assign(S.critterContext(w), {
      mode: P.sceneMode(saved.effect, env, ""), surprises: saved.surprises, calm: gate.calm, lowPower: gate.quality < 0.5,
      decorating: false, fullscreen: false, dragging: t - lastGeo < 0.5 && t - lastPointerMove < 0.5
    })
    const kind = P.pickSurprise(history, now, ctx)
    let ok = false
    if (kind === "bird") ok = S.spawnBird(w)
    else if (kind === "rabbit") ok = S.spawnRabbit(w, { coat: "white" })
    else if (kind === "golden") ok = S.spawnGolden(w)
    if (ok) { history = P.remember(history, kind, now); came.push({ kind, at: t }) }
    nextAt = now + P.planSurprise(history, now, {}, Math.random, { missed: !ok }).delay
  }
  return came
}

test("with the default settings the robin comes within two minutes and the hare once snow lies", () => {
  const came = run(11, { mousing: true })
  const birds = came.filter(c => c.kind === "bird"), hares = came.filter(c => c.kind === "rabbit")
  assert.ok(came.length && came[0].at <= 120, "first visitor at " + (came[0] ? came[0].at.toFixed(0) + " s" : "never"))
  assert.ok(birds.length >= 1, "the robin came: " + JSON.stringify(came))
  assert.ok(hares.length >= 1, "the hare came: " + JSON.stringify(came))
  assert.ok(came.length >= 3, "a visit every few minutes: " + came.length + " in 11 min")
})

test("a busy desktop (windows rearranged every 20 s) does not keep them away", () => {
  const came = run(11, { mousing: true, dragEvery: 20 })
  assert.ok(came.some(c => c.kind === "bird") && came.some(c => c.kind === "rabbit"), JSON.stringify(came))
})

test("the shell side: an absolute schedule checked on a repeating timer, and a real-drag gate", () => {
  const svc = fs.readFileSync(path.join(ROOT, "Service.qml"), "utf8")
  const scene = fs.readFileSync(path.join(ROOT, "SceneWindow.qml"), "utf8")
  const timer = svc.slice(svc.indexOf("id: surpriseTimer"), svc.indexOf("id: surpriseTimer") + 1600)
  assert.match(timer, /repeat: true/, "the surprise timer repeats")
  assert.doesNotMatch(timer, /restart\(\)/, "no restart() from inside onTriggered")
  assert.match(timer, /now < root\.surpriseNextAt/, "it checks an absolute time")
  assert.match(scene, /c\.dragging = clock - lastGeometryChange < 0\.5/, "only a window changing place counts as a drag")
  assert.match(svc, /function liveScene\(\)/, "a visitor goes to a screen that is showing")
})

test("flurry diag says why no visitor comes", { skip: !P.surpriseWaiting && "old tree" }, () => {
  const base = { now: 1000, gates: { enabled: true, surprises: true }, timer: { running: true, nextAt: 5000, misses: 3 }, history: [] }
  assert.match(P.surpriseWaiting(Object.assign({}, base, { gates: { surprises: false } })), /Surprises are off/)
  assert.match(P.surpriseWaiting(Object.assign({}, base, { timer: { running: false } })), /not running/)
  assert.match(P.surpriseWaiting(Object.assign({}, base, { ctx: { mode: "rain", perches: 3 } })), /robin: no robins in rain; hare: the hare comes only in snow/)
  const r = P.diagReport(Object.assign({}, base, { ctx: { mode: "snow", perches: 3, groundSnow: 4 } }))
  assert.strictEqual(r.surprises.missesInARow, 3)
})
