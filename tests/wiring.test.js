// The QML side reaches every library function it calls: each `Lib.name`
// used in a .qml file is imported there (import "lib/x.js" as Lib) and is a
// top-level function or var of that library (a missing one is undefined in
// QML and throws only when that path runs live, e.g. a surprise or `diag`).
// Also: every IPC function bin/flurry calls exists on the ShellIpc target.
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")
const load = require("./load")
const root = path.join(__dirname, "..")

test("every library call in the QML is imported and defined", () => {
  const libs = {}
  for (const f of fs.readdirSync(path.join(root, "lib"))) libs[f] = load("lib/" + f)
  let checked = 0
  for (const q of fs.readdirSync(root).filter(f => f.endsWith(".qml"))) {
    // Comments out (whole-line and trailing), so only code is checked.
    const src = fs.readFileSync(path.join(root, q), "utf8").split("\n").map(l => l.replace(/(^|\s)\/\/ .*$/, "")).join("\n")
    const imports = {}
    for (const m of src.matchAll(/^import "lib\/(\w+\.js)" as (\w+)/mg)) imports[m[2]] = m[1]
    for (const m of src.matchAll(/\b(Sim|Draw|Policy|Store|Season|Weather|Theme|Snd)\.([A-Za-z_]\w*)/g)) {
      assert.ok(imports[m[1]], `${q} uses ${m[1]}.${m[2]} without importing ${m[1]}`)
      assert.ok(m[2] in libs[imports[m[1]]], `${q}: ${m[1]}.${m[2]} is not defined in lib/${imports[m[1]]}`)
      checked++
    }
  }
  assert.ok(checked > 100, String(checked))
})

test("every bin/flurry command reaches a ShellIpc function", () => {
  const svc = fs.readFileSync(path.join(root, "Service.qml"), "utf8")
  const ipc = svc.slice(svc.indexOf("ShellIpc {"))
  const fns = new Set([...ipc.matchAll(/function (\w+)\(/g)].map(m => m[1]))
  const bin = fs.readFileSync(path.join(root, "bin/flurry"), "utf8")
  const called = new Set()
  for (const m of bin.matchAll(/call (\w+)/g)) called.add(m[1])
  for (const m of bin.matchAll(/^\s*([\w|]+)\) call "\$cmd"/mg)) m[1].split("|").forEach(c => called.add(c))
  called.delete("cmd")
  for (const c of called) assert.ok(fns.has(c), "no IPC function " + c)
  for (const c of ["plow", "diag", "freeze", "surprise"]) assert.ok(called.has(c), c)
})

test("no QML object sets a handler, property or function twice (a load error that takes the whole plugin down)", () => {
  for (const q of fs.readdirSync(root).filter(f => f.endsWith(".qml"))) {
    const lines = fs.readFileSync(path.join(root, q), "utf8").split("\n")
    const stack = [{}]
    for (const l of lines) {
      const stripped = l.replace(/\/\/.*$/, "")
      const indent = /^(\s*)/.exec(l)[1]
      const depth = stack.length
      if (depth > 0) {
        const m = /^\s*(?:(on[A-Z]\w*):|(?:readonly |required )?property \S+ (\w+)|function (\w+)\()/.exec(stripped)
        if (m && !/\{.*\}/.test(stripped)) {
          const key = m[1] || m[2] || m[3]
          const top = stack[stack.length - 1]
          assert.ok(!top[key], `${q}: ${key} is declared twice in the same block (indent ${indent.length})`)
          top[key] = true
        }
      }
      for (const ch of stripped) {
        if (ch === "{") stack.push({})
        else if (ch === "}" && stack.length > 1) stack.pop()
      }
    }
  }
})

test("every string the panel reads has an English entry, and each catalog has the same keys", () => {
  const dir = path.join(root, "i18n")
  const en = JSON.parse(fs.readFileSync(path.join(dir, "en.json"), "utf8"))
  for (const f of fs.readdirSync(dir)) {
    const cat = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
    assert.deepStrictEqual(Object.keys(cat).sort(), Object.keys(en).sort(), f)
    for (const k in cat) assert.strictEqual((cat[k].match(/%1/g) || []).length, (en[k].match(/%1/g) || []).length, `${f}: ${k} placeholders`)
  }
  for (const q of fs.readdirSync(root).filter(f => f.endsWith(".qml"))) {
    const src = fs.readFileSync(path.join(root, q), "utf8")
    for (const m of src.matchAll(/(?:strings\.t|tr|labelFor)\("([^"]+)"[,)]/g)) assert.ok(m[1] in en, `${q}: no English string ${m[1]}`)
  }
  const src = fs.readFileSync(path.join(root, "Widget.qml"), "utf8")
  for (const e of ["snow", "leaves", "starfall", "rain", "sakura", "fireflies"]) assert.ok("effect." + e in en, e)
  for (const m of src.matchAll(/flag: "(\w+)"/g)) assert.ok("flag." + m[1] in en && "flag." + m[1] + ".desc" in en, m[1])
})
