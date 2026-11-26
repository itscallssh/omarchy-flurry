.pragma library

// When Flurry runs and how hard: fullscreen, battery and calm mode, and
// when the rare surprises (a robin, a hare, the golden snowflake) come. Pure
// JavaScript, tested under node; the service feeds it what it reads from
// Hyprland, UPower and /sys/class/power_supply.

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }

// ------------------------------------------------------------- power
//
// The service lists /sys/class/power_supply as one line per supply:
//   name|type|status|capacity|online
// This reads it: { known, onBattery, percent }. On AC when any mains
// supply is online; on battery when a battery discharges and no mains is
// online. Desktops (no battery) are never on battery.
function parsePowerSupply(text) {
  var lines = String(text || "").split("\n")
  var mains = null, battery = false, discharging = false, pct = []
  for (var i = 0; i < lines.length; i++) {
    var f = lines[i].split("|")
    if (f.length < 5) continue
    var type = f[1].trim(), status = f[2].trim().toLowerCase(), cap = Number(f[3]), online = f[4].trim()
    if (type === "Mains" || type === "USB" || type === "USB_C" || type === "USB_PD") {
      if (online === "1") mains = true
      else if (mains === null) mains = false
    } else if (type === "Battery") {
      // Peripherals (mice, headsets) report a scope; only the system battery counts.
      if (/hid|hidpp|wacom|ps-controller|sony|nintendo|logitech/i.test(f[0])) continue
      battery = true
      if (status === "discharging") discharging = true
      if (isFinite(cap) && f[3].trim() !== "") pct.push(clamp(cap, 0, 100))
    }
  }
  var percent = pct.length ? pct.reduce(function(a, b) { return a + b }, 0) / pct.length : 100
  return { known: battery || mains !== null, battery: battery, onBattery: battery && mains !== true && discharging, percent: percent }
}

// Hyprland's fullscreen state per window: 0 none, 1 maximized, 2
// fullscreen, 3 both. Only real fullscreen pauses the scene.
function fullscreenActive(modes) {
  for (var i = 0; i < (modes || []).length; i++) if (Number(modes[i]) >= 2) return true
  return false
}

// Whether a real fullscreen window is up on this monitor: on its active
// workspace `wsId`, or on the special workspace `special` (0 for none)
// shown over it. `items` are the toplevels' Hyprland readings.
function fullscreenOn(items, wsId, special) {
  var modes = []
  for (var i = 0; i < (items || []).length; i++) {
    var ipc = items[i]
    if (!ipc || !ipc.fullscreen || !ipc.workspace || ipc.mapped === false || ipc.hidden) continue
    var ws = Number(ipc.workspace.id)
    if (ws === Number(wsId) || (special && ws === Number(special))) modes.push(Number(ipc.fullscreen))
  }
  return fullscreenActive(modes)
}

// ------------------------------------------------------------- calm
//
// calm: "off", "on", or "work" (only within working hours).
// hours: { start: "09:00", end: "17:00", days: [0..6] (0 Sunday) }; an end
// before the start runs past midnight.
function minutesOf(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""))
  if (!m) return -1
  var h = +m[1], mm = +m[2]
  return h < 24 && mm < 60 ? h * 60 + mm : -1
}

function inHours(date, hours) {
  hours = hours || {}
  var a = minutesOf(hours.start), b = minutesOf(hours.end)
  if (a < 0 || b < 0 || a === b) return false
  var days = hours.days instanceof Array && hours.days.length ? hours.days : [0, 1, 2, 3, 4, 5, 6]
  var now = date.getHours() * 60 + date.getMinutes()
  if (a < b) return days.indexOf(date.getDay()) >= 0 && now >= a && now < b
  // Overnight: the evening part belongs to today, the morning to yesterday.
  if (now >= a) return days.indexOf(date.getDay()) >= 0
  return now < b && days.indexOf((date.getDay() + 6) % 7) >= 0
}

function calmNow(calm, hours, date) {
  if (calm === "on") return true
  if (calm === "work") return inHours(date, hours)
  return false
}

// ------------------------------------------------------------- the gate
//
// gate(s) -> { paused, quality, fps, calm, surprises, fireworks }
//   s.fullscreen   a real fullscreen window on this screen's workspace
//   s.onBattery, s.percent, s.batterySaver
//   s.calm         calm mode is on now (calmNow)
//   s.surprises, s.fireworks   the user's toggles
function gate(s) {
  s = s || {}
  var paused = !!s.fullscreen
  var quality = 1, fps = 60
  if (s.batterySaver !== false && s.onBattery) {
    quality = s.percent !== undefined && s.percent <= 20 ? 0.35 : 0.5
    fps = s.percent !== undefined && s.percent <= 20 ? 24 : 30
  }
  if (s.calm) quality = Math.min(quality, 0.75)
  return {
    paused: paused, quality: quality, fps: fps, calm: !!s.calm,
    surprises: !paused && !s.calm && s.surprises !== false && quality >= 0.5,
    fireworks: !paused && !s.calm && s.fireworks !== false
  }
}

// ------------------------------------------------------------- surprises
//
// Something small, now and then: a robin, a winter hare, and (rarely) the
// golden snowflake. Each comes only when it makes sense, and the reason
// it can't is kept for `flurry diag`.
//
// The scene's mode is what the sky is doing: with the Snow effect, the
// live weather's kind when Live weather is on ("snow", "flurries",
// "blizzard", "sleet", "rain", "clear"), else "snow"; "spring" once the
// thaw is well along; any other effect is its own mode ("leaves", "rain",
// "starfall", "sakura", "fireflies").
//
//   robin   snow, flurries, a clear cold day, or spring; not in a blizzard,
//           rain or sleet, nor in strong wind. Needs somewhere to land.
//   hare    snow, flurries or a clear day, with snow lying on the ground
//           (white coat); in spring on the sprouts (brown coat). Not in a
//           blizzard, rain or sleet; never while the plow is out.
//   golden  while it snows (snow, flurries, blizzard).
// None of them while calm mode is on, a window is being dragged, a
// fullscreen app is up, Flurry is being decorated, or surprises are off.
//
// ctx (from the shell): { mode, surprises, calm, fullscreen, dragging,
//   decorating, perches, groundSnow (mean px), groundCover (0..1 share
//   with >= 1.5 px), sprouts, windStrong, plow, snowing }

var SURPRISE = {
  first: [45000, 90000],      // the first one comes this soon after the scene starts
  minGap: 2 * 60000,          // at least this long between visits
  spread: 2.5 * 60000,        // plus up to this much more
  retry: 15000,               // nothing could come: look again this soon
  check: 5000,                // how often the shell looks whether one is due
  goldenGap: 50 * 60000,      // the golden snowflake is rarer still
  golden: 0.05,               // chance of the golden flake on a visit it may come
  weights: { bird: 0.45, rabbit: 0.55 }
}
var SNOWY_MODES = ["snow", "flurries"]
var KINDS = ["bird", "rabbit", "golden"]

function sceneMode(effect, env, weatherKind) {
  if (effect && effect !== "snow") return String(effect)
  if (env && env.spring >= 0.5) return "spring"
  return weatherKind ? String(weatherKind) : "snow"
}

// Why `kind` can't come now, or "" when it can.
function surpriseBlock(kind, ctx) {
  ctx = ctx || {}
  if (ctx.surprises === false) return "surprises are off"
  if (ctx.calm) return "calm mode"
  if (ctx.fullscreen) return "a fullscreen app is up"
  if (ctx.lowPower) return "battery is low"
  if (ctx.decorating) return "decorating"
  if (ctx.dragging) return "a window is moving"
  var mode = ctx.mode || "snow"
  if (kind === "bird") {
    if (mode === "blizzard") return "no robins in a blizzard"
    if (SNOWY_MODES.indexOf(mode) < 0 && mode !== "clear" && mode !== "spring") return "no robins in " + mode
    if (ctx.windStrong) return "too windy for a robin"
    if (!(ctx.perches > 0)) return "nowhere for a bird to land"
    return ""
  }
  if (kind === "rabbit") {
    if (ctx.plow) return "the plow is out"
    if (mode === "spring") return (ctx.sprouts || 0) >= 5 ? "" : "no sprouts up yet"
    // A clear, cold day with snow lying is hare weather too: with live
    // weather on, the sky is "clear" most of the time, and the hare used
    // never to come at all.
    if (SNOWY_MODES.indexOf(mode) < 0 && mode !== "clear") return "the hare comes only in snow (now " + mode + ")"
    if (!((ctx.groundCover || 0) >= 0.15 || (ctx.groundSnow || 0) >= 1)) return "no snow on the ground yet"
    return ""
  }
  if (kind === "golden") {
    if (SNOWY_MODES.indexOf(mode) < 0 && mode !== "blizzard") return "the golden flake falls only in snow"
    return ""
  }
  return "unknown: " + kind
}

// { bird: "", rabbit: "no snow on the ground yet", golden: "" }: "" for
// those that can come.
function surpriseOptions(history, now, ctx) {
  var out = {}
  for (var i = 0; i < KINDS.length; i++) out[KINDS[i]] = surpriseBlock(KINDS[i], ctx)
  var h = history || []
  for (var j = h.length - 1; j >= 0; j--) {
    if (h[j].kind !== "golden") continue
    if (now - h[j].at < SURPRISE.goldenGap && !out.golden) out.golden = "a golden flake came lately"
    break
  }
  return out
}

function surpriseWeights(history, now, ctx) {
  var opt = surpriseOptions(history, now, ctx)
  var w = { bird: opt.bird ? 0 : SURPRISE.weights.bird, rabbit: opt.rabbit ? 0 : SURPRISE.weights.rabbit,
            golden: opt.golden ? 0 : SURPRISE.golden }
  // Never the same visitor twice running while another could come.
  var h = history || []
  var last = h.length ? h[h.length - 1].kind : ""
  if ((last === "bird" || last === "rabbit") && w.bird > 0 && w.rabbit > 0) w[last] = 0
  return w
}

// The golden snowflake is a flat chance whenever it is allowed; otherwise
// a robin or the hare. "" when nothing can come now.
function pickSurprise(history, now, ctx, rng) {
  rng = rng || Math.random
  var w = surpriseWeights(history, now, ctx)
  if (w.golden > 0 && rng() < w.golden) return "golden"
  var total = w.bird + w.rabbit
  if (total <= 0) return ""
  return rng() * total < w.bird ? "bird" : "rabbit"
}

// opts.first: the scene has just started (the first visit comes within a
// couple of minutes); opts.missed: nothing could come, or it found no room
// (look again soon rather than in minutes).
function planSurprise(history, now, ctx, rng, opts) {
  rng = rng || Math.random
  opts = opts || {}
  var h = history || []
  var delay
  if (opts.missed) delay = SURPRISE.retry
  else if (opts.first || !h.length) delay = SURPRISE.first[0] + rng() * (SURPRISE.first[1] - SURPRISE.first[0])
  else delay = Math.max(SURPRISE.minGap + rng() * SURPRISE.spread, SURPRISE.minGap - (now - h[h.length - 1].at))
  return { kind: pickSurprise(h, now, ctx, rng), delay: Math.round(delay) }
}

function remember(history, kind, now) {
  return (history || []).concat([{ kind: kind, at: now }]).slice(-8)
}

// "cat" was the hare's name before it came; "" stays "" (pick one).
function surpriseAlias(kind) {
  kind = String(kind || "").toLowerCase().trim()
  if (kind === "cat" || kind === "hare" || kind === "bunny") return "rabbit"
  if (kind === "robin") return "bird"
  return kind
}

// ------------------------------------------------------------- diag
//
// What `flurry diag` prints: every feature's state and why it is (or
// isn't) active, put together from what the service and the scene know.
// o: { now, mode, weather: { live, kind }, env, gates, timer: { running,
//      nextAt }, history, last, ctx (scene: critterContext plus gates),
//      faults: { name: { message, count } } }
function diagReport(o) {
  o = o || {}
  var ctx = o.ctx || {}
  var env = o.env || {}
  var now = o.now || 0
  var opt = surpriseOptions(o.history, now, ctx)
  var ledges = ctx.ledges || []
  var ice = 0
  for (var i = 0; i < ledges.length; i++) ice += ledges[i].icicles || 0
  var num = function(v, d) { v = Number(v); return isFinite(v) ? +v.toFixed(d === undefined ? 2 : d) : null }
  var icicles = !(o.gates && o.gates.dayCycle === false) ? (o.mode === "snow" || o.mode === "flurries" || o.mode === "blizzard" || o.mode === "clear"
    ? (env.icicle > 0 ? "growing at " + num(env.icicle) + " of full rate" : "too warm to grow") : "only with the Snow effect")
    : "off (Melting, icicles, night glaze)"
  return {
    mode: o.mode || "",
    weather: { live: !!(o.weather && o.weather.live), kind: o.weather && o.weather.kind ? o.weather.kind : "(off: calendar)",
               tempC: num(env.tempC, 1), measured: !!env.weather, season: env.season || "", sun: num(env.sun), freeze: num(env.freeze) },
    gates: o.gates || {},
    surprises: {
      timer: o.timer && o.timer.running ? "running" : "stopped",
      nextInS: o.timer && o.timer.running ? Math.max(0, Math.round(((o.timer.nextAt || now) - now) / 1000)) : null,
      // Tries in a row where nothing could come, and in plain words why
      // the last one failed (or why the timer does not run at all).
      missesInARow: o.timer && o.timer.misses ? o.timer.misses : 0,
      waiting: surpriseWaiting(o),
      last: o.last || null,
      recent: (o.history || []).map(function(h) { return h.kind }),
      bird: opt.bird || "can come", rabbit: opt.rabbit || "can come", golden: opt.golden || "can come"
    },
    scene: ctx.offline ? { offline: ctx.offline } : {
      perches: ctx.perches, groundSnow: ctx.groundSnow, groundCover: ctx.groundCover, sprouts: ctx.sprouts,
      bird: ctx.bird || "-", rabbit: ctx.rabbit || "-", plowOut: !!ctx.plow, windStrong: !!ctx.windStrong
    },
    ice: { icicles: ice, status: icicles, ledges: ledges },
    faults: o.faults || {}
  }
}

// One line for `flurry diag` on why no visitor has come lately.
function surpriseWaiting(o) {
  var g = o.gates || {}
  if (g.enabled === false) return "Flurry is off"
  if (g.surprises === false) return "Surprises are off (flurry surprises)"
  if (!(o.timer && o.timer.running)) return "the scheduler is not running (no scene showing: Flurry off or a fullscreen app on every screen)"
  var ctx = o.ctx || {}
  if (ctx.offline) return ctx.offline
  var opt = surpriseOptions(o.history, o.now || 0, ctx)
  if (opt.bird && opt.rabbit && opt.golden) return "none can come now: robin: " + opt.bird + "; hare: " + opt.rabbit
  if (o.last && o.last.why && !o.last.came) return "the last try missed: " + o.last.why
  return ""
}

// ------------------------------------------------------------- window snapshot
//
// The pointer feed asks Hyprland for the pointer and the focused window in
// one request ("[[BATCH]]j/cursorpos;j/activewindow"), so both come from the
// same compositor instant. While a window is dragged it is the focused one,
// and this reading of it is as fresh as the pointer's, far fresher than the
// window list (see SceneWindow.readWindows). Batch replies are joined by
// blank lines.
var CURSOR_BATCH = "[[BATCH]]j/cursorpos;j/activewindow"

// Reads a reply to the batch above, or to a plain "cursorpos" ("x, y"):
//   { state: "partial" } more of the reply is still to come;
//   { state: "bad" }     not a reply this understands;
//   { state: "ok", x, y, win } win: { address, x, y, w, h } of the focused
//                        window, or null when none is focused (Hyprland
//                        answers "{}") or the reply had no window part.
function parseCursorReply(text) {
  var t = String(text === undefined || text === null ? "" : text)
  var plain = /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/.exec(t)
  if (plain) return { state: "ok", x: Number(plain[1]), y: Number(plain[2]), win: null }
  if (!/^\s*\{/.test(t)) return { state: t.trim() === "" ? "partial" : "bad" }
  // The parts: each a JSON object, split where one closes and the next opens.
  var parts = t.split(/\}\s*\n\s*\n\s*\{/)
  if (parts.length < 2) {
    // The cursor part alone: the window part is still on its way.
    return { state: "partial" }
  }
  var a = parts[0] + "}", b = "{" + parts.slice(1).join("}\n\n{")
  var cur = null, win = null
  try { cur = JSON.parse(a) } catch (e) { return { state: "bad" } }
  try { win = JSON.parse(b) } catch (e2) { return { state: "partial" } }
  if (!cur || !isFinite(Number(cur.x)) || !isFinite(Number(cur.y))) return { state: "bad" }
  var w = null
  if (win && win.address && win.at && win.size && isFinite(Number(win.at[0]) + Number(win.at[1]) + Number(win.size[0]) + Number(win.size[1])))
    w = { address: String(win.address), x: Number(win.at[0]), y: Number(win.at[1]), w: Number(win.size[0]), h: Number(win.size[1]) }
  return { state: "ok", x: Number(cur.x), y: Number(cur.y), win: w }
}

// The window list as the scene sees it, with the focused window's
// rectangle taken from the snapshot when that is fresher. rects: screen-
// local [{ id, x, y, w, h, ... }]; snap: { id, x, y, w, h, at (ms) } in
// global layout px; sx, sy: the screen's origin; listAt: when the window
// list was asked for (ms). Each rect gains `age`, how old its reading is
// (s). A fresh snapshot always wins for its window: the list's answer is
// applied a poll or two behind the compositor, so mixing the two would
// shake the window between readings of different ages. One older than
// `maxAge` ms is not used (the pointer feed has stopped).
function withSnapshot(rects, snap, now, sx, sy, listAt, maxAge) {
  var listAge = listAt > 0 ? Math.min(0.1, Math.max(0, now - listAt) / 1000) : 0
  var fresh = !!snap && !!snap.id && isFinite(snap.at) && now - snap.at >= 0 && now - snap.at <= (maxAge || 150)
  var out = []
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i], o = {}
    for (var k in r) o[k] = r[k]
    if (fresh && r.id === snap.id && isFinite(snap.x + snap.y + snap.w + snap.h)) {
      o.x = snap.x - sx; o.y = snap.y - sy; o.w = snap.w; o.h = snap.h
      o.age = Math.max(0, now - snap.at) / 1000
    } else o.age = listAge
    out.push(o)
  }
  return out
}

// ------------------------------------------------- the screen's layout
//
// What a monitor reserves for bars and panels, from `hyprctl monitors`'s
// `reserved` (Hyprland writes [left, top, right, bottom], logical px):
// { left, top, right, bottom }. Nothing Flurry draws may cover the top,
// left or right ones (the scene's layer surface is kept out of them, see
// SceneWindow margins); the bottom one is where the ground stands on.
// Anything unreadable counts as 0, and no side may take over half the
// screen.
function reservedOf(r, width, height) {
  var a = r instanceof Array ? r : (r && typeof r === "object" && r.length !== undefined ? r : [])
  function side(i, span) {
    var v = Number(a[i])
    if (!isFinite(v) || v <= 0) return 0
    return Math.min(Math.round(v), Math.floor((span > 0 ? span : 1e6) / 2))
  }
  return { left: side(0, width), top: side(1, height), right: side(2, width), bottom: side(3, height) }
}

// The windows a scene shows, in its own px: `items` are { ipc, id } (the
// toplevel's last Hyprland reading and its "0x" address), `o` says what the
// scene shows: { wsId (its monitor's active workspace), special (the open
// special workspace's id, or 0), ox, oy (the scene's top-left corner in
// Hyprland's global layout px: the monitor's position plus the reserved
// left and top), exists(id) (whether the window really exists) }.
// A window on the special workspace is shown over the rest, as Hyprland
// does. Hyprland's at/size are logical layout px, as the monitor's
// position is, so fractional scales and transforms need nothing more.
function sceneRects(items, o) {
  var rects = [], seen = {}
  var special = Number(o.special) || 0, wsId = Number(o.wsId)
  for (var i = 0; i < items.length; i++) {
    var it = items[i], ipc = it ? it.ipc : null
    if (!ipc || !ipc.at || !ipc.size || ipc.hidden || ipc.mapped === false) continue
    var ws = ipc.workspace ? Number(ipc.workspace.id) : NaN
    if (ws !== wsId && !(special && ws === special)) continue
    var id = it.id
    if (!id || seen[id] || (o.exists && !o.exists(id))) continue
    seen[id] = true
    var x = Number(ipc.at[0]) - (o.ox || 0), y = Number(ipc.at[1]) - (o.oy || 0), w = Number(ipc.size[0]), h = Number(ipc.size[1])
    if (!isFinite(x + y + w + h)) continue
    rects.push({ id: id, cls: String(ipc["class"] || ""), x: x, y: y, w: w, h: h,
                 floating: !!ipc.floating || (special > 0 && ws === special),
                 z: ipc.focusHistoryID === undefined ? 50 : Number(ipc.focusHistoryID) })
  }
  return rects
}

// ------------------------------------------------- windows out of sight
//
// Which windows still exist, with a grace period. A window that leaves the
// screen is put aside with its snow while it is alive anywhere (another
// workspace or monitor) and dropped, its snow falling, once it is gone. The
// toplevel list can lose a window for a moment though, mid-way through a
// workspace switch while Quickshell re-reads its toplevels: for that moment
// the window was neither on the screen nor alive, so its ledge was spilled
// (or its stash thrown away) and it came back bare (recording 11-39-11 at
// 36-37.5 s, a maximized window round-tripped through an empty workspace).
// So a window seen alive in the last `graceMs` still counts as alive,
// unless Hyprland said it closed (`closed(id)`): a real close is never
// delayed. `memo` (id -> ms last seen alive) is kept by the caller.
// Returns the ids to treat as alive.
var ALIVE_GRACE_MS = 2500
function graceAlive(memo, ids, now, graceMs, closed) {
  var grace = graceMs === undefined ? ALIVE_GRACE_MS : graceMs
  var out = [], has = {}
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i])
    if (!id || has[id]) continue
    has[id] = true
    out.push(id)
    memo[id] = now
  }
  for (var k in memo) {
    if (has[k]) continue
    if (now - memo[k] > grace || now < memo[k] - 60000 || (closed && closed(k))) { delete memo[k]; continue }
    has[k] = true
    out.push(k)
  }
  return out
}

// ------------------------------------------------- the compositor plugin
//
// hyprland-plugin/ (flurry-anchor) has the compositor paint what lies on a
// window (its frost, ledge and icicles) with the window, in the frame it
// moves it. The overlay paints that into two strips per window (draw.js
// paintStrip), saves them as PNGs and tells the plugin over Hyprland's
// socket; these build and read those requests. A request starts with "/"
// (no flags) so Hyprland reads the path's slashes as part of it.
var ANCHOR_PING = "/flurry ping"
function anchorPingOk(text) { return String(text || "").indexOf("flurry-anchor ok") === 0 }
function anchorKey(id) {
  var k = String(id || "").toLowerCase()
  if (k.indexOf("0x") === 0) k = k.slice(2)
  return /^[0-9a-f]+$/.test(k) ? k : ""
}
// Three files a strip, used in turn, so a file is never rewritten while
// the compositor may still be reading it.
function anchorFile(dir, id, slot, n) {
  var k = anchorKey(id)
  if (!k || !dir || /[;\n]/.test(dir)) return ""
  return dir + "/" + k + "-" + slot + "-" + (((n % 3) + 3) % 3) + ".png"
}
function anchorNum(v) { return String(Math.round(v * 100) / 100) }
function anchorSet(id, strip, file) {
  var k = anchorKey(id)
  if (!k || !file) return ""
  return "/flurry set 0x" + k + " " + strip.slot + " " + anchorNum(strip.ox) + " " + anchorNum(strip.oy) + " " +
         anchorNum(strip.w) + " " + anchorNum(strip.h) + " " + file
}
function anchorClear(id) { var k = anchorKey(id); return k ? "/flurry clear 0x" + k : "" }
var ANCHOR_CLEAR_ALL = "/flurry clearall"
function anchorBatch(cmds) {
  var list = []
  for (var i = 0; i < cmds.length; i++) if (cmds[i]) list.push(cmds[i])
  return list.length ? "[[BATCH]]" + list.join(";") : ""
}
// True once all `n` replies in a Hyprland [[BATCH]] response have arrived.
function anchorBatchComplete(text, n) {
  if (!(n > 0)) return false
  return String(text || "").split("\n\n\n").length > n
}
// One answer per request in the batch: true when the plugin took it.
function anchorReplies(text, n) {
  var parts = String(text || "").split("\n\n\n")
  var out = []
  for (var i = 0; i < n; i++) out.push(String(parts[i] || "").trim() === "ok")
  return out
}
// Windows whose strips the plugin holds that are no longer here (closed,
// or moved off this screen's workspace): theirs are cleared.
function anchorGone(held, now) {
  var keep = {}, out = []
  for (var i = 0; i < now.length; i++) keep[now[i]] = true
  for (var k in held) if (held[k] && !keep[k]) out.push(k)
  return out
}

// -------------------------------------------------- bounded IO stream guards
//
// Quickshell's StdioCollector buffers without a byte cap, and SplitParser
// with a newline marker buffers an entire unterminated line in C++ before
// QML sees it. Everything reading untrusted or variable-size streams sets
// SplitParser { splitMarker: "" } and feeds raw chunks through these guards.

function utf8Bytes(s) {
  var str = String(s || ""), n = 0
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var c2 = str.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) { n += 4; i++ }
      else n += 3
    } else n += 3
  }
  return n
}

function newCollector(maxBytes) {
  return { buf: "", bytes: 0, maxBytes: maxBytes > 0 ? maxBytes : 65536, overflowed: false }
}

function collectChunk(state, chunk) {
  if (!state || state.overflowed) return false
  var s = String(chunk === undefined || chunk === null ? "" : chunk)
  var add = utf8Bytes(s)
  if (state.bytes + add > state.maxBytes) {
    state.overflowed = true
    state.buf = ""
    return false
  }
  state.buf += s
  state.bytes += add
  return true
}

function newLineStream(maxLineBytes) {
  return { buf: "", bytes: 0, maxLineBytes: maxLineBytes > 0 ? maxLineBytes : 16384, overflowed: false }
}

// Splits `chunk` on "\n" and passes each non-empty line (without "\r") to
// `onLine`. Returns false and clears the buffer immediately if an unterminated
// or complete line would exceed `maxLineBytes`.
function pushLineChunk(state, chunk, onLine) {
  if (!state || state.overflowed) return false
  var s = String(chunk === undefined || chunk === null ? "" : chunk)
  var pos = 0
  while (pos <= s.length) {
    var nl = s.indexOf("\n", pos)
    if (nl < 0) {
      var tail = s.slice(pos)
      if (tail.length > 0) {
        var tb = utf8Bytes(tail)
        if (state.bytes + tb > state.maxLineBytes) {
          state.overflowed = true
          state.buf = ""
          state.bytes = 0
          return false
        }
        state.buf += tail
        state.bytes += tb
      }
      break
    }
    var seg = s.slice(pos, nl)
    if (seg.length > 0 && seg.charAt(seg.length - 1) === "\r") seg = seg.slice(0, -1)
    var sb = utf8Bytes(seg)
    if (state.bytes + sb > state.maxLineBytes) {
      state.overflowed = true
      state.buf = ""
      state.bytes = 0
      return false
    }
    var line = state.buf + seg
    state.buf = ""
    state.bytes = 0
    if (line.length > 0 && onLine) onLine(line)
    if (state.overflowed) return false
    pos = nl + 1
    if (pos === s.length) break
  }
  return true
}
