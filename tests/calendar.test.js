// Seasons, Nowruz, New Year and the day cycle (lib/season.js), live weather
// (lib/weather.js), theme colours (lib/theme.js) and the gate on power,
// fullscreen, calm mode and surprises (lib/policy.js).
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const Season = load("lib/season.js")
const Weather = load("lib/weather.js")
const Theme = load("lib/theme.js")
const Policy = load("lib/policy.js")

// ------------------------------------------------------------- the equinox

test("the March equinox lands within a few minutes of the published instants", () => {
  // USNO / IMCCE times, UTC.
  const known = {
    2000: Date.UTC(2000, 2, 20, 7, 35), 2019: Date.UTC(2019, 2, 20, 21, 58), 2020: Date.UTC(2020, 2, 20, 3, 49),
    2024: Date.UTC(2024, 2, 20, 3, 6), 2025: Date.UTC(2025, 2, 20, 9, 1), 2026: Date.UTC(2026, 2, 20, 14, 46),
    2030: Date.UTC(2030, 2, 20, 13, 51)
  }
  for (const y in known) {
    const off = Math.abs(Season.marchEquinox(+y).getTime() - known[y]) / 60000
    assert.ok(off < 4, `${y}: ${off.toFixed(1)} min off`)
  }
})

test("Nowruz follows the noon rule in Tehran", () => {
  // 1 Farvardin, as the Iranian calendar has it.
  assert.deepStrictEqual(Season.nowruz(2019), { y: 2019, m: 3, d: 21 })
  assert.deepStrictEqual(Season.nowruz(2020), { y: 2020, m: 3, d: 20 })
  assert.deepStrictEqual(Season.nowruz(2024), { y: 2024, m: 3, d: 20 })
  assert.deepStrictEqual(Season.nowruz(2025), { y: 2025, m: 3, d: 21 })  // equinox 12:31 Tehran: after noon
  assert.deepStrictEqual(Season.nowruz(2026), { y: 2026, m: 3, d: 21 })
  assert.deepStrictEqual(Season.nowruz(2028), { y: 2028, m: 3, d: 20 })
})

test("seasons: winter, the two-week thaw before Nowruz, spring through Sizdah Bedar, then off", () => {
  const at = (y, m, d, h) => Season.season(new Date(y, m - 1, d, h || 12))
  assert.strictEqual(at(2026, 12, 20).name, "winter")
  assert.ok(at(2026, 12, 20).christmas)
  assert.ok(at(2027, 1, 5).christmas)
  assert.ok(!at(2027, 1, 8).christmas)
  assert.strictEqual(at(2027, 2, 20).name, "winter")
  const early = at(2027, 3, 8), late = at(2027, 3, 19)
  assert.strictEqual(early.name, "thaw")
  assert.strictEqual(late.name, "thaw")
  assert.ok(early.spring > 0 && early.spring < late.spring && late.spring < 1, `${early.spring} < ${late.spring}`)
  assert.strictEqual(at(2027, 3, 21).name, "spring")
  assert.strictEqual(at(2027, 3, 21).spring, 1)
  assert.strictEqual(at(2027, 4, 1).spring, 1)
  assert.ok(at(2027, 4, 3).spring < 1)
  assert.strictEqual(at(2027, 6, 1).name, "off")
  assert.strictEqual(at(2027, 11, 3).name, "winter")
})

test("New Year: a ten second countdown, then the show, then nothing", () => {
  const d = (y, mo, da, h, mi, s) => new Date(y, mo, da, h, mi, s)
  assert.strictEqual(Season.newYear(d(2026, 11, 31, 23, 59, 45)).phase, "")
  const c = Season.newYear(d(2026, 11, 31, 23, 59, 53))
  assert.strictEqual(c.phase, "countdown")
  assert.ok(Math.abs(c.seconds - 7) < 0.01)
  assert.strictEqual(Season.newYear(d(2027, 0, 1, 0, 0, 0)).phase, "show")
  assert.strictEqual(Season.newYear(d(2027, 0, 1, 0, 1, 30)).phase, "show")
  assert.strictEqual(Season.newYear(d(2027, 0, 1, 0, 2, 0)).phase, "")
  assert.strictEqual(Season.newYear(d(2027, 6, 1, 0, 0, 30)).phase, "")
  // Sleeps long most of the year, wakes in time for the countdown.
  assert.strictEqual(Season.msUntilNewYearWatch(d(2026, 5, 1, 12, 0, 0)), 3600000)
  const wake = Season.msUntilNewYearWatch(d(2026, 11, 31, 23, 59, 0))
  assert.ok(wake <= 45000 && wake >= 44000, String(wake))
})

test("the day: melting only above freezing, faster in the afternoon sun; glaze on cold nights", () => {
  const noon = new Date(2026, 11, 20, 13, 30), night = new Date(2026, 11, 20, 2, 0)
  assert.strictEqual(Season.dayCycle(noon, -5).melt, 0)
  assert.ok(Season.dayCycle(noon, 3).melt > Season.dayCycle(new Date(2026, 11, 20, 18, 0), 3).melt)
  assert.ok(Season.dayCycle(noon, 3).melt < 0.001, "slow: well under a minute's time constant")
  assert.ok(Season.dayCycle(night, -6).freeze > 0.8)
  assert.strictEqual(Season.dayCycle(noon, -6).freeze, 0)
  // Icicles grow on sunny days below freezing, barely at night.
  assert.ok(Season.dayCycle(noon, -2).icicle > Season.dayCycle(night, -2).icicle)
  assert.ok(Season.dayCycle(night, -2).icicle >= 0.5, "icicles still grow on a cold night")
  assert.strictEqual(Season.dayCycle(noon, 6).icicle, 0, "not in the warmth")
  assert.strictEqual(Season.dayCycle(night, -6).drip, 0)
  // Without a reading, a mild winter day: melts a little after lunch only.
  assert.ok(Season.dayCycle(noon).melt > 0 && Season.dayCycle(night).melt === 0)
})

test("environment: spring stops the snow, brings petals and sprouts; calm halves it", () => {
  const winter = Season.environment(new Date(2026, 11, 20, 12), {})
  assert.strictEqual(winter.snowScale, 1)
  assert.strictEqual(winter.petals, 0)
  const spring = Season.environment(new Date(2027, 2, 22, 12), {})
  assert.strictEqual(spring.snowScale, 0)
  assert.ok(spring.petals > 0.99 && spring.sprouts > 0.99 && spring.melt > 0)
  const preview = Season.environment(new Date(2026, 11, 20, 12), { override: "spring", springAt: 0.5 })
  assert.ok(preview.snowScale > 0 && preview.snowScale < 0.6)
  const off = Season.environment(new Date(2027, 2, 22, 12), { seasons: false })
  assert.strictEqual(off.spring, 0)
  const calm = Season.environment(new Date(2026, 11, 20, 12), { calm: true })
  assert.strictEqual(calm.snowScale, 0.5)
  assert.ok(calm.calm)
  const w = Season.environment(new Date(2026, 11, 20, 12), { weather: { snowScale: 1.8, windBase: -30, windVar: 20, tempC: 4 } })
  assert.strictEqual(w.snowScale, 1.8)
  assert.strictEqual(w.windBase, -30)
  assert.strictEqual(w.tempC, 4)
  assert.ok(w.melt > 0)
})

// ------------------------------------------------------------- weather

test("weather: request URLs and reading Open-Meteo's answers", () => {
  const u = Weather.forecastUrl(35.6892, 51.389)
  assert.ok(u.startsWith("https://api.open-meteo.com/v1/forecast?latitude=35.6892&longitude=51.3890"))
  assert.ok(u.includes("current=temperature_2m,precipitation,snowfall,wind_speed_10m,wind_direction_10m,is_day"))
  assert.strictEqual(Weather.forecastUrl(95, 0), "")
  assert.strictEqual(Weather.forecastUrl(null, 3), "")
  assert.strictEqual(Weather.validLat("   "), false)
  assert.strictEqual(Weather.validLon(false), false)
  assert.strictEqual(Weather.validLat(true), false)
  assert.ok(Weather.geocodeUrl("Tabriz & co").includes("name=Tabriz%20%26%20co"))
  assert.strictEqual(Weather.geocodeUrl("  "), "")
  const g = Weather.parseGeocode(JSON.stringify({ results: [{ name: "Tehran", latitude: 35.69, longitude: 51.42, country_code: "IR" }] }))
  assert.deepStrictEqual(g, { name: "Tehran, IR", lat: 35.69, lon: 51.42 })
  assert.strictEqual(Weather.parseGeocode("{}"), null)
  assert.strictEqual(Weather.parseGeocode("<html>"), null)
  assert.strictEqual(Weather.parseGeocodeStatus("").status, "error")
  assert.strictEqual(Weather.parseGeocodeStatus("<html>").status, "error")
  assert.strictEqual(Weather.parseGeocodeStatus(JSON.stringify({ error: true, reason: "boom" })).status, "error")
  assert.strictEqual(Weather.parseGeocodeStatus(JSON.stringify({ generationtime_ms: 0.12 })).status, "not_found")
  assert.strictEqual(Weather.parseGeocodeStatus(JSON.stringify({ results: [] })).status, "not_found")
  assert.strictEqual(Weather.parseGeocode("x".repeat(Weather.MAX_RESPONSE_BYTES + 1)), null)
  const cur = Weather.parseCurrent(JSON.stringify({ current: { temperature_2m: -3.2, precipitation: 0.4, snowfall: 0.28,
    wind_speed_10m: 18, wind_direction_10m: 270, is_day: 1 } }))
  assert.deepStrictEqual(cur, { tempC: -3.2, precip: 0.4, snowfall: 0.28, windKmh: 18, windDir: 270, isDay: true })
  assert.strictEqual(Weather.parseCurrent(JSON.stringify({ current: { temperature_2m: "warm" } })), null)
  assert.strictEqual(Weather.parseCurrent("not json"), null)
  assert.strictEqual(Weather.parseCurrent("x".repeat(Weather.MAX_RESPONSE_BYTES + 1)), null)
})

test("weather maps to snow, wind across the screen and temperature", () => {
  const base = { tempC: -2, precip: 0, snowfall: 0, windKmh: 0, windDir: 0, isDay: true }
  const m = o => Weather.map(Object.assign({}, base, o))
  assert.ok(m({}).snowScale < 0.5, "dry: a few flakes")
  assert.ok(m({ snowfall: 0.1 }).snowScale < m({ snowfall: 0.6 }).snowScale)
  assert.strictEqual(m({ snowfall: 5 }).snowScale, 2)
  assert.ok(m({ precip: 2, tempC: 4 }).snowScale < 0.2, "rain: only wet flakes")
  // A westerly blows left to right, an easterly right to left, a northerly straight down.
  assert.ok(m({ windKmh: 20, windDir: 270 }).windBase > 25)
  assert.ok(m({ windKmh: 20, windDir: 90 }).windBase < -25)
  assert.ok(Math.abs(m({ windKmh: 20, windDir: 0 }).windBase) < 1e-6)
  assert.ok(m({ windKmh: 200, windDir: 270 }).windBase <= 70)
  assert.ok(m({ windKmh: 30 }).windVar > m({}).windVar)
  assert.strictEqual(m({ tempC: 5 }).tempC, 5)
})

test("weather: a stale or missing reading falls back to none; failures back off", () => {
  const now = Date.now()
  const cache = { at: now - 20 * 60000, current: { tempC: -1, precip: 0, snowfall: 0.2, windKmh: 5, windDir: 200, isDay: true } }
  assert.ok(Weather.usable(cache, now))
  assert.strictEqual(Weather.usable(Object.assign({}, cache, { at: now - 4 * 3600000 }), now), null)
  assert.strictEqual(Weather.usable(null, now), null)
  assert.strictEqual(Weather.retryDelay(0), 60000)
  assert.ok(Weather.retryDelay(2) > Weather.retryDelay(1))
  assert.strictEqual(Weather.retryDelay(50), Weather.REFRESH_MS)
})

// ------------------------------------------------------------- theme

test("theme: reads Omarchy's colors.toml and derives Flurry's palette", () => {
  const toml = `mode = "dark"\naccent = "#89b4fa"\nbackground = "#1e1e2e"\nforeground = "#cdd6f4"\n# a comment\n` +
               `red = "#f38ba8"\nyellow = "#f9e2af"\ngreen = '#a6e3a1'\nblue = "#89b4fa"\nmagenta = "#f5c2e7"\ncyan = "#94e2d5"\n[extra]\nnope = 3\n`
  const p = Theme.parse(toml)
  assert.strictEqual(p.accent, "#89b4fa")
  assert.strictEqual(p.green, "#a6e3a1")
  assert.strictEqual(p.source, "theme")
  const d = Theme.derive(p)
  assert.ok(d.lights.length >= 3 && d.lights.every(c => /^#[0-9a-f]{6}$/.test(c)))
  assert.strictEqual(d.lights[0], "#89b4fa")
  assert.strictEqual(d.scarf, "#89b4fa")
  assert.ok(/^#[0-9a-f]{6}$/.test(d.shadow) && /^#[0-9a-f]{6}$/.test(d.ink) && d.fireworks.length === 5)
  // Older themes: only color0..color15.
  const old = Theme.parse(`color0 = "#282828"\ncolor1 = "#cc241d"\ncolor2 = "#98971a"\ncolor4 = "#458588"\ncolor7 = "#a89984"`)
  assert.strictEqual(old.red, "#cc241d")
  assert.strictEqual(old.accent, "#458588")
  assert.strictEqual(old.background, "#282828")
  // Nothing usable: the fallback palette.
  assert.strictEqual(Theme.parse("").source, "fallback")
  assert.strictEqual(Theme.parse("accent = notacolour").source, "fallback")
  assert.strictEqual(Theme.derive(null).source, "fallback")
  assert.ok(Theme.same(Theme.derive(p), Theme.derive(Theme.parse(toml))))
  // A washed-out accent still makes a scarf with some colour in it.
  const pale = Theme.derive(Theme.parse(`accent = "#fafafa"\nred = "#ff5555"`))
  assert.strictEqual(pale.scarf.length, 7)
  assert.notStrictEqual(pale.scarf, "#fafafa")
})

// ------------------------------------------------------------- the gate

test("power: /sys/class/power_supply read for battery and AC", () => {
  const laptopOnBattery = "AC|Mains|Unknown||0\nBAT0|Battery|Discharging|64|\nhidpp_battery_0|Battery|Discharging|30|\n"
  assert.deepStrictEqual(Policy.parsePowerSupply(laptopOnBattery), { known: true, battery: true, onBattery: true, percent: 64 })
  const charging = "AC|Mains|Unknown||1\nBAT0|Battery|Charging|64|\n"
  assert.strictEqual(Policy.parsePowerSupply(charging).onBattery, false)
  const desktop = "ucsi-source-psy-USBC000:001|USB|Unknown||0\n"
  assert.strictEqual(Policy.parsePowerSupply(desktop).onBattery, false)
  // A desktop is known to have no battery after one read, so it is not read again.
  assert.deepStrictEqual([Policy.parsePowerSupply(desktop).known, Policy.parsePowerSupply(desktop).battery], [true, false])
  assert.strictEqual(Policy.parsePowerSupply("").known, false)
})

test("gate: fullscreen pauses, battery lowers quality and frame rate, calm stops surprises and fireworks", () => {
  assert.ok(Policy.fullscreenActive([0, 2]))
  assert.ok(Policy.fullscreenActive([3]))
  assert.ok(!Policy.fullscreenActive([1, 0]), "maximized is not fullscreen")
  assert.ok(!Policy.fullscreenActive([]))
  const full = Policy.gate({ fullscreen: true })
  assert.ok(full.paused && !full.surprises && !full.fireworks)
  const ac = Policy.gate({})
  assert.deepStrictEqual([ac.quality, ac.fps, ac.paused, ac.surprises, ac.fireworks], [1, 60, false, true, true])
  const bat = Policy.gate({ onBattery: true, percent: 70, batterySaver: true })
  assert.deepStrictEqual([bat.quality, bat.fps], [0.5, 30])
  const low = Policy.gate({ onBattery: true, percent: 12, batterySaver: true })
  assert.deepStrictEqual([low.quality, low.fps, low.surprises], [0.35, 24, false])
  assert.strictEqual(Policy.gate({ onBattery: true, batterySaver: false }).quality, 1)
  const calm = Policy.gate({ calm: true })
  assert.ok(!calm.surprises && !calm.fireworks && calm.quality < 1)
  assert.ok(!Policy.gate({ surprises: false }).surprises)
})

test("calm mode: on, off, or only within working hours", () => {
  const hours = { start: "09:00", end: "17:30", days: [6, 0, 1, 2, 3] }   // Saturday to Wednesday
  const wed10 = new Date(2026, 10, 25, 10, 0)    // a Wednesday
  const fri10 = new Date(2026, 10, 27, 10, 0)    // a Friday
  assert.ok(Policy.calmNow("work", hours, wed10))
  assert.ok(!Policy.calmNow("work", hours, fri10))
  assert.ok(!Policy.calmNow("work", hours, new Date(2026, 10, 25, 17, 30)))
  assert.ok(Policy.calmNow("on", hours, fri10))
  assert.ok(!Policy.calmNow("off", hours, wed10))
  // Overnight hours run past midnight.
  const night = { start: "22:00", end: "06:00", days: [3] }
  assert.ok(Policy.inHours(new Date(2026, 10, 25, 23, 0), night))
  assert.ok(Policy.inHours(new Date(2026, 10, 26, 3, 0), night), "Thursday 3am belongs to Wednesday night")
  assert.ok(!Policy.inHours(new Date(2026, 10, 26, 23, 0), night))
  assert.ok(!Policy.inHours(wed10, { start: "bad", end: "17:00" }))
})

test("surprises: the first within two minutes, then every few; never the same visitor twice running; golden rare", () => {
  let seed = 7
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  const ctx = { mode: "snow", perches: 5, groundSnow: 3, groundCover: 0.6 }
  const first = Policy.planSurprise([], 0, ctx, rng, { first: true })
  assert.ok(first.delay >= 45000 && first.delay <= 90000, String(first.delay))
  // Nothing could come: look again soon, not in minutes.
  assert.strictEqual(Policy.planSurprise([{ kind: "bird", at: 0 }], 1000, ctx, rng, { missed: true }).delay, 15000)
  let history = [{ kind: "bird", at: 0 }], now = 0, repeats = 0
  const counts = { bird: 0, rabbit: 0, golden: 0 }
  for (let i = 0; i < 2000; i++) {
    const plan = Policy.planSurprise(history, now, ctx, rng)
    assert.ok(plan.delay >= 2 * 60000 && plan.delay <= 4.5 * 60000, String(plan.delay))
    now += plan.delay
    const kind = Policy.pickSurprise(history, now, ctx, rng)
    const last = history[history.length - 1].kind
    if ((kind === "bird" || kind === "rabbit") && last === kind) repeats++
    counts[kind]++
    history = Policy.remember(history, kind, now)
  }
  assert.strictEqual(repeats, 0, "never the same visitor twice running while the other can come")
  assert.ok(counts.golden > 0 && counts.golden / 2000 < 0.06, `golden ${counts.golden}`)
  assert.ok(counts.bird > 700 && counts.rabbit > 700, JSON.stringify(counts))
  assert.ok(history.length <= 8)
  // Only one can come: it may repeat.
  const birdOnly = Object.assign({}, ctx, { groundSnow: 0, groundCover: 0 })
  assert.strictEqual(Policy.pickSurprise([{ kind: "bird", at: 0 }], 1, birdOnly, () => 0.5), "bird")
  // Never two golden flakes within the gap.
  assert.strictEqual(Policy.surpriseWeights([{ kind: "golden", at: 1000 }], 1000 + 20 * 60000, ctx).golden, 0)
  // Nothing to land on and no snow on the ground: nothing comes.
  assert.strictEqual(Policy.pickSurprise([], 0, { mode: "rain", perches: 0 }, rng), "")
})

test("visitors follow the weather: the hare in snow or on a clear day with snow lying, the robin not in a blizzard, rain or strong wind", () => {
  const base = { perches: 4, groundSnow: 3, groundCover: 0.5, sprouts: 0 }
  const at = (kind, extra) => Policy.surpriseBlock(kind, Object.assign({}, base, extra))
  assert.strictEqual(at("rabbit", { mode: "snow" }), "")
  assert.strictEqual(at("rabbit", { mode: "flurries" }), "")
  assert.strictEqual(at("rabbit", { mode: "clear" }), "", "a clear day with snow lying")
  assert.ok(at("rabbit", { mode: "clear", groundSnow: 0, groundCover: 0 }), "a clear day needs snow on the ground too")
  for (const m of ["blizzard", "rain", "sleet", "leaves", "starfall", "sakura", "fireflies"])
    assert.ok(at("rabbit", { mode: m }), "no hare in " + m)
  assert.ok(at("rabbit", { mode: "snow", groundSnow: 0, groundCover: 0 }), "needs snow on the ground")
  assert.ok(at("rabbit", { mode: "snow", plow: true }), "not with the plow out")
  assert.ok(at("rabbit", { mode: "spring" }), "spring: not before the sprouts")
  assert.strictEqual(at("rabbit", { mode: "spring", sprouts: 12, groundSnow: 0, groundCover: 0 }), "", "spring: on the sprouts")
  assert.strictEqual(at("bird", { mode: "snow" }), "")
  assert.strictEqual(at("bird", { mode: "clear" }), "")
  assert.strictEqual(at("bird", { mode: "spring" }), "")
  for (const m of ["blizzard", "rain", "sleet", "leaves"]) assert.ok(at("bird", { mode: m }), "no robin in " + m)
  assert.ok(at("bird", { mode: "snow", windStrong: true }))
  assert.ok(at("bird", { mode: "snow", perches: 0 }))
  // Context gates, all of them.
  for (const g of [{ calm: true }, { fullscreen: true }, { dragging: true }, { decorating: true }, { surprises: false }, { lowPower: true }]) {
    assert.ok(at("bird", Object.assign({ mode: "snow" }, g)), JSON.stringify(g))
    assert.ok(at("rabbit", Object.assign({ mode: "snow" }, g)), JSON.stringify(g))
  }
  // The mode: the effect, then spring, then the live weather's kind.
  assert.strictEqual(Policy.sceneMode("rain", {}, "snow"), "rain")
  assert.strictEqual(Policy.sceneMode("snow", { spring: 0.8 }, "snow"), "spring")
  assert.strictEqual(Policy.sceneMode("snow", { spring: 0 }, ""), "snow", "no live weather: the calendar's snow")
  assert.strictEqual(Policy.sceneMode("snow", { spring: 0 }, "sleet"), "sleet")
  assert.strictEqual(Policy.surpriseAlias("cat"), "rabbit")
  assert.strictEqual(Policy.surpriseAlias(""), "")
  const W = load("lib/weather.js")
  const kind = c => W.map(Object.assign({ tempC: -3, precip: 0, snowfall: 0, windKmh: 5, windDir: 0, isDay: true }, c)).kind
  assert.strictEqual(kind({ snowfall: 1, precip: 1 }), "snow")
  assert.strictEqual(kind({ snowfall: 0.1, precip: 0.1 }), "flurries")
  assert.strictEqual(kind({ snowfall: 3, precip: 3 }), "blizzard")
  assert.strictEqual(kind({ snowfall: 1, windKmh: 55 }), "blizzard")
  assert.strictEqual(kind({ precip: 2, tempC: 6 }), "rain")
  assert.strictEqual(kind({ precip: 1, tempC: 0.5 }), "sleet")
  assert.strictEqual(kind({}), "clear")
})

