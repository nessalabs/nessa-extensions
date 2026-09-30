import assert from "node:assert/strict"
import { test } from "node:test"

import { importSpecifiers, importViolations, owner } from "./imports.mjs"

const extensions = new Map([
  ["experiments", "@nessalabs/experiments"],
  ["notes", "@nessalabs/notes"],
])

const check = (path, text) => importViolations(path, text, extensions)

test("finds every way a module is imported", () => {
  const text = [
    `import { a } from "./a"`,
    `import type { B } from "./b"`,
    `import {\n  c,\n  d,\n} from "./cd"`,
    `import "./side-effect"`,
    `export * from "./reexport"`,
    `export { e } from "./e"`,
    `const f = await import("./f")`,
    `const g = require("./g")`,
  ].join("\n")
  assert.deepEqual(importSpecifiers(text).sort(), [
    "./a",
    "./b",
    "./cd",
    "./e",
    "./f",
    "./g",
    "./reexport",
    "./side-effect",
  ])
})

test("names the part of the repository a path belongs to", () => {
  assert.deepEqual(owner("extensions/notes/server/index.ts"), {
    kind: "extension",
    name: "notes",
  })
  assert.deepEqual(owner("packages/app-shell/src/index.ts"), {
    kind: "package",
    name: "app-shell",
  })
  assert.deepEqual(owner("scripts/check-architecture.mjs"), { kind: "other" })
  assert.deepEqual(owner("extensions/README.md"), { kind: "other" })
  assert.deepEqual(owner("packages/stray.ts"), { kind: "other" })
})

test("an extension may import its own files, packages, and libraries", () => {
  const text = [
    `import { model } from "../model/experiment"`,
    `import { serve } from "@nessalabs/server-kit"`,
    `import { z } from "zod"`,
    `import { own } from "@nessalabs/experiments/model"`,
  ].join("\n")
  assert.deepEqual(check("extensions/experiments/server/index.ts", text), [])
})

test("an extension may not import another extension by path", () => {
  for (const specifier of ["../../notes/app/note", "../../notes"]) {
    const violations = check(
      "extensions/experiments/app/view.ts",
      `import { note } from "${specifier}"`,
    )
    assert.equal(violations.length, 1, specifier)
    assert.match(violations[0], /extension notes; an extension never imports another/)
  }
})

test("an extension may not import another extension by package name", () => {
  for (const specifier of ["@nessalabs/notes", "@nessalabs/notes/server/tools"]) {
    const violations = check(
      "extensions/experiments/server/index.ts",
      `export { x } from "${specifier}"`,
    )
    assert.equal(violations.length, 1, specifier)
    assert.match(violations[0], /extension notes/)
  }
})

test("a package name that only starts like an extension's is not that extension", () => {
  assert.deepEqual(
    check("extensions/experiments/server/index.ts", `import "@nessalabs/notes-kit"`),
    [],
  )
})

test("a package may not import any extension", () => {
  const byPath = check(
    "packages/app-shell/src/index.ts",
    `import { view } from "../../../extensions/experiments/app/view"`,
  )
  const byName = check(
    "packages/server-kit/src/index.ts",
    `const m = await import("@nessalabs/experiments")`,
  )
  for (const violations of [byPath, byName]) {
    assert.equal(violations.length, 1)
    assert.match(violations[0], /extension experiments; a package never imports/)
  }
})

test("a package may import another package", () => {
  assert.deepEqual(
    check("packages/app-shell/src/index.ts", `import { x } from "../../server-kit/src"`),
    [],
  )
})

test("files outside packages and extensions are not held to these rules", () => {
  assert.deepEqual(
    check("scripts/tool.mjs", `import { x } from "../extensions/notes/server"`),
    [],
  )
})
