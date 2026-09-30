import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { checkRepository } from "../check-architecture.mjs"

/** A repository on disk made of `files`, removed when the test ends. */
function repository(t, files) {
  const root = mkdtempSync(join(tmpdir(), "nessa-extensions-architecture-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const manifest = (name) => JSON.stringify({ name })

test("an empty repository passes", (t) => {
  assert.deepEqual(checkRepository(repository(t, { "README.md": "" })), [])
})

test("finds a violation deep in an extension, by path and by name", (t) => {
  const root = repository(t, {
    "extensions/experiments/package.json": manifest("@nessalabs/experiments"),
    "extensions/notes/package.json": manifest("@nessalabs/notes"),
    "extensions/experiments/app/views/run.tsx": `import { n } from "../../../notes/app/n"`,
    "extensions/experiments/server/tools.ts": `import { n } from "@nessalabs/notes"`,
    "extensions/notes/server/index.ts": `import { own } from "./own"`,
  })
  assert.deepEqual(checkRepository(root), [
    `extensions/experiments/app/views/run.tsx: imports "../../../notes/app/n" from extension notes; an extension never imports another extension — share it through a package`,
    `extensions/experiments/server/tools.ts: imports "@nessalabs/notes" from extension notes; an extension never imports another extension — share it through a package`,
  ])
})

test("finds a package importing an extension", (t) => {
  const root = repository(t, {
    "extensions/notes/package.json": manifest("@nessalabs/notes"),
    "packages/server-kit/src/index.ts": `export * from "@nessalabs/notes/server"`,
  })
  assert.deepEqual(checkRepository(root), [
    `packages/server-kit/src/index.ts: imports "@nessalabs/notes/server" from extension notes; a package never imports an extension`,
  ])
})

test("skips installed and built files", (t) => {
  const root = repository(t, {
    "extensions/notes/package.json": manifest("@nessalabs/notes"),
    "extensions/experiments/package.json": manifest("@nessalabs/experiments"),
    "extensions/experiments/node_modules/x/index.js": `require("@nessalabs/notes")`,
    "extensions/experiments/dist/app.js": `import "@nessalabs/notes"`,
  })
  assert.deepEqual(checkRepository(root), [])
})

test("an extension without a manifest naming it fails", (t) => {
  const root = repository(t, {
    "extensions/unnamed/server/index.ts": "",
    "extensions/nameless/package.json": JSON.stringify({ version: "0.0.0" }),
  })
  assert.deepEqual(checkRepository(root).sort(), [
    "extensions/nameless/package.json: an extension's manifest names its package",
    "extensions/unnamed/package.json: an extension is one package and needs a manifest",
  ])
})
