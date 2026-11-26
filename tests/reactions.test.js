// Natural reactions to the desktop: a window opening shakes a little loose
// snow off the ledges near it, one closing drops its ledge with a small
// puff, and neither is ever more than a little (lib/sim.js REACT).
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")
const load = require("./load")
const S = load("lib/sim.js")

const dt = 1 / 60
const sum = a => a.reduce((x, y) => x + y, 0)
const total = w => Object.values(w.surfaces).reduce((t, s) => t + sum(s.bins) + s.edges[0].m + s.edges[1].m, 0)
  + w.particles.reduce((t, p) => t + (p.kind === "clump" || (p.kind === "flake" && p.amount) ? p.amount : 0) + (p.kind === "powder" ? p.amount || 0 : 0), 0)
const A = { id: "0xa", x: 100, y: 400, w: 600, h: 400, floating: false, z: 1 }
const B = { id: "0xb", x: 1500, y: 400, w: 300, h: 400, floating: false, z: 2 }
function snowy() {
  const w = S.createWorld(1920, 1080, { effect: "snow", intensity: 2, plow: false })
  S.setFeatures(w, { icicles: false, gusts: false })
  for (let t = 0; t < 30; t += dt) { S.setSurfaces(w, [A, B], w.time, [A.id, B.id]); S.step(w, dt) }
  S.setEnv(w, { snowScale: 0, windVar: 0 })
  w.particles = []
  return w
}

test("a window opening next to a snowy ledge knocks a little snow loose; far ledges and a restored window are left alone", () => {
  const w = snowy()
  const a0 = sum(w.surfaces[A.id].bins), b0 = sum(w.surfaces[B.id].bins), m0 = total(w)
  const C = { id: "0xc", x: 720, y: 300, w: 500, h: 500, floating: true, z: 0 }
  S.noteOpened(w, C.id)
  S.setSurfaces(w, [A, B, C], w.time, [A.id, B.id, C.id])
  const a1 = sum(w.surfaces[A.id].bins), b1 = sum(w.surfaces[B.id].bins)
  const loose = w.particles.filter(p => p.kind === "clump").length
  assert.ok(a1 < a0, "the near ledge lost some: " + (a0 - a1).toFixed(1))
  assert.ok(a0 - a1 < 0.05 * a0, "only a little: " + ((a0 - a1) / a0 * 100).toFixed(1) + "%")
  assert.strictEqual(b1, b0, "the far ledge is untouched")
  assert.ok(loose > 0 && loose <= 18 * 2, "a few clumps: " + loose)
  assert.ok(Math.abs(total(w) - m0) < 1e-6 * m0, "no snow made or lost")
  // A window coming back from another workspace is not an opening.
  const w2 = snowy()
  for (let t = 0; t < 0.5; t += dt) { S.setSurfaces(w2, [B], w2.time, [A.id, B.id]); S.step(w2, dt) }
  const before = w2.particles.length
  S.setSurfaces(w2, [A, B], w2.time, [A.id, B.id])
  assert.strictEqual(w2.particles.length, before, "no jostle without an openwindow")
  // An opening that never shows here is forgotten after a while.
  S.noteOpened(w2, "0xz")
  for (let t = 0; t < 11; t += 0.05) S.step(w2, 0.05)
  S.noteOpened(w2, "0xy")
  assert.ok(!("0xz" in w2.opening))
})

test("a window closing drops its ledge where it lay, with a small puff of dust", () => {
  const w = snowy()
  const m0 = total(w)
  S.setSurfaces(w, [B], w.time, [B.id])
  assert.ok(!w.surfaces[A.id])
  const dust = w.particles.filter(p => p.kind === "powder" && !p.amount)
  assert.ok(dust.length >= 2 && dust.length <= 10, "a small puff: " + dust.length)
  assert.ok(dust.every(p => p.vy < 0 && p.x >= A.x - 5 && p.x <= A.x + A.w + 5), "off its ledge, upward")
  assert.ok(w.particles.some(p => p.kind === "clump"), "the ledge falls")
  assert.ok(Math.abs(total(w) - m0) < 1e-6 * m0, "the puff carries no snow")
})

test("shell: openwindow reaches the scenes; a focus change is one read", () => {
  const sv = fs.readFileSync(path.join(__dirname, "..", "Service.qml"), "utf8")
  const sw = fs.readFileSync(path.join(__dirname, "..", "SceneWindow.qml"), "utf8")
  assert.match(sv, /signal windowOpenedAt\(string id\)/)
  assert.match(sw, /function onWindowOpenedAt\(id\) \{[^\n]*Sim\.noteOpened/)
  const focus = sv.slice(sv.indexOf('case "activewindowv2":\n'))
  assert.ok(/^case "activewindowv2":\s*\n(\s*\/\/[^\n]*\n)*\s*\{ Hyprland\.refreshToplevels\(\); root\.windowsReadAt = Date\.now\(\) \}\s*\n\s*break/.test(focus), "only a read")
})
