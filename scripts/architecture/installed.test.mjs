import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { installedViolations } from "./installed.mjs"

const script = fileURLToPath(new URL("../check-installed.mjs", import.meta.url))
const rule = "nothing depends on an extension"

/**
 * An installed workspace on disk: `files` written, then `links` made, each
 * `[link, target]` relative to the root — the shapes pnpm leaves, built by
 * hand. That pnpm really leaves them is shown by running the check on real
 * installs, recorded in the pull request that added it.
 */
function workspace(t, files, links = []) {
  const root = mkdtempSync(join(tmpdir(), "nessa-extensions-installed-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const base = {
    "node_modules/.modules.yaml": "",
    "extensions/notes/package.json": JSON.stringify({ name: "@nessalabs/notes" }),
    "extensions/notes/lib/package.json": JSON.stringify({ name: "notes-lib" }),
    "extensions/experiments/package.json": JSON.stringify({ name: "@nessalabs/exp" }),
    "packages/server-kit/package.json": JSON.stringify({ name: "@nessalabs/server-kit" }),
    "packages/app-shell/package.json": JSON.stringify({ name: "@nessalabs/app-shell" }),
  }
  for (const [path, text] of Object.entries({ ...base, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  for (const [link, target] of links) {
    mkdirSync(dirname(join(root, link)), { recursive: true })
    symlinkSync(join(root, target), join(root, link))
  }
  return root
}

test("links to packages and libraries pass", (t) => {
  const root = workspace(
    t,
    {
      "node_modules/.pnpm/zod@4.0.0/node_modules/zod/package.json": `{"name":"zod"}`,
    },
    [
      ["extensions/notes/node_modules/@nessalabs/server-kit", "packages/server-kit"],
      [
        "extensions/notes/node_modules/zod",
        "node_modules/.pnpm/zod@4.0.0/node_modules/zod",
      ],
      ["packages/app-shell/node_modules/@nessalabs/server-kit", "packages/server-kit"],
    ],
  )
  assert.deepEqual(installedViolations(root), [])
})

test("an extension may link to its own files", (t) => {
  const root = workspace(t, {}, [
    ["extensions/notes/node_modules/notes-lib", "extensions/notes/lib"],
  ])
  assert.deepEqual(installedViolations(root), [])
})

test("a link into an extension fails, wherever it is installed", (t) => {
  const root = workspace(
    t,
    {
      "node_modules/.pnpm/globals@17.0.0/node_modules/globals/package.json": `{"name":"globals"}`,
      "extensions/notes/server/index.ts": "",
    },
    [
      ["node_modules/bee", "extensions/notes"],
      ["packages/app-shell/node_modules/@nessalabs/notes", "extensions/notes"],
      ["extensions/experiments/node_modules/n", "extensions/notes/server"],
      ["node_modules/.pnpm/globals@17.0.0/node_modules/ea", "extensions/notes"],
    ],
  )
  assert.deepEqual(installedViolations(root), [
    `node_modules/bee: resolves into extensions/notes; ${rule}`,
    `packages/app-shell/node_modules/@nessalabs/notes: resolves into extensions/notes; ${rule}`,
    `extensions/experiments/node_modules/n: resolves into extensions/notes; ${rule}`,
    `node_modules/.pnpm/globals@17.0.0/node_modules/ea: resolves into extensions/notes; ${rule}`,
  ])
})

test("a copy of a package from an extension fails where it is linked, not in the store", (t) => {
  const copy =
    "node_modules/.pnpm/@nessalabs+notes@file+extensions+notes/node_modules/@nessalabs/notes"
  const libCopy =
    "node_modules/.pnpm/notes-lib@file+extensions+notes+lib/node_modules/notes-lib"
  const root = workspace(
    t,
    {
      [`${copy}/package.json`]: `{"name":"@nessalabs/notes"}`,
      [`${libCopy}/package.json`]: `{"name":"notes-lib"}`,
    },
    [
      ["packages/app-shell/node_modules/@nessalabs/notes", copy],
      ["extensions/experiments/node_modules/lib", libCopy],
    ],
  )
  assert.deepEqual(installedViolations(root), [
    `packages/app-shell/node_modules/@nessalabs/notes: is @nessalabs/notes, a package in extensions/notes; ${rule}`,
    `extensions/experiments/node_modules/lib: is notes-lib, a package in extensions/notes; ${rule}`,
  ])
})

test("a package copied into the root, as a hoisted install does, fails", (t) => {
  const root = workspace(t, {
    "node_modules/@nessalabs/notes/package.json": `{"name":"@nessalabs/notes"}`,
  })
  assert.deepEqual(installedViolations(root), [
    `node_modules/@nessalabs/notes: is @nessalabs/notes, a package in extensions/notes; ${rule}`,
  ])
})

test("pnpm's hidden hoist of every workspace project is not a dependency", (t) => {
  const root = workspace(t, {}, [
    ["node_modules/.pnpm/node_modules/@nessalabs/notes", "extensions/notes"],
  ])
  assert.deepEqual(installedViolations(root), [])
})

test("a broken link installs nothing", (t) => {
  const root = workspace(t, {}, [["node_modules/gone", "extensions/notes/missing"]])
  assert.deepEqual(installedViolations(root), [])
})

test("without an install the check fails", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nessa-extensions-installed-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(installedViolations(root), [
    "node_modules: is missing; run pnpm install before this check",
  ])
})

test("the command exits 1 with each failure on stderr, and 0 when clean", (t) => {
  const broken = workspace(t, {}, [["node_modules/bee", "extensions/notes"]])
  const failed = spawnSync(process.execPath, [script, broken], { encoding: "utf8" })
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, "")
  assert.equal(
    failed.stderr,
    `node_modules/bee: resolves into extensions/notes; ${rule}\n`,
  )

  const clean = workspace(t, {})
  const passed = spawnSync(process.execPath, [script, clean], { encoding: "utf8" })
  assert.equal(passed.status, 0)
  assert.equal(passed.stderr, "")
})
