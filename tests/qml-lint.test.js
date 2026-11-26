// QML hygiene the shell's own qmllint asks for: animation durations go
// through Style.duration() (so the user's animation setting applies), and a
// file with delegates is ComponentBehavior: Bound with every delegate's
// model data reached through the delegate's id.
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")
const root = path.join(__dirname, "..")
const files = fs.readdirSync(root).filter(f => f.endsWith(".qml"))
const read = f => fs.readFileSync(path.join(root, f), "utf8")

test("every animation duration goes through Style.duration()", () => {
  for (const f of files) {
    for (const [i, line] of read(f).split("\n").entries()) {
      const m = line.match(/\bduration:\s*([^;}\n]+)/)
      if (m) assert.match(m[1], /^Style\.duration\(/, f + ":" + (i + 1) + " " + line.trim())
    }
  }
  assert.match(read("Decoration.qml"), /^import qs\.Commons$/m)
})

test("files with delegates bind their components, and nested items use the delegate's id for its model data", () => {
  for (const f of files) {
    const src = read(f)
    if (!/\bdelegate:/.test(src)) continue
    if (f === "SceneWindow.qml") continue   // its one delegate (Decoration) reads only its own `key`
    assert.match(src, /^pragma ComponentBehavior: Bound$/m, f)
  }
  // The friends list: the row's children reach modelData through friendItem.
  const w = read("Widget.qml")
  const row = w.slice(w.indexOf("id: friendItem"), w.indexOf("id: noteField"))
  assert.doesNotMatch(row.replace(/friendItem\.modelData/g, ""), /(^|[^.\w])modelData\./, "unqualified modelData in the friends row")
  assert.doesNotMatch(w, /onAccepted: \{[^}]*[^.\w]text\.trim\(\)/, "text fields name themselves")
})
