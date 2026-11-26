// What lies on a window (its frost, its ledge, its icicles) stays on that
// window: the regression tests for frost and ice left trailing a moving or
// shaken window (v1.5.x, seen on a real Hyprland desktop).
//
// Root cause: nothing on a window moves on its own (frost is one level per
// window, the ledge is heights per cell and the icicles offsets from its
// left edge, all in the window's own frame), but the overlay can only paint
// them where it last heard the window was. Hyprland tells a client where a
// window is over its socket, a few frames after the compositor has already
// moved it (about 2.3 frames, 38 ms, in the recording: up to 143 px at a
// hard shake), and no prediction can close that for a hand that turns.
//
// The fix: the compositor paints them itself (hyprland-plugin/, the
// flurry-anchor plugin), as a decoration of the window, at the window's
// position in the frame it draws. The overlay paints what lies on each
// window into two strips in the window's own frame (draw.js paintStrip)
// and hands them over (policy.js anchor*); the falling and shed snow stay
// with the overlay as before.
//
// These check the overlay's half: the strips hold everything that lies on
// the window and nothing else, are the same wherever the window is, leave
// nothing on the overlay once the plugin has them, and the requests are
// what the plugin reads (hyprland-plugin/tests/protocol_test.cpp checks
// the plugin's reading of the same lines).
"use strict"
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const { makeHarness, shakePath } = require("./attach-harness")
const S = load("lib/sim.js"), D = load("lib/draw.js"), P = load("lib/policy.js")
const dt = 1 / 60

let Canvas = null
try { Canvas = require("@napi-rs/canvas") } catch (e) { Canvas = null }
const needsCanvas = Canvas ? {} : { skip: "@napi-rs/canvas is not installed (NODE_PATH)" }

// A world with one window, deep in snow, frosted, with long icicles.
function snowy(rects, opts) {
  opts = opts || {}
  const w = S.createWorld(opts.width || 1920, opts.height || 1080, { effect: "snow", intensity: 2, plow: false })
  S.setFeatures(w, { icicles: true, border: 2 })
  const rest = { x: 5, y: 5, vx: 0, vy: 0, present: true, stillFor: 9, age: 0 }
  for (let t = 0; t < (opts.secs || 6); t += dt) {
    S.setSurfaces(w, rects, w.time, rects.map(r => r.id), { pointer: rest, poll: 0.2, layoutAge: 30 })
    S.step(w, dt, { pointer: rest })
  }
  for (const r of rects) {
    const s = w.surfaces[r.id]
    if (opts.depth !== undefined) for (let i = 0; i < s.bins.length; i++) s.bins[i] = opts.depth * (0.75 + 0.25 * Math.sin(i * 0.3))
  }
  S.freezeNow(w)
  if (opts.water) for (const r of rects) w.surfaces[r.id].water = opts.water
  w.particles = []
  return w
}
function pixels(width, height, paint) {
  const c = Canvas.createCanvas(width, height), ctx = c.getContext("2d")
  paint(ctx)
  return ctx.getImageData(0, 0, width, height).data
}
function inked(data) { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++; return n }
function strip(w, s, k) {
  const st = D.anchorStrips(s, w.border)[k]
  return pixels(Math.ceil(st.w), Math.ceil(st.h), ctx => D.paintStrip(ctx, w, s, st, 1))
}
function same(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
// The same picture, give or take the rasteriser: the same shape laid at
// another place on the canvas may round a few anti-aliased edge pixels
// differently (seen: frost 14 bytes at most 8 levels, an icicle's 0.7 px
// outline 89 bytes at most 37 levels, of a quarter million). Anything that
// moved by even a pixel differs on thousands of bytes.
function alike(a, b) {
  if (a.length !== b.length) return false
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n <= a.length * 0.0005
}

const WIN = { id: "0xa", x: 400, y: 300, w: 900, h: 420, floating: true, z: 0 }

test("the two strips hold everything that lies on the window", needsCanvas, () => {
  for (const [name, rect, opts] of [
    ["deep ledge, frost, long icicles, a film of water", WIN, { depth: 17.5, water: 400 }],
    ["icicles along the top (no room below)", { ...WIN, y: 620, h: 420 }, { depth: 14 }],
    ["a small window", { ...WIN, w: 160, h: 60 }, { depth: 12 }],
  ]) {
    const w = snowy([rect], opts), s = w.surfaces[rect.id]
    s.glaze = 1
    const W = w.width, H = w.height
    const all = pixels(W, H, ctx => D.drawAttached(ctx, w, s))
    assert.ok(inked(all) > 2000, name + ": something was painted")
    const strips = D.anchorStrips(s, w.border)
    let outside = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!all[(y * W + x) * 4 + 3]) continue
      const lx = x - s.x, ly = y - s.y
      if (!strips.some(t => lx >= t.ox && lx < t.ox + t.w && ly >= t.oy && ly < t.oy + t.h)) outside++
    }
    assert.strictEqual(outside, 0, name + `: ${outside} px painted outside the strips`)
    // And the strips paint all of it: their ink adds up to the whole.
    const ink = strips.reduce((n, t, k) => n + inked(strip(w, s, k)), 0)
    assert.ok(Math.abs(ink - inked(all)) <= inked(all) * 0.01 + 20, `${name}: strips ${ink} px, whole ${inked(all)} px`)
  }
})

test("a strip is the same wherever the window is: frost and ice keep their place on it", needsCanvas, () => {
  const w = snowy([WIN], { depth: 15 }), s = w.surfaces[WIN.id]
  const ref = [strip(w, s, 0), strip(w, s, 1)]
  // Vertical, horizontal, diagonal, off the screen's left and top edges,
  // and back: each with the window's state exactly as it was.
  for (const [dx, dy] of [[0, 240], [-333, 0], [181, -207], [-760, -290], [600, 400], [0, 0]]) {
    s.x = WIN.x + dx; s.y = WIN.y + dy
    assert.ok(alike(strip(w, s, 0), ref[0]) && alike(strip(w, s, 1), ref[1]), `moved by ${dx}, ${dy}: the strips changed`)
  }
})

test("shaken hard, the strips stay the window's own: nothing in them drifts, and the shed snow is not in them", needsCanvas, () => {
  // The recording's motion: quick strokes up and down, side to side and
  // diagonally, with a hard reversal at each end.
  const h = makeHarness({ S, D, path: shakePath({ strokes: 12, amp: 320, stroke: 0.08, hold: 0.03, ax: 1, ay: 0.7 }), delay: 0.03, snapshot: true, icicles: true })
  h.settle(4, 12)
  S.freezeNow(h.w)
  let shed = 0, frames = 0
  const s0 = h.w.surfaces[h.base.id]
  h.run(1.6, (fr, w, s) => {
    shed = Math.max(shed, w.particles.filter(p => p.kind === "clump" || p.kind === "powder").length)
    if (++frames % 6) return
    // The strip painted at the window's world position equals the strip
    // painted from the same state with the window put at the origin.
    const st = D.anchorStrips(s, w.border)[0]
    const here = pixels(Math.ceil(st.w), Math.ceil(st.h), ctx => D.paintStrip(ctx, w, s, st, 1))
    const x = s.x, y = s.y
    s.x = 0; s.y = 0
    const origin = pixels(Math.ceil(st.w), Math.ceil(st.h), ctx => D.paintStrip(ctx, w, s, st, 1))
    s.x = x; s.y = y
    assert.ok(alike(here, origin), "frame " + frames + ": the strip depends on where the window is")
    // Particles in the air (the shed snow) never reach a strip.
    const keep = w.particles
    w.particles = []
    const bare = pixels(Math.ceil(st.w), Math.ceil(st.h), ctx => D.paintStrip(ctx, w, s, st, 1))
    w.particles = keep
    assert.ok(same(here, bare), "frame " + frames + ": something in the air is painted into the strip")
  })
  assert.ok(shed > 0, "the shake still shed snow (the detached snow is untouched)")
  assert.strictEqual(h.w.surfaces[h.base.id], s0, "still the window's own surface")
})

test("once the plugin has a window's strips, the overlay paints nothing on that window", needsCanvas, () => {
  const w = snowy([WIN], { depth: 15 }), s = w.surfaces[WIN.id]
  const W = w.width, H = w.height
  const region = data => { let n = 0; for (let y = Math.max(0, s.y - 80); y < Math.min(H, s.y + s.h + 70); y++) for (let x = s.x - 20; x < s.x + s.w + 20; x++) if (data[(y * W + x) * 4 + 3]) n++; return n }
  const before = region(pixels(W, H, ctx => D.world(ctx, w)))
  w.anchored = { [WIN.id]: true }
  const after = region(pixels(W, H, ctx => D.world(ctx, w)))
  assert.ok(before > 2000, "painted on the overlay without the plugin: " + before)
  assert.strictEqual(after, 0, "nothing left on the overlay with it")
  // A second window without strips is still painted by the overlay.
  const w2 = snowy([WIN, { ...WIN, id: "0xb", x: 100, y: 820, w: 500, h: 200, z: 1 }], { depth: 15 })
  w2.anchored = { [WIN.id]: true }
  const b = w2.surfaces["0xb"]
  const data = pixels(W, H, ctx => D.world(ctx, w2))
  let n = 0
  for (let y = b.y - 30; y < b.y; y++) for (let x = b.x; x < b.x + b.w; x++) if (data[(y * W + x) * 4 + 3]) n++
  assert.ok(n > 500, "the other window's ledge is still on the overlay")
})

test("overlapping windows: each strip holds only its own window's frost and snow", needsCanvas, () => {
  const back = { id: "0xb", x: 300, y: 260, w: 1000, h: 500, floating: false, z: 3 }
  const front = { id: "0xf", x: 600, y: 420, w: 700, h: 400, floating: true, z: 0 }
  const w = snowy([back, front], { depth: 13 })
  const f = w.surfaces[front.id], b = w.surfaces[back.id]
  // The back window bare: its strips are empty though the front window's
  // ledge and icicles lie across its area.
  b.bins.fill(0); b.frost = 0; b.icicles = null; b.glaze = 0
  assert.strictEqual(inked(strip(w, b, 0)) + inked(strip(w, b, 1)), 0, "the back window's strips hold none of the front's")
  // The front window's strips are the same with or without the back one.
  const alone = snowy([front], { depth: 13 }), a = alone.surfaces[front.id]
  for (const k of ["bins", "rho", "slip"]) if (f[k]) a[k] = Float64Array.from(f[k])
  a.icicles = JSON.parse(JSON.stringify(f.icicles)); a.iceAt = f.iceAt; a.frost = f.frost; a.glaze = f.glaze; a.pack = f.pack; a.edges = JSON.parse(JSON.stringify(f.edges || null)); a.marks = f.marks
  alone.time = w.time
  assert.ok(same(strip(w, f, 0), strip(alone, a, 0)) && same(strip(w, f, 1), strip(alone, a, 1)), "the front window's strips do not depend on the window behind it")
})

test("resized: the strips follow the window's new size and still hold all of it", needsCanvas, () => {
  const w = snowy([WIN], { depth: 15 })
  const big = { ...WIN, w: 1300, h: 700 }
  const rest = { x: 5, y: 5, vx: 0, vy: 0, present: true, stillFor: 9, age: 0 }
  for (let t = 0; t < 0.5; t += dt) { S.setSurfaces(w, [big], w.time, [big.id], { pointer: rest, poll: 0.2, layoutAge: 30 }); S.step(w, dt, { pointer: rest }) }
  const s = w.surfaces[WIN.id]
  assert.strictEqual(s.w, 1300)
  const st = D.anchorStrips(s, w.border)
  assert.strictEqual(st[0].w, 1300 + 2 * D.ANCHOR.padX)
  assert.strictEqual(st[1].oy, 700 - D.ANCHOR.bottomIn, "the bottom strip sits on the new bottom edge")
  const W = w.width, H = w.height
  const all = pixels(W, H, ctx => D.drawAttached(ctx, w, s))
  let outside = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!all[(y * W + x) * 4 + 3]) continue
    const lx = x - s.x, ly = y - s.y
    if (!st.some(t => lx >= t.ox && lx < t.ox + t.w && ly >= t.oy && ly < t.oy + t.h)) outside++
  }
  assert.strictEqual(outside, 0)
})

test("the requests are the plugin's command lines, one per strip, and a closed window's strips are cleared", () => {
  const st = D.anchorStrips({ x: 0, y: 0, w: 900, h: 420 }, 2)
  const f0 = P.anchorFile("/run/user/1000/flurry-anchor", "0x55D0A1", "top", 4)
  assert.strictEqual(f0, "/run/user/1000/flurry-anchor/55d0a1-top-1.png")
  assert.strictEqual(P.anchorFile("/run/user/1000/flurry-anchor", "0x55d0a1", "top", 5), "/run/user/1000/flurry-anchor/55d0a1-top-2.png")
  assert.strictEqual(P.anchorFile("/run/a;b", "0x1", "top", 0), "", "a path that would split the batch is refused")
  assert.strictEqual(P.anchorFile("/run", "window", "top", 0), "", "only an address")
  const cmd = P.anchorSet("0x55d0a1", st[0], f0)
  assert.strictEqual(cmd, "/flurry set 0x55d0a1 top -16 -72 932 120 /run/user/1000/flurry-anchor/55d0a1-top-1.png")
  assert.strictEqual(P.anchorSet("0x55d0a1", st[1], "/x.png"), "/flurry set 0x55d0a1 bottom -16 414 932 68 /x.png")
  assert.strictEqual(P.anchorBatch([cmd, "", P.anchorClear("0xff")]), "[[BATCH]]" + cmd + ";/flurry clear 0xff")
  assert.strictEqual(P.anchorBatch(["", ""]), "")
  assert.deepStrictEqual(P.anchorReplies("ok\n\n\nflurry-anchor error: no such window\n\n\nok", 3), [true, false, true])
  assert.deepStrictEqual(P.anchorReplies("unknown request", 2), [false, false], "no plugin: nothing taken")
  assert.ok(P.anchorPingOk("flurry-anchor ok 1.0") && !P.anchorPingOk("unknown request"))
  assert.deepStrictEqual(P.anchorGone({ "0xa": true, "0xb": true, "0xc": false }, ["0xb"]), ["0xa"], "closed: cleared")
})

test("a window's attached state has a fingerprint that changes when what is painted changes", () => {
  const w = snowy([WIN], { depth: 10 }), s = w.surfaces[WIN.id]
  const a = D.attachedSig(w, s)
  assert.strictEqual(D.attachedSig(w, s), a)
  s.x += 300; s.y -= 100
  assert.strictEqual(D.attachedSig(w, s), a, "moving it changes nothing painted")
  s.bins[40] -= 3
  const b = D.attachedSig(w, s)
  assert.notStrictEqual(b, a, "snow shed off it")
  s.icicles[0].len *= 0.5
  assert.notStrictEqual(D.attachedSig(w, s), b, "an icicle snapped")
})

test("window tops fill about twice as fast as before; the ground keeps its pace", () => {
  function depth(catchRate) {
    const W = load("lib/sim.js")
    W.TUNING.snow.windowCatch = catchRate
    let seed = 99
    const rnd = Math.random
    Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    try {
      const w = W.createWorld(1920, 1080, { effect: "snow", intensity: 2, plow: false })
      const r = [{ id: "0xa", x: 300, y: 300, w: 840, h: 220, floating: true, z: 0 }]
      const rest = { x: 5, y: 5, vx: 0, vy: 0, present: true, stillFor: 9, age: 0 }
      for (let t = 0; t < 12; t += dt) { W.setSurfaces(w, r, w.time, ["0xa"], { pointer: rest, poll: 0.2, layoutAge: 30 }); W.step(w, dt, { pointer: rest }) }
      const sum = b => b.reduce((x, y) => x + y, 0)
      return { top: sum(w.surfaces["0xa"].bins), ground: sum(w.surfaces.__ground.bins) }
    } finally { Math.random = rnd }
  }
  const was = depth(1), now = depth(S.TUNING.snow.windowCatch)
  assert.ok(now.top > was.top * 1.8, `window top: ${now.top.toFixed(0)} now, ${was.top.toFixed(0)} before`)
  assert.ok(Math.abs(now.ground - was.ground) <= Math.max(5, was.ground * 0.15), `ground: ${now.ground.toFixed(0)} now, ${was.ground.toFixed(0)} before`)
})

test("batch completion waits for all n delimiter-terminated replies", () => {
  assert.strictEqual(P.anchorBatchComplete("ok", 1), false)
  assert.strictEqual(P.anchorBatchComplete("ok\n\n\n", 1), true)
  assert.strictEqual(P.anchorBatchComplete("ok\n\n\n", 2), false)
  assert.strictEqual(P.anchorBatchComplete("ok\n\n\nok\n\n\n", 2), true)
})

test("bounded collector and line stream reject oversized responses and unterminated lines immediately", () => {
  const c = P.newCollector(10)
  assert.strictEqual(P.collectChunk(c, "12345"), true)
  assert.strictEqual(P.collectChunk(c, "67890"), true)
  assert.strictEqual(c.buf, "1234567890")
  assert.strictEqual(P.collectChunk(c, "!"), false)
  assert.strictEqual(c.overflowed, true)
  assert.strictEqual(c.buf, "")

  // Multibyte UTF-8 counts by bytes, not UTF-16 code units.
  const u = P.newCollector(5)
  assert.strictEqual(P.collectChunk(u, "€€"), false)
  assert.strictEqual(u.overflowed, true)

  // Streaming line reader splits across chunks and trips before buffering an oversized unterminated line.
  const ls = P.newLineStream(16)
  const seen = []
  assert.strictEqual(P.pushLineChunk(ls, "{\"a\":", l => seen.push(l)), true)
  assert.strictEqual(P.pushLineChunk(ls, "1}\r\n{\"b\":2}\n", l => seen.push(l)), true)
  assert.deepStrictEqual(seen, ["{\"a\":1}", "{\"b\":2}"])
  assert.strictEqual(P.pushLineChunk(ls, "1234567890", l => seen.push(l)), true)
  assert.strictEqual(P.pushLineChunk(ls, "1234567", l => seen.push(l)), false)
  assert.strictEqual(ls.overflowed, true)
  assert.strictEqual(ls.buf, "")
})
