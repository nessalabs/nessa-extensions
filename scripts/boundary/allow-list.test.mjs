import assert from "node:assert/strict"
import { test } from "node:test"

import { moduleRefusal } from "./allow-list.mjs"

const unit = "extensions/notes"
const declared = new Set(["packages/common"])
const refusal = (path) => moduleRefusal(path, unit, declared)

test("its own folder, a declared package, and an npm package are allowed", () => {
  assert.equal(refusal("extensions/notes/app/index.html"), null)
  assert.equal(refusal("extensions/notes/node_modules/x/index.js"), null)
  assert.equal(refusal("packages/common/src/index.ts"), null)
  assert.equal(refusal("node_modules/.pnpm/zod@4.0.0/node_modules/zod/index.js"), null)
  assert.equal(refusal("../elsewhere/node_modules/vite/dist/client.mjs"), null)
})

test("a folder whose name only begins with an allowed one is refused", () => {
  assert.equal(
    refusal("extensions/notes-extra/x.ts"),
    "which is in extensions/notes-extra; extensions never import one another",
  )
  assert.equal(
    refusal("packages/common-ui/x.ts"),
    "which is in packages/common-ui, and extensions/notes does not declare it",
  )
})

test("a node_modules directory inside another unit is still that unit's", () => {
  assert.equal(
    refusal("extensions/experiments/src/node_modules/leak.ts"),
    "which is in extensions/experiments; extensions never import one another",
  )
  assert.equal(
    refusal("packages/app-shell/node_modules/x/index.js"),
    "which is in packages/app-shell, and extensions/notes does not declare it",
  )
})

test("everything else is refused, saying where it is", () => {
  assert.equal(
    refusal("extensions/experiments/x.ts"),
    "which is in extensions/experiments; extensions never import one another",
  )
  assert.equal(
    refusal("packages/app-shell/src/index.ts"),
    "which is in packages/app-shell, and extensions/notes does not declare it",
  )
  assert.equal(refusal("scripts/x.mjs"), "which is outside every extension and package")
  assert.equal(
    refusal("extensions/README.md"),
    "which is outside every extension and package",
  )
  assert.equal(refusal("../secret.ts"), "which is outside the repository")
})
