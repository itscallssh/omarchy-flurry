.pragma library

// Live weather from Open-Meteo (https://open-meteo.com, no key needed).
// The service fetches; everything here is pure so it is tested under node:
// the request URLs, reading the answers, and turning the current weather
// into snow, wind and temperature for the scene.

var FORECAST = "https://api.open-meteo.com/v1/forecast"
var GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
var REFRESH_MS = 15 * 60000        // fetch every 15 minutes
var STALE_MS = 3 * 3600000         // a reading older than this is ignored
var MAX_RESPONSE_BYTES = 65536

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }
function num(v) { var n = Number(v); return isFinite(n) ? n : null }

function validCoord(v, lim) {
  if (v === null || v === undefined || typeof v === "boolean" || typeof v === "object") return false
  if (typeof v === "string" && v.trim() === "") return false
  var n = num(v)
  return n !== null && n >= -lim && n <= lim
}
function validLat(v) { return validCoord(v, 90) }
function validLon(v) { return validCoord(v, 180) }

function forecastUrl(lat, lon) {
  if (!validLat(lat) || !validLon(lon)) return ""
  return FORECAST + "?latitude=" + Number(lat).toFixed(4) + "&longitude=" + Number(lon).toFixed(4)
    + "&current=temperature_2m,precipitation,snowfall,wind_speed_10m,wind_direction_10m,is_day"
    + "&wind_speed_unit=kmh&timezone=auto"
}

function geocodeUrl(city) {
  var name = String(city || "").trim().slice(0, 80)
  if (!name) return ""
  return GEOCODE + "?name=" + encodeURIComponent(name) + "&count=1&language=en&format=json"
}

// Classify a geocoding answer:
//   { status: "ok", location: { name, lat, lon } }
//   { status: "not_found" }   valid Open-Meteo JSON with no matching place
//   { status: "error" }       oversized, non-JSON, or API error payload
function parseGeocodeStatus(text) {
  if (typeof text === "string" && text.length > MAX_RESPONSE_BYTES) return { status: "error" }
  var j
  try { j = typeof text === "string" ? JSON.parse(text) : text } catch (e) { return { status: "error" } }
  if (!j || typeof j !== "object" || j.error === true) return { status: "error" }
  if (j.results === undefined) {
    return typeof j.generationtime_ms === "number" ? { status: "not_found" } : { status: "error" }
  }
  if (!(j.results instanceof Array) || j.results.length === 0) return { status: "not_found" }
  var r = j.results[0]
  if (!r || !validLat(r.latitude) || !validLon(r.longitude)) return { status: "not_found" }
  var label = String(r.name || "").slice(0, 60)
  if (r.country_code) label += ", " + String(r.country_code).slice(0, 4)
  return { status: "ok", location: { name: label, lat: +r.latitude, lon: +r.longitude } }
}

// The first match of a geocoding answer: { name, lat, lon } or null.
function parseGeocode(text) {
  var res = parseGeocodeStatus(text)
  return res.status === "ok" ? res.location : null
}

// The `current` block of a forecast answer, checked: { tempC, precip,
// snowfall (cm), windKmh, windDir (degrees, where it blows from), isDay }
// or null when it isn't a usable answer.
function parseCurrent(text) {
  if (typeof text === "string" && text.length > MAX_RESPONSE_BYTES) return null
  var j
  try { j = typeof text === "string" ? JSON.parse(text) : text } catch (e) { return null }
  var c = j && j.current
  if (!c || typeof c !== "object") return null
  var t = num(c.temperature_2m)
  if (t === null || t < -90 || t > 60) return null
  return {
    tempC: t,
    precip: Math.max(0, num(c.precipitation) || 0),
    snowfall: Math.max(0, num(c.snowfall) || 0),
    windKmh: clamp(num(c.wind_speed_10m) || 0, 0, 300),
    windDir: ((num(c.wind_direction_10m) || 0) % 360 + 360) % 360,
    isDay: c.is_day === 1 || c.is_day === true
  }
}

// What the current weather means for the scene.
//   snowScale: multiplies the snowfall you set (0.15 light, 1 as set, 2 heavy)
//   windBase:  steady wind across the screen, px/s, + blows to the right
//   windVar:   how far gusts swing around it, px/s
//   tempC:     for melting, settling and icicles
// The screen is taken to face north, so a westerly (from 270°) blows left
// to right. Without fresh snowfall a few flakes still drift: it's a snow
// toy, and still air with the odd flake is what a dry winter day looks like.
function map(cur) {
  if (!cur) return null
  var snowScale
  if (cur.snowfall > 0) snowScale = clamp(0.6 + cur.snowfall * 1.6, 0.6, 2)
  else if (cur.precip > 0 && cur.tempC > 1) snowScale = 0.15            // raining: only wet flakes
  else if (cur.precip > 0) snowScale = clamp(0.45 + cur.precip * 0.8, 0.45, 1.2)
  else snowScale = 0.3
  var px = Math.min(70, cur.windKmh * 1.6)
  return {
    snowScale: +snowScale.toFixed(3),
    windBase: +(-Math.sin(cur.windDir * Math.PI / 180) * px).toFixed(2),
    windVar: +(8 + px * 0.4).toFixed(2),
    tempC: cur.tempC,
    isDay: cur.isDay,
    kind: kindOf(cur)
  }
}

// What the sky is doing, in a word, for the visitors (see Policy):
//   blizzard  heavy snow (2 cm/h or more) or snow in a strong wind (40 km/h+)
//   snow      snowing (0.4 cm/h or more)
//   flurries  light snow
//   sleet     wet: precipitation within a degree or two of freezing
//   rain      precipitation above freezing
//   clear     nothing falling
function kindOf(cur) {
  if (!cur) return ""
  if (cur.snowfall > 0) {
    if (cur.snowfall >= 2 || cur.windKmh >= 40) return "blizzard"
    return cur.snowfall >= 0.4 ? "snow" : "flurries"
  }
  if (cur.precip > 0) {
    if (cur.tempC > 2) return "rain"
    if (cur.tempC > -1) return "sleet"
    return "snow"
  }
  return "clear"
}

// A cached reading if it is recent enough to use, mapped; otherwise null,
// and the scene falls back to the calendar's mild winter day.
function usable(cache, now) {
  if (!cache || !cache.current || !(cache.at > 0)) return null
  if (now - cache.at > STALE_MS || cache.at - now > 60000) return null
  return map(cache.current)
}

// When to try again after a failed fetch: back off from a minute up to the
// normal refresh interval, so an offline laptop doesn't keep trying.
function retryDelay(failures) {
  return Math.min(REFRESH_MS, 60000 * Math.pow(2, clamp(failures | 0, 0, 6)))
}
