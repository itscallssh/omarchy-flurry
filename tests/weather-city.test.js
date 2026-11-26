// The World section's city: typed in the panel, looked up on Open-Meteo's
// geocoder, saved, then its weather read and handed to the scene. The
// answers are recorded from the live API (tests/fixtures/geocode-*.json,
// forecast-tehran.json, 2026-11-26).
//   FLURRY_ROOT=/old/checkout node --test tests/weather-city.test.js
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")
const ROOT = process.env.FLURRY_ROOT || path.join(__dirname, "..")
function load(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^\.pragma library\s*/m, "").replace(/^\.import .*$/mg, "")
  const names = [...src.matchAll(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/mg)].map(m => m[1])
  return new Function(src + "\nreturn {" + [...new Set(names)].map(n => n + ": " + n).join(", ") + "}")()
}
const Weather = load("lib/weather.js"), Store = load("lib/store.js"), Season = load("lib/season.js"), Policy = load("lib/policy.js")
const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")

// What Service.qml does with a typed city, step for step: the languages to
// ask in, the request, the bounded read of the answer, the parse, the save.
function lookUp(typed, answers) {
  let saved = Store.normalize(Object.assign(Store.defaults(), { weatherCity: typed, weatherLat: null, weatherLon: null, liveWeather: true }))
  const parts = Weather.cityParts ? Weather.cityParts(typed) : { name: typed, hint: "" }
  const langs = Weather.geocodeLanguages ? Weather.geocodeLanguages(parts.name) : ["en"]
  const asked = []
  for (const lang of langs) {
    const url = Weather.geocodeUrl(typed, lang)
    asked.push(url)
    const lng = /[?&]language=([a-z]+)/.exec(url)[1]
    const body = answers[lng] || '{"generationtime_ms":0.1}'
    const c = Policy.newCollector(Weather.MAX_RESPONSE_BYTES)
    assert.ok(Policy.collectChunk(c, body))
    const res = Weather.parseGeocodeStatus(c.buf, parts.hint)
    if (res.status === "not_found") continue
    assert.strictEqual(res.status, "ok")
    const g = res.location
    saved = Store.normalize(Object.assign(JSON.parse(JSON.stringify(saved)), { weatherLat: g.lat, weatherLon: g.lon, weatherPlace: g.name }))
    return { saved, asked }
  }
  return { saved, asked, notFound: true }
}

test("a city typed in Persian is found and saved (the geocoder only matches in the language it is asked in)", () => {
  const r = lookUp("تهران", { fa: fixture("geocode-tehran-fa.json"), en: fixture("geocode-tehran-fa-as-en.json") })
  assert.ok(!r.notFound, "not found; asked " + r.asked.join(" | "))
  assert.match(r.asked[0], /language=fa/)
  assert.ok(Math.abs(r.saved.weatherLat - 35.69439) < 1e-6 && Math.abs(r.saved.weatherLon - 51.42151) < 1e-6)
  assert.match(r.saved.weatherPlace, /IR$/)
  assert.strictEqual(r.saved.weatherCity, "تهران")
  assert.strictEqual(r.saved.liveWeather, true)
})

test("a Latin name is asked in English and a country after a comma picks the match", () => {
  const r = lookUp("Tehran, IR", { en: fixture("geocode-tehran-en.json") })
  assert.ok(!r.notFound)
  assert.match(r.asked[0], /name=Tehran&/, "only the place name is sent")
  assert.strictEqual(r.saved.weatherPlace, "Tehran, IR")
  const two = JSON.stringify({ results: [{ name: "Paris", latitude: 48.85, longitude: 2.35, country_code: "FR", country: "France" },
                                         { name: "Paris", latitude: 33.66, longitude: -95.55, country_code: "US", country: "United States", admin1: "Texas" }] })
  assert.strictEqual(Weather.parseGeocode(two, "Texas").lat, 33.66)
  assert.strictEqual(Weather.parseGeocode(two, "").lat, 48.85)
})

test("the requests stay bounded: curl's size cap, https only, no redirects", () => {
  const svc = fs.readFileSync(path.join(ROOT, "Service.qml"), "utf8")
  assert.match(svc, /"--max-filesize", String\(Weather\.MAX_RESPONSE_BYTES\)/)
  assert.match(svc, /"--proto", "=https"/)
  assert.match(svc, /geoProc\.collector = Policy\.newCollector\(Weather\.MAX_RESPONSE_BYTES\)/)
})

test("the saved city's weather reaches the scene", () => {
  const cur = Weather.parseCurrent(fixture("forecast-tehran.json"))
  assert.ok(cur && cur.tempC > -90)
  const mapped = Weather.usable({ at: 1000, current: cur }, 2000)
  const env = Season.environment(new Date("2026-11-26T13:15:00"), { weather: mapped, seasons: true, dayCycle: true, override: "", springAt: 0, calm: false })
  assert.strictEqual(env.weather, true)
  assert.strictEqual(env.tempC, cur.tempC)
  assert.strictEqual(Policy.sceneMode("snow", env, mapped.kind), "clear")
})

test("the panel can be typed in: a KeyboardPanel that focuses its content, not an xdg-popup of the bar", () => {
  const w = fs.readFileSync(path.join(ROOT, "Widget.qml"), "utf8")
  assert.match(w, /KeyboardPanel \{\s*\n\s*id: popup/)
  assert.match(w, /focusTarget: flick/)
  assert.doesNotMatch(w, /PopupCard \{/)
})
