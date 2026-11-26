// Frame time of the simulation and the drawing, per frame, on a heavy
// 2560x1440 scene: six windows (two floating, one dragged back and forth
// the whole time), full snow on their ledges and the ground, icicles on
// every window, autumn leaves resting on them, a light string, falling
// snow. Prints the median, p95 and max in ms for the sim, the draw and
// their sum. Pass another checkout's root to measure it with the same
// scene (before/after):
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/perf-frame.js [root] [frames]
// The drawing is timed through @napi-rs/canvas (Skia, CPU), a proxy for
// Qt's QPainter raster under the Canvas item, not a measurement of it.
const fs = require("fs"), path = require("path")
const root = process.argv[2] || path.join(__dirname, "..")
const FRAMES = +(process.argv[3] || 900)
function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), "utf8").replace(/^\.pragma library\s*/m, "").replace(/^\.import .*$/mg, "")
  const names = [...src.matchAll(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/mg)].map(m => m[1])
  return new Function(src + "\nreturn {" + [...new Set(names)].map(n => n + ": " + n).join(", ") + "}")()
}
const S = load("lib/sim.js"), D = load("lib/draw.js")
let createCanvas = null
try { createCanvas = require("@napi-rs/canvas").createCanvas } catch (e) {}

// Deterministic: the same random numbers for both trees.
let seed = 12345
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

const W = 2560, H = 1440 - 34, dt = 1 / 60
const rects = [
  { id: "0xa", cls: "kitty", x: 10, y: 10, w: 840, h: 1370, floating: false, z: 3 },
  { id: "0xb", cls: "chromium", x: 860, y: 10, w: 840, h: 680, floating: false, z: 2 },
  { id: "0xc", cls: "code", x: 1710, y: 10, w: 840, h: 1370, floating: false, z: 4 },
  { id: "0xd", cls: "kitty", x: 860, y: 700, w: 840, h: 680, floating: false, z: 5 },
  { id: "0xe", cls: "mpv", x: 300, y: 900, w: 620, h: 360, floating: true, z: 0 },
  { id: "0xf", cls: "nautilus", x: 1600, y: 520, w: 640, h: 420, floating: true, z: 1 }
]
const w = S.createWorld(W, H, { effect: "snow", intensity: 1.5, plow: false })
S.setEnv(w, { tempC: -3, icicle: 1, freeze: 0.5 })
const strings = [{ id: "L:0xe", surface: "0xe", palette: "classic" }]
const warm = (secs, list) => { for (let t = 0; t < secs; t += dt) { S.setSurfaces(w, list || rects, w.time); if (S.setStrings) S.setStrings(w, strings); S.step(w, dt) } }
warm(70)
S.freezeNow(w)
S.setEffect(w, "leaves"); warm(25)
S.setEffect(w, "snow"); warm(5)

const ctx = createCanvas ? createCanvas(W, H).getContext("2d") : null
// A context that only takes the calls, as Qt's Canvas does on the GUI
// thread in Cooperative mode (the commands are rasterised later on the
// render thread): the painter's own cost, without the rasteriser.
const NOOP = () => {}
const grad = { addColorStop: NOOP }
const rec = new Proxy({}, { get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient") ? () => grad
  : (k === "getImageData" ? () => ({ data: [] }) : (typeof k === "string" ? NOOP : undefined)), set: () => true })
const sim = [], draw = [], paint = []
for (let i = 0; i < FRAMES; i++) {
  // Window e is dragged in a loop the whole time (a long, fast drag).
  const list = rects.map(r => r.id === "0xe" ? Object.assign({}, r, { x: 300 + 900 * (0.5 - 0.5 * Math.cos(i * 0.02)), y: 900 - 300 * Math.sin(i * 0.013) }) : r)
  const t0 = process.hrtime.bigint()
  S.setSurfaces(w, list, w.time)
  if (S.setStrings) S.setStrings(w, strings)
  S.step(w, dt)
  const t1 = process.hrtime.bigint()
  if (ctx) { ctx.reset ? ctx.reset() : null; D.world(ctx, w) }
  const t2 = process.hrtime.bigint()
  D.world(rec, w)
  const t3 = process.hrtime.bigint()
  sim.push(Number(t1 - t0) / 1e6); draw.push(Number(t2 - t1) / 1e6); paint.push(Number(t3 - t2) / 1e6)
}
// The first 60 frames warm the JIT; leave them out.
const stat = a => { const b = a.slice(60).sort((x, y) => x - y); const q = p => b[Math.min(b.length - 1, Math.floor(p * b.length))]
  return { median: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), max: +b[b.length - 1].toFixed(3) } }
const total = sim.map((v, i) => v + draw[i])
const leaves = w.particles.filter(p => p.kind === "leaf" && p.rest).length
const over = (a, ms) => a.slice(60).filter(v => v > ms).length
console.log(JSON.stringify({ root, frames: FRAMES, framesOver4msSimPaintJs: over(sim.map((v, i) => v + paint[i]), 4), framesOver4msSimSkia: over(sim.map((v, i) => v + draw[i]), 4), particles: w.particles.length, restingLeaves: leaves,
  icicles: Object.values(w.surfaces).reduce((n, s) => n + (s.icicles ? s.icicles.filter(i => i.len > 1).length : 0), 0),
  sim: stat(sim), paintJs: stat(paint), simPlusPaintJs: stat(sim.map((v, i) => v + paint[i])),
  draw: ctx ? stat(draw) : null, total: ctx ? stat(total) : null }))
