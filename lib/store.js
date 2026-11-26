.pragma library

// Flurry's saved state: what the user picked and what they built. Kept in
// $XDG_STATE_HOME/omarchy-flurry/state.json. Everything read from disk or
// from a friend goes through normalize/validate so a hand-edited file or a
// hostile gift can never put the scene into a state the UI cannot draw.

var VERSION = 1
var EFFECTS = ["snow", "leaves", "starfall", "rain", "sakura", "fireflies"]
var MAX_TREES = 3
var MAX_SNOWMEN = 12
var MAX_GIFTS = 24
var MAX_ORNAMENTS = 40
var MAX_FRIENDS = 50
var MAX_STRINGS = 8
var MAX_INBOX_LINE = 16384
var MAX_OUTBOX = 32
var MAX_FRIEND_CODE_BYTES = 512
var MAX_RAW_LIST = 256
var STRING_PALETTES = ["warm", "theme", "multi", "cool", "candy"]
var ORNAMENT_KINDS = ["bauble", "light", "candy"]
var BAUBLE_COLORS = ["#e74c3c", "#3498db", "#f1c40f", "#9b59b6", "#2ecc71", "#ecf0f1"]
var LIGHT_COLORS = ["#ffd84d", "#ff6b6b", "#7ee8fa", "#b8f28b"]
var DEFAULT_SERVER = "https://ntfy.sh"
// Bauble finishes. Glass comes first; each golden snowflake caught unlocks
// the next one.
var ORNAMENT_STYLES = ["glass", "frosted", "pearl", "gilded", "mercury"]
var ORNAMENT_STYLE_NAMES = { glass: "Glass", frosted: "Frosted glass", pearl: "Pearl", gilded: "Gilded", mercury: "Mercury glass" }
var CALM_MODES = ["off", "on", "work"]
// A snowman's outfit, put on one piece per click in this order.
var OUTFIT = ["nose", "scarf", "hat"]

function defaults() {
  return {
    version: VERSION,
    enabled: true,
    effect: "snow",
    intensity: 1,
    visitors: true,        // Santa and the Yeti
    batterySaver: true,    // halve the effect on battery
    sound: true,           // the effect's own sounds: rain, thunder with the lightning, rustling leaves...
    soundVolume: 0.8,      // 0..1
    plow: true,            // the snow plow (bulldozer) clears the ground snow when it piles up; off: it never comes
    snowballs: true,       // deep snow and snowballs take the pointer
    trees: [],
    snowmen: [],
    gifts: [],
    strings: [],           // light strings on windows: [{ id, windowClass, palette }]
    identity: null,        // { id, name } once friends are set up
    friends: [],           // [{ id, name }]
    server: DEFAULT_SERVER,
    inboxSince: "all",     // ntfy message id to resume from

    shake: true,           // `flurry shake` lifts all the snow back into the air
    windGusts: true,       // fast windows push the air and blow snow about
    writing: true,         // Ctrl+drag writes in the snow
    dayCycle: true,        // settling, melting, icicles and night glaze by the hour
    seasons: true,         // the thaw and spring around Nowruz
    newYear: true,         // fireworks at midnight on January 1st
    surprises: true,       // a robin, a winter hare, the golden snowflake, now and then
    themeSync: true,       // tint lights, scarves and snow shade from the Omarchy theme
    throwToFriends: false, // a snowball thrown off the screen goes to a friend
    throwTo: "",           // friend id, "" for the first friend
    calm: "off",           // "off", "on", or "work" (during workHours only)
    workHours: { start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4, 5, 6] },
    liveWeather: false,    // snow, wind and temperature from Open-Meteo
    weatherCity: "",       // looked up through Open-Meteo's geocoding
    weatherLat: null,
    weatherLon: null,
    weatherPlace: "",      // what the city resolved to
    weatherCache: null,    // { at, current }: the last reading, for going offline
    ornamentStyle: "glass",
    ornamentStyles: ["glass"]
  }
}

function str(v, max) { return String(v === undefined || v === null ? "" : v).slice(0, max || 64) }
function num(v, lo, hi, dflt) {
  var n = Number(v)
  if (!isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, n))
}
function color(v, palette) {
  var s = String(v || "")
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : palette[0]
}
function uid() {
  var s = ""
  for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s + Date.now().toString(16).slice(-6)
}

// A place on screen that survives restarts: the screen's name, and x/y as
// fractions of its size. Snowmen may instead ride a window: that window by
// its Hyprland address ("0x" + hex), and its class, so after a restart
// (when addresses are new) it finds a window of the same app again.
function normalizePlace(p) {
  p = p || {}
  var addr = String(p.windowAddress || "").toLowerCase()
  return {
    screen: str(p.screen, 64),
    fx: num(p.fx, 0, 1, 0.5),
    fy: num(p.fy, 0, 1, 1),
    windowAddress: /^0x[0-9a-f]{1,16}$/.test(addr) ? addr : "",
    windowClass: str(p.windowClass, 128),
    windowFx: num(p.windowFx, 0, 1, 0.5)
  }
}

function normalizeTree(t) {
  t = t || {}
  var orn = (t.ornaments instanceof Array ? t.ornaments : []).slice(0, MAX_ORNAMENTS).map(function(o) {
    var kind = ORNAMENT_KINDS.indexOf(o && o.kind) >= 0 ? o.kind : "bauble"
    var out = {
      kind: kind,
      u: num(o && o.u, -1, 1, 0),
      v: num(o && o.v, 0, 1, 0.5),
      color: color(o && o.color, kind === "light" ? LIGHT_COLORS : BAUBLE_COLORS)
    }
    if (kind === "bauble" && ORNAMENT_STYLES.indexOf(o && o.style) > 0) out.style = o.style
    return out
  })
  return { id: str(t.id || uid(), 32), place: normalizePlace(t.place), size: num(t.size, 0.6, 1.6, 1),
           star: !!t.star, ornaments: orn, planted: num(t.planted, 0, 1e13, Date.now()) }
}

// A snowman saved before outfits existed wore all of it.
function normalizeOutfit(o) {
  if (!o || typeof o !== "object") return { nose: true, scarf: true, hat: true }
  return { nose: !!o.nose, scarf: !!o.scarf, hat: !!o.hat }
}

// The outfit after one more click: the next piece goes on, and once it
// is all on, a click takes it all off again.
function dressNext(o) {
  o = normalizeOutfit(o)
  for (var i = 0; i < OUTFIT.length; i++) {
    if (!o[OUTFIT[i]]) { o[OUTFIT[i]] = true; return o }
  }
  return { nose: false, scarf: false, hat: false }
}

function normalizeSnowman(s) {
  s = s || {}
  return { id: str(s.id || uid(), 32), place: normalizePlace(s.place), size: num(s.size, 0.6, 1.6, 1),
           scarf: color(s.scarf, ["#c0392b", "#2980b9", "#27ae60", "#8e44ad"]), from: str(s.from, 40),
           outfit: normalizeOutfit(s.outfit), themeScarf: s.themeScarf === undefined ? false : !!s.themeScarf }
}

function normalizeGift(g) {
  g = g || {}
  return { id: str(g.id || uid(), 32), place: normalizePlace(g.place), kind: g.kind === "note" ? "note" : "gift",
           from: str(g.from, 40), note: str(g.note, 280), color: color(g.color, ["#2e86de", "#c0392b", "#27ae60"]),
           opened: !!g.opened }
}

function normalizeString(l) {
  if (!l || !l.windowClass) return null
  return { id: str(l.id || uid(), 32), windowClass: str(l.windowClass, 128),
           palette: STRING_PALETTES.indexOf(l.palette) >= 0 ? l.palette : "warm" }
}

function normalizeFriend(f) {
  if (!f || !validId(f.id)) return null
  return { id: f.id, name: str(f.name, 40) || "Friend" }
}

function boundedMap(arr, outLimit, fn) {
  if (!(arr instanceof Array) || outLimit <= 0) return []
  var cap = Math.min(arr.length, MAX_RAW_LIST)
  var out = []
  for (var i = 0; i < cap && out.length < outLimit; i++) {
    var v = fn(arr[i])
    if (v !== null && v !== undefined) out.push(v)
  }
  return out
}

function normalize(raw) {
  var d = defaults()
  if (!raw || typeof raw !== "object") return d
  d.enabled = raw.enabled !== false
  d.effect = EFFECTS.indexOf(raw.effect) >= 0 ? raw.effect : "snow"
  d.intensity = num(raw.intensity, 0.25, 2, 1)
  d.visitors = raw.visitors !== false
  d.batterySaver = raw.batterySaver !== false
  d.sound = raw.sound !== false
  d.soundVolume = num(raw.soundVolume, 0, 1, 0.8)
  d.plow = raw.plow !== false
  d.snowballs = raw.snowballs !== false
  d.trees = boundedMap(raw.trees, MAX_TREES, normalizeTree)
  d.snowmen = boundedMap(raw.snowmen, MAX_SNOWMEN, normalizeSnowman)
  d.strings = boundedMap(raw.strings, MAX_STRINGS, normalizeString)
  d.gifts = (raw.gifts instanceof Array ? raw.gifts.slice(-MAX_GIFTS) : []).map(normalizeGift)
  if (raw.identity && validId(raw.identity.id))
    d.identity = { id: raw.identity.id, name: str(raw.identity.name, 40) || "Me" }
  d.friends = boundedMap(raw.friends, MAX_FRIENDS, normalizeFriend)
  d.server = validServer(raw.server) ? String(raw.server).replace(/\/+$/, "") : DEFAULT_SERVER
  d.inboxSince = /^[A-Za-z0-9]{1,32}$/.test(String(raw.inboxSince || "")) ? String(raw.inboxSince) : "all"
  var flags = ["shake", "windGusts", "writing", "dayCycle", "seasons", "newYear", "surprises", "themeSync"]
  for (var f = 0; f < flags.length; f++) d[flags[f]] = raw[flags[f]] !== false
  d.throwToFriends = raw.throwToFriends === true
  d.throwTo = validId(raw.throwTo) ? raw.throwTo : ""
  d.calm = CALM_MODES.indexOf(raw.calm) >= 0 ? raw.calm : "off"
  d.workHours = normalizeHours(raw.workHours)
  d.liveWeather = raw.liveWeather === true
  d.weatherCity = str(raw.weatherCity, 80).trim()
  d.weatherLat = coord(raw.weatherLat, 90)
  d.weatherLon = coord(raw.weatherLon, 180)
  d.weatherPlace = str(raw.weatherPlace, 80)
  d.weatherCache = normalizeWeatherCache(raw.weatherCache)
  var rawStyles = raw.ornamentStyles instanceof Array ? raw.ornamentStyles.slice(0, 32) : []
  d.ornamentStyles = ORNAMENT_STYLES.filter(function(st, i) {
    return i === 0 || rawStyles.indexOf(st) >= 0
  })
  d.ornamentStyle = d.ornamentStyles.indexOf(raw.ornamentStyle) >= 0 ? raw.ornamentStyle : "glass"
  return d
}

function coord(v, lim) {
  if (v === null || v === undefined || typeof v === "boolean" || typeof v === "object") return null
  if (typeof v === "string" && v.trim() === "") return null
  var n = Number(v)
  return isFinite(n) && Math.abs(n) <= lim ? n : null
}

function normalizeHours(h) {
  var d = { start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4, 5, 6] }
  if (!h || typeof h !== "object") return d
  var t = /^([01]?\d|2[0-3]):[0-5]\d$/
  if (t.test(String(h.start))) d.start = String(h.start)
  if (t.test(String(h.end))) d.end = String(h.end)
  if (h.days instanceof Array) {
    var days = []
    var cap = Math.min(h.days.length, 32)
    for (var i = 0; i < cap; i++) {
      var n = Number(h.days[i])
      if (n >= 0 && n <= 6 && Math.floor(n) === n && days.indexOf(n) < 0) days.push(n)
    }
    if (days.length) d.days = days.sort()
  }
  return d
}

function normalizeWeatherCache(c) {
  if (!c || typeof c !== "object" || !(Number(c.at) > 0) || !c.current || typeof c.current !== "object") return null
  var k = c.current
  var n = function(v, lo, hi) { var x = Number(v); return isFinite(x) ? Math.max(lo, Math.min(hi, x)) : 0 }
  return { at: Number(c.at), current: { tempC: n(k.tempC, -90, 60), precip: n(k.precip, 0, 500), snowfall: n(k.snowfall, 0, 100),
                                         windKmh: n(k.windKmh, 0, 300), windDir: n(k.windDir, 0, 360), isDay: !!k.isDay } }
}

// The golden snowflake unlocks the next bauble finish, and switches to it.
// Returns the style unlocked, or "" when all of them already are.
function unlockNext(saved) {
  for (var i = 0; i < ORNAMENT_STYLES.length; i++) {
    var st = ORNAMENT_STYLES[i]
    if (saved.ornamentStyles.indexOf(st) < 0) {
      saved.ornamentStyles = ORNAMENT_STYLES.filter(function(x) { return x === st || saved.ornamentStyles.indexOf(x) >= 0 })
      saved.ornamentStyle = st
      return st
    }
  }
  return ""
}

// The next unlocked finish after the current one, for cycling in the menu.
function nextStyle(saved) {
  var list = saved.ornamentStyles
  var i = list.indexOf(saved.ornamentStyle)
  return list[(i + 1) % list.length]
}

// ----------------------------------------------------------------- friends
//
// Gifts travel over ntfy (https://ntfy.sh by default, or a self-hosted
// server): each person's inbox is the topic "flurry-<id>", where id is 128
// random bits, so only someone holding the friend code can post to it. A
// friend code is "flurry1:<name>:<id>" and is what people swap.

function validId(id) { return /^[a-f0-9]{32}$/.test(String(id || "")) }
function validServer(s) {
  if (typeof s !== "string" && !(s instanceof String)) return false
  var raw = String(s).replace(/\/+$/, "")
  if (!raw || raw.length > 253) return false
  var m = /^https:\/\/([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(raw)
  if (!m) return false
  var host = m[1], port = m[2]
  if (port !== undefined) {
    var p = Number(port)
    if (!isFinite(p) || p < 1 || p > 65535) return false
  }
  if (host.charAt(0) === "." || host.charAt(host.length - 1) === "." || host.indexOf("..") >= 0) return false
  var labels = host.split(".")
  for (var i = 0; i < labels.length; i++) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(labels[i])) return false
  }
  var low = host.toLowerCase()
  if (low === "localhost" || /\.localhost$/.test(low)) return false
  if (/^(127|0)\./.test(low) || /^169\.254\./.test(low)) return false
  return true
}

function topicFor(id) { return "flurry-" + id }

function friendCode(identity) {
  if (!identity || !validId(identity.id)) return ""
  return "flurry1:" + encodeURIComponent(identity.name || "Friend") + ":" + identity.id
}

function parseFriendCode(code) {
  var m = /^flurry1:([^:]{1,120}):([a-f0-9]{32})$/.exec(String(code || "").trim())
  if (!m) return null
  var name
  try { name = decodeURIComponent(m[1]) } catch (e) { return null }
  return { name: str(name, 40) || "Friend", id: m[2] }
}

// What goes over the wire. art carries just enough to redraw the thing.
function giftMessage(identity, kind, payload) {
  var msg = { v: 1, app: "flurry", kind: kind, from: { id: identity.id, name: identity.name }, at: Date.now() }
  if (kind === "note") msg.note = str(payload && payload.note, 280)
  if (kind === "snowman") msg.art = { scarf: payload && payload.scarf, size: payload && payload.size,
                                      outfit: payload && payload.outfit }
  if (kind === "snowball") msg.art = normalizeThrow(payload)
  if (kind === "tree") msg.art = { star: !!(payload && payload.star), size: payload && payload.size,
                                   ornaments: payload && payload.ornaments }
  if (payload && payload.note && kind !== "note") msg.note = str(payload.note, 280)
  return msg
}

function normalizeGiftArt(kind, art) {
  if (kind === "snowball") return normalizeThrow(art)
  var a = art && typeof art === "object" ? art : {}
  if (kind === "snowman") {
    return {
      scarf: color(a.scarf, ["#c0392b", "#2980b9", "#27ae60", "#8e44ad"]),
      size: num(a.size, 0.6, 1.6, 1),
      outfit: normalizeOutfit(a.outfit)
    }
  }
  if (kind === "tree") {
    var t = normalizeTree({ star: a.star, size: a.size, ornaments: a.ornaments })
    return { star: t.star, size: t.size, ornaments: t.ornaments }
  }
  return {}
}

// Classify an incoming ntfy event line:
//   { type: "keepalive", id }
//   { type: "gift", id, gift }
//   null (invalid, oversized, or non-Flurry payload)
function classifyInboxEvent(line, friends) {
  var text = String(line === undefined || line === null ? "" : line)
  if (text.length > MAX_INBOX_LINE) return null
  var ev
  try { ev = JSON.parse(text) } catch (e) { return null }
  if (!ev || typeof ev !== "object") return null
  var evId = /^[A-Za-z0-9]{1,32}$/.test(String(ev.id || "")) ? String(ev.id) : ""
  if (ev.event === "keepalive" || ev.event === "open") return { type: "keepalive", id: evId }
  if (ev.event !== "message" || typeof ev.message !== "string") return null
  var msg
  try { msg = JSON.parse(ev.message) } catch (e2) { return null }
  if (!msg || msg.app !== "flurry" || msg.v !== 1 || !msg.from || !validId(msg.from.id)) return null
  if (["snowman", "tree", "note", "snowball"].indexOf(msg.kind) < 0) return null
  var known = null
  for (var i = 0; i < (friends || []).length; i++) if (friends[i].id === msg.from.id) known = friends[i]
  return {
    type: "gift",
    id: evId,
    gift: {
      kind: msg.kind,
      fromId: msg.from.id,
      from: known ? known.name : (str(msg.from.name, 40) || "Someone"),
      known: !!known,
      note: str(msg.note, 280),
      art: normalizeGiftArt(msg.kind, msg.art)
    }
  }
}

// Validate an incoming ntfy event line. Returns { id, gift } or null.
function parseInbox(line, friends) {
  var res = classifyInboxEvent(line, friends)
  return res && res.type === "gift" ? { id: res.id, gift: res.gift } : null
}

// A snowball thrown off one screen onto a friend's: which edge it left by,
// how high (a share of the screen's height), how fast (px/s, sideways and
// up), and how big (radius px). Clamped, so a hostile one is still just a
// snowball.
function normalizeThrow(a) {
  a = a && typeof a === "object" ? a : {}
  return { side: a.side === "left" ? "left" : "right", y: num(a.y, 0, 1, 0.5),
           vx: num(a.vx, 300, 3200, 1400), vy: num(a.vy, -2400, 2400, -200), r: num(a.r, 3, 40, 12) }
}

// Which friend a snowball goes to: the chosen one, else the first.
function throwTarget(saved) {
  if (!saved.friends.length) return null
  for (var i = 0; i < saved.friends.length; i++) if (saved.friends[i].id === saved.throwTo) return saved.friends[i]
  return saved.friends[0]
}
