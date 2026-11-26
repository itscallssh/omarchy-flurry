// Renders the robin's visit as a 4-frame strip: on the ground, flying up,
// on a window's top ledge (kicking snow off it), flying back down.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-robin-perch.js out.png
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js"), D = load("lib/draw.js")
const out = process.argv[2] || "flurry-robin-perch.png"
const W = 1600, H = 900, dt = 1 / 60
const BG = "#1e1e2e", WIN = "#181825", EDGE = "#89b4fa", TEXT = "#a6adc8"
const WINS = [{ id: "0xa", x: 520, y: 640, w: 520, h: 230, z: 0, floating: true, label: "~ $ nvim notes.md" }]

let seed = 20261126
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

const w = S.createWorld(W, H, { effect: "snow", intensity: 0.6, plow: false })
S.setEnv(w, { snowScale: 0.15 })
const g = w.surfaces.__ground
g.bins = g.bins.map((v, i) => 9 + 1.5 * Math.sin(i * 0.05))
S.setSurfaces(w, WINS, 0)
w.surfaces["0xa"].bins = w.surfaces["0xa"].bins.map((v, i) => 5 + Math.sin(i * 0.3))
const step = () => { S.setSurfaces(w, WINS, w.time); S.step(w, dt) }
for (let i = 0; i < 120; i++) step()

function frame(label) {
  const B = w.bird
  const PW = 520, PH = 640, k = 2
  const zx = 640, zy = 752
  const c = createCanvas(PW, PH), ctx = c.getContext("2d")
  const view = (cx) => { cx.scale(k, k); cx.translate(-(zx - PW / k / 2), -(zy - PH / k / 2)) }
  ctx.save(); view(ctx)
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H)
  for (const r of WINS) {
    ctx.fillStyle = WIN; ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = EDGE; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
    ctx.fillStyle = TEXT; ctx.font = "14px monospace"; ctx.fillText(r.label, r.x + 16, r.y + 40)
  }
  ctx.restore()
  const layer = createCanvas(PW, PH), lc = layer.getContext("2d")
  view(lc)
  D.world(lc, w)
  ctx.drawImage(layer, 0, 0)
  // A close-up of the robin, top right.
  const bx = (B.x - (zx - PW / k / 2)) * k, by = (B.y - 6 - (zy - PH / k / 2)) * k
  const Z = 3, box = 150
  ctx.fillStyle = "#11111b"; ctx.fillRect(PW - box - 12, 10, box + 4, box + 4)
  ctx.drawImage(c, bx - box / Z / 2, by - box / Z / 2, box / Z, box / Z, PW - box - 10, 12, box, box)
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(PW - box - 10, 12, box, box)
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, PH - 28, PW, 28)
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = "14px sans-serif"; ctx.fillText(label, 10, PH - 9)
  return c
}

const frames = []
S.spawnBird(w, { spots: [{ s: g, ox: 570, h: S.heightAt(g, 570), w: 1 }], from: -1 })
const B = w.bird
while (B.mode !== "perch") step()
B.dwell = 1e9
for (let i = 0; i < 50 || B.act === "hop"; i++) step()
frames.push(frame("1. on the ground: hops and pecks"))
S.birdFlies(w, B, { s: w.surfaces["0xa"], ox: 150, h: 5, w: 1 })
while (B.t < B.dur * 0.45) step()
frames.push(frame("2. flying up, wings beating, on an arc"))
while (B.mode !== "perch") step()
B.dwell = 1e9; B.timer = 0; B.kickDue = true
let kicked = false
for (let i = 0; i < 200 && !kicked; i++) { step(); if (B.act === "kick" && B.actT > 0.16) kicked = true }
for (let i = 0; i < 4; i++) step()
frames.push(frame("3. on the window's top ledge, kicking snow off"))
for (let i = 0; i < 40; i++) step()
S.birdFlies(w, B, { s: g, ox: 740, h: S.heightAt(g, 740), w: 1 })
while (B.t < B.dur * 0.55) step()
frames.push(frame("4. flying back down to the ground"))

const strip = createCanvas(530 * 4 - 10, 640), sc = strip.getContext("2d")
sc.fillStyle = "#11111b"; sc.fillRect(0, 0, strip.width, strip.height)
frames.forEach((f, i) => sc.drawImage(f, i * 530, 0))
fs.writeFileSync(out, strip.toBuffer("image/png"))
console.log("wrote", out)
