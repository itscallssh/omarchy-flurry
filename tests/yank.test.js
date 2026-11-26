// A window yanked out from under its snow (the tablecloth trick): the snow's
// inertia keeps it where it was, kinetic friction gives it only a little of
// the window's speed, and the whole ledge comes off at once, there. A slow
// drag still carries it, and a jump with no pointer behind it (a layout
// change, a workspace switch, a keyboard move) still moves it with the
// window.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const S = load("lib/sim.js")

const dt = 1 / 60
const W = 1920, H = 1080
const TERM = { id: "0x55d1c0a3e2f0", x: 510, y: 300, w: 900, h: 460, floating: true, z: 0 }
const at = (r, dx, dy) => Object.assign({}, r, { x: r.x + (dx || 0), y: r.y + (dy || 0) })
const sum = a => a.reduce((x, y) => x + y, 0)
const loose = p => p.kind === "clump" || p.kind === "powder"

// The shell's view of things: the pointer on the title bar, still or
// dragging, and how often the windows are polled.
const still = r => ({ pointer: { x: r.x + 300, y: r.y + 12, vx: 0, vy: 0, present: true, stillFor: 3 }, poll: 0.2, layoutAge: 60 })
const drag = (r, vx) => ({ pointer: { x: r.x + 300, y: r.y + 12, vx, vy: 0, present: true, stillFor: 0 }, poll: 0.016, layoutAge: 60 })

function scene() {
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1.4, plow: false })
  S.setEnv(w, { tempC: -4, icicle: 1 })
  for (let t = 0; t < 60; t += dt) { S.setSurfaces(w, [TERM], w.time, [TERM.id], still(TERM)); S.step(w, dt) }
  // Snowfall off, the air cleared, a quarter second of the idle poll.
  S.setEnv(w, { snowScale: 0 }); w.particles = []
  for (let t = 0; t < 0.25; t += dt) { S.setSurfaces(w, [TERM], w.time, [TERM.id], still(TERM)); S.step(w, dt) }
  return w
}
const onLedge = w => { const s = w.surfaces[TERM.id]; return s ? sum(s.bins) + s.edges[0].m + s.edges[1].m : 0 }
const allSnow = w => S.totalSnow(w) + w.particles.reduce((t, p) => t + (loose(p) ? p.amount : 0), 0)
function ledgeX(w) {
  const s = w.surfaces[TERM.id]
  let m = 0, mx = 0
  s.bins.forEach((b, i) => { m += b; mx += b * (s.x + (i + 0.5) * S.CELL) })
  return mx / m
}
function airborne(w) {
  const list = w.particles.filter(loose)
  const m = sum(list.map(p => p.amount))
  return { m, x: sum(list.map(p => p.amount * p.x)) / (m || 1), list }
}

// Drags the window along x(t) (px from where it rests), sampled the way
// the shell sees a drag: the first sample after the pointer poll, then one
// every frame. Calls each(frame) after every step.
function run(w, secs, x, each) {
  let f = 0, prev = 0
  for (let t = 0.05; t < secs; t += dt, f++) {
    const dx = x(t)
    const r = at(TERM, dx)
    S.setSurfaces(w, [r], w.time, [TERM.id], drag(r, (dx - prev) / (f ? dt : 0.05)))
    prev = dx
    S.step(w, dt)
    if (each) each(f, r)
  }
}

// Changed in 1.2.5: the ledge no longer turns into a row of clumps at once.
// It slides off as a sheet (the window slides out from under it), each bit
// breaking off where the window's trailing edge passes under it, so it
// still falls where it was. Seen live, the row of clumps riding a shaken
// window looked like a string of beads.
function ledgeWorldX(w) {
  const s = w.surfaces[TERM.id]
  let m = 0, mx = 0, lo = Infinity
  s.bins.forEach((b, i) => { if (b > 0.05) { m += b; mx += b * (s.x + (i + 0.5) * S.CELL); lo = Math.min(lo, s.x + i * S.CELL) } })
  return { m, x: m ? mx / m : NaN, lo }
}
for (const V of [1500, 3000]) {
  test(`a yank to ${V} px/s: the ledge stays where it was while the window slides out from under it, and falls there`, () => {
    const w = scene()
    const ledge = onLedge(w), x0 = ledgeX(w), total = allSnow(w)
    assert.ok(ledge > 600, "a believable ledge: " + ledge)
    let at3 = null, fastest = 0, dust = 0, mid = null, offAt = null
    run(w, 1.2, t => -V * t, (f, r) => {
      if (f === 2) at3 = ledgeWorldX(w)
      if (f === 24) {
        // Where the snow is: what has fallen and what the window still holds.
        const a = airborne(w), l = ledgeWorldX(w)
        mid = { x: (a.m * a.x + (l.m ? l.m * l.x : 0)) / (a.m + l.m), win: r.x }
      }
      if (offAt === null && onLedge(w) < ledge * 0.02) offAt = f * dt
      for (const p of w.particles) {
        assert.ok(isFinite(p.x) && isFinite(p.y) && isFinite(p.vx) && isFinite(p.vy), "no NaN")
        if (p.kind === "clump" && p.y < H - 60) fastest = Math.max(fastest, Math.abs(p.vx))
        if (p.kind === "powder") dust = Math.max(dust, Math.abs(p.vx))
      }
    })
    // Three frames in, what is still on the window has not gone with it.
    assert.ok(Math.abs(at3.lo - TERM.x) < 12, `the ledge's far end stayed put: ${at3.lo.toFixed(0)} vs ${TERM.x}`)
    // It is all off by the time the window has passed from under it.
    assert.ok(offAt !== null && offAt < TERM.w / V + 0.15, `off the window after ${offAt} s`)
    assert.ok(mid.win < TERM.x - V * 0.35, "the window has gone: " + mid.win)
    assert.ok(Math.abs(mid.x - x0) < 60, `the snow fell where it was: mean x ${mid.x.toFixed(0)}, the ledge was at ${x0.toFixed(0)}`)
    assert.ok(fastest < 400, `no piece is thrown (before it lands): fastest ${fastest.toFixed(0)} px/s sideways`)
    assert.ok(dust < S.SNOW.shedMax, `powder stays plausible: ${dust.toFixed(0)} px/s`)
    assert.ok(onLedge(w) < ledge * 0.02, "none of it rode along: " + onLedge(w))
    assert.ok(!w.particles.some(p => p.hold), "nothing held up by a window that is gone")
    const after = allSnow(w)
    assert.ok(Math.abs(after - total) < total * 0.03, `mass kept as it falls and lands: ${after} of ${total}`)
  })
}

test("a window shaken back and forth: the snow sloshes as a sheet, spills over the ends, and what stays is one smooth ledge again", () => {
  let seed = 42
  const rnd = Math.random
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  try {
    const w = scene()
    const ledge = onLedge(w), total = allSnow(w)
    run(w, 3.4, t => t < 2 ? 160 * Math.sin(2 * Math.PI * 2.6 * t) : 0)
    const s = w.surfaces[TERM.id]
    assert.ok(!s.loose, "it grips again once the shaking stops")
    assert.ok(onLedge(w) < ledge * 0.95, "some spilled over the ends: " + onLedge(w).toFixed(0))
    assert.ok(!w.particles.some(p => p.hold), "no row of clumps riding the window")
    // No comb: neighbouring cells differ gently.
    let steep = 0
    for (let i = 1; i < s.bins.length; i++) steep = Math.max(steep, Math.abs(s.bins[i] - s.bins[i - 1]))
    assert.ok(steep < 3, "smooth ledge, steepest step " + steep.toFixed(2) + " px")
    for (let t = 0; t < 3; t += dt) { S.setSurfaces(w, [TERM], w.time, [TERM.id], still(TERM)); S.step(w, dt) }
    assert.ok(Math.abs(allSnow(w) - total) < total * 0.03, `mass kept: ${allSnow(w)} of ${total}`)
  } finally { Math.random = rnd }
})

test("a yank breaks the ledge into clumps of a few sizes and a little powder, and they tumble", () => {
  const w = scene()
  run(w, 0.5, t => -2400 * t)
  const clumps = w.particles.filter(p => p.kind === "clump")
  const radii = clumps.map(p => p.r)
  assert.ok(clumps.length > 40, "a row of pieces: " + clumps.length)
  assert.ok(Math.max(...radii) - Math.min(...radii) > 2, "of different sizes")
  assert.ok(w.particles.some(p => p.kind === "powder"), "some powder")
  assert.ok(clumps.filter(p => Math.abs(p.spin) > 1).length > clumps.length / 2, "tumbling")
  // Not one sheet: the pieces are spread out in height, not in one row.
  const ys = clumps.map(p => p.y), mean = sum(ys) / ys.length
  assert.ok(Math.sqrt(sum(ys.map(y => (y - mean) ** 2)) / ys.length) > 8, "spread out as they fall")
})

test("icicles snap, a perched bird takes off, and the shell hears of the yank", () => {
  const w = scene()
  const s = w.surfaces[TERM.id]
  assert.ok(s.icicles && s.icicles.some(i => i.len > 4), "icicles grew")
  S.spawnBird(w, { surface: TERM.id })
  for (let t = 0; t < 3; t += dt) { S.setSurfaces(w, [TERM], w.time, [TERM.id], still(TERM)); S.step(w, dt) }
  assert.strictEqual(w.bird.mode, "perch")
  S.takeEvents(w)
  run(w, 0.1, t => -2000 * t)
  assert.ok(w.particles.some(p => p.kind === "shard"), "the icicles fell")
  // Stubs (they may grow back a hair while the snow lies on the window).
  assert.ok(s.icicles.every(i => i.len <= 2.3), "only stubs are left")
  assert.strictEqual(w.bird.mode, "out")
  const ev = S.takeEvents(w).find(e => e.type === "yank")
  assert.ok(ev && ev.surface === TERM.id && Math.abs(ev.x - TERM.x) < 30, "a yank event where the window was")
})

test("a slow drag (up to 300 px/s) keeps the snow on the window", () => {
  for (const kind of ["eased", "sudden"]) {
    const w = scene()
    const ledge = onLedge(w), total = allSnow(w)
    // Eased: up to 300 px/s and back over two seconds. Sudden: 300 px/s from
    // the first poll on.
    const x = kind === "eased" ? t => { const u = Math.min(t / 2, 1); return 300 * u * u * (3 - 2 * u) * 4 / 3 } : t => 300 * Math.min(t, 1.5)
    run(w, 2.2, x)
    assert.ok(onLedge(w) >= ledge * 0.95, `${kind}: kept ${onLedge(w).toFixed(1)} of ${ledge.toFixed(1)}`)
    assert.ok(!w.particles.some(p => p.hold), "nothing left half-off")
    assert.ok(Math.abs(allSnow(w) - total) < total * 0.01, "mass kept")
  }
})

test("a short yank that stops: what the window still holds settles back, nothing floats", () => {
  const w = scene()
  const ledge = onLedge(w), total = allSnow(w)
  // 2000 px/s for a tenth of a second, then it stops dead.
  run(w, 2, t => -2000 * Math.min(t, 0.12))
  const s = w.surfaces[TERM.id]
  assert.ok(onLedge(w) > ledge * 0.4 && onLedge(w) < ledge * 0.95, `some fell, the rest settled back: ${onLedge(w).toFixed(0)} of ${ledge.toFixed(0)}`)
  assert.ok(!w.particles.some(p => p.hold), "nothing held")
  const hanging = w.particles.filter(p => loose(p) && p.y > s.y - 30 && p.y < s.y + 5 && Math.abs(p.vy) < 5)
  assert.strictEqual(hanging.length, 0, "nothing hangs at the window's top")
  assert.ok(Math.abs(allSnow(w) - total) < total * 0.03, `mass kept: ${allSnow(w)} of ${total}`)
})

test("a jump with no drag behind it moves the snow with the window, as before", () => {
  const cases = {
    "no pointer": () => null,
    "pointer still": r => still(r),
    "pointer far away": r => ({ pointer: { x: 1800, y: 1000, vx: -2000, vy: 0, present: true, stillFor: 0 }, poll: 0.2, layoutAge: 60 }),
    "a layout event just fired": r => Object.assign(drag(r, -2000), { layoutAge: 0.05 })
  }
  for (const name in cases) {
    const w = scene()
    const ledge = onLedge(w)
    const bins = w.surfaces[TERM.id].bins.slice()
    // Nothing new for a quarter second (the idle poll), then 600 px further.
    const r = at(TERM, -600, 40)
    for (let t = 0; t < 0.5; t += dt) { S.setSurfaces(w, [r], w.time, [TERM.id], cases[name](r)); S.step(w, dt) }
    assert.ok(onLedge(w) > ledge * 0.98, `${name}: kept ${onLedge(w).toFixed(1)} of ${ledge.toFixed(1)}`)
    assert.ok(Math.abs(S.restingY(w, TERM.id, r.x + 302) - (r.y - bins[75])) < 3, `${name}: the snow is on the window where it went`)
    assert.strictEqual(w.surfaces[TERM.id].vx, 0, `${name}: no speed read from a jump`)
  }
})

test("mid-drag, a big step with a lagging pointer reading is still a yank", () => {
  const w = scene()
  const ledge = onLedge(w)
  // A gentle drag the snow rides...
  run(w, 0.4, t => -100 * t)
  assert.ok(onLedge(w) > ledge * 0.97)
  // ...then one sample 240 px on, the pointer reading still where it was.
  const s = w.surfaces[TERM.id]
  const r = at(s, -240)
  S.setSurfaces(w, [r], w.time, [TERM.id], { pointer: { x: s.x + 300, y: s.y + 12, vx: -100, vy: 0, present: true, stillFor: 0 }, poll: 0.016, layoutAge: 60 })
  S.step(w, dt)
  assert.ok(s.loose, "the bond broke")
  // The window stopped there: the snow did not go with it. What the window
  // left from under falls, the rest settles back where it lies on screen.
  for (let t = 0; t < 1.5; t += dt) { const r2 = at(s, 0); S.setSurfaces(w, [r2], w.time, [TERM.id], still(r2)); S.step(w, dt) }
  const lw = ledgeWorldX(w)
  assert.ok(!s.loose, "settled back")
  assert.ok(lw.lo > r.x + 150, `its left end stayed near where it was: ${lw.lo.toFixed(0)} (window now from ${r.x.toFixed(0)})`)
  assert.ok(onLedge(w) < ledge * 0.85 && onLedge(w) > ledge * 0.4, "what the window left from under fell: " + onLedge(w).toFixed(0))
})
