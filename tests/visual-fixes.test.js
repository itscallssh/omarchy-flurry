// Regressions for the visual bugs reported after v1.5.1: things resting on
// a window showing through a window in front of it, snow painting over the
// bar, a bare stretch of ground left under a window, and the icicles along
// a tall window's top reading as a dense, even comb.
//
// Each test reproduces the bug as the user saw it. To check one against an
// older tree (it should fail there), point FLURRY_ROOT at that tree:
//   FLURRY_ROOT=/path/to/old/checkout node --test tests/visual-fixes.test.js
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")

const ROOT = process.env.FLURRY_ROOT || path.join(__dirname, "..")
function load(rel) {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) return {}
  const src = fs.readFileSync(file, "utf8").replace(/^\.pragma library\s*/m, "").replace(/^\.import .*$/mg, "")
  const names = [...src.matchAll(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/mg)].map(m => m[1])
  return new Function(src + "\nreturn {" + [...new Set(names)].map(n => n + ": " + n).join(", ") + "}")()
}
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const P = load("lib/policy.js")
let createCanvas = null
try { createCanvas = require("@napi-rs/canvas").createCanvas } catch (e) {}
const needsCanvas = { skip: !createCanvas && "needs @napi-rs/canvas (NODE_PATH)" }

const dt = 1 / 60
const run = (w, rects, secs, alive) => {
  for (let t = 0; t < secs; t += dt) { S.setSurfaces(w, rects, w.time, alive || rects.map(r => r.id)); S.step(w, dt) }
}
// Pixels painted (alpha over 8) in a rectangle of a canvas.
function painted(ctx, x, y, w, h) {
  const px = ctx.getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).data
  let n = 0
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) n++
  return n
}

// ------------------------------------------------------------ bug 1

test("bug 1: leaves resting on a window are hidden where a window in front covers them", needsCanvas, () => {
  const back = { id: "0xb", x: 100, y: 260, w: 560, h: 300, floating: false, z: 1 }
  const front = { id: "0xf", x: 330, y: 120, w: 400, h: 400, floating: true, z: 0 }
  const w = S.createWorld(800, 600, { effect: "leaves", intensity: 1, plow: false })
  S.setFeatures(w, { icicles: false })
  run(w, [back, front], 0.2)
  w.particles = []
  // One leaf where the front window covers the back one's top edge, one
  // on the open stretch of that edge, one on the front window's own top.
  const leaf = (sid, s, ox) => ({ kind: "leaf", x: s.x + ox, y: s.y - 1, vx: 0, vy: 0, r: 9, vt: 90, angle: 0.1, spin: 0, phase: 0,
    freq: 1.5, sway: 50, tilt: 0, hue: 1, life: 1e6, age: 0, rest: sid, ox, slide: 0, restAge: 1 })
  w.particles.push(leaf(back.id, back, 330), leaf(back.id, back, 80), leaf(front.id, front, 200))
  const c = createCanvas(800, 600), ctx = c.getContext("2d")
  D.world(ctx, w)
  // Inside the front window's face, where the hidden leaf lies.
  assert.strictEqual(painted(ctx, back.x + 330 - 12, back.y - 8, 24, 14), 0, "the covered leaf shows through the window in front")
  assert.ok(painted(ctx, back.x + 80 - 10, back.y - 6, 20, 10) > 20, "the uncovered leaf on the back window is painted")
  assert.ok(painted(ctx, front.x + 200 - 10, front.y - 6, 20, 10) > 20, "the leaf on the front window is painted")
})

test("bug 1: a robin perched and petals resting on a covered window are hidden too", needsCanvas, () => {
  const back = { id: "0xb", x: 60, y: 300, w: 600, h: 260, floating: false, z: 1 }
  const front = { id: "0xf", x: 200, y: 150, w: 360, h: 400, floating: true, z: 0 }
  const w = S.createWorld(800, 600, { effect: "sakura", intensity: 1, plow: false })
  S.setFeatures(w, { icicles: false })
  run(w, [back, front], 0.2)
  w.particles = [{ kind: "petal", x: back.x + 300, y: back.y - 1, vx: 0, vy: 0, r: 6, angle: 0, spin: 0, phase: 0, hue: 0,
                   life: 1e6, age: 0, rest: back.id, ox: 300, slide: 0, restAge: 1, restLeft: 30 }]
  w.bird = { mode: "perch", s: back.id, ox: 250, x: back.x + 250, y: back.y, facing: 1, flap: 0, act: "", actT: 0, timer: 9,
             stay: 30, hopY: 0, hopsLeft: 0, peck: 0, vx: 0, vy: 0, look: 0, lookT: 2, t: 0 }
  const c = createCanvas(800, 600), ctx = c.getContext("2d")
  D.world(ctx, w)
  assert.strictEqual(painted(ctx, front.x + 4, back.y - 16, front.w - 8, 18), 0, "a petal or the robin shows through the window in front")
})

// ------------------------------------------------------------ bug 3

function groundMean(w, x0, x1) {
  const g = w.surfaces.__ground.bins
  let s = 0, n = 0
  for (let i = Math.floor(x0 / 4); i < Math.floor(x1 / 4); i++) { s += g[i]; n++ }
  return s / n
}

test("bug 3: a window held low over the ground and then lifted leaves no bare stretch under it", () => {
  const W = 1920, H = 1080
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  S.setFeatures(w, { icicles: false })
  const win = { id: "0xa", x: 600, y: H - 420, w: 700, h: 400, floating: true, z: 0 }
  run(w, [win], 120)
  const lifted = Object.assign({}, win, { y: 120 })
  run(w, [lifted], 2)
  const under = groundMean(w, win.x + 60, win.x + win.w - 60)
  const beside = (groundMean(w, 60, win.x - 60) + groundMean(w, win.x + win.w + 60, W - 60)) / 2
  assert.ok(beside > 8, "snow built up on the ground: " + beside.toFixed(1))
  assert.ok(under > 0.8 * beside, "ground under the window " + under.toFixed(1) + " px vs " + beside.toFixed(1) + " px beside it")
  // A thaw takes it down evenly: still no hole.
  S.setEnv(w, { tempC: 4, melt: 0.02 })
  run(w, [lifted], 15)
  const under2 = groundMean(w, win.x + 60, win.x + win.w - 60)
  const beside2 = (groundMean(w, 60, win.x - 60) + groundMean(w, win.x + win.w + 60, W - 60)) / 2
  assert.ok(under2 > 0.8 * beside2, "after the thaw " + under2.toFixed(1) + " vs " + beside2.toFixed(1))
})

test("bug 3: the ground fills at the same pace whether or not windows stand over it, and the window still gets its ledge", () => {
  const W = 1600, H = 900
  const bare = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  const busy = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  S.setFeatures(bare, { icicles: false }); S.setFeatures(busy, { icicles: false })
  const wins = [{ id: "0x1", x: 0, y: 40, w: 790, h: 820, floating: false, z: 1 },
                { id: "0x2", x: 810, y: 40, w: 790, h: 400, floating: false, z: 2 },
                { id: "0x3", x: 810, y: 460, w: 790, h: 400, floating: false, z: 3 }]
  run(bare, [], 90); run(busy, wins, 90)
  const a = groundMean(bare, 0, W), b = groundMean(busy, 0, W)
  assert.ok(b > 0.85 * a && b < 1.2 * a, "ground with windows " + b.toFixed(1) + " px vs none " + a.toFixed(1) + " px")
  const ledge = busy.surfaces["0x1"].bins.reduce((x, y) => x + y, 0) / busy.surfaces["0x1"].bins.length
  assert.ok(ledge > 3, "the window's ledge still fills: " + ledge.toFixed(1))
})

// ------------------------------------------------------------ bug 4

function eaveRow(id) {
  const w = S.createWorld(2560, 1440, { effect: "snow", intensity: 1, plow: false })
  S.setEnv(w, { tempC: -4, icicle: 1 })
  // A tall tiled window: no room under it, so the icicles hang from the top.
  const win = { id, x: 20, y: 60, w: 1260, h: 1360, floating: false, z: 0 }
  run(w, [win], 200)
  const s = w.surfaces[id]
  const vis = s.icicles.filter(i => i.len > 2)
  const xs = vis.map(i => i.ox).sort((a, b) => a - b)
  const gaps = xs.slice(1).map((x, i) => x - xs[i])
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length
  const cv = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) * (v - m)))) / m }
  return { at: s.iceAt, perHundred: vis.length / win.w * 100, gapCv: cv(gaps), maxGap: Math.max(...gaps), lenCv: cv(vis.map(i => i.len)), n: vis.length }
}

test("bug 4: icicles along a tall window's top are sparse and irregular, not a comb", () => {
  for (const id of ["0x55d1c0a3e2f0", "0xabc", "0x1234567", "0xdead"]) {
    const r = eaveRow(id)
    assert.strictEqual(r.at, "top")
    assert.ok(r.n >= 4, id + ": some icicles still grow: " + r.n)
    assert.ok(r.perHundred < 2.6, id + ": " + r.perHundred.toFixed(2) + " icicles per 100 px")
    assert.ok(r.gapCv > 0.7, id + ": spacing too even (CV " + r.gapCv.toFixed(2) + ")")
    assert.ok(r.maxGap > 120, id + ": no bare stretch along the edge (widest gap " + r.maxGap.toFixed(0) + " px)")
    assert.ok(r.lenCv > 0.35, id + ": lengths too alike (CV " + r.lenCv.toFixed(2) + ")")
  }
})

test("bug 4: icicles under a floating window keep their full row", () => {
  const w = S.createWorld(1920, 1080, { effect: "snow", intensity: 1, plow: false })
  S.setEnv(w, { tempC: -4, icicle: 1 })
  const win = { id: "0x77", x: 400, y: 200, w: 800, h: 400, floating: true, z: 0 }
  run(w, [win], 200)
  const s = w.surfaces[win.id]
  assert.strictEqual(s.iceAt, "bottom")
  assert.ok(s.icicles.filter(i => i.len > 2).length / win.w * 100 > 3.5, "the bottom edge keeps a full row")
})
