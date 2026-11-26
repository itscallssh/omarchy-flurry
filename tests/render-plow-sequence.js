// Renders the plow's arrival: the hare hops in, the robin follows 5 s
// later, both potter about, the plow comes and they flee, then it clears.
// Seeded, so it renders the same every time.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-plow-sequence.js out.png
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const out = process.argv[2] || "plow-sequence.png"

let seed = 7
Math.random = function() {
  seed = (seed + 0x6D2B79F5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const W = 1280, H = 720, dt = 1 / 60, SCALE = 0.75
const wins = [
  { id: "a", x: 120, y: 110, w: 480, h: 330, floating: false, z: 1 },
  { id: "b", x: 690, y: 80, w: 460, h: 380, floating: false, z: 0 }
]
const w = S.createWorld(W, H, { effect: "snow", intensity: 1.2 })
S.setSurfaces(w, wins, 0)
// Let it snow a while, then lay the ground just under the plow's threshold
// and let the falling snow carry it over, so the depth calls it.
for (let i = 0; i < 60 * 25; i++) S.step(w, dt)
const g = w.surfaces[S.GROUND_ID]
g.bins = g.bins.map((b, i) => Math.max(b, S.TUNING.snow.groundCap * (S.PLOW.threshold - 0.01) * (0.85 + 0.3 * ((i * 7) % 10) / 10)))
S.setEnv(w, { snowScale: 0.5 })
let guard = 0
while (!w.arrival && guard++ < 60 * 120) S.step(w, dt)
if (!w.arrival) throw new Error("the depth never called the plow")

function at(e) { const A = w.arrival || w.arrivalLast; const n = A && A.log.find(x => x.e === e); return n ? n.t : -1 }
function paint(label) {
  const c = createCanvas(W, H), ctx = c.getContext("2d")
  const gr = ctx.createLinearGradient(0, 0, 0, H)
  gr.addColorStop(0, "#1b2335"); gr.addColorStop(1, "#3a4766")
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H)
  for (const q of wins) {
    ctx.fillStyle = "#11151f"; ctx.fillRect(q.x, q.y, q.w, q.h)
    ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(q.x, q.y, q.w, q.h)
  }
  const layer = createCanvas(W, H)
  D.world(layer.getContext("2d"), w)
  ctx.drawImage(layer, 0, 0)
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, 40)
  ctx.fillStyle = "#fff"; ctx.font = "bold 22px sans-serif"
  const t0 = (w.arrival || w.arrivalLast).start
  ctx.fillText(label + "   (t = +" + (w.time - t0).toFixed(1) + " s, ground fill " + S.groundFill(w).toFixed(2) + ")", 14, 28)
  return c
}

// Shots, each taken when its moment comes.
const shots = [
  { label: "1. the hare hops in", when: () => at("hare-arrived") > 0 && w.time >= at("hare-arrived") + 0.6 },
  { label: "2. +5 s: the robin flies in", when: () => w.bird && w.bird.mode === "in" && w.time >= at("bird-in") + 1.4 },
  { label: "3. both linger (hare sits up, robin pecks)", when: () => at("bird-landed") > 0 && w.time >= at("bird-landed") + 3.5 },
  { label: "4. the plow comes: the hare bolts, the robin flies off", when: () => at("hare-fled") > 0 && w.time >= Math.max(at("hare-fled"), at("bird-fled")) + 0.35 },
  { label: "5. the plow clears the snow", when: () => w.plow && w.plow.x > W * 0.5 }
]
const frames = []
let k = 0
guard = 0
while (k < shots.length && guard++ < 60 * 120) {
  S.step(w, dt)
  if (shots[k].when()) { frames.push(paint(shots[k].label)); k++ }
}
if (k < shots.length) throw new Error("missed shot " + k)
console.log(JSON.stringify(S.arrivalSummary(w).last || (w.arrival && w.arrival.log)))
const fw = Math.round(W * SCALE), fh = Math.round(H * SCALE)
const strip = createCanvas(fw, fh * frames.length + 4 * (frames.length - 1)), sctx = strip.getContext("2d")
sctx.fillStyle = "#000"; sctx.fillRect(0, 0, strip.width, strip.height)
frames.forEach((f, i) => sctx.drawImage(f, 0, (fh + 4) * i, fw, fh))
fs.writeFileSync(out, strip.toBuffer("image/png"))
console.log("wrote", out, strip.width + "x" + strip.height)
