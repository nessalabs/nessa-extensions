import assert from "node:assert/strict"
import { test } from "node:test"

import { relativePathViolations, relativePaths, unitOf } from "./dependencies.mjs"

test("finds every relative path, however it is written", () => {
  const text = [
    `import { a } from "./a"`,
    `import type { B } from '../b'`,
    `import {\n  c,\n} from "./c"`,
    `export { "d-e" as f } from "./d"`,
    `const g = await import("./g.json", { with: { type: "json" } })`,
    "const h = await import(`./h`)",
    `const i = require("./i")`,
    `const j = new URL("../j/index.html", import.meta.url)`,
    `<script src=./k.js></script>`,
    `@import url(../l.css);`,
    `"directory": "src/../../m"`,
    `import { n } from "../n/$n.ts"`,
  ].join("\n")
  assert.deepEqual(relativePaths(text).sort(), [
    "../b",
    "../j/index.html",
    "../l.css",
    "../n/$n.ts",
    "./a",
    "./c",
    "./d",
    "./g.json",
    "./h",
    "./i",
    "./k.js",
    "src/../../m",
  ])
})

test("nothing around a path hides it: quotes, comments, splitting characters, escapes", () => {
  for (const [line, found] of [
    [`import { b } from /* " */ "../../b/src/index.ts"`, "../../b/src/index.ts"],
    [`const q = "'"; import "../../b"`, "../../b"],
    [`import { s } from "./x(/../../b/index.js"`, "/../../b/index.js"],
    [`import { s } from "./ /../../b/index.js"`, "/../../b/index.js"],
    [`import { s } from "./%2e%2e/b/index.js"`, "./../b/index.js"],
    [`import { s } from "./.%2E/b/index.js"`, "./../b/index.js"],
    [String.raw`import { s } from "..\x2fb\x2findex.js"`, "../b/index.js"],
    [String.raw`import { s } from "../b/index.js"`, "../b/index.js"],
    [String.raw`import { s } from "..\u{2f}b/index.js"`, "../b/index.js"],
    [String.raw`import { s } from "..\/b/index.js"`, "../b/index.js"],
    [String.raw`import { s } from "\.\./b/index.js"`, "../b/index.js"],
  ]) {
    assert.ok(relativePaths(line).includes(found), `${line} → ${relativePaths(line)}`)
  }
})

test("text that is not a relative path is not one", () => {
  const text = [
    `const a = "Loading..."`,
    `const b = "a..b/c"`,
    `import { c } from "@nessalabs/server-kit"`,
    `const d = /(^|[/])[.][.]([/]|$)/`,
    `const e = "1..10"`,
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

const leads = relativePathViolations

test("a path inside its own unit, or to the shared tsconfig.json, passes", () => {
  const text = [`import { model } from "../model/experiment"`, `import "./x"`].join("\n")
  assert.deepEqual(leads("extensions/experiments/server/i.ts", text), [])
  assert.deepEqual(leads("packages/app-shell/src/a/i.ts", text), [])
  assert.deepEqual(
    leads("extensions/notes/server/i.ts", `import "../../notes/app/x"`),
    [],
  )
  assert.deepEqual(leads("extensions/notes/server/paths.ts", `p.startsWith("../")`), [])
  assert.deepEqual(
    leads("extensions/notes/tsconfig.json", `"extends": "../../tsconfig.json"`),
    [],
  )
})

test("a Markdown file in a unit is documentation, not read", () => {
  assert.deepEqual(
    leads("packages/app-shell/README.md", `[record](../../docs/adr/todo/1-x.md)`),
    [],
  )
})

test("a path anywhere else fails, one by one", () => {
  const rule =
    "a path stays in extensions/experiments — reach another unit by package name"
  for (const [line, why] of [
    [`import { n } from "../../notes/app/note"`, "leads to extensions/notes/app/note"],
    [`import { n } from "../../notes"`, "leads to extensions/notes"],
    [
      `import { x } from "../../../packages/server-kit/src"`,
      "leads to packages/server-kit/src",
    ],
    [
      `import { b } from "../../../node_modules/.pnpm/node_modules/@nessalabs/notes/src/index.ts"`,
      "leads to node_modules/.pnpm/node_modules/@nessalabs/notes/src/index.ts",
    ],
    [`import "../../../scripts/tool.mjs"`, "leads to scripts/tool.mjs"],
    [`import "../../../relay.js"`, "leads to relay.js"],
    [`import "../../../docs/b/index.js"`, "leads to docs/b/index.js"],
    [`import "../../../README.md"`, "leads to README.md"],
    [
      `import "../../../../nessa-extensions/extensions/notes/x"`,
      "leads to outside the repository",
    ],
    [
      `const u = new URL("src/../../../notes/x", import.meta.url)`,
      "leads to extensions/notes/x",
    ],
    [`build: { outDir: "../../dist/app" }`, "leads to extensions/dist/app"],
    [`alias: { "@peer": "../.." }`, "leads to extensions"],
    [`import { s } from "./x(/../../b/index.js"`, "is absolute and climbs"],
    [
      `readFileSync("./node_modules/@nessalabs/server-kit/../../extensions/b/lib.ts")`,
      "climbs out of node_modules, which pnpm links elsewhere",
    ],
  ]) {
    const violations = leads("extensions/experiments/app/view.ts", line)
    assert.equal(violations.length, 1, `${line} → ${violations}`)
    assert.ok(violations[0].endsWith(`${why}; ${rule}`), violations[0])
  }
})

test("files outside extensions and packages are not held to it", () => {
  assert.deepEqual(leads("scripts/tool.mjs", `import "../extensions/notes/server"`), [])
})
