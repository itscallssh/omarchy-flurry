.pragma library

// Weather wallpaper: which painting goes with which scene mode, and how one
// gives way to the next. Opt-in (Store `wallpaper`); drawn by
// WallpaperWindow.qml on its own layer under every window, so the user's
// own Omarchy wallpaper stays untouched underneath and shows again when the
// feature is turned off.
//
// All seven paintings are one scene (a cabin and a cherry tree in a flat
// mountain meadow) in different weather, so a crossfade reads as the sky
// changing, not a cut. None has anything falling in the air: Flurry draws
// the snow, rain and petals itself. The bottom ~15% is flat open ground for
// the ground snow and the plow.

var DIR = "wallpapers"
var NATIVE = { width: 7680, height: 4320 }
var IMAGES = ["snow", "clear", "rain", "sakura", "autumn", "night", "summer-night"]

// Scene mode (Policy.sceneMode: the effect, or with snow, spring and live
// weather) -> painting.
var MODE_IMAGE = {
  snow: "snow", flurries: "snow", blizzard: "snow",
  rain: "rain", sleet: "rain",
  clear: "clear",
  sakura: "sakura", spring: "sakura",
  leaves: "autumn",
  starfall: "night",
  fireflies: "summer-night"
}

// Fade length in seconds: the default, and the range `wallpaperFade` is
// held to. Long on purpose: like a sunset, it should be over before you
// notice it started.
var FADE_DEFAULT = 10
var FADE_MIN = 2
var FADE_MAX = 60

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }

// imageFor(mode, opts) -> painting name. A clear sky after dark is the
// night painting (opts.sun: Season's 0..1 daylight; 0 is night).
function imageFor(mode, opts) {
  var name = MODE_IMAGE[String(mode || "")] || "snow"
  if (name === "clear" && opts && typeof opts.sun === "number" && opts.sun <= 0.02) return "night"
  return name
}

// Path of a painting, relative to the plugin folder.
function fileOf(name) {
  return DIR + "/" + (IMAGES.indexOf(name) >= 0 ? name : "snow") + ".jpg"
}

function fadeSeconds(v) {
  var n = Number(v)
  return isFinite(n) && v !== null && v !== "" && typeof v !== "boolean" ? clamp(n, FADE_MIN, FADE_MAX) : FADE_DEFAULT
}

// The pixel size to decode a painting at for a screen of w x h logical px
// at `scale`: just enough to cover it (the painting is cropped, never
// letterboxed), and never more than the file holds. A 1080p screen decodes
// a 1920x1080 image, not the 8K original.
function coverSize(w, h, scale) {
  var s = scale > 0 ? scale : 1
  var W = Math.max(1, Math.round((w || 0) * s)), H = Math.max(1, Math.round((h || 0) * s))
  var k = Math.max(W / NATIVE.width, H / NATIVE.height)
  k = Math.min(1, k)
  return { width: Math.max(1, Math.round(NATIVE.width * k)), height: Math.max(1, Math.round(NATIVE.height * k)) }
}

// Dusk easing: very slow to start, very slow to finish (smootherstep), so
// there is no moment where the change becomes visible.
function ease(t) {
  t = clamp(t, 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// A faint tint over the whole fade, warm early and cool late, at most a
// few percent, the way light shifts at sunset: { color, alpha }.
var TINT_WARM = [255, 176, 120]
var TINT_COOL = [120, 150, 210]
var TINT_MAX = 0.06
function tint(t) {
  t = clamp(t, 0, 1)
  var e = ease(t), c = []
  for (var i = 0; i < 3; i++) c.push(Math.round(TINT_WARM[i] + (TINT_COOL[i] - TINT_WARM[i]) * e))
  var hex = "#" + c.map(function(v) { return (v < 16 ? "0" : "") + v.toString(16) }).join("")
  return { color: hex, alpha: +(TINT_MAX * Math.sin(Math.PI * t)).toFixed(4) }
}

// ----------------------------------------------------------- the fades
//
// A screen's wallpaper is a small state machine; WallpaperWindow keeps one
// and asks it what to do. Nothing animates (and nothing repaints) unless a
// fade is running.
//   shown:    painting fully on screen ("" = none: the user's wallpaper)
//   target:   painting fading in, "" while idle; "-" means fading out
//   pending:  what to fade to next once the running fade ends ("" none)
function initial() { return { shown: "", target: "", pending: "" } }

function busy(st) { return !!st && st.target !== "" }

// want(st, name, animate) -> { state, start, jump }
//   name:    the painting wanted now, or "" to give the screen back to the
//            user's own wallpaper (the feature turned off)
//   animate: false when nobody would see a fade (a fullscreen app, Flurry
//            hidden, animations off): the change happens at once
//   start:   the fade to begin now ("" none; "-" a fade out)
//   jump:    true when the change is applied at once, no fade
// A change asked for mid-fade waits its turn (only the latest is kept), so
// a fade is never cut short and never reversed with a visible jump.
function want(st, name, animate) {
  st = st || initial()
  name = name ? String(name) : ""
  var to = name === "" ? "-" : name
  var out = { shown: st.shown, target: st.target, pending: st.pending }
  if (!animate) return { state: { shown: name, target: "", pending: "" }, start: "", jump: st.shown !== name || st.target !== "" }
  if (busy(st)) {
    out.pending = (to === st.target) ? "" : to
    return { state: out, start: "", jump: false }
  }
  if (st.shown === name) return { state: out, start: "", jump: false }
  out.target = to
  return { state: out, start: to, jump: false }
}

// finished(st) -> { state, start }: the running fade ended; begin the
// pending one, if it still changes anything.
function finished(st) {
  st = st || initial()
  var shown = st.target === "-" ? "" : (st.target || st.shown)
  var next = st.pending
  var nextName = next === "-" ? "" : next
  if (next && nextName !== shown) return { state: { shown: shown, target: next, pending: "" }, start: next }
  return { state: { shown: shown, target: "", pending: "" }, start: "" }
}
