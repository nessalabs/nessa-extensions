import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { checkRepository } from "../check-architecture.mjs"

const script = fileURLToPath(new URL("../check-architecture.mjs", import.meta.url))

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

const manifest = (name, fields = {}) => JSON.stringify({ name, ...fields })

const twoExtensions = {
  "package.json": manifest("root"),
  "extensions/experiments/package.json": manifest("@nessalabs/experiments"),
  "extensions/notes/package.json": manifest("@nessalabs/notes"),
}

test("an empty repository passes", (t) => {
  assert.deepEqual(checkRepository(repository(t, { "README.md": "" })), [])
})

test("finds a relative path into another unit, deep in any file", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "packages/server-kit/package.json": manifest("@nessalabs/server-kit"),
    "extensions/experiments/app/views/run.tsx": `import { n } from "../../../notes/app/n"`,
    "extensions/experiments/app/index.html": `<script src="../../notes/app/x.js"></script>`,
    "extensions/experiments/app/view.svelte": `<script>import "../../../packages/server-kit/src"</script>`,
    "extensions/experiments/server/tsconfig.json": `{ "extends": "../../../tsconfig.json" }`,
    "extensions/notes/server/index.ts": `import { own } from "./own"`,
  })
  const rule = "reach another unit by package name, through its manifest"
  assert.deepEqual(checkRepository(root), [
    `extensions/experiments/app/index.html: "../../notes/app/x.js" reaches into extensions/notes; ${rule}`,
    `extensions/experiments/app/view.svelte: "../../../packages/server-kit/src" reaches into packages/server-kit; ${rule}`,
    `extensions/experiments/app/views/run.tsx: "../../../notes/app/n" reaches into extensions/notes; ${rule}`,
  ])
})

test("skips a binary file", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "extensions/experiments/app/icon.png": `\u0000"../../notes/x"`,
  })
  assert.deepEqual(checkRepository(root), [])
})

test("a symbolic link in or as a unit fails, and is not followed", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "extensions/notes/server/index.ts": `import "../../experiments/x"`,
  })
  symlinkSync(
    join(root, "extensions/notes/server"),
    join(root, "extensions/experiments/borrowed"),
  )
  symlinkSync(join(root, "extensions/notes"), join(root, "extensions/alias"))
  const rule = "a symbolic link in a unit can lead into another"
  assert.deepEqual(checkRepository(root), [
    `extensions/alias: ${rule}`,
    `extensions/experiments/borrowed: ${rule}`,
    `extensions/notes/server/index.ts: "../../experiments/x" reaches into extensions/experiments; reach another unit by package name, through its manifest`,
  ])
})

test("finds a dependency on an extension in any manifest", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "package.json": manifest("root", { devDependencies: { "@nessalabs/notes": "*" } }),
    "extensions/experiments/package.json": manifest("@nessalabs/experiments", {
      dependencies: { bee: "workspace:@nessalabs/notes@*" },
    }),
    "packages/server-kit/package.json": manifest("@nessalabs/server-kit", {
      dependencies: { "@nessalabs/experiments": "workspace:*" },
    }),
  })
  assert.deepEqual(checkRepository(root), [
    "package.json: devDependencies names extension @nessalabs/notes; nothing depends on an extension — share it through a package",
    "packages/server-kit/package.json: dependencies names extension @nessalabs/experiments; nothing depends on an extension — share it through a package",
    "extensions/experiments/package.json: dependencies names extension @nessalabs/notes; nothing depends on an extension — share it through a package",
  ])
})

test("skips installed and built files and dot-directories", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "extensions/experiments/node_modules/x/index.js": `require("../../../notes/x")`,
    "extensions/experiments/dist/app.js": `import "../../notes/x"`,
    "extensions/.cache/x.ts": `import "../notes/x"`,
  })
  assert.deepEqual(checkRepository(root), [])
})

test("an extension without a readable manifest naming it fails", (t) => {
  const root = repository(t, {
    "extensions/unnamed/server/index.ts": "",
    "extensions/nameless/package.json": JSON.stringify({ version: "0.0.0" }),
    "extensions/broken/package.json": "{bad",
  })
  assert.deepEqual(checkRepository(root).sort(), [
    "extensions/broken/package.json: is not valid JSON",
    "extensions/nameless/package.json: an extension's manifest names its package",
    "extensions/unnamed/package.json: an extension is one package and needs a manifest",
  ])
})

test("the command exits 1 with each failure on stderr, and 0 when clean", (t) => {
  const broken = repository(t, {
    ...twoExtensions,
    "extensions/experiments/server/index.ts": `import "../../notes/server"`,
  })
  const failed = spawnSync(process.execPath, [script, broken], { encoding: "utf8" })
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, "")
  assert.match(
    failed.stderr,
    /^extensions\/experiments\/server\/index\.ts: "\.\.\/\.\.\/notes\/server" reaches into extensions\/notes;/,
  )

  const clean = repository(t, twoExtensions)
  const passed = spawnSync(process.execPath, [script, clean], { encoding: "utf8" })
  assert.equal(passed.status, 0)
  assert.equal(passed.stderr, "")
})

test("the command still checks when run through a symlink", (t) => {
  const broken = repository(t, {
    ...twoExtensions,
    "extensions/experiments/server/index.ts": `import "../../notes/server"`,
  })
  const link = join(broken, "linked-check.mjs")
  symlinkSync(script, link)
  const result = spawnSync(process.execPath, [link, broken], { encoding: "utf8" })
  assert.equal(result.status, 1)
})
