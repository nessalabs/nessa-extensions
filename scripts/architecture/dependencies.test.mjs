import assert from "node:assert/strict"
import { test } from "node:test"

import { relativePathViolations, relativePaths, unitOf } from "./dependencies.mjs"

test("finds every relative path, however it is written", () => {
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
    "./side-effect",
    "src/../../m",
  ])
})

test("a quote in a comment or another string cannot hide a path", () => {
  assert.deepEqual(relativePaths(`import { b } from /* " */ "../../b/src/index.ts"`), [
    "../../b/src/index.ts",
  ])
  assert.deepEqual(relativePaths(`const q = "'"; import "../../b"`), ["../../b"])
})

test("text that is not a relative path is not one", () => {
  const text = [
    `const a = "Loading..."`,
    `const b = "a..b/c"`,
    `import { c } from "@nessalabs/server-kit"`,
    `const d = "/abs/../path"`,
    `// see https://example.com/a/../b`,
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

const rootFiles = new Set(["tsconfig.json", "package.json", "README.md"])
const leads = (path, text) => relativePathViolations(path, text, rootFiles)

test("a path inside its own unit passes", () => {
  const text = [`import { model } from "../model/experiment"`, `import "./x"`].join("\n")
  assert.deepEqual(leads("extensions/experiments/server/i.ts", text), [])
  assert.deepEqual(leads("packages/app-shell/src/a/i.ts", text), [])
  assert.deepEqual(
    leads("extensions/notes/server/i.ts", `import "../../notes/app/x"`),
    [],
  )
})

test("a path to a root file, to docs/, or to a directory above passes", () => {
  for (const [path, line] of [
    ["extensions/experiments/tsconfig.json", `"extends": "../../tsconfig.json"`],
    [
      "packages/app-shell/README.md",
      `[record](../../docs/adr/todo/1-extensions-repo.md)`,
    ],
    ["extensions/experiments/server/paths.ts", `if (p.startsWith("../")) throw e`],
    ["extensions/experiments/server/paths.ts", `const up = "../../../"`],
  ]) {
    assert.deepEqual(leads(path, line), [], line)
  }
})

test("a path anywhere else fails, one by one", () => {
  const rule = "a path leaves extensions/experiments only for a root file or docs/"
  for (const [line, reached] of [
    [`import { n } from "../../notes/app/note"`, "extensions/notes/app/note"],
    [`import { n } from "../../notes"`, "extensions/notes"],
    [`import { x } from "../../../packages/server-kit/src"`, "packages/server-kit/src"],
    [
      `import { b } from "../../../node_modules/.pnpm/node_modules/@nessalabs/notes/src/index.ts"`,
      "node_modules/.pnpm/node_modules/@nessalabs/notes/src/index.ts",
    ],
    [`import "../../../scripts/tool.mjs"`, "scripts/tool.mjs"],
    [
      `import "../../../../nessa-extensions/extensions/notes/x"`,
      "outside the repository",
    ],
    [`const u = new URL("src/../../../notes/x", import.meta.url)`, "extensions/notes/x"],
    [`build: { outDir: "../../dist/app" }`, "extensions/dist/app"],
    [`import "../../../node_modules"`, "node_modules"],
  ]) {
    const violations = leads("extensions/experiments/app/view.ts", line)
    assert.equal(violations.length, 1, line)
    assert.ok(violations[0].includes(`leads to ${reached}; ${rule}`), violations[0])
  }
})

test("files outside extensions and packages are not held to it", () => {
  assert.deepEqual(leads("scripts/tool.mjs", `import "../extensions/notes/server"`), [])
})
