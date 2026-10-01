import assert from "node:assert/strict"
import { test } from "node:test"

import path from "node:path"

import { moduleRefusal, repositoryPath } from "./allow-list.mjs"

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
    "which is in extensions/notes-extra; nothing imports an extension",
  )
  assert.equal(
    refusal("packages/common-ui/x.ts"),
    "which is in packages/common-ui, and extensions/notes does not declare it",
  )
})

test("a node_modules directory inside another unit is still that unit's", () => {
  assert.equal(
    refusal("extensions/experiments/src/node_modules/leak.ts"),
    "which is in extensions/experiments; nothing imports an extension",
  )
  assert.equal(
    refusal("packages/app-shell/node_modules/x/index.js"),
    "which is in packages/app-shell, and extensions/notes does not declare it",
  )
})

test("everything else is refused, saying where it is", () => {
  assert.equal(
    refusal("extensions/experiments/x.ts"),
    "which is in extensions/experiments; nothing imports an extension",
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

test("only the root's node_modules is pnpm's; any other in the repository is the repository's", () => {
  assert.equal(
    refusal("vendor/node_modules/evil/index.ts"),
    "which is outside every extension and package",
  )
  assert.equal(refusal("../elsewhere/lib/index.js"), "which is outside the repository")
})

test("a path is taken relative to the repository, and another drive is outside it", () => {
  assert.equal(
    repositoryPath("/repo", "/repo/extensions/notes/x.ts", path.posix),
    "extensions/notes/x.ts",
  )
  assert.equal(
    repositoryPath("/repo", "/elsewhere/x.ts", path.posix),
    "../elsewhere/x.ts",
  )
  assert.equal(
    repositoryPath("C:\\repo", "C:\\repo\\extensions\\notes\\x.ts", path.win32),
    "extensions/notes/x.ts",
  )
  const other = repositoryPath("C:\\repo", "D:\\node_modules\\vite\\x.js", path.win32)
  assert.equal(other, "../D:/node_modules/vite/x.js")
  assert.equal(moduleRefusal(other, unit, declared), null)
  assert.equal(
    moduleRefusal(
      repositoryPath("C:\\repo", "D:\\secret.ts", path.win32),
      unit,
      declared,
    ),
    "which is outside the repository",
  )
})

test("a store entry pnpm installed from a local path is not npm", () => {
  const why = "which pnpm installed from a path in the repository, not from npm"
  assert.equal(
    refusal("node_modules/.pnpm/secret@file+extensions+b/node_modules/secret/index.js"),
    why,
  )
  assert.equal(
    refusal("node_modules/.pnpm/secret@link+extensions+b/node_modules/secret/index.js"),
    why,
  )
  // A version that merely contains the words is still npm.
  assert.equal(
    refusal("node_modules/.pnpm/file-type@19.0.0/node_modules/file-type/index.js"),
    null,
  )
})
