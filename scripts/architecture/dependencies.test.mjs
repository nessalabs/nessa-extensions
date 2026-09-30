import assert from "node:assert/strict"
import { test } from "node:test"

import { relativePathViolations, relativePaths, unitOf } from "./dependencies.mjs"

test("finds every quoted relative path, however it is used", () => {
  const text = [
    `import { a } from "./a"`,
    `import type { B } from '../b'`,
    `import {\n  c,\n} from "./c"`,
    `import "./side-effect"`,
    `export { "d-e" as f } from "./d"`,
    `const g = await import("./g.json", { with: { type: "json" } })`,
    "const h = await import(`./h`)",
    `const i = require("./i")`,
    `const j = new URL("../j/index.html", import.meta.url)`,
    `<script src="./k.js"></script>`,
    `@import "../l.css";`,
  ].join("\n")
  assert.deepEqual(relativePaths(text).sort(), [
    "../b",
    "../j/index.html",
    "../l.css",
    "./a",
    "./c",
    "./d",
    "./g.json",
    "./h",
    "./i",
    "./k.js",
    "./side-effect",
  ])
})

test("a path built at run time or a bare name is not a relative path", () => {
  const text = [
    "const a = await import(`./${name}`)",
    `import { b } from "@nessalabs/server-kit"`,
    `const c = "a./b"`,
  ].join("\n")
  assert.deepEqual(relativePaths(text), [])
})

test("names the unit a path is in", () => {
  assert.equal(unitOf("extensions/notes/server/index.ts"), "extensions/notes")
  assert.equal(unitOf("packages/app-shell/src/index.ts"), "packages/app-shell")
  assert.equal(unitOf("scripts/check-architecture.mjs"), null)
  assert.equal(unitOf("extensions/README.md"), null)
  assert.equal(unitOf("packages/stray.ts"), null)
})

const units = new Set([
  "extensions/experiments",
  "extensions/notes",
  "packages/app-shell",
  "packages/server-kit",
])
const reaches = (path, text) => relativePathViolations(path, text, units)

test("a relative path inside its own extension or package passes", () => {
  const text = [`import { model } from "../model/experiment"`, `import "./x"`].join("\n")
  assert.deepEqual(reaches("extensions/experiments/server/i.ts", text), [])
  assert.deepEqual(reaches("packages/app-shell/src/a/i.ts", text), [])
})

test("a relative path into another extension fails, whatever uses it", () => {
  for (const line of [
    `import { note } from "../../notes/app/note"`,
    `import { note } from "../../notes"`,
    `export { "a-b" as c } from "../../notes/server"`,
    `const n = await import("../../notes/n.json", { with: { type: "json" } })`,
    `const html = new URL("../../notes/app/index.html", import.meta.url)`,
    `"paths": { "n/*": ["../../notes/server/*"] }`,
  ]) {
    const violations = reaches("extensions/experiments/app/view.ts", line)
    assert.equal(violations.length, 1, line)
    assert.match(violations[0], /reaches into extensions\/notes; reach another unit by/)
  }
})

test("a relative path from a package into an extension or another package fails", () => {
  for (const [line, reached] of [
    [
      `import { view } from "../../../extensions/experiments/app/view"`,
      "extensions/experiments",
    ],
    [`import { x } from "../../server-kit/src"`, "packages/server-kit"],
  ]) {
    const violations = reaches("packages/app-shell/src/index.ts", line)
    assert.equal(violations.length, 1, line)
    assert.match(violations[0], new RegExp(`reaches into ${reached};`))
  }
})

test("a relative path out of its unit to somewhere that is no unit passes", () => {
  for (const [path, line] of [
    // Vite resolves `outDir` against its `root`, not against this file.
    ["extensions/experiments/vite.config.ts", `build: { outDir: "../dist/app" }`],
    ["extensions/experiments/tsconfig.json", `"extends": "../../tsconfig.json"`],
    ["extensions/experiments/server/paths.ts", `if (p.startsWith("../")) throw e`],
  ]) {
    assert.deepEqual(reaches(path, line), [], line)
  }
})

test("a path that leaves and comes back into its own unit passes", () => {
  assert.deepEqual(
    reaches("extensions/notes/server/index.ts", `import "../../notes/app/x"`),
    [],
  )
})

test("files outside extensions and packages are not held to it", () => {
  assert.deepEqual(reaches("scripts/tool.mjs", `import "../extensions/notes/server"`), [])
})
