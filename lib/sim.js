.pragma library

// Flurry weather simulation.
//
// Pure JavaScript with no QML types, so the whole thing runs (and is tested)
// under node as well as inside the shell. One world per screen, in that
// screen's logical pixels, y pointing down. The QML side feeds it window
// rectangles and the pointer, steps it once per frame, and hands it to
// draw.js.
//
// The physics, in short:
//
//   * One gravity (G) for everything that has weight. Light things (flakes,
//     powder, petals) reach their terminal speed through drag against the
//     air, and the air itself moves: a slow wind, gusts that vary across the
//     screen, and the wake of a fast pointer.
//
//   * Surfaces are the exposed top edges things land on: every window on
//     the screen's active workspace plus the ground. Snow lies on them as a
//     height field (one bin per CELL px) that carries its own sliding speed
//     relative to the surface, so a pile can stick, creep, slide as a slab,
//     tear apart, and pour over an edge.
//
//   * Windows report positions only, so each surface tracks a smoothed
//     velocity and acceleration from those samples. In the window's frame
//     the snow feels gravity minus the window's acceleration. When the
//     sideways pull beats static friction the snow slides; kinetic friction
//     brakes it; whatever crosses an edge hangs as a small cornice and then
//     breaks off in chunks. If the window drops or stops climbing faster
//     than gravity the snow lifts off. A slow drag keeps the snow and a
//     hard stop throws it forward.
//
//   * A yank (see YANK) is judged per position sample rather than from the
//     smoothed estimate: when the window's change of speed outruns what
//     the snow's grip can pass on by enough, the bond breaks and the snow
//     keeps its own motion (inertia) while only kinetic friction pulls on
//     it. The window slides out from under it, and each piece falls the
//     moment the window no longer holds it up. A move with no pointer
//     dragging it (a layout change, a workspace switch) is a jump instead:
//     the snow rides along.
//
//   * Snow ages: fresh powder is loose, slides easily, and turns to dust
//     when it hits something; packed snow holds steeper slopes, sticks
//     better, and breaks into chunks. Falling chunks shed powder, break on
//     impact, and skid a little on whatever they land on.

var CELL = 4
var G = 1600                 // px/s², shared by everything with weight
var GRAVITY = G              // kept for callers of the earlier API
var GROUND_ID = "__ground"

var EFFECTS = ["snow", "leaves", "starfall", "rain", "sakura", "fireflies"]

// Per-effect tuning. Rates are spawns per second per 1000 px of screen width
// at intensity 1; fireflies are a population per 1000 px.
var TUNING = {
  // windowCatch: a flake landing on a window's top lies there this many
  // times its own volume (a window's ledge fills noticeably faster than
  // the ground bank, which keeps its own pace).
  snow:      { rate: 42,  cap: 18, groundCap: 26, windowCatch: 2.2 },
  leaves:    { rate: 1.4, restCap: 140 },
  starfall:  { rate: 0.32 },
  rain:      { rate: 240 },
  sakura:    { rate: 3.2, restMin: 20, restMax: 40 },
  fireflies: { population: 12 }
}

// Snow material. Friction coefficients and repose slopes are interpolated
// between fresh powder (pack 0) and settled snow (pack 1).
var SNOW = {
  // What holds snow on a window top is Coulomb friction (mu, scaled by the
  // apparent gravity) plus adhesion: the bond packed snow forms with the
  // frame. Together they are the pile's grip, in g; a sideways pull under
  // it is held. Once a hard enough yank breaks the bond, only kinetic
  // friction acts (see YANK), so the window slides out from under the snow.
  mu: [0.35, 0.5],           // static friction, powder .. settled
  adhesion: [1.25, 2.1],     // bond strength, in g, powder .. settled
  muStatic: [1.6, 2.6],      // grip = mu + adhesion, in g, as the gradual model uses it
  muKinetic: 0.72,           // kinetic friction while the bond holds, as a fraction of grip
  slipMax: 240,              // fastest snow slides over a window, relative to it, px/s
  repose: [0.85, 1.5],       // steepest stable slope (rise over run)
  cornice: [0.6, 2.2],       // how far past the repose slope an edge can hang, in cells
  chunk: [0.7, 4.5],         // mass of one falling chunk, in bin-px
  breakSpeed: 240,           // impact speed above which a chunk breaks up, px/s
  ageSeconds: 150,           // time for fresh snow to settle
  sprayFrom: 950,            // window speed above which loose powder blows off, px/s
  sprayAfter: 0.22,          // ... once it has kept that speed this long, s
  liftOff: -0.45,            // lift-off when apparent gravity falls under this share of G (snow sticks a little)
  liftAfter: 0.07,           // ... for this long, s
  liftTau: 0.3,              // s for lifted snow to leave the window, a clump at a time
  shedMax: 1400,             // fastest anything shed by a window may leave it, px/s
  shedBudget: 48             // chunks all windows together may shed in one frame
}

// A flake's lying volume: its disc area times this, in bin-px per CELL.
var FLAKE_VOLUME = 0.42

// The snow plow. Sizes are in px at a 1080 px tall screen and scale with
// the screen. It comes out when the ground snow passes `threshold` (mean
// depth as a share of the ground's capacity) and rests at least `rest`
// seconds between runs.
var PLOW = {
  threshold: 0.42,
  rest: 6,
  speed: 150,                // cruising speed, px/s
  accel: 0.9,                // s to close most of the gap to the target speed
  bodyLength: 160,           // blade edge to the back of the ripper
  bladeHeight: 34,
  roof: { back: -134, length: 50, height: 98 },
  stack: { x: -58, y: -86 },
  loadDrag: 400,             // berm mass (bin-px) that halves its speed
  minSpeedShare: 0.5,        // a full berm slows it to this share of cruising
  bermMax: 1.6,              // tallest berm, as a share of the blade's height
  liftSpeed: 1.6             // blade travel, full range per second
}
var PLOW_ID = "__plow"

// Light strings hung along a window's top edge. Clips hold the wire every
// `span` px; between them it hangs in a swag a few percent longer than the
// gap, and each swag carries a bulb on every other link.
var LIGHTS = {
  span: 150,                 // preferred gap between clips, px
  minSpan: 95, maxSpan: 240, // re-hang with a different clip count outside these
  inset: 10,                 // first and last clip, in from the window's corners
  drop: 2,                   // clips sit this far below the top edge
  links: 10,                 // links per swag
  slack: 1.1,                // swag length over the gap
  iterations: 12,
  airTau: 1.6,               // s for the wire to take up the air's speed
  socket: 9,                 // pendulum length of a bulb, px
  bulbDamping: 5.5,
  maxStrings: 8
}

var MAX_SPEED = 3200         // px/s cap on a window's estimated speed
var MAX_ACCEL = 4 * G        // px/s² cap on a window's estimated acceleration
var STALE = 0.12             // s without a new sample before a window counts as stopped
// A window that moves after a pause between samples (the shell polls slowly
// while nothing moves), or impossibly fast, jumped: a snap, a layout change,
// a workspace switch, or the first sample of a drag. Its snow rides along
// and no velocity is read from the jump.
var JUMP_GAP = 0.12          // s between samples
var JUMP_SPEED = 2800        // px/s

// A yank: the window's speed changes faster than the snow's grip can pass
// on. The window's velocity change over a sample interval, minus what the
// grip delivers in that time (grip * g * interval), is the speed the snow
// would have relative to the window if it let go. It is summed over
// samples (so the verdict does not depend on how often the shell polls) and
// bleeds off at the grip while the pull is weaker. Once it passes `breakDv`
// the bond breaks: every cell lets go at once and keeps its own (world)
// motion. `breakDv` is the relative speed at which kinetic friction would
// need `slipMin` px to catch the snow up again, sqrt(2 muK g slipMin): a
// pull that would slip the snow less than that is left to the gradual
// model. After the break only kinetic friction (muK) acts on the loose
// snow while the window still holds it up; whatever the window no longer
// holds up falls, from where it is.
var YANK = {
  muK: [0.2, 0.3],           // kinetic friction of loose snow on a window top, powder .. settled
  slipMin: 16,               // px of slip below which a jolt is no yank
  catchUp: 25,               // px/s: loose snow this close to the window's speed settles back onto it
  piece: [2, 6],             // cells per run the ledge breaks into
  mass: 16,                  // bin-px a piece of a run holds, about (a clump of radius 4.5)
  maxPieces: 260,            // most clumps one yank makes
  firstGap: 0.05,            // s added to the poll gap for the first sample of a drag (the pointer poll)
  dragMargin: 48,            // px around a window the pointer may be and still be dragging it
  layoutQuiet: 0.3           // s after a layout event (open, close, float, fullscreen, workspace) a move is no drag
}
// Loose snow on a window, after a yank (see slideLoose).
var LOOSE = {
  stale: 0.05,               // s without a sample before the window counts as stopped
  bond: 0.05                 // s for neighbouring cells to share their speed
}

// A window resized smaller under its snow (see track and remap).
var RESIZE = {
  lead: 0.03,                // s: an edge coming in is cut this far ahead of the last sample
  maxLead: 40,               // px, at most
  quiet: 0.2                 // s after an edge last came in that nothing overhangs it
}

// Snow that has just come down in pieces (a yanked ledge settling back, a
// heavy clump landing) is loose: for a moment it flows into a smooth,
// lumpy ledge instead of keeping the shape of the pieces (see reflow).
var REFLOW = {
  after: 0.9,                // s of loose flow after pieces settle back
  tau: 0.12,                 // s: how fast the bumps even out while loose
  grain: 0.06                // share of each cell left uneven, so it does not go flat
}

function breakDv(pack) { return Math.sqrt(2 * mix(YANK.muK, pack) * G * YANK.slipMin) }

function rand(a, b) { return a + Math.random() * (b - a) }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }
function lerp(a, b, t) { return a + (b - a) * t }
function pick(list) { return list[Math.floor(Math.random() * list.length)] }
function mix(range, t) { return lerp(range[0], range[1], clamp(t, 0, 1)) }
function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0) }
// Fraction of the way a first-order lag moves toward its target in dt.
function follow(dt, tau) { return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau) }

function isEffect(name) { return EFFECTS.indexOf(String(name)) >= 0 }

function createWorld(width, height, opts) {
  opts = opts || {}
  var world = {
    width: Math.max(1, width | 0),
    height: Math.max(1, height | 0),
    groundInset: opts.groundInset || 0,
    effect: isEffect(opts.effect) ? opts.effect : "snow",
    intensity: clamp(opts.intensity === undefined ? 1 : +opts.intensity, 0.25, 2),
    quality: 1,
    running: true,
    time: 0,
    frame: 0,
    particles: [],
    surfaces: {},
    stash: {},
    order: [],
    spawnDebt: 0,
    wind: 0,
    windTarget: 0,
    windTimer: 0,
    flash: 0,
    bolt: null,
    nextLightning: rand(10, 30),
    pendingFlash: -1,
    lastSurfaceTime: -1,
    plow: null,
    plowEnabled: opts.plow === undefined ? true : !!opts.plow,
    plowRest: 0,
    plowCheck: 0,
    plowDir: 1,
    plowRuns: 0,
    strings: {},
    balls: [],
    ballSeq: 0,
    hand: null,
    // Seasons, weather and the day (see setEnv and lib/season.js).
    env: neutralEnv(),
    // Air pushed by fast windows: id -> { x, y, w, h, vx, vy }.
    gusts: {},
    gustList: [],
    gustsOn: opts.gusts === undefined ? true : !!opts.gusts,
    iciclesOn: opts.icicles === undefined ? true : !!opts.icicles,
    gx: 0, gy: 0, sx: 0, sy: 0,
    shake: null,
    fw: null,
    sprouts: null,
    bird: null,
    rabbit: null,
    critterLeave: false,   // visitors switched off: anyone here leaves
    thud: null,            // where and when a snowball last burst
    faults: null,          // features that threw (see fault)
    golden: null,
    pen: null,
    markSeq: 0,
    shedLeft: SNOW.shedBudget,
    throwOut: false,
    // What happened that the shell should hear about: thrown snowballs
    // leaving the screen, a golden snowflake caught.
    events: []
  }
  world.surfaces[GROUND_ID] = makeSurface(GROUND_ID, 0, groundY(world), world.width, true)
  rebuildOrder(world)
  return world
}

function groundY(world) { return world.height - world.groundInset }

function zeros(n) {
  var a = new Array(n)
  for (var i = 0; i < n; i++) a[i] = 0
  return a
}

function makeSurface(id, x, y, w, ground) {
  var n = Math.max(1, Math.ceil(w / CELL))
  var s = {
    id: id, x: x, y: y, w: w, h: 0,
    ground: !!ground, floating: false, z: ground ? 1e9 : 0,
    bins: zeros(n),          // snow depth per cell, px
    slip: zeros(n),          // sliding speed of that snow relative to the surface, px/s
    grip: zeros(n),          // per-cell friction jitter, so a slab tears instead of moving as one
    pack: 0.5,               // 0 fresh powder .. 1 settled
    front: [], seen: true,
    vx: 0, vy: 0, ax: 0, ay: 0,
    rawVx: 0, rawVy: 0, sampleT: -1,
    py: y,                   // top at the start of the current step, for swept collisions
    edges: [{ m: 0, mom: 0, age: 0 }, { m: 0, mom: 0, age: 0 }],
    sliding: false
  }
  for (var i = 0; i < n; i++) s.grip[i] = rand(0.78, 1.22)
  return s
}

function resize(world, width, height, groundInset) {
  world.width = Math.max(1, width | 0)
  world.height = Math.max(1, height | 0)
  if (groundInset !== undefined) world.groundInset = groundInset
  var g = world.surfaces[GROUND_ID]
  var fresh = makeSurface(GROUND_ID, 0, groundY(world), world.width, true)
  for (var i = 0; i < Math.min(g.bins.length, fresh.bins.length); i++) fresh.bins[i] = g.bins[i]
  fresh.pack = g.pack
  if (g.rho) { var rho = rhoOf(fresh); for (var r = 0; r < Math.min(g.rho.length, rho.length); r++) rho[r] = g.rho[r] }
  world.surfaces[GROUND_ID] = fresh
  rebuildOrder(world)
}

function setEffect(world, name) {
  if (!isEffect(name) || world.effect === name) return
  world.effect = name
  world.spawnDebt = 0
  // Falling things of the old effect keep falling; things that only make
  // sense inside one effect go now.
  world.particles = world.particles.filter(function(p) {
    return p.kind !== "firefly" && p.kind !== "meteor" && p.kind !== "drop"
  })
  world.flash = 0
  world.bolt = null
}

function setIntensity(world, v) { world.intensity = clamp(+v || 1, 0.25, 2) }

// ------------------------------------------------------------------ air

// Horizontal air speed at a point: the slow wind plus gusts that drift
// across the screen, so neighbouring flakes move together but not in
// lockstep. The field is sampled once a frame on a coarse grid and read
// back bilinearly, which keeps the per-particle cost to a few multiplies.
var AIR_CELL = 96

function airSample(world, x, y) {
  var t = world.time
  var gust = Math.sin(x * 0.0037 + t * 0.61) * 0.55 + Math.sin(x * 0.0011 - y * 0.0047 + t * 0.23) * 0.45
  var swirl = Math.sin(y * 0.011 + x * 0.003 + t * 1.3) * 7
  var strength = world.effect === "rain" ? 55 : 14
  return world.wind + gust * strength + swirl
}

function updateAir(world) {
  var cols = Math.ceil((world.width + 640) / AIR_CELL) + 2
  var rows = Math.ceil((world.height + 160) / AIR_CELL) + 2
  var grid = world.air
  if (!grid || grid.length !== cols * rows) grid = world.air = zeros(cols * rows)
  world.airCols = cols
  world.airRows = rows
  for (var r = 0; r < rows; r++) {
    var y = r * AIR_CELL - 120
    for (var c = 0; c < cols; c++) grid[r * cols + c] = airSample(world, c * AIR_CELL - 320, y)
  }
}

function airAt(world, x, y) {
  var grid = world.air
  if (!grid) return airSample(world, x, y)
  var cols = world.airCols, rows = world.airRows
  var fx = clamp((x + 320) / AIR_CELL, 0, cols - 1.001)
  var fy = clamp((y + 120) / AIR_CELL, 0, rows - 1.001)
  var c = Math.floor(fx), r = Math.floor(fy)
  var tx = fx - c, ty = fy - r
  var i = r * cols + c
  var a = grid[i] + (grid[i + 1] - grid[i]) * tx
  var b = grid[i + cols] + (grid[i + cols + 1] - grid[i + cols]) * tx
  return a + (b - a) * ty
}

// Air pushed along by a fast pointer: a soft wake, strongest at the cursor.
function pointerWake(pointer, x, y, radius) {
  if (!pointer) return null
  var speed = Math.hypot(pointer.vx || 0, pointer.vy || 0)
  if (speed < 60) return null
  var dx = x - pointer.x, dy = y - pointer.y
  var d2 = dx * dx + dy * dy
  if (d2 > radius * radius) return null
  var d = Math.sqrt(d2) || 1
  var f = 1 - d / radius
  f = f * f
  var carry = Math.min(speed, 1400) / speed
  // Air is dragged along with the pointer and thrown outward from its path.
  return {
    x: (pointer.vx || 0) * carry * f * 0.55 + dx / d * f * Math.min(speed, 1400) * 0.25,
    y: (pointer.vy || 0) * carry * f * 0.45 + dy / d * f * Math.min(speed, 1400) * 0.18
  }
}

// ------------------------------------------------------------------ surfaces

// rects: [{ id, x, y, w, h, floating, z }] in screen-local px, z lower = in
// front (Hyprland's focusHistoryID). alive: optional ids of windows that
// still exist on other workspaces; their snow is put aside, not dropped.
function setSurfaces(world, rects, now, alive, motion) {
  var t = world.time
  // What the shell knows about the pointer and the window poll (see
  // dragging): { pointer: { x, y, vx, vy, present, stillFor }, poll: s
  // between window polls now, layoutAge: s since the last layout event }.
  world.motion = motion || null
  var seen = {}
  var keep = {}
  if (alive) for (var a = 0; a < alive.length; a++) keep[String(alive[a])] = true
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i]
    if (!r || !r.id || !(r.w >= 8) || !(r.h >= 8) || !isFinite(r.x) || !isFinite(r.y) || !isFinite(r.w) || !isFinite(r.h)) continue
    var id = String(r.id)
    if (id === GROUND_ID || id === PLOW_ID || seen[id]) continue
    seen[id] = true
    var s = world.surfaces[id]
    if (!s) {
      s = restore(world, id, r) || makeSurface(id, r.x, r.y, r.w, false)
      s.x = r.x; s.y = r.y; s.py = r.y
      s.sampleT = t
      world.surfaces[id] = s
      if (world.shared) world.shared.shown[id] = world
    } else {
      track(world, s, r, t)
    }
    // How old this reading was when it reached the world (s), for the
    // painter (see draw.js placeOf).
    s.sampleAge = isFinite(r.age) ? clamp(+r.age, 0, 0.1) : 0
    s.w = r.w; s.h = r.h
    s.floating = !!r.floating
    s.z = r.z === undefined || !isFinite(r.z) ? 0 : +r.z
  }
  var ids = Object.keys(world.surfaces)
  for (var j = 0; j < ids.length; j++) {
    var sid = ids[j]
    if (sid === GROUND_ID || sid === PLOW_ID || seen[sid]) continue
    var gone = world.surfaces[sid]
    delete world.surfaces[sid]
    if (world.shared && world.shared.shown[sid] === world) delete world.shared.shown[sid]
    if (keep[sid]) stashSurface(world, gone)
    else spill(world, gone)
    releaseFrom(world, sid)
  }
  // Snow put aside for a window that no longer exists anywhere goes too.
  var stash = stashOf(world)
  if (alive) for (var k in stash) if (!keep[k]) delete stash[k]
  world.lastSurfaceTime = t
  rebuildOrder(world)
}

// A window this world drew things on is gone from this screen (closed, or
// on another workspace or monitor, hidden, fullscreen): everything that
// belonged to it lets go at once instead of lingering where it was.
function releaseFrom(world, id) {
  delete world.gusts[id]
  for (var sid in world.strings) if (world.strings[sid].surface === id) delete world.strings[sid]
  if (world.pen && world.pen.s === id) world.pen = null
  if (world.bird && world.bird.s === id && world.bird.mode !== "out") flyOff(world.bird, 0)
  if (world.golden && world.golden.rest === id) world.golden.rest = null
  for (var b = 0; b < world.balls.length; b++) {
    var ball = world.balls[b]
    if (ball.contact === id) { ball.contact = null; ball.track = null; ball.lip = null }
  }
}

// A window's new rectangle. A pure move feeds its velocity estimate; a
// resize keeps the snow where it lies on screen and drops what the window
// no longer reaches.
//
// Telling a drag from a jump. The shell polls slowly while nothing moves,
// so the first sample of a drag arrives after a long gap, as does a snap,
// a layout change or a keyboard move. Those with no pointer behind them are
// jumps: the snow rides along and no velocity is read from them. One the
// pointer is dragging (it is moving, it is on or right by the window, it
// goes the same way, and no layout event just fired), or one that follows
// a drag sample closely, is a drag: its speed is the distance over the
// poll gap (plus the pointer poll, for the first sample), and if it beats
// the snow's grip by enough, the snow is yanked off (see yank).
function track(world, s, r, t) {
  var dx = r.x - s.x, dy = r.y - s.y
  var resized = Math.abs(r.w - s.w) > 0.5 || Math.abs(r.h - s.h) > 0.5
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !resized) return
  var gap = s.sampleT < 0 ? 1 : t - s.sampleT
  if (resized) {
    // An edge drawn in over the snow: the window is a frame or two ahead of
    // this sample, so cut ahead of it by how fast it is coming in, and
    // nothing hangs past the window while it shrinks (see remap).
    // The first sample of a resize follows a pause, so the gap since the
    // last change overstates the time it took: the poll gap bounds it.
    var pollGap = (world.motion && world.motion.poll) || YANK.firstGap
    var rgap = clamp(Math.min(gap, pollGap + YANK.firstGap), 1 / 120, 0.25)
    var inL = r.x - s.x, inR = (s.x + s.w) - (r.x + r.w)
    var lead = function(v) { return v > 0.5 ? clamp(v / rgap * RESIZE.lead, 0, RESIZE.maxLead) : 0 }
    var cutL = lead(inL), cutR = lead(inR)
    if (inL > 0.5) { s.shrinkT0 = t; s.leadL = cutL }
    if (inR > 0.5) { s.shrinkT1 = t; s.leadR = cutR }
    remap(world, s, r.x, r.w, cutL, cutR)
    s.loose = false
    s.wv = null
    s.x = r.x
    s.y = r.y
    s.rawVx = 0
    s.rawVy = 0
    s.yankU = 0
  } else {
    // Several samples can land in one frame, so never divide by less than
    // half a frame.
    var span = Math.max(gap, 1 / 120)
    var resting = gap > JUMP_GAP
    var drag = dragging(world, s, r, dx, dy, t)
    if (drag && resting) span = clamp((world.motion && world.motion.poll) || YANK.firstGap, 1 / 120, 0.25) + YANK.firstGap
    var vx = dx / span, vy = dy / span
    var sp = Math.hypot(vx, vy)
    if (!drag && (resting || sp > JUMP_SPEED)) {
      // A jump: the snow rides along. A window already moving keeps its
      // estimate; one at rest stays at rest, so a jump is never a jolt.
      var was = Math.hypot(s.vx, s.vy) > 30
      s.rawVx = was ? s.rawVx : 0
      s.rawVy = was ? s.rawVy : 0
      if (!was) { s.vx = 0; s.vy = 0; s.ax = 0; s.ay = 0 }
      s.jumped = t
      s.yankU = 0
      s.py = r.y
    } else {
      if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp }
      // The window's speed just before this interval: at rest after a pause.
      var vPrev = resting ? (Math.abs(s.vx) > 30 ? s.vx : 0) : s.rawVx
      var vPrevY = resting ? (Math.abs(s.vy) > 30 ? s.vy : 0) : s.rawVy
      if (drag) s.dragT = t
      s.rawVx = vx
      s.rawVy = vy
      // Snow whose bond has broken keeps its own speed on screen (see
      // slideLoose); this only decides when the bond breaks.
      if (!s.loose && yankCheck(s, vx - vPrev, span)) yank(world, s, r, dx, dy, span, vPrev, vPrevY)
    }
    // Whatever rides it moves with it: the snow is kept in the window's
    // own frame, so only these change.
    // The step this sample made, and over how long, for the painter: it
    // carries the window on by its own latest step to where the compositor
    // shows it when the frame reaches the screen (see draw.js placeOf). A
    // jump carries nothing on.
    // Its gap starts from the last reading that saw the window, moved or
    // still (s.stillT), so a drag's first step is timed right too.
    var stepGap = t - Math.max(s.sampleT, s.stillT === undefined ? -1e9 : s.stillT)
    var prev = s.step && s.step.t === s.sampleT ? s.step : null
    s.step = s.jumped === t ? null : { dx: dx, dy: dy, gap: stepGap, t: t,
                                       pdx: prev ? prev.dx : 0, pdy: prev ? prev.dy : 0, pgap: prev ? prev.gap : 0 }
    s.x = r.x
    s.y = r.y
  }
  if (resized) s.step = null
  s.sampleT = t
  s.stillT = undefined
}

// A fresh reading of the windows that shows this one where it was: it has
// stopped (or not moved since), so nothing is carried on past it. The
// shell calls this for readings that change nothing (see SceneWindow).
function noteStill(world, ids) {
  for (var i = 0; i < ids.length; i++) {
    var s = world.surfaces[String(ids[i])]
    if (s && !s.ground && s.sampleT < world.time) s.stillT = world.time
  }
}

// Is the pointer dragging this window? Hyprland reports no button state
// and no events during a drag, but a dragged window moves with the
// pointer: the pointer is moving, it is on the window (give or take the
// distance either reading may lag by), it goes the window's way, and no
// layout event (a window opened, closed, floated, went fullscreen, changed
// workspace) has just fired. A move that closely follows a drag sample
// counts as the same drag even if the pointer reading lags.
function dragging(world, s, r, dx, dy, t) {
  var m = world.motion
  if (!m) return false
  if (m.layoutAge !== undefined && m.layoutAge < YANK.layoutQuiet) return false
  if (s.dragT !== undefined && t - s.dragT < JUMP_GAP) return true
  var p = m.pointer
  if (!p || !p.present || !(p.stillFor < 0.25) || !isFinite(p.x + p.y)) return false
  // Either reading may be up to a poll old: allow for how far the pointer
  // goes in that time.
  var pv = Math.hypot(p.vx || 0, p.vy || 0)
  var lag = YANK.dragMargin + Math.min(Math.hypot(dx, dy), pv * 0.08)
  if (p.x < r.x - lag || p.x > r.x + r.w + lag || p.y < r.y - lag || p.y > r.y + r.h + lag) return false
  if (pv > 60 && (p.vx || 0) * dx + (p.vy || 0) * dy < 0) return false
  return true
}

// Sums up the speed the snow would slip at if it let go (see YANK): the
// window's change of speed beyond what the grip passes on in the interval.
// The pull bleeds off at the grip while it is weaker. True once it breaks
// the bond.
function yankCheck(s, dv, span) {
  var hold = mix(SNOW.muStatic, s.pack) * (1 + 0.6 * (s.glaze || 0)) * G * span
  var u = s.yankU || 0
  if (Math.abs(dv) > hold) u += dv - sign(dv) * hold
  else u = Math.abs(u) <= hold - Math.abs(dv) ? 0 : u - sign(u) * (hold - Math.abs(dv))
  if (!isFinite(u)) u = 0
  s.yankU = u
  if (Math.abs(u) <= breakDv(s.pack)) return false
  if (sumOf(s.bins) > 0.5 || edgeLoaded(s)) return true
  if (s.icicles) for (var i = 0; i < s.icicles.length; i++) if (s.icicles[i].len > 2.5) return true
  return false
}

// The window was yanked out from under its snow. The snow cannot follow:
// kinetic friction is all that pulls it, so it stays nearly where it was on
// screen while the window slides on under it, the ledge one sheet sliding
// over the window top (in the window's frame it moves the other way). Where
// the window no longer holds it up, at the trailing edge, it breaks off in
// clumps and falls straight from there. A window shaken back and forth
// sloshes its snow from end to end, losing some over each end. Once the
// snow has caught up with the window again it grips as before. Mass is
// kept exactly.
function yank(world, s, r, dx, dy, span, vPrev, vPrevY) {
  var muK = mix(YANK.muK, s.pack)
  var dir = sign(dx)
  // The snow's speed on screen after the interval, and how far it went.
  var gain = Math.min(Math.abs(dx / span - vPrev), muK * G * span)
  var vs = vPrev + dir * gain
  var moved = vPrev * span + dir * 0.5 * gain * span
  // The window pushes snow up with it; it cannot pull it down faster.
  var x0 = s.x + moved, y0 = Math.min(r.y, s.y + vPrevY * span)
  var n = s.bins.length
  // The bond breaks: from now on only kinetic friction holds the snow, and
  // the window slides out from under it as a sheet (see jolt and slide).
  // Whatever the window stops holding up breaks off at its edge and falls
  // from there, where the snow was on screen; nothing is thrown.
  s.loose = true
  s.looseMuK = muK
  s.yankU = 0
  // Each cell's own speed on screen, and where the window was when the
  // snow last moved (the window has gone dx since, the snow only `moved`).
  s.wv = new Array(n)
  for (var c0 = 0; c0 < n; c0++) s.wv[c0] = vs + s.slip[c0]
  s.loosePrevX = s.x + moved
  for (var e = 0; e < 2; e++) flushEdge(world, s, e)
  if (s.blown) { spawnChunks(world, x0 + s.w * 0.5, y0 - 1, s.blown, vs, vPrevY, s.pack); s.blown = 0 }
  // What lay on it (a flake, a leaf) stays where it was and falls.
  for (var a = 0; a < world.particles.length; a++) {
    var lay = world.particles[a]
    if (lay.rest !== s.id) continue
    lay.rest = null
    lay.x = x0 + lay.ox
    lay.y = y0 - 2
    lay.vx = vs + rand(-15, 15)
    lay.vy = vPrevY + rand(-20, 0)
    lay.phase = rand(0, 6.28)
  }
  // Icicles snap at the root: the window jerks, they do not.
  if (s.icicles) for (var c = 0; c < s.icicles.length; c++) {
    var ic = s.icicles[c]
    if (ic.len < 2) continue
    var stub = Math.min(ic.len * 0.25, 2), ilen = ic.len - stub
    world.particles.push({ kind: "shard", x: x0 + ic.ox, y: (s.iceAt === "top" ? y0 : y0 + s.h) + stub + ilen / 2, vx: vs + rand(-15, 15),
                           vy: vPrevY, len: ilen, w: ic.w, angle: 0, spin: rand(-5, 5) - dir * 2,
                           life: 5, age: 0, rest: null })
    ic.len = stub
    ic.drip = rand(3, 14)
  }
  // Writing in it goes with the snow; a bird perched there takes off.
  if (s.marks) s.marks = null
  if (s.fill) s.fill = zeros(n)
  if (world.pen && world.pen.s === s.id) world.pen = null
  if (world.bird && world.bird.s === s.id && world.bird.mode !== "out") flyOff(world.bird, -dir)
  pushEvent(world, { type: "yank", surface: s.id, x: x0, y: y0, w: s.w, vx: vs })
  s.yanked = world.time
}

// Loose snow on a window (see yank). Each cell keeps its own speed on
// screen (s.wv); kinetic friction alone pulls it toward the window's speed.
// Each frame it moves by its own speed less however far the window moved,
// read straight off the window's position, so a window that stops dead or
// reverses slides out from under it exactly. Neighbours hold together, so it
// moves as a sheet that stretches a little rather than as grains. What
// passes an edge breaks off there (breakEdge). Once all of it has nearly
// caught up with a window that has stopped jerking, it grips again.
function windowSpeed(world, s) {
  return world.time - s.sampleT > LOOSE.stale ? 0 : (s.rawVx || 0)
}
function slideLoose(world, s, dt) {
  var b = s.bins, u = s.slip, n = b.length
  if (!s.wv || s.wv.length !== n) { s.loose = false; s.wv = null; return }
  var V = windowSpeed(world, s)
  var f = (s.looseMuK || YANK.muK[0]) * G * dt
  var wv = s.wv, fast = 0
  // A bare cell takes the sheet's mean speed, so snow that slumps into it
  // keeps going with the rest instead of jumping to the window's speed.
  var sm = 0, smv = 0
  for (var a0 = 0; a0 < n; a0++) if (b[a0] >= 0.02) { sm += b[a0]; smv += b[a0] * wv[a0] }
  var sheet = sm > 0 ? smv / sm : V
  for (var i = 0; i < n; i++) {
    if (b[i] < 0.02) { wv[i] = sheet; continue }
    var rel = wv[i] - V, fr = f * s.grip[i]
    rel = Math.abs(rel) <= fr ? 0 : rel - sign(rel) * fr
    wv[i] = V + rel
  }
  var bond = follow(dt, LOOSE.bond)
  for (var j = 0; j + 1 < n; j++) {
    var ma = b[j], mb = b[j + 1]
    if (ma < 0.02 || mb < 0.02) continue
    var avg = (wv[j] * ma + wv[j + 1] * mb) / (ma + mb)
    wv[j] += (avg - wv[j]) * bond
    wv[j + 1] += (avg - wv[j + 1]) * bond
  }
  // Move: own travel minus the window's.
  var win = s.x - (s.loosePrevX === undefined ? s.x : s.loosePrevX)
  s.loosePrevX = s.x
  s.looseWin = win
  var nb = zeros(n), nm = zeros(n)
  for (var k = 0; k < n; k++) {
    var h = b[k]
    if (h <= 0) continue
    var rv = wv[k] - V
    var fpos = k + (wv[k] * dt - win) / CELL
    var i0 = Math.floor(fpos), t = fpos - i0
    for (var q = 0; q < 2; q++) {
      var jj = i0 + q, m = q === 0 ? h * (1 - t) : h * t
      if (m <= 0) continue
      if (jj < 0) feedEdge(s, 0, m, m * rv)
      else if (jj >= n) feedEdge(s, 1, m, m * rv)
      else { nb[jj] += m; nm[jj] += m * wv[k] }
    }
  }
  for (var c = 0; c < n; c++) {
    b[c] = nb[c]
    wv[c] = nb[c] > 1e-6 ? nm[c] / nb[c] : sheet
    u[c] = wv[c] - V
    if (nb[c] > 0.02 && Math.abs(u[c]) > fast) fast = Math.abs(u[c])
  }
  var grip = mix(SNOW.muStatic, s.pack) * Math.max(0, G - s.ay)
  // (An overhang still waiting to break off goes as loose snow first.)
  var settled = fast < YANK.catchUp && Math.abs(s.ax) < grip && Math.abs(V - s.vx) < 60
  if (settled && !edgeLoaded(s)) {
    for (var z = 0; z < n; z++) u[z] = 0
    s.loose = false
    s.wv = null
    s.sliding = false
    s.reflow = Math.max(s.reflow || 0, REFLOW.after * 0.6)
  } else s.sliding = true
}

// A piece of a yanked ledge the window may still hold up (see yank).
// Returns false once it has settled back onto the window.
function stepHeld(world, p, dt) {
  var s = world.surfaces[p.hold]
  var under = s && !s.ground && p.x >= s.x && p.x <= s.x + s.w && !(s.ay > G * (1 - SNOW.liftOff))
  if (!under) {
    // Off the window (or the window dropped away): it falls from here,
    // tumbling, a loose piece shedding a little powder as it breaks away.
    p.hold = null
    p.spin = rand(3, 8) * (Math.random() < 0.5 ? -1 : 1)
    // It tips off the edge rather than dropping level: a little scatter, so
    // the ledge comes apart instead of falling as one row.
    p.vy = clamp((s ? Math.min(s.vy, 0) : 0) + rand(-45, 35), -200, 200)
    p.vx += rand(-25, 25)
    // A big piece often breaks in two as it goes.
    if (p.amount > 9 && Math.random() < 0.45 && world.particles.length < maxParticles(world) * 1.15) {
      var half = p.amount * rand(0.3, 0.5)
      p.amount -= half
      p.r = clamp(Math.sqrt(p.amount * CELL / Math.PI), 1, 6.5)
      world.particles.push({ kind: "clump", x: p.x + rand(-3, 3), y: p.y + rand(-2, 2), vx: p.vx + rand(-30, 30), vy: p.vy + rand(-30, 20),
                             r: clamp(Math.sqrt(half * CELL / Math.PI), 1, 6.5), amount: half, pack: p.pack,
                             angle: rand(0, 6.28), spin: rand(-8, 8), life: p.life, age: p.age, rest: null, keep: true })
    }
    var dust = p.amount * 0.12 * (p.dust || 0)
    if (dust > 0.05 && world.particles.length < maxParticles(world) * 1.15) {
      p.amount -= dust
      p.r = chunkRadius(p.amount)
      addPowder(world, p.x, p.y, p.vx + rand(-20, 20), p.vy - rand(0, 25), dust, 14)
    }
    return true
  }
  // Still on it: kinetic friction drags it toward the window's speed.
  p.life += dt
  var rv = p.vx - s.vx
  var f = (p.muK || 0.25) * G * dt
  p.vx -= Math.abs(rv) <= f ? rv : sign(rv) * f
  p.x += p.vx * dt
  p.y = s.y - p.hy
  p.vy = s.vy
  if (Math.abs(p.vx - s.vx) < YANK.catchUp && world.time - (s.yanked || 0) > 0.08) {
    // Caught up: it settles back onto the window, all of it (it was this
    // window's snow a moment ago, so no room check).
    // Spread over its own width, so stacked pieces do not pile up.
    // A tent over twice its width, so neighbouring pieces run together.
    var n = s.bins.length
    var half = Math.max(2, Math.round(1.8 * p.r / CELL) + 1)
    var mid = (p.x - s.x) / CELL - 0.5
    var wsum = 0, wts = []
    for (var c = -half; c <= half; c++) { var wt = half + 1 - Math.abs(c); wts.push(wt); wsum += wt }
    for (var d = 0; d < wts.length; d++) s.bins[clamp(Math.round(mid) + d - half, 0, n - 1)] += p.amount * wts[d] / wsum
    s.reflow = Math.max(s.reflow || 0, REFLOW.after)
    return false
  }
  return true
}

// Re-cut the height field for a new left edge and width, keeping each cell's
// snow at the same place on screen. `cutL` / `cutR` (px): an edge coming in
// is cut this much further in, ahead of where the window will be by the
// time this frame shows (see track). What the window no longer holds up
// falls straight down from where it lay: an edge pulled in from under
// snow does not throw it, and the overhang on that side goes with it.
function remap(world, s, nx, nw, cutL, cutR) {
  var n = Math.max(1, Math.ceil(nw / CELL))
  var bins = zeros(n), slip = zeros(n), grip = new Array(n)
  for (var j = 0; j < n; j++) grip[j] = rand(0.78, 1.22)
  var shift = (s.x - nx) / CELL
  var lo = Math.ceil((cutL || 0) / CELL), hi = n - Math.ceil((cutR || 0) / CELL)
  var fallL = 0, fallR = 0
  for (var i = 0; i < s.bins.length; i++) {
    var h = s.bins[i]
    var k = Math.round(i + shift)
    if (k >= lo && k < hi && k >= 0 && k < n) {
      bins[k] += h
      slip[k] = s.slip[i]
      grip[k] = s.grip[i]
    } else if (h > 0.05) {
      if (k < n / 2) fallL++; else fallR++
      // Off the new edge: it falls from where it was, a crumbling run of
      // the ledge rather than a spray.
      spawnChunks(world, s.x + (i + 0.5) * CELL, s.y - h * 0.5, h, rand(-6, 6), rand(0, 12), s.pack)
    }
  }
  for (var side = 0; side < 2; side++) {
    var e = s.edges[side]
    if (e.m <= 0 || !((side === 0 ? cutL : cutR) > 0 || (side === 0 ? fallL : fallR))) continue
    var ex = side === 0 ? s.x - 2 : s.x + s.w + 2
    spawnChunks(world, ex, s.y - 2, e.m, rand(-6, 6), rand(0, 12), s.pack)
    e.m = 0; e.mom = 0; e.age = 0
  }
  s.bins = bins
  s.slip = slip
  s.grip = grip
  var dx = s.x - nx
  if (s.icicles) s.icicles = s.icicles.filter(function(ic) { ic.ox += dx; return ic.ox > 3 && ic.ox < nw - 3 })
  if (s.marks) s.marks = s.marks.filter(function(m) { m.x += dx; return m.x > 0 && m.x < nw })
  if (s.fill) s.fill = zeros(n)
  for (var p = 0; p < world.particles.length; p++) {
    var q = world.particles[p]
    if (q.rest === s.id) {
      q.ox += s.x - nx
      if (q.ox < 0 || q.ox > nw) release(q, s, s.vx, s.vy)
    }
  }
}

// A window that left the screen but still exists (another workspace, the
// special workspace hidden, another monitor): what lies on it is put aside
// whole, its snow, ice, and the leaves and petals resting on it, and comes
// back when the window does, never dropped and never doubled. With several
// screens the stash is shared between their worlds (world.shared, set by
// the shell), so a window moved to another monitor takes its snow along;
// when the other screen already shows it, it is handed straight over.
function stashSurface(world, s) {
  var rest = []
  var list = world.particles
  for (var i = 0; i < list.length; i++) {
    var p = list[i]
    if (p.rest === s.id) { p.dead = true; rest.push(p) }
  }
  if (rest.length) world.particles = list.filter(function(q) { return !q.dead })
  for (var k = 0; k < rest.length; k++) rest[k].dead = false
  var mass = sumOf(s.bins)
  if (mass < 0.5 && !hasIce(s) && !rest.length) return
  var other = world.shared ? world.shared.shown[s.id] : null
  if (other && other !== world && other.surfaces[s.id]) { handOver(world, other, s, rest); return }
  stashOf(world)[s.id] = { bins: s.bins.slice(), pack: s.pack, w: s.w, at: world.time, clock: world.shared ? world.shared.clock() : null,
                           icicles: s.icicles || null, glaze: s.glaze || 0, frost: s.frost || 0, iceAt: s.iceAt || null,
                           iceW: s.iceW || 0, rest: rest }
}
function stashOf(world) { return world.shared ? world.shared.stash : world.stash }

// Another world shows this window already: its snow is added to what that
// world has gathered on it since, cell for cell, and its resting leaves go
// with it.
function handOver(world, other, s, rest) {
  var t = other.surfaces[s.id]
  for (var i = 0; i < Math.min(t.bins.length, s.bins.length); i++) t.bins[i] += s.bins[i]
  if (s.icicles && !t.icicles) { t.icicles = s.icicles; t.iceW = s.iceW; t.iceAt = s.iceAt }
  t.glaze = Math.max(t.glaze || 0, s.glaze || 0)
  t.frost = Math.max(t.frost || 0, s.frost || 0)
  for (var k = 0; k < rest.length; k++) if (rest[k].ox < t.w) other.particles.push(rest[k])
}

function restore(world, id, r) {
  var stash = stashOf(world)
  var saved = stash[id]
  if (!saved) return null
  delete stash[id]
  var s = makeSurface(id, r.x, r.y, r.w, false)
  // Snow put aside melts a little while its window is out of sight.
  var away = saved.clock !== null && saved.clock !== undefined && world.shared ? (world.shared.clock() - saved.clock) : (world.time - saved.at)
  var keep = Math.exp(-Math.max(0, away) / 1800)
  for (var i = 0; i < Math.min(s.bins.length, saved.bins.length); i++) s.bins[i] = saved.bins[i] * keep
  s.pack = Math.min(1, saved.pack + 0.2)
  if (saved.icicles) s.icicles = saved.icicles.filter(function(ic) { return ic.ox < r.w - 4 })
  if (saved.iceAt) s.iceAt = saved.iceAt
  if (saved.iceW) s.iceW = saved.iceW
  s.glaze = saved.glaze
  s.frost = saved.frost || 0
  if (saved.rest) for (var k = 0; k < saved.rest.length; k++) {
    var p = saved.rest[k]
    if (p.ox >= r.w) continue
    p.rest = id
    world.particles.push(p)
  }
  return s
}

// This world is going (its screen left, or it is started afresh): the
// windows it showed are no longer shown by it.
function forgetWorld(world) {
  if (!world || !world.shared) return
  var shown = world.shared.shown
  for (var id in shown) if (shown[id] === world) delete shown[id]
}

// A stash shared by the worlds of every screen (see stashSurface). `clock`
// says how much time has passed, in s, the same for every world.
function sharedStash(clock) {
  return { stash: {}, shown: {}, clock: typeof clock === "function" ? clock : function() { return Date.now() / 1000 } }
}

function rebuildOrder(world) {
  var list = []
  for (var id in world.surfaces) list.push(world.surfaces[id])
  list.sort(function(a, b) { return inFront(a, b) ? -1 : (inFront(b, a) ? 1 : 0) })
  world.order = list
  for (var i = 0; i < list.length; i++) {
    var s = list[i]
    s.front = []
    if (s.ground) continue
    for (var k = 0; k < list.length; k++) {
      var o = list[k]
      if (o === s || o.ground) continue
      if (inFront(o, s) && overlaps(o, s)) s.front.push(o)
    }
  }
}

// Floating windows sit above tiled ones; within a layer the most recently
// focused is on top. The ground is behind everything for collisions.
function inFront(a, b) {
  if (a.ground !== b.ground) return b.ground
  if (a.floating !== b.floating) return a.floating
  return a.z < b.z
}

function overlaps(a, b) {
  var reach = TUNING.snow.cap * 2
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + Math.max(b.h, 1) && b.y - reach < a.y + Math.max(a.h, 1)
}

function covered(s, x, y) {
  for (var i = 0; i < s.front.length; i++) {
    var o = s.front[i]
    if (x >= o.x && x <= o.x + o.w && y >= o.y - 1 && y <= o.y + o.h) return true
  }
  return false
}

// A closing window drops everything on it: the snow keeps the window's
// last motion and falls.
function spill(world, s) {
  shedAll(world, s, 1, s.vx, s.vy, 4)
  for (var e = 0; e < 2; e++) flushEdge(world, s, e)
  for (var k = 0; k < world.particles.length; k++) {
    var p = world.particles[k]
    if (p.rest === s.id) release(p, s, s.vx, s.vy)
  }
  if (s.icicles) for (var c = 0; c < s.icicles.length; c++) breakIcicle(world, s, s.icicles[c])
  s.icicles = null
  s.marks = null
}

// Sheds `share` of the snow on every cell of s as loose falling snow: runs
// of `group` cells go as one clump each (plus a little dust), so a long
// ledge crumbles into a natural row of clumps instead of a solid sheet or a
// thousand specks. The snow keeps the window's motion, capped. Mass is
// conserved: whatever leaves the bins is carried by the clumps.
function shedAll(world, s, share, vx, vy, group) {
  var b = s.bins, n = b.length
  var sp = Math.hypot(vx, vy)
  if (sp > SNOW.shedMax) { vx *= SNOW.shedMax / sp; vy *= SNOW.shedMax / sp }
  var i0 = 0
  while (i0 < n) {
    // Clumps of uneven size, so they fall at different speeds and the row
    // breaks up as it falls.
    var i1 = Math.min(n, i0 + Math.max(1, group - 2 + Math.floor(Math.random() * 5)))
    var m = 0, top = 0, slip = 0
    for (var i = i0; i < i1; i++) {
      var take = b[i] < 0.05 ? b[i] : b[i] * share
      if (take <= 0) continue
      m += take
      slip += s.slip[i] * take
      if (b[i] > top) top = b[i]
      b[i] -= take
      if (b[i] < 1e-4) { b[i] = 0; s.slip[i] = 0 }
    }
    if (m >= 0.02) {
      var x = s.x + (i0 + (i1 - i0) / 2) * CELL
      spawnChunks(world, x, s.y - top * rand(0.2, 0.8) - 0.5, m, vx + clamp(slip / m, -SNOW.slipMax, SNOW.slipMax), vy + rand(-30, 25), s.pack)
    }
    i0 = i1
  }
}

function sumOf(a) {
  var t = 0
  for (var i = 0; i < a.length; i++) t += a[i]
  return t
}

// Snow depth under x, interpolated between cell centres.
function heightAt(s, x) {
  var n = s.bins.length
  var f = (x - s.x) / CELL - 0.5
  if (f < -0.5 || f > n - 0.5) return 0
  var i = Math.floor(f)
  var t = f - i
  var a = s.bins[clamp(i, 0, n - 1)]
  var b = s.bins[clamp(i + 1, 0, n - 1)]
  return a + (b - a) * t
}

// Where a particle moving from (x0,y0) to (x1,y1) during this step first
// meets an exposed top. Tops move too: a window rising into falling snow
// scoops it up, one dropping away leaves it in the air.
function collide(world, x0, y0, x1, y1, behind) {
  var reach = TUNING.snow.groundCap * 1.4 + 1
  // Snowfall that passed behind a window (its id) meets only what lies
  // behind that window: the windows further back and the ground.
  var past = behind ? world.surfaces[behind] || null : null
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (behind && !s.ground && (!past || s === past || !inFront(past, s))) continue
    // Cheap rejects first: still above the tallest pile, or already below
    // the top at both ends of the step.
    if (y1 < s.y - reach) continue
    if (y0 > (s.py > s.y ? s.py : s.y) + 0.5) continue
    if (x1 < s.x || x1 > s.x + s.w) continue
    // The strip a shrinking edge is about to leave holds nothing up.
    if (!s.ground && inLead(world, s, x1)) continue
    var h = heightAt(s, x1)
    var top1 = s.y - h
    var top0 = s.py - h
    // Nothing passes through the ground: a splash that starts inside a
    // deeper drift beside it lands on it too.
    if ((y0 <= top0 + 0.5 || s.ground) && y1 >= top1) {
      if (!s.ground && !behind && covered(s, x1, top1)) continue
      return { surface: s, y: top1 }
    }
  }
  return null
}

// Add snow at x, split between the two nearest cells. `drift` is the
// sliding speed the new snow brings relative to the surface.
function deposit(world, s, x, amount, drift) {
  var n = s.bins.length
  var f = clamp((x - s.x) / CELL - 0.5, 0, n - 1)
  var i = Math.floor(f)
  var t = f - i
  var cap = s.ground ? TUNING.snow.groundCap : TUNING.snow.cap
  addTo(s, i, amount * (1 - t), drift || 0, cap)
  if (i + 1 < n) addTo(s, i + 1, amount * t, drift || 0, cap)
  // New snow fills in what was written in it, and covers the glaze.
  if (s.fill) { s.fill[i] += amount * (1 - t); if (i + 1 < n) s.fill[i + 1] += amount * t }
  if (s.glaze) s.glaze *= Math.max(0, 1 - amount * 0.004)
  // Fresh snow lowers the pile's age in proportion to what it adds.
  var mass = sumOf(s.bins)
  if (mass > 0) s.pack = s.pack * Math.max(0, 1 - amount / mass)
}

function addTo(s, i, m, drift, cap) {
  if (m <= 0) return
  var h = s.bins[i]
  // Near the cap, fresh snow mostly blows off instead of building up.
  var room = clamp((cap - h) / (cap * 0.35), 0.04, 1)
  // and none lies past the cap.
  m = Math.min(m * room, Math.max(0, cap - h))
  if (m <= 0) return
  var total = h + m
  s.slip[i] = total > 0 ? (s.slip[i] * h + drift * m) / total : 0
  // Fresh snow on a pressed track loosens it in proportion.
  if (s.rho && s.rho.length === s.bins.length) s.rho[i] = total > 0 ? (s.rho[i] * h + m) / total : 1
  s.bins[i] = total
  if (drift) s.sliding = true
}

// ------------------------------------------------------------------ snow on surfaces

function stepSurface(world, s, dt) {
  s.py = s.py === undefined ? s.y : s.py
  if (!s.ground) kinematics(world, s, dt)

  var b = s.bins
  var mass = sumOf(b)
  if (mass < 0.01 && !edgeLoaded(s)) {
    if (mass > 0) for (var z = 0; z < b.length; z++) b[z] = 0
    s.sliding = false
    return
  }

  if (!isFinite(mass)) { resetBins(s); return }

  // Apparent gravity in the window's frame. Only a drop kept up for a
  // moment lifts the snow, and then it leaves a share at a time.
  var geff = G - s.ay
  if (!s.ground) s.floatT = geff < G * SNOW.liftOff ? (s.floatT || 0) + dt : 0
  if (!s.ground && s.floatT > SNOW.liftAfter && mass > 0.05) {
    liftOff(world, s, dt)
    return
  }

  if (s.loose) slideLoose(world, s, dt)
  else if (!s.ground || s.sliding) slide(world, s, dt, geff)
  slump(world, s, dt)
  if (s.reflow > 0) reflow(s, dt)
  if (!s.ground) trimShrinking(world, s)
  if (!s.ground) {
    spray(world, s, dt)
    for (var e = 0; e < 2; e++) breakEdge(world, s, e, dt)
  }
  drift(world, s, dt)

  // Snow settles with time; settled snow holds together. Warmth speeds it.
  var env = world.env
  s.pack += (1 - s.pack) * dt * (1 / SNOW.ageSeconds + env.settle)
  if (env.settle > 0 && mass > 1) compact(s, dt * env.settle * 0.15)

  if (world.effect !== "snow") melt(s, dt, s.ground ? 30 : 25)
  else {
    if (s.ground) melt(s, dt, 900)
    if (env.melt > 0) melt(s, dt, 1 / env.melt)
    // Cold, still nights glaze the snow; it thaws off in the warmth.
    var target = env.freeze
    s.glaze = (s.glaze || 0) + (target - (s.glaze || 0)) * follow(dt, target > (s.glaze || 0) ? 900 : 300)
    if (target === 0 && s.glaze < 0.002) s.glaze = 0
  }
}

function resetBins(s) {
  for (var i = 0; i < s.bins.length; i++) { s.bins[i] = 0; s.slip[i] = 0 }
  s.edges[0].m = s.edges[0].mom = 0; s.edges[1].m = s.edges[1].mom = 0
  s.sliding = false
}

// Settling: snow sinks under its own weight, a little.
function compact(s, k) {
  var f = Math.exp(-k)
  for (var i = 0; i < s.bins.length; i++) s.bins[i] *= f
}

function edgeLoaded(s) { return s.edges && (s.edges[0].m > 0 || s.edges[1].m > 0) }

// Smoothed velocity and acceleration of a window from its position samples.
// No new sample for a while means it stopped, which is itself a jolt.
function kinematics(world, s, dt) {
  if (dt <= 0) return
  var stale = s.sampleT < 0 || world.time - s.sampleT > STALE
  if (stale) s.yankU = 0
  var tx = stale ? 0 : s.rawVx
  var ty = stale ? 0 : s.rawVy
  var k = follow(dt, 0.07)
  var nvx = s.vx + (tx - s.vx) * k
  var nvy = s.vy + (ty - s.vy) * k
  // The acceleration is read off the smoothed speed, capped, and smoothed
  // again, so one late sample is never mistaken for a jolt.
  var ka = follow(dt, 0.06)
  s.ax += (clamp((nvx - s.vx) / dt, -MAX_ACCEL, MAX_ACCEL) - s.ax) * ka
  s.ay += (clamp((nvy - s.vy) / dt, -MAX_ACCEL, MAX_ACCEL) - s.ay) * ka
  s.vx = Math.abs(nvx) < 0.5 ? 0 : nvx
  s.vy = Math.abs(nvy) < 0.5 ? 0 : nvy
  if (s.vx === 0 && Math.abs(s.ax) < 1) s.ax = 0
  if (s.vy === 0 && Math.abs(s.ay) < 1) s.ay = 0
  if (!isFinite(s.vx + s.vy + s.ax + s.ay)) { s.vx = s.vy = s.ax = s.ay = 0; s.rawVx = s.rawVy = 0 }
  // How long it has kept up a high speed: only sustained speed sprays.
  var sp = Math.hypot(s.vx, s.vy)
  s.fastT = sp > SNOW.sprayFrom ? (s.fastT || 0) + dt : 0
}

// Friction against the surface, per cell. A cell at rest stays put until
// the sideways pull beats its grip; a sliding cell is braked by kinetic
// friction and sticks again once it stops. Neighbours drag on each other in
// proportion to how settled the snow is, so packed snow slides as slabs and
// powder smears and tears.
function slide(world, s, dt, geff) {
  var b = s.bins, u = s.slip, n = b.length
  // A frozen glaze holds the snow down harder.
  var muS = mix(SNOW.muStatic, s.pack) * (1 + 0.6 * (s.glaze || 0))
  var muK = muS * SNOW.muKinetic
  var pull = -s.ax                        // pseudo-force in the window's frame
  var normal = Math.max(0, geff)
  var moving = false
  for (var i = 0; i < n; i++) {
    if (b[i] < 0.02) { u[i] = 0; continue }
    var grip = muS * s.grip[i] * normal
    if (u[i] === 0) {
      if (Math.abs(pull) <= grip) continue
      // Breaks loose: the excess over static friction starts it moving.
      u[i] = (pull - sign(pull) * muK * normal) * dt
    } else {
      var before = u[i]
      u[i] += (pull - sign(u[i]) * muK * s.grip[i] * normal) * dt
      if (sign(u[i]) !== sign(before) && Math.abs(pull) <= grip) u[i] = 0
    }
    if (u[i] > SNOW.slipMax) u[i] = SNOW.slipMax
    else if (u[i] < -SNOW.slipMax) u[i] = -SNOW.slipMax
    if (u[i] !== 0) moving = true
  }
  if (!moving) { s.sliding = false; return }
  s.sliding = true

  // Cohesion: neighbouring snow pulls each other's speed together.
  var bond = follow(dt, 1 / (6 + 22 * s.pack))
  for (var j = 0; j + 1 < n; j++) {
    var ma = b[j], mb = b[j + 1]
    if (ma < 0.02 || mb < 0.02) continue
    var avg = (u[j] * ma + u[j + 1] * mb) / (ma + mb)
    u[j] += (avg - u[j]) * bond
    u[j + 1] += (avg - u[j + 1]) * bond
  }
  advect(world, s, dt)
}

// Move each cell's snow by its sliding speed, conserving mass and momentum.
// What crosses an edge collects there as an overhang.
function advect(world, s, dt) {
  var b = s.bins, u = s.slip, n = b.length
  var nb = zeros(n), nm = zeros(n)
  var outL = 0, outLm = 0, outR = 0, outRm = 0
  for (var i = 0; i < n; i++) {
    var h = b[i]
    if (h <= 0) continue
    var f = i + u[i] * dt / CELL
    var i0 = Math.floor(f)
    var t = f - i0
    for (var k = 0; k < 2; k++) {
      var j = i0 + k, m = k === 0 ? h * (1 - t) : h * t
      if (m <= 0) continue
      if (j < 0) { outL += m; outLm += m * u[i] }
      else if (j >= n) { outR += m; outRm += m * u[i] }
      else { nb[j] += m; nm[j] += m * u[i] }
    }
  }
  for (var c = 0; c < n; c++) {
    b[c] = nb[c]
    u[c] = nb[c] > 1e-6 ? nm[c] / nb[c] : 0
  }
  if (s.ground) return
  if (outL > 0) feedEdge(s, 0, outL, outLm)
  if (outR > 0) feedEdge(s, 1, outR, outRm)
}

function feedEdge(s, side, m, mom) {
  var e = s.edges[side]
  e.m += m
  e.mom += mom
}

// The overhang at an edge breaks off once it is heavier than the snow can
// hold, or after a moment if it is sliding fast. Packed snow goes in
// chunks, powder pours.
function breakEdge(world, s, side, dt) {
  var e = s.edges[side]
  if (e.m <= 0) { e.age = 0; return }
  e.age += dt
  var u = e.mom / e.m
  var hold = mix(SNOW.chunk, s.pack) * rand(0.8, 1.6)
  var shrinking = world.time - ((side === 0 ? s.shrinkT0 : s.shrinkT1) || -1e9) < RESIZE.quiet
  if (!shrinking && !s.loose && e.m < hold && e.age < 0.06 + 0.25 * s.pack && Math.abs(u) < 260) return
  flushEdge(world, s, side)
}

function flushEdge(world, s, side) {
  var e = s.edges[side]
  if (e.m <= 0) return
  // Loose snow slides at any speed relative to the window (see slideLoose).
  var ucap = s.loose ? MAX_SPEED : SNOW.slipMax * 1.5
  var u = clamp(e.mom / e.m, -ucap, ucap)
  var x = side === 0 ? s.x - 2 : s.x + s.w + 2
  var h = side === 0 ? s.bins[0] : s.bins[s.bins.length - 1]
  var wv = s.loose ? windowSpeed(world, s) : s.vx
  var vx = clamp(wv + u, -SNOW.shedMax, SNOW.shedMax), vy = clamp(s.loose ? Math.min(0, s.rawVy || 0) : s.vy, -SNOW.shedMax, SNOW.shedMax)
  // A loose sheet leaves the window wherever the edge has passed under it
  // this frame, so what broke off is spread over that stretch, outward of
  // the edge, not dropped from one point.
  var spread = s.loose ? Math.min(Math.abs(s.looseWin || 0), 160) : 0
  var parts = spread > 3 * CELL ? Math.min(8, Math.ceil(spread / (3 * CELL))) : 1
  var out = side === 0 ? -1 : 1
  for (var p = 0; p < parts; p++) {
    var px = parts > 1 ? x + out * spread * (p + rand(0.2, 0.8)) / parts : x
    spawnChunks(world, px, s.y - Math.max(1, h * 0.6), e.m / parts, vx, vy - rand(0, 20), s.pack, s.loose)
  }
  e.m = 0; e.mom = 0; e.age = 0
}

// Avalanching: wherever the slope between two cells is steeper than the
// snow can stand, the excess flows downhill, keeping its speed. At a
// window's edge the snow can hang a little past that before pouring over.
function slump(world, s, dt) {
  var b = s.bins, u = s.slip, n = b.length
  var maxD = mix(SNOW.repose, s.pack) * CELL
  var rate = follow(dt, 0.08)
  var cap = (s.ground ? TUNING.snow.groundCap : TUNING.snow.cap) * 1.35
  // Alternate the sweep direction so the flow has no bias.
  var forward = (world.frame & 1) === 0
  for (var k = 0; k + 1 < n; k++) {
    var i = forward ? k : n - 2 - k
    var d = b[i] - b[i + 1]
    var ad = Math.abs(d)
    if (ad <= maxD) continue
    var from = d > 0 ? i : i + 1
    var to = d > 0 ? i + 1 : i
    var m = Math.min(b[from], (ad - maxD) * 0.5 * rate)
    var total = b[to] + m
    u[to] = total > 0 ? (u[to] * b[to] + u[from] * m) / total : 0
    b[from] -= m
    b[to] = total
  }
  for (var c = 0; c < n; c++) if (b[c] > cap) b[c] = cap
  if (s.ground || n < 2) return
  var hang = maxD + mix(SNOW.cornice, s.pack) * CELL * 0.5
  var ends = [0, n - 1]
  for (var e = 0; e < 2; e++) {
    var idx = ends[e]
    if (b[idx] <= hang) continue
    var spill = (b[idx] - hang) * 0.5 * rate
    b[idx] -= spill
    feedEdge(s, e, spill, spill * (e === 0 ? -30 : 30))
  }
}

function inLead(world, s, x) {
  if (s.shrinkT0 !== undefined && world.time - s.shrinkT0 <= RESIZE.quiet && x < s.x + (s.leadL || 0)) return true
  if (s.shrinkT1 !== undefined && world.time - s.shrinkT1 <= RESIZE.quiet && x > s.x + s.w - (s.leadR || 0)) return true
  return false
}

// While an edge is being drawn in, the strip it will cover next frame (its
// lead, see track) stays clear: snow that slumped into it falls from there.
function trimShrinking(world, s) {
  var b = s.bins, n = b.length
  for (var side = 0; side < 2; side++) {
    var t0 = side === 0 ? s.shrinkT0 : s.shrinkT1
    if (t0 === undefined || world.time - t0 > RESIZE.quiet) continue
    var cells = Math.min(n, Math.ceil(((side === 0 ? s.leadL : s.leadR) || 0) / CELL))
    for (var c = 0; c < cells; c++) {
      var i = side === 0 ? c : n - 1 - c
      if (b[i] <= 0) continue
      if (b[i] > 0.05) spawnChunks(world, s.x + (i + 0.5) * CELL, s.y - b[i] * 0.5, b[i], rand(-6, 6), rand(0, 12), s.pack)
      else s.blown = (s.blown || 0) + b[i]
      b[i] = 0; s.slip[i] = 0
    }
  }
}

// Loose snow evening out (see REFLOW): each cell relaxes toward its
// neighbours' mean, mass kept exactly, fading out as it settles. A little
// of each cell's own height is kept, so the ledge stays lumpy.
function reflow(s, dt) {
  var b = s.bins, n = b.length
  if (n < 3) { s.reflow = 0; return }
  var k = follow(dt, REFLOW.tau) * clamp(s.reflow / REFLOW.after, 0, 1) * (1 - REFLOW.grain) * 0.5
  var flow = zeros(n + 1)               // flow[i]: mass from cell i-1 to cell i
  for (var i = 1; i < n; i++) flow[i] = (b[i - 1] - b[i]) * k * 0.5
  // Each cell gives at most half of itself away (k <= 0.5), so none goes
  // below zero and the total is kept exactly.
  for (var j = 0; j < n; j++) b[j] += flow[j] - flow[j + 1]
  s.reflow = Math.max(0, s.reflow - dt)
}

// A window moving fast through the air strips loose powder off the top of
// its pile. The powder keeps the window's speed and is braked by the air,
// so it trails behind as a plume.
function spray(world, s, dt) {
  // Loose snow is not going the window's speed through the air.
  if (s.loose || (s.fastT || 0) < SNOW.sprayAfter) return
  var speed = Math.hypot(s.vx, s.vy)
  var looseness = 1 - 0.85 * s.pack
  // Ramps in with how long and how fast it has been going.
  var ramp = Math.min(1, (s.fastT - SNOW.sprayAfter) / 0.4)
  var rate = (speed - SNOW.sprayFrom) / 1600 * looseness * 1.6 * ramp
  var budget = 4
  var b = s.bins
  var vx = clamp(s.vx, -SNOW.shedMax, SNOW.shedMax), vy = clamp(s.vy, -SNOW.shedMax, SNOW.shedMax)
  for (var i = 0; i < b.length && budget > 0; i++) {
    if (b[i] < 0.8 || Math.random() > rate * dt) continue
    var take = Math.min(b[i] * 0.08, 0.35)
    b[i] -= take
    budget--
    addPowder(world, s.x + (i + 0.5) * CELL, s.y - b[i] - rand(0, 2),
              vx * rand(0.8, 1) + s.slip[i], vy - rand(10, 40), take)
  }
}

// Wind slowly moves loose snow downwind and blows a little off the end.
function drift(world, s, dt) {
  var w = world.wind
  if (Math.abs(w) < 14 || s.pack > 0.7) return
  var b = s.bins, n = b.length
  var k = (Math.abs(w) - 14) * 0.0012 * (1 - s.pack) * dt
  if (w > 0) {
    for (var i = n - 1; i > 0; i--) { var m = b[i - 1] * k; b[i - 1] -= m; b[i] += m }
    if (s.ground) b[n - 1] -= b[n - 1] * k * 4      // blown off the screen
    else if (b[n - 1] > 1) lose(world, s, n - 1, b[n - 1] * k, w)
  } else {
    for (var j = 0; j + 1 < n; j++) { var q = b[j + 1] * k; b[j + 1] -= q; b[j] += q }
    if (s.ground) b[0] -= b[0] * k * 4
    else if (b[0] > 1) lose(world, s, 0, b[0] * k, w)
  }
}

function lose(world, s, i, m, w) {
  s.bins[i] -= m
  // What blows off gathers into the odd visible puff, so none is lost.
  s.blown = (s.blown || 0) + m
  if (s.blown > 0.3 && Math.random() < 0.15) {
    addPowder(world, s.x + (i + 0.5) * CELL, s.y - s.bins[i], s.vx + w, s.vy - rand(5, 30), s.blown)
    s.blown = 0
  }
}

// The window dropped (or stopped rising) faster than gravity: the snow
// keeps the motion it had and parts from the surface.
function liftOff(world, s, dt) {
  // Clumps part from the window here and there, not as one sheet: each
  // frame some cells let go of most of what they hold, the packed base
  // holding on longest.
  var b = s.bins, n = b.length
  var chance = follow(dt, SNOW.liftTau) * 1.6
  var vx = clamp(s.vx, -SNOW.shedMax, SNOW.shedMax), vy = clamp(s.vy, -SNOW.shedMax, SNOW.shedMax)
  var i = 0
  while (i < n) {
    var run = 2 + Math.floor(Math.random() * 4)
    if (Math.random() < chance) {
      var m = 0, top = 0, slip = 0
      for (var j = i; j < Math.min(n, i + run); j++) {
        var take = b[j] * (0.75 - 0.35 * s.pack)
        if (b[j] - take < 0.3) take = b[j]
        m += take; slip += s.slip[j] * take
        if (b[j] > top) top = b[j]
        b[j] -= take
        if (b[j] <= 0) { b[j] = 0; s.slip[j] = 0 }
      }
      if (m > 0.02) spawnChunks(world, s.x + (i + run / 2) * CELL, s.y - top * 0.5 - 0.5, m,
                                vx + clamp(slip / m, -SNOW.slipMax, SNOW.slipMax), vy - rand(0, 30), s.pack)
    }
    i += run
  }
  for (var e = 0; e < 2; e++) flushEdge(world, s, e)
  s.sliding = false
}

function melt(s, dt, seconds) {
  var f = Math.exp(-dt / seconds)
  for (var i = 0; i < s.bins.length; i++) {
    s.bins[i] *= f
    if (s.bins[i] < 0.02) s.bins[i] = 0
  }
}

function totalSnow(world) {
  var sum = 0
  for (var id in world.surfaces) {
    var s = world.surfaces[id]
    sum += sumOf(s.bins) + s.edges[0].m + s.edges[1].m + (s.blown || 0)
  }
  return sum
}

// ------------------------------------------------------------------ chunks and powder

function maxParticles(world) { return Math.round(1500 * world.quality) }

// Break `amount` of snow into falling chunks. Packed snow makes a few solid
// chunks, powder makes small ones and a puff of dust. Over the particle
// budget, it all goes as one chunk so no snow is lost.
function spawnChunks(world, x, y, amount, vx, vy, pack, keep) {
  if (!(amount > 0) || !isFinite(x + y + vx + vy)) return
  pack = pack === undefined ? 0.5 : pack
  var cap = maxParticles(world)
  // Over the frame's budget or the particle cap, it all goes as one chunk
  // so no snow is lost.
  var crowded = world.particles.length > cap || world.shedLeft <= 0
  // Snow coming off something, for the shell's soft thud: gathered, at most
  // one event every 90 ms however many chunks go.
  world.shedHeard = (world.shedHeard || 0) + amount
  if (world.time - (world.shedHeardAt === undefined ? -1 : world.shedHeardAt) >= 0.09) {
    pushSound(world, { type: "shed", amount: world.shedHeard, x: clamp(x / Math.max(1, world.width), 0, 1) })
    world.shedHeard = 0
    world.shedHeardAt = world.time
  }
  var dust = crowded ? 0 : amount * (1 - pack) * 0.12
  var solid = amount - dust
  var piece = mix(SNOW.chunk, pack)
  var count = crowded ? 1 : clamp(Math.round(solid / piece), 1, Math.min(4, Math.max(1, world.shedLeft)))
  world.shedLeft -= count
  for (var c = 0; c < count; c++) {
    var m = solid / count
    world.particles.push({
      kind: "clump",
      x: x + rand(-CELL, CELL), y: y + rand(-2, 1),
      vx: vx + rand(-22, 22) * (1 - pack * 0.5), vy: vy + rand(-20, 8),
      r: chunkRadius(m),
      amount: m, pack: pack,
      angle: rand(0, 6.28), spin: rand(-5, 5),
      life: 12, age: 0, rest: null, keep: !!keep
    })
  }
  var puffs = Math.min(2, Math.ceil(dust / 0.3))
  for (var d = 0; d < puffs; d++) addPowder(world, x + rand(-3, 3), y + rand(-3, 2), vx + rand(-30, 30), vy + rand(-30, 0), dust / puffs, keep ? 14 : undefined)
}

// A chunk's radius from its mass: mass is in bin-px (one cell wide, px
// deep), so its area is mass * CELL and the chunk is a disc of that area,
// a little fluffed up.
function chunkRadius(m) { return clamp(Math.sqrt(m * CELL / Math.PI), 1, 5) }

// `life`: how long it may drift before it is gone; powder that must reach
// the ground to keep the snow's mass (a yanked ledge's) is given longer.
function addPowder(world, x, y, vx, vy, amount, life) {
  if (world.particles.length > maxParticles(world) * 1.2) return
  world.particles.push({
    kind: "powder", x: x, y: y, vx: vx, vy: vy,
    r: rand(0.6, 1.4), amount: amount || 0,
    vt: rand(60, 120), life: life || rand(0.8, 1.8), age: 0, rest: null
  })
}

// A chunk hits a surface. A gentle landing keeps it whole; a hard one
// breaks it: some of it sprays up as smaller bits and dust, the rest
// spreads over a few cells and skids along with the speed it came in with.
function impact(world, p, s, y) {
  var rvx = p.vx - s.vx, rvy = p.vy - s.vy
  var speed = Math.hypot(rvx, rvy)
  var pack = p.pack === undefined ? 0.5 : p.pack
  var m = p.amount
  if (speed > SNOW.breakSpeed && m > 0.4 && world.particles.length < maxParticles(world)) {
    var shatter = clamp((speed - SNOW.breakSpeed) / 900, 0.08, 0.5) * (1 - 0.4 * pack)
    var flying = m * shatter
    m -= flying
    var bits = clamp(Math.round(flying / 0.35), 1, 5)
    for (var i = 0; i < bits; i++) {
      var piece = flying / bits
      var up = rand(0.12, 0.3) * Math.min(speed, 900)
      var side = rvx * rand(0.2, 0.45) + rand(-1, 1) * speed * 0.18
      if (pack > 0.45 && piece > 0.3) {
        world.particles.push({
          kind: "clump", x: p.x, y: y - 1, vx: s.vx + side, vy: s.vy - up,
          r: chunkRadius(piece), amount: piece, pack: pack,
          angle: rand(0, 6.28), spin: rand(-9, 9), life: 6, age: 0, rest: null
        })
      } else {
        addPowder(world, p.x, y - 1, s.vx + side, s.vy - up, piece, p.keep ? 8 : 0)
      }
    }
  }
  // Spread over the footprint, wider the harder it hit.
  var spread = Math.max(1, Math.round(1 + speed / 320 + p.r / CELL))
  var skid = clamp(rvx * 0.35, -220, 220)
  for (var k = 0; k < spread; k++) {
    var off = (k - (spread - 1) / 2) * CELL
    deposit(world, s, p.x + off + skid * 0.01, m / spread, skid)
  }
  if (!s.ground && p.amount > 3) s.reflow = Math.max(s.reflow || 0, REFLOW.after * 0.5)
  // Chunks are older snow than fresh flakes: blend the pile's age back up.
  var mass = sumOf(s.bins)
  if (mass > 0) s.pack = clamp(s.pack + (pack - s.pack) * Math.min(1, p.amount / mass), 0, 1)
}

// ------------------------------------------------------------------ spawning

function spawn(world, dt) {
  var t = TUNING[world.effect]
  if (world.effect === "fireflies") {
    var want = Math.round(t.population * world.width / 1000 * world.intensity * world.quality)
    var have = 0
    for (var i = 0; i < world.particles.length; i++) if (world.particles[i].kind === "firefly") have++
    for (; have < want; have++) world.particles.push(makeFirefly(world))
    return
  }
  var scale = world.effect === "snow" ? world.env.snowScale : 1
  world.spawnDebt += t.rate * world.width / 1000 * world.intensity * world.quality * scale * dt
  // Weather gets most of the budget; the rest is kept for chunks and dust.
  var cap = Math.round(maxParticles(world) * 0.72)
  while (world.spawnDebt >= 1) {
    world.spawnDebt -= 1
    if (world.particles.length >= cap) { world.spawnDebt = 0; break }
    world.particles.push(makeParticle(world))
  }
  // In spring, blossom petals drift down instead of flakes, now and then.
  if (world.effect === "snow" && world.env.petals > 0) {
    world.petalDebt = (world.petalDebt || 0) + SPRING.petalRate * world.width / 1000 * world.intensity * world.quality * world.env.petals * dt
    while (world.petalDebt >= 1) {
      world.petalDebt -= 1
      if (world.particles.length >= cap) { world.petalDebt = 0; break }
      world.particles.push(makeBlossom(world))
    }
  }
}

function makeParticle(world) {
  var x = rand(-60, world.width + 60)
  switch (world.effect) {
  case "snow":
    // Depth stands in for distance: far flakes are small, dim and slow.
    var depth = Math.random()
    var r = 0.9 + depth * 2.4
    var vt = 34 + depth * 62 + rand(-6, 6)
    return { kind: "flake", x: x, y: rand(-24, -4), vx: world.wind, vy: vt * rand(0.6, 1),
             r: r, depth: depth, vt: vt, phase: rand(0, 6.28), freq: rand(0.6, 1.4),
             sway: rand(6, 20) * (1.2 - depth * 0.5),
             life: 180, age: 0, rest: null }
  case "leaves":
    return { kind: "leaf", x: x, y: -16, vx: rand(-20, 20), vy: rand(40, 70), r: rand(6, 10),
             vt: rand(70, 110), angle: rand(0, 6.28), spin: 0, phase: rand(0, 6.28),
             freq: rand(1.3, 2.1), sway: rand(40, 80), tilt: rand(-0.4, 0.4),
             hue: Math.floor(rand(0, 4)), life: 600, age: 0, rest: null }
  case "sakura":
    return { kind: "petal", x: x, y: -10, vx: rand(10, 35), vy: rand(22, 40), r: rand(3.5, 6),
             vt: rand(38, 58), angle: rand(0, 6.28), spin: 0, phase: rand(0, 6.28),
             freq: rand(1.8, 2.8), sway: rand(18, 38), tilt: rand(-0.5, 0.5),
             hue: Math.floor(rand(0, 3)), life: 600, age: 0, rest: null, restLeft: 0 }
  case "rain":
    // Depth stands in for distance, as for snow: far drops are short,
    // thin, dim and a little slower on screen.
    var dd = Math.random()
    return { kind: "drop", x: rand(-120, world.width + 120), y: rand(-60, -10), vx: world.wind,
             vy: rand(820, 960) + dd * 520, len: 9 + dd * 20 + rand(-2, 2), depth: dd, life: 4, age: 0, rest: null }
  case "starfall":
    pushSound(world, { type: "meteor" })
    var dir = Math.random() < 0.5 ? -1 : 1
    var a = rand(0.35, 0.6)
    var sp = rand(620, 900)
    return { kind: "meteor", x: rand(world.width * 0.1, world.width * 0.9), y: -20,
             vx: dir * Math.sin(a) * sp, vy: Math.cos(a) * sp, len: rand(60, 110),
             life: 5, age: 0, rest: null }
  }
  return null
}

function makeFirefly(world) {
  return { kind: "firefly", x: rand(0, world.width), y: rand(world.height * 0.25, world.height),
           vx: rand(-20, 20), vy: rand(-20, 20), r: rand(1.6, 2.8), phase: rand(0, 6.28),
           blink: rand(0.6, 1.4), heading: rand(0, 6.28), orbit: rand(26, 80),
           orbitSpeed: rand(0.6, 1.4) * (Math.random() < 0.5 ? -1 : 1),
           life: 1e9, age: 0, rest: null }
}

function burst(world, x, y, count, palette) {
  for (var i = 0; i < count; i++) {
    var a = rand(Math.PI * 1.05, Math.PI * 1.95)
    var sp = rand(80, 280)
    world.particles.push({ kind: "spark", x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                           r: rand(0.8, 1.8), life: rand(0.6, 1.2), age: 0, rest: null,
                           hue: palette ? pick(palette) : 0 })
  }
}

// A raindrop breaks into a few droplets thrown up and sideways, carrying
// some of the drop's sideways speed, plus a ripple.
function splash(world, x, y, vx) {
  var n = Math.floor(rand(2, 5))
  for (var i = 0; i < n; i++) {
    world.particles.push({ kind: "splash", x: x, y: y - 1, vx: vx * 0.3 + rand(-120, 120), vy: rand(-230, -90),
                           r: rand(0.7, 1.3), life: rand(0.3, 0.5), age: 0, rest: null })
  }
  world.particles.push({ kind: "ripple", x: x, y: y, life: 0.3, age: 0, rest: null, w: rand(6, 12) })
}

// ------------------------------------------------------------------ water
//
// Rain that lands on a window top lies there as a film and runs off both
// ends: the film drains with a time constant, leaning with the wind and
// away from the way the window is moving (it is left behind). Off each
// end it pours as a stream, thrown out a little by the flow, that falls
// clear of the window and breaks into drops (drips) after a length that
// grows with the flow, or meets the top of a window below, which it then
// waters in turn. s.pourGeo carries each stream's shape for the painter.
var WATER = {
  perDrop: 1,          // film per raindrop landed
  tau: 1.6,            // s for the film to drain
  ref: 45,             // flow (film per second off one end) of a full stream
  breakMin: 40,        // px a trickle falls before it breaks into drops
  breakMax: 120,       // px a full stream falls before it does
  beads: [3, 18],      // drops per second it breaks into, trickle .. full
  // A dry window top soaks up the first rain: what lands goes into s.soak
  // until it holds soakPerPx per px of width, and only the share
  // (soak / full)^4 runs into the film. So a window that starts dry (rain
  // just switched on, or a window just opened) beads first, then a thin
  // trickle starts and builds to a full stream over ~soakTime seconds.
  // It dries again slowly (dryTau) once the rain stops.
  soakPerPx: 0,        // set below from soakTime
  soakTime: 18,        // s of steady rain from dry to a full stream (about)
  dryTau: 45           // s for a soaked top to dry
}
WATER.soakPerPx = 0.12 * WATER.soakTime

// Rain landing on a window top: soaked up first, then runs into the film.
function wetTop(s, amt) {
  var full = WATER.soakPerPx * Math.max(40, s.w)
  var f = Math.min(1, (s.soak || 0) / full)
  f *= f; f *= f
  s.soak = Math.min(full, (s.soak || 0) + amt * (1 - f))
  s.water = (s.water || 0) + amt * f
}

function stepWater(world, s, dt) {
  if (s.soak) { s.soak *= Math.exp(-dt / WATER.dryTau); if (s.soak < 0.05) s.soak = 0 }
  if (!s.water && !s.pour) return
  var W = s.water || 0
  var out = W * (1 - Math.exp(-dt / WATER.tau))
  W -= out
  var lean = clamp(airAt(world, s.x + s.w / 2, s.y) / 320 - (s.vx || 0) / 500, -0.42, 0.42)
  var share = [0.5 - lean, 0.5 + lean]
  if (!s.pour) { s.pour = [0, 0]; s.beadDebt = [0, 0]; s.pourGeo = [null, null] }
  var k = follow(dt, 0.3)
  for (var e = 0; e < 2; e++) s.pour[e] += (out * share[e] / dt - s.pour[e]) * k
  s.water = W
  if (W < 0.02 && s.pour[0] + s.pour[1] < 0.2) { s.water = 0; s.pour = null; s.pourGeo = null; return }
  var gy = groundY(world)
  for (var side = 0; side < 2; side++) {
    var str = s.pour[side] / WATER.ref
    if (str < 0.015) { s.pourGeo[side] = null; continue }
    var dir = side ? 1 : -1
    var x0 = side ? s.x + s.w + 0.5 : s.x - 0.5, y0 = s.y + 0.5
    var v0 = 28 + 52 * Math.min(str, 1.5)
    var L = WATER.breakMin + (WATER.breakMax - WATER.breakMin) * Math.min(1, Math.sqrt(str))
    // Where it would meet something: a window top below the end, or the
    // ground.
    var tB = Math.sqrt(2 * L / G), xB = x0 + dir * v0 * tB, onto = null, yHit = gy
    for (var i = 0; i < world.order.length; i++) {
      var o = world.order[i]
      if (o === s || o.ground || o.plow || o.w <= 0) continue
      if (o.y > y0 + 1 && o.y < yHit && xB >= o.x && xB <= o.x + o.w) { yHit = o.y; onto = o }
    }
    var hitL = yHit - y0, reaches = hitL <= L
    if (reaches) { L = Math.max(1, hitL); tB = Math.sqrt(2 * L / G); xB = x0 + dir * v0 * tB }
    s.pourGeo[side] = { x0: x0, y0: y0, dir: dir, v0: v0, len: L, str: str, reaches: reaches }
    var rate = WATER.beads[0] + (WATER.beads[1] - WATER.beads[0]) * Math.min(1, str)
    s.beadDebt[side] += rate * dt
    while (s.beadDebt[side] >= 1) {
      s.beadDebt[side] -= 1
      if (reaches) {
        // The stream runs straight onto what is below: it splashes there
        // and adds to that window's film.
        if (onto) wetTop(onto, s.pour[side] / rate)
        if (world.particles.length < maxParticles(world)) splash(world, xB, yHit, dir * v0)
      } else if (world.particles.length < maxParticles(world)) {
        world.particles.push({ kind: "drip", x: xB + rand(-1, 1), y: y0 + L, vx: dir * v0 * rand(0.85, 1.1),
                               vy: G * tB * rand(0.9, 1.05), life: 4, age: 0, rest: null, r: rand(1, 1.6) })
      }
    }
  }
}

// ------------------------------------------------------------------ stepping

// input: { pointer: {x, y, vx, vy, present, stillFor} }
function step(world, dt, input) {
  if (!world.running) return
  // A long frame (a suspend, a stall) is taken as one ordinary frame.
  dt = isFinite(dt) ? clamp(dt, 0, 0.05) : 0
  if (dt <= 0) return
  world.time += dt
  world.frame++
  world.shedLeft = SNOW.shedBudget
  input = input || {}
  var pointer = input.pointer && input.pointer.present ? input.pointer : null
  world.pointer = pointer

  // Wind drifts slowly between gusts.
  world.windTimer -= dt
  if (world.windTimer <= 0) {
    world.windTimer = rand(4, 10)
    world.windTarget = world.effect === "rain" ? rand(-140, 140) + world.env.windBase
                     : world.env.windBase + rand(-1, 1) * world.env.windVar
  }
  world.wind += (world.windTarget - world.wind) * follow(dt, 2)
  updateAir(world)

  spawn(world, dt)
  if (world.effect === "rain") lightning(world, dt)
  else { world.flash = Math.max(0, world.flash - dt * 4); world.bolt = null }

  stepPlow(world, dt)
  stepStrings(world, dt, pointer)
  for (var i = 0; i < world.order.length; i++) stepSurface(world, world.order[i], dt)
  updateGusts(world, dt)
  for (var q = 0; q < world.order.length; q++) {
    var sq = world.order[q]
    if (!sq.ground && !sq.plow) {
      try { stepIcicles(world, sq, dt) } catch (e0) { fault(world, "icicles", e0); sq.icicles = null }
    }
    if (sq.marks && sq.marks.length) stepMarks(world, sq, dt)
    if (!sq.ground && !sq.plow && (sq.water || sq.pour || sq.soak)) {
      try { stepWater(world, sq, dt) } catch (e1) { fault(world, "water", e1); sq.water = 0; sq.pour = null; sq.pourGeo = null }
    }
  }
  // How wet the scene is: storm light, mist and the puddle along the
  // ground come in with the rain and go slowly after it.
  world.wet = (world.wet || 0) + ((world.effect === "rain" ? Math.min(1, 0.55 + 0.3 * world.intensity) : 0) - (world.wet || 0)) * follow(dt, world.effect === "rain" ? 6 : 20)
  if (world.wet < 0.002) world.wet = 0
  stepBalls(world, dt)
  stepShake(world, dt)
  // The extras each run guarded: one that throws is dropped and noted
  // (see fault), and the snow and every other feature carry on.
  try { stepFireworks(world, dt) } catch (e1) { fault(world, "fireworks", e1); world.fw = null }
  try { stepSprouts(world, dt) } catch (e2) { fault(world, "sprouts", e2); world.sprouts = null }
  try { stepBird(world, dt, pointer) } catch (e3) { fault(world, "bird", e3); world.bird = null }
  try { stepRabbit(world, dt, pointer) } catch (e4) { fault(world, "rabbit", e4); world.rabbit = null }
  try { stepGolden(world, dt, pointer) } catch (e5) { fault(world, "golden", e5); world.golden = null }

  // Survivors are compacted in place (no new array a frame); particles born
  // during the loop (bursts, chunks, dust) join next frame.
  var list = world.particles
  var count = list.length
  var w = 0
  for (var j = 0; j < count; j++) {
    var p = list[j]
    p.age += dt
    if (p.age >= p.life) continue
    if (stepParticle(world, p, dt, pointer) && p.x === p.x && p.y === p.y) list[w++] = p
  }
  for (var k = count; k < list.length; k++) list[w++] = list[k]
  list.length = w
  capResting(world)

  for (var m = 0; m < world.order.length; m++) world.order[m].py = world.order[m].y
}

function lightning(world, dt) {
  world.flash = Math.max(0, world.flash - dt * 3.2)
  if (world.bolt) {
    world.bolt.age += dt
    if (world.bolt.age > 0.22) world.bolt = null
  }
  if (world.pendingFlash >= 0) {
    world.pendingFlash -= dt
    if (world.pendingFlash < 0) { world.flash = 0.55; world.pendingFlash = -1 }
  }
  world.nextLightning -= dt * world.intensity
  if (world.nextLightning <= 0) {
    world.nextLightning = rand(14, 40)
    world.flash = 0.8
    if (Math.random() < 0.6) world.pendingFlash = rand(0.09, 0.16)
    world.bolt = makeBolt(world)
    // Its thunder, in the same frame as the flash (the shell plays it):
    // close ones (with a crack) and far ones (a roll) in turn, a bolt that
    // reaches far down the screen more often close.
    var bp = world.bolt.points
    var reach = bp.length ? bp[bp.length - 1][1] / Math.max(1, world.height) : 0.5
    pushSound(world, { type: "thunder", near: Math.random() < 0.3 + 0.4 * reach, x: clamp((bp.length ? bp[0][0] : 0) / Math.max(1, world.width), 0, 1) })
  }
}

function makeBolt(world) {
  var x = rand(world.width * 0.15, world.width * 0.85)
  var target = groundY(world)
  var hits = world.order.filter(function(s) { return !s.ground && x >= s.x && x <= s.x + s.w })
  if (hits.length) target = hits[0].y
  var pts = [[x, 0]]
  var y = 0
  while (y < target) {
    y = Math.min(target, y + rand(14, 46))
    x += rand(-26, 26)
    pts.push([x, y])
  }
  // Forks: short, thinner, dying out partway down.
  var branches = []
  for (var i = 1; i < pts.length - 2; i++) {
    if (Math.random() > 0.28 || branches.length >= 5) continue
    var bx = pts[i][0], by = pts[i][1], side = Math.random() < 0.5 ? -1 : 1, br = [[bx, by]]
    var n = Math.floor(rand(2, 6))
    for (var j = 0; j < n && by < target; j++) {
      by += rand(12, 34); bx += side * rand(6, 26)
      br.push([bx, Math.min(by, target)])
    }
    branches.push(br)
  }
  return { points: pts, branches: branches, age: 0 }
}

// Light bodies: velocity relaxes toward the local air plus their own fall
// speed. The time constant is vt / G, which is what a drag that balances
// gravity at vt gives, so heavier things respond more slowly.
function relax(world, p, dt, ax, ay, vt, pointer, wakeRadius) {
  var wake = pointerWake(pointer, p.x, p.y, wakeRadius)
  var airX = ax + (wake ? wake.x : 0)
  var airY = (wake ? wake.y : 0)
  if (world.gustList.length && gustAt(world, p.x, p.y)) { airX += world.gx; airY += world.gy }
  if (world.shake) { swirlAt(world, p.x, p.y, p.buoy || 1); airX += world.sx; airY += world.sy }
  var k = follow(dt, Math.max(0.02, vt / G))
  p.vx += (airX - p.vx) * k
  p.vy += (airY + vt - p.vy) * k
}

function stepParticle(world, p, dt, pointer) {
  if (p.rest !== null && p.rest !== undefined) return stepResting(world, p, dt, pointer)
  if (p.hold) {
    if (!stepHeld(world, p, dt)) return false
    if (p.hold) return true
  }
  var x0 = p.x, y0 = p.y
  switch (p.kind) {
  case "flake":
    // A flake tumbles: its own small side-to-side flutter on top of the air.
    p.phase += dt * p.freq * 2.2
    var air = airAt(world, p.x, p.y) * (0.45 + 0.55 * p.depth)
    relax(world, p, dt, air + Math.sin(p.phase) * p.sway, 0, p.vt * (0.88 + 0.12 * Math.cos(p.phase * 1.7)), pointer, 110)
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "powder":
    relax(world, p, dt, airAt(world, p.x, p.y), 0, p.vt, pointer, 110)
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "leaf":
  case "petal":
    stepFlutter(world, p, dt, pointer)
    break
  case "firefly":
    stepFirefly(world, p, dt, pointer)
    return true
  case "clump":
    // Heavy: gravity with quadratic drag toward a high terminal speed, and
    // a loose chunk sheds dust as it falls.
    var vt = 420 + p.r * 110
    var cax = airAt(world, p.x, p.y)
    if (world.gustList.length && gustAt(world, p.x, p.y)) cax += world.gx * 0.5
    var rvx = p.vx - cax, rvy = p.vy
    var sp = Math.hypot(rvx, rvy)
    var c = G / (vt * vt)
    p.vx -= c * sp * rvx * dt
    p.vy += (G - c * sp * rvy) * dt
    p.angle += p.spin * dt
    var loose = 1 - (p.pack === undefined ? 0.5 : p.pack)
    if (p.amount > 0.3 && sp > 160 && Math.random() < dt * 2.5 * loose) {
      var bit = Math.min(p.amount * 0.08, 0.15)
      p.amount -= bit
      p.r = chunkRadius(p.amount)
      addPowder(world, p.x, p.y, p.vx * 0.6, p.vy * 0.5, bit, p.keep ? 14 : 0)
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "spark":
    // Embers: little weight, a lot of drag.
    var ks = follow(dt, 0.35)
    p.vx += (airAt(world, p.x, p.y) * 0.3 - p.vx) * ks
    p.vy += (G * 0.25 * 0.35 - p.vy) * ks * 0.5 + G * 0.12 * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    return true
  case "splash":
    var kd = follow(dt, 0.4)
    p.vx -= p.vx * kd * 0.5
    p.vy += G * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    return true
  case "ripple":
    return true
  case "drop":
    // Already at terminal speed; the wind leans them over.
    p.vx += (airAt(world, p.x, p.y) - p.vx) * follow(dt, 0.15)
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "meteor":
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "drip":
    // A drop of meltwater: falls freely, barely slowed by the air.
    p.vy += G * dt
    p.vx += (airAt(world, p.x, p.y) * 0.2 - p.vx) * follow(dt, 0.8)
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "shard":
    // A broken icicle: heavy, tumbling.
    p.vy += G * dt
    p.vx *= Math.exp(-dt * 0.4)
    p.angle += p.spin * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "rocket":
  case "ember":
  case "tick":
    return stepFirework(world, p, dt)
  case "smoke":
    // Warm exhaust: rises, slows, spreads and thins out, carried by the air.
    var kk = follow(dt, 0.6)
    p.vx += (airAt(world, p.x, p.y) * 0.8 - p.vx) * kk
    p.vy += (-26 - p.vy) * kk
    p.r = p.r0 + (p.r1 - p.r0) * Math.sqrt(p.age / p.life)
    p.x += p.vx * dt
    p.y += p.vy * dt
    return p.y > -60
  }

  if (p.y > world.height + 40 || p.x < -240 || p.x > world.width + 240) return false

  var hit = collide(world, x0, y0, p.x, p.y, p.behind || null)
  if (!hit) return true
  return land(world, p, hit)
}

// Leaves and petals fall like paper: they swing from side to side, sink
// fastest through the middle of each swing, slow (and barely rise) at the
// ends, and tilt with the swing. Gusts and the pointer's wake carry them.
function stepFlutter(world, p, dt, pointer) {
  p.phase += dt * p.freq * 2
  var swing = Math.cos(p.phase)
  var air = airAt(world, p.x, p.y) * (p.kind === "leaf" ? 0.9 : 1.1)
  var wake = pointerWake(pointer, p.x, p.y, 130)
  var tx = air + swing * p.sway + (wake ? wake.x * 1.6 : 0)
  var ty = p.vt * (0.25 + 1.05 * swing * swing) + (wake ? wake.y * 1.4 : 0)
  if (world.gustList.length && gustAt(world, p.x, p.y)) { tx += world.gx * 1.2; ty += world.gy }
  if (world.shake) { swirlAt(world, p.x, p.y, 1); tx += world.sx; ty += world.sy }
  var k = follow(dt, p.kind === "leaf" ? 0.22 : 0.16)
  p.vx += (tx - p.vx) * k
  p.vy += (ty - p.vy) * k
  var targetAngle = p.tilt + Math.sin(p.phase) * 0.75 + (wake ? clamp(wake.x * 0.004, -1.5, 1.5) : 0)
  var before = p.angle
  p.angle += (targetAngle - p.angle) * follow(dt, 0.12)
  p.spin = (p.angle - before) / dt
  p.x += p.vx * dt
  p.y += p.vy * dt
}

function land(world, p, hit) {
  var s = hit.surface
  switch (p.kind) {
  case "flake":
    // A flake's volume, packed loosely, spread on the cell it hits. Snow a
    // shake lifted carries its own mass and spreads over a few cells.
    //
    // A window is a pane in front of the scene, not a roof over the
    // ground: the snow falling on its top edge settles there (the ledge)
    // and the snowfall behind it goes on down to the ground, out of sight
    // behind the window. So the ground bank fills at the same pace all
    // along the screen, wherever windows are or were, and a window lifted
    // after a long snow leaves no bare stretch under it; nor does a
    // window in front leave one on the ledge of a window behind it. (A flake that
    // lands on a window used to end there, so the ground under a window
    // got no snow at all and a thaw then melted that stretch bare.)
    if (p.amount === undefined) {
      deposit(world, s, p.x, Math.PI * p.r * p.r * FLAKE_VOLUME / CELL * (s.ground ? 1 : TUNING.snow.windowCatch), 0)
      // It goes on behind this window, onto whatever is further back.
      if (!s.ground && !s.plow) { p.behind = s.id; return true }
      return false
    } else {
      var nn = clamp(Math.ceil(p.amount / 1.2), 1, 9)
      for (var c = 0; c < nn; c++) deposit(world, s, p.x + (c - (nn - 1) / 2) * CELL, p.amount / nn, 0)
    }
    return false
  case "drip":
    world.particles.push({ kind: "splash", x: p.x, y: hit.y - 1, vx: rand(-40, 40), vy: rand(-90, -40),
                           r: 0.6, life: 0.25, age: 0, rest: null })
    return false
  case "shard":
    // It shatters into glints of ice.
    for (var g = 0; g < 4; g++) world.particles.push({ kind: "splash", x: p.x, y: hit.y - 1, vx: s.vx + rand(-110, 110),
                                                       vy: s.vy - rand(80, 220), r: rand(0.6, 1.1), life: rand(0.3, 0.55), age: 0, rest: null })
    return false
  case "powder":
    if (p.amount > 0) deposit(world, s, p.x, p.amount, clamp((p.vx - s.vx) * 0.2, -80, 80))
    return false
  case "clump":
    impact(world, p, s, hit.y)
    return false
  case "leaf":
  case "petal":
    p.rest = s.id
    p.ox = p.x - s.x
    // Keeps a little of its sideways speed and slides to a stop.
    p.slide = clamp(p.vx - s.vx, -90, 90) * 0.5
    p.vx = 0; p.vy = 0
    p.restAge = 0
    p.angle = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.3, 0.3)
    if (p.kind === "petal") p.restLeft = rand(TUNING.sakura.restMin, TUNING.sakura.restMax)
    p.life = p.age + 1e6
    return true
  case "drop":
    splash(world, p.x, hit.y, p.vx - s.vx)
    // Rain on a window top gathers there and runs off its ends (stepWater).
    if (!s.ground && !s.plow) wetTop(s, WATER.perDrop)
    return false
  case "meteor":
    burst(world, p.x, hit.y, Math.floor(rand(12, 20)), [0, 1, 2])
    return false
  }
  return false
}

function release(p, s, vx, vy) {
  p.rest = null
  p.x = s.x + p.ox
  p.y = s.y - heightAt(s, p.x) - 2
  p.vx = vx + rand(-25, 25)
  p.vy = vy + rand(-30, 0)
  p.phase = rand(0, 6.28)
}

function stepResting(world, p, dt, pointer) {
  var s = world.surfaces[p.rest]
  if (!s) { p.rest = null; return true }
  p.restAge += dt
  if (p.slide) {
    var before = p.slide
    p.slide -= sign(p.slide) * 0.6 * G * dt
    if (sign(p.slide) !== sign(before)) p.slide = 0
    p.ox += p.slide * dt
    if (!s.ground && (p.ox < 0 || p.ox > s.w)) { release(p, s, s.vx + before, s.vy); return true }
  }
  p.x = s.x + p.ox
  p.y = s.y - heightAt(s, p.x) - 1
  if (p.kind === "petal") {
    p.restLeft -= dt
    if (p.restLeft <= 0) return false
  }
  // The window under it lurches harder than friction can hold, or drops
  // away: it comes off with the window's speed.
  if (!s.ground) {
    var geff = G - s.ay
    if (geff < G * 0.15 || Math.abs(s.ax) > 0.55 * geff) {
      release(p, s, s.vx, s.vy)
      return true
    }
  }
  // A strong gust lifts it now and then.
  var gust = airAt(world, p.x, p.y)
  if (world.gustList.length && gustAt(world, p.x, p.y)) gust += world.gx
  if (Math.abs(gust) > 34 && Math.random() < dt * (Math.abs(gust) - 34) * 0.006) {
    release(p, s, s.vx + gust * 1.5, s.vy - rand(50, 130))
    return true
  }
  // A pointer sweeping through scatters it.
  if (pointer) {
    var dx = p.x - pointer.x, dy = p.y - pointer.y
    var speed = Math.hypot(pointer.vx || 0, pointer.vy || 0)
    if (speed > 160 && dx * dx + dy * dy < 55 * 55) {
      release(p, s, s.vx + (pointer.vx || 0) * 0.45 + (dx >= 0 ? 60 : -60), s.vy - rand(140, 280))
      p.y = s.y - heightAt(s, p.x) - 6
    }
  }
  return true
}

function stepFirefly(world, p, dt, pointer) {
  p.phase += dt * p.blink * 2.4
  var still = pointer && (pointer.stillFor || 0) > 1.2
  var tx, ty, pull
  if (still) {
    // Circle the resting pointer.
    var ang = world.time * p.orbitSpeed + p.phase * 0.3
    tx = pointer.x + Math.cos(ang) * p.orbit
    ty = pointer.y + Math.sin(ang) * p.orbit * 0.7
    pull = 1.6
  } else {
    p.heading += rand(-1.6, 1.6) * dt
    tx = p.x + Math.cos(p.heading) * 60
    ty = p.y + Math.sin(p.heading) * 40
    pull = 0.6
    if (pointer) {
      var dx = p.x - pointer.x, dy = p.y - pointer.y
      var speed = Math.hypot(pointer.vx || 0, pointer.vy || 0)
      if (speed > 300 && dx * dx + dy * dy < 140 * 140) {
        tx = p.x + dx * 2; ty = p.y + dy * 2; pull = 3
      }
    }
  }
  var k = follow(dt, 0.55)
  p.vx += ((tx - p.x) * pull - p.vx) * k
  p.vy += ((ty - p.y) * pull - p.vy) * k
  var max = still ? 160 : 70
  var sp = Math.hypot(p.vx, p.vy)
  if (sp > max) { p.vx *= max / sp; p.vy *= max / sp }
  p.x += p.vx * dt
  p.y += p.vy * dt
  // Keep them on screen: turn back softly at the edges.
  if (p.x < 10) { p.x = 10; p.vx = Math.abs(p.vx); p.heading = 0 }
  if (p.x > world.width - 10) { p.x = world.width - 10; p.vx = -Math.abs(p.vx); p.heading = Math.PI }
  if (p.y < world.height * 0.1) { p.y = world.height * 0.1; p.vy = Math.abs(p.vy); p.heading = Math.PI / 2 }
  if (p.y > groundY(world) - 6) { p.y = groundY(world) - 6; p.vy = -Math.abs(p.vy); p.heading = -Math.PI / 2 }
}

// Leaves pile up but never without limit: the oldest resting ones go.
function capResting(world) {
  var cap = TUNING.leaves.restCap
  var resting = []
  for (var i = 0; i < world.particles.length; i++) {
    var p = world.particles[i]
    if (p.kind === "leaf" && p.rest) resting.push(p)
  }
  if (resting.length <= cap) return
  resting.sort(function(a, b) { return b.restAge - a.restAge })
  for (var j = 0; j < resting.length - cap; j++) resting[j].dead = true
  world.particles = world.particles.filter(function(p) { return !p.dead })
}

// ------------------------------------------------------------------ queries

// The top of the pile under x on a surface, for decorations that stand on
// windows or the ground.
function restingY(world, surfaceId, x) {
  var s = world.surfaces[surfaceId]
  if (!s) return null
  return s.y - heightAt(s, x)
}

// Where something with a footprint `half` px either side of x comes to
// rest. One sample under its middle stood a snowman on the crest of a
// drift with its base hanging over the hollows; a heavy body packs the
// snow under it, so it settles to the average depth across its base,
// pressed in a little.
var PACK = 0.85
function restingYUnder(world, surfaceId, x, half) {
  var s = world.surfaces[surfaceId]
  if (!s) return null
  if (!(half > 0)) return restingY(world, surfaceId, x)
  var n = 9, sum = 0
  for (var i = 0; i < n; i++) sum += heightAt(s, x - half + 2 * half * i / (n - 1))
  return s.y - PACK * sum / n
}

// Whether a point on a surface is hidden by a window in front of it, for
// decorations standing on windows.
function surfaceCovered(world, surfaceId, x, y) {
  var s = world.surfaces[surfaceId]
  return !!s && !s.ground && covered(s, x, y)
}

// A surface's estimated motion, for decorations that sway when their window
// is dragged.
function surfaceMotion(world, surfaceId) {
  var s = world.surfaces[surfaceId]
  if (!s) return { vx: 0, vy: 0, ax: 0, ay: 0 }
  return { vx: s.vx, vy: s.vy, ax: s.ax, ay: s.ay }
}

// For tests and the status IPC.
// ------------------------------------------------------------------ the plow
//
// A bulldozer that clears the ground snow. It is part of the simulation:
// its blade scrapes the height field, what it scrapes up becomes a berm in
// front of the blade that slows it down, the berm's face sheds tumbling
// chunks that land ahead and get pushed again, snow curls over the blade
// top when the berm is full, and its cab roof is a surface like a window's,
// so snow settles on it and slides off when it pulls away. What it pushes
// past the screen edge is gone.

function plowScale(world) { return clamp(world.height / 1080, 0.8, 1.6) }

function groundFill(world) {
  var g = world.surfaces[GROUND_ID]
  if (!g || !g.bins.length) return 0
  var cap = TUNING.snow.groundCap, t = 0
  for (var i = 0; i < g.bins.length; i++) t += Math.min(1, g.bins[i] / cap)
  return t / g.bins.length
}

// The plow switch. Switched off, no plow comes, on its own or when called
// (requestPlow refuses); one already out finishes its pass without
// stopping, a little quicker, and drives off the far side.
function setPlow(world, on) {
  world.plowEnabled = !!on
  if (world.plow) world.plow.recall = !on
}

// A call for the plow from the shell (`flurry plow`): "sent", or why not:
// "off" (the switch is off) or "out" (one is already on its way).
function requestPlow(world) {
  if (!world.plowEnabled) return "off"
  if (world.plow) return "out"
  return callPlow(world) ? "sent" : "out"
}

// Sends the plow out now if it is not already out. Returns whether it went.
function callPlow(world, dir) {
  if (world.plow) return false
  var k = plowScale(world)
  dir = dir === -1 || dir === 1 ? dir : world.plowDir
  world.plowDir = -dir
  // It drives in from beyond the edge with its blade up, at a walking pace.
  var start = dir > 0 ? -12 * k : world.width + 12 * k
  world.plow = {
    dir: dir, k: k,
    x: start,               // the blade's cutting edge
    v: PLOW.speed * k * 0.75,
    lift: 1,                // 0 blade on the ground .. 1 raised
    load: 0, scraped: 0, sideSpill: 0,
    bermH: 0, bermLen: 0, bermFlat: 0,
    tread: 0, pitch: 0, pitchV: 0, bob: 0,
    throttle: 0.6, age: 0, smokeDebt: 0, spillDebt: 0,
    done: false
  }
  world.plowRuns++
  return true
}

function plowRear(P) { return P.x - P.dir * PLOW.bodyLength * P.k }

function stepPlow(world, dt) {
  var P = world.plow
  if (!P) {
    world.plowCheck -= dt
    if (world.plowCheck > 0) return
    world.plowCheck = 0.5
    if (world.plowEnabled && world.effect === "snow" && world.time >= world.plowRest &&
        groundFill(world) >= PLOW.threshold) callPlow(world)
    return
  }
  var g = world.surfaces[GROUND_ID]
  var k = P.k, dir = P.dir
  var W = world.width
  P.age += dt

  // Where the blade is: entering, on the screen, or past the far edge.
  var edgeIn = dir > 0 ? P.x > 2 * k : P.x < W - 2 * k
  var pastEnd = dir > 0 ? P.x > W + 4 * k : P.x < -4 * k
  var liftTarget = !edgeIn ? 1 : (pastEnd ? 1 : 0)
  var dl = liftTarget - P.lift
  P.lift += clamp(dl, -PLOW.liftSpeed * dt, PLOW.liftSpeed * dt)

  // Speed: the berm's weight slows it; it eases off while lowering the blade.
  var share = Math.max(PLOW.minSpeedShare, 1 / (1 + P.load / PLOW.loadDrag))
  var target = PLOW.speed * k * share * (P.lift > 0.05 && P.lift < 0.95 ? 0.8 : 1)
  if (pastEnd) target = PLOW.speed * k * 1.15
  // Switched off mid-run: it finishes the pass at a brisker pace.
  if (P.recall) target = Math.max(target, PLOW.speed * k * 1.4)
  var before = P.v
  P.v += (target - P.v) * follow(dt, PLOW.accel)
  var accel = (P.v - before) / dt
  var x0 = P.x
  P.x += dir * P.v * dt
  P.tread += P.v * dt

  // The blade scrapes every cell its edge has passed and its body covers.
  // Raised part-way, it only shaves the snow above its edge.
  var bladeH = PLOW.bladeHeight * k
  var floor = P.lift * bladeH * 0.9
  if (g && P.lift < 0.98) {
    var n = g.bins.length
    var a = dir > 0 ? Math.min(x0, P.x) - PLOW.bodyLength * k : P.x
    var b = dir > 0 ? P.x : Math.max(x0, P.x) + PLOW.bodyLength * k
    var i0 = clamp(Math.floor((a - g.x) / CELL), 0, n - 1)
    var i1 = clamp(Math.ceil((b - g.x) / CELL), 0, n - 1)
    for (var i = i0; i <= i1; i++) {
      var cx = g.x + (i + 0.5) * CELL
      var behind = dir > 0 ? cx <= P.x : cx >= P.x
      if (!behind) continue
      var take = g.bins[i] - floor
      if (take <= 0) continue
      g.bins[i] -= take
      g.slip[i] = 0
      P.load += take
      P.scraped += take
    }
  }

  // Past the edge, what is in front of the blade leaves with it.
  if (pastEnd) P.load = Math.max(0, P.load - P.load * follow(dt, 0.6))

  // The berm: a mound heaped against the blade, about 2.4 times as long as
  // it is tall, up to well over the blade's top. Past that the blade
  // carries no more: the extra spills off its ends, out of the picture.
  var area = P.load * CELL
  var shapeArea = 0.62 * 2.4               // area of the mound per H² (its profile)
  var maxH = bladeH * PLOW.bermMax
  var tall = Math.sqrt(area / shapeArea)
  if (tall > maxH) {
    var over = (area - shapeArea * maxH * maxH) / CELL
    P.load -= over
    P.sideSpill += over
    tall = maxH
  }
  P.bermH = tall
  P.bermLen = tall * 2.4
  P.bermFlat = 0
  var capH = bladeH * 0.98
  var gy = groundY(world)
  // Snow tumbles down the berm's face and is pushed again where it lands,
  // the faster and the fuller the more.
  if (P.bermH > 3 * k && P.v > 8 && world.particles.length < maxParticles(world)) {
    P.spillDebt += dt * (P.v / (PLOW.speed * k)) * (P.bermH / bladeH) * 7
    while (P.spillDebt >= 1 && P.load > 1) {
      P.spillDebt -= 1
      var m = Math.min(P.load * 0.08, rand(0.5, 1.8))
      P.load -= m
      var u = rand(0.15, 0.85)
      var sx = P.x + dir * P.bermLen * (0.15 + (1 - u) * 0.6)
      world.particles.push({
        kind: "clump", x: sx, y: gy - P.bermH * u - 1,
        vx: dir * (P.v + rand(15, 60)), vy: -rand(20, 110),
        r: chunkRadius(m), amount: m, pack: 0.75,
        angle: rand(0, 6.28), spin: dir * rand(4, 10), life: 6, age: 0, rest: null
      })
    }
    // A berm over the blade's top: snow curls over it and puffs off.
    if (P.bermH >= capH && Math.random() < dt * 14 * (P.bermH / maxH)) {
      addPowder(world, P.x + dir * rand(0, 8) * k, gy - P.bermH - rand(0, 3), dir * (P.v + rand(20, 80)), -rand(50, 130), 0)
    }
  } else P.spillDebt = 0

  // Body motion: the nose dips as the berm pushes back and on braking, and
  // the engine shakes it a little.
  var pitchTarget = clamp(-accel / G * 0.6 + P.load * 0.00002 - (1 - P.lift) * 0.003, -0.02, 0.018)
  P.pitchV += ((pitchTarget - P.pitch) * 60 - P.pitchV * 9) * dt
  P.pitch += P.pitchV * dt
  P.throttle += (clamp(0.35 + Math.max(0, accel) / 200 + P.load / 400, 0.3, 1) - P.throttle) * follow(dt, 0.3)
  P.bob = Math.sin(world.time * 47) * 0.35 * k * P.throttle + Math.sin(P.tread / (7 * k) * Math.PI * 2) * 0.25 * k

  // Exhaust: a steady trickle, thicker under load.
  P.smokeDebt += dt * (5 + 16 * P.throttle)
  var stackX = P.x + dir * PLOW.stack.x * k
  var stackY = gy + PLOW.stack.y * k + P.bob
  while (P.smokeDebt >= 1) {
    P.smokeDebt -= 1
    if (world.particles.length > maxParticles(world) * 1.2) break
    var life = rand(1.4, 2.6)
    world.particles.push({
      kind: "smoke", x: stackX + rand(-1, 1) * k, y: stackY,
      vx: -dir * P.v * 0.25 + rand(-10, 10), vy: -rand(70, 120) * (0.6 + P.throttle * 0.6),
      r0: 2 * k, r1: rand(7, 12) * k, r: 2.2 * k,
      shade: P.throttle, life: life, age: 0, rest: null
    })
  }

  // The cab roof: a surface like a window's top, so snow lands on it.
  var roofX = P.x + dir * PLOW.roof.back * k - (dir < 0 ? PLOW.roof.length * k : 0)
  var rect = { id: PLOW_ID, x: roofX, y: gy - PLOW.roof.height * k + P.bob, w: PLOW.roof.length * k, h: 40 * k }
  var roof = world.surfaces[PLOW_ID]
  if (!roof) {
    roof = makeSurface(PLOW_ID, rect.x, rect.y, rect.w, false)
    roof.h = rect.h
    roof.floating = true
    roof.z = -1e9
    roof.plow = true
    roof.sampleT = world.time
    world.surfaces[PLOW_ID] = roof
    rebuildOrder(world)
  } else {
    track(world, roof, rect, world.time)
  }

  // Gone past the far edge: done until the snow builds up again.
  var rear = plowRear(P)
  if (dir > 0 ? rear > W + 30 * k : rear < -30 * k) {
    var r = world.surfaces[PLOW_ID]
    if (r) { delete world.surfaces[PLOW_ID]; spill(world, r); rebuildOrder(world) }
    world.plow = null
    world.plowRest = world.time + PLOW.rest
  }
}

// ------------------------------------------------------------------ light strings
//
// The wire is a chain of links solved with Verlet integration: gravity, a
// pull toward the speed of the air (so gusts and the pointer's wake sway
// it), and length constraints; the clips move with the window, so dragging
// it swings the swags and they settle. Each bulb hangs from its socket as a
// damped pendulum driven by its link's acceleration.

// specs: [{ id, surface, palette }] for the strings whose window is on this
// screen now. Strings not listed are taken down.
function setStrings(world, specs) {
  var keep = {}
  for (var i = 0; i < specs.length && i < 24; i++) {
    var sp = specs[i]
    var s = world.surfaces[sp.surface]
    if (!s || s.ground || s.plow) continue
    keep[sp.id] = true
    var L = world.strings[sp.id]
    if (!L || L.surface !== sp.surface) L = world.strings[sp.id] = hangString(sp.id, s, null)
    L.palette = sp.palette || "warm"
  }
  for (var id in world.strings) if (!keep[id]) delete world.strings[id]
}

function clipCount(w) { return clamp(Math.round((w - 2 * LIGHTS.inset) / LIGHTS.span), 1, 24) }

// A string at rest on `s`: each swag a parabola with the sag its slack gives.
function hangString(id, s, old) {
  var n = clipCount(s.w)
  var span = (s.w - 2 * LIGHTS.inset) / n
  var m = LIGHTS.links
  var sag = Math.sqrt(3 * span * span * (LIGHTS.slack - 1) / 8)
  var pts = []
  for (var j = 0; j < n; j++) {
    for (var i = (j === 0 ? 0 : 1); i <= m; i++) {
      var t = i / m
      var x = s.x + LIGHTS.inset + (j + t) * span
      var y = s.y + LIGHTS.drop + sag * 4 * t * (1 - t)
      pts.push({ x: x, y: y, px: x, py: y, vx: 0, vy: 0 })
    }
  }
  var bulbs = []
  for (var k = 0; k < pts.length; k++) {
    if (k % 2 === 0) continue
    var prev = old && old.bulbs[bulbs.length]
    bulbs.push({
      i: k, theta: 0, omega: 0,
      phase: prev ? prev.phase : rand(0, 6.28),
      freq: prev ? prev.freq : rand(0.5, 1.3),
      hue: bulbs.length
    })
  }
  return { id: id, surface: s.id, n: n, span: span, pts: pts, bulbs: bulbs,
           ox: s.x, oy: s.y, palette: old ? old.palette : "warm" }
}

function stepStrings(world, dt, pointer) {
  for (var id in world.strings) {
    var L = world.strings[id]
    var s = world.surfaces[L.surface]
    if (!s) continue
    // A window that jumped (another workspace, a snap) takes the string
    // with it as it hangs, rather than whipping it across the screen.
    var jx = s.x - L.ox, jy = s.y - L.oy
    if (Math.abs(jx) > 400 || Math.abs(jy) > 400) {
      for (var q = 0; q < L.pts.length; q++) {
        var pq = L.pts[q]
        pq.x += jx; pq.y += jy; pq.px += jx; pq.py += jy
      }
    }
    L.ox = s.x; L.oy = s.y
    var span = (s.w - 2 * LIGHTS.inset) / L.n
    if (span < LIGHTS.minSpan || span > LIGHTS.maxSpan) {
      L = world.strings[id] = hangString(id, s, L)
      span = L.span
    }
    L.span = span
    stepWire(world, L, s, dt, pointer)
  }
}

function stepWire(world, L, s, dt, pointer) {
  var pts = L.pts, m = LIGHTS.links
  var rest = span2rest(L.span)
  var subs = 2, h = dt / subs
  var air = follow(h, LIGHTS.airTau)
  var top = s.y + 1
  for (var sub = 0; sub < subs; sub++) {
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i]
      if (i % m === 0) {
        // A clip: fixed to the window.
        var nx = s.x + LIGHTS.inset + (i / m) * L.span, ny = s.y + LIGHTS.drop
        p.vx = (nx - p.x) / h; p.vy = (ny - p.y) / h
        p.px = p.x; p.py = p.y
        p.x = nx; p.y = ny
        continue
      }
      var vx = (p.x - p.px) / h, vy = (p.y - p.py) / h
      var wake = pointerWake(pointer, p.x, p.y, 70)
      var ax = airAt(world, p.x, p.y) * 0.5 + (wake ? wake.x : 0)
      var ay = wake ? wake.y : 0
      vx += (ax - vx) * air
      vy += (ay - vy) * air + G * h
      p.px = p.x; p.py = p.y
      p.x += vx * h; p.y += vy * h
    }
    for (var it = 0; it < LIGHTS.iterations; it++) {
      for (var k = 0; k + 1 < pts.length; k++) {
        var a = pts[k], b = pts[k + 1]
        var dx = b.x - a.x, dy = b.y - a.y
        var d = Math.sqrt(dx * dx + dy * dy) || 1e-6
        var diff = (d - rest) / d
        var fa = k % m === 0 ? 0 : 0.5, fb = (k + 1) % m === 0 ? 0 : 0.5
        if (fa === 0 && fb !== 0) fb = 1
        if (fb === 0 && fa !== 0) fa = 1
        a.x += dx * diff * fa; a.y += dy * diff * fa
        b.x -= dx * diff * fb; b.y -= dy * diff * fb
      }
      // The wire lies against the window; it can't pass up through its top.
      for (var c = 0; c < pts.length; c++) if (pts[c].y < top) pts[c].y = top
    }
  }
  // Bulbs: pendulums on their sockets.
  var g = LIGHTS.socket
  for (var j = 0; j < L.bulbs.length; j++) {
    var bl = L.bulbs[j]
    var q = pts[bl.i]
    var qvx = (q.x - q.px) / h, qvy = (q.y - q.py) / h
    var lvx = bl.lvx === undefined ? qvx : bl.lvx, lvy = bl.lvy === undefined ? qvy : bl.lvy
    var accx = clamp((qvx - lvx) / dt, -8000, 8000), accy = clamp((qvy - lvy) / dt, -8000, 8000)
    bl.lvx = qvx; bl.lvy = qvy
    var alpha = (-(G - accy) * Math.sin(bl.theta) - accx * Math.cos(bl.theta)) / g
    bl.omega += (alpha - bl.omega * LIGHTS.bulbDamping) * dt
    bl.theta = clamp(bl.theta + bl.omega * dt, -1.05, 1.05)
  }
}

function span2rest(span) { return span * LIGHTS.slack / LIGHTS.links }

// The window under a point, front-most first; null for bare desktop.
function surfaceAt(world, x, y) {
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.ground || s.plow) continue
    if (x >= s.x && x <= s.x + s.w && y >= s.y - 6 && y <= s.y + s.h) return s.id
  }
  return null
}

function stats(world) {
  var counts = {}
  for (var i = 0; i < world.particles.length; i++) {
    var k = world.particles[i].kind
    counts[k] = (counts[k] || 0) + 1
  }
  var sliding = 0
  for (var id in world.surfaces) if (world.surfaces[id].sliding) sliding++
  return { effect: world.effect, particles: world.particles.length, kinds: counts,
           surfaces: world.order.length - (world.surfaces[PLOW_ID] ? 1 : 0), snow: Math.round(totalSnow(world)), sliding: sliding,
           plow: world.plow ? { x: Math.round(world.plow.x), load: Math.round(world.plow.load), lift: +world.plow.lift.toFixed(2) } : null,
           groundFill: +groundFill(world).toFixed(3), plowRuns: world.plowRuns,
           balls: world.balls.map(function(b) { return { r: +b.r.toFixed(1), x: Math.round(b.x), y: Math.round(b.y), held: b.held } }),
           extras: extrasStats(world) }
}

// ------------------------------------------------------------------ snowballs
//
// Press on snow that lies deep enough and a handful comes up as a lumpy
// seed in your hand. Drag it along the snow and it rolls: every cell its
// skin rolls over for the first time gives it a layer (more from packed
// snow than powder), so it grows and slows as it takes on mass, and the
// snow it rolls over is pressed down into a firm track. Snow is plastic
// up to a limit: under the ball it is squeezed to fit the ball's shape
// until it reaches `rhoMax` times its fresh density, and from there it
// holds the ball up, which is how a ball sinks in and leaves a print.
//
// Held, the ball hangs from the hand on a damped spring whose stiffness
// falls as the ball grows, so a big one lags and sags a little. Let go and
// it keeps the speed it had: it flies under gravity with a little drag,
// spins with the spin it left with, lands, bounces a little (less in deep
// snow), rolls with a sphere's rolling constraint and rolling resistance,
// rolls off window edges, rides moving windows and lifts off when they
// drop away. Hit something hard enough and it bursts: part of it stays
// as a splat, the rest flies as chunks and powder. Balls knock into each
// other, and can be stacked.

var BALL = {
  seedDepth: 2.5,            // px of snow under the press needed to start one
  scoop: 10,                 // half-width of the first handful, px
  scoopShare: 0.6,           // share of the depth there that it takes
  minKeep: 3.4,              // a lump smaller than this crumbles when let go, px
  maxRadius: 70,             // px on a 1080 px screen; past this it stops growing
  density: 1.6,              // ball snow over fresh snow
  rhoMax: 2.1,               // snow pressed to this density holds the ball up
  pickup: [0.28, 0.45],      // share of a cell's depth the skin picks up, powder..packed
  hold: 30,                  // spring rate of a small held ball, 1/s
  roll: 0.03,                // rolling resistance on a bare top, in g
  plough: 0.06,              // extra resistance per (snow depth / radius), in g
  restitution: [0.3, 0.1],   // bare top .. deep snow
  splat: 1400,               // impact speed that bursts a 10 px ball, px/s
  max: 6,
  maxSpeed: 3200
}

function ballScale(world) { return clamp(world.height / 1080, 0.8, 1.6) }

// Mass of a ball as snow it took: depth-px summed over cells (like bins).
function ballLoose(b) { return b.area * BALL.density / CELL }

function rhoOf(s) {
  if (!s.rho || s.rho.length !== s.bins.length) {
    s.rho = new Array(s.bins.length)
    for (var i = 0; i < s.rho.length; i++) s.rho[i] = 1
  }
  return s.rho
}

function makeBall(world, x, y, area, pack) {
  var b = {
    id: ++world.ballSeq, x: x, y: y, px: x, py: y, vx: 0, vy: 0,
    area: area, r: Math.sqrt(area / Math.PI), angle: rand(0, 6.28), omega: 0,
    pack: clamp(pack, 0.3, 1), round: 0, held: false, ox: 0, oy: 0,
    contact: null, contactAge: 1, track: null, floorY: y, lip: null,
    shape: [rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)],
    blobs: [], glints: [], blobDebt: 0, speed: 0, age: 0
  }
  for (var i = 0; i < 9; i++) addBlob(b, rand(0, 6.28), rand(0.15, 0.95))
  for (var g = 0; g < 14; g++) b.glints.push({ a: rand(0, 6.28), f: Math.sqrt(Math.random()) * 0.92, ph: rand(0, 6.28) })
  return b
}

// A clump of snow stuck on the ball's face, in the ball's own frame.
function addBlob(b, a, f) {
  b.blobs.push({ a: a, f: f, s: rand(0.1, 0.22), t: rand(-1, 1), born: b.r })
  if (b.blobs.length > 46) {
    // Layers wrap over older ones: drop the one buried deepest.
    var k = 0, worst = 1e9
    for (var i = 0; i < b.blobs.length; i++) {
      var depth = b.blobs[i].born / b.r
      if (depth < worst) { worst = depth; k = i }
    }
    b.blobs.splice(k, 1)
  }
}

function setBallArea(b, area) {
  b.area = area
  b.r = Math.sqrt(area / Math.PI)
}

// The snow under a point, if there is enough of it to make a ball from.
function snowAt(world, x, y) {
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.plow || x < s.x || x > s.x + s.w) continue
    var h = heightAt(s, x)
    var top = s.y - h
    if (y < top - 10 || y > s.y + 6) continue
    if (!s.ground && covered(s, x, top)) continue
    if (h < BALL.seedDepth) return null
    return { surface: s, depth: h, top: top }
  }
  return null
}

function ballAt(world, x, y) {
  for (var i = world.balls.length - 1; i >= 0; i--) {
    var b = world.balls[i]
    var dx = x - b.x, dy = y - b.y, reach = b.r + 6
    if (dx * dx + dy * dy <= reach * reach) return b
  }
  return null
}

function takeHold(world, b, x, y) {
  var dx = x - b.x, dy = y - b.y
  var d = Math.hypot(dx, dy), lim = b.r * 0.8
  if (d > lim) { dx *= lim / d; dy *= lim / d }
  b.held = true
  b.ox = dx; b.oy = dy
  world.balls.splice(world.balls.indexOf(b), 1)
  world.balls.push(b)
  world.hand = { x: x, y: y, lx: x, ly: y, vx: b.vx, vy: b.vy, ball: b, fresh: true }
}

// Pointer pressed at (x, y). Picks up the ball there, or scoops a handful
// from the snow there. Returns "ball", "seed", or "" when there is nothing
// to take hold of.
function grabSnow(world, x, y) {
  if (world.hand) letGo(world)
  var b = ballAt(world, x, y)
  if (b) { takeHold(world, b, x, y); return "ball" }
  var hit = snowAt(world, x, y)
  if (!hit) return ""
  var s = hit.surface
  var n = s.bins.length, rho = rhoOf(s)
  var i0 = clamp(Math.floor((x - BALL.scoop - s.x) / CELL), 0, n - 1)
  var i1 = clamp(Math.ceil((x + BALL.scoop - s.x) / CELL), 0, n - 1)
  var mass = 0
  for (var i = i0; i <= i1; i++) {
    var dx = Math.abs(s.x + (i + 0.5) * CELL - x) / BALL.scoop
    if (dx > 1) continue
    var take = s.bins[i] * BALL.scoopShare * (1 - 0.5 * dx)
    s.bins[i] -= take
    s.slip[i] = 0
    mass += take * rho[i]
  }
  var area = Math.max(Math.PI * 2.5 * 2.5, mass * CELL / BALL.density)
  var r = Math.sqrt(area / Math.PI)
  if (world.balls.length >= BALL.max) {
    for (var k = 0; k < world.balls.length; k++) if (!world.balls[k].held) { crumble(world, world.balls[k]); break }
  }
  var ball = makeBall(world, x, s.y - heightAt(s, x) - r, area, s.pack)
  ball.vx = s.vx; ball.vy = s.vy
  ball.contact = s.id; ball.contactAge = 0
  world.balls.push(ball)
  for (var p = 0; p < 3; p++) addPowder(world, x + rand(-6, 6), hit.top - 1, rand(-40, 40), -rand(30, 90), 0)
  takeHold(world, ball, x, y)
  return "seed"
}

function dragSnow(world, x, y) {
  if (!world.hand) return
  world.hand.x = x
  world.hand.y = y
}

// Pointer released: the ball keeps the speed it had in the hand.
function letGo(world) {
  var H = world.hand
  world.hand = null
  if (!H) return
  var b = H.ball
  b.held = false
  var sp = Math.hypot(b.vx, b.vy)
  if (sp > BALL.maxSpeed) { b.vx *= BALL.maxSpeed / sp; b.vy *= BALL.maxSpeed / sp }
  if (b.r < BALL.minKeep && world.balls.indexOf(b) >= 0) crumble(world, b)
}

function removeBall(world, b) {
  var i = world.balls.indexOf(b)
  if (i >= 0) world.balls.splice(i, 1)
  if (world.hand && world.hand.ball === b) world.hand = null
}

// Falls apart where it is, gently.
function crumble(world, b) {
  removeBall(world, b)
  spawnChunks(world, b.x, b.y, ballLoose(b), b.vx, b.vy, 0.8)
}

function splatSpeed(b, cushion) {
  var v = BALL.splat * clamp(Math.pow(10 / b.r, 0.35), 0.55, 1.4) * (0.85 + 0.3 * b.pack) + (cushion || 0) * 25
  // A snowball that has come all the way from a friend's screen bursts on
  // the first thing it hits.
  return b.incoming ? v * 0.3 : v
}

// Bursts on impact at (cx, cy) moving at (rvx, rvy) relative to surface s
// (null for a wall or another ball): part of it stays stuck there, the
// rest flies off as chunks and powder.
function splat(world, b, s, cx, cy, rvx, rvy, nx, ny) {
  world.thud = { x: cx, y: cy, t: world.time }
  removeBall(world, b)
  var loose = ballLoose(b)
  var speed = Math.hypot(rvx, rvy)
  var stay = 0
  if (s) {
    stay = loose * 0.45
    var spread = b.r * 1.3, wsum = 0, cells = []
    for (var x = cx - spread; x <= cx + spread; x += CELL) {
      var t = (x - cx) / spread
      var wgt = 1 - t * t
      if (x < s.x || x > s.x + s.w) continue
      cells.push([x, wgt]); wsum += wgt
    }
    var skid = clamp(rvx * 0.25, -200, 200)
    for (var c = 0; c < cells.length; c++) deposit(world, s, cells[c][0], stay * cells[c][1] / wsum, skid)
    if (!cells.length) stay = 0
    var m = sumOf(s.bins)
    if (m > 0) s.pack = clamp(s.pack + (0.9 - s.pack) * Math.min(1, stay / m), 0, 1)
  }
  var flying = loose - stay
  var dust = flying * 0.15
  var solid = flying - dust
  var count = clamp(Math.round(solid / 2.5), 3, 14)
  if (world.particles.length > maxParticles(world)) count = 1
  // Bits fly back off the surface, keeping some of the ball's sideways speed.
  var ux = nx === undefined ? 0 : -nx, uy = ny === undefined ? -1 : -ny
  for (var k = 0; k < count; k++) {
    var a = rand(-1.25, 1.25)
    var dirx = ux * Math.cos(a) - uy * Math.sin(a), diry = ux * Math.sin(a) + uy * Math.cos(a)
    var out = rand(0.12, 0.34) * Math.min(speed, 1600) + rand(20, 60)
    var pm = solid / count
    world.particles.push({
      kind: "clump", x: b.x + dirx * b.r * rand(0.2, 0.8), y: b.y + diry * b.r * rand(0.2, 0.8),
      vx: rvx * rand(0.15, 0.4) + dirx * out + (s ? s.vx : 0), vy: rvy * rand(0, 0.1) + diry * out + (s ? s.vy : 0),
      r: chunkRadius(pm), amount: pm, pack: 0.85,
      angle: rand(0, 6.28), spin: rand(-12, 12), life: 8, age: 0, rest: null
    })
  }
  for (var d = 0; d < 6; d++) {
    var pa = rand(-1.4, 1.4)
    var px = ux * Math.cos(pa) - uy * Math.sin(pa), py = ux * Math.sin(pa) + uy * Math.cos(pa)
    addPowder(world, cx + rand(-b.r, b.r) * 0.6, cy - 2, px * rand(60, 220) + rvx * 0.1, py * rand(60, 220), dust / 6)
  }
}

// One step of a ball: forces, then contact with the tops of windows and
// the ground.
function integrateBall(world, b, h) {
  var H = world.hand
  var held = !!H && H.ball === b
  b.px = b.x; b.py = b.y
  var ax = 0, ay = G
  if (held) {
    var w = BALL.hold / (1 + b.r / 40)
    var fx = w * w * (H.x - b.ox - b.x) - 1.7 * w * (b.vx - H.vx)
    var fy = w * w * (H.y - b.oy - b.y) - 1.7 * w * (b.vy - H.vy)
    var lim = 60000 / (1 + b.r / 25)
    var fm = Math.hypot(fx, fy)
    if (fm > lim) { fx *= lim / fm; fy *= lim / fm }
    ax += fx; ay += fy
  } else {
    var sp = Math.hypot(b.vx, b.vy)
    var k = 0.0009 / b.r
    ax -= k * b.vx * sp; ay -= k * b.vy * sp
  }
  b.vx += ax * h; b.vy += ay * h
  b.x += b.vx * h; b.y += b.vy * h

  var touched = contactBall(world, b, h, held)
  if (touched === "gone") return false
  if (!touched) {
    b.contactAge += h
    if (b.contactAge > 0.12) { b.contact = null; b.track = null; b.lip = null }
    b.omega *= Math.exp(-h / (held ? 0.18 : 5))
  }
  b.angle += b.omega * h

  // The sides of the screen. Thrown hard enough, with friends on the far
  // side, it sails off the edge and on to their screen.
  var W = world.width
  if (!b.leaving && world.throwOut && !held) b.leaving = throwsOff(b, W, THROW.speed * ballScale(world))
  if (b.leaving) {
    if ((b.leaving === "right" && b.x - b.r > W) || (b.leaving === "left" && b.x + b.r < 0) || b.y > world.height + b.r) {
      removeBall(world, b)
      if (b.y <= world.height) pushEvent(world, { type: "throw", side: b.leaving, y: clamp(b.y / world.height, 0, 1),
                                                   vx: Math.abs(b.vx), vy: b.vy, r: b.r / ballScale(world) })
      return false
    }
    return true
  }
  if (b.x - b.r < 0 || b.x + b.r > W) {
    var side = b.x - b.r < 0 ? -1 : 1
    b.x = side < 0 ? b.r : W - b.r
    if (b.vx * side > 0) {
      if (!held && Math.abs(b.vx) > splatSpeed(b, 0) * 1.1) {
        splat(world, b, null, b.x + side * b.r, b.y, b.vx, b.vy, side, 0)
        return false
      }
      b.vx = -b.vx * 0.3
      b.omega *= 0.5
    }
  }
  if (b.y < -world.height) { b.y = -world.height; if (b.vy < 0) b.vy = 0 }
  floorBall(world, b)
  return true
}

// Nothing goes through the ground or the sides of the screen, whatever
// pushes it: another ball pressed by the hand, or a hand past the edge.
function floorBall(world, b) {
  if (b.leaving) return
  if (b.x < b.r) b.x = b.r
  else if (b.x > world.width - b.r) b.x = world.width - b.r
  var gy = groundY(world)
  if (b.y + b.r > gy) {
    b.y = gy - b.r
    if (b.vy > 0) b.vy = 0
  }
}

// Finds the top the ball rests on or hits, presses the snow there into
// shape (picking up a layer where it rolls onto fresh snow), and resolves
// the contact. Returns true for a contact, "gone" when it burst.
function contactBall(world, b, h, held) {
  var r = b.r
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (b.x + r < s.x || b.x - r > s.x + s.w) continue
    if (!s.ground) {
      if (b.y > s.y) continue
      // A top it was not on only catches a ball coming down onto it from above.
      if (b.contact !== s.id && (b.py > s.y - r * 0.3 || b.vy - s.vy < -20)) continue
    }
    var res = pressSnow(world, b, s, held)
    if (!res) continue
    return resolveContact(world, b, s, res, h, held)
  }
  return false
}

// Snow depth the sphere's underside allows at x (negative: none).
function underside(b, s, x) {
  var dx = x - b.x
  var q = b.r * b.r - dx * dx
  if (q <= 0) return -1e9
  return s.y - (b.y + Math.sqrt(q))
}

function pressSnow(world, b, s, held) {
  var n = s.bins.length, rho = rhoOf(s)
  var r = b.r
  var i0 = clamp(Math.floor((b.x - r - s.x) / CELL), 0, n - 1)
  var i1 = clamp(Math.ceil((b.x + r - s.x) / CELL), 0, n - 1)
  var rvt = b.vx - s.vx
  var rolling = Math.abs(rvt) > 6
  var k = ballScale(world)
  var grows = r < BALL.maxRadius * k
  var share = mix(BALL.pickup, s.pack)
  var gained = 0, gainedAt = 0
  var touched = false, ahead = 0
  if (b.track && b.track.s !== s.id) b.track = null
  for (var i = i0; i <= i1; i++) {
    var cx = s.x + (i + 0.5) * CELL
    if (!s.ground && covered(s, cx, s.y - s.bins[i])) continue
    var room = underside(b, s, cx)
    if (room < -1e8) continue
    var d = s.bins[i]
    if (d <= room + 0.01) continue
    touched = true
    if (d < 0.05) { rho[i] = 1; continue }
    // First touch of this cell on this pass while rolling: a layer sticks.
    var fresh = !b.track || i < b.track.lo || i > b.track.hi
    if (rolling && fresh && grows && room < d - 0.3) {
      var take = d * share * (rho[i] > 1.3 ? 1.1 : 1)
      s.bins[i] -= take
      gained += take * rho[i]
      gainedAt += cx * take
      d = s.bins[i]
      if (!b.track) b.track = { s: s.id, lo: i, hi: i }
      else { if (i < b.track.lo) b.track.lo = i; if (i > b.track.hi) b.track.hi = i }
      if (rvt * (cx - b.x) > 0) ahead = Math.max(ahead, d)
    }
    // Then it is squeezed to fit under the ball, as far as it will go.
    var firm = d * rho[i] / BALL.rhoMax
    var to = Math.max(room, firm, 0)
    if (to < d) {
      rho[i] = to > 0.05 ? rho[i] * d / to : 1
      s.bins[i] = to
      s.slip[i] = 0
    }
  }
  // The contact point: the highest bit of top under the ball's footprint,
  // relative to the sphere, including the window's corners.
  // Every point that pokes into the ball pushes on it along its own
  // normal; the contact is their penetration-weighted mean, so a ball that
  // lands on a flat bed of snow is pushed straight back up.
  var best = null, sx = 0, sy = 0, sw = 0, cxs = 0, cys = 0
  var consider = function(x, top) {
    var dx = b.x - x, dy = b.y - top
    var dist = Math.hypot(dx, dy)
    if (dist >= r || dist < 1e-6) return
    var pen = r - dist
    sx += pen * dx / dist; sy += pen * dy / dist; sw += pen
    cxs += pen * x; cys += pen * top
    if (!best || pen > best.pen) best = { pen: pen }
  }
  for (var j = i0; j <= i1; j++) {
    var x = s.x + (j + 0.5) * CELL
    if (!s.ground && covered(s, x, s.y - s.bins[j])) continue
    consider(x, s.y - s.bins[j])
  }
  if (!s.ground) {
    consider(s.x, s.y - s.bins[0] * 0.5)
    consider(s.x + s.w, s.y - s.bins[n - 1] * 0.5)
  }
  if (gained > 0) {
    var before = b.area
    setBallArea(b, b.area + gained * CELL / BALL.density)
    // What it picks up was at rest: momentum is shared with it.
    var keep = before / b.area
    b.vx = s.vx + (b.vx - s.vx) * keep
    b.omega *= keep
    b.blobDebt += (b.area - before) / 14
    // Rolling packs it rounder.
    var bottom = Math.atan2(1, 0) - b.angle
    while (b.blobDebt >= 1) {
      b.blobDebt -= 1
      addBlob(b, bottom + rand(-0.6, 0.6), rand(0.7, 0.98))
    }
    // Loose snow kicked up off the front, more the faster and deeper.
    var speed = Math.abs(rvt)
    if (speed > 90 && ahead > 2 && Math.random() < Math.min(1, speed / 600) * 0.7) {
      var dir = sign(rvt)
      addPowder(world, b.x + dir * r * 0.8, s.y - ahead, s.vx + dir * speed * rand(0.3, 0.8), -rand(40, 60 + speed * 0.3), 0)
    }
  }
  if (!best) return touched ? { pen: 0, nx: 0, ny: -1, x: b.x, y: s.y, depth: heightAt(s, b.x) } : null
  var nl = Math.hypot(sx, sy)
  if (nl < 1e-9) { sx = 0; sy = -1; nl = 1 }
  best.nx = sx / nl; best.ny = sy / nl
  best.x = cxs / sw; best.y = cys / sw
  best.depth = heightAt(s, best.x)
  return best
}

function resolveContact(world, b, s, c, h, held) {
  var nx = c.nx, ny = c.ny
  // Only a contact that holds the ball up or back counts.
  if (ny > 0.35) return false
  b.x += nx * c.pen
  b.y += ny * c.pen
  var rvx = b.vx - s.vx, rvy = b.vy - s.vy
  var vn = rvx * nx + rvy * ny
  var newContact = b.contact !== s.id
  var vnAfter = vn
  if (vn < 0) {
    var impact = -vn
    var cushion = c.depth || 0
    if (!held && newContact && impact > splatSpeed(b, cushion)) {
      splat(world, b, s, c.x, c.y, rvx, rvy, -nx, -ny)
      return "gone"
    }
    if (!held && newContact && impact > splatSpeed(b, cushion) * 0.6) {
      // Cracks: a few chunks come off.
      var lost = b.area * 0.12
      setBallArea(b, b.area - lost)
      spawnChunks(world, c.x, c.y - 2, lost * BALL.density / CELL, s.vx + rvx * 0.3, s.vy - impact * 0.25, 0.85)
    }
    var e = impact > 90 ? mix(BALL.restitution, cushion / 12) : 0
    vnAfter = -e * vn
    if (newContact && impact > 150 && cushion > 1.5) {
      // A landing in snow throws some of it up around the ball.
      var puffs = Math.min(6, Math.round(impact / 220))
      for (var p = 0; p < puffs; p++) {
        var side = p % 2 ? 1 : -1
        addPowder(world, c.x + side * b.r * rand(0.5, 1), c.y - 1, s.vx + side * rand(40, 140) + rvx * 0.2, s.vy - rand(60, 80 + impact * 0.25), 0)
      }
    }
  }
  // Tangent along the surface, pointing right for a flat top.
  var tx = -ny, ty = nx
  var vt = rvx * tx + rvy * ty
  // A rolling sphere: friction brings the contact point to rest.
  vt = (5 * vt + 2 * b.omega * b.r) / 7
  if (!held) {
    var resist = (BALL.roll + BALL.plough * (c.depth || 0) / b.r) * G * h
    vt = Math.abs(vt) <= resist ? 0 : vt - sign(vt) * resist
  }
  b.omega = vt / b.r
  b.vx = s.vx + vnAfter * nx + vt * tx
  b.vy = s.vy + vnAfter * ny + vt * ty
  if (b.contact !== s.id) b.track = null
  b.contact = s.id
  b.contactAge = 0
  if (Math.abs(vt) > 4) b.round = Math.min(1, b.round + Math.abs(vt) * h / (2 * Math.PI * b.r) * 0.35)
  // How far the snow beside its track would hide its lower edge.
  var outL = heightAt(s, b.x - b.r - 2 * CELL), outR = heightAt(s, b.x + b.r + 2 * CELL)
  var level = Math.min(Math.max(outL, outR), (outL + outR) / 2 + 2)
  var bottom = s.y - (b.y + b.r)
  var cover = Math.min(level - bottom, b.r * 0.32)
  b.lip = cover > 0.8 ? { y: b.y + b.r - cover, base: s.y } : null
  return true
}

function collideBalls(world) {
  var list = world.balls
  var hb = world.hand ? world.hand.ball : null
  for (var i = 0; i < list.length; i++) {
    for (var j = i + 1; j < list.length; j++) {
      var a = list[i], c = list[j]
      var dx = c.x - a.x, dy = c.y - a.y
      var R = a.r + c.r
      if (dx * dx + dy * dy >= R * R) continue
      var d = Math.sqrt(dx * dx + dy * dy)
      if (d < 1e-4) { dx = 1; dy = 0; d = 1 }
      var nx = dx / d, ny = dy / d
      var ma = a === hb ? 0 : 1 / a.area, mc = c === hb ? 0 : 1 / c.area
      if (ma + mc === 0) continue
      if (seat(a, c, hb) || seat(c, a, hb)) continue
      var pen = R - d
      a.x -= nx * pen * ma / (ma + mc); a.y -= ny * pen * ma / (ma + mc)
      c.x += nx * pen * mc / (ma + mc); c.y += ny * pen * mc / (ma + mc)
      var rvx = c.vx - a.vx, rvy = c.vy - a.vy
      var vn = rvx * nx + rvy * ny
      if (vn >= 0) continue
      var small = a.r < c.r ? a : c
      if (small !== hb && -vn > splatSpeed(small, 0) * 0.9) {
        var sn = small === a ? 1 : -1
        splat(world, small, null, small.x + nx * small.r * sn, small.y + ny * small.r * sn, rvx * -sn, rvy * -sn, nx * sn, ny * sn)
        return collideBalls(world)
      }
      var J = -(1 + 0.15) * vn / (ma + mc)
      a.vx -= J * ma * nx; a.vy -= J * ma * ny
      c.vx += J * mc * nx; c.vy += J * mc * ny
      // Friction at the contact turns slip into spin.
      var tx = -ny, ty = nx
      var slip = (c.vx - a.vx) * tx + (c.vy - a.vy) * ty - (a.omega * a.r + c.omega * c.r)
      var Jt = clamp(-slip / (3.5 * (ma + mc)), -0.5 * J, 0.5 * J)
      a.vx -= Jt * ma * tx; a.vy -= Jt * ma * ty
      c.vx += Jt * mc * tx; c.vy += Jt * mc * ty
      a.omega -= Jt * ma * 2.5 / a.r
      c.omega -= Jt * mc * 2.5 / c.r
    }
  }
}

// Snow sticks to snow: a ball set gently on top of another, near enough
// its crown, presses a small dent into both and stays there, riding along
// if the lower one moves. A knock or the hand takes it off again.
function seat(up, low, hb) {
  if (up === hb) return false
  var dx = up.x - low.x, dy = up.y - low.y
  var R = up.r + low.r
  if (dy >= 0 || Math.abs(dx) > 0.5 * R) return false
  var rel = Math.hypot(up.vx - low.vx, up.vy - low.vy)
  if (rel > 90) return false
  var dent = Math.min(4, 0.12 * Math.min(up.r, low.r))
  var dist = R - dent
  up.x = low.x + dx
  up.y = low.y - Math.sqrt(Math.max(0, dist * dist - dx * dx))
  up.vx = low.vx; up.vy = low.vy
  up.omega *= 0.5
  up.seatedOn = low.id
  return true
}

// The top below a ball, for its shadow.
function floorUnder(world, b) {
  var best = world.height
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.plow || b.x < s.x || b.x > s.x + s.w) continue
    var top = s.y - heightAt(s, b.x)
    if (top < b.y || top >= best) continue
    if (!s.ground && covered(s, b.x, top)) continue
    best = top
  }
  return best
}

function stepBalls(world, dt) {
  var H = world.hand
  if (H) {
    if (world.balls.indexOf(H.ball) < 0) { world.hand = null; H = null }
    else {
      var hvx = H.fresh ? H.ball.vx : (H.x - H.lx) / dt
      var hvy = H.fresh ? H.ball.vy : (H.y - H.ly) / dt
      H.fresh = false
      var a = follow(dt, 0.035)
      H.vx += (hvx - H.vx) * a; H.vy += (hvy - H.vy) * a
      H.lx = H.x; H.ly = H.y
    }
  }
  if (!world.balls.length) return
  var list = world.balls.slice()
  for (var i = 0; i < list.length; i++) {
    var b = list[i]
    if (world.balls.indexOf(b) < 0) continue
    b.age += dt
    if (world.effect !== "snow") {
      setBallArea(b, b.area * Math.exp(-dt / (world.effect === "rain" ? 12 : 30)))
      if (b.r < 2) { removeBall(world, b); continue }
    }
    var speed = Math.hypot(b.vx, b.vy)
    var n = clamp(Math.ceil(speed * dt / (0.35 * b.r)), 1, 8)
    for (var k = 0; k < n; k++) if (!integrateBall(world, b, dt / n)) break
  }
  collideBalls(world)
  for (var j = 0; j < world.balls.length; j++) {
    var c = world.balls[j]
    floorBall(world, c)
    c.floorY = floorUnder(world, c)
    c.speed = Math.hypot(c.vx, c.vy)
  }
  if (world.plow) plowBalls(world)
}

// The plow takes small balls into its berm and shoves big ones ahead.
function plowBalls(world) {
  var P = world.plow
  if (P.lift > 0.6) return
  var gy = groundY(world)
  var blade = PLOW.bladeHeight * P.k
  var list = world.balls.slice()
  for (var i = 0; i < list.length; i++) {
    var b = list[i]
    if (b.held || b.y + b.r < gy - blade * 2) continue
    var front = P.dir > 0 ? b.x - b.r < P.x : b.x + b.r > P.x
    var behind = P.dir > 0 ? b.x > plowRear(P) : b.x < plowRear(P)
    if (!front || !behind) continue
    if (b.r < blade * 0.9) {
      P.load += ballLoose(b)
      removeBall(world, b)
      for (var p = 0; p < 3; p++) addPowder(world, P.x + P.dir * rand(0, 10), gy - blade * rand(0.3, 1), P.dir * (P.v + rand(20, 80)), -rand(40, 120), 0)
    } else {
      b.x = P.x + P.dir * b.r
      if (b.vx * P.dir < P.v) { b.vx = P.dir * P.v; b.omega = b.vx / b.r }
    }
  }
}

// Screen rectangles that should take the pointer so snow can be picked up:
// runs of snow at least `minDepth` deep on the tops in view, and every
// ball. At most `maxZones`, merging neighbours cheaply where it can and
// otherwise dropping the smallest strips of snow.
function touchZones(world, minDepth, maxZones) {
  var snow = [], balls = []
  var pad = 3
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.plow) continue
    var run = null
    for (var j = 0; j < s.bins.length; j++) {
      var h = s.bins[j]
      var x0 = s.x + j * CELL
      var ok = h >= minDepth && (s.ground || !covered(s, x0 + CELL / 2, s.y - h))
      if (!ok) continue
      if (run && x0 - run.x1 <= 12) {
        run.x1 = x0 + CELL
        run.y0 = Math.min(run.y0, s.y - h - pad)
      } else {
        run = { x0: x0, x1: x0 + CELL, y0: s.y - h - pad, y1: s.y + 2 }
        snow.push(run)
      }
    }
  }
  for (var k = 0; k < world.balls.length; k++) {
    var b = world.balls[k]
    var m = b.r + 6 + Math.min(40, b.speed * 0.05)
    balls.push({ x0: b.x - m, x1: b.x + m, y0: b.y - m, y1: b.y + m })
  }
  var room = Math.max(0, maxZones - balls.length)
  var area = function(z) { return (z.x1 - z.x0) * (z.y1 - z.y0) }
  while (snow.length > room && snow.length > 1) {
    var bestI = -1, bestJ = -1, bestCost = 1e18
    for (var a = 0; a < snow.length; a++) for (var c = a + 1; c < snow.length; c++) {
      var p = snow[a], q = snow[c]
      var u = { x0: Math.min(p.x0, q.x0), x1: Math.max(p.x1, q.x1), y0: Math.min(p.y0, q.y0), y1: Math.max(p.y1, q.y1) }
      var cost = area(u) - area(p) - area(q)
      if (cost < bestCost) { bestCost = cost; bestI = a; bestJ = c }
    }
    if (bestCost < 6000) {
      var P1 = snow[bestI], Q1 = snow[bestJ]
      snow[bestI] = { x0: Math.min(P1.x0, Q1.x0), x1: Math.max(P1.x1, Q1.x1), y0: Math.min(P1.y0, Q1.y0), y1: Math.max(P1.y1, Q1.y1) }
      snow.splice(bestJ, 1)
    } else {
      var small = 0
      for (var e = 1; e < snow.length; e++) if (snow[e].x1 - snow[e].x0 < snow[small].x1 - snow[small].x0) small = e
      snow.splice(small, 1)
    }
  }
  if (room === 0) snow = []
  var out = []
  var all = balls.concat(snow).slice(0, maxZones)
  for (var z = 0; z < all.length; z++) {
    var r = all[z]
    var x = Math.max(0, Math.floor(r.x0)), y = Math.max(0, Math.floor(r.y0))
    var x1 = Math.min(world.width, Math.ceil(r.x1)), y1 = Math.min(world.height, Math.ceil(r.y1))
    if (x1 > x && y1 > y) out.push({ x: x, y: y, w: x1 - x, h: y1 - y })
  }
  return out
}

function ballsMoving(world) {
  if (world.hand) return true
  for (var i = 0; i < world.balls.length; i++) if (world.balls[i].speed > 4) return true
  return false
}

// ------------------------------------------------------------------ the environment
//
// Seasons, live weather and the time of day reach the simulation as one
// object (built by lib/season.js): how much snow falls, the steady wind,
// how fast lying snow melts and settles, how glazed it gets at night, how
// fast icicles grow and drip, and how far into spring the scene is.

function neutralEnv() {
  return { snowScale: 1, windBase: 0, windVar: 28, tempC: -3, sun: 0, melt: 0, settle: 0, freeze: 0,
           icicle: 0.55, drip: 0, spring: 0, petals: 0, sprouts: 0, season: "off", calm: false, weather: false }
}

// The shell's switches for the newer behaviour: { gusts, icicles, throwOut },
// and the compositor's window border width in px ({ border }).
function setFeatures(world, f) {
  f = f || {}
  if (f.gusts !== undefined) world.gustsOn = !!f.gusts
  if (f.icicles !== undefined) world.iciclesOn = !!f.icicles
  if (f.throwOut !== undefined) world.throwOut = !!f.throwOut
  if (f.border !== undefined) { var b = Number(f.border); world.border = isFinite(b) ? Math.max(0, Math.min(20, Math.round(b))) : 0 }
}

function setEnv(world, env) {
  var e = neutralEnv()
  if (env) for (var k in e) if (env[k] !== undefined && env[k] !== null) e[k] = env[k]
  e.snowScale = clamp(+e.snowScale || 0, 0, 2.5)
  e.windBase = clamp(+e.windBase || 0, -90, 90)
  e.windVar = clamp(+e.windVar || 0, 0, 90)
  e.melt = clamp(+e.melt || 0, 0, 0.05)
  e.settle = clamp(+e.settle || 0, 0, 0.01)
  world.env = e
}

// ------------------------------------------------------------------ wind from windows
//
// A window moving fast through the air shoves it along: the air around it
// takes up part of the window's velocity, most strongly right at its edges
// and fading over about a hundred pixels, and keeps moving for a moment
// after the window stops. Falling flakes, powder and petals feel it like any
// other air, resting leaves and petals lift in it, and loose snow lying near
// a fast window is blown up as powder.

var GUST = {
  from: 140,                 // window speed, px/s, before it stirs the air noticeably
  reach: 95,                 // falloff distance, px
  carry: 0.55,               // share of the window's velocity the air right beside it takes up
  tau: 0.15,                 // s per stage of the air's two-stage lag: it eases in and out
  max: 1000,                 // fastest a window drags the air along, px/s
  lift: 440,                 // air speed, px/s, that lifts loose lying snow
  maxPuffs: 4                // powder puffs lifted per frame, at most
}

function updateGusts(world, dt) {
  var g = world.gusts
  var k = follow(dt, GUST.tau)
  var list = world.gustList
  list.length = 0
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.ground || s.plow) continue
    var sp = Math.hypot(s.vx, s.vy)
    var e = g[s.id]
    var on = world.gustsOn && sp > GUST.from
    if (!e) { if (!on) continue; e = g[s.id] = { vx: 0, vy: 0, mx: 0, my: 0, x: s.x, y: s.y, w: s.w, h: s.h } }
    // Ramps in above the threshold, so a slow drag stirs nothing, and is
    // capped. Two first-order lags in a row ease the air in and out: it
    // never jumps, starting or stopping.
    var share = on ? (sp - GUST.from) / sp : 0
    var tx = s.vx * share, ty = s.vy * share
    var ts = Math.hypot(tx, ty)
    if (ts > GUST.max) { tx *= GUST.max / ts; ty *= GUST.max / ts }
    e.mx += (tx - e.mx) * k
    e.my += (ty - e.my) * k
    e.vx += (e.mx - e.vx) * k
    e.vy += (e.my - e.vy) * k
    e.x = s.x; e.y = s.y; e.w = s.w; e.h = s.h
    if (Math.abs(e.vx) + Math.abs(e.vy) + Math.abs(e.mx) + Math.abs(e.my) < 4 && !on) { delete g[s.id]; continue }
    list.push(e)
  }
  for (var id in g) if (!world.surfaces[id]) delete g[id]
  if (list.length) liftLoose(world)
}

// Air speed added by moving windows at (x, y), into world.gx / world.gy.
// Returns false (and leaves them alone) when nothing reaches there.
function gustAt(world, x, y) {
  var list = world.gustList, gx = 0, gy = 0, hit = false
  var far = GUST.reach * 3
  for (var i = 0; i < list.length; i++) {
    var e = list[i]
    var dx = x < e.x ? e.x - x : (x > e.x + e.w ? x - e.x - e.w : 0)
    if (dx > far) continue
    var dy = y < e.y ? e.y - y : (y > e.y + e.h ? y - e.y - e.h : 0)
    if (dy > far) continue
    var d = dx + dy > 0 ? Math.sqrt(dx * dx + dy * dy) : 0
    var f = Math.exp(-d / GUST.reach) * GUST.carry
    gx += e.vx * f
    gy += e.vy * f * 0.8
    hit = true
  }
  if (!hit) return false
  world.gx = gx; world.gy = gy
  return true
}

function liftLoose(world) {
  if (world.particles.length > maxParticles(world)) return
  var budget = GUST.maxPuffs
  for (var i = 0; i < world.order.length && budget > 0; i++) {
    var s = world.order[i]
    if (s.plow || s.pack > 0.8) continue
    var n = s.bins.length
    for (var j = 0; j < world.gustList.length && budget > 0; j++) {
      var e = world.gustList[j]
      if (e.x === s.x && e.y === s.y && e.w === s.w) continue
      var x0 = Math.max(0, Math.floor((e.x - GUST.reach * 1.5 - s.x) / CELL))
      var x1 = Math.min(n - 1, Math.ceil((e.x + e.w + GUST.reach * 1.5 - s.x) / CELL))
      if (x1 < x0) continue
      for (var c = x0; c <= x1 && budget > 0; c += 2) {
        if (s.bins[c] < 0.8) continue
        var x = s.x + (c + 0.5) * CELL, y = s.y - s.bins[c]
        if (!gustAt(world, x, y)) continue
        var v = Math.hypot(world.gx, world.gy)
        if (v < GUST.lift || Math.random() > (v - GUST.lift) / 1400 * (1 - s.pack)) continue
        if (!s.ground && covered(s, x, y)) continue
        var take = Math.min(s.bins[c] * 0.12, 0.4)
        s.bins[c] -= take
        addPowder(world, x, y - 1, s.vx + world.gx * 0.7, s.vy + Math.min(-20, world.gy * 0.5) - rand(15, 50), take)
        budget--
      }
    }
  }
}

// ------------------------------------------------------------------ the snow globe
//
// shake() picks the whole scene up and shakes it: most of the snow lying on
// the windows and the ground comes up as flakes, the air surges upward and
// then turns over in a few slow eddies that die away, and the snow drifts
// back down and settles again wherever it lands. Snowballs hop, resting
// leaves come loose, long icicles snap.

var SHAKE = {
  windowShare: 0.85,         // share of the snow on a window that comes up
  groundShare: 0.6,          // and on the ground (the bottom of the drift stays)
  flakes: 900,               // flakes the lifted snow is carried by, at most
  lift: 560,                 // upward surge of the air, px/s, at the start
  liftTau: 0.65,             // s for the surge to die down
  spin: 230,                 // eddy speed, px/s
  spinTau: 2.8,              // s for the eddies to die down
  duration: 10
}

function shake(world, strength) {
  var k = clamp(strength === undefined ? 1 : +strength || 1, 0.3, 2)
  var lifted = []
  var total = 0
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.plow) continue
    var share = (s.ground ? SHAKE.groundShare : SHAKE.windowShare) * Math.min(1, 0.55 + 0.45 * k)
    var m = 0
    for (var j = 0; j < s.bins.length; j++) {
      if (s.bins[j] < 0.1) continue
      if (!s.ground && covered(s, s.x + (j + 0.5) * CELL, s.y - s.bins[j])) continue
      m += s.bins[j] * share
    }
    if (s.edges) for (var e = 0; e < 2; e++) flushEdge(world, s, e)
    if (m > 0.5) { lifted.push({ s: s, share: share, m: m }); total += m }
  }
  var room = Math.max(60, Math.round(Math.min(SHAKE.flakes, maxParticles(world) * 1.15 - world.particles.length * 0.5)))
  var per = Math.max(0.35, total / room)
  for (var a = 0; a < lifted.length; a++) {
    var L = lifted[a], sf = L.s
    var pool = 0
    for (var c = 0; c < sf.bins.length; c++) {
      var h = sf.bins[c]
      if (h < 0.1) continue
      var x = sf.x + (c + 0.5) * CELL
      if (!sf.ground && covered(sf, x, sf.y - h)) continue
      var take = h * L.share
      sf.bins[c] -= take
      sf.slip[c] = 0
      if (sf.rho) sf.rho[c] = 1
      pool += take
      while (pool >= per) {
        pool -= per
        world.particles.push(liftedFlake(world, x + rand(-CELL, CELL), sf.y - h * rand(0.2, 1) - 1, sf, per, k))
      }
    }
    if (pool > 0.05) world.particles.push(liftedFlake(world, sf.x + sf.w * Math.random(), sf.y - 2, sf, pool, k))
    sf.pack *= 0.4
    sf.glaze = 0
    if (sf.marks) sf.marks = []
    if (sf.icicles) for (var q = 0; q < sf.icicles.length; q++) if (sf.icicles[q].len > 6 && Math.random() < 0.5 * k) breakIcicle(world, sf, sf.icicles[q])
  }
  // Things lying about come loose.
  for (var p = 0; p < world.particles.length; p++) {
    var r = world.particles[p]
    if (r.rest !== null && r.rest !== undefined && world.surfaces[r.rest]) {
      var rs = world.surfaces[r.rest]
      release(r, rs, rs.vx + rand(-80, 80), rs.vy - rand(150, 400) * k)
    }
  }
  for (var b = 0; b < world.balls.length; b++) {
    var ball = world.balls[b]
    if (ball.held) continue
    ball.vy -= rand(200, 380) * k * Math.min(1, 12 / ball.r)
    ball.vx += rand(-120, 120) * k
    ball.contact = null
  }
  var W = world.width, H = world.height
  world.shake = {
    t: 0, k: k, seed: rand(0, 100),
    eddies: [
      { x: W * rand(0.2, 0.35), y: H * rand(0.35, 0.6), s: 1, rc: H * 0.22 },
      { x: W * rand(0.62, 0.8), y: H * rand(0.3, 0.55), s: -0.9, rc: H * 0.2 },
      { x: W * rand(0.42, 0.58), y: H * rand(0.6, 0.8), s: 0.6, rc: H * 0.16 }
    ]
  }
  return Math.round(total)
}

function liftedFlake(world, x, y, s, amount, k) {
  var depth = Math.random()
  var r = 0.9 + depth * 2.4
  var vt = 34 + depth * 62
  return { kind: "flake", x: x, y: y, vx: s.vx + rand(-60, 60) * k, vy: s.vy - rand(120, 420) * k,
           r: r, depth: depth, vt: vt, phase: rand(0, 6.28), freq: rand(0.6, 1.4),
           sway: rand(6, 20) * (1.2 - depth * 0.5), amount: amount,
           // How high the surge carries it: light, near flakes go highest.
           buoy: rand(0.45, 1.5), life: 120, age: 0, rest: null }
}

// The air of a shaken globe at (x, y), into world.sx / world.sy: a surge
// upward that dies quickly, and three eddies (Lamb-Oseen vortices, a
// smooth core and a 1/r fall-off) that turn the snow over and die slowly.
function swirlAt(world, x, y, buoy) {
  var S = world.shake
  var lift = -SHAKE.lift * S.k * Math.exp(-S.t / SHAKE.liftTau) * buoy * (0.75 + 0.25 * Math.sin(x * 0.006 + S.seed))
  var spin = SHAKE.spin * S.k * Math.exp(-S.t / SHAKE.spinTau) * Math.min(1, S.t / 0.4)
  var vx = 0, vy = lift
  for (var i = 0; i < S.eddies.length; i++) {
    var e = S.eddies[i]
    var dx = x - e.x, dy = y - e.y
    var r2 = dx * dx + dy * dy + 1
    var rc2 = e.rc * e.rc
    var v = spin * e.s * e.rc * (1 - Math.exp(-r2 / rc2)) / r2 * 1.6
    vx += -dy * v
    vy += dx * v
  }
  world.sx = vx
  world.sy = vy
}

function stepShake(world, dt) {
  var S = world.shake
  if (!S) return
  S.t += dt
  // The eddies wander as they die.
  for (var i = 0; i < S.eddies.length; i++) {
    S.eddies[i].x += Math.sin(S.t * 0.7 + i * 2.1) * 14 * dt
    S.eddies[i].y += Math.cos(S.t * 0.5 + i) * 10 * dt
  }
  if (S.t > SHAKE.duration) world.shake = null
}

// ------------------------------------------------------------------ icicles
//
// Icicles hang from the bottom edge of windows that hold snow. They grow
// where meltwater refreezes: fastest on sunny days below freezing, barely
// at night, never in the warmth (they shrink then). In the thaw they drip,
// a single drop now and then. A sharp jolt of the window snaps them, the
// longest first, and they fall and shatter.

var ICICLE = {
  spacing: [9, 22],          // px between icicles: a close row along the whole edge
  length: [10, 40],          // longest each can grow, px
  width: [2.8, 6],           // at the root, px
  tau: 70,                   // s to grow most of the way at full rate
  topShare: 0.55,            // hanging from the top edge, over the window, they stay this much shorter
  room: 24,                  // px clear below a window's bottom edge for them to hang there
  frostRise: 45,             // s for the frost to come most of the way in
  frostFade: 160,            // s for it to go
  minSnow: 6,                // snow on the window (bin-px) before any form
  snap: 2600,                // window acceleration, px/s², that snaps a full-length icicle
  maxPerWindow: 80
}

// Deterministic per window, so the same window grows the same icicles.
function hashStr(str) {
  var h = 2166136261
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function prng(seed) {
  var x = seed || 1
  return function() { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000 }
}

function seedIcicles(s, keep) {
  var r = prng(hashStr(String(s.id)) || 7)
  var list = []
  var W = s.w
  // A gentle sag along the edge, longest a little off the middle, and each
  // icicle its own length about it: a row that runs the whole width, not a
  // few long ones with gaps between.
  var peak = 0.35 + r() * 0.3
  var x = 4 + r() * 5
  while (x < W - 4 && list.length < ICICLE.maxPerWindow) {
    var f = x / Math.max(1, W)
    var sag = 1 - Math.pow(Math.abs(f - peak) / Math.max(peak, 1 - peak), 2) * 0.45
    var big = { ox: x, len: 0, max: lerp(ICICLE.length[0], ICICLE.length[1], clamp(sag * (0.45 + r() * 0.55), 0.12, 1)),
                w: lerp(ICICLE.width[0], ICICLE.width[1], r()), drip: 2 + r() * 10, kink: r() * 2 - 1, water: 0 }
    list.push(big)
    // Now and then a small one grows beside it, as they do along a real eave.
    if (r() < 0.3 && list.length < ICICLE.maxPerWindow) {
      var side = r() < 0.5 ? -1 : 1, ox = x + side * (big.w * 1.1 + 2 + r() * 2)
      if (ox > 3 && ox < W - 3) list.push({ ox: ox, len: 0, max: ICICLE.length[0] * (0.45 + r() * 0.4), w: ICICLE.width[0] * (0.8 + r() * 0.3),
                                              drip: 2 + r() * 10, kink: r() * 2 - 1, water: 0, small: true })
    }
    // Spread evenly over a wide window, at most maxPerWindow of them.
    var step = Math.max(lerp(ICICLE.spacing[0], ICICLE.spacing[1], r()), (W - 8) / (ICICLE.maxPerWindow * 0.7))
    x += step
  }
  list.sort(function(a, b) { return a.ox - b.ox })
  // Resized: the row is laid out again over the new width, each icicle as
  // far grown as the old row was there.
  if (keep && keep.length) {
    for (var i = 0; i < list.length; i++) {
      var fx = list[i].ox / Math.max(1, W), best = null, bd = 1e9
      for (var j = 0; j < keep.length; j++) {
        var d = Math.abs(keep[j].ox / Math.max(1, s.iceW || W) - fx)
        if (d < bd) { bd = d; best = keep[j] }
      }
      if (best && best.max > 0) list[i].len = Math.min(list[i].max, list[i].max * best.len / best.max)
    }
  }
  s.iceW = W
  return list
}

// One icicle's growth over dt at `rate` (0..1): it closes on its full
// length exponentially, so it grows fast at first and slows as it lengthens.
// How quickly this icicle grows, 0.3 .. 1.3, fixed for it.
function icePace(ic) {
  if (ic.pace === undefined) { var v = Math.sin((ic.ox + 1) * 12.9898 + ic.kink * 78.233) * 43758.5453; ic.pace = 0.3 + (v - Math.floor(v)) }
  return ic.pace
}
function growIcicle(ic, dt, rate) {
  if (rate <= 0) return ic.len
  ic.len += (ic.max - ic.len) * (1 - Math.exp(-dt * rate / ICICLE.tau))
  return ic.len
}

function hasIce(s) {
  if (!s.icicles) return false
  for (var i = 0; i < s.icicles.length; i++) if (s.icicles[i].len > 0.5) return true
  return false
}

// Where a window's icicles hang. From its bottom edge when there is room
// below it on the screen (a floating window, a window above a gap); on a
// tiled desktop the bottom edges sit on the next window, the screen's edge
// or the ground snow, where nothing would show, so they hang from the top
// edge instead, under the snow, like eaves.
function iceAnchor(world, s) {
  var y0 = s.y + s.h + windowBorder(world)
  if (y0 + ICICLE.room > groundY(world) - 4) return "top"
  var free = 0
  for (var i = 0; i < 5; i++) {
    var x = s.x + s.w * (0.1 + 0.2 * i)
    if (!occupied(world, s, x, y0 + 4) && !occupied(world, s, x, y0 + ICICLE.room)) free++
  }
  return free >= 3 ? "bottom" : "top"
}

// The y the icicles hang from, and how long they may be there.
// Hyprland's window geometry leaves out the border it draws around the
// window, so from the bottom edge they hang from the border's outer edge,
// not the content's, or the border would show between the window and its
// ice. Under the snow at the top they sit just inside the content.
function windowBorder(world) { return world && world.border > 0 ? world.border : 0 }
function iceRoot(world, s) { return s.iceAt === "top" ? s.y : s.y + s.h + windowBorder(world) }
function iceScale(s, ic) { return s.iceAt === "top" ? ICICLE.topShare * (ic ? eaveShare(s, ic) : 1) : 1 }

// Under the snow along a window's top (iceAt "top") the row is thinned
// out into what real eaves grow: a few clusters where the meltwater runs,
// bare stretches between them, and in each cluster icicles of very
// different lengths, a long one now and then among stubs. A whole row
// there (every 9-22 px, the bottom edge's spacing) read as a dense, even
// comb over the top of a tall window. Fixed per window and per place along
// it (hash of the window and the icicle's offset), so it never shimmers.
// 0 for an icicle that does not grow there, else its share of the length.
var EAVE = {
  cluster: 0.5,              // noise level above which the meltwater runs
  keep: 0.7,                 // share of the row kept inside a cluster
  waves: [0.0131, 0.0297, 0.071]  // cluster noise along the edge, per px
}
function eaveShare(s, ic) {
  if (ic.eave !== undefined && ic.eaveW === s.iceW) return ic.eave
  var seed = (hashStr(String(s.id)) % 1000) / 1000 * 6.283
  var x = ic.ox
  var n = 0.5 + 0.5 * (0.5 * Math.sin(x * EAVE.waves[0] + seed) + 0.32 * Math.sin(x * EAVE.waves[1] + seed * 2.7)
                     + 0.18 * Math.sin(x * EAVE.waves[2] + seed * 5.1))
  var h1 = hash01(x * 1.618 + seed * 31.7), h2 = hash01(x * 0.737 + seed * 17.3 + 5)
  var v = 0
  if (!ic.small && n > EAVE.cluster && h1 < EAVE.keep) {
    // Longest in the middle of a cluster; a few run long, most stay short.
    var mid = clamp((n - EAVE.cluster) / (1 - EAVE.cluster), 0, 1)
    v = clamp(0.22 + 0.5 * mid * h2 + (h2 > 0.82 ? 0.55 : 0), 0.15, 1.15)
  } else if (h1 > 0.985) v = 0.25  // a lone stub between clusters, rarely
  ic.eave = v
  ic.eaveW = s.iceW
  return v
}
function hash01(v) { var t = Math.sin(v * 12.9898 + 78.233) * 43758.5453; return t - Math.floor(t) }

// `flurry freeze`: every window in view freezes now, whatever the weather
// or the hour: icicles at most of their length where they would hang, and
// full frost. They then follow the weather as usual (a warm scene melts
// them away slowly). Returns how many icicles hang.
function freezeNow(world) {
  var n = 0
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.ground || s.plow) continue
    s.iceAt = iceAnchor(world, s)
    s.iceCheck = 1
    s.iceVote = 0
    if (!s.icicles || !s.icicles.length || Math.abs((s.iceW || s.w) - s.w) > 6) s.icicles = seedIcicles(s)
    for (var k = 0; k < s.icicles.length; k++) {
      var ic = s.icicles[k]
      ic.len = Math.max(ic.len, ic.max * iceScale(s, ic) * (0.7 + 0.3 * ((k * 7) % 5) / 4))
      n++
    }
    s.frost = 1
    s.glaze = Math.max(s.glaze || 0, 0.6)
  }
  return n
}

// Frost on the window's top edge and corners: comes in on cold nights and
// in hard cold, goes in the warmth. 0..1.
function frostTarget(world) {
  var env = world.env
  if (world.effect !== "snow" || world.iciclesOn === false) return 0
  var cold = clamp((1 - env.tempC) / 5, 0, 1)
  return cold * (0.55 + 0.45 * (1 - (env.sun || 0))) * (1 - (env.spring || 0))
}

function stepIcicles(world, s, dt) {
  var env = world.env
  var ft = frostTarget(world)
  s.frost = (s.frost || 0) + (ft - (s.frost || 0)) * follow(dt, ft > (s.frost || 0) ? ICICLE.frostRise : ICICLE.frostFade)
  if (s.frost < 0.003 && ft === 0) s.frost = 0
  s.iceCheck = (s.iceCheck || 0) - dt
  if (s.iceCheck <= 0 || !s.iceAt) {
    // Where they hang changes only once it has said so for a few checks
    // running, so a window passing near another never sets them flipping
    // between its top and bottom edge.
    s.iceCheck = 1
    var where = iceAnchor(world, s)
    if (!s.iceAt) s.iceAt = where
    else if (where !== s.iceAt) { s.iceVote = (s.iceVote || 0) + 1; if (s.iceVote >= 3) { s.iceAt = where; s.iceVote = 0 } }
    else s.iceVote = 0
  }
  // The window was resized: the row is laid out again to run its new width.
  if (s.icicles && s.icicles.length && Math.abs((s.iceW || s.w) - s.w) > 6) s.icicles = seedIcicles(s, s.icicles)
  if (!s.icicles) {
    if (world.effect !== "snow" || world.iciclesOn === false) return
    if (sumOf(s.bins) < ICICLE.minSnow) return
    s.icicles = seedIcicles(s)
  }
  var list = s.icicles
  if (!list.length) return
  var on = world.effect === "snow" && world.iciclesOn !== false
  var mass = sumOf(s.bins)
  var accel = Math.hypot(s.ax, s.ay)
  var warm = env.tempC > 1.5 || world.effect !== "snow"
  var any = false
  for (var i = 0; i < list.length; i++) {
    var ic = list[i]
    // Water comes from the snow above it; a bare window grows nothing.
    // Each grows at its own pace (water finds some drips sooner than
    // others), a little faster where the snow lies deep, so the row comes
    // in one icicle at a time rather than as an even fringe.
    var above = Math.min(1, 0.55 + heightAt(s, s.x + ic.ox) / 10 + mass / 3000) * icePace(ic)
    if (warm || !on) ic.len = Math.max(0, ic.len - dt * (world.effect !== "snow" ? 0.05 : (env.tempC - 1.5) * 0.0012))
    else if (mass >= ICICLE.minSnow) {
      var full = ic.max
      var share = iceScale(s, ic)
      ic.max = full * share
      growIcicle(ic, dt, env.icicle * above)
      ic.max = full
      // Moved under the snow (the window was tiled): too long for there.
      if (s.iceAt === "top" && ic.len > full * share) ic.len = Math.max(full * share, ic.len - dt * 4)
    }
    if (ic.len > 0.5) any = true
    if (ic.len < 2) continue
    // A jolt snaps it, long ones first.
    if (accel > ICICLE.snap * (1.5 - 0.6 * ic.len / ICICLE.length[1]) * (0.85 + 0.3 * ((ic.kink + 1) / 2))) {
      breakIcicle(world, s, ic)
      continue
    }
    // Meltwater runs down it and gathers at the tip: one drop at a time.
    if (env.drip > 0 && on) {
      ic.drip -= dt * env.drip * (0.4 + above)
      if (ic.drip <= 0) {
        ic.drip = rand(3, 14)
        if (world.particles.length < maxParticles(world)) {
          world.particles.push({ kind: "drip", x: s.x + ic.ox + ic.kink * Math.min(1.2, ic.len * 0.06), y: iceRoot(world, s) + ic.len, vx: s.vx * 0.5, vy: Math.max(0, s.vy) + 10,
                                 r: 1, life: 4, age: 0, rest: null })
        }
      }
    }
  }
  if (!any && !on) s.icicles = null
}

function breakIcicle(world, s, ic) {
  if (ic.len < 1.5) { ic.len = 0; return }
  // It breaks a little below the root; the stub stays.
  var stub = Math.min(ic.len * 0.25, 2)
  var len = ic.len - stub
  pushSound(world, { type: "ice", x: clamp((s.x + ic.ox) / world.width, 0, 1), len: len })
  world.particles.push({ kind: "shard", x: s.x + ic.ox, y: iceRoot(world, s) + stub + len / 2, vx: s.vx * 0.9 + rand(-20, 20),
                         vy: s.vy * 0.9, len: len, w: ic.w, angle: 0, spin: rand(-6, 6) * (s.vx === 0 ? 0.4 : 1),
                         life: 5, age: 0, rest: null })
  ic.len = stub
  ic.drip = rand(3, 14)
}

// ------------------------------------------------------------------ writing in the snow
//
// Snow can be written in (Ctrl+drag in the shell): the stroke presses a
// groove into the snow's face and pushes a slight rim up beside it, and
// where it runs along the top it notches the top itself. Marks are kept as
// points in the snow's own frame. Fresh snow landing on them fills them
// in, a little with every flake; snow sliding smears them out; and where the
// snow under a mark is gone (melted, scooped, ploughed) the mark goes too.
// Pawprints and a bird's footprints are marks of the same kind.

var MARKS = {
  max: 1800,                 // points per surface
  step: 2.2,                 // px between the points of a stroke
  fill: 0.9,                 // bin-px of new snow that fills a mark to 1/e
  notch: 0.9                 // px a stroke along the top cuts into it
}
var MARK_GROOVE = 0, MARK_PAW = 1, MARK_FOOT = 2

function addMark(s, x, h, type, stroke) {
  if (!s.marks) s.marks = []
  if (!s.fill || s.fill.length !== s.bins.length) s.fill = zeros(s.bins.length)
  s.marks.push({ x: x, h: h, a: 1, t: type, k: stroke })
  if (s.marks.length > MARKS.max) s.marks.splice(0, s.marks.length - MARKS.max)
}

// The snow face at a point: the surface whose snow (top to base) holds y at x.
function snowFaceAt(world, x, y) {
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.plow || x < s.x || x > s.x + s.w) continue
    var h = heightAt(s, x)
    if (h < 2) continue
    var top = s.y - h
    if (y < top - 4 || y > s.y + 2) continue
    if (!s.ground && covered(s, x, top)) continue
    return s
  }
  return null
}

function writeStart(world, x, y) {
  var s = snowFaceAt(world, x, y)
  if (!s) { world.pen = null; return false }
  world.pen = { s: s.id, k: ++world.markSeq, lx: x, ly: y, notched: {} }
  writeTo(world, x, y)
  return true
}

function writeTo(world, x, y) {
  var P = world.pen
  if (!P) return
  var s = world.surfaces[P.s]
  if (!s) { world.pen = null; return }
  var dx = x - P.lx, dy = y - P.ly
  var n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / MARKS.step))
  var first = !s.marks || !s.marks.length || s.marks[s.marks.length - 1].k !== P.k
  for (var i = first ? 0 : 1; i <= n; i++) {
    var px = P.lx + dx * i / n, py = P.ly + dy * i / n
    if (px < s.x + 1 || px > s.x + s.w - 1) continue
    var depth = heightAt(s, px)
    if (depth < 1.6) continue
    var h = clamp(s.y - py, 0.8, depth - 0.5)
    addMark(s, px - s.x, h, MARK_GROOVE, P.k)
    // Along the top the finger cuts a notch, and the snow it moves heaps
    // up as a low rim on either side.
    if (h > depth - 2.4) {
      var c = clamp(Math.floor((px - s.x) / CELL), 0, s.bins.length - 1)
      if (!P.notched[c]) {
        P.notched[c] = true
        var cut = Math.min(MARKS.notch, s.bins[c] * 0.12)
        s.bins[c] -= cut
        if (c > 0) s.bins[c - 1] += cut * 0.4
        if (c + 1 < s.bins.length) s.bins[c + 1] += cut * 0.4
        var rho = rhoOf(s)
        rho[c] = Math.min(BALL.rhoMax, rho[c] + 0.15)
      }
    }
  }
  P.lx = x; P.ly = y
}

function writeEnd(world) { world.pen = null }

// Fills marks in with the snow that landed on them since the last pass,
// smears them where the snow slides, and drops those whose snow is gone.
function stepMarks(world, s, dt) {
  s.markDt = (s.markDt || 0) + dt
  if ((world.frame + (s.z | 0)) % 6 !== 0) return
  var t = s.markDt
  s.markDt = 0
  var fill = s.fill, n = s.bins.length
  var smear = s.sliding ? Math.exp(-t * 4) : 1
  var keep = []
  for (var i = 0; i < s.marks.length; i++) {
    var m = s.marks[i]
    var c = Math.floor(m.x / CELL)
    if (c < 0 || c >= n) continue
    var top = s.bins[c]
    if (m.h > top + 0.4) continue
    if (fill) m.a *= Math.exp(-fill[c] / MARKS.fill)
    m.a *= smear
    if (m.a > 0.06) keep.push(m)
  }
  s.marks = keep
  if (fill) for (var f = 0; f < fill.length; f++) fill[f] = 0
  if (!keep.length) s.fill = null
}

// ------------------------------------------------------------------ New Year fireworks
//
// Shells rise from below the windows, slow under gravity and burst near
// the top of their climb into a sphere of embers seen side-on: dense at
// the rim, sparse in the middle. Embers coast on drag, droop, flicker and
// go out. They are painted behind the windows, so they show in the gaps
// between them. A countdown before midnight is ten quiet sparks rising.

var FIREWORKS = {
  gap: [1.3, 3.2],           // s between shells, wider as the show winds down
  apex: [0.38, 0.72],        // burst height, share of the screen above the ground
  embers: [56, 84],
  burst: [260, 380],         // ember speed, px/s, scaled to the screen
  emberLife: [1.5, 2.6],
  gravity: 0.22              // share of G an ember feels (they are light, the air holds them)
}
var FIREWORK_HUES = 5

function startFireworks(world, seconds) {
  world.fw = { left: clamp(+seconds || 60, 5, 300), total: clamp(+seconds || 60, 5, 300), next: 0.2 }
  return true
}

function stopFireworks(world) {
  world.fw = null
  world.particles = world.particles.filter(function(p) { return p.kind !== "rocket" && p.kind !== "tick" })
}

// One tick of the countdown: a single faint spark rising (n seconds left).
function countdownTick(world, n) {
  n = clamp(n | 0, 1, 10)
  var gy = groundY(world)
  world.particles.push({ kind: "tick", x: world.width * (0.5 + (n - 5.5) * 0.035), y: gy - world.height * 0.18,
                         vx: 0, vy: -38, r: 1.1 + (10 - n) * 0.06, life: 1.4, age: 0, rest: null, hue: 4, bright: 0.45 + (10 - n) * 0.05 })
}

function stepFireworks(world, dt) {
  var F = world.fw
  if (!F) return
  F.left -= dt
  F.next -= dt
  if (F.left <= 0) { world.fw = null; return }
  if (F.next > 0) return
  var winding = 1 - F.left / F.total
  F.next = rand(FIREWORKS.gap[0], FIREWORKS.gap[1]) * (1 + winding * 0.9)
  launchShell(world)
  // Now and then two go up together, early in the show.
  if (winding < 0.5 && Math.random() < 0.22) launchShell(world)
}

function launchShell(world) {
  var gy = groundY(world)
  var k = world.height / 1080
  var apex = gy - world.height * rand(FIREWORKS.apex[0], FIREWORKS.apex[1])
  var g = G * 0.35
  var vy = -Math.sqrt(2 * g * (gy - apex))
  var rx = world.width * rand(0.1, 0.9)
  world.particles.push({ kind: "rocket", x: rx, y: gy, px: 0, py: 0, vx: rand(-25, 25) * k, vy: vy,
                         g: g, life: 6, age: 0, rest: null, hue: Math.floor(rand(0, FIREWORK_HUES)), k: k })
  pushSound(world, { type: "launch", x: clamp(rx / world.width, 0, 1) })
}

function burstShell(world, p) {
  pushSound(world, { type: "burst", x: clamp(p.x / world.width, 0, 1) })
  var n = Math.round(rand(FIREWORKS.embers[0], FIREWORKS.embers[1]) * Math.max(0.5, world.quality))
  var speed = rand(FIREWORKS.burst[0], FIREWORKS.burst[1]) * p.k
  // A second colour inside, sometimes.
  var inner = Math.random() < 0.35 ? (p.hue + 1 + Math.floor(rand(0, FIREWORK_HUES - 1))) % FIREWORK_HUES : p.hue
  for (var i = 0; i < n; i++) {
    // A point on a sphere, seen side-on.
    var z = rand(-1, 1), a = rand(0, Math.PI * 2), rr = Math.sqrt(1 - z * z)
    var sp = speed * rand(0.92, 1.05)
    var core = rr < 0.55
    world.particles.push({ kind: "ember", x: p.x, y: p.y, px: p.x, py: p.y, vx: Math.cos(a) * rr * sp + p.vx * 0.3, vy: Math.sin(a) * rr * sp + p.vy * 0.2,
                           life: rand(FIREWORKS.emberLife[0], FIREWORKS.emberLife[1]), age: 0, rest: null,
                           hue: core ? inner : p.hue, flick: rand(0, 6.28), r: rand(0.8, 1.35) })
  }
  world.particles.push({ kind: "ember", x: p.x, y: p.y, px: p.x, py: p.y, vx: 0, vy: 0, life: 0.35, age: 0, rest: null,
                         hue: 4, flash: true, r: 14 * p.k })
}

function stepFirework(world, p, dt) {
  p.px = p.x; p.py = p.y
  if (p.kind === "rocket") {
    p.vy += p.g * dt
    p.vx += (airAt(world, p.x, p.y) * 0.1 - p.vx) * follow(dt, 3)
    p.x += p.vx * dt
    p.y += p.vy * dt
    if (p.vy > -30) { burstShell(world, p); return false }
    return true
  }
  if (p.kind === "tick") {
    p.y += p.vy * dt
    p.vy *= Math.exp(-dt * 1.2)
    return true
  }
  // Embers: drag toward the wind, a gentle droop. Each keeps the last few
  // places it has been, which is the trail it paints.
  if (!p.flash) {
    p.trT = (p.trT || 0) + dt
    if (!p.tr) p.tr = [p.x, p.y]
    if (p.trT >= 0.035) {
      p.trT = 0
      p.tr.push(p.x, p.y)
      if (p.tr.length > 12) p.tr.splice(0, 2)
    }
  }
  var k = follow(dt, 0.55)
  p.vx += (airAt(world, p.x, p.y) * 0.4 - p.vx) * k
  p.vy += -p.vy * k + G * FIREWORKS.gravity * dt
  p.x += p.vx * dt
  p.y += p.vy * dt
  return true
}

// ------------------------------------------------------------------ spring
//
// Around Nowruz the snow eases off and melts (see the environment), green
// sprouts push up through the thinning snow along the ground, and blossom
// petals drift down now and then in place of flakes.

var SPRING = {
  petalRate: 1.6,            // petals per second per 1000 px at full spring
  sprouts: [9, 42],          // px between sprouts
  height: [6, 15],
  grow: 40                   // s to come up fully once the snow is thin enough
}
var BLOSSOM = 1              // petal.hue offset marking almond blossom (paler than sakura)

function makeBlossom(world) {
  return { kind: "petal", blossom: true, x: rand(-60, world.width + 60), y: -10, vx: rand(5, 25), vy: rand(20, 36), r: rand(3, 4.6),
           vt: rand(32, 50), angle: rand(0, 6.28), spin: 0, phase: rand(0, 6.28),
           freq: rand(1.8, 2.8), sway: rand(16, 32), tilt: rand(-0.5, 0.5),
           hue: Math.floor(rand(0, 3)), life: 600, age: 0, rest: null, restLeft: 0 }
}

function seedSprouts(world) {
  var r = prng(1234567 + world.width)
  var list = []
  var x = 6 + r() * 20
  while (x < world.width - 4) {
    list.push({ x: x, h: lerp(SPRING.height[0], SPRING.height[1], r()), lean: (r() - 0.5) * 0.5,
                leaves: r() < 0.4 ? 3 : 2, g: 0, phase: r() * 6.28 })
    // Some grow in little clumps.
    x += r() < 0.3 ? lerp(3, 7, r()) : lerp(SPRING.sprouts[0], SPRING.sprouts[1], r())
  }
  return list
}

function stepSprouts(world, dt) {
  var want = world.effect === "snow" || world.effect === "sakura" ? world.env.sprouts : 0
  if (!world.sprouts) {
    if (want <= 0) return
    world.sprouts = seedSprouts(world)
  }
  var g = world.surfaces[GROUND_ID]
  var any = false
  for (var i = 0; i < world.sprouts.length; i++) {
    var sp = world.sprouts[i]
    var depth = g ? heightAt(g, sp.x) : 0
    // Each comes up once the snow over it is thin, staggered a little.
    var target = want > 0 && depth < 3 + sp.h * 0.4 ? clamp(want * 1.2 - (i % 5) * 0.04, 0, 1) : (want > 0 ? sp.g : 0)
    var rate = target > sp.g ? 1 / SPRING.grow : 1 / 90
    sp.g += clamp(target - sp.g, -rate * dt, rate * dt)
    if (sp.g > 0.01) any = true
  }
  if (!any && want <= 0) world.sprouts = null
}

// ------------------------------------------------------------------ rare surprises
//
// Visitors. A robin lands on a window ledge (snowy or bare), on the snow
// plow's roof, or on the ground; it hops, pecks and looks about, and flies
// off when the pointer comes close, its perch moves, or a snowball flies by.
// A winter hare hops along the ground snow (crouch, push off, reach, land),
// leaving its tracks: the two long hind prints side by side ahead of the two
// small forefoot prints set one behind the other. It stops to sit up with
// its ears raised and its nose twitching, and bolts when the pointer comes
// close or a snowball lands near it. In spring it is brown and hops along
// the sprouts. Very rarely a golden snowflake falls; catch it (touch it
// with the pointer, or click it) and a new bauble finish is yours. The shell
// decides when and whether (lib/policy.js); these make them happen.

var BIRD = { flee: 120, stay: [18, 40], hop: [5, 12], flight: 2.4, minFeetY: 10, highFeetY: 34, ballNear: 90 }
var RABBIT = {
  hop: [24, 34],             // px per hop, unhurried (coming in, going off, a run now and then)
  hopTime: 0.4,              // s per hop
  hopArc: 0.2,               // a hop's height, as a share of its length: low, like a real hare's lope
  bolt: 64, boltTime: 0.24,  // px and s per hop when it runs
  hops: [2, 4],              // hops in a run
  walk: 7.5,                 // art px the forefeet reach ahead each step (x size on the screen)
  walkTime: [0.5, 0.78],     // s per step: reach with the forefeet, one then the other, then bring the hind feet up
  steps: [3, 9],             // steps between stops
  hopShare: 0.22,            // chance a run (once it is in) is hops rather than walking
  pause: [1.2, 3.4],         // s stopped between runs
  sitUp: 0.38,               // chance a stop is spent sat up, ears high, looking about
  maxLowStops: 3,            // stops in a row it may spend low (grazing, sat) before it sits up
  graze: 0.4,                // chance a stop is spent nose down, nibbling at the snow
  flee: 115,                 // px from the pointer that sends it off
  thud: 160,                 // px from a snowball landing that sends it off
  stay: [35, 60],            // s before it heads off of its own accord
  sink: 2.6,                 // px it sinks into deep snow
  edge: 70,                  // px from a screen edge it keeps to until it means to leave
  size: 1.35                 // drawn and stepped this much larger than its 1x art, so it reads on a big screen
}
var GOLDEN = { vt: 24, catch: 24, rest: 25 }
var MARK_HIND = 3            // a hare's long hind print (marks: see MARK_PAW)

// A feature that throws is switched off for this step and remembered once,
// so one broken visitor can never stop the snow or the others. world.faults:
// { name: { message, at, count } }; the shell prints each once and shows
// them in `flurry diag`.
function fault(world, name, e) {
  if (!world.faults) world.faults = {}
  var f = world.faults[name]
  if (f) { f.count++; return }
  world.faults[name] = { message: String(e && e.message ? e.message : e), at: world.time, count: 1 }
  world.faultSeq = (world.faultSeq || 0) + 1
}

// A point below window s that another window takes: one in front of it,
// or a tiled neighbour (icicles hanging over it would be lost to it). A
// floating window's icicles may hang over the tiled windows behind it.
function occupied(world, s, x, y) {
  for (var i = 0; i < world.order.length; i++) {
    var o = world.order[i]
    if (o === s || o.ground || o.plow) continue
    if (s.floating && !o.floating) continue
    if (s.floating && o.floating && !inFront(o, s)) continue
    if (x >= o.x && x <= o.x + o.w && y >= o.y - 2 && y <= o.y + Math.max(o.h, 1)) return true
  }
  return false
}

// A snowball in flight near (x, y), or one that just burst there.
function ballThreat(world, x, y, radius) {
  for (var i = 0; i < world.balls.length; i++) {
    var b = world.balls[i]
    if (b.held) continue
    if (Math.hypot(b.vx, b.vy) > 150 && Math.hypot(b.x - x, b.y - y) < radius + b.r) return true
  }
  var T = world.thud
  return !!T && world.time - T.t < 0.6 && Math.hypot(T.x - x, T.y - y) < radius
}

// Where a bird could land now: [{ s, ox, h, w }]. A window ledge in view
// (snowy ledges are likelier), the plow's roof while it stands still, or
// the ground. The bird's feet must be on the screen with room for it.
function birdPerches(world, tries) {
  tries = tries || 8
  var spots = []
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (s.w < 60 || Math.hypot(s.vx, s.vy) > 5) continue
    var ground = !!s.ground
    for (var t = 0; t < tries; t++) {
      var ox = rand(24, s.w - 24), x = s.x + ox
      if (x < 20 || x > world.width - 20) continue
      var h = heightAt(s, x)
      var feet = s.y - h
      if (feet < BIRD.minFeetY || feet > world.height) continue
      if (!ground && (covered(s, x, feet - 2) || covered(s, x, feet - 12))) continue
      if (world.rabbit && ground && Math.abs(world.rabbit.x - x) < 120) continue
      // A ledge right under the top bar is taken less often than one lower down.
      var wt = ground ? 0.6 : (s.plow ? 1.2 : (h > 1.5 ? 3 : 1.5))
      if (!ground && feet < BIRD.highFeetY) wt *= 0.5
      spots.push({ s: s, ox: ox, h: h, w: wt })
    }
  }
  return spots
}

// opts.surface: land on that surface (an id) only.
function spawnBird(world, opts) {
  opts = opts || {}
  if (world.bird) return false
  var spots = birdPerches(world, 8)
  if (opts.surface) spots = spots.filter(function(p) { return p.s.id === opts.surface })
  if (!spots.length) return false
  var total = 0
  for (var k = 0; k < spots.length; k++) total += spots[k].w
  var roll = Math.random() * total, spot = spots[0]
  for (var q = 0; q < spots.length; q++) { roll -= spots[q].w; if (roll <= 0) { spot = spots[q]; break } }
  var from = Math.random() < 0.5 ? -1 : 1
  var ty = spot.s.y - spot.h
  var sy = Math.max(10, ty - rand(120, 260))
  world.bird = { mode: "in", s: spot.s.id, ox: spot.ox, x: from < 0 ? -20 : world.width + 20, y: sy,
                 sx: from < 0 ? -20 : world.width + 20, sy: sy, t: 0, facing: -from,
                 flap: 0, act: "", actT: 0, timer: rand(0.6, 1.6), stay: rand(BIRD.stay[0], BIRD.stay[1]),
                 hopY: 0, hopsLeft: 0, peck: 0, vx: 0, vy: 0, look: 0, lookT: rand(1, 3) }
  return true
}

function stepBird(world, dt, pointer) {
  var B = world.bird
  if (!B) return
  B.flap += dt
  var s = world.surfaces[B.s]
  if (B.mode === "in") {
    if (!s || world.critterLeave) { flyOff(B); return }
    B.t += dt
    var u = clamp(B.t / BIRD.flight, 0, 1)
    var tx = s.x + B.ox, ty = s.y - heightAt(s, s.x + B.ox) + 0.8
    // A swoop: down past the ledge's height, then a short rise to land.
    var e = 1 - Math.pow(1 - u, 2.2)
    B.x = lerp(B.sx, tx, e)
    B.y = lerp(B.sy, ty, e) + Math.sin(e * Math.PI) * 28
    if (u >= 1) {
      B.mode = "perch"; B.x = tx; B.y = ty
      addPowder(world, tx - B.facing * 3, ty - 1, -B.facing * rand(20, 50), -rand(20, 40), 0)
      footprints(s, B.ox, B.facing)
    }
    return
  }
  if (B.mode === "perch") {
    var gone = !s || (!s.ground && covered(s, s.x + B.ox, s.y - heightAt(s, s.x + B.ox) - 2))
    var moving = s && (Math.hypot(s.vx, s.vy) > 20 || Math.hypot(s.ax, s.ay) > 300)
    var near = pointer && Math.hypot(pointer.x - B.x, pointer.y - (B.y - 5)) < BIRD.flee
    var ball = ballThreat(world, B.x, B.y - 5, BIRD.ballNear)
    B.stay -= dt
    if (gone || moving || near || ball || B.stay <= 0 || world.shake || world.critterLeave) {
      if (s) B.vx = s.vx
      flyOff(B, near && pointer ? (B.x < pointer.x ? -1 : 1) : 0)
      if (s && !gone) addPowder(world, B.x, B.y - 1, -B.facing * rand(20, 60), -rand(30, 60), 0)
      return
    }
    birdActs(world, B, s, dt)
    // Now and then it cocks its head to look about.
    B.lookT -= dt
    if (B.lookT <= 0) { B.lookT = rand(0.8, 2.6); B.lookTo = Math.random() < 0.5 ? 0 : rand(-1, 1) }
    B.look += ((B.lookTo || 0) - B.look) * follow(dt, 0.08)
    B.x = s.x + B.ox
    B.y = s.y - heightAt(s, B.x) + 0.8 - B.hopY
    return
  }
  // Flying off: up and away, beating hard.
  B.vy += (-210 - B.vy) * follow(dt, 0.5)
  B.vx += (B.facing * 230 - B.vx) * follow(dt, 0.6)
  B.x += B.vx * dt
  B.y += B.vy * dt
  if (B.x < -40 || B.x > world.width + 40 || B.y < -40) world.bird = null
}

function flyOff(B, dir) {
  B.mode = "out"
  if (dir) B.facing = dir
  B.vy = -120
  B.hopY = 0
  B.peck = 0
}

function birdActs(world, B, s, dt) {
  if (B.act === "hop") {
    B.actT += dt
    var u = B.actT / 0.2
    B.hopY = Math.sin(clamp(u, 0, 1) * Math.PI) * 4.5
    B.ox = clamp(B.ox + B.facing * B.hopDx * dt / 0.2, 8, s.w - 8)
    if (u >= 1) {
      B.hopY = 0
      footprints(s, B.ox, B.facing)
      B.hopsLeft--
      if (B.hopsLeft > 0) { B.actT = 0; B.hopDx = rand(BIRD.hop[0], BIRD.hop[1]) } else { B.act = ""; B.timer = rand(0.5, 1.8) }
    }
    return
  }
  if (B.act === "peck") {
    B.actT += dt
    B.peck = Math.sin(clamp(B.actT / 0.32, 0, 1) * Math.PI)
    if (B.actT > 0.16 && !B.pecked) {
      B.pecked = true
      var px = B.ox + B.facing * 5
      var h = heightAt(s, s.x + px)
      if (h > 1) addMark(s, px, h - 0.7, MARK_FOOT, 0)
      if (Math.random() < 0.6) addPowder(world, s.x + px, s.y - h - 0.5, B.facing * rand(5, 25), -rand(15, 35), 0)
    }
    if (B.actT >= 0.32) { B.peck = 0; B.act = ""; B.timer = rand(0.3, 1.4) }
    return
  }
  B.timer -= dt
  if (B.timer > 0) return
  var r = Math.random()
  if (r < 0.38) {
    // Turn back from the edge rather than hop off it.
    if (B.ox < 24) B.facing = 1
    else if (B.ox > s.w - 24) B.facing = -1
    B.act = "hop"; B.actT = 0; B.hopsLeft = 1 + Math.floor(rand(0, 3)); B.hopDx = rand(BIRD.hop[0], BIRD.hop[1])
  } else if (r < 0.76) {
    B.act = "peck"; B.actT = 0; B.pecked = false
  } else {
    B.facing = -B.facing
    B.timer = rand(0.6, 2)
  }
}

function footprints(s, ox, facing) {
  var h = heightAt(s, s.x + ox)
  if (h < 1) return
  addMark(s, ox - 1.2, h - 0.6, MARK_FOOT, 0)
  addMark(s, ox + 1.2, h - 0.6, MARK_FOOT, 0)
}

// ------------------------------------------------------------------ the hare
//
// R: { x, y (its feet), dir, mode "hop" | "rest" | "bolt", t (time into
// the current hop or rest), hopLen, hopsLeft, x0 (where the hop started),
// lift (px off the snow), pose (-1 crouched .. 0 sitting .. 1 stretched
// out in the air), up (0..1 sat up tall), ears (0 flat .. 1 raised),
// nose (twitch phase), coat "white" | "brown", age, stay }.

function spawnRabbit(world, opts) {
  opts = opts || {}
  if (world.rabbit || (world.plow && !opts.force)) return false
  var dir = opts.dir === 1 || opts.dir === -1 ? opts.dir : (Math.random() < 0.5 ? 1 : -1)
  world.rabbit = { x: dir > 0 ? -24 : world.width + 24, y: groundY(world), dir: dir, mode: "hop", t: 0,
                   hopLen: rand(RABBIT.hop[0], RABBIT.hop[1]), hopsLeft: Math.round(rand(3, 6)), x0: dir > 0 ? -24 : world.width + 24,
                   lift: 0, pose: 0, up: 0, ears: 0.6, nose: 0, twitch: 0, look: 0, sink: 0, age: 0,
                   reach: 0, fn: 0, ff: 0, fnLift: 0, ffLift: 0, hb: 0, graze: 0, chew: 0, flick: 0, act: "sit",
                   stay: rand(RABBIT.stay[0], RABBIT.stay[1]), leaving: false, coat: opts.coat === "brown" ? "brown" : "white",
                   size: RABBIT.size, entered: false, s: GROUND_ID }
  rabbitFeet(world, world.rabbit)
  return true
}

function rabbitFeet(world, R) {
  var g = world.surfaces[GROUND_ID]
  var depth = g ? heightAt(g, clamp(R.x, 0, world.width)) : 0
  R.sink = Math.min(depth * 0.25, RABBIT.sink)
  R.y = groundY(world) - depth + R.sink - R.lift
  return depth
}

// Something sent it off: it bolts for the nearer edge, or away from the
// threat at `fromX`.
function rabbitBolts(world, fromX) {
  var R = world.rabbit
  if (!R || R.mode === "bolt") return
  var dir = fromX === undefined || fromX === null ? (R.x < world.width / 2 ? -1 : 1) : (R.x < fromX ? -1 : 1)
  R.dir = dir
  R.mode = "bolt"
  R.leaving = true
  if (R.lift <= 0.01) { R.t = 0; R.x0 = R.x; R.hopLen = RABBIT.bolt }
}

// Its prints where it lands: the forefeet one behind the other, then the
// hind feet swing past them and land side by side, ahead.
// Walking, the forefeet print ahead of the hind feet instead.
var HOP_SPOTS = [[-7.5, MARK_PAW, 1.2], [-3.6, MARK_PAW, 1.2], [4.6, MARK_HIND, 1.0], [5.4, MARK_HIND, 2.2]]
var WALK_SPOTS = [[-5.5, MARK_HIND, 1.0], [-4.7, MARK_HIND, 2.2], [5.6, MARK_PAW, 1.2], [3.9, MARK_PAW, 1.2]]
function rabbitPrints(world, R, walking) {
  var g = world.surfaces[GROUND_ID]
  if (!g) return
  var spots = walking ? WALK_SPOTS : HOP_SPOTS
  for (var i = 0; i < spots.length; i++) {
    var px = R.x + R.dir * spots[i][0] * (R.size || 1)
    if (px < 1 || px > world.width - 1) continue
    var h = heightAt(g, px)
    if (h < 1.2) continue
    var c = clamp(Math.floor(px / CELL), 0, g.bins.length - 1)
    g.bins[c] -= Math.min(0.35, g.bins[c] * 0.04)
    addMark(g, px, Math.max(0.6, h - spots[i][2]), spots[i][1], R.dir)
  }
}

function stepRabbit(world, dt, pointer) {
  var R = world.rabbit
  if (!R) return
  R.age += dt
  R.nose += dt * (R.mode === "rest" ? (R.act === "graze" ? 11 : 9) : (R.mode === "walk" ? 7 : 4))
  var feetY = groundY(world) - 10
  var near = pointer && Math.abs(pointer.x - R.x) < RABBIT.flee && Math.abs(pointer.y - feetY) < RABBIT.flee * 0.8
  if (R.mode !== "bolt" && (near || world.plow || world.shake || world.critterLeave || ballThreat(world, R.x, feetY, RABBIT.thud)))
    rabbitBolts(world, near ? pointer.x : (world.thud ? world.thud.x : undefined))
  if (!R.leaving && R.age > R.stay) R.leaving = true
  // An ear flicks back now and then, whatever it is doing.
  R.flick = Math.max(0, (R.flick || 0) - dt * 4)
  if (R.mode !== "bolt" && Math.random() < dt * 0.35) R.flick = 1
  var settle = function(key, to, tau) { R[key] = (R[key] || 0) + (to - (R[key] || 0)) * follow(dt, tau) }

  if (R.mode === "rest") {
    R.t += dt
    // Sat up tall, ears high, looking about; nose down, nibbling at the
    // snow; or sat low with ears half back.
    var upNow = R.act === "up", grazeNow = R.act === "graze"
    settle("up", upNow ? 1 : 0, 0.18)
    settle("ears", (upNow ? 1 : (grazeNow ? 0.75 : 0.6)) - R.flick * 0.35, 0.12)
    settle("pose", 0, 0.1)
    settle("graze", grazeNow ? 1 : 0, 0.22)
    settle("reach", 0, 0.1); settle("fn", 0, 0.1); settle("ff", 0, 0.1); settle("hb", 0, 0.08)
    R.fnLift = 0; R.ffLift = 0
    R.chew = grazeNow ? (R.chew || 0) + dt : 0
    R.look = upNow ? Math.sin(R.t * 1.7) * 0.5 : (grazeNow ? 0 : Math.sin(R.t * 0.9) * 0.2)
    if (R.t >= R.restFor) {
      R.t = 0; R.x0 = R.x
      // Now and then it turns about; on its way out it heads for the
      // nearer edge and keeps going, hopping.
      if (R.leaving) { R.dir = R.x < world.width / 2 ? -1 : 1; R.hopsLeft = 1000 }
      else if (Math.random() < 0.18 && R.x > 80 && R.x < world.width - 80) R.dir = -R.dir
      if (R.leaving || Math.random() < RABBIT.hopShare) {
        R.mode = "hop"
        if (!R.leaving) R.hopsLeft = Math.round(rand(RABBIT.hops[0], RABBIT.hops[1]))
        R.hopLen = rand(RABBIT.hop[0], RABBIT.hop[1])
      } else {
        R.mode = "walk"
        R.hopsLeft = Math.round(rand(RABBIT.steps[0], RABBIT.steps[1]))
        R.hopLen = RABBIT.walk * (R.size || 1)
        R.stepTime = rand(RABBIT.walkTime[0], RABBIT.walkTime[1])
      }
    }
  }
  // Until it means to leave, it keeps to the screen: a hop or a step that
  // would carry it past the edge margin turns it about first. (It used to
  // turn about near the left edge, hop off the screen and be dropped there,
  // seconds after it came, so on most visits it was never seen.)
  if (!R.leaving && (R.mode === "hop" || R.mode === "walk") && R.t === 0) {
    if (R.x > RABBIT.edge && R.x < world.width - RABBIT.edge) R.entered = true
    if (R.entered) {
      var reach = R.hopLen * Math.max(1, R.hopsLeft)
      if (R.dir < 0 && R.x - R.hopLen < RABBIT.edge) R.dir = 1
      else if (R.dir > 0 && R.x + R.hopLen > world.width - RABBIT.edge) R.dir = -1
      else if (R.dir < 0 && R.x - reach < RABBIT.edge) R.hopsLeft = Math.max(1, Math.floor((R.x - RABBIT.edge) / R.hopLen))
      else if (R.dir > 0 && R.x + reach > world.width - RABBIT.edge) R.hopsLeft = Math.max(1, Math.floor((world.width - RABBIT.edge - R.x) / R.hopLen))
    }
  }
  if (R.mode === "walk") {
    // A step, the way a hare goes when it is in no hurry: the forefeet
    // reach ahead one after the other while the hind feet stay put and the
    // body stretches long; then the hind feet come up together under it,
    // the haunch lifting a little, while the forefeet stay planted.
    var T = R.stepTime || 0.6
    R.t += dt
    var u = clamp(R.t / T, 0, 1)
    settle("up", 0, 0.08); settle("graze", 0, 0.1); settle("pose", 0, 0.08)
    settle("ears", 0.55 - R.flick * 0.3, 0.12)
    R.look = 0
    R.lift = 0
    if (u < 0.5) {
      var a = u / 0.5
      var an = clamp(a / 0.6, 0, 1), af = clamp((a - 0.4) / 0.6, 0, 1)
      R.fn = smooth01(an); R.ff = smooth01(af)
      R.fnLift = Math.sin(an * Math.PI); R.ffLift = Math.sin(af * Math.PI)
      R.reach = (R.fn + R.ff) / 2
      R.hb = 0
      R.x = R.x0
    } else {
      var b = (u - 0.5) / 0.5, sb = smooth01(b)
      R.fn = R.ff = R.reach = 1 - sb
      R.fnLift = R.ffLift = 0
      R.hb = Math.sin(b * Math.PI) * 2.2
      R.x = R.x0 + R.dir * R.hopLen * sb
    }
    if (u >= 1) {
      rabbitPrints(world, R, true)
      R.t = 0; R.x0 = R.x; R.reach = R.fn = R.ff = 0; R.hb = 0
      R.stepTime = clamp((R.stepTime || 0.6) * rand(0.9, 1.1), RABBIT.walkTime[0], RABBIT.walkTime[1])
      if (--R.hopsLeft <= 0) startRest(R)
    }
  } else if (R.mode !== "rest") {
    // A hop: crouch (gather), push off and stretch out low over the snow,
    // tuck, land on the forefeet, the hind feet swinging past them.
    var bolt = R.mode === "bolt"
    var T2 = bolt ? RABBIT.boltTime : RABBIT.hopTime
    R.t += dt
    var v = clamp(R.t / T2, 0, 1)
    var gather = bolt ? 0.1 : 0.22, land = 0.86
    settle("up", 0, 0.06); settle("graze", 0, 0.05)
    settle("reach", 0, 0.05); settle("fn", 0, 0.05); settle("ff", 0, 0.05); settle("hb", 0, 0.05)
    R.fnLift = R.ffLift = 0
    settle("ears", (bolt ? 0.15 : 0.45) - R.flick * 0.2, 0.1)
    R.look = 0
    if (v < gather) {
      R.pose = -smooth01(v / gather)
      R.lift = 0
    } else if (v < land) {
      var c = (v - gather) / (land - gather)
      R.x = R.x0 + R.dir * R.hopLen * smooth01(c)
      R.lift = Math.sin(c * Math.PI) * R.hopLen * (bolt ? 0.2 : RABBIT.hopArc)
      R.pose = c < 0.5 ? smooth01(c * 2) : 1 - (c - 0.5) * 2.6
    } else {
      R.x = R.x0 + R.dir * R.hopLen
      R.lift = 0
      R.pose = -0.6 * Math.sin((v - land) / (1 - land) * Math.PI)
    }
    if (v >= 1) {
      rabbitPrints(world, R)
      R.t = 0; R.x0 = R.x; R.pose = 0
      if (bolt) R.hopLen = RABBIT.bolt * rand(0.9, 1.15)
      else if (--R.hopsLeft <= 0) startRest(R)
      else R.hopLen = rand(RABBIT.hop[0], RABBIT.hop[1])
    }
  }
  rabbitFeet(world, R)
  if (!isFinite(R.x) || !isFinite(R.y)) { world.rabbit = null; return }
  if (R.x < -40 || R.x > world.width + 40) {
    // Gone only once it meant to go; one that strayed off (a bolt from the
    // pointer counts as meaning to go) is never dropped half a visit in.
    if (R.leaving) world.rabbit = null
    else if (R.age > 3) { R.dir = R.x < 0 ? 1 : -1; R.x = clamp(R.x, -40, world.width + 40); R.x0 = R.x; R.t = 0; R.mode = "hop" }
  }
}

// It stops: sits up to look about, puts its nose down to nibble, or just
// sits; on its way out, only briefly.
function startRest(R) {
  R.mode = "rest"; R.t = 0
  R.restFor = rand(RABBIT.pause[0], RABBIT.pause[1])
  var r = Math.random()
  R.act = r < RABBIT.sitUp ? "up" : (r < RABBIT.sitUp + RABBIT.graze ? "graze" : "sit")
  // "Now and then" means now and then: after a few stops spent low it sits
  // up the next time, so a visit is never without its look about.
  R.lowStops = R.act === "up" ? 0 : (R.lowStops || 0) + 1
  if (R.lowStops > RABBIT.maxLowStops) { R.act = "up"; R.lowStops = 0 }
  if (R.act === "graze") R.restFor *= 1.4
  if (R.leaving) { R.restFor *= 0.5; R.act = "up" }
  R.sitUp = R.act === "up"
}

function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t) }

// Visitors switched off (or calm mode came on): whoever is here leaves
// now, the bird flying, the hare bolting. Returns whether anyone was here.
function dismissCritters(world) {
  var any = !!(world.bird || world.rabbit)
  if (world.bird && world.bird.mode !== "out") flyOff(world.bird, 0)
  if (world.rabbit) rabbitBolts(world)
  return any
}

// Visitors may stay (on) or are being sent away (off): while off, none
// lingers and the shell brings no new one.
function setCritters(world, on) {
  world.critterLeave = !on
  if (!on) dismissCritters(world)
}

// What the visitors see right now, for the shell's scheduler and `flurry
// diag`: where a bird could land, how much snow lies on the ground and the
// ledges, whether sprouts are up.
function critterContext(world) {
  var g = world.surfaces[GROUND_ID]
  var mean = 0, cover = 0
  if (g && g.bins.length) {
    for (var i = 0; i < g.bins.length; i++) { mean += g.bins[i]; if (g.bins[i] >= 1.5) cover++ }
    mean /= g.bins.length; cover /= g.bins.length
  }
  var ledges = []
  var snowy = false
  for (var k = 0; k < world.order.length; k++) {
    var s = world.order[k]
    if (s.ground || s.plow) continue
    var m = sumOf(s.bins), top = 0
    for (var j = 0; j < s.bins.length; j++) if (s.bins[j] > top) top = s.bins[j]
    if (m > 40) snowy = true
    var ice = 0
    if (s.icicles) for (var c = 0; c < s.icicles.length; c++) if (s.icicles[c].len > 1) ice++
    ledges.push({ id: s.id, y: Math.round(s.y), w: Math.round(s.w), depth: +(m / Math.max(1, s.bins.length)).toFixed(1), top: +top.toFixed(1),
                  icicles: ice, iceAt: s.iceAt || "", frost: +(s.frost || 0).toFixed(2), glaze: +(s.glaze || 0).toFixed(2) })
  }
  var sprouts = 0
  if (world.sprouts) for (var q = 0; q < world.sprouts.length; q++) if (world.sprouts[q].g > 0.3) sprouts++
  return { perches: birdPerches(world, 4).length, snowyWindow: snowy, groundSnow: +mean.toFixed(2), groundCover: +cover.toFixed(2),
           sprouts: sprouts, plow: !!world.plow, bird: world.bird ? world.bird.mode : "", rabbit: world.rabbit ? world.rabbit.mode : "",
           golden: !!world.golden, windStrong: Math.abs(world.env.windBase) > 45 || world.env.windVar > 40,
           snowing: world.effect === "snow" && world.env.snowScale > 0.2, ledges: ledges }
}

function spawnGolden(world) {
  if (world.golden) return false
  world.golden = { x: rand(0.15, 0.85) * world.width, y: -14, vx: 0, vy: GOLDEN.vt, phase: rand(0, 6.28), spin: rand(0, 6.28),
                   rest: null, ox: 0, restLeft: GOLDEN.rest, age: 0 }
  return true
}

function stepGolden(world, dt, pointer) {
  var F = world.golden
  if (!F) return
  F.age += dt
  F.spin += dt * 0.35
  if (pointer && Math.hypot(pointer.x - F.x, pointer.y - F.y) < GOLDEN.catch) { catchGolden(world); return }
  if (F.rest) {
    var s = world.surfaces[F.rest]
    F.restLeft -= dt
    if (!s || F.restLeft <= 0) { world.golden = null; return }
    F.x = s.x + F.ox
    F.y = s.y - heightAt(s, F.x) - 2.5
    return
  }
  // It falls like a big, light flake: slowly, rocking.
  F.phase += dt * 1.6
  var x0 = F.x, y0 = F.y
  var air = airAt(world, F.x, F.y) * 0.6 + Math.sin(F.phase) * 16
  if (world.gustList.length && gustAt(world, F.x, F.y)) air += world.gx
  F.vx += (air - F.vx) * follow(dt, 0.4)
  F.vy += (GOLDEN.vt * (0.8 + 0.2 * Math.cos(F.phase * 1.3)) - F.vy) * follow(dt, 0.4)
  F.x += F.vx * dt
  F.y += F.vy * dt
  if (F.y > world.height + 20 || F.x < -60 || F.x > world.width + 60) { world.golden = null; return }
  var hit = collide(world, x0, y0, F.x, F.y)
  if (hit) { F.rest = hit.surface.id; F.ox = F.x - hit.surface.x }
}

// Caught: a shower of golden sparks, and the shell hears about it.
function catchGolden(world) {
  var F = world.golden
  if (!F) return false
  world.golden = null
  for (var i = 0; i < 16; i++) {
    var a = rand(0, Math.PI * 2), sp = rand(40, 160)
    world.particles.push({ kind: "spark", x: F.x, y: F.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
                           r: rand(0.6, 1.3), life: rand(0.6, 1.1), age: 0, rest: null, hue: i % 2 })
  }
  pushEvent(world, { type: "golden" })
  return true
}

function goldenAt(world, x, y) {
  var F = world.golden
  return !!F && Math.hypot(x - F.x, y - F.y) < GOLDEN.catch
}

// Where the golden flake is, for the input mask: a square around it.
function goldenRect(world) {
  var F = world.golden
  if (!F) return null
  var r = GOLDEN.catch
  return { x: Math.round(F.x - r), y: Math.round(F.y - r), w: r * 2, h: r * 2 }
}

// ------------------------------------------------------------------ snowballs to friends
//
// With throwing to friends on, a snowball thrown at the side of the screen
// fast enough sails past the edge instead of bursting there; once it is
// fully off the screen the shell sends it on (an event in world.events).
// A friend's snowball arrives the same way in reverse: launchBall() puts it
// just past the edge it comes in by, flying in.

var THROW = { speed: 1150 }   // px/s toward the edge, at a 1080 px tall screen

// "left", "right" or "" for a free ball at the edge of a w px wide screen.
function throwsOff(b, w, speed) {
  if (b.held) return ""
  if (b.x - b.r <= 0 && b.vx < -speed) return "left"
  if (b.x + b.r >= w && b.vx > speed) return "right"
  return ""
}

// A snowball from a friend. art: { side (the edge it left their screen
// by), y (0..1), vx, vy, r }. It comes in by the opposite edge here, as if
// the two screens stood side by side.
function launchBall(world, art) {
  if (!art) return null
  var k = ballScale(world)
  var r = clamp((+art.r || 12) * k, 3, BALL.maxRadius * k)
  var fromLeft = art.side === "right"
  var b = makeBall(world, fromLeft ? -r * 0.5 : world.width + r * 0.5, clamp(+art.y || 0.4, 0.08, 0.8) * groundY(world), Math.PI * r * r, 0.9)
  b.round = 1
  b.vx = (fromLeft ? 1 : -1) * clamp(+art.vx || 1400, 700, 2600)
  b.vy = clamp(+art.vy || -150, -900, 900)
  b.omega = b.vx / b.r * 0.3
  b.incoming = true
  if (world.balls.length >= BALL.max) {
    for (var i = 0; i < world.balls.length; i++) if (!world.balls[i].held) { crumble(world, world.balls[i]); break }
  }
  world.balls.push(b)
  return b
}

// Queues something for the shell; the queue is drained every frame, and
// never holds more than a few even if nobody drains it.
function pushEvent(world, ev) {
  world.events.push(ev)
  if (world.events.length > 32) world.events.splice(0, world.events.length - 32)
}

// What the shell plays a sound for (lib/sound.js), kept apart from the
// events it acts on: the moment it happens, in the step it happens.
function pushSound(world, ev) {
  if (!world.sounds) world.sounds = []
  world.sounds.push(ev)
  if (world.sounds.length > 32) world.sounds.splice(0, world.sounds.length - 32)
}
function takeSounds(world) {
  if (!world.sounds || !world.sounds.length) return []
  var out = world.sounds
  world.sounds = []
  return out
}

// Drains what the shell should hear about.
function takeEvents(world) {
  if (!world.events.length) return []
  var out = world.events
  world.events = []
  return out
}

// Counts of the newer things in the scene, for the status IPC and tests.
function extrasStats(world) {
  var ice = 0, marks = 0, glaze = 0
  for (var id in world.surfaces) {
    var s = world.surfaces[id]
    if (s.icicles) for (var i = 0; i < s.icicles.length; i++) if (s.icicles[i].len > 1) ice++
    if (s.marks) marks += s.marks.length
    if (s.glaze > glaze) glaze = s.glaze
  }
  var sprouts = 0
  if (world.sprouts) for (var j = 0; j < world.sprouts.length; j++) if (world.sprouts[j].g > 0.2) sprouts++
  return { season: world.env.season, spring: +world.env.spring.toFixed(2), icicles: ice, marks: marks, glaze: +glaze.toFixed(2),
           sprouts: sprouts, bird: world.bird ? world.bird.mode : "", rabbit: world.rabbit ? world.rabbit.mode : "", golden: !!world.golden,
           fireworks: world.fw ? Math.round(world.fw.left) : 0, shaking: !!world.shake }
}
